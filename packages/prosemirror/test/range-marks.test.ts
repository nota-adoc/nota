// the marks of remarks are changed by the difference of the ranges; what is on the screen is what a full build would give.
import { afterEach, describe, expect, it } from 'vitest'
import { DecorationSet } from 'prosemirror-view'
import type { VisualEditor } from '@nota-adoc/prosemirror'
import { closeAll, composition, open, select, type } from './helpers.js'

afterEach(closeAll)

/** A document with remarks in paragraphs, a list, a table and a plate: `<<Nope N>>` refers to nothing. */
function make(n: number): string {
  const out: string[] = ['= Doc', '']
  for (let i = 0; i < n; i++) {
    out.push(`Paragraph ${i} with <<Nope ${i}>> and more text *bold* here.`, '')
    if (i % 5 === 0) out.push(`* item <<Gone ${i}>>`, '* second', '')
    if (i % 7 === 0) out.push('|===', `|cell <<Cell ${i}>>|b`, '|c|d', '|===', '')
    if (i % 9 === 0) out.push('----', `code ${i}`, '----', '')
  }
  return out.join('\n')
}

/** The ranges as the page makes them from the remarks of the document. */
function rangesOf(s: {
  doc: { diagnostics: readonly { from: number; to: number; severity: string; message: string }[] }
}) {
  return s.doc.diagnostics
    .filter((d) => d.severity !== 'info')
    .map((d) => ({ from: d.from, to: d.to, message: d.message, severity: d.severity as 'warning' | 'error' }))
}

/** What is marked: the decorations of the set, and the marked stretches of the screen. */
function seen(editor: VisualEditor): string[] {
  const dom = [...editor.view.dom.querySelectorAll<HTMLElement>('.diag')].map(
    (el) => `${el.tagName}|${el.className}|${el.title}|${el.dataset.severity ?? ''}|${el.textContent}`,
  )
  return dom
}

function decorations(editor: VisualEditor): string[] {
  // the plugin that keeps the marks is the one with the `diag` decorations
  const sets = editor.view.state.plugins
    .map((p) => p.getState(editor.view.state))
    .filter((v): v is DecorationSet => v instanceof DecorationSet)
  const out: string[] = []
  for (const set of sets)
    for (const d of set.find()) {
      const attrs = (d as unknown as { type: { attrs?: Record<string, string> } }).type.attrs
      if (attrs?.class === 'diag')
        out.push(`${d.from}-${d.to}|${attrs.title}|${attrs['data-severity'] ?? ''}`)
    }
  return out.sort()
}

/** Marks that a fresh editor gives for the same text: all of them built at once. */
function full(text: string): { dom: string[]; set: string[]; count: number } {
  const { editor, session } = open(text)
  editor.setRanges(rangesOf(session))
  const r = { dom: seen(editor), set: decorations(editor), count: rangesOf(session).length }
  return r
}

function same(editor: VisualEditor, text: string): void {
  const f = full(text)
  expect(f.count).toBeGreaterThan(0)
  expect(seen(editor)).toEqual(f.dom)
  expect(decorations(editor)).toEqual(f.set)
}

describe('marks of remarks, changed by the difference', () => {
  it('after typing in several places the marks are the ones of a full build', () => {
    const { editor, session } = open(make(40))
    editor.setRanges(rangesOf(session))
    const before = decorations(editor).length
    expect(before).toBeGreaterThan(40)
    const words = ['Paragraph 3 ', 'Paragraph 20 ', 'Paragraph 33 ', 'Paragraph 1 ']
    for (const w of words) {
      const text = session.text
      const at = text.indexOf(w) + w.length
      editor.setSelectionAtOffset(at)
      type(editor, 'xyz ')
      // the page does this a frame later
      editor.setRanges(rangesOf(session))
      same(editor, session.text)
    }
  })

  it('typing in the very words that are marked, and deleting them', () => {
    const { editor, session } = open(make(12))
    editor.setRanges(rangesOf(session))
    const at = session.text.indexOf('<<Nope 4>>') + 4
    editor.setSelectionAtOffset(at)
    type(editor, 'Q')
    editor.setRanges(rangesOf(session))
    same(editor, session.text)
    editor.view.dispatch(
      editor.view.state.tr.delete(editor.view.state.selection.from - 1, editor.view.state.selection.from),
    )
    editor.setRanges(rangesOf(session))
    same(editor, session.text)
  })

  it('an edit that adds and one that removes a remark', () => {
    const { editor, session } = open(make(10))
    editor.setRanges(rangesOf(session))
    const n = rangesOf(session).length
    // a new unresolved reference
    const at = session.text.indexOf('Paragraph 6 ') + 12
    session.apply([{ from: at, to: at, insert: '<<Fresh>> ' }])
    editor.setRanges(rangesOf(session))
    expect(rangesOf(session).length).toBe(n + 1)
    same(editor, session.text)
    // one is made to resolve: the anchor of the first heading
    session.apply([
      {
        from: session.text.indexOf('<<Nope 2>>'),
        to: session.text.indexOf('<<Nope 2>>') + 10,
        insert: 'plain',
      },
    ])
    editor.setRanges(rangesOf(session))
    expect(rangesOf(session).length).toBe(n)
    same(editor, session.text)
  })

  it('a change of the message or of the severity changes the mark', () => {
    const { editor, session } = open(make(3))
    const from = session.text.indexOf('Paragraph 1')
    editor.setRanges([{ from, to: from + 9, message: 'one', severity: 'warning' }])
    expect(seen(editor)[0]).toContain('|one|warning|')
    editor.setRanges([{ from, to: from + 9, message: 'two', severity: 'error' }])
    expect(seen(editor)).toHaveLength(1)
    expect(seen(editor)[0]).toContain('|two|error|')
    editor.setRanges([{ from, to: from + 9, message: 'two' }])
    expect(seen(editor)[0]).toContain('|two||')
  })

  it('the same ranges again do not touch the screen', () => {
    const { editor, session } = open(make(6))
    const ranges = rangesOf(session)
    editor.setRanges(ranges)
    const marked = editor.view.dom.querySelector('.diag')!
    const state = editor.view.state
    editor.setRanges(rangesOf(session))
    // no transaction was made, the marked element is the same one
    expect(editor.view.state).toBe(state)
    expect(editor.view.dom.querySelector('.diag')).toBe(marked)
  })

  it('two ranges on one place are two marks and one of them can go', () => {
    const { editor, session } = open(make(3))
    const from = session.text.indexOf('Paragraph 1')
    const r = { from, to: from + 9, message: 'm', severity: 'warning' as const }
    editor.setRanges([r, r])
    expect(decorations(editor)).toHaveLength(2)
    editor.setRanges([r])
    expect(decorations(editor)).toHaveLength(1)
    editor.setRanges([])
    expect(decorations(editor)).toHaveLength(0)
    expect(editor.view.dom.querySelector('.diag')).toBeNull()
  })

  it('plates and tables are marked as a whole and stay so after typing above them', () => {
    const { editor, session } = open(make(10))
    editor.setRanges(rangesOf(session))
    const plate = session.text.indexOf('----')
    const ranges = [
      ...rangesOf(session),
      { from: plate, to: plate + 4, message: 'Плашка', severity: 'warning' as const },
    ]
    editor.setRanges(ranges)
    expect(editor.view.dom.querySelectorAll('.nota-code.diag').length).toBeGreaterThan(0)
    select(editor, 1)
    editor.setSelectionAtOffset(session.text.indexOf('Paragraph 0 ') + 12)
    type(editor, 'zz')
    // (the ranges of the page are made again from the text; the extra one moved with the plate)
    const moved = session.text.indexOf('----')
    editor.setRanges([
      ...rangesOf(session),
      { from: moved, to: moved + 4, message: 'Плашка', severity: 'warning' },
    ])
    expect(editor.view.dom.querySelectorAll('.nota-code.diag').length).toBeGreaterThan(0)
    expect(decorations(editor).length).toBe(rangesOf(session).length + 1)
  })

  it('the marks of a remark are not lost when the text is replaced from outside', () => {
    const { editor, session } = open(make(8))
    editor.setRanges(rangesOf(session))
    session.apply([{ from: 0, to: 0, insert: 'Intro.\n\n' }])
    editor.setRanges(rangesOf(session))
    same(editor, session.text)
  })
})

describe('marks of remarks on one plate', () => {
  it('several remarks on one table: after a change of one of them the title is the one of a full build', () => {
    const text = ['|===', '|a <<One>>|<<Two>>', '|c|d', '|===', ''].join('\n')
    const { editor, session } = open(text)
    const all = [
      { from: 0, to: 4, message: 'first', severity: 'warning' as const },
      { from: 0, to: 4, message: 'second', severity: 'warning' as const },
    ]
    editor.setRanges(all)
    editor.setRanges([all[0]!, { ...all[1]!, message: 'second changed' }])
    const f = open(session.text)
    f.editor.setRanges([all[0]!, { ...all[1]!, message: 'second changed' }])
    expect(seen(editor)).toEqual(seen(f.editor))
    expect(decorations(editor)).toEqual(decorations(f.editor))
    editor.setRanges([{ ...all[1]!, message: 'second changed' }, all[0]!])
    f.editor.setRanges([{ ...all[1]!, message: 'second changed' }, all[0]!])
    expect(seen(editor)).toEqual(seen(f.editor))
  })
})

// the end of a composition puts the screen back on the text it began with; the marks must survive when it returns early
describe('marks of remarks, when a composition ends', () => {
  const text = [
    '= Doc',
    '',
    'First <<Nope 1>> here.',
    '',
    'Second <<Nope 2>> here.',
    '',
    '|===',
    '|one <<Cell 1>>|two',
    '|three|four',
    '|===',
    '',
  ].join('\n')

  type Tx = (tr: import('prosemirror-state').Transaction, doc: import('prosemirror-model').Node) => void

  function endWith(change: Tx): void {
    const { editor, session } = open(text)
    editor.setRanges(rangesOf(session))
    const before = { dom: seen(editor), set: decorations(editor) }
    expect(before.dom.length).toBeGreaterThanOrEqual(2)
    const view = editor.view
    const base = view.state.doc
    composition(editor, 'compositionstart')
    const tr = view.state.tr
    change(tr, base)
    view.updateState(view.state.apply(tr))
    composition(editor, 'compositionend')
    expect(view.state.doc.eq(base)).toBe(true)
    expect(seen(editor)).toEqual(before.dom)
    expect(decorations(editor)).toEqual(before.set)
  }

  // the first text position of the paragraph `i` of the document
  const at = (doc: import('prosemirror-model').Node, i: number): number => {
    let pos = 0
    doc.forEach((_n, off, k) => {
      if (k === i) pos = off + 1
    })
    return pos
  }

  it('two paragraphs changed (no single block to make an edit of): the marks stay', () => {
    endWith((tr, doc) => {
      tr.insertText('X', at(doc, 1) + 1)
      tr.insertText('Y', at(doc, 2) + 1)
    })
  })

  it('a block that became another type (no difference of text): the marks stay', () => {
    endWith((tr, doc) => {
      const pos = at(doc, 1) - 1
      tr.setNodeMarkup(pos, doc.type.schema.nodes.heading, { level: 2 })
    })
  })

  it('two cells of a table changed (the table does not differ in one place): the marks stay', () => {
    endWith((tr, doc) => {
      const table = at(doc, 3)
      let n = 0
      doc.nodesBetween(table, table + doc.child(3).nodeSize - 1, (node, pos) => {
        if (node.type.name === 'paragraph' || node.isTextblock) {
          if (n++ < 2) tr.insertText('Z', tr.mapping.map(pos + 1))
          return false
        }
        return true
      })
      expect(n).toBeGreaterThan(1)
    })
  })

  // the text is changed from outside while the composition is on; the host sends the ranges at once and not again
  function endAfterOutside(change: Tx, outside: string, late = false): void {
    const { editor, session } = open(text)
    editor.setRanges(rangesOf(session))
    const view = editor.view
    composition(editor, 'compositionstart')
    session.apply([{ from: text.indexOf('Second'), to: text.indexOf('Second'), insert: outside }])
    editor.setRanges(rangesOf(session))
    const tr = view.state.tr
    change(tr, view.state.doc)
    view.updateState(view.state.apply(tr))
    composition(editor, 'compositionend')
    // (a late composed text is a change of the session: the host sends the ranges of the new text, as it does for any;
    // until then the old ranges are not laid on it)
    if (late) {
      expect(seen(editor)).toEqual([])
      editor.setRanges(rangesOf(session))
    }
    same(editor, session.text)
  }

  it('text changed outside, two paragraphs changed: the marks are on the screen after the end', () => {
    endAfterOutside((tr, doc) => {
      tr.insertText('X', at(doc, 1) + 1)
      tr.insertText('Y', at(doc, 2) + 1)
    }, 'Added <<Fresh>> ')
  })

  it('text changed outside, a block became another type: the marks are on the screen after the end', () => {
    endAfterOutside((tr, doc) => {
      tr.setNodeMarkup(at(doc, 1) - 1, doc.type.schema.nodes.heading, { level: 2 })
    }, 'Added <<Fresh>> ')
  })

  it('text changed outside, two cells changed: the marks are on the screen after the end', () => {
    endAfterOutside((tr, doc) => {
      const table = at(doc, 3)
      let n = 0
      doc.nodesBetween(table, table + doc.child(3).nodeSize - 1, (node, pos) => {
        if (node.isTextblock) {
          if (n++ < 2) tr.insertText('Z', tr.mapping.map(pos + 1))
          return false
        }
        return true
      })
    }, 'Added <<Fresh>> ')
  })

  it('text changed outside, one block typed in (late composed text): the marks are on the screen after the end', () => {
    endAfterOutside(
      (tr, doc) => {
        tr.insertText('X', at(doc, 1) + 1)
      },
      'Added <<Fresh>> ',
      true,
    )
  })
})
