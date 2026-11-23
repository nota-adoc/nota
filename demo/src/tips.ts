// Tooltips: the name of a button and its keys, 0.4 s after the pointer stops on it, at once when the keyboard reaches it.
import { keyHints } from './keys.js'

/** What has a tooltip: whatever names itself in `data-tip`, and the buttons of the toolbar by their `aria-label`. */
const TIP_SELECTOR = '[data-tip], .tb[aria-label]'
const DELAY = 400

function fill(tip: HTMLElement, el: HTMLElement, mac: boolean): boolean {
  const name = el.dataset.tip || el.getAttribute('aria-label') || ''
  if (!name) return false
  const children: HTMLElement[] = []
  const label = document.createElement('span')
  label.textContent = name
  children.push(label)
  for (const hint of el.dataset.keys ? keyHints(el.dataset.keys, mac) : []) {
    const kbd = document.createElement('kbd')
    kbd.textContent = hint.keys
    children.push(kbd)
    if (hint.note) {
      const note = document.createElement('span')
      note.className = 'tip-note'
      note.textContent = hint.note
      children.push(note)
    }
  }
  tip.replaceChildren(...children)
  return true
}

/** Puts the tooltip `tip` under the element it names, or above it when there is no room below. */
function place(tip: HTMLElement, el: HTMLElement): void {
  const box = el.getBoundingClientRect()
  const { offsetWidth: width, offsetHeight: height } = tip
  const left = Math.max(8, Math.min(box.left + box.width / 2 - width / 2, innerWidth - width - 8))
  let top = box.bottom + 6
  if (top + height > innerHeight - 8) top = box.top - height - 6
  tip.style.left = `${left}px`
  tip.style.top = `${top}px`
}

export function installTips(tip: HTMLElement, mac: boolean): void {
  let timer: ReturnType<typeof setTimeout> | undefined
  let current: Element | null = null
  // a focus that came from the keyboard shows the tooltip; a focus that came from a click does not
  let byKeyboard = false

  const hide = (): void => {
    clearTimeout(timer)
    tip.hidden = true
    current = null
  }
  const show = (el: HTMLElement): void => {
    if (!el.isConnected || !fill(tip, el, mac)) return
    tip.hidden = false
    place(tip, el)
  }
  const target = (event: Event): HTMLElement | null =>
    event.target instanceof Element ? event.target.closest<HTMLElement>(TIP_SELECTOR) : null

  document.addEventListener('pointerover', (event) => {
    const el = target(event)
    if (el === current) return
    hide()
    if (!el) return
    current = el
    timer = setTimeout(() => show(el), DELAY)
  })
  document.addEventListener('keydown', () => (byKeyboard = true), true)
  document.addEventListener(
    'pointerdown',
    () => {
      byKeyboard = false
      hide()
    },
    true,
  )
  document.addEventListener('focusin', (event) => {
    const el = target(event)
    if (!el || !byKeyboard) return
    hide()
    current = el
    show(el)
  })
  document.addEventListener('focusout', hide)
  document.addEventListener('scroll', hide, true)
}
