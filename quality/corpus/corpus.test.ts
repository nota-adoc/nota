import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { emptyRegistry } from '../reference/compare.js'
import { parse } from '@nota-adoc/core'
import { firstTreeDifference } from '../lib/editor-check.js'
import {
  type EditorResult,
  corpusCompare,
  editorJson,
  formatEditor,
  formatIdentity,
  readSource,
  runEditor,
  runIdentity,
} from './corpus.js'

const fixtures = fileURLToPath(new URL('../fixtures', import.meta.url))

describe('readSource', () => {
  it('keeps a UTF-8 byte order mark', () => {
    expect(readSource(join(fixtures, 'edge/bom.adoc')).charCodeAt(0)).toBe(0xfeff)
  })

  it('decodes UTF-16LE with lone surrogates intact', () => {
    const text = readSource(join(fixtures, 'edge/lone-surrogates.utf16le.adoc'))
    expect(text).toContain('\uD800')
    expect(text).toContain('\uDFFF')
    expect(text.charCodeAt(0)).toBe(0xfeff)
  })
})

describe('identity', () => {
  it('finds every fixture lossless, including all edge cases', () => {
    const r = runIdentity(fixtures)
    expect(r.failures).toEqual([])
    expect(r.lossless).toBe(r.total)
    const edge = readdirSync(join(fixtures, 'edge'))
    expect(edge.length).toBeGreaterThanOrEqual(12)
    expect(formatIdentity(r, { aggregate: false })).toContain(
      `${r.total} of ${r.total} files lossless, 0 errors`,
    )
  })
})

describe('aggregate mode', () => {
  it('keeps names and text of the files out of the output and the report files', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'nota-agg-'))
    const reports = mkdtempSync(join(tmpdir(), 'nota-reports-'))
    const src = join(dir, 'ZZMARK7f3c.adoc')
    // references disagree on this construct, so there is a difference to report
    writeFileSync(src, '= ZZMARK7f3c title\n\n[ZZMARK7f3c]\n ZZMARK7f3c indented\n\nZZMARK7f3c text\n')
    const identity = formatIdentity(runIdentity(dir), { aggregate: true })
    const cmp = await corpusCompare({
      dir,
      only: 'js',
      aggregate: true,
      json: false,
      reportDir: reports,
      registry: emptyRegistry,
    })
    expect(cmp.exitCode).not.toBe(0)
    const saved = readdirSync(reports).map((f) => readFileSync(join(reports, f), 'utf8'))
    for (const out of [identity, cmp.output, ...saved]) {
      expect(out).not.toContain('ZZMARK7f3c')
    }
    expect(cmp.output).toMatch(/differences: [1-9]/)
  })
})

describe('editor', () => {
  it('finds the tree of the editor equal to the tree of Nota on every fixture, after opening and after edits', () => {
    const r = runEditor(fixtures, { seed: 20260929 })
    expect(r.failures).toEqual([])
    expect(r.total).toBeGreaterThan(70)
    expect(r.edits).toBe(r.total * 20)
    const out = formatEditor(r, { aggregate: false })
    expect(out).toContain('seed: 20260929')
    expect(out).toContain(`файлов: ${r.total}`)
    expect(out).toContain('расхождений: 0')
  })

  it('names the file and the position of a difference', () => {
    const diff = firstTreeDifference(parse('a\n\n== S\n').tree, parse('a\n\n== S\n\nb\n').tree)
    expect(diff).not.toBeNull()
    expect(diff!.from).toBeGreaterThan(0)
    expect(diff!.message).toMatch(/editor tree has|nota has/)
    expect(firstTreeDifference(parse('same\n').tree, parse('same\n').tree)).toBeNull()
    const r: EditorResult = { seed: 1, total: 2, edits: 40, failures: [{ file: 'a/b.adoc', problems: ['edit 3: at 17: x'] }] }
    expect(formatEditor(r, { aggregate: false })).toContain('a/b.adoc: edit 3: at 17: x')
  })

  it('keeps names, text and positions out of the output and the report in aggregate mode', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nota-agg-'))
    writeFileSync(join(dir, 'ZZMARK7f3c.adoc'), '= ZZMARK7f3c title\n\n[ZZMARK7f3c]\n ZZMARK7f3c indented\n\nZZMARK7f3c text\n')
    const real = runEditor(dir, { seed: 5 })
    expect(real.failures).toEqual([])
    // a failing result, as it would come from a broken bridge
    const failing: EditorResult = {
      seed: 5,
      total: 1,
      edits: 20,
      failures: [{ file: 'ZZMARK7f3c.adoc', problems: ['edit 2: at 40: editor tree has ZZMARK7f3c'] }],
    }
    for (const r of [real, failing]) {
      expect(formatEditor(r, { aggregate: true })).not.toContain('ZZMARK7f3c')
      expect(editorJson(r, { aggregate: true })).not.toContain('ZZMARK7f3c')
      expect(editorJson(r, { aggregate: true })).not.toContain('at 40')
    }
    expect(formatEditor(failing, { aggregate: true })).toContain('расхождений: 1')
  })
})
