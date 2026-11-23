/**
 * What `@nota-adoc/html` builds on: the pieces of the parser that a converter needs (the attribute state of a
 * document, the substitutions over a text with their parts, the readers of the pieces of markup). This entry
 * is not the API of the parser and may change with any release; `@nota-adoc/core` is.
 */
export {
  AttributeTracker,
  Attrs,
  AttrsBuilder,
  applyValueSubs,
  setupAttributes,
  subAttributes,
  subSpecialChars,
} from './parse/attrs.js'
export type { AttributeHooks, AttributeSetup, DocState } from './parse/attrs.js'
export { processAuthors, processRevision } from './parse/authors.js'
export { headerEntries } from './parse/header-entries.js'
export {
  BASIC_SUBS,
  HEADER_SUBS,
  NO_SUBS,
  REFTEXT_SUBS,
  VERBATIM_SUBS,
  Substitutor,
  Work,
  leadingAnchor,
  nestNodes,
  parseAttrs,
  scanAnchors,
  scanInline,
  spliceInline,
} from './parse/inline/index.js'
export type { AttributeMap, INode, InlineSink, Part, Piece, Sub, TextLineRef } from './parse/inline/index.js'
export { resolveOrderedMarker, rstrip, rubyToI, sanitizeAttributeName } from './parse/rx.js'

/** Documents in the cells of tables: how the converter reads the cells with the `a` style. */
export { parseNested, setupOf } from './document.js'
export { cellSetup } from './parse/nested.js'
export { MAX_NESTING } from './parse/table.js'
export type { ParseSetup } from './parse/blocks.js'

/** The model the visual editor builds on (blocks, blank lines, the cells of a text) — not the API of the parser either. */
export { editableBlockAround, editableBlockAt, isRawKind, layoutItems, readLayout } from './edit/layout.js'
export { PAGE_META, PAGE_META_BODY, PAGE_META_TAIL, TOC_PINNED, pageMetaItems, readPageMeta } from './edit/pagemeta.js'
export type { PageMeta, PageMetaAttribute, PageMetaField, PageMetaKind } from './edit/pagemeta.js'
export { tableViewAt } from './edit/tableview.js'
export { SIMPLE_CELL, cellBlockAt, cellMap } from './edit/cell.js'
/** Enter in an item of a list in an `a` cell, and an item started by typing: outside `applyOperation`, so the engine stays small. */
export { insertCellItem, splitCellItem } from './edit/cellitems.js'
export { blankAfter, topBlocks } from './edit/topblocks.js'
export type { MetaLine, TopBlock } from './edit/topblocks.js'
export type { CellBlock, CellView, TableView } from './edit/tableview.js'
export { blockEnd, codeText } from './edit/verbatim.js'
export { escapeInline } from './edit/escape.js'
export { impliedMark, readCell, readInline, roleNames } from './edit/read.js'
export { printCells, normalizeCells } from './edit/print.js'
export { cellsBefore, isInsertionPoint, spansAt } from './edit/common.js'
export type { BlockInfo, Cell, Flag, Gap, Item, Layout, LinkForm, MarkType, Reading, Span } from './edit/types.js'
export { checkNoCollateral } from './edit/check.js'
export { cellKey, firstDivergence } from './edit/realize.js'

/** The document as Asciidoctor sees it (contexts, ids, numbers, references): what the converter of `@nota-adoc/html` builds on. */
export { Blk, buildModel } from './asg/model.js'
export type { Effect, Footnote as ModelFootnote, Model, Ref, Src, TableBlk } from './asg/model.js'

/** What the diagnostics of the meaning of a document are made of (tested against a walk of the whole tree). */
export { knownIdsOf, modelTargetsOf, scanOf, swapTargetsMemory } from './asg/semantics.js'
export type { Scan } from './asg/semantics.js'

/** The ASG with the tables laid open: what the checks of the operations (and the fuzz of them) compare. */
export { deepAsg } from './asg/asg.js'

/** The text of every place where colour shows, character by character: what the colour operations and their fuzz are checked against. */
export { colorLayoutOf } from './colors.js'
export type { ColorLayout, InlineNode, Place, Plate, TextEl } from './colors.js'
