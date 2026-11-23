// a fill (`mark`, `-bg` roles) has no side padding or margin, so the text does not shift when the fill is set or removed.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const FILES = {
  plugin: join(import.meta.dirname, '../../src/webview/style.css'),
  demo: join(import.meta.dirname, '../../../../demo/src/style.css'),
}

/** the declarations of the rule whose selector line starts with `selector` */
const rule = (css: string, selector: string): string => {
  const m = css.match(new RegExp(`^${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{([^}]*)\\}`, 'm'))
  expect(m, selector).not.toBeNull()
  return m![1]!
}

describe.each(Object.entries(FILES))('fill does not shift the text (%s)', (_name, file) => {
  const css = readFileSync(file, 'utf8')
  const sides = /(^|;)\s*(padding(-left|-right|-inline(-start|-end)?)?|margin(-left|-right|-inline(-start|-end)?)?)\s*:/

  it('mark (plain highlight #…#) has no side padding but keeps its background and radius', () => {
    const body = rule(css, '.doc mark')
    expect(body).toMatch(/padding:\s*0\s*;/)
    expect(body).not.toMatch(/margin/)
    expect(body).toContain('background: var(--ap-mark-background)')
    expect(body).toContain('border-radius')
  })

  it('-bg roles (paragraph, heading, list item) have no side padding', () => {
    const body = rule(css, '.doc [class*="-bg"]')
    expect(body).toMatch(/padding:\s*0\s*;/)
    expect(body).not.toMatch(/margin/)
    expect(body).toContain('box-decoration-break: clone')
  })

  it('no later rule gives a fill side padding back', () => {
    for (const m of css.matchAll(/^([^{}\n]*(\bmark\b|-bg)[^{}\n]*) \{([^}]*)\}/gm)) {
      const decl = m[3]!.replace(/padding:\s*0\s*;?/, '')
      expect(decl, m[1]).not.toMatch(sides)
    }
  })

  it('the fill colours exist in both themes', () => {
    expect(css.match(/--ap-mark-background:/g)!.length).toBeGreaterThanOrEqual(2)
  })
})
