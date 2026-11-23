import { type NotaSession, createSession } from '@nota-adoc/core'
import { type RejectInfo, type VisualEditor, createVisualEditor } from '@nota-adoc/prosemirror'
import { cleanup } from '@testing-library/react'
import { TextSelection } from 'prosemirror-state'
import { afterEach } from 'vitest'

export interface Setup {
  editor: VisualEditor
  session: NotaSession
  rejects: RejectInfo[]
  el: HTMLElement
}

const opened: VisualEditor[] = []

/** An editor on a session with `text`, in the document of jsdom. */
export function open(text: string): Setup {
  const session = createSession(text)
  const el = document.createElement('div')
  document.body.append(el)
  const rejects: RejectInfo[] = []
  const editor = createVisualEditor(el, { session, onReject: (_m, info) => rejects.push(info) })
  opened.push(editor)
  return { editor, session, rejects, el }
}

/** Selects the cells `a`–`b` of the block `i`. */
export function select(editor: VisualEditor, i: number, a: number, b = a): void {
  const { state } = editor.view
  let start = 0
  state.doc.forEach((_node, offset, index) => {
    if (index === i) start = offset + 1
  })
  editor.view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, start + a, start + b)))
}

export const CYRILLIC = /[А-Яа-яЁё]/

/** Closes everything the test opened. */
export function setupCleanup(): void {
  afterEach(() => {
    cleanup()
    for (const e of opened.splice(0)) e.destroy()
    document.body.textContent = ''
  })
}
