// a table is a grid in the visual editor; the text of its cells is edited in place, the commands of tables are
// operations of Nota and each is one step of the history.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { TextSelection } from 'prosemirror-state'
import { afterEach, describe, expect, it } from 'vitest'
import { closeAll, grids, inCell, key, open, posIn, select, shape, type } from './helpers.js'

afterEach(closeAll)

const fixture = (name: string): string => readFileSync(resolve(process.cwd(), 'quality/fixtures/editor', name), 'utf8')
const TABLES = fixture('tables.adoc')
const NESTED = fixture('tables-nested.adoc')

const SIMPLE = '.Orders\n[cols="1,2",options="header"]\n|===\n|No |Name\n|1\n|Cabinet\n|2\n|Courier\n|===\n'

describe('a table in the visual editor', () => {
  it('is a grid; a table that cannot be rewritten stays an island', () => {
    const { editor } = open(TABLES)
    const dom = editor.view.dom as HTMLElement
    expect(shape(editor).split('|').filter((x) => x === '[table]').length).toBe(6)
    expect(dom.querySelectorAll('.nota-island').length).toBeGreaterThanOrEqual(1)
    expect([...dom.querySelectorAll('.nota-island .island-src')].some((e) => (e.textContent ?? '').includes('2*|повторяется'))).toBe(true)
    // the head is in th, the alignment of a cell in its class, the nested tables are in their cells
    expect(dom.querySelector('th')!.textContent).toBe('Номер')
    expect(dom.querySelector('td.h-right')!.textContent).toBe('120')
    expect(dom.querySelectorAll('td table').length).toBe(2)
    expect(grids(editor)[0]).toBe('Номер|Описание|Сумма/1001|Личный кабинет клиента|120/1002|Приложение для курьеров|80')
  })

  it('types in a cell: only that cell changes, a bar is text, a comma in csv is quoted, one undo takes the word', () => {
    const { editor, session } = open(TABLES)
    inCell(editor, 'Личный кабинет клиента')
    type(editor, ' и сайт')
    expect(session.text).toBe(TABLES.replace('|Личный кабинет клиента', '|Личный кабинет клиента и сайт'))
    expect(grids(editor)[0]).toContain('Личный кабинет клиента и сайт')
    editor.commands.undo()
    expect(session.text).toBe(TABLES)
    inCell(editor, 'Описание')
    type(editor, '|')
    expect(session.text).toBe(TABLES.replace('|Описание ', '|Описание\\| '))
    expect((editor.view.dom as HTMLElement).textContent).toContain('Описание|')
    expect((editor.view.dom as HTMLElement).querySelectorAll('table')[0]!.querySelectorAll('tr:first-child > th').length).toBe(3)
    editor.commands.undo()
    expect(session.text).toBe(TABLES)
    inCell(editor, 'свежий')
    type(editor, ',')
    expect(session.text).toBe(TABLES.replace('Хлеб,50,свежий', 'Хлеб,50,"свежий,"'))
    editor.commands.undo()
    expect(session.text).toBe(TABLES)
  })

  it('keeps a blank typed at the end of a cell until a letter follows it', () => {
    const { editor, session } = open('|===\n|a |b\n\n|c |d\n|===\n')
    inCell(editor, 'c')
    type(editor, ' x')
    expect(session.text).toBe('|===\n|a |b\n\n|c x |d\n|===\n')
    inCell(editor, 'a')
    type(editor, ' ')
    expect(session.text).toBe('|===\n|a |b\n\n|c x |d\n|===\n')
    expect(grids(editor)[0]!.startsWith('a |b')).toBe(true)
    type(editor, 'y')
    expect(session.text).toBe('|===\n|a y |b\n\n|c x |d\n|===\n')
  })

  it('refuses text across cells, and Enter does nothing', () => {
    const { editor, session, rejects } = open(SIMPLE)
    const a = inCell(editor, 'Cabinet', 'start')
    const b = inCell(editor, 'Courier')
    select(editor, a, b)
    type(editor, 'x')
    expect(session.text).toBe(SIMPLE)
    expect(rejects.length).toBeGreaterThan(0)
    inCell(editor, 'Courier')
    key(editor, 'Enter')
    expect(session.text).toBe(SIMPLE)
    key(editor, 'Backspace')
    expect(session.text).toBe(SIMPLE.replace('Courier', 'Courie'))
  })

  it('does not change when a paragraph next to it is edited', () => {
    const { editor, session } = open(`before\n\n${SIMPLE}\nafter\n`)
    select(editor, posIn(editor, 0, 6))
    type(editor, '!')
    expect(session.text).toBe(`before!\n\n${SIMPLE}\nafter\n`)
    expect(shape(editor)).toBe('before!|[table]|after')
  })
})

type Case = { name: string; text: string; at: string; run: (e: ReturnType<typeof open>['editor']) => void; expected?: string }

/** The command, then one undo: the text is the same to the byte; then redo: the result of the command again. */
function undoable(c: Case): void {
  it(c.name, () => {
    const { editor, session, rejects } = open(c.text)
    inCell(editor, c.at)
    c.run(editor)
    expect(rejects).toEqual([])
    const result = session.text
    expect(result).not.toBe(c.text)
    if (c.expected !== undefined) expect(result).toBe(c.expected)
    editor.commands.undo()
    expect(session.text).toBe(c.text)
    editor.commands.redo()
    expect(session.text).toBe(result)
    editor.commands.undo()
    expect(session.text).toBe(c.text)
  })
}

describe('commands of tables, one step of the history each', () => {
  const sel = (e: ReturnType<typeof open>['editor'], a: string, b: string): void => {
    const from = inCell(e, a)
    const to = inCell(e, b)
    select(e, from)
    const dom = e.view.dom as HTMLElement
    const cell = (text: string): Element => [...dom.querySelectorAll('td, th')].find((x) => x.textContent === text)!
    void to
    const ev = new MouseEvent('mousedown', { shiftKey: true, bubbles: true, cancelable: true })
    cell(b).dispatchEvent(ev)
  }

  undoable({ name: 'adds a row under the row of the cursor', text: SIMPLE, at: 'Cabinet', run: (e) => e.commands.insertRow() })
  undoable({ name: 'adds a column right of the column of the cursor', text: SIMPLE, at: 'Cabinet', run: (e) => e.commands.insertColumn() })
  undoable({ name: 'deletes a row', text: SIMPLE, at: 'Courier', run: (e) => e.commands.deleteRow() })
  undoable({ name: 'deletes a column', text: SIMPLE, at: 'Courier', run: (e) => e.commands.deleteColumn() })
  undoable({ name: 'turns the first row into the head, or back', text: '|===\n|a |b\n|c |d\n|===\n', at: 'a', run: (e) => e.commands.toggleHeader() })
  undoable({ name: 'nests a table in a cell', text: SIMPLE, at: 'Courier', run: (e) => e.commands.nestTable() })
  undoable({ name: 'deletes the table with its attributes and title', text: `x\n\n${SIMPLE}\ny\n`, at: 'Courier', run: (e) => e.commands.deleteTable() })
  undoable({
    name: 'merges two selected cells, and splits them',
    text: '|===\n|a |b\n\n|c |d\n|\n|e\n|===\n',
    at: 'c',
    run: (e) => {
      sel(e, 'c', '')
      expect(e.commands.mergeCells()).toBe(true)
    },
  })
  undoable({
    name: 'splits a merged cell',
    text: '|===\n|a |b\n\n.2+|c |d\n|e\n|===\n',
    at: 'c',
    run: (e) => e.commands.splitCell(),
  })
  undoable({
    name: 'adds a row with Tab in the last cell',
    text: SIMPLE,
    at: 'Courier',
    run: (e) => expect(key(e, 'Tab')).toBe(true),
  })

  it('has the cursor in the new row, the new column, the neighbour', () => {
    const { editor, session } = open(SIMPLE)
    inCell(editor, 'Cabinet')
    editor.commands.insertRow()
    expect(grids(editor)[0]).toBe('No|Name/1|Cabinet/|/2|Courier')
    expect(editor.view.state.selection.$from.parent.type.name).toBe('cell_text')
    type(editor, 'x')
    expect(grids(editor)[0]).toBe('No|Name/1|Cabinet/x|/2|Courier')
    inCell(editor, 'Cabinet')
    editor.commands.insertColumn()
    expect(session.text).toContain('cols="1,2,1"')
    type(editor, 'y')
    expect(grids(editor)[0]).toBe('No|Name|/1|Cabinet|y/x||/2|Courier|')
    editor.commands.deleteColumn()
    expect(session.text).not.toContain('cols="1,2,1"')
  })

  it('has the cursor at the end of the block above after the table is deleted', () => {
    const { editor, session } = open(`x\n\n${SIMPLE}\ny\n`)
    inCell(editor, 'Courier')
    editor.commands.deleteTable()
    expect(session.text).not.toContain('|===')
    expect(editor.view.state.selection.$from.parent.textContent).toBe('x')
  })

  it('refuses the last row and column, and a row or column a merged cell passes through; the text stays', () => {
    const { editor, session, rejects } = open('|===\n|a\n|===\n')
    inCell(editor, 'a')
    editor.commands.deleteRow()
    editor.commands.deleteColumn()
    expect(rejects.map((r) => r.code)).toEqual(['last-row', 'last-column'])
    expect(session.text).toBe('|===\n|a\n|===\n')
    const m = open('|===\n|a |b\n\n.2+|c |d\n|e\n|===\n')
    inCell(m.editor, 'c')
    m.editor.commands.deleteRow()
    inCell(m.editor, 'e')
    m.editor.commands.deleteRow()
    expect(m.rejects.map((r) => r.code)).toEqual(['row-merged', 'row-merged'])
  })

  it('refuses a merge without selection, with text, in the head; and a split of a single cell', () => {
    const t = '|===\n|a |b\n\n|c |d\n|===\n'
    const { editor, session, rejects } = open(t)
    inCell(editor, 'c')
    editor.commands.mergeCells()
    editor.commands.splitCell()
    expect(rejects.map((r) => r.code)).toEqual(['merge-select', 'split-single'])
    expect(session.text).toBe(t)
  })

  it('refuses to merge cells with text, of the head, of a table of the third or fourth level; the head and the level before the text', () => {
    const t = '|===\n|a |b\n\n|c |d\n|e |f\n|===\n'
    const { editor, session, rejects } = open(t)
    sel(editor, 'c', 'd')
    expect(editor.commands.mergeCells()).toBe(false)
    sel(editor, 'a', 'b')
    expect(editor.commands.mergeCells()).toBe(false)
    expect(rejects.map((r) => r.code)).toEqual(['merge-text', 'merge-head'])
    expect(session.text).toBe(t)
    const n = open(NESTED)
    sel(n.editor, 'х', 'у')
    expect(n.editor.tableAt()!.level).toBe(4)
    expect(n.editor.commands.mergeCells()).toBe(false)
    expect(n.rejects.map((r) => r.code)).toEqual(['merge-deep'])
    expect(n.session.text).toBe(NESTED)
  })

  it('refuses to delete a column through a merged cell, and a head with a cell merged over rows; the text stays', () => {
    const t = '|===\n|a |b |c\n\n2+|d |e\n|f |g |h\n|===\n'
    const { editor, session, rejects } = open(t)
    inCell(editor, 'f')
    editor.commands.deleteColumn()
    expect(rejects.map((r) => r.code)).toEqual(['column-merged'])
    expect(session.text).toBe(t)
    const h = '|===\n.2+|a |b\n|c\n|===\n'
    const m = open(h)
    inCell(m.editor, 'a')
    m.editor.commands.toggleHeader()
    expect(m.rejects.map((r) => r.code)).toEqual(['head-rowspan'])
    expect(m.session.text).toBe(h)
  })

  it('nests tables four levels deep, not deeper; a cell with a table takes no second one', () => {
    const { editor, session, rejects } = open('|===\n|a\n|===\n')
    const inLast = (): void => {
      const tables = (editor.view.dom as HTMLElement).querySelectorAll('table')
      const td = tables[tables.length - 1]!.querySelector('td, th')!
      const st = editor.view.state
      editor.view.dispatch(st.tr.setSelection(TextSelection.near(st.doc.resolve(editor.view.posAtDOM(td, 0)), 1)))
    }
    inCell(editor, 'a')
    expect(editor.commands.nestTable()).toBe(true)
    expect(session.text).toContain('!===')
    inCell(editor, 'a')
    expect(editor.commands.nestTable()).toBe(false)
    expect(rejects.map((r) => r.code)).toEqual(['cell-has-table'])
    for (const mark of [',===', ':===']) {
      inLast()
      expect(editor.commands.nestTable()).toBe(true)
      expect(session.text).toContain(mark)
    }
    expect(editor.tableAt()!.level).toBe(4)
    const text = session.text
    expect(editor.commands.nestTable()).toBe(false)
    expect(rejects.at(-1)!.code).toBe('nesting-too-deep')
    expect(session.text).toBe(text)
  })

  it('works on the tables of all levels, and undoes every step', () => {
    const { editor, session } = open(NESTED)
    let done = 0
    for (const at of ['1', 'цвет', 'стол', 'х']) {
      for (const run of [
        (): boolean => editor.commands.insertRow(),
        (): boolean => editor.commands.insertColumn(),
        (): boolean => editor.commands.deleteRow(),
        (): boolean => editor.commands.deleteColumn(),
        (): boolean => editor.commands.toggleHeader(),
        (): boolean => editor.commands.deleteTable(),
      ]) {
        inCell(editor, at)
        const before = session.text
        run()
        if (session.text !== before) {
          done++
          editor.commands.undo()
          expect(session.text).toBe(before)
        }
      }
    }
    expect(done).toBeGreaterThanOrEqual(16)
  })

  it('shows the state of the table under the cursor', () => {
    const { editor } = open(NESTED)
    expect(editor.tableAt()).toBeNull()
    inCell(editor, 'Номер')
    expect(editor.tableAt()).toMatchObject({ level: 1, header: true, merged: false, selected: false })
    inCell(editor, 'цвет')
    expect(editor.tableAt()!.level).toBe(2)
    inCell(editor, 'Имя')
    expect(editor.tableAt()!.level).toBe(3)
    inCell(editor, 'х')
    expect(editor.tableAt()!.level).toBe(4)
  })

  it('goes from cell to cell with Tab and Shift-Tab, and stays in the first cell', () => {
    const { editor, session } = open(SIMPLE)
    inCell(editor, 'No', 'start')
    expect(key(editor, 'Tab')).toBe(true)
    expect(editor.view.state.selection.$from.parent.textContent).toBe('Name')
    key(editor, 'Tab', { shift: true })
    expect(editor.view.state.selection.$from.parent.textContent).toBe('No')
    key(editor, 'Tab', { shift: true })
    expect(editor.view.state.selection.$from.parent.textContent).toBe('No')
    expect(session.text).toBe(SIMPLE)
  })
})

describe('a mark or a link over a selection that reaches into a table', () => {
  it('changes nothing and says why, so the command is not silent', () => {
    for (const run of [
      (e: ReturnType<typeof open>['editor']) => e.commands.toggleMark('strong'),
      (e: ReturnType<typeof open>['editor']) => e.commands.setLink('https://example.com'),
    ]) {
      const { editor, session, rejects } = open(`before text\n\n${SIMPLE}\nafter\n`)
      const text = session.text
      const end = inCell(editor, 'Cabinet')
      select(editor, posIn(editor, 0, 3), end)
      expect(run(editor)).toBe(false)
      expect(session.text).toBe(text)
      expect(rejects.map((r) => r.code)).toEqual(['invalid-range'])
      closeAll()
    }
  })
})

describe('a cell with a fill in the visual editor', () => {
  const Y = '[.cell-yellow]##{empty}##'

  it('does not show the label, and typing keeps it at the start of the cell', () => {
    const t = `|===\n|${Y}один |b\n|c |d\n|===\n`
    const { editor, session } = open(t)
    expect((editor.view.dom as HTMLElement).textContent).not.toContain('cell-yellow')
    expect(grids(editor)[0]).toBe('один|b/c|d')
    inCell(editor, 'один')
    type(editor, ' два')
    expect(session.text).toBe(`|===\n|${Y}один два |b\n|c |d\n|===\n`)
    editor.commands.undo()
    expect(session.text).toBe(t)
    inCell(editor, 'один', 'start')
    type(editor, 'пре')
    expect(session.text).toBe(`|===\n|${Y}преодин |b\n|c |d\n|===\n`)
  })

  it('keeps the label in a cell with the asciidoc style', () => {
    const t = `|===\na|${Y}один\n\nвторой\n|===\n`
    const { editor, session } = open(t)
    expect((editor.view.dom as HTMLElement).textContent).not.toContain('cell-yellow')
    inCell(editor, 'один')
    type(editor, '!')
    expect(session.text).toBe(`|===\na|${Y}один!\n\nвторой\n|===\n`)
  })
})

// the cells of a table are selected by dragging the mouse across them
describe('cells selected by dragging', () => {
  const GRID = '|===\n|a |b |c\n\n|d |e |f\n\n|g |h |i\n|===\n'
  type Ed = ReturnType<typeof open>['editor']
  const cell = (e: Ed, text: string, nth = 0): HTMLElement =>
    [...(e.view.dom as HTMLElement).querySelectorAll('td, th')].filter((x) => x.textContent === text)[nth] as HTMLElement
  const press = (e: Ed, text: string, nth = 0): void => {
    // (jsdom has no layout: the editor does not find the place of the click by the point)
    e.view.posAtCoords = () => null
    cell(e, text, nth).dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, buttons: 1 }))
  }
  const move = (e: Ed, to: Element, buttons = 1): MouseEvent => {
    const ev = new MouseEvent('mousemove', { bubbles: true, cancelable: true, buttons })
    to.dispatchEvent(ev)
    return ev
  }
  const release = (): void => {
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
  }
  const selected = (e: Ed): string =>
    [...(e.view.dom as HTMLElement).querySelectorAll('td.sel, th.sel')].map((x) => x.textContent).join('')
  const drag = (e: Ed, from: string, ...via: string[]): void => {
    inCell(e, from)
    press(e, from)
    for (const v of via) move(e, cell(e, v))
    release()
  }

  it('selects the rectangle on the way, and leaves it when the button is let go', () => {
    const { editor } = open(GRID)
    inCell(editor, 'a')
    press(editor, 'a')
    move(editor, cell(editor, 'a'))
    expect(selected(editor)).toBe('')
    move(editor, cell(editor, 'b'))
    expect(selected(editor)).toBe('ab')
    expect(cell(editor, 'a').getAttribute('aria-selected')).toBe('true')
    move(editor, cell(editor, 'e'))
    release()
    expect(selected(editor)).toBe('abde')
    expect(cell(editor, 'c').getAttribute('aria-selected')).toBeNull()
    expect(editor.tableAt()).toMatchObject({ selected: true, cells: 4 })
    expect(editor.view.dom.classList.contains('cells-on')).toBe(true)
    // the frame: the edge cells say which edges they are on
    expect(cell(editor, 'a').className).toContain('e-t')
    expect(cell(editor, 'a').className).toContain('e-l')
    expect(cell(editor, 'a').className).not.toContain('e-b')
    expect(cell(editor, 'e').className).toContain('e-b')
    expect(cell(editor, 'e').className).toContain('e-r')
  })

  it('keeps the rectangle when the pointer goes out of the table, and drops it back in the first cell', () => {
    const { editor } = open(`x\n\n${GRID}\ny\n`)
    drag(editor, 'a', 'b')
    const outside = (editor.view.dom as HTMLElement).querySelector('p')!
    inCell(editor, 'a')
    press(editor, 'a')
    move(editor, cell(editor, 'b'))
    move(editor, outside)
    release()
    expect(selected(editor)).toBe('ab')
    press(editor, 'a')
    move(editor, cell(editor, 'b'))
    expect(selected(editor)).toBe('ab')
    move(editor, cell(editor, 'a'))
    expect(selected(editor)).toBe('')
    release()
  })

  it('leaves the text selection to the browser when the pointer stays in one cell', () => {
    const { editor } = open(GRID)
    inCell(editor, 'a')
    press(editor, 'a')
    const ev = move(editor, cell(editor, 'a'))
    release()
    expect(ev.defaultPrevented).toBe(false)
    expect(selected(editor)).toBe('')
    expect(editor.tableAt()).toMatchObject({ selected: false, cells: 1 })
  })

  it('does not follow a move without the button (the release was lost)', () => {
    const { editor } = open(GRID)
    inCell(editor, 'a')
    press(editor, 'a')
    move(editor, cell(editor, 'b'), 0)
    expect(selected(editor)).toBe('')
  })

  it('keeps the cells when the browser moves its own selection while the button is down', () => {
    const { editor } = open(GRID)
    const far = inCell(editor, 'f')
    inCell(editor, 'a')
    press(editor, 'a')
    move(editor, cell(editor, 'e'))
    const st = editor.view.state
    editor.view.dispatch(st.tr.setSelection(TextSelection.create(st.doc, far))) // as the browser does
    expect(selected(editor)).toBe('abde')
    release()
    expect(selected(editor)).toBe('abde')
  })

  it('takes a merged cell whole', () => {
    const { editor } = open('|===\n|a |b |c\n\n.2+|d |e |f\n|g |h\n\n|i |j |k\n|===\n')
    drag(editor, 'a', 'e')
    expect(selected(editor)).toBe('abdeg')
  })

  it('merges as Shift-click does, in one step of the history', () => {
    const text = '|===\n|a |b\n\n|c |d\n|\n|e\n|===\n'
    const viaShift = open(text)
    inCell(viaShift.editor, 'c')
    cell(viaShift.editor, '').dispatchEvent(new MouseEvent('mousedown', { shiftKey: true, bubbles: true, cancelable: true }))
    expect(viaShift.editor.commands.mergeCells()).toBe(true)
    const { editor, session, rejects } = open(text)
    inCell(editor, 'c')
    press(editor, 'c')
    move(editor, cell(editor, ''))
    release()
    expect(editor.commands.mergeCells()).toBe(true)
    expect(rejects).toEqual([])
    expect(session.text).toBe(viaShift.session.text)
        editor.commands.undo()
    expect(session.text).toBe(text)
  })

  it('refuses to merge a head as before', () => {
    const { editor, session, rejects } = open('[options="header"]\n|===\n|a |b\n\n|c |d\n|===\n')
    drag(editor, 'a', 'c')
    expect(editor.commands.mergeCells()).toBe(false)
    expect(rejects.map((r) => r.code)).toEqual(['merge-head'])
    expect(session.text).toBe('[options="header"]\n|===\n|a |b\n\n|c |d\n|===\n')
  })

  it('fills the cells in one step of the history', () => {
    const { editor, session } = open(GRID)
    drag(editor, 'a', 'b', 'c')
    expect(editor.tableAt()).toMatchObject({ cells: 3, mixedFill: false })
    editor.commands.setCellFill('cell-yellow')
    expect((session.text.match(/\[\.cell-yellow\]##\{empty\}##/g) ?? []).length).toBe(3)
    editor.commands.undo()
    expect(session.text).toBe(GRID)
  })

  it('writes nothing: not the text, not the history', () => {
    const { editor, session } = open(`x\n\n${GRID}`)
    const edits: number[] = []
    session.subscribe(() => edits.push(1))
    drag(editor, 'a', 'b', 'e')
    key(editor, 'Escape')
    expect(session.text).toBe(`x\n\n${GRID}`)
    expect(edits).toEqual([])
    expect(session.canUndo).toBe(false)
  })

  it('grows Shift-click from the cell where the drag began', () => {
    const { editor } = open(GRID)
    drag(editor, 'a', 'b')
    cell(editor, 'i').dispatchEvent(new MouseEvent('mousedown', { shiftKey: true, bubbles: true, cancelable: true }))
    expect(selected(editor)).toBe('abcdefghi')
    drag(editor, 'e', 'f')
    cell(editor, 'g').dispatchEvent(new MouseEvent('mousedown', { shiftKey: true, bubbles: true, cancelable: true }))
    expect(selected(editor)).toBe('degh')
  })

  it('is let go by Esc, a click, and a typed character', () => {
    const { editor, session } = open(`${GRID}\ny\n`)
    drag(editor, 'a', 'b')
    expect(key(editor, 'Escape')).toBe(true)
    expect(selected(editor)).toBe('')
    expect(editor.view.dom.classList.contains('cells-on')).toBe(false)
    drag(editor, 'a', 'b')
    press(editor, 'h')
    release()
    expect(selected(editor)).toBe('')
    drag(editor, 'a', 'b')
    editor.view.dom.querySelector('p')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }))
    expect(selected(editor)).toBe('')
    drag(editor, 'e', 'f')
    type(editor, 'z')
    expect(selected(editor)).toBe('')
    expect(session.text).toContain('|ez')
  })

  it('selects the cells of a nested table only, and a cell with a table in it whole', () => {
    const text = '[cols="1,1a"]\n|===\n|x |y\n\n|z\n|\n[cols="1,1"]\n!===\n!p !q\n\n!r !s\n!===\n|===\n'
    const { editor } = open(text)
    const dom = editor.view.dom as HTMLElement
    inCell(editor, 'p')
    press(editor, 'p')
    move(editor, cell(editor, 's'))
    // the pointer goes to the outer table: the rectangle stays
    move(editor, cell(editor, 'z'))
    release()
    expect(selected(editor)).toBe('pqrs')
    expect(dom.querySelectorAll('table table .sel').length).toBe(4)
    inCell(editor, 'x')
    press(editor, 'x')
    move(editor, cell(editor, 'p'))
    release()
    expect(dom.querySelectorAll('table table .sel').length).toBe(0)
    expect(dom.querySelectorAll('table > tbody > tr > .sel, table > tr > .sel').length).toBeGreaterThan(1)
  })

  // the cells in the corners of the table say so, to be rounded as the table is
  const corners = (e: Ed, texts: string[], nth = 0): string =>
    texts.map((t) => t + ':' + [...cell(e, t, nth).classList].filter((c) => /^c-/.test(c)).sort().join('+')).join(' ')

  it('marks the selected cells in the corners of the table', () => {
    const { editor } = open(GRID)
    drag(editor, 'a', 'i')
    expect(corners(editor, [...'abcdefghi'])).toBe('a:c-tl b: c:c-tr d: e: f: g:c-bl h: i:c-br')
    drag(editor, 'g', 'i')
    expect(corners(editor, [...'abcdefghi'])).toBe('a: b: c: d: e: f: g:c-bl h: i:c-br')
    drag(editor, 'e', 'e')
    drag(editor, 'd', 'e')
    expect(corners(editor, [...'abcdefghi'])).toBe('a: b: c: d: e: f: g: h: i:')
  })

  it('finds the corners by the grid, with merged cells', () => {
    const { editor } = open('|===\n|a |b\n\n.2+|c |d\n\n|e\n|===\n')
    drag(editor, 'a', 'e')
    expect(corners(editor, [...'abcde'])).toBe('a:c-tl b:c-tr c:c-bl d: e:c-br')
    const wide = open('|===\n|a |b\n\n2+|c\n|===\n')
    drag(wide.editor, 'a', 'c')
    expect(corners(wide.editor, [...'abc'])).toBe('a:c-tl b:c-tr c:c-bl+c-br')
  })

  // the same, on the way, while the button is still held
  const hold = (e: Ed, from: string, ...via: string[]): void => {
    inCell(e, from)
    press(e, from)
    for (const v of via) move(e, cell(e, v))
  }
  const ALL = [...'abcdefghi']
  const FOUR = 'a:c-tl b: c:c-tr d: e: f: g:c-bl h: i:c-br'

  it('rounds the corners of the block before the button is let go, from every corner', () => {
    for (const [from, to] of [['a', 'i'], ['c', 'g'], ['g', 'c'], ['i', 'a']] as const) {
      const { editor } = open(GRID)
      hold(editor, from, to)
      expect(corners(editor, ALL), `${from}->${to} on the way`).toBe(FOUR)
      release()
      expect(corners(editor, ALL), `${from}->${to} released`).toBe(FOUR)
    }
  })

  it('follows the shrinking and the return of the block on the way', () => {
    const { editor } = open(GRID)
    hold(editor, 'a', 'i', 'e')
    expect(corners(editor, ALL)).toBe('a:c-tl b: c: d: e: f: g: h: i:')
    move(editor, cell(editor, 'a'))
    expect(selected(editor)).toBe('')
    expect(corners(editor, ALL)).toBe('a: b: c: d: e: f: g: h: i:')
    move(editor, cell(editor, 'c'))
    expect(corners(editor, ALL)).toBe('a:c-tl b: c:c-tr d: e: f: g: h: i:')
    release()
  })

  it('rounds the corners of a nested table, and merged cells, on the way', () => {
    const text = '[cols="1,1a"]\n|===\n|x |y\n\n|z\n|\n[cols="1,1"]\n!===\n!p !q\n\n!r !s\n!===\n|===\n'
    const { editor } = open(text)
    hold(editor, 'p', 's')
    expect(corners(editor, [...'pqrs'])).toBe('p:c-tl q:c-tr r:c-bl s:c-br')
    const dom = editor.view.dom as HTMLElement
    const outer = [...dom.querySelectorAll('td')].find((x) => x.querySelector('table'))!
    expect(outer.className).not.toMatch(/c-/)
    release()
    const again = open(text).editor
    hold(again, 'z', 'p')
    const last = [...(again.view.dom as HTMLElement).querySelectorAll('td.sel')].find((x) => x.querySelector('table'))!
    expect(last.classList.contains('c-br')).toBe(true)
    expect((again.view.dom as HTMLElement).querySelectorAll('table table [class*="c-"]').length).toBe(0)
    release()
    const m = open('|===\n|a |b\n\n.2+|c |d\n\n|e\n|===\n').editor
    hold(m, 'a', 'e')
    expect(corners(m, [...'abcde'])).toBe('a:c-tl b:c-tr c:c-bl d: e:c-br')
    release()
    const wide = open('|===\n|a |b\n\n2+|c\n|===\n').editor
    hold(wide, 'a', 'c')
    expect(corners(wide, [...'abc'])).toBe('a:c-tl b:c-tr c:c-bl+c-br')
    release()
  })

  it('takes the corners of a nested table, and of the outer cell as a whole', () => {
    const text = '[cols="1,1a"]\n|===\n|x |y\n\n|z\n|\n[cols="1,1"]\n!===\n!p !q\n\n!r !s\n!===\n|===\n'
    const { editor } = open(text)
    drag(editor, 'p', 's')
    expect(corners(editor, [...'pqrs'])).toBe('p:c-tl q:c-tr r:c-bl s:c-br')
    const outer = [...(editor.view.dom as HTMLElement).querySelectorAll('td')].find((x) => x.querySelector('table'))!
    expect(outer.className).not.toMatch(/c-/)
    drag(editor, 'z', 'p')
    const last = [...(editor.view.dom as HTMLElement).querySelectorAll('td.sel')].find((x) => x.querySelector('table'))!
    expect(last.classList.contains('c-br')).toBe(true)
    expect((editor.view.dom as HTMLElement).querySelectorAll('table table [class*="c-"]').length).toBe(0)
  })
})
