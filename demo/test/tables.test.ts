// the sample «Таблицы». In «Исходник» the separators and the specs of the cells look like the delimiters of blocks,
// the text of an `a` cell like blocks, the table folds by its opening line; in «Визуально» the table is a plate, and editing the
// paragraph next to it does not change the table.
import { foldable } from '@codemirror/language'
import { EditorView } from '@codemirror/view'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { choose, closePage, fixture, openPage, outgoing, selectText, stubNetwork } from './helpers.js'

beforeEach(() => {
  outgoing.length = 0
  stubNetwork()
})
afterEach(closePage)

const text = fixture('editor/tables.adoc')

describe('demo: the sample «Таблицы»', () => {
  it('is in the list of the samples and opens in both windows without diagnostics', async () => {
    const page = await openPage()
    expect([...page.sample.options].map((o) => o.text)).toContain('Таблицы')
    choose(page, 'tables')
    expect(page.text()).toBe(text)
    expect(page.cm().state.doc.toString()).toBe(text)
    expect(page.count('error')).toBe('0')
    expect(page.count('warning')).toBe('0')
    expect(page.count('info')).toBe('0')
  })

  it('«Исходник»: separators and specs look like the delimiters of blocks, the text of an `a` cell like blocks, the table folds', async () => {
    const page = await openPage()
    choose(page, 'tables')
    const view = page.cm()
    const marked = (group: string) =>
      [...view.dom.querySelectorAll<HTMLElement>(`.cm-ap-${group}`)].map((e) => e.textContent)
    // the viewport of jsdom holds the first lines only: it is moved to the place that is looked at
    const show = (needle: string) => view.dispatch({ effects: EditorView.scrollIntoView(text.indexOf(needle)) })
    show('3+^.^s')
    // `|===`, `|`, a spec of alignment, and the specs with a span, a style and a repetition
    expect(marked('blockDelimiter')).toEqual(
      expect.arrayContaining(['|===', '|', '>', '3+^.^s', '.2+', '>m', '2*']),
    )
    // the text of a cell with the `a` style is highlighted as the blocks of a document: a list, a block of code
    show('* первый пункт')
    expect(marked('listMarker')).toContain('*')
    expect(marked('blockDelimiter')).toContain('----')
    // the table folds by its opening line: from the end of it to the last row, the closing line stays
    const line = view.state.doc.lineAt(text.indexOf('|==='))
    const range = foldable(view.state, line.from, line.to)
    expect(range, 'the fold range of the opening line').not.toBeNull()
    expect(text.slice(range!.from, range!.to)).toMatch(/^\n\|Номер \|Описание \|Сумма[\s\S]*\n>\|80$/)
  })

  it('«Визуально»: a table is a grid (one that cannot be rewritten is a plate), and editing the paragraph above changes nothing in the tables', async () => {
    const page = await openPage()
    choose(page, 'tables')
    const top = (text.match(/^\|===$/gm) ?? []).length / 2
    const grids = () => [...page.pm().dom.querySelectorAll(':scope > .tbl')].map((e) => e.textContent!)
    const plates = () =>
      [...page.pm().dom.querySelectorAll('.nota-island .island-src')].map((e) => e.textContent!).filter((t) => t.includes('|==='))
    // a grid for each table of the text that the operations can write back; the tables in the cells are inside the grids
    expect(top).toBeGreaterThan(5)
    expect(grids().length).toBe(top - 1)
    expect(plates().length).toBe(1)
    expect(plates()[0]).toContain('2*|повторяется')
    expect(grids().join('\n')).toContain('Вложенная таблица')
    expect(page.pm().dom.querySelectorAll('.tbl .tbl').length).toBeGreaterThanOrEqual(2)
    for (const el of page.pm().dom.querySelectorAll(':scope > p, :scope > li, :scope > h2, :scope > h3'))
      expect(el.textContent, 'the text of cells is not a paragraph of the editor').not.toContain('Ключ')
    const before = [grids(), plates()]
    // a word in the paragraph above the first table is typed in «Визуально»
    selectText(page, 'Абзац над таблицей')
    const view = page.pm()
    view.dispatch(view.state.tr.insertText(' Новое слово.', view.state.selection.to))
    const now = page.text()
    expect(now).toBe(text.replace('Абзац над таблицей', 'Абзац над таблицей Новое слово.'))
    expect(page.cm().state.doc.toString()).toBe(now)
    expect([grids(), plates()]).toEqual(before)
    const from = text.indexOf('== Строки и заголовок')
    expect(now.slice(now.indexOf('== Строки и заголовок'))).toBe(text.slice(from))
  })
})
