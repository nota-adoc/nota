// the width of the page is set by variables of the tab, not by 38rem.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const CSS = readFileSync(join(import.meta.dirname, '../../src/webview/style.css'), 'utf8')

describe('page width', () => {
  it('has no 38rem in a rule', () => expect(CSS).not.toMatch(/max-width:\s*38rem/))
  it('defines the variables', () => {
    expect(CSS).toMatch(/--nota-page-min:\s*38rem/)
    expect(CSS).toMatch(/--nota-page:\s*85cqw/)
    expect(CSS).toMatch(/--nota-page-max:\s*100cqw/)
    expect(CSS).toMatch(/--nota-gutter:\s*80px/)
  })
  it('sets the whole page from them, with the gutter from 761px and full width up to 650px', () => {
    expect(CSS).toMatch(/\.page \{ width: clamp\(var\(--nota-page-min\), var\(--nota-page\), var\(--nota-page-max\)\)/)
    expect(CSS).toMatch(/@container \(min-width: 761px\) \{\s*\.page \{ width: min\([^;]*100cqw - 2 \* var\(--nota-gutter\)\)/)
    expect(CSS).toMatch(/@container \(max-width: 650px\) \{\s*\.page \{ width: auto/)
  })
  it('does not narrow the blocks inside the page', () => {
    expect(CSS).not.toContain('--nota-measure')
    expect(CSS).not.toContain('--nota-wide')
  })
})
