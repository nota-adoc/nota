// the handle of a block, its menu, the fields of the caption and of the anchor, the dragging.
import { BlockHandle, messages } from '@nota-adoc/react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { open, setupCleanup } from './helpers.js'

setupCleanup()

const TEXT = '= T\n\nFirst paragraph with <<lim>>.\n\n[[a]]\n== Sec\n\nInside.\n\n----\ncode\n----\n\nLast paragraph.\n'

type Setup = ReturnType<typeof open>

function mount(s: Setup, locale: 'ru' | 'en' = 'ru', extra: { disabled?: boolean; refused?: () => void } = {}) {
  const scroller = document.createElement('div')
  document.body.append(scroller)
  let last: { code: string; text: string } | null = null
  const before = s.rejects.length
  const rect = (top: number) => ({ top, bottom: top + 20, left: 60, right: 300 })
  vi.spyOn(s.editor, 'blockAt').mockImplementation((_x, y) => {
    const o = (m: string): number => s.session.text.indexOf(m)
    const pick = (offset: number, top: number) => s.editor.blockAtOffset(offset) && { ...s.editor.blockAtOffset(offset)!, rect: rect(top) }
    return y < 100 ? pick(o('First'), 20) : y < 200 ? pick(o('[[a]]'), 120) : y < 300 ? pick(o('----'), 220) : pick(o('Last'), 320)
  })
  const view = render(
    <BlockHandle
      editor={s.editor}
      locale={locale}
      container={document.body}
      scroller={scroller}
      disabled={extra.disabled ?? false}
      attempt={(command) => {
        const ok = command()
        last = ok ? null : (s.rejects.at(-1) ? { code: s.rejects.at(-1)!.code, text: s.rejects.at(-1)!.message } : null)
        void before
        return { ok, reject: last }
      }}
      {...(extra.refused ? { onMoveRefused: extra.refused } : {})}
    />,
  )
  const hover = (y: number): void => {
    act(() => {
      fireEvent.mouseMove(scroller, { clientX: 100, clientY: y })
    })
  }
  return { view, scroller, hover }
}

const handle = (locale: 'ru' | 'en' = 'ru'): HTMLElement => screen.getByRole('button', { name: messages[locale].blockHandle.tip })

describe('the handle of a block', () => {
  it('stands 8 px left of the block and stays when the mouse crosses the gap', () => {
    const s = open(TEXT)
    const m = mount(s)
    m.hover(50)
    expect(handle().style.left).toBe('28px') // rect.left 60 - 24 (the handle) - 8 (the gap)
    expect(handle().style.top).toBe('21px')
    const spy = vi.mocked(s.editor.blockAt)
    act(() => {
      fireEvent.mouseMove(m.scroller, { clientX: 54, clientY: 50 })
    })
    // the x in the gap is pressed to the edge of view.dom (jsdom: left 0, so 4), not passed as 54
    expect(spy.mock.calls.at(-1)![0]).toBe(4)
    expect(handle().style.left).toBe('28px')
  })

  it('appears over the block under the mouse with the hint, and goes with the mouse', () => {
    const s = open(TEXT)
    const m = mount(s)
    expect(screen.queryByRole('button', { name: 'Подпись, якорь, удаление блока' })).toBeNull()
    m.hover(50)
    expect(handle().getAttribute('title')).toBe('Подпись, якорь, удаление блока')
    act(() => {
      fireEvent.mouseLeave(m.scroller)
    })
    expect(screen.queryByRole('button', { name: 'Подпись, якорь, удаление блока' })).toBeNull()
  })

  it('has no handle in the mode of the source', () => {
    const s = open(TEXT)
    const m = mount(s, 'ru', { disabled: true })
    m.hover(50)
    expect(screen.queryByRole('button', { name: 'Подпись, якорь, удаление блока' })).toBeNull()
  })

  it('opens a menu by block: paragraph, heading, code; arrows walk, Esc gives the focus back', () => {
    const s = open(TEXT)
    const m = mount(s)
    const items = (): string[] => screen.getAllByRole('menuitem').map((b) => b.textContent ?? '')
    m.hover(50)
    fireEvent.mouseDown(handle(), { button: 0, clientX: 40, clientY: 20 })
    fireEvent.mouseUp(document, { clientX: 40, clientY: 20 })
    expect(screen.getByRole('menu', { name: 'Действия с блоком' })).toBeTruthy()
    expect(items()).toEqual(['Подпись…', 'Якорь…', 'Удалить блок'])
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' })
    expect(screen.getAllByRole('menuitem')[1]!.getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowUp' })
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowUp' })
    expect(screen.getAllByRole('menuitem')[2]!.getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(handle())
    // a heading: no caption, «Удалить раздел»
    act(() => {
      fireEvent.mouseLeave(m.scroller)
    })
    fireEvent.mouseDown(document.body)
    m.hover(150)
    fireEvent.mouseDown(handle(), { button: 0, clientX: 40, clientY: 120 })
    fireEvent.mouseUp(document, { clientX: 40, clientY: 120 })
    expect(items()).toEqual(['Якорь…', 'Удалить раздел'])
  })

  it('has the menu of an island (only delete) and of a collapsible block (the title of the block)', () => {
    const text = '= T\n\nPara.\n\n// a note\n\n.Why\n[%collapsible]\n====\nHidden.\n====\n'
    const s = open(text)
    const m = mount(s)
    const spy = vi.spyOn(s.editor, 'blockAt')
    const items = (): string[] => screen.getAllByRole('menuitem').map((b) => b.textContent ?? '')
    for (const [mark, want] of [
      ['// a note', ['Удалить блок']],
      ['.Why', ['Заголовок блока…', 'Якорь…', 'Удалить блок']],
    ] as const) {
      spy.mockImplementation(() => {
        const b = s.editor.blockAtOffset(text.indexOf(mark))
        return b && { ...b, rect: { top: 20, bottom: 40, left: 60, right: 300 } }
      })
      act(() => {
        fireEvent.mouseLeave(m.scroller)
      })
      fireEvent.mouseDown(document.body)
      m.hover(30)
      fireEvent.mouseDown(handle(), { button: 0, clientX: 40, clientY: 30 })
      fireEvent.mouseUp(document, { clientX: 40, clientY: 30 })
      expect(items()).toEqual(want)
      fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    }
  })

  it('writes the caption on Enter, an empty field takes it away, Esc writes nothing', () => {
    const s = open(TEXT)
    const m = mount(s)
    m.hover(50)
    const click = (name: string): void => {
      fireEvent.mouseDown(handle(), { button: 0, clientX: 40, clientY: 20 })
      fireEvent.mouseUp(document, { clientX: 40, clientY: 20 })
      fireEvent.click(screen.getByRole('menuitem', { name }))
    }
    click('Подпись…')
    const input = screen.getByRole('textbox', { name: 'Подпись блока' }) as HTMLInputElement
    expect(input.value).toBe('')
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(s.session.text).toBe(TEXT)
    click('Подпись…')
    const again = screen.getByRole('textbox', { name: 'Подпись блока' }) as HTMLInputElement
    fireEvent.change(again, { target: { value: 'Итоги' } })
    fireEvent.submit(screen.getByRole('dialog'))
    expect(s.session.text).toContain('.Итоги\nFirst paragraph')
    expect(screen.queryByRole('dialog')).toBeNull()
    m.hover(50)
    click('Подпись…')
    expect((screen.getByRole('textbox', { name: 'Подпись блока' }) as HTMLInputElement).value).toBe('Итоги')
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '' } })
    fireEvent.submit(screen.getByRole('dialog'))
    expect(s.session.text).toBe(TEXT)
  })

  it('keeps the anchor field open with the reason when the anchor is bad or taken', () => {
    const s = open(TEXT)
    const m = mount(s)
    m.hover(50)
    fireEvent.mouseDown(handle(), { button: 0, clientX: 40, clientY: 20 })
    fireEvent.mouseUp(document, { clientX: 40, clientY: 20 })
    fireEvent.click(screen.getByRole('menuitem', { name: 'Якорь…' }))
    const input = (): HTMLInputElement => screen.getByRole('textbox', { name: 'Якорь блока — на него можно сослаться' }) as HTMLInputElement
    fireEvent.change(input(), { target: { value: 'два слова' } })
    fireEvent.submit(screen.getByRole('dialog'))
    expect(screen.getByRole('alert').textContent).toBe('Якорь — одно слово: буквы, цифры, «-» и «_», без пробелов')
    expect(s.session.text).toBe(TEXT)
    fireEvent.change(input(), { target: { value: 'a' } })
    fireEvent.submit(screen.getByRole('dialog'))
    expect(screen.getByRole('alert').textContent).toBe('Такой якорь уже есть у другого блока')
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(s.session.text).toBe(TEXT)
    fireEvent.change(input(), { target: { value: 'lim' } })
    fireEvent.submit(screen.getByRole('dialog'))
    expect(s.session.text).toContain('[[lim]]\nFirst paragraph')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('deletes the block from the menu', () => {
    const s = open(TEXT)
    const m = mount(s)
    m.hover(250)
    fireEvent.mouseDown(handle(), { button: 0, clientX: 40, clientY: 220 })
    fireEvent.mouseUp(document, { clientX: 40, clientY: 220 })
    fireEvent.click(screen.getByRole('menuitem', { name: 'Удалить блок' }))
    expect(s.session.text).not.toContain('code')
    expect(s.session.text).toContain('Inside.\n\nLast paragraph.')
  })

  it('drags the handle to a place between blocks and writes one move; a bad place says so', () => {
    const s = open(TEXT)
    const refused = vi.fn()
    const m = mount(s, 'ru', { refused })
    const last = TEXT.indexOf('Last')
    vi.spyOn(s.editor, 'dropSlots').mockReturnValue([
      { to: TEXT.indexOf('First'), y: 10 },
      { to: TEXT.indexOf('Inside'), y: 150 },
    ])
    m.hover(350)
    fireEvent.mouseDown(handle(), { button: 0, clientX: 40, clientY: 320 })
    fireEvent.mouseMove(document, { clientX: 40, clientY: 150 })
    expect(document.querySelector('.blk-drop')).toBeTruthy()
    fireEvent.mouseUp(document, { clientX: 40, clientY: 150 })
    expect(document.querySelector('.blk-drop')).toBeNull()
    expect(s.session.text.indexOf('Last paragraph.')).toBeLessThan(s.session.text.indexOf('Inside.'))
    expect(s.session.text.indexOf('Last paragraph.')).toBeGreaterThan(s.session.text.indexOf('== Sec'))
    expect(refused).not.toHaveBeenCalled()
    s.session.undo()
    expect(s.session.text).toBe(TEXT)
    // into itself: nothing
    vi.spyOn(s.editor, 'dropSlots').mockReturnValue([{ to: last + 2, y: 320 }])
    m.hover(350)
    fireEvent.mouseDown(handle(), { button: 0, clientX: 40, clientY: 320 })
    fireEvent.mouseMove(document, { clientX: 40, clientY: 322 })
    fireEvent.mouseUp(document, { clientX: 40, clientY: 322 })
    expect(s.session.text).toBe(TEXT)
    // a place the engine refuses: the block does not move, the host is told
    vi.spyOn(s.editor, 'dropSlots').mockReturnValue([{ to: 99999, y: 150 }])
    m.hover(350)
    fireEvent.mouseDown(handle(), { button: 0, clientX: 40, clientY: 320 })
    fireEvent.mouseMove(document, { clientX: 40, clientY: 150 })
    fireEvent.mouseUp(document, { clientX: 40, clientY: 150 })
    expect(s.session.text).toBe(TEXT)
    expect(refused).toHaveBeenCalledTimes(1)
  })

  it('speaks English with the English labels', () => {
    const s = open(TEXT)
    const m = mount(s, 'en')
    m.hover(150)
    fireEvent.mouseDown(handle('en'), { button: 0, clientX: 40, clientY: 120 })
    fireEvent.mouseUp(document, { clientX: 40, clientY: 120 })
    expect(screen.getByRole('menu', { name: 'Block actions' })).toBeTruthy()
    expect(screen.getAllByRole('menuitem').map((b) => b.textContent)).toEqual(['Anchor…', 'Delete section'])
    expect(handle('en').getAttribute('title')).toBe('Caption, anchor, delete block')
  })
})
