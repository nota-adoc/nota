/**
 * The projection: the ProseMirror document of a Nota document. Paragraphs and headings become text with marks,
 * what the editor does not edit becomes plates, blank lines become empty paragraphs.
 */
import type { NotaDocument } from '@nota-adoc/core'
import {
  type Cell,
  type Item,
  type Span,
  type TableView,
  TOC_PINNED,
  impliedMark,
  layoutItems,
  readInline,
  readLayout,
  tableViewAt,
} from '@nota-adoc/core/internal'
import { type Mark, type Node as PMNode, Mark as PMMark } from 'prosemirror-model'
import { DIAGRAM, diagramItems, diagramName } from './diagram.js'
import { schema } from './schema.js'
import { explicitWidths } from './tablegrips.js'
import { type CellDraft, withCellDraft } from './tablepos.js'

/**
 * The lines above a block, split by the parse tree: the anchors (a line with nothing but an id: `[[id]]`, `[[id, text]]`,
 * `[#id]`, `[id=…]`) as their ids, and the text of all other lines (`.Title`, `[role]`, `[#id.role]` …).
 */
export function splitMeta(doc: NotaDocument, from: number, to: number): { plain: string | null; anchor: string | null } {
  const text = doc.text
  const ids: string[] = []
  let plain = ''
  let at = from
  doc.tree.iterate({
    from,
    to,
    enter: (n) => {
      if (n.name !== 'BlockAnchor' && n.name !== 'BlockAttributes' && n.name !== 'BlockTitle') return undefined
      if (n.from < from || n.to > to) return false
      const id = anchorIdOf(n.node, text)
      if (id !== null) {
        plain += text.slice(at, n.from)
        at = n.to
        ids.push(id)
      }
      return false
    },
  })
  if (!ids.length) return { plain: text.slice(from, to), anchor: null }
  plain += text.slice(at, to)
  return { plain: plain === '' ? null : plain, anchor: ids.join(' ') }
}

/** The id of a line of metadata that holds an id and nothing else, else null. */
function anchorIdOf(node: SyntaxNode, text: string): string | null {
  if (node.name === 'BlockAnchor') {
    const id = node.getChild('AnchorId')
    return id ? text.slice(id.from, id.to) : null
  }
  if (node.name !== 'BlockAttributes') return null
  let found: string | null = null
  for (let c = node.firstChild; c; c = c.nextSibling) {
    if (c.name === 'Mark' || c.name === 'Newline') continue
    if (found !== null) return null
    if (c.name === 'PositionalAttribute') {
      const k = c.firstChild
      if (!k || k.name !== 'ShorthandId' || k.nextSibling || k.from !== c.from || k.to !== c.to) return null
      found = text.slice(k.from + 1, k.to)
    } else if (c.name === 'NamedAttribute') {
      const name = c.getChild('AttributeName')
      const value = c.getChild('AttributeValue')
      if (!name || !value || text.slice(name.from, name.to) !== 'id') return null
      found = text.slice(value.from, value.to).replace(/^(["'])(.*)\1$/s, '$2')
    } else return null
  }
  return found === '' ? null : found
}

type SyntaxNode = NotaDocument['tree']['topNode']

const markCache = new Map<string, Mark>()

function markOf(type: string, arg: string | null): Mark {
  const key = arg === null ? type : `${type}:${arg}`
  let m = markCache.get(key)
  if (!m) {
    m = schema.marks[type]!.create(type === 'link' ? { href: arg } : type === 'roles' ? { attrs: arg } : null)
    if (markCache.size > 5000) markCache.clear()
    markCache.set(key, m)
  }
  return m
}

/** The marks of a stack of spans (the cells of a span share the array), kept while the array lives. */
const stackMarks = new WeakMap<readonly Span[], readonly Mark[]>()

/** The marks of a cell as a ProseMirror mark set. */
function marksOf(cell: Cell): readonly Mark[] {
  if (cell.spans.length === 0) return PMMark.none
  let hit = stackMarks.get(cell.spans)
  if (!hit) stackMarks.set(cell.spans, (hit = marksOfStack(cell.spans)))
  return hit
}

function marksOfStack(spans: readonly Span[]): readonly Mark[] {
  let set: readonly Mark[] = PMMark.none
  for (const s of spans) {
    // (the text of `pass:q[…]` and `((…))` is shown as text; that it is not edited is the engine's to say)
    if (s.type === 'lock') continue
    if (s.type === 'roles') {
      // `[.zz-a]*x*`: the roles, and bold as well
      const implied = impliedMark(s)
      if (implied) set = markOf(implied, null).addToSet(set)
      set = markOf('roles', s.attrs).addToSet(set)
    } else set = markOf(s.type, s.href).addToSet(set)
  }
  return set
}

/** The inline content of a paragraph or heading: text with marks, hard breaks, plates. */
export function projectCells(cells: readonly Cell[]): PMNode[] {
  const out: PMNode[] = []
  let run = ''
  let runMarks: readonly Mark[] = PMMark.none
  const flush = (): void => {
    if (run) out.push(schema.text(run, runMarks))
    run = ''
  }
  for (const cell of cells) {
    const marks = marksOf(cell)
    if (cell.kind === 'char') {
      if (run && !PMMark.sameSet(marks, runMarks)) flush()
      runMarks = marks
      run += cell.ch
    } else {
      flush()
      out.push(
        cell.kind === 'break'
          ? schema.nodes.hard_break!.create(null, null, marks)
          : schema.nodes.inline_chip!.create({ text: cell.src }, null, marks),
      )
    }
  }
  flush()
  return out
}

const isOrderedMarker = (marker: string): boolean => /^(\.+|\d+\.)$/.test(marker)

const alpha = (n: number, upper: boolean): string => {
  let s = ''
  for (let k = n; k > 0; k = Math.floor((k - 1) / 26)) s = String.fromCharCode(97 + ((k - 1) % 26)) + s
  return upper ? s.toUpperCase() : s
}
const ROMAN: [number, string][] = [
  [1000, 'm'],
  [900, 'cm'],
  [500, 'd'],
  [400, 'cd'],
  [100, 'c'],
  [90, 'xc'],
  [50, 'l'],
  [40, 'xl'],
  [10, 'x'],
  [9, 'ix'],
  [5, 'v'],
  [4, 'iv'],
  [1, 'i'],
]
const roman = (n: number, upper: boolean): string => {
  let s = ''
  for (const [v, r] of ROMAN) {
    while (n >= v) {
      s += r
      n -= v
    }
  }
  return upper ? s.toUpperCase() : s
}

/** The number an item of a numbered list is shown with, as Asciidoctor numbers it: 1. 2. / a. b. / i. ii. / A. B. / I. II. */
export function numberLabel(n: number, level: number): string {
  switch (level) {
    case 2:
      return alpha(n, false) + '.'
    case 3:
      return roman(n, false) + '.'
    case 4:
      return alpha(n, true) + '.'
    case 5:
      return roman(n, true) + '.'
    default:
      return n + '.'
  }
}

/** The numbers the items are shown with, given the marker and the level of each block that is an item (null for a block that is not). */
function numbersOf(entries: readonly ({ marker: string; level: number } | null)[]): string[] {
  const out: string[] = []
  const count: number[] = []
  const ordered: boolean[] = []
  for (const b of entries) {
    if (!b) {
      count.length = 0
      ordered.length = 0
      out.push('')
      continue
    }
    const L = b.level
    const o = isOrderedMarker(b.marker)
    count.length = L
    ordered.length = L
    if (count[L - 1] === undefined || ordered[L - 1] !== o) count[L - 1] = 0
    ordered[L - 1] = o
    count[L - 1] = count[L - 1]! + 1
    // Asciidoctor picks the style of the numbers by the dots of the marker, not by the depth of the item
    // (`. b` under `* a` is «1.»): an explicit `1.` is arabic
    const style = /^\.+$/.test(b.marker) ? b.marker.length : 1
    out.push(o ? numberLabel(count[L - 1]!, style) : '')
  }
  return out
}

/** The numbers the items are shown with ('' for an item of a bulleted list and for what is not an item). */
export function itemNumbers(items: readonly Item[]): string[] {
  return numbersOf(items.map((it) => (it.kind === 'item' ? it.block! : null)))
}

/** The node of a table: rows of cells, each with the blocks it holds. */
export function projectTable(view: TableView, text = ''): PMNode {
  const n = schema.nodes
  const rows = view.rows.map((row) =>
    n.table_row!.create(
      null,
      row.map((c) => {
        // (the items of a list of the cell are numbered as the items of a list of the document are)
        const nums = numbersOf(c.blocks.map((b) => (b.kind === 'text' && b.item ? b.item : null)))
        const blocks = c.blocks.map((b, i) =>
          b.kind === 'text'
            ? n.cell_text!.create(
                {
                  rich: b.readable,
                  ...(b.item
                    ? {
                        item: true,
                        ordered: isOrderedMarker(b.item.marker),
                        level: b.item.level,
                        num: nums[i]!,
                        checked: b.item.checked,
                        draft: b.draft === true,
                      }
                    : {}),
                },
                b.reading ? projectCells(b.reading.cells) : b.text === '' ? null : schema.text(b.text),
              )
            : b.kind === 'table'
              ? projectTable(b.table, text)
              : n.cell_plate!.create({ src: b.src }),
        )
        return n.table_cell!.create(
          {
            row: c.row,
            col: c.column,
            colspan: c.colspan,
            rowspan: c.rowspan,
            head: c.head,
            halign: c.halign,
            valign: c.valign,
            asciidoc: c.style === 'asciidoc',
            fill: c.fill,
          },
          blocks,
        )
      }),
    ),
  )
  return n.table!.create({ level: view.level, caption: view.caption, widths: view.widths, head: view.headRows > 0, fixed: text !== '' && explicitWidths(text.slice(view.from, Math.min(view.to, view.from + 2000))) }, rows)
}

/** The node an item of a document is shown as (`num`: the number of an item of a numbered list, from `itemNumbers`). */
export function projectItem(doc: NotaDocument, item: Item, num = '', draft?: CellDraft): PMNode {
  if (item.kind === 'empty') return schema.nodes.paragraph!.create()
  const b = item.block!
  if (item.kind === 'table') {
    const view = tableViewAt(doc, item.from)
    if (view) return projectTable(draft ? withCellDraft(view, draft) : view, doc.text)
    // (a table that cannot be read as a grid: its source)
    const src = doc.text.slice(b.content!.from, b.content!.to).replace(/\r\n/g, '\n')
    return schema.nodes.island!.create({ kind: b.label }, src === '' ? null : schema.text(src))
  }
  if (item.kind === 'chip' || item.kind === 'code' || item.kind === 'image') {
    const text = doc.text.slice(b.content!.from, b.content!.to).replace(/\r\n/g, '\n')
    const content = text === '' ? null : schema.text(text)
    if (item.kind === 'chip' && b.label === DIAGRAM) {
      const eol = doc.text.indexOf('\n', item.from)
      const head = doc.text.slice(item.from, eol < 0 ? item.to : eol).replace(/\r$/, '')
      return schema.nodes.diagram!.create({ name: diagramName(head) }, content)
    }
    if (item.kind === 'chip') return schema.nodes.island!.create({ kind: b.label }, content)
    if (item.kind === 'code') return schema.nodes.code_block!.create({ lang: b.lang }, content)
    // (the caption of an image that has none is empty: the content range is a point)
    return schema.nodes.image!.create({ target: b.target }, b.content!.from < b.markerFrom ? content : null)
  }
  if (item.kind === 'fence' && b.fence === 'meta') return schema.nodes.page_meta!.create()
  if (item.kind === 'fence' && b.fence === 'toc')
    return (b.label === TOC_PINNED ? schema.nodes.toc_pinned! : schema.nodes.toc!).create()
  if (item.kind === 'fence')
    return b.fence === 'open'
      ? schema.nodes.box_head!.create({ box: b.box, variant: b.variant, title: b.title, startsOpen: b.startsOpen })
      : schema.nodes.box_end!.create()
  const cells = readInline(doc, b.content!.from, b.content!.to).cells
  const meta = b.meta ? doc.text.slice(b.meta.from, b.meta.to) : null
  const split = b.meta ? splitMeta(doc, b.meta.from, b.meta.to) : null
  const shown = { meta, plain: split ? split.plain : null, anchor: split ? split.anchor : null }
  const content = projectCells(cells)
  if (item.kind === 'item')
    return schema.nodes.list_item!.create(
      { ordered: isOrderedMarker(b.marker), level: b.level, num, checked: b.checked, draft: b.label === 'Draft' },
      content,
    )
  if (item.kind === 'heading')
    return schema.nodes.heading!.create({ level: b.level, ...shown, draft: b.label === 'Draft' }, content)
  if (b.variant) return schema.nodes.admonition_paragraph!.create({ variant: b.variant, ...shown }, content)
  return schema.nodes.paragraph!.create(shown, content)
}

/** The nodes of the items of a document, in order. */
export function projectItems(doc: NotaDocument, items: readonly Item[]): PMNode[] {
  const nums = itemNumbers(items)
  return items.map((it, i) => projectItem(doc, it, nums[i]))
}

/** The ProseMirror document of a Nota document: what the visual editor shows, built from nothing. */
export function projectDocument(doc: NotaDocument): PMNode {
  const items = diagramItems(doc, layoutItems(readLayout(doc)))
  return schema.nodes.doc!.create(null, projectItems(doc, items))
}
