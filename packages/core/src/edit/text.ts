/** Operations on the text inside a paragraph or a heading: typing, deleting, marks, links, breaks. */
import type { NotaDocument } from '../document.js'
import type { Change } from '../changes.js'
import { checkNoCollateral } from './check.js'
import {
  MSG,
  type OperationResult,
  cellsBefore,
  cellsStartingBefore,
  failure,
  isInsertionPoint,
  spansAt,
  splitsLock,
} from './common.js'
import { blockToEmpty, deleteBetween, emptyItemAt, resolvePoint, typeIntoEmpty } from './blocks.js'
import { docEol, makeCtx } from './window.js'
import { editableBlockAround } from './layout.js'
import { inlineBlockAround } from './cell.js'
import { type MarkName, newSpan, normalizeCells, plainCell, withoutMark } from './print.js'
import { impliedMark, readBlock } from './read.js'
import { realizeContent } from './realize.js'
import type { BlockInfo, Cell, Reading, Span } from './types.js'

/** Marks a typed text gets besides the ones that hold the position, and the ones it does not get. */
export interface TypedMarks {
  readonly add?: readonly MarkName[]
  readonly remove?: readonly MarkName[]
}

/** The index of the block in the layout of the document, and of its item, given the block. */
function itemIndexOf(
  doc: NotaDocument,
  block: BlockInfo,
): { ctx: ReturnType<typeof makeCtx>; index: number } {
  const ctx = makeCtx(doc)
  return { ctx, index: ctx.items.findIndex((it) => it.block && it.block.from === block.from) }
}

/**
 * The cells of `block` after `edit`, written back: the change of the source, checked. An empty result makes the
 * block an empty paragraph.
 */
export function rewriteBlock(
  doc: NotaDocument,
  block: BlockInfo,
  cells: readonly Cell[],
  exactOnly = false,
  hint?: number,
): OperationResult {
  const expected = normalizeCells(cells, block.kind as 'paragraph' | 'heading', docEol(doc.text))
  // an edit that is not a deletion (a mark or a link taken off, a break put in) must not lose a character: a blank
  // that a mark or a link held at the start of the block would be dropped as a leading one, and the text lost
  const cannot = 'The text cannot be written so that it reads as asked'
  if (exactOnly && expected.length < cells.length)
    return failure('leading-blank', cannot, block.from, block.to)
  if (expected.length === 0 && !block.inCell) {
    const { ctx, index } = itemIndexOf(doc, block)
    return blockToEmpty(ctx, index)
  }
  const r = realizeContent(doc, block, expected, hint)
  if (r.fail) return r.fail
  if (!r.exact && exactOnly) return failure('unstable', cannot, block.from, block.to)
  if (!r.exact && !block.inCell && checkNoCollateral(doc, r.doc, r.changes as Change[]).length > 0)
    return failure('collateral', 'That would change how other blocks read', block.from, block.to)
  return { doc: r.doc, changes: r.changes, literal: r.exact }
}

export interface Range {
  readonly reading: Reading
  /** Cells with index `i0` … `i1 - 1` lie inside the range. */
  readonly i0: number
  readonly i1: number
}

/** The cells of a block that lie inside `from`–`to`; null when an end of the range is inside a cell. */
export function cellRange(reading: Reading, from: number, to: number): Range | null {
  const cells = reading.cells
  const i0 = cellsStartingBefore(cells, from)
  const i1 = cellsStartingBefore(cells, to)
  if ((i0 > 0 && cells[i0 - 1]!.to > from) || (i1 > 0 && cells[i1 - 1]!.to > to)) return null
  // a range that starts or ends inside the text of a construct that is not edited cuts it; one that holds it whole does not
  if (i1 > i0 && (splitsLock(cells, i0) || splitsLock(cells, i1))) return null
  return { reading, i0, i1 }
}

/** Replaces the text `from`–`to` inside one paragraph or heading with plain text (typed at the marks of `from`). */
export function editInline(
  doc: NotaDocument,
  block: BlockInfo,
  from: number,
  to: number,
  text: string,
  marks?: TypedMarks,
): OperationResult {
  const c = block.content!
  const reading = readBlock(doc, block)
  const cells = reading.cells
  from = Math.max(from, c.from)
  to = Math.min(Math.max(to, from), c.to)
  let i0: number
  let i1: number
  if (from === to) {
    if (!isInsertionPoint(reading, from)) return failure('inside-construct', MSG.marker, from, to)
    i0 = i1 = cellsBefore(cells, from)
  } else {
    const r = cellRange(reading, from, to)
    if (!r) return failure('inside-construct', MSG.plate, from, to)
    i0 = r.i0
    i1 = r.i1
  }
  if (i0 === i1 && text === '') return { doc, changes: [] }
  let spans = spansAt(reading, from)
  const made = new Map<Span, Span>()
  for (const name of marks?.remove ?? []) spans = withoutMark(spans, name, made)
  for (const name of marks?.add ?? [])
    if (!spans.some((s) => s.type === name || impliedMark(s) === name)) spans = [...spans, newSpan(name)]
  const typed = text.split('').map((ch) => plainCell(ch, spans))
  return rewriteBlock(doc, block, [...cells.slice(0, i0), ...typed, ...cells.slice(i1)], false, from)
}

/** Typing at `at`. */
export function insertText(doc: NotaDocument, at: number, text: string, marks?: TypedMarks): OperationResult {
  if (/[\r\n]/.test(text))
    return failure('newline-in-text', 'A line break is not text: split the block', at, at)
  const block = inlineBlockAround(doc, at)
  if (block) return editInline(doc, block, at, at, text, marks)
  const ctx = makeCtx(doc)
  const e = emptyItemAt(ctx, at)
  if (e >= 0) return typeIntoEmpty(ctx, e, text)
  return failure('not-editable', 'Not edited here; use the source', at, at)
}

/** Deleting `from`–`to`, inside a block or over several. */
export function deleteRange(doc: NotaDocument, from: number, to: number): OperationResult {
  if (from > to) [from, to] = [to, from]
  if (from === to) return { doc, changes: [] }
  const block = inlineBlockAround(doc, from)
  if (block && to <= block.content!.to) return editInline(doc, block, from, to, '')
  const ctx = makeCtx(doc)
  const s = resolvePoint(ctx, from)
  const t = resolvePoint(ctx, to)
  if ('error' in s) return failure(s.error, 'The range starts inside a plate', from, to)
  if ('error' in t) return failure(t.error, 'The range ends inside a plate', from, to)
  if (s.item === t.item && s.cell !== null && t.cell !== null) {
    const b = ctx.items[s.item]!.block
    return b ? editInline(doc, b, from, to, '') : { doc, changes: [] }
  }
  return deleteBetween(ctx, s, t)
}

/** Shift-Enter: a hard line break at `at`. */
export function insertBreak(doc: NotaDocument, at: number): OperationResult {
  const block = editableBlockAround(doc, at)
  if (!block) return failure('not-editable', 'A line break goes into a paragraph', at, at)
  if (block.kind === 'heading') return failure('break-in-heading', 'A heading is one line', at, at)
  const reading = readBlock(doc, block)
  if (!isInsertionPoint(reading, at)) return failure('inside-construct', MSG.marker, at, at)
  const k = cellsBefore(reading.cells, at)
  const brk: Cell = {
    kind: 'break',
    ch: '',
    src: ' +',
    from: -1,
    to: -1,
    spans: spansAt(reading, at),
    flag: null,
    newline: false,
    linkEscape: false,
  }
  const cells = reading.cells
  return rewriteBlock(doc, block, [...cells.slice(0, k), brk, ...cells.slice(k)], true, at)
}
