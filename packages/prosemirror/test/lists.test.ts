// lists in the visual editor: the projection, the commands, Tab, Enter, Backspace, the started items, the markers typed.
import { afterEach, describe, expect, it } from 'vitest'
import { createSession } from '@nota-adoc/core'
import { projectDocument } from '@nota-adoc/prosemirror'
import { closeAll, key, open, posIn, select, type } from './helpers.js'

afterEach(closeAll)

const kinds = (s: ReturnType<typeof open>): string[] => {
  const out: string[] = []
  s.editor.view.state.doc.forEach((n) => out.push(n.type.name + (n.type.name === 'list_item' ? `${n.attrs.level}${n.attrs.num}` : '')))
  return out
}
const screen = (s: ReturnType<typeof open>): string => s.editor.view.state.doc.toString()
const cursorAt = (s: ReturnType<typeof open>, i: number, k: number): void => select(s.editor, posIn(s.editor, i, k))

describe('items on the screen', () => {
  it('are nodes of their own with the level, the number and the checkbox', () => {
    const s = open('* a\n** b\n* c\n\nPara\n\n. one\n.. two\n. three\n\nEnd\n\n* [ ] x\n* [x] y\n')
    expect(kinds(s)).toEqual([
      'list_item1',
      'list_item2',
      'list_item1',
      'paragraph',
      'list_item11.',
      'list_item2a.',
      'list_item12.',
      'paragraph',
      'list_item1',
      'list_item1',
    ])
    const html = s.el.innerHTML
    expect(html).toContain('role="checkbox"')
    expect(s.el.querySelectorAll('.chk.on')).toHaveLength(1)
    // the bullets of the levels
    expect([...s.el.querySelectorAll('.li-ul > .mk')].map((m) => m.textContent).slice(0, 3)).toEqual(['•', '◦', '•'])
  })

  it('are numbered by the dots of the marker, as Asciidoctor does, in a mixed nesting', () => {
    const s = open('* a\n. b\n. c\n\nPara\n\n. x\n** y\n.. z\n')
    expect(kinds(s)).toEqual(['list_item1', 'list_item21.', 'list_item22.', 'paragraph', 'list_item11.', 'list_item2', 'list_item3a.'])
  })

  it('are the projection of the text after an edit as they are from nothing', () => {
    const s = open('* one\n* two\n')
    cursorAt(s, 1, 2)
    type(s.editor, 'XY')
    expect(s.session.text).toBe('* one\n* twXYo\n')
    expect(s.editor.view.state.doc.eq(projectDocument(s.session.doc))).toBe(true)
    key(s.editor, 'Tab')
    expect(s.session.text).toBe('* one\n** twXYo\n')
    expect(s.editor.view.state.doc.eq(projectDocument(s.session.doc))).toBe(true)
  })
})

describe('the commands of lists', () => {
  it('toggleList makes an item, the same kind again makes the paragraph back, byte for byte', () => {
    const s = open('One\n\nTwo\n')
    cursorAt(s, 1, 1)
    expect(s.editor.commands.toggleList('ordered')).toBe(true)
    expect(s.session.text).toBe('One\n\n. Two\n')
    expect(s.editor.listAt()).toEqual({ kind: 'ordered', level: 1, draft: false })
    expect(s.editor.commands.toggleList('ordered')).toBe(true)
    expect(s.session.text).toBe('One\n\nTwo\n')
    expect(s.editor.listAt()).toBeNull()
  })

  it('toggleList over several paragraphs makes one list, and another kind changes the list', () => {
    const s = open('a\n\nb\n\nc\n')
    select(s.editor, posIn(s.editor, 0, 0), posIn(s.editor, 2, 1))
    s.editor.commands.toggleList('unordered')
    expect(s.session.text).toBe('* a\n* b\n* c\n')
    cursorAt(s, 1, 1)
    s.editor.commands.toggleList('checklist')
    expect(s.session.text).toContain('[ ] b')
    expect(s.editor.listAt()!.kind).toBe('checklist')
  })

  it('Tab and Shift+Tab move the item; a refusal says why and the focus stays', () => {
    const s = open('* a\n* b\n')
    cursorAt(s, 0, 1)
    expect(key(s.editor, 'Tab')).toBe(true)
    expect(s.session.text).toBe('* a\n* b\n')
    expect(s.rejects.at(-1)!.code).toBe('first-item')
    cursorAt(s, 1, 1)
    key(s.editor, 'Tab')
    expect(s.session.text).toBe('* a\n** b\n')
    key(s.editor, 'Tab', { shift: true })
    expect(s.session.text).toBe('* a\n* b\n')
    key(s.editor, 'Tab', { shift: true })
    expect(s.rejects.at(-1)!.code).toBe('top-level-item')
    expect(s.session.text).toBe('* a\n* b\n')
  })

  it('Tab outside a list is left to the browser', () => {
    const s = open('plain\n')
    cursorAt(s, 0, 2)
    expect(key(s.editor, 'Tab')).toBe(false)
  })

  it('the checkbox flips with setChecked, one character', () => {
    const s = open('* [ ] a\n')
    cursorAt(s, 0, 0)
    expect(s.editor.commands.setChecked()).toBe(true)
    expect(s.session.text).toBe('* [x] a\n')
    expect(s.editor.commands.setChecked(false)).toBe(true)
    expect(s.session.text).toBe('* [ ] a\n')
  })
})

describe('Enter, Backspace and Delete in items', () => {
  it('Enter in the middle splits; at the end it starts an item that is not in the text until a character is typed', () => {
    const s = open('* one two\n')
    cursorAt(s, 0, 3)
    key(s.editor, 'Enter')
    expect(s.session.text).toBe('* one\n* two\n')
    cursorAt(s, 1, 3)
    key(s.editor, 'Enter')
    expect(s.session.text).toBe('* one\n* two\n')
    expect(kinds(s)).toEqual(['list_item1', 'list_item1', 'list_item1'])
    expect(s.editor.view.state.doc.child(2).attrs.draft).toBe(true)
    expect(s.editor.listAt()).toEqual({ kind: 'unordered', level: 1, draft: true })
    type(s.editor, 'x')
    expect(s.session.text).toBe('* one\n* two\n* x\n')
    expect(s.editor.view.state.doc.child(2).attrs.draft).toBe(false)
  })

  it('Enter in an empty item that was only started ends the list: an empty paragraph under it', () => {
    const s = open('* one\n')
    cursorAt(s, 0, 3)
    key(s.editor, 'Enter')
    expect(s.editor.view.state.doc.child(1).attrs.draft).toBe(true)
    key(s.editor, 'Enter')
    expect(s.session.text).toMatch(/^\* one\n\n*$/)
    expect(s.editor.listAt()).toBeNull()
    expect(kinds(s)).toEqual(['list_item1', 'paragraph'])
  })

  it('Tab and Shift+Tab in a started item change its level; leaving it takes it away', () => {
    const s = open('* one\n\nTwo\n')
    cursorAt(s, 0, 3)
    key(s.editor, 'Enter')
    key(s.editor, 'Tab')
    expect(s.editor.view.state.doc.child(1).attrs.level).toBe(2)
    expect(s.session.text).toBe('* one\n\nTwo\n')
    cursorAt(s, 2, 1)
    expect(kinds(s)).toEqual(['list_item1', 'paragraph'])
    expect(s.session.text).toBe('* one\n\nTwo\n')
  })

  it('Backspace at the start of an item joins it to the one above; the first item becomes a paragraph', () => {
    const s = open('Intro\n\n* a\n* b\n')
    cursorAt(s, 2, 0)
    key(s.editor, 'Backspace')
    expect(s.session.text).toBe('Intro\n\n* a\nb\n')
    cursorAt(s, 1, 0)
    key(s.editor, 'Backspace')
    expect(s.session.text).toBe('Intro\n\na\nb\n')
    expect(kinds(s)).toEqual(['paragraph', 'paragraph'])
  })

  it('Delete at the end of an item joins the next one', () => {
    const s = open('* a\n* b\n')
    cursorAt(s, 0, 1)
    key(s.editor, 'Delete')
    expect(s.session.text).toBe('* a\nb\n')
  })

  it('Enter at the start of an item says why it does nothing', () => {
    const s = open('* a\n')
    cursorAt(s, 0, 0)
    key(s.editor, 'Enter')
    expect(s.rejects.at(-1)!.code).toBe('item-start')
    expect(s.session.text).toBe('* a\n')
  })
})

describe('the markers typed at the start of an empty paragraph', () => {
  it.each([
    ['* ', '* x\n', 'list_item1'],
    ['- ', '- x\n', 'list_item1'],
    ['. ', '. x\n', 'list_item11.'],
    ['1. ', '1. x\n', 'list_item11.'],
    ['== ', '== x\n', 'heading'],
  ])('%j starts a draft; the first character writes it', (marker, text, kind) => {
    const s = open('before\n\n\n\nafter\n')
    const empty = [...Array(s.editor.view.state.doc.childCount).keys()].find((i) => s.editor.view.state.doc.child(i).childCount === 0)!
    cursorAt(s, empty, 0)
    type(s.editor, marker)
    expect(s.session.text).toBe('before\n\n\n\nafter\n')
    expect(s.editor.view.state.doc.child(empty).type.name).toBe(kind.replace(/\d.*$/, ''))
    expect(s.editor.view.state.doc.child(empty).attrs.draft).toBe(true)
    type(s.editor, 'x')
    expect(s.session.text).toContain(text)
    expect(s.editor.view.state.doc.eq(projectDocument(s.session.doc))).toBe(true)
  })

  it('tells the host to hold the edit while a marker may be followed by a space', () => {
    const s = open('before\n\n\n\nafter\n')
    const empty = [...Array(s.editor.view.state.doc.childCount).keys()].find((i) => s.editor.view.state.doc.child(i).childCount === 0)!
    cursorAt(s, empty, 0)
    expect(s.editor.markerPending).toBe(false)
    type(s.editor, '*')
    expect(s.editor.markerPending).toBe(true)
    type(s.editor, ' ')
    expect(s.editor.markerPending).toBe(false)
    const t = open('before\n\n\n\nafter\n')
    cursorAt(t, empty, 0)
    type(t.editor, 'w')
    expect(t.editor.markerPending).toBe(false)
  })

  it('a marker in a paragraph that has text is only text', () => {
    const s = open('word\n')
    cursorAt(s, 0, 0)
    type(s.editor, '* ')
    expect(screen(s)).not.toContain('list_item')
  })
})

describe('a blank line in a list', () => {
  const K1 =
    '**Важно**\n\nРоли бывают двух видов:\n\n* Внешние - для систем снаружи\n* Внутренние - для систем внутри\n**Как заводить:**\n\n' +
    '* **внешнюю** : через заявку\n* **внутреннюю** : миграцией\n** **логин** с префиксом **app_**\n** **пароль** пустой\n\n' +
    '[%header,cols="2"]\n|===\n| Имя\n| Вид\n|===\n'

  it('the list is items, not an island, and the text is the same', () => {
    const doc = projectDocument(createSession(K1).doc)
    const levels: number[] = []
    let islands = 0
    doc.forEach((n) => {
      if (n.type.name === 'island') islands++
      if (n.type.name === 'list_item') levels.push(n.attrs.level as number)
    })
    expect(islands).toBe(0)
    expect(levels).toEqual([1, 1, 1, 1, 2, 2])
    const s = open(K1)
    expect(s.session.text).toBe(K1)
  })

  it('the numbers go on over the blank line', () => {
    expect(kinds(open('. a\n\n. b\n. c\n'))).toEqual(['list_item11.', 'list_item12.', 'list_item13.'])
    expect(kinds(open('1. a\n\n* x\n* y\n2. b\n'))).toEqual(['list_item11.', 'list_item2', 'list_item2', 'list_item12.'])
  })

  it('typing after the blank line changes only the item', () => {
    const s = open('* a\n\n* b\n')
    select(s.editor, posIn(s.editor, 1, 1))
    type(s.editor, 'c')
    expect(s.session.text).toBe('* a\n\n* bc\n')
  })
})
