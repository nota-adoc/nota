/**
 * Document attributes as the parser sees them: an immutable map with a cheap content hash (so that the
 * parser state at a unit boundary can be compared quickly), the attributes Asciidoctor 2.0 defines by
 * default, the attributes passed by the caller (locked, as in `Asciidoctor.load(…, { attributes })`)
 * and the substitutions applied to attribute values.
 */

import { resolveSubs, substitute } from './inline/index.js'
import { INTRINSIC_ATTRIBUTES } from './inline/engine.js'
import { rubyToI, sanitizeAttributeName } from './rx.js'

/** Values of {@link ParseOptions.attributes}: a string sets, `null` unsets and locks, `false` unsets. */
export type AttributeValue = string | number | boolean | null

/**
 * The attributes Asciidoctor 2.0.26 defines on `Asciidoctor.load` in secure mode (the default), without
 * those that depend on the environment: the paths (`docdir`, `user-home`, `stylesdir`, `iconsdir`) and
 * the dates and times (`localdate`, `localyear`, `localtime`, `localdatetime`, `docdate`, `docyear`,
 * `doctime`, `docdatetime`). Those are set only through `ParseOptions.attributes`.
 */
export const DEFAULT_ATTRIBUTES: Readonly<Record<string, string>> = {
  'attribute-undefined': 'drop-line',
  'attribute-missing': 'skip',
  'appendix-caption': 'Appendix',
  'appendix-refsig': 'Appendix',
  'caution-caption': 'Caution',
  'chapter-refsig': 'Chapter',
  'example-caption': 'Example',
  'figure-caption': 'Figure',
  'important-caption': 'Important',
  'last-update-label': 'Last updated',
  'note-caption': 'Note',
  'part-refsig': 'Part',
  prewrap: '',
  sectids: '',
  'section-refsig': 'Section',
  'table-caption': 'Table',
  'tip-caption': 'Tip',
  'toc-placement': 'auto',
  'toc-title': 'Table of Contents',
  'untitled-label': 'Untitled',
  'version-label': 'Version',
  'warning-caption': 'Warning',
  notitle: '',
  embedded: '',
  asciidoctor: '',
  'asciidoctor-version': '2.0.26',
  'safe-mode-name': 'secure',
  'safe-mode-secure': '',
  'safe-mode-level': '20',
  'max-include-depth': '64',
  backend: 'html5',
  'max-attribute-value-size': '4096',
  linkcss: '',
  doctype: 'article',
  htmlsyntax: 'html',
  'backend-html5-doctype-article': '',
  'doctype-article': '',
  'backend-html5': '',
  outfilesuffix: '.html',
  filetype: 'html',
  'filetype-html': '',
  'basebackend-html-doctype-article': '',
  'basebackend-html': '',
  basebackend: 'html',
  authorcount: '0',
}

/** Attributes the document cannot change in secure mode (Asciidoctor sets them from its own overrides). */
const SECURE_LOCKED: readonly string[] = [
  'embedded',
  'asciidoctor',
  'asciidoctor-version',
  'safe-mode-name',
  'safe-mode-secure',
  'safe-mode-level',
  'max-include-depth',
  'allow-uri-read',
  'docdir',
  'user-home',
  'max-attribute-value-size',
  'linkcss',
  'icons',
  'copycss',
  'source-highlighter',
  'backend',
]

/** Attributes that are unset and locked in secure mode. */
const SECURE_UNSET: readonly string[] = ['allow-uri-read', 'icons', 'copycss', 'source-highlighter']

function fnv(s: string, seed: number): number {
  let h = seed >>> 0
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  return h
}

const entryHash1 = (name: string, value: string) => fnv(`${name}\u0000${value}`, 2166136261)
const entryHash2 = (name: string, value: string) => fnv(`${value}\u0001${name}`, 0x9747b28c)

/** An immutable attribute map. Two maps with the same content are {@link attrsEqual}. */
export class Attrs {
  constructor(
    readonly map: ReadonlyMap<string, string>,
    readonly h1: number,
    readonly h2: number,
  ) {}

  has(name: string): boolean {
    return this.map.has(name)
  }

  get(name: string): string | undefined {
    return this.map.get(name)
  }
}

export function attrsEqual(a: Attrs, b: Attrs): boolean {
  if (a === b) return true
  if (a.h1 !== b.h1 || a.h2 !== b.h2 || a.map.size !== b.map.size) return false
  for (const [k, v] of a.map) if (b.map.get(k) !== v) return false
  return true
}

/** A working copy of an {@link Attrs} that is copied on the first change. */
export class AttrsBuilder {
  private map: Map<string, string> | null = null
  private h1: number
  private h2: number
  private frozen: Attrs | null

  constructor(private readonly base: Attrs) {
    this.frozen = base
    this.h1 = base.h1
    this.h2 = base.h2
  }

  has(name: string): boolean {
    return (this.map ?? this.base.map).has(name)
  }

  get(name: string): string | undefined {
    return (this.map ?? this.base.map).get(name)
  }

  /** Sets (`value` a string) or removes (`null`) an attribute. */
  set(name: string, value: string | null): void {
    const cur = (this.map ?? this.base.map).get(name)
    if (value === null ? cur === undefined : cur === value) return
    const map = (this.map ??= new Map(this.base.map))
    if (cur !== undefined) {
      this.h1 = (this.h1 - entryHash1(name, cur)) >>> 0
      this.h2 = (this.h2 - entryHash2(name, cur)) >>> 0
    }
    if (value === null) map.delete(name)
    else {
      map.set(name, value)
      this.h1 = (this.h1 + entryHash1(name, value)) >>> 0
      this.h2 = (this.h2 + entryHash2(name, value)) >>> 0
    }
    this.frozen = null
  }

  /** The attributes as they are now; the builder may be used on after that. */
  freeze(): Attrs {
    return (this.frozen ??= new Attrs(new Map(this.map!), this.h1, this.h2))
  }
}

export function attrsOf(entries: Iterable<[string, string]>): Attrs {
  const map = new Map(entries)
  let h1 = 0
  let h2 = 0
  for (const [k, v] of map) {
    h1 = (h1 + entryHash1(k, v)) >>> 0
    h2 = (h2 + entryHash2(k, v)) >>> 0
  }
  return new Attrs(map, h1, h2)
}

/** The starting attributes of a parse and the names the document cannot change. */
export interface AttributeSetup {
  readonly initial: Attrs
  readonly locked: ReadonlySet<string>
}

/**
 * Applies the caller's attributes to the defaults the way Document#initialize does: a string value sets
 * and locks; `null` (or a name with a leading or trailing `!`) unsets and locks; `false` unsets without
 * locking; a value ending in `@` (or a name ending in `@`) sets without locking.
 */
export function setupAttributes(given: Readonly<Record<string, AttributeValue>> | undefined): AttributeSetup {
  const overrides = new Map<string, string | null | false>()
  for (const [rawKey, rawVal] of Object.entries(given ?? {})) {
    let key = rawKey
    let val: string | null | false
    const str = (v: AttributeValue): string => (v === true ? '' : String(v))
    if (key.endsWith('@')) {
      if (key.startsWith('!')) {
        key = key.slice(1, -1)
        val = false
      } else if (key.endsWith('!@')) {
        key = key.slice(0, -2)
        val = false
      } else {
        key = key.slice(0, -1)
        val = `${rawVal === null || rawVal === false ? '' : str(rawVal)}@`
      }
    } else if (key.startsWith('!')) {
      key = key.slice(1)
      val = rawVal === '@' ? false : null
    } else if (key.endsWith('!')) {
      key = key.slice(0, -1)
      val = rawVal === '@' ? false : null
    } else {
      val = rawVal === null ? null : rawVal === false ? false : str(rawVal)
    }
    overrides.set(key.toLowerCase(), val)
  }
  const attrs = new Map<string, string>(Object.entries(DEFAULT_ATTRIBUTES))
  const locked = new Set<string>(SECURE_LOCKED)
  for (const name of SECURE_UNSET) attrs.delete(name)
  for (const [name, val] of overrides) {
    if (name === 'numbered') continue
    if (val === false) {
      attrs.delete(name)
      locked.delete(name)
    } else if (val === null) {
      attrs.delete(name)
      locked.add(name)
    } else if (val.endsWith('@')) {
      attrs.set(name, val.slice(0, -1))
      locked.delete(name)
    } else {
      attrs.set(name, val)
      locked.add(name)
    }
  }
  const numbered = overrides.get('numbered')
  if (numbered !== undefined) {
    if (numbered === null || numbered === false) attrs.delete('sectnums')
    else attrs.set('sectnums', numbered.endsWith('@') ? numbered.slice(0, -1) : numbered)
  }
  return { initial: attrsOf(attrs), locked }
}

const WORD = '\\p{Alphabetic}\\p{M}\\p{Nd}\\p{Pc}'

/** AttributeReferenceRx: `{name}`, `\{name}` (escaped) and `{set:…}`/`{counter:…}` (left as they are). */
const AttributeReferenceRx = new RegExp(
  `(\\\\)?\\{([${WORD}][${WORD}-]*|(?:set|counter2?):[^\\n]+?)(\\\\)?\\}`,
  'gu',
)

export function subSpecialChars(text: string): string {
  return text.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'))
}

/**
 * Substitutes attribute references the way `sub_attributes` does, for the parts of it the block parser
 * needs (values of attribute entries, targets and expressions of directives). References that are not
 * defined stay as they are unless `attribute-missing` says `drop` (or `drop-line`, which for one line
 * leaves nothing). `{set:…}` and `{counter:…}` are left as written.
 */
export function subAttributes(
  text: string,
  get: (name: string) => string | undefined,
  missing?: string,
  hooks?: AttributeHooks,
): string {
  if (!text.includes('{')) return text
  let dropLine = false
  const out = text.replace(
    AttributeReferenceRx,
    (whole, esc: string | undefined, name: string, esc2: string | undefined) => {
      if (esc === '\\' || esc2 === '\\') return `{${name}}`
      const cmd = /^(set|counter2?):/.exec(name)
      if (cmd) {
        if (!hooks) return whole
        const rest = name.slice(cmd[0].length)
        const colon = rest.indexOf(':')
        const first = colon < 0 ? rest : rest.slice(0, colon)
        const arg = colon < 0 ? undefined : rest.slice(colon + 1)
        if (cmd[1] === 'set') {
          const unset = first.endsWith('!') || first.startsWith('!')
          hooks.set(first, unset ? null : (arg ?? ''))
          return ''
        }
        const v = hooks.counter(first, arg)
        return cmd[1] === 'counter2' ? '' : v
      }
      const key = name.toLowerCase()
      const v = get(key)
      if (v !== undefined) return v
      const intrinsic = INTRINSIC_ATTRIBUTES[key]
      if (intrinsic !== undefined) return intrinsic
      const mode = missing ?? get('attribute-missing') ?? 'skip'
      if (mode === 'drop') return ''
      if (mode === 'drop-line') {
        dropLine = true
        return ''
      }
      return whole
    },
  )
  return dropLine ? '' : out
}

/** What `{set:…}` and `{counter:…}` do in a value: they change the attributes of the document. */
export interface AttributeHooks {
  counter(name: string, seed: string | undefined): string
  set(name: string, value: string | null): void
}

/** Document#apply_attribute_value_subs: `pass:[…]` values, otherwise special characters and references. */
export function applyValueSubs(
  value: string,
  get: (name: string) => string | undefined,
  hooks?: AttributeHooks,
): string {
  const pass = /^pass:([a-z]+(?:,[a-z-]+)*)?\[(.*)\]$/s.exec(value)
  let out: string
  if (pass) {
    out = pass[2]!
    if (pass[1]) {
      // the subs of the macro are the ones of `pass:`: groups (`normal`, `n`) and single ones (`c`, `a`, `q`, …)
      const subs = resolveSubs(pass[1], 'inline', null) ?? []
      out = substitute(out, null, subs, { get, set: hooks?.set.bind(hooks), counter: hooks?.counter.bind(hooks) })
    }
  } else {
    out = subAttributes(subSpecialChars(value), get, undefined, hooks)
  }
  const max = get('max-attribute-value-size')
  if (max !== undefined && out.length * 3 > Number(max)) out = limitBytes(out, Number(max))
  return out
}

/** Truncates a string to `max` UTF-8 bytes (dropping a split character), like Document#limit_bytesize. */
function limitBytes(s: string, max: number): string {
  if (!(max >= 0)) return s
  let bytes = 0
  let end = 0
  for (const ch of s) {
    const cp = ch.codePointAt(0)!
    const n = cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4
    if (bytes + n > max) break
    bytes += n
    end += ch.length
  }
  return s.slice(0, end)
}

/** What an attribute entry can change besides the attributes: the doctype and the level offset. */
export interface DocState {
  doctype: string
  leveloffset: number
}

/**
 * Attribute entries as Parser.store_attribute applies them: names are cleaned up, an unset marker unsets, the
 * value goes through the attribute value substitutions, names the document cannot change (locked) stay.
 */
export class AttributeTracker {
  constructor(
    readonly ab: AttrsBuilder,
    readonly locked: ReadonlySet<string>,
    readonly st: DocState,
    /** The counters of the document (`{counter:name}`): their last values, for the names the document cannot change. */
    private readonly counters = new Map<string, string | number>(),
  ) {}

  get(name: string): string | undefined {
    return this.ab.get(name)
  }

  /**
   * A tracker over a copy of `base` (the attributes as they were at some earlier point), for text that Asciidoctor
   * converts at that point: what `{set:}` and `{counter:}` do in it is seen by the rest of that text at once, and by
   * the document after it through {@link adopt}. The counters are the document's, or with `isolated` a copy of them
   * (for a trial run that must leave no trace).
   */
  fork(base: Attrs, isolated = false): AttributeTracker {
    return new AttributeTracker(
      new AttrsBuilder(base),
      this.locked,
      this.st,
      isolated ? new Map(this.counters) : this.counters,
    )
  }

  /**
   * Puts what a tracker made with `fork(base)` changed into the attributes of this one; returns the names it
   * changed. The names in `sync` (changed by an earlier trial run) are set to what the fork made of them.
   */
  adopt(fork: AttributeTracker, base: Attrs, sync: readonly string[] = []): string[] {
    const now = fork.ab.freeze()
    const changed: string[] = []
    if (now === base && sync.length === 0) return changed
    for (const [name, value] of now.map)
      if (base.map.get(name) !== value) {
        this.ab.set(name, value)
        changed.push(name)
      }
    for (const name of base.map.keys())
      if (!now.map.has(name)) {
        this.ab.set(name, null)
        changed.push(name)
      }
    for (const name of sync) if (!changed.includes(name)) this.ab.set(name, now.map.get(name) ?? null)
    return changed
  }

  /** Document#counter. */
  counter(name: string, seed?: string): string {
    const locked = this.locked.has(name)
    const known = this.counters.get(name)
    const cur = this.ab.get(name)
    let next: string | number
    if ((locked && known !== undefined) || (cur !== undefined && cur !== '')) {
      const from = locked && known !== undefined ? known : cur!
      next = nextval(from)
    } else if (seed) next = String(rubyToI(seed)) === seed ? rubyToI(seed) : seed
    else next = 1
    this.counters.set(name, next)
    if (!locked) this.ab.set(name, String(next))
    return String(next)
  }

  /** What `{set:…}` and `{counter:…}` do to these attributes. */
  readonly hooks: AttributeHooks = {
    counter: (name, seed) => this.counter(name, seed),
    set: (name, value) => {
      this.entry(value === null ? `${name}!` : name, value ?? '', false, true)
    },
  }

  /** An entry as written (`:name: value`, `:name!:`, `:!name:`); returns the clean name and whether it unsets. */
  entry(rawName: string, value: string, header: boolean, fromHook = false): { name: string; unset: boolean } {
    let name = rawName
    let unset = false
    if (name.endsWith('!')) {
      name = name.slice(0, -1)
      unset = true
    } else if (name.startsWith('!')) {
      name = name.slice(1)
      unset = true
    }
    name = sanitizeAttributeName(name)
    this.store(name, unset ? null : value, header, fromHook)
    return { name, unset }
  }

  /**
   * `fromHook`: the entry comes from `{set:}` in text, which Asciidoctor runs when it converts, after the blocks are
   * read: it changes the attributes, but leaves the state of the block parse (`st`) alone.
   */
  store(name: string, value: string | null, header: boolean, fromHook = false): void {
    const { st, ab } = this
    if (name === 'numbered') name = 'sectnums'
    else if (name === 'hardbreaks') name = 'hardbreaks-option'
    else if (name === 'showtitle') this.store('notitle', value !== null ? null : '', header, fromHook)
    if (this.locked.has(name)) return
    const get = (n: string) => ab.get(n)
    if (value === null) {
      ab.set(name, null)
      if (name === 'leveloffset' && !fromHook) st.leveloffset = 0
      return
    }
    if (name === 'leveloffset') {
      // support relative leveloffset values
      const cur = fromHook ? rubyToI(ab.get('leveloffset') ?? '0') : st.leveloffset
      if (value.startsWith('+')) value = String(cur + rubyToI(value.slice(1)))
      else if (value.startsWith('-')) value = String(cur - rubyToI(value.slice(1)))
    }
    const resolved = value.length ? applyValueSubs(value, get, this.hooks) : value
    if (header && name === 'doctype') {
      this.updateDoctype(resolved)
      st.doctype = resolved
    } else ab.set(name, resolved)
    if (name === 'leveloffset' && !fromHook) st.leveloffset = rubyToI(resolved)
  }

  /** Document#update_doctype_attributes. */
  private updateDoctype(newDoctype: string): void {
    const { st, ab } = this
    const current = st.doctype
    if (newDoctype !== current) {
      const backend = ab.get('backend')
      const base = ab.get('basebackend')
      ab.set(`doctype-${current}`, null)
      if (backend !== undefined) {
        ab.set(`backend-${backend}-doctype-${current}`, null)
        ab.set(`backend-${backend}-doctype-${newDoctype}`, '')
      }
      if (base !== undefined) {
        ab.set(`basebackend-${base}-doctype-${current}`, null)
        ab.set(`basebackend-${base}-doctype-${newDoctype}`, '')
      }
      ab.set(`doctype-${newDoctype}`, '')
    }
    ab.set('doctype', newDoctype)
  }
}

/** Helpers.nextval: the next value of a counter. */
function nextval(cur: string | number): string | number {
  if (typeof cur === 'number') return cur + 1
  const n = rubyToI(cur)
  if (String(n) !== cur) return String.fromCodePoint(cur.codePointAt(0)! + 1)
  return n + 1
}
