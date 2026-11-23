// admonitions and collapsible blocks in the visual editor.
import { afterEach, describe, expect, it } from 'vitest'
import { projectDocument } from '@nota-adoc/prosemirror'
import { closeAll, key, open, posIn, select, type } from './helpers.js'

afterEach(closeAll)

type Setup = ReturnType<typeof open>
const names = (s: Setup): string[] => {
  const out: string[] = []
  s.editor.view.state.doc.forEach((n) => out.push(n.type.name))
  return out
}
const cursorAt = (s: Setup, i: number, k: number): void => select(s.editor, posIn(s.editor, i, k))
const heads = (s: Setup): string[] => [...s.el.querySelectorAll('.coll-head')].map((h) => h.getAttribute('aria-expanded') ?? '')

const COLL = '.Details\n[%collapsible]\n====\nInside.\n\n* item\n====\n\nAfter.\n'

describe('admonitions', () => {
  it('shows NOTE: as a paragraph with a type, with the five types', () => {
    const s = open('NOTE: a\n\nTIP: b\n\nIMPORTANT: c\n\nWARNING: d\n\nCAUTION: e\n')
    expect(names(s)).toEqual(Array(5).fill('admonition_paragraph'))
    expect([...s.el.querySelectorAll('.adm-para')].map((e) => e.getAttribute('data-variant'))).toEqual([
      'NOTE',
      'TIP',
      'IMPORTANT',
      'WARNING',
      'CAUTION',
    ])
    expect([...s.el.querySelectorAll('.adm-lbl')].map((e) => e.textContent)).toEqual(['Note.', 'Tip.', 'Important.', 'Warning.', 'Caution.'])
    expect(s.el.querySelectorAll('.adm-ico svg')).toHaveLength(5)
  })

  it('shows [NOTE] over ==== as a box with its head and the blocks inside as text', () => {
    const s = open('[WARNING]\n====\nCareful.\n\n* one\n====\n')
    expect(names(s)).toEqual(['box_head', 'paragraph', 'list_item', 'box_end'])
    expect(s.el.querySelectorAll('.box-adm.adm-WARNING')).toHaveLength(4)
    expect(s.el.querySelector('.adm-head .adm-lbl')!.textContent).toBe('Warning')
  })

  it('keeps what is not an admonition a plate: an example block, a listing with a type, a table in a box is text of the box', () => {
    const s = open('====\nplain example\n====\n\n[NOTE]\n----\ncode\n----\n')
    expect(names(s)).toEqual(['island', 'island'])
  })
})

describe('the type of an admonition', () => {
  it('changes only the word, in one step of the history, and the cursor stays in the text', () => {
    const s = open('[NOTE#id.role]\n====\nText\n====\n\nNOTE: care\n')
    cursorAt(s, 1, 2)
    expect(s.editor.admonitionAt()!.variant).toBe('NOTE')
    expect(s.editor.admonitionAt()!.form).toBe('block')
    expect(s.editor.commands.setAdmonitionType('CAUTION')).toBe(true)
    expect(s.session.text).toBe('[CAUTION#id.role]\n====\nText\n====\n\nNOTE: care\n')
    expect(s.editor.view.state.selection.$from.parent.textContent).toBe('Text')
    expect(s.editor.admonitionAt()!.variant).toBe('CAUTION')
    s.editor.commands.undo()
    expect(s.session.text).toBe('[NOTE#id.role]\n====\nText\n====\n\nNOTE: care\n')
    // the one-line form
    cursorAt(s, 3, 1)
    expect(s.editor.admonitionAt()!.form).toBe('paragraph')
    s.editor.commands.setAdmonitionType('TIP')
    expect(s.session.text).toContain('\nTIP: care\n')
  })

  it('has no admonition outside one', () => {
    const s = open('plain\n')
    cursorAt(s, 0, 1)
    expect(s.editor.admonitionAt()).toBeNull()
    expect(s.editor.commands.setAdmonitionType('TIP')).toBe(false)
  })

  it('the text of an admonition is edited as text, and the type stays', () => {
    const s = open('NOTE: ab\n')
    cursorAt(s, 0, 1)
    type(s.editor, 'X')
    expect(s.session.text).toBe('NOTE: aXb\n')
    expect(s.editor.view.state.doc.eq(projectDocument(s.session.doc))).toBe(true)
  })
})

describe('collapsible blocks', () => {
  it('are closed on load: the title shows, the blocks inside are hidden, aria-expanded is false', () => {
    const s = open(COLL)
    expect(names(s)).toEqual(['box_head', 'paragraph', 'list_item', 'box_end', 'paragraph'])
    expect(heads(s)).toEqual(['false'])
    expect(s.el.querySelectorAll('.nota-hidden')).toHaveLength(3)
    expect(s.el.querySelector('.coll-title')!.textContent).toBe('Details')
  })

  it('open with a click on the title and close again; the file does not change', () => {
    const s = open(COLL)
    const head = s.el.querySelector<HTMLElement>('.coll-head')!
    head.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }))
    expect(heads(s)).toEqual(['true'])
    expect(s.el.querySelectorAll('.nota-hidden')).toHaveLength(0)
    expect(s.session.text).toBe(COLL)
    s.el.querySelector<HTMLElement>('.coll-head')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }))
    expect(heads(s)).toEqual(['false'])
    expect(s.session.text).toBe(COLL)
    expect(s.session.canUndo).toBe(false)
  })

  it('%open starts open', () => {
    const s = open('.More\n[%collapsible%open]\n====\nInside.\n====\n')
    expect(heads(s)).toEqual(['true'])
  })

  it('the text inside is edited like any text, and that is the only change of the file', () => {
    const s = open(COLL)
    s.editor.commands.toggleCollapsible(COLL.indexOf('Inside'))
    expect(heads(s)).toEqual(['true'])
    cursorAt(s, 1, 7)
    type(s.editor, ' more')
    expect(s.session.text).toBe(COLL.replace('Inside.', 'Inside. more'))
    expect(s.editor.view.state.doc.eq(projectDocument(s.session.doc))).toBe(true)
    expect(heads(s)).toEqual(['true'])
  })

  it('a cursor put inside a closed block opens it', () => {
    const s = open(COLL)
    cursorAt(s, 1, 2)
    expect(heads(s)).toEqual(['true'])
    expect(s.session.text).toBe(COLL)
  })

  it('the cursor of a new editor is not inside a block that is closed', () => {
    const s = open(COLL)
    expect(heads(s)).toEqual(['false'])
    expect(s.editor.boxAt()).toBeNull()
  })

  it('Enter on the title opens it', () => {
    const s = open(COLL)
    const head = s.el.querySelector<HTMLElement>('.coll-head')!
    head.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    expect(heads(s)).toEqual(['true'])
    void key
  })

  it('shows «Details» for a block with no title', () => {
    const s = open('[%collapsible]\n====\nInside.\n====\n')
    expect(s.el.querySelector('.coll-title')!.textContent).toBe('Details')
  })
})

describe('the anchor over a heading is not lost by an edit', () => {
  it('a new text, a new level and a word in the paragraph keep the line [#id] byte for byte, and undo gives the file back', () => {
    const id = `пример-${'модули-'.repeat(130)}конец`
    const src = `= Док\n\n[#${id}]\n=== 4. Заголовок\n\nАбзац под ним.\n`
    const s = open(src)
    const doc = s.editor.view.state.doc
    let h = -1
    let p = -1
    doc.forEach((n, off, i) => {
      if (n.type.name === 'heading' && n.attrs.meta) h = i
      if (h >= 0 && i === h + 1) p = i
    })
    expect(h).toBeGreaterThan(0)
    // the text of the heading
    cursorAt(s, h, 3)
    s.editor.view.dispatch(s.editor.view.state.tr.insertText('новый ', s.editor.view.state.selection.from))
    expect(s.session.text).toContain(`[#${id}]\n=== 4. новый Заголовок\n`)
    // the level, by the menu of the block
    cursorAt(s, h, 1)
    s.editor.commands.setBlockType('heading', 4)
    expect(s.session.text).toContain(`[#${id}]\n==== 4. новый Заголовок\n`)
    // a word in the paragraph under it
    cursorAt(s, p, 6)
    s.editor.view.dispatch(s.editor.view.state.tr.insertText('слово ', s.editor.view.state.selection.from))
    expect(s.session.text).toContain('Абзац слово под ним.\n')
    expect(s.session.text.split('\n').filter((l) => l === `[#${id}]`)).toHaveLength(1)
    expect(s.session.text).toBe(src.replace('=== 4. Заголовок', '==== 4. новый Заголовок').replace('Абзац под', 'Абзац слово под'))
    for (let i = 0; i < 3; i++) s.editor.commands.undo()
    expect(s.session.text).toBe(src)
  })
})
