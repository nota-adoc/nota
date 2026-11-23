/**
 * The targets a cross reference can point at: anchors (`[[id]]`, `[#id]`, `[id=x]`) and sections. The ids of
 * sections are the ones `doc.outline()` of `@nota-adoc/core` gives (`Section.generate_id` of Asciidoctor, titles with
 * markup included).
 */
import type { SyntaxNode } from '@lezer/common'
import type { ParseOptions, NotaDocument } from '@nota-adoc/core'
import { AttributeState, applyEntry, initialAttributes } from './attributes.js'

export interface SectionId {
  /** The section (or discrete heading) title, as written. */
  readonly title: string
  /** Where the title text is. */
  readonly from: number
  readonly to: number
  /** The id: explicit, or generated; null when `sectids` is off and none is given. */
  readonly id: string | null
  /** The id comes from an anchor or an attribute of the section. */
  readonly explicit: boolean
  /** The title has inline markup or a reference (its id is generated from the converted title all the same). */
  readonly markup: boolean
  /** The text of the cross reference for the section: the reftext of an anchor `[[id,reftext]]`, else the title. */
  readonly label: string
}

/** A target of a cross reference in the document. */
export interface DocTarget {
  readonly id: string
  readonly label: string
  readonly kind: 'section' | 'anchor'
  readonly from: number
}

export interface DocTargets {
  /** In document order, each id once (the first). */
  readonly targets: readonly DocTarget[]
  /** Sections and discrete headings in document order. */
  readonly sections: readonly SectionId[]
  /** How many sections have no id because of inline markup in the title: none, the ids come from core (kept for the earlier shape). */
  readonly skipped: number
}

// The characters Asciidoctor does not keep in the id (InvalidSectionIdCharsRx, on a lowercase title)
const INVALID_ID_CHARS = /<[^>]+>|&(?:[a-z][a-z]+\d{0,2}|#\d\d\d{0,4}|#x[\da-f][\da-f][\da-f]{0,3});|[^ \p{Alphabetic}\p{N}\p{Pc}\-.]+?/gu

// Anything a title substitution could act on: special characters, quotes, macros, attribute references,
// replacements (`(C)`, `--`, `...`, arrows), apostrophes, passthroughs, index terms, backslash escapes.
const INLINE_MARKUP = /[*_`#+^~&<>{}[\]\\@']|\(\(|\((?:C|R|TM)\)|--|\.\.\.|:(?!\s|$)/

/** True if the title has something a title substitution would change. */
export function hasInlineMarkup(title: string): boolean {
  return INLINE_MARKUP.test(title)
}

/** `String#tr_s` for one target character: each character of `set` becomes `to`, a run of them becomes one. */
function trS(text: string, set: string, to: string): string {
  const chars = new Set([...set])
  let out = ''
  let prev = false
  for (const ch of text) {
    if (chars.has(ch)) {
      if (!prev) out += to
      prev = true
    } else {
      out += ch
      prev = false
    }
  }
  return out
}

/** `Section.generate_id(title, document)` for a title without inline markup. `refs` holds the ids in use. */
export function generateId(title: string, attrs: ReadonlyMap<string, string>, refs: ReadonlySet<string>): string {
  const pre = attrs.get('idprefix') ?? '_'
  let sep: string
  let sepSub: string | null
  let noSep = false
  const rawSep = attrs.get('idseparator')
  if (rawSep !== undefined) {
    if (rawSep.length === 0) {
      noSep = true
      sep = ''
      sepSub = null
    } else {
      sep = [...rawSep][0]!
      sepSub = sep === '-' || sep === '.' ? ' .-' : ` ${sep}.-`
    }
  } else {
    sep = '_'
    sepSub = ' _.-'
  }
  let id = `${pre}${title.toLowerCase().replace(INVALID_ID_CHARS, '')}`
  if (noSep) id = id.replace(/ /g, '')
  else {
    id = trS(id, sepSub!, sep)
    if (id.endsWith(sep)) id = id.slice(0, -sep.length)
    if (pre === '' && id.startsWith(sep)) id = id.slice(sep.length)
  }
  if (refs.has(id)) {
    let n = 2
    let candidate: string
    do candidate = `${id}${sep}${n++}`
    while (refs.has(candidate))
    return candidate
  }
  return id
}

interface Explicit {
  id: string | null
  reftext: string | null
}

const unquote = (s: string) => (s.length >= 2 && /^(["']).*\1$/s.test(s) ? s.slice(1, -1) : s)

/** The id given by a metadata node (`BlockAnchor` or `BlockAttributes`), or nulls. */
function explicitOf(node: SyntaxNode, text: string): Explicit {
  const out: Explicit = { id: null, reftext: null }
  if (node.name === 'BlockAnchor') {
    const id = node.getChild('AnchorId')
    if (id) out.id = text.slice(id.from, id.to)
    const ref = node.getChild('AnchorRefText')
    if (ref) out.reftext = text.slice(ref.from, ref.to)
    return out
  }
  for (let c = node.firstChild; c; c = c.nextSibling) {
    if (c.name === 'PositionalAttribute') {
      const sid = c.getChild('ShorthandId')
      if (sid) out.id = text.slice(sid.from + 1, sid.to)
    } else if (c.name === 'NamedAttribute') {
      const name = c.getChild('AttributeName')
      const value = c.getChild('AttributeValue')
      if (name && value) {
        const n = text.slice(name.from, name.to)
        if (n === 'id') out.id = unquote(text.slice(value.from, value.to))
        else if (n === 'reftext') out.reftext = unquote(text.slice(value.from, value.to))
      }
    }
  }
  return out
}

function scanTargets(doc: NotaDocument, options: ParseOptions): DocTargets {
  const { tree, text } = doc
  const outline = doc.outline()
  const attrs = initialAttributes(options)
  const refs = new Set<string>()
  const targets: DocTarget[] = []
  const sections: SectionId[] = []
  const seen = new Set<string>()
  const skipped = 0
  // the entries of the outline by the place of the section in the text: the parts of included files and the documents of
  // cells have entries too, but not at the place of a section of this tree
  const byFrom = new Map<number, (typeof outline)[number]>()
  for (const o of outline) if (!byFrom.has(o.from)) byFrom.set(o.from, o)
  const add = (id: string, label: string, kind: DocTarget['kind'], from: number) => {
    refs.add(id)
    if (seen.has(id)) return
    seen.add(id)
    targets.push({ id, label, kind, from })
  }

  const section = (node: SyntaxNode, isSection: boolean) => {
    // the metadata lines before the title give the id; entries among them count for the id generation
    let explicit: Explicit = { id: null, reftext: null }
    let title: SyntaxNode | null = null
    let titleLine: SyntaxNode | null = null
    for (let c = node.firstChild; c; c = c.nextSibling) {
      if (c.name === 'BlockAnchor' || c.name === 'BlockAttributes') {
        const e = explicitOf(c, text)
        explicit = { id: e.id ?? explicit.id, reftext: e.reftext ?? explicit.reftext }
      } else if (c.name === 'AttributeEntry') applyEntry(attrs, c, text)
      else if (isSection && c.name === 'SectionTitle') {
        titleLine = c
        title = c.getChild('TitleText')
        break
      } else if (!isSection && c.name === 'TitleText') {
        title = c
        break
      }
    }
    void titleLine
    if (!title) return
    const raw = text.slice(title.from, title.to)
    const markup = hasInlineMarkup(raw)
    // the id is core's: the entry that starts where the section does and has its title
    const found = byFrom.get(node.from)
    const entry = found && raw.startsWith(found.title) ? found : undefined
    let id: string | null = explicit.id === '' ? null : explicit.id
    if (entry) id = entry.id
    else if (id === null && !markup && attrs.attrs.has('sectids')) id = generateId(raw, attrs.attrs, refs)
    const label = explicit.reftext ?? raw
    sections.push({ title: raw, from: title.from, to: title.to, id, explicit: explicit.id !== null && explicit.id !== '', markup, label })
    if (id !== null) add(id, label, 'section', title.from)
  }

  // a cell with the `a` style is a document of its own: what it sets is not set in the document
  let inCell = 0
  tree.iterate({
    enter(ref) {
      switch (ref.name) {
        case 'CellContent':
          inCell++
          return
        case 'AttributeEntry':
          if (inCell === 0) applyEntry(attrs, ref, text)
          return false
        case 'Section':
          section(ref.node, true)
          return
        case 'DiscreteHeading':
          section(ref.node, false)
          return
        case 'BlockAnchor':
        case 'BlockAttributes': {
          const parent = ref.node.parent
          // the metadata of a section or a discrete heading were read with it
          if (parent && (parent.name === 'Section' || parent.name === 'DiscreteHeading')) return false
          const e = explicitOf(ref.node, text)
          if (e.id) add(e.id, e.reftext ?? e.id, 'anchor', ref.from)
          return false
        }
        default:
          return
      }
    },
    leave(ref) {
      if (ref.name === 'CellContent') inCell--
    },
  })
  return { targets, sections, skipped }
}

const cache = new WeakMap<NotaDocument, DocTargets>()

/** The targets of the document; computed once per document (a new one after every edit). */
export function documentTargets(doc: NotaDocument, options: ParseOptions = {}): DocTargets {
  let found = cache.get(doc)
  if (!found) {
    found = scanTargets(doc, options)
    cache.set(doc, found)
  }
  return found
}

export { AttributeState }
