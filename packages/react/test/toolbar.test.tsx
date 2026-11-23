// The toolbar.
import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TextSelection } from 'prosemirror-state'
import { Toolbar } from '@nota-adoc/react'
import { CYRILLIC, open, select, setupCleanup } from './helpers.js'

setupCleanup()

const noop = (): void => undefined

/** The cursor in the text of the cell whose text on the screen is `text`, `k` positions from its start. */
function inCell(editor: ReturnType<typeof open>['editor'], text: string, k: number): void {
  let found = -1
  editor.view.state.doc.descendants((node, pos) => {
    if (found < 0 && node.type.name === 'cell_text' && node.textContent === text) found = pos + 1 + k
    return found < 0
  })
  if (found < 0) throw new Error(`no cell with the text ${text}`)
  editor.view.dispatch(editor.view.state.tr.setSelection(TextSelection.create(editor.view.state.doc, found)))
}

function toolbar(editor: ReturnType<typeof open>['editor'], extra: Partial<Parameters<typeof Toolbar>[0]> = {}) {
  return render(<Toolbar editor={editor} locale="ru" onLink={noop} onColor={noop} {...extra} />)
}

describe('the toolbar', () => {
  it('has the elements in the order of the spec, each with a label and a hint', () => {
    const s = open('one two\n')
    toolbar(s.editor)
    const bar = screen.getByRole('toolbar', { name: 'Форматирование' })
    const labels = [...bar.querySelectorAll('button')].map((el) => el.getAttribute('aria-label'))
    expect(labels).toEqual([
      'Стиль абзаца',
      'Жирный',
      'Курсив',
      'Моноширинный',
      'Зачёркнутый',
      'Выделение',
      'Ссылка',
      'Цвет текста',
      'Заливка',
      'Маркированный список',
      'Нумерованный список',
      'Чек-лист',
      'Вставить',
      'Отменить',
      'Повторить',
    ])
    expect(screen.getByLabelText('Жирный').getAttribute('title')).toMatch(/^Жирный · (⌘B|Ctrl\+B)$/)
    expect(screen.getByLabelText('Зачёркнутый').getAttribute('title')).toMatch(/(⌘⇧X|Ctrl\+Shift\+X)$/)
    const style = screen.getByLabelText('Стиль абзаца')
    expect(style.getAttribute('aria-haspopup')).toBe('listbox')
    expect(style.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(style)
    expect(style.getAttribute('aria-expanded')).toBe('true')
    const options = screen.getAllByRole('option').map((o) => o.querySelector('.dd-label')!.textContent)
    expect(options).toEqual(['Текст', 'Заголовок 2', 'Заголовок 3', 'Заголовок 4', 'Заголовок 5', 'Заголовок 6'])
    expect(screen.getAllByRole('option').map((o) => o.getAttribute('aria-keyshortcuts'))).toEqual(['Control+Alt+0', 'Control+Alt+2', 'Control+Alt+3', 'Control+Alt+4', 'Control+Alt+5', 'Control+Alt+6'])
    expect(document.querySelector('select')).toBeNull()
  })

  it('shows the marks, the style and the colour under the cursor', () => {
    const s = open('plain *bold* [.hl-red]#red# https://a.b[link]\n\n== Head\n')
    toolbar(s.editor)
    const pressed = (name: string): string | null => screen.getByLabelText(new RegExp(`^${name}`)).getAttribute('aria-pressed')
    act(() => select(s.editor, 0, 7))
    expect(pressed('Жирный')).toBe('true')
    expect(pressed('Курсив')).toBe('false')
    expect(pressed('Цвет текста')).toBe('false')
    expect(screen.getByLabelText('Стиль абзаца').textContent).toBe('Текст')
    act(() => select(s.editor, 0, 13))
    expect(pressed('Цвет текста')).toBe('true')
    expect(screen.getByLabelText('Цвет текста: Красный').getAttribute('title')).toBe('Цвет текста: Красный')
    expect(pressed('Жирный')).toBe('false')
    act(() => select(s.editor, 0, 18))
    expect(pressed('Ссылка')).toBe('true')
    act(() => select(s.editor, 1, 2))
    expect(screen.getByLabelText('Стиль абзаца').textContent).toBe('Заголовок 2')
  })

  it.each([['orange', 'Оранжевый'], ['purple', 'Фиолетовый'], ['pink', 'Розовый'], ['teal', 'Бирюзовый']])('the colour %s is named on the button, pressed, with its stripe', (role, name) => {
    const s = open(`[.hl-${role}]#word# x\n`)
    toolbar(s.editor)
    act(() => select(s.editor, 0, 2))
    const button = screen.getByLabelText(`Цвет текста: ${name}`)
    expect(button.getAttribute('aria-pressed')).toBe('true')
    expect(button.getAttribute('title')).toBe(`Цвет текста: ${name}`)
    expect(button.querySelector('i')?.getAttribute('style') ?? '').toContain(`--ap-tx-${role}`)
  })

  it('follows an edit made elsewhere', () => {
    const s = open('one two\n')
    toolbar(s.editor)
    act(() => select(s.editor, 0, 0, 3))
    expect(screen.getByLabelText('Жирный').getAttribute('aria-pressed')).toBe('false')
    act(() => {
      s.session.apply([{ from: 0, to: 0, insert: '*' }, { from: 3, to: 3, insert: '*' }], { origin: 'other' })
    })
    act(() => select(s.editor, 0, 1))
    expect(screen.getByLabelText('Жирный').getAttribute('aria-pressed')).toBe('true')
  })

  it('is pale on the title of the document and on a selected plate', () => {
    const s = open('= Title\n\ntext\n\n----\ncode\n----\n')
    toolbar(s.editor)
    act(() => select(s.editor, 0, 2))
    expect(screen.getByLabelText('Жирный').getAttribute('aria-disabled')).toBe('true')
    expect(screen.getByLabelText('Ссылка').getAttribute('aria-disabled')).toBe('true')
    expect(screen.getByLabelText('Заливка').getAttribute('aria-disabled')).toBe('true')
    expect((screen.getByLabelText('Стиль абзаца') as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByLabelText('Стиль абзаца').textContent).toBe('Стиль абзаца')
    act(() => select(s.editor, 1, 1))
    expect(screen.getByLabelText('Жирный').getAttribute('aria-disabled')).toBe('false')
  })

  it('a button acts without taking the selection, and undo and redo are the history', () => {
    const s = open('one two\n')
    toolbar(s.editor)
    act(() => select(s.editor, 0, 4, 7))
    const bold = screen.getByLabelText('Жирный')
    const down = fireEvent.mouseDown(bold)
    expect(down).toBe(false) // default prevented: the editor keeps the selection
    fireEvent.click(bold)
    expect(s.session.text).toBe('one *two*\n')
    expect(s.editor.view.state.selection.empty).toBe(false)
    fireEvent.click(screen.getByLabelText('Отменить'))
    expect(s.session.text).toBe('one two\n')
    fireEvent.click(screen.getByLabelText('Повторить'))
    expect(s.session.text).toBe('one *two*\n')
  })

  it('changes the style of the block', () => {
    const s = open('== Head\n')
    toolbar(s.editor)
    act(() => select(s.editor, 0, 1))
    fireEvent.click(screen.getByLabelText('Стиль абзаца'))
    fireEvent.click(screen.getByRole('option', { name: 'Заголовок 3' }))
    expect(s.session.text).toBe('=== Head\n')
  })

  it('shows a refusal through the host and leaves the text', () => {
    const s = open('one\n\ntwo\n')
    const onBefore = vi.fn()
    toolbar(s.editor, { onBeforeCommand: onBefore })
    act(() => select(s.editor, 0, 0, 0))
    expect(s.editor.commands.setLink('https://a.b')).toBe(false)
    expect(s.rejects.at(-1)?.code).toBe('empty-selection')
  })

  it('in the mode «Текст» is off, with the note', () => {
    const s = open('one two\n')
    toolbar(s.editor, { disabled: true })
    for (const name of ['Жирный', 'Ссылка', 'Цвет текста', 'Заливка', 'Отменить', 'Повторить'])
      expect((screen.getByLabelText(name) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByLabelText('Стиль абзаца') as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('Режим «Текст»: правьте разметку AsciiDoc, «Визуально» покажет результат')).toBeTruthy()
  })

  it('in the text of a table cell that is read the buttons work, in one that is shown as text they are pale', () => {
    const s = open('|===\n|https://c.example.net/a[Ссылка] и *жирный*\nl|*x*\n|===\n')
    toolbar(s.editor)
    const pressed = (name: string): string | null => screen.getByLabelText(new RegExp(`^${name}`)).getAttribute('aria-pressed')
    const disabled = (name: string): string | null => screen.getByLabelText(new RegExp(`^${name}`)).getAttribute('aria-disabled')
    act(() => inCell(s.editor, 'Ссылка и жирный', 2))
    expect(pressed('Ссылка')).toBe('true')
    expect(disabled('Ссылка')).not.toBe('true')
    expect(disabled('Цвет текста')).not.toBe('true')
    expect(disabled('Жирный')).not.toBe('true')
    act(() => inCell(s.editor, 'Ссылка и жирный', 'Ссылка и жирный'.length - 2))
    expect(pressed('Жирный')).toBe('true')
    // the cell shown as text: nothing to press
    act(() => inCell(s.editor, '*x*', 1))
    expect(disabled('Ссылка')).toBe('true')
    expect(disabled('Жирный')).toBe('true')
  })

  it('the link and colour buttons ask the host', () => {
    const s = open('one two\n')
    const onLink = vi.fn()
    const onColor = vi.fn()
    toolbar(s.editor, { onLink, onColor })
    act(() => select(s.editor, 0, 0, 3))
    fireEvent.click(screen.getByLabelText('Ссылка'))
    fireEvent.click(screen.getByLabelText('Цвет текста'))
    fireEvent.click(screen.getByLabelText('Заливка'))
    expect(onLink).toHaveBeenCalledTimes(1)
    expect(onColor.mock.calls.map((c) => c[0])).toEqual(['color', 'fill'])
  })

  it('in English has no Cyrillic outside the document', () => {
    const s = open('one two\n')
    const { container } = toolbar(s.editor, { locale: 'en', disabled: true })
    expect(CYRILLIC.test(container.textContent ?? '')).toBe(false)
    for (const el of container.querySelectorAll('[aria-label],[title],[placeholder]'))
      for (const a of ['aria-label', 'title', 'placeholder']) expect(CYRILLIC.test(el.getAttribute(a) ?? '')).toBe(false)
    expect(screen.getByLabelText('Bold')).toBeTruthy()
    expect(screen.getByLabelText('Paragraph style')).toBeTruthy()
    expect(screen.getByLabelText('Text color')).toBeTruthy()
  })
})
