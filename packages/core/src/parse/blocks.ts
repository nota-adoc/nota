/**
 * Line-oriented block parser, following Asciidoctor 2.0's Parser (parse_document_header,
 * next_section, next_block, parse_block_metadata_line, read_paragraph_lines, build_block, parse_list…).
 *
 * The document is parsed as a sequence of units. A unit is: blank lines, a run of metadata lines
 * (comments, attribute entries, block attributes, anchors, block titles) and then either a block
 * or a section title. Every unit depends only on the text from its start and on the parse state
 * at its start, which is what makes reparsing after an edit incremental (see incremental.ts).
 *
 * Blocks that hold blocks (delimited blocks, list items, Markdown quotes) are parsed the way Asciidoctor
 * does it: the lines of the container are collected first, then parsed as a reader of their own. The
 * containers nest as deep as the text does, so that recursion runs on an explicit stack (see `run`).
 */
import { type TableModel, Type, blockKind, sectionLevel, tableModel } from '../nodes.js'
import {
  AttributeTracker,
  AttrsBuilder,
  applyValueSubs,
  subAttributes,
  subSpecialChars,
  type AttributeSetup,
  type Attrs,
} from './attrs.js'
import { processAuthors, processRevision } from './authors.js'
import { BlockAttributes, parseAttributeList, parseShorthand } from './attrlist.js'
import { type N, Claimer, clean, leaf, mergeLeaves, node, toPiece, withClaimer, withProp } from './build.js'
import { type Diagnostic, type ParseState, type Severity, type Task, type Unit, run } from './context.js'
import { ArrayReader, Cur, type LineReader, type Ln, SourceLines, hiddenNode } from './lines.js'
import {
  BASIC_SUBS,
  NORMAL_SUBS,
  NO_SUBS,
  VERBATIM_SUBS,
  blockSubs,
  nestNodes,
  scanInline,
  spliceInline,
  textPieces,
  type InlineEnv,
  type Sub,
  type TextLineRef,
} from './inline/index.js'
import { parseList } from './lists.js'
import { type AsciiCell, type Lex, type TableLine, MAX_NESTING, scanTable, tableNodes } from './table.js'
import {
  AdmonitionParagraphRx,
  AdmonitionStyles,
  AttributeEntryRx,
  AuthorInfoLineRx,
  BlockAnchorRx,
  BlockAttributeListRx,
  BlockTitleRx,
  ParagraphStyles,
  SetextLevels,
  SetextSectionTitleRx,
  VerbatimStyles,
  charLength,
  isAnyList,
  isBlockAttributeLine,
  isManpageNameLine,
  isMarkdownThematicBreak,
  isUniform,
  layoutBreak,
  lstripLength,
  matchAtxSectionTitle,
  matchColist,
  matchCustomMacro,
  matchDlist,
  matchMediaMacro,
  matchOlist,
  matchRevisionInfoLine,
  matchTocMacro,
  matchUlist,
  rstrip,
  type MacroMatch,
  type RevisionMatch,
} from './rx.js'

export type { Diagnostic, Severity, ParseState, Unit, SectionHead } from './context.js'
export { initialStateOf, sameState } from './context.js'

interface MetaItem {
  n: N
  attaching: boolean
  entry: boolean
  blank: boolean
  /** A block title whose text is read once the run of metadata is over: the line of it. */
  title?: number
}

type MutableState = { -readonly [K in keyof ParseState]: ParseState[K] } & { stack: number[] }

/** What the parser knows about the parse as a whole: options and the state shared by all containers. */
export interface ParseSetup {
  readonly attrs: AttributeSetup
  /** Names of block macros that are read as macros (besides `image`, `video`, `audio` and `toc`). */
  readonly blockMacros: ReadonlySet<string>
  /** How many table cells the document being read is in (0 for the document itself). */
  readonly depth?: number
  /** Reads the documents in table cells; without it a cell with the `a` style is text. */
  readonly cells?: CellReaders
}

/** The text of a table cell as the document in it reads it, and where each of its characters is in the source. */
export interface CellText {
  readonly text: string
  /** For each character, where it starts and where it ends in the source. */
  readonly starts: readonly number[]
  readonly ends: readonly number[]
}

/** The document in a cell: its nodes and problems, over the source. */
export interface CellDocument {
  readonly nodes: N[]
  readonly diagnostics: Diagnostic[]
}

/** The two steps of reading the documents in the cells of a table (see nested.ts). */
export interface CellReaders {
  /** The setup for the documents in the cells of a table found where the attributes are `attrs`. */
  setup(parent: ParseSetup, attrs: Attrs, doctype: string, leveloffset?: number): ParseSetup
  /** Reads a cell whose content is `[from, to)` in the source. */
  read(setup: ParseSetup, cell: CellText, from: number, to: number): CellDocument
}

const DELIMITED: Readonly<Record<string, string>> = {
  '--': 'open',
  '----': 'listing',
  '....': 'literal',
  '====': 'example',
  '****': 'sidebar',
  ____: 'quote',
  '++++': 'pass',
  '|===': 'table',
  ',===': 'table',
  ':===': 'table',
  '!===': 'table',
  '////': 'comment',
  '```': 'fenced_code',
}
const DELIMITED_HEADS = new Set(Object.keys(DELIMITED).map((k) => k.slice(0, 2)))

/** The styles that turn a delimited block into another kind of block (Asciidoctor's `masq`). */
const MASQ: Readonly<Record<string, ReadonlySet<string>>> = {
  '--': new Set([
    'comment',
    'example',
    'literal',
    'listing',
    'pass',
    'quote',
    'sidebar',
    'source',
    'verse',
    'admonition',
    'abstract',
    'partintro',
  ]),
  '----': new Set(['literal', 'source']),
  '....': new Set(['listing', 'source']),
  '====': new Set(['admonition']),
  ____: new Set(['verse']),
  '++++': new Set(['stem', 'latexmath', 'asciimath']),
}
const NO_MASQ: ReadonlySet<string> = new Set()

/** Port of Parser.is_delimited_block?: the block context, the tip and the exact closing line. */
export function delimitedBlock(line: string): { context: string; terminator: string; tip: string } | null {
  let len = line.length
  if (len < 2 || !DELIMITED_HEADS.has(line.slice(0, 2))) return null
  let tip: string
  let tipLen: number
  if (len === 2) {
    tip = line
    tipLen = 2
  } else {
    if (len < 5) {
      tip = line
      tipLen = len
    } else {
      tip = line.slice(0, 4)
      tipLen = 4
    }
    if (tip.startsWith('`')) {
      if (tipLen === 4) {
        if (tip === '````' || tip.slice(0, 3) !== '```') return null
        tip = line = '```'
        len = tipLen = 3
      } else if (tip !== '```') {
        return null
      }
    } else if (tipLen === 3) {
      return null
    }
  }
  const context = DELIMITED[tip]
  if (!context) return null
  if (len === tipLen || isUniform(line.slice(1), tip.charAt(tip.length - 1)))
    return { context, terminator: line, tip }
  return null
}

function atxLevel(line: string): number | null {
  const c = line.charCodeAt(0)
  if (c !== 61 /* = */ && c !== 35 /* # */) return null
  const m = matchAtxSectionTitle(line)
  return m ? m.markerEnd - 1 : null
}

function setextLevel(line1: string, line2: string): number | null {
  const level = SetextLevels[line2.charAt(0)]
  if (level === undefined || !isUniform(line2, line2.charAt(0))) return null
  if (!SetextSectionTitleRx.test(line1)) return null
  return Math.abs(charLength(line1) - charLength(line2)) < 2 ? level : null
}

/** StartOfBlockProc: a block attribute line or a delimited block. */
function startOfBlock(line: string): boolean {
  return (line.startsWith('[') && isBlockAttributeLine(line)) || delimitedBlock(line) !== null
}

function applyLeveloffset(level: number, offset: number): number {
  const l = level + offset
  return l < 0 ? 0 : l
}

const DIRECTIVE_NAMES: ReadonlySet<string> = new Set(['ifdef', 'ifndef', 'ifeval', 'endif', 'include'])

export type ListType = 'ulist' | 'olist' | 'dlist' | 'colist'

/** Options of one `next_block` call. */
export interface BlockOpts {
  /** Number of blank lines skipped before the block. */
  skipped: number
  /** Only the text of a list item is wanted (the first block of an item, adjacent to its text). */
  textOnly: boolean
  /** The type of the list whose item is being parsed, if any. */
  listType: ListType | null
}

/** Styles whose paragraph is dropped (comment) or shown as it is. */
const AsIsStyles: ReadonlySet<string> = new Set([
  'comment',
  'literal',
  'listing',
  'source',
  'verse',
  'pass',
  'stem',
  'latexmath',
  'asciimath',
])

export const TOP_OPTS: BlockOpts = { skipped: 0, textOnly: false, listType: null }

/** A parsed block and the nodes that follow it (blank lines a list has taken). */
export interface BlockResult {
  n: N
  after: N[]
}

/** State shared by the parsers of the containers of one unit. */
export interface Shared {
  readonly text: string
  readonly setup: ParseSetup
  readonly st: MutableState
  readonly ab: AttrsBuilder
  readonly tracker: AttributeTracker
  readonly diags: Diagnostic[]
  readonly S: SourceLines
  /** Attributes set by header entries (only the ones that change parsing are tracked). */
  readonly headerSet: Set<string>
  /** The text of paragraphs that may become the text of a list item: read again with the item. */
  readonly rawText: WeakMap<N, { children: N[]; acc: BlockAttributes }>
}

/** The substitutions of the text of a paragraph of a style. */
function paragraphDefaults(style: string | null): readonly Sub[] {
  switch (style) {
    case 'literal':
    case 'listing':
    case 'source':
      return VERBATIM_SUBS
    case 'pass':
    case 'comment':
      return NO_SUBS
    case 'stem':
    case 'latexmath':
    case 'asciimath':
      return BASIC_SUBS
    default:
      return NORMAL_SUBS
  }
}

/** The parser of the blocks in one reader: the document, or the content of a container. */
export class BP {
  /** The blocks `nextBlock` has produced, in order. */
  readonly blocksSeen: N[] = []

  constructor(
    readonly c: Shared,
    readonly L: LineReader,
  ) {}

  /** A parser of the blocks in a container inside this one. */
  child(reader: LineReader): BP {
    return new BP(this.c, reader)
  }

  // ---------------------------------------------------------------- small nodes

  blankNode(i: number): N {
    const ln = this.L.ln(i)
    return leaf(ln.kind === 1 ? Type.ListContinuation : Type.BlankLine, ln.from, ln.next)
  }

  lineComment(i: number): N {
    return leaf(Type.LineComment, this.L.start(i), this.L.next(i))
  }

  newline(i: number): N | null {
    const L = this.L
    const s = L.newlineStart(i)
    const e = L.next(i)
    return e > s ? leaf(Type.Newline, s, e) : null
  }

  /** A line of text; when its text ends before its white space does (a one-line condition) it says where. */
  textLine(i: number): N {
    return this.textLineFrom(this.L.ln(i), this.L.start(i))
  }

  /** What the substitutions need to know: the attributes of the document at this point and of the block. */
  inlineEnv(acc: BlockAttributes | null, extra: Partial<InlineEnv> = {}): InlineEnv {
    const ab = this.c.ab
    return {
      get: (n) => ab.get(n),
      // `{set:}` and `{counter:}` change the attributes of the document from this point on
      ...this.c.tracker.hooks,
      block: acc ? (n) => acc.attributes.get(n) ?? undefined : undefined,
      ...extra,
    }
  }

  /**
   * Runs the substitutions `subs` over the text lines among `children` (as one text, the lines joined by line
   * feeds) and puts the constructs they find into the lines; comments and the like between the lines stay.
   */
  inlineLines(
    children: N[],
    subs: readonly Sub[],
    acc: BlockAttributes | null,
    extra?: Partial<InlineEnv>,
  ): N[] {
    if (subs.length === 0) return children
    const text = this.c.text
    const refs: TextLineRef[] = []
    for (const n of children) {
      if (n.type !== Type.TextLine || n.children) continue
      const own = n.props?.find((p) => p[0] === (textPieces as unknown))?.[1] as readonly number[] | undefined
      refs.push({
        n,
        piece: own ? [own[0]!, own[1]!] : [n.from, n.from + rstrip(text.slice(n.from, n.to)).length],
      })
    }
    if (refs.length === 0) return children
    return this.inlineNodes(children, refs, subs, acc, extra)
  }

  /** A paragraph whose text was kept raw for a list item that did not take it: read its text now. */
  finishRaw(n: N): void {
    const raw = this.c.rawText.get(n)
    if (!raw || !n.children) return
    const meta = n.children.filter((c) => !raw.children.includes(c))
    const subs = blockSubs(NORMAL_SUBS, raw.acc.attributes.get('subs'))
    // what lies between the lines of the text (a condition line that shows nothing) keeps its place
    n.children = [...meta, ...this.inlineLines(raw.children, subs, raw.acc)].sort((a, b) => a.from - b.from)
    this.c.rawText.delete(n)
  }

  /** The line of text that starts at `from` on the line `ln` (see `textLine`). */
  textLineFrom(ln: Ln, from: number): N {
    const rawEnd = from + rstrip(this.c.text.slice(from, ln.next)).length
    const n = leaf(Type.TextLine, from, ln.next)
    // the closing bracket of a one-line condition is not part of the text
    if (ln.end < rawEnd && ln.end >= from) withProp(n, textPieces, [from, ln.end])
    return n
  }

  /** A node of `type` over `[from, to)`, with the constructs the substitutions find in that text as children. */
  inlineText(
    type: number,
    from: number,
    to: number,
    subs: readonly Sub[],
    acc: BlockAttributes | null,
    trial = false,
  ): N {
    if (subs.length === 0 || to <= from) return leaf(type, from, to)
    let extra: Partial<InlineEnv> | undefined
    if (trial) {
      // read on a copy of the attributes: what it sets is not done
      const t = this.c.tracker.fork(this.c.ab.freeze(), true)
      extra = { get: (n) => t.get(n), ...t.hooks }
    }
    const sink = scanInline(this.c.text, [[from, to]], subs, this.inlineEnv(acc, extra))
    this.c.diags.push(...sink.diags)
    const roots = nestNodes(sink.nodes)
    return roots.length ? node(type, from, to, roots) : leaf(type, from, to)
  }

  /** The substitutions over the given lines: nodes into `children`. */
  inlineNodes(
    children: N[],
    refs: readonly TextLineRef[],
    subs: readonly Sub[],
    acc: BlockAttributes | null,
    extra?: Partial<InlineEnv>,
  ): N[] {
    const sink = scanInline(
      this.c.text,
      refs.map((r) => r.piece),
      subs,
      this.inlineEnv(acc, extra),
    )
    this.c.diags.push(...sink.diags)
    if (sink.nodes.length === 0) return children
    return spliceInline(children, refs, nestNodes(sink.nodes))
  }

  diag(from: number, to: number, severity: Severity, code: string, message: string): void {
    this.c.diags.push({ from, to, severity, code, message })
  }

  /** The end of the text of the reader: the end of the document, or the end of its last line. */
  endOffset(lastIndex: number, floor: number): number {
    if (this.L instanceof SourceLines) return this.c.text.length
    return Math.max(floor, lastIndex >= 0 && this.L.has(lastIndex) ? this.L.next(lastIndex) : floor)
  }

  /** Runs `fn` with the preprocessor off for the lines it reads from the document (comments are read raw; a `peek` reads only to look, and the lines are read again later). */
  withoutProcessing<T>(fn: () => T, on = true, peek = false): T {
    const S = this.c.S
    if (!on || this.L !== S) return fn()
    const saved = S.processing
    const mark = S.mark()
    S.processing = false
    try {
      return fn()
    } finally {
      S.processing = saved
      // a peek puts the lines back
      if (peek) S.rewind(mark)
    }
  }

  // ---------------------------------------------------------------- metadata

  /** Parser.parse_block_metadata_lines: metadata lines with blank lines between them. */
  metadataRun(
    i: number,
    acc: BlockAttributes,
    header: boolean,
    textOnly = false,
  ): { items: MetaItem[]; next: number } {
    const L = this.L
    const items: MetaItem[] = []
    while (L.has(i)) {
      const line = L.get(i)
      let item: MetaItem | null = null
      let next = i + 1
      const c = line.charAt(0)
      if (c === '[') {
        if (line.startsWith('[[')) {
          const m = line.endsWith(']]') ? BlockAnchorRx.exec(line) : null
          if (m) item = { n: this.blockAnchor(i, m, acc), attaching: true, entry: false, blank: false }
        } else if (line.endsWith(']')) {
          const m = BlockAttributeListRx.exec(line)
          if (m) item = { n: this.blockAttributes(i, m, acc), attaching: true, entry: false, blank: false }
        }
      } else if (c === '.') {
        if (!textOnly) {
          const m = BlockTitleRx.exec(line)
          if (m) {
            acc.applyTitle(m[1]!)
            item = { n: this.blockTitle(i, false), attaching: true, entry: false, blank: false, title: i }
          }
        }
      } else if (c === '/') {
        if (line === '//') {
          item = { n: this.lineComment(i), attaching: false, entry: false, blank: false }
        } else if (line.startsWith('//')) {
          if (isUniform(line, '/')) {
            if (line.length !== 3) {
              const bc = this.blockComment(i)
              item = { n: bc.n, attaching: false, entry: false, blank: false }
              next = bc.next
            }
          } else if (!line.startsWith('///')) {
            item = { n: this.lineComment(i), attaching: false, entry: false, blank: false }
          }
        }
      } else if (c === ':') {
        if (!textOnly) {
          const m = AttributeEntryRx.exec(line)
          if (m) {
            const e = this.attributeEntry(i, m, header)
            item = { n: e.n, attaching: false, entry: true, blank: false }
            next = e.next
          }
        }
      }
      if (!item) break
      items.push(item)
      i = next
      while (L.has(i) && L.blank(i))
        items.push({ n: this.blankNode(i++), attaching: false, entry: false, blank: true })
    }
    this.readTitles(items)
    return { items, next: i }
  }

  /**
   * The text of the titles of a run of metadata. Asciidoctor converts a title when its block is converted, after
   * the attribute entries of the block: they count for it wherever they stand. Only the last title is the title
   * of the block (the others are overwritten and never converted): what `{set:}` and `{counter:}` do in them is
   * not done.
   */
  private readTitles(items: MetaItem[]): void {
    const last = findLastIndex(items, (it) => it.title !== undefined)
    if (last < 0) return
    for (let k = 0; k <= last; k++) {
      const it = items[k]!
      if (it.title === undefined) continue
      it.n = this.blockTitle(it.title, true, k !== last)
    }
  }

  blockAnchor(i: number, m: RegExpExecArray, acc: BlockAttributes): N {
    const L = this.L
    const s = L.start(i)
    const ind = m.indices!
    acc.applyAnchor(m[1] ?? null, m[2] ?? null)
    return node(
      Type.BlockAnchor,
      s,
      L.next(i),
      clean([
        ind[1] ? leaf(Type.AnchorId, s + ind[1][0], s + ind[1][1]) : null,
        ind[2] ? leaf(Type.AnchorRefText, s + ind[2][0], s + ind[2][1]) : null,
        this.newline(i),
      ]),
    )
  }

  /** The nodes of an attribute list; `base` is the offset of `source` in the text. */
  attributeItems(source: string, base: number, shorthand: boolean): N[] {
    const children: N[] = []
    for (const item of parseAttributeList(source)) {
      if (item.to <= item.from) continue
      if (item.name !== undefined) {
        children.push(
          node(
            Type.NamedAttribute,
            base + item.from,
            base + item.to,
            clean([
              leaf(Type.AttributeName, base + item.nameFrom!, base + item.nameTo!),
              leaf(Type.AttributeValue, base + item.valueFrom!, base + item.valueTo!),
            ]),
          ),
        )
      } else {
        const raw = source.slice(item.from, item.to)
        const parts = shorthand && item.index === 0 && raw === item.value ? parseShorthand(raw) : null
        const kinds = {
          style: Type.ShorthandStyle,
          id: Type.ShorthandId,
          role: Type.ShorthandRole,
          option: Type.ShorthandOption,
        }
        children.push(
          parts
            ? node(
                Type.PositionalAttribute,
                base + item.from,
                base + item.to,
                clean(
                  parts.map((p) => leaf(kinds[p.kind], base + item.from + p.from, base + item.from + p.to)),
                ),
              )
            : leaf(Type.PositionalAttribute, base + item.from, base + item.to),
        )
      }
    }
    return children
  }

  blockAttributes(i: number, m: RegExpExecArray, acc: BlockAttributes): N {
    const L = this.L
    const s = L.start(i)
    const source = m[1]!
    const children = this.attributeItems(source, s + 1, true)
    const nl = this.newline(i)
    if (nl) children.push(nl)
    acc.applyList(source)
    return node(Type.BlockAttributes, s, L.next(i), clean(children))
  }

  /** A block title line; `read` says whether its text is read for constructs (`overwritten`: without what it does to attributes). */
  blockTitle(i: number, read: boolean, overwritten = false): N {
    const L = this.L
    const s = L.start(i)
    const text = read
      ? this.inlineText(Type.TitleText, s + 1, L.contentEnd(i), NORMAL_SUBS, null, overwritten)
      : leaf(Type.TitleText, s + 1, L.contentEnd(i))
    return node(Type.BlockTitle, s, L.next(i), clean([text, this.newline(i)]))
  }

  /** Parser.process_attribute_entry, including value continuation lines. */
  attributeEntry(i: number, m: RegExpExecArray, header: boolean): { n: N; next: number } {
    const L = this.L
    const s = L.start(i)
    const ind = m.indices!
    const rawName = m[1]!
    const children: (N | null)[] = []
    let nf = s + ind[1]![0]
    let nt = s + ind[1]![1]
    if (rawName.startsWith('!')) {
      children.push(leaf(Type.UnsetMarker, nf, nf + 1))
      nf++
    }
    let trailingBang: N | null = null
    if (rawName.endsWith('!') && nt - 1 >= nf) {
      trailingBang = leaf(Type.UnsetMarker, nt - 1, nt)
      nt--
    }
    children.push(leaf(Type.AttributeName, nf, nt), trailingBang)
    let value: string
    let next = i + 1
    let lastLine = i
    let swallowed: N | null = null
    if (m[2] === undefined || m[2] === '') {
      value = ''
    } else {
      const vs = s + ind[2]![0]
      const raw = m[2]
      const valueParts: (N | null)[] = []
      if (raw.endsWith(' \\') || raw.endsWith(' +')) {
        const con = raw.slice(-2)
        value = rstrip(raw.slice(0, -2))
        valueParts.push(
          leaf(Type.ValueText, vs, vs + value.length),
          leaf(Type.LineContinuation, vs + raw.length - 2, vs + raw.length),
        )
        let k = i
        for (;;) {
          k++
          if (!L.has(k) || L.blank(k)) {
            if (L.has(k)) swallowed = this.blankNode(k)
            next = L.has(k) ? k + 1 : k
            break
          }
          valueParts.push(this.newline(k - 1))
          const line = L.get(k)
          const ls = lstripLength(line)
          let part = line.slice(ls)
          const ks = L.start(k) + ls
          const keepOpen = part.endsWith(con)
          if (keepOpen) {
            part = rstrip(part.slice(0, -2))
            valueParts.push(
              leaf(Type.ValueText, ks, ks + part.length),
              leaf(Type.LineContinuation, L.contentEnd(k) - 2, L.contentEnd(k)),
            )
          } else {
            valueParts.push(leaf(Type.ValueText, ks, ks + part.length))
          }
          value = `${value}${value.endsWith(' +') ? '\n' : ' '}${part}`
          lastLine = k
          next = k + 1
          if (!keepOpen) break
        }
      } else {
        value = raw
        valueParts.push(leaf(Type.ValueText, vs, vs + raw.length))
      }
      const vp = clean(valueParts)
      children.push(node(Type.AttributeValue, vp[0]?.from ?? vs, vp[vp.length - 1]?.to ?? vs, vp))
    }
    children.push(this.newline(lastLine), swallowed)
    this.applyEntry(rawName, value, header)
    const end = swallowed ? swallowed.to : L.next(lastLine)
    return { n: node(Type.AttributeEntry, s, end, clean(children)), next }
  }

  /** Parser.store_attribute for an entry (the parts that matter for how the document is parsed). */
  applyEntry(rawName: string, value: string, header: boolean): void {
    const { name, unset } = this.c.tracker.entry(rawName, value, header)
    if (header) {
      if (unset) this.c.headerSet.delete(name)
      else this.c.headerSet.add(name)
    }
  }

  // ---------------------------------------------------------------- comments and lines

  blockComment(i: number): { n: N; next: number } {
    const L = this.L
    const term = L.get(i)
    const j = this.withoutProcessing(() => {
      let j = i + 1
      while (L.has(j) && L.get(j) !== term) j++
      return j
    })
    const children: (N | null)[] = [leaf(Type.CommentDelimiter, L.start(i), L.next(i))]
    let end: number
    let next: number
    if (L.has(j)) {
      if (L.ln(j).raw > L.next(i)) children.push(leaf(Type.CommentContent, L.next(i), L.ln(j).raw))
      children.push(leaf(Type.CommentDelimiter, L.start(j), L.next(j)))
      end = L.next(j)
      next = j + 1
    } else {
      end = this.endOffset(j - 1, L.next(i))
      if (L.next(i) < end) children.push(leaf(Type.CommentContent, L.next(i), end))
      next = j
      this.unterminated(i, 'comment')
    }
    return { n: node(Type.BlockComment, L.start(i), end, clean(children)), next }
  }

  unterminated(i: number, context: string): void {
    const L = this.L
    this.diag(
      L.start(i),
      L.contentEnd(i),
      'warning',
      'unterminated-block',
      `Unterminated ${context.replace('_', ' ')} block: no closing "${L.get(i)}" line`,
    )
  }

  // ---------------------------------------------------------------- blocks

  /**
   * Parser.next_block: the blank lines, the metadata and the block at the position of `cur`, appended to
   * `out` in document order. Returns the block, if there was one.
   */
  *nextBlock(cur: Cur, out: N[], listType: ListType | null, textOnlyInit: boolean): Task<N | null> {
    const L = this.L
    if (!cur.has()) return null
    let skipped = 0
    while (cur.has() && L.blank(cur.i)) {
      out.push(this.blankNode(cur.i))
      cur.i++
      skipped++
    }
    if (!cur.has()) return null
    const textOnly = textOnlyInit && skipped === 0
    const acc = new BlockAttributes()
    const meta = this.metadataRun(cur.i, acc, false, textOnly)
    const { leading, attaching } = splitRun(meta.items)
    for (const it of leading) out.push(it.n)
    cur.i = meta.next
    if (!cur.has()) {
      for (const it of attaching) out.push(it.n)
      return null
    }
    const res = yield* this.blockAt(cur, acc, attaching, { skipped, textOnly, listType })
    out.push(res.n, ...res.after)
    this.blocksSeen.push(res.n)
    return res.n
  }

  /** Parser.parse_blocks: all the blocks of the reader, appended to `out`. */
  *parseBlocks(out: N[]): Task<void> {
    const cur = new Cur(this.L, 0)
    while (cur.has()) yield* this.nextBlock(cur, out, null, false)
  }

  /** The block that starts at the line of `cur`, after its metadata (the rest of Parser.next_block). */
  *blockAt(cur: Cur, acc: BlockAttributes, attaching: MetaItem[], o: BlockOpts): Task<BlockResult> {
    const L = this.L
    const i = cur.i
    const line = L.get(i)
    const meta = attaching.map((it) => it.n)
    const from = meta.length ? meta[0]!.from : L.start(i)
    let style = acc.style
    const done = (n: N, next: number): BlockResult => {
      cur.i = next
      return { n, after: [] }
    }
    const dm = delimitedBlock(line)
    if (dm) return yield* this.delimitedAt(cur, dm, acc, meta, from)
    // process lines verbatim
    if (style && VerbatimStyles.has(style)) {
      const r = this.readParagraph(i, false, true, false)
      const subs = blockSubs(style === 'verse' ? NORMAL_SUBS : VERBATIM_SUBS, acc.attributes.get('subs'))
      const n = node(Type.StyledParagraph, from, r.to, [...meta, ...this.inlineLines(r.children, subs, acc)])
      // build_block reads these lines up to a blank line and does not put it back: the blank line is taken
      // (so it does not count as skipped before the next block)
      if (r.blank) {
        cur.i = r.next + 1
        return { n, after: [this.blankNode(r.next)] }
      }
      return done(n, r.next)
    }
    let indented: boolean
    if (o.textOnly) {
      indented = line.startsWith(' ') || line.startsWith('\t')
    } else if (line.startsWith(' ')) {
      indented = true
      if (isMarkdownThematicBreak(line)) return done(this.breakNode(Type.ThematicBreak, i, meta, from), i + 1)
    } else if (line.startsWith('\t')) {
      indented = true
    } else {
      indented = false
      const brk = layoutBreak(line)
      if (brk)
        return done(
          this.breakNode(brk === 'page_break' ? Type.PageBreak : Type.ThematicBreak, i, meta, from),
          i + 1,
        )
      if (line.endsWith(']') && line.includes('::')) {
        const ch0 = line.charAt(0)
        let m: MacroMatch | null = null
        if (ch0 === 'i' || line.startsWith('video:') || line.startsWith('audio:')) m = matchMediaMacro(line)
        else if (ch0 === 't' && line.startsWith('toc:')) m = matchTocMacro(line)
        if (m) return done(this.macroNode(i, m, meta, from), i + 1)
        m = matchCustomMacro(line)
        // an escaped directive (`\ifdef::a[]`) is text that only looks like a macro
        if (m && !DIRECTIVE_NAMES.has(m.name)) {
          if (this.c.setup.blockMacros.has(m.name)) return done(this.macroNode(i, m, meta, from), i + 1)
          this.diag(
            L.start(i),
            L.contentEnd(i),
            'info',
            'unknown-block-macro',
            `Unknown block macro "${m.name}": the line is read as a paragraph`,
          )
        }
      }
    }
    // lists
    if (!indented && line.charCodeAt(0) === 60 /* < */ && matchColist(line))
      return yield* parseList(this, cur, 'colist', style, meta, from)
    if (matchUlist(line)) return yield* parseList(this, cur, 'ulist', style, meta, from)
    if (matchOlist(line)) return yield* parseList(this, cur, 'olist', style, meta, from)
    if ((line.includes('::') || line.includes(';;')) && matchDlist(line))
      return yield* parseList(this, cur, 'dlist', style, meta, from)
    if (style === 'float' || style === 'discrete') {
      const title = this.anyTitleAt(i)
      if (title) {
        const t = this.titleNode(Type.DiscreteHeading, i, title.atx)
        const n = node(Type.DiscreteHeading, from, t.n.to, [...meta, ...t.n.children!])
        withProp(n, sectionLevel, applyLeveloffset(title.level, this.c.st.leveloffset))
        return done(n, t.next)
      }
    }
    if (style && style !== 'normal') {
      if (ParagraphStyles.has(style) || AdmonitionStyles.has(style)) {
        // a comment is not shown and the content of the other styles is shown as it is: no list item to miss
        const r = this.readParagraph(i, true, false, false, style === 'comment', !AsIsStyles.has(style))
        const subs = blockSubs(paragraphDefaults(style), acc.attributes.get('subs'))
        return done(
          node(Type.StyledParagraph, from, r.to, [...meta, ...this.inlineLines(r.children, subs, acc)]),
          r.next,
        )
      }
      style = null
    }
    const breakAtList = o.skipped === 0 && o.listType !== null
    // a literal paragraph: contiguous lines starting with at least one whitespace character
    if (indented && !style) {
      const paragraph = o.textOnly || (o.skipped === 0 && o.listType === 'dlist')
      // a literal paragraph shows its lines as they are
      const r = this.readParagraph(i, o.textOnly, false, breakAtList, false, paragraph)
      // the text of a paragraph that becomes the text of a list item is read with the item
      const kids = paragraph
        ? r.children
        : this.inlineLines(r.children, blockSubs(VERBATIM_SUBS, acc.attributes.get('subs')), acc)
      const n = node(paragraph ? Type.Paragraph : Type.LiteralParagraph, from, r.to, [...meta, ...kids])
      if (paragraph) this.c.rawText.set(n, { children: r.children, acc })
      return done(n, r.next)
    }
    // a normal paragraph: contiguous non-blank/non-continuation lines
    const r = this.readParagraph(i, true, false, breakAtList)
    if (o.textOnly) {
      const n = node(Type.Paragraph, from, r.to, [...meta, ...r.children])
      this.c.rawText.set(n, { children: r.children, acc })
      return done(n, r.next)
    }
    const subs = blockSubs(NORMAL_SUBS, acc.attributes.get('subs'))
    const am = AdmonitionParagraphRx.exec(line)
    if (am) {
      const s = L.start(i)
      const first = r.children[0]!
      const children = [
        leaf(Type.AdmonitionMarker, s, s + am[0].length),
        ...this.inlineLines(
          [leaf(Type.TextLine, s + am[0].length, first.to), ...r.children.slice(1)],
          subs,
          acc,
        ),
      ]
      return done(node(Type.AdmonitionParagraph, from, r.to, [...meta, ...children]), r.next)
    }
    if (line.startsWith('> ')) return yield* this.markdownQuote(cur, i, r, meta, from)
    return done(
      node(Type.Paragraph, from, r.to, [...meta, ...this.inlineLines(r.children, subs, acc)]),
      r.next,
    )
  }

  private breakNode(type: number, i: number, meta: N[], from: number): N {
    const L = this.L
    return node(type, from, L.next(i), [...meta, leaf(Type.BreakMarker, L.start(i), L.next(i))])
  }

  private macroNode(i: number, m: MacroMatch, meta: N[], from: number): N {
    const L = this.L
    const s = L.start(i)
    const children: N[] = [...meta, leaf(Type.MacroName, s, s + m.name.length)]
    if (m.target.length)
      children.push(leaf(Type.MacroTarget, s + m.targetFrom, s + m.targetFrom + m.target.length))
    if (m.attrs !== null) children.push(...this.attributeItems(m.attrs, s + m.attrsFrom, false))
    const nl = this.newline(i)
    if (nl) children.push(nl)
    return node(Type.BlockMacro, from, L.next(i), clean(children))
  }

  /** A `> quote`: the lines without their markers are parsed as blocks of their own. */
  private *markdownQuote(
    cur: Cur,
    i: number,
    r: { children: N[]; next: number; to: number },
    meta: N[],
    from: number,
  ): Task<BlockResult> {
    const L = this.L
    const lns: Ln[] = []
    for (let k = i; k < r.next; k++) {
      const ln = L.ln(k)
      if (ln.text.startsWith('//') && !ln.text.startsWith('///')) continue
      if (ln.text === '>') lns.push({ ...ln, from: ln.from + 1, end: ln.from + 1, text: '' })
      else if (ln.text.startsWith('> ')) lns.push({ ...ln, from: ln.from + 2, text: ln.text.slice(2) })
      else lns.push(ln)
    }
    const comments = r.children.filter((c) => c.type === Type.LineComment)
    let attribution: N | null = null
    const trailing: N[] = []
    if (lns.length && lns[lns.length - 1]!.text.startsWith('-- ')) {
      const credit = lns.pop()!
      attribution = leaf(Type.QuoteAttribution, credit.from, credit.next)
      while (lns.length && lns[lns.length - 1]!.text === '') {
        const b = lns.pop()!
        trailing.unshift(leaf(Type.BlankLine, b.from, b.next))
      }
    }
    const kids: N[] = []
    yield this.child(new ArrayReader(lns, 0, lns.length)).parseBlocks(kids)
    // the comment lines that the paragraph skipped lie between the lines of a block of the quote
    const own = [...kids, ...trailing, ...(attribution ? [attribution] : [])].sort((a, b) => a.from - b.from)
    const all = mergeLeaves(own, comments)
    cur.i = r.next
    return { n: node(Type.BlockQuote, from, r.to, [...meta, ...all]), after: [] }
  }

  /** Parser.read_paragraph_lines: lines up to a blank line or a block start (or a list item). */
  readParagraph(
    i: number,
    skipComments: boolean,
    verbatim: boolean,
    breakAtList: boolean,
    raw = false,
    warnList = true,
  ): { children: N[]; next: number; to: number; blank: boolean } {
    const L = this.L
    return this.withoutProcessing(() => {
      const children: N[] = []
      let k = i
      let lineRead = false
      let blank = false
      while (L.has(k)) {
        const line = L.get(k)
        if (line === '') {
          blank = true
          break
        }
        if (lineRead && line === '+') break
        if (!verbatim && k > i && (startOfBlock(line) || (breakAtList && isAnyList(line)))) break
        if (skipComments && line.startsWith('//') && !line.startsWith('///')) {
          children.push(this.lineComment(k))
        } else {
          if (warnList && !verbatim && k > i && isAnyList(line))
            this.diag(
              L.start(k),
              L.contentEnd(k),
              'info',
              'list-item-as-text',
              'A line that looks like a list item is text here: a list starts after a blank line',
            )
          children.push(this.textLine(k))
          lineRead = true
        }
        k++
      }
      return { children, next: k, to: children[children.length - 1]!.to, blank }
    }, raw)
  }

  /** Parser.build_block for a block with delimiters. */
  private *delimitedAt(
    cur: Cur,
    dm: { context: string; terminator: string; tip: string },
    acc: BlockAttributes,
    meta: N[],
    from: number,
  ): Task<BlockResult> {
    const L = this.L
    const i = cur.i
    if (dm.context === 'comment') {
      const bc = this.blockComment(i)
      cur.i = bc.next
      return { n: node(Type.BlockComment, from, bc.n.to, [...meta, ...bc.n.children!]), after: [] }
    }
    let ctx = dm.context
    const masq = MASQ[dm.tip] ?? NO_MASQ
    const style = acc.style
    if (style && style !== ctx) {
      if (masq.has(style)) ctx = style
      else if (masq.has('admonition') && AdmonitionStyles.has(style)) ctx = 'admonition'
    }
    let kind: string
    let compound = false
    switch (ctx) {
      case 'listing':
      case 'source':
      case 'fenced_code':
        kind = 'listing'
        break
      case 'stem':
      case 'latexmath':
      case 'asciimath':
        kind = 'stem'
        break
      case 'open':
      case 'abstract':
      case 'partintro':
        kind = 'open'
        compound = true
        break
      case 'sidebar':
      case 'admonition':
      case 'example':
      case 'quote':
        kind = ctx
        compound = true
        break
      default:
        kind = ctx // literal, verse, pass, table, comment
    }
    const term = dm.terminator
    const j = this.withoutProcessing(() => {
      let j = i + 1
      while (L.has(j) && L.get(j) !== term) j++
      return j
    }, kind === 'comment')
    const closed = L.has(j)
    const children: (N | null)[] = [...meta]
    const opening = L.get(i)
    let lang: { from: number; to: number } | null = null
    if (dm.context === 'fenced_code' && opening.length > 3) {
      const info = opening.slice(3)
      const comma = info.indexOf(',')
      const rawLang = comma >= 0 ? info.slice(0, comma) : info
      const text = rawLang.trim()
      if (text.length) {
        const start = L.start(i) + 3 + rawLang.indexOf(text)
        lang = { from: start, to: start + text.length }
      }
    }
    if (lang) {
      children.push(
        leaf(Type.BlockDelimiter, L.start(i), L.start(i) + 3),
        leaf(Type.CodeLanguage, lang.from, lang.to),
        this.newline(i),
      )
    } else {
      children.push(leaf(Type.BlockDelimiter, L.start(i), L.next(i)))
    }
    const contentFrom = L.next(i)
    const contentTo = closed ? L.ln(j).raw : this.endOffset(j - 1, contentFrom)
    let model: TableModel | null = null
    if (compound) {
      const kids: N[] = []
      yield this.child(this.L.slice(i + 1, j)).parseBlocks(kids)
      children.push(...kids)
    } else if (kind === 'table') {
      const t = this.tableContent(i, j, dm.tip, acc, from)
      children.push(...t.nodes)
      model = t.model
    } else if (contentTo > contentFrom) {
      children.push(this.delimitedContent(i, j, contentFrom, contentTo, kind, acc))
    }
    let end: number
    if (closed) {
      children.push(leaf(Type.BlockDelimiter, L.start(j), L.next(j)))
      end = L.next(j)
    } else {
      end = contentTo
      this.unterminated(i, dm.context)
    }
    cur.i = closed ? j + 1 : j
    const block = withProp(node(Type.DelimitedBlock, from, end, clean(children)), blockKind, kind)
    if (model) {
      model.to = end - from
      withProp(block, tableModel, model)
    }
    return { n: block, after: [] }
  }

  /** The cells of a table block (the lines `i + 1` up to `j`) and the layout they make; offsets are relative to `base`. */
  private tableContent(
    i: number,
    j: number,
    tip: string,
    acc: BlockAttributes,
    base: number,
  ): { nodes: N[]; model: TableModel } {
    const L = this.L
    const lines: TableLine[] = []
    const comments: N[] = []
    for (let k = i + 1; k < j; k++) {
      const ln = L.ln(k)
      // the reader leaves out the line comments of a table
      if (ln.text.startsWith('//') && !ln.text.startsWith('///')) comments.push(this.lineComment(k))
      else lines.push({ text: ln.text, from: ln.from, nl: ln.nl, next: ln.next })
    }
    const ab = this.c.ab
    const attr = (name: string): string | null => {
      const v = acc.attributes.get(name)
      return v === undefined || v === null ? null : subAttributes(v, (n) => ab.get(n), 'skip')
    }
    const c = tip.charAt(0)
    const scan = scanTable(
      {
        lines,
        cols: attr('cols'),
        format: attr('format') ?? (c === ',' ? 'csv' : c === ':' ? 'dsv' : null),
        separator: attr('separator'),
        width: attr('width'),
        header: acc.attributes.has('header-option'),
        noheader: acc.attributes.has('noheader-option'),
        footer: acc.attributes.has('footer-option'),
        nested: (this.c.setup.depth ?? 0) > 0,
      },
      base,
    )
    for (const d of scan.diags) this.diag(d.from, d.to, 'warning', d.code, d.message)
    return {
      nodes: mergeLeaves(tableNodes(scan, lines, this.cellDocuments(scan.ascii)), comments),
      model: scan.model,
    }
  }

  /** The documents in the cells of a table that have the `a` style, as nodes over the source, by cell. */
  private cellDocuments(cells: readonly AsciiCell[]): Map<Lex, N[]> {
    const docs = new Map<Lex, N[]>()
    const setup = this.c.setup
    const readers = setup.cells
    if (!readers || cells.length === 0 || (setup.depth ?? 0) >= MAX_NESTING) return docs
    const nested = readers.setup(setup, this.c.ab.freeze(), this.c.st.doctype, this.c.st.leveloffset)
    for (const cell of cells) {
      // the cells that a repeat made hold one text
      if (docs.has(cell.lex)) continue
      const text = cell.map()
      if (text.text === '') continue
      const doc = readers.read(nested, text, cell.lex.cFrom, cell.lex.cTo)
      docs.set(cell.lex, doc.nodes)
      for (const d of doc.diagnostics) this.c.diags.push(d)
    }
    return docs
  }

  /** The content of a block without blocks in it: the text, with what the substitutions of its kind find. */
  private delimitedContent(
    i: number,
    j: number,
    from: number,
    to: number,
    kind: string,
    acc: BlockAttributes,
  ): N {
    const defaults =
      kind === 'listing' || kind === 'literal'
        ? VERBATIM_SUBS
        : kind === 'verse'
          ? NORMAL_SUBS
          : kind === 'stem'
            ? BASIC_SUBS
            : NO_SUBS
    const subs = blockSubs(defaults, acc.attributes.get('subs'))
    if (kind === 'comment' || !subs.some((s) => s !== 'specialcharacters'))
      return leaf(Type.DelimitedContent, from, to)
    const L = this.L
    const pieces: [number, number][] = []
    for (let k = i + 1; k < j; k++) pieces.push([L.start(k), L.contentEnd(k)])
    const sink = scanInline(this.c.text, pieces, subs, this.inlineEnv(acc))
    this.c.diags.push(...sink.diags)
    const roots = nestNodes(sink.nodes)
    return roots.length ? node(Type.DelimitedContent, from, to, roots) : leaf(Type.DelimitedContent, from, to)
  }

  // ---------------------------------------------------------------- titles (shared by headers, sections and discrete headings)

  anyTitleAt(i: number): { level: number; atx: boolean } | null {
    const L = this.L
    const line = L.get(i)
    const line2 = L.peek(i + 1)
    const atx = atxLevel(line)
    if (atx !== null) return { level: atx, atx: true }
    if (line2 !== '') {
      const setext = setextLevel(line, line2)
      if (setext !== null) return { level: setext, atx: false }
    }
    return null
  }

  /** A section, document or discrete title line (or two lines for setext titles). */
  titleNode(type: number, i: number, atx: boolean): { n: N; next: number } {
    const children = this.titleParts(i, atx)
    const L = this.L
    const end = atx ? L.next(i) : L.next(i + 1)
    return { n: node(type, L.start(i), end, children), next: atx ? i + 1 : i + 2 }
  }

  private titleParts(i: number, atx: boolean): N[] {
    const L = this.L
    const s = L.start(i)
    const line = L.get(i)
    if (atx) {
      const m = matchAtxSectionTitle(line)!
      const parts: (N | null)[] = [
        leaf(Type.SectionMarker, s, s + m.markerEnd),
        this.inlineText(Type.TitleText, s + m.titleFrom, s + m.titleTo, NORMAL_SUBS, null),
      ]
      if (m.titleTo < line.length)
        parts.push(leaf(Type.SectionMarker, s + line.length - m.markerEnd, s + line.length))
      parts.push(this.newline(i))
      return clean(parts)
    }
    return clean([
      this.inlineText(Type.TitleText, s, L.contentEnd(i), NORMAL_SUBS, null),
      this.newline(i),
      leaf(Type.SetextUnderline, L.start(i + 1), L.contentEnd(i + 1)),
      this.newline(i + 1),
    ])
  }
}

/** The parser of the top level: header, sections, and the blocks under them. */
export class UnitParser extends BP {
  private readonly pre: N[] = []
  private block: N | null = null
  private after: N[] = []
  private section: { level: number; close: number; parts: N[] } | null = null

  constructor(
    shared: Shared,
    private readonly from: number,
    private readonly startState: ParseState,
  ) {
    super(shared, shared.S)
  }

  parse(): Unit {
    const c = this.c
    const S = c.S
    const text = c.text
    const from = this.from
    const claimer = new Claimer(S.hidden, (k) => hiddenNode(S.hidden[k]!))
    return withClaimer(claimer, () => {
      const next = run(this.c.st.headerDone ? this.bodyUnit() : this.headerUnit())
      const to = next === null ? text.length : S.ln(next).raw
      // hidden lines nothing took in belong to the unit itself
      const rest = claimer.claim(from, to)
      const coreFrom = this.block ? this.block.from : this.section ? this.section.parts[0]!.from : Infinity
      const pre = [...this.pre]
      const post: N[] = [...this.after]
      const parts = this.section ? [...this.section.parts] : null
      for (const h of rest) {
        if (h.from < coreFrom) pre.push(h)
        else if (parts) parts.push(h)
        else post.push(h)
      }
      const byFrom = (a: N, b: N) => a.from - b.from
      pre.sort(byFrom)
      post.sort(byFrom)
      parts?.sort(byFrom)
      // whatever no node covers (white space that ends the last line of a block, an escape) is a Mark
      const core = this.block ? [this.block] : (parts ?? [])
      const seq = [
        ...pre.map((n) => ({ n, tag: 0 })),
        ...core.map((n) => ({ n, tag: 1 })),
        ...post.map((n) => ({ n, tag: 2 })),
      ]
      const lists = [pre, parts ?? post, post]
      let pos = from
      for (let k = 0; k <= seq.length; k++) {
        const next = seq[k]
        const stop = next ? next.n.from : to
        if (stop > pos) {
          const gap = leaf(Type.Mark, pos, stop)
          if (!next) post.push(gap)
          else if (next.tag === 1) (seq[k - 1]?.tag === 1 ? lists[1] : pre).push(gap)
          else lists[next.tag]!.push(gap)
        }
        if (next) pos = Math.max(pos, next.n.to)
      }
      pre.sort(byFrom)
      post.sort(byFrom)
      parts?.sort(byFrom)
      const la = S.lookAhead()
      const end: ParseState = {
        ...c.st,
        stack: [...c.st.stack],
        attrs: c.ab.freeze(),
        cond: S.condBefore(to),
      }
      const diagnostics: Diagnostic[] = [...c.diags, ...S.diagnostics.filter((d) => d.from < to)].map(
        (d) => ({
          ...d,
          from: d.from - from,
          to: d.to - from,
        }),
      )
      return {
        length: to - from,
        lookAhead: la > text.length ? Infinity : la - from,
        start: this.startState,
        end,
        pre: pre.map((n) => toPiece(n, from)),
        block: this.block ? toPiece(this.block, from) : null,
        section: this.section
          ? {
              level: this.section.level,
              close: this.section.close,
              parts: parts!.map((n) => toPiece(n, from)),
            }
          : null,
        post: post.map((n) => toPiece(n, from)),
        diagnostics,
        events: S.events
          .filter((e) => e.pos < to)
          .map((e) => ({ ...e, pos: e.pos - from, end: e.end - from })),
      }
    })
  }

  // ---------------------------------------------------------------- units

  /** Returns the index of the first line after the unit, or null at the end of the text. */
  private *headerUnit(): Task<number | null> {
    const L = this.L
    const st = this.c.st
    if (this.from === 0 && this.c.text.charCodeAt(0) === 0xfeff) this.pre.push(leaf(Type.ByteOrderMark, 0, 1))
    let i = 0
    while (L.has(i) && L.blank(i)) this.pre.push(this.blankNode(i++))
    const acc = new BlockAttributes()
    const meta = this.metadataRun(i, acc, true)
    i = meta.next
    let title: { level: number; atx: boolean } | null = null
    if (L.has(i)) {
      title = this.sectionTitleAt(i, acc.style)
      if (title && title.level + st.leveloffset !== 0) title = null
    }
    if (title && acc.title === null) {
      const children = meta.items.map((it) => it.n)
      const titleNode = this.titleNode(Type.DocumentTitle, i, title.atx)
      children.push(titleNode.n)
      this.setDoctitle(titleNode.n)
      i = titleNode.next
      i = this.headerMetadata(i, children)
      if (st.doctype === 'manpage') i = this.manpageName(i, children)
      this.pre.push(node(Type.Header, children[0]!.from, children[children.length - 1]!.to, children))
      st.hasHeader = true
      st.headerDone = true
      st.topMode = 1
      return this.lineIndexOrNull(i)
    }
    if (title) {
      st.invalidHeader = true
      this.c.ab.set('authorcount', '0')
    } else this.authorEntriesWithoutTitle()
    st.headerDone = true
    const { leading, attaching } = splitRun(meta.items)
    if (!title && st.doctype === 'manpage' && attaching.length === 0) {
      const extra: N[] = []
      const next = this.manpageName(i, extra)
      if (extra.length) {
        leading.push(...extra.map((n) => ({ n, attaching: false, entry: true, blank: false })))
        i = next
      }
    }
    const lastEntry = findLastIndex(leading, (it) => it.entry || !it.blank)
    if (leading.some((it) => it.entry)) {
      const inHeader = leading.slice(0, lastEntry + 1).map((it) => it.n)
      this.pre.push(node(Type.Header, inHeader[0]!.from, inHeader[inHeader.length - 1]!.to, inHeader))
      for (const it of leading.slice(lastEntry + 1)) this.pre.push(it.n)
    } else {
      for (const it of leading) this.pre.push(it.n)
    }
    return yield* this.main(i, acc, attaching)
  }

  private *bodyUnit(): Task<number | null> {
    const L = this.L
    let i = 0
    while (L.has(i) && L.blank(i)) this.pre.push(this.blankNode(i++))
    const acc = new BlockAttributes()
    const meta = this.metadataRun(i, acc, false)
    const { leading, attaching } = splitRun(meta.items)
    for (const it of leading) this.pre.push(it.n)
    return yield* this.main(meta.next, acc, attaching)
  }

  private *main(i: number, acc: BlockAttributes, attaching: MetaItem[]): Task<number | null> {
    const L = this.L
    const st = this.c.st
    if (!L.has(i)) {
      for (const it of attaching) this.pre.push(it.n)
      return null
    }
    const title = this.sectionTitleAt(i, acc.style)
    if (st.topMode === 0) st.topMode = st.hasHeader || st.invalidHeader || !title ? 1 : 2
    if (title) {
      const next = this.openSection(i, title, acc, attaching)
      return this.lineIndexOrNull(next)
    }
    const cur = new Cur(L, i)
    const res = yield* this.blockAt(cur, acc, attaching, TOP_OPTS)
    this.block = res.n
    this.after = res.after
    return this.lineIndexOrNull(cur.i)
  }

  private lineIndexOrNull(i: number): number | null {
    return this.L.has(i) ? i : null
  }

  // ---------------------------------------------------------------- sections

  private sectionTitleAt(i: number, style: string | null): { level: number; atx: boolean } | null {
    if (style === 'discrete' || style === 'float') return null
    // Parser.next_block peeks two lines with the preprocessor off for a comment
    const title = this.withoutProcessing(() => this.anyTitleAt(i), style === 'comment', true)
    // the underline was read raw; when the directives take it away there is no title to read
    return title && !title.atx && !this.L.has(i + 1) ? null : title
  }

  private openSection(
    i: number,
    title: { level: number; atx: boolean },
    acc: BlockAttributes,
    attaching: MetaItem[],
  ): number {
    const st = this.c.st
    const L = this.L
    const level = applyLeveloffset(title.level, st.leveloffset)
    const stack = st.stack
    let close = 0
    while (stack.length && !(level > stack[stack.length - 2]!)) {
      stack.length -= 2
      close++
    }
    const lineFrom = L.start(i)
    const lineTo = L.contentEnd(i)
    const book = st.doctype === 'book'
    if (stack.length) {
      const expected = stack[stack.length - 1]!
      if (expected >= 0 && level !== expected)
        this.diag(
          lineFrom,
          lineTo,
          'warning',
          'section-level-skipped',
          `Section title out of sequence: expected level ${expected}, got level ${level}`,
        )
    } else if (st.topMode === 1) {
      if (level > 0) {
        if (level !== 1)
          this.diag(
            lineFrom,
            lineTo,
            'warning',
            'section-level-skipped',
            `Section title out of sequence: expected level 1, got level ${level}`,
          )
      } else if (!book) {
        this.diag(
          lineFrom,
          lineTo,
          'error',
          'level-0-section-in-article',
          'Level 0 sections can only be used when doctype is book',
        )
      }
    }
    // Parser.initialize_section: the style may change the level of the new section
    const style = acc.style
    let sectLevel = level
    let special = false
    if (style) {
      if (book && style === 'abstract') sectLevel = 1
      else if (!/^sect\d$/.test(style)) {
        special = true
        if (sectLevel === 0) sectLevel = 1
      }
    }
    let expected = sectLevel + 1
    if (sectLevel === 1 && special && style !== 'appendix' && style !== 'preface' && style !== 'abstract')
      expected = -1
    stack.push(sectLevel, expected)
    const t = this.titleNode(Type.SectionTitle, i, title.atx)
    this.section = { level: sectLevel, close, parts: [...attaching.map((it) => it.n), t.n] }
    return t.next
  }

  // ---------------------------------------------------------------- header

  /** Sets the `doctitle` attribute from the document title, unless an entry set it before. */
  private setDoctitle(title: N): void {
    const { ab, text } = this.c
    if (ab.get('doctitle')) return
    const t = title.children?.find((c) => c.type === Type.TitleText)
    if (!t) return
    const raw = rstrip(text.slice(t.from, t.to))
    ab.set(
      'doctitle',
      subAttributes(subSpecialChars(raw), (n) => ab.get(n), 'skip'),
    )
  }

  private headerMetadata(i: number, children: N[]): number {
    const L = this.L
    const { ab } = this.c
    const get = (n: string) => ab.get(n)
    i = this.processEntries(i, children)
    let authorCount: number | undefined
    let implicit: Implicit | null = null
    if (L.has(i) && !L.blank(i)) {
      const authorLine = L.get(i)
      children.push(this.authorLine(i++))
      const meta = processAuthors(authorLine, false, true)
      authorCount = meta.get('authorcount') as number
      ab.set('authorcount', String(authorCount))
      if (authorCount > 0) {
        for (const [key, v] of meta) {
          if (key === 'authorcount') continue
          if (!ab.has(key)) ab.set(key, applyValueSubs(String(v), get))
        }
        implicit = {
          author: ab.get('author'),
          authorinitials: ab.get('authorinitials'),
          authors: ab.get('authors'),
          meta,
        }
      }
      i = this.processEntries(i, children)
      if (L.has(i) && !L.blank(i)) {
        const line = L.get(i)
        const m = matchRevisionInfoLine(line)
        if (m) {
          children.push(this.revisionLine(i, m))
          i++
          const rev = processRevision(line)
          if (rev) for (const [key, v] of rev) if (!ab.has(key)) ab.set(key, applyValueSubs(v, get))
        }
      }
      i = this.processEntries(i, children)
    }
    this.authorOverrides(implicit, authorCount)
    return i
  }

  /** The end of Parser.parse_header_metadata: author entries that override (or stand in for) the author line. */
  private authorOverrides(implicit: Implicit | null, authorCount: number | undefined): void {
    const { ab } = this.c
    let meta: Map<string, string | number>
    if (ab.has('author') && ab.get('author') !== implicit?.author) {
      meta = processAuthors(ab.get('author')!, true, false)
      if (ab.get('authorinitials') !== implicit?.authorinitials) meta.delete('authorinitials')
    } else if (ab.has('authors') && ab.get('authors') !== implicit?.authors) {
      meta = processAuthors(ab.get('authors')!, true, true)
    } else {
      const authors: (string | null)[] = []
      let idx = 1
      let key = 'author_1'
      let explicit = false
      let sparse = false
      while (ab.has(key)) {
        if (ab.get(key) === implicit?.meta.get(key)) {
          authors.push(null)
          sparse = true
        } else {
          authors.push(ab.get(key)!)
          explicit = true
        }
        key = `author_${++idx}`
      }
      if (explicit) {
        if (sparse) {
          authors.forEach((a, k) => {
            if (a !== null) return
            const n = k + 1
            authors[k] = [
              implicit?.meta.get(`firstname_${n}`),
              implicit?.meta.get(`middlename_${n}`),
              implicit?.meta.get(`lastname_${n}`),
            ]
              .filter((x) => x !== undefined)
              .map((x) => String(x).replace(/ /g, '_'))
              .join(' ')
          })
        }
        meta = processAuthors(authors.join('; '), true, true)
      } else meta = new Map([['authorcount', 0]])
    }
    if (meta.get('authorcount') === 0) {
      if (authorCount === undefined) ab.set('authorcount', '0')
    } else {
      for (const [k, v] of meta) ab.set(k, String(v))
      if (!ab.has('email') && ab.has('email_1')) ab.set('email', ab.get('email_1')!)
    }
  }

  /** Attributes derived from author entries in a document without a title (Parser.parse_document_header). */
  private authorEntriesWithoutTitle(): void {
    const { ab } = this.c
    const author = ab.get('author')
    if (author !== undefined) {
      const meta = processAuthors(author, true, false)
      if (ab.get('authorinitials') !== undefined) meta.delete('authorinitials')
      for (const [k, v] of meta) ab.set(k, String(v))
    } else if (ab.get('authors') !== undefined) {
      const meta = processAuthors(ab.get('authors')!, true, true)
      for (const [k, v] of meta) ab.set(k, String(v))
    } else ab.set('authorcount', '0')
  }

  /**
   * Parser.parse_manpage_header: unless manname and manpurpose are set, a level 1 section whose
   * first lines read `name - purpose` right after the header belongs to the header.
   */
  private manpageName(i: number, out: N[]): number {
    if (this.c.headerSet.has('manname') && this.c.headerSet.has('manpurpose')) return i
    const L = this.L
    const nodes: N[] = []
    let j = i
    while (L.has(j) && L.blank(j)) nodes.push(this.blankNode(j++))
    const meta = this.metadataRun(j, new BlockAttributes(), true)
    for (const it of meta.items) nodes.push(it.n)
    j = meta.next
    if (!L.has(j)) return i
    const t = this.anyTitleAt(j)
    if (!t || t.level !== 1) return i
    const title = this.titleNode(Type.SectionTitle, j, t.atx)
    nodes.push(title.n)
    j = title.next
    while (L.has(j) && L.blank(j)) nodes.push(this.blankNode(j++))
    const lines: string[] = []
    while (L.has(j) && !L.blank(j)) {
      const line = L.get(j)
      if (line.startsWith('//') && !line.startsWith('///')) nodes.push(this.lineComment(j))
      else {
        nodes.push(leaf(Type.TextLine, L.start(j), L.next(j)))
        lines.push(line.slice(lstripLength(line)))
      }
      j++
    }
    if (!isManpageNameLine(lines.join(' '))) return i
    out.push(...nodes)
    return j
  }

  /** Parser.process_attribute_entries: attribute entries and comments, no blank lines. */
  private processEntries(i: number, out: N[]): number {
    const L = this.L
    for (;;) {
      while (L.has(i) && !L.blank(i)) {
        const line = L.get(i)
        if (!line.startsWith('//')) break
        if (line.startsWith('///')) {
          if (line.length > 3 && isUniform(line, '/')) {
            const c = this.blockComment(i)
            out.push(c.n)
            i = c.next
          } else break
        } else out.push(this.lineComment(i++))
      }
      if (!L.has(i)) return i
      const m = AttributeEntryRx.exec(L.get(i))
      if (!m) return i
      const e = this.attributeEntry(i, m, true)
      out.push(e.n)
      i = e.next
    }
  }

  private authorLine(i: number): N {
    const L = this.L
    const s = L.start(i)
    const line = L.get(i)
    const entries: [number, number][] = []
    if (line.includes(';')) {
      let pos = 0
      const rx = /;(?: |$)/g
      for (let m = rx.exec(line); m; m = rx.exec(line)) {
        entries.push([pos, m.index])
        pos = m.index + m[0].length
      }
      entries.push([pos, line.length])
    } else {
      entries.push([0, line.length])
    }
    const children: N[] = []
    for (const [ef, et] of entries) {
      if (et <= ef) continue
      const entry = line.slice(ef, et)
      const m = AuthorInfoLineRx.exec(entry)
      const parts: N[] = []
      if (m) {
        const ind = m.indices!
        let nameEnd = ind[1]![1]
        if (ind[2]) nameEnd = ind[2][1]
        if (ind[3]) nameEnd = ind[3][1]
        parts.push(leaf(Type.AuthorName, s + ef + ind[1]![0], s + ef + nameEnd))
        if (ind[4]) parts.push(leaf(Type.AuthorEmail, s + ef + ind[4][0], s + ef + ind[4][1]))
      } else {
        const ls = lstripLength(entry)
        const stripped = rstrip(entry.slice(ls))
        parts.push(leaf(Type.AuthorName, s + ef + ls, s + ef + ls + stripped.length))
      }
      children.push(node(Type.Author, s + ef, s + et, clean(parts)))
    }
    children.push(this.newline(i)!)
    return node(Type.AuthorLine, s, L.next(i), clean(children))
  }

  private revisionLine(i: number, m: RevisionMatch): N {
    const L = this.L
    const s = L.start(i)
    const line = L.get(i)
    const parts: (N | null)[] = []
    if (m.number)
      parts.push(
        leaf(Type.RevisionNumber, s + m.number[0], s + m.number[0] + rstrip(line.slice(...m.number)).length),
      )
    const raw = line.slice(...m.date)
    const ls = lstripLength(raw)
    const comp = rstrip(raw.slice(ls))
    if (comp) {
      const cs = s + m.date[0] + ls
      if (!(m.number && m.number[1] > m.number[0]) && comp.startsWith('v'))
        parts.push(leaf(Type.RevisionNumber, cs + 1, cs + comp.length))
      else parts.push(leaf(Type.RevisionDate, cs, cs + comp.length))
    }
    if (m.remark)
      parts.push(
        leaf(Type.RevisionRemark, s + m.remark[0], s + m.remark[0] + rstrip(line.slice(...m.remark)).length),
      )
    parts.push(this.newline(i))
    return node(Type.RevisionLine, s, L.next(i), clean(parts))
  }
}

interface Implicit {
  author?: string
  authorinitials?: string
  authors?: string
  meta: Map<string, string | number>
}

export function splitRun(items: MetaItem[]): { leading: MetaItem[]; attaching: MetaItem[] } {
  const k = items.findIndex((it) => it.attaching)
  return k < 0 ? { leading: items, attaching: [] } : { leading: items.slice(0, k), attaching: items.slice(k) }
}

function findLastIndex<T>(a: T[], f: (x: T) => boolean): number {
  for (let i = a.length - 1; i >= 0; i--) if (f(a[i]!)) return i
  return -1
}

export function parseUnit(text: string, from: number, state: ParseState, setup: ParseSetup): Unit {
  const st = { ...state, stack: [...state.stack] } as MutableState
  const ab = new AttrsBuilder(state.attrs)
  const S = new SourceLines(text, from, state.cond, { has: (n) => ab.has(n), get: (n) => ab.get(n) })
  const tracker = new AttributeTracker(ab, setup.attrs.locked, st)
  const shared: Shared = {
    text,
    setup,
    st,
    ab,
    tracker,
    diags: [],
    S,
    headerSet: new Set(),
    rawText: new WeakMap(),
  }
  return new UnitParser(shared, from, state).parse()
}

export type { MetaItem }
