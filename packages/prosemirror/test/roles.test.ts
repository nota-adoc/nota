// text with roles (`[.zz-a]#text#`) is edited as text; the roles stay on their characters, the rest of the
// source stays as it was. Roles in the examples are made up; the editor knows no names.
import { afterEach, describe, expect, it } from 'vitest'
import { projectDocument } from '@nota-adoc/prosemirror'
import { closeAll, composition, key, open, posIn, select, type } from './helpers.js'

afterEach(closeAll)

type Setup = ReturnType<typeof open>

/** The roles of every character of the block `i` of the screen: the `[…]` of the pieces around it, `-` for none. */
function roles(s: Setup, i = 0): string[] {
  const out: string[] = []
  s.editor.view.state.doc.child(i).forEach((c) => {
    if (!c.isText) return
    const r =
      c.marks
        .filter((m) => m.type.name === 'roles')
        .map((m) => m.attrs.attrs as string)
        .sort()
        .join('') || '-'
    for (let k = 0; k < c.text!.length; k++) out.push(r)
  })
  return out
}

const text = (s: Setup, i = 0): string => s.editor.view.state.doc.child(i).textContent
const inSync = (s: Setup): boolean => s.editor.view.state.doc.eq(projectDocument(s.session.doc))
const A = '[.zz-a]'

/** Roles of the characters of `word` in the block, as a list. */
function rolesOfWord(s: Setup, word: string, i = 0): string[] {
  const at = text(s, i).indexOf(word)
  return roles(s, i).slice(at, at + word.length)
}

describe('projection', () => {
  it('shows text with roles as text with classes, not as plates', () => {
    const s = open('Раз [.zz-a]#два# [.hl-qq.q1]##три## [zz-a]#четыре# [.zz-a]*пять*\n')
    const dom = s.editor.view.dom
    expect(dom.querySelector('.nota-inline-chip')).toBeNull()
    const classes = [...dom.querySelectorAll('span[class]')].map((e) => `${e.className}:${e.textContent}`)
    expect(classes).toEqual(['zz-a:два', 'hl-qq q1:три', 'zz-a:четыре', 'zz-a:пять'])
    expect(dom.querySelector('span.zz-a > strong, strong > span.zz-a')?.textContent).toBe('пять')
    expect(inSync(s)).toBe(true)
  })

  for (const [name, src, tag] of [
    ['a heading', '== Раз [.zz-a]#два#\n', 'h2'],
    ['the text of a link', 'https://e.example[раз [.zz-a]#два#]\n', 'a'],
    ['bold', '*жир [.zz-a]#два# жир*\n', 'strong'],
    ['italic', '_кур [.zz-a]#два# кур_\n', 'em'],
  ] as const) {
    it(`shows it in ${name}`, () => {
      const s = open(src)
      expect(s.editor.view.dom.querySelector('.nota-inline-chip')).toBeNull()
      expect(s.editor.view.dom.querySelector(`${tag} span.zz-a, span.zz-a ${tag}`)?.textContent).toBe('два')
      expect(inSync(s)).toBe(true)
    })
  }

  for (const src of ['[#i1.zz-a]#x#', '[.zz-{a}]#x#', '[.zz-a,k=v]#x#']) {
    it(`${src} stays a plate`, () => {
      const s = open(`а ${src}\n`)
      expect(s.editor.view.dom.querySelector('.nota-inline-chip')?.textContent).toBe(src)
    })
  }

  it('[.line-through] stays strikethrough', () => {
    const s = open('а [.line-through]#x#\n')
    expect(s.editor.view.dom.querySelector('s')?.textContent).toBe('x')
  })
})

describe('typing inside a piece', () => {
  const places: [string, string, string][] = [
    ['a paragraph', `Раз ${A}#два# три\n`, `Раз ${A}#джва# три\n`],
    ['a heading', `== Раз ${A}#два#\n`, `== Раз ${A}#джва#\n`],
    ['the text of a link', `https://e.example[раз ${A}#два#]\n`, `https://e.example[раз ${A}#джва#]\n`],
    ['bold', `*жир ${A}#два# жир*\n`, `*жир ${A}#джва# жир*\n`],
    ['italic', `_кур ${A}#два# кур_\n`, `_кур ${A}#джва# кур_\n`],
  ]
  for (const [name, src, want] of places) {
    it(`between two letters in ${name}`, () => {
      const s = open(src)
      const at = text(s).indexOf('два') + 1
      select(s.editor, posIn(s.editor, 0, at))
      type(s.editor, 'ж')
      expect(s.session.text).toBe(want)
      expect(inSync(s)).toBe(true)
    })
  }

  it('at the end of a piece goes inside, before its start stays outside', () => {
    const s = open(`Раз ${A}#два# три\n`)
    select(s.editor, posIn(s.editor, 0, 7))
    type(s.editor, 'х')
    expect(s.session.text).toBe(`Раз ${A}#двах# три\n`)
    select(s.editor, posIn(s.editor, 0, 4))
    type(s.editor, 'х')
    // (a marker after a letter is doubled: a single one would not be read)
    expect(s.session.text).toBe(`Раз х${A}##двах## три\n`)
    expect(rolesOfWord(s, 'х', 0)[0]).toBe('-')
    expect(rolesOfWord(s, 'двах')).toEqual(Array(4).fill(A))
  })

  it('a blank and a letter after the last letter keep the roles', () => {
    const s = open(`Раз ${A}#два# три\n`)
    select(s.editor, posIn(s.editor, 0, 7))
    type(s.editor, ' ')
    type(s.editor, 'у')
    expect(text(s)).toBe('Раз два у три')
    expect(rolesOfWord(s, 'два у')).toEqual(Array(5).fill(A))
    expect(s.session.text).toBe(`Раз ${A}##два у## три\n`)
    expect(inSync(s)).toBe(true)
  })
})

describe('deleting', () => {
  it('Backspace and Delete inside a piece', () => {
    const s = open(`Раз ${A}#два# три\n`)
    select(s.editor, posIn(s.editor, 0, 6))
    key(s.editor, 'Backspace')
    expect(s.session.text).toBe(`Раз ${A}#да# три\n`)
    key(s.editor, 'Delete')
    expect(s.session.text).toBe(`Раз ${A}#д# три\n`)
    expect(rolesOfWord(s, 'д')).toEqual([A])
  })

  it('a blank left at the end of a piece keeps the role', () => {
    const s = open(`${A}#раз д#\n`)
    select(s.editor, posIn(s.editor, 0, 5))
    key(s.editor, 'Backspace')
    expect(text(s)).toBe('раз ')
    expect(roles(s)).toEqual([A, A, A, A])
    expect(s.session.text).toBe(`${A}##раз ##\n`)
  })

  it('a selection from plain text to the middle of a piece: Backspace, or a letter typed over it', () => {
    const s = open(`Раз ${A}#два# три\n`)
    select(s.editor, posIn(s.editor, 0, 2), posIn(s.editor, 0, 5))
    type(s.editor, 'ю')
    expect(text(s)).toBe('Раюва три')
    expect(roles(s).slice(0, 5)).toEqual(['-', '-', '-', A, A])
    expect(s.session.text).toBe(`Раю${A}##ва## три\n`)
    select(s.editor, posIn(s.editor, 0, 2), posIn(s.editor, 0, 4))
    key(s.editor, 'Backspace')
    expect(text(s)).toBe('Раа три')
    expect(roles(s).slice(0, 3)).toEqual(['-', '-', A])
  })

  it('all the text of a piece takes the roles and the markers with it; Mod-Z brings it back', () => {
    const src = `Раз ${A}#два# три\n`
    const s = open(src)
    select(s.editor, posIn(s.editor, 0, 4), posIn(s.editor, 0, 7))
    key(s.editor, 'Backspace')
    expect(s.session.text).toBe('Раз  три\n')
    key(s.editor, 'z', { mod: true })
    expect(s.session.text).toBe(src)
    expect(inSync(s)).toBe(true)
  })
})

describe('Enter, Shift-Enter, joining', () => {
  it('Enter inside a piece gives two paragraphs, the roles on both halves', () => {
    const s = open(`Раз ${A}#два# три\n`)
    select(s.editor, posIn(s.editor, 0, 5))
    key(s.editor, 'Enter')
    expect(s.session.text).toBe(`Раз ${A}#д#\n\n${A}#ва# три\n`)
    expect(text(s, 0)).toBe('Раз д')
    expect(text(s, 1)).toBe('ва три')
    expect(rolesOfWord(s, 'д')).toEqual([A])
    expect(rolesOfWord(s, 'ва', 1)).toEqual([A, A])
    // Backspace at the start of the second one
    select(s.editor, posIn(s.editor, 1, 0))
    key(s.editor, 'Backspace')
    expect(s.editor.view.state.doc.childCount).toBe(1)
    // (the line break between the two paragraphs is a blank of the joined one)
    expect(text(s)).toBe('Раз д ва три')
    expect(rolesOfWord(s, 'д')).toEqual([A])
    expect(rolesOfWord(s, 'ва')).toEqual([A, A])
    expect(rolesOfWord(s, 'три')).toEqual(['-', '-', '-'])
    expect(inSync(s)).toBe(true)
  })

  it('Shift-Enter inside a piece breaks the line inside it', () => {
    const s = open(`Раз ${A}#два# три\n`)
    select(s.editor, posIn(s.editor, 0, 5))
    key(s.editor, 'Enter', { shift: true })
    expect(s.session.text).toMatch(/^Раз \[\.zz-a\]#д \+\nва# три\n$/)
    expect(inSync(s)).toBe(true)
  })
})

describe('paste and composition', () => {
  it('pastes plain text with a line break inside a piece', () => {
    const s = open(`Раз ${A}#два# три\n`)
    select(s.editor, posIn(s.editor, 0, 5))
    const data = { getData: () => 'ой\nей' }
    const ev = new Event('paste', { bubbles: true, cancelable: true }) as unknown as ClipboardEvent
    Object.defineProperty(ev, 'clipboardData', { value: data })
    s.editor.view.dom.dispatchEvent(ev)
    expect(text(s, 0)).toBe('Раз дой')
    expect(text(s, 1)).toBe('ейва три')
    expect(rolesOfWord(s, 'дой')).toEqual([A, A, A])
    expect(rolesOfWord(s, 'ей', 1)).toEqual([A, A])
    expect(inSync(s)).toBe(true)
  })

  it('an input method inside a piece types inside it, in one step of the history', async () => {
    const src = `Раз ${A}#два# три\n`
    const s = open(src)
    s.editor.focus()
    select(s.editor, posIn(s.editor, 0, 5))
    composition(s.editor, 'compositionstart')
    await new Promise((r) => setTimeout(r, 0))
    s.editor.view.dispatch(s.editor.view.state.tr.insertText('ж'))
    composition(s.editor, 'compositionend')
    await new Promise((r) => setTimeout(r, 0))
    expect(s.session.text).toBe(`Раз ${A}#джва# три\n`)
    s.session.undo()
    expect(s.session.text).toBe(src)
  })
})

describe('marks', () => {
  it('Mod-B on a letter inside a piece', () => {
    const s = open(`Раз ${A}#два# три\n`)
    select(s.editor, posIn(s.editor, 0, 5), posIn(s.editor, 0, 6))
    key(s.editor, 'b', { mod: true })
    expect(rolesOfWord(s, 'два')).toEqual([A, A, A])
    expect(s.editor.view.dom.querySelector('strong')?.textContent).toBe('в')
    expect(s.session.text).toBe(`Раз ${A}#д**в**а# три\n`)
  })

  it('Mod-B over plain text and a piece gives roles only to the piece', () => {
    const s = open(`Раз ${A}#два# три\n`)
    select(s.editor, posIn(s.editor, 0, 0), posIn(s.editor, 0, 7))
    key(s.editor, 'b', { mod: true })
    expect(rolesOfWord(s, 'Раз')).toEqual(['-', '-', '-'])
    expect(rolesOfWord(s, 'два')).toEqual([A, A, A])
    expect(s.editor.view.dom.querySelector('strong')?.textContent).toBe('Раз два')
  })

  it('Mod-B takes bold off a bold piece, the role stays', () => {
    const s = open(`Раз ${A}*пять*\n`)
    select(s.editor, posIn(s.editor, 0, 4), posIn(s.editor, 0, 8))
    key(s.editor, 'b', { mod: true })
    expect(s.session.text).toBe(`Раз ${A}#пять#\n`)
    expect(s.editor.view.dom.querySelector('strong')).toBeNull()
    expect(rolesOfWord(s, 'пять')).toEqual(Array(4).fill(A))
  })

  it('Mod-B on a part of a bold piece keeps it one piece: its [..] is written once', () => {
    const s = open(`Раз ${A}*пять*\n`)
    select(s.editor, posIn(s.editor, 0, 5), posIn(s.editor, 0, 6))
    key(s.editor, 'b', { mod: true })
    expect(s.session.text).toBe(`Раз ${A}#**п**я**ть**#\n`)
    expect(rolesOfWord(s, 'пять')).toEqual(Array(4).fill(A))
    expect(inSync(s)).toBe(true)
  })

  it('Mod-B over plain text and a bold piece does not bold it twice', () => {
    const s = open(`Раз ${A}*пять*\n`)
    select(s.editor, posIn(s.editor, 0, 0), posIn(s.editor, 0, 8))
    key(s.editor, 'b', { mod: true })
    expect(s.session.text).not.toContain('**пять')
    expect(s.session.text).toContain(`${A}*пять*`)
    expect(rolesOfWord(s, 'пять')).toEqual(Array(4).fill(A))
  })

  it('Mod-Shift-H and Mod-Shift-X on a plain word next to a piece', () => {
    for (const [k, tag] of [
      ['h', 'mark'],
      ['x', 's'],
    ] as const) {
      const s = open(`Раз ${A}#два#\n`)
      select(s.editor, posIn(s.editor, 0, 0), posIn(s.editor, 0, 3))
      key(s.editor, k, { mod: true, shift: true })
      expect(s.editor.view.dom.querySelector(tag)?.textContent).toBe('Раз')
      expect(rolesOfWord(s, 'Раз')).toEqual(['-', '-', '-'])
      expect(rolesOfWord(s, 'два')).toEqual([A, A, A])
      expect(s.rejects).toEqual([])
    }
  })
})

describe('links and the style of a paragraph', () => {
  it('a link over a part of a piece, then taken off', () => {
    const s = open(`Раз ${A}#два три# х\n`)
    select(s.editor, posIn(s.editor, 0, 8), posIn(s.editor, 0, 11))
    expect(s.editor.commands.setLink('https://e.example')).toBe(true)
    expect(s.session.text).toBe(`Раз ${A}#два https://e.example[три]# х\n`)
    expect(rolesOfWord(s, 'два три')).toEqual(Array(7).fill(A))
    expect(s.editor.view.dom.querySelector('a')?.textContent).toBe('три')
    select(s.editor, posIn(s.editor, 0, 9))
    expect(s.editor.commands.removeLink()).toBe(true)
    expect(s.editor.view.dom.querySelector('a')).toBeNull()
    expect(rolesOfWord(s, 'два три')).toEqual(Array(7).fill(A))
    expect(s.session.text).toBe(`Раз ${A}#два три# х\n`)
  })

  it('removeLink on a link that holds a piece', () => {
    const s = open(`https://e.example[раз ${A}#два#] х\n`)
    select(s.editor, posIn(s.editor, 0, 2))
    expect(s.editor.commands.removeLink()).toBe(true)
    expect(s.session.text).toBe(`раз ${A}#два# х\n`)
    expect(rolesOfWord(s, 'два')).toEqual([A, A, A])
  })

  it('Mod-Alt-2 and Mod-Alt-0', () => {
    const s = open(`Раз ${A}#два# три\n`)
    select(s.editor, posIn(s.editor, 0, 5))
    key(s.editor, '2', { mod: true, alt: true })
    expect(s.session.text).toBe(`== Раз ${A}#два# три\n`)
    expect(rolesOfWord(s, 'два')).toEqual([A, A, A])
    key(s.editor, '0', { mod: true, alt: true })
    expect(s.session.text).toBe(`Раз ${A}#два# три\n`)
  })
})

describe('a role is not made up', () => {
  it('typed outside pieces and on the place of a deleted piece has no roles', () => {
    const s = open(`Раз ${A}#два# три\n`)
    select(s.editor, posIn(s.editor, 0, 11))
    type(s.editor, 'х')
    expect(s.session.text).toBe(`Раз ${A}#два# трих\n`)
    select(s.editor, posIn(s.editor, 0, 4), posIn(s.editor, 0, 7))
    key(s.editor, 'Backspace')
    type(s.editor, 'у')
    expect(s.session.text).toBe('Раз у трих\n')
  })

  it('cut from a piece and pasted elsewhere has no roles', () => {
    const s = open(`Раз ${A}#два# три\n`)
    select(s.editor, posIn(s.editor, 0, 4), posIn(s.editor, 0, 7))
    let copied = ''
    const cut = new Event('cut', { bubbles: true, cancelable: true }) as unknown as ClipboardEvent
    Object.defineProperty(cut, 'clipboardData', {
      value: { setData: (_t: string, v: string) => (copied = v) },
    })
    s.editor.view.dom.dispatchEvent(cut)
    expect(copied).toBe('два')
    select(s.editor, posIn(s.editor, 0, 5))
    const paste = new Event('paste', { bubbles: true, cancelable: true }) as unknown as ClipboardEvent
    Object.defineProperty(paste, 'clipboardData', { value: { getData: () => copied } })
    s.editor.view.dom.dispatchEvent(paste)
    // (the piece went with the cut: Backspace-like deletion of all its text; paste goes to the plain text left)
    expect(s.session.text).toBe('Раз  дватри\n')
    expect(s.session.text).not.toContain('[')
  })
})

describe('plates around pieces', () => {
  const doc = [
    'Термин:: Пункт [.zz-a]#раз#',
    '',
    'Абзац',
    '',
    '[NOTE]',
    'Текст [.zz-a]#раз#',
    '',
    '====',
    'Внутри [.zz-a]#раз#',
    '====',
    '',
    '.Подпись [.zz-a]#раз#',
    '|===',
    '|a',
    '|===',
    '',
    'Конец',
    '',
  ].join('\n')

  it('are shown as before, and typing and deleting around them leave their source as it was', () => {
    const s = open(doc)
    const before = s.session.text
    expect(s.editor.view.dom.querySelectorAll('.nota-island').length).toBeGreaterThan(2)
    expect(inSync(s)).toBe(true)
    // a paragraph between plates
    const i = [...Array(s.editor.view.state.doc.childCount).keys()].find((k) => text(s, k) === 'Абзац')!
    select(s.editor, posIn(s.editor, i, 2))
    type(s.editor, 'х')
    expect(s.session.text).toBe(before.replace('Абзац', 'Абхзац'))
    key(s.editor, 'Backspace')
    expect(s.session.text).toBe(before)
    key(s.editor, 'Enter')
    key(s.editor, 'Backspace')
    // (joined again, the two halves are two lines of one paragraph)
    expect(s.session.text.replace('Аб\nзац', 'Абзац')).toBe(before)
    expect(inSync(s)).toBe(true)
  })

  it('a change of the source on the same session shows on the screen', () => {
    const s = open(doc)
    const at = s.session.text.indexOf('раз')
    s.session.apply([{ from: at + 1, to: at + 1, insert: 'ы' }])
    expect(inSync(s)).toBe(true)
    expect(s.editor.view.dom.textContent).toContain('рыаз')
    // nothing else changed: the text is the old one with the one letter
    expect(s.session.text).toBe(doc.slice(0, at + 1) + 'ы' + doc.slice(at + 1))
  })

  it('a change of the source in every piece of a plate shows, and only that changes', () => {
    const s = open(doc)
    let text = s.session.text
    // from the last to the first, so that the places hold
    const places = [...text.matchAll(/раз/g)].map((m) => m.index!).reverse()
    expect(places.length).toBe(4)
    for (const at of places) {
      s.session.apply([{ from: at + 1, to: at + 1, insert: 'ы' }])
      text = text.slice(0, at + 1) + 'ы' + text.slice(at + 1)
      expect(s.session.text).toBe(text)
      expect(inSync(s)).toBe(true)
    }
    expect(s.editor.view.dom.textContent?.match(/рыаз/g)?.length).toBe(4)
  })

  it('a cell of a nested table shows its source; the paragraphs around it are edited, its source stays', () => {
    const src = [
      'Абзац',
      '',
      '|===',
      'a|Ячейка:',
      '',
      '!===',
      `!Вложенная ${A}#раз#`,
      '!===',
      '|===',
      '',
      'Конец',
      '',
    ].join('\n')
    const s = open(src)
    // (a table is a grid; its cells show the roles as a paragraph does)
    expect(s.editor.view.dom.querySelector('.nota-island')).toBeNull()
    expect(s.editor.view.dom.querySelector('table table')).not.toBeNull()
    expect(s.editor.view.dom.querySelector('table table .zz-a')!.textContent).toBe('раз')
    select(s.editor, posIn(s.editor, 0, 2))
    type(s.editor, 'х')
    expect(s.session.text).toBe(src.replace('Абзац', 'Абхзац'))
    const last = s.editor.view.state.doc.childCount - 1
    select(s.editor, posIn(s.editor, last, 0), posIn(s.editor, last, 2))
    key(s.editor, 'Backspace')
    expect(s.session.text).toBe(src.replace('Абзац', 'Абхзац').replace('Конец', 'нец'))
    expect(inSync(s)).toBe(true)
    const at = s.session.text.indexOf('раз')
    s.session.apply([{ from: at + 1, to: at + 1, insert: 'ы' }])
    expect(inSync(s)).toBe(true)
    expect(s.editor.view.dom.textContent).toContain('рыаз')
  })

  it('a caption over a paragraph is shown as grey service lines, and the paragraph is edited', () => {
    const src = `.Подпись ${A}#раз#\nАбзац ${A}#два# конец\n`
    const s = open(src)
    const dom = s.editor.view.dom
    expect(dom.querySelector('.nota-island')).toBeNull()
    expect(dom.querySelector('p')?.getAttribute('data-meta')).toBe(`.Подпись ${A}#раз#\n`)
    expect(inSync(s)).toBe(true)
    // the caption is not a piece of the paragraph: its roles are not shown as roles
    expect(dom.querySelectorAll('.zz-a').length).toBe(1)
    expect(dom.textContent).toBe('Абзац два конец')
    const i = s.editor.view.state.doc.childCount - 1
    select(s.editor, posIn(s.editor, i, text(s, i).indexOf('конец')))
    type(s.editor, 'х')
    expect(s.session.text).toBe(src.replace('конец', 'хконец'))
    expect(s.session.text.startsWith(`.Подпись ${A}#раз#\n`)).toBe(true)
    const at = s.session.text.indexOf('раз')
    s.session.apply([{ from: at + 1, to: at + 1, insert: 'ы' }])
    expect(s.session.text).toBe(src.replace('конец', 'хконец').replace('раз', 'рыаз'))
    expect(inSync(s)).toBe(true)
  })
})

describe('the rest of the text and the history', () => {
  it('after a run of actions the text outside the pieces is as it was; undo takes all back, redo brings the last', () => {
    const src = `Раз ${A}#два# [.hl-qq.q1]##три## [zz-a]#четыре# ${A}*пять* конец\n`
    const s = open(src)
    const marks = (t: string): string[] => t.match(/\[[^\]]*\]/g) ?? []
    select(s.editor, posIn(s.editor, 0, 5))
    type(s.editor, 'ж')
    select(s.editor, posIn(s.editor, 0, 12), posIn(s.editor, 0, 13))
    key(s.editor, 'b', { mod: true })
    select(s.editor, posIn(s.editor, 0, 1))
    key(s.editor, 'Backspace')
    expect(marks(s.session.text)).toEqual(marks(src))
    const last = s.session.text
    let guard = 0
    while (s.session.text !== src && guard++ < 10) key(s.editor, 'z', { mod: true })
    expect(s.session.text).toBe(src)
    key(s.editor, 'y', { mod: true })
    expect(s.session.text).not.toBe(src)
    for (let k = 0; k < 5; k++) key(s.editor, 'y', { mod: true })
    expect(s.session.text).toBe(last)
    expect(inSync(s)).toBe(true)
  })

  it('a selection from a paragraph to the edge of a plate leaves the plate as it was', () => {
    const s = open(`Абзац\n\n* Пункт ${A}#раз#\n\nКонец\n`)
    const plate = `* Пункт ${A}#раз#\n`
    select(s.editor, posIn(s.editor, 0, 2), posIn(s.editor, 0, 5))
    key(s.editor, 'Backspace')
    expect(s.session.text).toContain(plate)
    expect(inSync(s)).toBe(true)
  })
})
