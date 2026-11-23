/**
 * The Abstract Semantic Graph of a document: JSON in the shape of the ASG schema of the Eclipse AsciiDoc language
 * project (draft 01), read from the syntax tree. Every node also has `range`, offsets in the text (UTF-16), so that a
 * node can be found in the tree and in the text: `text.slice(from, to)` is the source of the node.
 */
import type { SyntaxNode } from '@lezer/common'
import type { NotaDocument } from '../document.js'
import { sectionLevel, blockKind, cellBars as cellBarsOf } from '../nodes.js'
import { resolveInclude } from './resolver.js'

/** `[from, to]`: offsets in the text of the document; `text.slice(from, to)` is the source of the node. */
export type AsgRange = readonly [number, number]

/** A point of the source: `line` and `col` count from 1 (`col` in UTF-16 units); `file` only in nodes that come from an `include::`. */
export interface AsgPosition {
  line: number
  col: number
  file?: string[]
}

/** The first and the last character of a node (both inclusive), as the schema has it. */
export type AsgLocation = readonly [AsgPosition, AsgPosition]

/** A node of the ASG: blocks, inlines and the literal strings of the text. The other properties are those of the schema. */
export interface AsgNode {
  name: string
  type: 'block' | 'inline' | 'string'
  location: AsgLocation
  range: AsgRange
  [key: string]: unknown
}

/** The root of the ASG. */
export interface AsgDocument extends AsgNode {
  name: 'document'
  type: 'block'
  attributes?: Record<string, string | null>
  header?: { title: AsgNode[]; authors?: AsgAuthor[]; location: AsgLocation; range: AsgRange }
  blocks?: AsgNode[]
}

/** An author of the document header, in the shape of the ASG schema. */
export interface AsgAuthor {
  fullname: string
  initials?: string
  firstname?: string
  middlename?: string
  lastname?: string
  address?: string
}

const MAX_INCLUDE_DEPTH = 10

interface Ctx {
  readonly doc: NotaDocument
  readonly text: string
  readonly starts: readonly number[]
  readonly file: readonly string[] | null
  /** The range every node gets: a node that comes from an include stands for the line of the directive. */
  readonly pin: AsgRange | null
  readonly depth: number
  /** The table is not one literal but its frame and its cells with the blocks they hold (for the checks of the operations). */
  readonly deep: boolean
}

function lineStarts(text: string): number[] {
  const out = [0]
  for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) out.push(i + 1)
  return out
}

function position(c: Ctx, offset: number): AsgPosition {
  const { starts } = c
  let lo = 0
  let hi = starts.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (starts[mid]! <= offset) lo = mid
    else hi = mid - 1
  }
  const p: AsgPosition = { line: lo + 1, col: offset - starts[lo]! + 1 }
  if (c.file) p.file = [...c.file]
  return p
}

/** The range of a source: its last white space left out. */
function trimmed(c: Ctx, from: number, to: number, all = true): AsgRange {
  let e = to
  const t = c.text
  while (e > from) {
    const ch = t.charCodeAt(e - 1)
    if (ch === 10 || ch === 13 || (all && (ch === 32 || ch === 9))) e--
    else break
  }
  return [from, e]
}

function locate(c: Ctx, r: AsgRange): { location: AsgLocation; range: AsgRange } {
  const [from, to] = r
  return {
    location: [position(c, from), position(c, to > from ? to - 1 : from)],
    range: c.pin ?? r,
  }
}

function withLocation<T extends { name: string; type: AsgNode['type'] }>(c: Ctx, r: AsgRange, node: T): T & AsgNode {
  return { ...node, ...locate(c, r) } as T & AsgNode
}

/** The characters that separate the cells of the tables whose cells hold the position (none outside a cell). */
function cellBars(c: Ctx, pos: number): readonly string[] {
  return cellBarsOf(c.doc.tree.resolveInner(pos, 1))
}

/** The text of a run without the backslashes that protect a construct from being read (the `Escape` nodes of the tree). */
function unescaped(c: Ctx, from: number, to: number): string {
  const src = c.text.slice(from, to)
  if (!src.includes('\\')) return src
  let out = ''
  let last = 0
  let bars: readonly string[] | undefined
  for (let i = src.indexOf('\\'); i >= 0; i = src.indexOf('\\', i + 1)) {
    const n = c.doc.tree.resolveInner(from + i, 1)
    // (a bar that is escaped in a cell is the text of the cell)
    if (i + 1 < src.length && src[i + 1] !== '\\') {
      if (bars === undefined) bars = cellBars(c, from)
      if (bars.includes(src[i + 1]!)) {
        out += src.slice(last, i)
        last = i + 1
        continue
      }
    }
    if (n.name === 'Escape' && n.from === from + i) {
      out += src.slice(last, i)
      last = i + 1
    }
  }
  return out + src.slice(last)
}

function textNode(c: Ctx, from: number, to: number, name: 'text' | 'raw' = 'text'): AsgNode {
  return withLocation(c, [from, to], {
    name,
    type: 'string' as const,
    value: (name === 'text' ? unescaped(c, from, to) : c.text.slice(from, to)).replace(/\r\n/g, '\n'),
  })
}

// ---------------------------------------------------------------- inlines

const SPANS: Readonly<Record<string, string>> = {
  Strong: 'strong',
  Emphasis: 'emphasis',
  Monospace: 'code',
  Highlight: 'mark',
}

/** The inlines between `from` and `to` among the children of `node` (the parts of a text made of the leaves and inline nodes). */
function inlinesIn(c: Ctx, nodes: readonly SyntaxNode[], from: number, to: number): AsgNode[] {
  const out: AsgNode[] = []
  let runFrom = -1
  let runTo = -1
  const flush = () => {
    if (runFrom >= 0) {
      const r = trimmedRun(c, runFrom, runTo, out.length === 0, false)
      if (r[1] > r[0]) out.push(textNode(c, r[0], r[1]))
      runFrom = -1
    }
  }
  const extend = (f: number, t: number) => {
    if (runFrom < 0) runFrom = f
    runTo = t
  }
  const visit = (n: SyntaxNode): void => {
    if (n.to <= from || n.from >= to) return
    const name = n.name
    if (name in SPANS) {
      flush()
      out.push(span(c, n))
    } else if (name === 'Link' || name === 'Xref') {
      flush()
      out.push(ref(c, n))
    } else if (name === 'InlineAnchor') {
      // an anchor is not text: it has no node in the ASG
      flush()
    } else if (name === 'Passthrough') {
      flush()
      out.push(textNode(c, n.from, n.to, 'raw'))
    } else if (name === 'TextLine' || name === 'ItemText' || name === 'TitleText' || name === 'DescriptionTerm') {
      for (let k = n.firstChild; k; k = k.nextSibling) visit(k)
      if (!n.firstChild) extend(Math.max(n.from, from), Math.min(n.to, to))
    } else extend(Math.max(n.from, from), Math.min(n.to, to))
  }
  for (const n of nodes) visit(n)
  flush()
  return out
}

/** A run of text as it is written: the white space at the ends of a paragraph is not part of it (Asciidoctor strips it). */
function trimmedRun(c: Ctx, from: number, to: number, first: boolean, _last: boolean): AsgRange {
  void _last
  let f = from
  if (first) while (f < to && (c.text.charCodeAt(f) === 32 || c.text.charCodeAt(f) === 9)) f++
  return [f, to]
}

function trimLast(c: Ctx, list: AsgNode[]): void {
  const last = list[list.length - 1]
  if (!last || last.name !== 'text') return
  const [f, t] = trimmed(c, last.range[0], last.range[1])
  if (c.pin) return
  if (t === last.range[1]) return
  if (t <= f) {
    list.pop()
    return
  }
  list[list.length - 1] = textNode(c, f, t)
}

function childrenOf(n: SyntaxNode): SyntaxNode[] {
  const out: SyntaxNode[] = []
  for (let k = n.firstChild; k; k = k.nextSibling) out.push(k)
  return out
}

function span(c: Ctx, n: SyntaxNode): AsgNode {
  const kids = childrenOf(n)
  const markers = kids.filter((k) => k.name === 'QuoteMarker')
  const open = markers[0]
  const close = markers[markers.length - 1]
  const innerFrom = open ? open.to : n.from
  const innerTo = close && close !== open ? close.from : n.to
  const inner = kids.filter((k) => k.name !== 'QuoteMarker' && k.name !== 'InlineAttributes')
  return withLocation(c, [n.from, n.to], {
    name: 'span',
    type: 'inline' as const,
    variant: SPANS[n.name]!,
    form: open && open.to - open.from > 1 ? 'unconstrained' : 'constrained',
    inlines: inlinesIn(c, inner, innerFrom, innerTo),
  })
}

function ref(c: Ctx, n: SyntaxNode): AsgNode {
  const kids = childrenOf(n)
  const target = kids.find((k) => k.name === 'MacroTarget')
  const label = kids.find((k) => k.name === 'MacroText')
  const targetText = target ? c.text.slice(target.from, target.to) : ''
  const inlines = label
    ? inlinesIn(c, [label], label.from, label.to)
    : n.name === 'Link' && target
      ? [textNode(c, target.from, target.to)]
      : []
  return withLocation(c, [n.from, n.to], {
    name: 'ref',
    type: 'inline' as const,
    variant: n.name === 'Link' ? 'link' : 'xref',
    target: targetText,
    inlines,
  })
}

/** The inlines of a title (`TitleText`). */
function titleInlines(c: Ctx, tt: SyntaxNode): AsgNode[] {
  const out = inlinesIn(c, [tt], tt.from, tt.to)
  trimLast(c, out)
  return out
}

/** The text lines of a block (paragraph, list item): the inlines over all of them. */
function lineInlines(c: Ctx, holder: SyntaxNode): AsgNode[] {
  const lines = childrenOf(holder).filter((k) => k.name === 'TextLine')
  if (lines.length === 0) return []
  const out = inlinesIn(c, lines, lines[0]!.from, lines[lines.length - 1]!.to)
  trimLast(c, out)
  return out
}

// ---------------------------------------------------------------- metadata

const unquote = (s: string): string => (s.length >= 2 && /^(["']).*\1$/s.test(s) ? s.slice(1, -1) : s)

/** The names of attributes that the schema of the ASG takes. */
const NAME_RX = /^\w[-\w]*$/

interface Meta {
  id: string | null
  reftext: string | null
  /** Where the reftext is in the source (without its quotes). */
  reftextAt: AsgRange | null
  title: AsgNode[] | null
  attributes: Record<string, string>
  options: string[]
  roles: string[]
  location: AsgLocation | null
  /** The first positional attribute. */
  style: string | null
  has: boolean
}

function readMeta(c: Ctx, node: SyntaxNode): Meta {
  const m: Meta = { id: null, reftext: null, reftextAt: null, title: null, attributes: {}, options: [], roles: [], location: null, style: null, has: false }
  let first = -1
  let last = -1
  for (let k = node.firstChild; k; k = k.nextSibling) {
    if (k.name === 'BlockAnchor') {
      const id = k.getChild('AnchorId')
      if (id) m.id = c.text.slice(id.from, id.to)
      const rt = k.getChild('AnchorRefText')
      if (rt) {
        m.reftext = c.text.slice(rt.from, rt.to)
        m.reftextAt = [rt.from, rt.to]
      }
    } else if (k.name === 'BlockTitle') {
      const tt = k.getChild('TitleText')
      if (tt) m.title = titleInlines(c, tt)
    } else if (k.name === 'BlockAttributes') {
      if (first < 0) first = k.from
      last = k.to
      let pos = 0
      for (let a = k.firstChild; a; a = a.nextSibling) {
        if (a.name === 'PositionalAttribute') {
          pos++
          const sh = childrenOf(a).filter((x) => x.name.startsWith('Shorthand'))
          if (sh.length > 0) {
            for (const s of sh) {
              const t = c.text.slice(s.from, s.to)
              if (s.name === 'ShorthandStyle') {
                if (pos === 1) m.style = t
              } else if (s.name === 'ShorthandId') m.id = t.slice(1)
              else if (s.name === 'ShorthandRole') m.roles.push(t.slice(1))
              else if (s.name === 'ShorthandOption') m.options.push(t.slice(1))
            }
            const styleNode = sh.find((x) => x.name === 'ShorthandStyle')
            if (styleNode && pos === 1) m.attributes['$1'] = c.text.slice(styleNode.from, styleNode.to)
            else if (pos !== 1) m.attributes[`$${pos}`] = c.text.slice(a.from, a.to)
          } else {
            const t = unquote(c.text.slice(a.from, a.to))
            if (pos === 1) m.style = t
            if (t !== '') m.attributes[`$${pos}`] = t
          }
        } else if (a.name === 'NamedAttribute') {
          const nm = a.getChild('AttributeName')
          const v = a.getChild('AttributeValue')
          if (!nm) continue
          const name = c.text.slice(nm.from, nm.to)
          const value = v ? unquote(c.text.slice(v.from, v.to)) : ''
          if (name === 'id') m.id = value
          else if (name === 'reftext') {
            m.reftext = value
            if (v) {
              const raw = c.text.slice(v.from, v.to)
              const q = raw.length >= 2 && /^(["']).*\1$/s.test(raw)
              m.reftextAt = q ? [v.from + 1, v.to - 1] : [v.from, v.to]
            } else m.reftextAt = [nm.to, nm.to]
          }
          else if (name === 'role') m.roles.push(...value.split(/\s+/).filter(Boolean))
          else if (name === 'options' || name === 'opts') m.options.push(...value.split(',').map((s) => s.trim()).filter(Boolean))
          else if (NAME_RX.test(name)) m.attributes[name] = value
        }
      }
    }
  }
  if (first >= 0) {
    m.has = Object.keys(m.attributes).length > 0 || m.options.length > 0 || m.roles.length > 0
    m.location = locate(pinless(c), trimmed(c, first, last)).location
  }
  return m
}

function pinless(c: Ctx): Ctx {
  return c.pin ? { ...c, pin: null } : c
}

function applyMeta(c: Ctx, out: Record<string, unknown>, m: Meta): void {
  if (m.id !== null && m.id !== '') out.id = m.id
  if (m.title) out.title = m.title
  if (m.reftext !== null && m.reftextAt) out.reftext = [textNode(c, m.reftextAt[0], m.reftextAt[1])]
  if (m.has && m.location) {
    out.metadata = { attributes: m.attributes, options: m.options, roles: m.roles, location: m.location }
  }
}

// ---------------------------------------------------------------- blocks

const BLOCK_NODES = new Set([
  'Section',
  'DiscreteHeading',
  'Paragraph',
  'LiteralParagraph',
  'AdmonitionParagraph',
  'StyledParagraph',
  'DelimitedBlock',
  'BlockQuote',
  'BlockMacro',
  'ThematicBreak',
  'PageBreak',
  'UnorderedList',
  'OrderedList',
  'DescriptionList',
  'CalloutList',
  'IncludeDirective',
])

const ADMONITIONS = new Set(['note', 'tip', 'important', 'warning', 'caution'])
const BLOCK_MACROS = new Set(['audio', 'video', 'image', 'toc'])

/** Where sections cannot be (the schema has them only in the document and in sections): a section becomes a heading and its blocks. */
function flattenSections(list: AsgNode[]): AsgNode[] {
  return list.flatMap((b) => {
    if (b.name !== 'section') return [b]
    const { blocks, ...rest } = b as AsgNode & { blocks?: AsgNode[] }
    return [{ ...rest, name: 'heading' } as AsgNode, ...flattenSections(blocks ?? [])]
  })
}

function blocksIn(c: Ctx, node: SyntaxNode, sections = true): AsgNode[] {
  const out: AsgNode[] = []
  for (let k = node.firstChild; k; k = k.nextSibling) {
    if (!BLOCK_NODES.has(k.name)) continue
    if (k.name === 'IncludeDirective') out.push(...(sections ? includeBlocks(c, k) : flattenSections(includeBlocks(c, k))))
    else {
      const b = block(c, k)
      if (b) out.push(b)
    }
  }
  return out
}

function blockRange(c: Ctx, n: SyntaxNode): AsgRange {
  return trimmed(c, n.from, n.to)
}

function contentText(c: Ctx, n: SyntaxNode, kind: string): AsgNode[] {
  const content = n.getChild('DelimitedContent')
  if (!content) return []
  const [f, t] = trimmed(c, content.from, content.to, false)
  if (t <= f) return []
  return [textNode(c, f, t, kind === 'pass' ? 'raw' : 'text')]
}

function block(c: Ctx, n: SyntaxNode): AsgNode | null {
  const meta = readMeta(c, n)
  const r = blockRange(c, n)
  let out: Record<string, unknown> | null
  switch (n.name) {
    case 'Section':
    case 'DiscreteHeading': {
      const section = n.name === 'Section'
      const tt = (section ? n.getChild('SectionTitle') : n)?.getChild('TitleText')
      out = {
        name: section ? 'section' : 'heading',
        type: 'block',
        title: tt ? titleInlines(c, tt) : [],
        level: (n.tree?.prop(sectionLevel) as number | undefined) ?? 1,
      }
      if (section) out.blocks = blocksIn(c, n)
      break
    }
    case 'Paragraph':
      out = { name: 'paragraph', type: 'block', inlines: lineInlines(c, n) }
      break
    case 'LiteralParagraph':
      out = { name: 'literal', type: 'block', form: 'indented', inlines: verbatim(c, n) }
      break
    case 'AdmonitionParagraph': {
      // a paragraph with a label: the schema only has admonitions with delimiters, so it stays a paragraph with the label as its style
      const marker = n.getChild('AdmonitionMarker')
      const label = marker ? c.text.slice(marker.from, marker.to).replace(/:\s*$/, '') : ''
      out = { name: 'paragraph', type: 'block', inlines: lineInlines(c, n) }
      meta.attributes['style'] = label
      meta.has = true
      meta.location ??= locate(pinless(c), [n.from, marker ? marker.to : n.from]).location
      break
    }
    case 'StyledParagraph': {
      const style = (meta.style ?? '').toLowerCase()
      const leaf: Record<string, string> = { listing: 'listing', source: 'listing', literal: 'literal', pass: 'pass', stem: 'stem', verse: 'verse' }
      const name = leaf[style]
      if (name) out = { name, type: 'block', form: 'paragraph', inlines: verbatim(c, n, name === 'pass' ? 'raw' : 'text') }
      else out = { name: 'paragraph', type: 'block', inlines: lineInlines(c, n) }
      break
    }
    case 'DelimitedBlock':
      out = delimited(c, n, meta)
      break
    case 'BlockQuote':
      out = { name: 'quote', type: 'block', form: 'delimited', delimiter: '>', blocks: blocksIn(c, n, false) }
      break
    case 'BlockMacro': {
      const name = n.getChild('MacroName')
      const target = n.getChild('MacroTarget')
      const macro = name ? c.text.slice(name.from, name.to) : ''
      if (BLOCK_MACROS.has(macro)) {
        out = { name: macro, type: 'block', form: 'macro' }
        if (target) out.target = c.text.slice(target.from, target.to)
      } else out = { name: 'paragraph', type: 'block', inlines: [textNode(c, r[0], r[1], 'raw')] }
      break
    }
    case 'ThematicBreak':
      out = { name: 'break', type: 'block', variant: 'thematic' }
      break
    case 'PageBreak':
      out = { name: 'break', type: 'block', variant: 'page' }
      break
    case 'UnorderedList':
    case 'OrderedList':
    case 'CalloutList':
      out = list(c, n)
      break
    case 'DescriptionList':
      out = dlist(c, n)
      break
    default:
      return null
  }
  if (!out) return null
  applyMeta(c, out, meta)
  // the metadata lines above a block belong to it
  return withLocation(c, r, out as { name: string; type: AsgNode['type'] })
}

/** The text of a block of lines as it is, without the indentation of the first line. */
function verbatim(c: Ctx, n: SyntaxNode, kind: 'text' | 'raw' = 'text'): AsgNode[] {
  const lines = childrenOf(n).filter((k) => k.name === 'TextLine')
  if (lines.length === 0) return []
  const [f, t] = trimmed(c, lines[0]!.from, lines[lines.length - 1]!.to)
  let from = f
  while (from < t && (c.text.charCodeAt(from) === 32 || c.text.charCodeAt(from) === 9)) from++
  return t > from ? [textNode(c, from, t, kind)] : []
}

function delimited(c: Ctx, n: SyntaxNode, meta: Meta): Record<string, unknown> | null {
  const kind = (n.tree?.prop(blockKind) as string | undefined) ?? 'open'
  const delim = n.getChild('BlockDelimiter')
  const delimiter = delim ? c.text.slice(delim.from, delim.to).trim() : ''
  switch (kind) {
    case 'comment':
      return null
    case 'listing':
    case 'literal':
    case 'pass':
    case 'stem':
    case 'verse':
      return { name: kind, type: 'block', form: 'delimited', delimiter, inlines: contentText(c, n, kind) }
    case 'table': {
      if (c.deep) return deepTable(c, n, delimiter)
      // the ASG draft has no tables: the block is a literal block that holds the source of the table
      const content = childrenOf(n).filter((k) => k.name !== 'BlockAttributes' && k.name !== 'BlockAnchor' && k.name !== 'BlockTitle' && k.name !== 'BlockDelimiter')
      const f = content[0]?.from
      const t = content[content.length - 1]?.to
      const [a, b] = f === undefined || t === undefined ? [0, 0] : trimmed(c, f, t, false)
      return { name: 'literal', type: 'block', form: 'delimited', delimiter, inlines: b > a ? [textNode(c, a, b)] : [] }
    }
    case 'admonition': {
      const s = (meta.style ?? '').toLowerCase()
      return { name: 'admonition', type: 'block', variant: ADMONITIONS.has(s) ? s : 'note', form: 'delimited', delimiter, blocks: blocksIn(c, n, false) }
    }
    case 'example':
    case 'sidebar':
    case 'open':
    case 'quote':
      return { name: kind, type: 'block', form: 'delimited', delimiter, blocks: blocksIn(c, n, false) }
    default:
      return { name: 'open', type: 'block', form: 'delimited', delimiter, blocks: blocksIn(c, n, false) }
  }
}

/**
 * A table for the checks of the operations: the source of the table without what its cells hold, and the cells, with
 * the blocks that a cell of the `a` style holds.
 */
function deepTable(c: Ctx, n: SyntaxNode, delimiter: string): Record<string, unknown> {
  const cells: unknown[] = []
  const cuts: [number, number][] = []
  for (const cell of childrenOf(n)) {
    if (cell.name !== 'TableCell') continue
    const content = cell.getChild('CellContent')
    const spec = cell.getChild('CellSpec')
    const entry: Record<string, unknown> = { spec: spec ? c.text.slice(spec.from, spec.to) : '' }
    if (content) {
      const nested = blocksIn(c, content, false)
      let from = content.from
      let to = content.to
      if (nested.length > 0) {
        // (the blank space around the blocks of a cell is not part of the frame: `a|p1` and `a|` + a line break + `p1` are one)
        const sep = cell.getChild('CellSeparator')
        while (from > (sep ? sep.to : 0) && /\s/.test(c.text[from - 1]!)) from--
        while (to < n.to && /\s/.test(c.text[to]!)) to++
        entry['blocks'] = nested
      } else entry['text'] = c.text.slice(content.from, content.to)
      cuts.push([from, to])
    }
    cells.push(entry)
  }
  let frame = ''
  let at = n.from
  for (const [f, t] of cuts) {
    frame += c.text.slice(at, f)
    at = t
  }
  frame += c.text.slice(at, n.to)
  return { name: 'literal', type: 'block', form: 'delimited', delimiter, inlines: [], frame, cells }
}

/** The blocks of a list item that come after its text. */
function itemBlocks(c: Ctx, item: SyntaxNode): AsgNode[] {
  return blocksIn(c, item, false)
}

function list(c: Ctx, n: SyntaxNode): Record<string, unknown> {
  const items = childrenOf(n).filter((k) => k.name === 'ListItem')
  const variant = n.name === 'UnorderedList' ? 'unordered' : n.name === 'OrderedList' ? 'ordered' : 'callout'
  const markerOf = (i: SyntaxNode): string => {
    const m = i.getChild('ListMarker')
    return m ? c.text.slice(m.from, m.to) : ''
  }
  return {
    name: 'list',
    type: 'block',
    variant,
    marker: items[0] ? markerOf(items[0]) : '',
    items: items.map((i) => {
      const item: Record<string, unknown> = { name: 'listItem', type: 'block', marker: markerOf(i), principal: itemText(c, i) }
      const blocks = itemBlocks(c, i)
      if (blocks.length > 0) item.blocks = blocks
      return withLocation(c, trimmed(c, i.from, i.to), item as { name: string; type: AsgNode['type'] })
    }),
  }
}

function itemText(c: Ctx, item: SyntaxNode): AsgNode[] {
  const text = item.getChild('ItemText')
  return text ? lineInlines(c, text) : []
}

function dlist(c: Ctx, n: SyntaxNode): Record<string, unknown> {
  const items = childrenOf(n).filter((k) => k.name === 'ListItem')
  const first = items[0]?.getChild('ListMarker')
  return {
    name: 'dlist',
    type: 'block',
    marker: first ? c.text.slice(first.from, first.to) : '::',
    items: items.map((i) => {
      const marker = i.getChild('ListMarker')
      const terms = childrenOf(i)
        .filter((k) => k.name === 'DescriptionTerm')
        .map((t) => inlinesIn(c, [t], t.from, t.to))
      const item: Record<string, unknown> = { name: 'dlistItem', type: 'block', marker: marker ? c.text.slice(marker.from, marker.to) : '::', terms }
      const principal = itemText(c, i)
      if (principal.length > 0) item.principal = principal
      const blocks = itemBlocks(c, i)
      if (blocks.length > 0) item.blocks = blocks
      return withLocation(c, trimmed(c, i.from, i.to), item as { name: string; type: AsgNode['type'] })
    }),
  }
}

// ---------------------------------------------------------------- include

/** What the include directive stands for: the blocks of the resolved text, or the node that refers to the file. */
function includeBlocks(c: Ctx, n: SyntaxNode): AsgNode[] {
  const target = n.getChild('DirectiveTarget')
  const path = target ? c.text.slice(target.from, target.to) : ''
  const r = trimmed(c, n.from, n.to)
  const inner = c.depth < MAX_INCLUDE_DEPTH ? resolveInclude(c.doc, n, path) : null
  if (inner) {
    const file = [...(c.file ?? []), path]
    const ctx: Ctx = {
      doc: inner,
      text: inner.text,
      starts: lineStarts(inner.text),
      file,
      pin: c.pin ?? r,
      depth: c.depth + 1,
      deep: c.deep,
    }
    return blocksIn(ctx, inner.tree.topNode)
  }
  const node = withLocation(c, r, {
    name: 'pass',
    type: 'block' as const,
    inlines: [textNode(c, r[0], r[1], 'raw')],
    metadata: { attributes: { include: path }, options: [], roles: [], location: locate(pinless(c), r).location },
  })
  return [node]
}

// ---------------------------------------------------------------- document

function authorsOf(c: Ctx, header: SyntaxNode): AsgAuthor[] {
  const out: AsgAuthor[] = []
  const line = header.getChild('AuthorLine')
  if (!line) return out
  for (let k = line.firstChild; k; k = k.nextSibling) {
    if (k.name !== 'Author') continue
    const name = k.getChild('AuthorName')
    const mail = k.getChild('AuthorEmail')
    if (!name) continue
    const fullname = c.text.slice(name.from, name.to).replace(/_/g, ' ').trim()
    const parts = fullname.split(/\s+/).filter(Boolean)
    const a: AsgAuthor = { fullname }
    if (parts.length > 0) a.firstname = parts[0]!
    if (parts.length === 2) a.lastname = parts[1]!
    else if (parts.length > 2) {
      a.middlename = parts[1]!
      a.lastname = parts.slice(2).join(' ')
    }
    a.initials = parts.map((p) => p.charAt(0)).join('')
    if (mail) a.address = c.text.slice(mail.from, mail.to)
    out.push(a)
  }
  return out
}

function headerAttributes(c: Ctx, header: SyntaxNode): Record<string, string | null> {
  const out: Record<string, string | null> = {}
  for (const e of childrenOf(header).filter((k) => k.name === 'AttributeEntry')) {
    const name = e.getChild('AttributeName')
    if (!name) continue
    const raw = c.text.slice(name.from, name.to)
    if (!NAME_RX.test(raw)) continue
    if (e.getChild('UnsetMarker')) {
      out[raw] = null
      continue
    }
    const v = e.getChild('AttributeValue')
    const parts: string[] = []
    if (v) {
      for (let k = v.firstChild; k; k = k.nextSibling) if (k.name === 'ValueText') parts.push(c.text.slice(k.from, k.to))
      if (!v.firstChild) parts.push(c.text.slice(v.from, v.to))
    }
    out[raw] = parts.reduce((acc, p, i) => (i === 0 ? p : `${acc}${acc.endsWith(' +') ? '\n' : ' '}${p}`), '')
  }
  return out
}

/** The ASG of a document. */
export function buildAsg(doc: NotaDocument, depth = 0, file: readonly string[] | null = null, pin: AsgRange | null = null, deep = false): AsgDocument {
  const c: Ctx = { doc, text: doc.text, starts: lineStarts(doc.text), file, pin, depth, deep }
  const top = doc.tree.topNode
  const out: Record<string, unknown> = { name: 'document', type: 'block' }
  const header = top.getChild('Header')
  const title = header?.getChild('DocumentTitle')
  if (header && title) {
    out.attributes = headerAttributes(c, header)
    const tt = title.getChild('TitleText')
    const h: Record<string, unknown> = { title: tt ? titleInlines(c, tt) : [] }
    const authors = authorsOf(c, header)
    if (authors.length > 0) h.authors = authors
    const r = trimmed(c, header.from, header.to)
    Object.assign(h, locate(c, r))
    out.header = h
  }
  const blocks = blocksIn(c, top)
  if (blocks.length > 0) out.blocks = blocks
  const r = trimmed(c, 0, doc.text.length)
  return withLocation(c, r, out as { name: string; type: AsgNode['type'] }) as AsgDocument
}

const deepCache = new WeakMap<NotaDocument, AsgDocument>()

/** The ASG with the tables laid open (see `deepTable`); for the checks of the operations, not for the host. */
export function deepAsg(doc: NotaDocument): AsgDocument {
  let a = deepCache.get(doc)
  if (!a) deepCache.set(doc, (a = buildAsg(doc, 0, null, null, true)))
  return a
}

// ---------------------------------------------------------------- lookup

function nodesOf(value: unknown, into: AsgNode[]): void {
  if (Array.isArray(value)) {
    for (const v of value) nodesOf(v, into)
  } else if (value && typeof value === 'object' && Array.isArray((value as AsgNode).range)) into.push(value as AsgNode)
}

/** The deepest node of the ASG whose range holds the position (the node of an included part counts as a whole). */
export function findNode(root: AsgNode, pos: number): AsgNode | null {
  const holds = (n: AsgNode, closed: boolean) => n.range[0] <= pos && (closed ? pos <= n.range[1] : pos < n.range[1])
  if (!holds(root, true)) return null
  let node = root
  for (;;) {
    if (node !== root && node.location[0].file) return node
    const kids: AsgNode[] = []
    for (const [key, v] of Object.entries(node)) if (key !== 'location' && key !== 'range' && key !== 'metadata') nodesOf(v, kids)
    const next = kids.find((k) => holds(k, false)) ?? kids.find((k) => holds(k, true))
    if (!next) return node
    node = next
  }
}
