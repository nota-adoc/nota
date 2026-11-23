import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('..', import.meta.url))
const read = (file: string): string => readFileSync(root + file, 'utf8')

const packageJson = JSON.parse(read('package.json')) as { scripts: Record<string, string> }
const vitestConfig = read('vitest.config.ts')
const groups = new Set([...vitestConfig.matchAll(/name: '([^']+)'/g)].map((m) => m[1]))

/** Relative targets of the Markdown links `[text](target)` of a file (no URLs, no anchors alone). */
function relativeLinks(text: string): string[] {
  return [...text.matchAll(/\]\(([^)\s]+)\)/g)]
    .map((m) => m[1]!)
    .filter((t) => !/^[a-z][a-z0-9+.-]*:/i.test(t) && !t.startsWith('#'))
    .map((t) => t.replace(/#.*$/, '').replace(/\/$/, ''))
}

describe('AGENTS.md', () => {
  const text = read('AGENTS.md')

  it('is short, in English and has the sections', () => {
    expect(text.split('\n').length).toBeLessThanOrEqual(150)
    expect(/[Ѐ-ӿ]/.test(text)).toBe(false)
    for (const title of ['What this is', 'Install, build, check', 'Layout', 'Rules and pitfalls'])
      expect(text, title).toContain(`\n## ${title}\n`)
  })

  it('names only scripts that package.json has', () => {
    const used = [...text.matchAll(/npm run ([\w:-]+)/g)].map((m) => m[1]!)
    expect(used).toEqual(expect.arrayContaining(['build', 'typecheck', 'lint', 'demo']))
    for (const script of used) expect(Object.keys(packageJson.scripts), `npm run ${script}`).toContain(script)
  })

  it('names only test groups that vitest.config.ts has', () => {
    const used = [...text.matchAll(/--project (\S+)/g)].map((m) => m[1]!)
    expect(used.length).toBeGreaterThan(0)
    for (const group of used) expect([...groups], `--project ${group}`).toContain(group)
    // the groups of the table
    for (const m of text.matchAll(/^\| ((?:`[\w-]+`(?:, )?)+) \|/gm))
      for (const g of m[1]!.matchAll(/`([\w-]+)`/g)) expect([...groups], `group ${g[1]}`).toContain(g[1])
  })

  it('has the rules it must have', () => {
    for (const part of [
      'parse(text).text === text',
      'only the bytes it must',
      'npm test',
      'NOTA_CHROME_MAX',
      'pgrep',
      'invented',
      '@nota-adoc/core/internal',
      'not cleaned',
    ])
      expect(text, part).toContain(part)
  })

  it('links only to files that exist', () => {
    const links = relativeLinks(text)
    expect(links.length).toBeGreaterThan(0)
    for (const link of links) expect(existsSync(resolve(root, link)), link).toBe(true)
  })
})

describe('llms.txt', () => {
  const text = read('llms.txt')
  const lines = text.split('\n')

  it('has the format of llmstxt.org and is small', () => {
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(4096)
    expect(lines[0]).toBe('# Nota')
    expect(lines.find((l) => l !== '' && l !== '# Nota')).toMatch(/^> \S.*\.$/)
    const sections = lines.filter((l) => l.startsWith('## '))
    expect(sections.length).toBeGreaterThan(0)
    // the lines of a list are `- [name](path): description`
    const items = lines.filter((l) => l.startsWith('- '))
    for (const item of items) expect(item, item).toMatch(/^- \[[^\]]+\]\([^)\s]+\): \S/)
  })

  it('links to the files it should, and only to files that exist', () => {
    const links = relativeLinks(text)
    const must = [
      'AGENTS.md',
      'README.md',
      'CONTRIBUTING.md',
      'docs/asciidoctor-differences.md',
      ...readdirSync(root + 'packages').map((p) => `packages/${p}/README.md`),
      ...readdirSync(root + 'examples')
        .filter((f) => f.endsWith('.ts'))
        .map((f) => `examples/${f}`),
    ]
    for (const link of must) expect(links, link).toContain(link)
    for (const link of links) expect(existsSync(resolve(root, link)), link).toBe(true)
  })
})

describe('README.md', () => {
  it('points to the new material', () => {
    const links = relativeLinks(read('README.md'))
    for (const link of ['AGENTS.md', 'docs/asciidoctor-differences.md', 'examples']) expect(links, link).toContain(link)
    const core = relativeLinks(read('packages/core/README.md'))
    expect(core.some((l) => resolve(root, 'packages/core', l) === resolve(root, 'examples'))).toBe(true)
  })
})
