// the blocks of «+»: the list under the capsule of a narrow tab and the icons of the wide capsule (the keys, the places, the same blocks as «/»).
import { TextSelection } from 'prosemirror-state'
import { flushSync } from 'react-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type Page, startPage } from '../../src/webview/main.js'
import type { ToHost, ToTab } from '../../src/protocol.js'

let sent: ToHost[]
let root: HTMLElement
let page: Page | undefined

const api = { postMessage: (m: ToHost) => void sent.push(m) }
const host = (message: ToTab): void => void window.dispatchEvent(new MessageEvent('message', { data: message }))
const tick = async (ms = 50): Promise<void> => void (await vi.advanceTimersByTimeAsync(ms))

function open(text: string, blocksInCapsule?: 'all' | 'frequent'): Page {
  root = document.createElement('div')
  root.id = 'app'
  document.body.append(root)
  page = startPage(api, root, { mac: false })
  host({ type: 'init', text, version: 1, fileName: 'a.adoc', locale: 'ru', outlineView: 'capsule', fileDir: '/work/docs', mode: 'visual', ...(blocksInCapsule ? { blocksInCapsule } : {}) })
  page.flush()
  return page
}

/** The cursor at the end of the first text that has `word`. */
async function cursorAfter(word: string): Promise<void> {
  const view = page!.editor!.view
  let found: number | null = null
  view.state.doc.descendants((node, pos) => {
    if (found !== null || !node.isText) return
    const i = node.text!.indexOf(word)
    if (i >= 0) found = pos + i + word.length
  })
  if (found === null) throw new Error(`no «${word}» on the screen`)
  view.focus()
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, found)))
  await tick()
}

const plus = (): HTMLButtonElement => root.querySelector<HTMLButtonElement>('[data-cmd="insert"]')!
const list = (): HTMLElement | null => root.querySelector<HTMLElement>('.leave:not(.is-leaving) .blocklist')
const capsule = (): HTMLElement => root.querySelector<HTMLElement>('.isle-tools')!
const key = async (target: Element, k: string): Promise<KeyboardEvent> => {
  const event = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })
  target.dispatchEvent(event)
  await tick()
  return event
}
/** A press on «+» from the keyboard (`detail` 0) or from the mouse (1). */
const press = async (el: Element, detail = 0): Promise<void> => {
  el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail }))
  await tick()
}
/** The mouse over `el`: the popup of the capsule after its delay. */
const hoverTip = async (el: Element): Promise<HTMLElement> => {
  flushSync(() => void el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: null })))
  await tick(450)
  const all = document.querySelectorAll<HTMLElement>('[role=tooltip]')
  expect(all).toHaveLength(1)
  return all[0]!
}
const focusedBlock = (): string | undefined => (document.activeElement as HTMLElement | null)?.dataset.block

beforeEach(() => {
  vi.useFakeTimers()
  sent = []
  page = undefined
  document.body.className = ''
  document.elementFromPoint = () => null
})
afterEach(() => {
  page?.destroy()
  document.body.textContent = ''
  vi.useRealTimers()
})

describe('the list of «+»', () => {
  it('Alt+F10 goes to «+»; Enter opens the list with the focus on «Заголовок 2»; the arrows go round, Home and End, Tab stays in', async () => {
    open('a\n\nb\n')
    await cursorAfter('a')
    page!.editor!.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', altKey: true, bubbles: true, cancelable: true }))
    expect(document.activeElement).toBe(plus())
    await press(plus())
    expect(plus().getAttribute('aria-expanded')).toBe('true')
    expect(focusedBlock()).toBe('heading2')
    const menu = list()!
    await key(menu, 'ArrowUp')
    expect(focusedBlock()).toBe('image')
    await key(menu, 'ArrowDown')
    expect(focusedBlock()).toBe('heading2')
    await key(menu, 'End')
    expect(focusedBlock()).toBe('image')
    await key(menu, 'Home')
    expect(focusedBlock()).toBe('heading2')
    const tab = await key(menu, 'Tab')
    expect(tab.defaultPrevented).toBe(true)
    expect(list()).not.toBeNull()
  })

  it('↓↓ and a pick: the block is on the screen only, the file is not touched, the focus is in the text; the first letter writes it', async () => {
    open('a\n\nb\n')
    await cursorAfter('a')
    await press(plus())
    const menu = list()!
    for (let i = 0; i < 5; i++) await key(menu, 'ArrowDown')
    expect(focusedBlock()).toBe('unordered')
    ;(document.activeElement as HTMLElement).click()
    await tick()
    expect(list()).toBeNull()
    expect(page!.mirror!.text).toBe('a\n\nb\n')
    expect(page!.editor!.view.hasFocus()).toBe(true)
    page!.editor!.view.dom.dispatchEvent(new Event('focus'))
    const view = page!.editor!.view
    view.dispatch(view.state.tr.insertText('Т'))
    expect(page!.mirror!.text).toBe('a\n\n* Т\n\nb\n')
  })

  it('Esc closes the list, the cursor stays; a second press of «+» and a press elsewhere close it too', async () => {
    open('a\n\nb\n')
    await cursorAfter('a')
    const at = page!.editor!.view.state.selection.head
    await press(plus())
    await key(list()!, 'Escape')
    await tick(200)
    expect(root.querySelector('.leave:not(.is-leaving) .blocklist')).toBeNull()
    expect(page!.editor!.view.state.selection.head).toBe(at)
    expect(page!.editor!.view.hasFocus()).toBe(true)
    await press(plus())
    await press(plus(), 1)
    expect(list()).toBeNull()
    await press(plus(), 1)
    expect(list()).not.toBeNull()
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    await tick()
    expect(list()).toBeNull()
    expect(page!.mirror!.text).toBe('a\n\nb\n')
  })

  it('the list has a line before «Маркированный список» and before «Таблица», and none between the headings 2–6', async () => {
    open('a\n\nb\n')
    await cursorAfter('a')
    await press(plus(), 1)
    const withLine = [...list()!.querySelectorAll<HTMLElement>('[data-block]')]
      .filter((b) => b.previousElementSibling?.classList.contains('bm-sep'))
      .map((b) => b.dataset.block)
    expect(withLine).toEqual(['unordered', 'table'])
    expect(list()!.querySelectorAll('.bm-sep')).toHaveLength(2)
  })

  it('opened by the mouse the list has nothing chosen and takes no focus', async () => {
    open('a\n\nb\n')
    await cursorAfter('a')
    await press(plus(), 1)
    expect(list()).not.toBeNull()
    expect(list()!.querySelector('[data-on]')).toBeNull()
    expect(list()!.contains(document.activeElement)).toBe(false)
  })

  it('the mode «Текст»: «+» is off and nothing opens', async () => {
    open('a\n\nb\n')
    page!.toggleMode()
    await tick()
    expect(plus().disabled).toBe(true)
    await press(plus())
    expect(list()).toBeNull()
  })

  it('«Нумерованный список» from the middle of a paragraph: the file is not touched until the first letter', async () => {
    open('abc\n\nb\n')
    await cursorAfter('a')
    await press(plus())
    root.querySelector<HTMLElement>('[data-block="ordered"]')!.click()
    await tick()
    expect(page!.mirror!.text).toBe('abc\n\nb\n')
  })

  it('the tip of «+» names the new blocks and still shows «/»', async () => {
    open('a\n')
    expect(plus().getAttribute('aria-label')).toBe('Вставить блок')
    await cursorAfter('a')
    const t = await hoverTip(plus())
    expect(t.querySelector('.nota-tip-name')!.textContent).toBe('Вставить блок')
    expect(t.querySelector('.nota-tip-desc')!.textContent).toContain('Заголовки, списки, таблица, код, Mermaid, предупреждение, раскрывающийся блок, картинка')
    expect([...t.querySelectorAll('kbd')].map((k) => k.textContent)).toEqual(['/'])
    expect(t.querySelector('.nota-tip-note')?.textContent ?? t.textContent).toContain('в пустой строке — то же самое')
  })

  it('in the mode «Текст» «+» is off and the capsule shows no popup for it (as before); the popup is back with the mode «Визуально» and still has «/»', async () => {
    open('a\n')
    await cursorAfter('a')
    page!.toggleMode()
    await tick()
    expect(plus().disabled).toBe(true)
    flushSync(() => void plus().dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: null })))
    await tick(1000)
    expect(document.querySelectorAll('[role=tooltip]')).toHaveLength(0)
    expect(plus().getAttribute('aria-label')).toBe('Вставить блок')
    page!.toggleMode()
    await tick()
    await cursorAfter('a')
    const t = await hoverTip(plus())
    expect([...t.querySelectorAll('kbd')].map((k) => k.textContent)).toEqual(['/'])
  })
})

describe('the wide capsule: the blocks as icons, always open', () => {
  const observers: ResizeObserverCallback[] = []
  /** The width of the tab a page without layout would have. */
  let room = 1280
  const saved: Record<string, PropertyDescriptor | undefined> = {}
  const patch = (name: string, get: (this: HTMLElement) => unknown): void => {
    saved[name] = Object.getOwnPropertyDescriptor(HTMLElement.prototype, name)
    Object.defineProperty(HTMLElement.prototype, name, { configurable: true, get })
  }
  /** The tab got another width: the observers run, as in a browser, and the frame goes. */
  const resize = async (width: number): Promise<void> => {
    room = width
    for (const cb of observers) cb([], {} as ResizeObserver)
    await tick(50)
  }
  const IDS = ['heading2', 'heading3', 'heading4', 'heading5', 'heading6', 'table', 'code', 'mermaid', 'admonition', 'collapsible', 'image']
  const icons = (): HTMLButtonElement[] => [...capsule().querySelectorAll<HTMLButtonElement>(':scope > .tl-main button[data-block]')]
  const icon = (id: string): HTMLButtonElement => capsule().querySelector<HTMLButtonElement>(`button[data-block="${id}"]`)!
  beforeEach(() => {
    room = 1280
    observers.length = 0
    patch('clientWidth', function () {
      if (this.classList.contains('ed-main') || this.classList.contains('ed-isles')) return room
      if (this.classList.contains('isle-mid')) return room - 300
      return 0
    })
    patch('offsetWidth', function () {
      // (the gear of the round capsule is counted once, and here it has no width: the numbers of the threshold stay)
      return this.closest('.isle-right') && !this.classList.contains('isle-settings') ? 100 : 0
    })
    const original = Element.prototype.getBoundingClientRect
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      writable: true,
      value: function (this: Element) {
        // (the copy of the frequent set is shorter: it has «+» and four icons)
        if (this.classList.contains('tl-main') && this.closest('.tl-measure')) return { width: this.querySelector('.tl-plus') ? 420 : 593, height: 34, top: 0, left: 0, right: 593, bottom: 34, x: 0, y: 0, toJSON: () => ({}) }
        return original.call(this)
      },
    })
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(cb: ResizeObserverCallback) {
          observers.push(cb)
        }
        observe(): void {}
        disconnect(): void {}
        unobserve(): void {}
      },
    )
  })
  afterEach(() => {
    for (const [name, d] of Object.entries(saved)) {
      if (d) Object.defineProperty(HTMLElement.prototype, name, d)
      else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[name]
    }
    delete (HTMLElement.prototype as unknown as Record<string, unknown>).getBoundingClientRect
    vi.unstubAllGlobals()
  })

  it('a wide tab: without a click the capsule has «Текст ⌄», the headings, the lists and the blocks, no «+»; the names and the lines are the ones of «/»', async () => {
    open('a\n\nb\n')
    await cursorAfter('a')
    expect(capsule().dataset.view).toBe('wide')
    expect(root.querySelector('[data-cmd="insert"]')).toBeNull()
    expect(icons().map((b) => b.dataset.block)).toEqual(IDS)
    expect(capsule().querySelector('[data-cmd="style"]')).not.toBeNull()
    for (const cmd of ['ul', 'ol', 'check']) expect(capsule().querySelector(`[data-cmd="${cmd}"]`)).not.toBeNull()
    expect(icon('heading2').getAttribute('aria-label')).toBe('Заголовок 2')
    const t = await hoverTip(icon('mermaid'))
    expect(t.querySelector('.nota-tip-name')!.textContent).toBe('Mermaid')
    expect(t.querySelector('.nota-tip-desc')!.textContent).toBe('Схема из текста')
    expect(document.querySelector('.blocklist')).toBeNull()
  })

  it('a click on «Таблица»: the table is on the screen only, the capsule stays open with all its buttons, the focus is in the text', async () => {
    open('a\n\nb\n')
    await cursorAfter('a')
    await press(icon('table'), 1)
    expect(page!.editor!.view.state.doc.child(1).type.name).toBe('table')
    expect(page!.mirror!.text).toContain('|===')
    expect(capsule().dataset.view).toBe('wide')
    expect(icons()).toHaveLength(11)
    expect(page!.editor!.view.hasFocus()).toBe(true)
  })

  it('«Картинка» asks for the picture under its icon', async () => {
    open('a\n\nb\n')
    await cursorAfter('a')
    await press(icon('image'), 1)
    const asked = sent.find((m) => m.type === 'listFiles') as Extract<ToHost, { type: 'listFiles' }>
    expect(asked.kind).toBe('image')
    expect(page!.mirror!.text).toBe('a\n\nb\n')
    expect(capsule().dataset.view).toBe('wide')
  })

  it('a tab where the capsule does not fit (or ≤ 650 px) is narrow: «+», «Текст ⌄», the lists, no icons; «+» opens the list of 14', async () => {
    for (const width of [390, 600, 650, 700]) {
      room = width
      open('a\n\nb\n')
      await cursorAfter('a')
      expect(capsule().dataset.view).toBe('narrow')
      expect(icons()).toHaveLength(0)
      await press(plus(), 1)
      expect(list()!.querySelectorAll('[data-block]')).toHaveLength(14)
      page!.destroy()
      document.body.textContent = ''
    }
  })

  it('the icons are one stop of Tab; ←/→ go round, Home and End to the ends, the popup shows at once; Enter inserts; Esc puts the cursor back', async () => {
    open('a\n\nb\n')
    await cursorAfter('a')
    const at = page!.editor!.view.state.selection.head
    page!.editor!.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', altKey: true, bubbles: true, cancelable: true }))
    expect(document.activeElement).toBe(capsule().querySelector('[data-cmd="style"]'))
    expect(icons().filter((b) => b.tabIndex === 0)).toHaveLength(1)
    icon('heading2').focus()
    await key(icon('heading2'), 'ArrowLeft')
    expect(focusedBlock()).toBe('image')
    expect(icons().filter((b) => b.tabIndex === 0).map((b) => b.dataset.block)).toEqual(['image'])
    await key(icon('image'), 'ArrowRight')
    expect(focusedBlock()).toBe('heading2')
    await key(icon('heading2'), 'End')
    expect(focusedBlock()).toBe('image')
    await key(icon('image'), 'Home')
    expect(focusedBlock()).toBe('heading2')
    await key(icon('heading2'), 'ArrowRight')
    await key(icon('heading3'), 'ArrowRight')
    expect(focusedBlock()).toBe('heading4')
    expect(document.querySelector('[role=tooltip] .nota-tip-name')?.textContent).toBe('Заголовок 4')
    await key(icon('heading4'), 'Escape')
    expect(focusedBlock()).toBeUndefined()
    expect(page!.editor!.view.hasFocus()).toBe(true)
    expect(page!.editor!.view.state.selection.head).toBe(at)
    icon('code').focus()
    ;(document.activeElement as HTMLElement).click()
    await tick()
    expect(page!.editor!.view.state.doc.child(1).type.name).toBe('code_block')
    expect(page!.editor!.view.hasFocus()).toBe(true)
  })

  it('the mode «Текст»: the icons are pale, nothing is inserted, no popup, the file does not change; back in «Визуально» the capsule is open', async () => {
    open('a\n\nb\n')
    await cursorAfter('a')
    page!.toggleMode()
    await tick()
    expect(capsule().dataset.view).toBe('wide')
    expect(icons()).toHaveLength(11)
    expect(icons().every((b) => b.disabled)).toBe(true)
    icon('table').click()
    flushSync(() => void icon('table').dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: null })))
    await tick(1000)
    expect(document.querySelectorAll('[role=tooltip]')).toHaveLength(0)
    expect(page!.mirror!.text).toBe('a\n\nb\n')
    page!.toggleMode()
    await tick()
    expect(capsule().dataset.view).toBe('wide')
    expect(icons().some((b) => b.disabled)).toBe(false)
  })

  it('the list is open on «Код», the tab gets wide → the list goes, the capsule opens, the focus is on the icon «Код»; a list item «Маркированный список» → its button', async () => {
    room = 700
    open('a\n')
    await cursorAfter('a')
    await press(plus())
    for (let i = 0; i < 8; i++) await key(list()!, 'ArrowDown')
    expect(focusedBlock()).toBe('table')
    await key(list()!, 'ArrowDown')
    expect(focusedBlock()).toBe('code')
    await resize(1280)
    await tick(200)
    expect(list()).toBeNull()
    expect(capsule().dataset.view).toBe('wide')
    expect(document.activeElement).toBe(icon('code'))
    await resize(700)
    await tick(200)
    expect(document.activeElement).toBe(list()!.querySelector('[data-block="code"]'))
    for (let i = 0; i < 4; i++) await key(list()!, 'ArrowUp')
    expect(focusedBlock()).toBe('unordered')
    await resize(1280)
    await tick(200)
    expect(document.activeElement).toBe(capsule().querySelector('[data-cmd="ul"]'))
  })

  it('the focus on an icon, the tab gets narrow → the list opens with the same block; the focus elsewhere in the capsule or none → it just folds', async () => {
    open('a\n')
    await cursorAfter('a')
    icon('collapsible').focus()
    await resize(700)
    await tick(200)
    expect(capsule().dataset.view).toBe('narrow')
    expect(list()).not.toBeNull()
    expect(focusedBlock()).toBe('collapsible')
    await resize(1280)
    await tick(200)
    const style = capsule().querySelector<HTMLElement>('[data-cmd="style"]')!
    style.focus()
    await resize(700)
    await tick(200)
    expect(capsule().dataset.view).toBe('narrow')
    expect(list()).toBeNull()
    expect(document.activeElement).toBe(capsule().querySelector('[data-cmd="style"]'))
    await resize(1280)
    await tick(200)
    page!.editor!.view.focus()
    await resize(700)
    await tick(200)
    expect(list()).toBeNull()
    expect(capsule().dataset.view).toBe('narrow')
  })

  it('without a change of the measure the view does not change however often the observers run', async () => {
    open('a\n')
    await cursorAfter('a')
    const views = new Set<string | undefined>()
    for (let i = 0; i < 30; i++) {
      await resize(1280)
      views.add(capsule().dataset.view)
    }
    expect([...views]).toEqual(['wide'])
  })

  it('the cursor in a table cell, the row «Таблица» stands under the 11 icons; «Заливка ячейки ⌄» keeps them; «Код» goes after the table, the cell stays', async () => {
    const before = '|===\n|Ячейка\n|===\n'
    open(before)
    const view = page!.editor!.view
    let at = -1
    view.state.doc.descendants((node, pos) => {
      if (at < 0 && node.type.name === 'cell_text' && node.textContent === 'Ячейка') at = pos + 1 + node.content.size
      return at < 0
    })
    view.focus()
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, at)))
    await tick(300)
    expect(capsule().dataset.view).toBe('wide')
    expect(icons()).toHaveLength(11)
    const row = capsule().querySelector('.tl-row')!
    expect(row).not.toBeNull()
    expect(capsule().querySelector('.tl-main')!.contains(row)).toBe(false)
    const fill = row.querySelector<HTMLButtonElement>('[data-cmd="cell-fill"]')!
    await press(fill, 1)
    await tick(300)
    expect(capsule().querySelector('.tl-colors')).not.toBeNull()
    expect(icons()).toHaveLength(11)
    expect(capsule().dataset.view).toBe('wide')
    await press(icon('code'), 1)
    const text = page!.mirror!.text
    expect(text.indexOf('----')).toBeGreaterThan(text.lastIndexOf('|==='))
    expect(text.slice(0, text.lastIndexOf('|===') + 4)).toBe(before.trimEnd())
  })

  describe('nota.blocksInCapsule = frequent', () => {
    const FREQ = ['table', 'code', 'admonition', 'image']
    it('the capsule is «+», «Текст ⌄», the lists and four icons; it opens in a tab where all the blocks do not fit; «+» lists all 14', async () => {
      room = 700
      open('a\n\nb\n', 'frequent')
      await cursorAfter('a')
      expect(capsule().dataset.view).toBe('wide')
      expect(plus()).not.toBeNull()
      expect(icons().map((b) => b.dataset.block)).toEqual(FREQ)
      expect(capsule().querySelectorAll('[data-cmd="ul"], [data-cmd="ol"], [data-cmd="check"]')).toHaveLength(3)
      expect(icons().map((b) => b.tabIndex)).toEqual([0, -1, -1, -1])
      await resize(640)
      expect(capsule().dataset.view).toBe('narrow')
      await resize(700)
      expect(capsule().dataset.view).toBe('wide')
      await press(plus(), 1)
      expect(list()!.querySelectorAll('[data-block]')).toHaveLength(14)
      await key(list()!, 'Escape')
      room = 1280
      for (const cb of observers) cb([], {} as ResizeObserver)
      await tick(50)
      page!.editor!.view.focus()
      page!.editor!.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', altKey: true, bubbles: true, cancelable: true }))
      expect(document.activeElement).toBe(plus())
    })

    it('the same set at the default: all 11 icons and no «+»', async () => {
      open('a\n', 'all')
      await cursorAfter('a')
      expect(icons()).toHaveLength(11)
      expect(capsule().querySelector('[data-cmd="insert"]')).toBeNull()
    })

    it('the arrows go round the four icons; an icon inserts, Mermaid from «+» inserts Mermaid', async () => {
      open('a\n\nb\n', 'frequent')
      await cursorAfter('a')
      icon('table').focus()
      await key(icon('table'), 'ArrowLeft')
      expect(focusedBlock()).toBe('image')
      await key(icon('image'), 'Home')
      expect(focusedBlock()).toBe('table')
      await key(icon('table'), 'End')
      expect(focusedBlock()).toBe('image')
      await cursorAfter('a')
      await press(plus(), 1)
      list()!.querySelector<HTMLElement>('[data-block="mermaid"]')!.click()
      await tick()
      expect(page!.editor!.view.state.doc.childCount).toBe(3)
    })

    it('the list is open on «Код» or a list item, the tab gets wide → the list goes, the focus is on the icon «Код» or the button', async () => {
      room = 700
      open('a\n', 'frequent')
      await resize(640)
      await cursorAfter('a')
      await press(plus())
      for (let i = 0; i < 9; i++) await key(list()!, 'ArrowDown')
      expect(focusedBlock()).toBe('code')
      await resize(700)
      await tick(200)
      expect(list()).toBeNull()
      expect(capsule().dataset.view).toBe('wide')
      expect(document.activeElement).toBe(icon('code'))
      await resize(640)
      await tick(200)
      expect(document.activeElement).toBe(list()!.querySelector('[data-block="code"]'))
      for (let i = 0; i < 4; i++) await key(list()!, 'ArrowUp')
      expect(focusedBlock()).toBe('unordered')
      await resize(700)
      await tick(200)
      expect(list()).toBeNull()
      expect(document.activeElement).toBe(capsule().querySelector('[data-cmd="ul"]'))
    })

    it('the focus on «Mermaid» or «Заголовок 3» → the list stays open under «+» with the same item', async () => {
      room = 640
      open('a\n', 'frequent')
      await cursorAfter('a')
      await press(plus())
      await key(list()!, 'ArrowDown')
      expect(focusedBlock()).toBe('heading3')
      await resize(700)
      await tick(200)
      expect(capsule().dataset.view).toBe('wide')
      expect(list()).not.toBeNull()
      expect(document.activeElement).toBe(list()!.querySelector('[data-block="heading3"]'))
      for (let i = 0; i < 9; i++) await key(list()!, 'ArrowDown')
      expect(focusedBlock()).toBe('mermaid')
      await resize(640)
      await resize(700)
      await tick(200)
      expect(list()).not.toBeNull()
      expect(document.activeElement).toBe(list()!.querySelector('[data-block="mermaid"]'))
    })

    it('the focus on the icon «Код», the tab gets narrow → the list with «Код»; a list opened by the mouse in a wide tab stays under «+»', async () => {
      room = 700
      open('a\n', 'frequent')
      await cursorAfter('a')
      icon('code').focus()
      await resize(640)
      await tick(200)
      expect(capsule().dataset.view).toBe('narrow')
      expect(document.activeElement).toBe(list()!.querySelector('[data-block="code"]'))
      await key(list()!, 'Escape')
      await resize(700)
      await tick(200)
      await press(plus(), 1)
      expect(list()).not.toBeNull()
      await resize(640)
      await tick(200)
      expect(capsule().dataset.view).toBe('narrow')
      expect(list()).not.toBeNull()
    })

    it('a change of the setting redraws the capsule, closes the list, the tab and the text stay', async () => {
      room = 700
      open('a\n\nb\n')
      await cursorAfter('a')
      expect(capsule().dataset.view).toBe('narrow')
      const view = page!.editor!.view
      view.dispatch(view.state.tr.insertText('X'))
      const text = page!.mirror!.text
      const head = view.state.selection.head
      host({ type: 'blocksInCapsule', set: 'frequent' })
      await tick(200)
      expect(capsule().dataset.view).toBe('wide')
      expect(icons().map((b) => b.dataset.block)).toEqual(FREQ)
      expect(page!.mirror!.text).toBe(text)
      expect(page!.editor!.view.state.selection.head).toBe(head)
      await press(plus(), 1)
      expect(list()).not.toBeNull()
      host({ type: 'blocksInCapsule', set: 'all' })
      await tick(200)
      expect(list()).toBeNull()
      expect(capsule().dataset.view).toBe('narrow')
      room = 1280
      host({ type: 'blocksInCapsule', set: 'frequent' })
      host({ type: 'blocksInCapsule', set: 'all' })
      await resize(1280)
      expect(icons()).toHaveLength(11)
      expect(page!.mirror!.text).toBe(text)
    })
  })

  describe('in a table cell', () => {
    const BEFORE = '|===\n|Ячейка\n|===\n'
    const HEADS = ['heading2', 'heading3', 'heading4', 'heading5', 'heading6']
    const LISTS = ['unordered', 'ordered', 'checklist']
    /** The selection from the end of `from` to the end of `to` (the cursor when `to` is not given), in the text of cells. */
    const inCell = async (doc = BEFORE, from = 'Ячейка', to?: string): Promise<void> => {
      open(doc)
      const view = page!.editor!.view
      const end = (word: string): number => {
        let at = -1
        view.state.doc.descendants((node, pos) => {
          if (at < 0 && node.type.name === 'cell_text' && node.textContent.includes(word)) at = pos + 1 + node.textContent.indexOf(word) + word.length
          return at < 0
        })
        if (at < 0) throw new Error(`no «${word}» in a cell`)
        return at
      }
      const a = end(from)
      view.focus()
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, a, to === undefined ? a : end(to))))
      await tick(300)
    }
    const CASES: Array<[string, string, string, string?]> = [
      ['a plain cell', BEFORE, 'Ячейка'],
      ['a cell a|', '|===\na|Ячейка\n|===\n', 'Ячейка'],
      ['a cell with marks (rich)', '|===\n|*жирный* текст\n|===\n', 'текст'],
      ['several cells selected', '|===\n|один |два\n|===\n', 'один', 'два'],
      ['a cell l| shown as text', '|===\nl|*x*\n|===\n', '*x*'],
    ]

    it.each(CASES)('%s — H2–H6 are off with the reason, a press and a keyboard click change nothing', async (_n, doc, from, to) => {
      await inCell(doc, from, to)
      expect(capsule().dataset.view).toBe('wide')
      const before = page!.mirror!.text
      const sel = page!.editor!.view.state.selection
      const count = page!.editor!.view.state.doc.childCount
      for (const id of HEADS) {
        expect(icon(id).getAttribute('aria-disabled')).toBe('true')
        await press(icon(id), 1)
        await press(icon(id), 0) // Enter and space on a button are a click with `detail` 0
      }
      expect(page!.mirror!.text).toBe(before)
      expect(page!.editor!.view.state.doc.childCount).toBe(count)
      expect(page!.editor!.view.state.selection.from).toBe(sel.from)
      expect(page!.editor!.view.state.selection.to).toBe(sel.to)
      expect(page!.editor!.view.state.selection.$from.parent.type.name).toBe('cell_text')
      const t = await hoverTip(icon('heading2'))
      expect(t.querySelector('.nota-tip-name')!.textContent).toBe('Заголовок 2')
      expect(t.querySelector('.nota-tip-off')!.textContent).toBe('Сейчас недоступно: в ячейке таблицы заголовок не поставить.')
      expect(icon('code').getAttribute('aria-disabled')).toBe('false')
    })

    it('a cell l|*x*: it is shown as text (the marks are pale, plate and cellAsText are on); the style has its cell reason, not «Текст»; a plain cell takes marks', async () => {
      // (`cellAsText` of the editor state is `cell && !rich`; `plate` is on with it: the tip of the lists names «показана как текст»)
      const parent = (): { type: { name: string }; attrs: { rich: boolean } } => page!.editor!.view.state.selection.$from.parent as never
      await inCell('|===\nl|*x*\n|===\n', '*x*')
      expect(parent().type.name).toBe('cell_text')
      expect(parent().attrs.rich).toBe(false)
      const style = capsule().querySelector<HTMLButtonElement>('[data-cmd="style"]')!
      const t = await hoverTip(style)
      expect(t.querySelector('.nota-tip-off')!.textContent).toBe('Сейчас недоступно: в ячейке таблицы стиль абзаца не меняется.')
      expect(t.textContent).not.toContain('режиме «Текст»')
      const ul = capsule().querySelector<HTMLButtonElement>('[data-cmd="ul"]')!
      const l = await hoverTip(ul)
      expect(l.querySelector('.nota-tip-off')!.textContent).toContain('ячейка показана как текст')
      page!.destroy()
      document.body.textContent = ''
      await inCell('|===\n|*жирный* текст\n|===\n', 'текст')
      expect(parent().type.name).toBe('cell_text')
      expect(parent().attrs.rich).toBe(true)
      const l2 = await hoverTip(capsule().querySelector<HTMLButtonElement>('[data-cmd="ul"]')!)
      expect(l2.querySelector('.nota-tip-off')!.textContent).not.toContain('показана как текст')
    })

    it.each(['table', 'mermaid', 'admonition', 'collapsible'])('the icon «%s» in a cell puts the block after the table, the table stays', async (id) => {
      await inCell()
      await press(icon(id), 1)
      expect(page!.mirror!.text.startsWith(BEFORE)).toBe(true)
      expect(page!.editor!.view.state.doc.childCount).toBeGreaterThan(1)
      expect(page!.editor!.view.state.doc.child(0).type.name).toBe('table')
    })

    it.each(['table', 'mermaid', 'admonition', 'collapsible'])('the entry «%s» of «+» in a cell puts the block after the table', async (id) => {
      await inCell()
      room = 500
      for (const cb of observers) cb([], {} as ResizeObserver)
      await tick(50)
      await press(plus())
      await press(list()!.querySelector(`[data-block="${id}"]`)!, 1)
      expect(page!.mirror!.text.startsWith(BEFORE)).toBe(true)
      expect(page!.editor!.view.state.doc.childCount).toBeGreaterThan(1)
      expect(page!.editor!.view.state.doc.child(0).type.name).toBe('table')
    })

    it('«Картинка» in a cell asks for the file, the text is the same', async () => {
      await inCell()
      await press(icon('image'), 1)
      const asked = sent.find((m) => m.type === 'listFiles') as Extract<ToHost, { type: 'listFiles' }>
      expect(asked.kind).toBe('image')
      expect(page!.mirror!.text).toBe(BEFORE)
    })

    it('«/» in an empty cell does not open the menu and stays a character', async () => {
      open('|===\n|\n|===\n')
      const view = page!.editor!.view
      let at = -1
      view.state.doc.descendants((node, pos) => {
        if (at < 0 && node.type.name === 'cell_text') at = pos + 1
        return at < 0
      })
      expect(at).toBeGreaterThan(0)
      view.focus()
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, at)))
      await tick(300)
      view.dispatch(view.state.tr.insertText('/', at))
      await tick(300)
      expect(document.querySelector('[role=listbox]')).toBeNull()
      expect(view.state.doc.textContent).toBe('/')
      expect(page!.mirror!.text).toContain('/')
    })

    it.each(CASES)('%s — «Стиль абзаца» is off with its reason and does not open, the buttons of lists are off', async (_n, doc, from, to) => {
      await inCell(doc, from, to)
      const style = capsule().querySelector<HTMLButtonElement>('[data-cmd="style"]')!
      expect(style.getAttribute('aria-disabled')).toBe('true')
      const t = await hoverTip(style)
      expect(t.querySelector('.nota-tip-off')!.textContent).toBe('Сейчас недоступно: в ячейке таблицы стиль абзаца не меняется.')
      await press(style, 1)
      expect(style.getAttribute('aria-expanded')).not.toBe('true')
      expect(document.querySelector('[role=menu], [role=listbox]')).toBeNull()
      const before = page!.mirror!.text
      for (const cmd of ['ul', 'ol', 'check']) {
        const b = capsule().querySelector<HTMLButtonElement>(`[data-cmd="${cmd}"]`)!
        expect(b.getAttribute('aria-disabled')).toBe('true')
        await press(b, 1)
        await press(b, 0)
      }
      expect(page!.mirror!.text).toBe(before)
    })

    it('in the list of «+» the headings and the lists are off, the rest go after the table', async () => {
      await inCell()
      // the narrow tab
      room = 500
      for (const cb of observers) cb([], {} as ResizeObserver)
      await tick(50)
      expect(capsule().dataset.view).toBe('narrow')
      await press(plus())
      const entry = (id: string): HTMLButtonElement => list()!.querySelector<HTMLButtonElement>(`button[data-block="${id}"]`)!
      // the arrows go over the off entries, and Enter (a click with `detail` 0) on one does nothing
      const menu = list()!
      expect(focusedBlock()).toBe('heading2')
      await key(menu, 'ArrowDown')
      expect(focusedBlock()).toBe('heading3')
      await press(document.activeElement!, 0)
      expect(list()).not.toBeNull()
      expect(page!.mirror!.text).toBe(BEFORE)
      for (const id of [...HEADS, ...LISTS]) {
        expect(entry(id).getAttribute('aria-disabled')).toBe('true')
        await press(entry(id), 1)
      }
      expect(list()).not.toBeNull()
      expect(page!.mirror!.text).toBe(BEFORE)
      expect(entry('heading2').querySelector('.sm-hint')!.textContent).toBe('Сейчас недоступно: в ячейке таблицы заголовок не поставить.')
      expect(entry('ordered').querySelector('.sm-hint')!.textContent).toBe('Сейчас недоступно: в ячейке таблицы список не поставить.')
      expect(entry('code').getAttribute('aria-disabled')).toBeNull()
      await press(entry('code'), 1)
      const text = page!.mirror!.text
      expect(text.slice(0, text.lastIndexOf('|===') + 4)).toBe(BEFORE.trimEnd())
      expect(text).toContain('----')
    })

    it('outside a table the headings are on, H2 puts a draft and «== Т» is written after the first letter; «Стиль абзаца» is on and opens', async () => {
      open('a\n\nb\n')
      await cursorAfter('a')
      for (const id of HEADS) expect(icon(id).getAttribute('aria-disabled')).toBe('false')
      const style = capsule().querySelector<HTMLButtonElement>('[data-cmd="style"]')!
      expect(style.getAttribute('aria-disabled')).not.toBe('true')
      await press(style, 1)
      expect(style.getAttribute('aria-expanded')).toBe('true')
      await key(document.activeElement ?? style, 'Escape')
      await cursorAfter('a')
      await press(icon('heading2'), 1)
      expect(page!.mirror!.text).toBe('a\n\nb\n')
      const view = page!.editor!.view
      view.dispatch(view.state.tr.insertText('Т'))
      expect(page!.mirror!.text).toContain('== Т')
    })

    it('outside a table all the entries of «+» are on', async () => {
      open('a\n\nb\n')
      await cursorAfter('a')
      room = 500
      for (const cb of observers) cb([], {} as ResizeObserver)
      await tick(50)
      await press(plus())
      const entries = [...list()!.querySelectorAll<HTMLElement>('[data-block]')]
      expect(entries).toHaveLength(14)
      expect(entries.some((e) => e.getAttribute('aria-disabled') === 'true')).toBe(false)
    })
  })
})
