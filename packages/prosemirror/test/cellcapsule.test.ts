// the commands behind the capsule of selected cells: align, clear, split of all, delete by the rectangle, the selection that stays.
import { afterEach, describe, expect, it } from 'vitest'
import { closeAll, inCell, open, select } from './helpers.js'

afterEach(closeAll)

const T = '|===\n|a1 |b1 |c1 |d1\n|a2 |b2 |c2 |d2\n|a3 |b3 |c3 |d3\n|a4 |b4 |c4 |d4\n|===\n'
type Ed = ReturnType<typeof open>['editor']

/** Click `a`, Shift+click `b`. */
const sel = (e: Ed, a: string, b: string): void => {
  select(e, inCell(e, a))
  const dom = e.view.dom as HTMLElement
  const cell = [...dom.querySelectorAll('td, th')].find((x) => x.textContent === b)!
  cell.dispatchEvent(new MouseEvent('mousedown', { shiftKey: true, bubbles: true, cancelable: true }))
}
const selected = (e: Ed): string =>
  [...(e.view.dom as HTMLElement).querySelectorAll('td.sel, th.sel')].map((x) => x.textContent).join(',')

describe('the state of the capsule of cells', () => {
  it('has the rectangle, the alignment and the refusals', () => {
    const { editor } = open(T)
    sel(editor, 'b2', 'c3')
    const s = editor.tableAt()!.selection!
    expect(s).toMatchObject({ row: 1, col: 1, rows: 2, cols: 2, merged: false, firstRow: false, halign: 'left', valign: 'top', empty: false })
    expect(s.refusals.merge?.code).toBe('merge-text')
    expect(s.refusals.clear).toBeNull()
    expect(s.refusals.deleteRows).toBeNull()
    expect(s.refusals.deleteColumns).toBeNull()
  })

  it('has no selection for one cell', () => {
    const { editor } = open(T)
    inCell(editor, 'b2')
    expect(editor.tableAt()!.selection).toBeNull()
  })

  it('tells that the whole table cannot be deleted by rows', () => {
    const { editor } = open('|===\n|a |b\n\n|c |d\n|===\n')
    sel(editor, 'a', 'd')
    const s = editor.tableAt()!.selection!
    expect(s.refusals.deleteRows?.code).toBe('last-row')
    expect(s.refusals.deleteColumns?.code).toBe('last-column')
  })
})

describe('align, clear, fill and the head keep the selection', () => {
  it('aligns four cells in one step and keeps them selected', () => {
    const { editor, session } = open(T)
    sel(editor, 'b2', 'c3')
    expect(editor.commands.setCellAlign('center')).toBe(true)
    expect(session.text).toBe('|===\n|a1 |b1 |c1 |d1\n|a2 ^|b2 ^|c2 |d2\n|a3 ^|b3 ^|c3 |d3\n|a4 |b4 |c4 |d4\n|===\n')
    expect(selected(editor)).toBe('b2,c2,b3,c3')
    expect(editor.tableAt()!.selection).toMatchObject({ halign: 'center', valign: 'top' })
    expect((editor.view.dom as HTMLElement).querySelectorAll('td.h-center').length).toBe(4)
    expect(editor.commands.setCellAlign(undefined, 'bottom')).toBe(true)
    expect(session.text).toContain('^.>|b2')
    editor.commands.undo()
    editor.commands.undo()
    expect(session.text).toBe(T)
  })

  it('refuses the alignment of a csv column shared by two rows, and changes nothing', () => {
    const csv = ',===\na,b\nc,d\n,===\n'
    const { editor, session, rejects } = open(csv)
    sel(editor, 'a', 'd')
    expect(editor.commands.setCellAlign('center')).toBe(false)
    expect(rejects.map((r) => r.code)).toEqual(['unsupported'])
    expect(session.text).toBe(csv)
  })

  it('clears the text and keeps the fill, the alignment and the merging', () => {
    const { editor, session } = open('|===\n|a1 |b1 |c1\n|[.cell-blue]##{empty}##b2 ^|c2 |d2\n|a3 |b3 |c3\n|===\n')
    sel(editor, 'a1', 'c2')
    const before = session.text
    expect(editor.commands.clearCells()).toBe(true)
    expect(selected(editor).length).toBeGreaterThan(0)
    expect(editor.tableAt()!.selection!.empty).toBe(true)
    expect(session.text).toContain('[.cell-blue]##{empty}##')
    expect(session.text).toContain('^|')
    expect(session.text).not.toContain('b2')
    expect(session.text).not.toContain('c2')
    expect(session.text).toContain('d2')
    expect(session.text).toContain('a3')
    expect(editor.commands.clearCells()).toBe(false)
    editor.commands.undo()
    expect(session.text).toBe(before)
  })

  it('fills the selected cells and keeps the selection', () => {
    const { editor, session } = open(T)
    sel(editor, 'b2', 'c3')
    expect(editor.commands.setCellFill('cell-blue')).toBe(true)
    expect((session.text.match(/cell-blue/g) ?? []).length).toBe(4)
    expect(selected(editor)).toContain('c3')
  })

  it('turns the first row into the head and keeps the selection', () => {
    const { editor } = open(T)
    sel(editor, 'b1', 'c1')
    expect(editor.commands.toggleHeader()).toBe(true)
    expect(editor.tableAt()!.header).toBe(true)
    expect(selected(editor)).toBe('b1,c1')
  })
})

describe('split of all, delete by the rectangle', () => {
  it('splits two merged cells of the selection in one step, with their fills', () => {
    const text = '|===\n|a |b |c\n2+|d |e\n.2+|f |g\n|h\n|i |j\n|===\n'
    const { editor, session } = open(text)
    sel(editor, 'a', 'g')
    expect(editor.tableAt()!.selection!.merged).toBe(true)
    expect(editor.commands.splitCells()).toBe(true)
    expect(session.text).not.toContain('2+|')
    expect(session.text).not.toContain('.2+|')
    expect(selected(editor).length).toBeGreaterThan(0)
    editor.commands.undo()
    expect(session.text).toBe(text)
  })

  it('gives the parts of a filled merged cell its fill, and refuses nothing for a selection with none merged', () => {
    const text = '|===\n|a |b |c\n2+|[.cell-blue]##{empty}##d |e\n|f |g |h\n|===\n'
    const { editor, session } = open(text)
    sel(editor, 'a', 'e')
    expect(editor.commands.splitCells()).toBe(true)
    expect((session.text.match(/cell-blue/g) ?? []).length).toBe(2)
    expect(session.text).not.toContain('2+|')
    editor.commands.undo()
    expect(session.text).toBe(text)
    const plain = open(T)
    sel(plain.editor, 'b2', 'c3')
    expect(plain.editor.commands.splitCells()).toBe(false)
    expect(plain.rejects.map((r) => r.code)).toEqual(['split-single'])
  })

  it('tells that the first row with a cell merged over rows cannot be the head', () => {
    const { editor } = open('|===\n.2+|a |b |c\n|d |e\n|f |g |h\n|===\n')
    sel(editor, 'b', 'c')
    expect(editor.tableAt()!.selection!.refusals.header?.code).toBe('head-rowspan')
  })

  it('deletes rows 2-3 and columns b-c of a drag selection, one step each', () => {
    const { editor, session } = open(T)
    sel(editor, 'b2', 'c3')
    expect(editor.commands.deleteSelectedRows()).toBe(true)
    expect(session.text).toBe('|===\n|a1 |b1 |c1 |d1\n|a4 |b4 |c4 |d4\n|===\n')
    editor.commands.undo()
    expect(session.text).toBe(T)
    sel(editor, 'b2', 'c3')
    expect(editor.commands.deleteSelectedColumns()).toBe(true)
    expect(session.text).toBe('|===\n|a1 |d1\n|a2 |d2\n|a3 |d3\n|a4 |d4\n|===\n')
    editor.commands.undo()
    expect(session.text).toBe(T)
  })

  it('refuses to delete every row', () => {
    const t = '|===\n|a |b\n\n|c |d\n|===\n'
    const { editor, session, rejects } = open(t)
    sel(editor, 'a', 'd')
    expect(editor.commands.deleteSelectedRows()).toBe(false)
    expect(rejects.map((r) => r.code)).toEqual(['last-row'])
    expect(session.text).toBe(t)
  })
})

describe('the head, twice', () => {
  it('turns the head on and off with the same bytes, the selection stays', () => {
    const { editor, session } = open(T)
    sel(editor, 'b1', 'c1')
    expect(editor.commands.toggleHeader()).toBe(true)
    expect(editor.tableAt()!.header).toBe(true)
    expect(selected(editor)).toBe('b1,c1')
    expect(editor.commands.toggleHeader()).toBe(true)
    expect(editor.tableAt()!.header).toBe(false)
    expect(session.text).toBe(T)
    expect(selected(editor)).toBe('b1,c1')
  })
})

describe('clear of cells with blocks inside, and the implicit head', () => {
  const nested = '|===\n|a1 |b1\n\na|\n* x\n* y\n|b2\n|===\n'
  it('clears a cell with a list and brings it back with undo', () => {
    const { editor, session } = open(nested)
    sel(editor, 'a1', 'b2')
    const before = session.text
    expect(editor.commands.clearCells()).toBe(true)
    expect(session.text).not.toContain('* x')
    expect(session.text).not.toContain('b2')
    editor.commands.undo()
    expect(session.text).toBe(before)
  })

  it('clears a cell with a nested table and brings it back with undo', () => {
    const t = '|===\n|a1 |b1\n\na|\n!===\n!n1 !n2\n!===\n|b2\n|===\n'
    const { editor, session } = open(t)
    sel(editor, 'a1', 'b2')
    expect(editor.commands.clearCells()).toBe(true)
    expect(session.text).not.toContain('n1')
    editor.commands.undo()
    expect(session.text).toBe(t)
  })

  it('clears the implicit head and it stays the head (no refusal, one step back)', () => {
    const t = '|===\n|a1 |b1\n\n|a2 |b2\n|===\n'
    const { editor, session, rejects } = open(t)
    sel(editor, 'a1', 'b1')
    expect(editor.commands.clearCells()).toBe(true)
    expect(rejects).toEqual([])
    expect(session.text).toBe('|===\n| |\n\n|a2 |b2\n|===\n')
    expect(editor.tableAt()!.header).toBe(true)
    editor.commands.undo()
    expect(session.text).toBe(t)
  })
})

describe('the refusals in the state', () => {
  it('tells merge-head, merge-deep, row-merged and cols-attr', () => {
    const head = open('|===\n|a |b\n\n|c |d\n|===\n')
    sel(head.editor, 'a', 'b')
    const h = head.editor.tableAt()!.selection!.refusals
    expect(h.merge?.code).toBe('merge-head')

    const rm = open('|===\n|a |b |c\n.2+|d |e |f\n|g |h\n|===\n')
    sel(rm.editor, 'd', 'e')
    expect(rm.editor.tableAt()!.selection!.refusals.deleteRows?.code).toBe('row-merged')

    const ca = open('[cols="{n}"]\n|===\n|a |b |c\n|d |e |f\n|===\n')
    sel(ca.editor, 'a', 'e')
    expect(ca.editor.tableAt()!.selection!.refusals.deleteColumns?.code).toBe('cols-attr')
  })
})

describe('Esc in the text', () => {
  const esc = (e: Ed): void => {
    ;(e.view.dom as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
  }
  it('lets the cells go at once when there is no capsule', () => {
    const { editor } = open(T)
    sel(editor, 'b2', 'c3')
    esc(editor)
    expect(selected(editor)).toBe('')
  })
  it('leaves the cells selected for the capsule to hide itself, the second Esc lets them go', () => {
    const { editor } = open(T)
    sel(editor, 'b2', 'c3')
    editor.cellCapsuleShown = true
    esc(editor)
    expect(selected(editor)).toBe('b2,c2,b3,c3')
    editor.cellCapsuleShown = false
    esc(editor)
    expect(selected(editor)).toBe('')
  })
})
