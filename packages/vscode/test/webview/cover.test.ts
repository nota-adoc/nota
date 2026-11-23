// the source («Текст») scrolls under the capsules: how far they reach and which line is the first not covered.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { coverFrom, ISLES_MIN_HEIGHT, sourceTopHeight } from '../../src/webview/cover.js'

const CSS = readFileSync(join(import.meta.dirname, '../../src/webview/style.css'), 'utf8')

describe('the cover of the capsules over the source', () => {
  it('reaches down to the lowest of the row and the plate, from the top of the box', () => {
    expect(coverFrom(40, [92])).toBe(52)
    expect(coverFrom(40, [92, 140])).toBe(100)
    expect(coverFrom(40, [])).toBe(0)
    expect(coverFrom(40, [10])).toBe(0)
  })

  it('looks for the first line below the cover, and never above the start', () => {
    expect(sourceTopHeight(0, 52, 56)).toBe(0)
    expect(sourceTopHeight(300, 52, 56)).toBe(296)
    expect(sourceTopHeight(300, 100, 0)).toBe(400)
  })

  it('takes the least height of the row from the same number as the styles', () => {
    expect(CSS).toContain(`min-height: ${ISLES_MIN_HEIGHT}px`)
  })

  it('a narrow tab hides the label of the mode: the pale buttons are enough', () => {
    const narrow = CSS.slice(CSS.indexOf('@media (max-width: 640px)'))
    expect(narrow).toMatch(/\.isle-tools \.tb-note \{ display: none; \}/)
  })
})
