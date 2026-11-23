/**
 * The blocks of the top level and of the sections, in the order of the text, with the lines of metadata over each: what the
 * handle of a block in the visual editor works on. Kept out of the operations: a host that does not draw a handle does not
 * take it in.
 */
import type { SyntaxNode } from '@lezer/common'
import type { NotaDocument } from '../document.js'
import type { BlockKindName } from './blockspec.js'
import { TARGETS, elemOf, elementsOf, kindOf } from './elements.js'

/** A line of metadata over a block: the whole line (with its break) and the text it holds. */
export interface MetaLine {
  readonly from: number
  readonly to: number
  readonly textFrom: number
  readonly textTo: number
  readonly text: string
}

export interface TopBlock {
  /** The start of the block with its metadata lines. */
  readonly from: number
  /** The end of the block itself; for a section, the end of the title line (its content is the blocks after it). */
  readonly to: number
  /** The end of the block with all it holds: for a section, with the subsections. */
  readonly end: number
  readonly kind: BlockKindName | null
  /** A section (it moves and goes away with all it holds); a heading with no content is not one. */
  readonly section: boolean
  /** Where a new line of metadata goes: right over the first line of the block, under the ones it has. */
  readonly body: number
  readonly caption: MetaLine | null
  readonly anchor: MetaLine | null
}

const META = new Set(['BlockAnchor', 'BlockTitle', 'BlockAttributes'])

const lineOf = (text: string, n: SyntaxNode, inner: SyntaxNode | null, skip: number): MetaLine => {
  const textFrom = inner ? inner.from : n.from + skip
  const eol = text.slice(n.from, n.to).search(/\r?\n$/)
  const textTo = inner ? inner.to : eol < 0 ? n.to : n.from + eol
  return { from: n.from, to: n.to, textFrom, textTo, text: text.slice(textFrom, textTo) }
}

export function topBlocks(doc: NotaDocument): TopBlock[] {
  const text = doc.text
  const out: TopBlock[] = []
  const walk = (container: SyntaxNode): void => {
    for (const n of elementsOf(container)) {
      if (!TARGETS.has(n.name)) continue
      const e = elemOf(text, n)
      if (!e) continue
      let body = n.from
      let caption: MetaLine | null = null
      let anchor: MetaLine | null = null
      for (let k = n.firstChild; k && META.has(k.name); k = k.nextSibling) {
        body = k.to
        if (k.name === 'BlockTitle' && !caption) caption = lineOf(text, k, null, 1)
        else if (k.name === 'BlockAnchor' && !anchor) anchor = lineOf(text, k, k.getChild('AnchorId'), 2)
      }
      const section = n.name === 'Section'
      const title = section ? n.getChild('SectionTitle') : null
      out.push({
        from: e.from,
        to: title ? title.to : e.to,
        end: e.to,
        kind: kindOf(text, n),
        section,
        body,
        caption,
        anchor,
      })
      if (section) walk(n)
    }
  }
  walk(doc.tree.topNode)
  return out
}

/** Whether a blank line follows `to` (the end of a block, at the start of a line): the place of the block after it. */
export function blankAfter(text: string, to: number): boolean {
  if (to <= 0 || to >= text.length || text[to - 1] !== '\n') return false
  const nl = text.indexOf('\n', to)
  return nl >= 0 && /^[ \t\r]*$/.test(text.slice(to, nl))
}
