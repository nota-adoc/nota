// The buttons of lists, the panel of an admonition and both languages in the React package.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { BlockBar, Toolbar } from '@nota-adoc/react'
import { CYRILLIC, open, select, setupCleanup } from './helpers.js'

setupCleanup()

const noop = (): void => undefined
type Editor = ReturnType<typeof open>['editor']

const toolbar = (editor: Editor, locale: 'ru' | 'en' = 'ru') =>
  render(<Toolbar editor={editor} locale={locale} onLink={noop} onColor={noop} />)

const LISTS = ['Маркированный список', 'Нумерованный список', 'Чек-лист']
const pressed = (name: string): string | null => screen.getByLabelText(name).getAttribute('aria-pressed')
const disabled = (name: string): string | null => screen.getByLabelText(name).getAttribute('aria-disabled')

describe('the buttons of lists', () => {
  it('have a label and a hint, between the colours and the history', () => {
    const s = open('one\n')
    toolbar(s.editor)
    const bar = screen.getByRole('toolbar', { name: 'Форматирование' })
    const cmds = [...bar.querySelectorAll('button')].map((b) => b.getAttribute('data-cmd'))
    expect(cmds.slice(cmds.indexOf('fill') + 1)).toEqual(['ul', 'ol', 'check', 'insert', 'undo', 'redo'])
    for (const name of LISTS) expect(screen.getByLabelText(name).getAttribute('title')).toBe(name)
    expect(bar.querySelectorAll('.tb-sep').length).toBe(4)
  })

  it('press the button of the kind of the list under the cursor, and none in a paragraph', () => {
    const s = open('para\n\n* one\n\nbetween\n\n. two\n\nmore\n\n* [ ] three\n')
    toolbar(s.editor)
    act(() => select(s.editor, 0, 1))
    for (const name of LISTS) expect([name, pressed(name)]).toEqual([name, 'false'])
    act(() => select(s.editor, 1, 1))
    expect(LISTS.map(pressed)).toEqual(['true', 'false', 'false'])
    act(() => select(s.editor, 3, 1))
    expect(LISTS.map(pressed)).toEqual(['false', 'true', 'false'])
    act(() => select(s.editor, 5, 1))
    expect(LISTS.map(pressed)).toEqual(['false', 'false', 'true'])
  })

  it('make a paragraph an item, and a second press makes it a paragraph again, byte for byte', () => {
    const s = open('one\n')
    toolbar(s.editor)
    act(() => select(s.editor, 0, 1))
    fireEvent.click(screen.getByLabelText('Маркированный список'))
    expect(s.session.text).toBe('* one\n')
    expect(pressed('Маркированный список')).toBe('true')
    fireEvent.click(screen.getByLabelText('Маркированный список'))
    expect(s.session.text).toBe('one\n')
    fireEvent.click(screen.getByLabelText('Чек-лист'))
    expect(s.session.text).toBe('* [ ] one\n')
  })

  it('are pale on a heading, the title, a plate, a NOTE: paragraph and a box head', () => {
    const s = open('= Title\n\n== Head\n\n----\ncode\n----\n\nNOTE: careful\n')
    toolbar(s.editor)
    act(() => select(s.editor, 0, 1))
    expect(LISTS.map(disabled)).toEqual(['true', 'true', 'true'])
    act(() => select(s.editor, 1, 1))
    expect(LISTS.map(disabled)).toEqual(['true', 'true', 'true'])
    act(() => select(s.editor, 3, 1))
    expect(LISTS.map(disabled)).toEqual(['true', 'true', 'true'])
    const text = s.session.text
    fireEvent.click(screen.getByLabelText('Маркированный список'))
    expect(s.session.text).toBe(text)
    // a plain paragraph: alive
    const t = open('plain\n')
    document.body.textContent = ''
    toolbar(t.editor)
    act(() => select(t.editor, 0, 1))
    expect(LISTS.map(disabled)).toEqual(['false', 'false', 'false'])
  })

  it('leave «Стиль абзаца» in an item, a NOTE: paragraph and a box: it shows its name and does nothing', () => {
    const s = open('* one\n\nNOTE: careful\n\n[TIP]\n====\nin\n====\n\nplain\n')
    toolbar(s.editor)
    const style = screen.getByLabelText('Стиль абзаца') as HTMLButtonElement
    act(() => select(s.editor, 0, 1))
    expect([style.textContent, style.disabled]).toEqual(['Стиль абзаца', true])
    act(() => select(s.editor, 1, 2))
    expect([style.textContent, style.disabled]).toEqual(['Стиль абзаца', true])
    act(() => select(s.editor, 3, 1))
    expect([style.textContent, style.disabled]).toEqual(['Стиль абзаца', true])
    act(() => select(s.editor, 5, 1))
    expect([style.textContent, style.disabled]).toEqual(['Текст', false])
  })

  it('keep the marks alive in an item', () => {
    const s = open('* one two\n')
    toolbar(s.editor)
    act(() => select(s.editor, 0, 0, 3))
    expect(disabled('Жирный')).toBe('false')
    fireEvent.click(screen.getByLabelText('Жирный'))
    expect(s.session.text).toBe('* *one* two\n')
  })

  it('are in English with the locale en, no Cyrillic outside the document', () => {
    const s = open('one\n')
    const { container } = toolbar(s.editor, 'en')
    expect(screen.getByLabelText('Bulleted list')).toBeTruthy()
    expect(screen.getByLabelText('Numbered list')).toBeTruthy()
    expect(screen.getByLabelText('Checklist')).toBeTruthy()
    for (const el of container.querySelectorAll('[aria-label], [title], [placeholder]'))
      for (const a of ['aria-label', 'title', 'placeholder']) expect(el.getAttribute(a) ?? '').not.toMatch(CYRILLIC)
  })
})

describe('the type of an admonition on its label', () => {
  const bar = (editor: Editor, locale: 'ru' | 'en' = 'ru') =>
    render(<BlockBar editor={editor} locale={locale} container={document.body} />)
  const TYPES = ['Примечание', 'Совет', 'Важно', 'Внимание', 'Осторожно']
  const tag = (): HTMLElement | null => document.querySelector('[data-cmd="admonition"]')
  const radios = (): HTMLElement[] => screen.queryAllByRole('radio')
  const gone = async (): Promise<void> => {
    await waitFor(() => expect(screen.queryByRole('radiogroup')).toBeNull())
  }

  it('is the label of a NOTE: paragraph as a button; a press opens a row of five types, the current one is checked', () => {
    const s = open('plain\n\nTIP: careful\n')
    bar(s.editor)
    expect(tag()).toBeNull()
    act(() => select(s.editor, 1, 2))
    expect(tag()!.textContent).toBe('Совет.')
    expect(tag()!.getAttribute('aria-label')).toBe('Тип примечания: Совет')
    expect(tag()!.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('radiogroup')).toBeNull()
    fireEvent.click(tag()!)
    const group = screen.getByRole('radiogroup', { name: 'Тип примечания' })
    expect(radios().map((o) => o.getAttribute('aria-label'))).toEqual(TYPES)
    expect(radios().map((o) => o.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false', 'false', 'false'])
    expect(document.activeElement).toBe(radios()[1])
    // no native hint anywhere in the picker
    for (const el of [...document.querySelectorAll('.admpick, .admpick *')]) expect(el.hasAttribute('title')).toBe(false)
    expect(group.closest('.admpick')!.getAttribute('data-phase')).toBe('open')
  })

  it('one choice changes only the word, as one step of the history, and the cursor stays', async () => {
    const s = open('[NOTE#id.role]\n====\nin text\n====\n\nNOTE: care\n')
    bar(s.editor)
    act(() => select(s.editor, 1, 2))
    const at = s.editor.view.state.selection.from
    fireEvent.click(tag()!)
    fireEvent.click(screen.getByRole('radio', { name: 'Внимание' }))
    expect(s.session.text).toBe('[WARNING#id.role]\n====\nin text\n====\n\nNOTE: care\n')
    expect(tag()!.getAttribute('aria-label')).toBe('Тип примечания: Внимание')
    expect(s.editor.view.state.selection.from).toBe(at)
    await gone()
    act(() => {
      s.editor.commands.undo()
    })
    expect(s.session.text).toBe('[NOTE#id.role]\n====\nin text\n====\n\nNOTE: care\n')
  })

  it('walks with the keys: Alt+F10 opens it on the current type, arrows, Home, End and letters move, Enter chooses, Esc goes back to the text', async () => {
    const s = open('NOTE: care\n')
    bar(s.editor)
    act(() => select(s.editor, 0, 2))
    fireEvent.keyDown(s.editor.view.dom, { key: 'F10', altKey: true })
    await waitFor(() => expect(document.activeElement).toBe(radios()[0]))
    const key = (k: string): void => {
      fireEvent.keyDown(document.activeElement!, { key: k })
    }
    key('ArrowRight')
    expect(document.activeElement).toBe(radios()[1])
    key('End')
    expect(document.activeElement).toBe(radios()[4])
    key('Home')
    expect(document.activeElement).toBe(radios()[0])
    key('в')
    expect(document.activeElement).toBe(radios()[2])
    key('в')
    expect(document.activeElement).toBe(radios()[3])
    key('ArrowLeft')
    expect(document.activeElement).toBe(radios()[2])
    // Esc: nothing changes, the focus is in the text, the cursor is where it was
    const head = s.editor.view.state.selection.head
    key('Escape')
    expect(s.editor.view.state.selection.head).toBe(head)
    expect(s.session.text).toBe('NOTE: care\n')
    expect(s.editor.view.hasFocus()).toBe(true)
    await gone()
    expect(tag()).not.toBeNull()
    // Enter on a focused type chooses it
    fireEvent.keyDown(s.editor.view.dom, { key: 'F10', altKey: true })
    await waitFor(() => expect(document.activeElement).toBe(radios()[0]))
    key('ArrowRight')
    key('ArrowRight')
    fireEvent.click(document.activeElement!)
    expect(s.session.text).toBe('IMPORTANT: care\n')
  })

  it('does not keep Alt+F10 for later: with the label out of sight the wish is gone with the cursor, a later scroll opens nothing', async () => {
    const s = open('NOTE: care\n\nplain\n')
    const scroller = document.createElement('div')
    document.body.appendChild(scroller)
    let seen = false
    const rect = (top: number, h: number): DOMRect => ({ top, bottom: top + h, left: 0, right: 100, width: 100, height: h, x: 0, y: top, toJSON: () => ({}) })
    let proto: Element = Object.getPrototypeOf(scroller)
    while (!Object.prototype.hasOwnProperty.call(proto, 'getBoundingClientRect')) proto = Object.getPrototypeOf(proto)
    const spy = vi.spyOn(proto, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      if (this === scroller) return rect(0, 100)
      if (this.classList.contains('adm-lbl') || this.classList.contains('adm-ico')) return seen ? rect(40, 20) : rect(600, 20)
      return rect(0, 0)
    })
    try {
      render(<BlockBar editor={s.editor} locale="ru" container={document.body} scroller={scroller} />)
      act(() => select(s.editor, 0, 2))
      fireEvent.keyDown(s.editor.view.dom, { key: 'F10', altKey: true })
      // the cursor goes out of the admonition, then the label comes into view
      act(() => select(s.editor, 1, 1))
      seen = true
      await new Promise((r) => setTimeout(r, 100))
      expect(screen.queryByRole('radiogroup')).toBeNull()
      act(() => select(s.editor, 0, 2))
      await new Promise((r) => setTimeout(r, 100))
      expect(screen.queryByRole('radiogroup')).toBeNull()
      expect(document.activeElement && radios().includes(document.activeElement as HTMLElement)).toBeFalsy()
    } finally {
      spy.mockRestore()
      scroller.remove()
    }
  })

  it('is not there outside an admonition; Esc in the text hides it until the cursor moves', () => {
    const s = open('NOTE: a b\n\nplain\n')
    bar(s.editor)
    act(() => select(s.editor, 0, 1))
    expect(tag()).not.toBeNull()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(tag()).toBeNull()
    act(() => select(s.editor, 0, 2))
    expect(tag()).not.toBeNull()
    act(() => select(s.editor, 1, 1))
    expect(tag()).toBeNull()
  })

  it('a press outside the row folds it and the part being folded is inert', async () => {
    const s = open('NOTE: a b\n')
    bar(s.editor)
    act(() => select(s.editor, 0, 1))
    fireEvent.click(tag()!)
    expect(radios().length).toBe(5)
    fireEvent.mouseDown(document.body)
    expect(document.querySelector<HTMLElement>('.adm-row')!.inert).toBe(true)
    await gone()
    for (let i = 0; i < 5; i++) {
      fireEvent.click(tag()!)
      fireEvent.mouseDown(document.body)
    }
    await gone()
    expect(document.querySelectorAll('.adm-row').length).toBe(0)
    expect(document.querySelectorAll('.admpick').length).toBe(1)
  })

  it('is in English with the locale en, no Cyrillic and no «source» in what it shows', () => {
    const s = open('NOTE: a\n')
    bar(s.editor, 'en')
    act(() => select(s.editor, 0, 1))
    fireEvent.click(tag()!)
    expect(screen.getByRole('radiogroup', { name: 'Callout type' })).toBeTruthy()
    expect(radios().map((o) => o.getAttribute('aria-label'))).toEqual(['Note', 'Tip', 'Important', 'Warning', 'Caution'])
    for (const el of document.body.querySelectorAll('.blockbar [aria-label], .blockbar [title]'))
      expect(`${el.getAttribute('aria-label')}${el.getAttribute('title')}`).not.toMatch(CYRILLIC)
    expect(document.querySelector('.admpick')!.textContent!.toLowerCase()).not.toMatch(/source|asciidoc|исходник/)
  })
})
