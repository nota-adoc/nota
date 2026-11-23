// the tables the visual editor shows as grids, and the operations on them at every level, with their undo.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { type Operation, applyOperation, createSession, parse } from '@nota-adoc/core'
import { type TableView, layoutItems, readLayout, tableViewAt } from '@nota-adoc/core/internal'

const fixture = (name: string): string =>
  readFileSync(new URL(`../../../quality/fixtures/editor/${name}`, import.meta.url), 'utf8')

const TABLES = fixture('tables.adoc')
const NESTED = fixture('tables-nested.adoc')

/** Every table of a view with the tables in its cells, outermost first. */
function allTables(v: TableView): TableView[] {
  const out = [v]
  for (const row of v.rows)
    for (const c of row) for (const b of c.blocks) if (b.kind === 'table') out.push(...allTables(b.table))
  return out
}

function tablesOf(text: string): TableView[] {
  const doc = parse(text)
  return layoutItems(readLayout(doc))
    .filter((it) => it.kind === 'table')
    .flatMap((it) => allTables(tableViewAt(doc, it.from)!))
}

describe('the layout of tables', () => {
  it('shows the tables that can be written back as tables and the others as plates', () => {
    const doc = parse(TABLES)
    const kinds = layoutItems(readLayout(doc))
      .filter((it) => it.kind === 'table' || it.kind === 'chip')
      .map((it) => it.kind)
    // 'Orders', 'Status', (the one with `2*`: a plate), CSV, DSV, the bars, the cells with blocks
    expect(kinds).toEqual(['table', 'table', 'chip', 'table', 'table', 'table', 'table'])
  })

  it('reads the head, the widths and the spans of a table', () => {
    const orders = tablesOf(TABLES)[0]!
    expect([orders.level, orders.nrows, orders.ncols, orders.headRows, orders.caption]).toEqual([
      1,
      3,
      3,
      1,
      'Заказы',
    ])
    expect(orders.widths.map(Math.round)).toEqual([20, 60, 20])
    expect(orders.rows[1]![2]!.halign).toBe('right')
    expect(orders.rows[0]!.every((c) => c.head)).toBe(true)
  })

  it('reads a table in the cell of a table down to the fourth level', () => {
    const levels = tablesOf(NESTED).map((t) => [t.level, t.format])
    expect(levels).toEqual([
      [1, 'psv'],
      [2, 'psv'],
      [3, 'csv'],
      [4, 'dsv'],
    ])
  })

  it('shows a paragraph of an `a` cell as text and a list or code as source', () => {
    const cells = tablesOf(TABLES).flatMap((t) => t.rows.flat())
    const list = cells.find((c) => c.text.startsWith('* первый'))!
    expect(list.blocks.map((b) => b.kind)).toEqual(['plate'])
    const code = cells.find((c) => c.text.startsWith('[source'))!
    expect(code.blocks.map((b) => b.kind)).toEqual(['plate'])
    const host = cells.find((c) => c.text.startsWith('Внутри ячейки:'))!
    expect(host.blocks.map((b) => b.kind)).toEqual(['text', 'table'])
  })
})

/** The operations on the cells of a table of any level, each with the place of a cell that holds it. */
function commands(v: TableView): { name: string; op: Operation }[] {
  const cell =
    v.rows.flat().find((c) => !c.head && c.blocks.every((b) => b.kind === 'text')) ?? v.rows[0]![0]!
  const first = v.rows[0]![0]!
  const out: { name: string; op: Operation }[] = [
    { name: 'setCellText', op: { kind: 'setCellText', at: cell.from, text: 'новый текст' } },
    { name: 'insertRow', op: { kind: 'insertRow', at: cell.from, where: 'after' } },
    { name: 'insertColumn', op: { kind: 'insertColumn', at: cell.from, where: 'after' } },
    { name: 'deleteRow', op: { kind: 'deleteRow', at: v.rows[v.nrows - 1]![0]!.from } },
    { name: 'deleteColumn', op: { kind: 'deleteColumn', at: first.from } },
    { name: 'setTableOptions', op: { kind: 'setTableOptions', at: first.from, header: v.headRows === 0 } },
    { name: 'deleteTable', op: { kind: 'deleteTable', at: first.from } },
  ]
  if (v.format === 'psv' && v.ncols > 1 && v.nrows > 1 && v.level < 3) {
    // two cells side by side: the right one empty when the table has such a pair, else the last row
    const flat = v.rows.flatMap((row) => row.slice(1).map((b, i) => [row[i]!, b] as const))
    const pair =
      flat.find(([a, b]) => !a.head && !b.head && a.rowspan === 1 && b.rowspan === 1 && b.text.trim() === '') ??
      ([v.rows[v.nrows - 1]![0]!, v.rows[v.nrows - 1]![1]!] as const)
    out.push({ name: 'mergeCells', op: { kind: 'mergeCells', from: pair[0].from, to: pair[1].from } })
  }
  const merged = v.rows.flat().find((c) => c.colspan > 1 || c.rowspan > 1)
  if (merged) out.push({ name: 'splitCell', op: { kind: 'splitCell', at: merged.from } })
  const bare = v.rows.flat().find((c) => !c.head && c.blocks.every((b) => b.kind === 'text'))
  if (bare && v.level < 4)
    out.push({ name: 'nestTable', op: { kind: 'nestTable', at: bare.from, rows: 2, columns: 2 } })
  return out
}

// The commands that these tables refuse, with the reason: the cells of the fixtures all have text, some tables have
// merged cells or cells that the operation cannot rewrite. A refusal that is not here, or for another reason, fails.
const REFUSED: Record<string, string> = {
  'tables.adoc:mergeCells:1': 'invalid-span',
  'tables.adoc:mergeCells:2': 'invalid-span',
  'tables.adoc:mergeCells:5': 'invalid-span',
  'tables.adoc:mergeCells:6': 'invalid-span',
  'tables.adoc:mergeCells:7': 'invalid-span',
  'tables.adoc:insertColumn:2': 'unsupported',
  'tables.adoc:insertColumn:7': 'unsupported',
  'tables.adoc:nestTable:4': 'unwritable',
  'tables-nested.adoc:deleteRow:1': 'unsupported',
  'tables-nested.adoc:deleteRow:2': 'unsupported',
  'tables-nested.adoc:deleteRow:3': 'unsupported',
  'tables-nested.adoc:deleteRow:4': 'invalid-target',
  'tables-nested.adoc:mergeCells:1': 'invalid-span',
  'tables-nested.adoc:mergeCells:2': 'invalid-span',
}

describe('a command and one undo give the text back byte for byte', () => {
  for (const [file, text] of [
    ['tables.adoc', TABLES],
    ['tables-nested.adoc', NESTED],
  ] as const) {
    const views = tablesOf(text)
    views.forEach((v, n) => {
      for (const { name, op } of commands(v)) {
        it(`${file}: ${name} on table ${n + 1} (level ${v.level}, ${v.format})`, () => {
          const r = applyOperation(parse(text), op)
          // (a command that the table refuses is named in REFUSED; any other refusal is a failure)
          if ('error' in r) {
            expect(REFUSED[`${file}:${name}:${n + 1}`]).toBe(r.error)
            expect(applyOperation(parse(text), op)).toEqual(r)
            return
          }
          expect(REFUSED[`${file}:${name}:${n + 1}`]).toBeUndefined()
          expect(r.changes.length).toBeGreaterThan(0)
          const session = createSession(text)
          session.apply(r.changes, { group: false })
          expect(session.text).toBe(r.doc.text)
          expect(session.text).not.toBe(text)
          expect(session.undo()).toBe(true)
          expect(session.text).toBe(text)
          expect(session.redo()).toBe(true)
          expect(session.text).toBe(r.doc.text)
        })
      }
    })
  }

  it('merges and splits cells, and one undo gives the text back (splitCell has no merged cell in the fixtures)', () => {
    const text = '|===\n|a |b\n\n.2+|c |d\n|e\n2+|f\n|===\n'
    const v = tablesOf(text)[0]!
    const merged = v.rows.flat().filter((c) => c.colspan > 1 || c.rowspan > 1)
    expect(merged.length).toBe(2)
    for (const c of merged) {
      const r = applyOperation(parse(text), { kind: 'splitCell', at: c.from })
      if ('error' in r) throw new Error(`splitCell refused: ${r.error}`)
      const session = createSession(text)
      session.apply(r.changes, { group: false })
      expect(session.text).toBe(r.doc.text)
      expect(session.text).not.toBe(text)
      expect(session.undo()).toBe(true)
      expect(session.text).toBe(text)
    }
  })

  // a command that succeeds, the text after it, one undo, one redo
  function roundTrip(text: string, op: Operation): string {
    const r = applyOperation(parse(text), op)
    if ('error' in r) throw new Error(`${op.kind} refused: ${r.error}`)
    const session = createSession(text)
    session.apply(r.changes, { group: false })
    expect(session.text).toBe(r.doc.text)
    expect(session.text).not.toBe(text)
    expect(session.undo()).toBe(true)
    expect(session.text).toBe(text)
    expect(session.redo()).toBe(true)
    expect(session.text).toBe(r.doc.text)
    return r.doc.text
  }

  // tables with no blank line after the first row (so without a head) and with an empty cell to merge into, three levels
  const PLAIN =
    '[cols="1,1a"]\n|===\n|a1 |\n|a2\n|\n[cols="1,1a"]\n!===\n!b1 !\n!b2\n!\n[cols="1,1"]\n,===\nc1,\nc2,c3\nc4,c5\n,===\n!===\n|===\n'

  it('merges cells with the empty one on its right, at every level of PSV and DSV, and one undo gives the text back', () => {
    const views = tablesOf(PLAIN)
    expect(views.map((v) => v.level)).toEqual([1, 2, 3])
    let merged = 0
    for (const v of views) {
      const flat = v.rows.flatMap((row) => row.slice(1).map((b, i) => [row[i]!, b] as const))
      const pair = flat.find(([a, b]) => a.text.trim() !== '' && b.text.trim() === '' && a.rowspan === 1 && b.rowspan === 1)
      if (v.level === 3) {
        // (a table of CSV is not merged: the refusal is the one to expect)
        expect(applyOperation(parse(PLAIN), { kind: 'mergeCells', from: v.rows[0]![0]!.from, to: v.rows[0]![1]!.from })).toHaveProperty('error')
        continue
      }
      expect(pair).toBeDefined()
      const after = roundTrip(PLAIN, { kind: 'mergeCells', from: pair![0].from, to: pair![1].from })
      expect(tablesOf(after)[v.level - 1]!.rows.flat().some((c) => c.colspan === 2)).toBe(true)
      merged++
    }
    expect(merged).toBe(2)
  })

  it('deletes a row of a nested table at the levels 1 to 3, and one undo gives the text back', () => {
    for (const v of tablesOf(PLAIN)) {
      const row = v.rows[v.nrows - 1]!
      const after = roundTrip(PLAIN, { kind: 'deleteRow', at: row[0]!.from })
      expect(tablesOf(after)[v.level - 1]!.nrows).toBe(v.nrows - 1)
    }
  })

  it('does something at every level for the commands that every table takes', () => {
    const done = new Set<string>()
    for (const v of tablesOf(NESTED)) {
      for (const { name, op } of commands(v)) {
        if (!('error' in applyOperation(parse(NESTED), op))) done.add(`${v.level}:${name}`)
      }
    }
    for (const level of [1, 2, 3, 4])
      for (const name of ['setCellText', 'insertRow', 'insertColumn', 'deleteColumn', 'setTableOptions', 'deleteTable'])
        expect(done).toContain(`${level}:${name}`)
  })
})
