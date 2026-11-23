import { describe, expect, it } from 'vitest'
import type { Tree } from '@lezer/common'
import { blockKind } from '@nota-adoc/core'
import { codesOf, lossless, shapeOf, textOf } from './helpers.js'

/** The kind of the first delimited block of a document. */
function kindOf(text: string): string | undefined {
  let found: string | undefined
  lossless(text).tree.iterate({
    enter(n) {
      if (found === undefined && n.name === 'DelimitedBlock') {
        found = n.node.tree?.prop(blockKind)
        return false
      }
      return undefined
    },
  })
  return found
}

describe('blocks that hold blocks', () => {
  it('parses paragraphs and lists inside an example', () => {
    expect(shapeOf('====\nабзац\n\n* пункт\n====')).toBe(
      'DelimitedBlock(BlockDelimiter,Paragraph(TextLine),BlankLine,UnorderedList(ListItem(ListMarker,Mark,ItemText(TextLine))),BlockDelimiter)',
    )
    expect(kindOf('====\nабзац\n====')).toBe('example')
  })

  it('parses sidebars, quotes and open blocks', () => {
    const inner = 'Paragraph(TextLine)'
    for (const [delimiter, kind] of [
      ['****', 'sidebar'],
      ['____', 'quote'],
      ['--', 'open'],
    ]) {
      expect(shapeOf(`${delimiter}\ntext\n${delimiter}`)).toBe(
        `DelimitedBlock(BlockDelimiter,${inner},BlockDelimiter)`,
      )
      expect(kindOf(`${delimiter}\ntext\n${delimiter}`)).toBe(kind)
    }
  })

  it('takes metadata, attribute entries and comments inside', () => {
    expect(shapeOf('====\n[[a]]\n.T\ntext\n\n// c\n:x: y\n\nmore\n====')).toBe(
      'DelimitedBlock(BlockDelimiter,Paragraph(BlockAnchor(Mark,AnchorId,Mark,Newline),BlockTitle(Mark,TitleText,Newline),TextLine),BlankLine,LineComment,AttributeEntry(Mark,AttributeName,Mark,AttributeValue(ValueText),Newline),BlankLine,Paragraph(TextLine),BlockDelimiter)',
    )
  })

  it('turns [NOTE] over an example into an admonition block', () => {
    expect(shapeOf('[NOTE]\n====\ntext\n====')).toBe(
      'DelimitedBlock(BlockAttributes(Mark,PositionalAttribute,Mark,Newline),BlockDelimiter,Paragraph(TextLine),BlockDelimiter)',
    )
    expect(kindOf('[NOTE]\n====\ntext\n====')).toBe('admonition')
    expect(kindOf('[TIP]\n--\ntext\n--')).toBe('admonition')
  })

  it('does not read the section title line inside a block as a section', () => {
    expect(shapeOf('====\n== x\n====')).toBe(
      'DelimitedBlock(BlockDelimiter,Paragraph(TextLine),BlockDelimiter)',
    )
  })
})

describe('blocks that are not parsed', () => {
  const raw = 'DelimitedBlock(BlockDelimiter,DelimitedContent,BlockDelimiter)'

  it('keeps the content of listings, literals, passthroughs and stems as one node', () => {
    for (const [delimiter, kind] of [
      ['----', 'listing'],
      ['....', 'literal'],
      ['++++', 'pass'],
    ]) {
      const t = `${delimiter}\n* x\n== x\n:a: b\n// x\n${delimiter}`
      expect(shapeOf(t)).toBe(raw)
      expect(kindOf(t)).toBe(kind)
    }
    expect(kindOf('[stem]\n++++\nx\n++++')).toBe('stem')
    expect(kindOf('[verse]\n____\nx\n____')).toBe('verse')
    expect(kindOf('[comment]\n--\n* x\n--')).toBe('comment')
    expect(shapeOf('[comment]\n--\n* x\n--')).toContain('DelimitedContent')
  })

  it('keeps a block comment as a comment', () => {
    expect(shapeOf('////\n* x\n////')).toBe('BlockComment(CommentDelimiter,CommentContent,CommentDelimiter)')
  })

  it('reads a fence with its language', () => {
    expect(shapeOf('```ruby\nx\n```')).toBe(
      'DelimitedBlock(BlockDelimiter,CodeLanguage,Newline,DelimitedContent,BlockDelimiter)',
    )
    const t = '```ruby\nx\n```'
    expect(textOf(lossless(t).tree, t, 'CodeLanguage')).toBe('ruby')
    expect(kindOf(t)).toBe('listing')
    expect(shapeOf('```\nx\n```')).toBe(raw)
  })

  it('lets a style over an open block change what the block is', () => {
    expect(kindOf('[source]\n--\nx\n--')).toBe('listing')
    expect(kindOf('[pass]\n--\nx\n--')).toBe('pass')
    expect(kindOf('[abstract]\n--\nx\n--')).toBe('open')
    expect(shapeOf('[abstract]\n--\nx\n--')).toContain('Paragraph')
    expect(shapeOf('[source]\n--\nx\n--')).not.toContain('Paragraph')
  })
})

describe('nesting of blocks with delimiters', () => {
  it('nests a block of the same kind by the length of the delimiter', () => {
    expect(shapeOf('====\n======\nтекст\n======\n====')).toBe(
      'DelimitedBlock(BlockDelimiter,DelimitedBlock(BlockDelimiter,Paragraph(TextLine),BlockDelimiter),BlockDelimiter)',
    )
  })

  it('closes a block at the first line equal to its opening line', () => {
    // the inner `====` is the closing line of the outer block
    expect(shapeOf('====\ntext\n====\n\nafter\n\n====')).toBe(
      'DelimitedBlock(BlockDelimiter,Paragraph(TextLine),BlockDelimiter),BlankLine,Paragraph(TextLine),BlankLine,DelimitedBlock(BlockDelimiter)',
    )
  })

  it('runs an unclosed inner block to the end of its container', () => {
    const t = '====\n--\nтекст\n===='
    expect(shapeOf(t)).toBe(
      'DelimitedBlock(BlockDelimiter,DelimitedBlock(BlockDelimiter,Paragraph(TextLine)),BlockDelimiter)',
    )
    const doc = lossless(t)
    expect(doc.diagnostics).toEqual([
      expect.objectContaining({ from: 5, to: 7, severity: 'warning', code: 'unterminated-block' }),
    ])
  })

  it('runs an unclosed outer block to the end of the document', () => {
    const t = '====\ntext\n--\nmore\n--\n'
    const doc = lossless(t)
    expect(doc.tree.topNode.firstChild!.to).toBe(t.length)
    expect(doc.diagnostics.map((d) => [d.code, d.from])).toEqual([['unterminated-block', 0]])
  })

  it('reports an unclosed block at any depth', () => {
    expect(codesOf('====\n****\n--\ntext\n')).toEqual([
      'unterminated-block',
      'unterminated-block',
      'unterminated-block',
    ])
  })

  it('nests blocks in list items in blocks', () => {
    expect(shapeOf('====\n* a\n+\n--\ntext\n--\n====')).toBe(
      'DelimitedBlock(BlockDelimiter,UnorderedList(ListItem(ListMarker,Mark,ItemText(TextLine),ListContinuation,DelimitedBlock(BlockDelimiter,Paragraph(TextLine),BlockDelimiter))),BlockDelimiter)',
    )
  })
})

describe('block macros', () => {
  it('reads media macros with their target and attributes', () => {
    const image = 'image::a.png[Подпись,200,100]'
    expect(shapeOf(image)).toBe(
      'BlockMacro(MacroName,Mark,MacroTarget,Mark,PositionalAttribute,Mark,PositionalAttribute,Mark,PositionalAttribute,Mark)',
    )
    expect(textOf(lossless(image).tree, image, 'MacroName')).toBe('image')
    expect(textOf(lossless(image).tree, image, 'MacroTarget')).toBe('a.png')
    expect(textOf(lossless(image).tree, image, 'PositionalAttribute')).toBe('Подпись')
    expect(shapeOf('video::id[youtube]')).toContain('BlockMacro(')
    expect(shapeOf('audio::a.mp3[]')).toBe('BlockMacro(MacroName,Mark,MacroTarget,Mark)')
    expect(shapeOf('toc::[]')).toBe('BlockMacro(MacroName,Mark)')
  })

  it('reads named attributes of a macro like those of a block attribute line', () => {
    expect(shapeOf('image::a.png[alt=Text,width=10]')).toBe(
      'BlockMacro(MacroName,Mark,MacroTarget,Mark,NamedAttribute(AttributeName,Mark,AttributeValue),Mark,NamedAttribute(AttributeName,Mark,AttributeValue),Mark)',
    )
  })

  it('takes metadata lines above a macro as its children', () => {
    expect(shapeOf('.T\n[#x]\nimage::a.png[]')).toBe(
      'BlockMacro(BlockTitle(Mark,TitleText,Newline),BlockAttributes(Mark,PositionalAttribute(ShorthandId),Mark,Newline),MacroName,Mark,MacroTarget,Mark)',
    )
  })

  it('reads a macro that is not registered as a paragraph, with an info diagnostic', () => {
    expect(shapeOf('foo::bar[]')).toBe('Paragraph(TextLine)')
    expect(lossless('foo::bar[]').diagnostics).toEqual([
      expect.objectContaining({ from: 0, to: 10, severity: 'info', code: 'unknown-block-macro' }),
    ])
  })

  it('reads a registered macro as a macro', () => {
    expect(shapeOf('foo::bar[a,b=c]', { blockMacros: ['foo'] })).toBe(
      'BlockMacro(MacroName,Mark,MacroTarget,Mark,PositionalAttribute,Mark,NamedAttribute(AttributeName,Mark,AttributeValue),Mark)',
    )
    expect(codesOf('foo::bar[]', { blockMacros: ['foo'] })).toEqual([])
  })

  it('is text when not alone on its line or indented', () => {
    expect(shapeOf('text image::a.png[]')).toBe('Paragraph(TextLine)')
    expect(shapeOf('  image::a.png[]')).toBe('LiteralParagraph(TextLine)')
  })
})

describe('breaks', () => {
  it('reads thematic breaks', () => {
    for (const t of ["'''", '---', '- - -', '***', '* * *', '___', '_ _ _'])
      expect(shapeOf(t)).toBe('ThematicBreak(BreakMarker)')
  })

  it('reads a page break', () => {
    expect(shapeOf('<<<')).toBe('PageBreak(BreakMarker)')
  })

  it('takes metadata as its children', () => {
    expect(shapeOf("[.role]\n'''")).toBe(
      'ThematicBreak(BlockAttributes(Mark,PositionalAttribute(ShorthandRole),Mark,Newline),BreakMarker)',
    )
  })

  it('is not a break when it is not the whole line', () => {
    expect(shapeOf("''")).toBe('Paragraph(TextLine)')
    expect(shapeOf('<<')).toBe('Paragraph(TextLine(SpecialChar,SpecialChar))')
    expect(shapeOf('----x')).toBe('Paragraph(TextLine)')
  })
})

describe('Markdown legacy', () => {
  it('reads a quote with a nested quote and an attribution', () => {
    expect(shapeOf('> a\n>\n> > b\n> -- Автор')).toBe(
      'BlockQuote(Mark,Paragraph(TextLine),Mark,BlankLine,Mark,BlockQuote(Mark,Paragraph(TextLine)),Mark,QuoteAttribution)',
    )
  })

  it('reads a quote as one paragraph when the marker follows a text line', () => {
    // as in Asciidoctor: the line `> b` is text of the paragraph `a`
    expect(shapeOf('> a\n> > b\n> -- Автор')).toBe(
      'BlockQuote(Mark,Paragraph(TextLine,Mark,TextLine(SpecialChar,Mark)),Mark,QuoteAttribution)',
    )
  })

  it('does not read `>text` as a quote', () => {
    expect(shapeOf('>text')).toBe('Paragraph(TextLine(SpecialChar,Mark))')
  })
})

describe('a comment that is followed by a disabled underline', () => {
  it('does not read a title of a line that the preprocessor drops', () => {
    // the two lines that a comment peeks at are read raw; an escaped condition is text while the condition
    // before it disables the lines after it, so the underline is not there when the title is read
    const text = '[comment]\nifdef::attr+other[]\n\\ifdef::attr[]\n------------'
    expect(() => lossless(text)).not.toThrow()
    expect(() => lossless(text).update([{ from: 0, to: 0, insert: '\uFEFF' }])).not.toThrow()
  })
})

describe('deep nesting', () => {
  it('parses nested blocks with delimiters of growing length without overflowing the stack', () => {
    const depth = 3000
    const open = Array.from({ length: depth }, (_, i) => '='.repeat(4 + i))
    const text = [...open, 'text', ...[...open].reverse()].join('\n') + '\n'
    const doc = lossless(text)
    expect(doc.diagnostics).toEqual([])
    let blocks = 0
    doc.tree.iterate({
      enter(n) {
        if (n.name === 'DelimitedBlock') blocks++
      },
    })
    expect(blocks).toBe(depth)
  })

  /** The deepest nesting of nodes with the given name. */
  const nestingOf = (tree: Tree, name: string) => {
    let depth = 0
    let max = 0
    tree.iterate({
      enter(n) {
        if (n.name === name && ++depth > max) max = depth
      },
      leave(n) {
        if (n.name === name) depth--
      },
    })
    return max
  }

  it('parses deeply nested Markdown quotes', () => {
    // lines that follow a text line are text, so the levels must come from one line of markers ...
    const depth = 10_000
    const one = lossless('> '.repeat(depth) + 'text\n')
    expect(one.diagnostics).toEqual([])
    expect(nestingOf(one.tree, 'BlockQuote')).toBe(depth)
    // ... or from `>` lines that separate the levels
    const levels = 300
    const lines: string[] = []
    for (let i = 0; i < levels; i++) lines.push('> '.repeat(i) + '> a', '> '.repeat(i) + '>')
    lines.push('> '.repeat(levels) + 'text')
    const many = lossless(lines.join('\n') + '\n')
    expect(many.diagnostics).toEqual([])
    expect(nestingOf(many.tree, 'BlockQuote')).toBe(levels)
  })

  it('does not nest quotes on lines that follow a line of text', () => {
    const text = Array.from({ length: 50 }, (_, i) => '> '.repeat(i + 1) + 'text').join('\n') + '\n'
    expect(nestingOf(lossless(text).tree, 'BlockQuote')).toBe(1)
  })

  it('parses deeply nested unclosed conditions', () => {
    const text = 'ifdef::never[]\n'.repeat(10_000) + 'text\n'
    const doc = lossless(text)
    expect(doc.diagnostics.filter((d) => d.code === 'unterminated-conditional')).toHaveLength(10_000)
  })

  it('parses a list of many items and an item with many continuation lines', () => {
    lossless(Array.from({ length: 20_000 }, (_, i) => `* item ${i}`).join('\n') + '\n')
    lossless('* item\n' + '+\n'.repeat(20_000) + 'text\n')
  })

  it('updates a deeply nested document incrementally', () => {
    const depth = 500
    const open = Array.from({ length: depth }, (_, i) => '='.repeat(4 + i))
    const text = [...open, 'text', ...[...open].reverse()].join('\n') + '\n'
    const doc = lossless(text)
    const next = doc.update([{ from: text.indexOf('text'), insert: 'more ' }])
    expect(next.tree.length).toBe(text.length + 5)
  })
})
