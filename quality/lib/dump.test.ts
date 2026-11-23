import { describe, expect, it } from 'vitest'
import { parse } from '@nota-adoc/core'
import { formatTree } from './dump.js'

describe('formatTree', () => {
  it('prints node names, ranges and leaf texts, indented by depth', () => {
    const text = '== A\n\nhi\n'
    expect(formatTree(parse(text))).toBe(
      [
        'Document 0-9',
        '  Section[level=1] 0-9',
        '    SectionTitle 0-5',
        '      SectionMarker 0-2 "=="',
        '      Mark 2-3 " "',
        '      TitleText 3-4 "A"',
        '      Newline 4-5 "\\n"',
        '    BlankLine 5-6 "\\n"',
        '    Paragraph 6-9',
        '      TextLine 6-9 "hi\\n"',
        '',
      ].join('\n'),
    )
  })

  it('prints the kind of a block with delimiters', () => {
    expect(formatTree(parse('[NOTE]\n====\nx\n====\n'))).toContain('DelimitedBlock[kind=admonition] 0-19')
    expect(formatTree(parse('----\nx\n----\n'))).toContain('DelimitedBlock[kind=listing]')
  })

  it('lists diagnostics after the tree', () => {
    expect(formatTree(parse('----\n'))).toContain('diagnostics:\n  warning unterminated-block 0-4')
  })
})
