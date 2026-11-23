// deleting, splitting, marks, links and styles in the visual editor.
import { afterEach, describe, expect, it } from 'vitest'
import { projectDocument } from '@nota-adoc/prosemirror'
import { type Setup, closeAll, inCell, key, open, posIn, select, shape, textOf, type } from './helpers.js'

afterEach(closeAll)

/** The screen is the projection of the text from nothing. */
const synced = ({ editor, session }: Setup): void => {
  expect(editor.view.state.doc.eq(projectDocument(session.doc))).toBe(true)
}

describe('deleting', () => {
  it('Backspace and Delete inside a text take one character', () => {
    const s = open('hello world')
    select(s.editor, posIn(s.editor, 0, 5))
    key(s.editor, 'Backspace')
    expect(s.session.text).toBe('hell world')
    key(s.editor, 'Delete')
    expect(s.session.text).toBe('hellworld')
    synced(s)
    expect(s.editor.view.state.selection.from).toBe(posIn(s.editor, 0, 4))
  })

  it('deleting a selection removes exactly its range, in a block and across blocks and plates', () => {
    let s = open('abc def\n\nghi jkl\n')
    select(s.editor, posIn(s.editor, 0, 2), posIn(s.editor, 0, 5))
    key(s.editor, 'Backspace')
    expect(s.session.text).toBe('abef\n\nghi jkl\n')
    closeAll()
    s = open('abc\n\ndef\n\nghi\n')
    select(s.editor, posIn(s.editor, 0, 1), posIn(s.editor, 2, 2))
    key(s.editor, 'Delete')
    expect(s.session.text).toBe('ai\n')
    synced(s)
    closeAll()
    s = open('abc\n\n----\ncode\n----\n\nghi\n')
    select(s.editor, posIn(s.editor, 0, 1), posIn(s.editor, 2, 2))
    key(s.editor, 'Backspace')
    expect(s.session.text).toBe('ai\n')
    synced(s)
  })

  it('deleting all the text of a mark or a link takes its markers with it', () => {
    const s = open('a *bold* b https://x.y[link] c')
    select(s.editor, posIn(s.editor, 0, 2), posIn(s.editor, 0, 6))
    key(s.editor, 'Backspace')
    expect(s.session.text).toBe('a  b https://x.y[link] c')
    select(s.editor, posIn(s.editor, 0, 5), posIn(s.editor, 0, 9))
    key(s.editor, 'Backspace')
    expect(s.session.text).toBe('a  b  c')
    synced(s)
  })

  it('Backspace at the start of a paragraph or a heading joins it with the one before; Delete at the end joins it with the next', () => {
    let s = open('foo\n\nbar\n')
    select(s.editor, posIn(s.editor, 1, 0))
    key(s.editor, 'Backspace')
    expect(s.session.text).toBe('foo\nbar\n')
    expect(shape(s.editor)).toBe('foo bar')
    synced(s)
    closeAll()
    s = open('foo\n\n== Bar\n')
    select(s.editor, posIn(s.editor, 0, 3))
    key(s.editor, 'Delete')
    expect(s.session.text).toBe('foo\nBar\n')
    expect(shape(s.editor)).toBe('foo Bar')
    synced(s)
  })

  it('Backspace at the start of the first block, and of a block after a plate, changes nothing', () => {
    const s = open('foo\n\n----\ncode\n----\n\nbar\n')
    select(s.editor, posIn(s.editor, 0, 0))
    key(s.editor, 'Backspace')
    select(s.editor, posIn(s.editor, 2, 0))
    key(s.editor, 'Backspace')
    expect(s.session.text).toBe('foo\n\n----\ncode\n----\n\nbar\n')
    synced(s)
  })
})

describe('Enter and Shift-Enter', () => {
  it('Enter in the middle of a paragraph makes two, with a blank line between', () => {
    const s = open('helloworld\n')
    select(s.editor, posIn(s.editor, 0, 5))
    key(s.editor, 'Enter')
    expect(s.session.text).toBe('hello\n\nworld\n')
    expect(shape(s.editor)).toBe('hello|world')
    expect(s.editor.view.state.selection.from).toBe(posIn(s.editor, 1, 0))
    synced(s)
  })

  it('Enter at the end of a heading gives an empty paragraph under it with the cursor; typing makes a paragraph one blank line under the heading', () => {
    const s = open('== Head\n\ntext\n')
    select(s.editor, posIn(s.editor, 0, 4))
    key(s.editor, 'Enter')
    expect(s.session.text).toBe('== Head\n\n\ntext\n')
    expect(shape(s.editor)).toBe('h2:Head||text')
    expect(s.editor.view.state.selection.from).toBe(posIn(s.editor, 1, 0))
    type(s.editor, 'new')
    expect(s.session.text).toBe('== Head\n\nnew\n\ntext\n')
    expect(shape(s.editor)).toBe('h2:Head|new|text')
    synced(s)
  })

  it('Enter in an empty paragraph adds another empty paragraph', () => {
    const s = open('a\n\n\nb\n')
    select(s.editor, posIn(s.editor, 1, 0))
    key(s.editor, 'Enter')
    expect(s.session.text).toBe('a\n\n\n\nb\n')
    expect(shape(s.editor)).toBe('a|||b')
    synced(s)
  })

  it('Enter in an island that starts with a second byte order mark leaves the screen as the text reads', () => {
    const s = open('﻿﻿= Document Title\ninclude::other.adoc[]\n= Document Title')
    select(s.editor, 19)
    key(s.editor, 'Enter')
    expect(s.session.text).toBe('﻿﻿= Document Title\n\ninclude::other.adoc[]\n= Document Title')
    synced(s)
  })

  it('Delete before a byte order mark inside an island does not turn it into the mark of the file', () => {
    const s = open('.﻿:idseparator: -')
    select(s.editor, 1)
    key(s.editor, 'Delete')
    expect(s.session.text).toBe('.﻿:idseparator: -')
    expect(s.rejects.at(-1)?.code).toBe('byte-order-mark')
    synced(s)
  })

  it('Backspace after a character before a byte order mark does not make that mark the mark of the file', () => {
    const s = open('x﻿y')
    select(s.editor, posIn(s.editor, 0, 1))
    key(s.editor, 'Backspace')
    expect(s.session.text).toBe('x﻿y')
    expect(s.rejects.at(-1)?.code).toBe('byte-order-mark')
    synced(s)
  })

  it('Delete before a character that precedes a byte order mark does not make that mark the mark of the file', () => {
    const s = open('x﻿y')
    select(s.editor, posIn(s.editor, 0, 0))
    key(s.editor, 'Delete')
    expect(s.session.text).toBe('x﻿y')
    expect(s.rejects.at(-1)?.code).toBe('byte-order-mark')
    synced(s)
  })

  it('Shift-Enter is a hard line break and a new line in the same paragraph', () => {
    const s = open('foobar\n')
    select(s.editor, posIn(s.editor, 0, 3))
    key(s.editor, 'Enter', { shift: true })
    expect(s.session.text).toBe('foo +\nbar\n')
    expect(shape(s.editor)).toBe('foo↵bar')
    expect(s.editor.view.state.selection.from).toBe(posIn(s.editor, 0, 4))
    synced(s)
  })
})

describe('marks', () => {
  const keys: [string, { shift?: boolean }, string, string][] = [
    ['b', {}, '*', '*'],
    ['i', {}, '_', '_'],
    ['e', {}, '`', '`'],
    ['x', { shift: true }, '[.line-through]#', '#'],
    ['h', { shift: true }, '#', '#'],
  ]
  for (const [k, mods, open_, close] of keys) {
    it(`Mod-${mods.shift ? 'Shift-' : ''}${k.toUpperCase()} wraps the selection in ${open_}…${close}, and again takes it off`, () => {
      const s = open('one two three\n')
      select(s.editor, posIn(s.editor, 0, 4), posIn(s.editor, 0, 7))
      key(s.editor, k, { mod: true, ...mods })
      expect(s.session.text).toBe(`one ${open_}two${close} three\n`)
      synced(s)
      expect(s.editor.view.state.selection.from).toBe(posIn(s.editor, 0, 4))
      expect(s.editor.view.state.selection.to).toBe(posIn(s.editor, 0, 7))
      key(s.editor, k, { mod: true, ...mods })
      expect(s.session.text).toBe('one two three\n')
      synced(s)
    })
  }

  it('inside a word the markers are doubled', () => {
    const s = open('abcdef\n')
    select(s.editor, posIn(s.editor, 0, 2), posIn(s.editor, 0, 4))
    s.editor.commands.toggleMark('strong')
    expect(s.session.text).toBe('ab**cd**ef\n')
    s.editor.commands.toggleMark('strong')
    expect(s.session.text).toBe('abcdef\n')
  })

  it('a selection over two paragraphs marks each of them', () => {
    const s = open('one two\n\nthree four\n')
    select(s.editor, posIn(s.editor, 0, 4), posIn(s.editor, 1, 5))
    key(s.editor, 'b', { mod: true })
    expect(s.session.text).toBe('one *two*\n\n*three* four\n')
    synced(s)
  })

  it('a selection that covers part of a mark makes it cover the union', () => {
    const s = open('*one* two three\n')
    select(s.editor, posIn(s.editor, 0, 2), posIn(s.editor, 0, 7))
    s.editor.commands.toggleMark('strong')
    expect(s.session.text).toBe('*one two* three\n')
    synced(s)
  })

  it('without a selection the command sets the mark for the next typing', () => {
    const s = open('one  three\n')
    select(s.editor, posIn(s.editor, 0, 4))
    key(s.editor, 'b', { mod: true })
    expect(s.session.text).toBe('one  three\n')
    type(s.editor, 'two')
    expect(s.session.text).toBe('one *two* three\n')
    synced(s)
  })
})

describe('links', () => {
  it('writes the link the way the target asks', () => {
    const cases: [string, string][] = [
      ['https://example.com/a', 'go https://example.com/a[here] now\n'],
      ['page.html', 'go link:page.html[here] now\n'],
      ['#intro', 'go <<intro,here>> now\n'],
      ['doc.adoc#intro', 'go xref:doc.adoc#intro[here] now\n'],
    ]
    for (const [target, text] of cases) {
      closeAll()
      const s = open('go here now\n')
      select(s.editor, posIn(s.editor, 0, 3), posIn(s.editor, 0, 7))
      expect(s.editor.commands.setLink(target)).toBe(true)
      expect(s.session.text).toBe(text)
      synced(s)
    }
  })

  it('escapes a `]` in the text of the link', () => {
    const s = open('a]b\n')
    select(s.editor, posIn(s.editor, 0, 0), posIn(s.editor, 0, 3))
    s.editor.commands.setLink('https://x.y')
    expect(s.session.text).toBe('https://x.y[a\\]b]\n')
    expect(textOf(s.editor, 0)).toBe('a]b')
  })

  it('on a link it changes only the target; removeLink leaves the text', () => {
    const s = open('see https://x.y[docs] now\n')
    select(s.editor, posIn(s.editor, 0, 6))
    s.editor.commands.setLink('https://new.y')
    expect(s.session.text).toBe('see https://new.y[docs] now\n')
    s.editor.commands.removeLink()
    expect(s.session.text).toBe('see docs now\n')
    synced(s)
  })

  it('a link over two paragraphs is refused: nothing changes and the host is told', () => {
    const s = open('one\n\ntwo\n')
    select(s.editor, posIn(s.editor, 0, 1), posIn(s.editor, 1, 2))
    const before = s.editor.view.state.doc
    expect(s.editor.commands.setLink('https://x.y')).toBe(false)
    expect(s.session.text).toBe('one\n\ntwo\n')
    expect(s.editor.view.state.doc.eq(before)).toBe(true)
    expect(s.rejects.length).toBe(1)
    expect(s.rejects[0]!.code).toBe('link-across-blocks')
    expect(s.rejects[0]!.message.length).toBeGreaterThan(5)
  })
})

describe('a mark or a link whose text is a blank that opens the paragraph', () => {
  it('taking it off is refused and the text stays, the host is told', () => {
    const s = open('https://a.b/c[ ]word rest\n')
    select(s.editor, posIn(s.editor, 0, 0))
    expect(s.editor.commands.removeLink()).toBe(false)
    expect(s.session.text).toBe('https://a.b/c[ ]word rest\n')
    expect(s.rejects.map((r) => r.code)).toEqual(['leading-blank'])
    const m = open('`` ``word rest\n')
    select(m.editor, posIn(m.editor, 0, 0), posIn(m.editor, 0, 1))
    expect(m.editor.commands.toggleMark('code')).toBe(false)
    expect(m.session.text).toBe('`` ``word rest\n')
    expect(m.rejects.map((r) => r.code)).toEqual(['leading-blank'])
    synced(m)
  })
})

describe('the style of a paragraph', () => {
  it('Mod-Alt-2…6 make headings, Mod-Alt-0 a paragraph; the text and the other blocks stay', () => {
    const s = open('term:: item\n\nfoo bar\nbaz\n\n----\ncode\n----\n')
    select(s.editor, posIn(s.editor, 1, 2))
    key(s.editor, '2', { mod: true, alt: true })
    expect(s.session.text).toBe('term:: item\n\n== foo bar baz\n\n----\ncode\n----\n')
    expect(shape(s.editor)).toBe('[chip]|h2:foo bar baz|[code]')
    key(s.editor, '4', { mod: true, alt: true })
    expect(s.session.text).toBe('term:: item\n\n==== foo bar baz\n\n----\ncode\n----\n')
    key(s.editor, '0', { mod: true, alt: true })
    expect(s.session.text).toBe('term:: item\n\nfoo bar baz\n\n----\ncode\n----\n')
    synced(s)
    for (const level of [2, 3, 4, 5, 6]) {
      key(s.editor, String(level), { mod: true, alt: true })
      expect(s.session.text).toContain(`${'='.repeat(level)} foo bar baz`)
    }
  })

  it('a change of level keeps the markers of a `##` heading', () => {
    const s = open('## Foo ##\n\nx\n')
    select(s.editor, posIn(s.editor, 0, 1))
    s.editor.commands.setBlockType('heading', 4)
    expect(s.session.text).toBe('#### Foo ####\n\nx\n')
    synced(s)
  })
})

describe('marks and links on a line that ends with ` + `', () => {
  const cases: [string, number, number, string, string][] = [
    ['aa + \n\nnext\n', 0, 0, '*aa* + \n\nnext\n', 'https://e.com[aa] + \n\nnext\n'],
    ['== Le + \n\nnext\n', 0, 0, '== *Le* + \n\nnext\n', '== https://e.com[Le] + \n\nnext\n'],
  ]
  for (const [text, block, k, bold, link] of cases) {
    const word = (s: Setup): void => select(s.editor, posIn(s.editor, block, k), posIn(s.editor, block, k + 2))
    it(`Mod-B on the word changes the markers only: ${JSON.stringify(text)}`, () => {
      const s = open(text)
      word(s)
      expect(key(s.editor, 'b', { mod: true })).toBe(true)
      expect(s.session.text).toBe(bold)
      synced(s)
    })
    it(`setLink on the word changes the link only: ${JSON.stringify(text)}`, () => {
      const s = open(text)
      word(s)
      expect(s.editor.commands.setLink('https://e.com')).toBe(true)
      expect(s.session.text).toBe(link)
      synced(s)
    })
  }
})

describe('the keys of Heading 2, Heading 3 and plain text', () => {
  const alt = (s: Setup, k: string): boolean => key(s.editor, k, { mod: true, alt: true })

  it('sets a level on the line under the cursor, and the same key again goes back; one step each', () => {
    const original = 'intro\r\n\r\n[[id]]\r\n.Cap\r\nСрок действия\r\n\r\nend\r\n'
    const s = open(original)
    select(s.editor, posIn(s.editor, 1, 2))
    alt(s, '2')
    expect(s.session.text).toContain('\r\n== Срок действия\r\n')
    alt(s, '3')
    expect(s.session.text).toContain('\r\n=== Срок действия\r\n')
    alt(s, '3')
    expect(s.session.text).toContain('\r\nСрок действия\r\n')
    alt(s, '2')
    alt(s, '2')
    expect(s.session.text).toBe(original)
    synced(s)
    for (let i = 0; i < 5; i++) s.editor.commands.undo()
    expect(s.session.text).toBe(original)
  })

  it('`##` markers are kept, and ⌘⌥0 on a paragraph is no step', () => {
    const s = open('## Foo ##\n\nx\n')
    select(s.editor, posIn(s.editor, 0, 1))
    alt(s, '3')
    expect(s.session.text).toBe('### Foo ###\n\nx\n')
    s.editor.commands.undo()
    expect(s.session.text).toBe('## Foo ##\n\nx\n')
    select(s.editor, posIn(s.editor, 1, 0))
    alt(s, '0')
    expect(s.session.text).toBe('## Foo ##\n\nx\n')
    s.editor.commands.undo()
    expect(s.session.text).toBe('## Foo ##\n\nx\n')
  })

  it('a level changes to another level, a heading is not made a paragraph by the other key; the list item of the panel does not toggle', () => {
    const s = open('=== X\n\nbody\n')
    select(s.editor, posIn(s.editor, 0, 1))
    alt(s, '2')
    expect(s.session.text).toBe('== X\n\nbody\n')
    s.editor.commands.setBlockType('heading', 2)
    expect(s.session.text).toBe('== X\n\nbody\n')
    alt(s, '5')
    alt(s, '5')
    expect(s.session.text).toBe('X\n\nbody\n')
  })

  it('a selection takes the paragraphs and the headings, skips list items and code; all of the level go back; one step', () => {
    const original = 'first para\n\n* item\n\nthird para\n\n----\ncode\n----\n'
    const s = open(original)
    select(s.editor, posIn(s.editor, 0, 4), posIn(s.editor, 2, 5))
    alt(s, '2')
    expect(s.session.text).toBe('== first para\n\n* item\n\n== third para\n\n----\ncode\n----\n')
    synced(s)
    s.editor.commands.undo()
    expect(s.session.text).toBe(original)
    s.editor.commands.redo()
    expect(s.session.text).toBe('== first para\n\n* item\n\n== third para\n\n----\ncode\n----\n')
    select(s.editor, posIn(s.editor, 0, 4), posIn(s.editor, 2, 5))
    alt(s, '2')
    expect(s.session.text).toBe(original)
    // a mixed selection becomes all of the level
    select(s.editor, posIn(s.editor, 0, 4), posIn(s.editor, 2, 5))
    alt(s, '3')
    select(s.editor, posIn(s.editor, 0, 4), posIn(s.editor, 2, 5))
    alt(s, '2')
    expect(s.session.text).toBe('== first para\n\n* item\n\n== third para\n\n----\ncode\n----\n')
  })

  it('an empty line takes a draft that is not written, the first letter writes it, the key again takes it back', () => {
    const s = open('a\n\n\n\nb\n')
    const before = s.session.text
    const e = s.editor.view.state.doc.content.size
    expect(e).toBeGreaterThan(0)
    select(s.editor, posIn(s.editor, 1, 0))
    alt(s, '2')
    expect(shape(s.editor)).toContain('h2:')
    expect(s.session.text).toBe(before)
    alt(s, '2')
    expect(shape(s.editor)).not.toContain('h2:')
    expect(s.session.text).toBe(before)
    alt(s, '3')
    alt(s, '2')
    expect(shape(s.editor)).toContain('h2:')
    type(s.editor, 'А')
    expect(s.session.text).toContain('== А')
  })

  it('with «/» open the keys pick Heading 2 and Heading 3, and ⌘⌥0 does nothing', () => {
    const s = open('a\n\n\n\nb\n')
    select(s.editor, posIn(s.editor, 1, 0))
    type(s.editor, '/заг')
    expect(s.editor.slashAt()).not.toBeNull()
    alt(s, '0')
    expect(s.editor.slashAt()).not.toBeNull()
    alt(s, '3')
    expect(s.editor.slashAt()).toBeNull()
    expect(shape(s.editor)).toContain('h3:')
  })

  it('in a list item, a cell, an admonition: no change and the refusal of the style; ⌘⌥0 and code: nothing', () => {
    const cases: [string, string | null][] = [['* item\n', null], ['|===\n|a\n|===\n', 'a'], ['|===\na|\n* x\n|===\n', 'x'], ['NOTE: text\n', null]]
    for (const [text, cell] of cases) {
      const s = open(text)
      if (cell) inCell(s.editor, cell)
      else select(s.editor, posIn(s.editor, 0, 1))
      alt(s, '2')
      expect(s.session.text).toBe(text)
      expect(s.rejects.map((r) => r.code)).toEqual(['style-off'])
      alt(s, '0')
      expect(s.rejects).toHaveLength(1)
      expect(s.session.text).toBe(text)
      closeAll()
    }
    const code = open('----\ncode\n----\n')
    select(code.editor, posIn(code.editor, 0, 1))
    alt(code, '2')
    expect(code.session.text).toBe('----\ncode\n----\n')
    expect(code.rejects).toHaveLength(0)
    closeAll()
    const t = open('= Title\n\nbody\n')
    select(t.editor, posIn(t.editor, 0, 1))
    alt(t, '2')
    expect(t.session.text).toBe('= Title\n\nbody\n')
    expect(t.rejects.map((r) => r.code)).toEqual(['document-title'])
  })

  it('Ctrl+Alt with a digit key that gives another sign is not taken (AltGr)', () => {
    const s = open('word\n')
    select(s.editor, posIn(s.editor, 0, 1))
    const ev = new KeyboardEvent('keydown', { key: '²', keyCode: 50, ctrlKey: true, altKey: true, bubbles: true, cancelable: true })
    s.editor.view.dom.dispatchEvent(ev)
    expect(ev.defaultPrevented).toBe(false)
    expect(s.session.text).toBe('word\n')
  })
})
