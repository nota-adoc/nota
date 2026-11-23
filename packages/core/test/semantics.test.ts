// ids, outline, numbers, footnotes, references and the resolver, new diagnostics.
import { describe, expect, it } from 'vitest'
import { renderHtml } from '@nota-adoc/html'
import { type Diagnostic, parse } from '../src/index.js'
import { knownIdsOf, modelTargetsOf, scanOf, swapTargetsMemory } from '../src/internal.js'

const codes = (ds: readonly Diagnostic[]) => ds.map((d) => d.code)
const find = (ds: readonly Diagnostic[], code: string) => ds.filter((d) => d.code === code)

describe('header attributes in the ASG', () => {
  it('leaves out the names the schema cannot take', () => {
    const asg = parse('= T\n:ok-1: v\n:𠀀empty:\n:a﻿b: v\n\ntext').asg()
    expect(asg.attributes).toEqual({ 'ok-1': 'v' })
  })
})

describe('outline', () => {
  it('gives ids, numbers and places of sections', () => {
    const t = ':sectnums:\n\n== Привет мир\n\ntext\n\n== Привет мир\n'
    const o = parse(t).outline()
    expect(o.map((e) => [e.id, e.level, e.title, e.number, e.inToc])).toEqual([
      ['_привет_мир', 1, 'Привет мир', '1', true],
      ['_привет_мир_2', 1, 'Привет мир', '2', true],
    ])
    expect(o[0]!.from).toBe(t.indexOf('== Привет'))
    expect(t.slice(o[0]!.from, o[0]!.to)).toBe('== Привет мир\n\ntext')
    expect(o[1]!.to).toBe(t.length - 1)
  })

  it('numbers subsections with dots and leaves unnumbered sections without a number', () => {
    const o = parse(':sectnums:\n\n== A\n\n=== B\n\n=== C\n\n== D\n').outline()
    expect(o.map((e) => e.number)).toEqual(['1', '1.1', '1.2', '2'])
    expect(parse('== A\n').outline()[0]!.number).toBeNull()
  })

  it('follows idprefix and idseparator', () => {
    const o = parse(':idprefix: sec-\n:idseparator: -\n\n== Привет мир\n').outline()
    expect(o[0]!.id).toBe('sec-привет-мир')
  })

  it('toclevels decides inToc; discrete headings are in no toc', () => {
    const t = ':toclevels: 1\n\n== A\n\n=== B\n\n[discrete]\n== H\n'
    const o = parse(t).outline()
    expect(o.map((e) => [e.title, e.inToc])).toEqual([
      ['A', true],
      ['B', false],
      ['H', false],
    ])
    expect(
      parse('== A\n\n=== B\n\n==== C\n')
        .outline()
        .map((e) => e.inToc),
    ).toEqual([true, true, false])
  })

  it('an explicit id and a title with markup', () => {
    const o = parse('[#mine]\n== A *b* c\n\n== X *y* Z\n\n== W [[anc]]\n').outline()
    expect(o.map((e) => e.id)).toEqual(['mine', '_x_y_z', 'anc'])
  })

  it('sectids off: no generated ids', () => {
    expect(parse(':!sectids:\n\n== A\n').outline()[0]!.id).toBeNull()
  })

  it('html takes the same ids', () => {
    const t = '== A b\n\n== A b\n'
    expect(renderHtml(parse(t))).toContain('id="_a_b_2"')
    expect(
      parse(t)
        .outline()
        .map((e) => e.id),
    ).toEqual(['_a_b', '_a_b_2'])
  })
})

describe('footnotes', () => {
  it('numbers from 1, a repeat by id has the same number', () => {
    const t = 'a footnote:a[One] b footnote:[Two] c footnote:a[] d footnote:b[Three] e footnote:b[]'
    const f = parse(t).footnotes()
    expect(f.map((x) => x.number)).toEqual([1, 2, 1, 3, 3])
    expect(f[0]).toMatchObject({ id: 'a', text: 'One', from: 2 })
    expect(f[2]).toMatchObject({ id: 'a', text: 'One' })
    expect(t.slice(f[1]!.from, f[1]!.to)).toBe('footnote:[Two]')
  })

  it('a footnote by an unknown id with no text is not counted', () => {
    expect(parse('x footnote:zz[]').footnotes()).toEqual([])
  })
})

describe('references and the resolver', () => {
  it('an xref to an id that is not there is a warning on the reference; an anchor makes it resolved', () => {
    const t = 'see <<a>> here'
    const d = parse(t).diagnostics
    expect(find(d, 'unresolved-reference')).toHaveLength(1)
    const w = find(d, 'unresolved-reference')[0]!
    expect(w.severity).toBe('warning')
    expect(t.slice(w.from, w.to)).toBe('<<a>>')
    expect(find(parse('see <<a>>\n\n[[a]]\nx\n').diagnostics, 'unresolved-reference')).toHaveLength(0)
    expect(find(parse('see <<_sec>>\n\n== Sec\n').diagnostics, 'unresolved-reference')).toHaveLength(0)
    expect(find(parse('see xref:a[]\n\n[#a]\nx\n').diagnostics, 'unresolved-reference')).toHaveLength(0)
  })

  it('a natural reference (by the title of a section or the text of an anchor) is resolved as Asciidoctor does', () => {
    const ok = (t: string) => {
      const d = parse(t)
      expect(find(d.diagnostics, 'unresolved-reference')).toHaveLength(0)
      expect(d.references().every((r) => r.resolved)).toBe(true)
    }
    ok('see <<Target One>>\n\n== Target One\n\ntext\n')
    ok('see <<Anchor with reftext>>\n\n[[anch,Anchor with reftext]]\ntext\n')
    ok('see <<Inline B>>\n\ntext [[b,Inline B]]here\n')
    ok('see <<Block Title>>\n\n[#blk]\n.Block Title\n====\nx\n====\n')
    const bad = parse('see <<Nowhere Near>>\n\n== Target One\n')
    expect(find(bad.diagnostics, 'unresolved-reference')).toHaveLength(1)
    expect(bad.references()[0]!.resolved).toBe(false)
  })

  it('ids of the parts brought by resolver.include are known targets', () => {
    const resolver = {
      include: (t: string) => (t === 'p.adoc' ? '[[x]]\nhello\n\n== Part Y\n\ntext\n' : null),
    }
    const t = 'see <<x>> and <<_part_y>> and <<Part Y>> and <<nope>>\n\ninclude::p.adoc[]\n'
    const d = parse(t, { resolver })
    const refs = d.references()
    expect(refs.map((r) => r.resolved)).toEqual([true, true, true, false])
    expect(find(d.diagnostics, 'unresolved-reference')).toHaveLength(1)
  })

  it('xref to another document: no resolver, no claim; the resolver decides', () => {
    const t = 'see xref:other.adoc#b[]'
    expect(find(parse(t).diagnostics, 'unresolved-reference')).toHaveLength(0)
    expect(parse(t).references()[0]).toMatchObject({ target: 'other.adoc#b', resolved: true })
    const none = parse(t, { resolver: { xref: () => null } })
    expect(find(none.diagnostics, 'unresolved-reference')).toHaveLength(1)
    expect(none.references()[0]!.resolved).toBe(false)
    const seen: [string, string | null][] = []
    const yes = parse(t, {
      resolver: {
        xref: (p, id) => {
          seen.push([p, id])
          return { title: 'B' }
        },
      },
    })
    expect(yes.references()[0]).toMatchObject({ target: 'other.adoc#b', resolved: true, title: 'B' })
    expect(find(yes.diagnostics, 'unresolved-reference')).toHaveLength(0)
    expect(seen[0]).toEqual(['other.adoc', 'b'])
  })

  const part = '== P\n\ntext'
  const include = 'before\n\ninclude::part.adoc[]\n\nafter\n'

  it('include: the resolved text stands in the place of the line, in the ASG and in the HTML; the text does not change', () => {
    const doc = parse(include, { resolver: { include: (t) => (t === 'part.adoc' ? part : null) } })
    expect(doc.text).toBe(include)
    expect(doc.tree.length).toBe(include.length)
    const blocks = doc.asg().blocks as unknown as {
      name: string
      title?: { value: string }[]
      location: { file?: string[] }[]
    }[]
    expect(blocks.map((b) => b.name)).toEqual(['paragraph', 'section', 'paragraph'])
    // the paragraph `after` is in the text of the document, not in the file: it stays a block of the document
    const sec = blocks[1]!
    expect(sec.title![0]!.value).toBe('P')
    expect(sec.location[0]!.file).toEqual(['part.adoc'])
    expect(find(doc.diagnostics, 'unresolved-include')).toHaveLength(0)
    expect(renderHtml(doc)).toContain('<h2 id="_p">P</h2>')
  })

  it('include the resolver does not know: warning and a node that points at the file; without a resolver: a node and no warning', () => {
    const none = parse(include, { resolver: { include: () => null } })
    const w = find(none.diagnostics, 'unresolved-include')
    expect(w).toHaveLength(1)
    expect(w[0]!.severity).toBe('warning')
    expect(include.slice(w[0]!.from, w[0]!.to)).toBe('include::part.adoc[]')
    const plain = parse(include)
    expect(codes(plain.diagnostics)).not.toContain('unresolved-include')
    const node = plain.asg().blocks![1] as unknown as { metadata: { attributes: Record<string, string> } }
    expect(node.metadata.attributes['include']).toBe('part.adoc')
    expect(plain.nodeAt(include.indexOf('include::'))?.name).toBe('raw')
  })

  it('the resolved part takes the attributes of the place and its own includes (depth is bounded)', () => {
    const seen: Record<string, string>[] = []
    const doc = parse(':foo: bar\n\ninclude::self.adoc[leveloffset=+1]\n', {
      resolver: {
        include: (_t, attrs) => {
          seen.push(attrs)
          return '{foo}\n\ninclude::self.adoc[]\n'
        },
      },
    })
    expect(doc.asg().blocks!.length).toBeGreaterThan(0)
    expect(seen[0]).toEqual({ leveloffset: '+1' })
    expect(seen.length).toBeLessThanOrEqual(12)
  })
})

describe('new diagnostics', () => {
  it('duplicate-id is on the second declaration', () => {
    const t = '[[a]]\nfirst\n\n[[a]]\nsecond\n\n[#a]\nthird\n'
    const d = find(parse(t).diagnostics, 'duplicate-id')
    expect(d).toHaveLength(2)
    expect(d[0]!.severity).toBe('warning')
    expect(t.slice(d[0]!.from, d[0]!.to)).toBe('[[a]]')
    expect(d[0]!.from).toBe(t.lastIndexOf('[[a]]'))
    expect(t.slice(d[1]!.from, d[1]!.to)).toBe('#a')
    expect(find(parse('[[a]]\nx\n\n[[b]]\ny\n').diagnostics, 'duplicate-id')).toHaveLength(0)
  })

  it('line-read-as-attributes: a remark in brackets; not the real attribute lines', () => {
    const t = '[see below]\nparagraph\n'
    const d = find(parse(t).diagnostics, 'line-read-as-attributes')
    expect(d).toHaveLength(1)
    expect(d[0]!.severity).toBe('info')
    expect(t.slice(d[0]!.from, d[0]!.to)).toBe('[see below]')
    for (const ok of [
      '[source,ts]\n----\nx\n----\n',
      '[NOTE]\npara\n',
      '[#id.role]\npara\n',
      '[cols="2"]\n|===\n|a\n|===\n',
    ])
      expect(find(parse(ok).diagnostics, 'line-read-as-attributes'), ok).toHaveLength(0)
  })

  it('header-attribute-in-body: only the four names, only after the header', () => {
    const t =
      '= T\n:toc:\n\npara\n\n:toc:\n:toc-placement: auto\n:source-highlighter: rouge\n:doctype: book\n:other: x\n'
    const d = find(parse(t).diagnostics, 'header-attribute-in-body')
    expect(d.map((x) => t.slice(x.from, x.to))).toEqual([
      ':toc:',
      ':toc-placement: auto',
      ':source-highlighter: rouge',
      ':doctype: book',
    ])
    expect(d[0]!.severity).toBe('info')
    expect(
      find(parse('= T\n:toc:\n:doctype: book\n\npara\n').diagnostics, 'header-attribute-in-body'),
    ).toHaveLength(0)
  })

  it('diagnostics after doc.update equal the ones of a full parse', () => {
    const t = '= T\n\n[[a]]\nx <<b>>\n\n[see me]\ny\n'
    const d = parse(t)
    const at = t.indexOf('[[a]]')
    const u = d.update([{ from: at, to: at + 5, insert: '[[b]]' }])
    expect(u.diagnostics).toEqual(parse(u.text).diagnostics)
    expect(find(u.diagnostics, 'unresolved-reference')).toHaveLength(0)
  })
})

describe('include cache', () => {
  it('a file that includes itself is read once per level, not once per path; an update does not read the parts again', () => {
    let calls = 0
    const resolver = {
      include: () => {
        calls++
        return 'x\n\ninclude::self.adoc[]\n\ninclude::self.adoc[]\n'
      },
    }
    const doc = parse('include::self.adoc[]\n', { resolver })
    doc.asg()
    void doc.diagnostics
    renderHtml(doc)
    expect(calls).toBeLessThan(100)
    const before = calls
    const next = doc.update([{ from: 0, to: 0, insert: 'y\n\n' }])
    next.asg()
    void next.diagnostics
    expect(calls - before).toBeLessThan(100)
  })
})

describe('targets of natural references across edits (second pass)', () => {
  const base = [
    '= Doc',
    '',
    '== First Part',
    '',
    'See <<Second Part>> and <<Not There Yet>> and <<Named Block>>.',
    '',
    '.Named Block',
    '----',
    'code',
    '----',
    '',
    '== Second Part',
    '',
    'More text.',
    '',
  ].join('\n')
  const fresh = (text: string) =>
    parse(text)
      .references()
      .map((r) => r.resolved)

  it('answers as a fresh parse does when typing in prose, titles, block titles and anchors', () => {
    let doc = parse(base)
    void doc.diagnostics
    const edits: [string, string][] = [
      ['More text', 'x'], // prose
      ['Second Part\n\nMore', 'y'], // a title: the target of the first reference changes
      ['Not There Yet', 'z'], // inside a reference
      ['Named Block\n----', 'q'], // a block title
      ['More', '\n\n[[Not There Yetzq]]\nanchor\n\n'], // an anchor that gives a target
      ['code', 'c'], // inside a delimited block
    ]
    for (const [where, ins] of edits) {
      const at = doc.text.indexOf(where) + where.length
      doc = doc.update([{ from: at, to: at, insert: ins }])
      void doc.diagnostics
      expect(
        doc.references().map((r) => r.resolved),
        where,
      ).toEqual(fresh(doc.text))
    }
  })

  it('keeps the unresolved reference unresolved while prose is typed and sees the target when it appears', () => {
    let doc = parse(base)
    expect(doc.references().map((r) => r.resolved)).toEqual([true, false, false])
    doc = doc.update([{ from: doc.text.indexOf('More'), to: doc.text.indexOf('More'), insert: 'a' }])
    expect(codes(doc.diagnostics)).toContain('unresolved-reference')
    const at = doc.text.indexOf('aMore')
    doc = doc.update([{ from: at, to: at, insert: '== Not There Yet\n\n' }])
    expect(doc.references().map((r) => r.resolved)).toEqual([true, true, false])
  })
})

describe('targets across edits equal a fresh parse (third pass)', () => {
  const refs = [
    'Named Thing',
    'Named Thing2',
    'Doc Title',
    'Doc Titles',
    'Sect One',
    'Attr Title',
    'Tab Anchor',
    'Cond Title',
  ]
  const body = (eol: string): string =>
    [
      'Doc Title',
      '=========',
      ':atitle: Attr',
      '',
      `See ${refs.map((r) => `<<${r}>>`).join(' ')} and <<${'Attr'} Title>>.`,
      '',
      '== Sect One',
      '',
      '[#b,reftext="Named Thing"] ',
      '----',
      'code',
      '----',
      '',
      '== {atitle} Title',
      '',
      'ifdef::flag[]',
      '== Cond Title',
      'endif::[]',
      '',
      '|===',
      '|a [[tab-anchor,Tab Anchor]]x',
      '|===',
      '',
      'Prose.',
      '',
    ]
      .join('\n')
      .replace(/\n/g, eol)
  it('a title of plain words that is renamed stops being a target, and the new one is', () => {
    let doc = parse('= Doc\n\n== Alpha Beta\n\nSee <<Alpha Beta>> and <<Alpha Betax>>.\n')
    expect(doc.references().map((r) => r.resolved)).toEqual([true, false])
    const at = doc.text.indexOf('Beta\n') + 4
    doc = doc.update([{ from: at, to: at, insert: 'x' }])
    expect(doc.references().map((r) => r.resolved)).toEqual([false, true])
    expect(doc.diagnostics.filter((d) => d.code === 'unresolved-reference')).toHaveLength(1)
  })
  it('keeps the targets when a word is typed under a title, in a condition or in a block, and not when a title changes', () => {
    const text =
      '= Doc\n\n== Раздел\n\n.Title\n[#id-1.role]\nSome <<Раздел>> <<Not Written>> words.\n\nifdef::flavor[]\nconditional text\nendif::[]\n\n[source,json]\n----\n{"a": 1}\n----\n'
    const targets = (d: ReturnType<typeof parse>): unknown => {
      d.references()
      const t = swapTargetsMemory()
      swapTargetsMemory(t)
      return t.get(d.options)?.[1]
    }
    let doc = parse(text)
    const first = targets(doc)
    for (const word of ['words', 'conditional text', '"a"']) {
      const at = doc.text.indexOf(word) + 1
      doc = doc.update([{ from: at, to: at, insert: 'x' }])
      expect(targets(doc), word).toBe(first)
    }
    // (a title of plain words is no change either: the scan of the titles has it)
    let at = doc.text.indexOf('Раздел') + 1
    doc = doc.update([{ from: at, to: at, insert: 'x' }])
    expect(targets(doc)).toBe(first)
    expect(doc.references().map((r) => r.resolved)).toEqual(parse(doc.text).references().map((r) => r.resolved))
    at = doc.text.indexOf('Title') + 1
    doc = doc.update([{ from: at, to: at, insert: 'x' }])
    expect(targets(doc)).not.toBe(first)
  })

  const snippets = [
    'x',
    ' ',
    '2',
    '\n',
    '\n\n',
    '[',
    ']',
    ':',
    '=',
    '== ',
    '= ',
    '[[a b]]',
    '.T\n',
    ':flag:\n',
    ':atitle: Z\n',
    'ifdef::flag[]\n',
    'endif::[]\n',
    '|===\n',
    '[#c,reftext="Tab Anchor"]\n',
    '[#zz,reftext="Doc Titles"]#t#',
    '[.r]#Named Thing2#',
    '\r',
    '=====\n',
    '*',
    '<<Named Thing2>>',
  ]
  // a fresh parse of the whole text: the oracle of the update
  const fresh = (text: string): { resolved: boolean[]; unresolved: number } => {
    const f = parse(text)
    return {
      resolved: f.references().map((r) => r.resolved),
      unresolved: codes(f.diagnostics).filter((c) => c === 'unresolved-reference').length,
    }
  }
  const rng = (seed: number) => () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32
  for (const eol of ['\n', '\r\n']) {
    it(`after an update, the answer is the fresh one (${JSON.stringify(eol)})`, () => {
      const rnd = rng(eol.length * 7919)
      for (let round = 0; round < 40; round++) {
        let doc = parse(body(eol))
        for (let step = 0; step < 25; step++) {
          const at = Math.floor(rnd() * (doc.text.length + 1))
          const to = rnd() < 0.3 ? Math.min(doc.text.length, at + 1 + Math.floor(rnd() * 6)) : at
          const ins = rnd() < 0.2 && to > at ? '' : snippets[Math.floor(rnd() * snippets.length)]!
          doc = doc.update([{ from: at, to, insert: ins }])
          const f = fresh(doc.text)
          expect(
            doc.references().map((r) => r.resolved),
            `${round}/${step}`,
          ).toEqual(f.resolved)
          expect(codes(doc.diagnostics).filter((c) => c === 'unresolved-reference').length).toBe(f.unresolved)
        }
      }
    })
  }

  it.each([
    ['attributes line with a space', '[#b,reftext="Named Thing"] ', '[#b,reftext="Named Thing2"] '],
    ['attributes line with CR', '[#b,reftext="Named Thing"]\r', '[#b,reftext="Named Thing2"]\r'],
    ['two-line document title', 'Doc Title\n=========\n', 'Doc Titles\n==========\n'],
  ])('%s', (_n, before, after) => {
    const mk = (h: string) =>
      `${h}${h.startsWith('[') ? '----\ncode\n----\n' : '\n'}\nSee <<Named Thing>> <<Named Thing2>> <<Doc Title>> <<Doc Titles>>.\n\nProse.\n`
    let doc = parse(mk(before))
    void doc.references()
    doc = doc.update([{ from: 0, to: before.length, insert: after }])
    expect(doc.references().map((r) => r.resolved)).toEqual(fresh(doc.text).resolved)
  })
})

describe('trailing white space of a long run (linear)', () => {
  it('does not slow down on 100k spaces inside an anchor or a cross reference', () => {
    const sp = ' '.repeat(100_000)
    for (const t of [`[[a${sp}b]]\n`, `[a${sp}b]\n`, `text [[a${sp}]] <<x${sp}>>\n`, `:toc-title:${sp}\n`]) {
      const started = performance.now()
      void parse(t).diagnostics
      expect(performance.now() - started).toBeLessThan(2000)
    }
  })
})

describe('targets of natural references after an update equal a fresh parse', () => {
  const refs = '<<Foo>> <<Some Text>> <<Заголовок>> <<Doc Title>> <<Рис. 1>> <<Рис. 2>> <<Other Thing>>'
  type Doc = ReturnType<typeof parse>
  /** The answer of the document, or of a fresh parse of its text with the memory of the targets put aside. */
  const answer = (doc: Doc, fresh: boolean) => {
    const kept = fresh ? swapTargetsMemory() : undefined
    const d = fresh ? parse(doc.text, doc.options) : doc
    const out = {
      resolved: d.references().map((r) => r.resolved),
      diagnostics: d.diagnostics.map((x) => [x.code, x.from, x.to, x.message]),
    }
    if (fresh) swapTargetsMemory(kept)
    return out
  }
  const same = (doc: Doc, label: string) => expect(answer(doc, false), label).toEqual(answer(doc, true))
  /** Replaces the text with another by the common prefix and suffix, the way an editor sends the change. */
  const become = (doc: Doc, text: string) => {
    const a = doc.text
    let h = 0
    while (h < a.length && h < text.length && a[h] === text[h]) h++
    let t = 0
    while (t < a.length - h && t < text.length - h && a[a.length - 1 - t] === text[text.length - 1 - t]) t++
    return doc.update([{ from: h, to: a.length - t, insert: text.slice(h, text.length - t) }])
  }

  // [name, top and middle without the target, top and middle with it]
  const cases: [string, [string, string], [string, string]][] = [
    ['anchor in prose', ['', 'Text here.'], ['', 'Text [[Foo,Some Text]] here.']],
    ['anchor: macro', ['', 'Text here.'], ['', 'Text anchor:Foo[Bar] here.']],
    ['+[[Foo]]+', ['', 'Text here.'], ['', 'Text +[[Foo]]+ here.']],
    ['+++[[Foo]]+++', ['', 'Text here.'], ['', 'Text +++[[Foo]]+++ here.']],
    ['pass:[[[Foo]]]', ['', 'Text here.'], ['', 'Text pass:[[[Foo]]] here.']],
    ['indented literal paragraph', ['', 'Text here.'], ['', ' [[Foo,Some Text]]']],
    ['bibliography anchor in a list', ['', '* item'], ['', '* [[[Foo]]] item']],
    ['anchor glued to list text', ['', '* text'], ['', '* [[Foo]]text']],
    ['anchor of a term', ['', 'Term::\n  def'], ['', '[[Foo]]Term::\n  def']],
    ['anchor in a cell', ['', '|===\na|cell\n|==='], ['', '|===\na|[[Foo,Some Text]]cell\n|===']],
    ['rename of a heading', ['', '== Другой'], ['', '== Заголовок']],
    ['two-line document title', ['', 'Text.'], ['Doc Title\n=========\n\n', 'Text.']],
    ['title of a block', ['', '----\ncode\n----'], ['', '.Some Text\n----\ncode\n----']],
    ['reftext of a block', ['', '----\ncode\n----'], ['', '[#Foo,reftext=Some Text]\n----\ncode\n----']],
    [
      'attributes line with a space',
      ['', '----\ncode\n----'],
      ['', '[#Foo,reftext=Some Text] \n----\ncode\n----'],
    ],
    [
      'attributes line with CR',
      ['', '----\ncode\n----'],
      ['', '[#Foo,reftext=Some Text]\r\n----\ncode\n----'],
    ],
    ['attribute in a heading', ['', ':x: Other\n\n== {x}'], ['', ':x: Заголовок\n\n== {x}']],
    ['attribute entry above', [':x: Другой\n\n', '== {x}'], [':x: Заголовок\n\n', '== {x}']],
    [
      'counter before a title',
      ['', 'Para.\n\n.Рис. {counter:n}\n----\ncode\n----'],
      ['', 'Para {counter:n}\n\n.Рис. {counter:n}\n----\ncode\n----'],
    ],
    [
      'set in a paragraph before a heading',
      ['', 'Para.\n\n== {x}'],
      ['', 'Para {set:x:Заголовок}\n\n== {x}'],
    ],
    [
      'conditional around a heading',
      ['', 'ifdef::nope[]\n== Заголовок\nendif::[]'],
      ['', 'ifndef::nope[]\n== Заголовок\nendif::[]'],
    ],
  ]
  const mk = (top: string, mid: string) => `${top}${refs}\n\nProse here.\n\n${mid}\n\nTail prose.\n`
  for (const eol of ['\n', '\r\n']) {
    it.each(cases)(`%s (${JSON.stringify(eol)})`, (_n, [t0, m0], [t1, m1]) => {
      const fix = (s: string) => (eol === '\n' ? s : s.replace(/\r?\n/g, eol))
      const states = [fix(mk(t0, m0)), fix(mk(t1, m1))]
      let doc = parse(states[0]!)
      same(doc, 'start')
      for (let i = 1; i <= 4; i++) {
        doc = become(doc, states[i % 2]!)
        same(doc, `step ${i}`)
        const at = doc.text.indexOf('Tail prose') + 2
        doc = doc.update([{ from: at, to: at, insert: 'x' }])
        same(doc, `typed ${i}`)
        doc = doc.update([{ from: at, to: at + 1, insert: '' }])
        same(doc, `untyped ${i}`)
      }
    })
  }

  it('two documents in turn, then an edit of the first', () => {
    const a = parse(mk('', '== Заголовок'))
    const b = parse(mk('', 'Text [[Foo,Some Text]] here.'))
    same(a, 'a')
    same(b, 'b')
    const at = a.text.indexOf('Tail')
    same(a.update([{ from: at, to: at, insert: 'x' }]), 'a2')
  })

  const snippets = [
    'x',
    ' ',
    '\n',
    '\n\n',
    '[[Foo,Some Text]]',
    'anchor:Foo[Bar]',
    '+[[Foo]]+',
    ' [[Foo]]',
    '<<Foo>>',
    '<<Some Text>>',
    '{counter:n}',
    '{set:x:Foo}',
    '== {x}\n',
    '== Заголовок\n',
    '.Рис. {counter:n}\n',
    '[[[Foo]]]',
    ':x: Foo\n',
    'text {x} text',
    '{x}',
    '[',
    ']',
    '\r',
  ]
  const rng = (seed: number) => () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32
  for (const eol of ['\n', '\r\n']) {
    it(`random chains of 40 x 25 edits (${JSON.stringify(eol)})`, () => {
      const rnd = rng(eol.length * 104729)
      for (let round = 0; round < 40; round++) {
        let doc = parse(mk('', 'Text here.').replace(/\n/g, eol))
        for (let step = 0; step < 25; step++) {
          const at = Math.floor(rnd() * (doc.text.length + 1))
          const to = rnd() < 0.3 ? Math.min(doc.text.length, at + 1 + Math.floor(rnd() * 6)) : at
          const ins = rnd() < 0.2 && to > at ? '' : snippets[Math.floor(rnd() * snippets.length)]!
          doc = doc.update([{ from: at, to, insert: ins }])
          same(doc, `${round}/${step}`)
        }
      }
    })
  }

  it('renaming a section of plain words leaves no stale generated id when :idprefix: has a capital', () => {
    let doc = parse('= Doc\n:idprefix: Sec\n\n== Foo\n\nSee <<Secfoo>> <<Not There>>.\n')
    same(doc, 'start')
    expect(doc.references().map((r) => r.resolved)).toEqual([true, false])
    doc = become(doc, doc.text.replace('== Foo', '== Bar'))
    same(doc, 'renamed')
    expect(doc.references().map((r) => r.resolved)).toEqual([false, false])
    doc = become(doc, doc.text.replace('== Bar', '== Foo'))
    expect(doc.references().map((r) => r.resolved)).toEqual([true, false])
  })

  it('the set that is kept differs from the set made anew only by what knownIds and the scan of titles have (reference: modelTargetsOf(doc, false))', () => {
    let doc = parse('= Doc\n:idprefix: Sec\n:idseparator: X\n\n== Foo Bar\n\n== Baz\n\nSee <<Secfoo>> <<Some Text>>.\n')
    doc.references()
    doc = become(doc, doc.text.replace('== Baz', '== Qux'))
    const fresh = modelTargetsOf(doc, false)
    const kept = modelTargetsOf(doc, true)
    const known = knownIdsOf(doc)
    for (const t of kept) expect(fresh.has(t), t).toBe(true)
    for (const t of fresh) expect(kept.has(t) || known.has(t) || scanOf(doc).titles.includes(t), t).toBe(true)
  })

  it('with an include and its resolver, a part brings a heading: the edits of the body keep the references right', () => {
    const resolver = { include: (t: string) => (t === 'p.adoc' ? '== Включённый\n\ntext\n' : null) }
    let doc = parse('See <<Включённый>> and <<Nope>>.\n\ninclude::p.adoc[]\n\nBody.\n', { resolver })
    same(doc, 'start')
    expect(doc.references().map((r) => r.resolved)).toEqual([true, false])
    for (let i = 0; i < 20; i++) {
      const at = doc.text.indexOf('Body.') + 1
      doc = doc.update([{ from: at, to: at, insert: 'x' }])
      same(doc, `edit ${i}`)
      expect(doc.references().map((r) => r.resolved)).toEqual([true, false])
    }
  })
})
