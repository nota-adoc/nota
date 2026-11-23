/**
 * `applyOperation`: the operations of the editors on the text of a document, as replacements of it. An operation
 * never changes anything but its target: what it writes is read again and checked, and it either gives the
 * changes and the document after them, or an error and no change.
 */
import { type NotaDocument, assertDocument } from '../document.js'
import { type Change, composeChanges, mapOffset } from '../changes.js'
import { type OperationFailure, type OperationResult, failure, isFailure, outsideText } from './common.js'
import { emptyItemAt, joinItems, resolvePoint, setItemType, splitItem } from './blocks.js'
import { colorOperation } from './colors.js'
import { removeLink, setLink } from './links.js'
import { type MarkName, toggleMark } from './marks.js'
import { type TypedMarks, deleteRange, editInline, insertBreak, insertText } from './text.js'
import { inlineBlockAround } from './cell.js'
import { endList, insertItem, setAdmonitionType, setChecked, splitListItem, startBlock } from './items.js'
import type { AdmonitionVariant } from './blockspec.js'
import { makeCtx } from './window.js'
import type { BlockKindName, BlockSpec } from './blockspec.js'
import { type ListKind, indentListItem, outdentListItem, toggleList } from './lists.js'
import type { StyleProfile } from './profile.js'
import { deleteBlock, envOf, insertBlock, lazyEnvOf, moveBlock, replaceBlock, setSectionLevel } from './structure.js'
import * as tables from './tables.js'
import { appendEmpty, placeBlock, setCaption, setCodeLanguage, setCodeText, setIslandText } from './verbatim.js'

export type { MarkName } from './marks.js'
export type { TypedMarks } from './text.js'
export type { AdmonitionVariant, BlockKindName, BlockSpec } from './blockspec.js'
export type { ListKind } from './lists.js'
export type { OperationFailure, OperationOk, OperationResult } from './common.js'

/** An operation on the text of a document. Positions are offsets of its text. */
export type Operation =
  /** Text typed at `at`; it gets the marks that hold the position (the caller picks the place among the markers). */
  | { readonly kind: 'insertText'; readonly at: number; readonly text: string; readonly marks?: TypedMarks }
  /** The text `from`–`to` deleted: inside a block, or over several blocks (what is left of the two ends is one block). */
  | { readonly kind: 'deleteRange'; readonly from: number; readonly to: number }
  /** `from`–`to` deleted and `text` typed in its place, as one step. */
  | {
      readonly kind: 'replaceText'
      readonly from: number
      readonly to: number
      readonly text: string
      readonly marks?: TypedMarks
    }
  /** A mark over the text `from`–`to`, or off it; `on` undefined: on unless all of it has the mark. */
  | {
      readonly kind: 'toggleMark'
      readonly from: number
      readonly to: number
      readonly mark: MarkName
      readonly on?: boolean
    }
  /** A link over the text `from`–`to` (in one paragraph), or a new target for the link there. */
  | { readonly kind: 'setLink'; readonly from: number; readonly to: number; readonly target: string }
  /** The link that holds `at` becomes plain text. */
  | { readonly kind: 'removeLink'; readonly at: number }
  /** Enter: the block that holds `at` splits there (at its end an empty paragraph follows). */
  | { readonly kind: 'splitBlock'; readonly at: number }
  /** Shift-Enter: a hard line break at `at`. */
  | { readonly kind: 'insertBreak'; readonly at: number }
  /** Backspace (`backward`, default) at the start of the block that holds `at`, or Delete (`forward`) at its end. */
  | { readonly kind: 'joinBlocks'; readonly at: number; readonly direction?: 'backward' | 'forward' }
  /** The style of the block that holds `at`: a paragraph, or a heading of `level` 2–6. */
  | {
      readonly kind: 'setBlockType'
      readonly at: number
      readonly type: 'paragraph' | 'heading'
      readonly level?: number
    }
  /** The title of the section that holds `at` gets `level` (the number of `=`, 2–6); its subsections move with it. */
  | { readonly kind: 'setSectionLevel'; readonly at: number; readonly level: number }
  /**
   * A new block next to the block that holds `at` (in its container: the document, a section, a block that holds blocks,
   * a cell `a|`, an item of a list); a position in a blank line puts it there. `block`: what to write (in the style of the
   * document), or a fragment of AsciiDoc `{ source, expect? }`.
   */
  | { readonly kind: 'insertBlock'; readonly at: number; readonly where: 'before' | 'after'; readonly block: BlockSpec }
  /**
   * The block that holds `at` (a section with its subsections whole) goes to the place `to`: before the block that holds
   * it, when `to` is in its first line, after it otherwise, or where a blank line is. Into itself: `invalid-target`.
   */
  | { readonly kind: 'moveBlock'; readonly at: number; readonly to: number }
  /** The block that holds `at` becomes a fragment of AsciiDoc, which has to be a block of the kind `expect` when given. */
  | { readonly kind: 'replaceBlock'; readonly at: number; readonly source: string; readonly expect?: BlockKindName }
  /** The block that holds `at` goes, with one of the blank lines next to it; an item of a list, when `at` is its text. */
  | { readonly kind: 'deleteBlock'; readonly at: number }
  /**
   * A paragraph becomes a list of one item, a list another kind of list, or (null) paragraphs, one for each item. With `to`
   * (a place in a later paragraph of the same container) the paragraphs from `at` to `to` become the items of one list.
   */
  | { readonly kind: 'toggleList'; readonly at: number; readonly list: ListKind | null; readonly to?: number }
  /** The checkbox of the list item that holds `at` is checked (`[x]`) or cleared (`[ ]`). */
  | { readonly kind: 'setChecked'; readonly at: number; readonly checked: boolean }
  /** The type of the admonition (a paragraph `NOTE: …` or a block `[NOTE]` over `====`) that holds `at`. */
  | { readonly kind: 'setAdmonitionType'; readonly at: number; readonly variant: AdmonitionVariant }
  /** A new item on `level` right after the item that holds `after`, with `text` (the first thing typed in an empty item). */
  | { readonly kind: 'insertItem'; readonly after: number; readonly level: number; readonly text: string }
  /** `text` typed in the empty paragraph at `at`, which was started as an item or a heading with `prefix` (`* `, `1. `, `== `). */
  | { readonly kind: 'startBlock'; readonly at: number; readonly prefix: string; readonly text: string }
  /** The item that holds `at`, the last of its list, is followed by an empty paragraph (Enter in an empty item). */
  | { readonly kind: 'endList'; readonly at: number }
  /** The list item that holds `at` goes one level in (under the item before it). */
  | { readonly kind: 'indentListItem'; readonly at: number }
  /** The list item that holds `at` goes one level out (after the item it is in). */
  | { readonly kind: 'outdentListItem'; readonly at: number }
  /** The code of the listing that holds `at` becomes `text` (lines joined by `\n`); the delimiters grow when a line of it is as long as they are. */
  | { readonly kind: 'setCodeText'; readonly at: number; readonly text: string }
  /** The language of the listing that holds `at` (`[source,language]`); `language` is a word such as `python`. */
  | { readonly kind: 'setCodeLanguage'; readonly at: number; readonly language: string }
  /** The caption (the `.Title` line) of the image that holds `at`: set, changed, or taken away (empty text). */
  | { readonly kind: 'setCaption'; readonly at: number; readonly text: string }
  /** The source of the island (a block shown as source) that holds `at` becomes `text`; refused when the blocks around would read in another way. */
  | {
      readonly kind: 'setIslandText'
      readonly at: number
      readonly text: string
      /** The end of the island with its line end, when the lines of it are not one block of the text any more (an island that is being edited). */
      readonly to?: number
    }
  /** A block written new goes after the block that holds `at`, or (`replace`, or in an empty paragraph) in the place of the paragraph. */
  | { readonly kind: 'placeBlock'; readonly at: number; readonly block: BlockSpec; readonly replace?: boolean }
  /** An empty paragraph follows the block that holds `at` (none is added when there is one). */
  | { readonly kind: 'appendEmpty'; readonly at: number }
  /** The text of the cell that holds `at`, written for the format and the depth of its table (a separator in it is escaped). */
  | { readonly kind: 'setCellText'; readonly at: number; readonly text: string }
  /** A row of empty cells before or after (default) the row of the cell that holds `at`. */
  | { readonly kind: 'insertRow'; readonly at: number; readonly where?: 'before' | 'after' }
  /** The row of the cell that holds `at`, or the one before or after it. */
  | { readonly kind: 'deleteRow'; readonly at: number; readonly where?: 'before' | 'after' }
  /** A column of empty cells before or after (default) the column of the cell that holds `at`; `cols` follows. */
  | { readonly kind: 'insertColumn'; readonly at: number; readonly where?: 'before' | 'after' }
  /** The column of the cell that holds `at`, or the one before or after it; `cols` follows. */
  | { readonly kind: 'deleteColumn'; readonly at: number; readonly where?: 'before' | 'after' }
  /** The cells from the one that holds `from` to the one that holds `to` (the rectangle they span) become one cell. */
  | { readonly kind: 'mergeCells'; readonly from: number; readonly to: number }
  /** A merged cell becomes cells again. */
  | { readonly kind: 'splitCell'; readonly at: number }
  /** The header row and the footer row of the table that holds `at`, on or off. */
  | { readonly kind: 'setTableOptions'; readonly at: number; readonly header?: boolean; readonly footer?: boolean }
  /** The cell that holds `at` gets the `a` style (blocks in it), or loses it (null). */
  | { readonly kind: 'setCellStyle'; readonly at: number; readonly style: 'asciidoc' | null }
  /** The fill of the cell that holds `at`: the label `[.<role>]##{empty}##` at the start of its text (`cell-` and a name), or none (null). */
  | { readonly kind: 'setCellFill'; readonly at: number; readonly role: string | null }
  /** The alignment of the cell that holds `at`. */
  | {
      readonly kind: 'setCellAlign'
      readonly at: number
      readonly halign?: 'left' | 'center' | 'right'
      readonly valign?: 'top' | 'middle' | 'bottom'
    }
  /** The widths of the columns of the table that holds `at`: whole numbers, one for each column. */
  | { readonly kind: 'setColumnWidths'; readonly at: number; readonly widths: readonly number[] }
  /** The cell that holds `at` gets a table of `rows` × `columns` empty cells (the format of the next level), and the `a` style. */
  | { readonly kind: 'nestTable'; readonly at: number; readonly rows: number; readonly columns: number }
  /** The table that holds `at` goes: a table of the first level with its attributes and its title, a table in a cell out of the cell (which keeps its `a` style). */
  | { readonly kind: 'deleteTable'; readonly at: number }
  /** A colour role (`hl-mint`, or one the host names) on the text `from`–`to`, in addition to the colours it has. */
  | { readonly kind: 'setColor'; readonly from: number; readonly to: number; readonly role: string }
  /** The text `from`–`to` gets exactly `role` of the colours; with `replace`, only the characters with that role change it for `role`. */
  | {
      readonly kind: 'replaceColor'
      readonly from: number
      readonly to: number
      readonly role: string
      readonly replace?: string
    }
  /** The colour `role` (all the colours without it) off the text `from`–`to`. */
  | { readonly kind: 'removeColor'; readonly from: number; readonly to: number; readonly role?: string }

/** What `applyOperation` is given besides the operation. */
export interface ApplyOptions {
  /** The style new blocks are written in: the one the document has (`doc.styleProfile()`) when not given. */
  readonly profile?: StyleProfile
}

/** The `kind` of an {@link Operation}: the name of what it does. */
export type OperationKind = Operation['kind']

/** What `applyOperation` gives: the new document with the changes, or the reason it refused. */
export type ApplyResult =
  | { readonly doc: NotaDocument; readonly changes: readonly Change[]; readonly literal?: boolean }
  | OperationFailure

function itemAt(
  doc: NotaDocument,
  at: number,
): { ctx: ReturnType<typeof makeCtx>; index: number; cell: number | null } | OperationFailure {
  const ctx = makeCtx(doc)
  const p = resolvePoint(ctx, at)
  if ('error' in p) return failure(p.error, 'Inside a plate', at, at)
  return { ctx, index: Math.min(p.item, ctx.items.length - 1), cell: p.cell }
}

/**
 * Runs an operation on a document. It never changes the document it is given: it returns the replacements, and the new
 * document after them, or `{ error, diagnostics }` when it refuses (the text stays as it is). Codes of refusals are
 * stable (`invalid-range`, `not-editable`, …); the message in `diagnostics[0]` says what to do.
 *
 * @example
 * ```ts
 * const r = applyOperation(parse('Hello\n'), { kind: 'insertText', at: 5, text: ' world' })
 * if (!('error' in r)) r.doc.text // 'Hello world\n'
 * applyOperation(parse('abc'), { kind: 'insertText', at: 10, text: 'x' }) // { error: 'invalid-range', … }
 * ```
 *
 * @throws TypeError when `doc` was not made by `parse()` or `doc.update()` of this copy of `@nota-adoc/core`
 * (for example a plain object, or a document of another copy of the package in `node_modules`).
 */
export function applyOperation(doc: NotaDocument, op: Operation, options: ApplyOptions = {}): ApplyResult {
  assertDocument(doc)
  try {
    return run(doc, op, options)
  } catch (e) {
    if (e instanceof RangeError) return failure('invalid-range', e.message)
    throw e
  }
}

function run(doc: NotaDocument, op: Operation, options: ApplyOptions): OperationResult {
  const len = doc.text.length
  // the position that was found outside the text by the last `bad` that said so: `outside()` names it
  let badAt = NaN
  const bad = (...ps: number[]): boolean => {
    const i = ps.findIndex((p) => !Number.isInteger(p) || p < 0 || p > len)
    if (i < 0) return false
    badAt = ps[i]!
    return true
  }
  const outside = (): OperationFailure => outsideText(badAt, len)
  switch (op.kind) {
    case 'insertText':
      if (bad(op.at)) return outside()
      return insertText(doc, op.at, op.text, op.marks)
    case 'deleteRange':
      if (bad(op.from, op.to)) return outside()
      return deleteRange(doc, op.from, op.to)
    case 'replaceText': {
      if (bad(op.from, op.to)) return outside()
      const from = Math.min(op.from, op.to)
      const to = Math.max(op.from, op.to)
      const block = inlineBlockAround(doc, from)
      if (block && to <= block.content!.to) return editInline(doc, block, from, to, op.text, op.marks)
      const d = deleteRange(doc, from, to)
      if (isFailure(d)) return d
      const at = mapOffset(d.changes, from, -1)
      const t = insertText(d.doc, at, op.text, op.marks)
      if (isFailure(t)) return t
      return {
        doc: t.doc,
        changes: composeChanges(d.changes, t.changes),
        literal: d.literal !== false && t.literal !== false,
      }
    }
    case 'toggleMark':
      if (bad(op.from, op.to)) return outside()
      return toggleMark(doc, op.from, op.to, op.mark, op.on)
    case 'setColor':
    case 'replaceColor':
    case 'removeColor':
      if (bad(op.from, op.to)) return outside()
      return colorOperation(doc, op)
    case 'setLink':
      if (bad(op.from, op.to)) return outside()
      return setLink(doc, op.from, op.to, op.target)
    case 'removeLink':
      if (bad(op.at)) return outside()
      return removeLink(doc, op.at)
    case 'insertBreak':
      if (bad(op.at)) return outside()
      return insertBreak(doc, op.at)
    case 'splitBlock': {
      if (bad(op.at)) return outside()
      const r = itemAt(doc, op.at)
      if ('error' in r) return r
      const it = r.ctx.items[r.index]!
      if (r.cell === null) return failure('not-editable', 'A block is split inside its text', op.at, op.at)
      if (it.kind === 'item') return splitListItem(r.ctx, r.index, r.cell)
      return splitItem(r.ctx, r.index, it.kind === 'empty' ? 0 : r.cell)
    }
    case 'joinBlocks': {
      if (bad(op.at)) return outside()
      const r = itemAt(doc, op.at)
      if ('error' in r) return r
      return joinItems(r.ctx, r.index, (op.direction ?? 'backward') === 'backward')
    }
    case 'setChecked':
      if (bad(op.at)) return outside()
      return setChecked(doc, op.at, op.checked)
    case 'setAdmonitionType':
      if (bad(op.at)) return outside()
      return setAdmonitionType(doc, op.at, op.variant)
    case 'insertItem': {
      if (bad(op.after)) return outside()
      const r = itemAt(doc, op.after)
      if ('error' in r) return r
      return insertItem(r.ctx, r.index, op.level, op.text)
    }
    case 'endList': {
      if (bad(op.at)) return outside()
      const r = itemAt(doc, op.at)
      if ('error' in r) return r
      return endList(r.ctx, r.index)
    }
    case 'startBlock': {
      if (bad(op.at)) return outside()
      const ctx = makeCtx(doc)
      const index = emptyItemAt(ctx, op.at)
      if (index < 0) return failure('not-editable', 'Not in an empty paragraph', op.at, op.at)
      return startBlock(ctx, index, op.prefix, op.text)
    }
    case 'setCodeText':
    case 'setCaption':
    case 'setIslandText':
      if (bad(op.at)) return outside()
      if (typeof op.text !== 'string') return failure('invalid-block', 'The text is a string')
      return op.kind === 'setCodeText'
        ? setCodeText(doc, op.at, op.text)
        : op.kind === 'setCaption'
          ? setCaption(doc, op.at, op.text)
          : setIslandText(doc, op.at, op.text, op.kind === 'setIslandText' ? op.to : undefined)
    case 'setCodeLanguage':
      if (bad(op.at)) return outside()
      return setCodeLanguage(doc, op.at, op.language)
    case 'appendEmpty':
      if (bad(op.at)) return outside()
      return appendEmpty(doc, op.at)
    case 'placeBlock': {
      if (bad(op.at)) return outside()
      if (typeof op.block !== 'object' || op.block === null)
        return failure('invalid-block', 'A block to place is a description of a block or a fragment')
      const base = doc.styleProfile()
      const given = options.profile
      const profile = given ? { ...base, ...given, delimiterLength: { ...base.delimiterLength, ...given.delimiterLength } } : base
      return placeBlock(envOf(doc, profile), op.at, op.block, op.replace === true)
    }
    case 'setBlockType': {
      if (bad(op.at)) return outside()
      const r = itemAt(doc, op.at)
      if ('error' in r) return r
      return setItemType(r.ctx, r.index, op.type, op.level ?? 0)
    }
    case 'setCellText':
    case 'insertRow':
    case 'deleteRow':
    case 'insertColumn':
    case 'deleteColumn':
    case 'mergeCells':
    case 'splitCell':
    case 'setTableOptions':
    case 'setCellStyle':
    case 'setCellFill':
    case 'setCellAlign':
    case 'setColumnWidths':
    case 'deleteTable':
    case 'nestTable': {
      const places = op.kind === 'mergeCells' ? [op.from, op.to] : [op.at]
      if (bad(...places)) return outside()
      const env = lazyEnvOf(doc, () => {
        const base = doc.styleProfile()
        const given = options.profile
        return given ? { ...base, ...given, delimiterLength: { ...base.delimiterLength, ...given.delimiterLength } } : base
      })
      switch (op.kind) {
        case 'setCellText':
          return tables.setCellText(env, op.at, op.text)
        case 'insertRow':
          return tables.insertRow(env, op.at, op.where)
        case 'deleteRow':
          return tables.deleteRow(env, op.at, op.where)
        case 'insertColumn':
          return tables.insertColumn(env, op.at, op.where)
        case 'deleteColumn':
          return tables.deleteColumn(env, op.at, op.where)
        case 'mergeCells':
          return tables.mergeCells(env, op.from, op.to)
        case 'splitCell':
          return tables.splitCell(env, op.at)
        case 'setTableOptions':
          return tables.setTableOptions(env, op.at, op.header, op.footer)
        case 'setCellStyle':
          return tables.setCellStyle(env, op.at, op.style)
        case 'setCellFill':
          return tables.setCellFill(env, op.at, op.role)
        case 'setCellAlign':
          return tables.setCellAlign(env, op.at, op.halign, op.valign)
        case 'setColumnWidths':
          return tables.setColumnWidths(env, op.at, op.widths)
        case 'nestTable':
          return tables.nestTable(env, op.at, op.rows, op.columns)
        case 'deleteTable':
          return tables.deleteTable(env, op.at)
      }
      break
    }
    case 'setSectionLevel':
    case 'insertBlock':
    case 'moveBlock':
    case 'replaceBlock':
    case 'deleteBlock':
    case 'toggleList':
    case 'indentListItem':
    case 'outdentListItem': {
      if (bad(op.at) || (op.kind === 'moveBlock' && bad(op.to)) || (op.kind === 'toggleList' && op.to !== undefined && bad(op.to))) return outside()
      const base = doc.styleProfile()
      const given = options.profile
      const profile = given ? { ...base, ...given, delimiterLength: { ...base.delimiterLength, ...given.delimiterLength } } : base
      if (op.kind === 'insertBlock' && (typeof op.block !== 'object' || op.block === null))
        return failure('invalid-block', 'A block to insert is a description of a block or a fragment')
      if (op.kind === 'replaceBlock' && typeof op.source !== 'string')
        return failure('fragment-invalid', 'The fragment is a string')
      const env = envOf(doc, profile)
      switch (op.kind) {
        case 'setSectionLevel':
          return setSectionLevel(env, op.at, op.level)
        case 'insertBlock':
          return insertBlock(env, op.at, op.where, op.block)
        case 'moveBlock':
          return moveBlock(env, op.at, op.to)
        case 'replaceBlock':
          return replaceBlock(env, op.at, op.source, op.expect)
        case 'deleteBlock':
          return deleteBlock(env, op.at)
        case 'toggleList':
          return toggleList(env, op.at, op.list, op.to)
        case 'indentListItem':
          return indentListItem(env, op.at)
        case 'outdentListItem':
          return outdentListItem(env, op.at)
      }
    }
  }
}
