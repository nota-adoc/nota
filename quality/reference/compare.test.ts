import { describe, expect, it } from 'vitest'
import { parse } from '@nota-adoc/core'
import {
  type Side,
  compareFile,
  emptyRegistry,
  formatReport,
  htmlDetailShapes,
  htmlShapes,
  idKinds,
  normalizeHtml,
  summarize,
  toJson,
} from './compare.js'
import { isShapeKey } from '../lib/aggregate.js'
import type { DumpCell, DumpFile, DumpNode, DumpTable, HtmlBlock } from './format.js'
import { notaDump } from './nota-dump.js'
import registryJson from './known-differences.json' with { type: 'json' }
import type { Registry } from './compare.js'

const text = [
  '= Title',
  'Jane Doe <jane@example.com>',
  ':toc:',
  '',
  '== Section',
  '',
  '[#p1.lead]',
  'First paragraph',
  'second line',
  '',
  ':attr: value',
  '',
  '=== Sub',
  '',
  'Text.',
  '',
].join('\n')

const file = 'sample.adoc'
const reference = (): DumpFile => structuredClone(notaDump(parse(text), file))

function run(mutate: (d: DumpFile) => void) {
  const nota = reference()
  mutate(nota)
  const result = compareFile({ file, text, nota, refs: { ruby: reference() } }, emptyRegistry)
  return { result, summary: summarize([result]) }
}

describe('compare', () => {
  it('finds no differences between identical dumps', () => {
    const { summary } = run(() => {})
    expect(summary.pairs['nota-ruby']!.differences).toEqual([])
    expect(summary.pairs['nota-ruby']!.compared.section).toBe(2)
    expect(summary.pairs['nota-ruby']!.compared.paragraph).toBe(2)
    expect(summary.exitCode).toBe(0)
  })

  const cases: [
    string,
    (d: DumpFile) => void,
    Partial<{ line: number; kind: string; field: string; a: unknown; b: unknown }>,
  ][] = [
    [
      'section level',
      (d) => (d.nodes!.find((n) => n.title === 'Sub')!.level = 3),
      { line: 13, kind: 'section', field: 'level', a: 3, b: 2 },
    ],
    [
      'start line',
      (d) => (d.nodes!.find((n) => n.title === 'Sub')!.line = 14),
      { line: 13, kind: 'section', field: 'presence', a: null, b: 'section' },
    ],
    [
      'paragraph line count',
      (d) => (d.nodes!.find((n) => n.line === 8)!.lines = 3),
      { line: 8, kind: 'paragraph', field: 'lines', a: 3, b: 2 },
    ],
    [
      'attribute value',
      (d) => (d.entries!.find((e) => e.name === 'attr')!.value = 'other'),
      { line: 11, kind: 'entries', field: 'value', a: 'other', b: 'value' },
    ],
    [
      'extra block',
      (d) => d.nodes!.push({ context: 'paragraph', line: 16, parent: 13, style: null, lines: 1 }),
      { line: 16, kind: 'paragraph', field: 'presence', a: 'paragraph', b: null },
    ],
    [
      'missing block',
      (d) => (d.nodes = d.nodes!.filter((n) => n.line !== 15)),
      { line: 15, kind: 'paragraph', field: 'presence', a: null, b: 'paragraph' },
    ],
    [
      'block role',
      (d) => (d.nodes!.find((n) => n.line === 8)!.roles = ['other']),
      { line: 8, kind: 'attributes', field: 'roles', a: ['other'], b: ['lead'] },
    ],
  ]

  for (const [name, mutate, expected] of cases) {
    it(`reports a changed ${name} with file, line, kind and both values`, () => {
      const { summary } = run(mutate)
      const diffs = summary.pairs['nota-ruby']!.differences
      expect(diffs).toContainEqual(expect.objectContaining({ file, ...expected }))
      expect(summary.exitCode).not.toBe(0)
      const report = formatReport(summary, { aggregate: false })
      expect(report).toContain(`${file}:${expected.line}`)
      const json = JSON.parse(toJson(summary, { aggregate: false }))
      expect(json.pairs['nota-ruby'].differences).toContainEqual(
        expect.objectContaining({ file, line: expected.line, kind: expected.kind }),
      )
    })
  }

  describe('what is out of scope', () => {
    const node = (n: Partial<DumpNode> & { context: string; line: number }): DumpNode => ({
      parent: 0,
      depth: 0,
      style: null,
      id: null,
      roles: [],
      options: [],
      named: {},
      ...n,
    })
    const dumpOf = (nodes: DumpNode[]): DumpFile => ({
      file: 'x.adoc',
      header: { title: null, authors: [], revision: null },
      entries: [],
      nodes,
    })
    const compareWith = (t: string, nodes: DumpNode[], mutate: (nota: DumpFile) => void = () => {}) => {
      const nota = notaDump(parse(t), 'x.adoc')
      mutate(nota)
      const result = compareFile(
        { file: 'x.adoc', text: t, nota, refs: { ruby: dumpOf(nodes) } },
        emptyRegistry,
      )
      return summarize([result]).pairs['nota-ruby']!
    }

    it('compares a table as one item, and what is around it', () => {
      const t = 'Intro\n\n|===\n|a |b\n|===\n\nAfter.\n'
      const layout = notaDump(parse(t), 'x.adoc').nodes!.find((n) => n.context === 'table')!.table
      const p = compareWith(t, [
        node({ context: 'paragraph', line: 1, lines: 1 }),
        node({ context: 'table', line: 3, content_model: 'compound', style: 'table', table: layout }),
        node({ context: 'paragraph', line: 7, lines: 1 }),
      ])
      expect(p.differences).toEqual([])
      expect(p.outOfScope['later-stage-blocks']).toBe(0)
      expect(p.compared.table).toBe(1)
      expect(p.matched.table).toBe(1)
      expect(p.compared.paragraph).toBe(2)
    })

    describe('the layout of a table', () => {
      const t = 'Intro\n\n|===\n|a |b\n|===\n'
      const cell = (row: number, column: number, text: string, extra: Partial<DumpCell> = {}): DumpCell => ({
        row,
        column,
        colspan: 1,
        rowspan: 1,
        halign: 'left',
        valign: 'top',
        style: null,
        line: 4,
        text,
        ...extra,
      })
      const layout = (): DumpTable => ({
        columns: [
          { width: 50, halign: 'left', valign: 'top', style: null, autowidth: false },
          { width: 50, halign: 'left', valign: 'top', style: null, autowidth: false },
        ],
        rows: { head: [], body: [[cell(0, 0, 'a'), cell(0, 1, 'b')]], foot: [] },
      })
      const table = (layoutOf: DumpTable = layout()): DumpNode =>
        node({ context: 'table', line: 3, content_model: 'compound', style: 'table', table: layoutOf })
      const paragraph = node({ context: 'paragraph', line: 1, lines: 1 })
      const compareTables = (mutate: (l: DumpTable) => void) => {
        const nota = dumpOf([paragraph, table()])
        mutate(nota.nodes![1]!.table!)
        const result = compareFile(
          { file: 'x.adoc', text: t, nota, refs: { ruby: dumpOf([paragraph, table()]) } },
          emptyRegistry,
        )
        return summarize([result])
      }

      it('finds no difference between equal layouts', () => {
        const p = compareTables(() => {}).pairs['nota-ruby']!
        expect(p.differences).toEqual([])
        expect(p.compared.table).toBe(1)
        expect(p.matched.table).toBe(1)
      })

      const cases: [string, (l: DumpTable) => void, string, unknown, unknown][] = [
        ['rowspan', (l) => (l.rows.body[0]![0]!.rowspan = 2), 'rowspan', 2, 1],
        ['colspan', (l) => (l.rows.body[0]![1]!.colspan = 3), 'colspan', 3, 1],
        ['alignment of a cell', (l) => (l.rows.body[0]![1]!.halign = 'right'), 'halign', 'right', 'left'],
        ['style of a cell', (l) => (l.rows.body[0]![0]!.style = 'strong'), 'style', 'strong', null],
        ['text of a cell', (l) => (l.rows.body[0]![1]!.text = 'B'), 'text', 'B', 'b'],
        ['line of a cell', (l) => (l.rows.body[0]![1]!.line = 5), 'line', 5, 4],
        ['column of a cell', (l) => (l.rows.body[0]![1]!.column = 2), 'column', 2, 1],
        ['width of a column', (l) => (l.columns[0]!.width = 33.3333), 'column width', 33.3333, 50],
        ['number of columns', (l) => l.columns.pop(), 'columns', 1, 2],
        ['head row', (l) => l.rows.head.push(l.rows.body.shift()!), 'head rows', 1, 0],
        ['cells in a row', (l) => l.rows.body[0]!.pop(), 'cells', 1, 2],
      ]
      for (const [name, mutate, field, a, b] of cases) {
        it(`reports a changed ${name} as table.${field}`, () => {
          const summary = compareTables(mutate)
          const p = summary.pairs['nota-ruby']!
          expect(p.differences).toContainEqual(
            expect.objectContaining({ file: 'x.adoc', line: 3, kind: 'table', field, a, b }),
          )
          expect(summary.exitCode).not.toBe(0)
          expect(formatReport(summary, { aggregate: true })).toContain(`table.${field}: `)
        })
      }

      it('reports a table that only one side lays out', () => {
        const nota = dumpOf([
          paragraph,
          node({ context: 'table', line: 3, content_model: 'compound', style: 'table' }),
        ])
        const result = compareFile(
          { file: 'x.adoc', text: t, nota, refs: { ruby: dumpOf([paragraph, table()]) } },
          emptyRegistry,
        )
        expect(summarize([result]).pairs['nota-ruby']!.differences).toContainEqual(
          expect.objectContaining({ kind: 'table', field: 'layout' }),
        )
      })

      it('compares the blocks in a cell with the asciidoc style, and the tables in them', () => {
        const inner = (): DumpNode[] => [
          node({ context: 'paragraph', line: 6, lines: 1 }),
          node({ context: 'table', line: 8, content_model: 'compound', style: 'table', table: layout() }),
        ]
        const withBlocks = (blocks: DumpNode[]): DumpTable => {
          const l = layout()
          l.rows.body[0]![0]!.style = 'asciidoc'
          l.rows.body[0]![0]!.blocks = blocks
          return l
        }
        const both = (mutate: (blocks: DumpNode[]) => void) => {
          const notaBlocks = inner()
          mutate(notaBlocks)
          const result = compareFile(
            {
              file: 'x.adoc',
              text: t,
              nota: dumpOf([paragraph, table(withBlocks(notaBlocks))]),
              refs: { ruby: dumpOf([paragraph, table(withBlocks(inner()))]) },
            },
            emptyRegistry,
          )
          return summarize([result]).pairs['nota-ruby']!
        }
        const equal = both(() => {})
        expect(equal.differences).toEqual([])
        // the table of the cell is compared as a table of its own
        expect(equal.compared.table).toBe(2)
        expect(equal.compared.paragraph).toBe(2)
        const nested = both((blocks) => (blocks[1]!.table!.rows.body[0]![0]!.rowspan = 4))
        expect(nested.differences).toEqual([
          expect.objectContaining({ kind: 'table', field: 'rowspan', a: 4, b: 1 }),
        ])
        const lost = both((blocks) => blocks.shift())
        expect(lost.differences.length).toBeGreaterThan(0)
      })
    })

    it('does not put lists, blocks with delimiters, macros or breaks out of scope', () => {
      const t = "Intro\n\n----\ncode\n----\n\n* item\n\nimage::a.png[]\n\n'''\n"
      const p = compareWith(t, [
        node({ context: 'paragraph', line: 1, lines: 1 }),
        node({ context: 'listing', line: 3, content_model: 'verbatim', lines: 2, style: 'listing' }),
        node({ context: 'ulist', line: 7, content_model: 'compound', list_level: 0, items: 1 }),
        node({ context: 'list_item', line: 7, depth: 1, marker: '*', text_lines: 1 }),
        node({ context: 'image', line: 9, content_model: 'empty', target: 'a.png', named: { alt: 'a' } }),
        node({ context: 'thematic_break', line: 11, content_model: 'empty' }),
      ])
      expect(p.outOfScope).toEqual({
        'later-stage-blocks': 0,
        'preprocessor-directives': 0,
        'attribute-references': 0,
      })
      // the reference sees two lines in the listing, Nota one: it is compared
      expect(p.differences).toEqual([
        expect.objectContaining({ line: 3, kind: 'delimited', field: 'lines', a: 1, b: 2 }),
      ])
      expect(p.compared).toMatchObject({ list: 1, item: 1, macro: 1, break: 1, delimited: 1 })
    })

    it('reports a block that only nota sees as a difference', () => {
      // Nota reads `----` as an unclosed listing; the reference reads a paragraph
      const p = compareWith('----\nfoo\n', [node({ context: 'paragraph', line: 1, lines: 2 })])
      expect(p.differences).toContainEqual(
        expect.objectContaining({
          line: 1,
          kind: 'delimited',
          field: 'context',
          a: 'listing',
          b: 'paragraph',
        }),
      )
      expect(p.outOfScope['later-stage-blocks']).toBe(0)
    })

    it('puts out of scope the blocks that hold an include line, since the references read it as text', () => {
      const t = 'Intro\n\ninclude::part.adoc[]\n\n* item\ninclude::in-item.adoc[]\n* next\n\nAfter.\n'
      const p = compareWith(t, [
        node({ context: 'paragraph', line: 1, lines: 1 }),
        // the reference reads the include line as a paragraph of its own
        node({ context: 'paragraph', line: 3, lines: 1 }),
        node({ context: 'ulist', line: 5, content_model: 'compound', list_level: 0, items: 2 }),
        node({ context: 'list_item', line: 5, depth: 1, marker: '*', text_lines: 2 }),
        node({ context: 'list_item', line: 7, depth: 1, marker: '*', text_lines: 1 }),
        node({ context: 'paragraph', line: 9, lines: 1 }),
      ])
      expect(p.differences).toEqual([])
      expect(p.outOfScope['preprocessor-directives']).toBeGreaterThan(0)
      expect(p.compared.paragraph).toBe(2)
    })

    it('compares the region of a condition', () => {
      const t = 'ifdef::x[]\n* item\nendif::[]\n'
      // `x` is not set: Nota has no list; a reference that shows one is a difference
      const p = compareWith(t, [
        node({ context: 'ulist', line: 2, content_model: 'compound', list_level: 0, items: 1 }),
        node({ context: 'list_item', line: 2, depth: 1, marker: '*', text_lines: 1 }),
      ])
      expect(p.differences).toEqual([
        expect.objectContaining({ line: 2, kind: 'list', field: 'presence', a: null, b: 'ulist' }),
      ])
      expect(p.outOfScope['preprocessor-directives']).toBe(0)
    })

    it('compares the structure of a block whose attribute list has a reference, and only skips its attributes', () => {
      const t = '[{style}]\n== Section\n\n[{style}]\nText.\n'
      const p = compareWith(t, [
        node({ context: 'section', line: 2, level: 2, title: 'Section', style: 'appendix', id: 'x' }),
        node({ context: 'paragraph', line: 5, lines: 3, style: 'quote' }),
      ])
      expect(p.differences).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ line: 2, kind: 'section', field: 'level', a: 1, b: 2 }),
          expect.objectContaining({ line: 5, kind: 'paragraph', field: 'lines', a: 1, b: 3 }),
        ]),
      )
      expect(p.differences.filter((d) => d.kind === 'attributes')).toEqual([])
      expect(p.outOfScope['attribute-references']).toBe(2)
    })

    it('skips the target of a macro with a reference', () => {
      const p = compareWith('image::{dir}/a.png[]\n', [
        node({ context: 'image', line: 1, content_model: 'empty', target: '/a.png', named: { alt: 'a' } }),
      ])
      expect(p.differences).toEqual([])
      expect(p.outOfScope['attribute-references']).toBeGreaterThan(0)
    })

    it('reads the first line without a byte order mark when looking for delimiters', () => {
      const p = compareWith('\uFEFF....\ncode\n....\n', [
        node({ context: 'literal', line: 1, content_model: 'verbatim', lines: 1, style: 'literal' }),
      ])
      expect(p.differences).toEqual([])
      expect(p.compared.delimited).toBe(1)
    })

    it('still compares a section the reference finds', () => {
      const p = compareWith('Text.\n\n== Section\n', [
        node({ context: 'paragraph', line: 1, lines: 1 }),
        node({ context: 'section', line: 3, level: 2, title: 'Section', style: null }),
      ])
      expect(p.differences).toContainEqual(
        expect.objectContaining({ line: 3, kind: 'section', field: 'level' }),
      )
    })

    it('takes a line that the reference reports late for the line before dropped directive lines', () => {
      // Asciidoctor gives the list the line of the `endif` that follows it
      const t = ':x:\n\nifdef::x[]\n* item\nendif::[]\n\nText.\n'
      const p = compareWith(
        t,
        [
          node({ context: 'ulist', line: 5, content_model: 'compound', list_level: 0, items: 1 }),
          node({ context: 'list_item', line: 5, depth: 1, marker: '*', text_lines: 1 }),
          node({ context: 'paragraph', line: 7, lines: 1 }),
        ],
        (nota) => (nota.entries = []),
      )
      expect(p.differences).toEqual([])
    })
  })

  describe('lists, blocks and macros: a changed nota output is found', () => {
    const doc = [
      '= Title',
      '',
      '== Section',
      '',
      '* one',
      '** nested',
      '* two',
      '+',
      '----',
      'code',
      '----',
      '* [x] done',
      '',
      'term:: definition',
      '',
      '====',
      'inside',
      '====',
      '',
      'image::a.png[Alt]',
      '',
      "'''",
      '',
      '> a quote',
      '',
      '```ruby',
      'x',
      '```',
      '',
      '====',
      '--',
      'inner',
      '--',
      '====',
      '',
    ].join('\n')
    const attributes = { sectids: null }
    const fresh = () => structuredClone(notaDump(parse(doc, { attributes }), 'x.adoc'))
    const at = (d: DumpFile, line: number, context?: string) =>
      d.nodes!.find((n) => n.line === line && (!context || n.context === context))!
    /** The node and everything below it. */
    const withDescendants = (d: DumpFile, node: DumpNode) => {
      const i = d.nodes!.indexOf(node)
      let j = i + 1
      while (j < d.nodes!.length && (d.nodes![j]!.depth ?? 0) > (node.depth ?? 0)) j++
      return d.nodes!.slice(i, j)
    }

    const cases: [
      string,
      (d: DumpFile) => void,
      Partial<{ line: number; kind: string; field: string; a: unknown; b: unknown }>,
    ][] = [
      [
        'a missing item',
        (d) => {
          const drop = new Set(withDescendants(d, at(d, 7, 'list_item')))
          d.nodes = d.nodes!.filter((n) => !drop.has(n))
        },
        { line: 7, kind: 'item', field: 'presence', a: null, b: 'list_item' },
      ],
      [
        'an extra item',
        (d) => {
          const k = d.nodes!.indexOf(at(d, 12, 'list_item'))
          d.nodes!.splice(k + 1, 0, { ...at(d, 12, 'list_item'), line: 13 })
        },
        { line: 13, kind: 'item', field: 'presence', a: 'list_item', b: null },
      ],
      [
        'an item in another list',
        (d) => (at(d, 7, 'list_item').depth = 3),
        { line: 7, kind: 'item', field: 'presence', a: 'list_item', b: null },
      ],
      [
        'a list level',
        (d) => (at(d, 6, 'ulist').list_level = 2),
        { line: 6, kind: 'list', field: 'list level', a: 2, b: 1 },
      ],
      [
        'the item count of a list',
        (d) => (at(d, 5, 'ulist').items = 4),
        { line: 5, kind: 'list', field: 'items', a: 4, b: 3 },
      ],
      [
        'an item marker',
        (d) => (at(d, 5, 'list_item').marker = '-'),
        { line: 5, kind: 'item', field: 'marker', a: '-', b: '*' },
      ],
      [
        'a checkbox',
        (d) => (at(d, 12, 'list_item').checkbox = false),
        { line: 12, kind: 'item', field: 'checkbox', a: false, b: true },
      ],
      [
        'a checked state',
        (d) => (at(d, 12, 'list_item').checked = false),
        { line: 12, kind: 'item', field: 'checked', a: false, b: true },
      ],
      [
        'lines of item text',
        (d) => (at(d, 5, 'list_item').text_lines = 2),
        { line: 5, kind: 'item', field: 'text lines', a: 2, b: 1 },
      ],
      [
        'terms',
        (d) => (at(d, 14, 'list_item').terms = ['other']),
        { line: 14, kind: 'item', field: 'terms', a: ['other'], b: ['term'] },
      ],
      [
        'a block inside a compound block moved out',
        (d) => (at(d, 17, 'paragraph').depth = 1),
        { line: 17, kind: 'paragraph', field: 'presence', a: 'paragraph', b: null },
      ],
      [
        'a block outside a compound block that is not seen',
        (d) => (d.nodes = d.nodes!.filter((n) => n.line !== 20)),
        { line: 20, kind: 'macro', field: 'presence', a: null, b: 'image' },
      ],
      [
        'lines of a listing',
        (d) => (at(d, 9, 'listing').lines = 3),
        { line: 9, kind: 'delimited', field: 'lines', a: 3, b: 1 },
      ],
      [
        'the language of a listing',
        (d) => (at(d, 26, 'listing').language = 'python'),
        { line: 26, kind: 'markdown', field: 'language', a: 'python', b: 'ruby' },
      ],
      [
        'the target of a macro',
        (d) => (at(d, 20, 'image').target = 'b.png'),
        { line: 20, kind: 'macro', field: 'target', a: 'b.png', b: 'a.png' },
      ],
      [
        'the kind of a break',
        (d) => (at(d, 22, 'thematic_break').context = 'page_break'),
        { line: 22, kind: 'break', field: 'context', a: 'page_break', b: 'thematic_break' },
      ],
      [
        'the kind of a block',
        (d) => (at(d, 16, 'example').context = 'sidebar'),
        { line: 16, kind: 'delimited', field: 'context', a: 'sidebar', b: 'example' },
      ],
      [
        'a Markdown quote that nota does not see',
        (d) => (d.nodes = d.nodes!.filter((n) => n.line !== 24)),
        { line: 24, kind: 'markdown', field: 'presence', a: null, b: 'quote' },
      ],
      [
        'the end of a nested block with delimiters',
        (d) => (at(d, 31, 'open').end = 34),
        { line: 31, kind: 'delimited', field: 'end', a: 34, b: 33 },
      ],
      [
        'a nested block that is not closed',
        (d) => (at(d, 31, 'open').end = 32),
        { line: 31, kind: 'delimited', field: 'end', a: 32, b: 33 },
      ],
    ]

    for (const [name, mutate, expected] of cases) {
      it(`reports ${name} with file, line, kind, field and both values`, () => {
        const nota = fresh()
        mutate(nota)
        const result = compareFile(
          { file: 'x.adoc', text: doc, nota, refs: { ruby: fresh() } },
          emptyRegistry,
        )
        const summary = summarize([result])
        const p = summary.pairs['nota-ruby']!
        expect(p.differences).toContainEqual(expect.objectContaining({ file: 'x.adoc', ...expected }))
        expect(summary.exitCode).not.toBe(0)
        expect(formatReport(summary, { aggregate: false })).toContain(
          `x.adoc:${expected.line} ${expected.kind} ${expected.field}: nota=`,
        )
        const json = JSON.parse(toJson(summary, { aggregate: false }))
        expect(json.pairs['nota-ruby'].differences).toContainEqual(
          expect.objectContaining({ line: expected.line, kind: expected.kind, field: expected.field }),
        )
      })
    }

    it('finds no difference in the unchanged output', () => {
      const result = compareFile(
        { file: 'x.adoc', text: doc, nota: fresh(), refs: { ruby: fresh() } },
        emptyRegistry,
      )
      const p = summarize([result]).pairs['nota-ruby']!
      expect(p.differences).toEqual([])
      expect(p.compared.list).toBe(3)
      expect(p.compared.item).toBeGreaterThanOrEqual(5)
      expect(p.compared.delimited).toBeGreaterThanOrEqual(3)
      expect(p.compared.macro).toBe(1)
      expect(p.compared.break).toBe(1)
      expect(p.compared.markdown).toBe(2)
    })
  })

  describe('the end of a block with delimiters', () => {
    const t = 'Intro\n\n----\ncode\n----\n\n== Section\n\nAfter.\n'
    const fresh = (text = t) => structuredClone(notaDump(parse(text), 'x.adoc'))
    const at = (d: DumpFile, line: number) => d.nodes!.find((n) => n.line === line)!
    const run = (mutate: (d: DumpFile) => void, text = t) => {
      const nota = fresh(text)
      mutate(nota)
      const summary = summarize([
        compareFile({ file: 'x.adoc', text, nota, refs: { ruby: fresh(text) } }, emptyRegistry),
      ])
      return { summary, p: summary.pairs['nota-ruby']! }
    }

    it('finds no difference in the real output', () => {
      expect(run(() => {}).p.differences).toEqual([])
    })

    it('reports a block closed later than the text closes it, in every report format', () => {
      const { summary, p } = run((d) => (at(d, 3).end = 7))
      expect(p.differences).toContainEqual({
        file: 'x.adoc',
        line: 3,
        kind: 'delimited',
        field: 'end',
        a: 7,
        b: 5,
      })
      expect(summary.exitCode).not.toBe(0)
      expect(formatReport(summary, { aggregate: false })).toContain('x.adoc:3 delimited end: nota=7 ruby=5')
      const json = JSON.parse(toJson(summary, { aggregate: false }))
      expect(json.pairs['nota-ruby'].differences).toContainEqual(
        expect.objectContaining({ line: 3, kind: 'delimited', field: 'end', a: 7, b: 5 }),
      )
    })

    it('reports a block closed earlier than the text closes it', () => {
      const { p } = run((d) => (at(d, 3).end = 4))
      expect(p.differences).toContainEqual(
        expect.objectContaining({ line: 3, kind: 'delimited', field: 'end', a: 4, b: 5 }),
      )
    })

    it('ends a block that is not closed at the end of the file, or at the end of its container', () => {
      expect(run(() => {}, 'Intro\n\n----\ncode\n').p.differences).toEqual([])
      const nested = '====\n--\ntext\n====\n'
      expect(run(() => {}, nested).p.differences).toEqual([])
      // the open block runs to the line before the closing line of the example, not to the end of the file
      const wrong = run((d) => (d.nodes!.find((n) => n.context === 'open')!.end = 4), nested)
      expect(wrong.p.differences).toContainEqual(
        expect.objectContaining({ line: 2, kind: 'delimited', field: 'end', a: 4, b: 3 }),
      )
    })

    it('does not check a block whose closing line depends on a condition', () => {
      const cond = '----\nifdef::x[]\n----\nendif::[]\ncode\n----\n\n== Section\n'
      const { p } = run((d) => (d.nodes!.find((n) => n.context === 'listing')!.end = 6), cond)
      expect(p.differences).toEqual([])
    })
  })

  describe('attribute entries in nested readers', () => {
    const t = '====\n:a: 1\n\ntext\n\n:b: 2\n====\n'
    const compareEntries = (mutate: (nota: DumpFile, ref: DumpFile) => void) => {
      const nota = notaDump(parse(t), 'x.adoc')
      const ref = structuredClone(nota)
      mutate(nota, ref)
      return summarize([compareFile({ file: 'x.adoc', text: t, nota, refs: { ruby: ref } }, emptyRegistry)])
        .pairs['nota-ruby']!
    }

    it('pairs them by order, whatever lines the references report', () => {
      // the references report the lines of a nested reader, which drift
      const p = compareEntries((_, ref) => ref.entries!.forEach((e) => (e.line += 1)))
      expect(p.differences).toEqual([])
      expect(p.compared.entries).toBe(2)
    })

    it('reports an entry that one side does not see, and a changed value', () => {
      const missing = compareEntries((_, ref) => (ref.entries = ref.entries!.slice(0, 1)))
      expect(missing.differences).toContainEqual(
        expect.objectContaining({ kind: 'entries', field: 'presence', a: 'b', b: null }),
      )
      const changed = compareEntries((_, ref) => (ref.entries![0]!.value = 'changed'))
      expect(changed.differences).toContainEqual(
        expect.objectContaining({ line: 2, kind: 'entries', field: 'value', a: '1', b: 'changed' }),
      )
    })
  })

  describe('registry entries with a style', () => {
    const registry = {
      differences: [
        {
          id: 'special-level-0',
          between: [['nota', 'js']] as [Side, Side][],
          kind: 'section' as const,
          field: 'level',
          style: '^"appendix"$',
          a: '^1$',
          b: '^0$',
          description: 'test',
          link: 'https://example.org/',
        },
      ],
    }
    const sectionDump = (level: number, style: string | null): DumpFile => ({
      file: 'x.adoc',
      header: { title: null, authors: [], revision: null },
      entries: [],
      nodes: [
        {
          context: 'section',
          line: 2,
          parent: 0,
          level,
          title: 'S',
          style,
          id: null,
          roles: [],
          options: [],
          named: {},
        },
      ],
    })
    const run = (notaLevel: number, style: string | null) => {
      const t = style ? `[${style}]\n= S\n` : '\n= S\n'
      const nota = sectionDump(notaLevel, style)
      const result = compareFile(
        { file: 'x.adoc', text: t, nota, refs: { js: sectionDump(0, style) } },
        registry,
      )
      return summarize([result]).pairs['nota-js']!
    }

    it('explains a difference on a section with the style', () => {
      const p = run(1, 'appendix')
      expect(p.differences).toEqual([])
      expect(p.known).toHaveLength(1)
    })

    it('does not explain the same difference on a section with another style', () => {
      const p = run(1, null)
      expect(p.known).toEqual([])
      expect(p.differences).toContainEqual(expect.objectContaining({ kind: 'section', field: 'level' }))
    })
  })

  it('prints only numbers with --aggregate', () => {
    const { summary } = run((d) => (d.nodes!.find((n) => n.title === 'Sub')!.title = 'ZZMARK7f3c'))
    const text = formatReport(summary, { aggregate: true }) + toJson(summary, { aggregate: true })
    expect(text).not.toContain('ZZMARK7f3c')
    expect(text).not.toContain(file)
    expect(text).toMatch(/section/)
  })
})

describe('the registry: the line of a cell of a table inside a cell (js-cell-document-line)', () => {
  const doc = '|===\na|\n!===\n!x\n!===\n\nb|\n!===\n!y\n!===\n|===\n'
  const registry = registryJson as unknown as Registry
  const cellsOf = (d: DumpFile) => {
    const out: DumpCell[] = []
    const walk = (nodes: DumpNode[] | undefined, inCell: boolean) => {
      for (const n of nodes ?? [])
        if (n.table)
          for (const rows of Object.values(n.table.rows))
            for (const cells of rows)
              for (const c of cells) {
                if (inCell) out.push(c)
                walk(c.blocks, true)
              }
    }
    walk(d.nodes, false)
    return out
  }
  const pairs = (mutate: (js: DumpFile) => void, file = 'any-corpus-file.adoc') => {
    const nota = notaDump(parse(doc), file)
    const js = structuredClone(nota)
    mutate(js)
    const r = summarize([
      compareFile({ file, text: doc, nota, refs: { ruby: structuredClone(nota), js } }, registry),
    ])
    return r.pairs
  }

  it('explains a nested cell line that js numbers inside the cell, in any file and for a line of any size', () => {
    let changed = 0
    const p = pairs((js) =>
      cellsOf(js).forEach((c) => {
        c.line = 2
        changed++
      }),
    )
    expect(changed).toBeGreaterThan(0)
    expect(p['nota-js']!.differences).toEqual([])
    expect(p['nota-js']!.known.length).toBeGreaterThan(0)
    expect(p['ruby-js']!.differences).toEqual([])
  })

  it('does not explain a nested cell line that js numbers equal to or above the line of nota', () => {
    for (const shift of [0, 1]) {
      let changed = 0
      const p = pairs((js) =>
        cellsOf(js).forEach((c) => {
          c.line = (c.line ?? 0) + shift
          changed++
        }),
      )
      expect(changed).toBeGreaterThan(0)
      if (shift === 0) {
        expect(p['nota-js']!.differences).toEqual([])
        continue
      }
      expect(p['nota-js']!.differences.some((d) => d.kind === 'table' && d.field === 'line')).toBe(true)
    }
  })

  it('does not explain the line of a cell of a table that is not in a cell, or other fields of a nested cell', () => {
    const top = pairs((js) => {
      for (const rows of Object.values(js.nodes!.find((n) => n.table)!.table!.rows))
        for (const cells of rows) for (const c of cells) c.line = (c.line ?? 0) + 40
    })
    expect(top['nota-js']!.differences.some((d) => d.field === 'line')).toBe(true)
    const other = pairs((js) => cellsOf(js).forEach((c) => (c.colspan = 3)))
    expect(other['nota-js']!.differences.some((d) => d.field === 'colspan')).toBe(true)
  })

  it('does not explain a difference between nota and Ruby', () => {
    const nota = notaDump(parse(doc), 'x.adoc')
    const ruby = structuredClone(nota)
    cellsOf(ruby).forEach((c) => (c.line = (c.line ?? 0) + 1))
    const r = summarize([compareFile({ file: 'x.adoc', text: doc, nota, refs: { ruby } }, registry)])
    expect(r.pairs['nota-ruby']!.differences.some((d) => d.field === 'line')).toBe(true)
  })
})

describe('nota extractor', () => {
  it('does not give metadata that ends the document to the section before it', () => {
    const dump = notaDump(parse('== Section\n\nText.\n\n[comment]\n'), 'x.adoc')
    expect(dump.nodes!.find((n) => n.context === 'section')).toMatchObject({ style: null, id: null })
  })

  it('does not give metadata that ends a section to that section', () => {
    const dump = notaDump(parse('== One\n\nText.\n\n[#late.role]\n.Title\n== Two\n'), 'x.adoc')
    const one = dump.nodes!.find((n) => n.title === 'One')!
    expect(one).toMatchObject({ id: null, roles: [] })
    const two = dump.nodes!.find((n) => n.title === 'Two')!
    expect(two).toMatchObject({ id: 'late', roles: ['role'] })
  })
})

describe('compare of the HTML', () => {
  const source = [
    '= Title',
    '',
    '== Section One',
    '',
    'A *strong* word & https://example.com/a[a link] and a footnote:[The note].',
    '',
    '== Section Two',
    '',
    'Text.',
    '',
  ].join('\n')
  const name = 'html.adoc'
  const base = (): DumpFile => structuredClone(notaDump(parse(source), name))
  const find = (blocks: HtmlBlock[], line: number): HtmlBlock | undefined => {
    for (const b of blocks) {
      if (b.line === line && b.context === 'paragraph') return b
      const inner = find(b.blocks, line)
      if (inner) return inner
    }
    return undefined
  }

  function compareWith(mutate: (d: DumpFile) => void) {
    const nota = base()
    mutate(nota)
    const result = compareFile({ file: name, text: source, nota, refs: { ruby: base() } }, emptyRegistry)
    return summarize([result]).pairs['nota-ruby']!
  }

  it('finds no difference between equal HTML and counts the blocks by context', () => {
    const p = compareWith(() => {})
    expect(p.differences).toEqual([])
    expect(p.compared.html).toBe(5)
    expect(p.matched.html).toBe(5)
    expect(p.htmlBlocks.paragraph).toEqual({ compared: 2, matched: 2, differences: 0, outOfScope: 0 })
    expect(p.htmlBlocks.section!.compared).toBe(2)
    expect(p.htmlBlocks.document!.compared).toBe(1)
  })

  // what Nota could get wrong in an inline construct, and what the difference says about it
  const mutations: [string, (b: HtmlBlock) => void, RegExp, RegExp][] = [
    [
      'a missing <strong>',
      (b) => (b.html = b.html.replace('<strong>strong</strong>', 'strong')),
      /A strong word/,
      /<strong>strong/,
    ],
    [
      'an extra element',
      (b) => (b.html = b.html.replace('word', '<em>word</em>')),
      /<em>word/,
      /strong<\/strong> word/,
    ],
    [
      'a wrong href',
      (b) => (b.html = b.html.replace('https://example.com/a', 'https://example.com/b')),
      /example.com\/b/,
      /example.com\/a/,
    ],
    [
      'wrong escaping of an ampersand',
      (b) => (b.html = b.html.replace('&amp;', '&')),
      /word & <a/,
      /word &amp; <a/,
    ],
    ['extra text', (b) => (b.html = b.html.replace('a link', 'a link!')), /a link!/, /a link<\/a>/],
    [
      'a wrong footnote number',
      (b) => (b.html = b.html.replaceAll('_footnoteref_1', '_footnoteref_2')),
      /footnoteref_2/,
      /footnoteref_1/,
    ],
  ]
  for (const [what, mutate, ruby, expected] of mutations) {
    it(`reports ${what} with the file, the line, the kind and the first differing piece`, () => {
      const p = compareWith((d) => mutate(find(d.html!.blocks, 5)!))
      expect(p.differences).toHaveLength(1)
      const d = p.differences[0]!
      expect(d).toMatchObject({ file: name, line: 5, kind: 'html', field: 'paragraph' })
      expect(String(d.a)).toMatch(ruby)
      expect(String(d.b)).toMatch(expected)
      expect(summarize([{ file: name, pairs: [p] }]).exitCode).toBe(1)
    })
  }

  it('reports a wrong id of a section on the section', () => {
    const p = compareWith((d) => {
      const section = d.html!.blocks.find((b) => b.context === 'section')!
      section.html = section.html.replace('id="_section_one"', 'id="_section-one"')
    })
    expect(p.differences).toEqual([
      expect.objectContaining({
        line: 3,
        kind: 'html',
        field: 'section',
        a: expect.stringContaining('_section-one'),
      }),
    ])
  })

  it('reports a difference in the footnotes of the document on the document', () => {
    const p = compareWith((d) => (d.html!.doc = d.html!.doc.replace('The note', 'A note')))
    expect(p.differences).toEqual([expect.objectContaining({ kind: 'html', field: 'document' })])
  })

  it('does not count differences in white space', () => {
    const p = compareWith((d) => {
      const b = find(d.html!.blocks, 5)!
      b.html = b.html
        .replace('<div class="paragraph">', '<div class="paragraph">\n\n  ')
        .replace('</p>', '</p>\n\n   ')
    })
    expect(p.differences).toEqual([])
  })

  it('counts a lost space between inline elements, which shows on the page', () => {
    expect(normalizeHtml('<strong>a</strong> <em>b</em>')).not.toBe(
      normalizeHtml('<strong>a</strong><em>b</em>'),
    )
    expect(normalizeHtml('<p>a <b>b</b> <i>c</i></p>')).toBe(normalizeHtml('<p>a  <b>b</b>\n<i>c</i></p>'))
    // between block elements white space is not shown
    expect(normalizeHtml('<div>\n<p>a</p>\n</div>\n<div>x</div>')).toBe(
      normalizeHtml('<div><p>a</p></div><div>x</div>'),
    )
    const p = compareWith((d) => {
      const b = find(d.html!.blocks, 5)!
      b.html = b.html.replace('</a> and', '</a>and')
    })
    expect(p.differences).toHaveLength(1)
  })

  it('compares the content of <pre> to the letter', () => {
    const pre = '<div class="listingblock"><div class="content"><pre>a\n  b</pre></div></div>'
    expect(normalizeHtml(pre)).not.toBe(normalizeHtml(pre.replace('\n  ', '\n')))
    expect(normalizeHtml(pre)).not.toBe(normalizeHtml(pre.replace('a\n', 'a ')))
    expect(normalizeHtml(pre)).toBe(
      normalizeHtml(
        pre.replace('<div class="content">', '<div class="content">\n').replace('</pre>', '</pre>\n'),
      ),
    )
  })

  it('reports a lost indent in a listing', () => {
    const text = '----\n  indented\n----\n'
    const nota = structuredClone(notaDump(parse(text), 'l.adoc'))
    const ruby = structuredClone(nota)
    const listing = (d: DumpFile) => d.html!.blocks.find((b) => b.context === 'listing')!
    expect(listing(nota).html).toContain('  indented')
    listing(nota).html = listing(nota).html.replace('  indented', 'indented')
    const p = summarize([compareFile({ file: 'l.adoc', text, nota, refs: { ruby } }, emptyRegistry)]).pairs[
      'nota-ruby'
    ]!
    expect(p.differences).toEqual([expect.objectContaining({ kind: 'html', field: 'listing' })])
  })

  it('compares the HTML of a table with the reference', () => {
    const table = '= T\n\n|===\n|a\n|===\n\nafter\n'
    const html = '<table class="tableblock frame-all grid-all stretch"><tr><td>a</td></tr></table>'
    const nota = structuredClone(notaDump(parse(table), name))
    nota.html!.blocks.find((b) => b.context === 'table')!.html = html
    const ruby = structuredClone(nota)
    let p = summarize([compareFile({ file: name, text: table, nota, refs: { ruby } }, emptyRegistry)]).pairs[
      'nota-ruby'
    ]!
    expect(p.htmlBlocks.table).toEqual({ compared: 1, matched: 1, differences: 0, outOfScope: 0 })
    expect(p.outOfScope['later-stage-blocks']).toBe(0)
    ruby.html!.blocks.find((b) => b.context === 'table')!.html = html.replace('frame-all', 'frame-sides')
    p = summarize([compareFile({ file: name, text: table, nota, refs: { ruby } }, emptyRegistry)]).pairs[
      'nota-ruby'
    ]!
    expect(p.htmlBlocks.table).toMatchObject({ compared: 1, matched: 0, differences: 1 })
    expect(p.differences).toEqual([expect.objectContaining({ kind: 'html', field: 'table' })])
  })

  it('names the shape of a difference of HTML with words of fixed lists only', () => {
    const cell = (cls: string, body: string, tag = 'td') =>
      `<table class="tableblock frame-all grid-all stretch"><thead><tr><th class="tableblock ${cls}">h</th></tr></thead><tbody><tr><td class="tableblock halign-left valign-top">x</td><${tag} class="tableblock halign-left valign-top">${body}</${tag}></tr></tbody></table>`
    const shapes = (a: string, b: string) => htmlShapes('table', normalizeHtml(a), normalizeHtml(b))
    const left = 'halign-left valign-top'
    expect(shapes(cell(left, 'a'), cell(left, 'b'))).toEqual([
      'html-shape.table.text.text.in.td',
      'html-shape.table.section.tbody',
      'html-shape.table.col.col2',
    ])
    expect(shapes(cell(left, 'a'), cell('halign-center valign-top', 'a'))[0]).toBe(
      'html-shape.table.class.halign-left.th.in.tr',
    )
    expect(shapes(cell(left, 'a'), cell(left, 'a', 'th'))[0]).toBe('html-shape.table.tag.td.th.in.tr')
    expect(shapes(cell(left, 'a'), cell(left, 'a').replace('<tbody>', '<tbody><tr></tr>'))[0]).toBe(
      'html-shape.table.tag.td./tr.in.tr',
    )
    expect(shapes('<p>a</p>', '<p>a</p><p>b</p>')[0]).toBe('html-shape.table.second-only.p.in.x')
    expect(shapes('<p>a b</p>', '<p>ab</p>')[0]).toBe('html-shape.table.text.spaces.in.p')
  })

  it('tells how two ids differ, where the block is and what the blocks are, with words of fixed lists only', () => {
    const page = (inner: string) =>
      normalizeHtml(
        `<table class="tableblock"><tbody><tr><td class="tableblock"><div class="content"><div class="paragraph"><p>a</p></div>${inner}</div></td></tr></tbody></table>`,
      )
    const d = (x: string, y: string) => htmlDetailShapes('table', page(x), page(y))
    const para = (id: string) => `<div id="${id}" class="paragraph"><p>t</p></div>`
    const suffix = d(para('_sec_2'), para('_sec_3'))
    expect(suffix).toContain('html-shape.table.idkind.suffix-number')
    expect(suffix).toContain('html-shape.table.idkind.first-lower-1')
    expect(suffix).toContain('html-shape.table.idblock.paragraph.paragraph')
    expect(suffix).toContain('html-shape.table.pos.n1')
    expect(suffix).toContain('html-shape.table.in-class.content')
    expect(suffix).toContain('html-shape.table.prev.paragraph')
    expect(suffix).toContain('html-shape.table.cells.n1')
    expect(suffix).toContain('html-shape.table.tables.n1')
    expect(d(para('a'), '<div class="paragraph"><p>t</p></div>')).toContain(
      'html-shape.table.idkind.none-second',
    )
    expect(d(para(''), para('a'))).toContain('html-shape.table.idkind.empty-first')
    expect(d(para('x'), para('y'))).toContain('html-shape.table.idkind.other')
    expect(d(para('_a'), para('a'))).toContain('html-shape.table.idkind.prefix')
    const other = d(
      '<div class="paragraph r1"><p>t</p></div>',
      '<table class="tableblock"><tbody><tr><td><p>x</p></td></tr></tbody></table>',
    )
    expect(other).toContain('html-shape.table.block.paragraph.tableblock')
    expect(other).toContain('html-shape.table.role.has.no')
    expect(other).toContain('html-shape.table.child.p.none.tbody.none')
    expect(idKinds('a', 'a')).toEqual([])
    expect(idKinds('s_10', 's')).toEqual(['suffix-number', 'first-higher-many'])
    for (const k of [...suffix, ...other]) expect(isShapeKey(k)).toBe(true)
  })

  it('has the shapes of HTML differences in the aggregates, and nothing of the text in them', () => {
    const table = '= T\n\n|===\n|a\n|===\n\nafter\n'
    const html = (cls: string, text: string) =>
      `<table class="tableblock frame-all"><tbody><tr><td class="tableblock ${cls}">${text}</td></tr></tbody></table>`
    const nota = structuredClone(notaDump(parse(table), name))
    nota.html!.blocks.find((b) => b.context === 'table')!.html = html('halign-left', 'ZZMARK7f3c')
    const ruby = structuredClone(nota)
    ruby.html!.blocks.find((b) => b.context === 'table')!.html = html(
      'halign-left zz-ZZMARK7f3c',
      'ZZMARK7f3c',
    )
    const summary = summarize([compareFile({ file: name, text: table, nota, refs: { ruby } }, emptyRegistry)])
    const out = formatReport(summary, { aggregate: true }) + toJson(summary, { aggregate: true })
    expect(out).not.toContain('ZZMARK7f3c')
    expect(out).toContain('html-shape.table.class.x.td')
    expect(out).toContain('html-shape.table.col.col1')
  })

  it('reports blocks that the two sides do not have in common', () => {
    const p = compareWith((d) => d.html!.blocks[0]!.blocks.pop())
    expect(p.differences).toContainEqual(expect.objectContaining({ kind: 'html', field: 'section' }))
  })

  it('prints only numbers about HTML with --aggregate', () => {
    const p = compareWith((d) => {
      const b = find(d.html!.blocks, 5)!
      b.html = b.html.replace('word', 'ZZMARK7f3c')
    })
    const summary = summarize([{ file: name, pairs: [p] }])
    expect(p.differences[0]!.a).toEqual(expect.stringContaining('ZZMARK7f3c'))
    const out = formatReport(summary, { aggregate: true }) + toJson(summary, { aggregate: true })
    expect(out).not.toContain('ZZMARK7f3c')
    expect(out).not.toContain(name)
    expect(out).toMatch(/html paragraph: compared 2, matched 1, differences 1/)
  })

  it('has the counters of the HTML in the report and in the JSON', () => {
    const p = compareWith(() => {})
    const summary = summarize([{ file: name, pairs: [p] }])
    expect(formatReport(summary, { aggregate: false })).toMatch(
      /html paragraph: compared 2, matched 2, differences 0, out of scope 0/,
    )
    expect(JSON.parse(toJson(summary, { aggregate: false })).pairs['nota-ruby'].htmlBlocks.paragraph).toEqual(
      {
        compared: 2,
        matched: 2,
        differences: 0,
        outOfScope: 0,
      },
    )
  })
})

describe('the registry: a form of the registry is taken out before the rest of the block is compared', () => {
  const registry = registryJson as unknown as Registry
  const name = 'forms.adoc'
  const table = '[cols="30%,70%"]\n|===\n|a |b\n|c |d\n|===\n'
  const list = '7. seven\n8. eight\n'
  const nota = (doc: string) => notaDump(parse(doc), name)

  /** The HTML of the dump with `fn` applied to the document and to every block (the blocks stay consistent). */
  function mapHtml(d: DumpFile, fn: (s: string) => string): DumpFile {
    const out = structuredClone(d)
    const walk = (b: HtmlBlock) => {
      if (b.html !== undefined) b.html = fn(b.html)
      b.blocks.forEach(walk)
    }
    out.html!.doc = fn(out.html!.doc)
    out.html!.blocks.forEach(walk)
    return out
  }
  /** The pairs of Nota against Ruby (equal to Nota) and Asciidoctor.js (Nota's HTML changed by `fn`). */
  function pairs(doc: string, fn: (s: string) => string, ruby?: (s: string) => string) {
    const r = nota(doc)
    const refs = { ruby: ruby ? mapHtml(r, ruby) : structuredClone(r), js: mapHtml(r, fn) }
    return summarize([compareFile({ file: name, text: doc, nota: r, refs }, registry)]).pairs
  }
  const jsCols = (s: string) =>
    s
      .replace(/<col style="width: ([0-9.]+%);">/g, '<col width="$1"></col>')
      .replace(/(<table[^>]*) style="width: ([0-9.]+%);"/g, '$1 width="$2"')
  const jsStart = (s: string) => s.replace('<ol class="arabic">', '<ol class="arabic" start="7">')

  it('counts a block that differs only in the width of the table and the columns as known', () => {
    for (const doc of [
      table,
      '[width=50%,cols="1,~"]\n|===\n|a |b\n|===\n',
      '[width=75%,cols="1,2,3"]\n|===\n|a |b |c\n|===\n',
    ]) {
      const p = pairs(doc, jsCols)
      for (const key of ['nota-js', 'ruby-js']) {
        expect(p[key]!.differences, doc).toEqual([])
        expect(
          p[key]!.known.map((d) => d.known),
          doc,
        ).toContain('js-table-width-attribute')
      }
      expect(p['nota-ruby']!.differences).toEqual([])
    }
  })

  it('reports another difference further in the table, after the width of the columns', () => {
    for (const [from, to] of [
      ['<p class="tableblock">d</p>', '<p class="tableblock">D</p>'],
      [
        '<td class="tableblock halign-left valign-top"><p class="tableblock">c',
        '<td class="tableblock halign-right valign-top"><p class="tableblock">c',
      ],
      ['</tbody>', '<tr></tr></tbody>'],
    ] as const) {
      const p = pairs(table, (s) => jsCols(s).replace(from, to))
      for (const key of ['nota-js', 'ruby-js']) {
        const d = p[key]!.differences.filter((x) => x.kind === 'html' && x.field === 'table')
        expect(d.length, from).toBe(1)
        // the first difference is the later place, not the width
        expect(JSON.stringify(d[0]!.b)).not.toContain('width')
        expect(p[key]!.known.filter((x) => x.field === 'table')).toEqual([])
      }
    }
  })

  it('does not take out a column width that is not the same number, or a width that Ruby does not write that way', () => {
    const other = (s: string) => jsCols(s).replace('<col width="30%">', '<col width="31%">')
    expect(pairs(table, other)['nota-js']!.differences.some((d) => d.field === 'table')).toBe(true)
    // the reference is Nota itself here: a `col` with a width attribute on its side is no form of the entry
    const p = pairs(table, (s) => s, jsCols)
    expect(p['ruby-js']!.known).toEqual([])
    expect(p['nota-ruby']!.differences.some((d) => d.field === 'table')).toBe(true)
  })

  it('counts a list that differs only in start or in type as known, and the next difference of the list as new', () => {
    const p = pairs(list, jsStart)
    expect(p['nota-js']!.differences).toEqual([])
    expect(p['nota-js']!.known.map((d) => d.known)).toContain('js-olist-start-attribute')
    const upper = 'I) one\nII) two\n'
    const q = pairs(upper, (s) => s.replace('<ol class="upperroman">', '<ol class="upperroman" type="I">'))
    expect(q['nota-js']!.differences).toEqual([])
    expect(q['nota-js']!.known.map((d) => d.known)).toContain('js-olist-implicit-type-attribute')
    for (const [doc, fn] of [
      [list, (s: string) => jsStart(s).replace('<p>eight</p>', '<p>Eight</p>')],
      [list, (s: string) => jsStart(s).replace('class="arabic"', 'class="arabic big"')],
      [
        upper,
        (s: string) =>
          s.replace('<ol class="upperroman">', '<ol class="upperroman" type="I">').replace('two', 'three'),
      ],
    ] as const) {
      const r = pairs(doc, fn)['nota-js']!
      const d = r.differences.filter((x) => x.field === 'olist')
      expect(d.length).toBe(1)
      expect(JSON.stringify(d[0]!.b)).not.toMatch(/start=|type=/)
      expect(r.known.filter((x) => x.field === 'olist')).toEqual([])
    }
  })

  it('does not take out a start or a type that the other side writes, with another value', () => {
    const r = pairs(list, jsStart, (s) => s.replace('<ol class="arabic">', '<ol class="arabic" start="5">'))
    expect(r['ruby-js']!.differences.some((d) => d.field === 'olist')).toBe(true)
    const t = pairs('[loweralpha]\n. a\n. b\n', (s) =>
      s.replace('class="loweralpha"', 'class="loweralpha" type="i"'),
    )
    expect(t['nota-js']!.differences.some((d) => d.field === 'olist')).toBe(true)
  })

  it('does not take out a start or a style written in the source when nota lost it and the references write it', () => {
    const lose = (doc: string, add: (s: string) => string) => {
      const strip = (s: string) => s.replace(/(<ol\b[^>]*?) (?:start|type)="[^"]*"/g, '$1')
      const r = nota(doc)
      const lost = mapHtml(r, strip)
      const written = mapHtml(r, (s) => add(strip(s)))
      return summarize([
        compareFile(
          { file: name, text: doc, nota: lost, refs: { ruby: written, js: structuredClone(written) } },
          registry,
        ),
      ]).pairs
    }
    const cases = [
      [
        '[cols="1a"]\n|===\n|\n[start=5]\n. a\n|===\n',
        (s: string) => s.replace('<ol class="arabic">', '<ol class="arabic" start="5">'),
      ],
      [
        '[cols="1a"]\n|===\n|\n[loweralpha]\n. a\n|===\n',
        (s: string) => s.replace('<ol class="loweralpha">', '<ol class="loweralpha" type="a">'),
      ],
      [
        '[start=5]\n. a\n. b\n',
        (s: string) => s.replace('<ol class="arabic">', '<ol class="arabic" start="5">'),
      ],
      [
        '[loweralpha]\n. a\n. b\n',
        (s: string) => s.replace('<ol class="loweralpha">', '<ol class="loweralpha" type="a">'),
      ],
    ] as const
    for (const [doc, add] of cases) {
      const p = lose(doc, add)['nota-js']!
      expect(
        p.differences.some((d) => d.field === 'olist' || d.field === 'table'),
        doc,
      ).toBe(true)
      expect(
        p.known.filter((d) => d.field === 'olist' || d.field === 'table'),
        doc,
      ).toEqual([])
    }
  })

  it('explains the start of an ordered list next to other named attributes, and nothing else in them', () => {
    const doc = '[role=big]\n7. seven\n8. eight\n'
    const r = nota(doc)
    const attrsOf = (d: DumpFile) => d.nodes!.find((n) => n.context === 'olist')!
    const withNamed = (named: Record<string, string>, js: Record<string, string>) => {
      const a = structuredClone(r)
      const b = structuredClone(r)
      attrsOf(a).named = named
      attrsOf(b).named = js
      const res = summarize([
        compareFile({ file: name, text: doc, nota: a, refs: { ruby: structuredClone(a), js: b } }, registry),
      ])
      return res.pairs['nota-js']!
    }
    const same = withNamed({ foo: 'x' }, { foo: 'x', start: '7' })
    expect(same.differences.filter((d) => d.kind === 'attributes')).toEqual([])
    expect(same.known.some((d) => d.known === 'js-olist-start')).toBe(true)
    const other = withNamed({ foo: 'x' }, { foo: 'y', start: '7' })
    expect(other.differences.some((d) => d.kind === 'attributes' && d.field === 'named')).toBe(true)
    const word = withNamed({}, { start: 'seven' })
    expect(word.differences.some((d) => d.kind === 'attributes' && d.field === 'named')).toBe(true)
    const none = withNamed({ start: '3' }, { start: '3' })
    expect(none.differences.filter((d) => d.kind === 'attributes')).toEqual([])
  })
})

describe('the registry: the fill of a cell (nota-cell-fill-role)', () => {
  const registry = registryJson as unknown as Registry
  const name = 'fill.adoc'
  const doc = '|===\n|[.cell-yellow]##{empty}##один |два\n|[.cell-mint]##{empty}## |три\n|===\n'
  const r = notaDump(parse(doc), name)
  /** The HTML as Ruby Asciidoctor writes the labels: an empty span in the cell, not a class of the cell. */
  const ruby = (s: string) =>
    s
      .replace(/(<td class="tableblock halign-left valign-top) cell-yellow"><p class="tableblock">/g, '$1"><p class="tableblock"><span class="cell-yellow"></span>')
      .replace(/(<td class="tableblock halign-left valign-top) cell-mint"><\/td>/g, '$1"><p class="tableblock"><span class="cell-mint"></span></p></td>')
  function mapHtml(d: DumpFile, fn: (s: string) => string): DumpFile {
    const out = structuredClone(d)
    const walk = (b: HtmlBlock) => {
      if (b.html !== undefined) b.html = fn(b.html)
      b.blocks.forEach(walk)
    }
    out.html!.doc = fn(out.html!.doc)
    out.html!.blocks.forEach(walk)
    return out
  }
  const run = (fn: (s: string) => string) =>
    summarize([compareFile({ file: name, text: doc, nota: r, refs: { ruby: mapHtml(r, fn), js: mapHtml(r, fn) } }, registry)])
      .pairs['nota-ruby']!

  it('counts the span of the reference in place of the class of the cell as known', () => {
    expect(ruby(r.html!.blocks[0]!.html!)).toContain('<span class="cell-mint"></span>')
    const p = run(ruby)
    expect(p.differences).toEqual([])
    expect(p.known.map((d) => d.known)).toContain('nota-cell-fill-role')
  })

  it('reports another role, or other text in the cell as a difference', () => {
    for (const fn of [
      (s: string) => ruby(s).replace('</span>один', '</span>Один'),
      (s: string) => ruby(s).replace('cell-yellow"></span>', 'cell-red"></span>'),
    ])
      expect(run(fn).differences.some((d) => d.field === 'table'), String(fn)).toBe(true)
  })
})
