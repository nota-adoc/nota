import type { VisualEditor } from '@nota-adoc/prosemirror'
import type { CSSProperties, KeyboardEvent, MouseEvent, ReactElement } from 'react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Locale } from './locale.js'
import { messages } from './messages.js'
import { useEditorState } from './useEditorState.js'

export const ADMONITION_TYPES = ['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION'] as const
export type AdmonitionType = (typeof ADMONITION_TYPES)[number]

export interface AdmonitionPickerProps {
  editor: VisualEditor
  locale: Locale
  /** The element the picker is placed in (it is `position: relative`), and the one that scrolls under it. */
  container: HTMLElement
  scroller?: HTMLElement
  /** The lower edge of what covers the top of the scroller (the row of capsules), in the coordinates of the window. */
  topLimit?: () => number
  /** The type of the admonition the cursor is in. */
  variant: string
  /** Called before a command: the message of an earlier refusal goes away. */
  onBeforeCommand?(): void
  /** Alt+F10 was pressed in the text of the admonition: open the row now. */
  wish?: boolean
  /** The wish was taken. */
  onWished?(): void
}

type Phase = 'closed' | 'opening' | 'open' | 'closing'

interface Spot {
  left: number
  top: number
  width: number
  height: number
  /** The form of the block: `NOTE:` (the word, a dot) or the head of `====` (the word, the arrow). */
  para: boolean
  font: CSSProperties
}

/** The widest tab that gets the narrow row: the icons and the word of the type under the mouse or the focus. */
const NARROW = 650
const CLOSE_MS = 170

const SVG_PATHS: Record<AdmonitionType, string[]> = {
  NOTE: ['M8 7.2v4'],
  TIP: ['M6 12.8h4M6.6 14.6h2.8M8 1.6a4.2 4.2 0 00-2.5 7.6c.6.4.9 1 .9 1.8h3.2c0-.8.3-1.4.9-1.8A4.2 4.2 0 008 1.6z'],
  IMPORTANT: ['M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.5l-3.8 2.1.7-4.3-3.1-3 4.3-.6z'],
  WARNING: ['M8 2.2l6.2 11H1.8z', 'M8 6.4v3.2'],
  CAUTION: ['M5.5 1.8h5l3.7 3.7v5l-3.7 3.7h-5l-3.7-3.7v-5z', 'M8 5v3.6'],
}
const DOTS: Record<AdmonitionType, [number, number][]> = { NOTE: [[8, 5]], TIP: [], IMPORTANT: [], WARNING: [[8, 11.4]], CAUTION: [[8, 11]] }

function TypeIcon(props: { type: AdmonitionType }): ReactElement {
  const { type } = props
  return (
    <svg className="adm-pk-i" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      {type === 'NOTE' && <circle cx="8" cy="8" r="6" />}
      {SVG_PATHS[type].map((d) => (
        <path key={d} d={d} />
      ))}
      {DOTS[type].map(([x, y]) => (
        <circle key={`${x}:${y}`} cx={x} cy={y} r="1" fill="currentColor" stroke="none" />
      ))}
    </svg>
  )
}

const reduced = (win: Window | null): boolean => Boolean(win?.matchMedia?.('(prefers-reduced-motion: reduce)').matches)

/** The label of the block the cursor is in (its icon and its word), or null. */
function labelOf(editor: VisualEditor, form: 'paragraph' | 'block'): { ico: Element; lbl: Element } | null {
  const node = editor.view.domAtPos(editor.view.state.selection.head).node
  const from = node.nodeType === 1 ? (node as Element) : node.parentElement
  let root: Element | null | undefined = from?.closest(form === 'paragraph' ? '.adm-para' : '.box-adm')
  if (form === 'block') while (root && !root.classList.contains('adm-head')) root = root.previousElementSibling
  if (!root) return null
  const ico = root.querySelector('.adm-ico')
  const lbl = root.querySelector('.adm-lbl')
  return ico && lbl ? { ico, lbl } : null
}

/**
 * The type of the admonition the cursor is in. The label of the block (its icon and word) is the button: a layer over it, in the frame of
 * the block, shows the same label. A press opens a row of the five types in place of the label (it grows from the label to the right), a
 * type picked or Esc folds it back. Alt+F10 from the text opens it with the focus on the current type. The row lies on the first line of
 * the block, so nothing around the block is covered, and no node of the document moves.
 */
export function AdmonitionPicker(props: AdmonitionPickerProps): ReactElement | null {
  const { editor, locale, container, scroller, variant, wish, onWished, onBeforeCommand, topLimit } = props
  const t = messages[locale]
  const state = useEditorState(editor)
  const ref = useRef<HTMLDivElement>(null)
  const trigRef = useRef<HTMLButtonElement>(null)
  const rowRef = useRef<HTMLDivElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [phase, setPhase] = useState<Phase>('closed')
  const [spot, setSpot] = useState<Spot | null>(null)
  const [rowWidth, setRowWidth] = useState(0)
  const [narrow, setNarrow] = useState(false)
  const [hot, setHot] = useState<string>(variant)
  const [wantFocus, setWantFocus] = useState(false)
  // the ring of the focus only when the row is worked with the keys (a press of the mouse puts it out, as `.kb` does for the colours)
  const [kb, setKb] = useState(false)
  const pressed = useRef(false)
  const key = `${state.from}:${state.to}`
  const current = (ADMONITION_TYPES as readonly string[]).includes(variant) ? (variant as AdmonitionType) : 'NOTE'
  const win = container.ownerDocument.defaultView

  useEffect(() => () => clearTimeout(timer.current), [])

  // the latest of what the measure reads: the loop of the frames below lives longer than one render
  const live = useRef({ editor, container, scroller, win, topLimit })
  live.current = { editor, container, scroller, win, topLimit }
  const applied = useRef<Spot | null>(null)
  const looked = useRef<{ ico: Element; lbl: Element; doc: unknown; head: number; form: string; font: Spot['font'] | undefined } | null>(null)

  /** Where the layer stands now; null: no label or out of the window (hidden). */
  const measure = (): Spot | null => {
    const { editor: ed, container: layer, scroller: scrolled, win: w, topLimit: limitOf } = live.current
    const form = ed.admonitionAt()?.form
    // (the label is looked up again only when the document or the cursor has moved, or its node has gone)
    const st = ed.view.state
    let found = looked.current
    if (!form) {
      looked.current = null
      return null
    }
    if (!found || found.doc !== st.doc || found.head !== st.selection.head || found.form !== form || !found.ico.isConnected || !found.lbl.isConnected) {
      const hit = labelOf(ed, form)
      found = hit ? { ...hit, doc: st.doc, head: st.selection.head, form, font: undefined } : null
      looked.current = found
    }
    if (!found) return null
    const a = found.ico.getBoundingClientRect()
    const b = found.lbl.getBoundingClientRect()
    if (b.width === 0 && b.height === 0) {
      // (no layout: where the container starts)
      return { left: 8, top: 8, width: 120, height: 26, para: form === 'paragraph', font: {} }
    }
    const area = (scrolled ?? layer).getBoundingClientRect()
    // (the row of capsules lies over the top of the scroller: a block that has gone under it is out of sight)
    const limit = Math.max(area.top, limitOf?.() ?? 0)
    // (the head of the block under the capsules: the button is hidden, not pressed to them, it would stand still while the text goes by)
    if (area.height > 0 && (b.top - 2 < limit || b.top > area.bottom)) return null
    const box = layer.getBoundingClientRect()
    const para = form === 'paragraph'
    const height = para ? 32 : 26
    // (the font is read once for a label)
    if (found.font === undefined && w) {
      const cs = w.getComputedStyle(found.lbl)
      found.font = {
        fontFamily: cs.fontFamily,
        fontSize: cs.fontSize,
        fontWeight: cs.fontWeight,
        letterSpacing: cs.letterSpacing,
        textTransform: cs.textTransform as CSSProperties['textTransform'],
      }
    }
    const cy = (b.top + b.bottom) / 2
    // the layer stays inside the container: a block whose label is at the lower edge does not make the page scroll
    let top = cy - height / 2 - box.top
    if (box.height > 0) top = Math.min(top, box.height - height - 4)
    return {
      left: a.left - 6 - box.left,
      top,
      width: b.right - a.left + 12 + (para ? 0 : 16),
      height,
      para,
      font: found.font ?? {},
    }
  }
  const same = (x: Spot | null, y: Spot | null): boolean =>
    x === null || y === null
      ? x === y
      : Math.abs(x.left - y.left) < 0.01 &&
        Math.abs(x.top - y.top) < 0.01 &&
        Math.abs(x.width - y.width) < 0.01 &&
        x.para === y.para &&
        x.font.fontSize === y.font.fontSize &&
        x.font.fontFamily === y.font.fontFamily &&
        x.font.fontWeight === y.font.fontWeight
  /** Puts the layer there at once (the style is written by hand: the render of React comes a task later) and tells the state. */
  const put = (next: Spot | null): void => {
    const el = ref.current
    if (el && next) {
      el.style.left = `${next.left}px`
      el.style.top = `${next.top}px`
    }
    // (out of sight: hidden in this very frame, the render that takes it away comes a task later)
    if (el && !next) el.style.visibility = 'hidden'
    applied.current = next
    setSpot(next)
  }

  // the cursor moves, the type changes: the place is found before the frame is drawn
  useLayoutEffect(() => {
    const next = measure()
    if (!same(next, applied.current) || (next !== null && !spot)) put(next)
  })

  // the layer sits outside what scrolls, so its place is read in every frame, before the frame is drawn: the scroll, the size of the tab, an image
  // that has come above, the height of an island or of the row of capsules move the label with no transaction, and the layer goes with it
  useEffect(() => {
    if (!win || typeof win.requestAnimationFrame !== 'function') return
    let id = 0
    const tick = (): void => {
      const next = measure()
      if (!same(next, applied.current)) put(next)
      id = win.requestAnimationFrame(tick)
    }
    id = win.requestAnimationFrame(tick)
    return () => win.cancelAnimationFrame(id)
  }, [win])

  const clear = (): void => clearTimeout(timer.current)
  const fold = (focusText: boolean): void => {
    clear()
    pressed.current = false
    if (focusText) editor.focus()
    if (phase === 'closed') return
    if (reduced(win)) {
      setPhase('closed')
      return
    }
    setPhase('closing')
    timer.current = setTimeout(() => setPhase('closed'), CLOSE_MS + 20)
  }
  const unfold = (withFocus: boolean, keys: boolean): void => {
    if (!spot) return
    clear()
    setKb(keys)
    onBeforeCommand?.()
    setNarrow(container.getBoundingClientRect().width <= NARROW)
    setHot(current)
    setWantFocus(withFocus)
    setPhase('opening')
  }

  // the row stands at the width of the label for one frame, then grows (the width is measured from the row itself)
  useLayoutEffect(() => {
    if (phase !== 'opening') return
    const inner = rowRef.current?.firstElementChild as HTMLElement | null
    setRowWidth(inner ? inner.scrollWidth + 2 : (spot?.width ?? 0))
    void rowRef.current?.offsetWidth
    setPhase('open')
  }, [phase, spot])

  // the focus goes to the current type as soon as the row stands
  useEffect(() => {
    if (phase !== 'open' || !wantFocus) return
    setWantFocus(false)
    rowRef.current?.querySelector<HTMLElement>(`[data-type="${current}"]`)?.focus({ preventScroll: true })
  }, [phase, wantFocus, current])

  // Alt+F10
  useEffect(() => {
    if (!wish) return
    if (!spot) {
      // the label is out of sight: bring it in; if it does not come, the wish is dropped (it must not wait for a later scroll)
      const form = editor.admonitionAt()?.form
      const found = form ? labelOf(editor, form) : null
      ;(found?.lbl as HTMLElement | undefined)?.scrollIntoView?.({ block: 'nearest' })
      const drop = setTimeout(() => onWished?.(), 400)
      return () => clearTimeout(drop)
    }
    onWished?.()
    unfold(true, true)
  }, [wish, spot])

  // the cursor moves, the block leaves the window: the row folds
  useEffect(() => {
    if (phase !== 'closed') fold(false)
  }, [key])
  useEffect(() => {
    if (!spot && phase !== 'closed') {
      clear()
      setPhase('closed')
    }
  }, [spot])

  // a press outside the row folds it
  useEffect(() => {
    if (phase !== 'open' && phase !== 'opening') return
    const doc = container.ownerDocument
    const onDown = (event: globalThis.MouseEvent): void => {
      if (!ref.current?.contains(event.target as Node)) fold(false)
    }
    doc.addEventListener('mousedown', onDown, true)
    return () => doc.removeEventListener('mousedown', onDown, true)
  }, [phase, container])

  // what is folded away or being folded cannot be pressed
  useEffect(() => {
    const row = rowRef.current
    if (row) row.inert = phase === 'closing'
    if (trigRef.current) trigRef.current.inert = phase === 'opening' || phase === 'open'
  }, [phase])

  const pick = (v: AdmonitionType): void => {
    if (v !== current) {
      onBeforeCommand?.()
      editor.commands.setAdmonitionType(v)
    }
    fold(true)
  }

  const move = (to: AdmonitionType): void => {
    rowRef.current?.querySelector<HTMLElement>(`[data-type="${to}"]`)?.focus({ preventScroll: true })
    setHot(to)
  }
  const onRowKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    const target = (event.target as Element).closest<HTMLElement>('[data-type]')
    const at = ADMONITION_TYPES.indexOf((target?.dataset.type ?? current) as AdmonitionType)
    const n = ADMONITION_TYPES.length
    let to: number | null = null
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        to = (at + 1) % n
        break
      case 'ArrowLeft':
      case 'ArrowUp':
        to = (at + n - 1) % n
        break
      case 'Home':
        to = 0
        break
      case 'End':
        to = n - 1
        break
      case 'Escape':
      case 'Tab':
        event.preventDefault()
        event.stopPropagation()
        fold(true)
        return
      default: {
        if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) return
        const letter = event.key.toLocaleLowerCase(locale)
        for (let i = 1; i <= n; i++) {
          const j = (at + i) % n
          if (t.admonitions[ADMONITION_TYPES[j]!].toLocaleLowerCase(locale).startsWith(letter)) {
            to = j
            break
          }
        }
        if (to === null) return
      }
    }
    event.preventDefault()
    setKb(true)
    move(ADMONITION_TYPES[to]!)
  }

  if (!spot) return null
  const name = `${t.admonitionType}: ${t.admonitions[current]}`
  const open = phase === 'open'
  const style: CSSProperties = {
    left: `${spot.left}px`,
    top: `${spot.top}px`,
    height: `${spot.height}px`,
    width: `${open ? Math.max(rowWidth, spot.width) : spot.width}px`,
  }
  return (
    <div
      ref={ref}
      className={`blockbar admpick${kb ? ' kb' : ''}`}
      data-cmd-bar="admonition"
      data-phase={phase}
      data-form={spot.para ? 'para' : 'block'}
      data-variant={current}
      style={style}
      onMouseDown={(event) => {
        pressed.current = true
        setKb(false)
        keepSelection(event)
      }}
    >
      <button
        ref={trigRef}
        type="button"
        className="adm-trig"
        data-cmd="admonition"
        aria-label={name}
        aria-expanded={phase === 'open' || phase === 'opening'}
        onClick={() => {
          // (a click with no press of the mouse before it is the keyboard's)
          unfold(true, !pressed.current)
          pressed.current = false
        }}
        style={spot.font}
      >
        <TypeIcon type={current} />
        <span className="adm-trig-w">{`${t.admonitions[current]}${spot.para ? '.' : ''}`}</span>
        {!spot.para && (
          <svg className="adm-trig-c" viewBox="0 0 10 10" width="10" height="10" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 3.5L5 6.5 8 3.5" />
          </svg>
        )}
      </button>
      {phase !== 'closed' && (
        <div ref={rowRef} className="adm-row" data-narrow={narrow ? 'true' : 'false'} data-phase={phase} onKeyDown={onRowKey}>
          <div className="adm-row-in" role="radiogroup" aria-label={t.admonitionType} onMouseLeave={() => setHot(current)}>
            {ADMONITION_TYPES.map((v, i) => (
              <button
                key={v}
                type="button"
                role="radio"
                className="adm-opt"
                data-type={v}
                data-variant={v}
                aria-checked={v === current}
                aria-label={t.admonitions[v]}
                tabIndex={v === current ? 0 : -1}
                style={{ '--i': i } as CSSProperties}
                onClick={() => pick(v)}
                onMouseEnter={() => setHot(v)}
                onFocus={() => setHot(v)}
              >
                <TypeIcon type={v} />
                {!narrow && <span className="adm-opt-w">{t.admonitions[v]}</span>}
              </button>
            ))}
            {narrow && (
              <span className="adm-opt-name" aria-hidden="true" data-variant={hot}>
                {t.admonitions[(hot as AdmonitionType) in SVG_PATHS ? (hot as AdmonitionType) : current]}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/** A press on a button must not take the cursor from the text. */
const keepSelection = (event: MouseEvent): void => {
  if ((event.target as Element).closest('button')) event.preventDefault()
}
