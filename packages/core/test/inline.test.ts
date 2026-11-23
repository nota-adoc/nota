import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { type ParseOptions, blockSubs, parse, resolveSubs, substitute, NORMAL_SUBS, textPieces } from '@nota-adoc/core'
import { AttributeTracker, AttrsBuilder, setupAttributes } from '../src/parse/attrs.js'
import { codesOf, lossless, shapeOf, signature } from './helpers.js'

const PARTS = new Set([
  'QuoteMarker',
  'InlineAttributes',
  'PassMarker',
  'PassSubs',
  'MacroText',
  'MacroTarget',
  'MacroName',
  'AnchorId',
  'AnchorRefText',
  'AttributeName',
  'PositionalAttribute',
  'NamedAttribute',
])

/** The inline nodes and their parts, with their text, indented by depth. */
function inline(text: string, options?: ParseOptions): string[] {
  const doc = lossless(text, options)
  const out: string[] = []
  const stack: boolean[] = []
  doc.tree.iterate({
    enter(n) {
      const mine = n.type.is('Inline') || (PARTS.has(n.name) && stack.some(Boolean))
      const depth = stack.filter(Boolean).length
      if (mine) out.push(`${'  '.repeat(depth)}${n.name} ${JSON.stringify(text.slice(n.from, n.to))}`)
      stack.push(mine)
    },
    leave() {
      stack.pop()
    },
  })
  return out
}

/** Node names in order, without text, for the constructs of a line. */
const names = (text: string, options?: ParseOptions) =>
  inline(text, options).map((l) => l.trim().split(' ')[0]!)

describe('quotes', () => {
  it('reads each quote with its markers and text', () => {
    expect(inline('*a*')).toEqual(['Strong "*a*"', '  QuoteMarker "*"', '  QuoteMarker "*"'])
    expect(names('**a**b')).toEqual(['Strong', 'QuoteMarker', 'QuoteMarker'])
    expect(names('_a_')).toEqual(['Emphasis', 'QuoteMarker', 'QuoteMarker'])
    expect(names('__a__b')).toEqual(['Emphasis', 'QuoteMarker', 'QuoteMarker'])
    expect(names('`a`')).toEqual(['Monospace', 'QuoteMarker', 'QuoteMarker'])
    expect(names('``a``b')).toEqual(['Monospace', 'QuoteMarker', 'QuoteMarker'])
    expect(names('#a#')).toEqual(['Highlight', 'QuoteMarker', 'QuoteMarker'])
    expect(names('^a^')).toEqual(['Superscript', 'QuoteMarker', 'QuoteMarker'])
    expect(names('~a~')).toEqual(['Subscript', 'QuoteMarker', 'QuoteMarker'])
    expect(names('"`a`"')).toEqual(['DoubleQuoted', 'QuoteMarker', 'QuoteMarker'])
    expect(names("'`a`'")).toEqual(['SingleQuoted', 'QuoteMarker', 'QuoteMarker'])
  })

  it('reads roles and ids as attributes of the quote', () => {
    expect(inline('[.line-through]#struck#')).toEqual([
      'Highlight "[.line-through]#struck#"',
      '  InlineAttributes "[.line-through]"',
      '  QuoteMarker "#"',
      '  QuoteMarker "#"',
    ])
    expect(names('[.role]**x**')).toEqual(['Strong', 'InlineAttributes', 'QuoteMarker', 'QuoteMarker'])
  })

  it('nests quotes', () => {
    expect(inline('*_ab_*')).toEqual([
      'Strong "*_ab_*"',
      '  QuoteMarker "*"',
      '  Emphasis "_ab_"',
      '    QuoteMarker "_"',
      '    QuoteMarker "_"',
      '  QuoteMarker "*"',
    ])
  })

  it('reads a one-character marker at the edge of a word only, two-character markers anywhere', () => {
    expect(names('a*b*c')).toEqual([])
    expect(names('word*b*word')).toEqual([])
    expect(names('a**b**c')).toEqual(['Strong', 'QuoteMarker', 'QuoteMarker'])
    expect(names('a__b__c')).toEqual(['Emphasis', 'QuoteMarker', 'QuoteMarker'])
  })

  it('reads a quote across two lines as one node', () => {
    const doc = lossless('*a\nb*\n')
    expect(shapeOf('*a\nb*\n')).toBe('Paragraph(TextLine(Strong(QuoteMarker,Mark,QuoteMarker),Mark))')
    // the lines it spans are one TextLine, and it says where the text of the lines is
    let pieces: readonly number[] | undefined
    doc.tree.iterate({
      enter(n) {
        if (n.name === 'TextLine') pieces = n.tree?.prop(textPieces)
      },
    })
    expect(pieces).toEqual([0, 2, 3, 5])
  })

  it('keeps a comment line between the lines of a construct inside it', () => {
    expect(shapeOf('*a\n// c\nb*\n')).toBe(
      'Paragraph(TextLine(Strong(QuoteMarker,Mark,LineComment,Mark,QuoteMarker),Mark))',
    )
  })

  it('keeps the backslash of an escape as a leaf of its own', () => {
    expect(inline('\\*a* and \\_b_')).toEqual(['Escape "\\\\"', 'Escape "\\\\"'])
    // the escape of `**` leaves the inner `*a*` a constrained strong
    expect(names('\\**a**')).toEqual(['Escape', 'Strong', 'QuoteMarker', 'QuoteMarker'])
  })
})

describe('passthroughs', () => {
  it('reads each passthrough as a node that is not read inside', () => {
    expect(inline('+a *b*+')).toEqual(['Passthrough "+a *b*+"', '  PassMarker "+"', '  PassMarker "+"'])
    expect(names('++a++')).toEqual(['Passthrough', 'PassMarker', 'PassMarker'])
    expect(names('+++<b>x</b>+++')).toEqual(['Passthrough', 'PassMarker', 'PassMarker'])
    expect(names('$$x$$')).toEqual(['Passthrough', 'PassMarker', 'PassMarker'])
    expect(names('pass:[x]')).toEqual(['Passthrough', 'MacroName', 'PassMarker', 'PassMarker'])
  })

  it('reads what a passthrough with substitutions says to read', () => {
    expect(names('pass:q[*x*]')).toEqual(['Passthrough', 'MacroName', 'PassSubs', 'PassMarker', 'Strong', 'QuoteMarker', 'QuoteMarker', 'PassMarker'])
  })

  it('reads stem macros', () => {
    expect(names('stem:[x]')).toEqual(['Stem', 'MacroName', 'PassMarker', 'PassMarker'])
  })
})

describe('macros', () => {
  it('reads links', () => {
    expect(inline('https://example.com[site]')).toEqual([
      'Link "https://example.com[site]"',
      '  MacroTarget "https://example.com"',
      '  MacroText "site"',
    ])
    expect(names('see https://example.com now')).toEqual(['Link', 'MacroTarget'])
    expect(names('<https://example.com>')).toEqual(['Link', 'MacroTarget'])
    expect(names('link:a.html[x]')).toEqual(['Link', 'MacroName', 'MacroTarget', 'MacroText'])
    expect(names('mailto:a@b.co[x]')).toEqual(['Link', 'MacroName', 'MacroTarget', 'MacroText'])
  })

  it('reads cross references', () => {
    expect(names('xref:путь/Страница.adoc#id[текст]')).toEqual(['Xref', 'MacroName', 'MacroTarget', 'MacroText'])
    expect(names('<<id>>')).toEqual(['Xref', 'MacroTarget'])
    expect(names('<<id,text>>')).toEqual(['Xref', 'MacroTarget', 'MacroText'])
  })

  it('reads anchors, images, footnotes and the rest', () => {
    expect(names('x [[id]]')).toEqual(['InlineAnchor', 'AnchorId'])
    expect(names('anchor:id[]')).toEqual(['InlineAnchor', 'AnchorId'])
    expect(names('image:a.png[Alt,20]')).toEqual(['InlineImage', 'MacroName', 'MacroTarget', 'PositionalAttribute', 'PositionalAttribute'])
    expect(names('footnote:[text]')).toEqual(['Footnote', 'MacroName', 'MacroText'])
    expect(names('footnote:id[text]')).toEqual(['Footnote', 'MacroName', 'MacroTarget', 'MacroText'])
    expect(names('indexterm:[a]')).toEqual(['IndexTerm', 'MacroName', 'MacroText'])
    expect(names('((a))')).toEqual(['IndexTerm', 'MacroText'])
  })

  it('reads kbd, btn and menu with :experimental: only', () => {
    expect(names('kbd:[Ctrl+S]')).toEqual([])
    expect(names(':experimental:\n\nkbd:[Ctrl+S] btn:[OK] menu:File[Save]')).toEqual([
      'Kbd', 'MacroName', 'MacroText', 'Button', 'MacroName', 'MacroText', 'Menu', 'MacroName', 'MacroTarget', 'MacroText',
    ])
  })

  it('reads a name:target[text] macro that nothing knows as text', () => {
    expect(names('name:target[text]')).toEqual([])
  })
})

describe('other constructs', () => {
  it('reads references to attributes, replacements, breaks and callouts', () => {
    expect(inline('{name}')).toEqual(['AttributeReference "{name}"', '  AttributeName "name"'])
    expect(names('(C) (R) (TM) -- ... -> => <- <= it\'s')).toEqual(Array(10).fill('Replacement'))
    expect(inline('a +\nb')).toEqual(['HardBreak " +"'])
    expect(names('----\nint a; // <1>\n----\n')).toEqual(['Callout'])
  })

  it('makes a node of each special character', () => {
    expect(inline('a & b < c > d')).toEqual(['SpecialChar "&"', 'SpecialChar "<"', 'SpecialChar ">"'])
    expect(inline('*a < b*')).toEqual(['Strong "*a < b*"', '  QuoteMarker "*"', '  SpecialChar "<"', '  QuoteMarker "*"'])
    expect(inline('https://e.co/?a=1&b=2[t]').map((l) => l.trim().split(' ')[0])).toEqual([
      'Link',
      'MacroTarget',
      'SpecialChar',
      'MacroText',
    ])
    // in a listing the special characters are all the substitutions there are
    expect(names('----\nif (a < b && c)\n----\n')).toEqual(['SpecialChar', 'SpecialChar', 'SpecialChar'])
  })

  it('leaves out the special characters a construct is written with', () => {
    expect(names('----\nint a; // <1>\n----\n')).toEqual(['Callout'])
    expect(names('a -> b => c <- d <= e')).toEqual(['Replacement', 'Replacement', 'Replacement', 'Replacement'])
    expect(names('<<id>>')).toEqual(['Xref', 'MacroTarget'])
    expect(names('<<id,a & b>>')).toEqual(['Xref', 'MacroTarget', 'MacroText', 'SpecialChar'])
  })
})

describe('substitutions of a block', () => {
  it('reads listings and literal blocks for callouts only', () => {
    expect(names('----\nint a = *b*; // <1>\n----\n')).toEqual(['Callout'])
    expect(names('....\n*b* <1>\n....\n')).toEqual(['Callout'])
    expect(names('[source]\n----\n*b* {x}\n----\n')).toEqual([])
    expect(names('```\n*b*\n```\n')).toEqual([])
    expect(names('[listing]\n*b* <1>\n')).toEqual(['Callout'])
    expect(names(' literal *b*\n')).toEqual([])
  })

  it('reads a verse and the text of quotes and admonitions normally', () => {
    expect(names('[verse]\n____\n*b*\n____\n')).toEqual(['Strong', 'QuoteMarker', 'QuoteMarker'])
    expect(names('NOTE: *b*')).toEqual(['Strong', 'QuoteMarker', 'QuoteMarker'])
    expect(names('[quote]\n*b*')).toEqual(['Strong', 'QuoteMarker', 'QuoteMarker'])
  })

  it('reads nothing in ++++, [pass] and comments', () => {
    expect(names('++++\n*b*\n++++\n')).toEqual([])
    expect(names('[pass]\n*b*')).toEqual([])
    expect(names('////\n*b*\n////\n')).toEqual([])
    expect(names('// *b*\n')).toEqual([])
  })

  it('reads titles, list items and terms', () => {
    expect(names('== A *b* title')).toEqual(['Strong', 'QuoteMarker', 'QuoteMarker'])
    expect(names('.A *b* title\ntext')).toEqual(['Strong', 'QuoteMarker', 'QuoteMarker'])
    expect(names('* item *b*')).toEqual(['Strong', 'QuoteMarker', 'QuoteMarker'])
    expect(names('term *b*:: text')).toEqual(['Strong', 'QuoteMarker', 'QuoteMarker'])
    expect(names('* *a\n  b*')).toEqual(['Strong', 'QuoteMarker', 'QuoteMarker'])
  })

  it('changes the set with subs=', () => {
    expect(names('[subs=+quotes]\n----\n*b* <1>\n----\n')).toEqual(['Strong', 'QuoteMarker', 'QuoteMarker', 'Callout'])
    expect(names('[subs="attributes,macros"]\n----\n{a} https://e.c\n----\n')).toEqual(['AttributeReference', 'AttributeName', 'Link', 'MacroTarget'])
    expect(names('[subs=-replacements]\n(C) *b*')).toEqual(['Strong', 'QuoteMarker', 'QuoteMarker'])
    expect(names('[subs=none]\n*b* (C)')).toEqual([])
    expect(names('[subs=verbatim]\n*b* <1>')).toEqual(['Callout'])
  })

  it('resolves subs values the way Asciidoctor does', () => {
    expect(resolveSubs('none', 'block', null)).toEqual([])
    expect(resolveSubs('verbatim', 'block', null)).toEqual(['specialcharacters', 'callouts'])
    expect(resolveSubs('q,a', 'inline', null)).toEqual(['quotes', 'attributes'])
    expect(resolveSubs('+quotes', 'block', ['specialcharacters'])).toEqual(['specialcharacters', 'quotes'])
    expect(resolveSubs('-replacements', 'block', NORMAL_SUBS)).toEqual(['specialcharacters', 'quotes', 'attributes', 'macros', 'post_replacements'])
    expect(resolveSubs('quotes+', 'block', ['specialcharacters'])).toEqual(['quotes', 'specialcharacters'])
    expect(resolveSubs('bogus', 'block', null)).toEqual([])
    expect(blockSubs(NORMAL_SUBS, undefined)).toBe(NORMAL_SUBS)
  })

  it('reads kbd only after :experimental:, and again after it is unset', () => {
    expect(names('kbd:[a]')).toEqual([])
    expect(names(':experimental:\n\nkbd:[a]\n\n:experimental!:\n\nkbd:[b]')).toEqual(['Kbd', 'MacroName', 'MacroText'])
  })

  it('reads the old quotes after :compat-mode:', () => {
    expect(names("'a'")).toEqual([])
    expect(names(":compat-mode:\n\n'a' and +b+")).toEqual(['Emphasis', 'QuoteMarker', 'QuoteMarker', 'Monospace', 'QuoteMarker', 'QuoteMarker'])
    expect(names('`a`\n\n:compat-mode:\n\n`a`')).toEqual(['Monospace', 'QuoteMarker', 'QuoteMarker', 'Passthrough', 'PassMarker', 'PassMarker'])
  })

  it('has the entry above change the tree below, and an update agrees with a full parse', () => {
    const text = 'One kbd:[a]\n\n:experimental:\n\nTwo kbd:[a]\n'
    const doc = parse(text)
    const edited = doc.update([{ from: text.indexOf(':experimental:'), to: text.indexOf(':experimental:') + ':experimental:'.length, insert: ':other:' }])
    expect(signature(edited.tree)).toBe(signature(parse(edited.text).tree))
    expect(names(edited.text)).toEqual([])
    const back = edited.update([{ from: edited.text.indexOf(':other:'), to: edited.text.indexOf(':other:') + 7, insert: ':experimental:' }])
    expect(signature(back.tree)).toBe(signature(doc.tree))
  })
})

describe('references to attributes', () => {
  it('reads a defined and an undefined reference alike, and tells about the undefined one', () => {
    const text = ':a: значение\n\n{a} и {нет}\n'
    expect(names(text)).toEqual(['AttributeReference', 'AttributeName', 'AttributeReference', 'AttributeName'])
    expect(codesOf(text)).toEqual(['undefined-attribute'])
    const d = parse(text).diagnostics[0]!
    expect(d).toMatchObject({ severity: 'info', from: text.indexOf('{нет}'), to: text.indexOf('{нет}') + 5 })
  })

  it('reads {set:}, {counter:} and the built-in references', () => {
    expect(names('{set:x:y} {counter:n} {counter2:n} {nbsp} {empty} {zwsp} {startsb}')).toEqual(Array(7).fill(['AttributeReference', 'AttributeName']).flat())
    expect(codesOf('{set:x:y} {counter:n} {nbsp}')).toEqual([])
  })

  it('has {set:} and {counter:} define the attribute for the references after them', () => {
    expect(codesOf('{set:a:b}{a}')).toEqual([])
    expect(codesOf('{set:flag:on}Flag is {flag}.')).toEqual([])
    expect(codesOf('{counter:n} and {n}')).toEqual([])
    expect(codesOf('{counter:n}\n\n{n}')).toEqual([])
    expect(codesOf('{counter2:n}\n\n{n}')).toEqual([])
    // unset by {set:a!}
    expect(codesOf(':a: x\n\n{set:a!}{a}')).toEqual(['undefined-attribute'])
  })

  it('has {set:} change the constructs of the text after it', () => {
    expect(names('{set:experimental:}\n\nkbd:[x]')).toEqual(['AttributeReference', 'AttributeName', 'Kbd', 'MacroName', 'MacroText'])
    expect(names('{set:u:https://example.com}{u}[t]')).toContain('Link')
    // a counter gives the same value however often the text is read
    const d = parse('{counter:n}\n\n{counter:n}\n\n:m: {n}\n\n{n}{m}\n')
    expect(d.diagnostics.map((x) => x.code)).toEqual([])
  })

  it('has an update agree with a full parse when a {set:} changes', () => {
    const text = '{set:experimental:}\n\nkbd:[a]\n'
    const doc = parse(text)
    const edited = doc.update([{ from: 0, to: '{set:experimental:}'.length, insert: '{set:other:}' }])
    expect(signature(edited.tree)).toBe(signature(parse(edited.text).tree))
    expect(names(edited.text)).not.toContain('Kbd')
    const back = edited.update([{ from: 0, to: '{set:other:}'.length, insert: '{set:experimental:}' }])
    expect(signature(back.tree)).toBe(signature(doc.tree))
    expect(names(back.text)).toContain('Kbd')
  })

  it('takes the attributes of the options into account', () => {
    expect(codesOf('{given}', { attributes: { given: 'x' } })).toEqual([])
    expect(codesOf('{given}')).toEqual(['undefined-attribute'])
  })

  it('reads a construct that grows from a reference over the source it grew from', () => {
    expect(inline(':u: https://example.com\n\n{u}[text]')).toEqual([
      'Link "{u}[text]"',
      '  MacroTarget "{u}"',
      '    AttributeReference "{u}"',
      '      AttributeName "u"',
      '  MacroText "text"',
    ])
  })
})

describe('the HTML of the substitutions', () => {
  const html = (text: string, attrs: Record<string, string> = {}) =>
    substitute(text, null, NORMAL_SUBS, { get: (n) => attrs[n] })

  it('follows Asciidoctor', () => {
    expect(html('*a* _b_ `c`')).toBe('<strong>a</strong> <em>b</em> <code>c</code>')
    expect(html('a & b < c')).toBe('a &amp; b &lt; c')
    expect(html('(C) -- ...')).toBe('&#169;&#8201;&#8212;&#8201;&#8230;&#8203;')
    expect(html('{a}', { a: 'x' })).toBe('x')
    expect(html('https://e.co[t]')).toBe('<a href="https://e.co">t</a>')
    expect(html('+*x*+')).toBe('*x*')
  })
})

describe('counters in the text', () => {
  it('counts each counter once, however the text is read', () => {
    const text = '{counter:n}\n\n* {counter:n}\n\n.T {counter:n}\n----\nx\n----\n\n[subs=attributes]\n----\n{counter:n}\n----\n\n{n}'
    const a = parse(text)
    const b = parse(text)
    expect(signature(a.tree)).toBe(signature(b.tree))
    expect(a.diagnostics).toEqual([])
    const edited = a.update([{ from: text.length, to: text.length, insert: ' {n}' }])
    expect(signature(edited.tree)).toBe(signature(parse(edited.text).tree))
  })
})

describe('a counter that starts from nothing', () => {
  it('counts on from an empty seed of a name the document cannot change', () => {
    expect(() => parse('{counter:icons:}{counter:icons}').asg()).not.toThrow()
  })
})

describe('{set:} and {counter:} outside a paragraph', () => {
  it('reads the text of a list item with what its own {set:} and {counter:} define', () => {
    expect(codesOf('* {set:a:b}{a}')).toEqual([])
    expect(codesOf('* {counter:n} {n}')).toEqual([])
    expect(codesOf('. {set:a:b}{a}')).toEqual([])
    expect(names('* {set:u:https://example.com}{u}[t]')).toContain('Link')
    expect(names('* {set:experimental:}kbd:[x]')).toContain('Kbd')
  })

  it('reads the text of an item before the blocks in it', () => {
    expect(codesOf('* {set:a:b} x\n+\n{a}')).toEqual([])
    expect(codesOf('* {counter:n} x\n+\n{n}')).toEqual([])
    expect(codesOf('* x\n+\n{set:a:b}{a}\n\n{a}')).toEqual([])
    expect(names('* {set:experimental:} x\n+\nkbd:[y]')).toContain('Kbd')
    expect(names('* {set:experimental:} x\n\nkbd:[y]')).toContain('Kbd')
  })

  it('reads the text of an item continued on its next lines with the {set:} of the first', () => {
    expect(codesOf('* {set:a:b} x\n{a}')).toEqual([])
  })

  it('gives the text of an item the attributes as they are when the item starts', () => {
    // what a block in the item sets comes after the text of the item
    expect(codesOf('* {a}\n+\n:a: b\n\nx')).toEqual(['undefined-attribute'])
    // :hardbreaks: in a block of the item leaves the text of the item alone
    const hb = '* a\nb\n+\n:hardbreaks:\nc\nd'
    expect(names(hb)).toEqual(names('* a\nb\n+\nc\nd'))
  })

  it('leaves what the text of an item sets to the items and blocks after it', () => {
    expect(codesOf('* {set:a:b}x\n* {a}\n\n{a}')).toEqual([])
    expect(names('* {set:experimental:}x\n\nkbd:[y]')).toContain('Kbd')
    expect(codesOf('* {set:a:b}x\n* {set:a!}y\n\n{a}')).toEqual(['undefined-attribute'])
    expect(codesOf('* {counter:n}\n* {counter:n}\n\n{n}')).toEqual([])
  })

  it('has an update agree with a full parse when the {set:} in an item changes', () => {
    const text = '* {set:experimental:} x\n+\nkbd:[a]\n\nkbd:[b]\n'
    const doc = parse(text)
    const edited = doc.update([{ from: 2, to: 2 + '{set:experimental:}'.length, insert: '{set:other:}' }])
    expect(signature(edited.tree)).toBe(signature(parse(edited.text).tree))
    expect(names(edited.text)).not.toContain('Kbd')
    const back = edited.update([{ from: 2, to: 2 + '{set:other:}'.length, insert: '{set:experimental:}' }])
    expect(signature(back.tree)).toBe(signature(doc.tree))
    expect(names(back.text)).toContain('Kbd')
  })

  it('reads the term and the text of a description list with what they define', () => {
    expect(codesOf('{set:a:b}term:: {a}')).toEqual([])
    expect(codesOf('term {set:a:b}:: {a}')).toEqual([])
    expect(codesOf('term {set:a:b}:: x\n+\n{a}')).toEqual([])
    expect(codesOf('term {set:a:b}::\n{a}')).toEqual([])
    expect(codesOf('t1 {set:a:b}::\nt2 {a}::\nx {a}')).toEqual([])
    expect(codesOf('t:: {set:a:b}x\n+\n{a}\n\nu:: {a}')).toEqual([])
    expect(names('t:: {set:experimental:}x\nu:: kbd:[y]')).toContain('Kbd')
    expect(names('t {set:experimental:}:: x\nu:: kbd:[y]')).toContain('Kbd')
  })

  it('reads a nested list item with what the parent item defines', () => {
    expect(codesOf('* {set:a:b}x\n** {a}')).toEqual([])
    expect(codesOf('* {set:a:b}x\n+\n** {a}')).toEqual([])
    expect(codesOf('* x\n** {set:a:b}y\n* {a}')).toEqual([])
  })

  it('reads the titles of blocks and sections in the order of the document', () => {
    expect(codesOf('.T {set:a:b}\n{a}')).toEqual([])
    expect(codesOf('.T {set:a:b}\n----\n{a}\n----')).toEqual([])
    expect(codesOf('.T {counter:n}\n{n}')).toEqual([])
    expect(codesOf('== S {set:a:b}\n\n{a}')).toEqual([])
    expect(codesOf('= D {set:a:b}\n\n{a}')).toEqual([])
    expect(codesOf('[discrete]\n== S {set:a:b}\n\n{a}')).toEqual([])
    expect(codesOf('S {set:a:b}\n-----------\n\n{a}')).toEqual([])
    expect(names('== S {set:experimental:}\n\nkbd:[x]')).toContain('Kbd')
    expect(names('.T {set:experimental:}\nkbd:[x]')).toContain('Kbd')
  })

  it('reads the title of a block after the attribute entries between the title and the block', () => {
    expect(codesOf('.T {a}\n:a: b\nx')).toEqual([])
    expect(codesOf('.T {a}\n:a: b\n----\nx\n----')).toEqual([])
    expect(names('.T {u}[t]\n:u: https://example.com\nx')).toContain('Link')
    // only the last title is the title of the block: what the others set is not done
    expect(codesOf('.T {set:a:b}\n.U\nx\n\n{a}')).toEqual(['undefined-attribute'])
    expect(codesOf('.T\n.U {set:a:b}\nx\n\n{a}')).toEqual([])
  })

  it('reads the quote, verse and pass blocks and the like with what came before', () => {
    expect(codesOf('{set:a:b}\n\n[verse]\n____\n{a}\n____')).toEqual([])
    expect(codesOf('[subs=attributes]\n----\n{set:a:b}{a}\n----\n\n{a}')).toEqual([])
    // in a list of attributes {set:} is done while the document is read, and undone before it is converted
    expect(codesOf('[quote, Author {set:a:b}]\nx\n\n{a}')).toEqual(['undefined-attribute'])
  })

  it('reads the text of an item that a nested block follows on the next line', () => {
    // the nested list comes before the rest of the text could be known
    expect(codesOf('* {set:a:b} x\n** {a}')).toEqual([])
    expect(codesOf('* {counter:n} x\n** {n}')).toEqual([])
    expect(names('* {set:experimental:} x\n** kbd:[y]')).toContain('Kbd')
    expect(codesOf('* {set:a:b} x\n----\n{a}\n----')).toEqual([])
    // what the lines folded into the text do to it wins over the first line
    expect(codesOf('* {set:a:b} x\n{set:a!}\n\n{a}')).toEqual(['undefined-attribute'])
    expect(codesOf('* {set:a:b} x\n{set:c:d}{c}\n\n{a}{c}')).toEqual([])
    expect(codesOf('t:: {set:a:b} x\n** {a}')).toEqual([])
  })
})

describe('the attributes of a text read ahead of its place', () => {
  const base = () => {
    const setup = setupAttributes({ n: '5' })
    const st = { doctype: 'article', leveloffset: 0 }
    return { setup, tracker: new AttributeTracker(new AttrsBuilder(setup.initial), setup.locked, st) }
  }

  it('keeps what it changes to itself until it is adopted', () => {
    const { setup, tracker } = base()
    const fork = tracker.fork(setup.initial)
    fork.hooks.set('a', 'b')
    expect(fork.get('a')).toBe('b')
    expect(tracker.get('a')).toBeUndefined()
    expect(tracker.adopt(fork, setup.initial)).toEqual(['a'])
    expect(tracker.get('a')).toBe('b')
    const unset = tracker.fork(tracker.ab.freeze())
    unset.hooks.set('a', null)
    tracker.adopt(unset, tracker.ab.freeze())
    expect(tracker.get('a')).toBeUndefined()
  })

  it('counts a counter of the document once, a trial run counts none', () => {
    const { setup, tracker } = base()
    // `n` is locked: its counter lives in the tracker
    const trial = tracker.fork(setup.initial, true)
    expect(trial.hooks.counter('n', undefined)).toBe('6')
    expect(trial.hooks.counter('n', undefined)).toBe('7')
    const real = tracker.fork(setup.initial)
    expect(real.hooks.counter('n', undefined)).toBe('6')
    expect(tracker.fork(setup.initial).hooks.counter('n', undefined)).toBe('7')
  })

  it('takes the names of a trial run over from the fork that follows it', () => {
    const { setup, tracker } = base()
    const trial = tracker.fork(setup.initial, true)
    trial.hooks.set('x', '1')
    const early = tracker.adopt(trial, setup.initial)
    expect(early).toEqual(['x'])
    const after = tracker.ab.freeze()
    const real = tracker.fork(setup.initial)
    real.hooks.set('x', '1')
    real.hooks.set('x', null)
    tracker.adopt(real, setup.initial, early)
    expect(tracker.get('x')).toBeUndefined()
    expect(after.get('x')).toBe('1')
  })
})

describe('the fixture of {set:} outside a paragraph', () => {
  it('has no reference undefined but the one the overwritten title leaves', () => {
    const text = readFileSync(new URL('../../../quality/fixtures/stage4/attributes-refs.adoc', import.meta.url), 'utf8')
    const from = text.indexOf('== Attributes set outside a paragraph')
    expect(from).toBeGreaterThan(0)
    const missing = parse(text)
      .diagnostics.filter((d) => d.code === 'undefined-attribute' && d.from > from)
      .map((d) => text.slice(d.from, d.to))
    expect(missing).toEqual(['{title-c}'])
  })
})

describe('mailto: with a subject that is not well-formed UTF-16', () => {
  it('does not throw: a lone surrogate in the subject or the body is written as U+FFFD', () => {
    const text = 'write mailto:a@b.c[Text,Subj\ud800ect,Bo\udc00dy] now\n'
    const doc = parse(text)
    expect(doc.text).toBe(text)
    expect(doc.tree.length).toBe(text.length)
  })
})
