// stage 2: a list in a cell `a|` is shown as a list and edited item by item.
import { afterEach, describe, expect, it } from 'vitest'
import { closeAll, inCell, key, open, select, type } from './helpers.js'

afterEach(closeAll)

const T1 = [
  '|===',
  '|Документ |Ссылка',
  'a|* https://c.example.net/x[Пункт один]',
  '* *второй*',
  '|простой текст',
  '|===',
  '',
].join('\n')

const dom = (e: { view: { dom: Element } }): HTMLElement => e.view.dom as HTMLElement
const items = (e: { view: { dom: Element } }): HTMLElement[] => [...dom(e).querySelectorAll<HTMLElement>('.cell-li')]
const here = (e: { view: { state: { selection: { $from: { parent: { textContent: string } } } } } }): string =>
  e.view.state.selection.$from.parent.textContent

describe('a list in an `a` cell is shown as a list', () => {
  it('shows the items with their links and marks, and no source', () => {
    const { editor } = open(T1)
    const li = items(editor)
    expect(li.length).toBe(2)
    expect(li[0]!.querySelector('.li-text')!.innerHTML).toBe('<a href="https://c.example.net/x">Пункт один</a>')
    expect(li[1]!.querySelector('.li-text')!.innerHTML).toBe('<strong>второй</strong>')
    expect(li[0]!.querySelector('.mk')!.textContent).toBe('•')
    expect(dom(editor).querySelector('.cell-plate')).toBeNull()
    const shown = li.map((e) => e.textContent).join('')
    for (const mark of ['[', ']', '*', 'https:']) expect(shown).not.toContain(mark)
  })

  it('numbers an ordered list and shows the boxes of a checklist', () => {
    const { editor } = open('|===\na|. один\n.. вложенный\n. два\na|* [x] готово\n* [ ] нет\n|x\n|===\n')
    const li = items(editor)
    expect(li.map((e) => e.querySelector('.mk')!.textContent)).toEqual(['1.', 'a.', '2.', '•', '•'])
    expect(li.map((e) => e.getAttribute('data-level'))).toEqual(['1', '2', '1', '1', '1'])
    expect(li.slice(3).map((e) => e.querySelector('.chk')!.getAttribute('aria-checked'))).toEqual(['true', 'false'])
  })

  it('leaves a warning box ([NOTE] over ====) as a plate next to a list', () => {
    const { editor } = open('|===\na|* one\n\n[NOTE]\n====\ncare\n====\n|x\n|===\n')
    expect(items(editor).length).toBe(1)
    expect(dom(editor).querySelectorAll('.cell-plate').length).toBeGreaterThanOrEqual(1)
  })

  it('leaves code, a warning and an item with a continuation as plates', () => {
    const { editor } = open('|===\na|----\ncode\n----\n\nNOTE: care\n|a|* one\n+\nmore\n|===\n')
    expect(items(editor).length).toBe(0)
    expect(dom(editor).querySelectorAll('.cell-plate').length).toBeGreaterThanOrEqual(2)
  })
})

describe('items of a cell are edited', () => {
  it('types inside a link: only the text in the brackets changes', () => {
    const { editor, session } = open(T1)
    select(editor, inCell(editor, 'Пункт один', 'start') + 3)
    type(editor, 'x')
    expect(session.text).toBe(T1.replace('[Пункт', '[Пунxкт'))
    key(editor, 'Backspace')
    expect(session.text).toBe(T1)
  })

  it('types and deletes a letter in each item: the text comes back', () => {
    for (const text of ['Пункт один', 'второй']) {
      const { editor, session } = open(T1)
      select(editor, inCell(editor, text, 'start') + 2)
      type(editor, 'я')
      expect(session.text).not.toBe(T1)
      key(editor, 'Backspace')
      expect(session.text).toBe(T1)
      closeAll()
    }
  })

  it('opens an item on Enter at the end of an item, and writes it with the first letters typed', () => {
    const { editor, session } = open(T1)
    inCell(editor, 'второй', 'end')
    key(editor, 'Enter')
    // the item is on the screen and not in the text
    expect(session.text).toBe(T1)
    expect(items(editor).length).toBe(3)
    expect(items(editor)[2]!.classList.contains('nota-draft')).toBe(true)
    type(editor, 'три')
    expect(session.text).toBe(T1.replace('* *второй*', '* *второй*\n* три'))
    expect(items(editor).length).toBe(3)
    expect(items(editor)[2]!.classList.contains('nota-draft')).toBe(false)
    expect(here(editor)).toBe('три')
    key(editor, 'Backspace')
    key(editor, 'Backspace')
    key(editor, 'Backspace')
    // (the last letters go; an empty item is not in the text)
    expect(session.text.startsWith('|===')).toBe(true)
  })

  it('takes the new item away on Backspace or Enter in it, and the text is as it was', () => {
    for (const k of ['Backspace', 'Enter']) {
      const { editor, session } = open(T1)
      inCell(editor, 'второй', 'end')
      key(editor, 'Enter')
      expect(items(editor).length).toBe(3)
      key(editor, k)
      expect(items(editor).length).toBe(2)
      expect(session.text).toBe(T1)
      expect(here(editor)).toBe('второй')
      closeAll()
    }
  })

  it('lets the new item go when the cursor leaves it', () => {
    const { editor, session } = open(T1)
    inCell(editor, 'второй', 'end')
    key(editor, 'Enter')
    key(editor, 'Tab')
    expect(items(editor).length).toBe(2)
    expect(session.text).toBe(T1)
    expect(here(editor)).toBe('простой текст')
  })

  it('splits an item in the middle on Enter', () => {
    const { editor, session } = open(T1)
    select(editor, inCell(editor, 'второй', 'start') + 3)
    key(editor, 'Enter')
    expect(session.text).toBe(T1.replace('* *второй*', '* *вто*\n* *рой*'))
    expect(items(editor).length).toBe(3)
    expect(here(editor)).toBe('рой')
    expect(editor.view.state.selection.$from.parentOffset).toBe(0)
  })

  it('refuses Enter at the start of an item', () => {
    const { editor, session, rejects } = open(T1)
    inCell(editor, 'второй', 'start')
    key(editor, 'Enter')
    expect(session.text).toBe(T1)
    expect(rejects.map((r) => r.code)).toEqual(['item-start'])
  })

  it('does nothing on Enter in a paragraph of an `a` cell', () => {
    const src = '|===\na|Начало *жирный*\n\n* пункт\n|b\n|===\n'
    const { editor, session } = open(src)
    select(editor, inCell(editor, 'Начало жирный', 'start') + 3)
    key(editor, 'Enter')
    expect(session.text).toBe(src)
    expect(items(editor).length).toBe(1)
  })

  it('renumbers the items with written numbers after an item that was added or split', () => {
    const src = '|===\na|1. один\n2. два\n3. три\n|x\n|===\n'
    const a = open(src)
    inCell(a.editor, 'один', 'end')
    key(a.editor, 'Enter')
    type(a.editor, 'между')
    expect(a.session.text).toBe('|===\na|1. один\n2. между\n3. два\n4. три\n|x\n|===\n')
    closeAll()
    const b = open(src)
    select(b.editor, inCell(b.editor, 'два', 'start') + 1)
    key(b.editor, 'Enter')
    expect(b.session.text).toBe('|===\na|1. один\n2. д\n3. ва\n4. три\n|x\n|===\n')
  })

  it('refuses a space as the first thing typed in a new item, and keeps the item', () => {
    const { editor, session, rejects } = open(T1)
    inCell(editor, 'второй', 'end')
    key(editor, 'Enter')
    type(editor, ' ')
    expect(session.text).toBe(T1)
    expect(rejects.map((r) => r.code)).toEqual(['item-start'])
    expect(items(editor).length).toBe(3)
  })

  it('numbers the item that was started in an ordered list, and its level is the one of the item', () => {
    const src = '|===\na|. один\n.. вложенный\n. два\n|x\n|===\n'
    const { editor, session } = open(src)
    inCell(editor, 'вложенный', 'end')
    key(editor, 'Enter')
    expect(items(editor).map((e) => e.querySelector('.mk')!.textContent)).toEqual(['1.', 'a.', 'b.', '2.'])
    type(editor, 'ещё')
    expect(session.text).toBe('|===\na|. один\n.. вложенный\n.. ещё\n. два\n|x\n|===\n')
  })
})

describe('Tab in an item of a cell', () => {
  it('goes to the next cell and back, the text and the level stay', () => {
    const { editor, session } = open(T1)
    select(editor, inCell(editor, 'второй', 'start') + 2)
    key(editor, 'Tab')
    expect(here(editor)).toBe('простой текст')
    // (a cell takes the cursor at the end of its first text)
    key(editor, 'Tab', { shift: true })
    expect(here(editor)).toBe('Пункт один')
    key(editor, 'Tab', { shift: true })
    expect(here(editor)).toBe('Ссылка')
    expect(session.text).toBe(T1)
  })
})

describe('the file stays as it was', () => {
  const FIXTURES = [
    '|===\na|* один\n** вложенный\n* два\n|x\n|===\n',
    '|===\na|. один\n.. вложенный\n. два\n|x\n|===\n',
    '|===\na|* [x] готово\n* [ ] нет\n|x\n|===\n',
    '|===\na|[.cell-yellow]##{empty}##* один *жирный*\n* два\n|x\n|===\n',
    '|===\na|* один\n\n----\ncode\n----\n\nNOTE: care\n\n* два\n|x\n|===\n',
  ]
  it('opens without edits, and types and deletes a letter in every item', () => {
    for (const src of FIXTURES) {
      const { editor, session } = open(src)
      expect(session.text).toBe(src)
      const n = items(editor).length
      for (let i = 0; i < n; i++) {
        const li = items(editor)[i]!
        const text = li.querySelector('.li-text')!.textContent!
        if (text === '') continue
        select(editor, inCell(editor, text, 'start') + 1)
        type(editor, 'я')
        key(editor, 'Backspace')
        expect(session.text).toBe(src)
      }
      closeAll()
    }
  })
})
