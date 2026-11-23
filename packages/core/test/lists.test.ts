import { describe, expect, it } from 'vitest'
import { codesOf, lossless, shapeOf, textOf } from './helpers.js'

const item = 'ListItem(ListMarker,Mark,ItemText(TextLine))'
const list = (...items: string[]) => `UnorderedList(${items.join(',')})`

describe('bulleted lists', () => {
  it('nests by the order the markers appear, not by their length', () => {
    expect(shapeOf('* a\n** b\n* c')).toBe(
      list(`ListItem(ListMarker,Mark,ItemText(TextLine),${list(item)})`, item),
    )
    // `*` comes after `**` and so lies inside it
    expect(shapeOf('** a\n* b')).toBe(list(`ListItem(ListMarker,Mark,ItemText(TextLine),${list(item)})`))
  })

  it('reads all the markers', () => {
    for (const marker of ['-', '*', '**', '*****', '•'])
      expect(shapeOf(`${marker} a\n${marker} b`)).toBe(list(item, item))
    // a marker alone, or glued to the text, is not a list
    expect(shapeOf('*a')).toBe('Paragraph(TextLine)')
    expect(shapeOf('-')).toBe('Paragraph(TextLine)')
  })

  it('keeps the lines of an item text together', () => {
    expect(shapeOf('* a\nещё строка')).toBe(list('ListItem(ListMarker,Mark,ItemText(TextLine,TextLine))'))
    expect(shapeOf('* a\n  indented\n* b')).toBe(
      list('ListItem(ListMarker,Mark,ItemText(TextLine,TextLine))', item),
    )
  })

  it('glues a literal paragraph after a blank line to the item', () => {
    expect(shapeOf('* a\n\n  отступ')).toBe(
      list('ListItem(ListMarker,Mark,ItemText(TextLine),BlankLine,LiteralParagraph(TextLine))'),
    )
  })

  it('glues blocks with a list continuation', () => {
    expect(shapeOf('* a\n+\n----\ncode\n----\n* b')).toBe(
      list(
        'ListItem(ListMarker,Mark,ItemText(TextLine),ListContinuation,DelimitedBlock(BlockDelimiter,DelimitedContent,BlockDelimiter))',
        item,
      ),
    )
    expect(shapeOf('* a\n+\nabзац')).toBe(
      list('ListItem(ListMarker,Mark,ItemText(TextLine),ListContinuation,Paragraph(TextLine))'),
    )
  })

  it('glues to the ancestor when a blank line comes before the plus', () => {
    // the paragraph is a child of `a`, after its nested list
    expect(shapeOf('* a\n** b\n\n+\nабзац')).toBe(
      list(
        `ListItem(ListMarker,Mark,ItemText(TextLine),${list(item)},BlankLine,ListContinuation,Paragraph(TextLine))`,
      ),
    )
  })

  it('splits neighbouring lists with a comment line', () => {
    expect(shapeOf('* a\n\n//\n* b')).toBe(`${list(item)},BlankLine,LineComment,${list(item)}`)
  })

  it('keeps blank lines between items in the list and after the last one outside', () => {
    expect(shapeOf('* a\n\n* b\n\nText')).toBe(
      `${list(item, 'BlankLine', item)},BlankLine,Paragraph(TextLine)`,
    )
  })

  it('marks the kind of the list in the node name', () => {
    expect(shapeOf('. a').startsWith('OrderedList(')).toBe(true)
    expect(shapeOf('term:: a').startsWith('DescriptionList(')).toBe(true)
    expect(shapeOf('<1> a').startsWith('CalloutList(')).toBe(true)
    const doc = lossless('* a\n')
    expect(doc.tree.topNode.firstChild!.type.is('List')).toBe(true)
  })
})

describe('ordered lists', () => {
  it('reads dots, numbers, letters and roman numerals', () => {
    for (const [a, b] of [
      ['.', '.'],
      ['1.', '2.'],
      ['a.', 'b.'],
      ['A.', 'B.'],
      ['i)', 'ii)'],
      ['I)', 'II)'],
    ])
      expect(shapeOf(`${a} x\n${b} y`)).toBe(
        'OrderedList(ListItem(ListMarker,Mark,ItemText(TextLine)),ListItem(ListMarker,Mark,ItemText(TextLine)))',
      )
  })

  it('nests dots of different length', () => {
    expect(shapeOf('. a\n.. b\n. c')).toBe(
      'OrderedList(ListItem(ListMarker,Mark,ItemText(TextLine),OrderedList(ListItem(ListMarker,Mark,ItemText(TextLine)))),ListItem(ListMarker,Mark,ItemText(TextLine)))',
    )
  })

  it('nests lists of different kinds', () => {
    expect(shapeOf('* a\n. b\n* c')).toBe(
      'UnorderedList(ListItem(ListMarker,Mark,ItemText(TextLine),OrderedList(ListItem(ListMarker,Mark,ItemText(TextLine)))),ListItem(ListMarker,Mark,ItemText(TextLine)))',
    )
  })
})

describe('description lists', () => {
  const term = 'DescriptionTerm,ListMarker,Mark,ItemText(TextLine)'

  it('reads the four delimiters', () => {
    for (const d of ['::', ';;', ':::', '::::'])
      expect(shapeOf(`term${d} text\nother${d} text`)).toBe(
        `DescriptionList(ListItem(${term}),ListItem(${term}))`,
      )
  })

  it('gives several terms one description', () => {
    expect(shapeOf('a::\nb:: shared')).toBe(
      `DescriptionList(ListItem(DescriptionTerm,ListMarker,Newline,${term}))`,
    )
  })

  it('takes the description from the next line', () => {
    expect(shapeOf('term::\n  next line')).toBe(
      'DescriptionList(ListItem(DescriptionTerm,ListMarker,Newline,ItemText(TextLine)))',
    )
  })

  it('takes a term with no description', () => {
    expect(shapeOf('term::')).toBe('DescriptionList(ListItem(DescriptionTerm,ListMarker))')
  })

  it('nests a delimiter that is different', () => {
    expect(shapeOf('a:: x\nb::: y')).toBe(
      'DescriptionList(ListItem(DescriptionTerm,ListMarker,Mark,ItemText(TextLine),DescriptionList(ListItem(DescriptionTerm,ListMarker,Mark,ItemText(TextLine)))))',
    )
  })

  it('exposes the term text', () => {
    const t = 'first term:: text'
    expect(textOf(lossless(t).tree, t, 'DescriptionTerm')).toBe('first term')
  })
})

describe('text kept for a list item that does not take it', () => {
  it('keeps a condition line between the lines of the text in place', () => {
    // a literal paragraph after a break in a description list item: its text is read on its own, and the
    // condition line (which shows nothing) lies between two lines of it
    const text = "term::: text\n'''\n literal line\nifdef::attr[one line of text]\n= Document Title"
    expect(shapeOf(text)).toBe(
      'DescriptionList(ListItem(DescriptionTerm,ListMarker,Mark,ItemText(TextLine),ThematicBreak(BreakMarker),Paragraph(TextLine,Directive(DirectiveName,Mark,DirectiveTarget,Mark,DirectiveText,Mark,Newline),TextLine)))',
    )
  })
})

describe('callout lists and checklists', () => {
  it('reads numbered and automatic callouts', () => {
    const doc = lossless('<1> one\n<2> two\n')
    expect(doc.tree.toString()).toContain('CalloutList(')
    expect(shapeOf('<.> one\n<.> two')).toBe(
      'CalloutList(ListItem(ListMarker,Mark,ItemText(TextLine)),ListItem(ListMarker,Mark,ItemText(TextLine)))',
    )
  })

  it('reads the box of a checklist item', () => {
    for (const box of ['[x]', '[ ]', '[*]'])
      expect(shapeOf(`* ${box} text`)).toBe(
        'UnorderedList(ListItem(ListMarker,Mark,Checkbox,Mark,ItemText(TextLine)))',
      )
    for (const text of ['* [X] text', '* [] text', '* [x]']) expect(shapeOf(text)).toBe(list(item))
    const t = '* [x] done'
    expect(textOf(lossless(t).tree, t, 'Checkbox')).toBe('[x]')
  })
})

describe('list diagnostics', () => {
  it('reports an item number out of order as a warning', () => {
    const doc = lossless('1. a\n3. b')
    expect(doc.diagnostics).toEqual([
      expect.objectContaining({ from: 5, to: 9, severity: 'warning', code: 'list-item-index' }),
    ])
    expect(lossless('1. a\n2. b').diagnostics).toEqual([])
    expect(lossless('a. a\nc. b').diagnostics.map((d) => d.code)).toEqual(['list-item-index'])
  })

  it('reports a line that looks like a list item but is text', () => {
    const doc = lossless('текст\n* пункт')
    expect(shapeOf('текст\n* пункт')).toBe('Paragraph(TextLine,TextLine)')
    expect(doc.diagnostics).toEqual([
      expect.objectContaining({ from: 6, to: 13, severity: 'info', code: 'list-item-as-text' }),
    ])
  })

  it('does not report it where the lines are shown as they are, or not at all', () => {
    for (const style of ['comment', 'literal', 'listing', 'source', 'verse', 'pass']) {
      expect(codesOf(`[${style}]\ntext\n* item`)).toEqual([])
    }
    expect(codesOf('[NOTE]\ntext\n* item')).toEqual(['list-item-as-text'])
    expect(codesOf(' indented\n* item')).toEqual([])
  })
})

describe('blank lines that a block takes', () => {
  it('lets a paragraph after a verbatim paragraph break at a list item, as the blank line is not skipped', () => {
    // Asciidoctor reads a [literal] paragraph up to the blank line and keeps it: the next block sees no blank
    // line before it, so its paragraph ends at a list item
    expect(shapeOf('- a\n[literal]\nb::::\n\nthe item\n** c')).toBe(
      list(
        `ListItem(ListMarker,Mark,ItemText(TextLine),StyledParagraph(BlockAttributes(Mark,PositionalAttribute,Mark,Newline),TextLine),BlankLine,Paragraph(TextLine),${list(item)})`,
      ),
    )
    // a blank line and text that is not part of the item end the list; the paragraph is not in it
    expect(shapeOf('- a\n\nthe item\n** b')).toBe(`${list(item)},BlankLine,Paragraph(TextLine,TextLine)`)
  })
})
