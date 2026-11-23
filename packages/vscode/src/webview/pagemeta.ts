/**
 * The header of a page as the tab shows it: a round badge «i» at the top right of the page and the card that hangs under it
 * (the path, the title, the version, the date, the link «Open in Confluence», and «Править шапку»). The editor keeps the header
 * lines out of sight and tells what they say; the names of the fields are known here, not in the library.
 */
import type { PageMetaInfo } from '@nota-adoc/prosemirror'
import { type Locale, strings } from '../strings.js'

export interface PageMetaHost {
  /** The link of the card was pressed (only `http(s)`): the host opens it in the browser. */
  openLink(href: string): void
  /** «Править шапку»: the header is opened as text in place. */
  edit(): void
  /** The card is about to open: the page closes the other cards. */
  beforeOpen?(): void
}

export interface PageMetaBadge {
  readonly button: HTMLButtonElement
  readonly card: HTMLElement
  readonly isOpen: boolean
  /** The editor told the header (null: none): the badge and the card follow. */
  update(info: PageMetaInfo | null): void
  close(restoreFocus?: boolean): void
  destroy(): void
}

const OPEN_DELAY = 400
const CLOSE_DELAY = 250

const field = (info: PageMetaInfo, key: string): string | readonly string[] | undefined =>
  info.fields.find((f) => f.key === key)?.value

const text = (v: string | readonly string[] | undefined): string => (typeof v === 'string' ? v.trim() : '')

/** `3 октября 2026, 14:20`, `October 3, 2026, 2:20 PM`, in local time; the text as written when it is not a date. */
export function formatUpdated(value: string, locale: Locale): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  const tag = locale === 'ru' ? 'ru-RU' : 'en-US'
  const day = new Intl.DateTimeFormat(tag, { day: 'numeric', month: 'long', year: 'numeric' }).format(date).replace(/\s?г\.$/, '')
  const time = new Intl.DateTimeFormat(tag, { hour: 'numeric', minute: '2-digit', hour12: locale !== 'ru' }).format(date)
  return `${day}, ${time}`
}

export function createPageMeta(doc: Document, host: PageMetaHost, locale: Locale): PageMetaBadge {
  const ui = strings[locale].pageMeta
  const button = doc.createElement('button')
  button.type = 'button'
  button.className = 'pagemeta-badge'
  button.hidden = true
  button.textContent = 'i'
  button.title = ui.label
  button.setAttribute('aria-label', ui.label)
  button.setAttribute('aria-haspopup', 'true')
  button.setAttribute('aria-expanded', 'false')

  const card = doc.createElement('section')
  card.className = 'card pagemeta-card'
  card.hidden = true
  card.setAttribute('role', 'group')
  card.setAttribute('aria-label', ui.label)

  let info: PageMetaInfo | null = null
  let opened = false
  let pinned = false
  let openTimer: ReturnType<typeof setTimeout> | undefined
  let closeTimer: ReturnType<typeof setTimeout> | undefined

  const row = (label: string, value: string): HTMLElement => {
    const el = doc.createElement('div')
    el.className = 'pm-row'
    const k = doc.createElement('span')
    k.className = 'pm-key'
    k.textContent = label
    const v = doc.createElement('span')
    v.className = 'pm-val'
    v.textContent = value
    el.append(k, v)
    return el
  }

  /** Builds the card from the fields; a line without a value is not there. */
  function draw(): void {
    card.textContent = ''
    if (!info) return
    const ancestors = field(info, 'ancestors')
    const path = Array.isArray(ancestors) ? ancestors.filter((a) => a !== '').join(' › ') : ''
    const title = text(field(info, 'title'))
    const version = text(field(info, 'version'))
    const updated = text(field(info, 'updated_at'))
    const url = text(field(info, 'confluence_url'))
    const link = /^https?:\/\//i.test(url) ? url : ''
    if (path) {
      const el = doc.createElement('div')
      el.className = 'pm-path'
      el.textContent = path
      card.append(el)
    }
    if (title) {
      const el = doc.createElement('div')
      el.className = 'pm-title'
      el.textContent = title
      card.append(el)
    }
    if (version) card.append(row(ui.version, version))
    if (updated) card.append(row(ui.updated, formatUpdated(updated, locale)))
    if (link) {
      const a = doc.createElement('button')
      a.type = 'button'
      a.className = 'pm-link'
      a.textContent = `${ui.link} ↗`
      a.addEventListener('click', () => host.openLink(link))
      card.append(a)
    }
    if (!path && !title && !version && !updated && !link) {
      const el = doc.createElement('div')
      el.className = 'pm-empty'
      el.textContent = ui.empty
      card.append(el)
    }
    const params = info.attributes
    if (params.length > 0) {
      const box = doc.createElement('div')
      box.className = 'pm-params'
      const label = doc.createElement('div')
      label.className = 'pm-params-label'
      label.textContent = ui.params
      const chips = doc.createElement('div')
      chips.className = 'pm-chips'
      for (const a of params) {
        const chip = doc.createElement('code')
        chip.className = 'pm-chip'
        chip.textContent = a.value === '' ? a.name : `${a.name}: ${a.value}`
        chips.append(chip)
      }
      box.append(label, chips)
      card.append(box)
    }
    const edit = doc.createElement('button')
    edit.type = 'button'
    edit.className = 'btn pm-edit'
    edit.textContent = ui.edit
    edit.addEventListener('click', () => {
      close()
      host.edit()
    })
    card.append(edit)
  }

  function show(): void {
    clearTimeout(closeTimer)
    if (opened || !info) return
    host.beforeOpen?.()
    opened = true
    draw()
    card.hidden = false
    button.setAttribute('aria-expanded', 'true')
  }

  function close(restoreFocus = false): void {
    clearTimeout(openTimer)
    clearTimeout(closeTimer)
    pinned = false
    button.classList.remove('pinned')
    if (opened) {
      opened = false
      card.hidden = true
      button.setAttribute('aria-expanded', 'false')
    }
    if (restoreFocus) button.focus()
  }

  const enter = (): void => {
    clearTimeout(closeTimer)
    if (opened) return
    clearTimeout(openTimer)
    openTimer = setTimeout(show, OPEN_DELAY)
  }
  const leave = (): void => {
    clearTimeout(openTimer)
    if (!opened || pinned) return
    clearTimeout(closeTimer)
    closeTimer = setTimeout(() => close(), CLOSE_DELAY)
  }
  button.addEventListener('mouseenter', enter)
  button.addEventListener('mouseleave', leave)
  card.addEventListener('mouseenter', () => clearTimeout(closeTimer))
  card.addEventListener('mouseleave', leave)
  // a click pins the card (Enter on the focused badge is a click), a second click closes it
  button.addEventListener('click', () => {
    if (opened && pinned) return close()
    show()
    pinned = true
    button.classList.add('pinned')
  })
  const onDown = (event: MouseEvent): void => {
    if (!opened) return
    const target = event.target instanceof Node ? event.target : null
    if (target && (card.contains(target) || button.contains(target))) return
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

  return {
    button,
    card,
    get isOpen() {
      return opened
    },
    update(next) {
      info = next && !next.open ? next : null
      button.hidden = info === null
      if (!info) return close()
      if (opened) draw()
    },
    close,
    destroy() {
      clearTimeout(openTimer)
      clearTimeout(closeTimer)
      doc.removeEventListener('mousedown', onDown)
      doc.removeEventListener('keydown', onKey)
      button.remove()
      card.remove()
    },
  }
}
