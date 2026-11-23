import type { KeyboardEvent, ReactElement } from 'react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { FileList } from './LinkPopover.js'
import type { Locale } from './locale.js'
import { messages } from './messages.js'
import { fitWindow, placeBelow } from './place.js'

export interface ImagePickerProps {
  locale: Locale
  /** The button the window hangs under; none (a menu of «/»): where `at` says. */
  anchor: HTMLElement | null
  at?: { left: number; top: number; bottom: number }
  /** The line the window may not go over (the lower edge of the capsules), in the coordinates of the window. */
  topLimit?: () => number
  container: HTMLElement
  /** The images of the folder of the file and the workspace that match `query`. */
  listFiles(query: string): Promise<FileList> | FileList
  onPick(path: string): void
  onClose(restore: boolean): void
}

/** The window that picks the file of a picture: a search field over the list of the images the host found. */
export function ImagePicker(props: ImagePickerProps): ReactElement {
  const { locale, anchor, container, onClose } = props
  const t = messages[locale]
  const ref = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [files, setFiles] = useState<FileList>({ items: [], more: 0 })
  const [at, setAt] = useState(0)

  useLayoutEffect(() => {
    const pop = ref.current
    if (!pop) return
    if (anchor) placeBelow(pop, anchor, container)
    else if (props.at) fitWindow(pop, props.at, container, { gap: 4, topLimit: props.topLimit?.() ?? 0 })
    else {
      pop.style.left = '8px'
      pop.style.top = '8px'
    }
  }, [anchor, container])

  useEffect(() => input.current?.focus(), [])

  useEffect(() => {
    let stale = false
    void Promise.resolve(props.listFiles(query)).then((found) => {
      if (stale) return
      setFiles(found)
      setAt(0)
    })
    return () => {
      stale = true
    }
  }, [query])

  useEffect(() => {
    const doc = ref.current!.ownerDocument
    const down = (event: MouseEvent): void => {
      const target = event.target as Node
      if (!ref.current?.contains(target) && !anchor?.contains(target)) onClose(false)
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
      setAt(Math.min(files.items.length - 1, at + 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setAt(Math.max(0, at - 1))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const path = files.items[at]
      if (path) props.onPick(path)
    }
  }

  return (
    <div ref={ref} className="pop linkpop imagepop" role="dialog" aria-label={t.imagePick} onKeyDown={onKey}>
      <input
        ref={input}
        type="text"
        value={query}
        aria-label={t.imageSearch}
        placeholder={t.imageSearch}
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="lk-list" role="listbox" aria-label={t.imageList}>
        {files.items.length === 0 && <div className="lk-empty">{t.noImages}</div>}
        {files.items.map((path, i) => (
          <div key={path} role="option" className="lk-item" aria-selected={i === at} data-path={path} onClick={() => props.onPick(path)}>
            {path}
          </div>
        ))}
        {files.more > 0 && <div className="lk-more">{t.moreFiles(files.more)}</div>}
      </div>
    </div>
  )
}
