// the column «Разделы» beside the text, in jsdom: the current section, a click that does not close anything, folding with the arrows and the folded parent that is lit.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parse } from '@nota-adoc/core'
import { createOutline, type Outline } from '../../src/webview/outline.js'

const TEXT = [
  '= Документ',
  '',
  '== Подготовка окружения',
  '',
  'а',
  '',
  '=== Установка пакетов',
  '',
  'б',
  '',
  '=== Настройка сети',
  '',
  'в',
  '',
  '=== Проверка',
  '',
  'г',
  '',
  '== Запуск тестов',
  '',
  'д',
  '',
].join('\n')

let outline: Outline
let top = 0
let atBottom = false
const goTo: number[] = []

beforeEach(() => {
  vi.useFakeTimers()
  top = 0
  atBottom = false
  goTo.length = 0
  const doc = parse(TEXT)
  outline = createOutline(document, {
    doc: () => doc,
    view: () => ({ top, atBottom }),
    goToHeading: (offset) => goTo.push(offset),
    goToRemark: () => undefined,
  }, 'ru')
  document.body.append(outline.side, outline.isle, outline.card, outline.strokes)
  outline.setView('side')
  outline.flush()
})
afterEach(() => {
  outline.destroy()
  document.body.textContent = ''
  vi.useRealTimers()
})

const side = (): HTMLElement[] => [...outline.side.querySelectorAll<HTMLElement>('li')]
const shownTitles = (): string[] => side().filter((li) => !li.hidden).map((li) => li.querySelector('.tree-name')!.textContent!)
const lit = (): string[] => [...outline.side.querySelectorAll('.tree-item.on .tree-name')].map((e) => e.textContent!)
const arrow = (title: string): HTMLElement =>
  [...outline.side.querySelectorAll<HTMLElement>('.tree-row')].find((r) => r.querySelector('.tree-name')!.textContent === title)!.querySelector<HTMLElement>('.tree-fold')!
const scrollTo = (marker: string): void => {
  top = TEXT.indexOf(marker)
  outline.flush()
}

describe('the column «Разделы»', () => {
  it('has a row for every entry of the outline, an arrow only on a row with subsections', () => {
    expect(shownTitles()).toEqual(['Подготовка окружения', 'Установка пакетов', 'Настройка сети', 'Проверка', 'Запуск тестов'])
    const withArrow = [...outline.side.querySelectorAll<HTMLElement>('.tree-row')].filter((r) => r.querySelector('.tree-fold')).map((r) => r.querySelector('.tree-name')!.textContent)
    expect(withArrow).toEqual(['Подготовка окружения'])
    expect(outline.side.querySelectorAll('.tree-fold-gap')).toHaveLength(4)
  })

  it('the current section is lit, as in the panel', () => {
    scrollTo('=== Настройка сети')
    expect(lit()).toEqual(['Настройка сети'])
    expect(outline.card.querySelectorAll('.tree-item.on .tree-name')[0]!.textContent).toBe('Настройка сети')
    atBottom = true
    outline.flush()
    expect(lit()).toEqual(['Запуск тестов'])
  })

  it('a click on a row goes to the heading and closes nothing; the same click in the panel closes it', () => {
    const row = [...outline.side.querySelectorAll<HTMLElement>('.tree-item')].find((e) => e.textContent === 'Запуск тестов')!
    row.click()
    expect(goTo).toEqual([TEXT.indexOf('== Запуск тестов')])
    outline.open()
    expect(outline.isOpen).toBe(true)
    row.click()
    expect(outline.isOpen).toBe(true)
    outline.card.querySelectorAll<HTMLElement>('.tree-item')[1]!.click()
    expect(outline.isOpen).toBe(false)
  })

  it('the arrow folds the subsections and turns, a second click shows them, nothing scrolls', () => {
    expect(arrow('Подготовка окружения').getAttribute('aria-expanded')).toBe('true')
    arrow('Подготовка окружения').click()
    expect(shownTitles()).toEqual(['Подготовка окружения', 'Запуск тестов'])
    expect(arrow('Подготовка окружения').classList.contains('closed')).toBe(true)
    expect(arrow('Подготовка окружения').getAttribute('aria-expanded')).toBe('false')
    expect(arrow('Подготовка окружения').getAttribute('aria-label')).toBe('Развернуть раздел «Подготовка окружения»')
    expect(goTo).toEqual([])
    // the panel keeps every row
    expect(outline.card.querySelectorAll('.tree-row')).toHaveLength(5)
    arrow('Подготовка окружения').click()
    expect(shownTitles()).toHaveLength(5)
  })

  it('the current section inside a folded one lights the folded parent; the fold stays through redraws and scrolls', () => {
    arrow('Подготовка окружения').click()
    scrollTo('=== Установка пакетов')
    expect(lit()).toEqual(['Подготовка окружения'])
    outline.refresh()
    vi.advanceTimersByTime(50)
    scrollTo('=== Проверка')
    expect(lit()).toEqual(['Подготовка окружения'])
    expect(shownTitles()).toEqual(['Подготовка окружения', 'Запуск тестов'])
    scrollTo('== Запуск тестов')
    expect(lit()).toEqual(['Запуск тестов'])
  })
})

// a card pinned in a narrow tab closes when the column comes, even if the ResizeObserver on the column does not report it (jsdom has none; in a loaded Chrome it is late).
describe('the column «Разделы»: the card pinned while the column is not there', () => {
  it('the window «resize» closes the pinned card as soon as the column has a width', () => {
    expect(window.ResizeObserver, 'jsdom has no ResizeObserver: only «resize» can tell').toBeUndefined()
    outline.strokes.click()
    expect(outline.isOpen).toBe(true)
    expect(outline.strokes.getAttribute('aria-expanded')).toBe('true')
    // the tab is still narrow: the column has no width, a resize leaves the card where it is
    window.dispatchEvent(new Event('resize'))
    vi.advanceTimersByTime(100)
    expect(outline.isOpen).toBe(true)
    // the tab grew: the column has a width
    const box = { x: 0, y: 0, left: 0, top: 0, right: 260, bottom: 600, width: 260, height: 600, toJSON: () => ({}) }
    vi.spyOn(outline.side, 'getBoundingClientRect').mockReturnValue(box)
    window.dispatchEvent(new Event('resize'))
    vi.advanceTimersByTime(100)
    expect(outline.isOpen).toBe(false)
    expect(outline.card.hidden).toBe(true)
    expect(outline.strokes.getAttribute('aria-expanded')).toBe('false')
  })
})

// what the column has of its own: the counter, dragging, Alt+↑/↓ (the focus stays in the column), «Текст», a document without sections.
describe('the column «Разделы»: counters, moving, the mode «Текст», no sections', () => {
  const DOC = ['= Документ', '', '== Первый', '', 'а', '', '==== Прыжок через уровень', '', 'б', '', '== Второй', '', 'в', '', '== Третий', '', 'г', ''].join('\n')
  let o: Outline
  let movable = true
  const moved: [number, number][] = []
  const remarkAt: number[] = []
  const headings: number[] = []
  const build = (text: string): void => {
    const doc = parse(text)
    o = createOutline(document, {
      doc: () => doc,
      view: () => ({ top: 0, atBottom: false }),
      goToHeading: (offset) => headings.push(offset),
      goToRemark: (offset) => remarkAt.push(offset),
      canMove: () => movable,
      moveSection: (at, to) => (moved.push([at, to]), true),
    }, 'ru')
    document.body.append(o.side, o.isle, o.card, o.strokes)
    o.setView('side')
    o.flush()
  }
  beforeEach(() => {
    movable = true
    moved.length = 0
    remarkAt.length = 0
    headings.length = 0
    build(DOC)
  })
  afterEach(() => o.destroy())

  const column = (): HTMLElement[] => [...o.side.querySelectorAll<HTMLElement>('.tree-item')]
  const item = (title: string): HTMLElement => column().find((e) => e.textContent === title)!
  const keys = (el: HTMLElement, key: string): KeyboardEvent => {
    const e = new KeyboardEvent('keydown', { key, altKey: true, bubbles: true, cancelable: true })
    el.dispatchEvent(e)
    return e
  }

  it('a click on the counter goes to the first remark of the section and the column stays', () => {
    const badge = o.side.querySelector<HTMLElement>('.tree-badge')
    expect(badge, 'the document has a remark: a counter is drawn').not.toBeNull()
    badge!.click()
    expect(remarkAt).toEqual([o.remarks[0]!.from])
    expect(headings).toEqual([])
    expect(o.side.hidden).toBe(false)
    expect(o.isOpen).toBe(false)
  })

  it('dragging a row of the column onto another moves the section', () => {
    const rows = [...o.side.querySelectorAll<HTMLElement>('.tree-row')]
    const [a, b] = [rows.find((r) => r.querySelector('.tree-name')!.textContent === 'Третий')!, rows.find((r) => r.querySelector('.tree-name')!.textContent === 'Первый')!]
    expect(a.draggable).toBe(true)
    vi.spyOn(b, 'getBoundingClientRect').mockReturnValue({ top: 100, height: 20, bottom: 120 } as DOMRect)
    const data = { effectAllowed: '', dropEffect: '', setData() {} }
    const ev = (type: string): Event => {
      const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientY: 102 })
      Object.defineProperty(e, 'dataTransfer', { value: data })
      return e
    }
    a.dispatchEvent(ev('dragstart'))
    const over = ev('dragover')
    b.dispatchEvent(over)
    expect(over.defaultPrevented).toBe(true)
    b.dispatchEvent(ev('drop'))
    a.dispatchEvent(ev('dragend'))
    expect(moved).toEqual([[DOC.indexOf('== Третий'), DOC.indexOf('== Первый')]])
  })

  it('Alt+↑ and Alt+↓ on a row of the column move the section and the focus stays on its row in the column', () => {
    const third = item('Третий')
    third.focus()
    const e = keys(third, 'ArrowUp')
    expect(e.defaultPrevented).toBe(true)
    expect(moved).toEqual([[DOC.indexOf('== Третий'), DOC.indexOf('== Второй')]])
    expect(o.side.contains(document.activeElement)).toBe(true)
    expect(document.activeElement!.classList.contains('tree-item')).toBe(true)
    moved.length = 0
    keys(item('Первый'), 'ArrowDown')
    expect(moved).toHaveLength(1)
    expect(moved[0]![0]).toBe(DOC.indexOf('== Первый'))
  })

  it('no moving where the editor cannot move sections (the mode «Текст»): not draggable, no Alt+↑/↓', () => {
    movable = false
    o.refresh()
    o.flush()
    expect([...o.side.querySelectorAll<HTMLElement>('.tree-row')].some((r) => r.draggable)).toBe(false)
    const e = keys(item('Второй'), 'ArrowUp')
    expect(e.defaultPrevented).toBe(false)
    expect(moved).toEqual([])
  })

  it('Alt+↑ on the first section of its level changes nothing', () => {
    keys(item('Первый'), 'ArrowUp')
    expect(moved).toEqual([])
  })

  it('«Текст» (setEnabled(false)) hides the column, and it is back with the visual mode', () => {
    expect(o.side.hidden).toBe(false)
    o.setEnabled(false)
    expect(o.side.hidden).toBe(true)
    o.setEnabled(true)
    expect(o.side.hidden).toBe(false)
  })

  it('a document without sections has no column', () => {
    o.destroy()
    document.body.textContent = ''
    build('= Только заголовок\n\nАбзац.\n')
    expect(o.side.hidden).toBe(true)
    expect(o.side.querySelectorAll('.tree-row')).toHaveLength(0)
  })
})

describe('a document without sections, and the first heading', () => {
  let o: Outline
  let text = '= Заметки о походе\n\nПервый абзац.\n'
  const mount = (): void => {
    o = createOutline(document, {
      doc: () => parse(text),
      view: () => ({ top: 0, atBottom: false }),
      goToHeading: () => undefined,
      goToRemark: () => undefined,
    }, 'ru')
    document.body.append(o.side, o.isle, o.card, o.strokes)
    o.setView('side')
    o.flush()
  }
  afterEach(() => {
    o.destroy()
    document.body.textContent = ''
  })

  it('hides the capsule and the strokes, keeps its place, and does not open the card', () => {
    mount()
    expect(o.isle.hasAttribute('data-empty')).toBe(true)
    expect(o.isle.getAttribute('aria-hidden')).toBe('true')
    expect(o.isle.tabIndex).toBe(-1)
    expect(o.strokes.hidden).toBe(true)
    expect(o.side.hidden).toBe(true)
    expect(o.side.hasAttribute('data-lane')).toBe(true)
    o.open()
    o.isle.click()
    expect(o.isOpen).toBe(false)
    expect(o.card.hidden).toBe(true)
  })

  it('the outline comes with the first heading and goes with the last one, closing the open card', () => {
    mount()
    o.setView('capsule')
    text = '= Заметки о походе\n\n== Маршрут\n\nТекст.\n'
    o.flush()
    expect(o.isle.hasAttribute('data-empty')).toBe(false)
    expect(o.isle.hasAttribute('aria-hidden')).toBe(false)
    expect(o.strokes.hidden).toBe(false)
    o.open()
    expect(o.isOpen).toBe(true)
    text = '= Заметки о походе\n\nТолько текст.\n'
    o.flush()
    expect(o.isOpen).toBe(false)
    expect(o.card.hidden).toBe(true)
    expect(o.isle.hasAttribute('data-empty')).toBe(true)
    expect(o.strokes.hidden).toBe(true)
    text = '= Заметки о походе\n\n== Маршрут\n\nТекст.\n'
    o.flush()
    o.setView('side')
    expect(o.side.hidden).toBe(false)
    expect(o.side.querySelectorAll('.tree-item')).toHaveLength(1)
  })

  it('the text mode keeps the page lane off', () => {
    mount()
    o.setEnabled(false)
    expect(o.side.hasAttribute('data-lane')).toBe(false)
  })
})
