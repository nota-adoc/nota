// the tokens `--ap-*` of the page are the ones of the approved prototype, light and dark; the three blocks of them
// (light, dark by the system, dark by the switch) agree, and every token the page uses is defined.
import { afterEach, describe, expect, it } from 'vitest'
import { external, read } from './helpers.js'

const css = read('src/style.css')

/** The text of the block that starts with `head`, up to its closing brace. */
function block(head: string): string {
  const start = css.indexOf(head)
  expect(start, head).toBeGreaterThanOrEqual(0)
  let depth = 0
  for (let i = css.indexOf('{', start); i < css.length; i++) {
    if (css[i] === '{') depth++
    else if (css[i] === '}' && --depth === 0) return css.slice(css.indexOf('{', start) + 1, i)
  }
  throw new Error(`no end of ${head}`)
}
const tokens = (text: string): Map<string, string> =>
  new Map([...text.matchAll(/(--ap-[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]))

const light = tokens(block(':root {'))
const darkBySystem = tokens(block('@media (prefers-color-scheme: dark)'))
const darkBySwitch = tokens(block(':root[data-theme="dark"]'))

afterEach(() => {
  document.head.innerHTML = ''
  document.documentElement.removeAttribute('data-theme')
})

describe('demo: the styles of the series', () => {
  it('define the tokens of the series in light: the fonts, the sizes, the surfaces, the colours of the source', () => {
    for (const name of [
      '--ap-font-ui', '--ap-font-text', '--ap-font-mono', '--ap-size-text', '--ap-measure', '--ap-bar-h', '--ap-btn', '--ap-gutter',
      '--ap-chrome', '--ap-paper', '--ap-source-bg', '--ap-rule', '--ap-ink', '--ap-accent', '--ap-accent-soft', '--ap-plate-bg',
      '--ap-notice-bg', '--ap-tip-bg', '--ap-error', '--ap-warning', '--ap-info', '--ap-active-line', '--ap-selection',
      '--ap-heading-0', '--ap-heading-5', '--ap-block-title', '--ap-attribute-name', '--ap-attr-style', '--ap-delimiter',
      '--ap-list-marker', '--ap-admonition', '--ap-raw', '--ap-macro', '--ap-comment', '--ap-directive', '--ap-mark-background',
    ])
      expect(light.has(name), name).toBe(true)
    expect(light.get('--ap-paper')).toBe('#ffffff')
    expect(light.get('--ap-accent')).toBeDefined()
  })

  it('give the dark theme the same tokens by the system and by the switch', () => {
    expect(darkBySystem.size).toBeGreaterThan(30)
    expect([...darkBySystem]).toEqual([...darkBySwitch])
    // the dark theme changes tokens of the light one, it does not add tokens of its own
    for (const name of darkBySwitch.keys()) expect(light.has(name), name).toBe(true)
    expect(darkBySwitch.get('--ap-paper')).not.toBe(light.get('--ap-paper'))
    // the system does not win over a switch to light
    expect(css).toMatch(/@media \(prefers-color-scheme: dark\)\s*\{\s*:root:not\(\[data-theme="light"\]\)/)
    expect(css.match(/^\s*color-scheme: dark;/gm)!.length).toBe(2)
  })

  it('use only tokens that are defined, and none of the prototype markup', () => {
    const used = new Set([...css.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]!))
    expect(used.size).toBeGreaterThan(20)
    // a token of the series is defined in light; a private property of the page is defined by the page itself
    for (const name of used) expect(name.startsWith('--ap-') ? light.has(name) : css.includes(`${name}:`), name).toBe(true)
    expect(css).not.toMatch(/--proto|\.proto|\.stage/)
  })

  it('name no address outside localhost', () => {
    // the namespace of an SVG in a data address is not a request
    const addresses = (css.match(new RegExp(external, 'gi')) ?? []).filter((a) => !/w3\.org/.test(a))
    expect(addresses).toEqual([])
    expect(css).not.toMatch(/@import|url\(\s*["']?https?:/)
  })

  it('are the ones the browser gets: light on the root, dark on a switch to dark', () => {
    const style = document.createElement('style')
    style.textContent = css
    document.head.append(style)
    const value = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim()
    expect(value('--ap-paper')).toBe(light.get('--ap-paper'))
    expect(value('--ap-heading-0')).toBe(light.get('--ap-heading-0'))
    document.documentElement.dataset.theme = 'dark'
    expect(value('--ap-paper')).toBe(darkBySwitch.get('--ap-paper'))
    expect(value('--ap-heading-0')).toBe(darkBySwitch.get('--ap-heading-0') ?? light.get('--ap-heading-0'))
  })
})

// the rounded corners of the selected cells, on the way of the drag and after it
describe('corners of the selected cells', () => {
  it('rounds each corner cell as the table, and no drag rule changes the look of the cells', () => {
    for (const c of ['tl', 'tr', 'bl', 'br']) {
      const side = { tl: 'top-left', tr: 'top-right', bl: 'bottom-left', br: 'bottom-right' }[c]
      expect(css).toMatch(new RegExp(`\\.sel\\.c-${c}\\s*\\{[^}]*border-${side}-radius:\\s*calc\\(var\\(--nota-tbl-radius\\) - 1px\\)`))
    }
    expect(css).toMatch(/\.tbl table\s*\{[^}]*--nota-tbl-radius:/)
    // (the rule of `::selection` is about the text, not the cells)
    for (const m of css.matchAll(/([^{}]*\.cells-(?:drag|on)(?![\w-]|\s*::selection)[^{}]*)\{([^}]*)\}/g)) {
      expect(m[2], m[1]).not.toMatch(/border-radius|box-shadow|background/)
    }
  })
})

// a merged cell keeps its lines — no `:last-child` rule cuts them
describe('lines of the merged cells', () => {
  it('draws the left and top line on every cell, cuts none by position, frames the wrapper', () => {
    const cell = css.match(/\.tbl th, \.tbl td\s*\{([^}]*)\}/)?.[1] ?? ''
    expect(cell).toMatch(/border-left:\s*1px solid/)
    expect(cell).toMatch(/border-top:\s*1px solid/)
    expect(cell).not.toMatch(/border-(right|bottom)/)
    expect(css).not.toMatch(/\.tbl[^{}]*(th|td|tr):last-child/)
    expect(css).toMatch(/\.tbl-scroll\s*\{[^}]*border:\s*1px solid/)
  })
})

// the grips stand outside the frame, the border is over the grid, the caption steps away from the frame
describe('the layer over the tables', () => {
  it('lays the grips in a band of 10 px outside the frame, shows the border by hover, and moves the caption 10 px away', () => {
    expect(css).toMatch(/\.nota-grips\s*\{[^}]*position:\s*fixed[^}]*pointer-events:\s*none/)
    expect(css).toMatch(/\.nota-grips \.cg, \.nota-grips \.rg, \.nota-grips \.bd\s*\{[^}]*pointer-events:\s*auto/)
    expect(css).toMatch(/\.nota-grips \.bd\s*\{[^}]*cursor:\s*col-resize/)
    // the hovered stroke is of the colour of a selection at 60 %, 1.67 times thicker, growing from the frame
    expect(css).toMatch(/\.nota-grips \.cg:hover::after, \.nota-grips \.rg:hover::after\s*\{[^}]*color-mix\(in srgb, var\(--g-on\) 60%, transparent\)/)
    expect(css).toMatch(/\.nota-grips \.cg:hover::after\s*\{[^}]*transform:\s*scaleY\(1\.67\);[^}]*transform-origin:\s*bottom/)
    expect(css).toMatch(/\.nota-grips \.rg:hover::after\s*\{[^}]*transform:\s*scaleX\(1\.67\);[^}]*transform-origin:\s*right/)
    expect(css).toMatch(/\.nota-grips \.bd\.limit::after\s*\{[^}]*--ap-warning/)
    expect(css).toMatch(/\.doc \.tbl-cap\s*\{[^}]*margin-bottom:\s*10px/)
    expect(css).toMatch(/\.doc\.col-drag[^{]*\{[^}]*col-resize/)
  })
})
