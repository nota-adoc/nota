// The status line: the diagnostics of Nota counted by level, and, while the cursor is in «Исходник», the path of the nodes of
// Nota from the document to the cursor. The length of the text is shown by the page (it comes from the session).
import { syntaxTree } from '@codemirror/language'
import type { EditorView } from '@codemirror/view'
import type { SyntaxNode } from '@lezer/common'
import { notaDocument } from '@nota-adoc/codemirror'
import { type Key, t } from './i18n.js'

export interface Status {
  /** Counts the diagnostics of the text of the view by level. */
  count(view: EditorView): void
  /** The path of the nodes at the cursor of the view; `null` when the cursor is not in «Исходник»: the path goes. */
  path(view: EditorView | null): void
}

const NAMES = { error: 'count.errors', warning: 'count.warnings', info: 'count.infos' } as const satisfies Record<string, Key>

/** The names of the nodes from the document to the cursor, e.g. `Document › Section › UnorderedList › ListItem`. */
export function nodePath(view: EditorView): string {
  const names: string[] = []
  for (let n: SyntaxNode | null = syntaxTree(view.state).resolveInner(view.state.selection.main.head, -1); n; n = n.parent)
    if (n.name) names.unshift(n.name)
  return names.join(' › ')
}

export function setupStatus({ status, path }: { status: HTMLElement; path: HTMLElement }): Status {
  const counters = new Map(
    (Object.keys(NAMES) as Array<keyof typeof NAMES>).map((level) => [
      level,
      status.querySelector<HTMLElement>(`.count[data-sev="${level}"]`)!,
    ]),
  )
  return {
    count(view) {
      const counts = { error: 0, warning: 0, info: 0 }
      for (const d of notaDocument(view.state).diagnostics) counts[d.severity]++
      for (const [level, counter] of counters) {
        const n = counts[level]
        counter.dataset.n = String(n)
        counter.querySelector('.n')!.textContent = String(n)
        counter.setAttribute('aria-label', `${t(NAMES[level])}: ${n}`)
      }
    },
    path(view) {
      path.textContent = view ? nodePath(view) : ''
    },
  }
}
