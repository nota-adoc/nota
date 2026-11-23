/**
 * The source editor: a CodeMirror editor for the text of a session. It has no history of its own. Its edits go
 * to the session, the replacements of others come from the session, and Mod-Z, Mod-Shift-Z and Mod-Y ask the
 * session, so any number of editors on one session show the same text and undo the same steps.
 */
import { defaultKeymap } from '@codemirror/commands'
import { Annotation, EditorSelection, EditorState, type Extension, Prec, type Transaction } from '@codemirror/state'
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightSpecialChars,
  keymap,
  lineNumbers,
} from '@codemirror/view'
import { type NotaSession, type TextChange, createSession } from '@nota-adoc/core'
import { type AsciidocConfig, asciidoc } from './asciidoc.js'

/** A change of the text of the editor, as `onChange` gets it. */
export interface SourceChange {
  /** The replacements, in coordinates of the text before the change. */
  readonly changes: readonly TextChange[]
  /** Who made it: the user in this editor, another holder of the session (`session`), or an undo or redo. */
  readonly source: 'user' | 'session' | 'undo' | 'redo'
}

export interface SourceEditorOptions extends AsciidocConfig {
  /** The session to edit. Without one, the editor makes its own, on `text`. */
  session?: NotaSession
  /** The text of a session the editor makes itself. */
  text?: string
  /** Called once for every transaction that changes the text (never for the cursor, folds or scrolling). */
  onChange?: (change: SourceChange) => void
  /** Line numbers on the margin. Default true. */
  lineNumbers?: boolean
  /** More CodeMirror extensions: a theme, a highlight style, keymaps. */
  extensions?: Extension | readonly Extension[]
}

/** The source editor as the host sees it. */
export interface SourceEditor {
  /** The CodeMirror view, for hosts that need more than this interface. */
  readonly view: EditorView
  /** The session the editor works on. */
  readonly session: NotaSession
  /** The current text. */
  getText(): string
  /** Makes the line with `pos` visible, at the top of the editor. */
  scrollToPos(pos: number): void
  /** The position of the start of the first visible line. */
  topVisiblePos(): number
  focus(): void
  /** Removes the editor from the page and from the session; later changes of the session do nothing here. */
  destroy(): void
}

/** Marks the transactions that carry the changes of the session into the view; the value is the event kind. */
const fromSession = Annotation.define<'apply' | 'undo' | 'redo'>()

/** CR is a character of its line here, not a line break: it is not shown as a control character. */
// eslint-disable-next-line no-control-regex
const specialChars = /[\u0000-\u0008\u000a-\u000c\u000e-\u001f\u007f-\u009f\u00ad\u061c\u200b\u200e\u200f\u2028\u2029\u202d\u202e\u2066\u2067\u2069\ufeff\ufff9-\ufffc]/g

const editorTheme = EditorView.theme({
  '&': { height: '100%' },
  '.cm-scroller': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', lineHeight: '1.5' },
  '.cm-content': { padding: '8px 0' },
  '.cm-gutters': { backgroundColor: 'transparent', border: 'none', color: '#8a8f98' },
})

function changesOf(tr: Transaction): TextChange[] {
  const out: TextChange[] = []
  tr.changes.iterChanges((from, to, _fromB, _toB, inserted) => out.push({ from, to, insert: inserted.toString() }))
  return out
}

/** Where the cursor goes after a step: the end of the last replacement, in coordinates of the new text. */
function cursorAfter(changes: readonly TextChange[]): number {
  let delta = 0
  let end = 0
  for (const c of changes) {
    const insert = c.insert ?? ''
    end = c.from + delta + insert.length
    delta += insert.length - ((c.to ?? c.from) - c.from)
  }
  return end
}

/** Creates a source editor in `parent`. */
export function createSourceEditor(parent: HTMLElement, options: SourceEditorOptions = {}): SourceEditor {
  const session = options.session ?? createSession(options.text ?? '', { parse: options.parse })
  const parseOptions = options.parse ?? session.parseOptions
  const editor = {} as { view: EditorView }
  const self: SourceEditor = {
    get view() {
      return editor.view
    },
    session,
    getText: () => editor.view.state.doc.toString(),
    scrollToPos(pos) {
      const at = Math.max(0, Math.min(pos, editor.view.state.doc.length))
      editor.view.dispatch({ effects: EditorView.scrollIntoView(at, { y: 'start' }) })
    },
    topVisiblePos() {
      const { view } = editor
      // heights count from the top of the document, which starts below the padding of the content
      return view.lineBlockAtHeight(Math.max(0, view.scrollDOM.scrollTop - view.documentPadding.top)).from
    },
    focus: () => editor.view.focus(),
    destroy() {
      unsubscribe()
      editor.view.destroy()
    },
  }

  const historyKeys = keymap.of([
    { key: 'Mod-z', run: () => (session.undo({ origin: self }), true), preventDefault: true },
    { key: 'Mod-Shift-z', run: () => (session.redo({ origin: self }), true), preventDefault: true },
    { key: 'Mod-y', run: () => (session.redo({ origin: self }), true), preventDefault: true },
  ])

  // Edit > Undo of the browser menu and the like: the session does it, not contenteditable
  const historyInput = EditorView.domEventHandlers({
    beforeinput(event) {
      if (event.inputType === 'historyUndo') session.undo({ origin: self })
      else if (event.inputType === 'historyRedo') session.redo({ origin: self })
      else return false
      return true
    },
  })

  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: session.text,
      extensions: [
        Prec.high(historyKeys),
        Prec.high(historyInput),
        keymap.of(defaultKeymap),
        asciidoc({ ...options, parse: parseOptions }),
        options.lineNumbers === false ? [] : lineNumbers(),
        highlightSpecialChars({ specialChars }),
        highlightActiveLine(),
        drawSelection(),
        EditorView.lineWrapping,
        editorTheme,
        options.extensions ?? [],
      ],
    }),
    dispatchTransactions(trs, v) {
      // what the user did goes to the session first, which tells the other editors
      for (const tr of trs)
        if (tr.docChanged && !tr.annotation(fromSession)) session.apply(changesOf(tr), { origin: self })
      v.update(trs)
      if (options.onChange)
        for (const tr of trs)
          if (tr.docChanged) {
            const kind = tr.annotation(fromSession)
            options.onChange({
              changes: changesOf(tr),
              source: kind === undefined ? 'user' : kind === 'apply' ? 'session' : kind,
            })
          }
    },
  })
  editor.view = view

  const unsubscribe = session.subscribe((event) => {
    const mine = event.origin === self
    // the editor that made the change has it already
    if (event.kind === 'apply' && mine) return
    view.dispatch({
      changes: event.changes as TextChange[],
      annotations: fromSession.of(event.kind),
      // the editor that asked for the undo puts the cursor where the step was
      selection:
        mine && event.kind !== 'apply' ? EditorSelection.cursor(cursorAfter(event.changes)) : undefined,
      scrollIntoView: mine && event.kind !== 'apply',
      userEvent: event.kind === 'apply' ? 'session' : event.kind,
    })
  })
  return self
}
