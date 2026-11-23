import fc from 'fast-check'
import { corrupt, corruption } from './generators.js'

const cellSpec = fc.constantFrom(
  '',
  '',
  '',
  '2+',
  '.2+',
  '2.3+',
  '3*',
  '^',
  '>',
  '.^',
  '.>',
  '^.>',
  's',
  'a',
  'l',
  'm',
  'e',
  'h',
  'v',
  'd',
  '2+^.>m',
  'x',
  '0+',
  '2*3+',
  '99999+',
)

const cellText = fc.oneof(
  { weight: 4, arbitrary: fc.constantFrom('a', 'b', 'text', 'x y', '1', '', ' ', '*b*', 'a\\|b') },
  {
    weight: 2,
    arbitrary: fc.constantFrom('* item', '* one\n* two', '== T', '----\ncode\n----', 'a\n\nb', ':x: y'),
  },
  {
    weight: 1,
    arbitrary: fc.constantFrom(
      '!===\n!a !b\n!===',
      '|===\n|x\n|===',
      '|====',
      ',===\n"a",b\n,===',
      '++++\n<b>\n++++',
    ),
  },
  { weight: 1, arbitrary: fc.string({ unit: 'grapheme-ascii', maxLength: 6 }) },
)

const tableAttributes = fc.constantFrom(
  '',
  '',
  '[cols="1,2"]',
  '[cols="3*"]',
  '[cols="1,2a,3"]',
  '[cols="2*,<.^3"]',
  '[%header]',
  '[%header%footer]',
  '[%noheader]',
  '[options="header",cols="~,~"]',
  '[%autowidth]',
  '[frame=none,grid=none,stripes=odd,width=75%]',
  '[width=0]',
  '[cols="1000*"]',
  '[cols=","]',
  '[cols="a,,b"]',
)

type Format = 'psv' | 'bang' | 'csv' | 'dsv' | 'tsv' | 'custom'
const DELIMITERS: Record<Format, string> = {
  psv: '|===',
  bang: '!===',
  csv: ',===',
  dsv: ':===',
  tsv: '|===',
  custom: '|===',
}
const SEPARATORS: Record<Format, string> = { psv: '|', bang: '!', csv: ',', dsv: ':', tsv: '\t', custom: '¦' }

/** A table in one of the formats (or an unclosed one), with cells that may hold a nested table. */
export const tableBlock: fc.Arbitrary<string> = fc
  .record({
    format: fc.constantFrom<Format>('psv', 'psv', 'bang', 'csv', 'dsv', 'tsv', 'custom'),
    attrs: tableAttributes,
    rows: fc.array(fc.array(fc.tuple(cellSpec, cellText), { minLength: 0, maxLength: 4 }), { maxLength: 6 }),
    blankAfterFirst: fc.boolean(),
    closed: fc.boolean(),
    oneLine: fc.boolean(),
    quoteBreak: fc.boolean(),
  })
  .map(({ format, attrs, rows, blankAfterFirst, closed, oneLine, quoteBreak }) => {
    const sep = SEPARATORS[format]
    const head = format === 'tsv' ? '[format=tsv]' : format === 'custom' ? '[separator=¦]' : attrs
    const lines = rows.map((row) =>
      row
        .map(([spec, text]) => {
          if (format === 'csv') {
            const t = text.replace(/\n/g, ' ')
            return quoteBreak ? `"${t}` : `"${t.replace(/"/g, '""')}"`
          }
          if (format === 'dsv' || format === 'tsv') return text.replace(/\n[^]*/, '')
          return `${spec}${sep}${text}`
        })
        .join(format === 'csv' || format === 'dsv' || format === 'tsv' ? sep : oneLine ? ' ' : '\n'),
    )
    if (blankAfterFirst && lines.length > 1) lines.splice(1, 0, '')
    const delim = DELIMITERS[format]
    return [head, delim, ...lines, ...(closed ? [delim] : [])].filter((l) => l !== '').join('\n')
  })

/** Documents with tables between paragraphs, with the damage of `asciidocText`. */
export const tablesText: fc.Arbitrary<string> = fc
  .record({
    tables: fc.array(tableBlock, { minLength: 1, maxLength: 4, size: 'max' }),
    between: fc.array(fc.constantFrom('', 'A paragraph.', '== Section', '* item', '[NOTE]', '----'), {
      minLength: 4,
      maxLength: 4,
    }),
    crlf: fc.boolean(),
    damage: fc.array(corruption, { maxLength: 3, size: 'max' }),
  })
  .map(({ tables, between, crlf, damage }) => {
    const parts: string[] = []
    tables.forEach((t, i) => parts.push(t, between[i] ?? ''))
    let text = parts.join('\n\n') + '\n'
    if (crlf) text = text.replace(/\n/g, '\r\n')
    for (const d of damage) text = corrupt(text, d)
    return text
  })
