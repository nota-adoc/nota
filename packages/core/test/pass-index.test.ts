// `pass:q[…]` and a visible `((…))` read as text in the editor's cells, their text is not edited, and colour
// inside `pass:q[…]` is seen by `colors()`. The examples are invented.
import { describe, expect, it } from 'vitest'
import { type Operation, applyOperation, parse } from '../src/index.js'
import { readInline } from '../src/internal.js'

const PASS = 'Текст [.hl-red]#до pass:q[*жир* и _кур_] после#.\n'
const INDEX = 'Текст [.hl-red]#до ((термин)) после#.\n'

const at = (text: string, s: string, shift = 0): number => text.indexOf(s) + shift
const cellsOf = (text: string): ReturnType<typeof readInline>['cells'] =>
  readInline(parse(text), 0, text.length - 1).cells
const run = (text: string, op: Operation): { error?: string; text?: string } => {
  const r = applyOperation(parse(text), op)
  return 'error' in r ? { error: r.error } : { text: r.doc.text }
}

describe('reading', () => {
  it('reads pass:q and ((…)) as the characters they show, with the marks, and no plate', () => {
    for (const t of [PASS, INDEX]) {
      const cells = cellsOf(t)
      expect(cells.some((c) => c.kind === 'chip')).toBe(false)
    }
    const cells = cellsOf(PASS)
    const shown = cells.map((c) => c.ch).join('')
    expect(shown).toBe('Текст до жир и кур после.')
    const bold = cells.filter((c) => c.spans.some((s) => s.type === 'strong')).map((c) => c.ch).join('')
    expect(bold).toBe('жир')
    const locked = cells.filter((c) => c.spans.some((s) => s.type === 'lock')).map((c) => c.ch).join('')
    expect(locked).toBe('жир и кур')
  })

  it('keeps a plate for the rest', () => {
    for (const p of ['pass:[x]', 'pass:c[x]', 'pass:q,c[x]', '+x+', '++x++', '+++x+++', '$$x$$', '(((x)))', 'indexterm:[x]', '((*x*))'])
      expect(cellsOf(`a [.hl-red]#b ${p} c#\n`).filter((c) => c.kind === 'chip').map((c) => c.src)).toEqual([p])
  })
})

describe('colors()', () => {
  const T = 'Текст pass:q[[.hl-red\\]#красное#] дальше.\n'

  it('finds the colour written inside pass:q[…], exactly at its word', () => {
    const runs = parse(T).colors()
    expect(runs.map((r) => [r.role, T.slice(r.from, r.to)])).toEqual([['hl-red', 'красное']])
  })

  it('finds the colour around pass:q[…] and inside it as separate runs, and sees the colour at the position', () => {
    const t = 'a [.hl-blue]#b pass:q[*c* [.hl-red\\]#d#] e#\n'
    const d = parse(t)
    expect(d.colors().map((r) => [r.role, t.slice(r.from, r.to)])).toEqual([
      ['hl-blue', 'b pass:q[*c* [.hl-red\\]#d#] e'],
      ['hl-red', 'd'],
    ])
    expect(d.colorAt(t.indexOf('d#'))).toEqual(['hl-blue', 'hl-red'])
  })

  it('does not change for the other passthroughs and index terms', () => {
    for (const p of ['pass:[[.hl-red]#x#]', 'pass:c[x]', '+[.hl-red]#x#+', '((x))', '(((x)))'])
      expect(parse(`a [.hl-red]#b ${p} c#\n`).colors().length).toBe(1)
    expect(parse('pass:[x] [.hl-red]#y#\n').colors().length).toBe(1)
  })
})

describe('colour operations', () => {
  it('setColor inside pass:q[…] or ((…)) is not-colorable, an end inside is inside-construct', () => {
    const t = 'Раз pass:q[*два*] три ((слово)) и [.hl-red]#красное#.\n'
    expect(run(t, { kind: 'setColor', from: at(t, 'два'), to: at(t, 'два', 3), role: 'hl-blue' }).error).toBe('not-colorable')
    expect(run(t, { kind: 'setColor', from: at(t, 'слово'), to: at(t, 'слово', 5), role: 'hl-blue' }).error).toBe('not-colorable')
    expect(run(t, { kind: 'setColor', from: 0, to: at(t, 'два', 1), role: 'hl-blue' }).error).toBe('inside-construct')
  })
})

describe('editing', () => {
  for (const [t, word] of [
    [PASS, 'жир'],
    [INDEX, 'термин'],
  ] as const) {
    const w = at(t, word)
    it(`refuses to type, delete or split inside ${word}`, () => {
      const inside = cellsOf(t).find((c) => c.ch === word[1] && c.spans.some((s) => s.type === 'lock'))!
      expect(run(t, { kind: 'insertText', at: inside.from, text: 'я' }).error).toBe('inside-construct')
      expect(run(t, { kind: 'deleteRange', from: inside.from, to: inside.to }).error).toBe('inside-construct')
      expect(run(t, { kind: 'splitBlock', at: inside.from }).error).toBe('inside-construct')
      expect(run(t, { kind: 'insertBreak', at: inside.from }).error).toBe('inside-construct')
      expect(run(t, { kind: 'deleteRange', from: 0, to: w + 1 }).error).toBe('inside-construct')
    })

    it(`refuses Backspace right after and Delete right before ${word}`, () => {
      const cells = cellsOf(t).filter((c) => c.spans.some((s) => s.type === 'lock'))
      const first = cells[0]!
      const last = cells[cells.length - 1]!
      expect(run(t, { kind: 'deleteRange', from: last.from, to: last.to }).error).toBe('inside-construct')
      expect(run(t, { kind: 'deleteRange', from: first.from, to: first.to }).error).toBe('inside-construct')
    })

    it(`deletes ${word} with its markup when the range holds it whole`, () => {
      const cells = cellsOf(t).filter((c) => c.spans.some((s) => s.type === 'lock'))
      const r = run(t, { kind: 'deleteRange', from: cells[0]!.from, to: cells[cells.length - 1]!.to })
      expect(r.error).toBeUndefined()
      expect(r.text).toBe(t.replace(/pass:q\[.*?_\]|\(\(термин\)\)/, ''))
    })

    it('types next to it and keeps its source byte for byte', () => {
      const end = t.indexOf(' после')
      const r = run(t, { kind: 'insertText', at: end, text: 'я' })
      expect(r.text).toBe(t.slice(0, end) + 'я' + t.slice(end))
      const start = t.indexOf('до ') + 3
      expect(run(t, { kind: 'insertText', at: start, text: 'я' }).text).toBe(t.slice(0, start) + 'я' + t.slice(start))
    })
  }

  it('toggleMark and setLink over a part of the construct are refused, over all of it they are not', () => {
    const t = 'Раз pass:q[два три] и ((слово)).\n'
    const a = at(t, 'два')
    expect(run(t, { kind: 'toggleMark', from: a, to: a + 2, mark: 'strong' }).error).toBe('inside-construct')
    expect(run(t, { kind: 'setLink', from: a, to: a + 2, target: 'https://e.example' }).error).toBe('inside-construct')
    const w = at(t, 'слово')
    expect(run(t, { kind: 'toggleMark', from: w + 1, to: w + 6, mark: 'em' }).error).toBe('inside-construct')
    const all = run(t, { kind: 'toggleMark', from: a, to: a + 8, mark: 'strong' })
    expect(all.error).toBeUndefined()
    expect(all.text).toBe('Раз *pass:q[два три]* и ((слово)).\n')
  })

  it('does not take a mark off inside the construct', () => {
    const t = 'Раз pass:q[*два*] и.\n'
    const a = at(t, 'два')
    expect(run(t, { kind: 'toggleMark', from: a, to: a + 3, mark: 'strong', on: false }).error).toBe('inside-construct')
  })
})
