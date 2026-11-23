/**
 * The remarks of Nota as the tab shows them: the right capsule («● 2 замечания») and the card that hangs under it, one remark
 * at a time («Предупреждение · 1 из 2», its text, «Следующее», «Закрыть»). The place of the remark is scrolled to the
 * middle of the tab and marked; the page does the scrolling and gives back the element to mark.
 */
import { type Locale, strings } from '../strings.js'
import { remarkCount, remarkText, severityName, type RemarkSeverity } from './diagnostics.js'

export interface RemarkItem {
  readonly from: number
  readonly to: number
  readonly code: string
  readonly message: string
  readonly severity: RemarkSeverity
}

export interface RemarksHost {
  /** The remarks that count (errors and warnings) of the document now. */
  list(): readonly RemarkItem[]
  /**
   * Shows the place of a remark: the visual mode, the place in the middle of the tab. Gives the element to mark, or null.
   * `scroll` is false when the card is only redrawn (the text changed under it).
   */
  reveal(remark: RemarkItem, scroll: boolean): HTMLElement | null
  /** The card is about to open: the page closes the other cards. */
  beforeOpen?(): void
}

export interface Remarks {
  readonly isle: HTMLButtonElement
  readonly card: HTMLElement
  readonly isOpen: boolean
  /** The index of the remark in the card, or -1. */
  readonly index: number
  /** Opens the card on the remark `at` (the first by default). */
  open(at?: number, scroll?: boolean): void
  /** Opens the card on the remark that starts at the offset (or the nearest one that holds it). */
  openAt(offset: number): void
  close(restoreFocus?: boolean): void
  toggle(): void
  next(): void
  /** The document changed: the number on the capsule, and the card follows the remark it shows. */
  refresh(): void
  destroy(): void
}

const MARK_CLASS = 'diag-on'

export function createRemarks(doc: Document, host: RemarksHost, locale: Locale): Remarks {
  const t = strings[locale]
  const ui = t.isles
  const isle = doc.createElement('button')
  isle.type = 'button'
  isle.className = 'isle isle-remarks'
  isle.setAttribute('aria-haspopup', 'true')
  isle.setAttribute('aria-expanded', 'false')
  isle.title = ui.remarks
  isle.innerHTML = '<span class="rm-dot" aria-hidden="true"></span><span class="rm-text"></span>'
  const text = isle.querySelector<HTMLElement>('.rm-text')!

  const card = doc.createElement('section')
  card.className = 'card remark-card'
  card.hidden = true
  card.setAttribute('role', 'group')
  card.setAttribute('aria-label', ui.remarkCard)
  card.innerHTML = `<div class="card-head remark-title"></div>
<p class="remark-text"></p>
<div class="remark-acts"><button type="button" class="btn remark-next"></button><button type="button" class="btn remark-close"></button></div>`
  const title = card.querySelector<HTMLElement>('.remark-title')!
  const body = card.querySelector<HTMLElement>('.remark-text')!
  const nextButton = card.querySelector<HTMLButtonElement>('.remark-next')!
  const closeButton = card.querySelector<HTMLButtonElement>('.remark-close')!
  nextButton.textContent = ui.next
  closeButton.textContent = ui.close

  let opened = false
  let at = -1
  let marked: HTMLElement | null = null
  /** The page is showing the place now (it may redraw the remarks on the way). */
  let busy = false

  const unmark = (): void => {
    marked?.classList.remove(MARK_CLASS)
    marked = null
  }

  /** The text of the capsule and the number the card shows. */
  function draw(): void {
    const list = host.list()
    const n = list.length
    isle.classList.toggle('has-remarks', n > 0)
    isle.setAttribute('aria-disabled', String(n === 0))
    const label = n > 0 ? remarkCount(n, locale) : t.tree.none
    text.textContent = label
    text.dataset.short = String(n)
    isle.setAttribute('aria-label', n > 0 ? `${ui.remarks}: ${label}` : ui.remarks)
    if (!opened) return
    const item = list[at]
    if (!item) return close()
    title.textContent = ui.remarkTitle(severityName(item.severity, locale), at + 1, n)
    body.textContent = remarkText(item, locale)
  }

  function show(index: number, scroll: boolean): void {
    const list = host.list()
    if (list.length === 0) return
    at = ((index % list.length) + list.length) % list.length
    if (!opened) {
      host.beforeOpen?.()
      opened = true
      card.hidden = false
      isle.setAttribute('aria-expanded', 'true')
    }
    draw()
    unmark()
    busy = true
    try {
      marked = host.reveal(list[at]!, scroll)
    } finally {
      busy = false
    }
    marked?.classList.add(MARK_CLASS)
  }

  function close(restoreFocus = false): void {
    if (!opened) return
    opened = false
    at = -1
    card.hidden = true
    isle.setAttribute('aria-expanded', 'false')
    unmark()
    if (restoreFocus) isle.focus()
  }

  const open = (index = 0, scroll = true): void => show(index, scroll)
  const next = (): void => show(at + 1, true)

  isle.addEventListener('click', () => {
    if (opened) close()
    else open(0)
  })
  nextButton.addEventListener('click', next)
  closeButton.addEventListener('click', () => close(true))
  const onDown = (event: MouseEvent): void => {
    if (!opened) return
    const target = event.target instanceof Node ? event.target : null
    if (target && (card.contains(target) || isle.contains(target))) return
    close()
  }
  const onKey = (event: KeyboardEvent): void => {
    if (opened && event.key === 'Escape') {
      event.preventDefault()
      close(true)
    }
  }
  doc.addEventListener('mousedown', onDown)
  doc.addEventListener('keydown', onKey)

  draw()
  return {
    isle,
    card,
    get isOpen() {
      return opened
    },
    get index() {
      return at
    },
    open,
    openAt(offset) {
      const list = host.list()
      let found = list.findIndex((r) => r.from === offset)
      if (found < 0) found = list.findIndex((r) => r.from <= offset && offset <= r.to)
      if (found < 0) found = 0
      open(found)
    },
    close,
    toggle() {
      if (opened) close()
      else open(0)
    },
    next,
    refresh() {
      if (busy) return
      if (opened) {
        const list = host.list()
        if (list.length === 0) return (draw(), close())
        at = Math.min(at, list.length - 1)
        draw()
        // (the mark is on an element the editor may have drawn again)
        if (!marked?.isConnected) {
          unmark()
          marked = host.reveal(list[at]!, false)
          marked?.classList.add(MARK_CLASS)
        }
      } else draw()
    },
    destroy() {
      doc.removeEventListener('mousedown', onDown)
      doc.removeEventListener('keydown', onKey)
      isle.remove()
      card.remove()
    },
  }
}
