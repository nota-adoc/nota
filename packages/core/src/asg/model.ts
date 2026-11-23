/**
 * The blocks of a document as Asciidoctor sees them, read from the syntax tree of nota: contexts, styles, ids,
 * attributes, titles, the text of paragraphs and list items, section numbers and the catalog of references.
 * The converter (convert.ts) turns this model into HTML.
 */
import type { SyntaxNode } from '@lezer/common'
import {
  type InlineEnv,
  NORMAL_SUBS,
  blockSubs,
  substitute,
  textPieces,
} from '../parse/inline/index.js'
import { BlockAttributes, parseAttributeList } from '../parse/attrlist.js'
import type { NotaDocument } from '../document.js'
import {
  type TableCellModel,
  type TableModel,
  blockKind,
  sectionLevel,
  tableModel,
} from '../nodes.js'
import { AttributeTracker, Attrs, AttrsBuilder, subAttributes } from '../parse/attrs.js'
import type { DocState } from '../parse/attrs.js'
import { MAX_NESTING } from '../parse/table.js'
import type { ParseSetup } from '../parse/blocks.js'
import { cellSetup } from '../parse/nested.js'
import { headerEntries } from '../parse/header-entries.js'
import {
  BASIC_SUBS,
  NO_SUBS,
  REFTEXT_SUBS,
  VERBATIM_SUBS,
  type Sub,
  leadingAnchor,
  parseAttrs,
  scanAnchors,
} from '../parse/inline/index.js'
import { intToRoman, resolveOrderedMarker, rstrip, rubyToI } from '../parse/rx.js'
import { assertDocument, parseNested, setupOf } from '../document.js'
import { resolveInclude } from './resolver.js'

export type Piece = readonly [number, number]

/** A text to which substitutions apply: lines of the source, or a string that does not come from it. */
export type Src = { readonly lines: readonly string[] } | { readonly str: string }

/** An attribute entry as it takes effect: a name and the value (`null` unsets). */
export interface Effect {
  readonly name: string
  readonly value: string | null
}

/** A reference (an id) of the document and what the text of a cross reference to it is. */
export interface Ref {
  readonly kind: 'section' | 'block' | 'anchor' | 'document'
  readonly blk: Blk | null
  /** Anchors: the reference text given in the anchor, with the attributes substituted. */
  readonly reftext: string | null
}

/** A table as the converter writes it: the layout the parser worked out, and the documents in its cells. */
export interface TableBlk {
  readonly model: TableModel
  /** The document of each cell with the `a` style (a cell nested too deep has none). */
  readonly inner: ReadonlyMap<TableCellModel, Model>
}

export class Blk {
  readonly blocks: Blk[] = []
  parent: Blk | null = null
  node: SyntaxNode | null = null
  /** Offset of the first character of the block (its metadata lines included). */
  from = 0
  /** A block that comes from an `include::` line: the source range of the line (its own `node` is in the included text). */
  pin: readonly [number, number] | null = null
  style: string | null = null
  id: string | null = null
  readonly attrs = new Map<string, string | null>()
  title: Src | null = null
  /** The caption of a block with a title (`Example 1. `). */
  caption: string | null = null
  numeral: string | null = null
  /** The attribute entries that take effect when the block is converted. */
  effects: Effect[] = []
  subs: readonly Sub[] = NORMAL_SUBS
  /** Content of a block without blocks in it: the lines. */
  lines: readonly string[] = []
  /** The text of a list item or of a term. */
  text: Src | null = null
  /** Sections and discrete headings. */
  level = 0
  sectname = 'section'
  special = false
  numbered: boolean | 'chapter' = false
  index = 0
  nextSectionIndex = 0
  nextSectionOrdinal = 1
  /** Lists: the items (description lists: `terms` and `desc` per item). */
  items: Blk[] = []
  terms: Blk[] = []
  /** A description list item without a description. */
  desc = true
  marker: string | null = null
  /** The title as converted at parse time (sections and blocks with ids). */
  convertedTitle: string | null = null
  /** The text is folded from a paragraph; kept for the diagnostics of the compare tool. */
  folded = false
  /** Tables: the layout, and the documents of the cells with the `a` style. */
  table: TableBlk | null = null

  constructor(public ctx: string) {}

  get role(): string | null {
    return this.attrs.get('role') ?? null
  }

  option(name: string): boolean {
    return this.attrs.has(`${name}-option`)
  }

  attr(name: string): string | null {
    return this.attrs.get(name) ?? null
  }

  hasAttr(name: string): boolean {
    return this.attrs.has(name)
  }

  get sections(): Blk[] {
    return this.blocks.filter((b) => b.ctx === 'section')
  }
}

export interface Footnote {
  index: number
  id: string | null
  text: string
}

export interface Model {
  readonly root: Blk
  readonly text: string
  readonly refs: Map<string, Ref>
  /** The attributes at the start of the body (after the header). */
  readonly bodyAttrs: Attrs
  readonly locked: ReadonlySet<string>
  readonly doctype: string
  /** The header: the title text and its id. */
  header: { title: Src | null; id: string | null; convertedTitle: string | null } | null
  readonly setup: ParseSetup['attrs']
  /** The footnotes of titles converted while the document was read. */
  readonly footnotes: readonly Footnote[]
  /** The names of a manpage. */
  mannames: readonly string[]
}

// ---------------------------------------------------------------- tree helpers

function kids(n: SyntaxNode): SyntaxNode[] {
  const out: SyntaxNode[] = []
  for (let c = n.firstChild; c; c = c.nextSibling) out.push(c)
  return out
}

const isSpace = (c: number) => c === 32 || (c >= 9 && c <= 13) || c === 0

/** The end of `text` from `from` to `to` without its trailing white space. */
function stripEnd(text: string, from: number, to: number): number {
  let e = to
  while (e > from && isSpace(text.charCodeAt(e - 1))) e--
  return e
}

const METADATA = new Set(['BlockAttributes', 'BlockAnchor', 'BlockTitle'])
const BEFORE_CONTENT = new Set([
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

/** The reader drops the backslash of an escaped directive (`\\include::…[]`, `\\ifdef::…[]`) before the parser sees the line. */
function unescapeDirective(line: string): string {
  return line.charCodeAt(0) === 92 &&
    /^\\(?:(?:ifdef|ifndef|ifeval|endif)::\S*?(?:[,+]\S*?)?\[.*\]|include::[^\s[](?:[^[]*[^\s[])?\[.*\])$/.test(line)
    ? line.slice(1)
    : line
}

/** How deep blocks can nest in the model (Asciidoctor's own parser recurses on the stack as well). */
const MAX_DEPTH = 300

const ADMONITIONS = new Set(['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION'])

const STYLE_CONTEXT: Readonly<Record<string, string>> = {
  literal: 'literal',
  listing: 'listing',
  source: 'listing',
  verse: 'verse',
  quote: 'quote',
  example: 'example',
  sidebar: 'sidebar',
  pass: 'pass',
  open: 'open',
  abstract: 'open',
  partintro: 'open',
  comment: 'comment',
}

/** Compliance.caption attribute names by context. */
const CAPTION_ATTRIBUTES: Readonly<Record<string, string>> = {
  example: 'example-caption',
  figure: 'figure-caption',
  listing: 'listing-caption',
  table: 'table-caption',
}

const InlineSectionAnchorRx = new RegExp(
  ` (\\\\)?\\[\\[([\\p{Alphabetic}_:][\\p{Alphabetic}\\p{M}\\p{Nd}\\p{Pc}\\-:.]*)(?:, *([^\\n]+))?\\]\\]$`,
  'u',
)
const InvalidSectionIdCharsRx =
  /<[^>]+>|&(?:[a-z][a-z]+\d{0,2}|#\d\d\d{0,4}|#x[\da-f][\da-f][\da-f]{0,3});|[^ \p{Alphabetic}\p{M}\p{Nd}\p{Pc}\-.]+?/gu
const BiblioAnchorRx = new RegExp(
  `^\\[\\[\\[([\\p{Alphabetic}_:][\\p{Alphabetic}\\p{M}\\p{Nd}\\p{Pc}\\-:.]*)(?:, *(.+?))?\\]\\]\\]`,
  'su',
)

/** `Section.generate_id` for a converted title. */
export function generateId(
  title: string,
  attrs: (name: string) => string | undefined,
  taken: (id: string) => boolean,
): string {
  const pre = attrs('idprefix') ?? '_'
  let sep: string
  let sepSub = ''
  let noSep = false
  const rawSep = attrs('idseparator')
  if (rawSep !== undefined) {
    if (rawSep.length === 0) {
      noSep = true
      sep = ''
    } else {
      sep = [...rawSep][0]!
      sepSub = sep === '-' || sep === '.' ? ' .-' : ` ${sep}.-`
    }
  } else {
    sep = '_'
    sepSub = ' _.-'
  }
  let id = `${pre}${title.toLowerCase().replace(InvalidSectionIdCharsRx, '')}`
  if (noSep) id = id.replaceAll(' ', '')
  else {
    // String#tr_s: a run of the characters becomes one separator
    const set = new Set([...sepSub])
    let out = ''
    let prev = false
    for (const ch of id) {
      if (set.has(ch)) {
        if (!prev) out += sep
        prev = true
      } else {
        out += ch
        prev = false
      }
    }
    id = out
    if (id.endsWith(sep)) id = id.slice(0, -sep.length)
    if (pre === '' && id.startsWith(sep)) id = id.slice(sep.length)
  }
  if (taken(id)) {
    let n = 2
    while (taken(`${id}${sep}${n}`)) n++
    return `${id}${sep}${n}`
  }
  return id
}

/** Parser.adjust_indentation!: the lines without their common indentation (tabs expanded if `tab` > 0). */
export function adjustIndentation(lines: string[], indent = 0, tab = 0): string[] {
  if (lines.length === 0) return lines
  let out = lines
  if (tab > 0 && lines.some((l) => l.includes('\t'))) {
    const full = ' '.repeat(tab)
    out = lines.map((line) => {
      if (!line.includes('\t')) return line
      // leading tabs are a full tab stop each
      let leading = 0
      while (line.charAt(leading) === '\t') leading++
      let l = leading > 0 ? full.repeat(leading) + line.slice(leading) : line
      if (!l.includes('\t')) return l
      let res = ''
      let idx = 0
      let added = 0
      for (const c of l) {
        if (c === '\t') {
          const offset = idx + added
          if (offset % tab === 0) {
            added += tab - 1
            res += full
          } else {
            const spaces = tab - (offset % tab)
            if (spaces !== 1) added += spaces - 1
            res += ' '.repeat(spaces)
          }
        } else res += c
        idx++
      }
      l = res
      return l
    })
  }
  if (indent < 0) return out
  let blockIndent: number | null = null
  for (const line of out) {
    if (line === '') continue
    const lineIndent = line.length - line.replace(/^[\t\n\v\f\r ]+/, '').length
    if (lineIndent === 0) {
      blockIndent = null
      break
    }
    if (blockIndent === null || blockIndent >= lineIndent) blockIndent = lineIndent
  }
  if (indent === 0) {
    if (blockIndent !== null) return out.map((l) => (l === '' ? l : l.slice(blockIndent!)))
    return out
  }
  const pad = ' '.repeat(indent)
  return blockIndent !== null
    ? out.map((l) => (l === '' ? l : pad + l.slice(blockIndent!)))
    : out.map((l) => (l === '' ? l : pad + l))
}

/** A recording attribute builder: what the entries did, for the conversion to replay. */
class Recording extends AttrsBuilder {
  log: Effect[] = []
  override set(name: string, value: string | null): void {
    this.log.push({ name, value })
    super.set(name, value)
  }
}

interface Meta {
  acc: BlockAttributes
  /** The raw title (a `.Title` line): its source range. */
  title: Piece | null
  titleStr: string | null
  entries: Effect[]
  /** Offset of the first metadata line. */
  from: number
  anchors: boolean
}

/** Builds the model of a document. */
export function buildModel(doc: NotaDocument): Model {
  assertDocument(doc)
  return new Builder(doc, null, null).build()
}

class Builder {
  readonly text: string
  readonly setup: ParseSetup['attrs']
  readonly rec: Recording
  readonly tracker: AttributeTracker
  readonly st: DocState
  /** The references of the document; a document in a table cell shares them with the document that holds the table. */
  readonly refs: Map<string, Ref>
  /** How the text of the document was parsed (a document in a cell has the setup `cellSetup` made). */
  readonly parseSetup: ParseSetup
  private readonly headerEntryFrom: Set<number>
  pending: Effect[] = []
  /** The title above a section title, which the first block of the section takes. */
  carry: Src | null = null
  book = false
  model!: Model

  constructor(
    readonly doc: NotaDocument,
    private readonly parent: Builder | null,
    nested: ParseSetup | null,
  ) {
    this.text = doc.text
    this.parseSetup = nested ?? setupOf(doc.options)
    this.setup = this.parseSetup.attrs
    this.refs = parent ? parent.refs : new Map()
    this.headerEntryFrom = new Set(headerEntries(doc.tree.topNode).map((e) => e.from))
    // the state after the header: the parser has computed the author and revision attributes
    const start = new Attrs(new Map(doc.attributesAfterHeader()), 0, 0)
    this.rec = new Recording(attrsWithHash(start))
    this.st = {
      doctype: start.get('doctype') ?? 'article',
      leveloffset: rubyToI(start.get('leveloffset') ?? '0'),
    }
    this.tracker = new AttributeTracker(this.rec, this.setup.locked, this.st)
    this.saveAttributes()
  }

  /** Document#save_attributes: what Asciidoctor settles on when the header is read (the placement of the toc). */
  private saveAttributes(): void {
    const rec = this.rec
    const toc = rec.get('toc')
    if (toc !== undefined) {
      const placement = rec.get('toc-placement') ?? 'macro'
      const positionVal = placement !== 'auto' ? placement : rec.get('toc-position')
      if (!(toc === '' && (positionVal === undefined || positionVal === ''))) {
        let defaultClass: string | null = 'toc2'
        const position = positionVal === undefined || positionVal === '' ? (toc === '' ? 'left' : toc) : positionVal
        rec.set('toc', '')
        rec.set('toc-placement', 'auto')
        switch (position) {
          case 'left':
          case '<':
          case '&lt;':
            rec.set('toc-position', 'left')
            break
          case 'right':
          case '>':
          case '&gt;':
            rec.set('toc-position', 'right')
            break
          case 'top':
          case '^':
            rec.set('toc-position', 'top')
            break
          case 'bottom':
          case 'v':
            rec.set('toc-position', 'bottom')
            break
          case 'preamble':
          case 'macro':
            rec.set('toc-position', 'content')
            rec.set('toc-placement', position)
            defaultClass = null
            break
          default:
            rec.set('toc-position', null)
            defaultClass = null
        }
        if (defaultClass !== null && rec.get('toc-class') === undefined) rec.set('toc-class', defaultClass)
      }
    }
    if (rec.get('compat-mode') !== undefined && rec.get('language') !== undefined)
      rec.set('source-language', rec.get('language')!)
  }

  // ---------------------------------------------------------------- environment for substitutions

  /** The substitutions' view of the document while the model is built (nothing is registered). */
  env(acc: BlockAttributes | null, ctx?: string): InlineEnv {
    return {
      get: (n) => this.rec.get(n),
      block: acc ? (n) => acc.attributes.get(n) ?? undefined : undefined,
      hasRef: (id) => this.refs.has(id),
      docname: this.rec.get('docname'),
      bibliography: ctx === 'bibliography',
      set: (name, value) => {
        this.tracker.hooks.set(name, value)
      },
      counter: (name, seed) => this.counterOf(name, seed),
      // a title that is converted while the document is read registers its footnotes then
      addFootnote: (id, text) => {
        const index = this.footnotes.length + 1
        this.footnotes.push({ index, id, text })
        return index
      },
      footnote: (id) => this.footnotes.find((f) => f.id === id),
    }
  }

  /** The footnotes registered while the model was built (see `env`). */
  readonly footnotes: Footnote[] = []

  build(): Model {
    const tree = this.doc.tree
    const top = tree.topNode
    const root = new Blk('document')
    root.node = top
    this.book = this.st.doctype === 'book'
    const model: Model = {
      root,
      text: this.text,
      refs: this.refs,
      bodyAttrs: attrsWithHash(new Attrs(new Map(this.rec.freeze().map), 0, 0)),
      locked: this.setup.locked,
      doctype: this.st.doctype,
      header: null,
      setup: this.setup,
      footnotes: this.footnotes,
      mannames: this.mannames,
    }
    this.model = model
    const header = top.getChild('Header')
    let hasHeader = false
    if (header) {
      const title = header.getChild('DocumentTitle')
      if (title) {
        hasHeader = true
        const m = this.readMeta(header, true)
        const t = title.getChild('TitleText')!
        model.header = {
          title: this.srcOfPiece(t.from, t.to),
          id: m.acc.id,
          convertedTitle: null,
        }
        if (m.acc.id) this.refs.set(m.acc.id, { kind: 'document', blk: null, reftext: null })
        if (this.st.doctype === 'manpage') this.manpageHeader(header, this.text.slice(t.from, t.to))
      }
    }
    // the attributes the header left are what the body starts with
    ;(model as { bodyAttrs: Attrs }).bodyAttrs = new Attrs(new Map(this.rec.freeze().map), 0, 0)
    ;(model as { doctype: string }).doctype = this.st.doctype
    model.mannames = this.mannames
    this.book = this.st.doctype === 'book'
    this.rec.log = []
    this.pending = []
    let preamble: Blk | null = null
    if (hasHeader || (this.book && !this.firstBlockIsAbstract(top))) {
      preamble = new Blk('preamble')
      preamble.parent = root
      root.blocks.push(preamble)
    }
    this.container(root, top, preamble)
    if (preamble) {
      if (preamble.blocks.length > 0) {
        // a preamble of a document without sections is unwrapped, except in a book
        if (!(this.book || root.blocks.length > 1)) {
          root.blocks.shift()
          for (const b of preamble.blocks) {
            b.parent = root
            root.blocks.push(b)
          }
        }
      } else root.blocks.shift()
    }
    return model
  }

  private firstBlockIsAbstract(_top: SyntaxNode): boolean {
    return false
  }

  // ---------------------------------------------------------------- metadata

  private srcOfPiece(from: number, to: number): Src {
    return { lines: [this.text.slice(from, to)] }
  }

  /** The attribute list with the attribute references substituted, as Asciidoctor does before it parses it. */
  private subList(source: string): string {
    if (!source.includes('{')) return source
    return subAttributes(source, (n) => this.rec.get(n), undefined, {
      ...this.tracker.hooks,
      counter: (name, seed) => this.counterOf(name, seed),
    })
  }

  /** A block attribute line: the references are substituted, single-quoted values get the normal substitutions. */
  private applyBlockList(acc: BlockAttributes, source: string): void {
    const list = this.subList(source)
    acc.applyList(list)
    if (!list.includes("'")) return
    for (const it of parseAttributeList(list)) {
      if (!it.singleQuoted || it.value === null) continue
      const value = substitute(it.value, null, NORMAL_SUBS, this.env(null))
      if (it.name !== undefined) {
        if (it.name !== 'title' && it.name !== 'reftext' && it.name !== 'options' && it.name !== 'opts')
          acc.attributes.set(it.name, value)
      } else if (it.index > 0) acc.attributes.set(String(it.index + 1), value)
    }
  }

  /** Applies an entry node; the effect is kept for the block it precedes. */
  entry(n: SyntaxNode): void {
    // the entries the header took are in the attributes the body starts with
    if (this.headerEntryFrom.has(n.from)) return
    const nameNode = n.getChild('AttributeName')
    if (!nameNode) return
    const text = this.text
    let raw = text.slice(nameNode.from, nameNode.to)
    // markers: `!name` (before the name) or `name!` (after it)
    const first = kids(n).find((c) => c.name === 'UnsetMarker')
    if (first) raw = first.from < nameNode.from ? `!${raw}` : `${raw}!`
    const valueNode = n.getChild('AttributeValue')
    let value = ''
    if (valueNode) {
      const parts: string[] = []
      const vk = kids(valueNode)
      if (vk.length === 0) parts.push(text.slice(valueNode.from, valueNode.to))
      else for (const c of vk) if (c.name === 'ValueText') parts.push(text.slice(c.from, c.to))
      value = parts.reduce(
        (acc, part, i) => (i === 0 ? part : `${acc}${acc.endsWith(' +') ? '\n' : ' '}${part}`),
        '',
      )
    }
    const before = this.rec.log.length
    this.tracker.entry(raw, value, false)
    this.pending.push(...this.rec.log.slice(before))
  }

  /** The metadata lines at the start of a block or section node; entries among them count. */
  readMeta(node: SyntaxNode, header = false): Meta {
    const acc = new BlockAttributes()
    const meta: Meta = { acc, title: null, titleStr: null, entries: [], from: node.from, anchors: false }
    let first = true
    for (const c of kids(node)) {
      if (!BEFORE_CONTENT.has(c.name)) break
      if (c.name === 'AttributeEntry') {
        if (!header) this.entry(c)
        continue
      }
      if (!METADATA.has(c.name)) continue
      if (first) meta.from = c.from
      first = false
      if (c.name === 'BlockAttributes') {
        const line = rstrip(this.text.slice(c.from, c.to))
        this.applyBlockList(acc, line.slice(1, -1))
      } else if (c.name === 'BlockAnchor') {
        const id = c.getChild('AnchorId')
        const ref = c.getChild('AnchorRefText')
        acc.applyAnchor(
          id ? this.text.slice(id.from, id.to) : null,
          ref ? this.text.slice(ref.from, ref.to) : null,
        )
      } else {
        const t = c.getChild('TitleText')
        if (t) {
          meta.title = [t.from, t.to]
          acc.applyTitle(this.text.slice(t.from, t.to))
        }
      }
    }
    return meta
  }

  /** Parser.parse_manpage_header: the title gives `mantitle` and `manvolnum`, the NAME section `manname` and `manpurpose`. */
  private manpageHeader(header: SyntaxNode, doctitle: string): void {
    const rec = this.rec
    const tm = /^(.+?) *\( *(.+?) *\)$/.exec(doctitle)
    let manvolnum: string
    if (tm) {
      manvolnum = tm[2]!
      const mantitle = tm[1]!.includes('{') ? subAttributes(tm[1]!, (n) => rec.get(n)) : tm[1]!
      rec.set('manvolnum', manvolnum)
      rec.set('mantitle', mantitle.toLowerCase())
    } else {
      rec.set('mantitle', doctitle || rec.get('docname') || 'command')
      rec.set('manvolnum', '1')
    }
    const manname = rec.get('manname')
    if (manname !== undefined && rec.get('manpurpose') !== undefined) {
      if (rec.get('manname-title') === undefined) rec.set('manname-title', 'Name')
      this.mannames = [manname]
      return
    }
    // the NAME section is in the header
    const title = header.getChild('SectionTitle')
    if (!title) {
      this.mannames = [rec.get('docname') ?? 'command']
      rec.set('manname', this.mannames[0]!)
      return
    }
    const tt = title.getChild('TitleText')!
    const titleText = this.text.slice(tt.from, tt.to)
    const lines: string[] = []
    for (const c of kids(header)) {
      if (c.from < title.to || c.name !== 'TextLine') continue
      lines.push(rstrip(this.text.slice(c.from, c.to)).replace(/^[\t\n\v\f\r ]+/, ''))
    }
    const buffer = lines.join(' ')
    const m = /^(.+?) +- +(.+)$/s.exec(buffer)
    const convertedTitle = substitute(titleText, null, NORMAL_SUBS, this.env(null))
    const id = generateId(convertedTitle, (n) => rec.get(n), (i) => this.refs.has(i))
    this.refs.set(id, { kind: 'section', blk: null, reftext: null })
    if (!m) {
      this.mannames = [rec.get('docname') ?? 'command']
      rec.set('manname', this.mannames[0]!)
      return
    }
    let name = m[1]!
    if (name.includes('{')) name = subAttributes(name, (n) => rec.get(n))
    let names = [name]
    if (name.includes(',')) {
      names = name.split(',').map((n) => n.replace(/^[\t\n\v\f\r ]+/, ''))
      name = names[0]!
    }
    let purpose = m[2]!
    if (purpose.includes('{')) purpose = subAttributes(purpose, (n) => rec.get(n))
    if (rec.get('manname-title') === undefined) rec.set('manname-title', convertedTitle)
    rec.set('manname-id', id)
    rec.set('manname', name)
    rec.set('manpurpose', purpose)
    this.mannames = names
  }

  /** The names of a manpage (the `mannames` attribute). */
  mannames: string[] = []

  // ---------------------------------------------------------------- containers

  /** The blocks in `node` (a document, a section, a compound block, a list item) appended to `parent`. */
  private depth = 0

  private container(parent: Blk, node: SyntaxNode, into: Blk | null = null): void {
    // blocks nested deeper than this are not read: the recursion would overflow the stack
    if (this.depth > MAX_DEPTH) return
    this.depth++
    try {
      this.containerBody(parent, node, into)
    } finally {
      this.depth--
    }
  }

  /**
   * The blocks of the file that an `include::` line names when the resolver of the host gives its text: a document of its
   * own (read with the attributes in force at the line) whose blocks stand where the line is. They keep the place of the
   * line as their place in the text (`pin`): the document has no text for them.
   */
  private included(n: SyntaxNode): Blk[] {
    const inner = resolveInclude(this.doc, n)
    if (!inner || this.includeDepth >= 10) return []
    const b = new Builder(inner, this, null)
    b.includeDepth = this.includeDepth + 1
    const built = b.build()
    const pin: readonly [number, number] = [n.from, n.to]
    const pinAll = (blk: Blk): void => {
      blk.pin = pin
      for (const k of blk.blocks) pinAll(k)
      for (const k of blk.items) pinAll(k)
      for (const k of blk.terms) pinAll(k)
    }
    for (const blk of built.root.blocks) pinAll(blk)
    return built.root.blocks
  }

  includeDepth = 0

  private containerBody(parent: Blk, node: SyntaxNode, into: Blk | null): void {
    let intro = into
    // the blocks of a part of a book are wrapped in a `partintro` open block until its first section
    const part = parent.ctx === 'section' && this.book && parent.level === 0
    for (const c of kids(node)) {
      switch (c.name) {
        case 'AttributeEntry':
          this.entry(c)
          break
        case 'Section': {
          const s = this.section(parent, c)
          if (s) {
            // a section closes the preamble and the intro of a part
            intro = null
            parent.blocks.push(s)
            s.parent = parent
          }
          break
        }
        case 'IncludeDirective': {
          for (const b of this.included(c)) {
            const into2 = intro ?? parent
            b.parent = into2
            into2.blocks.push(b)
            if (b.ctx === 'section') intro = null
          }
          break
        }
        default: {
          const b = this.block(intro ?? parent, c)
          if (!b) break
          if (part && !parent.blocks.some((x) => x.ctx !== 'section') && intro === null) {
            if (b.style !== 'partintro') {
              if (b.style === 'open' && b.ctx === 'open') b.style = 'partintro'
              else {
                intro = new Blk('open')
                intro.style = 'partintro'
                intro.parent = parent
                parent.blocks.push(intro)
                b.parent = intro
                intro.blocks.push(b)
                break
              }
            } else if (b.ctx === 'open' && b.blocks.length === 0 && b.lines.length > 0) {
              // a `[partintro]` paragraph is an open block that holds a paragraph
              const p = new Blk('paragraph')
              p.parent = b
              p.lines = b.lines
              p.subs = b.subs
              b.blocks.push(p)
              b.lines = []
            }
          }
          const into2 = intro ?? parent
          b.parent = into2
          into2.blocks.push(b)
        }
      }
    }
  }

  // ---------------------------------------------------------------- sections

  private section(parent: Blk, node: SyntaxNode): Blk | null {
    const lvl = (node.tree?.prop(sectionLevel) as number | undefined) ?? 1
    const meta = this.readMeta(node)
    const s = new Blk('section')
    s.node = node
    s.from = node.from
    s.effects = this.takePending()
    const acc = meta.acc
    const titleNode = node.getChild('SectionTitle')!
    const textNode = titleNode.getChild('TitleText')!
    const tFrom = textNode.from
    let tTo = textNode.to
    let explicitId = acc.id
    let inlineReftext: string | null = null
    // an anchor at the end of the title line: `== Title [[id]]`
    const raw = this.text.slice(tFrom, tTo)
    if (explicitId === null && raw.endsWith(']]')) {
      const m = InlineSectionAnchorRx.exec(raw)
      if (m && !m[1]) {
        tTo = tFrom + raw.length - m[0].length
        explicitId = m[2]!
        inlineReftext = m[3] ?? null
      }
    }
    const setext = titleNode.getChild('SetextUnderline')
    s.title = { lines: [setext ? rstrip(this.text.slice(tFrom, tTo)) : this.text.slice(tFrom, tTo)] }
    let sectStyle: string | null = null
    const first = acc.attributes.get('1')
    if (first !== undefined && first !== null) sectStyle = acc.style ?? first
    // the style is the first positional attribute; shorthand parts were split off by BlockAttributes
    if (sectStyle === null && acc.style) sectStyle = acc.style
    let level = lvl
    let sectname: string
    let special = false
    let numbered: boolean | 'chapter' = false
    const doctype = this.st.doctype
    const book = doctype === 'book'
    if (sectStyle) {
      if (book && sectStyle === 'abstract') {
        sectname = 'chapter'
        level = 1
      } else if (sectStyle.startsWith('sect') && /^sect[1-5]$/.test(sectStyle)) sectname = 'section'
      else {
        sectname = sectStyle
        special = true
        if (level === 0) level = 1
        numbered = sectname === 'appendix'
      }
    } else if (book) sectname = level === 0 ? 'part' : level > 1 ? 'section' : 'chapter'
    else if (doctype === 'manpage' && this.text.slice(tFrom, tTo).toLowerCase() === 'synopsis') {
      sectname = 'synopsis'
      special = true
    } else sectname = 'section'
    s.level = level
    s.sectname = sectname
    s.special = special || (parent.ctx === 'section' && parent.special)
    // attributes
    for (const [k, v] of acc.attributes) s.attrs.set(k, v)
    if (inlineReftext !== null && !s.attrs.has('reftext')) s.attrs.set('reftext', inlineReftext)
    s.style = acc.shownStyle
    if (special) {
      s.special = true
      if (numbered === true) s.numbered = true
      else if (this.rec.get('sectnums') === 'all') s.numbered = book && level === 1 ? 'chapter' : true
    } else if (this.rec.get('sectnums') !== undefined && level > 0) {
      s.numbered = s.special ? parent.ctx === 'section' && !!parent.numbered : true
    } else if (book && level === 0 && this.rec.get('partnums') !== undefined) s.numbered = true
    // the id
    let generated = false
    let id = explicitId
    if (id === null && this.rec.get('sectids') !== undefined) {
      s.convertedTitle = this.renderTitle(s)
      id = generateId(
        s.convertedTitle,
        (n) => this.rec.get(n),
        (i) => this.refs.has(i),
      )
      generated = true
    }
    s.id = id
    if (id !== null) {
      if (!generated && this.text.slice(tFrom, tTo).includes('{')) s.convertedTitle = this.renderTitle(s)
      if (!this.refs.has(id)) this.refs.set(id, { kind: 'section', blk: s, reftext: null })
    }
    s.attrs.delete('1')
    // a title line above a section is carried over to the next block; it does not belong to the section
    if (meta.title) this.carry = this.srcOfPiece(meta.title[0], meta.title[1])
    else if (meta.acc.title !== null) this.carry = { str: meta.acc.title }
    this.container(s, node)
    // numbers are assigned when the section is appended to its parent
    this.assignNumeral(parent, s)
    return s
  }

  private assignNumeral(parent: Blk, s: Blk): void {
    s.index = parent.nextSectionIndex
    parent.nextSectionIndex = s.index + 1
    const like = s.numbered
    if (like) {
      if (s.sectname === 'appendix') {
        s.numeral = this.counter('appendix-number', 'A')
        const caption = this.rec.get('appendix-caption')
        s.caption = caption !== undefined ? `${caption} ${s.numeral}: ` : `${s.numeral}. `
      } else if (s.sectname === 'chapter' || like === 'chapter')
        s.numeral = this.counter('chapter-number', '1')
      else {
        s.numeral =
          s.sectname === 'part' ? intToRoman(parent.nextSectionOrdinal) : String(parent.nextSectionOrdinal)
        parent.nextSectionOrdinal++
      }
    }
  }

  /** Document#counter for `{counter:}`: a document in a cell counts in the document that holds the table. */
  private counterOf(name: string, seed?: string): string {
    return this.parent ? this.parent.counterOf(name, seed) : this.tracker.counter(name, seed)
  }

  /** Document#counter, for the counters the model itself needs (chapter and appendix numbers, captions). */
  private counters = new Map<string, string>()
  counter(name: string, seed: string): string {
    // Document#counter: a document in a cell counts with the document that holds the table
    if (this.parent) return this.parent.counter(name, seed)
    const cur = this.counters.get(name)
    let next: string
    if (cur !== undefined) next = nextval(cur)
    else next = seed
    this.counters.set(name, next)
    return next
  }

  private takePending(): Effect[] {
    const p = this.pending
    this.pending = []
    return p
  }

  /** The title of a section as converted with the attributes of the moment. */
  private renderTitle(s: Blk): string {
    const src = s.title as { lines: readonly string[] }
    return substitute(src.lines.join('\n'), null, NORMAL_SUBS, this.env(null))
  }

  // ---------------------------------------------------------------- blocks

  /** A block of a container; null for what is no block (comments, blank lines, directives). */
  private block(parent: Blk, n: SyntaxNode): Blk | null {
    switch (n.name) {
      case 'Paragraph':
      case 'LiteralParagraph':
      case 'AdmonitionParagraph':
      case 'StyledParagraph':
        return this.paragraph(parent, n)
      case 'DelimitedBlock':
        return this.delimited(parent, n)
      case 'BlockQuote':
        return this.markdownQuote(parent, n)
      case 'BlockMacro':
        return this.blockMacro(parent, n)
      case 'ThematicBreak':
      case 'PageBreak': {
        const meta = this.readMeta(n)
        const b = this.start(n.name === 'PageBreak' ? 'page_break' : 'thematic_break', n, meta)
        return this.finish(b, meta, parent)
      }
      case 'DiscreteHeading':
        return this.discrete(parent, n)
      case 'UnorderedList':
      case 'OrderedList':
      case 'DescriptionList':
      case 'CalloutList':
        return this.list(parent, n)
      default:
        return null
    }
  }

  /** A new block of a context for a node with its metadata read. */
  private start(ctx: string, n: SyntaxNode, meta: Meta): Blk {
    const b = new Blk(ctx)
    b.node = n
    b.from = meta.from < n.from ? n.from : meta.from
    b.from = n.from
    b.effects = this.takePending()
    for (const [k, v] of meta.acc.attributes) b.attrs.set(k, v)
    b.style = meta.acc.shownStyle
    if (meta.title) b.title = this.srcOfPiece(meta.title[0], meta.title[1])
    else if (meta.acc.title !== null) b.title = { str: meta.acc.title }
    else if (this.carry !== null && ctxTakesCarry(ctx)) b.title = this.carry
    if (ctxTakesCarry(ctx)) this.carry = null
    return b
  }

  /** Assigns the id and the caption, catalogs the block, and returns it. */
  private finish(b: Blk, meta: Meta, parent: Blk): Blk {
    b.parent = parent
    const id = meta.acc.id ?? b.attrs.get('id') ?? null
    b.id = id
    if (b.title && CAPTION_ATTRIBUTES[b.ctx === 'image' ? 'figure' : b.ctx]) {
      const ctxName = b.ctx === 'image' ? 'figure' : b.ctx
      const given = b.attrs.get('caption') ?? null
      b.attrs.delete('caption')
      this.assignCaption(b, given, ctxName)
    }
    if (id !== null && b.title !== null && b.convertedTitle === null) {
      // a title with attribute references is converted while the block is read, when it has an id
      const raw = 'str' in b.title ? b.title.str : b.title.lines.join('\n')
      if (raw.includes('{')) b.convertedTitle = substitute(raw, null, NORMAL_SUBS, this.env(null))
    }
    if (id !== null && !this.refs.has(id)) this.refs.set(id, { kind: 'block', blk: b, reftext: null })
    return b
  }

  /** AbstractBlock#assign_caption. */
  private assignCaption(b: Blk, value: string | null, ctx: string): void {
    if (b.caption !== null || !b.title) return
    const v = value ?? this.rec.get('caption') ?? null
    if (v !== null) {
      b.caption = v
      return
    }
    const attr = CAPTION_ATTRIBUTES[ctx]
    const prefix = attr ? this.rec.get(attr) : undefined
    if (attr && prefix !== undefined) {
      const n = this.counter(`${ctx}-number`, '1')
      b.numeral = n
      b.caption = `${prefix} ${n}. `
    }
  }

  // ---------------------------------------------------------------- paragraphs

  /** The lines of the text of a node: its `TextLine`s, comments and the like left out. */
  linesOf(n: SyntaxNode): string[] {
    const out: string[] = []
    for (const c of kids(n)) {
      if (c.name !== 'TextLine') continue
      const own = c.tree?.prop(textPieces) as readonly number[] | undefined
      if (own) {
        for (let i = 0; i < own.length; i += 2) out.push(this.text.slice(c.from + own[i]!, c.from + own[i + 1]!))
      } else out.push(rstrip(this.text.slice(c.from, c.to)))
    }
    return out
  }

  private paragraph(parent: Blk, n: SyntaxNode): Blk | null {
    const meta = this.readMeta(n)
    const acc = meta.acc
    let style = acc.style
    let lines = this.linesOf(n)
    let ctx = 'paragraph'
    let subs: readonly Sub[] = NORMAL_SUBS
    const adm = n.getChild('AdmonitionMarker')
    let attrsExtra: [string, string][] = []
    let credit: string | null = null
    if (n.name === 'LiteralParagraph') {
      ctx = 'literal'
      subs = VERBATIM_SUBS
      lines = adjustIndentation(lines)
    } else if (n.name === 'AdmonitionParagraph' && adm) {
      ctx = 'admonition'
      const name = this.text.slice(adm.from, adm.to).trim().replace(/:$/, '')
      style = name
      attrsExtra = [['name', name.toLowerCase()]]
    } else if (n.name === 'StyledParagraph') {
      style = style ?? null
      if (style && ADMONITIONS.has(style)) {
        ctx = 'admonition'
        attrsExtra = [['name', style.toLowerCase()]]
      } else if (style && STYLE_CONTEXT[style]) {
        ctx = STYLE_CONTEXT[style]!
        if (ctx === 'comment') return null
        if (ctx === 'literal' || ctx === 'listing') {
          subs = VERBATIM_SUBS
          // the lines keep their indentation unless the block says how much to take off (or has tabs to expand)
          const indent = acc.attributes.get('indent') ?? this.rec.get('source-indent')
          const tabSize = this.tabOf(acc)
          if (indent !== undefined && indent !== null) lines = adjustIndentation(lines, rubyToI(indent), tabSize)
          else if (tabSize > 0) lines = adjustIndentation(lines, -1, tabSize)
        } else if (ctx === 'verse') subs = NORMAL_SUBS
        else if (ctx === 'pass') subs = NO_SUBS
      }
    } else if (n.name === 'Paragraph' && lines.length > 0 && /^[ \t]/.test(lines[0]!)) {
      // an indented paragraph in a list item, or [normal] over one: the text moves to the left margin
      lines = adjustIndentation(lines)
    } else if (
      n.name === 'Paragraph' &&
      lines.length > 1 &&
      lines[0]!.startsWith('"') &&
      lines[lines.length - 1]!.startsWith('-- ') &&
      lines[lines.length - 2]!.endsWith('"')
    ) {
      // "A quote" followed by a line `-- Attribution, Source`
      ctx = 'quote'
      credit = lines[lines.length - 1]!.slice(3)
      lines = lines.slice(0, -1)
      while (lines.length && lines[lines.length - 1] === '') lines = lines.slice(0, -1)
      lines[0] = lines[0]!.slice(1)
      lines[lines.length - 1] = lines[lines.length - 1]!.slice(0, -1)
    }
    const b = this.start(ctx, n, meta)
    if (ctx === 'admonition') {
      const name = attrsExtra[0]![1]
      b.attrs.set('name', name)
      b.attrs.set('textlabel', b.attrs.get('caption') ?? this.rec.get(`${name}-caption`) ?? null)
      b.attrs.delete('caption')
      b.style = style
    }
    if (ctx === 'listing') this.sourceAttrs(b, true)
    if (ctx === 'quote' || ctx === 'verse') this.rekey(b, ['attribution', 'citetitle'])
    if (credit !== null) {
      b.style = 'quote'
      const text = substitute(credit, null, NORMAL_SUBS, this.env(null))
      const idx = text.indexOf(', ')
      const attribution = idx >= 0 ? text.slice(0, idx) : text
      if (attribution !== '') b.attrs.set('attribution', attribution)
      if (idx >= 0) b.attrs.set('citetitle', text.slice(idx + 2))
    }
    if (style === 'source' && ctx === 'listing') b.style = 'source'
    if (ctx === 'open' && style === 'partintro') b.style = 'partintro'
    b.lines = lines
    b.subs = blockSubs(subs, b.attrs.get('subs'))
    b.lines = lines
    this.catalogInlineAnchors(lines.join('\n'))
    return this.finish(b, meta, parent)
  }

  private tabOf(acc: BlockAttributes): number {
    const v = acc.attributes.get('tabsize') ?? this.rec.get('tabsize')
    return v === undefined || v === null ? 0 : rubyToI(v)
  }

  /** AttributeList.rekey: the positional attributes 2, 3, … as named ones. */
  private rekey(b: Blk, names: (string | null)[]): void {
    names.forEach((name, i) => {
      if (!name) return
      const v = b.attrs.get(String(i + 2))
      if (v !== undefined && v !== null) b.attrs.set(name, v)
    })
  }

  /**
   * The attributes of a listing block (Parser.next_block, `when :listing, :source`): `source` (a style)
   * reads `[source, language, linenums]`; a block without a style but with a second positional attribute or a
   * default `source-language` becomes a source block.
   */
  private sourceAttrs(b: Blk, isSource: boolean): void {
    const positional = (n: number) => b.attrs.get(String(n)) ?? null
    if (isSource) {
      const lang = positional(2)
      if (lang) b.attrs.set('language', lang)
      const third = positional(3)
      if (third !== null) b.attrs.set('linenums', third)
      if (!b.attrs.has('language') && this.rec.get('source-language') !== undefined)
        b.attrs.set('language', this.rec.get('source-language')!)
    } else {
      const language = positional(1) ? null : (positional(2) ?? this.rec.get('source-language') ?? null)
      if (language) {
        b.attrs.set('style', 'source')
        b.style = 'source'
        b.attrs.set('language', language)
        const third = positional(3)
        if (third !== null) b.attrs.set('linenums', third)
      }
    }
    if (
      !b.attrs.has('linenums') &&
      (b.attrs.get('linenums-option') !== undefined || this.rec.get('source-linenums-option') !== undefined)
    )
      b.attrs.set('linenums', '')
    if (!b.attrs.has('indent') && this.rec.get('source-indent') !== undefined)
      b.attrs.set('indent', this.rec.get('source-indent')!)
  }

  // ---------------------------------------------------------------- delimited blocks

  private contentLines(n: SyntaxNode): string[] {
    const out: string[] = []
    const text = this.text
    for (const c of kids(n)) {
      if (c.name !== 'DelimitedContent') continue
      // the lines a directive or a false condition took out (kept inside the content when it has nodes of its
      // own, callouts for instance) are not part of it
      const segments: [number, number][] = []
      let at = c.from
      for (const h of kids(c)) {
        if (h.name !== 'Directive' && h.name !== 'DisabledLines' && h.name !== 'IncludeDirective') continue
        if (h.from > at) segments.push([at, h.from])
        at = h.to
      }
      if (c.to > at || segments.length === 0) segments.push([at, c.to])
      for (const [from, end] of segments) {
        let pos = from
        while (pos < end) {
          let nl = text.indexOf('\n', pos)
          if (nl < 0 || nl >= end) nl = end
          out.push(unescapeDirective(rstrip(text.slice(pos, nl))))
          pos = nl + 1
        }
      }
    }
    return out
  }

  private delimited(parent: Blk, n: SyntaxNode): Blk | null {
    const kind = (n.tree?.prop(blockKind) as string | undefined) ?? 'open'
    if (kind === 'comment') {
      this.readMeta(n)
      return null
    }
    const meta = this.readMeta(n)
    const acc = meta.acc
    const style = acc.style
    // a wiped style (`[,ruby]` under `[quote]`) gives way to the default one of the delimiter
    if (acc.wiped) acc.attributes.delete('style')
    const opening = this.text.slice(n.getChild('BlockDelimiter')!.from, n.getChild('BlockDelimiter')!.to)
    const openLine = opening.split('\n')[0]!.replace(/\r$/, '')
    let ctx: string = kind
    switch (kind) {
      case 'admonition':
      case 'example':
      case 'sidebar':
      case 'quote':
      case 'verse':
      case 'literal':
      case 'listing':
      case 'pass':
      case 'stem':
      case 'table':
      case 'open':
        break
      default:
        ctx = 'open'
    }
    const b = this.start(ctx, n, meta)
    let compound = false
    let subs: readonly Sub[] = NORMAL_SUBS
    switch (ctx) {
      case 'listing': {
        subs = VERBATIM_SUBS
        const fence = n.getChild('CodeLanguage')
        if (openLine.startsWith('```')) {
          b.style = 'source'
          b.attrs.set('style', 'source')
          let language: string | null = null
          if (fence) language = this.text.slice(fence.from, fence.to)
          const info = openLine.slice(3)
          const comma = info.indexOf(',')
          if (comma >= 0 && (comma > 0 ? comma < info.length - 1 : info.length > 1))
            b.attrs.set('linenums', '')
          if (language) b.attrs.set('language', language)
          else if (this.rec.get('source-language') !== undefined)
            b.attrs.set('language', this.rec.get('source-language')!)
          if (
            !b.attrs.has('linenums') &&
            (b.attrs.get('linenums-option') !== undefined ||
              this.rec.get('source-linenums-option') !== undefined)
          )
            b.attrs.set('linenums', '')
          if (!b.attrs.has('indent') && this.rec.get('source-indent') !== undefined)
            b.attrs.set('indent', this.rec.get('source-indent')!)
        } else if (style === 'source') {
          this.sourceAttrs(b, true)
          b.style = 'source'
        } else {
          this.sourceAttrs(b, false)
          if (b.style !== 'source') b.style = style ?? 'listing'
        }
        break
      }
      case 'literal':
        subs = VERBATIM_SUBS
        b.style = style ?? 'literal'
        break
      case 'verse':
        this.rekey(b, ['attribution', 'citetitle'])
        subs = NORMAL_SUBS
        b.style = style ?? 'verse'
        break
      case 'quote':
        this.rekey(b, ['attribution', 'citetitle'])
        compound = true
        b.style = style ?? 'quote'
        break
      case 'example':
        compound = true
        if (b.attrs.has('collapsible-option')) b.attrs.set('caption', '')
        b.style = style ?? 'example'
        break
      case 'sidebar':
        compound = true
        b.style = style ?? 'sidebar'
        break
      case 'admonition': {
        compound = true
        const name = (style ?? 'NOTE').toLowerCase()
        b.attrs.set('name', name)
        b.attrs.set('textlabel', b.attrs.get('caption') ?? this.rec.get(`${name}-caption`) ?? null)
        b.attrs.delete('caption')
        break
      }
      case 'open':
        compound = true
        b.style = style ?? 'open'
        break
      case 'pass':
        subs = NO_SUBS
        b.style = style ?? 'pass'
        break
      case 'stem': {
        subs = BASIC_SUBS
        const st = style ?? ''
        const stem = st === 'latexmath' || st === 'asciimath' ? st : this.rec.get('stem')
        const kind2 = stem === 'latexmath' || stem === 'latex' || stem === 'tex' ? 'latexmath' : 'asciimath'
        b.attrs.set(
          'style',
          st === 'latexmath' || st === 'asciimath'
            ? st
            : b.attrs.get('2') === 'latexmath'
              ? 'latexmath'
              : kind2,
        )
        b.style = b.attrs.get('style') ?? kind2
        break
      }
      case 'table':
        b.style = style
        b.table = this.readTable(n)
        return this.finish(b, meta, parent)
      default:
        break
    }
    if (compound) {
      this.container(b, n)
    } else {
      let lines = this.contentLines(n)
      if (ctx === 'listing' || ctx === 'literal') {
        const indent = b.attrs.get('indent')
        const tab = b.attrs.get('tabsize') ?? this.rec.get('tabsize')
        const tabSize = tab ? rubyToI(tab) : 0
        if (indent !== undefined && indent !== null)
          lines = adjustIndentation(lines, rubyToI(indent), tabSize)
        else if (tabSize > 0) lines = adjustIndentation(lines, -1, tabSize)
      }
      b.lines = lines
    }
    b.subs = blockSubs(subs, b.attrs.get('subs'))
    return this.finish(b, meta, parent)
  }

  /**
   * The layout of a table (the parser has worked it out) with the documents of its cells that have the `a` style: each is
   * read as a document of its own that sees the attributes of the moment, and what it sets stays in it. The leading
   * anchor of the text of the other cells is a reference of the document.
   */
  private readTable(n: SyntaxNode): TableBlk | null {
    const model = n.tree?.prop(tableModel)
    if (!model) return null
    // the cells in the order of the text, the ones left out with their row too: Asciidoctor reads each of them when it
    // meets it, so what they hold (ids, anchors) is taken before what comes after them
    const kept = [...model.rows.head, ...model.rows.body, ...model.rows.foot].flatMap((r) => r.cells)
    const cells: { cell: TableCellModel | null; from: number; style: TableCellModel['style']; text: string }[] = [
      ...kept.map((cell) => ({ cell, from: cell.from, style: cell.style, text: cell.text })),
      ...model.dropped.map((d) => ({ cell: null, from: d.from, style: d.style, text: d.text })),
    ].sort((x, y) => x.from - y.from)
    const inner = new Map<TableCellModel, Model>()
    let nested: ParseSetup | null = null
    for (const { cell, style, text } of cells) {
      if (style === 'asciidoc') {
        if (text === '' || (this.parseSetup.depth ?? 0) >= MAX_NESTING) continue
        nested ??= cellSetup(this.parseSetup, this.rec.freeze(), this.st.doctype, this.st.leveloffset)
        const built = new Builder(parseNested(text, nested), this, nested).build()
        if (cell) inner.set(cell, built)
      } else if (style !== 'literal' && model.format === 'psv') this.catalogLeadingAnchor(text)
    }
    return { model, inner }
  }

  private markdownQuote(parent: Blk, n: SyntaxNode): Blk {
    const meta = this.readMeta(n)
    const b = this.start('quote', n, meta)
    b.style = 'quote'
    b.attrs.set('style', 'quote')
    const attribution = n.getChild('QuoteAttribution')
    if (attribution) {
      const credit = rstrip(this.text.slice(attribution.from, attribution.to)).slice(3)
      const text = substitute(credit, null, NORMAL_SUBS, this.env(null))
      const idx = text.indexOf(', ')
      if (idx >= 0) {
        b.attrs.set('attribution', text.slice(0, idx))
        b.attrs.set('citetitle', text.slice(idx + 2))
      } else if (text !== '') b.attrs.set('attribution', text)
    }
    this.container(b, n)
    return this.finish(b, meta, parent)
  }

  // ---------------------------------------------------------------- macros

  private blockMacro(parent: Blk, n: SyntaxNode): Blk | null {
    const meta = this.readMeta(n)
    const nameNode = n.getChild('MacroName')!
    const name = this.text.slice(nameNode.from, nameNode.to)
    const targetNode = n.getChild('MacroTarget')
    let target = targetNode ? this.text.slice(targetNode.from, targetNode.to) : ''
    // the attribute list (with references substituted): from after the `[` to before the `]`
    const line = rstrip(this.text.slice(nameNode.from, n.to))
    const open = line.indexOf('[', name.length + 2 + target.length)
    const attrText = open >= 0 ? line.slice(open + 1, -1) : ''
    const ctx = name === 'image' || name === 'video' || name === 'audio' || name === 'toc' ? name : 'macro'
    if (ctx === 'macro') return null
    const b = this.start(ctx, n, meta)
    const sub = (s: string) => (s.includes('{') ? subAttributes(s, (k) => this.rec.get(k)) : s)
    if (attrText !== '') {
      const posattrs =
        name === 'video'
          ? ['poster', 'width', 'height']
          : name === 'audio'
            ? []
            : name === 'toc'
              ? []
              : ['alt', 'width', 'height']
      const attrs = parseAttrs(sub(attrText), posattrs, null)
      const macroTitle = attrs.get('title')
      if (macroTitle !== undefined && macroTitle !== null) b.title = { str: macroTitle }
      for (const [k, v] of attrs) if (v !== null) b.attrs.set(k, v)
      for (const [k, v] of attrs) if (v === null && !b.attrs.has(k)) b.attrs.set(k, null)
      if (name === 'image' || name === 'video' || name === 'audio') {
        // the first positional attribute of the block attribute line is the style of a paragraph, not of a macro
      }
    }
    if (name !== 'toc') {
      if (target.includes('{')) target = sub(target)
      // style has no special meaning for media macros: it is the alt text of an image
      const style = (meta.acc.wiped ? null : b.attrs.get('style')) ?? meta.acc.style
      b.attrs.delete('style')
      if (name === 'image') {
        b.attrs.set('imagesdir', this.rec.get('imagesdir') ?? null)
        if (!b.attrs.has('alt')) {
          const base = basenameNoExt(target).replace(/[_-]/g, ' ')
          if (style) b.attrs.set('alt', style)
          else {
            b.attrs.set('default-alt', base)
            b.attrs.set('alt', base)
          }
        }
        const sw = b.attrs.get('scaledwidth')
        b.attrs.delete('scaledwidth')
        if (sw) b.attrs.set('scaledwidth', /\d+$/.test(sw) ? `${sw}%` : sw)
        b.style = null
        if (b.title) {
          const given = b.attrs.get('caption') ?? null
          b.attrs.delete('caption')
          this.assignCaption(b, given, 'figure')
        }
      }
      b.attrs.set('target', target)
    } else b.style = null
    b.attrs.delete('title')
    // the `id` in the brackets of the macro wins over the anchor above it
    b.id = b.attrs.get('id') ?? meta.acc.id ?? null
    if (b.id !== null && !this.refs.has(b.id)) this.refs.set(b.id, { kind: 'block', blk: b, reftext: null })
    b.parent = parent
    return b
  }

  private discrete(parent: Blk, n: SyntaxNode): Blk {
    const meta = this.readMeta(n)
    const b = this.start('floating_title', n, meta)
    const t = n.getChild('TitleText')!
    const setext = n.getChild('SetextUnderline')
    let tTo = t.to
    let id = meta.acc.id
    const raw = this.text.slice(t.from, tTo)
    if (id === null && raw.endsWith(']]')) {
      const m = InlineSectionAnchorRx.exec(raw)
      if (m && !m[1]) {
        tTo = t.from + raw.length - m[0].length
        id = m[2]!
        if (m[3] !== undefined && !b.attrs.has('reftext')) b.attrs.set('reftext', m[3])
      }
    }
    b.title = { lines: [setext ? rstrip(this.text.slice(t.from, tTo)) : this.text.slice(t.from, tTo)] }
    b.level = (n.tree?.prop(sectionLevel) as number | undefined) ?? 1
    b.attrs.delete('title')
    if (id === null && this.rec.get('sectids') !== undefined) {
      b.convertedTitle = substitute(
        (b.title as { lines: string[] }).lines.join('\n'),
        null,
        NORMAL_SUBS,
        this.env(null),
      )
      id = generateId(
        b.convertedTitle,
        (k) => this.rec.get(k),
        (i) => this.refs.has(i),
      )
    }
    b.id = id
    b.parent = parent
    if (id !== null && !this.refs.has(id)) this.refs.set(id, { kind: 'block', blk: b, reftext: null })
    return b
  }

  // ---------------------------------------------------------------- lists

  private list(parent: Blk, n: SyntaxNode): Blk {
    const meta = this.readMeta(n)
    const type =
      n.name === 'UnorderedList'
        ? 'ulist'
        : n.name === 'OrderedList'
          ? 'olist'
          : n.name === 'DescriptionList'
            ? 'dlist'
            : 'colist'
    const b = this.start(type, n, meta)
    let style = type === 'olist' ? meta.acc.style : meta.acc.shownStyle
    if (type === 'ulist' && !style && parent.ctx === 'section' && parent.sectname === 'bibliography')
      style = 'bibliography'
    if (type === 'colist') style = 'arabic'
    b.style = style
    b.parent = parent
    const items = kids(n).filter((c) => c.name === 'ListItem')
    let ordinal = 0
    for (const it of items) {
      b.items.push(this.listItem(b, it, type, ordinal))
      ordinal++
    }
    return this.finish(b, meta, parent)
  }

  private listItem(list: Blk, n: SyntaxNode, type: string, ordinal: number): Blk {
    const item = new Blk('list_item')
    item.node = n
    item.from = n.from
    item.parent = list
    item.effects = this.takePending()
    const cs = kids(n)
    const marker = cs.find((c) => c.name === 'ListMarker')
    const markerText = marker ? this.text.slice(marker.from, marker.to) : ''
    let ownFirstLine = true
    if (type === 'dlist') {
      for (const c of cs) {
        if (c.name !== 'DescriptionTerm') continue
        const t = new Blk('list_item')
        t.parent = list
        t.text = { lines: [this.text.slice(c.from, c.to)] }
        item.terms.push(t)
        const term = this.text.slice(c.from, c.to)
        if (term.startsWith('[[')) this.catalogLeadingAnchor(term, true)
      }
      // a description that starts on the next line has no text on the line of its term
      const lastMarker = [...cs].reverse().find((c) => c.name === 'ListMarker')
      const after = lastMarker ? cs[cs.indexOf(lastMarker) + 1] : undefined
      ownFirstLine = !(after && after.name === 'Newline')
    } else item.marker = markerText
    let text: Src | null = null
    const textNodes = cs.filter((c) => c.name === 'ItemText')
    if (textNodes.length) {
      let lines: string[] = []
      for (const tn of textNodes) lines.push(...this.linesOf(tn))
      // the lines that come from a paragraph folded into the text lose their common indentation
      const own = ownFirstLine ? 1 : 0
      if (lines.length > own && /^[ \t]/.test(lines[own]!)) {
        lines = [...lines.slice(0, own), ...adjustIndentation(lines.slice(own))]
      } else if (!ownFirstLine && lines.length > 0 && /^[ \t]/.test(lines[0]!))
        lines = adjustIndentation(lines)
      text = { lines }
    }
    let cb = cs.find((c) => c.name === 'Checkbox')
    if (cb && list.style === 'bibliography') {
      // a bibliography list has no checklist: the box stays in the text
      const box = this.text.slice(cb.from, cb.from + 4)
      if (text && 'lines' in text) text = { lines: [box + (text.lines[0] ?? ''), ...text.lines.slice(1)] }
      else text = { lines: [box] }
      cb = undefined
    }
    const first = text && 'lines' in text ? (text.lines[0] ?? '') : ''
    if (type === 'ulist') {
      if (cb) {
        list.attrs.set('checklist-option', '')
        item.attrs.set('checkbox', '')
        if (this.text.charAt(cb.from + 1) !== ' ') item.attrs.set('checked', '')
      } else if (list.style === 'bibliography') {
        const m = BiblioAnchorRx.exec(first)
        if (m && !this.refs.has(m[1]!))
          this.refs.set(m[1]!, { kind: 'anchor', blk: null, reftext: m[2] !== undefined ? `[${m[2]}]` : null })
      } else if (first.startsWith('[[')) this.catalogLeadingAnchor(first)
    } else if (type === 'olist') {
      const r = resolveOrderedMarker(markerText, ordinal)
      item.marker = r.marker
      if (ordinal === 0 && !list.style) {
        // the marker decides the style: a letter or number marker gives it as a symbol (no `type` attribute
        // in the output), a run of dots as a string
        const styles = ['arabic', 'loweralpha', 'lowerroman', 'upperalpha', 'upperroman']
        if (r.style) {
          list.style = r.style
          list.attrs.set('__implicit', '1')
        } else list.style = styles[markerText.length - 1] ?? 'arabic'
      }
      if (first.startsWith('[[')) this.catalogLeadingAnchor(first)
    } else if (first.startsWith('[[')) this.catalogLeadingAnchor(first)
    item.text = text
    this.container(item, n)
    if (type === 'dlist') item.desc = (text !== null && text.lines.join('') !== '') || item.blocks.length > 0
    return item
  }

  private catalogLeadingAnchor(text: string, term = false): void {
    const m = leadingAnchor(text)
    if (!m) return
    // the text of a term after its anchor is what a reference to the term says
    let reftext: string | null = m.reftext ?? (term ? text.slice(m.end).replace(/^[\t\n\v\f\r ]+/, '') : null)
    if (reftext !== null && reftext.includes('{')) reftext = subAttributes(reftext, (k) => this.rec.get(k))
    if (!this.refs.has(m.id)) this.refs.set(m.id, { kind: 'anchor', blk: null, reftext })
  }

  /** Parser.catalog_inline_anchors. */
  private catalogInlineAnchors(text: string): void {
    if (!text.includes('[[') && !text.includes('or:')) return
    for (const m of scanAnchors(text)) {
      // an escaped anchor, and a `[[` right after a `[` (a bibliography anchor), are not anchors here
      if (m[1] !== undefined || (m[0].startsWith('[[') && m.index > 0 && text.charCodeAt(m.index - 1) === 91))
        continue
      let id: string
      let reftext: string | null
      if (m[2] !== undefined) {
        id = m[2]
        reftext = m[3] ?? null
        if (reftext !== null && reftext.includes('{')) {
          reftext = subAttributes(reftext, (k) => this.rec.get(k))
          if (reftext === '') continue
        }
      } else {
        id = m[4]!
        reftext = m[5] ?? null
        if (reftext !== null) {
          if (reftext.includes(']')) {
            reftext = reftext.replaceAll('\\]', ']')
            if (reftext.includes('{')) reftext = subAttributes(reftext, (k) => this.rec.get(k))
          } else if (reftext.includes('{')) {
            reftext = subAttributes(reftext, (k) => this.rec.get(k))
            if (reftext === '') reftext = null
          }
        }
      }
      if (!this.refs.has(id)) this.refs.set(id, { kind: 'anchor', blk: null, reftext })
    }
  }
}

/** Every block takes the title a section left over; the pieces that are no blocks do not. */
function ctxTakesCarry(ctx: string): boolean {
  return ctx !== 'section' && ctx !== 'list_item' && ctx !== 'preamble'
}

function basenameNoExt(path: string): string {
  if (/^\/+$/.test(path)) return '/'
  const trimmed = path.replace(/\/+$/, '')
  const base = trimmed.slice(trimmed.lastIndexOf('/') + 1)
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(0, dot) : base
}

function attrsWithHash(a: Attrs): AttrsBuilderInit {
  return a
}
type AttrsBuilderInit = Attrs

/** Helpers.nextval: the next value of a counter (a number, or the next letter). */
export function nextval(cur: string): string {
  if (/^-?\d+$/.test(cur)) return String(Number(cur) + 1)
  if (cur === '') return '1'
  // a letter counter: A → B, z → aa
  const chars = [...cur]
  const last = chars.pop()!
  return chars.join('') + String.fromCodePoint(last.codePointAt(0)! + 1)
}

void parseAttributeList
void REFTEXT_SUBS
void stripEnd
