// A DOM for the fuzzing of the visual editor, which needs one (ProseMirror): jsdom, put into the globals once.
import { JSDOM } from 'jsdom'

let installed = false

/** Puts jsdom into the globals (the way the test environment of Vitest does). Safe to call again. */
export function installDom(): void {
  if (installed) return
  installed = true
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true })
  const win = dom.window as unknown as Record<string, unknown>
  const g = globalThis as unknown as Record<string, unknown>
  // the events must be those of jsdom (its nodes do not take the ones of Node), and the window and document its own
  const override = new Set([
    'window',
    'document',
    'navigator',
    'Event',
    'EventTarget',
    'CustomEvent',
    'KeyboardEvent',
    'InputEvent',
    'CompositionEvent',
    'MouseEvent',
    'FocusEvent',
    'UIEvent',
  ])
  for (const key of Object.getOwnPropertyNames(win)) {
    if (key in g && !override.has(key)) continue
    if (key.startsWith('_') || key === 'undefined') continue
    try {
      Object.defineProperty(g, key, {
        configurable: true,
        enumerable: false,
        get: () => win[key],
        set: (v) => Object.defineProperty(g, key, { value: v, configurable: true, writable: true }),
      })
    } catch {
      // a global that cannot be replaced stays
    }
  }
  g.window = win
  g.document = win.document
  Object.defineProperty(g, 'navigator', { value: win.navigator, configurable: true })
  // the class of the Node and Text of jsdom for instanceof checks
  g.getComputedStyle = (win.getComputedStyle as (...a: unknown[]) => unknown).bind(win)
}
