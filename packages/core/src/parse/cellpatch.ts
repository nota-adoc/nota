/**
 * A letter typed in the text of a cell of a big table: the unit of the table is made from the old one, not read again.
 *
 * Reading a table of 2000 cells takes most of the time of a keystroke in it, and nothing but one cell changes. This is
 * done only for a change that cannot alter how the rest is read: inside the text of one cell of a `psv` table, a text
 * of one line without the characters that mean something in a cell (`|`, `\`, a quote), that neither starts nor ends
 * with a blank and does not end like the spec of the next cell. Anything else is left to the parser; the result is the
 * same as the parser's (a test compares them).
 */
import { type NodeSet, Tree, TreeBuffer } from '@lezer/common'
import { Type, blockKind, nodeTypes, tableModel, textPieces } from '../nodes.js'
import type { TableCellModel, TableModel } from '../nodes.js'
import type { Unit } from './blocks.js'
import { cellFill } from './table.js'

/** What a cell of the text may hold for the patch: one line, no mark of the format, no blank at the ends. */
const PLAIN = /^[^\s\0|\\"](?:[^|\\"\r\n\t]*[^\s\0|\\"])?$/
/** The end of a text that the scan may take for the spec of the next cell (`2+`, `.>`, `s`). */
const SPEC_LIKE = /^[0-9.*+<^>]*[a-z]?$/
/** Room in a buffer of a tree: its offsets are 16 bits. */
const ROOM = 60000

interface Change {
  readonly from: number
  readonly to: number
  readonly insert: string
}

/**
 * The unit of a table with the change made in a cell, or null when the change is not one this can do. `at` is the
 * start of the unit in the old text, the change is in the old text's offsets.
 */
export function patchCell(
  unit: Unit,
  at: number,
  change: Change,
  oldText: string,
  newText: string,
): Unit | null {
  const block = unit.block
  if (!block || unit.section || unit.diagnostics.length > 0 || unit.events.length > 0) return null
  const tree = block.tree
  if (tree.type !== nodeTypes[Type.DelimitedBlock]) return null
  const rel = tree.prop(tableModel)
  if (!rel || rel.format !== 'psv' || rel.separator !== '|' || rel.dropped.length > 0) return null
  const base = at + block.offset
  const a = change.from - base
  const b = change.to - base
  if (a < 0 || b > tree.length) return null
  const delta = change.insert.length - (b - a)
  const cell = find(rel, a, b)
  if (!cell) return null
  const cf = cell.contentFrom
  const ct = cell.contentTo
  // (the text of the cell is what is written; the new text is as plain; a line does not start in it)
  if (cell.text.length !== ct - cf || oldText.slice(base + cf, base + ct) !== cell.text || !PLAIN.test(cell.text)) return null
  if (cf === 0 || oldText.charCodeAt(base + cf - 1) === 10 || oldText.charCodeAt(base + cf - 1) === 13) return null
  const text = newText.slice(base + cf, base + ct + delta)
  if (!PLAIN.test(text) || text.charCodeAt(0) === 61 /* = */) return null
  if (SPEC_LIKE.test(text.slice(text.search(/\S*$/)))) return null
  const children = patchTree(tree, cf, ct, delta)
  if (!children) return null
  const model = shift(rel, b, delta, cell, text)
  const patched = new Tree(tree.type, children.children, children.positions, tree.length + delta, [
    [blockKind, tree.prop(blockKind) as string],
    [tableModel, model],
  ])
  return {
    ...unit,
    length: unit.length + delta,
    lookAhead: unit.lookAhead + delta,
    block: { tree: patched, offset: block.offset },
    post: unit.post.map((p) => ({ tree: p.tree, offset: p.offset + delta })),
  }
}

/** The cell with the change inside its text, if it is the only cell the change touches. */
function find(rel: TableModel, a: number, b: number): TableCellModel | null {
  let found: TableCellModel | null = null
  for (const part of [rel.rows.head, rel.rows.body, rel.rows.foot])
    for (const row of part)
      for (const c of row.cells) {
        if (c.contentFrom <= a && b <= c.contentTo && c.contentFrom < c.contentTo && c.to === c.contentTo) {
          if (found || c.style === 'asciidoc') return null
          found = c
        } else if (c.from === c.to ? c.from < a || c.from > b : c.to <= a || c.from >= b) continue
        else return null
      }
  return found
}

/** The model with the cells after the edited one moved and the text of the edited one. */
function shift(rel: TableModel, b: number, delta: number, edited: TableCellModel, text: string): TableModel {
  const part = (rows: TableModel['rows']['body']): TableModel['rows']['body'] =>
    rows.map((row) => {
      if (row.cells.every((c) => c !== edited && c.from < b)) return row
      return {
        cells: row.cells.map((c) =>
          c === edited
            ? { ...c, to: c.to + delta, contentTo: c.contentTo + delta, text, fill: cellFill(text, c.style, c.contentFrom) }
            : c.from >= b
              ? {
                  ...c,
                  from: c.from + delta,
                  to: c.to + delta,
                  contentFrom: c.contentFrom + delta,
                  contentTo: c.contentTo + delta,
                  fill: c.fill && { ...c.fill, from: c.fill.from + delta, to: c.fill.to + delta },
                }
              : c,
        ),
      }
    })
  return { ...rel, to: rel.to + delta, rows: { head: part(rel.rows.head), body: part(rel.rows.body), foot: part(rel.rows.foot) } }
}

interface Parts {
  children: (Tree | TreeBuffer)[]
  positions: number[]
}

/**
 * The children of a tree with the nodes after the text of the cell `[cf, ct)` moved by `delta` and those around it made
 * longer, or null (a node of an odd shape, a buffer that would not hold the offsets).
 */
function patchTree(tree: Tree, cf: number, ct: number, delta: number): Parts | null {
  const children: (Tree | TreeBuffer)[] = []
  const positions: number[] = []
  let hit = false
  for (let i = 0; i < tree.children.length; i++) {
    const child = tree.children[i]!
    const p = tree.positions[i]!
    const e = p + child.length
    if (e <= cf) {
      children.push(child)
      positions.push(p)
    } else if (p >= ct) {
      children.push(child)
      positions.push(p + delta)
    } else if (p <= cf && e >= ct) {
      let next: Tree | TreeBuffer | null
      if (child instanceof TreeBuffer) next = patchBuffer(child, p, cf, ct, delta)
      else if (child.prop(textPieces) !== undefined || child.prop(tableModel) !== undefined || child.prop(blockKind) !== undefined) next = null
      else {
        const inner = patchTree(child, cf - p, ct - p, delta)
        next = inner && new Tree(child.type, inner.children, inner.positions, child.length + delta)
      }
      if (!next) return null
      hit = true
      children.push(next)
      positions.push(p)
    } else return null
  }
  return hit ? { children, positions } : null
}

function patchBuffer(buf: TreeBuffer, at: number, cf: number, ct: number, delta: number): TreeBuffer | null {
  if (buf.length + delta > ROOM) return null
  const from = buf.buffer
  const out = new Uint16Array(from.length)
  for (let i = 0; i < from.length; i += 4) {
    const s = from[i + 1]! + at
    const e = from[i + 2]! + at
    let ns = from[i + 1]!
    let ne = from[i + 2]!
    if (e <= cf) {
      // before the text
    } else if (s >= ct) {
      ns += delta
      ne += delta
    } else if (s <= cf && e >= ct) ne += delta
    else return null
    out[i] = from[i]!
    out[i + 1] = ns
    out[i + 2] = ne
    out[i + 3] = from[i + 3]!
  }
  return new TreeBuffer(out, buf.length + delta, buf.set as NodeSet)
}
