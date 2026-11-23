import type { KeyboardEvent, ReactElement } from 'react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Locale } from './locale.js'
import { messages } from './messages.js'
import { placeBelow } from './place.js'

/** A section of the document the link can go to. */
export interface SectionItem {
  readonly id: string
  readonly title: string
  /** 0 for a section of the first level: the indent of its line. */
  readonly level: number
}

/** The files the search found: at most as many as the list shows, and how many more there are. */
export interface FileList {
  readonly items: readonly string[]
  readonly more: number
}

export type LinkTab = 'url' | 'section' | 'file'

export interface LinkPopoverProps {
  locale: Locale
  anchor: HTMLElement | null
  container: HTMLElement
  /** The target of the link under the cursor, or null where there is none. */
  current: string | null
  /** The window is closed and only fades out: it listens to no clicks. */
  leaving?: boolean
  listSections(): readonly SectionItem[]
  listFiles(query: string): Promise<FileList> | FileList
  /** Put the link; `true` when it is put (the field closes), otherwise the text to show under the field. */
  onApply(target: string): true | string
  onRemove(): void
  /** Esc (restore: the cursor goes back to the text) or a click elsewhere. */
  onClose(restore: boolean): void
}

// eslint-disable-next-line no-control-regex
const FORBIDDEN = /^[\s\u0000-\u001f]*(?:javascript|data|vbscript):/i

/** Which tab a target of an existing link belongs to, and what is in its field. */
export function tabOf(target: string | null): { tab: LinkTab; value: string } {
  if (!target) return { tab: 'url', value: 'https://' }
  if (target.startsWith('#')) return { tab: 'section', value: target.slice(1) }
  if (!/^[a-z][a-z0-9+.-]*:/i.test(target) && /\.(?:adoc|asciidoc)(?:#.*)?$/i.test(target)) return { tab: 'file', value: target.split('#')[0]! }
  return { tab: 'url', value: target }
}

/** The field of a link under the toolbar: an address, a section of the document, or another file of the folder. */
export function LinkPopover(props: LinkPopoverProps): ReactElement {
  const { locale, anchor, container, current, onClose } = props
  const t = messages[locale]
  const start = tabOf(current)
  const ref = useRef<HTMLDivElement>(null)
  const [tab, setTab] = useState<LinkTab>(start.tab)
  const [url, setUrl] = useState(start.tab === 'url' ? start.value : 'https://')
  const sections = props.listSections()
  const [section, setSection] = useState<string | null>(
    start.tab === 'section' && sections.some((s) => s.id === start.value) ? start.value : (sections[0]?.id ?? null),
  )
  const [query, setQuery] = useState('')
  const [files, setFiles] = useState<FileList>({ items: [], more: 0 })
  const [file, setFile] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const urlInput = useRef<HTMLInputElement>(null)
  const searchInput = useRef<HTMLInputElement>(null)
  const sectionBox = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (ref.current && anchor) placeBelow(ref.current, anchor, container)
  }, [anchor, container, tab])

  // the files of the search: the latest answer wins
  useEffect(() => {
    if (tab !== 'file') return
    let stale = false
    void Promise.resolve(props.listFiles(query)).then((found) => {
      if (stale) return
      setFiles(found)
      const at = start.tab === 'file' && query === '' ? found.items.indexOf(start.value) : -1
      setFile(Math.max(0, at))
    })
    return () => {
      stale = true
    }
  }, [tab, query])

  useEffect(() => {
    if (tab === 'url') {
      const input = urlInput.current
      input?.focus()
      if (input) {
        if (input.value === 'https://') input.setSelectionRange(input.value.length, input.value.length)
        else input.select()
      }
    } else if (tab === 'file') searchInput.current?.focus()
    else sectionBox.current?.focus()
  }, [tab])

  const leaving = Boolean(props.leaving)
  useEffect(() => {
    if (leaving) return
    const doc = ref.current!.ownerDocument
    const down = (event: MouseEvent): void => {
      const target = event.target as Node
      if (!ref.current?.contains(target) && !anchor?.contains(target)) onClose(false)
    }
    doc.addEventListener('mousedown', down)
    return () => doc.removeEventListener('mousedown', down)
  }, [anchor, onClose, leaving])

  const submit = (target: string | null): void => {
    if (target === null || target.trim() === '') {
      setError(tab === 'url' ? t.emptyTarget : t.noTarget)
      return
    }
    const bare = target.trim().replace(/\/+$/, '')
    if (tab === 'url' && (/^https?:$/i.test(bare) || bare === '')) return setError(t.emptyTarget)
    if (FORBIDDEN.test(target)) return setError(t.forbiddenTarget)
    const result = props.onApply(target.trim())
    if (result !== true) setError(result)
  }

  const apply = (): void => {
    if (tab === 'url') submit(url)
    else if (tab === 'section') submit(section === null ? null : `#${section}`)
    else submit(files.items[file] ?? null)
  }

  const move = (event: KeyboardEvent, count: number, at: number, set: (n: number) => void): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      set(Math.min(count - 1, at + 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      set(Math.max(0, at - 1))
    }
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onClose(true)
    } else if (event.key === 'Enter' && !event.nativeEvent.isComposing && !(event.target as Element).closest('button')) {
      event.preventDefault()
      apply()
    } else if (tab === 'section') {
      const at = sections.findIndex((s) => s.id === section)
      move(event, sections.length, at, (n) => setSection(sections[n]!.id))
    } else if (tab === 'file') move(event, files.items.length, file, setFile)
  }

  const tabs: readonly [LinkTab, string][] = [
    ['url', t.url],
    ['section', t.section],
    ['file', t.otherFile],
  ]
  return (
    <div ref={ref} className="pop linkpop" role="dialog" aria-label={t.linkTitle} onKeyDown={onKeyDown}>
      <div className="sseg" role="radiogroup" aria-label={t.linkKind}>
        {tabs.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="radio"
            data-tab={id}
            aria-checked={tab === id}
            onClick={() => {
              setTab(id)
              setError(null)
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'url' && (
        <input
          ref={urlInput}
          type="text"
          value={url}
          placeholder={t.urlPlaceholder}
          aria-label={t.urlLabel}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => {
            setUrl(e.target.value)
            setError(null)
          }}
        />
      )}
      {tab === 'section' && (
        <div ref={sectionBox} className="lk-list" role="listbox" aria-label={t.sectionList} tabIndex={0}>
          {sections.length === 0 && <div className="lk-empty">{t.noSections}</div>}
          {sections.map((s) => (
            <div
              key={s.id}
              role="option"
              className="lk-item"
              aria-selected={s.id === section}
              data-id={s.id}
              style={{ paddingLeft: `${8 + s.level * 14}px` }}
              onClick={() => setSection(s.id)}
              onDoubleClick={() => submit(`#${s.id}`)}
            >
              {s.title}
              <small>#{s.id}</small>
            </div>
          ))}
        </div>
      )}
      {tab === 'file' && (
        <>
          <input
            ref={searchInput}
            type="text"
            value={query}
            aria-label={t.fileSearch}
            placeholder={t.fileSearch}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => {
              setQuery(e.target.value)
              setError(null)
            }}
          />
          <div className="lk-list" role="listbox" aria-label={t.fileList}>
            {files.items.length === 0 && <div className="lk-empty">{t.noFiles}</div>}
            {files.items.map((path, i) => (
              <div
                key={path}
                role="option"
                className="lk-item"
                aria-selected={i === file}
                data-path={path}
                onClick={() => {
                  setFile(i)
                  submit(path)
                }}
              >
                {path}
              </div>
            ))}
            {files.more > 0 && <div className="lk-more">{t.moreFiles(files.more)}</div>}
          </div>
        </>
      )}
      {error && (
        <div className="pop-err" role="alert">
          {error}
        </div>
      )}
      <div className="pop-foot">
        <span className="pop-hint">{t.linkHint}</span>
        {current && (
          <button type="button" className="btn-ghost" data-act="remove" onClick={props.onRemove}>
            {t.removeLink}
          </button>
        )}
        <button type="button" className="btn-acc" data-act="apply" onClick={apply}>
          {t.apply}
        </button>
      </div>
    </div>
  )
}
