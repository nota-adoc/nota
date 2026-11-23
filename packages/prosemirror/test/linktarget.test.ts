// a link with `--`, `&`, `{…}` in its address is a link with marks in the projection, not an `inline_chip`.
import { describe, expect, it } from 'vitest'
import { parse } from '@nota-adoc/core'
import { projectDocument } from '@nota-adoc/prosemirror'

const FIGMA = 'https://a.example/Layout-%D0%A4--Demo-?node-id=1-2'

function inlines(src: string): { text: string; marks: string[] }[] {
  const out: { text: string; marks: string[] }[] = []
  projectDocument(parse(src)).descendants((n) => {
    if (n.type.name === 'inline_chip') out.push({ text: '<chip>', marks: [] })
    else if (n.isText) out.push({ text: n.text!, marks: n.marks.map((m) => m.type.name) })
  })
  return out
}

describe('links with constructs in the address', () => {
  it('projects a bold link with `--` in its address as text with link and strong marks', () => {
    const r = inlines(`${FIGMA}[**Макеты в Figma**]\n`)
    expect(r).toHaveLength(1)
    expect(r[0]!.text).toBe('Макеты в Figma')
    expect(r[0]!.marks.sort()).toEqual(['link', 'strong'])
  })

  it('projects the forms in a paragraph, a list item, a heading and cells without a plate', () => {
    for (const l of ['https://a.example/x?a=1&b=2[Т]', 'xref:a.adoc#P-GET/{id}/x[Т]', `${FIGMA}[Т]`]) {
      for (const src of [`${l}\n`, `* ${l}\n`, `== ${l}\n`, `|===\n|x |${l}\n|===\n`, `|===\n|x a|${l}\n|===\n`])
        expect(inlines(src).some((i) => i.text === '<chip>'), src).toBe(false)
    }
  })

  it('keeps a bare address with `--` as a plate', () => {
    expect(inlines('https://a.example/x--y\n').some((i) => i.text === '<chip>')).toBe(true)
  })

  it('projects `{name}` in the text of a link as text of the link, in a paragraph and in a cell', () => {
    const text = 'PUT /items/{itemId}/state'
    const l = `link:../ZZ/N.html#N-PUT/items/{itemId}/state[${text}]`
    for (const src of [`${l}\n`, `|===\n|x |${l}\n|===\n`]) {
      const r = inlines(src).filter((i) => i.marks.includes('link'))
      expect(r.map((i) => i.text).join(''), src).toBe(text)
      expect(inlines(src).some((i) => i.text === '<chip>'), src).toBe(false)
    }
  })
})
