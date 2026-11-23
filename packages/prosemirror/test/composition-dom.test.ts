// the order of events of Chromium when an input method ends with a text other than what it showed.
//
// The browser changes the DOM and sends `compositionend` in one run of the script, so the observer of ProseMirror
// has not yet told the view about the last change when the handler of `compositionend` runs (a microtask is not run
// between the two when no other listener sits on the event). The editor must take what the input method ended with,
// not what it showed before.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { projectDocument } from '@nota-adoc/prosemirror'
import { closeAll, composition, open, posIn, select, textOf, type } from './helpers.js'

afterEach(closeAll)

type Setup = ReturnType<typeof open>

const tick = (ms = 0): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** The text node of the paragraph number `i`, and the DOM selection put in it (as the browser has it while typing). */
function textNode(editor: Setup['editor'], i: number, inside?: string): Text {
  const p = editor.view.dom.children[i]!
  const holder = inside ? p.querySelector(inside)! : p
  return holder.firstChild as Text
}

/** What the browser does when the input method shows or ends a text: the text node changes, the caret is after it. */
function dom(editor: Setup['editor'], i: number, value: string, caret: number, inside?: string): void {
  const node = textNode(editor, i, inside)
  node.nodeValue = value
  const sel = document.getSelection()!
  sel.collapse(node, caret)
}

function ended(editor: Setup['editor']): void {
  editor.view.dom.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '' }))
}

function inSync(editor: Setup['editor'], session: Setup['session']): boolean {
  return editor.view.state.doc.eq(projectDocument(session.doc))
}

async function begin(text: string, at: number): Promise<Setup> {
  const s = open(text)
  s.editor.focus()
  select(s.editor, posIn(s.editor, 0, at))
  composition(s.editor, 'compositionstart')
  await tick()
  return s
}

describe('an input method that ends with a text other than the one it showed (Chromium order of events)', () => {
  it('pinyin: «ni» shown, «你» ends it in the run of compositionend: the text has «你», not «ni»', async () => {
    const { editor, session } = await begin('hello world\n\nnext\n', 5)
    dom(editor, 0, 'hellon world', 6)
    await tick()
    dom(editor, 0, 'helloni world', 7)
    await tick()
    expect(session.text).toBe('hello world\n\nnext\n')
    // the last change and the end come in one run of the script
    dom(editor, 0, 'hello你 world', 6)
    ended(editor)
    await tick(50)
    expect(session.text).toBe('hello你 world\n\nnext\n')
    expect(textOf(editor, 0)).toBe('hello你 world')
    expect(inSync(editor, session)).toBe(true)
    type(editor, 'z')
    expect(session.text).toBe('hello你z world\n\nnext\n')
    expect(inSync(editor, session)).toBe(true)
  })

  it('an accent from a held key: «е» shown, «ё» ends it', async () => {
    const { editor, session } = await begin('hello world\n', 5)
    dom(editor, 0, 'helloе world', 6)
    await tick()
    dom(editor, 0, 'helloё world', 6)
    ended(editor)
    await tick(50)
    expect(session.text).toBe('helloё world\n')
    expect(inSync(editor, session)).toBe(true)
  })

  it('cancelled: «п» was shown, the end takes it back: the text has nothing of it, and the next key is at the caret', async () => {
    const { editor, session } = await begin('hello world\n', 5)
    dom(editor, 0, 'helloп world', 6)
    await tick()
    expect(session.text).toBe('hello world\n')
    dom(editor, 0, 'hello world', 5)
    ended(editor)
    await tick(50)
    expect(session.text).toBe('hello world\n')
    expect(textOf(editor, 0)).toBe('hello world')
    expect(session.canUndo).toBe(false)
    expect(inSync(editor, session)).toBe(true)
    type(editor, 'z')
    expect(session.text).toBe('helloz world\n')
  })

  it('the end is the same as what was shown: one replacement, one Mod-Z takes it back', async () => {
    const { editor, session } = await begin('hello world\n', 5)
    dom(editor, 0, 'helloпр world', 7)
    await tick()
    dom(editor, 0, 'helloпр world', 7)
    ended(editor)
    await tick(50)
    expect(session.text).toBe('helloпр world\n')
    expect(inSync(editor, session)).toBe(true)
    session.undo()
    expect(session.text).toBe('hello world\n')
    expect(inSync(editor, session)).toBe(true)
  })

  it('the last change comes after compositionend (Safari order): the same result', async () => {
    const { editor, session } = await begin('hello world\n', 5)
    dom(editor, 0, 'helloni world', 7)
    await tick()
    ended(editor)
    dom(editor, 0, 'hello你 world', 6)
    await tick(80)
    expect(session.text).toBe('hello你 world\n')
    expect(inSync(editor, session)).toBe(true)
  })

  it('at the end of a bold word: what it ends with is bold, inside the markers', async () => {
    const { editor, session } = open('a *bold* b\n')
    editor.focus()
    select(editor, posIn(editor, 0, 6))
    composition(editor, 'compositionstart')
    await tick()
    dom(editor, 0, 'boldn', 5, 'strong')
    await tick()
    dom(editor, 0, 'bold你', 5, 'strong')
    ended(editor)
    await tick(50)
    expect(session.text).toBe('a *bold你* b\n')
    expect(inSync(editor, session)).toBe(true)
  })
})

describe('the history of a composition that ends with a text other than the one it showed', () => {
  it('pinyin: «ni» shown, «你» ends it: one undo takes the replacement back, one redo brings it again', async () => {
    const { editor, session } = await begin('hello world\n\nnext\n', 5)
    dom(editor, 0, 'hellon world', 6)
    await tick()
    dom(editor, 0, 'helloni world', 7)
    await tick()
    dom(editor, 0, 'hello你 world', 6)
    ended(editor)
    await tick(50)
    expect(session.text).toBe('hello你 world\n\nnext\n')
    expect(session.canUndo).toBe(true)
    session.undo()
    expect(session.text).toBe('hello world\n\nnext\n')
    expect(session.canUndo).toBe(false)
    expect(inSync(editor, session)).toBe(true)
    session.redo()
    expect(session.text).toBe('hello你 world\n\nnext\n')
    expect(inSync(editor, session)).toBe(true)
  })

  it('the order of Safari: the end comes first, the last change after it: it can be undone, in one step', async () => {
    const { editor, session } = await begin('hello world\n', 5)
    dom(editor, 0, 'helloni world', 7)
    await tick()
    ended(editor)
    dom(editor, 0, 'hello你 world', 6)
    await tick(80)
    expect(session.text).toBe('hello你 world\n')
    expect(session.canUndo).toBe(true)
    session.undo()
    expect(session.text).toBe('hello world\n')
    expect(session.canUndo).toBe(false)
    expect(inSync(editor, session)).toBe(true)
  })
})

describe('a view without the domObserver of prosemirror-view', () => {
  /**
   * The editor reads the end of a composition through `view.domObserver`, which is not part of the public API, and
   * asks for it once when a composition ends. The view needs it for everything else, so the first read finds none
   * (as it would in a version of prosemirror-view that has the observer under another name) and the others find it.
   */
  function endedWithoutObserver(editor: Setup['editor']): void {
    const view = editor.view as unknown as { domObserver?: unknown }
    const real = view.domObserver
    let hidden = true
    Object.defineProperty(view, 'domObserver', {
      configurable: true,
      get() {
        if (!hidden) return real
        hidden = false
        return undefined
      },
    })
    try {
      ended(editor)
      // it was asked for, and the editor got none
      expect(hidden).toBe(false)
    } finally {
      Object.defineProperty(view, 'domObserver', { configurable: true, writable: true, value: real })
    }
  }

  it('the composition ends without an exception, the screen is the projection, and one warning names prosemirror-view', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const { editor, session } = await begin('hello world\n\nnext\n', 5)
      dom(editor, 0, 'hellon world', 6)
      await tick()
      dom(editor, 0, 'helloni world', 7)
      await tick()
      dom(editor, 0, 'hello你 world', 6)
      expect(() => endedWithoutObserver(editor)).not.toThrow()
      await tick(50)
      expect(inSync(editor, session)).toBe(true)
      expect(warn).toHaveBeenCalledTimes(1)
      expect(String(warn.mock.calls[0]![0])).toContain('prosemirror-view')
      // a second composition in the same editor gives no second warning
      select(editor, posIn(editor, 1, 0))
      composition(editor, 'compositionstart')
      await tick()
      dom(editor, 1, '你next', 1)
      endedWithoutObserver(editor)
      await tick(50)
      expect(inSync(editor, session)).toBe(true)
      expect(warn).toHaveBeenCalledTimes(1)
    } finally {
      warn.mockRestore()
    }
  })

  it('with the observer there is no warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const { editor, session } = await begin('hello world\n', 5)
      dom(editor, 0, 'hello你 world', 6)
      ended(editor)
      await tick(50)
      expect(session.text).toBe('hello你 world\n')
      expect(warn).not.toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })

  it('a composition that deletes the character before a byte order mark does not make it the mark of the file', async () => {
    const { editor, session, rejects } = await begin('x\ufeffy\n', 0)
    // (the text changes elsewhere while it is composed: the late path)
    session.apply([{ from: session.text.length, to: session.text.length, insert: '\nz\n' }])
    dom(editor, 0, '\ufeffy', 0)
    await tick()
    ended(editor)
    await tick(80)
    expect(session.text).toBe('x\ufeffy\n\nz\n')
    expect(rejects.at(-1)?.code).toBe('byte-order-mark')
    expect(inSync(editor, session)).toBe(true)
  })
})

describe('the ranges of the host after a composition that changed the text', () => {
  const marks = (editor: Setup['editor']): string[] =>
    [...editor.view.dom.querySelectorAll<HTMLElement>('.diag')].map((el) => el.textContent ?? '')

  it('a composition before a mark does not move the mark; no second setRanges from the host', async () => {
    const text = 'abc target here\n\nnext\n'
    const from = text.indexOf('target')
    const { editor, session } = await begin(text, 1)
    editor.setRanges([{ from, to: from + 6, message: 'm', severity: 'warning' }])
    dom(editor, 0, 'aпbc target here', 2)
    await tick()
    dom(editor, 0, 'aёbc target here', 2)
    ended(editor)
    await tick(50)
    expect(session.text).toBe('aёbc target here\n\nnext\n')
    // the old ranges are not laid on the new text: no mark on the wrong letters
    expect(marks(editor).filter((m) => m !== 'target')).toEqual([])
    // the host sends the ranges of the new text: the mark is on its word
    const at = session.text.indexOf('target')
    editor.setRanges([{ from: at, to: at + 6, message: 'm', severity: 'warning' }])
    expect(marks(editor)).toEqual(['target'])
  })

  it('a composition that leaves the text as it was keeps the marks', async () => {
    const text = 'abc target here\n\nnext\n'
    const from = text.indexOf('target')
    const { editor, session } = await begin(text, 1)
    editor.setRanges([{ from, to: from + 6, message: 'm', severity: 'warning' }])
    dom(editor, 0, 'aпbc target here', 2)
    await tick()
    dom(editor, 0, 'abc target here', 1)
    ended(editor)
    await tick(50)
    expect(session.text).toBe(text)
    expect(marks(editor)).toEqual(['target'])
  })
})
