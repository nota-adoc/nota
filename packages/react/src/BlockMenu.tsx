import type { InsertKind } from '@nota-adoc/prosemirror'
import type { KeyboardEvent, MouseEvent, ReactElement, ReactNode, Ref } from 'react'
import { Fragment, useEffect } from 'react'
import type { BlockItem } from './blocks.js'
import { ariaKeys } from './Tooltip.js'

export interface BlockMenuProps {
  items: readonly BlockItem[]
  /** The index of the chosen entry (-1: none). */
  at: number
  /**
   * `listbox`: the focus stays in the text, the entries are `option`s and the chosen one is `aria-selected` (the menu of «/»).
   * `menu`: the focus is in the menu, the entries are `menuitem`s and only the chosen one is in the order of Tab (the list of «+»).
   */
  mode: 'listbox' | 'menu'
  className: string
  /** The name of the menu for the screen reader, and the title shown over the entries. */
  title: string
  /** The line under the entries. */
  foot?: ReactNode
  /** The line when no entry is left. */
  empty?: ReactNode
  /** The picture of an entry (the list of «+» has them, the menu of «/» has none). */
  icon?(id: InsertKind): ReactNode
  /** Whether the chosen entry is shown as chosen (a menu opened by the mouse has none chosen yet). */
  showChosen?: boolean
  onPick(id: InsertKind): void
  onHover?(index: number): void
  onKeyDown?(event: KeyboardEvent<HTMLElement>): void
  ref?: Ref<HTMLDivElement>
  style?: React.CSSProperties
  idPrefix?: string
  /** The entries scroll between the title and the foot (the list of «+»); else the whole menu scrolls. */
  scroll?: boolean
  /** No title over the entries (the name stays for the screen reader). */
  bare?: boolean
  /** The keys of an entry are not shown next to its name (the list of «+» leaves them to the popups). */
  hideKeys?: boolean
  /** The group of an entry: a thin line stands between two groups. */
  groupOf?(id: InsertKind): number
  /** Why an entry is off: it is dimmed, `aria-disabled`, the reason stands instead of its line, a press does nothing. */
  offOf?(id: InsertKind): string | undefined
}

/**
 * The entries of a menu of blocks, one for the menu of «/» and the list of «+»: the name, the line under it, the chosen one kept in sight
 * while the menu scrolls. The place and the keys are those of the menu that draws it.
 */
export function BlockMenu(props: BlockMenuProps): ReactElement {
  const { items, at, mode, showChosen = true } = props
  const listbox = mode === 'listbox'
  const prefix = props.idPrefix ?? 'bm'
  useEffect(() => {
    if (!showChosen || at < 0) return
    const el = document.getElementById(`${prefix}-${items[at]?.id}`)
    el?.scrollIntoView?.({ block: 'nearest' })
  }, [at, showChosen, items, prefix])
  const wrap = (body: ReactNode): ReactNode => (props.scroll ? <div className="bm-scroll">{body}</div> : body)
  return (
    <div
      ref={props.ref}
      className={props.className}
      role={listbox ? 'listbox' : 'menu'}
      aria-label={props.title}
      style={props.style}
      onMouseDown={(event: MouseEvent) => {
        // a press on an entry does not take the selection from the text
        if ((event.target as Element).closest('button')) event.preventDefault()
      }}
      onKeyDown={props.onKeyDown}
    >
      {!props.bare && <div className="sm-head">{props.title}</div>}
      {items.length === 0 && props.empty}
      {wrap(
        items.map((item, i) => {
          const chosen = i === at && showChosen
          const off = props.offOf?.(item.id)
          const sep = props.groupOf && i > 0 && props.groupOf(item.id) !== props.groupOf(items[i - 1]!.id)
          return (
            <Fragment key={item.id}>
              {sep && <span className="bm-sep" role="separator" />}
            <button
              id={`${prefix}-${item.id}`}
              type="button"
              role={listbox ? 'option' : 'menuitem'}
              data-block={item.id}
              aria-keyshortcuts={item.keys ? ariaKeys(item.keys) : undefined}
              {...(listbox ? { 'aria-selected': chosen } : { 'aria-label': item.label, 'aria-describedby': `${prefix}-${item.id}-hint`, tabIndex: i === Math.max(at, 0) ? 0 : -1, 'data-on': chosen ? '' : undefined })}
              onMouseEnter={() => props.onHover?.(i)}
              aria-disabled={off ? true : undefined}
              onClick={() => !off && props.onPick(item.id)}
            >
              {props.icon && <span className="bm-icon" aria-hidden="true">{props.icon(item.id)}</span>}
              {item.keys && !props.hideKeys ? (
                <span className="sm-top">
                  <span className="sm-name">{item.label}</span>
                  <kbd className="sm-keys" aria-hidden="true">{item.keys}</kbd>
                </span>
              ) : (
                <span className="sm-name">{item.label}</span>
              )}
              <small className="sm-hint" id={`${prefix}-${item.id}-hint`}>{off ?? item.hint}</small>
            </button>
            </Fragment>
          )
        }),
      )}
      {props.foot}
    </div>
  )
}
