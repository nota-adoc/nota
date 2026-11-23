/**
 * The blocks of «+»: the list «Вставить блок» under the capsule of a narrow tab, and the icons of the wide capsule
 * (the same blocks, in the same order and words as the menu of «/», `slashItems`).
 */
import type { InsertKind } from '@nota-adoc/prosemirror'
import {
  BlockMenu,
  type BlockItem,
  messages,
  placeBelow,
  slashItems,
} from '@nota-adoc/react'
import { type KeyboardEvent, type ReactElement, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { type Locale, strings } from '../strings.js'
import {
  AdmonitionIcon,
  BulletListIcon,
  CheckListIcon,
  ChevronIcon,
  CodeIcon,
  CollapsibleIcon,
  HeadingGlyph,
  ImageIcon,
  MermaidIcon,
  NumberListIcon,
  PlusIcon,
  TableIcon,
} from './tool-icons.js'

/** The width of the tab (`.ed-main`, px) up to which the style sheet takes the narrow layout of the capsules (`@container (max-width: 650px)`). */
export const NARROW_TAB = 650

const ICONS: Record<InsertKind, () => ReactElement> = {
  heading2: () => <HeadingGlyph level={2} />,
  heading3: () => <HeadingGlyph level={3} />,
  heading4: () => <HeadingGlyph level={4} />,
  heading5: () => <HeadingGlyph level={5} />,
  heading6: () => <HeadingGlyph level={6} />,
  unordered: BulletListIcon,
  ordered: NumberListIcon,
  checklist: CheckListIcon,
  table: TableIcon,
  code: CodeIcon,
  mermaid: MermaidIcon,
  admonition: AdmonitionIcon,
  collapsible: CollapsibleIcon,
  image: ImageIcon,
}

/** The three groups of the blocks: the headings, the lists, the rest. */
export function groupOf(id: InsertKind): number {
  return id.startsWith('heading') ? 0 : id === 'unordered' || id === 'ordered' || id === 'checklist' ? 1 : 2
}

/** why a block cannot be set in a table cell (the headings, the lists); undefined: it goes in after the table. */
export function cellOff(id: InsertKind, tips: { offCellHeading: string; offCellList: string }): string | undefined {
  const g = groupOf(id)
  return g === 0 ? tips.offCellHeading : g === 1 ? tips.offCellList : undefined
}

export const blockIcon = (id: InsertKind): ReactNode => ICONS[id]()

/** The blocks of the menu of «/», in its order. */
export const blocksOf = (locale: Locale): readonly BlockItem[] => slashItems(messages[locale])

/**
 * Does the wide capsule fit in one line? The room is what the row of capsules leaves the capsule: in a wide tab the
 * capsule stays in the middle, so two widths of the right side (without the gear: it is counted once) are taken from the width of the tab; in a tab of `NARROW_TAB`
 * and less it never fits (the capsule is «+», «Текст ⌄», the lists). The width it needs is measured on its invisible copy
 * (`.tl-measure`), so the font, the language and the note of the mode «Текст» count, and the view does not depend on the view it is in now.
 * Without layout (a test in jsdom) it does not fit.
 */
export function rowFits(toolbar: HTMLElement): boolean {
  const capsule = toolbar.querySelector<HTMLElement>('.isle-tools')
  const ghost = toolbar.querySelector<HTMLElement>('.tl-measure .tl-main')
  const isles = toolbar.closest<HTMLElement>('.ed-isles')
  const main = isles?.parentElement
  if (!capsule || !ghost || !isles || !main) return false
  if (main.clientWidth <= NARROW_TAB) return false
  const style = getComputedStyle(capsule)
  const frame = ['paddingLeft', 'paddingRight', 'borderLeftWidth', 'borderRightWidth'].reduce((sum, k) => sum + (Number.parseFloat(style[k as 'paddingLeft']) || 0), 0)
  const need = Math.ceil(ghost.getBoundingClientRect().width + frame)
  const cs = getComputedStyle(isles)
  const pads = (Number.parseFloat(cs.paddingLeft) || 0) + (Number.parseFloat(cs.paddingRight) || 0)
  const gap = Number.parseFloat(cs.columnGap) || 0
  // the right side is «Замечания» and the round capsule with the gear. The capsule keeps the room of «Замечания» on both sides; the gear
  // is counted once, on the right (the capsule moves left of the middle by half of it where the row is full, the left side has room: the strokes)
  const right = isles.querySelector<HTMLElement>('.isle-right')
  const gear = right?.querySelector<HTMLElement>('.isle-settings')
  const gearSpace = gear ? gear.offsetWidth + (Number.parseFloat(getComputedStyle(right!).columnGap) || 0) : 0
  const room = isles.clientWidth - pads - 2 * gap - 2 * (right?.offsetWidth ?? 0) + gearSpace
  return need > 0 && room > 0 && need <= Math.floor(room)
}

interface DismissProps {
  /** The elements a press in which is no «elsewhere». */
  inside: () => (Element | null | undefined)[]
  /** Esc (restore: the focus goes back to the text) or a press elsewhere. */
  onClose(restore: boolean): void
  leaving?: boolean | undefined
}

/** Esc and a press elsewhere close what is open. */
function useDismiss({ inside, onClose, leaving = false }: DismissProps): void {
  const live = useRef({ inside, onClose })
  live.current = { inside, onClose }
  useEffect(() => {
    if (leaving) return
    const doc = (live.current.inside().find(Boolean) ?? document.body).ownerDocument
    const down = (event: MouseEvent): void => {
      const target = event.target as Node
      if (!live.current.inside().some((el) => el?.contains(target))) live.current.onClose(false)
    }
    const key = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        live.current.onClose(true)
      }
    }
    doc.addEventListener('mousedown', down)
    doc.addEventListener('keydown', key)
    return () => {
      doc.removeEventListener('mousedown', down)
      doc.removeEventListener('keydown', key)
    }
  }, [leaving])
}

/** The keys that go through the entries of the row or the list: the arrows, Home and End; Tab stays in. Returns the new index or null. */
function stepKey(event: KeyboardEvent, at: number, count: number): number | null {
  if (event.key === 'ArrowDown' || event.key === 'ArrowRight') return (at + 1) % count
  if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') return (at + count - 1) % count
  if (event.key === 'Home') return 0
  if (event.key === 'End') return count - 1
  return null
}

/** which blocks the open capsule shows (`nota.blocksInCapsule`): all of them, or the frequent ones. */
export type BlockSet = 'all' | 'frequent'

/** the frequent blocks (besides the lists, which are the buttons of the capsule always), in the order of «/». */
export const FREQUENT_BLOCKS: readonly InsertKind[] = ['table', 'code', 'admonition', 'image']

/**
 * the blocks that stand in the wide capsule as icons, in the order of «/»: with `all` the headings 2–6 and the six blocks after the lists,
 * with `frequent` the four frequent ones after the lists (no headings). The lists are the buttons of the capsule.
 */
export function wideBlocks(locale: Locale, set: BlockSet = 'all'): { heads: readonly BlockItem[]; rest: readonly BlockItem[] } {
  const all = blocksOf(locale)
  if (set === 'frequent') return { heads: [], rest: all.filter((i) => FREQUENT_BLOCKS.includes(i.id)) }
  return { heads: all.filter((i) => groupOf(i.id) === 0), rest: all.filter((i) => groupOf(i.id) === 2) }
}

/** is the block a button of the wide capsule with this set (an icon, or one of the three lists)? */
export function inCapsule(id: InsertKind, set: BlockSet): boolean {
  return set === 'all' || groupOf(id) === 1 || FREQUENT_BLOCKS.includes(id)
}

/** The keys that go through the icons of the wide capsule: ←/→ round, Home and End. Returns the new index or null. */
export function iconKey(event: KeyboardEvent, at: number, count: number): number | null {
  if (event.key === 'ArrowRight') return (at + 1) % count
  if (event.key === 'ArrowLeft') return (at + count - 1) % count
  if (event.key === 'Home') return 0
  if (event.key === 'End') return count - 1
  return null
}

export interface RowGhostProps {
  locale: Locale
  /** The labels of the list «Текст ⌄» (the button is as wide as the longest). */
  labels: readonly string[]
  /** The mode «Текст»: the capsule has its note on the right. */
  disabled: boolean
  /** The set of the blocks; with `frequent` the copy has «+» too (the capsule keeps it). */
  blocks?: BlockSet
}

/**
 * The invisible copy of the wide capsule (`.tl-main`: «Текст ⌄», the headings, the lists, the blocks): its width is what the capsule needs to be open.
 * It takes no room, no focus and no place in the reading of the page.
 */
export function RowGhost(props: RowGhostProps): ReactElement {
  const ui = strings[props.locale].isles
  const blocks = props.blocks ?? 'all'
  const { heads, rest } = wideBlocks(props.locale, blocks)
  const icon = (item: BlockItem): ReactElement => (
    <span key={item.id} className="tb-b tl-blk">
      {blockIcon(item.id)}
    </span>
  )
  return (
    <div className="tl-measure" aria-hidden="true" ref={(el) => { if (el) el.inert = true }}>
      <div className="tl-main">
        {blocks === 'frequent' && (
          <span className="tb-b tl-plus">
            <PlusIcon />
          </span>
        )}
        <span className="dd tl-style-wrap">
          <span className="dd-btn tb-b tl-style">
            <span className="tl-ghost-name">
              {props.labels.map((label) => (
                <span key={label} className="tl-ghost-label">
                  {label}
                </span>
              ))}
            </span>
            <ChevronIcon />
          </span>
        </span>
        {heads.length > 0 && <span className="tl-gsep" />}
        {heads.map(icon)}
        <span className="tl-gsep" />
        {[BulletListIcon, NumberListIcon, CheckListIcon].map((Icon, i) => (
          <span key={i} className="tb-b">
            <Icon />
          </span>
        ))}
        <span className="tl-gsep" />
        {rest.map(icon)}
        {props.disabled && <span className="tb-note">{ui.textMode}</span>}
      </div>
    </div>
  )
}

export interface BlockListProps {
  locale: Locale
  /** The «+» the list hangs from. */
  anchor: HTMLElement
  /** The element the list is placed in. */
  container: HTMLElement
  keyboard: boolean
  startId?: InsertKind | undefined
  onPick(id: InsertKind): void
  onClose(restore: boolean): void
  /** The list is on its way out (the closing animation): it no longer listens to the page. */
  leaving?: boolean
  /** the cursor is in a table cell: the headings and the lists are off. */
  inCell?: boolean
}

/** The list «Вставить блок» under the capsule: the blocks with their lines, a line under them. */
export function BlockList(props: BlockListProps): ReactElement {
  const { locale, anchor, container, keyboard } = props
  const ui = strings[locale].isles
  const items = blocksOf(locale)
  const ref = useRef<HTMLDivElement>(null)
  const first = Math.max(0, items.findIndex((i) => i.id === props.startId))
  const [at, setAt] = useState(keyboard ? first : -1)
  const [chosen, setChosen] = useState(keyboard)
  useDismiss({ inside: () => [ref.current, anchor], onClose: props.onClose, leaving: props.leaving })

  useLayoutEffect(() => {
    const pop = ref.current
    if (!pop) return
    const place = (): void => {
      const narrow = container.clientWidth <= NARROW_TAB
      pop.style.width = narrow ? `${Math.max(0, container.clientWidth - 20)}px` : ''
      placeBelow(pop, anchor, container)
      // the squeezed list scrolls between its title and its line, not as a whole
      pop.style.overflowY = ''
      if (narrow) pop.style.left = '10px'
    }
    place()
    if (typeof ResizeObserver === 'undefined') return
    let frame = 0
    const watch = new ResizeObserver(() => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        place()
      })
    })
    watch.observe(container)
    const hang = anchor.closest('[data-hang]')
    if (hang) watch.observe(hang)
    return () => {
      watch.disconnect()
      if (frame) cancelAnimationFrame(frame)
    }
  }, [anchor, container])

  useEffect(() => {
    if (keyboard && at >= 0) ref.current?.querySelector<HTMLButtonElement>(`button[data-block="${items[at]!.id}"]`)?.focus({ preventScroll: true })
    // moves by the keys only; a list that was opened by the mouse takes no focus
  }, [at, keyboard])

  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.key === 'Tab') {
      event.preventDefault()
      return
    }
    const here = items.findIndex((i) => i.id === (document.activeElement as HTMLElement | null)?.dataset.block)
    const next = stepKey(event, here >= 0 ? here : at, items.length)
    if (next === null) return
    event.preventDefault()
    setChosen(true)
    setAt(next)
    ref.current?.querySelectorAll<HTMLButtonElement>('button[data-block]')[next]?.focus({ preventScroll: true })
  }

  return (
    <BlockMenu
      ref={ref}
      className="pop blocklist"
      mode="menu"
      title={ui.insertBlock}
      idPrefix="bl"
      scroll
      items={items}
      at={at}
      showChosen={chosen}
      icon={blockIcon}
      groupOf={groupOf}
      {...(props.inCell ? { offOf: (id: InsertKind) => cellOff(id, messages[locale].tips) } : {})}
      hideKeys
      foot={<div className="bl-foot">{ui.insertFast}</div>}
      onHover={(i) => {
        setChosen(true)
        setAt(i)
      }}
      onKeyDown={onKeyDown}
      onPick={props.onPick}
    />
  )
}
