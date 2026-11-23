// the layer over a table — the grips that select a column or a row, and the borders that change the widths of the columns.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GRIP_MIN, GRIP_SHARE, dragBorder, evenBorder, explicitWidths, gripLength, widthRefusal } from '../src/tablegrips.js'
import { closeAll, inCell, open } from './helpers.js'

afterEach(closeAll)

const COL = 100
const ROW = 30
const LEFT = 100
const TOP = 50

/** Lays every table out as a grid: columns 100 px wide, rows 30 px high, the frame at (100, 50); a table in a cell is not laid out. */
let restore: (() => void) | null = null
/** When on, a table in a cell is laid out too: shifted by 30 px to the right and 40 px down for each table it is in. */
let nested = false
/** When set, the layer of the grips has its corner here, as in a container that is the block of `position: fixed`. */
let origin: { left: number; top: number } | null = null
/** When set, the frame of the scroll is only this wide, and the cells move left by its scrollLeft. */
let frameWidth: number | null = null
beforeEach(() => {
  const proto = HTMLElement.prototype
  const orig = proto.getBoundingClientRect
  proto.getBoundingClientRect = function (this: Element): DOMRect {
    const box0 = (left: number, top: number, w: number, h: number): DOMRect =>
      ({ left, top, right: left + w, bottom: top + h, width: w, height: h, x: left, y: top, toJSON() {} }) as DOMRect
    const zero = box0(0, 0, 0, 0)
    if (origin && this.classList.contains('nota-grips')) return box0(origin.left, origin.top, 800, 600)
    const tbl = this.closest('.tbl')
    let depth = 0
    for (let t = tbl?.parentElement?.closest('.tbl'); t; t = t.parentElement?.closest('.tbl')) depth++
    if (!tbl || (depth > 0 && !nested)) return zero
    const box = (left: number, top: number, w: number, h: number): DOMRect => box0(left + 30 * depth, top + 40 * depth, w, h)
    const rows = tbl.querySelectorAll(':scope > .tbl-scroll > table > tbody > tr').length
    const cols = tbl.querySelector(':scope > .tbl-scroll > table > colgroup')?.children.length ?? 0
    if (this === tbl) return box(LEFT, TOP - 20, cols * COL + 2, rows * ROW + 22)
    const shift = frameWidth === null ? 0 : (tbl.querySelector(':scope > .tbl-scroll') as HTMLElement).scrollLeft
    if (this.classList.contains('tbl-scroll')) return box(LEFT, TOP, frameWidth ?? cols * COL + 2, rows * ROW + 2)
    if (this.tagName === 'TR') return box(LEFT + 1 - shift, TOP + 1 + [...this.parentElement!.children].indexOf(this) * ROW, cols * COL, ROW)
    if (this.tagName === 'TD' || this.tagName === 'TH') {
      const r = [...this.parentElement!.parentElement!.children].indexOf(this.parentElement!)
      // (merged cells: the column is the first one that the cells of the rows above, with their rowspan, have not taken)
      const taken = new Set<string>()
      let k = 0
      for (const [i, tr] of [...this.parentElement!.parentElement!.children].entries()) {
        if (i > r) break
        let c = 0
        for (const td of Array.from(tr.children)) {
          while (taken.has(`${i},${c}`)) c++
          const cs = Number(td.getAttribute('colspan') ?? 1)
          const rs = Number(td.getAttribute('rowspan') ?? 1)
          if (td === this) k = c
          for (let y = 0; y < rs; y++) for (let x = 0; x < cs; x++) taken.add(`${i + y},${c + x}`)
          c += cs
        }
      }
      return box(LEFT + 1 - shift + k * COL, TOP + 1 + r * ROW, Number(this.getAttribute('colspan') ?? 1) * COL, Number(this.getAttribute('rowspan') ?? 1) * ROW)
    }
    return zero
  }
  restore = () => {
    nested = false
    origin = null
    frameWidth = null
    proto.getBoundingClientRect = orig
  }
})
afterEach(() => restore?.())

const frame = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()))

async function hover(x: number, y: number): Promise<void> {
  document.dispatchEvent(new MouseEvent('mousemove', { clientX: x, clientY: y, bubbles: true }))
  await frame()
  await frame()
}

const strips = (el: HTMLElement, cls: string): HTMLElement[] => [...el.querySelectorAll<HTMLElement>(`.nota-grips .${cls}`)]
const press = (node: HTMLElement, init: MouseEventInit = {}): void => {
  node.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, ...init }))
}
const up = (): void => void document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
const move = (x: number): void =>
  void document.dispatchEvent(new MouseEvent('mousemove', { clientX: x, clientY: TOP + 20, buttons: 1, bubbles: true, cancelable: true }))

const T = '[%header,cols="3"]\n|===\n|a |b |c\n|d |e |f\n|g |h |i\n|===\n'
/** The point over the cell (row, col) of the table. */
const IN = { x: LEFT + 50, y: TOP + 20 }

describe('the pure parts', () => {
  it('grows the table to the right: the neighbour stands, the left column takes the width from the table', () => {
    const p = [100 / 3, 100 / 3, 100 / 3]
    const r = dragBorder(p, 1, 7, 5)
    expect(r.limit).toBe(false)
    expect(r.live[0]).toBeCloseTo(100 / 3 + 7)
    expect(r.live[1]).toBeCloseTo(100 / 3)
    expect(r.live[2]).toBeCloseTo(100 / 3)
    expect(r.widths.reduce((s, w) => s + w, 0)).toBe(100)
    expect(r.widths[0]).toBeGreaterThan(34)
    expect(dragBorder(p, 1, 3, 5).limit).toBe(false)
    expect(dragBorder(p, 1, 0, 5).limit).toBe(false)
    expect(dragBorder(p, 1, 0, 5).widths.reduce((a, b) => a + b, 0)).toBe(100)
    // far to the right there is no stop
    const far = dragBorder(p, 1, 600, 5)
    expect(far.limit).toBe(false)
    expect(far.live[1]).toBeCloseTo(100 / 3)
  })

  it('the table keeps its width (the left drag, fractions before the first write): every border is at most half a percent off, at any border', () => {
    const p = Array.from({ length: 9 }, () => 100 / 9)
    for (let i = 1; i < 9; i++) {
      for (const delta of [-5, -3.4, -1.3]) {
        const r = dragBorder(p, i, delta, 3)
        expect(r.widths.reduce((s, w) => s + w, 0)).toBe(100)
        expect(r.widths.every((w) => Number.isInteger(w) && w >= 1)).toBe(true)
        let edge = 0
        let exact = 0
        r.widths.forEach((w, k) => {
          edge += w
          exact += r.live[k]!
          expect(Math.abs(edge - exact), `border ${k + 1} of the drag ${i}, ${delta}`).toBeLessThanOrEqual(0.5 + 1e-9)
        })
      }
    }
  })

  it('a neighbour that is at its least width, or below it, does not stop the move to the right', () => {
    const r = dragBorder([40, 57, 3], 2, 5, 5)
    expect(r.limit).toBe(false)
    expect(r.live).toEqual([40, 62, 3])
    const e = dragBorder([20, 5, 75], 1, 10, 5)
    expect(e.limit).toBe(false)
    expect(e.live).toEqual([30, 5, 75])
  })

  it('moves to the left: the table narrows while it is wider than its frame, then the neighbour takes the width', () => {
    // 40 % of the table is the room beyond the frame
    const p = [30, 30, 40]
    const a = dragBorder(p, 1, -10, 5, 40)
    expect(a.live).toEqual([20, 30, 40])
    expect(a.limit).toBe(false)
    // 50 % to the left: 40 are the table, 10 go to the neighbour
    const b = dragBorder(p, 1, -25, 5, 10)
    expect(b.live[0]).toBeCloseTo(5)
    expect(b.live[1]).toBeCloseTo(45)
    expect(b.limit).toBe(true)
    const c = dragBorder(p, 1, -20, 5, 10)
    expect(c.live[0]).toBeCloseTo(10)
    expect(c.live[1]).toBeCloseTo(40)
    expect(c.widths.reduce((s, w) => s + w, 0)).toBe(100)
    expect(c.limit).toBe(false)
  })

  it('the right edge of the last column: grows to the right, narrows by the slack, stops at the frame or at the least width', () => {
    const p = [30, 30, 40]
    // to the right: the last column and the table grow, nothing stops
    const g = dragBorder(p, 3, 20, 5, 10)
    expect(g.live).toEqual([30, 30, 60])
    expect(g.limit).toBe(false)
    expect(g.frame).toBe(false)
    expect(g.widths.reduce((s, w) => s + w, 0)).toBe(100)
    expect(g.widths[2]).toBeGreaterThan(g.widths[0]!)
    expect(dragBorder(p, 3, 600, 5, 10).frame).toBe(false)
    // to the left by less than the slack: the table narrows (the other columns keep their widths)
    const n = dragBorder(p, 3, -8, 5, 10)
    expect(n.live).toEqual([30, 30, 32])
    expect(n.limit).toBe(false)
    expect(n.frame).toBe(false)
    // further than the slack: the edge stops at the frame
    const f = dragBorder(p, 3, -25, 5, 10)
    expect(f.live).toEqual([30, 30, 30])
    expect(f.frame).toBe(true)
    expect(f.limit).toBe(false)
    expect(f.widths.reduce((s, w) => s + w, 0)).toBe(100)
    // a table that fits its frame (no slack) stops at once
    const fit = dragBorder(p, 3, -1, 5, 0)
    expect(fit.live).toEqual(p)
    expect(fit.frame).toBe(true)
    // the column reaches the least width before the frame: the stop is «least width»
    const m = dragBorder([40, 40, 20], 3, -30, 8, 50)
    expect(m.live[2]).toBeCloseTo(8)
    expect(m.limit).toBe(true)
    expect(m.frame).toBe(false)
    // a column that is already below the least width is not pushed to it
    const low = dragBorder([49, 49, 2], 3, -1, 8, 50)
    expect(low.live[2]).toBeCloseTo(2)
    expect(low.widths.every((w) => w >= 1)).toBe(true)
  })

  it('does not go under the width of a cell, and stops only for the dragged column', () => {
    // 64 px of 200 is 32 %
    const r = dragBorder([50, 50], 1, -40, 32)
    expect(r.widths).toEqual([32, 68])
    expect(r.limit).toBe(true)
    // a column that is below the least already stands still
    const l = dragBorder([5, 50, 45], 1, -10, 5)
    expect(l.live).toEqual([5, 50, 45])
    expect(l.limit).toBe(true)
    expect(dragBorder([50, 50], 1, -45, 5).limit).toBe(true)
    expect(dragBorder([50, 50], 1, -44, 5).limit).toBe(false)
  })

  it('shares the width of two columns equally, the odd percent to the left one', () => {
    expect(evenBorder([40, 27, 33], 1)).toEqual([34, 33, 33])
    expect(evenBorder([10, 80, 10], 2)).toEqual([10, 45, 45])
  })

  it('tells why the widths cannot be written', () => {
    expect(widthRefusal('[%autowidth]\n|===\n|a\n|===', 1)).toEqual({ code: 'width-autowidth', params: {} })
    expect(widthRefusal('[options="header,autowidth",cols="2"]\n|===', 2)?.code).toBe('width-autowidth')
    expect(widthRefusal('[cols="{plan-cols}"]\n|===', 3)).toEqual({ code: 'width-attr', params: { attr: '{plan-cols}' } })
    expect(widthRefusal('[cols="4"]\n|===', 3)).toEqual({ code: 'width-count', params: { cols: '4', table: '3' } })
    expect(widthRefusal('[cols="1,2*,3"]\n|===', 3)?.code).toBe('width-count')
    expect(widthRefusal('[cols="3"]\n|===', 3)).toBeNull()
    expect(widthRefusal('|===', 3)).toBeNull()
  })
})

describe('the handle of the block', () => {
  it('knows where the frame of a table starts, under its caption', () => {
    const s = open('.Title\n' + T)
    expect(s.editor.blockAtOffset(0)!.frameTop).toBe(TOP)
    closeAll()
    const p = open('para\n')
    expect(p.editor.blockAtOffset(0)!.frameTop).toBeNull()
  })
})

describe('the grips', () => {
  it('show over the table under the mouse, and go away with it', async () => {
    const s = open(T)
    expect(strips(s.el, 'cg')).toHaveLength(0)
    await hover(IN.x, IN.y)
    expect(strips(s.el, 'cg')).toHaveLength(3)
    expect(strips(s.el, 'rg')).toHaveLength(3)
    expect(strips(s.el, 'bd')).toHaveLength(3) // (one more, the right edge of the last column)
    // the band over the frame and at its left holds the mouse too
    await hover(LEFT + 50, TOP - 5)
    expect(strips(s.el, 'cg')).toHaveLength(3)
    await hover(LEFT - 5, TOP + 20)
    expect(strips(s.el, 'rg')).toHaveLength(3)
    await hover(LEFT - 40, TOP + 20)
    expect(strips(s.el, 'cg')).toHaveLength(0)
  })

  it('the layer drawn again (the bar comes up, a change of the editor, a scroll) keeps the nodes of the strips', async () => {
    const s = open(T)
    await hover(IN.x, IN.y)
    const all = (): HTMLElement[] => [...strips(s.el, 'cg'), ...strips(s.el, 'rg'), ...strips(s.el, 'bd')]
    const before = all()
    expect(before.length).toBe(9)
    // (the timer of the bar, 160 ms: it came up over the strip under the pointer, if there is one; a scroll and the editor draw the layer again)
    await new Promise((r) => setTimeout(r, 300))
    s.el.dispatchEvent(new Event('scroll', { bubbles: true }))
    await frame()
    await frame()
    s.editor.view.dispatch(s.editor.view.state.tr.setMeta('x', 1))
    await frame()
    await frame()
    const after = all()
    expect(after.length).toBe(before.length)
    after.forEach((el, k) => expect(el, `strip ${k}`).toBe(before[k]))
  })

  it('mark a table with the widths in a list, and the table that is dragged', async () => {
    const s = open(T)
    const tbl = s.el.querySelector('.tbl')!
    expect(tbl.classList.contains('tbl-fixed')).toBe(false)
    await hover(IN.x, IN.y)
    press(strips(s.el, 'bd')[0]!, { clientX: LEFT + COL, clientY: TOP + 20, buttons: 1 })
    expect(tbl.classList.contains('tbl-drag')).toBe(false)
    move(LEFT + COL + 1)
    expect(tbl.classList.contains('tbl-drag')).toBe(false)
    move(LEFT + COL + 30)
    expect(tbl.classList.contains('tbl-drag')).toBe(true)
    up()
    expect(tbl.classList.contains('tbl-drag')).toBe(false)
    // (written: the widths are in a list now)
    expect(s.editor.view.dom.querySelector('.tbl')!.classList.contains('tbl-fixed')).toBe(true)
    closeAll()
    expect(open('[cols="1,3"]\n|===\n|a |b\n|===\n').el.querySelector('.tbl')!.classList.contains('tbl-fixed')).toBe(true)
  })

  it('draw the grips of the innermost table only, when the mouse is over a table in a cell', async () => {
    nested = true
    const s = open('|===\na|x\n\n!===\n!p !q\n!===\n|b |c\n|===\n')
    expect(s.el.querySelectorAll('.tbl').length).toBe(2)
    await hover(LEFT + 50, TOP + 20)
    expect(strips(s.el, 'cg')).toHaveLength(1)
    // the inner frame is at (130, 90) with two columns of 100 px
    await hover(LEFT + 30 + 50, TOP + 40 + 10)
    const cg = strips(s.el, 'cg')
    expect(cg).toHaveLength(2)
    expect(strips(s.el, 'rg')).toHaveLength(1)
    expect(strips(s.el, 'bd')).toHaveLength(2) // (the right edge too)
  })

  it('count the places from the corner of the layer, not from the window', async () => {
    origin = { left: 20, top: 8 }
    const s = open(T)
    await hover(IN.x, IN.y)
    const first = strips(s.el, 'cg')[0]!
    expect(first.style.left).toBe(`${LEFT + 1 - 20}px`)
    expect(first.style.top).toBe(`${TOP - 10 - 8}px`)
  })

  it('the visible stroke is 70% of the line, not shorter than 24 px, not longer than the strip', () => {
    expect(GRIP_SHARE).toBe(0.7)
    expect(GRIP_MIN).toBe(24)
    expect(gripLength(200, 200)).toBe(140)
    expect(gripLength(64, 64)).toBe(45)
    expect(gripLength(30, 30)).toBe(24)
    expect(gripLength(100, 30)).toBe(30)
    expect(gripLength(10, 10)).toBe(10)
  })

  it('a strip covers the whole column and carries the length of its stroke', async () => {
    const s = open(T)
    await hover(IN.x, IN.y)
    const first = strips(s.el, 'cg')[0]!
    expect(first.style.width).toBe(`${COL}px`)
    expect(first.style.getPropertyValue('--gl')).toBe(`${Math.round(0.7 * COL)}px`)
    const row = strips(s.el, 'rg')[0]!
    expect(row.style.getPropertyValue('--gl')).toBe(`${Math.max(24, Math.round(0.7 * ROW))}px`)
  })

  it('draw nothing when the editor is gone, as in the mode of the text', async () => {
    const s = open(T)
    await hover(IN.x, IN.y)
    expect(s.el.querySelector('.nota-grips')).not.toBeNull()
    s.editor.destroy()
    expect(document.querySelector('.nota-grips')).toBeNull()
    await hover(IN.x, IN.y)
    expect(document.querySelector('.nota-grips .cg')).toBeNull()
  })

  it('pass the wheel over the strips on: sideways to the frame, up and down to the scroller', async () => {
    const s = open(T)
    await hover(IN.x, IN.y)
    const sc = s.el.querySelector<HTMLElement>('.tbl-scroll')!
    let left = 0
    Object.defineProperty(sc, 'scrollLeft', { get: () => left, set: (v: number) => void (left = Math.min(300, Math.max(0, v))), configurable: true })
    const page = document.documentElement
    let top = 0
    Object.defineProperty(page, 'scrollTop', { get: () => top, set: (v: number) => void (top = Math.max(0, v)), configurable: true })
    const wheel = (el: HTMLElement, init: WheelEventInit) => {
      const e = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init })
      el.dispatchEvent(e)
      return e
    }
    const side = wheel(strips(s.el, 'bd')[0]!, { deltaX: 40, deltaY: 0 })
    expect(left).toBe(40)
    expect(side.defaultPrevented).toBe(true)
    for (const cls of ['bd', 'cg', 'rg']) {
      top = 0
      const down = wheel(strips(s.el, cls)[0]!, { deltaY: 50 })
      expect(top).toBe(50)
      expect(down.defaultPrevented).toBe(true)
    }
    // lines: 3 lines are 48 px
    top = 0
    wheel(strips(s.el, 'rg')[0]!, { deltaY: 3, deltaMode: 1 })
    expect(top).toBe(48)
    // diagonal goes both ways
    top = 0
    left = 0
    wheel(strips(s.el, 'cg')[0]!, { deltaX: 10, deltaY: 20 })
    expect([left, top]).toEqual([10, 20])
  })

  it('keep the layer in the box of the editor, so the mode of the text (the box hidden) hides it with the editor', async () => {
    const s = open(T)
    await hover(IN.x, IN.y)
    const layer = s.el.querySelector<HTMLElement>('.nota-grips')!
    const box = (s.editor.view.dom as HTMLElement).parentElement!
    expect(layer.parentElement).toBe(box)
    box.hidden = true
    expect(getComputedStyle(box).display).toBe('none')
    expect(layer.closest('[hidden]')).toBe(box)
  })

  it('select a column with a click, more with Shift, and let go with Esc; the file and the history stay', async () => {
    const s = open(T)
    await hover(IN.x, IN.y)
    press(strips(s.el, 'cg')[1]!)
    const dom = s.editor.view.dom as HTMLElement
    expect([...dom.querySelectorAll('.sel')].map((c) => c.textContent)).toEqual(['b', 'e', 'h'])
    expect(s.editor.tableAt()).toMatchObject({ selectedCols: 1, selectedRows: 0 })
    expect(strips(s.el, 'cg').map((x) => x.classList.contains('on'))).toEqual([false, true, false])
    press(strips(s.el, 'cg')[2]!, { shiftKey: true })
    expect([...dom.querySelectorAll('.sel')].map((c) => c.textContent)).toEqual(['b', 'c', 'e', 'f', 'h', 'i'])
    expect(s.editor.tableAt()!.selectedCols).toBe(2)
    expect(s.session.text).toBe(T)
    dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    expect(dom.querySelectorAll('.sel')).toHaveLength(0)
    expect(s.session.text).toBe(T)
    expect(s.session.canUndo).toBe(false)
  })

  it('select a row; the mouse leaves and the selected grip stays', async () => {
    const s = open(T)
    await hover(IN.x, IN.y)
    press(strips(s.el, 'rg')[1]!)
    expect([...(s.editor.view.dom as HTMLElement).querySelectorAll('.sel')].map((c) => c.textContent)).toEqual(['d', 'e', 'f'])
    await hover(900, 900)
    expect(strips(s.el, 'rg').map((x) => x.classList.contains('on'))).toEqual([true])
    expect(strips(s.el, 'cg')).toHaveLength(0)
  })

  it('delete the selected columns in one step, and one undo gives the file back', async () => {
    const s = open(T)
    await hover(IN.x, IN.y)
    press(strips(s.el, 'cg')[0]!)
    press(strips(s.el, 'cg')[1]!, { shiftKey: true })
    expect(s.editor.commands.deleteColumn()).toBe(true)
    expect(s.session.text).toBe('[%header,cols="1"]\n|===\n|c\n|f\n|i\n|===\n')
    s.editor.commands.undo()
    expect(s.session.text).toBe(T)
  })

  it('delete the selected rows in one step', async () => {
    const s = open(T)
    await hover(IN.x, IN.y)
    press(strips(s.el, 'rg')[1]!)
    press(strips(s.el, 'rg')[2]!, { shiftKey: true })
    expect(s.editor.tableAt()!.selectedRows).toBe(2)
    expect(s.editor.commands.deleteRow()).toBe(true)
    expect(s.session.text).toBe('[%header,cols="3"]\n|===\n|a |b |c\n|===\n')
    s.editor.commands.undo()
    expect(s.session.text).toBe(T)
  })

  it('refuse to delete everything, with the old code and the file unchanged', async () => {
    const s = open(T)
    await hover(IN.x, IN.y)
    press(strips(s.el, 'cg')[0]!)
    press(strips(s.el, 'cg')[2]!, { shiftKey: true })
    expect(s.editor.commands.deleteColumn()).toBe(false)
    expect(s.rejects.at(-1)!.code).toBe('last-column')
    expect(s.session.text).toBe(T)
  })

  it('refuse to delete the selected columns that hold a merged cell, and the rows', async () => {
    const c = open('|===\n2+|ab |c\n|d |e |f\n|===\n')
    await hover(IN.x, IN.y)
    press(strips(c.el, 'cg')[0]!)
    expect(c.editor.commands.deleteColumn()).toBe(false)
    expect(c.rejects.at(-1)!.code).toBe('column-merged')
    expect(c.session.text).toBe('|===\n2+|ab |c\n|d |e |f\n|===\n')
    expect(c.session.canUndo).toBe(false)
    closeAll()
    const r = open('|===\n|a .2+|b\n|c\n|d |e\n|===\n')
    await hover(IN.x, IN.y)
    press(strips(r.el, 'rg')[0]!)
    expect(r.editor.commands.deleteRow()).toBe(false)
    expect(r.rejects.at(-1)!.code).toBe('row-merged')
    expect(r.session.text).toBe('|===\n|a .2+|b\n|c\n|d |e\n|===\n')
    expect(r.session.canUndo).toBe(false)
  })

  it('fill all the cells of the selection in one step', async () => {
    const s = open(T)
    await hover(IN.x, IN.y)
    press(strips(s.el, 'rg')[1]!)
    expect(s.editor.tableAt()!.cells).toBe(3)
    s.editor.commands.setCellFill('cell-blue')
    expect((s.session.text.match(/cell-blue/g) ?? []).length).toBe(3)
    s.editor.commands.undo()
    expect(s.session.text).toBe(T)
  })

  it('select a column of a table that has a merged cell over it as far as the cell goes', async () => {
    const s = open('|===\n2+|ab |c\n|d |e |f\n|===\n')
    await hover(IN.x, IN.y)
    press(strips(s.el, 'cg')[0]!)
    expect(s.editor.tableAt()!.selectedCols).toBe(2)
  })

  describe('a line that grows to the whole table is refused', () => {
    const COLMSG = 'column-merged-all'
    const selected = (s: ReturnType<typeof open>): number => (s.editor.view.dom as HTMLElement).querySelectorAll('[aria-selected]').length
    const none = (s: ReturnType<typeof open>, text: string): void => {
      expect(selected(s)).toBe(0)
      expect(s.session.text).toBe(text)
      expect(s.session.canUndo).toBe(false)
    }

    it('refuse a column of a table with a cell merged over all the columns', async () => {
      const text = '|===\n3+|a\n|b |c |d\n|===\n'
      for (const k of [0, 1, 2]) {
        const s = open(text)
        await hover(IN.x, IN.y)
        press(strips(s.el, 'cg')[k]!)
        none(s, text)
        expect(s.editor.tableAt()!.selectedCols).toBe(0)
        expect(s.rejects.at(-1)!.code).toBe(COLMSG)
        closeAll()
      }
    })

    it('refuse Shift-click 0…1, and a chain of partial merges', async () => {
      const text = '|===\n3+|a\n|b |c |d\n|===\n'
      const s = open(text)
      await hover(IN.x, IN.y)
      press(strips(s.el, 'cg')[0]!)
      press(strips(s.el, 'cg')[1]!, { shiftKey: true })
      none(s, text)
      expect(s.rejects.at(-1)!.code).toBe(COLMSG)
      closeAll()
      const chain = '|===\n2+|a |b\n|c 2+|d\n|===\n'
      const c = open(chain)
      await hover(IN.x, IN.y)
      press(strips(c.el, 'cg')[0]!)
      none(c, chain)
      expect(c.rejects.at(-1)!.code).toBe(COLMSG)
    })

    it('refuse a row of a table with a cell merged over all the rows; the old selection stays', async () => {
      const text = '|===\n.3+|a |b\n|c\n|d\n|===\n'
      const s = open(text)
      await hover(IN.x, IN.y)
      press(strips(s.el, 'rg')[1]!)
      none(s, text)
      expect(s.editor.tableAt()!.selectedRows).toBe(0)
      expect(s.rejects.at(-1)!.code).toBe('row-merged-all')
      closeAll()
      const t = '|===\n|a |b |c\n|d |e |f\n|===\n'
      const m = open(t)
      await hover(IN.x, IN.y)
      press(strips(m.el, 'cg')[1]!)
      expect(m.editor.tableAt()!.selectedCols).toBe(1)
      closeAll()
      const w = open('|===\n.3+|a |b\n|c\n|d\n|===\n')
      await hover(IN.x, IN.y)
      press(strips(w.el, 'cg')[1]!)
      expect(w.editor.tableAt()!.selectedCols).toBe(1)
      press(strips(w.el, 'rg')[1]!)
      expect(w.rejects.at(-1)!.code).toBe('row-merged-all')
      expect(w.editor.tableAt()!.selectedCols).toBe(1)
    })

    it('the whole table by Shift from the first to the last column is not refused', async () => {
      const s = open('|===\n3+|a\n|b |c |d\n|===\n')
      await hover(IN.x, IN.y)
      press(strips(s.el, 'cg')[0]!)
      const before = s.rejects.length
      press(strips(s.el, 'cg')[2]!, { shiftKey: true })
      expect(s.rejects.length).toBe(before)
      expect(s.editor.tableAt()!.selectedCols).toBe(3)
    })

    it('a column with cells merged over many rows (up to 18) selects alone; a closing row over all columns makes it refuse', async () => {
      const body = Array.from({ length: 17 }, () => '|x |y').join('\n')
      const tall = `[cols="3"]\n|===\n.18+|a |b |c\n${body}\n|===\n`
      const s = open(tall)
      await hover(IN.x, IN.y)
      for (const k of [0, 1, 2]) {
        press(strips(s.el, 'cg')[k]!)
        expect(s.editor.tableAt()!.selectedCols).toBe(1)
        expect(s.rejects.length).toBe(0)
      }
      press(strips(s.el, 'cg')[1]!)
      expect(selected(s)).toBe(18)
      closeAll()
      const mixed = `[cols="3"]\n|===\n.18+|a |b |c\n${body}\n3+|end\n|===\n`
      const m = open(mixed)
      await hover(IN.x, IN.y)
      press(strips(m.el, 'cg')[1]!)
      none(m, mixed)
      expect(m.rejects.at(-1)!.code).toBe(COLMSG)
    })

    it('the layout of the file: cells over 2…8 and 18 rows in the first column; a closing row over all columns refuses every column', async () => {
      // (the first column: cells over 2…8 rows, then one over 18; the other columns are one row each)
      const spans = [2, 3, 4, 5, 6, 7, 8, 18]
      const rows: string[] = []
      for (const n of spans) {
        rows.push(`.${n}+|a${n} |b |c`)
        for (let i = 1; i < n; i++) rows.push('|x |y')
      }
      const body = rows.join('\n')
      const bare = `[cols="3"]\n|===\n${body}\n|===\n`
      const s = open(bare)
      await hover(IN.x, IN.y)
      for (const k of [0, 1, 2]) {
        press(strips(s.el, 'cg')[k]!)
        expect(s.editor.tableAt()!.selectedCols).toBe(1)
        expect(s.rejects.length).toBe(0)
      }
      closeAll()
      const closed = `[cols="3"]\n|===\n${body}\n3+|end\n|===\n`
      const m = open(closed)
      await hover(IN.x, IN.y)
      for (const k of [0, 1, 2]) {
        press(strips(m.el, 'cg')[k]!)
        expect(m.rejects.at(-1)!.code).toBe(COLMSG)
        expect(m.rejects.length).toBe(k + 1)
        expect(m.editor.tableAt()!.selectedCols).toBe(0)
        expect(selected(m)).toBe(0)
      }
      none(m, closed)
    })

    it('12 columns in a scrolled frame select one column; with a full-width row, refuse', async () => {
      const row = Array.from({ length: 12 }, (_, i) => `|c${i}`).join(' ')
      const s = open(`|===\n${row}\n${row}\n|===\n`)
      await hover(IN.x, IN.y)
      let left = 0
      Object.defineProperty(s.el.querySelector('.tbl-scroll')!, 'scrollLeft', { get: () => left, set: (v: number) => void (left = v), configurable: true })
      frameWidth = 4 * COL
      left = 500
      document.dispatchEvent(new Event('scroll'))
      await hover(LEFT + 50, TOP + 20)
      const all = strips(s.el, 'cg')
      // the frame shows columns 5…8 only; the strip of column 7 is the third
      expect(all.map((g) => g.style.left)).toEqual(['101px', '201px', '301px', '401px'])
      const strip = all[2]!
      press(strip)
      expect(s.editor.tableAt()!.selectedCols).toBe(1)
      expect(selected(s)).toBe(2)
      const dom = s.editor.view.dom as HTMLElement
      expect([...dom.querySelectorAll('[aria-selected]')].map((c) => c.textContent)).toEqual(['c7', 'c7'])
      closeAll()
      frameWidth = null
      const text = `|===\n12+|h\n${row}\n|===\n`
      const w = open(text)
      await hover(IN.x, IN.y)
      press(strips(w.el, 'cg')[7]!)
      none(w, text)
      expect(w.rejects.at(-1)!.code).toBe(COLMSG)
    })

    it('a nested table with a full-width cell refuses, the outer is not selected', async () => {
      nested = true
      const text = '|===\na|x\n\n!===\n2+!h\n!p !q\n!===\n|b |c\n|===\n'
      const s = open(text)
      await hover(LEFT + 30 + 50, TOP + 40 + 10)
      press(strips(s.el, 'cg')[0]!)
      none(s, text)
      expect(s.rejects.at(-1)!.code).toBe(COLMSG)
    })
  })

  it('work in a table that cannot get widths', async () => {
    const s = open('[%autowidth]\n|===\n|a |b\n|===\n')
    await hover(IN.x, IN.y)
    press(strips(s.el, 'cg')[1]!)
    expect(s.editor.tableAt()!.selectedCols).toBe(1)
  })
})

describe('the borders', () => {
  const border = (s: ReturnType<typeof open>, i: number): HTMLElement => strips(s.el, 'bd')[i - 1]!

  it('change the widths on the way and write cols when the button is let go; one undo and one redo', async () => {
    const s = open(T)
    await hover(IN.x, IN.y)
    press(border(s, 1), { clientX: LEFT + 1 + COL })
    move(LEFT + 1 + COL + 21)
    const cols = [...(s.editor.view.dom as HTMLElement).querySelectorAll<HTMLElement>('colgroup col')]
    // (the layout of the drag is in pixels: the shares of the table are what the percents say)
    const px = cols.map((c) => parseFloat(c.style.width))
    const all = px.reduce((a, b) => a + b, 0)
    expect(px.map((w) => Math.floor((100 * w) / all))).toEqual([37, 31, 31])
    expect(s.session.text).toBe(T)
    expect(s.el.querySelector('.wtag')!.textContent).toBe('38%')
    up()
    expect(s.session.text).toBe('[%header,cols="38,31,31"]\n|===\n|a |b |c\n|d |e |f\n|g |h |i\n|===\n')
    s.editor.commands.undo()
    expect(s.session.text).toBe(T)
    s.editor.commands.redo()
    expect(s.session.text).toContain('cols="38,31,31"')
  })

  it('the right edge of the last column is a border too: numbered, drags to the right, does nothing on a double click', async () => {
    const s = open(T)
    await hover(IN.x, IN.y)
    expect(strips(s.el, 'bd').map((b) => b.dataset.border)).toEqual(['1', '2', '3'])
    const edge = border(s, 3)
    // (a double click: there is no pair to share the width)
    press(edge, { clientX: LEFT + 1 + 3 * COL, detail: 2 })
    expect(s.session.text).toBe(T)
    expect(s.el.querySelector('.wtag')).toBeNull()
    await hover(IN.x, IN.y)
    press(border(s, 3), { clientX: LEFT + 1 + 3 * COL })
    move(LEFT + 1 + 3 * COL + 30)
    up()
    const w = /cols="([\d,]+)"/.exec(s.session.text)?.[1]?.split(',').map(Number)
    expect(w).toHaveLength(3)
    expect(w!.reduce((a, b) => a + b, 0)).toBe(100)
    expect(w![2]).toBeGreaterThan(w![0]!)
    s.editor.commands.undo()
    expect(s.session.text).toBe(T)
  })

  it('keep the scrolled frame and the focus of the editor after a drag and after a column is deleted', async () => {
    const s = open(T)
    await hover(IN.x, IN.y)
    const frameOf = () => s.el.querySelector<HTMLElement>('.tbl-scroll')!
    const before = frameOf()
    before.scrollLeft = 70
    ;(document.activeElement as HTMLElement | null)?.blur()
    press(border(s, 1), { clientX: LEFT + 1 + COL })
    move(LEFT + 1 + COL + 21)
    up()
    expect(s.session.text).toContain('cols="38,31,31"')
    expect(frameOf()).toBe(before)
    expect(before.scrollLeft).toBe(70)
    expect([...before.querySelectorAll('col')].map((c) => c.getAttribute('style'))).toEqual(['width:38%', 'width:31%', 'width:31%'])
    expect(s.editor.view.hasFocus()).toBe(true)
    await hover(IN.x, IN.y)
    press(strips(s.el, 'cg')[0]!)
    s.editor.commands.deleteColumn()
    expect(frameOf()).toBe(before)
    expect(before.scrollLeft).toBe(70)
    expect(before.querySelectorAll('col')).toHaveLength(2)
  })

  it('stop at the least width and say so', async () => {
    const s = open(T)
    await hover(IN.x, IN.y)
    press(border(s, 1), { clientX: LEFT + 1 + COL })
    move(LEFT + 1 - 500)
    expect(s.el.querySelector('.wtag')!.textContent).toBe('Minimum width')
    up()
    expect(s.session.text).toMatch(/cols="(\d+),(\d+),33"/)
    expect(s.session.text).toContain('cols="21,46,33"')
  })

  it('do not write anything for a press without a move, and Esc takes a drag back', async () => {
    const s = open(T)
    await hover(IN.x, IN.y)
    press(border(s, 1), { clientX: LEFT + 1 + COL })
    up()
    expect(s.session.text).toBe(T)
    expect(s.session.canUndo).toBe(false)
    await hover(IN.x, IN.y)
    const styles = (): (string | null)[] => [...(s.editor.view.dom as HTMLElement).querySelectorAll('colgroup col')].map((c) => c.getAttribute('style'))
    const before = styles()
    const left = border(s, 1).style.left
    press(border(s, 1), { clientX: LEFT + 1 + COL })
    move(LEFT + 1 + COL + 50)
    expect(styles()).not.toEqual(before)
    expect(border(s, 1).style.left).not.toBe(left)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    up()
    expect(s.session.text).toBe(T)
    expect(styles()).toEqual(before)
    // (the border stays the same node, so it goes back to its place)
    expect(border(s, 1).style.left).toBe(left)
    expect(s.el.querySelector('.wtag')).toBeNull()
  })

  it('share the width of two columns on a double click', async () => {
    const s = open(T)
    await hover(IN.x, IN.y)
    press(border(s, 1), { clientX: LEFT + 1 + COL, detail: 2 })
    expect(s.session.text).toContain('cols="34,33,33"')
    s.editor.commands.undo()
    expect(s.session.text).toBe(T)
  })

  it('keep the form of cols: percent signs, alignment and style, a column of ~', async () => {
    const pct = open('[cols="20%,30%,50%"]\n|===\n|a |b |c\n|===\n')
    await hover(IN.x, IN.y)
    press(strips(pct.el, 'bd')[0]!, { clientX: LEFT + 1 + COL, detail: 2 })
    expect(pct.session.text).toBe('[cols="34%,33%,33%"]\n|===\n|a |b |c\n|===\n')
    closeAll()
    const al = open('[cols="<.^1,3a"]\n|===\n|a |b\n|===\n')
    await hover(IN.x, IN.y)
    press(strips(al.el, 'bd')[0]!, { clientX: LEFT + 1 + COL, detail: 2 })
    expect(al.session.text).toBe('[cols="<.^50,50a"]\n|===\n|a |b\n|===\n')
  })

  it('add the attribute line when the table has none', async () => {
    const s = open('|===\n|a |b\n|===\n')
    await hover(IN.x, IN.y)
    press(strips(s.el, 'bd')[0]!, { clientX: LEFT + 1 + COL, detail: 2 })
    expect(s.session.text).toBe('[cols="50,50"]\n|===\n|a |b\n|===\n')
    s.editor.commands.undo()
    expect(s.session.text).toBe('|===\n|a |b\n|===\n')
  })

  it('give the widths back and tell why, in a table that cannot get them', async () => {
    for (const [text, code] of [
      ['[%autowidth]\n|===\n|a |b\n|===\n', 'width-autowidth'],
      ['[cols="{plan-cols}"]\n|===\n|a |b\n|===\n', 'width-attr'],
    ] as const) {
      const s = open(text)
      await hover(IN.x, IN.y)
      press(strips(s.el, 'bd')[0]!, { clientX: LEFT + 1 + COL })
      move(LEFT + 1 + COL + 30)
      up()
      expect(s.rejects.at(-1)!.code).toBe(code)
      expect(s.session.text).toBe(text)
      expect(s.session.canUndo).toBe(false)
      closeAll()
    }
  })

  it('drag a border that a merged cell crosses', async () => {
    const s = open('[cols="2"]\n|===\n2+|ab\n|c |d\n|===\n')
    await hover(IN.x, IN.y)
    press(strips(s.el, 'bd')[0]!, { clientX: LEFT + 1 + COL, detail: 2 })
    expect(s.session.text).toBe('[cols="50,50"]\n|===\n2+|ab\n|c |d\n|===\n')
  })

  it('writes the widths of the table the cursor is not in without moving the cursor', async () => {
    const s = open(T + '\npara\n')
    inCell(s.editor, 'a')
    await hover(IN.x, IN.y)
    press(border(s, 2), { clientX: LEFT + 1 + 2 * COL, detail: 2 })
    expect(s.session.text).toContain('cols="')
    expect(s.editor.view.state.selection.from).toBeGreaterThan(0)
  })

  // the head wraps only in a table with the widths in a list
  it('tells whether the attributes of a table give the widths', () => {
    expect(explicitWidths('|===\n|a\n|===')).toBe(false)
    expect(explicitWidths('[%header]\n|===')).toBe(false)
    expect(explicitWidths('[%header,cols="9"]\n|===')).toBe(false)
    expect(explicitWidths('[%header,cols="1,3"]\n|===')).toBe(true)
    expect(explicitWidths('[cols="20%,80%"]\n|===')).toBe(true)
    expect(explicitWidths('[%autowidth,cols="1,3"]\n|===')).toBe(false)
    expect(explicitWidths('[%header%autowidth]\n|===')).toBe(false)
    expect(explicitWidths('[options="header,autowidth",cols="1,3"]\n|===')).toBe(false)
    expect(explicitWidths('.Title\n[cols="2*"]\n|===')).toBe(false)
  })
})

// ---------------------------------------------------------------- the bar of three buttons at a grip

import { colsRefusal, lineRefusal, placeBar, placeTip, type Box, type Measure } from '../src/tablelinebar.js'

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const bars = (el: HTMLElement): HTMLElement[] => [...el.querySelectorAll<HTMLElement>('.nota-grips .gb')].filter((b) => !b.hidden)
const buttons = (el: HTMLElement): HTMLButtonElement[] => [...el.querySelectorAll<HTMLButtonElement>('.nota-grips .gb:not([hidden]) .gbtn')]
const ST = '[%header,cols="3"]\n|===\n|a |b |c\n|d |e |f\n|g |h |i\n|===\n'
const PLAIN = '|===\n|a1 |b1 |c1 |d1\n|a2 |b2 |c2 |d2\n|a3 |b3 |c3 |d3\n|a4 |b4 |c4 |d4\n|===\n'

/** The pointer on a grip of the table (columns over the frame, rows at its left), then the time the bar needs to come. */
async function overGrip(kind: 'cg' | 'rg', i: number): Promise<void> {
  await hover(IN.x, IN.y)
  const r = kind === 'cg' ? { x: LEFT + i * COL + 50, y: TOP - 5 } : { x: LEFT - 5, y: TOP + 1 + i * ROW + 15 }
  await hover(r.x, r.y)
  await wait(260)
  await frame()
}

describe('what is refused beforehand, and where the bar and its hint stand', () => {
  const v = (o: Partial<{ nrows: number; ncols: number; headRows: number; footRows: number }>): never =>
    ({ nrows: 4, ncols: 4, headRows: 0, footRows: 0, ...o }) as never
  it('dims the delete of the last line, the row above the head and the row below the footer; nothing else', () => {
    expect(lineRefusal(v({ ncols: 1 }), 'col', 'delete', 0, 0)?.code).toBe('last-column')
    expect(lineRefusal(v({}), 'col', 'delete', 0, 3)?.code).toBe('last-column')
    expect(lineRefusal(v({}), 'row', 'delete', 0, 2)).toBeNull()
    expect(lineRefusal(v({ headRows: 1 }), 'row', 'before', 0, 0)?.code).toBe('row-above-head')
    expect(lineRefusal(v({ headRows: 1 }), 'row', 'before', 1, 1)).toBeNull()
    expect(lineRefusal(v({ headRows: 1 }), 'row', 'after', 0, 0)).toBeNull()
    expect(lineRefusal(v({ footRows: 1 }), 'row', 'after', 3, 3)?.code).toBe('row-below-foot')
    expect(lineRefusal(v({ footRows: 1 }), 'row', 'before', 3, 3)).toBeNull()
    expect(lineRefusal(v({ headRows: 1 }), 'col', 'before', 0, 0)).toBeNull()
  })

  it('refuses a column by `cols` that is not a list, with its own codes, and leaves %autowidth alone', () => {
    expect(colsRefusal('[cols="{n}"]\n|===\n|a\n|===\n', 1)).toMatchObject({ code: 'cols-attr', params: { attr: '{n}' } })
    expect(colsRefusal('[cols="3"]\n|===\n|a\n|===\n', 4)).toMatchObject({ code: 'cols-count', params: { cols: '3', table: '4' } })
    expect(colsRefusal('[%autowidth]\n|===\n|a\n|===\n', 1)).toBeNull()
    expect(colsRefusal('|===\n|a\n|===\n', 1)).toBeNull()
  })

  const bounds: Box = { left: 0, top: 0, right: 400, bottom: 600 }
  it('puts the bar of a column over its grip, centred on the visible part, inside the bounds, and not under a capsule', () => {
    const strip: Box = { left: 103, top: 100, right: 197, bottom: 110 }
    const b = placeBar('col', strip, [100, 200], bounds, [])!
    expect(b.bottom).toBe(98)
    expect((b.left + b.right) / 2).toBe(150)
    // (a column that is half out of the frame: the bar is centred on what is seen, and stays in the bounds)
    expect(placeBar('col', strip, [-60, 20], bounds, [])!.left).toBe(0)
    expect(placeBar('col', strip, [390, 520], bounds, [])!.right).toBe(400)
    expect(placeBar('col', strip, [100, 200], bounds, [{ left: 0, top: 60, right: 400, bottom: 90 }])).toBeNull()
    expect(placeBar('col', { ...strip, top: 10, bottom: 20 }, [100, 200], bounds, [])).toBeNull()
  })

  it('puts the bar of a column beside the capsule of the tab when the capsule is over the grip, and none where it would not stand over its column', () => {
    const strip: Box = { left: 103, top: 100, right: 197, bottom: 110 }
    // (the capsule is over the middle of the column and reaches 2 px into the place of the bar)
    const cap: Box = { left: 130, top: 40, right: 300, bottom: 90 }
    const b = placeBar('col', strip, [100, 200], bounds, [cap])!
    expect(b.right).toBeLessThanOrEqual(cap.left - 2)
    expect(b.bottom).toBe(98)
    expect(Math.min(b.right, 200) - Math.max(b.left, 100)).toBeGreaterThanOrEqual(22)
    // (the capsule over the whole width: nowhere)
    expect(placeBar('col', strip, [100, 200], bounds, [{ left: 0, top: 40, right: 400, bottom: 90 }])).toBeNull()
  })

  it('puts the bar of a row in the margin at the left of its grip, next to it where the margin is narrow, and presses it up at the bottom edge', () => {
    const strip: Box = { left: 90, top: 200, right: 100, bottom: 230 }
    const wide = placeBar('row', strip, [200, 230], bounds, [])!
    expect(wide.right).toBe(86)
    expect(placeBar('row', { ...strip, left: 28, right: 38 }, [200, 230], bounds, [])!.right).toBe(28)
    const low = placeBar('row', { ...strip, top: 560, bottom: 590 }, [560, 590], bounds, [])!
    expect(low.bottom).toBe(600)
    expect(placeBar('row', { ...strip, left: 20, right: 30 }, [200, 230], bounds, [])).toBeNull()
    // (the strokes of the sections stand beside the grip: the bar stands right of the grip, over its row, and never on the strokes)
    const strokes: Box = { left: 14, top: 150, right: 70, bottom: 300 }
    const aside = placeBar('row', strip, [200, 230], bounds, [strokes])!
    expect(aside.left).toBeGreaterThanOrEqual(strip.right)
    expect(aside.top).toBeLessThan(230)
    expect(aside.bottom).toBeGreaterThan(200)
    expect(placeBar('row', strip, [200, 230], bounds, [{ ...strokes, right: 400 }])).toBeNull()
  })

  const estimate: Measure = (t, form, maxW) => {
    const len = form === 'reason' ? (t.reason ?? '').length : form === 'line' ? t.name.length + (t.reason ? t.reason.length + 3 : 0) : Math.max(t.name.length, (t.reason ?? '').length)
    const w = Math.min(maxW, len * 6.5 + 14)
    return { w, h: Math.ceil((len * 6.5) / Math.max(20, w - 14)) * 14 + 4 }
  }
  const base = {
    text: { name: 'Add a column to the right', reason: null },
    button: { left: 150, top: 80, right: 172, bottom: 102 },
    bar: { left: 120, top: 80, right: 191, bottom: 106 },
    strip: { left: 103, top: 108, right: 197, bottom: 118 },
    span: [100, 200] as [number, number],
    frame: { left: 100, top: 118, right: 500, bottom: 300 },
    bounds,
    isles: [] as Box[],
    strips: [] as Box[],
    outer: null,
    rows: [] as Box[],
    measure: estimate,
  }
  it('puts the hint of a column over the bar; beside the bar when a capsule is over it; on its own column when there is no room at the side', () => {
    const a = placeTip({ ...base, kind: 'col' })!
    expect(a.form).toBe('card')
    expect(a.box.bottom).toBe(78)
    const capsule: Box = { left: 0, top: 40, right: 400, bottom: 76 }
    const side = placeTip({ ...base, kind: 'col', isles: [capsule] })!
    expect(side.box.left).toBeGreaterThanOrEqual(195)
    expect(side.box.bottom).toBe(106)
    expect(side.own).toBe(false)
    const narrow = placeTip({ ...base, kind: 'col', isles: [capsule], bounds: { left: 100, top: 0, right: 200, bottom: 600 } })!
    expect(narrow.own).toBe(true)
    expect(narrow.box.top).toBe(119)
    expect(narrow.box.left).toBeGreaterThanOrEqual(100)
    expect(narrow.box.right).toBeLessThanOrEqual(200)
  })

  it('puts the hint of a row on its own row, from 4 px right of the frame, not higher than the row; the reason alone when the name does not fit', () => {
    const rows: Box[] = [{ left: 100, right: 500, top: 150, bottom: 180 }]
    const t = placeTip({ ...base, kind: 'row', rows, button: { left: 60, top: 150, right: 82, bottom: 172 }, text: { name: 'Add a row above', reason: null } })!
    expect(t.own).toBe(true)
    expect(t.box.left).toBe(104)
    expect(t.box.top).toBeGreaterThanOrEqual(150)
    expect(t.box.bottom).toBeLessThanOrEqual(180)
    const why = 'Above the head a row cannot be added: it would become the head. Add the row below.'
    const narrow = placeTip({ ...base, kind: 'row', rows, bounds: { ...bounds, right: 220 }, text: { name: 'Add a row above', reason: why } })
    expect(narrow === null || narrow.form === 'reason').toBe(true)
    expect(placeTip({ ...base, kind: 'row', rows: [{ left: 100, right: 500, top: 150, bottom: 156 }] })).toBeNull()
  })
})

describe('the bar at a grip, in the editor', () => {
  it('comes up at a grip in 160 ms with three buttons and goes when the mouse leaves it; no grip has a title', async () => {
    const s = open(PLAIN)
    await hover(IN.x, IN.y)
    expect(strips(s.el, 'cg').every((g) => !g.hasAttribute('title') && g.getAttribute('role') === 'button' && /^Column \d$/.test(g.getAttribute('aria-label')!))).toBe(true)
    expect(strips(s.el, 'rg').map((g) => g.getAttribute('aria-label'))).toEqual(['Row 1', 'Row 2', 'Row 3', 'Row 4'])
    await hover(LEFT + COL + 50, TOP - 5)
    expect(bars(s.el)).toHaveLength(0)
    await wait(260)
    expect(bars(s.el)).toHaveLength(1)
    expect(buttons(s.el).map((b) => b.getAttribute('aria-label'))).toEqual(['Add a column to the left', 'Add a column to the right', 'Delete the column'])
    expect(buttons(s.el).some((b) => b.hasAttribute('title'))).toBe(false)
    await hover(900, 700)
    await wait(300)
    expect(bars(s.el)[0]?.classList.contains('on') ?? false).toBe(false)
    await wait(200)
    expect(bars(s.el)).toHaveLength(0)
  })

  it('adds a column on the left of the grip, not at the cursor, as one step of the history, and the cursor is in the new column', async () => {
    const s = open(PLAIN)
    inCell(s.editor, 'd4')
    await overGrip('cg', 1)
    buttons(s.el)[0]!.click()
    expect(s.session.text).toBe('|===\n|a1 | |b1 |c1 |d1\n|a2 | |b2 |c2 |d2\n|a3 | |b3 |c3 |d3\n|a4 | |b4 |c4 |d4\n|===\n')
    s.editor.commands.undo()
    expect(s.session.text).toBe(PLAIN)
    s.editor.commands.redo()
    s.editor.commands.undo()
    expect(s.session.text).toBe(PLAIN)
    expect(s.rejects).toEqual([])
  })

  it('adds a column on the right and a row above and below, and deletes a row, each in one undo', async () => {
    const s = open(PLAIN)
    await overGrip('cg', 1)
    buttons(s.el)[1]!.click()
    expect(s.session.text.split('\n')[1]).toBe('|a1 |b1 | |c1 |d1')
    s.editor.commands.undo()
    closeAll()
    for (const [btn, expected] of [
      [0, ['|a1 |b1 |c1 |d1', '|a2 |b2 |c2 |d2', '|a3 |b3 |c3 |d3']],
      [1, ['|a1 |b1 |c1 |d1', '|a2 |b2 |c2 |d2', '|a3 |b3 |c3 |d3']],
      [2, ['|a1 |b1 |c1 |d1', '|a3 |b3 |c3 |d3', '|a4 |b4 |c4 |d4']],
    ] as const) {
      const r = open(PLAIN)
      await overGrip('rg', 1)
      buttons(r.el)[btn]!.click()
      expect(r.session.text).not.toBe(PLAIN)
      const lines = r.session.text.split('\n').slice(1, -2)
      if (btn === 2) expect(lines).toEqual(expected)
      else expect(lines.length).toBe(5)
      r.editor.commands.undo()
      expect(r.session.text).toBe(PLAIN)
      closeAll()
    }
  })

  it('«ниже» puts the row right under the row of the grip, «выше» right over it', async () => {
    const a = open(PLAIN)
    await overGrip('rg', 1)
    buttons(a.el)[0]!.click()
    expect(a.session.text.split('\n')[2]).toBe('| | | |')
    closeAll()
    const b = open(PLAIN)
    await overGrip('rg', 1)
    buttons(b.el)[1]!.click()
    expect(b.session.text.split('\n')[3]).toBe('| | | |')
  })

  it('deletes the selected columns with one group of buttons, and the number on the delete button', async () => {
    const s = open(PLAIN)
    await hover(IN.x, IN.y)
    press(strips(s.el, 'cg')[0]!)
    press(strips(s.el, 'cg')[2]!, { shiftKey: true })
    await frame()
    await frame()
    expect(bars(s.el)).toHaveLength(1)
    const b = buttons(s.el)
    expect(b[2]!.getAttribute('aria-label')).toBe('Delete columns: 3')
    expect(b[2]!.textContent).toBe('3')
    b[2]!.click()
    expect(s.session.text).toBe('|===\n|d1\n|d2\n|d3\n|d4\n|===\n')
    s.editor.commands.undo()
    expect(s.session.text).toBe(PLAIN)
  })

  it('adds one column before the selection and one after it', async () => {
    const s = open(PLAIN)
    await hover(IN.x, IN.y)
    press(strips(s.el, 'cg')[1]!)
    press(strips(s.el, 'cg')[2]!, { shiftKey: true })
    await frame()
    await frame()
    buttons(s.el)[1]!.click()
    expect(s.session.text.split('\n')[1]).toBe('|a1 |b1 |c1 | |d1')
    s.editor.commands.undo()
    press(strips(s.el, 'cg')[1]!)
    press(strips(s.el, 'cg')[2]!, { shiftKey: true })
    await frame()
    await frame()
    buttons(s.el)[0]!.click()
    expect(s.session.text.split('\n')[1]).toBe('|a1 | |b1 |c1 |d1')
  })

  it('dims the buttons that are refused beforehand, and the click gives the same text as the notice', async () => {
    const s = open(ST)
    await overGrip('rg', 0)
    const b = buttons(s.el)
    expect(b[0]!.getAttribute('aria-disabled')).toBe('true')
    expect(b[1]!.getAttribute('aria-disabled')).toBeNull()
    expect(b[0]!.dataset.reason).toContain('head')
    b[0]!.click()
    expect(s.rejects.at(-1)!.code).toBe('row-above-head')
    expect(s.rejects.at(-1)!.message).toBe(b[0]!.dataset.reason)
    expect(s.session.text).toBe(ST)
    expect(s.session.canUndo).toBe(false)
    expect(bars(s.el)).toHaveLength(1)
    b[1]!.click()
    expect(s.rejects).toHaveLength(1)
    expect(s.session.text.split('\n')[3]).toBe('| | |')
  })

  it('refuses the last column and the last row, and a column in a table with cols by an attribute', async () => {
    const one = open('|===\n|a\n|===\n')
    await overGrip('cg', 0)
    expect(buttons(one.el)[2]!.getAttribute('aria-disabled')).toBe('true')
    buttons(one.el)[2]!.click()
    expect(one.rejects.at(-1)!.code).toBe('last-column')
    closeAll()
    const attr = open('[cols="{n}"]\n|===\n|a |b\n|c |d\n|===\n')
    await overGrip('cg', 0)
    expect(buttons(attr.el)[0]!.getAttribute('aria-disabled')).toBeNull()
    buttons(attr.el)[0]!.click()
    expect(attr.rejects.at(-1)!.code).toBe('cols-attr')
    expect(attr.rejects.at(-1)!.message).toContain('{n}')
    expect(attr.session.text).toBe('[cols="{n}"]\n|===\n|a |b\n|c |d\n|===\n')
  })

  it('keeps %autowidth, and widens a merged cell that the new column cuts', async () => {
    const a = open('[%autowidth]\n|===\n|a |b\n|c |d\n|===\n')
    await overGrip('cg', 0)
    buttons(a.el)[1]!.click()
    expect(a.rejects).toEqual([])
    expect(a.session.text.startsWith('[%autowidth]')).toBe(true)
    closeAll()
    const m = open('|===\n2+|ab |c\n|d |e |f\n|===\n')
    await overGrip('cg', 0)
    buttons(m.el)[1]!.click()
    expect(m.rejects).toEqual([])
    expect(m.session.text).toContain('3+|ab')
  })

  it('works in a table of a cell: only the table of the grip changes', async () => {
    nested = true
    const text = '|===\na|\n!===\n!x !y\n!z !w\n!===\n|b\n|===\n'
    const s = open(text)
    await hover(LEFT + 50, TOP + 20)
    await hover(LEFT + 1 + 30 + 50, TOP + 1 + 40 - 4)
    await wait(260)
    expect(strips(s.el, 'cg').length).toBeGreaterThan(0)
    expect(bars(s.el)).toHaveLength(1)
    buttons(s.el)[1]!.click()
    expect(s.session.text).toBe('|===\na|\n!===\n!x ! !y\n!z ! !w\n!===\n|b\n|===\n')
    s.editor.commands.undo()
    expect(s.session.text).toBe(text)
  })

  it('works in a table of a table of a cell (level 3), and the outer table is the same byte for byte; the outer grip gives the buttons of the outer table', async () => {
    nested = true
    const text = '|===\na|\n!===\na!\n,===\np,q\nr,s\n,===\n!b\n!===\n|b\n|===\n'
    const s = open(text)
    expect(s.el.querySelectorAll('.tbl').length).toBe(3)
    // (the third frame is at (160, 130): 30 px and 40 px for each table it is in)
    await hover(LEFT + 50, TOP + 20)
    await hover(LEFT + 60 + 50, TOP + 80 - 4)
    await wait(260)
    expect(bars(s.el)).toHaveLength(1)
    expect(strips(s.el, 'cg')).toHaveLength(2)
    buttons(s.el)[1]!.click()
    const after = s.session.text
    expect(after).not.toBe(text)
    // (the outer and the second table are as they were byte for byte: all that is before the third table and after it; the third one has its new column)
    const head = '|===\na|\n!===\na!\n,===\n'
    const tail = ',===\n!b\n!===\n|b\n|===\n'
    expect(after.startsWith(head)).toBe(true)
    expect(after.endsWith(tail)).toBe(true)
    expect(after.slice(head.length, after.length - tail.length)).toBe('p,,q\nr,,s\n')
    s.editor.commands.undo()
    expect(s.session.text).toBe(text)
    // the grip of the outer table: its own buttons, and the inner tables stay
    await hover(LEFT + 50, TOP + 20)
    await hover(LEFT + 50, TOP - 5)
    await wait(260)
    expect(bars(s.el)).toHaveLength(1)
    buttons(s.el)[1]!.click()
    expect(s.session.text).toBe('|===\na|\n!===\na!\n,===\np,q\nr,s\n,===\n!b\n!=== |\n|b |\n|===\n')
    s.editor.commands.undo()
    expect(s.session.text).toBe(text)
  })

  it('the bar of a line outside the selection acts on that line alone and lets the selection go', async () => {
    const s = open(PLAIN)
    await hover(IN.x, IN.y)
    press(strips(s.el, 'cg')[0]!)
    press(strips(s.el, 'cg')[1]!, { shiftKey: true })
    expect(s.editor.tableAt()!.selectedCols).toBe(2)
    await hover(LEFT + 3 * COL + 50, TOP - 5)
    await wait(260)
    await frame()
    expect(bars(s.el)).toHaveLength(1)
    expect(buttons(s.el).map((b) => b.getAttribute('aria-label'))).toEqual(['Add a column to the left', 'Add a column to the right', 'Delete the column'])
    expect(buttons(s.el)[2]!.textContent).not.toBe('2')
    buttons(s.el)[1]!.click()
    expect(s.session.text.split('\n')[1]).toBe('|a1 |b1 |c1 |d1 |')
    expect(s.editor.tableAt()!.selectedCols).toBe(0)
    s.editor.commands.undo()
    // the same for rows: the line outside the selection is deleted alone
    press(strips(s.el, 'rg')[0]!)
    press(strips(s.el, 'rg')[1]!, { shiftKey: true })
    await hover(IN.x, IN.y)
    await hover(LEFT - 5, TOP + 1 + 3 * ROW + 15)
    await wait(260)
    await frame()
    expect(buttons(s.el).map((b) => b.getAttribute('aria-label'))).toEqual(['Add a row above', 'Add a row below', 'Delete the row'])
    buttons(s.el)[2]!.click()
    expect(s.session.text).toBe('|===\n|a1 |b1 |c1 |d1\n|a2 |b2 |c2 |d2\n|a3 |b3 |c3 |d3\n|===\n')
    expect(s.editor.tableAt()!.selectedRows).toBe(0)
  })

  it('deletes three selected rows with one button that has a 3 on it, in one undo', async () => {
    const s = open(PLAIN)
    await hover(IN.x, IN.y)
    press(strips(s.el, 'rg')[0]!)
    press(strips(s.el, 'rg')[2]!, { shiftKey: true })
    await frame()
    await frame()
    expect(bars(s.el)).toHaveLength(1)
    const b = buttons(s.el)
    expect(b[2]!.getAttribute('aria-label')).toBe('Delete rows: 3')
    expect(b[2]!.textContent).toBe('3')
    b[2]!.click()
    expect(s.session.text).toBe('|===\n|a4 |b4 |c4 |d4\n|===\n')
    s.editor.commands.undo()
    expect(s.session.text).toBe(PLAIN)
  })

  it('shows the bar of a column that the click on its grip refuses (column-merged-all), and the buttons work', async () => {
    const s = open('|===\n2+|ab\n|c |d\n|===\n')
    await hover(IN.x, IN.y)
    press(strips(s.el, 'cg')[0]!)
    expect(s.rejects.at(-1)?.code).toBe('column-merged-all')
    const n = s.rejects.length
    await overGrip('cg', 0)
    expect(bars(s.el)).toHaveLength(1)
    buttons(s.el)[1]!.click()
    expect(s.rejects).toHaveLength(n)
    expect(s.session.text).toContain('3+|ab')
  })

  it('does not let go of a hint on a button that has the keyboard focus when the mouse leaves it', async () => {
    const s = open(PLAIN)
    await overGrip('cg', 1)
    const b = buttons(s.el)[0]!
    b.focus()
    b.dispatchEvent(new MouseEvent('mouseenter'))
    await wait(700)
    const tip = s.el.querySelector<HTMLElement>('.nota-grips .gtip')!
    expect(tip.hidden).toBe(false)
    b.dispatchEvent(new MouseEvent('mouseleave'))
    expect(tip.hidden).toBe(false)
    b.blur()
    expect(tip.hidden).toBe(true)
  })

  it('no strip has a system title, the border has its name in aria-label', async () => {
    const s = open(PLAIN)
    await hover(IN.x, IN.y)
    expect(strips(s.el, 'bd').length).toBeGreaterThan(0)
    for (const g of [...strips(s.el, 'bd'), ...strips(s.el, 'cg'), ...strips(s.el, 'rg')]) {
      expect(g.hasAttribute('title')).toBe(false)
      expect(g.getAttribute('aria-label')).toBeTruthy()
    }
  })

  it('holds the bar while the mouse goes from the grip to its buttons along the bridge', async () => {
    const s = open(PLAIN)
    await overGrip('cg', 1)
    const bar = bars(s.el)[0]!
    const g = { x: LEFT + COL + 50, y: TOP - 5 }
    // (in this layout the boxes of the layer are not laid out: the bar is where the layer has put it; the real layout is measured in Chrome, `bridge`)
    const bx = parseFloat(bar.style.left) || 0
    const by = parseFloat(bar.style.top) || 0
    const steps = 8
    for (let k = 1; k <= steps; k++) {
      await hover(g.x + ((bx + 20 - g.x) * k) / steps, g.y + ((by + 8 - g.y) * k) / steps)
      expect(bars(s.el), `step ${k}`).toHaveLength(1)
    }
  })
})

describe('the refusals of the buttons, and the cursor after them', () => {
  it('refuses a row below the footer and puts a row above it; a refused button leaves file, history and bar as they were', async () => {
    const F = '[%footer]\n|===\n|a |b\n|c |d\n|e |f\n|===\n'
    const s = open(F)
    await overGrip('rg', 2)
    const b = buttons(s.el)
    expect(b[1]!.getAttribute('aria-disabled')).toBe('true')
    b[1]!.click()
    expect(s.rejects.at(-1)!.code).toBe('row-below-foot')
    expect(s.session.text).toBe(F)
    expect(s.session.canUndo).toBe(false)
    expect(buttons(s.el)).toHaveLength(3)
    b[0]!.click()
    expect(s.rejects).toHaveLength(1)
    expect(s.session.text.split('\n').slice(2, 6)).toEqual(['|a |b', '|c |d', '| |', '|e |f'])
  })

  it('refuses to delete a column that a merged cell crosses, by the bar, as by the capsule', async () => {
    const text = '|===\n2+|ab |c\n|d |e |f\n|===\n'
    const s = open(text)
    await overGrip('cg', 0)
    buttons(s.el)[2]!.click()
    expect(s.rejects.at(-1)!.code).toBe('column-merged')
    expect(s.session.text).toBe(text)
    expect(s.session.canUndo).toBe(false)
  })

  it('the cursor is in another table: the button changes the table of the grip alone, the other table stays byte for byte, and one undo gives the file back', async () => {
    // (in this layout the tables lie over each other: the grip that is hovered is the one of the last table, and the cursor stays in the first)
    const other = '|===\n|e1 |f1\n|e2 |f2\n|===\n'
    const text = PLAIN + '\n' + other
    const s = open(text)
    inCell(s.editor, 'a3')
    await overGrip('cg', 1)
    buttons(s.el)[1]!.click()
    const after = s.session.text
    expect(after).toBe(PLAIN + '\n|===\n|e1 |f1 |\n|e2 |f2 |\n|===\n')
    s.editor.commands.undo()
    expect(s.session.text).toBe(text)
  })

  it('puts the cursor in the new column (its first row) and in the first cell of the new row', async () => {
    const s = open(PLAIN)
    inCell(s.editor, 'd4')
    await overGrip('cg', 1)
    buttons(s.el)[0]!.click()
    const at = s.editor.selectionOffsets()!.head
    expect(s.session.text.slice(0, at)).toBe('|===\n|a1 |')
    closeAll()
    const r = open(PLAIN)
    inCell(r.editor, 'd4')
    await overGrip('rg', 1)
    buttons(r.el)[1]!.click()
    expect(r.session.text.slice(0, r.editor.selectionOffsets()!.head).split('\n').at(-1)).toBe('|')
  })

  it('the buttons of the capsule are as before: a row under the row of the cursor, the old texts for what is new', async () => {
    const s = open('[%footer]\n|===\n|a |b\n|e |f\n|===\n')
    inCell(s.editor, 'e')
    expect(s.editor.commands.insertRow()).toBe(false)
    expect(s.rejects.at(-1)!.code).toBe('row-below-foot')
    closeAll()
    const c = open('[cols="{n}"]\n|===\n|a |b\n|c |d\n|===\n')
    inCell(c.editor, 'a')
    expect(c.editor.commands.insertColumn()).toBe(false)
    expect(c.rejects.at(-1)!.code).toBe('cols-attr')
    expect(c.editor.commands.deleteColumn()).toBe(false)
    expect(c.rejects.at(-1)!.code).toBe('cols-attr')
  })
})

describe('the touch screen', () => {
  it('a tap on a grip selects the line and shows the bar at once, and the buttons work without a mouse over them', async () => {
    const s = open(PLAIN)
    inCell(s.editor, 'a1', 'start')
    document.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', bubbles: true }))
    await frame()
    await frame()
    press(strips(s.el, 'rg')[1]!)
    await frame()
    await frame()
    expect(bars(s.el)).toHaveLength(1)
    expect(s.editor.tableAt()!.selectedRows).toBe(1)
    buttons(s.el)[2]!.click()
    expect(s.session.text).toBe('|===\n|a1 |b1 |c1 |d1\n|a3 |b3 |c3 |d3\n|a4 |b4 |c4 |d4\n|===\n')
  })

  it('does not set the role of a tooltip on a hint that is not shown', async () => {
    const s = open(PLAIN)
    await overGrip('cg', 1)
    expect(s.el.querySelectorAll('[role=tooltip]')).toHaveLength(0)
    buttons(s.el)[0]!.dispatchEvent(new MouseEvent('mouseenter'))
    await wait(400)
    expect(s.el.querySelectorAll('[role=tooltip]')).toHaveLength(1)
    expect(s.el.querySelector('[role=tooltip]')!.textContent).toBe('Add a column to the left')
  })
})

describe('the keyboard at the grips', () => {
  const keyOn = (el: Element, key: string, init: KeyboardEventInit = {}): void =>
    void el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }))

  it('Shift+Tab in the first cell goes to the grip of the first column; the arrows walk, Enter opens the bar with the focus on the first button', async () => {
    const s = open(PLAIN)
    inCell(s.editor, 'a1', 'start')
    s.editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }))
    await frame()
    const g0 = document.activeElement as HTMLElement
    expect(g0.classList.contains('cg')).toBe(true)
    expect(g0.dataset.i).toBe('0')
    keyOn(g0, 'ArrowRight')
    const g1 = document.activeElement as HTMLElement
    expect(`${g1.dataset.kind}${g1.dataset.i}`).toBe('col1')
    keyOn(g1, 'ArrowDown')
    expect((document.activeElement as HTMLElement).dataset.kind).toBe('row')
    keyOn(document.activeElement!, 'ArrowUp')
    expect((document.activeElement as HTMLElement).dataset.kind).toBe('col')
    keyOn(document.activeElement!, 'ArrowRight')
    keyOn(document.activeElement!, 'Enter')
    const bar = s.el.querySelector<HTMLElement>('.nota-grips .gb:not([hidden])')!
    expect(bar.getAttribute('role')).toBe('toolbar')
    expect(bar.getAttribute('aria-label')).toBe('Column 2')
    expect(document.activeElement).toBe(buttons(s.el)[0])
    keyOn(document.activeElement!, 'ArrowRight')
    keyOn(document.activeElement!, 'ArrowRight')
    expect(document.activeElement).toBe(buttons(s.el)[2])
    keyOn(document.activeElement!, 'ArrowRight')
    expect(document.activeElement).toBe(buttons(s.el)[2])
  })

  it('Enter on a button does the action and the focus is on the grip of that place; Esc in the bar closes it, the focus on the grip; Esc on the grip goes to the text', async () => {
    const s = open(PLAIN)
    inCell(s.editor, 'a1', 'start')
    s.editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }))
    await frame()
    keyOn(document.activeElement!, 'ArrowRight')
    keyOn(document.activeElement!, 'Enter')
    keyOn(document.activeElement!, 'Escape')
    expect(bars(s.el)).toHaveLength(0)
    expect((document.activeElement as HTMLElement).dataset.kind).toBe('col')
    expect((document.activeElement as HTMLElement).dataset.i).toBe('1')
    keyOn(document.activeElement!, 'Enter')
    buttons(s.el)[1]!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(s.session.text.split('\n')[1]).toBe('|a1 |b1 | |c1 |d1')
    await frame()
    const f = document.activeElement as HTMLElement
    expect(`${f.dataset.kind}${f.dataset.i}`).toBe('col2')
    keyOn(f, 'Escape')
    expect(document.activeElement).toBe(s.editor.view.dom)
  })

  it('Tab on a grip goes to the first cell; Shift+arrows widen the selection like Shift+click', async () => {
    const s = open(PLAIN)
    inCell(s.editor, 'a1', 'start')
    s.editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }))
    await frame()
    keyOn(document.activeElement!, 'ArrowRight', { shiftKey: true })
    keyOn(document.activeElement!, 'ArrowRight', { shiftKey: true })
    expect(s.editor.tableAt()!.selectedCols).toBe(3)
    keyOn(document.activeElement!, 'Tab')
    expect(document.activeElement).toBe(s.editor.view.dom)
  })

  it('Esc on a grip lets the selection go', async () => {
    const s = open(PLAIN)
    inCell(s.editor, 'a1', 'start')
    s.editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }))
    await frame()
    keyOn(document.activeElement!, 'ArrowRight', { shiftKey: true })
    expect(s.editor.tableAt()!.selectedCols).toBe(2)
    keyOn(document.activeElement!, 'Escape')
    expect(s.editor.tableAt()!.selectedCols).toBe(0)
    expect(s.session.text).toBe(PLAIN)
    expect(s.session.canUndo).toBe(false)
  })

  it('keeps the focus on the grip when another table is edited and drawn again, and when the mouse goes over another table', async () => {
    const s = open(PLAIN + '\n' + PLAIN)
    inCell(s.editor, 'a1', 'start')
    s.editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }))
    await frame()
    const g = document.activeElement as HTMLElement
    expect(g.classList.contains('cg')).toBe(true)
    const t = g.dataset.t
    // (an edit in the other table)
    const cells = s.editor.view.dom.querySelectorAll('table')
    const last = cells[cells.length - 1]!.querySelector('td')!
    const st = s.editor.view.state
    s.editor.view.dispatch(st.tr.insertText('z', s.editor.view.posAtDOM(last, 0) + 1))
    await frame()
    await frame()
    expect((document.activeElement as HTMLElement).dataset.t).toBe(t)
    expect(document.activeElement?.classList.contains('cg')).toBe(true)
    expect((document.activeElement as HTMLElement).dataset.i).toBe('0')
    await hover(900, 900)
    await hover(IN.x, IN.y)
    expect(document.activeElement?.classList.contains('cg')).toBe(true)
  })

  it('keeps the focus on the grip when the layer is drawn again', async () => {
    const s = open(PLAIN)
    inCell(s.editor, 'a1', 'start')
    s.editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }))
    await frame()
    const g = document.activeElement as HTMLElement
    document.dispatchEvent(new Event('scroll'))
    await frame()
    await frame()
    // (the strip is the same node after the layer is drawn again, so the focus never left it)
    expect(document.activeElement).toBe(g)
    expect(document.activeElement?.classList.contains('cg')).toBe(true)
    expect((document.activeElement as HTMLElement).dataset.i).toBe('0')
  })
})
