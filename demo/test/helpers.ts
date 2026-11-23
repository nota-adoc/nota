// Helpers of the tests of the demo page: the page of index.html is put into a jsdom document, demo/src/main.ts runs on it
// as it does in the browser, and the tests use the page the way a person does.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { EditorView as CodeMirrorView } from '@codemirror/view'
import { NodeSelection, TextSelection } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'
import { expect, vi } from 'vitest'

export const demoDir = join(import.meta.dirname, '..')
export const read = (path: string): string => readFileSync(join(demoDir, path), 'utf8')
export const fixture = (path: string): string => readFileSync(join(demoDir, '../quality/fixtures', path), 'utf8')
/** The number as the Russian page writes it. */
export const nf = (n: number): string => new Intl.NumberFormat('ru-RU').format(n)
/** The document as data: the page has its own copy of the modules (it is loaded fresh), so nodes are compared by what they hold. */
export const json = (node: { toJSON(): unknown }): string => JSON.stringify(node.toJSON())
export const external = /(?:https?:)?\/\/(?!localhost\b|127\.0\.0\.1\b)[\w-]+(?:\.[\w-]+)+/i

// jsdom's Blob lacks arrayBuffer(), which every browser has
if (!Blob.prototype.arrayBuffer)
  Blob.prototype.arrayBuffer = function (this: Blob) {
    return new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as ArrayBuffer)
      reader.onerror = () => reject(reader.error)
      reader.readAsArrayBuffer(this)
    })
  }

/** What leaves the page: every way for a script to talk to the network that jsdom has, recorded. */
export const outgoing: string[] = []
export function stubNetwork(): void {
  const note =
    (what: string) =>
    (...args: unknown[]) => {
      outgoing.push(`${what} ${String(args[0])}`)
      throw new Error(`network access in the demo: ${what}`)
    }
  vi.stubGlobal('fetch', note('fetch'))
  vi.stubGlobal('WebSocket', function (this: unknown, url: string) {
    note('WebSocket')(url)
  })
  vi.stubGlobal('EventSource', function (this: unknown, url: string) {
    note('EventSource')(url)
  })
  vi.spyOn(XMLHttpRequest.prototype, 'open').mockImplementation(note('XMLHttpRequest') as never)
  Object.defineProperty(navigator, 'sendBeacon', { value: note('sendBeacon'), configurable: true })
}

/** The system the page runs in: its colour scheme and the width of the window (`(max-width: 719px)` is the narrow one). */
export interface System {
  dark?: boolean
  narrow?: boolean
  /** The platform of the keyboard. Default: not a Mac. */
  mac?: boolean
  /** `navigator.language` of the browser. Default `ru-RU`: the older tests of the page read Russian captions. */
  language?: string
  /** What `localStorage` holds under `nota-demo-lang` before the page starts, or `'throws'`: it is not available. */
  stored?: string | 'throws'
}

export interface Media {
  setDark(dark: boolean): void
  setNarrow(narrow: boolean): void
}

function stubSystem(system: System): Media {
  const state = { dark: system.dark ?? false, narrow: system.narrow ?? false }
  const listeners: Array<{ query: string; fn: (e: { matches: boolean }) => void }> = []
  const matches = (query: string): boolean =>
    query.includes('prefers-color-scheme: dark') ? state.dark : query.includes('max-width') ? state.narrow : false
  vi.stubGlobal('matchMedia', (query: string) => ({
    get matches() {
      return matches(query)
    },
    media: query,
    onchange: null,
    addEventListener: (_type: string, fn: (e: { matches: boolean }) => void) => listeners.push({ query, fn }),
    removeEventListener: (_type: string, fn: unknown) => {
      const at = listeners.findIndex((l) => l.fn === fn)
      if (at >= 0) listeners.splice(at, 1)
    },
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }))
  const fire = (kind: string) => {
    for (const l of [...listeners]) if (l.query.includes(kind)) l.fn({ matches: matches(l.query) })
  }
  Object.defineProperty(navigator, 'language', { value: system.language ?? 'ru-RU', configurable: true })
  if (system.stored === 'throws') {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError')
    })
  } else if (system.stored) localStorage.setItem('nota-demo-lang', system.stored)
  Object.defineProperty(navigator, 'platform', { value: system.mac ? 'MacIntel' : 'Linux x86_64', configurable: true })
  return {
    setDark(dark) {
      state.dark = dark
      fire('prefers-color-scheme')
    },
    setNarrow(narrow) {
      state.narrow = narrow
      fire('max-width')
    },
  }
}

/** Listeners the page puts on `document` and `window`: taken off after each test, so that pages of tests do not pile up. */
const attached: Array<[EventTarget, string, unknown, unknown]> = []
function trackListeners(): void {
  for (const target of [document, window] as EventTarget[]) {
    const add = target.addEventListener.bind(target)
    vi.spyOn(target, 'addEventListener').mockImplementation((type, fn, options) => {
      attached.push([target, type, fn, options])
      add(type, fn, options)
    })
  }
}

export async function openPage(system: System = {}) {
  const media = stubSystem(system)
  trackListeners()
  const html = read('index.html')
  document.body.innerHTML = html
    .slice(html.indexOf('<body>') + 6, html.indexOf('</body>'))
    .replace(/<script[^>]*><\/script>/g, '')
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.lang = 'en'
  vi.resetModules()
  await import('../src/main.js')
  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
  const demo = () => window.notaDemo!
  return {
    media,
    $,
    app: $('app'),
    work: $('work'),
    sample: $<HTMLSelectElement>('sample'),
    style: $<HTMLSelectElement>('style'),
    file: $<HTMLInputElement>('file'),
    session: () => demo().session,
    /** The text of the session. */
    text: () => demo().session.text,
    visual: () => demo().visual,
    /** The ProseMirror view of «Визуально». */
    pm: (): EditorView => demo().visual.view,
    /** The CodeMirror view of «Исходник». */
    cm: (): CodeMirrorView => demo().source.view,
    /** A toolbar button by its command: undo, redo, strong, em, code, s, mark, link, unlink. */
    btn: (cmd: string) => document.querySelector<HTMLButtonElement>(`#toolbar [data-cmd="${cmd}"]`)!,
    /** A click on a button of the toolbar, as the page gets it (the mouse goes down first, and the page may keep the focus). */
    press(cmd: string) {
      const button = document.querySelector<HTMLButtonElement>(`#toolbar [data-cmd="${cmd}"]`)!
      button.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
      button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    },
    pressed: (cmd: string) => document.querySelector(`#toolbar [data-cmd="${cmd}"]`)!.getAttribute('aria-pressed'),
    disabled: (cmd: string) => document.querySelector(`#toolbar [data-cmd="${cmd}"]`)!.getAttribute('aria-disabled') === 'true',
    view: (name: 'visual' | 'split' | 'source') =>
      document.querySelector(`.seg [data-view="${name}"]`)!.dispatchEvent(new MouseEvent('click', { bubbles: true })),
    notice: () => {
      const box = document.getElementById('notice')!
      return box.hidden ? null : document.getElementById('notice-text')!.textContent
    },
    length: () => $('len').textContent!,
    path: () => $('path').textContent!,
    count: (level: 'error' | 'warning' | 'info') =>
      document.querySelector(`.count[data-sev="${level}"]`)!.querySelector('.n')!.textContent!,
  }
}
export type Page = Awaited<ReturnType<typeof openPage>>

export function closePage(): void {
  for (const el of document.querySelectorAll<HTMLElement>('.cm-editor')) CodeMirrorView.findFromDOM(el)?.destroy()
  try {
    window.notaDemo?.visual.destroy()
  } catch {
    // already gone
  }
  delete window.notaDemo
  for (const [target, type, fn, options] of attached) target.removeEventListener(type, fn as never, options as never)
  attached.length = 0
  document.body.innerHTML = ''
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.lang = 'en'
  localStorage.clear()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
}

export const choose = (page: Page, id: string): void => {
  page.sample.value = id
  page.sample.dispatchEvent(new Event('change'))
}

/** «Открыть файл»: the input gets a local file, as the file dialog does. */
export async function load(page: Page, content: string | Uint8Array, name = 'doc.adoc'): Promise<void> {
  const file = new File([content as BlobPart], name, { type: '' })
  Object.defineProperty(page.file, 'files', { value: [file], configurable: true })
  Object.defineProperty(page.file, 'value', { get: () => '', set: () => {}, configurable: true })
  page.file.dispatchEvent(new Event('change'))
  const text = typeof content === 'string' ? content : new TextDecoder('utf-8', { ignoreBOM: true }).decode(content)
  await vi.waitFor(() => expect(page.text()).toBe(text), { timeout: 20_000 })
}

/** Selects the text `text` in the visual editor (it must be in one block). */
export function selectText(page: Page, text: string): void {
  const view = page.pm()
  let found = -1
  view.state.doc.descendants((node, pos) => {
    if (found < 0 && node.isText && node.text!.includes(text)) found = pos + node.text!.indexOf(text)
    return found < 0
  })
  expect(found, `"${text}" is on the screen`).toBeGreaterThanOrEqual(0)
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, found, found + text.length)))
}

/** Puts the cursor into `text` in the visual editor, `offset` characters after its start. */
export function cursorIn(page: Page, text: string, offset = 1): void {
  const view = page.pm()
  let found = -1
  view.state.doc.descendants((node, pos) => {
    if (found < 0 && node.isText && node.text!.includes(text)) found = pos + node.text!.indexOf(text)
    return found < 0
  })
  expect(found, `"${text}" is on the screen`).toBeGreaterThanOrEqual(0)
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, found + offset)))
}

/** Selects a plate of the visual editor as a click does: the block of the kind `kind` (a name of a node of the core, e.g. `UnorderedList`). */
export function selectPlate(page: Page, kind: string): HTMLElement {
  const view = page.pm()
  let found = -1
  view.state.doc.descendants((node, pos) => {
    if (found < 0 && ((node.type.name === 'island' && node.attrs.kind === kind) || (node.type.name === 'code_block' && kind === 'DelimitedBlock'))) found = pos
    return found < 0
  })
  expect(found, `a plate ${kind} is on the screen`).toBeGreaterThanOrEqual(0)
  view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, found)))
  return view.nodeDOM(found) as HTMLElement
}

/** A key pressed in an editor: the event reaches the page the way the keyboard sends it. */
export function key(
  target: EventTarget,
  name: string,
  mods: { ctrl?: boolean; shift?: boolean; alt?: boolean; meta?: boolean; code?: string } = {},
): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key: name,
    code: mods.code ?? (name.length === 1 ? `Key${name.toUpperCase()}` : name),
    keyCode: name.length === 1 ? name.toUpperCase().charCodeAt(0) : 0,
    ctrlKey: mods.ctrl ?? false,
    shiftKey: mods.shift ?? false,
    altKey: mods.alt ?? false,
    metaKey: mods.meta ?? false,
    bubbles: true,
    cancelable: true,
  })
  target.dispatchEvent(event)
  return event
}

/** A character typed into the visual editor with a plate selected or a range across blocks: the key press ProseMirror hears of. */
export function typeChar(page: Page, char: string): KeyboardEvent {
  const event = new KeyboardEvent('keypress', {
    key: char,
    charCode: char.charCodeAt(0),
    bubbles: true,
    cancelable: true,
  })
  page.pm().dom.dispatchEvent(event)
  return event
}

/** Selects the text from the start of `first` to the end of `last`: two paragraphs (or more) of the visual editor. */
export function selectAcross(page: Page, first: string, last: string): void {
  const view = page.pm()
  let from = -1
  let to = -1
  view.state.doc.descendants((node, pos) => {
    if (node.isText && from < 0 && node.text!.includes(first)) from = pos + node.text!.indexOf(first)
    if (node.isText && from >= 0 && to < 0 && pos > from && node.text!.includes(last)) to = pos + node.text!.indexOf(last) + last.length
    return true
  })
  expect(from >= 0 && to > from, `"${first}" … "${last}" are on the screen`).toBe(true)
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)))
}

export const ctrlZ = (view: CodeMirrorView | EditorView, shift = false): KeyboardEvent =>
  key(view instanceof CodeMirrorView ? view.contentDOM : view.dom, shift ? 'Z' : 'z', { ctrl: true, shift, code: 'KeyZ' })
