/**
 * The blocks of a document as the operations see them: elements (a block with the metadata lines over it) in the
 * containers that hold them — the document, a section, a delimited block that holds blocks, the cell of a table
 * with the `a` style, an item of a list — at any depth, with the text surgery on them (where a block starts and
 * ends, what to cut out with it, where a new one goes).
 */
import type { SyntaxNode } from '@lezer/common'
import type { NotaDocument } from '../document.js'
import type { Change } from '../changes.js'
import { blockKind } from '../nodes.js'
import type { BlockKindName } from './blockspec.js'

/** Node names of the blocks an operation can have as its target. */
export const TARGETS: ReadonlySet<string> = new Set([
  'Section',
  'DiscreteHeading',
  'Paragraph',
  'LiteralParagraph',
  'AdmonitionParagraph',
  'StyledParagraph',
  'DelimitedBlock',
  'BlockQuote',
  'BlockMacro',
  'ThematicBreak',
  'PageBreak',
  'UnorderedList',
  'OrderedList',
  'DescriptionList',
  'CalloutList',
  'IncludeDirective',
  'LineComment',
  'BlockComment',
])

/** What stands among the blocks of a container: the blocks and the lines that are not a block but hold a place. */
const ELEMENTS: ReadonlySet<string> = new Set([...TARGETS, 'AttributeEntry', 'Directive', 'DisabledLines'])

export const LISTS: ReadonlySet<string> = new Set(['UnorderedList', 'OrderedList', 'DescriptionList', 'CalloutList'])

const CONTAINER_KINDS = new Set(['example', 'sidebar', 'open', 'admonition', 'quote'])

/** A node that holds blocks one after another. */
export function isContainer(n: SyntaxNode): boolean {
  switch (n.name) {
    case 'Document':
    case 'Section':
    case 'CellContent':
    case 'ListItem':
      return true
    case 'DelimitedBlock':
      return CONTAINER_KINDS.has(n.tree?.prop(blockKind) ?? '')
    default:
      return false
  }
}

export function elementsOf(container: SyntaxNode): SyntaxNode[] {
  const out: SyntaxNode[] = []
  for (let k = container.firstChild; k; k = k.nextSibling) if (ELEMENTS.has(k.name)) out.push(k)
  return out
}

/** The end of a node without the blank lines after its last line. */
export function trimEnd(text: string, from: number, to: number): number {
  let e = to
  while (e > from) {
    const ls = e >= 2 ? text.lastIndexOf('\n', e - 2) + 1 : 0
    if (ls <= from) break
    if (/^[ \t\r]*\n?$/.test(text.slice(ls, e))) e = ls
    else break
  }
  return e
}

/** A block, the place it has among its siblings. */
export interface Elem {
  readonly node: SyntaxNode
  /** The source of the block: from its metadata lines to the end of its last line (with its line break, if it has one). */
  readonly from: number
  readonly to: number
  readonly container: SyntaxNode
  readonly siblings: readonly SyntaxNode[]
  readonly index: number
}

export function elemOf(text: string, node: SyntaxNode): Elem | null {
  const parent = node.parent
  if (!parent) return null
  let siblings: SyntaxNode[]
  if (node.name === 'ListItem') {
    if (!LISTS.has(parent.name)) return null
    siblings = parent.getChildren('ListItem')
  } else {
    if (!TARGETS.has(node.name) || !isContainer(parent)) return null
    siblings = elementsOf(parent)
  }
  const index = siblings.findIndex((s) => s.from === node.from && s.name === node.name)
  if (index < 0) return null
  return { node, from: node.from, to: trimEnd(text, node.from, node.to), container: parent, siblings, index }
}

export type Located =
  | { readonly at: 'elem'; readonly elem: Elem }
  | { readonly at: 'gap'; readonly container: SyntaxNode; readonly pos: number }

/** Is the cell one of the `a` style (the one that holds blocks)? */
function isAsciiCell(doc: NotaDocument, cell: SyntaxNode): boolean {
  const m = doc.tableAt(cell.from)
  if (!m) return false
  for (const list of [m.rows.head, m.rows.body, m.rows.foot])
    for (const r of list) for (const c of r.cells) if (c.from === cell.from) return c.style === 'asciidoc'
  return false
}

/** The cell of a table that a blank line follows (with nothing but blank lines between them), if there is one. */
function cellBefore(blank: SyntaxNode): SyntaxNode | null {
  for (let p = blank.prevSibling; p; p = p.prevSibling) {
    if (p.name === 'TableCell') return p
    if (p.name !== 'BlankLine' && p.name !== 'Mark') return null
  }
  return null
}

/**
 * The block that holds the position: the deepest one, unless it is in a node that is not a container (a block of a
 * quote) — then the one that holds it. `items`: an item of a list counts as a block (the text of an item is its own,
 * not the list's). A position in a blank line is a gap of the container.
 */
export function locate(doc: NotaDocument, at: number, items = false): Located | null {
  const len = doc.text.length
  const tree = doc.tree
  const n = at >= len && len > 0 ? tree.resolveInner(len, -1) : tree.resolveInner(at, 1)
  if (n.name === 'BlankLine' && n.parent && isContainer(n.parent)) return { at: 'gap', container: n.parent, pos: at }
  // the place right after the last character of a cell `a|` is in the cell, not in the table around it
  if (n.name === 'Mark' && n.parent?.name === 'DelimitedBlock' && n.from === at && n.prevSibling?.name === 'TableCell') {
    const content = n.prevSibling.getChild('CellContent')
    if (content && content.to === at && at > 0) return locate(doc, at - 1, items)
  }
  // the blank lines after the last block of a cell `a|` are the table's in the tree, but the cell's to the one who edits
  if (n.name === 'BlankLine' && n.parent?.name === 'DelimitedBlock') {
    const cell = cellBefore(n)
    const content = cell?.getChild('CellContent')
    // (only a cell of the `a` style holds blocks: a plain table has its blank lines between rows, which are the table's)
    if (content && (content.firstChild || isAsciiCell(doc, cell!))) return { at: 'gap', container: content, pos: at }
  }
  for (let m: SyntaxNode | null = n; m; m = m.parent) {
    if (items && m.name === 'ListItem') {
      const e = elemOf(doc.text, m)
      if (e) return { at: 'elem', elem: e }
    }
    if (TARGETS.has(m.name)) {
      const e = elemOf(doc.text, m)
      if (e) return { at: 'elem', elem: e }
    }
  }
  return null
}

/** The start of a block together with the line that attaches it to a list item. */
export function fullStart(e: Elem): number {
  const prev = e.node.prevSibling
  if (e.container.name === 'ListItem' && prev && prev.name === 'ListContinuation') return prev.from
  return e.from
}

export const eolOf = (text: string): string => (text.includes('\r\n') ? '\r\n' : '\n')

/** The end of the blank lines that start at `pos` (the start of a line). */
function blankLinesEnd(text: string, pos: number): number {
  let e = pos
  for (;;) {
    const nl = text.indexOf('\n', e)
    if (nl < 0) return e
    if (/^[ \t\r]*$/.test(text.slice(e, nl))) e = nl + 1
    else return e
  }
}

/** The start of the blank lines that end at `pos` (the start of a line). */
function blankLinesStart(text: string, pos: number): number {
  let s = pos
  while (s > 0) {
    const ls = s >= 2 ? text.lastIndexOf('\n', s - 2) + 1 : 0
    if (/^[ \t\r]*\n$/.test(text.slice(ls, s))) s = ls
    else break
  }
  return s
}

/** The range to cut out to remove a block with the blank lines on one side of it (after it, or before the last one). */
export function removalRange(text: string, e: Elem): [number, number] {
  const start = fullStart(e)
  if (e.siblings[e.index + 1]) return [start, text[e.to - 1] === '\n' ? blankLinesEnd(text, e.to) : e.to]
  if (e.siblings[e.index - 1] && start > 0 && text[start - 1] === '\n') {
    let from = blankLinesStart(text, start)
    // a block with no line break after it has the one that ends the line it is on: the one before it goes
    if (text[e.to - 1] !== '\n' && from > 0) from -= text[from - 2] === '\r' ? 2 : 1
    return [from, e.to]
  }
  return [start, e.to]
}

/** Where a new block goes: among the blocks of a container, after `prev` and before `next`. */
export interface Destination {
  readonly container: SyntaxNode
  readonly prev: SyntaxNode | null
  readonly next: SyntaxNode | null
}

export function destinationOf(e: Elem, where: 'before' | 'after'): Destination {
  const s = e.siblings
  return where === 'before'
    ? { container: e.container, prev: s[e.index - 1] ?? null, next: s[e.index]! }
    : { container: e.container, prev: s[e.index]!, next: s[e.index + 1] ?? null }
}

export function gapDestination(text: string, container: SyntaxNode, pos: number): Destination {
  const els = elementsOf(container)
  let prev: SyntaxNode | null = null
  let next: SyntaxNode | null = null
  for (const s of els) {
    if (trimEnd(text, s.from, s.to) <= pos) prev = s
    else {
      next = s
      break
    }
  }
  return { container, prev, next }
}

export interface Insertion {
  readonly change: Change
  /** Where the source of the block starts in the inserted text. */
  readonly offset: number
}

const nonEmptyRest = (text: string, at: number): boolean => {
  if (at >= text.length) return false
  const c = text[at]
  return c !== '\n' && c !== '\r'
}

/**
 * The replacement that puts a block (`src`, no line break at its end) at a destination: the blank lines around it,
 * or the continuation line in a list item. Null where a block cannot go.
 */
export function insertion(
  text: string,
  dest: Destination,
  src: string,
  blankLines: number,
): Insertion | null {
  const eol = eolOf(text)
  const blank = eol.repeat(Math.max(1, blankLines))
  const { container, prev, next } = dest
  const attached = container.name === 'ListItem'
  const make = (at: number, pre: string, post: string, tail = ''): Insertion => ({
    change: { from: at, to: at, insert: pre + src + post + tail },
    offset: pre.length,
  })
  if (prev) {
    const anchor = trimEnd(text, prev.from, prev.to)
    const noEol = anchor > 0 && text[anchor - 1] !== '\n'
    const lead = noEol ? eol : ''
    const close = noEol && !nonEmptyRest(text, anchor) ? '' : eol
    if (attached) return make(anchor, lead + '+' + eol, close)
    // with no blank line between the two, the new block needs one after it as well
    const gapEmpty = next ? text.slice(anchor, next.from) === '' : false
    return make(anchor, lead + blank, close, gapEmpty ? blank : '')
  }
  if (next) {
    if (attached) {
      const cont = next.prevSibling
      if (cont && cont.name === 'ListContinuation') return make(cont.from, '+' + eol, eol)
      return make(next.from, '+' + eol, eol + blank)
    }
    // a block that starts in the middle of a line (the content of a cell after `a|`) goes on a line of its own
    const mid = next.from > 0 && text[next.from - 1] !== '\n'
    return make(next.from, mid ? eol : '', eol, blank)
  }
  // an empty container
  if (attached) return null
  if (container.name === 'Section') {
    const title = container.getChild('SectionTitle')
    if (!title) return null
    const noEol = text[title.to - 1] !== '\n'
    return make(title.to, (noEol ? eol : '') + blank, eol)
  }
  if (container.name === 'DelimitedBlock') {
    const close = container.getChildren('BlockDelimiter')
    const last = close[close.length - 1]
    if (!last || close.length < 2) return null
    return make(last.from, '', eol)
  }
  if (container.name === 'Document') {
    const n = text.length
    if (n === 0) return make(0, '', eol)
    const noEol = text[n - 1] !== '\n'
    let trailing = 0
    let i = n
    while (i > 0) {
      const ls = i >= 2 ? text.lastIndexOf('\n', i - 2) + 1 : 0
      if (/^[ \t\r]*\n?$/.test(text.slice(ls, i)) && ls < i) {
        trailing++
        i = ls
      } else break
    }
    const need = Math.max(1, blankLines) - (noEol ? 0 : trailing)
    return make(n, (noEol ? eol : '') + eol.repeat(Math.max(0, need)), eol)
  }
  return null
}

/** What kind of block a node is, as `expect` names it; null for what is not a block. */
export function kindOf(text: string, node: SyntaxNode): BlockKindName | null {
  switch (node.name) {
    case 'Section':
      return 'section'
    case 'DiscreteHeading':
      return 'heading'
    case 'Paragraph':
      return 'paragraph'
    case 'LiteralParagraph':
      return 'literal'
    case 'AdmonitionParagraph':
      return 'admonition'
    case 'StyledParagraph': {
      const attrs = node.getChild('BlockAttributes')
      const style = attrs ? (/^\[\s*([\w-]+)/.exec(text.slice(attrs.from, attrs.to))?.[1] ?? '').toLowerCase() : ''
      if (style === 'source' || style === 'listing') return 'listing'
      return style === 'literal' || style === 'pass' || style === 'stem' || style === 'verse' ? style : 'paragraph'
    }
    case 'DelimitedBlock': {
      const k = node.tree?.prop(blockKind) ?? 'open'
      return k as BlockKindName
    }
    case 'BlockQuote':
      return 'quote'
    case 'BlockMacro': {
      const n = node.getChild('MacroName')
      const name = n ? text.slice(n.from, n.to) : ''
      return name === 'image' || name === 'audio' || name === 'video' || name === 'toc' ? name : 'macro'
    }
    case 'ThematicBreak':
    case 'PageBreak':
      return 'break'
    case 'UnorderedList':
    case 'OrderedList':
    case 'CalloutList':
      return 'list'
    case 'DescriptionList':
      return 'dlist'
    case 'IncludeDirective':
      return 'include'
    case 'LineComment':
    case 'BlockComment':
      return 'comment'
    default:
      return null
  }
}

/** Where the ASG node of a container starts (-1 for the document): what the nodes it holds have as their holder. */
export function containerStart(container: SyntaxNode): number {
  if (container.name === 'Document') return -1
  if (container.name === 'CellContent') {
    for (let n: SyntaxNode | null = container.parent; n; n = n.parent) if (n.name === 'DelimitedBlock') return n.from
  }
  return container.from
}
