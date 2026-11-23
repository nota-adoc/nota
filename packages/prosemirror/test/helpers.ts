import { type Operation, type NotaSession, createSession } from '@nota-adoc/core'
import { type RejectInfo, type VisualEditor, createVisualEditor } from '@nota-adoc/prosemirror'
import { TextSelection } from 'prosemirror-state'

export interface Setup {
  editor: VisualEditor
  session: NotaSession
  rejects: RejectInfo[]
  /** The operations that could not be written so that they read exactly as typed (`onInexact`). */
  inexact: Operation[]
  el: HTMLElement
}

const opened: VisualEditor[] = []

/** An editor on a session with `text`, in the document of jsdom. */
export function open(text: string, sessionOptions?: Parameters<typeof createSession>[1]): Setup {
  const session = createSession(text, sessionOptions)
  const el = document.createElement('div')
  document.body.append(el)
  const rejects: RejectInfo[] = []
  const inexact: Operation[] = []
  const editor = createVisualEditor(el, {
    session,
    onReject: (_message, info) => rejects.push(info),
    onInexact: (op) => inexact.push(op),
  })
  opened.push(editor)
  return { editor, session, rejects, inexact, el }
}

export function closeAll(): void {
  for (const e of opened.splice(0)) e.destroy()
  document.body.textContent = ''
}

/** The position of cell `k` of the top-level node `i`. */
export function posIn(editor: VisualEditor, i: number, k: number): number {
  let pos = 0
  editor.view.state.doc.forEach((node, offset, index) => {
    if (index === i) pos = offset + 1 + k
  })
  return pos
}

export function select(editor: VisualEditor, from: number, to = from): void {
  const { state } = editor.view
  editor.view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, from, to)))
}

/** A short form of the ProseMirror document: blocks with their text and marks, `|` between blocks. */
export function shape(editor: VisualEditor): string {
  const out: string[] = []
  editor.view.state.doc.forEach((node) => {
    if (node.type.name === 'island') {
      out.push('[chip]')
      return
    }
    if (node.type.name === 'table') {
      out.push('[table]')
      return
    }
    if (node.type.name === 'code_block') {
      out.push('[code]')
      return
    }
    if (node.type.name === 'image') {
      out.push('[img]')
      return
    }
    let s = ''
    node.forEach((c) => {
      if (c.isText) {
        const marks = c.marks.map((m) => m.type.name).join('+')
        s += marks ? `<${marks}>${c.text}</>` : c.text!
      } else s += c.type.name === 'hard_break' ? '↵' : '⟦chip⟧'
    })
    out.push((node.type.name === 'heading' ? `h${node.attrs.level}:` : '') + s)
  })
  return out.join('|')
}

const KEYCODES: Record<string, number> = {
  Backspace: 8,
  Tab: 9,
  Enter: 13,
  ArrowLeft: 37,
  ArrowRight: 39,
  Delete: 46,
  z: 90,
  y: 89,
  b: 66,
  i: 73,
  e: 69,
  x: 88,
  h: 72,
  '0': 48,
  '2': 50,
  '3': 51,
  '4': 52,
  '5': 53,
  '6': 54,
}

/** Presses a key in the editor: `key('Enter')`, `key('b', { mod: true })`, `key('2', { mod: true, alt: true })`. */
export function key(
  editor: VisualEditor,
  name: string,
  mods: { mod?: boolean; shift?: boolean; alt?: boolean } = {},
): boolean {
  const ev = new KeyboardEvent('keydown', {
    key: name,
    keyCode: KEYCODES[name] ?? name.charCodeAt(0),
    ctrlKey: !!mods.mod,
    shiftKey: !!mods.shift,
    altKey: !!mods.alt,
    bubbles: true,
    cancelable: true,
  })
  editor.view.dom.dispatchEvent(ev)
  return ev.defaultPrevented
}

/** Types text at the selection as ProseMirror does for a key: `handleTextInput`, then a transaction. */
export function type(editor: VisualEditor, text: string): void {
  const { view } = editor
  for (const ch of text) {
    const { from, to } = view.state.selection
    if (
      !view.someProp('handleTextInput', (f) =>
        f(view, from, to, ch, () => view.state.tr.insertText(ch, from, to)),
      )
    )
      view.dispatch(view.state.tr.insertText(ch, from, to))
  }
}

/** The text of the paragraph or heading number `i` of the screen, marks not shown. */
export function textOf(editor: VisualEditor, i: number): string {
  return editor.view.state.doc.child(i).textContent
}

export function composition(editor: VisualEditor, type: 'compositionstart' | 'compositionend'): void {
  editor.view.dom.dispatchEvent(new CompositionEvent(type, { bubbles: true, data: '' }))
}

/** Puts the cursor at the end (or the start) of the text of the first cell block whose text is `text`; returns its position. */
export function inCell(editor: VisualEditor, text: string, at: 'end' | 'start' = 'end', nth = 0): number {
  let found = -1
  let seen = 0
  editor.view.state.doc.descendants((node, pos) => {
    if (found >= 0) return false
    if (node.type.name === 'cell_text' && node.textContent === text && seen++ === nth) {
      found = pos + 1 + (at === 'end' ? node.content.size : 0)
      return false
    }
    return true
  })
  if (found < 0) throw new Error(`no cell with the text ${JSON.stringify(text)}`)
  select(editor, found)
  return found
}

/** The texts of the cells of the tables of the screen, row after row, `|` between cells and `/` between rows. */
export function grids(editor: VisualEditor): string[] {
  const out: string[] = []
  editor.view.state.doc.forEach((node) => {
    if (node.type.name !== 'table') return
    const rows: string[] = []
    node.forEach((row) => {
      const cells: string[] = []
      row.forEach((cell) => cells.push(cell.textContent))
      rows.push(cells.join('|'))
    })
    out.push(rows.join('/'))
  })
  return out
}
