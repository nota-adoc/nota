import v8 from 'node:v8'
import vm from 'node:vm'
import { describe, expect, it } from 'vitest'
import { type ParseOptions, type TextChange, parse, sectionLevel } from '@nota-adoc/core'
import type { Tree, TreeBuffer } from '@lezer/common'
import { signature } from './helpers.js'

function levels(tree: Tree): string {
  const out: string[] = []
  tree.iterate({
    enter(n) {
      if (n.name === 'Section' || n.name === 'DiscreteHeading')
        out.push(`${n.from}:${n.node.tree?.prop(sectionLevel)}`)
    },
  })
  return out.join(' ')
}

function apply(text: string, changes: TextChange[]): string {
  const sorted = [...changes].sort((a, b) => a.from - b.from)
  let out = ''
  let pos = 0
  for (const c of sorted) {
    out += text.slice(pos, c.from) + (c.insert ?? '')
    pos = c.to ?? c.from
  }
  return out + text.slice(pos)
}

function check(text: string, changes: TextChange[], options?: ParseOptions) {
  const before = parse(text, options)
  const beforeSig = signature(before.tree)
  const updated = before.update(changes)
  const expected = apply(text, changes)
  const full = parse(expected, options)
  expect(updated.text).toBe(expected)
  expect(signature(updated.tree)).toBe(signature(full.tree))
  expect(levels(updated.tree)).toBe(levels(full.tree))
  expect(updated.diagnostics).toEqual(full.diagnostics)
  // the old document is untouched
  expect(before.text).toBe(text)
  expect(signature(before.tree)).toBe(beforeSig)
}

const doc = [
  '= Title',
  'Author Name',
  ':doctype: article',
  '',
  'Preamble text.',
  '',
  '== One',
  '',
  'Para one',
  'line two',
  '',
  ':leveloffset: +1',
  '',
  '== Two',
  '',
  '----',
  'code',
  '----',
  '',
  '////',
  'comment',
  '////',
  '',
  ':leveloffset!:',
  '',
  '=== Three',
  '',
  'Last para.',
  '',
].join('\n')

describe('update', () => {
  it('matches a full parse after an edit inside a paragraph', () => {
    const at = doc.indexOf('Para one') + 2
    check(doc, [{ from: at, insert: 'X' }])
  })

  it('matches after edits in the header, markers, delimiters, comments and parse-changing attributes', () => {
    const cases: TextChange[][] = [
      [{ from: 0, to: 1, insert: '' }],
      [{ from: doc.indexOf('article'), to: doc.indexOf('article') + 7, insert: 'book' }],
      [{ from: doc.indexOf('== One'), insert: '=' }],
      [{ from: doc.indexOf('----'), to: doc.indexOf('----') + 1, insert: '' }],
      [{ from: doc.indexOf('////'), insert: '/' }],
      [{ from: doc.indexOf('+1'), to: doc.indexOf('+1') + 2, insert: '-1' }],
      [{ from: doc.indexOf(':leveloffset!:'), to: doc.indexOf(':leveloffset!:') + 1, insert: '' }],
      [{ from: doc.length, insert: '\n== Tail\n' }],
      [{ from: doc.length - 1, to: doc.length, insert: '' }],
      [
        { from: 3, insert: 'abc' },
        { from: doc.indexOf('Last'), to: doc.indexOf('Last') + 4, insert: '////\n' },
      ],
      [{ from: 0, to: doc.length, insert: '' }],
    ]
    for (const c of cases) check(doc, c)
  })

  it('reparses a block whose end depends on the edited line after it', () => {
    check('a\n\nb\n', [{ from: 2, to: 2, insert: 'x' }])
    check('Title\n\n-----\n', [{ from: 6, to: 7, insert: '' }])
    check(':a: x \\\ny\n\n:b: z\n', [{ from: 8, to: 9, insert: '' }])
  })

  it('applies changes given in any order and rejects overlapping ones', () => {
    check('a\n\nb\n\nc\n', [
      { from: 6, insert: 'C' },
      { from: 0, insert: 'A' },
    ])
    expect(() =>
      parse('abc').update([
        { from: 0, to: 2 },
        { from: 1, to: 3 },
      ]),
    ).toThrow(RangeError)
    expect(() => parse('abc').update([{ from: 2, to: 5 }])).toThrow(RangeError)
  })

  it('updates the empty document', () => {
    check('', [{ from: 0, insert: '= T\n\ntext\n' }])
  })
})

const doc2 = [
  '= Lists, blocks and conditions',
  ':flavor: plain',
  '',
  'Intro paragraph.',
  '',
  '* one',
  '** nested',
  '* two',
  '+',
  '----',
  'code',
  '----',
  '* three',
  '',
  'term:: definition',
  '',
  '====',
  'inside',
  '',
  '. numbered',
  '====',
  '',
  'ifdef::flavor[]',
  'Shown for the flavor.',
  '',
  '* conditional item',
  'endif::[]',
  '',
  'ifndef::flavor[]',
  '----',
  'endif::[]',
  '',
  'image::a.png[Alt]',
  '',
  '> quote',
  '> -- who',
  '',
  'include::part.adoc[]',
  '',
  'Last.',
  '',
].join('\n')

describe('update with lists, blocks and conditions', () => {
  const at = (needle: string, nth = 0) => {
    let i = -1
    for (let k = 0; k <= nth; k++) i = doc2.indexOf(needle, i + 1)
    return i
  }

  it('matches a full parse after edits that change lists, blocks and macros', () => {
    const cases: TextChange[][] = [
      [{ from: at('* one') + 2, insert: 'X' }],
      [{ from: at('** nested'), insert: '*' }],
      [{ from: at('+\n----'), to: at('+\n----') + 2, insert: '' }],
      [{ from: at('* two') + 5, insert: '\n\n  literal' }],
      [{ from: at('* three'), insert: '\n' }],
      [{ from: at('term::'), to: at('term::') + 6, insert: 'term:::' }],
      [{ from: at('====', 1), to: at('====', 1) + 4, insert: '' }],
      [{ from: at('====', 0), insert: '=' }],
      [{ from: at('inside'), insert: '--\n' }],
      [{ from: at('image::'), to: at('image::') + 7, insert: 'imag::' }],
      [{ from: at('> quote'), to: at('> quote') + 2, insert: '' }],
      [{ from: at('> -- who') + 2, to: at('> -- who') + 4, insert: '' }],
      [{ from: at('include::'), insert: '\\' }],
      [{ from: at('Last.') + 5, insert: '\n* item' }],
    ]
    for (const c of cases) check(doc2, c)
  })

  it('matches after edits that change what the conditions show', () => {
    const cases: TextChange[][] = [
      // remove the attribute the conditions depend on
      [{ from: at(':flavor: plain'), to: at(':flavor: plain') + ':flavor: plain\n'.length, insert: '' }],
      // rename it
      [{ from: at(':flavor:') + 1, to: at(':flavor:') + 7, insert: 'other' }],
      // set another one that changes a later condition
      [{ from: at('\n\nIntro'), insert: '\n:a: b' }],
      // break the conditions themselves
      [{ from: at('ifdef::flavor[]'), to: at('ifdef::flavor[]') + 2, insert: 'ifn' }],
      [{ from: at('endif::[]'), to: at('endif::[]') + 9, insert: '' }],
      [{ from: at('endif::[]', 1), insert: '\\' }],
      [{ from: at('ifndef::flavor[]'), to: at('ifndef::flavor[]') + 3, insert: 'ifdef' }],
      // text inside a condition that is on and one that is off
      [{ from: at('Shown for') + 2, insert: 'x' }],
      [{ from: at('----\nendif'), insert: 'y' }],
      // a one-line condition, and an eval
      [{ from: at('Intro'), insert: 'ifdef::flavor[shown]\nifeval::[1 > 0]\nx\nendif::[]\n' }],
    ]
    for (const c of cases) check(doc2, c)
  })

  it('matches with attributes given in the options', () => {
    const options: ParseOptions = { attributes: { flavor: null, extra: '' }, blockMacros: ['image'] }
    const cases: TextChange[][] = [
      [{ from: at('Intro') + 1, insert: 'x' }],
      [{ from: at('ifndef::flavor[]') + 8, insert: 'x' }],
      [{ from: at('image::'), insert: 'x' }],
      [
        { from: at('* two'), insert: '\n' },
        { from: at('Last'), insert: 'ifdef::extra[]\nmore\nendif::[]\n' },
      ],
    ]
    for (const c of cases) check(doc2, c, options)
  })

  it('reuses the units after an edit when the state is the same', () => {
    // a change in the last paragraph must not disturb the tree before it
    const before = parse(doc2)
    const change = [{ from: doc2.length - 3, insert: 'X' }]
    const after = before.update(change)
    const cut = at('Last.')
    const kept = (t: typeof before.tree) => {
      const out: string[] = []
      t.iterate({
        enter(n) {
          if (n.to <= cut) out.push(`${n.name}:${n.from}-${n.to}`)
          return undefined
        },
      })
      return out.join(' ')
    }
    expect(kept(after.tree)).toBe(kept(before.tree))
  })

  it('keeps the diagnostics of the conditions in place', () => {
    const t = 'text\n\nifdef::a[]\nmore\n'
    check(t, [{ from: 0, insert: 'x\n\n' }])
    check(t, [{ from: t.length, insert: 'endif::[]\n' }])
    expect(parse(t).update([{ from: t.length, insert: 'endif::[]\n' }]).diagnostics).toEqual([])
    expect(
      parse(t + 'endif::[]\n')
        .update([{ from: t.length, to: t.length + 10 }])
        .diagnostics.map((d) => d.code),
    ).toEqual(['unterminated-conditional'])
  })
})

describe('memory of the last update', () => {
  it('does not mix up two different edits whose printed form is the same', () => {
    const doc = parse('text\n')
    const one = doc.update([{ from: 0, insert: 'a|1,1,b' }])
    const two = doc.update([
      { from: 0, insert: 'a' },
      { from: 1, insert: 'b' },
    ])
    expect(one.text).toBe('a|1,1,btext\n')
    expect(two.text).toBe('atbext\n')
    const again = doc.update([
      { from: 0, insert: 'a' },
      { from: 1, insert: 'b' },
    ])
    expect(again).toBe(two)
  })

  it('does not keep the chain of the next documents alive through an old one', () => {
    v8.setFlagsFromString('--expose-gc')
    const gc = vm.runInNewContext('gc') as () => void
    // a page of about 600 KB, edited 20 times; the host keeps only the first version
    const first = parse('some text of a line\n'.repeat(30_000))
    gc()
    const before = process.memoryUsage().heapUsed
    // (in a function of its own: nothing here holds the later versions)
    ;(() => {
      let last = first
      for (let i = 0; i < 20; i++) last = last.update([{ from: i, insert: 'x' }])
      expect(last.text.length).toBe(first.text.length + 20)
    })()
    // no timer and no wait: what is not reachable now is gone after one collection
    gc()
    const kept = process.memoryUsage().heapUsed - before
    expect(first.text.length).toBe(600_000)
    // the chain would be 20 texts of 600 KB and their units; what is allowed is a document or two
    expect(kept).toBeLessThan(10_000_000)
  })
})

describe('tables', () => {
  const page = [
    'First paragraph.',
    '',
    '[cols="1,a"]',
    '|===',
    '|one |two',
    '',
    '|three',
    'a|',
    'Text in a cell.',
    '',
    '!===',
    '!x !y',
    '!===',
    '|===',
    '',
    ',===',
    'a,b',
    ',===',
    '',
    'Last paragraph.',
    '',
  ].join('\n')
  const at = (needle: string, from = 0) => page.indexOf(needle, from)

  it('gives the tree and the tables of a full parse after an edit in a cell', () => {
    const cases: TextChange[][] = [
      [{ from: at('one') + 1, insert: 'X' }],
      [{ from: at('!x') + 1, insert: 'X' }],
      [{ from: at('Text in') + 2, to: at('Text in') + 4 }],
      [{ from: at('|two'), insert: '2+' }],
      [{ from: at('|===\n\n,==='), insert: '  ' }],
      [{ from: at('|===\n\n,==='), to: at('|===\n\n,===') + 4 }],
      [{ from: at('!===\n!x'), to: at('!===\n!x') + 4 }],
      [{ from: at('[cols'), insert: '// note\n' }],
      [{ from: at('a,b') + 1, insert: '"' }],
      [{ from: at('a,b'), insert: ':' }],
      [{ from: 0, insert: ':cols: 3\n\n' }],
    ]
    for (const c of cases) check(page, c)
  })

  it('has the model of a full parse after an edit', () => {
    const edit = [{ from: at('one') + 1, insert: 'X' }]
    const updated = parse(page).update(edit)
    const full = parse(apply(page, edit))
    for (const needle of ['|two', '!x', 'a,b', 'three'])
      expect(updated.tableAt(full.text.indexOf(needle) + 1)).toEqual(
        full.tableAt(full.text.indexOf(needle) + 1),
      )
  })

  const kind = (c: Tree | TreeBuffer): string => ('type' in c ? c.type.name : '')

  /** The blocks of the tree that the update made new: only the table with the edit and the blank line that looked at it. */
  function reread(edit: TextChange[]) {
    const before = parse(page)
    const after = before.update(edit)
    const old = new Set<unknown>(before.tree.children)
    const fresh = after.tree.children.filter((c) => !old.has(c))
    expect(fresh.filter((c) => kind(c) === 'DelimitedBlock')).toHaveLength(1)
    expect(fresh.every((c) => kind(c) === 'DelimitedBlock' || kind(c) === 'BlankLine')).toBe(true)
    // the paragraphs and the csv table are the trees they were
    const blocks = after.tree.children.filter((c) => kind(c) === 'DelimitedBlock')
    expect(blocks).toHaveLength(2)
    expect(old.has(blocks[1])).toBe(true)
    expect(old.has(after.tree.children[0])).toBe(true)
    expect(old.has(after.tree.children[after.tree.children.length - 1])).toBe(true)
    expect(after.tree.children.length).toBe(before.tree.children.length)
    return after
  }

  it('reads again only the table an edit is in and reuses the blocks around it', () => {
    reread([{ from: at('one') + 1, insert: 'X' }])
  })

  it('reads again only the table when the edit is in a table in a cell', () => {
    const after = reread([{ from: at('!x') + 1, insert: 'X' }])
    expect(after.tableAt(at('!x') + 3)!.rows.body[0]!.cells.map((c) => c.text)).toEqual(['Xx', 'y'])
  })
})

describe('the errors of update', () => {
  const message = (f: () => unknown): { name: string; message: string } => {
    try {
      f()
    } catch (e) {
      return { name: (e as Error).name, message: (e as Error).message }
    }
    throw new Error('did not throw')
  }

  it('names the range, the length of the text and the rule for a range outside it', () => {
    const e = message(() => parse('abc').update([{ from: 5, to: 6, insert: '' }]))
    expect(e.name).toBe('RangeError')
    expect(e.message).toMatch(/^@nota-adoc\/core: /)
    expect(e.message).toContain('5-6')
    expect(e.message).toContain('length 3')
    expect(e.message).toContain('0 <= from <= to <= 3')
  })

  it('names both replacements that overlap', () => {
    const e = message(() =>
      parse('abcdef').update([
        { from: 1, to: 4, insert: 'x' },
        { from: 3, to: 5, insert: 'y' },
      ]),
    )
    expect(e.name).toBe('RangeError')
    expect(e.message).toContain('1-4')
    expect(e.message).toContain('3-5')
    expect(e.message).toContain('overlap')
  })

  it('names the field and the type of an insert that is not a string', () => {
    const e = message(() => parse('abc').update([{ from: 0, insert: 5 as never }]))
    expect(e.name).toBe('TypeError')
    expect(e.message).toContain('`insert`')
    expect(e.message).toContain('got number')
  })
})
