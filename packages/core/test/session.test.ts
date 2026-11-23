import { describe, expect, it } from 'vitest'
import { type SessionEvent, createSession, parse } from '@nota-adoc/core'
import { prng } from '../../../quality/bench/bench.js'

describe('session', () => {
  it('keeps the text and its Nota document', () => {
    const s = createSession('= T\n\ntext\n')
    expect(s.text).toBe('= T\n\ntext\n')
    s.apply([{ from: 9, insert: ' more' }])
    expect(s.text).toBe('= T\n\ntext more\n')
    expect(s.doc.text).toBe(s.text)
    expect(s.doc.diagnostics).toEqual(parse(s.text).diagnostics)
    expect(s.canUndo).toBe(true)
    expect(s.canRedo).toBe(false)
  })

  it('takes the parse options', () => {
    const s = createSession('ifdef::x[]\nyes\nendif::[]\n', { parse: { attributes: { x: '1' } } })
    expect(s.parseOptions).toEqual({ attributes: { x: '1' } })
    expect(s.doc.tree.toString()).toBe(parse(s.text, { attributes: { x: '1' } }).tree.toString())
  })

  it('groups typing: steps of one origin closer than 500 ms and next to each other are one step of undo', () => {
    const s = createSession('')
    const type = (ch: string, at: number, time: number) =>
      s.apply([{ from: at, insert: ch }], { origin: 'a', time })
    'hello'.split('').forEach((c, i) => type(c, i, 1000 + i * 100))
    expect(s.text).toBe('hello')
    type('!', 5, 1400 + 600) // after a pause
    expect(s.text).toBe('hello!')
    expect(s.undo()).toBe(true)
    expect(s.text).toBe('hello')
    expect(s.undo()).toBe(true)
    expect(s.text).toBe('')
    expect(s.undo()).toBe(false)
    expect(s.redo()).toBe(true)
    expect(s.text).toBe('hello')
    expect(s.redo()).toBe(true)
    expect(s.text).toBe('hello!')
    expect(s.redo()).toBe(false)
  })

  it('does not glue typing after an undo to the step that is left', () => {
    const s = createSession('')
    s.apply([{ from: 0, insert: 'a' }], { origin: 'a', time: 0 })
    s.apply([{ from: 1, insert: 'b' }], { origin: 'x', time: 100 })
    expect(s.undo()).toBe(true)
    s.apply([{ from: 1, insert: 'c' }], { origin: 'a', time: 200 }) // soon, next to the step 'a', but after an undo
    expect(s.text).toBe('ac')
    expect(s.undo()).toBe(true)
    expect(s.text).toBe('a')
    expect(s.undo()).toBe(true)
    expect(s.text).toBe('')
  })

  it('does not join steps of different origins, distant steps, or steps of several ranges', () => {
    const s = createSession('0123456789')
    s.apply([{ from: 0, insert: 'a' }], { origin: 1, time: 0 })
    s.apply([{ from: 1, insert: 'b' }], { origin: 2, time: 10 }) // another origin
    s.apply([{ from: 8, insert: 'c' }], { origin: 2, time: 20 }) // far away
    s.apply(
      [
        { from: 9, insert: 'd' },
        { from: 12, insert: 'e' },
      ],
      { origin: 2, time: 30 },
    )
    let steps = 0
    while (s.undo()) steps++
    expect(steps).toBe(4)
    expect(s.text).toBe('0123456789')
  })

  it('a new edit after an undo drops the steps that could be redone', () => {
    const s = createSession('abc')
    s.apply([{ from: 3, insert: 'd' }], { time: 0 })
    s.undo()
    expect(s.canRedo).toBe(true)
    s.apply([{ from: 0, insert: 'x' }], { time: 5000 })
    expect(s.canRedo).toBe(false)
    expect(s.redo()).toBe(false)
  })

  it('tells listeners what happened, in coordinates of the text before, and lets them stop listening', () => {
    const s = createSession('hello world')
    const seen: SessionEvent[] = []
    const stop = s.subscribe((e) => seen.push(e))
    s.apply([{ from: 5, to: 6, insert: ', ' }], { origin: 'me', time: 0 })
    s.undo({ origin: 'you' })
    s.redo()
    expect(seen.map((e) => [e.kind, e.origin, e.changes, e.doc.text])).toEqual([
      ['apply', 'me', [{ from: 5, to: 6, insert: ', ' }], 'hello, world'],
      ['undo', 'you', [{ from: 5, to: 7, insert: ' ' }], 'hello world'],
      ['redo', undefined, [{ from: 5, to: 6, insert: ', ' }], 'hello, world'],
    ])
    stop()
    s.apply([{ from: 0, insert: '!' }])
    expect(seen).toHaveLength(3)
  })

  it('rejects invalid ranges without changing anything', () => {
    const s = createSession('abc')
    expect(() => s.apply([{ from: 2, to: 9, insert: 'x' }])).toThrow(RangeError)
    expect(() =>
      s.apply([
        { from: 0, to: 2, insert: 'x' },
        { from: 1, to: 3, insert: 'y' },
      ]),
    ).toThrow(RangeError)
    expect(s.text).toBe('abc')
    expect(s.canUndo).toBe(false)
  })

  it('ignores an empty change', () => {
    const s = createSession('abc')
    s.apply([])
    s.apply([{ from: 1, to: 1, insert: '' }])
    expect(s.canUndo).toBe(false)
  })

  it('a listener that throws does not stop the others; the error comes out after', () => {
    const s = createSession('abc')
    const got: string[] = []
    s.subscribe(() => {
      throw new Error('boom')
    })
    s.subscribe((e) => got.push(e.doc.text))
    expect(() => s.apply([{ from: 0, insert: 'x' }])).toThrow('boom')
    expect(got).toEqual(['xabc'])
    expect(s.text).toBe('xabc')
  })

  it('keeps CR, CRLF and lone surrogates through undo and redo', () => {
    const start = 'a\r\nb\rc\n\ud800tail\r\n'
    const s = createSession(start)
    s.apply([{ from: 1, to: 3, insert: '\r' }], { time: 0 })
    s.apply([{ from: 0, insert: '\r\n' }], { time: 5000 })
    s.apply([{ from: 4, to: 6, insert: '😀' }], { time: 9000 })
    const end = s.text
    while (s.undo());
    expect(s.text).toBe(start)
    while (s.redo());
    expect(s.text).toBe(end)
  })

  for (const seed of [1, 2, 3, 20260929]) {
    it(`undoes every step back to the first text byte for byte and redoes to the last (seed ${seed})`, () => {
      const rnd = prng(seed)
      const pieces = [
        'x',
        'привет',
        '\n',
        '\r\n',
        '== T\n',
        '* item\n',
        '----\n',
        'ifdef::a[]\n',
        'endif::[]\n',
        ':n: v\n',
        '\r',
        '',
      ]
      const start = '= Title\n\nA paragraph.\n\n== Section\n\n----\ncode\n----\n\n* one\n* two\n'
      const s = createSession(start)
      const texts = [start]
      let time = 0
      for (let i = 0; i < 200; i++) {
        const len = s.text.length
        const from = Math.floor(rnd() * (len + 1))
        const to = Math.min(len, from + (rnd() < 0.5 ? 0 : Math.floor(rnd() * 8)))
        const insert = pieces[Math.floor(rnd() * pieces.length)]!
        time += rnd() < 0.5 ? 50 : 700
        const before = s.text
        s.apply([{ from, to, insert }], { origin: rnd() < 0.5 ? 'a' : 'b', time })
        if (s.text !== before) texts.push(s.text)
        expect(s.doc.diagnostics).toEqual(parse(s.text).diagnostics)
      }
      const end = s.text
      let undone = 0
      while (s.undo()) {
        undone++
        expect(s.doc.text).toBe(s.text)
      }
      expect(s.text).toBe(start)
      expect(undone).toBeLessThanOrEqual(texts.length)
      while (s.redo());
      expect(s.text).toBe(end)
      expect(s.doc.diagnostics).toEqual(parse(end).diagnostics)
    })
  }
})

describe('the errors of apply', () => {
  const failure = (f: () => unknown): Error => {
    try {
      f()
    } catch (e) {
      return e as Error
    }
    throw new Error('did not throw')
  }

  it('gives the messages of update, and changes nothing', () => {
    const s = createSession('abc')
    const range = failure(() => s.apply([{ from: 5, to: 6, insert: '' }]))
    expect(range).toBeInstanceOf(RangeError)
    expect(range.message).toContain('5-6')
    expect(range.message).toContain('length 3')
    const overlap = failure(() =>
      s.apply([
        { from: 0, to: 2, insert: 'x' },
        { from: 1, to: 3, insert: 'y' },
      ]),
    )
    expect(overlap).toBeInstanceOf(RangeError)
    expect(overlap.message).toContain('0-2')
    expect(overlap.message).toContain('1-3')
    const type = failure(() => s.apply([{ from: 0, insert: 1 as never }]))
    expect(type).toBeInstanceOf(TypeError)
    expect(type.message).toContain('`insert`')
    expect(type.message).toContain('number')
    expect(s.text).toBe('abc')
    expect(s.canUndo).toBe(false)
  })
})
