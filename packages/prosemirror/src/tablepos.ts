/**
 * Places in tables. A table is one top-level node of the ProseMirror document: rows, cells, and in each cell the blocks it
 * holds (the text, a table of the next level, a block shown as source). The map between these nodes and the table of Nota
 * (`TableView`) is by index: the n-th row of the node is the n-th row of the view, and so on. Nothing here is stored in the
 * nodes except the place of a cell in the grid.
 */
import type { NotaDocument } from '@nota-adoc/core'
import { type CellBlock, type CellView, type TableView, cellMap, cellsBefore } from '@nota-adoc/core/internal'
import type { Node as PMNode } from 'prosemirror-model'
import { schema } from './schema.js'

/** Where the next table is: in the `block`-th block of the `cell`-th cell of the `row`-th row. */
export interface Step {
  readonly row: number
  readonly cell: number
  readonly block: number
}

/** A place in a table (the innermost one the place is in). */
export interface TableLoc {
  /** The way from the table of the document to the cell that holds this table (empty for a table of the document). */
  readonly host: readonly Step[]
  readonly view: TableView
  /** The ProseMirror node of this table and the place before it. */
  readonly node: PMNode
  readonly nodePos: number
  readonly row: number
  readonly cellIdx: number
  readonly cell: CellView
  /** The block of the cell the place is in, or null (between the blocks). */
  readonly block: number | null
  /** Where in the text of the block (only in a text block). */
  readonly offset: number | null
}

/** The place `pos` as a place in a table; null when it is not in a cell. `top` is the table that starts at `topPos`. */
export function resolveTable(doc: PMNode, pos: number, top: TableView, topPos: number): TableLoc | null {
  if (pos < 0 || pos > doc.content.size) return null
  const $ = doc.resolve(pos)
  let view = top
  const host: Step[] = []
  for (let d = 1; ; d += 3) {
    const node = $.node(d)
    if (!node || node.type !== schema.nodes.table || $.depth < d + 2) return null
    const row = $.index(d)
    const cellIdx = $.index(d + 1)
    const cell = view.rows[row]?.[cellIdx]
    if (!cell) return null
    const nodePos = d === 1 ? topPos : $.before(d)
    const base = { host: [...host], view, node, nodePos, row, cellIdx, cell }
    if ($.depth < d + 3) return { ...base, block: null, offset: null }
    const block = $.index(d + 2)
    const b = cell.blocks[block]
    const inner = $.node(d + 3)
    if (inner.type === schema.nodes.table && b?.kind === 'table') {
      host.push({ row, cell: cellIdx, block })
      view = b.table
      continue
    }
    return { ...base, block, offset: inner.type === schema.nodes.cell_text ? $.parentOffset : null }
  }
}

/** The node at the end of the steps (a table) and the place before it. */
export function followSteps(top: PMNode, topPos: number, steps: readonly Step[]): { node: PMNode; pos: number } | null {
  let node = top
  let pos = topPos
  for (const s of steps) {
    const inner = child(node, pos, s.row, s.cell, s.block)
    if (!inner || inner.node.type !== schema.nodes.table) return null
    node = inner.node
    pos = inner.pos
  }
  return { node, pos }
}

/** The block of a cell of a table: the node and the place before it. */
function child(
  table: PMNode,
  tablePos: number,
  row: number,
  cell: number,
  block: number,
): { node: PMNode; pos: number } | null {
  if (row >= table.childCount) return null
  let pos = tablePos + 1
  for (let i = 0; i < row; i++) pos += table.child(i).nodeSize
  const r = table.child(row)
  if (cell >= r.childCount) return null
  pos += 1
  for (let j = 0; j < cell; j++) pos += r.child(j).nodeSize
  const c = r.child(cell)
  if (block >= c.childCount) return null
  pos += 1
  for (let k = 0; k < block; k++) pos += c.child(k).nodeSize
  return { node: c.child(block), pos }
}

/** The place before the cell `cell` of the row `row`, and the cell. */
export function cellAtIndex(table: PMNode, tablePos: number, row: number, cell: number): { node: PMNode; pos: number } | null {
  if (row >= table.childCount) return null
  let pos = tablePos + 1
  for (let i = 0; i < row; i++) pos += table.child(i).nodeSize
  const r = table.child(row)
  if (cell >= r.childCount) return null
  pos += 1
  for (let j = 0; j < cell; j++) pos += r.child(j).nodeSize
  return { node: r.child(cell), pos }
}

/** The cell that covers the square (`row`, `col`) of the grid of a table: the place before it, the node and its indexes. */
export function coveringCell(
  table: PMNode,
  tablePos: number,
  row: number,
  col: number,
): { node: PMNode; pos: number; row: number; cell: number } | null {
  let rowPos = tablePos + 1
  for (let i = 0; i < table.childCount; i++) {
    const r = table.child(i)
    let pos = rowPos + 1
    for (let j = 0; j < r.childCount; j++) {
      const c = r.child(j)
      const a = c.attrs as { row: number; col: number; colspan: number; rowspan: number }
      if (a.row <= row && row < a.row + a.rowspan && a.col <= col && col < a.col + a.colspan) return { node: c, pos, row: i, cell: j }
      pos += c.nodeSize
    }
    rowPos += r.nodeSize
  }
  return null
}

/** The place in the text of a cell: the end (or the start) of the first block of text it has, else the start of the cell. */
export function cellCursor(cell: PMNode, cellPos: number, at: 'start' | 'end' = 'end'): number {
  let pos = cellPos + 1
  for (let k = 0; k < cell.childCount; k++) {
    const b = cell.child(k)
    if (b.type === schema.nodes.cell_text) return at === 'end' ? pos + 1 + b.content.size : pos + 1
    pos += b.nodeSize
  }
  return cellPos + 1
}

/** The place of a position of the text of the block `block` of a cell, in the table the steps lead to. */
export function textPlace(
  top: PMNode,
  topPos: number,
  host: readonly Step[],
  row: number,
  cell: number,
  block: number,
  offset: number,
): number | null {
  const t = followSteps(top, topPos, host)
  if (!t) return null
  const c = cellAtIndex(t.node, t.pos, row, cell)
  if (!c) return null
  const kids = c.node.childCount
  const k = Math.min(block, kids - 1)
  let b = c.node.child(k)
  let pos = c.pos + 1
  for (let i = 0; i < k; i++) pos += c.node.child(i).nodeSize
  if (b.type !== schema.nodes.cell_text) {
    // (the block is not text any more: the first text of the cell)
    return cellCursor(c.node, c.pos, 'start')
  }
  b = c.node.child(k)
  return pos + 1 + Math.min(offset, b.content.size)
}

/** A block of the text of a cell. */
export type TextBlock = Extract<CellBlock, { kind: 'text' }>

/**
 * Where the position `p` of the text of a cell is in the file: the content of the cell, less the quotes and blanks around it,
 * and less the blanks at the ends of its lines, which the text of the cell has not (`end`: where the text before `p` ends).
 */
export function cellSrc(doc: NotaDocument, c: CellView, p: number, end = false): number {
  const map = cellMap(doc, c)
  return map ? map.toSrc(p, end) : c.contentFrom + p
}

/** The position of the text of a cell that is at the offset `off` of the file. */
function cellText(doc: NotaDocument, c: CellView, off: number): number {
  const map = cellMap(doc, c)
  return map ? map.toText(off) : off - c.contentFrom
}

/** The range of the file that the text block `b` of the cell `c` stands for. */
export function blockRange(doc: NotaDocument, c: CellView, b: TextBlock): { from: number; to: number } {
  if (b.reading) return { from: b.reading.from, to: b.reading.to }
  return { from: cellSrc(doc, c, b.from), to: Math.min(c.contentTo, cellSrc(doc, c, b.to, true)) }
}

/**
 * The offset of the file at position `k` of the text of a block of a cell. Where the text is read, a position is a cell of the
 * reading, and `how` says which of the offsets that stand for it: `point` the end of the cell before it (where the cursor is),
 * `start` the start of the cell after it (where a range starts), `end` the end of the cell before it (where a range ends).
 * Where it is not, a position is a character.
 */
export function blockOffset(doc: NotaDocument, c: CellView, b: TextBlock, k: number, how: 'point' | 'start' | 'end'): number {
  const r = b.reading
  if (!r) return Math.min(c.contentTo, cellSrc(doc, c, b.from + k, k > 0))
  const cells = r.cells
  if (how === 'start') return k < cells.length ? cells[Math.max(0, k)]!.from : r.to
  return k <= 0 ? r.from : k >= cells.length ? r.to : cells[k - 1]!.to
}

/** The position of the text of a block of a cell (a cell of the reading, or a character) at an offset of the file. */
export function blockPosition(doc: NotaDocument, c: CellView, b: TextBlock, offset: number): number {
  const r = b.reading
  if (!r) {
    return Math.max(0, Math.min(cellText(doc, c, offset) - b.from, b.to - b.from))
  }
  return cellsBefore(r.cells, offset)
}

/**
 * An item of a list in a cell that is only started (Enter at the end of an item): on the screen until its first sign is typed,
 * and not in the text. It stands in the cell `cell` of the row `row` of the table that the steps `host` lead to (in the
 * table of the item `index`), right after the block `block` of the cell.
 */
export interface CellDraft {
  readonly index: number
  readonly host: readonly Step[]
  readonly row: number
  readonly cell: number
  readonly block: number
  readonly level: number
  readonly ordered: boolean
  readonly check: boolean
}

/** The view of a table with the block of a draft in it: a block of text with an item and no text, `draft` set. */
export function withCellDraft(view: TableView, d: CellDraft, depth = 0): TableView {
  const swap = (row: number, cell: number, make: (c: CellView) => CellView): TableView => ({
    ...view,
    rows: view.rows.map((r, i) => (i === row ? r.map((c, k) => (k === cell ? make(c) : c)) : r)),
  })
  const step = d.host[depth]
  if (step)
    return swap(step.row, step.cell, (c) => ({
      ...c,
      blocks: c.blocks.map((b, i) => (i === step.block && b.kind === 'table' ? { kind: 'table', table: withCellDraft(b.table, d, depth + 1) } : b)),
    }))
  const block: CellBlock = {
    kind: 'text',
    text: '',
    from: 0,
    to: 0,
    readable: false,
    reading: null,
    draft: true,
    item: { marker: d.ordered ? '.'.repeat(d.level) : '*', level: d.level, checked: d.check ? ' ' : '' },
  }
  return swap(d.row, d.cell, (c) => ({ ...c, blocks: [...c.blocks.slice(0, d.block + 1), block, ...c.blocks.slice(d.block + 1)] }))
}
