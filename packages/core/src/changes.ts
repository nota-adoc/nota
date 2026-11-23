/**
 * Replacements of a text as plain data: sorted, non-overlapping, adjacent ones joined. What a session keeps in its
 * history and what the editors exchange. Positions are UTF-16 offsets.
 */
import { type TextChange, applyChanges, normalizeChanges } from './incremental.js'

/** One replacement: the text `from`–`to` of the old text becomes `insert`. */
export interface Change {
  readonly from: number
  readonly to: number
  readonly insert: string
}

/**
 * Validates changes given in any order against a text of `length` (a RangeError when a range is invalid or
 * two of them overlap), sorts them, drops the ones that change nothing and joins the ones that touch.
 */
export function normalizeTextChanges(changes: readonly TextChange[], length: number): Change[] {
  const sorted = normalizeChanges(changes, length)
  const out: Change[] = []
  for (const c of sorted) {
    if (c.from === c.to && c.insert === '') continue
    const last = out[out.length - 1]
    if (last && last.to === c.from)
      out[out.length - 1] = { from: last.from, to: c.to, insert: last.insert + c.insert }
    else out.push({ from: c.from, to: c.to, insert: c.insert })
  }
  return out
}

/** The text after `changes`, given in coordinates of `text`. */
export function applyTextChanges(text: string, changes: readonly Change[]): string {
  return applyChanges(text, changes)
}

/** The replacements that undo `changes` (made on `text`), in coordinates of the text after them. */
export function invertChanges(changes: readonly Change[], text: string): Change[] {
  const out: Change[] = []
  let delta = 0
  for (const c of changes) {
    const from = c.from + delta
    out.push({ from, to: from + c.insert.length, insert: text.slice(c.from, c.to) })
    delta += c.insert.length - (c.to - c.from)
  }
  return out
}

/**
 * One set of replacements that does what `a` does and then `b` (`b` in coordinates of the text after `a`),
 * in coordinates of the text before `a`. Both must be normalized.
 */
export function composeChanges(a: readonly Change[], b: readonly Change[]): Change[] {
  if (a.length === 0) return b.map((c) => ({ ...c }))
  if (b.length === 0) return a.map((c) => ({ ...c }))
  // the changes of `a` in coordinates of the middle text (after a, before b)
  const am: { mf: number; mt: number; c: Change }[] = []
  // dAfter[k]: how much the first k changes of `a` moved the text after them
  const dAfter: number[] = [0]
  let d = 0
  for (const c of a) {
    const mf = c.from + d
    am.push({ mf, mt: mf + c.insert.length, c })
    d += c.insert.length - (c.to - c.from)
    dAfter.push(d)
  }
  // old offset of a middle offset that lies outside every inserted text of `a`, after its first `upTo` changes
  const oldOfKept = (u: number, upTo: number): number => u - dAfter[upTo]!
  const out: Change[] = []
  let i = 0
  let j = 0
  while (i < am.length || j < b.length) {
    // the cluster starts with whichever comes first in the middle text
    const ai = i < am.length ? am[i]! : null
    const bj = j < b.length ? b[j]! : null
    const startsWithA = ai !== null && (bj === null || ai.mf <= bj.from)
    const X = startsWithA ? ai!.mf : bj!.from
    const firstA = i
    const bIn: Change[] = []
    // grow while the next change of either kind touches [X, Y]
    let grew = true
    let Y: number
    if (startsWithA) {
      Y = ai!.mt
      i++
    } else {
      Y = bj!.to
      bIn.push(bj!)
      j++
    }
    while (grew) {
      grew = false
      if (i < am.length && am[i]!.mf <= Y) {
        Y = Math.max(Y, am[i]!.mt)
        i++
        grew = true
      }
      if (j < b.length && b[j]!.from <= Y) {
        Y = Math.max(Y, b[j]!.to)
        bIn.push(b[j]!)
        j++
        grew = true
      }
    }
    const aIn = am.slice(firstA, i)
    // old range
    let oldFrom: number
    if (aIn.length > 0 && aIn[0]!.mf === X) oldFrom = aIn[0]!.c.from
    else oldFrom = oldOfKept(X, firstA)
    let oldTo: number
    const lastA = aIn[aIn.length - 1]
    if (lastA && lastA.mt === Y) {
      oldTo = lastA.c.to
    } else oldTo = oldOfKept(Y, i)
    // new text: the text of `a`'s insertions that b does not replace, and b's insertions, in order
    const insertedBetween = (u: number, v: number): string => {
      let s = ''
      for (const x of aIn) {
        const lo = Math.max(u, x.mf)
        const hi = Math.min(v, x.mt)
        if (lo < hi) s += x.c.insert.slice(lo - x.mf, hi - x.mf)
      }
      return s
    }
    let text = ''
    let m = X
    for (const c of bIn) {
      text += insertedBetween(m, c.from) + c.insert
      m = c.to
    }
    text += insertedBetween(m, Y)
    if (!(oldFrom === oldTo && text === '')) out.push({ from: oldFrom, to: oldTo, insert: text })
  }
  // clusters that touch after all (through their old ranges) are joined
  const merged: Change[] = []
  for (const c of out) {
    const last = merged[merged.length - 1]
    if (last && last.to >= c.from)
      merged[merged.length - 1] = {
        from: last.from,
        to: Math.max(last.to, c.to),
        insert: last.insert + c.insert,
      }
    else merged.push(c)
  }
  return merged
}

/** Where `pos` of the old text is after `changes`. `assoc` < 0: stays before text inserted at `pos`; otherwise after. */
export function mapOffset(changes: readonly Change[], pos: number, assoc = -1): number {
  let delta = 0
  for (const c of changes) {
    if (c.from > pos) break
    if (c.to < pos || (c.to === pos && c.from !== c.to && pos !== c.from)) {
      delta += c.insert.length - (c.to - c.from)
      continue
    }
    // c.from <= pos <= c.to
    if (c.from === c.to) {
      // a pure insertion at pos
      if (assoc < 0) return pos + delta
      delta += c.insert.length
      continue
    }
    // inside a replaced range, or at its start
    return pos === c.from || assoc < 0 ? c.from + delta : c.from + delta + c.insert.length
  }
  return pos + delta
}
