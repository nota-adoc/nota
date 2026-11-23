import { diagnosticCount, forceLinting, forEachDiagnostic, openLintPanel } from '@codemirror/lint'
import { EditorView } from '@codemirror/view'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parse } from '@nota-adoc/core'
import { asciidoc } from '@nota-adoc/codemirror'
import { fixtures } from './helpers.js'

const views: EditorView[] = []
afterEach(() => {
  for (const v of views.splice(0)) v.destroy()
})
function mount(doc: string, lint?: boolean): EditorView {
  const view = new EditorView({ doc, extensions: [asciidoc({ lint })], parent: document.body })
  views.push(view)
  ;(view as unknown as { measure(): void }).measure()
  return view
}

interface Found {
  from: number
  to: number
  severity: string
  source?: string
  text: string
}
function found(view: EditorView): Found[] {
  const out: Found[] = []
  forEachDiagnostic(view.state, (d, from, to) =>
    out.push({ from, to, severity: d.severity, source: d.source, text: d.renderMessage ? d.renderMessage(view).textContent! : d.message }),
  )
  return out
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
/** Forces the linter and waits until it has answered: the count of marks is the count of `parse(text).diagnostics`. */
async function lintNow(view: EditorView, lint = true) {
  forceLinting(view)
  if (!lint) return void (await sleep(20))
  const expected = parse(view.state.doc.toString()).diagnostics.length
  // a fixed pause is too short on a busy machine; a failure to answer still ends in the assertion of the test
  await vi.waitFor(() => expect(diagnosticCount(view.state)).toBe(expected), { timeout: 20_000, interval: 5 })
}

describe('lint', () => {
  it('marks an unclosed block under its opening delimiter, with the message and the code; a closing line removes it once the linter has run', async () => {
    const src = 'text\n\n----\ncode\n'
    const view = mount(src)
    await lintNow(view)
    const [d] = found(view)
    expect(found(view)).toHaveLength(1)
    expect(d).toMatchObject({ severity: 'warning', source: 'nota', from: 6, to: 10 })
    expect(d!.text).toContain('unterminated-block')
    expect(d!.text).toContain(parse(src).diagnostics[0]!.message)
    view.dispatch({ changes: { from: src.length, insert: '----\n' } })
    // no forcing: the linter runs by itself after its delay
    await vi.waitFor(() => expect(found(view)).toEqual([]), { timeout: 20_000, interval: 20 })
  })

  it('the option message replaces the text of the hint and keeps the code', async () => {
    const view = new EditorView({
      doc: 'text\n\n----\ncode\n',
      extensions: [asciidoc({ message: (d) => `[${d.code}] translated` })],
      parent: document.body,
    })
    views.push(view)
    ;(view as unknown as { measure(): void }).measure()
    await lintNow(view)
    const [d] = found(view)
    expect(d!.text).toBe('[unterminated-block] translated unterminated-block')
  })

  it('reports an endif without a partner as an error and a list item in a paragraph as info', async () => {
    const view = mount('endif::x[]\n\ntext\n* item\n')
    await lintNow(view)
    const list = found(view)
    expect(list.map((d) => [d.severity, d.text.match(/unmatched-endif|list-item-as-text/)?.[0]])).toEqual([
      ['error', 'unmatched-endif'],
      ['info', 'list-item-as-text'],
    ])
  })

  it('the panel lists exactly as many entries as parse(text).diagnostics on every fixture', async () => {
    let withDiagnostics = 0
    for (const [name, text] of fixtures()) {
      const view = mount(text)
      await lintNow(view)
      const expected = parse(text).diagnostics.length
      expect(diagnosticCount(view.state), name).toBe(expected)
      expect(openLintPanel(view)).toBe(true)
      const items = view.dom.querySelectorAll('.cm-panel-lint ul li')
      // an empty panel shows one line, "No diagnostics"
      if (expected === 0) expect(items[0]!.textContent, name).toBe('No diagnostics')
      else expect(items.length, name).toBe(expected)
      if (expected) withDiagnostics++
      view.destroy()
    }
    expect(withDiagnostics).toBeGreaterThan(5)
    // one pass over all fixtures took 175 s on a loaded machine: the limit is a few times that, each wait inside
    // is still 20 s at most
  }, 600_000)

  it('lint: false removes the lines and the panel', async () => {
    const view = mount('----\ncode\n', false)
    await lintNow(view, false)
    expect(found(view)).toEqual([])
    view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'M', code: 'KeyM', keyCode: 77, ctrlKey: true, shiftKey: true, bubbles: true }))
    expect(view.dom.querySelector('.cm-panel-lint')).toBeNull()
  })

  it('opens the panel with Mod-Shift-M', async () => {
    const view = mount('----\ncode\n')
    await lintNow(view)
    view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'M', code: 'KeyM', keyCode: 77, ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }))
    expect(view.dom.querySelector('.cm-panel-lint')).not.toBeNull()
  })
})
