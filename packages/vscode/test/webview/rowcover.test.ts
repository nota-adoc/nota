// the row «Таблица» (and «⋯») lies over the text, so the document stays where it is; the cursor that the row would cover is
// scrolled out once, the view keeps the cursor under the capsule, a table at the start has room above it, and the windows hang below.
// jsdom has no layout: the geometry of the capsule, the scroller and the cursor is put in by hand.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { TextSelection } from 'prosemirror-state'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type Page, startPage } from '../../src/webview/main.js'
import type { ToHost, ToTab } from '../../src/protocol.js'

const FILL = readFileSync(join(import.meta.dirname, '../../../../quality/fixtures/editor/tables-fill.adoc'), 'utf8')
const FIRST = '[cols="1,1"]\n|===\n|Окно |Состояние\n\n|чт |занято\n|===\n\nХвост документа.\n'
const CSS = readFileSync(join(import.meta.dirname, '../../src/webview/style.css'), 'utf8')

const MAIN = 34
const ROW = 36 // the height of .tl-row; with its upper line 37
let sent: ToHost[]
let root: HTMLElement
let page: Page | undefined
let cursorTop = 300
let cellTop = 82 // the top of the first cell without the room above it and without scrolling
let rowH = ROW // the height of the row now: 36 on one line, 66 on two
let tabWidth = 800 // the width of .ed-main
let bubbleH = 0 // the height of the panel over the word
let bubbleW = 0 // its width
let clipped: number | null = null // scrollHeight of the row while it opens (clipped); null: as tall as it is
// the capsule is one line in a tab of any width: no «⋯», nothing wraps in the main row
const mainH = (_el: Element): number => MAIN
const host = (message: ToTab): void => void window.dispatchEvent(new MessageEvent('message', { data: message }))
const tick = async (ms = 50): Promise<void> => void (await vi.advanceTimersByTimeAsync(ms))
const q = <T extends HTMLElement>(selector: string): T => root.querySelector<T>(selector)!
const scroller = (): HTMLElement => q('.scroll.ed-visual')

const proto = {
  rect: HTMLElement.prototype.getBoundingClientRect,
  offsetHeight: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight'),
  offsetWidth: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth'),
  scrollHeight: Object.getOwnPropertyDescriptor(Element.prototype, 'scrollHeight'),
  clientWidth: Object.getOwnPropertyDescriptor(Element.prototype, 'clientWidth'),
}

function rect(top: number, height = 0): DOMRect {
  return { x: 10, y: top, left: 10, right: 400, top, bottom: top + height, width: 390, height } as DOMRect
}

beforeEach(() => {
  vi.useFakeTimers()
  sent = []
  page = undefined
  cursorTop = 300
  cellTop = 82
  bubbleH = 0
  bubbleW = 0
  rowH = ROW
  clipped = null
  tabWidth = 800
  document.elementFromPoint = () => null
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement): DOMRect {
    if (this.classList.contains('ed-isles')) return rect(0, 52)
    if (this.classList.contains('scroll')) return rect(52, 600)
    // the frame of a table is narrower than the tab
    if (this.classList.contains('tbl-scroll')) return { ...rect(52, 600), right: 200, width: 190 } as DOMRect
    if (this.classList.contains('isle-tools')) {
      const open = this.querySelector('.tl-row') && !this.querySelector('.is-leaving')
      return rect(10, 2 + mainH(this.querySelector('.tl-main')!) + (open ? rowH + 1 : 0))
    }
    if (this.localName === 'td' || this.localName === 'th') return rect(cellTop + (Number.parseFloat(scroller().style.getPropertyValue('--lead-extra')) || 0) - (scroller().scrollTop || 0), 30)
    // the buttons of the row: 30 px on a line, laid out whatever the clipping of the row is
    if (this.parentElement?.classList.contains('tl-row') && clipped !== null) return rect(100, 30)
    return proto.rect.call(this)
  }
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return this.classList.contains('tl-main') ? mainH(this) : this.classList.contains('bubble') ? bubbleH : 0
    },
  })
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get(this: HTMLElement) {
      return this.classList.contains('bubble') ? bubbleW : 0
    },
  })
  Object.defineProperty(Element.prototype, 'scrollHeight', {
    configurable: true,
    get(this: Element) {
      return this.classList.contains('tl-row') ? (clipped ?? rowH) : 0
    },
  })
  Object.defineProperty(Element.prototype, 'clientWidth', {
    configurable: true,
    get(this: Element) {
      return this.classList.contains('ed-main') ? tabWidth : 0
    },
  })
})
afterEach(() => {
  page?.destroy()
  document.body.textContent = ''
  vi.useRealTimers()
  HTMLElement.prototype.getBoundingClientRect = proto.rect
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', proto.offsetHeight!)
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', proto.offsetWidth!)
  vi.unstubAllGlobals()
  Object.defineProperty(Element.prototype, 'scrollHeight', proto.scrollHeight!)
  Object.defineProperty(Element.prototype, 'clientWidth', proto.clientWidth!)
})

function open(text: string): Page {
  root = document.createElement('div')
  root.id = 'app'
  document.body.append(root)
  page = startPage({ postMessage: (m: ToHost) => void sent.push(m) }, root, { mac: false })
  host({ type: 'init', text, version: 1, fileName: 'a.adoc', locale: 'ru', outlineView: 'capsule', fileDir: '/work/docs', mode: 'visual' })
  page.flush()
  page.editor!.view.coordsAtPos = () => ({ left: 50, right: 90, top: cursorTop, bottom: cursorTop + 20 })
  return page
}

async function inText(text: string): Promise<void> {
  const view = page!.editor!.view
  let found = -1
  view.state.doc.descendants((node, pos) => {
    if (found < 0 && node.isTextblock && node.textContent.includes(text)) found = pos + 1 + node.textContent.indexOf(text)
    return found < 0
  })
  if (found < 0) throw new Error(`no «${text}»`)
  view.focus()
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, found + text.length)))
  await tick()
}

const margin = (): number => (page!.editor!.view.someProp('scrollMargin') as { top: number }).top
// the lower edge of the open row: 10 + 2 + 34 + 37 = 83, and 4 px of air
const LIMIT = 10 + 2 + MAIN + ROW + 1 + 4

describe('the row does not move the document', () => {
  it('a cursor that is seen stays where it is: no scrolling when the row opens, none when it folds up, and Esc', async () => {
    open(FILL)
    await inText('Вторая')
    scroller().scrollTop = 120
    cursorTop = 300
    await inText('Мачту')
    expect(q('.tl-row')).not.toBeNull()
    expect(scroller().scrollTop).toBe(120)
    await inText('Вторая')
    await tick(250)
    expect(root.querySelector('.tl-row')).toBeNull()
    expect(scroller().scrollTop).toBe(120)
    await inText('Мачту')
    page!.editor!.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    await tick(250)
    expect(scroller().scrollTop).toBe(120)
  })

  it('the row of capsules has the height of the main row only: the capsule of tools reaches down over the text', () => {
    expect(CSS).toMatch(/\.isle-mid \{ height: var\(--tools-main-h, 36px\); \}/)
    expect(CSS).toMatch(/\.ed-isles \{[^}]*min-height: 52px/)
  })
})

describe('a cursor that the row would cover', () => {
  it('is scrolled out once, as far as it takes, at once and not back after', async () => {
    open(FILL)
    await inText('Вторая')
    scroller().scrollTop = 100
    cursorTop = 60
    await inText('Мачту')
    expect(scroller().scrollTop).toBe(100 - (LIMIT - 60))
    const after = scroller().scrollTop
    cursorTop = LIMIT + 1
    await inText('Вторая')
    await tick(250)
    expect(scroller().scrollTop).toBe(after)
  })

  it('leaves a smooth scroll to a section alone', async () => {
    open(FILL)
    await inText('Вторая')
    scroller().scrollTop = 100
    scroller().classList.add('smooth')
    cursorTop = 60
    await inText('Мачту')
    expect(scroller().scrollTop).toBe(100)
  })

  it('a table that is the first block has room above it, and the cursor of its first cell is below the capsule without scrolling', async () => {
    open(FIRST)
    // before any click: the room is already there
    expect(Number.parseFloat(scroller().style.getPropertyValue('--lead-extra'))).toBeGreaterThan(0)
    cursorTop = LIMIT + 10
    await inText('Окно')
    expect(scroller().scrollTop).toBe(0)
    expect(q('.tl-row')).not.toBeNull()
    // the room covers the row: the first cell, at the top of the page after the room, is not higher than the limit
    const room = Number.parseFloat(scroller().style.getPropertyValue('--lead-extra'))
    expect(cellTop + room).toBeGreaterThanOrEqual(LIMIT - 1)
  })

  it('a document with no table at the start has no such room', () => {
    open(FILL)
    expect(scroller().style.getPropertyValue('--lead-extra')).toBe('')
  })

  it('the room is part of the padding of the scroller, wide and narrow', () => {
    expect(CSS).toMatch(/\.scroll \{[^}]*padding: calc\(30px \+ var\(--isles-h, 52px\) \+ var\(--strip-h, 0px\) \+ var\(--lead-extra, 0px\)\) 24px 0 36px/)
    // (the air after the document is a block after the page, not padding: the bar of a wide table sticks to the bottom edge of the window)
    expect(CSS).toMatch(/\.scroll::after \{[^}]*height: 96px/)
    expect(CSS).toMatch(/\.scroll \{ padding: calc\(22px \+ var\(--isles-h, 52px\) \+ var\(--strip-h, 0px\) \+ var\(--lead-extra, 0px\)\) 14px 0 36px/)
    expect(CSS).toMatch(/\.scroll::after \{ height: 72px/)
  })
})

describe('the view keeps the cursor under the capsule', () => {
  it('the top margin of the scroll is the lower edge of the capsule plus 4 px while the row is open, and 5 px otherwise', async () => {
    open(FILL)
    await inText('Вторая')
    expect(margin()).toBe(5)
    await inText('Мачту')
    expect(margin()).toBe(LIMIT - 52)
    await inText('Вторая')
    expect(margin()).toBe(5)
  })

  // The scroller is 600 high from 52; the cursor line is 20 high (coordsAtPos is put in by hand). Tab, Shift+Tab and the arrows end in
  // the same call: the transaction that moves the selection asks the view to scroll the cursor into view.
  const scrollTo = async (top: number, from = 100): Promise<number> => {
    await inText('Мачту')
    const box = scroller()
    const view = page!.editor!.view
    // jsdom has no layout: the scroller is the only thing that scrolls, and every box around the cursor is as wide as the scroller
    let scrolled = from
    Object.defineProperty(box, 'scrollTop', { configurable: true, get: () => scrolled, set: (v: number) => void (scrolled = v) })
    Object.defineProperty(box, 'offsetHeight', { configurable: true, value: 600 })
    const mocked = HTMLElement.prototype.getBoundingClientRect
    const holder = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop')
    const height = Object.getOwnPropertyDescriptor(Element.prototype, 'clientHeight')
    HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement): DOMRect {
      if (this !== box && this.localName !== 'td' && this.localName !== 'th' && (box.contains(this) || this.contains(box))) return rect(52, 600)
      return mocked.call(this)
    }
    Object.defineProperty(Element.prototype, 'scrollTop', { configurable: true, get: () => 0, set: () => {} })
    Object.defineProperty(Element.prototype, 'clientHeight', { configurable: true, get: () => 600 })
    const by = window.scrollBy
    window.scrollBy = () => {}
    try {
      cursorTop = top
      view.dispatch(view.state.tr.scrollIntoView())
      await tick()
      return scrolled
    } finally {
      window.scrollBy = by
      HTMLElement.prototype.getBoundingClientRect = mocked
      if (holder) Object.defineProperty(Element.prototype, 'scrollTop', holder)
      if (height) Object.defineProperty(Element.prototype, 'clientHeight', height)
    }
  }

  it('a cursor that moved into a cell under the row (Shift+Tab, the arrow up) is scrolled out below the capsule', async () => {
    open(FILL)
    // 70 is under the top of the scroller (52) but over the lower edge of the capsule (83)
    expect(await scrollTo(70)).toBe(100 - (LIMIT - 70))
  })

  it('a cursor under the capsule in a narrow tab is scrolled out below both lines', async () => {
    tabWidth = 400
    rowH = 66
    open(FILL)
    const limit = 10 + 2 + MAIN + 66 + 1 + 4
    expect(await scrollTo(90)).toBe(100 - (limit - 90))
  })

  it('a cursor under the lower edge of the tab is still scrolled into view', async () => {
    open(FILL)
    // the line ends at 660, the tab at 652: 8 px and the margin of 5
    expect(await scrollTo(640)).toBe(100 + 13)
  })

  it('a cursor that is below the capsule stays where it is', async () => {
    open(FILL)
    expect(await scrollTo(300)).toBe(100)
  })
})

describe('the windows hang below the capsule', () => {
  it('the colours of the fill of a cell are no window: they stand in place of the row, and the capsule reaches down as before', async () => {
    open(FILL)
    await inText('Мачту')
    expect(q('.isle-tools').hasAttribute('data-hang')).toBe(true)
    q<HTMLElement>('.isle-tools .tl-row .cell-fill').click()
    await tick()
    expect(root.querySelector('.pop')).toBeNull()
    expect(q('.isle-tools .tl-row .cr')).not.toBeNull()
    // the capsule reaches down to 10 + 2 + 34 + 37 = 83 over the text, with the row of buttons and with the row of circles alike
    expect(q('.ed-isles').style.getPropertyValue('--tools-h')).toBe(`${2 + MAIN + ROW + 1}px`)
  })

  it('the cards hang from the lower edge of the capsule, wide and narrow', () => {
    expect(CSS).toMatch(/\.isle-mid \.card \{[^}]*top: calc\(max\(100%, var\(--tools-h, 0px\)\) \+ 8px\)/)
    expect(CSS).toMatch(/\.isle-left \.card, \.isle-mid \.card, \.isle-right \.card \{[^}]*top: max\(calc\(100% - 4px\), calc\(var\(--tools-bottom, 0px\) \+ 4px\)\)/)
  })

  it('the row of capsules knows how low the capsule reaches', async () => {
    open(FILL)
    await inText('Мачту')
    const isles = q('.ed-isles')
    expect(isles.style.getPropertyValue('--tools-h')).toBe(`${2 + MAIN + ROW + 1}px`)
    expect(isles.style.getPropertyValue('--tools-bottom')).toBe(`${10 + 2 + MAIN + ROW + 1}px`)
    await inText('Вторая')
    expect(isles.style.getPropertyValue('--tools-h')).toBe(`${2 + MAIN}px`)
  })
})

describe('the height of the capsule while the row opens', () => {
  it('is the final one, not the clipped scrollHeight of the opening row', async () => {
    clipped = 15 // the row is clipped to a few px at the start of the animation
    const sheet = document.createElement('style')
    sheet.textContent = '.tl-row { padding: 3px 0; border-top: 1px solid; }'
    document.head.append(sheet)
    open(FILL)
    await inText('Мачту')
    sheet.remove()
    // 2 (frame of the capsule) + 34 (main) + 30 (buttons) + 6 (padding) + 1 (line) = 73, as the capsule measures
    const bottom = 10 + 2 + MAIN + ROW + 1
    expect(q('.ed-isles').style.getPropertyValue('--tools-h')).toBe(`${2 + MAIN + 37}px`)
    expect(q('.ed-isles').style.getPropertyValue('--tools-bottom')).toBe(`${bottom}px`)
    expect(margin()).toBe(bottom + 4 - 52)
  })
})

describe('a narrow tab', () => {
  // the row wraps into two lines: 2 * 30 + 6 + 1 px of the line, so 66 high and 67 with its upper line
  const NARROW_ROW = 66
  const NARROW_LIMIT = 10 + 2 + MAIN + NARROW_ROW + 1 + 4

  it('a cursor that is seen stays where it is when the row of two lines opens, folds up, and on Esc', async () => {
    tabWidth = 400
    rowH = NARROW_ROW
    open(FILL)
    await inText('Вторая')
    scroller().scrollTop = 120
    cursorTop = 300
    await inText('Мачту')
    expect(q('.tl-row')).not.toBeNull()
    expect(scroller().scrollTop).toBe(120)
    await inText('Вторая')
    await tick(250)
    expect(scroller().scrollTop).toBe(120)
    await inText('Мачту')
    page!.editor!.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    await tick(250)
    expect(scroller().scrollTop).toBe(120)
  })

  it('a cursor that the two lines would cover is scrolled out to the lower edge of both, once and not back', async () => {
    tabWidth = 300
    rowH = NARROW_ROW
    open(FILL)
    await inText('Вторая')
    scroller().scrollTop = 100
    cursorTop = 60
    await inText('Мачту')
    expect(scroller().scrollTop).toBe(100 - (NARROW_LIMIT - 60))
    const after = scroller().scrollTop
    cursorTop = NARROW_LIMIT + 1
    await inText('Вторая')
    await tick(250)
    expect(scroller().scrollTop).toBe(after)
  })

  it('the top margin of the scroll is the lower edge of the two lines, and the cards and the row of capsules know it', async () => {
    tabWidth = 400
    rowH = NARROW_ROW
    open(FILL)
    await inText('Мачту')
    expect(margin()).toBe(NARROW_LIMIT - 52)
    expect(q('.ed-isles').style.getPropertyValue('--tools-bottom')).toBe(`${10 + 2 + MAIN + NARROW_ROW + 1}px`)
  })

  it('a table that is the first block: before the row is measured the room is made for two lines from the width of the tab', () => {
    rowH = 0 // (no layout of the row yet)
    tabWidth = 800
    open(FIRST)
    const wide = Number.parseFloat(scroller().style.getPropertyValue('--lead-extra'))
    page!.destroy()
    document.body.textContent = ''
    tabWidth = 300
    open(FIRST)
    // the row of two lines (a tab narrower than 360 px) is estimated at 70 against 37 of one
    expect(Number.parseFloat(scroller().style.getPropertyValue('--lead-extra')) - wide).toBe(33)
  })

  it('the row measured: the first cell is below its two lines, and nothing is scrolled', async () => {
    tabWidth = 400
    rowH = NARROW_ROW
    open(FIRST)
    cursorTop = NARROW_LIMIT + 10
    await inText('Окно')
    expect(scroller().scrollTop).toBe(0)
    const room = Number.parseFloat(scroller().style.getPropertyValue('--lead-extra'))
    expect(cellTop + room).toBeGreaterThanOrEqual(NARROW_LIMIT - 1)
  })

  it('the estimate was wrong: the text stays where it is, the scroll takes the difference', async () => {
    rowH = 0
    tabWidth = 800 // estimated as one line (37)…
    open(FIRST)
    const before = Number.parseFloat(scroller().style.getPropertyValue('--lead-extra'))
    rowH = NARROW_ROW // …but the row wraps into two (67)
    cursorTop = NARROW_LIMIT + 10
    await inText('Хвост')
    await tick(250)
    await inText('Окно')
    const after = Number.parseFloat(scroller().style.getPropertyValue('--lead-extra'))
    expect(after - before).toBe(30)
    // the room grew by 30 and the scroll by the same: the text on the screen did not move
    expect(scroller().scrollTop).toBe(30)
  })

  it('the capsule is one line in a narrow tab: the row of capsules keeps its height, there is no «⋯»', async () => {
    tabWidth = 300
    open(FILL)
    await inText('Вторая')
    const isles = q('.ed-isles')
    expect(isles.style.getPropertyValue('--tools-main-h')).toBe(`${2 + MAIN}px`)
    expect(root.querySelector('.tl-more, .tl-break')).toBeNull()
    expect(q('.isle-tools').hasAttribute('data-expanded')).toBe(false)
    await inText('Мачту')
    expect(isles.style.getPropertyValue('--tools-main-h')).toBe(`${2 + MAIN}px`)
  })

  it('the row «Таблица» wraps only in a tab narrower than 360 px: the style sheet says so', () => {
    expect(CSS).toMatch(/@container \(max-width: 360px\) \{\s*\.tl-row \{ flex-wrap: wrap; \}/)
    // in a tab of 390 px the buttons of the row are 28 px and it stays in one line
    expect(CSS).toMatch(/\.tl-row \.tb-b \{ height: 28px; min-width: 28px;/)
    expect(CSS).not.toMatch(/\.tl-row \{ flex-wrap: wrap; \}\n\s*\.rm-text/)
  })
})

describe('the handle of a block and the panels', () => {
  it('stay under the capsule: their layer is lower than the row of capsules', () => {
    const z = (re: RegExp): number => Number(re.exec(CSS)![1])
    const isles = z(/\.ed-isles \{ position: absolute; top: 0; left: 0; right: 0; z-index: (\d+);/)
    expect(z(/\.ed-main \.blk-handle, \.ed-main \.blockbar \{ z-index: (\d+); \}/)).toBeLessThan(isles)
  })

  it('a click on the buttons of the row works, and the text beside the capsule is not under it', async () => {
    open(FILL)
    await inText('Мачту')
    const before = q('.ed-isles').querySelectorAll('.tl-row [data-cmd]').length
    expect(before).toBeGreaterThan(5)
    // the row of capsules is only 52 px high in the flow: the text beside the capsule starts under it, not under the row
    expect(CSS).toMatch(/\.isle-mid \{ height: var\(--tools-main-h, 36px\); \}/)
    const size = page!.editor!.view.state.doc.content.size
    q<HTMLElement>('.tl-row [data-cmd="row-add"]').click()
    await tick()
    expect(page!.editor!.view.state.doc.content.size).toBeGreaterThan(size)
  })
})

describe('a big file', () => {
  it('after «Всё равно открыть визуально» the row does not move the text, and the strip is gone, so the row covers nothing of it', async () => {
    root = document.createElement('div')
    root.id = 'app'
    document.body.append(root)
    page = startPage({ postMessage: (m: ToHost) => void sent.push(m) }, root, { mac: false })
    host({ type: 'init', text: FILL, version: 1, fileName: 'a.adoc', locale: 'ru', outlineView: 'capsule', fileDir: '/work/docs', mode: 'text', big: { bytes: 1_468_006 } })
    page.flush()
    expect(q('.big-strip').hidden).toBe(false)
    q<HTMLElement>('.big-go').click()
    await tick()
    expect(page.mode).toBe('visual')
    expect(q('.big-strip').hidden).toBe(true)
    page.editor!.view.coordsAtPos = () => ({ left: 0, right: 0, top: 300, bottom: 320 })
    await inText('Вторая')
    scroller().scrollTop = 120
    await inText('Мачту')
    expect(q('.tl-row')).not.toBeNull()
    expect(scroller().scrollTop).toBe(120)
    await inText('Вторая')
    await tick(250)
    expect(root.querySelector('.tl-row')).toBeNull()
    expect(scroller().scrollTop).toBe(120)
  })
})

// the panel over a word and the row of colours under the capsule that hangs over the text
describe('the panel over a word stays clear of the capsule', () => {
  /** Selects `word` (a range) in the text block that has it, and waits for the panel. */
  async function pick(word: string): Promise<void> {
    const view = page!.editor!.view
    let found = -1
    view.state.doc.descendants((node, pos) => {
      if (found < 0 && node.isTextblock && node.textContent.includes(word)) found = pos + 1 + node.textContent.indexOf(word)
      return found < 0
    })
    if (found < 0) throw new Error(`no «${word}»`)
    view.focus()
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, found, found + word.length)))
    await tick(300)
    await tick(300)
  }
  const bubble = (): HTMLElement => q('.bubble')

  it('a word in a cell, the row «Таблица» open: the panel is under the word where above it would lie under the capsule', async () => {
    open(FILL)
    bubbleH = 30
    bubbleW = 200
    // the word is 100 px from the top of the viewport; the panel (30 + 8) would stand at 62, over the scroller (52) but under the row (83)
    cursorTop = 100
    await pick('Мачту')
    expect(q('.tl-row')).not.toBeNull()
    expect(bubble().style.visibility).toBe('visible')
    expect(Number.parseFloat(bubble().style.top)).toBe(120 + 8)
  })

  it('with no row open the panel stands above the word as before, and so does a word far from the capsule', async () => {
    open(FILL)
    bubbleH = 30
    bubbleW = 200
    cursorTop = 300
    await pick('Мачту')
    expect(Number.parseFloat(bubble().style.top)).toBe(300 - 30 - 8)
    cursorTop = 70
    await pick('Вторая')
    // (no row: the capsule ends at 46, the scroller at 52: 70 - 38 = 32 is not free)
    expect(Number.parseFloat(bubble().style.top)).toBe(90 + 8)
  })

  it('a word in a cell: «A ⌄» puts the circles on the panel, the row «Таблица» and the capsule stay, the circles are no window', async () => {
    open(FILL)
    bubbleH = 30
    bubbleW = 200
    cursorTop = 300
    await pick('Мачту')
    q<HTMLElement>('.bubble [data-cmd="color"]').click()
    await tick()
    const row = bubble().querySelector('.cr')!
    expect(row.querySelectorAll('.sw-b')).toHaveLength(9)
    expect(row.getAttribute('data-kind')).toBe('color')
    expect(root.querySelector('[role=dialog]')).toBeNull()
    expect(q('.tl-row [data-cmd="row-add"]')).not.toBeNull()
    expect(root.querySelector('.isle-tools .cr:not(.is-leaving)')).toBeNull()
    expect(root.querySelectorAll('.isle-tools > .tl-main, .isle-tools > .tl-table')).toHaveLength(2)
    expect(page!.editor!.view.dom.querySelector('.fill-target')).toBeNull()
    row.querySelector<HTMLElement>('[aria-label="Красный"]')!.click()
    await tick()
    expect(page!.mirror!.text).toContain('[.hl-red]#Мачту#')
    expect(root.querySelector('.bubble .cr:not(.is-leaving)')).toBeNull()
    expect(q('.tl-row [data-cmd="row-add"]')).not.toBeNull()
  })

  it('the width of the panel changes with the name under the mouse: the panel is placed again; a word out of the table sideways hides it', async () => {
    const watchers: Array<() => void> = []
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(cb: () => void) {
          watchers.push(cb)
        }
        observe(): void {}
        disconnect(): void {}
      },
    )
    open(FILL)
    bubbleH = 30
    bubbleW = 200
    cursorTop = 300
    let asked = 0
    const view = page!.editor!.view
    const coords = view.coordsAtPos
    view.coordsAtPos = (pos: number) => (asked++, coords(pos))
    await pick('Мачту')
    expect(watchers.length).toBeGreaterThan(0)
    const before = asked
    bubbleW = 340
    for (const cb of watchers) cb()
    await tick()
    expect(asked).toBeGreaterThan(before)
    // the word went out of the table to the right (the table is scrolled across)
    view.coordsAtPos = () => ({ left: 300, right: 340, top: cursorTop, bottom: cursorTop + 20 })
    // the scroll of the frame of the table does not bubble: only the frame itself says it
    const frame = view.dom.querySelector('.tbl-scroll')!
    // (the word is inside the tab, 10..400, but outside the frame, 10..200)
    frame.dispatchEvent(new Event('scroll'))
    await tick()
    expect(bubble().style.visibility).toBe('hidden')
  })
})
