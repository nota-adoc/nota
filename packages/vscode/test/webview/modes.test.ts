// the mode «Текст» next to «Визуально», the tree of sections, the remarks, a big file, a failure of a shown tab.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { diagnosticCount, forceLinting, openLintPanel } from '@codemirror/lint'
import { TextSelection } from 'prosemirror-state'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CRASH_MESSAGE,
  type Page,
  bigText,
  startPage,
} from '../../src/webview/main.js'
import { documentName } from '../../src/webview/outline.js'
import { remarkCount, remarkText } from '../../src/webview/diagnostics.js'
import type { Mode, ToHost, ToTab } from '../../src/protocol.js'

const fixture = (path: string): string => readFileSync(join(import.meta.dirname, '../../../../quality/fixtures', path), 'utf8')

let sent: ToHost[]
let root: HTMLElement
let page: Page | undefined

const api = { postMessage: (m: ToHost) => void sent.push(m) }
const host = (message: ToTab): void => void window.dispatchEvent(new MessageEvent('message', { data: message }))
const types = (): string[] => sent.map((m) => m.type)
const edits = (): Extract<ToHost, { type: 'edit' }>[] => sent.filter((m): m is Extract<ToHost, { type: 'edit' }> => m.type === 'edit')

function open(text: string, extra: { mode?: Mode; big?: { bytes: number } } = {}): Page {
  root = document.createElement('div')
  root.id = 'app'
  document.body.append(root)
  page = startPage(api, root)
  host({ type: 'init', text, version: 1, fileName: 'a.adoc', locale: 'ru', outlineView: 'capsule', fileDir: '/work/docs', mode: extra.mode ?? 'visual', ...(extra.big ? { big: extra.big } : {}) })
  page.flush()
  return page
}

beforeEach(() => {
  vi.useFakeTimers()
  sent = []
  page = undefined
  document.body.className = ''
})
afterEach(() => {
  page?.destroy()
  document.body.textContent = ''
  vi.restoreAllMocks()
  vi.useRealTimers()
})

const DOC = '= Документ\n\nПервый абзац со словом мир внутри.\n\n== Первый\n\nТекст *жирный* первого.\n\n== Второй\n\nКонец документа.\n'

describe('the switch of the mode', () => {
  it('opens visually, goes to «Текст» with the same text and back, and writes nothing', () => {
    open(DOC)
    expect(page!.mode).toBe('visual')
    expect(page!.source).toBeUndefined()
    page!.toggleMode()
    expect(page!.mode).toBe('text')
    expect(page!.source!.getText()).toBe(DOC)
    expect(root.querySelector<HTMLElement>('.ed-source')!.hidden).toBe(false)
    expect(root.querySelector<HTMLElement>('.ed-visual')!.hidden).toBe(true)
    // the source has line numbers and the highlighting of AsciiDoc
    expect(root.querySelector('.cm-lineNumbers')).not.toBeNull()
    page!.toggleMode()
    expect(page!.mode).toBe('visual')
    expect(root.querySelector<HTMLElement>('.ed-visual')!.hidden).toBe(false)
    expect(sent.filter((m) => m.type === 'mode')).toEqual([
      { type: 'mode', mode: 'text' },
      { type: 'mode', mode: 'visual' },
    ])
    vi.advanceTimersByTime(2000)
    expect(edits()).toEqual([])
  })

  it('in «Текст» the hint and the panel of the remarks are in Russian, and so are the phrases of CodeMirror', () => {
    const text = 'Ссылка <<nowhere>>.\n\ntext\n\n----\ncode\n'
    open(text, { mode: 'text' })
    const view = page!.source!.view
    vi.useRealTimers()
    forceLinting(view)
    return vi.waitFor(() => expect(diagnosticCount(view.state)).toBe(2), { timeout: 5000 }).then(() => {
      const panel = openLintPanel(view)
      expect(panel).toBe(true)
      const dom = view.dom.querySelector('.cm-panel-lint')!
      expect(dom.textContent).toContain('Ссылка ведёт на «nowhere»')
      expect(dom.textContent).toContain('Блок «листинг» не закрыт')
      expect(dom.textContent).not.toMatch(/The reference|Unterminated/)
      expect(view.state.phrase('Diagnostics')).toBe('Замечания')
      expect(view.state.phrase('No diagnostics')).toBe('Замечаний нет')
      expect(view.state.phrase('close')).toBe('закрыть')
      expect(view.state.phrase('folded code')).toBe('свёрнутый код')
      expect(view.state.phrase('unfold')).toBe('развернуть')
      expect(view.state.phrase('Completions')).toBe('Подсказки')
      expect(view.state.phrase('Control character')).toBe('Управляющий символ')
      expect(view.state.phrase('to')).toBe('до')
    })
  })

  it('the command of the host toggles', () => {
    open(DOC)
    host({ type: 'command', name: 'toggle-mode' })
    expect(page!.mode).toBe('text')
    host({ type: 'command', name: 'toggle-mode' })
    expect(page!.mode).toBe('visual')
  })

  it('carries the cursor: a letter typed after the switch lands in the same word, both ways', () => {
    open(DOC)
    const word = DOC.indexOf('мир') + 1
    page!.editor!.setSelectionAtOffset(word)
    page!.toggleMode()
    expect(page!.source!.view.state.selection.main.head).toBe(word)
    page!.source!.view.dispatch(page!.source!.view.state.replaceSelection('Ы'))
    expect(page!.mirror!.text).toContain('мЫир')
    // another word, in «Текст», then back
    const other = page!.mirror!.text.indexOf('Конец') + 2
    page!.source!.view.dispatch({ selection: { anchor: other } })
    page!.toggleMode()
    expect(page!.editor!.selectionOffsets()).toEqual({ anchor: other, head: other })
    expect(page!.editor!.getText()).toContain('мЫир')
  })

  it('markup that the visual editor does not show: the cursor goes to the nearest visible place of the block', () => {
    open(DOC)
    page!.toggleMode()
    const star = DOC.indexOf('*жирный*')
    page!.source!.view.dispatch({ selection: { anchor: star } })
    page!.toggleMode()
    const got = page!.editor!.selectionOffsets()!.anchor
    expect(got).toBeGreaterThanOrEqual(DOC.indexOf('Текст'))
    expect(got).toBeLessThanOrEqual(DOC.indexOf('первого'))
  })

  it('a cursor inside code is a cursor in its text', () => {
    const text = 'Абзац.\n\n----\nкод\n----\n\nКонец.\n'
    open(text)
    page!.toggleMode()
    page!.source!.view.dispatch({ selection: { anchor: text.indexOf('код') } })
    page!.toggleMode()
    expect(page!.editor!.view.state.selection.constructor.name).toBe('TextSelection')
    expect(page!.editor!.selectionOffsets()!.anchor).toBe(text.indexOf('код'))
  })

  it('moves the top of the view: the top block of «Визуально» is the first line of «Текст»', () => {
    open(DOC)
    const heading = DOC.indexOf('== Второй')
    vi.spyOn(page!.editor!, 'topVisibleOffset').mockReturnValue(heading)
    page!.toggleMode()
    // the source is asked to scroll to it; jsdom has no layout, so what can be seen is that the call did not throw
    expect(page!.mode).toBe('text')
  })
})

describe('the keys', () => {
  const key = (target: Element, code: string, init: KeyboardEventInit = {}): KeyboardEvent => {
    const ev = new KeyboardEvent('keydown', { code, key: code, bubbles: true, cancelable: true, ctrlKey: true, ...init })
    target.dispatchEvent(ev)
    return ev
  }

  it('in «Текст» the keys of the marks change nothing and are not left to VS Code or the editor', () => {
    open(DOC)
    page!.toggleMode()
    const before = page!.mirror!.text
    page!.source!.view.dispatch({ selection: { anchor: 3, head: 9 } })
    for (const [code, shift] of [['KeyB', false], ['KeyI', false], ['KeyE', false], ['KeyX', true], ['KeyH', true]] as const) {
      const ev = key(page!.source!.view.contentDOM, code, { shiftKey: shift })
      expect(ev.defaultPrevented, code).toBe(true)
    }
    for (const name of ['strong', 'em', 'code', 'strike', 'highlight']) host({ type: 'command', name })
    vi.advanceTimersByTime(2000)
    expect(page!.mirror!.text).toBe(before)
    expect(edits()).toEqual([])
  })

  describe('the keys of the styles', () => {
    const mac = (target: Element, code: string): KeyboardEvent => key(target, code, { ctrlKey: false, metaKey: true, altKey: true })
    const cursorIn = (needle: string): void => {
      const v = page!.editor!.view
      let at = -1
      v.state.doc.descendants((node, pos) => {
        if (at < 0 && node.isTextblock && node.textContent.includes(needle)) at = pos + 1
        return at < 0
      })
      v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, at)))
    }

    it('in «Текст» ⌘⌥0 / 2 / 3 change nothing and are not left to VS Code; the commands of the host change nothing too', () => {
      open(DOC)
      page!.toggleMode()
      const before = page!.mirror!.text
      for (const code of ['Digit0', 'Digit2', 'Digit3']) expect(mac(page!.source!.view.contentDOM, code).defaultPrevented, code).toBe(true)
      for (const name of ['style-paragraph', 'style-heading2', 'style-heading3']) host({ type: 'command', name })
      vi.advanceTimersByTime(2000)
      expect(page!.mirror!.text).toBe(before)
      expect(edits()).toEqual([])
    })

    it('the key in the text and the command that VS Code sends after it are one step; the command alone (focus in the sections) works', () => {
      open(DOC)
      cursorIn('Конец')
      const dom = page!.editor!.view.dom
      mac(dom, 'Digit2')
      // (the keymap of ProseMirror reads ⌘ as Ctrl in jsdom: what the page does with the key is done by hand)
      page!.editor!.commands.toggleBlockType('heading', 2)
      host({ type: 'command', name: 'style-heading2' })
      vi.advanceTimersByTime(100)
      expect(page!.mirror!.text).toContain('\n== Конец документа.\n')
      // the command alone: from the panel of the sections nothing reached the page
      host({ type: 'command', name: 'style-heading3' })
      expect(page!.mirror!.text).toContain('\n=== Конец документа.\n')
      host({ type: 'command', name: 'style-paragraph' })
      expect(page!.mirror!.text).toContain('\nКонец документа.\n')
      expect(page!.mirror!.text).not.toContain('= Конец')
    })
  })

  it('Cmd+Z in «Текст» asks the host once, and the answer undoes the word in both modes', () => {
    open(DOC)
    page!.toggleMode()
    const at = DOC.indexOf('Конец')
    page!.source!.view.dispatch({ selection: { anchor: at } })
    page!.source!.view.dispatch(page!.source!.view.state.replaceSelection('проверка '), { userEvent: 'input.type' })
    page!.toggleMode()
    expect(page!.editor!.view.dom.textContent).toContain('проверка Конец')
    // Cmd+Z in the visual editor right after the switch
    key(page!.editor!.view.dom, 'KeyZ', { key: 'z' })
    expect(types().filter((t) => t === 'undo')).toHaveLength(0) // waits for the answer to the edit
    host({ type: 'ack', id: 1, version: 2 })
    expect(types().filter((t) => t === 'undo')).toHaveLength(1)
    host({ type: 'update', version: 3, changes: [{ from: at, to: at + 9, insert: '' }], reason: 'undo' })
    expect(page!.source!.getText()).toBe(DOC)
    expect(page!.editor!.view.dom.textContent).not.toContain('проверка')
    // and the other way: Cmd+Shift+Z puts it back
    key(page!.editor!.view.dom, 'KeyZ', { key: 'z', shiftKey: true })
    expect(sent.at(-1)).toEqual({ type: 'redo' })
  })

  it('the native undo of «Правка → Отменить» in «Текст» is one step, also right after Cmd+Z', () => {
    open(DOC)
    page!.toggleMode()
    const content = page!.source!.view.contentDOM
    const native = (): void => void content.dispatchEvent(new InputEvent('beforeinput', { inputType: 'historyUndo', bubbles: true, cancelable: true }))
    native()
    expect(types().filter((t) => t === 'undo')).toHaveLength(1)
    vi.advanceTimersByTime(1000)
    key(content, 'KeyZ', { key: 'z' })
    native()
    expect(types().filter((t) => t === 'undo')).toHaveLength(2)
  })

  it('what is typed in «Текст» is sent within 1 s, and Cmd+S right after sends it at once', () => {
    open(DOC)
    page!.toggleMode()
    page!.source!.view.dispatch({ selection: { anchor: DOC.length } })
    page!.source!.view.dispatch(page!.source!.view.state.replaceSelection('конец'), { userEvent: 'input.type' })
    expect(edits()).toHaveLength(0)
    key(page!.source!.view.contentDOM, 'KeyS', { key: 's' })
    expect(edits()).toHaveLength(1)
    expect(edits()[0]!.changes).toEqual([{ from: DOC.length, to: DOC.length, insert: 'конец' }])
    page!.source!.view.dispatch(page!.source!.view.state.replaceSelection('!'), { userEvent: 'input.type' })
    vi.advanceTimersByTime(900)
    host({ type: 'ack', id: 1, version: 2 })
    expect(edits()).toHaveLength(2)
  })
})

describe('the tree of sections', () => {
  const items = (): string[] => [...root.querySelectorAll('.tree-item')].map((el) => el.textContent!)

  it('lists the sections in order with indents, without the title of the document', () => {
    open('= Документ\n\n== Один\n\n=== Вложенный\n\n[discrete]\n=== Отдельный\n\n== Два\n')
    expect(items()).toEqual(['Один', 'Вложенный', 'Отдельный', 'Два'])
    const levels = [...root.querySelectorAll<HTMLElement>('.tree-row')].map((el) => el.style.getPropertyValue('--lvl'))
    expect(levels).toEqual(['0', '1', '1', '0'])
    expect(root.querySelector('.sections-card')!.getAttribute('aria-label')).toBe('Разделы документа')
  })

  it('headings 4–6 are listed with deeper indents', () => {
    open('== Один\n\n=== Два\n\n==== Три\n\n===== Четыре\n\n====== Пять\n')
    expect(items()).toEqual(['Один', 'Два', 'Три', 'Четыре', 'Пять'])
    const levels = [...root.querySelectorAll<HTMLElement>('.tree-row')].map((el) => el.style.getPropertyValue('--lvl'))
    expect(levels).toEqual(['0', '1', '2', '3', '4'])
  })

  it('a document without sections shows no outline capsule and opens no card, in both modes', () => {
    open('Просто текст.\n')
    const isle = root.querySelector<HTMLElement>('.isle-sections')!
    expect(isle.hasAttribute('data-empty')).toBe(true)
    expect(isle.getAttribute('aria-hidden')).toBe('true')
    expect(isle.tabIndex).toBe(-1)
    expect(root.querySelector('.tree-empty')).toBeNull()
    isle.click()
    expect(root.querySelector<HTMLElement>('.sections-card')!.hidden).toBe(true)
    const stillEmpty = (): void => {
      expect(isle.hasAttribute('data-empty')).toBe(true)
      expect(isle.getAttribute('aria-hidden')).toBe('true')
      expect(isle.tabIndex).toBe(-1)
      isle.click()
      expect(root.querySelector<HTMLElement>('.sections-card')!.hidden).toBe(true)
    }
    page!.toggleMode()
    stillEmpty()
    page!.toggleMode()
    stillEmpty()
  })

  it('a click goes to the title: the cursor is at its start, in both modes', () => {
    open(DOC)
    const item = (name: string): HTMLElement => [...root.querySelectorAll<HTMLElement>('.tree-item')].find((el) => el.textContent === name)!
    item('Второй').click()
    // in the visual editor the cursor is at the start of the title (the `== ` is not shown), in «Текст» at the start of the line
    expect(page!.editor!.selectionOffsets()).toEqual({ anchor: DOC.indexOf('Второй'), head: DOC.indexOf('Второй') })
    page!.toggleMode()
    item('Первый').click()
    expect(page!.source!.view.state.selection.main.head).toBe(DOC.indexOf('== Первый'))
  })

  it('a new section appears within 0.5 s, a rename changes it, a delete removes it', () => {
    open(DOC)
    expect(items()).toEqual(['Первый', 'Второй'])
    page!.mirror!.apply([{ from: DOC.indexOf('Конец'), to: DOC.indexOf('Конец'), insert: '== Новый раздел\n\n' }])
    vi.advanceTimersByTime(500)
    expect(items()).toEqual(['Первый', 'Второй', 'Новый раздел'])
    const t = page!.mirror!.text
    page!.mirror!.apply([{ from: t.indexOf('Новый'), to: t.indexOf('Новый') + 5, insert: 'Старый' }])
    vi.advanceTimersByTime(500)
    expect(items()).toEqual(['Первый', 'Второй', 'Старый раздел'])
    const t2 = page!.mirror!.text
    page!.mirror!.apply([{ from: t2.indexOf('== Старый'), to: t2.indexOf('Конец'), insert: '' }])
    vi.advanceTimersByTime(500)
    expect(items()).toEqual(['Первый', 'Второй'])
  })

  it('typing in a paragraph keeps the rows (clicks still go to the moved titles); a rename draws them again', () => {
    open(DOC)
    const rows = [...root.querySelectorAll('.tree-row')]
    const t = page!.mirror!.text
    const at = t.indexOf('Первый абзац')
    page!.mirror!.apply([{ from: at, to: at, insert: 'Вставка в начале. ' }])
    vi.advanceTimersByTime(500)
    const same = (): boolean => {
      const now = [...root.querySelectorAll('.tree-row')]
      return now.length === rows.length && now.every((el, i) => el === rows[i])
    }
    expect(same()).toBe(true)
    // the offset of the title moved with the text
    const now = page!.mirror!.text
    ;[...root.querySelectorAll<HTMLElement>('.tree-item')].find((el) => el.textContent === 'Второй')!.click()
    expect(page!.editor!.selectionOffsets()!.anchor).toBe(now.indexOf('Второй'))
    page!.mirror!.apply([{ from: now.indexOf('Второй'), to: now.indexOf('Второй') + 6, insert: 'Третий' }])
    vi.advanceTimersByTime(500)
    expect(items()).toEqual(['Первый', 'Третий'])
    expect(same()).toBe(false)
  })

  it('a level change and a change of the remark counter draw the rows again', () => {
    open('= Документ\n\n== Первый\n\nТекст.\n\n== Второй\n\nКонец.\n')
    const rows = (): Element[] => [...root.querySelectorAll('.tree-row')]
    const before = rows()
    const t = page!.mirror!.text
    // the level: `== Второй` becomes `=== Второй`
    page!.mirror!.apply([{ from: t.indexOf('== Второй'), to: t.indexOf('== Второй'), insert: '=' }])
    vi.advanceTimersByTime(500)
    const levels = rows()
    expect(levels.some((el, i) => el === before[i])).toBe(false)
    const lvl = (el: Element): number => Number((el as HTMLElement).style.getPropertyValue('--lvl'))
    expect(lvl(levels[1]!)).toBe(lvl(levels[0]!) + 1)
    // the counter: a broken link in the second section
    const t2 = page!.mirror!.text
    const at = t2.indexOf('Конец.')
    page!.mirror!.apply([{ from: at, to: at, insert: 'Ссылка <<нет-такого>> тут. ' }])
    vi.advanceTimersByTime(500)
    expect([...root.querySelectorAll('.tree-badge')].map((el) => el.textContent)).toEqual(['1'])
    expect(rows().some((el, i) => el === levels[i])).toBe(false)
  })

  it('a heading set in the visual editor comes to the tree', () => {
    open('Абзац.\n')
    page!.editor!.commands.setBlockType('heading', 2)
    vi.advanceTimersByTime(500)
    expect(items()).toEqual(['Абзац.'])
  })

  it('marks the current section by the scroll: the last title above the top (aria-current=location)', () => {
    open(DOC)
    const top = vi.spyOn(page!.editor!, 'topVisibleOffset')
    top.mockReturnValue(DOC.indexOf('Текст *жирный*'))
    visualScroll()
    expect(current()).toEqual(['Первый'])
    top.mockReturnValue(DOC.indexOf('== Второй'))
    visualScroll()
    expect(current()).toEqual(['Второй'])
    top.mockReturnValue(0)
    visualScroll()
    expect(current()).toEqual([])
  })

  it('at the end of the document the last section is the current one', () => {
    open(DOC)
    vi.spyOn(page!.editor!, 'topVisibleOffset').mockReturnValue(DOC.indexOf('Текст *жирный*'))
    const box = root.querySelector<HTMLElement>('.ed-visual')!
    Object.defineProperty(box, 'scrollHeight', { value: 1000, configurable: true })
    Object.defineProperty(box, 'clientHeight', { value: 400, configurable: true })
    Object.defineProperty(box, 'scrollTop', { value: 600, configurable: true })
    visualScroll()
    expect(current()).toEqual(['Второй'])
  })

  function visualScroll(): void {
    root.querySelector('.ed-visual')!.dispatchEvent(new Event('scroll'))
    vi.advanceTimersByTime(50)
  }
  function current(): string[] {
    return [...root.querySelectorAll('.tree-item[aria-current="location"]')].map((el) => el.textContent!)
  }

  it('the current section is found at the top third of what is seen, not at its top edge', () => {
    open(DOC)
    const top = vi.spyOn(page!.editor!, 'topVisibleOffset')
    top.mockReturnValue(DOC.indexOf('Текст *жирный*'))
    visualScroll()
    expect(top).toHaveBeenCalledWith(1 / 3)
  })

  describe('an open panel follows the document, a closed one does not', () => {
    const MANY = '= Документ\n\n' + Array.from({ length: 30 }, (_, i) => `== Раздел ${i + 1}\n\nТекст ${i + 1}.\n\n`).join('')
    /** A list of 200 px with rows of 40 px: jsdom has no layout, so the rectangles are made up from the scroll. */
    const withLayout = (): HTMLElement => {
      const list = root.querySelector<HTMLElement>('.sections-card .tree-list')!
      Object.defineProperty(list, 'clientHeight', { value: 200, configurable: true })
      list.getBoundingClientRect = () => ({ top: 0, bottom: 200, height: 200, left: 0, right: 300, width: 300, x: 0, y: 0, toJSON: () => ({}) })
      for (const el of root.querySelectorAll<HTMLElement>('.sections-card .tree-item')) {
        const i = Number(el.dataset.index)
        el.getBoundingClientRect = () => {
          const t = i * 40 - list.scrollTop
          return { top: t, bottom: t + 40, height: 40, left: 0, right: 300, width: 300, x: 0, y: t, toJSON: () => ({}) }
        }
      }
      return list
    }
    const at = (n: number): number => MANY.indexOf(`== Раздел ${n}\n`)

    it('the row of the new current section comes into sight; a list the author scrolled stays until the section changes', () => {
      open(MANY)
      const list = withLayout()
      const top = vi.spyOn(page!.editor!, 'topVisibleOffset')
      top.mockReturnValue(at(10))
      visualScroll()
      root.querySelector<HTMLButtonElement>('.isle-strokes')!.click()
      // opened: the current row (10, y 360) is put in the middle of the list
      expect(list.scrollTop).toBe(360 - (200 - 40) / 2)
      // the author scrolls the list; the same section stays current: no move
      list.scrollTop = 0
      visualScroll()
      expect(list.scrollTop).toBe(0)
      // the document scrolls to section 3 (y 80, in sight): the list stays; to 20 (y 760): it moves so that the row is whole in sight
      top.mockReturnValue(at(3))
      visualScroll()
      expect(list.scrollTop).toBe(0)
      top.mockReturnValue(at(20))
      visualScroll()
      expect(list.scrollTop).toBe(760 + 40 - 200 + 6)
      expect(list.querySelector('.tree-item.on')!.textContent).toBe('Раздел 20')
    })

    it('a closed panel does not move', () => {
      open(MANY)
      const list = withLayout()
      const top = vi.spyOn(page!.editor!, 'topVisibleOffset')
      top.mockReturnValue(at(20))
      visualScroll()
      expect(list.scrollTop).toBe(0)
    })

    it('the current row is not just bold: it has the class «on» that the sheet paints, and the stroke of it too', () => {
      open(MANY)
      vi.spyOn(page!.editor!, 'topVisibleOffset').mockReturnValue(at(7))
      visualScroll()
      expect(root.querySelectorAll('.isle-strokes .stroke.on')).toHaveLength(1)
      expect(root.querySelector('.isle-strokes .stroke.on')!.getAttribute('data-index')).toBe('6')
    })

    it('the list shows its scrollbar while it scrolls', () => {
      open(MANY)
      const list = root.querySelector<HTMLElement>('.sections-card .tree-list')!
      list.dispatchEvent(new Event('scroll'))
      expect(list.classList.contains('scrolling')).toBe(true)
      vi.advanceTimersByTime(900)
      expect(list.classList.contains('scrolling')).toBe(false)
    })
  })

  it('the left capsule opens the card «Разделы» and closes it by a second press, Esc and a press elsewhere', () => {
    open(DOC)
    const isle = root.querySelector<HTMLButtonElement>('.isle-sections')!
    const card = root.querySelector<HTMLElement>('.sections-card')!
    expect(card.hidden).toBe(true)
    expect(isle.getAttribute('aria-expanded')).toBe('false')
    isle.click()
    expect(card.hidden).toBe(false)
    expect(isle.getAttribute('aria-expanded')).toBe('true')
    isle.click()
    expect(card.hidden).toBe(true)
    isle.click()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(card.hidden).toBe(true)
    isle.click()
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    expect(card.hidden).toBe(true)
    // the island of strokes opens the same card
    root.querySelector<HTMLButtonElement>('.isle-strokes')!.click()
    expect(card.hidden).toBe(false)
    expect(card.hasAttribute('data-pinned')).toBe(true)
    expect(root.querySelector('.isle-strokes')!.hasAttribute('data-pinned')).toBe(true)
  })

  describe('the strokes open the panel by hovering and keep it by a click', () => {
    const strokes = (): HTMLButtonElement => root.querySelector<HTMLButtonElement>('.isle-strokes')!
    const card = (): HTMLElement => root.querySelector<HTMLElement>('.sections-card')!
    const fire = (el: Element, type: string): void => void el.dispatchEvent(new MouseEvent(type))

    it('opens after 150 ms on the strokes, not for a quick pass', () => {
      open(DOC)
      fire(strokes(), 'mouseenter')
      vi.advanceTimersByTime(100)
      fire(strokes(), 'mouseleave')
      vi.advanceTimersByTime(500)
      expect(card().hidden).toBe(true)
      fire(strokes(), 'mouseenter')
      vi.advanceTimersByTime(150)
      expect(card().hidden).toBe(false)
      expect(strokes().getAttribute('aria-expanded')).toBe('true')
      expect(page!.outline!.pinned).toBe(false)
      expect(card().querySelectorAll('.tree-item').length).toBeGreaterThan(0)
    })

    it('closes 300 ms after the mouse left, unless it came back or went to the panel', () => {
      open(DOC)
      fire(strokes(), 'mouseenter')
      vi.advanceTimersByTime(150)
      fire(strokes(), 'mouseleave')
      fire(card(), 'mouseenter')
      vi.advanceTimersByTime(1000)
      expect(card().hidden).toBe(false)
      fire(card(), 'mouseleave')
      vi.advanceTimersByTime(200)
      fire(card(), 'mouseenter')
      vi.advanceTimersByTime(500)
      expect(card().hidden).toBe(false)
      fire(card(), 'mouseleave')
      vi.advanceTimersByTime(300)
      expect(card().hidden).toBe(true)
      expect(strokes().getAttribute('aria-expanded')).toBe('false')
    })

    it('hovering does not close the card of a remark, a click pins and closes it', () => {
      open(DOC)
      const closeOthers = vi.spyOn(page!.remarks!, 'close')
      fire(strokes(), 'mouseenter')
      vi.advanceTimersByTime(150)
      expect(closeOthers).not.toHaveBeenCalled()
      strokes().click()
      expect(closeOthers).toHaveBeenCalled()
      expect(page!.outline!.pinned).toBe(true)
      fire(strokes(), 'mouseleave')
      vi.advanceTimersByTime(1000)
      expect(card().hidden).toBe(false)
      strokes().click()
      expect(card().hidden).toBe(true)
    })

    it('Esc closes the pinned panel and returns the focus to the strokes', () => {
      open(DOC)
      strokes().click()
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      expect(card().hidden).toBe(true)
      expect(document.activeElement).toBe(strokes())
    })

    it('a choice closes the panel and it does not open again under a still mouse', () => {
      open(DOC)
      fire(strokes(), 'mouseenter')
      vi.advanceTimersByTime(150)
      fire(strokes(), 'mouseleave')
      fire(card(), 'mouseenter')
      card().querySelector<HTMLElement>('.tree-item')!.click()
      expect(card().hidden).toBe(true)
      fire(card(), 'mouseleave')
      fire(strokes(), 'mouseenter')
      vi.advanceTimersByTime(150)
      expect(card().hidden).toBe(false)
    })

    it('after Esc the panel does not open again while the mouse stays on the strokes', () => {
      open(DOC)
      fire(strokes(), 'mouseenter')
      strokes().click()
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      expect(card().hidden).toBe(true)
      vi.advanceTimersByTime(1000)
      expect(card().hidden).toBe(true)
      fire(strokes(), 'mouseleave')
      fire(strokes(), 'mouseenter')
      vi.advanceTimersByTime(150)
      expect(card().hidden).toBe(false)
      expect(card().hasAttribute('data-pinned')).toBe(false)
    })

    it('the pin is on the DOM only while the panel is held; the fold keeps the class «closing» for 170 ms', () => {
      open(DOC)
      strokes().click()
      expect(card().hasAttribute('data-pinned')).toBe(true)
      strokes().click()
      expect(card().hidden).toBe(true)
      expect(card().hasAttribute('data-pinned')).toBe(false)
      expect(card().classList.contains('closing')).toBe(true)
      vi.advanceTimersByTime(169)
      expect(card().classList.contains('closing')).toBe(true)
      vi.advanceTimersByTime(1)
      expect(card().classList.contains('closing')).toBe(false)
    })

    it('with reduced motion the fold has no «closing» class: the card goes at once', () => {
      const mm = vi.fn(() => ({ matches: true }))
      vi.stubGlobal('matchMedia', mm)
      try {
        open(DOC)
        strokes().click()
        strokes().click()
        expect(card().hidden).toBe(true)
        expect(card().classList.contains('closing')).toBe(false)
      } finally {
        vi.unstubAllGlobals()
      }
    })

    it('does not close while a row is dragged', () => {
      open(DOC)
      fire(strokes(), 'mouseenter')
      vi.advanceTimersByTime(150)
      fire(strokes(), 'mouseleave')
      fire(card(), 'mouseenter')
      const row = card().querySelector<HTMLElement>('.tree-row')!
      row.dispatchEvent(new Event('dragstart', { bubbles: true, cancelable: true }))
      fire(card(), 'mouseleave')
      vi.advanceTimersByTime(1000)
      expect(card().hidden).toBe(false)
      row.dispatchEvent(new Event('dragend', { bubbles: true }))
      vi.advanceTimersByTime(300)
      expect(card().hidden).toBe(true)
    })
  })

  it('a click on a section closes the card and the capsule names that section', () => {
    open(DOC)
    const isle = root.querySelector<HTMLButtonElement>('.isle-sections')!
    isle.click()
    const second = [...root.querySelectorAll<HTMLElement>('.tree-item')].find((el) => el.textContent === 'Второй')!
    // (jsdom has no layout: the scroll the click makes is told by the editor's answer)
    vi.spyOn(page!.editor!, 'topVisibleOffset').mockReturnValue(DOC.indexOf('== Второй'))
    second.click()
    root.querySelector('.ed-visual')!.dispatchEvent(new Event('scroll'))
    vi.advanceTimersByTime(50)
    expect(root.querySelector<HTMLElement>('.sections-card')!.hidden).toBe(true)
    expect(page!.outline!.current).toBe('Второй')
  })

  it('the capsule names the document above the first section, then the section by the scroll', () => {
    open(DOC)
    const name = (): string => root.querySelector('.isle-sections .isle-name')!.textContent!
    const top = vi.spyOn(page!.editor!, 'topVisibleOffset')
    expect(name()).toBe('Документ')
    top.mockReturnValue(DOC.indexOf('Текст *жирный*'))
    root.querySelector('.ed-visual')!.dispatchEvent(new Event('scroll'))
    vi.advanceTimersByTime(50)
    expect(name()).toBe('Первый')
    top.mockReturnValue(DOC.indexOf('== Второй'))
    root.querySelector('.ed-visual')!.dispatchEvent(new Event('scroll'))
    vi.advanceTimersByTime(50)
    expect(name()).toBe('Второй')
  })

  it('the island of strokes has one stroke for a section, the current one dark, and goes in «Текст»', () => {
    open('= Документ\n\n== Один\n\n=== Вложенный\n\n== Два\n\nСсылка <<нет>> тут.\n')
    const strokes = [...root.querySelectorAll<HTMLElement>('.isle-strokes .stroke')]
    expect(strokes).toHaveLength(3)
    expect(strokes.map((s) => s.classList.contains('sub'))).toEqual([false, true, false])
    // the strokes light nothing up, even for a section with a remark; the counter stays in the card
    expect(strokes.map((s) => s.classList.contains('has-remark'))).toEqual([false, false, false])
    expect(root.querySelectorAll('.sections-card .tree-badge')).toHaveLength(1)
    expect(root.querySelector<HTMLElement>('.isle-strokes')!.hidden).toBe(false)
    page!.toggleMode()
    expect(root.querySelector<HTMLElement>('.isle-strokes')!.hidden).toBe(true)
    expect(root.querySelector<HTMLButtonElement>('.isle-sections')!.disabled).toBe(true)
    page!.toggleMode()
    expect(root.querySelector<HTMLElement>('.isle-strokes')!.hidden).toBe(false)
    expect(root.querySelector<HTMLButtonElement>('.isle-sections')!.disabled).toBe(false)
  })

  it('names the document without its subtitle', () => {
    expect(documentName('= Метеостанция «Сойка»: запуск в поле\n\nТекст.\n')).toBe('Метеостанция «Сойка»')
    expect(documentName('Просто текст.\n')).toBe('')
    expect(documentName('== Раздел\n\n= Позже\n')).toBe('')
  })

  it('shows in the visual and in the text mode of a big file alike', () => {
    open(DOC, { mode: 'text', big: { bytes: 1_400_000 } })
    expect(items()).toEqual(['Первый', 'Второй'])
  })
})

describe('the remarks', () => {
  const LINK = '= Документ\n\n== Первый\n\nТекст.\n\n== Второй\n\nСсылка <<нет-такого>> тут.\n'
  const badges = (): string[] => [...root.querySelectorAll('.tree-badge')].map((el) => el.textContent!)

  it('underlines the link in the visual editor with the message, counts it in the section', () => {
    open(LINK)
    const mark = root.querySelector<HTMLElement>('.doc .diag')!
    expect(mark).not.toBeNull()
    expect(mark.title).toBe('Ссылка ведёт на «нет-такого», а такого раздела или якоря в документе нет')
    expect(badges()).toEqual(['1'])
    const row = root.querySelector('.tree-badge')!.closest('.tree-row')!
    expect(row.querySelector('.tree-item')!.textContent).toBe('Второй')
    expect(root.querySelector('.tree-total')).toBeNull()
  })

  it('a click on the counter opens the card of the remark and puts the cursor on the link', () => {
    open(LINK)
    const at = LINK.indexOf('<<')
    root.querySelector<HTMLElement>('.isle-sections')!.click()
    root.querySelector<HTMLElement>('.tree-badge')!.click()
    expect(page!.editor!.selectionOffsets()!.anchor).toBeGreaterThanOrEqual(at)
    expect(page!.editor!.selectionOffsets()!.anchor).toBeLessThanOrEqual(at + 14)
    expect(page!.remarks!.isOpen).toBe(true)
    expect(root.querySelector<HTMLElement>('.sections-card')!.hidden).toBe(true)
  })

  it('the wavy line is in «Текст» too (the lint of Nota)', async () => {
    open(LINK)
    page!.toggleMode()
    forceLinting(page!.source!.view)
    await vi.advanceTimersByTimeAsync(300)
    expect(diagnosticCount(page!.source!.view.state)).toBe(1)
    expect(root.querySelector('.cm-lintRange-warning')).not.toBeNull()
    expect(root.querySelector('.cm-lint-marker')).not.toBeNull()
  })

  it('after the fix the line and the counter go within 0.5 s', () => {
    open(LINK)
    const t = page!.mirror!.text
    page!.mirror!.apply([{ from: t.indexOf('<<'), to: t.indexOf('>>') + 2, insert: '<<_первый>>' }])
    vi.advanceTimersByTime(500)
    expect(root.querySelector('.doc .diag')).toBeNull()
    expect(badges()).toEqual([])
  })

  it('the right capsule says how many: «1 замечание», «Замечаний нет» (the capsule is then invisible)', () => {
    open(LINK)
    const isle = root.querySelector<HTMLElement>('.isle-remarks')!
    expect(isle.querySelector('.rm-text')!.textContent).toBe('1 замечание')
    expect(isle.classList.contains('has-remarks')).toBe(true)
    const t = page!.mirror!.text
    page!.mirror!.apply([{ from: t.indexOf('<<'), to: t.indexOf('>>') + 2, insert: '<<_первый>>' }])
    vi.advanceTimersByTime(500)
    expect(isle.querySelector('.rm-text')!.textContent).toBe('Замечаний нет')
    expect(isle.classList.contains('has-remarks')).toBe(false)
    isle.click()
    expect(root.querySelector<HTMLElement>('.remark-card')!.hidden).toBe(true)
  })

  it('counts errors and warnings of diagnostics.adoc: the counters of sections add up to the count of the right capsule, info is not counted', () => {
    open(fixture('editor/diagnostics.adoc'))
    const doc = page!.mirror!.doc
    const counted = doc.diagnostics.filter((d) => d.severity !== 'info').length
    expect(counted).toBeGreaterThan(3)
    const sum = badges().reduce((a, b) => a + Number(b), 0)
    expect(sum).toBe(counted)
    expect(root.querySelector('.isle-remarks .rm-text')!.textContent).toBe(remarkCount(counted, 'ru'))
  })

  it('the texts: the codes of the engine in Russian (all of them: test/webview/remarks-locale.test.ts)', () => {
    expect(remarkText({ code: 'unresolved-reference', message: 'The reference to "а б" has no target in the document' }, 'ru')).toBe(
      'Ссылка ведёт на «а б», а такого раздела или якоря в документе нет',
    )
    expect(remarkText({ code: 'section-level-skipped', message: 'Section title out of sequence: expected level 2, got level 4' }, 'ru')).toBe(
      'Заголовок пропускает уровень: ожидался Заголовок 3 или крупнее, а здесь Заголовок 5',
    )
    expect(remarkText({ code: 'list-item-index', message: 'List item index: expected 2, got 3' }, 'ru')).toBe('Номер пункта списка: ожидался 2, а здесь 3')
    expect([1, 2, 5, 11, 21, 24].map((n) => remarkCount(n, 'ru'))).toEqual(['1 замечание', '2 замечания', '5 замечаний', '11 замечаний', '21 замечание', '24 замечания'])
  })

  it('the reveal command of the host puts the cursor on the place', () => {
    open(LINK)
    const at = LINK.indexOf('<<')
    host({ type: 'command', name: 'reveal', offset: at })
    expect(page!.editor!.selectionOffsets()!.anchor).toBeGreaterThanOrEqual(at)
  })
})

describe('a big file', () => {
  it('opens in «Текст» with the whole text and a strip with the button; no visual editor yet', () => {
    open(DOC, { mode: 'text', big: { bytes: 1_468_006 } })
    expect(page!.mode).toBe('text')
    expect(page!.editor).toBeUndefined()
    expect(page!.source!.getText()).toBe(DOC)
    const strip = root.querySelector<HTMLElement>('.big-strip')!
    expect(strip.hidden).toBe(false)
    expect(strip.querySelector('.big-text')!.textContent).toBe(
      'Файл больше 1 МБ (1,4 МБ), поэтому он открыт в режиме «Текст»: визуальный редактор на таком файле открывается долго и отвечает с задержкой.',
    )
    expect(bigText(1_468_006)).toBe(strip.querySelector('.big-text')!.textContent)
    expect(strip.querySelector('button')!.textContent).toBe('Всё равно открыть визуально')
    expect(root.textContent).not.toContain('Файл слишком большой')
  })

  it('the strip goes away when the person switches to «Визуально» with the button of the title or the palette', () => {
    open(DOC, { mode: 'text', big: { bytes: 1_468_006 } })
    expect(root.querySelector<HTMLElement>('.big-strip')!.hidden).toBe(false)
    page!.toggleMode()
    expect(page!.mode).toBe('visual')
    expect(root.querySelector<HTMLElement>('.big-strip')!.hidden).toBe(true)
    page!.toggleMode()
    expect(root.querySelector<HTMLElement>('.big-strip')!.hidden).toBe(true)
  })

  it('«Всё равно открыть визуально» opens the visual editor in this tab, writes nothing, and the switch works', () => {
    open(DOC, { mode: 'text', big: { bytes: 1_468_006 } })
    root.querySelector<HTMLElement>('.big-go')!.click()
    expect(page!.mode).toBe('visual')
    expect(page!.editor!.getText()).toBe(DOC)
    expect(root.querySelector<HTMLElement>('.big-strip')!.hidden).toBe(true)
    vi.advanceTimersByTime(2000)
    expect(edits()).toEqual([])
    page!.toggleMode()
    expect(page!.mode).toBe('text')
    page!.toggleMode()
    expect(page!.mode).toBe('visual')
  })
})

describe('a failure of a tab that shows its document', () => {
  it('a failure before the first display is fatal', () => {
    root = document.createElement('div')
    document.body.append(root)
    page = startPage(api, root)
    host({ type: 'init', text: undefined as never, version: 1, fileName: 'a.adoc', locale: 'ru', outlineView: 'capsule', fileDir: '/work/docs', mode: 'visual' })
    expect(sent.find((m) => m.type === 'error')).toMatchObject({ type: 'error', fatal: true })
  })

  it('a message handler that throws: the tab stays, shows the document again with the strip, and sends what was typed first', () => {
    open(DOC)
    const at = DOC.indexOf('Конец')
    page!.editor!.setSelectionAtOffset(at)
    page!.editor!.view.dispatch(page!.editor!.view.state.tr.insertText('до сбоя '))
    vi.spyOn(page!.mirror!, 'update').mockImplementationOnce(() => {
      throw new Error('сбой обработчика')
    })
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    host({ type: 'update', version: 2, changes: [{ from: 0, to: 0, insert: '' }], reason: undefined })
    expect(root.querySelector('.ed-body')).not.toBeNull()
    const strip = root.querySelector<HTMLElement>('.notice.crash')!
    expect(strip.hidden).toBe(false)
    expect(strip.querySelector('.notice-text')!.textContent).toBe('Во вкладке произошла ошибка: документ показан заново по файлу.')
    expect(CRASH_MESSAGE).toBe(strip.querySelector('.notice-text')!.textContent)
    // what was typed before the failure is in the edit that went to the host
    expect(edits()[0]!.changes).toEqual([{ from: at, to: at, insert: 'до сбоя ' }])
    expect(sent.find((m) => m.type === 'error')).toMatchObject({ type: 'error' })
    expect(sent.find((m) => m.type === 'error')).not.toHaveProperty('fatal')
    // the whole text is asked for once the edit is written
    expect(types()).not.toContain('resync')
    host({ type: 'ack', id: 1, version: 2 })
    expect(types()).toContain('resync')
    host({ type: 'reset', text: page!.mirror!.text, version: 2, stale: false })
    expect(page!.editor!.getText()).toContain('до сбоя Конец')
    expect(page!.editor!.view.dom.textContent).toContain('до сбоя Конец')
  })

  it('an editor that fails on an event of the session: the tab shows the document again', () => {
    open(DOC)
    page!.mirror!.subscribe(() => {
      throw new Error('сбой редактора')
    })
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const editorBefore = page!.editor
    host({ type: 'update', version: 2, changes: [{ from: 0, to: 0, insert: 'Ы' }], reason: undefined })
    expect(root.querySelector<HTMLElement>('.notice.crash')!.hidden).toBe(false)
    expect(page!.editor).not.toBe(editorBefore)
    expect(types()).toContain('resync')
  })

  it('the third failure within 10 s is fatal', () => {
    open(DOC)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const boom = (): void => {
      page!.mirror!.update = () => {
        throw new Error('сбой')
      }
      host({ type: 'update', version: 2, changes: [], reason: undefined })
    }
    boom()
    boom()
    expect(sent.filter((m) => m.type === 'error' && (m as { fatal?: boolean }).fatal)).toHaveLength(0)
    boom()
    expect(sent.filter((m) => m.type === 'error' && (m as { fatal?: boolean }).fatal)).toHaveLength(1)
  })

  it('failures far apart are not counted together', () => {
    open(DOC)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    for (let i = 0; i < 4; i++) {
      page!.mirror!.update = () => {
        throw new Error('сбой')
      }
      host({ type: 'update', version: 2, changes: [], reason: undefined })
      vi.advanceTimersByTime(11_000)
    }
    expect(sent.filter((m) => m.type === 'error' && (m as { fatal?: boolean }).fatal)).toHaveLength(0)
  })
})
