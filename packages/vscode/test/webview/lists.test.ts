// lists, admonitions and collapsible blocks in the tab: the buttons of the toolbar, Tab, the checkbox, the panel of the type,
// the title of a collapsible block. Every command is one edit for the host, which is one step of its history.
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
const edits = (): Extract<ToHost, { type: 'edit' }>[] => (vi.advanceTimersByTime(400), sent).filter((m): m is Extract<ToHost, { type: 'edit' }> => m.type === 'edit')

function open(text: string, locale: Locale = 'ru'): Page {
  root = document.createElement('div')
  root.id = 'app'
  document.body.append(root)
  if (locale === 'en') document.documentElement.lang = 'en'
  page = startPage(api, root, { mac: false })
  host({ type: 'init', text, version: 1, fileName: 'a.adoc', locale, outlineView: 'capsule', fileDir: '/work/docs', mode: 'visual' })
  page.flush()
  return page
}

/** Puts the cursor after the first `word` on the screen. */
async function cursorIn(word: string): Promise<void> {
  const view = page!.editor!.view
  let found: number | null = null
  view.state.doc.descendants((node, pos) => {
    if (found !== null || !node.isText) return
    const i = node.text!.indexOf(word)
    if (i >= 0) found = pos + i + word.length
  })
  if (found === null) throw new Error(`no «${word}» on the screen`)
  view.focus()
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, found as number)))
  await tick()
}

const button = (name: string): HTMLButtonElement => root.querySelector<HTMLButtonElement>(`[aria-label="${name}"]`)!
const click = async (el: Element): Promise<void> => {
  el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  await tick()
}
const press = (key: string, init: KeyboardEventInit = {}): KeyboardEvent => {
  const ev = new KeyboardEvent('keydown', { key, code: key, bubbles: true, cancelable: true, ...init })
  page!.editor!.view.dom.dispatchEvent(ev)
  return ev
}

beforeEach(() => {
  vi.useFakeTimers()
  sent = []
  page = undefined
  document.body.className = ''
  document.documentElement.lang = ''
  document.elementFromPoint = () => null
})
afterEach(() => {
  page?.destroy()
  document.body.textContent = ''
  vi.useRealTimers()
})

describe('lists in the tab', () => {
  it('«Маркированный список» makes an item of the paragraph with one edit; Tab and Shift+Tab move it', async () => {
    open('Вход\n\nВыход\n')
    await cursorIn('Выход')
    await click(button('Маркированный список'))
    expect(page!.mirror!.text).toBe('Вход\n\n* Выход\n')
    expect(edits()).toHaveLength(1)
    expect(button('Маркированный список').getAttribute('aria-pressed')).toBe('true')
    // (a list needs an item above to go under)
    const before = edits().length
    const ev = press('Tab')
    expect(ev.defaultPrevented).toBe(true)
    expect(page!.mirror!.text).toBe('Вход\n\n* Выход\n')
    expect(edits()).toHaveLength(before)
    expect(root.querySelector('.notice-text')!.textContent).toBe('Первому пункту списка некуда сдвигаться: у него нет пункта выше.')
  })

  it('Tab puts the second item under the first, Shift+Tab brings it back, the focus stays in the text', async () => {
    open('* Вход\n* Выход\n')
    await cursorIn('Выход')
    const tab = press('Tab')
    expect(tab.defaultPrevented).toBe(true)
    expect(page!.mirror!.text).toBe('* Вход\n** Выход\n')
    expect(page!.editor!.view.hasFocus() || document.activeElement === page!.editor!.view.dom).toBe(true)
    expect(edits()).toHaveLength(1)
    host({ type: 'ack', id: 1, version: 2 })
    press('Tab', { shiftKey: true })
    expect(page!.mirror!.text).toBe('* Вход\n* Выход\n')
    expect(edits()).toHaveLength(2)
  })

  it('a click on the checkbox changes one character of the file', async () => {
    open('* [ ] Вход\n* [x] Выход\n')
    const boxes = [...root.querySelectorAll<HTMLElement>('.chk')]
    expect(boxes.map((b) => b.getAttribute('aria-checked'))).toEqual(['false', 'true'])
    expect(boxes[0]!.getAttribute('role')).toBe('checkbox')
    expect(boxes[0]!.getAttribute('aria-label')).toBe('Отметить пункт')
    boxes[0]!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }))
    await tick()
    expect(page!.mirror!.text).toBe('* [x] Вход\n* [x] Выход\n')
    expect(edits()).toHaveLength(1)
    expect(edits()[0]!.changes).toEqual([{ from: 3, to: 4, insert: 'x' }])
  })
})

describe('admonitions and collapsible blocks in the tab', () => {
  it('the panel changes the type with one edit that touches only the word', async () => {
    open('[NOTE#id.role]\n====\nТекст\n====\n')
    await cursorIn('Текст')
    const tag = root.querySelector<HTMLButtonElement>('[data-cmd=admonition]')!
    expect(tag.getAttribute('aria-label')).toBe('Тип примечания: Примечание')
    expect(root.querySelector('.blockbar [role=toolbar]')).toBeNull()
    await click(tag)
    const list = root.querySelector('[role=radiogroup][aria-label="Тип примечания"]')!
    expect(list.querySelectorAll('[role=radio]')).toHaveLength(5)
    expect(list.querySelector('[aria-checked=true]')!.getAttribute('aria-label')).toBe('Примечание')
    await click(list.querySelector('[data-type=WARNING]')!)
    expect(page!.mirror!.text).toBe('[WARNING#id.role]\n====\nТекст\n====\n')
    expect(edits()).toHaveLength(1)
    expect(edits()[0]!.changes).toEqual([{ from: 1, to: 5, insert: 'WARNING' }])
    expect(root.querySelector('[data-cmd=admonition]')!.getAttribute('aria-label')).toBe('Тип примечания: Внимание')
  })

  it('NOTE: becomes WARNING: in the paragraph form', async () => {
    open('NOTE: Текст\n')
    await cursorIn('Текст')
    await click(root.querySelector('[data-cmd=admonition]')!)
    await click(root.querySelector('[role=radiogroup] [data-type=WARNING]')!)
    expect(page!.mirror!.text).toBe('WARNING: Текст\n')
  })

  it('a click on the title opens a collapsible block and sends nothing to the host; typing inside sends one line', async () => {
    open('.Подробности\n[%collapsible]\n====\nВнутри.\n====\n\nКонец.\n')
    const head = root.querySelector<HTMLElement>('.coll-head')!
    expect(head.getAttribute('aria-expanded')).toBe('false')
    head.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }))
    await tick()
    expect(root.querySelector('.coll-head')!.getAttribute('aria-expanded')).toBe('true')
    expect(page!.mirror!.text).toBe('.Подробности\n[%collapsible]\n====\nВнутри.\n====\n\nКонец.\n')
    expect(edits()).toEqual([])
    root.querySelector('.coll-head')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }))
    await tick()
    expect(root.querySelector('.coll-head')!.getAttribute('aria-expanded')).toBe('false')
    expect(edits()).toEqual([])
  })

  it('shows «Подробнее» for a block with no title, and the types in English in an English tab', async () => {
    open('[%collapsible]\n====\nInside.\n====\n\nNOTE: Text\n', 'en')
    expect(root.querySelector('.coll-title')!.textContent).toBe('Details')
    expect(root.querySelector('.adm-lbl')!.textContent).toBe('Note.')
    await cursorIn('Text')
    await click(root.querySelector('[data-cmd=admonition]')!)
    expect(root.querySelector('[role=radiogroup][aria-label="Callout type"]')).toBeTruthy()
    for (const el of root.querySelectorAll('.ed-format [aria-label], .ed-format [title], .blockbar [aria-label], .blockbar [title]'))
      expect(`${el.getAttribute('aria-label') ?? ''}${el.getAttribute('title') ?? ''}`).not.toMatch(CYRILLIC)
    expect(button('Bulleted list')).toBeTruthy()
    expect(button('Numbered list')).toBeTruthy()
    expect(button('Checklist')).toBeTruthy()
  })
})
