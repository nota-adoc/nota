// the field of a link on three tabs.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { type FileList, LinkPopover, type SectionItem } from '@nota-adoc/react'
import { CYRILLIC, setupCleanup } from './helpers.js'

setupCleanup()

const SECTIONS: SectionItem[] = [
  { id: 'first', title: 'Первый', level: 0 },
  { id: 'second', title: 'Второй', level: 1 },
  { id: 'third', title: 'Третий', level: 0 },
]
const FILES = ['../docs/a.adoc', 'b.adoc', 'notes/c.asciidoc']

function field(options: { current?: string | null; locale?: 'ru' | 'en'; apply?: (t: string) => true | string; files?: (q: string) => FileList } = {}) {
  const onApply = vi.fn(options.apply ?? (() => true as const))
  const onRemove = vi.fn()
  const onClose = vi.fn()
  const listFiles = vi.fn(
    options.files ??
      ((q: string): FileList => {
        const items = FILES.filter((f) => f.includes(q))
        return { items: items.slice(0, 2), more: Math.max(0, items.length - 2) }
      }),
  )
  const container = document.createElement('div')
  document.body.append(container)
  const view = render(
    <LinkPopover
      locale={options.locale ?? 'ru'}
      anchor={null}
      container={container}
      current={options.current ?? null}
      listSections={() => SECTIONS}
      listFiles={listFiles}
      onApply={onApply}
      onRemove={onRemove}
      onClose={onClose}
    />,
  )
  return { onApply, onRemove, onClose, listFiles, view }
}

describe('the field of a link', () => {
  it('has the switch of three tabs', () => {
    field()
    const group = screen.getByRole('radiogroup')
    expect([...group.querySelectorAll('[role=radio]')].map((b) => b.textContent)).toEqual(['Адрес', 'Раздел документа', 'Другой файл'])
  })

  it('puts the address on Enter', () => {
    const { onApply } = field()
    const input = screen.getByLabelText('Адрес ссылки') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'https://example.org/a' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onApply).toHaveBeenCalledWith('https://example.org/a')
  })

  it('refuses an empty and a forbidden address under the field, and stays open', () => {
    const { onApply, onClose } = field()
    const input = screen.getByLabelText('Адрес ссылки') as HTMLInputElement
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.getByRole('alert').textContent).toBe('Введите адрес ссылки.')
    fireEvent.change(input, { target: { value: 'javascript:alert(1)' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.getByRole('alert').textContent).toBe('Этот адрес для ссылки не подходит.')
    expect(onApply).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('shows the message of the host when it refuses', () => {
    field({ apply: () => 'Нельзя.' })
    const input = screen.getByLabelText('Адрес ссылки')
    fireEvent.change(input, { target: { value: 'https://a.b' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.getByRole('alert').textContent).toBe('Нельзя.')
  })

  it('Esc closes it for the text', () => {
    const { onClose } = field()
    fireEvent.keyDown(screen.getByLabelText('Адрес ссылки'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledWith(true)
  })

  it('opens on the tab of the current link with its target and a button to remove it', () => {
    const { onRemove } = field({ current: 'https://x.y/z' })
    expect((screen.getByLabelText('Адрес ссылки') as HTMLInputElement).value).toBe('https://x.y/z')
    fireEvent.click(screen.getByText('Убрать ссылку'))
    expect(onRemove).toHaveBeenCalled()
  })

  it('has no remove button where there is no link', () => {
    field()
    expect(screen.queryByText('Убрать ссылку')).toBeNull()
  })

  it('lists the sections with their ids and puts the chosen one', () => {
    const { onApply } = field()
    fireEvent.click(screen.getByText('Раздел документа'))
    const options = screen.getAllByRole('option')
    expect(options.map((o) => o.textContent)).toEqual(['Первый#first', 'Второй#second', 'Третий#third'])
    expect(options[1]!.style.paddingLeft).not.toBe(options[0]!.style.paddingLeft)
    const box = screen.getByRole('listbox', { name: 'Разделы документа' })
    fireEvent.keyDown(box, { key: 'ArrowDown' })
    expect(screen.getAllByRole('option')[1]!.getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(onApply).toHaveBeenCalledWith('#second')
  })

  it('opens on the section of the current link', () => {
    field({ current: '#third' })
    expect(screen.getByRole('radio', { name: 'Раздел документа' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getAllByRole('option')[2]!.getAttribute('aria-selected')).toBe('true')
  })

  it('searches files, shows at most what the host gives with the line of the rest, and picks with arrows and Enter', async () => {
    const { onApply, listFiles } = field()
    fireEvent.click(screen.getByText('Другой файл'))
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(2))
    expect(screen.getByText('Ещё 1 — уточните поиск')).toBeTruthy()
    const search = screen.getByLabelText('Поиск файла')
    fireEvent.keyDown(search, { key: 'ArrowDown' })
    fireEvent.keyDown(search, { key: 'Enter' })
    expect(onApply).toHaveBeenCalledWith('b.adoc')
    fireEvent.change(search, { target: { value: 'notes' } })
    await waitFor(() => expect(listFiles).toHaveBeenLastCalledWith('notes'))
    await waitFor(() => expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['notes/c.asciidoc']))
  })

  it('opens on the file of the current link', async () => {
    field({ current: 'b.adoc' })
    await waitFor(() => expect(screen.getAllByRole('option')[1]?.getAttribute('aria-selected')).toBe('true'))
  })

  it('in English has no Cyrillic outside the document', async () => {
    const { view } = field({ locale: 'en', current: 'x.adoc' })
    await act(async () => undefined)
    for (const tab of ['URL', 'Section', 'Other file']) {
      fireEvent.click(screen.getByText(tab))
      await act(async () => undefined)
      const chrome = [...view.container.querySelectorAll('*')].filter((e) => !e.closest('[role=option]')).map((e) => [...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(''))
      expect(CYRILLIC.test(chrome.join(' '))).toBe(false)
      for (const el of view.container.querySelectorAll('[aria-label],[title],[placeholder]'))
        for (const a of ['aria-label', 'title', 'placeholder']) expect(CYRILLIC.test(el.getAttribute(a) ?? '')).toBe(false)
    }
  })
})
