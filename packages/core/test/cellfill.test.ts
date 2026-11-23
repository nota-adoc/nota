import { describe, expect, it } from 'vitest'
import { type TableModel } from '@nota-adoc/core'
import { lossless } from './helpers.js'

const Y = '[.cell-yellow]##{empty}##'

function cellsOf(text: string, at = '|'): TableModel['rows']['body'][number]['cells'] {
  const doc = lossless(text)
  const m = doc.tableAt(text.indexOf(at, text.indexOf('===')) + 1)
  if (!m) throw new Error('no table')
  return [...m.rows.head, ...m.rows.body, ...m.rows.foot].flatMap((r) => r.cells)
}

/** The fill of each cell as `role:label`, or null. */
function fills(text: string, at = '|'): (string | null)[] {
  return cellsOf(text, at).map((c) => (c.fill ? `${c.fill.role}:${text.slice(c.fill.from, c.fill.to)}` : null))
}

describe('cell fill: reading', () => {
  it('reads the label at the start of a cell', () => {
    const text = `|===\n|${Y}текст\n|[.cell-yellow]#{empty}# текст\n|[.cell-mint]##{empty}##\n|обычная\n|===\n`
    expect(fills(text)).toEqual([
      `cell-yellow:${Y}`,
      'cell-yellow:[.cell-yellow]#{empty}#',
      'cell-mint:[.cell-mint]##{empty}##',
      null,
    ])
    expect(cellsOf(text)[0]!.text).toBe(`${Y}текст`)
  })

  it('gives the same fill after an incremental update', () => {
    const text = `|===\n|${Y}текст |b\n|c |d\n|===\n`
    const doc = lossless(text)
    const next = doc.update([{ from: text.indexOf('c |'), to: text.indexOf('c |') + 1, insert: 'new' }])
    const full = lossless(next.text)
    const pick = (d: typeof full) => d.tableAt(6)!.rows.body.flatMap((r) => r.cells.map((c) => c.fill))
    expect(pick(next)).toEqual(pick(full))
    // the edit touches the label itself
    const hit = doc.update([{ from: text.indexOf('yellow'), to: text.indexOf('yellow') + 6, insert: 'mint' }])
    expect(pick(hit)).toEqual(pick(lossless(hit.text)))
    // a label typed into a plain cell
    const typed = doc.update([{ from: text.indexOf('b\n'), to: text.indexOf('b\n'), insert: '[.cell-red]##{empty}##' }])
    expect(pick(typed)).toEqual(pick(lossless(typed.text)))
    expect(pick(typed)[1]?.role).toBe('cell-red')
  })

  it('does not read what is not the label', () => {
    const forms = [
      '[.cell-yellow]#{empty}#текст',
      'x [.cell-yellow]##{empty}##y',
      '\\[.cell-yellow]##{empty}##x',
      '[.hl-mint]##{empty}##x',
      '[.yellow]##{empty}##x',
      '[.cell-]##{empty}##x',
      '[.cell-yellow.bold]##{empty}##x',
      '[.cell-yellow]##x##',
    ]
    for (const f of forms) expect(fills(`|===\n|${f}\n|===\n`), f).toEqual([null])
    expect(fills(`|===\nl|${Y}x\n|===\n`)).toEqual([null])
    expect(fills(`[cols="1l,1"]\n|===\n|${Y}x |${Y}y\n|===\n`)).toEqual([null, `cell-yellow:${Y}`])
    expect(fills(`|===\na|x ${Y}y\n|===\n`)).toEqual([null])
    expect(fills(`|===\na|${Y}term:: def\n|===\n`)).toEqual([null])
    // (a word character after the closed form, as Asciidoctor has it: `_` and combining marks too)
    for (const f of ['_y', '́y']) expect(fills(`|===\n|[.cell-x]#{empty}#${f}\n|===\n`), f).toEqual([null])
  })

  it('reads the label in every kind of cell', () => {
    for (const s of ['d', 'h', 'm', 'e', 's'])
      expect(fills(`|===\n${s}|${Y}x\n|===\n`), s).toEqual([`cell-yellow:${Y}`])
    expect(fills(`|===\na|${Y}абзац\n\n* пункт\n|===\n`)).toEqual([`cell-yellow:${Y}`])
    expect(fills(`[%header]\n|===\n|${Y}h |b\n|c |d\n|===\n`).slice(0, 2)).toEqual([`cell-yellow:${Y}`, null])
    expect(fills(`|===\n|${Y}h |b\n\n|c |d\n|===\n`)[0]).toBe(`cell-yellow:${Y}`)
    expect(fills(`|===\n2+|${Y}a\n.2+|${Y}b |c\n|d\n|===\n`)).toEqual([
      `cell-yellow:${Y}`,
      `cell-yellow:${Y}`,
      null,
      null,
    ])
    expect(fills(`[format=csv]\n|===\n"${Y}a, b",${Y}c\n|===\n`)).toEqual([`cell-yellow:${Y}`, `cell-yellow:${Y}`])
    expect(fills(`[format=dsv]\n|===\n${Y}a:${Y}b\n|===\n`)).toEqual([`cell-yellow:${Y}`, `cell-yellow:${Y}`])
    const nested = `|===\na|\n!===\n!${Y}n !m\n!===\n|===\n`
    expect(fills(nested, '!')).toEqual([`cell-yellow:${Y}`, null])
  })
})
