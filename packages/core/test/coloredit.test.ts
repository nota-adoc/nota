// colour operations: setColor, replaceColor, removeColor over a range of text.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { type Operation, type ParseOptions, applyOperation, createSession, parse } from '../src/index.js'
import { applyChanges } from '../src/incremental.js'

const fixture = readFileSync(
  fileURLToPath(new URL('../../../quality/fixtures/stage4/colors.adoc', import.meta.url)),
  'utf8',
)

const mint = 'hl-mint'
const plum = 'hl-plum'

/** The range from the first `a` to the end of the first `b` after it (`a` alone: just `a`). */
function span(text: string, a: string, b?: string, nth = 0): [number, number] {
  let from = -1
  for (let i = 0; i <= nth; i++) from = text.indexOf(a, from + 1)
  if (from < 0) throw new Error(`no ${a}`)
  if (b === undefined) return [from, from + a.length]
  const at = text.indexOf(b, from)
  if (at < 0) throw new Error(`no ${b}`)
  return [from, at + b.length]
}

type Spec = { role?: string; replace?: string }

/** Runs an operation and checks what holds for every success: the changes give the text, the colours are the parsed ones. */
function run(
  text: string,
  kind: 'setColor' | 'replaceColor' | 'removeColor',
  a: string,
  b?: string,
  spec: Spec = {},
  options?: ParseOptions,
  nth = 0,
) {
  const [from, to] = span(text, a, b, nth)
  const doc = parse(text, options)
  const r = applyOperation(doc, { kind, from, to, ...spec } as Operation)
  if ('error' in r) return r
  expect(r.doc.text).toBe(applyChanges(text, r.changes))
  expect(r.doc.colors()).toEqual(parse(r.doc.text, options).colors())
  return r
}

const text = (r: ReturnType<typeof run>): string => {
  if ('error' in r) throw new Error(`${r.error}: ${r.diagnostics[0]?.message}`)
  return r.doc.text
}

const set = (src: string, a: string, b?: string, role = mint, options?: ParseOptions) =>
  text(run(src, 'setColor', a, b, { role }, options))
const swap = (src: string, a: string, b: string | undefined, spec: Spec) => text(run(src, 'replaceColor', a, b, spec))
const remove = (src: string, a: string, b?: string, role?: string) =>
  text(run(src, 'removeColor', a, b, role === undefined ? {} : { role }))

/** The colours of the character at `at`. */
const at = (doc: ReturnType<typeof parse>, ch: string, nth = 0): readonly string[] => {
  let i = -1
  for (let k = 0; k <= nth; k++) i = doc.text.indexOf(ch, i + 1)
  return doc.colorAt(i)
}

describe('roles and ranges', () => {
  const src = 'Один два.'
  for (const role of ['note', 'hl-', 'hl-{a}', 'hl-mint x', 'hl-a.b', 'hl-a]', '']) {
    it(`refuses the role ${JSON.stringify(role)}`, () => {
      const r = run(src, 'setColor', 'два', undefined, { role })
      expect('error' in r && r.error).toBe('invalid-role')
      if ('error' in r) expect(r.diagnostics[0]!.code).toBe('invalid-role')
    })
  }

  it('takes a role of the registry of the host', () => {
    expect(set(src, 'два', undefined, 'marker-red', { colorRoles: ['marker-red'] })).toBe('Один [.marker-red]#два#.')
    const r = run(src, 'setColor', 'два', undefined, { role: 'marker-red' })
    expect('error' in r && r.error).toBe('invalid-role')
  })

  it('refuses a replace and a remove role that is not a colour', () => {
    const a = run('[.hl-mint]#x#', 'replaceColor', 'x', undefined, { role: plum, replace: 'note' })
    expect('error' in a && a.error).toBe('invalid-role')
    const b = run('[.hl-mint]#x#', 'removeColor', 'x', undefined, { role: 'note' })
    expect('error' in b && b.error).toBe('invalid-role')
  })

  it('refuses an empty range and a range with no text', () => {
    const doc = parse('a\n\nb [.hl-mint]#c#')
    const empty = applyOperation(doc, { kind: 'setColor', from: 1, to: 1, role: mint })
    expect('error' in empty && empty.error).toBe('empty-selection')
    const blank = applyOperation(doc, { kind: 'setColor', from: 1, to: 3, role: mint })
    expect('error' in blank && blank.error).toBe('empty-selection')
    const marks = applyOperation(doc, { kind: 'setColor', from: 6, to: 16, role: mint })
    expect('error' in marks && marks.error).toBe('empty-selection')
  })

  it('refuses a range outside of the text and leaves the document alone', () => {
    const doc = parse(src)
    for (const [from, to] of [
      [-1, 3],
      [2, 99],
      [1.5, 3],
    ] as const) {
      const r = applyOperation(doc, { kind: 'setColor', from, to, role: mint })
      expect('error' in r && r.error).toBe('invalid-range')
    }
    expect(doc.text).toBe(src)
  })
})

describe('set on plain text', () => {
  it('writes the mark around the word, with two insertions', () => {
    const r = run('Текст важный здесь.', 'setColor', 'важный', undefined, { role: mint })
    if ('error' in r) throw new Error(r.error)
    expect(r.doc.text).toBe('Текст [.hl-mint]#важный# здесь.')
    expect(r.changes).toEqual([
      { from: 6, to: 6, insert: '[.hl-mint]#' },
      { from: 12, to: 12, insert: '#' },
    ])
    expect(r.doc.colors().map((c) => r.doc.text.slice(c.from, c.to))).toEqual(['важный'])
  })

  it('uses the unconstrained mark inside a word', () => {
    expect(set('пример', 'мер')).toBe('при[.hl-mint]##мер##')
    expect(set('слово', 'слово')).toBe('[.hl-mint]#слово#')
  })

  it('does nothing the second time', () => {
    const src = 'Текст [.hl-mint]#важный# здесь.'
    const r = run(src, 'setColor', 'важный', undefined, { role: mint })
    expect('error' in r).toBe(false)
    if (!('error' in r)) expect(r.changes).toEqual([])
  })
})

describe('set on marked-up text', () => {
  it('puts the role on the strong and the emphasis itself', () => {
    expect(set('а *б* в', 'б')).toBe('а [.hl-mint]*б* в')
    expect(set('а _б_ в', 'б')).toBe('а [.hl-mint]_б_ в')
  })

  it('adds a role to a piece and keeps its id and roles', () => {
    const r = run('[.hl-plum]#x#', 'setColor', 'x', undefined, { role: mint })
    if ('error' in r) throw new Error(r.error)
    expect(r.doc.text).toBe('[.hl-plum.hl-mint]#x#')
    expect(r.doc.colorAt(r.doc.text.indexOf('x'))).toEqual([plum, mint])
    expect(set('[#k1.note]#x#', 'x')).toBe('[#k1.note.hl-mint]#x#')
  })
})

describe('across the edges of marks and pieces', () => {
  it('colours across the edge of a strong, which stays where it was', () => {
    const src = 'а *б в* г'
    const r = run(src, 'setColor', 'в', ' г', { role: mint })
    if ('error' in r) throw new Error(r.error)
    const runs = r.doc.colors()
    expect(runs).toHaveLength(1)
    expect(runs[0]!.role).toBe(mint)
    const t = r.doc.text
    expect(t.slice(runs[0]!.from, runs[0]!.to)).toMatch(/^в.*г$/s)
    expect(t.slice(t.indexOf('*'), t.lastIndexOf('*') + 1)).toMatch(/^\*б .*в.*\*$/)
    expect(parse(t).tree.toString()).toContain('Strong')
  })

  it('colours the characters of a strong around a piece', () => {
    const r = run('*а [.hl-plum]#б# в*', 'setColor', 'а', ' в', { role: mint })
    if ('error' in r) throw new Error(r.error)
    const d = r.doc
    expect(at(d, 'а')).toEqual([mint])
    expect(at(d, 'в')).toEqual([mint])
    expect([...at(d, 'б')].sort()).toEqual([mint, plum])
    expect(d.tree.toString()).toContain('Strong')
  })

  it('starts inside one piece and ends inside another', () => {
    const r = run('[.hl-plum]#аб# [.hl-tall]#вг#', 'setColor', 'б', 'в', { role: mint })
    if ('error' in r) throw new Error(r.error)
    const d = r.doc
    expect(at(d, 'а')).toEqual([plum])
    expect(at(d, 'г')).toEqual(['hl-tall'])
    expect([...at(d, 'б')].sort()).toEqual([mint, plum])
    expect([...at(d, 'в')].sort()).toEqual([mint, 'hl-tall'])
  })
})

describe('joining pieces', () => {
  it('joins pieces of the same colour that the new one touches', () => {
    expect(set('[.hl-mint]#а# б [.hl-mint]#в#', ' б ')).toBe('[.hl-mint]#а б в#')
    expect(set('[.hl-mint]##а##б[.hl-mint]##в##', 'б')).toBe('[.hl-mint]#абв#')
    expect(set('[.hl-mint]#а# б', 'б')).toBe('[.hl-mint]#а б#')
  })

  it('does not join pieces of other colours', () => {
    const t = set('[.hl-plum]#а# б', 'б')
    expect(t).toBe('[.hl-plum]#а# [.hl-mint]#б#')
  })

  it('reads two pieces across a strong as one run', () => {
    // the pieces on both sides of a strong stay two pieces in the source; the model reads one run
    const r = run('а *[.hl-mint]#б#* в', 'setColor', 'а', undefined, { role: mint })
    if ('error' in r) throw new Error(r.error)
    expect(r.doc.text).toBe('[.hl-mint]##а ##*[.hl-mint]#б#* в')
    expect(r.doc.text.match(/\[\.hl-mint\]/g)).toHaveLength(2)
    const runs = r.doc.colors()
    expect(runs).toHaveLength(1)
    expect(r.doc.text.slice(runs[0]!.from, runs[0]!.to)).toContain('а')
    expect(r.doc.text.slice(runs[0]!.from, runs[0]!.to)).toContain('б')
  })
})

describe('replace', () => {
  it('renames the role inside the attributes', () => {
    const r = run('[.hl-mint]#x#', 'replaceColor', 'x', undefined, { role: plum })
    if ('error' in r) throw new Error(r.error)
    expect(r.doc.text).toBe('[.hl-plum]#x#')
    expect(r.changes).toHaveLength(1)
    expect(r.changes[0]!.from).toBeGreaterThan(0)
    expect(r.changes[0]!.to).toBeLessThanOrEqual(r.doc.text.indexOf(']'))
  })

  it('splits the piece when a part of it is replaced', () => {
    const r = run('[.hl-mint]##абв##', 'replaceColor', 'б', undefined, { role: plum })
    if ('error' in r) throw new Error(r.error)
    expect(at(r.doc, 'а')).toEqual([mint])
    expect(at(r.doc, 'б')).toEqual([plum])
    expect(at(r.doc, 'в')).toEqual([mint])
  })

  it('replaces one role of several', () => {
    expect(swap('[.hl-mint.hl-tall]#x#', 'x', undefined, { role: plum, replace: 'hl-tall' })).toBe('[.hl-mint.hl-plum]#x#')
  })

  it('without `replace` leaves the range exactly the role, and the other roles and the id where they are', () => {
    const src = '[#k1.hl-mint.note]#x# y'
    const r = run(src, 'replaceColor', 'x', 'y', { role: plum })
    if ('error' in r) throw new Error(r.error)
    expect(at(r.doc, 'x')).toEqual([plum])
    expect(at(r.doc, 'y')).toEqual([plum])
    expect(r.doc.text).toContain('#k1')
    expect(r.doc.text).toContain('note')
  })

  it('with `replace` leaves the characters without that role alone', () => {
    const r = run('[.hl-mint]#а# [.hl-tall]#б#', 'replaceColor', 'а', 'б', { role: plum, replace: 'hl-tall' })
    if ('error' in r) throw new Error(r.error)
    expect(at(r.doc, 'а')).toEqual([mint])
    expect(at(r.doc, 'б')).toEqual([plum])
  })
})

describe('remove', () => {
  it('takes the piece away, or a role of it', () => {
    expect(remove('Текст [.hl-mint]#важный# здесь.', 'важный')).toBe('Текст важный здесь.')
    expect(remove('[.hl-mint.hl-tall]#x#', 'x', undefined, mint)).toBe('[.hl-tall]#x#')
    expect(remove('[#k1.hl-mint.note]#x#', 'x', undefined, mint)).toBe('[#k1.note]#x#')
    expect(remove('[.hl-mint]*x*', 'x')).toBe('*x*')
  })

  it('splits a piece when a part of it is taken away', () => {
    expect(remove('[.hl-mint]#один два три#', 'два')).toBe('[.hl-mint]#один# два [.hl-mint]#три#')
    expect(remove('[.hl-mint]##абв##', 'б')).toBe('[.hl-mint]##а##б[.hl-mint]##в##')
  })

  it('without a role takes all the colours, with one only that', () => {
    const r = run('[.hl-mint.hl-tall]#x#', 'removeColor', 'x')
    expect('error' in r).toBe(false)
    expect(text(r)).toBe('x')
  })

  it('does nothing where there is no colour', () => {
    const r = run('Просто текст', 'removeColor', 'текст')
    if ('error' in r) throw new Error(r.error)
    expect(r.changes).toEqual([])
    const s = run('[.hl-mint]#x# y', 'removeColor', 'y')
    if ('error' in s) throw new Error(s.error)
    expect(s.changes).toEqual([])
  })
})

describe('every place', () => {
  const places: [string, string, string, number][] = [
    ['документа', 'heading', 'Заголовок', 0],
    ['словом', 'paragraph', 'Абзац со', 0],
    ['первый', 'heading', 'Раздел', 0],
    ['заголовок', 'heading', 'Дискретный', 0],
    ['блока', 'block-title', 'Подпись', 0],
    ['маркированный', 'list-item', 'Пункт', 0],
    ['нумерованный', 'list-item', 'Пункт', 0],
    ['списка', 'term', 'Термин', 0],
    ['термина', 'list-item', 'Описание', 0],
    ['в строку', 'admonition', 'Предупреждение', 0],
    ['в блоке', 'paragraph', 'Абзац', 0],
    ['таблицы', 'cell', 'Шапка', 1],
    ['обычная', 'cell', 'Ячейка', 1],
    ['в ячейке', 'paragraph', 'Абзац', 1],
    ['глубины два', 'cell', 'Ячейка', 2],
    ['глубины три', 'cell', 'Ячейка', 3],
    ['черта', 'cell', 'Экранированная', 1],
  ]
  // the fixture with the colour taken off every word, and a plain word where the colour was
  const plain = fixture.replace(/\[\.hl-mint\]#([^#]*)#/g, '$1')
  for (const [word, kind, before, depth] of places) {
    it(`sets and takes off the colour of ${JSON.stringify(word)} (${kind})`, () => {
      const [from, to] = span(plain, word)
      const doc = parse(plain)
      const r = applyOperation(doc, { kind: 'setColor', from, to, role: mint })
      if ('error' in r) throw new Error(`${word}: ${r.error}: ${r.diagnostics[0]?.message}`)
      expect(r.doc.text).toBe(applyChanges(plain, r.changes))
      expect(r.doc.colors()).toEqual(parse(r.doc.text).colors())
      const run1 = r.doc.colors().find((c) => r.doc.text.slice(c.from, c.to) === word)!
      expect(run1, word).toBeDefined()
      expect([run1.container.kind, run1.container.depth]).toEqual([kind, depth])
      void before
      const nf = r.doc.text.indexOf('[.hl-mint]#' + word + '#') + '[.hl-mint]#'.length
      const back = applyOperation(r.doc, { kind: 'removeColor', from: nf, to: nf + word.length })
      if ('error' in back) throw new Error(`${word}: ${back.error}`)
      expect(back.doc.text).toBe(plain)
    })
  }

  it('sets and takes off the colour in a cell of a `:===` table', () => {
    const src = ':===\nЯчейка слово:Другая\n:===\n'
    const [from, to] = span(src, 'слово')
    const r = applyOperation(parse(src), { kind: 'setColor', from, to, role: mint })
    if ('error' in r) throw new Error(`${r.error}: ${r.diagnostics[0]?.message}`)
    expect(r.doc.text).toBe(':===\nЯчейка [.hl-mint]#слово#:Другая\n:===\n')
    expect(r.doc.colors()).toEqual(parse(r.doc.text).colors())
    const run1 = r.doc.colors().find((c) => r.doc.text.slice(c.from, c.to) === 'слово')!
    expect([run1.container.kind, run1.container.depth]).toEqual(['cell', 1])
    const nf = r.doc.text.indexOf('слово')
    const back = applyOperation(r.doc, { kind: 'removeColor', from: nf, to: nf + 5 })
    if ('error' in back) throw new Error(back.error)
    expect(back.doc.text).toBe(src)
  })

  it('sets the colour on the text of a link and a cross reference', () => {
    const t1 = set('Ссылка https://example.org[текст] тут.', 'текст')
    expect(t1).toBe('Ссылка https://example.org[[.hl-mint]#текст#] тут.')
    const t2 = set('Ссылка <<id,текст>> тут.\n\n[#id]\n== Цель', 'текст')
    expect(t2.startsWith('Ссылка <<id,[.hl-mint]#текст#>> тут.')).toBe(true)
    expect(remove(t1, 'текст')).toBe('Ссылка https://example.org[текст] тут.')
  })

  it('sets the colour in a CSV cell with a quote in it', () => {
    const src = '[format="csv"]\n|===\n"скажи ""да"" сейчас"\n|===\n'
    const out = set(src, 'сейчас')
    expect(out).toBe('[format="csv"]\n|===\n"скажи ""да"" [.hl-mint]#сейчас#"\n|===\n')
    const cell = parse(out).tableAt(out.indexOf('сейчас'))!.rows.body[0]!.cells[0]!
    expect(cell.text).toContain('"да"')
    expect(out).toContain('""да""')
  })
})

describe('where there is no colour', () => {
  const refused: [string, string, string][] = [
    ['listing', '----\nслово\n----', 'слово'],
    ['literal block', '....\nслово\n....', 'слово'],
    ['literal paragraph', ' слово', 'слово'],
    ['literal cell', '|===\nl|слово\n|===', 'слово'],
    ['plus passthrough', 'x +слово+ y', 'слово'],
    ['pass macro', 'pass:[слово]', 'слово'],
    ['pass quotes', 'pass:q[слово]', 'слово'],
    ['index term', '((слово))', 'слово'],
    ['line comment', '// слово', 'слово'],
    ['block comment', '////\nслово\n////', 'слово'],
    ['ifdef off', 'ifdef::nope[]\nслово\nendif::[]', 'слово'],
    ['attribute value', ':attr: слово', 'слово'],
  ]
  for (const [name, src, word] of refused) {
    it(`refuses ${name}`, () => {
      const doc = parse(src)
      const [from, to] = span(src, word)
      const r = applyOperation(doc, { kind: 'setColor', from, to, role: mint })
      expect('error' in r && r.error).toBe('not-colorable')
    })
  }

  it('refuses a range that ends inside a construct that is not text', () => {
    for (const [src, a, b] of [
      ['Видно https://example.org[текст] тут', 'Видно', 'example'],
      ['Видно image:pic.png[] тут', 'Видно', 'pic'],
      ['Видно <<id>> тут\n\n[#id]\n== Цель', 'Видно', 'id'],
      ['Видно +не текст+ тут', 'Видно', 'не'],
    ] as const) {
      const [from, to] = span(src, a, b)
      const r = applyOperation(parse(src), { kind: 'setColor', from, to, role: mint })
      expect('error' in r && r.error, src).toBe('inside-construct')
    }
  })

  it('colours both paragraphs around a listing and leaves the listing as it is', () => {
    const src = 'один абзац\n\n----\nлистинг\n----\n\nдругой абзац\n'
    const r = run(src, 'setColor', 'абзац', 'другой', { role: mint })
    if ('error' in r) throw new Error(r.error)
    expect(r.doc.text).toContain('\n\n----\nлистинг\n----\n\n')
    expect(r.doc.colors()).toHaveLength(2)
  })
})

describe('several places', () => {
  it('gives a piece to each paragraph and keeps the blank line', () => {
    const src = 'Первый абзац\n\nВторой абзац\n'
    const r = run(src, 'setColor', 'абзац', 'Второй', { role: mint })
    if ('error' in r) throw new Error(r.error)
    expect(r.doc.text).toBe('Первый [.hl-mint]#абзац#\n\n[.hl-mint]#Второй# абзац\n')
  })

  it('gives a piece to each of two cells and keeps the table', () => {
    const src = '|===\n|один |два\n|три |четыре\n|===\n'
    const before = parse(src).tableAt(5)!
    const r = run(src, 'setColor', 'один', 'два', { role: mint })
    if ('error' in r) throw new Error(r.error)
    expect(r.doc.text).toBe('|===\n|[.hl-mint]#один# |[.hl-mint]#два#\n|три |четыре\n|===\n')
    const grid = (d: ReturnType<typeof parse>) =>
      [...d.tableAt(5)!.rows.body].map((row) => row.cells.map((c) => c.text.replace(/\[\.hl-mint\]#|#/g, '')))
    expect(grid(r.doc)).toEqual([...before.rows.body].map((row) => row.cells.map((c) => c.text)))
  })
})

describe('an id with a colour', () => {
  it('keeps the id when the colour goes and when it comes', () => {
    expect(remove('[#k1.hl-mint]#x#', 'x')).toBe('[#k1]#x#')
    expect(set('[#k1]#x#', 'x')).toBe('[#k1.hl-mint]#x#')
  })
})

describe('the least change', () => {
  it('never changes the text, the marks or the source outside of the places it touches', () => {
    const cases: [string, string, string?][] = [
      ['а *б в* г **д**е', 'б', 'д'],
      ['a `code` and *strong _both_* end', 'code', 'end'],
      ['Ссылка https://example.org[текст] и слово', 'текст', 'слово'],
      ['x\\|y [.hl-mint]#z# w', 'y', 'w'],
    ]
    for (const [src, a, b] of cases) {
      const r = run(src, 'setColor', a, b, { role: mint })
      if ('error' in r) throw new Error(`${src}: ${r.error}: ${r.diagnostics[0]?.message}`)
      const strip = (s: string) => s.replace(/\[\.[^\]]*\]/g, '').replace(/##?/g, '')
      expect(strip(r.doc.text)).toBe(strip(src))
    }
  })

  it('refuses a title that the colour would break', () => {
    const src = 'Заголовок\n=========\n\nтекст\n'
    const r = run(src, 'setColor', 'Заголовок', undefined, { role: mint })
    expect('error' in r && ['collateral', 'unstable'].includes(r.error)).toBe(true)
  })
})

describe('the session', () => {
  it('applies, undoes and redoes a colour', () => {
    const src = 'Текст важный здесь.\n'
    const s = createSession(src)
    const [from, to] = span(src, 'важный')
    const r = applyOperation(s.doc, { kind: 'setColor', from, to, role: mint })
    if ('error' in r) throw new Error(r.error)
    s.apply(r.changes)
    expect(s.text).toBe('Текст [.hl-mint]#важный# здесь.\n')
    s.undo()
    expect(s.text).toBe(src)
    s.redo()
    expect(s.text).toBe(r.doc.text)
  })
})
