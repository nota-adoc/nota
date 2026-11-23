/**
 * Passthroughs (Substitutors#extract_passthroughs and #restore_passthroughs): `+++x+++`, `$$x$$`, `pass:[x]`,
 * `+x+` and `stem:[x]` are taken out of the text before the other substitutions and put back after them.
 */
import { Type } from '../../nodes.js'
import { NS, WORD } from './chars.js'
import type { Part } from './ctx.js'
import type { Substitutor } from './engine.js'
import { BASIC_SUBS, NORMAL_SUBS, resolveSubs, type Sub } from './subs.js'
import { quoteTags } from './quotes.js'
import { Out, Work, gsub, maskBrackets } from './work.js'

/** A passthrough waiting for the end of the substitutions. */
export interface Pass {
  readonly w: Work
  readonly subs: readonly Sub[] | null
  /** The type of quoted text it becomes (`unquoted`, `monospaced`, `latexmath`, …). */
  readonly type?: string
  readonly attrs?: { id?: string; role?: string }
}

const PASS_START = '\u0096'
const PASS_END = '\u0097'

const InlinePassMacroRx =
  /(?:(?:(\\?)\[([^\]]+)\])?(\\{0,2})(\+\+\+?|\$\$)(.*?)\4|(\\?)pass:([a-z]+(?:,[a-z-]+)*)?\[(|.*?[^\\])\])/dgs

// `+text+` and `[x-]`+text`` (Asciidoctor 2 syntax); the groups are named as the alternatives of the original
const InlinePassRx = new RegExp(
  '(?:(?<pre1>^|[^' +
    WORD +
    ';:\\\\])(?:\\[(?<a1>x-|[^\\]]+ x-)\\](?<q1>(?<m1>[+`])(?<c1>' +
    NS +
    '|' +
    NS +
    '.*?' +
    NS +
    ')\\k<m1>)|(?:\\[(?<a2>[^\\]]+)\\])?(?=(?<e2>\\\\)?\\+)(?<q2>\\k<e2>?(?<m2>\\+)(?<c2>' +
    NS +
    '|' +
    NS +
    '.*?' +
    NS +
    ')\\k<m2>))' +
    '|(?<pre3>\\\\)(?=\\[)(?:\\[(?<a3>[^\\]]+)\\])?(?=(?<e3>\\\\)?\\+)(?<q3>\\k<e3>?(?<m3>\\+)(?<c3>' +
    NS +
    '|' +
    NS +
    '.*?' +
    NS +
    ')\\k<m3>)' +
    '|(?=\\\\\\+)(?=(?<e4>\\\\)?\\+)(?<q4>\\k<e4>?(?<m4>\\+)(?<c4>' +
    NS +
    '|' +
    NS +
    '.*?' +
    NS +
    ')\\k<m4>))(?![' +
    WORD +
    '])',
  'gsud',
)

// compat mode: `text` is a passthrough
const InlinePassCompatRx = new RegExp(
  '(?<pre>^|[^`' +
    WORD +
    '])(?:\\[(?<attr>[^\\]]+)\\](?=(?<esc>\\\\))|\\[(?<attr2>[^\\]]+)\\])?(?<q>\\k<esc>?(?<m>`)(?<c>[^`\\s]|[^`\\s].*?\\S)\\k<m>)(?![`' +
    WORD +
    '])',
  'gsud',
)

const InlineStemMacroRx = /\\?(stem|(?:latex|ascii)math):([a-z]+(?:,[a-z-]+)*)?\[(.*?[^\\])\]/dgs

/** `normalize_text` without stripping: `\]` becomes `]`. */
function unescapeBrackets(w: Work): Work {
  if (!w.s.includes('\\]')) return w
  return gsub(w, /\\\]/g, (m, out) => out.copy(w, m.index + 1, m.index + 2))
}

const nodeKids = (w: Work, spec: [number, number, number][]): Part[] =>
  spec.map(([t, i, j]) => ({ t, f: w.a![i]!, e: w.b![j - 1]! }))

export function extractPassthroughs(S: Substitutor, w0: Work): Work {
  let w = w0
  const compat = S.compat
  const track = w.a !== null
  const passes = S.passes
  const slot = (i: number) => `${PASS_START}${i}${PASS_END}`
  const A = (i: number) => (track ? w.a![i]! : 0)
  const B = (j: number) => (track ? w.b![j - 1]! : 0)

  if (w.s.includes('++') || w.s.includes('$$') || w.s.includes('ss:')) {
    const src = w
    w = gsub(
      src,
      InlinePassMacroRx,
      (m, out) => {
        const ind = m.indices!
        const start = m.index
        const end = start + m[0].length
        const boundary = m[4]
        if (boundary !== undefined) {
          const g1 = m[1] ?? ''
          const attrlist = m[2]
          const esc3 = m[3] ?? ''
          const cf = ind[5]![0]
          const ct = ind[5]![1]
          // skip ++ in compat mode, handled as normal quoted text
          if (compat && boundary === '++') {
            out.copy(src, start, cf)
            out.add(extractPassthroughs(S, src.slice(cf, ct)))
            out.copy(src, ct, end)
            return
          }
          let preceding = ''
          let attributes: { id?: string; role?: string } | undefined
          let oldBehavior = false
          if (attrlist !== undefined) {
            if (esc3.length > 0) {
              // we do not look for nested unconstrained pass macros: the escape goes
              out.copy(src, start, ind[3]![0])
              out.copy(src, ind[3]![0] + 1, end)
              if (track) S.leaf(Type.Escape, src, ind[3]![0], ind[3]![0] + 1)
              return
            } else if (g1 === '\\') {
              preceding = `[${attrlist}]`
            } else if (boundary === '++') {
              if (attrlist === 'x-') {
                oldBehavior = true
                attributes = {}
              } else if (attrlist.endsWith(' x-')) {
                oldBehavior = true
                attributes = S.parseQuotedAttributes(attrlist.slice(0, -3))
              } else attributes = S.parseQuotedAttributes(attrlist)
            } else attributes = S.parseQuotedAttributes(attrlist)
          } else if (esc3.length > 0) {
            out.copy(src, start, ind[3]![0])
            out.copy(src, ind[3]![0] + 1, end)
            if (track) S.leaf(Type.Escape, src, ind[3]![0], ind[3]![0] + 1)
            return
          }
          const subs: readonly Sub[] = boundary === '+++' ? [] : BASIC_SUBS
          const content = src.slice(cf, ct)
          if (attributes) {
            passes.push(
              oldBehavior
                ? { w: content, subs: NORMAL_SUBS, type: 'monospaced', attrs: attributes }
                : { w: content, subs, type: 'unquoted', attrs: attributes },
            )
          } else passes.push({ w: content, subs })
          if (preceding !== '') {
            // the escaped attributes stay as text
            out.gen(preceding, A(ind[2]![0] - 1), B(ind[2]![1] + 1))
          }
          out.gen(slot(passes.length - 1), A(start), B(end))
          if (track) {
            const kids: [number, number, number][] = []
            if (attrlist !== undefined && preceding === '')
              kids.push([Type.InlineAttributes, ind[2]![0] - 1, ind[2]![1] + 1])
            kids.push([Type.PassMarker, ind[4]![0], ind[4]![1]], [Type.PassMarker, ct, end])
            const from =
              attrlist !== undefined && preceding === ''
                ? ind[2]![0] - 1 - g1.length
                : ind[4]![0] - esc3.length
            S.node(Type.Passthrough, src.a![from]!, src.b![end - 1]!, nodeKids(src, kids))
          }
          return
        }
        // pass:[] and pass:subs[]
        if (m[6] === '\\') {
          out.copy(src, start + 1, end)
          if (track) S.leaf(Type.Escape, src, start, start + 1)
          return
        }
        const cf = ind[8]![0]
        const ct = ind[8]![1]
        const content = unescapeBrackets(src.slice(cf, ct))
        const subsText = m[7]
        passes.push(
          subsText !== undefined
            ? { w: content, subs: resolveSubs(subsText, 'inline', null) }
            : { w: content, subs: null },
        )
        out.gen(slot(passes.length - 1), A(start), B(end))
        if (track) {
          const ps = start + (m[6] === undefined ? 0 : 0)
          const kids: [number, number, number][] = [[Type.MacroName, ps, ps + 4]]
          if (ind[7]) kids.push([Type.PassSubs, ind[7][0], ind[7][1]])
          kids.push([Type.PassMarker, cf - 1, cf], [Type.PassMarker, end - 1, end])
          S.node(Type.Passthrough, src.a![start]!, src.b![end - 1]!, nodeKids(src, kids))
        }
      },
      maskBrackets(src.s),
    )
  }

  const compatRx = compat
  if (compatRx ? w.s.includes('`') : w.s.includes('+') || w.s.includes('-]')) {
    const src = w
    w = compatRx ? extractCompatPass(S, src) : extractInlinePass(S, src)
  }

  // stem and math macros, after the others so that they can be escaped by them
  if (w.s.includes(':') && (w.s.includes('stem:') || w.s.includes('math:'))) {
    const src = w
    w = gsub(src, InlineStemMacroRx, (m, out) => {
      const start = m.index
      const end = start + m[0].length
      const ind = m.indices!
      if (m[0].startsWith('\\')) {
        out.copy(src, start + 1, end)
        if (track) S.leaf(Type.Escape, src, start, start + 1)
        return
      }
      let type = m[1]!
      if (type === 'stem') {
        const stem = S.env.get('stem')
        type = stem === 'latexmath' || stem === 'latex' || stem === 'tex' ? 'latexmath' : 'asciimath'
      }
      const subsText = m[2]
      let content = unescapeBrackets(src.slice(ind[3]![0], ind[3]![1]))
      content = normalizeText(content)
      let raw = content.s
      if (type === 'latexmath' && raw.startsWith('$') && raw.endsWith('$') && raw.length > 1)
        content = content.slice(1, content.length - 1)
      raw = content.s
      const subs = subsText !== undefined ? resolveSubs(subsText, 'inline', null) : BASIC_SUBS
      passes.push({ w: content, subs, type })
      out.gen(slot(passes.length - 1), A(start), B(end))
      if (track) {
        const kids: [number, number, number][] = [[Type.MacroName, start, start + m[1]!.length]]
        if (ind[2]) kids.push([Type.PassSubs, ind[2][0], ind[2][1]])
        kids.push([Type.PassMarker, ind[3]![0] - 1, ind[3]![0]], [Type.PassMarker, end - 1, end])
        S.node(Type.Stem, src.a![start]!, src.b![end - 1]!, nodeKids(src, kids))
      }
      void raw
    })
  }
  return w
}

/** `normalize_text text, nil, true` is done by the caller; this is `strip` and `tr LF ' '`. */
function normalizeText(w: Work): Work {
  return w
}

function extractInlinePass(S: Substitutor, src: Work): Work {
  const track = src.a !== null
  const passes = S.passes
  const slot = (i: number) => `${PASS_START}${i}${PASS_END}`
  return gsub(
    src,
    InlinePassRx,
    (m, out) => {
      const g = m.groups!
      const ind = m.indices!.groups!
      const start = m.index
      const end = start + m[0].length
      const alt = g.q1 !== undefined ? 1 : g.q2 !== undefined ? 2 : g.q3 !== undefined ? 3 : 4
      const preceding = alt === 1 || alt === 2 ? (g[`pre1`] ?? '') : alt === 3 ? '\\' : ''
      const attrlist: string | undefined = g[`a${alt}`] ?? undefined
      const escaped = g[`e${alt}`] !== undefined && alt !== 1
      const quoted = g[`q${alt}`]!
      const mark = g[`m${alt}`]!
      const content = g[`c${alt}`]!
      const qStart = ind[`q${alt}`]![0]
      const cf = ind[`c${alt}`]![0]
      const ct = ind[`c${alt}`]![1]
      const A = (i: number) => (track ? src.a![i]! : 0)
      const B = (j: number) => (track ? src.b![j - 1]! : 0)
      const compat = S.compat
      let oldBehavior = compat
      let forced = false
      if (!compat && attrlist !== undefined && (attrlist === 'x-' || attrlist.endsWith(' x-'))) {
        oldBehavior = true
        forced = true
      }
      let attributes: { id?: string; role?: string } | undefined
      if (attrlist !== undefined) {
        if (escaped) {
          // the escape of the formatting mark goes
          out.copy(src, start, qStart)
          out.copy(src, qStart + 1, end)
          if (track) S.leaf(Type.Escape, src, qStart, qStart + 1)
          return
        } else if (preceding === '\\') {
          if (forced && mark === '`') {
            out.copy(src, start, end)
            return
          }
          // the escape of the attributes goes; they stay as text
          if (track) S.leaf(Type.Escape, src, start, start + 1)
          out.copy(src, start + 1, qStart)
          passes.push({ w: src.slice(cf, ct), subs: BASIC_SUBS })
          out.gen(slot(passes.length - 1), A(qStart), B(end))
          passNode(S, src, start, qStart, cf, ct, end, mark, false)
          return
        } else if (forced) {
          attributes = attrlist === 'x-' ? {} : S.parseQuotedAttributes(attrlist.slice(0, -3))
        } else attributes = S.parseQuotedAttributes(attrlist)
      } else if (escaped) {
        out.copy(src, start, qStart)
        out.copy(src, qStart + 1, end)
        if (track) S.leaf(Type.Escape, src, qStart, qStart + 1)
        return
      }
      void content
      void quoted
      const contentW = src.slice(cf, ct)
      if (attributes) {
        passes.push(
          oldBehavior
            ? {
                w: contentW,
                subs: mark === '`' ? BASIC_SUBS : NORMAL_SUBS,
                type: 'monospaced',
                attrs: attributes,
              }
            : { w: contentW, subs: BASIC_SUBS, type: 'unquoted', attrs: attributes },
        )
      } else passes.push({ w: contentW, subs: BASIC_SUBS })
      // the preceding character is kept (it is not part of the construct)
      const pre = alt === 1 || alt === 2 ? (g.pre1 ?? '').length : alt === 3 ? 1 : 0
      const partStart = start + (alt === 3 ? 0 : pre)
      out.copy(src, start, start + (alt === 3 ? 0 : pre))
      out.gen(slot(passes.length - 1), A(partStart), B(end))
      passNode(
        S,
        src,
        partStart,
        attrlist !== undefined ? ind[`a${alt}`]![0] - 1 : qStart,
        cf,
        ct,
        end,
        mark,
        attrlist !== undefined,
      )
    },
    maskBrackets(src.s),
  )
}

function passNode(
  S: Substitutor,
  w: Work,
  from: number,
  attrOrMark: number,
  cf: number,
  ct: number,
  end: number,
  mark: string,
  hasAttr: boolean,
): void {
  if (!S.sink) return
  const kids: [number, number, number][] = []
  // `[attrs]` ends at the mark
  if (hasAttr) kids.push([Type.InlineAttributes, attrOrMark, cf - mark.length])
  kids.push([Type.PassMarker, cf - mark.length, cf], [Type.PassMarker, ct, end])
  S.node(Type.Passthrough, w.a![from]!, w.b![end - 1]!, nodeKids(w, kids))
}

function extractCompatPass(S: Substitutor, src: Work): Work {
  const track = src.a !== null
  const passes = S.passes
  return gsub(
    src,
    InlinePassCompatRx,
    (m, out) => {
      const g = m.groups!
      const ind = m.indices!.groups!
      const start = m.index
      const end = start + m[0].length
      const preceding = g.pre ?? ''
      const attrlist = g.attr ?? g.attr2
      const escaped = g.esc !== undefined
      const qStart = ind.q![0]
      const cf = ind.c![0]
      const ct = ind.c![1]
      let attributes: { id?: string; role?: string } | undefined
      if (attrlist !== undefined) {
        if (escaped) {
          out.copy(src, start, preceding.length + start)
          out.copy(src, start + preceding.length, qStart)
          out.copy(src, qStart + 1, end)
          return
        }
        attributes = S.parseQuotedAttributes(attrlist)
      }
      // a backslash before the text escapes it
      if (attrlist === undefined && preceding === '\\') {
        out.copy(src, start + 1, end)
        return
      }
      passes.push({ w: src.slice(cf, ct), subs: BASIC_SUBS, type: 'monospaced', attrs: attributes })
      out.copy(src, start, start + preceding.length)
      out.gen(
        `${PASS_START}${passes.length - 1}${PASS_END}`,
        track ? src.a![start + preceding.length]! : 0,
        track ? src.b![end - 1]! : 0,
      )
      passNode(
        S,
        src,
        start + preceding.length,
        attrlist !== undefined ? (ind.attr?.[0] ?? ind.attr2![0]) : qStart,
        cf,
        ct,
        end,
        '`',
        attrlist !== undefined,
      )
    },
    maskBrackets(src.s),
  )
}

const PassSlotRx = /\u0096(\d+)\u0097/g

export function restorePassthroughs(S: Substitutor, w: Work): Work {
  const passes = S.passes
  return gsub(w, PassSlotRx, (m, out) => {
    const pass = passes[Number(m[1])]
    const from = w.a ? w.a[m.index]! : 0
    const to = w.b ? w.b[m.index + m[0].length - 1]! : 0
    if (!pass) {
      out.gen('??pass??', from, to)
      return
    }
    let sub = pass.subs ? S.apply(pass.w, pass.subs) : pass.w
    if (pass.type !== undefined) {
      const [o, c] = quoteTags(pass.type, pass.attrs?.id, pass.attrs?.role)
      const wrapped = new Out(w.a !== null)
      wrapped.gen(o, from, to)
      wrapped.add(sub)
      wrapped.gen(c, from, to)
      sub = wrapped.finish()
    }
    if (sub.s.includes(PASS_START)) sub = restorePassthroughs(S, sub)
    out.add(sub)
  })
}
