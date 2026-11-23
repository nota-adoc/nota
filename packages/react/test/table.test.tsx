// the panel over a table in the React package.
import { TableBar, messages } from '@nota-adoc/react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { TextSelection } from 'prosemirror-state'
import { describe, expect, it } from 'vitest'
import { CYRILLIC, open, setupCleanup } from './helpers.js'

setupCleanup()

const TEXT = 'before\n\n[cols="1,2",options="header"]\n|===\n|No |Name\n|1\n|Cabinet\n|===\n'
const NESTED = '|===\na|\nOuter\n\n!===\n!x !y\n!===\n|===\n'

type Editor = ReturnType<typeof open>['editor']

/** The cursor at the end of the text of the cell `text`. */
function inCell(editor: Editor, text: string): void {
  let found = -1
  editor.view.state.doc.descendants((node, pos) => {
    if (found < 0 && node.type.name === 'cell_text' && node.textContent === text) found = pos + 1 + node.content.size
    return found < 0
  })
  if (found < 0) throw new Error(`no cell ${text}`)
  const { state } = editor.view
  editor.view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, found)))
}

const bar = (editor: Editor, locale: 'ru' | 'en' = 'ru') =>
  render(<TableBar editor={editor} locale={locale} container={document.body} />)

describe('the panel of a table', () => {
  it('shows nine buttons with hints over a cell, and nothing outside a table', () => {
    const s = open(TEXT)
    bar(s.editor)
    expect(screen.queryByRole('toolbar', { name: 'Таблица' })).toBeNull()
    act(() => inCell(s.editor, 'Cabinet'))
    const panel = screen.getByRole('toolbar', { name: 'Таблица' })
    expect([...panel.querySelectorAll('button')].map((b) => b.getAttribute('title'))).toEqual([
      'Добавить ряд ниже',
      'Добавить колонку справа',
      'Удалить ряд',
      'Удалить колонку',
      'Объединить ячейки · Shift+щелчок по второй ячейке',
      'Разделить объединённую ячейку',
      'Первый ряд — шапка',
      'Вложить таблицу в эту ячейку',
      'Удалить таблицу',
    ])
    expect(panel.querySelector('.fl-chip')).toBeNull()
  })

  it('marks the level of a table in a cell and names the deletion of it', () => {
    const s = open(NESTED)
    bar(s.editor)
    act(() => inCell(s.editor, 'x'))
    const panel = screen.getByRole('toolbar', { name: 'Таблица' })
    expect(panel.querySelector('.fl-chip')!.textContent).toBe('уровень 2')
    expect(panel.querySelector('[data-cmd="table-del"]')!.getAttribute('title')).toBe('Удалить вложенную таблицу')
    act(() => inCell(s.editor, 'Outer'))
    expect(screen.getByRole('toolbar', { name: 'Таблица' }).querySelector('.fl-chip')).toBeNull()
  })

  it('presses the head button when the table has a head, and one click turns it off and on', () => {
    const s = open(TEXT)
    bar(s.editor)
    act(() => inCell(s.editor, 'Cabinet'))
    const head = (): HTMLElement => screen.getByLabelText('Первый ряд — шапка')
    expect(head().getAttribute('aria-pressed')).toBe('true')
    const before = s.session.text
    fireEvent.click(head())
    expect(s.session.text).not.toBe(before)
    expect(head().getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(head())
    expect(s.session.text).toBe(before)
    expect(head().getAttribute('aria-pressed')).toBe('true')
  })

  it('runs a command as one step of the history', () => {
    const s = open(TEXT)
    bar(s.editor)
    act(() => inCell(s.editor, 'Cabinet'))
    fireEvent.click(screen.getByLabelText('Добавить ряд ниже'))
    expect(s.session.text).not.toBe(TEXT)
    act(() => {
      s.editor.commands.undo()
    })
    expect(s.session.text).toBe(TEXT)
  })

  it('hides on Esc until the cursor moves', () => {
    const s = open(TEXT)
    bar(s.editor)
    act(() => inCell(s.editor, 'Cabinet'))
    expect(screen.queryByRole('toolbar', { name: 'Таблица' })).not.toBeNull()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(screen.queryByRole('toolbar', { name: 'Таблица' })).not.toBeNull()
    fireEvent.keyDown(s.editor.view.dom, { key: 'Escape' })
    expect(screen.queryByRole('toolbar', { name: 'Таблица' })).toBeNull()
    act(() => inCell(s.editor, 'No'))
    expect(screen.queryByRole('toolbar', { name: 'Таблица' })).not.toBeNull()
  })

  it('is not shown in the mode of the source', () => {
    const s = open(TEXT)
    render(<TableBar editor={s.editor} locale="ru" container={document.body} disabled />)
    act(() => inCell(s.editor, 'Cabinet'))
    expect(screen.queryByRole('toolbar')).toBeNull()
  })

  it('is in English with the locale en, and every refusal of tables has a text in both languages', () => {
    const s = open(TEXT)
    bar(s.editor, 'en')
    act(() => inCell(s.editor, 'Cabinet'))
    const panel = screen.getByRole('toolbar', { name: 'Table' })
    for (const el of panel.querySelectorAll('[aria-label], [title]'))
      expect(`${el.getAttribute('aria-label')}${el.getAttribute('title')}`).not.toMatch(CYRILLIC)
    const codes = [
      'last-row',
      'last-column',
      'row-merged',
      'column-merged',
      'column-merged-all',
      'row-merged-all',
      'merge-select',
      'merge-text',
      'merge-head',
      'merge-deep',
      'split-single',
      'head-rowspan',
      'nesting-too-deep',
      'cell-has-table',
      'width-autowidth',
      'width-attr',
      'width-count',
      'row-above-head',
      'row-below-foot',
      'cols-attr',
      'cols-count',
    ]
    for (const code of codes) {
      expect(messages.ru.reject[code], code).toMatch(CYRILLIC)
      expect(messages.en.reject[code], code).not.toMatch(CYRILLIC)
    }
    expect(messages.ru.reject['column-merged-all']).toBe(
      'Колонку нельзя выделить отдельно: в таблице есть ячейка, объединённая на всю её ширину. Сначала разделите её.',
    )
    expect(messages.en.reject['row-merged-all']).toBe(
      'The row cannot be selected alone: a cell of the table is merged over its whole height. Split it first.',
    )
    expect(messages.en.reject['column-merged-all']).toBe(
      'The column cannot be selected alone: a cell of the table is merged over its whole width. Split it first.',
    )
    expect(messages.ru.reject['row-merged-all']).toBe(
      'Ряд нельзя выделить отдельно: в таблице есть ячейка, объединённая на всю её высоту. Сначала разделите её.',
    )
    expect(messages.ru.reject['nesting-too-deep']).toBe('Таблицы вкладываются не глубже четырёх уровней.')
  })
})

describe('the delete buttons go by the grips', () => {
  it('say how many rows or columns are selected, in both languages', async () => {
    const proto = HTMLElement.prototype
    const orig = proto.getBoundingClientRect
    proto.getBoundingClientRect = function (this: HTMLElement): DOMRect {
      const box = (l: number, t: number, w: number, h: number): DOMRect =>
        ({ left: l, top: t, right: l + w, bottom: t + h, width: w, height: h, x: l, y: t, toJSON() {} }) as DOMRect
      const tbl = this.closest('.tbl')
      if (!tbl) return box(0, 0, 0, 0)
      if (this.classList.contains('tbl-scroll')) return box(100, 50, 302, 92)
      if (this.tagName === 'TR') return box(101, 51 + [...this.parentElement!.children].indexOf(this) * 30, 300, 30)
      if (this.tagName === 'TD' || this.tagName === 'TH') {
        const r = [...this.parentElement!.parentElement!.children].indexOf(this.parentElement!)
        return box(101 + [...this.parentElement!.children].indexOf(this) * 100, 51 + r * 30, 100, 30)
      }
      return box(0, 0, 0, 0)
    }
    try {
      for (const locale of ['ru', 'en'] as const) {
        const s = open('|===\n|a |b |c\n|d |e |f\n|g |h |i\n|===\n')
        bar(s.editor, locale)
        act(() => inCell(s.editor, 'a'))
        const tb = messages[locale].tableBar
        expect(screen.getByLabelText(tb.colDel)).not.toBeNull()
        document.dispatchEvent(new MouseEvent('mousemove', { clientX: 150, clientY: 70, bubbles: true }))
        await act(() => new Promise<void>((r) => setTimeout(r, 50)))
        const cg = s.el.querySelectorAll('.nota-grips .cg')
        expect(cg).toHaveLength(3)
        act(() => void cg[0]!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })))
        act(() => void cg[1]!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, shiftKey: true })))
        // (the bar at the grips has the same names: this is the capsule)
        const inCapsule = (name: string): HTMLElement => screen.getAllByLabelText(name).find((el) => !el.closest('.nota-grips'))!
        const del = inCapsule(tb.colDelMany(2))
        expect(del.textContent).toBe('2')
        const rg = s.el.querySelectorAll('.nota-grips .rg')
        act(() => void rg[0]!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })))
        act(() => void rg[2]!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, shiftKey: true })))
        expect(inCapsule(tb.rowDelMany(3)).textContent).toBe('3')
        expect(inCapsule(tb.colDel).textContent).toBe('')
        cleanup()
      }
      expect(messages.ru.tableBar.colDelMany(2)).toBe('Удалить колонки: 2')
      expect(messages.ru.tableBar.rowDelMany(3)).toBe('Удалить ряды: 3')
      expect(messages.ru.cellFillMany(9)).toBe('Заливка ячеек: 9')
    } finally {
      proto.getBoundingClientRect = orig
    }
  })
})

describe('the row of commands of tables', () => {
  it('TableTools draws ten buttons with «Заливка ячейки» when it is given the window, the floating panel of the demo keeps nine', async () => {
    const { TableTools, useEditorState } = await import('@nota-adoc/react')
    const s = open(TEXT)
    inCell(s.editor, 'Cabinet')
    function Row(): ReturnType<typeof TableTools> {
      const state = useEditorState(s.editor)
      return <TableTools editor={s.editor} locale="ru" state={state} onCellFill={() => undefined} />
    }
    const view = render(<Row />)
    expect([...view.container.querySelectorAll('button')].map((b) => b.getAttribute('data-cmd'))).toEqual([
      'row-add', 'col-add', 'row-del', 'col-del', 'merge', 'split', 'cell-fill', 'head', 'nest', 'table-del',
    ])
    expect(view.container.querySelector('[data-cmd=cell-fill]')!.getAttribute('aria-label')).toBe('Заливка ячейки')
    expect(view.container.querySelector('[data-cmd=cell-fill]')!.getAttribute('aria-pressed')).toBe('false')
    act(() => void s.editor.commands.setCellFill('cell-blue'))
    const fill = view.container.querySelector('[data-cmd=cell-fill]')!
    expect(fill.getAttribute('aria-pressed')).toBe('true')
    expect(fill.getAttribute('aria-label')).toBe('Заливка ячейки: Голубая')
    expect(fill.getAttribute('title')).toBe('Заливка ячейки: Голубая')
    expect(fill.querySelector('i')!.getAttribute('style')).toContain('--ap-hl-blue')
    document.body.textContent = ''
    render(<TableBar editor={s.editor} locale="ru" container={document.body} />)
    expect(document.querySelectorAll('.tablebar button')).toHaveLength(9)
  })
})
