import { type Completion, CompletionContext, type CompletionResult, completionStatus, currentCompletions } from '@codemirror/autocomplete'
import { EditorSelection, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_ATTRIBUTES, type ParseOptions } from '@nota-adoc/core'
import { type AsciidocConfig, type XrefTargets, asciidoc } from '@nota-adoc/codemirror'

const views: EditorView[] = []
afterEach(() => {
  for (const v of views.splice(0)) v.destroy()
  vi.restoreAllMocks()
})

/** Runs the completion sources of the state at the cursor marked `|` in the text; the text without the mark and the position. */
async function complete(marked: string, config: AsciidocConfig = {}, mark = '|') {
  const pos = marked.indexOf(mark)
  const doc = marked.slice(0, pos) + marked.slice(pos + mark.length)
  const state = EditorState.create({ doc, extensions: [asciidoc(config)] })
  const sources = state.languageDataAt<(c: CompletionContext) => CompletionResult | null | Promise<CompletionResult | null>>('autocomplete', pos)
  expect(sources.length).toBe(1)
  const result = await sources[0]!(new CompletionContext(state, pos, false))
  return { result, doc, pos, state }
}
const labels = (r: CompletionResult | null) => r?.options.map((o) => o.label) ?? []
const option = (r: CompletionResult | null, label: string) => r!.options.find((o) => o.label === label)!

function view(doc: string, anchor: number): EditorView {
  const v = new EditorView({ doc, selection: EditorSelection.cursor(anchor), extensions: [asciidoc()], parent: document.body })
  views.push(v)
  return v
}
/** Applies a completion the way the list does; returns the text and the cursor. */
function pick(doc: string, from: number, to: number, c: Completion) {
  const v = view(doc, to)
  if (typeof c.apply === 'function') c.apply(v, c, from, to)
  else v.dispatch({ changes: { from, to, insert: (c.apply as string | undefined) ?? c.label } })
  return { text: v.state.doc.toString(), cursor: v.state.selection.main.head }
}

describe('completion of attributes', () => {
  it('lists the defaults after { and after {na, with the values', async () => {
    for (const text of ['text {|', 'text {no|']) {
      const { result, pos } = await complete(text)
      expect(result!.from).toBe(text.indexOf('{') + 1)
      expect(result!.to ?? pos).toBe(pos)
      for (const name of Object.keys(DEFAULT_ATTRIBUTES)) expect(labels(result), name).toContain(name)
      expect(option(result, 'note-caption').detail).toBe('Note')
      expect(option(result, 'toc-title').detail).toBe('Table of Contents')
    }
  })

  it('adds the attributes of ParseOptions and the entries above the cursor, not those below', async () => {
    const parse: ParseOptions = { attributes: { fromoptions: 'given' } }
    const { result } = await complete(':above: value above\n:with-dash: 2\n\ntext {|}\n\n:below: no\n', { parse })
    expect(labels(result)).toEqual(expect.arrayContaining(['fromoptions', 'above', 'with-dash', 'note-caption']))
    expect(labels(result)).not.toContain('below')
    expect(option(result, 'fromoptions').detail).toBe('given')
    expect(option(result, 'above').detail).toBe('value above')
  })

  it('leaves out an attribute unset above the cursor, in both forms, and takes it back when it is set again', async () => {
    const off = await complete(':a-thing: 1\n:a-thing!:\n:!note-caption:\n\n{|')
    expect(labels(off.result)).not.toContain('a-thing')
    expect(labels(off.result)).not.toContain('note-caption')
    const again = await complete(':note-caption!:\n:note-caption: Hint\n\n{|')
    expect(option(again.result, 'note-caption').detail).toBe('Hint')
    // unset below the cursor: still there
    const below = await complete('{|\n\n:note-caption!:\n')
    expect(labels(below.result)).toContain('note-caption')
  })

  it('lets an attribute set in a cell of a table count in that cell, and nowhere else', async () => {
    const table = '|===\na|\n:cell-only: 1\n\nin the cell {@@}\n\n!===\na!\n:deeper: 2\n!===\n\n{@@2}\n|plain\n|===\n\n'
    const inCell = await complete(table.replace('{@@2}', '').replace('{@@}', '{@@'), {}, '@@')
    expect(labels(inCell.result)).toContain('cell-only')
    expect(labels(inCell.result)).not.toContain('deeper')
    const after = await complete(table.replace('{@@}', '').replace('{@@2}', '') + '{@@', {}, '@@')
    expect(labels(after.result)).not.toContain('cell-only')
    expect(labels(after.result)).not.toContain('deeper')
    // an entry above the table counts in the cell
    const above = await complete(':above: 1\n\n|===\na|{@@\n|===\n', {}, '@@')
    expect(labels(above.result)).toContain('above')
  })

  it('does not let the document change attributes it may not: a locked attribute keeps its value from the options', async () => {
    const { result } = await complete(':locked: changed\n\n{|', { parse: { attributes: { locked: 'original' } } })
    expect(option(result, 'locked').detail).toBe('original')
  })

  it('inserts name} — or the name only when } follows the cursor', async () => {
    const plain = await complete('a {no|')
    expect(pick(plain.doc, plain.result!.from, plain.pos, option(plain.result, 'note-caption'))).toEqual({ text: 'a {note-caption}', cursor: 16 })
    const closed = await complete('a {no|}')
    expect(pick(closed.doc, closed.result!.from, closed.pos, option(closed.result, 'note-caption'))).toEqual({ text: 'a {note-caption}', cursor: 15 })
  })

  it('does not offer names in a line comment or a block comment', async () => {
    expect((await complete('// note {|')).result).toBeNull()
    expect((await complete('text\n\n////\nsome {|\n////\n')).result).toBeNull()
    expect((await complete('text\n\n// {no|\n')).result).toBeNull()
    expect((await complete('text {|')).result).not.toBeNull()
  })

  it('offers nothing outside braces', async () => {
    expect((await complete('plain text|')).result).toBeNull()
    expect((await complete('closed {a} |')).result).toBeNull()
  })
})

const doc = [
  '= Doc', '', '[[first]]', 'A paragraph.', '', '[[second,Second reftext]]', '[#third]', 'Another.', '', '[id=fourth]', '* item', '',
  '== First section', '', '[[explicit-section,Section reftext]]', '== Explicit', '', '== Привет мир', '', '=== *Bold* section', '',
].join('\n')

describe('the list in a real editor', () => {
  it('opens by itself after { and after xref:', async () => {
    const v = view('text ', 5)
    v.dispatch({ changes: { from: 5, insert: '{' }, selection: { anchor: 6 }, userEvent: 'input.type' })
    await new Promise((r) => setTimeout(r, 400))
    expect(completionStatus(v.state)).toBe('active')
    expect(currentCompletions(v.state).map((c) => c.label)).toContain('note-caption')
    const w = view('[[here]]\ntext xref', 18)
    w.dispatch({ changes: { from: 18, insert: ':' }, selection: { anchor: 19 }, userEvent: 'input.type' })
    await new Promise((r) => setTimeout(r, 400))
    expect(currentCompletions(w.state).map((c) => c.label)).toEqual(['here'])
  })
})

describe('completion of cross reference targets', () => {
  it('lists anchors and section ids after xref: and after <<', async () => {
    for (const before of ['see xref:|', 'see <<|']) {
      const { result } = await complete(doc + '\n' + before)
      expect(labels(result)).toEqual(['first', 'second', 'third', 'fourth', '_first_section', 'explicit-section', '_привет_мир', '_bold_section'])
      expect(option(result, 'second').detail).toBe('Second reftext')
      expect(option(result, '_first_section').detail).toBe('First section')
      expect(option(result, 'explicit-section').detail).toBe('Section reftext')
      expect(option(result, '_привет_мир').detail).toBe('Привет мир')
    }
  })

  it('takes the anchors of a cell for targets, and does not let its attribute entries change the ids after the table', async () => {
    const text = '|===\na|\n:idprefix: cell_\n\n[[in-cell]]\ntext\n|===\n\n== After Table\n\nsee xref:@@'
    const { result } = await complete(text, {}, '@@')
    expect(labels(result)).toEqual(['in-cell', '_after_table'])
  })

  it('takes the text after xref: or << as the beginning of the name', async () => {
    const xr = await complete('xref:fi|\n\n[[first]]\ntext\n')
    expect(xr.result!.from).toBe('xref:'.length)
    const sh = await complete('<<fi|\n\n[[first]]\ntext\n')
    expect(sh.result!.from).toBe('<<'.length)
  })

  it('inserts id[] with the cursor in the brackets after xref:, and id>> after <<', async () => {
    const x = await complete('xref:|\n\n[[first]]\ntext\n')
    expect(pick(x.doc, x.result!.from, x.pos, option(x.result, 'first'))).toMatchObject({ text: 'xref:first[]\n\n[[first]]\ntext\n', cursor: 'xref:first['.length })
    const s = await complete('a <<fi|\n\n[[first]]\ntext\n')
    expect(pick(s.doc, s.result!.from, s.pos, option(s.result, 'first'))).toMatchObject({ text: 'a <<first>>\n\n[[first]]\ntext\n', cursor: 'a <<first>>'.length })
  })

  it('does not offer targets in a comment, nor after other text', async () => {
    expect((await complete('// xref:|\n\n[[a]]\ntext\n')).result).toBeNull()
    expect((await complete('text xref |\n')).result).toBeNull()
  })

  const host: XrefTargets = async (query) => [
    { id: 'guide.adoc#install', label: 'Install' },
    { id: 'guide.adoc#usage', label: `Usage (${query.length})` },
    { id: 'first' },
  ]

  it('puts the targets of the host after those of the document', async () => {
    const { result } = await complete('xref:|\n\n[[first]]\ntext\n\n== Section\n', { xrefTargets: host })
    expect(labels(result)).toEqual(['first', '_section', 'guide.adoc#install', 'guide.adoc#usage'])
    expect(option(result, 'guide.adoc#install').detail).toBe('Install')
    expect(option(result, 'first').boost).toBeGreaterThan(option(result, 'guide.adoc#install').boost!)
  })

  it('keeps the targets of the document when the host fails, without noise on the console', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    for (const failing of [
      () => Promise.reject(new Error('offline')),
      () => {
        throw new Error('sync')
      },
      () => Promise.resolve(undefined as never),
    ] as XrefTargets[]) {
      const { result } = await complete('xref:|\n\n[[first]]\ntext\n', { xrefTargets: failing })
      expect(labels(result)).toEqual(['first'])
    }
    expect(spy).not.toHaveBeenCalled()
    expect(warn).not.toHaveBeenCalled()
  })
})
