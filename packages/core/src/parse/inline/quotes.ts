/**
 * The quotes substitution (Substitutors#sub_quotes): the twelve rules of QUOTE_SUBS, in Asciidoctor's order,
 * each a left-to-right scan that finds what its regular expression finds, in linear time: the regular
 * expressions backtrack over the rest of the text for every marker they cannot close.
 */
import { Type } from '../../nodes.js'
import { cpAt, cpLen, cpStartBefore, isNonSpaceAt, isWordCp } from './chars.js'
import { Next, Out, type Work } from './work.js'
import type { Substitutor } from './engine.js'

type Kind = 'un' | 'con' | 'sup'

interface Rule {
  readonly type: string
  readonly kind: Kind
  readonly open: string
  readonly close: string
  /** ASCII characters (besides word characters) that cannot precede a constrained opening marker. */
  readonly forbid: string
  /** Word characters cannot precede the opening marker. */
  readonly wordBefore: boolean
  /** The characters (besides word characters) that cannot follow a constrained closing marker. */
  readonly after: string
  readonly nodeType: number
}

const R = (
  type: string,
  kind: Kind,
  open: string,
  close: string,
  nodeType: number,
  forbid = ';:}',
  after = '',
): Rule => ({ type, kind, open, close, forbid, wordBefore: true, after, nodeType })

const normal: readonly Rule[] = [
  R('strong', 'un', '**', '**', Type.Strong),
  R('strong', 'con', '*', '*', Type.Strong),
  R('double', 'con', '"`', '`"', Type.DoubleQuoted),
  R('single', 'con', "'`", "`'", Type.SingleQuoted, ';:`}'),
  R('monospaced', 'un', '``', '``', Type.Monospace),
  R('monospaced', 'con', '`', '`', Type.Monospace, ';:"\'`}', '"\'`'),
  R('emphasis', 'un', '__', '__', Type.Emphasis),
  R('emphasis', 'con', '_', '_', Type.Emphasis),
  R('mark', 'un', '##', '##', Type.Highlight),
  R('mark', 'con', '#', '#', Type.Highlight, '&;:}'),
  R('superscript', 'sup', '^', '^', Type.Superscript),
  R('subscript', 'sup', '~', '~', Type.Subscript),
]

const compat: readonly Rule[] = [
  normal[0]!,
  normal[1]!,
  R('double', 'con', '``', "''", Type.DoubleQuoted),
  R('emphasis', 'con', "'", "'", Type.Emphasis),
  R('single', 'con', '`', "'", Type.SingleQuoted),
  R('monospaced', 'un', '++', '++', Type.Monospace),
  R('monospaced', 'con', '+', '+', Type.Monospace),
  normal[6]!,
  normal[7]!,
  normal[8]!,
  normal[9]!,
  normal[10]!,
  normal[11]!,
]

const QUOTE_TAGS: Readonly<Record<string, readonly [string, string, boolean]>> = {
  monospaced: ['<code>', '</code>', true],
  emphasis: ['<em>', '</em>', true],
  strong: ['<strong>', '</strong>', true],
  double: ['&#8220;', '&#8221;', false],
  single: ['&#8216;', '&#8217;', false],
  mark: ['<mark>', '</mark>', true],
  superscript: ['<sup>', '</sup>', true],
  subscript: ['<sub>', '</sub>', true],
  asciimath: ['\\$', '\\$', false],
  latexmath: ['\\(', '\\)', false],
}

/** The opening and closing text of quoted text of a type, with the id and the role it carries. */
export function quoteTags(type: string, id: string | undefined, role: string | undefined): [string, string] {
  const [open, close, tag] = QUOTE_TAGS[type] ?? ['', '', false]
  if (id !== undefined) {
    const cls = role !== undefined ? ` class="${role}"` : ''
    return tag
      ? [`${open.slice(0, -1)} id="${id}"${cls}>`, close]
      : [`<span id="${id}"${cls}>${open}`, `${close}</span>`]
  }
  if (role !== undefined)
    return tag
      ? [`${open.slice(0, -1)} class="${role}">`, close]
      : [`<span class="${role}">${open}`, `${close}</span>`]
  return [open, close]
}

export function subQuotes(S: Substitutor, w0: Work): Work {
  const sniff = S.compat ? /[*'_+#^~]/ : /[*_`#^~]/
  if (!sniff.test(w0.s)) return w0
  let w = w0
  for (const rule of S.compat ? compat : normal) w = scan(S, w, rule)
  return w
}

interface Found {
  s: number
  /** Length of the prefix character kept (constrained). */
  prefix: number
  esc: boolean
  attrFrom: number
  attrTo: number
  /** The opening marker. */
  m: number
  c0: number
  j: number
  e: number
}

function scan(S: Substitutor, w: Work, rule: Rule): Work {
  const text = w.s
  const n = text.length
  const { open, close, kind } = rule
  if (text.indexOf(open) < 0) return w
  const nextRB = new Next((k) => text.indexOf(']', k))
  const nextBracket = new Next((k) => text.indexOf('[', k))
  const nextOpen = new Next((k) => text.indexOf(open.charAt(0), k))
  const wordBefore = rule.wordBefore
  const forbid = rule.forbid
  const after = rule.after
  const closeLen = close.length

  const lookOk = (e: number) => {
    if (e >= n) return true
    const cp = cpAt(text, e)
    if (isWordCp(cp)) return false
    return !(after !== '' && cp < 128 && after.includes(String.fromCharCode(cp)))
  }
  // constrained: the first closing marker after `k` with a character other than white space before it and no word after
  const closer = new Next((k) => {
    for (let j = text.indexOf(close, k); j >= 0; j = text.indexOf(close, j + 1))
      if (isNonSpaceAt(text, j - 1) && lookOk(j + closeLen)) return j
    return -1
  })
  const closerUn = new Next((k) => text.indexOf(close, k))

  /** After the optional `[attrs]` at `t`: the opening marker. */
  const head = (t: number): { attrFrom: number; attrTo: number; m: number } | null => {
    let u = t
    let attrFrom = -1
    let attrTo = -1
    if (text.charCodeAt(t) === 91) {
      const rb = nextRB.at(t + 1)
      if (rb > t + 1) {
        attrFrom = t
        attrTo = rb + 1
        u = rb + 1
      }
    }
    return text.startsWith(open, u) ? { attrFrom, attrTo, m: u } : null
  }

  const supClose = (c0: number): number => {
    if (!isNonSpaceAt(text, c0)) return -1
    for (let k = c0 + 1; k < n; k++) {
      const c = text.charCodeAt(k)
      if (text.startsWith(close, k) && c === close.charCodeAt(0)) return k
      if (!isNonSpaceAt(text, k)) return -1
    }
    return -1
  }

  const finish = (
    s: number,
    prefix: number,
    esc: boolean,
    h: { attrFrom: number; attrTo: number; m: number },
  ): Found | null => {
    const c0 = h.m + open.length
    let j: number
    if (kind === 'con') {
      if (!isNonSpaceAt(text, c0)) return null
      j = closer.at(c0 + 1)
    } else if (kind === 'un') {
      j = c0 + 1 <= n ? closerUn.at(c0 + 1) : -1
    } else j = supClose(c0)
    if (j < 0) return null
    return { s, prefix, esc, attrFrom: h.attrFrom, attrTo: h.attrTo, m: h.m, c0, j, e: j + closeLen }
  }

  const tryAt = (s: number): Found | null => {
    if (kind === 'con') {
      if (s === 0 || text.charCodeAt(s - 1) === 10) {
        const h = head(s)
        if (h) {
          const f = finish(s, 0, false, h)
          if (f) return f
        }
      }
      if (s < n) {
        const cp = cpAt(text, s)
        const forbidden =
          (wordBefore && isWordCp(cp)) || (cp < 128 && forbid.includes(String.fromCharCode(cp)))
        if (!forbidden) {
          const len = cpLen(text, s)
          const h = head(s + len)
          if (h) return finish(s, len, cp === 92, h)
        }
      }
      return null
    }
    const esc = text.charCodeAt(s) === 92
    const h = head(esc ? s + 1 : s)
    return h ? finish(s, 0, esc, h) : null
  }

  let out: Out | null = null
  let cur = 0
  let pos = 0
  const track = w.a !== null
  while (pos < n) {
    const qo = nextOpen.at(pos)
    const qb = nextBracket.at(pos)
    const q = qo < 0 ? qb : qb < 0 ? qo : Math.min(qo, qb)
    if (q < 0) break
    // the starts that can reach the character at q: the one before it (a prefix or an escape) and itself
    let f: Found | null = null
    const s1 = q > 0 ? cpStartBefore(text, q) : q
    if (s1 >= pos && s1 < q) f = tryAt(s1)
    f ??= tryAt(q)
    if (!f) {
      pos = q + 1
      continue
    }
    out ??= new Out(track)
    emit(S, w, out, cur, rule, f)
    cur = f.e
    pos = f.e
  }
  if (!out) return w
  out.copy(w, cur, n)
  return out.finish()
}

function emit(S: Substitutor, w: Work, out: Out, cur: number, rule: Rule, f: Found): void {
  const track = w.a !== null
  const constrained = rule.kind === 'con'
  out.copy(w, cur, f.s)
  const attrList = f.attrFrom >= 0 ? w.s.slice(f.attrFrom + 1, f.attrTo - 1) : null
  if (f.esc) {
    // the backslash goes; a constrained quote keeps its attributes as text and is quoted without them
    if (track) S.node(Type.Escape, w.a![f.s]!, w.b![f.s]!, [])
    if (constrained && attrList !== null) {
      out.copy(w, f.attrFrom, f.attrTo)
      const [o, c] = quoteTags(rule.type, undefined, undefined)
      const cs = f.m
      out.gen(o, track ? w.a![cs]! : 0, track ? w.b![f.c0 - 1]! : 0)
      out.copy(w, f.c0, f.j)
      out.gen(c, track ? w.a![f.j]! : 0, track ? w.b![f.e - 1]! : 0)
      if (track) S.quoteNode(rule.nodeType, w, f.m, f.c0, f.j, f.e, -1, -1)
    } else out.copy(w, f.s + (constrained ? f.prefix : 1), f.e)
    return
  }
  out.copy(w, f.s, f.s + f.prefix)
  let id: string | undefined
  let role: string | undefined
  let type = rule.type
  if (attrList !== null) {
    const attrs = S.parseQuotedAttributes(attrList)
    id = attrs.id
    role = attrs.role
    if (type === 'mark') type = 'unquoted'
  }
  const [o, c] = quoteTags(type, id, role)
  const startAt = f.attrFrom >= 0 ? f.attrFrom : f.m
  if (track) {
    out.gen(o, w.a![startAt]!, w.b![f.c0 - 1]!)
    out.copy(w, f.c0, f.j)
    out.gen(c, w.a![f.j]!, w.b![f.e - 1]!)
    S.quoteNode(rule.nodeType, w, f.m, f.c0, f.j, f.e, f.attrFrom, f.attrTo)
  } else {
    out.gen(o, 0, 0)
    out.copy(w, f.c0, f.j)
    out.gen(c, 0, 0)
  }
}
