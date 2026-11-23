// the keys of the styles are written at the items of the lists.
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Dropdown } from '@nota-adoc/react'
import { slashItems } from '../src/blocks.js'
import { messages } from '../src/messages.js'
import { ariaKeys } from '../src/Tooltip.js'
import { setupCleanup } from './helpers.js'

setupCleanup()

describe('the keys at the items', () => {
  it('a drop-down item shows its keys dimmed and has aria-keyshortcuts; the first letters go by the label', () => {
    const onPick = vi.fn()
    const items = [
      { value: 'p', label: 'Текст', keys: '⌘⌥0' },
      { value: 'h2', label: 'Заголовок 2', keys: 'Ctrl+Alt+2' },
      { value: 'x', label: 'Без клавиш' },
    ]
    render(
      <Dropdown items={items} value="p" label="Стиль" onPick={onPick}>
        Текст
      </Dropdown>,
    )
    fireEvent.click(screen.getByRole('button', { name: /Текст/ }))
    const options = screen.getAllByRole('option')
    expect(options.map((o) => o.querySelector('.dd-keys')?.textContent ?? null)).toEqual(['⌘⌥0', 'Ctrl+Alt+2', null])
    expect(options.map((o) => o.getAttribute('aria-keyshortcuts'))).toEqual(['Meta+Alt+0', 'Control+Alt+2', null])
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'з' })
    expect(document.getElementById(screen.getByRole('listbox').getAttribute('aria-activedescendant')!)!.getAttribute('data-value')).toBe('h2')
    // the keys are not a part of what the search takes
    fireEvent.keyDown(screen.getByRole('listbox'), { key: '⌘' })
    expect(onPick).not.toHaveBeenCalled()
  })

  it('aria-keyshortcuts of a label of keys', () => {
    expect(ariaKeys('⌘⌥2')).toBe('Meta+Alt+2')
    expect(ariaKeys('Ctrl+Alt+3')).toBe('Control+Alt+3')
  })

  it('the menu of «/» has the keys of Heading 2 … Heading 6, on a Mac and elsewhere', () => {
    const t = messages.ru
    const keys = (mac: boolean): (string | undefined)[] => slashItems(t, mac).slice(0, 6).map((i) => i.keys)
    expect(keys(true)).toEqual(['⌘⌥2', '⌘⌥3', '⌘⌥4', '⌘⌥5', '⌘⌥6', undefined])
    expect(keys(false)).toEqual(['Ctrl+Alt+2', 'Ctrl+Alt+3', 'Ctrl+Alt+4', 'Ctrl+Alt+5', 'Ctrl+Alt+6', undefined])
  })
})
