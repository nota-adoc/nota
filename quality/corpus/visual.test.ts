import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { OTHER } from '../lib/aggregate.js'
import { VISUAL_KEYS, formatVisual, runVisual, visualJson } from './visual.js'

const root = fileURLToPath(new URL('../../', import.meta.url))
const MARK = 'ZZMARK7f3c'

describe('corpus visual', () => {
  it('counts the blocks of the fixtures of the editor: items, admonitions, boxes, plates', () => {
    const r = runVisual(join(root, 'quality/fixtures/editor'))
    expect(r.counts.files).toBeGreaterThan(5)
    expect(r.counts['blocks.item']).toBeGreaterThan(10)
    expect(r.counts['blocks.admonition-paragraph']).toBeGreaterThan(0)
    expect(r.counts['blocks.admonition-box']).toBeGreaterThan(0)
    expect(r.counts['blocks.collapsible']).toBeGreaterThan(0)
    expect(r.counts['blocks.code']).toBeGreaterThan(0)
    expect(r.counts['blocks.image']).toBeGreaterThan(0)
    expect(r.counts['blocks.island']).toBeGreaterThan(0)
    // the code, the captions and the islands written as they are leave the file as it is
    expect(r.counts['code.mismatch'] ?? 0).toBe(0)
    expect(r.counts['image.mismatch'] ?? 0).toBe(0)
    expect(r.counts['island.mismatch'] ?? 0).toBe(0)
    expect(r.counts.exceptions ?? 0).toBe(0)
    // the round trips give the file back or are refused
    expect(r.counts['tab.mismatch'] ?? 0).toBe(0)
    expect(r.counts['type.mismatch'] ?? 0).toBe(0)
    expect(r.counts['missed.collapsible'] ?? 0).toBe(0)
    expect(r.counts['missed.admonition-box'] ?? 0).toBe(0)
    for (const k of Object.keys(r.counts)) expect([...VISUAL_KEYS, OTHER]).toContain(k)
  })

  it('knows what the lists, the admonitions and the boxes were before: plates', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nota-visual-'))
    writeFileSync(join(dir, 'a.adoc'), 'Intro.\n\n* a\n* b\n\nNOTE: x\n\n[TIP]\n====\ny\n====\n\n.More\n[%collapsible]\n====\nz\n====\n')
    const r = runVisual(dir)
    expect(r.counts['blocks.item']).toBe(2)
    expect(r.counts['before.list']).toBe(1)
    expect(r.counts['before.admonition-paragraph']).toBe(1)
    expect(r.counts['before.admonition-box']).toBe(1)
    expect(r.counts['before.collapsible']).toBe(1)
    expect(r.counts['blocks.island'] ?? 0).toBe(0)
    expect(r.counts['before.plate']).toBe(4)
  })

  it('prints numbers under keys of the list only, and nothing of the text', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nota-visual-'))
    writeFileSync(join(dir, `${MARK}.adoc`), `= ${MARK}\n\n* ${MARK}\n** ${MARK}\n\n[${MARK}]\n====\n${MARK}\n====\n\n:${MARK}: v\n`)
    const r = runVisual(dir)
    const shown = formatVisual(r) + visualJson(r)
    expect(shown).not.toContain(MARK)
    expect(shown).not.toMatch(/ZZMARK/i)
    for (const line of formatVisual(r).trim().split('\n')) expect(line).toMatch(/^[\w<>.-]+: \d+$/)
  })
})

describe('corpus visual: the header of a page', () => {
  const HEAD = '////\ntitle: A\nversion: 3\n////\n'
  const dir = (files: Record<string, string>): string => {
    const d = mkdtempSync(join(tmpdir(), 'nota-visual-'))
    for (const [name, text] of Object.entries(files)) writeFileSync(join(d, name), text)
    return d
  }

  it('hides the header of the fixture, with no island of its lines and the lines given back', () => {
    const r = runVisual(join(root, 'quality/fixtures/editor'))
    expect(r.counts['meta.hidden']).toBeGreaterThanOrEqual(1)
    expect(r.counts['meta.islands'] ?? 0).toBe(0)
    expect(r.counts['meta.mismatch'] ?? 0).toBe(0)
    expect(r.counts['meta.kept'] ?? 0).toBe(0)
  })

  it('checks both ranges of a header: the lines after the title too', () => {
    const r = runVisual(dir({ 'a.adoc': HEAD + ':toc:\n\n= T\n:relfilesuffix: .adoc\n\nText\n' }))
    expect(r.counts['meta.hidden']).toBe(1)
    expect(r.counts['meta.islands'] ?? 0).toBe(0)
    expect(r.counts['meta.mismatch'] ?? 0).toBe(0)
  })

  it('counts a file without a header for none of the keys', () => {
    const r = runVisual(dir({ 'a.adoc': '= T\n\nText\n' }))
    for (const k of ['meta.hidden', 'meta.kept', 'meta.islands', 'meta.mismatch']) expect(r.counts[k] ?? 0).toBe(0)
  })

  it('counts a header that stayed in sight: kept, and its islands', () => {
    const r = runVisual(dir({ 'a.adoc': HEAD + ':toc:\n:a: b\\\n  c\n\n= T\n\nText\n' }))
    expect(r.counts['meta.kept']).toBe(1)
    expect(r.counts['meta.hidden'] ?? 0).toBe(0)
    expect(r.counts['meta.islands']).toBeGreaterThan(0)
  })
})

describe('corpus visual: the zone after the link and toc::[]', () => {
  const dir = (files: Record<string, string>): string => {
    const d = mkdtempSync(join(tmpdir(), 'nota-visual-'))
    for (const [name, text] of Object.entries(files)) writeFileSync(join(d, name), text)
    return d
  }
  const fixture = (name: string): string => readFileSync(join(root, 'quality/fixtures/editor', name), 'utf8')

  it('counts the files with the zone and with toc::[], with no island and no mismatch', () => {
    const r = runVisual(dir({ 'a.adoc': fixture('page-meta-body.adoc'), 'b.adoc': fixture('page-meta-body-no-toc.adoc') }))
    expect(r.counts['meta.hidden']).toBe(2)
    expect(r.counts['meta.body']).toBe(2)
    expect(r.counts['meta.toc']).toBe(1)
    expect(r.counts['meta.islands'] ?? 0).toBe(0)
    expect(r.counts['meta.mismatch'] ?? 0).toBe(0)
  })

  it('counts toc::[] in a file without a header, and an attribute after the text as an island of the page, not of the header', () => {
    const r = runVisual(dir({ 'a.adoc': '= T\n\nText\n\ntoc::[]\n\n:imagesdir: x\n\nMore\n' }))
    expect(r.counts['meta.toc']).toBe(1)
    expect(r.counts['meta.hidden'] ?? 0).toBe(0)
    expect(r.counts['meta.islands'] ?? 0).toBe(0)
  })
})
