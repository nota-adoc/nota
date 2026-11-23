/** Marks: bold, italic, monospace, strikethrough, highlight over a range of text. */
import type { NotaDocument } from '../document.js'
import type { Change } from '../changes.js'
import { MSG, type OperationResult, failure, isFailure } from './common.js'
import { readLayout } from './layout.js'
import { hasMark, newSpan, withoutMark, type MarkName } from './print.js'
import { impliedMark, readBlock } from './read.js'
import { cellBlockOver } from './cell.js'
import { cellRange, rewriteBlock } from './text.js'
import type { BlockInfo, Cell, Span } from './types.js'

export type { MarkName }

export interface BlockRange {
  readonly block: BlockInfo
  readonly cells: readonly Cell[]
  readonly i0: number
  readonly i1: number
}

/** The paragraphs and headings that have text in `from`–`to`, with the cells of the range in each. */
export function blocksInRange(doc: NotaDocument, from: number, to: number): BlockRange[] | { error: string } {
  const layout = readLayout(doc)
  const out: BlockRange[] = []
  for (const block of layout.blocks) {
    if (!block.content) continue
    const c = block.content
    if (c.to <= from || c.from >= to) continue
    // a table: the text of one of its cells is a block of text; a range over more than one is not a range of text
    if (block.kind === 'table') {
      const cell = cellBlockOver(doc, from, to)
      if (cell === 'none') return { error: 'invalid-range' }
      const reading = readBlock(doc, cell)
      const r = cellRange(reading, Math.max(from, cell.content!.from), Math.min(to, cell.content!.to))
      if (!r) return { error: 'inside-construct' }
      if (r.i1 > r.i0) out.push({ block: cell, cells: reading.cells, i0: r.i0, i1: r.i1 })
      continue
    }
    const reading = readBlock(doc, block)
    const r = cellRange(reading, Math.max(from, c.from), Math.min(to, c.to))
    if (!r) return { error: 'inside-construct' }
    if (r.i1 > r.i0) out.push({ block, cells: reading.cells, i0: r.i0, i1: r.i1 })
  }
  return out
}

/** Applies `edit` to the blocks of a range, last to first, and joins the changes. */
export function rewriteBlocks(
  doc: NotaDocument,
  ranges: readonly BlockRange[],
  edit: (r: BlockRange) => Cell[],
): OperationResult {
  let cur = doc
  const changes: Change[] = []
  for (const r of [...ranges].reverse()) {
    const res = rewriteBlock(cur, r.block, edit(r), true)
    if (isFailure(res)) return res
    cur = res.doc
    changes.unshift(...res.changes)
  }
  return { doc: cur, changes }
}

/** Puts a mark on the range, or takes it off; with `on` undefined it is put on unless the whole range has it. */
export function toggleMark(
  doc: NotaDocument,
  from: number,
  to: number,
  mark: MarkName,
  on?: boolean,
): OperationResult {
  if (from > to) [from, to] = [to, from]
  const ranges = blocksInRange(doc, from, to)
  if ('error' in ranges) return failure(ranges.error, MSG.plate, from, to)
  if (ranges.length === 0) return failure('empty-selection', MSG.select, from, to)
  // the marks inside a construct that is not edited (`pass:q[*x*]`) stay as they are
  for (const r of ranges)
    for (let i = r.i0; i < r.i1; i++) {
      const spans = r.cells[i]!.spans
      const at = spans.findIndex((s) => s.type === 'lock')
      if (at >= 0 && spans.slice(at + 1).some((s) => s.type === mark || impliedMark(s) === mark))
        return failure('inside-construct', MSG.construct, from, to)
    }
  const all = ranges.every((r) => r.cells.slice(r.i0, r.i1).every((c) => hasMark(c, mark)))
  const add = on ?? !all
  if (!add && !ranges.some((r) => r.cells.slice(r.i0, r.i1).some((c) => hasMark(c, mark))))
    return { doc, changes: [] }
  const made = new Map<Span, Span>()
  return rewriteBlocks(doc, ranges, (r) => {
    const cells = r.cells.slice()
    if (!add) {
      // a piece of roles written with that mark (`[.zz-a]*пять*`), taken off in part: the piece stays one piece
      // (`[.zz-a]#**п**я**ть**#`), the cells outside the range keep the mark inside it
      const rest = new Map<Span, Span>()
      for (let i = r.i0; i < r.i1; i++)
        for (const s of cells[i]!.spans) if (impliedMark(s) === mark && !rest.has(s)) rest.set(s, newSpan(mark))
      return cells.map((c, i) => {
        if (i >= r.i0 && i < r.i1) return { ...c, spans: withoutMark(c.spans, mark, made) }
        if (!c.spans.some((s) => rest.has(s))) return c
        const spans: Span[] = []
        for (const s of c.spans) {
          const keep = rest.get(s)
          if (keep) spans.push(withoutMark([s], mark, made)[0]!, keep)
          else spans.push(s)
        }
        return { ...c, spans }
      })
    }
    // the mark of that kind that the range touches is stretched over all of it; a new one when there is none
    const touched: Span[] = []
    for (let i = r.i0; i < r.i1; i++)
      for (const s of cells[i]!.spans) if (s.type === mark && !touched.includes(s)) touched.push(s)
    const span = touched[0] ?? newSpan(mark)
    const merge = new Set(touched)
    return cells.map((c, i) => {
      const inRange = i >= r.i0 && i < r.i1
      const has = c.spans.some((s) => merge.has(s))
      if (!inRange && !has) return c
      // (a piece of roles that is bold already needs no second bold over it)
      if (inRange && !has && hasMark(c, mark)) return c
      const spans = c.spans.filter((s) => !merge.has(s))
      return { ...c, spans: [...spans, span] }
    })
  })
}
