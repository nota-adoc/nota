// the popups of the buttons of the capsule of tools, on fake timers.
import { TextSelection } from 'prosemirror-state'
import { flushSync } from 'react-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type Page, startPage } from '../../src/webview/main.js'
import type { Locale, ToHost, ToTab } from '../../src/protocol.js'

let root: HTMLElement
let page: Page | undefined

const api = { postMessage: (_m: ToHost) => {} }
const host = (message: ToTab): void => void window.dispatchEvent(new MessageEvent('message', { data: message }))
const tick = async (ms = 50): Promise<void> => void (await vi.advanceTimersByTimeAsync(ms))
const DOC = '= Документ\n\nПервое слово тут. Второе слово там.\n\n|===\n|Ячейка\n|===\n'
const LATIN = /[A-Za-z]/

function open(text = DOC, locale: Locale = 'ru'): void {
  root = document.createElement('div')
  root.id = 'app'
  document.body.append(root)
  page = startPage(api, root, { mac: false })
  host({ type: 'init', text, version: 1, fileName: 'a.adoc', locale, outlineView: 'capsule', fileDir: '/work/docs', mode: 'visual' })
  page.flush()
}

async function place(word: string): Promise<void> {
  const view = page!.editor!.view
  let found = -1
  view.state.doc.descendants((node, pos) => {
    if (found >= 0 || !node.isText) return
    const i = node.text!.indexOf(word)
    if (i >= 0) found = pos + i
  })
  view.focus()
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, found + word.length)))
  await tick()
}
async function select(word: string): Promise<void> {
  const view = page!.editor!.view
  let found = -1
  view.state.doc.descendants((node, pos) => {
    if (found >= 0 || !node.isText) return
    const i = node.text!.indexOf(word)
    if (i >= 0) found = pos + i
  })
  view.focus()
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, found, found + word.length)))
  await tick()
}

/** The panel over a selection shows itself after a moment (the marks, the colours and the link are on it alone). */
async function pick(word: string): Promise<void> {
  await select(word)
  await tick(300)
  await tick(300)
}

const button = (name: string): HTMLButtonElement => root.querySelector<HTMLButtonElement>(`[aria-label="${name}"], [aria-label^="${name}: "]`)!
const tips = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('[role=tooltip]')]
const tip = (): HTMLElement => {
  expect(tips()).toHaveLength(1)
  return tips()[0]!
}
/** React sees the mouse by `mouseover`/`mouseout`. */
const over = (el: Element): void => flushSync(() => void el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: null })))
const out = (el: Element, to: Element | null = null): void => flushSync(() => void el.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: to })))
const key = (el: Element, k: string): void => void el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }))
const press = (el: Element): void => {
  el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
}

beforeEach(() => {
  vi.useFakeTimers()
  page = undefined
  document.body.className = ''
  document.elementFromPoint = () => null
})
afterEach(() => {
  page?.destroy()
  document.body.textContent = ''
  vi.useRealTimers()
})

describe('the popups of the capsule', () => {
  it('nothing for 0.3 s, then under the button the name, the line and the keys; no title, aria-label stays', async () => {
    open()
    await pick('Первое')
    const s = button('Зачёркнутый')
    expect(s.hasAttribute('title')).toBe(false)
    over(s)
    await tick(300)
    expect(tips()).toHaveLength(0)
    await tick(150)
    const t = tip()
    expect(t.querySelector('.nota-tip-name')!.textContent).toBe('Зачёркнутый')
    expect(t.querySelector('.nota-tip-desc')!.textContent).toContain('Зачёркивает выделенный текст')
    expect([...t.querySelectorAll('kbd')].map((k) => k.textContent)).toEqual(['Ctrl+Shift+X'])
    expect(s.getAttribute('aria-describedby')).toBe(t.id)
    expect(s.getAttribute('aria-label')).toBe('Зачёркнутый')
    // the popup is in the document, not in the capsule: it does not shift the buttons
    expect(root.querySelector('[role=tooltip]')).toBeNull()
    out(s)
    await tick(100)
    expect(tips()).toHaveLength(0)
    expect(s.hasAttribute('aria-describedby')).toBe(false)
  })

  it('the next button at once, one popup at a time; after 0.5 s the delay is back', async () => {
    open()
    await pick('Первое')
    const s = button('Зачёркнутый')
    const h = button('Выделение')
    over(s)
    await tick(450)
    expect(tip().querySelector('.nota-tip-name')!.textContent).toBe('Зачёркнутый')
    out(s, h)
    over(h)
    await tick(10)
    expect(tip().querySelector('.nota-tip-name')!.textContent).toBe('Выделение')
    out(h)
    await tick(100)
    expect(tips()).toHaveLength(0)
    // back within 0.5 s: at once
    over(s)
    await tick(10)
    expect(tip().querySelector('.nota-tip-name')!.textContent).toBe('Зачёркнутый')
    out(s)
    await tick(700)
    over(s)
    await tick(300)
    expect(tips()).toHaveLength(0)
    await tick(150)
    expect(tips()).toHaveLength(1)
  })

  it('the focus from the keyboard shows it, Esc hides it and keeps the focus and the text', async () => {
    open()
    await place('Первое')
    const text = page!.mirror!.text
    const b = button('Маркированный список')
    b.focus()
    await tick(450)
    expect(tip().querySelector('.nota-tip-name')!.textContent).toBe('Маркированный список')
    expect(tip().getAttribute('role')).toBe('tooltip')
    expect(b.getAttribute('aria-describedby')).toBe(tip().id)
    key(b, 'Escape')
    await tick(10)
    expect(tips()).toHaveLength(0)
    expect(document.activeElement).toBe(b)
    expect(page!.mirror!.text).toBe(text)
    b.blur()
    b.focus()
    await tick(450)
    expect(tips()).toHaveLength(1)
  })

  it('the focus that a mouse click brings shows no popup', async () => {
    open()
    await pick('Первое')
    const b = button('Жирный')
    b.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    b.focus()
    await tick(1000)
    expect(tips()).toHaveLength(0)
  })

  it('«Текст ⌄» outside a plate but in a block with no styles says why it is dimmed', async () => {
    open('* пункт списка\n')
    await place('пункт')
    const s = button('Стиль абзаца')
    expect(s.getAttribute('aria-disabled')).toBe('true')
    over(s)
    await tick(450)
    expect(tip().querySelector('.nota-tip-off')!.textContent).toBe('Сейчас недоступно: стиль абзаца в этом блоке не меняется.')
  })

  it('on a plate (and with no selection) there is no panel and no button of colour or mark anywhere', async () => {
    open()
    await place('Первое')
    await place('Документ')
    await tick(600)
    expect(root.querySelector('.bubble')).toBeNull()
    expect(root.querySelector('[data-cmd=color], [data-cmd=strong]')).toBeNull()
  })

  it('a press hides it until the mouse leaves and comes back', async () => {
    open()
    await pick('Первое')
    const b = button('Жирный')
    over(b)
    await tick(450)
    expect(tips()).toHaveLength(1)
    press(b)
    await tick(10)
    expect(tips()).toHaveLength(0)
    await tick(1000)
    expect(tips()).toHaveLength(0)
    out(b)
    await tick(10)
    over(b)
    await tick(450)
    expect(tips()).toHaveLength(1)
  })

  it('while a window hangs from the capsule no button has a popup', async () => {
    open()
    await pick('Первое')
    const c = button('Цвет текста')
    over(c)
    await tick(450)
    expect(tips()).toHaveLength(1)
    press(c)
    await tick(50)
    expect(root.querySelector('.cr')).not.toBeNull()
    expect(tips()).toHaveLength(0)
    // (the buttons of the capsule are in the place of the row of colours: no button is there to hover)
    out(c, null)
    await tick(1000)
    expect(tips()).toHaveLength(0)
    // the list of styles too
    key(document.body, 'Escape')
    await tick(300)
    const s = button('Стиль абзаца')
    press(s)
    await tick(50)
    expect(root.querySelector('[role=listbox]:not([aria-hidden])')).not.toBeNull()
    over(button('Чек-лист'))
    await tick(1000)
    expect(tips()).toHaveLength(0)
  })

  it('the colour button of the panel names the colour now on; the lists of the capsule have their own', async () => {
    open()
    await pick('Первое')
    over(button('Цвет текста'))
    await tick(450)
    expect(tip().querySelector('.nota-tip-name')!.textContent).toBe('Цвет текста')
    out(button('Цвет текста'))
    await tick(100)
    page!.editor!.commands.setTextColor('hl-red')
    await tick(50)
    over(button('Цвет текста'))
    await tick(10)
    expect(tip().querySelector('.nota-tip-name')!.textContent).toBe('Цвет текста: Красный')
    out(button('Цвет текста'))
    await tick(100)
    over(button('Чек-лист'))
    await tick(450)
    expect(tip().querySelector('.nota-tip-name')!.textContent).toBe('Чек-лист')
  })

  it('the buttons of the row «Таблица» and the mark of the level have popups, which go with the row', async () => {
    open('= Д\n\n|===\n|Внешняя\n\n|===\n')
    await place('Внешняя')
    const merge = root.querySelector<HTMLElement>('[data-cmd=merge]')!
    expect(merge.hasAttribute('title')).toBe(false)
    over(merge)
    await tick(450)
    const t = tip()
    expect(t.querySelector('.nota-tip-name')!.textContent).toBe('Объединить ячейки')
    expect(t.querySelector('.nota-tip-desc')!.textContent).toBe('Сливает выделенные ячейки в одну.')
    expect([...t.querySelectorAll('kbd')].map((k) => k.textContent)).toEqual(['Shift'])
    // the cursor leaves the table: the row folds, the popup goes with it
    await place('Д')
    await tick(300)
    expect(tips()).toHaveLength(0)
  })

  it('in «Текст» there is no popup; on a plate the dimmed button says why', async () => {
    open()
    await place('Первое')
    await place('Документ')
    const b = button('Маркированный список')
    expect(b.getAttribute('aria-disabled')).toBe('true')
    over(b)
    await tick(450)
    const t = tip()
    expect(t.classList.contains('is-off')).toBe(true)
    expect(t.querySelector('.nota-tip-off')!.textContent).toBe('Сейчас недоступно: курсор в плашке. Её правят в режиме «Текст».')
    expect(t.querySelector('kbd')).toBeNull()
    // the style button is dimmed with `aria-disabled`, not `disabled`: it has a popup as well
    const s = button('Стиль абзаца')
    expect(s.disabled).toBe(false)
    expect(s.getAttribute('aria-disabled')).toBe('true')
    out(b, s)
    over(s)
    await tick(10)
    expect(tip().querySelector('.nota-tip-name')!.textContent).toBe('Стиль абзаца')
    out(s)
    await tick(100)
    page!.toggleMode()
    await tick()
    // no button of the capsule has a system `title`, not «Текст ⌄» either
    const capsuleButtons = [...root.querySelectorAll<HTMLElement>('.isle-tools button')]
    expect(capsuleButtons.length).toBeGreaterThan(3)
    expect(capsuleButtons.filter((el) => el.hasAttribute('title'))).toEqual([])
    expect(button('Маркированный список').disabled).toBe(true)
    over(button('Маркированный список'))
    await tick(1000)
    expect(tips()).toHaveLength(0)
  })

  it('the popup hangs under the capsule, in the middle of its button, 8 px from the edges of the tab', async () => {
    open()
    await place('Первое')
    const capsule = root.querySelector<HTMLElement>('.isle-tools')!
    const rect = (left: number, width: number, bottom: number): DOMRect => ({ left, width, right: left + width, top: 0, bottom, height: bottom, x: left, y: 0, toJSON: () => ({}) }) as DOMRect
    capsule.getBoundingClientRect = () => rect(0, 400, 40)
    const b = button('Маркированный список')
    b.getBoundingClientRect = () => rect(-30, 30, 36)
    over(b)
    await tick(450)
    let t = tip()
    expect(t.style.left).toBe('8px')
    expect(t.style.top).toBe('46px')
    out(b)
    await tick(100)
    b.getBoundingClientRect = () => rect(1000, 30, 36)
    over(b)
    await tick(450)
    t = tip()
    // jsdom has no width of its own: the right edge keeps 8 px from the width of the window
    expect(Number.parseInt(t.style.left, 10)).toBeLessThanOrEqual(window.innerWidth - 8)
    out(b)
    await tick(100)
    // with a width of its own the whole popup stays 8 px from the right edge
    const width = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(200)
    over(b)
    await tick(450)
    t = tip()
    width.mockRestore()
    expect(Number.parseInt(t.style.left, 10) + 200).toBe(window.innerWidth - 8)
  })

  it('on a Mac: the keys are ⌘⇧X and ⌘⌥2', async () => {
    const platform = vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel')
    open()
    await pick('Первое')
    over(button('Зачёркнутый'))
    await tick(450)
    expect([...tip().querySelectorAll('kbd')].map((k) => k.textContent)).toEqual(['⌘⇧X'])
    out(button('Зачёркнутый'))
    await tick(100)
    over(button('Стиль абзаца'))
    await tick(450)
    expect([...tip().querySelectorAll('kbd')].map((k) => k.textContent)).toContain('⌘⌥2')
    platform.mockRestore()
  })

  it('a window closed from the keyboard gives the focus back, and no popup comes again', async () => {
    open()
    await pick('Первое')
    const c = button('Цвет текста')
    c.focus()
    key(c, 'Enter')
    c.click()
    await tick(50)
    expect(root.ownerDocument.querySelector('.cr')).not.toBeNull()
    key(root.ownerDocument.activeElement ?? c, 'Escape')
    await tick(50)
    // the row is gone, the focus is on the button it was opened from (a new element: the row of buttons came back)
    expect(root.ownerDocument.querySelector('.cr:not(.is-leaving)')).toBeNull()
    expect(root.ownerDocument.activeElement).toBe(root.querySelector('.bubble [data-cmd="color"]'))
    await tick(450)
    expect(tips()).toHaveLength(0)
  })

  it('the popups are in the language of the tab', async () => {
    open(DOC, 'en')
    await pick('Первое')
    const names: string[] = []
    for (const label of ['Bold', 'Link', 'Bulleted list', 'Insert block', 'Paragraph style']) {
      const b = button(label)
      over(b)
      await tick(450)
      names.push(tip().textContent!)
      out(b)
      await tick(100)
    }
    expect(names.join(' ')).not.toMatch(/[А-Яа-яЁё]/)
    page!.destroy()
    document.body.textContent = ''
    open(DOC, 'ru')
    await pick('Первое')
    const ru: string[] = []
    for (const label of ['Жирный', 'Ссылка', 'Маркированный список', 'Вставить блок', 'Стиль абзаца']) {
      const b = button(label)
      over(b)
      await tick(450)
      const t = tip().cloneNode(true) as HTMLElement
      t.querySelectorAll('kbd').forEach((k) => k.remove())
      ru.push(t.textContent!)
      out(b)
      await tick(100)
    }
    // the words that stay in Latin: the names of things
    expect(ru.join(' ').replaceAll('Mermaid', '').replaceAll('AsciiDoc', '')).not.toMatch(LATIN)
  })
})
