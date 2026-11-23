import { describe, expect, it } from 'vitest'
import { parse } from '@nota-adoc/core'
import { notaDump } from './nota-dump.js'

const tableOf = (text: string) => notaDump(parse(text), 'x.adoc').nodes!.find((n) => n.context === 'table')!

describe('the table in the dump of Nota', () => {
  it('has the columns, the rows of the head and the body, and the cells with the layout applied', () => {
    const t = tableOf('[cols="1,2",options="header"]\n|===\n|Name |Value\n2+^.>s|wide\n|===\n')
    const layout = t.table!
    expect(layout.columns.map((c) => c.width)).toEqual([33.3333, 66.6667])
    expect(layout.rows.head.map((r) => r.map((c) => c.text))).toEqual([['Name', 'Value']])
    const wide = layout.rows.body[0]![0]!
    expect(wide).toMatchObject({
      row: 1,
      column: 0,
      colspan: 2,
      rowspan: 1,
      halign: 'center',
      valign: 'bottom',
    })
    expect(wide.style).toBe('strong')
    expect(wide.text).toBe('wide')
  })

  it('has the blocks of an asciidoc cell, over the lines of the file', () => {
    const t = tableOf('|===\na|Text in a cell\n\n* item\n|===\n')
    const cell = t.table!.rows.body[0]![0]!
    expect(cell.style).toBe('asciidoc')
    expect(cell.blocks!.filter((b) => b.context !== 'list_item').map((b) => [b.context, b.line])).toEqual([
      ['paragraph', 2],
      ['ulist', 4],
    ])
  })

  it('has the blocks of a table in a cell, four levels deep', () => {
    const t = tableOf(
      [
        '|===',
        'a|',
        '!===',
        'a!',
        '[cols="a"]',
        ',===',
        '"[cols=a,format=psv,separator=:]',
        ':===',
        ':x:y',
        ':==="',
        ',===',
        '!===',
        '|===',
        '',
      ].join('\n'),
    )
    const inner = (n: typeof t) => n.table!.rows.body[0]![0]!.blocks!.find((b) => b.context === 'table')!
    const fourth = inner(inner(inner(t)))
    expect(fourth.named).toEqual({ cols: 'a', format: 'psv', separator: ':' })
    expect(fourth.line).toBe(8)
  })

  it('does not take what a cell sets for what the document sets', () => {
    const dump = notaDump(parse('|===\na|\n:in-cell: 1\n\ntext\n|===\n'), 'x.adoc')
    expect(dump.entries).toEqual([])
  })

  it('gives the format that the delimiter stands for, when the attribute list has none', () => {
    expect(tableOf(',===\na,b\n,===\n').named).toEqual({ format: 'csv' })
    expect(tableOf(':===\na:b\n:===\n').named).toEqual({ format: 'dsv' })
    expect(tableOf('[format=tsv]\n,===\na\tb\n,===\n').named).toEqual({ format: 'tsv' })
    expect(tableOf('|===\n|a\n|===\n').named).toEqual({})
  })
})

describe('the line of a cell as Ruby reports it', () => {
  const lines = (text: string) =>
    Object.values(tableOf(text).table!.rows)
      .flat(2)
      .map((c) => c.line)

  it('is the line of the cell for PSV, and the line of the separator that closed a repeat for its copies', () => {
    expect(lines('|===\n|a |b\n|c |d\n|===\n')).toEqual([2, 2, 3, 3])
    expect(lines('[cols="3*"]\n|===\n3*|x\n2*|y |z\n|===\n')).toEqual([3, 4, 4, 4, 4, 4])
  })

  it('is one line behind for the first cell of a line of CSV and DSV after the first', () => {
    expect(lines(',===\na,b\nc,d\ne,f\n,===\n')).toEqual([2, 2, 2, 3, 3, 4])
    expect(lines(':===\na:b\nc:d\n:===\n')).toEqual([2, 2, 2, 3])
    expect(lines(',===\n"a\nb",c\nd,e\n,===\n')).toEqual([2, 3, 3, 4])
  })

  it('counts the lines of the table without the comment lines', () => {
    expect(lines('|===\n|a |b\n// c\n|c |d\n|===\n')).toEqual([2, 2, 3, 3])
  })

  it('numbers the document of a cell from that line', () => {
    const asc = tableOf('[cols="a,a",format=csv]\n|===\n"* item",plain\n"!===\n!x !y\n!===",z\n|===\n')
    const nested = asc.table!.rows.body[1]![0]!.blocks!.find((b) => b.context === 'table')!
    expect(nested.table!.rows.body[0]!.map((c) => c.line)).toEqual([4, 4])
  })

  it('numbers the document of a quoted CSV cell from the line of the cell, not from the line of its text', () => {
    const asc = tableOf('[cols="1a"]\n,===\n"\n:===\nx:y\n:===\n"\n,===\n')
    const nested = asc.table!.rows.body[0]![0]!.blocks!.find((b) => b.context === 'table')!
    expect(nested.table!.rows.body[0]!.map((c) => c.line)).toEqual([4, 4])
  })

  it('does the same for a quoted CSV cell after the first column', () => {
    const asc = tableOf('[cols="1,1a"]\n,===\nx,"\n:===\nx:y\n:===\n"\n,===\n')
    const nested = asc.table!.rows.body[0]![1]!.blocks!.find((b) => b.context === 'table')!
    expect(nested.table!.rows.body[0]!.map((c) => c.line)).toEqual([4, 4])
  })
})

describe('the id of a block macro in the dump of Nota', () => {
  const macro = (text: string) => notaDump(parse(text), 'x.adoc').nodes!.find((n) => n.context === 'image')!
  it('is the id in the brackets; it is no named attribute', () => {
    expect(macro('image::pic.png[id=img1]')).toMatchObject({ id: 'img1' })
    expect(macro('image::pic.png[id=img1]').named).not.toHaveProperty('id')
    expect(macro('[[above]]\nimage::pic.png[id=img1]').id).toBe('img1')
    expect(macro('[[above]]\nimage::pic.png[Alt]').id).toBe('above')
    expect(macro('[#above]\nimage::pic.png[id=]').id).toBe('')
  })
})
