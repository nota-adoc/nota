/**
 * The text of a cell of a table as a block of text. A cell with no `a` style whose text stands in the source as it is (no
 * escaped separator, no quotes of csv) is read like a paragraph: links, marks, roles show as they do there, and the
 * operations on text (typing, deleting, marks, links) work on it by the offsets of the document.
 */
import type { SyntaxNode } from '@lezer/common'
import type { NotaDocument } from '../document.js'
import { type TableCellModel, type TableModel } from '../nodes.js'
import { editableBlockAround, listOk, paragraphInfo, walkList } from './layout.js'
import { cellsOf, isTableNode } from './tablecheck.js'
import type { BlockInfo } from './types.js'

/** The place of the text of a cell in the document, and how much of the text of the cell lies before it (the label of a fill). */
export interface CellTextRange {
  readonly from: number
  readonly to: number
  readonly lead: number
  /** Where the range ends in the text of the cell (what stands after it, in an `a` cell, is other blocks). */
  readonly end: number
  /** The item of a list in an `a` cell this range is the text of (its marker, level, checkbox); none for a paragraph. */
  readonly item?: BlockInfo | undefined
}

/**
 * Text that holds no construct and cannot make one with a character of the same kind next to it: letters, digits, blanks and
 * `, ; ! ?`. A cell with such a text is not read (it is the text); anything else is.
 */
const SIMPLE_RX = /^[\p{L}\p{N}\p{M} ,;!?]*$/u

export const SIMPLE_CELL = {
  test(s: string): boolean {
    // (letters of the latin alphabet and blanks, the most of the text of a table, are told without the regular expression)
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i)
      if (!((c >= 97 && c <= 122) || (c >= 65 && c <= 90) || c === 32 || (c >= 48 && c <= 57))) return SIMPLE_RX.test(s)
    }
    return true
  },
}

/**
 * Where the text of a cell is read as source, or null for a cell that stays text: not a table of the format `psv`, a style that
 * changes how the text shows (`l`, `m`, `e`, `s`, `a`), a text that is not in the source as it is (an escaped separator), a
 * blank line inside.
 */
export function cellTextRange(doc: NotaDocument, c: TableCellModel, format: string): CellTextRange | null {
  if (format !== 'psv') return null
  if (c.style !== null && c.style !== 'none' && c.style !== 'header') return null
  return wholeRange(doc, c)
}

/** The `CellContent` node of the cell that starts at `from`, or null. */
export function contentNode(doc: NotaDocument, from: number): SyntaxNode | null {
  for (let n: SyntaxNode | null = doc.tree.resolveInner(from, 1); n; n = n.parent) {
    if (n.name === 'TableCell' && n.from === from) return n.getChild('CellContent')
    if (isTableNode(n)) break
  }
  return null
}

/** The lead of the text of a cell: the label of a fill and the blanks after it. */
export function leadOf(c: TableCellModel): number {
  return c.fill ? c.fill.to - c.fill.from + /^\s*/.exec(c.text.slice(c.fill.to - c.fill.from))![0].length : 0
}

/**
 * Where the text of a cell is in the source. Asciidoctor (and the reader of lines) cuts the blanks and tabs off the end of every
 * line, so `TableCellModel.text` has none, while the source may: a position of the text is told to a place of the source (and back)
 * by `toSrc`/`toText`.
 */
export interface CellMap {
  /** The place in the source of the position `p` of the text; `end`: where the text before `p` ends (before the blanks it may be followed by). */
  toSrc(p: number, end?: boolean): number
  /** The position of the text that is at the place `off` of the source (the blanks of the source count for nothing). */
  toText(off: number): number
}

/** The map of the text of the cell to its source, or null where the text is not in the source (an escaped bar, a quoted field). */
export function cellMap(
  doc: NotaDocument,
  c: { readonly text: string; readonly contentFrom: number; readonly contentTo: number },
): CellMap | null {
  // (the source without the blanks at the ends of its lines; `cuts`: where each run of blanks starts in the source, how long it is, and where it was in the rest)
  const cuts: number[][] = []
  let cut = 0
  const kept = doc.text.slice(c.contentFrom, c.contentTo).replace(/[ \t\r]+$/gm, (m, s: number) => {
    cuts.push([s, m.length, s - cut])
    cut += m.length
    return ''
  })
  const first = kept.indexOf(c.text)
  if (first < 0) return null
  const at = c.contentFrom
  return {
    toSrc: (p, end) => {
      const q = first + p
      return at + q + cuts.reduce((a, [, n, k]) => a + (k <= q - (end && p > 0 ? 1 : 0) ? n! : 0), 0)
    },
    toText: (off) => {
      const o = off - at
      return Math.max(0, o - first - cuts.reduce((a, [s, n]) => a + Math.min(n!, Math.max(0, o - s!)), 0))
    },
  }
}

/** A text block of an `a` cell: a plain paragraph, or an item of a list whose items hold nothing but text. */
export interface CellPiece {
  /** The start of the block of the cell (a paragraph, a list) it belongs to. */
  readonly child: number
  readonly from: number
  readonly to: number
  /** The item, in the coordinates of the document; none for a paragraph. */
  readonly item?: BlockInfo | undefined
}

/**
 * The text blocks of an `a` cell that are shown as text: the plain paragraphs (no attributes, no variant), and the items of the
 * lists whose items hold nothing but text. Each with its place in the text of the cell; and where the text of the cell starts in
 * the source. Null where the text of the cell is not in the source as it is.
 */
export function aParagraphs(
  doc: NotaDocument,
  c: TableCellModel,
): { map: CellMap; paragraphs: CellPiece[] } | null {
  const text = c.text
  const map = cellMap(doc, c)
  if (!map) return null
  const node = contentNode(doc, c.from)
  if (!node) return null
  const lead = leadOf(c)
  const paragraphs: CellPiece[] = []
  const place = (child: number, content: { from: number; to: number }, shown: number, item?: BlockInfo): void => {
    const to = map.toText(content.to)
    const from = Math.min(to, Math.max(map.toText(content.from), shown === 0 ? lead : 0))
    if (from >= 0 && to <= text.length && from <= to) paragraphs.push({ child, from, to, item })
  }
  let shown = 0
  for (let b = node.firstChild; b; b = b.nextSibling) {
    if (b.name === 'BlankLine' || b.name === 'Mark') continue
    if (b.name === 'Paragraph') {
      const info = paragraphInfo(b, doc.text)
      if (info && !info.meta && !info.variant && info.content) place(b.from, info.content, shown)
    } else if ((b.name === 'UnorderedList' || b.name === 'OrderedList') && listOk(b, doc.text, false)) {
      const items: BlockInfo[] = []
      walkList(b, doc.text, 1, (i) => items.push(i))
      for (const info of items) place(b.from, info.content!, shown, info)
    }
    shown++
  }
  return { map, paragraphs }
}

/** The places of the text blocks of the cell that are read as paragraphs: the text of a cell, or the paragraphs of an `a` cell. */
export function cellTextRanges(doc: NotaDocument, c: TableCellModel, format: string): CellTextRange[] {
  if (format !== 'psv') return []
  if (c.style === 'asciidoc') {
    const a = aParagraphs(doc, c)
    if (!a) return []
    return a.paragraphs.map((p) => ({
      from: a.map.toSrc(p.from),
      to: a.map.toSrc(p.to, true),
      lead: p.from,
      end: p.to,
      item: p.item,
    }))
  }
  const r = cellTextRange(doc, c, format)
  return r ? [r] : []
}

function wholeRange(doc: NotaDocument, c: TableCellModel): CellTextRange | null {
  const text = c.text
  const map = cellMap(doc, c)
  if (!map) return null
  const lead = leadOf(c)
  const body = text.slice(lead)
  if (body.includes('\r')) return null
  if (body.includes('\n') && body.split('\n').some((l) => l.trim() === '')) return null
  const from = map.toSrc(lead)
  return { from, to: map.toSrc(text.length, true), lead, end: text.length }
}

const NONE = {
  meta: null,
  level: 0,
  marker: '',
  markerFrom: -1,
  label: 'Cell',
  eol: '',
  variant: '',
  checked: '',
  fence: '',
  box: '',
  title: '',
  startsOpen: false,
  lang: '',
  target: '',
} as const

/** The text of a cell as a block of text. */
export function cellBlock(c: TableCellModel, r: CellTextRange): BlockInfo {
  // (an item keeps its marker and level; the range of the text is the one of the cell)
  return {
    ...NONE,
    kind: 'paragraph',
    from: r.from,
    to: r.to,
    ...r.item,
    content: { from: r.from, to: r.to },
    inCell: { at: c.contentFrom },
  }
}

/** The cell of `model` whose text holds `offset` (the ends included), as a block of text; null where there is none. */
function cellOf(doc: NotaDocument, model: TableModel, offset: number): BlockInfo | null {
  for (const c of cellsOf(model)) {
    if (c.contentFrom > offset || offset > c.contentTo) continue
    for (const r of cellTextRanges(doc, c, model.format)) if (r.from <= offset && offset <= r.to) return cellBlock(c, r)
    return null
  }
  return null
}

/** The text of the cell that holds `offset` as a block of text, or null (not in a cell, or a cell that is not read as text). */
export function cellBlockAround(doc: NotaDocument, offset: number): BlockInfo | null {
  const model = doc.tableAt(offset)
  return model ? cellOf(doc, model, offset) : null
}

/** The text of the cell whose content starts at `at` (of its paragraph that starts at `from`, in an `a` cell; else the first), or null. */
export function cellBlockAt(doc: NotaDocument, at: number, from?: number): BlockInfo | null {
  const model = doc.tableAt(at)
  if (!model) return null
  for (const c of cellsOf(model)) {
    if (c.contentFrom !== at) continue
    const rs = cellTextRanges(doc, c, model.format)
    const r = from === undefined ? rs[0] : rs.find((x) => x.from === from)
    return r ? cellBlock(c, r) : null
  }
  return null
}

/**
 * The text of the cell that holds all of `from`–`to`: the block, or `none` when the range is not in the text of one cell
 * (it reaches over cells, or out of the table, or into a cell that is not read).
 */
export function cellBlockOver(doc: NotaDocument, from: number, to: number): BlockInfo | 'none' {
  const b = cellBlockAround(doc, from)
  return b && to <= b.content!.to ? b : 'none'
}

/** The paragraph, heading or item that holds `offset`, else the text of the cell that does: where text is typed, marked, linked. */
export function inlineBlockAround(doc: NotaDocument, offset: number): BlockInfo | null {
  return editableBlockAround(doc, offset) ?? cellBlockAround(doc, offset)
}

/**
 * What the `a` cell that starts at `at` holds outside `lo`–`hi`, block by block: a paragraph or an item by its kind, any other
 * block by its source (a text block that touches the range is the one edited). Null where the cell is not read; undefined for a
 * cell without the `a` style.
 */
function blocksOutside(doc: NotaDocument, at: number, lo: number, hi: number): string[] | null | undefined {
  const model = doc.tableAt(at)
  const c = model && cellsOf(model).find((x) => x.contentFrom === at)
  if (!c || c.style !== 'asciidoc') return undefined
  const found = aParagraphs(doc, c)
  const node = contentNode(doc, c.from)
  if (!found || !node) return null
  const out: string[] = []
  for (let b = node.firstChild; b; b = b.nextSibling) {
    if (b.name === 'BlankLine' || b.name === 'Mark') continue
    const ps = found.paragraphs.filter((p) => p.child === b.from)
    if (!ps.length) {
      // (the range is the text of a paragraph or an item: it cannot touch another kind of block)
      out.push(b.name + ':' + doc.text.slice(b.from, b.to))
      continue
    }
    for (const p of ps)
      if (found.map.toSrc(p.from) > hi || found.map.toSrc(p.to, true) < lo)
        out.push(`${p.item?.level} ${p.item?.marker}`)
  }
  return out
}

/**
 * True when an edit of the text `from`–`to` of the `a` cell that starts at `at` (`to` moves with the length of the text) left the other
 * blocks of the cell as they were: the same blocks of text of the same kinds and the same sources of the rest. The text block that
 * was edited may read as something else (that is for the check of the text itself).
 */
export function cellBlocksKept(
  doc: NotaDocument,
  next: NotaDocument,
  at: number,
  from: number,
  to: number,
): boolean {
  const a = blocksOutside(doc, at, from, to)
  if (a === undefined) return true
  const b = blocksOutside(next, at, from, to + next.text.length - doc.text.length)
  return JSON.stringify(a) === JSON.stringify(b)
}
