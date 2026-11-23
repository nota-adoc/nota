// the capsule of selected cells in the real tab (jsdom): «+» takes it out of sight and Esc brings it back on the same place with the same cells,
// Alt+F10 on selected cells goes to the capsule of the cells, not to the one of the text.
import { TextSelection } from 'prosemirror-state'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type Page, startPage } from '../../src/webview/main.js'
import type { ToHost, ToTab } from '../../src/protocol.js'

let root: HTMLElement
let page: Page | undefined
const api = { postMessage: (_m: ToHost) => undefined }
const host = (message: ToTab): void => void window.dispatchEvent(new MessageEvent('message', { data: message }))
const tick = async (ms = 50): Promise<void> => void (await vi.advanceTimersByTimeAsync(ms))

const T = '|===\n|a1 |b1 |c1\n\n|a2 |b2 |c2\n\n|a3 |b3 |c3\n|===\n'

async function openCells(): Promise<void> {
  root = document.createElement('div')
  root.id = 'app'
  document.body.append(root)
  page = startPage(api, root, { mac: false })
  host({ type: 'init', text: T, version: 1, fileName: 'a.adoc', locale: 'ru', fileDir: '/work/docs', mode: 'visual' })
  page.flush()
  const view = page.editor!.view
  let found = -1
  view.state.doc.descendants((node, pos) => {
    if (found < 0 && node.type.name === 'cell_text' && node.textContent === 'a1') found = pos + 1
    return found < 0
  })
  view.focus()
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, found)))
  await tick()
  const td = [...view.dom.querySelectorAll('td, th')].find((x) => x.textContent === 'b2')!
  td.dispatchEvent(new MouseEvent('mousedown', { shiftKey: true, bubbles: true, cancelable: true }))
  document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
  await tick(400)
}
const capsule = (): HTMLElement | null => root.querySelector<HTMLElement>('.cellbar')
const plus = (): HTMLButtonElement => root.querySelector<HTMLButtonElement>('[data-cmd="insert"]')!
const selected = (): string => [...page!.editor!.view.dom.querySelectorAll('td.sel, th.sel')].map((x) => x.textContent).join(',')

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

describe('the capsule of cells in the tab', () => {
  it('«+» takes the capsule out of sight, the cells stay; Esc closes the list and brings the capsule back with the same cells', async () => {
    await openCells()
    expect(capsule()).not.toBeNull()
    const cells = selected()
    expect(cells).toBe('a1,b1,a2,b2')
    plus().dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    plus().dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 }))
    await tick(300)
    expect(root.querySelector('.leave:not(.is-leaving) .blocklist, .tl-blocks .bl-row')).not.toBeNull()
    expect(capsule()).toBeNull()
    expect(selected()).toBe(cells)
    const open = root.querySelector('.leave:not(.is-leaving) .blocklist, .tl-blocks .bl-row')!
    open.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    await tick(600)
    expect(root.querySelector('.leave:not(.is-leaving) .blocklist')).toBeNull()
    expect(capsule()).not.toBeNull()
    expect(selected()).toBe(cells)
  })

  it('Alt+F10 on selected cells puts the focus on the capsule of the cells', async () => {
    await openCells()
    expect(capsule()).not.toBeNull()
    page!.editor!.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', altKey: true, bubbles: true, cancelable: true }))
    await tick(100)
    expect(capsule()!.contains(document.activeElement)).toBe(true)
    expect(selected()).toBe('a1,b1,a2,b2')
  })

  it('Esc in the text puts the capsule out of sight and keeps the cells; Alt+F10 brings it back; the second Esc lets the cells go', async () => {
    await openCells()
    const dom = page!.editor!.view.dom
    dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    await tick(300)
    expect(capsule()).toBeNull()
    expect(selected()).toBe('a1,b1,a2,b2')
    // the first Esc is the capsule's: the row «Таблица» stays open
    expect(root.querySelector('.tl-table'), 'the row «Таблица» after the first Esc').not.toBeNull()
    dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', altKey: true, bubbles: true, cancelable: true }))
    await tick(400)
    expect(capsule()).not.toBeNull()
    expect(capsule()!.contains(document.activeElement)).toBe(true)
    page!.editor!.focus()
    await tick(100)
    dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    await tick(300)
    dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    await tick(300)
    expect(selected()).toBe('')
    // the second Esc let the cells go and left the row open; only the third one (no cells) puts it out of sight
    expect(root.querySelector('.tl-table'), 'the row «Таблица» after the second Esc').not.toBeNull()
  })
})
