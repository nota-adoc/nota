/**
 * Nota's side of the comparison: reads the syntax tree and emulates what Asciidoctor derives from it
 * (contexts, styles, ids, header metadata) in the dump format of format.ts.
 */
import type { SyntaxNode } from '@lezer/common'
import {
  BlockAttributes,
  type NotaDocument,
  type TableModel,
  blockKind,
  parse,
  sectionLevel,
  tableModel,
  textPieces,
} from '@nota-adoc/core'
// The revision line matcher is the linear-time port of Asciidoctor's RevisionInfoLineRx; the regular
// expression itself takes quadratic time on long lines (its equality is tested in packages/core/test/rx.test.ts).
import { processAuthors } from '../../packages/core/src/parse/authors.js'
import { matchRevisionInfoLine, resolveOrderedMarker } from '../../packages/core/src/parse/rx.js'
import { type BlockHtml, renderHtmlBlocks } from '@nota-adoc/html'
import { FIXED_DATES } from './dates.js'
import type { DumpCell, DumpEntry, DumpFile, DumpHeader, DumpNode, DumpTable, HtmlBlock } from './format.js'

const WORD = '\\p{Alphabetic}\\p{M}\\p{Nd}\\p{Pc}'
const InlineSectionAnchorRx = new RegExp(
  ` (\\\\)?\\[\\[([\\p{Alphabetic}_:][${WORD}\\-:.]*)(?:, *([^\\n]+))?\\]\\]$`,
  'u',
)

const METADATA = new Set(['BlockAttributes', 'BlockAnchor', 'BlockTitle'])
const SKIP_BEFORE_CONTENT = new Set([
  'Directive',
  'IncludeDirective',
  'DisabledLines',
  'BlockAttributes',
  'BlockAnchor',
  'BlockTitle',
  'BlankLine',
  'LineComment',
  'BlockComment',
  'AttributeEntry',
  'Mark',
])

export const VERBATIM = new Set(['literal', 'listing', 'source', 'verse'])
const STYLE_CONTEXT: Record<string, string> = {
  source: 'listing',
  listing: 'listing',
  literal: 'literal',
  verse: 'verse',
  quote: 'quote',
  example: 'example',
  sidebar: 'sidebar',
  pass: 'pass',
  open: 'open',
  abstract: 'open',
  partintro: 'open',
  NOTE: 'admonition',
  TIP: 'admonition',
  IMPORTANT: 'admonition',
  WARNING: 'admonition',
  CAUTION: 'admonition',
}

function rstrip(s: string): string {
  return s.replace(/[\0\t\n\v\f\r ]+$/, '')
}

function stripRuby(s: string): string {
  return rstrip(s).replace(/^[\0\t\n\v\f\r ]+/, '')
}

export function specialChars(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Line lookup for offsets (1-based lines, LF separated). */
export class LineIndex {
  private readonly starts: number[] = [0]
  private shift = 0
  constructor(text: string) {
    for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) this.starts.push(i + 1)
  }
  /**
   * The same lines numbered from another start: the document of a cell starts at the line Ruby reports for the cell,
   * which is not always the line the cell is on (see `cellLines`).
   */
  shifted(by: number): LineIndex {
    const out = Object.create(this) as LineIndex
    out.shift = this.shift + by
    return out
  }
  /** The offset a line starts at. */
  offset(line: number): number {
    return this.starts[line - 1 - this.shift]!
  }
  line(pos: number): number {
    let lo = 0
    let hi = this.starts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (this.starts[mid]! <= pos) lo = mid
      else hi = mid - 1
    }
    return lo + 1 + this.shift
  }
}

function children(n: SyntaxNode): SyntaxNode[] {
  const out: SyntaxNode[] = []
  for (let c = n.firstChild; c; c = c.nextSibling) out.push(c)
  return out
}

/**
 * Block attributes from the metadata children of a block or section: those before its content.
 * Metadata that ends the document belongs to no block, and a section does not take it.
 */
export function metadataOf(n: SyntaxNode, text: string): { acc: BlockAttributes; lists: string[] } {
  const acc = new BlockAttributes()
  const lists: string[] = []
  for (const c of children(n)) {
    if (!SKIP_BEFORE_CONTENT.has(c.name)) break
    if (!METADATA.has(c.name)) continue
    const line = rstrip(text.slice(c.from, c.to))
    if (c.name === 'BlockAttributes') {
      const inner = line.slice(1, -1)
      lists.push(inner)
      acc.applyList(inner)
    } else if (c.name === 'BlockAnchor') {
      const id = c.getChild('AnchorId')
      const ref = c.getChild('AnchorRefText')
      acc.applyAnchor(id ? text.slice(id.from, id.to) : null, ref ? text.slice(ref.from, ref.to) : null)
    } else {
      acc.applyTitle(line.slice(1))
    }
  }
  return { acc, lists }
}

/** First child that is not metadata, a blank line, a comment or an entry: where the block's content starts. */
export function contentStart(n: SyntaxNode): number {
  for (const c of children(n)) if (!SKIP_BEFORE_CONTENT.has(c.name)) return c.from
  return n.from
}

const DERIVED_KEYS = new Set([
  'style',
  'id',
  'role',
  'title',
  'reftext',
  'name',
  'textlabel',
  'language',
  'cloaked-context',
  'linenums',
  'attribution',
  'citetitle',
  'caption',
  'checkbox',
  'checked',
  'imagesdir',
  'default-alt',
  'target',
  'coids',
  // tables: what the table sets for the converter
  'tablepcwidth',
  'colcount',
  'rowcount',
])

/** Named attributes that were written as name=value (not derived by Asciidoctor, not options). */
export function explicitNamed(named: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(named ?? {})) {
    if (DERIVED_KEYS.has(k) || k.endsWith('-option') || /^\d+$/.test(k)) continue
    out[k] = v
  }
  return out
}

function attributeFields(acc: BlockAttributes) {
  const roles = (acc.attributes.get('role') ?? '').split(' ').filter(Boolean)
  const options: string[] = []
  const named: Record<string, string> = {}
  for (const [k, v] of acc.attributes) {
    if (k.endsWith('-option')) options.push(k.slice(0, -'-option'.length))
    else if (!/^\d+$/.test(k) && v !== null) named[k] = v
  }
  return { roles, options: options.sort(), named }
}

function sectionTitle(raw: string, explicitId: string | null): { title: string; id: string | null } {
  if (explicitId === null && raw.endsWith(']]')) {
    const m = InlineSectionAnchorRx.exec(raw)
    if (m && !m[1]) return { title: raw.slice(0, raw.length - m[0].length), id: m[2]! }
  }
  return { title: raw, id: explicitId }
}

function titleTextOf(n: SyntaxNode, text: string): string {
  const setext = n.getChild('SetextUnderline')
  const t = n.getChild('TitleText')
  if (!t) return ''
  if (setext) return unescapeDirective(rstrip(text.slice(t.from, t.to)))
  return text.slice(t.from, t.to)
}

type Meta = Map<string, string | number>

/** The reader drops the backslash of an escaped directive before the parser sees the line. */
function unescapeDirective(line: string): string {
  return /^\\(?:(?:ifdef|ifndef|ifeval|endif)::\S*?\[.*\]|include::[^\s[][^[]*\[.*\])$/.test(line)
    ? line.slice(1)
    : line
}

/**
 * Header metadata as Asciidoctor derives it: header attribute entries and the implicit author and
 * revision lines are replayed in source order (implicit values do not override earlier entries),
 * then author attributes that differ from the author line are reparsed (Parser.parse_header_metadata).
 */
function headerOf(
  doc: NotaDocument,
  header: SyntaxNode | null,
  entries: DumpEntry[],
  lines: LineIndex,
): DumpHeader {
  const text = doc.text
  const out: DumpHeader = { title: null, authors: [], revision: null }
  if (!header || !header.getChild('DocumentTitle')) return out
  const dt = header.getChild('DocumentTitle')!
  const { acc } = metadataOf(header, text)
  out.title = sectionTitle(titleTextOf(dt, text), acc.id).title
  const authorNode = header.getChild('AuthorLine')
  const revNode = header.getChild('RevisionLine')
  const authorLine = authorNode ? lines.line(authorNode.from) : Infinity
  const revLine = revNode ? lines.line(revNode.from) : Infinity
  const attrs = new Map<string, string | number>()
  let refs = false
  const apply = (e: DumpEntry) => {
    const name = normalizeName(e.name)
    if (e.value === null) attrs.delete(name)
    else {
      if (e.value.includes('{')) refs = true
      attrs.set(name, specialChars(e.value))
    }
  }
  const hdr = entries.filter((e) => e.header).sort((a, b) => a.line - b.line)
  let k = 0
  while (k < hdr.length && hdr[k]!.line < authorLine) apply(hdr[k++]!)
  let implicitAuthor: string | number | undefined
  let implicitAuthors: string | number | undefined
  if (authorNode) {
    const line = unescapeDirective(rstrip(text.slice(authorNode.from, authorNode.to)))
    if (line.includes('{')) refs = true
    const meta = processAuthors(line, false, true)
    const implicitCount = meta.get('authorcount') as number
    if (implicitCount > 0) {
      for (const [key, v] of meta)
        if (key !== 'authorcount' && !attrs.has(key)) attrs.set(key, specialChars(String(v)))
      implicitAuthor = attrs.get('author')
      implicitAuthors = attrs.get('authors')
    }
    attrs.set('authorcount', implicitCount)
  }
  while (k < hdr.length && hdr[k]!.line < revLine) apply(hdr[k++]!)
  if (revNode) {
    const line = unescapeDirective(rstrip(text.slice(revNode.from, revNode.to)))
    if (line.includes('{')) refs = true
    const m = matchRevisionInfoLine(line)!
    const rev = new Map<string, string>()
    if (m.number) rev.set('revnumber', rstrip(line.slice(...m.number)))
    const comp = stripRuby(line.slice(...m.date))
    if (comp) {
      if (!m.number && comp.startsWith('v')) rev.set('revnumber', comp.slice(1))
      else rev.set('revdate', comp)
    }
    if (m.remark) rev.set('revremark', rstrip(line.slice(...m.remark)))
    for (const [key, v] of rev) if (!attrs.has(key)) attrs.set(key, specialChars(v))
  }
  while (k < hdr.length) apply(hdr[k++]!)
  // author attribute entries that override (or stand in for) the author line
  let meta: Meta | null = null
  if (attrs.has('author') && attrs.get('author') !== implicitAuthor) {
    meta = processAuthors(String(attrs.get('author')), true, false)
    if (attrs.get('authorinitials') !== undefined) meta.delete('authorinitials')
  } else if (attrs.has('authors') && attrs.get('authors') !== implicitAuthors) {
    meta = processAuthors(String(attrs.get('authors')), true, true)
  }
  if (meta && (meta.get('authorcount') as number) > 0) {
    for (const [key, v] of meta) attrs.set(key, v)
    if (!attrs.has('email') && attrs.has('email_1')) attrs.set('email', attrs.get('email_1')!)
  }
  const count = Number(attrs.get('authorcount') ?? 0)
  const str = (v: string | number | undefined) => (v === undefined ? null : String(v))
  if (count === 1) out.authors.push({ name: str(attrs.get('author')), email: str(attrs.get('email')) })
  else
    for (let i = 1; i <= count; i++)
      out.authors.push({ name: str(attrs.get(`author_${i}`)), email: str(attrs.get(`email_${i}`)) })
  if (attrs.has('revnumber') || attrs.has('revdate') || attrs.has('revremark'))
    out.revision = {
      number: str(attrs.get('revnumber')),
      date: str(attrs.get('revdate')),
      remark: str(attrs.get('revremark')),
    }
  if (refs) out.attrRefs = true
  out.endLine = lines.line(Math.max(header.from, header.to - 1))
  return out
}

export function normalizeName(raw: string): string {
  let name = raw
  if (name.endsWith('!')) name = name.slice(0, -1)
  else if (name.startsWith('!')) name = name.slice(1)
  name = name.replace(new RegExp(`[^${WORD}\\-]`, 'gu'), '').toLowerCase()
  if (name === 'numbered') return 'sectnums'
  if (name === 'hardbreaks') return 'hardbreaks-option'
  return name
}

function entryOf(n: SyntaxNode, text: string, lines: LineIndex, headerEnd: number): DumpEntry {
  const m = /^:(!?[^:]+):/.exec(text.slice(n.from, n.to))!
  const rawName = m[1]!
  const unset = rawName.startsWith('!') || rawName.endsWith('!')
  let value: string | null = null
  if (!unset) {
    value = ''
    const v = n.getChild('AttributeValue')
    if (v) {
      let first = true
      for (const c of children(v)) {
        if (c.name !== 'ValueText') continue
        const part = text.slice(c.from, c.to)
        value = first ? part : `${value}${value.endsWith(' +') ? '\n' : ' '}${part}`
        first = false
      }
    }
  }
  return { line: lines.line(n.from), name: rawName, value, header: n.from < headerEnd }
}

/** Where Asciidoctor finalizes the header: end of the Header with a title, else the first content line. */
function headerEndOf(top: SyntaxNode): number {
  const header = top.getChild('Header')
  if (header?.getChild('DocumentTitle')) return header.to
  for (const c of children(top)) {
    if (c.name === 'Header' || SKIP_BEFORE_CONTENT.has(c.name) || c.name === 'ByteOrderMark') continue
    if (c.name === 'Section') return c.getChild('SectionTitle')?.from ?? c.from
    return contentStart(c)
  }
  return top.to
}

const LIST_TYPES: Record<string, string> = {
  UnorderedList: 'ulist',
  OrderedList: 'olist',
  DescriptionList: 'dlist',
  CalloutList: 'colist',
}
const PARAGRAPHS = new Set(['Paragraph', 'LiteralParagraph', 'AdmonitionParagraph', 'StyledParagraph'])
const CONTEXT_OF_DELIMITER: Record<string, string> = {
  '--': 'open',
  '----': 'listing',
  '....': 'literal',
  '====': 'example',
  '****': 'sidebar',
  ____: 'quote',
  '++++': 'pass',
  '```': 'fenced_code',
}
const STEM_ALIASES: Record<string, string> = { latexmath: 'latexmath', latex: 'latexmath', tex: 'latexmath' }

export interface NotaDumpOptions {
  /** The document attributes of the parse (for `source-language` and `stem`). */
  attributes?: Record<string, string>
}

interface Ctx {
  /** The document attributes that change what a block is (source-language, stem), as entries set them so far. */
  attrs: Map<string, string>
  text: string
  lines: LineIndex
  headerEnd: number
  entries: DumpEntry[]
  nodes: DumpNode[]
  includeLines: number[]
  opts: NotaDumpOptions
}

interface Walk {
  /** Line of the enclosing section title (0 for the document). */
  parent: number
  depth: number
  listLevel: number
  /** Inside a container (delimited block, list item, Markdown quote). */
  nested: boolean
  /** The style of the section the blocks are directly in (a bibliography section makes its lists bibliographies). */
  sectionStyle?: string | null
  /** The section the blocks are directly in: its level and the number of blocks seen so far. */
  sec?: { level: number; count: number }
}

export function notaDump(doc: NotaDocument, file: string, opts: NotaDumpOptions = {}): DumpFile {
  const text = doc.text
  const top = doc.tree.topNode
  const ctx: Ctx = {
    attrs: new Map(Object.entries(opts.attributes ?? {})),
    text,
    lines: new LineIndex(text),
    headerEnd: headerEndOf(top),
    entries: [],
    nodes: [],
    includeLines: [],
    opts,
  }
  visit(ctx, top, { parent: 0, depth: 0, listLevel: 0, nested: false })
  return {
    file,
    header: headerOf(doc, top.getChild('Header'), ctx.entries, ctx.lines),
    entries: ctx.entries,
    nodes: ctx.nodes,
    includeLines: includeLinesOf(doc, ctx.lines),
    hiddenAfter: hiddenAfter(doc, ctx.lines),
    html: htmlOf(doc, ctx.lines, ctx.nodes),
  }
}

/** The HTML of the document and of each block, from Nota's converter: every block with its lines. */
function htmlOf(structure: NotaDocument, lines: LineIndex, nodes: DumpNode[]): DumpFile['html'] {
  // the references write their HTML with the default attributes (the structure dump unsets `sectids`)
  const r = renderHtmlBlocks(
    parse(structure.text, { blockMacros: structure.options.blockMacros, attributes: FIXED_DATES }),
  )
  const conv = (b: BlockHtml): HtmlBlock => {
    const line = lines.line(b.from)
    const end = lines.line(Math.max(b.from, b.to - 1))
    const inRange = (n: DumpNode) => n.line !== null && n.line >= line! && n.line <= end!
    // a table holds the lists of its `a` cells in its own HTML: the cells' lists count for it
    const cellBlocks = (n: DumpNode): DumpNode[] =>
      [n.table?.rows.head, n.table?.rows.body, n.table?.rows.foot]
        .flatMap((rows) => rows ?? [])
        .flatMap((row) => row)
        .flatMap((cell) => cell.blocks ?? [])
    const explicit =
      (b.context === 'olist' || b.context === 'table') &&
      nodes.some(
        (n) =>
          (n.context === 'olist' && n.explicit && inRange(n)) ||
          (n.context === 'table' && inRange(n) && cellBlocks(n).some((k) => k.context === 'olist' && k.explicit)),
      )
    return {
      context: b.context,
      line,
      end,
      html: b.html,
      blocks: b.blocks.map(conv),
      ...(explicit ? { explicit: true } : {}),
    }
  }
  return { doc: r.html, blocks: r.blocks.map(conv) }
}

/** The lines of the `include::` directives. */
function includeLinesOf(doc: NotaDocument, lines: LineIndex): number[] {
  const out: number[] = []
  const cursor = doc.tree.cursor()
  do {
    if (cursor.name === 'IncludeDirective') out.push(lines.line(cursor.from))
  } while (cursor.next())
  return out
}

const HIDDEN = new Set(['DisabledLines', 'Directive', 'IncludeDirective'])

/** For each line, the number of whole lines the preprocessor dropped right after it. */
function hiddenAfter(doc: NotaDocument, lines: LineIndex): Record<string, number> {
  const text = doc.text
  const out: Record<string, number> = {}
  const cursor = doc.tree.cursor()
  const runs: [number, number][] = []
  do {
    if (!HIDDEN.has(cursor.name)) continue
    // a one-line condition keeps the rest of its line: only whole lines count
    if (cursor.to < text.length && text[cursor.to - 1] !== '\n') continue
    const from = lines.line(cursor.from)
    const to = lines.line(Math.max(cursor.from, cursor.to - 1))
    const last = runs[runs.length - 1]
    if (last && last[1] + 1 >= from) last[1] = Math.max(last[1], to)
    else runs.push([from, to])
  } while (cursor.next())
  for (const [from, to] of runs) out[String(from - 1)] = to - from + 1
  return out
}

/**
 * Entries and include directives among the metadata of a block (the children above its content): they
 * belong to the level the block is on. The children of a container that are its content are visited.
 */
function entriesOf(ctx: Ctx, c: SyntaxNode, nested: boolean): void {
  for (const e of outerChildren(ctx, c)) {
    if (e.name === 'AttributeEntry') pushEntry(ctx, e, nested)
  }
}

const TRACKED = new Set(['source-language', 'stem'])

function pushEntry(ctx: Ctx, e: SyntaxNode, nested: boolean): void {
  const entry = { ...entryOf(e, ctx.text, ctx.lines, ctx.headerEnd), nested: nested || undefined }
  ctx.entries.push(entry)
  const name = normalizeName(entry.name)
  if (TRACKED.has(name)) {
    if (entry.value === null) ctx.attrs.delete(name)
    else ctx.attrs.set(name, entry.value)
  }
}

const CONTAINERS = new Set(['DelimitedBlock', 'BlockQuote', 'ListItem'])

/** The children of a block that are not its content. */
function outerChildren(ctx: Ctx, c: SyntaxNode): SyntaxNode[] {
  const all = children(c)
  if (!CONTAINERS.has(c.name)) return all
  if (c.name === 'ListItem') return []
  if (c.name === 'DelimitedBlock') {
    const k = all.findIndex((x) => x.name === 'BlockDelimiter')
    return k < 0 ? all : all.slice(0, k)
  }
  // a Markdown quote: entries whose line does not begin with `>` are above it
  return all.filter(
    (x) => x.name === 'AttributeEntry' && ctx.text[ctx.text.lastIndexOf('\n', x.from - 1) + 1] !== '>',
  )
}

/** The children of a container that are its content. */
function contentChildren(ctx: Ctx, c: SyntaxNode): SyntaxNode[] {
  const all = children(c)
  if (!CONTAINERS.has(c.name)) return all
  if (c.name === 'ListItem') return all
  if (c.name === 'DelimitedBlock') {
    const k = all.findIndex((x) => x.name === 'BlockDelimiter')
    return k < 0 ? [] : all.slice(k + 1)
  }
  const outer = new Set(outerChildren(ctx, c).map((x) => x.from))
  return all.filter((x) => !outer.has(x.from))
}

/** Walks the children of a container: sections, blocks, entries and directives. */
function visit(ctx: Ctx, container: SyntaxNode, w: Walk): void {
  const { text, lines } = ctx
  for (const c of contentChildren(ctx, container)) {
    switch (c.name) {
      case 'Header':
        for (const e of children(c)) if (e.name === 'AttributeEntry') pushEntry(ctx, e, false)
        break
      case 'AttributeEntry':
        pushEntry(ctx, c, w.nested)
        break
      case 'ItemText':
        // the text of a description list item may hold entries: the item is not read as text only
        for (const e of children(c)) if (e.name === 'AttributeEntry') pushEntry(ctx, e, true)
        break
      case 'Section': {
        const t = c.getChild('SectionTitle')!
        const { acc, lists } = metadataOf(c, text)
        const line = lines.line(t.from)
        const { title, id } = sectionTitle(titleTextOf(t, text), acc.id)
        ctx.nodes.push({
          context: 'section',
          line,
          start: lines.line(c.from),
          end: lines.line(Math.max(t.from, t.to - 1)),
          attrRefs: lists.some((l) => l.includes('{')),
          parent: w.parent,
          depth: w.depth,
          level: c.tree?.prop(sectionLevel) ?? -1,
          title,
          style: acc.shownStyle,
          id,
          ...attributeFields(acc),
        })
        // the entries above the section title belong to it; those in the section are visited in order
        for (const e of children(c)) {
          if (e.from >= t.from) break
          if (e.name === 'AttributeEntry') pushEntry(ctx, e, false)
        }
        visit(ctx, c, {
          ...w,
          parent: line,
          depth: w.depth + 1,
          sectionStyle: acc.style,
          sec: { level: c.tree?.prop(sectionLevel) ?? -1, count: 0 },
        })
        break
      }
      default:
        block(ctx, c, w)
    }
  }
}

/** Emits the node of a block (and the nodes below it). */
function block(ctx: Ctx, c: SyntaxNode, w: Walk): void {
  const { text, lines } = ctx
  const kindName = c.name
  if (PARAGRAPHS.has(kindName) || kindName === 'DiscreteHeading') {
    entriesOf(ctx, c, w.nested)
    const node = paragraphNode(c, text, lines, w, ctx)
    if (node) {
      ctx.nodes.push(node)
      // the first block of a part that is a paragraph with the partintro style becomes an open block that
      // holds a paragraph of its own (Asciidoctor wraps it when it reads the part)
      if (node.context === 'open' && node.style === 'partintro' && w.sec?.level === 0 && w.sec.count === 0) {
        const n = node.lines
        node.content_model = 'compound'
        delete node.lines
        ctx.nodes.push({
          context: 'paragraph',
          line: null,
          parent: w.parent,
          depth: w.depth + 1,
          style: null,
          id: null,
          content_model: 'simple',
          lines: n,
          roles: [],
          options: [],
          named: {},
        })
      }
    }
    if (w.sec && !w.nested) w.sec.count++
    return
  }
  if (kindName === 'DelimitedBlock') return delimited(ctx, c, w)
  if (kindName === 'BlockQuote') {
    entriesOf(ctx, c, w.nested)
    ctx.nodes.push({
      ...base(c, text, lines, w),
      context: 'quote',
      style: 'quote',
      content_model: 'compound',
      markdown: true,
    })
    visit(ctx, c, { ...w, depth: w.depth + 1, nested: true })
    return
  }
  if (kindName === 'ThematicBreak' || kindName === 'PageBreak') {
    entriesOf(ctx, c, w.nested)
    ctx.nodes.push({
      ...base(c, text, lines, w),
      context: kindName === 'PageBreak' ? 'page_break' : 'thematic_break',
      style: metadataOf(c, text).acc.style,
      content_model: 'empty',
    })
    return
  }
  if (kindName === 'BlockMacro') {
    entriesOf(ctx, c, w.nested)
    ctx.nodes.push(macroNode(c, text, lines, w))
    return
  }
  const listContext = LIST_TYPES[kindName]
  if (listContext) return list(ctx, c, listContext, w)
}

function base(c: SyntaxNode, text: string, lines: LineIndex, w: Walk): DumpNode & { context: string } {
  const { acc, lists } = metadataOf(c, text)
  const start = contentStart(c)
  return {
    context: '',
    line: lines.line(start),
    start: lines.line(c.from),
    parent: w.parent,
    depth: w.depth,
    id: acc.id,
    end: lines.line(Math.max(c.from, c.to - 1)),
    attrRefs: lists.some((l) => l.includes('{')),
    ...attributeFields(acc),
  }
}

/** The lines of the text of a node: a `TextLine` that spans lines (a construct crosses them) counts each of them. */
function textLinesOf(n: SyntaxNode, text: string): string[] {
  const out: string[] = []
  for (const x of children(n)) {
    if (x.name !== 'TextLine') continue
    const own = x.tree?.prop(textPieces)
    if (own) for (let i = 0; i < own.length; i += 2) out.push(text.slice(own[i]!, own[i + 1]!))
    else out.push(rstrip(text.slice(x.from, x.to)))
  }
  return out
}

function paragraphNode(c: SyntaxNode, text: string, lines: LineIndex, w: Walk, opts: Ctx): DumpNode | null {
  const { acc } = metadataOf(c, text)
  const style = acc.style
  const b = { ...base(c, text, lines, w), style: acc.shownStyle }
  const textLines = textLinesOf(c, text).length
  switch (c.name) {
    case 'DiscreteHeading': {
      const { title, id } = sectionTitle(titleTextOf(c, text), acc.id)
      return { ...b, context: 'floating_title', level: c.tree?.prop(sectionLevel) ?? -1, title, id }
    }
    case 'LiteralParagraph':
      return { ...b, context: 'literal', lines: textLines }
    case 'AdmonitionParagraph': {
      const marker = c.getChild('AdmonitionMarker')!
      return {
        ...b,
        context: 'admonition',
        style: text.slice(marker.from, marker.to).split(':')[0],
        lines: textLines,
      }
    }
    case 'StyledParagraph': {
      if (style === 'comment') return null
      const context = STYLE_CONTEXT[style!] ?? 'paragraph'
      if (context === 'listing') {
        // a listing paragraph: a `source` style takes the language from the second positional attribute
        const language =
          style === 'source' || !acc.attributes.get('1')
            ? (acc.attributes.get('2') ?? opts.attrs.get('source-language') ?? null)
            : null
        return { ...b, context, lines: textLines, language: style === 'source' || language ? language : null }
      }
      return { ...b, context, lines: textLines }
    }
    default: {
      // air quote: "text" followed by a line "-- attribution"
      const ls = textLinesOf(c, text)
      if (
        ls.length > 1 &&
        ls[0]!.startsWith('"') &&
        ls[ls.length - 1]!.startsWith('-- ') &&
        ls[ls.length - 2]!.endsWith('"')
      )
        return { ...b, context: 'quote', style: 'quote', lines: ls.length - 1 }
      return { ...b, context: 'paragraph', lines: textLines }
    }
  }
}

/** Lines of text of the leaves of a node, not counting the ones that only hold comments. */
function countLines(text: string, nodes: SyntaxNode[]): number {
  let n = 0
  for (const c of nodes) {
    const ls = text.slice(c.from, c.to).split('\n')
    if (ls[ls.length - 1] === '') ls.pop()
    // Asciidoctor's reader drops the blank lines at the end of the document
    if (c.to === text.length) while (ls.length && rstrip(ls[ls.length - 1]!).length === 0) ls.pop()
    n += ls.length
  }
  return n
}

function delimited(ctx: Ctx, c: SyntaxNode, w: Walk): void {
  const { text, lines } = ctx
  entriesOf(ctx, c, w.nested)
  const kind = c.tree?.prop(blockKind) ?? 'listing'
  const { acc } = metadataOf(c, text)
  const opening = children(c).find((x) => x.name === 'BlockDelimiter')!
  const openText = rstrip(text.slice(opening.from, opening.to))
  const fenced = openText.startsWith('```')
  const tip = fenced ? '```' : openText.length > 4 ? openText.slice(0, 4) : openText
  const delimiterContext =
    CONTEXT_OF_DELIMITER[tip.startsWith('--') && tip.length === 2 ? '--' : tip] ?? 'table'
  // Parser.next_block: the style may change the context of the block
  // (an unknown style is ignored for the context, but stays the style of the block)
  const style = acc.style ?? delimiterContext
  const contentNodes = children(c).filter((x) => x.name === 'DelimitedContent')
  const b = { ...base(c, text, lines, w), style, delimited: true, markdown: fenced || undefined }
  const attrs = acc.attributes
  let node: DumpNode
  switch (kind) {
    case 'listing': {
      let language: string | null = null
      let s = style
      if (fenced) {
        s = 'source'
        const lang = children(c).find((x) => x.name === 'CodeLanguage')
        language = lang ? text.slice(lang.from, lang.to) : (ctx.attrs.get('source-language') ?? null)
      } else if (style === 'source') {
        language = attrs.get('2') ?? ctx.attrs.get('source-language') ?? null
      } else {
        // a listing with a language but no style (`[,ruby]`) is a source block
        const positional1 = attrs.get('1')
        const lang = positional1 ? null : (attrs.get('2') ?? ctx.attrs.get('source-language') ?? null)
        if (lang) {
          s = 'source'
          language = lang
        }
      }
      node = {
        ...b,
        context: 'listing',
        style: s,
        content_model: 'verbatim',
        lines: countLines(text, contentNodes),
        language,
      }
      break
    }
    case 'literal':
      node = { ...b, context: 'literal', content_model: 'verbatim', lines: countLines(text, contentNodes) }
      break
    case 'verse':
      node = { ...b, context: 'verse', content_model: 'verbatim', lines: countLines(text, contentNodes) }
      break
    case 'pass':
      node = { ...b, context: 'pass', content_model: 'raw', lines: countLines(text, contentNodes) }
      break
    case 'stem': {
      const stem =
        style === 'stem'
          ? (STEM_ALIASES[attrs.get('2') ?? ctx.attrs.get('stem') ?? ''] ?? 'asciimath')
          : style
      node = {
        ...b,
        context: 'stem',
        style: stem,
        content_model: 'raw',
        lines: countLines(text, contentNodes),
      }
      break
    }
    case 'table': {
      // Parser.next_block: `,===` and `:===` give the format when the attribute list has none
      const named = { ...b.named }
      if (named.format === undefined && (tip[0] === ',' || tip[0] === ':'))
        named.format = tip[0] === ',' ? 'csv' : 'dsv'
      node = {
        ...b,
        named,
        context: 'table',
        // (a style that is none of a table's stays, as for the blocks that Asciidoctor does not know it for)
        style: acc.style ?? 'table',
        content_model: 'compound',
        table: tableOf(ctx, c, named.format ?? 'psv'),
      }
      break
    }
    case 'comment':
      return
    default:
      // example, sidebar, quote, open, admonition
      node = { ...b, context: kind, content_model: 'compound' }
  }
  ctx.nodes.push(node)
  if (
    kind !== 'listing' &&
    kind !== 'literal' &&
    kind !== 'verse' &&
    kind !== 'pass' &&
    kind !== 'stem' &&
    kind !== 'table'
  )
    visit(ctx, c, { ...w, depth: w.depth + 1, nested: true })
}

/**
 * The line Ruby reports for each cell of a table (`Table::Cell#source_location`), which is not the line the cell starts
 * at. The cell gets the cursor of the reader when the cell before it (in the order of the text) was closed: for PSV the
 * line of the separator that started the cell (the copies of a repeated cell after the first: the line of the separator
 * that closed the repeat), for CSV and DSV the line where the cell before it ended, so the first cell of every line
 * after the first is reported one line behind. The reader of the table has no comment lines (`//`): they are taken out
 * when the lines are read, and the lines are counted without them.
 */
function cellLines(ctx: Ctx, c: SyntaxNode, model: TableModel, format: string) {
  const out = new Map<object, number>()
  const text = ctx.text
  // the opening line of the table: the block may begin with lines of attributes and a title
  const delimiter = /^[|!,:]={3,}$/
  const lineAt = (at: number): string => {
    const end = text.indexOf('\n', at)
    return text.slice(at, end < 0 || end > c.to ? c.to : end).trim()
  }
  let openAt = c.from
  while (!delimiter.test(lineAt(openAt))) {
    const nl = text.indexOf('\n', openAt)
    if (nl < 0 || nl >= c.to) return out
    openAt = nl + 1
  }
  const opening = lineAt(openAt)
  const firstLine = ctx.lines.line(openAt)
  const comments: number[] = []
  let last = ctx.lines.line(c.to - 1)
  const closing = text.slice(text.lastIndexOf('\n', c.to - 2) + 1, c.to).trim()
  if (last > firstLine && closing === opening) last--
  for (let l = firstLine + 1; l <= last; l++) {
    const at = ctx.lines.offset(l)
    if (text.startsWith('//', at) && !text.startsWith('///', at)) comments.push(l)
  }
  const adj = (l: number): number => {
    let n = 0
    for (const k of comments) {
      if (k >= l) break
      n++
    }
    return l - n
  }
  // (the cells that were left out with their row are read too: they end the cell before them)
  const read = [
    ...[...model.rows.head, ...model.rows.body, ...model.rows.foot]
      .flatMap((r) => r.cells)
      .map((c, i) => ({ cell: c as { from: number; to: number }, rank: i })),
    ...model.dropped.map((d) => ({ cell: d, rank: d.after - 0.5 })),
  ].sort((a, b) => a.cell.from - b.cell.from || a.rank - b.rank)
  const cells = read.map((r) => r.cell)
  const psv = format === 'psv'
  const own = (pos: number): number => adj(ctx.lines.line(c.from + pos))
  // the line the reader was at when the cell was closed
  const closedAt = (i: number): number => {
    const cell = cells[i]!
    if (psv) {
      let j = i + 1
      while (j < cells.length && cells[j]!.from === cell.from) j++
      return j < cells.length ? own(cells[j]!.from) : adj(last)
    }
    return own(cell.to > cell.from ? cell.to - 1 : cell.from)
  }
  cells.forEach((cell, i) => {
    out.set(cell, i === 0 ? own(cell.from) : closedAt(i - 1))
  })
  return out
}

/**
 * The layout of a table as the parser worked it out, and for each cell with the `a` style the blocks of the document in
 * it (the nodes of its `CellContent`, over the source). What the cells set is not seen outside them: entries in them
 * are not entries of the document.
 */
function tableOf(ctx: Ctx, c: SyntaxNode, format: string): DumpTable | undefined {
  const model = c.tree?.prop(tableModel)
  if (!model) return undefined
  const lineOf = cellLines(ctx, c, model, format)
  const contents = new Map<number, SyntaxNode>()
  for (const cell of children(c)) {
    if (cell.name !== 'TableCell') continue
    const content = children(cell).find((x) => x.name === 'CellContent')
    if (content) contents.set(content.from, content)
  }
  const cellOf = (m: (typeof model.rows.body)[number]['cells'][number]): DumpCell => {
    const out: DumpCell = {
      row: m.row,
      column: m.column,
      colspan: m.colspan,
      rowspan: m.rowspan,
      halign: m.halign,
      valign: m.valign,
      style: m.style,
      line: lineOf.get(m) ?? ctx.lines.line(c.from + m.from),
      text: m.text,
    }
    if (m.style === 'asciidoc') {
      const inner: Ctx = { ...ctx, attrs: new Map(ctx.attrs), entries: [], nodes: [], includeLines: [] }
      // Ruby gives the first line of the text of the document the cursor of the cell, moved on by the leading line
      // breaks it took off (PSV only: `Table::Cell#initialize`). The text of a CSV or DSV cell was stripped before that
      // (`ParserContext#close_cell`), inside the quotes too, and it moves the cursor by nothing.
      let textAt = c.from + m.contentFrom
      let advanced = 0
      if (format === 'psv') {
        const gap = ctx.text.slice(c.from + m.from, textAt).match(/\s*$/)![0]
        if (gap.startsWith('\n')) advanced = gap.length - gap.replace(/^\n+/, '').length
      } else {
        // the cell as written, with its quotes: `from` of a cell after the first is its separator, not its text
        const end = c.from + m.contentTo
        const skip = (at: number): number => {
          while (at < end && /\s/.test(ctx.text[at]!)) at++
          return at
        }
        textAt = skip(c.from + m.contentFrom)
        // the parser takes the quotes off only when the cell has them at both ends (`table.ts`, `lstripAt`/`rstripAt`)
        if (end - textAt >= 2 && ctx.text[textAt] === '"' && ctx.text[end - 1] === '"')
          textAt = skip(textAt + 1)
      }
      const moved = (lineOf.get(m) ?? 0) + advanced - ctx.lines.line(textAt)
      if (lineOf.has(m) && moved !== 0) inner.lines = ctx.lines.shifted(moved)
      const content = contents.get(c.from + m.contentFrom)
      if (content) visit(inner, content, { parent: 0, depth: 0, listLevel: 0, nested: true })
      out.blocks = inner.nodes
    }
    return out
  }
  return {
    columns: model.columns.map((col) => ({
      width: col.width,
      halign: col.halign,
      valign: col.valign,
      style: col.style,
      autowidth: col.autowidth,
    })),
    rows: {
      head: model.rows.head.map((r) => r.cells.map(cellOf)),
      body: model.rows.body.map((r) => r.cells.map(cellOf)),
      foot: model.rows.foot.map((r) => r.cells.map(cellOf)),
    },
  }
}

/** Block macro: image, video, audio and toc. */
function macroNode(c: SyntaxNode, text: string, lines: LineIndex, w: Walk): DumpNode {
  const b = base(c, text, lines, w)
  const nameNode = c.getChild('MacroName')!
  const name = text.slice(nameNode.from, nameNode.to)
  const targetNode = c.getChild('MacroTarget')
  const target = targetNode ? text.slice(targetNode.from, targetNode.to) : ''
  const posNames =
    name === 'image' ? ['alt', 'width', 'height'] : name === 'video' ? ['poster', 'width', 'height'] : []
  const named: Record<string, string> = {}
  const options: string[] = []
  let index = 0
  for (const a of children(c)) {
    if (a.name === 'PositionalAttribute') {
      const raw = text.slice(a.from, a.to)
      const value = unquote(raw)
      const nm = posNames[index]
      if (nm !== undefined && value !== '') named[nm] = value
      index++
    } else if (a.name === 'NamedAttribute') {
      const k = a.getChild('AttributeName')
      const v = a.getChild('AttributeValue')
      if (!k) continue
      const key = text.slice(k.from, k.to)
      const value = v ? unquote(text.slice(v.from, v.to)) : ''
      if (key === 'opts' || key === 'options') {
        for (const o of value.split(',')) if (o.trim()) options.push(o.trim())
      } else named[key] = value
    }
  }
  const { acc } = metadataOf(c, text)
  if (name === 'image') {
    if (named.alt === undefined) named.alt = acc.style ?? basename(target).replace(/[_-]/g, ' ')
    if (named.scaledwidth !== undefined && /\d$/.test(named.scaledwidth)) named.scaledwidth += '%'
  }
  for (const [k, v] of Object.entries(attributeFields(acc).named))
    if (!(k in named) && !DERIVED_KEYS.has(k)) named[k] = v
  // the `id` in the brackets of the macro wins over the anchor above it, and is no named attribute
  const macroId = named.id
  delete named.id
  return {
    ...b,
    id: macroId ?? b.id,
    // a reference in the brackets is substituted by Asciidoctor: not compared
    attrRefs: b.attrRefs || text.slice(c.from, c.to).includes('{'),
    context: name,
    // the style of an attribute line above stays the style of a toc macro; media macros drop it
    style: name === 'toc' ? acc.style : null,
    content_model: 'empty',
    target: name === 'toc' ? undefined : target,
    roles: [...(b.roles ?? []), ...(named.role ?? '').split(' ').filter(Boolean)],
    options: [...new Set([...options, ...(b.options ?? [])])].sort(),
    named,
  }
}

function unquote(raw: string): string {
  if (raw.length >= 2 && (raw[0] === '"' || raw[0] === "'") && raw[raw.length - 1] === raw[0])
    return raw.slice(1, -1)
  return raw
}

function basename(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1)
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(0, dot) : base
}

function list(ctx: Ctx, c: SyntaxNode, context: string, w: Walk): void {
  const { text, lines } = ctx
  entriesOf(ctx, c, w.nested)
  const items = children(c).filter((x) => x.name === 'ListItem')
  const { acc } = metadataOf(c, text)
  const b = base(c, text, lines, w)
  // (an ordered list takes the default style of its marker when the style is wiped: Asciidoctor sets it from the list)
  let style: string | null = context === 'olist' ? acc.style : acc.shownStyle
  if (!style && context === 'ulist' && !w.nested && w.sectionStyle === 'bibliography') style = 'bibliography'
  const first = items[0]
  if (context === 'olist' && first) {
    const marker = first.getChild('ListMarker')
    const m = marker ? text.slice(marker.from, marker.to) : '.'
    if (!style) {
      const r = resolveOrderedMarker(m, 0)
      style =
        r.style ??
        ['arabic', 'loweralpha', 'lowerroman', 'upperalpha', 'upperroman'][m.length - 1] ??
        'arabic'
    }
  } else if (context === 'colist') style = 'arabic'
  // (a bibliography list has no checklist: the box stays in the text)
  const checklist =
    context === 'ulist' && style !== 'bibliography' && items.some((i) => i.getChild('Checkbox'))
  const options = new Set(b.options)
  if (checklist) options.add('checklist')
  // Asciidoctor marks each item of a callout list, so the source location of the list is that of its last item
  const listLine = context === 'colist' && items.length ? lines.line(items[items.length - 1]!.from) : b.line
  ctx.nodes.push({
    ...b,
    line: listLine,
    context,
    style,
    content_model: 'compound',
    list_level: w.listLevel,
    items: items.length,
    options: [...options].sort(),
    named: checklist ? { ...b.named, 'checklist-option': '' } : b.named,
    ...(context === 'olist' && (b.named?.start !== undefined || acc.style) ? { explicit: true } : {}),
  })
  const inner: Walk = { ...w, depth: w.depth + 1, nested: true }
  let ordinal = 0
  for (const item of items) {
    const markerNode = item.getChild('ListMarker')
    const marker = markerNode ? text.slice(markerNode.from, markerNode.to) : ''
    const parts = children(item)
    const itemText = parts.filter((x) => x.name === 'ItemText')
    const textLines = itemText.reduce((n, t) => n + textLinesOf(t, text).length, 0)
    const node: DumpNode = {
      context: 'list_item',
      line: lines.line(item.from),
      parent: w.parent,
      depth: w.depth + 1,
      style: null,
      id: null,
      content_model: 'compound',
      end: lines.line(Math.max(item.from, item.to - 1)),
      roles: [],
      options: [],
      named: {},
      text_lines: textLines,
      checkbox: false,
      checked: false,
    }
    if (context === 'dlist') {
      node.marker = null
      node.terms = parts.filter((x) => x.name === 'DescriptionTerm').map((x) => text.slice(x.from, x.to))
    } else {
      node.marker =
        context === 'ulist'
          ? marker
          : context === 'olist'
            ? resolveOrderedMarker(marker, ordinal).marker
            : '<1>'
      const box = style === 'bibliography' ? null : item.getChild('Checkbox')
      if (box) {
        node.checkbox = true
        node.checked = text[box.from + 1] !== ' '
        node.named = { checkbox: '', ...(node.checked ? { checked: '' } : {}) }
      }
    }
    ctx.nodes.push(node)
    entriesOf(ctx, item, true)
    visit(ctx, item, { ...inner, depth: w.depth + 2, listLevel: w.listLevel + 1 })
    ordinal++
  }
}
