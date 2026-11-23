// a refusal of the visual editor (a link across two paragraphs, typing over a selected plate) is told in a message
// at the bottom of «Визуально»; the text of the document is as it was; the next command or typing removes the message.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { messagesOf } from '../src/messages.js'
import {
  choose,
  closePage,
  cursorIn,
  fixture,
  key,
  load,
  openPage,
  outgoing,
  selectAcross,
  selectPlate,
  selectText,
  stubNetwork,
  typeChar,
} from './helpers.js'

const messages = messagesOf('ru')

beforeEach(() => {
  outgoing.length = 0
  stubNetwork()
})
afterEach(closePage)

const start = fixture('editor/visual.adoc')

/** A refusal: a link over two paragraphs. */
async function refused() {
  const page = await openPage()
  selectAcross(page, 'открывается', 'Подробности')
  page.visual().commands.setLink('https://example.org/x')
  return page
}

describe('demo: the messages of refusals', () => {
  it('keeps the texts of the messages: fifteen, and five of lists, in Russian, as the demo had them', () => {
    expect(Object.keys(messages)).toEqual([
      'link-across-blocks',
      'link-overlap',
      'bad-target',
      'empty-selection',
      'no-link',
      'not-editable',
      'becomes-plate',
      'break-in-heading',
      'document-title',
      'join-meta',
      'inside-plate',
      'inside-construct',
      'collateral',
      'leading-blank',
      'unstable',
      'item-start',
      'item-has-items',
      'list-middle',
      'first-item',
      'top-level-item',
      'column-merged-all',
      'row-merged-all',
    ])
    expect(messages['link-across-blocks']).toBe(
      'Ссылку можно поставить только на текст одного абзаца: выделите слова внутри одного абзаца.',
    )
    expect(messages['not-editable']).toBe('Этот блок пока правится только в «Исходнике».')
    expect(messages['bad-target']).toBe('Этот адрес для ссылки не подходит.')
    expect(messages['break-in-heading']).toBe('Заголовок — одна строка: перенос строки ставится в абзаце.')
  })

  it('tells a refused link in the message at the bottom of «Визуально», and leaves the text as it was', async () => {
    const page = await openPage()
    expect(page.notice()).toBeNull()
    selectAcross(page, 'открывается', 'Подробности')
    page.visual().commands.setLink('https://example.org/x')
    expect(page.notice()).toBe(messages['link-across-blocks'])
    expect(page.text()).toBe(start)
    expect(page.cm().state.doc.toString()).toBe(start)
    // the place: in the window of «Визуально», after the scrolling text, in a live region that is read out
    const box = page.$('notice')
    expect(box.closest('.pane-visual')).not.toBeNull()
    expect(box.closest('#notice-live')!.getAttribute('aria-live')).toBe('polite')
    const pane = document.querySelector('.pane-visual')!
    expect(box.compareDocumentPosition(pane.querySelector('.vis-scroll')!) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy()
    // the cross: «Скрыть»
    expect(page.$('notice-x').getAttribute('aria-label')).toBe('Скрыть')
  })

  it('tells typing over a selected plate: «Этот блок пока правится только в «Исходнике».», the plate is as it was', async () => {
    const page = await openPage()
    const plate = selectPlate(page, 'DelimitedBlock')
    expect(plate.classList.contains('ProseMirror-selectednode')).toBe(true)
    typeChar(page, 'x')
    expect(page.notice()).toBe('Этот блок пока правится только в «Исходнике».')
    expect(page.text()).toBe(start)
    expect(page.cm().state.doc.toString()).toBe(start)
    expect(page.pm().dom.querySelector('.nota-code .code-src')!.textContent).toContain('"order"')
  })

  it('the next command removes the message: a button, the style, the history', async () => {
    const page = await refused()
    expect(page.notice()).not.toBeNull()
    selectText(page, 'приоритет')
    page.press('em')
    expect(page.notice()).toBeNull()
    page.press('undo')
    // a refusal again, then the style selector
    selectAcross(page, 'открывается', 'Подробности')
    page.visual().commands.setLink('https://example.org/x')
    expect(page.notice()).not.toBeNull()
    cursorIn(page, 'Кабинет открывается', 3)
    page.style.value = 'h3'
    page.style.dispatchEvent(new Event('change'))
    expect(page.notice()).toBeNull()
  })

  it('typing removes the message; moving the cursor, a modifier or copying do not', async () => {
    const page = await refused()
    const dom = page.pm().dom
    for (const [name, mods] of [
      ['ArrowLeft', {}],
      ['ArrowDown', { shift: true }],
      ['Home', {}],
      ['PageDown', {}],
      ['Shift', { shift: true }],
      ['Control', { ctrl: true }],
      ['Escape', {}],
      ['c', { ctrl: true }],
      ['a', { ctrl: true }],
    ] as const) {
      key(dom, name, mods)
      expect(page.notice(), name).toBe(messages['link-across-blocks'])
    }
    key(dom, 'x')
    expect(page.notice()).toBeNull()
  })

  it.each(['Enter', 'Backspace', 'Delete'])('%s is typing too: it removes the message', async (name) => {
    const page = await refused()
    expect(page.notice()).toBe(messages['link-across-blocks'])
    key(page.pm().dom, name)
    expect(page.notice()).toBeNull()
  })

  it('an input that the browser reports (beforeinput) removes the message', async () => {
    const page = await refused()
    page.pm().dom.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertText', data: 'x', bubbles: true, cancelable: true }))
    expect(page.notice()).toBeNull()
  })

  it('the cross hides the message and gives the cursor back to the text', async () => {
    const page = await refused()
    page.pm().dom.blur()
    page.$('notice-x').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(page.notice()).toBeNull()
    expect(page.pm().hasFocus()).toBe(true)
  })

  it('goes away with a new sample', async () => {
    const page = await refused()
    choose(page, 'inline')
    expect(page.notice()).toBeNull()
  })
})

/** Lays the table out as a grid for jsdom: columns 100 px wide, rows 30 px high, the frame at (100, 50). */
function layTable(): () => void {
  const proto = HTMLElement.prototype
  const orig = proto.getBoundingClientRect
  const box = (left: number, top: number, w: number, h: number): DOMRect =>
    ({ left, top, right: left + w, bottom: top + h, width: w, height: h, x: left, y: top, toJSON() {} }) as DOMRect
  proto.getBoundingClientRect = function (this: Element): DOMRect {
    const tbl = this.closest('.tbl')
    if (!tbl) return box(0, 0, 0, 0)
    const rows = tbl.querySelectorAll(':scope > .tbl-scroll > table > tbody > tr').length
    const cols = tbl.querySelector(':scope > .tbl-scroll > table > colgroup')?.children.length ?? 0
    if (this === tbl) return box(100, 30, cols * 100 + 2, rows * 30 + 22)
    if (this.classList.contains('tbl-scroll')) return box(100, 50, cols * 100 + 2, rows * 30 + 2)
    if (this.tagName === 'TR') return box(101, 51 + [...this.parentElement!.children].indexOf(this) * 30, cols * 100, 30)
    if (this.tagName === 'TD' || this.tagName === 'TH') {
      const tr = this.parentElement!
      let k = 0
      for (const td of Array.from(tr.children)) {
        if (td === this) break
        k += Number(td.getAttribute('colspan') ?? 1)
      }
      const r = [...tr.parentElement!.children].indexOf(tr)
      return box(101 + k * 100, 51 + r * 30, Number(this.getAttribute('colspan') ?? 1) * 100, 30)
    }
    return box(0, 0, 0, 0)
  }
  return () => void (proto.getBoundingClientRect = orig)
}

describe('demo: a grip of a column in a table with a cell merged over all of them', () => {
  it('tells in Russian that the column cannot be selected alone; nothing is selected, the text is as it was', async () => {
    const unlay = layTable()
    try {
      const page = await openPage()
      const text = '|===\n3+|a\n|b |c |d\n|===\n'
      await load(page, text)
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: 150, clientY: 70, bubbles: true }))
      await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
      const grip = document.querySelectorAll<HTMLElement>('.nota-grips .cg')[1]!
      grip.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }))
      expect(page.notice()).toBe(messages['column-merged-all'])
      expect(page.notice()).toMatch(/^Колонку нельзя выделить отдельно/)
      expect(page.pm().dom.querySelector('[aria-selected="true"]')).toBeNull()
      expect(page.text()).toBe(text)
    } finally {
      unlay()
    }
  })
})
