import type { FocusEvent, KeyboardEvent, MouseEvent, ReactElement, RefObject } from 'react'
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal, flushSync } from 'react-dom'

/** What a popup says: the name, a line of what the button does, the keys (each in its frame) with a note after them, and why the button is dimmed. */
export interface TipContent {
  name: string
  text: string
  keys?: readonly string[]
  note?: string
  /** The button is dimmed (`aria-disabled`): this line stands in place of the keys. */
  off?: string
}

/** What a button takes to have a popup: spread it on the element (or call the handlers from its own). */
export interface TipBind {
  onMouseEnter(event: MouseEvent<HTMLElement>): void
  onMouseLeave(): void
  onMouseDown(): void
  onFocus(event: FocusEvent<HTMLElement>): void
  onBlur(): void
  onKeyDown(event: KeyboardEvent<HTMLElement>): void
  'aria-describedby': string | undefined
}

export interface Tips {
  /** The handlers of the button `id`; `group` names a set that goes together (the row «Таблица»). */
  bind(id: string, content: TipContent, group?: string): TipBind
  /** Hides the popup if it belongs to `group`. */
  hideGroup(group: string): void
  /** Hides the popup now. */
  hide(): void
  /** Shows the popup of the button `id` at once (a move by the arrows in a row of buttons), if it was bound. */
  showNow(id: string, anchor: HTMLElement, group?: string): void
  /** The popup itself: put it anywhere in the render of the capsule. */
  node: ReactElement | null
}

const nothing = (): void => undefined
/** A button without a popup that has no `title` either: the handlers do nothing. */
export const NO_TIP: TipBind = {
  onMouseEnter: nothing,
  onMouseLeave: nothing,
  onMouseDown: nothing,
  onFocus: nothing,
  onBlur: nothing,
  onKeyDown: nothing,
  'aria-describedby': undefined,
}
/** The popups of a row that is going away (or is off): every button is bound to `NO_TIP`. */
export const QUIET_TIPS: Tips = { bind: () => NO_TIP, hideGroup: nothing, hide: nothing, showNow: nothing, node: null }
/** After a window closed, a focus that comes back to the button shows no popup for this long (ms). */
const REFOCUS_QUIET = 200

/** How long the mouse rests on a button before its popup shows (ms). */
export const TIP_DELAY = 400
/** After a popup went, the next one shows at once for this long (ms). */
export const TIP_GRACE = 500
/** The popup stays this long after the mouse leaves a button, so that it does not blink between two (ms). */
export const TIP_LEAVE = 80

/** The platform of the keys: ⌘ ⌥ ⇧ on a Mac, words elsewhere. */
export function isMac(): boolean {
  return /Mac|iPhone|iPad/i.test((typeof navigator === 'undefined' ? '' : navigator.platform || navigator.userAgent) || '')
}

/** The key `B` with the modifiers as a label: `⌘⇧B` on a Mac, `Ctrl+Shift+B` elsewhere. */
export function keyLabel(key: string, mac: boolean, mods: { shift?: boolean; alt?: boolean; primary?: boolean } = {}): string {
  const { shift = false, alt = false, primary = true } = mods
  if (mac) return `${primary ? '⌘' : ''}${alt ? '⌥' : ''}${shift ? '⇧' : ''}${key}`
  return [primary && 'Ctrl', alt && 'Alt', shift && 'Shift', key].filter(Boolean).join('+')
}

/** A label of keys (`⌘⌥2`, `Ctrl+Alt+2`) as `aria-keyshortcuts` (`Meta+Alt+2`, `Control+Alt+2`). */
export function ariaKeys(label: string): string {
  return label.replace(/⌘/g, 'Meta+').replace(/⌥/g, 'Alt+').replace(/⇧/g, 'Shift+').replace(/\bCtrl\b/g, 'Control')
}

interface Active {
  id: string
  group: string | undefined
  anchor: HTMLElement
}

function focusVisible(el: HTMLElement): boolean {
  try {
    return el.matches(':focus-visible')
  } catch {
    return true
  }
}

/**
 * The popups of the buttons of one capsule: one timer for all of them. The mouse waits 0.4 s on the first button; a move to the next
 * one within 0.5 s shows its popup at once. Focus from the keyboard works the same, Esc hides, a press hides until the mouse leaves
 * or the focus moves. While `blocked` (a window hangs from the capsule) nothing shows. The popup hangs under `root`, in the middle
 * of its button, and is kept 8 px from the edges of the tab. With `above` (the panel over the selection stands under the word) it hangs over `root`.
 */
export function useTips(root: RefObject<HTMLElement | null>, blocked: boolean, above = false): Tips {
  const uid = useId()
  const tipId = `tip-${uid.replace(/[^A-Za-z0-9_-]/g, '')}`
  const [active, setActive] = useState<Active | null>(null)
  const state = useRef<{ show: ReturnType<typeof setTimeout> | undefined; leave: ReturnType<typeof setTimeout> | undefined; lastHide: number; shown: string | null; hushed: string | null; unblockedAt: number }>({
    show: undefined,
    leave: undefined,
    unblockedAt: Number.NEGATIVE_INFINITY,
    lastHide: Number.NEGATIVE_INFINITY,
    shown: null,
    hushed: null,
  })
  const contents = useRef(new Map<string, TipContent>())
  const blockedNow = useRef(blocked)
  blockedNow.current = blocked

  const stop = useCallback((): void => {
    clearTimeout(state.current.show)
    clearTimeout(state.current.leave)
  }, [])
  // from a timer the change is drawn at once (nothing else would bring the render); from an event or an effect React does it itself
  const change = useCallback((next: Active | null, sync: boolean): void => {
    if (sync) flushSync(() => setActive(next))
    else setActive(next)
  }, [])
  const hide = useCallback(
    (sync = false): void => {
      stop()
      if (state.current.shown === null) return
      state.current.shown = null
      state.current.lastHide = Date.now()
      change(null, sync)
    },
    [stop, change],
  )
  const reveal = (id: string, anchor: HTMLElement, group: string | undefined, sync = false): void => {
    stop()
    state.current.shown = id
    change({ id, group, anchor }, sync)
  }
  const arrive = (id: string, anchor: HTMLElement, group: string | undefined): void => {
    const s = state.current
    if (blockedNow.current || s.hushed === id) return
    stop()
    if (s.shown === id) return
    if (s.shown !== null || Date.now() - s.lastHide <= TIP_GRACE) return reveal(id, anchor, group, true)
    s.show = setTimeout(() => reveal(id, anchor, group, true), TIP_DELAY)
  }
  const press = (id: string): void => {
    state.current.hushed = id
    hide()
  }

  const wasBlocked = useRef(false)
  useEffect(() => {
    if (blocked) hide()
    else if (wasBlocked.current) state.current.unblockedAt = Date.now()
    wasBlocked.current = blocked
  }, [blocked, hide])
  useEffect(() => stop, [stop])
  // the button went (the row «Таблица» folded up): so does the popup
  useEffect(() => {
    if (active && !active.anchor.isConnected) hide()
  })

  useLayoutEffect(() => {
    const el = active && root.current?.ownerDocument.getElementById(tipId)
    if (!active || !el || !root.current) return
    const doc = root.current.ownerDocument
    const at = active.anchor.getBoundingClientRect()
    const under = root.current.getBoundingClientRect()
    const width = doc.documentElement.clientWidth || doc.defaultView?.innerWidth || 0
    const w = el.offsetWidth
    let left = at.left + at.width / 2 - w / 2
    if (width > 0) left = Math.min(left, width - 8 - w)
    left = Math.max(8, left)
    el.style.left = `${Math.round(left)}px`
    el.style.top = `${Math.round(above ? under.top - 6 - el.offsetHeight : under.bottom + 6)}px`
  })

  const bind = (id: string, content: TipContent, group?: string): TipBind => {
    contents.current.set(id, content)
    return {
      onMouseEnter: (event) => arrive(id, event.currentTarget, group),
      onMouseLeave: () => {
        const s = state.current
        if (s.hushed === id) s.hushed = null
        clearTimeout(s.show)
        if (s.shown === id) s.leave = setTimeout(() => hide(true), TIP_LEAVE)
      },
      onMouseDown: () => press(id),
      onFocus: (event) => {
        if (Date.now() - state.current.unblockedAt < REFOCUS_QUIET) return
        if (focusVisible(event.currentTarget)) arrive(id, event.currentTarget, group)
      },
      onBlur: () => {
        const s = state.current
        if (s.hushed === id) s.hushed = null
        clearTimeout(s.show)
        if (s.shown === id) hide()
      },
      onKeyDown: (event) => {
        if (event.key === 'Enter' || event.key === ' ') press(id)
        else if (event.key === 'Escape') press(id)
      },
      'aria-describedby': active?.id === id ? tipId : undefined,
    }
  }

  const content = active ? contents.current.get(active.id) : undefined
  const doc = root.current?.ownerDocument
  const node = active && content && doc ? createPortal(<Tooltip key={active.id} id={tipId} content={content} />, doc.body) : null
  return {
    bind,
    hideGroup: (group) => {
      if (active?.group === group) hide()
    },
    hide,
    showNow: (id, anchor, group) => {
      if (!blockedNow.current && contents.current.has(id)) reveal(id, anchor, group)
    },
    node,
  }
}

/** The popup: a card with the name, the line, and the keys or the reason. Its place is set by `useTips`. */
export function Tooltip(props: { id: string; content: TipContent }): ReactElement {
  const { name, text, keys, note, off } = props.content
  return (
    <div id={props.id} role="tooltip" className={`nota-tip${off ? ' is-off' : ''}`}>
      <div className="nota-tip-name">{name}</div>
      <div className="nota-tip-desc">{text}</div>
      {off ? (
        <div className="nota-tip-off">{off}</div>
      ) : (
        keys?.length || note ? (
          <div className="nota-tip-keys">
            {keys?.map((k) => (
              <kbd key={k}>{k}</kbd>
            ))}
            {note && <span>{note}</span>}
          </div>
        ) : null
      )}
    </div>
  )
}
