// the look «Лист»: three capsules over the document, the card of a remark, the mode «Текст», the texts.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type Page, startPage } from '../../src/webview/main.js'
import type { Locale, Mode, ToHost, ToTab } from '../../src/protocol.js'

const SHEET = readFileSync(join(import.meta.dirname, '../../../../quality/fixtures/editor/sheet.adoc'), 'utf8')

let sent: ToHost[]
let root: HTMLElement
let page: Page | undefined

const api = { postMessage: (m: ToHost) => void sent.push(m) }
const host = (message: ToTab): void => void window.dispatchEvent(new MessageEvent('message', { data: message }))
const tick = async (ms = 50): Promise<void> => void (await vi.advanceTimersByTimeAsync(ms))

function open(text: string, extra: { locale?: Locale; mode?: Mode; big?: { bytes: number } } = {}): Page {
  root = document.createElement('div')
  root.id = 'app'
  document.body.append(root)
  page = startPage(api, root, { mac: false })
  host({
    type: 'init',
    text,
    version: 1,
    fileName: 'sheet.adoc',
    locale: extra.locale ?? 'ru',
    outlineView: 'capsule',
    fileDir: '/work/docs',
    mode: extra.mode ?? 'visual',
    ...(extra.big ? { big: extra.big } : {}),
  })
  page.flush()
  return page
}

beforeEach(() => {
  vi.useFakeTimers()
  sent = []
  page = undefined
  document.body.className = ''
  document.elementFromPoint = () => null
})
afterEach(() => {
  page?.destroy()
  document.body.textContent = ''
  document.documentElement.lang = ''
  vi.useRealTimers()
})

const q = <T extends HTMLElement>(selector: string): T => root.querySelector<T>(selector)!
const remarksIsle = (): HTMLButtonElement => q('.isle-remarks')
const card = (): HTMLElement => q('.remark-card')

describe('the row of capsules', () => {
  it('holds three capsules and the round one over the scrolling area, in order: sections, tools, remarks, settings', () => {
    open(SHEET)
    const row = q('.ed-isles')
    const isles = [...row.querySelectorAll('.isle')]
    expect(isles).toHaveLength(4)
    expect(isles[3]!.classList.contains('isle-settings')).toBe(true)
    expect(isles[0]!.classList.contains('isle-sections')).toBe(true)
    expect(isles[1]!.getAttribute('role')).toBe('toolbar')
    expect(isles[2]!.classList.contains('isle-remarks')).toBe(true)
    expect(row.querySelector('.scroll')).toBeNull()
    expect(row.nextElementSibling!.classList.contains('big-strip') || row.nextElementSibling!.classList.contains('scroll')).toBe(true)
    expect(q('.isle-sections .isle-name').textContent).toBe('Метеостанция «Сойка»')
    expect(q('.isle-remarks .rm-text').textContent).toBe('2 замечания')
  })

  it('has no tree, rail, undo/redo, colour buttons or paper any more', () => {
    open(SHEET)
    for (const gone of ['.ed-tree', '.tree-rail', '.tree-hide', '.rail-badge', 'select'])
      expect(root.querySelector(gone), gone).toBeNull()
    for (const name of ['Отменить', 'Повторить']) expect(root.querySelector(`.ed-isles [aria-label="${name}"]`)).toBeNull()
    // nothing is shown at the bottom until a refusal
    expect(q('.notice').hidden).toBe(true)
    expect(q('.notice.crash').hidden).toBe(true)
  })

  it('the file of the sheet has the three sections of the design, two remarks, a number on «Показания» and «Сдача смены»', () => {
    open(SHEET)
    const names = [...root.querySelectorAll('.tree-item')].map((e) => e.textContent)
    expect(names).toContain('Установка')
    expect(names).toContain('Показания')
    expect(names).toContain('Сдача смены')
    const counted = [...root.querySelectorAll('.tree-badge')].map((b) => b.closest('.tree-row')!.querySelector('.tree-item')!.textContent)
    expect(counted).toEqual(['Показания', 'Сдача смены'])
    expect(page!.mirror!.text).toBe(SHEET)
    expect(sent.filter((m) => m.type === 'edit')).toEqual([])
  })
})

describe('the card of a remark', () => {
  it('opens under the right capsule on «1 из 2», «Следующее» goes on and wraps, «Закрыть» takes it away', () => {
    open(SHEET)
    expect(card().hidden).toBe(true)
    remarksIsle().click()
    expect(card().hidden).toBe(false)
    expect(remarksIsle().getAttribute('aria-expanded')).toBe('true')
    expect(q('.remark-title').textContent).toBe('Предупреждение · 1 из 2')
    expect(q('.remark-text').textContent).toBe('Ссылка ведёт на «codes», а такого раздела или якоря в документе нет')
    expect(page!.editor!.selectionOffsets()!.head).toBeGreaterThanOrEqual(SHEET.indexOf('<<codes'))
    q('.remark-next').click()
    expect(q('.remark-title').textContent).toBe('Предупреждение · 2 из 2')
    expect(q('.remark-text').textContent).toContain('journal')
    expect(page!.editor!.selectionOffsets()!.head).toBeGreaterThanOrEqual(SHEET.indexOf('<<journal'))
    q('.remark-next').click()
    expect(q('.remark-title').textContent).toBe('Предупреждение · 1 из 2')
    q('.remark-close').click()
    expect(card().hidden).toBe(true)
    expect(remarksIsle().getAttribute('aria-expanded')).toBe('false')
    expect(root.querySelector('.diag-on')).toBeNull()
  })

  it('marks the place of the remark and takes the mark away with the card', () => {
    open(SHEET)
    remarksIsle().click()
    const marked = root.querySelectorAll('.diag-on')
    expect(marked).toHaveLength(1)
    expect(marked[0]!.textContent).toBe('коды ошибок')
    q('.remark-next').click()
    expect(root.querySelector('.diag-on')!.textContent).toBe('журнал')
    expect(root.querySelectorAll('.diag-on')).toHaveLength(1)
    remarksIsle().click()
    expect(card().hidden).toBe(true)
    expect(root.querySelector('.diag-on')).toBeNull()
  })

  it('closes with Esc and with a press elsewhere', () => {
    open(SHEET)
    remarksIsle().click()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(card().hidden).toBe(true)
    remarksIsle().click()
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    expect(card().hidden).toBe(true)
  })

  it('a click on the wavy line opens the card on that remark', () => {
    open(SHEET)
    const mark = [...root.querySelectorAll<HTMLElement>('.doc .diag')].find((el) => el.textContent === 'журнал')!
    mark.click()
    expect(card().hidden).toBe(false)
    expect(q('.remark-title').textContent).toBe('Предупреждение · 2 из 2')
  })

  it('the card «Разделы» has no total line: the counters of sections stay, a click on one opens the first remark', () => {
    open(SHEET)
    q('.isle-sections').click()
    expect(root.querySelector('.tree-total')).toBeNull()
    expect(root.querySelector('.tree-foot')).toBeNull()
    expect(root.querySelector('.sections-card')!.textContent).not.toContain('в документе')
    expect(root.querySelectorAll('.sections-card .tree-badge').length).toBeGreaterThan(0)
    q('.sections-card .tree-badge').click()
    expect(card().hidden).toBe(false)
    expect(q('.sections-card').hidden).toBe(true)
  })

  it('without remarks says «Замечаний нет» and does not open', () => {
    open('= Документ\n\nПросто текст.\n')
    expect(q('.isle-remarks .rm-text').textContent).toBe('Замечаний нет')
    expect(remarksIsle().classList.contains('has-remarks')).toBe(false)
    remarksIsle().click()
    expect(card().hidden).toBe(true)
  })

  it('opening one card closes the other', () => {
    open(SHEET)
    q('.isle-sections').click()
    remarksIsle().click()
    expect(q('.sections-card').hidden).toBe(true)
    expect(card().hidden).toBe(false)
    q('.isle-sections').click()
    expect(card().hidden).toBe(true)
    expect(q('.sections-card').hidden).toBe(false)
  })
})

describe('the mode «Текст»', () => {
  it('keeps the capsules, turns the tools and the sections off, and «Замечания» bring the tab back', () => {
    open(SHEET)
    page!.toggleMode()
    expect(page!.mode).toBe('text')
    expect(root.querySelector('.cm-lineNumbers')).not.toBeNull()
    expect(root.querySelectorAll('.ed-isles .isle')).toHaveLength(4)
    for (const b of root.querySelectorAll<HTMLButtonElement>('.ed-isles [role=toolbar] button')) expect(b.disabled).toBe(true)
    // the gear is not turned off with the tools
    expect(q<HTMLButtonElement>('.isle-settings').disabled).toBe(false)
    expect(q('.tb-note').textContent).toBe('Режим «Текст»')
    expect(q<HTMLButtonElement>('.isle-sections').disabled).toBe(true)
    expect(q('.isle-strokes').hidden).toBe(true)
    expect(q('.isle-remarks .rm-text').textContent).toBe('2 замечания')
    remarksIsle().click()
    expect(page!.mode).toBe('visual')
    expect(card().hidden).toBe(false)
    expect(q('.remark-title').textContent).toBe('Предупреждение · 1 из 2')
    expect(root.querySelector('.tb-note')).toBeNull()
  })

  it('«Текст» closes the open card of a remark, and a fix of the source does not bring «Визуально» back', async () => {
    open(SHEET)
    remarksIsle().click()
    expect(card().hidden).toBe(false)
    page!.toggleMode()
    expect(page!.mode).toBe('text')
    expect(card().hidden).toBe(true)
    expect(root.querySelector('.diag-on')).toBeNull()
    // the author fixes the link in the source
    const view = page!.source!.view
    const at = view.state.doc.toString().indexOf('<<codes')
    view.dispatch({ changes: { from: at, to: at + 7, insert: '<<install' } })
    page!.flush()
    await tick(200)
    expect(page!.mode).toBe('text')
    expect(card().hidden).toBe(true)
  })

  it('a click on the wavy line opens the card and keeps the cursor of the author', () => {
    open(SHEET)
    const mark = [...root.querySelectorAll<HTMLElement>('.doc .diag')].find((el) => el.textContent === 'журнал')!
    page!.editor!.setSelectionAtOffset(SHEET.indexOf('Установка') + 3)
    const before = page!.editor!.selectionOffsets()!.head
    mark.click()
    expect(card().hidden).toBe(false)
    expect(page!.editor!.selectionOffsets()!.head).toBe(before)
  })

  it('a big file opens in «Текст» with the strip under the row of capsules', () => {
    open(SHEET, { mode: 'text', big: { bytes: 1_400_000 } })
    expect(page!.mode).toBe('text')
    // the plate stands over the document under the row of capsules, after the document in the markup (its layer is above the handles)
    expect(q('.big-strip').previousElementSibling!.classList.contains('ed-source')).toBe(true)
    expect(q('.big-strip').hidden).toBe(false)
    q('.big-go').click()
    expect(page!.mode).toBe('visual')
    expect(q('.big-strip').hidden).toBe(true)
  })
})

describe('the texts in English', () => {
  it('names the capsules, the cards and the remark in English', async () => {
    document.documentElement.lang = 'en'
    open(SHEET, { locale: 'en' })
    expect(q('.isle-sections').getAttribute('title')).toBe('Sections')
    expect(q('.isle-remarks .rm-text').textContent).toBe('2 remarks')
    expect(q('.sections-card .card-head').textContent).toBe('Sections')
    q('.tl-plus').click()
    await tick()
    const insert = q('.blocklist')
    expect([...insert.querySelectorAll('[role=menuitem]')].map((b) => b.getAttribute('aria-label'))).toEqual([
      'Heading 2', 'Heading 3', 'Heading 4', 'Heading 5', 'Heading 6', 'Bulleted list', 'Numbered list', 'Checklist', 'Table', 'Code', 'Mermaid', 'Admonition', 'Collapsible block', 'Image',
    ])
    expect(insert.querySelector('.bl-foot')!.textContent).toBe('Faster: «/» in an empty line')
    expect(q('.tl-plus').getAttribute('aria-label')).toBe('Insert block')
    expect(q('.tl-style').getAttribute('aria-label')).toBe('Paragraph style')
    expect(root.querySelector('.tl-more')).toBeNull()
    remarksIsle().click()
    expect(q('.remark-title').textContent).toBe('Warning · 1 of 2')
    expect(q('.remark-next').textContent).toBe('Next')
    expect(q('.remark-close').textContent).toBe('Close')
    expect(root.querySelector('.sections-card')!.textContent).not.toContain('in the document')
  })
})

describe('the panel «Разделы» scrolls a long list', () => {
  const css = readFileSync(join(import.meta.dirname, '../../src/webview/style.css'), 'utf8')

  it('the column rule is more specific than «.card» (a grid), so the list scrolls inside the panel', () => {
    expect(css).toMatch(/\.card\.sections-card \{[^}]*display: flex; flex-direction: column; gap: 0;/)
    expect(css).toMatch(/\.tree-list \{[^}]*overflow: auto; flex: 1; min-height: 0;/)
    // the closed card stays a column too (it is laid out, only clipped)
    expect(css).toMatch(/\.sections-card\[hidden\] \{\s*display: flex !important;/)
  })

  it('the panel is not stretched to the strokes', () => {
    expect(css).not.toMatch(/min-height: var\(--rail-h/)
    expect(css).toMatch(/height: var\(--sec-h, auto\); max-height: min\(calc\(100% - 70px\), 560px\);/)
    expect(css).toMatch(/\.isle-sections\[data-empty\] \{ visibility: hidden; pointer-events: none; \}/)
  })
})

describe('the capsule of remarks is hidden without remarks', () => {
  const css = readFileSync(join(import.meta.dirname, '../../src/webview/style.css'), 'utf8')

  it('without remarks the whole capsule is invisible and out of reach, yet keeps its place and stays one of three', () => {
    expect(css).toMatch(/\.isle-remarks:not\(\.has-remarks\) \{ opacity: 0; visibility: hidden; pointer-events: none; \}/)
    // the place stays: no «display: none» on the capsule
    expect(css).not.toMatch(/\.isle-remarks[^{]*\{[^}]*display: none/)
    expect(css).not.toMatch(/\.isle-remarks:not\(\.has-remarks\) \.rm-dot/)
  })

  it('the first remark fades the capsule in; reduced motion switches the fade off', () => {
    expect(css).toMatch(/\.isle-remarks \{ transition: opacity 0.16s ease, visibility 0.16s; \}/)
    expect(css).toMatch(/prefers-reduced-motion: reduce\) \{ \* \{ transition: none !important; animation: none !important; \} \}/)
  })

  it('the class follows the number of remarks', () => {
    const isle = (): HTMLElement => root.querySelector<HTMLElement>('.isle-remarks')!
    open('= Документ\n\nПросто текст.\n')
    expect(isle().classList.contains('has-remarks')).toBe(false)
    expect(root.querySelectorAll('.ed-isles .isle:not(.isle-strokes)').length).toBe(4)
  })
})

describe('the marks of the strokes', () => {
  it('fits 153 sections into the height of a panel: 2 sections share a stroke, the step is 7 px, the gap is not less than 2 px', async () => {
    const { fitMarks } = await import('../../src/webview/outline.js')
    const fit = fitMarks(153, 560 - 22)
    expect(fit).toEqual({ group: 2, marks: 77, step: 7, thick: 3 })
    for (const [n, h] of [[153, 300], [153, 800], [40, 200], [500, 560], [3, 560], [1, 100]] as const) {
      const f = fitMarks(n, h)
      expect(f.marks * f.thick + (f.marks - 1) * (f.step - f.thick), `${n} in ${h}`).toBeLessThanOrEqual(Math.max(h, f.thick))
      expect(f.step - f.thick, `${n} in ${h}`).toBeGreaterThanOrEqual(2)
      expect(f.marks).toBe(Math.ceil(n / f.group))
    }
  })

  it('a short document keeps the step of 12 px', async () => {
    const { fitMarks } = await import('../../src/webview/outline.js')
    expect(fitMarks(5, 538)).toMatchObject({ group: 1, marks: 5, step: 12, thick: 3 })
  })
})
