import type { InsertKind } from '@nota-adoc/prosemirror'
import type { KeyboardEvent, ReactElement } from 'react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { BlockMenu } from './BlockMenu.js'
import { type BlockItem, insertItems } from './blocks.js'
import type { Locale } from './locale.js'
import { messages } from './messages.js'
import { placeBelow } from './place.js'

export interface InsertMenuProps {
  locale: Locale
  /** The button «Вставить» the menu hangs under. */
  anchor: HTMLElement
  container: HTMLElement
  /** The entries (the six of the demo when not given). */
  items?: readonly BlockItem[]
  onPick(id: InsertKind): void
  /** Esc (restore: the focus goes back to the text) or a click elsewhere. */
  onClose(restore: boolean): void
}

/** The menu of the button «Вставить»: table, code, admonition, collapsible block, image. */
export function InsertMenu(props: InsertMenuProps): ReactElement {
  const { locale, anchor, container, onClose } = props
  const t = messages[locale]
  const items = props.items ?? insertItems(t)
  const ref = useRef<HTMLDivElement>(null)
  const [at, setAt] = useState(0)

  useLayoutEffect(() => {
    if (ref.current) placeBelow(ref.current, anchor, container)
  }, [anchor, container])

  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('button[tabindex="0"]')?.focus()
  }, [at])

  useEffect(() => {
    const doc = ref.current!.ownerDocument
    const down = (event: MouseEvent): void => {
      const target = event.target as Node
      if (!ref.current?.contains(target) && !anchor.contains(target)) onClose(false)
    }
    doc.addEventListener('mousedown', down)
    return () => doc.removeEventListener('mousedown', down)
  }, [anchor, onClose])

  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose(true)
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      setAt((at + 1) % items.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setAt((at + items.length - 1) % items.length)
    }
  }

  return (
    <BlockMenu
      ref={ref}
      className="pop insertmenu"
      mode="menu"
      title={t.insert}
      idPrefix="im"
      bare
      items={items}
      at={at}
      onKeyDown={onKey}
      onPick={props.onPick}
    />
  )
}
