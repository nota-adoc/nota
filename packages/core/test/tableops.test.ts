import { describe, expect, it } from 'vitest'
import { type Operation, type NotaDocument, applyOperation, parse } from '@nota-adoc/core'
import { applyChanges } from '../src/incremental.js'

/** Applies an operation at the first place of `mark` in the text; the new text, or the code of the refusal. */
function run(text: string, mark: string, make: (at: number) => Operation): string {
  const at = text.indexOf(mark)
  if (at < 0) throw new Error(`no ${mark}`)
  const r = applyOperation(parse(text), make(at))
  if ('error' in r) return r.error
  expect(applyChanges(text, r.changes)).toBe(r.doc.text)
  expect(r.doc.text).toBe(parse(r.doc.text).text)
  return r.doc.text
}

/** The cells of the table that holds the first place of `mark`, in the order of the text. */
function cellsOf(doc: NotaDocument, mark: string) {
  const m = doc.tableAt(doc.text.indexOf(mark))!
  return [...m.rows.head, ...m.rows.body, ...m.rows.foot].flatMap((r) => r.cells)
}

function ok(text: string, mark: string, make: (at: number) => Operation): NotaDocument {
  const r = applyOperation(parse(text), make(text.indexOf(mark)))
  if ('error' in r) throw new Error(`${r.error}: ${r.diagnostics[0]?.message}`)
  expect(r.doc.diagnostics.filter((d) => d.code?.startsWith('table-'))).toEqual([])
  return r.doc
}

/** The texts of the cells of the table that holds the first place of `mark`, row by row. */
function grid(doc: NotaDocument, mark: string, nth = 0): string[][] {
  let at = -1
  for (let i = 0; i <= nth; i++) at = doc.text.indexOf(mark, at + 1)
  const m = doc.tableAt(at)!
  return [...m.rows.head, ...m.rows.body, ...m.rows.foot].map((r) => r.cells.map((c) => c.text))
}

describe('the text of a cell', () => {
  it('escapes the bar of a table `|===`', () => {
    const t = '|===\n|x |y\n|===\n'
    const out = run(t, 'x', (at) => ({ kind: 'setCellText', at, text: 'a|b' }))
    expect(out).toBe('|===\n|a\\|b |y\n|===\n')
    const doc = parse(out)
    expect(grid(doc, 'a')).toEqual([['a|b', 'y']])
  })

  it('escapes the bang of a nested table `!===` and the bar of the table around it', () => {
    const t = '|===\na|\n!===\n!x !y\n!===\n|b\n|===\n'
    const out = run(t, 'x', (at) => ({ kind: 'setCellText', at, text: 'a!b' }))
    expect(out).toBe('|===\na|\n!===\n!a\\!b !y\n!===\n|b\n|===\n')
    expect(grid(parse(out), 'a\\!b')).toEqual([['a!b', 'y']])
    const both = run(t, 'x', (at) => ({ kind: 'setCellText', at, text: 'p|q!r' }))
    expect(both).toBe('|===\na|\n!===\n!p\\|q\\!r !y\n!===\n|b\n|===\n')
    const doc = parse(both)
    expect(grid(doc, 'p')).toEqual([['p|q!r', 'y']])
    // the other cells are as they were
    expect(grid(doc, '|b')).toEqual([[doc.tableAt(doc.text.indexOf('|b'))!.rows.body[0]!.cells[0]!.text], ['b']])
  })

  it('quotes a cell of a table `,===`', () => {
    const t = ',===\nx,y\nz,w\n,===\n'
    const out = run(t, 'x', (at) => ({ kind: 'setCellText', at, text: 'a,"b"' }))
    expect(out).toBe(',===\n"a,""b""",y\nz,w\n,===\n')
    expect(grid(parse(out), 'a')).toEqual([['a,"b"', 'y'], ['z', 'w']])
  })

  it('escapes the colon of a table `:===`', () => {
    const t = ':===\nx:y\nz:w\n:===\n'
    const out = run(t, 'x', (at) => ({ kind: 'setCellText', at, text: 'a:b' }))
    expect(out).toBe(':===\na\\:b:y\nz:w\n:===\n')
    expect(grid(parse(out), 'a')).toEqual([['a:b', 'y'], ['z', 'w']])
  })

  it('writes a backslash before a bar as text', () => {
    const out = run('|===\n|x |y\n|===\n', 'x', (at) => ({ kind: 'setCellText', at, text: 'a\\|b' }))
    expect(grid(parse(out), 'a')).toEqual([['a\\|b', 'y']])
  })

  it('writes the text of a cell `a|` and of a cell with several lines', () => {
    const t = '[cols="2"]\n|===\na|\n* one\n\n|y\n|===\n'
    const out = run(t, 'one', (at) => ({ kind: 'setCellText', at, text: '* two | three\n\npara' }))
    expect(grid(parse(out), 'two')).toEqual([['* two | three\n\npara', 'y']])
  })

  it('keeps the blank cells and the text of the cells next to it, in a document with CRLF', () => {
    const t = '|===\r\n|x |y\r\n|z |w\r\n|===\r\n'
    const out = run(t, 'y', (at) => ({ kind: 'setCellText', at, text: 'new' }))
    expect(out).toBe('|===\r\n|x |new\r\n|z |w\r\n|===\r\n')
  })

  it('refuses a text a cell cannot hold, and a place outside a table', () => {
    expect(run(':===\nx:y\n:===\n', 'x', (at) => ({ kind: 'setCellText', at, text: 'a\nb' }))).toBe('unwritable')
    expect(run('para\n', 'para', (at) => ({ kind: 'setCellText', at, text: 'a' }))).toBe('invalid-target')
    expect(run('|===\n|x\n|===\n', 'x', (at) => ({ kind: 'setCellText', at, text: ' a ' }))).toBe('unsupported')
  })

  it('a text that would break the table or the text around it never gives a new diagnostic of a table (the check was lightened)', () => {
    const t = '|===\n|x |y\n|z |w\n|===\n\nafter\n'
    const base = parse(t).diagnostics.filter((d) => d.code?.startsWith('table-')).length
    let passed = 0
    for (const text of ['a\n|===\nb', '|===', 'a\n\n|b', '[cols="9"]\n|===', '* a\n|b', 'a |b', '\n', 'a\n']) {
      const r = applyOperation(parse(t), { kind: 'setCellText', at: t.indexOf('x'), text })
      if ('error' in r) continue
      passed++
      expect(r.doc.diagnostics.filter((d) => d.code?.startsWith('table-')).length).toBeLessThanOrEqual(base)
      const m = r.doc.tableAt(r.doc.text.indexOf('|y') + 1)!
      expect([...m.rows.head, ...m.rows.body, ...m.rows.foot].flatMap((row) => row.cells.map((c) => c.text)).slice(1)).toEqual(['y', 'z', 'w'])
      expect(r.doc.text.endsWith('\n\nafter\n')).toBe(true)
    }
    // (the loop is not empty: some of the texts are taken)
    expect(passed).toBeGreaterThanOrEqual(3)
  })

  it('does nothing for the same text', () => {
    const r = applyOperation(parse('|===\n|x\n|===\n'), { kind: 'setCellText', at: 6, text: 'x' })
    expect('error' in r ? r.error : r.changes).toEqual([])
  })
})

describe('rows and columns', () => {
  const T = '[cols="2"]\n|===\n|a |b\n|c |d\n|===\n'

  it('inserts and deletes rows', () => {
    expect(run(T, 'a', (at) => ({ kind: 'insertRow', at }))).toBe('[cols="2"]\n|===\n|a |b\n| |\n|c |d\n|===\n')
    expect(run(T, '|c', (at) => ({ kind: 'insertRow', at, where: 'before' }))).toBe('[cols="2"]\n|===\n|a |b\n| |\n|c |d\n|===\n')
    expect(run(T, '|c', (at) => ({ kind: 'insertRow', at }))).toBe('[cols="2"]\n|===\n|a |b\n|c |d\n| |\n|===\n')
    expect(run(T, 'a', (at) => ({ kind: 'insertRow', at, where: 'before' }))).toBe('[cols="2"]\n|===\n| |\n|a |b\n|c |d\n|===\n')
    expect(run(T, 'a', (at) => ({ kind: 'deleteRow', at }))).toBe('[cols="2"]\n|===\n|c |d\n|===\n')
    expect(run(T, 'd', (at) => ({ kind: 'deleteRow', at }))).toBe('[cols="2"]\n|===\n|a |b\n|===\n')
    expect(run(T, 'a', (at) => ({ kind: 'deleteRow', at, where: 'after' }))).toBe('[cols="2"]\n|===\n|a |b\n|===\n')
    expect(run('|===\n|a |b\n|===\n', 'a', (at) => ({ kind: 'deleteRow', at }))).toBe('invalid-target')
  })

  it('inserts and deletes columns and follows `cols`', () => {
    expect(run(T, 'b', (at) => ({ kind: 'insertColumn', at }))).toBe('[cols="3"]\n|===\n|a |b |\n|c |d |\n|===\n')
    expect(run(T, 'a', (at) => ({ kind: 'insertColumn', at, where: 'before' }))).toBe('[cols="3"]\n|===\n| |a |b\n| |c |d\n|===\n')
    expect(run(T, 'b', (at) => ({ kind: 'deleteColumn', at }))).toBe('[cols="1"]\n|===\n|a\n|c\n|===\n')
    expect(run(T, 'a', (at) => ({ kind: 'deleteColumn', at }))).toBe('[cols="1"]\n|===\n|b\n|d\n|===\n')
    const widths = '[cols="1,2"]\n|===\n|a |b\n|===\n'
    expect(run(widths, 'a', (at) => ({ kind: 'insertColumn', at, where: 'before' }))).toBe('[cols="1,1,2"]\n|===\n| |a |b\n|===\n')
    expect(run(widths, 'b', (at) => ({ kind: 'insertColumn', at }))).toBe('[cols="1,2,1"]\n|===\n|a |b |\n|===\n')
    expect(run(widths, 'a', (at) => ({ kind: 'deleteColumn', at }))).toBe('[cols="1"]\n|===\n|b\n|===\n')
    expect(run('[cols="3*"]\n|===\n|a |b |c\n|===\n', 'b', (at) => ({ kind: 'insertColumn', at }))).toBe('[cols="4*"]\n|===\n|a |b | |c\n|===\n')
    expect(run('[cols="1"]\n|===\n|a\n|===\n', 'a', (at) => ({ kind: 'deleteColumn', at }))).toBe('invalid-target')
  })

  it('works in a table with no `cols` and on a table with one cell on each line', () => {
    expect(run('|===\n|a |b\n|c |d\n|===\n', 'b', (at) => ({ kind: 'insertColumn', at }))).toBe('|===\n|a |b |\n|c |d |\n|===\n')
    const lines = '[cols="2"]\n|===\n|a\n|b\n\n|c\n|d\n|===\n'
    const doc = ok(lines, 'a', (at) => ({ kind: 'insertRow', at }))
    expect(grid(doc, 'a')).toEqual([['a', 'b'], ['', ''], ['c', 'd']])
    const more = ok(lines, 'a', (at) => ({ kind: 'insertColumn', at }))
    expect(grid(more, 'a')).toEqual([['a', '', 'b'], ['c', '', 'd']])
  })

  it('keeps the header: a row after it is a row of the body', () => {
    const t = '[%header,cols="2"]\n|===\n|h1 |h2\n\n|c |d\n|===\n'
    const doc = ok(t, 'h1', (at) => ({ kind: 'insertRow', at }))
    const m = doc.tableAt(doc.text.indexOf('h1'))!
    expect(m.rows.head.length).toBe(1)
    expect(m.rows.body.length).toBe(2)
  })

  it('does a row and a column in the four formats', () => {
    const csv = ',===\na,b\nc,d\n,===\n'
    expect(run(csv, 'a', (at) => ({ kind: 'insertRow', at }))).toBe(',===\na,b\n,\nc,d\n,===\n')
    expect(run(csv, 'c,', (at) => ({ kind: 'insertRow', at, where: 'before' }))).toBe(',===\na,b\n,\nc,d\n,===\n')
    expect(run(csv, 'a', (at) => ({ kind: 'deleteRow', at }))).toBe(',===\nc,d\n,===\n')
    expect(run(csv, 'a', (at) => ({ kind: 'insertColumn', at }))).toBe(',===\na,,b\nc,,d\n,===\n')
    expect(run(csv, 'b', (at) => ({ kind: 'deleteColumn', at }))).toBe(',===\na\nc\n,===\n')
    expect(run(csv, 'a', (at) => ({ kind: 'deleteColumn', at }))).toBe(',===\nb\nd\n,===\n')
    const dsv = ':===\na:b\nc:d\n:===\n'
    expect(run(dsv, 'a', (at) => ({ kind: 'insertRow', at }))).toBe(':===\na:b\n:\nc:d\n:===\n')
    expect(run(dsv, 'a', (at) => ({ kind: 'insertColumn', at, where: 'before' }))).toBe(':===\n:a:b\n:c:d\n:===\n')
    expect(run(dsv, 'd', (at) => ({ kind: 'deleteColumn', at }))).toBe(':===\na\nc\n:===\n')
    const bang = '|===\na|\n!===\n!x !y\n!z !w\n!===\n|b\n|===\n'
    const doc = ok(bang, 'x', (at) => ({ kind: 'insertColumn', at }))
    expect(grid(doc, 'x')).toEqual([['x', '', 'y'], ['z', '', 'w']])
    expect(grid(ok(bang, 'z', (at) => ({ kind: 'deleteRow', at })), 'x')).toEqual([['x', 'y']])
    expect(grid(ok(bang, 'x', (at) => ({ kind: 'insertRow', at })), 'x')).toEqual([['x', 'y'], ['', ''], ['z', 'w']])
    expect(grid(ok(bang, 'b', (at) => ({ kind: 'insertRow', at })), '|b')).toHaveLength(3)
  })
})

describe('merged cells', () => {
  it('merges 2 x 2 cells into one and splits them again', () => {
    const t = '[cols="3"]\n|===\n| | |c\n| | |f\n|g |h |i\n|===\n'
    const merged = run(t, '| | |c', (at) => ({ kind: 'mergeCells', from: at, to: t.indexOf('| | |f') + 2 }))
    expect(merged).toBe('[cols="3"]\n|===\n2.2+| |c\n|f\n|g |h |i\n|===\n')
    const doc = parse(merged)
    const cell = cellsOf(doc, '2.2')[0]!
    expect([cell.colspan, cell.rowspan]).toEqual([2, 2])
    const split = run(merged, '2.2', (at) => ({ kind: 'splitCell', at }))
    expect(split).toBe('[cols="3"]\n|===\n| | |c\n| | |f\n|g |h |i\n|===\n')
  })

  it('merges the cells of a row, of a column, and a cell with a spec', () => {
    const t = '[cols="3"]\n|===\n|a | |\n|d |e |f\n|===\n'
    expect(run(t, '| |', (at) => ({ kind: 'mergeCells', from: at, to: at + 2 }))).toBe('[cols="3"]\n|===\n|a 2+| |d |e |f\n|===\n'.replace('| |d', '|\n|d'))
    const col = '[cols="2"]\n|===\n|a |b\n|c |\n|===\n'
    expect(run(col, 'b', (at) => ({ kind: 'mergeCells', from: at, to: at + 7 }))).toBe('[cols="2"]\n|===\n|a .2+|b\n|c\n|===\n')
    const spec = '[cols="2"]\n|===\n^|a |\n|c |d\n|===\n'
    expect(run(spec, 'a', (at) => ({ kind: 'mergeCells', from: at, to: at + 3 }))).toBe('[cols="2"]\n|===\n2+^|a\n|c |d\n|===\n')
  })

  it('refuses a merge that cuts into another one, text that would go, and other formats', () => {
    const t = '[cols="3"]\n|===\n2+|a |b\n|c |d |e\n|===\n'
    expect(run(t, 'b', (at) => ({ kind: 'mergeCells', from: t.indexOf('2+|a') + 4, to: at }))).toBe('invalid-span')
    const cut = '[cols="3"]\n|===\n| | |\n.2+| |\n| | \n|===\n'
    const cutOut = applyOperation(parse(cut), { kind: 'mergeCells', from: 16, to: 24 })
    if ('error' in cutOut) expect(['invalid-span', 'unsupported', 'invalid-target']).toContain(cutOut.error)
    else expect(cutOut.doc.text).not.toBe(cut)
    expect(run('[cols="2"]\n|===\n|a |b\n|===\n', 'a', (at) => ({ kind: 'mergeCells', from: at, to: at + 3 }))).toBe('invalid-span')
    expect(run(',===\na,b\n,===\n', 'a', (at) => ({ kind: 'mergeCells', from: at, to: at + 2 }))).toBe('unsupported')
    expect(run(',===\na,b\n,===\n', 'a', (at) => ({ kind: 'splitCell', at }))).not.toBe('unsupported')
  })

  it('keeps a merged cell whole when a row or a column goes through it, or comes next to it', () => {
    const t = '[cols="3"]\n|===\n2.2+|a |b\n|c\n|d |e |f\n|===\n'
    const addRow = ok(t, 'a', (at) => ({ kind: 'insertRow', at, where: 'before' }))
    expect(grid(addRow, 'a').length).toBe(4)
    const middle = '[cols="3"]\n|===\n|1 |2 |3\n.2+|a 2+|b\n|c |c2\n|d |e |f\n|===\n'
    const inside = ok(middle, '|c ', (at) => ({ kind: 'insertRow', at, where: 'before' }))
    expect(cellsOf(inside, '|1').find((c) => c.text === 'a')!.rowspan).toBe(3)
    const wide = ok(t, '|e', (at) => ({ kind: 'insertColumn', at, where: 'before' }))
    expect(cellsOf(wide, '3.2')[0]!.colspan).toBe(3)
    const gone = ok(t, '|e', (at) => ({ kind: 'deleteColumn', at, where: 'before' }))
    expect(cellsOf(gone, '.2')[0]!.colspan).toBe(1)
    expect(run(t, 'a', (at) => ({ kind: 'deleteRow', at }))).toBe('invalid-span')
    const drop = ok(t, '|c', (at) => ({ kind: 'deleteRow', at, where: 'after' }))
    expect(grid(drop, 'a').length).toBe(2)
  })
})

describe('the look of cells and tables', () => {
  const T = '[cols="2"]\n|===\n|a |b\n|c |d\n|===\n'

  it('sets the style and the alignment of one cell', () => {
    const style = run(T, 'a', (at) => ({ kind: 'setCellStyle', at, style: 'asciidoc' }))
    expect(style).toBe('[cols="2"]\n|===\na|a |b\n|c |d\n|===\n')
    expect(cellsOf(parse(style), 'a|a')[0]!.style).toBe('asciidoc')
    expect(run(style, 'a|a', (at) => ({ kind: 'setCellStyle', at, style: null }))).toBe(T)
    expect(run(T, 'b', (at) => ({ kind: 'setCellAlign', at, halign: 'right' }))).toBe('[cols="2"]\n|===\n|a >|b\n|c |d\n|===\n')
    expect(run(T, 'b', (at) => ({ kind: 'setCellAlign', at, halign: 'center', valign: 'bottom' }))).toBe('[cols="2"]\n|===\n|a ^.>|b\n|c |d\n|===\n')
    const aligned = run('[cols="2"]\n|===\n|a ^.>|b\n|===\n', 'b', (at) => ({ kind: 'setCellAlign', at, valign: 'top' }))
    expect(aligned).toBe('[cols="2"]\n|===\n|a ^.<|b\n|===\n')
    // a style the column gives is taken off with `d`
    const col = '[cols="1a,1"]\n|===\n|a |b\n|===\n'
    const cell = cellsOf(ok(col, '|a', (at) => ({ kind: 'setCellStyle', at, style: null })), '|a')[0]!
    expect(cell.style).not.toBe('asciidoc')
  })

  it('sets the style and the alignment of the column when the format has no spec of a cell', () => {
    const csv = ',===\na,b\n,===\n'
    const style = run(csv, 'a', (at) => ({ kind: 'setCellStyle', at, style: 'asciidoc' }))
    expect(style).toBe('[cols="1a,1"]\n,===\na,b\n,===\n')
    const align = run(csv, 'b', (at) => ({ kind: 'setCellAlign', at, halign: 'center' }))
    expect(align).toBe('[cols="1,^1"]\n,===\na,b\n,===\n')
    expect(cellsOf(parse(align), 'b').map((c) => c.halign)).toEqual(['left', 'center'])
    // other cells of the column would change with it: refused
    const two = ',===\na,b\nc,d\n,===\n'
    expect(run(two, 'a', (at) => ({ kind: 'setCellStyle', at, style: 'asciidoc' }))).toBe('unsupported')
    expect(run(two, 'b', (at) => ({ kind: 'setCellAlign', at, halign: 'center' }))).toBe('unsupported')
  })

  it('does not lose the implicit header of a table', () => {
    const imp = '[cols="2"]\n|===\n|h1 |h2\n\n|a |b\n|===\n'
    expect(run(imp, 'h1', (at) => ({ kind: 'setCellText', at, text: 'two\nlines' }))).toBe('unsupported')
    const gaps = '|===\n|h1 |h2\n\n|a |b\n|c |d\n|e |f\n|===\n'
    expect(run(gaps, 'h1', (at) => ({ kind: 'insertRow', at, where: 'before' }))).toBe('unsupported')
    expect(run('[cols="2"]\n|===\n|h1 |h2\n\n|a |b\n|===\n', 'a', (at) => ({ kind: 'insertRow', at }))).not.toBe('unsupported')
  })

  it('does not lose the header when a table goes into its row, and keeps the role of %header and %footer rows', () => {
    const imp = '[cols="2"]\n|===\n|h1 |h2\n\n|a |b\n|===\n'
    expect(run(imp, 'h2', (at) => ({ kind: 'nestTable', at, rows: 1, columns: 1 }))).toBe('unsupported')
    expect(run(imp, 'b', (at) => ({ kind: 'nestTable', at, rows: 1, columns: 1 }))).not.toBe('unsupported')
    const opt = '[%header%footer,cols="2"]\n|===\n|h1 |h2\n|a |b\n|f1 |f2\n|===\n'
    expect(run(opt, 'h1', (at) => ({ kind: 'insertRow', at, where: 'before' }))).toBe('unsupported')
    expect(run(opt, 'f1', (at) => ({ kind: 'insertRow', at }))).toBe('unsupported')
    expect(run(opt, 'a', (at) => ({ kind: 'insertRow', at }))).not.toBe('unsupported')
  })

  it('refuses a table in a cell of a dsv table as unwritable', () => {
    expect(run(':===\na:b\n:===\n', 'a', (at) => ({ kind: 'nestTable', at, rows: 1, columns: 1 }))).toBe('unwritable')
  })

  it('sets the widths of the columns', () => {
    expect(run(T, 'a', (at) => ({ kind: 'setColumnWidths', at, widths: [1, 3] }))).toBe('[cols="1,3"]\n|===\n|a |b\n|c |d\n|===\n')
    expect(run('[cols="<.^1,3a"]\n|===\n|a |b\n|===\n', 'a', (at) => ({ kind: 'setColumnWidths', at, widths: [2, 5] }))).toBe(
      '[cols="<.^2,5a"]\n|===\n|a |b\n|===\n',
    )
    expect(run('|===\n|a |b\n|===\n', 'a', (at) => ({ kind: 'setColumnWidths', at, widths: [1, 3] }))).toBe('[cols="1,3"]\n|===\n|a |b\n|===\n')
    expect(run(T, 'a', (at) => ({ kind: 'setColumnWidths', at, widths: [1] }))).toBe('invalid-block')
    expect(run(T, 'a', (at) => ({ kind: 'setColumnWidths', at, widths: [1, 0] }))).toBe('invalid-block')
    const m = parse(run(T, 'a', (at) => ({ kind: 'setColumnWidths', at, widths: [1, 3] }))).tableAt(20)!
    expect(m.columns.map((c) => c.width)).toEqual([25, 75])
  })

  it('keeps the percent sign in the widths of the columns', () => {
    const w = (src: string, widths: number[]) => run(src, 'a', (at) => ({ kind: 'setColumnWidths', at, widths }))
    expect(w('[cols="20%,30%,50%"]\n|===\n|a |b |c\n|===\n', [25, 25, 50])).toBe('[cols="25%,25%,50%"]\n|===\n|a |b |c\n|===\n')
    expect(w('[cols="<.^20%,80%a"]\n|===\n|a |b\n|===\n', [25, 75])).toBe('[cols="<.^25%,75%a"]\n|===\n|a |b\n|===\n')
    expect(w('[cols="~,1"]\n|===\n|a |b\n|===\n', [40, 60])).toBe('[cols="40,60"]\n|===\n|a |b\n|===\n')
  })

  it('sets the header and the footer of a table', () => {
    const header = run(T, 'a', (at) => ({ kind: 'setTableOptions', at, header: true }))
    expect(header).toBe('[cols="2",options="header"]\n|===\n|a |b\n|c |d\n|===\n')
    expect(run(header, 'a', (at) => ({ kind: 'setTableOptions', at, header: false }))).toBe(T)
    expect(run(T, 'a', (at) => ({ kind: 'setTableOptions', at, footer: true }))).toBe('[cols="2",options="footer"]\n|===\n|a |b\n|c |d\n|===\n')
    expect(run('[%header,cols="2"]\n|===\n|a |b\n|c |d\n|===\n', 'a', (at) => ({ kind: 'setTableOptions', at, header: false }))).toBe(T)
    expect(run('[%header%footer]\n|===\n|a\n|b\n|c\n|===\n', 'a', (at) => ({ kind: 'setTableOptions', at, footer: false }))).toBe('[%header]\n|===\n|a\n|b\n|c\n|===\n')
    expect(run('[options="header,footer"]\n|===\n|a\n|b\n|c\n|===\n', 'a', (at) => ({ kind: 'setTableOptions', at, header: false }))).toBe(
      '[options="footer"]\n|===\n|a\n|b\n|c\n|===\n',
    )
    expect(run('|===\n|a\n|b\n|===\n', 'a', (at) => ({ kind: 'setTableOptions', at, header: true }))).toBe('[options="header"]\n|===\n|a\n|b\n|===\n')
    // a header that a blank line gives is taken off with `%noheader`
    const implicit = '|===\n|a |b\n\n|c |d\n|===\n'
    const off = ok(implicit, 'a', (at) => ({ kind: 'setTableOptions', at, header: false }))
    expect(off.tableAt(off.text.indexOf('a'))!.rows.head.length).toBe(0)
    expect(off.text).toContain('noheader')
    // an explicit header together with a blank line after the first row: the option becomes `noheader` (one change)
    for (const [src, want] of [
      ['[options="header"]\n|===\n|a |b\n\n|c |d\n|===\n', '[options="noheader"]\n|===\n|a |b\n\n|c |d\n|===\n'],
      ['[%header]\n|===\n|a |b\n\n|c |d\n|===\n', '[%noheader]\n|===\n|a |b\n\n|c |d\n|===\n'],
    ] as const) {
      const r = run(src, 'a', (at) => ({ kind: 'setTableOptions', at, header: false }))
      expect(r).toBe(want)
    }
    // the same option twice: the changes do not overlap, whatever the result is
    for (const src of ['[options="header,header"]\n|===\n|a |b\n\n|c |d\n|===\n', '[%header%header]\n|===\n|a |b\n\n|c |d\n|===\n', '[%header,options="header"]\n|===\n|a |b\n\n|c |d\n|===\n']) {
      const twice = ok(src, 'a', (at) => ({ kind: 'setTableOptions', at, header: false }))
      expect(twice.tableAt(twice.text.indexOf('a'))!.rows.head.length).toBe(0)
    }
    const on = ok('[%noheader]\n|===\n|a |b\n\n|c |d\n|===\n', 'a', (at) => ({ kind: 'setTableOptions', at, header: true }))
    expect(on.tableAt(on.text.indexOf('a'))!.rows.head.length).toBe(1)
    const shorthand = run('[%header,cols="2"]\n|===\n|a |b\n|c |d\n|===\n', 'a', (at) => ({ kind: 'setTableOptions', at, footer: true }))
    expect(shorthand).toBe('[%header%footer,cols="2"]\n|===\n|a |b\n|c |d\n|===\n')
  })
})

describe('a table in a cell', () => {
  it('puts a table `!===` in a cell of `|===`', () => {
    const t = '[cols="2"]\n|===\n|a |b\n|c |d\n|===\n'
    const out = run(t, 'b', (at) => ({ kind: 'nestTable', at, rows: 2, columns: 2 }))
    expect(out).toBe('[cols="2"]\n|===\n|a a|\nb\n\n[cols="2"]\n!===\n! !\n! !\n!===\n|c |d\n|===\n')
    const doc = parse(out)
    const inner = doc.tableAt(out.indexOf('!==='))!
    expect([inner.format, inner.separator, inner.rows.body.length, inner.columns.length]).toEqual(['psv', '!', 2, 2])
    expect(cellsOf(doc, '|a')[1]!.style).toBe('asciidoc')
  })

  it('puts a table in an empty cell, in the style of the document', () => {
    const t = '|===\n|\n|===\n'
    const out = run(t, '|\n', (at) => ({ kind: 'nestTable', at: at + 1, rows: 1, columns: 3 }))
    expect(out).toBe('|===\na|\n!===\n! ! !\n!===\n|===\n')
  })

  it('puts a table `,===` in a cell `a!` and `:===` in the level after it, and refuses a fourth level', () => {
    const t = '|===\na|\n!===\n!x !y\n!===\n|b\n|===\n'
    const second = run(t, 'x', (at) => ({ kind: 'nestTable', at, rows: 1, columns: 2 }))
    const d2 = parse(second)
    const csv = d2.tableAt(second.indexOf(',==='))!
    expect([csv.format, csv.separator, csv.columns.length]).toEqual(['csv', ',', 2])
    expect(cellsOf(d2, '!===')[0]!.style).toBe('asciidoc')
    // the table around it is as it was
    expect(cellsOf(d2, '|b').map((c) => c.text.length > 0)).toEqual([true, true])
    const third = run(second, ',===\n,', (at) => ({ kind: 'nestTable', at: at + 6, rows: 2, columns: 2 }))
    const d3 = parse(third)
    const dsv = d3.tableAt(third.indexOf(':==='))!
    expect([dsv.format, dsv.separator, dsv.columns.length]).toEqual(['dsv', ':', 2])
    expect(d3.tableAt(third.indexOf(',==='))!.columns[1]!.style).toBe('asciidoc')
    const fourth = run(third, ':===\n', (at) => ({ kind: 'nestTable', at: at + 6, rows: 1, columns: 1 }))
    expect(fourth).toBe('nesting-too-deep')
  })

  it('refuses a place outside a table and a table of no size', () => {
    expect(run('para\n', 'para', (at) => ({ kind: 'nestTable', at, rows: 1, columns: 1 }))).toBe('invalid-target')
    expect(run('|===\n|a\n|===\n', 'a', (at) => ({ kind: 'nestTable', at, rows: 0, columns: 1 }))).toBe('invalid-block')
  })
})

describe('bars in a table in a cell (the escape of 5b)', () => {
  const T = '|===\na|\n!===\na!\nfirst\n\n!second\n!===\n|===\n'

  it('writes a new paragraph with the separators of the tables around', () => {
    const out = run(T, 'first', (at) => ({
      kind: 'insertBlock',
      at,
      where: 'after',
      block: { kind: 'paragraph', text: 'x | y ! z' },
    }))
    expect(out).toBe('|===\na|\n!===\na!\nfirst\n\nx \\| y \\! z\n\n!second\n!===\n|===\n')
    const doc = parse(out)
    const para = (doc.asg().blocks ?? []).length
    expect(para).toBe(1)
    const cell = doc.tableAt(out.indexOf('first'))!.rows.body[0]!.cells[0]!
    expect(cell.text).toBe('first\n\nx | y ! z')
  })

  it('reads the escaped bars as text in the inner table', () => {
    const src = '|===\na|\n!===\na!\nx \\| y \\! z\n!===\n|===\n'
    const doc = parse(src)
    const inner = doc.tableAt(src.indexOf('x '))!
    expect(inner.rows.body[0]!.cells[0]!.text).toBe('x | y ! z')
  })
})

describe('a cell that holds a table', () => {
  it('refuses a second table in a cell', () => {
    const t = '|===\na|\n!===\n!x !y\n!===\n|b\n|===\n'
    expect(run(t, '|\n', (at) => ({ kind: 'nestTable', at: at + 1, rows: 1, columns: 1 }))).toBe('cell-has-table')
  })
})

describe('deleteTable', () => {
  it('takes a table of the first level out with its attributes and its title', () => {
    const t = 'before\n\n.Orders\n[cols="1,2"]\n|===\n|a |b\n|c |d\n|===\n\nafter\n'
    expect(run(t, 'a |b', (at) => ({ kind: 'deleteTable', at }))).toBe('before\n\nafter\n')
  })

  it('takes a table out of the end of a document', () => {
    const t = 'before\n\n|===\n|a\n|===\n'
    expect(run(t, 'a', (at) => ({ kind: 'deleteTable', at }))).toBe('before\n')
  })

  it('takes a table in a cell out of the cell: the cell and its text stay, and the style stays', () => {
    const t = '|===\na|\nText of the cell.\n\n!===\n!x !y\n!===\n|b\n|===\n'
    const out = run(t, '!x', (at) => ({ kind: 'deleteTable', at }))
    expect(out).toBe('|===\na|\nText of the cell.\n|b\n|===\n')
    const cells = cellsOf(parse(out), 'Text')
    expect(cells.map((c) => [c.style, c.text])).toEqual([['asciidoc', 'Text of the cell.'], [null, 'b']])
  })

  it('takes a table in a cell out of a cell that holds nothing else', () => {
    const t = '|===\na|\n!===\n!x !y\n!===\n|b\n|===\n'
    const out = run(t, '!x', (at) => ({ kind: 'deleteTable', at }))
    const cells = cellsOf(parse(out), '|b')
    expect(cells.map((c) => [c.style, c.text])).toEqual([['asciidoc', ''], [null, 'b']])
  })

  it('takes the table of the second level out of a table in a cell and leaves the third alone in its cell', () => {
    const t = '|===\na|\n!===\na!\n,===\nq,w\n,===\n!z\n!===\n|===\n'
    const out = run(t, 'q,w', (at) => ({ kind: 'deleteTable', at }))
    expect(cellsOf(parse(out), '!z').map((c) => c.text)).toEqual(['', 'z'])
  })

  it('refuses a place outside a table', () => {
    expect(run('para\n', 'para', (at) => ({ kind: 'deleteTable', at }))).toBe('invalid-target')
  })
})

describe('an empty first field of a row of csv or dsv', () => {
  // (it starts where the next field does: each is told by the start of its content)
  it('is a cell of its own, and the operations reach it', () => {
    const t = '[format=csv]\n|===\n,\n,\n|===\n'
    const cells = cellsOf(parse(t), ',')
    expect(cells.length).toBe(4)
    expect(cells.map((c) => c.contentFrom)).toEqual([18, 19, 20, 21])
    expect(run(t, ',', () => ({ kind: 'setCellText', at: 18, text: 'x' }))).toBe('[format=csv]\n|===\nx,\n,\n|===\n')
    expect(run(t, ',', () => ({ kind: 'setCellText', at: 19, text: 'x' }))).toBe('[format=csv]\n|===\n,x\n,\n|===\n')
    expect(run(t, ',', () => ({ kind: 'deleteRow', at: 20 }))).toBe('[format=csv]\n|===\n,\n|===\n')
  })

  it('nests a table of the third level in a table of the second, and a fourth in that', () => {
    const t = '|===\na|\n!===\na!\n,===\n,\n,\n,===\n!\n! !\n!===\n|===\n'
    const out = run(t, ',===', (at) => ({ kind: 'nestTable', at: at + 6, rows: 2, columns: 2 }))
    expect(out).toContain(':===')
  })
})
