// moving sections in the tree, the handle of a block in the tab, the strip of a refusal.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type Page, startPage } from '../../src/webview/main.js'
import type { Mode, ToHost, ToTab } from '../../src/protocol.js'

const FIXTURE = readFileSync(join(import.meta.dirname, '../../../../quality/fixtures/editor/structure.adoc'), 'utf8')

let sent: ToHost[]
let root: HTMLElement
let page: Page | undefined
let version: number

const api = { postMessage: (m: ToHost) => void sent.push(m) }
const host = (message: ToTab): void => void window.dispatchEvent(new MessageEvent('message', { data: message }))

function open(text = FIXTURE, mode: Mode = 'visual', locale: 'ru' | 'en' = 'ru'): Page {
  root = document.createElement('div')
  root.id = 'app'
  document.body.append(root)
  page = startPage(api, root)
  version = 1
  host({ type: 'init', text, version, fileName: 'structure.adoc', locale, outlineView: 'capsule', fileDir: '/work/docs', mode })
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

const rows = (): HTMLElement[] => [...root.querySelectorAll<HTMLElement>('.tree-row')]
const titles = (): string[] => [...root.querySelectorAll('.tree-name')].map((e) => e.textContent ?? '')
const notice = (): string => root.querySelector<HTMLElement>('.notice:not(.crash) .notice-text')!.textContent ?? ''
const noticeShown = (): boolean => !root.querySelector<HTMLElement>('.notice:not(.crash)')!.hidden

/** Replays the edits the tab sent on a text. */
function fileAfterEdits(text: string): string {
  let out = text
  for (const m of sent) {
    if (m.type !== 'edit') continue
    let result = ''
    let at = 0
    for (const c of [...m.changes].sort((a, b) => a.from - b.from)) {
      result += out.slice(at, c.from) + (c.insert ?? '')
      at = c.to ?? c.from
    }
    out = result + out.slice(at)
  }
  return out
}
const edits = (): number => sent.filter((m) => m.type === 'edit').length

function drag(from: number, to: number, y: 'top' | 'bottom'): { over: Event; dropped: Event } {
  const [a, b] = [rows()[from]!, rows()[to]!]
  vi.spyOn(b, 'getBoundingClientRect').mockReturnValue({ top: 100, height: 20, bottom: 120, left: 0, right: 100, width: 100, x: 0, y: 100, toJSON() {} } as DOMRect)
  const data = { effectAllowed: '', dropEffect: '', setData() {} }
  const ev = (type: string, extra: object = {}): Event => {
    const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientY: y === 'top' ? 102 : 118, ...extra })
    Object.defineProperty(e, 'dataTransfer', { value: data })
    return e
  }
  a.dispatchEvent(ev('dragstart'))
  const over = ev('dragover')
  b.dispatchEvent(over)
  const dropped = ev('drop')
  b.dispatchEvent(dropped)
  a.dispatchEvent(ev('dragend'))
  return { over, dropped }
}

describe('the tree: dragging a section', () => {
  it('has draggable rows in the visual mode and none in «Текст»', () => {
    open()
    expect(rows().every((r) => r.draggable)).toBe(true)
    page!.toggleMode()
    page!.flush()
    expect(rows().some((r) => r.draggable)).toBe(false)
  })

  it('moves «Б» before «А» with its subsections: the text, the tree and one edit', () => {
    open()
    expect(titles()).toEqual(['А. Лимиты', 'А1. Подраздел', 'А2. Второй подраздел', 'Б. Таблицы и рамки', 'Б1. Подраздел', 'В. Остальное', 'Г. Сразу подраздел', 'Г1. Единственный подраздел'])
    const { over } = drag(3, 0, 'top')
    expect(over.defaultPrevented).toBe(true)
    page!.flush()
    expect(titles()).toEqual(['Б. Таблицы и рамки', 'Б1. Подраздел', 'А. Лимиты', 'А1. Подраздел', 'А2. Второй подраздел', 'В. Остальное', 'Г. Сразу подраздел', 'Г1. Единственный подраздел'])
    expect(edits()).toBe(1)
    const text = fileAfterEdits(FIXTURE)
    expect(text.split('\n').filter((l) => l !== '').sort()).toEqual(FIXTURE.split('\n').filter((l) => l !== '').sort())
    expect(text.indexOf('== Б. Таблицы')).toBeLessThan(text.indexOf('[[a]]'))
    expect(text.length).toBe(FIXTURE.length)
  })

  it('drops on the lower half: after the target with its subsections', () => {
    open()
    drag(0, 3, 'bottom')
    page!.flush()
    expect(titles()).toEqual(['Б. Таблицы и рамки', 'Б1. Подраздел', 'А. Лимиты', 'А1. Подраздел', 'А2. Второй подраздел', 'В. Остальное', 'Г. Сразу подраздел', 'Г1. Единственный подраздел'])
    expect(edits()).toBe(1)
  })

  it('marks the line above or under the row, and forbids dropping on itself and on its own subsection', () => {
    open()
    const b = rows()[3]!
    vi.spyOn(b, 'getBoundingClientRect').mockReturnValue({ top: 100, height: 20, bottom: 120 } as DOMRect)
    const data = { effectAllowed: '', dropEffect: '', setData() {} }
    const ev = (type: string, clientY: number, target?: HTMLElement): Event => {
      const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientY })
      Object.defineProperty(e, 'dataTransfer', { value: data })
      void target
      return e
    }
    rows()[0]!.dispatchEvent(ev('dragstart', 0))
    b.dispatchEvent(ev('dragover', 105))
    expect(b.classList.contains('drop-before')).toBe(true)
    b.dispatchEvent(ev('dragover', 115))
    expect(b.classList.contains('drop-after')).toBe(true)
    expect(b.classList.contains('drop-before')).toBe(false)
    for (const i of [0, 1, 2]) {
      const over = ev('dragover', 5)
      rows()[i]!.dispatchEvent(over)
      expect(over.defaultPrevented).toBe(false)
      expect(data.dropEffect).toBe('none')
    }
    rows()[0]!.dispatchEvent(ev('dragend', 0))
    expect(root.querySelector('.drop-before, .drop-after, .dragging')).toBeNull()
    expect(edits()).toBe(0)
  })

  it('does not move in «Текст»', () => {
    open(FIXTURE, 'text')
    expect(rows().some((r) => r.draggable)).toBe(false)
    const { dropped } = drag(3, 0, 'top')
    void dropped
    expect(edits()).toBe(0)
  })

  it('says so and keeps the file when the engine refuses: a section before the subsection of another one', () => {
    open()
    drag(3, 1, 'top')
    expect(noticeShown()).toBe(true)
    expect(notice()).toBe('Сюда блок перенести нельзя')
    expect(edits()).toBe(0)
  })
})

describe('the tree: Alt+↑ and Alt+↓', () => {
  const alt = (i: number, key: 'ArrowUp' | 'ArrowDown'): void => {
    const item = root.querySelectorAll<HTMLElement>('.tree-item')[i]!
    item.focus()
    item.dispatchEvent(new KeyboardEvent('keydown', { key, altKey: true, bubbles: true, cancelable: true }))
  }

  it('swaps a section with its neighbour of the same level and keeps the focus on it', () => {
    open()
    alt(3, 'ArrowUp')
    expect(titles().slice(0, 3)).toEqual(['Б. Таблицы и рамки', 'Б1. Подраздел', 'А. Лимиты'])
    expect(document.activeElement?.textContent).toBe('Б. Таблицы и рамки')
    expect(edits()).toBe(1)
    alt(0, 'ArrowDown')
    expect(titles()).toEqual(['А. Лимиты', 'А1. Подраздел', 'А2. Второй подраздел', 'Б. Таблицы и рамки', 'Б1. Подраздел', 'В. Остальное', 'Г. Сразу подраздел', 'Г1. Единственный подраздел'])
    expect(document.activeElement?.textContent).toBe('Б. Таблицы и рамки')
  })

  it('swaps subsections inside their section', () => {
    open()
    alt(2, 'ArrowUp')
    expect(titles().slice(0, 3)).toEqual(['А. Лимиты', 'А2. Второй подраздел', 'А1. Подраздел'])
    expect(document.activeElement?.textContent).toBe('А2. Второй подраздел')
  })

  it('tells the first and the last of the level and writes nothing', () => {
    open()
    alt(0, 'ArrowUp')
    expect(notice()).toBe('Раздел и так первый на своём уровне')
    alt(6, 'ArrowDown')
    expect(notice()).toBe('Раздел и так последний на своём уровне')
    alt(1, 'ArrowUp')
    expect(notice()).toBe('Раздел и так первый на своём уровне')
    expect(edits()).toBe(0)
  })

  it('does nothing in «Текст»', () => {
    open(FIXTURE, 'text')
    alt(3, 'ArrowUp')
    expect(edits()).toBe(0)
    expect(noticeShown()).toBe(false)
  })

  it('speaks English', () => {
    open(FIXTURE, 'visual', 'en')
    alt(0, 'ArrowUp')
    expect(notice()).toBe('The section is already the first at its level')
  })
})
