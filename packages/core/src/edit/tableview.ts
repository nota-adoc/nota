/**
 * A table as the visual editor shows it: the rows of cells with their spans, the head, the widths, and what each cell holds.
 * A cell holds text (a cell with no `a` style, a paragraph of an `a` cell, or an item of a list in one), a table of the next
 * level, or a block the editor does not read (code, a warning, a list with blocks in its items …), which is shown as its source.
 */
import type { SyntaxNode } from '@lezer/common'
import type { NotaDocument } from '../document.js'
import { type TableCellModel, type TableCellStyle, type TableModel, tableModel } from '../nodes.js'
import { SIMPLE_CELL, aParagraphs, cellTextRange, contentNode, leadOf } from './cell.js'
import { readCell } from './read.js'
import type { BlockInfo, Reading } from './types.js'
import { cellsOf, irregular, isTableNode } from './tablecheck.js'

/** What a cell holds, block after block. */
export type CellBlock =
  /**
   * Text that is edited: all the text of the cell, or a paragraph of an `a` cell (`from`–`to` is its place in the text of the cell).
   * `readable`: the text stands in the source as it is (but for the blanks at the ends of its lines, which Asciidoctor cuts off) and is read like the text of a paragraph (see `cell.ts`); `reading` is
   * that reading (the cells of the text, with links, marks and roles), null where the text holds nothing to read (letters, blanks,
   * `, ; ! ?`) or is not read. Where there is a reading, a position of the text is a cell of it, and not a character of `text`.
   */
  | {
      readonly kind: 'text'
      readonly text: string
      readonly from: number
      readonly to: number
      readonly readable: boolean
      readonly reading: Reading | null
      /**
       * An item of a list of an `a` cell (the items of a list are blocks of text one after the other, `level` counts from 1): the
       * marker as written, the sign in its checkbox (' ', 'x', '*') or ''.
       */
      readonly item?: { readonly marker: string; readonly level: number; readonly checked: string } | undefined
      /** A block that is not in the text yet: the editor shows it for an item that was only started. */
      readonly draft?: boolean
    }
  /** A table of the next level. */
  | { readonly kind: 'table'; readonly table: TableView }
  /** A block the editor does not edit, as its source. */
  | { readonly kind: 'plate'; readonly src: string }

export interface CellView {
  /** The place of the cell in the text (what the operations on tables are given as `at`), and of its content. */
  readonly from: number
  readonly to: number
  readonly contentFrom: number
  readonly contentTo: number
  readonly row: number
  readonly column: number
  readonly colspan: number
  readonly rowspan: number
  readonly halign: 'left' | 'center' | 'right'
  readonly valign: 'top' | 'middle' | 'bottom'
  readonly style: TableCellStyle | null
  /** The cell is in the head of the table. */
  readonly head: boolean
  /** The text of the cell as Asciidoctor reads it. */
  readonly text: string
  /** The role of the fill of the cell (`cell-yellow`), or null. The text blocks start after its label. */
  readonly fill: string | null
  readonly blocks: readonly CellBlock[]
}

export interface TableView {
  /** The place of the block of the table in the text (the attributes and the title above it included). */
  readonly from: number
  readonly to: number
  /** 1 for a table of the document, 2–4 for a table in a cell. */
  readonly level: number
  readonly format: 'psv' | 'csv' | 'dsv'
  readonly nrows: number
  readonly ncols: number
  readonly headRows: number
  readonly footRows: number
  /** The width of each column in percent (0 for an automatic one), and whether the table has the width of the page. */
  readonly widths: readonly number[]
  /** The title above the table. */
  readonly caption: string
  /** The rows: the cells that start in them, in the order of the text. */
  readonly rows: readonly (readonly CellView[])[]
}

/** The text of a cell, or a paragraph of an `a` cell, in the view. The reading is made when it is asked for. */
function textBlock(
  doc: NotaDocument,
  c: TableCellModel,
  range: { from: number; to: number } | null,
  lead: number,
  end: number,
  item?: BlockInfo,
): CellBlock {
  const text = c.text
  const body = text.slice(lead, end)
  const block: CellBlock = {
    kind: 'text',
    text: body,
    from: lead,
    to: end,
    readable: range !== null,
    item: item && { marker: item.marker, level: item.level, checked: item.checked },
    get reading(): Reading | null {
      const r = range !== null && !SIMPLE_CELL.test(body) ? readCell(doc, range.from, range.to) : null
      Object.defineProperty(block, 'reading', { value: r })
      return r
    },
  }
  return block
}

function blocksOf(doc: NotaDocument, c: TableCellModel, format: string, level: number): CellBlock[] {
  const text = c.text
  // (the label of the fill is not shown: the first text starts after it)
  const lead = leadOf(c)
  const plain: CellBlock[] = [textBlock(doc, c, cellTextRange(doc, c, format), lead, text.length)]
  if (c.style !== 'asciidoc') return plain
  // (the places of the blocks in the tree are the places in the text of the cell only where the text stands in the source as it is:
  // the quotes of a field of a table `,===` are around it, an escaped bar would not be found)
  const whole: CellBlock[] = text.trim() === '' ? plain : [{ kind: 'plate', src: text }]
  const found = aParagraphs(doc, c)
  const node = found ? contentNode(doc, c.from) : null
  if (!found || !node) return whole
  const pieces = new Map<number, typeof found.paragraphs>()
  for (const p of found.paragraphs) pieces.set(p.child, [...(pieces.get(p.child) ?? []), p])
  const out: CellBlock[] = []
  for (let b = node.firstChild; b; b = b.nextSibling) {
    if (b.name === 'BlankLine' || b.name === 'Mark') continue
    const ps = pieces.get(b.from)
    if (ps) {
      // (a paragraph or an item is read where the text of the cell is the source as it is; the blocks of a table of another format stay text)
      for (const p of ps) {
        const range = format === 'psv' ? { from: found.map.toSrc(p.from), to: found.map.toSrc(p.to, true) } : null
        out.push(textBlock(doc, c, range, p.from, p.to, p.item))
      }
      continue
    }
    if (isTableNode(b)) {
      const model = b.tree!.prop(tableModel)!
      if (!irregular(model)) {
        const table = tableViewAt(doc, b.from, level + 1)
        if (table) {
          out.push({ kind: 'table', table })
          continue
        }
      }
    }
    const eol = doc.text.charCodeAt(b.to - 1) === 10 ? (doc.text.charCodeAt(b.to - 2) === 13 ? 2 : 1) : 0
    out.push({ kind: 'plate', src: doc.text.slice(b.from, b.to - eol) })
  }
  return out.length > 0 ? out : whole
}

/** The table whose block starts at `from` (or a table that holds the place), with `level` for the depth of it. Null where there is none. */
export function tableViewAt(doc: NotaDocument, from: number, level = 1): TableView | null {
  const model: TableModel | null = doc.tableAt(from)
  if (!model) return null
  const nrows = model.rows.head.length + model.rows.body.length + model.rows.foot.length
  const headRows = model.rows.head.length
  const rows: CellView[][] = Array.from({ length: nrows }, () => [])
  for (const c of cellsOf(model)) {
    rows[c.row]?.push({
      from: c.from,
      to: c.to,
      contentFrom: c.contentFrom,
      contentTo: c.contentTo,
      row: c.row,
      column: c.column,
      colspan: c.colspan,
      rowspan: c.rowspan,
      halign: c.halign,
      valign: c.valign,
      style: c.style,
      head: c.row < headRows,
      text: c.text,
      fill: c.fill ? c.fill.role : null,
      blocks: blocksOf(doc, c, model.format, level),
    })
  }
  let caption = ''
  for (let n: SyntaxNode | null = doc.tree.resolveInner(model.from, 1); n; n = n.parent)
    if (isTableNode(n) && n.from === model.from) {
      const t = n.getChild('BlockTitle')?.getChild('TitleText')
      if (t) caption = doc.text.slice(t.from, t.to)
      break
    }
  return {
    from: model.from,
    to: model.to,
    level,
    format: model.format,
    nrows,
    ncols: model.columns.length,
    headRows,
    footRows: model.rows.foot.length,
    widths: model.columns.map((col) => (col.autowidth ? 0 : col.width)),
    caption,
    rows,
  }
}
