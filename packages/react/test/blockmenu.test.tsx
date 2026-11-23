// the list of blocks the menu of «/» and the list of «+» share.
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { BlockMenu, InsertMenu, messages, slashItems } from '@nota-adoc/react'
import { setupCleanup } from './helpers.js'

setupCleanup()

describe('BlockMenu', () => {
  const items = slashItems(messages.ru)

  it('as a listbox: options with aria-selected, no title when bare, the focus stays where it was', () => {
    const onPick = vi.fn()
    render(<BlockMenu items={items} at={1} mode="listbox" className="x" title="Вставить блок" onPick={onPick} />)
    const options = screen.getAllByRole('option')
    expect(options).toHaveLength(14)
    expect(options[1]!.getAttribute('aria-selected')).toBe('true')
    expect(options[0]!.getAttribute('aria-selected')).toBe('false')
    fireEvent.click(options[8]!)
    expect(onPick).toHaveBeenCalledWith('table')
  })

  it('as a menu: menuitems named by the title of the block, the line as the description, one stop for Tab, nothing chosen when `showChosen` is off', () => {
    render(<BlockMenu items={items} at={-1} mode="menu" showChosen={false} className="x" title="Вставить блок" onPick={() => undefined} groupOf={(id) => (id === 'heading2' ? 0 : 1)} />)
    const menu = screen.getByRole('menu', { name: 'Вставить блок' })
    const entries = screen.getAllByRole('menuitem')
    expect(entries[0]!.getAttribute('aria-label')).toBe('Заголовок 2')
    expect(entries[0]!.getAttribute('aria-describedby')).toBe(entries[0]!.querySelector('.sm-hint')!.id)
    expect(entries.map((e) => e.tabIndex)).toEqual([0, ...Array(13).fill(-1)])
    expect(menu.querySelector('[data-on]')).toBeNull()
    expect(menu.querySelectorAll('[role=separator]')).toHaveLength(1)
  })

  it('an entry that is off is aria-disabled, shows its reason instead of its line and a press does nothing', () => {
    const onPick = vi.fn()
    render(<BlockMenu items={items} at={-1} mode="menu" className="x" title="Вставить блок" onPick={onPick} offOf={(id) => (id === 'heading2' ? 'причина' : undefined)} />)
    const entries = screen.getAllByRole('menuitem')
    expect(entries[0]!.getAttribute('aria-disabled')).toBe('true')
    expect(entries[0]!.querySelector('.sm-hint')!.textContent).toBe('причина')
    expect(entries[1]!.getAttribute('aria-disabled')).toBeNull()
    fireEvent.click(entries[0]!)
    expect(onPick).not.toHaveBeenCalled()
    fireEvent.click(entries[1]!)
    expect(onPick).toHaveBeenCalledWith('heading3')
  })

  it('InsertMenu takes its own entries and keeps the six of the demo without them', () => {
    const anchor = document.createElement('button')
    document.body.append(anchor)
    const { unmount } = render(<InsertMenu locale="ru" anchor={anchor} container={document.body} onPick={() => undefined} onClose={() => undefined} />)
    expect(screen.getAllByRole('menuitem')).toHaveLength(6)
    unmount()
    render(<InsertMenu locale="ru" anchor={anchor} container={document.body} items={items} onPick={() => undefined} onClose={() => undefined} />)
    expect(screen.getAllByRole('menuitem')).toHaveLength(14)
  })
})
