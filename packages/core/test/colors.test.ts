// colour as a property of text: the roles on marked-up text, where they are, and their exact ranges.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { type ColorRun, type ParseOptions, applyOperation, parse } from '../src/index.js'

const fixture = readFileSync(
  fileURLToPath(new URL('../../../quality/fixtures/stage4/colors.adoc', import.meta.url)),
  'utf8',
)

const runs = (text: string, options?: ParseOptions): readonly ColorRun[] => parse(text, options).colors()
/** The coloured text of each run, with its role. */
const seen = (text: string, options?: ParseOptions): string[] =>
  runs(text, options).map((r) => `${r.role}:${text.slice(r.from, r.to)}`)

describe('colours in every place', () => {
  const doc = parse(fixture)
  const mint = doc.colors().filter((r) => r.role === 'hl-mint')
  const at = (word: string) => mint.find((r) => fixture.slice(r.from, r.to) === word)!

  it('finds a run for each place with the kind of its container and the depth of tables', () => {
    const cases: [string, string, number][] = [
      ['документа', 'heading', 0],
      ['словом', 'paragraph', 0],
      ['первый', 'heading', 0],
      ['заголовок', 'heading', 0],
      ['блока', 'block-title', 0],
      ['маркированный', 'list-item', 0],
      ['нумерованный', 'list-item', 0],
      ['списка', 'term', 0],
      ['термина', 'list-item', 0],
      ['в строку', 'admonition', 0],
      ['в блоке', 'paragraph', 0],
      ['таблицы', 'cell', 1],
      ['обычная', 'cell', 1],
      ['в ячейке', 'paragraph', 1],
      ['глубины два', 'cell', 2],
      ['глубины три', 'cell', 3],
      ['черта', 'cell', 1],
    ]
    for (const [word, kind, depth] of cases) {
      const r = at(word)
      expect(r, word).toBeDefined()
      expect([r.container.kind, r.container.depth], word).toEqual([kind, depth])
    }
  })

  it('tells the text of links and cross references', () => {
    expect(at('текст').pieces[0]!.within).toEqual(['link'])
    const xref = mint.filter((r) => fixture.slice(r.from, r.to) === 'текст')[1]!
    expect(xref.pieces[0]!.within).toEqual(['xref'])
  })

  it('reads cells with an escaped bar, a break in the text and the quotes of CSV', () => {
    expect(fixture.slice(at('переносом\nвнутри').from, at('переносом\nвнутри').to)).toBe('переносом\nвнутри')
    const cells = mint.filter((r) => r.container.kind === 'cell').map((r) => fixture.slice(r.from, r.to))
    expect(cells).toContain('в кавычках')
    expect(cells).toContain('с запятой')
  })

  it('does not take the literal cell', () => {
    expect(mint.some((r) => fixture.slice(r.from, r.to) === 'не цвет')).toBe(false)
  })
})

describe('where there is no colour', () => {
  const x = '[.hl-mint]#x#'
  const none: [string, string][] = [
    ['listing', `----\n${x}\n----`],
    ['literal block', `....\n${x}\n....`],
    ['literal paragraph', ` ${x}`],
    ['literal cell', `|===\nl|${x}\n|===`],
    ['plus passthrough', `+${x}+`],
    ['pass macro', `pass:[${x}]`],
    ['line comment', `// ${x}`],
    ['block comment', `////\n${x}\n////`],
    ['ifdef off', `ifdef::nope[]\n${x}\nendif::[]`],
    ['attribute value', `:attr: ${x}`],
    ['escaped', `\\${x}`],
    ['block role', '[.hl-mint]\nабзац'],
    ['link role', 'https://example.org[текст,role=hl-mint]'],
    ['no registry', '[.note]#x#'],
    ['attribute reference', '[.{name}]#x#'],
    ['hl- alone', '[.hl-]#x#'],
  ]
  for (const [name, text] of none)
    it(`finds none in ${name}`, () => {
      const doc = parse(text)
      expect(doc.colors()).toEqual([])
      for (let i = 0; i <= text.length; i++) expect(doc.colorAt(i)).toEqual([])
    })
})

describe('bold, italic and crossing', () => {
  it('puts a piece inside bold or italic', () => {
    const a = runs('*а [.hl-mint]#б# в*')
    expect(a).toHaveLength(1)
    expect(a[0]!.pieces[0]!.within).toEqual(['strong'])
    expect(runs('_[.hl-mint]##б##_')[0]!.pieces[0]!.within).toEqual(['emphasis'])
  })

  it('lets bold inside colour stay in the run', () => {
    const t = '[.hl-mint]#а *б* в#'
    expect(seen(t)).toEqual(['hl-mint:а *б* в'])
    expect(parse(t).colorAt(t.indexOf('б'))).toEqual(['hl-mint'])
  })

  it('makes one run of colour that crosses the start of bold', () => {
    const t = '[.hl-mint]##до##*[.hl-mint]##внутри##после*'
    const r = runs(t)
    expect(r).toHaveLength(1)
    expect(r[0]!.pieces).toHaveLength(2)
    expect(t.slice(r[0]!.from, r[0]!.to)).toBe('до##*[.hl-mint]##внутри')
    expect(parse(t).colorAt(t.indexOf('после'))).toEqual([])
  })
})

describe('joining and breaking', () => {
  it('joins pieces that have only marks and attributes between them', () => {
    const r = runs('[.hl-mint]##а##[.hl-mint]##б##')
    expect(r).toHaveLength(1)
    expect(r[0]!.pieces).toHaveLength(2)
  })

  it('breaks at a space, a line break, a hard break, an image and between places', () => {
    for (const t of [
      '[.hl-mint]#а# [.hl-mint]#б#',
      '[.hl-mint]#а#\n[.hl-mint]#б#',
      '[.hl-mint]#а# +\n[.hl-mint]#б#',
      '[.hl-mint]##а##image:x.png[][.hl-mint]##б##',
      '|===\n|[.hl-mint]#а#\n|[.hl-mint]#б#\n|===',
      '* [.hl-mint]#а#\n* [.hl-mint]#б#',
    ])
      expect(runs(t), t).toHaveLength(2)
  })

  it('does not join different roles', () => {
    expect(runs('[.hl-mint]##а##[.hl-plum]##б##').map((r) => r.role)).toEqual(['hl-mint', 'hl-plum'])
  })
})

describe('several roles', () => {
  it('gives a run to each colour of a piece', () => {
    const t = '[.hl-mint.hl-tall]#x#'
    const r = runs(t)
    expect(r.map((x) => x.role)).toEqual(['hl-mint', 'hl-tall'])
    expect(r[0]!.pieces[0]).toBe(r[1]!.pieces[0])
    expect(parse(t).colorAt(t.indexOf('x'))).toEqual(['hl-mint', 'hl-tall'])
  })

  it('keeps the roles that are no colour in the piece', () => {
    const t = '[#k1.hl-mint.note]#x#'
    const r = runs(t)
    expect(r.map((x) => x.role)).toEqual(['hl-mint'])
    expect(r[0]!.pieces[0]!.roles.map((x) => [x.name, x.color])).toEqual([
      ['hl-mint', true],
      ['note', false],
    ])
    expect(t.slice(r[0]!.pieces[0]!.attrs.from, r[0]!.pieces[0]!.attrs.to)).toBe('[#k1.hl-mint.note]')
  })

  it('nests colours from the outside in', () => {
    const t = '[.hl-mint]#а [.hl-plum]*б* в#'
    expect(seen(t)).toEqual(['hl-mint:а [.hl-plum]*б* в', 'hl-plum:б'])
    expect(parse(t).colorAt(t.indexOf('б'))).toEqual(['hl-mint', 'hl-plum'])
  })

  it('does not take positional attributes after a comma for roles', () => {
    expect(runs('[.hl-mint,hl-plum]#x#').map((r) => r.role)).toEqual(['hl-mint'])
  })
})

describe('forms and exact ranges', () => {
  it('tells the form', () => {
    expect(runs('[.hl-mint]#x#')[0]!.pieces[0]!.form).toBe('constrained')
    expect(runs('при[.hl-mint]##мер##')[0]!.pieces[0]!.form).toBe('unconstrained')
  })

  it('takes the other marks as colour too', () => {
    const kinds = (t: string) => runs(t)[0]!.pieces[0]!.kind
    expect(kinds('[.hl-mint]*x*')).toBe('strong')
    expect(kinds('[.hl-mint]_x_')).toBe('emphasis')
    expect(kinds('[.hl-mint]`x`')).toBe('code')
  })

  it('lays the ranges end to end and finds each role by its name', () => {
    const doc = parse(fixture)
    const pieces = new Set(doc.colors().flatMap((r) => r.pieces))
    expect(pieces.size).toBeGreaterThan(30)
    for (const p of pieces) {
      expect(p.attrs.from).toBe(p.from)
      expect(p.open.from).toBe(p.attrs.to)
      expect(p.inner.from).toBe(p.open.to)
      expect(p.close.from).toBe(p.inner.to)
      expect(p.close.to).toBe(p.to)
      for (const r of p.roles) expect(fixture.slice(r.from, r.to)).toBe(r.name)
    }
  })
})

describe('identity and editing', () => {
  it('keeps the text', () => {
    expect(parse(fixture).text).toBe(fixture)
  })

  it('keeps a piece byte for byte when text is inserted elsewhere', () => {
    const t = 'Начало.\n\nАбзац [.hl-mint]#цвет# тут.\n'
    const doc = parse(t)
    const r = applyOperation(doc, { kind: 'insertText', at: 3, text: 'XYZ' })
    expect('error' in r).toBe(false)
    if ('error' in r) return
    const next = r.doc
    expect(next.text).toBe('НачXYZало.\n\nАбзац [.hl-mint]#цвет# тут.\n')
    const a = doc.colors()
    const b = next.colors()
    expect(b).toHaveLength(a.length)
    expect(b[0]!.from - a[0]!.from).toBe(3)
    expect(next.text.slice(b[0]!.pieces[0]!.from, b[0]!.pieces[0]!.to)).toBe('[.hl-mint]#цвет#')
  })

  it('gives after an update the colours of a full parse', () => {
    const doc = parse(fixture)
    const at = fixture.indexOf('словом')
    const next = doc.update([{ from: at, to: at, insert: 'новым ' }])
    expect(JSON.stringify(next.colors())).toBe(JSON.stringify(parse(next.text).colors()))
    const cut = fixture.indexOf('обычная')
    const next2 = doc.update([{ from: cut - 1, to: cut, insert: '' }])
    expect(JSON.stringify(next2.colors())).toBe(JSON.stringify(parse(next2.text).colors()))
  })
})

describe('the registry', () => {
  const options = { colorRoles: ['hl-mint', 'marker-red'] }

  it('takes roles of the registry without the prefix', () => {
    const r = runs('[.marker-red]#x#', options)
    expect(r.map((x) => [x.role, x.known])).toEqual([['marker-red', true]])
    expect(runs('[.hl-mint]#x#', options)[0]!.known).toBe(true)
  })

  it('marks a role hl-* that is not in it and tells with a hint on the name', () => {
    const t = '[.hl-mnit]#x#'
    const doc = parse(t, options)
    expect(doc.colors().map((x) => [x.role, x.known])).toEqual([['hl-mnit', false]])
    const d = doc.diagnostics.filter((x) => x.code === 'unknown-color-role')
    expect(d).toHaveLength(1)
    expect(d[0]!.severity).toBe('info')
    expect(t.slice(d[0]!.from, d[0]!.to)).toBe('hl-mnit')
  })

  it('gives no hint without a registry, and every hl-* is unknown', () => {
    const doc = parse('[.hl-mint]#x#')
    expect(doc.colors().map((x) => x.known)).toEqual([false])
    expect(doc.diagnostics.filter((x) => x.code === 'unknown-color-role')).toEqual([])
  })

  it('gives no hint for roles it knows', () => {
    expect(parse('[.hl-mint.marker-red]#x#', options).diagnostics.filter((x) => x.code === 'unknown-color-role')).toEqual(
      [],
    )
  })

  it('keeps the registry in updates', () => {
    const doc = parse('a\n\n[.marker-red]#x#', options).update([{ from: 0, to: 1, insert: 'bb' }])
    expect(doc.colors().map((x) => x.role)).toEqual(['marker-red'])
  })
})
