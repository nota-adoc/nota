// the choice of the type of an admonition in the tab, no layout (jsdom): the string over an island, the redo of a change of
// the type, Alt+F10 and the ring of the focus, the mode «Текст».
import { TextSelection } from 'prosemirror-state'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type Page, startPage } from '../../src/webview/main.js'
import type { Locale, Mode, ToHost, ToTab } from '../../src/protocol.js'

let sent: ToHost[]
let root: HTMLElement
let page: Page | undefined

const api = { postMessage: (m: ToHost) => void sent.push(m) }
const host = (message: ToTab): void => void window.dispatchEvent(new MessageEvent('message', { data: message }))
const tick = async (ms = 50): Promise<void> => void (await vi.advanceTimersByTimeAsync(ms))
const q = <T extends HTMLElement>(selector: string): T => root.querySelector<T>(selector)!

function open(text: string, extra: { locale?: Locale; mode?: Mode; mac?: boolean } = {}): Page {
  root = document.createElement('div')
  root.id = 'app'
  document.body.append(root)
  page = startPage(api, root, { mac: extra.mac ?? false })
  host({ type: 'init', text, version: 1, fileName: 'a.adoc', locale: extra.locale ?? 'ru', outlineView: 'capsule', fileDir: '/work/docs', mode: extra.mode ?? 'visual' })
  page.flush()
  return page
}
async function inText(text: string): Promise<void> {
  const view = page!.editor!.view
  let found = -1
  view.state.doc.descendants((node, pos) => {
    if (found < 0 && node.isTextblock && node.textContent.includes(text)) found = pos + 1 + node.textContent.indexOf(text)
    return found < 0
  })
  if (found < 0) throw new Error(`no «${text}»`)
  view.focus()
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, found + text.length)))
  await tick()
}
const key = async (k: string, target: EventTarget, extra: KeyboardEventInit = {}): Promise<KeyboardEvent> => {
  const event = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...extra })
  target.dispatchEvent(event)
  await tick()
  return event
}
const click = async (el: Element, withPress = true): Promise<void> => {
  if (withPress) el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  await tick()
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

const NOTE = 'NOTE: Первое примечание.\n\nОбычный абзац.\n'

describe('the string over an island', () => {
  it('ru: one string for every island of the tab, en: its own', async () => {
    open('ifdef::env-x[]\nскрытый\nendif::[]\n\n[verse]\n____\nСтрока\n____\n\nТекст.\n')
    const notes = [...root.querySelectorAll('.nota-island .island-note')]
    expect(notes.length).toBeGreaterThan(0)
    for (const n of notes) expect(n.textContent).toContain('Как в файле — правится как текст')
    // (the pages' own islands have their own strings: the header of the page)
    const plain = notes.filter((n) => !n.closest('[data-kind^="PageMeta"]'))
    expect(plain.length).toBeGreaterThan(1)
    expect(new Set(plain.map((n) => n.textContent)).size).toBeLessThanOrEqual(1)
    for (const n of plain) expect(n.textContent).not.toMatch(/Исходник|AsciiDoc/)
  })
  it('en: the same string in English', async () => {
    open('[verse]\n____\nLine\n____\n\nText.\n', { locale: 'en' })
    const notes = [...root.querySelectorAll('.nota-island .island-note')]
    expect(notes.length).toBeGreaterThan(0)
    for (const n of notes) expect(n.textContent).toContain('As in the file — edited as text')
  })
})

describe('the change of the type and its undo and redo', () => {
  // (`Mod` is Ctrl in jsdom, where there is no Mac: it is Cmd on a Mac, the same binding `Mod-Shift-z`)
  it('Cmd+Z returns NOTE, Cmd+Shift+Z makes it WARNING again', async () => {
    open(NOTE)
    await inText('Первое')
    await click(q('[data-cmd=admonition]'))
    await click(q('.admpick [data-type=WARNING]'))
    page!.flush()
    expect(page!.mirror!.text).toBe(NOTE.replace('NOTE:', 'WARNING:'))
    const edit = sent.filter((m): m is Extract<ToHost, { type: 'edit' }> => m.type === 'edit').at(-1)!
    // (the edit is one: the word of the type and nothing else)
    expect(edit.changes).toEqual([{ from: 0, to: 4, insert: 'WARNING' }])
    host({ type: 'ack', id: edit.id, version: 2 })
    const dom = page!.editor!.view.dom
    // Cmd+Z asks the host, whose answer undoes the change: one press, the file is as it was
    await key('z', dom, { ctrlKey: true })
    expect(sent.at(-1)).toEqual({ type: 'undo' })
    host({ type: 'update', version: 3, changes: [{ from: 0, to: 7, insert: 'NOTE' }], reason: 'undo' })
    page!.flush()
    expect(page!.mirror!.text).toBe(NOTE)
    // Cmd+Shift+Z: the host puts the change back, the block is «Внимание» again
    await key('z', dom, { ctrlKey: true, shiftKey: true })
    expect(sent.at(-1)).toEqual({ type: 'redo' })
    host({ type: 'update', version: 4, changes: [{ from: 0, to: 4, insert: 'WARNING' }], reason: 'redo' })
    page!.flush()
    expect(page!.mirror!.text).toBe(NOTE.replace('NOTE:', 'WARNING:'))
    await tick()
    expect(q('[data-cmd=admonition]').getAttribute('aria-label')).toBe('Тип примечания: Внимание')
  })
})

describe('Alt+F10 in the admonition and the ring of the focus', () => {
  it('Alt+F10 opens the row with the focus on the current type; the capsule gets no focus on the way', async () => {
    open(NOTE)
    await inText('Первое')
    const focused: Element[] = []
    root.addEventListener('focusin', (e) => focused.push(e.target as Element))
    const event = await key('F10', page!.editor!.view.dom, { altKey: true })
    expect(event.defaultPrevented).toBe(true)
    await tick(300)
    const radio = q('.admpick [role=radio][aria-checked=true]')
    expect(radio.dataset.type).toBe('NOTE')
    expect(document.activeElement).toBe(radio)
    expect(focused.filter((e) => e.closest('.isle-tools'))).toEqual([])
    expect(q('.admpick').classList.contains('kb')).toBe(true)
    // → → Enter: the type changes (the third is «Важно»)
    await key('ArrowRight', radio)
    await key('ArrowRight', document.activeElement!)
    await key('Enter', document.activeElement!)
    await click(document.activeElement!, false)
    expect(page!.mirror!.text).toBe(NOTE.replace('NOTE:', 'IMPORTANT:'))
  })

  it('Alt+F10, Esc: the row folds, the cursor is in the text, the type is the same', async () => {
    open(NOTE)
    await inText('Первое')
    await key('F10', page!.editor!.view.dom, { altKey: true })
    await tick(300)
    await key('Escape', document.activeElement!)
    await tick(300)
    expect(root.querySelector('.admpick .adm-row')).toBeNull()
    expect(page!.editor!.view.dom.contains(document.activeElement)).toBe(true)
    expect(page!.mirror!.text).toBe(NOTE)
  })

  it('opened with the mouse the ring is off (no `.kb`); the arrows turn it on', async () => {
    open(NOTE)
    await inText('Первое')
    await click(q('[data-cmd=admonition]'))
    await tick(300)
    expect(q('.admpick').classList.contains('kb')).toBe(false)
    await key('ArrowRight', document.activeElement!)
    expect(q('.admpick').classList.contains('kb')).toBe(true)
  })
})

describe('the mode «Текст»', () => {
  it('in «Текст» there is no choice of the type; NOTE: → TIP: in the text shows the block «Совет» in «Визуально»', async () => {
    open(NOTE, { mode: 'text' })
    expect(root.querySelector('.admpick')).toBeNull()
    expect(root.querySelector('[data-cmd=admonition]')).toBeNull()
    const view = page!.source!.view
    const at = NOTE.indexOf('NOTE')
    view.dispatch({ changes: { from: at, to: at + 4, insert: 'TIP' } })
    await tick(500)
    expect(root.querySelector('.admpick')).toBeNull()
    page!.toggleMode()
    await tick(300)
    await inText('Первое')
    const trig = q('[data-cmd=admonition]')
    expect(trig.getAttribute('aria-label')).toBe('Тип примечания: Совет')
    await click(trig)
    expect(q('.admpick [role=radio][aria-checked=true]').dataset.type).toBe('TIP')
    expect(page!.mirror!.text).toContain('TIP: Первое примечание.')
  })
})
