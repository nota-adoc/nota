/**
 * The capsule of tools over the document in two views: wide, always open when it fits on one line («Текст ⌄», the headings 2–6, the lists and the blocks as icons), and narrow («+», «Текст ⌄», the lists; «+» opens the list of the blocks, `block-insert.tsx`);
 * under them the row «Таблица» while the cursor is in a table; the marks, the colours and the link are on the panel over the selection alone. Its own, in place of the `Toolbar` of `@nota-adoc/react`,
 * which the demo shares; the panel over the selection and the windows stay the ones of that package. The colours of the cells are no window: their row of circles stands in place of the row «Таблица» (`cellRow`).
 */
import type { InsertKind, VisualEditor } from '@nota-adoc/prosemirror'
import {
  Dropdown,
  NO_TIP,
  type OpenPopover,
  BUBBLE_FOLD_MS,
  BUBBLE_OPEN_MS,
  type BlockItem,
  QUIET_TIPS,
  TableTools,
  reducedMotion,
  type TipBind,
  type TipContent,
  keyLabel,
  messages,
  useEditorState,
  useTableDismiss,
  useTips,
} from '@nota-adoc/react'
import { type KeyboardEvent as ReactKeyboardEvent, type MouseEvent, type ReactElement, cloneElement, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { type Locale, strings } from '../strings.js'
import { type BlockSet, blockIcon, cellOff, iconKey, RowGhost, wideBlocks } from './block-insert.js'
import { BulletListIcon, CheckListIcon, NumberListIcon, PlusIcon } from './tool-icons.js'

/** The hint of a button: `Жирный · ⌘B`; without keys the label alone (the format of the panel over the selection). */
export function hint(label: string, mac: boolean, keys?: { shift?: boolean; key: string }): string {
  if (!keys) return label
  return `${label} · ${mac ? '⌘' : 'Ctrl+'}${keys.shift ? (mac ? '⇧' : 'Shift+') : ''}${keys.key}`
}

const isMac = (): boolean => /Mac|iPhone|iPad/i.test((typeof navigator === 'undefined' ? '' : navigator.platform || navigator.userAgent) || '')

/** A press on a button must not take the selection from the editor: the button acts on the click. */
const keepSelection = (event: MouseEvent): void => {
  if ((event.target as Element).closest('button')) event.preventDefault()
}

const LISTS = [
  { key: 'ul', list: 'unordered', label: 'bulletedList', Icon: BulletListIcon },
  { key: 'ol', list: 'ordered', label: 'numberedList', Icon: NumberListIcon },
  { key: 'check', list: 'checklist', label: 'checklist', Icon: CheckListIcon },
] as const

export type ToolsWindow = 'insert' | 'link' | 'cell' | 'align' | OpenPopover

export interface ToolsProps {
  editor: VisualEditor | undefined
  locale: Locale
  /** The mode «Текст»: the buttons are off and the capsule says so. */
  disabled: boolean
  /** Which window hangs from the capsule now, for `aria-expanded`. */
  open: ToolsWindow
  onBeforeCommand(): void
  /** «+» was pressed (`keyboard`: with Enter or Space). */
  onInsert(anchor: HTMLElement, keyboard: boolean): void
  /** the view of the capsule: wide (open, the icons of the blocks) or narrow («+»); null until it is measured (drawn narrow, without the morph). */
  wide: boolean | null
  /** which blocks the open capsule shows (`nota.blocksInCapsule`); with `frequent` «+» stays in the wide capsule too. */
  blocks: BlockSet
  /** An icon of a block was pressed (`rect`: where it is, for the window of the picture). */
  onPickBlock(id: InsertKind, rect: { left: number; top: number; bottom: number }): void
  /** A style of the paragraph was chosen from the list. */
  onStyle(style: StyleId): void
  /** «Заливка ячейки ⌄» was pressed. */
  onCellFill(anchor: HTMLElement, keyboard: boolean): void
  /** The element that scrolls the document: the capsule lies over its top, and the cursor must not go under it. */
  scroller: HTMLElement
  /** the row of colours of «Заливка ячейки ⌄»: it stands in place of the row «Таблица». */
  cellRow?: ReactElement | null
}

/** The width of the tab (`.ed-main`, px) up to which the style sheet wraps the row «Таблица» (`@container (max-width: 360px)`). */
const NARROW_TAB = 360

/** Gap between the lower edge of the capsule and the cursor (px). */
const CURSOR_GAP = 4

/**
 * The height the row «Таблица» has when it is open all the way (px, with its upper line), 0 while unknown. While it opens the row is
 * clipped (`overflow: hidden`), so its `scrollHeight` is too small; the buttons themselves do not depend on the
 * clipping: their span plus the padding and the line of the row is the final height, on one line or on several.
 */
function naturalRowHeight(row: HTMLElement): number {
  let top = Infinity
  let bottom = -Infinity
  for (const child of Array.from(row.children)) {
    const r = child.getBoundingClientRect()
    if (r.height <= 0) continue
    top = Math.min(top, r.top)
    bottom = Math.max(bottom, r.bottom)
  }
  const style = getComputedStyle(row)
  const frame = (Number.parseFloat(style.paddingTop) || 0) + (Number.parseFloat(style.paddingBottom) || 0) + (Number.parseFloat(style.borderTopWidth) || 0)
  const spanned = bottom > top ? Math.ceil(bottom - top + frame) : 0
  const clipped = row.scrollHeight > 0 ? row.scrollHeight + 1 : 0
  return Math.max(spanned, clipped)
}

interface Place {
  /** The row «Таблица» is open (not folding). */
  row: boolean
  /** The document starts with a table. */
  first: boolean
  /** The cursor may be under the capsule now: scroll it out (the row just opened). */
  reveal: boolean
  /** The last measured height of the row with its line (px), 0 while unknown. */
  rowHeight: { current: number }
}

/** The room (px) between the capsule and the column «Разделы» that it must not lie on. */
const SIDE_GAP = 8

/**
 * The capsule lies over the top of the document (the row «Таблица» and «⋯» do not take room from the text), so: the cards learn how
 * low it reaches (`--tools-h`, `--tools-bottom` on the row of capsules), the view keeps the cursor under its lower edge when it
 * scrolls, a document that starts with a table gets room above it for the row, and a cursor that the row just covered is scrolled
 * out once, at once and without smoothness, as far as it takes and no further.
 */
function placeClearance(root: HTMLElement, scroller: HTMLElement, editor: VisualEditor | undefined, place: Place): void {
  const main = root.querySelector<HTMLElement>(':scope > .tl-main')
  if (!main) return
  const isles = root.closest<HTMLElement>('.ed-isles')
  const row = root.querySelector<HTMLElement>('.tl-row')
  if (row) {
    const full = naturalRowHeight(row)
    if (full > 0) place.rowHeight.current = full
  }
  if (!place.rowHeight.current) {
    // not measured (the row has no layout yet): one line, two where the style sheet wraps it (a tab narrower than 360 px), by the same width of the tab
    const tab = root.closest<HTMLElement>('.ed-main')?.clientWidth ?? 0
    place.rowHeight.current = tab > 0 && tab <= NARROW_TAB ? 70 : 37
  }
  const rect = root.getBoundingClientRect()
  const base = rect.top + 2 + main.offsetHeight
  const lower = base + (place.row ? place.rowHeight.current : 0)
  if (isles) {
    const at = isles.getBoundingClientRect().top
    // the row of capsules keeps the height of the closed capsule's main row (as without a table); the row «Таблица» reaches over the text
    isles.style.setProperty('--tools-main-h', `${2 + main.offsetHeight}px`)
    isles.style.setProperty('--tools-h', `${lower - rect.top}px`)
    isles.style.setProperty('--tools-bottom', `${lower - at}px`)
  }
  // the wide capsule with the row «Таблица» reaches lower than the top of the column «Разделы» and, in a tab of 1022–1110 px, left of its edge: the column
  // goes down under the capsule (`--side-top` on the tab) for as long as they would lie one on the other
  const tabEl = root.closest<HTMLElement>('.ed-main')
  const side = tabEl?.querySelector<HTMLElement>('.sections-side')
  if (tabEl && side) {
    const s = side.getBoundingClientRect()
    // the column stands level with the row of capsules (top 10 px); where the capsule reaches its edge it goes down under the row (the open row too, if there is one)
    if (s.width > 0 && rect.left < s.right + SIDE_GAP) tabEl.style.setProperty('--side-top', `${Math.ceil((place.row ? lower : base) - tabEl.getBoundingClientRect().top + SIDE_GAP)}px`)
    else tabEl.style.removeProperty('--side-top')
  }
  const area = scroller.getBoundingClientRect().top
  editor?.setScrollMarginTop(lower + CURSOR_GAP - area)
  // the room above a table that is the first block: as high as the open row reaches over the first cell
  const cell = place.first ? scroller.querySelector<HTMLElement>('table td, table th') : null
  if (cell) {
    const extra = Number.parseFloat(scroller.style.getPropertyValue('--lead-extra')) || 0
    const cursorTop = cell.getBoundingClientRect().top - area + scroller.scrollTop - extra + (Number.parseFloat(getComputedStyle(cell).paddingTop) || 0)
    const need = Math.max(0, Math.ceil(base + place.rowHeight.current + CURSOR_GAP - area - cursorTop))
    if (need !== extra) {
      // The room is set the first time before the person sees the text. Later it changes because the row turned out other than
      // estimated or the tab was resized: the text stays where it is on the screen, the scroll takes the difference; when it
      // cannot (the text is higher than the room), the room is not made smaller.
      const delta = need - extra
      if (scroller.style.getPropertyValue('--lead-extra') === '') {
        scroller.style.setProperty('--lead-extra', `${need}px`)
        // a tab that opened with the scroll restored: the text stays where it is
        if (scroller.scrollTop > 0) scroller.scrollTop += need
      } else if (delta > 0 || scroller.scrollTop >= -delta) {
        scroller.style.setProperty('--lead-extra', `${need}px`)
        scroller.scrollTop += delta
      }
    }
  } else if (!place.first) {
    scroller.style.removeProperty('--lead-extra')
  }
  if (place.reveal && editor && !scroller.classList.contains('smooth')) {
    let top: number
    try {
      top = editor.view.coordsAtPos(editor.view.state.selection.head).top
    } catch {
      return
    }
    const limit = lower + CURSOR_GAP
    if (top < limit) scroller.scrollTop = Math.max(0, scroller.scrollTop - (limit - top))
  }
}

const STYLE_ITEMS = ['p', 'h2', 'h3', 'h4', 'h5', 'h6'] as const
type StyleId = (typeof STYLE_ITEMS)[number]

/** The level of the nearest section heading above the block of the selection (the block itself does not count); 1 when there is none (the title of the document or nothing). */
export function headingAbove(editor: VisualEditor | undefined): number {
  if (!editor) return 1
  const { doc, selection } = editor.view.state
  const index = selection.$from.index(0)
  let level = 1
  for (let i = Math.min(index, doc.childCount) - 1; i >= 0; i--) {
    const node = doc.child(i)
    if (node.type.name === 'heading' && (node.attrs.level as number) >= 2) {
      level = node.attrs.level as number
      break
    }
  }
  return level
}

/** How long the row «Таблица» stays while it folds up (ms); the style sheet has the same 0.18 s. */
const ROW_LEAVE_MS = 180
/** How long the circles of «Заливка ячейки» stay, fading and `inert`, over the row «Таблица» that comes back (ms); the style sheet has 0.09 s. */
const COLORS_LEAVE_MS = 100

const noFill = (): void => {}

/**
 * Keeps the last `value` for `ms` after `open` became false (null afterwards); coming back cancels the wait.
 * While open it returns nothing special: the caller uses its live value.
 */
function useHeld<T>(open: boolean, value: T, ms: number): T | null {
  const kept = useRef<T | null>(null)
  const [, redraw] = useState(0)
  if (open) kept.current = value
  useEffect(() => {
    if (open || kept.current === null) return
    const timer = setTimeout(() => {
      kept.current = null
      flushSync(() => redraw((n) => n + 1))
    }, ms)
    return () => clearTimeout(timer)
  }, [open, ms])
  return kept.current
}

export function Tools(props: ToolsProps): ReactElement {
  const { editor, locale, disabled, open } = props
  const t = messages[locale]
  const ui = strings[locale].isles
  const state = useEditorState(editor)
  const mac = isMac()
  const off = disabled || !editor
  const pale = off || state.plate
  const [styleOpen, setStyleOpen] = useState(false)
  // the heading above the cursor, read when the list opens (the document may change without the selection)
  const [above, setAbove] = useState(1)
  const rootRef = useRef<HTMLDivElement>(null)
  // a window hangs from the capsule: no popup of any button
  const tips = useTips(rootRef, disabled || open !== null || styleOpen)
  const tp = t.tips
  const plateOff = state.plate ? (state.cellAsText ? tp.offCell : tp.offPlate) : undefined
  /** The popup of a button: its name, the line, the keys, and why it is dimmed (if it is). */
  const tip = (id: string, content: TipContent, group?: string): TipBind => (disabled ? NO_TIP : tips.bind(id, content, group))
  const dismissed = useTableDismiss(editor, !disabled && state.table !== null, `${state.from}:${state.to}`)
  const tableRow = Boolean(editor) && !disabled && state.table !== null && !dismissed
  const held = useHeld(tableRow, state, ROW_LEAVE_MS)
  // with «reduce motion» the row goes at once, it is not held
  const calm = reducedMotion()
  const rowLeaving = !tableRow && held !== null && !calm
  const rowState = tableRow ? state : calm ? null : held
  // «‹ Таблица» and Esc: the circles of the fill of the cell do not vanish in a frame, they stay over the row «Таблица», `inert`, and fade out in 90 ms
  const heldColors = useHeld(Boolean(props.cellRow), props.cellRow ?? null, COLORS_LEAVE_MS)
  const colorsLeaving = !props.cellRow && heldColors !== null && tableRow && !calm
  // The capsule changes its size (the row «Таблица» comes or goes, the colours of the cells take its place or give it back) by one transition from the size of now to the size it
  // comes to, measured at once: the width and the height in px, the way `BubbleMenu` does it. Closing is quicker than opening.
  const mode = rowLeaving ? 'leave' : tableRow ? (props.cellRow ? 'cell' : 'table') : 'none'
  const wide = props.wide === true
  const [prevMode, setPrevMode] = useState(mode)
  const [prevView, setPrevView] = useState<boolean | null>(props.wide)
  const [shift, setShift] = useState(0)
  const fromBox = useRef<DOMRect | null>(null)
  const closing = useRef(false)
  if (prevMode !== mode || prevView !== props.wide) {
    // the first measure of the view is no change: the capsule is drawn in its view at once
    const viewChanged = prevView !== props.wide && prevView !== null
    setPrevMode(mode)
    setPrevView(props.wide)
    // (the row that was going is gone from the page: the capsule is already on its way to the size it has without it, nothing starts anew)
    if (viewChanged || (prevMode !== mode && !(prevMode === 'leave' && mode === 'none'))) {
      setShift((n) => n + 1)
      closing.current = mode === 'leave' || (viewChanged && !wide) || (prevMode === 'cell' && mode === 'table')
      fromBox.current = rootRef.current?.getBoundingClientRect() ?? null
    }
  }
  useLayoutEffect(() => {
    const el = rootRef.current
    const from = fromBox.current
    fromBox.current = null
    if (el) {
      el.style.width = ''
      el.style.height = ''
      el.style.marginLeft = ''
      delete el.dataset.morph
    }
    if (!el || !from || shift === 0 || reducedMotion()) return
    // the size it comes to: without the row that is going (it lies over the capsule while it fades, and the capsule closes it from below)
    const going = el.querySelector<HTMLElement>('.tl-table.is-leaving')
    if (going) going.style.display = 'none'
    const to = el.getBoundingClientRect()
    if (going) going.style.display = ''
    if (Math.abs(to.width - from.width) < 0.5 && Math.abs(to.height - from.height) < 0.5) return
    // it starts from the size of now (no transition on the way there), then goes to the size it comes to
    el.style.transition = 'none'
    el.style.width = `${from.width}px`
    el.style.height = `${from.height}px`
    // (in a narrow tab the capsule lies in another place of the row of capsules when the colours are open: it starts where it was)
    const dx = from.left - el.getBoundingClientRect().left
    if (Math.abs(dx) > 0.5) el.style.marginLeft = `${dx}px`
    void el.offsetWidth
    el.style.transition = ''
    el.dataset.morph = closing.current ? 'close' : 'open'
    el.style.width = `${to.width}px`
    el.style.height = `${to.height}px`
    if (Math.abs(dx) > 0.5) el.style.marginLeft = '0px'
    const timer = setTimeout(
      () => {
        el.style.width = ''
        el.style.height = ''
        el.style.marginLeft = ''
        delete el.dataset.morph
      },
      (closing.current ? BUBBLE_FOLD_MS : BUBBLE_OPEN_MS) + 40,
    )
    return () => clearTimeout(timer)
  }, [shift])
  const hideRow = tips.hideGroup
  useEffect(() => {
    if (!tableRow) hideRow('row')
  }, [tableRow, hideRow])
  // The row came back while it was folding: the same element goes on from where it is (a transition), the opening animation would restart from 0.
  const phase = useRef({ left: false, back: false })
  if (rowLeaving) phase.current.left = true
  else if (tableRow && phase.current.left) phase.current.back = true
  if (!rowState) phase.current = { left: false, back: false }
  const rowBack = phase.current.back
  const rowHeight = useRef(0)
  const wasRow = useRef(false)
  const first = Boolean(editor) && !disabled && editor!.view.state.doc.firstChild?.type.name === 'table'
  const { scroller } = props
  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) return
    const reveal = tableRow && !wasRow.current
    wasRow.current = tableRow
    placeClearance(root, scroller, editor, { row: tableRow, first, reveal, rowHeight })
    const isles = root.closest('.ed-isles')
    if (!isles || typeof ResizeObserver === 'undefined') return
    // the width of the tab changed: the row wraps in another place
    // It runs in the next frame, before paint: a measure inside the callback makes Chromium report «ResizeObserver loop completed with undelivered notifications».
    let frame = 0
    const watch = new ResizeObserver(() => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        placeClearance(root, scroller, editor, { row: tableRow, first, reveal: false, rowHeight })
      })
    })
    watch.observe(isles)
    // the view of the outline changed (the command of the palette, the setting): the column appears, goes or comes back, but nothing here is resized;
    // `setOutlineView` tells it by a resize of the window, and `--side-top` is counted again
    const again = (): void => placeClearance(root, scroller, editor, { row: tableRow, first, reveal: false, rowHeight })
    window.addEventListener('resize', again)
    // the capsule itself changes (the row opens, «⋯» opens, the row wraps) while the row of capsules keeps its fixed height
    watch.observe(root)
    const row = root.querySelector('.tl-row')
    if (row) watch.observe(row)
    return () => {
      watch.disconnect()
      window.removeEventListener('resize', again)
      if (frame) cancelAnimationFrame(frame)
    }
    // `open`: a window hung from the capsule is placed by the height measured now
  }, [editor, scroller, tableRow, first, open])
  // Alt+F10 (⌥F10 on a Mac) from the text: to the tools. With a selection the panel over it takes the key (it is the one with the marks, the
  // colours and the link); without one, or where no panel stands (code), the focus goes to the first button of the capsule.
  const noPanel = state.empty || state.plate
  const cellsSelected = state.table?.selection != null
  // (in an admonition without a selection the key opens the row of the types: `BlockBar`)
  const typeKey = state.empty && state.admonition !== null && state.code === null
  useEffect(() => {
    if (!editor || disabled) return
    const doc = editor.view.dom.ownerDocument
    const onKey = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'F10' || !event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || !noPanel) return
      // (with cells selected the capsule of the cells takes the key: `CellMenu`)
      if (cellsSelected) return
      // (in an admonition the key opens the row of the types: `AdmonitionPicker`)
      if (typeKey) return
      if (!editor.view.dom.contains(event.target as Node)) return
      event.preventDefault()
      rootRef.current?.querySelector<HTMLElement>('.tl-main button:not(:disabled)')?.focus()
    }
    doc.addEventListener('keydown', onKey)
    return () => doc.removeEventListener('keydown', onKey)
  }, [editor, disabled, noPanel, typeKey, cellsSelected])
  const run = (command: (e: VisualEditor) => unknown): void => {
    if (!editor || off) return
    props.onBeforeCommand()
    command(editor)
    editor.focus()
  }
  const current = state.style
  const styleName = current === null || current === 'p' ? ui.text : ui.heading(Number(current.slice(1)))
  const inCell = state.table !== null
  const styleOff = pale || state.styleOff || inCell
  const styleOffText = inCell ? tp.offCellStyle : (plateOff ?? (state.styleOff ? tp.offStyle : undefined))
  const styleItems = STYLE_ITEMS.map((id) => ({
    value: id,
    label: id === 'p' ? ui.text : ui.heading(Number(id.slice(1))),
    keys: keyLabel(id === 'p' ? '0' : id.slice(1), mac, { alt: true }),
    ...(id !== 'p' && Number(id.slice(1)) > above + 1 ? { note: ui.skipsLevel } : {}),
  }))
  // the icons of the blocks of the wide capsule are one stop of Tab (the one that was left last, the first before that); ←/→ go round, Home and End to the ends
  const blocks = wideBlocks(locale, props.blocks)
  const [blockAt, setBlockAt] = useState<InsertKind>(() => (blocks.heads[0] ?? blocks.rest[0])?.id ?? 'heading2')
  const showPlus = !wide || props.blocks === 'frequent'
  const icons = (): HTMLButtonElement[] => Array.from(rootRef.current?.querySelectorAll<HTMLButtonElement>(':scope > .tl-main button[data-block]') ?? [])
  const blockButton = (item: BlockItem): ReactElement => {
    const cellOffText = inCell && !disabled ? cellOff(item.id, tp) : undefined
    const dim = off || cellOffText !== undefined
    const bound = tip(`b-${item.id}`, { name: item.label, text: item.hint, ...(item.keys ? { keys: [item.keys] } : {}), ...(cellOffText ? { off: cellOffText } : {}) }, 'blocks')
    return (
      <button
        key={item.id}
        type="button"
        className="tb-b tl-blk"
        data-block={item.id}
        tabIndex={item.id === blockAt ? 0 : -1}
        aria-label={item.label}
        aria-disabled={dim}
        disabled={disabled ? true : undefined}
        {...bound}
        onFocus={(e) => {
          setBlockAt(item.id)
          bound.onFocus(e)
        }}
        onClick={(event) => {
          if (dim) return
          const r = event.currentTarget.getBoundingClientRect()
          props.onPickBlock(item.id, { left: r.left, top: r.top, bottom: r.bottom })
        }}
      >
        {blockIcon(item.id)}
      </button>
    )
  }
  const onBlockKey = (event: ReactKeyboardEvent): void => {
    const active = document.activeElement as HTMLElement | null
    if (!active?.hasAttribute('data-block') || !rootRef.current?.contains(active)) return
    if (event.key === 'Escape') {
      event.preventDefault()
      tips.hide()
      editor?.focus()
      return
    }
    const all = icons()
    const here = all.indexOf(active as HTMLButtonElement)
    const next = here < 0 ? null : iconKey(event, here, all.length)
    if (next === null) return
    event.preventDefault()
    const el = all[next]!
    setBlockAt(el.dataset.block as InsertKind)
    el.focus({ preventScroll: true })
    // a move by the arrows shows the popup at once
    tips.showNow(`b-${el.dataset.block}`, el, 'blocks')
  }
  return (
    <div
      ref={rootRef}
      className="isle isle-tools ed-format"
      role="toolbar"
      aria-label={ui.formatting}
      data-hang=""
      data-table={tableRow ? 'true' : 'false'}
      data-view={wide ? 'wide' : 'narrow'}
      onMouseDown={keepSelection}
    >
      <div className="tl-main" onKeyDown={onBlockKey}>
        {showPlus && (
          <button
            type="button"
            className="tb-b tl-plus"
            data-cmd="insert"
            aria-haspopup="menu"
            aria-expanded={open === 'insert'}
            aria-disabled={off}
            disabled={disabled ? true : undefined}
            aria-label={ui.insertBlock}
            {...tip('plus', { name: ui.insertBlock, text: tp.plus, keys: ['/'], note: tp.plusNote })}
            onClick={(e) => {
              if (off) return
              props.onBeforeCommand()
              props.onInsert(e.currentTarget, e.detail === 0)
            }}
          >
            <PlusIcon />
          </button>
        )}
        <Dropdown
          className="tb-b tl-style"
          wrapClass="tl-style-wrap"
          cmd="style"
          bounds={() => props.scroller.parentElement}
          items={styleItems}
          value={(STYLE_ITEMS as readonly string[]).includes(current ?? '') ? current : null}
          label={ui.paragraphStyle}
          ariaLabel={ui.paragraphStyle}
          disabled={styleOff}
          hardDisabled={disabled}
          tip={tip('style', {
            name: ui.paragraphStyle,
            text: tp.style,
            keys: ['0', '2', '3', '4', '5', '6'].map((n) => keyLabel(n, mac, { alt: true })),
            note: tp.styleNote,
            ...(styleOffText ? { off: styleOffText } : {}),
          })}
          onOpenChange={setStyleOpen}
          onOpen={() => {
            props.onBeforeCommand()
            setAbove(headingAbove(editor))
          }}
          onPick={(id) => props.onStyle(id as StyleId)}
        >
          <span className="tl-style-name">
            {(styleItems.some((item) => item.label === styleName) ? styleItems.map((i) => i.label) : [...styleItems.map((i) => i.label), styleName]).map(
              (label) => {
                const here = label === styleName
                return (
                  <span key={label} className={here ? 'tl-style-label' : 'tl-style-label is-hidden'} aria-hidden={here ? undefined : true}>
                    {label}
                  </span>
                )
              },
            )}
          </span>
        </Dropdown>
        {wide && blocks.heads.length > 0 && <span className="tb-sep tl-sep" />}
        {wide && blocks.heads.map(blockButton)}
        <span className="tb-sep tl-sep" />
        <div className="tl-lists">
          {LISTS.map((b) => {
            const lOff = off || state.listOff
            return (
              <button
                key={b.key}
                type="button"
                className={`tb-b tl-${b.key}`}
                data-cmd={b.key}
                aria-pressed={state.list === b.list}
                aria-disabled={lOff}
                aria-label={t[b.label]}
                {...tip(b.key, {
                  name: t[b.label],
                  text: tp[b.key],
                  ...(b.key === 'check' ? {} : { keys: [b.key === 'ul' ? '*' : '1.'], note: tp[b.key === 'ul' ? 'ulNote' : 'olNote'] }),
                  ...(state.listOff || state.plate ? { off: state.plate ? plateOff : tp.offList } : {}),
                })}
                disabled={disabled ? true : undefined}
                onClick={() => !lOff && run((e) => e.commands.toggleList(b.list))}
              >
                <b.Icon />
              </button>
            )
          })}
        </div>
        {wide && <span className="tb-sep tl-sep" />}
        {wide && blocks.rest.map(blockButton)}
        {disabled && <span className="tb-note">{ui.textMode}</span>}
      </div>
      {rowState && editor && (
        <div
          className={`tl-table${rowBack ? ' is-back' : ''}${rowLeaving ? ' is-leaving' : ''}`}
          aria-hidden={rowLeaving ? 'true' : undefined}
          ref={(el) => {
            if (el) el.inert = rowLeaving
          }}
        >
          <div className={`tl-row${props.cellRow && !rowLeaving ? ' tl-colors' : ''}`} role="toolbar" aria-label={t.tableBar.label}>
            {props.cellRow && !rowLeaving ? props.cellRow : <TableTools
              editor={editor}
              locale={locale}
              state={rowState}
              onBeforeCommand={props.onBeforeCommand}
              onCellFill={rowLeaving ? noFill : props.onCellFill}
              cellFillOpen={!rowLeaving && open === 'cell'}
              tips={rowLeaving ? QUIET_TIPS : tips}
            />}
            {colorsLeaving && (
              <div className="tl-colors-out" aria-hidden="true" ref={(el) => { if (el) el.inert = true }}>
                {cloneElement(heldColors as ReactElement<{ leaving?: boolean; keyboard?: boolean }>, { leaving: true, keyboard: false })}
              </div>
            )}
          </div>
        </div>
      )}
      <RowGhost locale={locale} blocks={props.blocks} labels={styleItems.map((i) => i.label)} disabled={disabled} />
      {tips.node}
    </div>
  )
}
