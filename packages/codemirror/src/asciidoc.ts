import { LanguageSupport } from '@codemirror/language'
import { EditorState, type Extension } from '@codemirror/state'
import type { Diagnostic, ParseOptions } from '@nota-adoc/core'
import { asciidocCompletion, asciidocCompletionSource, type XrefTargets } from './complete.js'
import { asciidocFolding } from './fold.js'
import { asciidocHighlighting } from './highlight.js'
import { asciidocLanguage } from './language.js'
import { asciidocLint } from './lint.js'

/** Options of {@link asciidoc}. */
export interface AsciidocConfig {
  /** Options of the Nota parser (document attributes, block macros). */
  parse?: ParseOptions
  /** Show the diagnostics of Nota as lint (wavy lines, hover messages, the panel on Mod-Shift-M). Default true. */
  lint?: boolean
  /** The text of a diagnostic in the hint and the panel (to translate it). Default: `d.message`. */
  message?: (d: Diagnostic) => string
  /**
   * Targets of cross references in other documents, for the list after `xref:` and `<<` (after the targets of this
   * document). May be asynchronous; a failure leaves the targets of this document. Nothing is loaded by the library.
   */
  xrefTargets?: XrefTargets
  /** Install the completion machinery (`autocompletion()`) with the sources of AsciiDoc. Default true. */
  autocomplete?: boolean
}

/** AsciiDoc for CodeMirror 6, on the Nota syntax tree. */
export function asciidoc(config: AsciidocConfig = {}): LanguageSupport {
  const support: Extension[] = [asciidocHighlighting(), asciidocFolding()]
  if (config.lint !== false) support.push(asciidocLint(undefined, config.message))
  // the source is language data: a host that installs `autocompletion()` itself gets it too
  // one function for every position: the completion machinery tells sources apart by identity
  const data = [{ autocomplete: asciidocCompletionSource(config.xrefTargets) }]
  support.push(EditorState.languageData.of(() => data))
  if (config.autocomplete !== false) support.push(asciidocCompletion())
  return new LanguageSupport(asciidocLanguage(config.parse), support)
}
