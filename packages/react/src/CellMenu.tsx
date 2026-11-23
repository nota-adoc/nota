import type { CellHAlign, CellRefusal, CellVAlign, VisualEditor } from '@nota-adoc/prosemirror'
import type { KeyboardEvent as ReactKeyboardEvent, ReactElement, ReactNode } from 'react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { BUBBLE_FOLD_MS, BUBBLE_OPEN_MS, clearOf, leastCrowded, reducedMotion } from './BubbleMenu.js'
import {
  AlignHIcon,
  AlignIcon,
  AlignVIcon,
  CellFillIcon,
  ChevronIcon,
  ColDelIcon,
  DotsIcon,
  EraseIcon,
  HeadIcon,
  MergeIcon,
  RowDelIcon,
  SplitIcon,
} from './icons.js'
import type { Locale } from './locale.js'
import { messages } from './messages.js'
import { ColorButton, keepSelection } from './Toolbar.js'
import { type TipBind, type TipContent, useTips } from './Tooltip.js'
import { useEditorState } from './useEditorState.js'

/** which row stands in place of the buttons of the capsule of cells. */
export type CellRowKind = 'fill' | 'align' | null

export interface CellMenuProps {
  editor: VisualEditor | undefined
  locale: Locale
  /** The element the capsule is placed in (it is `position: relative`), and the one that scrolls under it. */
  container: HTMLElement
  scroller?: HTMLElement
  /** Which row is open (the row itself is `row`). */
  open?: CellRowKind
  row?: ReactNode
  /** The row is closed and only folds up (the caller holds it for `BUBBLE_FOLD_MS`). */
  rowLeaving?: boolean
  /** The capsule is put away for a while (the blocks of «+» are open): nothing is shown, nothing is lost. */
  hidden?: boolean
  /** The lower edge of what lies over the text (the capsules), and the element whose `style` tells that it moved. */
  topLimit?: () => number
  limitWatch?: () => Element | null
  /** The elements of the tab the capsule must never lie on (the grips, the bar of the grips, the capsules, the strokes, the handles). */
  avoid?: () => Iterable<Element>
  disabled?: boolean
  /** The capsule shows after this many ms of a selection that does not change (default 120). */
  delay?: number
  onBeforeCommand?(): void
  /** «Заливка ячеек ⌄» and «Выравнивание ⌄» were pressed: the caller opens the row. */
  onRow(kind: 'fill' | 'align', anchor: HTMLElement, keyboard: boolean): void
}

interface Spot {
  left: number
  top: number
}

type EntryId = 'merge' | 'split' | 'align' | 'cell-fill' | 'head' | 'clear' | 'row-del' | 'col-del'

interface Entry {
  id: EntryId
  group: number
  label: string
  tip: TipContent
  icon: ReactElement
  pressed?: boolean
  haspopup?: boolean
  off: CellRefusal | null
  count?: number
  danger?: boolean
  run(anchor: HTMLElement, keyboard: boolean): void
}

/** The space the capsule keeps from the edges of the visible part of the tab (px). */
const GAP = 8
/** The width of the rule between two groups of buttons: 1 px and 5 px at each side (the style sheet). */
const SEP = 11

/** The horizontal and the vertical alignments in the order of the row «Выравнивание». */
export const H_ALIGN = ['left', 'center', 'right'] as const
export const V_ALIGN = ['top', 'middle', 'bottom'] as const

/**
 * the capsule of two or more selected cells, of the shape of the one over selected text (`BubbleMenu`): the same classes, the same
 * place and fold of its row, the same popups. It stands under the selection (over it when there is no room below, or when the selection takes
 * the first row, over the grips), centred on its visible part; it goes sideways past the grips and the capsules, and folds the buttons it has
 * no room for, from the end, into «⋯».
 */
export function CellMenu(props: CellMenuProps): ReactElement | null {
  const { editor, locale, container, scroller, open = null, disabled = false, hidden = false, delay = 120, row, topLimit, limitWatch, avoid } = props
  const rowLeaving = Boolean(row) && Boolean(props.rowLeaving)
  const hasRow = Boolean(row) && !rowLeaving
  const t = messages[locale]
  const cb = t.cellBar
  const state = useEditorState(editor)
  const sel = state.table?.selection ?? null
  const ref = useRef<HTMLDivElement>(null)
  const [focused, setFocused] = useState(false)
  const [pressed, setPressed] = useState(false)
  const [readyKey, setReadyKey] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const [spot, setSpot] = useState<Spot | null>(null)
  const [tick, setTick] = useState(0)
  const [above, setAbove] = useState(false)
  const [rove, setRove] = useState<EntryId>('merge')
  const [moreOpen, setMoreOpen] = useState(false)
  const key = sel ? `${state.from}:${state.to}:${sel.row}.${sel.col}.${sel.rows}.${sel.cols}` : ''
  const keyRef = useRef(key)
  keyRef.current = key
  const tips = useTips(ref, open !== null || moreOpen || hasRow, above)

  // the width of the capsule goes from the one of now to the one it comes to, when a row opens or folds up (as `BubbleMenu`)
  const [prevRow, setPrevRow] = useState(hasRow)
  const [staleBar, setStaleBar] = useState(false)
  const [shift, setShift] = useState(0)
  const from = useRef<number | null>(null)
  const moving = useRef(false)
  const final = useRef(0)
  const [holdTop, setHoldTop] = useState<number | null>(null)
  if (prevRow !== hasRow) {
    setPrevRow(hasRow)
    setHoldTop(reducedMotion() || !spot ? null : spot.top)
    setStaleBar(hasRow && !reducedMotion())
    setShift((n) => n + 1)
    from.current = ref.current ? ref.current.getBoundingClientRect().width : null
  }
  useLayoutEffect(() => {
    const el = ref.current
    const start = from.current
    from.current = null
    if (!el || start === null || shift === 0 || reducedMotion()) {
      if (el) {
        el.style.width = ''
        delete el.dataset.morph
      }
      moving.current = false
      setHoldTop(null)
      return
    }
    el.style.width = ''
    const to = el.offsetWidth
    final.current = to
    el.style.transition = 'none'
    el.style.width = `${start}px`
    void el.offsetWidth
    el.style.transition = ''
    el.dataset.morph = hasRow ? 'open' : 'close'
    el.style.width = `${to}px`
    moving.current = true
    const timer = setTimeout(
      () => {
        el.style.width = ''
        delete el.dataset.morph
        moving.current = false
        setHoldTop(null)
        setTick((n) => n + 1)
      },
      (hasRow ? BUBBLE_OPEN_MS : BUBBLE_FOLD_MS) + 40,
    )
    return () => clearTimeout(timer)
  }, [shift])
  useEffect(() => {
    if (!staleBar) return
    const timer = setTimeout(() => setStaleBar(false), 120)
    return () => clearTimeout(timer)
  }, [staleBar, shift])

  // focus and the mouse: the capsule waits for the end of a drag
  useEffect(() => {
    if (!editor) return
    const dom = editor.view.dom
    const doc = dom.ownerDocument
    setFocused(dom.contains(doc.activeElement))
    const focusin = (): void => setFocused(true)
    const focusout = (event: FocusEvent): void => {
      const next = event.relatedTarget as Node | null
      if (!next || !ref.current?.contains(next)) setFocused(false)
    }
    const down = (): void => setPressed(true)
    const up = (): void => setPressed(false)
    // (the button can be let go where no `mouseup` comes: outside the tab, after a native drag; the editor ends its drag the same way, by a `mousemove` with no button)
    const move = (event: MouseEvent): void => {
      if (event.buttons === 0) setPressed(false)
    }
    const away = (event: MouseEvent): void => {
      const target = event.target as Node
      if (!ref.current?.contains(target) && !dom.contains(target)) setFocused(false)
    }
    doc.addEventListener('mousedown', away)
    dom.addEventListener('focusin', focusin)
    dom.addEventListener('focusout', focusout)
    dom.addEventListener('mousedown', down)
    doc.addEventListener('mouseup', up)
    doc.addEventListener('mousemove', move)
    return () => {
      doc.removeEventListener('mousedown', away)
      dom.removeEventListener('focusin', focusin)
      dom.removeEventListener('focusout', focusout)
      dom.removeEventListener('mousedown', down)
      doc.removeEventListener('mouseup', up)
      doc.removeEventListener('mousemove', move)
    }
  }, [editor])
  // the blocks of «+» went: the focus is where it is
  useEffect(() => {
    if (hidden || !editor) return
    const dom = editor.view.dom
    setFocused(dom.contains(dom.ownerDocument.activeElement) || Boolean(ref.current?.contains(dom.ownerDocument.activeElement)))
  }, [hidden, editor])

  // a new selection shows the capsule after a moment (a new key takes the old one away in the very render that brings it)
  useEffect(() => {
    setDismissed(false)
    setMoreOpen(false)
    const timer = setTimeout(() => setReadyKey(key), delay)
    return () => clearTimeout(timer)
  }, [key, delay])

  const wanted = Boolean(editor) && !disabled && !hidden && sel !== null && (focused || open !== null) && !pressed && readyKey === key && !dismissed

  // Esc in the capsule: the focus goes back to the text, the capsule is hidden, the cells stay selected (the next Esc lets them go)
  useEffect(() => {
    if (!wanted || !editor) return
    const doc = editor.view.dom.ownerDocument
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      if (moreOpen) {
        setMoreOpen(false)
        ref.current?.querySelector<HTMLElement>('[data-cmd="more"]')?.focus({ preventScroll: true })
        event.preventDefault()
        event.stopPropagation()
        return
      }
      if (ref.current?.contains(doc.activeElement)) editor.focus()
      setDismissed(true)
    }
    doc.addEventListener('keydown', onKey)
    return () => doc.removeEventListener('keydown', onKey)
  }, [wanted, editor, moreOpen])

  // the editor learns that the capsule is on the screen: its first Esc then leaves the cells selected
  useEffect(() => {
    const onScreen = wanted && spot !== null
    if (!editor || !onScreen) return
    editor.cellCapsuleShown = true
    return () => {
      editor.cellCapsuleShown = false
    }
  }, [wanted, spot !== null, editor])

  // «⋯» opened by the keys: the focus goes to the first item
  const moreByKeys = useRef(false)
  useEffect(() => {
    if (!moreOpen || !moreByKeys.current) return
    moreByKeys.current = false
    ref.current?.querySelector<HTMLElement>('.cm-list button')?.focus({ preventScroll: true })
  }, [moreOpen])

  // Alt+F10 from the text with cells selected: the focus goes to the capsule (it also brings it back after Esc)
  const wantedRef = useRef(false)
  wantedRef.current = wanted
  const goal = useRef(false)
  const roveRef = useRef(rove)
  roveRef.current = rove
  const toPanel = (): void => {
    const here = ref.current?.querySelector<HTMLElement>(`.bb-layer.bar [data-cmd="${roveRef.current}"]`)
    ;(here ?? ref.current?.querySelector<HTMLElement>('.bb-layer.bar button'))?.focus({ preventScroll: true })
  }
  const selectedRef = useRef(false)
  selectedRef.current = sel !== null
  useEffect(() => {
    if (!editor || disabled || hasRow) return
    const doc = editor.view.dom.ownerDocument
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'F10' || !event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
      if (!editor.view.dom.contains(event.target as Node) || !selectedRef.current) return
      event.preventDefault()
      if (wantedRef.current && ref.current) {
        toPanel()
        return
      }
      goal.current = true
      setDismissed(false)
      setReadyKey(keyRef.current)
      setFocused(true)
      setPressed(false)
    }
    doc.addEventListener('keydown', onKey)
    return () => doc.removeEventListener('keydown', onKey)
  }, [editor, disabled, hasRow])
  useEffect(() => {
    if (sel === null) goal.current = false
  }, [sel])
  useEffect(() => () => {
    goal.current = false
  }, [])
  useEffect(() => {
    if (!goal.current || !wanted || !spot) return
    goal.current = false
    toPanel()
  }, [wanted, spot])

  // the capsule rides with the selection when the page scrolls
  useEffect(() => {
    const redo = (): void => setTick((n) => n + 1)
    const win = container.ownerDocument.defaultView
    const doc = container.ownerDocument
    doc.addEventListener('scroll', redo, true)
    scroller?.addEventListener('scroll', redo)
    win?.addEventListener('resize', redo)
    return () => {
      doc.removeEventListener('scroll', redo, true)
      scroller?.removeEventListener('scroll', redo)
      win?.removeEventListener('resize', redo)
    }
  }, [container, scroller])

  // the buttons, by the selection
  const stateTable = state.table
  const entries: Entry[] = []
  if (editor && sel && stateTable) {
    const c = editor.commands
    const rows = { from: sel.row + 1, to: sel.row + sel.rows }
    const cols = { from: sel.col + 1, to: sel.col + sel.cols }
    entries.push({
      id: 'merge',
      group: 0,
      label: cb.merge,
      tip: { name: cb.merge, text: cb.mergeText, ...(sel.refusals.merge ? { off: sel.refusals.merge.text } : {}) },
      icon: <MergeIcon />,
      off: sel.refusals.merge,
      run: () => c.mergeCells(),
    })
    if (sel.merged)
      entries.push({ id: 'split', group: 0, label: cb.split, tip: { name: cb.split, text: cb.splitText }, icon: <SplitIcon />, off: null, run: () => c.splitCells() })
    entries.push({
      id: 'align',
      group: 1,
      label: cb.align,
      tip: { name: cb.align, text: cb.alignText },
      icon: (
        <>
          <AlignIcon />
          <ChevronIcon />
        </>
      ),
      haspopup: true,
      off: null,
      run: (a, k) => props.onRow('align', a, k),
    })
    entries.push({
      id: 'cell-fill',
      group: 1,
      label: stateTable.fill ? `${cb.fillName}: ${t.cellFills[stateTable.fill]}` : stateTable.mixedFill ? `${cb.fillName}: ${t.cellFillMixed.toLowerCase()}` : cb.fillName,
      tip: { name: cb.fillName, text: cb.fillText },
      icon: <CellFillIcon />,
      haspopup: true,
      off: null,
      run: (a, k) => props.onRow('fill', a, k),
    })
    if (sel.firstRow)
      entries.push({
        id: 'head',
        group: 2,
        label: cb.head,
        tip: { name: cb.head, text: cb.headText, ...(sel.refusals.header ? { off: sel.refusals.header.text } : {}) },
        icon: <HeadIcon />,
        pressed: stateTable.header,
        off: sel.refusals.header,
        run: () => c.toggleHeader(),
      })
    entries.push({
      id: 'clear',
      group: 2,
      label: cb.clear,
      tip: { name: cb.clear, text: cb.clearText, ...(sel.refusals.clear ? { off: sel.refusals.clear.text } : {}) },
      icon: <EraseIcon />,
      off: sel.refusals.clear,
      run: () => c.clearCells(),
    })
    entries.push({
      id: 'row-del',
      group: 3,
      label: cb.rowDel(sel.rows),
      tip: { name: cb.rowDel(sel.rows), text: cb.rowDelText(rows.from, rows.to, sel.rows), ...(sel.refusals.deleteRows ? { off: sel.refusals.deleteRows.text } : {}) },
      icon: <RowDelIcon />,
      count: sel.rows,
      danger: true,
      off: sel.refusals.deleteRows,
      run: () => c.deleteSelectedRows(),
    })
    entries.push({
      id: 'col-del',
      group: 3,
      label: cb.colDel(sel.cols),
      tip: { name: cb.colDel(sel.cols), text: cb.colDelText(cols.from, cols.to, sel.cols), ...(sel.refusals.deleteColumns ? { off: sel.refusals.deleteColumns.text } : {}) },
      icon: <ColDelIcon />,
      count: sel.cols,
      danger: true,
      off: sel.refusals.deleteColumns,
      run: () => c.deleteSelectedColumns(),
    })
  }

  // the buttons that do not fit go, from the end, into «⋯»; the widths are read from the buttons once (by the look of the tab and the count on them)
  const widths = useRef(new Map<string, number>())
  const [folded, setFolded] = useState(0)
  const [, measured] = useState(0)
  const area = (scroller ?? container).getBoundingClientRect()
  const narrow = area.width > 0 && area.width <= 650
  const wkey = (e: Entry): string => `${e.id}:${e.count ?? ''}:${narrow ? 'n' : 'w'}`
  const unknown = entries.some((e) => !widths.current.has(wkey(e)))
  const shown = unknown ? entries : entries.slice(0, entries.length - folded)
  const hiddenEntries = unknown ? [] : entries.slice(entries.length - folded)
  const sig = entries.map(wkey).join(',')
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !wanted) return
    const bar = el.querySelector('.bb-layer.bar')
    if (!bar) return
    let read = false
    for (const e of entries) {
      const b = bar.querySelector<HTMLElement>(`:scope > [data-cmd="${e.id}"]`)
      if (b && b.offsetWidth > 0 && widths.current.get(wkey(e)) !== b.offsetWidth) {
        widths.current.set(wkey(e), b.offsetWidth)
        read = true
      }
    }
    const room = (scroller ?? container).getBoundingClientRect().width - 2 * GAP
    if (room <= 0 || entries.some((e) => !widths.current.has(wkey(e)))) {
      if (read) measured((n) => n + 1)
      return
    }
    const frame = 2 * 5 + 2
    const more = widths.current.get('more') ?? 30
    const need = (n: number): number => {
      const list = entries.slice(0, n)
      let w = frame
      let last = -1
      for (const e of list) {
        w += widths.current.get(wkey(e))! + 1
        if (last >= 0 && e.group !== last) w += SEP + 2
        last = e.group
      }
      return n < entries.length ? w + more + 1 : w
    }
    let keep = entries.length
    while (keep > 0 && need(keep) > room) keep--
    const next = entries.length - keep
    if (next !== folded) setFolded(next)
    else if (read) measured((n) => n + 1)
  }, [wanted, sig, tick, hasRow, container, scroller, locale])

  useLayoutEffect(() => {
    if (!wanted || !editor) {
      setSpot(null)
      setHoldTop(null)
      return
    }
    const dom = editor.view.dom
    const cells = Array.from(dom.querySelectorAll<HTMLElement>('td.sel, th.sel')).map((c) => c.getBoundingClientRect())
    const box = container.getBoundingClientRect()
    const vis = (scroller ?? container).getBoundingClientRect()
    if (cells.length === 0) {
      setSpot(null)
      return
    }
    const rect = {
      left: Math.min(...cells.map((r) => r.left)),
      right: Math.max(...cells.map((r) => r.right)),
      top: Math.min(...cells.map((r) => r.top)),
      bottom: Math.max(...cells.map((r) => r.bottom)),
    }
    // inside a table the sideways edges are those of its frame (.tbl-scroll), not of the tab
    const frame = dom.querySelector<HTMLElement>('td.sel, th.sel')?.closest('.tbl-scroll')?.getBoundingClientRect() ?? null
    const edgeL = frame && frame.width > 0 ? Math.max(vis.left, frame.left) : vis.left
    const edgeR = frame && frame.width > 0 ? Math.min(vis.right, frame.right) : vis.right
    const free = Math.max(vis.top, topLimit?.() ?? 0)
    // the selection has left the visible part (up, down, sideways, or under the capsules): no capsule
    if (vis.height > 0 && (rect.bottom <= free || rect.top >= vis.bottom || (vis.width > 0 && (rect.right <= edgeL || rect.left >= edgeR)))) {
      setSpot(null)
      return
    }
    const el = ref.current
    const w = moving.current ? final.current : (el?.offsetWidth ?? 0)
    const h = el?.offsetHeight ?? 0
    const visL = Math.max(rect.left, edgeL)
    const visR = Math.min(rect.right, edgeR)
    const left = Math.max(GAP, Math.min((visL + visR) / 2 - w / 2 - box.left, box.width - w - GAP))
    const rects = avoid ? Array.from(avoid(), (e) => e.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0) : []
    // under the selection; over it (and over the grips and the bar of the grips that stand there) when there is no room below
    const below = Math.min(rect.bottom, vis.bottom) + GAP - box.top
    const roomBelow = rect.bottom + GAP + h <= vis.bottom - 4
    let edgeTop = rect.top
    for (const r of rects)
      if (r.bottom > rect.top - 70 && r.top < rect.top + 4 && r.right > visL && r.left < visR) edgeTop = Math.min(edgeTop, r.top)
    const over = edgeTop - GAP - h - box.top
    const roomOver = over >= Math.max(0, free - box.top) + 2
    const bottomEdge = vis.bottom - 4 - h - box.top
    const order: { at: number; up: boolean }[] = []
    if (roomBelow) order.push({ at: below, up: false })
    if (roomOver) order.push({ at: over, up: true })
    let x = left
    let y = order[0]?.at ?? bottomEdge
    let up = order[0]?.up ?? false
    if (w > 0) {
      let placed = false
      for (const o of order) {
        const fit = clearOf(rects, box, w, h, left, o.at)
        if (fit !== null) {
          x = fit
          y = o.at
          up = o.up
          placed = true
          break
        }
      }
      if (!placed) {
        // no free place: the one that lies on the least (at the lower edge of the visible part when the selection fills it)
        const ats = order.length > 0 ? order.map((o) => o.at) : [bottomEdge]
        const crowd = leastCrowded(rects, box, w, h, left, ats)
        x = crowd.left
        y = crowd.top
        up = order.find((o) => o.at === y)?.up ?? false
      }
    }
    setSpot((prev) => (prev && prev.left === x && prev.top === y ? prev : { left: x, top: y }))
    setAbove(up)
  }, [wanted, editor, key, container, scroller, tick, state, hasRow, folded, moreOpen])

  useEffect(() => {
    const el = wanted ? limitWatch?.() : null
    if (!el || typeof MutationObserver === 'undefined') return
    const watch = new MutationObserver(() => setTick((n) => n + 1))
    watch.observe(el, { attributes: true, attributeFilter: ['style'] })
    return () => watch.disconnect()
  }, [wanted, limitWatch])

  // the grips, their bar, the handle of a block come and go with the mouse: the capsule is placed again (not for its own changes)
  const watchesAvoid = Boolean(avoid)
  useEffect(() => {
    if (!wanted || !watchesAvoid || typeof MutationObserver === 'undefined') return
    const watch = new MutationObserver((records) => {
      const text = editor?.view.dom
      if (records.some((r) => !ref.current?.contains(r.target) && !(text && text.contains(r.target)))) setTick((n) => n + 1)
    })
    watch.observe(container, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'hidden'] })
    return () => watch.disconnect()
  }, [wanted, watchesAvoid, container, editor])

  useEffect(() => {
    const el = ref.current
    if (!el || !wanted || typeof ResizeObserver === 'undefined') return
    let last = el.offsetWidth
    const watch = new ResizeObserver(() => {
      if (moving.current || el.offsetWidth === last) return
      last = el.offsetWidth
      setTick((n) => n + 1)
    })
    watch.observe(el)
    return () => watch.disconnect()
  }, [wanted, hasRow])

  if (!editor || !wanted || !sel) return null
  const showBar = !hasRow || staleBar
  const run = (entry: Entry, anchor: HTMLElement, keyboard: boolean): void => {
    if (entry.off) {
      // a button that is dimmed does nothing; the popup says why, at once
      tips.showNow(entry.id, anchor)
      return
    }
    props.onBeforeCommand?.()
    setMoreOpen(false)
    entry.run(anchor, keyboard)
    if (entry.id === 'align' || entry.id === 'cell-fill') return
    // by the mouse the cursor stays in the text, by the keys the focus stays on the button (unless the selection went: the capsule with it)
    if (!keyboard || !editor.tableAt()?.selection) editor.focus()
  }
  const roveId = entries.some((e) => e.id === rove) ? rove : entries[0]!.id
  const tabs = (id: string): number => (id === roveId ? 0 : -1)
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (hasRow) return
    const target = event.target as HTMLElement
    if (event.key === 'Tab' && !event.altKey && !event.ctrlKey && !event.metaKey) {
      // Tab leaves the capsule for the text (the cells stay selected)
      event.preventDefault()
      setMoreOpen(false)
      editor.focus()
      return
    }
    if (event.key === 'ArrowDown' && target.closest('[data-cmd="more"]')) {
      event.preventDefault()
      moreByKeys.current = true
      if (moreOpen) ref.current?.querySelector<HTMLElement>('.cm-list button')?.focus({ preventScroll: true })
      else setMoreOpen(true)
      return
    }
    if (target.closest('.cm-list')) {
      const items = Array.from(ref.current?.querySelectorAll<HTMLElement>('.cm-list button') ?? [])
      const at = items.indexOf(target.closest('button') as HTMLElement)
      const k = event.key
      if (at < 0 || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(k)) return
      event.preventDefault()
      const to = k === 'Home' ? 0 : k === 'End' ? items.length - 1 : Math.max(0, Math.min(items.length - 1, at + (k === 'ArrowDown' ? 1 : -1)))
      items[to]?.focus({ preventScroll: true })
      return
    }
    const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End']
    if (!keys.includes(event.key)) return
    const buttons = Array.from(ref.current?.querySelectorAll<HTMLElement>('.bb-layer.bar > button') ?? [])
    const at = buttons.indexOf(event.target as HTMLElement)
    if (at < 0) return
    event.preventDefault()
    const to = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : Math.max(0, Math.min(buttons.length - 1, at + (event.key === 'ArrowRight' ? 1 : -1)))
    buttons[to]?.focus({ preventScroll: true })
  }
  const bind = (id: string, tip: TipContent): TipBind => tips.bind(id, tip)
  const button = (e: Entry): ReactElement => {
    if (e.id === 'cell-fill')
      return (
        <ColorButton
          key={e.id}
          kind="cell"
          className="tb-b b-fmt cell-fill"
          label={cb.fillName}
          name={stateTable?.fill ? t.cellFills[stateTable.fill] : stateTable?.mixedFill ? t.cellFillMixed.toLowerCase() : undefined}
          role={stateTable?.fill ?? null}
          disabled={false}
          expanded={open === 'fill'}
          tabIndex={tabs(e.id)}
          tip={bind(e.id, { ...e.tip, name: e.label })}
          onPress={(a, k) => run(e, a, k)}
        />
      )
    return (
      <button
        key={e.id}
        type="button"
        className={`tb-b${e.danger ? ' danger' : ''}${e.haspopup ? ' b-fmt' : ''}`}
        data-cmd={e.id}
        tabIndex={tabs(e.id)}
        aria-label={e.label}
        aria-disabled={e.off ? true : undefined}
        {...(e.pressed !== undefined ? { 'aria-pressed': e.pressed } : {})}
        {...(e.haspopup ? { 'aria-haspopup': 'true' as const, 'aria-expanded': open === 'align' } : {})}
        {...bind(e.id, { ...e.tip, name: e.label })}
        onClick={(ev) => run(e, ev.currentTarget, ev.detail === 0)}
      >
        {e.icon}
        {e.count !== undefined && e.count > 1 && <span className="cnt">{e.count}</span>}
      </button>
    )
  }
  const bar: ReactElement[] = []
  let last = -1
  for (const e of shown) {
    if (last >= 0 && e.group !== last) bar.push(<span key={`sep${e.group}`} className="fl-sep" />)
    last = e.group
    bar.push(button(e))
  }
  if (hiddenEntries.length > 0) {
    const names = hiddenEntries.map((e) => e.label.toLowerCase()).join(', ')
    bar.push(
      <button
        key="more"
        type="button"
        className="tb-b"
        data-cmd="more"
        tabIndex={tabs('more')}
        aria-label={cb.moreLabel}
        aria-haspopup="menu"
        aria-expanded={moreOpen}
        {...tips.bind('more', { name: cb.more, text: cb.moreText(names) })}
        onClick={(ev) => {
          moreByKeys.current = ev.detail === 0 && !moreOpen
          setMoreOpen((v) => !v)
        }}
      >
        <DotsIcon />
      </button>,
    )
  }
  return (
    <div
      ref={ref}
      className={`fl bubble cellbar${hasRow ? ' has-row' : ''}${rowLeaving ? ' is-folding' : ''}`}
      role="toolbar"
      aria-label={cb.label}
      data-above={above ? '' : undefined}
      style={{ left: `${spot?.left ?? 0}px`, top: `${holdTop ?? spot?.top ?? 0}px`, visibility: spot ? 'visible' : 'hidden' }}
      onMouseDown={keepSelection}
      onKeyDown={onKeyDown}
      onBlur={(event) => {
        const next = event.relatedTarget as Node | null
        if (next && !event.currentTarget.contains(next) && !editor.view.dom.contains(next) && open === null) setFocused(false)
      }}
      onFocus={(event) => {
        const cmd = (event.target as HTMLElement).closest('.bb-layer.bar > button')?.getAttribute('data-cmd')
        if (cmd && !hasRow) setRove(cmd as EntryId)
      }}
    >
      {showBar && (
        <div className={`bb-layer bar${hasRow ? ' is-out' : ''}`} {...(hasRow ? { inert: true, 'aria-hidden': true } : {})}>
          {bar}
        </div>
      )}
      {row && (
        <div className={`bb-layer row${rowLeaving ? ' is-out' : ''}`} {...(rowLeaving ? { inert: true, 'aria-hidden': true } : {})}>
          {row}
        </div>
      )}
      {moreOpen && hiddenEntries.length > 0 && (
        <div className="cm-list pop" role="menu" aria-label={cb.moreLabel} data-above={above ? '' : undefined}>
          {hiddenEntries.map((e) => (
            <button
              key={e.id}
              type="button"
              role="menuitem"
              data-cmd={`more-${e.id}`}
              aria-disabled={e.off ? true : undefined}
              {...(e.pressed !== undefined ? { 'aria-pressed': e.pressed } : {})}
              onClick={(ev) => run(e, ev.currentTarget, ev.detail === 0)}
            >
              <span className="cm-ico">{e.icon}</span>
              <span className="cm-name">{e.label}</span>
              {e.off && <span className="cm-why">{e.off.text}</span>}
            </button>
          ))}
        </div>
      )}
      {tips.node}
    </div>
  )
}

export interface AlignRowProps {
  locale: Locale
  /** What the selected cells have now; null where they differ. */
  halign: CellHAlign | null
  valign: CellVAlign | null
  keyboard?: boolean
  leaving?: boolean
  /** A position was chosen: one of the two is given. The row stays open. */
  onPick(horizontal?: CellHAlign, vertical?: CellVAlign): void
  onBack(): void
}

/** The row «Выравнивание» that stands in place of the buttons of the capsule of cells: «‹», the title, three positions across, three down, the name of what is now. */
export function AlignRow(props: AlignRowProps): ReactElement {
  const { locale, halign, valign } = props
  const t = messages[locale]
  const cb = t.cellBar
  const ref = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<string | null>(null)
  const leaving = Boolean(props.leaving)
  const backRef = useRef(props.onBack)
  backRef.current = props.onBack
  useEffect(() => {
    if (props.keyboard) (ref.current?.querySelector<HTMLElement>('.al-b[aria-pressed="true"]') ?? ref.current?.querySelector<HTMLElement>('.al-b'))?.focus({ preventScroll: true })
  }, [props.keyboard])
  useEffect(() => {
    if (leaving) return
    const doc = ref.current!.ownerDocument
    const key = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        backRef.current()
        return
      }
      if (!ref.current?.contains(event.target as Node)) return
      const buttons = Array.from(ref.current.querySelectorAll<HTMLElement>('.al-b'))
      const at = buttons.indexOf(event.target as HTMLElement)
      if (at < 0) return
      let to: number | null = null
      if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') to = Math.max(0, at - 1)
      else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') to = Math.min(buttons.length - 1, at + 1)
      else if (event.key === 'Home') to = 0
      else if (event.key === 'End') to = buttons.length - 1
      if (to === null) return
      event.preventDefault()
      event.stopPropagation()
      buttons[to]?.focus({ preventScroll: true })
    }
    doc.addEventListener('keydown', key, true)
    return () => doc.removeEventListener('keydown', key, true)
  }, [leaving])
  const name =
    halign && valign ? cb.both(cb[halign], cb[valign]) : halign ? `${cb[halign]} · ${cb.mixed.toLowerCase()}` : valign ? `${cb.mixed} · ${cb[valign].toLowerCase()}` : cb.mixed
  const shown = hover ?? name
  const h = (a: CellHAlign): ReactElement => (
    <button
      key={a}
      type="button"
      className="al-b"
      data-align={a}
      aria-label={cb[a]}
      aria-pressed={halign === a}
      onMouseEnter={() => setHover(cb[a])}
      onMouseLeave={() => setHover(null)}
      onClick={() => !leaving && props.onPick(a, undefined)}
    >
      <AlignHIcon at={a} />
    </button>
  )
  const v = (a: CellVAlign): ReactElement => (
    <button
      key={a}
      type="button"
      className="al-b"
      data-align={a}
      aria-label={cb[a]}
      aria-pressed={valign === a}
      onMouseEnter={() => setHover(cb[a])}
      onMouseLeave={() => setHover(null)}
      onClick={() => !leaving && props.onPick(undefined, a)}
    >
      <AlignVIcon at={a} />
    </button>
  )
  return (
    <div
      ref={ref}
      className={`cr cr-align${props.leaving ? ' is-leaving' : ''}`}
      role="group"
      aria-label={cb.align}
      data-kind="align"
      data-mode="row"
      onMouseDown={(e) => {
        if ((e.target as Element).closest('button')) e.preventDefault()
      }}
    >
      <button type="button" className="cr-back" aria-label={t.backToBar} onClick={props.onBack}>
        <span aria-hidden="true">‹</span>
      </button>
      <span className="cr-sep" aria-hidden="true" />
      <span className="cr-title">
        <span className="cr-t-def">{cb.align}</span>
      </span>
      <div className="cr-al" role="group" aria-label={cb.horizontal}>
        {H_ALIGN.map(h)}
      </div>
      <span className="cr-sep" aria-hidden="true" />
      <div className="cr-al" role="group" aria-label={cb.vertical}>
        {V_ALIGN.map(v)}
      </div>
      <span className="cr-name">
        <span className="cr-name-t">{shown}</span>
      </span>
    </div>
  )
}
