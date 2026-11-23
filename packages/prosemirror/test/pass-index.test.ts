// `pass:q[…]` and a visible `((…))` are shown as text (with the colour around them), not as plates. The text
// of the construct is not edited: typing in it is refused, the markup around stays as it was. Roles are made up
// or the `hl-*` of the palette; the examples are invented.
import { afterEach, describe, expect, it } from 'vitest'
import { projectDocument } from '@nota-adoc/prosemirror'
import { closeAll, key, open, posIn, select, shape, type } from './helpers.js'

afterEach(closeAll)

type Setup = ReturnType<typeof open>

const inSync = (s: Setup): boolean => s.editor.view.state.doc.eq(projectDocument(s.session.doc))
const text = (s: Setup, i = 0): string => s.editor.view.state.doc.child(i).textContent
const cellOf = (s: Setup, word: string, i = 0): number => text(s, i).indexOf(word)
const src = (s: Setup): string => s.session.doc.text

/** The text of the elements with the class, in order. */
const classed = (s: Setup, cls: string): string[] =>
  [...s.editor.view.dom.querySelectorAll(`.${cls}`)].map((e) => e.textContent ?? '')

const PASS = 'Текст [.hl-red]#до pass:q[*жир* и _кур_] после#.\n'
const INDEX = 'Текст [.hl-red]#до ((термин)) после#.\n'

describe('projection', () => {
  it('shows pass:q[…] in colour as text: bold, italic, no plate, no markers', () => {
    const s = open(PASS)
    const dom = s.editor.view.dom
    expect(dom.querySelector('.nota-inline-chip')).toBeNull()
    expect(text(s)).toBe('Текст до жир и кур после.')
    expect(classed(s, 'hl-red').join('')).toBe('до жир и кур после')
    expect(dom.querySelector('.hl-red strong, strong .hl-red, strong.hl-red')?.textContent).toBe('жир')
    expect(dom.querySelector('em')?.textContent).toBe('кур')
    expect(inSync(s)).toBe(true)
  })

  it('shows ((…)) in colour as text, without the brackets', () => {
    const s = open(INDEX)
    expect(s.editor.view.dom.querySelector('.nota-inline-chip')).toBeNull()
    expect(text(s)).toBe('Текст до термин после.')
    expect(classed(s, 'hl-red').join('')).toBe('до термин после')
    expect(inSync(s)).toBe(true)
  })

  it('shows them in a heading and in the text of a link', () => {
    const h = open('== Раздел [.hl-red]#((термин))#\n')
    expect(h.editor.view.dom.querySelector('.nota-inline-chip')).toBeNull()
    expect(text(h)).toBe('Раздел термин')
    expect(classed(h, 'hl-red')).toEqual(['термин'])
    const l = open('https://e.example[[.hl-red]#pass:q[раз]#]\n')
    expect(l.editor.view.dom.querySelector('.nota-inline-chip')).toBeNull()
    expect(text(l)).toBe('раз')
    expect(l.editor.view.dom.querySelector('a')?.textContent).toBe('раз')
    expect(classed(l, 'hl-red')).toEqual(['раз'])
    expect(inSync(l)).toBe(true)
  })

  it('shows them outside colour too', () => {
    const s = open('Раз pass:q[*два*] и ((три)).\n')
    expect(shape(s.editor)).toBe('Раз <strong>два</> и три.')
    expect(inSync(s)).toBe(true)
  })
})

describe('colour inside pass:q[…]', () => {
  it('shows the colour written with an escaped bracket', () => {
    const s = open('Текст pass:q[[.hl-red\\]#красное#] дальше.\n')
    expect(s.editor.view.dom.querySelector('.nota-inline-chip')).toBeNull()
    expect(text(s)).toBe('Текст красное дальше.')
    expect(classed(s, 'hl-red')).toEqual(['красное'])
    expect(inSync(s)).toBe(true)
  })
})

describe('what stays a plate', () => {
  const PLATES = [
    'pass:[<b>x</b>]',
    'pass:c[x]',
    'pass:q,c[x]',
    '+x+',
    '++x++',
    '+++x+++',
    '$$x$$',
    '(((скрытый)))',
    'indexterm:[скрытый]',
    'indexterm2:[скрытый]',
    '((*жир*))',
    'pass:q[]',
    'pass:q[<b>x</b>]',
  ]
  for (const p of PLATES) {
    it(`${p} in colour is a plate with its source, the text around is red`, () => {
      const s = open(`Текст [.hl-red]#до ${p} после#.\n`)
      const chips = [...s.editor.view.dom.querySelectorAll('.nota-inline-chip')]
      expect(chips.map((c) => c.textContent)).toEqual([p])
      expect(classed(s, 'hl-red').join('')).toContain('до ')
      expect(classed(s, 'hl-red').join('')).toContain(' после')
      expect(inSync(s)).toBe(true)
    })
  }
})

describe('editing next to the construct', () => {
  for (const [name, doc] of [
    ['pass:q', PASS],
    ['((…))', INDEX],
  ] as const) {
    it(`${name}: a letter in «до» and in «после», Backspace in «после», Enter before «Текст»; the markup stays, undo restores`, () => {
      const s = open(doc)
      const before = src(s)
      const edits: [string, () => void][] = [
        ['до', () => (select(s.editor, posIn(s.editor, 0, cellOf(s, 'до') + 2)), type(s.editor, 'я'))],
        ['после', () => (select(s.editor, posIn(s.editor, 0, cellOf(s, 'после') + 5)), type(s.editor, 'я'))],
        ['Backspace', () => (select(s.editor, posIn(s.editor, 0, cellOf(s, 'после') + 5)), key(s.editor, 'Backspace'))],
        ['Enter', () => (select(s.editor, posIn(s.editor, 0, 0)), key(s.editor, 'Enter'))],
      ]
      for (const [what, run] of edits) {
        run()
        expect(src(s), what).not.toBe(before)
        expect(src(s).includes(name === 'pass:q' ? 'pass:q[*жир* и _кур_]' : '((термин))'), what).toBe(true)
        expect(src(s).includes('[.hl-red]#'), what).toBe(true)
        expect(inSync(s), what).toBe(true)
        key(s.editor, 'z', { mod: true })
        expect(src(s), what).toBe(before)
      }
      expect(classed(s, 'hl-red').length).toBeGreaterThan(0)
    })
  }

  it('a letter after «после» goes into the red text', () => {
    const s = open(PASS)
    select(s.editor, posIn(s.editor, 0, cellOf(s, 'после') + 5))
    type(s.editor, 'я')
    expect(src(s)).toBe('Текст [.hl-red]#до pass:q[*жир* и _кур_] послея#.\n')
    expect(classed(s, 'hl-red').join('')).toBe('до жир и кур послея')
  })
})

describe('editing inside and across the edge', () => {
  for (const [name, doc, word] of [
    ['pass:q', PASS, 'жир'],
    ['((…))', INDEX, 'термин'],
  ] as const) {
    it(`${name}: a letter, Backspace and Delete between the letters are refused`, () => {
      const s = open(doc)
      const before = src(s)
      const at = cellOf(s, word) + 1
      select(s.editor, posIn(s.editor, 0, at))
      type(s.editor, 'я')
      key(s.editor, 'Backspace')
      key(s.editor, 'Delete')
      expect(src(s)).toBe(before)
      expect(s.rejects.length).toBeGreaterThan(0)
      expect(s.rejects.every((r) => r.code === 'inside-construct')).toBe(true)
    })

    it(`${name}: a selection from outside to inside, Backspace right after, Delete right before are refused`, () => {
      const s = open(doc)
      const before = src(s)
      const w = cellOf(s, word)
      select(s.editor, posIn(s.editor, 0, w - 2), posIn(s.editor, 0, w + 1))
      type(s.editor, 'я')
      select(s.editor, posIn(s.editor, 0, w + word.length))
      key(s.editor, 'Backspace')
      select(s.editor, posIn(s.editor, 0, w))
      key(s.editor, 'Delete')
      expect(src(s)).toBe(before)
      expect(s.rejects.length).toBe(3)
    })
  }

  it('a selection that holds the construct whole is deleted with it in one step', () => {
    const s = open('Раз pass:q[*два*] три.\n')
    select(s.editor, posIn(s.editor, 0, 4), posIn(s.editor, 0, 7))
    key(s.editor, 'Backspace')
    expect(src(s)).toBe('Раз  три.\n')
    key(s.editor, 'z', { mod: true })
    expect(src(s)).toBe('Раз pass:q[*два*] три.\n')
  })

  it('Enter inside the construct is refused', () => {
    const s = open(PASS)
    const before = src(s)
    select(s.editor, posIn(s.editor, 0, cellOf(s, 'жир') + 1))
    key(s.editor, 'Enter')
    expect(src(s)).toBe(before)
  })
})
