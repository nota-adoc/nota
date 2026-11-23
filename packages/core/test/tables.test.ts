import { describe, expect, it } from 'vitest'
import { type SyntaxNode } from '@lezer/common'
import {
  NodeNames,
  blockKind,
  parse,
  sectionLevel as sectionLevelProp,
  type TableModel,
} from '@nota-adoc/core'
import { hasUnclosedQuotes, joinQuotes, summarizeQuotes } from '../src/parse/table.js'
import { codesOf, lossless } from './helpers.js'

/** `Name:text` of the children of the node, in order. */
function kids(node: SyntaxNode, text: string): string[] {
  const out: string[] = []
  for (let c = node.firstChild; c; c = c.nextSibling)
    out.push(`${c.name}:${JSON.stringify(text.slice(c.from, c.to))}`)
  return out
}

function firstNode(text: string, name: string): { node: SyntaxNode; text: string } {
  const doc = lossless(text)
  let found: SyntaxNode | null = null
  doc.tree.iterate({
    enter(n) {
      if (found) return false
      if (n.name === name) {
        found = n.node
        return false
      }
      return undefined
    },
  })
  if (!found) throw new Error(`no ${name} in ${JSON.stringify(text)}`)
  return { node: found, text }
}

/** The table model at the first `at` in the text. */
function modelAt(text: string, at = '|'): TableModel {
  const doc = lossless(text)
  const m = doc.tableAt(text.indexOf(at, text.indexOf('===')) + 1)
  if (!m) throw new Error(`no table at ${JSON.stringify(at)}`)
  return m
}

/** The cells of a row as their text. */
const rowTexts = (rows: TableModel['rows'][keyof TableModel['rows']]) =>
  rows.map((r) => r.cells.map((c) => c.text))

describe('table nodes', () => {
  it('has the node names', () => {
    for (const n of ['TableCell', 'CellSpec', 'CellSeparator', 'CellContent']) expect(NodeNames).toContain(n)
  })

  it('reads the cells of a table in text order', () => {
    const text = '|===\n|a |b\n\n2+^.>s|c\n|===\n'
    const { node } = firstNode(text, 'DelimitedBlock')
    expect(node.tree?.prop(blockKind)).toBe('table')
    expect(kids(node, text)).toEqual([
      'BlockDelimiter:"|===\\n"',
      'TableCell:"|a"',
      'Mark:" "',
      'TableCell:"|b"',
      'Mark:"\\n"',
      'BlankLine:"\\n"',
      'TableCell:"2+^.>s|c"',
      'Mark:"\\n"',
      'BlockDelimiter:"|===\\n"',
    ])
    const cells: SyntaxNode[] = []
    for (let c = node.firstChild; c; c = c.nextSibling) if (c.name === 'TableCell') cells.push(c)
    expect(kids(cells[0]!, text)).toEqual(['CellSeparator:"|"', 'CellContent:"a"'])
    expect(kids(cells[2]!, text)).toEqual(['CellSpec:"2+^.>s"', 'CellSeparator:"|"', 'CellContent:"c"'])
  })

  it('has no DelimitedContent in a table', () => {
    const { node } = firstNode('|===\n|a\n|===\n', 'DelimitedBlock')
    expect(node.getChild('DelimitedContent')).toBeNull()
  })

  it('keeps an escaped separator in the content of its cell', () => {
    const text = '|===\n|a\\|b |c\n|===\n'
    const { node } = firstNode(text, 'DelimitedBlock')
    const cell = node.getChild('TableCell')!
    expect(kids(cell, text)).toEqual(['CellSeparator:"|"', 'CellContent:"a\\\\|b"'])
  })

  it('reads a cell over several lines and a blank line after it as the table s', () => {
    const text = '|===\n|one\ntwo\n\n|b\n|===\n'
    const { node } = firstNode(text, 'DelimitedBlock')
    expect(kids(node, text)).toEqual([
      'BlockDelimiter:"|===\\n"',
      'TableCell:"|one\\ntwo"',
      'Mark:"\\n"',
      'BlankLine:"\\n"',
      'TableCell:"|b"',
      'Mark:"\\n"',
      'BlockDelimiter:"|===\\n"',
    ])
  })

  it('reads the cells of csv and dsv tables', () => {
    const text = ',===\na,b\n,===\n'
    const { node } = firstNode(text, 'DelimitedBlock')
    const cells: string[] = []
    for (let c = node.firstChild; c; c = c.nextSibling)
      if (c.name === 'TableCell') cells.push(text.slice(c.from, c.to))
    expect(cells).toEqual(['a', ',b'])
  })

  it('has an unclosed table run to the end of the container, with a diagnostic on the opening line', () => {
    const text = '|===\n|a |b\n'
    const doc = lossless(text)
    expect(doc.diagnostics.map((d) => [d.code, d.from, d.to])).toEqual([['unterminated-block', 0, 4]])
  })
})

describe('table model', () => {
  it('gives null outside a table', () => {
    const text = 'para\n\n|===\n|a\n|===\n'
    const doc = lossless(text)
    expect(doc.tableAt(0)).toBeNull()
    expect(doc.tableAt(text.length)).toBeNull()
    expect(doc.tableAt(text.indexOf('|a') + 1)).not.toBeNull()
  })

  it('works out the widths of [cols="1,2"]', () => {
    const text = '[cols="1,2"]\n|===\n|a |b\n|c |d\n|===\n'
    const m = modelAt(text)
    expect(m.columns.map((c) => c.width)).toEqual([33.3333, 66.6667])
    expect(m.columns.map((c) => [c.halign, c.valign, c.style])).toEqual([
      ['left', 'top', null],
      ['left', 'top', null],
    ])
    expect(m.rows.head).toHaveLength(0)
    expect(rowTexts(m.rows.body)).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ])
    expect(m.rows.foot).toHaveLength(0)
  })

  it('has as many columns as cells in the first line without cols', () => {
    const m = modelAt('|===\n|a |b |c\n|d |e |f\n|===\n')
    expect(m.columns).toHaveLength(3)
    expect(m.columns.map((c) => c.width)).toEqual([33.3333, 33.3333, 33.3334])
    expect(rowTexts(m.rows.body)).toEqual([
      ['a', 'b', 'c'],
      ['d', 'e', 'f'],
    ])
  })

  it('reads the first row as the header when a blank line follows it', () => {
    const m = modelAt('|===\n|h1 |h2\n\n|a |b\n|===\n')
    expect(rowTexts(m.rows.head)).toEqual([['h1', 'h2']])
    expect(rowTexts(m.rows.body)).toEqual([['a', 'b']])
  })

  it('cancels the implicit header with %noheader', () => {
    const m = modelAt('[%noheader]\n|===\n|h1 |h2\n\n|a |b\n|===\n')
    expect(m.rows.head).toHaveLength(0)
    expect(rowTexts(m.rows.body)).toEqual([
      ['h1', 'h2'],
      ['a', 'b'],
    ])
  })

  it('sets the header and the footer with %header and %footer', () => {
    const m = modelAt('[%header%footer]\n|===\n|h |h\n|a |b\n|f |f\n|===\n')
    expect(rowTexts(m.rows.head)).toEqual([['h', 'h']])
    expect(rowTexts(m.rows.body)).toEqual([['a', 'b']])
    expect(rowTexts(m.rows.foot)).toEqual([['f', 'f']])
  })

  it('reads a colspan', () => {
    const text = '|===\n2+|wide\n|a |b\n|===\n'
    const m = modelAt(text)
    const [wide] = m.rows.body[0]!.cells
    expect([wide!.colspan, wide!.rowspan, wide!.column, wide!.row]).toEqual([2, 1, 0, 0])
    expect(m.columns).toHaveLength(2)
    expect(text.slice(wide!.from, wide!.to)).toBe('2+|wide')
    expect(text.slice(wide!.contentFrom, wide!.contentTo)).toBe('wide')
  })

  it('reads a rowspan: the next rows have fewer cells', () => {
    const m = modelAt('|===\n|a |b\n.3+|tall |c\n|d\n|e\n|===\n')
    const rows = m.rows.body
    expect(rows.map((r) => r.cells.map((c) => c.text))).toEqual([['a', 'b'], ['tall', 'c'], ['d'], ['e']])
    expect(rows[1]!.cells[0]!.rowspan).toBe(3)
    expect(rows[2]!.cells[0]!.column).toBe(1)
    expect(rows[3]!.cells[0]!.column).toBe(1)
  })

  it('repeats a cell with N*', () => {
    const m = modelAt('|===\n3*|x\n|===\n')
    expect(rowTexts(m.rows.body)).toEqual([['x', 'x', 'x']])
    expect(m.columns).toHaveLength(3)
  })

  it('reads a row over several lines and several rows in a line', () => {
    const m = modelAt('[cols="2*"]\n|===\n|a\n|b |c |d\n|e\n|f\n|===\n')
    expect(rowTexts(m.rows.body)).toEqual([
      ['a', 'b'],
      ['c', 'd'],
      ['e', 'f'],
    ])
  })

  it('reads the alignments and the style of a cell and of a column', () => {
    const m = modelAt('[cols="^.^2,>m"]\n|===\n|a |b\n<.>e|c |d\n|===\n')
    expect(m.columns.map((c) => [c.halign, c.valign, c.style])).toEqual([
      ['center', 'middle', null],
      ['right', 'top', 'monospaced'],
    ])
    const [row1, row2] = m.rows.body
    expect(row1!.cells.map((c) => [c.halign, c.valign, c.style])).toEqual([
      ['center', 'middle', null],
      ['right', 'top', 'monospaced'],
    ])
    expect(row2!.cells.map((c) => [c.halign, c.valign, c.style])).toEqual([
      ['left', 'bottom', 'emphasis'],
      ['right', 'top', 'monospaced'],
    ])
  })

  it('does not use the style of a header cell', () => {
    const m = modelAt('[cols="a,a"]\n[%header]\n|===\n|h1 |h2\n|x |y\n|===\n')
    expect(m.rows.head[0]!.cells.map((c) => c.style)).toEqual([null, null])
    expect(m.rows.body[0]!.cells.map((c) => c.style)).toEqual(['asciidoc', 'asciidoc'])
  })

  it('takes the balance into the last column and gives ~ its part', () => {
    const m = modelAt('[cols="30%,~,~"]\n|===\n|a |b |c\n|===\n')
    expect(m.columns.map((c) => [c.width, c.autowidth])).toEqual([
      [30, false],
      [35, true],
      [35, true],
    ])
  })

  it('finds the innermost table', () => {
    const text = '|===\na|\n!===\n!x\n!===\n\n|===\n'
    const doc = lossless(text)
    const outer = doc.tableAt(text.indexOf('|===') + 1)!
    const inner = doc.tableAt(text.indexOf('!x') + 2)!
    expect(outer).not.toBeNull()
    expect(inner.format).toBe('psv')
    expect(inner.separator).toBe('!')
    expect(inner.from).toBeGreaterThan(outer.from)
    expect(inner.to).toBeLessThan(outer.to)
  })

  it('reads header and footer options given as options="…"', () => {
    const m = modelAt('[options="header,footer"]\n|===\n|h\n|a\n|f\n|===\n')
    expect(rowTexts(m.rows.head)).toEqual([['h']])
    expect(rowTexts(m.rows.foot)).toEqual([['f']])
  })
})

/** The table blocks of a text, in document order, with the names of their ancestors from the outermost. */
function tableBlocks(text: string): { node: SyntaxNode; path: string[] }[] {
  const doc = lossless(text)
  const out: { node: SyntaxNode; path: string[] }[] = []
  doc.tree.iterate({
    enter(n) {
      if (n.name !== 'DelimitedBlock' || n.node.tree?.prop(blockKind) !== 'table') return undefined
      const path: string[] = []
      for (let p = n.node.parent; p; p = p.parent) path.unshift(p.name)
      out.push({ node: n.node, path })
      return undefined
    },
  })
  return out
}

/** The names of the children of a node. */
const namesOf = (node: SyntaxNode): string[] => {
  const out: string[] = []
  for (let c = node.firstChild; c; c = c.nextSibling) out.push(c.name)
  return out
}

const FOUR_LEVELS =
  '|===\na|\nLevel one.\n\n!===\na!\nLevel two.\n\n[cols="a"]\n,===\n"Level three.\n\n[cols=1]\n:===\nLevel four\n:==="\n,===\n!===\n|===\n'

describe('tables in cells', () => {
  it('nests four levels of tables, each in the content of an a cell', () => {
    const tables = tableBlocks(FOUR_LEVELS)
    expect(tables).toHaveLength(4)
    expect(tables[0]!.path).toEqual(['Document'])
    for (const t of tables.slice(1))
      expect(t.path.slice(-3)).toEqual(['DelimitedBlock', 'TableCell', 'CellContent'])
    expect(tables.map((t) => t.path.length)).toEqual([1, 4, 7, 10])
    const doc = lossless(FOUR_LEVELS)
    const at = (needle: string) => doc.tableAt(FOUR_LEVELS.indexOf(needle))
    expect(at('Level one')?.separator).toBe('|')
    expect(at('Level two')?.separator).toBe('!')
    expect(at('Level three')?.format).toBe('csv')
    expect(at('Level four')?.format).toBe('dsv')
  })

  it('has the tables of the levels inside one another', () => {
    const [a, b, c, d] = tableBlocks(FOUR_LEVELS)
    expect(a!.node.from).toBeLessThan(b!.node.from)
    expect(b!.node.from).toBeLessThan(c!.node.from)
    expect(c!.node.from).toBeLessThan(d!.node.from)
    expect(d!.node.to).toBeLessThan(c!.node.to)
    expect(c!.node.to).toBeLessThan(b!.node.to)
    expect(b!.node.to).toBeLessThan(a!.node.to)
  })

  it('holds the blocks of a document in the content of an a cell', () => {
    const text = '|===\na|\nA paragraph.\n\n* one\n* two\n\n----\ncode\n----\n|plain\n|===\n'
    const doc = lossless(text)
    const cells: SyntaxNode[] = []
    for (let c = doc.tree.topNode.firstChild!.firstChild; c; c = c.nextSibling)
      if (c.name === 'TableCell') cells.push(c)
    expect(cells).toHaveLength(2)
    const content = cells[0]!.getChild('CellContent')!
    expect(namesOf(content).filter((n) => n !== 'Mark')).toEqual([
      'Paragraph',
      'BlankLine',
      'UnorderedList',
      'BlankLine',
      'DelimitedBlock',
    ])
    expect(text.slice(content.from, content.to)).toBe('A paragraph.\n\n* one\n* two\n\n----\ncode\n----')
    // a cell without the style is text
    expect(namesOf(cells[1]!.getChild('CellContent')!)).toEqual([])
  })

  it('keeps the blocks of an a cell in the tree of a csv cell, with its quotes outside the blocks', () => {
    const text = '[cols=a]\n,===\n"* one\n* two"\n,===\n'
    const list = firstNode(text, 'UnorderedList')
    expect(text.slice(list.node.from, list.node.to)).toBe('* one\n* two')
  })

  it('reads a passthrough block in a cell of the fourth level as a block', () => {
    const text =
      '|===\na|\n!===\na!\n[cols="a"]\n,===\n"[cols=a,format=psv,separator=¦]\n:===\n¦++++\n<span>raw html</span>\n++++\n:==="\n,===\n!===\n|===\n'
    const tables = tableBlocks(text)
    expect(tables).toHaveLength(4)
    const pass = firstNode(text, 'DelimitedBlock')
    let found: SyntaxNode | null = null
    lossless(text).tree.iterate({
      enter(n) {
        if (n.name === 'DelimitedBlock' && n.node.tree?.prop(blockKind) === 'pass') found = n.node
        return undefined
      },
    })
    expect(pass).toBeTruthy()
    expect(text.slice(found!.from, found!.to)).toBe('++++\n<span>raw html</span>\n++++')
    expect(found!.parent!.name).toBe('CellContent')
  })

  it('lets a cell see the attributes of the document', () => {
    const text = ':n: 3\n\n|===\na|\n[cols="{n}*"]\n!===\n!a !b !c\n!===\n|===\n'
    const doc = lossless(text)
    expect(doc.tableAt(text.indexOf('!a'))?.columns).toHaveLength(3)
  })

  it('lets an entry in a cell set an attribute for the rest of the cell, not for the document', () => {
    const text =
      ':n: 1\n\n|===\na|\n:m: 2\n\n[cols="{m}*"]\n!===\n!a !b\n!===\n|===\n\n[cols="{m}*"]\n|===\n|a |b\n|===\n'
    const doc = lossless(text)
    expect(doc.tableAt(text.indexOf('!a'))?.columns).toHaveLength(2)
    // {m} is not set after the table
    expect(doc.attributesAt(text.length - 2).has('m')).toBe(false)
    expect(doc.attributesAt(text.length - 2).get('n')).toBe('1')
  })

  it('does not let an entry in a cell change an attribute of the document', () => {
    const text = ':n: 1\n\n|===\na|\n:n: 2\n\n[cols="{n}*"]\n!===\n!a !b\n!===\n|===\n'
    const doc = lossless(text)
    expect(doc.tableAt(text.indexOf('!a'))?.columns).toHaveLength(1)
  })

  it('is cut by the outer table at the bar of a table opened with more bars in an a cell', () => {
    const text = '|===\na|\nbefore\n|====\n|inner\n|====\nafter\n|===\n'
    const tables = tableBlocks(text)
    expect(tables).toHaveLength(1)
    const m = lossless(text).tableAt(4)!
    expect(rowTexts(m.rows.body)).toEqual([['before'], ['===='], ['inner'], ['====\nafter']])
    expect(namesOf(firstNode(text, 'CellContent').node)).toContain('Paragraph')
  })

  it('reports a problem inside the document of a cell where it is in the text', () => {
    const text = '|===\na|\n----\nnot closed\n|===\n'
    const doc = lossless(text)
    const d = doc.diagnostics.find((x) => x.code === 'unterminated-block')
    expect(d).toBeTruthy()
    expect(text.slice(d!.from, d!.to)).toBe('----')
  })

  it('finds the model of the innermost table, with the offsets of the text', () => {
    const inner = lossless(FOUR_LEVELS).tableAt(FOUR_LEVELS.indexOf('Level four'))!
    // the block of the table starts with the line of its attributes
    expect(FOUR_LEVELS.slice(inner.from, inner.to)).toBe('[cols=1]\n:===\nLevel four\n:===')
    expect(inner.rows.body[0]!.cells).toHaveLength(1)
    const cell = inner.rows.body[0]!.cells[0]!
    expect(FOUR_LEVELS.slice(cell.contentFrom, cell.contentTo)).toBe('Level four')
  })
})

describe('documents in cells stay in their place in the source', () => {
  const textOf = (text: string, node: SyntaxNode) => text.slice(node.from, node.to)

  it('cuts a listing where a line of a conditional inside it is left out', () => {
    const text = '|===\na|\n----\none\nifdef::nope[]\nhidden\nendif::[]\ntwo\n----\n|===\n'
    const doc = lossless(text)
    let listing: SyntaxNode | null = null
    doc.tree.iterate({
      enter(n) {
        if (n.name === 'DelimitedBlock' && n.node.tree?.prop(blockKind) === 'listing') listing = n.node
        return undefined
      },
    })
    expect(textOf(text, listing!)).toBe('----\none\nifdef::nope[]\nhidden\nendif::[]\ntwo\n----')
    const inside = kids(listing!, text)
    expect(inside).toContain('DelimitedContent:"one\\n"')
    expect(inside).toContain('DelimitedContent:"two\\n"')
    expect(namesOf(listing!)).toContain('Directive')
  })

  it('reads the text of a paragraph over a comment line of the table', () => {
    const text = '|===\na|\nline one\n// a comment\nline two\n|===\n'
    const p = firstNode(text, 'Paragraph')
    expect(textOf(text, p.node)).toBe('line one\n// a comment\nline two')
    expect(namesOf(p.node)).toEqual(['TextLine', 'LineComment', 'TextLine'])
  })

  it('maps the blocks of a cell with squeezed quotes of a csv table', () => {
    const text = '[cols=a]\n,===\n"say ""hi""\n\n* item"\n,===\n'
    const list = firstNode(text, 'UnorderedList')
    expect(textOf(text, list.node)).toBe('* item')
    const para = firstNode(text, 'Paragraph')
    expect(textOf(text, para.node)).toBe('say ""hi""\n')
  })

  it('maps the blocks of a cell in text with CRLF line ends and trailing spaces', () => {
    const text = '|===\r\na|first  \r\nsecond\r\n\r\n* item  \r\n|===\r\n'
    const p = firstNode(text, 'Paragraph')
    expect(textOf(text, p.node)).toBe('first  \r\nsecond\r\n')
    expect(textOf(text, firstNode(text, 'UnorderedList').node)).toBe('* item')
  })

  it('has every block of a cell inside the content of the cell', () => {
    const text = '|===\na|\n= Title\n\nBody.\n\n== Section\n\nMore.\n|===\n'
    const content = firstNode(text, 'CellContent')
    expect(namesOf(content.node).filter((n) => n !== 'Mark')).toEqual([
      'Header',
      'BlankLine',
      'Paragraph',
      'BlankLine',
      'Section',
    ])
    expect(content.node.getChild('Section')!.tree?.prop(sectionLevelProp)).toBeDefined()
  })

  it('does not read the cell of a table deeper than the limit as a document', () => {
    let text = 'x'
    for (let i = 0; i < 40; i++)
      text = `[cols="a",format=psv,separator=¦]\n:===\n¦${text.split('\n').join('\n')}\n:===`
    const doc = lossless(text + '\n')
    let tables = 0
    doc.tree.iterate({
      enter(n) {
        if (n.name === 'DelimitedBlock' && n.node.tree?.prop(blockKind) === 'table') tables++
        return undefined
      },
    })
    expect(tables).toBeGreaterThan(20)
    expect(tables).toBeLessThan(41)
  })
})

describe('table formats', () => {
  it('reads csv with quotes', () => {
    const m = modelAt(',===\n"a,b",c\n"say ""hi""",d\n,===\n', ',')
    expect(m.format).toBe('csv')
    expect(m.columns).toHaveLength(2)
    expect(rowTexts(m.rows.body)).toEqual([
      ['a,b', 'c'],
      ['say "hi"', 'd'],
    ])
  })

  it('reads a newline inside quotes as one multi-line cell', () => {
    const m = modelAt(',===\n"one\ntwo",b\n,===\n', ',')
    expect(rowTexts(m.rows.body)).toEqual([['one\ntwo', 'b']])
  })

  it('reads dsv with an escaped colon', () => {
    const m = modelAt(':===\na:b\\:c\n:===\n', ':')
    expect(m.format).toBe('dsv')
    expect(rowTexts(m.rows.body)).toEqual([['a', 'b:c']])
  })

  it('reads [format=tsv] with a tab', () => {
    const m = modelAt('[format=tsv]\n|===\na\tb\n|===\n', 'a')
    expect(m.separator).toBe('\t')
    expect(rowTexts(m.rows.body)).toEqual([['a', 'b']])
  })

  it('reads a custom separator', () => {
    const m = modelAt('[separator=¦]\n|===\n¦a ¦b\n|===\n', '¦')
    expect(m.separator).toBe('¦')
    expect(rowTexts(m.rows.body)).toEqual([['a', 'b']])
  })

  it('reads [format=csv,separator=;]', () => {
    const m = modelAt('[format=csv,separator=;]\n|===\na;b\n|===\n', 'a')
    expect(m.format).toBe('csv')
    expect(rowTexts(m.rows.body)).toEqual([['a', 'b']])
  })

  it('reads !=== as psv with |', () => {
    const m = modelAt('!===\n|a |b\n!===\n', '|')
    expect(m.separator).toBe('|')
    expect(rowTexts(m.rows.body)).toEqual([['a', 'b']])
  })
})

describe('table diagnostics', () => {
  const diags = (text: string) =>
    parse(text).diagnostics.map((d) => [d.code, text.slice(d.from, d.to)] as const)

  it('reports a psv table whose first cell has no separator', () => {
    expect(diags('|===\na |b\n|c |d\n|===\n')).toEqual([['table-missing-separator', 'a |b']])
  })

  it('reports cells that did not fill a row', () => {
    expect(diags('[cols="2*"]\n|===\n|a |b\n|c\n|===\n')).toEqual([['table-incomplete-row', '|c']])
  })

  it('reports a cell that does not fit the columns and drops its row', () => {
    const text = '[cols="2*"]\n|===\n|a 3+|b\n|c |d\n|===\n'
    expect(diags(text)).toEqual([['table-cell-dropped', '3+|b']])
    expect(rowTexts(modelAt(text).rows.body)).toEqual([['c', 'd']])
  })

  it('keeps the cells that were left out, in the model, in the order they were read', () => {
    const text = '[cols="2*"]\n|===\n|a 3+|b\n|c |d\n|e\n|==='
    const m = modelAt(text)
    expect(rowTexts(m.rows.body)).toEqual([['c', 'd']])
    expect(m.dropped.map((d) => [d.text, d.style, d.after])).toEqual([
      ['a', null, 0],
      ['b', null, 0],
      ['e', null, 2],
    ])
    // where they are in the text
    expect(m.dropped.map((d) => text.slice(d.from, d.to))).toEqual(['|a', '3+|b', '|e'])
  })

  it('has no diagnostics for a well-formed table', () => {
    expect(codesOf('|===\n|a |b\n|c |d\n|===\n')).toEqual([])
  })
})

describe('the quotes of a record of csv data', () => {
  // `ParserContext#buffer_has_unclosed_quotes?` of Asciidoctor, written out: the oracle of the summaries that the
  // scan joins one piece at a time
  function naive(buffer: string): boolean {
    const record = buffer.replace(/^[\t\n\v\f\r ]+/, '').replace(/[\t\n\v\f\r ]+$/, '')
    if (record === '"') return true
    if (record.startsWith('"')) {
      const trailing = record.endsWith('"')
      if ((trailing && record.endsWith('""')) || record.startsWith('""')) {
        const rest = record.split('""').join('')
        return rest.startsWith('"') && !rest.endsWith('"')
      }
      return !trailing
    }
    return false
  }

  function* strings(alphabet: string[], max: number): Generator<string> {
    yield ''
    let layer = ['']
    for (let n = 1; n <= max; n++) {
      layer = layer.flatMap((s) => alphabet.map((c) => s + c))
      yield* layer
    }
  }

  it('tells unclosed quotes of two joined pieces as the record of both does', () => {
    const all = [...strings(['"', ' ', 'a', '\n'], 5)]
    let n = 0
    for (const x of all) {
      const sx = summarizeQuotes(x)
      for (const y of all) {
        const got = hasUnclosedQuotes(joinQuotes(sx, summarizeQuotes(y)))
        if (got !== naive(x + y)) expect({ x, y, got }).toEqual({ x, y, got: !got })
        n++
      }
    }
    expect(n).toBeGreaterThan(1_800_000)
  })

  it('joins three pieces the same way in any order of joining', () => {
    let seed = 12345
    const rnd = (k: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648
      return seed % k
    }
    const piece = () => {
      let s = ''
      for (let n = rnd(7); n > 0; n--) s += '" a\n\t'[rnd(5)]
      return s
    }
    for (let i = 0; i < 20_000; i++) {
      const [x, y, z] = [piece(), piece(), piece()]
      const [sx, sy, sz] = [summarizeQuotes(x), summarizeQuotes(y), summarizeQuotes(z)]
      const left = joinQuotes(joinQuotes(sx, sy), sz)
      const right = joinQuotes(sx, joinQuotes(sy, sz))
      expect(hasUnclosedQuotes(left)).toBe(naive(x + y + z))
      expect(hasUnclosedQuotes(right)).toBe(naive(x + y + z))
    }
  })
})
