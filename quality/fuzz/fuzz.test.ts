import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { applyOperation, parse } from '@nota-adoc/core'
import { layoutItems, readLayout, tableViewAt } from '@nota-adoc/core/internal'
import { fixtureTexts, islandReadsAs, runActions } from './editor.js'
import { CODES, GLOBAL_LINE, checkOperation, stats, toOperation, type OperationInput } from './operations.js'
import { propertyNames, runProperty, runPropertyYielding } from './properties.js'

const seed = Number(process.env.NOTA_FUZZ_SEED ?? Date.now() % 2_147_483_647)

describe('fuzz (short run)', () => {
  for (const name of propertyNames) {
    // a run of the visual editor is a whole chain of actions, on a DOM: fewer of them in the short run
    const runs = name === 'editor/actions' ? 400 : 1000
    // one fc.check that gives the event loop a turn every half second: see runPropertyYielding
    it(`${name}: ${runs} cases hold (seed ${seed})`, async () => {
      const r = await runPropertyYielding(name, { runs, seed })
      expect(r.failure, r.report).toBeNull()
      expect(r.runs).toBeGreaterThanOrEqual(runs)
      // the cases are a fixed number: on a busy machine they take longer, so the limit of time is wide
    }, 600_000)
  }

  it('reports seed and a shrunk counterexample when a property fails', () => {
    // a parser that loses a character whenever the text contains "=="
    const broken = (text: string) => {
      const doc = parse(text)
      return text.includes('==') ? { text, tree: parse(text.replace('==', '=')).tree } : doc
    }
    const r = runProperty('identity/asciidoc', { runs: 1000, seed: 42, parseFn: broken })
    expect(r.failure).not.toBeNull()
    expect(r.report).toContain('seed 42')
    expect(r.report).toMatch(/counterexample/)
    const again = runProperty('identity/asciidoc', { runs: 1000, seed: 42, parseFn: broken })
    expect(again.report).toBe(r.report)
  })

  it('yielding run: the same cases and the same report as the plain run, a failure keeps the seed', async () => {
    const plain = runProperty('identity/random', { runs: 250, seed: 7 })
    const yielded = await runPropertyYielding('identity/random', { runs: 250, seed: 7 }, 0)
    expect(yielded.runs).toBe(250)
    expect(yielded.report).toBe(plain.report)
    const broken = (text: string) =>
      text.includes('==') ? { text, tree: parse(text.replace('==', '=')).tree } : parse(text)
    const opts = { runs: 1000, seed: 42, parseFn: broken }
    const r = await runPropertyYielding('identity/asciidoc', opts, 0)
    expect(r.failure).not.toBeNull()
    expect(r.report).toContain('seed 42')
    expect(r.report).toBe(runProperty('identity/asciidoc', opts).report)
  })

  it('a move whose block is not there (a blank line) is a refusal of the block, not of the place', () => {
    const text = 'Intro.\n\n|===\n|a\n\n|b\n|===\n'
    const at = text.indexOf('\n\n') + 1
    const to = text.indexOf('|a')
    const r = applyOperation(parse(text), { kind: 'moveBlock', at, to })
    expect('error' in r && r.error).toBe('invalid-target')
    // the fault is told at `at`, not at `to`: what checkOperation of the fuzz relies on
    if ('error' in r) expect(r.diagnostics.map((d) => d.from)).toEqual([at])
  })
})

describe('editor/actions: faults found by fuzzing', () => {
  it('seed 28: a plus typed after a plate with a plus in it is not a fault of the editor (it says onInexact)', () => {
    expect(() =>
      runActions({ text: ':[quote,{a},"b *c*"]' }, [
        { k: 'type', a: 0.1177, s: 29 },
        { k: 'markCaret', a: 0.3685, m: 3, s: 22 },
        { k: 'enter', a: 0.4 },
        { k: 'type', a: 0.375, s: 10 },
      ] as never),
    ).not.toThrow()
  })

  it('seed 548197974: a word composed while the source made its place a block is followed by the cursor', () => {
    expect(() =>
      runActions({ text: '' }, [
        { k: 'ime', a: 0, s: 0, e: 1, pa: 0, pb: 0, ps: 2 },
        { k: 'typeOver', a: 0.25, b: 0.25, s: 31 },
        { k: 'mark', a: 0.2, b: 0.3, m: 0 },
        { k: 'ime', a: 0.1, s: 0, e: 1, pa: 0.0625, pb: 0.125, ps: 3 },
      ] as never),
    ).not.toThrow()
  })
})

describe('operations/structure: faults found by fuzzing', () => {
  it('seed 107701460: an attribute entry placed at the top changes how the paragraphs after it read: not a fault of the operation', () => {
    const input = {
      text: 'alpha\n+\nalpha\n* `code` alpha\n* alpha\n',
      kind: 'placeBlock',
      at: { r: 0, mode: 0 },
      to: { r: 0, mode: 0 },
      where: 'before',
      level: 1,
      block: { source: ':compat-mode:\n2.3+|both' },
      list: 'unordered',
      text2: '',
      language: '',
      wide: false,
    } as unknown as OperationInput
    expect(() => checkOperation(input)).not.toThrow()
  })

  it('an attribute-entry line inside a listing or a paragraph does not lift the check on the other blocks', () => {
    const base = { kind: 'placeBlock', at: { r: 0, mode: 0 }, to: { r: 0, mode: 0 }, where: 'before', level: 1, list: 'unordered', text2: '', language: '', wide: false }
    for (const source of ['----\n:attr:\n----', 'Plain paragraph text with words.\n:name: value'])
      expect(() => checkOperation({ ...base, text: 'alpha\n\nbeta\n', block: { source } } as unknown as OperationInput)).not.toThrow()
  })
})

describe('faults found by fuzzing', () => {
  const base = { to: { r: 0, mode: 0 }, where: 'before', level: 1, block: { kind: 'paragraph', text: 'x' }, list: 'unordered', text2: '', language: '', wide: false }
  const input = (o: object): OperationInput => ({ ...base, ...o }) as unknown as OperationInput

  for (const [seed, text] of [
    [589506569, '== Section 0\n\n. alpha\n\n* alpha\n+\nalpha'],
    [592199358, '== Section 0\n\n. alpha\n+\nmore\n\n. alpha'],
  ] as const)
    it(`seed ${seed}: an island whose text is set to \`.Title\` after a list marker reads as a block title: not a fault of the operation`, () => {
      const op = input({ text, kind: 'setIslandText', at: { r: 0, mode: 1 }, text2: '.Title' })
      // (the precondition: the place is in an island; if the island is gone, the test is red, and does not pass idle)
      const at = (toOperation(text, op) as { at: number }).at
      expect(layoutItems(readLayout(parse(text))).some((x) => x.kind === 'chip' && x.from <= at && at < x.to)).toBe(true)
      expect(() => checkOperation(op)).not.toThrow()
    })

  it('seed 142506997: a section of level 6 under :leveloffset: is refused with becomes-plate, a code that is known', () => {
    const text = ':leveloffset: +1\n'
    const block = { kind: 'section', level: 6, title: 'x' }
    const r = applyOperation(parse(text), { kind: 'placeBlock', at: 0, block: block as never, replace: true })
    expect('error' in r && r.error).toBe('becomes-plate')
    expect(CODES.has('becomes-plate')).toBe(true)
    expect(() => checkOperation(input({ text, kind: 'placeBlock', at: { r: 0, mode: 0 }, block }))).not.toThrow()
  })

  it('seed 2107295827: a block is not placed between the lines of the header of the document', () => {
    const text = '#  second \\\n= Document Title\n***** deepest\n= Document Title\n[subs=none]'
    const block = { kind: 'admonition', text: 'x' }
    const r = applyOperation(parse(text), { kind: 'placeBlock', at: 0, block: block as never, replace: true })
    expect('error' in r && r.error).toBe('unstable')
    expect(() => checkOperation(input({ text, kind: 'placeBlock', at: { r: 0, mode: 4 }, block }))).not.toThrow()
  })

  it('the lines that lift the check of the text after a change are the entries, the conditionals, the includes and the titles only', () => {
    for (const l of [':toc:', ':!toc:', 'ifdef::x[]', 'ifeval::[1 == 1]', 'include::a.adoc[]', '.Title'])
      expect(GLOBAL_LINE.test(l), l).toBe(true)
    for (const l of ['. Title', '* alpha', 'alpha', '..', '----', '[#id]', 'a :toc:']) expect(GLOBAL_LINE.test(l), l).toBe(false)
  })

  it('an entry written by an operation does not lift the check of the blocks after it unless it changes how they read', () => {
    const text = 'alpha\n\nbeta\n\ngamma\n'
    const before = stats.afterEntry
    // `:toc:` changes nothing in the reading: the blocks after the edit are checked
    checkOperation(input({ text, kind: 'placeBlock', at: { r: 0, mode: 0 }, block: { source: ':toc:\n\nalpha2' } }))
    expect(stats.afterEntry).toBeGreaterThan(before)
    // `:compat-mode:` does: the blocks that read otherwise are let go (seed 107701460 above)
    expect(() =>
      checkOperation(input({ text: 'alpha\n\n`code`\n', kind: 'placeBlock', at: { r: 0, mode: 0 }, block: { source: ':compat-mode:\n\nx' } })),
    ).not.toThrow()
  })

  it('seed 2107295827 (editor/actions): a mark in an island that is held keeps its lines, with the end of line CRLF', () => {
    expect(() =>
      runActions({ text: ':hardbreaks:\r\n> a quote\r\n= Document Title' }, [
        { k: 'source', a: 0.6191, b: 0.375, s: 3 },
        { k: 'backspace', a: 0.0239 },
        { k: 'shiftEnter', a: 0.9513 },
        { k: 'enter', a: 0.9286 },
        { k: 'mark', a: 0, b: 0.2326, m: 0 },
      ] as never),
    ).not.toThrow()
  })

  it('seed 161803398 (editor/actions): a word composed in an island while the source changed it is followed by the cursor', () => {
    expect(() =>
      runActions({ fixture: fixtureTexts.findIndex((f) => f.name === 'stage1/delimited-blocks.adoc') }, [
        { k: 'ime', a: 0.8562, s: 0, e: 1, pa: 0.829, pb: 0.125, ps: 16 },
      ] as never),
    ).not.toThrow()
  })
})

describe('faults found by fuzzing', () => {
  it('seed 727781902 (editor/actions): a list under a line of attributes touches the island and is read as one plate with it: not a loss of roles', () => {
    const text = '[format=csv]\n[.hl-mint]#colour# [.hl-mint.hl-tall]##un##constrained *x [.hl-mint]#y# z* [.hl-mint]##до##*[.hl-mint]##в##п*\n////'
    expect(() =>
      runActions({ text }, [
        { k: 'list', a: 0, b: 0, t: 0 },
        { k: 'ime', a: 0, s: 0, e: 0, pa: 0, pb: 0, ps: 0 },
      ]),
    ).not.toThrow()
  })
})

describe('faults found by fuzzing', () => {
  it('seed 2066806227 (editor/actions): a paragraph that is an island for a directive line and reads as a paragraph once the line is spoiled has no roles to keep: not a loss of roles', () => {
    const text =
      '﻿﻿pass:q[[.hl-mint\\]#красное#] и [.zz-a]#pass:q[x]# и ((слово)) pass:q[_a_]((b))\nendif::attr[]\n= Document Title\n= Document Title\n= Document Title'
    expect(() =>
      runActions({ text }, [
        { k: 'typeOver', a: 0.2, b: 0.5311, s: 0 },
        { k: 'markCaret', a: 0.3368, m: 0, s: 0 },
      ] as never),
    ).not.toThrow()
  })

  it('seed 2066806227 (operations/structure): an item written in the place of an island under a list is an item of that list: not a block away from the changes', () => {
    expect(() =>
      checkOperation({
        text: '1. a\n****\n\n',
        kind: 'setIslandText',
        at: { r: 0, mode: 5 },
        to: { r: 0, mode: 0 },
        where: 'before',
        level: 1,
        block: { kind: 'paragraph', text: 'x' },
        list: 'unordered',
        text2: '* b',
        language: '',
        wide: false,
      } as unknown as OperationInput),
    ).not.toThrow()
  })

  it('seed 1 (operations/structure): a `.Title` written with attribute lines before the heading takes the title of the section: not a block away from the changes', () => {
    expect(() =>
      checkOperation({
        text: '\t= Document Title\n[pass]\n= Document Title\n.. nested ordered item\n[subs="attributes,macros"]',
        kind: 'setIslandText',
        at: { r: 0, mode: 1 },
        to: { r: 0, mode: 0 },
        where: 'before',
        level: 1,
        block: { kind: 'table', header: false, rows: [['*a* {b} <<c>> x | y https://z', '*a* {b} <<c>> x | y https://z']] },
        list: 'unordered',
        text2: '.Title',
        language: '',
        wide: false,
      } as unknown as OperationInput),
    ).not.toThrow()
  })

  it('seed 7 (operations/structure): a list with two blank lines in a row is a plate: a block put at its item does not break it', () => {
    expect(() =>
      checkOperation({
        text: '* alpha\n\n\n- alpha\n* alpha\n',
        kind: 'placeBlock',
        at: { r: 0, mode: 0 },
        to: { r: 0, mode: 0 },
        where: 'before',
        level: 1,
        block: { kind: 'listing', text: '*a* {b} <<c>> x | y https://z', language: 'text' },
        list: 'unordered',
        text2: '',
        language: '',
        wide: false,
      } as unknown as OperationInput),
    ).not.toThrow()
  })

  it('seed 142506997 (editor/actions): a list under a line of an anchor next to pass:q[] is an island, and the roles of the paragraph are kept', () => {
    const text = '[[anchor-id,Reference text]]\npass:q[[.hl-mint\\]#красное#] и [.zz-a]#pass:q[x]#'
    expect(() =>
      runActions({ text }, [
        { k: 'list', a: 0.5, b: 0.5, t: 0 },
        { k: 'box', a: 0.5 },
      ] as never),
    ).not.toThrow()
  })

  it('seed 1876107317 (editor/actions): a NOTE that is only started shows no text, with chips or without them: a link does not change the text under it', () => {
    const text =
      '**un**constrained __un__constrained ``un``constrained ##un##constrained\n[separator=¦]\n*strong* and _emphasis_ and `mono` and #mark# and ^sup^ and ~sub~'
    expect(() =>
      runActions({ text }, [
        { k: 'typeOver', a: 0, b: 0.2548, s: 0 },
        { k: 'type', a: 0.375, s: 0 },
        { k: 'insert', a: 0, t: 7 },
        { k: 'link', a: 0.3691, b: 0.3572, t: 0 },
        { k: 'undo' },
      ] as never),
    ).not.toThrow()
  })
})

describe('edits in a table cell with markup', () => {
  const piece = fc.constantFrom('a', 'b ', 'text', '*b*', '_i_', '`c`', 'https://x.example/a[Link]', 'xref:b.adoc[Doc]', '<<id>>', '[.zz-a]#r#', ' ')
  const cell = fc.array(piece, { minLength: 1, maxLength: 5 }).map((p) => p.join('').trim() || 'a')
  const typed = fc.constantFrom('x', 'ж', ' ', '*', '[', ']', '_', 'a b')

  it('a letter put into a cell, at any place, writes inside that cell only; or is refused: the table keeps its cells', () => {
    fc.assert(
      fc.property(cell, cell, fc.boolean(), fc.nat(60), typed, fc.boolean(), (one, two, acell, k, ch, del) => {
        const open = acell ? 'a|' : '|'
        const src = `|===\n${open}${one}\n\n${acell ? two : ''}\n|keep\n|===\n`.replace('\n\n\n', '\n')
        const doc = parse(src)
        const begin = src.indexOf(open) + open.length
        const end = src.indexOf('\n', begin)
        const at = begin + (k % (end - begin + 1))
        const r = applyOperation(doc, del ? { kind: 'deleteRange', from: at, to: Math.min(end, at + 1 + (k % 3)) } : { kind: 'insertText', at, text: ch })
        if ('error' in r) return
        // everything outside the cell is as it was
        expect(r.doc.text.endsWith('|keep\n|===\n')).toBe(true)
        expect(r.doc.text.startsWith('|===\n' + open)).toBe(true)
        const cells = tableViewAt(parse(r.doc.text), 0)!.rows.flat()
        expect(cells.map((c) => c.text).at(-1)).toBe('keep')
        // (the cells of the table: the one edited, and `keep`)
        expect(cells.length).toBe(2)
        // the cell reads back: its blocks of text are the same in number as before, and read with the text that was written
        const before = tableViewAt(doc, 0)!.rows.flat()[0]!.blocks.filter((b) => b.kind === 'text')
        const after = tableViewAt(parse(r.doc.text), 0)!.rows.flat()[0]!.blocks.filter((b) => b.kind === 'text')
        // (a cell whose first line is `[.role]#x#…[Doc]` is a block attribute line, as in Asciidoctor: the block after it is a plate,
        // the cell has no block of text before and none after)
        if (before.length > 0) expect(after.length).toBeGreaterThanOrEqual(1)
        else expect(after.length).toBe(0)
        if (!acell) {
          expect(after.length).toBe(before.length)
          const read = after[0] as Extract<(typeof after)[number], { kind: 'text' }>
          const shown = read.reading ? read.reading.cells.map((c) => c.ch).join('') : read.text
          expect(shown.length).toBeGreaterThan(0)
        }
      }),
      { numRuns: 400, seed },
    )
  })
})

describe('faults found by fuzzing', () => {
  it('seed 1519162358 (operations/structure): a block that ends in a list item, placed over the empty line above a list, does not merge with it', () => {
    const input = {
      text: '\n* alpha\nalpha\n',
      kind: 'placeBlock',
      at: { r: 0, mode: 0 },
      to: { r: 0, mode: 0 },
      where: 'before',
      level: 1,
      block: { source: '* [[Foo]]text\n= Document Title' },
      list: 'unordered',
      text2: '',
      language: '',
      wide: false,
    } as unknown as OperationInput
    expect(() => checkOperation(input)).not.toThrow()
  })
})

describe('faults found by fuzzing', () => {
  it('seed 1771388188 (operations/structure): a block placed after a list item goes after the items that follow the blank lines, not between them', () => {
    const input = {
      text: '* alpha\n\n\n. alpha\n* alpha\n',
      kind: 'placeBlock',
      at: { r: 0, mode: 0 },
      to: { r: 0, mode: 0 },
      where: 'before',
      level: 1,
      block: { kind: 'image', target: 'img/a.png' },
      list: 'unordered',
      text2: '',
      language: '',
      wide: false,
    } as unknown as OperationInput
    expect(() => checkOperation(input)).not.toThrow()
    const text = '* alpha\n\n\n. alpha\n* alpha\n'
    const r = applyOperation(parse(text), toOperation(text, input))
    expect('error' in r ? '' : r.doc.text).toMatch(/^\* alpha\n\n\n\. alpha\n\* alpha\n\nimage::img\/a\.png\[\]\n/)
  })

  it('seed 1771388188 (operations/structure): an island written as an item is the first item of the list that follows it after a blank line: not a fault of the operation', () => {
    const input = {
      text: "'''\n\n* alpha\n** alpha\n",
      kind: 'setIslandText',
      at: { r: 0, mode: 0 },
      to: { r: 0, mode: 0 },
      where: 'before',
      level: 1,
      block: { kind: 'break' },
      list: 'unordered',
      text2: '* item',
      language: '',
      wide: false,
    } as unknown as OperationInput
    expect(() => checkOperation(input)).not.toThrow()
  })
})

describe('faults found by fuzzing', () => {
  it('seed 31415926 (editor/actions): a letter typed after a composition that the source changed keeps the blank that starts the block', () => {
    expect(() =>
      runActions({ fixture: fixtureTexts.findIndex((f) => f.name === 'edge/empty.adoc') }, [
        { k: 'typeOver', a: 0, b: 0, s: 7 },
        { k: 'list', a: 0, b: 0, t: 2 },
        { k: 'markCaret', a: 0, m: 0, s: 30 },
        { k: 'shiftEnter', a: 0 },
        { k: 'mark', a: 0.5556, b: 0.2223, m: 1 },
        { k: 'ime', a: 0.1112, s: 0, e: 2, pa: 0.25, pb: 0, ps: 0 },
      ] as never),
    ).not.toThrow()
  })
})

describe('faults found by fuzzing', () => {
  it('seed 851729965 (editor/actions): the key after a composition goes to its place', () => {
    expect(() =>
      runActions({ text: " Document Title\n  second \\\n2.3+|both\nstem:[x^2] latexmath:[\\sqrt{4}] asciimath:[a != b] stem:c[<x>]\n> a quote\nifndef::attr[]\n[%hardbreaks]\n:empty:\n= Document Title\n1. numbered item\n|====\n== Раздел [.hl-mint]#((термин))# https://e.example[[.hl-mint]#pass:q[раз]#] [.hl-plum]##pass:q[x] ((y))##\nname:target[text] name:[] [[[bib]]] <1> // <2> #<3> --<.>\n:sectnums:\n- hyphen item\na*b*c a_b_c a**b**c \\*escaped* \\[.r]#x# * _ ` # ^ ~ ** __ ``\nimage::file.png[Alt text,200,100]\n= Document Title\nifdef::attr[one line of text]\n= Document Title\n= Document Title\n[id=anchor-id]\n- hyphen item\n:attr!:\n{name} {attr} {missing} {counter:n} {counter2:m} {set:s:1} {set:s!} {set:leveloffset:1} {set:leveloffset:+1} {set:leveloffset!} \\{escaped} {nbsp} {empty}\n== Раздел [.hl-mint]#((термин))# https://e.example[[.hl-mint]#pass:q[раз]#] [.hl-plum]##pass:q[x] ((y))##\n= Document Title\n:compat-mode!:\n---\n\\ifdef::attr[]\nxref:doc.adoc#id[text] <<id>> <<id,text>> [[inline-anchor]] [[a,b]] anchor:x[y] xref:x[\n3*|repeat\n:other:\nterm:: definition\n:b: https://example.com[x]\nl|literal |m|mono |e|emph |h|head |v|verse |d|default\n[[[unclosed [[ ((( <<< {{{ +++ ]]] ))) >>> }}} pass: stem: kbd: menu: link: image: xref: footnote:\nB. upper letter item\n:b: https://example.com[x]\n\"say \"\"hi\"\"\",d\nAuthor Name <author@example.com>; Second Author\n====\nText +[[Foo]]+ +++[[Foo]]+++ pass:[[[Foo]]]\na:b\\:c\n2.3+|both\n| |\n[quote,{a},\"b *c*\"]" }, [{"k": "backspace", "a": 0.0008}, {"k": "backspace", "a": 0.6296}, {"k": "ime", "a": 0.0908, "s": 0, "e": 1, "pa": 0, "pb": 0, "ps": 0}, {"k": "insert", "a": 0, "t": 0}] as never),
    ).not.toThrow()
  })
})

describe('faults found by fuzzing', () => {
  it('seed 424242001 (editor/actions): a letter typed into an empty `a` cell whose directive the source opened makes the cell read, as the text reads it', () => {
    expect(() =>
      runActions({ fixture: fixtureTexts.findIndex((f) => f.name === 'editor/tables-nested.adoc') }, [
        { k: 'ime', a: 0.6558, s: 0, e: 1, pa: 0.3054, pb: 0, ps: 10 },
        { k: 'ime', a: 0, s: 0, e: 0, pa: 0, pb: 0, ps: 0 },
      ] as never),
    ).not.toThrow()
  })

  it('seed 1771388188 (editor/actions, late run): an edit from a heading into an island that leaves no island reads its source as text: the roles are not a fault', () => {
    expect(() =>
      runActions({ fixture: fixtureTexts.findIndex((f) => f.name === 'stage2/blocks-unclosed-listing.adoc') }, [
        { k: 'typeOver', a: 0.3929, b: 0.3929, s: 0 },
        { k: 'mark', a: 0.0118, b: 0.4, m: 3 },
        { k: 'backspace', a: 0.3432 },
        { k: 'typeOver', a: 0, b: 0.3268, s: 0 },
        { k: 'tab', a: 0, shift: false },
      ] as never),
    ).not.toThrow()
  })

  it('seed 77001177 (editor/actions, late run): a line break removed in an island that then reads as two islands is the same lines, not a fault', () => {
    expect(() =>
      runActions({ text: '\ufeff\ufeffother term;; semicolon definition\n[subs="attributes,macros"]\n= Document Title\n= Document Title\n== Раздел [.hl-mint]#((термин))#\n' }, [
        { k: 'enter', a: 0.517 },
        { k: 'ime', a: 0.0085, s: 0, e: 1, pa: 0.5952, pb: 0.75, ps: 0 },
        { k: 'backspace', a: 0.2536 },
        { k: 'typeOver', a: 0, b: 0, s: 0 },
      ] as never),
    ).not.toThrow()
  })

  it('seed 31415926 (editor/actions, late run): a letter typed after the blank that starts the text of a cell stands where the blank was: not a fault', () => {
    expect(() =>
      runActions({ fixture: fixtureTexts.findIndex((f) => f.name === 'edge/nbsp.adoc') }, [
        { k: 'ime', a: 0, s: 0, e: 1, pa: 0.491, pb: 0.125, ps: 2 },
        { k: 'insert', a: 0, t: 5 },
        { k: 'ime', a: 0.5472, s: 0, e: 1, pa: 0.2156, pb: 0.625, ps: 0 },
        { k: 'type', a: 0, s: 0 },
      ] as never),
    ).not.toThrow()
  })

  it('seed 31415926 (editor/actions, late run): a key typed into a cell that shows blank lines at its start writes the text without them: not a fault', () => {
    expect(() =>
      runActions({ fixture: fixtureTexts.findIndex((f) => f.name === 'edge/nbsp.adoc') }, [
        { k: 'ime', a: 0, s: 0, e: 1, pa: 0.491, pb: 0.125, ps: 2 },
        { k: 'insert', a: 0, t: 5 },
        { k: 'ime', a: 0.6227, s: 0, e: 1, pa: 0.2156, pb: 0.625, ps: 0 },
        { k: 'type', a: 0, s: 0 },
      ] as never),
    ).not.toThrow()
  })

  it('seed 77001177 (editor/actions, late run): lines of an island that end it, and a heading read as a block after it, are not a fault', () => {
    expect(() =>
      runActions({ text: '\ufeff\ufeffother term;; semicolon definition\n[subs="attributes,macros"]\n= Document Title\n<.> automatic callout\n== Раздел [.hl-mint]#((термин))#' }, [
        { k: 'delete', a: 0.3769 },
        { k: 'typeOver', a: 0, b: 0, s: 0 },
      ] as never),
    ).not.toThrow()
  })

  it('seed 77001177 (editor/actions, late run): a letter put at the start of a document that is one island splits it into blocks: the roles of its words are not a fault', () => {
    expect(() =>
      runActions({ text: '\ufeff\ufeff= Document Title\n= Document Title\ninclude::part.adoc[leveloffset=+1]\n= Document Title\n= Document Title\n= Document Title\n= Document Title\n[options="header,footer,autowidth"]\n= Document Title\n= Document Title\n= Document Title\n= Document Title\n= Document Title\n= Document Title\n* [*] starred item\na:b\\:c\n[format=dsv,separator=;]\n== Раздел [.hl-mint]#((термин))# https://e.example[[.hl-mint]#pass:q[раз]#] [.hl-plum]##pass:q[x] ((y))##' }, [
        { k: 'markCaret', a: 0.3996, m: 0, s: 0 },
      ] as never),
    ).not.toThrow()
  })

  it('seed 31415926 (editor/actions, run 88430): a key typed into a cell of a CSV table in a table that makes the cell a plate: not a fault', () => {
    expect(() =>
      runActions({ fixture: fixtureTexts.findIndex((f) => f.name === 'stage3/tables-nesting.adoc') }, [
        { k: 'ime', a: 0.1907, s: 0, e: 1, pa: 0.2663, pb: 0, ps: 10 },
      ] as never),
    ).not.toThrow()
  })
})

describe('the check of an island that was typed in', () => {
  it('lines of the island and lines read as blocks after it are shown', () => {
    expect(islandReadsAs('a\nb', '', 'a\nb')).toBe(true)
    expect(islandReadsAs('a', '\nsecond line', 'a\n\n* second line')).toBe(true)
    expect(islandReadsAs('a\n\nb', '', 'a\nb\n')).toBe(true)
  })
  it('a letter lost at the end of the island is a fault', () => {
    expect(islandReadsAs('abc', '', 'abcx')).toBe(false)
  })
  it('a tail cut off the island, or the last line cut short, is a fault', () => {
    expect(islandReadsAs('a', '', 'a\nb')).toBe(false)
    expect(islandReadsAs('a\nb', '', 'a\nbcd')).toBe(false)
    expect(islandReadsAs('a', '\nother', 'a\n\nsecond')).toBe(false)
  })
  it('a line of markers only is not shown by every rest', () => {
    expect(islandReadsAs('a', '\nother', 'a\n\n----')).toBe(false)
    expect(islandReadsAs('a', '\n----', 'a\n\n----')).toBe(true)
  })
  it('an island that is empty is a fault', () => {
    expect(islandReadsAs('', '\nabc', 'abc')).toBe(false)
    expect(islandReadsAs(' \n', '', 'abc')).toBe(false)
  })
})

describe('faults found by fuzzing', () => {
  // A first line that starts with `[` and ends with `]` is a block attribute line (as in Asciidoctor), so the cell
  // `a|[.zz-a]#r#…xref:b.adoc[Doc]` holds a plate and no block of text: the property must not ask for one.
  it.each([
    ['seed 1960887069', '[.zz-a]#r#`c`xref:b.adoc[Doc]', 29],
    ['seed 1962884221', '[.zz-a]#r#axref:b.adoc[Doc]', 55],
  ])('%s: a cell that opens with an attribute line has no text block, and an edit at its end leaves it as it was', (_n, one, k) => {
    const src = `|===\na|${one}\n\na\n|keep\n|===\n`
    const doc = parse(src)
    const textBlocks = (d: typeof doc) => tableViewAt(d, 0)!.rows.flat()[0]!.blocks.filter((b) => b.kind === 'text')
    expect(textBlocks(doc)).toHaveLength(0)
    const begin = src.indexOf('a|') + 2
    const end = src.indexOf('\n', begin)
    const r = applyOperation(doc, { kind: 'deleteRange', from: begin + (k % (end - begin + 1)), to: end })
    if ('error' in r) throw new Error('refused')
    expect(r.doc.text).toBe(src)
    expect(tableViewAt(parse(r.doc.text), 0)!.rows.flat()).toHaveLength(2)
  })
})

describe('faults found by fuzzing', () => {
  it('seed 31415926 (editor/actions, late run): an island after shiftEnter and a list is read again with no line left over', () => {
    const nums = (d: { forEach: (f: (n: { type: { name: string }; attrs: Record<string, unknown> }) => void) => void }): string[] => {
      const out: string[] = []
      d.forEach((n) => {
        if (n.type.name === 'list_item') out.push(String(n.attrs.num))
      })
      return out
    }
    let seen: { screen: string[]; text: string[] } | null = null
    runActions(
      { fixture: fixtureTexts.findIndex((f) => f.name === 'edge/nbsp.adoc') },
      [
        { k: 'type', a: 0.5491, s: 19 },
        { k: 'shiftEnter', a: 0.4834 },
        { k: 'list', a: 0.7541, b: 0.6558, t: 1 },
        { k: 'ime', a: 0, s: 0, e: 1, pa: 0.3677, pb: 0.625, ps: 0 },
        { k: 'shiftEnter', a: 0.4755 },
        { k: 'type', a: 0, s: 0 },
      ] as never,
      (screen, projection) => {
        seen = { screen: nums(screen), text: nums(projection) }
      },
    )
    // the cursor has left the island: the screen counts the items as the text does, the second one is 2.
    expect(seen).not.toBeNull()
    expect(seen!.screen).toEqual(['1.', '2.'])
    expect(seen!.text).toEqual(['1.', '2.'])
  })
})
