/**
 * Completion: the names of attributes after `{` and the targets of cross references after `xref:` and `<<`.
 *
 * The inline level is not in the tree yet, so the context comes from the text before the cursor; the tree
 * tells only whether the cursor is in a comment. The library loads nothing: targets in other documents
 * come from a function of the host.
 */
import {
  type Completion,
  type CompletionContext,
  type CompletionResult,
  type CompletionSource,
  autocompletion,
} from '@codemirror/autocomplete'
import { syntaxTree } from '@codemirror/language'
import type { EditorState, Extension } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import type { SyntaxNode } from '@lezer/common'
import { attributesAt } from './attributes.js'
import { parseOptionsFacet, notaDocument } from './language.js'
import { documentTargets } from './sections.js'

/** A target of a cross reference in another document, given by the host. */
export interface XrefTarget {
  /** What goes into the reference, e.g. `guide.adoc#install`. */
  readonly id: string
  /** The text shown next to the id, e.g. the title of the section. */
  readonly label?: string
}

/** Gives the targets of other documents; may be asynchronous. `query` is what is typed after `xref:` or `<<`. */
export type XrefTargets = (query: string) => Promise<readonly XrefTarget[]> | readonly XrefTarget[]

const NAME = /^[\p{L}\p{N}_-]*$/u
const ATTRIBUTE_BEFORE = /\{[\p{L}\p{N}_-]*$/u
const XREF_BEFORE = /xref:[^\s[\]<>{}]*$/
const SHORTHAND_BEFORE = /<<[^\s<>,{}]*$/
const XREF_NAME = /^[^\s[\]<>{}]*$/

/** True if the position is inside a `//` line or a `////` block comment. */
function inComment(state: EditorState, pos: number): boolean {
  for (let n: SyntaxNode | null = syntaxTree(state).resolveInner(pos, 1); n; n = n.parent)
    if (n.name === 'LineComment' || n.name === 'BlockComment') return true
  return false
}

const short = (s: string, max = 60) => (s.length > max ? s.slice(0, max - 1) + '…' : s)

function attributeCompletions(context: CompletionContext): CompletionResult | null {
  const before = context.matchBefore(ATTRIBUTE_BEFORE)
  if (!before) return null
  const { state } = context
  if (inComment(state, before.from)) return null
  const doc = notaDocument(state)
  const known = attributesAt(doc.tree, doc.text, state.facet(parseOptionsFacet), before.from)
  // a `}` right after the cursor is already there
  const closed = state.sliceDoc(context.pos, context.pos + 1) === '}'
  const options: Completion[] = [...known]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([name, value]) => ({
      label: name,
      detail: short(value),
      type: 'variable',
      apply: closed ? name : `${name}}`,
    }))
  return { from: before.from + 1, options, validFor: NAME }
}

function xrefApply(kind: 'xref' | 'short', id: string): Completion['apply'] {
  return (view: EditorView, _completion: Completion, from: number, to: number) => {
    const insert = kind === 'xref' ? `${id}[]` : `${id}>>`
    // `xref:id[|]`: inside the brackets; `<<id>>|`: after the brackets
    view.dispatch({
      changes: { from, to, insert },
      selection: { anchor: from + (kind === 'xref' ? id.length + 1 : insert.length) },
      userEvent: 'input.complete',
    })
  }
}

async function xrefCompletions(
  context: CompletionContext,
  hostTargets: XrefTargets | undefined,
): Promise<CompletionResult | null> {
  const xref = context.matchBefore(XREF_BEFORE)
  const short_ = xref ? null : context.matchBefore(SHORTHAND_BEFORE)
  const before = xref ?? short_
  if (!before) return null
  const { state } = context
  if (inComment(state, before.from)) return null
  const kind = xref ? 'xref' : 'short'
  const prefix = kind === 'xref' ? 'xref:'.length : '<<'.length
  const doc = notaDocument(state)
  const found = documentTargets(doc, state.facet(parseOptionsFacet))
  const options: Completion[] = found.targets.map((t) => ({
    label: t.id,
    detail: short(t.label),
    type: t.kind === 'section' ? 'class' : 'constant',
    boost: 1,
    apply: xrefApply(kind, t.id),
  }))
  const own = new Set(options.map((o) => o.label))
  if (hostTargets) {
    try {
      const typed = state.sliceDoc(before.from + prefix, context.pos)
      const extra = await hostTargets(typed)
      if (Array.isArray(extra))
        for (const t of extra as readonly XrefTarget[]) {
          if (!t || typeof t.id !== 'string' || own.has(t.id)) continue
          own.add(t.id)
          options.push({
            label: t.id,
            detail: t.label === undefined ? undefined : short(String(t.label)),
            type: 'text',
            boost: 0,
            apply: xrefApply(kind, t.id),
          })
        }
    } catch {
      // a host that fails leaves the targets of the document
    }
  }
  return { from: before.from + prefix, options, validFor: XREF_NAME }
}

/** The completion source of AsciiDoc: `{attribute}` names and `xref:`/`<<` targets. */
export function asciidocCompletionSource(xrefTargets?: XrefTargets): CompletionSource {
  return (context) => attributeCompletions(context) ?? xrefCompletions(context, xrefTargets)
}

/** The completion machinery (`autocompletion()`); the source itself is language data. */
export function asciidocCompletion(): Extension {
  return autocompletion()
}
