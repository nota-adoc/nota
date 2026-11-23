import { describe, expect, it, vi } from 'vitest'
import { parse } from '@nota-adoc/core'
import { checkOperation, type OperationInput } from './operations.js'

// The result of an operation is spoiled here, in a block that the operation did not write: the checks that were let
// go of for the lines that change how the text reads still have to see it.
const spoil = vi.hoisted(() => ({ at: -1, insert: '' }))
// (and the roles of a word that an editor action did not write are lost here, the check of the roles has to see it next to an island)
const lose = vi.hoisted(() => ({ on: false, skip: 0 }))

vi.mock('@nota-adoc/core', async (orig) => {
  const m = await orig<typeof import('@nota-adoc/core')>()
  return {
    ...m,
    createSession: (text: string) => {
      const s = m.createSession(text)
      const apply = s.apply.bind(s)
      s.apply = (changes, options) => {
        const at = s.text.indexOf('[.hl-mint]#colour#')
        const extra = lose.on && lose.skip-- <= 0 && at >= 0 && changes.every((c) => (c.to ?? c.from) <= at || c.from >= at + 18) ? [{ from: at, to: at + 18, insert: 'colour' }] : []
        apply([...changes, ...extra], options)
      }
      return s
    },
    applyOperation: (doc: ReturnType<typeof m.parse>, op: Parameters<typeof m.applyOperation>[1]) => {
      const r = m.applyOperation(doc, op)
      if ('error' in r || spoil.at < 0) return r
      const changes = [...r.changes, { from: spoil.at, to: spoil.at, insert: spoil.insert }].sort((a, b) => a.from - b.from)
      let out = doc.text
      for (const c of [...changes].reverse()) out = out.slice(0, c.from) + c.insert + out.slice(c.to)
      return { ...r, changes, doc: m.parse(out) }
    },
  }
})

const base = { to: { r: 0, mode: 0 }, where: 'before', level: 1, block: { kind: 'paragraph', text: 'x' }, list: 'unordered', text2: '', language: '', wide: false }
const input = (o: object): OperationInput => ({ ...base, ...o }) as unknown as OperationInput

// (a line of a quote block opens a block that holds the paragraph after it: that paragraph reads otherwise, in the blank line before it nothing is written)
const OPEN = '[#zz]'

describe('the checks that are let go of still see a spoiled neighbour', () => {
  it('placeBlock with :compat-mode:, the paragraph after it is spoiled by something else than the write: fails', () => {
    const text = 'alpha\n\n\n`code`\n'
    const op = { text, kind: 'placeBlock', at: { r: 0, mode: 0 }, block: { source: ':compat-mode:\n\nx' } }
    spoil.at = -1
    expect(() => checkOperation(input(op))).not.toThrow()
    spoil.at = text.indexOf('\n\n\n') + 2
    spoil.insert = OPEN
    try {
      expect(() => checkOperation(input(op))).toThrow(/away from the changes is not as it was/)
    } finally {
      spoil.at = -1
    }
  })

  it('setIslandText that writes a line which acts on the text after it: a block before the line, spoiled, fails', () => {
    const text = 'beta\n\n\ngamma\n\n== Section 0\n\n. alpha\n+\nmore\n\n. alpha'
    const op = { text, kind: 'setIslandText', at: { r: 0.6, mode: 1 }, text2: 'x\n:a: 1' }
    spoil.at = -1
    expect(() => checkOperation(input(op))).not.toThrow()
    spoil.at = text.indexOf('\n\n\n') + 2
    spoil.insert = OPEN
    try {
      expect(() => checkOperation(input(op))).toThrow(/away from the changes is not as it was/)
    } finally {
      spoil.at = -1
    }
    expect(parse(text).text).toBe(text)
  })
})

describe('the check of roles still sees a loss next to an island', () => {
  const start = { text: 'end [.hl-mint]#colour#\n\n////' }
  const actions = [{ k: 'delete', a: 0 }] as const
  it('without the loss: passes', async () => {
    const { runActions } = await import('./editor.js')
    lose.on = false
    expect(() => runActions(start, actions)).not.toThrow()
  })
  it('an action out of the island that takes the roles off a word: fails with roles:', async () => {
    const { runActions } = await import('./editor.js')
    lose.on = true
    try {
      expect(() => runActions(start, actions)).toThrow(/roles:/)
    } finally {
      lose.on = false
    }
  })
})

describe('the check of roles still sees a loss next to an island that stops being one', () => {
  const k2 =
    '\ufeff\ufeffpass:q[[.hl-mint\\]#красное#] и [.zz-a]#pass:q[x]# и ((слово)) pass:q[_a_]((b))\nendif::attr[]\n= Document Title\n= Document Title\n= Document Title'
  const start = { text: '[.hl-mint]#colour# end\n\n' + k2 }
  const actions = [
    { k: 'typeOver', a: 41.5 / 157, b: 89.5 / 157, s: 0 },
    { k: 'markCaret', a: 0.41, m: 0, s: 0 },
  ] as never
  it('without the loss: passes', async () => {
    const { runActions } = await import('./editor.js')
    lose.on = false
    expect(() => runActions(start, actions)).not.toThrow()
  })
  it('a word of another block that loses its roles with the second action: fails with roles:', async () => {
    const { runActions } = await import('./editor.js')
    lose.on = true
    lose.skip = 1
    try {
      expect(() => runActions(start, actions)).toThrow(/roles:/)
    } finally {
      lose.on = false
      lose.skip = 0
    }
  })
})

describe('the check of a list away from the changes still sees a spoiled list', () => {
  const text = 'x\n\n\n* other\n\ny\n\n1. a\n****\n\n'
  const op = { text, kind: 'setIslandText', at: { r: 0.9, mode: 5 }, text2: '* b' }
  it('an item written under a list: passes', () => {
    spoil.at = -1
    expect(() => checkOperation(input(op))).not.toThrow()
  })
  it('a list elsewhere that is spoiled: fails', () => {
    spoil.at = text.indexOf('\n\n\n') + 2
    spoil.insert = OPEN
    try {
      expect(() => checkOperation(input(op))).toThrow(/away from the changes is not as it was/)
    } finally {
      spoil.at = -1
    }
  })
})
