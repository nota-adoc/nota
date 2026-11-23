/**
 * Folding by the Nota tree: section bodies, the content of blocks with delimiters (and `////` comments)
 * and lists of several lines. `foldService` gives the range for the line where the construct starts,
 * `foldGutter` shows the marker.
 */
import {
  foldCode,
  foldEffect,
  foldGutter,
  foldService,
  foldedRanges,
  syntaxTree,
  unfoldCode,
} from '@codemirror/language'
import { type EditorState, type Extension, Prec } from '@codemirror/state'
import { type Command, type EditorView, keymap } from '@codemirror/view'
import type { SyntaxNode } from '@lezer/common'

export interface FoldRange {
  readonly from: number
  readonly to: number
}

/** The end of the last line of `from`–`to` that has text: what is folded stops before the line breaks that follow it. */
function contentEnd(state: EditorState, from: number, to: number): number {
  const text = state.doc
  while (to > from && text.sliceString(to - 1, to) === '\n') to--
  return to
}

const LISTS = new Set(['UnorderedList', 'OrderedList', 'DescriptionList', 'CalloutList'])

/** The fold range of a construct, given the node that starts on the line: null when it holds nothing to hide. */
function rangeOf(state: EditorState, node: SyntaxNode, lineEnd: number): FoldRange | null {
  const parent = node.parent
  if (!parent) return null
  let to: number
  switch (node.name) {
    case 'SectionTitle': {
      if (parent.name !== 'Section') return null
      to = contentEnd(state, lineEnd, parent.to)
      break
    }
    case 'BlockDelimiter':
    case 'CommentDelimiter': {
      // only the opening delimiter of a block folds
      if (parent.name !== 'DelimitedBlock' && parent.name !== 'BlockComment') return null
      const opening = parent.getChild(node.name)
      if (!opening || opening.from !== node.from) return null
      const last = parent.lastChild
      if (last && last.name === node.name && last.from > node.from)
        to = last.from - 1 // the line break before the closing delimiter
      else to = contentEnd(state, lineEnd, parent.to) // unclosed: to the end of its container
      break
    }
    case 'ListItem': {
      if (!LISTS.has(parent.name)) return null
      const first = parent.firstChild
      if (!first || first.from !== node.from) return null
      to = contentEnd(state, lineEnd, parent.to)
      // a list of one line has nothing to fold
      break
    }
    default:
      return null
  }
  if (to <= lineEnd) return null
  // there must be a line break inside the hidden range: a single-line paragraph gets no marker
  if (state.doc.lineAt(to).number === state.doc.lineAt(lineEnd).number) return null
  return { from: lineEnd, to }
}

const foldNames = new Set(['SectionTitle', 'BlockDelimiter', 'CommentDelimiter', 'ListItem'])

/** The range that folds from the line `lineStart`–`lineEnd`, or null. */
export function foldRange(state: EditorState, lineStart: number, lineEnd: number): FoldRange | null {
  const tree = syntaxTree(state)
  if (tree.length < lineEnd) return null
  let found: FoldRange | null = null
  tree.iterate({
    from: lineStart,
    to: lineEnd,
    enter(ref) {
      if (found) return false
      if (!foldNames.has(ref.name) || ref.from < lineStart || ref.from > lineEnd) return
      found = rangeOf(state, ref.node, lineEnd)
      return
    },
  })
  return found
}

function isFolded(state: EditorState, range: FoldRange): boolean {
  let folded = false
  foldedRanges(state).between(range.from, range.to, (from, to) => {
    if (from === range.from && to === range.to) folded = true
  })
  return folded
}

/** The node that starts the line a construct folds from: the section title, the opening delimiter, the first item. */
function starter(node: SyntaxNode): SyntaxNode | null {
  switch (node.name) {
    case 'Section':
      return node.getChild('SectionTitle')
    case 'DelimitedBlock':
      return node.getChild('BlockDelimiter')
    case 'BlockComment':
      return node.getChild('CommentDelimiter')
    default:
      return LISTS.has(node.name) ? node.getChild('ListItem') : null
  }
}

/** The closest construct around `pos` that folds and is not folded yet. */
export function foldRangeAround(state: EditorState, pos: number): FoldRange | null {
  for (let n: SyntaxNode | null = syntaxTree(state).resolveInner(pos, 1); n; n = n.parent) {
    const head = starter(n)
    if (!head) continue
    const line = state.doc.lineAt(head.from)
    const range = rangeOf(state, head, line.to)
    if (range && pos >= line.from && pos <= range.to && !isFolded(state, range)) return range
  }
  return null
}

/** Folds by the cursor: the closest construct around it that folds and is not folded yet. */
export const foldAtCursor: Command = (view: EditorView) => {
  const { state } = view
  const range = foldRangeAround(state, state.selection.main.head)
  if (!range) return foldCode(view)
  const head = state.selection.main.head
  view.dispatch({
    effects: foldEffect.of(range),
    // a cursor inside the hidden range goes to the end of the line that stays
    selection: head > range.from ? { anchor: range.from } : undefined,
    scrollIntoView: true,
  })
  return true
}

/** Folding for AsciiDoc: the service, the gutter with its markers and the keys Mod-Alt-[ and Mod-Alt-]. */
export function asciidocFolding(): Extension {
  return [
    foldService.of((state, lineStart, lineEnd) => foldRange(state, lineStart, lineEnd)),
    foldGutter(),
    Prec.high(
      keymap.of([
        { key: 'Mod-Alt-[', run: foldAtCursor },
        { key: 'Mod-Alt-]', run: unfoldCode },
      ]),
    ),
  ]
}
