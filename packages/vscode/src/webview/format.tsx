/**
 * The formatting layer of a tab: the capsule of tools over the document (`tools.tsx`), the panel over the selection, the field of a
 * link and the window of colour, the last three of `@nota-adoc/react`. One React root in the place of the capsule; its cards go by
 * a portal under it, the panel and the windows into the element the editor is in. The page tells it the editor, the mode and the answers of the host; it asks the page for what only
 * the page can do (the sections, the files, a command with the refusal it may get).
 */
import type { InsertKind, VisualEditor } from '@nota-adoc/prosemirror'
import {
  AlignRow,
  BlockBar,
  BlockHandle,
  BUBBLE_FOLD_MS,
  BubbleMenu,
  CellMenu,
  ColorPopover,
  reducedMotion,
  type FileList,
  LinkPopover,
  ImagePicker,
  type Locale,
  type SectionItem,
  FILL_ROLES,
  SlashMenu,
  TEXT_COLOR_ROLES,
  messages,
  useEditorState,
} from '@nota-adoc/react'
import { type ReactElement, cloneElement, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { schema } from '@nota-adoc/prosemirror'
import { type BlockSet, BlockList, cellOff, inCapsule, rowFits } from './block-insert.js'
import { Tools } from './tools.js'

/** How long a card or a window stays after it is closed, so that it fades out (ms); the style sheet has the same 0.12 s. */
const LEAVE_MS = 120

/** Where a window was opened from: the capsule over the document, or the panel over the selection. */
type Place = 'capsule' | 'bubble' | 'cellbar'

/**
 * A card or a window that goes: for 0.12 s after it is closed it stays, hidden with `visibility` and taking no clicks, and fades out
 * (`.is-leaving` in the style sheet); then it leaves the page.
 */
function Leaving(props: { children: ReactElement | false | null | undefined }): ReactElement | null {
  const kept = useRef<ReactElement | null>(null)
  const [, redraw] = useState(0)
  const open = Boolean(props.children)
  if (props.children) kept.current = props.children
  useEffect(() => {
    if (open || !kept.current) return
    const timer = setTimeout(() => {
      kept.current = null
      flushSync(() => redraw((n) => n + 1))
    }, LEAVE_MS)
    return () => clearTimeout(timer)
  }, [open])
  if (!kept.current) return null
  return (
    <div className={open ? 'leave' : 'leave is-leaving'} style={{ display: 'contents' }} aria-hidden={open ? undefined : true}>
      {open ? kept.current : cloneElement(kept.current as ReactElement<{ leaving?: boolean }>, { leaving: true })}
    </div>
  )
}

/**
 * the row of colours of the panel that was closed stays for `BUBBLE_FOLD_MS` + a moment (the panel narrows to its buttons while it fades out, `inert`);
 * then it goes. `drop` (the selection moved, the panel goes with its row) and the wish for no motion: it goes at once.
 */
function useHeldRow(row: ReactElement | null, drop: { current: boolean }, selectionKey: string): { row: ReactElement | null; leaving: boolean } {
  const kept = useRef<{ row: ReactElement; key: string } | null>(null)
  const [, redraw] = useState(0)
  if (row) {
    kept.current = { row, key: selectionKey }
    drop.current = false
    // (the row that goes with the selection it was opened for: when the selection has moved, nothing of it is kept for a panel at another word)
  } else if (drop.current || reducedMotion() || (kept.current && kept.current.key !== selectionKey)) kept.current = null
  const open = Boolean(row)
  useEffect(() => {
    if (open || !kept.current) return
    const timer = setTimeout(() => {
      kept.current = null
      flushSync(() => redraw((n) => n + 1))
    }, BUBBLE_FOLD_MS + 20)
    return () => clearTimeout(timer)
  }, [open])
  if (row) return { row, leaving: false }
  return { row: kept.current ? cloneElement(kept.current.row as ReactElement<{ leaving?: boolean }>, { leaving: true }) : null, leaving: Boolean(kept.current) }
}

/** What a command of the layer got: done, or refused with this code and text. */
export interface Attempt {
  ok: boolean
  reject: { code: string; text: string } | null
}

export interface FormatHost {
  locale: Locale
  /** The element the capsule of tools is drawn in, the one its cards hang in, and the one the panel and the windows are placed in (`position: relative`). */
  toolbar: HTMLElement
  cards: HTMLElement
  layer: HTMLElement
  /** The element that scrolls the document. */
  scroller: HTMLElement
  /** Runs a command of the editor and tells whether it was refused. */
  attempt(command: () => boolean): Attempt
  /** Like `attempt`, for a command that is a step of the history of its own (a block moved, captioned, anchored, deleted). */
  attemptStep(command: () => boolean): Attempt
  /** A block that was dragged could not be put where it was let go. */
  moveRefused(): void
  /** The message of an earlier refusal goes away. */
  beforeCommand(): void
  sections(): readonly SectionItem[]
  /** Asks the host for the files; the answer comes back through `answerFiles`. */
  listFiles(query: string, kind?: 'adoc' | 'image'): Promise<FileList>
  /** The path to write for a picture picked from the list (from the folder of the file): from `:imagesdir:` when the document sets one. */
  imagePath(picked: string): string
  /** the set of the blocks of the open capsule at the start (`nota.blocksInCapsule`); `all` when not given. */
  blocks?: BlockSet
}

export interface Format {
  setEditor(editor: VisualEditor | undefined): void
  setDisabled(disabled: boolean): void
  /** the set of the blocks of the open capsule changed (`nota.blocksInCapsule`): the capsule is drawn again, the windows close, the tab stays. */
  setBlocks(set: BlockSet): void
  /** Closes the windows (the editor is going away, or the mode changed). */
  closeWindows(): void
  destroy(): void
}

type Popover =
  | { kind: 'link' | 'color' | 'fill' | 'cell' | 'align'; anchor: HTMLElement; keyboard: boolean; place: Place }
  /** The list «Вставить блок» of «+» (the narrow capsule; the wide one has the blocks as icons and no «+»). */
  | { kind: 'insert'; anchor: HTMLElement; keyboard: boolean; place: Place; startId?: InsertKind }
  /** The picker of a picture: under the button «Вставить», or where the menu of «/» was (`at`). */
  | { kind: 'image'; anchor: HTMLElement | null; at?: { left: number; top: number; bottom: number }; keyboard: boolean; place?: Place }
  | null

/** The target of the link under the cursor or on all the selection, or null. */
export function linkAt(editor: VisualEditor): string | null {
  const state = editor.view.state
  const { from, to, empty, $from } = state.selection
  const type = schema.marks.link!
  if (empty) return (type.isInSet(state.storedMarks ?? $from.marks())?.attrs.href as string | undefined) ?? null
  const hrefs = new Set<string | null>()
  state.doc.nodesBetween(from, to, (node) => {
    if (node.isText) hrefs.add((type.isInSet(node.marks)?.attrs.href as string | undefined) ?? null)
    return true
  })
  const [only] = hrefs
  return hrefs.size === 1 && only ? only : null
}

interface AppProps {
  host: FormatHost
  editor: VisualEditor | undefined
  disabled: boolean
  /** which blocks the open capsule shows (`nota.blocksInCapsule`). */
  blocks: BlockSet
  /** Grows when the windows must go: they close through the state, the capsule stays mounted. */
  closing: number
}

function App({ host, editor, disabled, blocks, closing }: AppProps): ReactElement {
  const { locale } = host
  const [popover, setPopover] = useState<Popover>(null)
  // the windows go in the very render that brings the new counter (no effect between: the render stays synchronous)
  const [seenClosing, setSeenClosing] = useState(closing)
  if (seenClosing !== closing) {
    setSeenClosing(closing)
    setPopover(null)
  }
  // the roles under the cursor follow the state of the editor
  const state = useEditorState(editor)
  
  /** The row of capsules over the page. */
  const capsules = useCallback((): HTMLElement | null => host.layer.ownerDocument.querySelector<HTMLElement>('.ed-isles'), [host.layer])
  /** Its `--tools-bottom` says how low the capsule reaches (the panel over a word stays below it). */
  const underCapsules = (): number => {
    const isles = capsules()
    const low = Number.parseFloat(isles?.style.getPropertyValue('--tools-bottom') ?? '')
    return isles && Number.isFinite(low) ? isles.getBoundingClientRect().top + low : 0
  }
  const close = useCallback(
    (restore: boolean) => {
      setPopover(null)
      if (restore) editor?.focus()
    },
    [editor],
  )

  const placeOf = (anchor: HTMLElement): Place => (host.toolbar.contains(anchor) ? 'capsule' : 'bubble')
  const openLink = (anchor: HTMLElement, keyboard = false): void => setPopover({ kind: 'link', anchor, keyboard, place: placeOf(anchor) })
  // the colours stand in place of the row they were opened from; «‹» and Esc bring the row back and the focus goes to its button
  const refocus = useRef<{ place: Place; cmd: string } | null>(null)
  useEffect(() => {
    if (popover || !refocus.current) return
    const { place, cmd } = refocus.current
    refocus.current = null
    const scope = place === 'cellbar' ? host.layer.querySelector('.cellbar') : place === 'bubble' ? host.layer.querySelector('.bubble:not(.cellbar)') : host.toolbar
    scope?.querySelector<HTMLElement>(`[data-cmd="${cmd}"]`)?.focus({ preventScroll: true })
  }, [popover, host])
  const back = (): void => {
    if (popover && (popover.kind === 'color' || popover.kind === 'fill' || popover.kind === 'cell' || popover.kind === 'align'))
      refocus.current = { place: popover.place, cmd: popover.kind === 'cell' ? 'cell-fill' : popover.kind }
    setPopover(null)
  }
  // a row of colours closes when the selection moves (the ends, or how many cells), whatever moved it; the focus stays where the user went
  const selectionKey = `${state.from}:${state.to}:${state.table?.cells ?? 0}`
  const rowSeen = useRef<{ popover: Popover; key: string }>({ popover: null, key: selectionKey })
  const dropRow = useRef(false)
  const dropCellRow = useRef(false)
  useEffect(() => {
    const row = popover?.kind === 'color' || popover?.kind === 'fill' || popover?.kind === 'cell' || popover?.kind === 'align'
    if (!row) {
      rowSeen.current = { popover, key: selectionKey }
      return
    }
    if (rowSeen.current.popover !== popover) rowSeen.current = { popover, key: selectionKey }
    else if (rowSeen.current.key !== selectionKey) {
      // a row opened by the keyboard has the focus on a circle: it goes back to the text, not to the body
      // (the panel goes in the very render that brings the new selection, so the circle that had the focus may be gone already: the focus is on the page)
      const active = host.layer.ownerDocument.activeElement as HTMLElement | null
      const inRow = Boolean(active?.closest('.cr')) || (popover?.keyboard === true && (!active || active === host.layer.ownerDocument.body))
      dropRow.current = true
      dropCellRow.current = true
      setPopover(null)
      if (inRow) editor?.focus()
    }
  }, [popover, selectionKey, host, editor])
  // the cell that gets the fill is framed while the row of colours is open (several cells are framed by their own selection)
  useEffect(() => {
    if (!editor || popover?.kind !== 'cell') return
    editor.markFillTarget(true)
    return () => editor.markFillTarget(false)
  }, [editor, popover?.kind])
  const toggle = (kind: 'color' | 'fill' | 'cell', anchor: HTMLElement, keyboard = false): void => {
    if (popover?.kind === kind) return close(false)
    if (editor && kind !== 'cell') {
      // nothing selected, or what is selected shows no colour (code): the strip says why, and the file stays as it is
      if (editor.view.state.selection.empty) {
        host.attempt(() => editor.commands.setTextColor(null))
        return setPopover(null)
      }
      if (state.plate) {
        host.attempt(() => (kind === 'color' ? editor.commands.setTextColor(TEXT_COLOR_ROLES[0]!) : editor.commands.setFill(FILL_ROLES[0]!)))
        return setPopover(null)
      }
    }
    setPopover({ kind, anchor, keyboard, place: kind === 'cell' ? 'capsule' : placeOf(anchor) })
  }
  /** «Заливка ячеек ⌄» or «Выравнивание ⌄» of the capsule of cells: its row stands in place of its buttons. */
  const openCellRow = (kind: 'fill' | 'align', anchor: HTMLElement, keyboard: boolean): void => {
    if (kind === 'fill') setPopover({ kind: 'cell', anchor, keyboard, place: 'cellbar' })
    else setPopover({ kind: 'align', anchor, keyboard, place: 'cellbar' })
  }

  /** A block was chosen (an icon of the wide capsule, `rect` is its place, or an item of the list of «+»): «Картинка» asks for the file first (under the icon, under «+» from the list), the rest go in at once. */
  const pickBlock = (id: InsertKind, anchor: HTMLElement, rect: { left: number; top: number; bottom: number } | null): void => {
    if (!editor) return
    if (state.table !== null && cellOff(id, messages[locale].tips)) return
    if (id === 'image') {
      setPopover({ kind: 'image', anchor: rect ? null : anchor, ...(rect ? { at: rect } : {}), keyboard: false })
      return
    }
    host.beforeCommand()
    host.attempt(() => editor.commands.insertBlock(id, { title: messages[locale].details }))
    close(true)
  }
  // the view of the capsule, wide (open, the blocks as icons) or narrow («+»), follows what the invisible copy of the wide capsule measures against the room
  // between the side capsules; it depends on nothing else (no state of its own, so no flicker at the edge). null until the first measure.
  const [wide, setWide] = useState<boolean | null>(null)
  const wideRef = useRef<boolean | null>(null)
  /** The block the focus was on when the view changed: the focus goes to the same block of the other view. */
  const carry = useRef<{ to: 'list' | 'icons'; id: InsertKind | undefined } | null>(null)
  const apply = useCallback(
    (next: boolean): void => {
      if (wideRef.current === next) return
      const active = host.layer.ownerDocument.activeElement as HTMLElement | null
      if (wideRef.current !== null) {
        if (next) {
          // the list was open and the focus was on its item: the focus goes to the icon of that block; the list goes
          const id = active?.closest('.blocklist') ? (active.dataset.block as InsertKind | undefined) : undefined
          // with `frequent` «+» stays; a list whose focus is on a block the capsule has not goes on under «+», the others go to their icon
          if (id && !inCapsule(id, blocks)) carry.current = null
          else {
            carry.current = id ? { to: 'icons', id } : null
            setPopover((now) => (now?.kind === 'insert' && (blocks === 'all' || id) ? null : now))
          }
        } else {
          // the focus was on an icon: the list opens with the same block; elsewhere in the capsule it just folds
          const id = active?.closest('.isle-tools') ? (active.dataset.block as InsertKind | undefined) : undefined
          carry.current = id ? { to: 'list', id } : null
        }
      }
      wideRef.current = next
      setWide(next)
    },
    [host, blocks],
  )
  // with `frequent` the CSS keeps the short word of «Замечания» up to 800 px (`.ed-isles[data-blocks]`), so the room of the capsule does not change
  // at 720 px and the view turns once, at 650 px; it is set before the measure
  useLayoutEffect(() => {
    host.toolbar.closest('.ed-isles')?.setAttribute('data-blocks', blocks)
  }, [host, blocks])
  useLayoutEffect(() => {
    apply(rowFits(host.toolbar))
    if (typeof ResizeObserver === 'undefined') return
    // the tab, the capsule on the right (the remarks come and go) or the words changed; the measure runs in the next frame (inside the callback it makes «ResizeObserver loop»)
    let frame = 0
    const watch = new ResizeObserver(() => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        apply(rowFits(host.toolbar))
      })
    })
    watch.observe(host.layer)
    const isles = host.toolbar.closest('.ed-isles')
    if (isles) watch.observe(isles)
    const right = isles?.querySelector('.isle-right')
    if (right) watch.observe(right)
    // the invisible copy: a web font that comes after the first measure changes its width
    const ghost = host.toolbar.querySelector('.tl-measure .tl-main')
    if (ghost) watch.observe(ghost)
    return () => {
      watch.disconnect()
      if (frame) cancelAnimationFrame(frame)
    }
  }, [host, apply, locale, disabled])
  useLayoutEffect(() => {
    const move = carry.current
    if (!move || wide === null) return
    carry.current = null
    if (move.to === 'icons' && wide) {
      const id = move.id!
      const list = ({ unordered: 'ul', ordered: 'ol', checklist: 'check' } as Record<string, string>)[id]
      host.toolbar.querySelector<HTMLElement>(list ? `[data-cmd="${list}"]` : `button[data-block="${id}"]`)?.focus({ preventScroll: true })
    } else if (move.to === 'list' && !wide) {
      const plus = host.toolbar.querySelector<HTMLElement>('[data-cmd="insert"]')
      if (plus) setPopover({ kind: 'insert', anchor: plus, keyboard: true, place: 'capsule', ...(move.id ? { startId: move.id } : {}) })
    }
  }, [wide, host])

  const colorKind = popover?.kind === 'color' || popover?.kind === 'fill' || popover?.kind === 'cell' ? { ...popover, kind: popover.kind } : null
  const alignRow: ReactElement | null =
    editor && popover?.kind === 'align' ? (
      <AlignRow
        key="align"
        locale={locale}
        halign={state.table?.selection?.halign ?? null}
        valign={state.table?.selection?.valign ?? null}
        keyboard={popover.keyboard}
        onPick={(h, v) => {
          host.beforeCommand()
          host.attempt(() => editor.commands.setCellAlign(h, v))
          // (the row stays; by the mouse the cursor stays in the text)
          if (!popover.keyboard) editor.focus()
        }}
        onBack={back}
      />
    ) : null
  const colorRow = (back_: 'table' | 'bar'): ReactElement | null =>
    editor && colorKind ? (
      <ColorPopover
        key={colorKind.kind}
        locale={locale}
        kind={colorKind.kind}
        anchor={colorKind.anchor}
        container={host.layer}
        keyboard={colorKind.keyboard}
        roles={colorKind.kind === 'cell' ? (editor.tableAt()?.fill ? [editor.tableAt()!.fill!] : []) : editor.colorAt()}
        {...(colorKind.kind === 'cell' ? { cells: cellsOf(editor) } : {})}
        row={{ back: back_, onBack: back }}
        onPick={(role) => {
          if (colorKind.kind === 'cell') host.attempt(() => editor.commands.setCellFill(role))
          if (colorKind.kind === 'color') host.attempt(() => editor.commands.setTextColor(role))
          else if (colorKind.kind === 'fill') host.attempt(() => editor.commands.setFill(role))
          close(true)
        }}
        onClose={close}
      />
    ) : null
  const bubbleRow = useHeldRow(colorKind && colorKind.place === 'bubble' && colorKind.kind !== 'cell' ? colorRow('bar') : null, dropRow, selectionKey)
  const cellBarOpen = popover && popover.kind !== 'image' && popover.kind !== 'insert' && popover.place === 'cellbar' ? popover : null
  const cellBarRow = useHeldRow(cellBarOpen ? (cellBarOpen.kind === 'align' ? alignRow : colorRow('bar')) : null, dropCellRow, selectionKey)
  const inBubble = popover && popover.kind !== 'image' && popover.kind !== 'insert' && popover.place === 'bubble' ? popover.kind : null
  return (
    <>
      <Tools
        editor={editor}
        locale={locale}
        disabled={disabled}
        open={popover && popover.kind !== 'image' && !inBubble && !cellBarOpen ? popover.kind : null}
        cellRow={colorKind?.kind === 'cell' && colorKind.place === 'capsule' ? colorRow('table') : null}
        onBeforeCommand={host.beforeCommand}
        wide={wide}
        blocks={blocks}
        onInsert={(a, keyboard) => (popover?.kind === 'insert' ? close(false) : setPopover({ kind: 'insert', anchor: a, keyboard, place: 'capsule' }))}
        onPickBlock={(id, rect) => pickBlock(id, host.toolbar, rect)}
        onStyle={(style) => {
          host.attempt(() =>
            style === 'p' ? editor!.commands.setBlockType('paragraph') : editor!.commands.setBlockType('heading', Number(style.slice(1))),
          )
          editor?.focus()
        }}
        onCellFill={(a, k) => toggle('cell', a, k)}
        scroller={host.scroller}
      />
      {createPortal(
        <>
          <SlashMenu
            editor={editor}
            locale={locale}
            container={host.layer}
            disabled={disabled}
            suspended={popover?.kind === 'image'}
            topLimit={underCapsules}
            onBeforeCommand={host.beforeCommand}
            onImage={() => {
              const rect = editor?.slashAt()?.rect
              setPopover({
                kind: 'image',
                anchor: null,
                ...(rect ? { at: { left: rect.left, top: rect.top, bottom: rect.bottom } } : {}),
                keyboard: false,
              })
            }}
          />
          <BubbleMenu
            editor={editor}
            locale={locale}
            container={host.layer}
            scroller={host.scroller}
            topLimit={underCapsules}
            limitWatch={capsules}
            avoid={() => host.layer.ownerDocument.querySelectorAll('.isle-strokes, .blockbar, .pagemeta-badge')}
            disabled={disabled}
            open={inBubble === 'color' || inBubble === 'fill' || inBubble === 'link' ? inBubble : null}
            row={bubbleRow.row}
            rowLeaving={bubbleRow.leaving}
            onBeforeCommand={host.beforeCommand}
            onLink={(a) => (popover?.kind === 'link' ? close(false) : openLink(a))}
            onColor={(kind, a, k) => toggle(kind, a, k)}
          />
          <CellMenu
            editor={editor}
            locale={locale}
            container={host.layer}
            scroller={host.scroller}
            topLimit={underCapsules}
            limitWatch={capsules}
            avoid={() => host.layer.ownerDocument.querySelectorAll('.isle-strokes, .blockbar, .pagemeta-badge, .nota-grips .cg, .nota-grips .rg, .nota-grips .gb:not([hidden]), .nota-grips .gtip:not([hidden])')}
            disabled={disabled}
            hidden={popover?.kind === 'insert'}
            open={cellBarOpen ? (cellBarOpen.kind === 'align' ? 'align' : 'fill') : null}
            row={cellBarRow.row}
            rowLeaving={cellBarRow.leaving}
            onBeforeCommand={host.beforeCommand}
            onRow={openCellRow}
          />
          <BlockBar
            editor={editor}
            locale={locale}
            container={host.layer}
            scroller={host.scroller}
            disabled={disabled}
            topLimit={underCapsules}
            onBeforeCommand={host.beforeCommand}
          />
          <BlockHandle
            editor={editor}
            locale={locale}
            container={host.layer}
            scroller={host.scroller}
            disabled={disabled}
            topLimit={underCapsules}
            onBeforeCommand={host.beforeCommand}
            attempt={host.attemptStep}
            onMoveRefused={host.moveRefused}
          />
          <Leaving>
          {editor && popover?.kind === 'insert' && (
            <BlockList
              key="insert"
              locale={locale}
              anchor={popover.anchor}
              container={host.layer}
              keyboard={popover.keyboard}
              startId={popover.startId}
              inCell={state.table !== null}
              onPick={(id) => pickBlock(id, popover.anchor, null)}
              onClose={close}
            />
          )}
          </Leaving>
          <Leaving>
          {editor && popover?.kind === 'link' && (
            <LinkPopover
              key="link"
              locale={locale}
              anchor={popover.anchor}
              container={host.layer}
              current={linkAt(editor)}
              listSections={host.sections}
              listFiles={host.listFiles}
              onApply={(target) => {
                const result = host.attempt(() => editor.commands.setLink(target))
                if (result.ok) {
                  close(true)
                  return true
                }
                // an address the engine does not take stays in the field with the reason; any other refusal is in the strip
                if (result.reject?.code === 'bad-target') {
                  host.beforeCommand()
                  return result.reject.text
                }
                close(true)
                return true
              }}
              onRemove={() => {
                host.attempt(() => editor.commands.removeLink())
                close(true)
              }}
              onClose={close}
            />
          )}
          </Leaving>
          {editor && popover?.kind === 'image' && (
            <ImagePicker
              key="image"
              locale={locale}
              anchor={popover.anchor}
              {...(popover.at ? { at: popover.at } : {})}
              topLimit={underCapsules}
              container={host.layer}
              listFiles={(query) => host.listFiles(query, 'image')}
              onPick={(path) => {
                host.beforeCommand()
                host.attempt(() => editor.commands.insertBlock('image', { path: host.imagePath(path) }))
                close(true)
              }}
              onClose={close}
            />
          )}
        </>,
        host.layer,
      )}
    </>
  )
}

/** How many cells the fill of cells goes to, whether their fills differ, and how the cell under the cursor is spanned. */
function cellsOf(editor: VisualEditor): { count: number; mixed: boolean; span: string } {
  const table = editor.tableAt()
  return { count: table?.cells ?? 1, mixed: table?.mixedFill ?? false, span: table?.span ?? '' }
}

export function mountFormat(host: FormatHost): Format {
  const root = createRoot(host.toolbar)
  let editor: VisualEditor | undefined
  let disabled = false
  let blocks: BlockSet = host.blocks ?? 'all'
  // the layer is drawn again when a window must go (the editor or the mode changed), by a new key
  let generation = 0
  let closing = 0
  const render = (): void => {
    flushSync(() => root.render(<App key={generation} host={host} editor={editor} disabled={disabled} blocks={blocks} closing={closing} />))
  }
  render()
  return {
    setEditor(next) {
      if (next === editor) return
      editor = next
      generation++
      render()
    },
    setDisabled(next) {
      if (next === disabled) return
      disabled = next
      generation++
      render()
    },
    setBlocks(next) {
      if (next === blocks) return
      blocks = next
      generation++
      render()
    },
    closeWindows() {
      closing++
      render()
    },
    destroy() {
      root.unmount()
    },
  }
}
