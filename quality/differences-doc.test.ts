import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parse } from '@nota-adoc/core'
import { renderHtml } from '@nota-adoc/html'

const root = fileURLToPath(new URL('..', import.meta.url))
const doc = readFileSync(`${root}docs/asciidoctor-differences.md`, 'utf8')

/** The white space between tags is not compared: Asciidoctor and the doc may break lines differently there. */
const squash = (html: string): string => html.replace(/>\s+</g, '><').trim()

/** Pairs of neighbouring blocks: ```asciidoc, then ```html (only blank lines between them). */
function pairs(text: string): { source: string; html: string }[] {
  const out: { source: string; html: string }[] = []
  const re = /^```asciidoc\n([\s\S]*?)^```\n\s*^```html\n([\s\S]*?)^```$/gm
  for (let m = re.exec(text); m; m = re.exec(text)) out.push({ source: m[1]!, html: m[2]! })
  return out
}

/** The text of a `## ` section of the document. */
function section(title: string): string {
  const start = doc.indexOf(`\n## ${title}\n`)
  expect(start, `the section "${title}"`).toBeGreaterThanOrEqual(0)
  const rest = doc.slice(start + 1)
  const next = rest.indexOf('\n## ', 1)
  return next < 0 ? rest : rest.slice(0, next)
}

describe('docs/asciidoctor-differences.md', () => {
  it('has the three sections and the versions of the reference', () => {
    for (const title of ['Supported', 'Not supported', 'Behaves differently']) section(title)
    expect(doc).toMatch(/Ruby Asciidoctor 2\.0\.26/)
    expect(doc).toMatch(/Asciidoctor\.js 4\.1/)
    expect(doc).toMatch(/`html5`/)
    expect(doc).toMatch(/`secure`/)
    expect(doc).toMatch(/embedded document/)
  })

  const all = pairs(doc)

  it('has at least 6 examples', () => {
    expect(all.length).toBeGreaterThanOrEqual(6)
    // every block of asciidoc is half of a pair
    expect((doc.match(/^```asciidoc$/gm) ?? []).length).toBe(all.length)
    expect((doc.match(/^```html$/gm) ?? []).length).toBe(all.length)
  })

  all.forEach((pair, i) => {
    it(`example ${i + 1}: renderHtml writes the HTML that is shown`, () => {
      expect(squash(renderHtml(parse(pair.source))), `pair ${i + 1}:\n${pair.source}`).toBe(squash(pair.html))
    })
  })

  it('mentions every record of the register that differs from Ruby Asciidoctor, under "Behaves differently"', () => {
    const register = JSON.parse(readFileSync(`${root}quality/reference/known-differences.json`, 'utf8')) as {
      differences: { id: string; between: string[][] }[]
    }
    const ids = register.differences
      .filter((d) => d.between.some((pair) => pair.includes('nota') && pair.includes('ruby')))
      .map((d) => d.id)
    expect(ids.length).toBeGreaterThan(0)
    const differently = section('Behaves differently')
    for (const id of ids) expect(differently, `the id ${id}`).toContain(`\`${id}\``)
    expect(differently).toContain('Nota follows Ruby')
    expect(differently).toContain('quality/reference/known-differences.json')
  })

  it('lists what is not supported', () => {
    const not = section('Not supported')
    for (const word of ['standalone', 'highlighting', 'icons', 'secure', 'include::', 'resolver', '300 levels'])
      expect(not, word).toContain(word)
  })
})
