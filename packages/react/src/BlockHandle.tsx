import type { BlockSpot, DropSlot, VisualEditor } from '@nota-adoc/prosemirror'
import type { FormEvent, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, ReactElement } from 'react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AnchorIcon, CaptionIcon, DotsIcon, TrashIcon } from './icons.js'
import type { Locale } from './locale.js'
import { messages } from './messages.js'
import { placeBelow } from './place.js'

export interface BlockHandleProps {
  editor: VisualEditor | undefined
  locale: Locale
  /** The element the handle, the menu and the field are placed in (it is `position: relative`). */
  container: HTMLElement
  /** The element that scrolls the document: the mouse is watched over it. */
  scroller: HTMLElement
  /** the lower edge (px, window) of what lies over the top of the text; a handle that would stand on it is not shown (it would be cut by it). */
  topLimit?: () => number
  /** The mode of the source: no handle. */
  disabled?: boolean
  /** Called before a command of the handle: the message of an earlier refusal goes away. */
  onBeforeCommand?(): void
  /** Runs a command of the editor and tells whether it was refused (and with which code). */
  attempt(command: () => boolean): { ok: boolean; reject: { code: string; text: string } | null }
  /** A block that was dragged could not be put where it was let go. */
  onMoveRefused?(): void
}

type Field = 'caption' | 'title' | 'anchor'
type Entry = Field | 'delete'

interface Drag {
  spot: BlockSpot
  slots: readonly DropSlot[]
  startTop: number
  slot: DropSlot | null
  /** The line of the mark, in the coordinates of the window at the time of the last move. */
  y: number | null
}

/** The handle is 24 px wide (.blk-handle) and stands 8 px left of the block. */
const HANDLE_WIDTH = 24
const HANDLE_GAP = 8
const HANDLE_OFFSET = HANDLE_WIDTH + HANDLE_GAP

const sameSpot = (a: BlockSpot | null, b: BlockSpot | null): boolean =>
  a === b ||
  (!!a &&
    !!b &&
    a.offset === b.offset &&
    a.end === b.end &&
    a.sort === b.sort &&
    a.caption === b.caption &&
    a.anchor === b.anchor &&
    a.frameTop === b.frameTop &&
    a.rect?.top === b.rect?.top &&
    a.rect?.left === b.rect?.left)

/** The entries of the menu of a block, by its kind. */
export function entriesOf(spot: BlockSpot): Entry[] {
  if (spot.sort === 'heading') return ['anchor', 'delete']
  if (spot.sort === 'island') return ['delete']
  return [spot.sort === 'collapsible' ? 'title' : 'caption', 'anchor', 'delete']
}

/**
 * The handle «⋯» at the left of the block under the mouse: a menu (caption, anchor, delete) and the dragging of the block to
 * another place. Everything it does is a command of the editor, one step of the history.
 */
export function BlockHandle(props: BlockHandleProps): ReactElement | null {
  const { editor, locale, container, scroller, disabled = false, topLimit } = props
  const t = messages[locale].blockHandle
  const [hover, setHover] = useState<BlockSpot | null>(null)
  const [menu, setMenu] = useState<BlockSpot | null>(null)
  const [field, setField] = useState<{ kind: Field; spot: BlockSpot } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const handleRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const fieldRef = useRef<HTMLFormElement>(null)
  const dragRef = useRef<Drag | null>(null)
  const busy = menu !== null || field !== null || drag !== null
  const busyRef = useRef(false)
  busyRef.current = busy
  const [at, setAt] = useState(0)
  const wanted = Boolean(editor) && !disabled

  // the mouse over the document: the block under it gets the handle
  useEffect(() => {
    if (!wanted || !editor) {
      setHover(null)
      return
    }
    const onMove = (event: MouseEvent): void => {
      if (busyRef.current) return
      const dom = editor.view.dom.getBoundingClientRect()
      const x = Math.min(Math.max(event.clientX, dom.left + 4), Math.max(dom.left + 4, dom.right - 4))
      const spot = editor.blockAt(x, event.clientY)
      setHover((prev) => (sameSpot(prev, spot) ? prev : spot))
    }
    const onLeave = (event: MouseEvent): void => {
      if (busyRef.current) return
      const to = event.relatedTarget as Node | null
      if (to && handleRef.current?.contains(to)) return
      setHover(null)
    }
    const onScroll = (): void => {
      if (!busyRef.current) setHover(null)
    }
    // the text changed (whoever changed it): the block under the mouse is another one until the mouse moves
    const stop = editor.session.subscribe(() => {
      if (!busyRef.current) setHover(null)
    })
    scroller.addEventListener('mousemove', onMove)
    scroller.addEventListener('mouseleave', onLeave)
    scroller.addEventListener('scroll', onScroll)
    return () => {
      scroller.removeEventListener('mousemove', onMove)
      scroller.removeEventListener('mouseleave', onLeave)
      scroller.removeEventListener('scroll', onScroll)
      stop()
    }
  }, [wanted, editor, scroller])

  useLayoutEffect(() => {
    if (menu && menuRef.current && handleRef.current) placeBelow(menuRef.current, handleRef.current, container)
  }, [menu, container])
  useLayoutEffect(() => {
    if (field && fieldRef.current && handleRef.current) placeBelow(fieldRef.current, handleRef.current, container)
  }, [field, container])

  useEffect(() => {
    if (menu) menuRef.current?.querySelector<HTMLButtonElement>('button[aria-selected="true"]')?.focus()
  }, [menu, at])
  useEffect(() => {
    if (!field) return
    const input = fieldRef.current?.querySelector('input')
    input?.focus()
    input?.select()
  }, [field])

  // a click elsewhere closes the menu and the field
  useEffect(() => {
    if (!menu && !field) return
    const doc = container.ownerDocument
    const down = (event: MouseEvent): void => {
      const target = event.target as Node
      if (menuRef.current?.contains(target) || fieldRef.current?.contains(target) || handleRef.current?.contains(target)) return
      setMenu(null)
      setField(null)
      setError(null)
    }
    doc.addEventListener('mousedown', down)
    return () => doc.removeEventListener('mousedown', down)
  }, [menu, field, container])

  // a document that is another one has other blocks: what was open goes
  useEffect(() => {
    if (!editor) return
    return () => {
      setMenu(null)
      setField(null)
    }
  }, [editor])

  // the panel over a selection stays where it is; the handle that would lie on it is the one that steps aside (hidden, not moved:
  // the handle comes and goes with the mouse, so the panel must not follow it). It is set on the element itself, no render and no state.
  const hideUnderPanel = useCallback((): void => {
    const el = handleRef.current
    if (!el) return
    const panel = container.querySelector('.bubble')
    let under = false
    if (panel && !busyRef.current) {
      const a = el.getBoundingClientRect()
      const b = panel.getBoundingClientRect()
      under = b.width > 0 && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
    }
    if (under !== el.hasAttribute('data-under')) el.toggleAttribute('data-under', under)
  }, [container])
  useLayoutEffect(() => {
    hideUnderPanel()
  })
  useEffect(() => {
    if (!wanted || typeof MutationObserver === 'undefined') return
    const watch = new MutationObserver(hideUnderPanel)
    watch.observe(container, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] })
    return () => watch.disconnect()
  }, [wanted, container, hideUnderPanel])

  if (!editor || !wanted) return null

  const box = container.getBoundingClientRect()
  const shown = menu ?? field?.spot ?? drag?.spot ?? hover
  // (a table: the handle stands in the corner, its bottom 2 px over the frame, left of the grips of the columns and above the grips of the rows)
  const limit = topLimit?.() ?? 0
  const placed = shown?.rect
    ? {
        left: Math.max(2, shown.rect.left - box.left - HANDLE_OFFSET),
        top: (shown.frameTop === null ? shown.rect.top + 1 : shown.frameTop - HANDLE_WIDTH - 2) - box.top,
      }
    : null
  // under the capsule over the top of the text the handle would be cut by it: it is not shown (not while its menu, field or drag is open)
  const pos = placed && (menu || field || drag || placed.top + box.top >= limit) ? placed : null

  const closeAll = (restore: boolean): void => {
    setMenu(null)
    setField(null)
    setError(null)
    if (restore) handleRef.current?.focus()
  }

  const run = (command: () => boolean): ReturnType<BlockHandleProps['attempt']> => {
    props.onBeforeCommand?.()
    return props.attempt(command)
  }

  const pick = (entry: Entry, spot: BlockSpot): void => {
    if (entry === 'delete') {
      closeAll(false)
      setHover(null)
      run(() => editor.commands.deleteBlockAt(spot.offset))
      editor.focus()
      return
    }
    setMenu(null)
    setError(null)
    setField({ kind: entry, spot })
  }

  const submit = (event: FormEvent): void => {
    event.preventDefault()
    if (!field) return
    const value = (fieldRef.current?.querySelector('input') as HTMLInputElement).value
    const { kind, spot } = field
    const result = run(() =>
      kind === 'anchor' ? editor.commands.setBlockAnchor(spot.offset, value) : editor.commands.setBlockTitle(spot.offset, value),
    )
    if (result.ok) {
      closeAll(false)
      editor.focus()
      return
    }
    const code = result.reject?.code
    if (code === 'bad-anchor' || code === 'duplicate-anchor') {
      // the reason stays under the field, which stays open
      props.onBeforeCommand?.()
      setError(code === 'bad-anchor' ? t.anchorBad : t.anchorDup)
      return
    }
    closeAll(false)
    editor.focus()
  }

  const onMenuKey = (event: ReactKeyboardEvent, count: number): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      closeAll(true)
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      setAt((at + 1) % count)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setAt((at + count - 1) % count)
    }
  }

  // ---- the dragging of the handle
  const onHandleDown = (event: ReactMouseEvent): void => {
    if (event.button !== 0 || !hover) return
    event.preventDefault()
    const spot = hover
    const [x0, y0] = [event.clientX, event.clientY]
    const doc = container.ownerDocument
    let active = false
    const nearest = (d: Drag, y: number): DropSlot | null => {
      const shift = scroller.scrollTop - d.startTop
      let best: DropSlot | null = null
      let gap = Infinity
      for (const s of d.slots) {
        const dist = Math.abs(s.y - shift - y)
        if (dist < gap) [best, gap] = [s, dist]
      }
      return best
    }
    const update = (d: Drag): void => {
      dragRef.current = d
      setDrag(d)
    }
    const move = (e: MouseEvent): void => {
      if (!active) {
        if (Math.hypot(e.clientX - x0, e.clientY - y0) < 4) return
        active = true
        closeAll(false)
        update({ spot, slots: editor.dropSlots(spot.section), startTop: scroller.scrollTop, slot: null, y: null })
      }
      const d = dragRef.current!
      const slot = nearest(d, e.clientY)
      update({ ...d, slot, y: slot ? slot.y - (scroller.scrollTop - d.startTop) : null })
    }
    const stop = (): void => {
      doc.removeEventListener('mousemove', move, true)
      doc.removeEventListener('mouseup', up, true)
      doc.removeEventListener('keydown', key, true)
      dragRef.current = null
      setDrag(null)
    }
    const up = (): void => {
      const d = dragRef.current
      stop()
      if (!active) {
        setMenu(spot)
        setAt(0)
        return
      }
      setHover(null)
      if (!d?.slot) return
      const to = d.slot.to
      // let go on the spot or inside the block: nothing happens
      if (to >= spot.offset && to <= spot.end) return
      const result = run(() => editor.commands.moveBlock(spot.offset, to))
      if (!result.ok) props.onMoveRefused?.()
    }
    const key = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      active = false
      stop()
    }
    doc.addEventListener('mousemove', move, true)
    doc.addEventListener('mouseup', up, true)
    doc.addEventListener('keydown', key, true)
  }

  const label = (entry: Entry, spot: BlockSpot): string =>
    entry === 'caption'
      ? t.caption
      : entry === 'title'
        ? t.title
        : entry === 'anchor'
          ? t.anchor
          : spot.sort === 'heading'
            ? t.deleteSection
            : t.deleteBlock
  const icon = (entry: Entry): ReactElement => (entry === 'anchor' ? <AnchorIcon /> : entry === 'delete' ? <TrashIcon /> : <CaptionIcon />)
  const fieldLabel = field ? (field.kind === 'caption' ? t.captionLabel : field.kind === 'title' ? t.titleLabel : t.anchorLabel) : ''
  const initial = field ? (field.kind === 'anchor' ? field.spot.anchor : field.spot.caption) ?? '' : ''
  const entries = menu ? entriesOf(menu) : []
  const dropBox = editor.view.dom.getBoundingClientRect()

  return (
    <>
      {shown && pos && (
        <button
          ref={handleRef}
          type="button"
          className={`blk-handle${drag?.slot ? ' dragging' : ''}`}
          aria-label={t.tip}
          title={t.tip}
          aria-haspopup="menu"
          aria-expanded={menu !== null}
          style={{ left: `${pos.left}px`, top: `${pos.top}px` }}
          onMouseDown={onHandleDown}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown') {
              event.preventDefault()
              setMenu(shown)
              setAt(0)
            }
          }}
        >
          <DotsIcon />
        </button>
      )}
      {menu && (
        <div ref={menuRef} className="pop blkmenu" role="menu" aria-label={t.menu} onKeyDown={(event) => onMenuKey(event, entries.length)}>
          {entries.map((entry, i) => (
            <button
              key={entry}
              type="button"
              role="menuitem"
              data-cmd={entry}
              aria-selected={i === at}
              tabIndex={i === at ? 0 : -1}
              className={entry === 'delete' ? 'danger' : undefined}
              onClick={() => pick(entry, menu)}
            >
              {icon(entry)}
              <span>{label(entry, menu)}</span>
            </button>
          ))}
        </div>
      )}
      {field && (
        <form
          ref={fieldRef}
          className="pop blkfield"
          role="dialog"
          aria-label={fieldLabel}
          onSubmit={submit}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              event.stopPropagation()
              closeAll(true)
            }
          }}
        >
          <label>
            <span className="blk-label">{fieldLabel}</span>
            <input type="text" key={`${field.kind}:${field.spot.offset}`} defaultValue={initial} aria-label={fieldLabel} aria-invalid={error ? true : undefined} autoComplete="off" spellCheck={false} />
          </label>
          {error && (
            <div className="pop-err" role="alert">
              {error}
            </div>
          )}
          <div className="pop-foot">
            <button type="submit" className="btn-acc">
              {t.save}
            </button>
          </div>
        </form>
      )}
      {drag?.y != null && (
        <div
          className="blk-drop"
          aria-hidden="true"
          style={{ top: `${drag.y - box.top}px`, left: `${dropBox.left - box.left}px`, width: `${dropBox.width}px` }}
        />
      )}
    </>
  )
}
