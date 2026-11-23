import { LANGUAGES, type VisualEditor, canonicalLanguage } from '@nota-adoc/prosemirror'
import type { MouseEvent, ReactElement } from 'react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AdmonitionPicker } from './AdmonitionPicker.js'
import { Dropdown } from './Dropdown.js'
import type { Locale } from './locale.js'
import { messages } from './messages.js'
import { useEditorState } from './useEditorState.js'

export interface BlockBarProps {
  editor: VisualEditor | undefined
  locale: Locale
  /** The element the panel is placed in (it is `position: relative`), and the one that scrolls under it. */
  container: HTMLElement
  scroller?: HTMLElement
  /** Called before a command of the panel: the message of an earlier refusal goes away. */
  onBeforeCommand?(): void
  /** The mode of the source: no panel. */
  disabled?: boolean
  /** The lower edge of what covers the top of the scroller (the row of capsules), in the coordinates of the window: a block above it is out of sight. */
  topLimit?: () => number
}

export { ADMONITION_TYPES } from './AdmonitionPicker.js'

interface Spot {
  left: number
  top: number
}

/** The panel over the right top corner of the admonition the cursor is in: the five types of an admonition, the language of a code block. Esc hides it until the cursor moves. */
export function BlockBar(props: BlockBarProps): ReactElement | null {
  const { editor, locale, container, scroller, disabled = false, topLimit } = props
  const t = messages[locale]
  const state = useEditorState(editor)
  const ref = useRef<HTMLDivElement>(null)
  const [dismissed, setDismissed] = useState(false)
  const [spot, setSpot] = useState<Spot | null>(null)
  const [wish, setWish] = useState(false)
  const key = `${state.from}:${state.to}`
  const wanted = Boolean(editor) && !disabled && (state.admonition !== null || state.code !== null) && !dismissed

  // the cursor moves: the panel is back
  useEffect(() => setDismissed(false), [key])

  useEffect(() => {
    if (!wanted || !editor) return
    const doc = editor.view.dom.ownerDocument
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !event.defaultPrevented) setDismissed(true)
    }
    doc.addEventListener('keydown', onKey)
    return () => doc.removeEventListener('keydown', onKey)
  }, [wanted, editor])

  // Alt+F10 (⌥F10 on a Mac) from the text of an admonition, with no selection: the row of the types opens with the focus on the current one
  const here = state.admonition !== null && state.empty && state.code === null
  // the wish does not outlive the cursor or the admonition: it is gone with them
  useEffect(() => setWish(false), [key, here])
  useEffect(() => {
    if (!editor || disabled || !here) return
    const doc = editor.view.dom.ownerDocument
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'F10' || !event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
      if (!editor.view.dom.contains(event.target as Node)) return
      event.preventDefault()
      setDismissed(false)
      setWish(true)
    }
    doc.addEventListener('keydown', onKey)
    return () => doc.removeEventListener('keydown', onKey)
  }, [editor, disabled, here])

  // the latest of what the measure reads: the loop of the frames below lives longer than one render
  const live = useRef({ editor, container, scroller, code: state.code !== null, topLimit })
  live.current = { editor, container, scroller, code: state.code !== null, topLimit }
  const applied = useRef<Spot | null>(null)

  /** Where the panel stands now; null: out of the window (hidden); undefined: the editor is between two states, the place stays. */
  const measure = (): Spot | null | undefined => {
    const { editor: ed, container: layer, scroller: scrolled, code, topLimit: limitOf } = live.current
    if (!ed) return undefined
    if (!code) return null
    // (the frame of the code the cursor is in)
    const node = ed.view.domAtPos(ed.view.state.selection.head).node
    const frame = (node.nodeType === 1 ? (node as Element) : node.parentElement)?.closest('.nota-code')
    const rect = frame?.getBoundingClientRect()
    if (!rect) {
      // (no layout: the panel is where the container starts; the editor between two states: where it was)
      return ed.view.dom.getBoundingClientRect().height > 0 ? undefined : { left: 8, top: 8 }
    }
    const box = layer.getBoundingClientRect()
    const area = (scrolled ?? layer).getBoundingClientRect()
    // (the row of capsules lies over the top of the scroller: a block that has gone under it is out of sight)
    const limit = Math.max(area.top, limitOf?.() ?? 0)
    if (area.height > 0 && (rect.bottom < limit || rect.top > area.bottom)) return null
    const w = ref.current?.offsetWidth ?? 0
    const h = ref.current?.offsetHeight ?? 0
    // the language: over the right top corner of the frame
    const left = Math.max(8, Math.min(rect.right - box.left - w - 6, box.width - w - 8))
    // the language of the code stays pressed under the capsules
    let top = Math.max(rect.top - box.top - h / 2, Math.max(0, limit - box.top) + 2)
    // the panel stays inside the layer: a block whose corner is at the lower edge does not make the page scroll
    if (box.height > 0 && h > 0) top = Math.min(top, box.height - h - 4)
    return { left, top }
  }

  /** Puts the panel there at once (the style of the element is written by hand: the render of React comes a task later) and tells the state. */
  const put = (next: Spot | null): void => {
    const el = ref.current
    if (el) {
      el.style.left = `${next?.left ?? 0}px`
      el.style.top = `${next?.top ?? 0}px`
      el.style.visibility = next ? 'visible' : 'hidden'
    }
    applied.current = next
    setSpot(next)
  }
  const same = (a: Spot | null, b: Spot | null): boolean => (a === null || b === null ? a === b : Math.abs(a.left - b.left) < 0.01 && Math.abs(a.top - b.top) < 0.01)

  // the cursor moves, the state changes: the place is found before the frame is drawn
  useLayoutEffect(() => {
    if (!wanted || !editor) {
      applied.current = null
      setSpot(null)
      return
    }
    const next = measure()
    if (next !== undefined && (!same(next, applied.current) || (next !== null && !spot))) put(next)
  })

  // while the panel is wanted its place is read in every frame, before the frame is drawn: the scroll of the page, the size of the tab, an image that has
  // come above, the height of an island or of the row of capsules move the block with no transaction of the editor, and the panel goes with it, not a frame behind
  useEffect(() => {
    const win = container.ownerDocument.defaultView
    if (!wanted || !win || typeof win.requestAnimationFrame !== 'function') return
    let id = 0
    const tick = (): void => {
      const next = measure()
      if (next !== undefined && !same(next, applied.current)) put(next)
      id = win.requestAnimationFrame(tick)
    }
    id = win.requestAnimationFrame(tick)
    return () => win.cancelAnimationFrame(id)
  }, [wanted, container])

  if (!editor || !wanted) return null
  if (state.code === null) {
    return (
      <AdmonitionPicker
        editor={editor}
        locale={locale}
        container={container}
        scroller={scroller}
        topLimit={props.topLimit}
        variant={state.admonition ?? 'NOTE'}
        onBeforeCommand={props.onBeforeCommand}
        wish={wish}
        onWished={() => setWish(false)}
      />
    )
  }
  const word = state.code.language
  const id = canonicalLanguage(word) ?? word
  const known = LANGUAGES.some((l) => l === id)
  const items = [...(known ? [] : [{ value: id, label: id }]), ...LANGUAGES.map((l) => ({ value: l, label: t.languages[l] ?? l }))]
  return (
    <div
      ref={ref}
      className="fl blockbar codebar"
      style={{ left: `${spot?.left ?? 0}px`, top: `${spot?.top ?? 0}px`, visibility: spot ? 'visible' : 'hidden' }}
      onMouseDown={keepBlockSelection}
    >
      <Dropdown
        className="code-lang"
        cmd="language"
        items={items}
        value={id}
        label={t.language}
        heading={t.language}
        flip
        away={!spot}
        onOpen={props.onBeforeCommand}
        onPick={(v) => {
          editor.commands.setCodeLanguage(v)
          editor.focus()
        }}
      >
        {items.find((i) => i.value === id)?.label ?? id}
      </Dropdown>
    </div>
  )
}

/** A press on the button must not take the cursor from the text. */
const keepBlockSelection = (event: MouseEvent): void => {
  if ((event.target as Element).closest('button')) event.preventDefault()
}
