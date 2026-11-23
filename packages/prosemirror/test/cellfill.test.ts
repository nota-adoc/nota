// the command setCellFill of the editor: a cell, several selected cells, the parts of a split cell; one step of the history each.
import { afterEach, describe, expect, it } from 'vitest'
import { closeAll, inCell, open, select } from './helpers.js'

afterEach(closeAll)

const Y = '[.cell-yellow]##{empty}##'
const G = '[.cell-green]##{empty}##'
const shiftClick = (e: ReturnType<typeof open>['editor'], text: string): void => {
  const dom = e.view.dom as HTMLElement
  const cell = [...dom.querySelectorAll('td, th')].find((x) => x.textContent === text)!
  cell.dispatchEvent(new MouseEvent('mousedown', { shiftKey: true, bubbles: true, cancelable: true }))
}

describe('setCellFill', () => {
  it('fills the cell under the cursor, changes only the label and gives the file back with one undo', () => {
    const t = '|===\n|a |b\n\n|c |d\n|===\n'
    const { editor, session } = open(t)
    inCell(editor, 'c')
    expect(editor.tableAt()!.fill).toBeNull()
    expect(editor.commands.setCellFill('cell-pink')).toBe(true)
    expect(session.text).toBe(`|===\n|a |b\n\n|[.cell-pink]##{empty}##c |d\n|===\n`)
    expect(editor.tableAt()!.fill).toBe('cell-pink')
    expect((editor.view.dom as HTMLElement).querySelector('td.cell-pink')!.textContent).toBe('c')
    expect((editor.view.dom as HTMLElement).textContent).not.toContain('cell-pink')
    editor.commands.setCellFill('cell-blue')
    expect(session.text).toContain('|[.cell-blue]##{empty}##c |d')
    editor.commands.setCellFill(null)
    expect(session.text).toBe(t)
    editor.commands.undo()
    editor.commands.undo()
    editor.commands.undo()
    expect(session.text).toBe(t)
  })

  it('fills the head and keeps the colour of the text inside the cell', () => {
    const t = '[options="header"]\n|===\n|[.hl-red]#Норма# |b\n|c |d\n|===\n'
    const { editor, session } = open(t)
    inCell(editor, 'Норма')
    editor.commands.setCellFill('cell-gray')
    expect(session.text).toBe('[options="header"]\n|===\n|[.cell-gray]##{empty}##[.hl-red]#Норма# |b\n|c |d\n|===\n')
    expect((editor.view.dom as HTMLElement).querySelector('th.cell-gray')).not.toBeNull()
    editor.commands.undo()
    expect(session.text).toBe(t)
  })

  it('fills all the selected cells in one step', () => {
    const t = '|===\n|a |b |c\n|===\n'
    const { editor, session } = open(t)
    inCell(editor, 'a')
    shiftClick(editor, 'c')
    const state = editor.tableAt()!
    expect([state.cells, state.selected, state.mixedFill]).toEqual([3, true, false])
    expect(editor.commands.setCellFill('cell-green')).toBe(true)
    expect(session.text).toBe(`|===\n|${G}a |${G}b |${G}c\n|===\n`)
    editor.commands.undo()
    expect(session.text).toBe(t)
  })

  it('tells when the fills of the selected cells differ, and the chosen one goes to all', () => {
    const t = `|===\n|${Y}a |b |${G}c\n|===\n`
    const { editor, session } = open(t)
    inCell(editor, 'a')
    shiftClick(editor, 'c')
    expect(editor.tableAt()!.mixedFill).toBe(true)
    expect(editor.tableAt()!.fill).toBeNull()
    editor.commands.setCellFill('cell-green')
    expect(session.text).toBe(`|===\n|${G}a |${G}b |${G}c\n|===\n`)
    editor.commands.undo()
    expect(session.text).toBe(t)
  })

  it('writes the span of a merged cell for the window', () => {
    const { editor } = open(`|===\n2+|${Y}широкая\n|a |b\n|===\n`)
    inCell(editor, 'широкая')
    expect(editor.tableAt()!.span).toBe('2+')
    expect(editor.tableAt()!.fill).toBe('cell-yellow')
  })

  it('refuses a cell with the literal style with the code cell-fill-refused, and the text stays', () => {
    const t = '|===\nl|строка\n|b\n|===\n'
    const { editor, session, rejects } = open(t)
    inCell(editor, 'строка')
    expect(editor.commands.setCellFill('cell-blue')).toBe(false)
    expect(session.text).toBe(t)
    expect(rejects.map((r) => r.code)).toEqual(['cell-fill-refused'])
  })

  it('does nothing outside a table', () => {
    const { editor, session } = open('абзац\n')
    select(editor, 1)
    expect(editor.commands.setCellFill('cell-blue')).toBe(false)
    expect(session.text).toBe('абзац\n')
  })

  it('a merged cell with a fill: «Разделить» gives the fill to every part, in one step', () => {
    const t = `|===\n2+|${Y}широкая\n|a |b\n|===\n`
    const { editor, session } = open(t)
    inCell(editor, 'широкая')
    expect(editor.commands.splitCell()).toBe(true)
    expect(session.text).toBe(`|===\n|${Y}широкая |${Y}\n|a |b\n|===\n`)
    const dom = editor.view.dom as HTMLElement
    expect(dom.querySelectorAll('td.cell-yellow')).toHaveLength(2)
    editor.commands.undo()
    expect(session.text).toBe(t)
  })

  it('merging two cells keeps the fill of the left one', () => {
    const t = `|===\n|x |y\n\n|${Y}a\n|\n|===\n`
    const { editor, session } = open(t)
    inCell(editor, 'a')
    shiftClick(editor, '')
    expect(editor.commands.mergeCells()).toBe(true)
    expect(session.text).toContain(Y)
    expect(editor.tableAt()!.fill).toBe('cell-yellow')
    editor.commands.undo()
    expect(session.text).toBe(t)
  })

  it('the head switched there and back keeps the fills', () => {
    const t = `|===\n|${Y}a |b\n\n|c |d\n|===\n`
    const { editor, session } = open(t)
    inCell(editor, 'a')
    editor.commands.toggleHeader()
    editor.commands.toggleHeader()
    inCell(editor, 'a')
    expect(editor.tableAt()!.fill).toBe('cell-yellow')
    expect(session.text).toContain(Y)
  })
})
