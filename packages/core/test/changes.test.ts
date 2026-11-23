import { describe, expect, it } from 'vitest'
import {
  type Change,
  applyTextChanges,
  composeChanges,
  invertChanges,
  mapOffset,
  normalizeTextChanges,
} from '../src/changes.js'
import { prng } from '../../../quality/bench/bench.js'

function randomChanges(rnd: () => number, len: number): Change[] {
  const out: { from: number; to: number; insert: string }[] = []
  const n = Math.floor(rnd() * 4)
  for (let i = 0; i < n; i++) {
    const from = Math.floor(rnd() * (len + 1))
    const to = Math.min(len, from + (rnd() < 0.5 ? 0 : Math.floor(rnd() * 5)))
    const insert = rnd() < 0.4 ? '' : 'xyzuvw'.slice(0, 1 + Math.floor(rnd() * 5))
    out.push({ from, to, insert })
  }
  // keep the ones that do not overlap
  const picked: typeof out = []
  for (const c of out.sort((a, b) => a.from - b.from || a.to - b.to)) {
    const last = picked[picked.length - 1]
    if (last && c.from < last.to) continue
    picked.push(c)
  }
  return normalizeTextChanges(picked, len)
}

describe('changes', () => {
  it('normalizes: sorts, drops no-ops, joins the ones that touch, rejects overlaps and bad ranges', () => {
    expect(
      normalizeTextChanges(
        [
          { from: 4, to: 6, insert: 'b' },
          { from: 1, insert: 'a' },
          { from: 3, to: 3 },
        ],
        10,
      ),
    ).toEqual([
      { from: 1, to: 1, insert: 'a' },
      { from: 4, to: 6, insert: 'b' },
    ])
    expect(
      normalizeTextChanges(
        [
          { from: 1, to: 3, insert: 'a' },
          { from: 3, to: 4, insert: 'b' },
        ],
        10,
      ),
    ).toEqual([{ from: 1, to: 4, insert: 'ab' }])
    expect(() =>
      normalizeTextChanges(
        [
          { from: 1, to: 5 },
          { from: 4, to: 6 },
        ],
        10,
      ),
    ).toThrow(RangeError)
    expect(() => normalizeTextChanges([{ from: 2, to: 11 }], 10)).toThrow(RangeError)
  })

  it('composes: what a then b do equals what the composition does (random)', () => {
    const rnd = prng(20260929)
    for (let i = 0; i < 5000; i++) {
      const text = 'abcdefghijklmnopqrstuvwxyz'.slice(0, Math.floor(rnd() * 27))
      const a = randomChanges(rnd, text.length)
      const mid = applyTextChanges(text, a)
      const b = randomChanges(rnd, mid.length)
      const expected = applyTextChanges(mid, b)
      const c = composeChanges(a, b)
      expect(applyTextChanges(text, c), JSON.stringify({ text, a, b, c })).toBe(expected)
      // normalized: sorted, no touching
      for (let k = 1; k < c.length; k++) expect(c[k]!.from).toBeGreaterThan(c[k - 1]!.to)
    }
  })

  it('inverts: the inverse takes the new text back to the old', () => {
    const rnd = prng(7)
    for (let i = 0; i < 2000; i++) {
      const text = 'abcdefghijklmnopqrstuvwxyz'.slice(0, Math.floor(rnd() * 27))
      const a = randomChanges(rnd, text.length)
      const next = applyTextChanges(text, a)
      expect(applyTextChanges(next, invertChanges(a, text))).toBe(text)
    }
  })

  it('maps offsets like a CodeMirror change set', () => {
    const c: Change[] = [
      { from: 2, to: 4, insert: 'xyz' },
      { from: 6, to: 6, insert: 'Q' },
    ]
    expect(mapOffset(c, 0)).toBe(0)
    expect(mapOffset(c, 2)).toBe(2)
    expect(mapOffset(c, 3, -1)).toBe(2)
    expect(mapOffset(c, 3, 1)).toBe(5)
    expect(mapOffset(c, 4)).toBe(5)
    expect(mapOffset(c, 5)).toBe(6)
    expect(mapOffset(c, 6, -1)).toBe(7)
    expect(mapOffset(c, 6, 1)).toBe(8)
    expect(mapOffset(c, 9)).toBe(11)
  })
})
