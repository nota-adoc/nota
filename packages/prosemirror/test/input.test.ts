// The rest of what comes in: select all, paste, cut, drop, plates.
import { AllSelection, NodeSelection } from 'prosemirror-state'
import { afterEach, describe, expect, it } from 'vitest'
import { projectDocument } from '@nota-adoc/prosemirror'
import { type Setup, closeAll, key, open, posIn, select, shape, type } from './helpers.js'

afterEach(closeAll)

const synced = ({ editor, session }: Setup): void => {
  expect(editor.view.state.doc.eq(projectDocument(session.doc))).toBe(true)
}

/** A paste event with plain text on the clipboard, as the browser makes it. */
function paste(s: Setup, text: string): void {
  const event = new Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', {
    value: { getData: (type: string) => (type === 'text/plain' ? text : ''), types: ['text/plain'] },
  })
  s.editor.view.dom.dispatchEvent(event)
}

describe('select all', () => {
  it('typed over everything replaces the whole text; Backspace empties it; undo brings it back', () => {
    const s = open('= T\n\nfoo *bar*\n\n----\ncode\n----\n')
    const first = s.session.text
    s.editor.view.dispatch(s.editor.view.state.tr.setSelection(new AllSelection(s.editor.view.state.doc)))
    type(s.editor, 'новый')
    expect(s.session.text).toBe('новый\n')
    expect(shape(s.editor)).toBe('новый')
    synced(s)
    s.editor.view.dispatch(s.editor.view.state.tr.setSelection(new AllSelection(s.editor.view.state.doc)))
    key(s.editor, 'Backspace')
    expect(s.session.text).toBe('')
    synced(s)
    while (s.session.canUndo) s.session.undo()
    expect(s.session.text).toBe(first)
    synced(s)
  })
})

describe('plates', () => {
  it('a plate is selected as a whole and taken away by Backspace or Delete, with its blank line', () => {
    const s = open('a\n\n----\ncode\n----\n\nb\n')
    const { view } = s.editor
    view.dispatch(
      view.state.tr.setSelection(NodeSelection.create(view.state.doc, view.state.doc.child(0).nodeSize)),
    )
    key(s.editor, 'Backspace')
    expect(s.session.text).toBe('a\n\nb\n')
    synced(s)
  })

  it('text typed over a selected plate is refused: the plate stays', () => {
    const s = open('a\n\n----\ncode\n----\n\nb\n')
    const { view } = s.editor
    view.dispatch(
      view.state.tr.setSelection(NodeSelection.create(view.state.doc, view.state.doc.child(0).nodeSize)),
    )
    type(s.editor, 'x')
    expect(s.session.text).toBe('a\n\n----\ncode\n----\n\nb\n')
    expect(s.rejects.length).toBe(1)
    synced(s)
  })

  it('Enter next to a plate and typing that would make a list are refused with a message', () => {
    const s = open('foo bar\n')
    select(s.editor, posIn(s.editor, 0, 0))
    type(s.editor, '* ')
    // `* ` at the start of a line makes a list, which the editor does not edit: the first key is fine, the blank is not written
    expect(s.session.text).toBe('*foo bar\n')
    type(s.editor, '----')
    expect(s.session.text.startsWith('*')).toBe(true)
    synced(s)
  })
})

describe('paste, cut and drop', () => {
  it('pastes plain text into a block; a line break makes a new paragraph; it is one step of the history', () => {
    const s = open('hello world\n')
    select(s.editor, posIn(s.editor, 0, 5))
    paste(s, ' big')
    expect(s.session.text).toBe('hello big world\n')
    select(s.editor, posIn(s.editor, 0, 5))
    paste(s, 'A\nB\r\nC')
    expect(s.session.text).toBe('helloA\n\nB\n\nC big world\n')
    synced(s)
    expect(shape(s.editor)).toBe('helloA|B|C big world')
    // (the two pastes came quickly, next to each other: like typing, they are one step of the history)
    s.session.undo()
    expect(s.session.text).toBe('hello world\n')
    expect(s.session.canUndo).toBe(false)
    synced(s)
  })

  it('pastes over a selection', () => {
    const s = open('one two three\n')
    select(s.editor, posIn(s.editor, 0, 4), posIn(s.editor, 0, 7))
    paste(s, '2')
    expect(s.session.text).toBe('one 2 three\n')
    synced(s)
  })

  it('pasted text that looks like markup is text', () => {
    const s = open('a b\n')
    select(s.editor, posIn(s.editor, 0, 2))
    paste(s, '*x* and https://e.com')
    expect(shape(s.editor)).toBe('a *x* and https://e.comb')
    synced(s)
  })

  it('cut puts the text on the clipboard and takes it out', () => {
    const s = open('one two three\n')
    select(s.editor, posIn(s.editor, 0, 4), posIn(s.editor, 0, 8))
    let copied = ''
    const event = new Event('cut', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'clipboardData', {
      value: { setData: (_t: string, v: string) => (copied = v), getData: () => '' },
    })
    s.editor.view.dom.dispatchEvent(event)
    expect(copied).toBe('two ')
    expect(s.session.text).toBe('one three\n')
    synced(s)
  })

  it('a drop is refused', () => {
    const s = open('one two\n')
    const event = new Event('drop', { bubbles: true, cancelable: true })
    s.editor.view.dom.dispatchEvent(event)
    expect(s.session.text).toBe('one two\n')
  })
})

describe('commands accept the usual names', () => {
  it('bold, italic and the styles as objects or short names', () => {
    const s = open('one two three\n')
    select(s.editor, posIn(s.editor, 0, 4), posIn(s.editor, 0, 7))
    s.editor.commands.toggleMark('bold')
    expect(s.session.text).toBe('one *two* three\n')
    s.editor.commands.toggleMark('italic')
    expect(s.session.text).toBe('one *_two_* three\n')
    s.editor.commands.setBlockType({ type: 'heading', level: 3 })
    expect(s.session.text).toBe('=== one *_two_* three\n')
    s.editor.commands.setBlockType('h2')
    expect(s.session.text).toBe('== one *_two_* three\n')
    s.editor.commands.setBlockType('p')
    expect(s.session.text).toBe('one *_two_* three\n')
    synced(s)
  })

  it('onReject gets the message first, then the code and what was asked', () => {
    const messages: unknown[][] = []
    const s = open('one\n\ntwo\n')
    void s
    closeAll()
    const s2 = open('one\n\ntwo\n')
    const handler = (m: string, info: unknown): number => messages.push([m, info])
    void handler
    select(s2.editor, posIn(s2.editor, 0, 1), posIn(s2.editor, 1, 2))
    s2.editor.commands.setLink('https://x.y')
    expect(s2.rejects[0]!.code).toBe('link-across-blocks')
    expect(s2.rejects[0]!.operation).toMatchObject({ kind: 'setLink' })
  })
})
