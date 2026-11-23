import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { TextSelection, NodeSelection } from 'prosemirror-state'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type Page, STALE_MESSAGE, messages, startPage, themeOf } from '../../src/webview/main.js'
import type { ToHost, ToTab } from '../../src/protocol.js'

const fixture = (path: string): string => readFileSync(join(import.meta.dirname, '../../../../quality/fixtures', path), 'utf8')

let sent: ToHost[]
let root: HTMLElement
let page: Page | undefined

const api = { postMessage: (m: ToHost) => void sent.push(m) }
const edits = (): Extract<ToHost, { type: 'edit' }>[] => sent.filter((m): m is Extract<ToHost, { type: 'edit' }> => m.type === 'edit')

/** What the host says to the page. */
function host(message: ToTab): void {
  window.dispatchEvent(new MessageEvent('message', { data: message }))
}

function open(text: string, version = 1): Page {
  root = document.createElement('div')
  root.id = 'app'
  document.body.append(root)
  page = startPage(api, root)
  host({ type: 'init', text, version, fileName: 'a.adoc', locale: 'ru', outlineView: 'capsule', fileDir: '/work/docs', mode: 'visual' })
  return page
}

/** Puts the cursor right after the first `word` found in the text of the screen (or selects it). */
function cursorAfter(word: string, select = false): void {
  const view = page!.editor!.view
  let found: number | null = null
  view.state.doc.descendants((node, pos) => {
    if (found !== null || !node.isText) return
    const i = node.text!.indexOf(word)
    if (i >= 0) found = pos + i
  })
  if (found === null) throw new Error(`no «${word}» on the screen`)
  const start = found as number
  view.dispatch(
    view.state.tr.setSelection(
      TextSelection.create(view.state.doc, select ? start : start + word.length, start + word.length),
    ),
  )
}

function type(text: string): void {
  const view = page!.editor!.view
  for (const ch of text) {
    const { from, to } = view.state.selection
    if (!view.someProp('handleTextInput', (f) => f(view, from, to, ch, () => view.state.tr.insertText(ch, from, to))))
      view.dispatch(view.state.tr.insertText(ch, from, to))
  }
}

/** A key as a keyboard sends it; the Command key of a Mac is the Ctrl of the test (jsdom is no Mac). */
function key(code: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const { metaKey, ...rest } = init
  const ev = new KeyboardEvent('keydown', {
    code,
    key: init.key ?? code,
    bubbles: true,
    cancelable: true,
    ...rest,
    ctrlKey: !!(metaKey || init.ctrlKey),
  })
  page!.editor!.view.dom.dispatchEvent(ev)
  return ev
}

beforeEach(() => {
  vi.useFakeTimers()
  sent = []
  page = undefined
  document.body.className = ''
})
afterEach(() => {
  page?.destroy()
  document.body.textContent = ''
  document.documentElement.removeAttribute('lang')
  vi.useRealTimers()
})

describe('opening', () => {
  it('a page without a language from the host is English: «Opening the visual editor…», the English strip of a refusal', () => {
    for (const lang of [undefined, '', 'en', 'de']) {
      if (lang === undefined) document.documentElement.removeAttribute('lang')
      else document.documentElement.lang = lang
      root = document.createElement('div')
      document.body.append(root)
      page = startPage(api, root)
      vi.advanceTimersByTime(401)
      expect(root.querySelector('.loading')!.textContent, `lang=${lang}`).toContain('Opening the visual editor…')
      page.destroy()
      root.remove()
    }
  })

  it('a page with lang="ru" is Russian before the host says anything', () => {
    document.documentElement.lang = 'ru'
    root = document.createElement('div')
    document.body.append(root)
    page = startPage(api, root)
    vi.advanceTimersByTime(401)
    expect(root.querySelector('.loading')!.textContent).toContain('Открываю визуальный редактор…')
  })

  it('init in English: the tab and the html are English, the strip after a failure is the English one', () => {
    document.documentElement.lang = 'ru'
    root = document.createElement('div')
    document.body.append(root)
    page = startPage(api, root)
    host({ type: 'init', text: '= Title\n\nParagraph.\n', version: 1, fileName: 'a.adoc', locale: 'en', outlineView: 'capsule', fileDir: '/work/docs', mode: 'visual' })
    expect(document.documentElement.lang).toBe('en')
    expect(root.querySelector('.notice-x')!.getAttribute('aria-label')).toBe('Hide')
    vi.spyOn(page.mirror!, 'update').mockImplementationOnce(() => {
      throw new Error('handler failed')
    })
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    host({ type: 'update', version: 2, changes: [{ from: 0, to: 0, insert: '' }], reason: undefined })
    expect(root.querySelector('.notice.crash .notice-text')!.textContent).toBe('The tab failed: the document is shown again from the file.')
  })

  it('says ready, shows «Открываю…» after 0.4 s and the document when the text comes', () => {
    document.documentElement.lang = 'ru'
    root = document.createElement('div')
    document.body.append(root)
    page = startPage(api, root)
    expect(sent).toEqual([{ type: 'ready' }])
    const loading = root.querySelector<HTMLElement>('.loading')!
    expect(loading.hidden).toBe(true)
    vi.advanceTimersByTime(401)
    expect(loading.hidden).toBe(false)
    expect(loading.textContent).toContain('Открываю визуальный редактор…')
    host({ type: 'init', text: '= Заголовок\n\nАбзац.\n', version: 1, fileName: 'a.adoc', locale: 'ru', outlineView: 'capsule', fileDir: '/work/docs', mode: 'visual' })
    expect(root.querySelector('.loading')).toBeNull()
    expect(root.querySelector('h1')?.textContent).toBe('Заголовок')
  })

  it('does not blink the line when the text comes in time', () => {
    root = document.createElement('div')
    document.body.append(root)
    page = startPage(api, root)
    vi.advanceTimersByTime(200)
    host({ type: 'init', text: 'текст\n', version: 1, fileName: 'a.adoc', locale: 'ru', outlineView: 'capsule', fileDir: '/work/docs', mode: 'visual' })
    vi.advanceTimersByTime(1000)
    expect(root.querySelector('.loading')).toBeNull()
  })

  it('shows the fixture: text, marks, plates', () => {
    open(fixture('editor/visual.adoc'))
    const dom = page!.editor!.view.dom
    expect(dom.classList.contains('doc')).toBe(true)
    expect(dom.querySelector('h1,h2')).not.toBeNull()
    expect(dom.querySelector('p strong')).not.toBeNull()
    expect(dom.querySelector('p em')).not.toBeNull()
    expect(dom.querySelector('p code')).not.toBeNull()
    expect(dom.querySelector('p a')).not.toBeNull()
    expect(dom.querySelector('.li')).not.toBeNull()
    expect(dom.querySelector('.nota-island .island-src')?.textContent).not.toBe('')
    expect(dom.querySelector('.nota-code .code-src')).not.toBeNull()
  })

  it('colours the coloured text with its role', () => {
    open(fixture('editor/colors.adoc'))
    const dom = page!.editor!.view.dom
    expect(dom.querySelector('.hl-red')?.textContent).toBe('красный')
    expect(dom.querySelector('.hl-yellow-bg')?.textContent).toBe('жёлтая')
  })

  it('reports an error to the host when the editor cannot start', () => {
    root = document.createElement('div')
    document.body.append(root)
    page = startPage(api, root)
    host({ type: 'init', text: undefined as never, version: 1, fileName: 'a.adoc', locale: 'ru', outlineView: 'capsule', fileDir: '/work/docs', mode: 'visual' })
    const error = sent.find((m) => m.type === 'error') as Extract<ToHost, { type: 'error' }>
    expect(error).toBeDefined()
    expect(error.message).toMatch(/Error/)
  })
})

describe('typing', () => {
  it('sends one edit with the whole word after a pause, and takes the answer', () => {
    open('Первый абзац.\n\nВторой абзац.\n')
    cursorAfter('Второй')
    type(' ёж')
    expect(page!.mirror!.text).toBe('Первый абзац.\n\nВторой ёж абзац.\n')
    expect(edits()).toEqual([])
    vi.advanceTimersByTime(300)
    expect(edits()).toEqual([{ type: 'edit', id: 1, baseVersion: 1, changes: [{ from: 21, to: 21, insert: ' ёж' }] }])
    host({ type: 'ack', id: 1, version: 2 })
    expect(page!.mirror!.hasUnsent).toBe(false)
  })

  it('types inside coloured text and the word stays in the same markup', () => {
    open(fixture('editor/colors.adoc'))
    cursorAfter('красн')
    type('ааа')
    vi.advanceTimersByTime(300)
    expect(page!.mirror!.text).toContain('[.hl-red]#краснааая#'.replace('краснааая', 'краснааай'.slice(0, 5) + 'ааа' + 'ый'))
    expect(page!.editor!.view.dom.querySelector('.hl-red')?.textContent).toBe('краснаааый')
  })

  it('Enter splits the paragraph, Shift+Enter breaks the line, Backspace joins', () => {
    open('Первый абзац.\n\nВторой.\n')
    cursorAfter('Первый')
    expect(key('Enter', { key: 'Enter' }).defaultPrevented).toBe(true)
    expect(page!.mirror!.text).toBe('Первый\n\nабзац.\n\nВторой.\n')
    cursorAfter('Второй')
    expect(key('Enter', { key: 'Enter', shiftKey: true }).defaultPrevented).toBe(true)
    expect(page!.mirror!.text).toBe('Первый\n\nабзац.\n\nВторой +\n.\n')
    // Backspace at the start of «абзац.» joins it to the paragraph before it
    const view = page!.editor!.view
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, view.state.doc.child(0).nodeSize + 1)))
    expect(key('Backspace', { key: 'Backspace' }).defaultPrevented).toBe(true)
    expect(page!.mirror!.text.startsWith('Первый')).toBe(true)
    expect(page!.mirror!.text).not.toContain('Первый\n\nабзац')
  })
})

describe('marks', () => {
  const pairs: [string, KeyboardEventInit, string][] = [
    ['KeyB', { key: 'b' }, '*слово*'],
    ['KeyI', { key: 'i' }, '_слово_'],
    ['KeyE', { key: 'e' }, '`слово`'],
    ['KeyX', { key: 'X', shiftKey: true }, '[.line-through]#слово#'],
    ['KeyH', { key: 'H', shiftKey: true }, '#слово#'],
  ]
  for (const [code, init, markup] of pairs)
    it(`${code} puts ${markup} in the file`, () => {
      open('Одно слово тут.\n')
      cursorAfter('слово', true)
      expect(key(code, { ...init, metaKey: true }).defaultPrevented).toBe(true)
      expect(page!.mirror!.text).toBe(`Одно ${markup} тут.\n`)
    })

  it('a command from VS Code for the same key right after is not done twice', () => {
    open('Одно слово тут.\n')
    cursorAfter('слово', true)
    key('KeyB', { key: 'b', metaKey: true })
    host({ type: 'command', name: 'strong' })
    expect(page!.mirror!.text).toBe('Одно *слово* тут.\n')
  })

  it('a command from VS Code alone toggles the mark', () => {
    open('Одно слово тут.\n')
    cursorAfter('слово', true)
    host({ type: 'command', name: 'em' })
    expect(page!.mirror!.text).toBe('Одно _слово_ тут.\n')
  })

  it('send what was typed before a mark is put, as an edit of its own', () => {
    open('Одно слово тут.\n')
    cursorAfter('Одно')
    type('!')
    cursorAfter('слово', true)
    key('KeyB', { key: 'b', metaKey: true })
    expect(edits()[0]!.changes[0]!.insert).toBe('!')
  })
})

describe('undo and redo', () => {
  it('Cmd+Z asks the host once; the answer undoes the word and puts the cursor on its place', () => {
    open('слово\n')
    cursorAfter('слово')
    type(' проверка')
    key('KeyZ', { key: 'z', metaKey: true })
    expect(sent.map((m) => m.type)).toEqual(['ready', 'edit'])
    host({ type: 'ack', id: 1, version: 2 })
    expect(sent.map((m) => m.type)).toEqual(['ready', 'edit', 'undo'])
    host({ type: 'update', version: 3, changes: [{ from: 5, to: 14, insert: '' }], reason: 'undo' })
    expect(page!.mirror!.text).toBe('слово\n')
    expect(page!.editor!.view.state.selection.head).toBe(page!.editor!.view.state.selection.anchor)
    expect(page!.editor!.view.dom.textContent).toBe('слово')
    key('KeyZ', { key: 'z', metaKey: true, shiftKey: true })
    expect(sent.at(-1)).toEqual({ type: 'redo' })
  })

  it('the native undo of «Правка → Отменить» asks the host too, but not twice after the key', () => {
    open('слово\n')
    const native = (): InputEvent => {
      const ev = new InputEvent('beforeinput', { inputType: 'historyUndo', bubbles: true, cancelable: true })
      page!.editor!.view.dom.dispatchEvent(ev)
      return ev
    }
    native()
    expect(sent.filter((m) => m.type === 'undo')).toHaveLength(1)
    vi.advanceTimersByTime(1000)
    key('KeyZ', { key: 'z', metaKey: true })
    native()
    expect(sent.filter((m) => m.type === 'undo')).toHaveLength(2)
  })
})

describe('what comes from the host', () => {
  it('shows an edit from another editor and keeps the cursor on its text', () => {
    open('Первый абзац.\n\nВторой абзац.\n')
    cursorAfter('Второй')
    host({ type: 'update', version: 2, changes: [{ from: 0, to: 0, insert: 'Новая строка.\n\n' }], reason: undefined })
    expect(page!.editor!.view.dom.querySelectorAll('p')).toHaveLength(3)
    const sel = page!.editor!.view.state.selection
    expect(page!.editor!.view.state.doc.textBetween(sel.from - 6, sel.from)).toBe('Второй')
  })

  it('shows the document again with a message when typed text is overtaken', () => {
    open('Первый абзац.\n\nВторой абзац.\n')
    cursorAfter('Второй')
    type('ЛИШНЕЕ')
    host({ type: 'update', version: 2, changes: [{ from: 0, to: 0, insert: 'Ещё.\n\n' }], reason: undefined })
    expect(page!.mirror!.text).toBe('Ещё.\n\nПервый абзац.\n\nВторой абзац.\n')
    const notice = root.querySelector<HTMLElement>('.notice')!
    expect(notice.hidden).toBe(false)
    expect(notice.textContent).toContain(STALE_MESSAGE)
    expect(edits()).toEqual([])
  })

  it('answers a flush after everything typed is written', () => {
    open('слово\n')
    cursorAfter('слово')
    type('!')
    host({ type: 'flush', id: 7 })
    expect(sent.filter((m) => m.type === 'flush')).toEqual([])
    host({ type: 'ack', id: 1, version: 2 })
    expect(sent.at(-1)).toEqual({ type: 'flush', id: 7 })
  })

  it('answers a flush at once when nothing waits', () => {
    open('слово\n')
    host({ type: 'flush', id: 3 })
    expect(sent.at(-1)).toEqual({ type: 'flush', id: 3 })
  })
})

describe('refusals', () => {
  it('typing over a selected plate leaves the file as it is and tells why, in Russian', () => {
    open('Абзац.\n\nтермин:: один\nдва:: два\n\nКонец.\n')
    const view = page!.editor!.view
    let at = -1
    view.state.doc.forEach((node, pos) => node.type.name === 'island' && (at = pos))
    expect(at).toBeGreaterThan(-1)
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, at)))
    type('x')
    vi.advanceTimersByTime(1000)
    expect(page!.mirror!.text).toBe('Абзац.\n\nтермин:: один\nдва:: два\n\nКонец.\n')
    expect(edits()).toEqual([])
    const notice = root.querySelector<HTMLElement>('.notice')!
    expect(notice.hidden).toBe(false)
    expect(notice.querySelector('.notice-text')!.textContent).toBe('Этот блок пока правится только в режиме «Текст».')
  })

  it('shows a table as a grid, and one that cannot be rewritten as a plate', () => {
    open(fixture('editor/tables.adoc'))
    const dom = page!.editor!.view.dom
    expect(dom.querySelectorAll('table').length).toBeGreaterThanOrEqual(6)
    const sources = [...dom.querySelectorAll('.nota-island .island-src')].map((c) => c.textContent)
    expect(sources.some((t) => t!.includes('2*|повторяется'))).toBe(true)
  })

  it('names the mode «Текст», not «Исходник» and not the text editor, in every message', () => {
    for (const text of Object.values(messages)) expect(text).not.toContain('Исходник')
    for (const text of Object.values(messages)) expect(text).not.toContain('текстовом редакторе')
    expect(messages['not-editable']).toBe('Этот блок пока правится только в режиме «Текст».')
    expect(messages['inside-plate']).toBe('Это место внутри блока, который редактор показывает плашкой: правьте его в режиме «Текст».')
  })

  it('the cross and the next typing hide the message', () => {
    open('Абзац.\n\nтермин:: один\n\nКонец.\n')
    const view = page!.editor!.view
    let at = -1
    view.state.doc.forEach((node, pos) => node.type.name === 'island' && (at = pos))
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, at)))
    type('x')
    const notice = root.querySelector<HTMLElement>('.notice')!
    expect(notice.hidden).toBe(false)
    root.querySelector<HTMLElement>('.notice-x')!.click()
    expect(notice.hidden).toBe(true)
    expect(root.querySelector('.notice-x')!.getAttribute('aria-label')).toBe('Скрыть')
    expect(root.querySelector('.notice-x')!.getAttribute('title')).toBe('Скрыть')
  })
})

describe('links', () => {
  it('a click on a link puts the cursor and does not follow the address', () => {
    open('Смотри https://example.org[сайт] тут.\n')
    const a = page!.editor!.view.dom.querySelector('a')!
    expect(a).not.toBeNull()
    const click = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })
    const outside = vi.fn()
    document.body.addEventListener('click', outside)
    a.dispatchEvent(click)
    expect(click.defaultPrevented).toBe(true)
    expect(outside).not.toHaveBeenCalled()
  })

  it('typing in the text of a link changes the text and not the address', () => {
    open('Смотри https://example.org[сайт] тут.\n')
    cursorAfter('сай')
    type('ы')
    vi.advanceTimersByTime(300)
    expect(page!.mirror!.text).toBe('Смотри https://example.org[сайыт] тут.\n')
  })
})

describe('the theme', () => {
  it('follows the class of body now and when it changes', async () => {
    vi.useRealTimers()
    for (const [classes, theme] of [
      ['vscode-light', 'light'],
      ['vscode-dark', 'dark'],
      ['vscode-high-contrast', 'dark'],
      ['vscode-high-contrast vscode-high-contrast-light', 'light'],
    ] as const) {
      const body = document.body
      body.className = classes
      expect(themeOf(body.classList)).toBe(theme)
    }
    document.body.className = 'vscode-light'
    open('текст\n')
    expect(document.body.dataset.notaTheme).toBe('light')
    document.body.className = 'vscode-dark'
    await new Promise((r) => setTimeout(r, 0))
    expect(document.body.dataset.notaTheme).toBe('dark')
    // the text and the cursor are where they were
    expect(page!.editor!.view.dom.textContent).toBe('текст')
    document.body.className = 'vscode-high-contrast vscode-high-contrast-light'
    await new Promise((r) => setTimeout(r, 0))
    expect(document.body.dataset.notaTheme).toBe('light')
  })
})

describe('no network', () => {
  it('opening, typing, marks, undo and theme call nothing outside', () => {
    const calls: string[] = []
    const note = (what: string) => () => {
      calls.push(what)
      throw new Error(what)
    }
    vi.stubGlobal('fetch', note('fetch'))
    vi.stubGlobal('WebSocket', note('WebSocket'))
    vi.stubGlobal('EventSource', note('EventSource'))
    vi.spyOn(XMLHttpRequest.prototype, 'open').mockImplementation(note('xhr'))
    open(fixture('editor/visual.adoc'))
    cursorAfter('Сделать')
    type(' новое')
    key('KeyB', { key: 'b', metaKey: true })
    key('KeyZ', { key: 'z', metaKey: true })
    document.body.className = 'vscode-dark'
    vi.advanceTimersByTime(1000)
    expect(calls).toEqual([])
    vi.unstubAllGlobals()
  })
})
