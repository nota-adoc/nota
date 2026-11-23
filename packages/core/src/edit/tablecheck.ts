/**
 * What can be told of a table from its layout alone: its cells in the order of the text, and whether they tile the grid, each
 * once (a table the operations can write back). The layout and the operations on tables both rely on it.
 */
import type { SyntaxNode } from '@lezer/common'
import { type TableCellModel, type TableModel, tableModel } from '../nodes.js'

/** The cells of a table in the order of the text: the head, the body, the foot. */
export function cellsOf(model: TableModel): TableCellModel[] {
  const out: TableCellModel[] = []
  for (const part of [model.rows.head, model.rows.body, model.rows.foot])
    for (const r of part) for (const c of r.cells) out.push(c)
  return out
}

/** The reason the operations cannot write the table back (cells left out, repeated, overlapping or missing), or null. */
export function irregular(model: TableModel): string | null {
  if (model.dropped.length > 0) return 'The table has cells that are left out'
  const nrows = model.rows.head.length + model.rows.body.length + model.rows.foot.length
  const ncols = model.columns.length
  if (nrows === 0 || ncols === 0) return 'The table has no cells'
  const seen = new Set<string>()
  const grid = new Uint8Array(nrows * ncols)
  for (const c of cellsOf(model)) {
    // (an empty first field of a row of csv or dsv starts where the next field does: it differs in what it spans)
    const key = `${c.from}:${c.to}:${c.contentFrom}`
    if (seen.has(key)) return 'The table has cells that repeat (`3*`)'
    seen.add(key)
    if (c.row + c.rowspan > nrows || c.column + c.colspan > ncols) return 'A cell is outside of the table'
    for (let r = c.row; r < c.row + c.rowspan; r++)
      for (let k = c.column; k < c.column + c.colspan; k++) {
        if (grid[r * ncols + k]) return 'The table has cells that overlap'
        grid[r * ncols + k] = 1
      }
  }
  if (grid.some((v) => !v)) return 'The table has places no cell covers'
  return null
}

/** The node of a table: the `DelimitedBlock` that has a layout. */
export const isTableNode = (n: SyntaxNode): boolean =>
  n.name === 'DelimitedBlock' && !!n.tree?.prop(tableModel)
