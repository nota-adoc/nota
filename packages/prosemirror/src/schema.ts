/**
 * The schema of the visual editor. Paragraphs and headings hold text with marks; everything else the editor does
 * not edit is a plate (`block_chip`, `inline_chip`) that shows its source as it is.
 */
import { roleNames } from '@nota-adoc/core/internal'
import { type DOMOutputSpec, type MarkSpec, type NodeSpec, Schema } from 'prosemirror-model'
import { canonicalLanguage } from './languages.js'
import { DIAGRAM_SAMPLE_CODE } from './diagram.js'

/**
 * The words the editor shows around the text that are not in the document: the label of a checkbox, the type of an
 * admonition, the title of a collapsible block that has none. The host sets them (`setLabels`) for its language.
 */
export interface Labels {
  readonly checkItem: string
  readonly details: string
  readonly admonition: Readonly<Record<'NOTE' | 'TIP' | 'IMPORTANT' | 'WARNING' | 'CAUTION', string>>
  /** The name of a language over a block of code, by its id (`javascript`); `text` is the one of code with no language. */
  readonly languages?: Readonly<Record<string, string>>
  /** The hint in an image caption that has no text. */
  readonly captionPlaceholder?: string
  /** The plate of an image whose file is not there; `{path}` is the path as written. */
  readonly imageMissing?: string
  /** The plate of an image from the network, which is not shown. */
  readonly imageRemote?: string
  /** The line over an island, a block shown as the source of AsciiDoc. */
  readonly islandNote?: string
  /** The first line of the tip of the plate of an anchor (`[#id]` over a block), shown when the host asks to show anchors. */
  readonly anchorTip?: string
  /** The line over the island of the header of a page that is open for editing, over the one after the title, and its button. */
  readonly pageMetaNote?: string
  readonly pageMetaTailNote?: string
  /** The line over the island of the header after the link «Open in Confluence», and the label of the narrow line `toc::[]`. */
  readonly pageMetaBodyNote?: string
  readonly tocNote?: string
  readonly pageMetaCollapse?: string
  /** The line under an island whose text was not written to the file. */
  readonly islandUnsaved?: string
  /** The words around the picture of a diagram (see `DiagramView`). */
  readonly diagramTitle?: string
  readonly diagramHint?: string
  readonly diagramEditHint?: string
  readonly diagramDrawing?: string
  readonly diagramKept?: string
  readonly diagramFailed?: string
  readonly diagramFailedHint?: string
  readonly diagramFailedBar?: string
  readonly diagramNoRenderer?: string
  readonly diagramNoRendererHint?: string
  /** The code of the flowchart that the block «Mermaid» puts in (the labels in the language of the page). */
  readonly diagramSample?: string
  /** The hints of the layer over a table: the grip of a column, of a row, a border between columns; the mark at the least width. */
  readonly gripColumn?: string
  readonly gripRow?: string
  readonly gripBorder?: string
  readonly widthLimit?: string
  /** the name of the scroll bar of a wide table (for a screen reader). */
  readonly tableScroll?: string
  /** the names of the grips (`{n}`, `{a}`, `{b}` are numbers from 1) and of the buttons of the bar at a grip (`{n}` is the number of lines). */
  readonly gripColumns?: string
  readonly gripRows?: string
  readonly barColBefore?: string
  readonly barColAfter?: string
  readonly barColDelete?: string
  readonly barColsDelete?: string
  readonly barRowBefore?: string
  readonly barRowAfter?: string
  readonly barRowDelete?: string
  readonly barRowsDelete?: string
  readonly widthFrame?: string
}

/** The narrow line of `toc::[]`: an icon, the label, a dotted rule, and the macro in grey (`aria-label` is the label). */
function tocDOM(pinned: boolean): DOMOutputSpec {
  return [
    'div',
    { class: pinned ? 'nota-toc pinned' : 'nota-toc', contenteditable: 'false', role: 'note', 'aria-label': labels.tocNote },
    ['span', { class: 'toc-icon', 'aria-hidden': 'true' }],
    ['span', { class: 'toc-label' }, labels.tocNote],
    ['span', { class: 'toc-rule', 'aria-hidden': 'true' }],
    ['span', { class: 'toc-src', 'aria-hidden': 'true' }, 'toc::[]'],
  ]
}

export const ENGLISH_LABELS: Required<Labels> = {
  checkItem: 'Check item',
  details: 'Details',
  admonition: { NOTE: 'Note', TIP: 'Tip', IMPORTANT: 'Important', WARNING: 'Warning', CAUTION: 'Caution' },
  languages: {
    text: 'Text',
    bash: 'Bash',
    css: 'CSS',
    html: 'HTML',
    java: 'Java',
    javascript: 'JavaScript',
    json: 'JSON',
    python: 'Python',
    sql: 'SQL',
    typescript: 'TypeScript',
    xml: 'XML',
    yaml: 'YAML',
  },
  captionPlaceholder: 'Image caption',
  imageMissing: 'No file {path}',
  imageRemote: 'An image from the network is not shown',
  islandNote: 'As in the file — edited as text',
  anchorTip: 'Anchor · edited in the Text mode',
  pageMetaNote: 'Page header — edited as text',
  pageMetaTailNote: 'Page header, after the title',
  pageMetaBodyNote: 'Page header, after the link',
  tocNote: 'Table of contents',
  pageMetaCollapse: 'Collapse',
  islandUnsaved: 'Not saved: this text changes the blocks around it',
  diagramTitle: 'Mermaid',
  diagramHint: 'Click to edit the code',
  diagramEditHint: 'The picture updates after a pause · Esc — picture only',
  diagramDrawing: 'Drawing the diagram…',
  diagramKept: 'The diagram could not be parsed. The last good picture is shown.',
  diagramFailed: 'The diagram could not be drawn',
  diagramFailedHint: 'Click to edit the code',
  diagramFailedBar: 'Error in the diagram code',
  diagramNoRenderer: 'Diagrams are not drawn: the renderer did not load',
  diagramNoRendererHint: 'The code can be edited. To try again, close the tab and open the file again.',
  diagramSample: DIAGRAM_SAMPLE_CODE,
  gripColumn: 'Column {n}',
  gripRow: 'Row {n}',
  gripBorder: 'Column width: drag · double-click — equal',
  widthLimit: 'Minimum width',
  tableScroll: 'Scroll the table sideways',
  gripColumns: 'Columns {a}–{b}',
  gripRows: 'Rows {a}–{b}',
  barColBefore: 'Add a column to the left',
  barColAfter: 'Add a column to the right',
  barColDelete: 'Delete the column',
  barColsDelete: 'Delete columns: {n}',
  barRowBefore: 'Add a row above',
  barRowAfter: 'Add a row below',
  barRowDelete: 'Delete the row',
  barRowsDelete: 'Delete rows: {n}',
  widthFrame: 'Frame width',
}

let labels: Required<Labels> = ENGLISH_LABELS

/** Sets the words of the editor (all editors of the page share them: a page has one language). */
export function setLabels(next: Labels): void {
  labels = { ...ENGLISH_LABELS, ...Object.fromEntries(Object.entries(next).filter(([, v]) => v !== undefined)) } as Required<Labels>
}

export const getLabels = (): Required<Labels> => labels

const SVG = 'http://www.w3.org/2000/svg'
const dot = (x: number, y: number): DOMOutputSpec => [`${SVG} circle`, { cx: String(x), cy: String(y), r: '1', fill: 'currentColor', stroke: 'none' }]
const path = (d: string): DOMOutputSpec => [`${SVG} path`, { d }]
const ICONS: Record<string, DOMOutputSpec[]> = {
  NOTE: [[`${SVG} circle`, { cx: '8', cy: '8', r: '6' }], path('M8 7.2v4'), dot(8, 5)],
  TIP: [
    path(
      'M6 12.8h4M6.6 14.6h2.8M8 1.6a4.2 4.2 0 00-2.5 7.6c.6.4.9 1 .9 1.8h3.2c0-.8.3-1.4.9-1.8A4.2 4.2 0 008 1.6z',
    ),
  ],
  IMPORTANT: [path('M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.5l-3.8 2.1.7-4.3-3.1-3 4.3-.6z')],
  WARNING: [path('M8 2.2l6.2 11H1.8z'), path('M8 6.4v3.2'), dot(8, 11.4)],
  CAUTION: [path('M5.5 1.8h5l3.7 3.7v5l-3.7 3.7h-5l-3.7-3.7v-5z'), path('M8 5v3.6'), dot(8, 11)],
  CHEVRON: [path('M6 3.5L10.5 8 6 12.5')],
  CHECK: [path('M3.5 8.4l3 3 6-6.6')],
}

/** An icon of the page as an element (`aria-hidden`). */
const icon = (name: string, cls: string): DOMOutputSpec => [
  `${SVG} svg`,
  {
    class: cls,
    viewBox: '0 0 16 16',
    width: '16',
    height: '16',
    'aria-hidden': 'true',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '1.5',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
  },
  ...(ICONS[name] ?? []),
]

const BULLETS = ['•', '◦', '▪']

/** The name over a block of code: the one of the language of the list, else the word as written, else the one of plain text. */
export function languageLabel(word: string): string {
  const id = canonicalLanguage(word)
  if (id) return labels.languages[id] ?? id
  return word
}

/** The attributes of an item of a list (a node of the document, or a block of text of a cell). */
interface ItemAttrs {
  ordered: boolean
  level: number
  num: string
  checked: string
  draft: boolean
}

/** The marker of an item and the box of its checkbox. */
function itemMark(a: ItemAttrs): DOMOutputSpec[] {
  const on = a.checked !== '' && a.checked !== ' '
  const mark: DOMOutputSpec[] = [
    ['span', { class: 'mk', contenteditable: 'false' }, a.ordered ? a.num : (BULLETS[(a.level - 1) % BULLETS.length] ?? '•')],
  ]
  if (a.checked !== '')
    mark.push([
      'span',
      {
        class: on ? 'chk on' : 'chk',
        role: 'checkbox',
        'aria-checked': on ? 'true' : 'false',
        'aria-label': labels.checkItem,
        title: labels.checkItem,
        contenteditable: 'false',
      },
      icon('CHECK', 'chk-tick'),
    ])
  return mark
}

/** The element of an item: its classes (`extra` before them), its level. */
function itemAttrs(a: ItemAttrs, extra: string): Record<string, string> {
  const on = a.checked !== '' && a.checked !== ' '
  return {
    class: `${extra} ${a.ordered ? 'li-ol' : 'li-ul'}${on ? ' done' : ''}${a.draft ? ' nota-draft' : ''}`,
    'data-level': String(a.level),
    style: `--lvl:${a.level - 1}`,
  }
}

/** The lines above a block that are not anchors, for the CSS `[data-meta]::before` (the anchors are drawn by the widgets of the editor). */
function plainMeta(attrs: Record<string, unknown>): Record<string, string> {
  return attrs.plain ? { 'data-meta': attrs.plain as string } : {}
}

const nodes: Record<string, NodeSpec> = {
  doc: { content: 'block+' },
  paragraph: {
    group: 'block',
    content: 'inline*',
    // lines above the paragraph in the source (`[[id]]`, `.Title`, `[role]`), shown grey over it
    // `meta` is all of them, as in the file; `plain` those that are not anchors (shown), `anchor` the ids of the anchors
    attrs: { meta: { default: null }, plain: { default: null }, anchor: { default: null } },
    toDOM: (node): DOMOutputSpec => [
      'p',
      plainMeta(node.attrs),
      0,
    ],
  },
  heading: {
    group: 'block',
    content: 'inline*',
    defining: true,
    // 1 for the title of the document, 2–6 for sections of level 1–5
    attrs: { level: { default: 2 }, meta: { default: null }, plain: { default: null }, anchor: { default: null }, draft: { default: false } },
    toDOM: (node): DOMOutputSpec => [
      `h${node.attrs.level as number}`,
      {
        ...plainMeta(node.attrs),
        ...(node.attrs.draft ? { class: 'nota-draft' } : {}),
      },
      0,
    ],
  },
  // an item of a list: flat, with its level (a Tab changes the attribute); `num` is the number it is shown with, `checked`
  // the sign in its checkbox (' ', 'x', '*') or '' when it has none; `draft` an item that is not in the text yet
  list_item: {
    group: 'block',
    content: 'inline*',
    defining: true,
    attrs: {
      ordered: { default: false },
      level: { default: 1 },
      num: { default: '' },
      checked: { default: '' },
      draft: { default: false },
    },
    toDOM: (node): DOMOutputSpec => {
      const a = node.attrs as ItemAttrs
      return ['div', itemAttrs(a, 'li'), ...itemMark(a), ['div', { class: 'li-text' }, 0]]
    },
  },
  // the text of `NOTE: …`: the type is shown as a word in front of the text
  admonition_paragraph: {
    group: 'block',
    content: 'inline*',
    attrs: { variant: { default: 'NOTE' }, meta: { default: null }, plain: { default: null }, anchor: { default: null } },
    toDOM: (node): DOMOutputSpec => {
      const v = node.attrs.variant as keyof Labels['admonition']
      return [
        'div',
        {
          class: `adm adm-para adm-${v}`,
          'data-variant': v,
          ...plainMeta(node.attrs),
        },
        ['span', { class: 'adm-ico', contenteditable: 'false' }, icon(v, 'i')],
        ['span', { class: 'adm-lbl', contenteditable: 'false' }, `${labels.admonition[v] ?? v}.`],
        ['div', { class: 'adm-text' }, 0],
      ]
    },
  },
  // the first line of a box (an admonition block or a collapsible one): everything above the blocks it holds
  box_head: {
    group: 'block',
    atom: true,
    selectable: false,
    attrs: { box: { default: 'admonition' }, variant: { default: '' }, title: { default: '' }, startsOpen: { default: false } },
    toDOM: (node): DOMOutputSpec => {
      const a = node.attrs as { box: string; variant: keyof Labels['admonition']; title: string }
      if (a.box === 'collapsible')
        return [
          'button',
          { type: 'button', class: 'coll-head', 'aria-expanded': 'false', contenteditable: 'false' },
          icon('CHEVRON', 'chev'),
          ['span', { class: 'coll-title' }, a.title || labels.details],
        ]
      return [
        'div',
        { class: 'adm-head', contenteditable: 'false' },
        ['span', { class: 'adm-ico' }, icon(a.variant, 'i')],
        ['span', { class: 'adm-lbl' }, labels.admonition[a.variant] ?? a.variant],
      ]
    },
  },
  // the last line of a box
  box_end: {
    group: 'block',
    atom: true,
    selectable: false,
    toDOM: (): DOMOutputSpec => ['div', { class: 'box-end', contenteditable: 'false' }],
  },
  // the header of a page kept out of sight: no text, no place for a cursor, never part of a selection that is typed over
  page_meta: {
    group: 'block',
    atom: true,
    selectable: false,
    toDOM: (): DOMOutputSpec => ['div', { class: 'nota-page-meta', contenteditable: 'false', style: 'display:none' }],
  },
  // the line `toc::[]` as a narrow plate: an atom with no text and no place for a cursor; `toc_pinned` is the one in the zone of
  // the header (it cannot be selected or deleted)
  toc: {
    group: 'block',
    atom: true,
    draggable: false,
    toDOM: (): DOMOutputSpec => tocDOM(false),
  },
  toc_pinned: {
    group: 'block',
    atom: true,
    selectable: false,
    toDOM: (): DOMOutputSpec => tocDOM(true),
  },
  // an island: a block the editor does not read, shown and edited as its source (`unsaved`: the text is not in the file)
  island: {
    group: 'block',
    content: 'text*',
    marks: '',
    code: true,
    defining: true,
    isolating: true,
    attrs: { kind: { default: '' }, unsaved: { default: false } },
    toDOM: (node): DOMOutputSpec => [
      'div',
      {
        class: node.attrs.unsaved ? 'nota-island unsaved' : 'nota-island',
        'data-kind': node.attrs.kind as string,
      },
      node.attrs.kind === 'PageMeta' || node.attrs.kind === 'PageMetaTail' || node.attrs.kind === 'PageMetaBody'
        ? ([
            'div',
            { class: 'island-note', contenteditable: 'false' },
            [
              'span',
              {},
              node.attrs.kind === 'PageMeta'
                ? labels.pageMetaNote
                : node.attrs.kind === 'PageMetaBody'
                  ? labels.pageMetaBodyNote
                  : labels.pageMetaTailNote,
            ],
            ['button', { type: 'button', class: 'island-collapse', tabindex: '-1' }, labels.pageMetaCollapse],
          ] as DOMOutputSpec)
        : (['div', { class: 'island-note', contenteditable: 'false' }, labels.islandNote] as DOMOutputSpec),
      ['pre', { class: 'island-src' }, 0],
      ...(node.attrs.unsaved
        ? ([['div', { class: 'island-unsaved', contenteditable: 'false', role: 'alert' }, labels.islandUnsaved]] as DOMOutputSpec[])
        : []),
    ],
  },
  // a diagram: a Mermaid block shown as a picture (the node holds the code between the delimiters; `DiagramView` draws it)
  diagram: {
    group: 'block',
    content: 'text*',
    marks: '',
    code: true,
    defining: true,
    isolating: true,
    attrs: { name: { default: '' } },
    toDOM: (node): DOMOutputSpec => [
      'div',
      { class: 'nota-diagram', 'data-name': node.attrs.name as string },
      ['div', { class: 'diagram-box', contenteditable: 'false' }],
      ['pre', { class: 'diagram-src' }, 0],
    ],
  },
  // code: the body of a listing, text as it is written; `lang` is the word after `source,` as written
  code_block: {
    group: 'block',
    content: 'text*',
    marks: '',
    code: true,
    defining: true,
    isolating: true,
    attrs: { lang: { default: '' } },
    toDOM: (node): DOMOutputSpec => {
      const lang = node.attrs.lang as string
      return [
        'div',
        { class: 'nota-code', 'data-lang': lang },
        ['div', { class: 'code-lang', contenteditable: 'false' }, languageLabel(lang)],
        ['pre', { class: 'code-src' }, 0],
      ]
    },
  },
  // a block image: the picture is drawn by a node view (`images` of the options); the text inside is the caption
  image: {
    group: 'block',
    content: 'text*',
    marks: '',
    defining: true,
    isolating: true,
    attrs: { target: { default: '' } },
    toDOM: (node): DOMOutputSpec => [
      'figure',
      { class: 'nota-image', 'data-target': node.attrs.target as string },
      ['div', { class: 'image-box', contenteditable: 'false' }],
      ['figcaption', { 'data-placeholder': labels.captionPlaceholder }, 0],
    ],
  },
  // a table: rows of cells, each cell holds blocks (the text of the cell, a table of the next level, a block shown as source).
  // `level` is 1 for a table of the document and 2–4 for a table in a cell; `widths` the percent of each column (0: automatic); `fixed`: the widths are written in `cols` (the head may wrap)
  table: {
    group: 'block cell_block',
    content: 'table_row+',
    isolating: true,
    selectable: false,
    attrs: { level: { default: 1 }, caption: { default: '' }, widths: { default: [] }, head: { default: false }, fixed: { default: false } },
    toDOM: (node): DOMOutputSpec => {
      const a = node.attrs as { level: number; caption: string; widths: number[]; head: boolean; fixed: boolean }
      const cols: DOMOutputSpec[] = a.widths.map((w): DOMOutputSpec => ['col', w > 0 ? { style: `width:${w}%` } : {}])
      return [
        'div',
        { class: `tbl${a.head ? ' has-head' : ''}${a.fixed ? ' tbl-fixed' : ''}`, 'data-level': String(a.level) },
        ...(a.caption ? ([['div', { class: 'tbl-cap', contenteditable: 'false' }, a.caption]] as DOMOutputSpec[]) : []),
        ['div', { class: 'tbl-scroll' }, ['table', ['colgroup', ...cols], ['tbody', 0]]],
      ]
    },
  },
  table_row: {
    content: 'table_cell*',
    selectable: false,
    toDOM: (): DOMOutputSpec => ['tr', 0],
  },
  // a cell: where it starts in the grid (`row`, `col`), how far it reaches, and whether it is in the head
  table_cell: {
    content: 'cell_block+',
    isolating: true,
    selectable: false,
    attrs: {
      row: { default: 0 },
      col: { default: 0 },
      colspan: { default: 1 },
      rowspan: { default: 1 },
      head: { default: false },
      halign: { default: 'left' },
      valign: { default: 'top' },
      asciidoc: { default: false },
      // the role of the fill of the cell (`cell-yellow`), or null
      fill: { default: null },
    },
    toDOM: (node): DOMOutputSpec => {
      const a = node.attrs as {
        fill: string | null
        colspan: number
        rowspan: number
        head: boolean
        halign: string
        valign: string
        asciidoc: boolean
      }
      return [
        a.head ? 'th' : 'td',
        {
          ...(a.colspan > 1 ? { colspan: String(a.colspan) } : {}),
          ...(a.rowspan > 1 ? { rowspan: String(a.rowspan) } : {}),
          class: `h-${a.halign} v-${a.valign}${a.asciidoc ? ' cell-a' : ''}${a.fill ? ` ${a.fill}` : ''}`,
        },
        0,
      ]
    },
  },
  // the text of a cell, or a paragraph of a cell with blocks
  // (`rich`: the text is read like the text of a paragraph: links, marks and roles show as they do there, and are edited)
  // (`item`: an item of a list in a cell `a|`; the other attributes are those of `list_item`, `draft`: not in the text yet)
  cell_text: {
    group: 'cell_block',
    content: 'inline*',
    // (the text of a cell that is not read like a paragraph holds real line breaks: a read of the DOM must not turn them into spaces)
    whitespace: 'pre',
    attrs: {
      rich: { default: false },
      item: { default: false },
      ordered: { default: false },
      level: { default: 1 },
      num: { default: '' },
      checked: { default: '' },
      draft: { default: false },
    },
    toDOM: (node): DOMOutputSpec => {
      const a = node.attrs as ItemAttrs & { item: boolean }
      if (!a.item) return ['div', { class: 'cell-text' }, 0]
      return ['div', itemAttrs(a, 'cell-text li cell-li'), ...itemMark(a), ['div', { class: 'li-text' }, 0]]
    },
  },
  // a block of a cell that the editor does not edit, as its source
  cell_plate: {
    group: 'cell_block',
    atom: true,
    selectable: false,
    attrs: { src: { default: '' } },
    toDOM: (node): DOMOutputSpec => ['pre', { class: 'cell-plate', contenteditable: 'false' }, node.attrs.src as string],
  },
  text: { group: 'inline' },
  hard_break: {
    inline: true,
    group: 'inline',
    selectable: false,
    toDOM: (): DOMOutputSpec => ['br'],
  },
  inline_chip: {
    inline: true,
    group: 'inline',
    atom: true,
    // never selected as a whole, as `hard_break`: a selected node has no caret. An arrow passes the plate in one press
    // and a click puts the caret at its nearer edge (`handleClickOn` in editor.ts)
    selectable: false,
    attrs: { text: { default: '' } },
    toDOM: (node): DOMOutputSpec => {
      const text = node.attrs.text as string
      // a link whose target holds an attribute reference (`xref:a_{name}.adoc[x]`; other plates stay plates) is kept as it is, yet shown and opened
      // as a link: Cmd+click reads `href` as for any other
      const m = LINK_CHIP.exec(text)
      if (m && /(?<!\\)\{[\w-]+\}/.test(m[1]!) && isSafeHref(m[1]!))
        return ['a', { class: 'nota-link-chip', href: m[1]!, contenteditable: 'false' }, m[2]! === '' ? m[1]! : m[2]!]
      return ['span', { class: 'nota-inline-chip', contenteditable: 'false' }, text]
    },
  },
}

/** The source of a link macro: its target and its text. */
const LINK_CHIP = /^(?:xref|link):([^[\]\n]+)\[([^\]\n]*)\]$/

/**
 * An address the anchor may carry: no scheme (a relative path or `#anchor`), or `http`, `https`, `mailto`. Everything else
 * (`javascript:`, `data:`, `vbscript:`, `file:`, an unknown scheme) is dropped. Browsers skip spaces and control characters
 * in a scheme (`java\tscript:`), so they are removed before the check.
 */
const isSafeHref = (href: string): boolean => {
  // eslint-disable-next-line no-control-regex
  const bare = href.replace(/[\u0000-\u0020\u007f-\u009f\u200b-\u200d\u2028\u2029\ufeff]/g, '')
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(bare)
  return !scheme || /^(?:https?|mailto)$/i.test(scheme[1]!)
}

const marks: Record<string, MarkSpec> = {
  strong: { toDOM: (): DOMOutputSpec => ['strong', 0] },
  em: { toDOM: (): DOMOutputSpec => ['em', 0] },
  code: { toDOM: (): DOMOutputSpec => ['code', 0] },
  strike: { toDOM: (): DOMOutputSpec => ['s', 0] },
  highlight: { toDOM: (): DOMOutputSpec => ['mark', 0] },
  // text with roles (`[.zz-a]#text#`): an element with the names of the roles as its classes. The names are the host's
  // (it styles them); the mark knows only the `[…]` as written. Pieces nest (`[.a]##x [.b]#y# z##`), so they do not exclude
  roles: {
    attrs: { attrs: { default: '' } },
    excludes: '',
    toDOM: (mark): DOMOutputSpec => ['span', { class: roleNames(mark.attrs.attrs as string).join(' ') }, 0],
  },
  link: {
    attrs: { href: { default: '' } },
    // text typed after a link is not part of it
    inclusive: false,
    // the text of the document can say `link:javascript:…[x]`: the anchor gets no target that runs code
    toDOM: (mark): DOMOutputSpec => {
      const href = mark.attrs.href as string
      return ['a', isSafeHref(href) ? { href } : {}, 0]
    },
  },
}

export const schema = new Schema({ nodes, marks })
