import { describe, expect, it } from 'vitest'
import { type BlockSpec, DEFAULT_STYLE_PROFILE, type Operation, applyOperation, parse } from '@nota-adoc/core'
import { applyChanges } from '../src/incremental.js'

/** Runs an operation that has to work; checks the contract (changes, text, the parse of the text). */
function ok(text: string, op: Operation, profile?: Parameters<typeof applyOperation>[2]): string {
  const doc = parse(text)
  const r = applyOperation(doc, op, profile)
  if ('error' in r) throw new Error(`${r.error}: ${r.diagnostics.map((d) => d.message).join('; ')}`)
  expect(applyChanges(text, r.changes)).toBe(r.doc.text)
  const fresh = parse(r.doc.text)
  expect(JSON.stringify(r.doc.asg())).toBe(JSON.stringify(fresh.asg()))
  expect(r.doc.diagnostics).toEqual(fresh.diagnostics)
  return r.doc.text
}

function refused(text: string, op: Operation): string {
  const doc = parse(text)
  const r = applyOperation(doc, op)
  if (!('error' in r)) throw new Error('expected a refusal, got: ' + JSON.stringify(r.doc.text))
  expect(r.diagnostics.length).toBeGreaterThan(0)
  return r.error
}

describe('styleProfile', () => {
  const text = [
    '- a',
    '- b',
    '',
    '',
    '1. one',
    '1. two',
    '',
    '',
    '[%header,cols="2"]',
    '|===',
    '|h1 |h2',
    '',
    '|a |b',
    '|===',
    '',
    '',
    '------',
    'code',
    '------',
    '',
    '',
    '[NOTE]',
    '====',
    'careful',
    '====',
    '',
  ].join('\n')

  it('reads how the document is written', () => {
    const p = parse(text).styleProfile()
    expect(p).toMatchObject({
      unorderedMarker: '-',
      orderedMarker: '1.',
      tableHeader: 'shorthand',
      cols: 'count',
      admonition: 'block',
      blankLines: 2,
    })
    expect(p.delimiterLength.listing).toBe(6)
  })

  it('gives the default for an empty document', () => {
    expect(parse('').styleProfile()).toEqual(DEFAULT_STYLE_PROFILE)
  })

  it('writes new blocks in that style', () => {
    const d = parse(text)
    const last = text.indexOf('[NOTE]')
    const w = (block: Operation & { kind: 'insertBlock' }) => ok(text, block)
    const list = w({ kind: 'insertBlock', at: last, where: 'after', block: { kind: 'list', list: 'unordered', items: ['x', 'y'] } })
    expect(list.endsWith('====\n\n\n- x\n- y\n')).toBe(true)
    const table = w({
      kind: 'insertBlock',
      at: last,
      where: 'after',
      block: { kind: 'table', header: true, rows: [['h1', 'h2'], ['a', 'b']] },
    })
    expect(table.endsWith('====\n\n\n[%header,cols="2"]\n|===\n|h1 |h2\n\n|a |b\n|===\n')).toBe(true)
    const listing = w({ kind: 'insertBlock', at: last, where: 'after', block: { kind: 'listing', text: 'x = 1' } })
    expect(listing.endsWith('====\n\n\n------\nx = 1\n------\n')).toBe(true)
    const note = w({ kind: 'insertBlock', at: last, where: 'after', block: { kind: 'admonition', variant: 'NOTE', text: 'hi' } })
    expect(note.endsWith('====\n\n\n[NOTE]\n====\nhi\n====\n')).toBe(true)
    expect(d.text).toBe(text)
  })

  it('writes by a given profile', () => {
    const t = 'para\n'
    const out = ok(t, { kind: 'insertBlock', at: 0, where: 'after', block: { kind: 'list', list: 'ordered', items: ['a', 'b'] } }, {
      profile: { ...DEFAULT_STYLE_PROFILE, orderedMarker: '1.', blankLines: 3 },
    })
    expect(out).toBe('para\n\n\n\n1. a\n2. b\n')
  })
})

describe('structure operations', () => {
  it('setSectionLevel moves the subsections with it', () => {
    const t = '== A\n\n=== B\n'
    expect(ok(t, { kind: 'setSectionLevel', at: 0, level: 3 })).toBe('=== A\n\n==== B\n')
  })

  it('setSectionLevel refuses levels out of range', () => {
    expect(refused('== A\n\n====== B\n', { kind: 'setSectionLevel', at: 0, level: 3 }).length).toBeGreaterThan(0)
  })

  it('insertBlock puts a paragraph before and after', () => {
    const t = 'one\n\ntwo\n'
    expect(ok(t, { kind: 'insertBlock', at: 0, where: 'after', block: { kind: 'paragraph', text: 'mid' } })).toBe('one\n\nmid\n\ntwo\n')
    expect(ok(t, { kind: 'insertBlock', at: 0, where: 'before', block: { kind: 'paragraph', text: 'first' } })).toBe('first\n\none\n\ntwo\n')
    expect(ok(t, { kind: 'insertBlock', at: 5, where: 'after', block: { kind: 'paragraph', text: 'end' } })).toBe('one\n\ntwo\n\nend\n')
  })

  it('insertBlock works at the end of a text with no line break', () => {
    expect(ok('one', { kind: 'insertBlock', at: 0, where: 'after', block: { kind: 'paragraph', text: 'two' } })).toBe('one\n\ntwo')
  })

  it('moveBlock moves a block, and a section with its subsections', () => {
    const t = 'a\n\nb\n\nc\n'
    expect(ok(t, { kind: 'moveBlock', at: 0, to: 5 })).toBe('b\n\na\n\nc\n')
    expect(ok(t, { kind: 'moveBlock', at: 8, to: 0 })).toBe('c\n\na\n\nb\n')
    const s = '== A\n\nx\n\n=== A1\n\ny\n\n== B\n\nz\n'
    expect(ok(s, { kind: 'moveBlock', at: 0, to: s.length })).toBe('== B\n\nz\n\n== A\n\nx\n\n=== A1\n\ny\n')
  })

  it('moveBlock of a section to a blank line of a plain table right before it leaves the text as it is', () => {
    const t = '=== S2\n\n|===\na|x|y\n\n* x\n\n|b\n|===\n\n=== S12'
    const r = applyOperation(parse(t), { kind: 'moveBlock', at: t.length - 1, to: t.indexOf('\n\n* x') + 1 })
    expect('error' in r).toBe(false)
    expect(ok(t, { kind: 'moveBlock', at: t.length - 1, to: t.indexOf('\n\n* x') + 1 })).toBe(t)
  })

  it('moveBlock: the line break that ends a block of one line is after it, the first character is before it', () => {
    expect(ok('x\n\ny\n', { kind: 'moveBlock', at: 0, to: 4 })).toBe('y\n\nx\n')
    expect(ok('x\n\ny\n\nz\n', { kind: 'moveBlock', at: 0, to: 3 })).toBe('x\n\ny\n\nz\n')
    expect(ok('x\n\ny\n\nz\n', { kind: 'moveBlock', at: 8, to: 3 })).toBe('x\n\nz\n\ny\n')
    expect(ok('x\n\ny', { kind: 'moveBlock', at: 0, to: 4 })).toBe('y\n\nx')
  })

  it('moveBlock into itself is refused', () => {
    const t = '== A\n\nx\n\ny\n'
    expect(refused(t, { kind: 'moveBlock', at: 0, to: t.indexOf('x') })).toBe('invalid-target')
  })

  it('replaceBlock and deleteBlock', () => {
    const t = 'a\n\nb\n\nc\n'
    expect(ok(t, { kind: 'replaceBlock', at: 3, source: 'new *text*' })).toBe('a\n\nnew *text*\n\nc\n')
    expect(ok(t, { kind: 'deleteBlock', at: 3 })).toBe('a\n\nc\n')
    expect(ok(t, { kind: 'deleteBlock', at: 7 })).toBe('a\n\nb\n')
    expect(ok(t, { kind: 'deleteBlock', at: 0 })).toBe('b\n\nc\n')
  })

  it('toggleList: a paragraph, a list, back to paragraphs', () => {
    expect(ok('one two\n', { kind: 'toggleList', at: 0, list: 'unordered' })).toBe('* one two\n')
    expect(ok('one two\n', { kind: 'toggleList', at: 0, list: 'ordered' })).toBe('. one two\n')
    expect(ok('* a\n* b\n', { kind: 'toggleList', at: 0, list: null })).toBe('a\n\nb\n')
    expect(ok('* a\n** b\n* c\n', { kind: 'toggleList', at: 0, list: 'ordered' })).toBe('. a\n.. b\n. c\n')
    expect(ok('* a\n* b\n', { kind: 'toggleList', at: 0, list: 'checklist' })).toBe('* [ ] a\n* [ ] b\n')
    expect(ok('* [x] a\n* [ ] b\n', { kind: 'toggleList', at: 0, list: 'unordered' })).toBe('* a\n* b\n')
  })

  it('indentListItem and outdentListItem', () => {
    expect(ok('* a\n* b\n* c\n', { kind: 'indentListItem', at: 4 })).toBe('* a\n** b\n* c\n')
    expect(ok('* a\n** b\n', { kind: 'outdentListItem', at: 4 })).toBe('* a\n* b\n')
    expect(ok('* a\n** b\n** c\n', { kind: 'indentListItem', at: 9 })).toBe('* a\n** b\n*** c\n')
    expect(refused('* a\n* b\n', { kind: 'indentListItem', at: 0 })).toBe('first-item')
    expect(refused('* a\n', { kind: 'outdentListItem', at: 2 })).toBe('top-level-item')
  })

  it('works in a cell, an item and a block that holds blocks', () => {
    const cell = '|===\na|\npara\n\n* x\n\n|===\n'
    expect(ok(cell, { kind: 'insertBlock', at: cell.indexOf('para'), where: 'after', block: { kind: 'paragraph', text: 'more' } })).toContain('para\n\nmore\n')
    const ex = '====\nin\n\nout\n====\n'
    expect(ok(ex, { kind: 'deleteBlock', at: ex.indexOf('in') })).toBe('====\nout\n====\n')
    const item = '* a\n+\nb\n+\nc\n'
    expect(ok(item, { kind: 'deleteBlock', at: item.indexOf('b') })).toBe('* a\n+\nc\n')
    expect(ok(item, { kind: 'insertBlock', at: item.indexOf('c'), where: 'after', block: { kind: 'paragraph', text: 'd' } })).toBe('* a\n+\nb\n+\nc\n+\nd\n')
  })
})

describe('escaping and fragments', () => {
  it('writes a paragraph as one text', () => {
    const text = '*a* {b} <<c>> x | y \\https://z'
    const out = ok('p\n', { kind: 'insertBlock', at: 0, where: 'after', block: { kind: 'paragraph', text: '*a* {b} <<c>> x | y https://z' } })
    const d = parse(out)
    const para = d.asg().blocks![1]!
    expect(para['inlines']).toHaveLength(1)
    expect((para['inlines'] as { name: string; value: string }[])[0]).toMatchObject({ name: 'text', value: '*a* {b} <<c>> x | y https://z' })
    expect(text.length).toBeGreaterThan(0)
  })

  it('replaceBlock takes a section as a fragment', () => {
    const t = '== Old\n\nx\n\n== Next\n'
    expect(ok(t, { kind: 'replaceBlock', at: 0, source: '== New\n\ntext', expect: 'section' })).toBe('== New\n\ntext\n\n== Next\n')
  })

  it('refuses what is not fit, and leaves the document alone', () => {
    const t = 'a\n\nb\n'
    expect(refused(t, { kind: 'replaceBlock', at: 0, source: '----\ncode' })).toBe('fragment-invalid')
    expect(refused(t, { kind: 'replaceBlock', at: 0, source: '* a\n* b', expect: 'paragraph' })).toBe('unexpected-kind')
    expect(refused(t, { kind: 'replaceBlock', at: 0, source: 'x\n[source]' })).toBe('collateral')
    expect(refused(t, { kind: 'replaceBlock', at: 0, source: 'x\n+' })).toBe('collateral')
    const s = '== A\n\n=== B\n\nx\n\n=== C\n'
    expect(refused(s, { kind: 'replaceBlock', at: s.indexOf('=== B'), source: '== N\n\nt', expect: 'section' })).toBe('collateral')
  })
})

const ins = (at: number, block: BlockSpec, where: 'before' | 'after' = 'after'): Operation => ({ kind: 'insertBlock', at, where, block })

describe('new blocks in the style of the document', () => {
  it('writes every kind of block', () => {
    const t = 'p\n'
    const w = (b: BlockSpec) => ok(t, ins(0, b))
    expect(w({ kind: 'table', rows: [['a|b', 'c'], ['d', 'e']], header: true })).toBe(
      'p\n\n[cols="2",options="header"]\n|===\n|a\\|b |c\n\n|d |e\n|===\n',
    )
    expect(w({ kind: 'table', rows: [['a', 'b']] })).toBe('p\n\n[cols="2"]\n|===\n|a |b\n|===\n')
    expect(w({ kind: 'listing', text: '----\nx', language: 'ts' })).toBe('p\n\n[source,ts]\n-----\n----\nx\n-----\n')
    expect(w({ kind: 'admonition', variant: 'WARNING', text: 'careful' })).toBe('p\n\n[WARNING]\n====\ncareful\n====\n')
    expect(w({ kind: 'example', text: 'in' })).toBe('p\n\n====\nin\n====\n')
    expect(w({ kind: 'open', text: 'in' })).toBe('p\n\n--\nin\n--\n')
    expect(w({ kind: 'quote', text: 'in' })).toBe('p\n\n____\nin\n____\n')
    expect(w({ kind: 'sidebar', text: '' })).toBe('p\n\n****\n****\n')
    expect(w({ kind: 'break', variant: 'page' })).toBe('p\n\n<<<\n')
    expect(w({ kind: 'break' })).toBe("p\n\n'''\n")
    expect(w({ kind: 'literal', text: 'l1\nl2' })).toBe('p\n\n....\nl1\nl2\n....\n')
    expect(w({ kind: 'pass', text: '<b>x</b>' })).toBe('p\n\n++++\n<b>x</b>\n++++\n')
    expect(w({ kind: 'list', list: 'checklist', items: ['a', 'b'] })).toBe('p\n\n* [ ] a\n* [ ] b\n')
    expect(w({ kind: 'section', level: 3, title: 'T *x*' })).toBe('p\n\n=== T \\*x*\n')
  })

  it('takes the style from the document: paragraphs for warnings, # for titles, widths for cols', () => {
    expect(ok('NOTE: one\n\np\n', ins(9, { kind: 'admonition', variant: 'TIP', text: 'careful' }))).toBe('NOTE: one\n\nTIP: careful\n\np\n')
    expect(ok('## M\n\ntext\n', ins(6, { kind: 'section', level: 3, title: 'Sub' }))).toBe('## M\n\ntext\n\n### Sub\n')
    const t = '[cols="1,2"]\n|===\n|a |b\n|===\n\nx\n'
    expect(parse(t).styleProfile().cols).toBe('widths')
    expect(ok(t, ins(t.indexOf('x'), { kind: 'table', rows: [['1', '2', '3']] }))).toContain('[cols="1,1,1"]\n|===\n|1 |2 |3\n|===')
  })

  it('does not take a style from what is not of that kind (a fence of backticks, a block of another style)', () => {
    expect(parse('```ruby\nx\n```\n').styleProfile().delimiterLength.listing).toBe(4)
    expect(ok('```ruby\nx\n```\n', ins(0, { kind: 'listing', text: 'x' }))).toBe('```ruby\nx\n```\n\n----\nx\n----\n')
  })

  it('puts a block in the place a blank line is, and at the ends of a container', () => {
    expect(ok('x\n\n\n\ny\n', ins(3, { kind: 'paragraph', text: 'gap' }))).toBe('x\n\n\n\ngap\n\n\n\ny\n')
    expect(ok('====\nx\n====\n', ins(5, { kind: 'paragraph', text: 'y' }))).toBe('====\nx\n\ny\n====\n')
    expect(ok('====\n====\n', ins(0, { kind: 'paragraph', text: 'y' }))).toBe('====\n====\n\ny\n')
    expect(ok('== A\n\n== B\n', ins(2, { kind: 'paragraph', text: 'y' }))).toBe('== A\n\ny\n\n== B\n')
    expect(ok('= T\n\nx\n', ins(7, { kind: 'paragraph', text: 'lead' }, 'before'))).toBe('= T\n\nlead\n\nx\n')
  })

  it('keeps the line breaks the document has', () => {
    expect(ok('a\r\n\r\nb\r\n', ins(0, { kind: 'list', list: 'unordered', items: ['x', 'y'] }))).toBe('a\r\n\r\n* x\r\n* y\r\n\r\nb\r\n')
  })

  it('separates a list that is put next to a list', () => {
    expect(ok('* a\n* b\n', ins(0, { kind: 'list', list: 'unordered', items: ['n'] }))).toBe('* a\n* b\n\n//\n\n* n\n')
    expect(ok('* a\n* b\n', ins(0, { kind: 'list', list: 'unordered', items: ['n'] }, 'before'))).toBe('* n\n\n//\n\n* a\n* b\n')
  })

  it('refuses what is not a block, and a block in a place where it would be in another block', () => {
    expect(refused('x\n', ins(0, { kind: 'paragraph', text: '' }))).toBe('invalid-block')
    expect(refused('x\n', ins(0, { kind: 'section', level: 1, title: 'T' }))).toBe('invalid-level')
    expect(refused('x\n', ins(0, { kind: 'list', list: 'ordered', items: [] }))).toBe('invalid-block')
    expect(refused('x\n', ins(0, { kind: 'table', rows: [['a'], ['b', 'c']] }))).toBe('invalid-block')
    expect(refused('== A\n\nx\n\n=== A1\n\n== B\n', ins(0, { kind: 'paragraph', text: 'y' }))).toBe('invalid-target')
    expect(refused('', ins(0, { kind: 'paragraph', text: 'p' }))).toBe('invalid-target')
  })
})

describe('escaping by place', () => {
  const textOf = (src: string): unknown[] =>
    ((parse(src).asg().blocks![1]!['inlines'] ?? []) as { name: string; value: string }[]).map((i) => `${i.name}:${i.value}`)
  const insertText = (text: string): string => ok('p\n', ins(0, { kind: 'paragraph', text }))

  it('gives the text of the example as one text', () => {
    const out = insertText('*a* {b} <<c>> x | y https://z')
    expect(out).toBe('p\n\n\\*a* \\{b} \\<<c>> x | y \\https://z\n')
    expect(textOf(out)).toEqual(['text:*a* {b} <<c>> x | y https://z'])
  })

  it('escapes every construct, the replacements and the attributes, a backslash that means itself', () => {
    expect(textOf(insertText('(C) -- ... {plus} [[a]] `m` ^s^ #h# footnote:[x] kbd:[C] pass:[x] +++x+++'))).toEqual([
      'text:(C) -- ... {plus} [[a]] `m` ^s^ #h# footnote:[x] kbd:[C] pass:[x] +++x+++',
    ])
    expect(textOf(insertText('\\*a* x'))).toEqual(['text:\\*a* x'])
    expect(textOf(insertText('a\\b'))).toEqual(['text:a\\b'])
  })

  it('writes the lines of a text, without the blanks at their ends', () => {
    expect(insertText('  two\n lines  ')).toBe('p\n\ntwo\nlines\n')
  })

  it('refuses a text that cannot be written as a paragraph of that text', () => {
    for (const text of ['a +', '= not a title', '* not an item', 'NOTE: y', 'image::a.png[]', '[x]', 'a\n\nb'])
      expect(refused('p\n', ins(0, { kind: 'paragraph', text }))).toMatch(/unwritable|invalid-block/)
  })
})

describe('fragments of AsciiDoc', () => {
  it('takes blocks of the kinds that were asked for', () => {
    expect(ok('x\n', ins(0, { source: '* a\n* b', expect: 'list' }))).toBe('x\n\n* a\n* b\n')
    expect(ok('x\n', ins(0, { source: '[NOTE]\n====\nx\n====', expect: 'admonition' }))).toBe('x\n\n[NOTE]\n====\nx\n====\n')
    expect(ok('x\n\ny\n', ins(0, { source: 'one\n\ntwo' }))).toBe('x\n\none\n\ntwo\n\ny\n')
    expect(ok('x\n', ins(0, { source: '\n\n  indented\n\n' }))).toBe('x\n\n  indented\n')
    expect(ok('x\n', ins(0, { source: '// comment' }))).toBe('x\n\n// comment\n')
  })

  it('refuses a fragment that is not one, with the diagnostics of the fragment', () => {
    const r = applyOperation(parse('x\n'), ins(0, { source: '----\ncode' }))
    expect('error' in r && r.error).toBe('fragment-invalid')
    expect('error' in r && r.diagnostics.length).toBeGreaterThan(0)
    expect(refused('x\n', ins(0, { source: '= Title' }))).toBe('fragment-invalid')
    expect(refused('x\n', ins(0, { source: '' }))).toBe('fragment-invalid')
    expect(refused('x\n', ins(0, { source: ':attr: v' }))).toBe('fragment-invalid')
  })

  it('refuses what would change a neighbour', () => {
    expect(refused('x\n', ins(0, { source: 'ifdef::a[]\nx\nendif::[]' }))).toBe('collateral')
    expect(refused('x\n\ny\n', ins(0, { source: 'a\n[[id]]' }))).toBe('collateral')
    expect(refused('=== A\n\nx\n\n=== B\n', { kind: 'replaceBlock', at: 0, source: '== N\n\nnew', expect: 'section' })).toBe('collateral')
  })

  it('replaces a section by a deeper one, and in a cell, an item and a block that holds blocks', () => {
    expect(ok('=== A\n\nx\n\n=== B\n', { kind: 'replaceBlock', at: 0, source: '==== N\n\nnew', expect: 'section' })).toBe('==== N\n\nnew\n\n=== B\n')
    expect(ok('* a\n+\nb\n', { kind: 'replaceBlock', at: 6, source: 'new *x*' })).toBe('* a\n+\nnew *x*\n')
    expect(ok('====\nin\n====\n', { kind: 'replaceBlock', at: 5, source: '* l\n* m' })).toBe('====\n* l\n* m\n====\n')
    const cell = '|===\na|\npara\n\n* x\n\n|===\n'
    expect(ok(cell, { kind: 'replaceBlock', at: cell.indexOf('para'), source: '.Title\nnew' })).toBe('|===\na|\n.Title\nnew\n\n* x\n\n|===\n')
  })

  it('refuses a kind that is not the one expected, and a fragment of several blocks where one is held', () => {
    expect(refused('x\n\ny\n', { kind: 'replaceBlock', at: 3, source: 'x', expect: 'listing' })).toBe('unexpected-kind')
    expect(refused('* a\n+\nb\n', { kind: 'replaceBlock', at: 6, source: 'p1\n\np2' })).toBe('invalid-target')
  })

  it('leaves the document as it was on a refusal', () => {
    const doc = parse('x\n\ny\n')
    const before = doc.text
    const r = applyOperation(doc, { kind: 'replaceBlock', at: 0, source: 'a\n[source]' })
    expect('error' in r).toBe(true)
    expect(doc.text).toBe(before)
  })
})

describe('moves', () => {
  it('moves into and out of blocks that hold blocks and items', () => {
    expect(ok('q\n\n====\nin\n====\n\nz\n', { kind: 'moveBlock', at: 0, to: 8 })).toBe('====\nq\n\nin\n====\n\nz\n')
    expect(ok('q\n\n====\nin\n====\n\nz\n', { kind: 'moveBlock', at: 7, to: 0 })).toBe('====\nin\n====\n\nq\n\nz\n')
    expect(ok('* a\n+\nb\n\nq\n', { kind: 'moveBlock', at: 6, to: 11 })).toBe('* a\n\nq\n\nb\n')
  })

  it('moves to a blank line, to the start, to the end; in place is no change', () => {
    expect(ok('x\n\ny\n\nz\n', { kind: 'moveBlock', at: 0, to: 8 })).toBe('y\n\nz\n\nx\n')
    expect(ok('x\n\ny\n\nz\n', { kind: 'moveBlock', at: 8, to: 0 })).toBe('z\n\nx\n\ny\n')
    expect(ok('x\n\ny\n\nz\n', { kind: 'moveBlock', at: 0, to: 3 })).toBe('x\n\ny\n\nz\n')
  })

  it('refuses the positions that are not blocks or are inside the block', () => {
    expect(refused('x\n\ny\n', { kind: 'moveBlock', at: 0, to: 0 })).toBe('invalid-target')
    expect(refused('x\n\ny\n', { kind: 'moveBlock', at: 0, to: 1 })).toBe('invalid-target')
    expect(refused('= T\n\nx\n', { kind: 'moveBlock', at: 7, to: 1 })).toBe('invalid-target')
    const r = applyOperation(parse('x\n'), { kind: 'moveBlock', at: 0, to: 99 })
    expect('error' in r && r.error).toBe('invalid-range')
  })

  it('separates a list that is moved next to a list', () => {
    // taking the paragraph away would make the two lists one
    expect(refused('* a\n\nq\n\n* b\n', { kind: 'moveBlock', at: 5, to: 0 })).toBe('collateral')
    expect(ok('* a\n\nq\n\n* b\n', { kind: 'moveBlock', at: 0, to: 12 })).toBe('q\n\n* b\n\n//\n\n* a\n')
  })
})

describe('lists', () => {
  it('toggles in a cell where it reads as it should, and not where it does not', () => {
    const cell = '|===\na|\npara\n\n|b\n|===\n'
    expect(ok(cell, { kind: 'toggleList', at: cell.indexOf('para'), list: 'ordered' })).toBe('|===\na|\n. para\n\n|b\n|===\n')
    // a list that is of another kind than the one after it makes the one after it a part of it
    expect(refused('p\n\n* x\n', { kind: 'toggleList', at: 0, list: 'ordered' })).toBe('collateral')
  })

  it('converts nested lists together, and checklists', () => {
    expect(ok('- a\n* b\n', { kind: 'toggleList', at: 0, list: 'ordered' })).toBe('. a\n.. b\n')
    expect(ok('1. a\n1. b\n', { kind: 'toggleList', at: 0, list: 'unordered' }, { profile: { ...DEFAULT_STYLE_PROFILE, unorderedMarker: '-' } })).toBe('- a\n- b\n')
    expect(ok('* a\n* b\n', { kind: 'toggleList', at: 0, list: 'unordered' })).toBe('* a\n* b\n')
    expect(ok('* [x] a\n', { kind: 'toggleList', at: 0, list: 'ordered' })).toBe('. a\n')
  })

  it('a list of items with more than text is not made paragraphs', () => {
    expect(refused('* a\n+\nb\n', { kind: 'toggleList', at: 0, list: null })).toBe('unsupported')
    expect(refused('term:: d\n', { kind: 'toggleList', at: 0, list: 'ordered' })).toBe('invalid-target')
  })

  it('indents under the list that is there, and outdents with what follows', () => {
    expect(ok('* a\n** b\n* c\n', { kind: 'indentListItem', at: 10 })).toBe('* a\n** b\n** c\n')
    expect(ok('* a\n** b\n** c\n', { kind: 'outdentListItem', at: 4 })).toBe('* a\n* b\n** c\n')
    expect(ok('* a\n** b\n*** c\n', { kind: 'outdentListItem', at: 4 })).toBe('* a\n* b\n** c\n')
  })

  it('refuses to outdent out of a list that has attributes of its own', () => {
    const text = '** nested list item\n[#Foo,reftext=Some Text]\n* [ ] open item'
    const r = applyOperation(parse(text), { kind: 'outdentListItem', at: 45 })
    expect('error' in r && r.error).toBe('unsupported')
  })

  it('moves an item with what is in it', () => {
    expect(ok('* a\n* b\n** c\n', { kind: 'indentListItem', at: 4 })).toBe('* a\n** b\n*** c\n')
  })

  it('deletes an item, and the list with the only item', () => {
    expect(ok('* a\n* b\n* c\n', { kind: 'deleteBlock', at: 4 })).toBe('* a\n* c\n')
    expect(ok('p\n\n* a\n\nq\n', { kind: 'deleteBlock', at: 5 })).toBe('p\n\nq\n')
  })
})

describe('other', () => {
  it('works on a document with no line break at the end, in a cell and a section', () => {
    expect(ok('p\n\nq', { kind: 'deleteBlock', at: 3 })).toBe('p')
    expect(ok('p', { kind: 'deleteBlock', at: 0 })).toBe('')
    const cell = '|===\na|\npara\n\n* x\n\n|b\n|===\n'
    expect(ok(cell, { kind: 'deleteBlock', at: cell.indexOf('* x') })).toBe('|===\na|\npara\n\n|b\n|===\n')
    expect(ok(cell, { kind: 'moveBlock', at: cell.indexOf('para'), to: cell.indexOf('|b') - 1 })).toBe('|===\na|\n* x\n\npara\n\n|b\n|===\n')
  })

  it('moves a block to the last blank line of a cell, to a block on the line of the `a|`, and to another cell', () => {
    const last = '[cols="1"]\n|===\na|\np1\n\np2\n\n|===\n\nout\n'
    expect(ok(last, { kind: 'moveBlock', at: last.indexOf('p1'), to: last.indexOf('p2') + 3 })).toBe(
      '[cols="1"]\n|===\na|\np2\n\np1\n\n|===\n\nout\n',
    )
    const first = '[cols="1"]\n|===\na|p1\n\np2\n|===\n'
    const moved = ok(first, { kind: 'moveBlock', at: first.indexOf('p2'), to: first.indexOf('p1') })
    expect(moved).toBe('[cols="1"]\n|===\na|\np2\n\np1\n|===\n')
    expect(parse(moved).tableAt(moved.indexOf('p2'))).toBeTruthy()
    const two = '[cols="1,1"]\n|===\na|p1\n\np2\na|q\n|===\n'
    expect(ok(two, { kind: 'moveBlock', at: two.indexOf('p2'), to: two.indexOf('q') })).toBe(
      '[cols="1,1"]\n|===\na|p1\na|\np2\n\nq\n|===\n',
    )
  })

  it('writes a bar of a new paragraph in a cell escaped, and one of a block moved into a cell', () => {
    const t = '[cols="1"]\n|===\na|\np1\n|===\n'
    const got = ok(t, { kind: 'insertBlock', at: t.indexOf('p1'), where: 'after', block: { kind: 'paragraph', text: 'x | y' } })
    expect(got).toBe('[cols="1"]\n|===\na|\np1\n\nx \\| y\n|===\n')
    const out = '[cols="1"]\n|===\na|\np1\n|===\n\nx | y\n'
    expect(ok(out, { kind: 'moveBlock', at: out.indexOf('x'), to: out.indexOf('p1') })).toBe(
      '[cols="1"]\n|===\na|\nx \\| y\n\np1\n|===\n',
    )
  })

  it('sets the level of a heading that is not a section and refuses the ones it cannot', () => {
    expect(ok('[discrete]\n=== H\n\npara\n', { kind: 'setSectionLevel', at: 11, level: 4 })).toBe('[discrete]\n==== H\n\npara\n')
    expect(refused('Title\n-----\n\nx\n', { kind: 'setSectionLevel', at: 0, level: 3 })).toBe('unsupported')
    expect(refused('x\n', { kind: 'setSectionLevel', at: 0, level: 3 })).toBe('invalid-target')
    expect(refused('== A\n', { kind: 'setSectionLevel', at: 0, level: 9 })).toBe('invalid-level')
    expect(ok('== A\n\nx\n', { kind: 'setSectionLevel', at: 6, level: 4 })).toBe('==== A\n\nx\n')
  })

  it('checks the arguments', () => {
    const d = parse('x\n')
    const bad = (op: unknown) => {
      const r = applyOperation(d, op as Operation)
      return 'error' in r ? r.error : 'ok'
    }
    expect(bad({ kind: 'insertBlock', at: 0, where: 'after', block: null })).toBe('invalid-block')
    expect(bad({ kind: 'insertBlock', at: 0, where: 'beside', block: { kind: 'break' } })).toBe('invalid-block')
    expect(bad({ kind: 'replaceBlock', at: 0, source: 5 })).toBe('fragment-invalid')
    expect(bad({ kind: 'deleteBlock', at: -1 })).toBe('invalid-range')
    expect(bad({ kind: 'deleteBlock', at: 1.5 })).toBe('invalid-range')
    expect(bad({ kind: 'toggleList', at: 0, list: 'fancy' })).toBe('invalid-block')
  })
})

describe('blank line between the rows of a plain table', () => {
  const t = '|===\n|a\n\n|b\n|===\n'
  const at = t.indexOf('\n\n') + 1
  it('does not refuse insertBlock and moveBlock', () => {
    const doc = parse(t)
    const ins = applyOperation(doc, { kind: 'insertBlock', at, where: 'after', block: { kind: 'paragraph', text: 'x' } })
    expect('error' in ins ? 'error' : ins.doc.text).toBe('|===\n|a\n\n|b\n|===\n\nx\n')
    const m = 'para\n\n' + t
    const mv = applyOperation(parse(m), { kind: 'moveBlock', at: 0, to: m.indexOf('\n\n|b') + 1 })
    expect('error' in mv ? 'error' : mv.doc.text).toBe('|===\n|a\n\n|b\n|===\n\npara\n')
  })
})
