// the one drop-down, its markup, keys and place.
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Dropdown } from '@nota-adoc/react'
import { setupCleanup } from './helpers.js'

setupCleanup()

const LANGS = ['Text', 'Bash', 'CSS', 'HTML', 'Java', 'JavaScript', 'JSON', 'Python', 'SQL', 'TypeScript', 'XML', 'YAML'].map((label) => ({
  value: label.toLowerCase(),
  label,
}))

function drop(extra: Partial<Parameters<typeof Dropdown>[0]> = {}) {
  const onPick = vi.fn()
  render(
    <div>
      <Dropdown items={LANGS} value="yaml" label="Язык" heading="Язык" cmd="language" onPick={onPick} {...extra}>
        YAML
      </Dropdown>
      <button data-testid="outside">out</button>
    </div>,
  )
  const button = screen.getByRole('button', { name: /YAML/ })
  return { onPick, button }
}
const key = (k: string): void => void fireEvent.keyDown(screen.getByRole('listbox'), { key: k })
const active = (): string => document.getElementById(screen.getByRole('listbox').getAttribute('aria-activedescendant')!)!.textContent!

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('the drop-down', () => {
  it('has the markup of the spec: a button with aria-haspopup and aria-expanded, a listbox with options', () => {
    const { button } = drop()
    expect(button.getAttribute('aria-haspopup')).toBe('listbox')
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('listbox')).toBeNull()
    fireEvent.click(button)
    expect(button.getAttribute('aria-expanded')).toBe('true')
    const list = screen.getByRole('listbox', { name: 'Язык' })
    const options = screen.getAllByRole('option')
    expect(options).toHaveLength(12)
    expect(options.filter((o) => o.getAttribute('aria-selected') === 'true').map((o) => o.textContent)).toEqual(['YAML'])
    expect(list.getAttribute('aria-activedescendant')).toBe(options[11]!.id)
    expect(list.textContent).toContain('Язык')
  })

  it('picks with the mouse and closes', () => {
    const { onPick, button } = drop()
    fireEvent.click(button)
    fireEvent.click(screen.getByRole('option', { name: 'Python' }))
    expect(onPick).toHaveBeenCalledWith('python')
    expect(button.getAttribute('aria-expanded')).toBe('false')
  })
})

describe('the keys of the drop-down', () => {
  it('↓ and ↑ move the active item, Home and End go to the ends, PageDown and PageUp move by 5 and stop at the ends', () => {
    const { button } = drop({ value: 'text' })
    fireEvent.click(button)
    expect(active()).toBe('Text')
    key('ArrowDown')
    expect(active()).toBe('Bash')
    key('ArrowUp')
    key('ArrowUp')
    expect(active()).toBe('Text')
    key('End')
    expect(active()).toBe('YAML')
    key('Home')
    expect(active()).toBe('Text')
    key('PageDown')
    expect(active()).toBe('JavaScript')
    key('PageDown')
    key('PageDown')
    expect(active()).toBe('YAML')
    key('PageUp')
    expect(active()).toBe('JSON')
  })

  it('the first letters choose an item and are forgotten after 0.6 s; the same letter again goes on', () => {
    const { button } = drop()
    fireEvent.click(button)
    key('j')
    expect(active()).toBe('Java')
    key('j')
    expect(active()).toBe('JavaScript')
    vi.advanceTimersByTime(700)
    key('s')
    expect(active()).toBe('SQL')
    vi.advanceTimersByTime(700)
    key('t')
    expect(active()).toBe('TypeScript')
    key('e')
    expect(active()).toBe('Text')
    key('y')
    expect(active()).toBe('Text')
    key('x')
    expect(active()).toBe('Text')
    vi.advanceTimersByTime(700)
    key('p')
    expect(active()).toBe('Python')
  })

  it('Enter and Space choose', () => {
    const { onPick, button } = drop()
    fireEvent.click(button)
    key('j')
    key('Enter')
    expect(onPick).toHaveBeenLastCalledWith('java')
    fireEvent.click(button)
    key('End')
    key(' ')
    expect(onPick).toHaveBeenLastCalledWith('yaml')
  })

  it('Esc closes with the focus on the button, and does not reach the document; Tab closes', () => {
    const { button } = drop()
    const seen = vi.fn()
    document.addEventListener('keydown', seen)
    fireEvent.click(button)
    key('Escape')
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(button)
    expect(seen).not.toHaveBeenCalled()
    document.removeEventListener('keydown', seen)
    fireEvent.click(button)
    key('Tab')
    expect(button.getAttribute('aria-expanded')).toBe('false')
  })

  it('a click outside closes it and picks nothing', () => {
    const { onPick, button } = drop()
    fireEvent.click(button)
    fireEvent.mouseDown(screen.getByTestId('outside'))
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(onPick).not.toHaveBeenCalled()
  })

  it('a word that is not in the list stands first as it is', () => {
    drop({ items: [{ value: 'rust', label: 'rust' }, ...LANGS], value: 'rust' })
    fireEvent.click(screen.getByRole('button', { name: /YAML/ }))
    expect(screen.getAllByRole('option')[0]!.textContent).toBe('rust')
    expect(screen.getAllByRole('option')[0]!.getAttribute('aria-selected')).toBe('true')
  })

  it('opens down; at the right edge of the tab it aligns to the right edge of the button; above the button with flip when there is no room', () => {
    const { button } = drop({ flip: true })
    const wrap = button.parentElement!
    vi.spyOn(wrap, 'getBoundingClientRect').mockReturnValue({ left: 700, right: 760, top: 560, bottom: 590, width: 60, height: 30, x: 700, y: 560, toJSON: () => ({}) })
    Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: 800 })
    Object.defineProperty(document.documentElement, 'clientHeight', { configurable: true, value: 600 })
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(160)
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(200)
    act(() => void fireEvent.click(button))
    const list = screen.getByRole('listbox')
    expect(list.classList.contains('dd-right')).toBe(true)
    expect(list.classList.contains('dd-up')).toBe(true)
    vi.restoreAllMocks()
  })

  it('without flip it never opens up', () => {
    const { button } = drop()
    vi.spyOn(button.parentElement!, 'getBoundingClientRect').mockReturnValue({ left: 10, right: 70, top: 560, bottom: 590, width: 60, height: 30, x: 10, y: 560, toJSON: () => ({}) })
    Object.defineProperty(document.documentElement, 'clientHeight', { configurable: true, value: 600 })
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(200)
    fireEvent.click(button)
    expect(screen.getByRole('listbox').classList.contains('dd-up')).toBe(false)
    vi.restoreAllMocks()
  })
})

describe('the list of a block that went out of sight', () => {
  it('is closed when the place of the button goes away, and the keys no longer pick', () => {
    const onPick = vi.fn()
    const view = (away: boolean) => (
      <Dropdown items={LANGS} value="yaml" label="Язык" onPick={onPick} away={away}>
        YAML
      </Dropdown>
    )
    const { rerender } = render(view(false))
    const button = screen.getByRole('button', { name: /YAML/ })
    fireEvent.click(button)
    expect(button.getAttribute('aria-expanded')).toBe('true')
    rerender(view(true))
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(screen.getByRole('listbox', { hidden: true }).getAttribute('aria-hidden')).toBe('true')
    fireEvent.keyDown(screen.getByRole('listbox', { hidden: true }), { key: 'Enter' })
    expect(onPick).not.toHaveBeenCalled()
    expect(button.getAttribute('aria-expanded')).toBe('false')
    // (back in sight: it does not open by itself)
    rerender(view(false))
    expect(button.getAttribute('aria-expanded')).toBe('false')
  })
})

describe('the frame of the item under the keys', () => {
  it('a list opened by the mouse has no .kb; a key makes it, the mouse takes it away', () => {
    const { button } = drop()
    fireEvent.click(button, { detail: 1 })
    const list = screen.getByRole('listbox')
    expect(list.classList.contains('kb')).toBe(false)
    key('ArrowUp')
    expect(list.classList.contains('kb')).toBe(true)
    fireEvent.mouseMove(screen.getAllByRole('option')[0]!)
    expect(list.classList.contains('kb')).toBe(false)
  })

  it('a list opened with the keys (Enter on the button, detail 0) has .kb at once', () => {
    const { button } = drop()
    fireEvent.click(button, { detail: 0 })
    expect(screen.getByRole('listbox').classList.contains('kb')).toBe(true)
  })
})

describe('the note of an item', () => {
  it('is shown after the label, given as aria-description, and an item without it stays as before', () => {
    const { button } = drop({
      items: [
        { value: 'a', label: 'Один', keys: '⌘1' },
        { value: 'b', label: 'Два', keys: '⌘2', note: 'пропускает уровень' },
      ],
      value: 'a',
    })
    fireEvent.click(button)
    const [a, b] = screen.getAllByRole('option')
    expect(a!.getAttribute('aria-description')).toBeNull()
    expect(a!.querySelector('.dd-note')).toBeNull()
    expect(b!.getAttribute('aria-description')).toBe('пропускает уровень')
    expect(b!.querySelector('.dd-note')!.getAttribute('aria-hidden')).toBe('true')
    expect(b!.getAttribute('aria-keyshortcuts')).not.toBeNull()
    expect(b!.querySelector('.dd-keys')!.textContent).toBe('⌘2')
  })
})
