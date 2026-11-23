// the ids of sections that `doc.outline()` of @nota-adoc/core gives (and `documentTargets` of
// @nota-adoc/codemirror takes from it) against the ids Asciidoctor.js gives.
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parse } from '@nota-adoc/core'
import { documentTargets } from '@nota-adoc/codemirror'

/* eslint-disable @typescript-eslint/no-explicit-any */
async function asciidoctor(): Promise<{ load: (s: string, o: object) => Promise<any>; NullLogger: new () => unknown }> {
  const root = resolve(dirname(createRequire(import.meta.url).resolve('@asciidoctor/core')), '../..')
  return import(pathToFileURL(join(root, 'src/index.js')).href)
}

const fixtureRoot = join(import.meta.dirname, '../fixtures')
function files(): string[] {
  const out: string[] = []
  for (const dir of ['stage1', 'stage2', 'editor'])
    for (const e of readdirSync(join(fixtureRoot, dir)).sort())
      if (e.endsWith('.adoc')) out.push(join(dir, e))
  return out
}

/** Ids of the sections and discrete headings of a document, in order, from Asciidoctor.js. */
async function referenceIds(text: string): Promise<(string | null)[]> {
  const a = await asciidoctor()
  // Asciidoctor.js reports problems of the text (an unterminated block) on the console
  const { error, warn } = console
  console.error = console.warn = () => {}
  let doc
  try {
    doc = await a.load(text, { safe: 'secure', logger: new a.NullLogger() })
  } finally {
    console.error = error
    console.warn = warn
  }
  const header = doc.getHeader?.()
  const nodes = (await doc.findBy({})) as any[]
  return nodes
    .filter((n) => (n.getContext() === 'section' && n !== header) || n.getContext() === 'floating_title')
    .map((n) => n.getId() ?? null)
}

describe('ids of sections against Asciidoctor.js', () => {
  let compared = 0
  it.each(files())('%s', async (name) => {
    const text = readFileSync(join(fixtureRoot, name), 'utf8')
    const doc = parse(text)
    const expected = await referenceIds(text)
    const own = doc.outline()
    // Nota finds the sections Asciidoctor finds, one to one, and gives each the same id (titles with markup too)
    expect(own.length, `${relative(fixtureRoot, name)}: sections`).toBe(expected.length)
    own.forEach((s, i) => {
      compared++
      expect(s.id, `${name}: "${s.title}"`).toBe(expected[i])
    })
    // the targets of codemirror carry the same ids
    const ids = documentTargets(doc).sections.map((s) => s.id)
    expect(ids, `${name}: documentTargets`).toEqual(own.map((s) => s.id))
  })

  it('compared a good many sections, none left out', () => {
    console.log(`section ids: ${compared} compared with Asciidoctor.js, none left out`)
    expect(compared).toBeGreaterThan(50)
  })
})
