/**
 * The visual editor. The text of the session is the truth and the ProseMirror document is its projection. What a
 * person does in the editor becomes an operation on the text (`applyOperation` of Nota), the session applies it,
 * and the projection is brought back in line with the text: a keystroke checks its own block, anything else
 * rebuilds only the blocks whose reading changed.
 */
import {
  type AdmonitionVariant,
  type BlockSpec,
  type ApplyResult,
  type Change,
  type ListKind,
  type Operation,
  type NotaDocument,
  type NotaSession,
  type SessionEvent,
  type TypedMarks,
  applyOperation,
  composeChanges,
  mapOffset,
} from '@nota-adoc/core'
import {
  type BlockInfo,
  type CellBlock,
  type Cell,
  type CellView,
  type TableView,
  type Item,
  editableBlockAt,
  blockEnd,
  cellsBefore,
  checkNoCollateral,
  SIMPLE_CELL,
  cellBlockAt,
  readCell,
  isRawKind,
  roleNames,
  tableViewAt,
  layoutItems,
  pageMetaItems,
  TOC_PINNED,
  PAGE_META_BODY,
  escapeInline,
  type PageMeta,
  readInline,
  readLayout,
  blankAfter,
  topBlocks,
  type TopBlock,
  insertCellItem,
  splitCellItem,
} from '@nota-adoc/core/internal'
import { Fragment, type Mark, type Node as PMNode } from 'prosemirror-model'
import { EditorState, NodeSelection, Plugin, PluginKey, Selection, TextSelection, type Transaction } from 'prosemirror-state'
import { ReplaceStep } from 'prosemirror-transform'
import { Decoration, DecorationSet, EditorView } from 'prosemirror-view'
import { DIAGRAM, diagramItems, diagramSample, diagramSource } from './diagram.js'
import { DiagramView, type DiagramHost, type DiagramRenderer, type DiagramTheme } from './diagramview.js'
import { type PasteBlock, convertHtml, fragmentSource, plainOfBlocks, renderRuns } from './paste.js'
import { ImageView, type ImageResolver } from './imageview.js'
import { canonicalLanguage } from './languages.js'
import { keymapPlugin } from './keymap.js'
import { type Located, PosMap, chooseOffset, isVerbatim, itemKey, keysOf } from './positions.js'
import { itemNumbers, projectItem } from './project.js'
import { getLabels, type Labels, schema, setLabels } from './schema.js'
import { colsRefusal, lineRefusal, type LineAct, type Refusal } from './tablelinebar.js'
import { type GripHost, type GripPlace, type LineRange, TableGrips, TableNodeView, widthRefusal } from './tablegrips.js'
import {
  type Step,
  type TableLoc,
  blockOffset,
  blockPosition,
  blockRange,
  cellAtIndex,
  cellCursor,
  type CellDraft,
  coveringCell,
  followSteps,
  resolveTable,
  textPlace,
  type TextBlock,
} from './tablepos.js'

/** Why an edit was refused. */
export interface RejectInfo {
  /** A short code: `link-across-blocks`, `not-editable`, … */
  readonly code: string
  /** The message, in English or the one the host gave for the code in `messages`. */
  readonly message: string
  /** What was asked, when it was an operation on the text. */
  readonly operation: Operation | null
}

export interface VisualEditorOptions {
  /** The session the editor shows and edits; other editors may be on it too. */
  readonly session: NotaSession
  /**
   * Called with the message when an edit is refused; the text and the screen stay as they were. The second argument
   * has the code of the refusal and what was asked.
   */
  readonly onReject?: (message: string, info: RejectInfo) => void
  /** Messages for the codes of refusals (the default ones are in English). */
  readonly messages?: Readonly<Record<string, string>>
  /** More ProseMirror plugins. */
  readonly plugins?: readonly Plugin[]
  /**
   * Called when what was typed, deleted (a deletion can make the text around it read in another way) or pasted could
   * not be written so that it reads exactly as asked (a backslash in front of a mark, say) and was written as it is;
   * the screen shows what the text reads as.
   */
  readonly onInexact?: (operation: Operation) => void
  /**
   * Called after a keystroke with the milliseconds Nota took (the operation on the text, its reparse and the check
   * of the block), for a bench of the speed of typing.
   */
  readonly timing?: (notaMs: number) => void
  /** The words the editor shows around the text (the label of a checkbox, the types of admonitions …); English when not given. */
  readonly labels?: Labels
  /** Where the picture of an image is (or why there is none); without it every image is a plate. */
  readonly images?: ImageResolver
  /** Draws the code of a diagram as the markup of an SVG; without it no diagram is drawn (a plate says so). */
  readonly renderDiagram?: DiagramRenderer
  /** The theme diagrams are drawn in (`light` when not given); `redrawDiagrams` draws them again after it changed. */
  readonly diagramTheme?: () => DiagramTheme
  /**
   * The colours of a piece of code: ranges of `text` with the class they get (`tok-keyword`). `language` is the id of a language of
   * the list (`javascript`), or null for a word that is not in it; the editor asks only for code that has a language.
   */
  readonly highlightCode?: (language: string, text: string) => readonly HighlightRange[]
  /**
   * Keeps the header of a page (a block comment `////` with lines `key: value` at the start of the file, and the attribute
   * entries up to the first block of content) out of sight: the screen shows no island for it, no cursor goes into it, and no
   * selection that is typed over takes it away. Off when not given.
   */
  readonly pageMeta?: boolean
  /** Called when the header of the page, or whether it is open for editing, changed (null: the file has none). */
  readonly onPageMeta?: (info: PageMetaInfo | null) => void
}

/** The header of a page as the editor reports it. */
export interface PageMetaInfo {
  /** The fields `key: value` in the order of the file (a list `key:` over `- item` lines is an array). */
  readonly fields: readonly { readonly key: string; readonly value: string | readonly string[] }[]
  /** The attribute entries kept out of sight (before the title, and after it up to the first block of content), in the order of the file. */
  readonly attributes: readonly { readonly name: string; readonly value: string }[]
  /** The header is open as islands (`editPageMeta`), not kept out of sight. */
  readonly open: boolean
}

/** True for an item that is part of the header of a page and not for the cursor or a selection: the header, and the line `toc::[]` among it. */
const isPinned = (it: Item): boolean => it.block?.fence === 'meta' || (it.block?.fence === 'toc' && it.block.label === TOC_PINNED)

/** A stretch of code and the class it is drawn with. */
export interface HighlightRange {
  readonly from: number
  readonly to: number
  readonly class: string
}

/** What the menu of «/» shows of the place: the paragraph that holds the cursor and what was typed after the slash. */
export interface SlashState {
  /** The text after the «/». */
  readonly query: string
  /** The offset of the paragraph in the text. */
  readonly offset: number
  /** Where the cursor is on the screen (the coordinates of the window); null when nothing is laid out. */
  readonly rect: { readonly top: number; readonly left: number; readonly bottom: number } | null
}

/** The blocks the menus put in. The headings 2–6, the lists, the note and the collapsible block start a block that is written with its first letter. */
export type InsertKind =
  | 'heading2'
  | 'heading3'
  | 'heading4'
  | 'heading5'
  | 'heading6'
  | 'unordered'
  | 'ordered'
  | 'checklist'
  | 'admonition'
  | 'collapsible'
  | 'table'
  | 'code'
  | 'image'
  | 'mermaid'

/** The kinds of the headings and their levels. */
const HEADING_KINDS: readonly (readonly [InsertKind, number])[] = [
  ['heading2', 2],
  ['heading3', 3],
  ['heading4', 4],
  ['heading5', 5],
  ['heading6', 6],
]

/** What a menu can say besides the kind: the path of an image (relative, as written in the file), the title of a collapsible block. */
export interface InsertOptions {
  readonly path?: string
  readonly title?: string
}

/** The code the cursor is in. */
export interface CodeState {
  /** The word after `source,` as written ('' when there is none). */
  readonly language: string
}

/** The roles of the colour of letters that the panel offers, and the roles of the fill. */
export const TEXT_COLOR_ROLES: readonly string[] = ['hl-red', 'hl-orange', 'hl-green', 'hl-teal', 'hl-blue', 'hl-purple', 'hl-pink', 'hl-gray']
export const FILL_ROLES: readonly string[] = [
  'hl-yellow-bg',
  'hl-red-bg',
  'hl-orange-bg',
  'hl-green-bg',
  'hl-teal-bg',
  'hl-blue-bg',
  'hl-pink-bg',
  'hl-purple-bg',
  'hl-gray-bg',
]

/** The roles of the fill of a cell: the label `[.cell-yellow]##{empty}##` at the start of its text. */
export const CELL_FILL_ROLES: readonly string[] = [
  'cell-yellow',
  'cell-green',
  'cell-blue',
  'cell-pink',
  'cell-purple',
  'cell-gray',
]

/** The number before the `|` of a cell that spans: `2+`, `.2+`, `2.2+`. */
const spanOf = (cols: number, rows: number): string =>
  cols > 1 && rows > 1 ? `${cols}.${rows}+` : cols > 1 ? `${cols}+` : rows > 1 ? `.${rows}+` : ''

export type MarkName = 'strong' | 'em' | 'code' | 'strike' | 'highlight'

/** The names the commands take for a mark: the ones of the schema, and the usual ones of the panel. */
const MARK_ALIASES: Record<string, MarkName> = {
  strong: 'strong',
  bold: 'strong',
  em: 'em',
  italic: 'em',
  code: 'code',
  monospace: 'code',
  mono: 'code',
  strike: 'strike',
  strikethrough: 'strike',
  'line-through': 'strike',
  highlight: 'highlight',
  mark: 'highlight',
}

/** A style: `'paragraph'`, `'heading'` with a level, `'h2'`…`'h6'` or an object `{ type, level }`. */
export type BlockStyle =
  'paragraph' | 'heading' | 'p' | `h${2 | 3 | 4 | 5 | 6}` | { type: 'paragraph' | 'heading'; level?: number }

/** What the panel and the keys can ask of the editor; each returns false when it was refused or did nothing. */
export interface EditorCommands {
  /** A mark over the selection, or off it (`strong`, `em`, `code`, `strike`, `highlight`; `bold`, `italic`… too). */
  toggleMark(mark: MarkName | 'bold' | 'italic' | 'monospace' | 'strikethrough'): boolean
  setLink(target: string): boolean
  removeLink(): boolean
  /** The colour of the letters over the selection: one of `TEXT_COLOR_ROLES`, or `null` for no colour (the fill stays). One step of the history. */
  setTextColor(role: string | null): boolean
  /** The fill behind the selection: one of `FILL_ROLES`, or `null` for no fill (the colour of the letters stays; the mark `#…#` stays). */
  setFill(role: string | null): boolean
  /** The style of every paragraph and heading of the selection (none of a list item, a cell or an admonition); asked again, it goes back. */
  setBlockType(type: BlockStyle, level?: number): boolean
  /** As `setBlockType`, but a style that every block of the selection already has turns them into paragraphs (the keys). An empty line takes a heading as a draft, and an open «/» takes it as a pick. */
  toggleBlockType(type: BlockStyle, level?: number): boolean
  splitBlock(): boolean
  insertBreak(): boolean
  deleteBackward(): boolean
  deleteForward(): boolean
  undo(): boolean
  redo(): boolean
  /**
   * The item or paragraph that holds the cursor becomes an item of a list of that kind, or (the same kind again) a paragraph. With
   * a selection over several paragraphs they become the items of one list.
   */
  toggleList(kind: ListKind): boolean
  /** Tab: the item that holds the cursor goes one level in. */
  indentListItem(): boolean
  /** Shift-Tab: the item that holds the cursor goes one level out. */
  outdentListItem(): boolean
  /** The checkbox of the item that holds the cursor (or of the item at `offset` of the text) is checked or cleared; without `checked`, it flips. */
  setChecked(checked?: boolean, offset?: number): boolean
  /** The type of the admonition that holds the cursor. */
  setAdmonitionType(variant: AdmonitionVariant): boolean
  /** Opens or closes the collapsible block that holds the cursor, or starts at `offset` of the text; the file does not change. */
  toggleCollapsible(offset?: number): boolean
  /** Tab (`1`) or Shift-Tab (`-1`) in code: two blanks at the cursor, or at the start of every selected line (up to two blanks taken away). */
  indentCode(direction: 1 | -1): boolean
  /** The language of the code that holds the cursor: `source,` and this word (`python`). */
  setCodeLanguage(language: string): boolean
  /**
   * A block of the menus: in the place of the paragraph that «/» was typed in, or of the empty paragraph that holds the cursor,
   * else after the block that holds it. The kinds that start with a marker only start: the block is written with its first letter.
   */
  insertBlock(kind: InsertKind, options?: InsertOptions): boolean
  /** The menu of «/» is not shown in this paragraph until it is emptied. */
  dismissSlash(): boolean
  /** Plain text from the clipboard (Cmd+Shift+V): without marks or links, each line a paragraph, whatever else the clipboard holds. */
  pastePlain(text: string): boolean
  /** A row of empty cells under the row of the cell that holds the cursor (under the lowest row of a merged cell). The cursor goes to its first cell. */
  insertRow(): boolean
  /** A column of empty cells right of the column of the cell that holds the cursor. The cursor goes to the new cell of its row. */
  insertColumn(): boolean
  /** The row of the cell that holds the cursor goes; refused for the last row and for a row a merged cell passes through. */
  deleteRow(): boolean
  /** The column of the cell that holds the cursor goes; refused for the last column and for a column a merged cell passes through. */
  deleteColumn(): boolean
  /** The selected cells (Shift-click) become one cell; the text of the top left one stays. */
  mergeCells(): boolean
  /** The merged cell that holds the cursor becomes cells again (each with the fill of the merged one). */
  splitCell(): boolean
  /**
   * The cell that holds the cursor, or all the selected cells (Shift-click), get the fill `role` (one of `CELL_FILL_ROLES`), or
   * lose it (`null`): one step of the history. Refused with `cell-fill-refused` for a cell the label would show in.
   */
  setCellFill(role: string | null): boolean
  /** every merged cell among the selected ones (or the one that holds the cursor) becomes cells again, in one step; the selection stays. */
  splitCells(): boolean
  /** the selected cells (or the one that holds the cursor) are aligned: `horizontal` and/or `vertical`, in one step; the selection stays. */
  setCellAlign(horizontal?: CellHAlign, vertical?: CellVAlign): boolean
  /** the text of the selected cells goes (their fill, alignment and merging stay), in one step; the selection stays. Refused with `cells-empty` when there is none. */
  clearCells(): boolean
  /** the rows, or the columns, that the rectangle of the selected cells spans go in one step (as the grips do). */
  deleteSelectedRows(): boolean
  deleteSelectedColumns(): boolean
  /** The first row of the table is the head, or (again) is not. */
  toggleHeader(): boolean
  /** The cell that holds the cursor gets a table of 2 × 2 cells of the next level. */
  nestTable(): boolean
  /** The table the cursor is in goes (a table in a cell: only the table, the cell stays). */
  deleteTable(): boolean
  /** Tab (`1`) and Shift-Tab (`-1`) in a table: the next or the previous cell; Tab in the last cell adds a row. */
  nextCell(direction: 1 | -1): boolean
  /**
   * The block that starts at offset `at` (a block of the top level or of a section, with its lines of metadata; a section with
   * its subsections) goes to the place `to` names, as `moveBlock` of the engine reads it. Refused with the code of the engine.
   */
  moveBlock(at: number, to: number): boolean
  /** The block that starts at `at` goes, with its lines of metadata and one blank line (a section: with its subsections). */
  deleteBlockAt(at: number): boolean
  /** The line `.title` over the block that starts at `at` is written, changed or (empty title) removed. One small replacement. */
  setBlockTitle(at: number, title: string | null): boolean
  /**
   * The line `[[id]]` over the block that starts at `at` is written, changed or (empty id) removed. Refused with `bad-anchor` (the
   * id is not one word) or `duplicate-anchor` (another block has it).
   */
  setBlockAnchor(at: number, id: string | null): boolean
}

export type CellHAlign = 'left' | 'center' | 'right'
export type CellVAlign = 'top' | 'middle' | 'bottom'

/** What a button is refused for beforehand: the code and the text of the tab. */
export interface CellRefusal {
  readonly code: string
  readonly text: string
}

/** two or more selected cells (any way of selecting them). Rows and columns count from 0. */
export interface CellSelectionState {
  readonly row: number
  readonly col: number
  readonly rows: number
  readonly cols: number
  /** A merged cell is among them. */
  readonly merged: boolean
  /** The selection takes in the first row of the table. */
  readonly firstRow: boolean
  /** The alignment they all have, or null when they differ. */
  readonly halign: CellHAlign | null
  readonly valign: CellVAlign | null
  /** None of them has text. */
  readonly empty: boolean
  /** Why a button is dimmed (null: it works). */
  readonly refusals: {
    readonly merge: CellRefusal | null
    readonly header: CellRefusal | null
    readonly clear: CellRefusal | null
    readonly deleteRows: CellRefusal | null
    readonly deleteColumns: CellRefusal | null
  }
}

/** What the panel of tables shows of the place of the cursor. */
export interface TableState {
  /** 1 for a table of the document, 2–4 for a table in a cell. */
  readonly level: number
  /** The table has a head. */
  readonly header: boolean
  /** The cell under the cursor is a merged one. */
  readonly merged: boolean
  /** Two or more cells are selected (Shift-click). */
  readonly selected: boolean
  /** The role of the fill of the cell under the cursor (`cell-yellow`), or null; with several cells selected: the common one, or null. */
  readonly fill: string | null
  /** How the cell under the cursor is spanned, as the number before its `|`: `2+`, `.2+`, `2.2+`, or ''. */
  readonly span: string
  /** How many cells the fill goes to: the selected ones, or 1. */
  readonly cells: number
  /** The selected cells have different fills. */
  readonly mixedFill: boolean
  /** How many rows, or columns, a click on the grips selected (0: not that); the commands of deleting go to all of them. */
  readonly selectedRows: number
  readonly selectedCols: number
  /** the rectangle of two or more selected cells, and what the capsule of cells needs of it; null when fewer are selected. */
  readonly selection: CellSelectionState | null
  /** Where the table is on the screen, in the coordinates of the window; null when nothing is laid out. */
  readonly rect: { readonly top: number; readonly right: number; readonly bottom: number; readonly left: number } | null
}

/** The list the cursor is in. */
export interface ListState {
  readonly kind: ListKind
  /** 1 for the first level. */
  readonly level: number
  /** The item has no text in the file yet (an empty item that was just started). */
  readonly draft: boolean
}

/** The admonition the cursor is in. */
export interface AdmonitionState {
  readonly variant: AdmonitionVariant
  /** `paragraph` for `NOTE: …`, `block` for `[NOTE]` over `====`. */
  readonly form: 'paragraph' | 'block'
  /** Where it is on the screen (the whole paragraph or box), in the coordinates of the window; null when nothing is laid out. */
  readonly rect: { readonly top: number; readonly right: number; readonly bottom: number; readonly left: number } | null
}

/** A stretch of the text to mark under the text of the editor (a remark of Nota). */
export interface TextRange {
  /** Offsets in the text of the session. */
  readonly from: number
  readonly to: number
  /** The hint on hover (`title`). */
  readonly message: string
  /** `data-severity` of the mark, for the styles. */
  readonly severity?: string
}

/** What a block of the top level looks like to its handle. */
export type BlockSort =
  | 'paragraph'
  | 'heading'
  | 'list'
  | 'code'
  | 'image'
  | 'table'
  | 'admonition'
  | 'collapsible'
  | 'island'

/** A block of the top level or of a section, as the handle sees it. */
export interface BlockSpot {
  /** Where the block starts (with its lines of metadata): what the commands take. */
  readonly offset: number
  /** Where the block ends in the text (a section: with its subsections). */
  readonly end: number
  readonly sort: BlockSort
  /** A section: it moves and goes away with its subsections. */
  readonly section: boolean
  /** The text of the line `.Title`, or null. */
  readonly caption: string | null
  /** The id of the line `[[id]]`, or null. */
  readonly anchor: string | null
  /** Where it is on the screen, in the coordinates of the window; null when nothing is laid out. */
  readonly rect: { readonly top: number; readonly right: number; readonly bottom: number; readonly left: number } | null
  /** A table: the top of its frame (under the caption), in the coordinates of the window; else null. */
  readonly frameTop: number | null
}

/** A place between blocks where a dragged block can be put. */
export interface DropSlot {
  /** The offset `commands.moveBlock` takes as the place. */
  readonly to: number
  /** The line of the window the mark of the place is drawn at. */
  readonly y: number
}

/** The editor as the host sees it. */
export interface VisualEditor {
  readonly view: EditorView
  readonly session: NotaSession
  /** The current text. */
  getText(): string
  /** The selection as offsets in the text (the ends of a cursor in a plate are the edges of the plate); null when it is nowhere. */
  selectionOffsets(): { anchor: number; head: number } | null
  /**
   * Puts the selection at offsets of the text. An offset in markup that the editor does not show goes to the nearest visible
   * place of the same block; an offset in a plate selects the plate. Does not move the page.
   */
  setSelectionAtOffset(anchor: number, head?: number): void
  /**
   * The colour roles that the whole selection has (at a cursor: the text under it, or what is typed next), from the
   * outside in. The panel tells the colour of the letters from the fill by `TEXT_COLOR_ROLES` and `FILL_ROLES`.
   */
  colorAt(): readonly string[]
  /** The list the cursor is in (an item or a started item), or null. */
  listAt(): ListState | null
  /** The admonition the cursor is in, or null (also null when a plate is selected). */
  admonitionAt(): AdmonitionState | null
  /** A marker (`*`, `1.`, `==`) was just typed in an empty paragraph and a space may follow: the host should hold the edit back (two seconds at most). */
  readonly markerPending: boolean
  /** The kind of box the cursor is in (its head, its text or its end), or null. */
  boxAt(): 'admonition' | 'collapsible' | null
  /** The table the cursor is in (the innermost one), or null. */
  tableAt(): TableState | null
  /** The code the cursor is in, or null. */
  codeAt(): CodeState | null
  /** The menu of «/» is to be shown: the cursor is in a paragraph that holds a slash and what follows it, and nothing else. Null otherwise. */
  slashAt(): SlashState | null
  /**
   * The block of the top level or of a section under a point of the window, for its handle; null when there is none (a block
   * inside a box, a cell or an item has no handle of its own).
   */
  blockAt(x: number, y: number): BlockSpot | null
  /** The same for the block that starts at `offset` of the text (what the handle keeps while the menu is open). */
  blockAtOffset(offset: number): BlockSpot | null
  /**
   * The places a block can be put between the blocks, top to bottom: `to` is what `commands.moveBlock` takes, `y` the line of the
   * window where the mark of the place is drawn. A section only goes before a section or at the end.
   */
  dropSlots(section: boolean): readonly DropSlot[]
  /** Scrolls so that the place of `offset` is seen: at the top (`start`) or only if it is out of sight (`nearest`, the default). */
  scrollToOffset(offset: number, where?: 'start' | 'nearest'): void
  /**
   * The offset of the start of the top block that is seen, and of the first one when nothing is measured (no layout). `fraction`
   * (0 to 1) moves the line down the seen part: 1/3 is the line at the top third, where the current section is looked for.
   */
  topVisibleOffset(fraction?: number): number
  /**
   * How far from the top edge of the scrolling element the cursor is kept when the view scrolls to it (px, at least 5, the default):
   * something lies over the top of the document (the capsules). The other edges keep 5 px. Can be changed at any time.
   */
  setScrollMarginTop(px: number): void
  /**
   * Frames the cell that holds the cursor with the class `fill-target` (the row of colours of the fill of a cell is open: this is the cell
   * that gets the fill). Several selected cells have their own frame; with them nothing is added. `false` takes the frame off.
   */
  markFillTarget(on: boolean): void
  /** Marks stretches of the text with the class `diag` and a `title`; replaces the marks set before. */
  setRanges(ranges: readonly TextRange[]): void
  /** Draws every diagram again (the theme of the page changed). */
  redrawDiagrams(): void
  /** The header of the page (with the `pageMeta` option), or null when the file has none or the option is off. */
  pageMeta(): PageMetaInfo | null
  /** Opens the header as islands, the cursor on the line `focusKey` (`version`) or at its start; false when there is none. */
  editPageMeta(focusKey?: string): boolean
  /** Puts the header out of sight again; the cursor goes to the start of the title (or the first block there). */
  collapsePageMeta(): boolean
  /** The interface sets it while the capsule of cells is on the screen: the first Esc then only puts it out of sight, the cells stay selected. */
  cellCapsuleShown: boolean
  focus(): void
  /** Removes the editor from the page and from the session. */
  destroy(): void
  readonly commands: EditorCommands
}

/** Marks the transactions the editor makes itself. */
const OWN = 'nota-own'
/** Marks the transaction that selects cells: the selection of the cells is not let go by it. */
const CELLS = 'nota-cells'
/** The marks of the ranges: a set kept in the state of the editor, changed by the difference of the ranges, not made anew. */
const RANGE_MARKS = new PluginKey<DecorationSet>('nota-range-marks')

/** What a transaction of `setRanges` carries: the marks that go and the marks that come. */
interface RangeChange {
  readonly remove: Decoration[]
  readonly add: Decoration[]
}

/** One mark of a range, before it is made a decoration. */
interface RangeMark {
  readonly from: number
  readonly to: number
  /** the key of what it looks like: the kind of mark, the severity and the message */
  readonly look: string
  readonly node: boolean
  readonly attrs: Record<string, string>
}


/** A square of the grid of a table. */
interface Sq {
  readonly row: number
  readonly col: number
  readonly rowspan: number
  readonly colspan: number
}

/** What a single-step transaction that replaces a stretch of text with plain text says. */
interface TextEdit {
  readonly from: number
  readonly to: number
  readonly text: string
  readonly marks: readonly Mark[]
}

function textEdit(tr: Transaction): TextEdit | null {
  if (tr.steps.length !== 1) return null
  const step = tr.steps[0]
  if (!(step instanceof ReplaceStep)) return null
  const slice = (step as unknown as { slice: { openStart: number; openEnd: number; content: Fragment } })
    .slice
  if (slice.openStart || slice.openEnd) return null
  let text = ''
  let marks: readonly Mark[] = []
  for (let i = 0; i < slice.content.childCount; i++) {
    const n = slice.content.child(i)
    if (!n.isText) return null
    if (i === 0) marks = n.marks
    text += n.text!
  }
  const s = step as unknown as { from: number; to: number }
  return { from: s.from, to: s.to, text, marks }
}

const MARK_NAMES = new Set(['strong', 'em', 'code', 'strike', 'highlight'])
const CELL_TEXT = 'In this cell the markup is shown as text: marks and links are set in Text mode. The file is unchanged.'

/** A cell of a reading that is a plain character: no mark, no flag, and written as it shows. */
const plainCell = (c: Cell): boolean => c.kind === 'char' && !c.newline && c.spans.length === 0 && c.flag === null && c.src === c.ch

const markNames = (keys: string[]): MarkName[] => keys.filter((k) => MARK_NAMES.has(k)) as MarkName[]

/** An item or a heading that is only started: on the screen until its first sign is typed. */
interface Draft {
  /** `after`: an item after the one before it in the list; `start`: it takes the place of an empty paragraph. */
  readonly mode: 'after' | 'start'
  /** Its index among the items (with it). For a collapsible block: the index of the empty paragraph it takes the place of. */
  readonly at: number
  /** `start` after a block, not in an empty paragraph: there is no empty paragraph in the text, `at` is where it would stand. */
  readonly virtual?: boolean
  readonly kind: 'item' | 'heading' | 'admonition' | 'collapsible'
  /** A collapsible block: its title. */
  readonly title?: string
  /** The level of the item (1 for the first), or of the heading (2–6). */
  readonly level: number
  readonly ordered: boolean
  readonly check: boolean
  /** `start`: what was typed before the space (`* `, `1. `, `== `). */
  readonly prefix: string
}

const isTextItem = (it: Item): boolean => it.kind === 'paragraph' || it.kind === 'heading' || it.kind === 'item'

/** Text that reads as one of these was not meant as text: a list, a code block … is not made by typing it. */
const isPlateKind = (kind: string | undefined): boolean => kind === 'chip' || kind === 'code' || kind === 'image'

/** The item that stands for a draft among the items of the document. */
function draftItem(d: Draft, p: number, from: number, to: number): Item {
  const kind = d.kind === 'admonition' || d.kind === 'collapsible' ? 'paragraph' : d.kind
  const block: BlockInfo = {
    kind,
    from,
    to,
    meta: null,
    content: { from: p, to: p },
    level: d.level,
    marker: d.mode === 'start' ? d.prefix.trim() : d.ordered ? '.' : '*',
    markerFrom: -1,
    label: 'Draft',
    eol: '',
    variant: d.kind === 'admonition' ? d.prefix.replace(/:\s*$/, '') : '',
    checked: d.check ? ' ' : '',
    fence: '',
    box: '',
    title: '',
    startsOpen: false,
    lang: '',
    target: '',
  }
  return { kind, from, to, block, blockIndex: -1, gap: -1, line: -1 }
}

/** The items a collapsible block that is only started is shown as: its head, an empty paragraph, its end. */
function draftBox(d: Draft, e: Item): Item[] {
  const fence = (side: 'open' | 'close', to: number): Item => {
    const block: BlockInfo = {
      ...draftItem(d, e.from, e.from, to).block!,
      kind: 'fence',
      content: null,
      fence: side,
      box: 'collapsible',
      title: d.title ?? '',
      startsOpen: true,
      label: 'Draft',
      level: 0,
      marker: '',
      checked: '',
      variant: '',
    }
    return { kind: 'fence', from: e.from, to, block, blockIndex: -1, gap: -1, line: -1 }
  }
  const para = draftItem({ ...d, kind: 'item' }, e.from, e.from, e.from)
  const block: BlockInfo = { ...para.block!, kind: 'paragraph', level: 0, marker: '', checked: '' }
  return [fence('open', e.from), { ...para, kind: 'paragraph', block }, fence('close', e.to)]
}

/** The index of the node a draft is typed in. */
const draftIndex = (d: Draft): number => (d.kind === 'collapsible' ? d.at + 1 : d.at)

/** The collapsible and admonition boxes of the items: the index of the first and the last, and whether a collapsible one is open. */
interface BoxAt {
  readonly start: number
  readonly end: number
  readonly offset: number
  readonly box: 'admonition' | 'collapsible'
  readonly variant: string
  readonly open: boolean
}
interface Boxes {
  readonly byIndex: (BoxAt | null)[]
  readonly list: BoxAt[]
}

/** A cell with no text of its own (a fill label is not text): no blocks, or only empty paragraphs. */
function cellIsEmpty(c: CellView): boolean {
  return c.blocks.every((b) => b.kind === 'text' && b.text.trim() === '')
}

type Select = 'keep' | ((m: PosMap, doc: PMNode) => Selection | number | null)

class Editor implements VisualEditor {
  view!: EditorView
  map!: PosMap
  readonly commands: EditorCommands
  private unsubscribe: () => void
  /** While an input method composes, the ProseMirror document runs ahead of the text. */
  private composing: PMNode | null = null
  /** The warning that `view.domObserver` is not there was given (once for an editor). */
  private warnedObserver = false
  /** The ranges last given to `setRanges`: put back when the screen is made again from a text that did not change. */
  private lastRanges: readonly TextRange[] = []
  private composingAt: { anchor: number; head: number } | null = null
  /** Where the selection started when the composition began: what was typed is not put in before it. */
  private composingFrom = 0
  /** The changes the session got while an input method was composing, in order: they were not shown. */
  private missed: (readonly Change[])[] = []
  private destroyed = false
  /** An item or heading that is started and has no text yet: on the screen only, it is written with its first sign. */
  private draft: Draft | null = null
  /** An item of a list in a cell that is only started (see `CellDraft`). */
  private cellDraft: CellDraft | null = null
  /** Collapsible blocks that were opened (true) or closed (false) on the screen, by the offset their first line starts at. */
  private opened = new Map<number, boolean>()
  private openVersion = 0
  private boxCache: { map: PosMap; version: number; data: Boxes } | null = null
  /** The text the last typing into an empty paragraph made, while the text is as that typing left it. */
  private typedInEmpty: { doc: NotaDocument; index: number } | null = null
  private typedAt = 0
  /**
   * An island that is being edited stays an island on the screen while the cursor is in it, whatever its text reads as: the range
   * of its source in the text (the line break at the end included), and whether the text on the screen is not in the file.
   */
  private pin: { from: number; to: number; unsaved: boolean } | null = null
  private readonly diagrams: DiagramHost
  /** The header of the page the items were made with (null: none, or the option is off), and whether it is open as islands. */
  private meta: PageMeta | null = null
  private metaOpen = false
  private metaTold = ''
  /** The paragraph that «/» was dismissed in (Esc), by the offset it starts at. */
  private slashDismissed: number | null = null
  private highlightCache = new WeakMap<PMNode, readonly HighlightRange[]>()
  /** The line a click on a grip was refused for: the anchor of a later Shift-click, while nothing else is selected. */
  private refused: { index: number; host: readonly Step[]; kind: 'col' | 'row'; anchor: number } | null = null
  /** The row of colours of the fill of a cell is open: the cell with the cursor is framed. */
  private fillTarget = false
  /** The capsule of cells is on the screen (set by the interface): the first Esc then only puts it out of sight, the cells stay selected. */
  cellCapsuleShown = false
  /** Cells selected with Shift-click: the table (the top-level node, the steps to it) and the two squares of the grid that were clicked. */
  private cellSel: { index: number; host: readonly Step[]; a: Sq; b: Sq; line?: { kind: 'col' | 'row'; anchor: number; head: number } } | null = null
  /** The grips of columns and rows and the borders between columns. */
  private grips: TableGrips | null = null
  /** A press of the mouse button in a cell of a table, from the press to the release (and the tick after): the cells are selected by dragging. */
  private drag: { index: number; host: readonly Step[]; nodePos: number; a: Sq; pos: number; moved: boolean; ended: boolean } | null = null
  private dragTimer: ReturnType<typeof setTimeout> | null = null
  private readonly onMouseUp = (): void => this.endDrag()

  /**
   * A marker (`*`, `1.`, `==`) is typed in an empty paragraph and a space may follow: the host should not be given the edit yet,
   * or a pause makes two edits of what is, at the end, no edit. It lasts two seconds at most.
   */
  get markerPending(): boolean {
    const t = this.typedInEmpty
    if (t === null || t.doc !== this.session.doc || Date.now() - this.typedAt >= 2000) return false
    const b = this.map.items[t.index]?.block
    if (!b?.content) return false
    return /^(\*|-|\.|\d+\.|={1,6})$/.test(this.session.text.slice(b.content.from, b.content.to))
  }

  constructor(
    element: HTMLElement,
    readonly session: NotaSession,
    private readonly options: VisualEditorOptions,
  ) {
    if (options.labels) setLabels(options.labels)
    this.diagrams = { render: options.renderDiagram, theme: options.diagramTheme ?? (() => 'light'), views: new Set() }
    const doc = session.doc
    const items = this.metaShape(doc, diagramItems(doc, layoutItems(readLayout(doc))), true)
    const nums = itemNumbers(items)
    const pm = schema.nodes.doc!.create(
      null,
      items.map((it, i) => projectItem(doc, it, nums[i])),
    )
    this.map = new PosMap(doc, items, pm)
    this.commands = {
      toggleMark: (m) => this.toggleMark(m),
      setLink: (t) => this.setLink(t),
      removeLink: () => this.removeLink(),
      setTextColor: (r) => this.setColorOf(TEXT_COLOR_ROLES, r),
      setFill: (r) => this.setColorOf(FILL_ROLES, r),
      setBlockType: (t, l) => this.setBlockType(t, l, false),
      toggleBlockType: (t, l) => this.setBlockType(t, l, true),
      splitBlock: () => this.splitBlock(),
      insertBreak: () => this.insertBreak(),
      deleteBackward: () => this.deleteBackward(),
      deleteForward: () => this.deleteForward(),
      undo: () => this.session.undo({ origin: this }),
      redo: () => this.session.redo({ origin: this }),
      toggleList: (k) => this.toggleList(k),
      indentListItem: () => this.indentList(1),
      outdentListItem: () => this.indentList(-1),
      setChecked: (c, o) => this.setChecked(c, o),
      setAdmonitionType: (v) => this.setAdmonitionType(v),
      toggleCollapsible: (o) => this.toggleCollapsible(o),
      indentCode: (d) => this.indentCode(d),
      setCodeLanguage: (l) => this.setCodeLanguage(l),
      insertBlock: (k, o) => this.insertKind(k, o ?? {}),
      dismissSlash: () => this.dismissSlash(),
      pastePlain: (text) => this.pasteText(text.replace(/\r\n?/g, '\n')),
      insertRow: () => this.insertRow(),
      insertColumn: () => this.insertColumn(),
      deleteRow: () => this.deleteRow(),
      deleteColumn: () => this.deleteColumn(),
      mergeCells: () => this.mergeSelected(),
      splitCell: () => this.splitMerged(),
      splitCells: () => this.keepingCells(() => this.splitMergedCells()),
      setCellAlign: (h, v) => this.keepingCells(() => this.setCellAlignOf(h, v)),
      clearCells: () => this.keepingCells(() => this.clearCellsOf()),
      deleteSelectedRows: () => this.deleteSelectedLines('row'),
      deleteSelectedColumns: () => this.deleteSelectedLines('col'),
      setCellFill: (r) => this.keepingCells(() => this.setCellFillOf(r)),
      toggleHeader: () => this.keepingCells(() => this.toggleHeader()),
      nestTable: () => this.nestHere(),
      deleteTable: () => this.deleteHere(),
      nextCell: (d) => this.nextCell(d),
      moveBlock: (at, to) => this.apply({ kind: 'moveBlock', at, to }),
      deleteBlockAt: (at) => this.apply({ kind: 'deleteBlock', at }),
      setBlockTitle: (at, title) => this.setBlockLine(at, 'caption', title),
      setBlockAnchor: (at, id) => this.setBlockLine(at, 'anchor', id),
    }
    const state = EditorState.create({
      schema,
      doc: pm,
      plugins: [
        keymapPlugin(
          () => this.commands,
          () => this.listAt() !== null,
          () => this.codeAt() !== null,
          () => this.currentTable() !== null,
        ),
        new Plugin({
          props: {
            handleTextInput: (_view, from, to, text) => this.onTextInput(from, to, text),
            handlePaste: (_view, event) => this.onPaste(event),
            handleDrop: () => true,
            handleClickOn: (view, _pos, node, nodePos, event, direct) =>
              direct && node.type === schema.nodes.inline_chip
                ? this.caretBesideChip(view, node, nodePos, event)
                : false,
            handleKeyDown: (_view, event) => this.onKeyDown(event),
            handleDOMEvents: {
              // a click on a checkbox or on the title of a collapsible block is not a move of the cursor
              mousedown: (_view, event) => this.onMouseDown(event as MouseEvent),
              mousemove: (_view, event) => this.onMouseMove(event as MouseEvent),
              compositionstart: () => (this.startComposition(), false),
              compositionend: () => (this.endComposition(), false),
              // an input method that lost its end (the window changed under it) does not hold the session out for good
              blur: () => (this.endComposition(), false),
              beforeinput: (_view, event) => this.onBeforeInput(event as InputEvent),
              cut: (_view, event) => this.onCut(event as ClipboardEvent),
              dragstart: (_view, event) => (event.preventDefault(), true),
            },
          },
        }),
        new Plugin({
          key: RANGE_MARKS,
          state: {
            init: () => DecorationSet.empty,
            // the marks go with the text while it is typed; the ranges that come after bring them to what the text says
            apply: (tr, set) => {
              if (tr.docChanged) set = set.map(tr.mapping, tr.doc)
              const change = tr.getMeta(RANGE_MARKS) as RangeChange | undefined
              if (!change) return set
              if (set === DecorationSet.empty) return DecorationSet.create(tr.doc, change.add)
              return set.remove(change.remove).add(tr.doc, change.add)
            },
          },
          props: { decorations: (s) => RANGE_MARKS.getState(s) },
        }),
        new Plugin({ props: { decorations: () => this.boxDecorations() } }),
        new Plugin({ props: { decorations: (s) => this.codeDecorations(s.doc) } }),
        new Plugin({ props: { decorations: (s) => this.anchorDecorations(s.doc) } }),
        new Plugin({ props: { decorations: () => this.tableDecorations(), attributes: () => this.cellsAttributes() } }),
        new Plugin({ props: { decorations: (s) => this.editingDecoration(s) } }),
        new Plugin({ view: () => ({ update: () => this.grips?.refresh() }) }),
        ...(options.plugins ?? []),
      ],
    })
    this.view = new EditorView(element, {
      state,
      dispatchTransaction: (tr) => this.dispatch(tr),
      nodeViews: {
        image: (node) => new ImageView(node, options.images),
        table: (node, view) => new TableNodeView(node, view.dom.ownerDocument),
        diagram: (node, view, getPos) => new DiagramView(node, view, getPos as () => number | undefined, this.diagrams),
      },
    })
    this.grips = new TableGrips(this.gripHost())
    // a collapsible block that is open from the start of the file
    this.openVersion = 1
    this.startOutsideClosedBox()
    this.unsubscribe = session.subscribe((e) => this.onSession(e))
    // (the button can be let go outside the editor)
    element.ownerDocument.addEventListener('mouseup', this.onMouseUp)
  }

  getText(): string {
    return this.session.text
  }
  focus(): void {
    this.view.focus()
  }

  markFillTarget(on: boolean): void {
    if (this.destroyed || this.fillTarget === on) return
    this.fillTarget = on
    this.view.dispatch(this.view.state.tr.setMeta(CELLS, true))
  }

  /** How far the host's capsules cover the top of the scroller (px, 0 until `setScrollMarginTop`): the top of the visible text is below that. */
  private coverTop = 0

  setScrollMarginTop(px: number): void {
    if (this.destroyed) return
    const top = Math.max(5, Math.round(px))
    this.coverTop = top
    const current = this.view.someProp('scrollMargin') as { top: number } | number | undefined
    if (typeof current === 'object' && current.top === top) return
    // The threshold is the same as the margin: ProseMirror starts to scroll only when the cursor is above the edge plus the
    // threshold, and a cursor under the capsule is still below the edge of the scroller.
    this.view.setProps({
      scrollMargin: { top, right: 5, bottom: 5, left: 5 },
      scrollThreshold: { top, right: 0, bottom: 0, left: 0 },
    })
  }

  setSelectionAtOffset(anchor: number, head?: number): void {
    if (this.destroyed) return
    const m = this.map
    const length = this.session.text.length
    const a = Math.max(0, Math.min(anchor, length))
    const h = head === undefined ? a : Math.max(0, Math.min(head, length))
    const state = this.view.state
    const pa = this.posAtOffset(m, a)
    const ph = this.posAtOffset(m, h)
    if (pa === null || ph === null) return
    const selection: Selection = between(state.doc, pa, ph)
    this.view.dispatch(state.tr.setSelection(selection).setMeta(OWN, true))
  }

  /** The element that scrolls the editor: the nearest ancestor that can scroll, else the page. */
  private scroller(): HTMLElement {
    for (let el = this.view.dom.parentElement; el; el = el.parentElement) {
      const overflow = el.ownerDocument.defaultView?.getComputedStyle(el).overflowY
      if (overflow === 'auto' || overflow === 'scroll') return el
    }
    return this.view.dom.ownerDocument.documentElement
  }

  scrollToOffset(offset: number, where: 'start' | 'nearest' = 'nearest'): void {
    if (this.destroyed) return
    const m = this.map
    const at = m.itemAt(Math.max(0, Math.min(offset, this.session.text.length)))
    const pos = at.cell === null ? m.starts[at.index]! : m.posOf(at.index, at.cell)
    const scroller = this.scroller()
    let box: { top: number; bottom: number }
    try {
      box = at.cell === null ? this.blockRect(at.index) : this.view.coordsAtPos(pos)
    } catch {
      return
    }
    const area = scroller.getBoundingClientRect()
    const top = area.top + this.coverTop
    const height = area.bottom - top
    if (where === 'start') scroller.scrollTop += box.top - top
    else if (box.top < top || box.bottom > area.bottom)
      scroller.scrollTop += box.top - top - Math.max(0, (height - (box.bottom - box.top)) / 2)
  }

  private blockRect(index: number): { top: number; bottom: number } {
    const dom = this.view.nodeDOM(this.map.starts[index]!) as HTMLElement | null
    if (!dom || typeof dom.getBoundingClientRect !== 'function') throw new RangeError('no block')
    return dom.getBoundingClientRect()
  }

  // ------------------------------------------------------------------ the handle of a block

  private blocksCache: { doc: NotaDocument; blocks: readonly TopBlock[] } | null = null

  /** The blocks of the top level and of the sections of the text now (read again when the text is another). */
  private topBlocks(): readonly TopBlock[] {
    const doc = this.map.doc
    if (this.blocksCache?.doc !== doc) this.blocksCache = { doc, blocks: topBlocks(doc) }
    return this.blocksCache.blocks
  }

  /** Runs an operation of the engine on the block and writes the result as one step of the history. */
  private apply(op: Operation): boolean {
    if (this.destroyed || this.composing) return false
    const r = this.operate(op)
    if (!r) return false
    if (r.changes.length === 0) return true
    this.write(r.changes, { origin: this })
    this.sync(this.session.doc, 'keep')
    return true
  }

  /** The line `.Title` or `[[id]]` of a block: written, changed or taken away with one small replacement. */
  private setBlockLine(at: number, which: 'caption' | 'anchor', value: string | null): boolean {
    if (this.destroyed || this.composing) return false
    const doc = this.map.doc
    const blocks = this.topBlocks()
    const tb = blocks.find((b) => b.from === at)
    if (!tb) return this.fail(null, 'invalid-target', 'There is no block here to work on')
    const v = (value ?? '').trim().replace(/\s+/g, ' ')
    if (which === 'anchor' && v !== '' && !/^[\p{L}_][\p{L}\p{N}_-]*$/u.test(v))
      return this.fail(null, 'bad-anchor', 'An anchor is one word: letters, digits, “-” and “_”, no spaces')
    const line = tb[which]
    let change: Change | null = null
    if (v === '') change = line ? { from: line.from, to: line.to, insert: '' } : null
    else if (!line || line.text !== v) {
      const eol = doc.text.includes('\r\n') ? '\r\n' : '\n'
      change = line
        ? { from: line.textFrom, to: line.textTo, insert: v }
        : { from: tb.body, to: tb.body, insert: (which === 'caption' ? `.${v}` : `[[${v}]]`) + eol }
    }
    if (!change) return true
    const after = doc.update([change])
    const again = topBlocks(after)
    const got = again.find((b) => b.from === at)?.[which]?.text ?? ''
    if (got !== v || again.length !== blocks.length)
      return this.fail(null, which === 'anchor' ? 'bad-anchor' : 'bad-caption', 'That cannot be written over the block')
    const dups = (d: NotaDocument): number => d.diagnostics.filter((x) => x.code === 'duplicate-id').length
    if (which === 'anchor' && v !== '' && dups(after) > dups(doc))
      return this.fail(null, 'duplicate-anchor', 'Another block already has this anchor')
    this.write([change], { origin: this })
    this.sync(this.session.doc, 'keep')
    return true
  }

  /** The block, its items on the screen, and where it is. */
  private spotOf(tb: TopBlock): BlockSpot {
    const items = this.map.items
    let lo = 0
    let hi = items.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (items[mid]!.to <= tb.from) lo = mid + 1
      else hi = mid
    }
    const mine: Item[] = []
    let firstIndex = -1
    let rect: { top: number; right: number; bottom: number; left: number } | null = null
    for (let i = lo; i < items.length && items[i]!.from < tb.to; i++) {
      const it = items[i]!
      if (it.kind === 'empty') continue
      if (firstIndex < 0) firstIndex = i
      mine.push(it)
      let x: DOMRect
      try {
        x = (this.view.nodeDOM(this.map.starts[i]!) as HTMLElement).getBoundingClientRect()
      } catch {
        continue
      }
      rect = rect
        ? { top: Math.min(rect.top, x.top), bottom: Math.max(rect.bottom, x.bottom), left: Math.min(rect.left, x.left), right: Math.max(rect.right, x.right) }
        : { top: x.top, bottom: x.bottom, left: x.left, right: x.right }
    }
    if (rect && rect.top === 0 && rect.bottom === 0 && rect.left === 0 && rect.right === 0) rect = null
    const first = mine[0]
    let sort: BlockSort = 'paragraph'
    if (tb.section || tb.kind === 'heading') sort = 'heading'
    else if (mine.some((i) => i.block?.fence === 'open' && i.block.box === 'collapsible')) sort = 'collapsible'
    else if (mine.some((i) => i.block?.fence === 'open' && i.block.box === 'admonition') || first?.block?.variant) sort = 'admonition'
    else if (first?.kind === 'code' || first?.kind === 'image' || first?.kind === 'table') sort = first.kind
    else if (first?.kind === 'chip') sort = 'island'
    else if (first?.kind === 'item') sort = 'list'
    let frameTop: number | null = null
    if (sort === 'table' && rect && firstIndex >= 0) {
      try {
        const frame = (this.view.nodeDOM(this.map.starts[firstIndex]!) as HTMLElement).querySelector(':scope > .tbl-scroll')
        if (frame) frameTop = frame.getBoundingClientRect().top
      } catch {
        frameTop = null
      }
    }
    return { offset: tb.from, end: tb.end, sort, section: tb.section, caption: tb.caption?.text ?? null, anchor: tb.anchor?.text ?? null, rect, frameTop }
  }

  blockAtOffset(offset: number): BlockSpot | null {
    const blocks = this.topBlocks()
    let lo = 0
    let hi = blocks.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (blocks[mid]!.from <= offset) lo = mid + 1
      else hi = mid
    }
    const tb = blocks[lo - 1]
    return tb && (offset < tb.to || offset === tb.from) ? this.spotOf(tb) : null
  }

  blockAt(x: number, y: number): BlockSpot | null {
    if (this.destroyed) return null
    let pos: { pos: number } | null
    try {
      pos = this.view.posAtCoords({ left: x, top: y })
    } catch {
      return null
    }
    if (!pos) return null
    const index = this.map.locate(pos.pos, this.view.state.doc).index
    const it = this.map.items[index]
    return it && it.kind !== 'empty' ? this.blockAtOffset(it.from) : null
  }

  dropSlots(section: boolean): readonly DropSlot[] {
    const blocks = this.topBlocks()
    const text = this.map.doc.text
    // right after a block: the blank line that follows it, else its last character (the line break counts as after)
    const stop = (e: number): number => (blankAfter(text, e) ? e : text[e - 1] === '\n' ? e - 1 : e)
    const after = (b: TopBlock): number => stop(b.end)
    const rects = blocks.map((b) => this.spotOf(b).rect)
    const slots: DropSlot[] = []
    let above: number | null = null
    let last = -1
    blocks.forEach((b, i) => {
      const r = rects[i]
      if (!r) return
      if (!section || b.section) {
        // (right under a title that holds this subsection: the line after the title, not the end of the whole section)
        const prev = last >= 0 ? blocks[last]! : null
        const to = !section && b.section && prev ? (prev.section && prev.end > b.from ? (blankAfter(text, prev.to) ? prev.to : b.from) : after(prev)) : b.from
        slots.push({ to, y: above === null ? r.top - 2 : (above + r.top) / 2 })
      }
      above = r.bottom
      last = i
    })
    if (last >= 0) slots.push({ to: after(blocks[last]!), y: above! + 2 })
    return slots
  }

  topVisibleOffset(fraction = 0): number {
    const items = this.map.items
    if (items.length === 0) return 0
    const box = this.scroller().getBoundingClientRect()
    const top = box.top + this.coverTop + fraction * Math.max(0, box.height - this.coverTop)
    // the blocks lie one under another, so the first one that ends below the top edge is found by halving (a measure of
    // every block of a long document costs milliseconds); a block with no size means no layout: then the scan is the plain one
    try {
      let lo = 0
      let hi = items.length - 1
      let plain = false
      while (lo < hi) {
        const mid = (lo + hi) >> 1
        const r = this.blockRect(mid)
        if (r.top === 0 && r.bottom === 0) {
          plain = true
          break
        }
        if (r.bottom > top + 1) hi = mid
        else lo = mid + 1
      }
      if (!plain) {
        const r = this.blockRect(lo)
        if (r.top === 0 && r.bottom === 0) return items[0]!.from
        // (nothing ends below the top edge: the last block)
        return items[lo]!.from
      }
    } catch {
      return items[0]!.from
    }
    for (let i = 0; i < items.length; i++) {
      try {
        const r = this.blockRect(i)
        // (a block with no size: nothing is laid out, the editor is hidden or has no layout)
        if (r.top === 0 && r.bottom === 0) return items[0]!.from
        if (r.bottom > top + 1) return items[i]!.from
      } catch {
        return items[0]!.from
      }
    }
    return items[items.length - 1]!.from
  }

  setRanges(ranges: readonly TextRange[]): void {
    if (this.destroyed) return
    this.lastRanges = ranges
    const state = this.view.state
    const have = RANGE_MARKS.getState(state) ?? DecorationSet.empty
    const want = this.rangeMarks(ranges)
    // the marks that are on the screen and the marks that are wanted are put side by side, place by place: only the
    // places that differ are changed. Marks of one place are in the order of the ranges (when several of them
    // reach the same node, the one made last gives its `title`), so a place is kept only when its marks are the
    // same ones in the same order, and otherwise taken off whole and made again.
    const left = new Map<string, Decoration[]>()
    for (const d of have.find()) {
      const key = `${d.from}:${d.to}`
      const list = left.get(key)
      if (list) list.push(d)
      else left.set(key, [d])
    }
    const wanted = new Map<string, RangeMark[]>()
    for (const m of want) {
      const key = `${m.from}:${m.to}`
      const list = wanted.get(key)
      if (list) list.push(m)
      else wanted.set(key, [m])
    }
    const add: Decoration[] = []
    const remove: Decoration[] = []
    for (const [key, marks] of wanted) {
      const kept = left.get(key)
      if (kept && kept.length === marks.length) {
        const order = [...kept].sort((x, y) => (x.spec as { seq: number }).seq - (y.spec as { seq: number }).seq)
        // (two marks with one `seq` — places that moved onto each other — have no order to trust: made again)
        if (
          order.every(
            (d, i) =>
              (d.spec as { look: string }).look === marks[i]!.look &&
              (i === 0 || (d.spec as { seq: number }).seq !== (order[i - 1]!.spec as { seq: number }).seq),
          )
        ) {
          left.delete(key)
          continue
        }
      }
      marks.forEach((m, seq) => {
        const spec = { look: m.look, seq }
        add.push(m.node ? Decoration.node(m.from, m.to, m.attrs, spec) : Decoration.inline(m.from, m.to, m.attrs, spec))
      })
    }
    for (const list of left.values()) remove.push(...list)
    // nothing changed: no transaction, no new look for the view
    if (add.length === 0 && remove.length === 0) return
    const change: RangeChange = { remove, add }
    this.view.dispatch(state.tr.setMeta(OWN, true).setMeta(RANGE_MARKS, change))
  }

  /** The marks of `ranges`: inline in a block of text, the whole plate for a plate. */
  private rangeMarks(ranges: readonly TextRange[]): RangeMark[] {
    const doc = this.view?.state.doc
    if (!doc || ranges.length === 0) return []
    const m = this.map
    const length = this.session.text.length
    const out: RangeMark[] = []
    const push = (from: number, to: number, node: boolean, r: TextRange): void => {
      const attrs: Record<string, string> = {
        class: 'diag',
        title: r.message,
        ...(r.severity ? { 'data-severity': r.severity } : {}),
      }
      out.push({ from, to, node, attrs, look: `${node ? 'n' : 'i'}\u0000${r.severity ?? ''}\u0000${r.message}` })
    }
    for (const r of ranges) {
      const from = Math.max(0, Math.min(r.from, length))
      const to = Math.max(from, Math.min(r.to, length))
      const a = m.itemAt(from)
      const b = m.itemAt(to)
      if (a.index >= m.starts.length) continue
      const item = m.items[a.index]!
      if (item.kind === 'chip' || item.kind === 'code' || item.kind === 'image' || item.kind === 'table') {
        const start = m.starts[a.index]!
        push(start, start + doc.child(a.index).nodeSize, true, r)
        continue
      }
      if (a.index !== b.index || a.cell === null || b.cell === null) {
        // a stretch across blocks marks the block it starts in, as far as the block goes
        if (a.cell === null) continue
        const start = m.posOf(a.index, a.cell)
        const end = m.starts[a.index]! + doc.child(a.index).nodeSize - 1
        if (end > start) push(start, end, false, r)
        continue
      }
      const pa = m.posOf(a.index, a.cell)
      let pb = m.posOf(b.index, b.cell)
      const end = m.starts[a.index]! + doc.child(a.index).nodeSize - 1
      // (a stretch of markup that shows nothing is marked at the next sign)
      if (pb <= pa) pb = Math.min(pa + 1, end)
      if (pb > pa) push(pa, pb, false, r)
    }
    return out
  }

  redrawDiagrams(): void {
    for (const v of this.diagrams.views) v.redraw()
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.unsubscribe()
    this.view.dom.ownerDocument.removeEventListener('mouseup', this.onMouseUp)
    this.grips?.destroy()
    if (this.dragTimer !== null) clearTimeout(this.dragTimer)
    this.drag = null
    this.view.destroy()
  }

  /**
   * A click on an inline plate puts the caret at the edge of the plate nearer to the click. The plate is not selected as a
   * whole: a selected node has no caret, and the browser would put its own selection inside a `contenteditable=false` span.
   */
  private caretBesideChip(view: EditorView, node: PMNode, nodePos: number, event: MouseEvent): boolean {
    const dom = view.nodeDOM(nodePos) as HTMLElement | null
    if (!dom || dom.nodeType !== 1) return false
    const rect = dom.getBoundingClientRect()
    const pos = event.clientX < rect.left + rect.width / 2 ? nodePos : nodePos + node.nodeSize
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)))
    if (!view.hasFocus()) view.focus()
    return true
  }

  // ------------------------------------------------------------------ what comes in

  /** Every transaction of the view comes here. */
  private dispatch(tr: Transaction): void {
    const view = this.view
    // (the cells that were selected stay selected only while the cursor and the text stay)
    if (this.cellSel && this.drag?.moved && !tr.docChanged && tr.selectionSet && !tr.getMeta(CELLS) && !tr.getMeta(OWN)) {
      // (the browser moves its own selection across the cells while the button is down: it does not undo the cells)
      this.refresh()
      return
    }
    if (this.cellSel && (tr.docChanged || tr.selectionSet) && !tr.getMeta(CELLS)) this.cellSel = null
    if (this.refused && (tr.docChanged || tr.selectionSet)) this.refused = null
    if (!tr.docChanged || tr.getMeta(OWN) || this.composing) {
      // a composition shows what is typed; the text hears of it when the composition ends
      this.show(view.state.apply(tr), !tr.docChanged && !tr.getMeta(OWN))
      return
    }
    const edit = textEdit(tr)
    if (!edit || !this.textEdit(edit, tr)) this.refresh()
  }

  /** The screen is what the text says: whatever else the browser or a plugin did to it is undone. */
  private refresh(): void {
    this.view.updateState(this.view.state)
  }

  /** The text of a refusal: the one of the tab (`messages`), else the English one, with the `{name}` places filled. */
  private rejectText(code: string, message: string, params: Readonly<Record<string, string>> = {}): string {
    let text = this.options.messages?.[code] ?? message
    for (const [k, v] of Object.entries(params)) text = text.split(`{${k}}`).join(v)
    return text
  }

  private fail(op: Operation | null, code: string, message: string, params: Readonly<Record<string, string>> = {}): false {
    const text = this.rejectText(code, message, params)
    this.options.onReject?.(text, { code, message: text, operation: op })
    this.refusals++
    this.refresh()
    return false
  }

  /** How many refusals were told (`fail`): a paste that raised the count was refused, whatever its path returned. */
  private refusals = 0

  /**
   * Runs one way of pasting and says whether it was refused: it returned false, or a refusal was told while it ran
   * (`pasteText` returns true when `write()` refuses, or `onPaste` would paste the text once more).
   */
  private refusedBy(paste: () => unknown): boolean {
    const before = this.refusals
    const result = paste()
    return result === false || this.refusals !== before
  }

  /** Runs an operation on the text of the document; null (with the refusal told) when it is refused. */
  private operate(op: Operation, run: (doc: NotaDocument) => ApplyResult = (d) => applyOperation(d, op)): Extract<ApplyResult, { doc: NotaDocument }> | null {
    const r = run(this.map.doc)
    if ('error' in r) {
      this.fail(op, r.error, r.diagnostics[0]?.message ?? r.error)
      return null
    }
    if (this.flipsByteOrderMark(r.doc)) {
      this.failByteOrderMark(op)
      return null
    }
    return r
  }

  /** The edit would make a character of the text the byte order mark of the file (or the mark a character): the mark is not shown. */
  private flipsByteOrderMark(next: NotaDocument): boolean {
    return next.text.startsWith('﻿') !== this.map.doc.text.startsWith('﻿')
  }

  /**
   * The one place where the editor writes to the text of the session: an edit that would make a character of the text the byte
   * order mark of the file (or the mark a character) is refused here, whatever path it came by (typing, paste, composition…).
   */
  private write(...args: Parameters<NotaSession['apply']>): boolean {
    const [changes, options] = args
    const text = this.session.doc.text
    let head = ''
    let pos = 0
    for (const c of [...changes].sort((a, b) => a.from - b.from)) {
      if (head.length > 0) break
      head += text.slice(pos, c.from) + c.insert
      pos = c.to ?? c.from
    }
    if (head.length === 0) head = text.slice(pos, pos + 1)
    if (head.startsWith('﻿') !== text.startsWith('﻿')) {
      this.failByteOrderMark(null)
      return false
    }
    this.session.apply(changes, options)
    return true
  }

  private failByteOrderMark(op: Operation | null): false {
    return this.fail(op, 'byte-order-mark', 'The edit would make a character of the text the byte order mark of the file')
  }

  // ------------------------------------------------------------------ text typed and deleted

  private onTextInput(from: number, to: number, text: string): boolean {
    if (this.composing) return false
    // (a typed character goes to the cell with the cursor, and the cells are let go)
    this.cellSel = null
    const st = this.view.state
    const $from = st.doc.resolve(from)
    const marks =
      st.storedMarks ?? (from === to ? $from.marks() : $from.marksAcross(st.doc.resolve(to))) ?? []
    if (!this.textEdit({ from, to, text, marks }, null)) this.refresh()
    return true
  }

  /**
   * A replacement of `from`–`to` with plain text, from a transaction (taken as the new state when the text reads
   * as it says) or from a typed key. False when the edit is refused.
   */
  private textEdit(edit: TextEdit, tr: Transaction | null): boolean {
    const { map } = this
    const doc = this.view.state.doc
    const a = map.locate(edit.from, doc)
    const b = map.locate(edit.to, doc)
    const it = map.items[a.index]!
    // code, a caption, an island: the text is the source as it is
    if (a.index === b.index && a.where === 'in' && b.where === 'in' && isVerbatim(it))
      return this.verbatimEdit(a.index, a.cell, b.cell, edit.text)
    // text in a cell of a table: the text of the cell is written by the operation on tables
    if (it.kind === 'table' && a.index === b.index && a.where === 'in' && b.where === 'in') return this.tableTextEdit(a.index, edit, tr !== null)
    // text typed into an item or a heading that is only started: it is written with the first sign
    if (this.draft && a.index === draftIndex(this.draft)) return edit.text === '' ? true : this.typeInDraft(edit.text)
    // a space after a list marker or a heading marker typed into an empty paragraph: the item or heading is started
    if (!tr && edit.text === ' ' && a.index === b.index && a.where === 'in' && b.where === 'in' && this.startFromMarker(a.index)) return true
    if (
      a.where === 'in' &&
      b.where === 'in' &&
      a.index === b.index &&
      isTextItem(it)
    ) {
      // (a marker of more than one character, `1.` or `==`, is typed in more than one step: the first one began in an empty paragraph)
      const prior = this.typedInEmpty && this.typedInEmpty.doc === this.session.doc ? this.typedInEmpty : null
      const done = this.inlineEdit(a.index, a.cell, b.cell, edit, tr)
      this.typedInEmpty =
        done && prior !== null && prior.index === a.index && edit.from === edit.to && edit.text !== ''
          ? { doc: this.session.doc, index: a.index }
          : null
      if (this.typedInEmpty) this.typedAt = Date.now()
      return done
    }
    // a transaction of another source that reaches over blocks is not the editor's to write; plain text put into
    // an empty paragraph is typing
    if (tr && !(a.index === b.index && a.where === 'in' && b.where === 'in' && it.kind === 'empty'))
      return false
    // a space after a list marker or a heading marker typed into an empty paragraph: the item or heading is started
    if (edit.text === ' ' && a.index === b.index && a.where === 'in' && this.startFromMarker(a.index)) return true
    // text typed over a plate: the plate is not text, and is not replaced by it (Backspace takes it away)
    if (
      edit.text !== '' &&
      edit.from !== edit.to &&
      ((map.items[a.index]!.kind === 'fence' && (a.index === b.index || edit.to === edit.from + 1)) ||
        (isVerbatim(map.items[a.index]!) &&
          edit.from === map.starts[a.index] &&
          edit.to === edit.from + this.view.state.doc.child(a.index).nodeSize))
    )
      return this.fail(
        null,
        'not-editable',
        'This block is edited in the source; select it and press Backspace to remove it',
      )
    // typed over a selection of several blocks, or into an empty paragraph: the general way
    const from = this.startOffset(edit.from)
    const to = this.endOffset(edit.to)
    if (from === null || to === null)
      return this.fail(
        null,
        'not-editable',
        'This part of the document is not edited here; edit it in the source',
      )
    const end = Math.max(from, to)
    if (edit.text === '' && from === end) return true
    const around = this.outsideMeta(from, end)
    if (around) {
      // typed over a range that holds the header of the page: the header stays, the rest is replaced
      if (around.length === 0) return true
      return this.replaceAroundMeta(around, edit.text === '' ? [] : edit.text.split(/\r\n|\r|\n/))
    }
    const op: Operation =
      edit.text === ''
        ? { kind: 'deleteRange', from, to: end }
        : {
            kind: 'replaceText',
            from,
            to: end,
            text: edit.text,
            // a step of another source puts in text, not marks
            marks: { add: tr ? [] : markNames(edit.marks.map((m) => m.type.name)) },
          }
    const r = this.operate(op)
    if (!r) return false
    if (r.changes.length === 0) return true
    // text that a block would be read as a part of a plate with (a header entry, say) is not typed here, as in one
    // block: the cursor has no place in a plate, and the next key would land in some other block
    if (
      edit.text !== '' &&
      !isVerbatim(it) &&
      it.kind !== 'fence' &&
      isPlateKind(layoutItems(readLayout(r.doc)).find((x) => x.from <= from && from < x.to)?.kind)
    )
      return this.fail(
        op,
        'becomes-plate',
        'That would turn this text into a block that is edited in the source (a list, a code block, …)',
      )
    if (r.literal === false) this.options.onInexact?.(op)
    this.write(r.changes, { origin: this })
    // the cursor is after what was typed, in the block where the range began (a change of the text does not say where
    // the typed text ends: the same text can be put in at more than one place)
    const cursor = mapOffset(r.changes, end, 1)
    const startCell = a.where === 'in' ? a.cell : null
    const wasEmpty = it.kind === 'empty' && a.index === b.index
    this.sync(
      this.session.doc,
      (m) =>
        (startCell === null ? null : this.cursorAt(m, a.index, startCell + edit.text.length)) ??
        this.posAtOffset(m, cursor),
    )
    // (a marker typed here may be followed by a space: that starts an item or a heading)
    this.typedInEmpty = wasEmpty && edit.text !== '' ? { doc: this.session.doc, index: a.index } : null
    if (this.typedInEmpty) this.typedAt = Date.now()
    return true
  }

  /** The position of a cell of a paragraph, a heading or an empty paragraph; null for a plate or a place that is not there. */
  private cursorAt(m: PosMap, index: number, cell: number): number | null {
    const it = m.items[index]
    if (!it || it.kind === 'fence' || it.kind === 'table') return null
    if (isVerbatim(it)) return m.posOf(index, Math.min(cell, m.verbLength(index)))
    return m.posOf(index, Math.min(cell, it.kind === 'empty' ? 0 : m.reading(index)!.cells.length))
  }

  /** A change of text inside one paragraph or heading: cells `k0`–`k1` replaced with plain text. */
  private inlineEdit(index: number, k0: number, k1: number, edit: TextEdit, tr: Transaction | null): boolean {
    const { map } = this
    const doc = map.doc
    const block = map.items[index]!.block!
    const reading = map.reading(index)!
    const cells = reading.cells
    let op: Operation
    let anchor: number
    if (k0 === k1) {
      if (edit.text === '') return true
      const c = chooseOffset(block, reading, k0, edit.marks)
      const marks: TypedMarks = { add: markNames(c.add), remove: markNames(c.remove) }
      op = { kind: 'insertText', at: c.at, text: edit.text, marks }
      anchor = c.at
    } else {
      const from = k0 < cells.length ? cells[k0]!.from : block.content!.to
      const to = cells[k1 - 1]!.to
      anchor = to
      op =
        edit.text === ''
          ? { kind: 'deleteRange', from, to }
          : {
              kind: 'replaceText',
              from,
              to,
              text: edit.text,
              marks: { add: markNames(chooseOffset(block, reading, k0, edit.marks).add) },
            }
    }
    const t0 = this.options.timing ? performance.now() : 0
    const r = this.operate(op)
    if (!r) return false
    if (r.changes.length === 0) {
      // nothing to write (a blank at the start of a block, say): the screen goes back to the text
      this.refresh()
      return true
    }
    // text that the editor cannot show as text (a list, a code block: written with these characters) is not typed,
    // and a deletion that leaves such text is refused too (a block without any text is an empty paragraph, not a plate)
    const now = editableBlockAt(r.doc, block.from)
    if ((!now || now.kind !== block.kind || now.variant !== block.variant) && (edit.text !== '' || becomesPlate(r.doc, block.from, block)))
      return this.fail(
        op,
        'becomes-plate',
        'That would turn this text into a block that is edited in the source (a list, a code block, …)',
      )
    // a blank that starts the block (after a checkbox, say) and that the written text cannot start with is dropped by the
    // operation without a word: the person is told, as for any text that does not read as it was typed
    const blanksBefore = startingBlanks(cells)
    const lostBlanks =
      edit.text !== '' && now?.content && k0 >= blanksBefore
        ? Math.max(0, blanksBefore - startingBlanks(readInline(r.doc, now.content.from, now.content.to).cells))
        : 0
    if (r.literal === false || lostBlanks > 0) this.options.onInexact?.(op)
    this.write(r.changes, { origin: this })
    const newDoc = this.session.doc
    const delta = newDoc.text.length - doc.text.length
    // (the cells of the new reading start fewer blanks earlier, when a blank was dropped)
    const cursor = k0 + edit.text.length - lostBlanks
    const info = editableBlockAt(newDoc, block.from)
    this.options.timing?.(performance.now() - t0)
    if (
      r.literal !== false &&
      info &&
      info.kind === block.kind &&
      info.level === block.level &&
      info.to === block.to + delta &&
      // a line that decides which lines exist (a conditional, an include) is read before the blocks: what it does to the
      // blocks below is not the block's own business, and the rebuild reads all of them
      !hasDirective(doc.text.slice(block.from, block.to)) &&
      !hasDirective(newDoc.text.slice(info.from, info.to)) &&
      // an entry set or a counter stepped inside a line changes how the blocks below are read: the rebuild compares them
      !setsEntry(doc.text.slice(block.from, block.to)) &&
      !setsEntry(newDoc.text.slice(info.from, info.to))
    ) {
      this.replaceBlock(index, info, delta, cursor, tr)
      return true
    }
    const after = mapOffset(r.changes, anchor, 1)
    this.sync(newDoc, (m) => this.cursorAt(m, index, cursor) ?? this.posAtOffset(m, after))
    return true
  }

  /** The block `index` is the same block after the edit: check its node, and shift the map. */
  private replaceBlock(
    index: number,
    info: BlockInfo,
    delta: number,
    cursor: number,
    tr: Transaction | null,
  ): void {
    const { map } = this
    const view = this.view
    const newDoc = this.session.doc
    const item: Item = { ...map.items[index]!, to: info.to, block: info }
    const cur = tr ? view.state.apply(tr) : view.state
    // (the number of an item does not change with its text)
    const num = (cur.doc.child(index).attrs.num as string | undefined) ?? ''
    const node = projectItem(newDoc, item, num)
    let state = cur
    if (!cur.doc.child(index).eq(node)) {
      const start = map.starts[index]!
      const t = cur.tr.replaceWith(start, start + cur.doc.child(index).nodeSize, node)
      t.setSelection(TextSelection.create(t.doc, start + 1 + cursor)).setMeta(OWN, true)
      state = cur.apply(t)
    }
    const items = map.items.slice()
    const keys = map.keys.slice()
    items[index] = item
    keys[index] = itemKey(newDoc, item, item.kind === 'item' ? num : '')
    for (let i = index + 1; i < items.length; i++) {
      const it = items[i]!
      items[i] = { ...it, from: it.from + delta, to: it.to + delta, block: shiftBlock(it.block, delta) }
    }
    this.map = new PosMap(newDoc, items, state.doc, keys)
    this.show(state, false)
  }

  // ------------------------------------------------------------------ code, captions, islands

  /** The text of a node of code, a caption or an island as it is on the screen (it is not the file's while an island holds text that was not written). */
  private verbText(index: number): string {
    return this.view.state.doc.child(index).textContent
  }

  /** The selection when it lies in the text of one node of code, a caption or an island: the node and the characters it spans. */
  private verbatimSel(): { index: number; k0: number; k1: number } | null {
    const st = this.view.state
    if (st.doc.childCount !== this.map.starts.length || st.selection instanceof NodeSelection) return null
    const a = this.map.locate(st.selection.from, st.doc)
    const b = this.map.locate(st.selection.to, st.doc)
    if (a.index !== b.index || a.where !== 'in' || b.where !== 'in') return null
    return isVerbatim(this.map.items[a.index]!) ? { index: a.index, k0: a.cell, k1: b.cell } : null
  }

  /** Characters `k0`–`k1` of the text of a node of code, a caption or an island become `text`. */
  private verbatimEdit(index: number, k0: number, k1: number, text: string): boolean {
    const it = this.map.items[index]!
    const old = this.verbText(index)
    const typed = it.kind === 'image' ? text.replace(/\s*(?:\r\n|\r|\n)\s*/g, ' ') : text.replace(/\r\n|\r/g, '\n')
    if (k0 === k1 && typed === '') return true
    const next = old.slice(0, k0) + typed + old.slice(k1)
    const cursor = k0 + typed.length
    return this.commitVerbatim(index, next, cursor, cursor)
  }

  /**
   * The text of a node of code, a caption or an island is `text` now: the operation writes it, and the node is the text as the file
   * reads it. An island that cannot be written (it would change the blocks around it) keeps the text on the screen, with a note;
   * code and a caption that cannot be written are refused.
   */
  private commitVerbatim(index: number, text: string, anchor: number, head: number, group = true): boolean {
    const it = this.map.items[index]!
    // a diagram: the whole block is written, with the delimiters as long as the code needs
    if (it.kind === 'chip' && it.block!.label === DIAGRAM) return this.commitDiagram(index, text, anchor, head, group)
    const op: Operation =
      it.kind === 'code'
        ? { kind: 'setCodeText', at: it.from, text }
        : it.kind === 'image'
          ? { kind: 'setCaption', at: it.from, text }
          : { kind: 'setIslandText', at: it.from, text, to: it.to }
    const r = applyOperation(this.map.doc, op)
    if ('error' in r) {
      if (it.kind === 'chip') return this.keepUnsaved(index, text, anchor, head)
      return this.fail(op, r.error, r.diagnostics[0]?.message ?? r.error)
    }
    // an edit that would turn a character of the island into the file's own byte order mark (or the mark into a character) is
    // refused: the mark is not shown, so the character would vanish from the screen and the text on it would not be what was typed
    if (this.flipsByteOrderMark(r.doc)) return this.failByteOrderMark(op)
    const delta = r.doc.text.length - this.map.doc.text.length
    if (r.changes.length > 0) this.write(r.changes, group ? { origin: this } : { origin: this, group: false })
    // (an island that starts with a byte order mark is not held: the mark is not a character of the island on the screen, which is
    // the text of the file after its own mark, so the held island would not tell the mark that is the text's from the file's)
    this.pin = it.kind === 'chip' && !text.startsWith('﻿') ? { from: it.from, to: it.to + delta, unsaved: false } : null
    this.sync(this.session.doc, (m, doc) => {
      const a = this.cursorAt(m, index, anchor)
      const h = this.cursorAt(m, index, head)
      return a === null || h === null ? null : between(doc, a, h)
    })
    return true
  }

  /** The code of a diagram is `code` now: the block is written whole (the delimiters grow when a line of the code is as long as they are). */
  private commitDiagram(index: number, code: string, anchor: number, head: number, group: boolean): boolean {
    const it = this.map.items[index]!
    const whole = diagramSource(this.map.doc.text, it, code)
    if (!whole) return false
    const op: Operation = { kind: 'setIslandText', at: it.from, text: whole.source, to: it.to }
    const r = applyOperation(this.map.doc, op)
    if ('error' in r) return this.keepUnsaved(index, whole.source, anchor + whole.prefix, head + whole.prefix)
    const delta = r.doc.text.length - this.map.doc.text.length
    if (r.changes.length > 0) this.write(r.changes, group ? { origin: this } : { origin: this, group: false })
    this.pin = { from: it.from, to: it.to + delta, unsaved: false }
    this.sync(this.session.doc, (m, doc) => {
      const a = this.cursorAt(m, index, anchor)
      const h = this.cursorAt(m, index, head)
      return a === null || h === null ? null : between(doc, a, h)
    })
    return true
  }

  /** The text typed in an island is not written: it stays on the screen, the island is marked, and the file is as it was. */
  private keepUnsaved(index: number, text: string, anchor: number, head: number): boolean {
    const it = this.map.items[index]!
    const state = this.view.state
    const node = state.doc.child(index)
    const start = this.map.starts[index]!
    const island = schema.nodes.island!.create({ kind: node.attrs.kind ?? 'DelimitedBlock', unsaved: true }, text === '' ? null : schema.text(text))
    const tr = state.tr.replaceWith(start, start + node.nodeSize, island).setMeta(OWN, true)
    const size = Math.min(text.length, Math.max(anchor, head))
    tr.setSelection(between(tr.doc, start + 1 + Math.min(anchor, size), start + 1 + Math.min(head, size)))
    this.pin = { from: it.from, to: it.to, unsaved: true }
    const keys = this.map.keys.slice()
    keys[index] = keys[index]!.replace(/~[up]$/, '') + '~u'
    this.map = new PosMap(this.map.doc, this.map.items, tr.doc, keys, this.map.cellDraft)
    this.typedInEmpty = null
    this.show(state.apply(tr), false)
    return true
  }

  /** Tab / Shift-Tab in code. */
  private indentCode(direction: 1 | -1): boolean {
    const v = this.verbatimSel()
    if (!v || this.map.items[v.index]!.kind !== 'code') return false
    const old = this.verbText(v.index)
    if (direction === 1 && v.k0 === v.k1)
      return this.commitVerbatim(v.index, old.slice(0, v.k0) + '  ' + old.slice(v.k1), v.k0 + 2, v.k0 + 2, false)
    const starts: number[] = []
    let s = old.lastIndexOf('\n', v.k0 - 1) + 1
    const last = v.k1 > v.k0 && old[v.k1 - 1] === '\n' ? v.k1 - 1 : v.k1
    for (;;) {
      starts.push(s)
      const nx = old.indexOf('\n', s)
      if (nx < 0 || nx >= last) break
      s = nx + 1
    }
    let out = ''
    let at = 0
    const removed: number[] = []
    for (const st of starts) {
      out += old.slice(at, st)
      if (direction === 1) {
        out += '  '
        at = st
      } else {
        let n = 0
        while (n < 2 && old[st + n] === ' ') n++
        removed.push(n)
        at = st + n
      }
    }
    out += old.slice(at)
    if (direction === -1 && removed.every((n) => n === 0)) return true
    const map = (p: number, strict: boolean): number => {
      if (direction === 1) return p + 2 * starts.filter((x) => (strict ? x < p : x <= p)).length
      let shift = 0
      starts.forEach((x, i) => (shift += Math.min(Math.max(p - x, 0), removed[i]!)))
      return p - shift
    }
    return this.commitVerbatim(v.index, out, map(v.k0, true), map(v.k1, false), false)
  }

  codeAt(): CodeState | null {
    const st = this.view.state
    if (st.doc.childCount !== this.map.starts.length || st.selection instanceof NodeSelection) return null
    const loc = this.map.locate(st.selection.head, st.doc)
    const it = this.map.items[loc.index]
    if (!it || it.kind !== 'code' || loc.where !== 'in') return null
    return { language: it.block!.lang }
  }

  private setCodeLanguage(language: string): boolean {
    const st = this.view.state
    if (st.doc.childCount !== this.map.starts.length) return false
    const it = this.map.items[this.map.locate(st.selection.head, st.doc).index]
    if (!it || it.kind !== 'code') return false
    const op: Operation = { kind: 'setCodeLanguage', at: it.from, language }
    const r = this.operate(op)
    if (!r) return false
    if (r.changes.length === 0) return true
    this.write(r.changes, { origin: this, group: false })
    this.sync(this.session.doc, 'keep')
    return true
  }

  private anchorCache: { doc: PMNode; set: DecorationSet } | null = null

  /**
   * a block with an anchor (`[#id]`, `[[id]]` above it) gets an empty widget with the id in `data-id`; the CSS
   * draws it as a compact plate when the host asks for it and hides it else. The id stays in the file, the widget holds no text.
   */
  private anchorDecorations(doc: PMNode): DecorationSet {
    if (this.anchorCache?.doc === doc) return this.anchorCache.set
    const out: Decoration[] = []
    doc.forEach((node, offset) => {
      const id = node.attrs.anchor as string | null | undefined
      if (!id) return
      out.push(
        Decoration.widget(
          // before the block, not inside it: the service lines are drawn by `::before` of the block, the plate stands over them, and over the whole admonition
          offset,
          () => {
            const el = document.createElement('div')
            el.className = 'nota-anchor'
            el.contentEditable = 'false'
            el.dataset.id = id
            // the tip: a caption in the UI font over the whole id in monospace, drawn by the CSS of its two pseudo-elements
            const tip = document.createElement('span')
            tip.className = 'anchor-tip'
            tip.dataset.tip = getLabels().anchorTip
            tip.dataset.id = id
            el.append(tip)
            return el
          },
          { side: -1, key: `anchor:${id}:${getLabels().anchorTip}`, ignoreSelection: true },
        ),
      )
    })
    const set = out.length ? DecorationSet.create(doc, out) : DecorationSet.empty
    this.anchorCache = { doc, set }
    return set
  }

  /** The colours of the code: what the host's highlighter says of the text of every block of code that has a language of the list. */
  private codeDecorations(doc: PMNode): DecorationSet {
    const highlight = this.options.highlightCode
    if (!highlight) return DecorationSet.empty
    const out: Decoration[] = []
    doc.forEach((node, offset) => {
      if (node.type !== schema.nodes.code_block || node.content.size === 0) return
      const id = canonicalLanguage(node.attrs.lang as string)
      if (!id || id === 'text') return
      let ranges = this.highlightCache.get(node)
      if (!ranges) {
        ranges = highlight(id, node.textContent)
        this.highlightCache.set(node, ranges)
      }
      for (const r of ranges)
        if (r.to > r.from && r.to <= node.content.size)
          out.push(Decoration.inline(offset + 1 + r.from, offset + 1 + r.to, { class: r.class }))
    })
    return DecorationSet.create(doc, out)
  }

  // ------------------------------------------------------------------ the menu of «/», blocks put in

  slashAt(): SlashState | null {
    const st = this.view.state
    if (!st.selection.empty || st.doc.childCount !== this.map.starts.length) return null
    const loc = this.map.locate(st.selection.head, st.doc)
    const it = this.map.items[loc.index]
    if (!it || it.kind !== 'paragraph' || loc.where !== 'in' || this.draft) return null
    const b = it.block!
    const node = st.doc.child(loc.index)
    const plain = node.childCount === 1 && node.firstChild!.isText && node.firstChild!.marks.length === 0
    const match = !b.meta && !b.variant && plain ? /^\/(.{0,40})$/.exec(node.textContent) : null
    if (!match) {
      if (this.slashDismissed === it.from) this.slashDismissed = null
      return null
    }
    if (this.slashDismissed === it.from) return null
    let rect: SlashState['rect']
    try {
      const c = this.view.coordsAtPos(st.selection.head)
      rect = { top: c.top, left: c.left, bottom: c.bottom }
    } catch {
      rect = null
    }
    return { query: match[1]!, offset: it.from, rect }
  }

  private dismissSlash(): boolean {
    const s = this.slashAt()
    if (!s) return false
    this.slashDismissed = s.offset
    this.view.dispatch(this.view.state.tr.setMeta(OWN, true))
    return true
  }

  /** The block of a menu: in the place of the paragraph of «/» or the empty paragraph that holds the cursor, else after the block that holds the cursor. */
  private insertKind(kind: InsertKind, opts: InsertOptions): boolean {
    this.leaveDraft()
    const st = this.view.state
    if (st.doc.childCount !== this.map.starts.length) return false
    const slash = this.slashAt()
    const idx = this.map.locate(st.selection.head, st.doc).index
    const it = this.map.items[idx]
    if (!it) return false
    const replacing = slash !== null || it.kind === 'empty'
    if (kind !== 'table' && kind !== 'code' && kind !== 'image' && kind !== 'mermaid') return this.startDraftBlock(kind, opts, idx, slash !== null)
    let block: BlockSpec
    if (kind === 'table') {
      const row = ['', '', '']
      block = { kind: 'table', rows: [row, row, row], header: true }
    } else if (kind === 'code') block = { kind: 'listing', text: '', language: 'text' }
    else if (kind === 'mermaid') block = { source: diagramSample(getLabels().diagramSample), expect: 'literal' }
    else {
      if (!opts.path) return false
      block = { kind: 'image', target: opts.path }
    }
    const at = replacing || it.kind === 'table' ? it.from : (this.pointOffset(st.selection.head) ?? it.from)
    const op: Operation = { kind: 'placeBlock', at, block, replace: slash !== null }
    const r = this.operate(op)
    if (!r) return false
    if (r.changes.length > 0) this.write(r.changes, { origin: this, group: false })
    const target = replacing ? idx : blockEnd(this.map.items, idx) + 1
    this.sync(this.session.doc, (m) => {
      const x = m.items[Math.min(target, m.items.length - 1)]
      if (!x) return null
      return isVerbatim(x) ? this.cursorAt(m, Math.min(target, m.items.length - 1), x.block!.label === DIAGRAM ? m.verbLength(Math.min(target, m.items.length - 1)) : 0) : m.posOf(Math.min(target, m.items.length - 1), 0)
    })
    return true
  }

  /** A block that is written with its first letter: an empty paragraph takes it, as a draft, until then. */
  private startDraftBlock(kind: InsertKind, opts: InsertOptions, idx: number, slash: boolean): boolean {
    const it = this.map.items[idx]!
    let host = idx
    if (slash) {
      const b = it.block!
      const op: Operation = { kind: 'deleteRange', from: b.content!.from, to: b.content!.to }
      const r = this.operate(op)
      if (!r) return false
      const again = layoutItems(readLayout(r.doc))
      if (again.length !== this.map.items.length || again[idx]?.kind !== 'empty') return false
      this.write(r.changes, { origin: this, group: false })
      this.sync(this.session.doc, (m) => m.posOf(idx, 0))
    } else if (it.kind !== 'empty' && this.map.items[blockEnd(this.map.items, idx) + 1]?.kind === 'empty') {
      // an empty paragraph follows the block that holds the cursor: it is the place
      host = blockEnd(this.map.items, idx) + 1
    } else if (it.kind !== 'empty') {
      // after the block that holds the cursor (the whole list, the whole table): nothing is written until the first letter, the line is only on the screen
      host = blockEnd(this.map.items, idx) + 1
      const virtuals: Record<string, Draft> = {
        ...Object.fromEntries(
          HEADING_KINDS.map(([k, lv]): [string, Draft] => [k, { mode: 'start', at: host, virtual: true, kind: 'heading', level: lv, ordered: false, check: false, prefix: '='.repeat(lv) + ' ' }]),
        ),
        unordered: { mode: 'start', at: host, virtual: true, kind: 'item', level: 1, ordered: false, check: false, prefix: '* ' },
        ordered: { mode: 'start', at: host, virtual: true, kind: 'item', level: 1, ordered: true, check: false, prefix: '. ' },
        checklist: { mode: 'start', at: host, virtual: true, kind: 'item', level: 1, ordered: false, check: true, prefix: '* [ ] ' },
        admonition: { mode: 'start', at: host, virtual: true, kind: 'admonition', level: 0, ordered: false, check: false, prefix: 'NOTE: ' },
        collapsible: { mode: 'start', at: host, virtual: true, kind: 'collapsible', level: 0, ordered: false, check: false, prefix: '', title: opts.title },
      }
      const d = virtuals[kind]
      if (!d) return false
      this.draft = d
      this.sync(this.session.doc, (m) => m.posOf(draftIndex(d), 0))
      return true
    }
    if (this.map.items[host]?.kind !== 'empty') return false
    const base = { mode: 'start', at: host, ordered: false, check: false } as const
    const drafts: Record<string, Draft> = {
      ...Object.fromEntries(HEADING_KINDS.map(([k, lv]): [string, Draft] => [k, { ...base, kind: 'heading', level: lv, prefix: '='.repeat(lv) + ' ' }])),
      unordered: { ...base, kind: 'item', level: 1, prefix: '* ' },
      ordered: { ...base, kind: 'item', level: 1, ordered: true, prefix: '. ' },
      checklist: { ...base, kind: 'item', level: 1, check: true, prefix: '* [ ] ' },
      admonition: { ...base, kind: 'admonition', level: 0, prefix: 'NOTE: ' },
      collapsible: { ...base, kind: 'collapsible', level: 0, prefix: '', title: opts.title },
    }
    const d = drafts[kind]
    if (!d) return false
    this.draft = d
    this.sync(this.session.doc, (m) => m.posOf(draftIndex(d), 0))
    return true
  }

  // ------------------------------------------------------------------ tables

  /** The table the cursor is in (the innermost one): the item it is shown as and the place in it. */
  private tablePlace(pos?: number): { index: number; loc: TableLoc } | null {
    const st = this.view.state
    if (st.doc.childCount !== this.map.starts.length || (pos === undefined && st.selection instanceof NodeSelection)) return null
    const at = pos ?? st.selection.head
    if (at < 0 || at > st.doc.content.size) return null
    const l = this.map.locate(at, st.doc)
    if (l.where !== 'in') return null
    const view = this.map.tableView(l.index)
    if (!view) return null
    const loc = resolveTable(st.doc, at, view, this.map.starts[l.index]!)
    return loc ? { index: l.index, loc } : null
  }

  private currentTable(): { index: number; loc: TableLoc } | null {
    return this.tablePlace()
  }

  /** The table of the item `index`, or the one in a cell of it that the steps lead to. */
  private viewIn(m: PosMap, index: number, host: readonly Step[]): TableView | null {
    let v = m.tableView(index)
    for (const s of host) {
      const b: CellBlock | undefined = v?.rows[s.row]?.[s.cell]?.blocks[s.block]
      v = b && b.kind === 'table' ? b.table : null
    }
    return v
  }

  /** The rectangle of the grid that two clicked squares span, grown until it cuts no merged cell. */
  private gridRect(view: TableView, a: Sq, b: Sq): { row: number; col: number; rows: number; cols: number } {
    let r0 = Math.min(a.row, b.row)
    let c0 = Math.min(a.col, b.col)
    let r1 = Math.max(a.row + a.rowspan, b.row + b.rowspan)
    let c1 = Math.max(a.col + a.colspan, b.col + b.colspan)
    for (let changed = true; changed; ) {
      changed = false
      for (const row of view.rows)
        for (const c of row) {
          const cr = c.row + c.rowspan
          const cc = c.column + c.colspan
          if (c.row >= r1 || cr <= r0 || c.column >= c1 || cc <= c0) continue
          if (c.row < r0) {
            r0 = c.row
            changed = true
          }
          if (cr > r1) {
            r1 = cr
            changed = true
          }
          if (c.column < c0) {
            c0 = c.column
            changed = true
          }
          if (cc > c1) {
            c1 = cc
            changed = true
          }
        }
    }
    return { row: r0, col: c0, rows: r1 - r0, cols: c1 - c0 }
  }

  /** The cells that lie in a rectangle of the grid. */
  private cellsIn(view: TableView, g: { row: number; col: number; rows: number; cols: number }): CellView[] {
    const out: CellView[] = []
    for (const row of view.rows)
      for (const c of row)
        if (c.row >= g.row && c.row + c.rowspan <= g.row + g.rows && c.column >= g.col && c.column + c.colspan <= g.col + g.cols)
          out.push(c)
    return out
  }

  /** The table under the cursor and what the panel of tables needs of it. */
  tableAt(): TableState | null {
    const p = this.tablePlace()
    if (!p) return null
    const { loc } = p
    const cells = this.targetCells(p)
    const lines = this.linesOf(p)
    const selected = cells.length > 1
    const fills = new Set(cells.map((c) => c.fill))
    return {
      level: loc.view.level,
      header: loc.view.headRows > 0,
      merged: loc.cell.colspan > 1 || loc.cell.rowspan > 1,
      selected,
      span: spanOf(loc.cell.colspan, loc.cell.rowspan),
      fill: fills.size === 1 ? [...fills][0]! : null,
      cells: cells.length,
      mixedFill: fills.size > 1,
      selectedRows: lines?.kind === 'row' ? lines.to - lines.from + 1 : 0,
      selectedCols: lines?.kind === 'col' ? lines.to - lines.from + 1 : 0,
      selection: selected ? this.selectionOf(p) : null,
      rect: this.domRect(loc.nodePos),
    }
  }

  /** The cells a command of the panel goes to: the selected ones (Shift-click), else the one that holds the cursor. */
  private targetCells(p: { index: number; loc: TableLoc }): CellView[] {
    const s = this.cellSel
    if (s && s.index === p.index) {
      const v = this.viewIn(this.map, s.index, s.host)
      const inside = v ? this.cellsIn(v, this.gridRect(v, s.a, s.b)) : []
      if (inside.length > 1) return inside
    }
    return [p.loc.cell]
  }

  /** The fill of the cell, or of all the selected cells, in one step of the history. */
  private setCellFillOf(role: string | null): boolean {
    const p = this.tablePlace()
    if (!p) return false
    let doc = this.map.doc
    let changes: Change[] = []
    // (from the last cell to the first: the places of the others do not move)
    for (const c of [...this.targetCells(p)].sort((a, b) => b.contentFrom - a.contentFrom)) {
      const op: Operation = { kind: 'setCellFill', at: c.contentFrom, role }
      const r = applyOperation(doc, op)
      if ('error' in r) {
        if (r.error === 'unsupported')
          return this.fail(op, 'cell-fill-refused', 'This cell cannot be filled: the label of the fill would show in the text of the cell')
        return this.fail(op, r.error, r.diagnostics[0]?.message ?? r.error)
      }
      changes = composeChanges(changes, r.changes as Change[])
      doc = r.doc
    }
    if (this.flipsByteOrderMark(doc)) return this.failByteOrderMark(null)
    if (changes.length === 0) return true
    this.write(changes, { origin: this, group: false })
    this.sync(this.session.doc, this.keepSpot(p.index, p.loc))
    return true
  }

  // ------------------------------------------------------------------ the commands of the capsule of selected cells

  /** The grid and the cells of the selection of two cells or more in the table the cursor is in; null otherwise. */
  private selRect(p: { index: number; loc: TableLoc }): { v: TableView; g: { row: number; col: number; rows: number; cols: number }; inside: CellView[] } | null {
    const s = this.cellSel
    if (!s || s.index !== p.index || JSON.stringify(s.host) !== JSON.stringify(p.loc.host)) return null
    const v = this.viewIn(this.map, s.index, s.host)
    if (!v) return null
    const g = this.gridRect(v, s.a, s.b)
    const inside = this.cellsIn(v, g)
    return inside.length > 1 ? { v, g, inside } : null
  }

  private selectionOf(p: { index: number; loc: TableLoc }): CellSelectionState | null {
    const r = this.selRect(p)
    if (!r) return null
    const { v, g, inside } = r
    const text = (code: string, message: string, params?: Readonly<Record<string, string>>): CellRefusal => ({ code, text: this.rejectText(code, message, params) })
    const first = inside.find((c) => c.row === g.row && c.column === g.col) ?? inside[0]!
    const merge = this.mergeRefusal(v, g, inside, first)
    const want = v.headRows === 0
    const headOff = want && v.rows[0]?.some((c) => c.rowspan > 1)
    const empty = inside.every(cellIsEmpty)
    const rows = this.deleteRefusal(v, { kind: 'row', from: g.row, to: g.row + g.rows - 1 })
    const cols = this.deleteRefusal(v, { kind: 'col', from: g.col, to: g.col + g.cols - 1 })
    const h = new Set(inside.map((c) => c.halign))
    const va = new Set(inside.map((c) => c.valign))
    return {
      row: g.row,
      col: g.col,
      rows: g.rows,
      cols: g.cols,
      merged: inside.some((c) => c.colspan > 1 || c.rowspan > 1),
      firstRow: g.row === 0,
      halign: h.size === 1 ? [...h][0]! : null,
      valign: va.size === 1 ? [...va][0]! : null,
      empty,
      refusals: {
        merge: merge ? text(merge.code, merge.message) : null,
        header: headOff ? text('head-rowspan', 'The first row has a cell merged over rows: it cannot be the head') : null,
        clear: empty ? text('cells-empty', 'The cells are empty already') : null,
        deleteRows: rows ? text(rows.code, rows.message, rows.params) : null,
        deleteColumns: cols ? text(cols.code, cols.message, cols.params) : null,
      },
    }
  }

  /**
   * Runs a command that does not change the grid of the table: the cells that were selected stay selected (`sync` lets go of them). Where the
   * table changed its form (rows or columns came or went), they are let go, as the risk of a wrong frame is worse than none.
   */
  private keepingCells(run: () => boolean): boolean {
    const s = this.cellSel
    const before = s ? this.viewIn(this.map, s.index, s.host) : null
    const dims = before ? { rows: before.nrows, cols: before.ncols, n: this.view.state.doc.childCount } : null
    const ok = run()
    if (!ok || !s || !dims || this.cellSel !== null) return ok
    const now = this.viewIn(this.map, s.index, s.host)
    if (!now || now.nrows !== dims.rows || now.ncols !== dims.cols || this.view.state.doc.childCount !== dims.n) return ok
    this.cellSel = s
    this.view.dispatch(this.view.state.tr.setMeta(OWN, true).setMeta(CELLS, true))
    return ok
  }

  /** One operation for each of the cells a command goes to, in one step of the history; `make` gives null for a cell that stays as it is. */
  private cellsStep(p: { index: number; loc: TableLoc }, cells: readonly CellView[], make: (c: CellView) => Operation | null): boolean {
    let doc = this.map.doc
    let changes: Change[] = []
    // (from the last cell to the first: the places of the others do not move)
    for (const c of [...cells].sort((a, b) => b.from - a.from)) {
      const op = make(c)
      if (!op) continue
      const r = applyOperation(doc, op)
      if ('error' in r) return this.fail(op, r.error, r.diagnostics[0]?.message ?? r.error)
      changes = composeChanges(changes, r.changes as Change[])
      doc = r.doc
    }
    if (this.flipsByteOrderMark(doc)) return this.failByteOrderMark(null)
    if (changes.length === 0) return true
    this.write(changes, { origin: this, group: false })
    this.sync(this.session.doc, this.keepSpot(p.index, p.loc))
    return true
  }

  private setCellAlignOf(horizontal?: CellHAlign, vertical?: CellVAlign): boolean {
    const p = this.tablePlace()
    if (!p || (horizontal === undefined && vertical === undefined)) return false
    return this.cellsStep(p, this.targetCells(p), (c) => ({ kind: 'setCellAlign', at: c.from, ...(horizontal ? { halign: horizontal } : {}), ...(vertical ? { valign: vertical } : {}) }))
  }

  private clearCellsOf(): boolean {
    const p = this.tablePlace()
    if (!p) return false
    const cells = this.targetCells(p)
    if (cells.every(cellIsEmpty)) return this.fail(null, 'cells-empty', 'The cells are empty already')
    // (the label of the fill is a part of the text of the cell: it stays)
    return this.cellsStep(p, cells, (c) => (cellIsEmpty(c) ? null : { kind: 'setCellText', at: c.from, text: c.fill ? `[.${c.fill}]##{empty}##` : '' }))
  }

  /** Every merged cell among the selected ones (else the one under the cursor) becomes cells; each part gets the fill of its cell. One step. */
  private splitMergedCells(): boolean {
    const p = this.tablePlace()
    if (!p) return false
    const { loc, index } = p
    const merged = this.targetCells(p).filter((c) => c.colspan > 1 || c.rowspan > 1)
    if (merged.length === 0) return this.fail(null, 'split-single', 'Only a merged cell can be split')
    let doc = this.map.doc
    let changes: Change[] = []
    let inexact: Operation | null = null
    // (from the last cell to the first: the places of the others do not move)
    for (const c of [...merged].sort((a, b) => b.contentFrom - a.contentFrom)) {
      const op: Operation = { kind: 'splitCell', at: c.contentFrom }
      const r = applyOperation(doc, op)
      if ('error' in r) return this.fail(op, r.error, r.diagnostics[0]?.message ?? r.error)
      if (r.literal === false) inexact = op
      changes = composeChanges(changes, r.changes as Change[])
      doc = r.doc
    }
    // the fills: the parts that have none get that of the cell they came from
    const filled = merged.filter((c) => c.fill !== null)
    if (filled.length > 0) {
      let view: TableView | null = tableViewAt(doc, this.map.items[index]!.from)
      for (const s of loc.host) {
        const b: CellBlock | undefined = view?.rows[s.row]?.[s.cell]?.blocks[s.block]
        view = b && b.kind === 'table' ? b.table : null
      }
      const parts = (view?.rows ?? [])
        .flat()
        .map((c) => ({ c, from: filled.find((m) => c.row >= m.row && c.row < m.row + m.rowspan && c.column >= m.column && c.column < m.column + m.colspan) }))
        .filter((x) => x.from && x.c.fill === null)
        .sort((a, b) => b.c.contentFrom - a.c.contentFrom)
      for (const { c, from } of parts) {
        const op: Operation = { kind: 'setCellFill', at: c.contentFrom, role: from!.fill }
        const f = applyOperation(doc, op)
        if ('error' in f) return this.fail(op, f.error, f.diagnostics[0]?.message ?? f.error)
        changes = composeChanges(changes, f.changes as Change[])
        doc = f.doc
      }
    }
    if (this.flipsByteOrderMark(doc)) return this.failByteOrderMark(null)
    if (inexact) this.options.onInexact?.(inexact)
    this.write(changes, { origin: this, group: false })
    this.sync(this.session.doc, (m) => this.spotIn(m, index, loc.host, loc.cell.row, loc.cell.column, 'end'))
    return true
  }

  /** The rows, or the columns, that the rectangle of the selected cells spans (else those of the cell under the cursor) go. */
  private deleteSelectedLines(kind: 'row' | 'col'): boolean {
    const p = this.tablePlace()
    if (!p) return false
    const r = this.selRect(p)
    if (!r) return kind === 'row' ? this.deleteRow() : this.deleteColumn()
    return this.deleteLines(p, kind === 'row' ? { kind, from: r.g.row, to: r.g.row + r.g.rows - 1 } : { kind, from: r.g.col, to: r.g.col + r.g.cols - 1 })
  }

  private domRect(pos: number): TableState['rect'] {
    try {
      const dom = this.view.nodeDOM(pos) as HTMLElement | null
      if (!dom || typeof dom.getBoundingClientRect !== 'function') return null
      const r = dom.getBoundingClientRect()
      return { top: r.top, right: r.right, bottom: r.bottom, left: r.left }
    } catch {
      return null
    }
  }

  /** The cells that Shift-click selected are drawn as selected. */
  private tableDecorations(): DecorationSet {
    const s = this.cellSel
    const doc = this.view?.state.doc
    if (this.fillTarget && doc && !this.tableAt()?.selected) {
      // the cell with the cursor
      const $head = doc.resolve(this.view.state.selection.head)
      for (let d = $head.depth; d > 0; d--) {
        if ($head.node(d).type.name === 'table_cell') {
          const at = $head.before(d)
          return DecorationSet.create(doc, [Decoration.node(at, at + $head.node(d).nodeSize, { class: 'fill-target' })])
        }
      }
    }
    if (!s || !doc || doc.childCount !== this.map.starts.length) return DecorationSet.empty
    const view = this.viewIn(this.map, s.index, s.host)
    const t = view ? followSteps(doc.child(s.index), this.map.starts[s.index]!, s.host) : null
    if (!view || !t) return DecorationSet.empty
    const g = this.gridRect(view, s.a, s.b)
    const out: Decoration[] = []
    t.node.forEach((row, rowOff) =>
      row.forEach((cell, cellOff) => {
        const a = cell.attrs as { row: number; col: number; rowspan: number; colspan: number }
        if (a.row < g.row || a.row + a.rowspan > g.row + g.rows || a.col < g.col || a.col + a.colspan > g.col + g.cols) return
        const pos = t.pos + 1 + rowOff + 1 + cellOff
        // (the frame of the block is drawn by the cells on its edge)
        const edges =
          (a.row === g.row ? ' e-t' : '') +
          (a.row + a.rowspan === g.row + g.rows ? ' e-b' : '') +
          (a.col === g.col ? ' e-l' : '') +
          (a.col + a.colspan === g.col + g.cols ? ' e-r' : '')
        // (the corners of the table, by the grid and not by the place in <tr>: a cell can start in a row above)
        const top = a.row === 0
        const bottom = a.row + a.rowspan === view.nrows
        const left = a.col === 0
        const right = a.col + a.colspan === view.ncols
        const corners =
          (top && left ? ' c-tl' : '') + (top && right ? ' c-tr' : '') + (bottom && left ? ' c-bl' : '') + (bottom && right ? ' c-br' : '')
        out.push(Decoration.node(pos, pos + cell.nodeSize, { class: 'sel' + edges + corners, 'aria-selected': 'true' }))
      }),
    )
    return DecorationSet.create(doc, out)
  }

  /** Two cells or more are selected (or being selected by dragging): no caret and no selection of the text show in them. */
  private cellsAttributes(): Record<string, string> {
    const cls: string[] = []
    if (this.drag?.moved && !this.drag.ended) cls.push('cells-drag')
    const s = this.cellSel
    if (s && this.view && this.view.state.doc.childCount === this.map.starts.length) {
      const v = this.viewIn(this.map, s.index, s.host)
      if (v && this.cellsIn(v, this.gridRect(v, s.a, s.b)).length > 1) cls.push('cells-on')
    }
    return cls.length ? { class: cls.join(' ') } : {}
  }

  private squareOf(c: CellView): Sq {
    return { row: c.row, col: c.column, rowspan: c.rowspan, colspan: c.colspan }
  }

  /** The table and the cell that the DOM element of a cell stands for (the start of the cell is in the cell, also when it begins with a nested table). */
  private cellPlace(cellDom: Element): { index: number; loc: TableLoc } | null {
    try {
      return this.tablePlace(this.view.posAtDOM(cellDom, 0))
    } catch {
      return null
    }
  }

  /** The button is down in a cell: the cells are selected when the pointer comes to another cell of the table. */
  private startDrag(cellDom: Element): void {
    this.drag = null
    const q = this.cellPlace(cellDom)
    if (!q) return
    let pos: number
    try {
      pos = this.view.posAtDOM(cellDom, 0)
    } catch {
      return
    }
    this.drag = { index: q.index, host: q.loc.host, nodePos: q.loc.nodePos, a: this.squareOf(q.loc.cell), pos, moved: false, ended: false }
  }

  private onMouseMove(event: MouseEvent): boolean {
    const d = this.drag
    if (!d || d.ended) return false
    if (event.buttons === 0) {
      // (the button was let go where no `mouseup` came)
      this.endDrag()
      return false
    }
    const target = event.target as Element | null
    if (!target || typeof target.closest !== 'function') return d.moved
    // the cell of the table where it started: a cell with a nested table under the pointer stands for the whole cell
    let cell: Element | null = target.closest('td, th')
    let q: { index: number; loc: TableLoc } | null = null
    while (cell && this.view.dom.contains(cell)) {
      const p = this.cellPlace(cell)
      if (p && p.loc.nodePos === d.nodePos) {
        q = p
        break
      }
      cell = cell.parentElement ? cell.parentElement.closest('td, th') : null
    }
    if (d.moved) event.preventDefault()
    if (!q) return d.moved
    const b = this.squareOf(q.loc.cell)
    const view = this.view
    if (b.row === d.a.row && b.col === d.a.col) {
      // back in the first cell: the text is selected again
      if (d.moved) {
        d.moved = false
        this.cellSel = null
        view.dispatch(view.state.tr.setMeta(OWN, true).setMeta(CELLS, true))
      }
      return false
    }
    const old = this.cellSel
    if (d.moved && old && old.b.row === b.row && old.b.col === b.col) return true
    event.preventDefault()
    this.cellSel = { index: d.index, host: d.host, a: d.a, b }
    const tr = view.state.tr.setMeta(OWN, true).setMeta(CELLS, true)
    if (!d.moved) {
      d.moved = true
      // the cursor goes to the cell where it started, and the selection of the browser with it
      const here = view.state.selection.head
      const inFirst = this.tablePlace(here)
      const keep = inFirst && inFirst.loc.nodePos === d.nodePos && inFirst.loc.cell.row === d.a.row && inFirst.loc.cell.column === d.a.col
      tr.setSelection(keep ? TextSelection.create(view.state.doc, here) : TextSelection.near(view.state.doc.resolve(d.pos), 1))
    }
    view.dispatch(tr)
    return true
  }

  private endDrag(): void {
    const d = this.drag
    if (!d || d.ended) return
    if (!d.moved) {
      this.drag = null
      return
    }
    // (the editor hears the release after this, and reads the selection of the browser: that does not undo the cells either)
    d.ended = true
    if (!this.destroyed) this.view.dispatch(this.view.state.tr.setMeta(OWN, true).setMeta(CELLS, true))
    if (this.dragTimer !== null) clearTimeout(this.dragTimer)
    this.dragTimer = setTimeout(() => {
      this.dragTimer = null
      if (this.drag === d) this.drag = null
    }, 0)
  }

  /**
   * The offset of the text at a place of a table: in the text of a cell, in the cell; else at the start of the cell. `how`: see
   * `blockOffset` (where the text of the cell is read, one position stands for more than one offset).
   */
  private tableOffset(index: number, pos: number, how: 'point' | 'start' | 'end' = 'point'): number {
    const it = this.map.items[index]!
    const view = this.map.tableView(index)
    const loc = view ? resolveTable(this.view.state.doc, pos, view, this.map.starts[index]!) : null
    if (!loc) return it.from
    const b = loc.block !== null ? loc.cell.blocks[loc.block] : undefined
    if (b && b.kind === 'text' && b.draft) {
      // (an item that is only started has no place in the text: it is where the item before it ends)
      const prev = loc.cell.blocks[loc.block! - 1]
      return prev && prev.kind === 'text' ? blockRange(this.map.doc, loc.cell, prev).to : loc.cell.contentFrom
    }
    if (b && b.kind === 'text' && loc.offset !== null) return blockOffset(this.map.doc, loc.cell, b, loc.offset, how)
    return loc.cell.contentFrom
  }

  /** The place on the screen of an offset of the text in a table (the cell that holds it, and the text there). */
  private tablePosAt(m: PosMap, index: number, offset: number): number {
    const start = m.starts[index]!
    let v = m.tableView(index)
    const host: Step[] = []
    while (v) {
      let found: { c: CellView; r: number; k: number } | null = null
      for (let r = 0; r < v.rows.length; r++) {
        const row = v.rows[r]!
        for (let k = 0; k < row.length; k++) if (found === null || row[k]!.contentFrom <= offset) found = { c: row[k]!, r, k }
      }
      if (!found) break
      const { c, r, k } = found
      const nested = c.blocks.findIndex((b) => b.kind === 'table' && b.table.from <= offset && offset < b.table.to)
      const inner = nested >= 0 ? c.blocks[nested]! : null
      if (inner && inner.kind === 'table') {
        host.push({ row: r, cell: k, block: nested })
        v = inner.table
        continue
      }
      let bi = c.blocks.findIndex((b) => {
        if (b.kind !== 'text' || b.draft) return false
        const range = blockRange(m.doc, c, b)
        return range.from <= offset && offset <= range.to
      })
      if (bi < 0) bi = c.blocks.findIndex((b) => b.kind === 'text')
      const b = bi >= 0 ? c.blocks[bi]! : null
      if (!b || b.kind !== 'text') return this.spotIn(m, index, host, r, k, 'start', true) ?? start
      return textPlace(m.pm.child(index), start, host, r, k, bi, blockPosition(m.doc, c, b, offset)) ?? start
    }
    return start
  }

  /**
   * A place in a cell of a table: the table of the item `index` (`host`: the steps to a table in a cell), the cell that covers the
   * square (`row`, `col`) of the grid, or (`byIndex`) the `col`-th cell of the `row`-th row; the start or the end of its text.
   */
  private spotIn(
    m: PosMap,
    index: number,
    host: readonly Step[],
    row: number,
    col: number | 'first',
    at: 'start' | 'end',
    byIndex = false,
  ): number | null {
    const t = followSteps(m.pm.child(index), m.starts[index]!, host)
    if (!t) return null
    let c = col === 'first' ? cellAtIndex(t.node, t.pos, row, 0) : byIndex ? cellAtIndex(t.node, t.pos, row, col) : coveringCell(t.node, t.pos, row, col)
    if (!c) c = coveringCell(t.node, t.pos, row, 0)
    return c ? cellCursor(c.node, c.pos, at) : null
  }

  /** The cursor stays at the place it is in, in the table of the new text. */
  private keepSpot(index: number, loc: TableLoc): (m: PosMap) => number | null {
    return (m) =>
      loc.block !== null && loc.offset !== null
        ? textPlace(m.pm.child(index), m.starts[index]!, loc.host, loc.row, loc.cellIdx, loc.block, loc.offset)
        : this.spotIn(m, index, loc.host, loc.row, loc.cellIdx, 'end', true)
  }

  /**
   * Text typed, deleted or pasted in the text of a cell: written as the text of the cell, or (a cell whose text is read like a
   * paragraph) by the operations on text, as in a paragraph.
   */
  private tableTextEdit(index: number, edit: TextEdit, _fromTr: boolean): boolean {
    const st = this.view.state
    const view = this.map.tableView(index)
    if (!view) return false
    const top = this.map.starts[index]!
    const a = resolveTable(st.doc, edit.from, view, top)
    const b = resolveTable(st.doc, edit.to, view, top)
    const blk = a && a.block !== null ? a.cell.blocks[a.block] : undefined
    if (!a || !b || a.nodePos !== b.nodePos || a.row !== b.row || a.cellIdx !== b.cellIdx || a.block !== b.block)
      return this.fail(null, 'not-editable', 'This part of the document is not edited here; edit it in the source')
    if (blk && blk.kind === 'text' && blk.draft && this.cellDraft)
      return this.typeInCellDraft(index, a, edit.text.replace(/\s*(?:\r\n|\r|\n)\s*/g, ' '))
    if (!blk || blk.kind !== 'text' || a.offset === null || b.offset === null || a.block === null)
      return this.fail(null, 'not-editable', 'This part of the document is not edited here; edit it in the source')
    const cell = cellAtIndex(a.node, a.nodePos, a.row, a.cellIdx)
    if (!cell) return false
    const node = cell.node.child(a.block)
    // (a cell is one line)
    const typed = edit.text.replace(/\s*(?:\r\n|\r|\n)\s*/g, ' ')
    // a cell whose text is read like a paragraph: the text goes by the operations on text, unless nothing in it can be a link or a mark
    // (letters and blanks, to which letters and blanks are put: that stays the fast way, which writes the text of the cell)
    // a cell whose source has lines that Asciidoctor does not read as its text (a conditional directive, say) shows less than
    // the file holds: writing the text back would drop those lines. A one-line directive gives as many lines as its text
    // (and the cell then reads as plain text), so a line that is a directive is looked for as well
    const lines = (s: string): number => s.trim().split(/\r\n|\r|\n/).length
    const source = this.map.doc.text.slice(a.cell.contentFrom, a.cell.contentTo)
    if (lines(source) > lines(a.cell.text) || /^[ \t]*(?:ifn?def|ifeval|endif|include)::/m.test(source)) {
      if (typed !== '' || edit.from !== edit.to)
        return this.fail(null, 'not-editable', 'This cell has lines the screen does not show; edit it in the source')
    }
    if (blk.readable) {
      const rich =
        blk.reading !== null
          ? !typed.includes('|') || !blk.reading.cells.every(plainCell)
          : !SIMPLE_CELL.test((node.textContent.slice(0, a.offset) + typed + node.textContent.slice(b.offset)).replace(/\|/g, ''))
      if (rich) {
        // a bar in a cell with a link or a mark would end up escaped, and the cell would be shown as text: refused
        if (typed.includes('|'))
          return this.fail(null, 'cell-bar', 'A bar in a cell with a link or a mark is typed in Text mode: the cell would be shown as text')
        return this.readCellEdit(index, edit, a, b, blk, node, typed)
      }
    }
    const old = node.textContent
    const next = old.slice(0, a.offset) + typed + old.slice(b.offset)
    if (next === old) return true
    // the text of the cell in the file has no blank at its ends; what is typed there stays on the screen until a letter follows
    const whole = a.cell.text.slice(0, blk.from) + next + a.cell.text.slice(blk.to)
    const op: Operation = { kind: 'setCellText', at: a.cell.contentFrom, text: whole.trim() }
    const t0 = this.options.timing ? performance.now() : 0
    const r = this.operate(op)
    if (!r) return false
    if (r.literal === false) this.options.onInexact?.(op)
    const oldDoc = this.map.doc
    // (a cell with CRLF in the file keeps it: the operation gives LF, which the reread model is compared with)
    const crlf = oldDoc.text.slice(a.cell.contentFrom, a.cell.contentTo).includes('\r\n')
    const written = crlf ? r.changes.map((c) => ({ ...c, insert: c.insert.replace(/\n/g, '\r\n') })) : r.changes
    const delta = written.reduce((n, c) => n + c.insert.length - (c.to - c.from), 0)
    if (written.length > 0) this.write(written, { origin: this })
    this.options.timing?.(performance.now() - t0)
    // (a cell of several lines may be written in a way that makes it readable, and then it shows otherwise: the screen is made anew)
    // (and so is a cell that was not read: an empty cell of the style `a` is one, and the text typed in it makes it read)
    if (blk.text.includes('\n') || !blk.readable) {
      const cursor = a.offset + typed.length
      this.typedInEmpty = null
      this.sync(this.session.doc, (m) => textPlace(m.pm.child(index), m.starts[index]!, a.host, a.row, a.cellIdx, a.block!, cursor))
      return true
    }
    const newDoc = this.session.doc
    // what is on the screen: the text as typed, the cursor after it
    const tr = st.tr.insertText(typed, edit.from, edit.to)
    tr.setSelection(TextSelection.create(tr.doc, edit.from + typed.length)).setMeta(OWN, true)
    const items = this.map.items.slice()
    const keys = this.map.keys.slice()
    const it = items[index]!
    const nb = it.block
    const item: Item = {
      ...it,
      to: it.to + delta,
      block: nb ? { ...nb, to: nb.to + delta, content: nb.content ? { from: nb.content.from, to: nb.content.to + delta } : null } : nb,
    }
    items[index] = item
    keys[index] = itemKey(newDoc, item)
    for (let i = index + 1; i < items.length; i++) {
      const x = items[i]!
      items[i] = { ...x, from: x.from + delta, to: x.to + delta, block: shiftBlock(x.block, delta) }
    }
    const state = st.apply(tr)
    this.map = new PosMap(newDoc, items, state.doc, keys)
    this.typedInEmpty = null
    this.show(state, false)
    return true
  }

  /**
   * Text typed, deleted or pasted in a cell whose text is read like a paragraph: positions are the cells of the reading, so the
   * edit is the same as in a paragraph (a keystroke at the edge of a link or a mark is placed by the marks it brings). Blanks
   * typed after the last character stay on the screen until a letter follows them: the file has none at the end of a cell.
   */
  private readCellEdit(index: number, edit: TextEdit, a: TableLoc, b: TableLoc, blk: TextBlock, node: PMNode, typed: string): boolean {
    const st = this.view.state
    const doc = this.map.doc
    const cb = cellBlockAt(doc, a.cell.contentFrom, blockRange(doc, a.cell, blk).from)
    if (!cb) return this.fail(null, 'not-editable', 'This part of the document is not edited here; edit it in the source')
    const reading = blk.reading ?? readCell(doc, cb.content!.from, cb.content!.to)
    const cells = reading.cells
    const n = cells.length
    let k0 = a.offset!
    let k1 = b.offset!
    let text = typed
    const tail = node.content.size > n ? node.textBetween(n, node.content.size) : ''
    if (k0 > n) {
      text = tail.slice(0, k0 - n) + typed + tail.slice(Math.max(0, k1 - n))
      k0 = k1 = n
    } else if (k1 > n) {
      text = typed + tail.slice(k1 - n)
      k1 = n
    }
    if (k0 === n && k1 === n && /^\s*$/.test(text)) {
      const tr = st.tr.insertText(typed, edit.from, edit.to)
      tr.setSelection(TextSelection.create(tr.doc, edit.from + typed.length)).setMeta(OWN, true)
      const state = st.apply(tr)
      this.map = new PosMap(this.map.doc, this.map.items, state.doc, this.map.keys, this.map.cellDraft)
      this.typedInEmpty = null
      this.show(state, false)
      return true
    }
    let op: Operation
    if (k0 === k1) {
      if (text === '') return true
      const c = chooseOffset(cb, reading, k0, edit.marks)
      op = { kind: 'insertText', at: c.at, text, marks: { add: markNames(c.add), remove: markNames(c.remove) } }
    } else {
      const from = k0 < n ? cells[k0]!.from : cb.content!.to
      const to = cells[k1 - 1]!.to
      op =
        text === ''
          ? { kind: 'deleteRange', from, to }
          : { kind: 'replaceText', from, to, text, marks: { add: markNames(chooseOffset(cb, reading, k0, edit.marks).add) } }
    }
    const t0 = this.options.timing ? performance.now() : 0
    const r = this.operate(op)
    if (!r) return false
    if (r.changes.length === 0) {
      this.refresh()
      return true
    }
    if (r.literal === false) this.options.onInexact?.(op)
    this.write(r.changes, { origin: this })
    this.options.timing?.(performance.now() - t0)
    const cursor = k0 + text.length
    this.typedInEmpty = null
    this.sync(this.session.doc, (m) => textPlace(m.pm.child(index), m.starts[index]!, a.host, a.row, a.cellIdx, a.block!, cursor))
    return true
  }

  /** Runs an operation of a table as one step of the history; `select` says where the cursor goes. */
  private runTable(op: Operation, select: Select): boolean {
    const r = this.operate(op)
    if (!r) return false
    if (r.changes.length === 0) return true
    if (r.literal === false) this.options.onInexact?.(op)
    this.write(r.changes, { origin: this, group: false })
    this.sync(this.session.doc, select)
    return true
  }

  private insertRow(): boolean {
    const p = this.tablePlace()
    if (!p) return false
    const { loc, index } = p
    const row = loc.cell.row + loc.cell.rowspan
    const no = lineRefusal(loc.view, 'row', 'after', row - 1, row - 1)
    if (no && row >= loc.view.nrows) return this.refuse(no)
    return this.runTable({ kind: 'insertRow', at: loc.cell.contentFrom, where: 'after' }, (m) =>
      this.spotIn(m, index, loc.host, row, 'first', 'start'),
    )
  }

  private insertColumn(): boolean {
    const p = this.tablePlace()
    if (!p) return false
    const { loc, index } = p
    const col = loc.cell.column + loc.cell.colspan
    const no = colsRefusal(this.map.doc.text.slice(loc.view.from, loc.view.to), loc.view.ncols)
    if (no) return this.refuse(no)
    return this.runTable({ kind: 'insertColumn', at: loc.cell.contentFrom, where: 'after' }, (m) =>
      this.spotIn(m, index, loc.host, loc.cell.row, col, 'start'),
    )
  }

  private deleteRow(): boolean {
    const p = this.tablePlace()
    if (!p) return false
    const { loc, index } = p
    const v = loc.view
    const lines = this.linesOf(p)
    if (lines?.kind === 'row') return this.deleteLines(p, lines)
    const r = loc.cell.row
    if (v.nrows <= 1)
      return this.fail(null, 'last-row', 'The last row of the table stays. To remove the table, press «Delete table»')
    if (v.rows.some((row) => row.some((c) => c.rowspan > 1 && c.row <= r && r < c.row + c.rowspan)))
      return this.fail(null, 'row-merged', 'A cell merged over rows would go with the row. Split it first')
    const col = loc.cell.column
    const to = r + 1 < v.nrows ? r : r - 1
    return this.runTable({ kind: 'deleteRow', at: loc.cell.contentFrom }, (m) => this.spotIn(m, index, loc.host, to, col, 'end'))
  }

  private deleteColumn(): boolean {
    const p = this.tablePlace()
    if (!p) return false
    const { loc, index } = p
    const v = loc.view
    const lines = this.linesOf(p)
    if (lines?.kind === 'col') return this.deleteLines(p, lines)
    const col = loc.cell.column
    if (v.ncols <= 1)
      return this.fail(null, 'last-column', 'The last column of the table stays. To remove the table, press «Delete table»')
    if (v.rows.some((row) => row.some((c) => c.colspan > 1 && c.column <= col && col < c.column + c.colspan)))
      return this.fail(null, 'column-merged', 'A cell merged over columns would go with the column. Split it first')
    const no = colsRefusal(this.map.doc.text.slice(v.from, v.to), v.ncols)
    if (no) return this.refuse(no)
    const to = col + 1 < v.ncols ? col : col - 1
    return this.runTable({ kind: 'deleteColumn', at: loc.cell.contentFrom }, (m) =>
      this.spotIn(m, index, loc.host, loc.cell.row, to, 'end'),
    )
  }

  private refuse(r: Refusal): false {
    return this.fail(null, r.code, r.message, r.params)
  }

  // ------------------------------------------------------------------ the grips and the borders of a table

  /**
   * a column or a row is added before or after the line `line` of the table (the first or the last line of a selection), whatever
   * the cursor is in. The cell the core takes the side of is one with its edge on the boundary: the table is read for it.
   */
  private insertLine(p: { index: number; loc: TableLoc }, kind: 'col' | 'row', line: number, where: 'before' | 'after'): boolean {
    const { loc, index } = p
    const v = loc.view
    const rows = kind === 'row'
    const no = lineRefusal(v, kind, where, line, line) ?? (rows ? null : colsRefusal(this.map.doc.text.slice(v.from, v.to), v.ncols))
    if (no) return this.refuse(no)
    const b = where === 'before' ? line : line + 1
    // (a cell that starts on the boundary: `before` it; else one that ends on it: `after` it; none when merged cells cross it in every line)
    const cells = v.rows.flat()
    const start = cells.find((c) => (rows ? c.row : c.column) === b)
    const end = cells.find((c) => (rows ? c.row + c.rowspan : c.column + c.colspan) === b)
    const cell = start ?? end
    if (!cell) return this.fail(null, 'unsupported', 'This can only be edited in Text mode for now')
    // (`from`, not `contentFrom`: a cell that starts with a table has its content inside that table)
    const op: Operation = { kind: rows ? 'insertRow' : 'insertColumn', at: cell.from, where: start ? 'before' : 'after' }
    return this.runTable(op, (m) => (rows ? this.spotIn(m, index, loc.host, b, 'first', 'start') : this.spotIn(m, index, loc.host, 0, b, 'start')))
  }

  /** What a button of a bar is refused for beforehand, with the text of the tab; null when it works. */
  private lineRefusalOf(p: { index: number; loc: TableLoc }, kind: 'col' | 'row', act: LineAct, r: LineRange): { code: string; text: string } | null {
    const no = lineRefusal(p.loc.view, kind, act, r.from, r.to)
    return no ? { code: no.code, text: this.rejectText(no.code, no.message, no.params) } : null
  }

  /** The rows or columns of the table that a click on the grips selected, grown until they cut no merged cell; else null. */
  private linesOf(p: { index: number; loc: TableLoc }): LineRange | null {
    const s = this.cellSel
    if (!s?.line || s.index !== p.index || JSON.stringify(s.host) !== JSON.stringify(p.loc.host)) return null
    const v = this.viewIn(this.map, s.index, s.host)
    if (!v) return null
    const g = this.gridRect(v, s.a, s.b)
    return s.line.kind === 'col' ? { kind: 'col', from: g.col, to: g.col + g.cols - 1 } : { kind: 'row', from: g.row, to: g.row + g.rows - 1 }
  }

  /** Selects the rows or the columns `anchor`…`head` of a table, and puts the cursor in the first cell of them. */
  private selectLines(p: { index: number; loc: TableLoc }, kind: 'col' | 'row', anchor: number, head: number): void {
    const v = p.loc.view
    const max = (kind === 'col' ? v.ncols : v.nrows) - 1
    const lo = Math.max(0, Math.min(anchor, head, max))
    const hi = Math.min(max, Math.max(anchor, head))
    const one = { rowspan: 1, colspan: 1 }
    // (a line that grows over a merged cell to the whole table is refused, unless the whole table was asked for)
    const asked = kind === 'col' ? { row: 0, col: lo, ...one } : { row: lo, col: 0, ...one }
    const to: Sq = kind === 'col' ? { row: v.nrows - 1, col: hi, ...one } : { row: hi, col: v.ncols - 1, ...one }
    const grown = this.gridRect(v, asked, to)
    if (kind === 'col' ? grown.cols >= v.ncols && hi - lo + 1 < v.ncols : grown.rows >= v.nrows && hi - lo + 1 < v.nrows) {
      this.refused = { index: p.index, host: p.loc.host, kind, anchor }
      return void (kind === 'col'
        ? this.fail(null, 'column-merged-all', 'The column cannot be selected alone: a cell of the table is merged over its whole width. Split it first')
        : this.fail(null, 'row-merged-all', 'The row cannot be selected alone: a cell of the table is merged over its whole height. Split it first'))
    }
    this.refused = null
    const a: Sq = kind === 'col' ? { row: 0, col: lo, ...one } : { row: lo, col: 0, ...one }
    const b: Sq = kind === 'col' ? { row: v.nrows - 1, col: hi, ...one } : { row: hi, col: v.ncols - 1, ...one }
    this.cellSel = { index: p.index, host: p.loc.host, a, b, line: { kind, anchor, head } }
    const g = this.gridRect(v, a, b)
    const at = this.spotIn(this.map, p.index, p.loc.host, g.row, g.col, 'start')
    const view = this.view
    const tr = view.state.tr.setMeta(OWN, true).setMeta(CELLS, true)
    if (at !== null) tr.setSelection(TextSelection.near(tr.doc.resolve(at), 1))
    view.dispatch(tr)
    view.focus()
  }

  /** Why the rows or columns `r` cannot go (the code and the English text), from the form of the table alone; null when they may. */
  private deleteRefusal(v: TableView, r: LineRange): { code: string; message: string; params?: Readonly<Record<string, string>> } | null {
    const rows = r.kind === 'row'
    if (r.to - r.from + 1 >= (rows ? v.nrows : v.ncols))
      return rows
        ? { code: 'last-row', message: 'The last row of the table stays. To remove the table, press «Delete table»' }
        : { code: 'last-column', message: 'The last column of the table stays. To remove the table, press «Delete table»' }
    const merged = v.rows.some((row) =>
      row.some((c) =>
        rows ? c.rowspan > 1 && c.row <= r.to && c.row + c.rowspan > r.from : c.colspan > 1 && c.column <= r.to && c.column + c.colspan > r.from,
      ),
    )
    if (merged)
      return rows
        ? { code: 'row-merged', message: 'A cell merged over rows would go with the row. Split it first' }
        : { code: 'column-merged', message: 'A cell merged over columns would go with the column. Split it first' }
    const no = rows ? null : colsRefusal(this.map.doc.text.slice(v.from, v.to), v.ncols)
    return no ? { code: no.code, message: no.message, ...(no.params ? { params: no.params } : {}) } : null
  }

  /** The selected rows or columns go in one step of the history. */
  private deleteLines(p: { index: number; loc: TableLoc }, r: LineRange): boolean {
    const { loc, index } = p
    const v = loc.view
    const rows = r.kind === 'row'
    const n = r.to - r.from + 1
    const no = this.deleteRefusal(v, r)
    if (no) return no.params ? this.fail(null, no.code, no.message, no.params) : this.fail(null, no.code, no.message)
    let doc = this.map.doc
    let changes: Change[] = []
    const done: (readonly Change[])[] = []
    // (from the last line to the first: the places of the others do not move, the attribute `cols` aside, which the mapping covers)
    for (let k = r.to; k >= r.from; k--) {
      const cell = rows ? v.rows[k]?.[0] : v.rows.flat().find((c) => c.column === k)
      if (!cell) return false
      let at = cell.from
      for (const ch of done) at = mapOffset(ch as Change[], at, -1)
      const op: Operation = { kind: rows ? 'deleteRow' : 'deleteColumn', at }
      const res = applyOperation(doc, op)
      if ('error' in res) return this.fail(op, res.error, res.diagnostics[0]?.message ?? res.error)
      done.push(res.changes)
      changes = composeChanges(changes, res.changes as Change[])
      doc = res.doc
    }
    if (this.flipsByteOrderMark(doc)) return this.failByteOrderMark(null)
    if (changes.length === 0) return true
    this.write(changes, { origin: this, group: false })
    this.sync(this.session.doc, (m) =>
      rows
        ? this.spotIn(m, index, loc.host, Math.min(r.from, v.nrows - n - 1), 'first', 'end')
        : this.spotIn(m, index, loc.host, Math.min(loc.cell.row, v.nrows - 1), Math.min(r.from, v.ncols - n - 1), 'end'),
    )
    return true
  }

  /** The widths of the columns (whole percents) written to `cols` in one step; false (with the reason told) when they cannot be. */
  private writeWidths(p: { index: number; loc: TableLoc }, widths: readonly number[]): boolean {
    const v = p.loc.view
    const why = widthRefusal(this.map.doc.text.slice(v.from, v.to), v.ncols)
    if (why) return this.fail(null, why.code, 'The widths of the columns of this table cannot be written', why.params)
    const first = v.rows.find((row) => row.length > 0)?.[0]
    if (!first) return false
    const r = this.operate({ kind: 'setColumnWidths', at: first.contentFrom, widths })
    if (!r) return false
    // (the gesture was on the layer, not in the text: the focus goes back to the editor, so that Cmd+Z works at once)
    if (r.changes.length === 0) return (this.view.focus(), true)
    const before = this.selectionOffsets()
    this.write(r.changes, { origin: this, group: false })
    // (the cursor stays on its text: the widths may be written for a table the cursor is not in)
    this.sync(this.session.doc, (m, doc) => {
      if (!before) return null
      const a = this.posAtOffset(m, mapOffset(r.changes, before.anchor, -1))
      const h = this.posAtOffset(m, mapOffset(r.changes, before.head, -1))
      return a === null || h === null ? null : between(doc, a, h)
    })
    this.view.focus()
    return true
  }

  private gripHost(): GripHost {
    type Q = { index: number; loc: TableLoc }
    const q = (pl: GripPlace): Q => pl.ref as Q
    return {
      dom: this.view.dom,
      scroller: () => this.scroller(),
      place: (tbl) => {
        const cell = tbl.querySelector(':scope > .tbl-scroll > table > tbody > tr > :is(td, th)')
        const at = cell ? this.cellPlace(cell) : null
        return at ? { view: at.loc.view, ref: at } : null
      },
      selectedTable: () => {
        const s = this.cellSel
        const doc = this.view.state.doc
        if (!s?.line || doc.childCount !== this.map.starts.length) return null
        const t = followSteps(doc.child(s.index), this.map.starts[s.index]!, s.host)
        const dom = t ? this.view.nodeDOM(t.pos) : null
        return dom && dom.nodeType === 1 ? (dom as HTMLElement) : null
      },
      lines: (pl) => this.linesOf(q(pl)),
      anchor: (pl, kind) => {
        const s = this.cellSel
        const at = q(pl)
        const r = this.refused
        if (!s?.line && r && r.kind === kind && r.index === at.index && JSON.stringify(r.host) === JSON.stringify(at.loc.host)) return r.anchor
        return s?.line && s.line.kind === kind && s.index === at.index && JSON.stringify(s.host) === JSON.stringify(at.loc.host) ? s.line.anchor : null
      },
      select: (pl, kind, anchor, head) => this.selectLines(q(pl), kind, anchor, head),
      write: (pl, widths) => this.writeWidths(q(pl), widths),
      insert: (pl, kind, line, where) => this.insertLine(q(pl), kind, line, where),
      remove: (pl, r) => this.deleteLines(q(pl), r),
      refusal: (pl, kind, act, r) => this.lineRefusalOf(q(pl), kind, act, r),
      focus: () => this.view.focus(),
      leave: (pl, cell) => {
        const at = q(pl)
        const first = cell ? this.spotIn(this.map, at.index, at.loc.host, 0, 'first', 'start') : null
        const st = this.view.state
        const tr = st.tr.setMeta(OWN, true)
        tr.setSelection(first !== null ? TextSelection.near(tr.doc.resolve(first), 1) : st.selection)
        this.view.dispatch(tr)
        this.view.focus()
      },
      cursorTable: () => {
        const p = this.tablePlace()
        const dom = p ? this.view.nodeDOM(p.loc.nodePos) : null
        return dom && dom.nodeType === 1 ? (dom as HTMLElement) : null
      },
    }
  }

  private mergeSelected(): boolean {
    const s = this.cellSel
    const p = this.tablePlace()
    const v = s ? this.viewIn(this.map, s.index, s.host) : null
    const need = 'Select two or more cells next to each other: click the first and Shift-click the last'
    if (!s || !p || !v || p.index !== s.index) return this.fail(null, 'merge-select', need)
    const g = this.gridRect(v, s.a, s.b)
    const inside = this.cellsIn(v, g)
    if (inside.length < 2) return this.fail(null, 'merge-select', need)
    const first = inside.find((c) => c.row === g.row && c.column === g.col) ?? inside[0]!
    const last =
      inside.find((c) => c.row + c.rowspan === g.row + g.rows && c.column + c.colspan === g.col + g.cols) ?? inside[inside.length - 1]!
    const no = this.mergeRefusal(v, g, inside, first)
    if (no) return this.fail(null, no.code, no.message)
    return this.runTable({ kind: 'mergeCells', from: first.contentFrom, to: last.contentFrom }, (m) =>
      this.spotIn(m, s.index, s.host, g.row, g.col, 'end'),
    )
  }

  /** Why the cells of the rectangle `g` are not merged (the code and the English text), from the form of the table alone; null when they may be. */
  private mergeRefusal(v: TableView, g: { row: number }, inside: readonly CellView[], first: CellView): { code: string; message: string } | null {
    if (g.row < v.headRows) return { code: 'merge-head', message: 'Cells of the head are not merged' }
    if (v.level >= 3)
      return { code: 'merge-deep', message: 'Cells of tables of the third and fourth level are not merged: in AsciiDoc these levels are written as CSV and DSV' }
    if (inside.some((c) => c !== first && !cellIsEmpty(c)))
      return { code: 'merge-text', message: 'The cells to merge have text. Leave the text in the top left cell only' }
    return null
  }

  private splitMerged(): boolean {
    const p = this.tablePlace()
    if (!p) return false
    const { loc, index } = p
    if (loc.cell.colspan === 1 && loc.cell.rowspan === 1)
      return this.fail(null, 'split-single', 'Only a merged cell can be split')
    const select: Select = (m) => this.spotIn(m, index, loc.host, loc.cell.row, loc.cell.column, 'end')
    const split: Operation = { kind: 'splitCell', at: loc.cell.contentFrom }
    const role = loc.cell.fill
    if (role === null) return this.runTable(split, select)
    // a filled merged cell: every part has the fill, in the same step of the history
    const r = this.operate(split)
    if (!r) return false
    let doc = r.doc
    let changes = r.changes as Change[]
    let view: TableView | null = tableViewAt(doc, this.map.items[index]!.from)
    for (const s of loc.host) {
      const b: CellBlock | undefined = view?.rows[s.row]?.[s.cell]?.blocks[s.block]
      view = b && b.kind === 'table' ? b.table : null
    }
    const c0 = loc.cell
    const parts = (view?.rows ?? [])
      .flat()
      .filter((c) => c.fill === null && c.row >= c0.row && c.row < c0.row + c0.rowspan && c.column >= c0.column && c.column < c0.column + c0.colspan)
      .sort((a, b) => b.contentFrom - a.contentFrom)
    for (const c of parts) {
      const op: Operation = { kind: 'setCellFill', at: c.contentFrom, role }
      const f = applyOperation(doc, op)
      if ('error' in f) return this.fail(op, f.error, f.diagnostics[0]?.message ?? f.error)
      changes = composeChanges(changes, f.changes as Change[])
      doc = f.doc
    }
    if (this.flipsByteOrderMark(doc)) return this.failByteOrderMark(split)
    if (r.literal === false) this.options.onInexact?.(split)
    this.write(changes, { origin: this, group: false })
    this.sync(this.session.doc, select)
    return true
  }

  private toggleHeader(): boolean {
    const p = this.tablePlace()
    if (!p) return false
    const { loc, index } = p
    const want = loc.view.headRows === 0
    if (want && loc.view.rows[0]?.some((c) => c.rowspan > 1))
      return this.fail(null, 'head-rowspan', 'The first row has a cell merged over rows: it cannot be the head')
    return this.runTable({ kind: 'setTableOptions', at: loc.cell.contentFrom, header: want }, this.keepSpot(index, loc))
  }

  private nestHere(): boolean {
    const p = this.tablePlace()
    if (!p) return false
    const { loc, index } = p
    if (loc.view.level >= 4) return this.fail(null, 'nesting-too-deep', 'Tables are nested four levels deep at most')
    if (loc.cell.blocks.some((b) => b.kind === 'table'))
      return this.fail(null, 'cell-has-table', 'There is a table in this cell already')
    return this.runTable({ kind: 'nestTable', at: loc.cell.contentFrom, rows: 2, columns: 2 }, (m) => {
      const cell = this.viewIn(m, index, loc.host)?.rows[loc.row]?.[loc.cellIdx]
      const block = cell ? cell.blocks.findIndex((b) => b.kind === 'table') : -1
      if (block < 0) return this.spotIn(m, index, loc.host, loc.row, loc.cellIdx, 'end', true)
      return this.spotIn(m, index, [...loc.host, { row: loc.row, cell: loc.cellIdx, block }], 0, 'first', 'start')
    })
  }

  private deleteHere(): boolean {
    const p = this.tablePlace()
    if (!p) return false
    const { loc, index } = p
    const host = loc.host
    return this.runTable({ kind: 'deleteTable', at: loc.cell.contentFrom }, (m, doc) => {
      if (host.length > 0) {
        // a table of a cell: the cursor stays in the cell that held it
        const last = host[host.length - 1]!
        return this.spotIn(m, index, host.slice(0, -1), last.row, last.cell, 'end', true)
      }
      // a table of the document: the end of the block above it
      if (index === 0 || m.starts.length === 0) return Selection.atStart(doc)
      const above = Math.min(index, m.starts.length) - 1
      return TextSelection.near(doc.resolve(m.starts[above]! + doc.child(above).nodeSize), -1)
    })
  }

  /** Tab (`1`) and Shift-Tab (`-1`): the next or the previous cell, and Tab in the last one adds a row. */
  private nextCell(direction: 1 | -1): boolean {
    const p = this.tablePlace()
    if (!p) return false
    const { loc } = p
    const order: { r: number; k: number }[] = []
    loc.node.forEach((row, _o, r) => row.forEach((_c, _p, k) => order.push({ r, k })))
    const at = order.findIndex((x) => x.r === loc.row && x.k === loc.cellIdx)
    const to = at + direction
    if (to < 0) {
      // (Shift-Tab in the first cell goes to the grip of the first column)
      const dom = this.view.nodeDOM(loc.nodePos)
      if (dom && dom.nodeType === 1) this.grips?.focusLine(dom as HTMLElement, 'col', 0)
      return true
    }
    if (to >= order.length) return this.insertRow()
    const c = cellAtIndex(loc.node, loc.nodePos, order[to]!.r, order[to]!.k)
    if (!c) return true
    const st = this.view.state
    const sel = TextSelection.near(st.doc.resolve(cellCursor(c.node, c.pos, 'end')), 1)
    this.view.dispatch(st.tr.setSelection(sel).setMeta(OWN, true))
    // (an item that is only started is let go when the cursor leaves it)
    if (this.cellDraft && !this.inCellDraft()) this.dropCellDraft()
    return true
  }

  /** Shift-click on a cell of the table the cursor is in selects the cells from the one the cursor is in to the one clicked. */
  private selectCells(event: MouseEvent, cellDom: Element): boolean {
    const p = this.tablePlace()
    if (!p) return false
    let pos: number
    try {
      pos = this.view.posAtDOM(cellDom, 0)
    } catch {
      return false
    }
    const q = this.tablePlace(pos)
    if (!q || q.loc.nodePos !== p.loc.nodePos) return false
    event.preventDefault()
    const sq = (c: CellView): Sq => this.squareOf(c)
    const old = this.cellSel
    const same = old !== null && old.index === p.index && JSON.stringify(old.host) === JSON.stringify(p.loc.host)
    this.cellSel = {
      index: p.index,
      host: p.loc.host,
      a: same ? old.a : sq(p.loc.cell),
      b: sq(q.loc.cell),
    }
    const tr = this.view.state.tr.setMeta(OWN, true).setMeta(CELLS, true)
    // (a range of text in the first cell: the cursor stays, the range goes, so that the panel of the text does not stand with the capsule of cells)
    if (!this.view.state.selection.empty) tr.setSelection(TextSelection.create(this.view.state.doc, this.view.state.selection.head))
    this.view.dispatch(tr)
    return true
  }

  // ------------------------------------------------------------------ the text changes under the editor

  private onSession(event: SessionEvent): void {
    if (this.destroyed) return
    this.shiftOpened(event.changes)
    if (this.composing) {
      this.missed.push(event.changes)
      // (the lines of the island that was being edited are not where they were)
      if (event.origin !== this) this.pin = null
      return
    }
    if (event.kind === 'apply' && event.origin === this) {
      // (the island that is held keeps its lines when the edit is a mark in it, which is written outside `commitVerbatim`)
      if (this.pin) this.pin = { ...this.pin, from: mapOffset(event.changes, this.pin.from, -1), to: mapOffset(event.changes, this.pin.to, -1) }
      return
    }
    const mine = event.origin === this
    const before = this.selectionOffsets()
    this.draft = null
    this.pin = null
    if (this.slashDismissed !== null) this.slashDismissed = mapOffset(event.changes, this.slashDismissed, -1)
    this.sync(event.doc, (m, doc) => {
      if (mine) return this.posAtOffset(m, cursorAfter(event.changes))
      if (!before) return null
      // the cursor stays on its text
      const a = this.posAtOffset(m, mapOffset(event.changes, before.anchor, -1))
      const h = this.posAtOffset(m, mapOffset(event.changes, before.head, -1))
      return a === null || h === null ? null : between(doc, a, h)
    })
  }

  selectionOffsets(): { anchor: number; head: number } | null {
    const sel = this.view.state.selection
    const anchor = this.pointOffset(sel.anchor)
    const head = this.pointOffset(sel.head)
    return anchor === null || head === null ? null : { anchor, head }
  }

  /**
   * Brings the projection in line with `newDoc`: the blocks that are the same stay the same nodes, the ones
   * between the first and the last that changed are rebuilt in one step. `select` says where the cursor goes.
   */
  private sync(newDoc: NotaDocument, select?: Select): void {
    const view = this.view
    const state = view.state
    const old = this.map
    // (an item that is only started belongs to the text it was started in)
    if (this.draft && newDoc !== old.doc) this.draft = null
    if (this.cellDraft && newDoc !== old.doc) this.cellDraft = null
    this.cellSel = null
    const items = this.itemsOf(newDoc)
    const nums = itemNumbers(items)
    const keys = keysOf(newDoc, items)
    this.markPinned(items, keys)
    // (the table with an item that is only started is another node than the table of the text)
    const cd = this.cellDraft && items[this.cellDraft.index]?.kind === 'table' ? this.cellDraft : null
    if (!cd) this.cellDraft = null
    else keys[cd.index] += `~cd${cd.block}.${cd.row}.${cd.cell}.${cd.level}${cd.ordered ? 'o' : ''}${cd.check ? 'c' : ''}:${JSON.stringify(cd.host)}`
    let p = 0
    const max = Math.min(old.keys.length, keys.length)
    while (p < max && old.keys[p] === keys[p]) p++
    let s = 0
    while (s < max - p && old.keys[old.keys.length - 1 - s] === keys[keys.length - 1 - s]) s++
    const tr = state.tr.setMeta(OWN, true)
    const from = p < old.starts.length ? old.starts[p]! : state.doc.content.size
    const oldEnd = s === 0 ? state.doc.content.size : old.starts[old.keys.length - s]!
    const nodes = items.slice(p, items.length - s).map((it, i) => projectItem(newDoc, it, nums[p + i], cd && cd.index === p + i ? cd : undefined))
    if (from < oldEnd || nodes.length > 0) tr.replaceWith(from, oldEnd, Fragment.from(nodes))
    if (select === 'keep') {
      const size = tr.doc.content.size
      tr.setSelection(
        between(tr.doc, Math.min(state.selection.anchor, size), Math.min(state.selection.head, size)),
      )
    } else if (select) {
      const target = select(new PosMap(newDoc, items, tr.doc, keys, cd), tr.doc)
      if (typeof target === 'number')
        tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(target, tr.doc.content.size))))
      else if (target) tr.setSelection(target)
    }
    this.map = new PosMap(newDoc, items, tr.doc, keys, cd)
    // (a cursor put elsewhere by the editor lets go of an island or a draft it left)
    this.show(state.apply(tr), typeof select === 'function')
    this.tellMeta()
  }

  /** The header of the page kept out of sight among the items (or shown as islands while it is open); `keep`: the header is remembered. */
  private metaShape(doc: NotaDocument, items: Item[], keep: boolean): Item[] {
    if (!this.options.pageMeta) return items
    const r = pageMetaItems(doc, items, this.metaOpen)
    if (keep) {
      this.meta = r.meta
      if (!r.meta) this.metaOpen = false
    }
    return r.items
  }

  /** Tells the host about the header when it, or whether it is open, is not what it was told last. */
  private tellMeta(): void {
    if (!this.options.onPageMeta) return
    const info = this.pageMeta()
    const key = info ? JSON.stringify([info.fields, info.attributes, info.open]) : ''
    if (key === this.metaTold) return
    this.metaTold = key
    this.options.onPageMeta(info)
  }

  pageMeta(): PageMetaInfo | null {
    return this.meta
      ? {
          fields: this.meta.fields,
          attributes: this.meta.attributes.map((a) => ({ name: a.name, value: a.value })),
          open: this.metaOpen,
        }
      : null
  }

  editPageMeta(focusKey = 'version'): boolean {
    if (!this.meta || this.metaOpen || this.composing) return false
    const meta = this.meta
    this.metaOpen = true
    const line = meta.lines.get(focusKey)
    const text = this.session.text
    const at = line === undefined ? meta.ranges[0]!.from : line + (/^[^\r\n]*/.exec(text.slice(line))?.[0].length ?? 0)
    this.pin = null
    this.sync(this.session.doc, (m) => this.posAtOffset(m, at))
    // (the button of the card goes with the card: the cursor must be seen and the keys must land in the header)
    this.view.focus()
    return true
  }

  collapsePageMeta(): boolean {
    if (!this.metaOpen) return false
    const sel = this.selectionOffsets()
    this.pin = null
    this.metaOpen = false
    // (a cursor in the header goes to the start of the title: the header has no place for it now)
    this.sync(this.session.doc, (m, doc) => {
      if (!sel) return null
      const a = this.posAtOffset(m, sel.anchor)
      const h = this.posAtOffset(m, sel.head)
      return a === null || h === null ? null : between(doc, a, h)
    })
    return true
  }

  /** The position of the first place for a cursor at or after item `index`. */
  private afterMeta(m: PosMap, index: number): number {
    // (the zone after the link paragraph: the cursor goes to the start of that paragraph, not past the zone)
    const at = m.items[index]!
    if (at.block?.label === PAGE_META_BODY || at.block?.label === TOC_PINNED) {
      let p = index - 1
      while (p >= 0 && isPinned(m.items[p]!)) p--
      if (p >= 0 && m.items[p]!.kind === 'paragraph') return m.posOf(p, 0)
    }
    let i = index + 1
    while (i < m.items.length && isPinned(m.items[i]!)) i++
    if (i >= m.items.length) return m.starts[index]!
    const it = m.items[i]!
    if (it.kind === 'fence' || it.kind === 'table') return m.starts[i]!
    return m.posOf(i, 0)
  }

  /** The items of a document, and the one that is only started among them. */
  private itemsOf(doc: NotaDocument): Item[] {
    const items = this.metaShape(doc, this.pinnedItems(doc, diagramItems(doc, layoutItems(readLayout(doc)))), true)
    const d = this.draft
    if (!d) return items
    if (d.mode === 'after') {
      const x = items[d.at - 1]
      if (!x || x.kind !== 'item') {
        this.draft = null
        return items
      }
      items.splice(d.at, 0, draftItem(d, x.to, x.to, x.to))
    } else {
      if (d.virtual) {
        const prev = items[d.at - 1]
        if (!prev || items[d.at]?.kind === 'empty') {
          this.draft = null
          return items
        }
        items.splice(d.at, 0, { kind: 'empty', from: prev.to, to: prev.to, block: null, blockIndex: -1, gap: -1, line: -1 })
      }
      const e = items[d.at]
      if (!e || e.kind !== 'empty') {
        this.draft = null
        return items
      }
      if (d.kind === 'collapsible') items.splice(d.at, 1, ...draftBox(d, e))
      else items[d.at] = draftItem(d, e.from, e.from, e.to)
    }
    return items
  }

  /**
   * The items of a document with the island that is being edited kept whole: whatever its text reads as now, the lines of it are
   * one island while the cursor is in it.
   */
  private pinnedItems(doc: NotaDocument, items: Item[]): Item[] {
    const p = this.pin
    if (!p) return items
    const text = doc.text
    if (p.to > text.length || p.from > p.to) {
      this.pin = null
      return items
    }
    const first = items.findIndex((x) => x.to > p.from && x.from < p.to)
    let last = first
    if (first >= 0) while (items[last + 1] && items[last + 1]!.from < p.to) last++
    if (first >= 0 && (items[first]!.from < p.from || items[last]!.to > p.to)) {
      this.pin = null
      return items
    }
    if (first >= 0 && first === last && items[first]!.kind === 'chip' && items[first]!.from === p.from && items[first]!.to === p.to)
      return items
    const eol = text.slice(p.from, p.to).endsWith('\r\n') ? '\r\n' : text.slice(p.from, p.to).endsWith('\n') ? '\n' : ''
    const block: BlockInfo = {
      kind: 'chip',
      from: p.from,
      to: p.to,
      meta: null,
      content: { from: p.from, to: p.to - eol.length },
      level: 0,
      marker: '',
      markerFrom: -1,
      label: 'Island',
      eol,
      variant: '',
      checked: '',
      fence: '',
      box: '',
      title: '',
      startsOpen: false,
      lang: '',
      target: '',
    }
    const island: Item = { kind: 'chip', from: p.from, to: p.to, block, blockIndex: -1, gap: -1, line: -1 }
    if (first < 0) {
      const at = items.findIndex((x) => x.from >= p.from)
      items.splice(at < 0 ? items.length : at, 0, island)
    } else items.splice(first, last - first + 1, island)
    return items
  }

  /** Puts a state on the screen and does what a new state asks: an item that is only started goes when the cursor leaves it, a closed block opens when the cursor is in it. */
  private show(state: EditorState, moved: boolean): void {
    this.view.updateState(state)
    if (this.destroyed) return
    if (this.draft && moved && !this.inDraft()) {
      this.dropDraft()
      return
    }
    if (this.cellDraft && moved && !this.inCellDraft()) {
      this.dropCellDraft()
      return
    }
    if (this.pin && moved && !this.inPin()) {
      this.dropPin()
      return
    }
    this.ensureOpen()
  }

  /** The key of the island that is being edited tells it: a node that was put in by hand is rebuilt when it is let go. */
  private markPinned(items: readonly Item[], keys: string[]): void {
    const p = this.pin
    if (!p) return
    const i = items.findIndex((x) => x.kind === 'chip' && x.from === p.from)
    if (i >= 0) keys[i] += p.unsaved ? '~u' : '~p'
  }

  /** The island that was being edited is let go: it is shown as the text reads now. The edit that was not written is told. */
  private dropPin(): void {
    const p = this.pin
    this.pin = null
    const sel = this.selectionOffsets()
    this.sync(this.map.doc, (m, doc) => {
      if (!sel) return null
      const a = this.posAtOffset(m, sel.anchor)
      const h = this.posAtOffset(m, sel.head)
      return a === null || h === null ? null : between(doc, a, h)
    })
    if (p?.unsaved) {
      const text = this.options.messages?.['island-unsaved'] ?? 'The edit of the island was not written'
      this.options.onReject?.(text, { code: 'island-unsaved', message: text, operation: null })
    }
  }

  /** The cursor is in the island that is being edited. */
  private inPin(): boolean {
    const p = this.pin
    if (!p) return false
    const doc = this.view.state.doc
    if (doc.childCount !== this.map.starts.length) return false
    const i = this.map.items.findIndex((x) => x.kind === 'chip' && x.from === p.from)
    return i >= 0 && this.map.locate(this.view.state.selection.head, doc).index === i
  }

  /** The item or heading that is only started is taken away; the cursor stays on its text. */
  private dropDraft(): void {
    const sel = this.selectionOffsets()
    this.draft = null
    this.sync(this.map.doc, (m, doc) => {
      if (!sel) return null
      const a = this.posAtOffset(m, sel.anchor)
      const h = this.posAtOffset(m, sel.head)
      return a === null || h === null ? null : between(doc, a, h)
    })
  }

  /** The cursor is in the item of a cell that is only started. */
  private inCellDraft(): boolean {
    if (!this.cellDraft) return false
    const p = this.tablePlace()
    const b = p && p.loc.block !== null ? p.loc.cell.blocks[p.loc.block] : undefined
    return !!b && b.kind === 'text' && b.draft === true
  }

  /** The item of a cell that is only started is taken away; the cursor stays on its text. */
  private dropCellDraft(): void {
    const sel = this.selectionOffsets()
    this.cellDraft = null
    this.sync(this.map.doc, (m, doc) => {
      if (!sel) return null
      const a = this.posAtOffset(m, sel.anchor)
      const h = this.posAtOffset(m, sel.head)
      return a === null || h === null ? null : between(doc, a, h)
    })
  }

  /** The item of a cell that is only started is gone (Backspace or Enter in it): the cursor goes to the end of the item before it. */
  private cellDraftGone(): boolean {
    const d = this.cellDraft!
    this.cellDraft = null
    this.sync(this.map.doc, (m) =>
      textPlace(m.pm.child(d.index), m.starts[d.index]!, d.host, d.row, d.cell, d.block, Number.MAX_SAFE_INTEGER),
    )
    return true
  }

  /** Enter at the end of an item of a list in a cell: an empty item after it (and after the items under it) that the text does not have yet. */
  private startCellDraft(index: number, loc: TableLoc, blk: TextBlock): boolean {
    const item = blk.item!
    let last = loc.block!
    for (;;) {
      const next = loc.cell.blocks[last + 1]
      if (next && next.kind === 'text' && next.item && next.item.level > item.level) last++
      else break
    }
    this.cellDraft = {
      index,
      host: loc.host,
      row: loc.row,
      cell: loc.cellIdx,
      block: last,
      level: item.level,
      ordered: /^(\.+|\d+\.)$/.test(item.marker),
      check: item.checked !== '',
    }
    this.sync(this.map.doc, (m) => textPlace(m.pm.child(index), m.starts[index]!, loc.host, loc.row, loc.cellIdx, last + 1, 0))
    return true
  }

  /** Enter in a cell: nothing, but in an item of a list of an `a` cell it ends the item (a new one, or two) as in a list of the document. */
  private enterInCell(): boolean {
    const p = this.tablePlace()
    if (!p) return true
    const { index, loc } = p
    const blk = loc.block !== null ? loc.cell.blocks[loc.block] : undefined
    if (!blk || blk.kind !== 'text' || !blk.item || loc.offset === null) return true
    if (blk.draft) return this.cellDraftGone()
    const sel = this.view.state.selection
    if (!sel.empty) return true
    const k = loc.offset
    const blank = (c: { kind: string; ch?: string }): boolean => c.kind === 'char' && /^\s$/.test(c.ch ?? '')
    const after = blk.reading ? blk.reading.cells.slice(k).every(blank) : blk.text.slice(k).trim() === ''
    const before = blk.reading ? blk.reading.cells.slice(0, k).every(blank) : blk.text.slice(0, k).trim() === ''
    if (after) return this.startCellDraft(index, loc, blk)
    if (before) return this.fail(null, 'item-start', 'An item is split inside its text, or a new one is started at its end')
    const at = this.tableOffset(index, sel.from)
    const block = loc.block!
    return this.commit({ kind: 'splitBlock', at }, (m) => textPlace(m.pm.child(index), m.starts[index]!, loc.host, loc.row, loc.cellIdx, block + 1, 0), true, (d) => splitCellItem(d, at))
  }

  /** The first thing typed in an item of a cell that is only started: it is written in the text, after the item before it. */
  private typeInCellDraft(index: number, a: TableLoc, typed: string): boolean {
    const d = this.cellDraft!
    const prev = a.block !== null ? a.cell.blocks[a.block - 1] : undefined
    if (!prev || prev.kind !== 'text' || typed === '') return true
    // (a blank first character writes nothing: the item would vanish from the screen without a word)
    if (typed.trim() === '') return this.fail(null, 'item-start', 'A new item starts with text, not with a space')
    const after = blockRange(this.map.doc, a.cell, prev).from
    const op: Operation = { kind: 'insertItem', after, level: d.level, text: typed }
    const r = this.operate(op, (doc) => insertCellItem(doc, after, d.level, typed))
    if (!r) return false
    this.cellDraft = null
    if (r.changes.length > 0) this.write(r.changes, { origin: this })
    this.sync(this.session.doc, (m) =>
      textPlace(m.pm.child(index), m.starts[index]!, a.host, a.row, a.cellIdx, a.block!, typed.length),
    )
    return true
  }

  private inDraft(): boolean {
    const d = this.draft
    if (!d) return false
    const sel = this.view.state.selection
    const doc = this.view.state.doc
    if (doc.childCount !== this.map.starts.length) return false
    return this.map.locate(sel.from, doc).index === draftIndex(d)
  }

  /** Where the cursor goes when a draft is gone: at the end of the block it came after, or on the line it was started on. */
  private draftGone(m: PosMap, d: Draft): number {
    return d.mode === 'after' || d.virtual ? this.endOf(m, d.at - 1) : m.posOf(d.at, 0)
  }

  /** Before a command that works on the text: an item that is only started is not part of it. */
  private leaveDraft(): void {
    if (this.draft && this.inDraft()) {
      const d = this.draft
      this.draft = null
      this.sync(this.map.doc, (m) => this.draftGone(m, d))
    }
  }

  // ------------------------------------------------------------------ positions and offsets

  /** The offset of the text at a cursor. */
  private pointOffset(pos: number): number | null {
    const { map } = this
    const loc = map.locate(pos, this.view.state.doc)
    const it = map.items[loc.index]!
    if (loc.where === 'at') return loc.cell === 0 ? it.from : it.to
    if (it.kind === 'empty') return it.from
    if (isVerbatim(it)) return map.verbOffset(loc.index, loc.cell)
    if (it.kind === 'table') return this.tableOffset(loc.index, pos)
    const r = map.reading(loc.index)!
    const c = it.block!.content!
    if (loc.cell === 0) return c.from
    return loc.cell >= r.cells.length ? c.to : r.cells[loc.cell - 1]!.to
  }

  /** The offset where a range that starts at `pos` starts. */
  private startOffset(pos: number): number | null {
    const { map } = this
    const loc = map.locate(pos, this.view.state.doc)
    const it = map.items[loc.index]!
    // (a range does not start in the header of the page: it starts after it)
    if (isPinned(it)) return it.to
    if (loc.where === 'at') return loc.cell === 0 ? it.from : it.to
    if (it.kind === 'empty') return it.from
    if (isVerbatim(it)) return map.verbOffset(loc.index, loc.cell)
    // (a range inside a table is not a range of the text)
    if (it.kind === 'table') return null
    const r = map.reading(loc.index)!
    return loc.cell < r.cells.length ? r.cells[loc.cell]!.from : it.block!.content!.to
  }

  /** The offset where a range that ends at `pos` ends. */
  private endOffset(pos: number): number | null {
    const { map } = this
    const loc = map.locate(pos, this.view.state.doc)
    const it = map.items[loc.index]!
    // (a range does not end in the header of the page: it ends before it)
    if (isPinned(it)) return it.from
    // a range that ends between two blocks ends with the block before
    if (loc.where === 'at' && loc.cell === 0 && loc.index > 0) {
      const prev = map.items[loc.index - 1]!
      return isPinned(prev) ? prev.from : prev.to
    }
    if (loc.where === 'at') return loc.cell === 0 ? it.from : it.to
    if (it.kind === 'empty') return it.from
    if (isVerbatim(it)) return map.verbOffset(loc.index, loc.cell)
    if (it.kind === 'table') return null
    const r = map.reading(loc.index)!
    return loc.cell > 0 ? r.cells[loc.cell - 1]!.to : it.block!.content!.from
  }

  private posAtOffset(m: PosMap, offset: number): number | null {
    const loc = m.itemAt(offset)
    const it = m.items[loc.index]!
    if (isPinned(it)) return this.afterMeta(m, loc.index)
    if (it.kind === 'fence') return m.starts[loc.index]!
    if (it.kind === 'table') return this.tablePosAt(m, loc.index, offset)
    return m.posOf(loc.index, loc.cell ?? 0)
  }

  // ------------------------------------------------------------------ composition

  private startComposition(): void {
    if (this.composing) return
    this.composing = this.view.state.doc
    this.composingAt = this.selectionOffsets()
    this.composingFrom = this.view.state.selection.from
  }

  /** What an input method typed becomes one replacement of the text: from the document before it to the one now. */
  private endComposition(): void {
    const base = this.composing
    if (!base) return
    // What the browser changed in the DOM at the end of the composition is read before the document is looked at.
    // Chromium changes the DOM and sends `compositionend` in one run of the script, so the observer of ProseMirror
    // has not yet told the view about that last change (`forceFlush` does nothing when no timer is waiting), and
    // the document would still show what the input method showed before its end, not what it ended with. The
    // pending change is read here, as ProseMirror reads it itself a microtask later, and while the composition is
    // still on: what it makes of the change stays on the screen and is taken below, as one replacement of the text.
    const observer = (
      this.view as unknown as { domObserver?: { forceFlush?: () => void; flush?: () => void } }
    ).domObserver
    if (typeof observer?.forceFlush === 'function' || typeof observer?.flush === 'function') {
      observer.forceFlush?.()
      observer.flush?.()
    } else if (!this.warnedObserver) {
      // (a version of prosemirror-view that keeps the observer elsewhere: the composition ends with what ProseMirror has read)
      this.warnedObserver = true
      console.warn(
        '@nota-adoc/prosemirror: view.domObserver of prosemirror-view is not there, so the end of a composition is not read from the DOM; an input method may leave the text it showed before its end (checked on prosemirror-view 1.42.6)',
      )
    }
    this.composing = null
    // whatever way it ends, what the text did meanwhile is not carried into the next composition, and the screen
    // is left on the text it has now
    const missed = this.missed
    this.missed = []
    const at = this.composingAt
    const textBefore = this.session.doc
    this.finishComposition(base, missed)
    if (this.map.doc !== this.session.doc) {
      // the cursor stays on its text, as for a change outside a composition
      this.sync(this.session.doc, (m, doc) => {
        if (!at) return null
        const a = this.posAtOffset(
          m,
          missed.reduce((o, c) => mapOffset(c, o, -1), at.anchor),
        )
        const h = this.posAtOffset(
          m,
          missed.reduce((o, c) => mapOffset(c, o, -1), at.head),
        )
        return a === null || h === null ? null : between(doc, a, h)
      })
    }
    // the replacement at the end of the composition took the marks off, and `sync` does not put them: the last
    // ranges of the host are applied here, as the host will not send them again for a text that did not change;
    // when the composition changed the text, the ranges were counted on the old one and would land on the wrong
    // letters, so they wait for the ranges of the host
    if (this.session.doc === textBefore) this.setRanges(this.lastRanges)
  }

  private finishComposition(base: PMNode, missed: readonly (readonly Change[])[]): void {
    const view = this.view
    const now = view.state.doc
    if (base.eq(now)) return
    // the screen goes back to the text, then what was typed is made as an edit from there
    const st = view.state
    view.updateState(st.apply(st.tr.replaceWith(0, st.doc.content.size, base.content).setMeta(OWN, true)))
    // the replacement took the marks of remarks off; where the text is the same as before they are put back, so an
    // early return below leaves them on the screen (when the text moved on, `endComposition` puts them after its sync)
    if (this.map.doc === this.session.doc) this.setRanges(this.lastRanges)
    let changed = -1
    if (base.childCount === now.childCount) {
      for (let k = 0; k < base.childCount; k++) {
        if (base.child(k).eq(now.child(k))) continue
        changed = changed === -1 ? k : -2
        if (changed === -2) break
      }
    }
    if (changed < 0) return
    let start = this.map.starts[changed]! + 1
    let before = base.child(changed)
    let after = now.child(changed)
    // composed in a cell of a table: the text of that cell is what differs
    while (before.type === schema.nodes.table || before.type === schema.nodes.table_row || before.type === schema.nodes.table_cell) {
      if (before.childCount !== after.childCount || before.type !== after.type) return
      let k = -1
      for (let i = 0; i < before.childCount; i++)
        if (!before.child(i).eq(after.child(i))) {
          if (k >= 0) return
          k = i
        }
      if (k < 0) return
      for (let i = 0; i < k; i++) start += before.child(i).nodeSize
      start += 1
      before = before.child(k)
      after = after.child(k)
    }
    const diff = diffInline(before, after, this.composingFrom - start)
    if (!diff) return
    if (this.map.doc !== this.session.doc) return this.composedLate(start, diff, missed)
    if (
      !this.textEdit(
        { from: start + diff.from, to: start + diff.to, text: diff.text, marks: diff.marks },
        null,
      )
    )
      this.refresh()
  }

  /**
   * The text changed while the input method was on (the person went to the source, say): what was composed is put
   * in where its place is now, as plain text, and the screen catches up with the text.
   */
  private composedLate(
    start: number,
    diff: { from: number; to: number; text: string },
    missed: readonly (readonly Change[])[],
  ): void {
    const a = this.startOffset(start + diff.from)
    const b = this.endOffset(start + diff.to)
    let from = a
    let to = b
    for (const changes of missed) {
      if (from !== null) from = mapOffset(changes, from, 1)
      if (to !== null) to = mapOffset(changes, to, -1)
    }
    if (from === null || to === null) return this.sync(this.session.doc)
    to = Math.max(from, to)
    const op: Operation =
      diff.text === ''
        ? { kind: 'deleteRange', from, to }
        : from === to
          ? { kind: 'insertText', at: from, text: diff.text }
          : { kind: 'replaceText', from, to, text: diff.text }
    // the cursor goes after what was composed (or stays where the deleted range was)
    const before = this.session.doc
    const pre = new PosMap(before, this.metaShape(before, diagramItems(before, layoutItems(readLayout(before))), false), this.view.state.doc)
    const place = pre.itemAt(from)
    let typed = 0
    // where the composed text ends when it is in the text as it was typed (alone with blank space in the change that
    // brought it in); else (an escape was needed, say) `null` and the cells tell
    let literal: number | null = null
    let after = from
    if (from < to || diff.text !== '') {
      const r = applyOperation(before, op)
      if ('error' in r) this.fail(op, r.error, r.diagnostics[0]?.message ?? r.error)
      else if (r.changes.length > 0) {
        typed = diff.text.length
        after = mapOffset(r.changes as Change[], to, 1)
        if (r.doc.text.startsWith(diff.text, from)) literal = from + typed
        else if (diff.text !== '') {
          // the operation put the text elsewhere than `from` (a blank line between blocks became a paragraph that
          // holds it, say): the cursor is after the text where one change brought it in
          const holders = (r.changes as Change[]).filter((c) => c.insert.includes(diff.text))
          if (holders.length === 1) {
            const h = holders[0]!
            // the occurrence nearest to the place (not before it), else the first
            const near = h.insert.indexOf(diff.text, Math.max(0, from - h.from))
            const idx = near >= 0 ? near : h.insert.indexOf(diff.text)
            // only the text and blank space around it: if the operation wrote an escape (`pass:[…]`) the cells tell
            const rest = h.insert.slice(0, idx) + h.insert.slice(idx + diff.text.length)
            if (rest.trim() === '') {
              let shift = 0
              for (const c of r.changes as Change[]) {
                if (c === h) break
                shift += c.insert.length - (c.to - c.from)
              }
              literal = h.from + shift + idx + typed
            }
          }
        }
        this.write(r.changes, { origin: this })
      }
    }
    const oldCells = pre.reading(place.index)?.cells.length ?? 0
    const end = pre.itemAt(to)
    const removed =
      end.index === place.index && end.cell !== null && place.cell !== null ? end.cell - place.cell : 0
    this.sync(this.session.doc, (m) => {
      if (literal !== null) return this.posAtOffset(m, literal)
      if (place.cell === null || m.items.length !== pre.items.length)
        return this.posAtOffset(m, Math.min(after, m.doc.text.length))
      // what the text added to the item is cells the person sees: a blank at the start of a block is not one
      // (an item with no cells, an island, say, has the text in it as it is written: the offset tells)
      const reading = m.reading(place.index)
      if (!reading && typed > 0) return this.posAtOffset(m, Math.min(after, m.doc.text.length))
      const cells = reading?.cells ?? []
      const added = typed === 0 ? 0 : cells.length - oldCells + removed
      const cell = place.cell + Math.max(0, Math.min(typed, added))
      // (a count of cells is a guess: text before the place that is read another way now, a mark that was printed
      // again, changes it. What stands before the cursor must be the last of what was typed, else the offset tells)
      const last = cells[cell - 1]
      if (typed > 0 && added > 0 && !(last && last.ch !== '' && diff.text.endsWith(last.ch)))
        return this.posAtOffset(m, Math.min(after, m.doc.text.length))
      return this.cursorAt(m, place.index, cell)
    })
  }

  // ------------------------------------------------------------------ browser menus, clipboard

  private onBeforeInput(event: InputEvent): boolean {
    if (event.inputType === 'historyUndo') {
      event.preventDefault()
      this.session.undo({ origin: this })
      return true
    }
    if (event.inputType === 'historyRedo') {
      event.preventDefault()
      this.session.redo({ origin: this })
      return true
    }
    return false
  }

  private onPaste(event: ClipboardEvent): boolean {
    const data = event.clipboardData
    const text = data?.getData('text/plain')
    const types = Array.from(data?.types ?? [])
    const html = types.includes('text/html') ? data?.getData('text/html') : ''
    // (a copy from a source editor of VS Code carries its colours as HTML: it is code, not a look to keep)
    const source = types.includes('vscode-editor-data')
    const files = (data?.files?.length ?? 0) > 0
    event.preventDefault()
    // (always true, a refused paste too: the event is handled, and the browser must not paste it its own way, over the editor)
    if (html && !source && this.pasteHtml(html, text ?? '', files)) return true
    // (a refusal is the only report: pictures are not told about after it)
    const refused = text ? this.refusedBy(() => this.pasteText(text)) : false
    if (files && !html && !refused) this.told('paste-images', 'Pictures from the clipboard are not pasted')
    return true
  }

  private told(code: string, message: string): void {
    const text = this.options.messages?.[code] ?? message
    this.options.onReject?.(text, { code, message: text, operation: null })
  }

  /**
   * HTML from the clipboard: the marks, links, lists, headings and tables of it are written as AsciiDoc. In code, a cell or a heading it
   * is plain text. The first paragraph goes into the paragraph that holds the cursor, the other blocks after it. All of it is one step
   * of the history. False when the clipboard holds no text to paste as HTML (the plain text is pasted then).
   */
  private pasteHtml(html: string, plain: string, files: boolean): boolean {
    const pasted = convertHtml(html)
    const images = pasted.images || files
    if (pasted.blocks.length === 0) {
      if (plain === '' && images) this.told('paste-images', 'Pictures from the clipboard are not pasted')
      return false
    }
    const text = plain !== '' ? plain : plainOfBlocks(pasted.blocks)
    const state = this.view.state
    const sel = state.selection
    const placed = state.doc.childCount === this.map.starts.length
    const startsIn = placed ? this.map.locate(sel.from, state.doc) : null
    const host = startsIn ? this.map.items[startsIn.index] : undefined
    const inCell = !!this.tablePlace(sel.from) || !!this.tablePlace(sel.to)
    if (this.inDraft() || this.verbatimSel() || inCell || !host || host.kind === 'heading') {
      const flat = host?.kind === 'heading' || inCell
      const refused = this.refusedBy(() =>
        flat && !this.inDraft() && !this.verbatimSel() && !inCell
          ? this.textEdit({ from: sel.from, to: sel.to, text: text.replace(/\s*(?:\r\n|\r|\n)\s*/g, ' '), marks: [] }, null)
          : this.pasteText(text),
      )
      if (images && !refused) this.told('paste-images', 'Pictures from the clipboard are not pasted')
      return true
    }
    const refuse = (): true => {
      this.told('paste-refused', 'The fragment was not pasted: in AsciiDoc it would read differently')
      this.refresh()
      return true
    }
    if (!pasted.verified) return refuse()
    const from = this.startOffset(sel.from)
    const to = this.endOffset(sel.to)
    if (from === null || to === null) return false
    let doc = this.map.doc
    let changes: Change[] = []
    const cursor = from
    const run = (op: Operation): boolean => {
      const r = applyOperation(doc, op)
      if ('error' in r) return false
      changes = composeChanges(changes, r.changes as Change[])
      doc = r.doc
      return true
    }
    const parts = to > from ? this.outsideMeta(from, to) : null
    if (parts) {
      // (the header of the page stays: the parts of the range around it go, the last one first)
      for (let i = parts.length - 1; i >= 0; i--) if (!run({ kind: 'deleteRange', from: parts[i]![0], to: parts[i]![1] })) return refuse()
    } else if (to > from && !run({ kind: 'deleteRange', from, to })) return refuse()
    const itemAt = (d: NotaDocument, at: number): Item | undefined => {
      let found: Item | undefined
      for (const it of layoutItems(readLayout(d))) {
        if (it.from <= at && at < it.to) return it
        if (it.from <= at && at <= it.to) found = it
      }
      return found
    }
    const here = itemAt(doc, cursor)
    if (!here) return refuse()
    let rest: readonly PasteBlock[] = pasted.blocks
    let after = cursor
    const first = pasted.blocks[0]!
    if (here.kind === 'paragraph' || here.kind === 'item') {
      if (first.kind === 'paragraph') {
        const c = here.block!.content!
        const before = cursor > c.from ? doc.text.slice(cursor - 1, cursor) : ''
        const next = cursor < c.to ? doc.text.slice(cursor, cursor + 1) : ''
        const body = renderRuns(first.runs ?? [], before, next)
        const source =
          (first.edge?.lead && before !== '' && before !== ' ' ? ' ' : '') + body + (first.edge?.trail && next !== '' && next !== ' ' ? ' ' : '')
        const change: Change = { from: cursor, to: cursor, insert: source }
        const result = doc.update([change])
        const cellsOld = readInline(doc, c.from, c.to).cells
        const k = cellsBefore(cellsOld, cursor)
        const old = cellsOld.map((x) => x.ch)
        const meant = old.slice(0, k).join('') + first.text + old.slice(k).join('')
        const now = itemAt(result, cursor)
        const nc = now?.block?.content
        const got = nc ? readInline(result, nc.from, nc.to).cells.map((x) => x.ch).join('') : null
        const squash = (s: string): string => s.replace(/\s+/g, '')
        if (
          !now ||
          now.kind !== here.kind ||
          checkNoCollateral(doc, result, [change]).length > 0 ||
          got === null ||
          squash(got) !== squash(meant)
        )
          return refuse()
        doc = result
        changes = composeChanges(changes, [change])
        after = cursor + source.length
        rest = pasted.blocks.slice(1)
      }
    } else if (here.kind !== 'empty') return refuse()
    if (rest.length > 0) {
      const at = here.kind === 'empty' ? here.from : after
      const op: Operation = { kind: 'placeBlock', at, block: { source: fragmentSource(rest) }, replace: false }
      if (!run(op)) return refuse()
      after = Math.min(doc.text.length, mapOffset(changes.slice(-1), at, 1))
    }
    if (changes.length === 0) return true
    // the cursor is at the end of the text that was pasted last
    const landing = ((): number => {
      let best = after
      for (const it of layoutItems(readLayout(doc))) {
        if (it.kind === 'empty' || it.from >= after) continue
        best = it.block?.content ? Math.min(it.block.content.to, Math.max(it.block.content.from, after)) : it.to
      }
      return best
    })()
    if (!this.write(changes, { origin: this })) return true
    this.sync(this.session.doc, (m) => this.posAtOffset(m, landing))
    if (images) this.told('paste-images', 'Pictures from the clipboard are not pasted')
    return true
  }

  private onCut(event: ClipboardEvent): boolean {
    const sel = this.view.state.selection
    if (sel.empty) return true
    event.clipboardData?.setData(
      'text/plain',
      this.view.state.doc.textBetween(sel.from, sel.to, '\n\n', '\n'),
    )
    event.preventDefault()
    this.deleteSelection()
    return true
  }

  /** Plain text pasted: a line break makes a new paragraph. All of it is one step of the history. */
  private pasteText(text: string): boolean {
    if (this.inDraft()) return this.typeInDraft(text.replace(/\s*(?:\r\n|\r|\n)\s*/g, ' '))
    const v = this.verbatimSel()
    if (v) return this.verbatimEdit(v.index, v.k0, v.k1, text)
    const sel = this.view.state.selection
    // (in a cell the pasted lines are one line)
    if (this.tablePlace(sel.from) || this.tablePlace(sel.to))
      return this.textEdit({ from: sel.from, to: sel.to, text: text.replace(/\s*(?:\r\n|\r|\n)\s*/g, ' '), marks: [] }, null)
    // (a paragraph does not start with blanks: they are not written)
    const lines = text.split(/\r\n|\r|\n/).map((l, k) => (k === 0 ? l : l.replace(/^[ \t]+/, '')))
    const from = this.startOffset(sel.from)
    const to = this.endOffset(sel.to)
    if (from === null || to === null) return false
    const around = this.outsideMeta(from, Math.max(from, to))
    if (around) {
      // (the header of the page stays: the parts around it are replaced, the lines go before it as paragraphs, one step)
      if (around.length === 0) return true
      return this.replaceAroundMeta(around, lines)
    }
    let doc = this.map.doc
    let changes: Change[] = []
    let cursor = from
    const start = this.map.locate(sel.from, this.view.state.doc)
    const run = (op: Operation): boolean => {
      const r = applyOperation(doc, op)
      if ('error' in r) {
        this.fail(op, r.error, r.diagnostics[0]?.message ?? r.error)
        return false
      }
      const was = op.kind === 'replaceText' ? op.from : cursor
      changes = composeChanges(changes, r.changes as Change[])
      cursor = r.changes.length
        ? mapOffset(r.changes as Change[], op.kind === 'replaceText' ? op.to : cursor, 1)
        : cursor
      doc = r.doc
      // (text put into an empty paragraph is written with its line break: the cursor stays before it)
      const holder = layoutItems(readLayout(doc)).find((x) => x.block?.content && x.from <= was && was <= x.to)
      if (holder && cursor > holder.block!.content!.to && holder.kind !== 'empty') cursor = holder.block!.content!.to
      return true
    }
    // a blank that follows the paste and starts what is left of the paragraph would go with the split: it is put back
    const state = this.view.state
    const restBlank =
      lines.length > 1 &&
      sel.to < state.doc.content.size &&
      /^[ \t]$/.test(state.doc.textBetween(sel.to, Math.min(sel.to + 1, state.doc.content.size)))
    // what the pasted lines are written in: the marks and roles of the place (a line after a split goes inside the
    // piece that was split, as the text before the split does)
    const here: readonly Mark[] =
      state.storedMarks ??
      (sel.empty
        ? state.doc.resolve(sel.from).marks()
        : state.doc.resolve(sel.from).marksAcross(state.doc.resolve(sel.to))) ??
      []
    if (!run({ kind: 'replaceText', from, to: Math.max(from, to), text: lines[0]! })) return false
    for (let i = 1; i < lines.length; i++) {
      const before = layoutItems(readLayout(doc))
      const at = before.findIndex(
        (it) => it.from <= cursor && cursor <= it.to && !isRawKind(it.kind),
      )
      if (!run({ kind: 'splitBlock', at: cursor })) return false
      // the cursor goes to the start of the block after the split
      const after = layoutItems(readLayout(doc))
      const next = after[Math.min(at + 1, after.length - 1)]
      if (at >= 0 && next)
        cursor = next.kind === 'empty' ? next.from : (next.block!.content?.from ?? next.from)
      if (lines[i] === '') continue
      let marks: TypedMarks | undefined
      const block = next && next.kind !== 'empty' && !isRawKind(next.kind) ? next.block : null
      if (block?.content) {
        const reading = readInline(doc, block.content.from, block.content.to)
        const c = chooseOffset(block, reading, 0, here)
        cursor = c.at
        marks = { add: markNames(c.add), remove: markNames(c.remove) }
      }
      if (!run({ kind: 'insertText', at: cursor, text: lines[i]!, marks })) return false
    }
    if (restBlank && !run({ kind: 'insertText', at: cursor, text: ' ' })) return false
    if (changes.length === 0) return true
    if (!this.write(changes, { origin: this })) return true
    // the cursor is after the last pasted line
    const last = lines[lines.length - 1]!.length
    this.sync(
      this.session.doc,
      (m) =>
        (start.where === 'in'
          ? this.cursorAt(m, start.index + lines.length - 1, (lines.length > 1 ? 0 : start.cell) + last)
          : null) ?? this.posAtOffset(m, cursor),
    )
    return true
  }

  // ------------------------------------------------------------------ commands

  /** Asks for the operation, writes it and puts the cursor where `select` says (or leaves it where it is). */
  private commit(op: Operation, select: Select, inCell = false, run?: (doc: NotaDocument) => ApplyResult): boolean {
    // (what is not a command of tables does not work on a cell: a cell is not a paragraph; marks and links are, in a cell read like one)
    if (this.tablePlace() && !inCell) return false
    const r = this.operate(op, run)
    if (!r) return false
    if (r.changes.length === 0) return true
    if (r.literal === false) this.options.onInexact?.(op)
    this.write(r.changes, { origin: this })
    this.sync(this.session.doc, select)
    return true
  }

  /** The parts of `from`–`to` that lie outside the header of the page; `null` when none of the header is in the range. */
  private outsideMeta(from: number, to: number): [number, number][] | null {
    let touched = false
    const parts: [number, number][] = []
    let at = from
    for (const it of this.map.items) {
      if (!isPinned(it) || it.to <= from || it.from >= to) continue
      touched = true
      if (it.from > at) parts.push([at, it.from])
      at = Math.max(at, it.to)
    }
    if (!touched) return null
    if (at < to) parts.push([at, to])
    return parts
  }

  /**
   * Deletes the parts of a range outside the header of the page: one write, the last part first so that the offsets of
   * the others stay. Returns the changes, or null (the refusal told).
   */
  private deleteParts(parts: readonly [number, number][]): { changes: Change[]; doc: NotaSession['doc'] } | null {
    let doc = this.session.doc
    let changes: Change[] = []
    for (let i = parts.length - 1; i >= 0; i--) {
      const [a, b] = parts[i]!
      const op: Operation = { kind: 'deleteRange', from: a, to: b }
      const r = applyOperation(doc, op)
      if ('error' in r) {
        this.fail(op, r.error, r.diagnostics[0]?.message ?? r.error)
        return null
      }
      changes = composeChanges(changes, r.changes as Change[])
      doc = r.doc
    }
    return { changes, doc }
  }

  /**
   * Text typed or pasted over a range that holds the header of the page: the parts around the header go, and each line is
   * a paragraph of its own (written the way a paragraph is, so markup in it is escaped) right after the header, which is
   * not touched or torn: a header is the lines that start the file up to the first block, so the text cannot go before it
   * or between its lines. One write; the cursor goes to the end of the last line.
   */
  private replaceAroundMeta(parts: readonly [number, number][], lines: readonly string[]): boolean {
    const metas = this.map.items.filter(isPinned)
    const last = metas[metas.length - 1]
    if (!last) return false
    const deleted = this.deleteParts(parts)
    if (!deleted) return false
    let changes = deleted.changes
    // (each line is written the way a paragraph is: markup in it is escaped, and a line that cannot be is refused whole)
    const sources: string[] = []
    for (const line of lines) {
      if (line.trim() === '') continue
      const src = escapeInline(line.trim())
      if (src === null) {
        this.fail(null, 'unwritable', 'This text cannot be written as a paragraph here; edit it in the source')
        return false
      }
      sources.push(src)
    }
    let tail = 0
    let at = 0
    if (sources.length > 0) {
      let rest = this.session.text
      for (const c of [...changes].sort((x, y) => y.from - x.from)) rest = rest.slice(0, c.from) + c.insert + rest.slice(c.to)
      const eol = rest.includes('\r\n') ? '\r\n' : '\n'
      at = mapOffset(changes, last.to, -1)
      const before = rest.slice(0, at)
      const after = rest.slice(at)
      const lead = (before === '' || before.endsWith('\n') ? '' : eol) + eol
      const trail = eol + (after === '' || /^\r?\n/.test(after) ? '' : eol)
      tail = trail.length
      const insert = lead + sources.join(eol + eol) + trail
      changes = composeChanges(changes, [{ from: at, to: at, insert }])
      at += insert.length
    }
    if (changes.length === 0) return true
    this.write(changes, { origin: this })
    const end = at - tail
    this.sync(this.session.doc, (m) =>
      this.posAtOffset(m, sources.length > 0 ? end : mapOffset(changes, parts[0]![0], 1)),
    )
    return true
  }

  /** A selected line `toc::[]` outside the zone of the header: exactly that line, with its line break, leaves the file. */
  private deleteToc(pos: number): boolean {
    if (this.view.state.doc.childCount !== this.map.starts.length) return true
    const it = this.map.items[this.map.indexAt(pos, this.view.state.doc)]
    if (!it || it.block?.fence !== 'toc' || isPinned(it)) return true
    this.write([{ from: it.from, to: it.to, insert: '' }], { origin: this })
    this.sync(this.session.doc, (m) => this.posAtOffset(m, Math.min(it.from, this.session.text.length)))
    return true
  }

  private deleteSelection(): boolean {
    const sel = this.view.state.selection
    if (sel instanceof NodeSelection && sel.node.type.name === 'toc') return this.deleteToc(sel.from)
    if (sel.empty) return false
    const v = this.verbatimSel()
    if (v) return this.verbatimEdit(v.index, v.k0, v.k1, '')
    if (this.tablePlace(sel.from) || this.tablePlace(sel.to))
      return this.textEdit({ from: sel.from, to: sel.to, text: '', marks: [] }, null)
    const from = this.startOffset(sel.from)
    const to = this.endOffset(sel.to)
    if (from === null || to === null) return false
    const parts = this.outsideMeta(from, Math.max(from, to))
    if (parts) {
      // (the header of the page is not deleted with what is around it)
      if (parts.length === 0) return true
      const changes = this.deleteParts(parts)?.changes
      if (!changes) return true
      if (changes.length === 0) return true
      this.write(changes, { origin: this })
      this.sync(this.session.doc, (m) => this.posAtOffset(m, mapOffset(changes, parts[0]![0], 1)))
      return true
    }
    const op: Operation = { kind: 'deleteRange', from, to: Math.max(from, to) }
    const r = this.operate(op)
    if (!r) return true
    if (r.changes.length === 0) return true
    if (r.literal === false) this.options.onInexact?.(op)
    this.write(r.changes, { origin: this })
    this.sync(this.session.doc, (m) => this.posAtOffset(m, mapOffset(r.changes as Change[], from, 1)))
    return true
  }

  private deleteBackward(): boolean {
    if (this.deleteSelection()) return true
    if (this.inDraft()) return this.draftBackspace()
    if (this.inCellDraft()) return this.cellDraftGone()
    const pos = this.view.state.selection.from
    if (this.tablePlace(pos)) return this.deleteInCell(pos, -1)
    const loc = this.map.locate(pos, this.view.state.doc)
    const it = this.map.items[loc.index]!
    if (loc.where === 'in' && loc.cell > 0 && isTextItem(it)) {
      // one character back (a surrogate pair goes whole)
      const r = this.map.reading(loc.index)!
      let k = loc.cell - 1
      if (k > 0 && /[\udc00-\udfff]/.test(r.cells[k]!.ch) && /[\ud800-\udbff]/.test(r.cells[k - 1]!.ch)) k--
      return this.textEdit({ from: pos - (loc.cell - k), to: pos, text: '', marks: [] }, null)
    }
    if (loc.where === 'in' && isVerbatim(it)) {
      if (loc.cell > 0) {
        // one character back (a surrogate pair goes whole)
        const text = this.verbText(loc.index)
        let k = loc.cell - 1
        if (k > 0 && /[\udc00-\udfff]/.test(text[k]!) && /[\ud800-\udbff]/.test(text[k - 1]!)) k--
        return this.verbatimEdit(loc.index, k, loc.cell, '')
      }
      // Backspace in code with nothing in it takes the block away, with the lines over and under it
      if (it.kind === 'code' && this.verbText(loc.index) === '')
        return this.commit({ kind: 'deleteBlock', at: it.from }, (m) =>
          this.posAtOffset(m, Math.min(it.from, m.doc.text.length)),
        )
      return true
    }
    if (it.kind === 'fence') return true
    if (loc.where === 'in' && loc.cell === 0) return this.join(loc.index, 'backward')
    if (loc.where === 'at' && loc.cell === 0) return this.join(loc.index, 'backward')
    return true
  }

  private deleteForward(): boolean {
    if (this.deleteSelection()) return true
    if (this.inDraft()) return true
    const pos = this.view.state.selection.from
    if (this.tablePlace(pos)) return this.deleteInCell(pos, 1)
    const loc = this.map.locate(pos, this.view.state.doc)
    const it = this.map.items[loc.index]!
    if (it.kind === 'fence') return true
    if (loc.where === 'in' && isVerbatim(it)) {
      const text = this.verbText(loc.index)
      if (loc.cell >= text.length) return true
      let k = loc.cell + 1
      if (/[\ud800-\udbff]/.test(text[loc.cell]!) && /[\udc00-\udfff]/.test(text[k] ?? '')) k++
      return this.verbatimEdit(loc.index, loc.cell, k, '')
    }
    if (loc.where === 'in' && isTextItem(it)) {
      const r = this.map.reading(loc.index)!
      if (loc.cell < r.cells.length) {
        let k = loc.cell + 1
        if (
          /[\ud800-\udbff]/.test(r.cells[loc.cell]!.ch) &&
          r.cells[k] &&
          /[\udc00-\udfff]/.test(r.cells[k]!.ch)
        )
          k++
        return this.textEdit({ from: pos, to: pos + (k - loc.cell), text: '', marks: [] }, null)
      }
    }
    return this.join(loc.index, 'forward')
  }

  /** Backspace at the start of the item `index`, or Delete at its end: it and its neighbour become one. */
  private join(index: number, direction: 'backward' | 'forward'): boolean {
    const items = this.map.items
    const w = direction === 'backward' ? index - 1 : index
    const x = w + 1
    if (w < 0 || x >= items.length) return true
    const W = items[w]!
    const X = items[x]!
    if (W.kind === 'table' || X.kind === 'table') return true
    if (isVerbatim(W) || isVerbatim(X) || W.kind === 'fence' || X.kind === 'fence') return true
    const at = direction === 'backward' ? this.itemStartOffset(X) : this.itemEndOffset(W)
    let target: (m: PosMap) => number
    if (
      direction === 'backward' &&
      X.kind === 'item' &&
      W.kind !== 'item'
    ) {
      // the first item of a list: it is a paragraph before the list now
      target = (m) => m.posOf(x, 0)
    } else if (W.kind === 'empty' || X.kind === 'empty') {
      // an empty paragraph goes
      if (X.kind === 'empty') target = (m) => this.endOf(m, w)
      else target = (m) => m.posOf(w, 0)
    } else {
      const wl = this.map.reading(w)!.cells.length
      const xl = this.map.reading(x)!.cells.length
      const joiner = direction === 'backward' && wl > 0 && xl > 0 ? 1 : 0
      target = (m) => m.posOf(w, wl + joiner)
    }
    return this.commit({ kind: 'joinBlocks', at, direction }, (m) => target(m))
  }

  private itemStartOffset(it: Item): number {
    return it.kind === 'empty' ? it.from : it.block!.content!.from
  }
  private itemEndOffset(it: Item): number {
    return it.kind === 'empty' ? it.from : it.block!.content!.to
  }
  /** Backspace (`-1`) and Delete (`1`) in the text of a cell: one character, and nothing at the edge of the text (cells are not joined). */
  private deleteInCell(pos: number, direction: 1 | -1): boolean {
    const $ = this.view.state.doc.resolve(pos)
    if (!$.parent.isTextblock) return true
    const text = $.parent.textBetween(0, $.parent.content.size, undefined, '\ufffc')
    const o = $.parentOffset
    if (direction < 0 ? o === 0 : o >= text.length) return true
    let n = 1
    if (direction < 0 && o > 1 && /[\udc00-\udfff]/.test(text[o - 1]!) && /[\ud800-\udbff]/.test(text[o - 2]!)) n = 2
    if (direction > 0 && /[\ud800-\udbff]/.test(text[o]!) && /[\udc00-\udfff]/.test(text[o + 1] ?? '')) n = 2
    const from = direction < 0 ? pos - n : pos
    return this.textEdit({ from, to: from + n, text: '', marks: [] }, null)
  }

  private endOf(m: PosMap, index: number): number {
    if (m.items[index]!.kind === 'table') return m.starts[index]! + m.pm.child(index).nodeSize
    if (isVerbatim(m.items[index]!)) return m.posOf(index, m.verbLength(index))
    const r = m.reading(index)
    return m.posOf(index, r ? r.cells.length : 0)
  }

  private splitBlock(): boolean {
    if (this.inDraft()) return this.draftEnter()
    // Enter in code or in an island is a line break of its text; in a caption it does nothing (a caption is one line)
    const v = this.verbatimSel()
    if (v) return this.map.items[v.index]!.kind === 'image' ? this.fail(null, 'caption-one-line', 'A caption is one line') : this.verbatimEdit(v.index, v.k0, v.k1, '\n')
    // (a cell is one line: Enter in it does nothing, but at an item of a list of an `a` cell)
    if (this.tablePlace()) return this.enterInCell()
    if (!this.view.state.selection.empty && !this.deleteSelection()) return false
    const pos = this.view.state.selection.from
    const loc = this.map.locate(pos, this.view.state.doc)
    const it = this.map.items[loc.index]!
    if (it.kind === 'fence') return true
    // Enter at the end of the text of an item: a new item that is not in the text until something is typed in it
    const blank = (c: { kind: string; ch?: string }): boolean => c.kind === 'char' && /^\s$/.test(c.ch ?? '')
    const itemCells = it.kind === 'item' && loc.where === 'in' ? this.map.reading(loc.index)!.cells : []
    if (it.kind === 'item' && loc.where === 'in' && itemCells.slice(loc.cell).every(blank))
      return this.startDraftAfter(loc.index)
    if (it.kind === 'item' && loc.where === 'in' && itemCells.slice(0, loc.cell).every(blank))
      return this.fail(null, 'item-start', 'An item is split inside its text, or a new one is started at its end')
    const at = this.pointOffset(pos)!
    if (this.enterBeforeMeta(loc, it, at)) return true
    // the cursor goes to the start of the block after the split: a new empty paragraph, or the second half
    return this.commit({ kind: 'splitBlock', at }, (m) =>
      m.posOf(Math.min(loc.index + 1, m.items.length - 1), 0),
    )
  }

  /**
   * Enter at the end of the block right before the attributes of the header (the paragraph «Open in Confluence», say): the new
   * empty paragraph goes after the last of them, not between the block and them, which would take them out of the zone. The
   * text gets blank lines there and the cursor goes into the empty paragraph they make.
   */
  private enterBeforeMeta(loc: Located, it: Item, at: number): boolean {
    // (a pinned line toc::[] between the block and the attributes does not count)
    let n = loc.index + 1
    while (this.map.items[n]?.block?.label === TOC_PINNED) n++
    const next = this.map.items[n]
    const meta = this.meta
    if (!meta || !next || next.block?.fence !== 'meta' || it.kind === 'item' || at !== it.block?.content?.to) return false
    const end = meta.ranges[meta.ranges.length - 1]!.to
    const text = this.session.text
    const eol = text.includes('\r\n') ? '\r\n' : '\n'
    const blanks = /^(?:[ \t]*\r?\n)*/.exec(text.slice(end))![0].split('\n').length - 1
    const insert = (end === 0 || text[end - 1] === '\n' ? '' : eol) + (blanks >= 1 ? eol : eol + eol)
    this.write([{ from: end, to: end, insert }], { origin: this })
    this.sync(this.session.doc, (m) => {
      let last = -1
      m.items.forEach((x, i) => {
        if (x.block?.fence === 'meta') last = i
      })
      return last >= 0 && m.items[last + 1]?.kind === 'empty' ? m.posOf(last + 1, 0) : null
    })
    return true
  }

  private insertBreak(): boolean {
    if (this.inDraft()) return true
    const v = this.verbatimSel()
    if (v) return this.map.items[v.index]!.kind === 'image' ? this.fail(null, 'caption-one-line', 'A caption is one line') : this.verbatimEdit(v.index, v.k0, v.k1, '\n')
    if (this.tablePlace()) return true
    if (!this.view.state.selection.empty && !this.deleteSelection()) return false
    const pos = this.view.state.selection.from
    const loc = this.map.locate(pos, this.view.state.doc)
    const at = this.pointOffset(pos)
    if (at === null || loc.where !== 'in')
      return this.fail(null, 'not-editable', 'A line break goes into a paragraph')
    return this.commit({ kind: 'insertBreak', at }, (m) => m.posOf(loc.index, loc.cell + 1))
  }

  // ------------------------------------------------------------------ lists, drafts

  private itemKindOf(it: Item): ListKind | null {
    if (it.kind !== 'item') return null
    const b = it.block!
    if (b.checked !== '') return 'checklist'
    return /^(\.+|\d+\.)$/.test(b.marker) ? 'ordered' : 'unordered'
  }

  listAt(): ListState | null {
    const doc = this.view.state.doc
    const sel = this.view.state.selection
    if (sel instanceof NodeSelection || doc.childCount !== this.map.starts.length) return null
    const loc = this.map.locate(sel.head, doc)
    const it = this.map.items[loc.index]
    if (!it || loc.where !== 'in') return null
    if (this.draft && loc.index === draftIndex(this.draft)) {
      const d = this.draft
      if (d.kind !== 'item') return null
      return { kind: d.check ? 'checklist' : d.ordered ? 'ordered' : 'unordered', level: d.level, draft: true }
    }
    const kind = this.itemKindOf(it)
    return kind ? { kind, level: it.block!.level, draft: false } : null
  }

  /** Enter at the end of an item: an empty item after it that the text does not have yet. */
  private startDraftAfter(index: number): boolean {
    const b = this.map.items[index]!.block!
    this.draft = {
      mode: 'after',
      at: index + 1,
      kind: 'item',
      level: b.level,
      ordered: /^(\.+|\d+\.)$/.test(b.marker),
      check: b.checked !== '',
      prefix: '',
    }
    this.sync(this.map.doc, (m) => m.posOf(index + 1, 0))
    return true
  }

  /** Enter in an item that is only started. */
  private draftEnter(): boolean {
    const d = this.draft!
    if (d.mode === 'start') {
      // (nothing was typed after the marker: the paragraph is empty again)
      this.draft = null
      this.sync(this.map.doc, (m) => this.draftGone(m, d))
      return true
    }
    if (d.level > 1) {
      this.draft = { ...d, level: d.level - 1 }
      this.sync(this.map.doc, (m) => m.posOf(d.at, 0))
      return true
    }
    const x = this.map.items[d.at - 1]!
    const op: Operation = { kind: 'endList', at: x.block!.content!.from }
    const r = this.operate(op)
    if (!r) return false
    this.draft = null
    if (r.changes.length > 0) this.write(r.changes, { origin: this })
    this.sync(this.session.doc, (m) => m.posOf(Math.min(d.at, m.items.length - 1), 0))
    return true
  }

  /** Backspace in an item or heading that is only started: it is gone, and the text does not change. */
  private draftBackspace(): boolean {
    const d = this.draft!
    this.draft = null
    this.sync(this.map.doc, (m) => this.draftGone(m, d))
    return true
  }

  /** Tab (`delta` 1) or Shift-Tab (-1) in an item that is only started: its level changes on the screen. */
  private draftIndent(delta: number): boolean {
    const d = this.draft!
    const x = d.mode === 'after' ? this.map.items[d.at - 1]!.block! : null
    const level = d.level + delta
    if (d.kind !== 'item' || level < 1 || (x && level > x.level + 1) || !x)
      return this.fail(null, delta > 0 ? 'first-item' : 'top-level-item', delta > 0 ? 'The first item of a list has no item to go under' : 'An item of the first level cannot move out')
    this.draft = { ...d, level }
    this.sync(this.map.doc, (m) => m.posOf(d.at, 0))
    return true
  }

  /** The first thing typed in an item or heading that is only started: it is written in the text. */
  private typeInDraft(text: string): boolean {
    const d = this.draft!
    const items = this.map.items
    let op: Operation
    if (d.mode === 'after') op = { kind: 'insertItem', after: items[d.at - 1]!.block!.content!.from, level: d.level, text }
    else if (d.virtual && d.kind === 'heading')
      // (a heading takes the paragraphs after it into its section: the way `== ` typed in an empty line does, no check of the blocks that follow)
      op = { kind: 'placeBlock', at: items[d.at - 1]!.from, block: { kind: 'section', level: d.level, title: text } }
    else if (d.virtual && d.kind === 'item')
      // (after the block before it, with the blank lines; a list next to a list gets the line `//` between, as the engine does it)
      op = {
        kind: 'insertBlock',
        at: items[d.at - 1]!.from,
        where: 'after',
        block: { kind: 'list', list: d.check ? 'checklist' : d.ordered ? 'ordered' : 'unordered', items: [text] },
      }
    else if (d.virtual)
      // (after the block before it: the blank lines come with the block)
      op = {
        kind: 'placeBlock',
        at: items[d.at - 1]!.from,
        block: d.kind === 'collapsible' ? { kind: 'collapsible', title: d.title, text } : { kind: 'admonition', variant: 'NOTE', form: 'paragraph', text },
      }
    else if (d.kind === 'collapsible')
      op = { kind: 'placeBlock', at: items[d.at]!.from, replace: true, block: { kind: 'collapsible', title: d.title, text } }
    else op = { kind: 'startBlock', at: items[d.at]!.from, prefix: d.prefix, text }
    const r = this.operate(op)
    if (!r) return false
    this.draft = null
    if (r.changes.length > 0) this.write(r.changes, { origin: this, group: d.kind !== 'collapsible' })
    // (the text of a collapsible block is in the paragraph inside its box)
    const from = items[d.at]!.from
    // (a list put after a list has the line `//` before it: the item is found by where the text went)
    const change = r.changes[0]
    const typedAt = d.virtual && (d.kind === 'heading' || d.kind === 'item') && change ? change.from + change.insert.lastIndexOf(text) + text.length : -1
    this.sync(this.session.doc, (m) => {
      if (typedAt >= 0) {
        const placed = m.items.findIndex((x) => (x.kind === 'heading' || x.kind === 'item') && x.from <= typedAt && typedAt <= x.to)
        if (placed >= 0) return this.endOf(m, placed)
      }
      if (d.kind !== 'collapsible') return this.endOf(m, d.at)
      const open = m.items.findIndex((x) => x.kind === 'fence' && x.from >= from && x.block!.fence === 'open')
      return this.endOf(m, Math.min(open + 1, m.items.length - 1))
    })
    return true
  }

  /**
   * A space typed after a marker in a paragraph that nothing else was typed in (`*`, `-`, `.`, `1.`, `==` … `======`): the paragraph
   * is empty again and an item or a heading is started in its place, until its first sign is typed.
   */
  private startFromMarker(index: number): boolean {
    const typed = this.typedInEmpty
    const it = this.map.items[index]
    if (!typed || typed.doc !== this.session.doc || typed.index !== index || !it || it.kind !== 'paragraph') return false
    const b = it.block!
    if (b.meta || b.variant) return false
    const text = this.session.text.slice(b.content!.from, b.content!.to)
    const sel = this.view.state.selection
    if (!sel.empty || this.map.locate(sel.from, this.view.state.doc).cell !== this.map.reading(index)!.cells.length) return false
    const m = /^(\*|-|\.|\d+\.|={2,6})$/.exec(text)
    if (!m) return false
    const op: Operation = { kind: 'deleteRange', from: b.content!.from, to: b.content!.to }
    const r = this.operate(op)
    if (!r) return false
    const again = layoutItems(readLayout(r.doc))
    if (again.length !== this.map.items.length || again[index]?.kind !== 'empty') return false
    const heading = text.startsWith('=')
    this.write(r.changes, { origin: this })
    this.typedInEmpty = null
    // (the screen follows the text first: an item that is only started belongs to the text it was started in)
    this.sync(this.session.doc, (mm) => mm.posOf(index, 0))
    this.draft = {
      mode: 'start',
      at: index,
      kind: heading ? 'heading' : 'item',
      level: heading ? text.length : 1,
      ordered: /^(\.|\d+\.)$/.test(text),
      check: false,
      prefix: text + ' ',
    }
    this.sync(this.session.doc, (mm) => mm.posOf(index, 0))
    return true
  }

  private toggleList(kind: ListKind): boolean {
    this.leaveDraft()
    const doc = this.view.state.doc
    const sel = this.view.state.selection
    if (sel instanceof NodeSelection) return this.fail(null, 'not-editable', 'This block is edited in the source')
    const a = this.map.locate(sel.from, doc)
    const b = this.map.locate(sel.to, doc)
    const first = this.map.items[a.index]!
    const list: ListKind | null = this.itemKindOf(first) === kind ? null : kind
    const at = this.startOffset(sel.from)
    const to = this.endOffset(sel.to)
    if (at === null || to === null) return false
    const op: Operation = { kind: 'toggleList', at, list, ...(a.index !== b.index ? { to } : {}) }
    const ca = a.where === 'in' ? a.cell : 0
    const cb = b.where === 'in' ? b.cell : 0
    return this.commit(op, (m, d) => {
      const pa = this.cursorAt(m, a.index, ca)
      const pb = this.cursorAt(m, b.index, cb)
      return pa === null || pb === null ? null : between(d, pa, pb)
    })
  }

  private indentList(delta: number): boolean {
    if (this.inDraft()) return this.draftIndent(delta)
    const doc = this.view.state.doc
    const loc = this.map.locate(this.view.state.selection.head, doc)
    const it = this.map.items[loc.index]
    if (!it || it.kind !== 'item') return false
    const at = it.block!.content!.from
    const cell = loc.where === 'in' ? loc.cell : 0
    const code = delta > 0 ? 'indentListItem' : 'outdentListItem'
    return this.commit({ kind: code, at }, (m) => this.cursorAt(m, loc.index, cell))
  }

  private setChecked(checked?: boolean, offset?: number): boolean {
    this.leaveDraft()
    const doc = this.view.state.doc
    const index =
      offset === undefined
        ? this.map.locate(this.view.state.selection.head, doc).index
        : this.map.itemAt(Math.max(0, Math.min(offset, this.session.text.length))).index
    const it = this.map.items[index]
    if (!it || it.kind !== 'item' || it.block!.checked === '') return false
    const want = checked ?? it.block!.checked === ' '
    return this.commit({ kind: 'setChecked', at: it.block!.content!.from, checked: want }, 'keep')
  }

  // ------------------------------------------------------------------ admonitions, collapsible blocks

  private setAdmonitionType(variant: AdmonitionVariant): boolean {
    this.leaveDraft()
    const at = this.pointOffset(this.view.state.selection.head)
    return at === null ? false : this.commit({ kind: 'setAdmonitionType', at, variant }, 'keep')
  }

  admonitionAt(): AdmonitionState | null {
    const doc = this.view.state.doc
    const sel = this.view.state.selection
    if (sel instanceof NodeSelection || doc.childCount !== this.map.starts.length) return null
    const idx = this.map.indexAt(sel.head, doc)
    const it = this.map.items[idx]
    if (!it) return null
    if (it.kind === 'paragraph' && it.block!.variant)
      return { variant: it.block!.variant as AdmonitionVariant, form: 'paragraph', rect: this.rectOf(idx, idx) }
    const box = this.boxes().byIndex[idx]
    if (box && box.box === 'admonition' && it.kind !== 'fence')
      return { variant: box.variant as AdmonitionVariant, form: 'block', rect: this.rectOf(box.start, box.end) }
    return null
  }

  boxAt(): 'admonition' | 'collapsible' | null {
    const doc = this.view.state.doc
    const sel = this.view.state.selection
    if (doc.childCount !== this.map.starts.length) return null
    const box = this.boxes().byIndex[this.map.indexAt(sel.head, doc)]
    return box ? box.box : null
  }

  private rectOf(i: number, j: number): AdmonitionState['rect'] {
    try {
      const a = this.view.nodeDOM(this.map.starts[i]!) as HTMLElement | null
      const b = this.view.nodeDOM(this.map.starts[j]!) as HTMLElement | null
      if (!a || !b || typeof a.getBoundingClientRect !== 'function') return null
      const ra = a.getBoundingClientRect()
      const rb = b.getBoundingClientRect()
      return {
        top: ra.top,
        left: Math.min(ra.left, rb.left),
        right: Math.max(ra.right, rb.right),
        bottom: rb.bottom,
      }
    } catch {
      return null
    }
  }

  /** The boxes among the items (cached while the items and the open ones are the same). */
  private boxes(): Boxes {
    const c = this.boxCache
    if (c && c.map === this.map && c.version === this.openVersion) return c.data
    const byIndex: (BoxAt | null)[] = this.map.items.map(() => null)
    const list: BoxAt[] = []
    let cur: { start: number; offset: number; box: 'admonition' | 'collapsible'; variant: string; open: boolean } | null = null
    this.map.items.forEach((it, i) => {
      if (it.kind !== 'fence') return
      const b = it.block!
      if (b.fence === 'open') {
        const open = b.box === 'admonition' ? true : (this.opened.get(it.from) ?? b.startsOpen)
        cur = { start: i, offset: it.from, box: b.box as 'admonition' | 'collapsible', variant: b.variant, open }
      } else if (b.fence === 'close' && cur) {
        const box: BoxAt = { ...cur, end: i }
        list.push(box)
        for (let k = box.start; k <= i; k++) byIndex[k] = box
        cur = null
      }
    })
    const data = { byIndex, list }
    this.boxCache = { map: this.map, version: this.openVersion, data }
    return data
  }

  private decoCache: { doc: PMNode; map: PosMap; version: number; set: DecorationSet } | null = null

  /** The classes of the nodes of a box, and the hidden nodes of a collapsible block that is closed. */
  private boxDecorations(): DecorationSet {
    const doc = this.view?.state.doc
    if (!doc || doc.childCount !== this.map.starts.length) return DecorationSet.empty
    const c = this.decoCache
    if (c && c.doc === doc && c.map === this.map && c.version === this.openVersion) return c.set
    const out: Decoration[] = []
    for (const b of this.boxes().list) {
      for (let i = b.start; i <= b.end; i++) {
        const start = this.map.starts[i]!
        const node = doc.child(i)
        const cls = ['in-box', b.box === 'admonition' ? `box-adm adm adm-${b.variant}` : `box-coll ${b.open ? 'open' : 'closed'}`]
        if (i === b.start) cls.push('box-first')
        if (i === b.end) cls.push('box-last')
        const attrs: Record<string, string> = {}
        if (b.box === 'collapsible') {
          if (i === b.start) attrs['aria-expanded'] = b.open ? 'true' : 'false'
          else if (!b.open) {
            cls.push('nota-hidden')
            attrs.style = 'display:none'
          }
        }
        out.push(Decoration.node(start, start + node.nodeSize, { ...attrs, class: cls.join(' ') }))
      }
    }
    const set = DecorationSet.create(doc, out)
    this.decoCache = { doc, map: this.map, version: this.openVersion, set }
    return set
  }

  /** The open state of the blocks follows the text: a change moves the offsets they are kept at. */
  private shiftOpened(changes: readonly Change[]): void {
    if (this.opened.size === 0 || changes.length === 0) return
    const next = new Map<number, boolean>()
    for (const [offset, open] of this.opened) next.set(mapOffset(changes, offset, 1), open)
    this.opened = next
    this.openVersion++
  }

  /**
   * The cursor of a new editor is not in a collapsible block that is closed (it would open it): it goes to the first text after
   * the block. The boxes are drawn once the editor has a view, so this is also what draws them.
   */
  private startOutsideClosedBox(): void {
    const doc = this.view.state.doc
    const tr = this.view.state.tr.setMeta(OWN, true)
    if (doc.childCount === this.map.starts.length) {
      const b = this.boxes().byIndex[this.map.indexAt(this.view.state.selection.head, doc)]
      if (b && b.box === 'collapsible' && !b.open) {
        const after = this.map.starts[b.end]! + doc.child(b.end).nodeSize
        const sel = TextSelection.near(doc.resolve(Math.min(after, doc.content.size)), 1)
        if (this.boxes().byIndex[this.map.indexAt(sel.head, doc)] !== b) tr.setSelection(sel)
      }
    }
    this.view.dispatch(tr)
  }

  /** A cursor that is inside a collapsible block that is closed opens it. */
  private ensureOpen(): void {
    const doc = this.view.state.doc
    if (this.opened.size === 0 && !this.map.items.some((it) => it.kind === 'fence')) return
    if (doc.childCount !== this.map.starts.length) return
    const idx = this.map.indexAt(this.view.state.selection.head, doc)
    const b = this.boxes().byIndex[idx]
    if (!b || b.box !== 'collapsible' || b.open || idx <= b.start) return
    this.opened.set(b.offset, true)
    this.openVersion++
    this.view.updateState(this.view.state.apply(this.view.state.tr.setMeta(OWN, true)))
  }

  private toggleCollapsible(offset?: number): boolean {
    this.leaveDraft()
    const doc = this.view.state.doc
    const idx =
      offset === undefined
        ? this.map.indexAt(this.view.state.selection.head, doc)
        : this.map.itemAt(Math.max(0, Math.min(offset, this.session.text.length))).index
    const b = this.boxes().byIndex[idx]
    if (!b || b.box !== 'collapsible') return false
    const open = !b.open
    this.opened.set(b.offset, open)
    this.openVersion++
    const tr = this.view.state.tr.setMeta(OWN, true)
    if (open) {
      // the cursor goes into the first text of the block
      for (let i = b.start + 1; i < b.end; i++) {
        const it = this.map.items[i]!
        if (isTextItem(it) || it.kind === 'empty') {
          tr.setSelection(TextSelection.create(tr.doc, this.map.posOf(i, 0)))
          break
        }
      }
    } else if (this.map.indexAt(this.view.state.selection.head, doc) > b.start) {
      // (a cursor in a block that closes would open it again: it goes after the block)
      const after = this.map.starts[b.end]! + doc.child(b.end).nodeSize
      tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(after, tr.doc.content.size)), 1))
    }
    this.view.updateState(this.view.state.apply(tr))
    this.ensureOpen()
    return true
  }

  /** The index of the node whose DOM element is `dom`, or -1. */
  private indexOfDom(dom: Element): number {
    const starts = this.map.starts
    for (let i = 0; i < starts.length; i++) if (this.view.nodeDOM(starts[i]!) === dom) return i
    return -1
  }

  private onMouseDown(event: MouseEvent): boolean {
    const target = event.target as Element | null
    if (!target || typeof target.closest !== 'function' || event.button > 0) return false
    // Shift-click on a cell of a table: the cells are selected, not the text across them
    if (event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey) {
      const cell = target.closest('td, th')
      if (cell && this.view.dom.contains(cell) && this.selectCells(event, cell)) return true
    } else {
      // a press without Shift lets the cells go, and may begin a drag across the cells
      const cell = target.closest('td, th')
      if (this.drag) this.drag = null
      if (cell && this.view.dom.contains(cell)) this.startDrag(cell)
      if (this.cellSel) {
        this.cellSel = null
        this.view.dispatch(this.view.state.tr.setMeta(OWN, true).setMeta(CELLS, true))
      }
    }
    const collapse = target.closest('.island-collapse')
    if (collapse && this.view.dom.contains(collapse)) {
      event.preventDefault()
      this.collapsePageMeta()
      return true
    }
    const head = target.closest('.coll-head')
    if (head && this.view.dom.contains(head)) {
      const i = this.indexOfDom(head)
      if (i < 0) return false
      event.preventDefault()
      this.toggleCollapsible(this.map.items[i]!.from)
      return true
    }
    const chk = target.closest('.chk')
    const li = chk?.closest('.li')
    if (chk && li && this.view.dom.contains(li)) {
      const i = this.indexOfDom(li)
      const it = this.map.items[i]
      if (i < 0 || !it || it.kind !== 'item') return false
      event.preventDefault()
      this.setChecked(undefined, it.block!.content!.from)
      return true
    }
    return false
  }

  /** The keys of the title of a collapsible block, and the arrows that pass a closed one. */
  private onKeyDown(event: KeyboardEvent): boolean {
    if (event.key === 'Escape' && this.cellSel && this.cellCapsuleShown && !event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey) {
      // (the capsule hides itself, the cells stay; the next Esc lets them go. The Esc is taken: the row of tables stays open)
      event.preventDefault()
      return false
    }
    if (event.key === 'Escape' && this.cellSel && !event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey) {
      // (the first Esc lets the cells go; the panel of tables stays for the second)
      event.preventDefault()
      this.cellSel = null
      this.view.dispatch(this.view.state.tr.setMeta(OWN, true).setMeta(CELLS, true))
      return true
    }
    if (event.key === 'Escape' && this.metaOpen && !event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey) {
      // (Esc in the header that is open puts it out of sight)
      const kind = this.view.state.selection.$head.parent.attrs.kind as string | undefined
      if (kind === 'PageMeta' || kind === 'PageMetaTail' || kind === 'PageMetaBody') {
        event.preventDefault()
        return this.collapsePageMeta()
      }
    }
    if (this.diagramKey(event)) return true
    const target = event.target as Element | null
    const head = target && typeof target.closest === 'function' ? target.closest('.coll-head') : null
    if (head && (event.key === 'Enter' || event.key === ' ')) {
      const i = this.indexOfDom(head)
      if (i < 0) return false
      event.preventDefault()
      this.toggleCollapsible(this.map.items[i]!.from)
      return true
    }
    if ((event.key !== 'ArrowDown' && event.key !== 'ArrowUp') || event.shiftKey || event.altKey || event.metaKey || event.ctrlKey)
      return false
    const state = this.view.state
    if (!state.selection.empty || state.doc.childCount !== this.map.starts.length) return false
    const down = event.key === 'ArrowDown'
    const idx = this.map.indexAt(state.selection.head, state.doc)
    const next = this.map.items[idx + (down ? 1 : -1)]
    // the neighbour is a closed block: down, its first line; up, its last (hidden) line
    const boxes = this.boxes()
    const nb = boxes.byIndex[idx + (down ? 1 : -1)]
    if (!next || !nb || nb.box !== 'collapsible' || nb.open || boxes.byIndex[idx] === nb) return false
    try {
      if (!this.view.endOfTextblock(down ? 'down' : 'up')) return false
    } catch {
      return false
    }
    const doc = state.doc
    let pos: number
    if (down) pos = this.map.starts[nb.end]! + doc.child(nb.end).nodeSize
    else pos = this.map.starts[nb.start]!
    const sel = TextSelection.near(doc.resolve(Math.min(pos, doc.content.size)), down ? 1 : -1)
    event.preventDefault()
    this.view.dispatch(state.tr.setSelection(sel).setMeta(OWN, true))
    return true
  }

  /** The diagram the cursor is in is marked (before the cursor is drawn, so that its code is there to hold it); the others show only the picture. */
  private editingDecoration(state: EditorState): DecorationSet | null {
    const $h = state.selection.$head
    if ($h.depth !== 1 || $h.parent.type !== schema.nodes.diagram) return null
    return DecorationSet.create(state.doc, [Decoration.node($h.before(), $h.after(), { class: 'editing' })])
  }

  /**
   * Esc in a diagram leaves it for the block after it; an arrow that would leave the text for the block next to a diagram goes into
   * its code (the code is hidden, so the browser has no caret to move into it).
   */
  private diagramKey(event: KeyboardEvent): boolean {
    if (event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) return false
    const state = this.view.state
    const sel = state.selection
    if (!(sel instanceof TextSelection)) return false
    const $h = sel.$head
    if ($h.depth !== 1) return false
    if (event.key === 'Escape') {
      if ($h.parent.type !== schema.nodes.diagram) return false
      const after = $h.after()
      const next = TextSelection.near(state.doc.resolve(Math.min(after, state.doc.content.size)), 1)
      if (next.$head.parent.type === schema.nodes.diagram) return false
      event.preventDefault()
      this.view.dispatch(state.tr.setSelection(next).setMeta(OWN, true))
      return true
    }
    const dir = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : 0
    if (dir === 0 || !sel.empty || $h.parent.type === schema.nodes.diagram) return false
    const neighbour = state.doc.maybeChild($h.index(0) + dir)
    if (!neighbour || neighbour.type !== schema.nodes.diagram) return false
    try {
      const towards = event.key === 'ArrowDown' ? 'down' : event.key === 'ArrowUp' ? 'up' : event.key === 'ArrowRight' ? 'right' : 'left'
      if (!this.view.endOfTextblock(towards)) return false
    } catch {
      return false
    }
    const start = dir > 0 ? $h.after() + 1 : $h.before() - 1 - neighbour.content.size
    const pos = dir > 0 ? start : start + neighbour.content.size
    event.preventDefault()
    this.view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, pos)).setMeta(OWN, true))
    return true
  }

  /** The text block of a cell that holds both ends of the selection, with the place of its start; null when they are not in one. */
  private cellTextSel(): { index: number; a: TableLoc; blk: TextBlock } | null {
    const sel = this.view.state.selection
    const a = this.tablePlace(sel.from)
    const b = this.tablePlace(sel.to)
    if (!a || !b || a.index !== b.index) return null
    const x = a.loc
    const y = b.loc
    if (x.nodePos !== y.nodePos || x.row !== y.row || x.cellIdx !== y.cellIdx || x.block === null || x.block !== y.block) return null
    const blk = x.cell.blocks[x.block]
    return blk && blk.kind === 'text' && x.offset !== null && y.offset !== null ? { index: a.index, a: x, blk } : null
  }

  /** The cursor is in the text of a cell that is shown as text (`l|`, an escaped bar, csv): marks and links are not for it. */
  private plainCellSel(): boolean {
    const t = this.cellTextSel()
    return t !== null && !t.blk.readable
  }

  private range(): { from: number; to: number } | null {
    const sel = this.view.state.selection
    // (in a table: the text of one cell that is read like a paragraph; a range over cells is not a range of the text)
    if (this.tablePlace(sel.from) || this.tablePlace(sel.to)) {
      const t = this.cellTextSel()
      if (!t || !t.blk.readable) return null
      return { from: this.tableOffset(t.index, sel.from, 'start'), to: this.tableOffset(t.index, sel.to, 'end') }
    }
    const from = this.startOffset(sel.from)
    const to = this.endOffset(sel.to)
    return from === null || to === null ? null : { from, to }
  }

  /** Why a mark, a link or a colour has no range to go on: a cell shown as text says so, the rest is a range that is not text. */
  private rangeFailure(message: string): false {
    return this.plainCellSel() ? this.fail(null, 'cell-text', CELL_TEXT) : this.fail(null, 'invalid-range', message)
  }

  private toggleMark(alias: string): boolean {
    const name = MARK_ALIASES[alias]
    if (!name) return this.fail(null, 'unknown-mark', `There is no mark ${alias}`)
    const view = this.view
    const st = view.state
    if (st.selection.empty) {
      if (this.plainCellSel()) return this.fail(null, 'cell-text', CELL_TEXT)
      // no text selected: the mark is for what is typed next
      const type = schema.marks[name]!
      const marks = st.storedMarks ?? st.selection.$from.marks()
      const has = marks.some((m) => m.type === type)
      view.dispatch(
        st.tr.setStoredMarks(has ? marks.filter((m) => m.type !== type) : type.create().addToSet(marks)),
      )
      return true
    }
    const r = this.range()
    // (a selection that reaches into a table is not a range of the text: it is told, not ignored)
    if (!r) return this.rangeFailure('This place cannot be marked')
    return this.commit({ kind: 'toggleMark', from: r.from, to: r.to, mark: name }, 'keep', true)
  }

  private setLink(target: string): boolean {
    const r = this.range()
    if (!r) return this.rangeFailure('This place cannot be linked')
    return this.commit({ kind: 'setLink', from: r.from, to: r.to, target }, 'keep', true)
  }

  private removeLink(): boolean {
    const at = this.pointOffset(this.view.state.selection.from)
    return at === null ? false : this.commit({ kind: 'removeLink', at }, 'keep', true)
  }

  colorAt(): readonly string[] {
    const st = this.view.state
    const { from, to, empty, $from } = st.selection
    const rolesOfMarks = (marks: readonly Mark[]): string[] =>
      marks.flatMap((m) => (m.type === schema.marks.roles ? roleNames(m.attrs.attrs as string) : []))
    if (empty) return [...new Set(rolesOfMarks(st.storedMarks ?? $from.marks()))]
    let common: string[] | null = null
    st.doc.nodesBetween(from, to, (node) => {
      if (!node.isText) return true
      const here = rolesOfMarks(node.marks)
      common = common === null ? [...new Set(here)] : common.filter((r) => here.includes(r))
      return false
    })
    return common ?? []
  }

  /** A colour role of one family (letters or fill) over the selection: the other roles of the family go, and the role comes. */
  private setColorOf(family: readonly string[], role: string | null): boolean {
    const r = this.range()
    if (!r) return this.rangeFailure('This place cannot be coloured')
    if (this.view.state.selection.empty || r.from === r.to)
      return this.fail(null, 'empty-selection', 'Select some text first')
    let doc = this.session.doc
    const present = new Set<string>()
    for (const run of doc.colors()) if (family.includes(run.role) && run.from < r.to && run.to > r.from) present.add(run.role)
    const wanted: ((from: number, to: number) => Operation)[] = []
    for (const p of present)
      if (p !== role) wanted.push((from, to) => ({ kind: 'removeColor', from, to, role: p }))
    if (role !== null) wanted.push((from, to) => ({ kind: 'setColor', from, to, role }))
    let changes: Change[] = []
    let literal = true
    let last: Operation | null = null
    for (const make of wanted) {
      // the range is in the text as the earlier steps left it
      const op = make(mapOffset(changes, r.from, -1), mapOffset(changes, r.to, 1))
      last = op
      const res = applyOperation(doc, op)
      if ('error' in res) {
        this.fail(op, res.error, res.diagnostics[0]?.message ?? res.error)
        return false
      }
      if (res.literal === false) literal = false
      changes = composeChanges(changes, res.changes as Change[])
      doc = res.doc
    }
    if (changes.length === 0) return true
    if (!literal && last) this.options.onInexact?.(last)
    this.write(changes, { origin: this })
    this.sync(this.session.doc, 'keep')
    return true
  }

  private setBlockType(style: BlockStyle, lvl?: number, toggle = false): boolean {
    let type: 'paragraph' | 'heading' = 'paragraph'
    let level = lvl
    if (typeof style === 'object') ({ type, level = lvl } = style)
    else if (style === 'heading') type = 'heading'
    else if (style !== 'paragraph' && style !== 'p') {
      type = 'heading'
      level = Number(style.slice(1))
    }
    if (type === 'heading' && (level === undefined || level < 2 || level > 6)) return false
    const lv = type === 'heading' ? level! : 0
    const st = this.view.state
    if (toggle) {
      // a heading that is only started: the same level takes it back, another level changes it
      const d = this.draft
      if (d && d.kind === 'heading' && this.inDraft()) {
        if (type === 'paragraph' || d.level === lv) this.dropDraft()
        else {
          const next: Draft = { ...d, level: lv, prefix: '='.repeat(lv) + ' ' }
          this.draft = next
          this.sync(this.session.doc, (m) => m.posOf(draftIndex(next), 0))
        }
        return true
      }
      // the menu of «/» is open: the keys of «Заголовок 2» … «Заголовок 6» pick it, the rest do nothing
      if (this.slashAt()) return type === 'heading' && lv >= 2 && lv <= 6 ? this.insertKind(`heading${lv}` as InsertKind, {}) : true
    }
    this.leaveDraft()
    if (st.doc.childCount !== this.map.starts.length) return false
    const items = this.map.items
    const first = this.map.locate(st.selection.from, st.doc).index
    let last = first
    if (!st.selection.empty) {
      const to = this.map.locate(st.selection.to, st.doc)
      last = to.index
      // (a selection that ends at the very start of a block does not take the block)
      if (last > first && to.cell === 0) last--
    }
    const text: number[] = []
    let blocked = false
    for (let i = first; i <= last; i++) {
      const it = items[i]
      if (!it) continue
      if (it.kind === 'item' || it.kind === 'table' || (it.kind === 'paragraph' && it.block!.variant)) blocked = true
      else if (it.kind === 'paragraph' || it.kind === 'heading') text.push(i)
    }
    const single = st.selection.empty
    // an empty line: a heading is started there, written with its first letter
    if (single && items[first]?.kind === 'empty') {
      if (type === 'paragraph' || !toggle) return true
      const d: Draft = { mode: 'start', at: first, kind: 'heading', level: lv, ordered: false, check: false, prefix: '='.repeat(lv) + ' ' }
      this.draft = d
      this.sync(this.session.doc, (m) => m.posOf(draftIndex(d), 0))
      return true
    }
    const candidates = text.filter((i) => items[i]!.block!.level !== 1 || single)
    if (candidates.length === 0) {
      if (blocked && type === 'heading')
        return this.fail(null, 'style-off', 'A heading cannot be set here: the style does not change in a list item, a table cell or an admonition.')
      return true
    }
    const every = candidates.every((i) => {
      const b = items[i]!.block!
      return type === 'paragraph' ? b.kind === 'paragraph' : b.kind === 'heading' && b.level === lv
    })
    const target = toggle && every ? 'paragraph' : type
    let doc = this.session.doc
    let changes: Change[] = []
    let literal = true
    let lastOp: Operation | null = null
    // from the last block to the first: a change of one block does not move the places of the blocks before it
    for (const i of [...candidates].reverse()) {
      const op: Operation = { kind: 'setBlockType', at: items[i]!.from, type: target, level: lv }
      const res = applyOperation(doc, op)
      if ('error' in res) {
        this.fail(op, res.error, res.diagnostics[0]?.message ?? res.error)
        return false
      }
      if (res.literal === false) literal = false
      if (res.changes.length === 0) continue
      lastOp = op
      changes = composeChanges(changes, res.changes as Change[])
      doc = res.doc
    }
    if (changes.length === 0) return true
    if (!literal && lastOp) this.options.onInexact?.(lastOp)
    this.write(changes, { origin: this })
    this.sync(this.session.doc, 'keep')
    return true
  }
}

const between = (doc: PMNode, a: number, h: number): Selection =>
  TextSelection.between(doc.resolve(a), doc.resolve(h))

function shiftBlock(b: BlockInfo | null, delta: number): BlockInfo | null {
  if (!b) return b
  return {
    ...b,
    from: b.from + delta,
    to: b.to + delta,
    meta: b.meta ? { from: b.meta.from + delta, to: b.meta.to + delta } : null,
    content: b.content ? { from: b.content.from + delta, to: b.content.to + delta } : null,
    markerFrom: b.markerFrom < 0 ? b.markerFrom : b.markerFrom + delta,
  }
}

/** Where the cursor goes after an undo or a redo: the end of the last replacement, in the new text. */
function cursorAfter(changes: readonly { from: number; to?: number; insert?: string }[]): number {
  let delta = 0
  let end = 0
  for (const c of changes) {
    const insert = c.insert ?? ''
    end = c.from + delta + insert.length
    delta += insert.length - ((c.to ?? c.from) - c.from)
  }
  return end
}

/** Some line of `text` is a preprocessor directive (`ifdef::`, `ifndef::`, `ifeval::`, `endif::`, `include::`), escaped or not. */
const hasDirective = (text: string): boolean => /^\\?(?:ifn?def|ifeval|endif|include)::/m.test(text)

/** `text` holds `{set:…}`, `{counter:…}` or `{counter2:…}`: an attribute entry written inside a line. */
const setsEntry = (text: string): boolean => /\{(?:set|counter2?):/.test(text)

/** The one replacement that turns the inline content of `a` into that of `b` (positions inside the block). */
function diffInline(
  a: PMNode,
  b: PMNode,
  hint?: number,
): { from: number; to: number; text: string; marks: readonly Mark[] } | null {
  if (a.type !== b.type) return null
  const flat = (n: PMNode): { s: string; marks: (readonly Mark[])[] } => {
    let s = ''
    const marks: (readonly Mark[])[] = []
    n.forEach((c) => {
      if (c.isText) {
        for (let i = 0; i < c.text!.length; i++) {
          s += c.text![i]
          marks.push(c.marks)
        }
      } else {
        s += '￼'
        marks.push(c.marks)
      }
    })
    return { s, marks }
  }
  const x = flat(a)
  const y = flat(b)
  let p = 0
  const max = Math.min(x.s.length, y.s.length)
  // (text that equals its neighbour: it was put in where the composition began, not later)
  const cap = hint === undefined || hint < 0 ? max : Math.min(max, hint)
  while (p < cap && x.s[p] === y.s[p]) p++
  let q = 0
  while (q < max - p && x.s[x.s.length - 1 - q] === y.s[y.s.length - 1 - q]) q++
  return { from: p, to: x.s.length - q, text: y.s.slice(p, y.s.length - q), marks: y.marks[p] ?? [] }
}

/** Creates a visual editor in `element`, on the text of `options.session`. */
export function createVisualEditor(element: HTMLElement, options: VisualEditorOptions): VisualEditor {
  return new Editor(element, options.session, options)
}

/** The text at `from` is a plate (a block that is edited in the source), not text and not an empty paragraph. */
function becomesPlate(doc: NotaDocument, from: number, was: BlockInfo): boolean {
  const now = layoutItems(readLayout(doc)).find((it) => it.from === from)
  return now?.kind === 'chip' || (!!now?.block && (now.block.kind !== was.kind || now.block.variant !== was.variant))
}

/** The number of plain blanks that start the cells (the ones that a text cannot be written to start with). */
function startingBlanks(cells: readonly { ch: string; spans: readonly unknown[] }[]): number {
  let n = 0
  while (n < cells.length && cells[n]!.ch === ' ' && cells[n]!.spans.length === 0) n++
  return n
}
