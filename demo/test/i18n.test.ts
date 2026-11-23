// the page speaks English or Russian: English at the first visit of a browser that is not Russian, Russian for `ru…`, the choice of
// the switch EN | RU is kept in `localStorage` and wins over the browser; the switch changes the words in place and keeps the document.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { dictionary } from '../src/i18n.js'
import { largeDocument, samples } from '../src/samples.js'
import { choose, closePage, ctrlZ, key, openPage, outgoing, read, selectText, stubNetwork, type Page } from './helpers.js'

beforeEach(() => {
  outgoing.length = 0
  stubNetwork()
})
afterEach(closePage)

const CYRILLIC = /[Ѐ-ӿ]/
const root = document.documentElement

/** Everything of the page that a person reads: the text, the attributes `aria-label`, `data-tip`, `title`, `placeholder`, the title of the page. */
function readable(): string[] {
  const out = [document.title, document.body.textContent ?? '']
  for (const el of document.querySelectorAll('[aria-label],[data-tip],[title],[placeholder]'))
    for (const attr of ['aria-label', 'data-tip', 'title', 'placeholder']) out.push(el.getAttribute(attr) ?? '')
  return out
}
const cyrillic = (): string[] => readable().filter((t) => CYRILLIC.test(t))

const radio = (lang: 'en' | 'ru'): HTMLButtonElement => document.querySelector<HTMLButtonElement>(`#lang [data-lang="${lang}"]`)!
const press = (lang: 'en' | 'ru'): void => void radio(lang).dispatchEvent(new MouseEvent('click', { bubbles: true }))
const stored = (): string | null => localStorage.getItem('nota-demo-lang')

describe('demo: English by default', () => {
  for (const language of ['en-US', 'de', 'zh-CN', 'fr-FR']) {
    it(`the whole page is English for navigator.language = ${language}: no Cyrillic in the text, the attributes and the sample`, async () => {
      const page = await openPage({ language })
      expect(root.lang).toBe('en')
      expect(document.title).toBe('Nota — AsciiDoc playground')
      expect(cyrillic()).toEqual([])
      expect(page.text()).not.toMatch(CYRILLIC)
      expect(page.cm().state.doc.toString()).not.toMatch(CYRILLIC)
      expect(stored()).toBeNull()
    })
  }

  it('says the words of the header, the toolbar, the panes and the status line in English', async () => {
    const page = await openPage({ language: 'en-US' })
    expect(document.querySelector('h1.brand .brand-sub')!.textContent).toBe('AsciiDoc playground')
    expect(document.querySelector('.sample-label')!.textContent).toBe('Sample')
    expect(page.sample.getAttribute('aria-label')).toBe('Sample')
    expect(page.$('open').textContent!.trim()).toBe('Open file')
    expect(page.$('open').dataset.tip).toBe('Open an .adoc file from your computer')
    expect(page.$('download').textContent!.trim()).toBe('Download')
    expect(page.$('download').dataset.tip).toBe('Download spec.adoc')
    expect([...document.querySelectorAll('.seg [data-view]')].map((b) => b.textContent)).toEqual(['Visual', 'Split', 'Source'])
    expect(page.$('theme').getAttribute('aria-label')).toBe('Dark theme')
    expect(document.querySelector('.pane-visual')!.getAttribute('aria-label')).toBe('Visual')
    expect(document.querySelector('.pane-source')!.getAttribute('aria-label')).toBe('Source')
    expect(document.querySelector('.pane-source .pane-head')!.textContent!.replace(/\s+/g, ' ')).toBe('Source AsciiDoc')
    expect(page.$('toolbar').getAttribute('aria-label')).toBe('Text formatting')
    expect(page.btn('strong').getAttribute('aria-label')).toBe('Bold')
    expect(page.btn('undo').getAttribute('aria-label')).toBe('Undo')
    expect(page.btn('mark').getAttribute('aria-label')).toBe('Highlight')
    expect(page.style.getAttribute('aria-label')).toBe('Paragraph style')
    expect([...page.style.options].map((o) => o.textContent)).toEqual(['Document title', 'Text', 'Heading 2', 'Heading 3', 'Heading 4', 'Heading 5', 'Heading 6'])
    expect(page.$('style').closest('.select-wrap')!.getAttribute('data-keys')).toBe('mod+alt+0:text|mod+alt+2…6:headings')
    expect(document.querySelector('.count[data-sev="error"]')!.getAttribute('data-tip')).toBe('Errors')
    expect(page.$('len').dataset.tip).toBe('Length of the text in characters')
    expect(page.pm().dom.getAttribute('aria-label')).toBe('Document, visual')
    expect([...page.sample.options].map((o) => o.textContent)).toEqual([
      'Sample specification',
      'All constructs',
      'All constructs, stage 1',
      'Inline markup',
      'Colors',
      'Tables',
      'Diagnostics',
      'Section identifiers (xref:, <<)',
      'Large document ~1 MB',
    ])
  })

  it('writes the length with an English number: «N chars»', async () => {
    const page = await openPage({ language: 'en-US' })
    expect(page.length()).toBe(`${new Intl.NumberFormat('en-US').format(page.text().length)} chars`)
    expect(page.length()).toMatch(/^\d{1,3}(,\d{3})* chars$/)
    choose(page, 'large')
    expect(page.length()).toMatch(/^\d{1,3}(,\d{3})+ chars$/)
  })

  it('counts the diagnostics in English for a screen reader', async () => {
    await openPage({ language: 'en-US' })
    expect(document.querySelector('.count[data-sev="warning"]')!.getAttribute('aria-label')).toMatch(/^warnings: \d+$/)
  })

  it('refuses in English', async () => {
    const page = await openPage({ language: 'en-US' })
    selectText(page, 'portal')
    page.visual().commands.setLink('')
    expect(page.notice()).toBe('This address does not fit a link.')
  })

  it('opens the English sample first, the same document in every language that a list shows', async () => {
    const page = await openPage({ language: 'en-US' })
    expect(page.text()).toBe(samples[0]!.text('en'))
    expect(page.text()).toMatch(/^= Technical specification: customer portal/)
  })

  it('every English sample is English: no Cyrillic, made-up names, only example.org and example.com', () => {
    for (const sample of samples) {
      const text = sample.text('en')
      expect(text, sample.id).not.toMatch(CYRILLIC)
      expect(text.length, sample.id).toBeGreaterThan(300)
      for (const [, host] of text.matchAll(/\b((?:[a-z0-9-]+\.)+(?:org|com|net|io|dev|ru|info))\b/gi))
        expect(host, `${sample.id}: ${host}`).toMatch(/(?:^|\.)example\.(?:org|com)$/)
      expect(sample.label.en, sample.id).not.toMatch(CYRILLIC)
    }
  })

  it('has an English version for every Russian sample, with the same name of the id, and the large one in both languages', () => {
    expect(samples.length).toBe(9)
    for (const sample of samples) {
      expect(sample.label.ru, sample.id).toMatch(CYRILLIC)
      expect(sample.text('ru').length, sample.id).toBeGreaterThan(100)
      expect(sample.text('en'), sample.id).not.toBe(sample.text('ru'))
    }
    const large = largeDocument(20_000, 'en')
    expect(large).not.toMatch(CYRILLIC)
    expect(large).toMatch(/^= Large document/)
    expect(largeDocument(20_000, 'ru')).toMatch(/^= Большой документ/)
    expect(largeDocument(20_000)).toBe(largeDocument(20_000, 'ru'))
  })

  it('the Russian samples are the fixtures, as before', async () => {
    const page = await openPage({ language: 'ru-RU' })
    choose(page, 'tables')
    expect(page.text()).toMatch(/^= Таблицы/)
    expect(page.text()).toBe(samples.find((s) => s.id === 'tables')!.text('ru'))
  })
})

describe('demo: Russian for a Russian browser', () => {
  it('looks as it did: Russian words, the Russian format of the number, lang="ru"', async () => {
    const page = await openPage({ language: 'ru-RU' })
    expect(root.lang).toBe('ru')
    expect(document.title).toBe('Nota — песочница AsciiDoc')
    expect(document.querySelector('.sample-label')!.textContent).toBe('Образец')
    expect([...document.querySelectorAll('.seg [data-view]')].map((b) => b.textContent)).toEqual(['Визуально', 'Рядом', 'Исходник'])
    expect(page.length()).toMatch(/симв\.$/)
    expect(page.sample.options[0]!.textContent).toBe('Пример ТЗ')
    expect(page.text()).toMatch(/^= Техническое задание/)
    expect(page.$('download').dataset.tip).toBe('Скачать spec.adoc')
    expect(page.btn('strong').getAttribute('aria-label')).toBe('Жирный')
  })

  it('takes `ru` and `ru_RU` as Russian, and any other language as English', async () => {
    for (const [language, lang] of [['ru', 'ru'], ['ru-RU', 'ru'], ['uk-UA', 'en'], ['', 'en']] as const) {
      await openPage({ language })
      expect(root.lang, language).toBe(lang)
      closePage()
    }
  })
})

describe('demo: the switch EN | RU', () => {
  it('is two radio buttons in a radio group; the button of the current language is checked', async () => {
    await openPage({ language: 'en-US' })
    const group = document.getElementById('lang')!
    expect(group.getAttribute('role')).toBe('radiogroup')
    expect(group.getAttribute('aria-label')).toBe('Language')
    const buttons = [...group.querySelectorAll('button')]
    expect(buttons.map((b) => [b.getAttribute('role'), b.textContent, b.getAttribute('aria-checked')])).toEqual([
      ['radio', 'EN', 'true'],
      ['radio', 'RU', 'false'],
    ])
    expect(buttons.every((b) => b.tagName === 'BUTTON' && b.type === 'button')).toBe(true)
    closePage()
    await openPage({ language: 'ru-RU' })
    expect([...document.querySelectorAll('#lang button')].map((b) => b.getAttribute('aria-checked'))).toEqual(['false', 'true'])
    expect(document.getElementById('lang')!.getAttribute('aria-label')).toBe('Язык')
  })

  it('RU turns the whole interface into Russian at once, without a reload; the language is saved', async () => {
    const page = await openPage({ language: 'en-US' })
    press('ru')
    expect(root.lang).toBe('ru')
    expect(document.title).toBe('Nota — песочница AsciiDoc')
    expect(stored()).toBe('ru')
    expect(radio('ru').getAttribute('aria-checked')).toBe('true')
    expect(radio('en').getAttribute('aria-checked')).toBe('false')
    expect(document.querySelector('.sample-label')!.textContent).toBe('Образец')
    expect([...document.querySelectorAll('.seg [data-view]')].map((b) => b.textContent)).toEqual(['Визуально', 'Рядом', 'Исходник'])
    expect(page.$('open').getAttribute('aria-label')).toBe('Открыть файл')
    expect(page.$('download').dataset.tip).toBe('Скачать spec.adoc')
    expect(page.$('theme').getAttribute('aria-label')).toBe('Тёмная тема')
    expect(page.btn('strong').getAttribute('aria-label')).toBe('Жирный')
    expect(page.style.options[1]!.textContent).toBe('Текст')
    expect(page.$('style').closest('.select-wrap')!.getAttribute('data-keys')).toBe('mod+alt+0:текст|mod+alt+2…6:заголовки')
    expect(page.length()).toMatch(/симв\.$/)
    expect(page.pm().dom.getAttribute('aria-label')).toBe('Документ, визуально')
    expect(document.getElementById('lang')!.getAttribute('aria-label')).toBe('Язык')
    expect(page.sample.options[0]!.textContent).toBe('Пример ТЗ')
    expect(document.querySelector('.count[data-sev="warning"]')!.getAttribute('aria-label')).toMatch(/^предупреждений: \d+$/)
    // the window that the page had is drawn again on the same session: the editors work
    expect(page.pm().dom.isConnected).toBe(true)
    expect(page.cm().dom.isConnected).toBe(true)
    // and back
    press('en')
    expect(root.lang).toBe('en')
    expect(stored()).toBe('en')
    expect(document.querySelector('.sample-label')!.textContent).toBe('Sample')
    expect(cyrillic()).toEqual([])
  })

  it('keeps the text, the view, the history, the theme and the cursor', async () => {
    const page = await openPage({ language: 'en-US' })
    page.view('source')
    document.getElementById('theme')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(root.getAttribute('data-theme')).toBe('dark')
    const view = page.cm()
    view.dispatch({ changes: { from: 0, insert: 'X' }, selection: { anchor: 5, head: 9 }, userEvent: 'input.type' })
    const typed = page.text()
    expect(typed.startsWith('X= Technical')).toBe(true)
    expect(page.session().canUndo).toBe(true)
    press('ru')
    expect(page.text()).toBe(typed)
    expect(page.cm().state.doc.toString()).toBe(typed)
    expect(page.work.dataset.view).toBe('source')
    expect(root.getAttribute('data-theme')).toBe('dark')
    expect(page.$('theme').getAttribute('aria-label')).toBe('Светлая тема')
    expect(page.cm().state.selection.main.anchor).toBe(5)
    expect(page.cm().state.selection.main.head).toBe(9)
    expect(page.session().canUndo).toBe(true)
    // one step of the history takes back the typed letter, in the editor that was made after the switch
    ctrlZ(page.cm())
    expect(page.text().startsWith('= Technical')).toBe(true)
    // the document of a sample is not replaced by the switch, and the next sample is in the new language
    choose(page, 'tables')
    expect(page.text()).toBe(samples.find((s) => s.id === 'tables')!.text('ru'))
    press('en')
    expect(page.text()).toBe(samples.find((s) => s.id === 'tables')!.text('ru'))
    expect(page.sample.value).toBe('tables')
    choose(page, 'colors')
    expect(page.text()).toBe(samples.find((s) => s.id === 'colors')!.text('en'))
  })

  it('keeps the cursor of the visual editor, and an opened file with its name', async () => {
    const page = await openPage({ language: 'en-US' })
    selectText(page, 'customer portal')
    const { from, to } = page.pm().state.selection
    press('ru')
    expect(page.pm().state.selection.from).toBe(from)
    expect(page.pm().state.selection.to).toBe(to)
    expect(page.pm().state.doc.textBetween(from, to)).toBe('customer portal')
  })

  it('works from the keyboard: the radio of the other language takes the arrows, Enter and Space press a button', async () => {
    await openPage({ language: 'en-US' })
    expect(radio('en').tabIndex).toBe(0)
    expect(radio('ru').tabIndex).toBe(-1)
    const group = document.getElementById('lang')!
    radio('en').focus()
    key(radio('en'), 'ArrowRight')
    expect(root.lang).toBe('ru')
    expect(document.activeElement).toBe(radio('ru'))
    expect(radio('ru').tabIndex).toBe(0)
    key(radio('ru'), 'ArrowLeft')
    expect(root.lang).toBe('en')
    expect(document.activeElement).toBe(radio('en'))
    // the buttons are real buttons: Enter and Space click them in a browser
    expect(group.querySelectorAll('button').length).toBe(2)
  })

  it('remembers the choice: after a reload the saved language wins over the language of the browser', async () => {
    await openPage({ language: 'en-US' })
    press('ru')
    closePage()
    // the page is loaded again in an English browser; the storage of the browser holds what the first page wrote
    localStorage.setItem('nota-demo-lang', 'ru')
    const page = await openPage({ language: 'en-US' })
    expect(root.lang).toBe('ru')
    expect(page.sample.options[0]!.textContent).toBe('Пример ТЗ')
    expect(page.text()).toMatch(/^= Техническое задание/)
    closePage()
    const english = await openPage({ language: 'ru-RU', stored: 'en' })
    expect(root.lang).toBe('en')
    expect(english.text()).toMatch(/^= Technical specification/)
  })

  it('ignores a saved value that is neither ru nor en', async () => {
    await openPage({ language: 'en-US', stored: 'klingon' })
    expect(root.lang).toBe('en')
    closePage()
    await openPage({ language: 'ru-RU', stored: '' })
    expect(root.lang).toBe('ru')
  })

  it('works when localStorage is not available: the language is the browser’s, the switch still works for the page', async () => {
    await openPage({ language: 'en-US', stored: 'throws' })
    expect(root.lang).toBe('en')
    expect(cyrillic()).toEqual([])
    press('ru')
    expect(root.lang).toBe('ru')
    expect(document.querySelector('.sample-label')!.textContent).toBe('Образец')
    press('en')
    expect(root.lang).toBe('en')
    closePage()
    await openPage({ language: 'ru-RU', stored: 'throws' })
    expect(root.lang).toBe('ru')
  })

  it('makes no call to the network when the language changes', async () => {
    const page = await openPage({ language: 'en-US' })
    press('ru')
    choose(page, 'inline')
    press('en')
    await vi.waitFor(() => expect(outgoing).toEqual([]))
    expect(outgoing).toEqual([])
  })

  it('has no Russian word left in index.html itself: every word is English or named by a data-i18n attribute', () => {
    expect(read('index.html')).not.toMatch(CYRILLIC)
  })
})

describe('demo: the texts of the style sheet', () => {
  it('are English, and Russian only under :lang(ru)', () => {
    const css = read('src/style.css')
    expect(css).toContain('content: "Edited in Source";')
    expect(css).toContain('.nota-inline-chip:lang(ru)::after { content: "Правится в «Исходнике»"; }')
    for (const level of ['error', 'warning', 'info']) expect(css).toMatch(new RegExp(`^#source \\.cm-tooltip-lint \\.cm-diagnostic-${level} \\.cm-diagnosticText::before \\{ content: "[A-Za-z]+"; \\}$`, 'm'))
    for (const line of css.split('\n')) if (/content:\s*"[^"]*[А-Яа-я]/.test(line)) expect(line, line).toMatch(/:lang\(ru\)/)
  })
})

describe('demo: the dictionaries', () => {
  it('every key that index.html names is in both dictionaries', () => {
    const html = read('index.html')
    const keys = [...html.matchAll(/data-i18n(?:-[a-z-]+)?="([\w.-]+)"/g)].map((m) => m[1]!)
    expect(keys.length).toBeGreaterThan(30)
    for (const key of keys) {
      expect(dictionary.en, key).toHaveProperty([key])
      expect(dictionary.ru, key).toHaveProperty([key])
    }
  })

  it('the Russian and the English dictionaries name the same holes', () => {
    for (const key of Object.keys(dictionary.en) as Array<keyof typeof dictionary.en>) {
      const holes = (text: string): string[] => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort()
      expect(holes(dictionary.ru[key]), key).toEqual(holes(dictionary.en[key]))
    }
  })
})

export type { Page }
