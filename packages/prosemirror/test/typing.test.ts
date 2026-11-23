// typing, escaping, IME, foreign steps and history.
import { afterEach, describe, expect, it } from 'vitest'
import { renderHtml } from '@nota-adoc/html'
import { createSourceEditor } from '@nota-adoc/codemirror'
import { projectDocument, schema } from '@nota-adoc/prosemirror'
import { closeAll, composition, key, open, posIn, select, shape, textOf, type } from './helpers.js'

afterEach(closeAll)

describe('typing', () => {
  it('puts the typed characters in the text at the place and touches nothing else, and a source editor shows it at once', () => {
    const { editor, session, el } = open('= T\n\nпривет мир\n\nend\n')
    const host = document.createElement('div')
    el.after(host)
    const source = createSourceEditor(host, { session })
    select(editor, posIn(editor, 1, 7))
    type(editor, 'дорогой ')
    expect(session.text).toBe('= T\n\nпривет дорогой мир\n\nend\n')
    expect(source.getText()).toBe(session.text)
    expect(textOf(editor, 1)).toBe('привет дорогой мир')
    type(editor, '123')
    expect(session.text).toBe('= T\n\nпривет дорогой 123мир\n\nend\n')
    source.destroy()
  })

  it('a character typed in the document title under an anchor goes in the title, the anchor stays', () => {
    const { editor, session, rejects } = open('[[top]]\n= Заголовок\n\nАбзац.\n')
    select(editor, posIn(editor, 0, 3))
    type(editor, 'XY')
    expect(rejects).toEqual([])
    expect(session.text).toBe('[[top]]\n= ЗагXYоловок\n\nАбзац.\n')
    expect(editor.view.state.doc.child(0).attrs.anchor).toBe('top')
  })

  // every kind of metadata the header keeps before the title (blocks.ts metadataRun, header = true)
  it.each([
    ['comment before the anchor', '// c\n[[top]]\n= Заголовок\n\nАбзац.\n'],
    ['attribute entry before the anchor', ':toc:\n[[top]]\n= Заголовок\n\nАбзац.\n'],
    ['blank line and comment before the anchor', '// c\n\n[[top]]\n= Заголовок\n\nАбзац.\n'],
    ['two anchors', '[[a]]\n[[b]]\n= Заголовок\n\nАбзац.\n'],
    ['block attributes and anchor', '[.lead]\n[[x]]\n= Заголовок\n\nАбзац.\n'],
    ['comment between the anchor and the title', '[[top]]\n// c\n= Заголовок\n\nАбзац.\n'],
    ['entry between the anchor and the title', '[[top]]\n:toc:\n= Заголовок\n\nАбзац.\n'],
    ['block comment before the anchor', '////\nc\n////\n[[top]]\n= Заголовок\n\nАбзац.\n'],
    ['multiline attribute before the anchor', ':desc: a \\\n  b\n[[top]]\n= Заголовок\n\nАбзац.\n'],
    ['comment only', '// c\n= Заголовок\n\nАбзац.\n'],
    ['no metadata', '= Заголовок\n\nАбзац.\n'],
  ])('a character typed in the document title goes in the title: %s', (_n, src) => {
    const { editor, session, rejects } = open(src)
    let idx = -1
    editor.view.state.doc.forEach((node, _o, i) => {
      if (node.textContent === 'Заголовок') idx = i
    })
    expect(idx).toBeGreaterThanOrEqual(0)
    select(editor, posIn(editor, idx, 3))
    type(editor, 'XY')
    expect(rejects).toEqual([])
    expect(session.text).toBe(src.replace('Заголовок', 'ЗагXYоловок'))
  })

  // a block title over `= Title` makes it an island (as on main): the whole head is one island, the anchor does not split it
  it.each(['.Cap\n[[x]]\n= Заголовок\n\nА\n', '[[x]]\n.Cap\n= Заголовок\n\nА\n', ':toc:\n// c\n[[x]]\n.Cap\n= Заголовок\n\nА\n'])(
    'a document title with a block title stays one island with its metadata: %j',
    (src) => {
      const { editor } = open(src)
      const first = editor.view.state.doc.child(0)
      expect(first.type.name).toBe('island')
      expect(first.textContent).toBe(src.slice(0, src.indexOf('Заголовок') + 9))
    },
  )

  it('a character typed at the end of a bold word goes inside the markers; in the text of a link it stays in the link', () => {
    const { editor, session } = open('a *bold* b https://x.y[link] c')
    select(editor, posIn(editor, 0, 6)) // after "a bold"
    type(editor, 'er')
    expect(session.text).toBe('a *bolder* b https://x.y[link] c')
    select(editor, posIn(editor, 0, 'a bolder b li'.length))
    type(editor, 'X')
    expect(session.text).toBe('a *bolder* b https://x.y[liXnk] c')
    // at the end of a link the text is not in the link
    select(editor, posIn(editor, 0, 'a bolder b liXnk'.length))
    type(editor, '!')
    expect(session.text).toBe('a *bolder* b https://x.y[liXnk]! c')
    expect(shape(editor)).toBe('a <strong>bolder</> b <link>liXnk</>! c')
  })

  it('types over a selection and deletes a stretch of text inside a block', () => {
    const { editor, session } = open('one two three')
    select(editor, posIn(editor, 0, 4), posIn(editor, 0, 7))
    type(editor, 'TWO')
    expect(session.text).toBe('one TWO three')
    editor.view.dispatch(editor.view.state.tr.delete(posIn(editor, 0, 3), posIn(editor, 0, 7)))
    expect(session.text).toBe('one three')
  })

  it('does not change the text while an input method composes; after it ends the text has one replacement, and one Mod-Z takes it back', () => {
    const { editor, session } = open('hello world')
    const changes: unknown[] = []
    session.subscribe((e) => changes.push(e))
    select(editor, posIn(editor, 0, 5))
    composition(editor, 'compositionstart')
    const { state } = editor.view
    editor.view.dispatch(state.tr.insertText('п'))
    editor.view.dispatch(editor.view.state.tr.insertText('р', posIn(editor, 0, 6)))
    editor.view.dispatch(editor.view.state.tr.insertText('ив', posIn(editor, 0, 7)))
    expect(session.text).toBe('hello world')
    expect(changes.length).toBe(0)
    composition(editor, 'compositionend')
    expect(session.text).toBe('helloприв world')
    expect(changes.length).toBe(1)
    expect(textOf(editor, 0)).toBe('helloприв world')
    key(editor, 'z', { mod: true })
    expect(session.text).toBe('hello world')
    expect(textOf(editor, 0)).toBe('hello world')
    expect(session.canUndo).toBe(false)
  })
})

describe('escaping in place', () => {
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
  ]
  // the place in the block: before a letter, before a space, at the end of the paragraph
  // (a blank at the end of the paragraph is not in the text, so it is typed before the string)
  const places: [before: string, after: string, lead: string][] = [
    ['some ', 'text here', ''],
    ['some', ' text here', ''],
    ['some text', '', ''],
    ['some text', '', ' '],
  ]
  for (const typed of strings)
    for (const [before, after, lead] of places) {
      it(`shows ${JSON.stringify(typed)} as typed after ${JSON.stringify(before + lead)} and before ${JSON.stringify(after)}, plain, and the HTML has it literally; the other blocks stay`, () => {
        const { editor, session, inexact } = open(`first *a* block\n\n${before}${after}\n\nlast _b_ block\n`)
        select(editor, posIn(editor, 1, before.length))
        type(editor, lead + typed)
        const expected = `${before}${lead}${typed}${after}`
        expect(textOf(editor, 1)).toBe(expected)
        expect(inexact).toEqual([])
        // no marks and no plates in the block
        let plain = true
        editor.view.state.doc.child(1).forEach((c) => {
          if (!c.isText || c.marks.length) plain = false
        })
        expect(plain).toBe(true)
        const html = renderHtml(session.doc)
        const para = html.split('<div class="paragraph">').filter((p) => p.includes('some'))[0]!
        expect(para).not.toMatch(/<(strong|em|code|mark|a)[ >]/)
        const seen = para
          .replace(/<[^>]*>/g, '')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&#43;/g, '+')
          .replace(/&amp;/g, '&')
          .trim()
        expect(seen).toBe(expected)
        expect(session.text.startsWith('first *a* block\n\n')).toBe(true)
        expect(session.text.endsWith('\n\nlast _b_ block\n')).toBe(true)
        expect(editor.view.state.doc.eq(projectDocument(session.doc))).toBe(true)
      })
    }

  it('types " + b" at the end of a paragraph: what is on the screen is what was typed at every step, the text has no line break', () => {
    const { editor, session, inexact } = open('some text\n')
    select(editor, posIn(editor, 0, 9))
    const steps: [string, string, string][] = []
    for (const ch of ' + b') {
      type(editor, ch)
      steps.push([textOf(editor, 0), session.text, shape(editor)])
      expect(editor.view.state.doc.eq(projectDocument(session.doc))).toBe(true)
    }
    expect(steps).toEqual([
      ['some text ', 'some text \n', 'some text '],
      ['some text +', 'some text {plus}\n', 'some text +'],
      ['some text + ', 'some text {plus} \n', 'some text + '],
      ['some text + b', 'some text + b\n', 'some text + b'],
    ])
    expect(inexact).toEqual([])
    // undo takes the typing back step by step, to the text as it was
    key(editor, 'z', { mod: true })
    expect(session.text.startsWith('some text')).toBe(true)
    while (session.canUndo) key(editor, 'z', { mod: true })
    expect(session.text).toBe('some text\n')
  })

  it('a star typed at the end of a bold word makes the star part of the word, not a new mark', () => {
    const { editor, session } = open('a *bold* b')
    select(editor, posIn(editor, 0, 6))
    type(editor, '*')
    expect(textOf(editor, 0)).toBe('a bold* b')
    expect(renderHtml(session.doc)).toContain('<strong>bold</strong>* b')
    expect(editor.view.state.doc.eq(projectDocument(session.doc))).toBe(true)
  })
})

describe('a composition whose end is lost', () => {
  it('ends when the editor loses focus, so that the text of the session shows again', () => {
    const { editor, session } = open('hello world\n')
    select(editor, posIn(editor, 0, 5))
    composition(editor, 'compositionstart')
    editor.view.dom.dispatchEvent(new FocusEvent('blur'))
    session.apply([{ from: 0, insert: 'X' }])
    expect(textOf(editor, 0)).toBe('Xhello world')
    expect(editor.view.state.doc.eq(projectDocument(session.doc))).toBe(true)
  })
})

describe('a composition while the text changes elsewhere', () => {
  it('keeps what was composed when the source changes the text before the composition ends (the window blurs)', () => {
    const { editor, session } = open('hello world\n\nnext\n')
    select(editor, posIn(editor, 0, 5))
    composition(editor, 'compositionstart')
    const { view } = editor
    view.dispatch(view.state.tr.insertText('привет', posIn(editor, 0, 5)))
    expect(session.text).toBe('hello world\n\nnext\n')
    // the person goes to the source and types there: the composition is held off the screen, not lost
    session.apply([{ from: 0, insert: 'X' }])
    session.apply([{ from: session.text.length, insert: '\nend\n' }])
    view.dom.dispatchEvent(new FocusEvent('blur'))
    expect(session.text).toBe('Xhelloпривет world\n\nnext\n\nend\n')
    expect(shape(editor)).toBe('Xhelloпривет world|next|end')
    expect(editor.view.state.doc.eq(projectDocument(session.doc))).toBe(true)
    // one step of the history takes the composed text back
    session.undo()
    expect(session.text).toBe('Xhello world\n\nnext\n\nend\n')
    expect(editor.view.state.doc.eq(projectDocument(session.doc))).toBe(true)
  })
})

describe('a composition with text typed while the text changed elsewhere, ended by compositionend', () => {
  const inSync = (
    editor: ReturnType<typeof open>['editor'],
    session: ReturnType<typeof open>['session'],
  ): boolean => editor.view.state.doc.eq(projectDocument(session.doc))

  it('the cursor is after what was composed, the next letter goes there (the text changed before it)', () => {
    const { editor, session } = open('hello world\n\nnext block\n\nlast\n')
    select(editor, posIn(editor, 0, 5))
    composition(editor, 'compositionstart')
    const { view } = editor
    view.dispatch(view.state.tr.insertText('пр', posIn(editor, 0, 5)))
    session.apply([{ from: 0, insert: 'AB' }])
    composition(editor, 'compositionend')
    expect(session.text).toBe('ABhelloпр world\n\nnext block\n\nlast\n')
    expect(inSync(editor, session)).toBe(true)
    type(editor, 'z')
    expect(session.text).toBe('ABhelloпрz world\n\nnext block\n\nlast\n')
    expect(inSync(editor, session)).toBe(true)
  })

  it('the same when the text changed in another block', () => {
    const { editor, session } = open('hello world\n\nnext block\n\nlast\n')
    select(editor, posIn(editor, 0, 5))
    composition(editor, 'compositionstart')
    const { view } = editor
    view.dispatch(view.state.tr.insertText('пр', posIn(editor, 0, 5)))
    session.apply([{ from: session.text.indexOf('next'), insert: 'ZZ' }])
    composition(editor, 'compositionend')
    expect(session.text).toBe('helloпр world\n\nZZnext block\n\nlast\n')
    expect(inSync(editor, session)).toBe(true)
    type(editor, 'z')
    expect(session.text).toBe('helloпрz world\n\nZZnext block\n\nlast\n')
    expect(inSync(editor, session)).toBe(true)
  })

  it('text that equals what is after it is put in where the composition began', () => {
    const { editor, session } = open('приве\n\nlast\n')
    select(editor, posIn(editor, 0, 0))
    composition(editor, 'compositionstart')
    const { view } = editor
    view.dispatch(view.state.tr.insertText('привет', posIn(editor, 0, 0)))
    session.apply([{ from: 0, insert: 'x' }])
    composition(editor, 'compositionend')
    expect(session.text).toBe('xпривет' + 'приве\n\nlast\n')
    type(editor, 'z')
    expect(session.text).toBe('xпривет' + 'z' + 'приве\n\nlast\n')
    expect(inSync(editor, session)).toBe(true)
  })

  it('a replaced range: the cursor is after the composed text', () => {
    const { editor, session } = open('hello world\n\nlast\n')
    select(editor, posIn(editor, 0, 0), posIn(editor, 0, 5))
    composition(editor, 'compositionstart')
    const { view } = editor
    view.dispatch(view.state.tr.insertText('пр', posIn(editor, 0, 0), posIn(editor, 0, 5)))
    session.apply([{ from: 0, insert: 'AB' }])
    composition(editor, 'compositionend')
    expect(session.text).toBe('ABпр world\n\nlast\n')
    type(editor, 'z')
    expect(session.text).toBe('ABпрz world\n\nlast\n')
    expect(inSync(editor, session)).toBe(true)
  })
})

describe('a composition while the source glues two blocks', () => {
  // the minimal counterexample of `npm run fuzz -- --property editor/actions --seed 55555`, on synthetic text: the
  // source replaces the end of the first paragraph and the blank line with `----` while «x» is composed at the start
  // of the second; the first paragraph is printed again with a marker doubled, and it is text before the cursor
  it('after compositionend the text before the cursor ends with what was composed, and the next «z» is right after it', () => {
    const { editor, session } = open('[.line-through]##Text\u2028##\n\n[.line-through]#more# text\n')
    select(editor, posIn(editor, 1, 0))
    composition(editor, 'compositionstart')
    editor.view.dispatch(editor.view.state.tr.insertText('x', posIn(editor, 1, 0)))
    const from = session.text.indexOf('##\n\n') + 1
    session.apply([{ from, to: from + 3, insert: '----\n' }], { origin: 'source' })
    composition(editor, 'compositionend')
    expect(session.text).toContain('x')
    expect(editor.view.state.doc.eq(projectDocument(session.doc))).toBe(true)
    const { from: at } = editor.view.state.selection
    expect(editor.view.state.doc.textBetween(0, at, '\n', '\ufffc').endsWith('x')).toBe(true)
    type(editor, 'z')
    expect(session.text).toContain('xz')
    expect(editor.view.state.doc.eq(projectDocument(session.doc))).toBe(true)
  })
})

describe('a composition that ends with nothing typed while the text changed elsewhere', () => {
  const inSync = (
    editor: ReturnType<typeof open>['editor'],
    session: ReturnType<typeof open>['session'],
  ): boolean => editor.view.state.doc.eq(projectDocument(session.doc))

  it('cancelled composition: the screen catches up with the text, and the next key goes to the right place', () => {
    const { editor, session } = open('hello world\n')
    select(editor, posIn(editor, 0, 5))
    composition(editor, 'compositionstart')
    session.apply([{ from: 0, insert: 'X' }])
    composition(editor, 'compositionend')
    expect(textOf(editor, 0)).toBe('Xhello world')
    expect(inSync(editor, session)).toBe(true)
    type(editor, 'z')
    expect(session.text).toBe('Xhelloz world\n')
    expect(inSync(editor, session)).toBe(true)
  })

  it('the text shrank meanwhile: no error at the next key, the screen is the projection', () => {
    const { editor, session } = open('hello world, and more\n')
    select(editor, posIn(editor, 0, 20))
    composition(editor, 'compositionstart')
    session.apply([{ from: 5, to: session.text.length - 1 }])
    editor.view.dom.dispatchEvent(new FocusEvent('blur'))
    expect(session.text).toBe('hello\n')
    expect(inSync(editor, session)).toBe(true)
    select(editor, posIn(editor, 0, 5))
    expect(() => type(editor, '!')).not.toThrow()
    expect(session.text).toBe('hello!\n')
    expect(inSync(editor, session)).toBe(true)
  })

  it('what the text did during a cancelled composition is not carried into the next composition', () => {
    const { editor, session } = open('hello world\n')
    select(editor, posIn(editor, 0, 5))
    composition(editor, 'compositionstart')
    session.apply([{ from: 0, insert: 'XXXX' }])
    composition(editor, 'compositionend')
    select(editor, posIn(editor, 0, 9))
    composition(editor, 'compositionstart')
    editor.view.dispatch(editor.view.state.tr.insertText('ж', posIn(editor, 0, 9)))
    composition(editor, 'compositionend')
    expect(session.text).toBe('XXXXhelloж world\n')
    expect(inSync(editor, session)).toBe(true)
  })

  it('a composition that changed two blocks is not taken, the text changed elsewhere shows, and the next key is at its place', () => {
    const { editor, session } = open('one\n\ntwo\n\nthree\n')
    select(editor, posIn(editor, 0, 3))
    composition(editor, 'compositionstart')
    const { view } = editor
    view.dispatch(view.state.tr.insertText('a', posIn(editor, 0, 3)))
    view.dispatch(view.state.tr.insertText('b', posIn(editor, 1, 3)))
    session.apply([{ from: 0, insert: 'X' }])
    composition(editor, 'compositionend')
    expect(session.text).toBe('Xone\n\ntwo\n\nthree\n')
    expect(shape(editor)).toBe('Xone|two|three')
    expect(inSync(editor, session)).toBe(true)
    select(editor, posIn(editor, 2, 5))
    type(editor, '!')
    expect(session.text).toBe('Xone\n\ntwo\n\nthree!\n')
    expect(inSync(editor, session)).toBe(true)
  })
})

describe('text that would become a plate (a list, a code block, …)', () => {
  it('typing a blank after a star at the start of a paragraph is refused, and the text stays', () => {
    const { editor, session, rejects } = open('one\n\n*item\n\nthree\n')
    select(editor, posIn(editor, 1, 1))
    type(editor, ' ')
    expect(rejects.map((r) => r.code)).toEqual(['becomes-plate'])
    expect(session.text).toBe('one\n\n*item\n\nthree\n')
    expect(editor.view.state.doc.eq(projectDocument(session.doc))).toBe(true)
  })

  it('deleting the letter in front of "* " that would make the paragraph a list is refused the same way', () => {
    const { editor, session, rejects } = open('one\n\nx* item\n\nthree\n')
    select(editor, posIn(editor, 1, 1))
    key(editor, 'Backspace')
    expect(rejects.map((r) => r.code)).toEqual(['becomes-plate'])
    expect(session.text).toBe('one\n\nx* item\n\nthree\n')
    expect(shape(editor)).toBe('one|x* item|three')
    expect(editor.view.state.doc.eq(projectDocument(session.doc))).toBe(true)
  })

  it('a deletion across blocks that glues the rest of a paragraph to "* " is refused too, and the text stays', () => {
    const { editor, session, rejects } = open('one\n\nabc* item\n\nthree\n')
    select(editor, posIn(editor, 0, 0), posIn(editor, 1, 3))
    key(editor, 'Backspace')
    expect(rejects.map((r) => r.code)).toEqual(['becomes-plate'])
    expect(session.text).toBe('one\n\nabc* item\n\nthree\n')
    expect(shape(editor)).toBe('one|abc* item|three')
    expect(editor.view.state.doc.eq(projectDocument(session.doc))).toBe(true)
  })

  it('a deletion across blocks that takes a plate away with them is not refused', () => {
    const { editor, session, rejects } = open('one\n\n* item\n\nthree\n')
    select(editor, posIn(editor, 0, 1), posIn(editor, 2, 2))
    key(editor, 'Backspace')
    expect(rejects).toEqual([])
    expect(session.text).toBe('o' + 'ree\n')
  })

  it('deleting all the text of a paragraph is not refused', () => {
    const { editor, session, rejects } = open('one\n\nab\n\nthree\n')
    select(editor, posIn(editor, 1, 0), posIn(editor, 1, 2))
    key(editor, 'Backspace')
    expect(rejects).toEqual([])
    expect(session.text).toBe('one\n\n\nthree\n')
  })
})

describe('steps that are not the editor’s', () => {
  it('does not apply a step that changes the structure, marks or blocks; the document and the text stay', () => {
    const { editor, session } = open('one\n\ntwo *b*\n\nthree')
    const doc = editor.view.state.doc
    const text = session.text
    const { view } = editor
    view.dispatch(view.state.tr.insert(1, schema.nodes.paragraph!.create()))
    expect(view.state.doc.eq(doc)).toBe(true)
    view.dispatch(view.state.tr.addMark(1, 3, schema.marks.strong!.create()))
    expect(view.state.doc.eq(doc)).toBe(true)
    view.dispatch(view.state.tr.replace(posIn(editor, 0, 2), posIn(editor, 1, 1)))
    expect(view.state.doc.eq(doc)).toBe(true)
    view.dispatch(view.state.tr.delete(0, doc.child(0).nodeSize))
    expect(view.state.doc.eq(doc)).toBe(true)
    expect(session.text).toBe(text)
  })

  it('a replacement of plain text inside one block, from any source, goes the way of typing', () => {
    const { editor, session } = open('one\n\ntwo *b*\n\nthree')
    const { view } = editor
    view.dispatch(view.state.tr.replaceWith(posIn(editor, 0, 1), posIn(editor, 0, 2), schema.text('N')))
    expect(session.text).toBe('oNe\n\ntwo *b*\n\nthree')
    view.dispatch(view.state.tr.insertText('X', posIn(editor, 1, 4)))
    expect(session.text).toBe('oNe\n\ntwo X**b**\n\nthree')
    expect(editor.view.state.doc.eq(projectDocument(session.doc))).toBe(true)
  })

  it('plain text put into an empty paragraph from any source goes the way of typing', () => {
    const { editor, session, rejects } = open('one\n\n\nthree\n')
    const { view } = editor
    expect(shape(editor)).toBe('one||three')
    view.dispatch(view.state.tr.insertText('mid', posIn(editor, 1, 0)))
    expect(session.text).toBe('one\n\nmid\n\nthree\n')
    expect(rejects).toEqual([])
    expect(editor.view.state.doc.eq(projectDocument(session.doc))).toBe(true)
  })

  it('marks on the text of a foreign step into an empty paragraph are not written: a mark comes only from a command', () => {
    const { editor, session } = open('one\n\n\nthree\n')
    const { view } = editor
    view.dispatch(
      view.state.tr.replaceWith(
        posIn(editor, 1, 0),
        posIn(editor, 1, 0),
        schema.text('mid', [schema.marks.strong!.create()]),
      ),
    )
    expect(session.text).toBe('one\n\nmid\n\nthree\n')
    expect(shape(editor)).toBe('one|mid|three')
    expect(editor.view.state.doc.eq(projectDocument(session.doc))).toBe(true)
  })
})

describe('history', () => {
  it('Mod-Z, Mod-Shift-Z and Mod-Y ask the session; typing, an edit in the source and a mark undo one by one, back to the first text', () => {
    const { editor, session, el } = open('hello world\n')
    const host = document.createElement('div')
    el.after(host)
    const source = createSourceEditor(host, { session })
    const first = session.text
    select(editor, posIn(editor, 0, 5))
    type(editor, '!')
    source.view.dispatch({ changes: { from: 0, insert: 'X' } })
    editor.commands.toggleMark('strong')
    select(editor, posIn(editor, 0, 0), posIn(editor, 0, 2))
    expect(session.canUndo).toBe(true)
    const texts = [session.text]
    editor.commands.toggleMark('strong')
    texts.push(session.text)
    while (key(editor, 'z', { mod: true })) {
      if (!session.canUndo) break
    }
    // steps went back in the reverse order to the first text
    expect(session.text).toBe(first)
    expect(editor.view.state.doc.eq(projectDocument(session.doc))).toBe(true)
    const undone = session.text
    key(editor, 'z', { mod: true, shift: true })
    expect(session.text).not.toBe(undone)
    key(editor, 'y', { mod: true })
    expect(session.canRedo).toBe(true)
    while (session.canRedo) key(editor, 'y', { mod: true })
    expect(session.text).toBe(texts[1])
    source.destroy()
  })

  it('the browser menu Undo and Redo (beforeinput) do the same', () => {
    const { editor, session } = open('hello')
    select(editor, posIn(editor, 0, 5))
    type(editor, '!')
    expect(session.text).toBe('hello!')
    editor.view.dom.dispatchEvent(
      new InputEvent('beforeinput', { inputType: 'historyUndo', bubbles: true, cancelable: true }),
    )
    expect(session.text).toBe('hello')
    editor.view.dom.dispatchEvent(
      new InputEvent('beforeinput', { inputType: 'historyRedo', bubbles: true, cancelable: true }),
    )
    expect(session.text).toBe('hello!')
  })

  it('after an undo the cursor stands where the undone edit was', () => {
    const { editor, session } = open('one two three')
    select(editor, posIn(editor, 0, 7))
    type(editor, 'XY')
    select(editor, posIn(editor, 0, 0))
    expect(session.text).toBe('one twoXY three')
    key(editor, 'z', { mod: true })
    expect(session.text).toBe('one two three')
    expect(editor.view.state.selection.from).toBe(posIn(editor, 0, 7))
  })
})

describe('an edit in a paragraph that holds a line that decides which lines exist', () => {
  it('deleting it changes how the blocks below read: the screen shows them as the text reads', () => {
    // the paragraph holds `ifdef::attr[]` (read before the blocks: it disables what follows, up to the end)
    const { editor, session } = open('xpass:[unclosed and stem:[a\nifdef::attr[]\n\\ifdef::attr[]\n[verse]')
    expect(shape(editor)).toBe('x⟦chip⟧|[chip]')
    select(editor, editor.view.state.doc.child(0).nodeSize - 1)
    editor.commands.deleteBackward()
    expect(session.text).toBe('x\n[verse]')
    expect(editor.view.state.doc.eq(projectDocument(session.doc))).toBe(true)
  })
})

describe('a break with blanks after the plus', () => {
  const cases: [string, string, string, number, number, string][] = [
    ['а) blank after the plus', 'aa + \n\nnext\n', 'Xaa + \n\nnext\n', 0, 0, 'Xaa↵|next'],
    ['б) tab after the plus', 'aa +\t\n\nnext\n', 'Xaa +\t\n\nnext\n', 0, 0, 'Xaa↵|next'],
    ['в) a paragraph of two lines', 'aa + \nbb\n', 'Xaa + \nbb\n', 0, 0, 'Xaa↵bb'],
    ['г) a heading', '== Le + \n\nnext\n', '== XLe + \n\nnext\n', 0, 0, 'h2:XLe↵|next'],
  ]
  for (const [name, text, expected, i, k, shown] of cases) {
    it(`typing X at the start changes the text by that letter only: ${name}`, () => {
      const { editor, session } = open(text)
      select(editor, posIn(editor, i, k))
      type(editor, 'X')
      expect(session.text).toBe(expected)
      expect(editor.view.state.doc.eq(projectDocument(session.doc))).toBe(true)
      expect(shape(editor)).toBe(shown)
    })
  }

  it('a blank typed after the break at the end of a block is not shown, the text changes and the screen is the projection', () => {
    const { editor, session, rejects } = open('aa +\n')
    select(editor, posIn(editor, 0, 3))
    type(editor, ' ')
    expect(session.text).not.toBe('aa +\n')
    expect(rejects).toEqual([])
    expect(editor.view.state.doc.eq(projectDocument(session.doc))).toBe(true)
  })
})

describe('a plus typed after a plate that holds a plus (fuzz seed 28)', () => {
  // `[ +quo[.r]##=##te` is read as one plate (the attributes of the quote reach back to the `[`), and its source has
  // an opening ` +`: a plain `+` typed after the `{a}` closes it, and no way of writing the `+` reads as typed.
  const text = ':[ +quo[.line-through]##=##te,{a}'

  it('is written as typed, the editor says it cannot read as typed (onInexact), the screen is the projection, and one Mod-Z takes it back byte for byte', () => {
    const { editor, session, rejects, inexact } = open(text)
    expect(editor.view.state.doc.eq(projectDocument(session.doc))).toBe(true)
    const n = editor.view.state.doc.child(0).content.size
    select(editor, posIn(editor, 0, n))
    type(editor, '+')
    expect(rejects).toEqual([])
    expect(inexact.length).toBe(1)
    expect(session.text).toBe(text + '+')
    expect(editor.view.state.doc.eq(projectDocument(session.doc))).toBe(true)
    key(editor, 'z', { mod: true })
    expect(session.text).toBe(text)
    expect(editor.view.state.doc.eq(projectDocument(session.doc))).toBe(true)
  })

  it('after a blank the plus is written exactly as typed, with no complaint', () => {
    const { editor, rejects, inexact } = open(':[ +quo te, ')
    const n = editor.view.state.doc.child(0).content.size
    select(editor, posIn(editor, 0, n))
    type(editor, '+')
    expect(rejects).toEqual([])
    expect(inexact).toEqual([])
    expect(textOf(editor, 0)).toBe(':[ +quo te, +')
  })
})

describe('the end of a composition after an edit in the source', () => {
  /** A composition at the start of a paragraph while the source edit makes its place a block of another kind. */
  function compose(before: (editor: ReturnType<typeof open>['editor']) => void, word: string) {
    const o = open('\nplus z\n\n')
    const { editor, session } = o
    select(editor, posIn(editor, 1, 0))
    before(editor)
    composition(editor, 'compositionstart')
    const { view } = editor
    view.dispatch(view.state.tr.insertText(word))
    // the person edits the text in the source: the first letter of the paragraph becomes a block line
    session.apply([{ from: 1, to: 2, insert: '----\n' }], { origin: 'source' })
    composition(editor, 'compositionend')
    return o
  }

  const beforeCursor = (editor: ReturnType<typeof open>['editor']) => {
    const { doc, selection } = editor.view.state
    return doc.textBetween(0, selection.from, '\n', '￼')
  }

  it('the cursor stands right after the composed «x» after a mark was put at the caret', () => {
    const { editor, session } = compose((e) => e.commands.toggleMark('strong'), 'x')
    expect(session.text).toBe('x\n\n----\nlus z\n\n')
    const { from, to } = editor.view.state.selection
    expect(from).toBe(to)
    expect(beforeCursor(editor)).toBe('x')
    type(editor, 'z')
    expect(session.text).toBe('xz\n\n----\nlus z\n\n')
  })

  it('the same after a text was typed at the caret before the composition', () => {
    const o = open('\nplus z\n\n')
    const { editor, session } = o
    select(editor, posIn(editor, 1, 0))
    type(editor, 'q')
    composition(editor, 'compositionstart')
    editor.view.dispatch(editor.view.state.tr.insertText('x'))
    const at = session.text.indexOf('plus')
    session.apply([{ from: at, to: at + 1, insert: '----\n' }], { origin: 'source' })
    composition(editor, 'compositionend')
    expect(session.text).toBe('\nqx----\nlus z\n\n')
    expect(beforeCursor(editor)).toBe('\nqx')
    type(editor, 'z')
    expect(session.text).toBe('\nqxz----\nlus z\n\n')
  })

  it.each([
    ['{', '{\n\n----\nlus z\n\n'],
    ['*', '*\n\n----\nlus z\n\n'],
    ['a*b*', 'a*b*\n\n----\nlus z\n\n'],
    ['xx', 'xx\n\n----\nlus z\n\n'],
  ])('a composed «%s» is followed by the cursor, not by a line break', (word, text) => {
    const { editor, session } = compose(() => {}, word)
    expect(session.text).toBe(text)
    expect(beforeCursor(editor)).toBe(word)
    type(editor, 'z')
    expect(session.text).toBe(word + 'z' + text.slice(word.length))
  })
})

describe('a blank that starts a block', () => {
  it('a letter typed in a block that reads with a blank first keeps the blank, or the host is told with onInexact', () => {
    const { editor, session, inexact } = open('* [ ]  x+ b\n')
    expect(textOf(editor, 0)).toBe(' x+ b')
    select(editor, posIn(editor, 0, 2))
    type(editor, 'z')
    const kept = textOf(editor, 0) === ' xz+ b' && session.text.includes('[ ]  xz')
    // no character vanishes without a word: either the blank stays, or onInexact was told
    expect(kept || inexact.length > 0).toBe(true)
    expect(textOf(editor, 0).replace(/^ /, '')).toBe('xz+ b')
    // the screen and the text say the same
    expect(session.text.includes('xz+ b')).toBe(true)
  })

  it('the cursor stands right after the typed letter when the blank was dropped: the next letter follows it', () => {
    const { editor, session, inexact } = open('* [ ]  x+ b\n')
    select(editor, posIn(editor, 0, 2))
    type(editor, 'z')
    expect(inexact.length).toBeGreaterThan(0)
    const { doc, selection } = editor.view.state
    expect(doc.textBetween(0, selection.from, '\n', '￼').replace(/^ /, '')).toBe('xz')
    type(editor, 'y')
    expect(textOf(editor, 0).replace(/^ /, '')).toBe('xzy+ b')
    expect(session.text.includes('xzy+ b')).toBe(true)
  })

  it('typing in a block without a leading blank does not call onInexact', () => {
    const { editor, inexact } = open('* [ ] x+ b\n')
    select(editor, posIn(editor, 0, 1))
    type(editor, 'z')
    expect(textOf(editor, 0)).toBe('xz+ b')
    expect(inexact).toEqual([])
  })
})
