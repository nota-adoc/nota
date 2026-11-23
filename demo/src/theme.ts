// The theme of the page: at the first open it is the system's, a press of the button chooses light or dark and the choice
// stays until the page is closed. The colours are the tokens `--ap-*` of style.css: the attribute `data-theme` on the root
// switches them all at once (the header, the toolbar, both windows, the status line); the code here only tells the editor.
import { onLang, t } from './i18n.js'

export interface ThemeOptions {
  /** The button: its state, name and tooltip say what a press would do. */
  button: HTMLElement
  /** Called when the theme becomes light or dark, by a press or by the system. */
  onChange(dark: boolean): void
}

export interface Theme {
  isDark(): boolean
}

export function setupTheme({ button, onChange }: ThemeOptions): Theme {
  const root = document.documentElement
  const system = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null

  /** The choice of the person, else the system. */
  const isDark = (): boolean => {
    const chosen = root.getAttribute('data-theme')
    return chosen === 'dark' ? true : chosen === 'light' ? false : (system?.matches ?? false)
  }

  function paint(): void {
    const dark = isDark()
    const label = dark ? t('theme.light') : t('theme.dark')
    button.setAttribute('aria-pressed', String(dark))
    button.setAttribute('aria-label', label)
    button.dataset.tip = label
    // the moon offers the dark theme, the sun the light one (an attribute: an SVG element has no `hidden` property)
    button.querySelector('.moon')!.toggleAttribute('hidden', dark)
    button.querySelector('.sun')!.toggleAttribute('hidden', !dark)
    onChange(dark)
  }

  button.addEventListener('click', () => {
    root.setAttribute('data-theme', isDark() ? 'light' : 'dark')
    paint()
  })
  system?.addEventListener('change', paint)
  onLang(paint)
  paint()
  return { isDark }
}
