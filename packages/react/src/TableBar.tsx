import type { VisualEditor } from '@nota-adoc/prosemirror'
import type { ReactElement } from 'react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  ColAddIcon,
  ColDelIcon,
  HeadIcon,
  MergeIcon,
  NestIcon,
  RowAddIcon,
  RowDelIcon,
  SplitIcon,
  TrashIcon,
} from './icons.js'
import type { Locale } from './locale.js'
import { messages } from './messages.js'
import { ColorButton, keepSelection } from './Toolbar.js'
import { type TipContent, type Tips, isMac } from './Tooltip.js'
import { type EditorUiState, useEditorState } from './useEditorState.js'

export interface TableBarProps {
  editor: VisualEditor | undefined
  locale: Locale
  /** The element the panel is placed in (it is `position: relative`), and the one that scrolls under it. */
  container: HTMLElement
  scroller?: HTMLElement
  /** Called before a command of the panel: the message of an earlier refusal goes away. */
  onBeforeCommand?(): void
  /** The mode of the source: no panel. */
  disabled?: boolean
}

/**
 * Esc in the table hides the row of its commands until the cursor moves (`key`: the place of the cursor). An Esc that a window or a
 * list already took (`defaultPrevented`) does not count. Shared by the floating panel of the demo and the capsule of the tab.
 */
export function useTableDismiss(editor: VisualEditor | undefined, active: boolean, key: string): boolean {
  const [dismissed, setDismissed] = useState(false)
  useEffect(() => setDismissed(false), [key])
  useEffect(() => {
    if (!active || !editor || dismissed) return
    const doc = editor.view.dom.ownerDocument
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !event.defaultPrevented && editor.view.dom.contains(event.target as Node | null)) setDismissed(true)
    }
    doc.addEventListener('keydown', onKey)
    return () => doc.removeEventListener('keydown', onKey)
  }, [active, editor, dismissed])
  return dismissed
}

export interface TableToolsProps {
  editor: VisualEditor
  locale: Locale
  state: EditorUiState
  /** Called before a command: the message of an earlier refusal goes away. */
  onBeforeCommand?(): void
  /** «Заливка ячейки» was pressed: open the window under `anchor`. Without it the button is not drawn (the demo has no window). */
  onCellFill?(anchor: HTMLElement, keyboard: boolean): void
  /** The window of the fill of cells is open. */
  cellFillOpen?: boolean
  /** The popups of the buttons; without them the buttons keep their `title`. */
  tips?: Tips
}

/** The ten buttons of the commands of tables (and the mark of the level of a nested one): in the panel of the demo and in the capsule. */
export function TableTools(props: TableToolsProps): ReactElement | null {
  const { editor, locale, state } = props
  const t = messages[locale]
  const tb = t.tableBar
  const table = state.table
  if (!table) return null
  const run = (command: () => boolean): void => {
    props.onBeforeCommand?.()
    command()
    editor.focus()
  }
  const tips = props.tips
  const tp = t.tips
  const mac = isMac()
  const bind = (id: string, content: TipContent) => tips?.bind(id, content, 'row')
  const button = (
    id: string,
    label: string,
    icon: ReactElement,
    command: () => boolean,
    extra?: { pressed?: boolean; danger?: boolean; tip?: TipContent; count?: number },
  ): ReactElement => {
    const tip = extra?.tip ? bind(id, extra.tip) : undefined
    return (
      <button
        key={id}
        type="button"
        data-cmd={id}
        aria-label={label}
        {...(tip ? tip : { title: label })}
        {...(extra?.pressed !== undefined ? { 'aria-pressed': extra.pressed } : {})}
        className={extra?.danger ? 'tb-b danger' : 'tb-b'}
        onClick={() => run(command)}
      >
        {icon}
        {extra?.count !== undefined && extra.count > 1 && <span className="cnt">{extra.count}</span>}
      </button>
    )
  }
  const c = editor.commands
  const plain = (name: string, text: string): { tip: TipContent } => ({ tip: { name, text } })
  const levelTip = bind('level', { name: tp.levelName, text: tp.level(table.level) })
  const rowDelName = table.selectedRows > 1 ? tb.rowDelMany(table.selectedRows) : tb.rowDel
  const colDelName = table.selectedCols > 1 ? tb.colDelMany(table.selectedCols) : tb.colDel
  const cellName = table.fill ? `${tb.cellFill}: ${t.cellFills[table.fill]}` : tb.cellFill
  return (
    <>
      {table.level > 1 && (
        <span
          className="fl-chip"
          {...(levelTip ? { onMouseEnter: levelTip.onMouseEnter, onMouseLeave: levelTip.onMouseLeave, 'aria-describedby': levelTip['aria-describedby'] } : { title: tb.levelHint(table.level) })}
        >
          {tb.level(table.level)}
        </span>
      )}
      {button('row-add', tb.rowAdd, <RowAddIcon />, () => c.insertRow(), plain(tb.rowAdd, tp.rowAdd))}
      {button('col-add', tb.colAdd, <ColAddIcon />, () => c.insertColumn(), plain(tb.colAdd, tp.colAdd))}
      {button('row-del', rowDelName, <RowDelIcon />, () => c.deleteRow(), { ...plain(rowDelName, tp.rowDel), count: table.selectedRows })}
      {button('col-del', colDelName, <ColDelIcon />, () => c.deleteColumn(), { ...plain(colDelName, tp.colDel), count: table.selectedCols })}
      <span className="fl-sep" />
      {button('merge', tb.merge, <MergeIcon />, () => c.mergeCells(), {
        tip: { name: tp.mergeName, text: tp.merge, keys: [mac ? '⇧' : 'Shift'], note: tp.mergeNote },
      })}
      {button('split', tb.split, <SplitIcon />, () => c.splitCell(), plain(tp.splitName, tp.split))}
      {props.onCellFill && (
        <ColorButton
          kind="cell"
          className="tb-b cell-fill"
          label={tb.cellFill}
          name={table.fill ? t.cellFills[table.fill] : undefined}
          role={table.fill}
          disabled={false}
          expanded={props.cellFillOpen ?? false}
          {...(tips ? { tip: bind('cell-fill', { name: cellName, text: tp.cellFill })! } : {})}
          onPress={(a, k) => (props.onBeforeCommand?.(), props.onCellFill?.(a, k))}
        />
      )}
      {button('head', tb.head, <HeadIcon />, () => c.toggleHeader(), { pressed: table.header, ...plain(tb.head, tp.head) })}
      {button('nest', tb.nest, <NestIcon />, () => c.nestTable(), plain(tb.nest, tp.nest))}
      <span className="fl-sep" />
      {button('table-del', table.level > 1 ? tb.removeNested : tb.remove, <TrashIcon />, () => c.deleteTable(), {
        danger: true,
        ...(table.level > 1 ? plain(tp.removeNestedName, tp.removeNested) : plain(tp.removeName, tp.remove)),
      })}
    </>
  )
}

interface Spot {
  left: number
  top: number
}

/**
 * The panel over the right top corner of the table the cursor is in (the innermost one): rows, columns, merging, the head, a table
 * in the cell, and deleting the table. Esc hides it until the cursor moves.
 */
export function TableBar(props: TableBarProps): ReactElement | null {
  const { editor, locale, container, scroller, disabled = false } = props
  const t = messages[locale].tableBar
  const state = useEditorState(editor)
  const ref = useRef<HTMLDivElement>(null)
  const [spot, setSpot] = useState<Spot | null>(null)
  const [tick, setTick] = useState(0)
  const key = `${state.from}:${state.to}`
  const table = state.table
  const dismissed = useTableDismiss(editor, !disabled && table !== null, key)
  const wanted = Boolean(editor) && !disabled && table !== null && !dismissed

  useEffect(() => {
    const redo = (): void => setTick((n) => n + 1)
    const win = container.ownerDocument.defaultView
    scroller?.addEventListener('scroll', redo)
    win?.addEventListener('resize', redo)
    return () => {
      scroller?.removeEventListener('scroll', redo)
      win?.removeEventListener('resize', redo)
    }
  }, [container, scroller])

  useLayoutEffect(() => {
    if (!wanted || !editor) {
      setSpot(null)
      return
    }
    const rect = editor.tableAt()?.rect
    if (!rect || (rect.top === 0 && rect.bottom === 0)) {
      // (no layout: the panel is where the container starts)
      setSpot({ left: 8, top: 8 })
      return
    }
    const box = container.getBoundingClientRect()
    const area = (scroller ?? container).getBoundingClientRect()
    if (area.height > 0 && (rect.bottom < area.top || rect.top > area.bottom)) {
      setSpot(null)
      return
    }
    const w = ref.current?.offsetWidth ?? 0
    const h = ref.current?.offsetHeight ?? 0
    const left = Math.max(8, Math.min(rect.right - box.left - w - 6, box.width - w - 8))
    // over the corner: half of the panel above the table; under the top edge of the area when there is no room
    let top = rect.top - box.top - h / 2
    top = Math.max(top, Math.max(0, area.top - box.top) + 2)
    setSpot({ left, top })
  }, [wanted, editor, key, container, scroller, tick, state])

  if (!editor || !table || !wanted) return null
  return (
    <div
      ref={ref}
      className="fl tablebar"
      role="toolbar"
      aria-label={t.label}
      style={{ left: `${spot?.left ?? 0}px`, top: `${spot?.top ?? 0}px`, visibility: spot ? 'visible' : 'hidden' }}
      onMouseDown={keepSelection}
    >
      <TableTools editor={editor} locale={locale} state={state} onBeforeCommand={props.onBeforeCommand} />
    </div>
  )
}
