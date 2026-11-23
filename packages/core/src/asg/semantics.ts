/**
 * What a document means beyond its tree: the ids and numbers of its sections (as Asciidoctor gives them, through the
 * model of the document), the footnotes, the references and the problems of the references, ids and includes.
 */
import type { SyntaxNode } from '@lezer/common'
import type { NotaDocument } from '../document.js'
import type { Diagnostic, Unit } from '../parse/blocks.js'
import type { Piece } from '../parse/build.js'
import { unitsOf } from '../document.js'
import { NORMAL_SUBS, substitute } from '../parse/inline/index.js'
import { Blk, type Model, type Src, buildModel, generateId } from './model.js'
import { resolveInclude } from './resolver.js'

/** A section or a discrete heading of a document. */
export interface OutlineEntry {
  /** The id: the one the author gave, else the one Asciidoctor makes from the title; `null` when `sectids` is off and none is given. */
  id: string | null
  /** The level (`==` is 1). */
  level: number
  /** The title as it is written, without an anchor at its end. */
  title: string
  /** The number `sectnums` gives (`1`, `1.2`, `A`), `null` for a section that has none. */
  number: string | null
  /** The table of contents lists it: a section, not a discrete heading, whose level is at most `toclevels`. */
  inToc: boolean
  /** The source of the entry: from the first metadata line to the end of the section (to the end of the title of a heading). */
  from: number
  to: number
}

/** A footnote in the text, in the order of the text; the ones that repeat a footnote by its id have its number. */
export interface FootnoteEntry {
  /** From 1. */
  number: number
  id: string | null
  /** What the footnote says, as it is written. */
  text: string
  /** The macro in the text. */
  from: number
  to: number
}

/** A cross reference in the text (`<<…>>`, `xref:…[]`) and what is known about its target. */
export interface ReferenceEntry {
  /** The target as it is written: `id`, `file.adoc#id`. */
  target: string
  /** The target is in the document, or the resolver of the host knows it. */
  resolved: boolean
  from: number
  to: number
  /** The other document (`file.adoc`), `null` for a target in this one. */
  path: string | null
  /** The anchor in the document; `null` for a reference to a document as a whole. */
  id: string | null
  /** What the resolver gave as the title of the target. */
  title?: string
}

const models = new WeakMap<NotaDocument, Model>()

/** The model of the document, built once for a document. */
export function modelOf(doc: NotaDocument): Model {
  let m = models.get(doc)
  if (!m) models.set(doc, (m = buildModel(doc)))
  return m
}

// ---------------------------------------------------------------- outline

function srcText(src: Src | null): string {
  if (!src) return ''
  return 'lines' in src ? src.lines.join('\n') : src.str
}

function trimEnd(text: string, from: number, to: number): number {
  let e = to
  while (e > from && text.charCodeAt(e - 1) <= 32) e--
  return e
}

/** `Section#sectnum`: the numbers of the sections above, joined with dots. */
function sectionNumber(b: Blk): string | null {
  if (b.numeral === null) return null
  const up = (s: Blk): string => {
    const p = s.parent
    const own = s.numeral ?? ''
    if (s.level > 1 && p && p.ctx === 'section') return `${up(p)}.${own}`
    return own
  }
  return up(b)
}

const isHeading = (b: Blk): boolean => b.ctx === 'section' || b.ctx === 'floating_title'

export function outlineOf(doc: NotaDocument): OutlineEntry[] {
  const model = modelOf(doc)
  const toclevels = Number.parseInt(doc.attributesAfterHeader().get('toclevels') ?? '2', 10)
  const levels = Number.isNaN(toclevels) ? 2 : toclevels
  const out: OutlineEntry[] = []
  const text = doc.text
  const visit = (b: Blk): void => {
    for (const k of b.blocks) {
      if (isHeading(k)) {
        const floating = k.ctx === 'floating_title'
        const from = k.pin?.[0] ?? k.node?.from ?? k.from
        const end = k.pin?.[1] ?? (k.node ? trimEnd(text, from, k.node.to) : from)
        out.push({
          id: k.id,
          level: k.level,
          title: srcText(k.title),
          number: floating ? null : sectionNumber(k),
          inToc: !floating && k.level <= levels,
          from,
          to: end,
        })
      }
      visit(k)
    }
    for (const item of b.items) visit(item)
  }
  visit(model.root)
  return out
}

// ---------------------------------------------------------------- footnotes

function childText(doc: NotaDocument, n: SyntaxNode, name: string): string | undefined {
  const c = n.getChild(name)
  return c ? doc.text.slice(c.from, c.to) : undefined
}

export function footnotesOf(doc: NotaDocument): FootnoteEntry[] {
  const out: FootnoteEntry[] = []
  const byId = new Map<string, FootnoteEntry>()
  let count = 0
  doc.tree.iterate({
    enter(ref) {
      if (ref.name !== 'Footnote') return
      const n = ref.node
      const legacy = doc.text.startsWith('footnoteref', n.from)
      let id: string | null
      let content: string | undefined
      if (legacy) {
        const t = childText(doc, n, 'MacroText')
        if (t === undefined) return false
        const comma = t.indexOf(',')
        id = comma >= 0 ? t.slice(0, comma) : t
        content = comma >= 0 ? t.slice(comma + 1) : undefined
      } else {
        id = childText(doc, n, 'MacroTarget') ?? null
        content = childText(doc, n, 'MacroText')
      }
      const known = id !== null ? byId.get(id) : undefined
      if (known) out.push({ ...known, from: n.from, to: n.to })
      else if (content !== undefined) {
        const entry: FootnoteEntry = { number: ++count, id, text: content, from: n.from, to: n.to }
        if (id !== null) byId.set(id, entry)
        out.push(entry)
      }
      return false
    },
  })
  return out
}

// ---------------------------------------------------------------- references and diagnostics

const DOCUMENT_FILE = /\.(?:adoc|asciidoc|asc|ad|txt)$/i

interface ParsedTarget {
  path: string | null
  id: string | null
}

/** A cross reference target: `id`, `#id`, `file.adoc#id`, `file.adoc`. */
function splitTarget(target: string): ParsedTarget {
  const hash = target.indexOf('#')
  if (hash >= 0) {
    const path = target.slice(0, hash)
    const id = target.slice(hash + 1)
    return { path: path === '' ? null : path, id: id === '' ? null : id }
  }
  if (DOCUMENT_FILE.test(target)) return { path: target, id: null }
  return { path: null, id: target }
}

interface Anchor {
  id: string
  from: number
  to: number
}

interface XrefNode {
  target: string
  from: number
  to: number
}

/** What a scan of the units finds that the diagnostics, references and ids are made of; offsets are in the text. */
export interface Scan {
  anchors: Anchor[]
  xrefs: XrefNode[]
  /** A line in brackets with one plain positional attribute that has a space in it: the text of the attribute. */
  attributeLines: { from: number; to: number; raw: string }[]
  /** `:toc:` and the like below the header. */
  bodyEntries: { from: number; to: number; name: string }[]
  includes: { from: number; to: number; target: string }[]
  /** The sections and discrete headings that make an id of their own from the title, in the order of the text. */
  headings: { base: string; sep: string }[]
  /** The titles of all the sections and discrete headings as written: a natural reference `<<Some Title>>` finds its target in them. */
  titles: string[]
}

/** What one unit holds, in offsets relative to its start. A unit is parsed once and shared by the versions of a document, so this is too. */
interface UnitSem {
  anchors: Anchor[]
  xrefs: XrefNode[]
  attributeLines: Scan['attributeLines']
  bodyEntries: Scan['bodyEntries']
  includes: Scan['includes']
  headings: Scan['headings']
  titles: Scan['titles']
}

const unitCache = new WeakMap<Unit, UnitSem>()
const newSem = (): UnitSem => ({
  anchors: [],
  xrefs: [],
  attributeLines: [],
  bodyEntries: [],
  includes: [],
  headings: [],
  titles: [],
})
const EMPTY = newSem()
const scans = new WeakMap<NotaDocument, Scan>()

function scanUnit(u: Unit, text: string, base: number): UnitSem {
  const found = unitCache.get(u)
  if (found) return found
  const sem = newSem()
  // an id the author gave in the metadata lines above the title of a section (they are pieces of their own)
  let metaExplicit = false
  const pieces: Piece[] = [...u.pre]
  if (u.block) pieces.push(u.block)
  if (u.section) pieces.push(...u.section.parts)
  pieces.push(...u.post)
  const src = (from: number, to: number) => text.slice(base + from, base + to)
  for (const p of pieces) {
    const root = p.tree.type.name
    if (root === 'BlockAnchor' || root === 'BlockAttributes')
      metaExplicit ||= hasExplicitId(p.tree.topNode, (f, t) => src(p.offset + f, p.offset + t))
    // an attribute entry of its own, after the header: it is a child of the document or of a section
    if (root === 'AttributeEntry' && u.start.headerDone) {
      const name = p.tree.topNode.getChild('AttributeName')
      if (name) {
        const raw = src(p.offset + name.from, p.offset + name.to)
        if (BODY_ONLY.has(raw))
          sem.bodyEntries.push({
            from: p.offset,
            to: p.offset + trimLen(src(p.offset, p.offset + p.tree.length)),
            name: raw,
          })
      }
    }
    p.tree.iterate({
      enter(ref) {
        switch (ref.name) {
          case 'BlockAnchor':
          case 'InlineAnchor': {
            const id = ref.node.getChild('AnchorId')
            if (id)
              sem.anchors.push({
                id: src(p.offset + id.from, p.offset + id.to),
                from: p.offset + ref.from,
                to: p.offset + ref.from + trimLen(src(p.offset + ref.from, p.offset + ref.to)),
              })
            return false
          }
          case 'BlockAttributes':
            attributes(ref.node, p.offset, src, sem)
            return false
          case 'TitleText': {
            const kind = ref.node.parent?.name
            if (kind !== 'SectionTitle' && kind !== 'DiscreteHeading') return
            const explicit =
              kind === 'SectionTitle'
                ? metaExplicit
                : hasExplicitId(ref.node.parent!, (f, t) => src(p.offset + f, p.offset + t))
            if (kind === 'SectionTitle') metaExplicit = false
            const raw = src(p.offset + ref.from, p.offset + ref.to).replace(/[ \t\r\n]+$/, '')
            sem.titles.push(raw)
            const attrs = u.end.attrs
            // an anchor at the end of the title is the id of the section
            if (!explicit && !attrs.has('sectids')) return
            if (explicit || InlineSectionAnchorRx.test(raw)) return
            const converted = substitute(raw, null, NORMAL_SUBS, { get: (n) => attrs.get(n) })
            const sepRaw = attrs.get('idseparator')
            const sep = sepRaw === undefined ? '_' : sepRaw.length === 0 ? '' : [...sepRaw][0]!
            sem.headings.push({
              base: generateId(
                converted,
                (n) => attrs.get(n),
                () => false,
              ),
              sep,
            })
            return
          }
          case 'Xref': {
            const t = ref.node.getChild('MacroTarget')
            if (t)
              sem.xrefs.push({
                target: src(p.offset + t.from, p.offset + t.to),
                from: p.offset + ref.from,
                to: p.offset + ref.to,
              })
            return false
          }
          case 'IncludeDirective': {
            const t = ref.node.getChild('DirectiveTarget')
            sem.includes.push({
              from: p.offset + ref.from,
              to: p.offset + ref.from + trimLen(src(p.offset + ref.from, p.offset + ref.to)),
              target: t ? src(p.offset + t.from, p.offset + t.to) : '',
            })
            return false
          }
          default:
            return
        }
      },
    })
  }
  const empty = Object.values(sem).every((list) => list.length === 0)
  const result = empty ? EMPTY : sem
  unitCache.set(u, result)
  return result
}

/** Whether a node (a heading, or a metadata line) has an id the author gave in its metadata lines. */
function hasExplicitId(node: SyntaxNode, text: (from: number, to: number) => string): boolean {
  const check = (n: SyntaxNode): boolean => {
    if (n.name === 'BlockAnchor') return n.getChild('AnchorId') !== null
    if (n.name !== 'BlockAttributes') return false
    for (let a = n.firstChild; a; a = a.nextSibling) {
      if (a.name === 'PositionalAttribute' && a.getChild('ShorthandId')) return true
      if (a.name === 'NamedAttribute') {
        const nm = a.getChild('AttributeName')
        if (nm && a.getChild('AttributeValue') && text(nm.from, nm.to) === 'id') return true
      }
    }
    return false
  }
  if (check(node)) return true
  for (let c = node.firstChild; c; c = c.nextSibling) if (check(c)) return true
  return false
}

/** The length of a source without its white space at the end. */
const trimLen = (s: string): number => {
  let n = s.length
  while (n > 0 && s.charCodeAt(n - 1) <= 0x20) n--
  return n
}

function scan(doc: NotaDocument): Scan {
  const known = scans.get(doc)
  if (known) return known
  const { units, froms } = unitsOf(doc)
  const out: Scan = newSem()
  const shift = <T extends { from: number; to: number }>(list: T[], base: number, into: T[]) => {
    for (const x of list) into.push({ ...x, from: x.from + base, to: x.to + base })
  }
  for (let i = 0; i < units.length; i++) {
    const sem = scanUnit(units[i]!, doc.text, froms[i]!)
    if (sem === EMPTY) continue
    const base = froms[i]!
    for (const k of ['anchors', 'xrefs', 'attributeLines', 'bodyEntries', 'includes'] as const)
      shift<{ from: number; to: number }>(sem[k], base, out[k])
    out.headings.push(...sem.headings)
    out.titles.push(...sem.titles)
  }
  // a metadata line gives its anchors and its ids one after the other: the order of the text
  out.anchors.sort((x, y) => x.from - y.from)
  scans.set(doc, out)
  return out
}

/** The ids `references()` counts as targets, for the tests of the scan itself. */
export function knownIdsOf(doc: NotaDocument): ReadonlySet<string> {
  return knownIds(doc)
}

/** Puts the memory of the last targets away (or back): the tests do it for the fresh parse they compare with. */
export function swapTargetsMemory(v: typeof memory = new WeakMap()): typeof memory {
  const kept = memory
  memory = v
  return kept
}

/** The scan of a document, for the tests of the scan itself. */
export function scanOf(doc: NotaDocument): Scan {
  return scan(doc)
}

/** The ids of a metadata line (`[#id]`, `id=`) and its use as a line read as attributes. */
function attributes(
  node: SyntaxNode,
  offset: number,
  src: (from: number, to: number) => string,
  out: UnitSem,
): void {
  let positional = 0
  let named = 0
  let plain: SyntaxNode | null = null
  for (let a = node.firstChild; a; a = a.nextSibling) {
    if (a.name === 'PositionalAttribute') {
      positional++
      const sid = a.getChild('ShorthandId')
      if (sid)
        out.anchors.push({
          id: src(offset + sid.from + 1, offset + sid.to),
          from: offset + sid.from,
          to: offset + sid.to,
        })
      else if (!a.firstChild) plain = a
    } else if (a.name === 'NamedAttribute') {
      named++
      const nm = a.getChild('AttributeName')
      const v = a.getChild('AttributeValue')
      if (nm && v && src(offset + nm.from, offset + nm.to) === 'id') {
        const raw = src(offset + v.from, offset + v.to)
        const id = raw.length >= 2 && /^(["']).*\1$/s.test(raw) ? raw.slice(1, -1) : raw
        out.anchors.push({ id, from: offset + a.from, to: offset + a.to })
      }
    }
  }
  if (positional === 1 && named === 0 && plain) {
    const raw = src(offset + plain.from, offset + plain.to).trim()
    // a style is one word; words with a space are more likely a remark in brackets
    if (/\S\s+\S/.test(raw) && !/^["']/.test(raw) && !/[=]/.test(raw))
      out.attributeLines.push({
        from: offset + node.from,
        to: offset + node.from + trimLen(src(offset + node.from, offset + node.to)),
        raw,
      })
  }
}

/**
 * The ids a cross reference can point at: the ones the author gave, and the ones the titles of sections give (each
 * once, in the order of the text, as Asciidoctor numbers repeats). Made from the scan, without the model of the document.
 */
function knownIds(doc: NotaDocument): Set<string> {
  const found = scan(doc)
  const ids = new Set(found.anchors.map((a) => a.id))
  for (const h of found.headings) {
    let id = h.base
    for (let n = 2; ids.has(id); n++) id = `${h.base}${h.sep}${n}`
    ids.add(id)
  }
  return ids
}

/**
 * Everything a reference can be written as: the ids of the model (the included parts have theirs in it) and the texts
 * `resolveId` of the converter matches: reftext of a block, the title of a section or a block, the text of an anchor.
 * Made anew from the model of the document each time.
 */
export function modelTargetsOf(doc: NotaDocument, kept: boolean): Set<string> {
  const model = modelOf(doc)
  const out = new Set<string>()
  const h = model.header
  // The title of the document is a target too: `<<Title>>` resolves to the document, as in `resolveId` of the converter.
  const texts = [h?.convertedTitle, h && srcText(h.title)]
  for (const [id, { blk: b, reftext }] of model.refs) {
    if (!b) {
      texts.push(id, reftext)
      continue
    }
    // (a set that is kept holds nothing of a section of plain words, neither its title nor its generated id: its key does
    // not follow a rename, `knownIds` and the scan of the titles have them)
    const title = srcText(b.title)
    texts.push(b.attrs.get('reftext'))
    if (!(kept && isHeading(b) && PLAIN_WORDS.test(title))) texts.push(id, b.convertedTitle, title)
  }
  for (const t of texts) if (t) out.add(t)
  return out
}

/**
 * The targets of the document: those of the last version when only inert units changed (the common prefix and suffix
 * of the units, by identity), else made anew. With a resolver of includes: made anew (what an include brings is the resolver's to change).
 */
function modelTargets(doc: NotaDocument): ReadonlySet<string> {
  const keys = targetKeys(doc)
  const last = memory.get(doc.options)
  if (last?.[0] === keys) return last[1]
  const keep = !doc.options.resolver?.include
  const set = modelTargetsOf(doc, keep)
  memory.set(doc.options, [keep ? keys : '', set])
  return set
}

/**
 * What of the units the targets are made of, in the order of the text: nothing of a unit that gives no target (it has
 * no section, leaves the state of the parse as it was, has no node in TARGET_NODES in its tree, and no `[[`, `anchor:`
 * or `{c…`/`{s…` in its text: `{counter:n}` and `{set:x:v}` change the attributes the titles are made with; any other
 * `{x}` in a text that is no title, entry or cell changes no target); of the others their tree and the text of the
 * nodes in TARGET_NODES (the whole text when it may hold an anchor or a counter, or has a section). Two versions
 * with the same keys give the same targets: a word typed in a paragraph under a title is no change of them.
 */
function targetKeys(doc: NotaDocument): string {
  const { units, froms } = unitsOf(doc)
  const out: (string | string[] | false)[] = []
  for (let i = 0; i < units.length; i++) {
    const u = units[i]!
    let key = unitKeys.get(u)
    if (key === undefined) {
      const t = doc.text.slice(froms[i], froms[i]! + u.length)
      const o: string[] = []
      for (const p of u.pre.concat(u.block ?? [], u.post)) {
        o.push(p.tree.toString())
        p.tree.iterate({
          enter: (n) => {
            if (TARGET_NODES.test(n.name)) o.push(t.slice(p.offset + n.from, p.offset + n.to))
          },
        })
      }
      key = u.section
        ? PLAIN_WORDS.test(t.replace(/^\s*=+ |\s+$/g, ''))
          ? ''
          : t
        : /\[\[|anchor:|\{[cs]/.test(t)
          ? t
          : TARGET_NODES.test(o.join()) && o
      unitKeys.set(u, key)
    }
    out.push(key)
  }
  return JSON.stringify(out)
}

const PLAIN_WORDS = /^[\p{L}\p{N} ]+$/u

const unitKeys = new WeakMap<Unit, string | string[] | false>()

let memory = new WeakMap<NotaDocument['options'], [string, ReadonlySet<string>]>()

/** The nodes that give the model a target or change what it reads (the lines a condition turns off give none; a condition
 * shows as a directive in the tree, whatever the block it is in). */
const TARGET_NODES = /Title|Head|Entry|Dir|Cell|Block[AM]/

const InlineSectionAnchorRx =
  / \[\[([\p{Alphabetic}_:][\p{Alphabetic}\p{M}\p{Nd}\p{Pc}\-:.]*)(?:, *([^\n]+))?\]\]$/u

export function referencesOf(doc: NotaDocument): ReferenceEntry[] {
  const nodes = scan(doc).xrefs
  const resolver = doc.options.resolver
  let ids: Set<string> | null = null
  let slow: ReadonlySet<string> | null = null
  let titles: Set<string> | null = null
  const hasIncludes = resolver?.include && scan(doc).includes.length
  const known = (id: string): boolean => {
    if ((ids ??= knownIds(doc)).has(id)) return true
    // a natural reference (`<<Section Title>>`) and the ids of the included parts need the model of the document
    if (!hasIncludes && !id.includes(' ') && id.toLowerCase() === id) return false
    // (the title of a section as written is a target: found without the model, which is built for the rest)
    if ((titles ??= new Set(scan(doc).titles)).has(id)) return true
    return (slow ??= modelTargets(doc)).has(id)
  }
  const out: ReferenceEntry[] = []
  for (const x of nodes) {
    const { path, id } = splitTarget(x.target)
    const entry: ReferenceEntry = { target: x.target, resolved: true, from: x.from, to: x.to, path, id }
    if (path !== null) {
      // another document: only the host can tell; without a resolver nothing is claimed
      if (resolver?.xref) {
        const found = resolver.xref(path, id)
        if (found) {
          if (found.title !== undefined) entry.title = found.title
        } else entry.resolved = false
      }
    } else if (id !== null && !x.target.includes('{')) entry.resolved = known(id)
    out.push(entry)
  }
  return out
}

const BODY_ONLY = new Set(['toc', 'toc-placement', 'source-highlighter', 'doctype'])

/** The problems of the document that need more than one block to see: repeated ids, references and includes that lead nowhere, and the like. */
export function semanticDiagnostics(doc: NotaDocument): Diagnostic[] {
  const out: Diagnostic[] = []
  const add = (
    x: { from: number; to: number },
    severity: Diagnostic['severity'],
    code: string,
    message: string,
  ): void => {
    out.push({ from: x.from, to: x.to, severity, code, message })
  }
  const found = scan(doc)
  // repeated ids
  const seen = new Set<string>()
  for (const a of found.anchors) {
    if (seen.has(a.id)) add(a, 'warning', 'duplicate-id', `Id "${a.id}" is already in use: a second declaration of it`)
    else seen.add(a.id)
  }
  // a line Asciidoctor reads as attributes
  for (const n of found.attributeLines) {
    add(
      n,
      'info',
      'line-read-as-attributes',
      `Asciidoctor reads the line [${n.raw}] as block attributes (the style "${n.raw}"), not as text`,
    )
  }
  // entries of the header in the body
  for (const n of found.bodyEntries) {
    add(
      n,
      'info',
      'header-attribute-in-body',
      `The attribute :${n.name}: is read only in the header; here, below a blank line, it has no effect`,
    )
  }
  if (doc.options.resolver?.include) {
    for (const n of found.includes) {
      const path = n.target
      let node: SyntaxNode | null = doc.tree.resolveInner(n.from, 1)
      while (node && node.name !== 'IncludeDirective') node = node.parent
      if (node && !resolveInclude(doc, node, path))
        add(n, 'warning', 'unresolved-include', `The include "${path}" is not found by the resolver`)
    }
  }
  for (const r of referencesOf(doc)) {
    if (!r.resolved) {
      add(
        r,
        'warning',
        'unresolved-reference',
        r.path !== null
          ? `The reference to "${r.path}${r.id ? `#${r.id}` : ''}" is not found by the resolver`
          : `The reference to "${r.id}" has no target in the document`,
      )
    }
  }
  if (doc.options.colorRoles) {
    const seen = new Set<unknown>()
    for (const run of doc.colors())
      for (const p of run.pieces) {
        if (seen.has(p)) continue
        seen.add(p)
        for (const r of p.colors)
          if (!r.known)
            add(
              r,
              'info',
              'unknown-color-role',
              `The role "${r.name}" looks like a colour (it begins with "hl-") but the host does not know it`,
            )
      }
  }
  return out
}
