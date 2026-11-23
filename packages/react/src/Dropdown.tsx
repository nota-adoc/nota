import type { KeyboardEvent, ReactElement, ReactNode } from 'react'
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { CheckIcon, ChevronIcon } from './icons.js'
import { ariaKeys, type TipBind } from './Tooltip.js'

export interface DropdownItem {
  value: string
  label: string
  /** A mark before the label (the colour of a type). */
  icon?: ReactNode
  /** The keys of the item, as a label (`⌘⌥2`, `Ctrl+Alt+2`): shown at the right, dimmed, and given as `aria-keyshortcuts`. Typing the first letters goes by `label` only. */
  keys?: string
  /** A dimmed note after the label (`пропускает уровень`): seen, and given as `aria-description` of the item. */
  note?: string
}

export interface DropdownProps {
  items: readonly DropdownItem[]
  /** The value of the current item (it has the tick), or null when none of the items is current. */
  value: string | null
  /** The name of the list (`aria-label`). */
  label: string
  /** The line over the items, if any. */
  heading?: string
  /** The hint of the button. */
  title?: string
  /** The name of the button for a screen reader, when the text on it (the current item) is not enough. */
  ariaLabel?: string
  /** What the button shows, before the chevron. */
  children: ReactNode
  className?: string
  /** A class of the element around the button and the list. */
  wrapClass?: string
  /** The `data-cmd` of the button. */
  cmd?: string
  disabled?: boolean
  /** Only the native `disabled` of the button, apart from `disabled` (which dims it and keeps it in reach): the mode «Текст». */
  hardDisabled?: boolean
  /** The popup of the button: with it the button has no `title`. */
  tip?: TipBind
  /** The list opened or closed. */
  onOpenChange?(open: boolean): void
  /** The place of the button is out of sight (the block went under the capsules or off the edge): an open list is closed. */
  away?: boolean
  /** The list opens above the button when there is no room under it (the corner of a block); else it always opens down. */
  flip?: boolean
  /** The layer the list must stay in (the edges of the tab); by default the layer a panel around the button hangs in, else the window of the browser. */
  bounds?: () => HTMLElement | null
  /** The line the list may not go over (the lower edge of the capsules), in the coordinates of the window. */
  topLimit?: () => number
  /** An item was chosen; the list is closed. */
  onPick(value: string): void
  /** Called before the list opens (the message of an earlier refusal goes away). */
  onOpen?(): void
  /** The list was closed with Esc: the focus is on the button. */
  onEscape?(): void
}

/** How long a typed prefix is kept, in ms. */
const TYPING = 600

/**
 * The one drop-down of the package: a button and a list under it. The button has `aria-haspopup="listbox"` and `aria-expanded`, the
 * list `role="listbox"` and the items `role="option"`, the active one is `aria-activedescendant`. The keys: arrows, Home, End,
 * PageUp, PageDown, the first letters, Enter and Space to choose, Esc and Tab to close.
 */
export function Dropdown(props: DropdownProps): ReactElement {
  const { items, value, flip = false } = props
  const id = useId()
  const wrap = useRef<HTMLSpanElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  // the list stays in the page after the first opening: it is hidden by the style sheet, so that it can fade out
  const [shown, setShown] = useState(false)
  const [active, setActive] = useState(0)
  // the keys work the list (it was opened by them, or a key moved in it): the item under the cursor gets a thin frame
  const [kb, setKb] = useState(false)
  const [place, setPlace] = useState<{ right: boolean; up: boolean }>({ right: false, up: false })
  const typed = useRef<{ text: string; at: number }>({ text: '', at: 0 })
  const optionId = (i: number): string => `${id}-o${i}`

  const close = (): void => setOpen(false)
  const show = (): void => {
    if (props.disabled) return
    props.onOpen?.()
    const current = items.findIndex((i) => i.value === value)
    setActive(current < 0 ? 0 : current)
    typed.current = { text: '', at: 0 }
    setShown(true)
    setOpen(true)
  }

  // the place: under the button; at its right edge when the tab ends before the list does; above it when there is no room (`flip`);
  // squeezed, with a scroll of its own, when it fits on neither side: it never goes out of the layer and never makes the page scroll
  const bounds = props.bounds
  const topLimit = props.topLimit
  useLayoutEffect(() => {
    if (!open || !list.current || !wrap.current) return
    const el = list.current
    const doc = wrap.current.ownerDocument
    const win = doc.defaultView
    const at = wrap.current.getBoundingClientRect()
    // the layer: given; else the one the window of the list hangs in (a panel over a block is placed in the layer of the editor)
    const host = bounds ? bounds() : (wrap.current.closest<HTMLElement>('.fl, .pop')?.offsetParent as HTMLElement | null | undefined)
    const layer = host?.getBoundingClientRect()
    el.style.maxHeight = ''
    const w = el.offsetWidth
    const h = el.offsetHeight
    const width = Math.min(doc.documentElement.clientWidth || win?.innerWidth || 0, layer && layer.width > 0 ? layer.right : Infinity)
    const height = Math.min(doc.documentElement.clientHeight || win?.innerHeight || 0, layer && layer.height > 0 ? layer.bottom : Infinity)
    const low = Math.max(layer && layer.height > 0 ? layer.top : 0, topLimit?.() ?? 0, 0)
    let up = false
    if (height > 0 && h > 0) {
      const below = height - 8 - (at.bottom + 6)
      const above = at.top - 6 - (low + 8)
      up = h > below && flip && h <= above
      if (h > below && !up) {
        const side = flip && above > below ? 'up' : 'down'
        up = side === 'up'
        el.style.maxHeight = `${Math.max(80, side === 'up' ? above : below)}px`
      }
    }
    setPlace({ right: width > 0 && w > 0 && at.left + w > width - 4, up })
  }, [open, flip, items.length, bounds, topLimit])

  useEffect(() => {
    if (props.away && open) setOpen(false)
  }, [props.away, open])

  const reported = useRef(false)
  const onOpenChange = props.onOpenChange
  useEffect(() => {
    if (reported.current === open) return
    reported.current = open
    onOpenChange?.(open)
  }, [open, onOpenChange])

  useEffect(() => {
    if (open) list.current?.focus({ preventScroll: true })
  }, [open])

  useEffect(() => {
    if (!open) return
    const doc = wrap.current!.ownerDocument
    const down = (event: MouseEvent): void => {
      if (!wrap.current?.contains(event.target as Node)) close()
    }
    doc.addEventListener('mousedown', down)
    return () => doc.removeEventListener('mousedown', down)
  }, [open])

  // the active item is in sight in a long list
  useEffect(() => {
    if (open) list.current?.ownerDocument.getElementById(optionId(active))?.scrollIntoView?.({ block: 'nearest' })
  }, [open, active])

  const pick = (i: number): void => {
    const item = items[i]
    if (!item) return
    close()
    props.onPick(item.value)
  }

  const typeahead = (letter: string): void => {
    const now = Date.now()
    const t = typed.current
    const text = now - t.at > TYPING ? letter : t.text + letter
    typed.current = { text, at: now }
    const word = text.toLowerCase()
    const same = [...word].every((c) => c === word[0])
    // the same letter again goes on to the next item of that letter; more letters narrow the prefix
    const prefix = same ? word[0]! : word
    const from = same ? active + 1 : active
    for (let k = 0; k < items.length; k++) {
      const i = (from + k) % items.length
      if (items[i]!.label.toLowerCase().startsWith(prefix)) {
        setActive(i)
        return
      }
    }
  }

  const onKey = (event: KeyboardEvent): void => {
    if (!open) return
    setKb(true)
    const last = items.length - 1
    const go = (i: number): void => {
      event.preventDefault()
      setActive(Math.max(0, Math.min(last, i)))
    }
    switch (event.key) {
      case 'ArrowDown':
        return go(active + 1)
      case 'ArrowUp':
        return go(active - 1)
      case 'Home':
        return go(0)
      case 'End':
        return go(last)
      case 'PageDown':
        return go(active + 5)
      case 'PageUp':
        return go(active - 5)
      case 'Enter':
      case ' ':
        event.preventDefault()
        event.stopPropagation()
        return pick(active)
      case 'Escape':
        event.preventDefault()
        event.stopPropagation()
        close()
        button.current?.focus({ preventScroll: true })
        props.onEscape?.()
        return
      case 'Tab':
        return close()
      default:
        if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
          event.preventDefault()
          typeahead(event.key)
        }
    }
  }

  const current = items.find((i) => i.value === value)
  return (
    <span ref={wrap} className={`dd${props.wrapClass ? ` ${props.wrapClass}` : ''}`}>
      <button
        ref={button}
        type="button"
        className={`dd-btn ${props.className ?? ''}`.trim()}
        data-cmd={props.cmd}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={props.tip ? undefined : (props.title ?? props.label)}
        aria-label={props.ariaLabel}
        aria-describedby={props.tip?.['aria-describedby']}
        aria-disabled={props.disabled || undefined}
        disabled={(props.hardDisabled ?? props.disabled) || undefined}
        onClick={(event) => {
          if (open) return close()
          setKb(event.detail === 0)
          show()
        }}
        onMouseEnter={props.tip?.onMouseEnter}
        onMouseLeave={props.tip?.onMouseLeave}
        onMouseDown={props.tip?.onMouseDown}
        onFocus={props.tip?.onFocus}
        onBlur={props.tip?.onBlur}
        onKeyDown={(event) => {
          props.tip?.onKeyDown(event)
          if (!open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
            event.preventDefault()
            setKb(true)
            show()
          }
        }}
      >
        {props.children}
        <ChevronIcon />
      </button>
      {shown && (
        <div
          ref={list}
          className={`dd-list pop${open ? '' : ' is-closed'}${place.right ? ' dd-right' : ''}${place.up ? ' dd-up' : ''}${kb ? ' kb' : ''}`}
          role="listbox"
          aria-label={props.label}
          aria-activedescendant={open ? optionId(active) : undefined}
          aria-hidden={open ? undefined : true}
          tabIndex={-1}
          style={open ? undefined : { visibility: 'hidden' }}
          data-current={current?.value}
          onKeyDown={onKey}
          onMouseDown={(e) => e.preventDefault()}
        >
          {props.heading && (
            <div className="dd-head" role="presentation">
              {props.heading}
            </div>
          )}
          {items.map((item, i) => (
            <div
              key={item.value}
              id={optionId(i)}
              role="option"
              className={`dd-opt${i === active ? ' is-active' : ''}${item.note ? ' has-note' : ''}`}
              data-value={item.value}
              aria-selected={item.value === value}
              aria-keyshortcuts={item.keys ? ariaKeys(item.keys) : undefined}
              aria-description={item.note}
              onMouseMove={() => {
                if (kb) setKb(false)
                if (i !== active) setActive(i)
              }}
              onClick={() => pick(i)}
            >
              {item.icon && <span className="dd-ico">{item.icon}</span>}
              {item.note ? (
                <span className="dd-main">
                  <span className="dd-label">{item.label}</span>
                  <span className="dd-note" aria-hidden="true">
                    {item.note}
                  </span>
                </span>
              ) : (
                <span className="dd-label">{item.label}</span>
              )}
              {item.keys && <span className="dd-keys" aria-hidden="true">{item.keys}</span>}
              {item.value === value && (
                <span className="dd-tick">
                  <CheckIcon />
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </span>
  )
}
