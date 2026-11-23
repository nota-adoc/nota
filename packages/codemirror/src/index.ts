export { asciidoc } from './asciidoc.js'
export type { AsciidocConfig } from './asciidoc.js'

export { asciidocLanguage, notaDocument } from './language.js'
export {
  asciidocHighlighting,
  asciidocTags,
  highlightGroup,
  highlightRanges,
  highlightTable,
  highlightedNodes,
} from './highlight.js'
export { asciidocCompletionSource } from './complete.js'
export type { XrefTarget, XrefTargets } from './complete.js'
export { asciidocLint, notaDiagnostics } from './lint.js'
export { foldAtCursor, foldRange, foldRangeAround } from './fold.js'
export type { FoldRange } from './fold.js'
export type { HighlightGroup, HighlightRange, HighlightRule } from './highlight.js'

export { documentTargets, generateId, hasInlineMarkup } from './sections.js'
export type { DocTarget, DocTargets, SectionId } from './sections.js'

export { createSession } from './session.js'
export type { NotaSession, SessionCallOptions, SessionEvent, SessionOptions } from './session.js'
export { createSourceEditor } from './editor.js'
export type { SourceChange, SourceEditor, SourceEditorOptions } from './editor.js'
