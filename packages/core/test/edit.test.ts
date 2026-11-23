import { describe, expect, it } from 'vitest'
import { type Change, type Operation, applyOperation, mapOffset, parse } from '@nota-adoc/core'
import { renderHtml } from '@nota-adoc/html'
import { readInline, readLayout } from '@nota-adoc/core/internal'

/** The text after an operation, or `error:<code>`. */
function run(text: string, op: Operation): string {
  const r = applyOperation(parse(text), op)
  if ('error' in r) return `error:${r.error}`
  expect(r.doc.text).toBe(parse(r.doc.text).text)
  return r.doc.text
}

/** The visible text of the paragraphs and headings of a text, blocks separated by `|`, plates as `[plate]`. */
function visible(text: string): string {
  const doc = parse(text)
  const layout = readLayout(doc)
  return layout.blocks
    .map((b) =>
      b.kind === 'table'
        ? '[table]'
        : b.kind === 'chip'
          ? '[plate]'
          : readInline(doc, b.content!.from, b.content!.to)
              .cells.map((c) => (c.kind === 'break' ? '↵' : c.kind === 'chip' ? '⟦chip⟧' : c.ch))
              .join(''),
    )
    .join('|')
}

/** What the HTML of a text shows as text, tags gone. */
const plainHtml = (text: string): string =>
  renderHtml(parse(text))
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#43;/g, '+')
    .replace(/&amp;/g, '&')

describe('reading: cells', () => {
  it('reads the visible text of paragraphs and headings and leaves plates alone', () => {
    expect(visible('= Title\n\nSome *bold* and _it_ text.\n\n== Sec\n\nterm:: item\n')).toBe(
      'Title|Some bold and it text.|Sec|[plate]',
    )
    // (an item of a list is text now)
    expect(visible('* item\n')).toBe('item')
    expect(visible('a\nb +\nc')).toBe('a b↵c')
    expect(visible('x https://a.b[link] <<id,ref>> <<id>> xref:t[] y')).toBe('x link ref id t y')
  })

  it('reads a `]` written `\\]` inside the text of a link as one character', () => {
    expect(visible('https://x.y[a\\]b]')).toBe('a]b')
  })
})

describe('insertText', () => {
  it('types plain text in the middle of a paragraph and touches nothing else', () => {
    expect(run('hello world\n\nnext', { kind: 'insertText', at: 5, text: ' big' })).toBe(
      'hello big world\n\nnext',
    )
    expect(run('привет мир', { kind: 'insertText', at: 7, text: 'дорогой ' })).toBe('привет дорогой мир')
  })

  it('types into a heading', () => {
    expect(run('== Head\n\ntext', { kind: 'insertText', at: 7, text: 'er' })).toBe('== Header\n\ntext')
  })

  it('types in an empty document and in an empty paragraph', () => {
    expect(run('', { kind: 'insertText', at: 0, text: 'abc' })).toBe('abc\n')
    expect(run('foo\n\n\nnext', { kind: 'insertText', at: 5, text: 'x' })).toBe('foo\n\nx\n\nnext')
    expect(run('foo\n\n\n', { kind: 'insertText', at: 5, text: 'x' })).toBe('foo\n\nx\n')
  })

  it('refuses a line break, and a place that is a plate', () => {
    expect(run('a b', { kind: 'insertText', at: 1, text: 'x\ny' })).toBe('error:newline-in-text')
    expect(run('----\ncode\n----\n', { kind: 'insertText', at: 6, text: 'x' })).toBe('error:not-editable')
  })

  const strings = [
    '*жирный*',
    '**a**',
    '_x_',
    '`x`',
    '#x#',
    '[.r]#x#',
    '+x+',
    '{name}',
    '<<id>>',
    'xref:a[b]',
    'https://example.com',
    'a\\b',
    '(C)',
    '*',
  ]
  // before a letter, before a space and at the end of the paragraph: a marker is only read as markup in some of them
  const contexts: [string, string][] = [
    ['', 'end'],
    ['text ', 'end'],
    ['text', 'end'],
    ['text ', ' end'],
    ['text', ' end'],
    ['text ', ''],
    ['text', ''],
  ]
  for (const typed of strings)
    for (const [before, after] of contexts) {
      const name = `${JSON.stringify(typed)} after ${JSON.stringify(before)} and before ${JSON.stringify(after)}`
      it(`types ${name} as plain text, all at once`, () => {
        const r = applyOperation(parse(before + after), {
          kind: 'insertText',
          at: before.length,
          text: typed,
        })
        if ('error' in r) throw new Error(`error ${r.error}`)
        expect(visible(r.doc.text)).toBe(before + typed + after)
        expect(plainHtml(r.doc.text).trim()).toBe(before + typed + after)
      })
      it(`types ${name} as plain text, one character at a time`, () => {
        let text = before + after
        let at = before.length
        for (const ch of typed) {
          const r = applyOperation(parse(text), { kind: 'insertText', at, text: ch })
          if ('error' in r) throw new Error(`error ${r.error} typing ${ch} into ${JSON.stringify(text)}`)
          at = mapOffset(r.changes as Change[], at, 1)
          text = r.doc.text
        }
        expect(visible(text)).toBe(before + typed + after)
        expect(plainHtml(text).trim()).toBe(before + typed + after)
      })
    }

  /** Types `typed` one character at a time; the text after every step. */
  function typeSteps(text: string, at: number, typed: string): string[] {
    const steps: string[] = []
    for (const ch of typed) {
      const r = applyOperation(parse(text), { kind: 'insertText', at, text: ch })
      if ('error' in r) throw new Error(`error ${r.error} typing ${ch} into ${JSON.stringify(text)}`)
      expect(r.literal).not.toBe(false)
      at = mapOffset(r.changes as Change[], at, 1)
      text = r.doc.text
      steps.push(text)
    }
    return steps
  }

  it('a plus after a blank at the end of a paragraph is escaped while it is the end, and plain after that', () => {
    const steps = typeSteps('text', 4, ' + b')
    expect(steps).toEqual(['text ', 'text {plus}', 'text {plus} ', 'text + b'])
    // the screen shows what was typed at every step, and no hard break
    for (const [i, step] of steps.entries())
      expect(visible(step)).toBe(['text ', 'text +', 'text + ', 'text + b'][i])
    expect(plainHtml(steps[1]!).trim()).toBe('text +')
    expect(renderHtml(parse(steps[1]!))).not.toContain('<br')
  })

  it('a plus typed at the end of a line inside a paragraph is escaped too', () => {
    const r = applyOperation(parse('one \ntwo'), { kind: 'insertText', at: 4, text: '+' })
    if ('error' in r) throw new Error(r.error)
    expect(r.doc.text).toBe('one {plus}\ntwo')
    expect(visible(r.doc.text)).toBe('one + two')
    expect(r.literal).not.toBe(false)
  })

  it('a plus at the end of a heading and of a paragraph with marks shows as typed', () => {
    expect(typeSteps('== Head', 7, ' +').at(-1)).toBe('== Head {plus}')
    expect(visible(typeSteps('== Head', 7, ' +').at(-1)!)).toBe('Head +')
    expect(visible(typeSteps('*bold* x', 8, ' +').at(-1)!)).toBe('bold x +')
  })

  it('a plus after a blank that is followed by more text is a plain plus, "1 + 1 = 2" types as typed', () => {
    expect(typeSteps('sum', 3, ' + 1 = 2').at(-1)).toBe('sum + 1 = 2')
    expect(run('a {plus}', { kind: 'insertText', at: 8, text: 'b' })).toBe('a +b')
  })

  it('a plus alone on a line is escaped too: a bare one would underline a title or start a continuation', () => {
    expect(run('x +\n', { kind: 'insertText', at: 3, text: '+' })).toBe('x +\n{plus}\n')
    const r = applyOperation(parse('x +\n'), { kind: 'insertText', at: 3, text: '+' })
    if ('error' in r) throw new Error(r.error)
    expect(r.literal).not.toBe(false)
    expect(visible(r.doc.text)).toBe('x↵+')
    // more text on the line and it is a plain plus again
    expect(typeSteps('x +\n', 3, '+ b').at(-1)).toBe('x +\n+ b\n')
  })

  it('a {plus} that somebody wrote in the middle of a line stays as it is when its paragraph is edited', () => {
    expect(run('a {plus} b', { kind: 'insertText', at: 10, text: 'c' })).toBe('a {plus} bc')
    expect(run('a {plus}', { kind: 'insertText', at: 0, text: 'x' })).toBe('xa {plus}')
  })

  it('takes the plus away with its escape, and writes the escape again when it becomes the end again', () => {
    expect(run('a {plus}', { kind: 'deleteRange', from: 2, to: 8 })).toBe('a ')
    expect(run('a + b', { kind: 'deleteRange', from: 3, to: 5 })).toBe('a {plus}')
  })
})

describe('deleteRange and joinBlocks', () => {
  it('deletes text inside a paragraph, and the marks that lose all their text', () => {
    expect(run('hello world', { kind: 'deleteRange', from: 5, to: 11 })).toBe('hello')
    expect(run('a *bold* c', { kind: 'deleteRange', from: 3, to: 7 })).toBe('a  c')
    expect(run('a *bold* c', { kind: 'deleteRange', from: 4, to: 5 })).toBe('a *bld* c')
    expect(run('see https://x.y[link] here', { kind: 'deleteRange', from: 4, to: 20 })).toBe('see  here')
    expect(run('a *b* c', { kind: 'deleteRange', from: 3, to: 4 })).toBe('a  c')
  })

  it('keeps a mark that a deletion leaves touching a word, by doubling its markers', () => {
    expect(run('*bold* word', { kind: 'deleteRange', from: 6, to: 7 })).toBe('**bold**word')
  })

  it('deletes across blocks: what is left of the two ends is one block', () => {
    expect(run('abc\n\ndef', { kind: 'deleteRange', from: 1, to: 6 })).toBe('aef')
    expect(run('== Head\n\nbody\n\nmore', { kind: 'deleteRange', from: 5, to: 15 })).toBe('== Hemore')
    expect(run('a\n\n----\ncode\n----\n\nb', { kind: 'deleteRange', from: 1, to: 18 })).toBe('a\n\nb')
  })

  it('deleting all the text of a paragraph leaves an empty one', () => {
    expect(visible(run('foo\n\nbar\n\nbaz', { kind: 'deleteRange', from: 5, to: 8 }))).toBe('foo|baz')
    expect(run('foo\n\nbar\n\nbaz', { kind: 'deleteRange', from: 5, to: 8 })).toBe('foo\n\n\nbaz')
  })

  it('joins a block with the one before it, or after it, taking the separator out of the text', () => {
    expect(run('foo\n\nbar', { kind: 'joinBlocks', at: 5 })).toBe('foo\nbar')
    expect(run('foo\n\nbar', { kind: 'joinBlocks', at: 3, direction: 'forward' })).toBe('foo\nbar')
    expect(run('== H\n\nbar', { kind: 'joinBlocks', at: 6 })).toBe('== H bar')
    expect(run('bar\n\n== H', { kind: 'joinBlocks', at: 8 })).toBe('bar\nH')
  })

  it('does nothing at the start of the first block and after a plate', () => {
    expect(run('foo\n\nbar', { kind: 'joinBlocks', at: 0 })).toBe('foo\n\nbar')
    expect(run('----\ncode\n----\n\nbar', { kind: 'joinBlocks', at: 16 })).toBe('----\ncode\n----\n\nbar')
  })

  it('joins away an empty paragraph', () => {
    expect(run('foo\n\n\nbar', { kind: 'joinBlocks', at: 5 })).toBe('foo\n\nbar')
    expect(run('foo\n\n\nbar', { kind: 'joinBlocks', at: 5, direction: 'forward' })).toBe('foo\n\nbar')
  })
})

describe('splitBlock and insertBreak', () => {
  it('splits a paragraph at the cursor: a blank line stands between the halves', () => {
    expect(run('hello world', { kind: 'splitBlock', at: 5 })).toBe('hello\n\n world'.replace('\n\n ', '\n\n'))
    expect(run('helloworld', { kind: 'splitBlock', at: 5 })).toBe('hello\n\nworld')
    expect(run('a\nb', { kind: 'splitBlock', at: 2 })).toBe('a\n\nb')
  })

  it('splits a marked text into two marked texts', () => {
    expect(run('foo *bar baz*', { kind: 'splitBlock', at: 8 })).toBe('foo *bar*\n\n*baz*')
    expect(run('foo *bar baz*', { kind: 'splitBlock', at: 9 })).toBe('foo *bar*\n\n*baz*')
  })

  it('Enter at the end of a heading gives an empty paragraph under it; typing there gives a paragraph', () => {
    const t = run('== Head\n\ntext', { kind: 'splitBlock', at: 7 })
    expect(t).toBe('== Head\n\n\ntext')
    expect(visible(t)).toBe('Head||text'.replace('||', '|'))
    // the empty paragraph is the second blank line
    expect(run(t, { kind: 'insertText', at: 9, text: 'x' })).toBe('== Head\n\nx\n\ntext')
  })

  it('Enter in an empty paragraph adds another one', () => {
    expect(run('foo\n\n\nbar', { kind: 'splitBlock', at: 5 })).toBe('foo\n\n\n\nbar')
  })

  it('Enter at the end of the last paragraph gives an empty paragraph after it', () => {
    expect(run('foo', { kind: 'splitBlock', at: 3 })).toBe('foo\n\n\n')
    expect(run('foo\n', { kind: 'splitBlock', at: 3 })).toBe('foo\n\n\n')
  })

  it('Enter at the start of a block puts an empty paragraph above it', () => {
    expect(run('foo\n\nbar', { kind: 'splitBlock', at: 5 })).toBe('foo\n\n\nbar')
    expect(run('foo', { kind: 'splitBlock', at: 0 })).toBe('\nfoo')
  })

  it('Shift-Enter is a hard line break in the same paragraph', () => {
    expect(run('foobar', { kind: 'insertBreak', at: 3 })).toBe('foo +\nbar')
    expect(visible('foo +\nbar')).toBe('foo↵bar')
    expect(run('foo', { kind: 'insertBreak', at: 3 })).toBe('foo +')
    expect(run('== H', { kind: 'insertBreak', at: 4 })).toBe('error:break-in-heading')
  })
})

describe('toggleMark', () => {
  it('does not write a blank typed at the start of a block, also inside a mark that starts there', () => {
    expect(run('__t__ext', { kind: 'insertText', at: 2, text: ' +' })).toBe('__+t__ext')
  })

  it('keeps a blank that opens a mark at the start of a block: the marker, not the blank, starts the line', () => {
    const text = run('__ +__', { kind: 'toggleMark', from: 0, to: 6, mark: 'strong' })
    expect(text).toBe('__** +**__')
    expect(visible(text)).toBe(' +')
  })

  it('refuses to take off a mark whose text is a blank that would then start the paragraph, instead of losing it', () => {
    expect(run('`` ``word rest', { kind: 'toggleMark', from: 0, to: 5, mark: 'code' })).toMatch(/^error:/)
    expect(run('`` ``', { kind: 'toggleMark', from: 0, to: 5, mark: 'code' })).toMatch(/^error:/)
  })

  const marks: [string, string, string][] = [
    ['strong', '*', '*'],
    ['em', '_', '_'],
    ['code', '`', '`'],
    ['highlight', '#', '#'],
    ['strike', '[.line-through]#', '#'],
  ]
  for (const [mark, open, close] of marks) {
    it(`${mark}: wraps a word in the default markers, and a second call gives the text back byte for byte`, () => {
      const on = run('one two three', { kind: 'toggleMark', from: 4, to: 7, mark: mark as 'strong' })
      expect(on).toBe(`one ${open}two${close} three`)
      const off = run(on, {
        kind: 'toggleMark',
        from: 4 + open.length,
        to: 7 + open.length,
        mark: mark as 'strong',
      })
      expect(off).toBe('one two three')
    })
    it(`${mark}: inside a word the markers are doubled, and the text comes back`, () => {
      const on = run('abcdef', { kind: 'toggleMark', from: 2, to: 4, mark: mark as 'strong' })
      const dbl = open.replace(/.$/, '') + open.slice(-1).repeat(2)
      expect(on).toBe(`ab${dbl}cd${close.repeat(2)}ef`)
      const off = run(on, {
        kind: 'toggleMark',
        from: 2 + dbl.length,
        to: 4 + dbl.length,
        mark: mark as 'strong',
      })
      expect(off).toBe('abcdef')
    })
  }

  it('marks each paragraph of a selection over two paragraphs', () => {
    expect(run('one two\n\nthree four', { kind: 'toggleMark', from: 4, to: 14, mark: 'strong' })).toBe(
      'one *two*\n\n*three* four',
    )
  })

  it('a selection that covers part of a mark of the same kind makes the mark cover both', () => {
    expect(run('*one* two three', { kind: 'toggleMark', from: 3, to: 9, mark: 'strong' })).toBe(
      '*one two* three',
    )
    expect(run('one *two* three', { kind: 'toggleMark', from: 0, to: 6, mark: 'strong' })).toBe(
      '*one two* three',
    )
  })

  it('taking a mark off the middle of a marked text splits it', () => {
    expect(run('*one two three*', { kind: 'toggleMark', from: 4, to: 9, mark: 'strong' })).toBe(
      '*one* two *three*',
    )
  })

  it('another kind of mark over part of a mark nests or splits, and the text reads the same', () => {
    const t = run('*one two* three', { kind: 'toggleMark', from: 5, to: 13, mark: 'em' })
    expect(visible(t)).toBe('one two three')
    const doc = parse(t)
    const b = readLayout(doc).blocks[0]!
    const cells = readInline(doc, b.content!.from, b.content!.to).cells
    expect(
      cells
        .filter((c) => c.spans.some((s) => s.type === 'strong'))
        .map((c) => c.ch)
        .join(''),
    ).toBe('one two')
    expect(
      cells
        .filter((c) => c.spans.some((s) => s.type === 'em'))
        .map((c) => c.ch)
        .join(''),
    ).toBe('two thr')
  })

  it('refuses an empty selection', () => {
    expect(run('one', { kind: 'toggleMark', from: 1, to: 1, mark: 'strong' })).toBe('error:empty-selection')
  })
})

describe('setLink and removeLink', () => {
  it('refuses to take off a link whose text is a blank that would then start the paragraph, instead of losing it', () => {
    expect(run('https://a.b/c[ ]word rest', { kind: 'removeLink', at: 3 })).toMatch(/^error:/)
    // (in the middle of a paragraph the blank is kept)
    expect(run('see https://a.b/c[ ]word rest', { kind: 'removeLink', at: 8 })).toBe('see  word rest')
  })

  it('writes the link the way its target asks', () => {
    expect(run('see the docs', { kind: 'setLink', from: 8, to: 12, target: 'https://example.com/a' })).toBe(
      'see the https://example.com/a[docs]',
    )
    expect(run('see the docs', { kind: 'setLink', from: 8, to: 12, target: 'page.html' })).toBe(
      'see the link:page.html[docs]',
    )
    expect(run('see the docs', { kind: 'setLink', from: 8, to: 12, target: '#intro' })).toBe(
      'see the <<intro,docs>>',
    )
    expect(run('see the docs', { kind: 'setLink', from: 8, to: 12, target: 'doc.adoc#intro' })).toBe(
      'see the xref:doc.adoc#intro[docs]',
    )
    expect(run('write us', { kind: 'setLink', from: 0, to: 8, target: 'mailto:a@b.c' })).toBe(
      'mailto:a@b.c[write us]',
    )
  })

  it('writes a target that is a path to an .adoc file as xref:, with an anchor or without', () => {
    expect(run('see docs', { kind: 'setLink', from: 4, to: 8, target: '../a/b.adoc' })).toBe('see xref:../a/b.adoc[docs]')
    expect(run('see docs', { kind: 'setLink', from: 4, to: 8, target: 'b.asciidoc' })).toBe('see xref:b.asciidoc[docs]')
    expect(run('see docs', { kind: 'setLink', from: 4, to: 8, target: 'b.adoc#top' })).toBe('see xref:b.adoc#top[docs]')
    expect(run('see docs', { kind: 'setLink', from: 4, to: 8, target: 'b.html' })).toBe('see link:b.html[docs]')
  })

  it('escapes a `]` in the text of the link', () => {
    expect(run('a]b', { kind: 'setLink', from: 0, to: 3, target: 'https://x.y' })).toBe('https://x.y[a\\]b]')
    expect(visible('https://x.y[a\\]b]')).toBe('a]b')
  })

  it('changes only the target of a link that is there', () => {
    expect(
      run('see https://x.y[docs] now', { kind: 'setLink', from: 20, to: 20, target: 'https://new.y' }),
    ).toBe('see https://new.y[docs] now')
    expect(run('see https://x.y[docs] now', { kind: 'setLink', from: 16, to: 20, target: '#id' })).toBe(
      'see <<id,docs>> now',
    )
  })

  it('removes a link and leaves the text', () => {
    expect(run('see https://x.y[docs] now', { kind: 'removeLink', at: 20 })).toBe('see docs now')
    expect(run('see <<id,docs>> now', { kind: 'removeLink', at: 12 })).toBe('see docs now')
    expect(run('see https://x.y now', { kind: 'removeLink', at: 10 })).toBe('see \\https://x.y now')
    expect(run('see docs', { kind: 'removeLink', at: 5 })).toBe('error:no-link')
  })

  it('refuses a link over two paragraphs and a target that is not allowed', () => {
    expect(run('one\n\ntwo', { kind: 'setLink', from: 0, to: 8, target: 'https://x.y' })).toBe(
      'error:link-across-blocks',
    )
    expect(run('one', { kind: 'setLink', from: 0, to: 3, target: 'javascript:alert(1)' })).toBe(
      'error:bad-target',
    )
  })
})

describe('setLink: allowed targets', () => {
  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    '  javascript:alert(1)',
    'java\tscript:alert(1)',
    'data:text/html,x',
    'DATA:text/html;base64,AAAA',
    'vbscript:msgbox(1)',
    'file:///etc/hosts',
    'ftp://example.com/x',
    'custom-scheme:payload',
  ])('refuses %j', (target) => {
    expect(run('one', { kind: 'setLink', from: 0, to: 3, target })).toBe('error:bad-target')
  })

  it.each(['http://x.y', 'mailto:a@x.y', 'page.adoc', '../d/page.adoc#part', '#anchor', 'a.adoc#x:y'])('accepts %j', (target) => {
    expect(run('one', { kind: 'setLink', from: 0, to: 3, target })).not.toMatch(/^error:/)
  })
})

describe('setBlockType', () => {
  it('makes headings of paragraphs and paragraphs of headings', () => {
    expect(run('foo bar\nbaz', { kind: 'setBlockType', at: 1, type: 'heading', level: 3 })).toBe(
      '=== foo bar baz',
    )
    expect(run('== Foo\n\nx', { kind: 'setBlockType', at: 4, type: 'paragraph' })).toBe('Foo\n\nx')
    expect(run('foo', { kind: 'setBlockType', at: 1, type: 'heading', level: 6 })).toBe('====== foo')
  })

  it('keeps the kind of markers of a heading when its level changes', () => {
    expect(run('## Foo ##\n\nx', { kind: 'setBlockType', at: 4, type: 'heading', level: 4 })).toBe(
      '#### Foo ####\n\nx',
    )
    expect(run('== Foo\n\nx', { kind: 'setBlockType', at: 4, type: 'heading', level: 3 })).toBe(
      '=== Foo\n\nx',
    )
  })

  it('leaves other blocks alone', () => {
    const t = '* item\n\nfoo\n\n----\ncode\n----\n'
    expect(run(t, { kind: 'setBlockType', at: 8, type: 'heading', level: 2 })).toBe(
      '* item\n\n== foo\n\n----\ncode\n----\n',
    )
  })

  it('does not touch the title of the document', () => {
    expect(run('= Title', { kind: 'setBlockType', at: 3, type: 'paragraph' })).toBe('error:document-title')
  })
})

describe('more operations', () => {
  it('keeps the line breaks of a document with CRLF', () => {
    expect(run('foobar\r\n\r\nnext\r\n', { kind: 'splitBlock', at: 3 })).toBe(
      'foo\r\n\r\nbar\r\n\r\nnext\r\n',
    )
    expect(run('foo\r\n\r\nbar\r\n', { kind: 'joinBlocks', at: 5 })).toBe('foo\r\nbar\r\n')
    expect(run('foo\r\n', { kind: 'splitBlock', at: 3 })).toBe('foo\r\n\r\n\r\n')
    expect(run('a\r\nb\r\n', { kind: 'insertText', at: 1, text: 'x' })).toBe('ax\r\nb\r\n')
    expect(run('foobar\r\n', { kind: 'insertBreak', at: 3 })).toBe('foo +\r\nbar\r\n')
  })

  it('refuses to join a block that has lines above it, and to split or edit a plate', () => {
    expect(run('foo\n\n[[id]]\nbar\n', { kind: 'joinBlocks', at: 12 })).toBe('error:join-meta')
    expect(run('----\ncode\n----\n', { kind: 'splitBlock', at: 6 })).toBe('error:inside-plate')
    expect(run('----\ncode\n----\n', { kind: 'toggleMark', from: 5, to: 9, mark: 'strong' })).toBe(
      'error:unstable',
    )
  })

  it('replaces text over several blocks with one step', () => {
    expect(run('abc\n\ndef\n', { kind: 'replaceText', from: 1, to: 6, text: 'X' })).toBe('aXef\n')
  })

  it('a heading with a leveloffset gets the level asked for', () => {
    const t = ':leveloffset: 1\n\ntext\n'
    const r = applyOperation(parse(t), { kind: 'setBlockType', at: 18, type: 'heading', level: 3 })
    if ('error' in r) throw new Error(r.error)
    const blocks = readLayout(r.doc).blocks
    expect(blocks.map((b) => b.level)).toContain(3)
  })

  it('a title of the document is edited like a heading and keeps its markers', () => {
    expect(run('= Title\n\ntext\n', { kind: 'insertText', at: 7, text: 's' })).toBe('= Titles\n\ntext\n')
    expect(run('== Head ==\n', { kind: 'toggleMark', from: 3, to: 7, mark: 'strong' })).toBe('== *Head* ==\n')
  })

  it('refuses ranges outside the text and unsafe targets', () => {
    expect(run('abc', { kind: 'insertText', at: 9, text: 'x' })).toBe('error:invalid-range')
    expect(run('abc', { kind: 'deleteRange', from: 0, to: 9 })).toBe('error:invalid-range')
    expect(run('abc', { kind: 'setLink', from: 0, to: 3, target: 'data:text/html,x' })).toBe(
      'error:bad-target',
    )
    expect(run('abc', { kind: 'setLink', from: 0, to: 3, target: 'a[b]' })).toBe('error:bad-target')
  })
})

describe('a hard break with blanks after the plus', () => {
  // Asciidoctor strips the blanks at the end of a line: ` + ` is read as ` +`
  it('reads ` + ` and ` +<tab>` as the break itself, no blank after it', () => {
    expect(visible('aa + \n\nnext\n')).toBe('aa↵|next')
    expect(visible('aa +\t\n\nnext\n')).toBe('aa↵|next')
    expect(visible('aa + \nbb\n')).toBe('aa↵bb')
    expect(visible('aa +  \t\nbb\n')).toBe('aa↵bb')
    expect(visible('== Le + \n\nnext\n')).toBe('Le↵|next')
  })

  it('types at the start of the block and prints nothing but the typed letter', () => {
    expect(run('aa + \n\nnext\n', { kind: 'insertText', at: 0, text: 'X' })).toBe('Xaa + \n\nnext\n')
    expect(run('aa +\t\n\nnext\n', { kind: 'insertText', at: 0, text: 'X' })).toBe('Xaa +\t\n\nnext\n')
    expect(run('aa + \nbb\n', { kind: 'insertText', at: 0, text: 'X' })).toBe('Xaa + \nbb\n')
    expect(run('== Le + \n\nnext\n', { kind: 'insertText', at: 3, text: 'X' })).toBe('== XLe + \n\nnext\n')
  })

  it('marks and links a word before it and prints the rest as it was', () => {
    expect(run('aa + \n\nnext\n', { kind: 'toggleMark', from: 0, to: 2, mark: 'strong' })).toBe(
      '*aa* + \n\nnext\n',
    )
    expect(run('== Le + \n\nnext\n', { kind: 'toggleMark', from: 3, to: 5, mark: 'strong' })).toBe(
      '== *Le* + \n\nnext\n',
    )
    expect(run('aa + \n\nnext\n', { kind: 'setLink', from: 0, to: 2, target: 'https://e.com' })).toBe(
      'https://e.com[aa] + \n\nnext\n',
    )
  })

  it('a blank typed right after the break at the end of a block is not shown, as in Asciidoctor', () => {
    const r = applyOperation(parse('aa +\n'), { kind: 'insertText', at: 4, text: ' ' })
    if ('error' in r) throw new Error(r.error)
    expect(visible(r.doc.text)).toBe('aa↵')
  })
})

describe('tables stay plates', () => {
  const table = '|===\n|plain\na|In cell\n\nSecond paragraph\n|===\n\nafter\n'

  it('shows a table with `a` cells as a block of its own and lets the paragraph after it be a paragraph', () => {
    expect(visible(table)).toBe('[table]|after')
  })

  it('edits the paragraphs of an `a` cell as the text of the cell, but writes no bar or break into the table source', () => {
    const at = table.indexOf('In cell') + 3
    expect(run(table, { kind: 'insertText', at, text: '|' })).toBe('error:unwritable')
    expect(run(table, { kind: 'insertBreak', at })).toBe('error:not-editable')
    expect(run(table, { kind: 'deleteRange', from: at, to: at + 2 })).toBe(table.replace('In cell', 'In ll'))
    const second = table.indexOf('Second') + 2
    expect(run(table, { kind: 'insertText', at: second, text: 'x' })).toBe(table.replace('Second', 'Sexcond'))
  })

  it('still edits the paragraph next to the table', () => {
    const at = table.indexOf('after') + 5
    expect(run(table, { kind: 'insertText', at, text: '!' })).toBe(table.replace('after', 'after!'))
  })
})

describe('the messages of refusals and of a wrong document', () => {
  it('names the position and the bounds when it is outside the text', () => {
    const r = applyOperation(parse('abc'), { kind: 'insertText', at: 10, text: 'x' })
    expect('error' in r && r.error).toBe('invalid-range')
    const message = 'error' in r ? r.diagnostics[0]!.message : ''
    expect(message).toContain('Position 10')
    expect(message).toContain('from 0 to 3')
  })

  it('does it for the operations with from and to, and for a position that is not a whole number', () => {
    const r = applyOperation(parse('abc'), { kind: 'deleteRange', from: 1, to: 7 })
    expect('error' in r && r.diagnostics[0]!.message).toContain('Position 7')
    const q = applyOperation(parse('abc'), { kind: 'toggleMark', from: -2, to: 1, mark: 'strong' })
    expect('error' in q && q.diagnostics[0]!.message).toContain('Position -2')
    const f = applyOperation(parse('abc'), { kind: 'removeLink', at: 1.5 })
    expect('error' in f && f.diagnostics[0]!.message).toContain('not a whole number')
  })

  it('throws a TypeError that explains a document that parse did not make', () => {
    let error: unknown
    try {
      applyOperation({ text: 'a' } as never, { kind: 'insertText', at: 0, text: 'x' })
    } catch (e) {
      error = e
    }
    expect(error).toBeInstanceOf(TypeError)
    const message = (error as Error).message
    expect(message).toMatch(/^@nota-adoc\/core: /)
    expect(message).toContain('parse() or doc.update()')
    expect(message).toContain('this copy of @nota-adoc/core')
    expect(message).toContain('two copies')
    expect(message).toContain('node_modules')
  })
})
