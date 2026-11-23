/** The macros substitution (Substitutors#sub_macros): links, images, cross references, footnotes and the rest. */
import { Type } from '../../nodes.js'
import { type AttributeItem, parseAttributeList } from '../attrlist.js'
import { ALNUM, ALPHA, WORD } from './chars.js'
import type { Part } from './ctx.js'
import type { Substitutor } from './engine.js'
import {
  anchorHtml,
  bibrefHtml,
  buttonHtml,
  footnoteHtml,
  imageHtml,
  kbdHtml,
  linkHtml,
  menuHtml,
  xrefHtml,
  xrefPathHtml,
} from './html.js'
import { restorePassthroughs } from './pass.js'
import { NORMAL_SUBS } from './subs.js'
import { Out, Work, gsub, gsubFound, maskBrackets } from './work.js'
import { scanAnchors } from './anchors.js'

const SPC = ' \\t\\n\\v\\f\\r'
const BOL = '(?<![^\\n])'

const KbdBtnRx = /(\\)?(kbd|btn):\[(.*?[^\\])\]/dgs
const MenuMacroRx = new RegExp(
  `\\\\?menu:([${WORD}]|[${WORD}&][^\\n\\[]*[^${SPC}\\[])\\[ *(?:|(.*?[^\\\\]))\\]`,
  'gsud',
)
const MenuRx = new RegExp(`\\\\?"([${WORD}&][^"]*?[ \\n]+&gt;[ \\n]+[^"]*)"`, 'gud')
const ImageMacroRx = new RegExp(
  `\\\\?i(?:mage|con):([^:${SPC}\\[](?:[^\\n\\[]*[^${SPC}\\[])?)\\[(|.*?[^\\\\])\\]`,
  'gsd',
)
const IndextermRx = /\\?(?:(indexterm2?):\[(.*?[^\\])\]|\(\((.+?)\)\)(?!\)))/dgs
const LinkRx = new RegExp(
  `(${BOL}|link:|[\\p{Zs}\\t]|\\\\?&lt;(?=\\\\?(?:https?|file|ftp|irc)(:))|[>()\\[\\];"'])(\\\\?(?:https?|file|ftp|irc)://)(?:([^${SPC}\\[\\]]+)\\[(|.*?[^\\\\])\\]|(?!\\2)([^${SPC}]+?)&gt;|([^${SPC}\\[\\]<]*([^${SPC},.?!\\[\\]<)])))`,
  'gsud',
)
const LinkMacroRx = new RegExp(
  `\\\\?(?:link|(mailto)):(|[^:${SPC}\\[][^${SPC}\\[]*)\\[(|.*?[^\\\\])\\]`,
  'gsd',
)
const EmailRx = new RegExp(
  `([\\\\>:/])?[${WORD}](?:&amp;|[${WORD}\\-.%+])*@[${ALNUM}][${ALNUM}_\\-.]*\\.[a-zA-Z]{2,5}(?![${WORD}])`,
  'gud',
)
const BiblioAnchorRx = new RegExp(`${BOL}\\[\\[\\[([${ALPHA}_:][${WORD}\\-:.]*)(?:, *(.+?))?\\]\\]\\]`, 'sud')
const XrefRx = new RegExp(
  `\\\\?(?:&lt;&lt;([${WORD}#/.:{].*?)&gt;&gt;|xref:([${WORD}#/.:{].*?)\\[(?:\\]|(.*?[^\\\\])\\]))`,
  'gsud',
)
const FootnoteRx = new RegExp(
  `\\\\?footnote(?:(ref):|:([${WORD}-]+)?)\\[(?:|(.*?[^\\\\]))\\](?!</a>)`,
  'gsud',
)

const ASCIIDOC_EXTENSIONS = ['.adoc', '.asciidoc', '.asc', '.ad', '.txt']

/** `Helpers.extname?`. */
function hasExtname(path: string): boolean {
  const dot = path.lastIndexOf('.')
  return dot >= 0 && path.indexOf('/', dot) < 0
}

/** `Helpers.basename(path, true)`: the last segment of the path without its extension (a dot file has none). */
function rubyBasenameNoExt(path: string): string {
  if (/^\/+$/.test(path)) return '/'
  const trimmed = path.replace(/\/+$/, '')
  const base = trimmed.slice(trimmed.lastIndexOf('/') + 1)
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(0, dot) : base
}

/** `normalize_text`: strip and fold line feeds (`ws`), unescape `\]` (`unescape`). */
function normalizeText(text: string, ws: boolean, unescape: boolean): string {
  if (text === '') return text
  if (ws) text = text.trim().replaceAll('\n', ' ')
  if (unescape && text.includes(']')) text = text.replaceAll('\\]', ']')
  return text
}

/** Attributes of a list as AttributeList#parse gives them: positional ones by number and by name. */
export type Attrs = Map<string, string | null>

/** AttributeList#parse; `S` supplies the substitutions for single-quoted values when given. */
export function parseAttrs(source: string, posattrs: readonly string[], S: Substitutor | null): Attrs {
  const attrs: Attrs = new Map()
  for (const it of parseAttributeList(source)) attrOf(attrs, it, posattrs, S)
  return attrs
}

function attrOf(attrs: Attrs, it: AttributeItem, posattrs: readonly string[], S: Substitutor | null): void {
  if (it.name !== undefined) {
    const value = it.value ?? ''
    const name = it.name
    if (name === 'options' || name === 'opts') {
      const list = value.includes(',') ? value.replaceAll(' ', '').split(',') : [value]
      for (const opt of list) if (opt !== '') attrs.set(`${opt}-option`, '')
    } else if (it.singleQuoted && S) {
      attrs.set(name, name === 'title' || name === 'reftext' ? value : S.applyString(value, NORMAL_SUBS))
    } else attrs.set(name, value)
    return
  }
  let name = it.value
  if (it.singleQuoted && S && name !== null) name = S.applyString(name, NORMAL_SUBS)
  const p = posattrs[it.index]
  if (p !== undefined && name !== null) attrs.set(p, name)
  attrs.set(String(it.index + 1), name)
}

/** Substitutors#extract_attributes_from_text. */
function extractAttributes(S: Substitutor, text: string, defaultText: string | null): [string | null, Attrs] {
  const attrlist = text.includes('\n') ? text.replaceAll('\n', ' ') : text
  const attrs = parseAttrs(attrlist, [], S)
  const resolved = attrs.get('1')
  if (resolved !== undefined && resolved !== null) {
    if (resolved === attrlist) {
      attrs.clear()
      return [text, attrs]
    }
    return [resolved, attrs]
  }
  return [defaultText, attrs]
}

const strOf = (attrs: Attrs): Record<string, string | undefined> => {
  const o: Record<string, string | undefined> = {}
  for (const [k, v] of attrs) if (v !== null) o[k] = v
  return o
}

/** The attribute items of a macro's attribute list as parts (positional and named attributes). */
export function attributeParts(source: string, base: number): Part[] {
  const parts: Part[] = []
  for (const item of parseAttributeList(source)) {
    if (item.to <= item.from) continue
    if (item.name !== undefined) {
      parts.push({ t: Type.NamedAttribute, f: base + item.from, e: base + item.to })
      parts.push({ t: Type.AttributeName, f: base + item.nameFrom!, e: base + item.nameTo! })
      if (item.valueTo! > item.valueFrom!)
        parts.push({ t: Type.AttributeValue, f: base + item.valueFrom!, e: base + item.valueTo! })
    } else parts.push({ t: Type.PositionalAttribute, f: base + item.from, e: base + item.to })
  }
  return parts
}

export function subMacros(S: Substitutor, w0: Work): Work {
  let w = w0
  const env = S.env
  const track = w.a !== null
  const foundSquare = w.s.includes('[')
  const foundColon = w.s.includes(':')
  const foundMacroish = foundSquare && foundColon
  const foundMacroishShort = foundMacroish && w.s.includes(':[')
  const compat = S.compat

  const P = (w: Work, t: number, i: number, j: number): Part =>
    track ? { t, f: w.a![i]!, e: w.b![j - 1]! } : { t, f: 0, e: 0 }
  const A = (w: Work, i: number) => (track ? w.a![i]! : 0)
  const B = (w: Work, j: number) => (track ? w.b![j - 1]! : 0)
  const icons = env.get('icons')

  if (env.get('experimental') !== undefined) {
    if (foundMacroishShort && (w.s.includes('kbd:') || w.s.includes('btn:'))) {
      const src = w
      w = gsub(src, KbdBtnRx, (m, out) => {
        const start = m.index
        const end = start + m[0].length
        const ind = m.indices!
        if (m[1] !== undefined) {
          out.copy(src, start + 1, end)
          if (track) S.leaf(Type.Escape, src, start, start + 1)
          return
        }
        let html: string
        if (m[2] === 'kbd') {
          let keys = m[3]!.trim()
          if (keys.includes(']')) keys = keys.replaceAll('\\]', ']')
          let list: string[]
          let delimIdx = -1
          if (keys.length > 1) {
            const comma = keys.indexOf(',', 1)
            const plus = keys.indexOf('+', 1)
            delimIdx = comma >= 0 ? (plus >= 0 ? Math.min(comma, plus) : comma) : plus
          }
          if (delimIdx >= 0) {
            const delim = keys.charAt(delimIdx)
            if (keys.endsWith(delim)) {
              list = keys
                .slice(0, -1)
                .split(delim)
                .map((k) => k.trim())
              list[list.length - 1] += delim
            } else list = keys.split(delim).map((k) => k.trim())
          } else list = [keys]
          html = kbdHtml(list)
        } else html = buttonHtml(normalizeText(m[3]!, true, true))
        out.gen(html, A(src, start), B(src, end))
        if (track)
          S.node(m[2] === 'kbd' ? Type.Kbd : Type.Button, src.a![start]!, src.b![end - 1]!, [
            P(src, Type.MacroName, start, start + 3),
            P(src, Type.MacroText, ind[3]![0], ind[3]![1]),
          ])
      })
    }
    if (foundMacroish && w.s.includes('menu:')) {
      const src = w
      w = gsub(src, MenuMacroRx, (m, out) => {
        const start = m.index
        const end = start + m[0].length
        if (m[0].startsWith('\\')) {
          out.copy(src, start + 1, end)
          if (track) S.leaf(Type.Escape, src, start, start + 1)
          return
        }
        const menu = m[1]!
        let submenus: string[] = []
        let menuitem: string | null = null
        let items = m[2]
        if (items !== undefined) {
          if (items.includes(']')) items = items.replaceAll('\\]', ']')
          const delim = items.includes('&gt;') ? '&gt;' : items.includes(',') ? ',' : null
          if (delim) {
            submenus = items.split(delim).map((s) => s.trim())
            menuitem = submenus.pop()!
          } else menuitem = items.trimEnd()
        }
        out.gen(menuHtml(menu, submenus, menuitem, icons), A(src, start), B(src, end))
        if (track) {
          const ind = m.indices!
          S.node(Type.Menu, src.a![start]!, src.b![end - 1]!, [
            P(src, Type.MacroName, start, start + 4),
            P(src, Type.MacroTarget, ind[1]![0], ind[1]![1]),
            ...(ind[2] ? [P(src, Type.MacroText, ind[2][0], ind[2][1])] : []),
          ])
        }
      })
    }
    if (w.s.includes('"') && w.s.includes('&gt;')) {
      const src = w
      w = gsub(src, MenuRx, (m, out) => {
        const start = m.index
        const end = start + m[0].length
        if (m[0].startsWith('\\')) {
          out.copy(src, start + 1, end)
          if (track) S.leaf(Type.Escape, src, start, start + 1)
          return
        }
        const parts = m[1]!.split('&gt;').map((s) => s.trim())
        const [menu, ...subs] = parts
        const menuitem = subs.pop()!
        out.gen(menuHtml(menu!, subs, menuitem, icons), A(src, start), B(src, end))
        if (track) S.node(Type.Menu, src.a![start]!, src.b![end - 1]!, [])
      })
    }
  }

  if (foundMacroish && (w.s.includes('image:') || w.s.includes('icon:'))) {
    const src = w
    w = gsub(src, ImageMacroRx, (m, out) => {
      const start = m.index
      const end = start + m[0].length
      const ind = m.indices!
      if (m[0].startsWith('\\')) {
        out.copy(src, start + 1, end)
        if (track) S.leaf(Type.Escape, src, start, start + 1)
        return
      }
      const icon = m[0].startsWith('icon:')
      const target = m[1]!
      const attrs = parseAttrs(
        normalizeText(m[2]!, true, true),
        icon ? ['size'] : ['alt', 'width', 'height'],
        null,
      )
      if (!attrs.has('alt') || attrs.get('alt') === null) {
        const base = rubyBasenameNoExt(target)
        attrs.set('default-alt', base.replace(/[_-]/g, ' '))
        attrs.set('alt', base.replace(/[_-]/g, ' '))
      }
      if (!icon && env.get('imagesdir') !== undefined) attrs.set('imagesdir', env.get('imagesdir')!)
      const html = imageHtml(
        icon ? 'icon' : 'image',
        target,
        attrs.get('alt')!,
        strOf(attrs),
        icons,
        (t) => (env.imageUri ? env.imageUri(t) : t),
        (t) => (env.iconUri ? env.iconUri(t) : t),
      )
      out.gen(html, A(src, start), B(src, end))
      if (track) {
        const kids: Part[] = [
          P(src, Type.MacroName, start, start + 5),
          P(src, Type.MacroTarget, ind[1]![0], ind[1]![1]),
        ]
        if (
          ind[2]![1] > ind[2]![0] &&
          src.b![ind[2]![1] - 1]! - src.a![ind[2]![0]]! === ind[2]![1] - ind[2]![0]
        )
          kids.push(...attributeParts(m[2]!, src.a![ind[2]![0]]!))
        S.node(Type.InlineImage, src.a![start]!, src.b![end - 1]!, kids)
      }
    })
  }

  if ((w.s.includes('((') && w.s.includes('))')) || (foundMacroishShort && w.s.includes('dexterm'))) {
    const src = w
    w = gsub(src, IndextermRx, (m, out) => {
      const start = m.index
      const end = start + m[0].length
      const ind = m.indices!
      const escaped = m[0].startsWith('\\')
      let html: string
      const node = (t: number, kids: Part[]) => {
        if (track) S.node(t, src.a![start + (escaped ? 1 : 0)]!, src.b![end - 1]!, kids)
      }
      if (m[1] !== undefined) {
        if (escaped) {
          out.copy(src, start + 1, end)
          if (track) S.leaf(Type.Escape, src, start, start + 1)
          return
        }
        if (m[1] === 'indexterm') {
          const attrlist = normalizeText(m[2]!, true, true)
          // a concealed index term shows nothing
          void attrlist
          html = ''
        } else {
          let term = normalizeText(m[2]!, true, true)
          if (term.includes('=')) {
            const attrs = parseAttrs(term, [], null)
            const first = attrs.get('1')
            term = first !== undefined && first !== null ? first : term
          }
          html = term
        }
        out.gen(html, A(src, start), B(src, end))
        node(Type.IndexTerm, [
          P(src, Type.MacroName, start, start + m[1].length),
          P(src, Type.MacroText, ind[2]![0], ind[2]![1]),
        ])
        return
      }
      let encl = m[3]!
      let before = ''
      let after = ''
      let visible: boolean
      if (escaped) {
        if (encl.startsWith('(') && encl.endsWith(')')) {
          encl = encl.slice(1, -1)
          visible = true
          before = '('
          after = ')'
        } else {
          out.copy(src, start + 1, end)
          if (track) S.leaf(Type.Escape, src, start, start + 1)
          return
        }
      } else {
        visible = true
        if (encl.startsWith('(')) {
          if (encl.endsWith(')')) {
            encl = encl.slice(1, -1)
            visible = false
          } else {
            encl = encl.slice(1)
            before = '('
          }
        } else if (encl.endsWith(')')) {
          encl = encl.slice(0, -1)
          after = ')'
        }
      }
      if (visible) {
        let term = normalizeText(encl, true, false)
        if (term.includes(';&')) {
          if (term.includes(' &gt;&gt; ')) term = term.slice(0, term.indexOf(' &gt;&gt; '))
          else if (term.includes(' &amp;&gt; ')) term = term.split(' &amp;&gt; ')[0]!
        }
        html = `${before}${term}${after}`
      } else html = `${before}${after}`
      out.gen(html, A(src, start), B(src, end))
      node(Type.IndexTerm, [P(src, Type.MacroText, ind[3]![0], ind[3]![1])])
    })
  }

  if (foundColon && w.s.includes('://')) {
    const src = w
    w = gsub(
      src,
      LinkRx,
      (m, out) => {
        const start = m.index
        const end = start + m[0].length
        const ind = m.indices!
        const g1 = m[1]!
        const g3 = m[3]!
        const hide = env.get('hide-uri-scheme') !== undefined
        const uriSniff = /^[\p{Alphabetic}][\p{Alphabetic}\p{Nd}.+-]+:\/{0,2}/u
        const A0 = A(src, start)
        const B0 = B(src, end)
        if (m[2] !== undefined && m[5] === undefined) {
          // honor the escapes
          if (g1.startsWith('\\')) {
            out.copy(src, start + 1, end)
            if (track) S.leaf(Type.Escape, src, start, start + 1)
            return
          }
          if (g3.startsWith('\\')) {
            out.copy(src, start, start + g1.length)
            out.copy(src, start + g1.length + 1, end)
            if (track) S.leaf(Type.Escape, src, start + g1.length, start + g1.length + 1)
            return
          }
          if (m[6] === undefined) {
            out.copy(src, start, end)
            return
          }
          const target = g3 + m[6]
          const text = hide ? target.replace(uriSniff, '') : target
          out.gen(linkHtml(target, text, undefined, { role: 'bare' }), A0, B0)
          if (track)
            S.node(Type.Link, src.a![start]!, src.b![end - 1]!, [
              P(src, Type.MacroTarget, start + g1.length, start + g1.length + g3.length + m[6].length),
            ])
          return
        }
        // honor the escape
        if (g3.startsWith('\\')) {
          out.copy(src, start, start + g1.length)
          out.copy(src, start + g1.length + 1, end)
          if (track) S.leaf(Type.Escape, src, start + g1.length, start + g1.length + 1)
          return
        }
        let prefix = g1
        let target = g3 + (m[4] ?? m[7]!)
        let suffix = ''
        let linkText: string | null = null
        let formal = false
        if (m[5] !== undefined) {
          formal = true
          if (prefix === 'link:') prefix = ''
          linkText = m[5]
          if (linkText === '') linkText = null
        } else {
          if (prefix === 'link:' || prefix === '"' || prefix === "'") {
            out.copy(src, start, end)
            return
          }
          const last = m[8]
          if (last === ';') {
            target = target.slice(0, -1)
            if (target.endsWith(')')) {
              target = target.slice(0, -1)
              suffix = ');'
            } else suffix = ';'
            if (target === g3) {
              out.copy(src, start, end)
              return
            }
          } else if (last === ':') {
            target = target.slice(0, -1)
            if (target.endsWith(')')) {
              target = target.slice(0, -1)
              suffix = '):'
            } else suffix = ':'
            if (target === g3) {
              out.copy(src, start, end)
              return
            }
          }
        }
        let attrs: Attrs | null = null
        let id: string | undefined
        let bare = false
        if (linkText !== null) {
          let newText: string | null = linkText
          if (linkText.includes(']')) newText = linkText = linkText.replaceAll('\\]', ']')
          if (!compat && linkText.includes('=')) {
            const [t, a] = extractAttributes(S, linkText, '')
            linkText = t!
            newText = linkText
            attrs = a
            id = a.get('id') ?? undefined
          }
          if (linkText.endsWith('^')) {
            newText = linkText = linkText.slice(0, -1)
            attrs ??= new Map()
            if (!attrs.has('window')) attrs.set('window', '_blank')
          }
          if (newText !== null && newText === '') {
            linkText = hide ? target.replace(uriSniff, '') : target
            bare = true
          }
        } else {
          linkText = hide ? target.replace(uriSniff, '') : target
          bare = true
        }
        if (bare) {
          attrs ??= new Map()
          attrs.set('role', attrs.has('role') ? `bare ${attrs.get('role')}` : 'bare')
        }
        const html = linkHtml(target, linkText, id, attrs ? strOf(attrs) : {})
        // what the prefix kept goes first, the suffix last
        emitLink(out, src, start, end, g1, prefix, html, suffix, A0, B0)
        if (track) {
          const tf = start + g1.length
          const kids: Part[] = [
            P(src, Type.MacroTarget, tf, tf + (formal ? g3.length + (m[4] ?? '').length : target.length)),
          ]
          if (g1 === 'link:') kids.unshift(P(src, Type.MacroName, start, start + 4))
          if (formal && ind[5]) kids.push(P(src, Type.MacroText, ind[5][0], ind[5][1]))
          const nodeFrom = src.a![g1 === 'link:' ? start : tf]!
          const nodeTo = src.b![(suffix ? end - suffix.length : end) - 1]!
          S.node(Type.Link, nodeFrom, nodeTo, kids)
        }
      },
      w.s,
    )
  }

  if (foundMacroish && (w.s.includes('link:') || w.s.includes('ilto:'))) {
    const src = w
    w = gsub(src, LinkMacroRx, (m, out) => {
      const start = m.index
      const end = start + m[0].length
      const ind = m.indices!
      if (m[0].startsWith('\\')) {
        out.copy(src, start + 1, end)
        if (track) S.leaf(Type.Escape, src, start, start + 1)
        return
      }
      const mailto = m[1] !== undefined
      let target: string
      let mailtoText = ''
      if (mailto) {
        mailtoText = m[2]!
        target = `mailto:${mailtoText}`
      } else target = m[2]!
      let attrs: Attrs | null = null
      let id: string | undefined
      let linkText = m[3]!
      if (linkText !== '') {
        if (linkText.includes(']')) linkText = linkText.replaceAll('\\]', ']')
        if (mailto) {
          if (!compat && linkText.includes(',')) {
            const [t, a] = extractAttributes(S, linkText, '')
            linkText = t!
            attrs = a
            id = a.get('id') ?? undefined
            if (a.has('2')) {
              // (a lone surrogate would make encodeURIComponent throw: it is written as U+FFFD)
              const enc = (v: string | null) =>
                encodeURIComponent((v ?? '').replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, '\ufffd')).replace(
                  /[!'()*]/g,
                  (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
                )
              target = a.has('3')
                ? `${target}?subject=${enc(a.get('2')!)}&amp;body=${enc(a.get('3')!)}`
                : `${target}?subject=${enc(a.get('2')!)}`
            }
          }
        } else if (!compat && linkText.includes('=')) {
          const [t, a] = extractAttributes(S, linkText, '')
          linkText = t!
          attrs = a
          id = a.get('id') ?? undefined
        }
        if (linkText.endsWith('^')) {
          linkText = linkText.slice(0, -1)
          attrs ??= new Map()
          if (!attrs.has('window')) attrs.set('window', '_blank')
        }
      }
      if (linkText === '') {
        if (mailto) linkText = mailtoText
        else {
          if (env.get('hide-uri-scheme') !== undefined) {
            linkText = target.replace(/^[\p{Alphabetic}][\p{Alphabetic}\p{Nd}.+-]+:\/{0,2}/u, '')
            if (linkText === '') linkText = target
          } else linkText = target
          attrs ??= new Map()
          attrs.set('role', attrs.has('role') ? `bare ${attrs.get('role')}` : 'bare')
        }
      }
      out.gen(linkHtml(target, linkText, id, attrs ? strOf(attrs) : {}), A(src, start), B(src, end))
      if (track) {
        const nameEnd = start + (mailto ? 6 : 4)
        S.node(Type.Link, src.a![start]!, src.b![end - 1]!, [
          P(src, Type.MacroName, start, nameEnd),
          P(src, Type.MacroTarget, ind[2]![0], ind[2]![1]),
          P(src, Type.MacroText, ind[3]![0], ind[3]![1]),
        ])
      }
    })
  }

  if (w.s.includes('@')) {
    const src = w
    w = gsub(src, EmailRx, (m, out) => {
      const start = m.index
      const end = start + m[0].length
      if (m[1] !== undefined) {
        if (m[1] === '\\') {
          out.copy(src, start + 1, end)
          if (track) S.leaf(Type.Escape, src, start, start + 1)
        } else out.copy(src, start, end)
        return
      }
      const address = m[0]
      out.gen(linkHtml(`mailto:${address}`, address, undefined, {}), A(src, start), B(src, end))
      if (track) S.node(Type.Link, src.a![start]!, src.b![end - 1]!, [P(src, Type.MacroTarget, start, end)])
    })
  }

  if (foundSquare && env.bibliography === true) {
    const src = w
    const scan = w.s
    BiblioAnchorRx.lastIndex = 0
    const m = BiblioAnchorRx.exec(scan)
    if (m) {
      const out = new Out(track)
      out.copy(src, 0, m.index)
      out.gen(
        bibrefHtml(m[1]!, m[2] === undefined ? undefined : m[2]),
        A(src, m.index),
        B(src, m.index + m[0].length),
      )
      out.copy(src, m.index + m[0].length, src.s.length)
      if (track) {
        const ind = m.indices!
        S.node(Type.InlineAnchor, src.a![m.index]!, src.b![m.index + m[0].length - 1]!, [
          P(src, Type.AnchorId, ind[1]![0], ind[1]![1]),
          ...(ind[2] ? [P(src, Type.AnchorRefText, ind[2][0], ind[2][1])] : []),
        ])
      }
      w = out.finish()
    }
  }

  if ((foundSquare && w.s.includes('[[')) || (foundMacroish && w.s.includes('or:'))) {
    const src = w
    w = gsubFound(src, scanAnchors(src.s), (m, out) => {
      const start = m.index
      const end = start + m[0].length
      const ind = m.indices!
      if (m[1] !== undefined) {
        out.copy(src, start + 1, end)
        if (track) S.leaf(Type.Escape, src, start, start + 1)
        return
      }
      const id = m[2] ?? m[4]!
      out.gen(anchorHtml(id), A(src, start), B(src, end))
      if (track) {
        const g = m[2] !== undefined ? 2 : 4
        const kids: Part[] = [P(src, Type.AnchorId, ind[g]![0], ind[g]![1])]
        const rt = m[2] !== undefined ? ind[3] : ind[5]
        if (rt) kids.push(P(src, Type.AnchorRefText, rt[0], rt[1]))
        S.node(Type.InlineAnchor, src.a![start]!, src.b![end - 1]!, kids)
      }
    })
  }

  if ((w.s.includes('&') && w.s.includes(';&l')) || (foundMacroish && w.s.includes('xref:'))) {
    const src = w
    w = gsub(src, XrefRx, (m, out) => {
      const start = m.index
      const end = start + m[0].length
      const ind = m.indices!
      if (m[0].startsWith('\\')) {
        out.copy(src, start + 1, end)
        if (track) S.leaf(Type.Escape, src, start, start + 1)
        return
      }
      let attrs: Attrs = new Map()
      let refid: string
      let linkText: string | null = null
      let macro = false
      if (m[1] !== undefined) {
        refid = m[1]
        if (refid.includes(',')) {
          const comma = refid.indexOf(',')
          linkText = refid.slice(comma + 1).trimStart()
          refid = refid.slice(0, comma)
          if (linkText === '') linkText = null
        }
      } else {
        macro = true
        refid = m[2]!
        if (m[3] !== undefined) {
          linkText = m[3]
          if (linkText.includes(']')) linkText = linkText.replaceAll('\\]', ']')
          if (!compat && linkText.includes('=')) {
            const [t, a] = extractAttributes(S, linkText, null)
            linkText = t
            attrs = a
          }
        }
      }
      let path: string | undefined
      let fragment: string | undefined
      let target: string | undefined
      let src2src: string | undefined
      if (compat) fragment = refid
      else {
        const hash = refid.indexOf('#')
        if (hash >= 0 && refid.charAt(hash - 1) !== '&') {
          if (hash > 0) {
            const fragmentLen = refid.length - 1 - hash
            if (fragmentLen > 0) {
              path = refid.slice(0, hash)
              fragment = refid.slice(hash + 1)
            } else path = refid.slice(0, -1)
            if (macro) {
              if (path.endsWith('.adoc')) src2src = path = path.slice(0, -5)
              else if (!hasExtname(path)) src2src = path
            } else if (ASCIIDOC_EXTENSIONS.some((e) => path!.endsWith(e))) {
              src2src = path = path.slice(0, path.lastIndexOf('.'))
            } else src2src = path
          } else {
            target = refid
            fragment = refid.slice(1)
          }
        } else if (macro) {
          if (refid.endsWith('.adoc')) src2src = path = refid.slice(0, -5)
          else if (hasExtname(refid)) path = refid
          else fragment = refid
        } else fragment = refid
      }
      let refIdOut: string | null
      if (target !== undefined) {
        refIdOut = fragment!
      } else if (path !== undefined) {
        if (src2src !== undefined && env.docname === path) {
          if (fragment !== undefined) {
            refIdOut = fragment
            path = undefined
            target = `#${fragment}`
          } else {
            refIdOut = null
            path = undefined
            target = '#'
          }
        } else {
          refIdOut = path
          path = `${env.get('relfileprefix') ?? ''}${path}${src2src !== undefined ? (env.get('relfilesuffix') ?? env.get('outfilesuffix') ?? '.html') : ''}`
          if (fragment !== undefined) {
            refIdOut = `${refIdOut}#${fragment}`
            target = `${path}#${fragment}`
          } else target = path
        }
      } else if (compat) {
        refIdOut = fragment!
        target = `#${fragment}`
      } else if (env.hasRef?.(fragment!)) {
        refIdOut = fragment!
        target = `#${fragment}`
      } else if ((fragment!.includes(' ') || fragment!.toLowerCase() !== fragment) && env.resolveId) {
        const resolved = env.resolveId(fragment!)
        if (resolved !== null) {
          refIdOut = resolved
          target = `#${resolved}`
        } else {
          refIdOut = fragment!
          target = `#${fragment}`
        }
      } else {
        refIdOut = fragment!
        target = `#${fragment}`
      }
      const role = attrs.get('role') ?? undefined
      let html: string
      if (path !== undefined) {
        const a: Record<string, string | undefined> = { ...strOf(attrs), path }
        html = xrefPathHtml(target!, linkText ?? path, a)
      } else {
        let text = linkText
        if (text === null) {
          const id = refIdOut ?? ''
          const found = env.xrefText ? env.xrefText(id, attrs.get('xrefstyle') ?? env.get('xrefstyle')) : null
          text = found !== null ? found : id === '' ? '[^top]' : `[${id}]`
        }
        html = xrefHtml(target!, text, role)
      }
      out.gen(html, A(src, start), B(src, end))
      if (track) {
        const kids: Part[] = []
        if (m[1] !== undefined) {
          const g = ind[1]!
          const comma = refid.length === m[1].length ? -1 : g[0] + refid.length
          kids.push(P(src, Type.MacroTarget, g[0], comma >= 0 ? comma : g[1]))
          if (comma >= 0) {
            // the text after the comma, without the blanks that follow it
            let tf = comma + 1
            while (tf < g[1] && /\s/.test(src.s.charAt(tf))) tf++
            if (tf < g[1]) kids.push(P(src, Type.MacroText, tf, g[1]))
          }
        } else {
          kids.push(
            P(src, Type.MacroName, start, start + 5),
            P(src, Type.MacroTarget, ind[2]![0], ind[2]![1]),
          )
          if (ind[3]) kids.push(P(src, Type.MacroText, ind[3][0], ind[3][1]))
        }
        S.node(Type.Xref, src.a![start]!, src.b![end - 1]!, kids)
      }
    })
  }

  if (foundMacroish && w.s.includes('tnote')) {
    const src = w
    w = gsub(src, FootnoteRx, (m, out) => {
      const start = m.index
      const end = start + m[0].length
      const ind = m.indices!
      if (m[0].startsWith('\\')) {
        out.copy(src, start + 1, end)
        if (track) S.leaf(Type.Escape, src, start, start + 1)
        return
      }
      let id: string | null
      let content: string | undefined
      if (m[1] !== undefined) {
        // footnoteref
        if (m[3] !== undefined) {
          const comma = m[3].indexOf(',')
          id = comma >= 0 ? m[3].slice(0, comma) : m[3]
          content = comma >= 0 ? m[3].slice(comma + 1) : undefined
        } else {
          out.copy(src, start, end)
          return
        }
      } else {
        id = m[2] ?? null
        content = m[3]
      }
      const restore = (t: string): string => {
        const text = normalizeText(t, true, true)
        return text.includes('\u0096') ? restorePassthroughs(S, Work.of(text, null, false)).s : text
      }
      let html: string
      if (id !== null) {
        const existing = env.footnote?.(id)
        if (existing) html = footnoteHtml(existing.index, 'xref', null, existing.text)
        else if (content !== undefined) {
          const text = restore(content)
          const index = env.addFootnote ? env.addFootnote(id, text) : 1
          html = footnoteHtml(index, 'ref', id, text)
        } else html = footnoteHtml(null, 'xref', null, id)
      } else if (content !== undefined) {
        const text = restore(content)
        const index = env.addFootnote ? env.addFootnote(null, text) : 1
        html = footnoteHtml(index, null, null, text)
      } else {
        out.copy(src, start, end)
        return
      }
      out.gen(html, A(src, start), B(src, end))
      if (track) {
        const kids: Part[] = [P(src, Type.MacroName, start, start + 8 + (m[1] !== undefined ? 3 : 0))]
        if (m[1] === undefined && ind[2]) kids.push(P(src, Type.MacroTarget, ind[2][0], ind[2][1]))
        if (ind[3]) kids.push(P(src, Type.MacroText, ind[3][0], ind[3][1]))
        S.node(Type.Footnote, src.a![start]!, src.b![end - 1]!, kids)
      }
    })
  }

  return w
}

/** The output of a link: the text the prefix leaves, the link, the suffix (`);`) — from the match at `start`. */
function emitLink(
  out: Out,
  src: Work,
  start: number,
  end: number,
  g1: string,
  prefix: string,
  html: string,
  suffix: string,
  from: number,
  to: number,
): void {
  if (prefix !== '') out.copy(src, start, start + g1.length)
  out.gen(html, from, to)
  if (suffix !== '') out.copy(src, end - suffix.length, end)
}

export { maskBrackets, ALPHA }
