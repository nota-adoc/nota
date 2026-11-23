import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parse } from '@nota-adoc/core'
import { layoutItems, pageMetaItems, readLayout, readPageMeta } from '@nota-adoc/core/internal'

const HEAD = '////\ntitle: A\nversion: 3\nancestors:\n  - Root\n  - Mid\nupdated_at: 2026-10-03T11:20:00Z\n////\n'
const meta = (text: string) => readPageMeta(parse(text))
const shown = (text: string, expanded = false) => {
  const doc = parse(text)
  const r = pageMetaItems(doc, layoutItems(readLayout(doc)), expanded)
  return { ...r, kinds: r.items.map((i) => (i.kind === 'fence' ? (i.block!.fence === 'toc' ? 'toc' : `meta:${i.block!.label}`) : i.kind)).join(' ') }
}

describe('the header of a page', () => {
  it('reads fields and lists in the order of the file', () => {
    const m = meta(HEAD + ':toc:\n\n= T\n:relfilesuffix: .adoc\n\nText\n')!
    expect(m.fields.map((f) => f.key)).toEqual(['title', 'version', 'ancestors', 'updated_at'])
    expect(m.fields[0]!.value).toBe('A')
    expect(m.fields[2]!.value).toEqual(['Root', 'Mid'])
    expect(m.lines.get('version')).toBe(HEAD.indexOf('version:'))
  })

  it('has the lines before the title and those after it as ranges', () => {
    const text = HEAD + ':toc:\n\n= T\n:relfilesuffix: .adoc\n\nText\n'
    const m = meta(text)!
    expect(m.ranges).toHaveLength(2)
    expect(text.slice(m.ranges[0]!.from, m.ranges[0]!.to)).toBe(HEAD + ':toc:\n')
    expect(text.slice(m.ranges[1]!.from, m.ranges[1]!.to)).toBe(':relfilesuffix: .adoc\n')
  })

  it('reads the fixture of the editor', () => {
    const text = readFileSync(new URL('../../../quality/fixtures/editor/page-meta.adoc', import.meta.url), 'utf8')
    const m = meta(text)!
    expect(m.fields.find((f) => f.key === 'version')!.value).toBe('14')
    expect(m.ranges).toHaveLength(2)
  })

  it('takes the file after a byte order mark', () => {
    expect(meta('﻿' + HEAD + '= T\n')).not.toBeNull()
  })

  it('is not there without a block comment with fields at the start', () => {
    expect(meta(':toc:\n\n= T\n')).toBeNull()
    expect(meta('////\njust a note\n////\n= T\n')).toBeNull()
    expect(meta('Text\n\n' + HEAD)).toBeNull()
    expect(meta('')).toBeNull()
  })

  it('stops at the first block of content', () => {
    const text = HEAD + '\nText\n\n:late: x\n'
    expect(meta(text)!.ranges).toEqual([{ from: 0, to: HEAD.length }])
  })

  it('works without a title', () => {
    const text = HEAD + ':toc:\n\nText\n'
    expect(meta(text)!.ranges).toEqual([{ from: 0, to: HEAD.length + 6 }])
  })

  it('makes the lines one item that has no text, blank lines inside included', () => {
    const r = shown(HEAD + '\n:toc:\n\n= T\n:relfilesuffix: .adoc\n\nText\n')
    expect(r.kinds).toBe('meta:PageMeta heading meta:PageMetaTail paragraph')
    expect(r.meta).not.toBeNull()
    expect(r.items[0]!.block!.content).toBeNull()
  })

  it('shows the lines as islands when asked', () => {
    const r = shown(HEAD + ':toc:\n\n= T\n:relfilesuffix: .adoc\n\nText\n', true)
    expect(r.kinds).toBe('chip heading chip paragraph')
    expect(r.items[0]!.block!.label).toBe('PageMeta')
    expect(r.items[2]!.block!.label).toBe('PageMetaTail')
  })

  it('leaves a file without a header as it is', () => {
    const r = shown(':toc:\n\n= T\n\nText\n')
    expect(r.meta).toBeNull()
    expect(r.kinds).toBe('chip heading paragraph')
  })
})

const fixture = (name: string) =>
  readFileSync(new URL(`../../../quality/fixtures/editor/${name}.adoc`, import.meta.url), 'utf8')
const LINK = 'link:https://wiki.example.test/p?pageId=1[Open in Confluence]\n'
const TITLE = HEAD + ':doctype: book\n\n= T\n\n'
const slices = (text: string) => meta(text)!.ranges.map((r) => text.slice(r.from, r.to))

describe('the zone after the link', () => {
  it('hides the attributes and blank lines after a paragraph that is one link', () => {
    const text = fixture('page-meta-body')
    const m = meta(text)!
    expect(m.kinds).toEqual(['head', 'body'])
    expect(slices(text)[1]).toBe(':toc:\n:source-highlighter: highlight.js\n\n:relfilesuffix: .adoc\n')
    expect(m.attributes.map((a) => [a.name, a.value])).toEqual([
      ['doctype', 'book'],
      ['toc', ''],
      ['source-highlighter', 'highlight.js'],
      ['relfilesuffix', '.adoc'],
    ])
    expect(m.attributes[2]!.from).toBe(text.indexOf(':source-highlighter'))
    expect(m.tocs).toEqual([{ from: text.indexOf('toc::[]'), to: text.indexOf('toc::[]') + 8 }])
  })

  it('splits the zone by toc::[] and goes on after it', () => {
    const text = TITLE + LINK + '\n:a: 1\n\ntoc::[]\n\n:b: 2\n\nText\n\n:late: x\n'
    const m = meta(text)!
    expect(slices(text).slice(1)).toEqual([':a: 1\n', ':b: 2\n'])
    expect(m.attributes.map((a) => a.name)).toEqual(['doctype', 'a', 'b'])
    expect(m.tocs).toHaveLength(1)
  })

  it('takes any number of blank lines between the attributes', () => {
    const text = TITLE + LINK + '\n\n\n:a: 1\n\n\n\n:b: 2\n\nText\n'
    expect(slices(text)[1]).toBe('\n\n:a: 1\n\n\n\n:b: 2\n')
  })

  it('ends at the first block of content, and the attributes after it stay islands', () => {
    const r = shown(TITLE + LINK + '\n:a: 1\n\nText\n\n:imagesdir: x\n')
    expect(r.kinds).toBe('meta:PageMeta heading paragraph meta:PageMetaBody paragraph chip')
    expect(r.items.filter((i) => i.kind === 'chip')).toHaveLength(1)
  })

  it('takes one link paragraph only, and only right after the title', () => {
    const two = TITLE + LINK + '\n' + LINK + '\n:a: 1\n'
    expect(meta(two)!.attributes.map((a) => a.name)).toEqual(['doctype'])
    const late = TITLE + 'Text\n\n' + LINK + '\n:a: 1\n'
    expect(meta(late)!.attributes.map((a) => a.name)).toEqual(['doctype'])
    const afterAttr = HEAD + '= T\n:a: 1\n\n' + LINK + '\n:b: 2\n'
    expect(meta(afterAttr)!.attributes.map((a) => a.name)).toEqual(['a'])
  })

  it('knows a link written as an address with brackets, and refuses a paragraph with more in it', () => {
    expect(meta(TITLE + 'https://wiki.example.test/p[Open]\n\n:a: 1\n')!.attributes).toHaveLength(2)
    expect(meta(TITLE + 'See link:https://x.test[x]\n\n:a: 1\n')!.attributes).toHaveLength(1)
    expect(meta(TITLE + LINK + 'More text\n\n:a: 1\n')!.attributes).toHaveLength(1)
  })

  it('has no zone without the header comment', () => {
    const text = ':doctype: book\n\n= T\n\n' + LINK + '\n:a: 1\n\ntoc::[]\n'
    expect(meta(text)).toBeNull()
    const r = shown(text)
    expect(r.kinds).toBe('chip heading paragraph chip toc')
    expect(r.items.at(-1)!.block!.label).toBe('Toc')
  })

  it('shows the zone as islands when asked, and pins the toc line', () => {
    const text = fixture('page-meta-body')
    const r = shown(text, true)
    expect(r.kinds).toBe('chip heading paragraph chip chip toc paragraph')
    expect(r.items.filter((i) => i.block?.label === 'PageMetaBody')).toHaveLength(2)
    expect(r.items.find((i) => i.block?.fence === 'toc')!.block!.label).toBe('TocPinned')
  })

  it('makes the runs items without text, with the toc line between', () => {
    const r = shown(fixture('page-meta-body'))
    expect(r.kinds).toBe('meta:PageMeta heading paragraph meta:PageMetaBody toc paragraph')
  })

  it('works without toc::[]', () => {
    const r = shown(fixture('page-meta-body-no-toc'))
    expect(r.kinds).toBe('meta:PageMeta heading paragraph meta:PageMetaBody paragraph')
    expect(meta(fixture('page-meta-body-no-toc'))!.tocs).toEqual([])
  })
})

describe('the line toc::[]', () => {
  const kinds = (text: string) => {
    const doc = parse(text)
    return layoutItems(readLayout(doc)).map((i) => (i.block?.fence === 'toc' ? 'toc' : i.kind)).join(' ')
  }
  it('is its own kind when nothing else is on it', () => {
    expect(kinds('a\n\ntoc::[]\n\nb\n')).toBe('paragraph toc paragraph')
    expect(kinds('toc::[]')).toBe('toc')
  })
  it('stays an island with attributes or lines above it', () => {
    expect(kinds('a\n\ntoc::[levels=2]\n')).toBe('paragraph chip')
    expect(kinds('a\n\n.Title\ntoc::[]\n')).toBe('paragraph chip')
    expect(kinds('a\n\n[role=x]\ntoc::[]\n')).toBe('paragraph chip')
    expect(kinds('a\n\ntoc:: []\n')).not.toContain('toc')
  })
})

describe('attributes taken off', () => {
  it('keeps the mark of :toc!: and :!toc: in the name', () => {
    const m = meta(HEAD + '= A\n\nlink:https://x.test/a[Open]\n\n:toc!:\n:!sectnums:\n:toc:\n\ntext\n')
    expect(m?.attributes.map((a) => a.name)).toEqual(['!toc', '!sectnums', 'toc'])
  })
})
