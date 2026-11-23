import type { CSSProperties, ReactElement } from 'react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Locale } from './locale.js'
import { messages } from './messages.js'
import { placeBelow } from './place.js'
import { CELL_FILL_ROLES, FILL_ROLES, ROLE_VAR, TEXT_COLOR_ROLES } from './roles.js'

export interface ColorPopoverProps {
  locale: Locale
  /** `color`: the letters; `fill`: the fill behind the text; `cell`: the fill of the cell (or of the selected cells). */
  kind: 'color' | 'fill' | 'cell'
  /** The button that opened the window: it is placed under it, and a press on it is not «elsewhere». */
  anchor: HTMLElement | null
  /** The element the window is placed in (it is `position: relative`). */
  container: HTMLElement
  /** The roles of the whole selection: the pressed swatch (for `cell`: the fill of the cell, if any). */
  roles: readonly string[]
  /** `cell`: how many cells get the fill, whether their fills differ, and how the cell is spanned (`2+`). */
  cells?: { count: number; mixed: boolean; span: string }
  /** Opened by the keyboard: the focus goes into the window. */
  keyboard?: boolean
  /** The window is closed and only fades out: it listens to no keys and no clicks. */
  leaving?: boolean
  /**
   * no window. The swatches stand in a row in place of the row they were opened from (`table`: the row «Таблица» of the
   * capsule, `bar`: the buttons of the panel over the selection). «‹» and Esc call `onBack`
   * (the row of buttons comes back, the focus goes to the button it was opened from), a pick or a click elsewhere call `onPick` and `onClose`.
   */
  row?: { back: 'table' | 'bar'; onBack(): void }
  /** A swatch was chosen (`null`: no colour, no fill); the window closes. */
  onPick(role: string | null): void
  /** Esc (restore: the cursor goes back to the text) or a click elsewhere. */
  onClose(restore: boolean): void
}

/**
 * Every name the block of the name can show, in all three rows: they stand invisibly in one cell of a grid (their text comes from `data-t`, so it is not
 * in the text of the row), so the block is as wide as the longest of them in the font and the language of the tab, and nothing moves when the name changes.
 */
const NAME_GHOSTS = (t: (typeof messages)[Locale]): string[] => [
  ...new Set([...Object.values(t.colors), ...Object.values(t.fills), ...Object.values(t.cellFills), t.noColor, t.noFill, t.noCellFill, t.cellFillMixed]),
]

const FAMILY = { color: TEXT_COLOR_ROLES, fill: FILL_ROLES, cell: CELL_FILL_ROLES } as const

/** The window of «Цвет текста», «Заливка» and «Заливка ячейки»: swatches, and the name of the one chosen. */
export function ColorPopover(props: ColorPopoverProps): ReactElement {
  const { locale, kind, anchor, container, roles, onPick, onClose } = props
  const t = messages[locale]
  const ref = useRef<HTMLDivElement>(null)
  const family = FAMILY[kind]
  const cells = props.cells
  const mixed = kind === 'cell' && Boolean(cells?.mixed)
  const title = kind === 'color' ? t.textColor : kind === 'fill' ? t.fill : cells && cells.count > 1 ? t.cellFillMany(cells.count) : t.cellFill
  const names = kind === 'color' ? t.colors : kind === 'fill' ? t.fills : t.cellFills
  const none = kind === 'color' ? t.noColor : kind === 'fill' ? t.noFill : props.row ? t.noCellFill : t.noFill
  const inFamily = roles.find((r) => family.includes(r))
  // a letter role not in the registry (`hl-cyan`): no swatch is pressed, not even «Без цвета»
  const foreign = kind === 'color' && !inFamily && roles.some((r) => r.startsWith('hl-') && !r.endsWith('-bg'))
  const current = mixed || foreign ? undefined : (inFamily ?? null)
  const swatches: (string | null)[] = [null, ...family]
  // the swatch the keys are on: the current one, else the first
  const [active, setActive] = useState(Math.max(0, swatches.indexOf(current === undefined ? null : current)))
  // the keys work the window (opened by them, or an arrow was pressed): only then the focus ring is drawn
  const [kb, setKb] = useState(Boolean(props.keyboard))
  // an arrow was pressed: only then the name follows the keys (opened by the keyboard on «Разная» or on a colour not in the registry, the name is still that of the choice)
  const [moved, setMoved] = useState(false)

  const row = props.row
  const [hover, setHover] = useState<number | null>(null)
  useLayoutEffect(() => {
    if (!row && ref.current && anchor) placeBelow(ref.current, anchor, container)
  }, [anchor, container, kind, row])

  useEffect(() => {
    // by the mouse the text keeps the cursor; by the keyboard the focus goes to the swatches
    if (props.keyboard)
      (ref.current?.querySelector<HTMLButtonElement>('.sw-b[aria-pressed="true"]') ?? ref.current?.querySelector<HTMLButtonElement>('.sw-b'))?.focus({
        preventScroll: true,
      })
  }, [props.keyboard])

  const backRef = useRef(row?.onBack)
  backRef.current = row?.onBack
  const pickRef = useRef(onPick)
  pickRef.current = onPick
  const activeRef = useRef(active)
  activeRef.current = active

  const leaving = Boolean(props.leaving)
  useEffect(() => {
    if (leaving) return
    const doc = ref.current!.ownerDocument
    const down = (event: MouseEvent): void => {
      const target = event.target as Node
      if (!ref.current?.contains(target) && !anchor?.contains(target)) onClose(false)
    }
    const key = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        if (backRef.current) backRef.current()
        else onClose(true)
        return
      }
      // in the row, a key with a modifier pressed in the text of the editor is the user's (Shift+arrows widen the selection)
      if (row && (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) && !ref.current?.contains(event.target as Node)) return
      const last = swatches.length - 1
      let to: number | null = null
      if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') to = Math.max(0, activeRef.current - 1)
      else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') to = Math.min(last, activeRef.current + 1)
      else if (event.key === 'Home') to = 0
      else if (event.key === 'End') to = last
      if (to !== null) {
        event.preventDefault()
        event.stopPropagation()
        setActive(to)
        setKb(true)
        setMoved(true)
        ref.current?.querySelectorAll<HTMLButtonElement>('.sw-b')[to]?.focus({ preventScroll: true })
      } else if (event.key === 'Enter' && !event.isComposing) {
        event.preventDefault()
        event.stopPropagation()
        pickRef.current(swatches[activeRef.current] ?? null)
      }
    }
    doc.addEventListener('mousedown', down)
    doc.addEventListener('keydown', key, true)
    return () => {
      doc.removeEventListener('mousedown', down)
      doc.removeEventListener('keydown', key, true)
    }
  }, [anchor, onClose, kind, leaving])

  const swatch = (role: string | null, i: number): ReactElement => {
    const label = role === null ? none : names[role]!
    const pressed = current === undefined ? false : role === null ? current === null : current === role
    return (
      <button
        key={role ?? 'none'}
        type="button"
        className={`sw-b${row ? ` dot${kind === 'color' || role === null ? '' : ' fill'}${role === null ? ' none' : ''}` : ''}${i === active ? ' is-active' : ''}`}
        {...(row ? { style: { ...(role !== null ? { '--c': `var(${ROLE_VAR[role]})` } : {}), '--i': i } as CSSProperties } : {})}
        data-role={role ?? ''}
        aria-label={label}
        aria-pressed={pressed}
        {...(row ? {} : { title: label })}
        onFocus={() => setActive(i)}
        onMouseEnter={() => setHover(i)}
        onMouseLeave={() => setHover((h) => (h === i ? null : h))}
        onMouseMove={() => kb && setKb(false)}
        onClick={() => {
          // a row that folds up (it only fades out) applies nothing
          if (!props.leaving) onPick(role)
        }}
      >
        {row ? null : role === null ? (
          <span className="sw-none" />
        ) : (
          <span className="sw-r" style={kind === 'color' ? { color: `var(${ROLE_VAR[role]})` } : { background: `var(${ROLE_VAR[role]})` }}>
            A
          </span>
        )}
      </button>
    )
  }

  // the name of what is chosen: «Разная» for cells of different fills, nothing for a colour not in the registry
  const currentName = mixed ? t.cellFillMixed : current === undefined ? '' : current === null ? none : names[current]!
  if (row) {
    const nameOf = (i: number): string => (swatches[i] === null ? none : names[swatches[i]!]!)
    // the circle under the mouse, or under the keys, else the pressed one: its name
    const at = hover !== null ? hover : kb ? active : null
    const shown = at !== null ? nameOf(at) : current === undefined ? '' : nameOf(Math.max(0, swatches.indexOf(current)))
    const nameAt = hover !== null ? hover : kb && moved ? active : null
    const nameText = nameAt !== null ? nameOf(nameAt) : currentName
    const hovered = hover !== null || (kb && !props.leaving)
    const label = kind === 'color' ? t.rowColor : kind === 'fill' ? t.fill : title
    return (
      <div
        ref={ref}
        className={`cr${kb ? ' kb' : ''}${props.leaving ? ' is-leaving' : ''}`}
        role="group"
        aria-label={title}
        data-kind={kind}
        data-mode="row"
        {...(hovered ? { 'data-hover': '' } : {})}
        onMouseDown={(e) => {
          if ((e.target as Element).closest('button')) e.preventDefault()
        }}
      >
        <button type="button" className="cr-back" aria-label={row.back === 'bar' ? t.backToBar : t.backToTable} onClick={row.onBack}>
          <span aria-hidden="true">‹</span>
          {row.back === 'table' && <span className="cr-back-t">{t.tableBar.label}</span>}
        </button>
        <span className="cr-sep" aria-hidden="true" />
        <span className="cr-title">
          <span className="cr-t-def">{label}</span>
          <span className="cr-t-hov">{shown || label}</span>
        </span>
        <div className="cr-sw" role="group" aria-label={title}>
          {swatches.map(swatch)}
        </div>
        <span className="cr-name">
          <span className="cr-name-t">{nameText}</span>
          {NAME_GHOSTS(t).map((g) => (
            <span key={g} className="cr-ghost" aria-hidden="true" data-t={g} />
          ))}
        </span>
      </div>
    )
  }
  return (
    <div
      ref={ref}
      className={`pop fmtpop${kb ? ' kb' : ''}`}
      role="dialog"
      aria-label={title}
      data-kind={kind}
      onMouseDown={(e) => {
        if ((e.target as Element).closest('button')) e.preventDefault()
      }}
    >
      <div className="fp-head">
        <b>{title}</b>
      </div>
      <div className="fp-row" role="group" aria-label={title}>
        {swatches.map(swatch)}
      </div>
      <div className="fp-foot">
        <span className="fp-src">{currentName}</span>
      </div>
    </div>
  )
}
