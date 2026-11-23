// Keys of the commands as a person of the platform reads them: `⌘B` on a Mac, `Ctrl+B` elsewhere.

export interface KeyHint {
  /** The keys, e.g. `⇧⌘Z` or `Ctrl+Shift+Z`. */
  keys: string
  /** What the keys do when the command has several, e.g. `текст`. */
  note?: string
}

/** Whether the keyboard is a Mac's (and an iPad's, an iPhone's). */
export function isMacPlatform(): boolean {
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent)
}

const SYMBOLS: Record<string, string> = { ctrl: '⌃', alt: '⌥', shift: '⇧', mod: '⌘' }
const NAMES: Record<string, string> = { mod: 'Ctrl', ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift' }

/**
 * The hints of a spec of keys: `mod+shift+Z`, or several with what each does, `mod+alt+0:текст|mod+alt+2…6:заголовки`.
 * `mod` is the command key of a Mac and Ctrl elsewhere.
 */
export function keyHints(spec: string, mac: boolean): KeyHint[] {
  return spec.split('|').map((part) => {
    const [combo = '', note] = part.split(':')
    const modifiers = combo.split('+')
    const key = modifiers.pop() ?? ''
    // a Mac writes the modifiers as symbols in the order ⌃⌥⇧⌘, glued to the key; elsewhere they are words joined by plus
    const keys = mac
      ? ['ctrl', 'alt', 'shift', 'mod']
          .filter((m) => modifiers.includes(m))
          .map((m) => SYMBOLS[m])
          .join('') + key
      : ['mod', 'ctrl', 'alt', 'shift']
          .filter((m) => modifiers.includes(m))
          .map((m) => NAMES[m]!)
          .concat(key)
          .join('+')
    return note ? { keys, note } : { keys }
  })
}
