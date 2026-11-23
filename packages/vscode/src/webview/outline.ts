/**
 * The sections («Разделы») of the tab: the left capsule with the name of the current section, the card that hangs under it
 * (an item for every section and every discrete heading, a counter of remarks in the innermost section) and the narrow
 * island of strokes at the left edge. It reads `doc.outline()` and the remarks of the document of the session; the
 * current section comes from the scroll. The page asks for a new look after every change (`refresh`); the outline
 * draws it once a frame at most.
 */
import type { OutlineEntry, NotaDocument } from '@nota-adoc/core'
import { blankAfter } from '@nota-adoc/core/internal'
import { type Locale, strings } from '../strings.js'
import { counts, remarkCount } from './diagnostics.js'

/** Where the page is, as the tree needs it. */
export interface OutlineHost {
  /** The document of the session now. */
  doc(): NotaDocument
  /** The offset of the top of what is seen, and whether the page is scrolled to its end. */
  view(): { top: number; atBottom: boolean }
  /** The title line of a section was chosen. */
  goToHeading(offset: number): void
  /** A remark was chosen: put the cursor at its place. */
  goToRemark(offset: number): void
  /** The mode of the visual editor: the sections may be moved (by dragging a row or by Alt+↑ and Alt+↓). Without it they may not. */
  canMove?(): boolean
  /** The section that starts at `at` goes to the place `to` (as `moveBlock` reads it); false when the engine refused. */
  moveSection?(at: number, to: number): boolean
  /** The card is about to open: the page closes the other cards. */
  beforeOpen?(): void
  /** A word for the strip of the page. */
  notify?(text: string): void
}

export interface Outline {
  /** The card «Разделы», the capsule it hangs from, and the island of strokes at the left edge. */
  readonly card: HTMLElement
  readonly isle: HTMLButtonElement
  readonly strokes: HTMLButtonElement
  /** The column «Разделы» beside the text (the view `side`): the same tree, always on the screen, with the arrows that fold the subsections. */
  readonly side: HTMLElement
  /** The view of the outline: the style sheet shows the column or the strokes and the capsule by it. */
  setView(view: 'capsule' | 'side'): void
  /** The name of the current section (the name of the document above its first section). */
  readonly current: string
  readonly isOpen: boolean
  /** The card is held open (a click) and not just open for the mouse over the strokes. */
  readonly pinned: boolean
  open(): void
  close(restoreFocus?: boolean): void
  toggle(): void
  /** The mode «Текст» turns the sections off. */
  setEnabled(enabled: boolean): void
  /** The document changed: draw the tree again (once a frame). */
  refresh(): void
  /** The page scrolled: find the current section (once a frame). */
  scrolled(): void
  /** Draw now, whatever the frame says (tests and the first look). */
  flush(): void
  /** The section `from` (an index of the tree) is let go on the upper or the lower half of the row `target`: what a drop does. */
  dropOn(from: number, target: number, where: 'before' | 'after'): boolean
  /** Alt+↑ (`up`) or Alt+↓ on the row `index`. */
  swap(index: number, up: boolean, within?: HTMLElement): boolean
  /** The remarks that count (errors and warnings) of the document as the tree saw them last. */
  readonly remarks: readonly { from: number; to: number; code: string; message: string; severity: 'error' | 'warning' | 'info' }[]
  destroy(): void
}

const ICON_DOWN =
  '<svg class="i i-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9.5 6 6 6-6"/></svg>'
const ICON_FOLD =
  '<svg class="i i-fold" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9.5 6 6 6-6"/></svg>'
const ICON_TOC =
  '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h10M4 18h13"/></svg>'

/** The mouse stays on the strokes this long before the card opens; it leaves for this long before the card closes (ms). */
export const ENTER_MS = 150
export const LEAVE_MS = 300
/** The fold of the panel lasts this long (ms): the class «closing» stays on the card (the style sheet moves the panel by a transition of the same length). */
export const CLOSE_MS = 170

/** The panel at the strokes: its width, the most it is high, and the room it leaves under it and under the row of capsules (px). */
const PANEL_W = 336
const PANEL_MAX_H = 560
const PANEL_ROOM_BELOW = 16
/** The strokes: the padding and the frame take this much of their height, the width of the column, the most a step is, the least it is before sections share a stroke (px). */
const RAIL_EXTRA = 22
const RAIL_W = 34
const STEP_MAX = 12
const STEP_MIN = 4

/** How the marks of the strokes fit in `inner` px: how many sections share a mark, how many marks there are, the step (from the top of a mark to the top of the next) and the thickness (px). */
export function fitMarks(n: number, inner: number): { group: number; marks: number; step: number; thick: number } {
  // `marks` marks of `thick` px and `marks - 1` gaps between them fill `inner` at most
  const stepFor = (marks: number): { step: number; thick: number } => {
    if (marks <= 1) return { step: STEP_MAX, thick: 3 }
    const wide = Math.floor((inner - 3) / (marks - 1))
    if (wide >= 6) return { step: Math.min(STEP_MAX, wide), thick: 3 }
    return { step: Math.min(STEP_MAX, Math.floor((inner - 2) / (marks - 1))), thick: 2 }
  }
  let group = 1
  let fit = stepFor(n)
  while (fit.step < STEP_MIN && group < n) {
    group++
    fit = stepFor(Math.ceil(n / group))
  }
  return { group, marks: Math.ceil(n / group), ...fit }
}

/** The name of the document: the title line `= …` without its subtitle (the part after «: »), or '' without a title. */
export function documentName(text: string): string {
  for (const line of text.split('\n', 60)) {
    const m = /^(?:=|#)[ \t]+(\S.*?)\s*$/.exec(line)
    if (m) {
      const full = m[1]!
      const cut = full.lastIndexOf(': ')
      return cut > 0 ? full.slice(0, cut) : full
    }
    if (/^(?:={2,6}|#{2,6})[ \t]/.test(line)) return ''
  }
  return ''
}

/** The offset of the start of the title line of an entry (its first lines can be an anchor or `[discrete]`). */
export function headingOffset(text: string, entry: OutlineEntry): number {
  let at = entry.from
  while (at < text.length) {
    const end = text.indexOf('\n', at)
    const line = text.slice(at, end < 0 ? text.length : end)
    if (/^(?:={1,6}|#{1,6})[ \t]+\S/.test(line)) return at
    if (end < 0) break
    at = end + 1
  }
  return entry.from
}

/** The index of the innermost entry that holds the offset (the last one that starts before it and has not ended). */
function entryAt(entries: readonly OutlineEntry[], offset: number): number {
  let found = -1
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]!
    if (e.from > offset) break
    if (offset < e.to || (e.from === e.to && offset === e.from)) found = i
  }
  return found
}

const frame = (win: Window, run: () => void): (() => void) => {
  if (typeof win.requestAnimationFrame === 'function') {
    const id = win.requestAnimationFrame(run)
    return () => win.cancelAnimationFrame(id)
  }
  const id = win.setTimeout(run, 16)
  return () => win.clearTimeout(id)
}

export function createOutline(doc: Document, host: OutlineHost, locale: Locale = 'en'): Outline {
  const t = strings[locale].tree
  const win = doc.defaultView!
  const ui = strings[locale].isles
  const card = doc.createElement('section')
  card.className = 'card sections-card'
  card.hidden = true
  card.setAttribute('role', 'group')
  card.setAttribute('aria-label', t.label)
  card.innerHTML = `<div class="card-head">${t.head}</div>
<ul class="tree-list"></ul>`
  const list = card.querySelector<HTMLElement>('.tree-list')!

  // the column beside the text: the same rows in a container that stands still, and the arrows that fold the subsections
  const side = doc.createElement('aside')
  side.className = 'sections-side'
  side.hidden = true
  side.setAttribute('aria-label', t.label)
  side.innerHTML = `<div class="side-head">${t.head}</div>
<ul class="tree-list"></ul>`
  const sideList = side.querySelector<HTMLElement>('.tree-list')!
  const lists = [list, sideList]
  /** The column is filled only in the view `side`: in `capsule` the tab has the rows of the panel alone. */
  let view: 'capsule' | 'side' = 'capsule'
  /** The folded sections of the tab, by `level:title:n` (the n-th section with this level and title); not kept between tabs. */
  const folded = new Set<string>()
  let keys: string[] = []
  /** For every entry: the folded row that hides it (an index), or -1 when it is shown; and whether it has subsections. */
  let hiddenBy: number[] = []
  let parentOf: boolean[] = []

  const isle = doc.createElement('button')
  isle.type = 'button'
  isle.className = 'isle isle-sections'
  isle.setAttribute('aria-haspopup', 'true')
  isle.setAttribute('aria-expanded', 'false')
  isle.setAttribute('aria-label', ui.sections)
  isle.title = ui.sections
  isle.innerHTML = `${ICON_TOC}<span class="isle-name"></span>${ICON_DOWN}`
  const isleName = isle.querySelector<HTMLElement>('.isle-name')!

  const strokes = doc.createElement('button')
  strokes.type = 'button'
  strokes.className = 'isle isle-strokes'
  strokes.setAttribute('aria-haspopup', 'true')
  strokes.setAttribute('aria-expanded', 'false')
  strokes.setAttribute('aria-label', ui.sections)
  strokes.title = ui.sections
  let enabled = true
  let opened = false

  let entries: readonly OutlineEntry[] = []
  let starts: number[] = []
  let remarks: Outline['remarks'] = []
  /** The first remark of every entry (by index), for the click on its counter. */
  let firstOf: (number | null)[] = []
  let active = -1
  /** The shape of the rows in the lists now (to tell if they are to be drawn again). */
  let drawn: string | null = null
  let cancelDraw: (() => void) | null = null
  let cancelActive: (() => void) | null = null

  /** The rows of the tree into `target`; the column has the arrow of folding in front of the name. */
  function fillRows(target: HTMLElement, column: boolean, perEntry: readonly number[]): void {
    target.textContent = ''
    entries.forEach((e, i) => {
      const li = doc.createElement('li')
      const row = doc.createElement('div')
      row.className = 'tree-row'
      row.dataset.index = String(i)
      if (host.canMove?.()) row.draggable = true
      row.style.setProperty('--lvl', String(Math.max(0, e.level - 1)))
      if (column) {
        if (parentOf[i]) {
          const fold = doc.createElement('button')
          fold.type = 'button'
          fold.className = 'tree-fold'
          fold.dataset.index = String(i)
          fold.innerHTML = ICON_FOLD
          row.append(fold)
        } else {
          const gap = doc.createElement('span')
          gap.className = 'tree-fold-gap'
          row.append(gap)
        }
      }
      const item = doc.createElement('button')
      item.type = 'button'
      item.className = `tree-item${e.level <= 1 ? ' top' : ''}`
      item.dataset.index = String(i)
      const name = doc.createElement('span')
      name.className = 'tree-name'
      name.textContent = e.title
      item.title = e.title
      item.append(name)
      row.append(item)
      if (perEntry[i]) {
        const badge = doc.createElement('button')
        badge.type = 'button'
        badge.className = 'tree-badge'
        badge.dataset.index = String(i)
        badge.textContent = String(perEntry[i])
        badge.setAttribute('aria-label', t.inSectionGo(remarkCount(perEntry[i]!, locale)))
        badge.title = t.inSection(remarkCount(perEntry[i]!, locale))
        row.append(badge)
      }
      li.append(row)
      target.append(li)
    })
    if (column) applyFolds()
  }

  /** Which rows the folds hide, and the state of the arrows and rows of the column. */
  function computeFolds(): void {
    const seen = new Map<string, number>()
    keys = entries.map((e) => {
      const base = `${e.level}:${e.title}`
      const n = seen.get(base) ?? 0
      seen.set(base, n + 1)
      return `${base}:${n}`
    })
    parentOf = entries.map((e, i) => i + 1 < entries.length && entries[i + 1]!.level > e.level)
    hiddenBy = []
    let root = -1
    for (let i = 0; i < entries.length; i++) {
      if (root >= 0 && entries[i]!.level > entries[root]!.level) hiddenBy.push(root)
      else {
        root = -1
        hiddenBy.push(-1)
        if (parentOf[i] && folded.has(keys[i]!)) root = i
      }
    }
  }
  function applyFolds(): void {
    sideList.querySelectorAll<HTMLElement>('.tree-row').forEach((row) => {
      const i = Number(row.dataset.index)
      row.parentElement!.hidden = hiddenBy[i]! >= 0
      const fold = row.querySelector<HTMLElement>('.tree-fold')
      if (fold) {
        const closed = folded.has(keys[i]!)
        const name = entries[i]!.title
        fold.classList.toggle('closed', closed)
        fold.setAttribute('aria-expanded', String(!closed))
        fold.setAttribute('aria-label', closed ? t.expandOf(name) : t.collapseOf(name))
        fold.title = closed ? t.expand : t.collapse
      }
    })
  }
  function toggleFold(i: number): void {
    const key = keys[i]
    if (key === undefined || !parentOf[i]) return
    if (!folded.delete(key)) folded.add(key)
    computeFolds()
    applyFolds()
    active = -2
    markActive()
  }

  /** Without sections nothing of the outline shows, and the capsule keeps its place in the row; the page of the view `side` does not depend on the column. */
  function syncEmpty(): void {
    const none = entries.length === 0
    side.hidden = !enabled || none || view !== 'side'
    side.toggleAttribute('data-lane', enabled && view === 'side')
    strokes.hidden = !enabled || none
    isle.toggleAttribute('data-empty', none)
    if (none) {
      isle.setAttribute('aria-hidden', 'true')
      isle.tabIndex = -1
    } else {
      isle.removeAttribute('aria-hidden')
      isle.removeAttribute('tabindex')
    }
    if (none && opened) close()
  }

  function draw(): void {
    cancelDraw = null
    const d = host.doc()
    const text = d.text
    entries = d.outline()
    starts = entries.map((e) => headingOffset(text, e))
    remarks = d.diagnostics.filter((r) => counts(r.severity))
    const perEntry: number[] = entries.map(() => 0)
    firstOf = entries.map(() => null)
    for (const r of remarks) {
      // the innermost section; a remark above the first section is counted in the first, one in nothing else nowhere
      let i = entryAt(entries, r.from)
      if (i < 0 && entries.length > 0) {
        i = 0
        for (let k = 0; k < entries.length && entries[k]!.from <= r.from; k++) i = k
      }
      if (i < 0) continue
      perEntry[i]!++
      if (firstOf[i] === null) firstOf[i] = r.from
    }
    // typing changes the offsets, rarely the shape: the rows are drawn again only when a title, a level, a count or the
    // draggable state is another
    computeFolds()
    const movable = host.canMove?.() ? 'm' : ''
    const shape = movable + entries.map((e, i) => `${e.level}:${perEntry[i]}:${e.title}`).join('\n')
    if (shape !== drawn) {
      drawn = shape
      active = -2
      fillRows(list, false, perEntry)
      if (view === 'side') fillRows(sideList, true, perEntry)
      layoutDirty = true
    }
    syncEmpty()
    if (layoutDirty) layout()
    markActive()
  }

  // ---- the strokes and the panel at the left edge of a wide tab: both stand in the middle of the tab's height, have one height
  // (when the sections do not fit, a stroke stands for 2–3 of them) and are measured in px here, because the style sheet cannot know the capsules
  /** Sections per stroke now. */
  let group = 1
  let layoutDirty = true
  /** The levels the strokes were drawn for: a changed level of a section redraws them (the `sub` class). */
  let drawnLevels = ''
  const levelsKey = (): string => entries.map((e) => e.level).join()
  function drawStrokes(g: number, shape: { step: number; thick: number } | null): void {
    group = g
    drawnLevels = levelsKey()
    strokes.textContent = ''
    const topLevel = Math.min(...entries.map((e) => e.level))
    for (let from = 0; from < entries.length; from += g) {
      const stroke = doc.createElement('span')
      const sub = entries.slice(from, from + g).every((e) => e.level > topLevel)
      stroke.className = `stroke${sub ? ' sub' : ''}`
      stroke.dataset.index = String(from)
      strokes.append(stroke)
    }
    if (shape) {
      strokes.style.setProperty('--stroke-gap', `${shape.step - shape.thick}px`)
      strokes.style.setProperty('--stroke-h', `${shape.thick}px`)
    } else {
      strokes.style.removeProperty('--stroke-gap')
      strokes.style.removeProperty('--stroke-h')
    }
    active = -2
  }
  function layout(): void {
    const main = strokes.parentElement
    const n = entries.length
    // not in a tab yet, hidden, or too narrow for the strokes: nothing to measure; the plain marks, the style sheet's own places
    if (!main || strokes.hidden || n === 0 || !strokes.offsetWidth || !main.clientHeight) {
      if (group !== 1 || strokes.childElementCount !== n || drawnLevels !== levelsKey()) drawStrokes(1, null)
      for (const el of [strokes, card]) for (const name of ['--sec-top', '--sec-rail-h', '--sec-h', '--sec-start']) el.style.removeProperty(name)
      layoutDirty = !main || !strokes.hidden
      return
    }
    layoutDirty = false
    const box = main.getBoundingClientRect()
    const row = main.querySelector<HTMLElement>('.isle-mid')?.getBoundingClientRect()
    const tools = main.querySelector<HTMLElement>('.isle-mid .isle-tools')?.getBoundingClientRect()
    const rowBottom = row ? row.bottom - box.top : 46
    // the upper limit: 8 px under the row of capsules (the wide capsule of tools may reach over the column of the panel, so the row, not its line)
    const minTop = Math.round(Math.max(rowBottom, tools && tools.left - box.left < 14 + PANEL_W + 8 ? tools.bottom - box.top : 0) + 8)
    // the card is measured without the height of the last layout: otherwise a list that became shorter keeps the old, taller panel
    card.style.removeProperty('--sec-h')
    const natural = card.offsetHeight - list.clientHeight + list.scrollHeight
    const room = Math.min(PANEL_MAX_H, box.height - minTop - PANEL_ROOM_BELOW)
    const panelH = Math.max(0, Math.min(natural, room))
    const fit = fitMarks(n, Math.max(1, panelH - RAIL_EXTRA))
    const natRail = RAIL_EXTRA + n * fit.thick + (n - 1) * (STEP_MAX - fit.thick)
    const railH = fit.step < STEP_MAX || fit.group > 1 ? panelH : natRail
    if (fit.group !== group || drawnLevels !== levelsKey() || strokes.childElementCount !== fit.marks || strokes.style.getPropertyValue('--stroke-gap') !== `${fit.step - fit.thick}px`) drawStrokes(fit.group, fit)
    // the panel and the strokes stand in the middle of the tab's height (variant А: one centre), held between the limits; the strokes never leave the panel
    const centred = (h: number): number => Math.max(minTop, Math.min(Math.round((box.height - h) / 2), box.height - PANEL_ROOM_BELOW - h))
    const panelTop = centred(panelH)
    const railTop = Math.max(panelTop, Math.min(centred(railH), panelTop + panelH - railH))
    strokes.style.setProperty('--sec-top', `${railTop}px`)
    card.style.setProperty('--sec-top', `${panelTop}px`)
    strokes.style.setProperty('--sec-rail-h', `${railH}px`)
    card.style.setProperty('--sec-h', `${panelH}px`)
    // a panel as low as the strokes starts as wide as them; a taller one grows out from under them
    card.style.setProperty('--sec-start', `${panelH <= railH + 0.5 ? RAIL_W : 0}px`)
  }
  let layoutFrame: (() => void) | null = null
  const relayout = (): void => {
    layoutDirty = true
    layoutFrame ??= frame(win, () => {
      layoutFrame = null
      // the tab grew with the card open (pinned, or held by the pointer): the column is there, and the card would lie on it. The observer on the column says the same,
      // but it comes late in a loaded browser; the window's «resize» does not wait for it
      if (opened && view === 'side' && side.getBoundingClientRect().width > 0) close()
      if (layoutDirty) {
        layout()
        markActive()
      }
    })
  }
  let watcher: ResizeObserver | null = null
  /** The list follows the current section: only the list moves (not the page), only where the row is out of sight (`nearest`) or to the middle (`center`). */
  function reveal(how: 'nearest' | 'center', target: HTMLElement = list): void {
    const row = target.querySelector<HTMLElement>('.tree-item.on')
    if (!row || !target.clientHeight) return
    const lr = target.getBoundingClientRect()
    const rr = row.getBoundingClientRect()
    const pad = 6
    const y = rr.top - lr.top + target.scrollTop
    if (how === 'center') target.scrollTop = y - (target.clientHeight - rr.height) / 2
    else if (rr.top < lr.top + pad) target.scrollTop = y - pad
    else if (rr.bottom > lr.bottom - pad) target.scrollTop = y + rr.height - target.clientHeight + pad
  }

  function markActive(): void {
    cancelActive = null
    if (entries.length === 0) {
      isleName.textContent = documentName(host.doc().text)
      return
    }
    const { top, atBottom } = host.view()
    let at = -1
    for (let i = 0; i < starts.length; i++) if (starts[i]! <= top) at = i
    // at the end of the document the last section is the current one: its title is in sight
    if (atBottom) at = entries.length - 1
    if (at === active) return
    const changed = active !== -2
    active = at
    isleName.textContent = at < 0 ? documentName(host.doc().text) : entries[at]!.title
    // in the column a current section inside a folded one lights the row of the folded parent
    const shown = at >= 0 && (hiddenBy[at] ?? -1) >= 0 ? hiddenBy[at]! : at
    for (const target of lists) {
      for (const el of target.querySelectorAll<HTMLElement>('.tree-item')) {
        const on = Number(el.dataset.index) === (target === sideList ? shown : at)
        el.classList.toggle('on', on)
        if (on) el.setAttribute('aria-current', 'location')
        else el.removeAttribute('aria-current')
      }
    }
    for (const el of strokes.querySelectorAll<HTMLElement>('.stroke')) {
      const from = Number(el.dataset.index)
      el.classList.toggle('on', at >= from && at < from + group)
    }
    // an open panel follows the document; a list the author scrolled stays where it is until the current section changes
    if (changed && opened) reveal('nearest')
    reveal('nearest', sideList)
  }

  // the scrollbar of the list shows while the list scrolls (and while the mouse is over it: the style sheet)
  let scrollingTimer: ReturnType<typeof setTimeout> | undefined
  for (const el of lists)
    el.addEventListener('scroll', () => {
      el.classList.add('scrolling')
      clearTimeout(scrollingTimer)
      scrollingTimer = setTimeout(() => el.classList.remove('scrolling'), 800)
    })

  // a click in the card closes it; in the column (it stands always) nothing closes
  const wireClicks = (el: HTMLElement, column: boolean): void => {
    el.addEventListener('click', (event) => {
      const target = event.target instanceof Element ? event.target : null
      const fold = column ? target?.closest<HTMLElement>('.tree-fold') : null
      if (fold) {
        toggleFold(Number(fold.dataset.index))
        return
      }
      const badge = target?.closest<HTMLElement>('.tree-badge')
      if (badge) {
        const at = firstOf[Number(badge.dataset.index)]
        if (at !== null && at !== undefined) {
          if (!column) close()
          host.goToRemark(at)
        }
        return
      }
      const item = target?.closest<HTMLElement>('.tree-item')
      if (item) {
        if (!column) close()
        host.goToHeading(starts[Number(item.dataset.index)]!)
      }
    })
  }
  wireClicks(list, false)
  wireClicks(sideList, true)

  // ---- moving the sections: dragging a row, Alt+↑ and Alt+↓
  /** The index of the row being dragged, or -1. */
  let dragging = -1
  const rowOf = (target: EventTarget | null): HTMLElement | null => (target instanceof Element ? target.closest<HTMLElement>('.tree-row') : null)
  const rangeHolds = (i: number, j: number): boolean => entries[j]!.from >= entries[i]!.from && entries[j]!.to <= entries[i]!.to
  const clearMarks = (): void =>
    lists.forEach((l) => l.querySelectorAll('.drop-before, .drop-after, .dragging').forEach((el) => el.classList.remove('drop-before', 'drop-after', 'dragging')))
  /** The place right after the section `k` with all it holds (as the engine reads it). */
  const afterSection = (k: number): number => {
    const text = host.doc().text
    const end = entries[k]!.to
    return blankAfter(text, end) ? end : text[end - 1] === '\n' ? end - 1 : end
  }
  const tell = (text: string): void => host.notify?.(text)
  const move = (i: number, to: number): boolean => {
    const ok = host.moveSection?.(entries[i]!.from, to) ?? false
    if (!ok) tell(t.cannotMove)
    return ok
  }
  /** The section `from` is let go on the row `j`, in its upper or lower half. */
  function dropOn(from: number, j: number, where: 'before' | 'after'): boolean {
    if (from === j || !entries[from] || !entries[j] || rangeHolds(from, j)) return false
    return move(from, where === 'before' ? entries[j]!.from : afterSection(j))
  }
  /** Alt+↑ / Alt+↓ on the row `i`: it changes places with its neighbour of the same level, the focus stays on it. */
  function swap(i: number, up: boolean, within: HTMLElement = list): boolean {
    if (!entries[i]) return false
    const n = neighbour(i, up ? -1 : 1)
    if (n < 0) {
      tell(up ? t.first : t.last)
      return false
    }
    const now = up ? n : i + sizeOf(n)
    if (!move(i, up ? entries[n]!.from : afterSection(n))) return false
    // the tree is drawn again at once, and the focus stays on the section
    flush()
    within.querySelector<HTMLElement>(`.tree-item[data-index="${now}"]`)?.focus()
    return true
  }
  const wireDrag = (el: HTMLElement): void => {
    el.addEventListener('dragstart', (event) => {
      const row = rowOf(event.target)
      if (!row || !host.canMove?.()) return event.preventDefault()
      dragging = Number(row.dataset.index)
      row.classList.add('dragging')
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move'
        event.dataTransfer.setData('application/x-nota-section', String(dragging))
      }
    })
    el.addEventListener('dragover', (event) => {
      const row = rowOf(event.target)
      if (dragging < 0 || !row) return
      el.querySelectorAll('.drop-before, .drop-after').forEach((el) => el.classList.remove('drop-before', 'drop-after'))
      const j = Number(row.dataset.index)
      // on itself and on its own subsections: not allowed
      if (rangeHolds(dragging, j)) {
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'none'
        return
      }
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
      const box = row.getBoundingClientRect()
      row.classList.add(event.clientY < box.top + box.height / 2 ? 'drop-before' : 'drop-after')
    })
    el.addEventListener('dragleave', (event) => {
      const row = rowOf(event.target)
      if (row && !row.contains(event.relatedTarget as Node | null)) row.classList.remove('drop-before', 'drop-after')
    })
    el.addEventListener('drop', (event) => {
      const row = rowOf(event.target)
      const from = dragging
      const before = row?.classList.contains('drop-before') ?? false
      clearMarks()
      dragging = -1
      if (from < 0 || !row || !host.canMove?.()) return
      event.preventDefault()
      dropOn(from, Number(row.dataset.index), before ? 'before' : 'after')
    })
    el.addEventListener('dragend', () => {
      clearMarks()
      dragging = -1
    })
  }
  wireDrag(list)
  wireDrag(sideList)
  /** The neighbour of the same level in the same section (the next or the previous), or -1. */
  const neighbour = (i: number, step: 1 | -1): number => {
    const level = entries[i]!.level
    for (let j = i + step; j >= 0 && j < entries.length; j += step) {
      if (entries[j]!.level < level) return -1
      if (entries[j]!.level === level) return j
    }
    return -1
  }
  const sizeOf = (k: number): number => {
    let n = 1
    while (k + n < entries.length && entries[k + n]!.from < entries[k]!.to) n++
    return n
  }
  for (const el of lists)
    el.addEventListener('keydown', (event) => {
      if (!event.altKey || event.ctrlKey || event.metaKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return
      const item = event.target instanceof Element ? event.target.closest<HTMLElement>('.tree-item') : null
      if (!item || !host.canMove?.()) return
      event.preventDefault()
      swap(Number(item.dataset.index), event.key === 'ArrowUp', el)
    })

  // ---- the card: opened by the capsule (pinned), by the strokes (pinned by a click, open for a while by hovering),
  // closed by them, by a click elsewhere and by Esc
  /** The card is held open: the mouse leaving does not close it. */
  let pinned = false
  /** What pinned it, for the focus after Esc. */
  let pinnedBy: HTMLButtonElement = isle
  /** The mouse is over the strokes / over the card. */
  let overStrokes = false
  let overCard = false
  /** After a choice the card does not open again under a still mouse: until the mouse leaves the strokes. */
  let suppressed = false
  let enterTimer: ReturnType<typeof setTimeout> | undefined
  let leaveTimer: ReturnType<typeof setTimeout> | undefined
  const clearTimers = (): void => {
    clearTimeout(enterTimer)
    clearTimeout(leaveTimer)
    enterTimer = leaveTimer = undefined
  }
  let closingTimer: ReturnType<typeof setTimeout> | undefined
  /** The held-open state on the DOM: the style sheet gives the panel the accent frame. */
  function syncPinned(): void {
    for (const el of [card, strokes]) el.toggleAttribute('data-pinned', pinned)
  }
  function setOpen(on: boolean, pin = true, by: HTMLButtonElement = isle): void {
    if (on && (!enabled || entries.length === 0)) return
    if (on && opened) {
      // hovered → pinned by a click: the other cards close, as for any open card
      if (pin && !pinned) {
        pinned = true
        syncPinned()
        pinnedBy = by
        host.beforeOpen?.()
      }
      return
    }
    if (!on && !opened) return
    clearTimers()
    opened = on
    pinned = on && pin
    syncPinned()
    if (on) pinnedBy = by
    else suppressed = overStrokes
    card.hidden = !on
    // the fold is animated by the style sheet (the class keeps the hidden card on the screen for 170 ms); reduced motion hides at once
    clearTimeout(closingTimer)
    if (on) card.classList.remove('closing')
    else if (!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      // the global «[hidden] { display: none !important }» is beaten only by the «!important» of the closing rule
      card.classList.add('closing')
      closingTimer = setTimeout(() => card.classList.remove('closing'), CLOSE_MS)
    }
    for (const b of [isle, strokes]) b.setAttribute('aria-expanded', String(on))
    if (on) {
      // a short panel is never lower than the strokes it grows from
      if (layoutDirty) layout()
      if (pin) host.beforeOpen?.()
      reveal('center')
    }
  }
  function open(): void {
    setOpen(true)
  }
  function close(restoreFocus = false): void {
    const was = opened
    const by = pinnedBy
    setOpen(false)
    if (was && restoreFocus) by.focus()
  }
  const toggle = (): void => (opened ? close() : open())
  isle.addEventListener('click', toggle)
  strokes.addEventListener('click', () => {
    if (opened && pinned) close()
    else setOpen(true, true, strokes)
  })
  const scheduleLeave = (): void => {
    clearTimeout(leaveTimer)
    leaveTimer = undefined
    if (!opened || pinned || dragging >= 0 || overStrokes || overCard) return
    leaveTimer = setTimeout(() => {
      leaveTimer = undefined
      if (opened && !pinned && dragging < 0 && !overStrokes && !overCard) setOpen(false)
    }, LEAVE_MS)
  }
  strokes.addEventListener('mouseenter', () => {
    overStrokes = true
    clearTimeout(leaveTimer)
    if (opened || suppressed || !enabled || strokes.hidden) return
    clearTimeout(enterTimer)
    enterTimer = setTimeout(() => {
      enterTimer = undefined
      if (overStrokes && !suppressed) setOpen(true, false, strokes)
    }, ENTER_MS)
  })
  strokes.addEventListener('mouseleave', () => {
    overStrokes = false
    suppressed = false
    clearTimeout(enterTimer)
    enterTimer = undefined
    scheduleLeave()
  })
  card.addEventListener('mouseenter', () => {
    overCard = true
    clearTimeout(leaveTimer)
  })
  card.addEventListener('mouseleave', () => {
    overCard = false
    scheduleLeave()
  })
  // a drag ends: the card that was open by hovering goes if the mouse is away
  // no mouseenter/mouseleave come during a native drag: ask the browser where the mouse is now
  const afterDrag = (): void => {
    overCard = card.matches(':hover')
    scheduleLeave()
  }
  list.addEventListener('dragend', afterDrag)
  list.addEventListener('drop', afterDrag)
  const onDown = (event: MouseEvent): void => {
    if (!opened) return
    const target = event.target instanceof Node ? event.target : null
    if (target && (card.contains(target) || isle.contains(target) || strokes.contains(target))) return
    close()
  }
  const onKey = (event: KeyboardEvent): void => {
    if (opened && event.key === 'Escape') {
      event.preventDefault()
      close(true)
    }
  }
  doc.addEventListener('mousedown', onDown)
  doc.addEventListener('keydown', onKey)

  function flush(): void {
    cancelDraw?.()
    cancelActive?.()
    draw()
  }

  draw()
  // once the strokes are in the tab: measure them, and again whenever the tab changes its size
  frame(win, () => {
    if (!strokes.parentElement) return
    relayout()
    if (typeof win.ResizeObserver === 'function') {
      watcher = new win.ResizeObserver(relayout)
      watcher.observe(strokes.parentElement)
    }
  })
  win.addEventListener('resize', relayout)
  // a column that becomes visible (the tab grew) shows the current section
  const sideWatch =
    typeof win.ResizeObserver === 'function'
      ? new win.ResizeObserver(() => {
          // the tab grew past the threshold with the card pinned: the column has come, the strokes are gone, and the card would lie on the column
          if (opened && side.getBoundingClientRect().width > 0) close()
          reveal('nearest', sideList)
        })
      : null
  sideWatch?.observe(side)
  return {
    card,
    isle,
    strokes,
    side,
    setView(next) {
      if (view === next && side.dataset.view) return
      view = next
      side.dataset.view = next
      if (next === 'side') {
        // the card is for the capsule and the strokes: the column needs none open
        close()
        drawn = null
      } else sideList.textContent = ''
      flush()
      relayout()
      reveal('center', sideList)
    },
    get current() {
      return isleName.textContent ?? ''
    },
    get isOpen() {
      return opened
    },
    open,
    close,
    toggle,
    setEnabled(next) {
      if (enabled === next) return
      enabled = next
      isle.disabled = !next
      syncEmpty()
      if (!next) close()
    },
    get pinned() {
      return pinned
    },
    get remarks() {
      return remarks
    },
    refresh() {
      cancelDraw ??= frame(win, draw)
    },
    scrolled() {
      if (cancelDraw) return
      cancelActive ??= frame(win, markActive)
    },
    flush,
    dropOn,
    swap,
    destroy() {
      cancelDraw?.()
      cancelActive?.()
      layoutFrame?.()
      clearTimeout(scrollingTimer)
      watcher?.disconnect()
      sideWatch?.disconnect()
      win.removeEventListener('resize', relayout)
      clearTimers()
      doc.removeEventListener('mousedown', onDown)
      doc.removeEventListener('keydown', onKey)
      card.remove()
      isle.remove()
      strokes.remove()
      side.remove()
    },
  }
}
