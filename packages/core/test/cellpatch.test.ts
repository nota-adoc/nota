import { describe, expect, it } from 'vitest'
import { parse } from '@nota-adoc/core'
import type { NotaDocument } from '@nota-adoc/core'
import { signature } from './helpers.js'

const table = (rows: number, cols: number, head = ''): string => {
  const line = (r: number): string => Array.from({ length: cols }, (_, c) => `|r${r}c${c} text`).join(' ')
  return `= Table\n\n${head}|===\n${line(0)}\n\n${Array.from({ length: rows - 1 }, (_, r) => line(r + 1)).join('\n')}\n|===\n\nafter\n`
}

/** Everything a document says about its tables, its tree and its problems. */
function state(doc: NotaDocument): string {
  const models: unknown[] = []
  for (let p = 0; p < doc.text.length; p++) {
    const m = doc.tableAt(p)
    if (m && !models.some((x) => (x as { from: number }).from === m.from)) models.push(m)
  }
  return JSON.stringify([signature(doc.tree), models, doc.diagnostics])
}

function prng(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

describe('a change in the text of a cell reads as the parser reads it', () => {
  it('typing and deleting in a big table, one change after another', () => {
    const rnd = prng(7)
    const fresh = table(30, 4, '[%header]\n')
    let doc = parse(fresh)
    const alphabet = ['x', 'y', 'Z', '1', ' ', '|', '\\', '"', '+', '.', '*', '<', '>', '=', 'a', '\n', '//', '{x}', '2+']
    for (let i = 0; i < 300; i++) {
      const text = doc.text
      const start = Math.max(0, text.indexOf('|==='))
      const from = start + Math.floor(rnd() * (text.length - start))
      const del = rnd() < 0.3 ? Math.floor(rnd() * 3) : 0
      const insert = rnd() < 0.2 ? '' : alphabet[Math.floor(rnd() * alphabet.length)]!
      const next = doc.update([{ from, to: Math.min(text.length, from + del), insert }])
      const full = parse(next.text)
      expect(state(next)).toBe(state(full))
      doc = i % 8 === 7 ? parse(fresh) : next
    }
  })

  it('tables with spans, styles, footers and cells with documents', () => {
    const src =
      '= T\n\n[cols="2,1a,1",options="header,footer"]\n|===\n|name |doc |n\n\n2+|wide cell |x\n.2+|tall |* item\n\n* two |y\n|z\n^|mid |s\n|===\n\n[%header,cols=3]\n|===\n|a |b |c\n|1 |2 |3\n|===\n\n,===\na,b\n,===\n'
    const rnd = prng(3)
    const alphabet = ['x', 'Q', '9', ' ', '|', '\\', '+', '.', 's', 'a', '\n', '*', '{n}', '2+', '=', '"']
    let doc = parse(src)
    for (let i = 0; i < 600; i++) {
      const text = doc.text
      const from = Math.floor(rnd() * (text.length + 1))
      const del = rnd() < 0.3 ? Math.floor(rnd() * 3) : 0
      const insert = rnd() < 0.15 ? '' : alphabet[Math.floor(rnd() * alphabet.length)]!
      const next = doc.update([{ from, to: Math.min(text.length, from + del), insert }])
      if (state(next) !== state(parse(next.text))) throw new Error(JSON.stringify({ i, from, del, insert, before: text, after: next.text }))
      // (what the editor keeps: the text goes back now and then, so that the table is not lost to the noise)
      doc = rnd() < 0.5 ? next : parse(src)
    }
  })

  it('plain letters in cells do not read the table again', () => {
    const rnd = prng(11)
    let doc = parse(table(200, 10))
    const unitsOf = (d: NotaDocument) => (d as unknown as { units: { units: { block: { tree: { children: unknown[] } } | null }[] } }).units.units
    let reused = 0
    for (let i = 0; i < 200; i++) {
      const text = doc.text
      const cells = [...text.matchAll(/\|r\d+c\d+ text/g)]
      const m = cells[Math.floor(rnd() * cells.length)]!
      const at = m.index! + 2 + Math.floor(rnd() * (m[0].length - 1))
      const next = doc.update([{ from: at, insert: 'x' }])
      const a = unitsOf(doc).find((u) => u.block?.tree.children.length)!
      const b = unitsOf(next).find((u) => u.block?.tree.children.length)!
      // (every child of the tree is the old one, bar those around the cell: the table is not built again)
      const was = a.block!.tree.children
      const now = b.block!.tree.children
      const kept = now.filter((c) => was.includes(c)).length
      if (now.length === was.length && kept >= now.length - 3) reused++
      if (i % 20 === 0) expect(state(next)).toBe(state(parse(next.text)))
      doc = next
    }
    expect(reused).toBe(200)
    expect(state(doc)).toBe(state(parse(doc.text)))
  })

  it('a table with another separator or other attributes that change the reading is left to the parser', () => {
    const sources = [
      '= T\n\n[separator=¦]\n|===\n¦one ¦two\n¦three ¦four\n|===\n',
      '= T\n\n[separator=;]\n|===\n;one ;two\n;three ;four\n|===\n',
      '= T\n\n[cols=2*]\n|===\n|one |two\n|three |four\n|===\n',
      '= T\n\n[format=csv]\n|===\none,two\nthree,four\n|===\n',
      '= T\n\n[cols="1,1a"]\n|===\n|one |two\n|three |four\n|===\n',
    ]
    for (const src of sources) {
      for (const ch of ['¦', ';', ',', 'x', '|', ' ']) {
        let doc = parse(src)
        for (const word of ['two', 'three', 'one']) {
          const from = doc.text.indexOf(word) + 1
          doc = doc.update([{ from, insert: ch }])
          expect(state(doc), JSON.stringify([src, ch, word])).toBe(state(parse(doc.text)))
        }
      }
    }
  })

  describe('a NUL in a cell, which Ruby strips from the ends', () => {
    const sources = [
      '[%header%footer]\n|===\n|a\n|a\n\n\n\n|===\n\n\n',
      '= T\n\n|===\n|a |b\n\n|c |d\n|===\n',
      '|===\n|\n|\n\n|\n|===\n',
      '= T\n\n|===\n|ab |cd\n\n|abc |de\n|===\n',
    ]
    for (const [k, src] of sources.entries()) {
      const cells = [...src.matchAll(/\|(?!===)([a-e]*)/g)]
      for (const [name, where] of [
        ['at the end', (i: number, len: number) => i + 1 + len],
        ['at the start', (i: number) => i + 1],
        ['in the middle', (i: number, len: number) => i + 1 + Math.floor(len / 2)],
      ] as const) {
        it(`source ${k}, ${name} of each cell`, () => {
          const doc = parse(src)
          for (const m of cells) {
            const at = where(m.index!, m[1]!.length)
            const next = doc.update([{ from: at, to: at, insert: '\u0000' }])
            expect(state(next)).toBe(state(parse(next.text)))
          }
        })
      }
    }
  })
})
