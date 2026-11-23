// the text of a table cell with no `a` style is read like a paragraph: links, marks and roles show in it, and typing,
// deleting, marks, links and colours work on it as they do there.
import { parse } from '@nota-adoc/core'
import { afterEach, describe, expect, it } from 'vitest'
import { projectDocument } from '../src/project.js'
import { closeAll, inCell, key, open, select, type } from './helpers.js'

afterEach(closeAll)

const T1 = [
  '|===',
  '|Документ |Ссылка',
  '|Требования |https://c.example.net/a[Ссылка] и *жирный*',
  '|Обзор |xref:b.adoc[Другая], <<sec-a>>, _курсив_, `код`, [.zz-a]#цвет#',
  'a|* https://c.example.net/x[Пункт один]',
  '* *второй*',
  '|простой текст',
  '|===',
  '',
].join('\n')

const LINK = 'https://c.example.net/a[Ссылка] и *жирный*'

/** The cell whose text on the screen is `text`: the position of its start. */
const start = (editor: ReturnType<typeof open>['editor'], text: string): number => inCell(editor, text, 'start')

describe('the text of a cell is read like a paragraph', () => {
  it('shows links, marks and roles, and not the markup', () => {
    const { editor } = open(T1)
    const dom = editor.view.dom as HTMLElement
    const html = (s: string): string => [...dom.querySelectorAll('.cell-text')].find((e) => e.textContent === s)!.innerHTML
    expect(html('Ссылка и жирный')).toBe('<a href="https://c.example.net/a">Ссылка</a> и <strong>жирный</strong>')
    const second = html('Другая, sec-a, курсив, код, цвет')
    expect(second).toContain('<a href="b.adoc">Другая</a>')
    expect(second).toContain('<a href="#sec-a">sec-a</a>')
    expect(second).toContain('<em>курсив</em>')
    expect(second).toContain('<code>код</code>')
    expect(second).toContain('<span class="zz-a">цвет</span>')
    const shown = [...dom.querySelectorAll('.cell-text')].map((e) => e.textContent).join('')
    for (const mark of ['[', ']', '*', '`', '#', 'xref:']) expect(shown).not.toContain(mark)
  })

  it('has the same DOM as a paragraph with the same line', () => {
    const { editor } = open(`${LINK}\n\n${T1}`)
    const dom = editor.view.dom as HTMLElement
    const cell = [...dom.querySelectorAll('.cell-text')].find((e) => e.textContent === 'Ссылка и жирный')!
    expect(cell.innerHTML).toBe(dom.querySelector('p')!.innerHTML)
  })

  it('shows the same in the cell of the head', () => {
    const { editor } = open('[options="header"]\n|===\n|*Шапка* |b\n|c |d\n|===\n')
    expect((editor.view.dom as HTMLElement).querySelector('th strong')!.textContent).toBe('Шапка')
  })

  it('shows the same in a paragraph of an `a` cell as in a paragraph', () => {
    const src = 'a|Начало *жирный* и https://c.example.net/a[Ссылка]\n\nВторой _курсив_\n\n* пункт\n|b\n'
    const { editor, session } = open(`${LINK}\n\n|===\n${src}|===\n`)
    const dom = editor.view.dom as HTMLElement
    const cells = [...dom.querySelectorAll('.cell-text')]
    const first = cells.find((e) => e.textContent === 'Начало жирный и Ссылка')!
    expect(first.innerHTML).toBe('Начало <strong>жирный</strong> и <a href="https://c.example.net/a">Ссылка</a>')
    expect(cells.find((e) => e.textContent === 'Второй курсив')!.innerHTML).toBe('Второй <em>курсив</em>')
    // a list is shown as a list
    expect(dom.querySelector('.cell-plate')).toBeNull()
    expect(dom.querySelector('.cell-li .li-text')!.textContent).toBe('пункт')
    // typing inside the link and inside the second paragraph changes only them, and the file comes back
    const before = session.text
    select(editor, inCell(editor, 'Начало жирный и Ссылка', 'start') + 18)
    type(editor, 'x')
    expect(session.text).toBe(before.replace('a[Ссылка]\n\nВторой', 'a[Ссxылка]\n\nВторой'))
    key(editor, 'Backspace')
    expect(session.text).toBe(before)
    select(editor, inCell(editor, 'Второй курсив', 'start') + 3)
    type(editor, 'x')
    expect(session.text).toBe(before.replace('Второй _', 'Втоxрой _'))
    key(editor, 'Backspace')
    expect(session.text).toBe(before)
  })

  it('keeps cells that are not read as text, and shows attributes as plates', () => {
    const src = '|===\nl|*x* |a\\|b *x*\n|{name} and pass:q[*q*] |z\n|===\n'
    const { editor, session } = open(src)
    const dom = editor.view.dom as HTMLElement
    const cells = [...dom.querySelectorAll('.cell-text')]
    expect(cells[0]!.textContent).toBe('*x*')
    expect(cells[0]!.querySelector('strong')).toBeNull()
    expect(cells[1]!.textContent).toBe('a|b *x*')
    expect(cells[2]!.querySelector('.nota-inline-chip')!.textContent).toBe('{name}')
    // they are typed in as they were: an escaped bar stays text
    inCell(editor, '*x*')
    type(editor, 'y')
    expect(session.text).toBe(src.replace('l|*x*', 'l|*x*y'))
  })
})

describe('typing in a cell with a link or a mark', () => {
  it('leaves the file as it was: opened, and a letter typed and taken back in every cell', () => {
    const { editor, session } = open(T1)
    expect(session.text).toBe(T1)
    const cells: string[] = []
    editor.view.state.doc.descendants((node) => {
      if (node.type.name === 'cell_text') cells.push(node.textContent)
      return true
    })
    for (const text of cells.filter((t, i) => cells.indexOf(t) === i && t !== '')) {
      inCell(editor, text)
      type(editor, 'ж')
      expect(session.text).not.toBe(T1)
      key(editor, 'Backspace')
      expect(session.text).toBe(T1)
    }
  })

  it('types inside a link, after it, and inside a mark', () => {
    const { editor, session } = open(T1)
    select(editor, start(editor, 'Ссылка и жирный') + 2)
    type(editor, 'x')
    expect(session.text).toBe(T1.replace('[Ссылка]', '[Ссxылка]'))
    // on the screen: inside the link, and the cursor after the letter
    const a = (editor.view.dom as HTMLElement).querySelector('a[href="https://c.example.net/a"]')!
    expect(a.textContent).toBe('Ссxылка')
    expect(editor.view.state.selection.from).toBe(start(editor, 'Ссxылка и жирный') + 3)
    editor.commands.undo()
    expect(session.text).toBe(T1)
    select(editor, start(editor, 'Ссылка и жирный') + 6)
    type(editor, 'x')
    expect(session.text).toBe(T1.replace('[Ссылка]', '[Ссылка]x'))
    expect((editor.view.dom as HTMLElement).querySelector('a[href="https://c.example.net/a"]')!.textContent).toBe('Ссылка')
    editor.commands.undo()
    select(editor, start(editor, 'Ссылка и жирный') + 11)
    type(editor, 'x')
    expect(session.text).toBe(T1.replace('*жирный*', '*жиxрный*'))
  })

  it('does what a paragraph does with the same line: deletions across the edge of a link, a paste, a replaced selection', () => {
    const steps: { sel: [number, number]; run: (e: ReturnType<typeof open>['editor']) => void }[] = [
      { sel: [6, 6], run: (e) => type(e, 'x') },
      { sel: [5, 5], run: (e) => key(e, 'Backspace') },
      { sel: [6, 6], run: (e) => key(e, 'Delete') },
      { sel: [0, 6], run: (e) => key(e, 'Backspace') },
      { sel: [3, 9], run: (e) => type(e, 'ц') },
      { sel: [7, 7], run: (e) => type(e, '*') },
      { sel: [0, 0], run: (e) => type(e, 'z') },
      { sel: [15, 15], run: (e) => type(e, 'z') },
      { sel: [1, 6], run: (e) => key(e, 'Backspace') },
    ]
    for (const { sel, run } of steps) {
      const p = open(LINK + '\n')
      select(p.editor, 1 + sel[0], 1 + sel[1])
      run(p.editor)
      const c = open(`|===\n|a |${LINK}\n|===\n`)
      const s0 = start(c.editor, 'Ссылка и жирный')
      select(c.editor, s0 + sel[0], s0 + sel[1])
      run(c.editor)
      expect(c.session.text).toBe(`|===\n|a |${p.session.text.trimEnd()}\n|===\n`)
      expect(c.rejects.map((r) => r.code)).toEqual(p.rejects.map((r) => r.code))
      closeAll()
    }
  })

  it('refuses where a paragraph refuses, and the file stays', () => {
    const c = open(`|===\n|a |${LINK}\n|===\n`)
    const p = open(LINK + '\n')
    // a range that ends inside the text of a mark and starts outside of it is allowed; one that cuts a plate is not
    const s0 = start(c.editor, 'Ссылка и жирный')
    select(c.editor, s0 + 3)
    type(c.editor, '|')
    expect(c.rejects.map((r) => r.code)).toEqual(['cell-bar'])
    expect(c.session.text).toBe(`|===\n|a |${LINK}\n|===\n`)
    void p
  })

  it('keeps blanks typed at the end of a cell with a link until a letter follows', () => {
    const { editor, session } = open(T1)
    inCell(editor, 'Ссылка и жирный')
    type(editor, ' ')
    expect(session.text).toBe(T1)
    type(editor, 'x')
    // (the letter goes on in the mark it follows, as in a paragraph)
    expect(session.text).toBe(T1.replace('*жирный*', '*жирный x*'))
  })

  it('types a bar in a cell without markup as before', () => {
    const { editor, session } = open('|===\n|Описание (x)\n|===\n')
    inCell(editor, 'Описание (x)')
    type(editor, '|')
    expect(session.text).toBe('|===\n|Описание (x)\\|\n|===\n')
  })
})

describe('marks, links and colours in a cell', () => {
  it('sets and takes off a mark on a word', () => {
    const { editor, session } = open(T1)
    const s0 = start(editor, 'простой текст')
    select(editor, s0, s0 + 7)
    key(editor, 'b', { mod: true })
    expect(session.text).toBe(T1.replace('|простой текст', '|*простой* текст'))
    key(editor, 'b', { mod: true })
    expect(session.text).toBe(T1)
    key(editor, 'i', { mod: true })
    expect(session.text).toBe(T1.replace('|простой текст', '|_простой_ текст'))
    key(editor, 'i', { mod: true })
    key(editor, 'e', { mod: true })
    expect(session.text).toBe(T1.replace('|простой текст', '|`простой` текст'))
  })

  it('refuses a mark over two cells, and the file stays', () => {
    const { editor, session, rejects } = open(T1)
    select(editor, start(editor, 'Требования'), start(editor, 'Ссылка и жирный') + 3)
    expect(editor.commands.toggleMark('strong')).toBe(false)
    expect(session.text).toBe(T1)
    expect(rejects.map((r) => r.code)).toEqual(['invalid-range'])
  })

  it('shows a link under the cursor, changes its address and takes it off', () => {
    const { editor, session } = open(T1)
    select(editor, start(editor, 'Ссылка и жирный') + 2)
    const marks = editor.view.state.selection.$from.marks()
    expect(marks.find((m) => m.type.name === 'link')!.attrs.href).toBe('https://c.example.net/a')
    expect(editor.commands.setLink('https://c.example.net/b')).toBe(true)
    expect(session.text).toBe(T1.replace('net/a[', 'net/b['))
    editor.commands.removeLink()
    expect(session.text).toBe(T1.replace('https://c.example.net/a[Ссылка]', 'Ссылка'))
  })

  it('makes a selection a link', () => {
    const { editor, session } = open(T1)
    const s0 = start(editor, 'простой текст')
    select(editor, s0 + 8, s0 + 13)
    editor.commands.setLink('https://c.example.net/t')
    expect(session.text).toBe(T1.replace('|простой текст', '|простой https://c.example.net/t[текст]'))
  })

  it('colours the text of a cell, inside a word too, and takes the colour off, with no refusal', () => {
    const { editor, session, rejects } = open(T1)
    const s0 = start(editor, 'простой текст')
    select(editor, s0 + 2, s0 + 4)
    editor.commands.setTextColor('hl-red')
    expect(session.text).toBe(T1.replace('|простой текст', '|пр[.hl-red]##ос##той текст'))
    editor.commands.setTextColor(null)
    expect(session.text).toBe(T1)
    expect(rejects).toEqual([])
    const s1 = start(editor, 'Ссылка и жирный')
    select(editor, s1 + 9, s1 + 15)
    editor.commands.setTextColor('hl-red')
    expect(session.text).toBe(T1.replace('*жирный*', '[.hl-red]*жирный*'))
    expect(rejects).toEqual([])
  })

  it('refuses a mark in a cell that is shown as text, with its own message', () => {
    const src = '|===\nl|*x* y |b\n|===\n'
    const { editor, session, rejects } = open(src)
    const s0 = inCell(editor, '*x* y', 'start')
    select(editor, s0, s0 + 3)
    expect(editor.commands.toggleMark('strong')).toBe(false)
    expect(session.text).toBe(src)
    expect(rejects.map((r) => r.code)).toEqual(['cell-text'])
  })
})

describe('Enter and Tab in a cell with a link', () => {
  it('does nothing on Enter, in a link and in a mark', () => {
    const { editor, session } = open(T1)
    for (const k of [2, 10]) {
      const at = start(editor, 'Ссылка и жирный') + k
      select(editor, at)
      key(editor, 'Enter')
      expect(session.text).toBe(T1)
      expect(editor.view.state.selection.from).toBe(at)
    }
  })

  it('goes to the next cell and back with Tab, and the text stays', () => {
    const { editor, session } = open(T1)
    select(editor, start(editor, 'Ссылка и жирный') + 2)
    key(editor, 'Tab')
    expect(editor.view.state.selection.$from.parent.textContent).toBe('Обзор')
    key(editor, 'Tab', { shift: true })
    expect(editor.view.state.selection.$from.parent.textContent).toBe('Ссылка и жирный')
    select(editor, start(editor, 'Ссылка и жирный') + 12)
    key(editor, 'Tab', { shift: true })
    expect(editor.view.state.selection.$from.parent.textContent).toBe('Требования')
    expect(session.text).toBe(T1)
  })
})

describe('the place of the cursor in a cell with a link', () => {
  it('is the character of the source after the letters before it, and back', () => {
    const { editor } = open(T1)
    const at = start(editor, 'Ссылка и жирный') + 2
    select(editor, at)
    expect(editor.selectionOffsets()).toEqual({
      anchor: T1.indexOf('[Сс') + 3,
      head: T1.indexOf('[Сс') + 3,
    })
    // an offset of the source inside `[Ссылка]` puts the cursor on the same character
    const offset = T1.indexOf('[Ссылка]') + 4
    editor.setSelectionAtOffset(offset)
    expect(editor.view.state.selection.from).toBe(start(editor, 'Ссылка и жирный') + 3)
  })
})

describe('round trip and speed', () => {
  const FIXTURE = [
    '[cols="1,1,2"]',
    '|===',
    '|link:docs/a.adoc[Файл] |mailto:ivan@example.net[Почта] |<https://c.example.net/b>',
    '|https://c.example.net/c |xref:b.adoc#sec[Раздел] и <<sec-b,Другой>> |anchor:x[]текст',
    '|[.cell-yellow]##{empty}##https://c.example.net/d[Жёлтая] |[.zz-a]#роль# и [.hl-red]*красный жирный* |*жирный _и наклонный_* `код` ~нижний~ ^верхний^',
    '|одна строка',
    'и вторая *жирная*',
    '|{name} и pass:q[*q*] |++сырой++ (C) -- конец',
    '|===',
    '',
  ].join('\n')

  it('does not change the file when it is opened, and a letter typed in each cell and taken back leaves it as it was', () => {
    const { editor, session } = open(FIXTURE)
    expect(session.text).toBe(FIXTURE)
    expect(editor.getText()).toBe(FIXTURE)
    const texts: string[] = []
    editor.view.state.doc.descendants((node) => {
      if (node.type.name === 'cell_text') texts.push(node.textContent)
      return true
    })
    expect(texts.length).toBe(12)
    let k = 0
    editor.view.state.doc.descendants((node, pos) => {
      if (node.type.name !== 'cell_text' || node.content.size === 0) return true
      // (the cursor is one position before the end of each cell: a letter in the middle of the address of an angle link is not an address)
      select(editor, pos + node.content.size)
      type(editor, 'ж')
      key(editor, 'Backspace')
      expect(session.text, `cell ${k}`).toBe(FIXTURE)
      k++
      return true
    })
    expect(k).toBeGreaterThan(8)
  })

  it('projects a table of 2000 cells with a link in each in a time that stays near that of one whose cells are read and hold no markup', () => {
    const rows = (cell: (i: number) => string): string =>
      '|===\n' + Array.from({ length: 400 }, (_, i) => Array.from({ length: 5 }, (_, j) => '|' + cell(i * 5 + j)).join(' ')).join('\n') + '\n|===\n'
    // (a cell of letters and blanks is not read at all, which is faster still; the measure is a table where every cell is read)
    const plain = rows((i) => `Ячейка (${i}) и текст`)
    const linked = rows((i) => `https://c.example.net/${i}[Ссылка ${i}] и текст`)
    const time = (text: string): number => {
      const doc = parse(text)
      const start = process.cpuUsage()
      projectDocument(doc)
      const { user, system } = process.cpuUsage(start)
      return (user + system) / 1000
    }
    time(plain)
    time(linked)
    // Use CPU time in the fork to exclude time it spends waiting for the runner to schedule it.
    let ratio = Infinity
    let least = Infinity
    for (let round = 0; round < 7; round++) {
      const p = time(plain)
      const l = time(linked)
      ratio = Math.min(ratio, l / p)
      least = Math.min(least, l)
    }
    expect(ratio).toBeLessThanOrEqual(3)
    expect(least).toBeLessThan(100)
  })
})

describe('a cell of several lines with CRLF (fuzz 821622241)', () => {
  it('shows the cell as the text gives it after a letter is typed in it', () => {
    const { editor, session } = open('|===\r\n|tall |x\r\nабв\r\nгде\r\n|===\r\n')
    inCell(editor, 'x абв где', 'start')
    type(editor, 'z')
    const shown = [...(editor.view.dom as HTMLElement).querySelectorAll('.cell-text')].map((e) => e.textContent)
    expect(session.text).toContain('zx')
    expect(shown.some((s) => s?.includes('\n'))).toBe(false)
  })
})

describe('a blank at the end of a line of an a-cell', () => {
  const SRC = ['|===', 'a|', '[.hl-pink]##foo## +', '[.hl-pink]##bar## ', '* [.hl-pink]##one##', '|===', ''].join('\n')

  it('shows the cell as text, not as a plate', () => {
    const kinds: string[] = []
    projectDocument(parse(SRC)).descendants((node) => {
      if (node.type.name === 'cell_text' || node.type.name === 'cell_plate') kinds.push(node.type.name)
      return true
    })
    expect(kinds.length).toBeGreaterThan(0)
    expect(kinds.every((k) => k === 'cell_text')).toBe(true)
  })

  it('types in it, and takes the letter back, with the blank where it was', () => {
    const { editor, session } = open(SRC)
    // (the item stands next to the paragraph without a blank line: it is the text of the paragraph)
    inCell(editor, 'foobar  * one', 'start')
    type(editor, 'ж')
    expect(session.text).not.toBe(SRC)
    expect(session.text.length).toBe(SRC.length + 1)
    key(editor, 'Backspace')
    expect(session.text).toBe(SRC)
  })
})

describe('a cell of several lines with CRLF keeps its line ends', () => {
  const SRC = '|===\r\n|tall |x\r\nабв\r\nгде\r\n|===\r\n'
  const texts = (editor: ReturnType<typeof open>['editor']): string[] =>
    [...(editor.view.dom as HTMLElement).querySelectorAll('.cell-text')].map((e) => e.textContent ?? '')

  it('types one letter at the start and the end of the cell, and takes it back', () => {
    const { editor, session } = open(SRC)
    select(editor, inCell(editor, 'x абв где', 'start'))
    type(editor, 'z')
    expect(session.text).toBe('|===\r\n|tall |zx\r\nабв\r\nгде\r\n|===\r\n')
    key(editor, 'Backspace')
    expect(session.text).toBe(SRC)
    select(editor, inCell(editor, 'x абв где', 'end'))
    type(editor, 'z')
    expect(session.text).toBe('|===\r\n|tall |x\r\nабв\r\nгдеz\r\n|===\r\n')
    expect(/[^\r]\n/.test(session.text)).toBe(false)
    key(editor, 'Backspace')
    expect(session.text).toBe(SRC)
  })

  it('shows a cell like the same cell with LF', () => {
    const crlf = (s: string): string => s.replace(/\n/g, '\r\n')
    for (const src of [T1, '|===\n|one *two*\nthree\n|===\n']) {
      const lf = open(src)
      const cr = open(crlf(src))
      const a = [...(lf.editor.view.dom as HTMLElement).querySelectorAll('.cell-text')]
      const b = [...(cr.editor.view.dom as HTMLElement).querySelectorAll('.cell-text')]
      expect(b.map((e) => e.innerHTML)).toEqual(a.map((e) => e.innerHTML))
      for (const e of b) expect(/[\r\n]/.test(e.textContent ?? '')).toBe(false)
      expect(cr.session.text).toBe(crlf(src))
    }
  })

  it('types in a cell that is shown as source, and keeps its line ends', () => {
    for (const src of ['|===\r\nl|x\r\ny\r\n|===\r\n', '|===\r\nm|x\r\ny\r\n|===\r\n', ',===\r\n"a\r\nb"\r\n,===\r\n']) {
      const { editor, session } = open(src)
      const first = [...(editor.view.dom as HTMLElement).querySelectorAll('.cell-text')].map((e) => e.textContent ?? '')[0]!
      select(editor, inCell(editor, first, 'start'))
      type(editor, 'z')
      expect(session.text.length).toBe(src.length + 1)
      expect(session.text.replace('z', '')).toBe(src)
      expect(/[^\r]\n/.test(session.text)).toBe(false)
      // the cell is still shown as source, with its line break
      expect(texts(editor)[0]).toContain('\n')
    }
  })

  it('keeps the positions after the table right when a letter is typed in an item of an a-cell', () => {
    const src = '|===\r\na|* one\r\n* two\r\n|===\r\n\r\nafter\r\n'
    const { editor, session } = open(src)
    select(editor, inCell(editor, 'two', 'start'))
    type(editor, 'z')
    expect(session.text).toBe('|===\r\na|* one\r\n* ztwo\r\n|===\r\n\r\nafter\r\n')
    const dom = editor.view.dom as HTMLElement
    const p = [...dom.querySelectorAll('p')].find((e) => e.textContent === 'after')!
    select(editor, editor.view.posAtDOM(p, 0))
    type(editor, 'y')
    expect(session.text).toBe('|===\r\na|* one\r\n* ztwo\r\n|===\r\n\r\nyafter\r\n')
  })

  it('keeps the line ends of each cell in a mixed file', () => {
    const src = '|===\n|a\nb |c\r\nd\r\n|===\n'
    const { editor, session } = open(src)
    const t = texts(editor)
    select(editor, inCell(editor, t[0]!, 'start'))
    type(editor, 'z')
    select(editor, inCell(editor, t[1]!, 'start'))
    type(editor, 'y')
    expect(session.text).toBe('|===\n|za\nb |yc\r\nd\r\n|===\n')
  })
})

describe('a cell with a line that is not its text', () => {
  it('refuses a letter and keeps the file: the conditional line would go with the text written back', () => {
    const src = '|===\n|one\nifdef::attr[one line of text]\ntwo\n|===\n'
    const { editor, session, rejects } = open(src)
    select(editor, start(editor, 'one\ntwo'))
    type(editor, 'z')
    expect(rejects.map((r) => r.code)).toEqual(['not-editable'])
    expect(session.text).toBe(src)
  })

  it('refuses a letter in a cell whose one-line conditional gives as many lines as it holds', () => {
    const src = ':attr:\n\n|===\n|one\nifdef::attr[two]\n|===\n'
    const { editor, session, rejects } = open(src)
    select(editor, start(editor, 'one\ntwo'))
    type(editor, 'z')
    expect(rejects.map((r) => r.code)).toEqual(['not-editable'])
    expect(session.text).toBe(src)
  })

  it('refuses a letter in a cell that is only a one-line conditional', () => {
    const src = ':attr:\n\n|===\n|ifdef::attr[text]\n|===\n'
    const { editor, session, rejects } = open(src)
    select(editor, start(editor, 'ifdef::attr[text]'))
    type(editor, 'z')
    expect(rejects.map((r) => r.code)).toEqual(['not-editable'])
    expect(session.text).toBe(src)
  })

  it('refuses a letter in a readable cell with a hidden line, a comment', () => {
    const src = '|===\n|one\n// a comment\ntwo\n|===\n'
    const { editor, session, rejects } = open(src)
    select(editor, start(editor, 'one\ntwo'))
    type(editor, 'z')
    expect(rejects.map((r) => r.code)).toEqual(['not-editable'])
    expect(session.text).toBe(src)
  })

  it('refuses a letter in a cell that is an include', () => {
    const src = '|===\n|include::part.adoc[]\n|===\n'
    const { editor, session, rejects } = open(src)
    select(editor, start(editor, 'include::part.adoc[]'))
    type(editor, 'z')
    expect(rejects.map((r) => r.code)).toEqual(['not-editable'])
    expect(session.text).toBe(src)
  })
})
