// what happens in the editor when the text changes under it.
import { afterEach, describe, expect, it } from 'vitest'
import { createSourceEditor } from '@nota-adoc/codemirror'
import { createVisualEditor, projectDocument } from '@nota-adoc/prosemirror'
import { closeAll, key, open, posIn, select, shape, textOf, type } from './helpers.js'

afterEach(closeAll)

describe('changes of the text under the editor', () => {
  it('rebuilds only the block that changed: the nodes of the other blocks are the same objects', () => {
    const { editor, session } = open('= T\n\nfirst\n\nsecond *b*\n\n* list\n\nlast\n')
    const before = [...Array(editor.view.state.doc.childCount).keys()].map((i) =>
      editor.view.state.doc.child(i),
    )
    const at = session.text.indexOf('second') + 2
    session.apply([{ from: at, insert: 'XX' }])
    const doc = editor.view.state.doc
    expect(doc.childCount).toBe(before.length)
    expect(doc.child(2)).not.toBe(before[2])
    for (const i of [0, 1, 3, 4]) expect(doc.child(i)).toBe(before[i])
    expect(textOf(editor, 2)).toBe('seXXcond b')
    expect(doc.eq(projectDocument(session.doc))).toBe(true)
  })

  it('the same for an edit in a source editor on the same session', () => {
    const { editor, session, el } = open('one\n\ntwo\n\nthree\n')
    const host = document.createElement('div')
    el.after(host)
    const source = createSourceEditor(host, { session })
    const before = [0, 1, 2].map((i) => editor.view.state.doc.child(i))
    source.view.dispatch({ changes: { from: session.text.indexOf('two') + 1, insert: '_' } })
    const doc = editor.view.state.doc
    expect(doc.child(0)).toBe(before[0])
    expect(doc.child(2)).toBe(before[2])
    expect(textOf(editor, 1)).toBe('t_wo')
    expect(doc.eq(projectDocument(session.doc))).toBe(true)
    source.destroy()
  })

  it('a plate whose text is the same but that is now another kind of block is rebuilt', () => {
    const { editor, session } = open('term::\n\n[literal]')
    session.apply([{ from: 0, to: 5, insert: 'x' }])
    expect(editor.view.state.doc.eq(projectDocument(session.doc))).toBe(true)
  })

  it('the cursor outside the changed place stays on the same text', () => {
    const { editor, session } = open('one two\n\nthree four\n\nfive\n')
    select(editor, posIn(editor, 2, 2))
    session.apply([{ from: 0, insert: 'START ' }])
    const pos = editor.view.state.selection.from
    expect(editor.view.state.doc.textBetween(pos - 2, pos + 2)).toBe('five')
    select(editor, posIn(editor, 1, 3))
    session.apply([{ from: session.text.indexOf('five'), insert: '>> ' }])
    expect(
      editor.view.state.doc.textBetween(
        editor.view.state.selection.from - 3,
        editor.view.state.selection.from,
      ),
    ).toBe('thr')
  })

  it('an edit that changes the reading below (an unclosed ----) rebuilds the blocks it reaches, and the screen is the projection', () => {
    const { editor, session } = open('a\n\nb\n\nc\n\nd\n')
    session.apply([{ from: session.text.indexOf('b'), insert: '----\n' }])
    expect(shape(editor)).toBe('a|[chip]')
    expect(editor.view.state.doc.eq(projectDocument(session.doc))).toBe(true)
    // and back
    session.undo()
    expect(shape(editor)).toBe('a|b|c|d')
    expect(editor.view.state.doc.eq(projectDocument(session.doc))).toBe(true)
  })

  it('a change of an entry that changes how a block below is read gives the block as it reads now', () => {
    const { editor, session } = open(':experimental:\n\nPress kbd:[Ctrl+S] now\n')
    expect(shape(editor)).toBe('[chip]|Press ⟦chip⟧ now')
    session.apply([{ from: 1, to: 13, insert: 'x-other' }])
    expect(shape(editor)).toBe('[chip]|Press kbd:[Ctrl+S] now')
    expect(editor.view.state.doc.eq(projectDocument(session.doc))).toBe(true)
  })

  it('a text that a change makes empty, and one that it brings back', () => {
    const { editor, session } = open('hello\n')
    session.apply([{ from: 0, to: session.text.length }])
    expect(shape(editor)).toBe('')
    expect(editor.view.state.doc.childCount).toBe(1)
    session.undo()
    expect(shape(editor)).toBe('hello')
  })

  it('two visual editors on one session show the same and edit each other', () => {
    const a = open('shared text\n')
    const el = document.createElement('div')
    document.body.append(el)
    const other = createVisualEditor(el, { session: a.session })
    try {
      select(a.editor, posIn(a.editor, 0, 0), posIn(a.editor, 0, 6))
      a.editor.commands.toggleMark('strong')
      expect(a.session.text).toBe('*shared* text\n')
      expect(other.view.state.doc.eq(a.editor.view.state.doc)).toBe(true)
      expect(shape(other)).toBe('<strong>shared</> text')
      select(other, posIn(other, 0, 11))
      type(other, '!')
      expect(a.session.text).toBe('*shared* text!\n')
      expect(textOf(a.editor, 0)).toBe('shared text!')
      expect(a.editor.view.state.doc.eq(projectDocument(a.session.doc))).toBe(true)
    } finally {
      other.destroy()
    }
  })
})

describe('an inline {set:…} decides how the blocks below are read', () => {
  const synced = (s: ReturnType<typeof open>): void =>
    expect(s.editor.view.state.doc.eq(projectDocument(s.session.doc))).toBe(true)

  it('Backspace after a {set:experimental:} plate turns the kbd: plate below into text, and Mod-Z brings both back', () => {
    const s = open('a {set:experimental:}\n\nkbd:[Ctrl] b\n')
    expect(shape(s.editor)).toBe('a ⟦chip⟧|⟦chip⟧ b')
    select(s.editor, posIn(s.editor, 0, 3))
    key(s.editor, 'Backspace')
    expect(s.session.text).toBe('a \n\nkbd:[Ctrl] b\n')
    expect(shape(s.editor)).toBe('a |kbd:[Ctrl] b')
    synced(s)
    key(s.editor, 'z', { mod: true })
    expect(s.session.text).toBe('a {set:experimental:}\n\nkbd:[Ctrl] b\n')
    expect(shape(s.editor)).toBe('a ⟦chip⟧|⟦chip⟧ b')
    synced(s)
  })

  it('the same when {set:experimental!} unsets an entry: the kbd: plate below appears', () => {
    const s = open(':experimental:\n\na {set:experimental!}\n\nkbd:[Ctrl] b\n')
    expect(shape(s.editor)).toBe('[chip]|a ⟦chip⟧|kbd:[Ctrl] b')
    select(s.editor, posIn(s.editor, 1, 3))
    key(s.editor, 'Backspace')
    expect(s.session.text).toBe(':experimental:\n\na \n\nkbd:[Ctrl] b\n')
    expect(shape(s.editor)).toBe('[chip]|a |⟦chip⟧ b')
    synced(s)
  })

  it('the same for {counter:…}: a counter that is taken out changes the numbers below', () => {
    const s = open('a {counter:n}\n\nb {counter:n}\n')
    select(s.editor, posIn(s.editor, 0, 2), posIn(s.editor, 0, 3))
    key(s.editor, 'Backspace')
    synced(s)
    expect(s.session.text.startsWith('a ')).toBe(true)
  })
})

describe('text typed over several blocks next to a header made of plates (fuzz seed 34)', () => {
  it('a keystroke that would make the first block part of a plate is refused, and the next one does not land in another block', () => {
    const { editor, session, rejects } = open(
      '= NOTE: he body\n:toc: macro\n:toc-title: Contents\n:sectnums:\n\nIntro before.\n\ntoc::[]\n\n== One\n\nne\n',
    )
    // edits of the source: the header gets a line that is no entry, and its last entry loses its colon
    session.apply([{ from: 16, to: 27, insert: ':ifdef::a[]\ncro' }], { origin: 'source' })
    const at = session.text.indexOf(':sectnums:')
    session.apply([{ from: at, to: at + 1, insert: '' }], { origin: 'source' })
    expect(editor.view.state.doc.eq(projectDocument(session.doc))).toBe(true)
    const seen: { from: number; to: number }[] = []
    session.subscribe((e) => seen.push(...e.changes.map((c) => ({ from: c.from, to: c.to ?? c.from }))))
    const before = session.text
    // the end of "sectnums:" to the end of "Intro before."
    select(editor, posIn(editor, 2, 'sectnums:'.length), posIn(editor, 3, 'Intro before.'.length))
    type(editor, '::')
    // the paragraph would be read as part of the header: the text is not typed, nothing else is touched
    expect(rejects.map((r) => r.code)).toEqual(['becomes-plate', 'becomes-plate'])
    expect(session.text).toBe(before)
    expect(seen).toEqual([])
    expect(editor.view.state.doc.eq(projectDocument(session.doc))).toBe(true)
  })
})
