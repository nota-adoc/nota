/**
 * The diagnostics of Nota as CodeMirror lint: ranges, severities and messages come straight from
 * `notaDocument(state).diagnostics`, so nothing is parsed again for linting.
 */
import { type Diagnostic as LintDiagnostic, linter, lintKeymap } from '@codemirror/lint'
import type { EditorState, Extension } from '@codemirror/state'
import { keymap } from '@codemirror/view'
import type { Diagnostic as NotaDiagnostic } from '@nota-adoc/core'
import { notaDocument } from './language.js'

/** The diagnostics of the state as lint diagnostics (source `nota`, the code after the message). */
export function notaDiagnostics(
  state: EditorState,
  message: (d: NotaDiagnostic) => string = (d) => d.message,
): LintDiagnostic[] {
  const length = state.doc.length
  return notaDocument(state).diagnostics.map((d) => ({
    from: Math.min(d.from, length),
    to: Math.min(d.to, length),
    severity: d.severity,
    source: 'nota',
    message: message(d),
    renderMessage: () => {
      const el = document.createElement('span')
      el.className = 'cm-ap-diagnostic'
      el.append(message(d) + ' ')
      const code = document.createElement('code')
      code.className = 'cm-ap-diagnostic-code'
      code.textContent = d.code
      el.append(code)
      return el
    },
  }))
}

/** Lint for AsciiDoc: wavy lines and hover messages, and the panel with the list on Mod-Shift-M. */
export function asciidocLint(delay = 250, message?: (d: NotaDiagnostic) => string): Extension {
  return [linter((view) => notaDiagnostics(view.state, message), { delay }), keymap.of(lintKeymap)]
}
