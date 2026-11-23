import { type SlashState, type TableState, type VisualEditor, schema } from '@nota-adoc/prosemirror'
import type { MarkType } from 'prosemirror-model'
import { type EditorState, NodeSelection, Plugin } from 'prosemirror-state'
import { useSyncExternalStore } from 'react'
import { FILL_ROLES, TEXT_COLOR_ROLES, familyRole } from './roles.js'

export type MarkKey = 'strong' | 'em' | 'code' | 'strike' | 'highlight' | 'link'
export type ListKind = 'unordered' | 'ordered' | 'checklist'
export type StyleValue = 'p' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'

/** What the panels show of the place of the cursor. */
export interface EditorUiState {
  /** The ends of the selection: the panels follow a new one even when it looks the same. */
  readonly from: number
  readonly to: number
  /** Nothing can be formatted here: a selected plate, the title of the document. */
  readonly plate: boolean
  /** The cursor is in the text of a cell that is shown as text (not read): its marks are edited in Text mode. */
  readonly cellAsText: boolean
  /** The selection is a cursor. */
  readonly empty: boolean
  readonly marks: Readonly<Record<MarkKey, boolean>>
  /** The block under the cursor; null on a plate and where the style is not chosen from the list (an item, a note, a box). */
  readonly style: StyleValue | null
  /** The list the cursor is in, or null. */
  readonly list: ListKind | null
  /** The buttons of the lists and the list of styles do nothing here. */
  readonly listOff: boolean
  readonly styleOff: boolean
  /** The type of the admonition the cursor is in (`NOTE`…`CAUTION`), or null. */
  readonly admonition: string | null
  /** The colour of the letters and the fill of the whole selection, or null. */
  readonly textColor: string | null
  readonly fill: string | null
  /** The code the cursor is in (its language word as written), or null. */
  readonly code: { readonly language: string } | null
  /** The menu of «/»: what is typed after it and where the cursor is, or null. */
  readonly slash: SlashState | null
  /** The table the cursor is in (the innermost one), or null. */
  readonly table: TableState | null
}

const MARKS: Record<MarkKey, MarkType> = {
  strong: schema.marks.strong!,
  em: schema.marks.em!,
  code: schema.marks.code!,
  strike: schema.marks.strike!,
  highlight: schema.marks.highlight!,
  link: schema.marks.link!,
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

export const NO_MARKS: Readonly<Record<MarkKey, boolean>> = {
  strong: false,
  em: false,
  code: false,
  strike: false,
  highlight: false,
  link: false,
}

export const IDLE: EditorUiState = {
  from: -1,
  to: -1,
  plate: true,
  cellAsText: false,
  empty: true,
  marks: NO_MARKS,
  style: null,
  list: null,
  listOff: true,
  styleOff: true,
  admonition: null,
  textColor: null,
  fill: null,
  code: null,
  slash: null,
  table: null,
}

/** Reads the state of the panels from the editor. */
export function readState(editor: VisualEditor): EditorUiState {
  const state = editor.view.state
  const parent = state.selection.$from.parent
  const title = parent.type === schema.nodes.heading && (parent.attrs.level as number) < 2
  const item = parent.type === schema.nodes.list_item
  const note = parent.type === schema.nodes.admonition_paragraph
  // (the text of a table cell that is read like a paragraph takes marks, links and colours; the lists and styles are not for it)
  const cell = parent.type === schema.nodes.cell_text
  const richCell = cell && (parent.attrs.rich as boolean)
  const textBlock = parent.type === schema.nodes.paragraph || parent.type === schema.nodes.heading || item || note || richCell
  const plate = state.selection instanceof NodeSelection || title || !textBlock
  const roles = plate ? [] : editor.colorAt()
  const marks = { ...NO_MARKS }
  if (!plate) for (const key of Object.keys(MARKS) as MarkKey[]) marks[key] = markOn(state, MARKS[key])
  return {
    from: state.selection.from,
    to: state.selection.to,
    plate,
    cellAsText: cell && !richCell,
    empty: state.selection.empty,
    marks,
    style:
      plate || item || note || cell || editor.boxAt()
        ? null
        : parent.type === schema.nodes.heading
          ? (`h${parent.attrs.level as number}` as StyleValue)
          : 'p',
    list: plate ? null : (editor.listAt()?.kind ?? null),
    listOff: plate || note || cell || parent.type === schema.nodes.heading,
    admonition: plate ? null : (editor.admonitionAt()?.variant ?? null),
    styleOff: plate || item || note || cell || editor.boxAt() !== null,
    textColor: familyRole(TEXT_COLOR_ROLES, roles),
    fill: familyRole(FILL_ROLES, roles),
    code: editor.codeAt(),
    slash: editor.slashAt(),
    table: editor.tableAt(),
  }
}

const same = (a: EditorUiState, b: EditorUiState): boolean =>
  a.from === b.from &&
  a.to === b.to &&
  a.plate === b.plate &&
  a.cellAsText === b.cellAsText &&
  a.empty === b.empty &&
  a.style === b.style &&
  a.list === b.list &&
  a.listOff === b.listOff &&
  a.styleOff === b.styleOff &&
  a.admonition === b.admonition &&
  a.textColor === b.textColor &&
  a.fill === b.fill &&
  a.code?.language === b.code?.language &&
  (a.code === null) === (b.code === null) &&
  a.slash?.query === b.slash?.query &&
  a.slash?.offset === b.slash?.offset &&
  a.slash?.rect?.top === b.slash?.rect?.top &&
  a.slash?.rect?.left === b.slash?.rect?.left &&
  (a.slash === null) === (b.slash === null) &&
  a.table?.level === b.table?.level &&
  a.table?.header === b.table?.header &&
  a.table?.merged === b.table?.merged &&
  a.table?.selected === b.table?.selected &&
  a.table?.fill === b.table?.fill &&
  a.table?.cells === b.table?.cells &&
  a.table?.mixedFill === b.table?.mixedFill &&
  a.table?.selectedRows === b.table?.selectedRows &&
  a.table?.selectedCols === b.table?.selectedCols &&
  JSON.stringify(a.table?.selection ?? null) === JSON.stringify(b.table?.selection ?? null) &&
  a.table?.rect?.top === b.table?.rect?.top &&
  a.table?.rect?.left === b.table?.rect?.left &&
  a.table?.rect?.right === b.table?.rect?.right &&
  (a.table === null) === (b.table === null) &&
  (Object.keys(MARKS) as MarkKey[]).every((k) => a.marks[k] === b.marks[k])

interface Store {
  snapshot: EditorUiState
  readonly listeners: Set<() => void>
}

const stores = new WeakMap<VisualEditor, Store>()

/** Follows the editor with a ProseMirror plugin: every state of its view (a move of the cursor, an edit of another editor) refreshes the store. */
function storeOf(editor: VisualEditor): Store {
  const existing = stores.get(editor)
  if (existing) return existing
  const made: Store = { snapshot: readState(editor), listeners: new Set() }
  stores.set(editor, made)
  const plugin = new Plugin({
    view: () => ({
      update: () => {
        const next = readState(editor)
        if (same(next, made.snapshot)) return
        made.snapshot = next
        for (const l of [...made.listeners]) l()
      },
    }),
  })
  const view = editor.view
  view.updateState(view.state.reconfigure({ plugins: [...view.state.plugins, plugin] }))
  return made
}

const NONE: Store = { snapshot: IDLE, listeners: new Set() }

/** The state of the panels under the cursor of `editor` (idle without an editor). */
export function useEditorState(editor: VisualEditor | undefined): EditorUiState {
  const store = editor ? storeOf(editor) : NONE
  return useSyncExternalStore(
    (listener) => {
      store.listeners.add(listener)
      return () => store.listeners.delete(listener)
    },
    () => store.snapshot,
  )
}
