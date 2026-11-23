// stage 2: the items of a list in an `a` cell are blocks of text, and an edit of a paragraph or an item of
// such a cell does not change how the other blocks of the cell read.
import { describe, expect, it } from 'vitest'
import { type Operation, applyOperation, parse } from '@nota-adoc/core'
import { type CellBlock, insertCellItem, splitCellItem, tableViewAt } from '@nota-adoc/core/internal'

type TextBlock = Extract<CellBlock, { kind: 'text' }>

const LIST = [
  '|===',
  '|Документ |Список',
  'a|* https://c.example.net/x[Пункт один]',
  '* *второй*',
  '|простой текст',
  '|===',
  '',
].join('\n')

const blocksOf = (text: string): CellBlock[] => tableViewAt(parse(text), 0)!.rows.flat().flatMap((c) => c.blocks)
const textOf = (text: string): TextBlock[] => blocksOf(text).filter((b): b is TextBlock => b.kind === 'text')

/** Applies an operation and gives the text after it, or the code of the refusal. */
function run(text: string, op: Operation): string {
  const doc = parse(text)
  const r =
    op.kind === 'splitBlock'
      ? splitCellItem(doc, op.at)
      : op.kind === 'insertItem'
        ? insertCellItem(doc, op.after, op.level, op.text)
        : applyOperation(doc, op)
  return 'error' in r ? 'fail:' + r.error : r.doc.text
}

describe('the items of a list in an `a` cell', () => {
  it('are blocks of text with their marker and level, and read with links and marks', () => {
    const items = textOf(LIST).filter((b) => b.item)
    expect(items.map((b) => b.item)).toEqual([
      { marker: '*', level: 1, checked: '' },
      { marker: '*', level: 1, checked: '' },
    ])
    expect(items[0]!.reading!.cells.map((c) => c.ch).join('')).toBe('Пункт один')
    expect(items[0]!.reading!.cells[0]!.spans.map((s) => s.type)).toEqual(['link'])
    expect(items[1]!.reading!.cells[0]!.spans.map((s) => s.type)).toEqual(['strong'])
    expect(blocksOf(LIST).some((b) => b.kind === 'plate')).toBe(false)
  })

  it('are numbered and check items, and nest by level', () => {
    const src = '|===\na|. один\n.. вложенный\n. два\na|* [x] готово\n* [ ] нет\n|x\n|===\n'
    const items = textOf(src).filter((b) => b.item)
    expect(items.map((b) => [b.item!.marker, b.item!.level, b.item!.checked])).toEqual([
      ['.', 1, ''],
      ['..', 2, ''],
      ['.', 1, ''],
      ['*', 1, 'x'],
      ['*', 1, ' '],
    ])
  })

  it('stay plates: code, a warning, an item with a continuation', () => {
    const code = blocksOf('|===\na|----\ncode\n----\n|x\n|===\n')
    expect(code.map((b) => b.kind)).toContain('plate')
    const warn = blocksOf('|===\na|NOTE: be careful\n\ntext\n|x\n|===\n')
    expect(warn[0]!.kind).toBe('plate')
    const cont = blocksOf('|===\na|* one\n+\nmore\n|x\n|===\n')
    expect(cont.filter((b) => b.kind === 'plate').length).toBe(1)
    expect(cont.filter((b) => b.kind === 'text' && b.item).length).toBe(0)
  })
})

describe('an edit in an item', () => {
  it('types inside the text of a link: only the text in the brackets changes', () => {
    const at = LIST.indexOf('Пункт') + 2
    expect(run(LIST, { kind: 'insertText', at, text: 'x' })).toBe(LIST.replace('[Пункт', '[Пуxнкт'))
  })

  it('types a letter and deletes it in every item: the text is as it was', () => {
    for (const marker of ['Пункт', 'второй']) {
      const at = LIST.indexOf(marker) + 2
      const typed = applyOperation(parse(LIST), { kind: 'insertText', at, text: 'x' })
      if ('error' in typed) throw new Error(typed.error)
      const back = applyOperation(typed.doc, { kind: 'deleteRange', from: at, to: at + 1 })
      if ('error' in back) throw new Error(back.error)
      expect(back.doc.text).toBe(LIST)
    }
  })

  it('splits an item in the middle, and adds an item after the last', () => {
    const at = LIST.indexOf('второй') + 3
    expect(run(LIST, { kind: 'splitBlock', at })).toBe(LIST.replace('* *второй*', '* *вто*\n* *рой*'))
    const last = LIST.indexOf('второй') + 1
    expect(run(LIST, { kind: 'insertItem', after: last, level: 1, text: 'три' })).toBe(
      LIST.replace('* *второй*', '* *второй*\n* три'),
    )
  })

  it('is refused by applyOperation: splitBlock and insertItem in an item leave the file alone', () => {
    const doc = parse(LIST)
    const split = applyOperation(doc, { kind: 'splitBlock', at: LIST.indexOf('второй') + 3 })
    const insert = applyOperation(doc, { kind: 'insertItem', after: LIST.indexOf('второй') + 1, level: 1, text: 'три' })
    expect('error' in split && split.error).toBe('inside-plate')
    expect('error' in insert && insert.error).toBe('inside-plate')
  })

  it('renumbers the written numbers after an item that was added or split', () => {
    const src = '|===\na|1. один\n2. два\n3. три\n|x\n|===\n'
    expect(run(src, { kind: 'insertItem', after: src.indexOf('один') + 1, level: 1, text: 'между' })).toBe(
      '|===\na|1. один\n2. между\n3. два\n4. три\n|x\n|===\n',
    )
    expect(run(src, { kind: 'splitBlock', at: src.indexOf('два') + 1 })).toBe('|===\na|1. один\n2. д\n3. ва\n4. три\n|x\n|===\n')
  })

  it('does not split at the ends of an item', () => {
    const start = LIST.indexOf('Пункт')
    expect(run(LIST, { kind: 'splitBlock', at: start })).toBe(LIST)
  })

  it('adds an item on another level, of the kind of the list', () => {
    const src = '|===\na|. один\n. два\n|x\n|===\n'
    const at = src.indexOf('один') + 1
    expect(run(src, { kind: 'insertItem', after: at, level: 2, text: 'вложенный' })).toBe(
      '|===\na|. один\n.. вложенный\n. два\n|x\n|===\n',
    )
    expect(run('|===\na|* [ ] a\n|x\n|===\n', { kind: 'insertItem', after: 13, level: 1, text: 'b' })).toBe(
      '|===\na|* [ ] a\n* [ ] b\n|x\n|===\n',
    )
  })

  it('leaves the rest of the cell and the file alone', () => {
    const ok = '|===\na|intro\n\n* one\n* two\n\n----\ncode\n----\n|x\n|===\n'
    const r = run(ok, { kind: 'insertText', at: ok.indexOf('two') + 1, text: 'x' })
    expect(r).toBe(ok.replace('two', 'txwo'))
  })
})

describe('an edit does not change how the other blocks of an `a` cell read', () => {
  it('refuses to make an item of a paragraph above a list: the list would take it in', () => {
    const src = '|===\na|x* один\n\n* пункт\n|y\n|===\n'
    const at = src.indexOf('x')
    expect(run(src, { kind: 'deleteRange', from: at, to: at + 1 })).toBe('fail:collateral')
  })

  it('refuses the same for a paragraph above a list of the next line, and for an item', () => {
    const src = '|===\na|* a\n\ny* b\n\n* c\n|y\n|===\n'
    const at = src.indexOf('y')
    expect(run(src, { kind: 'deleteRange', from: at, to: at + 1 })).toMatch(/^fail:/)
  })

  it('writes an edit that changes nothing else', () => {
    const src = '|===\na|abc\n\n* пункт\n|y\n|===\n'
    expect(run(src, { kind: 'insertText', at: src.indexOf('abc') + 1, text: 'x' })).toBe(src.replace('abc', 'axbc'))
  })
})

describe('a list with a blank line in an `a` cell keeps the strict rule', () => {
  it('shows no items of it as text blocks', () => {
    const src = '|===\na|* a\n\n* b\n|y\n|===\n'
    expect(textOf(src).filter((b) => b.item)).toEqual([])
  })
})
