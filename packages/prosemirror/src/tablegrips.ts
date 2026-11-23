/**
 * The layer over the tables of the visual editor: the grips that select a column or a row, and the borders that change
 * the widths of the columns. The layer is a `position: fixed` element beside the editor (it is not in the document the editor
 * shows), laid over the table under the mouse; the editor tells it what a click means (`GripHost`).
 */
import type { TableView } from '@nota-adoc/core/internal'
import { DOMSerializer, type Node as PMNode } from 'prosemirror-model'
import type { NodeView } from 'prosemirror-view'
import { getLabels, schema } from './schema.js'
import { type Anchor, type Box, type LineAct, type LineKind, TableLineBar } from './tablelinebar.js'

// ---------------------------------------------------------------- the table in the page

/**
 * The view of a table: what `toDOM` says, and the `<col>` elements are the layer's own while a border is dragged
 * (the editor does not take the change of their style for an edit).
 */
export class TableNodeView implements NodeView {
  readonly dom: HTMLElement
  readonly contentDOM: HTMLElement
  private node: PMNode
  private readonly watch: ResizeObserver | null = null

  constructor(node: PMNode, doc: Document) {
    const r = DOMSerializer.renderSpec(doc, schema.nodes.table!.spec.toDOM!(node))
    this.dom = r.dom as HTMLElement
    this.contentDOM = r.contentDOM as HTMLElement
    this.node = node
    // (the least width of the table depends on the width of its frame: it is read again when the frame changes)
    const frame = this.dom.querySelector(':scope > .tbl-scroll')
    const view = doc.defaultView
    if (frame && view && 'ResizeObserver' in view) {
      this.watch = new (view as unknown as { ResizeObserver: typeof ResizeObserver }).ResizeObserver(() => this.fit())
      this.watch.observe(frame)
      const table = frame.querySelector(':scope > table')
      if (table) this.watch.observe(table)
    }
    this.makeBar(frame as HTMLElement | null)
  }

  /**
   * a table wider than its frame scrolls sideways, but the scroll bar of the frame is under the last row, and in a table of a hundred
   * rows it is far below the window. The bar here is a copy of it that sticks to the bottom of the window while the table goes on, and is linked
   * to the scroll of the frame (the bar of the frame itself is then hidden: `.has-bar`).
   */
  private bar: HTMLElement | null = null
  private barInner: HTMLElement | null = null

  private makeBar(frame: HTMLElement | null): void {
    if (!frame) return
    const doc = this.dom.ownerDocument
    const bar = doc.createElement('div')
    bar.className = 'tbl-bar'
    bar.setAttribute('contenteditable', 'false')
    bar.setAttribute('aria-label', getLabels().tableScroll ?? 'Scroll the table sideways')
    const inner = doc.createElement('div')
    bar.appendChild(inner)
    this.dom.appendChild(bar)
    this.bar = bar
    this.barInner = inner
    // (the frame is the master: the bar follows it. The bar moves the frame only while a hand is on the bar: a scroll event comes a frame late,
    // and a bar that was only set, or clamped when the table changed its width, would send the frame back to where the bar was)
    const view = this.dom.ownerDocument.defaultView!
    const touch = (): void => {
      view.clearTimeout(this.hand)
      this.hand = view.setTimeout(() => (this.hand = 0), 400)
    }
    bar.addEventListener('pointerdown', touch)
    bar.addEventListener('wheel', touch, { passive: true })
    bar.addEventListener('keydown', touch)
    bar.addEventListener('scroll', () => {
      if (!this.hand) return
      // (a bar that is dragged sends scroll events all the time: the hand stays on it while they come)
      touch()
      if (Math.abs(frame.scrollLeft - bar.scrollLeft) > 0.5) frame.scrollLeft = bar.scrollLeft
    })
    frame.addEventListener('scroll', () => this.followFrame())
  }

  /** The timer while a hand is on the bar (a press on it, the wheel or a key a moment ago), 0 when there is none. */
  private hand = 0

  /** The bar goes to where the frame is. */
  private followFrame(): void {
    const frame = this.dom.querySelector<HTMLElement>(':scope > .tbl-scroll')
    const bar = this.bar
    if (!frame || !bar || Math.abs(frame.scrollLeft - bar.scrollLeft) <= 0.5) return
    bar.scrollLeft = frame.scrollLeft
  }

  /** the element that scrolls the document (the bar sticks to its bottom edge) and the listener on it. */
  private scroller: HTMLElement | null = null
  private onScroll = (): void => this.stick()

  private watchScroller(): void {
    if (this.scroller) return
    const view = this.dom.ownerDocument.defaultView
    if (!view) return
    for (let e = this.dom.parentElement; e; e = e.parentElement) {
      const y = view.getComputedStyle(e).overflowY
      if (y === 'auto' || y === 'scroll') {
        this.scroller = e
        e.addEventListener('scroll', this.onScroll, { passive: true })
        // (the window gets taller or shorter: the bottom edge moves with no scroll event)
        view.addEventListener('resize', this.onScroll)
        return
      }
    }
  }

  private unwatchScroller(): void {
    if (!this.scroller) return
    this.scroller.removeEventListener('scroll', this.onScroll)
    this.dom.ownerDocument.defaultView?.removeEventListener('resize', this.onScroll)
    this.scroller = null
  }

  /**
   * the bar stands at the very bottom edge of the window while the bottom of the table is below it (`bar-stuck`: the frame of the table
   * goes on down to the bar, the line closes the table over it), and right under the table when the bottom is in the window. The bar needs 12 px
   * under the frame (a gap of 2 and the track of 10) and 2 px of the gap under the track.
   */
  private stick(): void {
    const frame = this.dom.querySelector<HTMLElement>(':scope > .tbl-scroll')
    const sc = this.scroller
    if (!frame) return
    const bottom = sc ? sc.getBoundingClientRect().top + sc.clientTop + sc.clientHeight : (this.dom.ownerDocument.defaultView?.innerHeight ?? Infinity)
    const stuck = frame.getBoundingClientRect().bottom + 14 > bottom + 0.5
    if (this.dom.classList.contains('bar-stuck') !== stuck) this.dom.classList.toggle('bar-stuck', stuck)
  }

  /** The bar shows while the frame scrolls (a table in a cell keeps the scroll bar of its frame). */
  private syncBar(): void {
    const frame = this.dom.querySelector<HTMLElement>(':scope > .tbl-scroll')
    const bar = this.bar
    const inner = this.barInner
    if (!frame || !bar || !inner) return
    const nested = !!this.dom.parentElement?.closest('.tbl')
    const wide = !nested && frame.clientWidth > 0 && frame.scrollWidth > frame.clientWidth + 1
    if (this.dom.classList.contains('has-bar') !== wide) this.dom.classList.toggle('has-bar', wide)
    if (!wide) {
      this.unwatchScroller()
      this.dom.classList.remove('bar-stuck')
      return
    }
    this.watchScroller()
    this.stick()
    // (the two scroll ranges are equal: the bar is as wide as the frame with its border, and the content is as wide as the frame's)
    const want = `${frame.scrollWidth + (bar.clientWidth - frame.clientWidth)}px`
    if (inner.style.width !== want) inner.style.width = want
    this.followFrame()
  }

  /**
   * columns that cannot all be as wide as their percents say (every cell needs 64 px, and together they are wider than the frame)
   * would all sit at 64 px, whatever the percents are. The table then has the width at which the narrowest of the percents is 64 px, and
   * the frame scrolls. A table that fits its frame is left to the style sheet.
   */
  private fit(): void {
    if (this.dom.classList.contains('tbl-drag')) {
      this.syncBar()
      return
    }
    const frame = this.dom.querySelector<HTMLElement>(':scope > .tbl-scroll')
    const table = frame?.querySelector<HTMLElement>(':scope > table')
    if (!frame || !table) return
    const w = this.node.attrs.widths as number[]
    const all = w.reduce((a, b) => a + b, 0)
    const crowded = w.length > 0 && w.every((x) => x > 0) && frame.clientWidth > 0 && w.length * MIN_CELL > frame.clientWidth
    // (a column of 1% would ask for a table of 6400 px: the table grows to three frames at most, the narrow column is then wider than its percent)
    const top = Math.max(w.length * MIN_CELL, MAX_GROW * frame.clientWidth)
    const need = crowded ? Math.min(top, Math.ceil(Math.max(...w.map((x) => (MIN_CELL * all) / x)))) : 0
    const now = table.style.minWidth
    // (a table that was dragged wider than its frame stays as wide as the drag left it: the head wraps at once and would shrink it otherwise)
    const keep = Number(table.dataset.keepWidth) || 0
    const least = Math.max(need, keep)
    const want = least > 0 ? `${least}px` : ''
    if (now !== want) table.style.minWidth = want
    this.syncBar()
  }

  destroy(): void {
    this.watch?.disconnect()
    this.unwatchScroller()
    if (this.hand) this.dom.ownerDocument.defaultView?.clearTimeout(this.hand)
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false
    const a = this.node.attrs
    const b = node.attrs
    if (a.level !== b.level || a.caption !== b.caption || a.head !== b.head) return false
    // (the class of the explicit widths changes in place too)
    if (a.fixed !== b.fixed) this.dom.classList.toggle('tbl-fixed', !!b.fixed)
    const table = this.dom.querySelector<HTMLElement>(':scope > .tbl-scroll > table')
    // (the memory of widths stays: redo brings the widths of a drag back, also in a table without percents)
    if (!b.fixed && table) delete table.dataset.keepWidth
    if (JSON.stringify(a.widths) !== JSON.stringify(b.widths)) {
      // (the width a drag left is bound to the widths it wrote: undo goes back to the old width, redo to the width of the drag)
      if (table) {
        const kept = readKept(table)[JSON.stringify(b.widths)]
        if (kept) table.dataset.keepWidth = String(kept)
        else delete table.dataset.keepWidth
      }
      // (the widths change in the same element: the frame of the table keeps where it was scrolled to)
      const group = this.dom.querySelector(':scope > .tbl-scroll > table > colgroup')
      if (!group) return false
      const doc = this.dom.ownerDocument
      const cols = (b.widths as number[]).map((w) => {
        const col = doc.createElement('col')
        if (w > 0) col.setAttribute('style', `width:${w}%`)
        return col
      })
      group.replaceChildren(...cols)
    }
    this.node = node
    this.fit()
    return true
  }

  ignoreMutation(m: { type: string; target: Node }): boolean {
    // (the style of a `<col>` of a drag, the `caret-color` that ProseMirror puts on the caption: not edits, and not a reason to draw the table again)
    return (m.type === 'attributes' && !this.contentDOM.contains(m.target)) || !!this.bar?.contains(m.target)
  }
}

/** The widths a drag wrote (as JSON) and the width in px the table had after it, kept on the `<table>`. */
function readKept(table: HTMLElement): Record<string, number> {
  try {
    const m = JSON.parse(table.dataset.keepMap ?? '{}') as unknown
    return m && typeof m === 'object' ? (m as Record<string, number>) : {}
  } catch {
    return {}
  }
}

// ---------------------------------------------------------------- the widths

/** The narrowest a column goes: what a cell needs (64 px in the style of the tab), in any table (no percent floor above it). */
export const MIN_CELL = 64
/** The most a crowded table grows, in widths of its frame. */
export const MAX_GROW = 3

/** The least width of a column, in percent of a table `total` px wide: the real 64 px (never more, so a column that stands at 64 px is not «below the least»). */
export function minPercent(total: number): number {
  return Math.min(100, (100 * MIN_CELL) / Math.max(total, 1))
}

export interface Dragged {
  /** The widths on the screen while dragging, in percent of the table before the drag (the other columns as they were); they add up to more than 100 when the table has grown. */
  readonly live: readonly number[]
  /** The widths to write: whole percents, 100 in all. */
  readonly widths: readonly number[]
  /** The border stands at the least width of a column. */
  readonly limit: boolean
  /** the right edge of the last column stands at the right edge of the frame (the table is as wide as its frame and no narrower). */
  readonly frame: boolean
}

/**
 * The widths when the border `i` (between the columns `i - 1` and `i`) is moved by `delta` percent of the table (the border goes
 * where the mouse goes). To the right the neighbour stands, and the table grows by what the left column took. To the left the table narrows
 * first, by at most `slack` (percent of the table that lie beyond its frame), then the neighbour takes the rest. The only stop is the least
 * width of the dragged column itself.
 */
export function dragBorder(p: readonly number[], i: number, delta: number, min: number, slack = 0): Dragged {
  if (i >= p.length) return dragEdge(p, delta, min, slack)
  const l0 = p[i - 1]!
  const r0 = p[i]!
  const minL = Math.min(l0, min)
  const eps = 1e-6
  let left = l0 + delta
  let right = r0
  let limit = false
  if (delta < 0) {
    if (left <= minL + eps) limit = true
    if (left < minL) left = minL
    right = r0 + Math.max(0, l0 - left - Math.max(0, slack))
  }
  const live = p.map((w, k) => (k === i - 1 ? left : k === i ? right : w))
  // (the table kept its width or grew: the running sums are rounded in both cases, so that no border is more than half a percent off, also before the first write, when the shares are fractions)
  const widths = shares(live)
  return { live, widths, limit, frame: false }
}

/**
 * the right edge of the last column (`i` = the number of columns): there is no neighbour. To the right the column and the table grow by `delta`.
 * To the left they narrow by at most `slack` (percent of the table that lie beyond its frame): there the edge stops at the edge of the frame (`frame`),
 * or earlier, at the least width of the column (`limit`).
 */
function dragEdge(p: readonly number[], delta: number, min: number, slack: number): Dragged {
  const eps = 1e-6
  const k = p.length - 1
  const l0 = p[k]!
  const minL = Math.min(l0, min)
  const floor = Math.max(minL, l0 - Math.max(0, slack))
  let left = l0 + delta
  let limit = false
  let frame = false
  if (left <= floor + eps) {
    left = floor
    // (the least width of the column wins when both stops are at the same place)
    if (floor <= minL + eps) limit = true
    else frame = true
  }
  const live = p.map((w, j) => (j === k ? left : w))
  return { live, widths: shares(live), limit, frame }
}

/**
 * The table has grown: every column has its share of the new width, whole percents, 100 in all.
 * The running sums are rounded, not the columns: every border is at most half a percent off, each column at most one.
 */
function shares(live: readonly number[]): number[] {
  const all = live.reduce((s, w) => s + w, 0)
  const n = live.length
  const ints: number[] = []
  let sum = 0
  let prev = 0
  for (let k = 0; k < n; k++) {
    sum += live[k]!
    // (a column keeps at least one percent, and the columns after it too)
    const edge = k === n - 1 ? 100 : Math.max(prev + 1, Math.min(100 - (n - 1 - k), Math.round((100 * sum) / all)))
    ints.push(edge - prev)
    prev = edge
  }
  return ints
}

/** The two columns at a border share their width equally (the odd percent goes to the left one). */
export function evenBorder(p: readonly number[], i: number): number[] {
  const widths = p.map((w) => Math.max(1, Math.round(w)))
  const pair = 100 - widths.reduce((s, w, k) => (k === i - 1 || k === i ? s : s + w), 0)
  widths[i - 1] = Math.ceil(pair / 2)
  widths[i] = pair - widths[i - 1]!
  return widths
}

/**
 * Whether the attributes of a table (the lines in `[…]` before its delimiter) give the widths of the columns, as a list:
 * `cols="1,3"`, `cols="20%,80%"`. No `cols`, `cols="9"` (the number of columns) and `%autowidth` give none: the head of such a table stays in one line.
 */
export function explicitWidths(src: string): boolean {
  const attrs: string[] = []
  for (const line of src.split(/\r\n|\r|\n/)) {
    if (/^[|!:,]={3,}\s*$/.test(line)) break
    if (line.startsWith('[')) attrs.push(line)
  }
  const text = attrs.join(',')
  if (/%autowidth\b|\b(?:options|opts)\s*=\s*["']?[^\]"']*\bautowidth\b/.test(text)) return false
  const m = /\bcols\s*=\s*(?:"([^"]*)"|'([^']*)'|([^,\]]*))/.exec(text)
  if (!m) return false
  const raw = (m[1] ?? m[2] ?? m[3] ?? '').trim()
  return raw !== '' && !/^\d+\*?$/.test(raw)
}

/** Why the widths of a table cannot be written, from the text of its block (attribute lines first), or null. */
export function widthRefusal(src: string, columns: number): { code: string; params: Record<string, string> } | null {
  const attrs: string[] = []
  for (const line of src.split(/\r\n|\r|\n/)) {
    if (/^[|!:,]={3,}\s*$/.test(line)) break
    if (line.startsWith('[')) attrs.push(line)
  }
  const text = attrs.join(',')
  if (/%autowidth\b|\b(?:options|opts)\s*=\s*["']?[^\]"']*\bautowidth\b/.test(text)) return { code: 'width-autowidth', params: {} }
  const m = /\bcols\s*=\s*(?:"([^"]*)"|'([^']*)'|([^,\]]*))/.exec(text)
  if (!m) return null
  const raw = (m[1] ?? m[2] ?? m[3] ?? '').trim()
  const ref = /\{[^}]*\}/.exec(raw)
  if (ref) return { code: 'width-attr', params: { attr: ref[0] } }
  let n = 0
  if (/^\d+$/.test(raw)) n = Number(raw)
  else
    for (const item of raw.split(',')) {
      const k = /^\s*(\d+)\*/.exec(item)
      n += k ? Number(k[1]) : 1
    }
  return n === columns ? null : { code: 'width-count', params: { cols: String(n), table: String(columns) } }
}

// ---------------------------------------------------------------- the layer

/** A place in a table, as the editor keeps it (the layer only passes it back). */
export interface GripPlace {
  readonly view: TableView
  readonly ref: unknown
}

/** The lines of a table that are selected: columns or rows, from the first to the last (the grown range). */
export interface LineRange {
  readonly kind: 'col' | 'row'
  readonly from: number
  readonly to: number
}

export interface GripHost {
  readonly dom: HTMLElement
  /** The element that scrolls the editor: the layer is clipped to it. */
  scroller(): HTMLElement
  /** The table of the element `.tbl` (by its first cell). */
  place(tbl: HTMLElement): GripPlace | null
  /** The table that has columns or rows selected, or null. */
  selectedTable(): HTMLElement | null
  /** The lines of this table that are selected, or null. */
  lines(place: GripPlace): LineRange | null
  /** The line a Shift-click goes on from (the first one clicked), when `kind` lines of this table are selected. */
  anchor(place: GripPlace, kind: 'col' | 'row'): number | null
  /** Selects the lines `anchor`…`head`. */
  select(place: GripPlace, kind: 'col' | 'row', anchor: number, head: number): void
  /** Writes the widths (whole percents); false when it was refused (the editor told why). */
  write(place: GripPlace, widths: readonly number[]): boolean
  /** The table the cursor is in (a touch screen has no mouse to find it by). */
  cursorTable(): HTMLElement | null
  /** a line is added before or after the line `line` of the table. False when it was refused (the editor told why). */
  insert(place: GripPlace, kind: LineKind, line: number, where: 'before' | 'after'): boolean
  /** The lines are deleted in one step; false when it was refused (the editor told why). */
  remove(place: GripPlace, range: LineRange): boolean
  /** What the button `act` of the bar of these lines is refused for beforehand (the text is the one of the refusal), or null. */
  refusal(place: GripPlace, kind: LineKind, act: LineAct, range: LineRange): { code: string; text: string } | null
  /** The focus goes back to the text of the editor. */
  focus(): void
  /** The focus leaves the grips for the text: to the first cell of the table (`cell`), or where the cursor was; the selected lines are let go. */
  leave(place: GripPlace, cell: boolean): void
}

export interface Geo {
  frame: DOMRect
  inner: { left: number; right: number; top: number; bottom: number }
  xs: number[]
  rows: { top: number; bottom: number }[]
  band: number
}

interface Drag {
  tbl: HTMLElement
  place: GripPlace
  i: number
  startX: number
  total: number
  left0: number
  p: number[]
  cols: HTMLElement[]
  saved: (string | null)[]
  moved: boolean
  last: Dragged | null
  start: readonly number[]
  min: number
  /** How far the table is wider than its frame, in percent of the table (0 when it is not). */
  slack: number
  /** The style of the `<table>` before the drag (the drag fixes its layout in pixels). */
  tableStyle: string | null
  table: HTMLElement | null
  border: HTMLElement
  tag: HTMLElement
}

const NS = 'nota-grips'

/** the visible stroke of a grip is this share of its column or row, in the middle. */
export const GRIP_SHARE = 0.7
/** The shortest visible stroke, px (a low row, a nested table). */
export const GRIP_MIN = 24

/** The length of the visible stroke: a share of the line (a column or a row), not shorter than the minimum, not longer than the strip it stands in. */
export function gripLength(line: number, strip: number): number {
  return Math.min(strip, Math.max(GRIP_MIN, Math.round(GRIP_SHARE * line)))
}

function name(pattern: string, n: number): string {
  return pattern.split('{n}').join(String(n))
}

const box = (r: DOMRect): Box => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom })

export class TableGrips {
  private readonly root: HTMLElement
  private hot: HTMLElement | null = null
  private touch = false
  private frame = 0
  private pointer: { x: number; y: number } | null = null
  private drag: Drag | null = null
  private destroyed = false
  private readonly doc: Document
  private readonly win: Window
  private tick = 0
  private timer = 0
  private refreshTimer = 0
  private ox = 0
  private oy = 0
  /** the bar of three buttons at a grip, the table whose grips have the keyboard focus, the grips of the last picture. */
  private readonly bar: TableLineBar
  private kbd: HTMLElement | null = null
  private pending: { n: number; kind: LineKind; i: number } | null = null
  private rendering = false
  /** the strips of the layer by table, kind and number, the ones the picture in hand wants, the style of each as it was written, the tables of the last picture. */
  private readonly nodes = new Map<string, HTMLElement>()
  private used = new Set<string>()
  private readonly css = new WeakMap<HTMLElement, string>()
  private tables: HTMLElement[] = []
  private anchors: Anchor[] = []
  private bounds: Box = { left: 0, top: 0, right: 0, bottom: 0 }

  constructor(private readonly host: GripHost) {
    this.doc = host.dom.ownerDocument
    this.win = this.doc.defaultView!
    this.root = this.doc.createElement('div')
    this.root.className = NS
    this.root.setAttribute('contenteditable', 'false')
    host.dom.parentElement?.appendChild(this.root)
    this.bar = new TableLineBar(host, this.doc, {
      pointer: () => this.pointer,
      // (from a timer: at once, a window without frames would not draw the next frame)
      // (the bar comes up over the grips of the last picture; the strips are not drawn again for it)
      refresh: () => this.bar.update(this.anchors, { ox: this.ox, oy: this.oy, bounds: this.bounds }),
      labels: () => getLabels() as unknown as Record<string, string>,
      focusGrip: (n, kind, i) => this.focusGrip(n, kind, i),
      ownTip: (on) => this.root.classList.toggle('gtip-own', on),
      strips: () => Array.from(this.root.querySelectorAll<HTMLElement>('.cg, .rg, .bd')).map((e) => box(e.getBoundingClientRect())),
    })
    this.root.appendChild(this.bar.el)
    this.root.addEventListener('mousedown', this.onDown)
    this.root.addEventListener('keydown', this.onGripKey)
    this.root.addEventListener('focusout', this.onFocusOut)
    this.root.addEventListener('wheel', this.onWheel, { passive: false })
    this.doc.addEventListener('mousemove', this.onMove)
    this.doc.addEventListener('mouseout', this.onOut)
    this.doc.addEventListener('pointerdown', this.onPointer, true)
    this.doc.addEventListener('scroll', this.onScroll, true)
    this.doc.addEventListener('keydown', this.onKey, true)
    this.win.addEventListener('resize', this.onScroll)
  }

  destroy(): void {
    this.destroyed = true
    this.cancel()
    this.doc.removeEventListener('mousemove', this.onMove)
    this.doc.removeEventListener('mouseout', this.onOut)
    this.doc.removeEventListener('pointerdown', this.onPointer, true)
    this.doc.removeEventListener('scroll', this.onScroll, true)
    this.doc.removeEventListener('keydown', this.onKey, true)
    this.win.removeEventListener('resize', this.onScroll)
    this.doc.removeEventListener('mousemove', this.onDragMove)
    this.doc.removeEventListener('mouseup', this.onDragEnd)
    this.bar.destroy()
    this.root.remove()
    if (this.frame) this.win.cancelAnimationFrame(this.frame)
    this.win.clearTimeout(this.refreshTimer)
    if (this.tick) this.win.cancelAnimationFrame(this.tick)
    this.win.clearTimeout(this.timer)
  }

  /** The state of the editor or the page changed: draws the layer again at the next frame. */
  refresh(): void {
    if (this.destroyed || this.drag || this.frame) return
    // (a frame, or a timer if the window is hidden or without focus and frames are not drawn: else the strips stay where a scroll or a layout left them)
    const run = (): void => {
      if (!this.frame) return
      this.win.cancelAnimationFrame(this.frame)
      this.win.clearTimeout(this.refreshTimer)
      this.frame = 0
      this.render()
    }
    this.frame = this.win.requestAnimationFrame(run)
    this.refreshTimer = this.win.setTimeout(run, 100)
  }

  /** The widths of a drag are in the page, not yet in the file. */
  get dragging(): boolean {
    return this.drag !== null
  }

  // ---------------------------------------------------------------- the mouse

  private readonly onPointer = (event: PointerEvent): void => {
    this.touch = event.pointerType === 'touch'
    if (this.touch) this.refresh()
  }

  private readonly onScroll = (): void => this.refresh()

  private readonly onOut = (event: MouseEvent): void => {
    if (!event.relatedTarget && !this.drag) {
      this.pointer = null
      this.setHot(null)
    }
  }

  private readonly onMove = (event: MouseEvent): void => {
    if (this.drag || event.buttons !== 0) return
    this.touch = false
    this.pointer = { x: event.clientX, y: event.clientY }
    // (the bar follows the mouse in the same frame as the grip under it lights up)
    if (this.anchors.length > 0 || this.bar.rect()) this.bar.update(this.anchors, { ox: this.ox, oy: this.oy, bounds: this.bounds })
    if (this.tick) return
    // (a frame, or a timer if the window is hidden or without focus and frames are not drawn)
    const run = (): void => {
      if (!this.tick) return
      this.win.cancelAnimationFrame(this.tick)
      this.win.clearTimeout(this.timer)
      this.tick = 0
      const p = this.pointer
      // (the pointer on the bar of the table: the table stays under the mouse, though the bar is above its band)
      if (p && !this.destroyed && !this.drag && !this.bar.holds(p.x, p.y)) this.setHot(this.tableAt(p.x, p.y))
      this.bar.update(this.anchors, { ox: this.ox, oy: this.oy, bounds: this.bounds })
    }
    this.tick = this.win.requestAnimationFrame(run)
    this.timer = this.win.setTimeout(run, 60)
  }

  private setHot(tbl: HTMLElement | null): void {
    if (tbl === this.hot) return
    this.hot = tbl
    this.render()
  }

  /** The innermost table whose frame, or the band over it and at its left, holds the point. */
  private tableAt(x: number, y: number): HTMLElement | null {
    const dom = this.host.dom
    const box = dom.getBoundingClientRect()
    if (box.width > 0 && (x < box.left - 24 || x > box.right + 24 || y < box.top - 24 || y > box.bottom + 24)) return null
    let found: HTMLElement | null = null
    for (const tbl of Array.from(dom.querySelectorAll<HTMLElement>('.tbl'))) {
      const f = this.frameOf(tbl)
      if (!f || f.width === 0) continue
      const band = this.bandOf(tbl)
      if (x >= f.left - band && x <= f.right && y >= f.top - band && y <= f.bottom) found = tbl
    }
    return found
  }

  private frameOf(tbl: HTMLElement): DOMRect | null {
    const f = tbl.querySelector(':scope > .tbl-scroll')
    return f ? f.getBoundingClientRect() : null
  }

  private bandOf(tbl: HTMLElement): number {
    return tbl.parentElement?.closest('.tbl') ? 8 : 10
  }

  // ---------------------------------------------------------------- the picture

  /** Where the lines of the table are on the screen. */
  private geometry(tbl: HTMLElement, view: TableView): Geo | null {
    const sc = tbl.querySelector<HTMLElement>(':scope > .tbl-scroll')
    const table = sc?.querySelector(':scope > table')
    if (!sc || !table) return null
    const frame = sc.getBoundingClientRect()
    if (frame.width === 0) return null
    const trs = Array.from(table.querySelectorAll(':scope > tbody > tr'))
    const xs: number[] = []
    const rows: { top: number; bottom: number }[] = []
    trs.forEach((tr, r) => {
      const q = tr.getBoundingClientRect()
      rows[r] = { top: q.top, bottom: q.bottom }
      const cells = Array.from(tr.children)
      const model = view.rows[r] ?? []
      cells.forEach((el, k) => {
        const c = model[k]
        if (!c) return
        const b = el.getBoundingClientRect()
        if (xs[c.column] === undefined) xs[c.column] = b.left
        if (xs[c.column + c.colspan] === undefined) xs[c.column + c.colspan] = b.right
      })
    })
    for (let c = 0; c <= view.ncols; c++) if (xs[c] === undefined || (c > 0 && xs[c]! < xs[c - 1]!)) return null
    if (rows.length !== view.nrows || rows.some((r) => r === undefined)) return null
    // (the frame has a border of 1 px)
    return {
      frame,
      inner: { left: frame.left + 1, right: frame.right - 1, top: frame.top + 1, bottom: frame.bottom - 1 },
      xs,
      rows,
      band: this.bandOf(tbl),
    }
  }

  private shown(): HTMLElement[] {
    const hot = this.hot ?? (this.touch ? this.host.cursorTable() : null)
    const sel = this.host.selectedTable()
    const kbd = this.kbd?.isConnected ? this.kbd : null
    return [hot, sel && sel !== hot ? sel : null, kbd && kbd !== hot && kbd !== sel ? kbd : null].filter((t): t is HTMLElement => t !== null)
  }

  render(): void {
    if (this.destroyed) return
    if (this.drag) return
    const root = this.root
    // (the table the mouse is over was drawn again: the mouse is over the new one)
    if (this.hot && !this.hot.isConnected) this.hot = this.pointer ? this.tableAt(this.pointer.x, this.pointer.y) : null
    // (the grip that has the focus is drawn again, so the focus is put back on the new one)
    const was = this.doc.activeElement as HTMLElement | null
    const keep =
      this.pending ?? (was && root.contains(was) && was.dataset.kind ? { n: Number(was.dataset.t), kind: was.dataset.kind as LineKind, i: Number(was.dataset.i) } : null)
    this.pending = null
    this.rendering = true
    // (a strip that is still wanted stays the same node: under a motionless pointer a new node would get `:hover` late and its stroke would grow again from the start)
    this.used = new Set()
    const sc = this.host.scroller().getBoundingClientRect()
    // (a container with `container-type` is the block of `position: fixed`: the layer's own corner is the origin)
    const o = root.getBoundingClientRect()
    this.ox = o.left
    this.oy = o.top
    const vw = o.width || this.win.innerWidth
    const vh = o.height || this.win.innerHeight
    root.style.clipPath = `inset(${Math.max(0, sc.top - this.oy)}px ${Math.max(0, vw - (sc.right - this.ox))}px ${Math.max(0, vh - (sc.bottom - this.oy))}px ${Math.max(0, sc.left - this.ox)}px)`
    const hot = this.hot ?? (this.touch ? this.host.cursorTable() : null)
    const tables = Array.from(this.host.dom.querySelectorAll<HTMLElement>('.tbl'))
    this.tables = tables
    const anchors: Anchor[] = []
    for (const tbl of this.shown()) {
      const place = this.host.place(tbl)
      if (!place) continue
      const sel = this.host.lines(place)
      const open = tbl === hot || tbl === this.kbd
      if (!open && !sel) continue
      const g = this.geometry(tbl, place.view)
      if (!g) continue
      const on = (kind: 'col' | 'row', i: number): boolean => !!sel && sel.kind === kind && i >= sel.from && i <= sel.to
      const labels = getLabels()
      const lone = !open
      const n = tables.indexOf(tbl)
      for (let c = 0; c < place.view.ncols; c++) {
        if (lone && !on('col', c)) continue
        const left = Math.max(g.xs[c]!, g.inner.left)
        const right = Math.min(g.xs[c + 1]!, g.inner.right)
        if (right <= left) continue
        const el = this.strip(n, 'cg', c, name(labels.gripColumn, c + 1), left, g.frame.top - g.band, right - left, g.band, gripLength(g.xs[c + 1]! - g.xs[c]!, right - left))
        el.classList.toggle('on', on('col', c))
        this.mark(el, anchors, tbl, tables, g, sel, 'col', c, left, g.frame.top - g.band, right - left, g.band)
      }
      for (let r = 0; r < place.view.nrows; r++) {
        if (lone && !on('row', r)) continue
        const row = g.rows[r]!
        const h = Math.max(8, row.bottom - row.top)
        const el = this.strip(n, 'rg', r, name(labels.gripRow, r + 1), g.frame.left - g.band, row.top, g.band, h, gripLength(row.bottom - row.top, h))
        el.classList.toggle('on', on('row', r))
        this.mark(el, anchors, tbl, tables, g, sel, 'row', r, g.frame.left - g.band, row.top, g.band, h)
      }
      if (lone) continue
      // (the last column has a border of its own at the right edge of the table, `i` = the number of columns)
      for (let i = 1; i <= place.view.ncols; i++) {
        // (the frame scrolls by whole pixels, and a table of 2549.09 px ends up to a pixel and a half past the end of the scroll: the right edge of the table at the end of the scroll still has its strip)
        const x = Math.min(g.xs[i]!, g.inner.right)
        if (x < g.inner.left - 1 || g.xs[i]! > g.inner.right + 2) continue
        const el = this.strip(n, 'bd', i, labels.gripBorder, x - 5, g.inner.top, 10, g.inner.bottom - g.inner.top)
        el.dataset.border = String(i)
      }
    }
    for (const [key, el] of this.nodes) {
      if (this.used.has(key)) continue
      el.remove()
      this.nodes.delete(key)
    }
    this.rendering = false
    this.anchors = anchors
    this.bounds = this.visible(sc)
    if (keep) {
      const el = root.querySelector<HTMLElement>(`[data-t="${keep.n}"][data-kind="${keep.kind}"][data-i="${keep.i}"]`)
      if (el && this.doc.activeElement !== el) el.focus({ preventScroll: true })
    }
    this.bar.update(anchors, { ox: this.ox, oy: this.oy, bounds: this.bounds })
  }

  /** What of the editor is on the screen: its scroller, cut by the window. */
  private visible(sc: DOMRect): Box {
    const w = this.win.innerWidth || sc.right
    const h = this.win.innerHeight || sc.bottom
    // (a scroller without a size, as in a test without layout, is the window)
    if (sc.width === 0 && sc.height === 0) return { left: 0, top: 0, right: w, bottom: h }
    return { left: Math.max(sc.left, 0), top: Math.max(sc.top, 0), right: Math.min(sc.right, w), bottom: Math.min(sc.bottom, h) }
  }

  /** A grip of a column or a row: what the keyboard and the bar need to know of it. */
  private mark(el: HTMLElement, anchors: Anchor[], tbl: HTMLElement, tables: HTMLElement[], g: Geo, sel: LineRange | null, kind: LineKind, i: number, left: number, top: number, w: number, h: number): void {
    const n = tables.indexOf(tbl)
    el.setAttribute('role', 'button')
    el.tabIndex = -1
    el.dataset.t = String(n)
    el.dataset.kind = kind
    el.dataset.i = String(i)
    const own = sel && sel.kind === kind ? { from: sel.from, to: sel.to } : null
    anchors.push({
      tbl,
      n,
      kind,
      i,
      strip: { left, top, right: left + w, bottom: top + h },
      sel: own,
      xs: g.xs,
      rows: g.rows.map((r) => ({ left: g.frame.left, right: g.frame.right, top: r.top, bottom: r.bottom })),
      frame: box(g.frame),
      inner: g.inner,
      total: kind === 'col' ? g.xs.length - 1 : g.rows.length,
    })
  }

  /** A strip of the layer. `line` is the length of the visible stroke, written as `--gl`; the border handles `bd` have none. */
  private strip(n: number, cls: string, i: number, label: string, left: number, top: number, width: number, height: number, line?: number): HTMLElement {
    // (the node of the strip is the same while the table, the kind and the number are: it only moves)
    const key = `${n}:${cls}:${i}`
    this.used.add(key)
    let el = this.nodes.get(key)
    if (!el) {
      el = this.doc.createElement('div')
      el.className = cls
      el.dataset.gt = String(n)
      el.dataset.gi = String(i)
      this.root.appendChild(el)
      this.nodes.set(key, el)
    }
    // (no strip has a system title: the meaning is in aria-label)
    if (el.getAttribute('aria-label') !== label) el.setAttribute('aria-label', label)
    const css = `left:${left - this.ox}px;top:${top - this.oy}px;width:${width}px;height:${height}px${line === undefined ? '' : `;--gl:${line}px`}`
    if (this.css.get(el) !== css) {
      el.style.cssText = css
      this.css.set(el, css)
    }
    return el
  }

  // ---------------------------------------------------------------- the keyboard

  /** The focus goes to the grip `i` of the table (a column or a row); the table shows its grips as long as the focus stays. */
  focusLine(tbl: HTMLElement, kind: LineKind, i: number): void {
    const n = Array.from(this.host.dom.querySelectorAll<HTMLElement>('.tbl')).indexOf(tbl)
    if (n < 0) return
    this.focusGrip(n, kind, i)
  }

  focusGrip(n: number, kind: LineKind, i: number): void {
    const tbl = Array.from(this.host.dom.querySelectorAll<HTMLElement>('.tbl'))[n]
    if (!tbl) return
    this.kbd = tbl
    this.pending = { n, kind, i }
    this.render()
  }

  private readonly onFocusOut = (event: FocusEvent): void => {
    const to = event.relatedTarget as Node | null
    if (this.rendering || this.destroyed || (to && this.root.contains(to))) return
    // (the focus left the grips for something else: the table is not shown for the focus any more)
    if (this.kbd) {
      this.kbd = null
      this.refresh()
    }
  }

  private readonly onGripKey = (event: KeyboardEvent): void => {
    const el = (event.target as Element | null)?.closest<HTMLElement>('.cg, .rg')
    if (!el || event.altKey || event.ctrlKey || event.metaKey) return
    const kind = el.dataset.kind as LineKind
    const i = Number(el.dataset.i)
    const n = Number(el.dataset.t)
    const tbl = Array.from(this.host.dom.querySelectorAll<HTMLElement>('.tbl'))[n]
    const place = tbl ? this.host.place(tbl) : null
    if (!tbl || !place) return
    const key = event.key
    const stop = (): void => {
      event.preventDefault()
      event.stopPropagation()
    }
    if (key === 'Enter' || key === ' ') {
      stop()
      const sel = this.host.lines(place)
      const inside = sel && sel.kind === kind && i >= sel.from && i <= sel.to
      if (!inside) this.host.select(place, kind, i, i)
      this.focusGrip(n, kind, i)
      const now = this.host.lines(place)
      const a = this.anchors.find((x) => x.n === n && x.kind === kind && x.i === i)
      if (a) this.bar.open(a, now && now.kind === kind ? now.from : i, now && now.kind === kind ? now.to : i)
      return
    }
    if (key === 'Escape') {
      stop()
      this.kbd = null
      this.host.leave(place, false)
      this.refresh()
      return
    }
    if (key === 'Tab' && !event.shiftKey) {
      stop()
      this.kbd = null
      this.host.leave(place, true)
      this.refresh()
      return
    }
    const count = kind === 'col' ? place.view.ncols : place.view.nrows
    const delta = kind === 'col' ? { ArrowRight: 1, ArrowLeft: -1 }[key as 'ArrowRight'] : { ArrowDown: 1, ArrowUp: -1 }[key as 'ArrowDown']
    if (delta !== undefined) {
      stop()
      const to = i + delta
      if (to < 0) {
        // (up from the first row is the first column)
        if (kind === 'row') this.focusGrip(n, 'col', 0)
        return
      }
      if (to >= count) return
      if (event.shiftKey) {
        const anchor = this.host.anchor(place, kind) ?? i
        this.host.select(place, kind, anchor, to)
      }
      this.focusGrip(n, kind, to)
      return
    }
    if (kind === 'col' && key === 'ArrowDown') {
      stop()
      this.focusGrip(n, 'row', 0)
    }
  }

  // ---------------------------------------------------------------- the grips

  /** The button goes down on a strip: the table and the number are in the node (it stays while they are the same). */
  private readonly onDown = (event: MouseEvent): void => {
    const el = (event.target as Element | null)?.closest<HTMLElement>('.cg, .rg, .bd')
    if (!el || !this.root.contains(el)) return
    const tbl = this.tables[Number(el.dataset.gt)]
    if (!tbl) return
    if (el.classList.contains('bd')) this.onBorder(event, el, tbl, Number(el.dataset.border))
    else this.onGrip(event, tbl, el.classList.contains('cg') ? 'col' : 'row', Number(el.dataset.gi))
  }

  private onGrip(event: MouseEvent, tbl: HTMLElement, kind: 'col' | 'row', i: number): void {
    if (event.button > 0) return
    event.preventDefault()
    event.stopPropagation()
    const place = this.host.place(tbl)
    if (!place) return
    const anchor = event.shiftKey ? this.host.anchor(place, kind) : null
    this.host.select(place, kind, anchor ?? i, i)
    this.render()
  }

  // ---------------------------------------------------------------- the borders

  /** The wheel over any strip of the layer (it is not in the page, so the page would not see it): sideways goes to the frame of the table, up and down to the scroller of the editor, as without the layer. */
  private onWheel = (event: WheelEvent): void => {
    const target = event.target as Element | null
    if (!target?.closest?.('.cg, .rg, .bd') || event.ctrlKey) return
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? this.host.scroller().clientHeight || this.win.innerHeight : 1
    let dx = event.deltaX * (event.deltaMode === 2 ? this.win.innerWidth : unit)
    let dy = event.deltaY * unit
    if (event.shiftKey && !dx) [dx, dy] = [dy, 0]
    const tbl = this.hot ?? this.host.selectedTable()
    const sc = tbl?.querySelector<HTMLElement>(':scope > .tbl-scroll')
    let moved = false
    if (sc && dx) {
      const before = sc.scrollLeft
      sc.scrollLeft = before + dx
      moved = sc.scrollLeft !== before
    }
    if (dy) {
      const page = this.host.scroller()
      const before = page.scrollTop
      page.scrollTop = before + dy
      moved = moved || page.scrollTop !== before
    }
    if (moved) event.preventDefault()
  }

  private onBorder(event: MouseEvent, el: HTMLElement, tbl: HTMLElement, i: number): void {
    if (event.button > 0) return
    event.preventDefault()
    event.stopPropagation()
    const place = this.host.place(tbl)
    if (!place) return
    const g = this.geometry(tbl, place.view)
    if (!g) return
    const total = g.xs[place.view.ncols]! - g.xs[0]!
    if (total <= 0) return
    const p = place.view.widths.map((_, c) => (100 * (g.xs[c + 1]! - g.xs[c]!)) / total)
    // (the right edge of the last column has no pair, a double click does nothing there)
    if (event.detail >= 2 && i >= place.view.ncols) return
    if (event.detail >= 2) {
      const even = evenBorder(p, i)
      // (the width of a table that was dragged wider than its frame goes over to the widths of the double click)
      const grown = tbl.querySelector<HTMLElement>(':scope > .tbl-scroll > table')
      const kept = Number(grown?.dataset.keepWidth) || 0
      if (grown && kept > 0) {
        const key = JSON.stringify(even)
        const map = readKept(grown)
        delete map[key]
        grown.dataset.keepMap = JSON.stringify({ ...Object.fromEntries(Object.entries(map).slice(-7)), [key]: kept })
      }
      this.host.write(place, even)
      this.render()
      return
    }
    const cols = Array.from(tbl.querySelectorAll<HTMLElement>(':scope > .tbl-scroll > table > colgroup > col'))
    const border = el
    const tag = this.doc.createElement('div')
    tag.className = 'wtag'
    tag.hidden = true
    this.root.appendChild(tag)
    border.classList.add('live')
    const min = minPercent(total)
    const table = tbl.querySelector<HTMLElement>(':scope > .tbl-scroll > table')
    this.drag = {
      tbl,
      place,
      i,
      startX: event.clientX,
      total,
      left0: g.xs[0]!,
      p,
      cols,
      saved: cols.map((c) => c.getAttribute('style')),
      moved: false,
      last: null,
      start: dragBorder(p, i, 0, min).widths,
      min,
      slack: this.slack(tbl, total, i >= place.view.ncols),
      tableStyle: table?.getAttribute('style') ?? null,
      table,
      border,
      tag,
    }
    this.host.dom.classList.add('col-drag')
    this.doc.addEventListener('mousemove', this.onDragMove)
    this.doc.addEventListener('mouseup', this.onDragEnd)
  }

  private readonly onDragMove = (event: MouseEvent): void => {
    const d = this.drag
    if (!d) return
    if (event.buttons === 0) {
      this.cancel()
      return
    }
    if (!d.moved && Math.abs(event.clientX - d.startX) < 3) return
    if (!d.moved) this.relayout(d)
    d.moved = true
    const dx = event.clientX - d.startX
    event.preventDefault()
    const r = dragBorder(d.p, d.i, (100 * dx) / d.total, d.min, d.slack)
    d.last = r
    // (the layout of the drag is in pixels: the columns as they were on the screen, the table as wide as they are together)
    const px = r.live.map((w) => (w * d.total) / 100)
    if (d.cols.length === px.length) {
      d.cols.forEach((c, k) => (c.style.width = `${px[k]}px`))
      if (d.table) d.table.style.width = `${px.reduce((s, w) => s + w, 0)}px`
    }
    const first = d.tbl.querySelector(':scope > .tbl-scroll > table > tbody > tr > :is(td, th)')
    const left0 = first ? first.getBoundingClientRect().left : d.left0
    const edge = left0 + px.slice(0, d.i).reduce((s, w) => s + w, 0)
    d.border.style.left = `${edge - 5 - this.ox}px`
    const frame = this.frameOf(d.tbl)
    d.tag.hidden = false
    d.tag.classList.toggle('limit', r.limit || r.frame)
    d.border.classList.toggle('limit', r.limit || r.frame)
    // (at the stop only the words: the percents of a column that stands still say nothing; the stop at the edge of the frame has its own words)
    d.tag.textContent = r.limit ? getLabels().widthLimit : r.frame ? getLabels().widthFrame : `${r.widths[d.i - 1]}%`
    d.tag.style.left = `${edge - this.ox}px`
    d.tag.style.top = `${(frame?.top ?? 0) - this.bandOf(d.tbl) - 26 - this.oy}px`
  }

  /**
   * How far the table may narrow while the border goes to the left, in percent of the table: as far as it is wider than its frame, and no
   * further than the frame is scrolled (a narrower table would clamp the scroll, and the table, not the mouse, would carry the border away).
   * A frame without a width, as in a test without layout, gives 0.
   */
  private slack(tbl: HTMLElement, total: number, edge = false): number {
    const frame = tbl.querySelector<HTMLElement>(':scope > .tbl-scroll')
    const cw = frame?.clientWidth ?? 0
    // (the right edge of the table is at the end of the scroll, and the frame scrolls back by itself while the table narrows: no limit by the scroll)
    const room = total - cw - (edge ? 0 : (frame?.scrollLeft ?? 0))
    return cw > 0 && room > 1.5 ? (100 * room) / total : 0
  }

  /**
   * At the first real move the layout is fixed as it is on the screen (the widths of the columns in pixels, the table as wide as they are), and
   * only then the head wraps: the wrap of the head does not move the table under the mouse (and does not scroll its frame back).
   */
  private relayout(d: Drag): void {
    const g = this.geometry(d.tbl, d.place.view)
    if (g) {
      const total = g.xs[d.place.view.ncols]! - g.xs[0]!
      if (total > 0) {
        d.total = total
        d.left0 = g.xs[0]!
        d.p = d.place.view.widths.map((_, c) => (100 * (g.xs[c + 1]! - g.xs[c]!)) / total)
        d.min = minPercent(total)
        d.slack = this.slack(d.tbl, total, d.i >= d.place.view.ncols)
        d.start = dragBorder(d.p, d.i, 0, d.min).widths
        if (d.table && d.cols.length === d.p.length) {
          d.cols.forEach((c, k) => (c.style.width = `${(d.p[k]! * total) / 100}px`))
          d.table.style.width = `${total}px`
          d.table.style.minWidth = '0'
          d.table.style.tableLayout = 'fixed'
        }
      }
    }
    d.tbl.classList.add('tbl-drag')
  }

  private readonly onDragEnd = (): void => {
    const d = this.drag
    if (!d) return
    const r = d.last
    const table = d.table
    const frameWidth = d.tbl.querySelector<HTMLElement>(':scope > .tbl-scroll')?.clientWidth ?? 0
    const dragged = r ? r.live.reduce((s, w) => s + (w * d.total) / 100, 0) : 0
    this.finish(d)
    if (d.moved && r && r.widths.some((w, k) => w !== d.start[k])) {
      // (a table that was dragged wider than its frame stays as wide as at the last step, bound to the widths written;
      // the border stays where the mouse left it)
      const keep = table && frameWidth > 0 && dragged > frameWidth + 1.5 ? table : null
      const before = keep ? { min: keep.style.minWidth, kept: keep.dataset.keepWidth, map: keep.dataset.keepMap } : null
      if (keep) {
        const map = readKept(keep)
        const key = JSON.stringify(r.widths)
        delete map[key]
        const rest = Object.entries(map).slice(-7)
        keep.dataset.keepMap = JSON.stringify({ ...Object.fromEntries(rest), [key]: Math.ceil(dragged) })
        keep.dataset.keepWidth = String(Math.ceil(dragged))
        // (at once, before anything is laid out: a moment of the narrow table would clamp the scroll of the frame)
        keep.style.minWidth = `${Math.ceil(dragged)}px`
      }
      // (a refused write leaves the table as it was)
      if (!this.host.write(d.place, r.widths) && keep && before) {
        if (before.kept === undefined) delete keep.dataset.keepWidth
        else keep.dataset.keepWidth = before.kept
        if (before.map === undefined) delete keep.dataset.keepMap
        else keep.dataset.keepMap = before.map
        keep.style.minWidth = before.min
      }
    }
    this.render()
  }

  /** Esc during a drag, or the button let go outside: the widths are as they were. */
  cancel(): void {
    const d = this.drag
    if (!d) return
    this.finish(d)
    this.render()
  }

  private finish(d: Drag): void {
    this.drag = null
    d.cols.forEach((c, k) => (d.saved[k] === null ? c.removeAttribute('style') : c.setAttribute('style', d.saved[k]!)))
    if (d.table) {
      if (d.tableStyle === null) d.table.removeAttribute('style')
      else d.table.setAttribute('style', d.tableStyle)
    }
    d.tbl.classList.remove('tbl-drag')
    this.host.dom.classList.remove('col-drag')
    this.doc.removeEventListener('mousemove', this.onDragMove)
    this.doc.removeEventListener('mouseup', this.onDragEnd)
    d.tag.remove()
    // (the node of the border stays after the drag, so what the drag put on it goes)
    d.border.classList.remove('live', 'limit')
    // (the drag wrote its left straight on the node, past the cache of styles: the next draw writes it again)
    this.css.delete(d.border)
  }

  private readonly onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && this.drag) {
      event.preventDefault()
      event.stopPropagation()
      this.cancel()
    }
  }
}
