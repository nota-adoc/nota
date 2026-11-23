import { describe, expect, it } from 'vitest'
import { type Operation, applyOperation, parse } from '@nota-adoc/core'
import { applyChanges } from '../src/incremental.js'

const L = (r: string) => `[.${r}]##{empty}##`

/** The operation `setCellFill` at the first `mark`: the new text, or the code of the refusal. */
function fill(text: string, mark: string, role: string | null): string {
  const at = text.indexOf(mark)
  const r = applyOperation(parse(text), { kind: 'setCellFill', at, role } as Operation)
  if ('error' in r) return r.error
  expect(applyChanges(text, r.changes)).toBe(r.doc.text)
  return r.doc.text
}

const roles = (text: string, mark: string) => {
  const doc = parse(text)
  const m = doc.tableAt(text.indexOf(mark))!
  return [...m.rows.head, ...m.rows.body, ...m.rows.foot].flatMap((r) => r.cells.map((c) => c.fill?.role ?? null))
}

describe('setCellFill', () => {
  const tables: [string, string, string][] = [
    ['psv', '|===\n|a |b\n|c |d\n|===\n', 'a'],
    ['psv, header', '[%header]\n|===\n|a |b\n|c |d\n|===\n', 'a'],
    ['psv, merged', '|===\n2+|a\n|c |d\n|===\n', 'a'],
    ['psv, rowspan', '|===\n.2+|a |b\n|d\n|===\n', 'a'],
    ['psv, style a', '|===\na|a\n\nsecond\n|===\n', 'a'],
    ['psv, style m', '|===\nm|a |b\n|===\n', 'a'],
    ['csv', '[format=csv]\n|===\na,b\nc,d\n|===\n', 'a'],
    ['csv, quoted', '[format=csv]\n|===\n"a, x",b\n|===\n', 'a, x'],
    ['dsv', '[format=dsv]\n|===\na:b\nc:d\n|===\n', 'a'],
    ['nested psv', '|===\na|\n!===\n!a !b\n!===\n|z\n|===\n', 'a !b'],
    ['nested csv', '|===\na|\n,===\na,b\n,===\n|z\n|===\n', 'a,b'],
  ]
  for (const [name, t, mark] of tables) {
    it(`sets, changes and removes the fill: ${name}`, () => {
      const set = fill(t, mark, 'cell-yellow')
      expect(set).not.toBe(t)
      expect(set.replace(L('cell-yellow'), '')).toBe(t)
      expect(roles(set, mark).filter(Boolean)).toEqual(['cell-yellow'])
      const doc0 = parse(set)
      expect(doc0.tableAt(set.indexOf(mark) )!.rows).toBeDefined()
      const changed = fill(set, 'cell-yellow', 'cell-mint')
      expect(changed).toBe(set.replace('cell-yellow', 'cell-mint'))
      expect(fill(changed, 'cell-mint', 'cell-mint')).toBe(changed)
      expect(fill(changed, 'cell-mint', null)).toBe(t)
      expect(fill(t, mark, null)).toBe(t)
    })
  }

  it('returns no changes for the same role or null without a fill', () => {
    const t = `|===\n|${L('cell-yellow')}a |b\n|===\n`
    for (const [mark, role] of [['cell', 'cell-yellow'], ['b', null]] as const) {
      const r = applyOperation(parse(t), { kind: 'setCellFill', at: t.indexOf(mark), role })
      expect('error' in r ? r.error : r.changes).toEqual([])
    }
  })

  it('keeps the text of an empty cell and of a one-column table written', () => {
    expect(fill('|===\n| |b\n|===\n', '| |b', 'cell-a')).toBe(`|===\n|${L('cell-a')} |b\n|===\n`)
    const one = '[format=csv]\n|===\n""\n|===\n'
    const set = fill(one, '""', 'cell-a')
    expect(set).toBe(`[format=csv]\n|===\n${L('cell-a')}\n|===\n`)
    expect(fill(set, 'cell-a', null)).toBe('[format=csv]\n|===\n""\n|===\n')
  })

  it('puts the label of a quoted DSV field inside the quotes', () => {
    const src = '[format=dsv]\n|===\n"a":b\n|===\n'
    // (the parser takes the quotes off a DSV field as it does in CSV, as Asciidoctor does: the label goes inside them)
    const out = fill(src, '"a"', 'cell-a')
    expect(out).toBe(`[format=dsv]\n|===\n"${L('cell-a')}a":b\n|===\n`)
    expect(roles(out, '|===')).toEqual(['cell-a', null])
  })

  it('shows no label in the view of an a-cell with only the label before a list', async () => {
    const { tableViewAt } = await import('@nota-adoc/core/internal')
    const v = tableViewAt(parse(`|===\na|${L('cell-x')}\n\n* пункт\n|===\n`), 0)!
    const b = v.rows[0]![0]!.blocks
    expect(b[0]).toMatchObject({ kind: 'text', text: '' })
    const t = b[0] as { from: number; to: number }
    expect(t.from).toBeLessThanOrEqual(t.to)
    expect(b.some((x) => x.kind === 'plate' && x.src.includes('cell-x'))).toBe(false)
  })

  it('removes a label that is followed by white space', () => {
    for (const [src, out] of [
      ['|===\n|[.cell-yellow]#{empty}# текст\n|===\n', '|===\n|текст\n|===\n'],
      ['|===\n|[.cell-x]##{empty}## текст\n|===\n', '|===\n|текст\n|===\n'],
      ['|===\n|[.cell-x]##{empty}##\nтекст\n|===\n', '|===\n|текст\n|===\n'],
      ['|===\na|[.cell-x]##{empty}##\n\n* пункт\n|===\n', '|===\na|* пункт\n|===\n'],
    ] as const) {
      expect(fill(src, '[.cell', null), src).toBe(out)
    }
  })

  it('refuses', () => {
    const t = '|===\n|a |b\n|===\n'
    for (const role of ['yellow', 'cell-', 'cell yellow', 'cell-a.b', '']) expect(fill(t, 'a', role), role).toBe('invalid-role')
    expect(fill(t, 'a', 5 as unknown as string)).toBe('invalid-role')
    expect(fill('|===\nl|a |b\n|===\n', 'a', 'cell-a')).toBe('unsupported')
    expect(fill('[cols="1l,1"]\n|===\n|a |b\n|===\n', 'a', 'cell-a')).toBe('unsupported')
    for (const body of ['a|* список', 'a|\n[.x]\nабзац', 'a|\n----\ncode\n----', 'a|\n!===\n!x\n!===']) {
      expect(fill(`|===\n${body}\n|===\n`, 'a|', 'cell-a'), body).toBe('unsupported')
    }
    expect(fill('|===\na|.Заголовок\nабзац\n|===\n', 'a|', 'cell-a')).toBe('unsupported')
    const text = `${t}\nпосле`
    expect(applyOperation(parse(text), { kind: 'setCellFill', at: text.indexOf('после'), role: 'cell-a' })).toHaveProperty('error', 'invalid-target')
  })
})

describe('the fill survives the edits of the table', () => {
  const Y = L('cell-yellow')
  const M = L('cell-mint')
  const base = `|===\n|${Y}a |b\n|${M}c |d\n|===\n`
  const fillsOf = (text: string) => roles(text, '|')
  const apply = (text: string, op: Operation): string => {
    const r = applyOperation(parse(text), op)
    if ('error' in r) throw new Error(r.error)
    return r.doc.text
  }

  it('is in the view of the table, and its text starts after the label', async () => {
    const { tableViewAt } = await import('@nota-adoc/core/internal')
    const doc = parse(`|===\n|${Y}a |b\n|${M}c |d\n|===\n`)
    const v = tableViewAt(doc, 0)!
    const cells = v.rows.flat()
    expect(cells.map((c) => c.fill)).toEqual(['cell-yellow', null, 'cell-mint', null])
    expect(cells[0]!.blocks).toEqual([{ kind: 'text', text: 'a', from: Y.length, to: Y.length + 1, readable: true, reading: null }])
    expect(cells[1]!.fill).toBeNull()
    const v2 = tableViewAt(parse(`|===\na|${Y}абзац\n\n* пункт\n|===\n`), 0)!
    const b = v2.rows[0]![0]!.blocks
    expect(v2.rows[0]![0]!.fill).toBe('cell-yellow')
    expect(b[0]).toMatchObject({ kind: 'text', text: 'абзац', from: Y.length })
    expect(b[1]).toMatchObject({ kind: 'text', text: 'пункт', item: { marker: '*', level: 1, checked: '' } })
  })

  it('stays in the other cells after rows, columns, style and alignment', () => {
    const ops: Operation[] = [
      { kind: 'insertRow', at: base.indexOf('|b'), where: 'after' },
      { kind: 'insertColumn', at: base.indexOf('|b'), where: 'after' },
      { kind: 'deleteRow', at: base.indexOf('|b') },
      { kind: 'deleteColumn', at: base.indexOf('|b') },
      { kind: 'setCellStyle', at: base.indexOf('|b'), style: 'asciidoc' },
      { kind: 'setCellAlign', at: base.indexOf('|b'), halign: 'center' },
    ]
    for (const op of ops) {
      const out = apply(base, op)
      const got = fillsOf(out)
      if (op.kind === 'deleteRow') expect(got, op.kind).toEqual(['cell-mint', null])
      else if (op.kind === 'deleteColumn') expect(got, op.kind).toEqual(['cell-yellow', 'cell-mint'])
      else expect(got.filter(Boolean), op.kind).toEqual(['cell-yellow', 'cell-mint'])
    }
  })

  it('merges to the fill of the top left cell and splits with the fill in the first cell', () => {
    const empty = `|===\n|${Y}a |\n|${M}c |d\n|===\n`
    const merged = apply(empty, { kind: 'mergeCells', from: empty.indexOf('|' + Y), to: empty.indexOf('|\n') })
    const cells = parse(merged).tableAt(merged.indexOf('|'))!.rows.body.flatMap((r) => r.cells)
    expect(cells[0]!.colspan).toBe(2)
    expect(cells[0]!.fill?.role).toBe('cell-yellow')
    const split = apply(merged, { kind: 'splitCell', at: merged.indexOf('|' + Y) })
    const parts = parse(split).tableAt(split.indexOf('|'))!.rows.body[0]!.cells
    expect(parts.map((c) => c.fill?.role ?? null)).toEqual(['cell-yellow', null])
  })

  it('is not a colour of the text, and the colour does not take the label', () => {
    const t = `|===\n|${Y}текст |b\n|===\n`
    const doc = parse(t)
    expect(doc.colors()).toEqual([])
    expect(doc.colorAt(t.indexOf('текст'))).toEqual([])
    expect(doc.colorAt(t.indexOf('[.cell'))).toEqual([])
    const from = t.indexOf('текст')
    const r = applyOperation(doc, { kind: 'setColor', from, to: from + 5, role: 'hl-mint' })
    if ('error' in r) throw new Error(r.error)
    expect(r.doc.tableAt(0)!.rows.body[0]!.cells[0]!.fill?.role).toBe('cell-yellow')
    expect(r.doc.text).toContain(Y)
    const gone = applyOperation(r.doc, { kind: 'removeColor', from: r.doc.text.indexOf('текст'), to: r.doc.text.indexOf('текст') + 5 })
    if ('error' in gone) throw new Error(gone.error)
    expect(gone.doc.text).toBe(t)
    // the whole visible text of a cell with the fill, which the label starts
    const all = applyOperation(doc, { kind: 'setColor', from: t.indexOf('[.cell'), to: t.indexOf(' |b'), role: 'hl-mint' })
    if ('error' in all) throw new Error(all.error)
    expect(all.doc.tableAt(0)!.rows.body[0]!.cells[0]!.fill?.role).toBe('cell-yellow')
    expect(all.doc.text).toBe(r.doc.text)
  })
})
