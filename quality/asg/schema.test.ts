// the ASG of every fixture against the schema of the Eclipse AsciiDoc project; the locations and ranges of its nodes.
import { readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { type AsgNode, parse } from '@nota-adoc/core'
import { readSource } from '../lib/read-source.js'
import { prefetchSchema, schemaText, validateAsg } from './schema.js'

const root = join(import.meta.dirname, '../fixtures')
function files(dir: string): string[] {
  return readdirSync(dir)
    .sort()
    .flatMap((e) => {
      const p = join(dir, e)
      return statSync(p).isDirectory() ? files(p) : e.endsWith('.adoc') ? [p] : []
    })
}

let schemaOk = true
try {
  schemaText()
} catch (e) {
  schemaOk = false
  console.warn(`ASG schema not available (no network?): ${(e as Error).message}`)
}

function lineCol(text: string, offset: number): { line: number; col: number } {
  let line = 1
  let start = 0
  for (let i = text.indexOf('\n'); i >= 0 && i < offset; i = text.indexOf('\n', i + 1)) {
    line++
    start = i + 1
  }
  return { line, col: offset - start + 1 }
}

/** Every node of an ASG (objects with a name and a type), with its path: a node with no range is found too. */
function* nodes(value: unknown, path = ''): Generator<[AsgNode, string]> {
  if (Array.isArray(value)) {
    for (const [i, v] of value.entries()) yield* nodes(v, `${path}[${i}]`)
  } else if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>
    if (typeof o['name'] === 'string' && (o['type'] === 'block' || o['type'] === 'inline' || o['type'] === 'string')) yield [o as AsgNode, path]
    for (const [k, v] of Object.entries(o)) if (k !== 'location' && k !== 'range' && k !== 'attributes') yield* nodes(v, `${path}.${k}`)
  }
}

describe('ASG of the fixtures', () => {
  it.skipIf(!schemaOk).each(files(root).map((f) => [relative(root, f), f]))('%s is valid against the schema', (_name, file) => {
    const text = readSource(file)
    const doc = parse(text)
    const asg = doc.asg()
    expect(() => JSON.stringify(asg)).not.toThrow()
    const r = validateAsg(asg)
    expect(r.errors).toEqual([])
    expect(r.ok).toBe(true)
  })

  it.each(files(root).map((f) => [relative(root, f), f]))('%s: every node has a location and a range that hold its source', (_name, file) => {
    const text = readSource(file)
    const doc = parse(text)
    const asg = doc.asg()
    // the value of a text is the text as it reads: the backslash that keeps a construct from being read is not in it
    const reads = (from: number, to: number): string => {
      let out = ''
      for (let i = from; i < to; i++) {
        const n = text[i] === '\\' ? doc.tree.resolveInner(i, 1) : null
        if (!(n && n.name === 'Escape' && n.from === i)) out += text[i]
      }
      return out
    }
    let count = 0
    for (const [n, path] of nodes(asg)) {
      count++
      expect(Array.isArray(n.range), `${path}: range`).toBe(true)
      const [from, to] = n.range
      expect(from >= 0 && from <= to && to <= text.length, `${path}: range ${from}..${to}`).toBe(true)
      const loc = n.location
      expect(loc, `${path}: location`).toBeDefined()
      if (loc[0].file) continue
      expect(loc[0], path).toEqual(lineCol(text, from))
      expect(loc[1], path).toEqual(lineCol(text, Math.max(from, to - 1)))
      if (n.type === 'string' && n.name === 'text') {
        expect(n.value, `${path}: text`).toBe(reads(from, to).replace(/\r\n/g, '\n'))
      }
    }
    expect(count).toBeGreaterThan(0)
  })
})

describe('ASG (examples)', () => {
  it('the reftext has a location and a range over its source', () => {
    for (const t of ['[[a,Ref one]]\nx\n\n[reftext="Ref two"]\ny\n\n[reftext=Ref3]\nz']) {
      const blocks = parse(t).asg().blocks as unknown as { reftext: { value: string; range: [number, number]; location: unknown }[] }[]
      expect(blocks.map((b) => b.reftext[0]!.value)).toEqual(['Ref one', 'Ref two', 'Ref3'])
      for (const b of blocks) {
        const r = b.reftext[0]!
        expect(t.slice(r.range[0], r.range[1])).toBe(r.value)
        expect(r.location).toBeDefined()
      }
    }
  })

  it('reads a document with a header, a section and a paragraph', () => {
    const t = '= T\n\n== A\n\npara'
    const asg = parse(t).asg() as unknown as {
      header: { title: { value: string }[] }
      blocks: { name: string; blocks: { name: string; inlines: { value: string }[] }[] }[]
    }
    expect(asg.header.title[0]!.value).toBe('T')
    expect(asg.blocks[0]!.name).toBe('section')
    expect(asg.blocks[0]!.blocks[0]!.name).toBe('paragraph')
    expect(asg.blocks[0]!.blocks[0]!.inlines[0]!.value).toBe('para')
  })

  it('nodeAt gives the deepest node whose range holds the position', () => {
    const t = '= T\n\n== A\n\npara *b* x'
    const doc = parse(t)
    expect(doc.nodeAt(t.indexOf('para'))?.name).toBe('text')
    expect(doc.nodeAt(t.indexOf('*b*'))?.name).toBe('span')
    expect(doc.nodeAt(t.indexOf('b', t.indexOf('*b*')))?.value).toBe('b')
    expect(doc.nodeAt(t.indexOf('== A'))?.name).toBe('section')
    expect(doc.nodeAt(2)?.name).toBe('text')
    expect(doc.nodeAt(-1)).toBeNull()
    expect(doc.nodeAt(t.length + 5)).toBeNull()
  })

  it.skipIf(!schemaOk)('the check does find a fault: an unknown block and a missing property', () => {
    expect(validateAsg({ name: 'document', type: 'block', blocks: [{ name: 'table', type: 'block' }] }).ok).toBe(false)
    expect(validateAsg({ name: 'document', type: 'block', blocks: [{ name: 'section', type: 'block', level: 1 }] }).ok).toBe(false)
  })

  it('the source of a section starts with its metadata and ends with its last block', () => {
    const t = 'x\n\n[#s]\n== A\n\npara\n\n=== B\n\nmore\n\n'
    const doc = parse(t)
    const s = doc.asg().blocks![0]!
    expect(s.name).toBe('paragraph')
    const sec = doc.asg().blocks![1]!
    expect(sec.name).toBe('section')
    expect(t.slice(sec.range[0], sec.range[1])).toBe('[#s]\n== A\n\npara\n\n=== B\n\nmore')
    expect(sec.id).toBe('s')
  })
})

describe('prefetchSchema', () => {
  it('is what globalSetup runs before the workers: asynchronous, never throws, leaves the schema readable when it is there', async () => {
    await expect(prefetchSchema()).resolves.toBeUndefined()
    await expect(prefetchSchema()).resolves.toBeUndefined()
    if (schemaOk) expect(JSON.parse(schemaText())).toBeTypeOf('object')
  }, 120_000)
})
