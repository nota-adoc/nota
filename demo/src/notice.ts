// The message of a refusal at the bottom of «Визуально»: it says why a command or typing was refused, and stays until the next
// command or typing, or until the cross is pressed.
import type { VisualEditor } from '@nota-adoc/prosemirror'

export interface Notice {
  show(message: string): void
  hide(): void
}

export interface NoticeOptions {
  box: HTMLElement
  text: HTMLElement
  /** The cross «Скрыть». */
  close: HTMLElement
  /** The host of the visual editor: what is typed in it removes the message. */
  host: HTMLElement
  editor(): VisualEditor | undefined
}

/** Keys that move the cursor or do nothing by themselves: they are not typing, the message stays. */
const NOT_TYPING = /^(?:Shift|Control|Alt|AltGraph|Meta|CapsLock|Tab|Escape|Arrow(?:Left|Right|Up|Down)|Home|End|Page(?:Up|Down)|F\d{1,2})$/

const isTyping = (event: KeyboardEvent): boolean =>
  !NOT_TYPING.test(event.key) &&
  // copying and selecting everything change nothing in the text
  !((event.ctrlKey || event.metaKey) && !event.altKey && /^[ca]$/i.test(event.key))

export function setupNotice({ box, text, close, host, editor }: NoticeOptions): Notice {
  const hide = (): void => {
    box.hidden = true
  }
  // in the capture phase: the editor hears the key after this, and a refusal that it makes for this very key stays on the screen
  host.addEventListener('beforeinput', hide, true)
  host.addEventListener('keydown', (event) => isTyping(event) && hide(), true)
  close.addEventListener('click', () => {
    hide()
    editor()?.focus()
  })
  return {
    show(message) {
      text.textContent = message
      box.hidden = false
    },
    hide,
  }
}
