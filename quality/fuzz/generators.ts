import fc from 'fast-check'

/** Characters that break naive line and text handling (see quality/fixtures/edge). */
export const specialChars = [
  '﻿', // byte order mark
  '\r',
  '\r\n',
  '\n',
  '\t',
  ' ', // no-break space
  '​', // zero-width space
  '‍', // zero-width joiner
  ' ', // line separator
  '\u0000',
  '\uD800', // lone high surrogate
  '\uDFFF', // lone low surrogate
  '\uD83D', // high surrogate of an emoji, alone
  '😀',
  ' ',
]

export const markupChars = [
  '=',
  '#',
  '[',
  ']',
  ':',
  '/',
  '.',
  '-',
  '*',
  '+',
  '`',
  '|',
  '!',
  ',',
  '_',
  '~',
  '^',
  '<',
  '>',
  '"',
  "'",
  '\\',
  '{',
  '}',
  '%',
  ';',
  '@',
]

/** Random Unicode and junk, including the characters of the edge fixtures. */
export const junkText: fc.Arbitrary<string> = fc
  .array(
    fc.oneof(
      { weight: 3, arbitrary: fc.constantFrom(...specialChars) },
      { weight: 3, arbitrary: fc.constantFrom(...markupChars) },
      { weight: 2, arbitrary: fc.string({ unit: 'binary', maxLength: 4 }) },
      { weight: 2, arbitrary: fc.string({ unit: 'grapheme-ascii', maxLength: 6 }) },
    ),
    { maxLength: 200, size: 'max' },
  )
  .map((parts) => parts.join(''))

/** Lines built from the constructs of stage 1 and of later stages that stage 1 must delimit. */
export const lineTemplates = [
  '= Document Title',
  '== Section',
  '=== Subsection',
  '==== Level three',
  '===== Level four',
  '====== Level five',
  '======= Seven is text',
  '# Markdown title',
  '## Markdown section',
  '== Symmetric ==',
  '==Text',
  'Setext title',
  '============',
  '------------',
  '~~~~~~~~~~~~',
  '^^^^^^^^^^^^',
  '++++++++++++',
  '[discrete]',
  '[float]',
  '[appendix]',
  '[[anchor-id]]',
  '[[anchor-id,Reference text]]',
  '[#id.role%option]',
  '[#anchor-id]',
  '[id=anchor-id]',
  '[see below]',
  ':toc:',
  ':toc-placement: auto',
  ':source-highlighter: rouge',
  ':sectnums:',
  ':toclevels: 1',
  ':idprefix: sec-',
  ':idprefix: Sec',
  ':idseparator: X',
  ':idseparator: -',
  'see <<anchor-id>> <<_section>> <<gone>> xref:gone[] xref:other.adoc#x[y] xref:other.adoc[]',
  '<<Title Words>> <<Some Text>> <<Section>> <<Foo>>',
  'Text [[Foo,Some Text]] and anchor:Foo[Bar] here',
  'Text +[[Foo]]+ +++[[Foo]]+++ pass:[[[Foo]]]',
  ' [[Foo,Some Text]]',
  '* [[[bib]]] item',
  '* [[Foo]]text',
  '[[Foo]]Term::',
  'a|[[Foo,Some Text]]cell',
  '.Title Words',
  '[#Foo,reftext=Some Text]',
  '.Fig. {counter:n}',
  'Count {counter:n}',
  'include::part.adoc[]',
  'include::part.adoc[leveloffset=+1]',
  'include::other.adoc[]',
  '[source,json]',
  '[NOTE]',
  '[quote, Someone, Somewhere]',
  '[literal]',
  '[verse]',
  '[sidebar]',
  '[example]',
  '[pass]',
  '[comment]',
  '[normal]',
  '[x,y=z,"quoted, value",options="a,b"]',
  '[]',
  '.Block title',
  '..not a title',
  ':name: value',
  ':empty:',
  ':name!:',
  ':!name:',
  ':doctype: book',
  ':doctype: article',
  ':leveloffset: +1',
  ':leveloffset: -1',
  ':leveloffset: 2',
  ':leveloffset!:',
  ':multi: first \\',
  '  second \\',
  '  third',
  ':legacy: one +',
  'Author Name <author@example.com>; Second Author',
  'v1.0, 2026-09-25: A remark',
  '// line comment',
  '////',
  '/////',
  '///',
  '----',
  '------',
  '....',
  '====',
  '****',
  '____',
  '--',
  '++++',
  '|===',
  '!===',
  ',===',
  ':===',
  '```',
  '```ruby',
  'NOTE: A note paragraph.',
  'TIP: A tip.',
  'WARNING: careful',
  ' literal line',
  '\tliteral with a tab',
  'Plain paragraph text with words.',
  'Another line of text',
  '* list item',
  '** nested list item',
  '*** deeper list item',
  '**** deeper still',
  '***** deepest',
  '- hyphen item',
  '. ordered item',
  '.. nested ordered item',
  '... third level ordered',
  '1. numbered item',
  '2. second numbered item',
  '3. skipped a number',
  'a. letter item',
  'B. upper letter item',
  'i) roman item',
  'IV) upper roman item',
  '* [x] checked item',
  '* [ ] open item',
  '* [*] starred item',
  'term:: definition',
  'term::',
  'other term;; semicolon definition',
  'deep term::: three colons',
  'deeper term:::: four colons',
  '<1> callout item',
  '<.> automatic callout',
  '+',
  ' +',
  '  indented literal text',
  'image::file.png[]',
  'image::file.png[Alt text,200,100]',
  'video::id[youtube]',
  'audio::sound.mp3[]',
  'toc::[]',
  'foo::bar[]',
  "'''",
  '<<<',
  '---',
  '- - -',
  '***',
  '* * *',
  '> a quote',
  '> > nested quote',
  '> -- Someone',
  '>',
  'ifdef::attr[]',
  'ifdef::attr,other[]',
  'ifdef::attr+other[]',
  'ifndef::attr[]',
  'ifdef::attr[one line of text]',
  'ifeval::[{number} > 2]',
  'ifeval::["{text}" == "x"]',
  'endif::[]',
  'endif::attr[]',
  '\\ifdef::attr[]',
  'include::other.adoc[]',
  'include::part.adoc[leveloffset=+1]',
  ':attr:',
  ':other:',
  ':attr!:',
  ':number: 3',
  ':text: x',
  // inline markup: every marker of the quotes, unclosed and nested, passthroughs, references, macros, escapes
  '*strong* and _emphasis_ and `mono` and #mark# and ^sup^ and ~sub~',
  '**un**constrained __un__constrained ``un``constrained ##un##constrained',
  '*_nested_* `*mono strong*` [.role]#styled# [#id.role]**x** [x-]+old+',
  '[.hl-mint]#colour# [.hl-mint.hl-tall]##un##constrained *x [.hl-mint]#y# z* [.hl-mint]##до##*[.hl-mint]##в##п*',
  '|===\n|a [.hl-mint]#b# \\| c\n|d [.hl-plum]*e*\n|===',
  // pass:q[…] and a visible ((…)) inside coloured pieces, colour inside pass:q[…] (it closes its attributes with `\]`)
  '[.hl-mint]#до pass:q[*жир* и _кур_] после# и [.hl-mint]#до ((термин)) после#',
  'pass:q[[.hl-mint\\]#красное#] и [.zz-a]#pass:q[x]# и ((слово)) pass:q[_a_]((b))',
  '== Раздел [.hl-mint]#((термин))# https://e.example[[.hl-mint]#pass:q[раз]#] [.hl-plum]##pass:q[x] ((y))##',
  'unclosed *strong and _emphasis and `mono and #mark and ^sup and ~sub',
  'a*b*c a_b_c a**b**c \\*escaped* \\[.r]#x# * _ ` # ^ ~ ** __ ``',
  "\"`double`\" and '`single`' and `\"`x`\"` and ``x'' and `x'",
  '+literal *x*+ ++x++ +++<b>raw</b>+++ $$dollar$$ pass:[<b>x</b>] pass:q[*x*] \\+x+',
  'pass:[unclosed and +++raw and $$x and ++y and +z and stem:[a',
  'stem:[x^2] latexmath:[\\sqrt{4}] asciimath:[a != b] stem:c[<x>]',
  '{name} {attr} {missing} {counter:n} {counter2:m} {set:s:1} {set:s!} {set:leveloffset:1} {set:leveloffset:+1} {set:leveloffset!} \\{escaped} {nbsp} {empty}',
  '{ } {} {a b} {counter:} {set:} {{name}} {name',
  '{set:experimental:}kbd:[x] {set:experimental!}kbd:[y] {set:hardbreaks:}a {set:u:https://e.co}{u}[t]',
  "(C) (R) (TM) -- ... -> => <- <= it's foo--bar &copy; &amp; & < >",
  'line with a break +',
  'https://example.com[Example] https://example.com <https://example.com> link:page.html[x] mailto:a@b.c[m] a@b.c',
  'xref:doc.adoc#id[text] <<id>> <<id,text>> [[inline-anchor]] [[a,b]] anchor:x[y] xref:x[',
  'image:a.png[Alt,20] icon:heart[2x] footnote:[note] footnote:id[note] footnote:id[] footnoteref:x[y]',
  'kbd:[Ctrl+S] btn:[OK] menu:File[Save] "File > Save" indexterm:[a,b] ((term)) (((hidden)))',
  'name:target[text] name:[] [[[bib]]] <1> // <2> #<3> --<.>',
  '[[[unclosed [[ ((( <<< {{{ +++ ]]] ))) >>> }}} pass: stem: kbd: menu: link: image: xref: footnote:',
  ':experimental:',
  ':experimental!:',
  ':compat-mode:',
  ':compat-mode!:',
  ':hardbreaks:',
  ':hardbreaks!:',
  ':stem: latexmath',
  ':a: *value* with {b}',
  ':b: https://example.com[x]',
  '[subs=+quotes]',
  '[subs="attributes,macros"]',
  '[subs=-replacements]',
  '[subs=none]',
  '[subs=verbatim]',
  '[subs=normal,post_replacements]',
  '[%hardbreaks]',
  '[.role]',
  '[quote,{a},"b *c*"]',
  'int a = *b*; // <1>',
  // tables
  '[cols="1,2"]',
  '[cols="2*,<.^3a,~"]',
  '[cols="1000*"]',
  '[%header,cols=3*]',
  '[%noheader%footer]',
  '[options="header,footer,autowidth"]',
  '[frame=ends,grid=rows,stripes=even,width=50%]',
  '[format=csv]',
  '[format=tsv]',
  '[format=dsv,separator=;]',
  '[separator=¦]',
  '|a |b',
  '|a\\|b |c',
  '2+|wide',
  '.2+^.>s|tall |x',
  '3*|repeat',
  '2.3+|both',
  'a|* item',
  'a|!===',
  'a!nested !cell',
  'l|literal |m|mono |e|emph |h|head |v|verse |d|default',
  '| |',
  '|',
  '"a,b",c',
  '"say ""hi""",d',
  '"unclosed,quote',
  'a:b\\:c',
  '|====',
  '',
  '',
  '',
]

const line = fc.oneof(
  { weight: 8, arbitrary: fc.constantFrom(...lineTemplates) },
  { weight: 1, arbitrary: fc.string({ unit: 'grapheme', maxLength: 20 }) },
)

export const corruption = fc.record({
  at: fc.double({ min: 0, max: 1, noNaN: true }),
  del: fc.nat({ max: 3 }),
  insert: fc.oneof(
    fc.constantFrom(...specialChars, ...markupChars, ''),
    fc.string({ unit: 'binary', maxLength: 2 }),
  ),
})

export function corrupt(text: string, c: { at: number; del: number; insert: string }): string {
  const at = Math.floor(c.at * text.length)
  return text.slice(0, at) + c.insert + text.slice(Math.min(text.length, at + c.del))
}

/** AsciiDoc-like documents from stage 1 constructs, with random damage. */
export const asciidocText: fc.Arbitrary<string> = fc
  .record({
    lines: fc.array(line, { minLength: 0, maxLength: 60, size: 'max' }),
    crlf: fc.boolean(),
    finalNewline: fc.boolean(),
    bom: fc.boolean(),
    damage: fc.array(corruption, { maxLength: 3, size: 'max' }),
  })
  .map(({ lines, crlf, finalNewline, bom, damage }) => {
    let text =
      (bom ? '﻿' : '') + lines.join(crlf ? '\r\n' : '\n') + (finalNewline && lines.length ? '\n' : '')
    for (const d of damage) text = corrupt(text, d)
    return text
  })

/** Substrings where edits are most likely to change how the rest of the document parses. */
export const hotSpots = [
  '\n',
  'ifdef',
  'endif',
  '* ',
  '. ',
  '::',
  '> ',
  ':attr:',
  '=',
  '#',
  '----',
  '////',
  '//',
  ':leveloffset:',
  ':doctype:',
  '[',
  '.',
  ':',
  '\\',
  '+',
  '```',
  '|===',
  '\r',
]

export interface EditSpec {
  /** Where: a fraction of the text, or the n-th occurrence of a hot spot. */
  at: number
  spot: number | null
  del: number
  insert: string
}

export const editSpec: fc.Arbitrary<EditSpec> = fc.record({
  at: fc.double({ min: 0, max: 1, noNaN: true }),
  spot: fc.option(fc.nat({ max: hotSpots.length * 8 - 1 }), { freq: 2 }),
  del: fc.oneof(fc.constant(0), fc.nat({ max: 3 }), fc.nat({ max: 12 })),
  insert: fc.oneof(
    fc.constant(''),
    fc.constantFrom(...specialChars, ...markupChars),
    fc.constantFrom(...lineTemplates).map((l) => l + '\n'),
    fc.constantFrom(...lineTemplates),
    fc.string({ unit: 'grapheme', maxLength: 5 }),
  ),
})

/** Resolves an edit spec against a text into a concrete position. */
export function resolveEdit(text: string, e: EditSpec): { from: number; to: number; insert: string } {
  let from = Math.floor(e.at * (text.length + 1))
  if (e.spot !== null) {
    const needle = hotSpots[e.spot % hotSpots.length]!
    const nth = Math.floor(e.spot / hotSpots.length)
    let idx = -1
    for (let k = 0; k <= nth; k++) {
      const next = text.indexOf(needle, idx + 1)
      if (next < 0) break
      idx = next
    }
    if (idx >= 0) from = idx
  }
  from = Math.min(from, text.length)
  const to = Math.min(text.length, from + e.del)
  return { from, to, insert: e.insert }
}
