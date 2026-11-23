import { syntaxTree } from '@codemirror/language'
import { EditorState, type ChangeSpec } from '@codemirror/state'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { parse } from '@nota-adoc/core'
import { asciidoc, notaDocument } from '@nota-adoc/codemirror'
import { treeSignature } from '../../../quality/lib/invariants.js'
import { asciidocText, editSpec, resolveEdit } from '../../../quality/fuzz/generators.js'
import { fixtures } from './helpers.js'

const create = (doc: string) => EditorState.create({ doc, extensions: [asciidoc()] })

function expectSameAsParse(state: EditorState) {
  const text = state.doc.toString()
  const full = parse(text)
  expect(treeSignature(syntaxTree(state))).toBe(treeSignature(full.tree))
  const doc = notaDocument(state)
  expect(doc.text).toBe(text)
  expect(doc.diagnostics).toEqual(full.diagnostics)
}

describe('the Nota tree as the syntax tree of a state', () => {
  const files = fixtures()

  it('finds the fixtures', () => {
    expect(files.length).toBeGreaterThan(60)
  })

  it.each(files)('syntaxTree equals the tree of parse: %s', (_name, text) => {
    const state = create(text)
    expect(state.doc.toString()).toBe(text)
    expectSameAsParse(state)
  })

  const text = '= Title\n\nA paragraph.\n\n== Section\n\n----\ncode\n----\n\n* one\n* two\n'

  it('follows an insertion, a deletion, a replacement and several changes in one transaction', () => {
    let state = create(text)
    const steps: ChangeSpec[] = [
      { from: 10, insert: 'new ' },
      { from: 3, to: 9 },
      { from: 20, to: 25, insert: 'x\ny' },
      [
        { from: 0, insert: '// c\n' },
        { from: 30, to: 32, insert: '' },
        { from: 55, insert: '\n* three' },
      ],
    ]
    for (const changes of steps) {
      state = state.update({ changes }).state
      expectSameAsParse(state)
    }
  })

  it('keeps CR as a character of its line: CRLF text survives byte for byte', () => {
    const crlf = '= T\r\n\r\ntext\r\n\r\n----\r\ncode\r\n----\r\n'
    let state = create(crlf)
    expect(state.doc.toString()).toBe(crlf)
    expect(state.doc.lines).toBe(8)
    expectSameAsParse(state)
    state = state.update({ changes: { from: 5, insert: '\r\n' } }).state
    expectSameAsParse(state)
    state = state.update({
      changes: [
        { from: 0, to: 2 },
        { from: 9, insert: 'x\r' },
      ],
    }).state
    expectSameAsParse(state)
    // a lone CR is not a line break
    state = create('a\rb\r\nc')
    expect(state.doc.toString()).toBe('a\rb\r\nc')
    expectSameAsParse(state)
  })

  it('reuses the old document instead of parsing everything again', () => {
    const big = Array.from({ length: 400 }, (_, i) => `== Section ${i}\n\nParagraph ${i}.\n`).join('\n')
    const s1 = create(big)
    const d1 = notaDocument(s1)
    const s2 = s1.update({ changes: { from: big.length - 4, insert: 'x' } }).state
    const d2 = notaDocument(s2)
    expect(d2).not.toBe(d1)
    // nodes before the edit are the very same objects: the reparse started there
    const first = (d: typeof d1) => d.tree.topNode.firstChild!.firstChild!.tree
    expect(first(d2)).toBe(first(d1))
    expectSameAsParse(s2)
  })

  it('parses the text when the state has no AsciiDoc language', () => {
    const state = EditorState.create({ doc: text })
    expect(notaDocument(state).text).toBe(text)
    expect(notaDocument(state)).toBe(notaDocument(state))
  })

  it('passes ParseOptions to Nota', () => {
    const src = 'ifdef::flavor[]\nplain\nendif::[]\n'
    const options = { attributes: { flavor: 'x' } }
    const on = EditorState.create({ doc: src, extensions: [asciidoc({ parse: options })] })
    const off = create(src)
    expect(treeSignature(syntaxTree(on))).toBe(treeSignature(parse(src, options).tree))
    expect(treeSignature(syntaxTree(on))).not.toBe(treeSignature(syntaxTree(off)))
  })

  it('stays equal to a full parse after random chains of edits (fast-check)', () => {
    fc.assert(
      fc.property(
        asciidocText,
        fc.array(fc.array(editSpec, { minLength: 1, maxLength: 3 }), { maxLength: 8 }),
        (src, steps) => {
          let state = create(src)
          for (const step of steps) {
            const cur = state.doc.toString()
            // the changes of one transaction are in coordinates of the same document: keep those that do not overlap
            const changes: { from: number; to: number; insert: string }[] = []
            for (const e of step) {
              const c = resolveEdit(cur, e)
              if (changes.every((o) => c.to <= o.from || c.from >= o.to) && !changes.some((o) => o.from === c.from))
                changes.push(c)
            }
            state = state.update({ changes }).state
            expectSameAsParse(state)
          }
        },
      ),
      { numRuns: 300 },
    )
  })
})
