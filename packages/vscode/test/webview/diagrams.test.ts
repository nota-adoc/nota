// In the tab: diagrams drawn by the renderer of the tab, the theme, Cmd+Shift+V.
import { RendererMissing } from '@nota-adoc/prosemirror'
import { TextSelection } from 'prosemirror-state'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type Page, startPage } from '../../src/webview/main.js'
import { createMermaidRenderer, inert, themeVariables } from '../../src/webview/mermaid.js'
import type { ToHost, ToTab } from '../../src/protocol.js'

let sent: ToHost[]
let root: HTMLElement
let page: Page | undefined
const api = { postMessage: (m: ToHost) => void sent.push(m) }
const host = (message: ToTab): void => void window.dispatchEvent(new MessageEvent('message', { data: message }))
const SRC = 'Before\n\n[mermaid]\n....\nflowchart LR\n  A --> B\n....\n\nAfter\n'

function open(text: string, render?: (code: string, theme: 'light' | 'dark') => Promise<string>): Page {
  root = document.createElement('div')
  document.body.append(root)
  page = startPage(api, root, render ? { renderDiagram: render } : {})
  host({ type: 'init', text, version: 1, fileName: 'a.adoc', locale: 'ru', outlineView: 'capsule', fileDir: '/work/docs', mode: 'visual' })
  return page
}

beforeEach(() => {
  vi.useFakeTimers()
  sent = []
  page = undefined
})
afterEach(() => {
  page?.destroy()
  document.body.textContent = ''
  document.body.className = ''
  document.head.querySelectorAll('script').forEach((s) => s.remove())
  delete (window as { __notaMermaid?: unknown }).__notaMermaid
  Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
  vi.useRealTimers()
})

describe('a diagram in the tab', () => {
  it('is drawn by the renderer of the tab, with the theme of the tab', async () => {
    const calls: string[] = []
    open(SRC, (code, theme) => {
      calls.push(`${theme}:${code}`)
      return Promise.resolve('<svg><text>ok</text></svg>')
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(root.querySelectorAll('.nota-diagram .diagram-pic svg')).toHaveLength(1)
    expect(calls).toEqual(['light:flowchart LR\n  A --> B'])
    // a change of the theme of VS Code draws the pictures again, in the colours of the new one
    document.body.classList.add('vscode-dark')
    await vi.advanceTimersByTimeAsync(0)
    expect(calls.at(-1)).toBe('dark:flowchart LR\n  A --> B')
    expect(page!.mirror!.text).toBe(SRC)
  })

  it('says that the renderer did not load when the page has no address for it', async () => {
    open(SRC)
    await vi.advanceTimersByTimeAsync(0)
    expect(root.querySelector('.diagram-plate.nodrawer')!.textContent).toContain('Схемы не рисуются: рисовальщик не загрузился')
  })

  it('the menu of «Вставить» and «/» have Mermaid, and its words are in Russian', async () => {
    open('a\n\n\n', () => Promise.resolve('<svg/>'))
    const editor = page!.editor!
    const state = editor.view.state
    editor.view.dispatch(state.tr.setSelection(TextSelection.near(state.doc.resolve(state.doc.child(0).nodeSize + 1))))
    expect(editor.commands.insertBlock('mermaid')).toBe(true)
    expect(page!.mirror!.text).toContain('[mermaid]\n....\nflowchart LR')
  })
})

describe('Cmd+Shift+V', () => {
  const chord = (): KeyboardEvent => {
    const event = new KeyboardEvent('keydown', { code: 'KeyV', key: 'v', metaKey: true, shiftKey: true, bubbles: true, cancelable: true })
    root.querySelector('.ProseMirror')!.dispatchEvent(event)
    return event
  }

  it('pastes the plain text of the clipboard, every line a paragraph', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: { readText: () => Promise.resolve('one\ntwo') }, configurable: true })
    open('\n')
    page!.editor!.setSelectionAtOffset(0)
    expect(chord().defaultPrevented).toBe(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(page!.mirror!.text).toBe('one\n\ntwo\n')
    expect(sent.filter((m) => m.type === 'readClipboard')).toEqual([])
  })

  it('asks the host for the clipboard when the tab may not read it, and pastes what the host sends', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: { readText: () => Promise.reject(new Error('denied')) }, configurable: true })
    open('\n')
    page!.editor!.setSelectionAtOffset(0)
    chord()
    await vi.advanceTimersByTimeAsync(0)
    expect(sent.filter((m) => m.type === 'readClipboard')).toHaveLength(1)
    host({ type: 'clipboard', text: 'from the host' })
    expect(page!.mirror!.text.startsWith('from the host')).toBe(true)
    expect(page!.mirror!.text.match(/from the host/g)).toHaveLength(1)
  })

  it('does the same when the tab has no clipboard at all', async () => {
    open('\n')
    page!.editor!.setSelectionAtOffset(0)
    chord()
    expect(sent.filter((m) => m.type === 'readClipboard')).toHaveLength(1)
  })
})

describe('the renderer of mermaid', () => {
  const fake = (render: (id: string, text: string) => Promise<{ svg: string }>): { initialize: ReturnType<typeof vi.fn> } => {
    const api = { initialize: vi.fn(), render: vi.fn(render) }
    ;(window as { __notaMermaid?: unknown }).__notaMermaid = api
    return api
  }

  it('draws in strict mode with the colours of the theme, and one diagram at a time', async () => {
    document.body.style.setProperty('--ap-accent', '#ff0000')
    const api = fake((id) => Promise.resolve({ svg: `<svg id="${id}"></svg>` }))
    const render = createMermaidRenderer(document, undefined, 'N')
    const [a, b] = await Promise.all([render('flowchart LR\nA-->B', 'dark'), render('flowchart LR\nC-->D', 'light')])
    expect(a).toContain('nota-diagram-1')
    expect(b).toContain('nota-diagram-2')
    const config = api.initialize.mock.calls[0]![0] as { securityLevel: string; themeVariables: Record<string, unknown> }
    expect(config.securityLevel).toBe('strict')
    expect(config.themeVariables.darkMode).toBe(true)
    expect(config.themeVariables.primaryBorderColor).toBe('#ff0000')
    expect((api.initialize.mock.calls[1]![0] as { themeVariables: Record<string, unknown> }).themeVariables.darkMode).toBe(false)
  })

  it('gives the error of mermaid as it is', async () => {
    fake(() => Promise.reject(new Error('Parse error on line 2')))
    const render = createMermaidRenderer(document, undefined, undefined)
    await expect(render('x', 'light')).rejects.toThrow('Parse error on line 2')
  })

  it('has no renderer when there is no address, or the file does not open', async () => {
    await expect(createMermaidRenderer(document, undefined, undefined)('x', 'light')).rejects.toBeInstanceOf(RendererMissing)
    const render = createMermaidRenderer(document, 'https://file.test/dist/mermaid.js', 'N')
    const result = render('x', 'light')
    await vi.advanceTimersByTimeAsync(0)
    const script = document.head.querySelector('script')!
    expect(script.nonce).toBe('N')
    expect(script.src).toBe('https://file.test/dist/mermaid.js')
    script.dispatchEvent(new Event('error'))
    await expect(result).rejects.toBeInstanceOf(RendererMissing)
  })

  it('loads the file once, when the first diagram asks for it', async () => {
    const render = createMermaidRenderer(document, 'https://file.test/dist/mermaid.js', undefined)
    expect(document.head.querySelector('script')).toBeNull()
    const first = render('a', 'light')
    void render('b', 'light').catch(() => undefined)
    await vi.advanceTimersByTimeAsync(0)
    expect(document.head.querySelectorAll('script')).toHaveLength(1)
    fake(() => Promise.resolve({ svg: '<svg/>' }))
    document.head.querySelector('script')!.dispatchEvent(new Event('load'))
    await expect(first).resolves.toContain('svg')
  })

  it('takes the links, pictures and handlers out of a picture, and keeps the text of a node', () => {
    const svg =
      '<svg><a xlink:href="https://example.com/"><g><text>Node</text></g></a><image href="https://x.test/a.png"/><img src="x"><g onclick="alert(1)"><use xlink:href="#m"/></g></svg>'
    const out = inert(document, svg)
    expect(out).not.toMatch(/<a[ >]|https|onclick|<img|<image/)
    expect(out).toContain('<text>Node</text>')
    expect(out).toContain('#m')
  })

  it('takes the colours of the tokens of the page, and has its own where there are none', () => {
    expect(themeVariables(document, 'dark').lineColor).toBe('#b4b9c4')
    expect(themeVariables(document, 'light').background).toBe('#ffffff')
    document.body.style.setProperty('--ap-paper', '#101010')
    expect(themeVariables(document, 'dark').background).toBe('#101010')
  })
})
