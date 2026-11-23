// code, captions, islands, the menu of «/» and the blocks put in.
import { createSession } from '@nota-adoc/core'
import { createVisualEditor } from '@nota-adoc/prosemirror'
import { afterEach, describe, expect, it } from 'vitest'
import { projectDocument } from '@nota-adoc/prosemirror'
import { type Setup, closeAll, key, open, posIn, select, shape, type } from './helpers.js'

afterEach(closeAll)

const synced = ({ editor, session }: Setup): void => {
  expect(editor.view.state.doc.eq(projectDocument(session.doc))).toBe(true)
}

describe('code', () => {
  it('shows [source,js] over ---- as code with the language, and edits its text as it is', () => {
    const s = open('a\n\n[source,js]\n----\nlet x\n----\n\nb\n')
    expect(shape(s.editor)).toBe('a|[code]|b')
    expect(s.el.querySelector('.code-lang')!.textContent).toBe('JavaScript')
    select(s.editor, posIn(s.editor, 1, 3))
    type(s.editor, ' =')
    expect(s.session.text).toBe('a\n\n[source,js]\n----\nlet = x\n----\n\nb\n')
    key(s.editor, 'Enter')
    expect(s.session.text).toContain('let =\n x')
    synced(s)
  })

  it('shows the raw word of an unknown language', () => {
    const s = open('[source,kotlin]\n----\nx\n----\n')
    expect(s.el.querySelector('.code-lang')!.textContent).toBe('kotlin')
  })

  it('Tab puts two blanks; Tab and Shift-Tab on several lines change every line, in one step', () => {
    const s = open('----\na\nb\n----\n')
    select(s.editor, posIn(s.editor, 0, 0))
    key(s.editor, 'Tab')
    expect(s.session.text).toBe('----\n  a\nb\n----\n')
    select(s.editor, posIn(s.editor, 0, 0), posIn(s.editor, 0, 5))
    key(s.editor, 'Tab')
    expect(s.session.text).toBe('----\n    a\n  b\n----\n')
    key(s.editor, 'Tab', { shift: true })
    expect(s.session.text).toBe('----\n  a\nb\n----\n')
    s.session.undo()
    expect(s.session.text).toBe('----\n    a\n  b\n----\n')
    synced(s)
  })

  it('a line of dashes typed in the code lengthens the delimiters', () => {
    const s = open('----\nx\n----\n')
    select(s.editor, posIn(s.editor, 0, 1))
    key(s.editor, 'Enter')
    type(s.editor, '----')
    expect(s.session.text).toBe('-----\nx\n----\n-----\n')
    synced(s)
  })

  it('setCodeLanguage writes [source,lang]', () => {
    const s = open('----\nx\n----\n')
    select(s.editor, posIn(s.editor, 0, 1))
    expect(s.editor.codeAt()).toEqual({ language: '' })
    s.editor.commands.setCodeLanguage('python')
    expect(s.session.text).toBe('[source,python]\n----\nx\n----\n')
    expect(s.editor.codeAt()!.language).toBe('python')
    synced(s)
  })

  it('colours the code with the highlighter of the host', () => {
    const session = createSession('[source,js]\n----\nlet x\n----\n')
    const el = document.createElement('div')
    document.body.append(el)
    const editor = createVisualEditor(el, {
      session,
      highlightCode: (lang) => (lang === 'javascript' ? [{ from: 0, to: 3, class: 'tok-kw' }] : []),
    })
    expect(el.querySelector('.tok-kw')!.textContent).toBe('let')
    editor.destroy()
  })
})

describe('images', () => {
  it('shows a picture with its caption, and edits the caption as text', () => {
    const session = createSession('.Cap\nimage::a.png[]\n')
    const el = document.createElement('div')
    document.body.append(el)
    const editor = createVisualEditor(el, {
      session,
      images: (target) => ({ url: 'x://' + target }),
    })
    expect(el.querySelector('img')!.getAttribute('src')).toBe('x://a.png')
    expect(el.querySelector('figcaption')!.textContent).toBe('Cap')
    select(editor, posIn(editor, 0, 3))
    type(editor, 's')
    expect(session.text).toBe('.Caps\nimage::a.png[]\n')
    editor.destroy()
  })

  it('a remote picture is a plate, and no request is made', () => {
    const session = createSession('image::https://x.y/a.png[]\n')
    const el = document.createElement('div')
    document.body.append(el)
    const editor = createVisualEditor(el, { session, images: () => ({ plate: 'remote' }) })
    expect(el.querySelector('img')).toBeNull()
    expect(el.querySelector('.image-box')!.textContent).toContain('https://x.y/a.png')
    editor.destroy()
  })
})

describe('islands', () => {
  it('edits the source of the block as text', () => {
    const s = open('a\n\n|===\n2*|x\n|===\n\nb\n')
    expect(shape(s.editor)).toBe('a|[chip]|b')
    select(s.editor, posIn(s.editor, 1, 9))
    type(s.editor, 'y')
    expect(s.session.text).toBe('a\n\n|===\n2*|xy\n|===\n\nb\n')
    synced(s)
  })

  it('keeps a text that would change the blocks around it on the screen, not in the file', () => {
    const s = open('a\n\n|===\n2*|x\n|===\n\nb\n')
    const before = s.session.text
    select(s.editor, posIn(s.editor, 1, 10), posIn(s.editor, 1, 14))
    key(s.editor, 'Backspace')
    expect(s.session.text).toBe(before)
    expect(s.el.querySelector('.island.unsaved, .nota-island.unsaved')).not.toBeNull()
    select(s.editor, posIn(s.editor, 0, 0))
    expect(s.session.text).toBe(before)
    expect(s.rejects.some((r) => r.code === 'island-unsaved')).toBe(true)
    synced(s)
  })
})

describe('an island under the cursor stays one', () => {
  it('whatever its text reads as now: the edits go on, and the screen follows the text when the cursor leaves', () => {
    const s = open('// c\n\nb\n')
    expect(shape(s.editor)).toBe('[chip]|b')
    select(s.editor, posIn(s.editor, 0, 0))
    type(s.editor, 'z')
    // `z// c` is a paragraph now, but it is still the island the cursor is in
    expect(s.session.text).toBe('z// c\n\nb\n')
    expect(shape(s.editor)).toBe('[chip]|b')
    select(s.editor, posIn(s.editor, 0, 1))
    key(s.editor, 'Delete')
    expect(s.session.text).toBe('z/ c\n\nb\n')
    expect(s.el.querySelector('.nota-island.unsaved')).toBeNull()
    select(s.editor, posIn(s.editor, 1, 0))
    expect(shape(s.editor)).toBe('z/ c|b')
    synced(s)
  })
})

describe('blocks put in', () => {
  it('«/» in an empty paragraph shows the menu state, Esc dismisses it', () => {
    const s = open('a\n\n\n\nb\n')
    select(s.editor, posIn(s.editor, 1, 0))
    type(s.editor, '/код')
    expect(s.editor.slashAt()!.query).toBe('код')
    s.editor.commands.dismissSlash()
    expect(s.editor.slashAt()).toBeNull()
  })

  it('with «/» open Mod-Alt-4…6 pick the heading, Mod-Alt-0 does nothing, one undo takes it back', () => {
    for (const lv of [4, 5, 6]) {
      const s = open('a\n\n\n')
      select(s.editor, posIn(s.editor, 1, 0))
      type(s.editor, '/')
      expect(s.editor.slashAt()).not.toBeNull()
      key(s.editor, '0', { mod: true, alt: true })
      expect(s.editor.slashAt()).not.toBeNull()
      key(s.editor, String(lv), { mod: true, alt: true })
      expect(s.editor.slashAt()).toBeNull()
      expect(s.session.text).not.toContain('/')
      type(s.editor, 'Т')
      expect(s.session.text).toContain('='.repeat(lv) + ' Т')
      s.session.undo()
      expect(s.session.text).not.toContain('Т')
      expect(s.session.text).not.toContain('=')
      closeAll()
    }
  })

  it('a block of code put in the place of «/» is one step, and the text typed before is not in it', () => {
    const s = open('a\n\n\n')
    select(s.editor, posIn(s.editor, 1, 0))
    type(s.editor, '/код')
    s.editor.commands.insertBlock('code')
    expect(s.session.text).toContain('[source,text]\n----\n----')
    expect(s.session.text).not.toContain('/')
    expect(s.editor.codeAt()).not.toBeNull()
    synced(s)
    s.session.undo()
    expect(s.session.text).not.toContain('source')
    synced(s)
  })

  it('a table is 3x3 with a header', () => {
    const s = open('a\n')
    select(s.editor, posIn(s.editor, 0, 1))
    s.editor.commands.insertBlock('table')
    expect(s.session.text).toContain('options="header"')
    synced(s)
  })

  it('a picture of a path is put after the paragraph', () => {
    const s = open('a\n')
    select(s.editor, posIn(s.editor, 0, 1))
    s.editor.commands.insertBlock('image', { path: 'img/a.png' })
    expect(s.session.text).toContain('image::img/a.png[]')
    synced(s)
  })

  it('a heading is written with the first letter, not before', () => {
    const s = open('a\n\n\n')
    select(s.editor, posIn(s.editor, 1, 0))
    const before = s.session.text
    s.editor.commands.insertBlock('heading2')
    expect(s.session.text).toBe(before)
    expect(s.el.querySelector('h2')).not.toBeNull()
    type(s.editor, 'T')
    expect(s.session.text).toContain('== T')
    synced(s)
  })

  it('a collapsible block is written with the first letter', () => {
    const s = open('a\n\n\n')
    select(s.editor, posIn(s.editor, 1, 0))
    s.editor.commands.insertBlock('collapsible')
    expect(s.session.text).toBe('a\n\n\n')
    type(s.editor, 'T')
    expect(s.session.text).toContain('[%collapsible%open]\n====\nT\n====')
    synced(s)
  })

  it('after a block that has text, a collapsible block and NOTE: are on the screen only, the file is not touched until the first letter', () => {
    for (const [kind, written] of [
      ['collapsible', '.Подробнее\n[%collapsible%open]\n====\nT\n===='],
      ['admonition', 'NOTE: T'],
    ] as const) {
      const s = open('a\n\nb\n')
      select(s.editor, posIn(s.editor, 0, 1))
      s.editor.commands.insertBlock(kind, { title: 'Подробнее' })
      expect(s.session.text).toBe('a\n\nb\n')
      expect(s.session.canUndo).toBe(false)
      type(s.editor, 'T')
      expect(s.session.text).toBe(`a\n\n${written}\n\nb\n`)
      synced(s)
      s.session.undo()
      expect(s.session.text).toBe('a\n\nb\n')
      closeAll()
    }
  })

  it('after a paragraph, a heading and a list are on the screen only; the first letter writes them', () => {
    for (const [kind, written] of [
      ['heading2', '== Т'],
      ['heading3', '=== Т'],
      ['heading4', '==== Т'],
      ['heading5', '===== Т'],
      ['heading6', '====== Т'],
      ['unordered', '* Т'],
      ['ordered', '. Т'],
      ['checklist', '* [ ] Т'],
    ] as const) {
      const s = open('a\n\nb\n')
      select(s.editor, posIn(s.editor, 0, 1))
      expect(s.editor.commands.insertBlock(kind)).toBe(true)
      expect(s.session.text).toBe('a\n\nb\n')
      expect(s.session.canUndo).toBe(false)
      expect(shape(s.editor)).not.toBe('a|b')
      type(s.editor, 'Т')
      expect(s.rejects).toEqual([])
      expect(s.session.text).toBe(`a\n\n${written}\n\nb\n`)
      synced(s)
      closeAll()
    }
  })

  it('a list started after a list item stands after the whole list, as a list of its own (// between)', () => {
    const s = open('* x\n\nb\n')
    select(s.editor, posIn(s.editor, 0, 1))
    expect(s.editor.commands.insertBlock('unordered')).toBe(true)
    expect(s.session.text).toBe('* x\n\nb\n')
    type(s.editor, 'Т')
    expect(s.session.text).toBe('* x\n\n//\n\n* Т\n\nb\n')
    synced(s)
  })

  it('a list with blank lines inside: the block goes after the whole list, not into it', () => {
    const s = open('* x\n\n* y\n\nb\n')
    select(s.editor, posIn(s.editor, 0, 1))
    expect(s.editor.commands.insertBlock('heading2')).toBe(true)
    expect(s.session.text).toBe('* x\n\n* y\n\nb\n')
    type(s.editor, 'Т')
    expect(s.session.text).toBe('* x\n\n* y\n\n== Т\n\nb\n')
    synced(s)
  })

  it('an empty paragraph after the list is the place of the draft, no new line is made', () => {
    const s = open('* x\n\n* y\n\n\nb\n')
    select(s.editor, posIn(s.editor, 0, 1))
    expect(s.editor.commands.insertBlock('heading2')).toBe(true)
    expect(s.session.text).toBe('* x\n\n* y\n\n\nb\n')
    type(s.editor, 'Т')
    expect(s.session.text).toBe('* x\n\n* y\n\n== Т\n\nb\n')
    synced(s)
  })

  it('from a cell of a table or a block of code the blocks go after that block', () => {
    for (const [text, tail] of [['|===\n|a\n|===\n\nb\n', '|===\n|a\n|===\n\n'], ['----\nx\n----\n\nb\n', '----\nx\n----\n\n']] as const) {
      const s = open(text)
      select(s.editor, posIn(s.editor, 0, 0))
      expect(s.editor.commands.insertBlock('heading2')).toBe(true)
      expect(s.session.text).toBe(text)
      type(s.editor, 'Т')
      expect(s.session.text).toBe(`${tail}== Т\n\nb\n`)
      closeAll()
    }
  })

  it('Backspace and Enter in a block that is only on the screen take it away, and the file is as it was', () => {
    for (const [k, kind] of [['Backspace', 'admonition'], ['Enter', 'admonition'], ['Backspace', 'heading2'], ['Enter', 'ordered']] as const) {
      const s = open('a')
      select(s.editor, posIn(s.editor, 0, 1))
      s.editor.commands.insertBlock(kind)
      key(s.editor, k)
      expect(s.session.text).toBe('a')
      expect(shape(s.editor)).toBe('a')
      closeAll()
    }
  })

  it('NOTE: is written with the first letter', () => {
    const s = open('a\n\n\n')
    select(s.editor, posIn(s.editor, 1, 0))
    s.editor.commands.insertBlock('admonition')
    expect(s.session.text).toBe('a\n\n\n')
    type(s.editor, 'T')
    expect(s.session.text).toContain('NOTE: T')
    synced(s)
  })
})

describe('keys in code and captions', () => {
  it('Backspace in an empty block of code takes the block with its lines away', () => {
    const s = open('a\n\n[source,js]\n----\n----\n\nb\n')
    select(s.editor, posIn(s.editor, 1, 0))
    key(s.editor, 'Backspace')
    expect(s.session.text).toBe('a\n\nb\n')
    expect(s.session.text).not.toContain('source')
    synced(s)
  })

  it('Enter in a caption does not make a block and does not change the file', () => {
    const s = open('.Cap\nimage::a.png[]\n', {})
    select(s.editor, posIn(s.editor, 0, 3))
    key(s.editor, 'Enter')
    expect(s.session.text).toBe('.Cap\nimage::a.png[]\n')
    expect(s.rejects.some((r) => r.code === 'caption-one-line')).toBe(true)
  })

  it('Backspace in a caption takes one letter and erasing all of it takes the line away', () => {
    const s = open('.C\nimage::a.png[]\n')
    select(s.editor, posIn(s.editor, 0, 1))
    key(s.editor, 'Backspace')
    expect(s.session.text).toBe('image::a.png[]\n')
  })

  it('a block of code with [source] and no language, and [source,text], read as «Text» (the default label; the host names it «Текст»); ---- alone too', () => {
    for (const head of ['', '[source]\n', '[source,text]\n']) {
      const s = open(`${head}----\nx\n----\n`)
      expect(s.el.querySelector('.code-lang')!.textContent).toBe('Text')
    }
  })
})

describe('a picture the webview cannot load', () => {
  it('becomes the plate «Нет файла», as a path above the workspace does (the host refuses it)', () => {
    const session = createSession('image::../../../outside.png[]\n')
    const el = document.createElement('div')
    document.body.append(el)
    const editor = createVisualEditor(el, { session, images: (target) => ({ url: 'x://' + target }) })
    const img = el.querySelector('img')!
    img.dispatchEvent(new Event('error'))
    expect(el.querySelector('img')).toBeNull()
    expect(el.querySelector('.image-box')!.textContent).toContain('../../../outside.png')
    editor.destroy()
  })
})

describe('a NOTE that is only started', () => {
  it('before a paragraph with a line of attributes and a plate in it, it is an empty paragraph: no plates of the next paragraph in it', () => {
    const s = open('a\n[separator=¦]\nb ^sup^ c')
    select(s.editor, posIn(s.editor, 0, 1))
    s.editor.commands.insertBlock('admonition')
    expect(s.session.text).toBe('a\n[separator=¦]\nb ^sup^ c')
    const note = s.editor.view.state.doc.child(1)
    expect(note.type.name).toBe('admonition_paragraph')
    expect(note.childCount).toBe(0)
    closeAll()
  })
})
