// the capsule with the colours and the row «Таблица», the windows of colour and of the fill of cells, the drop-downs of
// the code and of the admonition, the motion in the style sheet.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { TextSelection } from 'prosemirror-state'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type Rule, parseCss, styleOf } from '../../../react/test/cssrules.js'
import { type Page, startPage } from '../../src/webview/main.js'
import type { Locale, ToHost, ToTab } from '../../src/protocol.js'

const fixture = (name: string): string => readFileSync(join(import.meta.dirname, '../../../../quality/fixtures/editor', name), 'utf8')
const FILL = fixture('tables-fill.adoc')
const NESTED = fixture('tables-nested.adoc')
const CODE = fixture('code.adoc')
const BLOCKS = fixture('blocks.adoc')

let sent: ToHost[]
let root: HTMLElement
let page: Page | undefined
const api = { postMessage: (m: ToHost) => void sent.push(m) }
const host = (message: ToTab): void => void window.dispatchEvent(new MessageEvent('message', { data: message }))
const tick = async (ms = 50): Promise<void> => void (await vi.advanceTimersByTimeAsync(ms))

function open(text: string, locale: Locale = 'ru', mode: 'visual' | 'text' = 'visual'): Page {
  root = document.createElement('div')
  root.id = 'app'
  document.body.append(root)
  page = startPage(api, root, { mac: false })
  host({ type: 'init', text, version: 1, fileName: 'a.adoc', locale, outlineView: 'capsule', fileDir: '/work/docs', mode })
  page.flush()
  return page
}

/** The cursor at the end of the text of the text block `text` (or a selection of it). */
async function inText(text: string, select = false): Promise<void> {
  const view = page!.editor!.view
  let found = -1
  view.state.doc.descendants((node, pos) => {
    if (found < 0 && node.isTextblock && node.textContent.includes(text)) found = pos + 1 + node.textContent.indexOf(text)
    return found < 0
  })
  if (found < 0) throw new Error(`no «${text}»`)
  view.focus()
  view.dispatch(
    view.state.tr.setSelection(
      select ? TextSelection.create(view.state.doc, found, found + text.length) : TextSelection.create(view.state.doc, found + text.length),
    ),
  )
  await tick()
  // a selection brings the panel over it after a moment: the marks, the colours and the link are on it alone
  if (select) {
    await tick(300)
    await tick(300)
  }
}

/** The visible name on the style button (the other labels are hidden to keep the width). */
const visible = (b: Element): string => [...b.querySelectorAll('.tl-style-name > span:not([aria-hidden])')].map((l) => l.textContent).join('')
const q = <T extends HTMLElement>(selector: string): T => root.querySelector<T>(selector)!
const cmd = (name: string): HTMLButtonElement => q(`.isle-tools [data-cmd="${name}"]`)
/** A button of the panel over the selection. */
const bub = (name: string): HTMLButtonElement => q(`.bubble [data-cmd="${name}"]`)
const click = async (el: Element): Promise<void> => {
  el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  await tick()
}
const key = async (k: string, target: EventTarget = document): Promise<void> => {
  target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }))
  await tick()
}
const strip = (): string => root.querySelector('.notice-text')?.textContent ?? ''

beforeEach(() => {
  vi.useFakeTimers()
  sent = []
  page = undefined
  document.body.className = ''
  document.documentElement.lang = ''
  document.elementFromPoint = () => null
})
afterEach(() => {
  page?.destroy()
  document.body.textContent = ''
  vi.useRealTimers()
})

const DOC = 'Первое слово тут. Второе слово там.\n'

describe('«⋯» and the mode «Текст»', () => {
  it('there is no «⋯»: all that the capsule has is on the screen at once, in any tab', async () => {
    open(DOC)
    expect(root.querySelector('[data-cmd=more]')).toBeNull()
    expect(q('.isle-tools').hasAttribute('data-expanded')).toBe(false)
    expect([...root.querySelectorAll<HTMLElement>('.isle-tools .tl-main button')].map((b) => b.dataset.cmd)).toEqual(['insert', 'style', 'ul', 'ol', 'check'])
  })

  it('in «Текст» every button of the capsule is off and the capsule says so, with no row «Таблица»', async () => {
    open(FILL, 'ru', 'text')
    const buttons = [...root.querySelectorAll<HTMLButtonElement>('.isle-tools button')]
    expect(buttons.length).toBeGreaterThan(3)
    expect(buttons.every((b) => b.disabled)).toBe(true)
    expect(q('.isle-tools .tb-note').textContent).toBe('Режим «Текст»')
    expect(root.querySelector('.tl-row')).toBeNull()
  })
})

describe('the row of colours that goes', () => {
  it('after a pick the row of colours is gone at once, Enter and arrows reach the editor and the file changes once', async () => {
    open(DOC)
    await inText('Первое', true)
    await click(bub('color'))
    await click(q('.cr [aria-label="Синий"]'))
    expect(root.querySelector('.cr:not(.is-leaving)')).toBeNull()
    const text = page!.mirror!.text
    for (const k of ['Enter', 'ArrowRight', 'Escape']) {
      const event = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })
      document.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(false)
    }
    await tick(10)
    expect(page!.mirror!.text).toBe(text)
  })
})

describe('«Цвет текста ⌄» and «Заливка ⌄» in the capsule', () => {
  it('«A ⌄» opens the window under the button; «Синий» writes the role, closes it, and the stripe and the hint follow', async () => {
    open(DOC)
    await inText('Первое', true)
    await click(bub('color'))
    const dialog = q('.cr[aria-label="Цвет текста"]')
    expect(dialog.closest('.bubble')).not.toBeNull()
    expect([...dialog.querySelectorAll('.sw-b')].map((b) => b.getAttribute('aria-label'))).toEqual(['Без цвета', 'Красный', 'Оранжевый', 'Зелёный', 'Бирюзовый', 'Синий', 'Фиолетовый', 'Розовый', 'Серый'])
    expect(dialog.querySelector('.cr-name')!.textContent).toBe('Без цвета')
    expect(dialog.querySelector('.cr-src')).toBeNull()
    await click(dialog.querySelector('[aria-label="Синий"]')!)
    expect(page!.mirror!.text).toContain('[.hl-blue]#Первое# слово')
    expect(root.querySelector('.cr:not(.is-leaving)')).toBeNull()
    expect(bub('color').getAttribute('aria-label')).toBe('Цвет текста: Синий')
    expect(bub('color').hasAttribute('title')).toBe(false)
    expect(bub('color').querySelector('i')!.getAttribute('style')).toContain('--ap-tx-blue')
    await click(bub('color'))
    expect(q('[aria-label="Синий"]').getAttribute('aria-pressed')).toBe('true')
    expect(q('.cr .cr-name').textContent).toBe('Синий')
    expect(root.querySelector('.cr .cr-src, .cr .fp-code')).toBeNull()
  })

  it.each([['Оранжевый', 'orange'], ['Фиолетовый', 'purple'], ['Розовый', 'pink'], ['Бирюзовый', 'teal']])('«%s»: the label, the stripe and aria-pressed follow the new role', async (name, role) => {
    open(DOC)
    await inText('Первое', true)
    await click(bub('color'))
    await click(q(`.cr [aria-label="${name}"]`))
    expect(page!.mirror!.text).toContain(`[.hl-${role}]#Первое# слово`)
    expect(bub('color').getAttribute('aria-label')).toBe(`Цвет текста: ${name}`)
    expect(bub('color').querySelector('i')!.getAttribute('style')).toContain(`--ap-tx-${role}`)
    await click(bub('color'))
    expect(q(`[aria-label="${name}"]`).getAttribute('aria-pressed')).toBe('true')
    expect(q('[aria-label="Красный"]').getAttribute('aria-pressed')).toBe('false')
    expect(q('.cr .cr-name').textContent).toBe(name)
    expect(root.querySelector('.cr .cr-src, .cr .fp-code')).toBeNull()
  })

  it('Home and Enter pick «Без цвета» from the keyboard; Esc closes the window and leaves the selection', async () => {
    open('[.hl-blue]#Первое слово#\n')
    await inText('Первое', true)
    await click(bub('color'))
    await key('Home')
    await key('Enter')
    expect(page!.mirror!.text).toContain('[.hl-blue]#слово#')
    expect(page!.mirror!.text).not.toContain('[.hl-blue]#Первое')
    await inText('слово', true)
    await click(bub('fill'))
    expect(q('.cr').getAttribute('aria-label')).toBe('Заливка')
    await key('Escape')
    expect(root.querySelector('.cr:not(.is-leaving)')).toBeNull()
    expect(page!.editor!.view.state.selection.empty).toBe(false)
  })

  it('with nothing selected there is no button of colour on the screen, and the file stays', async () => {
    open(DOC)
    await inText('Первое')
    await tick(300)
    await tick(300)
    expect(root.querySelector('[data-cmd=color], [data-cmd=fill], .bubble')).toBeNull()
    expect(page!.mirror!.text).toBe(DOC)
  })

  it('with code selected the panel is not there, and the command says that the colour is not shown there', async () => {
    open(CODE)
    const view = page!.editor!.view
    let at = -1
    view.state.doc.descendants((node, pos) => {
      if (at < 0 && node.type.name === 'code_block') at = pos + 1
      return at < 0
    })
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, at, at + 2)))
    await tick(300)
    await tick(300)
    // on code the panel is not shown (a refusal of the command itself is the test of the package)
    expect(root.querySelector('.bubble')).toBeNull()
    page!.editor!.commands.setFill('hl-gray-bg')
    expect(strip()).toContain('Цвет здесь не показывается')
    expect(page!.mirror!.text).toBe(CODE)
  })
})

describe('the row «Таблица» and the fill of cells', () => {
  it('stands under the tools while the cursor is in a table, goes with Esc, and the floating panel is not there', async () => {
    open(FILL)
    expect(root.querySelector('.tl-row')).toBeNull()
    await inText('Мачту')
    const row = q('.tl-row')
    expect(row.getAttribute('role')).toBe('toolbar')
    expect(row.getAttribute('aria-label')).toBe('Таблица')
    expect(root.querySelector('.fl.tablebar')).toBeNull()
    await key('Escape', page!.editor!.view.dom)
    await tick(250)
    expect(root.querySelector('.tl-row')).toBeNull()
    await inText('Вторая')
    await tick(250)
    expect(root.querySelector('.tl-row')).toBeNull()
  })

  it('after the cursor leaves the table the row folds up for 0.18 s, is hidden from the page and gone after', async () => {
    open(FILL)
    await inText('Мачту')
    const buttons = root.querySelectorAll('.tl-row button').length
    expect(buttons).toBeGreaterThan(5)
    await inText('Вторая')
    const table = q('.tl-table')
    expect(table.classList.contains('is-leaving')).toBe(true)
    expect(table.getAttribute('aria-hidden')).toBe('true')
    expect(table.inert).toBe(true)
    expect(root.querySelectorAll('.tl-row button').length).toBe(buttons)
    await tick(100)
    expect(root.querySelector('.tl-table.is-leaving')).not.toBeNull()
    await tick(150)
    expect(root.querySelector('.tl-row')).toBeNull()
  })

  it('Esc folds the row up too', async () => {
    open(FILL)
    await inText('Мачту')
    await key('Escape', page!.editor!.view.dom)
    expect(root.querySelector('.tl-table.is-leaving')).not.toBeNull()
    await tick(250)
    expect(root.querySelector('.tl-row')).toBeNull()
  })

  it('coming back while it folds leaves one open row; cell to cell does not fold it', async () => {
    open(FILL)
    await inText('Мачту')
    await inText('Вторая')
    expect(root.querySelector('.tl-table.is-leaving')).not.toBeNull()
    await inText('Мачту')
    expect(root.querySelectorAll('.tl-row').length).toBe(1)
    const table = q('.tl-table')
    expect(table.classList.contains('is-leaving')).toBe(false)
    expect(table.hasAttribute('aria-hidden')).toBe(false)
    expect(table.inert).toBe(false)
    await tick(250)
    expect(root.querySelectorAll('.tl-row').length).toBe(1)
    await inText('0…100 %')
    expect(root.querySelector('.is-leaving')).toBeNull()
  })

  it('after coming back the button works (one edit), and the same element goes on without a new opening animation', async () => {
    open(FILL)
    await inText('Мачту')
    const before = q('.tl-table')
    await inText('Вторая')
    await inText('Мачту')
    expect(q('.tl-table')).toBe(before)
    expect(before.classList.contains('is-back')).toBe(true)
    const text = page!.mirror!.text
    await click(q('.tl-row [data-cmd="row-add"]'))
    expect(page!.mirror!.text).not.toBe(text)
  })

  it('a click on a button of the folding row does nothing to the file', async () => {
    open(FILL)
    await inText('Мачту')
    await inText('Вторая')
    const text = page!.mirror!.text
    q('.tl-row [data-cmd="row-add"]').click()
    await tick()
    expect(page!.mirror!.text).toBe(text)
  })

  it('from a cell to a cell of a nested table the row does not fold', async () => {
    open(NESTED)
    await inText('х')
    expect(root.querySelector('.tl-row')).not.toBeNull()
    await inText('Внутри ячейки первого уровня:')
    expect(root.querySelector('.is-leaving')).toBeNull()
    await inText('х')
    expect(root.querySelector('.is-leaving')).toBeNull()
    expect(root.querySelectorAll('.tl-row').length).toBe(1)
  })

  it('the labels are stacked in en, with an inactive button and on a deep heading too', async () => {
    open(FILL, 'en')
    await inText('Вторая')
    const labels = [...root.querySelectorAll('.tl-style-name > span')]
    expect(labels.map((l) => l.textContent)).toEqual(['Text', 'Heading 2', 'Heading 3', 'Heading 4', 'Heading 5', 'Heading 6'])
    expect(visible(q('.tl-style'))).toBe('Text')
    expect(q('.tl-style').getAttribute('aria-label')).toBe('Paragraph style')
  })

  it('the style button shows one label and hides the others from a screen reader', async () => {
    open(FILL)
    await inText('Вторая')
    const labels = [...root.querySelectorAll('.tl-style-name > span')]
    expect(labels.map((l) => l.textContent)).toEqual(['Текст', 'Заголовок 2', 'Заголовок 3', 'Заголовок 4', 'Заголовок 5', 'Заголовок 6'])
    const visible = labels.filter((l) => !l.hasAttribute('aria-hidden'))
    expect(visible.map((l) => l.textContent)).toEqual(['Текст'])
    expect(q('.tl-style').getAttribute('aria-label')).toBe('Стиль абзаца')
  })

  it('a filled cell: the class on td, the label is not shown, the button is pressed and named by the colour', async () => {
    open(FILL)
    await inText('0…100 %')
    const td = page!.editor!.view.dom.querySelector('td.cell-blue')!
    expect(td.textContent).toBe('0…100 %')
    expect(td.textContent).not.toContain('cell-')
    const b = cmd('cell-fill')
    expect(b.getAttribute('aria-pressed')).toBe('true')
    expect(b.getAttribute('aria-label')).toBe('Заливка ячейки: Голубая')
    expect(b.querySelector('i')!.getAttribute('style')).toContain('--ap-hl-blue')
    await inText('Бухта')
    expect(cmd('cell-fill').getAttribute('aria-pressed')).toBe('false')
    expect(cmd('cell-fill').getAttribute('aria-label')).toBe('Заливка ячейки')
    expect(cmd('cell-fill').hasAttribute('title')).toBe(false)
    // no «Заливка» of the text in the capsule: it is on the panel over a selection
    expect(root.querySelector('.isle-tools [data-cmd=fill]')).toBeNull()
  })

  it('the window of a merged yellow cell: «Розовая» changes only the word, one Cmd+Z gives the file back', async () => {
    open(FILL)
    await inText('Мачту')
    await click(cmd('cell-fill'))
    const dialog = q('.cr')
    expect(dialog.getAttribute('aria-label')).toBe('Заливка ячейки')
    // the circles stand in place of the row «Таблица» (its buttons are gone for the time), «‹ Таблица» leads back, the capsule keeps its two floors
    expect(dialog.closest('.tl-row')).not.toBeNull()
    expect(dialog.querySelector('.cr-back')!.getAttribute('aria-label')).toBe('Вернуть ряд «Таблица»')
    expect(dialog.querySelector('.cr-back')!.textContent).toBe('‹Таблица')
    expect(q('.tl-row [data-cmd="row-add"]')).toBeNull()
    expect(root.querySelectorAll('.isle-tools > .tl-main, .isle-tools > .tl-table')).toHaveLength(2)
    expect(page!.editor!.view.dom.querySelector('td.fill-target')).not.toBeNull()
    expect([...dialog.querySelectorAll('.sw-b')].map((b) => b.getAttribute('aria-label'))).toEqual([
      'Без заливки ячейки', 'Жёлтая', 'Зелёная', 'Голубая', 'Розовая', 'Фиолетовая', 'Серая',
    ])
    expect(dialog.querySelectorAll('.sw-b.dot')).toHaveLength(7)
    expect(dialog.querySelector('[aria-pressed=true]')!.getAttribute('aria-label')).toBe('Жёлтая')
    expect(dialog.querySelector('.cr-name')!.textContent).toBe('Жёлтая')
    expect(dialog.querySelector('.cr-src')).toBeNull()
    expect(dialog.textContent).not.toMatch(/\[\.cell-|\{empty\}|2\+|В тексте/)
    await click(dialog.querySelector('[aria-label="Розовая"]')!)
    expect(page!.mirror!.text).toBe(FILL.replace('2+|[.cell-yellow]', '2+|[.cell-pink]'))
    expect(root.querySelector('.cr:not(.is-leaving)')).toBeNull()
    expect(page!.editor!.view.dom.querySelector('.fill-target')).toBeNull()
    // the row «Таблица» is back
    expect(q('.tl-row [data-cmd="row-add"]')).not.toBeNull()
    expect(page!.editor!.view.dom.querySelector('td.cell-pink[colspan="2"]')).not.toBeNull()
    expect(cmd('cell-fill').getAttribute('aria-label')).toBe('Заливка ячейки: Розовая')
    expect(page!.editor!.tableAt()).not.toBeNull()
    const edits = sent.filter((m) => m.type === 'edit')
    expect(edits).toHaveLength(1)
  })

  it('an unfilled cell of the head: «Серая» puts the label at the start of its text; «Без заливки ячейки» takes it off', async () => {
    open(FILL)
    await inText('Участок')
    await click(cmd('cell-fill'))
    expect(q('.cr .cr-name').textContent).toBe('Без заливки ячейки')
    await click(q('.cr [aria-label="Серая"]'))
    expect(page!.mirror!.text).toBe(FILL.replace('|Участок', '|[.cell-gray]##{empty}##Участок'))
    expect(page!.editor!.view.dom.querySelector('th.cell-gray')).not.toBeNull()
    await click(cmd('cell-fill'))
    await click(q('.cr [aria-label="Без заливки ячейки"]'))
    expect(page!.mirror!.text).toBe(FILL)
  })

  it('several cells: «Заливка ячеек: 3», different fills ring nothing', async () => {
    open(FILL)
    await inText('Бухта')
    const dom = page!.editor!.view.dom
    const cell = [...dom.querySelectorAll('td, th')].find((x) => x.textContent === 'В порядке')!
    cell.dispatchEvent(new MouseEvent('mousedown', { shiftKey: true, bubbles: true, cancelable: true }))
    await tick()
    await click(cmd('cell-fill'))
    const dialog = q('.cr')
    expect(dialog.getAttribute('aria-label')).toBe('Заливка ячеек: 3')
    expect(dialog.querySelectorAll('[aria-pressed=true]')).toHaveLength(0)
    expect(dialog.querySelector('.cr-name')!.textContent).toBe('Разная')
    expect(dialog.querySelector('.cr-src')).toBeNull()
    expect(root.textContent).not.toContain('выбранная ляжет на все')
    // a circle under the mouse gives its name, the mouse going away brings «Разная» back
    const blue = dialog.querySelector('[aria-label="Голубая"]')!
    blue.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    await tick()
    expect(dialog.querySelector('.cr-name')!.textContent).toBe('Голубая')
    blue.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }))
    await tick()
    expect(dialog.querySelector('.cr-name')!.textContent).toBe('Разная')
    // several cells are framed by their own selection, no second frame
    expect(page!.editor!.view.dom.querySelector('.fill-target')).toBeNull()
    await click(dialog.querySelector('[aria-label="Зелёная"]')!)
    expect((page!.mirror!.text.match(/\[\.cell-green\]##\{empty\}##/g) ?? []).length).toBe(3)
    expect(sent.filter((m) => m.type === 'edit')).toHaveLength(1)
  })

  it('a cell with the literal style: the strip says it cannot be filled, the file stays', async () => {
    const text = '|===\nl|строка\n|b\n|===\n'
    open(text)
    await inText('строка')
    await click(cmd('cell-fill'))
    await click(q('.cr [aria-label="Голубая"]'))
    expect(strip()).toBe('Эту ячейку не залить: метка заливки была бы видна в тексте ячейки.')
    expect(page!.mirror!.text).toBe(text)
  })
})

describe('the drop-downs of the code and of the admonition', () => {
  it('the language of code: «YAML ⌄» in the corner, «j» «j» «Enter» writes only [source,javascript]', async () => {
    open(CODE)
    await inText('name: пример')
    const tag = q('[data-cmd=language]')
    expect(tag.textContent).toBe('YAML')
    await click(tag)
    const list = q('[role=listbox][aria-label="Язык"]')
    expect(list.querySelector('[aria-selected=true]')!.textContent).toBe('YAML')
    await key('j', list)
    await key('j', list)
    await key('Enter', list)
    expect(page!.mirror!.text).toBe(CODE.replace('[source,yml]', '[source,javascript]'))
    expect(q('[data-cmd=language]').textContent).toBe('JavaScript')
  })

  it('no button outside code', async () => {
    open(CODE)
    await inText('Код')
    expect(root.querySelector('[data-cmd=language]')).toBeNull()
  })

  it('the type of the admonition: the label is the button, «Внимание» in the row changes only the word and the label follows', async () => {
    open(BLOCKS)
    await inText('Простое примечание')
    const tag = q('[data-cmd=admonition]')
    expect(tag.textContent).toBe('Примечание.')
    expect(tag.getAttribute('aria-label')).toBe('Тип примечания: Примечание')
    expect(root.querySelector('.fl.blockbar button[data-cmd^="adm-"]')).toBeNull()
    await click(tag)
    const group = q('[role=radiogroup][aria-label="Тип примечания"]')
    expect([...group.querySelectorAll('[role=radio]')].map((o) => o.getAttribute('aria-label'))).toEqual(['Примечание', 'Совет', 'Важно', 'Внимание', 'Осторожно'])
    expect(root.querySelectorAll('.admpick [title]')).toHaveLength(0)
    await click(group.querySelector('[data-type=WARNING]')!)
    expect(page!.mirror!.text).toBe(BLOCKS.replace('NOTE: Простое', 'WARNING: Простое'))
    expect(q('[data-cmd=admonition]').textContent).toBe('Внимание.')
  })
})

describe('the style of the paragraph in the capsule', () => {
  it('«Текст ⌄»: six items, «Заголовок 4» is ticked and named on the button', async () => {
    open('== Раздел\n\nабзац\n\n==== Малый\n\nтекст\n')
    await inText('Малый')
    expect(visible(cmd('style'))).toBe('Заголовок 4')
    await click(cmd('style'))
    expect(q('[role=listbox] [aria-selected=true]').querySelector('.dd-label')!.textContent).toBe('Заголовок 4')
    expect([...root.querySelectorAll('[role=listbox] [role=option]')].map((o) => o.querySelector('.dd-label')!.textContent)).toEqual(['Текст', 'Заголовок 2', 'Заголовок 3', 'Заголовок 4', 'Заголовок 5', 'Заголовок 6'])
    await key('Escape', q('[role=listbox]'))
    await inText('Раздел')
    await click(cmd('style'))
    expect(q('[role=listbox] [aria-selected=true]').querySelector('.dd-label')!.textContent).toBe('Заголовок 2')
  })
})

describe('the panel of the sections at the strokes', () => {
  it('the open strokes have no frame, background or ring, and the rule beats the generic capsule rules', () => {
    const css = readFileSync(join(import.meta.dirname, '../../src/webview/style.css'), 'utf8')
    // the text of the «@container (min-width: 761px)» block only, up to its closing brace
    const start = css.indexOf('@container (min-width: 761px)')
    let depth = 0
    let end = css.indexOf('{', start)
    for (; end < css.length; end++) {
      if (css[end] === '{') depth++
      else if (css[end] === '}' && --depth === 0) break
    }
    const block = css.slice(start, end + 1)
    // the generic capsule rules stay, and the reset touches the strokes only
    expect(css).toMatch(/button\.isle\[aria-expanded="true"\] \{ border-color: var\(--ap-accent\); \}/)
    expect(css).toMatch(/button\.isle:hover:not\(:disabled\) \{ background: color-mix/)
    const reset = block.match(/(button\.isle\.isle-strokes\[aria-expanded="true"\][^{]*)\{[^}]*border-color: transparent[^}]*\}/)
    expect(reset).not.toBeNull()
    for (const sel of reset![1].split(',').map((s) => s.trim()).filter(Boolean)) {
      expect(sel).toMatch(/\.isle-strokes/)
      expect(sel).toMatch(/\[aria-expanded="true"\]|\.closing/)
    }
    for (const sel of (block.match(/[^{}]*\{[^}]*border-color: transparent[^}]*\}/g) ?? []).flatMap((r) => r.split('{')[0].split(','))) {
      if (/\bisle\b/.test(sel)) expect(sel).toMatch(/\.isle-strokes/)
    }
    // the focus on the strokes makes the rule between the columns accent, 2 px
    expect(block).toMatch(/\.isle-strokes\[aria-expanded="true"\]:focus-visible\) \.isle-left \.sections-card::before \{[^}]*width: 2px;[^}]*var\(--ap-accent\)/)
    const m = block.match(/button\.isle\.isle-strokes\[aria-expanded="true"\][^{]*\{([^}]*)\}/)
    expect(m).not.toBeNull()
    expect(m![1]).toMatch(/border-color: transparent/)
    expect(m![1]).toMatch(/background: transparent/)
    expect(m![1]).toMatch(/outline: none/)
    expect(block).toMatch(/button\.isle\.isle-strokes\[aria-expanded="true"\]:hover:not\(:disabled\)/)
    expect(block).toMatch(/\.ed-main:has\(\.sections-card\.closing\) button\.isle\.isle-strokes/)
    expect(block).not.toMatch(/\.isle-strokes\[aria-expanded="true"\]::after/)
  })

  it('no haze and no band under the row of capsules: the row is transparent, lies over the document and lets the mouse through', () => {
    const css = readFileSync(join(import.meta.dirname, '../../src/webview/style.css'), 'utf8')
    expect(css).not.toMatch(/\.ed-isles::(after|before)/)
    const row = css.match(/\.ed-isles \{[^}]*\}/)![0]
    expect(row).toMatch(/background: none/)
    expect(row).not.toMatch(/var\(--ap-canvas\)/)
    expect(row).toMatch(/position: absolute/)
    expect(row).toMatch(/pointer-events: none/)
    expect(css).toMatch(/\.isle-wrap \{[^}]*pointer-events: none/)
    expect(css).toMatch(/\.isle-wrap > \*, \.tools-root > \* \{ pointer-events: auto/)
  })

  it('the document makes room for the row of capsules and for the plate of a big file', () => {
    const css = readFileSync(join(import.meta.dirname, '../../src/webview/style.css'), 'utf8')
    expect(css).toMatch(/\.scroll \{[^}]*padding: calc\(30px \+ var\(--isles-h, 52px\) \+ var\(--strip-h, 0px\) \+ var\(--lead-extra, 0px\)\)/)
    expect(css).toMatch(/\.ed-source \.cm-content \{ padding-top: calc\(4px \+ var\(--isles-h, 52px\)/)
    expect(css).toMatch(/\.big-strip \{ position: absolute;/)
  })

  it('in a wide tab with strokes the capsule «Разделы» is hidden; the panel comes and goes by a transition of the clip that reduced motion switches off', () => {
    const css = readFileSync(join(import.meta.dirname, '../../src/webview/style.css'), 'utf8')
    expect(css).toMatch(/@container \(min-width: 761px\) \{\s*\.ed-main:has\(\.isle-strokes:not\(\[hidden\]\)\) \.isle-sections \{ display: none; \}/)
    expect(css).not.toMatch(/panel-open|panel-close/)
    // «[hidden] { display: none !important }» is global: the fold plays only if the closing rule is «!important» too
    expect(css).toMatch(/\[hidden\] \{ display: none !important; \}/)
    expect(css).toMatch(/\.sections-card\[hidden\] \{\s*display: flex !important;[^}]*transition: clip-path 0.17s/)
    expect(css).toMatch(/\.sections-card \{[^}]*transition: clip-path 0.22s/)
  })

  it('the card moves to the left edge only while the strokes are visible, and its height is limited', () => {
    const css = readFileSync(join(import.meta.dirname, '../../src/webview/style.css'), 'utf8')
    const wide = css.slice(css.indexOf('@container (min-width: 761px)'), css.indexOf('@container (max-width: 800px)'))
    const guard = '.ed-main:has(.isle-strokes:not([hidden]))'
    expect(wide).toContain(`${guard} .isle-left { position: static; }`)
    expect(wide).not.toMatch(/^\s*\.isle-left/m)
    // it stands in the middle of the tab's height (`--sec-top`), at 14 px, with the height the script measured
    expect(wide).toMatch(/position: fixed; left: 14px; top: var\(--sec-top, 10px\)/)
    expect(wide).toMatch(/height: var\(--sec-h, auto\); max-height: min\(calc\(100% - 70px\), 560px\)/)
    expect(wide).not.toMatch(/translateY|rail-h/)
    expect(wide).toMatch(/\.sections-card\[data-pinned\] \{ border-color: var\(--ap-accent\); \}/)
    expect(css).toMatch(/prefers-reduced-motion: reduce\) \{ \* \{ transition: none !important; animation: none !important; \} \}/)
  })
})

describe('the row «Таблица» stays when a card opens', () => {
  // a table between two sections, a broken link (a remark) inside of the table, so the card of remarks leaves the cursor in it, and a heading outside of the table
  const DOCR = '= Документ\n\n== Один\n\n|===\n|А |Б\n\na|Мачта\n\nСсылка <<нет>> тут\n|Бухта\n|===\n\n== Два\n\nКонец.\n'
  const strokes = (): HTMLElement => q('.isle-strokes')
  const fire = (el: Element, type: string): void => void el.dispatchEvent(new MouseEvent(type))
  const same = (table: Element): void => {
    expect(q('.isle-tools .tl-table')).toBe(table)
    expect(table.classList.contains('is-leaving')).toBe(false)
    expect(root.querySelector('.tl-row')).not.toBeNull()
  }

  it('the click on «Разделы», the second click, and the pinning click on the strokes keep the same row', async () => {
    open(DOCR)
    await inText('Мачта')
    const table = q('.tl-table')
    for (let i = 0; i < 2; i++) {
      await click(q('.isle-sections'))
      same(table)
    }
    expect(q('.sections-card').hidden).toBe(true)
    fire(strokes(), 'mouseenter')
    await tick(200)
    expect(q('.sections-card').hidden).toBe(false)
    same(table)
    await click(strokes())
    expect(strokes().hasAttribute('data-pinned')).toBe(true)
    same(table)
  })

  it('the click on «Замечания» opens its card, the row stays the same', async () => {
    open(DOCR)
    await inText('Мачта')
    const table = q('.tl-table')
    expect(q('.isle-remarks').classList.contains('has-remarks')).toBe(true)
    await click(q('.isle-remarks'))
    expect(q('.isle-remarks').getAttribute('aria-expanded')).toBe('true')
    same(table)
    await click(q('.isle-remarks'))
    same(table)
  })

  // plain cells: the text there can be selected and coloured; the remark is outside, so «Замечания» takes the cursor away (as it should)
  // the windows of the text colour and of the styles are shut for the cells (a cell is not a text block), so there they are tried in a paragraph
  const DOCP = '= Документ\n\n== Один\n\nАбзац для выбора. Ссылка <<нет>> тут.\n\n|===\n|А |Б\n\n|Мачта |Бухта\n|===\n'
  const dialog = (): boolean => root.querySelector('.cr') !== null
  const listbox = (): boolean => root.querySelector('[role=listbox]:not(.is-closed)') !== null
  const windows: [string, string, boolean, () => Promise<void>, () => boolean][] = [
    ['cell fill', DOCR, false, async () => void (await click(cmd('cell-fill'))), dialog],
    ['insert', DOCR, false, async () => void (await click(cmd('insert'))), () => root.querySelector('.blocklist') !== null],
  ]
  for (const isle of ['.isle-sections', '.isle-remarks']) {
    for (const [name, doc, select, openIt, isOpen] of windows) {
      it(`${isle} closes the window «${name}», the row stays`, async () => {
        open(doc)
        await inText('Мачта', select)
        const table = q('.tl-table')
        await openIt()
        expect(isOpen()).toBe(true)
        // a bare click, as the host calls «beforeOpen» from it: the window is closed by «closeWindows»
        q(isle).click()
        await tick(300)
        expect(isOpen()).toBe(false)
        expect(q('.isle-tools .tl-table')).toBe(table)
        expect(table.classList.contains('is-leaving')).toBe(false)
      })
    }
    it(`${isle} closes the window of the text colour (in a paragraph: the cells have none)`, async () => {
      open(DOCP)
      await inText('Абзац', true)
      await click(bub('color'))
      expect(dialog()).toBe(true)
      q(isle).click()
      await tick(300)
      expect(dialog()).toBe(false)
    })
    it(`${isle} closes the list of styles (in a paragraph: the cells have none)`, async () => {
      open(DOCP)
      await inText('Абзац')
      await click(cmd('style'))
      expect(listbox()).toBe(true)
      await click(q(isle))
      await tick(300)
      expect(listbox()).toBe(false)
    })
  }

  it('the row hidden by Esc stays hidden', async () => {
    open(FILL)
    await inText('Мачту')
    await key('Escape', page!.editor!.view.dom)
    await tick(250)
    expect(root.querySelector('.tl-row')).toBeNull()
    await click(q('.isle-sections'))
    expect(root.querySelector('.tl-row')).toBeNull()
  })

  it('the click on a section outside of the table folds the row once; the hover alone changes nothing', async () => {
    open(DOCR)
    await inText('Мачта')
    const table = q('.tl-table')
    fire(strokes(), 'mouseenter')
    await tick(200)
    expect(q('.sections-card').hidden).toBe(false)
    same(table)
    await tick(500)
    same(table)
    const items = [...root.querySelectorAll('.sections-card .tree-item')]
    const heading = items.find((i) => i.textContent!.includes('Два'))!
    heading.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await tick(50)
    expect(q('.tl-table').classList.contains('is-leaving')).toBe(true)
    await tick(250)
    expect(root.querySelector('.tl-row')).toBeNull()
    await tick(500)
    expect(root.querySelector('.tl-row')).toBeNull()
  })
})

describe('the style sheet: motion and reduced motion', () => {
  const react = readFileSync(join(import.meta.dirname, '../../../react/src/style.css'), 'utf8')
  const vscode = readFileSync(join(import.meta.dirname, '../../src/webview/style.css'), 'utf8')
  const css = `${react}\n${vscode}`
  const rules = (text: string): { sel: string; body: string }[] =>
    [...text.matchAll(/([^{}@]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1]!.trim(), body: m[2]! }))

  it('the new transitions and keyframes move only transform, opacity, visibility and grid-template-rows, within 0.07–0.25 s (0.85 s for the heading)', () => {
    // (the panel and the capsule move by `left` and `margin-left`, their size by `width` and `height`)
    const allowed = new Set(['transform', 'opacity', 'visibility', 'grid-template-rows', 'clip-path', 'left', 'margin-left'])
    const motion = [...css.matchAll(/transition:\s*([^;}]+)/g)].map((m) => m[1]!)
    expect(motion.length).toBeGreaterThan(5)
    for (const t of motion) {
      for (const part of t.split(/,(?![^()]*\))/)) {
        const [prop, dur] = part.trim().split(/\s+/)
        // (the older transitions of the document are not touched here)
        if (prop === 'none' || prop === 'all' || /^(background|color|border|box-shadow|width|height)/.test(prop!)) continue
        expect(allowed.has(prop!), part).toBe(true)
        const s = parseFloat(dur!)
        expect(s >= 0 && s <= 0.25, part).toBe(true)
      }
    }
    for (const m of css.matchAll(/@keyframes\s+(nota-[\w-]+)\s*\{([\s\S]*?\}\s*)\}/g)) {
      if (m[1] === 'nota-flash') continue
      expect(m[2]!.replace(/(opacity|transform|grid-template-rows)\s*:[^;}]+;?/g, '')).not.toMatch(/[a-z-]+\s*:/)
    }
    expect(css).toMatch(/\.sec-flash::after[^}]*0\.85s/)
  })

  it('cards, lists and windows come in with a shift of 4 px and a squeeze to 98.5 %, in 0.16–0.2 s, and go in 0.12 s', () => {
    expect(css).toMatch(/@keyframes nota-pop-in\s*\{\s*from\s*\{[^}]*translateY\(-4px\) scale\(0\.985\)/)
    expect(css).toMatch(/\.fl, \.pop \{ animation: nota-pop-in 0\.18s/)
    expect(css).toMatch(/\.card \{ animation: nota-pop-in 0\.18s/)
    expect(css).toMatch(/\.dd-list\.is-closed \{[^}]*0\.12s/)
    expect(css).toMatch(/\.dd-list \{[^}]*transition: opacity 0\.16s/)
  })

  it('the hover backdrop 0.12 s (0.08 s in a list), a pressed button 94 % in 0.07 s, the row «Таблица» 0.24 s, «Текст ⇄ Визуально» 6 px in 0.22 s, the arrow 0.17 s', () => {
    expect(css).toMatch(/opacity 0\.12s/)
    expect(css).toMatch(/\.dd-opt::before \{ transition-duration: 0\.08s/)
    expect(css).toMatch(/:active[^}]*scale\(0\.94\)/)
    expect(css).toMatch(/transition: transform 0\.07s/)
    expect(css).toMatch(/\.tl-table \{[^}]*animation: tl-in 0\.16s/)
    expect(css).toMatch(/@keyframes tl-in \{ from \{ opacity: 0; transform: translateY\(-4px\)/)
    expect(css).toMatch(/@keyframes nota-mode-in\s*\{\s*from\s*\{[^}]*translateY\(6px\)/)
    expect(css).toMatch(/\.mode-in \{ animation: nota-mode-in 0\.22s/)
    expect(css).toMatch(/\.coll-head svg \{ transition: transform 0\.17s/)
    expect(css).toMatch(/\.ed-visual\.smooth \{ scroll-behavior: smooth/)
  })

  it('a closed list is hidden with visibility and takes no clicks; reduced motion switches the motion off and the scroll is instant', () => {
    const closed = rules(css).find((r) => r.sel === '.dd-list.is-closed')!
    expect(closed.body).toMatch(/visibility:\s*hidden/)
    expect(closed.body).toMatch(/pointer-events:\s*none/)
    const reduced = [...css.matchAll(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/g), ...css.matchAll(/@media \(prefers-reduced-motion: reduce\) \{([^\n]*)\}/g)].map((m) => m[1]!).join('\n')
    expect(reduced).toMatch(/\.dd-list/)
    expect(reduced).toMatch(/\.tl-table/)
    expect(reduced).toMatch(/\.card/)
    expect(reduced).toMatch(/transition: none; animation: none/)
    expect(reduced).toMatch(/scroll-behavior: auto/)
    expect(css).not.toMatch(/Без анимаций|no-motion|reduce-motion-setting/i)
  })

  it('the row «Таблица» that goes fades out in 0.09 s and takes no clicks (the capsule closes it from below); with reduced motion it is hidden at once', () => {
    const leaving = rules(css).find((r) => r.sel === '.tl-table.is-leaving')!
    expect(leaving.body).toMatch(/opacity:\s*0/)
    expect(leaving.body).toMatch(/pointer-events:\s*none/)
    expect(leaving.body).toMatch(/opacity 0\.09s linear/)
    expect(css).toMatch(/\.tl-table \{[^}]*tl-in 0\.16s/)
    // the capsule goes to its size in 0.22 s (0.17 s back)
    expect(css).toMatch(/\.isle-tools\[data-morph="open"\] \{ transition: width 0\.22s[^}]*height 0\.22s/)
    expect(css).toMatch(/\.isle-tools\[data-morph="close"\] \{ transition: width 0\.17s[^}]*height 0\.17s/)
    const back = rules(css).find((r) => r.sel === '.tl-table.is-back')!
    expect(back.body).toMatch(/animation:\s*none/)
    expect(css.indexOf('.tl-table.is-back')).toBeLessThan(css.indexOf('.tl-table.is-leaving'))
    const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce) {', css.indexOf('.tl-table.is-leaving')))
    expect(reduced).toMatch(/\.tl-table, \.tl-table\.is-back, \.tl-table\.is-leaving[^{]*\{ transition: none; animation: none; \}/)
    expect(reduced).toMatch(/\.tl-table\.is-leaving \{ visibility: hidden; \}/)
  })

  it('a closed card or window stays 0.12 s hidden with visibility, takes no clicks and fades out; reduced motion switches it off', () => {
    const leaving = rules(css).find((r) => r.sel.endsWith('.is-leaving > .pop, .is-leaving > .card'))!
    expect(leaving.body).toMatch(/visibility:\s*hidden/)
    expect(leaving.body).toMatch(/pointer-events:\s*none/)
    expect(leaving.body).toMatch(/opacity:\s*0/)
    expect(leaving.body).toMatch(/transition: opacity 0\.12s[^;]*transform 0\.12s[^;]*visibility 0s 0\.12s/)
    expect(css).toMatch(/prefers-reduced-motion: reduce\) \{\s*\.card, \.is-leaving > \.pop, \.is-leaving > \.card/)
  })

  it('the row of colours does not fade and is no window: a pick takes it away at once, the buttons of its place come back', async () => {
    open(DOC)
    await inText('Первое', true)
    await click(bub('color'))
    expect(root.querySelector('.cr')).not.toBeNull()
    expect(root.querySelector('[role=dialog]')).toBeNull()
    expect(root.querySelector('.isle-tools .cr:not(.is-leaving)')).toBeNull()
    await click(q('.cr [aria-label="Синий"]'))
    expect(root.querySelector('.cr:not(.is-leaving)')).toBeNull()
    expect(root.querySelector('.leave')).toBeNull()
    await tick(300)
    await tick(300)
    expect(bub('color')).not.toBeNull()
  })
})

describe('the narrow tab: the rules of the style sheet', () => {
  const css = readFileSync(join(import.meta.dirname, '../../src/webview/style.css'), 'utf8')
  // (the webview of the test has no layout: the rules of the container query are read as text)
  const narrow = css.slice(css.indexOf('@container (max-width: 650px)'))
  const narrowEnd = narrow.slice(0, narrow.indexOf('\n}\n'))

  it('no «⋯», no hidden buttons, no second row of the capsule: the capsule is one line in a tab of any width', () => {
    expect(css).not.toMatch(/tl-more|tl-break|tl-fmt|data-expanded/)
    expect(narrowEnd).not.toMatch(/\.isle-tools[^{]*\{ display: none; \}/)
    expect(narrowEnd).not.toMatch(/\.isle-tools \.tl-main \{ flex-wrap/)
  })

  it('the row «Таблица» stays in one line at 390 px with buttons of 28 px, and wraps only in a tab narrower than 360 px', () => {
    expect(narrowEnd).toMatch(/\.tl-row \.tb-b \{ height: 28px; min-width: 28px;/)
    expect(narrowEnd).not.toMatch(/\.tl-row \{ flex-wrap: wrap; \}/)
    expect(css).toMatch(/@container \(max-width: 360px\) \{\s*\.tl-row \{ flex-wrap: wrap; \}/)
  })

  it('the panel over the selection is of the shape of the capsule, 28 px buttons in a narrow tab, and stays 8 px from the edges of the tab', () => {
    const rules = parseCss(css)
    expect(styleOf(rules, '.fl.bubble').get('border-radius')).toBe('var(--layer-radius-capsule)')
    expect(styleOf(rules, '.fl.bubble').get('padding')).toBe('0 var(--layer-pad)')
    expect(styleOf(rules, '.fl.bubble').get('min-height')).toBe('34px')
    expect(styleOf(rules, '.fl.bubble').get('max-width')).toBe('calc(100% - 16px)')
    expect(css).toMatch(/^\.fl\.bubble button:not\(\.dot\) \{ height: 30px; min-width: 30px; border-radius: 15px; \}/m)
    // the circles of the row are not buttons of the panel: no 30 px minimum turns them into ovals
    expect(styleOf(rules, '.fl.bubble .cr .sw-b.dot').get('min-width')).toBe('22px')
    expect(css).toMatch(/@container \(max-width: 650px\) \{\n {2}\.cr \{[\s\S]*?\.fl\.bubble button:not\(\.dot\), \.bubble \.cr-back \{ height: 28px; min-width: 28px; border-radius: 14px; \}/)
  })

  it('the list «Текст ⌄» opened from the keyboard has no ring of its own round it: the frame of the base and the mark of the item', () => {
    expect(css).toMatch(/\.dd-list\.pop:focus-visible \{ outline: none; \}/)
  })
})

describe('the icon of the fill of cells and the tight tab', () => {
  const css = readFileSync(join(import.meta.dirname, '../../src/webview/style.css'), 'utf8')
  const shared = readFileSync(join(import.meta.dirname, '../../../react/src/style.css'), 'utf8')
  const rule = (selector: string): string => (css + shared).match(new RegExp(`^${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{([^}]*)\\}`, 'm'))?.[1] ?? ''

  it('the icon is the table with a bucket: a 16 grid, a mask cut under the bucket, an own mask id for every copy', async () => {
    open(FILL)
    await inText('Мачту')
    const svg = cmd('cell-fill').querySelector<SVGElement>('.g-fill > svg')!
    expect(svg.getAttribute('viewBox')).toBe('0 0 16 16')
    expect(svg.querySelectorAll('rect').length).toBe(2)
    const mask = svg.querySelector('mask')!
    expect(svg.querySelector('g')!.getAttribute('mask')).toBe(`url(#${mask.id})`)
    expect(svg.querySelectorAll('path').length).toBeGreaterThanOrEqual(5)
    // every mask of the page has its own id
    const ids = new Set([...root.querySelectorAll('mask')].map((m) => m.id))
    expect(ids.size).toBe(root.querySelectorAll('mask').length)
  })

  it('the icon stands in the middle of the row: the same 16 px box as the neighbours, no offset in the rules', () => {
    expect(rule('.g-fill > svg')).toMatch(/width: 16px; height: 16px/)
    expect(rule('.tb-b')).toMatch(/align-items: center/)
    for (const sel of ['.g-tc, .g-fill', '.g-fill > svg']) expect(rule(sel)).not.toMatch(/margin|top:|translate|position: relative; top/)
    expect(rule('.g-tc, .g-fill')).toMatch(/height: 16px/)
    expect(rule('.tl-row')).toMatch(/align-items: center/)
    expect(rule('.isle-tools .tb-b')).toMatch(/height: 30px/)
    // the stripe hangs in the lower field of the button and does not move the icon
    expect(rule('.g-tc i, .g-fill i')).toMatch(/position: absolute/)
  })

  it('the right column of the row of capsules is not narrower than its capsule, so «2 замечания» cannot lie on the tools', () => {
    expect(rule('.ed-isles')).toMatch(/grid-template-columns: minmax\(0, 1fr\) auto minmax\(max-content, 1fr\)/)
  })

  it('the tight tab goes by steps: «Разделы» to the icon, then «● 2», then the narrow tab', () => {
    const at = (w: number): number => css.indexOf(`@container (max-width: ${w}px)`)
    expect(at(800)).toBeGreaterThan(-1)
    expect(at(720)).toBeGreaterThan(at(800))
    expect(at(650)).toBeGreaterThan(at(720))
    const step1 = css.slice(at(800), at(720))
    expect(step1).toMatch(/\.isle-sections \.isle-name[^{]*\{ display: none; \}/)
    expect(step1).not.toMatch(/rm-text/)
    const step2 = css.slice(at(720), css.indexOf('@container (max-width: 560px)'))
    expect(step2).toMatch(/\.rm-text::after \{ content: attr\(data-short\)/)
    expect(step2).not.toMatch(/tl-more/)
    // the narrow capsule is the same one line: nothing is hidden behind «⋯»
    expect(css.slice(at(650))).not.toMatch(/tl-more/)
  })
})

describe('the blocks of the style sheet', () => {
  const vscode = readFileSync(join(import.meta.dirname, '../../src/webview/style.css'), 'utf8')
  it('the admonitions are a stripe and a label, with no fill; the cells take the colours of the theme', () => {
    expect(vscode).toMatch(/\.doc \.adm \{[^}]*background: none/)
    for (const c of ['yellow', 'green', 'blue', 'pink', 'purple', 'gray'])
      expect(vscode).toContain(`.doc .tbl td.cell-${c}, .doc .tbl th.cell-${c} { background: var(--ap-hl-${c}); }`)
  })
})

describe('the catalog of blocks', () => {
  const CATALOG = fixture('blocks-catalog.adoc')

  it('opens in «Визуально» with the groups of the prototype and does not change the file', async () => {
    open(CATALOG)
    const dom = page!.editor!.view.dom
    expect(dom.querySelectorAll('.adm').length).toBeGreaterThanOrEqual(6)
    expect(dom.querySelectorAll('td.cell-blue, th.cell-blue').length).toBeGreaterThanOrEqual(4)
    for (const c of ['yellow', 'green', 'blue', 'pink', 'purple', 'gray']) expect(dom.querySelector(`.cell-${c}`), c).not.toBeNull()
    expect(dom.querySelector('td.cell-gray[colspan="2"]')).not.toBeNull()
    expect(dom.textContent).not.toContain('{empty}')
    expect(dom.querySelector('.nota-code')).not.toBeNull()
    expect(dom.querySelector('.nota-diagram')).not.toBeNull()
    expect([...dom.querySelectorAll('.image-plate.missing')].map((e) => e.textContent)).toContain('Нет файла img/missing.png')
    const head = dom.querySelector<HTMLElement>('.coll-head')!
    expect(head.getAttribute('aria-expanded')).toBe('false')
    head.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }))
    await tick()
    expect(dom.querySelector('.coll-head')!.getAttribute('aria-expanded')).toBe('true')
    expect(page!.mirror!.text).toBe(CATALOG)
    expect(sent.filter((m) => m.type === 'edit')).toEqual([])
  })
})

// the rounded corners of the selected cells, on the way of the drag and after it
describe('corners of the selected cells in the style sheet', () => {
  const css = readFileSync(join(import.meta.dirname, '../../src/webview/style.css'), 'utf8')
  it('rounds each corner cell as the table, and no drag rule changes the look of the cells', () => {
    const sides = { tl: 'top-left', tr: 'top-right', bl: 'bottom-left', br: 'bottom-right' }
    for (const [c, side] of Object.entries(sides)) {
      expect(css).toMatch(new RegExp(`\\.sel\\.c-${c}\\s*\\{[^}]*border-${side}-radius:\\s*calc\\(var\\(--nota-tbl-radius\\) - 1px\\)`))
    }
    expect(css).toMatch(/\.doc \.tbl-scroll\s*\{[^}]*--nota-tbl-radius:/)
    // (the rule of `::selection` is about the text, not the cells)
    for (const m of css.matchAll(/([^{}]*\.cells-(?:drag|on)(?![\w-]|\s*::selection)[^{}]*)\{([^}]*)\}/g)) {
      expect(m[2], m[1]).not.toMatch(/border-radius|box-shadow|background/)
    }
  })
})

// a merged cell keeps its lines — no `:last-child` rule cuts them
describe('lines of the merged cells in the style sheet', () => {
  const css = readFileSync(join(import.meta.dirname, '../../src/webview/style.css'), 'utf8')
  it('draws the left and top line on every cell, cuts none by position, frames the wrapper', () => {
    const cell = css.match(/\.doc \.tbl th, \.doc \.tbl td\s*\{([^}]*)\}/)?.[1] ?? ''
    expect(cell).toMatch(/border-left:\s*1px solid/)
    expect(cell).toMatch(/border-top:\s*1px solid/)
    expect(cell).not.toMatch(/border-(right|bottom)/)
    expect(css).not.toMatch(/\.tbl[^{}]*(th|td|tr):last-child/)
    expect(css).toMatch(/\.doc \.tbl-scroll\s*\{[^}]*border:\s*1px solid/)
  })
})

// everything that floats over the page is of one family: the base «плавающий слой» and the guard that keeps it
const REACT_CSS = readFileSync(join(import.meta.dirname, '../../../react/src/style.css'), 'utf8')
const TAB_CSS = readFileSync(join(import.meta.dirname, '../../src/webview/style.css'), 'utf8')
const px = (value: string | undefined): number => parseFloat(value ?? 'NaN')

/** The roots of the layer: a rule whose last compound selector has one of these classes sets the look of a floating thing. */
const ROOTS = ['isle', 'card', 'pop', 'fmtpop', 'linkpop', 'imagepop', 'dd-list', 'blkmenu', 'blkfield', 'slashmenu', 'fl', 'nota-tip', 'sw-tip', 'cr', 'admpick', 'adm-row']
const LOOK = ['background', 'background-color', 'border', 'border-color', 'border-radius', 'box-shadow']
/** The rules that may have a look of their own, and why. The selector is written as in the style sheet. */
type Exception = { file: 'react' | 'tab'; props: string[]; why: string }
const EXCEPTIONS: Record<string, Exception> = {
  '.adm-row': { file: 'react', props: ['border-radius'], why: 'the fallback of the demo: the plugin sets the radius of the capsules by the base (`.admpick .adm-row`)' },
  '.pop': { file: 'react', props: ['border-radius'], why: 'the fallback of the demo, which has no tokens of the plugin: the plugin takes it back by --ap-pop-* = the base' },
  '.fl': { file: 'react', props: ['border-radius'], why: 'the fallback of the demo: the plugin takes it back by --ap-pop-* = the base' },
  'body.vscode-high-contrast:not(.vscode-high-contrast-light) .nota-tip': { file: 'tab', props: ['background', 'border-color'], why: 'the high contrast of VS Code: black, the frame of the theme' },
}

/** The classes of the last compound selector: `a .b > c.d:hover` gives `c`, `d`. */
function lastClasses(selector: string): string[] {
  const compound = selector.split(/[\s>+~]+/).filter(Boolean).pop() ?? ''
  return [...compound.replace(/\[[^\]]*\]|\([^)]*\)/g, '').matchAll(/\.([\w-]+)/g)].map((m) => m[1]!)
}

/** What is wrong with the looks of the floating things in these rules: the selector and the property, or nothing. */
export function strayLooks(rules: Rule[], file?: 'react' | 'tab'): string[] {
  const bad: string[] = []
  const ok = /var\(--(layer-[\w-]+|ap-pop-[\w-]+|ap-accent)\b|^(none|transparent|0|inherit|unset)$/
  for (const rule of rules) {
    for (const selector of rule.selectors) {
      if (!lastClasses(selector).some((c) => ROOTS.includes(c))) continue
      for (const name of LOOK) {
        const value = rule.decl.get(name)
        if (value === undefined || ok.test(value)) continue
        const except = EXCEPTIONS[selector]
        if (except && file === except.file && except.props.includes(name)) continue
        bad.push(`${selector} { ${name}: ${value} }`)
      }
    }
  }
  return bad
}

describe('the base «плавающий слой»', () => {
  const rules = parseCss(TAB_CSS)
  const of = (selector: string) => styleOf(rules, selector)
  const blocks = [...TAB_CSS.matchAll(/\/\*[^*]*плавающий слой[\s\S]*?\*\/\s*([^{]+)\{([^}]*)\}/g)]

  it('is one block, marked by a comment, on `body` like the tokens of the themes', () => {
    expect(blocks).toHaveLength(1)
    expect(blocks[0]![1]!.trim()).toBe('body')
  })

  it('has the tokens: background, ink, frame, shadow, the radii, the paddings of the head and of the item', () => {
    const body = blocks[0]![2]!
    for (const token of [
      'layer-bg', 'layer-ink', 'layer-border', 'layer-shadow', 'layer-radius', 'layer-radius-capsule', 'layer-radius-card', 'layer-pad',
      'layer-head-pad', 'layer-opt-h', 'layer-opt-pad', 'layer-opt-radius',
    ])
      expect(body, token).toContain(`--${token}:`)
    // the values of the themes come by the tokens of the themes: no colour of its own
    expect(of('body').get('--layer-bg')).toBe('var(--ap-isle-bg)')
    expect(of('body').get('--layer-border')).toBe('var(--ap-rule-strong)')
    expect(of('body').get('--layer-ink')).toBe('var(--ap-ink)')
    expect(of('body').get('--layer-shadow')).toBe('none')
    // only the capsules and the strokes lie right on the text, so only they get a shadow
    expect(of('body').get('--layer-shadow-capsule')).toMatch(/var\(--ap-shadow-color\)/)
    expect(px(of('body').get('--layer-radius'))).toBe(14)
  })

  it('--ap-pop-* are the aliases of the base and of the tokens of the themes, in the light and in the dark block, with no colour of their own', () => {
    const want: Record<string, string> = {
      '--ap-pop-bg': 'var(--layer-bg)',
      '--ap-pop-ink': 'var(--layer-ink)',
      '--ap-pop-border': 'var(--layer-border)',
      '--ap-pop-shadow': 'var(--layer-shadow)',
      '--ap-pop-hover': 'var(--ap-chrome-hover)',
      '--ap-pop-muted': 'var(--ap-ink-muted)',
      '--ap-pop-on-bg': 'var(--ap-accent-soft)',
      '--ap-pop-on-ink': 'var(--ap-accent)',
      '--ap-pop-key': 'var(--ap-chrome-hover)',
    }
    const light = rules.find((r) => r.selectors.includes('body') && r.decl.has('--ap-canvas'))!
    const dark = rules.find((r) => r.selectors.includes('body[data-nota-theme="dark"]') && r.decl.has('--ap-canvas'))!
    for (const block of [light, dark]) for (const [k, v] of Object.entries(want)) expect(block.decl.get(k), k).toBe(v)
  })

  it('the capsules, the cards, the popup of the buttons, the windows and the lists take their look from the tokens', () => {
    for (const sel of ['.isle', '.card', '.nota-tip']) {
      const d = of(sel)
      const shadow = sel === '.isle' ? 'var(--layer-shadow-capsule)' : 'var(--layer-shadow)'
      expect(d.get('background'), sel).toBe('var(--layer-bg)')
      expect(d.get('border'), sel).toMatch(/var\(--layer-border\)/)
      expect(d.get('box-shadow'), sel).toBe(shadow)
      expect(d.get('border-radius'), sel).toMatch(/^var\(--layer-radius/)
    }
    for (const sel of ['.fmtpop', '.linkpop', '.imagepop', '.dd-list.pop']) {
      const d = of(sel)
      expect(d.get('background'), sel).toBe('var(--layer-bg)')
      expect(d.get('border-color'), sel).toBe('var(--layer-border)')
      expect(d.get('box-shadow'), sel).toBe('var(--layer-shadow)')
      expect(d.get('border-radius'), sel).toBe('var(--layer-radius)')
    }
  })

  it('the heads and the items of the lists and of the cards take their paddings from the base', () => {
    expect(of('.dd-list.pop').get('padding')).toBe('var(--layer-pad)')
    expect(of('.dd-list.pop .dd-head').get('padding')).toBe('var(--layer-head-pad)')
    expect(of('.dd-list.pop .dd-opt').get('padding')).toBe('var(--layer-opt-pad)')
    expect(of('.dd-list.pop .dd-opt').get('min-height')).toBe('var(--layer-opt-h)')
    expect(of('.dd-list.pop .dd-opt').get('border-radius')).toBe('var(--layer-opt-radius)')
    expect(of('.card-head').get('padding')).toBe('var(--layer-card-head-pad)')
    expect(of('.card-item').get('padding')).toBe('var(--layer-card-item-pad)')
  })

  it('the list: head in capitals with 1 px spacing, item 32 px with radius 9, padding 5, width from 188, a thin frame under the keys', () => {
    const body = of('body')
    expect(px(body.get('--layer-pad'))).toBe(5)
    expect(px(body.get('--layer-opt-h'))).toBe(32)
    expect(px(body.get('--layer-opt-radius'))).toBe(9)
    expect(px(of('.dd-list.pop').get('min-width'))).toBe(188)
    const head = of('.dd-list.pop .dd-head')
    expect(head.get('text-transform')).toBe('uppercase')
    expect(px(head.get('letter-spacing'))).toBe(1)
    expect(of('.dd-list.pop.kb .dd-opt.is-active').get('outline')).toMatch(/^1px solid var\(--ap-accent\)/)
  })

  it('the demo keeps its look: the package takes nothing of the plugin, the row of colours is only in the style sheet of the plugin', () => {
    const react = parseCss(REACT_CSS)
    expect(styleOf(react, '.fp-row').get('flex-wrap')).toBe('wrap')
    expect(styleOf(react, '.sw-b').get('border')).toMatch(/--ap-pop-border/)
    expect(REACT_CSS).not.toMatch(/--layer-|плавающий слой|\.cr\b/)
    expect(parseCss(REACT_CSS).find((r) => r.selectors.includes('.pop'))!.decl.get('border-radius')).toBe('10px')
  })
})

describe('the guard of the base', () => {
  // the order of dist/style.css: the package first, the plugin after it
  const stray = (): string[] => [...strayLooks(parseCss(REACT_CSS), 'react'), ...strayLooks(parseCss(TAB_CSS), 'tab')]

  it('every look of a floating thing in the two style sheets is the base, --ap-pop-*, the accent, none or transparent (or an exception with a reason)', () => {
    expect(stray()).toEqual([])
  })

  it('every exception is a rule that is in the style sheets, and has a reason', () => {
    for (const [selector, { file, props, why }] of Object.entries(EXCEPTIONS)) {
      expect(why.length, selector).toBeGreaterThan(10)
      const rules = parseCss(file === 'react' ? REACT_CSS : TAB_CSS)
      for (const name of props) expect(rules.some((r) => r.selectors.includes(selector) && r.decl.has(name)), `${selector} ${name}`).toBe(true)
    }
  })

  it('an exception is for its file and its property only: `.pop { background: #fff }` in the plugin is found', () => {
    expect(strayLooks(parseCss('.pop { background: #fff }'), 'tab')).toHaveLength(1)
    expect(strayLooks(parseCss('.pop { border-radius: 10px }'), 'tab')).toHaveLength(1)
    expect(strayLooks(parseCss('.pop { background: #fff }'), 'react')).toHaveLength(1)
    expect(strayLooks(parseCss('.pop { border-radius: 10px }'), 'react')).toEqual([])
  })

  it('names the selector of a window that has a background of its own', () => {
    for (const css of ['.linkpop { background: #fff }', '.dd-list.pop { border-color: var(--ap-rule) }', '.imagepop { border-radius: 10px }', '.isle-tools .card { box-shadow: 0 1px 2px red }']) {
      const found = strayLooks(parseCss(css))
      expect(found, css).toHaveLength(1)
      expect(found[0], css).toContain(css.split(' {')[0]!.split(' ').pop()!)
    }
    expect(strayLooks(parseCss('.linkpop { background: var(--layer-bg); border-color: var(--layer-border); box-shadow: none; border-radius: var(--layer-radius) }'))).toEqual([])
    expect(strayLooks(parseCss('.dd-list.pop .dd-opt { background: var(--ap-chrome-hover) }'))).toEqual([])
  })
})

describe('the row of colours in the style sheet', () => {
  const rules = parseCss(TAB_CSS)
  const of = (selector: string) => styleOf(rules, selector)
  // (the tab of the test has no layout: the rules of the container query are read as text)
  const narrow = TAB_CSS.slice(TAB_CSS.indexOf('@container (max-width: 650px) {\n  .cr {'))
  const narrowCss = narrow.slice(0, narrow.indexOf('\n}\n'))

  it('the circles: a ring of the accent on the chosen one, the frame and the ink of the base, «Без цвета» crossed out', () => {
    // the circle of the design, `.dot`: 22 px, the colour itself, a ring of 2 px of the capsule and 1.5 px of the accent on the chosen one
    expect(of('.cr .sw-b.dot').get('border-radius')).toBe('50%')
    expect(of('.cr .sw-b.dot').get('width')).toBe('22px')
    expect(of('.cr .sw-b.dot').get('height')).toBe('22px')
    expect(of('.cr .sw-b.dot').get('background')).toBe('var(--c)')
    expect(of('.cr .sw-b.dot[aria-pressed="true"]').get('box-shadow')).toBe('0 0 0 2px var(--layer-bg), 0 0 0 3.5px var(--ap-accent)')
    // a fill: the bright circle with a ring of its own
    expect(of('.cr .sw-b.dot.fill').get('background')).toBe('var(--sw)')
    expect(of('.cr .sw-b.dot.fill').get('box-shadow')).toBe('inset 0 0 0 1.5px var(--swr)')
    // the focus ring of a chosen circle stands off the ring «chosen» (3.5 px): the offset is 5 px and more
    expect(parseFloat(of('.kb .sw-b.dot.is-active[aria-pressed="true"]').get('outline-offset') ?? '0')).toBeGreaterThanOrEqual(5)
    expect(TAB_CSS).toMatch(/^\.cr \.sw-b\.dot:hover \{[^}]*transform: scale\(1\.12\);/m)
    expect(TAB_CSS).toMatch(/@media \(prefers-reduced-motion: reduce\) \{ \.cr \.sw-b\.dot:hover \{ transform: none; \} \}/)
    expect(of('.cr .sw-b.dot.none').get('background')).toMatch(/linear-gradient\(to top right.*var\(--ap-ink-muted\)/)
    expect(of('.cr').get('color')).toBe('var(--layer-ink)')
    // no letter in a circle: the old rules of the letters are gone
    expect(TAB_CSS).not.toMatch(/\.cr \.sw-r|\.cr \.sw-none/)
    // the label has one width
    expect(of('.cr-title').get('width')).toBe('58px')
    expect(of('.cr[data-kind="fill"] .cr-title').get('width')).toBe('64px')
    expect(of('.cr[data-kind="cell"] .cr-title').get('width')).toBe('116px')
  })

  // the narrow tab with the row of the cell colours is measured in a real Chrome: test/webview/isles-layout.test.ts

  it('one line: the row does not wrap and the circle does not shrink, and it is not higher than the buttons it replaces', () => {
    expect(of('.cr').get('white-space')).toBe('nowrap')
    expect(of('.cr .sw-b.dot').get('flex')).toBe('none')
    expect(px(of('.cr').get('min-height'))).toBeLessThanOrEqual(34)
  })

  it('390 px: the name of the circle takes the place of the label; the block of the name is not shown', () => {
    expect(narrowCss).toMatch(/\.cr-name \{ display: none; \}/)
    expect(narrowCss).toMatch(/\.cr\[data-hover\] \.cr-t-def \{ display: none; \}/)
    expect(narrowCss).toMatch(/\.cr\[data-hover\] \.cr-t-hov \{ display: inline; \}/)
  })

  it('390 px: the «‹», the label and ten circles (the fill) go into the capsule of a tab of 390 px in one line', () => {
    const size = [22]
    const gap = narrowCss.match(/\.cr-sw \{ gap: (\d+)px/)
    expect(gap).not.toBeNull()
    const circles = 10 * Number(size[0]) + 9 * Number(gap![1])
    // the capsule is 390 - 2 × 14 (the row of capsules) - 2 × 5 (its padding) - 2 (the frame) wide; «‹» 26, the label «Заливка» about 50, the gaps and the padding of the row 20
    expect(circles + 26 + 50 + 20).toBeLessThanOrEqual(390 - 28 - 10 - 2)
  })

  it('390 px: in the row of the cells «‹ Таблица» is only «‹», and 8 circles leave room for «Заливка ячеек: 4» in full', () => {
    expect(narrowCss).toMatch(/\.cr-back-t \{ display: none; \}/)
    const size = 22
    const gap = Number(narrowCss.match(/\.cr-sw \{ gap: (\d+)px/)![1])
    const free = 390 - 28 - 10 - 2 - (8 * size + 7 * gap) - 26 - 20
    // «Заливка ячеек: 4» at 12.5 px: about 6.5 px a letter
    expect(free).toBeGreaterThanOrEqual('Заливка ячеек: 4'.length * 6.5)
  })
})

describe('the circles of the row on the panel after the cascade', () => {
  const shared = readFileSync(join(import.meta.dirname, '../../../react/src/style.css'), 'utf8')
  it('a circle in the panel has no minimum wider than itself (the buttons of the panel do), and a chosen one keeps its focus ring off the ring «chosen»', () => {
    const style = document.createElement('style')
    style.textContent = shared + '\n' + TAB_CSS
    document.head.append(style)
    const host = document.createElement('div')
    host.innerHTML =
      '<div class="fl bubble has-row"><button id="b">B</button><div class="cr kb"><div class="cr-sw"><button id="d" class="sw-b dot is-active" aria-pressed="true"></button></div></div></div>'
    document.body.append(host)
    const dot = getComputedStyle(host.querySelector('#d')!)
    const btn = getComputedStyle(host.querySelector('#b')!)
    expect(btn.minWidth).toBe('30px')
    expect(dot.width).toBe('22px')
    expect(dot.minWidth).toBe('22px')
    expect(parseFloat(dot.outlineOffset)).toBeGreaterThanOrEqual(5)
    host.remove()
    style.remove()
  })
})

describe('the row of colours follows the selection in a cell', () => {
  const moveTo = async (from: number, to = from): Promise<void> => {
    const view = page!.editor!.view
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)))
    await tick()
  }

  it('the cursor goes elsewhere in the same cell, or out of the table: the row «Таблица» is back, no frame, no edit', async () => {
    open(FILL)
    await inText('Мачту')
    const at = page!.editor!.view.state.selection.from
    await click(cmd('cell-fill'))
    expect(root.querySelector('.cr')).not.toBeNull()
    await moveTo(at - 2)
    expect(root.querySelector('.cr:not(.is-leaving)')).toBeNull()
    expect(q('.tl-row [data-cmd="row-add"]')).not.toBeNull()
    expect(page!.editor!.view.dom.querySelector('.fill-target')).toBeNull()
    expect(sent.filter((m) => m.type === 'edit')).toHaveLength(0)
    await click(cmd('cell-fill'))
    expect(root.querySelector('.cr')).not.toBeNull()
    await moveTo(1)
    expect(root.querySelector('.cr:not(.is-leaving)')).toBeNull()
    expect(page!.editor!.view.dom.querySelector('.fill-target')).toBeNull()
    expect(sent.filter((m) => m.type === 'edit')).toHaveLength(0)
  })

  it('another cell (a click into it, Tab, a transaction): the row «Таблица» is back, no frame, no edit', async () => {
    for (const how of ['click', 'tab', 'tr'] as const) {
      sent = []
      page?.destroy()
      document.body.textContent = ''
      open(FILL)
      await inText('Бухта')
      await click(cmd('cell-fill'))
      expect(root.querySelector('.cr')).not.toBeNull()
      if (how === 'click') {
        const view = page!.editor!.view
        const cell = [...view.dom.querySelectorAll('td, th')].find((x) => x.textContent === 'В порядке')!
        cell.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
        await moveTo(view.posAtDOM(cell, 0) + 1)
      } else if (how === 'tab') {
        page!.editor!.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
        await tick()
      } else {
        await moveTo(page!.editor!.view.state.selection.from + 12)
      }
      // (the circles that go are held for a moment, inert: they are `.is-leaving`)
      expect(root.querySelector('.cr:not(.is-leaving)'), how).toBeNull()
      expect(q('.tl-row [data-cmd="row-add"]'), how).not.toBeNull()
      expect(page!.editor!.view.dom.querySelector('.fill-target'), how).toBeNull()
      expect(sent.filter((m) => m.type === 'edit'), how).toHaveLength(0)
    }
  })

  it('Shift+click on another cell changes how many cells are chosen: the row closes', async () => {
    open(FILL)
    await inText('Бухта')
    await click(cmd('cell-fill'))
    expect(root.querySelector('.cr')).not.toBeNull()
    const dom = page!.editor!.view.dom
    const cell = [...dom.querySelectorAll('td, th')].find((x) => x.textContent === 'В порядке')!
    cell.dispatchEvent(new MouseEvent('mousedown', { shiftKey: true, bubbles: true, cancelable: true }))
    await tick()
    expect(root.querySelector('.cr:not(.is-leaving)')).toBeNull()
    expect(q('.tl-row [data-cmd="row-add"]')).not.toBeNull()
    expect(dom.querySelector('.fill-target')).toBeNull()
    expect(sent.filter((m) => m.type === 'edit')).toHaveLength(0)
  })

  it('Shift+arrow from the text of the cell is not taken by the row; the selection widens and the row closes', async () => {
    open(FILL)
    await inText('Мачту')
    const at = page!.editor!.view.state.selection.from
    await click(cmd('cell-fill'))
    const event = new KeyboardEvent('keydown', { key: 'ArrowLeft', shiftKey: true, bubbles: true, cancelable: true })
    page!.editor!.view.dom.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
    await moveTo(at - 1, at)
    expect(root.querySelector('.cr:not(.is-leaving)')).toBeNull()
    expect(q('.tl-row [data-cmd="row-add"]')).not.toBeNull()
  })

  it('the frame of the target does not close the row', async () => {
    open(FILL)
    await inText('Мачту')
    await click(cmd('cell-fill'))
    page!.editor!.markFillTarget(true)
    await tick()
    expect(root.querySelector('.cr')).not.toBeNull()
  })
})
