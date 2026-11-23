// the package and its API.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as core from '@nota-adoc/core'
import * as codemirror from '@nota-adoc/codemirror'
import * as api from '@nota-adoc/prosemirror'

const pkg = (
  dir: string,
): { dependencies?: Record<string, string>; peerDependencies?: Record<string, string> } =>
  JSON.parse(readFileSync(join(import.meta.dirname, '../../', dir, 'package.json'), 'utf8'))
const readme = readFileSync(join(import.meta.dirname, '../README.md'), 'utf8')

describe('@nota-adoc/prosemirror: package', () => {
  it('has only @nota-adoc/core in dependencies, prosemirror-* as peers, no Tiptap and no prosemirror-history', () => {
    const p = pkg('prosemirror')
    expect(Object.keys(p.dependencies ?? {})).toEqual(['@nota-adoc/core'])
    expect(Object.keys(p.peerDependencies ?? {}).every((n) => n.startsWith('prosemirror-'))).toBe(true)
    expect(Object.keys(p.peerDependencies ?? {})).toEqual(
      expect.arrayContaining(['prosemirror-model', 'prosemirror-state', 'prosemirror-view']),
    )
    const all = JSON.stringify(p)
    expect(all).not.toMatch(/tiptap|prosemirror-history/i)
    // and none of its sources imports them
    for (const file of ['editor.ts', 'keymap.ts', 'positions.ts', 'project.ts', 'schema.ts', 'index.ts'])
      expect(readFileSync(join(import.meta.dirname, '../src', file), 'utf8'), file).not.toMatch(
        /tiptap|prosemirror-history/i,
      )
  })

  it('exports the editor, the projection and the schema', () => {
    expect(Object.keys(api).sort()).toEqual([
      'CELL_FILL_ROLES',
      'ENGLISH_LABELS',
      'FILL_ROLES',
      'LANGUAGES',
      'RendererMissing',
      'TEXT_COLOR_ROLES',
      'canonicalLanguage',
      'createVisualEditor',
      'itemNumbers',
      'languageWord',
      'numberLabel',
      'projectDocument',
      'projectItem',
      'projectItems',
      'schema',
      'setLabels',
    ])
  })

  it('core exports the session and applyOperation, and codemirror the same session as before', () => {
    expect(typeof core.createSession).toBe('function')
    expect(typeof core.applyOperation).toBe('function')
    expect(codemirror.createSession).toBe(core.createSession)
  })

  it('applyOperation works in Node without an editor: { doc, changes } or { error, diagnostics }', () => {
    const doc = core.parse('hello world\n')
    const ok = core.applyOperation(doc, { kind: 'insertText', at: 5, text: ',' })
    expect('error' in ok).toBe(false)
    if ('error' in ok) return
    expect(ok.doc.text).toBe('hello, world\n')
    expect(ok.changes).toEqual([{ from: 5, to: 5, insert: ',' }])
    expect(doc.text).toBe('hello world\n')
    const bad = core.applyOperation(doc, { kind: 'setLink', from: 0, to: 0, target: 'https://x.y' })
    expect('error' in bad).toBe(true)
    if (!('error' in bad)) return
    expect(bad.diagnostics.length).toBeGreaterThan(0)
    expect(bad.diagnostics[0]!.severity).toBe('error')
  })

  it('handles every kind of operation of the API', () => {
    const doc = core.parse('one two three\n\nfour\n')
    const kinds: core.Operation[] = [
      { kind: 'insertText', at: 3, text: 'x' },
      { kind: 'deleteRange', from: 0, to: 3 },
      { kind: 'toggleMark', from: 4, to: 7, mark: 'strong' },
      { kind: 'setLink', from: 4, to: 7, target: 'https://x.y' },
      { kind: 'removeLink', at: 3 },
      { kind: 'splitBlock', at: 3 },
      { kind: 'joinBlocks', at: 15 },
      { kind: 'setBlockType', at: 1, type: 'heading', level: 2 },
    ]
    for (const op of kinds) {
      const r = core.applyOperation(doc, op)
      if (op.kind === 'removeLink') expect(r).toHaveProperty('error')
      else expect(r, op.kind).toHaveProperty('changes')
    }
  })

  it('documents the members and options in its README', () => {
    for (const name of [
      'createVisualEditor',
      'projectDocument',
      'onReject',
      'messages',
      'plugins',
      'timing',
      'toggleMark',
      'setLink',
      'removeLink',
      'setBlockType',
      'splitBlock',
      'insertBreak',
      'getText()',
    ])
      expect(readme, name).toContain(name)
    for (const node of [
      'heading',
      'paragraph',
      'hard_break',
      'island',
      'code_block',
      'image',
      'inline_chip',
      'strong',
      'em',
      'code',
      'strike',
      'highlight',
      'roles',
      'link',
    ])
      expect(readme, node).toContain(node)
  })
})
