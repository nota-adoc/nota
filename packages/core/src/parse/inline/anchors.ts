/** Inline anchors (`[[id]]`, `[[id,text]]`, `anchor:id[text]`), found in linear time. */
import { cpAt, isAlphaCp, isWordCp } from './chars.js'
import { type Found, Next, found } from './work.js'

const isIdChar = (s: string, i: number): boolean => {
  const cp = cpAt(s, i)
  return isWordCp(cp) || cp === 45 || cp === 58 || cp === 46
}

/**
 * InlineAnchorRx, found in linear time (`[[id]]`, `[[id,text]]`, `anchor:id[]`, `anchor:id[text]`, with an
 * escape before): the regular expression rescans the rest of the text for each start it tries.
 */
export function scanAnchors(text: string): Found[] {
  const n = text.length
  const out: Found[] = []
  const doubleRB = new Next((k) => text.indexOf(']]', k))
  const closer = new Next((k) => {
    for (let j = text.indexOf(']', k); j >= 0; j = text.indexOf(']', j + 1))
      if (text.charCodeAt(j - 1) !== 92) return j
    return -1
  })
  const idEnd = (from: number): number => {
    const cp = cpAt(text, from)
    if (!(isAlphaCp(cp) || cp === 95 || cp === 58)) return -1
    let q = from + (cp > 0xffff ? 2 : 1)
    while (q < n && isIdChar(text, q)) q += cpAt(text, q) > 0xffff ? 2 : 1
    return q
  }
  let pos = 0
  while (pos < n) {
    const a = text.indexOf('[[', pos)
    const b = text.indexOf('anchor:', pos)
    if (a < 0 && b < 0) break
    const p = a < 0 ? b : b < 0 ? a : Math.min(a, b)
    let m: Found | null = null
    if (text.startsWith('[[', p)) {
      const q = idEnd(p + 2)
      if (q > 0) {
        let end = -1
        let tf = -1
        let tt = -1
        if (text.charCodeAt(q) === 44) {
          let sEnd = q + 1
          while (text.charCodeAt(sEnd) === 32) sEnd++
          const j = doubleRB.at(q + 2)
          if (j >= 0) {
            const ts = Math.min(sEnd, j - 1)
            tf = ts
            tt = text.charCodeAt(j - 1) === 32 && j - 1 >= ts + 1 ? j - 1 : j
            end = j + 2
          }
        } else if (text.charCodeAt(q) === 32 && text.startsWith(']]', q + 1)) end = q + 3
        else if (text.startsWith(']]', q)) end = q + 2
        if (end > 0) {
          const esc = p > pos && text.charCodeAt(p - 1) === 92
          const s = esc ? p - 1 : p
          m = found(
            s,
            end - s,
            [esc ? [s, s + 1] : null, [p + 2, q], tf >= 0 ? [tf, tt] : null, null, null],
            text,
          )
        }
      }
    } else {
      const q = idEnd(p + 7)
      if (q > 0 && text.charCodeAt(q) === 91) {
        let end = -1
        let tf = -1
        let tt = -1
        if (text.charCodeAt(q + 1) === 93) end = q + 2
        else {
          const j = closer.at(q + 2)
          if (j >= 0) {
            tf = q + 1
            tt = j
            end = j + 1
          }
        }
        if (end > 0) {
          const esc = p > pos && text.charCodeAt(p - 1) === 92
          const s = esc ? p - 1 : p
          m = found(
            s,
            end - s,
            [esc ? [s, s + 1] : null, null, null, [p + 7, q], tf >= 0 ? [tf, tt] : null],
            text,
          )
        }
      }
    }
    if (m) {
      out.push(m)
      pos = m.index + m[0].length
    } else pos = p + 1
  }
  return out
}


/** LeadingInlineAnchorRx `^\[\[(id)(?:, *(.+?))?\]\]`: the id and the reference text of an anchor that starts the text. */
export function leadingAnchor(text: string): { id: string; reftext: string | null; end: number } | null {
  if (!text.startsWith('[[')) return null
  const cp = cpAt(text, 2)
  if (!(isAlphaCp(cp) || cp === 95 || cp === 58)) return null
  let q = 2 + (cp > 0xffff ? 2 : 1)
  while (q < text.length && isIdCharAt(text, q)) q += cpAt(text, q) > 0xffff ? 2 : 1
  const id = text.slice(2, q)
  if (text.startsWith(']]', q)) return { id, reftext: null, end: q + 2 }
  if (text.charCodeAt(q) !== 44) return null
  let sEnd = q + 1
  while (text.charCodeAt(sEnd) === 32) sEnd++
  const j = text.indexOf(']]', q + 2)
  if (j < 0) return null
  const from = Math.min(sEnd, j - 1)
  return { id, reftext: text.slice(from, j), end: j + 2 }
}

const isIdCharAt = (s: string, i: number): boolean => isIdChar(s, i)
