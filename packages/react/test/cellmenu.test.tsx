// the capsule of selected cells in jsdom (the place and the fold are measured in Chrome: `cellmenu-layout.test.ts`).
import { AlignRow, CellMenu } from '@nota-adoc/react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TextSelection } from 'prosemirror-state'
import { open, setupCleanup } from './helpers.js'

setupCleanup()
beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

const T = '|===\n|a1 |b1 |c1 |d1\n|a2 |b2 |c2 |d2\n|a3 |b3 |c3 |d3\n|a4 |b4 |c4 |d4\n|===\n'
type S = ReturnType<typeof open>

function menu(s: S, extra: Partial<Parameters<typeof CellMenu>[0]> = {}) {
  s.editor.focus()
  const container = document.createElement('div')
  document.body.append(container)
  return render(<CellMenu editor={s.editor} locale="ru" container={container} onRow={() => undefined} {...extra} />)
}
const settle = (): void => void act(() => void vi.advanceTimersByTime(300))
/** Click `a`, Shift+click `b`. */
function cells(s: S, a: string, b: string): void {
  const dom = s.editor.view.dom as HTMLElement
  let found = -1
  s.editor.view.state.doc.descendants((node, pos) => {
    if (found < 0 && node.type.name === 'cell_text' && node.textContent === a) found = pos + 1
    return found < 0
  })
  const { state } = s.editor.view
  act(() => s.editor.view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, found))))
  const td = [...dom.querySelectorAll('td, th')].find((x) => x.textContent === b)!
  act(() => void td.dispatchEvent(new MouseEvent('mousedown', { shiftKey: true, bubbles: true, cancelable: true })))
  act(() => void document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })))
  settle()
}
const names = (): (string | null)[] => [...screen.getByRole('toolbar').querySelectorAll('.bb-layer.bar > button')].map((b) => b.getAttribute('aria-label'))

describe('the capsule of selected cells', () => {
  it('is not there for a cursor, shows for two cells, with the group buttons and no title', () => {
    const s = open(T)
    menu(s)
    expect(screen.queryByRole('toolbar')).toBeNull()
    cells(s, 'b2', 'c3')
    const bar = screen.getByRole('toolbar', { name: 'Действия с ячейками' })
    expect(names()).toEqual(['Объединить ячейки', 'Выравнивание', 'Заливка ячеек', 'Очистить ячейки', 'Удалить ряды: 2', 'Удалить колонки: 2'])
    expect(bar.querySelectorAll('[title]').length).toBe(0)
    // «Объединить» is dimmed: there is text in the cells; the others are not
    expect(screen.getByLabelText('Объединить ячейки').getAttribute('aria-disabled')).toBe('true')
    expect(screen.getByLabelText('Очистить ячейки').getAttribute('aria-disabled')).toBeNull()
    expect(screen.getByLabelText('Выравнивание').getAttribute('aria-haspopup')).toBe('true')
    expect(screen.getByLabelText('Заливка ячеек').getAttribute('aria-haspopup')).toBe('dialog')
  })

  it('has «Шапка» only when the selection takes the first row, and «Разделить» only with a merged cell', () => {
    const s = open(T)
    menu(s)
    cells(s, 'b1', 'c1')
    expect(names()).toContain('Первый ряд — шапка')
    expect(names()).toContain('Удалить ряд')
    expect(names()).not.toContain('Разделить ячейки')
    expect(screen.getByLabelText('Первый ряд — шапка').getAttribute('aria-pressed')).toBe('false')
  })

  it('has «Разделить» when a merged cell is among them', () => {
    const m = open('|===\n|a |b |c\n2+|d |e\n|f |g |h\n|===\n')
    menu(m)
    cells(m, 'a', 'e')
    expect(names()).toContain('Разделить ячейки')
  })

  it('«Очистить» clears the cells and keeps the capsule; «Удалить ряды» deletes them and the capsule goes', () => {
    const s = open(T)
    menu(s)
    cells(s, 'b2', 'c3')
    fireEvent.click(screen.getByLabelText('Очистить ячейки'))
    settle()
    expect(s.session.text).toBe('|===\n|a1 |b1 |c1 |d1\n|a2 | | |d2\n|a3 | | |d3\n|a4 |b4 |c4 |d4\n|===\n')
    expect(screen.getByLabelText('Очистить ячейки').getAttribute('aria-disabled')).toBe('true')
    expect(screen.getByLabelText('Объединить ячейки').getAttribute('aria-disabled')).toBeNull()
    fireEvent.click(screen.getByLabelText('Удалить ряды: 2'))
    settle()
    expect(screen.queryByRole('toolbar')).toBeNull()
  })

  it('a dimmed button does nothing', () => {
    const s = open(T)
    menu(s)
    cells(s, 'b2', 'c3')
    const before = s.session.text
    fireEvent.click(screen.getByLabelText('Объединить ячейки'))
    expect(s.session.text).toBe(before)
  })

  it('«Выравнивание» and «Заливка ячеек» ask the caller to open their rows', () => {
    const s = open(T)
    const asked: string[] = []
    menu(s, { onRow: (k) => void asked.push(k) })
    cells(s, 'b2', 'c3')
    fireEvent.click(screen.getByLabelText('Выравнивание'))
    fireEvent.click(screen.getByLabelText('Заливка ячеек'))
    expect(asked).toEqual(['align', 'fill'])
  })

  it('Esc hides it and leaves the cells selected; the buttons are in the arrows', () => {
    const s = open(T)
    menu(s)
    cells(s, 'b2', 'c3')
    act(() => screen.getByLabelText('Объединить ячейки').focus())
    fireEvent.keyDown(screen.getByLabelText('Объединить ячейки'), { key: 'ArrowRight' })
    expect(document.activeElement).toBe(screen.getByLabelText('Выравнивание'))
    fireEvent.keyDown(screen.getByLabelText('Выравнивание'), { key: 'End' })
    expect(document.activeElement).toBe(screen.getByLabelText('Удалить колонки: 2'))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('toolbar')).toBeNull()
    expect(s.editor.tableAt()!.selection).not.toBeNull()
  })

  it('does not show with the blocks of «+» open (hidden)', () => {
    const s = open(T)
    menu(s, { hidden: true })
    cells(s, 'b2', 'c3')
    expect(screen.queryByRole('toolbar')).toBeNull()
  })
})

describe('the keys: Esc in the text, Tab, «⋯»', () => {
  const key = (el: Element, k: string): void => void act(() => void el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })))
  const stub = (): (() => void) => {
    const proto = HTMLElement.prototype
    const old = Object.getOwnPropertyDescriptor(proto, 'offsetWidth')
    Object.defineProperty(proto, 'offsetWidth', { configurable: true, get: () => 40 })
    return () => {
      if (old) Object.defineProperty(proto, 'offsetWidth', old)
      else delete (proto as unknown as Record<string, unknown>).offsetWidth
    }
  }
  const narrowMenu = (s: S): void => {
    s.editor.focus()
    const container = document.createElement('div')
    container.getBoundingClientRect = () => ({ width: 200, height: 400, top: 0, left: 0, right: 200, bottom: 400, x: 0, y: 0, toJSON: () => ({}) })
    document.body.append(container)
    render(<CellMenu editor={s.editor} locale="ru" container={container} onRow={() => undefined} />)
  }

  it('Esc in the text hides the capsule and keeps the cells, the second Esc lets them go', () => {
    const s = open(T)
    menu(s)
    cells(s, 'b2', 'c3')
    expect(screen.getByRole('toolbar')).toBeTruthy()
    expect(s.editor.cellCapsuleShown).toBe(true)
    key(s.editor.view.dom, 'Escape')
    expect(screen.queryByRole('toolbar')).toBeNull()
    expect(s.editor.tableAt()!.selection).not.toBeNull()
    expect(s.editor.cellCapsuleShown).toBe(false)
    key(s.editor.view.dom, 'Escape')
    expect(s.editor.tableAt()!.selection).toBeNull()
  })

  it('Tab leaves the capsule for the text, the cells stay selected', () => {
    const s = open(T)
    menu(s)
    cells(s, 'b2', 'c3')
    act(() => screen.getByLabelText('Выравнивание').focus())
    key(screen.getByLabelText('Выравнивание'), 'Tab')
    expect(s.editor.view.dom.contains(document.activeElement)).toBe(true)
    expect(s.editor.tableAt()!.selection).not.toBeNull()
  })

  it('«⋯» opened by ArrowDown puts the focus on the first item; Esc closes the list, the focus is on «⋯»; aria-expanded follows', () => {
    const undo = stub()
    try {
      const s = open(T)
      narrowMenu(s)
      cells(s, 'b2', 'c3')
      const more = screen.getByLabelText('Ещё действия с ячейками')
      expect(more.getAttribute('aria-expanded')).toBe('false')
      act(() => more.focus())
      key(more, 'ArrowDown')
      expect(more.getAttribute('aria-expanded')).toBe('true')
      const items = document.querySelectorAll('.cm-list [role="menuitem"]')
      expect(items.length).toBeGreaterThan(0)
      expect(document.activeElement).toBe(items[0])
      key(document.activeElement!, 'ArrowDown')
      expect(document.activeElement).toBe(items[Math.min(1, items.length - 1)])
      key(document.activeElement!, 'Escape')
      expect(document.querySelector('.cm-list')).toBeNull()
      expect(document.activeElement).toBe(more)
      expect(more.getAttribute('aria-expanded')).toBe('false')
    } finally {
      undo()
    }
  })

  it('«⋯» opened by Enter (a click without a mouse) puts the focus on the first item', () => {
    const undo = stub()
    try {
      const s = open(T)
      narrowMenu(s)
      cells(s, 'b2', 'c3')
      const more = screen.getByLabelText('Ещё действия с ячейками')
      act(() => more.focus())
      fireEvent.click(more, { detail: 0 })
      expect(document.activeElement).toBe(document.querySelector('.cm-list [role="menuitem"]'))
      key(document.activeElement!, 'Tab')
      expect(document.querySelector('.cm-list')).toBeNull()
      expect(s.editor.view.dom.contains(document.activeElement)).toBe(true)
    } finally {
      undo()
    }
  })
})

describe('the row of the alignment', () => {
  it('has three and three positions, the pressed ones, and the name of what is now; the positions work', () => {
    const picks: unknown[] = []
    render(<AlignRow locale="ru" halign="center" valign={null} onPick={(h, v) => picks.push([h, v])} onBack={() => undefined} />)
    expect(screen.getByLabelText('Слева').getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByLabelText('По центру').getAttribute('aria-pressed')).toBe('true')
    expect([...document.querySelectorAll('.al-b[aria-pressed="true"]')].length).toBe(1)
    expect(document.querySelector('.cr-name-t')!.textContent).toBe('По центру · разное')
    fireEvent.click(screen.getByLabelText('Снизу'))
    expect(picks).toEqual([[undefined, 'bottom']])
  })

  it('Esc and «‹» go back', () => {
    let back = 0
    render(<AlignRow locale="ru" halign={null} valign={null} onPick={() => undefined} onBack={() => void back++} />)
    expect(document.querySelector('.cr-name-t')!.textContent).toBe('Разное')
    fireEvent.click(screen.getByLabelText('Вернуть кнопки панели'))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(back).toBe(2)
  })
})

