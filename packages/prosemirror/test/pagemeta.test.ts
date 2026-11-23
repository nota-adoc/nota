import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createSession } from '@nota-adoc/core'
import { type PageMetaInfo, type VisualEditor, createVisualEditor } from '@nota-adoc/prosemirror'
import { AllSelection, NodeSelection } from 'prosemirror-state'
import { closeAll, key, type } from './helpers.js'

afterEach(closeAll)

const HEAD = '////\ntitle: Sample\nversion: 14\nancestors:\n  - Root\n  - Mid\n////\n:toc:\n\n'
const FILE = HEAD + '= Sample\n:relfilesuffix: .adoc\n\nFirst paragraph.\n\nSecond one.\n'

const told: (PageMetaInfo | null)[] = []
const editors: VisualEditor[] = []

function make(text: string, pageMeta = true) {
  const session = createSession(text)
  const el = document.createElement('div')
  document.body.append(el)
  const editor = createVisualEditor(el, { session, pageMeta, onPageMeta: (i) => told.push(i) })
  editors.push(editor)
  return { editor, session, el }
}

const names = (e: VisualEditor): string[] => {
  const out: string[] = []
  e.view.state.doc.forEach((n) => out.push(n.type.name))
  return out
}

const metaNodes = (e: VisualEditor): number => names(e).filter((n) => n === 'page_meta').length

describe('the header of a page kept out of sight', () => {
  it('has no island for the header and a node without text instead', () => {
    const { editor, el } = make(FILE)
    expect(names(editor)).toEqual(['page_meta', 'heading', 'page_meta', 'paragraph', 'paragraph'])
    expect(el.querySelectorAll('.nota-island')).toHaveLength(0)
    expect(el.querySelector('h1')?.textContent).toBe('Sample')
    expect(editor.pageMeta()?.fields.find((f) => f.key === 'version')?.value).toBe('14')
  })

  it('shows islands as before when the option is off, and for a file without a header', () => {
    expect(make(FILE, false).el.querySelectorAll('.nota-island').length).toBeGreaterThan(0)
    const { el, editor } = make(':toc:\n\n= T\n\nText\n')
    expect(el.querySelectorAll('.nota-island')).toHaveLength(1)
    expect(editor.pageMeta()).toBeNull()
  })

  it('puts the cursor at the title, not in the header', () => {
    const { editor } = make(FILE)
    const sel = editor.view.state.selection
    expect(sel.$head.parent.type.name).toBe('heading')
    expect(sel.$head.parentOffset).toBe(0)
  })

  it('keeps the header when everything is selected and deleted', () => {
    const { editor, session } = make(FILE)
    editor.view.dispatch(editor.view.state.tr.setSelection(new AllSelection(editor.view.state.doc)))
    editor.commands.deleteBackward()
    const text = session.text
    expect(text.startsWith(HEAD)).toBe(true)
    expect(text).toContain(':relfilesuffix: .adoc\n')
    expect(text).not.toContain('First paragraph.')
    expect(text).not.toContain('Second one.')
    expect(editor.pageMeta()).not.toBeNull()
  })

  it('does not change the text when it is only shown', () => {
    const { session, editor } = make(FILE)
    expect(session.text).toBe(FILE)
    editor.editPageMeta()
    editor.collapsePageMeta()
    expect(session.text).toBe(FILE)
  })

  it('opens the header as islands with the cursor on the version, and edits only that line', () => {
    const { editor, session, el } = make(FILE)
    expect(editor.editPageMeta('version')).toBe(true)
    expect(el.querySelectorAll('.nota-island[data-kind="PageMeta"]').length).toBeGreaterThan(0)
    expect(el.querySelectorAll('.nota-island[data-kind="PageMetaTail"]')).toHaveLength(1)
    expect(editor.pageMeta()?.open).toBe(true)
    const head = editor.view.state.selection.$head
    expect(head.parent.type.name).toBe('island')
    expect(head.parent.textBetween(0, head.parentOffset)).toMatch(/version: 14$/)
    editor.view.dispatch(editor.view.state.tr.insertText('5', head.pos - 1, head.pos))
    expect(session.text).toBe(FILE.replace('version: 14', 'version: 15'))
    editor.collapsePageMeta()
    expect(el.querySelectorAll('.nota-island')).toHaveLength(0)
    expect(editor.pageMeta()?.fields.find((f) => f.key === 'version')?.value).toBe('15')
    expect(editor.view.state.selection.$head.parent.type.name).toBe('heading')
  })

  it('tells the host when the header changes outside the editor', () => {
    const { editor, session } = make(FILE)
    told.length = 0
    session.apply([{ from: FILE.indexOf('title: Sample\n'), to: FILE.indexOf('title: Sample\n') + 14, insert: '' }])
    expect(told.at(-1)?.fields.some((f) => f.key === 'title')).toBe(false)
    session.apply([{ from: 0, to: HEAD.length, insert: ':toc:\n\n' }])
    expect(told.at(-1)).toBeNull()
    expect(editor.pageMeta()).toBeNull()
    expect(editor.view.dom.querySelectorAll('.nota-island')).toHaveLength(1)
    session.undo()
    expect(editor.pageMeta()).not.toBeNull()
  })

  it('keeps the cursor out of the header when the text changes under a cursor in it', () => {
    const { editor, session } = make(FILE)
    const at = FILE.indexOf('version: 14')
    editor.setSelectionAtOffset(at + 3)
    expect(editor.view.state.selection.$head.parent.type.name).toBe('heading')
    session.apply([{ from: at, to: at + 11, insert: 'version: 15' }])
    expect(editor.view.state.selection.$head.parent.type.name).toBe('heading')
    session.undo()
    editor.commands.insertBreak()
    expect(session.text.startsWith(HEAD)).toBe(true)
  })

  it('types after Ctrl+Z into the title, never into the hidden lines', () => {
    const { editor, session } = make(FILE)
    const at = FILE.indexOf('version: 14')
    editor.setSelectionAtOffset(at + 5)
    session.apply([{ from: at + 9, to: at + 11, insert: '15' }])
    session.undo()
    expect(session.text).toBe(FILE)
    const pos = editor.view.state.selection.from
    editor.view.dispatch(editor.view.state.tr.insertText('Z', pos))
    expect(session.text).toBe(FILE.replace('= Sample\n', '= ZSample\n'))
  })

  const selectAll = (editor: VisualEditor) =>
    editor.view.dispatch(editor.view.state.tr.setSelection(new AllSelection(editor.view.state.doc)))

  const paste = (editor: VisualEditor, text: string) => {
    const event = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'clipboardData', {
      value: { getData: (t: string) => (t === 'text/plain' ? text : ''), types: ['text/plain'], files: { length: 0 } },
    })
    editor.view.dom.dispatchEvent(event)
  }

  const WHOLE = HEAD + ':relfilesuffix: .adoc\n'

  it('keeps the header with Delete over a selection', () => {
    const { editor, session } = make(FILE)
    selectAll(editor)
    editor.commands.deleteForward()
    expect(session.text.startsWith(HEAD)).toBe(true)
    expect(session.text).toContain(':relfilesuffix: .adoc\n')
  })

  it('types over everything (the real path): the letter goes right after the header, the header is whole', () => {
    const { editor, session } = make(FILE)
    selectAll(editor)
    type(editor, 'x')
    expect(session.text).toBe(WHOLE + '\nx\n\n')
    expect(editor.pageMeta()?.open).toBe(false)
    expect(metaNodes(editor)).toBe(1)
  })

  it('pastes over everything: lines go right after the header as paragraphs, the header is whole', () => {
    const { editor, session, el } = make(FILE)
    selectAll(editor)
    paste(editor, 'pasted\nmore')
    expect(session.text).toBe(WHOLE + '\npasted\n\nmore\n\n')
    expect(editor.pageMeta()?.open).toBe(false)
    expect(metaNodes(editor)).toBe(1)
    expect(el.querySelectorAll('.nota-island')).toHaveLength(0)
  })

  it('does not let markup typed or pasted over everything out (escaped, header whole, no islands)', () => {
    for (const text of ['*a*', 'NOTE: x', '////', 'include::x.adoc[]', 'a\n////\nb']) {
      for (const how of ['type', 'paste'] as const) {
        const { editor, session, el } = make(FILE)
        selectAll(editor)
        if (how === 'paste') paste(editor, text)
        else type(editor, text[0]!)
        // (a text that cannot be written as a paragraph is refused: the file stays as it was)
        if (session.text === FILE) {
          expect(['NOTE: x', '////', 'include::x.adoc[]', 'a\n////\nb']).toContain(text)
          continue
        }
        expect(session.text.startsWith(WHOLE + '\n'), `${how} ${text}`).toBe(true)
        expect(metaNodes(editor), `${how} ${text}`).toBe(1)
        expect(el.querySelectorAll('.nota-island'), `${how} ${text}`).toHaveLength(0)
        const front = session.text.slice(WHOLE.length)
        expect(front, `${how} ${text}`).not.toMatch(/^(?:\/\/\/\/|NOTE:|include::)/m)
        expect(front.replace(/\\/g, ''), `${how} ${text}`).toContain(how === 'paste' ? text.split('\n')[0]! : text[0]!)
      }
    }
  })

  it('does not join the title into the header with Backspace', () => {
    const { editor, session } = make(FILE)
    editor.commands.deleteBackward()
    expect(session.text).toBe(FILE)
  })
})

const fixture = (name: string) => readFileSync(join(process.cwd(), 'quality/fixtures/editor', `${name}.adoc`), 'utf8')
const BODY = fixture('page-meta-body')
const BODY_HEAD = BODY.slice(0, BODY.indexOf('The first paragraph'))

describe('the zone after the link', () => {
  it('shows no island, a narrow line for toc::[] and the text', () => {
    const { editor, el, session } = make(BODY)
    expect(names(editor)).toEqual(['page_meta', 'heading', 'paragraph', 'page_meta', 'toc_pinned', 'paragraph'])
    expect(el.querySelectorAll('.nota-island')).toHaveLength(0)
    expect(el.querySelector('.nota-toc .toc-label')?.textContent).toBe('Table of contents')
    expect(el.querySelector('.nota-toc')?.getAttribute('aria-label')).toBe('Table of contents')
    expect(el.querySelector('h1')?.textContent).toBe('Sample page')
    expect(el.textContent).toContain('Open in Confluence')
    expect(session.text).toBe(BODY)
  })

  it('has no narrow line without toc::[]', () => {
    const { editor, el } = make(fixture('page-meta-body-no-toc'))
    expect(names(editor)).toEqual(['page_meta', 'heading', 'paragraph', 'page_meta', 'paragraph'])
    expect(el.querySelectorAll('.nota-toc')).toHaveLength(0)
  })

  it('reports the hidden attributes in the order of the file', () => {
    const { editor } = make(BODY)
    expect(editor.pageMeta()?.attributes).toEqual([
      { name: 'doctype', value: 'book' },
      { name: 'toc', value: '' },
      { name: 'source-highlighter', value: 'highlight.js' },
      { name: 'relfilesuffix', value: '.adoc' },
    ])
  })

  it('leaves an attribute after the first text as an island', () => {
    const { el } = make(BODY + '\n:imagesdir: x\n')
    expect(el.querySelectorAll('.nota-island')).toHaveLength(1)
  })

  it('shows a toc::[] without a header as a narrow line that is not pinned', () => {
    const { editor, el } = make(':doctype: book\n\n= T\n\nText\n\ntoc::[]\n\nMore\n')
    expect(el.querySelectorAll('.nota-island')).toHaveLength(1)
    expect(el.querySelectorAll('.nota-toc')).toHaveLength(1)
    expect(names(editor)).toContain('toc')
    expect(editor.pageMeta()).toBeNull()
  })

  it('does not select the pinned line, and deletes the one outside the zone with its line only', () => {
    const { editor, session } = make(BODY + '\ntoc::[]\n\nTail.\n')
    const doc = editor.view.state.doc
    const pinned = doc.child(0).nodeSize + doc.child(1).nodeSize + doc.child(2).nodeSize + doc.child(3).nodeSize
    expect(doc.nodeAt(pinned)!.type.name).toBe('toc_pinned')
    expect(NodeSelection.isSelectable(doc.nodeAt(pinned)!)).toBe(false)
    let free = -1
    doc.forEach((n, off) => {
      if (n.type.name === 'toc') free = off
    })
    expect(free).toBeGreaterThan(pinned)
    editor.view.dispatch(editor.view.state.tr.setSelection(NodeSelection.create(editor.view.state.doc, free)))
    editor.commands.deleteBackward()
    expect(session.text).toBe(BODY + '\n\nTail.\n')
    expect(names(editor).filter((n) => n === 'toc_pinned')).toHaveLength(1)
  })

  it('keeps the header, the attributes and toc::[] with Ctrl+A and Delete', () => {
    const { editor, session } = make(BODY)
    editor.view.dispatch(editor.view.state.tr.setSelection(new AllSelection(editor.view.state.doc)))
    editor.commands.deleteForward()
    expect(session.text).toContain(BODY_HEAD.slice(0, BODY_HEAD.indexOf('= Sample page')))
    expect(session.text).toContain(':toc:\n:source-highlighter: highlight.js\n\n:relfilesuffix: .adoc\n')
    expect(session.text).toContain('toc::[]\n')
    expect(session.text).not.toContain('Sample page\n\nlink')
    expect(session.text).not.toContain('Open in Confluence')
    expect(session.text).not.toContain('first paragraph')
    expect(names(editor)).toContain('toc_pinned')
    expect(editor.pageMeta()).not.toBeNull()
  })

  it('writes a letter typed over Ctrl+A after toc::[]', () => {
    const { editor, session } = make(BODY)
    editor.view.dispatch(editor.view.state.tr.setSelection(new AllSelection(editor.view.state.doc)))
    type(editor, 'Q')
    const at = session.text.indexOf('Q')
    expect(at).toBeGreaterThan(session.text.indexOf('toc::[]'))
    expect(session.text.slice(0, at)).toContain(':relfilesuffix: .adoc\n')
    expect(session.text.startsWith(BODY.slice(0, BODY.indexOf('= Sample page')))).toBe(true)
    expect(session.text).toContain('toc::[]\n\nQ\n')
    expect(session.text).not.toContain('Open in Confluence')
  })

  it('puts the paragraph of Enter after the hidden attributes and before toc::[], and Ctrl+Z undoes it', () => {
    const { editor, session, el } = make(BODY)
    const end = BODY.indexOf('Open in Confluence]') + 'Open in Confluence'.length
    editor.setSelectionAtOffset(end)
    key(editor, 'Enter')
    type(editor, 'x')
    const t = session.text
    expect(t.indexOf('x\n')).toBeGreaterThan(t.indexOf(':relfilesuffix: .adoc\n'))
    expect(t.indexOf('x\n')).toBeLessThan(t.indexOf('toc::[]'))
    expect(t).toContain('[Open in Confluence]\n\n:toc:')
    expect(el.querySelectorAll('.nota-island')).toHaveLength(0)
    expect(editor.pageMeta()?.attributes).toHaveLength(4)
    expect(names(editor)).toEqual(['page_meta', 'heading', 'paragraph', 'page_meta', 'paragraph', 'toc', 'paragraph'])
    session.undo()
    session.undo()
    expect(session.text).toBe(BODY)
  })

  it('puts the paragraph of Enter before the text without toc::[]', () => {
    const text = fixture('page-meta-body-no-toc')
    const { editor, session } = make(text)
    editor.setSelectionAtOffset(text.indexOf('Open in Confluence]') + 18)
    key(editor, 'Enter')
    type(editor, 'x')
    expect(session.text.indexOf('x\n')).toBeGreaterThan(session.text.indexOf(':relfilesuffix: .adoc\n'))
    expect(session.text.indexOf('x\n')).toBeLessThan(session.text.indexOf('The first'))
    expect(editor.pageMeta()?.attributes).toHaveLength(4)
  })

  it('opens the whole zone as islands, edits one line, and closes', () => {
    const { editor, session, el } = make(BODY)
    expect(editor.editPageMeta('version')).toBe(true)
    expect(el.querySelectorAll('.nota-island[data-kind="PageMeta"]').length).toBeGreaterThan(0)
    expect(el.querySelectorAll('.nota-island[data-kind="PageMetaBody"]')).toHaveLength(2)
    expect(el.querySelectorAll('.nota-toc')).toHaveLength(1)
    expect(el.querySelector('.nota-island[data-kind="PageMetaBody"] .island-note span')?.textContent).toBe('Page header, after the link')
    const at = session.text.indexOf('highlight.js')
    editor.setSelectionAtOffset(at)
    const pos = editor.view.state.selection.from
    editor.view.dispatch(editor.view.state.tr.insertText('rouge', pos, pos + 'highlight.js'.length))
    editor.collapsePageMeta()
    expect(session.text).toBe(BODY.replace('highlight.js', 'rouge'))
    expect(el.querySelectorAll('.nota-island')).toHaveLength(0)
    expect(editor.pageMeta()?.attributes.find((a) => a.name === 'source-highlighter')?.value).toBe('rouge')
  })

  it('puts the cursor of the zone at the start of the link paragraph', () => {
    const { editor } = make(BODY)
    editor.setSelectionAtOffset(BODY.indexOf('highlight.js'))
    const $f = editor.view.state.selection.$from
    expect($f.parent.textContent).toBe('Open in Confluence')
    expect($f.parentOffset).toBe(0)
  })

  it('puts the paragraph of Enter after the attributes when toc::[] follows the link directly', () => {
    const text = BODY.replace('\n:toc:\n:source-highlighter: highlight.js\n\n:relfilesuffix: .adoc\n\ntoc::[]\n', '\ntoc::[]\n\n:toc:\n:source-highlighter: highlight.js\n')
    expect(text).not.toBe(BODY)
    const { editor, session } = make(text)
    editor.setSelectionAtOffset(text.indexOf('Open in Confluence]') + 'Open in Confluence'.length)
    key(editor, 'Enter')
    type(editor, 'x')
    const t = session.text
    expect(t.indexOf('x\n')).toBeGreaterThan(t.indexOf(':source-highlighter: highlight.js\n'))
    expect(t.indexOf('x\n')).toBeLessThan(t.indexOf('The first'))
    expect(editor.pageMeta()?.attributes.length).toBeGreaterThan(0)
    expect(editor.view.dom.querySelectorAll('.nota-island')).toHaveLength(0)
  })
})
