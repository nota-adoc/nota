// setTextColor and setFill, and colorAt.
import { afterEach, describe, expect, it } from 'vitest'
import { FILL_ROLES, TEXT_COLOR_ROLES, projectDocument } from '@nota-adoc/prosemirror'
import { closeAll, open, posIn, select } from './helpers.js'

afterEach(closeAll)

const words = (text: string, a: number, b: number) => {
  const s = open(text)
  select(s.editor, posIn(s.editor, 0, a), posIn(s.editor, 0, b))
  return s
}

describe('setTextColor', () => {
  it('colours the selection in one step of the history', () => {
    const s = words('one two three', 4, 7)
    expect(s.editor.commands.setTextColor('hl-red')).toBe(true)
    expect(s.session.text).toBe('one [.hl-red]#two# three')
    expect(s.editor.view.state.doc.eq(projectDocument(s.session.doc))).toBe(true)
    expect(s.editor.colorAt()).toEqual(['hl-red'])
    s.editor.commands.undo()
    expect(s.session.text).toBe('one two three')
  })

  it('replaces the colour: no second role', () => {
    const s = words('one two three', 4, 7)
    s.editor.commands.setTextColor('hl-red')
    expect(s.editor.commands.setTextColor('hl-blue')).toBe(true)
    expect(s.session.text).toBe('one [.hl-blue]#two# three')
    s.editor.commands.undo()
    expect(s.session.text).toBe('one [.hl-red]#two# three')
  })

  it('"no colour" takes the colour off byte for byte and leaves the fill', () => {
    const s = words('one two three', 4, 7)
    s.editor.commands.setTextColor('hl-red')
    expect(s.editor.commands.setTextColor(null)).toBe(true)
    expect(s.session.text).toBe('one two three')
    s.editor.commands.setTextColor('hl-red')
    s.editor.commands.setFill('hl-yellow-bg')
    expect(s.session.text).toMatch(/hl-red/)
    expect(s.session.text).toMatch(/hl-yellow-bg/)
    expect([...s.editor.colorAt()].sort()).toEqual(['hl-red', 'hl-yellow-bg'])
    s.editor.commands.setTextColor(null)
    expect(s.session.text).toBe('one [.hl-yellow-bg]#two# three')
  })

  it('new roles: written, replaced by blue, and «no colour» keeps the fill', () => {
    for (const role of ['hl-orange', 'hl-purple', 'hl-pink', 'hl-teal']) {
      const s = words('one two three', 4, 7)
      s.editor.commands.setTextColor(role)
      expect(s.session.text).toBe(`one [.${role}]#two# three`)
      s.editor.commands.undo()
      expect(s.session.text).toBe('one two three')
      const t = words('one two three', 4, 7)
      t.editor.commands.setTextColor(role)
      t.editor.commands.setTextColor('hl-blue')
      expect(t.session.text).toBe('one [.hl-blue]#two# three')
    }
    const f = open('one [.hl-pink.hl-yellow-bg]#two# three')
    select(f.editor, posIn(f.editor, 0, 4), posIn(f.editor, 0, 7))
    f.editor.commands.setTextColor(null)
    expect(f.session.text).toBe('one [.hl-yellow-bg]#two# three')
  })

  it('a role not in the registry stays when the colour is set or taken off', () => {
    const s = open('one [.hl-cyan]#two# three')
    select(s.editor, posIn(s.editor, 0, 4), posIn(s.editor, 0, 7))
    s.editor.commands.setTextColor(null)
    expect(s.session.text).toBe('one [.hl-cyan]#two# three')
    s.editor.commands.setTextColor('hl-red')
    expect(s.session.text).toContain('hl-cyan')
    expect(s.session.text).toContain('hl-red')
  })

  it('refuses without a selection', () => {
    const s = open('one two')
    expect(s.editor.commands.setTextColor('hl-red')).toBe(false)
    expect(s.rejects.at(-1)?.code).toBe('empty-selection')
    expect(s.session.text).toBe('one two')
  })
})

describe('setFill', () => {
  it('replaces the fill and keeps the colour of the letters and the mark', () => {
    const s = words('one two three', 4, 7)
    s.editor.commands.setTextColor('hl-red')
    s.editor.commands.setFill('hl-yellow-bg')
    expect(s.editor.commands.setFill('hl-green-bg')).toBe(true)
    expect(s.session.text).not.toMatch(/yellow/)
    expect([...s.editor.colorAt()].sort()).toEqual(['hl-green-bg', 'hl-red'])
    expect(s.editor.commands.setFill(null)).toBe(true)
    expect(s.editor.colorAt()).toEqual(['hl-red'])
    expect(s.session.text).toBe('one [.hl-red]#two# three')
  })

  it('"no fill" does not take the mark #…# off', () => {
    const s = words('one #two# three', 5, 8)
    s.editor.commands.setFill(null)
    expect(s.session.text).toBe('one #two# three')
  })
})

describe('colorAt', () => {
  it('is the roles of the whole selection', () => {
    const s = open('[.hl-red]#one# two')
    select(s.editor, posIn(s.editor, 0, 1))
    expect(s.editor.colorAt()).toEqual(['hl-red'])
    select(s.editor, posIn(s.editor, 0, 0), posIn(s.editor, 0, 6))
    expect(s.editor.colorAt()).toEqual([])
  })
})

describe('the fills of the same set as the letters', () => {
  it.each(['hl-yellow-bg', 'hl-red-bg', 'hl-orange-bg', 'hl-green-bg', 'hl-teal-bg', 'hl-blue-bg', 'hl-pink-bg', 'hl-purple-bg', 'hl-gray-bg'])(
    '%s: written, replaced by another fill, «no fill» removes it',
    (role) => {
      expect(FILL_ROLES).toContain(role)
      const s = words('one two three', 4, 7)
      s.editor.commands.setFill(role)
      expect(s.session.text).toBe(`one [.${role}]#two# three`)
      expect([...s.editor.colorAt()]).toEqual([role])
      const other = role === 'hl-gray-bg' ? 'hl-red-bg' : 'hl-gray-bg'
      s.editor.commands.setFill(other)
      expect(s.session.text).toBe(`one [.${other}]#two# three`)
      s.editor.commands.setFill(null)
      expect(s.session.text).toBe('one two three')
    },
  )

  it('has nine fills and the letter set of the same names', () => {
    expect(FILL_ROLES).toHaveLength(9)
    const fills = FILL_ROLES.map((x) => x.replace(/-bg$/, '')).filter((x) => x !== 'hl-yellow')
    expect(fills.sort()).toEqual([...TEXT_COLOR_ROLES].sort())
  })
})
