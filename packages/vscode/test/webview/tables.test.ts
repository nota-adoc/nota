// In the tab: the panel of a table, its commands, the refusals in Russian and English, one Cmd+Z for each command.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { TextSelection } from 'prosemirror-state'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type Page, startPage } from '../../src/webview/main.js'
import type { Locale, ToHost, ToTab } from '../../src/protocol.js'

const fixture = (name: string): string => readFileSync(join(import.meta.dirname, '../../../../quality/fixtures/editor', name), 'utf8')
const TABLES = fixture('tables.adoc')
const NESTED = fixture('tables-nested.adoc')

let sent: ToHost[]
let root: HTMLElement
let page: Page | undefined
const api = { postMessage: (m: ToHost) => void sent.push(m) }
const host = (message: ToTab): void => void window.dispatchEvent(new MessageEvent('message', { data: message }))
const tick = async (ms = 50): Promise<void> => void (await vi.advanceTimersByTimeAsync(ms))
const edits = (): ToHost[] => sent.filter((m) => m.type === 'edit')

function open(text: string, locale: Locale = 'ru'): Page {
  root = document.createElement('div')
  root.id = 'app'
  document.body.append(root)
  page = startPage(api, root, { mac: false })
  host({ type: 'init', text, version: 1, fileName: 'a.adoc', locale, outlineView: 'capsule', fileDir: '/work/docs', mode: 'visual' })
  page.flush()
  return page
}

/** The cursor at the end of the text of the cell `text`. */
async function inCell(text: string, nth = 0): Promise<void> {
  const view = page!.editor!.view
  let found = -1
  let seen = 0
  view.state.doc.descendants((node, pos) => {
    if (found < 0 && node.type.name === 'cell_text' && node.textContent === text && seen++ === nth) found = pos + 1 + node.content.size
    return found < 0
  })
  if (found < 0) throw new Error(`no cell «${text}»`)
  view.focus()
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, found)))
  await tick()
}

const panel = (): HTMLElement | null => root.querySelector('.isle-tools [role=toolbar][aria-label="Таблица"], .isle-tools [role=toolbar][aria-label="Table"]')
const button = (cmd: string): HTMLButtonElement => root.querySelector<HTMLButtonElement>(`.tl-row [data-cmd="${cmd}"]`)!
async function click(el: Element): Promise<void> {
  el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  await tick()
}
const notice = (): string => root.querySelector('.notice-text')?.textContent ?? ''

let version = 1
/** The host takes the edit the command made (one edit, one step of its history). */
function acked(): void {
  for (;;) {
    vi.advanceTimersByTime(1000)
    page!.flush()
    const e = edits() as Extract<ToHost, { type: 'edit' }>[]
    if (e.length === acks) return
    for (const m of e.slice(acks)) host({ type: 'ack', id: m.id, version: ++version })
    acks = e.length
  }
}
let acks = 0
/** Cmd+Z of VS Code: the document goes back to the text before the step. */
function undoTo(text: string): void {
  acked()
  const now = page!.mirror!.text
  host({ type: 'update', version: ++version, changes: [{ from: 0, to: now.length, insert: text }], reason: 'undo' })
}
/** Cmd+Shift+Z: the step is done again. */
function redoTo(text: string): void {
  const now = page!.mirror!.text
  host({ type: 'update', version: ++version, changes: [{ from: 0, to: now.length, insert: text }], reason: 'redo' })
}

beforeEach(() => {
  vi.useFakeTimers()
  sent = []
  version = 1
  acks = 0
  page = undefined
})
afterEach(() => {
  page?.destroy()
  document.body.textContent = ''
  vi.useRealTimers()
})

describe('the panel of a table in the tab', () => {
  it('is the second row of the capsule with ten buttons in the order of the spec, and is not there outside a table', async () => {
    open(TABLES)
    expect(panel()).toBeNull()
    await inCell('Личный кабинет клиента')
    expect(panel()).not.toBeNull()
    expect([...panel()!.querySelectorAll('button')].map((b) => b.getAttribute('data-cmd'))).toEqual([
      'row-add', 'col-add', 'row-del', 'col-del', 'merge', 'split', 'cell-fill', 'head', 'nest', 'table-del',
    ])
    expect(root.querySelector('.fl.tablebar')).toBeNull()
    expect(panel()!.closest('.isle-tools')).not.toBeNull()
    expect(panel()!.querySelector('.fl-chip')).toBeNull()
    expect(button('head').getAttribute('aria-pressed')).toBe('true')
    await inCell('Статус')
    expect(button('head').getAttribute('aria-pressed')).toBe('true')
  })

  it('names the level of a table in a cell and works on that table', async () => {
    open(TABLES)
    await inCell('Ключ')
    expect(panel()!.querySelector('.fl-chip')!.textContent).toBe('уровень 2')
    expect(button('table-del').getAttribute('aria-label')).toBe('Удалить вложенную таблицу')
    expect(button('table-del').hasAttribute('title')).toBe(false)
    const before = page!.mirror!.text
    await click(button('table-del'))
    const after = page!.mirror!.text
    expect(after).not.toBe(before)
    expect(after).toContain('Внутри ячейки:')
    expect(after).not.toContain('!Ключ')
    undoTo(before)
    expect(page!.mirror!.text).toBe(before)
  })
})

describe('commands of a table in the tab: one Cmd+Z gives the file back byte for byte', () => {
  const cases: [string, string, string, string][] = [
    ['a row is added', 'row-add', 'Личный кабинет клиента', TABLES],
    ['a column is added', 'col-add', 'Приложение для курьеров', TABLES],
    ['a row is deleted', 'row-del', 'Приложение для курьеров', TABLES],
    ['a column is deleted', 'col-del', 'Приложение для курьеров', TABLES],
    ['the head is switched', 'head', 'Принято', TABLES],
    ['a table is put in a cell', 'nest', 'день', TABLES],
    ['the table is deleted', 'table-del', 'Личный кабинет клиента', TABLES],
    ['a nested table: a row', 'row-add', 'цвет', TABLES],
    ['a nested table of the third level: a column', 'col-add', 'стол', NESTED],
    ['a nested table of the fourth level: a row', 'row-add', 'х', NESTED],
    ['a nested table of the fourth level is deleted', 'table-del', 'х', NESTED],
  ]
  for (const [name, cmd, cell, text] of cases)
    it(name, async () => {
      open(text)
      await inCell(cell)
      const original = page!.mirror!.text
      await click(button(cmd))
      const result = page!.mirror!.text
      if (result === original) expect(notice(), name).toBe('')
      expect(result, name).not.toBe(original)
      // one command is one edit that the host takes, so one Cmd+Z of VS Code
      await tick(1000)
      page!.flush()
      expect(edits(), name).toHaveLength(1)
      undoTo(original)
      expect(page!.mirror!.text, name).toBe(original)
      redoTo(result)
      expect(page!.mirror!.text, name).toBe(result)
    })

  it('cells are merged with a Shift-click and split again', async () => {
    open('|===\n|a |b\n\n|c |d\n|\n|e\n|===\n')
    await inCell('c')
    const original = page!.mirror!.text
    const cell = [...page!.editor!.view.dom.querySelectorAll('td')].find((c) => c.textContent === '')!
    cell.dispatchEvent(new MouseEvent('mousedown', { shiftKey: true, bubbles: true, cancelable: true }))
    await tick()
    expect(root.querySelectorAll('.tbl td.sel, .tbl th.sel, td.sel').length).toBe(2)
    await click(button('merge'))
    const merged = page!.mirror!.text
    expect(merged).toContain('.2+|c')
    await click(button('split'))
    expect(page!.mirror!.text).not.toContain('2+|')
    undoTo(merged)
    expect(page!.mirror!.text).toBe(merged)
    undoTo(original)
    expect(page!.mirror!.text).toBe(original)
  })
})

describe('«+» in a cell of a table', () => {
  const plus = (): HTMLButtonElement => root.querySelector<HTMLButtonElement>('.tl-main [data-cmd="insert"]')!
  const list = (): HTMLElement | null => root.querySelector<HTMLElement>('.leave:not(.is-leaving) .blocklist')
  const rect = (bottom: number): DOMRect => ({ left: 0, top: 0, width: 400, right: 400, bottom, height: bottom, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect

  it('the list opens under the row «Таблица» and leaves every button of it in place; «Код» goes in after the table and the cell stays', async () => {
    open('|===\n|Ячейка\n|===\n')
    await inCell('Ячейка')
    const capsule = root.querySelector<HTMLElement>('.isle-tools')!
    // the capsule with the row of the table is 84 px high, the plus sits in its first row
    capsule.getBoundingClientRect = () => rect(84)
    plus().getBoundingClientRect = () => rect(40)
    const buttons = [...panel()!.querySelectorAll('button')]
    expect(buttons).toHaveLength(10)
    await click(plus())
    const menu = list()!
    expect(menu).not.toBeNull()
    expect(panel()).not.toBeNull()
    expect([...panel()!.querySelectorAll('button')]).toEqual(buttons)
    expect(buttons.some((b) => b.disabled)).toBe(false)
    expect(menu.closest('.isle-tools')).toBeNull()
    expect(Number.parseFloat(menu.style.top)).toBeGreaterThanOrEqual(84)
    const before = page!.mirror!.text
    await click(menu.querySelector('[data-block="code"]')!)
    expect(list()).toBeNull()
    const after = page!.mirror!.text
    expect(after.startsWith(before.trimEnd())).toBe(true)
    expect(after.indexOf('----')).toBeGreaterThan(after.indexOf('|==='))
    expect(after.slice(0, after.lastIndexOf('|===') + 4)).toBe(before.trimEnd())
  })

  it('«+» closes the row «Заливка ячейки ⌄» and only one of the two is open', async () => {
    open('|===\n|Ячейка\n|===\n')
    await inCell('Ячейка')
    await click(button('cell-fill'))
    expect(root.querySelector('.tl-colors')).not.toBeNull()
    await click(plus())
    await tick(300)
    expect(list()).not.toBeNull()
    expect(root.querySelector('.tl-colors')).toBeNull()
    await click(button('cell-fill'))
    await tick(300)
    expect(list()).toBeNull()
    expect(root.querySelector('.tl-colors')).not.toBeNull()
  })
})

describe('refusals of tables in the tab', () => {
  it('tells in Russian that the last row stays, and the file does not change', async () => {
    open('|===\n|a\n|===\n')
    await inCell('a')
    await click(button('row-del'))
    expect(notice()).toBe('Последний ряд таблицы остаётся. Чтобы убрать таблицу, нажмите «Удалить таблицу».')
    expect(edits()).toEqual([])
    await click(button('col-del'))
    expect(notice()).toBe('Последняя колонка таблицы остаётся. Чтобы убрать таблицу, нажмите «Удалить таблицу».')
    await click(button('split'))
    expect(notice()).toBe('Разделить можно только объединённую ячейку.')
    await click(button('merge'))
    expect(notice()).toBe('Выделите две или больше соседних ячеек: щёлкните первую и Shift+щёлкните последнюю.')
    expect(page!.mirror!.text).toBe('|===\n|a\n|===\n')
  })

  it('tells that tables go four levels deep at most, and no step of the history is made', async () => {
    open(NESTED)
    await inCell('х')
    await click(button('nest'))
    expect(notice()).toBe('Таблицы вкладываются не глубже четырёх уровней.')
    expect(edits()).toEqual([])
    expect(page!.mirror!.text).toBe(NESTED)
  })

  it('tells that a cell has a table already', async () => {
    open(NESTED)
    await inCell('Внутри ячейки первого уровня:')
    await click(button('nest'))
    expect(notice()).toBe('В этой ячейке уже есть таблица.')
    expect(page!.mirror!.text).toBe(NESTED)
  })

  it('is in English with the language of the tab', async () => {
    open(NESTED, 'en')
    await inCell('х')
    expect(panel()!.getAttribute('aria-label')).toBe('Table')
    expect(button('nest').getAttribute('aria-label')).toBe('Put a table in this cell')
    expect(button('nest').hasAttribute('title')).toBe(false)
    expect(button('table-del').getAttribute('aria-label')).toBe('Delete the nested table')
    await click(button('nest'))
    expect(notice()).toBe('Tables are nested four levels deep at most.')
  })
})

/** Lays the table out as a grid for jsdom: columns 100 px wide, rows 30 px high, the frame at (100, 50). */
function layTable(): () => void {
  const proto = HTMLElement.prototype
  const orig = proto.getBoundingClientRect
  const box = (left: number, top: number, w: number, h: number): DOMRect =>
    ({ left, top, right: left + w, bottom: top + h, width: w, height: h, x: left, y: top, toJSON() {} }) as DOMRect
  proto.getBoundingClientRect = function (this: Element): DOMRect {
    const tbl = this.closest('.tbl')
    if (!tbl) return box(0, 0, 0, 0)
    const rows = tbl.querySelectorAll(':scope > .tbl-scroll > table > tbody > tr').length
    const cols = tbl.querySelector(':scope > .tbl-scroll > table > colgroup')?.children.length ?? 0
    if (this === tbl) return box(100, 30, cols * 100 + 2, rows * 30 + 22)
    if (this.classList.contains('tbl-scroll')) return box(100, 50, cols * 100 + 2, rows * 30 + 2)
    if (this.tagName === 'TR') return box(101, 51 + [...this.parentElement!.children].indexOf(this) * 30, cols * 100, 30)
    if (this.tagName === 'TD' || this.tagName === 'TH') {
      const tr = this.parentElement!
      let k = 0
      for (const td of Array.from(tr.children)) {
        if (td === this) break
        k += Number(td.getAttribute('colspan') ?? 1)
      }
      return box(101 + k * 100, 51 + [...tr.parentElement!.children].indexOf(tr) * 30, Number(this.getAttribute('colspan') ?? 1) * 100, 30)
    }
    return box(0, 0, 0, 0)
  }
  return () => void (proto.getBoundingClientRect = orig)
}

describe('a grip of a column in a table with a cell merged over all the columns', () => {
  const TEXT = '|===\n3+|a\n|b |c |d\n|===\n'
  for (const [locale, said] of [
    ['ru', 'Колонку нельзя выделить отдельно: в таблице есть ячейка, объединённая на всю её ширину. Сначала разделите её.'],
    ['en', 'The column cannot be selected alone: a cell of the table is merged over its whole width. Split it first.'],
  ] as const)
    it(`tells in the language of the tab (${locale}); nothing is selected, the file does not change`, async () => {
      const unlay = layTable()
      try {
        open(TEXT, locale)
        document.dispatchEvent(new MouseEvent('mousemove', { clientX: 150, clientY: 70, bubbles: true }))
        await tick(100)
        const grip = root.querySelectorAll<HTMLElement>('.nota-grips .cg')[1]
        expect(grip).toBeDefined()
        grip!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }))
        await tick()
        expect(notice()).toBe(said)
        expect(root.querySelector('[aria-selected="true"]')).toBeNull()
        expect(edits()).toEqual([])
        expect(page!.mirror!.text).toBe(TEXT)
      } finally {
        unlay()
      }
    })
})

describe('keys in a table in the tab', () => {
  it('Tab goes to the next cell, and in the last one adds a row; one Cmd+Z takes the row back', async () => {
    open('|===\n|a |b\n|c |d\n|===\n')
    await inCell('c')
    const original = page!.mirror!.text
    const tab = (shift = false): boolean => {
      const ev = new KeyboardEvent('keydown', { code: 'Tab', key: 'Tab', shiftKey: shift, bubbles: true, cancelable: true })
      page!.editor!.view.dom.dispatchEvent(ev)
      return ev.defaultPrevented
    }
    expect(tab()).toBe(true)
    expect(page!.editor!.view.state.selection.$from.parent.textContent).toBe('d')
    expect(tab()).toBe(true)
    expect(page!.mirror!.text).not.toBe(original)
    expect(page!.editor!.view.state.selection.$from.parent.textContent).toBe('')
    await tick(600)
    const sentBefore = edits().length
    expect(root.querySelectorAll('tr').length).toBe(3)
    undoTo(original)
    expect(page!.mirror!.text).toBe(original)
    // (the editor took the undo: the row is gone from the grid, and nothing was sent back to the host)
    expect(root.querySelectorAll('tr').length).toBe(2)
    await tick(600)
    expect(edits().length).toBe(sentBefore)
  })

  it('typing in a cell changes that cell only, in one edit; Cmd+Z takes the word back', async () => {
    open(TABLES)
    await inCell('Личный кабинет клиента')
    const original = page!.mirror!.text
    const view = page!.editor!.view
    view.dispatch(view.state.tr.insertText(' и сайт'))
    await tick(600)
    acked()
    expect(edits().length).toBe(1)
    expect(page!.mirror!.text).toBe(original.replace('|Личный кабинет клиента', '|Личный кабинет клиента и сайт'))
    const sentBefore = edits().length
    undoTo(original)
    expect(page!.mirror!.text).toBe(original)
    expect(root.textContent).not.toContain('и сайт')
    await tick(600)
    expect(edits().length).toBe(sentBefore)
  })
})
