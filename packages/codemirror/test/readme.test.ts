import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as api from '@nota-adoc/codemirror'
import { asciidocTags, highlightTable } from '@nota-adoc/codemirror'

const readme = readFileSync(join(import.meta.dirname, '../README.md'), 'utf8')

describe('packages/codemirror/README.md', () => {
  it('names every highlight group', () => {
    for (const group of Object.keys(asciidocTags)) {
      // headings of the levels are named as a range
      if (/^heading[0-5]$/.test(group)) continue
      expect(readme, group).toContain(`\`${group}\``)
    }
    expect(readme).toContain('`heading0` … `heading5`')
  })

  it('names every node type of the highlighting table', () => {
    for (const node of new Set(highlightTable.map((r) => r.node))) expect(readme, node).toContain(`\`${node}\``)
  })

  it('documents the options of asciidoc(), of the session and of the source editor', () => {
    for (const option of ['parse', 'lint', 'xrefTargets', 'autocomplete', 'session', 'text', 'onChange', 'lineNumbers', 'extensions'])
      expect(readme, option).toContain(`| \`${option}`)
    for (const member of ['getText()', 'scrollToPos(pos)', 'topVisiblePos()', 'destroy()', 'subscribe(listener)', 'canUndo'])
      expect(readme, member).toContain(member)
  })

  it('mentions the main exports', () => {
    for (const name of ['asciidoc', 'notaDocument', 'createSession', 'createSourceEditor', 'asciidocTags', 'highlightTable', 'highlightRanges', 'foldRange', 'documentTargets', 'asciidocCompletionSource'])
      expect(Object.keys(api), name).toContain(name)
    for (const name of ['asciidoc', 'notaDocument', 'createSession', 'createSourceEditor', 'highlightTable', 'highlightRanges', 'foldRange', 'documentTargets', 'asciidocCompletionSource', 'asciidocTags'])
      expect(readme, name).toContain(name)
  })
})
