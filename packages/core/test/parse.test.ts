import { describe, expect, it } from 'vitest'
import { parse, sectionLevel } from '@nota-adoc/core'
import { leafTexts, shape, textOf } from './helpers.js'

const lossless = (text: string) => {
  const doc = parse(text)
  expect(doc.text).toBe(text)
  expect(doc.tree.length).toBe(text.length)
  expect(leafTexts(doc.tree, text).join('')).toBe(text)
  return doc
}

const shapeOf = (text: string) => shape(lossless(text).tree)

describe('document basics', () => {
  it('parses the empty document', () => {
    const doc = lossless('')
    expect(doc.diagnostics).toEqual([])
    expect(shape(doc.tree)).toBe('')
  })

  it('keeps a paragraph of several lines', () => {
    expect(shapeOf('Hello\nworld\n')).toBe('Paragraph(TextLine,TextLine)')
  })

  it('separates paragraphs by blank lines, whitespace-only lines are blank', () => {
    expect(shapeOf('a\n\n \t\nb')).toBe('Paragraph(TextLine),BlankLine,BlankLine,Paragraph(TextLine)')
  })

  it('keeps a byte order mark as its own leaf', () => {
    expect(shapeOf('\uFEFFa\n')).toBe('ByteOrderMark,Paragraph(TextLine)')
  })

  it('treats CRLF as a line end and a lone CR as text', () => {
    expect(shapeOf('a\r\n\r\nb\rc\r\n')).toBe('Paragraph(TextLine),BlankLine,Paragraph(TextLine)')
  })
})

describe('document header', () => {
  it('parses title, authors, revision and attribute entries', () => {
    const text =
      '= The Title\nJane Doe <jane@example.com>; John Roe\nv1.0, 2026-09-25: First draft\n:toc:\n\nBody\n'
    expect(shapeOf(text)).toBe(
      'Header(DocumentTitle(SectionMarker,Mark,TitleText,Newline),' +
        'AuthorLine(Author(AuthorName,Mark,AuthorEmail,Mark),Mark,Author(AuthorName),Newline),' +
        'RevisionLine(Mark,RevisionNumber,Mark,RevisionDate,Mark,RevisionRemark,Newline),' +
        'AttributeEntry(Mark,AttributeName,Mark,Newline)),BlankLine,Paragraph(TextLine)',
    )
    const doc = parse(text)
    expect(textOf(doc.tree, text, 'TitleText')).toBe('The Title')
    expect(textOf(doc.tree, text, 'AuthorEmail')).toBe('jane@example.com')
    expect(textOf(doc.tree, text, 'RevisionNumber')).toBe('1.0')
    expect(textOf(doc.tree, text, 'RevisionRemark')).toBe('First draft')
  })

  it('takes the line after the title as the author line whatever it is', () => {
    expect(shapeOf('= T\n== Not a section\n')).toBe(
      'Header(DocumentTitle(SectionMarker,Mark,TitleText,Newline),AuthorLine(Author(AuthorName),Newline))',
    )
  })

  it('keeps attribute entries and comments above the title in the header', () => {
    expect(shapeOf(':doctype: book\n// c\n= T\n')).toBe(
      'Header(AttributeEntry(Mark,AttributeName,Mark,AttributeValue(ValueText),Newline),LineComment,' +
        'DocumentTitle(SectionMarker,Mark,TitleText,Newline))',
    )
  })

  it('makes a header of attribute entries when there is no title', () => {
    expect(shapeOf(':a: b\n\nText\n')).toBe(
      'Header(AttributeEntry(Mark,AttributeName,Mark,AttributeValue(ValueText),Newline)),BlankLine,Paragraph(TextLine)',
    )
  })

  it('does not make a header of comments alone', () => {
    expect(shapeOf('// c\nText\n')).toBe('LineComment,Paragraph(TextLine)')
  })

  it('parses a setext document title', () => {
    expect(shapeOf('Title\n=====\n')).toBe('Header(DocumentTitle(TitleText,Newline,SetextUnderline,Newline))')
  })

  it('takes the NAME section of a manpage into the header', () => {
    expect(shapeOf('= prog(1)\n:doctype: manpage\n\n== Name\n\nprog - does things\n\n== Synopsis\n')).toBe(
      'Header(DocumentTitle(SectionMarker,Mark,TitleText,Newline),' +
        'AttributeEntry(Mark,AttributeName,Mark,AttributeValue(ValueText),Newline),BlankLine,' +
        'SectionTitle(SectionMarker,Mark,TitleText,Newline),BlankLine,TextLine),BlankLine,' +
        'Section(SectionTitle(SectionMarker,Mark,TitleText,Newline))',
    )
  })

  it('leaves a manpage NAME section without a purpose line in the body', () => {
    expect(shapeOf('= prog(1)\n:doctype: manpage\n\n== Name\n\nno purpose here\n')).toBe(
      'Header(DocumentTitle(SectionMarker,Mark,TitleText,Newline),' +
        'AttributeEntry(Mark,AttributeName,Mark,AttributeValue(ValueText),Newline)),BlankLine,' +
        'Section(SectionTitle(SectionMarker,Mark,TitleText,Newline),BlankLine,Paragraph(TextLine))',
    )
  })

  it('does not accept a block title above the document title', () => {
    expect(shapeOf('.Caption\n= T\n')).toBe(
      'Section(BlockTitle(Mark,TitleText,Newline),SectionTitle(SectionMarker,Mark,TitleText,Newline))',
    )
  })
})

describe('attribute entries', () => {
  it('parses set, unset and continued entries in the body', () => {
    const text = 'Text\n\n:a: 1\n:b!:\n:!c:\n:d: one \\\n  two + \\\n three\n'
    expect(shapeOf(text)).toBe(
      'Paragraph(TextLine),BlankLine,' +
        'AttributeEntry(Mark,AttributeName,Mark,AttributeValue(ValueText),Newline),' +
        'AttributeEntry(Mark,AttributeName,UnsetMarker,Mark,Newline),' +
        'AttributeEntry(Mark,UnsetMarker,AttributeName,Mark,Newline),' +
        'AttributeEntry(Mark,AttributeName,Mark,AttributeValue(ValueText,LineContinuation,Newline,Mark,ValueText,LineContinuation,Newline,Mark,ValueText),Newline)',
    )
  })

  it('treats an entry line right under a paragraph line as paragraph text', () => {
    expect(shapeOf('Text\n:a: b\n')).toBe('Paragraph(TextLine,TextLine)')
  })
})

describe('sections', () => {
  it('nests sections by level', () => {
    expect(shapeOf('== A\n=== B\ntext\n\n== C\n')).toBe(
      'Section(SectionTitle(SectionMarker,Mark,TitleText,Newline),' +
        'Section(SectionTitle(SectionMarker,Mark,TitleText,Newline),Paragraph(TextLine),BlankLine)),' +
        'Section(SectionTitle(SectionMarker,Mark,TitleText,Newline))',
    )
  })

  it('parses Markdown, symmetric and setext titles', () => {
    expect(shapeOf('## A ##\n\nBC\n~~~\n')).toBe(
      'Section(SectionTitle(SectionMarker,Mark,TitleText,Mark,SectionMarker,Newline),BlankLine,' +
        'Section(SectionTitle(TitleText,Newline,SetextUnderline,Newline)))',
    )
  })

  it('does not take ==Text or seven = as a title', () => {
    expect(shapeOf('==Text\n\n======= Seven\n')).toBe('Paragraph(TextLine),BlankLine,Paragraph(TextLine)')
  })

  it('attaches metadata lines to the section', () => {
    expect(shapeOf('[[id]]\n[appendix]\n== A\n')).toBe(
      'Section(BlockAnchor(Mark,AnchorId,Mark,Newline),BlockAttributes(Mark,PositionalAttribute,Mark,Newline),' +
        'SectionTitle(SectionMarker,Mark,TitleText,Newline))',
    )
  })

  it('keeps a title line right under a paragraph line as text', () => {
    expect(shapeOf('Text\n== Not a title\n')).toBe('Paragraph(TextLine,TextLine)')
  })

  it('records the effective level with leveloffset', () => {
    const doc = lossless(':leveloffset: +1\n\n== A\n\n:leveloffset: -1\n\n=== B\n')
    const levels: number[] = []
    doc.tree.iterate({
      enter(node) {
        if (node.name === 'Section') levels.push(node.node.tree!.prop(sectionLevel)!)
      },
    })
    expect(levels).toEqual([2, 2])
  })

  describe('{set:leveloffset} in text leaves the block parse alone', () => {
    const levelsOf = (text: string) => {
      const doc = lossless(text)
      const levels: number[] = []
      doc.tree.iterate({
        enter(node) {
          if (node.name === 'Section') levels.push(node.node.tree!.prop(sectionLevel)!)
        },
      })
      return levels
    }

    it('the section level stays', () => {
      expect(levelsOf('{set:leveloffset:1}\n\n== A\n')).toEqual([1])
      expect(levelsOf('{set:leveloffset:+1}\n\n== A\n')).toEqual([1])
      expect(levelsOf(':leveloffset: 1\n\n{set:leveloffset!}\n\n== A\n')).toEqual([2])
    })

    it('in a list item text before a block, in a block title, in a section title', () => {
      const plain = levelsOf('* item\n+\npara\n\n== A\n')
      expect(levelsOf('* item {set:leveloffset:1}\n+\npara\n\n== A\n')).toEqual(plain)
      // the block follows the item line at once: the trial read
      expect(levelsOf('* item {set:leveloffset:1}\nmore\n\n== A\n')).toEqual(levelsOf('* item\nmore\n\n== A\n'))
      expect(levelsOf('.T1 {set:leveloffset:1}\n.T2\npara\n\n== A\n')).toEqual(levelsOf('.T2\npara\n\n== A\n'))
      expect(levelsOf('== S {set:leveloffset:1}\n\n== A\n')).toEqual([1, 1])
    })

    it('a relative entry counts from the parse value', () => {
      expect(levelsOf(':leveloffset: +1\n\n{set:leveloffset:1}\n\n== A\n')).toEqual([2])
      expect(levelsOf('{set:leveloffset:1}\n\n:leveloffset: +1\n\n== A\n')).toEqual([2])
    })

    it('outline() level', () => {
      expect(parse('{set:leveloffset:1}\n\n== A\n').outline().map((e) => e.level)).toEqual([1])
    })

    it('a document in a cell does not take the offset of {set:}', () => {
      const t = '{set:leveloffset:1}\n\n|===\na|\n== S\n\ntext\n|===\n'
      expect(levelsOf(t)).toEqual(levelsOf('|===\na|\n== S\n\ntext\n|===\n'))
      expect(levelsOf('{set:leveloffset:1}\n\n|===\na|\n== S\n\ntext\n|===\n').length).toBeGreaterThan(0)
    })
  })

  it('parses a discrete heading as a block', () => {
    expect(shapeOf('[discrete]\n== D\n')).toBe(
      'DiscreteHeading(BlockAttributes(Mark,PositionalAttribute,Mark,Newline),SectionMarker,Mark,TitleText,Newline)',
    )
  })
})

describe('paragraphs', () => {
  it('distinguishes literal, admonition and styled paragraphs', () => {
    expect(shapeOf(' lit\n\nNOTE: note\n\n[quote, Someone]\nq\n')).toBe(
      'LiteralParagraph(TextLine),BlankLine,AdmonitionParagraph(AdmonitionMarker,TextLine),BlankLine,' +
        'StyledParagraph(BlockAttributes(Mark,PositionalAttribute,Mark,PositionalAttribute,Mark,Newline),TextLine)',
    )
  })

  it('keeps a line comment inside a paragraph as its child', () => {
    expect(shapeOf('a\n// c\nb\n')).toBe('Paragraph(TextLine,LineComment,TextLine)')
  })

  it('interrupts a paragraph by an attribute line and by a delimiter line', () => {
    expect(shapeOf('a\n[x]\nb\n----\nc\n----\n')).toBe(
      'Paragraph(TextLine),Paragraph(BlockAttributes(Mark,PositionalAttribute,Mark,Newline),TextLine),' +
        'DelimitedBlock(BlockDelimiter,DelimitedContent,BlockDelimiter)',
    )
  })

  it('attaches block metadata through a blank line', () => {
    expect(shapeOf('.Title\n[#x.r%o]\n\ntext\n')).toBe(
      'Paragraph(BlockTitle(Mark,TitleText,Newline),' +
        'BlockAttributes(Mark,PositionalAttribute(ShorthandId,ShorthandRole,ShorthandOption),Mark,Newline),BlankLine,TextLine)',
    )
  })

  it('parses named attributes', () => {
    expect(shapeOf('[source,json,title="a, b"]\nx\n')).toBe(
      'StyledParagraph(BlockAttributes(Mark,PositionalAttribute,Mark,PositionalAttribute,Mark,' +
        'NamedAttribute(AttributeName,Mark,AttributeValue),Mark,Newline),TextLine)',
    )
  })
})

describe('comments and delimited blocks', () => {
  it('parses line and block comments; /// is text', () => {
    expect(shapeOf('// a\n////\nb\n////\n/// c\n')).toBe(
      'LineComment,BlockComment(CommentDelimiter,CommentContent,CommentDelimiter),Paragraph(TextLine)',
    )
  })

  it('keeps a listing unparsed and closes it on the first equal line', () => {
    expect(shapeOf('----\n== x\n// y\n:a: b\n------\n----\n')).toBe(
      'DelimitedBlock(BlockDelimiter,DelimitedContent,BlockDelimiter)',
    )
  })
})

describe('diagnostics', () => {
  it('reports an unterminated block comment on the opening delimiter', () => {
    const doc = lossless('text\n\n////\nabc\n')
    expect(shape(doc.tree)).toBe(
      'Paragraph(TextLine),BlankLine,BlockComment(CommentDelimiter,CommentContent)',
    )
    expect(doc.diagnostics).toEqual([
      expect.objectContaining({ from: 6, to: 10, severity: 'warning', code: 'unterminated-block' }),
    ])
  })

  it('reports an unterminated delimited block', () => {
    const doc = lossless('----\nabc\n')
    expect(doc.diagnostics).toEqual([expect.objectContaining({ from: 0, to: 4, code: 'unterminated-block' })])
  })

  it('reports a skipped section level on the title', () => {
    const doc = lossless('== A\n==== B\n')
    expect(doc.diagnostics).toEqual([
      expect.objectContaining({ from: 5, to: 11, code: 'section-level-skipped' }),
    ])
  })

  it('reports a level 0 section in an article but not in a book', () => {
    expect(lossless('= Doc\n\n= Part\n').diagnostics).toEqual([
      expect.objectContaining({ from: 7, to: 13, severity: 'error', code: 'level-0-section-in-article' }),
    ])
    expect(lossless('= Doc\n:doctype: book\n\n= Part\n\n== Chapter\n').diagnostics).toEqual([])
  })

  it('gives every diagnostic from, to, severity, code and message', () => {
    for (const d of lossless('----\n').diagnostics) {
      expect(Object.keys(d).sort()).toEqual(['code', 'from', 'message', 'severity', 'to'])
    }
  })
})
