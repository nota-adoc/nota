/** Whether the keys are the ones of a Mac (⌘), for the hints; Ctrl everywhere else. */
export function isMac(): boolean {
  const nav = typeof navigator === 'undefined' ? undefined : navigator
  return /Mac|iPhone|iPad/i.test(nav?.platform || nav?.userAgent || '')
}

/** The hint of a button: `Bold · ⌘B`; without keys the label alone. Keys are `{ mod, shift, alt, key }`. */
export function hint(label: string, keys?: { shift?: boolean; alt?: boolean; key: string }): string {
  if (!keys) return label
  const mac = isMac()
  const parts = mac
    ? ['⌘', keys.shift ? '⇧' : '', keys.alt ? '⌥' : '', keys.key]
    : ['Ctrl+', keys.shift ? 'Shift+' : '', keys.alt ? 'Alt+' : '', keys.key]
  return `${label} · ${parts.join('')}`
}
