// the badge «i» instead of the islands of the header of a page, its card, «Open in Confluence», «Править шапку».
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type Page, startPage } from '../../src/webview/main.js'
import { formatUpdated } from '../../src/webview/pagemeta.js'
import type { Locale, ToHost, ToTab } from '../../src/protocol.js'

const FILE = readFileSync(join(import.meta.dirname, '../../../../quality/fixtures/editor/page-meta.adoc'), 'utf8')

let sent: ToHost[]
let root: HTMLElement
let page: Page | undefined
const api = { postMessage: (m: ToHost) => void sent.push(m) }
const host = (message: ToTab): void => void window.dispatchEvent(new MessageEvent('message', { data: message }))
const tick = async (ms = 50): Promise<void> => void (await vi.advanceTimersByTimeAsync(ms))

function open(text: string, locale: Locale = 'ru'): Page {
  root = document.createElement('div')
  root.id = 'app'
  document.body.append(root)
  page = startPage(api, root, { mac: false })
  host({ type: 'init', text, version: 1, fileName: 'p.adoc', locale, outlineView: 'capsule', fileDir: '/work/docs', mode: 'visual' })
  page.flush()
  return page
}

beforeEach(() => {
  vi.useFakeTimers()
  sent = []
  document.body.className = ''
  document.elementFromPoint = () => null
})
afterEach(() => {
  page?.destroy()
  page = undefined
  document.body.textContent = ''
  vi.useRealTimers()
})

const q = <T extends HTMLElement>(selector: string): T => root.querySelector<T>(selector)!
const badge = (): HTMLButtonElement => q('.pagemeta-badge')
const card = (): HTMLElement => q('.pagemeta-card')

describe('the badge of the header of a page', () => {
  it('has no island for the header, a badge with a name instead', () => {
    open(FILE)
    expect(root.querySelectorAll('.nota-island')).toHaveLength(0)
    expect(q('.doc h1').textContent).toBe('Sample page')
    expect(badge().hidden).toBe(false)
    expect(badge().getAttribute('aria-label')).toBe('Сведения о странице')
    open(FILE, 'en')
    expect(page!.pagemeta!.button.getAttribute('aria-label')).toBe('Page info')
  })

  it('has no badge and keeps the islands for a file without a header', () => {
    open(':toc:\n\n= T\n\nText\n')
    expect(badge().hidden).toBe(true)
    expect(root.querySelectorAll('.nota-island')).toHaveLength(1)
    root.remove()
    page!.destroy()
    open('Text first\n\n' + FILE.slice(0, FILE.indexOf('= Sample')) + '= T\n')
    expect(badge().hidden).toBe(true)
  })

  it('opens the card after a pause on hover, closes it after the pointer left', async () => {
    open(FILE)
    badge().dispatchEvent(new MouseEvent('mouseenter'))
    await tick(300)
    expect(card().hidden).toBe(true)
    await tick(150)
    expect(card().hidden).toBe(false)
    expect(q('.pm-path').textContent).toBe('Handbook › Guides')
    expect(q('.pm-title').textContent).toBe('Sample page')
    expect(card().textContent).toContain('Версия14')
    expect(card().textContent).toContain('Обновлено')
    expect(card().textContent).not.toContain('2026-10-03T')
    expect(q('.pm-link').textContent).toBe('Open in Confluence ↗')
    badge().dispatchEvent(new MouseEvent('mouseleave'))
    await tick(300)
    expect(card().hidden).toBe(true)
  })

  it('opens on a click, closes on a second click, on Esc (focus back) and on a click outside', async () => {
    open(FILE)
    badge().click()
    expect(card().hidden).toBe(false)
    badge().dispatchEvent(new MouseEvent('mouseleave'))
    await tick(400)
    expect(card().hidden).toBe(false)
    badge().click()
    expect(card().hidden).toBe(true)
    badge().click()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(card().hidden).toBe(true)
    expect(document.activeElement).toBe(badge())
    badge().click()
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    expect(card().hidden).toBe(true)
  })

  it('opens the link through openLink, only for http(s)', () => {
    open(FILE)
    badge().click()
    q('.pm-link').click()
    expect(sent).toContainEqual({ type: 'openLink', href: 'https://wiki.example.test/pages/viewpage.action?pageId=1000001' })
    page!.destroy()
    root.remove()
    open(FILE.replace('https://wiki', 'ftp://wiki'))
    badge().click()
    expect(root.querySelector('.pm-link')).toBeNull()
  })

  it('does not show a line without a value, tells when the card is empty', () => {
    open(FILE.replace('title: Sample page\n', '').replace(/ancestors:\n {2}- Handbook\n {2}- Guides\n/, 'ancestors: []\n'))
    badge().click()
    expect(root.querySelector('.pm-title')).toBeNull()
    expect(root.querySelector('.pm-path')).toBeNull()
    expect(card().textContent).toContain('Версия14')
    page!.destroy()
    root.remove()
    open('////\npage_id: 7\n////\n\n= T\n')
    badge().click()
    expect(q('.pm-empty').textContent).toBe('В шапке нет названия, версии и ссылки')
  })

  it('makes no request while the card opens and closes', () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    open(FILE)
    badge().click()
    badge().click()
    expect(fetchSpy).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('leaves the text as it is after the card and the modes', () => {
    open(FILE)
    badge().click()
    badge().click()
    page!.toggleMode()
    page!.toggleMode()
    page!.mirror!.flush()
    expect(page!.mirror!.text).toBe(FILE)
    expect(sent.filter((m) => m.type === 'edit')).toHaveLength(0)
  })

  it('«Править шапку» opens the header as an island, «Свернуть» puts the badge back with the new value', async () => {
    open(FILE)
    badge().click()
    q('.pm-edit').click()
    expect(badge().hidden).toBe(true)
    expect(document.activeElement).toBe(page!.editor!.view.dom)
    expect(root.querySelectorAll('.nota-island[data-kind="PageMeta"]').length).toBeGreaterThan(0)
    expect(q('.island-note span').textContent).toBe('Шапка страницы — правится как текст')
    expect(q('.nota-island[data-kind="PageMetaTail"] .island-note span').textContent).toBe('Шапка страницы, после заголовка')
    const editor = page!.editor!
    const head = editor.view.state.selection.$head
    editor.view.dispatch(editor.view.state.tr.insertText('5', head.pos - 1, head.pos))
    q('.island-collapse').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    expect(root.querySelectorAll('.nota-island')).toHaveLength(0)
    expect(badge().hidden).toBe(false)
    badge().click()
    expect(card().textContent).toContain('Версия15')
    page!.mirror!.flush()
    expect(page!.mirror!.text).toBe(FILE.replace('version: 14', 'version: 15'))
  })

  it('follows the header when it changes in the text', () => {
    open(FILE)
    const m = page!.mirror!
    const titleAt = FILE.indexOf('title: Sample page\n')
    m.apply([{ from: titleAt, to: titleAt + 'title: Sample page\n'.length, insert: '' }])
    badge().click()
    expect(root.querySelector('.pm-title')).toBeNull()
  })
})

describe('the title under the badge', () => {
  const CSS = readFileSync(join(import.meta.dirname, '../../src/webview/style.css'), 'utf8')

  it('has room for the badge also when the hidden header stands before it', () => {
    open(FILE)
    const doc = root.querySelector('.doc')!
    expect(doc.firstElementChild!.classList.contains('nota-page-meta')).toBe(true)
    expect(doc.firstElementChild!.nextElementSibling!.tagName).toBe('H1')
    expect(CSS).toMatch(/\.doc > \.nota-page-meta:first-child \+ h1[^{]*\{[^}]*padding-right: 36px/)
  })
})

describe('the date', () => {
  it('is told in the language, without the ISO form', () => {
    expect(formatUpdated('2026-10-03T11:20:00Z', 'ru')).toMatch(/^\d{1,2} октября 2026, \d{2}:\d{2}$/)
    expect(formatUpdated('2026-10-03T11:20:00Z', 'en')).toMatch(/^October \d{1,2}, 2026, \d{1,2}:\d{2}\s?[AP]M$/)
    expect(formatUpdated('yesterday', 'en')).toBe('yesterday')
  })
})

// the attributes after «Open in Confluence», the line «Оглавление страницы», «Параметры страницы» in the card.
describe('the zone after the link', () => {
  const BODY = readFileSync(join(import.meta.dirname, '../../../../quality/fixtures/editor/page-meta-body.adoc'), 'utf8')
  const NO_TOC = readFileSync(join(import.meta.dirname, '../../../../quality/fixtures/editor/page-meta-body-no-toc.adoc'), 'utf8')
  const chips = (): string[] => [...root.querySelectorAll('.pm-chip')].map((c) => c.textContent!)

  it('has no island, a narrow line and the badge', () => {
    open(BODY)
    expect(root.querySelectorAll('.nota-island')).toHaveLength(0)
    expect(q('.nota-toc .toc-label').textContent).toBe('Оглавление страницы')
    expect(q('.nota-toc .toc-src').textContent).toBe('toc::[]')
    expect(q('.nota-toc').getAttribute('aria-label')).toBe('Оглавление страницы')
    expect(root.querySelector('.doc')!.textContent).toContain('Open in Confluence')
    expect(badge().hidden).toBe(false)
    root.remove()
    page!.destroy()
    open(NO_TOC)
    expect(root.querySelectorAll('.nota-island')).toHaveLength(0)
    expect(root.querySelectorAll('.nota-toc')).toHaveLength(0)
  })

  it('tells the page settings in the card, in the order of the file', () => {
    open(BODY)
    badge().click()
    expect(q('.pm-params-label').textContent).toBe('Параметры страницы')
    expect(chips()).toEqual(['doctype: book', 'toc', 'source-highlighter: highlight.js', 'relfilesuffix: .adoc'])
    expect(card().textContent).toContain('Версия7')
    expect(q('.pm-params').nextElementSibling).toBe(q('.pm-edit'))
    root.remove()
    page!.destroy()
    open(BODY, 'en')
    badge().click()
    expect(q('.pm-params-label').textContent).toBe('Page settings')
    expect(q('.nota-toc .toc-label').textContent).toBe('Table of contents')
  })

  it('has no line of settings when nothing is hidden', () => {
    open(BODY.replace(/:doctype: book\n/, '').replace(/:toc:\n:source-highlighter: highlight.js\n\n:relfilesuffix: .adoc\n\n/, ''))
    badge().click()
    expect(root.querySelector('.pm-params')).toBeNull()
  })

  it('edits the header in place, collapses, and the card shows the new value; the file differs by one line', () => {
    open(BODY)
    const m = page!.mirror!
    page!.pagemeta!.button.click()
    q<HTMLButtonElement>('.pm-edit').click()
    expect(root.querySelectorAll('.nota-island[data-kind="PageMetaBody"]').length).toBeGreaterThan(0)
    expect(q('.nota-island[data-kind="PageMetaBody"] .island-note span').textContent).toBe('Шапка страницы, после ссылки')
    expect(root.querySelectorAll('.nota-toc')).toHaveLength(1)
    const at = m.text.indexOf('highlight.js')
    m.apply([{ from: at, to: at + 'highlight.js'.length, insert: 'rouge' }])
    q('.island-collapse').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    expect(root.querySelectorAll('.nota-island')).toHaveLength(0)
    badge().click()
    expect(chips()).toContain('source-highlighter: rouge')
    expect(m.text).toBe(BODY.replace('highlight.js', 'rouge'))
  })

  it('does not change the file when the card is opened and the modes are switched', () => {
    open(BODY)
    badge().click()
    badge().click()
    expect(page!.mirror!.text).toBe(BODY)
  })
})
