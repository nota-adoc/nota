import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { DEFAULT_ATTRIBUTES, NodeNames } from '@nota-adoc/core'

const readme = readFileSync(fileURLToPath(new URL('../README.md', import.meta.url)), 'utf8')

describe('packages/core/README.md', () => {
  it('describes every node type', () => {
    const missing = NodeNames.filter((n) => n !== '' && !readme.includes(`\`${n}\``))
    expect(missing).toEqual([])
  })

  it('lists every default attribute with its value', () => {
    for (const [name, value] of Object.entries(DEFAULT_ATTRIBUTES)) {
      const row = readme.split('\n').find((l) => l.includes(`\`${name}\``) && l.includes('|'))
      expect(row, name).toBeDefined()
      const cell = value === '' ? '(empty)' : `\`${value}\``
      expect(row!.includes(`| ${cell}`) || row!.includes(`\`${name}\` | ${cell}`), `${name} = ${cell}`).toBe(
        true,
      )
    }
  })

  it('has a row for every diagnostic code the parser gives', () => {
    for (const code of [
      'unterminated-block',
      'section-level-skipped',
      'level-0-section-in-article',
      'unterminated-conditional',
      'unmatched-endif',
      'malformed-directive',
      'list-item-as-text',
      'list-item-index',
      'unknown-block-macro',
      'table-missing-separator',
      'table-incomplete-row',
      'table-cell-dropped',
      'duplicate-id',
      'line-read-as-attributes',
      'header-attribute-in-body',
      'unresolved-reference',
      'unresolved-include',
      'unknown-color-role',
    ])
      expect(readme, code).toContain(`| \`${code}\` |`)
  })

  it('gives the severity the parser gives for the codes of a table', () => {
    for (const code of ['table-missing-separator', 'table-incomplete-row', 'table-cell-dropped']) {
      const row = readme.split('\n').find((l) => l.startsWith(`| \`${code}\` |`))
      expect(row, code).toContain('| warning |')
    }
  })

  it('documents the options', () => {
    expect(readme).toContain('| `attributes` |')
    expect(readme).toContain('| `blockMacros` |')
    expect(readme).toContain('| `resolver` |')
  })

  it('documents the operations on blocks and the style profile', () => {
    for (const name of [
      'styleProfile()',
      'DEFAULT_STYLE_PROFILE',
      'setSectionLevel',
      'insertBlock',
      'moveBlock',
      'replaceBlock',
      'deleteBlock',
      'toggleList',
      'indentListItem',
      'outdentListItem',
      'BlockSpec',
      'fragment-invalid',
      'unexpected-kind',
      'collateral',
      'invalid-target',
      'unwritable',
    ])
      expect(readme, name).toContain(name)
  })

  it('documents the colour operations and their refusals', () => {
    for (const name of ['setColor', 'replaceColor', 'removeColor', 'invalid-role', 'not-colorable', 'empty-selection', 'inside-construct'])
      expect(readme, name).toContain(name)
  })

  it('documents the meaning of a document', () => {
    for (const name of ['asg()', 'nodeAt(', 'outline()', 'footnotes()', 'references()', 'resolver.include', 'resolver.xref'])
      expect(readme, name).toContain(name)
  })
})
