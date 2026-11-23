// the toolbar of «Визуально» has only the commands that work, shows the state under the cursor, has a hover tooltip with the
// name and the keys, is reachable by the keyboard, and gives the cursor back to the editor after a command.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closePage, cursorIn, fixture, openPage, outgoing, selectPlate, selectText, stubNetwork } from './helpers.js'

beforeEach(() => {
  outgoing.length = 0
  stubNetwork()
})
afterEach(closePage)

const start = fixture('editor/visual.adoc')

describe('demo: the toolbar', () => {
  it('has the commands that work and no others, each with a name', async () => {
    const page = await openPage()
    const toolbar = page.$('toolbar')
    expect(toolbar.getAttribute('role')).toBe('toolbar')
    const buttons = [...toolbar.querySelectorAll('button')]
    expect(buttons.map((b) => [b.dataset.cmd, b.getAttribute('aria-label')])).toEqual([
      ['undo', 'Отменить'],
      ['redo', 'Повторить'],
      ['strong', 'Жирный'],
      ['em', 'Курсив'],
      ['code', 'Моноширинный'],
      ['s', 'Зачёркнутый'],
      ['mark', 'Выделение цветом'],
      ['link', 'Ссылка'],
      ['unlink', 'Убрать ссылку'],
    ])
    for (const b of buttons) expect(b.type, b.dataset.cmd).toBe('button')
    expect([...page.style.options].map((o) => [o.value, o.text, o.disabled])).toEqual([
      ['h1', 'Заголовок документа', true],
      ['p', 'Текст', false],
      ['h2', 'Заголовок 2', false],
      ['h3', 'Заголовок 3', false],
      ['h4', 'Заголовок 4', false],
      ['h5', 'Заголовок 5', false],
      ['h6', 'Заголовок 6', false],
    ])
    expect(page.style.getAttribute('aria-label')).toBe('Стиль абзаца')
    // nothing of later stages: no menu of insertion, no buttons that do nothing
    expect(toolbar.querySelectorAll('button[disabled]').length).toBe(0)
    expect(document.querySelector('#insert-btn, #insert-menu, .future')).toBeNull()
  })

  it('the buttons put the marks and take them off: the source gets and loses the marks', async () => {
    const page = await openPage()
    for (const [cmd, open, close] of [
      ['strong', '*', '*'],
      ['em', '_', '_'],
      ['code', '`', '`'],
      ['s', '[.line-through]#', '#'],
      ['mark', '#', '#'],
    ] as const) {
      selectText(page, 'приоритет')
      page.press(cmd)
      expect(page.text(), cmd).toBe(start.replace('приоритет', `${open}приоритет${close}`))
      expect(page.cm().state.doc.toString(), cmd).toBe(page.text())
      page.press(cmd)
      expect(page.text(), cmd).toBe(start)
    }
  })

  it('a pressed mark shows blue: the cursor in a word with the mark presses its button, in plain text none', async () => {
    const page = await openPage()
    const marked: Array<[string, string]> = [
      ['strong', 'до конца квартала'],
      ['em', 'заказы'],
      ['code', 'номера накладных'],
      ['s', 'вход по паролю'],
      ['mark', 'вход по коду'],
      ['link', 'политика данных'],
    ]
    for (const [cmd, word] of marked) {
      cursorIn(page, word, 2)
      for (const other of marked)
        expect(page.pressed(other[0]), `${cmd}: ${other[0]} at "${word}"`).toBe(other[0] === cmd ? 'true' : 'false')
    }
    cursorIn(page, 'Кабинет открывается', 3)
    for (const [cmd] of marked) expect(page.pressed(cmd), `${cmd} in plain text`).toBe('false')
    // a range: pressed when the whole of it has the mark
    selectText(page, 'до конца квартала')
    expect(page.pressed('strong')).toBe('true')
    selectText(page, 'Сделать')
    expect(page.pressed('strong')).toBe('false')
  })

  it('a mark pressed at a cursor stays for the next typing, and its button shows it', async () => {
    const page = await openPage()
    cursorIn(page, 'Кабинет открывается', 3)
    page.press('em')
    expect(page.pressed('em')).toBe('true')
    page.press('em')
    expect(page.pressed('em')).toBe('false')
  })

  it('the style select shows the block under the cursor', async () => {
    const page = await openPage()
    const at: Array<[string, string]> = [
      ['Техническое задание', 'h1'],
      ['Цель', 'h2'],
      ['Экраны', 'h3'],
      ['Поля ответа', 'h4'],
      ['Кабинет открывается', 'p'],
    ]
    for (const [text, value] of at) {
      cursorIn(page, text, 2)
      expect(page.style.value, text).toBe(value)
    }
  })

  it('the style select makes headings and paragraphs; the title of the document is not a style to choose', async () => {
    const page = await openPage()
    selectText(page, 'Первая строка абзаца')
    page.style.value = 'h3'
    page.style.dispatchEvent(new Event('change'))
    expect(page.text()).toContain('=== Первая строка абзаца вторая строка того же абзаца')
    expect(page.pm().dom.querySelectorAll('h3').length).toBe(3)
    expect(page.style.value).toBe('h3')
    page.style.value = 'p'
    page.style.dispatchEvent(new Event('change'))
    // a heading is one line: the lines and the break of the paragraph became spaces
    expect(page.text()).toBe(
      start.replace(
        'Первая строка абзаца\nвторая строка того же абзаца +\nи строка после переноса.',
        'Первая строка абзаца вторая строка того же абзаца и строка после переноса.',
      ),
    )
    expect(page.style.value).toBe('p')
    expect(page.pm().hasFocus()).toBe(true)
    // the title of the document is shown, and cannot be picked
    cursorIn(page, 'Техническое задание', 2)
    expect(page.style.value).toBe('h1')
    expect(page.style.selectedOptions[0]!.disabled).toBe(true)
  })

  it('undo and redo are pale until there is a step to undo or redo, in either window', async () => {
    const page = await openPage()
    expect(page.disabled('undo')).toBe(true)
    expect(page.disabled('redo')).toBe(true)
    // a step made in «Исходник» enables undo in the toolbar
    page.cm().dispatch({ changes: { from: 0, insert: 'абв ' }, userEvent: 'input.type' })
    expect(page.disabled('undo')).toBe(false)
    page.press('undo')
    expect(page.text()).toBe(start)
    expect(page.disabled('undo')).toBe(true)
    expect(page.disabled('redo')).toBe(false)
    page.press('redo')
    expect(page.text()).toBe(`абв ${start}`)
    expect(page.disabled('redo')).toBe(true)
    // a pale button does nothing
    page.press('redo')
    expect(page.text()).toBe(`абв ${start}`)
  })

  it('with a plate selected the marks and the style are pale and do nothing; the plate and the text are as they were', async () => {
    const page = await openPage()
    selectPlate(page, 'DelimitedBlock')
    for (const cmd of ['strong', 'em', 'code', 's', 'mark', 'link', 'unlink']) expect(page.disabled(cmd), cmd).toBe(true)
    expect(page.style.disabled).toBe(true)
    page.press('strong')
    page.press('link')
    expect(page.text()).toBe(start)
    expect(page.notice()).toBeNull()
    expect(page.$('linkpop').hidden).toBe(true)
    // the cursor back in the text: the buttons are alive again
    cursorIn(page, 'Кабинет открывается', 3)
    expect(page.disabled('strong')).toBe(false)
    expect(page.style.disabled).toBe(false)
  })

  it('after a command the cursor is in the editor, and typing goes on from there', async () => {
    const page = await openPage()
    selectText(page, 'приоритет')
    page.pm().dom.blur()
    expect(page.pm().hasFocus()).toBe(false)
    page.press('strong')
    expect(page.pm().hasFocus()).toBe(true)
    expect(document.activeElement).toBe(page.pm().dom)
    // the selection is where it was
    const { from, to } = page.pm().state.selection
    expect(page.pm().state.doc.textBetween(from, to)).toBe('приоритет')
  })

  it('the buttons are reachable with Tab and work with Enter or Space: they are buttons, none is taken out of the order', async () => {
    const page = await openPage()
    for (const b of page.$('toolbar').querySelectorAll('button')) {
      expect(b.tagName).toBe('BUTTON')
      // a pale button stays in the order of Tab (aria-disabled, not disabled): a person on the keyboard finds it and hears why
      expect(b.hasAttribute('disabled'), b.dataset.cmd).toBe(false)
      expect(b.tabIndex, b.dataset.cmd).toBe(0)
    }
    expect(page.style.tabIndex).toBe(0)
    // the keyboard clicks a button on Enter and Space: the click does the command
    selectText(page, 'приоритет')
    page.btn('em').click()
    expect(page.text()).toBe(start.replace('приоритет', '_приоритет_'))
  })

  describe('tooltips', () => {
    const tip = () => document.getElementById('tip')!
    const over = (el: Element) => el.dispatchEvent(new Event('pointerover', { bubbles: true }))

    it('appear 0.4 s after the hover, with the name and the keys of a Mac, and go away with a click or a scroll', async () => {
      const page = await openPage({ mac: true })
      vi.useFakeTimers()
      expect(tip().hidden).toBe(true)
      over(page.btn('strong'))
      vi.advanceTimersByTime(399)
      expect(tip().hidden).toBe(true)
      vi.advanceTimersByTime(1)
      expect(tip().hidden).toBe(false)
      expect(tip().getAttribute('role')).toBe('tooltip')
      expect(tip().firstElementChild!.textContent).toBe('Жирный')
      expect([...tip().querySelectorAll('kbd')].map((k) => k.textContent)).toEqual(['⌘B'])
      tip().dispatchEvent(new Event('pointerdown', { bubbles: true }))
      document.dispatchEvent(new Event('pointerdown', { bubbles: true }))
      expect(tip().hidden).toBe(true)
      // leaving before the time: no tooltip
      over(page.btn('em'))
      vi.advanceTimersByTime(200)
      over(document.body)
      vi.advanceTimersByTime(1000)
      expect(tip().hidden).toBe(true)
      // the scroll of the page takes it away
      over(page.btn('code'))
      vi.advanceTimersByTime(400)
      expect(tip().hidden).toBe(false)
      document.dispatchEvent(new Event('scroll'))
      expect(tip().hidden).toBe(true)
    })

    it('say the keys of every command the way a Mac writes them', async () => {
      const page = await openPage({ mac: true })
      vi.useFakeTimers()
      const say = (el: Element) => {
        over(el)
        vi.advanceTimersByTime(400)
        const text = [...tip().children].map((c) => c.textContent).join(' ')
        document.dispatchEvent(new Event('pointerdown', { bubbles: true }))
        return text
      }
      expect(say(page.btn('undo'))).toBe('Отменить ⌘Z')
      expect(say(page.btn('redo'))).toBe('Повторить ⇧⌘Z')
      expect(say(page.style.closest('.select-wrap')!)).toBe('Стиль абзаца ⌥⌘0 текст ⌥⌘2…6 заголовки')
      expect(say(page.btn('strong'))).toBe('Жирный ⌘B')
      expect(say(page.btn('em'))).toBe('Курсив ⌘I')
      expect(say(page.btn('code'))).toBe('Моноширинный ⌘E')
      expect(say(page.btn('s'))).toBe('Зачёркнутый ⇧⌘X')
      expect(say(page.btn('mark'))).toBe('Выделение цветом ⇧⌘H')
      expect(say(page.btn('link'))).toBe('Ссылка')
      expect(say(page.btn('unlink'))).toBe('Убрать ссылку')
    })

    it('say the keys of another keyboard as Ctrl', async () => {
      const page = await openPage()
      vi.useFakeTimers()
      const say = (el: Element) => {
        over(el)
        vi.advanceTimersByTime(400)
        const text = [...tip().children].map((c) => c.textContent).join(' ')
        document.dispatchEvent(new Event('pointerdown', { bubbles: true }))
        return text
      }
      expect(say(page.btn('undo'))).toBe('Отменить Ctrl+Z')
      expect(say(page.btn('redo'))).toBe('Повторить Ctrl+Shift+Z')
      expect(say(page.style.closest('.select-wrap')!)).toBe('Стиль абзаца Ctrl+Alt+0 текст Ctrl+Alt+2…6 заголовки')
      expect(say(page.btn('strong'))).toBe('Жирный Ctrl+B')
      expect(say(page.btn('s'))).toBe('Зачёркнутый Ctrl+Shift+X')
    })

    it('appear at once when the button is reached with Tab, and not when the mouse focused it', async () => {
      const page = await openPage()
      vi.useFakeTimers()
      // the mouse: no tooltip from the focus
      document.dispatchEvent(new Event('pointerdown', { bubbles: true }))
      page.btn('em').focus()
      expect(tip().hidden).toBe(true)
      page.btn('em').blur()
      // the keyboard: at once
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
      page.btn('code').focus()
      expect(tip().hidden).toBe(false)
      expect(tip().firstElementChild!.textContent).toBe('Моноширинный')
      page.btn('code').blur()
      expect(tip().hidden).toBe(true)
    })
  })
})
