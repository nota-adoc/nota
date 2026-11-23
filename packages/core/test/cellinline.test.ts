// the text of a table cell with no `a` style is read like a paragraph; typing, deleting, marks and links in it write the
// same source as in a paragraph with the same line.
import { describe, expect, it } from 'vitest'
import { type Operation, applyOperation, parse } from '@nota-adoc/core'
import { type CellBlock, tableViewAt } from '@nota-adoc/core/internal'

const T1 = [
  '|===',
  '|Документ |Ссылка',
  '|Требования |https://c.example.net/a[Ссылка] и *жирный*',
  '|Обзор |xref:b.adoc[Другая], <<sec-a>>, _курсив_, `код`, [.zz-a]#цвет#',
  'a|* https://c.example.net/x[Пункт один]',
  '* *второй*',
  '|простой текст',
  '|===',
  '',
].join('\n')

type TextBlock = Extract<CellBlock, { kind: 'text' }>

/** The text blocks of the first table of a text, cell after cell. */
function blocksOf(text: string): TextBlock[] {
  const v = tableViewAt(parse(text), 0)!
  return v.rows.flat().flatMap((c) => c.blocks.filter((b): b is TextBlock => b.kind === 'text'))
}

describe('what a cell reads as', () => {
  it('reads links, marks and roles of a plain cell, and leaves plain words alone', () => {
    const [head, , , link, , other, , , simple] = blocksOf(T1)
    expect(head!.readable).toBe(true)
    expect(head!.reading).toBeNull()
    expect(link!.reading!.cells.map((c) => c.ch).join('')).toBe('Ссылка и жирный')
    expect(link!.reading!.cells[0]!.spans.map((s) => s.type)).toEqual(['link'])
    expect(link!.reading!.cells[10]!.spans.map((s) => s.type)).toEqual(['strong'])
    expect(other!.reading!.cells.map((c) => c.ch).join('')).toBe('Другая, sec-a, курсив, код, цвет')
    expect(simple!.reading).toBeNull()
  })

  it('does not read the cells that stand in the source otherwise than they read', () => {
    const src = '|===\nl|*x* |a\\|b *x*\nm|*y* s|*z*\n|===\n'
    expect(blocksOf(src).map((b) => b.readable)).toEqual([false, false, false, false])
    const csv = parse(',===\n"a *b*",c\n,===\n')
    const cell = tableViewAt(csv, 0)!.rows[0]![0]!.blocks[0]!
    expect(cell.kind === 'text' && cell.readable).toBe(false)
  })

  it('reads an attribute reference as a plate, and the fill label is not part of the text', () => {
    const [a, b] = blocksOf('|===\n|{name} and *x* |[.cell-yellow]##{empty}##https://c.example.net/a[L] x\n|===\n')
    expect(a!.reading!.cells.some((c) => c.kind === 'chip' && c.src === '{name}')).toBe(true)
    expect(b!.reading!.cells.map((c) => c.ch).join('')).toBe('L x')
    expect(b!.reading!.cells[0]!.spans[0]!.href).toBe('https://c.example.net/a')
  })

  it('reads a cell of several lines, and leaves the one with a blank line as text', () => {
    const [a] = blocksOf('|===\n|one *two*\nthree |x\n|===\n')
    expect(a!.reading!.cells.map((c) => c.ch).join('')).toBe('one two three')
    const [b] = blocksOf('|===\n|one *two*\n\nthree |x\n|===\n')
    expect(b!.readable).toBe(false)
  })
})

describe('an edit in a cell writes what it writes in a paragraph', () => {
  const LINES = [
    'https://c.example.net/a[Ссылка] и *жирный* и `код`',
    'xref:b.adoc[Другая] и <<sec-a,Раздел>> и _курсив_',
    '[.zz-a]#цвет# и *жирный _вложенный_*',
    'просто текст *жирный*текст',
  ]

  function both(line: string, make: (shift: number) => Operation | null): { cell: string; para: string; same: boolean } | null {
    const p = parse(line + '\n')
    const cellSrc = `|===\n|a |${line}\n|===\n`
    const c = parse(cellSrc)
    const shift = cellSrc.indexOf(line)
    const op = make(0)
    const op2 = make(shift)
    if (!op || !op2) return null
    const a = applyOperation(p, op)
    const b = applyOperation(c, op2)
    const reduce = (r: ReturnType<typeof applyOperation>, text: string): string =>
      'error' in r ? `error:${r.error}` : r.doc.text.slice(text === line + '\n' ? 0 : shift, r.doc.text.length - (text === line + '\n' ? 1 : '\n|===\n'.length))
    const pa = reduce(a, line + '\n')
    const ce = reduce(b, cellSrc)
    return { para: pa, cell: ce, same: pa === ce }
  }

  it('types at every offset: the same source, or the same refusal', () => {
    for (const line of LINES)
      for (const ch of ['x', '*', '_', '[', '#', 'я']) {
        for (let at = 0; at <= line.length; at++) {
          const r = both(line, (s) => ({ kind: 'insertText', at: at + s, text: ch }))
          expect(r, `${line} @${at} ${ch}`).not.toBeNull()
          expect(r!.cell, `${line} @${at} ${ch}`).toBe(r!.para)
        }
      }
  })

  it('deletes ranges: the same source, or the same refusal', () => {
    for (const line of LINES)
      for (let from = 0; from < line.length; from += 2)
        for (const len of [1, 2, 5, 9]) {
          const to = Math.min(line.length, from + len)
          const r = both(line, (s) => ({ kind: 'deleteRange', from: from + s, to: to + s }))
          expect(r!.cell, `${line} ${from}-${to}`).toBe(r!.para)
        }
  })

  it('replaces ranges with text, and marks and links them', () => {
    for (const line of LINES)
      for (let from = 0; from < line.length; from += 3)
        for (const len of [3, 6]) {
          const to = Math.min(line.length, from + len)
          for (const make of [
            (s: number): Operation => ({ kind: 'replaceText', from: from + s, to: to + s, text: 'ab' }),
            (s: number): Operation => ({ kind: 'toggleMark', from: from + s, to: to + s, mark: 'strong' }),
            (s: number): Operation => ({ kind: 'toggleMark', from: from + s, to: to + s, mark: 'em' }),
            (s: number): Operation => ({ kind: 'setLink', from: from + s, to: to + s, target: 'https://c.example.net/n' }),
            (s: number): Operation => ({ kind: 'setColor', from: from + s, to: to + s, role: 'hl-red' }),
          ]) {
            const r = both(line, make)
            expect(r!.cell, `${line} ${from}-${to} ${make(0).kind}`).toBe(r!.para)
          }
        }
  })

  it('takes a link off and changes its address', () => {
    const line = LINES[0]!
    for (const make of [
      (s: number): Operation => ({ kind: 'removeLink', at: 5 + s }),
      (s: number): Operation => ({ kind: 'setLink', from: 5 + s, to: 5 + s, target: 'https://c.example.net/b' }),
    ]) {
      const r = both(line, make)
      expect(r!.cell).toBe(r!.para)
      expect(r!.cell).not.toBe(line)
    }
  })
})

describe('the source of a cell is written so that the table reads as before', () => {
  it('refuses a bar in a text with a link, and the file stays', () => {
    const doc = parse(T1)
    const at = T1.indexOf('[Ссылка]') + 3
    const r = applyOperation(doc, { kind: 'insertText', at, text: '|' })
    expect('error' in r).toBe(true)
  })

  it('refuses an end that would be read as the spec of the next cell', () => {
    const src = '|===\n|a *b*\n|c\n|===\n'
    const doc = parse(src)
    const at = src.indexOf('*b*') + 3
    const r = applyOperation(doc, { kind: 'insertText', at, text: ' 2+' })
    // either a refusal, or the table as it was: two cells, the second `c` with no span
    const cells = 'error' in r ? null : tableViewAt(r.doc, 0)!.rows.flat()
    expect(cells === null || (cells.length === 2 && cells[1]!.text === 'c' && cells[1]!.colspan === 1)).toBe(true)
  })

  it('reads the paragraphs of an `a` cell and writes them back by offsets, the blocks around them untouched', () => {
    const src = '|===\na|Начало *жирный* и https://c.example.net/a[Ссылка]\n\n* пункт\n\nВторой _курсив_\n|b\n|===\n'
    const doc = parse(src)
    const blocks = tableViewAt(doc, 0)!.rows[0]![0]!.blocks
    expect(blocks.map((b) => b.kind)).toEqual(['text', 'text', 'text'])
    const [one, , two] = blocks as TextBlock[]
    expect(one!.readable).toBe(true)
    expect(one!.reading!.cells.some((c) => c.kind === 'char' && c.spans.length > 0)).toBe(true)
    expect(two!.reading!.cells.map((c) => (c.kind === 'char' ? c.ch : '')).join('')).toBe('Второй курсив')
    // typing inside the link of the first paragraph and inside the second one
    const at = src.indexOf('[Сс') + 3
    const r = applyOperation(doc, { kind: 'insertText', at, text: 'x' })
    expect('error' in r).toBe(false)
    if (!('error' in r)) expect(r.doc.text).toBe(src.slice(0, at) + 'x' + src.slice(at))
    const at2 = src.indexOf('Второй') + 2
    const r2 = applyOperation(doc, { kind: 'insertText', at: at2, text: 'x' })
    expect('error' in r2).toBe(false)
    if (!('error' in r2)) expect(r2.doc.text).toBe(src.slice(0, at2) + 'x' + src.slice(at2))
    // a mark over a word of the second paragraph
    const from = src.indexOf('Второй')
    const m = applyOperation(doc, { kind: 'toggleMark', from, to: from + 6, mark: 'strong' })
    expect('error' in m).toBe(false)
    if (!('error' in m)) expect(m.doc.text).toBe(src.replace('Второй _', '*Второй* _'))
  })

  it('changes only the cell that is typed in, nothing else of the file', () => {
    const doc = parse(T1)
    const at = T1.indexOf('[Ссылка]') + 3
    const r = applyOperation(doc, { kind: 'insertText', at, text: 'x' })
    expect('error' in r).toBe(false)
    if (!('error' in r)) {
      expect(r.changes).toEqual([{ from: at, to: at, insert: 'x' }])
      expect(r.doc.text).toBe(T1.slice(0, at) + 'x' + T1.slice(at))
    }
  })
})

describe('a cell with CRLF line ends', () => {
  const cell = (src: string): TextBlock => blocksOf(src)[0]!

  it('reads a cell of two lines as the same cell with LF', () => {
    const crlf = cell('|===\r\n|one *two*\r\nthree\r\n|===\r\n')
    expect(crlf.readable).toBe(true)
    expect(crlf.reading!.cells.map((c) => c.ch).join('')).toBe('one two three')
    expect(crlf.reading!.cells.some((c) => c.ch === '\r' || c.ch === '\n')).toBe(false)
  })

  it('types after a line with blanks before its CRLF, and puts the letter where it is typed', () => {
    const src = '|===\r\n|first  \r\nsecond\r\n|===\r\n'
    const at = src.indexOf('second')
    const r = applyOperation(parse(src), { kind: 'insertText', at, text: 'x' })
    expect('error' in r).toBe(false)
    if (!('error' in r)) expect(r.doc.text).toBe(src.slice(0, at) + 'x' + src.slice(at))
  })

  it('does not read a cell with a lone CR in it', () => {
    expect(cell('|===\n|one *two*\rthree\n|===\n').readable).toBe(false)
  })
})
