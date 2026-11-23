/**
 * The header of a page: a block comment `////` at the very start of the file that holds lines `key: value` (and lists
 * `- item`), with the attribute entries and blank lines that follow it up to the first block of content. The visual editor
 * may keep it out of sight and show a badge instead; this module only reads it. It knows no names of fields.
 */
import type { SyntaxNode } from '@lezer/common'
import type { NotaDocument } from '../document.js'
import { tocInfo } from './layout.js'
import type { BlockInfo, Item } from './types.js'

/** A field of the header: `key: value`, or `key:` over a list of `- item` lines. */
export interface PageMetaField {
  readonly key: string
  /** A string for `key: value`; a list of strings for `key:` over `- item` lines (an empty list for a bare `key:`). */
  readonly value: string | readonly string[]
}

/** An attribute entry kept out of sight: `:name: value` (the value is '' for `:name:`), and where its line starts. */
export interface PageMetaAttribute {
  readonly name: string
  readonly value: string
  readonly from: number
}

/** What a range is: the comment with the attributes before the title, the attributes after the title, or after the link. */
export type PageMetaKind = 'head' | 'tail' | 'body'

/** The header of a page. */
export interface PageMeta {
  /** The fields in the order of the file. */
  readonly fields: readonly PageMetaField[]
  /**
   * The source that is kept out of sight: the lines before the title of the document, and those after it (if any),
   * in as many runs as the link paragraph and the lines `toc::[]` between them make. Each starts at the start of an
   * item of the editor (the first blank line after a block is not one).
   */
  readonly ranges: readonly { readonly from: number; readonly to: number }[]
  readonly kinds: readonly PageMetaKind[]
  /** The attribute entries of all the ranges, in the order of the file. */
  readonly attributes: readonly PageMetaAttribute[]
  /** The lines `toc::[]` of the zone: they stay in sight, and cannot be selected or deleted. */
  readonly tocs: readonly { readonly from: number; readonly to: number }[]
  /** The offset of the start of the line of the first field of each key. */
  readonly lines: ReadonlyMap<string, number>
}

const FIELD = /^([A-Za-z_][\w-]*):(?:[ \t]+(.*))?$/
const ITEM = /^[ \t]*-[ \t]+(.*)$/

function unquote(s: string): string {
  const t = s.trim()
  if (t.length >= 2 && (t[0] === '"' || t[0] === "'") && t[t.length - 1] === t[0]) return t.slice(1, -1)
  return t
}

/** The fields of the text of a comment, and where each line starts; empty when it has no line `key: value`. */
function readFields(body: string, base: number): { fields: PageMetaField[]; lines: Map<string, number> } {
  const fields: PageMetaField[] = []
  const lines = new Map<string, number>()
  let pos = 0
  let list: string[] | null = null
  for (const raw of body.split('\n')) {
    const at = base + pos
    pos += raw.length + 1
    const line = raw.replace(/\r$/, '')
    const f = FIELD.exec(line)
    if (f) {
      const value = f[2]
      if (value === undefined || value.trim() === '') {
        list = []
        fields.push({ key: f[1]!, value: list })
      } else {
        list = null
        fields.push({ key: f[1]!, value: unquote(value) })
      }
      if (!lines.has(f[1]!)) lines.set(f[1]!, at)
      continue
    }
    const it = ITEM.exec(line)
    if (it && list) {
      list.push(unquote(it[1]!))
      continue
    }
  }
  return { fields, lines }
}

/** The top-level nodes of a document, with the children of its header in their place. */
function* flat(doc: NotaDocument): Generator<SyntaxNode> {
  for (let c = doc.tree.topNode.firstChild; c; c = c.nextSibling) {
    if (c.name === 'Header') for (let k = c.firstChild; k; k = k.nextSibling) yield k
    else yield c
  }
}

/** True for a paragraph that is one link and nothing else: `link:…[…]`, or an address with `[…]`. */
function linkParagraph(n: SyntaxNode, text: string): boolean {
  if (n.name !== 'Paragraph') return false
  let line: SyntaxNode | null = null
  for (let c = n.firstChild; c; c = c.nextSibling) {
    if (c.name !== 'TextLine' || line) return false
    line = c
  }
  if (!line) return false
  let link: SyntaxNode | null = null
  for (let c = line.firstChild; c; c = c.nextSibling) {
    if (c.name === 'Link' && !link) link = c
    else if (c.name !== 'Mark' || text.slice(c.from, c.to).trim() !== '') return false
  }
  if (!link || !text.slice(link.from, link.to).endsWith(']')) return false
  return text.slice(line.from, link.from).trim() === '' && text.slice(link.to, line.to).trim() === ''
}

/** The name and the value of an attribute entry, as written. */
function attributeOf(n: SyntaxNode, text: string): PageMetaAttribute {
  const name = n.getChild('AttributeName')
  const value = n.getChild('AttributeValue')
  let label = name ? text.slice(name.from, name.to) : ''
  // (an attribute taken off, `:toc!:` or `:!toc:`, keeps its mark: it must not look like one that is on)
  const unset = /^:(?:!|[^:\r\n]*!:)/.test(text.slice(n.from, n.to))
  if (unset && !label.includes('!')) label = '!' + label.replace(/!$/, '')
  return {
    name: label,
    value: value ? text.slice(value.from, value.to).trim() : '',
    from: n.from,
  }
}

/**
 * Reads the header of a page; null when the file has none (the check is the shape of the tree, not a list of keys).
 * What is kept out of sight: the lines of the comment with the attribute entries before the title, and, after the title
 * (after the header when there is no title), the attribute entries and the blank lines between them, up to the first
 * block of content. One paragraph that is a single link may stand in front of them, and lines `toc::[]` between
 * them; neither ends the zone.
 */
export function readPageMeta(doc: NotaDocument): PageMeta | null {
  const text = doc.text
  let first: SyntaxNode | null = null
  let fields: PageMetaField[] = []
  let lines = new Map<string, number>()
  const ranges: { from: number; to: number }[] = []
  const kinds: PageMetaKind[] = []
  const attributes: PageMetaAttribute[] = []
  const tocs: { from: number; to: number }[] = []
  let titleSeen = false
  let linkSeen = false
  let zone = false
  // the open run of attributes, and where the next one would start (after the first blank line that follows a block)
  let open = false
  let start = 0
  let sep = false
  const close = (at: number): void => {
    open = false
    start = at
    sep = false
  }
  for (const n of flat(doc)) {
    if (n.name === 'ByteOrderMark') continue
    if (!first) {
      if (n.name !== 'BlockComment') return null
      const delim = n.getChild('CommentDelimiter')
      const body = n.getChild('CommentContent')
      if (!delim || !body || !text.slice(delim.from, delim.to).startsWith('////')) return null
      const r = readFields(text.slice(body.from, body.to), body.from)
      if (r.fields.length === 0) return null
      fields = r.fields
      lines = r.lines
      first = n
      ranges.push({ from: n.from, to: n.to })
      kinds.push('head')
      open = true
      continue
    }
    if (n.name === 'AttributeEntry') {
      attributes.push(attributeOf(n, text))
      if (open) ranges[ranges.length - 1]!.to = n.to
      else {
        ranges.push({ from: start, to: n.to })
        kinds.push(linkSeen ? 'body' : 'tail')
        open = true
      }
      if (titleSeen) zone = true
    } else if (n.name === 'DocumentTitle' && !titleSeen && !linkSeen && !zone) {
      titleSeen = true
      close(n.to)
    } else if (n.name === 'BlankLine') {
      if (!open && !sep) {
        start = n.to
        sep = true
      }
    } else if (n.name === 'Paragraph' && !linkSeen && !zone && linkParagraph(n, text)) {
      linkSeen = true
      close(n.to)
    } else if (n.name === 'BlockMacro' && tocInfo(n, text)) {
      tocs.push({ from: n.from, to: n.to })
      zone = true
      close(n.to)
    } else break
  }
  if (!first) return null
  return { fields, ranges, kinds, lines, attributes, tocs }
}

const PLAIN: Omit<BlockInfo, 'kind' | 'from' | 'to' | 'content' | 'label' | 'eol' | 'fence'> = {
  meta: null,
  level: 0,
  marker: '',
  markerFrom: -1,
  variant: '',
  checked: '',
  box: '',
  title: '',
  startsOpen: false,
  lang: '',
  target: '',
}

/** The label of the islands of a header that is shown, and the label of the badge item that stands for it. */
export const PAGE_META = 'PageMeta'
export const PAGE_META_TAIL = 'PageMetaTail'
export const PAGE_META_BODY = 'PageMetaBody'
/** The label of a line `toc::[]` in the zone of the header (the editor does not select or delete it). */
export const TOC_PINNED = 'TocPinned'

/**
 * The items of a document with its header kept out of sight: the items inside a range of the header are one item of
 * the kind `fence` with `fence: 'meta'` (it has no text, and the blank lines inside the range belong to it). With
 * `expanded` the header is shown as islands (relabelled `PageMeta` / `PageMetaTail` / `PageMetaBody`). Returns the items as they are,
 * and `meta` null, when the file has no header or the header does not sit on the borders of the items.
 */
export function pageMetaItems(
  doc: NotaDocument,
  items: readonly Item[],
  expanded: boolean,
): { items: Item[]; meta: PageMeta | null } {
  const meta = readPageMeta(doc)
  if (!meta) return { items: [...items], meta: null }
  // every range starts an item and ends one, and only chips and empty paragraphs lie in it
  const spans: [number, number][] = []
  for (const r of meta.ranges) {
    const a = items.findIndex((it) => it.from === r.from)
    let b = a
    while (b >= 0 && b < items.length && items[b]!.to < r.to) b++
    if (a < 0 || b >= items.length || items[b]!.to !== r.to) return { items: [...items], meta: null }
    for (let i = a; i <= b; i++) {
      const it = items[i]!
      if (it.kind !== 'chip' && it.kind !== 'empty') return { items: [...items], meta: null }
    }
    spans.push([a, b])
  }
  const out: Item[] = []
  let i = 0
  spans.forEach(([a, b], k) => {
    for (; i < a; i++) out.push(items[i]!)
    const r = meta.ranges[k]!
    const kind = meta.kinds[k]!
    const label = kind === 'head' ? PAGE_META : kind === 'body' ? PAGE_META_BODY : PAGE_META_TAIL
    if (expanded) {
      for (; i <= b; i++) {
        const it = items[i]!
        out.push(it.kind === 'chip' ? { ...it, block: { ...it.block!, label } } : it)
      }
      return
    }
    i = b + 1
    const block: BlockInfo = {
      kind: 'fence',
      from: r.from,
      to: r.to,
      content: null,
      label,
      eol: '',
      fence: 'meta',
      ...PLAIN,
    }
    out.push({ kind: 'fence', from: r.from, to: r.to, block, blockIndex: -1, gap: -1, line: -1 })
  })
  for (; i < items.length; i++) out.push(items[i]!)
  // the lines `toc::[]` of the zone stay in sight, pinned
  for (const t of meta.tocs) {
    const at = out.findIndex((it) => it.block?.fence === 'toc' && it.from === t.from)
    if (at >= 0) {
      const it = out[at]!
      out[at] = { ...it, block: { ...it.block!, label: TOC_PINNED } }
    }
  }
  return { items: out, meta }
}
