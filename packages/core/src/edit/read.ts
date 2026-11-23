/**
 * Reads the text of a paragraph or a title into cells: one per visible character, hard break or plate, each
 * with the marks over it. What the visual editor shows and what its edits are checked against.
 */
import type { SyntaxNode } from '@lezer/common'
import type { NotaDocument } from '../document.js'
import { cellTree } from './cellscan.js'
import type { BlockInfo, Cell, Flag, LinkForm, MarkType, Reading, Span } from './types.js'

const QUOTE_TYPES: Record<string, MarkType> = {
  Strong: 'strong',
  Emphasis: 'em',
  Monospace: 'code',
  Highlight: 'highlight',
}

export const STRIKE_ATTRS = '[.line-through]'

const ROLE_NAME = '[^\\s.#,{}=%"\'\\[\\]]+'
const ROLES_ATTRS = new RegExp(`^\\[(?:(?:\\.${ROLE_NAME})+|${ROLE_NAME})\\]$`)

/** The markers that roles go with: the ones that have a doubled form to fall back on (a legacy `'x'` has none). */
const ROLE_MARKER = /^(?:##?|\*\*?|__?|``?)$/

/**
 * `[…]` in front of a quote mark that holds roles and nothing else: `[.zz-a]`, `[.hl-qq.q1]`, `[zz-a]`. An id, an
 * attribute reference, a named or positional attribute makes it something else, and the construct stays a plate.
 */
export const isRolesAttrs = (attrs: string): boolean => ROLES_ATTRS.test(attrs)

/** Text of a visible index term that is shown as it is written. */
const PLAIN_TERM = /^[\p{L}\p{N}\p{M}][\p{L}\p{N}\p{M} .,;!?]*$/u

/** Text in `pass:q[…]` that is shown as it is written (no HTML, no escapes, no line breaks). */
const PLAIN_PASS = /^[^<>&\\\r\n]+$/

const IMPLIED: Record<string, 'strong' | 'em' | 'code'> = { '*': 'strong', _: 'em', '`': 'code' }

/** The mark a span of roles is besides the roles (`[.zz-a]*x*` is bold too); null for `#` and for the other spans. */
export const impliedMark = (s: Span): 'strong' | 'em' | 'code' | null =>
  s.type === 'roles' ? (IMPLIED[s.marker[0] ?? ''] ?? null) : null

/** The names of the roles in `[…]` that holds roles only (see `isRolesAttrs`), as written. */
export function roleNames(attrs: string): string[] {
  // (inside `pass:q[…]` the closing bracket of the attributes is written `\]`)
  return attrs
    .slice(1, -1)
    .replace(/\\$/, '')
    .split('.')
    .filter((n) => n !== '')
}

/**
 * The source of a plus that stands alone at the end of a line (after a blank, or on a line of its own): written as `+`
 * it would be a hard break, an underline of a title or a list continuation, so it is the built-in attribute reference
 * (which Asciidoctor shows as `+`). It is read as the character it shows.
 */
export const PLUS_ESCAPE = '{plus}'

/** The link a target stands for, as the host sees it: `<<id>>` is `#id`. */
export function xrefHref(target: string): string {
  return target.includes('#') || /\.[A-Za-z0-9]+$|\//.test(target) ? target : '#' + target
}

class Reader {
  readonly cells: Cell[] = []
  readonly spans: Span[] = []
  private stack: readonly Span[] = []
  private pending = ''
  private pendingFrom = -1
  private skipTo = -1
  private linkText = false
  private flag: Flag | null = null
  /** Depth of `pass:q[…]` and `((…))` being read. */
  private locked = 0

  constructor(
    private readonly text: string,
    private readonly from: number,
    private readonly to: number,
  ) {}

  private push(cell: Omit<Cell, 'spans' | 'flag' | 'linkEscape' | 'newline'> & Partial<Cell>): void {
    let src = cell.src
    let from = cell.from
    if (this.pending) {
      src = this.pending + src
      from = this.pendingFrom
      this.pending = ''
    }
    // (one shape for every cell: a spread of the parts is slower than the literal)
    this.cells.push({
      kind: cell.kind,
      ch: cell.ch,
      src,
      from,
      to: cell.to,
      spans: this.stack,
      flag: cell.flag === undefined ? this.flag : cell.flag,
      newline: cell.newline ?? false,
      linkEscape: cell.linkEscape ?? false,
    })
  }

  /** Plain text of the source range a–b (clipped to the block). */
  private plain(a: number, b: number): void {
    const t = this.text
    const end = Math.min(b, this.to)
    for (let i = Math.max(a, this.from, this.skipTo); i < end;) {
      const c = t[i]!
      if (c === '\n' || (c === '\r' && t[i + 1] === '\n')) {
        const len = c === '\n' ? 1 : 2
        this.push({ kind: 'char', ch: ' ', src: t.slice(i, i + len), from: i, to: i + len, newline: true })
        i += len
      } else if (this.linkText && c === '\\' && t[i + 1] === ']' && i + 1 < end) {
        this.push({ kind: 'char', ch: ']', src: ']', from: i, to: i + 2, linkEscape: true })
        i += 2
      } else {
        this.push({ kind: 'char', ch: c, src: c, from: i, to: i + 1 })
        i++
      }
    }
  }

  private src(n: SyntaxNode): string {
    return this.text.slice(n.from, n.to)
  }

  private chip(n: SyntaxNode): void {
    this.push({ kind: 'chip', ch: '', src: this.src(n), from: n.from, to: n.to })
  }

  private withSpan(span: Span, inner: () => void): void {
    this.spans.push(span)
    const saved = this.stack
    this.stack = [...saved, span]
    inner()
    this.stack = saved
  }

  /** Reads the nodes from `c` on that start before `end`, and the text between them, from `pos`. */
  private run(c: SyntaxNode | null, pos: number, end: number): void {
    for (; c && c.from < end; c = c.nextSibling) {
      if (c.from > pos) this.plain(pos, c.from)
      this.node(c)
      pos = c.to
    }
    if (pos < end) this.plain(pos, end)
  }

  /** Reads the children of `node` (or its text when it has none). */
  children(node: SyntaxNode): void {
    this.run(node.firstChild, node.from, node.to)
  }

  node(n: SyntaxNode): void {
    const name = n.name
    if (name === 'Mark' || name === 'SpecialChar') {
      this.plain(n.from, n.to)
    } else if (name === 'Replacement') {
      const saved = this.flag
      this.flag = { name: 'replacement', from: n.from, to: n.to }
      this.plain(n.from, n.to)
      this.flag = saved
    } else if (name === 'Escape') {
      if (n.from >= this.skipTo) {
        if (!this.pending) this.pendingFrom = n.from
        this.pending += this.src(n)
      }
    } else if (name === 'HardBreak') {
      const end = n.to + /^[ \t]*(\r?\n)?/.exec(this.text.slice(n.to, this.to))![0].length
      this.push({ kind: 'break', ch: '', src: this.text.slice(n.from, end), from: n.from, to: end })
      this.skipTo = end
    } else if (name === 'AttributeReference' && this.endPlus(n)) {
      this.push({ kind: 'char', ch: '+', src: PLUS_ESCAPE, from: n.from, to: n.to })
    // (an attribute reference in the text of a link is shown as written: the document may not define it)
    } else if (name === 'AttributeReference' && this.stack.some((s) => s.type === 'link')) {
      this.plain(n.from, n.to)
    } else if ((name === 'Passthrough' || name === 'IndexTerm') && this.lockable(n)) {
      this.lock(n)
    } else if (name in QUOTE_TYPES) {
      this.quote(n)
    } else if (name === 'Link' || name === 'Xref') {
      this.link(n)
    } else {
      // a footnote, an image, a passthrough …: a plate keeps the source as it is
      this.chip(n)
    }
  }

  /** `{plus}` after a blank or at the start of a line, and at the end of a line (blanks may follow): what a `+` there is written as. */
  private endPlus(n: SyntaxNode): boolean {
    const t = this.text
    return (
      this.src(n) === PLUS_ESCAPE &&
      n.from > this.from &&
      /[ \t\n]/.test(t[n.from - 1]!) &&
      /^[ \t]*(\r?\n|$)/.test(t.slice(n.to, this.to))
    )
  }

  /** The quote marks and the attributes of a quote node; null when it is not read as marks (a plate). */
  private quoteParts(
    n: SyntaxNode,
  ): { first: SyntaxNode; last: SyntaxNode; type: MarkType; attrText: string } | null {
    let attrs: SyntaxNode | undefined
    let first: SyntaxNode | undefined
    let last: SyntaxNode | undefined
    for (let c = n.firstChild; c; c = c.nextSibling) {
      if (c.name === 'QuoteMarker') last = first ? c : (first = c)
      else if (c.name === 'InlineAttributes') attrs = c
    }
    if (!first || !last || first === last) return null
    const attrText = attrs ? this.src(attrs) : ''
    // (the roles of a quote inside `pass:q[…]` close their `[…]` with `\]`: a plain `]` would end the passthrough)
    const bare = this.locked > 0 && attrText.endsWith('\\]') ? attrText.slice(0, -2) + ']' : attrText
    let type = QUOTE_TYPES[n.name]!
    if (attrText) {
      if (type === 'highlight' && bare === STRIKE_ATTRS) type = 'strike'
      else if (isRolesAttrs(bare) && ROLE_MARKER.test(this.src(first))) type = 'roles'
      else return null
    }
    return { first, last, type, attrText }
  }

  /**
   * Whether a passthrough or an index term is shown as its text: `pass:q[…]` (the substitutions are `q` and nothing
   * else) and `((…))` (a visible index term), when what is in them is plain text and marks. The rest are plates.
   */
  private lockable(n: SyntaxNode): boolean {
    if (this.pending || n.to > this.to) return false
    if (n.name === 'IndexTerm') {
      // (`((` + a text + `))`, and nothing in the text that is a construct)
      const m = n.firstChild?.nextSibling
      return (
        !!m && m.name === 'MacroText' && !m.firstChild && this.src(n) === '((' + this.src(m) + '))' && PLAIN_TERM.test(this.src(m))
      )
    }
    const markers = n.getChildren('PassMarker')
    if (!this.src(n).startsWith('pass:q[') || markers.length !== 2) return false
    const [open, close] = markers as [SyntaxNode, SyntaxNode]
    for (let c = open.nextSibling; c && c.from < close.from; c = c.nextSibling) if (!this.plainNode(c)) return false
    return true
  }

  /** A node inside `pass:q[…]` that is read as text and marks and nothing else. */
  private plainNode(c: SyntaxNode): boolean {
    if (c.name === 'Mark') return PLAIN_PASS.test(this.src(c))
    if (!(c.name in QUOTE_TYPES)) return false
    this.locked++
    const parts = this.quoteParts(c)
    this.locked--
    if (!parts) return false
    for (let k = parts.first.nextSibling; k && k.from < parts.last.from; k = k.nextSibling)
      if (k.name !== 'InlineAttributes' && !this.plainNode(k)) return false
    return true
  }

  /** `pass:q[…]` or `((…))`: the text of it with its marks, in cells that are not edited (they lie in a `lock` span). */
  private lock(n: SyntaxNode): void {
    const t = this.text
    let from: number
    let to: number
    let first: SyntaxNode | null = null
    if (n.name === 'IndexTerm') {
      from = n.firstChild!.to
      to = n.lastChild!.from
    } else {
      const markers = n.getChildren('PassMarker')
      from = markers[0]!.to
      to = markers[1]!.from
      first = markers[0]!.nextSibling
    }
    const span: Span = {
      type: 'lock',
      href: null,
      form: null,
      attrs: '',
      marker: '',
      open: t.slice(n.from, from),
      close: t.slice(to, n.to),
      from: n.from,
      to: n.to,
      innerFrom: from,
      innerTo: to,
      double: false,
    }
    const cells0 = this.cells.length
    const spans0 = this.spans.length
    this.locked++
    this.withSpan(span, () => this.run(first, from, to))
    this.locked--
    // nothing to show in it (`pass:q[]`): a plate keeps it
    if (this.cells.length === cells0) {
      this.spans.length = spans0
      this.chip(n)
    }
  }

  private quote(n: SyntaxNode): void {
    const parts = this.quoteParts(n)
    if (!parts) return this.chip(n)
    const { first, last, type, attrText } = parts
    const span: Span = {
      type,
      href: null,
      form: null,
      attrs: attrText,
      marker: this.src(first),
      open: '',
      close: '',
      from: n.from,
      to: n.to,
      innerFrom: first.to,
      innerTo: last.from,
      double: false,
    }
    this.withSpan(span, () => this.run(first.nextSibling, first.to, last.from))
  }

  private link(n: SyntaxNode): void {
    // (one pass over the children: this is the hot path of every link)
    const by: Record<string, SyntaxNode | undefined> = {}
    for (let c = n.firstChild; c; c = c.nextSibling) by[c.name] ??= c
    const { MacroName: name, MacroTarget: target, MacroText: macroText, Mark: firstMark } = by
    // what Asciidoctor substitutes in an address (`&`, `--`, `{id}`, `+…+`, a pair of `_`) leaves it as written: a link
    // (the nodes that may stand in an address are a list: anything else, and anything beyond `&` with no text, is a plate)
    if (!target || !plainTarget(target, !macroText || macroText.to <= macroText.from)) return this.chip(n)
    const t = this.text
    const targetText = this.src(target)
    const nameText = name ? this.src(name) : ''
    let form: LinkForm
    let href: string
    if (n.name === 'Xref') {
      form = nameText.startsWith('xref') ? 'xref' : 'anchor'
      href = xrefHref(targetText)
    } else if (nameText === 'mailto') {
      form = 'mailto'
      href = 'mailto:' + targetText
    } else if (nameText === 'link') {
      form = 'link'
      href = targetText
    } else if (firstMark && t[firstMark.from] === '<' && firstMark.from === n.from) {
      form = 'angle'
      href = targetText
    } else if (macroText || t.slice(target.to, n.to).startsWith('[')) {
      form = 'url'
      href = targetText
    } else {
      form = 'bare'
      href =
        !/^[a-z][a-z0-9+.-]*:/i.test(targetText) && targetText.includes('@')
          ? 'mailto:' + targetText
          : targetText
    }
    const inner = macroText && macroText.to > macroText.from ? macroText : target
    const span: Span = {
      type: 'link',
      href,
      form,
      attrs: '',
      marker: '',
      open: t.slice(n.from, inner.from),
      close: t.slice(inner.to, n.to),
      from: n.from,
      to: n.to,
      innerFrom: inner.from,
      innerTo: inner.to,
      double: false,
    }
    this.withSpan(span, () => {
      const saved = this.linkText
      this.linkText = inner === macroText && span.close === ']'
      if (inner === macroText) this.children(macroText)
      else this.plain(target.from, target.to)
      this.linkText = saved
    })
  }

  blanks(a: number, b: number): void {
    this.plain(a, b)
  }

  finish(): Reading {
    // an escape with nothing after it stays with the last cell
    if (this.pending && this.cells.length) {
      const last = this.cells[this.cells.length - 1]!
      this.cells[this.cells.length - 1] = { ...last, src: last.src + this.pending, to: this.to }
    }
    return { cells: this.cells, from: this.from, to: this.to, spans: this.spans }
  }
}

const BARE = /^(Mark|SpecialChar)$/
const PARTS = /^(Mark|SpecialChar|Replacement|AttributeReference|Passthrough|QuoteMarker)$/
const QUOTES = /^(Strong|Emphasis|Monospace|Highlight|Superscript|Subscript)$/

/**
 * Whether an address holds only what is read as written: text, `&`, `--`, `{name}`, `+…+` and closed pairs of quote
 * marks (a link with text of its own); with no text of its own (`bare`), text and `&` only. Anything else (a link, an
 * image, a lone marker, an escape, an index term, a footnote…) keeps the whole link a plate.
 */
function plainTarget(n: SyntaxNode, bare: boolean): boolean {
  for (let c = n.firstChild; c; c = c.nextSibling) {
    const k = c.name
    if (bare ? !BARE.test(k) : !(PARTS.test(k) ? n.name !== 'MacroTarget' || k !== 'QuoteMarker' : QUOTES.test(k) && plainTarget(c, false))) return false
  }
  return true
}

const cache = new WeakMap<NotaDocument, Map<number, Reading>>()

/**
 * The cells of the text that starts at `from` and ends at `to` (the content range of a paragraph or a title).
 * Readings are kept per document, so a keystroke that reads what the last check read does not read it again.
 */
export function readInline(doc: NotaDocument, from: number, to: number): Reading {
  const hit = cache.get(doc)?.get(from)
  if (hit && hit.to === to) return hit
  // (a point reads nothing: the tree at the end of one block is the start of the next, whose text is not in a range with no width)
  let node: SyntaxNode | null = from < to ? doc.tree.resolveInner(from, 1) : null
  while (node && node.name !== 'Paragraph' && node.name !== 'TitleText' && node.name !== 'ItemText') node = node.parent
  const reader = new Reader(doc.text, from, to)
  if (node?.name === 'TitleText') {
    reader.children(node)
    // blanks after the title text, before the line break, are text too
    if (to > node.to) reader.blanks(node.to, to)
  } else if (node) {
    for (let c = node.firstChild; c; c = c.nextSibling) if (c.name === 'TextLine') reader.children(c)
  } else if (from < to) reader.children({ firstChild: null, from, to } as unknown as SyntaxNode)
  const reading = reader.finish()
  rememberReading(doc, reading)
  return reading
}

/** Remembers a reading of a document (what an edit has just checked), for the next read of the same text. */
export function rememberReading(doc: NotaDocument, reading: Reading): void {
  let byFrom = cache.get(doc)
  if (!byFrom) cache.set(doc, (byFrom = new Map()))
  byFrom.set(reading.from, reading)
}

/**
 * The cells of the text of a cell of a table that has no `a` style (`from`–`to`: see `cellTextRange`): the constructs are found
 * in its source on request, as in a paragraph. Kept per document, as the readings of paragraphs.
 */
export function readCell(doc: NotaDocument, from: number, to: number): Reading {
  const hit = cache.get(doc)?.get(from)
  if (hit && hit.to === to) return hit
  const reader = new Reader(doc.text, from, to)
  if (from < to) {
    for (let c = cellTree(doc, from, to).firstChild; c; c = c.nextSibling) if (c.name === 'TextLine') reader.children(c)
  }
  const reading = reader.finish()
  rememberReading(doc, reading)
  return reading
}

/** The cells of the text of a block: a paragraph, a heading, an item, or the text of a cell of a table. */
export const readBlock = (doc: NotaDocument, block: BlockInfo): Reading =>
  block.inCell ? readCell(doc, block.content!.from, block.content!.to) : readInline(doc, block.content!.from, block.content!.to)
