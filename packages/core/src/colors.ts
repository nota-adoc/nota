/**
 * Colour as a property of text: the roles (`hl-*`, and the ones the host names) on marked-up text such as
 * `[.hl-mint]#text#`, found in every place where Asciidoctor shows them, with the exact ranges of the source.
 * The names of the roles are not in the engine: the prefix `hl-` and the registry of the host tell a colour.
 */
import type { SyntaxNode } from '@lezer/common'
import type { NotaDocument } from './document.js'
import { NodeNames, type TableCellModel, tableModel } from './nodes.js'
import type { N } from './parse/build.js'
import { NORMAL_SUBS, nestNodes, scanInline } from './parse/inline/index.js'

/** A range of the source. */
export interface ColorRange {
  from: number
  to: number
}

/** A role written in the attributes of marked-up text. */
export interface ColorRole extends ColorRange {
  name: string
  /** The role is a colour: it begins with `hl-` (and goes on), or the host named it. */
  color: boolean
  /** The role is in the registry of the host (`ParseOptions.colorRoles`); without a registry it is `false`. */
  known: boolean
}

/** Where the text lies: the place that one run of colour cannot leave. */
export interface ColorContainer extends ColorRange {
  kind:
    | 'paragraph'
    | 'heading'
    | 'block-title'
    | 'list-item'
    | 'term'
    | 'admonition'
    | 'cell'
    | 'block'
  /** The number of tables around: 0 outside of tables. */
  depth: number
}

/** One construct of the source that carries roles: `[.hl-mint]#text#`. */
export interface ColorPiece extends ColorRange {
  kind: 'mark' | 'strong' | 'emphasis' | 'code' | 'superscript' | 'subscript' | 'double-quoted' | 'single-quoted'
  form: 'constrained' | 'unconstrained'
  /** The attributes `[…]`, the opening mark, the text, the closing mark: they lie end to end from `from` to `to`. */
  attrs: ColorRange
  open: ColorRange
  inner: ColorRange
  close: ColorRange
  /** All the roles, in the order they are written. */
  roles: readonly ColorRole[]
  /** The ones of them that are colours. */
  colors: readonly ColorRole[]
  /** The constructs around it, outside in: `strong`, `emphasis`, `link`, `xref`, …. */
  within: readonly string[]
  container: ColorContainer
}

/** One role on one continuous piece of text. */
export interface ColorRun {
  role: string
  known: boolean
  /** The text it colours: from the start of the text of its first piece to the end of the text of its last one. */
  from: number
  to: number
  pieces: readonly ColorPiece[]
  container: ColorContainer
}

export interface ColorModel {
  runs: readonly ColorRun[]
  pieces: readonly ColorPiece[]
}

/** One visible character of the text, as the range of the source that stands for it (`\|`, `{attr}` and `(C)` are one). */
export type TextEl = ColorRange

/** A construct of the text that holds characters: marked-up text (`*b*`, `[.hl-mint]#x#`), a link, or a place as a whole. */
export interface InlineNode {
  readonly kind: 'root' | 'link' | ColorPiece['kind']
  readonly from: number
  readonly to: number
  readonly attrs: ColorRange | null
  readonly open: ColorRange | null
  readonly close: ColorRange | null
  readonly roles: readonly ColorRole[]
  readonly colors: readonly ColorRole[]
  readonly form: 'constrained' | 'unconstrained'
  /** The characters and the constructs in them, in the order of the source. */
  readonly items: (TextEl | InlineNode)[]
  readonly parent: InlineNode | null
  readonly container: ColorContainer
}

/** The text of one container, as a tree of characters. */
export interface Place {
  readonly container: ColorContainer
  readonly root: InlineNode
}

/** A construct that is not text and is not cut: a passthrough, an image, the target of a link. */
export interface Plate extends ColorRange {
  /** A part of it that is text (the text of a link). */
  hole?: ColorRange
}

export interface ColorLayout {
  readonly places: readonly Place[]
  readonly plates: readonly Plate[]
}

export const isNode = (x: TextEl | InlineNode): x is InlineNode => 'items' in x

const PIECE_KINDS: Readonly<Record<string, ColorPiece['kind']>> = {
  Highlight: 'mark',
  Strong: 'strong',
  Emphasis: 'emphasis',
  Monospace: 'code',
  Superscript: 'superscript',
  Subscript: 'subscript',
  DoubleQuoted: 'double-quoted',
  SingleQuoted: 'single-quoted',
}

/** Nodes with no marked-up text in them that colour shows on. */
const SKIP = new Set([
  'BlockAttributes',
  'BlockAnchor',
  'AttributeEntry',
  'LineComment',
  'BlockComment',
  'DisabledLines',
  'Directive',
  'IncludeDirective',
  'Passthrough',
  'Stem',
  'InlineAnchor',
  'InlineImage',
  'Kbd',
  'Button',
  'Menu',
  'IndexTerm',
])

const CONTAINERS: Readonly<Record<string, ColorContainer['kind']>> = {
  Paragraph: 'paragraph',
  StyledParagraph: 'paragraph',
  AdmonitionParagraph: 'admonition',
  BlockTitle: 'block-title',
  ItemText: 'list-item',
  DescriptionTerm: 'term',
  DelimitedContent: 'block',
}

/** The nodes whose own text is the text of a place. */
const TEXT_BEARING = new Set(['TextLine', 'TitleText', 'DescriptionTerm'])

type Nd = SyntaxNode | N

const isN = (n: Nd): n is N => typeof (n as N).type === 'number'
const nameOf = (n: Nd): string => (isN(n) ? NodeNames[n.type]! : n.name)

function kidsOf(n: Nd): Nd[] {
  if (isN(n)) return n.children ?? []
  const out: Nd[] = []
  for (let c = n.firstChild; c; c = c.nextSibling) out.push(c)
  return out
}

/** Whether a name is a colour by the engine's own rule (`hl-` and something more); the registry of the host adds more. */
export const isColorName = (name: string): boolean => name.length > 3 && name.startsWith('hl-')

/** The roles in the text of `[…]`; positional attributes after a comma are not roles. */
export function rolesOf(text: string, from: number, to: number, registry: ReadonlySet<string> | null): ColorRole[] {
  // (inside `pass:q[…]` the bracket that closes the attributes is written `\]`)
  const body = text.slice(from + 1, to - 1).replace(/\\$/, '')
  const comma = body.indexOf(',')
  const seg = comma < 0 ? body : body.slice(0, comma)
  const base = from + 1
  const out: ColorRole[] = []
  const add = (start: number, raw: string): void => {
    const lead = raw.length - raw.trimStart().length
    const name = raw.trim()
    if (!name || name.includes('{')) return
    const known = registry?.has(name) ?? false
    out.push({
      name,
      from: base + start + lead,
      to: base + start + lead + name.length,
      color: known || isColorName(name),
      known,
    })
  }
  const dotted = (start: number, part: string): void => {
    let at = 0
    for (const piece of part.split('.')) {
      add(start + at, piece)
      at += piece.length + 1
    }
  }
  const trimmed = seg.trimStart()
  if (trimmed.startsWith('.') || trimmed.startsWith('#')) {
    const hash = seg.indexOf('#')
    if (hash < 0) dotted(0, seg)
    else {
      dotted(0, seg.slice(0, hash))
      const after = seg.slice(hash + 1)
      const dot = after.indexOf('.')
      if (dot >= 0) dotted(hash + 1 + dot, after.slice(dot))
    }
  } else {
    let at = 0
    for (const word of seg.split(/(\s+)/)) {
      if (word.trim()) add(at, word)
      at += word.length
    }
  }
  return out
}

class Collector {
  readonly pieces: ColorPiece[] = []
  /** The attributes and marks of all the marked-up text, in the order of the source. */
  readonly markup: [number, number][] = []
  private readonly root: ColorContainer
  /** The places and plates, when the text is wanted (`detail`), not only the roles. */
  readonly places: Place[] = []
  readonly plates: Plate[] = []
  private readonly roots = new Map<ColorContainer, InlineNode>()
  private cur: InlineNode | null = null
  /** The escapes before a character: where the character ends → where the escape starts. */
  private readonly escapes = new Map<number, number>()
  private cellCsv = false
  private cellSep = ''

  constructor(
    private readonly doc: NotaDocument,
    private readonly registry: ReadonlySet<string> | null,
    private readonly detail = false,
  ) {
    this.root = { kind: 'block', from: 0, to: doc.text.length, depth: 0 }
  }

  run(): void {
    this.walk(this.doc.tree.topNode, this.root, [], 0)
  }

  private rootFor(container: ColorContainer): InlineNode {
    let r = this.roots.get(container)
    if (!r) {
      r = {
        kind: 'root',
        from: container.from,
        to: container.to,
        attrs: null,
        open: null,
        close: null,
        roles: [],
        colors: [],
        form: 'constrained',
        items: [],
        parent: null,
        container,
      }
      this.roots.set(container, r)
      this.places.push({ container, root: r })
    }
    return r
  }

  private plate(n: Nd | ColorRange, hole?: ColorRange): void {
    this.plates.push(hole ? { from: n.from, to: n.to, hole } : { from: n.from, to: n.to })
  }

  /** The visible characters of the source range `from`–`to` of the current construct. */
  private text(from: number, to: number, container: ColorContainer): void {
    const t = this.doc.text
    const items = this.cur!.items
    for (let i = from; i < to; ) {
      const c = t[i]!
      if (c === '\n' || c === '\r') {
        i++
        continue
      }
      if (c === ' ' || c === '\t') {
        let a = i
        while (a > container.from && (t[a - 1] === ' ' || t[a - 1] === '\t')) a--
        let b = i
        while (b < container.to && (t[b] === ' ' || t[b] === '\t')) b++
        const edge = a <= container.from || b >= container.to || t[a - 1] === '\n' || t[b] === '\n' || t[b] === '\r'
        if (edge) {
          i = b
          continue
        }
      }
      let len = c >= '\ud800' && c <= '\udbff' && i + 1 < to ? 2 : 1
      if (this.cellCsv && c === '"' && t[i + 1] === '"' && i + 1 < to) len = 2
      else if (this.cellSep && c === '\\' && t[i + 1] === this.cellSep && i + 1 < to) len = 2
      const start = this.escapes.get(i) ?? i
      items.push({ from: start, to: i + len })
      i += len
    }
  }

  /** Whether a passthrough has the substitutions `q` and nothing else. */
  private quotesOnly(n: Nd): boolean {
    const subs = kidsOf(n).find((k) => nameOf(k) === 'PassSubs')
    return !!subs && this.doc.text.slice(subs.from, subs.to) === 'q'
  }

  private walk(n: Nd, container: ColorContainer, within: readonly string[], depth: number): void {
    const name = nameOf(n)
    // `pass:q[…]` runs the quotes over its text: colour in it is colour (the operations keep it a plate)
    if (name === 'Passthrough' && !this.detail && this.quotesOnly(n)) {
      const w = [...within, 'passthrough']
      for (const k of kidsOf(n)) this.walk(k, container, w, depth)
      return
    }
    if (SKIP.has(name)) return
    const piece = PIECE_KINDS[name]
    if (piece) return this.quote(n, piece, container, within, depth)
    if (name === 'DelimitedBlock' && !isN(n)) {
      const model = n.tree?.prop(tableModel)
      if (model) return this.table(n, container, depth)
    }
    let inner = container
    let w = within
    const kind = CONTAINERS[name]
    if (kind) inner = { kind, from: n.from, to: n.to, depth }
    else if (name === 'TitleText' && container.kind !== 'block-title')
      inner = { kind: 'heading', from: n.from, to: n.to, depth }
    else if (name === 'Link') w = [...within, 'link']
    else if (name === 'Xref') w = [...within, 'xref']
    if (this.detail && TEXT_BEARING.has(name) && inner !== this.root) {
      const saved = this.cur
      this.cur = this.rootFor(inner)
      this.inline(n, n.from, n.to, inner, w, depth)
      this.cur = saved
      return
    }
    for (const k of kidsOf(n)) this.walk(k, inner, w, depth)
  }

  /** The text and the constructs of a node between `start` and `end`, put in the current construct. */
  private inline(n: Nd, start: number, end: number, container: ColorContainer, within: readonly string[], depth: number): void {
    let pos = start
    for (const k of kidsOf(n)) {
      if (k.to <= start || k.from >= end) continue
      const kn = nameOf(k)
      if (kn === 'QuoteMarker' || kn === 'InlineAttributes') continue
      if (k.from > pos) this.text(pos, k.from, container)
      this.item(k, kn, container, within, depth)
      pos = Math.max(pos, k.to)
    }
    if (pos < end) this.text(pos, end, container)
  }

  private item(k: Nd, kn: string, container: ColorContainer, within: readonly string[], depth: number): void {
    const piece = PIECE_KINDS[kn]
    if (piece) this.quote(k, piece, container, within, depth)
    else if (kn === 'Mark' || kn === 'SpecialChar') this.text(k.from, k.to, container)
    else if (kn === 'Replacement' || kn === 'AttributeReference') this.cur!.items.push({ from: k.from, to: k.to })
    else if (kn === 'Escape') this.escapes.set(k.to, k.from)
    else if (kn === 'Link' || kn === 'Xref') this.link(k, kn, container, within, depth)
    else this.plate(k)
  }

  private link(n: Nd, kn: string, container: ColorContainer, within: readonly string[], depth: number): void {
    const kids = kidsOf(n)
    const text = kids.find((k) => nameOf(k) === 'MacroText')
    if (!text || text.to <= text.from) return this.plate(n)
    this.plate(n, { from: text.from, to: text.to })
    const node: InlineNode = {
      kind: 'link',
      from: n.from,
      to: n.to,
      attrs: null,
      open: null,
      close: null,
      roles: [],
      colors: [],
      form: 'constrained',
      items: [],
      parent: this.cur,
      container,
    }
    this.cur!.items.push(node)
    const saved = this.cur
    this.cur = node
    this.inline(text, text.from, text.to, container, [...within, kn === 'Link' ? 'link' : 'xref'], depth)
    this.cur = saved
  }

  private quote(n: Nd, kind: ColorPiece['kind'], container: ColorContainer, within: readonly string[], depth: number): void {
    const kids = kidsOf(n)
    const attrs = kids.find((k) => nameOf(k) === 'InlineAttributes')
    const marks = kids.filter((k) => nameOf(k) === 'QuoteMarker')
    const open = marks[0]
    const close = marks.length > 1 ? marks[marks.length - 1] : undefined
    if (this.detail) {
      if (!open || !close) return this.plate(n)
      const roles = attrs ? rolesOf(this.doc.text, attrs.from, attrs.to, this.registry) : []
      const node: InlineNode = {
        kind,
        from: n.from,
        to: n.to,
        attrs: attrs ? { from: attrs.from, to: attrs.to } : null,
        open: { from: open.from, to: open.to },
        close: { from: close.from, to: close.to },
        roles,
        colors: roles.filter((r) => r.color),
        form:
          kind === 'superscript' || kind === 'subscript'
            ? 'unconstrained'
            : kind === 'double-quoted' || kind === 'single-quoted' || open.to - open.from === 1
              ? 'constrained'
              : 'unconstrained',
        items: [],
        parent: this.cur,
        container,
      }
      this.cur!.items.push(node)
      const saved = this.cur
      this.cur = node
      this.inline(n, open.to, close.from, container, [...within, kind], depth)
      this.cur = saved
      return
    }
    if (attrs) this.markup.push([attrs.from, attrs.to])
    if (open) this.markup.push([open.from, open.to])
    if (attrs && open && close) {
      const roles = rolesOf(this.doc.text, attrs.from, attrs.to, this.registry)
      const colors = roles.filter((r) => r.color)
      if (colors.length > 0)
        this.pieces.push({
          kind,
          form:
            kind === 'superscript' || kind === 'subscript'
              ? 'unconstrained'
              : kind === 'double-quoted' || kind === 'single-quoted' || open.to - open.from === 1
                ? 'constrained'
                : 'unconstrained',
          from: n.from,
          to: n.to,
          attrs: { from: attrs.from, to: attrs.to },
          open: { from: open.from, to: open.to },
          inner: { from: open.to, to: close.from },
          close: { from: close.from, to: close.to },
          roles,
          colors,
          within,
          container,
        })
    }
    const w = [...within, kind]
    for (const k of kids) {
      const kn = nameOf(k)
      if (k === attrs || k === open || k === close || kn === 'QuoteMarker') continue
      this.walk(k, container, w, depth)
    }
    if (close) this.markup.push([close.from, close.to])
  }

  private table(n: SyntaxNode, container: ColorContainer, depth: number): void {
    const model = n.tree!.prop(tableModel)!
    const cells = new Map<number, TableCellModel>()
    for (const part of [model.rows.head, model.rows.body, model.rows.foot])
      for (const row of part) for (const c of row.cells) cells.set(c.contentFrom + n.from, c)
    for (let c = n.firstChild; c; c = c.nextSibling) {
      if (c.name !== 'TableCell') continue
      const content = c.getChild('CellContent')
      if (!content) continue
      if (content.firstChild) {
        for (const k of kidsOf(content)) this.walk(k, container, [], depth + 1)
        continue
      }
      const cell = cells.get(content.from)
      if (cell && (cell.style === 'literal' || cell.style === 'asciidoc')) continue
      this.cellCsv = model.format === 'csv'
      this.cellSep = this.cellCsv ? '' : model.separator.slice(0, 1)
      this.cell(content.from, content.to, model.format === 'csv', depth + 1)
      this.cellCsv = false
      this.cellSep = ''
    }
  }

  /** The text of a plain cell is not in the tree: the substitutions are run over its source, paragraph by paragraph. */
  private cell(from: number, to: number, csv: boolean, depth: number): void {
    const text = this.doc.text
    let start = from
    let end = to
    if (csv && end - start >= 2 && text[start] === '"' && text[end - 1] === '"') {
      start++
      end--
    }
    const container: ColorContainer = { kind: 'cell', from, to, depth }
    const attrs = this.doc.attributesAt(from)
    const env = { get: (name: string) => attrs.get(name) }
    let group: [number, number][] = []
    const flush = (): void => {
      if (group.length === 0) return
      const sink = scanInline(text, group, NORMAL_SUBS, env)
      const ranges = group
      group = []
      const roots = nestNodes(sink.nodes)
      if (!this.detail) {
        for (const root of roots) this.walk(root, container, [], depth)
        return
      }
      const saved = this.cur
      this.cur = this.rootFor(container)
      const clip = (a: number, b: number): void => {
        for (const [s, e] of ranges) {
          const x = Math.max(a, s)
          const y = Math.min(b, e)
          if (x < y) this.text(x, y, container)
        }
      }
      let pos = ranges[0]![0]
      for (const root of roots) {
        clip(pos, root.from)
        this.item(root, nameOf(root), container, [], depth)
        pos = Math.max(pos, root.to)
      }
      clip(pos, ranges[ranges.length - 1]![1])
      this.cur = saved
    }
    let at = start
    while (at <= end) {
      let nl = text.indexOf('\n', at)
      if (nl < 0 || nl > end) nl = end
      let lineEnd = nl
      while (lineEnd > at && text.charCodeAt(lineEnd - 1) <= 32) lineEnd--
      let lineStart = at
      if (group.length === 0) while (lineStart < lineEnd && text.charCodeAt(lineStart) <= 32) lineStart++
      if (lineEnd > lineStart) group.push([lineStart, lineEnd])
      else flush()
      if (nl >= end) break
      at = nl + 1
    }
    flush()
  }

  /** Whether only attributes and marks of marked-up text lie between two places. */
  onlyMarkup(a: number, b: number): boolean {
    const m = this.markup
    let lo = 0
    let hi = m.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (m[mid]![1] <= a) lo = mid + 1
      else hi = mid
    }
    let pos = a
    while (pos < b) {
      const r = m[lo++]
      if (!r || r[0] > pos) return false
      pos = r[1]
    }
    return true
  }
}

export function colorModelOf(doc: NotaDocument): ColorModel {
  const registry = doc.options.colorRoles ? new Set(doc.options.colorRoles) : null
  const col = new Collector(doc, registry)
  col.run()
  const pieces = col.pieces
  // the pieces of each role, in the order of the source
  const byRole = new Map<string, { known: boolean; pieces: ColorPiece[] }>()
  for (const p of pieces) {
    for (const r of p.colors) {
      let e = byRole.get(r.name)
      if (!e) byRole.set(r.name, (e = { known: r.known, pieces: [] }))
      if (e.pieces[e.pieces.length - 1] !== p) e.pieces.push(p)
    }
  }
  const runs: ColorRun[] = []
  for (const [role, e] of byRole) {
    let cur: { -readonly [K in keyof ColorRun]: ColorRun[K] } & { pieces: ColorPiece[] } | undefined
    for (const p of e.pieces) {
      if (cur && (p.inner.from < cur.to || col.onlyMarkup(cur.to, p.inner.from))) {
        cur.pieces.push(p)
        cur.to = Math.max(cur.to, p.inner.to)
      } else {
        cur = { role, known: e.known, from: p.inner.from, to: p.inner.to, pieces: [p], container: p.container }
        runs.push(cur)
      }
    }
  }
  runs.sort((a, b) => a.from - b.from)
  return { runs, pieces }
}

const layouts = new WeakMap<NotaDocument, ColorLayout>()

/** The text of every place where colour shows, character by character, with the constructs around the characters. */
export function colorLayoutOf(doc: NotaDocument): ColorLayout {
  let hit = layouts.get(doc)
  if (!hit) {
    const registry = doc.options.colorRoles ? new Set(doc.options.colorRoles) : null
    const col = new Collector(doc, registry, true)
    col.run()
    const places = [...col.places].sort((a, b) => a.container.from - b.container.from || a.container.depth - b.container.depth)
    layouts.set(doc, (hit = { places, plates: col.plates }))
  }
  return hit
}

/** The rule "a role is a colour": the engine's prefix, or the registry of the host. */
export function isColorRole(name: string, registry: readonly string[] | undefined): boolean {
  return isColorName(name) || (registry?.includes(name) ?? false)
}

/** The colour roles in force at a position, from the outside in. */
export function colorAtOf(model: ColorModel, pos: number): string[] {
  const out: string[] = []
  for (const p of model.pieces) {
    if (p.from > pos) break
    if (pos < p.inner.from || pos >= p.inner.to) continue
    for (const r of p.colors) if (!out.includes(r.name)) out.push(r.name)
  }
  return out
}
