// the colour of the letters of every role in the stylesheet of the plugin, in both themes.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const CSS = readFileSync(join(import.meta.dirname, '../../src/webview/style.css'), 'utf8')
const PROTOTYPE = readFileSync(join(import.meta.dirname, '../../../../design/editor/prototype.html'), 'utf8')
const FIXTURE = readFileSync(join(import.meta.dirname, '../../../../quality/fixtures/editor/colors.adoc'), 'utf8')

const LETTERS = ['red', 'orange', 'green', 'teal', 'blue', 'purple', 'pink', 'gray']
const EXPECTED = {
  light: { red: '#c42b2b', orange: '#b45309', green: '#15803d', blue: '#1d4ed8', purple: '#7e22ce', pink: '#be1a80', teal: '#0f766e', gray: '#6b7280' },
  dark: { red: '#ff8f87', orange: '#f5a35c', green: '#6fe0a0', blue: '#8fb5ff', purple: '#c9a2ff', pink: '#f58ad6', teal: '#45d9d0', gray: '#a3aab6' },
}

/** the body of the block whose selector line is `head` */
const block = (head: string): string => {
  const at = CSS.indexOf(`\n${head} {`)
  expect(at, head).toBeGreaterThan(-1)
  return CSS.slice(at, CSS.indexOf('\n}', at))
}
const tokens = (body: string): Record<string, string> =>
  Object.fromEntries([...body.matchAll(/--ap-tx-(\w+): (#[0-9a-f]{6})/g)].map((m) => [m[1]!, m[2]!]))

/** the colour a piece with the role gets: the rule `.doc .hl-<c> { color: var(--ap-tx-…) }` and the token of the theme */
const computed = (theme: 'light' | 'dark', role: string): string | undefined => {
  const rule = CSS.match(new RegExp(`^\\.doc \\.${role} \\{ color: var\\((--ap-tx-\\w+)\\); \\}$`, 'm'))
  if (!rule) return undefined
  const base = tokens(block('body'))
  const own = theme === 'dark' ? { ...base, ...tokens(block('body[data-nota-theme="dark"]')) } : base
  return own[rule[1]!.slice('--ap-tx-'.length)]
}

const luminance = (hex: string): number => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!
}
const contrast = (a: string, b: string): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi! + 0.05) / (lo! + 0.05)
}

describe('the colours of the letter roles in the plugin', () => {
  for (const theme of ['light', 'dark'] as const) {
    it(`gives each of the eight roles its colour in the ${theme} theme`, () => {
      for (const c of LETTERS) expect(computed(theme, `hl-${c}`), `${theme} hl-${c}`).toBe(EXPECTED[theme][c as keyof (typeof EXPECTED)['light']])
    })

    it(`reads in the ${theme} theme: at least 4.5:1 against the page`, () => {
      const page = theme === 'light' ? '#ffffff' : '#1f1f1f'
      for (const c of LETTERS) expect(contrast(computed(theme, `hl-${c}`)!, page), `${theme} hl-${c}`).toBeGreaterThanOrEqual(4.5)
    })
  }

  it('defines each token of the letters in the light theme and in the dark one, as the prototype does', () => {
    for (const c of LETTERS) {
      for (const v of [EXPECTED.light[c as 'red'], EXPECTED.dark[c as 'red']]) expect(PROTOTYPE, c).toContain(`--ap-tx-${c}:${v}`)
    }
  })

  it('has no rule for a role that is not in the registry: [.hl-yellow], [.hl-cyan], [.hl-cyan-bg] stay plain', () => {
    for (const r of ['hl-yellow', 'hl-cyan', 'hl-cyan-bg']) expect(computed('light', r), r).toBeUndefined()
    expect(CSS).not.toMatch(/\.hl-(yellow|cyan|cyan-bg)(?![\w-])/)
  })

  it('the fixture of the sample puts each new role in a paragraph, a heading, a list item and a cell (the cell is shown as source until cell text is edited in place)', () => {
    for (const c of ['orange', 'purple', 'pink', 'teal']) {
      const lines = FIXTURE.split('\n').filter((l) => l.includes(`[.hl-${c}]#`))
      expect(lines.some((l) => l.startsWith('Цвет букв')), c).toBe(true)
      expect(lines.some((l) => l.startsWith('== ')), c).toBe(true)
      expect(lines.some((l) => l.startsWith('* ')), c).toBe(true)
      expect(lines.some((l) => l.startsWith('|')), c).toBe(true)
    }
  })
})

describe('the fills of the same set as the letters', () => {
  const FILLS = ['yellow', ...LETTERS]

  it('has a rule and a token in the light and the dark theme for each of the nine fills', () => {
    expect(FILLS).toHaveLength(9)
    for (const c of FILLS) {
      expect(CSS, c).toContain(`.doc .hl-${c}-bg { background: var(--ap-hl-${c}); }`)
      const defs = CSS.match(new RegExp(`--ap-hl-${c}: #[0-9a-f]{6}`, 'g')) ?? []
      expect(defs, c).toHaveLength(2)
      for (const d of defs) expect(PROTOTYPE, c).toContain(d.replace(': ', ':'))
    }
  })

  it('the fixture has each new fill', () => {
    for (const c of ['red', 'orange', 'teal']) expect(FIXTURE, c).toContain(`[.hl-${c}-bg]#`)
  })
})
