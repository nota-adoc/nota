import type { InsertKind, VisualEditor } from '@nota-adoc/prosemirror'
import type { ReactElement } from 'react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { BlockMenu } from './BlockMenu.js'
import { matching, slashItems } from './blocks.js'
import type { Locale } from './locale.js'
import { messages } from './messages.js'
import { fitWindow } from './place.js'
import { useEditorState } from './useEditorState.js'

export interface SlashMenuProps {
  editor: VisualEditor | undefined
  locale: Locale
  /** The element the menu is placed in (it is `position: relative`). */
  container: HTMLElement
  /** The line the menu may not go over (the lower edge of the capsules), in the coordinates of the window. */
  topLimit?: () => number
  /** The mode of the source: no menu. */
  disabled?: boolean
  /** A window opened from the menu (the picture) holds the focus: the menu waits. */
  suspended?: boolean
  /** Called before a command: the message of an earlier refusal goes away. */
  onBeforeCommand?(): void
  /** «Картинка» was chosen: the host asks for a file, then puts the block in with `insertBlock('image', { path })`. */
  onImage(): void
}

/** The menu of «/» in an empty line: the blocks that can be put in, narrowed by what is typed after the slash. */
export function SlashMenu(props: SlashMenuProps): ReactElement | null {
  const { editor, locale, container, disabled = false, suspended = false } = props
  const t = messages[locale]
  const state = useEditorState(editor)
  const slash = state.slash
  const shown = Boolean(editor) && !disabled && !suspended && slash !== null
  const items = matching(slashItems(t), slash?.query ?? '')
  const [at, setAt] = useState(0)
  const ref = useRef<HTMLDivElement>(null)
  const [placed, setPlaced] = useState(false)
  // the side is chosen when the menu opens and kept while it is open: only the height changes with the query
  const side = useRef<'down' | 'up' | undefined>(undefined)
  const query = slash?.query ?? ''

  // the search changes: the first entry is chosen
  useEffect(() => setAt(0), [query, shown])

  const pick = (id: InsertKind): void => {
    if (!editor) return
    props.onBeforeCommand?.()
    if (id === 'image') return props.onImage()
    editor.commands.insertBlock(id, { title: t.details })
    editor.focus()
  }
  const live = useRef({ items, at, pick })
  live.current = { items, at, pick }

  // the keys of the menu go before those of the editor
  useEffect(() => {
    if (!shown || !editor) return
    const dom = editor.view.dom
    const onKey = (event: KeyboardEvent): void => {
      const { items: list, at: current, pick: choose } = live.current
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        editor.commands.dismissSlash()
      } else if (list.length > 0 && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
        event.preventDefault()
        event.stopPropagation()
        setAt((current + (event.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length)
      } else if (list.length > 0 && (event.key === 'Enter' || event.key === 'Tab')) {
        event.preventDefault()
        event.stopPropagation()
        choose(list[Math.min(current, list.length - 1)]!.id)
      }
    }
    dom.addEventListener('keydown', onKey, true)
    return () => dom.removeEventListener('keydown', onKey, true)
  }, [shown, editor])

  // the active entry is in sight in a menu that scrolls
  useEffect(() => {
    if (!shown) return
    ref.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' })
  }, [shown, at, query])

  const rect = slash?.rect ?? null
  useLayoutEffect(() => {
    const pop = ref.current
    if (!shown || !slash || !pop) {
      side.current = undefined
      setPlaced(false)
      return
    }
    if (!rect) {
      pop.style.left = '8px'
      pop.style.top = '8px'
    } else {
      const options = { gap: 4, topLimit: props.topLimit?.() ?? 0, ...(side.current ? { side: side.current } : {}) }
      side.current = fitWindow(pop, rect, container, options)
    }
    setPlaced(true)
  }, [shown, slash?.offset, rect?.top, rect?.left, rect?.bottom, container, query])

  if (!editor || !shown) return null
  return (
    <BlockMenu
      ref={ref}
      className="fl pop slashmenu"
      mode="listbox"
      title={t.slashTitle}
      idPrefix="sm"
      items={items}
      at={at}
      empty={<div className="sm-empty">{t.slashEmpty}</div>}
      style={{ visibility: placed ? 'visible' : 'hidden' }}
      onHover={setAt}
      onPick={pick}
    />
  )
}
