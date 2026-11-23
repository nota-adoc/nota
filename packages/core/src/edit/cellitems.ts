/**
 * Operations on the items of a list in an `a` cell: Enter in the text of an item, and an item started by typing. The text of an
 * item is edited by the operations on text (see `cell.ts`); what changes the number of items is here. Both write the text of the
 * cell through the check of the table (`writeCellChanges`), and read what stands there again.
 */
import type { NotaDocument } from '../document.js'
import { cellBlockAround, cellBlocksKept, cellTextRanges } from './cell.js'
import { MSG, type OperationResult, cellsBefore, failure, isFailure, isInsertionPoint } from './common.js'
import { gapAfterMarker, isOrdered, nextMarker } from './items.js'
import { childMarker } from './lists.js'
import { normalizeCells, plainCell, printCells } from './print.js'
import { readBlock, readCell } from './read.js'
import { firstDivergence } from './realize.js'
import { writeCellChanges } from './tables.js'
import { cellsOf } from './tablecheck.js'
import { docEol } from './window.js'
import type { BlockInfo, Cell } from './types.js'

const unchanged = (doc: NotaDocument): OperationResult => ({ doc, changes: [] })

/** The items of the cell that holds `block`, with the text of each as the block of a cell. */
function itemsAround(doc: NotaDocument, block: BlockInfo): { block: BlockInfo; from: number }[] {
  const at = block.inCell!.at
  const model = doc.tableAt(at)
  const cell = model ? cellsOf(model).find((c) => c.contentFrom === at) : undefined
  if (!model || !cell) return []
  return cellTextRanges(doc, cell, model.format)
    .filter((r) => r.item)
    .map((r) => ({ block: { ...r.item!, content: { from: r.from, to: r.to }, inCell: { at } }, from: r.from }))
}

/** The item of a cell that holds `at`, or null. */
function itemBlock(doc: NotaDocument, at: number): BlockInfo | null {
  const b = cellBlockAround(doc, at)
  return b && b.kind === 'item' ? b : null
}

/** True when the cells read as `want` at the text of the item that starts at `from` in the cell at `at` of `next`. */
function readsAs(next: NotaDocument, at: number, from: number, want: readonly Cell[]): boolean {
  const b = cellBlockAround(next, from)
  if (!b || b.kind !== 'item' || b.inCell!.at !== at || b.content!.from !== from) return false
  const got = readCell(next, b.content!.from, b.content!.to)
  return firstDivergence(got.cells, want) < 0
}

/**
 * The text from `end` (the end of the item `i`, or of its children) to the end of the items after it that stand right behind and
 * are peers or deeper, with the numbers `N.` of the peers (`level`) going on from `n`; null when no number changes.
 */
function renumbered(doc: NotaDocument, items: { block: BlockInfo }[], i: number, level: number, marker: string, end: number) {
  let n = parseInt(marker)
  let text = ''
  let at = end
  let changed = false
  for (let j = i + 1; items[j] && /^\d+\.$/.test(marker); j++) {
    const b = items[j]!.block
    if (b.level < level || doc.text.slice(at, b.markerFrom).trim() !== '') break
    if (b.level === level && /^\d+\.$/.test(b.marker)) {
      text += doc.text.slice(at, b.markerFrom) + ++n + '.'
      at = b.markerFrom + b.marker.length
      changed = true
    }
    text += doc.text.slice(at, b.content!.to)
    at = b.content!.to
  }
  return changed ? { text, to: at } : { text: '', to: end }
}

/** Writes `printed` over `from`–`to` of the cell at `at`; each of `wants` (where it starts, what it reads as) has to read so, the rest of the cell as it was. */
function write(doc: NotaDocument, at: number, from: number, to: number, printed: string, wants: [number, readonly Cell[]][]) {
  const res = writeCellChanges(doc, at, from, [{ from, to, insert: printed }], printed, to)
  if (isFailure(res)) return res
  const ok = cellBlocksKept(doc, res.doc, at, from, to)
  return ok && wants.every(([f, want]) => readsAs(res.doc, at, f, want))
    ? res
    : failure('unstable', 'The text cannot be written so that it reads as asked', from, to)
}

/** Enter in the middle of the text of an item of an `a` cell: two items of the same level and kind. */
export function splitCellItem(doc: NotaDocument, at: number): OperationResult {
  const b = itemBlock(doc, at)
  if (!b) return failure('not-editable', 'A block is split inside its text', at, at)
  const reading = readBlock(doc, b)
  if (!isInsertionPoint(reading, at)) return failure('inside-construct', MSG.marker, at, at)
  const cells = reading.cells
  const k = cellsBefore(cells, at)
  const eol = docEol(doc.text)
  const blank = (c: Cell): boolean =>
    c.newline || (c.kind === 'char' && (c.ch === ' ' || c.ch === '\t') && c.spans.length > 0)
  let left = cells.slice(0, k)
  while (left.length && blank(left[left.length - 1]!)) left = left.slice(0, -1)
  let from = k
  while (from < cells.length && blank(cells[from]!)) from++
  const right = normalizeCells(cells.slice(from), 'paragraph', eol)
  // (at the ends of the text the editor puts an empty item that is not in the text yet)
  if (left.length === 0 || right.length === 0) return unchanged(doc)
  const prefix = nextMarker(b.marker) + gapAfterMarker(doc.text, b) + (b.checked !== '' ? '[ ] ' : '')
  const c = b.content!
  const items = itemsAround(doc, b)
  const tail = renumbered(doc, items, items.findIndex((it) => it.from === c.from), b.level, nextMarker(b.marker), c.to)
  const printed = printCells(left) + eol + prefix + printCells(right) + tail.text
  return write(doc, b.inCell!.at, c.from, tail.to, printed, [
    [c.from, left],
    [c.from + printCells(left).length + eol.length + prefix.length, right],
  ])
}

/**
 * The first thing typed in an item that was only started after the item that holds `after`, on `level` (the items between, if the
 * item has items of its own, are passed): a new item with `text`.
 */
export function insertCellItem(doc: NotaDocument, after: number, level: number, text: string): OperationResult {
  const x = itemBlock(doc, after)
  const items = x ? itemsAround(doc, x) : []
  const i = x ? items.findIndex((it) => it.from === x.content!.from) : -1
  if (!x || i < 0) return failure('not-editable', 'A list item goes after an item', after, after)
  // (the items of the same list that come right after it and are deeper are part of it)
  let last = i
  while (items[last + 1] && items[last + 1]!.block.level > x.level) last++
  const end = items[last]!.block.content!.to
  // the marker of the new item
  let marker: string | null = null
  if (level === x.level) marker = nextMarker(x.marker)
  else if (level === x.level + 1) marker = childMarker(x.marker, isOrdered(x.marker) ? 'OrderedList' : 'UnorderedList')
  else if (level < x.level) {
    for (let j = i - 1; j >= 0; j--) {
      const p = items[j]!.block
      if (p.level === level) {
        marker = nextMarker(p.marker)
        break
      }
      if (p.level < level) break
    }
  }
  if (marker === null) return failure('bad-level', 'An item does not go on that level', after, after)
  const eol = docEol(doc.text)
  const cells = normalizeCells(text.split('').map((ch) => plainCell(ch)), 'paragraph', eol)
  if (cells.length === 0) return unchanged(doc)
  const prefix = marker + gapAfterMarker(doc.text, x) + (x.checked !== '' ? '[ ] ' : '')
  const body = printCells(cells)
  const tail = renumbered(doc, items, last, level, marker, end)
  const printed = eol + prefix + body + tail.text
  return write(doc, x.inCell!.at, end, tail.to, printed, [[end + eol.length + prefix.length, cells]])
}
