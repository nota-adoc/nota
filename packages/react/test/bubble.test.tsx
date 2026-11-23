// the panel over the selection.
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BubbleMenu } from '@nota-adoc/react'
import { clearOf } from '../src/BubbleMenu.js'
import { CYRILLIC, open, select, setupCleanup } from './helpers.js'

setupCleanup()
beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

const noop = (): void => undefined

function bubble(s: ReturnType<typeof open>, extra: Partial<Parameters<typeof BubbleMenu>[0]> = {}) {
  s.editor.focus()
  const container = document.createElement('div')
  document.body.append(container)
  return render(<BubbleMenu editor={s.editor} locale="ru" container={container} onLink={noop} onColor={noop} {...extra} />)
}

const settle = (): void => void act(() => void vi.advanceTimersByTime(300))

describe('the panel over the selection', () => {
  it('shows after a selection within 0.3 s with the commands of the spec, and not at a cursor', () => {
    const s = open('one two three\n')
    bubble(s)
    expect(screen.queryByRole('toolbar')).toBeNull()
    act(() => select(s.editor, 0, 4, 7))
    settle()
    const bar = screen.getByRole('toolbar')
    expect([...bar.querySelectorAll('button')].map((b) => b.getAttribute('aria-label'))).toEqual([
      'Жирный', 'Курсив', 'Моноширинный', 'Зачёркнутый', 'Выделение', 'Цвет текста', 'Заливка', 'Ссылка',
    ])
    act(() => select(s.editor, 0, 4))
    settle()
    expect(screen.queryByRole('toolbar')).toBeNull()
  })

  it('does the same as the toolbar and shows the same state', () => {
    const s = open('one *two* three\n')
    bubble(s)
    act(() => select(s.editor, 0, 4, 7))
    settle()
    expect(screen.getByLabelText('Жирный').getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByLabelText('Курсив'))
    expect(s.session.text).toMatch(/^one (\*_two_\*|_\*two\*_) three\n$/)
  })

  it('Esc hides it and leaves the selection; the next Esc does nothing', () => {
    const s = open('one two three\n')
    bubble(s)
    act(() => select(s.editor, 0, 4, 7))
    settle()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('toolbar')).toBeNull()
    expect(s.editor.view.state.selection.empty).toBe(false)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('toolbar')).toBeNull()
    // a new selection shows it again
    act(() => select(s.editor, 0, 0, 3))
    settle()
    expect(screen.getByRole('toolbar')).toBeTruthy()
  })

  it('is not there on a plate, in the mode «Текст» and while the mouse drags', () => {
    const s = open('text\n\n----\ncode\n----\n= Title\n')
    const view = bubble(s)
    act(() => select(s.editor, 0, 0, 4))
    settle()
    expect(screen.getByRole('toolbar')).toBeTruthy()
    view.rerender(<BubbleMenu editor={s.editor} locale="ru" container={document.body} onLink={noop} onColor={noop} disabled />)
    expect(screen.queryByRole('toolbar')).toBeNull()
    view.rerender(<BubbleMenu editor={s.editor} locale="ru" container={document.body} onLink={noop} onColor={noop} />)
    settle()
    expect(screen.getByRole('toolbar')).toBeTruthy()
    s.editor.view.posAtCoords = () => null
    fireEvent.mouseDown(s.editor.view.dom)
    expect(screen.queryByRole('toolbar')).toBeNull()
    fireEvent.mouseUp(document)
    settle()
    expect(screen.getByRole('toolbar')).toBeTruthy()
  })

  it('in English has no Cyrillic', () => {
    const s = open('one two three\n')
    const { container } = bubble(s, { locale: 'en' })
    act(() => select(s.editor, 0, 4, 7))
    settle()
    expect(CYRILLIC.test(container.innerHTML)).toBe(false)
    expect(screen.getByLabelText('Text color')).toBeTruthy()
  })
})

describe('clearOf', () => {
  const rect = (left: number, top: number, right: number, bottom: number): DOMRect => ({ left, top, right, bottom, width: right - left, height: bottom - top, x: left, y: top, toJSON: () => ({}) }) as DOMRect
  const box = rect(0, 0, 800, 600)

  it('leaves the place alone when nothing is in the way', () => {
    expect(clearOf([rect(12, 300, 46, 345)], box, 300, 34, 100, 100)).toBe(100)
  })

  it('goes right of the strokes at the left edge (and 8 px from them)', () => {
    expect(clearOf([rect(12, 300, 46, 345)], box, 300, 34, 8, 290)).toBe(54)
  })

  it('goes left of an obstacle at the right edge', () => {
    expect(clearOf([rect(760, 300, 790, 345)], box, 300, 34, 500, 290)).toBe(452)
  })

  it('does not care for an obstacle at another height', () => {
    expect(clearOf([rect(12, 300, 46, 345)], box, 300, 34, 8, 100)).toBe(8)
  })

  it('says there is no place when the panel is as wide as the room between the obstacles', () => {
    expect(clearOf([rect(0, 0, 40, 100), rect(760, 0, 800, 100)], box, 730, 34, 50, 10)).toBeNull()
  })
})
