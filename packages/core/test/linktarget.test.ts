// a link whose address holds `&`, `{…}`, `--`, `+…+`, `_…_` is a link in the editor, not a plate with the source.
import { describe, expect, it } from 'vitest'
import { type Operation, applyOperation, parse } from '@nota-adoc/core'
import { readInline, tableViewAt } from '@nota-adoc/core/internal'
import { renderHtml } from '@nota-adoc/html'

const readPara = (line: string) => readInline(parse(line + '\n'), 0, line.length)

const FIGMA = 'https://a.example/Layout-%D0%A4--Demo-?node-id=1-2'

/** [source, href, text]: every form is a link with the text and the address as written. */
const FORMS: [string, string, string][] = [
  [`${FIGMA}[**Макеты в Figma**]`, FIGMA, 'Макеты в Figma'],
  ['https://a.example/x?a=1&b=2[Т]', 'https://a.example/x?a=1&b=2', 'Т'],
  ['xref:a.adoc#Item<>B-GET/c[Т]', 'a.adoc#Item<>B-GET/c', 'Т'],
  ['https://a.example/p/{id}/x[Т]', 'https://a.example/p/{id}/x', 'Т'],
  ['xref:../a/B.adoc#P-GET/{id}/x[Т]', '../a/B.adoc#P-GET/{id}/x', 'Т'],
  ['link:../a/{id}.adoc[Т]', '../a/{id}.adoc', 'Т'],
  ['<<b.adoc#x{y},Т>>', 'b.adoc#x{y}', 'Т'],
  ['https://a.example/p/33.+%D0%A2+%D0%B2[Т]', 'https://a.example/p/33.+%D0%A2+%D0%B2', 'Т'],
  ['link:++https://a.example/x--y&b=2++[Т]', '++https://a.example/x--y&b=2++', 'Т'],
  ['link:../A/ALPHA,_BETA_API/%5B1%5D_Я_(API)/Я.adoc[Т]', '../A/ALPHA,_BETA_API/%5B1%5D_Я_(API)/Я.adoc', 'Т'],
  ['xref:a_--_b.adoc[Т]', 'a_--_b.adoc', 'Т'],
  ['https://a.example/x...y[Т]', 'https://a.example/x...y', 'Т'],
]

describe('links with constructs in the address', () => {
  for (const [src, , text] of FORMS) {
    it(`reads ${src} as a link`, () => {
      const r = readPara(src)
      expect(r.cells.some((c) => c.kind === 'chip')).toBe(false)
      expect(r.cells.map((c) => c.ch).join('')).toBe(text)
      expect(r.cells[0]!.spans.some((s) => s.type === 'link')).toBe(true)
    })
  }

  it('takes the address as written, and keeps the bold inside the link', () => {
    for (const [src, href] of FORMS) {
      const link = readPara(src).cells[0]!.spans.find((s) => s.type === 'link')!
      expect(link.href, src).toBe(href)
    }
    expect(readPara(FORMS[0]![0]).cells[0]!.spans.map((s) => s.type)).toEqual(['link', 'strong'])
  })

  it('shows a bare address and an angle address with `&` as a link with its own text', () => {
    for (const src of ['https://a.example/x?a=1&b=2', '<https://a.example/x?a=1&b=2>']) {
      const r = readPara(src)
      expect(r.cells.map((c) => c.ch).join('')).toBe('https://a.example/x?a=1&b=2')
      expect(r.cells[0]!.spans[0]!.href).toBe('https://a.example/x?a=1&b=2')
    }
  })

  it('leaves the other forms as plates with their source', () => {
    for (const src of [
      'https://a.example/x--y',
      'https://a.example/{id}',
      'https://h/*[https://h/*]',
      '<<foreach [in d.where(T=>T.a == b)]>>',
      // a link inside the address of another one
      'https://a.example/?r=link:b.html[y][Т]',
    ]) {
      const r = readPara(src)
      expect(
        r.cells.filter((c) => c.kind === 'chip').map((c) => c.src),
        src,
      ).toEqual([src])
    }
  })
})

describe('the same forms in a list item, a heading and a cell', () => {
  it('reads them as links', () => {
    for (const [src, href] of FORMS) {
      for (const text of [`* ${src}\n`, `== ${src}\n`]) {
        const doc = parse(text)
        const from = text.indexOf(src)
        const r = readInline(doc, from, from + src.length)
        expect(
          r.cells.some((c) => c.kind === 'chip'),
          text,
        ).toBe(false)
      }
      for (const cell of [`|${src}`, `a|${src}`]) {
        const table = `|===\n|x ${cell}\n|===\n`
        const blocks = tableViewAt(parse(table), 0)!
          .rows.flat()
          .flatMap((c) => c.blocks)
        const last = blocks[blocks.length - 1]!
        const reading = last.kind === 'text' ? last.reading : null
        expect(reading, table).not.toBeNull()
        expect(
          reading!.cells.some((c) => c.kind === 'chip'),
          table,
        ).toBe(false)
        expect(reading!.cells[0]!.spans.find((s) => s.type === 'link')!.href, table).toBe(href)
      }
    }
  })
})

describe('edits and saving', () => {
  it('changes only the text, the address stays byte for byte', () => {
    const edits: [string, Operation, string][] = [
      [
        `${FIGMA}[**Макеты в Figma**]`,
        { kind: 'insertText', at: FIGMA.length + 4, text: 'я' },
        `${FIGMA}[**Мяакеты в Figma**]`,
      ],
      [
        `${FIGMA}[**Макеты в Figma**]`,
        { kind: 'deleteRange', from: FIGMA.length + 3, to: FIGMA.length + 4 },
        `${FIGMA}[**акеты в Figma**]`,
      ],
      [
        'xref:../a/B.adoc#P-GET/{id}/x[Текст]',
        { kind: 'insertText', at: 31, text: 'я' },
        'xref:../a/B.adoc#P-GET/{id}/x[Тяекст]',
      ],
      [
        'xref:../a/B.adoc#P-GET/{id}/x[Текст]',
        { kind: 'deleteRange', from: 30, to: 31 },
        'xref:../a/B.adoc#P-GET/{id}/x[екст]',
      ],
    ]
    for (const [src, op, expected] of edits) {
      const r = applyOperation(parse(src + '\n'), op)
      expect('error' in r ? r.error : r.doc.text, JSON.stringify(op)).toBe(expected + '\n')
    }
  })

  it('takes off the bold from a link text and keeps the rest of the source', () => {
    const doc = parse(`${FIGMA}[**Макеты**]\n`)
    const from = FIGMA.length + 3
    const r = applyOperation(doc, { kind: 'toggleMark', from, to: from + 6, mark: 'strong' })
    expect('error' in r ? r.error : r.doc.text).toBe(`${FIGMA}[Макеты]\n`)
  })

  it('setLink writes a new address, removeLink keeps the text', () => {
    const doc = parse(`${FIGMA}[Макеты]\n`)
    const at = FIGMA.length + 1
    const a = applyOperation(doc, { kind: 'setLink', from: at, to: at + 3, target: 'https://b.example/z' })
    expect('error' in a ? a.error : a.doc.text).toBe('https://b.example/z[Макеты]\n')
    const b = applyOperation(doc, { kind: 'removeLink', at: at + 2 })
    expect('error' in b ? b.error : b.doc.text).toBe('Макеты\n')
  })

  it('does not change the tree or the HTML (the HTML follows Asciidoctor)', () => {
    const src = FORMS.map((f) => f[0]).join('\n\n') + '\n'
    const html = renderHtml(parse(src))
    expect(html).toContain('Layout-%D0%A4&#8212;&#8203;Demo-')
    expect(readPara(`${FIGMA}[Т]`).cells.length).toBe(1)
  })
})

describe('what may stand in an address is a list', () => {
  it('keeps a plate for an address with an escape, an index term, a stem or a lone marker', () => {
    for (const src of [
      'link:a/\\{id}.adoc[Т]',
      'link:a/(((x))).adoc[Т]',
      'link:a/stem:[x].adoc[Т]',
      'link:a/image:i.png[]b.adoc[Т]',
    ]) {
      expect(
        readPara(src).cells.some((c) => c.kind === 'chip'),
        src,
      ).toBe(true)
      expect(
        readPara(src).spans.some((s) => s.type === 'link'),
        src,
      ).toBe(false)
    }
  })

  it('reads a closed pair of quote marks, a passthrough and a replacement in an address as the link it is', () => {
    for (const src of [
      'link:a/_b_.adoc[Т]',
      'link:a/^b^.adoc[Т]',
      'link:a/pass:q[b].adoc[Т]',
      'link:a/b+++c+++.adoc[Т]',
      'link:a/b--c.adoc[Т]',
    ]) {
      const r = readPara(src)
      expect(
        r.cells.some((c) => c.kind === 'chip'),
        src,
      ).toBe(false)
      expect(r.cells.map((c) => c.ch).join(''), src).toBe('Т')
    }
  })

  it('takes a defined attribute in an address as written', () => {
    const doc = parse(':u: https://example.com\n\n{u}[text]\n')
    const from = doc.text.indexOf('{u}[')
    const r = readInline(doc, from, from + 9)
    expect(r.cells.some((c) => c.kind === 'chip')).toBe(false)
    expect(r.spans.find((s) => s.type === 'link')!.href).toBe('{u}')
    expect(r.cells.map((c) => c.ch).join('')).toBe('text')
  })
})

describe('a `{name}` in the text of a link is text, not a plate', () => {
  const HREF = '../../ZZ/Items.html#Items-PUT/items/{itemId}/state'
  const TEXT = 'PUT /items/{itemId}/state'
  const SRC = `link:${HREF}[${TEXT}]`

  const check = (r: ReturnType<typeof readPara>) => {
    expect(r.cells.some((c) => c.kind === 'chip')).toBe(false)
    expect(r.cells.map((c) => c.ch).join('')).toBe(TEXT)
    expect(r.spans.filter((s) => s.type === 'link').map((s) => s.href)).toEqual([HREF])
    expect(r.cells.map((c) => c.src).join('')).toContain(TEXT)
  }

  it('in a paragraph', () => {
    check(readPara(SRC))
  })

  it('in a cell', () => {
    const table = `|===\n|x |${SRC}\n|===\n`
    const blocks = tableViewAt(parse(table), 0)!
      .rows.flat()
      .flatMap((c) => c.blocks)
    const last = blocks[blocks.length - 1]!
    expect(last.kind).toBe('text')
    if (last.kind === 'text') check(last.reading!)
  })

  it('in the text of an xref, and inside bold', () => {
    const r = readPara('<<a.adoc#x,PUT {id}/s>>')
    expect(r.cells.some((c) => c.kind === 'chip')).toBe(false)
    expect(r.cells.map((c) => c.ch).join('')).toBe('PUT {id}/s')
    const b = readPara('https://a.example/x[**PUT {id}**]')
    expect(b.cells.some((c) => c.kind === 'chip')).toBe(false)
    expect(b.cells.map((c) => c.ch).join('')).toBe('PUT {id}')
  })

  it('writes it back as written when the text is edited', () => {
    const doc = parse(SRC + '\n')
    const at = SRC.lastIndexOf('{itemId}')
    for (const [pos, text] of [
      [at, 'x'],
      [SRC.length - 1, 'я'],
    ] as const) {
      const r = applyOperation(doc, { kind: 'insertText', at: pos, text })
      expect('error' in r ? r.error : r.doc.text).toBe(SRC.slice(0, pos) + text + SRC.slice(pos) + '\n')
    }
  })

  it('keeps a reference outside a link a plate', () => {
    expect(readPara('a {id} b').cells.some((c) => c.kind === 'chip')).toBe(true)
  })
})
