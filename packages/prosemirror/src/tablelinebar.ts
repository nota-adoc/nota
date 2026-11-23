/**
 * the three buttons at a grip of a table (add on one side, add on the other, delete): which of them are refused beforehand, and — in
 * the second part — where the bar and the hints of its buttons stand.
 */
import type { TableView } from '@nota-adoc/core/internal'
import { type GripHost, widthRefusal } from './tablegrips.js'

export type LineKind = 'col' | 'row'
/** The three buttons of a bar: the line is added before (left, above) the range, after it (right, below), or the range is deleted. */
export type LineAct = 'before' | 'after' | 'delete'

export interface Refusal {
  readonly code: string
  readonly message: string
  readonly params: Readonly<Record<string, string>>
}

const MESSAGES: Record<string, string> = {
  'last-row': 'The last row of the table stays. To remove the table, press «Delete table»',
  'last-column': 'The last column of the table stays. To remove the table, press «Delete table»',
  'row-above-head': 'A row cannot be added above the head: it would become the head. Add the row below',
  'row-below-foot': 'A row cannot be added below the footer: it would become the footer. Add the row above',
  'cols-attr': 'A column cannot be added or deleted: the number of columns is set by the attribute {attr}. Edit the table in Text mode. The file is not changed',
  'cols-count': 'A column cannot be added or deleted: cols says {cols} columns, the table has {table}. Fix cols in Text mode. The file is not changed',
}

function refusal(code: string, params: Record<string, string> = {}): Refusal {
  return { code, message: MESSAGES[code]!, params }
}

/** What is refused beforehand, from the shape of the table alone (a button that is dimmed); null when the action may be tried. */
export function lineRefusal(v: TableView, kind: LineKind, act: LineAct, from: number, to: number): Refusal | null {
  const rows = kind === 'row'
  if (act === 'delete') return to - from + 1 >= (rows ? v.nrows : v.ncols) ? refusal(rows ? 'last-row' : 'last-column') : null
  if (!rows) return null
  if (act === 'before' && from === 0 && v.headRows > 0) return refusal('row-above-head')
  if (act === 'after' && to >= v.nrows - 1 && v.footRows > 0) return refusal('row-below-foot')
  return null
}

/** A column cannot be added or deleted when `cols` of the table is not a list of its columns: from the text of its block. */
export function colsRefusal(src: string, ncols: number): Refusal | null {
  const why = widthRefusal(src, ncols)
  if (!why || why.code === 'width-autowidth') return null
  return refusal(why.code === 'width-attr' ? 'cols-attr' : 'cols-count', why.params)
}

// ---------------------------------------------------------------- where the bar and the hints stand

export interface Box {
  readonly left: number
  readonly top: number
  readonly right: number
  readonly bottom: number
}

const box = (left: number, top: number, w: number, h: number): Box => ({ left, top, right: left + w, bottom: top + h })
const overlaps = (a: Box, b: Box): boolean => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
const within = (a: Box, b: Box): boolean => a.left >= b.left - 0.5 && a.right <= b.right + 0.5 && a.top >= b.top - 0.5 && a.bottom <= b.bottom + 0.5
const hits = (b: Box, x: number, y: number, pad = 0): boolean => x >= b.left - pad && x <= b.right + pad && y >= b.top - pad && y <= b.bottom + pad
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v))

/** The icons are 22 px, the bar has 2 px around them and a rule of 1 px before the delete button. */
const ICON = 22
const PAD = 2
const LONG = 3 * ICON + 1 + 2 * PAD
const SHORT = ICON + 2 * PAD

/**
 * The bar of a column stands 2 px over its grip, centred on the visible part of the column (the span), and does not leave `bounds`;
 * the bar of a row stands at the left of its grip (4 px from it, or next to it where the margin is narrow), centred on the visible part of the row.
 * Null when it would lie under a capsule of the tab or outside `bounds`.
 */
export function placeBar(kind: LineKind, strip: Box, span: readonly [number, number], bounds: Box, isles: readonly Box[]): Box | null {
  let b: Box
  if (kind === 'col') {
    const left = clamp((span[0] + span[1]) / 2 - LONG / 2, bounds.left, Math.max(bounds.left, bounds.right - LONG))
    b = box(left, strip.top - 2 - SHORT, LONG, SHORT)
    const ok = (c: Box): boolean => within(c, bounds) && !isles.some((i) => overlaps(c, i))
    if (!ok(b)) {
      // (a capsule of the tab is over the grip: the bar stands beside it, right or left, as far as it still stands over a part of its column)
      const need = Math.min(ICON, span[1] - span[0])
      let best: Box | null = null
      for (const i of isles) {
        if (i.top >= b.bottom || i.bottom <= b.top) continue
        for (const x of [i.left - 2 - LONG, i.right + 2]) {
          const c = box(clamp(x, bounds.left, Math.max(bounds.left, bounds.right - LONG)), b.top, LONG, SHORT)
          if (!ok(c) || Math.min(c.right, span[1]) - Math.max(c.left, span[0]) < need) continue
          if (!best || Math.abs(c.left - b.left) < Math.abs(best.left - b.left)) best = c
        }
      }
      if (best) return best
    }
  } else {
    const gap = strip.left - SHORT - 4 >= bounds.left ? 4 : 0
    const top = clamp((span[0] + span[1]) / 2 - LONG / 2, bounds.top, Math.max(bounds.top, bounds.bottom - LONG))
    b = box(strip.left - SHORT - gap, top, SHORT, LONG)
    const ok = (c: Box): boolean => within(c, bounds) && !isles.some((i) => overlaps(c, i))
    if (!ok(b)) {
      // (a capsule of the tab, the strokes of the sections too, is beside the grip: the bar stands right of it, over or under it, as far as it still stands at a part of its row)
      const need = Math.min(ICON, span[1] - span[0])
      let best: Box | null = null
      for (const i of isles) {
        if (i.left >= b.right || i.right <= b.left) continue
        // (the last place, where the margin is too narrow for both: right of the grip, over the first cell of the row)
        const cands = [box(i.right + 2, b.top, SHORT, LONG), box(strip.right + 4, b.top, SHORT, LONG)]
        for (const y of [i.top - 2 - LONG, i.bottom + 2]) cands.push(box(b.left, clamp(y, bounds.top, Math.max(bounds.top, bounds.bottom - LONG)), SHORT, LONG))
        for (const c of cands) {
          if (!ok(c) || (c.right > strip.left && c.left < strip.right) || Math.min(c.bottom, span[1]) - Math.max(c.top, span[0]) < need) continue
          if (!best || Math.abs(c.left - b.left) + Math.abs(c.top - b.top) < Math.abs(best.left - b.left) + Math.abs(best.top - b.top)) best = c
        }
      }
      if (best) return best
    }
  }
  return within(b, bounds) && !isles.some((i) => overlaps(b, i)) ? b : null
}

/** What a hint says: the name of the button, and for a dimmed button the reason. */
export interface TipText {
  readonly name: string
  readonly reason: string | null
}

/** The size a hint takes in a width of at most `maxW` (a measure of the page; `estimate` stands for a page without layout). */
export type Measure = (text: TipText, short: 'card' | 'line' | 'reason', maxW: number) => { w: number; h: number }

export interface TipIn {
  readonly kind: LineKind
  readonly text: TipText
  readonly button: Box
  readonly bar: Box
  readonly strip: Box
  /** The visible part of the lines of the bar: x for columns, y for rows; and the rows or the columns of the table the lines are in. */
  readonly span: readonly [number, number]
  readonly frame: Box
  readonly bounds: Box
  readonly isles: readonly Box[]
  /** What a hint of this bar must not lie on: the grips of the table, the other bars. */
  readonly strips: readonly Box[]
  /** The cell of the outer table that a nested table stands in: the hint stays in it, outside its own table. */
  readonly outer: Box | null
  /** The top and the bottom of the rows (rows of the bar) that are visible: the hint of a row lies on one of them. */
  readonly rows: readonly Box[]
  readonly measure: Measure
}

export interface TipPlace {
  readonly box: Box
  readonly form: 'card' | 'line' | 'reason'
  /** The hint lies on the lines of its own bar (the borders between columns of the table are out of the way meanwhile). */
  readonly own: boolean
}

const TIP_W = 260

/**
 * The hint of a button. A column: over the bar; else beside it, between the capsule of the tab and the grips; else on its own column,
 * under the grips. A row: on its own row, from 4 px right of the frame. It does not lie on the cells of other lines, on the grips, on
 * its bar and on the capsules of the tab, and is always inside `bounds`. Null when there is no place at all.
 */
export function placeTip(i: TipIn): TipPlace | null {
  const limit: Box = i.outer
    ? {
        left: Math.max(i.bounds.left, i.outer.left),
        top: Math.max(i.bounds.top, i.outer.top),
        right: Math.min(i.bounds.right, i.outer.right),
        bottom: Math.min(i.bounds.bottom, i.outer.bottom),
      }
    : i.bounds
  const free = (b: Box, bar = true): boolean =>
    within(b, limit) && !i.isles.some((x) => overlaps(b, x)) && !i.strips.some((x) => overlaps(b, x)) && (!bar || !overlaps(b, i.bar))
  const forms: ('card' | 'line' | 'reason')[] = i.text.reason ? ['line', 'reason'] : ['line']
  const cy = (i.button.top + i.button.bottom) / 2
  const cx = (i.button.left + i.button.right) / 2
  if (i.kind === 'row') {
    // (the grips and the capsules are not in the way on the row itself, and a nested table's hint goes on right of it, inside the cell)
    const roomed = { left: i.frame.left + 4, right: (i.outer ? limit.right : i.bounds.right) - 2 }
    const rows = [...i.rows].sort((a, b) => Math.abs((a.top + a.bottom) / 2 - cy) - Math.abs((b.top + b.bottom) / 2 - cy))
    for (const form of forms)
      for (const row of rows) {
        const top = Math.max(row.top, i.bounds.top)
        const bottom = Math.min(row.bottom, i.bounds.bottom)
        const s = i.measure(i.text, form, roomed.right - roomed.left)
        if (s.w <= 0 || s.h > bottom - top + 0.5 || roomed.right - roomed.left < Math.min(s.w, 40)) continue
        const y = clamp(cy - s.h / 2, top, bottom - s.h)
        const b = box(roomed.left, y, Math.min(s.w, roomed.right - roomed.left), s.h)
        if (within(b, i.bounds) && !i.isles.some((x) => overlaps(b, x))) return { box: b, form, own: true }
      }
    return null
  }
  const card = (): Box | null => {
    const s = i.measure(i.text, 'card', Math.min(TIP_W, limit.right - limit.left))
    const b = box(clamp(cx - s.w / 2, limit.left, Math.max(limit.left, limit.right - s.w)), i.bar.top - 2 - s.h, s.w, s.h)
    return free(b) ? b : null
  }
  const above = card()
  if (above) return { box: above, form: 'card', own: false }
  // (beside the bar, right of it or left, as high as the bar: under the capsule of the tab, over the grips)
  for (const side of ['right', 'left'] as const) {
    const room = side === 'right' ? limit.right - i.bar.right - 4 : i.bar.left - 4 - limit.left
    if (room < 40) continue
    const s = i.measure(i.text, 'card', Math.min(TIP_W, room))
    const left = side === 'right' ? i.bar.right + 4 : i.bar.left - 4 - s.w
    const b = box(left, i.bar.bottom - s.h, s.w, s.h)
    if (free(b)) return { box: b, form: 'card', own: false }
  }
  // (on its own column, right under the grips)
  const left = Math.max(i.span[0], limit.left)
  const right = Math.min(i.span[1], limit.right)
  const top = Math.max(i.frame.top + 1, i.bounds.top)
  const bottom = Math.min(i.frame.bottom - 1, i.bounds.bottom)
  for (const form of forms) {
    const s = i.measure(i.text, form, right - left - 4)
    if (right - left < 12 || s.h > bottom - top + 0.5) continue
    const b = box(left + 2, top, Math.min(s.w, right - left - 4), s.h)
    if (within(b, i.bounds) && !i.isles.some((x) => overlaps(b, x))) return { box: b, form, own: true }
  }
  return null
}

// ---------------------------------------------------------------- the bar

/** One grip that was drawn: what the bar needs of it. */
export interface Anchor {
  readonly tbl: HTMLElement
  /** The number of the table among the tables of the editor, in the order of the page. */
  readonly n: number
  readonly kind: LineKind
  readonly i: number
  readonly strip: Box
  /** The lines of this table that are selected, or null. */
  readonly sel: { from: number; to: number } | null
  /** Where the lines of the table are on the screen: x of the columns, top and bottom of the rows, the frame. */
  readonly xs: readonly number[]
  readonly rows: readonly Box[]
  readonly frame: Box
  readonly inner: Box
  readonly total: number
}

export interface BarContext {
  /** The corner of the layer. */
  readonly ox: number
  readonly oy: number
  /** What of the editor is on the screen. */
  readonly bounds: Box
}

export type BarHost = Pick<GripHost, 'place' | 'insert' | 'remove' | 'refusal' | 'focus'>

interface Target {
  readonly key: string
  readonly a: Anchor
  readonly from: number
  readonly to: number
  readonly bySelection: boolean
}

const SVG: Record<'before-col' | 'after-col' | 'before-row' | 'after-row' | 'delete', string> = {
  'before-col': '<path d="M3 3v10M7 8h6M10 5v6" />',
  'after-col': '<path d="M13 3v10M9 8H3M6 5v6" />',
  'before-row': '<path d="M3 3h10M8 7v6M5 10h6" />',
  'after-row': '<path d="M3 13h10M8 9V3M5 6h6" />',
  delete: '<path d="M3.5 4.5h9M6.5 4.5v-1.5h3v1.5M5 4.5l.5 8h5l.5-8M7 7v3.5M9 7v3.5" />',
}

const SHOW_AFTER = 160
const HIDE_AFTER = 250
const FADE_OUT = 120
const TIP_AFTER = 300

export class TableLineBar {
  /** The layer of the bar and of the hint: a child of the layer of the grips that it does not clear. */
  readonly el: HTMLElement
  private readonly bar: HTMLElement
  private readonly tip: HTMLElement
  private readonly buttons: HTMLButtonElement[] = []
  private shown: Target | null = null
  private armed: string | null = null
  private quiet: Box | null = null
  private last: { anchors: readonly Anchor[]; ctx: BarContext } | null = null
  private box: Box | null = null
  private showTimer = 0
  private hideTimer = 0
  private fadeTimer = 0
  private tipTimer = 0
  private tipFor: HTMLButtonElement | null = null
  private keyboard = false
  /** The key of a bar that was closed with Esc: it does not come back for the selection that is still there. */
  private dismissed: string | null = null
  private visible = false

  constructor(
    private readonly host: BarHost,
    private readonly doc: Document,
    private readonly cb: {
      pointer(): { x: number; y: number } | null
      refresh(): void
      labels(): Record<string, string>
      /** Focuses the grip of a line (after a keyboard action); `own` tells the hint lies on its own lines. */
      focusGrip(n: number, kind: LineKind, i: number): void
      ownTip(on: boolean): void
      strips(): Box[]
    },
  ) {
    this.el = doc.createElement('div')
    this.el.className = 'gbar'
    this.bar = doc.createElement('div')
    this.bar.className = 'gb'
    this.bar.setAttribute('role', 'toolbar')
    this.bar.hidden = true
    this.tip = doc.createElement('div')
    this.tip.className = 'gtip'
    this.tip.hidden = true
    this.el.append(this.bar, this.tip)
    this.bar.addEventListener('keydown', this.onKey)
    this.bar.addEventListener('focusout', (e) => {
      if (!this.bar.contains(e.relatedTarget as Node | null)) {
        this.keyboard = false
        this.hideTip()
      }
    })
  }

  destroy(): void {
    this.clear()
    this.el.remove()
  }

  private clear(): void {
    const w = this.doc.defaultView!
    w.clearTimeout(this.showTimer)
    w.clearTimeout(this.hideTimer)
    w.clearTimeout(this.fadeTimer)
    w.clearTimeout(this.tipTimer)
    this.doc.body?.classList.remove('nota-gbar-row')
  }

  /** The place of the bar on the screen, or null when it is not there. */
  rect(): Box | null {
    return this.visible ? this.box : null
  }

  /** The point is on the bar (or on the hair of space between it and its grip): the table under the mouse stays. */
  holds(x: number, y: number): boolean {
    const b = this.rect()
    if (!b || !this.shown) return false
    const s = this.shown.a.strip
    return hits(b, x, y) || hits({ left: Math.min(b.left, s.left), top: Math.min(b.top, s.top), right: Math.max(b.right, s.right), bottom: Math.max(b.bottom, s.bottom) }, x, y) && this.bridges(b, s, x, y)
  }

  /** The bridge: the band between the bar and the grip, as wide as the bar. */
  private bridges(b: Box, s: Box, x: number, y: number): boolean {
    return b.top >= s.bottom - 1 || b.bottom <= s.top + 1 ? x >= b.left && x <= b.right : y >= b.top && y <= b.bottom
  }

  /** The state of the page or of the pointer changed: where the bar stands. */
  update(anchors: readonly Anchor[], ctx: BarContext): void {
    this.last = { anchors, ctx }
    const target = this.wanted(anchors)
    if (!target) {
      if (this.shown && this.visible && !this.hideTimer) this.scheduleHide()
      if (!this.shown) this.cancelShow()
      return
    }
    this.cancelHide()
    if (this.shown?.key === target.key && this.visible) {
      this.shown = target
      this.layout(ctx)
      return
    }
    if (target.bySelection || this.visible || this.armed === target.key || this.keyboard) {
      this.armed = target.key
      this.present(target, ctx)
      return
    }
    if (!this.showTimer) {
      const key = target.key
      this.showTimer = this.doc.defaultView!.setTimeout(() => {
        this.showTimer = 0
        this.armed = key
        this.cb.refresh()
      }, SHOW_AFTER)
    }
  }

  private wanted(anchors: readonly Anchor[]): Target | null {
    const make = (a: Anchor, from: number, to: number, bySelection: boolean): Target => ({ key: `${a.n}:${a.kind}:${from}-${to}`, a, from, to, bySelection })
    const shown = this.shown
    // Hovering a different grip must not rebuild buttons while the keyboard is using them.
    if (shown && this.keyboard && this.bar.contains(this.doc.activeElement)) {
      const anchor = anchors.find((a) => a.n === shown.a.n && a.kind === shown.a.kind && a.i === shown.from)
      if (anchor) return make(anchor, shown.from, shown.to, shown.bySelection)
    }
    const p = this.cb.pointer()
    if (this.quiet) {
      if (p && hits(this.quiet, p.x, p.y)) return null
      this.quiet = null
    }
    const over = p ? anchors.find((a) => hits(a.strip, p.x, p.y)) : undefined
    // (the pointer on the bar: the bar stays as it is, even if the grips under it are gone)
    if (p && this.shown && this.holds(p.x, p.y) && !over) {
      const again = anchors.find((a) => a.n === this.shown!.a.n && a.kind === this.shown!.a.kind && a.i === this.shown!.from)
      return again ? make(again, this.shown.from, this.shown.to, this.shown.bySelection) : this.shown
    }
    if (over) {
      this.dismissed = null
      if (over.sel && over.i >= over.sel.from && over.i <= over.sel.to) return make(over, over.sel.from, over.sel.to, false)
      return make(over, over.i, over.i, false)
    }
    const sel = anchors.find((a) => a.sel && a.i === a.sel.from)
    if (!sel) this.dismissed = null
    const t = sel ? make(sel, sel.sel!.from, sel.sel!.to, true) : null
    return t && t.key === this.dismissed ? null : t
  }

  // ---------------------------------------------------------------- show and hide

  private present(t: Target, ctx: BarContext): void {
    const same = this.shown?.key === t.key
    this.shown = t
    this.doc.defaultView!.clearTimeout(this.fadeTimer)
    if (!same || this.buttons.length === 0) this.build(t)
    this.bar.hidden = false
    if (!this.layout(ctx)) return
    if (!this.visible) {
      this.visible = true
      // (the first frame at opacity 0, then the class: the bar comes up by opacity alone)
      void this.bar.offsetWidth
    }
    this.bar.classList.add('on')
    this.bar.classList.remove('leaving')
  }

  private scheduleHide(): void {
    const w = this.doc.defaultView!
    this.hideTimer = w.setTimeout(() => {
      this.hideTimer = 0
      this.bar.classList.remove('on')
      this.bar.classList.add('leaving')
      this.hideTip()
      this.fadeTimer = w.setTimeout(() => this.drop(), FADE_OUT)
    }, HIDE_AFTER)
  }

  private cancelHide(): void {
    const w = this.doc.defaultView!
    if (this.hideTimer) w.clearTimeout(this.hideTimer)
    this.hideTimer = 0
    if (this.bar.classList.contains('leaving') && this.shown) {
      w.clearTimeout(this.fadeTimer)
      this.bar.classList.remove('leaving')
      this.bar.classList.add('on')
    }
  }

  private cancelShow(): void {
    if (this.showTimer) this.doc.defaultView!.clearTimeout(this.showTimer)
    this.showTimer = 0
    this.armed = null
  }

  /** The bar is gone at once (no fade): the grips are gone, or there is no place for it. */
  private drop(): void {
    this.cancelShow()
    this.doc.defaultView!.clearTimeout(this.hideTimer)
    this.hideTimer = 0
    this.shown = null
    this.visible = false
    this.box = null
    this.armed = null
    this.keyboard = false
    this.bar.hidden = true
    this.bar.classList.remove('on', 'leaving')
    this.hideTip()
    this.doc.body?.classList.remove('nota-gbar-row')
  }

  /** The bar closes (Esc, or the action was done): the focus is the caller's. */
  close(quiet = false): void {
    const p = this.cb.pointer()
    if (quiet && this.box && p && hits(this.box, p.x, p.y)) this.quiet = this.box
    this.drop()
  }

  // ---------------------------------------------------------------- the buttons

  private acts(t: Target): { act: LineAct; text: string }[] {
    const l = this.cb.labels()
    const col = t.a.kind === 'col'
    const many = t.to > t.from
    const del = (col ? (many ? l.barColsDelete : l.barColDelete) : many ? l.barRowsDelete : l.barRowDelete)!.split('{n}').join(String(t.to - t.from + 1))
    return [
      { act: 'before', text: (col ? l.barColBefore : l.barRowBefore)! },
      { act: 'after', text: (col ? l.barColAfter : l.barRowAfter)! },
      { act: 'delete', text: del },
    ]
  }

  private groupName(t: Target): string {
    const l = this.cb.labels()
    const f = String(t.from + 1)
    const g = String(t.to + 1)
    if (t.a.kind === 'col') return (t.to > t.from ? l.gripColumns! : l.gripColumn!).split('{n}').join(f).split('{a}').join(f).split('{b}').join(g)
    return (t.to > t.from ? l.gripRows! : l.gripRow!).split('{n}').join(f).split('{a}').join(f).split('{b}').join(g)
  }

  private build(t: Target): void {
    this.bar.textContent = ''
    this.buttons.length = 0
    this.bar.className = `gb ${t.a.kind}`
    this.bar.setAttribute('aria-label', this.groupName(t))
    this.bar.setAttribute('aria-orientation', t.a.kind === 'col' ? 'horizontal' : 'vertical')
    const place = this.host.place(t.a.tbl)
    for (const { act, text } of this.acts(t)) {
      const b = this.doc.createElement('button')
      b.type = 'button'
      b.className = act === 'delete' ? 'gbtn del' : 'gbtn'
      b.tabIndex = -1
      b.dataset.act = act
      b.setAttribute('aria-label', text)
      const no = place ? this.host.refusal(place, t.a.kind, act, { kind: t.a.kind, from: t.from, to: t.to }) : null
      if (no) {
        b.setAttribute('aria-disabled', 'true')
        b.dataset.reason = no.text
        b.classList.add('off')
      }
      const icon = act === 'delete' ? SVG.delete : SVG[`${act}-${t.a.kind}` as 'before-col']
      b.innerHTML = `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icon}</svg>`
      if (act === 'delete' && t.to > t.from) {
        const n = this.doc.createElement('span')
        n.className = 'cnt'
        n.textContent = String(t.to - t.from + 1)
        n.setAttribute('aria-hidden', 'true')
        b.append(n)
      }
      // (a press does not take the focus from the text; the action is on `click`, which Enter and Space on a focused button make too)
      b.addEventListener('mousedown', (e) => e.preventDefault())
      b.addEventListener('click', (e) => {
        e.preventDefault()
        this.run(act)
      })
      b.addEventListener('mouseenter', () => this.armTip(b, false))
      b.addEventListener('mouseleave', () => this.hideTipSoon(b))
      b.addEventListener('focus', () => this.armTip(b, true))
      b.addEventListener('blur', () => { if (this.tipFor === b) this.hideTip() })
      this.bar.append(b)
      this.buttons.push(b)
    }
  }

  /** The pointer in the bar's buttons: the hint of the button under it, at once when another hint is shown. */
  private armTip(b: HTMLButtonElement, now: boolean): void {
    const w = this.doc.defaultView!
    w.clearTimeout(this.tipTimer)
    this.tipFor = b
    if (now || !this.tip.hidden) this.showTip(b)
    else this.tipTimer = w.setTimeout(() => this.showTip(b), TIP_AFTER)
  }

  private hideTipSoon(b: HTMLButtonElement): void {
    // (the hint follows the keyboard focus: a button that has it keeps its hint when the mouse leaves)
    if (this.tipFor === b && this.doc.activeElement !== b) this.hideTip()
  }

  private hideTip(): void {
    this.doc.defaultView?.clearTimeout(this.tipTimer)
    this.tipFor = null
    this.tip.hidden = true
    // (the role is only on a hint that is shown: a page that counts its tooltips does not count an idle one)
    this.tip.removeAttribute('role')
    this.tip.classList.remove('on')
    this.cb.ownTip(false)
  }

  private measure: Measure = (text, form, maxW) => {
    const t = this.tip
    t.className = `gtip ${form}`
    this.fill(text, form)
    t.style.cssText = `left:0;top:0;max-width:${Math.max(40, maxW)}px;visibility:hidden`
    t.hidden = false
    let w = t.offsetWidth
    let h = t.offsetHeight
    if (w === 0 && h === 0) {
      // (a page without layout: a size by the length of the text)
      const len = form === 'reason' ? (text.reason ?? '').length : form === 'line' ? text.name.length + (text.reason ? text.reason.length + 3 : 0) : Math.max(text.name.length, (text.reason ?? '').length)
      w = Math.min(Math.max(40, maxW), len * 6.5 + 14)
      h = Math.ceil((len * 6.5) / Math.max(20, w - 14)) * 14 + 9 + (form === 'card' && text.reason ? 14 : 0)
    }
    return { w, h }
  }

  private fill(text: TipText, form: 'card' | 'line' | 'reason'): void {
    const t = this.tip
    t.textContent = ''
    const add = (cls: string, s: string): void => {
      const e = this.doc.createElement('span')
      e.className = cls
      e.textContent = s
      t.append(e)
    }
    if (form === 'reason') add('r', text.reason ?? text.name)
    else if (form === 'line') add(text.reason ? 'r' : 'n', text.reason ? `${text.name} · ${text.reason}` : text.name)
    else {
      add('n', text.name)
      if (text.reason) add('r', text.reason)
    }
  }

  private showTip(b: HTMLButtonElement): void {
    const s = this.shown
    const last = this.last
    const bar = this.box
    if (!s || !last || !bar) return
    const { ctx } = last
    const reason = b.dataset.reason ?? null
    const text: TipText = { name: b.getAttribute('aria-label') ?? '', reason }
    const r = b.getBoundingClientRect()
    const a = s.a
    const isles = this.isles()
    const span = this.span(s, ctx)
    const rows = a.kind === 'row' ? a.rows.slice(s.from, s.to + 1).map((q) => ({ left: a.frame.left, right: a.frame.right, top: Math.max(q.top, a.inner.top), bottom: Math.min(q.bottom, a.inner.bottom) })) : []
    const outer = a.tbl.parentElement?.closest('td, th')?.getBoundingClientRect()
    const place = placeTip({
      kind: a.kind,
      text,
      button: { left: r.left, top: r.top, right: r.right, bottom: r.bottom },
      bar,
      strip: a.strip,
      span: span ?? [a.frame.left, a.frame.right],
      frame: a.frame,
      bounds: ctx.bounds,
      isles,
      strips: this.cb.strips().filter((x) => x !== a.strip),
      outer: outer && outer.width > 0 ? { left: outer.left, top: outer.top, right: outer.right, bottom: outer.bottom } : null,
      rows,
      measure: this.measure,
    })
    const t = this.tip
    if (!place) {
      this.hideTip()
      this.tipFor = b
      return
    }
    t.className = `gtip ${place.form}`
    this.fill(text, place.form)
    t.style.cssText = `left:${place.box.left - ctx.ox}px;top:${place.box.top - ctx.oy}px;max-width:${Math.ceil(place.box.right - place.box.left) + 1}px`
    t.hidden = false
    t.setAttribute('role', 'tooltip')
    t.classList.toggle('dim', !!reason)
    t.classList.add('on')
    this.cb.ownTip(place.own)
  }

  private isles(): Box[] {
    return Array.from(this.doc.querySelectorAll('.isle')).map((e) => {
      const q = e.getBoundingClientRect()
      return { left: q.left, top: q.top, right: q.right, bottom: q.bottom }
    })
  }

  /** The visible part of the lines of the target, along the grip: x for columns, y for rows; null when there is less than 3 px of it. */
  private span(t: Target, ctx: BarContext): [number, number] | null {
    const a = t.a
    if (a.kind === 'col') {
      const lo = Math.max(a.xs[t.from]!, a.inner.left, ctx.bounds.left)
      const hi = Math.min(a.xs[t.to + 1]!, a.inner.right, ctx.bounds.right)
      return hi - lo >= 3 ? [lo, hi] : null
    }
    const first = a.rows[t.from]
    const last = a.rows[t.to]
    if (!first || !last) return null
    const lo = Math.max(first.top, a.inner.top, ctx.bounds.top)
    const hi = Math.min(last.bottom, a.inner.bottom, ctx.bounds.bottom)
    return hi - lo >= 3 ? [lo, hi] : null
  }

  /** Puts the bar where it stands; false (and the bar is gone) when it has no place. */
  private layout(ctx: BarContext): boolean {
    const t = this.shown
    if (!t) return false
    const span = this.span(t, ctx)
    const b = span ? placeBar(t.a.kind, t.a.strip, span, ctx.bounds, this.isles()) : null
    if (!b) {
      this.drop()
      return false
    }
    this.box = b
    this.bar.style.left = `${b.left - ctx.ox}px`
    this.bar.style.top = `${b.top - ctx.oy}px`
    this.doc.body?.classList.toggle('nota-gbar-row', t.a.kind === 'row')
    return true
  }

  // ---------------------------------------------------------------- the actions and the keys

  private run(act: LineAct): void {
    const t = this.shown
    if (!t) return
    const keyboard = this.bar.contains(this.doc.activeElement)
    const tables = Array.from(this.doc.querySelectorAll<HTMLElement>('.tbl'))
    const tbl = t.a.tbl.isConnected ? t.a.tbl : (tables[t.a.n] ?? t.a.tbl)
    const place = this.host.place(tbl)
    if (!place) return
    const kind = t.a.kind
    const range = { kind, from: t.from, to: t.to }
    const total = kind === 'col' ? place.view.ncols : place.view.nrows
    const ok = act === 'delete' ? this.host.remove(place, range) : this.host.insert(place, kind, act === 'before' ? t.from : t.to, act)
    if (!ok) return
    this.close(true)
    const at = act === 'before' ? t.from : act === 'after' ? t.to + 1 : Math.min(t.from, total - (t.to - t.from + 1) - 1)
    if (keyboard) this.cb.focusGrip(t.a.n, kind, Math.max(0, at))
    else this.host.focus()
  }

  /** Opens the bar of a grip by the keyboard: the lines are selected already, the focus goes to the first button. */
  open(a: Anchor, from: number, to: number): void {
    this.keyboard = true
    const key = `${a.n}:${a.kind}:${from}-${to}`
    const t: Target = { key, a, from, to, bySelection: false }
    this.cancelShow()
    this.cancelHide()
    this.armed = key
    this.present(t, this.last?.ctx ?? { ox: 0, oy: 0, bounds: a.frame })
    if (this.visible) this.buttons[0]?.focus()
    else this.keyboard = false
  }

  /** The bar of the line under the focus is open. */
  isOpen(): boolean {
    return this.visible && this.bar.contains(this.doc.activeElement)
  }

  private readonly onKey = (e: KeyboardEvent): void => {
    const t = this.shown
    if (!t) return
    const col = t.a.kind === 'col'
    const at = this.buttons.findIndex((b) => b === this.doc.activeElement)
    const next = (d: number): void => {
      e.preventDefault()
      e.stopPropagation()
      this.buttons[clamp(at + d, 0, this.buttons.length - 1)]?.focus()
    }
    if (e.key === (col ? 'ArrowRight' : 'ArrowDown')) next(1)
    else if (e.key === (col ? 'ArrowLeft' : 'ArrowUp')) next(-1)
    else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      const { a, from } = t
      this.dismissed = t.key
      this.close()
      this.cb.focusGrip(a.n, a.kind, from)
    }
  }
}
