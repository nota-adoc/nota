/**
 * The page of a tab: the visual editor of `@nota-adoc/prosemirror` and the source of `@nota-adoc/codemirror` on one mirror
 * of the VS Code document, the three capsules over it (sections, tools, remarks) with the cards that hang from them, the
 * island of strokes at the left edge, the remarks of Nota in the text.
 * It talks to the host by the messages of `protocol.ts` and knows nothing of VS Code but them.
 */
import { Compartment, EditorSelection, EditorState } from '@codemirror/state'
import { lintGutter } from '@codemirror/lint'
import { oneDark } from '@codemirror/theme-one-dark'
import { EditorView } from '@codemirror/view'
import { type SourceEditor, createSourceEditor } from '@nota-adoc/codemirror'
import { createVisualEditor, type DiagramRenderer, type InsertKind, type VisualEditor } from '@nota-adoc/prosemirror'
import { Plugin } from 'prosemirror-state'
import { type FileList, type Locale, editorLabels, messages as reactMessages } from '@nota-adoc/react'
import { setupNotice } from '../../../../demo/src/notice.js'
import type { Mode, ToHost, ToTab } from '../protocol.js'
import { phrases, strings } from '../strings.js'
import { counts, remarkText } from './diagnostics.js'
import { Mirror } from './mirror.js'
import { type PageMetaBadge, createPageMeta } from './pagemeta.js'
import { type RemarkItem, type Remarks, createRemarks } from './remarks.js'
import { type Format, mountFormat } from './format.js'
import { createOutline, headingOffset, type Outline } from './outline.js'
import { coverFrom, ISLES_MIN_HEIGHT, sourceTopHeight } from './cover.js'
import { highlightCode } from './highlight.js'
import { pathForDocument, resolveImage } from './images.js'
import { createMermaidRenderer } from './mermaid.js'

/** What the tab needs of `acquireVsCodeApi()`. */
export interface HostApi {
  postMessage(message: ToHost): void
}

export interface StartOptions {
  /** The first line is shown after this many ms (the editor opens faster than that, mostly). Default 400. */
  readonly loadingDelay?: number
  readonly groupDelay?: number
  /** The nonce of the style sheets CodeMirror makes (the content security policy of the tab asks for it). */
  readonly nonce?: string
  /** Draws the code of a diagram (the tests give a stand-in); by default the file `dist/mermaid.js`, at the address of `data-mermaid` of the page. */
  readonly renderDiagram?: DiagramRenderer
  /** The keys are the ones of a Mac (Cmd+click opens a link); default: as the browser says. */
  readonly mac?: boolean
}

export interface Page {
  readonly mirror: Mirror | undefined
  /** The visual editor; none yet in a big file that was not asked to open visually. */
  readonly editor: VisualEditor | undefined
  /** The source; none until the first switch to «Текст» (or for a file opened in «Визуально» that never left it). */
  readonly source: SourceEditor | undefined
  readonly mode: Mode
  /** The language of the strings, as the host said it (the page's own `lang` until then). */
  readonly locale: Locale
  readonly outline: Outline | undefined
  /** The right capsule and the card of a remark. */
  readonly remarks: Remarks | undefined
  /** The badge «i» of the header of the page and its card. */
  readonly pagemeta: PageMetaBadge | undefined
  /** Switches the mode as the button of the title does. */
  toggleMode(): void
  /** Draws what waits for a frame now: the tree and the marks of remarks. */
  flush(): void
  destroy(): void
}

/** The text of a refusal as a Russian tab shows it: there is no «Исходник» here, the mode «Текст» takes its place. */
export const messages: Record<string, string> = { ...reactMessages.ru.reject }

/** The refusal of an edit that was made on a document that had changed. */
/** (Russian, for the tests; the page takes the text of its own language.) */
export const STALE_MESSAGE = strings.ru.stale

/** The strip after a failure in a tab that had shown its document. */
export const CRASH_MESSAGE = strings.ru.crash

/** A tab that failed this many times in `CRASH_WINDOW_MS` gives up and the host shows the screen «не открылся». */
export const CRASH_LIMIT = 3
export const CRASH_WINDOW_MS = 10_000

/** `1,4 МБ` (one digit after the comma). */
export const sizeText = (bytes: number): string => strings.ru.size(bytes)

/** The text of the strip of a big file. */
export const bigText = (bytes: number): string => strings.ru.big(bytes)

/** `light` or `dark` by the class of `body` that VS Code sets: the high contrast themes follow the light or dark one. */
export function themeOf(classes: DOMTokenList): 'light' | 'dark' {
  if (classes.contains('vscode-dark')) return 'dark'
  if (classes.contains('vscode-high-contrast') && !classes.contains('vscode-high-contrast-light')) return 'dark'
  return 'light'
}

/** Keeps `data-nota-theme` of `body` as the theme of VS Code says, now and when the class changes. */
export function followTheme(body: HTMLElement, onChange?: (theme: 'light' | 'dark') => void): () => void {
  const apply = (): void => {
    const theme = themeOf(body.classList)
    body.dataset.notaTheme = theme
    onChange?.(theme)
  }
  apply()
  const observer = new MutationObserver(apply)
  observer.observe(body, { attributes: true, attributeFilter: ['class'] })
  return () => observer.disconnect()
}

/** `nota.showAnchors`: a flag on the body, the CSS shows the plates of the anchors over the blocks. */
function setShowAnchors(on: boolean | undefined): void {
  if (on === true) document.body.dataset.showAnchors = ''
  else delete document.body.dataset.showAnchors
}

/** The view of the outline (`nota.outlineView`): an attribute on the body for the style sheet; unset or anything else is `capsule`. */
let outlineViewNow: 'capsule' | 'side' = 'capsule'
let onOutlineView: (view: 'capsule' | 'side') => void = () => undefined
function setOutlineView(view: unknown): void {
  outlineViewNow = view === 'side' ? 'side' : 'capsule'
  document.body.dataset.outlineView = outlineViewNow
  onOutlineView(outlineViewNow)
  window.dispatchEvent(new Event('resize'))
}

/** The width of the page (`nota.pageWidth`): a percent of the tab on the body; the layers placed by the page are told by a resize. */
function setPageWidth(percent: number | undefined): void {
  const n = typeof percent === 'number' && Number.isFinite(percent) ? Math.min(100, Math.max(50, percent)) : 85
  document.body.style.setProperty('--nota-page', `${n}cqw`)
  document.body.dataset.pageWidth = String(n)
  window.dispatchEvent(new Event('resize'))
}

/**
 * A click on a link puts the cursor in it; VS Code must not open the address. Cmd+click (Ctrl+click off a Mac) in the visual
 * mode is the person asking to open it: the page does not put the cursor there, and `open` gets the target.
 */
function guardLinks(root: HTMLElement, mac: boolean, open: (a: HTMLAnchorElement) => void, visual: () => boolean): void {
  const asked = (event: MouseEvent): boolean => (mac ? event.metaKey : event.ctrlKey) && visual()
  const anchorOf = (event: Event): HTMLAnchorElement | null =>
    event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a') : null
  const stop = (event: Event): void => {
    if (!anchorOf(event)) return
    event.preventDefault()
    event.stopPropagation()
  }
  // the editor must not hear the press: it would put the cursor in the link or select a word
  root.addEventListener(
    'mousedown',
    (event) => {
      if (anchorOf(event) && asked(event)) {
        event.preventDefault()
        event.stopPropagation()
      }
    },
    true,
  )
  root.addEventListener(
    'click',
    (event) => {
      const a = anchorOf(event)
      if (!a) return
      event.preventDefault()
      event.stopPropagation()
      if (asked(event)) open(a)
    },
    true,
  )
  root.addEventListener('auxclick', stop, true)
  // with the key held the links show the hand (as in the editor of code); the other modifier of the system does nothing
  const key = (event: MouseEvent | KeyboardEvent): void => {
    root.classList.toggle('link-key', (mac ? event.metaKey : event.ctrlKey) && visual())
  }
  const owner = root.ownerDocument
  owner.addEventListener('keydown', key, true)
  owner.addEventListener('keyup', key, true)
  root.addEventListener('mousemove', key, true)
  owner.defaultView?.addEventListener('blur', () => root.classList.remove('link-key'))
}

/** The ProseMirror plugin of the same: the editor itself never follows an address. */
const linkGuard = new Plugin({
  props: {
    handleDOMEvents: {
      click: (_view, event) => {
        if (event.target instanceof Element && event.target.closest('a')) event.preventDefault()
        return false
      },
    },
    handleClickOn: () => false,
  },
})

/** The editable text is the document of the styles: its class, its name for a screen reader, and no spelling marks. */
const documentLook = (label: string): Plugin =>
  new Plugin({ props: { attributes: { class: 'doc', 'aria-label': label, spellcheck: 'false' } } })

/** the gear of the round capsule «Настройки Nota». */
const GEAR_ICON =
  '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>'

const ICON_WARN =
  '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 2.5 20h19z"/><path d="M12 10v4M12 17.2v.1"/></svg>'
const ICON_X =
  '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>'

/** The errors of the page since it opened (the drag suite checks that it gives none). */
let pageErrors = 0
let e2eHooked = false
/** Under the suite only: the counter of errors and the guard of a held border. */
function hookE2e(): void {
  if (e2eHooked) return
  e2eHooked = true
  window.addEventListener('error', () => pageErrors++)
  window.addEventListener('unhandledrejection', () => pageErrors++)
  document.addEventListener('mousemove', guardHeld, true)
}

/** A pause by a timer: the frames are not drawn in a window without focus, so the suite does not wait for them. */
const frames = (n = 3): Promise<void> => new Promise((done) => setTimeout(done, 60 * n))

/** The table the cursor is in, with the mouse over it, so that the layer of the grips shows. */
async function hoverTable(view: VisualEditor['view']): Promise<HTMLElement | null> {
  const node = view.domAtPos(view.state.selection.head).node
  const tbl = (node.nodeType === 1 ? (node as Element) : node.parentElement)?.closest<HTMLElement>('.tbl') ?? null
  const frame = tbl?.querySelector(':scope > .tbl-scroll')?.getBoundingClientRect()
  if (!tbl || !frame) return null
  document.dispatchEvent(new MouseEvent('mousemove', { clientX: frame.left + 24, clientY: frame.top + 12, bubbles: true }))
  await frames()
  return tbl
}

const mouse = (type: string, init: MouseEventInit): MouseEvent => new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...init })

/** `col:0-1` or `row:2`: a click on the grip, Shift-click on the last one; then the command `then` (`deleteColumn`, `deleteRow`, `cellFill:cell-blue`). */
async function e2eGrips(view: VisualEditor['view'], c: VisualEditor['commands'], spec: string, then?: string): Promise<void> {
  if (!(await hoverTable(view))) return
  const [kind, range] = spec.split(':')
  const [from, to = from] = range!.split('-').map(Number)
  const grips = (): Element[] => [...document.querySelectorAll(`.nota-grips .${kind === 'col' ? 'cg' : 'rg'}`)]
  grips()[from!]?.dispatchEvent(mouse('mousedown', {}))
  if (to !== from) {
    await frames()
    grips()[to!]?.dispatchEvent(mouse('mousedown', { shiftKey: true }))
  }
  const [name, arg] = (then ?? '').split(':')
  if (name === 'deleteColumn') c.deleteColumn()
  else if (name === 'deleteRow') c.deleteRow()
  else if (name === 'cellFill') c.setCellFill(arg!)
}

/**
 * `col:1` or `row:1` is the grip of a column or of a row (from 0); `then` is the button of its bar: `left`, `right`, `delete` for a column, `above`,
 * `below`, `delete` for a row. The mouse goes to the grip, waits for the bar and presses the button.
 */
async function e2eGripBar(view: VisualEditor['view'], spec: string, then?: string): Promise<void> {
  if (!(await hoverTable(view))) return
  const [kind, i] = spec.split(':')
  const strip = document.querySelectorAll(`.nota-grips .${kind === 'col' ? 'cg' : 'rg'}`)[Number(i)]
  if (!strip) return
  const r = strip.getBoundingClientRect()
  document.dispatchEvent(new MouseEvent('mousemove', { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true }))
  const act = { left: 'before', above: 'before', right: 'after', below: 'after', delete: 'delete' }[then ?? ''] ?? ''
  for (let k = 0; k < 20; k++) {
    await frames()
    const button = document.querySelector<HTMLElement>(`.nota-grips .gb:not([hidden]) .gbtn[data-act="${act}"]`)
    if (button) {
      button.click()
      return
    }
  }
}

/** The button of a border dragged by `border|i,dx|hold` is still down: where the mouse is. */
let heldBorder: { x: number; y: number } | null = null
/** While a border is held, a mouse move of the real pointer (Chromium sends one after a change of the layout, without the button) is not let through: it would end the drag. */
const guardHeld = (event: MouseEvent): void => {
  if (heldBorder && event.isTrusted) event.stopImmediatePropagation()
}

/**
 * `2,40` drags the border 2 (between the columns 1 and 2) by 40 px, `2,double` is a double click on it. Third part: `hold` keeps
 * the button down, `click` presses and lets go without a move. `release` lets go of a held one, `esc` presses Escape.
 */
async function e2eBorder(view: VisualEditor['view'], spec: string, then?: string): Promise<void> {
  if (spec === 'release' && heldBorder) {
    document.dispatchEvent(mouse('mouseup', { clientX: heldBorder.x, clientY: heldBorder.y }))
    heldBorder = null
    return
  }
  if (spec.startsWith('move,') && heldBorder) {
    // (the held drag goes on: dx more, in steps)
    const dx = Number(spec.slice(5))
    const { x, y } = heldBorder
    for (let k = 1; k <= 6; k++) document.dispatchEvent(mouse('mousemove', { clientX: x + (dx * k) / 6, clientY: y, buttons: 1 }))
    heldBorder = { x: x + dx, y }
    return
  }
  if (spec === 'esc') {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    heldBorder = null
    return
  }
  if (spec === 'scrollEnd') {
    // (the frame of the table goes to its right end, where the border of the last column is)
    const frame = (await hoverTable(view))?.querySelector<HTMLElement>(':scope > .tbl-scroll')
    if (frame) frame.scrollLeft = frame.scrollWidth - frame.clientWidth
    await frames()
    return
  }
  if (!(await hoverTable(view))) return
  const [i, by] = spec.split(',')
  // (by the number of the border, not by the place among the strips: the borders that are out of the frame have no strip)
  // (the layer is drawn at a frame after a scroll or a layout, and under load that is late: wait for the strip, and for it to stand still, instead of pressing on air or on a stale place)
  const strip = (): Element | null => document.querySelector(`.nota-grips .bd[data-border="${Number(i)}"]`)
  let border = strip()
  let rect = border?.getBoundingClientRect()
  for (let k = 0; k < 100; k++) {
    await frames(2)
    if (k % 5 === 4) await hoverTable(view)
    const now = strip()
    const next = now?.getBoundingClientRect()
    const still = !!now && !!rect && Math.abs(next!.left - rect.left) < 0.5 && Math.abs(next!.top - rect.top) < 0.5
    border = now
    rect = next
    if (still && k >= 2) break
  }
  if (!border) return
  const r = border.getBoundingClientRect()
  const x = r.left + r.width / 2
  const y = r.top + 20
  if (by === 'double') {
    border.dispatchEvent(mouse('mousedown', { clientX: x, clientY: y, detail: 2 }))
    return
  }
  border.dispatchEvent(mouse('mousedown', { clientX: x, clientY: y, buttons: 1 }))
  if (then === 'click') {
    document.dispatchEvent(mouse('mouseup', { clientX: x, clientY: y }))
    return
  }
  const dx = Number(by)
  const steps = 6
  // (held from the press on: the pointer of the real mouse must not end it while the page lays itself out again)
  // (it stands where the moves below will leave it, from the first moment: a read of the state in the middle of the command must not see the place of the press)
  // (also a drag that goes on to the button up: under load the real pointer, sent by Chromium after the layout changed, came in the frames before the button up and cancelled it, and nothing was written)
  heldBorder = { x: x + dx, y }
  for (let k = 1; k <= steps; k++) document.dispatchEvent(mouse('mousemove', { clientX: x + (dx * k) / steps, clientY: y, buttons: 1 }))
  await frames(1)
  // (a held border is not set again here: under load this line ran after the next command `move,` and put the held place back to where the first move ended)
  if (then === 'hold') return
  document.dispatchEvent(mouse('mouseup', { clientX: x + dx, clientY: y }))
  heldBorder = null
}

/** The commands of the suite `npm run test:vscode`: type at the cursor, undo, redo, as a person would. */
function e2eCommand(page: { visual?: VisualEditor; source?: SourceEditor; mirror: Mirror; outline?: Outline }, name: string, text = ''): void {
  const { visual, source } = page
  if (source && !source.view.dom.closest('[hidden]')) {
    if (name === 'e2e-undo') page.mirror.undo({ origin: source })
    else if (name === 'e2e-redo') page.mirror.redo({ origin: source })
    else if (name === 'e2e-type') source.view.dispatch(source.view.state.replaceSelection(text), { userEvent: 'input.type' })
    return
  }
  if (!visual) return
  const view = visual.view
  if (name === 'e2e-undo') visual.commands.undo()
  else if (name === 'e2e-redo') visual.commands.redo()
  else if (name === 'e2e-textcolor') visual.commands.setTextColor(text === '' ? null : text)
  else if (name === 'e2e-fill') visual.commands.setFill(text === '' ? null : text)
  else if (name === 'e2e-link') visual.commands.setLink(text)
  else if (name === 'e2e-list') visual.commands.toggleList(text as 'unordered' | 'ordered' | 'checklist')
  else if (name === 'e2e-tab') {
    if (text === 'shift') visual.commands.outdentListItem()
    else visual.commands.indentListItem()
  } else if (name === 'e2e-codetab') visual.commands.indentCode(text === 'shift' ? -1 : 1)
  else if (name === 'e2e-codelang') visual.commands.setCodeLanguage(text)
  else if (name === 'e2e-insert') {
    const [kind, path] = text.split('|')
    visual.commands.insertBlock(kind as InsertKind, path ? { path } : {})
  } else if (name === 'e2e-dismissslash') visual.commands.dismissSlash()
  else if (name === 'e2e-check') visual.commands.setChecked()
  else if (name === 'e2e-admonition') visual.commands.setAdmonitionType(text as 'NOTE')
  else if (name === 'e2e-collapsible') visual.commands.toggleCollapsible(Number(text))
  else if (name === 'e2e-table') {
    // `merge|a,b`: the cursor in the cell at offset a, Shift-click on the cell at offset b, then «Объединить»
    const [cmd, arg, then] = text.split('|')
    const c = visual.commands
    // the cell at the offset `at` of the text
    const cellAt = (at: number): Element | null => {
      visual.setSelectionAtOffset(at)
      const node = view.domAtPos(view.state.selection.head).node
      return (node.nodeType === 1 ? (node as Element) : node.parentElement)?.closest('td, th') ?? null
    }
    if (cmd === 'select') {
      // `select|a,b`: the button down in the cell at offset a, the pointer to the cell at offset b, the button up
      const [a, b] = arg!.split(',').map(Number)
      const from = cellAt(a!)
      const to = cellAt(b!)
      visual.setSelectionAtOffset(a!)
      const event = (type: string, buttons: number) => new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, buttons })
      from?.dispatchEvent(event('mousedown', 1))
      to?.dispatchEvent(event('mousemove', 1))
      to?.dispatchEvent(event('mouseup', 0))
    } else if (cmd === 'grips') void e2eGrips(view, c, arg!, then)
    else if (cmd === 'gripbar') void e2eGripBar(view, arg!, then)
    else if (cmd === 'border') void e2eBorder(view, arg!, then)
    else if (cmd === 'mergeCells') c.mergeCells()
    else if (cmd === 'merge') {
      const [a, b] = arg!.split(',').map(Number)
      visual.setSelectionAtOffset(b!)
      const node = view.domAtPos(view.state.selection.head).node
      const cell = (node.nodeType === 1 ? (node as Element) : node.parentElement)?.closest('td, th')
      visual.setSelectionAtOffset(a!)
      cell?.dispatchEvent(new MouseEvent('mousedown', { shiftKey: true, bubbles: true, cancelable: true }))
      c.mergeCells()
    } else if (cmd === 'tab') c.nextCell(arg === 'shift' ? -1 : 1)
    else if (cmd === 'insertRow') c.insertRow()
    else if (cmd === 'insertColumn') c.insertColumn()
    else if (cmd === 'deleteRow') c.deleteRow()
    else if (cmd === 'deleteColumn') c.deleteColumn()
    else if (cmd === 'splitCell') c.splitCell()
    else if (cmd === 'toggleHeader') c.toggleHeader()
    else if (cmd === 'nestTable') c.nestTable()
    else if (cmd === 'deleteTable') c.deleteTable()
    else if (cmd === 'cellFill') c.setCellFill(arg === 'none' ? null : arg!)
    // the commands of the capsule of selected cells (`align|center,bottom`: the horizontal and the vertical, one of them may be empty)
    else if (cmd === 'splitCells') c.splitCells()
    else if (cmd === 'clearCells') c.clearCells()
    else if (cmd === 'deleteSelectedRows') c.deleteSelectedRows()
    else if (cmd === 'deleteSelectedColumns') c.deleteSelectedColumns()
    else if (cmd === 'align') {
      const [h, v] = arg!.split(',')
      c.setCellAlign(h ? (h as 'left') : undefined, v ? (v as 'top') : undefined)
    }
  }
  else if (name === 'e2e-move') {
    // `tree|from|to|before` drops a row of the tree on another one, `swap|i|up` is Alt+↑ / Alt+↓, `block|at|to` is the handle
    const [kind, a, b, c] = text.split('|')
    if (kind === 'tree') page.outline?.dropOn(Number(a), Number(b), c === 'after' ? 'after' : 'before')
    else if (kind === 'swap') page.outline?.swap(Number(a), b === 'up')
    else visual.commands.moveBlock(Number(a), Number(b))
  } else if (name === 'e2e-block') {
    // `caption|at|text`, `anchor|at|id`, `delete|at`
    const [kind, at, value] = text.split('|')
    if (kind === 'caption') visual.commands.setBlockTitle(Number(at), value ?? '')
    else if (kind === 'anchor') visual.commands.setBlockAnchor(Number(at), value ?? '')
    else if (kind === 'delete') visual.commands.deleteBlockAt(Number(at))
  } else if (name === 'e2e-select') {
    const [a, h] = text.split(',').map(Number)
    visual.setSelectionAtOffset(a!, h ?? a!)
    // (the suite of the width needs the place of the selection on the screen)
    visual.scrollToOffset(h ?? a!)
  } else if (name === 'e2e-type')
    for (const ch of text) {
      const { from, to } = view.state.selection
      if (!view.someProp('handleTextInput', (f) => f(view, from, to, ch, () => view.state.tr.insertText(ch, from, to))))
        view.dispatch(view.state.tr.insertText(ch, from, to))
    }
}

/** The marks the keys of VS Code ask for, by the physical key (the layout may be Russian). */
const MARK_KEYS: Record<string, string> = { KeyB: 'strong', KeyI: 'em', KeyE: 'code' }
const SHIFT_MARK_KEYS: Record<string, string> = { KeyX: 'strike', KeyH: 'highlight' }
/** The styles ⌘⌥0 / ⌘⌥2 / ⌘⌥3 ask for, by the physical key; the names of the commands of the host. */
const STYLE_KEYS: Record<string, { name: string; type: 'paragraph' | 'heading'; level?: number }> = {
  Digit0: { name: 'style-paragraph', type: 'paragraph' },
  Digit2: { name: 'style-heading2', type: 'heading', level: 2 },
  Digit3: { name: 'style-heading3', type: 'heading', level: 3 },
}
const STYLE_COMMANDS = Object.values(STYLE_KEYS)

/** The page is scrolled to its end. */
const atEnd = (el: HTMLElement): boolean => el.scrollHeight > el.clientHeight && el.scrollTop + el.clientHeight >= el.scrollHeight - 2

// the nonce of the script that loaded this bundle: the style sheets CodeMirror makes carry it
const SCRIPT_NONCE =
  typeof document !== 'undefined' ? ((document.currentScript as HTMLScriptElement | null)?.nonce || undefined) : undefined

export function startPage(api: HostApi, root: HTMLElement, options: StartOptions = {}): Page {
  const doc = root.ownerDocument
  const nonce = options.nonce ?? SCRIPT_NONCE
  const mac = options.mac ?? (typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent || ''))
  // the page says its language in `lang` before the host's first message
  let locale: Locale = doc.documentElement.lang === 'ru' ? 'ru' : 'en'
  let t = strings[locale]
  let format: Format | undefined
  /** `nota.blocksInCapsule`: which blocks the open capsule shows; read when the capsule is built, and told to it when the setting changes. */
  let blocksInCapsule: 'all' | 'frequent' = 'all'
  const setBlocksInCapsule = (set: 'all' | 'frequent' | undefined): void => {
    blocksInCapsule = set === 'frequent' ? 'frequent' : 'all'
    format?.setBlocks(blocksInCapsule)
  }
  /** The refusal the last command got, for the windows of the panel. */
  let lastReject: { code: string; text: string } | null = null
  // where the pictures are: the folder of the file in the webview, and the `:imagesdir:` the host read at the start
  let imageBase = ''
  let smoothTimer: ReturnType<typeof setTimeout> | undefined
  let imagesdirAtStart = ''
  let nextFiles = 1
  const waitingFiles = new Map<number, (list: FileList) => void>()
  const renderDiagram = options.renderDiagram ?? createMermaidRenderer(doc, root.dataset.mermaid, nonce)
  const darkTheme = new Compartment()
  let dark = false
  let mirror: Mirror | undefined
  let editor: VisualEditor | undefined
  let source: SourceEditor | undefined
  const stopTheme = followTheme(doc.body, (theme) => {
    dark = theme === 'dark'
    source?.view.dispatch({ effects: darkTheme.reconfigure(dark ? oneDark : []) })
    // (the pictures of diagrams are drawn in the colours of the theme)
    editor?.redrawDiagrams()
  })
  let outline: Outline | undefined
  /** For the e2e state: the view of the outline and which of its parts is on the screen now. */
  const outlineState = (): { view: string; column: boolean; strokes: boolean; capsule: boolean } => {
    const shown = (el: HTMLElement | undefined): boolean => !!el && !el.hidden && el.getClientRects().length > 0
    return { view: document.body.dataset.outlineView ?? '', column: shown(outline?.side), strokes: shown(outline?.strokes), capsule: shown(outline?.isle) && !outline?.isle.hasAttribute('data-empty') && getComputedStyle(outline!.isle).visibility !== 'hidden' }
  }
  let remarks: Remarks | undefined
  let pagemeta: PageMetaBadge | undefined
  let mode: Mode = 'visual'
  let destroyed = false
  /** The document was shown once: a failure after that is the tab's own to mend. */
  let shown = false
  const crashes: number[] = []
  const watchers: ResizeObserver[] = []
  let cancelRanges: (() => void) | null = null

  // "Открываю визуальный редактор…" appears after a moment, so a quick opening does not blink
  const loading = doc.createElement('div')
  loading.className = 'loading'
  loading.hidden = true
  loading.innerHTML = '<span class="spin" aria-hidden="true"></span><span></span>'
  loading.lastElementChild!.textContent = t.loading
  root.append(loading)
  const loadingTimer = setTimeout(() => (loading.hidden = false), options.loadingDelay ?? 400)

  // the elements of the layout, set by `open`
  let visualBox!: HTMLElement
  let pageEl!: HTMLElement
  let sourceBox!: HTMLElement
  let bigBox!: HTMLElement
  let crashNotice: ReturnType<typeof setupNotice> | undefined

  const fail = (error: unknown): void => {
    const e = error instanceof Error ? error : new Error(String(error))
    const message = `${e.name}: ${e.message}`
    if (!shown || destroyed || !mirror) {
      api.postMessage({ type: 'error', message, stack: e.stack, fatal: true })
      return
    }
    console.error(e)
    const now = Date.now()
    crashes.push(now)
    while (crashes.length > 0 && now - crashes[0]! > CRASH_WINDOW_MS) crashes.shift()
    if (crashes.length >= CRASH_LIMIT) {
      api.postMessage({ type: 'error', message, stack: e.stack, fatal: true })
      return
    }
    api.postMessage({ type: 'error', message, stack: e.stack })
    recover(mirror)
  }

  /** A failure in a tab that shows its document: what is typed is sent, the editors are made anew, the file is read again. */
  function recover(m: Mirror): void {
    let cursor: { anchor: number; head: number } | null = null
    try {
      cursor = currentSelection()
    } catch {
      // (an editor that failed may not tell)
    }
    try {
      m.flush()
    } catch {
      // (the mirror failed too: the host gets the text it has)
    }
    for (const ed of [editor, source])
      try {
        ed?.destroy()
      } catch {
        // (it failed already)
      }
    editor = undefined
    format?.setEditor(undefined)
    source = undefined
    pageEl.textContent = ''
    if (pagemeta) pageEl.append(pagemeta.button, pagemeta.card)
    sourceBox.textContent = ''
    try {
      ensureEditor(mode)
      if (cursor) placeCursor(cursor.anchor, cursor.head)
      applyRanges()
    } catch (error) {
      console.error(error)
    }
    outline?.refresh()
    crashNotice?.show(t.crash)
    // when everything typed is written, the host sends the whole text, and the mirror shows it
    m.whenSent(() => api.postMessage({ type: 'resync' }))
  }

  function currentSelection(): { anchor: number; head: number } | null {
    if (mode === 'text' && source) {
      const r = source.view.state.selection.main
      return { anchor: r.anchor, head: r.head }
    }
    return editor?.selectionOffsets() ?? null
  }

  function placeCursor(anchor: number, head: number): void {
    const length = mirror?.text.length ?? 0
    const a = Math.min(anchor, length)
    const h = Math.min(head, length)
    if (mode === 'text' && source) source.view.dispatch({ selection: EditorSelection.range(a, h) })
    else editor?.setSelectionAtOffset(a, h)
  }

  // ---------------------------------------------------------------- the editors

  function ensureVisual(): VisualEditor {
    if (editor) return editor
    const m = mirror!
    editor = createVisualEditor(pageEl, {
      session: m,
      messages: reactMessages[locale].reject,
      labels: {
        ...editorLabels(locale),
        pageMetaNote: t.pageMeta.note,
        pageMetaTailNote: t.pageMeta.noteTail,
        pageMetaBodyNote: t.pageMeta.noteBody,
        tocNote: t.pageMeta.toc,
        pageMetaCollapse: t.pageMeta.collapse,
      },
      // the header of the page is not drawn: a badge «i» with a card stands for it
      pageMeta: true,
      onPageMeta: (info) => pagemeta?.update(info),
      // the pictures come from the folder of the file (or `:imagesdir:`), nothing from the network
      images: (target) => resolveImage(target, imageBase, m.doc.attributesAt(m.text.length).get('imagesdir') ?? imagesdirAtStart),
      renderDiagram,
      diagramTheme: () => (dark ? 'dark' : 'light'),
      highlightCode,
      onReject: (text, info) => {
        lastReject = { code: info.code, text }
        notice?.show(text)
      },
      plugins: [documentLook(t.documentLabel), linkGuard],
    })
    format?.setEditor(editor)
    pagemeta?.update(editor.pageMeta())
    return editor
  }

  function ensureSource(): SourceEditor {
    if (source) return source
    const m = mirror!
    source = createSourceEditor(sourceBox, {
      session: m,
      // the hint under the wavy line and the panel of the remarks tell the same as the card «Замечания»
      message: (d) => remarkText(d, locale),
      extensions: [
        EditorState.phrases.of(phrases[locale]),
        lintGutter(),
        darkTheme.of(dark ? oneDark : []),
        nonce ? EditorView.cspNonce.of(nonce) : [],
        EditorView.contentAttributes.of({ 'aria-label': t.sourceLabel, spellcheck: 'false' }),
        // the text scrolls under the capsules: a line that is scrolled into view stands below them
        EditorView.scrollMargins.of(() => ({ top: coverHeight(sourceBox) })),
      ],
    })
    const created = source
    created.view.scrollDOM.addEventListener('scroll', () => mode === 'text' && outline?.scrolled())
    return created
  }

  const ensureEditor = (which: Mode): void => void (which === 'text' ? ensureSource() : ensureVisual())

  /** The remarks of Nota under the text of the visual editor. */
  function applyRanges(): void {
    cancelRanges = null
    if (editor && mirror) {
      editor.setRanges(
        mirror.doc.diagnostics
          .filter((d) => d.severity !== 'info')
          .map((d) => ({ from: d.from, to: d.to, message: remarkText(d, locale), severity: d.severity })),
      )
    }
    // (the number on the capsule is right in both modes)
    remarks?.refresh()
  }

  /** The remarks that count (errors and warnings) of the document now. */
  function remarkList(): readonly RemarkItem[] {
    return mirror ? mirror.doc.diagnostics.filter((d) => counts(d.severity)) : []
  }

  /** The place of a remark is put in the middle of the tab (in «Визуально», which «Замечания» brings the tab back to); gives the element to mark. */
  function revealRemark(remark: RemarkItem, scroll: boolean): HTMLElement | null {
    if (mode === 'text') {
      // a refresh of the card while the source is edited must not take the mode away
      if (!scroll) return null
      setMode('visual')
    }
    if (!editor) return null
    if (scroll) {
      cancelRanges?.()
      applyRanges()
      editor.setSelectionAtOffset(remark.from)
    }
    const message = remarkText(remark, locale)
    const marks = [...pageEl.querySelectorAll<HTMLElement>('.diag')].filter((el) => el.getAttribute('title') === message)
    let target: HTMLElement | null = null
    if (scroll) {
      try {
        const node = editor.view.domAtPos(editor.view.state.selection.head).node
        const near = (node.nodeType === 1 ? (node as Element) : node.parentElement)?.closest<HTMLElement>('.diag')
        if (near && near.getAttribute('title') === message) target = near
      } catch {
        // (no layout)
      }
    }
    target ??= marks[0] ?? null
    if (scroll) {
      try {
        const area = visualBox.getBoundingClientRect()
        const rect = target?.getBoundingClientRect()
        const box = rect && rect.height > 0 ? rect : editor.view.coordsAtPos(editor.view.state.selection.head)
        visualBox.scrollTop += (box.top + box.bottom) / 2 - (area.top + area.height / 2)
      } catch {
        // (no layout)
      }
      outline?.scrolled()
    }
    return target
  }

  function scheduleRanges(): void {
    if (cancelRanges) return
    const win = doc.defaultView!
    if (typeof win.requestAnimationFrame === 'function') {
      const id = win.requestAnimationFrame(applyRanges)
      cancelRanges = () => win.cancelAnimationFrame(id)
    } else {
      const id = win.setTimeout(applyRanges, 16)
      cancelRanges = () => win.clearTimeout(id)
    }
  }

  let notice: ReturnType<typeof setupNotice> | undefined

  // ---------------------------------------------------------------- the mode

  /** Moves the cursor and the top of the view of the mode left to the mode entered, by offsets of the text. */
  function setMode(next: Mode): void {
    const m = mirror
    if (!m || next === mode || destroyed) return
    // what is typed is sent first: the host has the text the other mode shows
    m.flush()
    if (next === 'text') {
      // the card of a remark stays behind: the source is edited now
      remarks?.close()
      const from = editor
      const sel = from?.selectionOffsets() ?? null
      const top = from ? from.topVisibleOffset() : 0
      const to = ensureSource()
      mode = 'text'
      visualBox.hidden = true
      sourceBox.hidden = false
      if (sel) to.view.dispatch({ selection: EditorSelection.range(Math.min(sel.anchor, m.text.length), Math.min(sel.head, m.text.length)) })
      to.view.requestMeasure()
      to.scrollToPos(top)
      keepCursorInSight(to, sel?.head ?? top)
      to.focus()
      replay(sourceBox, 'mode-in')
    } else {
      const from = source
      const r = from?.view.state.selection.main
      const top = from ? sourceTop(from) : 0
      const to = ensureVisual()
      mode = 'visual'
      // the strip of a big file («открыт в режиме «Текст»») goes with the first step to the visual mode, by whichever way
      bigBox.hidden = true
      sourceBox.hidden = true
      visualBox.hidden = false
      if (r) to.setSelectionAtOffset(r.anchor, r.head)
      to.scrollToOffset(top, 'start')
      to.scrollToOffset(r ? r.head : top, 'nearest')
      to.focus()
      replay(visualBox, 'mode-in')
    }
    format?.setDisabled(mode === 'text')
    outline?.setEnabled(mode === 'visual')
    api.postMessage({ type: 'mode', mode })
    outline?.refresh()
    scheduleRanges()
    outline?.scrolled()
  }

  /** Plays the animation of a class again from its start; the class goes when the animation ends. */
  function replay(el: HTMLElement, name: string): void {
    el.classList.remove(name)
    void el.offsetWidth
    el.classList.add(name)
    el.addEventListener('animationend', () => el.classList.remove(name), { once: true })
  }

  /** How far the capsules (and the strip of a big file) reach down from the top of `box`, px: the text under that is covered. */
  function coverHeight(box: HTMLElement): number {
    const bottoms = [...root.querySelectorAll<HTMLElement>('.ed-isles, .big-strip:not([hidden])')].map((el) => el.getBoundingClientRect().bottom)
    return coverFrom(box.getBoundingClientRect().top, bottoms)
  }

  /** The first line of the source that is not under the capsules. */
  function sourceTop(s: SourceEditor, fraction = 0): number {
    const { view } = s
    const cover = coverHeight(sourceBox)
    const down = fraction * Math.max(0, view.scrollDOM.clientHeight - cover)
    return view.lineBlockAtHeight(sourceTopHeight(view.scrollDOM.scrollTop, cover, view.documentPadding.top) + down).from
  }

  /** The line with the cursor is in sight: if it is not, it goes to the middle (once the view has measured itself). */
  function keepCursorInSight(to: SourceEditor, head: number): void {
    const win = doc.defaultView!
    const check = (): void => {
      if (destroyed || to !== source) return
      try {
        const at = to.view.coordsAtPos(Math.min(head, to.view.state.doc.length))
        const area = to.view.scrollDOM.getBoundingClientRect()
        if (at && area.height > 0 && (at.top < area.top + coverHeight(sourceBox) || at.bottom > area.bottom))
          to.view.dispatch({ effects: EditorView.scrollIntoView(head, { y: 'center' }) })
      } catch {
        // (no layout)
      }
    }
    if (typeof win.requestAnimationFrame === 'function') win.requestAnimationFrame(check)
    else win.setTimeout(check, 16)
  }

  /** A click in the tree or on a counter: the cursor goes to `offset`, in the mode the person is in. */
  function goTo(offset: number, place: 'top' | 'sight'): void {
    if (mode === 'text' && source) {
      const at = Math.min(offset, source.view.state.doc.length)
      source.view.dispatch({
        selection: EditorSelection.cursor(at),
        effects: place === 'top' ? [] : EditorView.scrollIntoView(at, { y: 'center' }),
      })
      if (place === 'top') source.scrollToPos(at)
      source.focus()
    } else if (editor) {
      editor.setSelectionAtOffset(offset)
      // a section is scrolled to smoothly, and its heading lights up for a moment (classes only: the style sheet times both)
      if (place === 'top') {
        visualBox.classList.add('smooth')
        // (no scroll when the section is already in place: then there is no `scrollend`, so a timer takes the class off too)
        const unsmooth = (): void => {
          clearTimeout(smoothTimer)
          visualBox.classList.remove('smooth')
        }
        clearTimeout(smoothTimer)
        smoothTimer = setTimeout(unsmooth, 1200)
        visualBox.addEventListener('scrollend', unsmooth, { once: true })
      }
      editor.scrollToOffset(offset, place === 'top' ? 'start' : 'nearest')
      editor.focus()
      if (place === 'top') {
        try {
          const node = editor.view.domAtPos(editor.view.state.selection.head).node
          const heading = (node.nodeType === 1 ? (node as Element) : node.parentElement)?.closest('h1, h2, h3, h4, h5, h6')
          if (heading) replay(heading as HTMLElement, 'sec-flash')
        } catch {
          // (no layout)
        }
      }
    }
  }

  /** Cmd+click on a link: a section of this document is scrolled to, anything else is the host's to open. */
  function openLink(a: HTMLAnchorElement): void {
    const raw = a.getAttribute('href')
    if (!raw || !mirror) return
    // a plate-link keeps `{name}` as written: a defined attribute is put in, an undefined one stays (and the host says it is not found)
    const attrs = raw.includes('{') ? mirror.doc.attributesAt(mirror.text.length) : null
    const href = attrs ? raw.replace(/(?<!\\)\{([\w-]+)\}/g, (m, name: string) => attrs.get(name) ?? m) : raw
    if (href.startsWith('#')) {
      const id = href.slice(1)
      const entry = mirror.doc.outline().find((e) => e.id === id)
      if (entry) {
        notice?.hide()
        goTo(headingOffset(mirror.text, entry), 'top')
      }
      return
    }
    api.postMessage({ type: 'openLink', href })
  }

  // ---------------------------------------------------------------- the layout and the document

  function open(text: string, version: number, e2e: boolean, first: Mode, big: { bytes: number } | undefined, fileLocale: Locale): void {
    locale = fileLocale
    doc.documentElement.lang = locale // the language of the CSS texts (`:lang(ru)`)
    if (e2e) hookE2e()
    t = strings[locale]
    clearTimeout(loadingTimer)
    loading.remove()
    root.innerHTML = `<div class="ed-body"><div class="ed-main">
<div class="ed-isles"><div class="isle-wrap isle-left"></div><div class="isle-wrap isle-mid"><div class="tools-root"></div></div><div class="isle-wrap isle-right"></div></div>
<div class="scroll ed-visual"><article class="page"></article></div>
<div class="ed-source" hidden></div>
<div class="big-strip" role="status" hidden>${ICON_WARN}<div class="big-text"></div><button type="button" class="btn big-go"></button></div>
<div class="notice" role="status" hidden>${ICON_WARN}<div class="notice-text"></div><button type="button" class="notice-x" title="${t.hide}" aria-label="${t.hide}">${ICON_X}</button></div>
<div class="notice crash" role="alert" hidden>${ICON_WARN}<div class="notice-text"></div><button type="button" class="notice-x" title="${t.hide}" aria-label="${t.hide}">${ICON_X}</button></div>
</div></div>`
    const main = root.querySelector<HTMLElement>('.ed-main')!
    visualBox = root.querySelector<HTMLElement>('.ed-visual')!
    pageEl = root.querySelector<HTMLElement>('.page')!
    sourceBox = root.querySelector<HTMLElement>('.ed-source')!
    bigBox = root.querySelector<HTMLElement>('.big-strip')!
    bigBox.querySelector('.big-go')!.textContent = t.bigGo
    // the document lies under the row of capsules and under the plate of a big file: its top room follows their height
    if (typeof ResizeObserver === 'function') {
      const isles = root.querySelector<HTMLElement>('.ed-isles')!
      const measure = (): void => {
        const strip = bigBox.hidden ? 0 : bigBox.offsetHeight + 8
        main.style.setProperty('--isles-h', `${Math.max(ISLES_MIN_HEIGHT, isles.offsetHeight)}px`)
        main.style.setProperty('--strip-h', `${strip}px`)
      }
      const watch = new ResizeObserver(measure)
      watch.observe(isles)
      watch.observe(bigBox)
      watchers.push(watch)
      measure()
    }
    const [box, crashBox] = [...root.querySelectorAll<HTMLElement>('.notice')]
    const q = <T extends HTMLElement>(parent: HTMLElement, selector: string): T => parent.querySelector<T>(selector)!
    // the notice asks for the editor when the cross is pressed, long after both exist
    notice = setupNotice({
      box: box!,
      text: q(box!, '.notice-text'),
      close: q(box!, '.notice-x'),
      host: pageEl,
      editor: () => editor,
    })
    crashNotice = setupNotice({
      box: crashBox!,
      text: q(crashBox!, '.notice-text'),
      close: q(crashBox!, '.notice-x'),
      host: root,
      editor: () => editor,
    })

    const m = new Mirror({
      text,
      version,
      send: (message) => api.postMessage(message),
      groupDelay: options.groupDelay,
      composing: () => (editor?.view.composing ?? false) || (editor?.markerPending ?? false),
      onStale: () => notice?.show(t.stale),
    })
    mirror = m

    /** Runs a command of the editor and tells whether it was refused. */
    const attempt = (command: () => boolean): { ok: boolean; reject: { code: string; text: string } | null } => {
      lastReject = null
      const ok = command()
      return { ok, reject: ok ? null : lastReject }
    }
    /** A command that is a step of the history of its own: what was typed is sent before it, and it is sent at once. */
    const step: typeof attempt = (command) => {
      m.flush()
      const result = attempt(command)
      m.flush()
      return result
    }

    outline = createOutline(doc, {
      doc: () => m.doc,
      view: () => {
        // the current section is the last one whose title is above the line at the top third of what is seen
        if (mode === 'text' && source) return { top: sourceTop(source, 1 / 3), atBottom: atEnd(source.view.scrollDOM) }
        return { top: editor ? editor.topVisibleOffset(1 / 3) : 0, atBottom: atEnd(visualBox) }
      },
      goToHeading: (offset) => goTo(offset, 'top'),
      goToRemark: (offset) => remarks?.openAt(offset),
      canMove: () => mode === 'visual' && editor !== undefined,
      moveSection: (at, to) => step(() => editor?.commands.moveBlock(at, to) ?? false).ok,
      notify: (text) => notice?.show(text),
      beforeOpen: () => {
        remarks?.close()
        pagemeta?.close()
        format?.closeWindows()
      },
    }, locale)
    const [leftIsle, midIsle, rightIsle] = [...main.querySelectorAll<HTMLElement>('.isle-wrap')] as [HTMLElement, HTMLElement, HTMLElement]
    leftIsle.append(outline.isle, outline.card)
    main.append(outline.strokes, outline.side)
    outline.setView(outlineViewNow)
    onOutlineView = (view) => outline?.setView(view)
    remarks = createRemarks(
      doc,
      {
        list: remarkList,
        reveal: revealRemark,
        beforeOpen: () => {
          outline?.close()
          pagemeta?.close()
          format?.closeWindows()
        },
      },
      locale,
    )
    // the round capsule with the gear stands right of «Замечания» in every mode; the host opens the Settings of VS Code with the settings of Nota only
    const settingsIsle = doc.createElement('button')
    settingsIsle.type = 'button'
    settingsIsle.className = 'isle isle-settings'
    settingsIsle.title = t.isles.settings
    settingsIsle.setAttribute('aria-label', t.isles.settings)
    settingsIsle.innerHTML = GEAR_ICON
    settingsIsle.addEventListener('click', () => api.postMessage({ type: 'openSettings' }))
    rightIsle.append(remarks.isle, settingsIsle, remarks.card)
    pagemeta = createPageMeta(
      doc,
      {
        openLink: (href) => api.postMessage({ type: 'openLink', href }),
        edit: () => editor?.editPageMeta('version'),
        beforeOpen: () => {
          outline?.close()
          remarks?.close()
          format?.closeWindows()
        },
      },
      locale,
    )
    pageEl.append(pagemeta.button, pagemeta.card)
    if (editor) pagemeta.update(editor.pageMeta())
    // the wavy line in the text opens the card of its remark (before the guard of links, which stops the click on a link)
    root.addEventListener(
      'click',
      (event) => {
        const mark = event.target instanceof Element && mode === 'visual' ? event.target.closest('.diag') : null
        if (!mark || !pageEl.contains(mark) || !editor) return
        const list = remarkList()
        const title = mark.getAttribute('title')
        const head = editor.selectionOffsets()?.head ?? -1
        let at = list.findIndex((r) => remarkText(r, locale) === title && r.from <= head && head <= r.to)
        if (at < 0) at = list.findIndex((r) => remarkText(r, locale) === title)
        // the cursor the author put into the text stays where it is
        if (at >= 0) remarks?.open(at, false)
      },
      true,
    )
    // the sections and the marks follow every change of the text, whoever made it
    m.subscribe(() => {
      outline?.refresh()
      scheduleRanges()
    })
    visualBox.addEventListener('scroll', () => mode === 'visual' && outline?.scrolled())

    format = mountFormat({
      locale,
      blocks: blocksInCapsule,
      toolbar: q(midIsle, '.tools-root'),
      cards: midIsle,
      layer: main,
      scroller: visualBox,
      beforeCommand: () => notice?.hide(),
      attempt,
      attemptStep: step,
      moveRefused: () => notice?.show(t.tree.cannotMove),
      sections: () =>
        m.doc
          .outline()
          .filter((e) => e.id !== null)
          .map((e) => ({ id: e.id!, title: e.title, level: Math.max(0, e.level - 1) })),
      imagePath: (picked) => pathForDocument(picked, m.doc.attributesAt(m.text.length).get('imagesdir') ?? imagesdirAtStart),
      listFiles: (query, kind) =>
        new Promise<FileList>((resolve) => {
          const id = nextFiles++
          waitingFiles.set(id, resolve)
          api.postMessage(kind === 'image' ? { type: 'listFiles', id, query, kind } : { type: 'listFiles', id, query })
        }),
    })
    format.setEditor(editor)
    format.setDisabled(first === 'text')
    outline.setEnabled(first === 'visual')

    mode = first
    if (first === 'text') {
      visualBox.hidden = true
      sourceBox.hidden = false
      ensureSource()
    } else ensureVisual()
    if (big) {
      q(bigBox, '.big-text').textContent = t.big(big.bytes)
      bigBox.hidden = false
      main.style.setProperty('--strip-h', `${bigBox.offsetHeight + 8}px`)
      q(bigBox, '.big-go').addEventListener('click', () => {
        bigBox.hidden = true
        setMode('visual')
      })
    }
    applyRanges()
    // (the tree takes the mode: the rows of «Текст» are not dragged)
    outline.refresh()

    // ---- what the keys do
    const pastePlain = (): void => {
      const viaHost = (): void => api.postMessage({ type: 'readClipboard' })
      const clip = win.navigator?.clipboard
      if (!clip || typeof clip.readText !== 'function') return viaHost()
      clip.readText().then((text) => editor?.commands.pastePlain(text), viaHost)
    }
    let lastMark: { name: string; time: number } | null = null
    // the key of a style that the page took: VS Code sends the command as well, and the second one would undo the first
    let lastStyle: { name: string; time: number } | null = null
    let lastHistoryKey = 0
    root.addEventListener(
      'keydown',
      (event) => {
        const mod = event.metaKey || event.ctrlKey
        if (!mod) return
        // Cmd+Shift+V: plain text (the browser gives the tab a paste with the marks, or none at all, for this chord)
        if (event.shiftKey && !event.altKey && event.code === 'KeyV' && mode === 'visual' && editor) {
          event.preventDefault()
          event.stopPropagation()
          pastePlain()
          return
        }
        // ⌘⌥0 / ⌘⌥2 / ⌘⌥3 on a Mac (VS Code has its own commands for them: the extension's go first, with a `when`)
        const style = event.metaKey && event.altKey && !event.shiftKey && !event.ctrlKey ? STYLE_KEYS[event.code] : undefined
        if (style) {
          if (mode === 'text') {
            // the styles are the keys of the visual editor: in «Текст» they change nothing
            event.preventDefault()
            event.stopPropagation()
            return
          }
          // (the key reaches the page only when the focus is in its text; from the panel of the sections it is the command that works)
          if (pageEl.contains(event.target as Node | null) && (event.target as Element | null)?.closest?.('.ProseMirror')) lastStyle = { name: style.name, time: Date.now() }
          m.flush()
          return
        }
        // a command or a step of the history starts from what is typed
        m.flush()
        const name = (event.shiftKey ? SHIFT_MARK_KEYS : MARK_KEYS)[event.code]
        if (name && mode === 'text') {
          // the marks are the keys of the visual editor: in «Текст» they change nothing
          event.preventDefault()
          event.stopPropagation()
          return
        }
        if (name) lastMark = { name, time: Date.now() }
        if (event.code === 'KeyZ' || event.code === 'KeyY') lastHistoryKey = Date.now()
      },
      true,
    )
    // VS Code also sends «Правка → Отменить» to the page as a native undo, after the key was handled here
    root.addEventListener(
      'beforeinput',
      (event) => {
        const type = (event as InputEvent).inputType
        if ((type === 'historyUndo' || type === 'historyRedo') && Date.now() - lastHistoryKey < 250) {
          event.preventDefault()
          event.stopImmediatePropagation()
        }
      },
      true,
    )
    guardLinks(root, mac, openLink, () => mode === 'visual')
    // the hint on a link
    root.addEventListener('mouseover', (event) => {
      const a = event.target instanceof Element ? event.target.closest('a') : null
      if (a && mode === 'visual') a.title = t.linkTip(mac)
    })
    root.addEventListener('focusout', () => m.flush())
    doc.addEventListener('visibilitychange', () => doc.visibilityState === 'hidden' && m.flush())

    commandHandler = (name, text, offset) => {
      if (name === 'toggle-mode') return setMode(mode === 'text' ? 'visual' : 'text')
      if (name === 'reveal') return offset === undefined ? undefined : goTo(offset, 'sight')
      if (name === 'e2e-state') {
        const sel = currentSelection() ?? { anchor: 0, head: 0 }
        // (the diagrams drawn: the suite checks that the real renderer made pictures)
        const diagrams = pageEl.querySelectorAll('.nota-diagram.drawn svg').length
        const isles = root.querySelectorAll('.ed-isles .isle:not(.isle-strokes):not(.isle-settings)').length
        // (the row of capsules has no background, and the first line stands below it)
        const rowEl = root.querySelector<HTMLElement>('.ed-isles')
        const firstEl = pageEl.querySelector<HTMLElement>('.doc > :first-child:not(.nota-anchor), .doc > .nota-anchor:first-child + *')
        // (the edge of the row, left of the first capsule, is a gap: the mouse goes through it to the document)
        const rowBox = rowEl?.getBoundingClientRect()
        const hit = rowBox ? doc.elementFromPoint(rowBox.left + 2, rowBox.top + rowBox.height / 2) : null
        const row = {
          background: rowEl ? getComputedStyle(rowEl).backgroundColor : '',
          firstGap: rowBox && firstEl ? firstEl.getBoundingClientRect().top - rowBox.bottom : 0,
          gapOpen: rowEl !== null && hit !== null && hit !== rowEl && !rowEl.contains(hit),
        }
        // (the row «Таблица» of the capsule, and the panels that float over the text: a selection has none)
        const tableRow = root.querySelector('.isle-tools .tl-row') !== null
        const floating = root.querySelectorAll('.bubble, .fl.tablebar').length
        // (the widths the suite measures: the tab, the page, a paragraph, the first table, the lines of the first code)
        const rectW = (el: Element | null | undefined): number => (el ? el.getBoundingClientRect().width : 0)
        const tbl = pageEl.querySelector<HTMLElement>('.tbl-scroll')
        const src = pageEl.querySelector<HTMLElement>('.nota-code .code-src')
        const srcStyle = src ? getComputedStyle(src) : undefined
        const lineH = srcStyle ? parseFloat(srcStyle.lineHeight) || 0 : 0
        const srcPad = srcStyle ? (parseFloat(srcStyle.paddingTop) || 0) + (parseFloat(srcStyle.paddingBottom) || 0) : 0
        const tabEl = root.querySelector('.ed-main')
        const scrollEl = root.querySelector<HTMLElement>('.ed-main > .scroll')
        const padding = scrollEl ? getComputedStyle(scrollEl) : undefined
        const tabRect = tabEl?.getBoundingClientRect()
        const pageRect = pageEl.getBoundingClientRect()
        const img = pageEl.querySelector<HTMLImageElement>('.nota-image img')
        const pic = pageEl.querySelector('.nota-diagram.drawn svg')
        const width = {
          tab: rectW(tabEl),
          page: rectW(pageEl),
          paragraph: rectW(pageEl.querySelector('.doc > p')),
          table: rectW(tbl),
          tableScrolls: tbl ? tbl.scrollWidth > tbl.clientWidth : false,
          codeRows: src && lineH ? Math.round((src.scrollHeight - srcPad) / lineH) : 0,
          scrollClient: scrollEl?.clientWidth ?? 0,
          scrollOverflows: scrollEl ? scrollEl.scrollWidth > scrollEl.clientWidth : false,
          padLeft: padding ? parseFloat(padding.paddingLeft) || 0 : 0,
          padRight: padding ? parseFloat(padding.paddingRight) || 0 : 0,
          marginLeft: tabRect ? pageRect.left - tabRect.left : 0,
          marginRight: tabRect ? tabRect.right - pageRect.right : 0,
          image: rectW(img),
          imageNatural: img?.naturalWidth ?? 0,
          diagram: rectW(pic),
          // (the natural width of the picture: mermaid puts it into `max-width` of the svg, else the viewBox says it)
          diagramNatural: pic ? parseFloat((pic as SVGSVGElement).style.maxWidth) || (pic as SVGSVGElement).viewBox.baseVal.width || 0 : 0,
          heading: rectW(pageEl.querySelector('.doc h2')),
          list: rectW(pageEl.querySelector('.doc .li')),
          note: rectW(pageEl.querySelector('.doc .adm')),
          scrollTop: scrollEl?.scrollTop ?? 0,
        }
        // (the first table: the right edges of the cells of its head, the frame, the label of a drag, the errors of the page)
        const frameEl = pageEl.querySelector<HTMLElement>('.tbl-scroll')
        const tblEl = frameEl?.parentElement
        const tbl110 = frameEl
          ? {
              heads: [...frameEl.querySelectorAll('tr:first-child > th, tr:first-child > td')].map((c) => c.getBoundingClientRect().right),
              widths: [...frameEl.querySelectorAll('tr:first-child > th, tr:first-child > td')].map((c) => c.getBoundingClientRect().width),
              table: frameEl.querySelector('table')?.getBoundingClientRect().width ?? 0,
              scrollWidth: frameEl.scrollWidth,
              clientWidth: frameEl.clientWidth,
              tag: document.querySelector('.nota-grips .wtag')?.textContent ?? '',
              border1: (() => {
                const r = document.querySelector('.nota-grips .bd')?.getBoundingClientRect()
                return r ? r.left + r.width / 2 : 0
              })(),
              held: heldBorder?.x ?? 0,
              limit: document.querySelector('.nota-grips .wtag')?.classList.contains('limit') ?? false,

              drag: tblEl?.classList.contains('tbl-drag') ?? false,
              classes: tblEl?.className ?? '',
              errors: pageErrors,
            }
          : undefined
        return api.postMessage({ type: 'e2e-state', mode, ...sel, tbl: tbl110, diagrams, isles, row, remarks: remarkList().length, pagemeta: { badge: pagemeta ? !pagemeta.button.hidden : false, islands: pageEl.querySelectorAll('.nota-island').length, tocs: pageEl.querySelectorAll('.nota-toc').length }, tableRow, floating, width, outline: outlineState() })
      }
      if (e2e && name === 'e2e-pastehtml') {
        // Cmd+V of a page: the same event the browser fires, with both formats on the clipboard
        const [html, plain] = JSON.parse(text ?? '[]') as [string, string]
        const data = new DataTransfer()
        data.setData('text/html', html)
        data.setData('text/plain', plain)
        const target = pageEl.querySelector('.ProseMirror')
        return void target?.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
      }
      if (e2e && name === 'e2e-openlink') {
        // what Cmd+click on the link with this target does
        const a = [...pageEl.querySelectorAll('a')].find((el) => el.getAttribute('href') === text)
        return a ? openLink(a) : undefined
      }
      if (e2e && name.startsWith('e2e-')) return e2eCommand({ visual: editor, source, mirror: m, ...(outline ? { outline } : {}) }, name, text)
      // the key was already handled in the page: VS Code sends it as a command as well
      if (mode === 'text') return
      const styled = STYLE_COMMANDS.find((s) => s.name === name)
      if (styled) {
        if (lastStyle && lastStyle.name === name && Date.now() - lastStyle.time < 300) return
        m.flush()
        return void ensureVisual().commands.toggleBlockType(styled.type, styled.level)
      }
      if (lastMark && lastMark.name === name && Date.now() - lastMark.time < 300) return
      m.flush()
      ensureVisual().commands.toggleMark(name as 'strong')
    }
    shown = true
  }

  let commandHandler: (name: string, text?: string, offset?: number) => void = () => undefined

  const onMessage = (event: MessageEvent): void => {
    const message = event.data as ToTab | undefined
    if (!message || typeof message !== 'object' || destroyed) return
    try {
      switch (message.type) {
        case 'init':
          imageBase = message.imageBase ?? ''
          imagesdirAtStart = message.imagesdir ?? ''
          setPageWidth(message.pageWidth)
          setOutlineView(message.outlineView)
          setShowAnchors(message.showAnchors)
          setBlocksInCapsule(message.blocksInCapsule)
          if (!mirror) open(message.text, message.version, message.e2e === true, message.mode ?? 'visual', message.big, message.locale ?? locale)
          return
        case 'pageWidth':
          setPageWidth(message.percent)
          return
        case 'outlineView':
          setOutlineView(message.view)
          return
        case 'showAnchors':
          setShowAnchors(message.on)
          return
        case 'blocksInCapsule':
          setBlocksInCapsule(message.set)
          return
        case 'ack':
          mirror?.ack(message.id, message.version)
          return
        case 'update':
          mirror?.update(message.version, message.changes, message.reason)
          return
        case 'reset':
          mirror?.reset(message.text, message.version, message.stale)
          return
        case 'flush': {
          const id = message.id
          if (mirror) mirror.whenSent(() => api.postMessage({ type: 'flush', id }))
          else api.postMessage({ type: 'flush', id })
          return
        }
        case 'files':
          waitingFiles.get(message.id)?.({ items: message.items, more: message.more })
          waitingFiles.delete(message.id)
          return
        case 'notice': {
          const box = root.querySelector<HTMLElement>('.notice:not(.crash)')
          const shown = box !== null && !box.hidden
          notice?.show(message.text)
          // heard again while it is on the screen: it blinks
          if (shown && box) replay(box, 'again')
          return
        }
        case 'noticeHide':
          notice?.hide()
          return
        case 'clipboard':
          if (mode === 'visual') editor?.commands.pastePlain(message.text)
          return
        case 'command':
          commandHandler(message.name, message.text, message.offset)
          return
      }
    } catch (error) {
      fail(error)
    }
  }
  const onError = (event: ErrorEvent): void => fail(event.error ?? event.message)
  const win = doc.defaultView!
  win.addEventListener('message', onMessage)
  win.addEventListener('error', onError)

  api.postMessage({ type: 'ready' })

  return {
    get mirror() {
      return mirror
    },
    get editor() {
      return editor
    },
    get source() {
      return source
    },
    get mode() {
      return mode
    },
    get locale() {
      return locale
    },
    get outline() {
      return outline
    },
    get remarks() {
      return remarks
    },
    get pagemeta() {
      return pagemeta
    },
    toggleMode() {
      setMode(mode === 'text' ? 'visual' : 'text')
    },
    flush() {
      cancelRanges?.()
      applyRanges()
      outline?.flush()
    },
    destroy() {
      destroyed = true
      for (const w of watchers) w.disconnect()
      clearTimeout(loadingTimer)
      cancelRanges?.()
      win.removeEventListener('message', onMessage)
      win.removeEventListener('error', onError)
      stopTheme()
      format?.destroy()
      outline?.destroy()
      remarks?.destroy()
      pagemeta?.destroy()
      editor?.destroy()
      source?.destroy()
      mirror?.destroy()
    },
  }
}

declare const acquireVsCodeApi: (() => HostApi) | undefined

// in the tab of VS Code; the tests call `startPage` themselves
if (typeof acquireVsCodeApi === 'function' && typeof document !== 'undefined') {
  const root = document.getElementById('app')
  if (root) startPage(acquireVsCodeApi(), root)
}
