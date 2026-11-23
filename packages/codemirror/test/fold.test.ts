import { foldedRanges, foldable, foldEffect } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, describe, expect, it } from 'vitest'
import { asciidoc, foldRange } from '@nota-adoc/codemirror'

const views: EditorView[] = []
afterEach(() => {
  for (const v of views.splice(0)) v.destroy()
})
function mount(doc: string, anchor = 0): EditorView {
  const view = new EditorView({ doc, selection: { anchor }, extensions: [asciidoc()], parent: document.body })
  views.push(view)
  ;(view as unknown as { measure(): void }).measure()
  return view
}
const state = (doc: string) => EditorState.create({ doc, extensions: [asciidoc()] })

/** Text of the fold range that starts on the line of `needle`. */
function foldOf(doc: string, needle: string): string | null {
  const s = state(doc)
  const line = s.doc.lineAt(doc.indexOf(needle))
  const r = foldable(s, line.from, line.to)
  return r ? doc.slice(r.from, r.to) : null
}

describe('folding', () => {
  const doc = [
    '= Title', '', 'Intro.', '', '== One', '', 'body one', 'more', '', '=== Deep', '', 'deep body', '', '== Two', '', 'body two', '',
  ].join('\n')

  it('folds a section from the end of its title line to the end of the section, up to a title of the same or a higher level', () => {
    expect(foldOf(doc, '== One')).toBe('\n\nbody one\nmore\n\n=== Deep\n\ndeep body')
    expect(foldOf(doc, '=== Deep')).toBe('\n\ndeep body')
    expect(foldOf(doc, '== Two')).toBe('\n\nbody two')
  })

  it('has no marker on a one-line paragraph, a title without body and the document title', () => {
    expect(foldOf(doc, 'Intro.')).toBeNull()
    expect(foldOf('== Empty\n== Next\n', '== Empty')).toBeNull()
    expect(foldOf(doc, '= Title')).toBeNull()
  })

  it('folds two-line titles from the end of the first line', () => {
    expect(foldOf('Setext\n------\n\ntext\n', 'Setext')).toBe('\n------\n\ntext')
  })

  it('folds the content of a block: both delimiter lines stay visible', () => {
    const src = 'before\n\n----\ncode 1\ncode 2\n----\n\nafter\n'
    expect(foldOf(src, '----')).toBe('\ncode 1\ncode 2')
    // nested blocks fold on their own lines, the outer one hides them
    const nested = '====\nouter\n======\ninner\n======\n====\n'
    expect(foldOf(nested, '====\nouter')).toBe('\nouter\n======\ninner\n======')
    expect(foldOf(nested, '======\ninner')).toBe('\ninner')
    // an empty block and the closing delimiter have no marker
    expect(foldOf('----\n----\n', '----')).toBeNull()
    expect(foldOf(src, 'code 2\n----')).toBeNull()
  })

  it('folds a table by its opening line, and a table in an a cell by its own; the lines of cells have no marker', () => {
    const src = [
      'before', '', '[cols="1,1"]', '|===', '|a |b', 'a|', '!===', '!inner', '!===', '|c', '|===', '', 'after', '',
    ].join('\n')
    expect(foldOf(src, '|===')).toBe('\n|a |b\na|\n!===\n!inner\n!===\n|c')
    expect(foldOf(src, '!===')).toBe('\n!inner')
    expect(foldOf(src, '|a |b')).toBeNull()
    expect(foldOf(src, '|c')).toBeNull()
    // the closing line has no marker; a table that is not closed folds to the end of its container
    expect(foldOf(src, '|===\n\nafter')).toBeNull()
    expect(foldOf('|===\n|a\n|b\n', '|===')).toBe('\n|a\n|b')
    // a table with one row on the delimiter lines folds too, an empty one does not
    expect(foldOf('|===\n|===\n', '|===')).toBeNull()
  })

  it('folds a block comment with ////', () => {
    expect(foldOf('////\nhidden\n////\ntext\n', '////')).toBe('\nhidden')
  })

  it('folds an unclosed block to the end of its container', () => {
    expect(foldOf('----\ncode\nmore\n', '----')).toBe('\ncode\nmore')
    expect(foldOf('====\ntext\n\n----\ncode\n====\nafter\n', '----')).toBe('\ncode')
  })

  it('folds a list of several lines, not a list of one', () => {
    const src = 'para\n\n* one\n** two\n* three\n\nnext\n'
    expect(foldOf(src, '* one')).toBe('\n** two\n* three')
    expect(foldOf(src, '** two')).toBeNull()
    expect(foldOf('* alone\n', '* alone')).toBeNull()
    expect(foldOf('term:: def\nother:: def 2\n', 'term::')).toBe('\nother:: def 2')
  })

  it('folds and unfolds with Mod-Alt-[ and Mod-Alt-] by the cursor, and by the markers on the margin', () => {
    const view = mount(doc, doc.indexOf('body one'))
    const key = (k: string, code: string) =>
      view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: k, code, ctrlKey: true, altKey: true, bubbles: true, cancelable: true }))
    const folded = () => {
      const out: string[] = []
      foldedRanges(view.state).between(0, view.state.doc.length, (f, t) => void out.push(doc.slice(f, t)))
      return out
    }
    key('[', 'BracketLeft')
    expect(folded()).toEqual(['\n\nbody one\nmore\n\n=== Deep\n\ndeep body'])
    key(']', 'BracketRight')
    expect(folded()).toEqual([])
  })

  it('folds and unfolds by a click on the marker on the margin', () => {
    const src = '== One\nbody\nmore\n\n== Two\ntext\n'
    const view = mount(src)
    const folded = () => {
      const out: string[] = []
      foldedRanges(view.state).between(0, view.state.doc.length, (f, t) => void out.push(src.slice(f, t)))
      return out
    }
    const marker = view.dom.querySelector('.cm-foldGutter .cm-gutterElement span')!
    expect(marker).not.toBeNull()
    marker.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(folded()).toEqual(['\nbody\nmore'])
    view.dom.querySelector('.cm-foldGutter .cm-gutterElement span')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(folded()).toEqual([])
  })

  it('exposes the range as foldRange', () => {
    const s = state(doc)
    const line = s.doc.lineAt(doc.indexOf('== Two'))
    expect(foldRange(s, line.from, line.to)).toEqual({ from: line.to, to: doc.indexOf('body two') + 'body two'.length })
    expect(foldEffect).toBeDefined()
  })
})
