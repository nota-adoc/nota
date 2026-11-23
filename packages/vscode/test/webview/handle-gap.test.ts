// the left field of .scroll leaves room for the handle of a block and the 8 px gap before the block.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const CSS = readFileSync(join(import.meta.dirname, '../../src/webview/style.css'), 'utf8')

function leftOf(padding: string): number {
  // (a value in calc(…) has spaces inside: it is one word)
  const v = padding.trim().match(/calc\((?:[^()]|\([^)]*\))*\)|\S+/g) ?? []
  return parseFloat(v.length === 4 ? v[3]! : v.length >= 2 ? v[1]! : v[0]!)
}

describe('the field of .scroll', () => {
  it('is at least 36 px on the left in every rule, media queries included (24 px handle + 8 px gap + 4 px)', () => {
    // every `.scroll { … }` as a selector of its own, at any nesting
    const rules = [...CSS.matchAll(/(?:^|[{}\s,])\.scroll\s*\{([^}]*)\}/g)]
    expect(rules.length).toBeGreaterThanOrEqual(2) // the base rule and the one of @media (max-width: 640px)
    for (const rule of rules) {
      const padding = /(?:^|[;\s])padding:\s*([^;]+);/.exec(rule[1]!)
      if (padding) expect(leftOf(padding[1]!)).toBeGreaterThanOrEqual(36)
      expect(/padding-left:\s*([^;]+);/.exec(rule[1]!)?.[1] ?? '36px').toSatisfy((s: string) => parseFloat(s) >= 36)
    }
  })
})
