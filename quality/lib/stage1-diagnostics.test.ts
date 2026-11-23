import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parse } from '@nota-adoc/core'

const dir = fileURLToPath(new URL('../fixtures/stage1/', import.meta.url))

// The fixtures of stage 1 that are meant to produce a diagnostic, with its code.
const expected: Record<string, string[]> = {
  // `:doctype:` below the header: read only in the header
  'attributes-doctype-article.adoc': ['header-attribute-in-body'],
  'comments-unclosed.adoc': ['unterminated-block'],
  'delimited-unclosed.adoc': ['unterminated-block'],
  'sections-level-skip.adoc': ['section-level-skipped'],
  'sections-level0-article.adoc': ['level-0-section-in-article'],
}

describe('diagnostics on the stage 1 fixtures', () => {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.adoc'))
    .sort()

  it('finds the fixtures', () => {
    expect(files.length).toBeGreaterThanOrEqual(40)
    for (const name of Object.keys(expected)) expect(files).toContain(name)
  })

  for (const file of files) {
    it(`${file}: ${expected[file] ? expected[file].join(', ') : 'no diagnostics'}`, () => {
      const codes = parse(readFileSync(dir + file, 'utf8')).diagnostics.map((d) => d.code)
      expect(codes).toEqual(expected[file] ?? [])
    })
  }
})
