// a blank or tab at the end of a line of a cell (not the last line) does not make the cell a plate: the lines of the
// cell are read without them, and an edit keeps them where they are.
import { describe, expect, it } from 'vitest'
import { type Operation, applyOperation, parse } from '@nota-adoc/core'
import { type CellBlock, tableViewAt } from '@nota-adoc/core/internal'

type TextBlock = Extract<CellBlock, { kind: 'text' }>

const A = (tail: string): string =>
  ['|===', 'a|', '[.hl-pink]##foo## +', `[.hl-pink]##bar##${tail}`, '* [.hl-pink]##one##', '|===', ''].join('\n')

const blocksOf = (src: string): readonly CellBlock[] => tableViewAt(parse(src), 0)!.rows[0]![0]!.blocks

describe('trailing blanks of the lines of a cell', () => {
  for (const [name, tail] of [
    ['a blank', ' '],
    ['a tab', '\t'],
    ['several blanks', ' \t  '],
  ] as const) {
    it(`an a-cell with ${name} at the end of a line is read as text`, () => {
      const blocks = blocksOf(A(tail))
      expect(blocks.length).toBeGreaterThan(0)
      for (const b of blocks) {
        expect(b.kind).toBe('text')
        expect((b as TextBlock).readable).toBe(true)
      }
      const reading = (blocks[0] as TextBlock).reading!
      expect(reading.cells.some((c) => c.spans.some((s) => s.attrs.includes('hl-pink')))).toBe(true)
      expect(reading.cells.filter((c) => c.kind === 'break')).toHaveLength(1)
    })
  }

  it('a plain cell with a blank at the end of a line is read', () => {
    const [b] = blocksOf('|===\n|[.hl-pink]##foo## \nbar\n|===\n') as TextBlock[]
    expect(b!.readable).toBe(true)
    expect(b!.reading!.cells.some((c) => c.spans.some((s) => s.attrs.includes('hl-pink')))).toBe(true)
  })

  it('the blocks of a cell with a blank before a blank line are the ones of the same cell without it', () => {
    const shape = (src: string): unknown[] =>
      (blocksOf(src) as TextBlock[]).map((b) => [b.kind, b.readable, b.item?.marker, b.item?.level])
    const mk = (tail: string): string => `|===\na|\nfoo${tail}\n\n* one\n* two\n|===\n`
    const without = shape(mk(''))
    expect(without).toEqual([
      ['text', true, undefined, undefined],
      ['text', true, '*', 1],
      ['text', true, '*', 1],
    ])
    expect(shape(mk(' '))).toEqual(without)
    expect(shape(mk('\t'))).toEqual(without)
  })

  describe('an edit changes nothing but the edit', () => {
    for (const tail of [' ', '\t', '   ']) {
      const src = A(tail)
      const at = src.indexOf('bar') + 1
      const run = (op: Operation): string => {
        const r = applyOperation(parse(src), op)
        if ('error' in r) throw new Error(r.error)
        return r.doc.text
      }
      it(`types, deletes and marks (tail ${JSON.stringify(tail)})`, () => {
        expect(run({ kind: 'insertText', at, text: 'X' })).toBe(src.slice(0, at) + 'X' + src.slice(at))
        expect(run({ kind: 'deleteRange', from: at, to: at + 1 })).toBe(src.slice(0, at) + src.slice(at + 1))
        const marked = run({ kind: 'toggleMark', from: at - 1, to: at + 2, mark: 'strong' })
        expect(marked).toBe(src.replace('##bar##', '##*bar*##'))
      })
    }

    it('types in a line with the blank in the middle of the cell and in the first line', () => {
      const src = '|===\na|\nfirst  \nsecond \t\nthird\n|===\n'
      for (const w of ['first', 'second', 'third']) {
        const at = src.indexOf(w) + 2
        const r = applyOperation(parse(src), { kind: 'insertText', at, text: 'X' })
        if ('error' in r) throw new Error(r.error)
        expect(r.doc.text).toBe(src.slice(0, at) + 'X' + src.slice(at))
      }
    })
  })

  it('an escaped bar keeps the cell a plate, a cell with no blanks is as it was', () => {
    expect(blocksOf('|===\na|\nfoo\\|bar \nbaz\n|===\n').map((b) => b.kind)).toEqual(['plate'])
    const [b] = blocksOf('|===\na|\nfoo\nbar\n|===\n') as TextBlock[]
    expect([b!.kind, b!.readable, b!.text]).toEqual(['text', true, 'foo\nbar'])
  })
})
