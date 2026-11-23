// documentTargets takes the ids of core by the place of the title, also when includes and cells add sections.
import { describe, expect, it } from 'vitest'
import { parse } from '@nota-adoc/core'
import { documentTargets } from '@nota-adoc/codemirror'

describe('documentTargets with sections that are not in the tree', () => {
  it('keeps the ids of core for titles with markup when a resolver includes sections', () => {
    const text = 'include::p.adoc[]\n\n== A *bold* title\n\ntext\n'
    const resolver = { include: () => '== Part\n\nx\n' }
    const doc = parse(text, { resolver })
    const s = documentTargets(doc).sections
    expect(s).toHaveLength(1)
    expect(s[0]!.id).toBe('_a_bold_title')
  })

  it('keeps the ids of core for titles with markup when a cell has a section of its own', () => {
    const text = '|===\na|\n== In cell\n\nx\n|===\n\n== A _it_ title\n'
    const doc = parse(text)
    const ids = documentTargets(doc).sections.map((x) => x.id)
    expect(ids.at(-1)).toBe('_a_it_title')
  })
})
