// The toolbar of «Визуально»: what its buttons do, and what they show of the state under the cursor. It belongs to the page,
// not to the package: the package gives the commands, the page gives them buttons.
import type { NotaSession } from '@nota-adoc/codemirror'
import { type MarkName, type VisualEditor, schema } from '@nota-adoc/prosemirror'
import type { MarkType } from 'prosemirror-model'
import { type EditorState, NodeSelection, Plugin } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'

/** The marks of the buttons: the command of a button, and the mark it puts. */
const MARKS: Record<string, MarkType> = {
  strong: schema.marks.strong!,
  em: schema.marks.em!,
  code: schema.marks.code!,
  s: schema.marks.strike!,
  mark: schema.marks.highlight!,
  link: schema.marks.link!,
}
const MARK_COMMANDS = ['strong', 'em', 'code', 's', 'mark'] as const
const MARK_NAMES: Record<(typeof MARK_COMMANDS)[number], MarkName> = {
  strong: 'strong',
  em: 'em',
  code: 'code',
  s: 'strike',
  mark: 'highlight',
}

/** Whether the mark is on where the cursor is: at the cursor, in what the next typing gets; in a range, on all its text. */
function markOn(state: EditorState, type: MarkType): boolean {
  const { from, to, empty, $from } = state.selection
  if (empty) return Boolean(type.isInSet(state.storedMarks ?? $from.marks()))
  let text = false
  let all = true
  state.doc.nodesBetween(from, to, (node) => {
    if (!node.isText) return true
    text = true
    if (!type.isInSet(node.marks)) all = false
    return false
  })
  return text && all
}

/** The style of the block under the cursor, in the values of the selector of styles. */
function styleOf(state: EditorState): string {
  const node = state.selection.$from.parent
  return node.type === schema.nodes.heading ? `h${node.attrs.level as number}` : 'p'
}

export interface ToolbarOptions {
  toolbar: HTMLElement
  style: HTMLSelectElement
  editor(): VisualEditor | undefined
  session(): NotaSession
  /** Called before a command: the message of an earlier refusal goes away. */
  beforeCommand(): void
  /** «Ссылка» asks for an address: the page opens its field. */
  openLink(): void
}

export interface Toolbar {
  /** A plugin for the visual editor: the buttons follow every change of what is selected. */
  plugin(): Plugin
  /** Shows the state again: after the session changed (the history moves in either window). */
  refresh(view?: EditorView): void
}

export function setupToolbar(options: ToolbarOptions): Toolbar {
  const { toolbar, style } = options
  const button = (cmd: string): HTMLButtonElement => toolbar.querySelector<HTMLButtonElement>(`[data-cmd="${cmd}"]`)!
  const setPale = (cmd: string, pale: boolean): void => button(cmd).setAttribute('aria-disabled', String(pale))
  const setPressed = (cmd: string, on: boolean): void => button(cmd).setAttribute('aria-pressed', String(on))

  function refresh(view: EditorView | undefined = options.editor()?.view): void {
    const session = options.session()
    setPale('undo', !session.canUndo)
    setPale('redo', !session.canRedo)
    if (!view) return
    // a selected plate takes no marks and no style: its source is changed in «Исходник»
    const parent = view.state.selection.$from.parent
    const plate =
      view.state.selection instanceof NodeSelection ||
      parent.type === schema.nodes.island ||
      parent.type === schema.nodes.code_block ||
      parent.type === schema.nodes.image
    for (const cmd of [...Object.keys(MARKS), 'unlink']) setPale(cmd, plate)
    // the style of an item, of a NOTE: paragraph and of what is in a box is not chosen from the list
    const kind = view.state.selection.$from.parent.type
    const fixed = kind === schema.nodes.list_item || kind === schema.nodes.admonition_paragraph || options.editor()?.boxAt() != null
    style.disabled = plate || fixed
    for (const cmd of Object.keys(MARKS)) setPressed(cmd, !plate && markOn(view.state, MARKS[cmd]!))
    if (!plate && !fixed) style.value = styleOf(view.state)
  }

  const commands: Record<string, (editor: VisualEditor) => void> = {
    undo: (e) => e.commands.undo(),
    redo: (e) => e.commands.redo(),
    unlink: (e) => e.commands.removeLink(),
    link: () => options.openLink(),
    ...Object.fromEntries(MARK_COMMANDS.map((cmd) => [cmd, (e: VisualEditor) => e.commands.toggleMark(MARK_NAMES[cmd])])),
  }

  // a press on a button must not take the selection from the editor: the button acts on the click, and the editor keeps the cursor
  toolbar.addEventListener('mousedown', (event) => {
    if ((event.target as Element).closest('button')) event.preventDefault()
  })
  toolbar.addEventListener('click', (event) => {
    const el = (event.target as Element).closest<HTMLButtonElement>('button[data-cmd]')
    const editor = options.editor()
    if (!el || !editor || el.getAttribute('aria-disabled') === 'true') return
    options.beforeCommand()
    commands[el.dataset.cmd!]!(editor)
    // «Ссылка» hands the cursor to its field; every other command hands it back to the text
    if (el.dataset.cmd !== 'link') editor.focus()
    refresh()
  })
  style.addEventListener('change', () => {
    const editor = options.editor()
    if (!editor) return
    options.beforeCommand()
    if (style.value === 'p') editor.commands.setBlockType('paragraph')
    else editor.commands.setBlockType('heading', Number(style.value.slice(1)))
    editor.focus()
    // a refused command leaves the block as it was: the selector shows that
    refresh()
  })

  return { plugin: () => new Plugin({ view: () => ({ update: (view) => refresh(view) }) }), refresh }
}
