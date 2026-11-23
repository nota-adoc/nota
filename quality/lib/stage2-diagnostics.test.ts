import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parse } from '@nota-adoc/core'

const dir = fileURLToPath(new URL('../fixtures/stage2/', import.meta.url))

// The fixtures of stage 2 that are meant to produce diagnostics, with their codes in order. Every other
// fixture has none.
const expected: Record<string, string[]> = {
  'blocks-nesting.adoc': ['unterminated-block', 'unterminated-block'],
  'blocks-unclosed.adoc': ['unterminated-block', 'unterminated-block'],
  'blocks-unclosed-listing.adoc': ['unterminated-block'],
  'lists-checklists.adoc': ['list-item-index', 'list-item-index'],
  'lists-continuation.adoc': ['list-item-as-text'],
  'lists-dropped-lines.adoc': ['unterminated-block'],
  'lists-edge.adoc': ['list-item-as-text', 'list-item-index'],
  'lists-ordered.adoc': ['list-item-index', 'list-item-index', 'list-item-index', 'list-item-index'],
  'macros-breaks.adoc': ['unknown-block-macro', 'unknown-block-macro', 'unknown-block-macro'],
  'preprocessor-diagnostics.adoc': [
    'malformed-directive',
    'unmatched-endif',
    'malformed-directive',
    'unmatched-endif',
    'malformed-directive',
    'unmatched-endif',
    'malformed-directive',
    'unmatched-endif',
    'unmatched-endif',
    'unterminated-conditional',
    'unmatched-endif',
    'unterminated-conditional',
    'malformed-directive',
    'unterminated-conditional',
  ],
}

describe('diagnostics on the stage 2 fixtures', () => {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.adoc'))
    .sort()

  it('finds the fixtures', () => {
    expect(files.length).toBeGreaterThanOrEqual(20)
    for (const name of Object.keys(expected)) expect(files).toContain(name)
  })

  for (const file of files) {
    it(`${file}: ${expected[file] ? expected[file].join(', ') : 'no diagnostics'}`, () => {
      const codes = parse(readFileSync(dir + file, 'utf8')).diagnostics.map((d) => d.code)
      expect(codes).toEqual(expected[file] ?? [])
    })
  }

  it('has a range and a message on every diagnostic', () => {
    const text = readFileSync(dir + 'preprocessor-diagnostics.adoc', 'utf8')
    for (const d of parse(text).diagnostics) {
      expect(d.from).toBeGreaterThanOrEqual(0)
      expect(d.to).toBeGreaterThan(d.from)
      expect(d.to).toBeLessThanOrEqual(text.length)
      expect(['error', 'warning', 'info']).toContain(d.severity)
      expect(d.message.length).toBeGreaterThan(0)
    }
  })
})
