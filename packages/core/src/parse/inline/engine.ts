/**
 * The substitutions of Asciidoctor (Substitutors#apply_subs) over a working text that remembers where each
 * character came from (see work.ts). What the passes find is reported as nodes, ranges of the source.
 */
import { Type } from '../../nodes.js'
import { parseShorthand } from '../attrlist.js'
import { ALNUM, ALPHA, BOL, EOL, WORD, cpAt, isWordCp } from './chars.js'
import type { INode, InlineEnv, InlineSink, Part } from './ctx.js'
import { subMacros } from './macros.js'
import { extractPassthroughs, restorePassthroughs, type Pass } from './pass.js'
import { subQuotes } from './quotes.js'
import { BASIC_SUBS, type Sub } from './subs.js'
import { Out, Work, gsub } from './work.js'

const CAN = '\u0018'
const DEL = '\u007f'

export const INTRINSIC_ATTRIBUTES: Readonly<Record<string, string>> = {
  startsb: '[',
  endsb: ']',
  vbar: '|',
  caret: '^',
  asterisk: '*',
  tilde: '~',
  plus: '&#43;',
  backslash: '\\',
  backtick: '`',
  blank: '',
  empty: '',
  sp: ' ',
  'two-colons': '::',
  'two-semicolons': ';;',
  nbsp: '&#160;',
  deg: '&#176;',
  zwsp: '&#8203;',
  quot: '&#34;',
  apos: '&#39;',
  lsquo: '&#8216;',
  rsquo: '&#8217;',
  ldquo: '&#8220;',
  rdquo: '&#8221;',
  wj: '&#8288;',
  brvbar: '&#166;',
  pp: '&#43;&#43;',
  cpp: 'C&#43;&#43;',
  amp: '&',
  lt: '<',
  gt: '>',
}

const AttributeReferenceRx = new RegExp(
  `(\\\\)?\\{([${WORD}][${WORD}-]*|(set|counter2?):[^\\n]+?)(\\\\)?\\}`,
  'gud',
)

const ReplaceableRx = /[&']|--|\.\.\.|\([CRT]M?\)/

type Restore = 'none' | 'bounding' | 'leading'

const REPLACEMENTS: readonly (readonly [RegExp, string, Restore])[] = [
  [/\\?\(C\)/dg, '&#169;', 'none'],
  [/\\?\(R\)/dg, '&#174;', 'none'],
  [/\\?\(TM\)/dg, '&#8482;', 'none'],
  [new RegExp(`(?: |\\n|${BOL}|\\\\)--(?: |\\n|${EOL})`, 'gd'), '&#8201;&#8212;&#8201;', 'none'],
  [new RegExp(`([${WORD}])\\\\?--(?=[${WORD}])`, 'gud'), '&#8212;&#8203;', 'leading'],
  [/\\?\.\.\./dg, '&#8230;&#8203;', 'none'],
  [/\\?`'/dg, '&#8217;', 'none'],
  [new RegExp(`([${ALNUM}])\\\\?'(?=[${ALPHA}])`, 'gud'), '&#8217;', 'leading'],
  [/\\?-&gt;/dg, '&#8594;', 'none'],
  [/\\?=&gt;/dg, '&#8658;', 'none'],
  [/\\?&lt;-/dg, '&#8592;', 'none'],
  [/\\?&lt;=/dg, '&#8656;', 'none'],
  [
    /\\?(&)amp;((?:[a-zA-Z][a-zA-Z]+\d{0,2}|#\d\d\d{0,4}|#x[\da-fA-F][\da-fA-F][\da-fA-F]{0,3});)/dg,
    '',
    'bounding',
  ],
]

const HardLineBreakRx = new RegExp(`${BOL}([^\\n]*) \\+${EOL}`, 'gd')

const CalloutSourceRx = new RegExp(
  `((?://|#|--|;;) ?)?(\\\\)?&lt;!?(|--)(\\d+|\\.)\\3&gt;(?=(?: ?\\\\?&lt;!?\\3(?:\\d+|\\.)\\3&gt;)*${EOL})`,
  'gd',
)
const calloutRxCache = new Map<string, RegExp>()
function calloutRxFor(comment: string): RegExp {
  let rx = calloutRxCache.get(comment)
  if (!rx) {
    const prefix = comment === '' ? '' : `${comment.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&')} ?`
    rx = new RegExp(`(${prefix})?(\\\\)?&lt;()(\\d+|\\.)&gt;(?=(?: ?\\\\?&lt;(?:\\d+|\\.)&gt;)*${EOL})`, 'gd')
    calloutRxCache.set(comment, rx)
  }
  return rx
}

/** The substitutions of one block (or one piece of text) over a document. */
export class Substitutor {
  readonly compat: boolean
  passes: Pass[] = []
  locked = false

  constructor(
    readonly env: InlineEnv,
    readonly sink: InlineSink | null,
  ) {
    this.compat = env.get('compat-mode') !== undefined
  }

  // ---------------------------------------------------------------- nodes

  /** Reports a construct; `kids` are its parts, inside `[from, to)`, nested by their ranges. */
  node(t: number, from: number, to: number, kids: readonly Part[]): void {
    const sink = this.sink
    if (!sink || to <= from) return
    const parts: Part[] = []
    for (const k of kids) {
      if (k.e <= k.f) continue
      if (k.f < from || k.e > to) return
      parts.push(k)
    }
    sink.nodes.push({ t, f: from, e: to, kids: parts } satisfies INode)
  }

  /** Reports a leaf. */
  leaf(t: number, w: Work, i: number, j: number): void {
    if (!this.sink || j <= i) return
    for (let k = i; k < j; k++) if (w.b![k]! - w.a![k]! !== 1) return
    this.node(t, w.a![i]!, w.b![j - 1]!, [])
  }

  quoteNode(
    t: number,
    w: Work,
    m: number,
    c0: number,
    j: number,
    e: number,
    attrFrom: number,
    attrTo: number,
  ): void {
    if (!this.sink) return
    const a = w.a!
    const b = w.b!
    const kids: Part[] = []
    if (attrFrom >= 0) kids.push({ t: Type.InlineAttributes, f: a[attrFrom]!, e: b[attrTo - 1]! })
    kids.push(
      { t: Type.QuoteMarker, f: a[m]!, e: b[c0 - 1]! },
      { t: Type.QuoteMarker, f: a[j]!, e: b[e - 1]! },
    )
    this.node(t, a[attrFrom >= 0 ? attrFrom : m]!, b[e - 1]!, kids)
  }

  diag(from: number, to: number, code: string, message: string): void {
    this.sink?.diags.push({ from, to, severity: 'info', code, message })
  }

  // ---------------------------------------------------------------- driver

  /** Substitutors#apply_subs on a working text. */
  apply(w0: Work, subs: readonly Sub[]): Work {
    let w = w0
    if (w.s.length === 0) return w
    let outermost = false
    let hasPasses = false
    if (subs.includes('macros')) {
      w = extractPassthroughs(this, w)
      if (this.passes.length > 0) {
        hasPasses = true
        if (!this.locked) {
          this.locked = true
          outermost = true
        }
      }
    }
    for (const sub of subs) {
      switch (sub) {
        case 'specialcharacters':
          w = this.subSpecialChars(w)
          break
        case 'quotes':
          w = subQuotes(this, w)
          break
        case 'attributes':
          if (w.s.includes('{')) w = this.subAttributes(w)
          break
        case 'replacements':
          w = this.subReplacements(w)
          break
        case 'macros':
          w = subMacros(this, w)
          break
        case 'callouts':
          w = this.subCallouts(w)
          break
        case 'post_replacements':
          w = this.subPostReplacements(w)
          break
      }
    }
    if (hasPasses) {
      w = restorePassthroughs(this, w)
      if (outermost) {
        this.passes = []
        this.locked = false
      }
    }
    return w
  }

  /** A plain string through the substitutions, for the texts of attributes and macros. */
  applyString(text: string, subs: readonly Sub[]): string {
    if (text === '') return text
    const sub = new Substitutor(this.env, null)
    return sub.apply(Work.of(text, null, false), subs).s
  }

  // ---------------------------------------------------------------- attributes

  /** The value of an attribute for a reference: defined, or intrinsic, or null. */
  private lookup(key: string): string | null {
    const v = this.env.get(key)
    if (v !== undefined) return v
    return Object.hasOwn(INTRINSIC_ATTRIBUTES, key) ? INTRINSIC_ATTRIBUTES[key]! : null
  }

  subAttributes(w: Work): Work {
    const env = this.env
    let drop = false
    let dropLine = false
    let dropEmptyLine = false
    let missing: string | null = null
    const track = w.a !== null
    const w1 = gsub(w, AttributeReferenceRx, (m, out) => {
      const whole = m[0]
      const esc1 = m[1]
      const inner = m[2]!
      const setKind = m[3]
      const esc2 = m[4]
      const ind = m.indices!
      const start = m.index
      const from = track ? w.a![start]! : 0
      const to = track ? w.b![start + whole.length - 1]! : 0
      const innerFrom = ind[2]![0]
      if (esc1 === '\\' || esc2 === '\\') {
        // an escaped reference is text, without the backslash
        if (track) {
          const bs = esc1 === '\\' ? start : start + whole.length - 2
          this.leaf(Type.Escape, w, bs, bs + 1)
        }
        out.gen(`{${inner}}`, from, to)
        return
      }
      if (track)
        this.node(Type.AttributeReference, from, to, [
          { t: Type.AttributeName, f: w.a![innerFrom]!, e: w.b![innerFrom + inner.length - 1]! },
        ])
      if (setKind !== undefined) {
        const args = inner.split(':')
        const command = args.shift()!
        if (command === 'set') {
          // the value is everything after the second colon, colons of its own included
          const rest = inner.slice(command.length + 1)
          const colon = rest.indexOf(':')
          let name = colon < 0 ? rest : rest.slice(0, colon)
          const unset = name.endsWith('!') || name.startsWith('!')
          const value = unset ? null : colon < 0 ? '' : rest.slice(colon + 1)
          if (name.endsWith('!')) name = name.slice(0, -1)
          else if (name.startsWith('!')) name = name.slice(1)
          env.set?.(name, value)
          if (value !== null || (env.get('attribute-undefined') ?? 'drop-line') !== 'drop-line') {
            drop = dropEmptyLine = true
            out.gen(DEL, from, to)
          } else {
            drop = dropLine = true
            out.gen(CAN, from, to)
          }
        } else {
          const rest = inner.slice(command.length + 1)
          const colon = rest.indexOf(':')
          const v = env.counter ? env.counter(colon < 0 ? rest : rest.slice(0, colon), colon < 0 ? undefined : rest.slice(colon + 1)) : '1'
          if (command === 'counter2') {
            drop = dropEmptyLine = true
            out.gen(DEL, from, to)
          } else out.gen(v, from, to)
        }
        return
      }
      const key = inner.toLowerCase()
      const value = this.lookup(key)
      if (value !== null) {
        out.gen(value, from, to)
        return
      }
      if (missing === null) missing = env.get('attribute-missing') ?? 'skip'
      if (track) this.diag(from, to, 'undefined-attribute', `Undefined attribute "${key}"`)
      if (missing === 'drop') {
        drop = dropEmptyLine = true
        out.gen(DEL, from, to)
      } else if (missing === 'drop-line') {
        drop = dropLine = true
        out.gen(CAN, from, to)
      } else out.copy(w, start, start + whole.length)
    })
    if (!drop) return w1
    return dropLines(w1, dropEmptyLine, dropLine)
  }

  /** `{a}` and the like in a plain string (the value of an attribute of a quote or macro). */
  subAttributesString(text: string): string {
    if (!text.includes('{')) return text
    return this.subAttributes(Work.of(text, null, false)).s
  }

  /** Substitutors#parse_quoted_text_attributes. */
  parseQuotedAttributes(source: string): { id?: string; role?: string } {
    let str = this.subAttributesString(source)
    const comma = str.indexOf(',')
    if (comma >= 0) str = str.slice(0, comma)
    str = str.trim()
    if (str === '') return {}
    if (str.startsWith('.') || str.startsWith('#')) {
      const hash = str.indexOf('#')
      const before = hash < 0 ? str : str.slice(0, hash)
      const after = hash < 0 ? '' : str.slice(hash + 1)
      const attrs: { id?: string; role?: string } = {}
      if (after === '') {
        if (before.length > 1) attrs.role = before.replaceAll('.', ' ').trimStart()
      } else {
        const dot = after.indexOf('.')
        const id = dot < 0 ? after : after.slice(0, dot)
        const roles = dot < 0 ? '' : after.slice(dot + 1)
        if (id !== '') attrs.id = id
        if (roles === '') {
          if (before.length > 1) attrs.role = before.replaceAll('.', ' ').trimStart()
        } else if (before.length > 1) attrs.role = `${before}.${roles}`.replaceAll('.', ' ').trimStart()
        else attrs.role = roles.replaceAll('.', ' ')
      }
      return attrs
    }
    return { role: str }
  }

  // ---------------------------------------------------------------- replacements

  /** The special characters substitution; every `<`, `&` and `>` of the source is a node. */
  private subSpecialChars(w: Work): Work {
    if (!this.sink) return subSpecialChars(w)
    const s = w.s
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i)
      if (c === 0x3c || c === 0x26 || c === 0x3e) this.leaf(Type.SpecialChar, w, i, i + 1)
    }
    return subSpecialChars(w)
  }

  private subReplacements(w0: Work): Work {
    if (!ReplaceableRx.test(w0.s)) return w0
    let w = w0
    const track = w.a !== null
    for (const [rx, replacement, restore] of REPLACEMENTS) {
      w = gsub(w, rx, (m, out) => {
        const whole = m[0]
        const start = m.index
        if (whole.includes('\\')) {
          // an escape: the first backslash goes
          const bs = start + whole.indexOf('\\')
          out.copy(w, start, bs)
          out.copy(w, bs + 1, start + whole.length)
          if (track) this.leaf(Type.Escape, w, bs, bs + 1)
          return
        }
        const ind = m.indices!
        if (restore === 'none') {
          out.gen(replacement, track ? w.a![start]! : 0, track ? w.b![start + whole.length - 1]! : 0)
          if (track) {
            // the replaced text without the blanks the pattern takes along
            let f = start
            let e = start + whole.length
            if (whole.startsWith(' ') || whole.startsWith('\n')) f++
            if (
              whole.length > 2 &&
              (whole.endsWith(' ') || whole.endsWith('\n')) &&
              whole.startsWith(' ') !== undefined
            ) {
              if (e - 1 > f) e--
            }
            this.leaf(Type.Replacement, w, f, e)
          }
        } else if (restore === 'leading') {
          const g1 = ind[1]!
          out.copy(w, g1[0], g1[1])
          const from = g1[1]
          out.gen(replacement, track ? w.a![from]! : 0, track ? w.b![start + whole.length - 1]! : 0)
          if (track) this.leaf(Type.Replacement, w, from, start + whole.length)
        } else {
          // bounding: an entity that had its ampersand escaped
          out.copy(w, ind[1]![0], ind[1]![1])
          out.copy(w, ind[2]![0], ind[2]![1])
        }
      })
    }
    return w
  }

  // ---------------------------------------------------------------- post replacements

  private subPostReplacements(w: Work): Work {
    const hard =
      this.env.block?.('hardbreaks-option') !== undefined || this.env.get('hardbreaks-option') !== undefined
    const track = w.a !== null
    if (hard) {
      const lines = w.s.split('\n')
      if (lines.length < 2) return w
      const out = new Out(track)
      let pos = 0
      for (let k = 0; k < lines.length; k++) {
        const line = lines[k]!
        const end = pos + line.length
        if (k < lines.length - 1) {
          const br = line.endsWith(' +')
          const textEnd = br ? end - 2 : end
          out.copy(w, pos, textEnd)
          out.gen('<br>', track && end > pos ? w.a![end - 1]! : 0, track && end > pos ? w.b![end - 1]! : 0)
          if (br) this.leaf(Type.HardBreak, w, textEnd, end)
          out.copy(w, end, end + 1)
        } else out.copy(w, pos, end)
        pos = end + 1
      }
      return out.finish()
    }
    if (w.s.includes('+') && w.s.includes(' +')) {
      return gsub(w, HardLineBreakRx, (m, out) => {
        const ind = m.indices!
        out.copy(w, ind[1]![0], ind[1]![1])
        const bs = ind[1]![1]
        out.gen('<br>', track ? w.a![bs]! : 0, track ? w.b![bs + 1]! : 0)
        if (track) this.leaf(Type.HardBreak, w, bs, bs + 2)
      })
    }
    return w
  }

  // ---------------------------------------------------------------- callouts

  private subCallouts(w: Work): Work {
    const comment = this.env.block?.('line-comment')
    const rx = comment !== undefined ? calloutRxFor(comment) : CalloutSourceRx
    let autonum = 0
    const track = w.a !== null
    const icons = this.env.get('icons')
    return gsub(w, rx, (m, out) => {
      const whole = m[0]
      const ind = m.indices!
      const start = m.index
      if (m[2] !== undefined) {
        // an escaped callout: the backslash goes
        const bs = ind[2]![0]
        out.copy(w, start, bs)
        out.copy(w, bs + 1, start + whole.length)
        if (track) this.leaf(Type.Escape, w, bs, bs + 1)
        return
      }
      const num = m[4] === '.' ? String(++autonum) : m[4]!
      const guard = m[1] !== undefined && m[1] !== '' ? m[1] : m[3] === '--' ? ['<!--', '-->'] : null
      this.env.nextCalloutId?.()
      out.gen(
        calloutHtmlOf(num, guard as string | readonly [string, string] | null, icons, this.env),
        track ? w.a![start]! : 0,
        track ? w.b![start + whole.length - 1]! : 0,
      )
      if (track) this.leaf(Type.Callout, w, start, start + whole.length)
    })
  }
}

function calloutHtmlOf(
  text: string,
  guard: string | readonly [string, string] | null,
  icons: string | undefined,
  env: InlineEnv,
): string {
  if (icons === 'font') return `<i class="conum" data-value="${text}"></i><b>(${text})</b>`
  if (icons !== undefined)
    return `<img src="${env.iconUri ? env.iconUri(`callouts/${text}`) : `callouts/${text}`}" alt="${text}">`
  if (Array.isArray(guard)) return `&lt;!--<b class="conum">(${text})</b>--&gt;`
  return `${(guard as string | null) ?? ''}<b class="conum">(${text})</b>`
}

/** The special characters substitution: `<`, `&` and `>` become entities. */
export function subSpecialChars(w: Work): Work {
  const s = w.s
  if (!/[<&>]/.test(s)) return w
  return gsub(w, /[<&>]/g, (m, out) => {
    const from = w.a ? w.a[m.index]! : 0
    const to = w.b ? w.b[m.index]! : 0
    out.gen(m[0] === '&' ? '&amp;' : m[0] === '<' ? '&lt;' : '&gt;', from, to)
  })
}

/** Drops the lines a `drop` or `drop-line` reference marked (Substitutors#sub_attributes). */
function dropLines(w: Work, emptyLine: boolean, line: boolean): Work {
  const s = w.s
  const lines = s.split('\n')
  const out = new Out(w.a !== null)
  let first = true
  let pos = 0
  for (const l of lines) {
    const end = pos + l.length
    let drop: boolean
    if (emptyLine) {
      const squeezed = l.replace(/\u007f+/g, DEL)
      drop = squeezed === DEL || (line && (squeezed === CAN || squeezed.includes(CAN)))
    } else drop = line && l.includes(CAN)
    if (!drop) {
      if (!first) out.copy(w, pos - 1, pos)
      // delete the marks that are left
      let k = pos
      for (let i = pos; i < end; i++) {
        if (s.charCodeAt(i) === 0x7f) {
          out.copy(w, k, i)
          k = i + 1
        }
      }
      out.copy(w, k, end)
      first = false
    }
    pos = end + 1
  }
  if (!emptyLine && !s.includes('\n')) return new Out(w.a !== null).finish()
  return out.finish()
}

export { isWordCp, cpAt, BASIC_SUBS, parseShorthand }
