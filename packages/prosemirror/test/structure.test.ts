// moving, captioning, anchoring and deleting blocks from the handle.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { closeAll, open } from './helpers.js'

afterEach(closeAll)

const FIXTURE = readFileSync(
  resolve(process.cwd(), 'quality/fixtures/editor/structure.adoc'),
  'utf8',
)

const at = (text: string, mark: string): number => {
  const i = text.indexOf(mark)
  if (i < 0) throw new Error(`no ${mark}`)
  return i
}
const titles = (text: string): string[] => text.split('\n').filter((l) => /^={2,} /.test(l))
const changedLines = (a: string, b: string): number => {
  const x = a.split('\n')
  const y = b.split('\n')
  const count = new Map<string, number>()
  for (const l of x) count.set(l, (count.get(l) ?? 0) + 1)
  let same = 0
  for (const l of y)
    if ((count.get(l) ?? 0) > 0) {
      same++
      count.set(l, count.get(l)! - 1)
    }
  return Math.max(x.length, y.length) - same
}

describe('moveBlock', () => {
  it('moves a section with its subsections and its [[id]] before a section, in one step', () => {
    const s = open(FIXTURE)
    const from = at(FIXTURE, '== Б. Таблицы')
    // the section starts at its metadata lines; the place is the start of the target (with its [[a]])
    const target = at(FIXTURE, '[[a]]')
    expect(s.editor.commands.moveBlock(from, target)).toBe(true)
    expect(titles(s.session.text)).toEqual([
      '== Б. Таблицы и рамки',
      '=== Б1. Подраздел',
      '== А. Лимиты',
      '=== А1. Подраздел',
      '=== А2. Второй подраздел',
      '== В. Остальное',
      '== Г. Сразу подраздел',
      '=== Г1. Единственный подраздел',
    ])
    expect(s.session.text).toContain('[[a]]\n== А. Лимиты')
    expect(s.session.text.length).toBe(FIXTURE.length)
    expect(s.session.undo()).toBeTruthy()
    expect(s.session.text).toBe(FIXTURE)
    expect(s.session.redo()).toBeTruthy()
    expect(titles(s.session.text)[0]).toBe('== Б. Таблицы и рамки')
  })

  it('keeps the lines: git diff of a move shows only moved lines', () => {
    const s = open(FIXTURE)
    s.editor.commands.moveBlock(at(FIXTURE, '== Б. Таблицы'), at(FIXTURE, '[[a]]'))
    expect([...s.session.text.split('\n')].sort()).toEqual([...FIXTURE.split('\n')].sort())
  })

  it('moves a block of code into another section, between two paragraphs', () => {
    const s = open(FIXTURE)
    const code = at(FIXTURE, '----\necho')
    const to = at(FIXTURE, 'Абзац подраздела А2.')
    expect(s.editor.commands.moveBlock(code, to)).toBe(true)
    const t = s.session.text
    expect(t.indexOf('echo "код А1"')).toBeGreaterThan(t.indexOf('=== А2.'))
    expect(t.indexOf('echo "код А1"')).toBeLessThan(t.indexOf('Абзац подраздела А2.'))
    s.session.undo()
    expect(s.session.text).toBe(FIXTURE)
  })

  it('puts a section after the last section of the document', () => {
    const s = open(FIXTURE)
    const slots = s.editor.dropSlots(true)
    expect(Array.isArray(slots)).toBe(true)
    const text = FIXTURE
    // the end of the document: after the last block (its line break is "after")
    const to = text.length - 1
    expect(s.editor.commands.moveBlock(at(text, '[[a]]'), to)).toBe(true)
    expect(titles(s.session.text).slice(-3)).toEqual(['== А. Лимиты', '=== А1. Подраздел', '=== А2. Второй подраздел'])
  })

  it('refuses a move into the block itself and keeps the text and the history', () => {
    const s = open(FIXTURE)
    const ok = s.editor.commands.moveBlock(at(FIXTURE, '[[a]]'), at(FIXTURE, 'Абзац подраздела А1.'))
    expect(ok).toBe(false)
    expect(s.session.text).toBe(FIXTURE)
    expect(s.rejects.length).toBe(1)
  })
})

describe('deleteBlockAt', () => {
  it('takes a table away with its caption and one blank line', () => {
    const s = open(FIXTURE)
    expect(s.editor.commands.deleteBlockAt(at(FIXTURE, '.Размеры'))).toBe(true)
    expect(s.session.text).not.toContain('Размеры')
    expect(s.session.text).not.toContain('|===')
    expect(s.session.text).toContain('Абзац раздела «Б».\n\n=== Б1.')
    s.session.undo()
    expect(s.session.text).toBe(FIXTURE)
  })

  it('takes a section away with its subsections', () => {
    const s = open(FIXTURE)
    expect(s.editor.commands.deleteBlockAt(at(FIXTURE, '[[a]]'))).toBe(true)
    expect(titles(s.session.text)).toEqual(['== Б. Таблицы и рамки', '=== Б1. Подраздел', '== В. Остальное', '== Г. Сразу подраздел', '=== Г1. Единственный подраздел'])
    s.session.undo()
    expect(s.session.text).toBe(FIXTURE)
  })
})

describe('setBlockTitle', () => {
  const para = at(FIXTURE, 'Первый абзац раздела')

  it('adds one line .Итоги over a paragraph', () => {
    const s = open(FIXTURE)
    expect(s.editor.commands.setBlockTitle(para, 'Итоги')).toBe(true)
    expect(s.session.text).toContain('\n.Итоги\nПервый абзац')
    expect(changedLines(FIXTURE, s.session.text)).toBe(1)
    s.session.undo()
    expect(s.session.text).toBe(FIXTURE)
  })

  it('changes only the line when there is a caption, and an empty title takes it away', () => {
    const s = open(FIXTURE)
    const table = at(FIXTURE, '.Размеры')
    expect(s.editor.commands.setBlockTitle(table, 'Размеры по группам')).toBe(true)
    expect(s.session.text).toContain('.Размеры по группам\n|===')
    expect(changedLines(FIXTURE, s.session.text)).toBe(1)
    expect(s.editor.commands.setBlockTitle(table, '')).toBe(true)
    expect(s.session.text).not.toContain('Размеры')
    s.session.undo()
    s.session.undo()
    expect(s.session.text).toBe(FIXTURE)
  })

  it('is the title of a collapsible block', () => {
    const s = open(FIXTURE)
    expect(s.editor.commands.setBlockTitle(at(FIXTURE, '.Подробности'), 'Детали')).toBe(true)
    expect(s.session.text).toContain('.Детали\n[%collapsible]')
  })

  it('does nothing when the title is the same', () => {
    const s = open(FIXTURE)
    expect(s.editor.commands.setBlockTitle(at(FIXTURE, '.Размеры'), 'Размеры')).toBe(true)
    expect(s.session.text).toBe(FIXTURE)
  })
})

describe('setBlockAnchor', () => {
  const para = at(FIXTURE, 'Первый абзац раздела')

  it('refuses an anchor that starts with a digit or a dash', () => {
    const s = open(FIXTURE)
    for (const v of ['1a', '-a', 'a b']) {
      expect(s.editor.commands.setBlockAnchor(para, v)).toBe(false)
      expect(s.session.text).toBe(FIXTURE)
    }
  })

  it('writes [[limity]] and the reference is no longer broken', () => {
    const s = open(FIXTURE)
    const broken = (): number => s.session.doc.diagnostics.filter((d) => /<<limity>>|limity/.test(s.session.text.slice(d.from, d.to))).length
    expect(broken()).toBeGreaterThan(0)
    expect(s.editor.commands.setBlockAnchor(para, 'limity')).toBe(true)
    expect(s.session.text).toContain('[[limity]]\nПервый абзац')
    expect(changedLines(FIXTURE, s.session.text)).toBe(1)
    expect(broken()).toBe(0)
    s.session.undo()
    expect(s.session.text).toBe(FIXTURE)
  })

  it('puts the anchor of a heading over the == line, under the ones it has', () => {
    const s = open(FIXTURE)
    expect(s.editor.commands.setBlockAnchor(at(FIXTURE, '== В. Остальное'), 'v')).toBe(true)
    expect(s.session.text).toContain('[[v]]\n== В. Остальное')
    expect(s.editor.commands.setBlockAnchor(at(s.session.text, '[[a]]'), 'b')).toBe(true)
    expect(s.session.text).toContain('[[b]]\n== А. Лимиты')
    expect(s.editor.commands.setBlockAnchor(at(s.session.text, '[[b]]'), '')).toBe(true)
    expect(s.session.text).not.toContain('[[b]]')
  })

  it('refuses a word with a space and an anchor another block has, and writes nothing', () => {
    const s = open(FIXTURE)
    expect(s.editor.commands.setBlockAnchor(para, 'два слова')).toBe(false)
    expect(s.rejects.at(-1)?.code).toBe('bad-anchor')
    expect(s.editor.commands.setBlockAnchor(para, 'a')).toBe(false)
    expect(s.rejects.at(-1)?.code).toBe('duplicate-anchor')
    expect(s.session.text).toBe(FIXTURE)
  })
})

describe('the handle sees the blocks', () => {
  it('names the block at an offset: kind, caption, anchor', () => {
    const s = open(FIXTURE)
    const sort = (mark: string): string | undefined => s.editor.blockAtOffset(at(FIXTURE, mark))?.sort
    expect(sort('Вводный абзац')).toBe('paragraph')
    expect(sort('[[a]]')).toBe('heading')
    expect(sort('* Первый пункт')).toBe('list')
    expect(sort('----\necho')).toBe('code')
    expect(sort('.Размеры')).toBe('table')
    expect(sort('[NOTE]')).toBe('admonition')
    expect(sort('.Подробности')).toBe('collapsible')
    expect(sort(':status:')).toBeUndefined()
    // a comment is an island and has a handle; a line of attributes has none (it is not a target of the operations)
    expect(sort('// Заметка')).toBe('island')
    const table = s.editor.blockAtOffset(at(FIXTURE, '.Размеры'))!
    expect(table.caption).toBe('Размеры')
    expect(s.editor.blockAtOffset(at(FIXTURE, '[[a]]'))!.anchor).toBe('a')
  })
})

describe('the places between blocks', () => {
  /** Lays the blocks out: block i of the editor is 50 high, 10 apart. */
  const layout = (el: HTMLElement): (() => void) => {
    const proto = HTMLElement.prototype
    const orig = proto.getBoundingClientRect
    proto.getBoundingClientRect = function (this: Element): DOMRect {
      const parent = this.parentElement
      const i = parent ? [...parent.children].indexOf(this) : 0
      const top = this.parentElement === el.querySelector('.ProseMirror') ? i * 60 : 0
      return { top, bottom: top + 50, left: 10, right: 100, width: 90, height: 50, x: 10, y: top, toJSON() {} } as DOMRect
    }
    return () => {
      proto.getBoundingClientRect = orig
    }
  }

  it('every place takes a paragraph or is refused with the notice; the lines stay the same', () => {
    const s = open(FIXTURE)
    const undo = layout(s.el)
    try {
      const slots = s.editor.dropSlots(false)
      expect(slots.length).toBeGreaterThan(10)
      for (const mark of ['Первый абзац раздела', 'Абзац подраздела А2.', 'Абзац раздела «В».']) {
        const from = s.editor.blockAtOffset(at(FIXTURE, mark))!.offset
        let moved = 0
        for (const slot of slots) {
          const t = FIXTURE
          const x = open(t)
          const ok = x.editor.commands.moveBlock(from, slot.to)
          if (ok && x.session.text !== t) {
            moved++
            const lines = (v: string): string[] => v.split('\n').filter((l) => l !== '').sort()
            expect(lines(x.session.text)).toEqual(lines(t))
            x.session.undo()
            expect(x.session.text).toBe(t)
          }
        }
        // at least the places in the same section and in the other ones work
        expect(moved).toBeGreaterThan(5)
      }
    } finally {
      undo()
    }
  })

  it('the place between a title and its first subsection is right under the title', () => {
    const s = open(FIXTURE)
    const undo = layout(s.el)
    try {
      const title = '== Г. Сразу подраздел\n'
      const place = at(FIXTURE, title) + title.length
      const slot = s.editor.dropSlots(false).find((x) => x.to === place)
      expect(slot).toBeDefined()
      const x = open(FIXTURE)
      expect(x.editor.commands.moveBlock(at(FIXTURE, 'Абзац подраздела А2.'), slot!.to)).toBe(true)
      const t = x.session.text
      expect(t.indexOf('== Г. Сразу')).toBeLessThan(t.indexOf('Абзац подраздела А2.'))
      expect(t.indexOf('Абзац подраздела А2.')).toBeLessThan(t.indexOf('=== Г1.'))
      x.session.undo()
      expect(x.session.text).toBe(FIXTURE)
    } finally {
      undo()
    }
  })

  it('the same when the subsection follows the title with no blank line', () => {
    const doc = '== Г\n=== Г1\nабзац г1\n\n== Д\n\nПараграф\n'
    const s = open(doc)
    const undo = layout(s.el)
    try {
      const place = doc.indexOf('=== Г1')
      const slot = s.editor.dropSlots(false).find((x) => x.to === place)
      expect(slot).toBeDefined()
      expect(s.editor.commands.moveBlock(doc.indexOf('Параграф'), slot!.to)).toBe(true)
      expect(s.session.text).toBe('== Г\nПараграф\n\n=== Г1\nабзац г1\n\n== Д\n\n')
      s.session.undo()
      expect(s.session.text).toBe(doc)
    } finally {
      undo()
    }
  })

  it('a section only goes before a section or at the end', () => {
    const s = open(FIXTURE)
    const undo = layout(s.el)
    try {
      const slots = s.editor.dropSlots(true)
      const from = at(FIXTURE, '[[a]]')
      let moved = 0
      for (const slot of slots) {
        const x = open(FIXTURE)
        if (x.editor.commands.moveBlock(from, slot.to) && x.session.text !== FIXTURE) {
          moved++
          expect(titles(x.session.text).length).toBe(titles(FIXTURE).length)
        }
      }
      expect(moved).toBeGreaterThanOrEqual(2)
    } finally {
      undo()
    }
  })
})
