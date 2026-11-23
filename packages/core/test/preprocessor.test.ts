import { describe, expect, it } from 'vitest'
import { DEFAULT_ATTRIBUTES, parse } from '@nota-adoc/core'
import { codesOf, lossless, shapeOf } from './helpers.js'

describe('conditional directives', () => {
  it('shows what an ifdef holds when the attribute is set, and keeps the lines otherwise', () => {
    const t = ':a:\n\nifdef::a[]\n* x\nendif::[]\nifndef::a[]\n----\nendif::[]\n\ntext\n'
    expect(shapeOf(t)).toBe(
      'Header(AttributeEntry(Mark,AttributeName,Mark,Newline)),BlankLine,' +
        'Directive(DirectiveName,Mark,DirectiveTarget,Mark,Newline),' +
        'UnorderedList(ListItem(ListMarker,Mark,ItemText(TextLine))),' +
        'Directive(DirectiveName,Mark,Newline),Directive(DirectiveName,Mark,DirectiveTarget,Mark,Newline),' +
        'DisabledLines,Directive(DirectiveName,Mark,Newline),BlankLine,Paragraph(TextLine)',
    )
  })

  it('does not let a disabled line open a block', () => {
    // the `----` is in the disabled lines, so nothing is left open
    const doc = lossless('ifndef::x[]\n----\nendif::[]\ntext\n', { attributes: { x: '' } })
    expect(doc.diagnostics).toEqual([])
    expect(doc.tree.toString()).toContain('DisabledLines')
    expect(doc.tree.toString()).not.toContain('DelimitedBlock')
  })

  it('runs the conditions of the caller attributes', () => {
    const t = 'ifdef::x[]\ntext\nendif::[]\n'
    expect(shapeOf(t, { attributes: { x: '' } })).toBe(
      'Directive(DirectiveName,Mark,DirectiveTarget,Mark,Newline),Paragraph(TextLine),Directive(DirectiveName,Mark,Newline)',
    )
    expect(shapeOf(t)).toBe(
      'Directive(DirectiveName,Mark,DirectiveTarget,Mark,Newline),DisabledLines,Directive(DirectiveName,Mark,Newline)',
    )
  })

  it('reads the forms with several names', () => {
    const on = { attributes: { a: '', b: '' } }
    const onlyA = { attributes: { a: '' } }
    const shown = (t: string, o?: Parameters<typeof parse>[1]) => !shapeOf(t, o).includes('DisabledLines')
    expect(shown('ifdef::a,b[]\nx\nendif::[]', onlyA)).toBe(true)
    expect(shown('ifdef::a,b[]\nx\nendif::[]')).toBe(false)
    expect(shown('ifdef::a+b[]\nx\nendif::[]', onlyA)).toBe(false)
    expect(shown('ifdef::a+b[]\nx\nendif::[]', on)).toBe(true)
    expect(shown('ifndef::a,b[]\nx\nendif::[]', onlyA)).toBe(false)
    expect(shown('ifndef::a+b[]\nx\nendif::[]', onlyA)).toBe(true)
    expect(shown('ifndef::a[]\nx\nendif::[]')).toBe(true)
  })

  it('reads a one-line ifdef, whose text is read as a line', () => {
    expect(shapeOf('ifdef::a[a text line]', { attributes: { a: '' } })).toBe(
      'Directive(DirectiveName,Mark,DirectiveTarget,Mark),Paragraph(TextLine)',
    )
    expect(shapeOf('ifdef::a[a text line]')).toBe(
      'Directive(DirectiveName,Mark,DirectiveTarget,Mark,DirectiveText,Mark)',
    )
    expect(shapeOf('ifdef::a[* item]', { attributes: { a: '' } })).toContain('UnorderedList')
  })

  it('evaluates ifeval with the attributes of the moment', () => {
    const t = ':n: 3\n\nifeval::[{n} > 2]\nyes\nendif::[]\nifeval::["{s}" == "x"]\nno\nendif::[]\n'
    expect(shapeOf(t)).toContain('Paragraph(TextLine),Directive(DirectiveName,Mark,Newline),Directive')
    expect(shapeOf(t)).toContain('DisabledLines')
    const yes = (expr: string, attributes = {}) =>
      !shapeOf(`ifeval::[${expr}]\nx\nendif::[]`, { attributes }).includes('DisabledLines')
    expect(yes('1 == 1')).toBe(true)
    expect(yes('1 != 1')).toBe(false)
    expect(yes('2 >= 2')).toBe(true)
    expect(yes('1 < 0.5')).toBe(false)
    expect(yes('"a" < "b"')).toBe(true)
    expect(yes("'{v}' == 'x'", { v: 'x' })).toBe(true)
    expect(yes('{v} > 1', { v: '2' })).toBe(true)
  })

  it('nests conditions', () => {
    const t = 'ifdef::a[]\nA\nifdef::b[]\nB\nendif::[]\nendif::[]\n'
    // a is set, b is not: the inner block is off
    expect(shapeOf(t, { attributes: { a: '' } })).toBe(
      'Directive(DirectiveName,Mark,DirectiveTarget,Mark,Newline),Paragraph(TextLine),' +
        'Directive(DirectiveName,Mark,DirectiveTarget,Mark,Newline),DisabledLines,' +
        'Directive(DirectiveName,Mark,Newline),Directive(DirectiveName,Mark,Newline)',
    )
    expect(shapeOf(t, { attributes: { a: '', b: '' } })).not.toContain('DisabledLines')
    // nothing is set: everything is off, and the inner directives are still tracked
    expect(shapeOf(t)).toBe(
      'Directive(DirectiveName,Mark,DirectiveTarget,Mark,Newline),DisabledLines,' +
        'Directive(DirectiveName,Mark,DirectiveTarget,Mark,Newline),DisabledLines,' +
        'Directive(DirectiveName,Mark,Newline),Directive(DirectiveName,Mark,Newline)',
    )
  })

  it('reads an escaped directive as text', () => {
    expect(shapeOf('\\ifdef::a[]')).toBe('Mark,Paragraph(TextLine)')
    expect(codesOf('\\ifdef::a[]')).toEqual([])
  })

  it('evaluates conditions inside a listing', () => {
    expect(shapeOf('----\nifdef::x[]\nhidden\nendif::[]\nshown\n----')).toBe(
      'DelimitedBlock(BlockDelimiter,Directive(DirectiveName,Mark,DirectiveTarget,Mark,Newline),DisabledLines,Directive(DirectiveName,Mark,Newline),DelimitedContent,BlockDelimiter)',
    )
  })

  it('keeps lines that are off between the lines of a paragraph', () => {
    expect(shapeOf('a\nifdef::x[]\nb\nendif::[]\nc')).toBe(
      'Paragraph(TextLine,Directive(DirectiveName,Mark,DirectiveTarget,Mark,Newline),DisabledLines,Directive(DirectiveName,Mark,Newline),TextLine)',
    )
  })

  it('reads an attribute line right under text as text', () => {
    expect(shapeOf('текст\n:a:')).toBe('Paragraph(TextLine,TextLine)')
    // so the attribute is not set and the condition is off
    expect(shapeOf('текст\n:a:\n\nifdef::a[]\nx\nendif::[]')).toContain('DisabledLines')
  })
})

describe('include directives', () => {
  it('is a node with the target and the attributes, and does not bring the content', () => {
    expect(shapeOf('include::part.adoc[leveloffset=+1]')).toBe(
      'IncludeDirective(DirectiveName,Mark,DirectiveTarget,Mark,NamedAttribute(AttributeName,Mark,AttributeValue),Mark)',
    )
    expect(shapeOf('include::a.adoc[]\n')).toBe(
      'IncludeDirective(DirectiveName,Mark,DirectiveTarget,Mark,Newline)',
    )
  })

  it('is a child of a paragraph and does not break it', () => {
    expect(shapeOf('text\ninclude::a.adoc[]\nmore')).toBe(
      'Paragraph(TextLine,IncludeDirective(DirectiveName,Mark,DirectiveTarget,Mark,Newline),TextLine)',
    )
  })

  it('is not read in a condition that is off', () => {
    expect(shapeOf('ifdef::x[]\ninclude::a.adoc[]\nendif::[]')).not.toContain('IncludeDirective')
    expect(shapeOf('\\include::a.adoc[]')).toBe('Mark,Paragraph(TextLine)')
  })
})

describe('attributes', () => {
  it('sets attributes by entries in the header and the body, unsets them, and reads the value with references', () => {
    const on = (t: string) => !shapeOf(t).includes('DisabledLines')
    expect(on('= T\n:a:\n\nifdef::a[]\nx\nendif::[]')).toBe(true)
    expect(on(':a:\n:a!:\n\nifdef::a[]\nx\nendif::[]')).toBe(false)
    expect(on(':a:\n:!a:\n\nifdef::a[]\nx\nendif::[]')).toBe(false)
    expect(on(':a: 1\n:b: {a}\n\nifeval::[{b} == 1]\nx\nendif::[]')).toBe(true)
    expect(on('text\n\n:a:\n\nifdef::a[]\nx\nendif::[]')).toBe(true)
  })

  it('sets attributes from the header lines', () => {
    const head = '= Title\nJane Roe <jane@example.org>\nv1.2, 2026-09-29: A remark\n\n'
    for (const name of [
      'doctitle',
      'author',
      'email',
      'firstname',
      'authorinitials',
      'revnumber',
      'revdate',
      'revremark',
    ])
      expect(shapeOf(`${head}ifdef::${name}[]\nx\nendif::[]`)).not.toContain('DisabledLines')
    expect(shapeOf('ifdef::author[]\nx\nendif::[]')).toContain('DisabledLines')
  })

  it('changes the doctype attributes with the header entry only', () => {
    const on = (t: string) => !shapeOf(t).includes('DisabledLines')
    expect(on(':doctype: book\n\nifdef::doctype-book[]\nx\nendif::[]')).toBe(true)
    expect(on(':doctype: book\n\nifdef::doctype-article[]\nx\nendif::[]')).toBe(false)
    expect(on('text\n\n:doctype: book\n\nifdef::doctype-book[]\nx\nendif::[]')).toBe(false)
  })

  it('reads leveloffset as an attribute', () => {
    const t = ':leveloffset: +1\n\nifeval::[{leveloffset} == 1]\nx\nendif::[]'
    expect(shapeOf(t)).not.toContain('DisabledLines')
  })
})

describe('default attributes and ParseOptions.attributes', () => {
  it('defines the attributes Asciidoctor defines in secure mode', () => {
    for (const name of Object.keys(DEFAULT_ATTRIBUTES))
      expect(shapeOf(`ifdef::${name}[]\nx\nendif::[]`)).not.toContain('DisabledLines')
    // environment attributes are not defined by default
    for (const name of ['docdir', 'user-home', 'localdate', 'docdate', 'stylesdir', 'iconsdir', 'localtime'])
      expect(shapeOf(`ifdef::${name}[]\nx\nendif::[]`)).toContain('DisabledLines')
  })

  it('takes attributes from the options: a string sets, null unsets, false does not lock', () => {
    const t = 'ifdef::x[]\ntext\nendif::[]\n'
    expect(shapeOf(t, { attributes: { x: '' } })).not.toContain('DisabledLines')
    expect(shapeOf(t)).toContain('DisabledLines')
    // null removes an attribute that is set by default
    const d = 'ifdef::sectids[]\ntext\nendif::[]\n'
    expect(shapeOf(d)).not.toContain('DisabledLines')
    expect(shapeOf(d, { attributes: { sectids: null } })).toContain('DisabledLines')
    expect(shapeOf('ifdef::x[]\ntext\nendif::[]', { attributes: { '!x': '' } })).toContain('DisabledLines')
  })

  it('locks the attributes of the caller, unless the value ends in @', () => {
    const entry = (opts: Parameters<typeof parse>[1]) =>
      !shapeOf(':x!:\n\nifdef::x[]\ntext\nendif::[]\n', opts).includes('DisabledLines')
    expect(entry({ attributes: { x: '' } })).toBe(true) // the document cannot unset it
    expect(entry({ attributes: { x: '@' } })).toBe(false) // it can
    expect(entry({ attributes: { 'x@': '' } })).toBe(false)
  })

  it('applies to incremental updates too', () => {
    const doc = parse('text\n\nifdef::x[]\nA\nendif::[]\n', { attributes: { x: '' } })
    const next = doc.update([{ from: 0, to: 4, insert: 'TEXT' }])
    expect(next.tree.toString()).toBe(parse(next.text, { attributes: { x: '' } }).tree.toString())
    expect(next.tree.toString()).not.toContain('DisabledLines')
  })
})

describe('comment style', () => {
  // Asciidoctor peeks the second line raw for a comment and reads the content with the preprocessor off
  it('keeps directives under [comment] as text of the comment paragraph', () => {
    const t = '[comment]\ntext\nifdef::x[]\nmore\nendif::[]\n\nafter\n'
    for (const o of [undefined, { attributes: { x: '' } }]) {
      const doc = lossless(t, o)
      expect(doc.diagnostics).toEqual([])
      expect(shapeOf(t, o)).toBe(
        'StyledParagraph(BlockAttributes(Mark,PositionalAttribute,Mark,Newline),TextLine,TextLine,TextLine,TextLine),BlankLine,Paragraph(TextLine)',
      )
    }
  })

  it('keeps directives inside a [comment] open block as text', () => {
    const t = '[comment]\n--\nifdef::x[]\nmore\nendif::[]\n--\n\nafter\n'
    for (const o of [undefined, { attributes: { x: '' } }]) {
      const doc = lossless(t, o)
      expect(doc.diagnostics).toEqual([])
      expect(shapeOf(t, o)).toBe(
        'DelimitedBlock(BlockAttributes(Mark,PositionalAttribute,Mark,Newline),BlockDelimiter,DelimitedContent,BlockDelimiter),BlankLine,Paragraph(TextLine)',
      )
    }
  })
})

describe('conditional diagnostics', () => {
  it('reports an unterminated condition on its line', () => {
    const doc = lossless('text\n\nifdef::a[]\nmore\n')
    expect(doc.diagnostics).toEqual([
      expect.objectContaining({ from: 6, to: 16, code: 'unterminated-conditional' }),
    ])
    expect(lossless('ifeval::[1 == 1]\ntext').diagnostics.map((d) => d.code)).toEqual([
      'unterminated-conditional',
    ])
    expect(lossless('ifndef::a[]\ntext\nendif::[]').diagnostics).toEqual([])
  })

  it('reports an endif without a partner or with another name', () => {
    expect(lossless('endif::[]').diagnostics).toEqual([
      expect.objectContaining({ from: 0, to: 9, severity: 'error', code: 'unmatched-endif' }),
    ])
    expect(codesOf('ifdef::a[]\nendif::b[]')).toEqual(['unterminated-conditional', 'unmatched-endif'])
  })

  it('reports directives that are malformed', () => {
    expect(codesOf('ifdef::[]\nx')).toEqual(['malformed-directive'])
    expect(codesOf('ifeval::[nonsense]')).toEqual(['malformed-directive'])
    expect(codesOf('ifeval::a[1 == 1]')).toEqual(['malformed-directive'])
  })
})
