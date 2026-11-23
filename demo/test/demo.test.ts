// the demo is one page. «Пример ТЗ» opens in «Визуально» and «Исходник» side by side on one session, the switcher of the
// view keeps one window or both, and one history undoes the steps of both windows, to the byte.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createSession } from '@nota-adoc/core'
import { projectDocument } from '@nota-adoc/prosemirror'
import { largeDocument } from '../src/samples.js'
import { choose, closePage, ctrlZ, demoDir, fixture, json, nf, openPage, outgoing, read, selectText, stubNetwork } from './helpers.js'

beforeEach(() => {
  outgoing.length = 0
  stubNetwork()
})
afterEach(closePage)

describe('demo: one page', () => {
  it('has index.html and no other page: no visual.html, no links between pages', () => {
    expect(existsSync(join(demoDir, 'index.html'))).toBe(true)
    expect(existsSync(join(demoDir, 'visual.html'))).toBe(false)
    expect(existsSync(join(demoDir, 'src/visual.ts'))).toBe(false)
    const html = read('index.html')
    expect(html).toContain('<title>Nota — AsciiDoc playground</title>')
    expect(html).not.toMatch(/visual\.html/)
    expect(html).toMatch(/<link rel="stylesheet" href="\.\/src\/style\.css">/)
  })

  it('has the header of the prototype: the brand, the sample, «Открыть файл», «Скачать», the view, the theme', async () => {
    const page = await openPage()
    expect(document.querySelector('h1.brand .brand-name')!.textContent).toBe('Nota')
    expect(document.querySelector('h1.brand .brand-sub')!.textContent).toBe('песочница AsciiDoc')
    expect(document.querySelector('.sample-label')!.textContent).toBe('Образец')
    expect(page.$('open').textContent!.trim()).toBe('Открыть файл')
    expect(page.$('download').textContent!.trim()).toBe('Скачать')
    expect([...document.querySelectorAll('.seg [data-view]')].map((b) => [b.getAttribute('data-view'), b.textContent])).toEqual([
      ['visual', 'Визуально'],
      ['split', 'Рядом'],
      ['source', 'Исходник'],
    ])
    expect(document.querySelector('.seg')!.getAttribute('role')).toBe('radiogroup')
    expect(page.$('theme').getAttribute('aria-label')).toBe('Тёмная тема')
  })

  it('has two windows, «Визуально» with the toolbar and «Исходник» with its head, and one status line', async () => {
    await openPage()
    expect(document.querySelector('.pane-visual')!.getAttribute('aria-label')).toBe('Визуально')
    expect(document.querySelector('.pane-source')!.getAttribute('aria-label')).toBe('Исходник')
    expect(document.querySelector('.pane-visual [role="toolbar"]')).not.toBeNull()
    expect(document.querySelector('.pane-visual .ProseMirror')).not.toBeNull()
    expect(document.querySelector('.pane-source .pane-head')!.textContent!.replace(/\s+/g, ' ')).toBe('Исходник AsciiDoc')
    expect(document.querySelector('.pane-source .cm-editor')).not.toBeNull()
    expect(document.querySelectorAll('.status').length).toBe(1)
    // nothing of the prototype itself: its strip, its screen of blocks, the commands of later stages
    for (const gone of ['.proto', '#proto', '.stage', '.future', '#insert-btn', '#insert-menu', '#toast'])
      expect(document.querySelector(gone), gone).toBeNull()
    expect([...document.querySelectorAll('#sample option')].map((o) => o.textContent)).not.toContain('Образцы блоков')
  })

  it('gives the editable text of «Визуально» the class of the document that the styles of the prototype are written for', async () => {
    const page = await openPage()
    const editable = page.pm().dom
    expect(editable.classList.contains('doc')).toBe(true)
    expect(editable.classList.contains('ProseMirror')).toBe(true)
    expect(editable.getAttribute('aria-label')).toBe('Документ, визуально')
    expect(editable.getAttribute('spellcheck')).toBe('false')
    // ProseMirror redraws its own attributes with every step, and the class stays
    selectText(page, 'приоритет')
    page.press('em')
    expect(page.pm().dom.classList.contains('doc')).toBe(true)
    // and after another sample
    choose(page, 'all')
    expect(page.pm().dom.classList.contains('doc')).toBe(true)
  })

  it('opens «Пример ТЗ» first, in both windows side by side on one session', async () => {
    const page = await openPage()
    const labels = [...page.sample.options].map((o) => o.text)
    expect(labels).toEqual([
      'Пример ТЗ',
      'Все конструкции',
      'Все конструкции, этап 1',
      'Строчная разметка',
      'Цвета',
      'Таблицы',
      'Диагностики',
      'Идентификаторы разделов (xref:, <<)',
      'Большой документ ~1 МБ',
    ])
    const text = fixture('editor/visual.adoc')
    expect(page.work.dataset.view).toBe('split')
    expect(page.text()).toBe(text)
    expect(page.cm().state.doc.toString()).toBe(text)
    expect(json(page.pm().state.doc)).toBe(json(projectDocument(createSession(text).doc)))
    expect(page.pm().dom.querySelectorAll('h1, h2, h3, h4').length).toBeGreaterThan(5)
    expect(page.visual().session).toBe(page.session())
    expect(page.length()).toBe(`${nf(text.length)} симв.`)
  })

  it('shows another sample in both windows, and a large one', async () => {
    const page = await openPage()
    choose(page, 'inline')
    expect(page.text()).toBe(fixture('stage4/all-constructs.adoc'))
    expect(page.cm().state.doc.toString()).toBe(page.text())
    expect(json(page.pm().state.doc)).toBe(json(projectDocument(createSession(page.text()).doc)))
    choose(page, 'large')
    const large = largeDocument()
    expect(large.length).toBeGreaterThan(900_000)
    expect(large.length).toBeLessThan(1_200_000)
    expect(page.cm().state.doc.length).toBe(large.length)
    expect(page.pm().dom.querySelector('h1')!.textContent).toBe('Большой документ')
    expect(page.length()).toBe(`${nf(large.length)} симв.`)
  }, 60_000)

  it('the switcher keeps one window or both', async () => {
    const page = await openPage()
    const checked = () =>
      [...document.querySelectorAll('.seg [data-view]')]
        .filter((b) => b.getAttribute('aria-checked') === 'true')
        .map((b) => b.getAttribute('data-view'))
    expect(checked()).toEqual(['split'])
    page.view('visual')
    expect(page.work.dataset.view).toBe('visual')
    expect(checked()).toEqual(['visual'])
    page.view('source')
    expect(page.work.dataset.view).toBe('source')
    expect(checked()).toEqual(['source'])
    page.view('split')
    expect(page.work.dataset.view).toBe('split')
    expect(checked()).toEqual(['split'])
  })

  it('a step made before the switch is undone by Ctrl+Z after it, and undo to the end gives the text back byte for byte', async () => {
    const page = await openPage()
    const start = fixture('editor/visual.adoc')
    // the first step in «Исходник», the second in «Визуально»
    page.cm().dispatch({ changes: { from: 0, insert: 'абв ' }, userEvent: 'input.type' })
    selectText(page, 'приоритет')
    page.visual().commands.toggleMark('strong')
    const edited = page.text()
    expect(edited).toBe(`абв ${start}`.replace('приоритет', '*приоритет*'))
    expect([...page.pm().dom.querySelectorAll('strong')].map((s) => s.textContent)).toContain('приоритет')
    // one window at a time: the undo works in the one that is shown
    page.view('source')
    ctrlZ(page.cm())
    expect(page.text()).toBe(`абв ${start}`)
    expect([...page.pm().dom.querySelectorAll('strong')].map((s) => s.textContent)).not.toContain('приоритет')
    page.view('visual')
    ctrlZ(page.pm())
    expect(page.text()).toBe(start)
    expect(page.cm().state.doc.toString()).toBe(start)
    expect(json(page.pm().state.doc)).toBe(json(projectDocument(createSession(start).doc)))
    // and forward again, from the other window
    page.view('split')
    ctrlZ(page.cm(), true)
    ctrlZ(page.pm(), true)
    expect(page.text()).toBe(edited)
    expect(page.session().canRedo).toBe(false)
  })

  it('a new sample starts a new history', async () => {
    const page = await openPage()
    page.cm().dispatch({ changes: { from: 0, insert: 'x' }, userEvent: 'input.type' })
    choose(page, 'diagnostics')
    const text = fixture('editor/diagnostics.adoc')
    expect(page.text()).toBe(text)
    ctrlZ(page.cm())
    ctrlZ(page.pm())
    expect(page.text()).toBe(text)
    expect(page.session().canUndo).toBe(false)
  })

  it('at 390 px shows one window at a time: «Визуально» at first, and «Рядом» is not offered', async () => {
    const page = await openPage({ narrow: true })
    expect(page.work.dataset.view).toBe('visual')
    expect(document.querySelector('.seg [data-view="visual"]')!.getAttribute('aria-checked')).toBe('true')
    expect(document.querySelector('.seg [data-view="split"]')!.getAttribute('aria-checked')).toBe('false')
    page.view('source')
    expect(page.work.dataset.view).toBe('source')
    page.view('split') // what the button of a wide window would choose: never two windows on a narrow one
    expect(page.work.dataset.view).toBe('visual')
    // the window grows: the chosen view «Рядом» is shown as it is
    page.media.setNarrow(false)
    expect(page.work.dataset.view).toBe('split')
    page.media.setNarrow(true)
    expect(page.work.dataset.view).toBe('visual')
  })
})
