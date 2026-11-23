// the windows of colour and fill.
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { ColorPopover } from '@nota-adoc/react'
import { parseCss, styleOf } from './cssrules.js'
import { CYRILLIC, setupCleanup } from './helpers.js'

setupCleanup()

function popover(kind: 'color' | 'fill', roles: string[] = [], locale: 'ru' | 'en' = 'ru') {
  const onPick = vi.fn()
  const onClose = vi.fn()
  const container = document.createElement('div')
  document.body.append(container)
  const view = render(<ColorPopover locale={locale} kind={kind} anchor={null} container={container} roles={roles} onPick={onPick} onClose={onClose} />)
  return { onPick, onClose, view }
}

describe('the window of colour', () => {
  it('has the swatches of the spec and the name of the chosen one', () => {
    popover('color', ['hl-red'])
    const dialog = screen.getByRole('dialog', { name: 'Цвет текста' })
    expect([...dialog.querySelectorAll('.sw-b')].map((b) => b.getAttribute('aria-label'))).toEqual(['Без цвета', 'Красный', 'Оранжевый', 'Зелёный', 'Бирюзовый', 'Синий', 'Фиолетовый', 'Розовый', 'Серый'])
    expect(screen.getByLabelText('Красный').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByLabelText('Без цвета').getAttribute('aria-pressed')).toBe('false')
    expect(dialog.querySelector('.fp-foot')!.textContent).toBe('Красный')
  })

  it('picks a role, and "no colour" is null', () => {
    const { onPick } = popover('color')
    fireEvent.click(screen.getByLabelText('Синий'))
    fireEvent.click(screen.getByLabelText('Без цвета'))
    expect(onPick.mock.calls).toEqual([['hl-blue'], [null]])
  })

  it('Esc and a click elsewhere close it without a pick', () => {
    const { onPick, onClose } = popover('color')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenLastCalledWith(true)
    fireEvent.mouseDown(document.body)
    expect(onClose).toHaveBeenLastCalledWith(false)
    expect(onPick).not.toHaveBeenCalled()
  })
})

describe('the window of fill', () => {
  it('has the swatches of the spec', () => {
    popover('fill', ['hl-red', 'hl-yellow-bg'])
    const dialog = screen.getByRole('dialog', { name: 'Заливка' })
    expect([...dialog.querySelectorAll('.sw-b')].map((b) => b.getAttribute('aria-label'))).toEqual([
      'Без заливки', 'Жёлтая', 'Красная', 'Оранжевая', 'Зелёная', 'Бирюзовая', 'Голубая', 'Розовая', 'Фиолетовая', 'Серая',
    ])
    expect(screen.getByLabelText('Жёлтая').getAttribute('aria-pressed')).toBe('true')
    expect(dialog.querySelector('.fp-foot')!.textContent).toBe('Жёлтая')
  })

  it('shows nine strips, each with its own --ap-hl variable, and English labels', () => {
    popover('fill', [], 'en')
    const dialog = screen.getByRole('dialog')
    const buttons = [...dialog.querySelectorAll('.sw-b')]
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual([
      'No fill', 'Yellow', 'Red', 'Orange', 'Green', 'Teal', 'Blue', 'Pink', 'Purple', 'Gray',
    ])
    const strips = [...dialog.querySelectorAll<HTMLElement>('.sw-b .sw-r')]
    const withColor = strips.filter((s) => s.style.background.includes('--ap-hl-'))
    expect(withColor.map((s) => /--ap-hl-([a-z]+)/.exec(s.style.background)?.[1]).sort()).toEqual(
      ['blue', 'gray', 'green', 'orange', 'pink', 'purple', 'red', 'teal', 'yellow'],
    )
  })

  it('in English has no Cyrillic', () => {
    for (const kind of ['color', 'fill'] as const) {
      const { view } = popover(kind, [], 'en')
      expect(CYRILLIC.test(view.container.innerHTML)).toBe(false)
      view.unmount()
    }
    popover('color', [], 'en')
    expect([...document.querySelectorAll('.sw-b')].map((b) => b.getAttribute('aria-label'))).toEqual(['No color', 'Red', 'Orange', 'Green', 'Teal', 'Blue', 'Purple', 'Pink', 'Gray'])
  })
})

describe('the window of the fill of cells', () => {
  function cellPopover(roles: string[], cells = { count: 1, mixed: false, span: '' }, locale: 'ru' | 'en' = 'ru') {
    const onPick = vi.fn()
    const onClose = vi.fn()
    const container = document.createElement('div')
    document.body.append(container)
    const view = render(
      <ColorPopover locale={locale} kind="cell" anchor={null} container={container} roles={roles} cells={cells} onPick={onPick} onClose={onClose} />,
    )
    return { onPick, onClose, view }
  }

  it('has the title «Заливка ячейки», the six swatches, the current one ringed and its name', () => {
    cellPopover(['cell-blue'])
    const dialog = screen.getByRole('dialog', { name: 'Заливка ячейки' })
    expect([...dialog.querySelectorAll('.sw-b')].map((b) => b.getAttribute('aria-label'))).toEqual([
      'Без заливки', 'Жёлтая', 'Зелёная', 'Голубая', 'Розовая', 'Фиолетовая', 'Серая',
    ])
    expect(screen.getByLabelText('Голубая').getAttribute('aria-pressed')).toBe('true')
    expect(dialog.querySelector('.fp-foot')!.textContent).toBe('Голубая')
  })

  it('a merged cell shows only the name, and «Без заливки» for a cell with no fill (no record, no `2+`)', () => {
    cellPopover(['cell-yellow'], { count: 1, mixed: false, span: '2+' })
    expect(document.querySelector('.fp-foot')!.textContent).toBe('Жёлтая')
    document.body.textContent = ''
    cellPopover([])
    expect(document.querySelector('.fp-foot')!.textContent).toBe('Без заливки')
    expect(screen.getByLabelText('Без заливки').getAttribute('aria-pressed')).toBe('true')
  })

  it('says how many cells, and with different fills nothing is ringed', () => {
    cellPopover([], { count: 3, mixed: true, span: '' })
    expect(screen.getByRole('dialog', { name: 'Заливка ячеек: 3' })).toBeTruthy()
    expect([...document.querySelectorAll('.sw-b')].map((b) => b.getAttribute('aria-pressed'))).toEqual(Array(7).fill('false'))
    expect(document.querySelector('.fp-foot')!.textContent).toBe('Разная')
  })

  it('picks a role of a cell', () => {
    const { onPick } = cellPopover([])
    fireEvent.click(screen.getByLabelText('Розовая'))
    expect(onPick).toHaveBeenCalledWith('cell-pink')
  })

  it('is in English without Cyrillic', () => {
    const { view } = cellPopover(['cell-blue'], { count: 1, mixed: false, span: '' }, 'en')
    expect(CYRILLIC.test(view.container.innerHTML)).toBe(false)
  })
})

describe('the keys of the windows of colour', () => {
  it('←, →, ↑, ↓, Home and End move the ring, Enter picks it', () => {
    const { onPick } = popover('color', ['hl-blue'])
    const press = (key: string): void => void fireEvent.keyDown(document, { key })
    press('Home')
    press('Enter')
    expect(onPick).toHaveBeenLastCalledWith(null)
    press('End')
    press('Enter')
    expect(onPick).toHaveBeenLastCalledWith('hl-gray')
    press('ArrowLeft')
    press('Enter')
    expect(onPick).toHaveBeenLastCalledWith('hl-pink')
    press('ArrowRight')
    press('ArrowDown')
    press('Enter')
    expect(onPick).toHaveBeenLastCalledWith('hl-gray')
    press('ArrowUp')
    press('Enter')
    expect(onPick).toHaveBeenLastCalledWith('hl-pink')
  })

  it('has 9 swatches, each with its own stripe colour', () => {
    popover('color')
    const bars = [...document.querySelectorAll<HTMLElement>('.sw-b .sw-r')].map((e) => e.getAttribute('style'))
    expect(bars).toHaveLength(8)
    for (const c of ['orange', 'purple', 'pink', 'teal']) expect(bars.join()).toContain(`--ap-tx-${c}`)
  })

  it('the new swatches carry their name as the label and as the title of the window (the demo shows the name as before)', () => {
    popover('color')
    for (const [role, name] of [['hl-orange', 'Оранжевый'], ['hl-purple', 'Фиолетовый'], ['hl-pink', 'Розовый'], ['hl-teal', 'Бирюзовый']]) {
      const b = document.querySelector<HTMLElement>(`.sw-b[data-role="${role}"]`)!
      expect(b.getAttribute('aria-label'), role).toBe(name)
      expect(b.getAttribute('title'), role).toBe(name)
      expect(b.querySelector('.sw-tip'), role).toBeNull()
    }
  })

  it('English names of the new swatches', () => {
    popover('color', [], 'en')
    expect([...document.querySelectorAll('.sw-b')].map((b) => b.getAttribute('aria-label'))).toEqual([
      'No color', 'Red', 'Orange', 'Green', 'Teal', 'Blue', 'Purple', 'Pink', 'Gray',
    ])
  })

  it('a role not in the registry: no swatch is pressed, the foot is empty', () => {
    popover('color', ['hl-cyan'])
    expect([...document.querySelectorAll('.sw-b')].map((b) => b.getAttribute('aria-pressed'))).toEqual(Array(9).fill('false'))
    expect(document.querySelector('.fp-foot')!.textContent).toBe('')
  })

  it('a fill role does not count as foreign: «Без цвета» stays pressed', () => {
    popover('color', ['hl-yellow-bg'])
    expect(screen.getByLabelText('Без цвета').getAttribute('aria-pressed')).toBe('true')
  })

  it('starts on the current swatch', () => {
    const { onPick } = popover('color', ['hl-blue'])
    fireEvent.keyDown(document, { key: 'Enter' })
    expect(onPick).toHaveBeenLastCalledWith('hl-blue')
  })
})

describe('one ring, the foot, the popup', () => {
  const rules = parseCss(readFileSync(join(import.meta.dirname, '../src/style.css'), 'utf8'))

  it('the window opened by the mouse has no focus class; by the keyboard or an arrow it has', () => {
    popover('color', ['hl-red'])
    const dialog = screen.getByRole('dialog')
    expect(dialog.classList.contains('kb')).toBe(false)
    fireEvent.keyDown(document, { key: 'ArrowRight' })
    expect(dialog.classList.contains('kb')).toBe(true)
  })

  it('opened by the keyboard (the property) the focus class is there at once; the mouse over a swatch takes it off', () => {
    const container = document.createElement('div')
    document.body.append(container)
    render(<ColorPopover locale="ru" kind="color" anchor={null} container={container} roles={['hl-red']} keyboard onPick={vi.fn()} onClose={vi.fn()} />)
    const dialog = screen.getByRole('dialog')
    expect(dialog.classList.contains('kb')).toBe(true)
    fireEvent.mouseMove(screen.getByLabelText('Синий'))
    expect(dialog.classList.contains('kb')).toBe(false)
  })

  it('the focus ring is drawn only with .kb (the window and the row of colours), never for every .is-active or :focus-visible; on a pressed swatch it stands off the ring', () => {
    expect(rules.some((r) => r.selectors.includes('.sw-b.is-active'))).toBe(false)
    expect(rules.some((r) => r.selectors.some((x) => x.includes('.sw-b:focus-visible')))).toBe(false)
    expect(styleOf(rules, '.sw-b').get('outline')).toBe('none')
    expect(styleOf(rules, '.kb .sw-b.is-active').get('outline')).toMatch(/^2px solid/)
    // the ring «chosen» is the border + 1 px; the focus ring must not touch it
    const off = parseFloat(styleOf(rules, '.kb .sw-b.is-active[aria-pressed="true"]').get('outline-offset') ?? '0')
    expect(off).toBeGreaterThanOrEqual(3)
  })

  it('the window without a row shows only the name of the current colour, or «Без цвета»; no record, no «В тексте»', () => {
    popover('color', ['hl-red'])
    expect(document.querySelector('.fp-src')!.textContent).toBe('Красный')
    expect(document.querySelector('.fp-code')).toBeNull()
    cleanup()
    popover('color')
    expect(document.querySelector('.fp-src')!.textContent).toBe('Без цвета')
    expect(document.body.textContent).not.toMatch(/В тексте|Без цвета и заливки|\[\./)
  })

  it('the foot of the window of cells is the name: «Голубая», «Без заливки», «Разная»', () => {
    const cells = (roles: string[], c: { count: number; mixed: boolean; span: string }) => {
      const container = document.createElement('div')
      document.body.append(container)
      return render(<ColorPopover locale="ru" kind="cell" anchor={null} container={container} roles={roles} cells={c} onPick={vi.fn()} onClose={vi.fn()} />)
    }
    const one = cells(['cell-blue'], { count: 1, mixed: false, span: '' })
    expect(document.querySelector('.fp-src')!.textContent).toBe('Голубая')
    one.unmount()
    const none = cells([], { count: 1, mixed: false, span: '' })
    expect(document.querySelector('.fp-src')!.textContent).toBe('Без заливки')
    none.unmount()
    cells(['cell-blue'], { count: 3, mixed: true, span: '' })
    expect(document.querySelector('.fp-src')!.textContent).toBe('Разная')
  })

  it('the demo (the style sheet of the package) gets no popup of the name and no look of the plugin', () => {
    for (const r of rules) for (const sel of r.selectors) expect(sel).not.toMatch(/\.sw-tip|\.cr\b|\.sw-b:first-child|\.sw-b:last-child/)
    // the row of swatches keeps its wrapping in the package; the single row is the look of the plugin
    expect(styleOf(rules, '.fp-row').get('flex-wrap')).toBe('wrap')
    expect(styleOf(rules, '.pop').get('border-radius') ?? '10px').toBe('10px')
  })
})

describe('the colours in a row in place of the row they were opened from', () => {
  function row(kind: 'color' | 'fill' | 'cell', back: 'table' | 'bar', roles: string[] = [], extra: { keyboard?: boolean; cells?: { count: number; mixed: boolean; span: string } } = {}) {
    const onPick = vi.fn()
    const onClose = vi.fn()
    const onBack = vi.fn()
    const container = document.createElement('div')
    document.body.append(container)
    render(
      <ColorPopover
        locale="ru"
        kind={kind}
        anchor={null}
        container={container}
        roles={roles}
        row={{ back, onBack }}
        {...(extra.cells ? { cells: extra.cells } : {})}
        {...(extra.keyboard ? { keyboard: true } : {})}
        onPick={onPick}
        onClose={onClose}
      />,
    )
    return { onPick, onClose, onBack }
  }

  it('is not a window: a group with the swatches of the window, no dialog, no title, no popup of the name', () => {
    row('color', 'bar', ['hl-red'])
    expect(screen.queryByRole('dialog')).toBeNull()
    const group = document.querySelector('.cr')!
    expect(group.getAttribute('role')).toBe('group')
    expect([...group.querySelectorAll('.sw-b')].map((b) => b.getAttribute('aria-label'))).toEqual([
      'Без цвета', 'Красный', 'Оранжевый', 'Зелёный', 'Бирюзовый', 'Синий', 'Фиолетовый', 'Розовый', 'Серый',
    ])
    expect(group.querySelectorAll('[title], .sw-tip')).toHaveLength(0)
    expect(group.querySelector('.sw-b[aria-pressed="true"]')!.getAttribute('aria-label')).toBe('Красный')
  })

  it('the panel: «‹», «Цвет», the circles, the name of the chosen one, in one row', () => {
    row('color', 'bar', ['hl-red'])
    const back = screen.getByLabelText('Вернуть кнопки панели')
    expect(back.textContent).toBe('‹')
    expect(document.querySelector('.cr-t-def')!.textContent).toBe('Цвет')
    expect(document.querySelector('.cr-name')!.textContent).toBe('Красный')
    expect(document.querySelector('.cr-src')).toBeNull()
    expect(document.querySelector('.cr')!.textContent).not.toMatch(/\[\.|hl-|В тексте/)
  })

  it('the row «Таблица»: «‹ Таблица», the label with the count, «Разная» in place of the name', () => {
    row('cell', 'table', ['cell-blue'], { cells: { count: 4, mixed: true, span: '' } })
    const back = screen.getByLabelText('Вернуть ряд «Таблица»')
    expect(back.textContent).toBe('‹Таблица')
    expect(document.querySelector('.cr-t-def')!.textContent).toBe('Заливка ячеек: 4')
    expect(document.querySelectorAll('.sw-b')).toHaveLength(7)
    expect(document.querySelectorAll('.sw-b[aria-pressed="true"]')).toHaveLength(0)
    expect(document.querySelector('.cr-name')!.textContent).toBe('Разная')
    // a circle under the mouse gives its name, and the mouse going away brings «Разная» back
    fireEvent.mouseEnter(document.querySelector('[data-role="cell-blue"]')!)
    expect(document.querySelector('.cr-name')!.textContent).toBe('Голубая')
    fireEvent.mouseLeave(document.querySelector('[data-role="cell-blue"]')!)
    expect(document.querySelector('.cr-name')!.textContent).toBe('Разная')
    // the label stays the label (the narrow tab)
    expect(document.querySelector('.cr-t-hov')!.textContent).toBe('Заливка ячеек: 4')
    expect(document.querySelector('.cr-src')).toBeNull()
  })

  it('the name of the swatch under the mouse stands at the end, and in the place of the label for a narrow tab', () => {
    row('color', 'bar', ['hl-red'])
    const cr = document.querySelector('.cr')!
    expect(cr.hasAttribute('data-hover')).toBe(false)
    fireEvent.mouseEnter(document.querySelector('[data-role="hl-blue"]')!)
    expect(cr.hasAttribute('data-hover')).toBe(true)
    expect(document.querySelector('.cr-name')!.textContent).toBe('Синий')
    expect(document.querySelector('.cr-t-hov')!.textContent).toBe('Синий')
    fireEvent.mouseLeave(document.querySelector('[data-role="hl-blue"]')!)
    expect(document.querySelector('.cr-name')!.textContent).toBe('Красный')
  })

  it('the keys name the swatch they stand on', () => {
    row('color', 'bar', ['hl-red'], { keyboard: true })
    fireEvent.keyDown(document, { key: 'ArrowRight' })
    expect(document.querySelector('.cr-name')!.textContent).toBe('Оранжевый')
    expect(document.querySelector('.cr-t-hov')!.textContent).toBe('Оранжевый')
    expect(document.querySelector('.cr')!.hasAttribute('data-hover')).toBe(true)
  })

  it('Esc and «‹» bring the row back (onBack), a pick picks, a click elsewhere closes', () => {
    const { onPick, onClose, onBack } = row('fill', 'bar')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onBack).toHaveBeenCalledTimes(1)
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.click(screen.getByLabelText('Вернуть кнопки панели'))
    expect(onBack).toHaveBeenCalledTimes(2)
    fireEvent.click(screen.getByLabelText('Голубая'))
    expect(onPick).toHaveBeenCalledWith('hl-blue-bg')
    fireEvent.mouseDown(document.body)
    expect(onClose).toHaveBeenCalledWith(false)
  })

  it('opened by the keyboard the focus goes to the current swatch; the arrows move it', () => {
    row('color', 'bar', ['hl-blue'], { keyboard: true })
    expect((document.activeElement as HTMLElement).getAttribute('aria-label')).toBe('Синий')
    fireEvent.keyDown(document, { key: 'Home' })
    expect((document.activeElement as HTMLElement).getAttribute('aria-label')).toBe('Без цвета')
  })

  it('the swatches of the row are circles, no letters: the text colour on the circle itself, the fills with a rim, «Без цвета» crossed', () => {
    row('color', 'bar', ['hl-red'])
    const dots = [...document.querySelectorAll<HTMLElement>('.cr .sw-b')]
    expect(dots).toHaveLength(9)
    for (const dot of dots) {
      expect(dot.classList.contains('dot')).toBe(true)
      expect(dot.textContent).toBe('')
      expect(dot.querySelector('.sw-r, .sw-none')).toBeNull()
    }
    expect(dots[0]!.classList.contains('none')).toBe(true)
    expect(dots[1]!.style.getPropertyValue('--c')).toMatch(/^var\(--ap-tx-/)
    expect(dots[1]!.classList.contains('fill')).toBe(false)
  })

  it('the fills and the fills of cells are circles too, with the rim of a fill', () => {
    row('fill', 'bar')
    const fills = [...document.querySelectorAll<HTMLElement>('.cr .sw-b.dot')]
    expect(fills).toHaveLength(10)
    expect(fills[0]!.classList.contains('none')).toBe(true)
    expect(fills[1]!.classList.contains('fill')).toBe(true)
    expect(fills[1]!.style.getPropertyValue('--c')).toMatch(/^var\(--ap-hl-/)
    expect(document.querySelectorAll('.cr .sw-r')).toHaveLength(0)
    cleanup()
    row('cell', 'table', [], { cells: { count: 1, mixed: false, span: '' } })
    const cells = [...document.querySelectorAll<HTMLElement>('.cr .sw-b.dot')]
    expect(cells).toHaveLength(7)
    expect(cells[1]!.classList.contains('fill')).toBe(true)
    expect(cells.every((c) => c.textContent === '')).toBe(true)
  })

  it('the window of the demo keeps its letters: only the row has circles', () => {
    const container = document.createElement('div')
    document.body.append(container)
    render(<ColorPopover locale="ru" kind="color" anchor={null} container={container} roles={[]} onPick={vi.fn()} onClose={vi.fn()} />)
    expect(document.querySelectorAll('.sw-r').length).toBeGreaterThan(0)
    expect(document.querySelectorAll('.dot')).toHaveLength(0)
  })

  it('the name follows the circle under the mouse; no record in any state; «Без цвета» has the name only', () => {
    row('color', 'bar')
    expect(document.querySelector('.cr-src')).toBeNull()
    fireEvent.mouseEnter(document.querySelector('[data-role="hl-blue"]')!)
    expect(document.querySelector('.cr-name')!.textContent).toBe('Синий')
    fireEvent.mouseEnter(document.querySelector('[data-role=""]')!)
    expect(document.querySelector('.cr-name')!.textContent).toBe('Без цвета')
    expect(document.querySelector('.cr-src, .fp-code')).toBeNull()
    expect(document.querySelector('.cr')!.textContent).not.toMatch(/\[\.|#|hl-|В тексте/)
  })

  it('a colour not in the registry: no circle ringed, the block of the name is empty', () => {
    row('color', 'bar', ['hl-cyan'])
    expect(document.querySelectorAll('.sw-b[aria-pressed="true"]')).toHaveLength(0)
    expect(document.querySelector('.cr-name')!.textContent).toBe('')
    expect(document.querySelector('.cr-src')).toBeNull()
  })

  it('the block of the name holds invisible copies of every name (their text is not in its text), so its width does not change', () => {
    row('cell', 'table', [], { cells: { count: 1, mixed: false, span: '' } })
    const ghosts = [...document.querySelectorAll('.cr-name .cr-ghost')].map((g) => g.getAttribute('data-t'))
    for (const n of ['Без заливки ячейки', 'Без заливки', 'Без цвета', 'Разная', 'Голубая', 'Красный']) expect(ghosts).toContain(n)
    expect(new Set(ghosts).size).toBe(ghosts.length)
    expect(document.querySelector('.cr-name')!.textContent).toBe('Без заливки ячейки')
    expect(document.querySelector('.cr-name .cr-ghost')!.getAttribute('aria-hidden')).toBe('true')
  })

  it('the first circle of the cells is «Без заливки ячейки», of the fills «Без заливки»', () => {
    row('cell', 'table', [], { cells: { count: 1, mixed: false, span: '' } })
    expect(document.querySelector('.cr .sw-b')!.getAttribute('aria-label')).toBe('Без заливки ячейки')
    cleanup()
    row('fill', 'bar')
    expect(document.querySelector('.cr .sw-b')!.getAttribute('aria-label')).toBe('Без заливки')
  })

  it('a separator stands after «‹»', () => {
    row('color', 'bar')
    expect(document.querySelector('.cr-back + .cr-sep')).not.toBeNull()
  })

  it('English: no Cyrillic', () => {
    const container = document.createElement('div')
    document.body.append(container)
    render(<ColorPopover locale="en" kind="cell" anchor={null} container={container} roles={[]} cells={{ count: 1, mixed: false, span: '' }} row={{ back: 'table', onBack: vi.fn() }} onPick={vi.fn()} onClose={vi.fn()} />)
    expect(document.querySelector('.cr')!.outerHTML).not.toMatch(CYRILLIC)
  })
})

describe('the row leaves the keys with a modifier in the text to the editor', () => {
  function mount() {
    const container = document.createElement('div')
    document.body.append(container)
    const text = document.createElement('div')
    document.body.append(text)
    render(
      <ColorPopover locale="ru" kind="color" anchor={null} container={container} roles={[]} row={{ back: 'bar', onBack: vi.fn() }} onPick={vi.fn()} onClose={vi.fn()} />,
    )
    return text
  }

  it('Shift+arrow pressed outside the row is not taken; the arrow without a modifier is', () => {
    const text = mount()
    const shifted = new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true, cancelable: true })
    text.dispatchEvent(shifted)
    expect(shifted.defaultPrevented).toBe(false)
    const plain = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })
    text.dispatchEvent(plain)
    expect(plain.defaultPrevented).toBe(true)
  })

  it('a key with Shift inside the row is the row\'s', () => {
    mount()
    const swatch = document.querySelector('.cr .sw-b')!
    const event = new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true, cancelable: true })
    swatch.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
  })
})
