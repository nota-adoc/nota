import { foldEffect } from '@codemirror/language'
import { EditorSelection } from '@codemirror/state'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { type SourceChange, type SourceEditor, createSession, createSourceEditor } from '@nota-adoc/codemirror'
import { prng } from '../../../quality/bench/bench.js'

const editors: SourceEditor[] = []
afterEach(() => {
  for (const e of editors.splice(0)) e.destroy()
  document.body.innerHTML = ''
  vi.useRealTimers()
})

function open(options: Parameters<typeof createSourceEditor>[1] = {}): SourceEditor {
  const el = document.createElement('div')
  document.body.append(el)
  const e = createSourceEditor(el, options)
  editors.push(e)
  return e
}

const key = (e: SourceEditor, k: string, mods: { shift?: boolean } = {}) =>
  e.view.contentDOM.dispatchEvent(
    new KeyboardEvent('keydown', { key: mods.shift ? k.toUpperCase() : k, code: `Key${k.toUpperCase()}`, keyCode: k.toUpperCase().charCodeAt(0), ctrlKey: true, shiftKey: !!mods.shift, bubbles: true, cancelable: true }),
  )
const undo = (e: SourceEditor) => key(e, 'z')
const redo = (e: SourceEditor) => key(e, 'z', { shift: true })
/** A user's edit in an editor: what typing does to the view. */
const type = (e: SourceEditor, from: number, insert: string, to = from) =>
  e.view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length }, userEvent: 'input.type' })

describe('two editors on one session', () => {
  const start = '= Title\n\nA paragraph.\n\n== Section\n\ntext\n'

  it('shows a change made in one editor in the other right away', () => {
    const session = createSession(start)
    const a = open({ session })
    const b = open({ session })
    'hello'.split('').forEach((ch, i) => {
      type(a, 9 + i, ch)
      expect(b.getText()).toBe(a.getText())
      expect(session.text).toBe(a.getText())
    })
    type(b, 0, '// ')
    expect(a.getText()).toBe(b.getText())
    expect(a.getText().startsWith('// = Title')).toBe(true)
  })

  it('Mod-Z in the second undoes the last step made in the first; Mod-Shift-Z and Mod-Y redo it', () => {
    const session = createSession(start)
    const a = open({ session })
    const b = open({ session })
    type(a, 9, 'X')
    const changed = a.getText()
    undo(b)
    expect(a.getText()).toBe(start)
    expect(b.getText()).toBe(start)
    redo(b)
    expect(a.getText()).toBe(changed)
    expect(b.getText()).toBe(changed)
    undo(a)
    key(b, 'y')
    expect(b.getText()).toBe(changed)
    expect(a.getText()).toBe(changed)
  })

  it('sends the undo and redo of the browser menu (beforeinput historyUndo, historyRedo) to the session', () => {
    const session = createSession(start)
    const a = open({ session })
    const b = open({ session })
    type(a, 9, 'X')
    const changed = a.getText()
    const input = (e: SourceEditor, inputType: string) => {
      const event = new InputEvent('beforeinput', { inputType, bubbles: true, cancelable: true })
      e.view.contentDOM.dispatchEvent(event)
      return event
    }
    expect(input(b, 'historyUndo').defaultPrevented).toBe(true)
    expect(a.getText()).toBe(start)
    expect(b.getText()).toBe(start)
    expect(input(b, 'historyRedo').defaultPrevented).toBe(true)
    expect(a.getText()).toBe(changed)
    expect(b.getText()).toBe(changed)
    expect(session.canUndo).toBe(true)
  })

  it('typing with pauses shorter than 500 ms is one step of undo, a longer pause makes a new one', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    const session = createSession(start)
    const a = open({ session })
    'abc'.split('').forEach((ch, i) => {
      type(a, 9 + i, ch)
      vi.advanceTimersByTime(300)
    })
    vi.advanceTimersByTime(700)
    type(a, 12, 'd')
    expect(a.getText()).toContain('abcd')
    undo(a)
    expect(a.getText()).toContain('abc')
    expect(a.getText()).not.toContain('abcd')
    undo(a)
    expect(a.getText()).toBe(start)
  })

  it('puts the cursor of the window where Mod-Z was pressed at the place of the step', () => {
    const session = createSession(start)
    const a = open({ session })
    const b = open({ session })
    type(a, 20, 'inserted ')
    b.view.dispatch({ selection: EditorSelection.cursor(0) })
    undo(b)
    expect(b.view.state.selection.main.head).toBe(20)
    expect(b.getText()).toBe(start)
    redo(b)
    expect(b.view.state.selection.main.head).toBe(20 + 'inserted '.length)
  })

  it('an editor without a session makes its own and undoes with Mod-Z', () => {
    const a = open({ text: start })
    expect(a.session.text).toBe(start)
    type(a, 0, 'x')
    expect(a.session.text).toBe('x' + start)
    undo(a)
    expect(a.getText()).toBe(start)
    expect(a.session.text).toBe(start)
  })

  it('shows changes made through the session directly, with a Nota document behind them', () => {
    const session = createSession(start)
    const a = open({ session })
    session.apply([{ from: 0, insert: '// ' }])
    expect(a.getText()).toBe('// ' + start)
    session.undo()
    expect(a.getText()).toBe(start)
  })

  for (const seed of [7, 20260929]) {
    it(`200 random edits in both windows: same text everywhere, undo to the end gives the first text, redo the last (seed ${seed})`, () => {
      const rnd = prng(seed)
      const session = createSession(start)
      const windows = [open({ session }), open({ session })]
      const pieces = ['x', 'привет ', 'ё', '\n', '\r\n', '== T\n', '* item\n', '----\n', 'ifdef::a[]\n', '', ' ']
      for (let i = 0; i < 200; i++) {
        const w = windows[rnd() < 0.5 ? 0 : 1]!
        const len = w.getText().length
        const from = Math.floor(rnd() * (len + 1))
        const to = Math.min(len, from + (rnd() < 0.4 ? 0 : Math.floor(rnd() * 6)))
        type(w, from, pieces[Math.floor(rnd() * pieces.length)]!, to)
        expect(windows[0]!.getText()).toBe(windows[1]!.getText())
        expect(session.text).toBe(windows[0]!.getText())
      }
      const end = session.text
      let guard = 0
      while (session.canUndo && guard++ < 1000) {
        undo(windows[rnd() < 0.5 ? 0 : 1]!)
        expect(windows[0]!.getText()).toBe(windows[1]!.getText())
      }
      expect(windows[0]!.getText()).toBe(start)
      expect(windows[1]!.getText()).toBe(start)
      while (session.canRedo && guard++ < 2000) redo(windows[rnd() < 0.5 ? 0 : 1]!)
      expect(windows[0]!.getText()).toBe(end)
      expect(windows[1]!.getText()).toBe(end)
    })
  }
})

describe('the API of the host', () => {
  it('getText returns the current text, exactly', () => {
    const text = 'a\r\nb\rc\n'
    const e = open({ text })
    expect(e.getText()).toBe(text)
    type(e, 1, 'X')
    expect(e.getText()).toBe('aX\r\nb\rc\n')
  })

  it('onChange is called once per transaction that changes the text, and never for the cursor, folds or scrolling', () => {
    const calls: SourceChange[] = []
    const e = open({ text: '== One\nbody\nmore\n\n== Two\n', onChange: (c) => calls.push(c) })
    e.view.dispatch({ selection: EditorSelection.cursor(3) })
    e.view.dispatch({ effects: foldEffect.of({ from: 6, to: 16 }) })
    e.scrollToPos(10)
    e.view.dispatch({ selection: EditorSelection.cursor(5), scrollIntoView: true })
    expect(calls).toHaveLength(0)
    type(e, 0, 'x')
    expect(calls).toEqual([{ changes: [{ from: 0, to: 0, insert: 'x' }], source: 'user' }])
    e.session.undo()
    expect(calls).toHaveLength(2)
    expect(calls[1]).toEqual({ changes: [{ from: 0, to: 1, insert: '' }], source: 'undo' })
    // a transaction with several changes is one call
    e.view.dispatch({ changes: [{ from: 0, insert: 'a' }, { from: 2, insert: 'b' }] })
    expect(calls).toHaveLength(3)
  })

  it('onChange also tells about the changes that come from the session', () => {
    const session = createSession('abc')
    const calls: SourceChange[] = []
    open({ session, onChange: (c) => calls.push(c) })
    session.apply([{ from: 3, insert: 'd' }])
    expect(calls).toEqual([{ changes: [{ from: 3, to: 3, insert: 'd' }], source: 'session' }])
  })

  it('scrollToPos and topVisiblePos: the top line is the one at the scroll offset', () => {
    const text = Array.from({ length: 200 }, (_, i) => `line ${i}`).join('\n')
    const e = open({ text })
    expect(e.topVisiblePos()).toBe(0)
    // jsdom has no layout: the scroll offset and the line at a height are given
    const { view } = e
    Object.defineProperty(view.scrollDOM, 'scrollTop', { value: 700, configurable: true, writable: true })
    const at = vi.spyOn(view, 'lineBlockAtHeight').mockImplementation(
      (h) => ({ from: view.state.doc.line(1 + Math.floor(h / 14)).from }) as ReturnType<typeof view.lineBlockAtHeight>,
    )
    expect(e.topVisiblePos()).toBe(view.state.doc.line(1 + Math.floor((700 - view.documentPadding.top) / 14)).from)
    at.mockRestore()
    // the request to scroll is made through CodeMirror: the target is the start of the line with the position
    const spy = vi.spyOn(view, 'dispatch')
    const target = (call: number) => {
      const { effects } = spy.mock.calls[call]![0] as { effects: unknown }
      const effect = (Array.isArray(effects) ? effects[0] : effects) as { value: { range: { head: number } } }
      return effect.value.range.head
    }
    e.scrollToPos(text.indexOf('line 120') + 3)
    expect(spy).toHaveBeenCalledTimes(1)
    expect(target(0)).toBe(text.indexOf('line 120') + 3)
    // a position past the end is the end
    e.scrollToPos(10 ** 9)
    expect(target(1)).toBe(text.length)
  })

  it('destroy removes the editor from the page and from the session', () => {
    const session = createSession('abc')
    const el = document.createElement('div')
    document.body.append(el)
    const e = createSourceEditor(el, { session })
    expect(el.querySelector('.cm-editor')).not.toBeNull()
    const other = open({ session })
    e.destroy()
    expect(el.querySelector('.cm-editor')).toBeNull()
    expect(() => session.apply([{ from: 0, insert: 'x' }])).not.toThrow()
    expect(() => session.undo()).not.toThrow()
    expect(other.getText()).toBe('abc')
    session.apply([{ from: 3, insert: 'd' }])
    expect(other.getText()).toBe('abcd')
  })
})
