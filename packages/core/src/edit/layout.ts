/**
 * Reads the top level of a document as the visual editor shows it: paragraphs and headings it can edit, plates
 * (chips) for everything else, and the blank lines between them.
 */
import type { SyntaxNode } from '@lezer/common'
import type { NotaDocument } from '../document.js'
import { blockKind, sectionLevel, tableModel } from '../nodes.js'
import { irregular } from './tablecheck.js'
import type { BlockInfo, Gap, Item, Layout } from './types.js'

/** Node names that stand for the lines above a block. */
const META = new Set(['BlockAnchor', 'BlockTitle', 'BlockAttributes'])

const QUOTES = new Set(['Strong', 'Emphasis', 'Monospace', 'Highlight'])
const LEAVES = new Set(['Mark', 'SpecialChar', 'Replacement', 'Escape', 'HardBreak'])
const LINK_PARTS = new Set(['MacroName', 'MacroTarget', 'Mark'])

/** True when the editor reads `n`: a leaf, a plate, a mark or a link whose parts it reads. */
function nodeOk(n: SyntaxNode): boolean {
  const name = n.name
  if (LEAVES.has(name)) return true
  if (QUOTES.has(name)) {
    for (let k = n.firstChild; k; k = k.nextSibling) {
      if (k.name === 'QuoteMarker' || k.name === 'InlineAttributes') continue
      if (!nodeOk(k)) return false
    }
    return true
  }
  if (name === 'Link' || name === 'Xref') {
    for (let k = n.firstChild; k; k = k.nextSibling) {
      if (LINK_PARTS.has(k.name)) continue
      if (k.name === 'MacroText' && textOk(k)) continue
      return false
    }
    return true
  }
  // the other constructs of inline text (a footnote, an image, a passthrough …) are plates
  return n.type.is('Inline')
}

/** True when everything under `node` (a line of text, a title, the text of a link) is something the editor reads. */
function textOk(node: SyntaxNode): boolean {
  for (let c = node.firstChild; c; c = c.nextSibling) if (!nodeOk(c)) return false
  return true
}

/** The fields of a block that most blocks leave empty. */
const PLAIN = {
  variant: '',
  checked: '',
  fence: '',
  box: '',
  title: '',
  startsOpen: false,
  lang: '',
  target: '',
} as const

function eolAt(text: string, to: number): string {
  if (text.charCodeAt(to - 1) === 10) return text.charCodeAt(to - 2) === 13 ? '\r\n' : '\n'
  return ''
}

/** The kinds of items that are not text of cells: islands, the lines of a box, code, images. */
export const isRawKind = (kind: string): boolean =>
  kind === 'chip' || kind === 'fence' || kind === 'code' || kind === 'image' || kind === 'table'

/** A table the operations can write back (its cells tile the grid): the info of it as a block of its own, else null (an island). */
function tableInfo(node: SyntaxNode, text: string): BlockInfo | null {
  const model = node.tree?.prop(tableModel)
  if (!model || irregular(model)) return null
  const info = chipInfo(node, text)
  const delim = node.getChild('BlockDelimiter')
  return { ...info, kind: 'table', label: 'Table', markerFrom: delim ? delim.from : node.from }
}

const chipInfo = (
  node: SyntaxNode | { from: number; to: number; name: string },
  text: string,
): BlockInfo => {
  const eol = eolAt(text, node.to)
  return {
    kind: 'chip',
    from: node.from,
    to: node.to,
    meta: null,
    // (an island is edited as text: its source without the line break at the end)
    content: { from: node.from, to: node.to - eol.length },
    level: 0,
    marker: '',
    markerFrom: -1,
    label: node.name,
    eol,
    ...PLAIN,
  }
}

/** A paragraph the editor can edit: metadata lines, then lines of text, nothing else. */
export function paragraphInfo(node: SyntaxNode, text: string): BlockInfo | null {
  let metaTo = -1
  let first: SyntaxNode | null = null
  let last: SyntaxNode | null = null
  let variant = ''
  for (let c = node.firstChild; c; c = c.nextSibling) {
    if (c.name === 'TextLine') {
      if (!textOk(c)) return null
      first ??= c
      last = c
    } else if (META.has(c.name) && !first) metaTo = c.to
    else if (c.name === 'AdmonitionMarker' && node.name === 'AdmonitionParagraph' && !first && !variant)
      variant = text.slice(c.from, c.to).replace(/:\s*$/, '')
    else return null
  }
  if (node.name === 'AdmonitionParagraph' && !ADMONITIONS.has(variant)) return null
  if (!first || !last) return null
  // a first line that starts with blanks is not an ordinary paragraph (a literal one, or a style that keeps them)
  if (/^[ \t]/.test(text.slice(first.from, first.from + 1))) return null
  const eol = eolAt(text, node.to)
  return {
    kind: 'paragraph',
    from: node.from,
    to: node.to,
    meta: metaTo >= 0 ? { from: node.from, to: metaTo } : null,
    content: { from: first.from, to: last.to - eol.length },
    level: 0,
    marker: '',
    markerFrom: -1,
    label: node.name,
    eol,
    ...PLAIN,
    variant,
  }
}

/** The types of an admonition. */
export const ADMONITIONS: ReadonlySet<string> = new Set(['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION'])

/**
 * A list the editor shows item by item: items with their text (one or more lines), and lists of the same kinds in them;
 * no blocks, titles or attributes in it. A blank line between items, or in an item before a nested list, is allowed
 * (`loose`, a blank line before a block or a paragraph of an item is refused with that block): it stays in the
 * gap between the items; two blank lines in a row are a plate. The `a` cells of tables keep the strict rule.
 */
export function listOk(list: SyntaxNode, text: string, loose = true): boolean {
  if (loose && /\n([ \t]*\r?\n){2}/.test(text.slice(list.from, list.to))) return false
  for (let k = list.firstChild; k; k = k.nextSibling) {
    if (k.name === 'BlankLine' && loose) continue
    if (k.name !== 'ListItem') return false
    let hasText = false
    for (let c = k.firstChild; c; c = c.nextSibling) {
      switch (c.name) {
        case 'ListMarker':
        case 'Mark':
        case 'Checkbox':
          break
        case 'ItemText':
          for (let l = c.firstChild; l; l = l.nextSibling) if (l.name !== 'TextLine' || !textOk(l)) return false
          hasText = true
          break
        case 'UnorderedList':
        case 'OrderedList':
          if (!listOk(c, text, loose)) return false
          break
        case 'BlankLine':
          if (!loose) return false
          break
        default:
          return false
      }
    }
    if (!hasText || !k.getChild('ListMarker')) return false
  }
  return true
}

/** An item of a list the editor can show: its info (`depth` counts the lists it is in), or null. */
export function itemInfo(item: SyntaxNode, text: string, depth: number): BlockInfo | null {
  const m = item.getChild('ListMarker')
  const t = item.getChild('ItemText')
  if (!m || !t) return null
  const box = item.getChild('Checkbox')
  const eol = eolAt(text, t.to)
  return {
    kind: 'item',
    from: m.from,
    to: t.to,
    meta: null,
    content: { from: t.from, to: t.to - eol.length },
    level: depth,
    marker: text.slice(m.from, m.to),
    markerFrom: m.from,
    label: 'ListItem',
    eol,
    ...PLAIN,
    checked: box ? text.slice(box.from + 1, box.to - 1) : '',
  }
}

/** The items of a list and of the lists in them, one after the other, each given to `push`. */
export function walkList(
  list: SyntaxNode,
  text: string,
  depth: number,
  push: (item: BlockInfo) => void,
  blank?: (from: number, to: number) => void,
): void {
  for (let item = list.firstChild; item; item = item.nextSibling) {
    if (item.name === 'BlankLine') blank?.(item.from, item.to)
    const info = itemInfo(item, text, depth)
    if (!info) continue
    push(info)
    for (let c = item.firstChild; c; c = c.nextSibling) {
      if (c.name === 'BlankLine') blank?.(c.from, c.to)
      else if (c.name === 'UnorderedList' || c.name === 'OrderedList') walkList(c, text, depth + 1, push, blank)
    }
  }
}

/** The depth of a list item: the number of lists it is in. */
export function itemDepth(item: SyntaxNode): number {
  let d = 0
  for (let n: SyntaxNode | null = item.parent; n; n = n.parent)
    if (n.name === 'UnorderedList' || n.name === 'OrderedList') d++
  return d
}

/** What a box is: an admonition (`[NOTE]` over `====`) or a collapsible block (`[%collapsible]` over `====`); null for the rest. */
export function boxOf(node: SyntaxNode, text: string): { box: 'admonition' | 'collapsible'; variant: string; title: string; startsOpen: boolean } | null {
  if (node.name !== 'DelimitedBlock') return null
  const kind = node.tree?.prop(blockKind)
  if (kind !== 'admonition' && kind !== 'example') return null
  const delims = node.getChildren('BlockDelimiter')
  if (delims.length < 2) return null
  const open = delims[0]!
  const close = delims[delims.length - 1]!
  if (text.slice(open.from, open.to).trim() !== '====' || text.slice(close.from, close.to).trim() !== '====') return null
  let title = ''
  let attrs = ''
  let variant = ''
  for (let c = node.firstChild; c && c.from < open.from; c = c.nextSibling) {
    if (c.name === 'BlockTitle') {
      const t = c.getChild('TitleText')
      if (t) title = text.slice(t.from, t.to)
    } else if (c.name === 'BlockAttributes') {
      attrs += text.slice(c.from, c.to)
      if (!variant) {
        const p = c.getChild('PositionalAttribute')
        const style = p?.getChild('ShorthandStyle')
        const word = style ? text.slice(style.from, style.to) : p && !p.firstChild ? text.slice(p.from, p.to) : ''
        if (ADMONITIONS.has(word)) variant = word
      }
    } else if (c.name !== 'BlockAnchor') return null
  }
  if (kind === 'admonition') return variant ? { box: 'admonition', variant, title: '', startsOpen: false } : null
  if (!/%collapsible\b/.test(attrs)) return null
  return { box: 'collapsible', variant: '', title, startsOpen: /%open\b/.test(attrs) }
}

/** The positional attributes of the `[…]` lines over a block: the style (`source`) and the node of the language that follows it. */
export function listingStyle(
  node: SyntaxNode,
  text: string,
  stop: number,
): { style: string; styleNode: SyntaxNode | null; lang: SyntaxNode | null; line: SyntaxNode | null } | null {
  let found: { style: string; styleNode: SyntaxNode | null; lang: SyntaxNode | null; line: SyntaxNode | null } | null = null
  for (let c = node.firstChild; c && c.from < stop; c = c.nextSibling) {
    if (c.name !== 'BlockAttributes') continue
    const positional: SyntaxNode[] = []
    for (let k = c.firstChild; k; k = k.nextSibling) if (k.name === 'PositionalAttribute') positional.push(k)
    const first = positional[0]
    if (!first) continue
    const shorthand = first.getChild('ShorthandStyle')
    const hasChildren = first.firstChild !== null
    const styleNode = shorthand ?? (hasChildren ? null : first)
    const style = styleNode ? text.slice(styleNode.from, styleNode.to).trim() : ''
    if (style === '') continue
    // (a `[source]` after a `[listing]` wins: the later line is the one that is read last)
    found = { style, styleNode, lang: positional[1] ?? null, line: c }
  }
  return found
}

const SOURCE_STYLES = new Set(['source', 'listing'])
const DIRECTIVE_LINE = /^\\?(?:ifn?def|ifeval|endif|include)::/m

/** The lines above a block (`[[id]]`, `.Title`, `[…]`) of a block node; false when something else stands there. */
function metaOf(node: SyntaxNode, stop: number): { from: number; to: number } | null | false {
  let from = -1
  let to = -1
  for (let c = node.firstChild; c && c.from < stop; c = c.nextSibling) {
    if (!META.has(c.name)) return false
    if (from < 0) from = c.from
    to = c.to
  }
  return from < 0 ? null : { from, to }
}

/**
 * A listing the editor shows as code: `----` over `----` (the same delimiter), with `[source…]` over it or with nothing
 * (no other style), whose lines are not a directive of the preprocessor.
 */
export function codeInfo(node: SyntaxNode, text: string): BlockInfo | null {
  if (node.name !== 'DelimitedBlock' || node.tree?.prop(blockKind) !== 'listing') return null
  const delims = node.getChildren('BlockDelimiter')
  if (delims.length < 2) return null
  const open = delims[0]!
  const close = delims[delims.length - 1]!
  const openText = text.slice(open.from, open.to).trim()
  if (!/^-{4,}$/.test(openText) || text.slice(close.from, close.to).trim() !== openText) return null
  const meta = metaOf(node, open.from)
  if (meta === false) return null
  const style = listingStyle(node, text, open.from)
  if (style && !SOURCE_STYLES.has(style.style)) return null
  // (a line of a title or an attribute line other than the first of its kind is read as Asciidoctor reads it: by the tree)
  const body = text.slice(open.to, close.from)
  if (DIRECTIVE_LINE.test(body)) return null
  const eol = eolAt(text, node.to)
  // (the body without the line break that ends its last line)
  const to = close.from - (body === '' ? 0 : body.endsWith('\r\n') ? 2 : 1)
  const lang = style && style.style === 'source' && style.lang ? text.slice(style.lang.from, style.lang.to).trim() : ''
  return {
    kind: 'code',
    from: node.from,
    to: node.to,
    meta,
    content: { from: open.to, to: Math.max(open.to, to) },
    level: 0,
    marker: openText,
    markerFrom: open.from,
    label: 'DelimitedBlock',
    eol,
    ...PLAIN,
    lang,
    target: openText,
  }
}

/** A line `toc::[]` with nothing else: no attributes in the brackets, no lines of metadata over it. Else null (an island). */
export function tocInfo(node: SyntaxNode, text: string): BlockInfo | null {
  if (node.name !== 'BlockMacro') return null
  let name = false
  for (let c = node.firstChild; c; c = c.nextSibling) {
    if (c.name === 'MacroName' && !name && text.slice(c.from, c.to) === 'toc') name = true
    else if (c.name === 'Mark' && name && text.slice(c.from, c.to) === '::[]') continue
    else if (c.name === 'Newline' && name) continue
    else return null
  }
  if (!name) return null
  const eol = eolAt(text, node.to)
  if (text.slice(node.from, node.to - eol.length) !== 'toc::[]') return null
  return {
    kind: 'fence',
    from: node.from,
    to: node.to,
    meta: null,
    content: null,
    level: 0,
    marker: '',
    markerFrom: -1,
    label: 'Toc',
    eol,
    ...PLAIN,
    fence: 'toc',
  }
}

/** A block `image::target[…]`, alone or with the lines over it (at most one title); its caption is the title. */
export function imageInfo(node: SyntaxNode, text: string): BlockInfo | null {
  if (node.name !== 'BlockMacro') return null
  let name: SyntaxNode | null = null
  let target: SyntaxNode | null = null
  let titles = 0
  let title: SyntaxNode | null = null
  let metaFrom = -1
  let metaTo = -1
  for (let c = node.firstChild; c; c = c.nextSibling) {
    if (META.has(c.name) && !name) {
      if (c.name === 'BlockTitle') {
        titles++
        title = c
      }
      if (metaFrom < 0) metaFrom = c.from
      metaTo = c.to
    } else if (c.name === 'MacroName' && !name) name = c
    else if (c.name === 'MacroTarget' && name && !target) target = c
    else if (
      (c.name === 'Mark' || c.name === 'PositionalAttribute' || c.name === 'NamedAttribute' || c.name === 'Newline') &&
      name
    )
      continue
    else return null
  }
  if (!name || !target || titles > 1 || text.slice(name.from, name.to) !== 'image') return null
  const eol = eolAt(text, node.to)
  let content = { from: name.from, to: name.from }
  if (title) {
    const nl = title.getChild('Newline')
    const mark = title.getChild('Mark')
    if (!mark) return null
    content = { from: mark.to, to: nl ? nl.from : title.to }
  }
  return {
    kind: 'image',
    from: node.from,
    to: node.to,
    meta: metaFrom >= 0 ? { from: metaFrom, to: metaTo } : null,
    content,
    level: 0,
    marker: '',
    markerFrom: name.from,
    label: 'BlockMacro',
    eol,
    ...PLAIN,
    target: text.slice(target.from, target.to),
  }
}

function walkBox(node: SyntaxNode, text: string, out: Raw[]): boolean {
  const box = boxOf(node, text)
  if (!box) return false
  const delims = node.getChildren('BlockDelimiter')
  const open = delims[0]!
  const close = delims[delims.length - 1]!
  const fence = (from: number, to: number, side: 'open' | 'close'): BlockInfo => ({
    kind: 'fence',
    from,
    to,
    meta: null,
    content: null,
    level: 0,
    marker: '',
    markerFrom: -1,
    label: 'DelimitedBlock',
    eol: eolAt(text, to),
    ...PLAIN,
    fence: side,
    box: box.box,
    variant: box.variant,
    title: box.title,
    startsOpen: box.startsOpen,
  })
  out.push({ t: 'block', b: fence(node.from, open.to, 'open') })
  for (let c = node.firstChild; c; c = c.nextSibling) {
    if (c.from < open.to || c.from >= close.from) continue
    walkOne(c, text, out, true)
  }
  out.push({ t: 'block', b: fence(close.from, node.to, 'close') })
  return true
}

/**
 * A heading the editor can edit. `pre` are the nodes above it (metadata), `parts` the first node of the title line
 * (the marker), `titleFrom`–`titleTo` the range of the line, with its line break.
 */
export function headingInfo(
  from: number,
  pre: readonly SyntaxNode[],
  parts: SyntaxNode | null,
  titleTo: number,
  level: number,
  text: string,
): BlockInfo | null {
  if (level < 0 || level > 5) return null
  let marker: SyntaxNode | null = null
  let titleText: SyntaxNode | null = null
  let closing = false
  let after: SyntaxNode | null = null
  let newline: SyntaxNode | null = null
  for (let c = parts; c; c = c.nextSibling) {
    if (c.name === 'SectionMarker') {
      if (!marker) marker = c
      else closing = true
    } else if (c.name === 'TitleText') titleText = c
    else if (c.name === 'SetextUnderline') return null
    else if (c.name === 'Mark' && titleText && !after) after = c
    else if (c.name === 'Newline') newline = c
  }
  if (!marker || !titleText || titleText.to <= titleText.from) return null
  if (!textOk(titleText)) return null
  for (const p of pre) if (!META.has(p.name)) return null
  // the title text runs to the end of the line when no closing marker follows: its trailing blanks are text
  let contentTo = titleText.to
  if (
    !closing &&
    after &&
    after.from === titleText.to &&
    /^[ \t]*$/.test(text.slice(after.from, after.to)) &&
    (!newline || newline.from === after.to)
  )
    contentTo = after.to
  const eol = eolAt(text, titleTo)
  const meta = pre.length ? { from: pre[0]!.from, to: pre[pre.length - 1]!.to } : null
  return {
    kind: 'heading',
    from,
    to: titleTo,
    meta,
    content: { from: titleText.from, to: contentTo },
    level: level + 1,
    marker: text.slice(marker.from, marker.to),
    markerFrom: marker.from,
    label: 'SectionTitle',
    eol,
    ...PLAIN,
  }
}

type Raw =
  | { t: 'block'; b: BlockInfo }
  | { t: 'blank'; from: number; to: number }
  | { t: 'bom'; from: number; to: number }

function walk(first: SyntaxNode | null, text: string, out: Raw[]): void {
  for (let c = first; c; c = c.nextSibling) walkOne(c, text, out, false)
}

function walkOne(c: SyntaxNode, text: string, out: Raw[], inBox: boolean): void {
  switch (c.name) {
    case 'ByteOrderMark':
      out.push({ t: 'bom', from: c.from, to: c.to })
      break
    case 'BlankLine':
      out.push({ t: 'blank', from: c.from, to: c.to })
      break
    case 'Header':
      walkHeader(c, text, out)
      break
    case 'Section':
      walkSection(c, text, out)
      break
    case 'Paragraph':
    case 'AdmonitionParagraph': {
      const info = paragraphInfo(c, text)
      out.push({ t: 'block', b: info ?? chipInfo(c, text) })
      break
    }
    case 'UnorderedList':
    case 'OrderedList':
      if (listOk(c, text))
        walkList(
          c,
          text,
          1,
          (b) => out.push({ t: 'block', b }),
          (from, to) => out.push({ t: 'blank', from, to }),
        )
      else out.push({ t: 'block', b: chipInfo(c, text) })
      break
    case 'DelimitedBlock': {
      const code = codeInfo(c, text)
      const table = code ? null : tableInfo(c, text)
      if (code) out.push({ t: 'block', b: code })
      else if (table) out.push({ t: 'block', b: table })
      else if (inBox || !walkBox(c, text, out)) out.push({ t: 'block', b: chipInfo(c, text) })
      break
    }
    case 'BlockMacro': {
      const image = imageInfo(c, text)
      out.push({ t: 'block', b: image ?? tocInfo(c, text) ?? chipInfo(c, text) })
      break
    }
    case 'DiscreteHeading': {
      out.push({ t: 'block', b: discreteInfo(c, text) ?? chipInfo(c, text) })
      break
    }
    default:
      out.push({ t: 'block', b: chipInfo(c, text) })
  }
}

export function discreteInfo(node: SyntaxNode, text: string): BlockInfo | null {
  const pre: SyntaxNode[] = []
  let c = node.firstChild
  for (; c && c.name !== 'SectionMarker'; c = c.nextSibling) pre.push(c)
  if (!c) return null
  return headingInfo(node.from, pre, c, node.to, node.tree?.prop(sectionLevel) ?? -1, text)
}

/** The info of the document title: the anchor and the other metadata lines right above it belong to it, as to a section title. */
function titleInfo(title: SyntaxNode, text: string): BlockInfo | null {
  const pre: SyntaxNode[] = []
  for (let p = title.prevSibling; p && META.has(p.name); p = p.prevSibling) pre.unshift(p)
  return headingInfo((pre[0] ?? title).from, pre, title.firstChild, title.to, 0, text)
}

function walkHeader(header: SyntaxNode, text: string, out: Raw[]): void {
  const title = header.getChild('DocumentTitle')
  const info = title && titleInfo(title, text)
  for (let c = header.firstChild; c; c = c.nextSibling) {
    if (info && c.from >= info.from && c.from < title!.from) continue
    if (c.name === 'DocumentTitle' && info) out.push({ t: 'block', b: info })
    else if (c.name === 'BlankLine') out.push({ t: 'blank', from: c.from, to: c.to })
    else out.push({ t: 'block', b: chipInfo(c, text) })
  }
}

/** The heading a section starts with, if the editor can edit it: the nodes above the title, the title node. */
export function sectionHeading(
  section: SyntaxNode,
  text: string,
): { info: BlockInfo | null; pre: SyntaxNode[]; title: SyntaxNode | null } {
  const pre: SyntaxNode[] = []
  let c = section.firstChild
  for (; c && c.name !== 'SectionTitle'; c = c.nextSibling) pre.push(c)
  if (!c) return { info: null, pre, title: null }
  const level = section.tree?.prop(sectionLevel) ?? -1
  const info =
    level >= 1 ? headingInfo((pre[0] ?? c).from, pre, c.firstChild, c.to, level, text) : null
  return { info, pre, title: c }
}

function walkSection(section: SyntaxNode, text: string, out: Raw[]): void {
  const { info, pre, title } = sectionHeading(section, text)
  const c = title
  if (!c) {
    for (const p of pre) out.push({ t: 'block', b: chipInfo(p, text) })
    return
  }
  if (info) out.push({ t: 'block', b: info })
  else {
    // one plate over the lines above the title and the title
    out.push({
      t: 'block',
      b: chipInfo({ from: pre.length ? pre[0]!.from : c.from, to: c.to, name: 'SectionTitle' }, text),
    })
  }
  // the rest of the section is content, like the document's
  walk(c.nextSibling, text, out)
}

/** Reads the layout of a document. */
export function readLayout(doc: NotaDocument): Layout {
  const text = doc.text
  const raws: Raw[] = []
  walk(doc.tree.topNode.firstChild, text, raws)
  let leading = 0
  const blocks: BlockInfo[] = []
  const gaps: Gap[] = []
  let lines: { from: number; to: number }[] = []
  const closeGap = (): void => {
    gaps.push({
      from: lines.length ? lines[0]!.from : -1,
      to: lines.length ? lines[lines.length - 1]!.to : -1,
      lines,
    })
    lines = []
  }
  for (const r of raws) {
    if (r.t === 'bom') {
      leading = r.to
    } else if (r.t === 'blank') {
      lines.push({ from: r.from, to: r.to })
    } else {
      const prev = blocks[blocks.length - 1]
      if (r.b.kind === 'chip' && prev && prev.kind === 'chip' && lines.length === 0 && prev.to === r.b.from) {
        // chips that touch are one plate
        blocks[blocks.length - 1] = {
          ...prev,
          to: r.b.to,
          eol: r.b.eol,
          content: { from: prev.from, to: r.b.to - r.b.eol.length },
        }
      } else {
        closeGap()
        blocks.push(r.b)
      }
    }
  }
  closeGap()
  // gaps without lines get their place from the neighbours
  const fixed = gaps.map((g, i) => {
    if (g.from >= 0) return g
    const at = i === 0 ? leading : blocks[i - 1]!.to
    return { from: at, to: at, lines: g.lines }
  })
  return { leading, blocks, gaps: fixed, length: text.length }
}

/** What the visual editor shows, in order. */
export function layoutItems(layout: Layout): Item[] {
  const items: Item[] = []
  const n = layout.blocks.length
  const empty = (from: number, to: number, gap: number, line: number): void => {
    items.push({ kind: 'empty', from, to, block: null, blockIndex: -1, gap, line })
  }
  const pushEmpties = (gap: number): void => {
    const g = layout.gaps[gap]!
    // (the empty paragraphs of a gap: the first line of a gap between blocks, or after the last, separates)
    for (let line = n === 0 || gap === 0 ? 0 : 1; line < g.lines.length; line++)
      empty(g.lines[line]!.from, g.lines[line]!.to, gap, line)
  }
  if (n === 0) {
    pushEmpties(0)
    if (items.length === 0) empty(layout.leading, layout.leading, 0, -1)
    return items
  }
  for (let i = 0; i < n; i++) {
    pushEmpties(i)
    const b = layout.blocks[i]!
    items.push({ kind: b.kind, from: b.from, to: b.to, block: b, blockIndex: i, gap: -1, line: -1 })
  }
  pushEmpties(n)
  return items
}

/**
 * The block that starts at `from` when it is a paragraph or a heading the editor can edit; null when there is none
 * (a plate, a blank line, another offset).
 */
export function editableBlockAt(doc: NotaDocument, from: number): BlockInfo | null {
  let n: SyntaxNode | null = doc.tree.resolveInner(from, 1)
  for (; n; n = n.parent) {
    if (n.from !== from && !(n.name === 'Header' && n.from < from)) {
      if (n.from < from) return null
      continue
    }
    // a header that starts above `from`: its title, when its metadata (an anchor) starts at `from`
    const t = n.name === 'Header' && n.getChild('DocumentTitle')
    const info = t ? titleInfo(t, doc.text) : blockOf(n, doc.text)
    if (info !== undefined && (!t || info?.from === from)) return info
  }
  return null
}

/** The block a node is (undefined: not a node of a block the editor edits). */
function blockOf(n: SyntaxNode, text: string): BlockInfo | null | undefined {
  switch (n.name) {

    case 'Paragraph':
    case 'AdmonitionParagraph':
      return inTableCell(n) ? null : paragraphInfo(n, text)
    case 'ListItem':
      return shownItem(n, text)
    case 'Section':
      return sectionHeading(n, text).info
    case 'DiscreteHeading':
      return discreteInfo(n, text)
    case 'DocumentTitle':
      return titleInfo(n, text)
  }
  return undefined
}

/** The info of an item of a list the editor shows item by item (the whole list is one it can read, and it is not in a table). */
function shownItem(item: SyntaxNode, text: string): BlockInfo | null {
  let top: SyntaxNode | null = null
  for (let n: SyntaxNode | null = item.parent; n; n = n.parent) {
    if (n.name === 'UnorderedList' || n.name === 'OrderedList') top = n
    else if (n.name !== 'ListItem') break
  }
  if (!top || inTableCell(top) || !listOk(top, text)) return null
  return itemInfo(item, text, itemDepth(item))
}

/**
 * The block is in a cell of a table. The text of a cell is table source (a `|` typed in it would make one more cell),
 * so the blocks of an `a` cell are not edited as text: the table is a plate.
 */
function inTableCell(n: SyntaxNode): boolean {
  for (let p = n.parent; p; p = p.parent) if (p.name === 'CellContent') return true
  return false
}

/** The editable block whose text contains `offset` (a paragraph or heading with `content.from <= offset <= content.to`). */
export function editableBlockAround(doc: NotaDocument, offset: number): BlockInfo | null {
  for (const side of [1, -1] as const) {
    let n: SyntaxNode | null = doc.tree.resolveInner(offset, side)
    for (; n; n = n.parent) {
      let info = blockOf(n, doc.text)
      // only the title line and what is above it belong to the heading
      if (n.name === 'Section' && info && offset > info.to) info = null
      else if (info === undefined && n.name === 'Header') break
      if (info) {
        const c = info.content!
        if (c.from <= offset && offset <= c.to) return info
        break
      }
    }
  }
  return null
}
