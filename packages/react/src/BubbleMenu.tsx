import type { VisualEditor } from '@nota-adoc/prosemirror'
import type { KeyboardEvent as ReactKeyboardEvent, ReactElement, ReactNode } from 'react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { LinkIcon } from './icons.js'
import type { Locale } from './locale.js'
import { messages } from './messages.js'
import { ColorButton, type FormatActions, MarkGlyph, type OpenPopover, keepSelection } from './Toolbar.js'
import { isMac, keyLabel, useTips } from './Tooltip.js'
import { useEditorState } from './useEditorState.js'

export interface BubbleMenuProps extends FormatActions {
  editor: VisualEditor | undefined
  locale: Locale
  /** The element the panel is placed in (it is `position: relative`), and the one that scrolls under it. */
  container: HTMLElement
  scroller?: HTMLElement
  /** A window of the panel is open: the panel hides but stays, the window is placed under its button. */
  open?: OpenPopover
  /**
   * the row of colours (`ColorPopover` with `row`). It stands in place of the buttons of the panel, which stays where it is
   * and shows (the panel keeps its one floor, only wider); without it a window of the panel hides the panel, as before.
   */
  row?: ReactNode
  /**
   * the row is closed and only folds up: it stays mounted, `inert`, and fades out while the panel narrows to its buttons
   * (the caller holds it for `BUBBLE_FOLD_MS`).
   */
  rowLeaving?: boolean
  /**
   * The top of the free room in the viewport (px): the lower edge of what lies over the text (a capsule with its row «Таблица»).
   * The panel does not stand above it: where the word is lower than the panel's height from it, the panel goes under the word.
   */
  topLimit?: () => number
  /** The element whose `style` tells that the limit moved (the capsule grew or folded): the panel is placed again. */
  limitWatch?: () => Element | null
  /**
   * the elements of the tab the panel must never lie on or under (the strokes of the sections, the handle of a block, the badge of
   * the sheet). One that is not drawn (no size) is ignored. The panel goes sideways past them, else to the other side of the word.
   */
  avoid?: () => Iterable<Element>
  /** The mode of the source: no panel. */
  disabled?: boolean
  /** The panel shows after this many ms of a selection that does not change (default 120). */
  delay?: number
}

/** How long the panel takes to widen to the row of colours (ms) and to narrow back to its buttons; the style sheet has 0.22 s and 0.17 s. */
export const BUBBLE_OPEN_MS = 220
export const BUBBLE_FOLD_MS = 170
/** How long the buttons stay, fading, over the opening row (ms). */
const BAR_OUT_MS = 120
/** How long the old panel with its row fades out in its place when the selection moves (ms); the style sheet has the same 0.12 s. */
export const BUBBLE_GHOST_MS = 120

/** The user wants no motion: every change is at once. */
export const reducedMotion = (): boolean =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

const BUTTONS = [
  { key: 'strong', label: 'bold', keys: { key: 'B' } },
  { key: 'em', label: 'italic', keys: { key: 'I' } },
  { key: 'code', label: 'monospace', keys: { key: 'E' } },
  { key: 'strike', label: 'strikethrough', keys: { shift: true, key: 'X' } },
  { key: 'highlight', label: 'highlight', keys: { shift: true, key: 'H' } },
] as const

/** The line of each mark in `messages.tips`. */
const MARK_TIP = { strong: 'bold', em: 'italic', code: 'mono', strike: 'strike', highlight: 'hl' } as const

/**
 * The place for a panel `w` by `h` px whose upper edge is `at` (px from the top of the container `box`), as near to `left` as the
 * rectangles `rects` (the window's coordinates) allow: it goes past each one it would lie on, to the side that is nearer, and stays 8 px inside the
 * container. null when there is no such place at this height.
 */
export function clearOf(rects: readonly DOMRect[], box: DOMRect, w: number, h: number, left: number, at: number): number | null {
  const GAP = 8
  const lo = GAP
  const hi = box.width - w - GAP
  const t = box.top + at
  const hit = (x: number): DOMRect | undefined =>
    rects.find((r) => t < r.bottom && t + h > r.top && box.left + x < r.right && box.left + x + w > r.left)
  let x = Math.max(lo, Math.min(left, hi))
  for (let i = 0; i <= rects.length; i++) {
    const r = hit(x)
    if (!r) return x
    const right = r.right + GAP - box.left
    const leftward = r.left - GAP - w - box.left
    const near = x + w / 2 >= (r.left + r.right) / 2 - box.left
    const order = near ? [right, leftward] : [leftward, right]
    const pick = order.find((c) => c >= lo && c <= hi && !rects.some((o) => o !== r && t < o.bottom && t + h > o.top && box.left + c < o.right && box.left + c + w > o.left))
    if (pick === undefined) return null
    x = pick
  }
  return hit(x) ? null : x
}

/**
 * Where there is no free place at all (even the row of colours, nearly twice as wide as the panel, may be so): the place, of those the panel may stand
 * at (`ats`: its upper edges; sideways: as near to `left` as it goes, and beside each rectangle), where it lies on the least area of `rects`.
 */
export function leastCrowded(rects: readonly DOMRect[], box: DOMRect, w: number, h: number, left: number, ats: readonly number[]): Spot {
  const GAP = 8
  const lo = GAP
  const hi = Math.max(lo, box.width - w - GAP)
  const xs = [left, ...rects.flatMap((r) => [r.right + GAP - box.left, r.left - GAP - w - box.left])].map((x) => Math.max(lo, Math.min(x, hi)))
  let best: Spot = { left: xs[0]!, top: ats[0]! }
  let least = Infinity
  for (const top of ats) {
    for (const x of xs) {
      const t = box.top + top
      let area = 0
      for (const r of rects) {
        const dx = Math.min(box.left + x + w, r.right) - Math.max(box.left + x, r.left)
        const dy = Math.min(t + h, r.bottom) - Math.max(t, r.top)
        if (dx > 0 && dy > 0) area += dx * dy
      }
      if (area < least - 0.5) {
        least = area
        best = { left: x, top }
      }
    }
  }
  return best
}

interface Spot {
  left: number
  top: number
}

interface Point {
  left: number
  right: number
  top: number
  bottom: number
}

/** The panel over the selected text; under it when there is no room above. Hidden by Esc until the selection changes. */
export function BubbleMenu(props: BubbleMenuProps): ReactElement | null {
  const { editor, locale, container, scroller, open = null, disabled = false, delay = 120, row, topLimit, limitWatch, avoid } = props
  const rowLeaving = Boolean(row) && Boolean(props.rowLeaving)
  const hasRow = Boolean(row) && !rowLeaving
  const t = messages[locale]
  const state = useEditorState(editor)
  const ref = useRef<HTMLDivElement>(null)
  const [focused, setFocused] = useState(false)
  const [pressed, setPressed] = useState(false)
  // the panel shows for the selection (`key`) that has stood for `delay`: a new selection takes it away in the very render that brings it (no frame with the old panel at the new word)
  const [readyKey, setReadyKey] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const [spot, setSpot] = useState<Spot | null>(null)
  const [tick, setTick] = useState(0)
  // the panel stands under the word (no room above): its popups hang over it
  const [below, setBelow] = useState(false)
  // the one button of the panel that is in the Tab order (the arrows move it): the key of its `data-cmd`
  const [rove, setRove] = useState('strong')
  const mac = isMac()
  const tips = useTips(ref, open !== null || hasRow, below)
  const key = `${state.from}:${state.to}`
  const keyRef = useRef(key)
  keyRef.current = key

  // the row opens or folds up: the panel goes from its width of now to the width of what it shows next, by one transition. Its place is
  // computed once by that final width (`final`), and the observer of its size is silent while it moves, so it neither trembles nor jumps.
  const [prevRow, setPrevRow] = useState(hasRow)
  const [staleBar, setStaleBar] = useState(false)
  const [shift, setShift] = useState(0)
  const from = useRef<number | null>(null)
  const moving = useRef(false)
  const final = useRef(0)
  // the top of the panel while it moves: it stays where it was, and goes to the settled one (the other side of the word, if the row does not fit beside it) only when the motion ends
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
    // it starts from the width of now (no transition on the way there), then goes to the width it comes to
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
    const timer = setTimeout(() => setStaleBar(false), BAR_OUT_MS)
    return () => clearTimeout(timer)
  }, [staleBar, shift])

  // the selection moves while the row is open: the old panel with its row stays where it was, `inert`, and fades out (a copy of it), while the new one stands at the new word at once
  // (the copy is taken once for a row that stands: when its opening is over (`tick`) or the selection is another, not at every render)
  const snap = useRef<{ node: HTMLElement; key: string; tick: number } | null>(null)
  // the key of the selection the old panel faded out for: the new panel of that selection comes up faster (see `.bb-in-fast`)
  const movedTo = useRef<string | null>(null)
  const wantedNow = Boolean(editor) && !disabled && !state.plate && !state.empty && (focused || open !== null) && !pressed && readyKey === key && !dismissed
  useLayoutEffect(() => {
    const el = ref.current
    if (wantedNow && hasRow && el && !reducedMotion()) {
      if (!el.dataset.morph && (snap.current?.key !== key || snap.current.tick !== tick)) snap.current = { node: el.cloneNode(true) as HTMLElement, key, tick }
      return
    }
    const old = snap.current
    if (!old) return
    snap.current = null
    // (the same selection and no panel: it was hidden otherwise, nothing fades; the row folded up: its own fold)
    if (wantedNow || old.key === key || reducedMotion()) return
    movedTo.current = key
    const ghost = old.node
    ghost.classList.add('bb-ghost')
    ghost.removeAttribute('data-morph')
    ghost.setAttribute('inert', '')
    ghost.setAttribute('aria-hidden', 'true')
    ghost.querySelectorAll('.cr').forEach((r) => r.classList.add('is-leaving'))
    ghost.querySelectorAll('[tabindex]').forEach((e) => e.setAttribute('tabindex', '-1'))
    container.appendChild(ghost)
    window.setTimeout(() => ghost.remove(), BUBBLE_GHOST_MS + 30)
  })

  // focus and the mouse: the panel waits for the end of a drag
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
    // the focus may sit on the panel (reached by Alt+F10): a click outside both takes the panel away, as a click outside the text did
    const away = (event: MouseEvent): void => {
      const target = event.target as Node
      if (!ref.current?.contains(target) && !dom.contains(target)) setFocused(false)
    }
    doc.addEventListener('mousedown', away)
    dom.addEventListener('focusin', focusin)
    dom.addEventListener('focusout', focusout)
    dom.addEventListener('mousedown', down)
    doc.addEventListener('mouseup', up)
    return () => {
      doc.removeEventListener('mousedown', away)
      dom.removeEventListener('focusin', focusin)
      dom.removeEventListener('focusout', focusout)
      dom.removeEventListener('mousedown', down)
      doc.removeEventListener('mouseup', up)
    }
  }, [editor])

  // a new selection shows the panel again after a moment
  useEffect(() => {
    setDismissed(false)
    const timer = setTimeout(() => setReadyKey(key), delay)
    return () => clearTimeout(timer)
  }, [key, delay])

  const wanted =
    Boolean(editor) && !disabled && !state.plate && !state.empty && (focused || open !== null) && !pressed && readyKey === key && !dismissed

  // Esc hides the panel and leaves the selection (from a button of the panel the focus goes back to the text first)
  useEffect(() => {
    if (!wanted || !editor) return
    const doc = editor.view.dom.ownerDocument
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      if (ref.current?.contains(doc.activeElement)) editor.focus()
      setDismissed(true)
    }
    doc.addEventListener('keydown', onKey)
    return () => doc.removeEventListener('keydown', onKey)
  }, [wanted, editor])

  // the text tells that Alt+F10 leads to the panel over the selection
  useEffect(() => {
    if (!editor || disabled) return
    const dom = editor.view.dom
    dom.setAttribute('aria-keyshortcuts', 'Alt+F10')
    return () => dom.removeAttribute('aria-keyshortcuts')
  }, [editor, disabled])

  // Alt+F10 (⌥F10 on a Mac) from the text with a selection puts the focus on the panel, on the button the arrows left off. It also brings
  // the panel back after Esc and in the moment before it shows: the focus goes to it as soon as it stands
  const wantedRef = useRef(false)
  wantedRef.current = wanted
  const goal = useRef(false)
  const roveRef = useRef(rove)
  roveRef.current = rove
  const toPanel = (): void => {
    const here = ref.current?.querySelector<HTMLElement>(`[data-cmd="${roveRef.current}"]`)
    ;(here ?? ref.current?.querySelector<HTMLElement>('button'))?.focus({ preventScroll: true })
  }
  useEffect(() => {
    if (!editor || disabled || hasRow) return
    const doc = editor.view.dom.ownerDocument
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'F10' || !event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
      if (!editor.view.dom.contains(event.target as Node)) return
      const st = editor.view.state.selection
      if (st.empty || state.plate) return
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
  }, [editor, disabled, hasRow, state.plate])
  // the wish to go to the panel does not outlive the selection: it is gone with it, so a later selection does not take the focus
  useEffect(() => {
    if (state.empty) goal.current = false
  }, [state.empty])
  useEffect(() => () => {
    goal.current = false
  }, [])
  useEffect(() => {
    if (!goal.current || !wanted || !spot) return
    goal.current = false
    toPanel()
  }, [wanted, spot])

  // the panel rides with the selection when the page scrolls, and goes when the selection has left the visible part
  useEffect(() => {
    const redo = (): void => setTick((n) => n + 1)
    const win = container.ownerDocument.defaultView
    // (capture: the scroll of a table frame, .tbl-scroll, does not bubble)
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

  useLayoutEffect(() => {
    if (!wanted || !editor) {
      setSpot(null)
      setHoldTop(null)
      return
    }
    const view = editor.view
    const { from, to } = view.state.selection
    let a: Point
    let b: Point
    try {
      a = view.coordsAtPos(from)
      b = view.coordsAtPos(to)
    } catch {
      // (no layout)
      a = b = { left: 0, right: 0, top: 0, bottom: 0 }
    }
    const box = container.getBoundingClientRect()
    const area = (scroller ?? container).getBoundingClientRect()
    const top = Math.min(a.top, b.top)
    const bottom = Math.max(a.bottom, b.bottom)
    const left0 = Math.min(a.left, b.left)
    const right0 = Math.max(a.right, b.right)
    // the selection has left the visible part: up, down, or sideways (a table scrolled across)
    // inside a table the sideways edges are those of its frame (.tbl-scroll), not of the tab
    let frame: DOMRect | null
    try {
      const at = view.domAtPos(from).node
      const el = at.nodeType === 1 ? (at as Element) : at.parentElement
      frame = el?.closest('.tbl-scroll')?.getBoundingClientRect() ?? null
    } catch {
      frame = null
    }
    const edgeL = frame && frame.width > 0 ? Math.max(area.left, frame.left) : area.left
    const edgeR = frame && frame.width > 0 ? Math.min(area.right, frame.right) : area.right
    if (area.height > 0 && (bottom < area.top || top > area.bottom || (area.width > 0 && (right0 < edgeL || left0 > edgeR)))) {
      setSpot(null)
      return
    }
    const el = ref.current
    // (while it moves: the width it comes to, so the place does not change with every frame)
    const w = moving.current ? final.current : (el?.offsetWidth ?? 0)
    const h = el?.offsetHeight ?? 0
    const sameLine = Math.abs(a.top - b.top) < 4
    const mid = sameLine ? (a.left + b.right) / 2 : a.left
    const left = Math.max(8, Math.min(mid - w / 2 - box.left, box.width - w - 8))
    const above = top - box.top - h - 8
    let y = above
    const free = Math.max(area.top, topLimit?.() ?? 0)
    if (y < Math.max(0, free - box.top)) y = bottom - box.top + 8
    let x = left
    if (avoid && w > 0) {
      const rects = Array.from(avoid(), (e) => e.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0)
      const fit = (at: number): number | null => clearOf(rects, box, w, h, left, at)
      const roomAbove = above >= Math.max(0, free - box.top)
      const other = y === above ? bottom - box.top + 8 : above
      const first = fit(y)
      if (first !== null) x = first
      else {
        const second = other === above && !roomAbove ? null : fit(other)
        if (second !== null) {
          x = second
          y = other
        } else {
          // no free place on either side of the word: the one that lies on the least
          const ats = other === above && !roomAbove ? [y] : [y, other]
          const crowd = leastCrowded(rects, box, w, h, left, ats)
          x = crowd.left
          y = crowd.top
        }
      }
    }
    setSpot((prev) => (prev && prev.left === x && prev.top === y ? prev : { left: x, top: y }))
    setBelow(y > above)
  }, [wanted, editor, key, container, scroller, tick, state, hasRow])

  useEffect(() => {
    const el = wanted ? limitWatch?.() : null
    if (!el || typeof MutationObserver === 'undefined') return
    const watch = new MutationObserver(() => setTick((n) => n + 1))
    watch.observe(el, { attributes: true, attributeFilter: ['style'] })
    return () => watch.disconnect()
  }, [wanted, limitWatch])

  // the handle of a block comes and goes with the mouse: the panel is placed again (not for its own changes)
  const watchesAvoid = Boolean(avoid)
  useEffect(() => {
    if (!wanted || !watchesAvoid || typeof MutationObserver === 'undefined') return
    const watch = new MutationObserver((records) => {
      // (not the panel itself, and not the text: it is the other things of the tab that come and go)
      const text = editor?.view.dom
      if (records.some((r) => !ref.current?.contains(r.target) && !(text && text.contains(r.target)))) setTick((n) => n + 1)
    })
    watch.observe(container, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'hidden'] })
    return () => watch.disconnect()
  }, [wanted, watchesAvoid, container, editor])

  // the row of colours opens and closes (the panel gets wider or narrower): it is placed again by the new width. The name under the mouse does not change the width (the block of the name has one width)
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

  if (!editor || !wanted) return null
  // the buttons stay (fading, `inert`) while the row opens over them; the row stays while it folds up
  const showBar = !hasRow || staleBar
  const run = (command: (e: VisualEditor) => unknown, keyboard = false): void => {
    props.onBeforeCommand?.()
    command(editor)
    // by the keys the focus stays on the button (more marks in a row); by the mouse the cursor stays in the text
    if (!keyboard) editor.focus()
  }
  const tp = t.tips
  const tabs = (cmd: string): number => (cmd === rove ? 0 : -1)
  // the arrows, Home and End go through the buttons of the panel; the row of colours has its own keys
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (hasRow) return
    const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End']
    if (!keys.includes(event.key)) return
    const buttons = Array.from(ref.current?.querySelectorAll<HTMLElement>('.bb-layer.bar button') ?? [])
    const at = buttons.indexOf(event.target as HTMLElement)
    if (at < 0) return
    event.preventDefault()
    const to = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : Math.max(0, Math.min(buttons.length - 1, at + (event.key === 'ArrowRight' ? 1 : -1)))
    buttons[to]?.focus({ preventScroll: true })
  }
  return (
    <div
      ref={ref}
      className={`fl bubble${hasRow ? ' has-row' : ''}${rowLeaving ? ' is-folding' : ''}${movedTo.current === key ? ' bb-in-fast' : ''}`}
      role="toolbar"
      aria-label={t.bubble}
      style={{ left: `${spot?.left ?? 0}px`, top: `${holdTop ?? spot?.top ?? 0}px`, visibility: spot && (open === null || hasRow) ? 'visible' : 'hidden' }}
      onMouseDown={keepSelection}
      onKeyDown={onKeyDown}
      onBlur={(event) => {
        // Tab away from the panel to another place: the panel goes (to the text, to a window of it: it stays)
        const next = event.relatedTarget as Node | null
        if (next && !event.currentTarget.contains(next) && !editor.view.dom.contains(next) && open === null) setFocused(false)
      }}
      onFocus={(event) => {
        const cmd = (event.target as HTMLElement).closest('button')?.getAttribute('data-cmd')
        if (cmd && !hasRow) setRove(cmd)
      }}
    >
      {showBar && (<div className={`bb-layer bar${hasRow ? ' is-out' : ''}`} {...(hasRow ? { inert: true, 'aria-hidden': true } : {})}>
      {BUTTONS.map((b) => (
        <button
          key={b.key}
          type="button"
          data-cmd={b.key}
          tabIndex={tabs(b.key)}
          aria-pressed={state.marks[b.key]}
          aria-label={t[b.label]}
          {...tips.bind(b.key, { name: t[b.label], text: tp[MARK_TIP[b.key]], keys: [keyLabel(b.keys.key, mac, 'shift' in b.keys ? { shift: true } : {})] })}
          onClick={(e) => run((ed) => ed.commands.toggleMark(b.key), e.detail === 0)}
        >
          <MarkGlyph mark={b.key} />
        </button>
      ))}
      <span className="fl-sep" />
      <ColorButton
        kind="color"
        className="b-fmt"
        label={t.textColor}
        name={state.textColor ? t.colors[state.textColor] : undefined}
        role={state.textColor}
        disabled={false}
        expanded={open === 'color'}
        tabIndex={tabs('color')}
        tip={tips.bind('color', { name: state.textColor ? `${t.textColor}: ${t.colors[state.textColor]}` : t.textColor, text: tp.color })}
        onPress={(a, k) => (props.onBeforeCommand?.(), props.onColor('color', a, k))}
      />
      <ColorButton
        kind="fill"
        className="b-fmt"
        label={t.fill}
        name={state.fill ? t.fills[state.fill] : undefined}
        role={state.fill}
        disabled={false}
        expanded={open === 'fill'}
        tabIndex={tabs('fill')}
        tip={tips.bind('fill', { name: state.fill ? `${t.fill}: ${t.fills[state.fill]}` : t.fill, text: tp.fill })}
        onPress={(a, k) => (props.onBeforeCommand?.(), props.onColor('fill', a, k))}
      />
      <span className="fl-sep" />
      <button
        type="button"
        data-cmd="link"
        tabIndex={tabs('link')}
        aria-haspopup="dialog"
        aria-expanded={open === 'link'}
        aria-pressed={state.marks.link}
        aria-label={t.link}
        {...tips.bind('link', { name: t.link, text: tp.link })}
        onClick={(e) => {
          props.onBeforeCommand?.()
          props.onLink(e.currentTarget)
        }}
      >
        <LinkIcon />
      </button>
      </div>)}
      {row && (<div className={`bb-layer row${rowLeaving ? ' is-out' : ''}`} {...(rowLeaving ? { inert: true, 'aria-hidden': true } : {})}>{row}</div>)}
      {tips.node}
    </div>
  )
}
