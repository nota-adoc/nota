import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { type ParseOptions, parse } from '@nota-adoc/core'
import { renderHtml, renderHtmlBlocks } from '@nota-adoc/html'

const html = (text: string, options?: ParseOptions) => renderHtml(parse(text, options))

describe('renderHtml', () => {
  it('writes a paragraph with inline markup exactly as Asciidoctor does', () => {
    expect(html('Привет, *мир*!')).toBe(
      '<div class="paragraph">\n<p>Привет, <strong>мир</strong>!</p>\n</div>',
    )
  })

  it('writes an empty document as nothing', () => {
    expect(html('')).toBe('')
  })

  it('writes sections with ids, the body of a section and the blocks in them', () => {
    expect(html('== Section One\n\nText.\n\n=== Sub\n\nMore.\n')).toBe(
      [
        '<div class="sect1">',
        '<h2 id="_section_one">Section One</h2>',
        '<div class="sectionbody">',
        '<div class="paragraph">',
        '<p>Text.</p>',
        '</div>',
        '<div class="sect2">',
        '<h3 id="_sub">Sub</h3>',
        '<div class="paragraph">',
        '<p>More.</p>',
        '</div>',
        '</div>',
        '</div>',
        '</div>',
      ].join('\n'),
    )
  })

  it('leaves the header out (the embedded document has no title unless showtitle is set)', () => {
    expect(html('= Title\n\nText.\n')).not.toContain('<h1')
    expect(html('= Title\n:showtitle:\n\nText.\n')).toContain('<h1>Title</h1>')
  })

  it('wraps the blocks before the first section in a preamble when there is a title and sections', () => {
    const out = html('= Title\n\nIntro.\n\n== Section\n\nText.\n')
    expect(out).toContain('<div id="preamble">\n<div class="sectionbody">')
  })

  it('writes the footnotes at the end, numbered', () => {
    expect(html('A footnote:[One] and footnote:[Two].')).toBe(
      [
        '<div class="paragraph">',
        '<p>A <sup class="footnote">[<a id="_footnoteref_1" class="footnote" href="#_footnotedef_1" title="View footnote.">1</a>]</sup> and <sup class="footnote">[<a id="_footnoteref_2" class="footnote" href="#_footnotedef_2" title="View footnote.">2</a>]</sup>.</p>',
        '</div>',
        '<div id="footnotes">',
        '<hr>',
        '<div class="footnote" id="_footnotedef_1">',
        '<a href="#_footnoteref_1">1</a>. One',
        '</div>',
        '<div class="footnote" id="_footnotedef_2">',
        '<a href="#_footnoteref_2">2</a>. Two',
        '</div>',
        '</div>',
      ].join('\n'),
    )
  })

  it('writes the table of contents for :toc:', () => {
    const out = html(':toc:\n\n== One\n\n=== Two\n\n== Three\n')
    expect(
      out.startsWith(
        '<div id="toc" class="toc">\n<div id="toctitle">Table of Contents</div>\n<ul class="sectlevel1">',
      ),
    ).toBe(true)
    expect(out).toContain(
      '<li><a href="#_one">One</a>\n<ul class="sectlevel2">\n<li><a href="#_two">Two</a></li>',
    )
  })

  it('writes toc::[] as a comment unless the toc is placed with a macro', () => {
    expect(html('toc::[]')).toBe('<!-- toc disabled -->')
    expect(html(':toc: macro\n\ntoc::[]\n\n== One\n')).toContain('<div id="toc" class="toc">')
  })

  it('substitutes the attributes of the document, the ones set in it and the ones passed in', () => {
    expect(html(':a: one\n\n{a} and {b}', { attributes: { b: 'two' } })).toContain('<p>one and two</p>')
    expect(html(':a: one\n\n{a}\n\n:a: two\n\n{a}\n')).toMatch(/<p>one<\/p>[\s\S]*<p>two<\/p>/)
  })

  it('writes the raw HTML of passthroughs as it is', () => {
    expect(html('+++<b onclick="x">raw</b>+++')).toContain('<b onclick="x">raw</b>')
  })

  it('writes a table as Asciidoctor does, and no block of class nota-unparsed', () => {
    const out = html('|===\n|a & b\n|===\n')
    expect(out).toContain(
      '<td class="tableblock halign-left valign-top"><p class="tableblock">a &amp; b</p></td>',
    )
    expect(out).not.toContain('nota-unparsed')
  })

  it('resolves cross references by id, by title and by reference text', () => {
    const out = html('[[first]]\n== The First\n\nSee <<first>> and <<The First>> and <<missing>>.\n')
    expect(out).toContain(
      '<a href="#first">The First</a> and <a href="#first">The First</a> and <a href="#missing">[missing]</a>',
    )
  })

  it('keeps the numbers of the sections with :sectnums:', () => {
    const out = html(':sectnums:\n\n== One\n\n=== Two\n\n== Three\n')
    expect(out).toContain('<h2 id="_one">1. One</h2>')
    expect(out).toContain('<h3 id="_two">1.1. Two</h3>')
    expect(out).toContain('<h2 id="_three">2. Three</h2>')
  })

  it('numbers the captions of examples', () => {
    const out = html('.First\n====\nx\n====\n\n.Second\n====\ny\n====\n')
    expect(out).toContain('<div class="title">Example 1. First</div>')
    expect(out).toContain('<div class="title">Example 2. Second</div>')
  })
})

describe('what the document sets while the blocks are read (found by comparing whole documents with Asciidoctor)', () => {
  it('leaves the box of a task in the text of an item of a bibliography', () => {
    const out = html('[bibliography]\n* [x] checked item\n')
    expect(out).not.toContain('checklist')
    expect(out).toContain('<p>[x] checked item</p>')
  })

  it('reads the text of an item with the attributes from before the blocks in the item', () => {
    const out = html(':showtitle:\n* a\nb\n[abstract]\n:hardbreaks:\n____\nq\n____\n')
    expect(out).toContain('<p>a\nb</p>')
  })

  it('takes the entries before the first block of a document without a title for the header', () => {
    expect(html('[reftext=Ref]\n:toc:\n=== Section\ntoc::[]\n')).toContain('<div id="toc" class="toc">')
  })

  it('gives a section without an id an empty link in the table of contents', () => {
    expect(html(':sectids!:\n:toc:\n=== Section\n')).toContain('<li><a href="#">Section</a></li>')
  })

  it('does not set the entries of the header again when it reaches the block after them', () => {
    // `:toc: macro` becomes an empty `toc` (with the placement `macro`) when the header is read
    expect(html('[arabic]\n:toc: macro\n[#id]\nA{toc}B\n')).toContain('<p>AB</p>')
  })

  it('reads a directive on the line after a term when the list has the style comment', () => {
    const out = html('[comment]\nterm::\nifndef::attr[]\ntext\nendif::[]\n')
    expect(out).toContain('<p>text</p>')
    expect(out).not.toContain('ifndef')
  })

  it('keeps the indentation of a paragraph in the style listing or literal', () => {
    expect(html('[literal]\n  a\n   b\n')).toContain('<pre>  a\n   b</pre>')
    expect(html('[listing]\n  a\n', { attributes: {} })).toContain('<pre>  a</pre>')
  })

  it('leaves out the lines a condition disables inside a block that has callouts', () => {
    const out = html(':attr:\n----\n\nputs 1 # <2>\n= Part\nifndef::attr[]\nmore\n')
    expect(out).toContain('= Part</pre>')
    expect(out).not.toContain('more')
  })
})

describe('renderHtml never throws', () => {
  const nasty = [
    '\u0000',
    '\uD800',
    '[[[[[[',
    '*'.repeat(1000),
    '{'.repeat(1000) + '}'.repeat(1000),
    '<<<<<<<<',
    'footnote:[footnote:[x]]',
    'xref:[]',
    '== \n== \n',
    ':a: {a}\n\n{a}',
    '----\n<1>\n----\n<1> a\n<2> b\n',
    ':toc:\n\ntoc::[]\n\n[discrete]\n== x\n',
    'ifdef::a[]\n== x\nendif::[]\n',
    '. a\n.. b\n... c\n.... d\n..... e\n',
    'a:: b\nc::: d\n',
  ]
  for (const text of nasty) {
    it(`gives a string for ${JSON.stringify(text.slice(0, 30))}`, () => {
      expect(typeof html(text)).toBe('string')
    })
  }

  it('gives a string for blocks nested a thousand deep', () => {
    const open = Array.from({ length: 1000 }, (_, i) => '='.repeat(4 + i))
    expect(typeof html([...open, 'text', ...open.reverse()].join('\n') + '\n')).toBe('string')
  })
})

describe('cells that Asciidoctor left out with their row', () => {
  const ids = (text: string) => [...renderHtml(parse(text)).matchAll(/<h2 id="([^"]+)"/g)].map((m) => m[1])

  it('still take the ids of the sections in them (the next section with that title gets a suffix)', () => {
    // the cell with the first title spans more columns than there are: it is left out, the title is taken
    const text = '[cols="2*"]\n|===\n|x\n3+a|\n== Sec\n|y |z\n|===\n\n== Sec\n'
    expect(ids(text)).toEqual(['_sec_2'])
  })

  it('take the anchors in their text, in the order of the text', () => {
    const text = '[cols="2*"]\n|===\n|a |b\n|[[dropped]]c\n|===\n\n<<dropped>>\n'
    expect(renderHtml(parse(text))).toContain('<a href="#dropped">')
  })
})

describe('renderHtmlBlocks', () => {
  it('gives the HTML of the document and of each block, with the blocks in it', () => {
    const r = renderHtmlBlocks(parse('== One\n\nText *x*.\n\n* item\n'))
    expect(r.html).toContain('<h2 id="_one">One</h2>')
    expect(r.blocks.map((b) => b.context)).toEqual(['section'])
    const section = r.blocks[0]!
    expect(section.blocks.map((b) => b.context)).toEqual(['paragraph', 'ulist'])
    expect(section.blocks[0]!.html).toBe('<div class="paragraph">\n<p>Text <strong>x</strong>.</p>\n</div>')
    expect(section.blocks[1]!.blocks).toEqual([])
    expect(section.html).toContain(section.blocks[0]!.html)
  })
})

describe('the id of a block macro', () => {
  it('is the one in the brackets, before the anchor above the macro, and an empty one wipes it', () => {
    expect(html('image::pic.png[id=img1]')).toContain('<div id="img1" class="imageblock">')
    expect(html('[[above]]\nimage::pic.png[id=img1]')).toContain('<div id="img1" class="imageblock">')
    expect(html('[[above]]\nimage::pic.png[Alt]')).toContain('<div id="above" class="imageblock">')
    expect(html('[#above]\nimage::pic.png[id=]')).toContain('<div id="" class="imageblock">')
    expect(html('|===\na|[#above]\nimage::pic.png[id=in]\n|===')).toContain('<div id="in" class="imageblock">')
  })
})

describe('the counters of the documents in cells', () => {
  it('count in the document that holds the table', () => {
    const text = '|===\na|[#{counter:n}]\ntext\n\n[#{counter:n}]\nmore\n|===\n\n[#{counter:n}]\nafter\n'
    const out = html(text)
    expect(out).toMatch(/<div id="1" class="paragraph">\s*<p>text/)
    expect(out).toMatch(/<div id="2" class="paragraph">\s*<p>more/)
    expect(out).toMatch(/<div id="3" class="paragraph">\s*<p>after/)
  })
})

describe('the document in a cell of a book', () => {
  it('is an article: no preamble, `{doctype}` is article', () => {
    const out = html(':doctype: book\n= T\n\n|===\na|text {doctype} {doctype-book}\n\n* a\n|===\n')
    const cell = out.slice(out.indexOf('<td'), out.indexOf('</td>'))
    expect(cell).not.toContain('preamble')
    expect(cell).toContain('text article {doctype-book}')
    expect(out).toContain('id="preamble"')
  })
})

describe('html of an updated document', () => {
  it('is the html of a full parse: the pieces of a text that runs over several lines move with their unit', () => {
    const text =
      '= Document Title\n[verse]\nsee <<a>> xref:other.adoc#x[y] xref:other.adoc[]\n[[anchor-id,Reference text]]\n.2+^.>s|tall |x'
    let doc = parse(text)
    doc = doc.update([{ from: 91, to: 91, insert: 'include::part.adoc[leveloffset=+1]\n' }])
    doc = doc.update([{ from: 0, to: 1, insert: '' }])
    doc = doc.update([{ from: 0, to: 1, insert: '' }])
    expect(renderHtml(doc)).toBe(renderHtml(parse(doc.text)))
  })
})

describe('include:: takes the level of the parse, not of {set:}', () => {
  const resolver = { include: (t: string) => (t === 'p.adoc' ? '== P\n\ntext\n' : null) }
  const h = (text: string) => html(text, { resolver })
  const level = (text: string) => {
    const d = parse(text, { resolver })
    const sec = (d.asg().blocks ?? []).find((b) => b.name === 'section') as { level?: number } | undefined
    return sec?.level
  }

  it('{set:leveloffset} does not move the included sections', () => {
    expect(h('{set:leveloffset:1}\n\ninclude::p.adoc[leveloffset=+1]\n')).toContain('<h3')
    expect(h('{set:leveloffset:1}\n\ninclude::p.adoc[leveloffset=+1]\n')).not.toContain('<h4')
    expect(h('{set:leveloffset:1}\n\ninclude::p.adoc[]\n')).toContain('<h2')
    expect(level('{set:leveloffset:1}\n\ninclude::p.adoc[leveloffset=+1]\n')).toBe(2)
    expect(level('{set:leveloffset:1}\n\ninclude::p.adoc[]\n')).toBe(1)
  })

  it('{set:} over a real entry', () => {
    expect(h(':leveloffset: 1\n\n{set:leveloffset:2}\n\ninclude::p.adoc[leveloffset=+1]\n')).toContain('<h4')
    expect(h(':leveloffset: 1\n\n{set:leveloffset!}\n\ninclude::p.adoc[]\n')).toContain('<h3')
  })

  it('without {set:} as before, and the resolver gets the same attrs', () => {
    expect(h(':leveloffset: 1\n\ntext\n\ninclude::p.adoc[leveloffset=+1]\n')).toContain('<h4')
    expect(h(':leveloffset: 1\n\ninclude::p.adoc[leveloffset=0]\n')).toContain('<h2')
    expect(h('include::p.adoc[leveloffset=+1]\n')).toContain('<h3')
    let got: unknown
    parse('include::p.adoc[leveloffset=+1]\n', {
      resolver: { include: (_t, a) => ((got = a), null) },
    }).asg()
    expect(got).toEqual({ leveloffset: '+1' })
  })
})

describe('{set:} in text and the block parse', () => {
  it('a section keeps its level and renders h2', () => {
    expect(html('{set:leveloffset:1}\n\n== A\n')).toContain('<h2')
    expect(html(':leveloffset: 1\n\n{set:leveloffset!}\n\n== A\n')).toContain('<h3')
  })

  it('a section in an a-cell renders at the level of the parse, not of {set:} (ASG path)', () => {
    const cell = '|===\na|\n== S\n\ntext\n|===\n'
    const out = html('{set:leveloffset:1}\n\n' + cell)
    expect(out).toContain('<h2')
    expect(out).not.toContain('<h3')
    expect(out).toContain(html(cell))
  })

  it('a cell document does not see leveloffset set only by {set:}, and may set its own', () => {
    const out = html('{set:leveloffset:1}\n\n|===\na|\n:leveloffset: 1\n\n== S\n\n{leveloffset}\n|===\n')
    expect(out).toContain('<h3')
    expect(out).not.toContain('<h4')
    expect(html('{set:leveloffset:1}\n\n|===\na|\n{leveloffset}\n|===\n')).toContain('{leveloffset}')
  })

  it('an entry in the first block of an item wins over {set:} in its text', () => {
    const out = html('* {set:a:text}item\n+\n:a: block\nx\n\n{a}\n')
    expect(out).toContain('<p>block</p>')
    expect(out).not.toContain('<p>text</p>')
  })
})

describe('colour roles', () => {
  const fixture = readFileSync(
    fileURLToPath(new URL('../../../quality/fixtures/stage4/colors.adoc', import.meta.url)),
    'utf8',
  )

  it('puts the classes of the roles on the elements Asciidoctor puts them on', () => {
    const out = html(fixture)
    expect(out).toContain('<span class="hl-mint">')
    expect(out).toContain('<span class="hl-mint hl-tall">')
    expect(out).toContain('<strong class="hl-mint">')
    expect(out).toContain('<span id="k1" class="hl-mint note">')
    expect(out).toContain('<p class="tableblock">Ячейка <span class="hl-mint">обычная</span>')
  })

  it('has a class for each piece of colour the model finds', () => {
    const doc = parse(fixture)
    const pieces = new Set(doc.colors().flatMap((r) => r.pieces))
    // the title of the document is not in the HTML of the body
    expect(renderHtml(doc).match(/class="[^"]*\bhl-[a-z]+/g)).toHaveLength(pieces.size - 1)
  })
})

describe('a document that parse did not make', () => {
  for (const [name, call] of [
    ['renderHtml', () => renderHtml({ text: 'a' } as never)],
    ['renderHtmlBlocks', () => renderHtmlBlocks({ text: 'a' } as never)],
  ] as const) {
    it(`${name} throws a TypeError that says what to give and where the mistake may come from`, () => {
      let error: unknown
      try {
        call()
      } catch (e) {
        error = e
      }
      expect(error).toBeInstanceOf(TypeError)
      const message = (error as Error).message
      expect(message).toContain('parse() or doc.update()')
      expect(message).toContain('this copy of @nota-adoc/core')
      expect(message).toContain('two copies')
    })
  }
})
