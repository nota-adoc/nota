// the toolbar, the panel over the selection, the windows of colour and link, Cmd+click, the language of the tab.
import { TextSelection } from 'prosemirror-state'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type Page, startPage } from '../../src/webview/main.js'
import type { Locale, ToHost, ToTab } from '../../src/protocol.js'

let sent: ToHost[]
let root: HTMLElement
let page: Page | undefined

const api = { postMessage: (m: ToHost) => void sent.push(m) }
const host = (message: ToTab): void => void window.dispatchEvent(new MessageEvent('message', { data: message }))
const CYRILLIC = /[А-Яа-яЁё]/
const tick = async (ms = 50): Promise<void> => void (await vi.advanceTimersByTimeAsync(ms))

function open(text: string, extra: { locale?: Locale; lang?: string; mac?: boolean } = {}): Page {
  root = document.createElement('div')
  root.id = 'app'
  document.body.append(root)
  if (extra.lang) document.documentElement.lang = extra.lang
  page = startPage(api, root, { mac: extra.mac ?? false })
  host({ type: 'init', text, version: 1, fileName: 'a.adoc', locale: extra.locale ?? 'ru', outlineView: 'capsule', fileDir: '/work/docs', mode: 'visual' })
  page.flush()
  return page
}

/** Selects `word` on the screen (or puts the cursor after it). */
async function select(word: string, cursor = false): Promise<void> {
  const view = page!.editor!.view
  let found: number | null = null
  view.state.doc.descendants((node, pos) => {
    if (found !== null || !node.isText) return
    const i = node.text!.indexOf(word)
    if (i >= 0) found = pos + i
  })
  if (found === null) throw new Error(`no «${word}» on the screen`)
  const at = found as number
  view.focus()
  view.dispatch(
    view.state.tr.setSelection(
      cursor ? TextSelection.create(view.state.doc, at + word.length) : TextSelection.create(view.state.doc, at, at + word.length),
    ),
  )
  await tick()
}

/** The visible name on the style button (the other labels are hidden to keep the width). */
const visible = (b: Element): string => [...b.querySelectorAll('.tl-style-name > span:not([aria-hidden])')].map((l) => l.textContent).join('')
const button = (name: string): HTMLButtonElement =>
  root.querySelector<HTMLButtonElement>(`[aria-label="${name}"], [aria-label^="${name}: "]`)!
/** The panel over a selection shows itself after a moment. */
const ready = async (): Promise<void> => {
  await tick(300)
  await tick(300)
}
const click = async (el: Element): Promise<void> => {
  el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  await tick()
}

beforeEach(() => {
  vi.useFakeTimers()
  sent = []
  page = undefined
  document.body.className = ''
  document.documentElement.lang = ''
  // jsdom has no layout: a press in the text asks where it is
  document.elementFromPoint = () => null
})
afterEach(() => {
  page?.destroy()
  document.body.textContent = ''
  vi.useRealTimers()
})

const DOC = '= Документ\n\nПервое слово тут. Второе слово там.\n\n== Первый\n\nТекст первого раздела.\n\n== Второй\n\nКонец <<первый-вторая>> документа.\n'

describe('the toolbar in both modes', () => {
  it('is over the document in «Визуально», shows the state under the cursor and acts on the selection', async () => {
    open(DOC)
    const bar = root.querySelector('.ed-isles [role=toolbar]')!
    expect(bar).toBeTruthy()
    expect(bar.getAttribute('aria-label')).toBe('Форматирование')
    // the buttons by order: «+», «Текст», the lists; the marks, the colours and the link are on the panel over the selection only, no «⋯»
    expect([...bar.querySelectorAll('button')].map((b) => b.dataset.cmd)).toEqual(['insert', 'style', 'ul', 'ol', 'check'])
    expect(bar.querySelectorAll('.tb-sep')).toHaveLength(1)
    // what the capsule has no more
    for (const gone of ['Отменить', 'Повторить', 'Жирный', 'Цвет текста', 'Заливка', 'Ссылка', 'Все инструменты']) {
      expect(bar.querySelector(`[aria-label="${gone}"]`)).toBeNull()
    }
    await select('Первое')
    await ready()
    // the names are in `aria-label` (no `title`, the popup says the rest)
    expect(button('Жирный').hasAttribute('title')).toBe(false)
    expect(button('Цвет текста').getAttribute('aria-label')).toBe('Цвет текста')
    expect(button('Заливка').getAttribute('aria-label')).toBe('Заливка')
    expect(button('Ссылка').getAttribute('aria-label')).toBe('Ссылка')
    expect(button('Жирный').getAttribute('aria-pressed')).toBe('false')
    await click(button('Жирный'))
    expect(page!.mirror!.text).toContain('*Первое* слово')
    // the selection is still there after the press
    expect(page!.editor!.view.state.selection.empty).toBe(false)
    expect(button('Жирный').getAttribute('aria-pressed')).toBe('true')
    await click(button('Жирный'))
    expect(page!.mirror!.text).toBe(DOC)
  })

  it('«Заголовок 3» in the list of styles writes === in «Текст»', async () => {
    open(DOC)
    await select('Первый', true)
    const style = button('Стиль абзаца')
    expect(visible(style)).toBe('Заголовок 2')
    await click(style)
    expect(style.getAttribute('aria-expanded')).toBe('true')
    const list = root.querySelector('[role=listbox]')!
    const options = [...list.querySelectorAll('[role=option]')]
    expect(options.map((b) => b.querySelector('.dd-label')!.textContent)).toEqual(['Текст', 'Заголовок 2', 'Заголовок 3', 'Заголовок 4', 'Заголовок 5', 'Заголовок 6'])
    // the keys at the items (jsdom is not a Mac: Ctrl+Alt+…)
    expect(options.map((b) => b.querySelector('.dd-keys')!.textContent)).toEqual(['Ctrl+Alt+0', 'Ctrl+Alt+2', 'Ctrl+Alt+3', 'Ctrl+Alt+4', 'Ctrl+Alt+5', 'Ctrl+Alt+6'])
    expect(options.map((b) => b.getAttribute('aria-keyshortcuts'))).toEqual(['Control+Alt+0', 'Control+Alt+2', 'Control+Alt+3', 'Control+Alt+4', 'Control+Alt+5', 'Control+Alt+6'])
    expect(list.querySelector('[aria-selected=true] .dd-label')!.textContent).toBe('Заголовок 2')
    await click(list.querySelector('[data-value=h3]')!)
    expect(page!.mirror!.text).toContain('\n=== Первый\n')
    expect(style.getAttribute('aria-expanded')).toBe('false')
    expect(visible(button('Стиль абзаца'))).toBe('Заголовок 3')
  })

  it('«Заголовок 5» in the list of styles writes =====', async () => {
    open(DOC)
    await select('Первый', true)
    await click(button('Стиль абзаца'))
    await click(root.querySelector('[role=listbox] [data-value=h5]')!)
    expect(page!.mirror!.text).toContain('\n===== Первый\n')
    expect(visible(button('Стиль абзаца'))).toBe('Заголовок 5')
  })

  it('names the style under the cursor and is off where the style cannot change', async () => {
    open(DOC + '\n|===\n|Ячейка\n|===\n')
    await select('Первое', true)
    expect(visible(button('Стиль абзаца'))).toBe('Текст')
    await select('Ячейка', true)
    expect(button('Стиль абзаца').disabled).toBe(false)
    expect(button('Стиль абзаца').getAttribute('aria-disabled')).toBe('true')
  })

  it('«+» opens «Вставить блок» with the fourteen blocks of «/»; a pick inserts the table in one step; the second press closes', async () => {
    open(DOC)
    await select('Первое', true)
    const plus = button('Вставить блок')
    await click(plus)
    const card = root.querySelector('.blocklist')!
    expect(plus.getAttribute('aria-expanded')).toBe('true')
    expect(card.getAttribute('role')).toBe('menu')
    expect(card.getAttribute('aria-label')).toBe('Вставить блок')
    expect([...card.querySelectorAll('[role=menuitem]')].map((b) => b.getAttribute('aria-label'))).toEqual([
      'Заголовок 2', 'Заголовок 3', 'Заголовок 4', 'Заголовок 5', 'Заголовок 6', 'Маркированный список', 'Нумерованный список', 'Чек-лист', 'Таблица', 'Код', 'Mermaid', 'Предупреждение', 'Раскрывающийся блок', 'Картинка',
    ])
    expect([...card.querySelectorAll('[role=menuitem]')].map((b) => (b as HTMLElement).dataset.block)).toEqual([
      'heading2', 'heading3', 'heading4', 'heading5', 'heading6', 'unordered', 'ordered', 'checklist', 'table', 'code', 'mermaid', 'admonition', 'collapsible', 'image',
    ])
    expect(card.querySelector('[data-block=table] .sm-hint')!.textContent).toBe('Ряды и колонки')
    expect(card.querySelector('[data-block=table]')!.getAttribute('aria-describedby')).toBe(card.querySelector('[data-block=table] .sm-hint')!.id)
    expect(card.querySelector('.bl-foot')!.textContent).toBe('Быстрее — «/» в пустой строке')
    await click(plus)
    expect(root.querySelector('.leave:not(.is-leaving) .blocklist')).toBeNull()
    expect(page!.mirror!.text).toBe(DOC)
    await click(plus)
    await click(root.querySelector('[data-block=table]')!)
    expect(root.querySelector('.leave:not(.is-leaving) .blocklist')).toBeNull()
    expect(page!.mirror!.text).toContain('|===')
    expect(page!.mirror!.text.match(/^\|===$/gm)).toHaveLength(2)
  })

  it('«+» in the closing moment does not hold the page: the second Esc and a press go on', async () => {
    open(DOC)
    await select('Первое', true)
    await click(button('Вставить блок'))
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await tick(10)
    expect(root.querySelector('.leave.is-leaving .blocklist')).not.toBeNull()
    const second = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    document.dispatchEvent(second)
    expect(second.defaultPrevented).toBe(false)
  })

  it('«+» closes with Esc and with a press elsewhere, the file does not change', async () => {
    open(DOC)
    await select('Первое', true)
    await click(button('Вставить блок'))
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await tick()
    expect(root.querySelector('.leave:not(.is-leaving) .blocklist')).toBeNull()
    await click(button('Вставить блок'))
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    await tick()
    expect(root.querySelector('.leave:not(.is-leaving) .blocklist')).toBeNull()
    expect(page!.mirror!.text).toBe(DOC)
  })

  it('has the tips of the design', async () => {
    open(DOC)
    // the capsule has no `title`; «Разделы» is another capsule and keeps its own
    for (const name of ['Вставить блок', 'Стиль абзаца', 'Маркированный список', 'Чек-лист']) {
      expect(button(name).getAttribute('aria-label')).toBe(name)
      expect(button(name).hasAttribute('title')).toBe(false)
    }
    expect(button('Разделы').getAttribute('title')).toBe('Разделы')
    // nor has the panel over the selection (the popup of the capsule, not a native hint)
    await select('Первое')
    await ready()
    for (const name of ['Жирный', 'Моноширинный', 'Зачёркнутый', 'Выделение', 'Цвет текста', 'Заливка', 'Ссылка']) {
      expect(button(name).getAttribute('aria-label')).toBe(name)
      expect(button(name).hasAttribute('title')).toBe(false)
    }
  })

  it('no duplicate: the marks, the colours and the link are once on the screen, on the panel; no «⋯», in a narrow tab too', async () => {
    open(DOC)
    const bar = root.querySelector<HTMLElement>('.ed-isles [role=toolbar]')!
    for (const cmd of ['strong', 'em', 'code', 'strike', 'highlight', 'color', 'fill', 'link', 'more']) {
      expect(root.querySelector(`[data-cmd=${cmd}]`)).toBeNull()
    }
    expect(bar.hasAttribute('data-expanded')).toBe(false)
    expect(bar.querySelector('.tl-break, .tl-more, .tl-fmt')).toBeNull()
    await select('Первое')
    await ready()
    for (const cmd of ['strong', 'em', 'code', 'strike', 'highlight', 'color', 'fill', 'link']) {
      expect(root.querySelectorAll(`[data-cmd=${cmd}]`)).toHaveLength(1)
      expect(root.querySelector(`[data-cmd=${cmd}]`)!.closest('.bubble')).not.toBeNull()
    }
  })

  it('in a table the capsule has the row «Таблица» and still no marks; the marks are once, on the panel', async () => {
    open(DOC + '\n|===\n|Ячейка\n|===\n')
    await select('Ячейка')
    await ready()
    expect(root.querySelector('.isle-tools [data-cmd=strong]')).toBeNull()
    expect(root.querySelector('.isle-tools .tl-row')).not.toBeNull()
    expect(root.querySelectorAll('[data-cmd=strong]')).toHaveLength(1)
  })

  it('is off in «Текст» with the note, and comes back in «Визуально»', async () => {
    open(DOC)
    page!.toggleMode()
    await tick()
    expect(button('Маркированный список').disabled).toBe(true)
    expect(button('Стиль абзаца').disabled).toBe(true)
    expect(button('Вставить блок').disabled).toBe(true)
    expect(root.querySelector('.tb-note')!.textContent).toBe('Режим «Текст»')
    expect(root.querySelector('.bubble')).toBeNull()
    page!.toggleMode()
    await tick()
    expect(button('Маркированный список').disabled).toBe(false)
    expect(root.querySelector('.tb-note')).toBeNull()
  })
})

describe('the panel over the selection', () => {
  it('shows over a selected word with the marks, the colours and the link; the capsule still works', async () => {
    open(DOC)
    await select('Первое')
    await ready()
    const bubble = root.querySelector('.bubble')!
    expect(bubble.getAttribute('aria-label')).toBe('Отметки выделенного текста')
    expect([...bubble.querySelectorAll('button')].map((b) => b.getAttribute('data-cmd'))).toEqual([
      'strong', 'em', 'code', 'strike', 'highlight', 'color', 'fill', 'link',
    ])
    expect(root.querySelector('.isle-tools [data-cmd=em]')).toBeNull()
    await click(root.querySelector('.bubble [data-cmd=em]')!)
    expect(page!.mirror!.text).toContain('_Первое_ слово')
    expect(page!.editor!.view.state.selection.empty).toBe(false)
  })
})

describe('the colours in place of the buttons of the panel', () => {
  const bubbleButton = (cmd: string): HTMLButtonElement => root.querySelector<HTMLButtonElement>(`.bubble [data-cmd="${cmd}"]`)!

  it('«A ⌄» on the panel: the buttons are replaced by «‹», «Цвет» and nine circles, in the same panel; the capsule is not touched', async () => {
    open(DOC)
    await select('Первое')
    await ready()
    await click(bubbleButton('color'))
    const bubble = root.querySelector('.bubble')!
    expect(bubble.querySelectorAll(':scope > button')).toHaveLength(0)
    const row = bubble.querySelector('.cr')!
    expect(row.querySelectorAll('.sw-b')).toHaveLength(9)
    expect(row.querySelector('.cr-back')!.getAttribute('aria-label')).toBe('Вернуть кнопки панели')
    expect(row.querySelector('.cr-t-def')!.textContent).toBe('Цвет')
    expect(root.querySelector('[role=dialog]')).toBeNull()
    expect(root.querySelector('.isle-tools .cr:not(.is-leaving)')).toBeNull()
    expect(root.querySelector('.isle-tools [data-cmd=color]')).toBeNull()
    await click(row.querySelector('[aria-label="Красный"]')!)
    expect(page!.mirror!.text).toContain('[.hl-red]#Первое# слово')
    // the buttons are back
    expect(root.querySelector('.bubble .cr:not(.is-leaving)')).toBeNull()
    expect(bubbleButton('color')).not.toBeNull()
  })

  it('Esc and «‹» bring the buttons back, the focus is on «A ⌄»; the file does not change', async () => {
    open(DOC)
    await select('Первое')
    await ready()
    await click(bubbleButton('fill'))
    expect(root.querySelector('.bubble .cr[aria-label="Заливка"]')).not.toBeNull()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    await tick()
    expect(root.querySelector('.bubble .cr:not(.is-leaving)')).toBeNull()
    expect(document.activeElement).toBe(bubbleButton('fill'))
    // the panel is still there (the first Esc was the row's, not the panel's)
    expect(root.querySelector('.bubble')).not.toBeNull()
    await click(bubbleButton('color'))
    await click(root.querySelector('.bubble .cr-back')!)
    expect(root.querySelector('.bubble .cr:not(.is-leaving)')).toBeNull()
    expect(document.activeElement).toBe(bubbleButton('color'))
    expect(page!.mirror!.text).toBe(DOC)
  })
})

describe('the keyboard and the popups of the panel', () => {
  const bubbleButton = (cmd: string): HTMLButtonElement => root.querySelector<HTMLButtonElement>(`.bubble [data-cmd="${cmd}"]`)!
  const key = (init: KeyboardEventInit, target: EventTarget = document): KeyboardEvent => {
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
    target.dispatchEvent(event)
    return event
  }

  it('Alt+F10 from the text with a selection puts the focus on the first button of the panel', async () => {
    open(DOC)
    await select('Первое')
    await ready()
    const event = key({ key: 'F10', altKey: true }, page!.editor!.view.dom)
    expect(event.defaultPrevented).toBe(true)
    await tick()
    expect(document.activeElement).toBe(bubbleButton('strong'))
    // the panel is still there with its word selected
    expect(root.querySelector('.bubble')).not.toBeNull()
    expect(page!.editor!.view.state.selection.empty).toBe(false)
  })

  it('the arrows, Home and End go through the buttons of the panel, one stop of Tab for all of them', async () => {
    open(DOC)
    await select('Первое')
    await ready()
    key({ key: 'F10', altKey: true }, page!.editor!.view.dom)
    await tick()
    key({ key: 'ArrowRight' }, document.activeElement!)
    await tick()
    expect(document.activeElement).toBe(bubbleButton('em'))
    key({ key: 'End' }, document.activeElement!)
    await tick()
    expect(document.activeElement).toBe(bubbleButton('link'))
    key({ key: 'ArrowRight' }, document.activeElement!)
    expect(document.activeElement).toBe(bubbleButton('link'))
    key({ key: 'Home' }, document.activeElement!)
    await tick()
    expect(document.activeElement).toBe(bubbleButton('strong'))
    key({ key: 'ArrowRight' }, document.activeElement!)
    await tick()
    const stops = [...root.querySelectorAll<HTMLButtonElement>('.bubble button')].filter((b) => b.tabIndex === 0)
    expect(stops.map((b) => b.dataset.cmd)).toEqual(['em'])
  })

  it('Enter on «I» makes the word italic and the focus stays on «I», the panel stays', async () => {
    open(DOC)
    await select('Первое')
    await ready()
    key({ key: 'F10', altKey: true }, page!.editor!.view.dom)
    await tick()
    key({ key: 'ArrowRight' }, document.activeElement!)
    await tick()
    // the browser turns Enter on a button into a click without a pointer
    bubbleButton('em').click()
    await tick()
    expect(page!.mirror!.text).toContain('_Первое_ слово')
    expect(document.activeElement).toBe(bubbleButton('em'))
    expect(bubbleButton('em').getAttribute('aria-pressed')).toBe('true')
    // a click of the mouse leaves the cursor in the text
    bubbleButton('strong').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }))
    await tick()
    expect(document.activeElement).toBe(page!.editor!.view.dom)
  })

  it('«A ⌄» by Enter: the focus goes to the current circle; Esc brings the buttons back with the focus on «A ⌄»; the next Esc: no panel, the focus in the text', async () => {
    open(DOC)
    await select('Первое')
    await ready()
    key({ key: 'F10', altKey: true }, page!.editor!.view.dom)
    await tick()
    key({ key: 'ArrowRight' }, document.activeElement!)
    key({ key: 'ArrowRight' }, document.activeElement!)
    key({ key: 'ArrowRight' }, document.activeElement!)
    key({ key: 'ArrowRight' }, document.activeElement!)
    key({ key: 'ArrowRight' }, document.activeElement!)
    await tick()
    expect(document.activeElement).toBe(bubbleButton('color'))
    bubbleButton('color').click()
    await tick()
    expect((document.activeElement as HTMLElement).closest('.cr')).not.toBeNull()
    key({ key: 'Escape' })
    await tick()
    expect(document.activeElement).toBe(bubbleButton('color'))
    key({ key: 'Escape' })
    await tick()
    expect(root.querySelector('.bubble')).toBeNull()
    expect(document.activeElement).toBe(page!.editor!.view.dom)
    expect(page!.editor!.view.state.selection.empty).toBe(false)
    expect(page!.mirror!.text).toBe(DOC)
  })

  it('after Esc the selection stays and Alt+F10 brings the panel back with the focus on it', async () => {
    open(DOC)
    await select('Первое')
    await ready()
    key({ key: 'Escape' })
    await tick()
    expect(root.querySelector('.bubble')).toBeNull()
    expect(page!.editor!.view.state.selection.empty).toBe(false)
    const event = key({ key: 'F10', altKey: true }, page!.editor!.view.dom)
    expect(event.defaultPrevented).toBe(true)
    await tick()
    await tick()
    expect(root.querySelector('.bubble')).not.toBeNull()
    expect(document.activeElement).toBe(bubbleButton('strong'))
  })

  it('Alt+F10 in the moment after the selection changed does not wait for the delay of the panel', async () => {
    open(DOC)
    await select('Первое')
    key({ key: 'F10', altKey: true }, page!.editor!.view.dom)
    await tick()
    await tick()
    expect(document.activeElement).toBe(bubbleButton('strong'))
  })

  it('the text says that Alt+F10 leads to the tools', async () => {
    open(DOC)
    await select('Первое')
    expect(page!.editor!.view.dom.getAttribute('aria-keyshortcuts')).toBe('Alt+F10')
  })

  it('Tab from the panel to another place takes the panel away; to the text or inside the panel it stays', async () => {
    open(DOC)
    await select('Первое')
    await ready()
    key({ key: 'F10', altKey: true }, page!.editor!.view.dom)
    await tick()
    bubbleButton('strong').dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: bubbleButton('em') }))
    await tick()
    expect(root.querySelector('.bubble')).not.toBeNull()
    const other = button('Вставить блок')
    other.focus()
    await tick()
    expect(root.querySelector('.bubble')).toBeNull()
  })

  it('Alt+F10 without a selection puts the focus on the first button of the capsule; with the Shift or Ctrl it does nothing', async () => {
    open(DOC)
    await select('Первое', true)
    await ready()
    expect(key({ key: 'F10', altKey: true, shiftKey: true }, page!.editor!.view.dom).defaultPrevented).toBe(false)
    expect(document.activeElement).not.toBe(button('Вставить блок'))
    expect(key({ key: 'F10', altKey: true }, page!.editor!.view.dom).defaultPrevented).toBe(true)
    await tick()
    expect(document.activeElement).toBe(button('Вставить блок'))
  })

  it('the buttons of the panel have the popup of the capsule, under the panel, with the name, the line and the keys; no title', async () => {
    open(DOC)
    await select('Первое')
    await ready()
    const strong = bubbleButton('strong')
    strong.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    strong.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }))
    await tick(500)
    const tip = document.body.querySelector('.nota-tip')!
    expect(tip).not.toBeNull()
    expect(tip.querySelector('.nota-tip-name')!.textContent).toBe('Жирный')
    expect(tip.querySelector('.nota-tip-desc')!.textContent).toMatch(/жирным/)
    expect(tip.querySelector('kbd')!.textContent).toBe('Ctrl+B')
    expect(strong.hasAttribute('title')).toBe(false)
  })
})

describe('colour and fill', () => {
  it('«Красный» writes the role, «Синий» replaces it, «Без цвета» takes it off byte for byte', async () => {
    open(DOC)
    await select('Первое')
    await ready()
    await click(button('Цвет текста'))
    const dialog = root.querySelector('.cr[aria-label="Цвет текста"]')!
    expect(dialog).toBeTruthy()
    expect(root.querySelector('[role=dialog]')).toBeNull()
    await click(dialog.querySelector('[aria-label="Красный"]')!)
    expect(page!.mirror!.text).toContain('[.hl-red]#Первое# слово')
    expect(root.querySelector('.cr:not(.is-leaving)')).toBeNull()
    await ready()
    await click(button('Цвет текста'))
    await click(root.querySelector('[aria-label="Синий"]')!)
    expect(page!.mirror!.text).toContain('[.hl-blue]#Первое#')
    expect(page!.mirror!.text).not.toContain('hl-red')
    await ready()
    await click(button('Заливка'))
    await click(root.querySelector('[aria-label="Жёлтая"]')!)
    expect(page!.mirror!.text).toMatch(/hl-yellow-bg/)
    expect(page!.mirror!.text).toMatch(/hl-blue/)
    await ready()
    await click(button('Цвет текста'))
    await click(root.querySelector('[aria-label="Без цвета"]')!)
    expect(page!.mirror!.text).toContain('[.hl-yellow-bg]#Первое#')
  })

  it('Esc closes the window without a change', async () => {
    open(DOC)
    await select('Первое')
    await ready()
    await click(button('Заливка'))
    expect(root.querySelector('.cr')).toBeTruthy()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await tick()
    expect(root.querySelector('.cr:not(.is-leaving)')).toBeNull()
    expect(page!.mirror!.text).toBe(DOC)
    // the button the row was opened from has the focus again
    expect(document.activeElement).toBe(root.querySelector('.bubble [data-cmd=fill]'))
  })

  it('without a selection there is no button of colour on the screen: the panel needs a selection, the capsule has none', async () => {
    open(DOC)
    await select('Первое', true)
    await ready()
    expect(root.querySelector('[data-cmd=fill]')).toBeNull()
    expect(root.querySelector('.bubble')).toBeNull()
    expect(page!.mirror!.text).toBe(DOC)
  })
})

describe('the field of a link', () => {
  it('puts an address on Enter; an empty one stays open with the reason', async () => {
    open(DOC)
    await select('Первое')
    await ready()
    await click(button('Ссылка'))
    const field = root.querySelector<HTMLInputElement>('[role=dialog] input')!
    expect(field).toBeTruthy()
    field.value = ''
    field.dispatchEvent(new Event('input', { bubbles: true }))
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await tick()
    expect(root.querySelector('[role=dialog] [role=alert]')).toBeTruthy()
    expect(page!.mirror!.text).toBe(DOC)
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    setter.call(field, 'https://example.org/a')
    field.dispatchEvent(new Event('input', { bubbles: true }))
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await tick()
    expect(page!.mirror!.text).toContain('https://example.org/a[Первое]')
    expect(root.querySelector('.leave:not(.is-leaving) [role=dialog]')).toBeNull()
  })

  it('a section of the document: a list with ids, Enter writes <<id,word>>', async () => {
    open(DOC)
    await select('Первое')
    await ready()
    await click(button('Ссылка'))
    await click(root.querySelector('[role=radio][data-tab=section]')!)
    const options = [...root.querySelectorAll('[role=option]')]
    expect(options.map((o) => o.getAttribute('data-id'))).toEqual(['_первый', '_второй'])
    const box = root.querySelector('[role=listbox]')!
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    await tick()
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await tick()
    expect(page!.mirror!.text).toContain('<<_второй,Первое>>')
  })

  it('another file: asks the host, shows the answer, Enter writes xref: with the relative path', async () => {
    open(DOC)
    await select('Первое')
    await ready()
    await click(button('Ссылка'))
    await click(root.querySelector('[role=radio][data-tab=file]')!)
    const asked = sent.find((m) => m.type === 'listFiles') as Extract<ToHost, { type: 'listFiles' }>
    expect(asked).toBeTruthy()
    host({ type: 'files', id: asked.id, items: ['../x/y.adoc', 'z.adoc'], more: 3 })
    await tick(100)
    await tick(300)
    expect([...root.querySelectorAll('[role=option]')].map((o) => o.textContent)).toEqual(['../x/y.adoc', 'z.adoc'])
    expect(root.querySelector('.lk-more')!.textContent).toBe('Ещё 3 — уточните поиск')
    const search = root.querySelector('[role=dialog] input')!
    search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await tick()
    expect(page!.mirror!.text).toContain('xref:../x/y.adoc[Первое]')
  })

  it('on a link: opens with its target and «Убрать ссылку» leaves the text', async () => {
    open('Смотри https://example.org/a[сайт] там.\n')
    // the cursor inside a link has no panel: the text of the link is selected, and the panel shows its address
    await select('сайт')
    await ready()
    await click(button('Ссылка'))
    expect(root.querySelector<HTMLInputElement>('[role=dialog] input')!.value).toBe('https://example.org/a')
    const remove = [...root.querySelectorAll('[role=dialog] button')].find((b) => b.textContent === 'Убрать ссылку')!
    await click(remove)
    expect(page!.mirror!.text).toBe('Смотри сайт там.\n')
  })
})

describe('Cmd+click on a link', () => {
  const ctrlClick = (el: Element, init: MouseEventInit = { ctrlKey: true }): void => {
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, ...init }))
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...init }))
  }
  const SRC = 'Адрес https://example.org/a[сайт], почта mailto:a@b.c[почта], файл xref:../x/y.adoc[файл].\n\n== Первый\n\nТекст.\n\n== Второй\n\nСм. <<_первый,раздел>>.\n'
  const link = (text: string): Element => [...root.querySelectorAll('a')].find((a) => a.textContent === text)!

  it('sends the target to the host and does not move the cursor; a plain click only puts the cursor', () => {
    open(SRC)
    for (const [text, href] of [['сайт', 'https://example.org/a'], ['почта', 'mailto:a@b.c'], ['файл', '../x/y.adoc']] as const) {
      sent = []
      const before = page!.editor!.view.state.selection.from
      ctrlClick(link(text))
      expect(sent.filter((m) => m.type === 'openLink')).toEqual([{ type: 'openLink', href }])
      expect(page!.editor!.view.state.selection.from).toBe(before)
    }
    sent = []
    ctrlClick(link('сайт'), {})
    expect(sent.filter((m) => m.type === 'openLink')).toEqual([])
  })

  it('an xref with %5F sends the target as written', () => {
    const target = 'a/Guide_2.0_-%5FProduct/Items%5FData%5F(X).adoc'
    open(`См. xref:${target}[T].\n`)
    ctrlClick(link('T'))
    expect(sent.filter((m) => m.type === 'openLink')).toEqual([{ type: 'openLink', href: target }])
  })

  it('a link to a section scrolls the document to it and puts the cursor at its start', () => {
    open(SRC)
    ctrlClick(link('раздел'))
    expect(sent.filter((m) => m.type === 'openLink')).toEqual([])
    const sel = page!.editor!.selectionOffsets()!
    expect(page!.mirror!.text.slice(sel.head)).toMatch(/^Первый\n/)
  })

  it('<<id>> and xref:#id[…] to a long id hidden over a heading scroll to the heading', () => {
    const id = `пример-${'модули-'.repeat(130)}конец`
    const src = `Вступление <<${id}>> и xref:#${id}[раздел].\n\n[#${id}]\n=== 4. Заголовок\n\nТекст.\n`
    open(src)
    expect(page!.editor!.view.dom.querySelector('h3')!.getAttribute('data-meta')).toBeNull()
    const links = [...root.querySelectorAll('a')]
    expect(links).toHaveLength(2)
    for (const [i, a] of links.entries()) {
      ctrlClick(a)
      const sel = page!.editor!.selectionOffsets()!
      expect(page!.mirror!.text.slice(sel.head), `link ${i}`).toMatch(/^4\. Заголовок\n/)
      page!.editor!.view.focus()
    }
    expect(sent.filter((m) => m.type === 'openLink')).toEqual([])
  })

  it('shows the hint on hover and the strip when the host says the file is not there', () => {
    open(SRC)
    link('файл').dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    expect(link('файл').getAttribute('title')).toBe('Ctrl+клик — открыть')
    host({ type: 'notice', text: 'Файл по ссылке не найден' })
    expect(root.querySelector('.notice-text')!.textContent).toBe('Файл по ссылке не найден')
    // heard again: the strip stays and blinks; a link that opens takes it away
    host({ type: 'notice', text: 'Файл по ссылке не найден' })
    expect(root.querySelector('.notice')!.classList.contains('again')).toBe(true)
    host({ type: 'noticeHide' })
    expect((root.querySelector('.notice') as HTMLElement).hidden).toBe(true)
  })

  const OPEN = [
    'Абзац `xref:b.adoc[Б]` и `https://example.org/c[В]`, ещё xref:Папка с пробелом/Файл.adoc[Пр] и link:https://example.org/b[Лк].',
    '',
    '[cols="1,1,1"]',
    '|===',
    '<|`xref:b.adoc[ШБ]` <|`https://example.org/c[ШВ]` <|xref:ZZ/GET_{itemCode}_state.adoc[GET /items/{itemCode}/state]',
    '',
    '|`xref:b.adoc[ЯБ]` |`https://example.org/c[ЯВ]` |mailto:a@b.c[почта]',
    '|===',
    '',
  ].join('\n')

  it('opens links in monospace, in cells, and an xref with an attribute in the path, all as links', () => {
    open(OPEN)
    for (const [text, href] of [
      ['Б', 'b.adoc'],
      ['В', 'https://example.org/c'],
      ['Пр', 'Папка с пробелом/Файл.adoc'],
      ['ШБ', 'b.adoc'],
      ['ШВ', 'https://example.org/c'],
      ['GET /items/{itemCode}/state', 'ZZ/GET_{itemCode}_state.adoc'],
      ['ЯБ', 'b.adoc'],
      ['ЯВ', 'https://example.org/c'],
      ['почта', 'mailto:a@b.c'],
      ['Лк', 'https://example.org/b'],
    ] as const) {
      const a = link(text)
      expect(a, text).toBeTruthy()
      if (['Б', 'В', 'ШБ', 'ШВ', 'ЯБ', 'ЯВ'].includes(text)) expect(a.closest('code') ?? a.querySelector('code'), text).toBeTruthy()
      a.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
      expect(a.getAttribute('title'), text).toBe('Ctrl+клик — открыть')
      sent = []
      const before = page!.editor!.view.state.selection.from
      ctrlClick(a)
      expect(sent.filter((m) => m.type === 'openLink'), text).toEqual([{ type: 'openLink', href }])
      expect(page!.editor!.view.state.selection.from).toBe(before)
      sent = []
      ctrlClick(a, {})
      ctrlClick(a, { metaKey: true })
      expect(sent.filter((m) => m.type === 'openLink'), text).toEqual([])
    }
  })

  it('the source of a link with an attribute in the path does not change', () => {
    open(OPEN)
    page!.flush()
    expect(page!.mirror!.text).toBe(OPEN)
  })

  it('holding the key puts the hand over links, and letting go takes it away', () => {
    open(OPEN)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Control', ctrlKey: true, bubbles: true }))
    expect(root.classList.contains('link-key')).toBe(true)
    document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Control', bubbles: true }))
    expect(root.classList.contains('link-key')).toBe(false)
  })
})

describe('Cmd+click on a Mac, in English, in the Text mode, a plain click', () => {
  const press = (el: Element, init: MouseEventInit): { down: MouseEvent; click: MouseEvent } => {
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true, ...init })
    el.dispatchEvent(down)
    const click = new MouseEvent('click', { bubbles: true, cancelable: true, ...init })
    el.dispatchEvent(click)
    return { down, click }
  }
  const SRC = 'Адрес link:https://example.org/b[Лк] и xref:b.adoc[Файл] и <<_п,раздел>>.\n\n[cols="1"]\n|===\n|xref:c.adoc[Яч]\n|===\n\n== П\n\nТекст.\n'
  const link = (text: string): HTMLElement => [...root.querySelectorAll('a')].find((a) => a.textContent === text)!
  const opened = (): ToHost[] => sent.filter((m) => m.type === 'openLink')

  it('Mac: Cmd opens (text, link:, cell), Ctrl does not, the hint says Cmd, the hand follows Cmd only', () => {
    open(SRC, { mac: true })
    for (const [text, href] of [['Лк', 'https://example.org/b'], ['Файл', 'b.adoc'], ['Яч', 'c.adoc']] as const) {
      const a = link(text)
      a.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
      expect(a.getAttribute('title'), text).toBe('Cmd+клик — открыть')
      sent = []
      const before = page!.editor!.view.state.selection.from
      press(a, { metaKey: true })
      expect(opened(), text).toEqual([{ type: 'openLink', href }])
      expect(page!.editor!.view.state.selection.from).toBe(before)
      sent = []
      press(a, { ctrlKey: true })
      press(a, {})
      expect(opened(), text).toEqual([])
    }
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Control', ctrlKey: true, bubbles: true }))
    expect(root.classList.contains('link-key')).toBe(false)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Meta', metaKey: true, bubbles: true }))
    expect(root.classList.contains('link-key')).toBe(true)
    document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Meta', bubbles: true }))
    expect(root.classList.contains('link-key')).toBe(false)
  })

  it('English: the hint and the strips are in English, for Mac and for the rest', () => {
    open(SRC, { locale: 'en', mac: true })
    link('Файл').dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    expect(link('Файл').getAttribute('title')).toBe('Cmd+click to open')
    host({ type: 'notice', text: 'The linked file was not found' })
    expect(root.querySelector('.notice-text')!.textContent).toBe('The linked file was not found')
    root.remove()
    open(SRC, { locale: 'en', mac: false })
    link('Файл').dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    expect(link('Файл').getAttribute('title')).toBe('Ctrl+click to open')
  })

  it('a plain click: the press reaches the editor (the cursor goes in), a letter typed in the link text changes the source', () => {
    open(SRC)
    const a = link('Файл')
    const { down, click } = press(a, {})
    // (the page does not take the press away from the editor: only Cmd/Ctrl does)
    expect(down.defaultPrevented).toBe(false)
    expect(click.defaultPrevented).toBe(true)
    expect(opened()).toEqual([])
    const view = page!.editor!.view
    let at = -1
    view.state.doc.descendants((node, pos) => {
      if (at < 0 && node.isText && node.text === 'Файл') at = pos + 2
    })
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, at)))
    view.dispatch(view.state.tr.insertText('Ы'))
    page!.flush()
    expect(page!.mirror!.text).toContain('xref:b.adoc[ФаЫйл]')
    // a press with the key is taken from the editor
    expect(press(a, { ctrlKey: true }).down.defaultPrevented).toBe(true)
  })

  it('the Text mode: Ctrl+click opens nothing and the key does not show the hand', async () => {
    open(SRC)
    page!.toggleMode()
    await tick()
    sent = []
    const el = root.querySelector('.ed-source') ?? root
    press(el, { ctrlKey: true })
    expect(opened()).toEqual([])
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Control', ctrlKey: true, bubbles: true }))
    expect(root.classList.contains('link-key')).toBe(false)
  })

  it('an attribute in the path: a defined one is put in, an undefined one is sent as written; the section link hides the strip', () => {
    open(':dir: a\n:base: https://example.org\n\nxref:{dir}/b.adoc[Д] и link:{base}/p[Б] и xref:{no}/b.adoc[Н] и xref:\\{dir}/b.adoc[Э].\n\n== П\n\n<<_п,раздел>>\n')
    for (const [text, href] of [['Д', 'a/b.adoc'], ['Б', 'https://example.org/p'], ['Н', '{no}/b.adoc']] as const) {
      sent = []
      press(link(text), { ctrlKey: true })
      expect(opened(), text).toEqual([{ type: 'openLink', href }])
    }
    // an escaped reference is not a link
    expect(link('Э')).toBeUndefined()
    host({ type: 'notice', text: 'x' })
    press(link('раздел'), { ctrlKey: true })
    expect((root.querySelector('.notice') as HTMLElement).hidden).toBe(true)
  })
})

describe('the language of the tab', () => {
  it('in English shows no Cyrillic outside the document, in any mode', async () => {
    open('= Document\n\nOne two three.\n\n== First\n\nText <<nowhere>> here.\n', { locale: 'en', lang: 'en' })
    page!.flush()
    const outside = (): string[] => {
      const out: string[] = []
      for (const el of root.querySelectorAll('*')) {
        if (el.closest('.page, .ed-source')) continue
        for (const a of ['aria-label', 'title', 'placeholder']) out.push(el.getAttribute(a) ?? '')
        out.push([...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(''))
      }
      return out
    }
    expect(outside().filter((s) => CYRILLIC.test(s))).toEqual([])
    // the underlined remarks inside the document
    const remarks = [...root.querySelectorAll('.page .diag')].map((el) => el.getAttribute('title') ?? '')
    expect(remarks.length).toBeGreaterThan(0)
    expect(remarks.filter((s) => CYRILLIC.test(s))).toEqual([])
    await select('One')
    await tick(300)
    await tick(300)
    expect(button('Bold')).toBeTruthy()
    await click(button('Link'))
    expect(outside().filter((s) => CYRILLIC.test(s))).toEqual([])
    page!.toggleMode()
    await tick()
    expect(outside().filter((s) => CYRILLIC.test(s))).toEqual([])
    expect(root.querySelector('.tb-note')!.textContent).toBe('Text mode')
    // the refusal
    page!.toggleMode()
    await select('One', true)
    await tick()
    page!.editor!.commands.setFill('hl-gray-bg')
    expect(root.querySelector('.notice-text')!.textContent).toBe('Select some text first.')
  })

  it('shows «Открываю…» in the language of the page before the host speaks', () => {
    document.documentElement.lang = 'en'
    root = document.createElement('div')
    document.body.append(root)
    page = startPage(api, root)
    vi.advanceTimersByTime(401)
    expect(root.querySelector('.loading')!.textContent).toContain('Opening the visual editor…')
  })

  it('in English the tree and the strips are English', () => {
    open('= Document\n\nOne.\n\n== First\n\nText.\n', { locale: 'en', lang: 'en' })
    expect(root.querySelector('.sections-card')!.getAttribute('aria-label')).toBe('Sections of the document')
    expect(root.querySelector('.sections-card .card-head')!.textContent).toBe('Sections')
    expect(root.querySelector('.tree-total')).toBeNull()
  })
})

describe('the capsule in the text of a table cell', () => {
  it('takes the address of a link in a cell that is read, and not a hint of a plate on a cell that is shown as text', async () => {
    const { createSession } = await import('@nota-adoc/core')
    const { createVisualEditor } = await import('@nota-adoc/prosemirror')
    const { linkAt } = await import('../../src/webview/format.js')
    const { messages } = await import('@nota-adoc/react')
    const el = document.createElement('div')
    document.body.append(el)
    const editor = createVisualEditor(el, { session: createSession('|===\n|https://c.example.net/a[Ссылка] и *жирный*\nl|*x*\n|===\n') })
    const place = (text: string, k: number): void => {
      let found = -1
      editor.view.state.doc.descendants((node, pos) => {
        if (found < 0 && node.type.name === 'cell_text' && node.textContent === text) found = pos + 1 + k
        return found < 0
      })
      editor.view.dispatch(editor.view.state.tr.setSelection(TextSelection.create(editor.view.state.doc, found)))
    }
    place('Ссылка и жирный', 3)
    expect(linkAt(editor)).toBe('https://c.example.net/a')
    place('Ссылка и жирный', 9)
    expect(linkAt(editor)).toBeNull()
    expect(messages.ru.tips.offCell).toBe('Сейчас недоступно: ячейка показана как текст. Её разметку правят в режиме «Текст».')
    editor.destroy()
    el.remove()
  })
})

describe('the row of colours follows the selection', () => {
  const bubbleButton = (cmd: string): HTMLButtonElement => root.querySelector<HTMLButtonElement>(`.bubble [data-cmd="${cmd}"]`)!
  const BUTTONS = ['strong', 'em', 'code', 'strike', 'highlight', 'color', 'fill', 'link']
  const key = (init: KeyboardEventInit, target: EventTarget = document): void => {
    target.dispatchEvent(new KeyboardEvent('keydown', { ...init, bubbles: true, cancelable: true }))
  }
  const set = async (from: number, to: number): Promise<void> => {
    const view = page!.editor!.view
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)))
    await tick()
  }
  const wordAt = (word: string): number => {
    let found = -1
    page!.editor!.view.state.doc.descendants((node, pos) => {
      if (found < 0 && node.isText && node.text!.includes(word)) found = pos + node.text!.indexOf(word)
    })
    return found
  }

  it.each(['color', 'fill'])('«%s» open: a new selection without the mouse closes the row, the panel is over the new word, the file is the same', async (cmd) => {
    open(DOC)
    await select('Первое')
    await ready()
    await click(bubbleButton(cmd))
    expect(root.querySelector('.bubble .cr')).not.toBeNull()
    const at = wordAt('Второе')
    await set(at, at + 'Второе'.length)
    expect(root.querySelector('.bubble .cr:not(.is-leaving)')).toBeNull()
    await ready()
    expect([...root.querySelectorAll('.bubble .bb-layer.bar > button')].map((b) => (b as HTMLElement).dataset.cmd)).toEqual(BUTTONS)
    expect(page!.mirror!.text).toBe(DOC)
    await click(bubbleButton(cmd))
    expect(root.querySelector('.bubble .cr')).not.toBeNull()
    // the new word has no colour: «Без цвета» is the chosen one
    expect(root.querySelector('.bubble .cr [aria-pressed=true]')?.getAttribute('aria-label') ?? 'none').not.toBe('Красный')
  })

  it.each(['color', 'fill'])('«%s» open, the other paragraph, by the mouse: the row closes, the panel is over the new word', async (cmd) => {
    open(DOC)
    await select('Первое')
    await ready()
    await click(bubbleButton(cmd))
    expect(root.querySelector('.bubble .cr')).not.toBeNull()
    const at = wordAt('Текст')
    const dom = page!.editor!.view.dom
    dom.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    await set(at, at + 5)
    dom.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }))
    await tick()
    expect(root.querySelector('.bubble .cr:not(.is-leaving)')).toBeNull()
    await ready()
    expect([...root.querySelectorAll('.bubble .bb-layer.bar > button')].map((b) => (b as HTMLElement).dataset.cmd)).toEqual(BUTTONS)
    expect(page!.mirror!.text).toBe(DOC)
  })

  it('the new word is coloured: its circle is the chosen one when the row is opened again', async () => {
    const doc = DOC.replace('Второе', '[.hl-red]#Второе#')
    open(doc)
    await select('Первое')
    await ready()
    await click(bubbleButton('color'))
    const at = wordAt('Второе')
    await set(at, at + 'Второе'.length)
    await ready()
    await click(bubbleButton('color'))
    expect(root.querySelector('.bubble .cr [aria-pressed=true]')?.getAttribute('aria-label')).toBe('Красный')
  })

  it('Shift+arrows, Shift+Home, Alt+Shift+arrow in the text are not taken by the row; the selection widens and the row closes', async () => {
    open(DOC)
    await select('Первое')
    await ready()
    // a real click of the mouse has detail 1: the row is not in the keyboard mode
    bubbleButton('color').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }))
    await tick()
    const name = root.querySelector('.bubble .cr .cr-name')?.textContent
    const view = page!.editor!.view
    for (const init of [
      { key: 'ArrowRight', shiftKey: true },
      { key: 'ArrowLeft', shiftKey: true },
      { key: 'Home', shiftKey: true },
      { key: 'End', shiftKey: true },
      { key: 'ArrowRight', shiftKey: true, altKey: true },
    ]) {
      const event = new KeyboardEvent('keydown', { ...init, bubbles: true, cancelable: true })
      view.dom.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(false)
    }
    expect(root.querySelector('.bubble .cr.kb')).toBeNull()
    expect(root.querySelector('.bubble .cr .cr-name')?.textContent).toBe(name)
    const { from, to } = view.state.selection
    await set(from, to + 1)
    expect(root.querySelector('.bubble .cr:not(.is-leaving)')).toBeNull()
    await ready()
    expect(bubbleButton('color')).not.toBeNull()
  })

  it('a row opened by the keyboard: an outside shift of the selection closes it and the focus goes back to the text', async () => {
    open(DOC)
    await select('Первое')
    await ready()
    key({ key: 'F10', altKey: true }, page!.editor!.view.dom)
    await tick()
    while (document.activeElement !== bubbleButton('color')) key({ key: 'ArrowRight' }, document.activeElement!)
    bubbleButton('color').click()
    await tick()
    expect((document.activeElement as HTMLElement).closest('.cr')).not.toBeNull()
    const at = wordAt('Второе')
    await set(at, at + 3)
    expect(root.querySelector('.bubble .cr:not(.is-leaving)')).toBeNull()
    expect(document.activeElement).toBe(page!.editor!.view.dom)
  })

  it('hover, the arrows of the row opened by the keyboard, the marks of the remarks and the frame do not close the row', async () => {
    open(DOC)
    await select('Первое')
    await ready()
    key({ key: 'F10', altKey: true }, page!.editor!.view.dom)
    await tick()
    while (document.activeElement !== bubbleButton('color')) key({ key: 'ArrowRight' }, document.activeElement!)
    bubbleButton('color').click()
    await tick()
    const sw = [...root.querySelectorAll('.bubble .cr .sw-b')]
    sw[3]!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    sw[3]!.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }))
    page!.editor!.setRanges([{ from: 0, to: 4, message: 'note', severity: 'info' }])
    await tick()
    const event = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })
    ;(document.activeElement as HTMLElement).dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(root.querySelector('.bubble .cr')).not.toBeNull()
    expect(page!.mirror!.text).toBe(DOC)
  })
})

describe('the note «пропускает уровень» in «Текст ⌄»', () => {
  const DEEP = '= Док\n\nВступление тут.\n\n== A\n\nПод вторым.\n\n=== B\n\nПод третьим.\n\n=== C\n\nЕщё одно.\n'
  const marked = (): string[] =>
    [...root.querySelectorAll('.dd-list [role="option"]')].filter((o) => o.querySelector('.dd-note')).map((o) => o.getAttribute('data-value')!)
  const openMenu = async (): Promise<void> => {
    await click(root.querySelector('.isle-tools [data-cmd="style"]')!)
  }

  it('marks the items that skip a level from the nearest heading above, and nothing else', async () => {
    open(DEEP)
    await select('Под вторым', true)
    await openMenu()
    expect(marked()).toEqual(['h4', 'h5', 'h6'])
    const four = root.querySelector('.dd-list [data-value="h4"]')!
    expect(four.getAttribute('aria-description')).toBe('пропускает уровень')
    expect(four.querySelector('.dd-keys')).not.toBeNull()
    expect(root.querySelector('.dd-list [data-value="h3"]')!.getAttribute('aria-description')).toBeNull()
  })

  it('counts from the nearest heading above', async () => {
    open(DEEP)
    await select('Под третьим', true)
    await openMenu()
    expect(marked()).toEqual(['h5', 'h6'])
  })

  it('with no heading of a section above, from level 1', async () => {
    open(DEEP)
    await select('Вступление', true)
    await openMenu()
    expect(marked()).toEqual(['h3', 'h4', 'h5', 'h6'])
  })

  it('the cursor in a heading: the block itself is not counted, it is «=== B» after «== A»', async () => {
    open(DEEP)
    await select('Под вторым', true)
    const view = page!.editor!.view
    let at = 0
    view.state.doc.descendants((n, pos) => {
      if (n.type.name === 'heading' && n.textContent === 'B') at = pos + 1
    })
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, at)))
    await tick()
    await openMenu()
    expect(marked()).toEqual(['h4', 'h5', 'h6'])
    expect(root.querySelector('.dd-list [aria-selected="true"]')!.getAttribute('data-value')).toBe('h3')
  })

  it('English: «skips a level»; a marked item is chosen as before, and the engine tells the remark', async () => {
    open(DEEP, { locale: 'en' })
    await select('Под вторым', true)
    await openMenu()
    expect(root.querySelector('.dd-list [data-value="h4"]')!.getAttribute('aria-description')).toBe('skips a level')
    await click(root.querySelector('.dd-list [data-value="h4"]')!)
    expect(page!.mirror!.text).toContain('==== Под вторым')
  })
})
