// the status line shows the length of the text, the diagnostics counted by level, and, with the cursor in «Исходник», the
// path of the nodes of Nota; «Исходник» marks the diagnostics on the gutter and under the text and lights the line of the cursor.
import { forceLinting } from '@codemirror/lint'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parse } from '@nota-adoc/core'
import { largeDocument } from '../src/samples.js'
import { choose, closePage, fixture, load, nf, openPage, outgoing, read, selectText, stubNetwork, type Page } from './helpers.js'

beforeEach(() => {
  outgoing.length = 0
  stubNetwork()
})
afterEach(closePage)

const levels = ['error', 'warning', 'info'] as const
const counted = (text: string) => {
  const counts = { error: 0, warning: 0, info: 0 }
  for (const d of parse(text).diagnostics) counts[d.severity]++
  return counts
}
const shownCounts = (page: Page) => ({ error: page.count('error'), warning: page.count('warning'), info: page.count('info') })
const zero = { error: '0', warning: '0', info: '0' }
const strings = (counts: Record<(typeof levels)[number], number>) => ({
  error: String(counts.error),
  warning: String(counts.warning),
  info: String(counts.info),
})

describe('demo: the status line', () => {
  it('shows the length of the text in characters', async () => {
    const page = await openPage()
    expect(page.length()).toBe(`${nf(fixture('editor/visual.adoc').length)} симв.`)
    expect(page.$('len').dataset.tip).toBe('Длина текста в символах')
    choose(page, 'large')
    const text = largeDocument()
    expect(text.length).toBeGreaterThan(900_000)
    expect(text.length).toBeLessThan(1_200_000)
    expect(page.length()).toBe(`${nf(text.length)} симв.`)
  }, 60_000)

  it('counts the diagnostics of «Диагностики» by level, and none in the samples that have none', async () => {
    const page = await openPage()
    expect(shownCounts(page)).toEqual(zero)
    choose(page, 'diagnostics')
    const counts = counted(fixture('editor/diagnostics.adoc'))
    expect(counts.error + counts.warning + counts.info).toBeGreaterThan(0)
    expect(shownCounts(page)).toEqual(strings(counts))
    // the marks that the page reads: the number as data, the words for the screen reader
    const names = { error: 'ошибок', warning: 'предупреждений', info: 'сообщений' }
    for (const level of levels) {
      const counter = document.querySelector<HTMLElement>(`.count[data-sev="${level}"]`)!
      expect(counter.dataset.n).toBe(String(counts[level]))
      expect(counter.getAttribute('aria-label')).toBe(`${names[level]}: ${counts[level]}`)
    }
    // «Все конструкции» (stage 2): no problems; «Строчная разметка» has cross references to targets that are not there on purpose
    choose(page, 'all')
    expect(shownCounts(page)).toEqual(zero)
    expect(document.querySelector<HTMLElement>('.count[data-sev="error"]')!.dataset.n).toBe('0')
  })

  it('names the levels in the tooltips of the counters', async () => {
    await openPage()
    const tips = [...document.querySelectorAll<HTMLElement>('.count')].map((c) => [c.dataset.sev, c.dataset.tip])
    expect(tips).toEqual([
      ['error', 'Ошибки'],
      ['warning', 'Предупреждения'],
      ['info', 'Сообщения'],
    ])
  })

  it('follows the text: an edit in «Исходник» changes the length and the counters', async () => {
    const page = await openPage()
    await load(page, '----\ncode\n----\n')
    expect(shownCounts(page)).toEqual(zero)
    const view = page.cm()
    view.dispatch({ changes: { from: 10, to: 15 }, userEvent: 'delete' }) // the closing delimiter is gone
    expect(shownCounts(page)).toEqual({ error: '0', warning: '1', info: '0' })
    expect(page.length()).toBe(`${nf(view.state.doc.length)} симв.`)
  })

  it('follows the text: a step made in «Визуально» changes the length', async () => {
    const page = await openPage()
    const before = page.text().length
    selectText(page, 'приоритет')
    page.press('strong')
    const after = page.text().length
    expect(after).toBeGreaterThan(before)
    expect(page.length()).toBe(`${nf(after)} симв.`)
    page.press('undo')
    expect(page.length()).toBe(`${nf(before)} симв.`)
  })

  it('shows the path of the nodes of Nota with the cursor in «Исходник», and nothing with the cursor elsewhere', async () => {
    const page = await openPage()
    const text = '= Title\n\n== Section\n\n* one\n* two\n'
    await load(page, text)
    const view = page.cm()
    // the cursor is not in the source yet
    view.dispatch({ selection: { anchor: text.indexOf('two') + 1 } })
    expect(page.path()).toBe('')
    view.focus()
    expect(page.path()).toBe('Document › Section › UnorderedList › ListItem › ItemText › TextLine')
    // and it follows the cursor
    view.dispatch({ selection: { anchor: text.indexOf('== Section') + 4 } })
    expect(page.path().startsWith('Document › Section')).toBe(true)
    expect(page.path()).not.toContain('ListItem')
    // the cursor leaves: the path goes
    view.contentDOM.blur()
    expect(page.path()).toBe('')
    page.pm().focus()
    expect(page.path()).toBe('')
    view.dispatch({ selection: { anchor: 0 } })
    expect(page.path()).toBe('')
  })

  it('the path follows typing in «Исходник» too', async () => {
    const page = await openPage()
    await load(page, 'Абзац\n')
    const view = page.cm()
    view.focus()
    view.dispatch({ selection: { anchor: 2 } })
    expect(page.path()).toBe('Document › Paragraph › TextLine')
    view.dispatch({ changes: { from: 0, insert: '* ' }, selection: { anchor: 3 }, userEvent: 'input.type' })
    expect(page.path()).toBe('Document › UnorderedList › ListItem › ItemText › TextLine')
  })
})

describe('demo: «Исходник» marks what the status line counts', () => {
  it('puts an icon on the gutter and a wavy line under the text of every diagnostic', async () => {
    const page = await openPage()
    choose(page, 'diagnostics')
    forceLinting(page.cm())
    await vi.waitFor(() => expect(document.querySelectorAll('#source .cm-lint-marker').length).toBeGreaterThan(0), { timeout: 20_000 })
    expect(document.querySelectorAll('#source .cm-lintRange').length).toBeGreaterThan(0)
    const counts = counted(fixture('editor/diagnostics.adoc'))
    for (const level of levels)
      if (counts[level] > 0)
        expect(document.querySelectorAll(`#source .cm-lint-marker-${level}`).length, level).toBeGreaterThan(0)
  })

  it('lights the line of the cursor and its number', async () => {
    const page = await openPage()
    const view = page.cm()
    view.focus()
    view.dispatch({ selection: { anchor: view.state.doc.line(3).from } })
    expect(document.querySelectorAll('#source .cm-activeLine').length).toBe(1)
    expect(document.querySelector('#source .cm-lineNumbers .cm-activeLineGutter')!.textContent).toBe('3')
  })

  it('says the level and the text of a diagnostic on hover: the words and the colours are the page\'s', () => {
    const css = read('src/style.css')
    for (const [level, word] of [
      ['error', 'Ошибка'],
      ['warning', 'Предупреждение'],
      ['info', 'Сообщение'],
    ])
      expect(css).toContain(`.cm-diagnostic-${level} .cm-diagnosticText::before { content: "${word}"; }`)
    expect(css).toMatch(/#source \.cm-tooltip\.cm-tooltip-lint\s*\{/)
  })
})

describe('demo: «Исходник» completes the targets of other documents (carried over)', () => {
  it('offers the targets of two invented documents after xref:, next to those of the document itself', async () => {
    const { currentCompletions, startCompletion } = await import('@codemirror/autocomplete')
    const page = await openPage()
    await load(page, '[[here]]\n== Раздел\n\nСм. xref:')
    const view = page.cm()
    view.focus()
    view.dispatch({ selection: { anchor: view.state.doc.length } })
    startCompletion(view)
    await vi.waitFor(() => {
      const labels = currentCompletions(view.state).map((c) => c.label)
      expect(labels).toEqual(expect.arrayContaining(['here', 'guide.adoc#install', 'reference.adoc#exit-codes']))
    }, { timeout: 20_000 })
  })
})
