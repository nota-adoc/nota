/**
 * Operations that change which blocks there are: typing into an empty paragraph, splitting and joining blocks,
 * deleting over several blocks and changing the style of a block.
 */
import type { NotaDocument } from '../document.js'
import { PLATE, type Ctx, type Spec, commitWindow, makeCtx } from './window.js'
import { type OperationResult, cellsBefore, failure, lockOf, splitsLock } from './common.js'
import { plainCell, normalizeCells } from './print.js'
import { readInline } from './read.js'
import type { BlockInfo, Cell, Item } from './types.js'
import { itemToParagraph, joinRefusal, sameRun } from './items.js'
import { isRawKind } from './layout.js'

const unchanged = (doc: NotaDocument): OperationResult => ({ doc, changes: [] })

/** The text spec of a block with other cells. */
export function textSpec(
  doc: NotaDocument,
  b: BlockInfo,
  cells: readonly Cell[],
): Extract<Spec, { t: 'text' }> {
  const text = doc.text
  return {
    t: 'text',
    kind: b.kind as 'paragraph' | 'heading',
    meta: b.meta ? text.slice(b.meta.from, b.meta.to) : '',
    prefix: text.slice(b.meta?.to ?? b.from, b.content!.from),
    suffix: text.slice(b.content!.to, b.to - b.eol.length),
    level: b.level,
    cells,
    eol: b.eol,
  }
}

export const paragraphSpec = (cells: readonly Cell[], eol: string): Extract<Spec, { t: 'text' }> => ({
  t: 'text',
  kind: 'paragraph',
  meta: '',
  prefix: '',
  suffix: '',
  level: 0,
  cells,
  eol,
})

export const cellsOf = (doc: NotaDocument, b: BlockInfo): readonly Cell[] =>
  readInline(doc, b.content!.from, b.content!.to).cells

/** The line break at the end of an item's source. */
const eolOfItem = (ctx: Ctx, it: Item): string => {
  const t = ctx.doc.text
  if (t.slice(it.from, it.to).endsWith('\r\n')) return '\r\n'
  return t.slice(it.from, it.to).endsWith('\n') ? '\n' : ''
}

const isText = (it: Item): boolean => it.kind === 'paragraph' || it.kind === 'heading'

export function finish(r: ReturnType<typeof commitWindow>, what: string, from: number, to: number): OperationResult {
  if (!r.ok) {
    // text that would be read as a list, a code block … (a plate) is told from what merely cannot be written
    const plate = r.reason.endsWith(PLATE)
    return failure(
      plate ? 'becomes-plate' : 'unstable',
      `Cannot write so that ${what}: ${r.reason}`,
      from,
      to,
    )
  }
  return { doc: r.doc, changes: r.changes }
}

/** The index of the item that holds `offset` and is an empty paragraph, or -1. */
export function emptyItemAt(ctx: Ctx, offset: number): number {
  const at = (strict: boolean): number =>
    ctx.items.findIndex(
      (it) =>
        it.kind === 'empty' &&
        it.from <= offset &&
        (strict ? offset < it.to || it.from === it.to : offset <= it.to),
    )
  const i = at(true)
  return i >= 0 ? i : at(false)
}

/** Text typed into an empty paragraph makes a paragraph of it. */
export function typeIntoEmpty(ctx: Ctx, index: number, text: string): OperationResult {
  const cells = normalizeCells(
    text.split('').map((ch) => plainCell(ch)),
    'paragraph',
    ctx.eol,
  )
  if (cells.length === 0) return unchanged(ctx.doc)
  const it = ctx.items[index]!
  const r = commitWindow(ctx, index, index, (kept, first) =>
    kept.flatMap((s, i) => (i + first === index ? [paragraphSpec(cells, ctx.eol)] : [s])),
  )
  return finish(r, 'the text stays as typed', it.from, it.to)
}

/** A block with no text left is an empty paragraph. */
export function blockToEmpty(ctx: Ctx, index: number): OperationResult {
  const it = ctx.items[index]!
  const r = commitWindow(ctx, index, index, (kept, first) =>
    kept.map((s, i) => (i + first === index ? ({ t: 'empty' } as Spec) : s)),
  )
  return finish(r, 'the block becomes empty', it.from, it.to)
}

/** Enter: splits the block at cell `k` (an empty paragraph gets another one next to it). */
export function splitItem(ctx: Ctx, index: number, k: number): OperationResult {
  const it = ctx.items[index]!
  if (isRawKind(it.kind))
    return failure('not-editable', 'This block is edited in the source', it.from, it.to)
  const doc = ctx.doc
  let specs: (kept: readonly Spec[], first: number) => Spec[]
  if (it.kind === 'empty') {
    specs = (kept, first) => kept.flatMap((s, i) => (i + first === index ? [s, { t: 'empty' } as Spec] : [s]))
  } else {
    const b = it.block!
    const cells = cellsOf(doc, b)
    // a line break next to the cursor is the break between the two blocks now
    let left = cells.slice(0, k)
    // blanks that a mark holds next to the cursor go: they would only make the marker double
    const blank = (c: Cell): boolean =>
      c.newline ||
      (c.kind === 'char' && (c.ch === ' ' || c.ch === '\t') && c.spans.length > 0 && lockOf(c) === null)
    while (left.length && blank(left[left.length - 1]!)) left = left.slice(0, -1)
    // the same goes for the start of the right half: blanks that a mark holds there would only make its marker double
    let from = k
    while (from < cells.length && blank(cells[from]!)) from++
    const right = normalizeCells(cells.slice(from), 'paragraph', ctx.eol)
    const eol = b.eol || ctx.eol
    if (k >= cells.length || right.length === 0) {
      specs = (kept, first) =>
        kept.flatMap((s, i) =>
          i + first === index
            ? [
                s.t === 'keep' && left.length === cells.length ? s : { ...textSpec(doc, b, left), eol },
                { t: 'empty' } as Spec,
              ]
            : [s],
        )
    } else if (left.length === 0) {
      specs = (kept, first) =>
        kept.flatMap((s, i) =>
          i + first === index
            ? [
                { t: 'empty' } as Spec,
                { ...textSpec(doc, b, right), kind: b.kind as 'paragraph' | 'heading' },
              ]
            : [s],
        )
    } else {
      specs = (kept, first) =>
        kept.flatMap((s, i) =>
          i + first === index ? [{ ...textSpec(doc, b, left), eol }, paragraphSpec(right, b.eol)] : [s],
        )
    }
  }
  const r = commitWindow(ctx, index, index, specs)
  return finish(r, 'the block splits', it.from, it.to)
}

/** Backspace at the start of an item (`backward`) or Delete at its end: joins it with the item before or after. */
export function joinItems(ctx: Ctx, index: number, backward: boolean): OperationResult {
  const w = backward ? index - 1 : index
  const x = backward ? index : index + 1
  // the first item of a document that starts with a list
  if (w < 0 && ctx.items[x]?.kind === 'item') return joinRefusal(ctx, x) ?? itemToParagraph(ctx, x)
  if (w < 0 || x >= ctx.items.length) return unchanged(ctx.doc)
  const W = ctx.items[w]!
  const X = ctx.items[x]!
  if (isRawKind(W.kind) || isRawKind(X.kind)) return unchanged(ctx.doc)
  const doc = ctx.doc
  if (X.kind === 'item') {
    const refused = joinRefusal(ctx, x)
    if (refused) return refused
    // the first item of a list (the one before it is not in the list): a paragraph before the list
    if (backward && !sameRun(ctx, w, x)) return itemToParagraph(ctx, x)
  }
  if (X.kind === 'empty' || W.kind === 'empty') {
    // an empty paragraph goes; the text next to it stays as it is
    const gone = X.kind === 'empty' ? x : w
    const r = commitWindow(ctx, gone, gone, (kept, first) => kept.filter((_s, i) => i + first !== gone))
    return finish(r, 'the empty paragraph goes', ctx.items[gone]!.from, ctx.items[gone]!.to)
  }
  const wb = W.block!
  const xb = X.block!
  if (xb.meta)
    return failure('join-meta', 'The block has lines above it (anchor, title, attributes)', X.from, X.to)
  const wc = cellsOf(doc, wb)
  const xc = cellsOf(doc, xb)
  const last = wc[wc.length - 1]
  const needs =
    wc.length > 0 &&
    xc.length > 0 &&
    last !== undefined &&
    !(last.kind === 'char' && (last.ch === ' ' || last.ch === '\t')) &&
    last.kind !== 'break'
  const joiner: Cell[] = needs
    ? [wb.kind !== 'heading' ? { ...plainCell(' ', [], ctx.eol), newline: true } : plainCell(' ')]
    : []
  const merged = { ...textSpec(doc, wb, [...wc, ...joiner, ...xc]), eol: xb.eol }
  const r = commitWindow(ctx, w, x, (kept, first) => {
    const out: Spec[] = []
    kept.forEach((s, i) => {
      if (i + first === w) out.push(merged)
      else if (i + first !== x) out.push(s)
    })
    return out
  })
  return finish(r, 'the blocks join', W.from, X.to)
}

/** A point of the text of the document as a deletion sees it. */
export interface Point {
  /** The item; `items.length` for the end of the document. */
  readonly item: number
  /** The cell of a paragraph or heading the point is before; null for a point between items (before `item`, which stays whole). */
  readonly cell: number | null
}

/** Where `offset` is, for a deletion: inside the text of an item, or between items. */
export function resolvePoint(ctx: Ctx, offset: number): Point | { error: string } {
  const items = ctx.items
  let lo = 0
  let hi = items.length - 1
  let i = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (items[mid]!.from <= offset) {
      i = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  const firstIsChip = isRawKind(items[0]!.kind)
  if (i < 0) return { item: 0, cell: firstIsChip ? null : 0 }
  const it = items[i]!
  if (offset > it.to) return { item: i + 1, cell: null } // in the blank line between two items, or after the last one
  if (isRawKind(it.kind)) {
    if (offset === it.from) return { item: i, cell: null }
    if (offset === it.to) return { item: i + 1, cell: null }
    return { error: 'inside-plate' }
  }
  if (it.kind === 'empty')
    return offset < it.to || it.from === it.to ? { item: i, cell: 0 } : { item: i + 1, cell: null }
  const b = it.block!
  const c = b.content!
  if (offset <= c.from) return { item: i, cell: 0 }
  const cells = readInline(ctx.doc, c.from, c.to).cells
  if (offset >= c.to) return offset === c.to ? { item: i, cell: cells.length } : { item: i + 1, cell: null }
  const k = cellsBefore(cells, offset)
  if ((cells[k] && cells[k]!.from < offset) || splitsLock(cells, k)) return { error: 'inside-construct' }
  return { item: i, cell: k }
}

/** Deletes what lies between two points that are not in the same item. */
export function deleteBetween(ctx: Ctx, s: Point, t: Point): OperationResult {
  const doc = ctx.doc
  const items = ctx.items
  // items that go whole
  const firstGone = s.cell === null ? s.item : s.item + 1
  const lastGone = t.item - 1
  const partialS = s.cell !== null ? items[s.item]! : null
  const partialT = t.cell !== null ? items[t.item]! : null
  if (!partialS && !partialT && lastGone < firstGone) return unchanged(doc)
  const p = partialS ? s.item : firstGone
  const q = partialT ? t.item : lastGone
  if (q < p || p >= items.length) return unchanged(doc)
  const cellsFor = (it: Item): readonly Cell[] => (it.kind === 'empty' ? [] : cellsOf(doc, it.block!))
  const left = partialS ? cellsFor(partialS).slice(0, s.cell!) : null
  const right = partialT ? cellsFor(partialT).slice(t.cell!) : null
  let survivor: Spec | null = null
  if (partialS && partialT) {
    const base = partialS.kind === 'empty' ? null : partialS.block!
    const cells = [...left!, ...right!]
    const eol = eolOfItem(ctx, partialT) || (partialT.kind === 'empty' ? '' : partialT.block!.eol)
    survivor = base ? { ...textSpec(doc, base, cells), eol } : { ...paragraphSpec(cells, eol) }
  } else if (partialS) {
    const base = partialS.kind === 'empty' ? null : partialS.block!
    survivor = base ? { ...textSpec(doc, base, left!), eol: base.eol || ctx.eol } : { t: 'empty' }
  } else if (partialT) {
    const base = partialT.kind === 'empty' ? null : partialT.block!
    survivor = base ? textSpec(doc, base, right!) : { t: 'empty' }
  }
  if (
    survivor &&
    survivor.t === 'text' &&
    normalizeCells(survivor.cells, survivor.kind === 'item' ? 'paragraph' : survivor.kind, ctx.eol).length === 0
  )
    survivor = { t: 'empty' }
  const r = commitWindow(ctx, p, q, (kept, first) => {
    const out: Spec[] = kept.slice(0, p - first)
    if (survivor) out.push(survivor)
    return out.concat(kept.slice(q - first + 1))
  })
  return finish(r, 'the range is deleted', items[p]!.from, items[q]!.to)
}

const CHAR: Record<string, string> = { '=': '=', '#': '#' }

/** Sets the style of the paragraph or heading at `index`. */
export function setItemType(
  ctx: Ctx,
  index: number,
  type: 'paragraph' | 'heading',
  level: number,
): OperationResult {
  const it = ctx.items[index]!
  if (!isText(it) || it.block!.variant)
    return failure('not-editable', 'Only a paragraph or a heading has a style', it.from, it.to)
  const b = it.block!
  const doc = ctx.doc
  if (b.level === 1) return failure('document-title', 'The document title keeps its style', it.from, it.to)
  if (type === 'heading' && (level < 2 || level > 6))
    return failure('bad-level', 'A heading has level 2 to 6', it.from, it.to)
  if (type === 'paragraph' && b.kind === 'paragraph') return unchanged(doc)
  if (type === 'heading' && b.kind === 'heading' && b.level === level) return unchanged(doc)
  // a heading is one line: the lines and the hard breaks of a paragraph become spaces
  const cells = cellsOf(doc, b).map((c) =>
    type === 'heading' && c.kind === 'break' ? plainCell(' ', c.spans) : c,
  )
  const tryLevel = (count: number): OperationResult => {
    let spec: Spec
    if (type === 'paragraph') {
      spec = { ...textSpec(doc, b, cells), kind: 'paragraph', prefix: '', suffix: '', level: 0, eol: b.eol }
    } else {
      const ch = b.kind === 'heading' ? (CHAR[b.marker[0]!] ?? '=') : '='
      const marker = ch.repeat(count)
      const old = b.kind === 'heading' ? textSpec(doc, b, cells) : null
      const spaces = old ? old.prefix.slice(b.marker.length) : ' '
      const suffix = old ? old.suffix.replace(/^([ \t]+)[=#]+$/, `$1${marker}`) : ''
      spec = {
        t: 'text',
        kind: 'heading',
        meta: old ? old.meta : b.meta ? doc.text.slice(b.meta.from, b.meta.to) : '',
        prefix: marker + spaces,
        suffix,
        level,
        cells,
        eol: b.eol,
      }
    }
    const r = commitWindow(ctx, index, index, (kept, first) =>
      kept.map((s, i) => (i + first === index ? spec : s)),
    )
    return finish(r, 'the style changes', it.from, it.to)
  }
  const first = tryLevel(level)
  if (!('error' in first) || type === 'paragraph') return first
  // a `leveloffset` moves the levels: the marker gets the difference
  for (const count of [level - 1, level + 1, level - 2, level + 2]) {
    if (count < 1 || count > 6 || count === level) continue
    const r = tryLevel(count)
    if (!('error' in r)) return r
  }
  return first
}

export { makeCtx }
