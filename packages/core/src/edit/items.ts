/**
 * Operations on the items of lists and on admonitions as the visual editor shows them: Enter, Backspace and Delete in
 * an item, an item started by typing, the checkbox of an item, the type of an admonition.
 */
import type { SyntaxNode } from '@lezer/common'
import type { NotaDocument } from '../document.js'
import { blockKind as blockKindProp } from '../nodes.js'
import { type OperationResult, failure } from './common.js'
import { cellsOf, finish, textSpec } from './blocks.js'
import { ADMONITIONS } from './layout.js'
import { childMarker } from './lists.js'
import { normalizeCells, plainCell } from './print.js'
import type { Ctx, Spec } from './window.js'
import { commitWindow } from './window.js'
import type { BlockInfo, Cell } from './types.js'

const unchanged = (doc: NotaDocument): OperationResult => ({ doc, changes: [] })

export const isOrdered = (marker: string): boolean => /^(\.+|\d+\.)$/.test(marker)

/** The marker of the item that follows an item with `marker` on the same level (`1.` is followed by `2.`). */
export function nextMarker(marker: string): string {
  const m = /^(\d+)\.$/.exec(marker)
  return m ? `${Number(m[1]) + 1}.` : marker
}

/** The blank text between the marker of an item and the first thing after it. */
export function gapAfterMarker(t: string, b: BlockInfo): string {
  const m = /^[ \t]*/.exec(t.slice(b.markerFrom + b.marker.length, b.content!.from))
  return m && m[0] !== '' ? m[0] : ' '
}

/**
 * The item after the item `index` is an item of the same list: it follows directly, or after the one blank line that
 * a list keeps between its items (more blank lines show as empty paragraphs between the items).
 */
const touching = (ctx: Ctx, index: number): boolean => ctx.items[index + 1]?.kind === 'item'

/** True when the item `index` holds items of its own (the ones after it that are deeper). */
function hasChildren(ctx: Ctx, index: number): boolean {
  const x = ctx.items[index]!
  const n = ctx.items[index + 1]
  return !!n && n.kind === 'item' && n.block!.level > x.block!.level
}

/**
 * The numbers of the items that follow a new item with the marker `marker`: the ones of the same level written as `2.` go on from it.
 * Returns the index of the last of them and the new specs by index; nothing when there are none or `marker` is not `N.`.
 */
function renumberAfter(
  ctx: Ctx,
  index: number,
  level: number,
  marker: string,
): { last: number; specs: Map<number, Spec> } | null {
  const m = /^(\d+)\.$/.exec(marker)
  if (!m) return null
  let n = Number(m[1])
  const specs = new Map<number, Spec>()
  let last = index
  for (let j = index + 1; j < ctx.items.length; j++) {
    const x = ctx.items[j]!
    if (x.kind !== 'item' || x.block!.level < level) break
    last = j
    if (x.block!.level !== level || !/^\d+\.$/.test(x.block!.marker)) continue
    n++
    const b = x.block!
    const base = textSpec(ctx.doc, b, cellsOf(ctx.doc, b))
    specs.set(j, { ...base, prefix: base.prefix.replace(/^\d+\./, `${n}.`) })
  }
  return specs.size === 0 ? null : { last, specs }
}

/** Enter in the middle of the text of an item: two items of the same level and kind. */
export function splitListItem(ctx: Ctx, index: number, k: number): OperationResult {
  const it = ctx.items[index]!
  const b = it.block!
  const doc = ctx.doc
  const cells = cellsOf(doc, b)
  let left = cells.slice(0, k)
  const blank = (c: Cell): boolean =>
    c.newline || (c.kind === 'char' && (c.ch === ' ' || c.ch === '\t') && c.spans.length > 0)
  while (left.length && blank(left[left.length - 1]!)) left = left.slice(0, -1)
  let from = k
  while (from < cells.length && blank(cells[from]!)) from++
  const right = normalizeCells(cells.slice(from), 'paragraph', ctx.eol)
  // (at the ends of the text the editor puts an empty item that is not in the text yet)
  if (left.length === 0 || right.length === 0) return unchanged(doc)
  const eol = b.eol || ctx.eol
  const prefix =
    nextMarker(b.marker) + gapAfterMarker(ctx.doc.text, b) + (b.checked !== '' ? '[ ] ' : '')
  const tail = renumberAfter(ctx, index, b.level, nextMarker(b.marker))
  const r = commitWindow(ctx, index, tail?.last ?? index, (kept, first) =>
    kept.flatMap((s, i) =>
      i + first === index
        ? [
            { ...textSpec(doc, b, left), eol },
            { ...textSpec(doc, b, right), prefix, eol: b.eol },
          ]
        : [tail?.specs.get(i + first) ?? s],
    ),
  )
  return finish(r, 'the item splits', it.from, it.to)
}

/** Backspace at the start of the first item of a list: it is a paragraph before the list. */
export function itemToParagraph(ctx: Ctx, index: number): OperationResult {
  const it = ctx.items[index]!
  const b = it.block!
  if (hasChildren(ctx, index))
    return failure('item-has-items', 'An item with items inside it does not become a paragraph', it.from, it.to)
  const cells = cellsOf(ctx.doc, b)
  const spec: Spec = {
    t: 'text',
    kind: 'paragraph',
    meta: '',
    prefix: '',
    suffix: '',
    level: 0,
    cells,
    eol: b.eol || ctx.eol,
  }
  const r = commitWindow(ctx, index, index, (kept, first) => kept.map((s, i) => (i + first === index ? spec : s)))
  return finish(r, 'the item becomes a paragraph', it.from, it.to)
}

/** True when joining the item `x` (to what is before it, or to what is after the item before) must be refused. */
export function joinRefusal(ctx: Ctx, x: number): OperationResult | null {
  const X = ctx.items[x]!
  if (X.kind === 'item' && hasChildren(ctx, x))
    return failure('item-has-items', 'An item with items inside it is not joined to another', X.from, X.to)
  return null
}

/** Backspace at the start of an item (not the first of its list) / Delete at the end of the one before: is the pair one list? */
export function sameRun(ctx: Ctx, w: number, x: number): boolean {
  return ctx.items[w]!.kind === 'item' && ctx.items[x]!.kind === 'item' && touching(ctx, w)
}

/** The prefix a new item after the item `index` gets on `level`; null when the level does not fit. */
function prefixFor(ctx: Ctx, index: number, level: number): string | null {
  const x = ctx.items[index]!.block!
  let marker: string | null = null
  if (level === x.level) marker = nextMarker(x.marker)
  else if (level === x.level + 1) marker = childMarker(x.marker, isOrdered(x.marker) ? 'OrderedList' : 'UnorderedList')
  else if (level < x.level) {
    for (let j = index - 1; j >= 0; j--) {
      const p = ctx.items[j]!
      if (p.kind !== 'item' || ctx.items[j + 1]?.kind !== 'item') break
      if (p.block!.level === level) {
        marker = nextMarker(p.block!.marker)
        break
      }
      if (p.block!.level < level) break
    }
  }
  if (marker === null) return null
  return marker + gapAfterMarker(ctx.doc.text, x) + (x.checked !== '' ? '[ ] ' : '')
}

const plainCells = (text: string, eol: string): Cell[] =>
  normalizeCells(text.split('').map((ch) => plainCell(ch)), 'paragraph', eol)

/** The first thing typed in an empty item that follows the item `index` (not in the text yet): a new item on `level`. */
export function insertItem(ctx: Ctx, index: number, level: number, text: string): OperationResult {
  const it = ctx.items[index]!
  if (it.kind !== 'item') return failure('not-editable', 'A list item goes after an item', it.from, it.to)
  const prefix = prefixFor(ctx, index, level)
  if (prefix === null) return failure('bad-level', 'An item does not go on that level', it.from, it.to)
  const cells = plainCells(text, ctx.eol)
  if (cells.length === 0) return unchanged(ctx.doc)
  const b = it.block!
  const spec: Spec = {
    t: 'text',
    kind: 'item',
    meta: '',
    prefix,
    suffix: '',
    level,
    cells,
    eol: b.eol || ctx.eol,
  }
  const tail = renumberAfter(ctx, index, level, /^\S+/.exec(prefix)?.[0] ?? '')
  const r = commitWindow(ctx, index, tail?.last ?? index, (kept, first) =>
    kept.flatMap((s, i) => (i + first === index ? [s, spec] : [tail?.specs.get(i + first) ?? s])),
  )
  return finish(r, 'the item is added', it.from, it.to)
}

const ITEM_PREFIX = /^(\*|-|\.|\d+\.) (\[ \] )?$/
const HEADING_PREFIX = /^(={2,6}) $/
const ADMONITION_PREFIX = /^(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION): $/

/** The first thing typed in an empty paragraph that was started as an item or a heading (`* `, `1. `, `== `). */
export function startBlock(ctx: Ctx, index: number, prefix: string, text: string): OperationResult {
  const it = ctx.items[index]!
  if (it.kind !== 'empty') return failure('not-editable', 'A block is started in an empty paragraph', it.from, it.to)
  const item = ITEM_PREFIX.test(prefix)
  const head = HEADING_PREFIX.exec(prefix)
  const warning = ADMONITION_PREFIX.test(prefix)
  if (!item && !head && !warning)
    return failure('invalid-block', 'A block starts with a list marker, a heading marker or a type of warning', it.from, it.to)
  const heading = !!head
  const cells = normalizeCells(
    text.split('').map((ch) => plainCell(ch)),
    heading ? 'heading' : 'paragraph',
    ctx.eol,
  )
  if (cells.length === 0) return unchanged(ctx.doc)
  const spec: Spec = {
    t: 'text',
    kind: heading ? 'heading' : warning ? 'paragraph' : 'item',
    meta: '',
    prefix,
    suffix: '',
    level: heading ? head![1]!.length : warning ? 0 : 1,
    cells,
    eol: ctx.eol,
  }
  const r = commitWindow(ctx, index, index, (kept, first) => kept.map((s, i) => (i + first === index ? spec : s)))
  return finish(r, 'the block is started', it.from, it.to)
}

/** Enter in an empty item of the first level that is the last of its list: an empty paragraph follows the item `index`. */
export function endList(ctx: Ctx, index: number): OperationResult {
  const it = ctx.items[index]!
  if (it.kind !== 'item') return failure('not-editable', 'A list ends after an item', it.from, it.to)
  if (touching(ctx, index))
    return failure(
      'list-middle',
      'An empty item in the middle of a list does not become a paragraph',
      it.from,
      it.to,
    )
  const next = ctx.items[index + 1]
  if (next?.kind === 'empty') return unchanged(ctx.doc)
  const r = commitWindow(ctx, index, index, (kept, first) =>
    kept.flatMap((s, i) => (i + first === index ? [s, { t: 'empty' } as Spec] : [s])),
  )
  return finish(r, 'the list ends', it.from, it.to)
}

// ---------------------------------------------------------------- checkbox, admonition

function climb(doc: NotaDocument, at: number, name: string): SyntaxNode | null {
  for (const side of [1, -1] as const) {
    for (let n: SyntaxNode | null = doc.tree.resolveInner(at, side); n; n = n.parent) {
      if (n.name === name) return n
      if (n.name === 'Document') break
    }
  }
  return null
}

/** The checkbox of the item that holds `at` is set to `checked` (`[x]`) or cleared (`[ ]`); one sign changes. */
export function setChecked(doc: NotaDocument, at: number, checked: boolean): OperationResult {
  const item = climb(doc, at, 'ListItem')
  const box = item?.getChild('Checkbox')
  if (!item || !box || box.to - box.from !== 3)
    return failure('invalid-target', 'There is no checkbox here', at, at)
  const sign = checked ? 'x' : ' '
  if (doc.text[box.from + 1] === sign) return unchanged(doc)
  const changes = [{ from: box.from + 1, to: box.to - 1, insert: sign }]
  const next = doc.update(changes)
  const again = climb(next, box.from + 1, 'ListItem')?.getChild('Checkbox')
  if (!again || again.from !== box.from || next.text[box.from + 1] !== sign)
    return failure('collateral', 'The checkbox does not read as it should', box.from, box.to)
  return { doc: next, changes }
}

/** The type of the admonition that holds `at` (a paragraph `NOTE: …` or a block `[NOTE]` over `====`); only the word changes. */
export function setAdmonitionType(doc: NotaDocument, at: number, variant: string): OperationResult {
  if (!ADMONITIONS.has(variant)) return failure('invalid-block', 'That is not a type of admonition', at, at)
  const text = doc.text
  let from = -1
  let to = -1
  const para = climb(doc, at, 'AdmonitionParagraph')
  const block = climb(doc, at, 'DelimitedBlock')
  const isBox = (n: SyntaxNode | null): boolean => !!n && n.tree?.prop(blockKindProp) === 'admonition'
  if (para) {
    const m = para.getChild('AdmonitionMarker')
    if (m) {
      from = m.from
      to = m.from + text.slice(m.from, m.to).replace(/:\s*$/, '').length
    }
  } else {
    // the nearest block around that is an admonition
    let b: SyntaxNode | null = block
    while (b && !isBox(b)) b = b.parent && b.parent.name === 'DelimitedBlock' ? b.parent : null
    if (b) {
      for (let c = b.firstChild; c && c.name !== 'BlockDelimiter'; c = c.nextSibling) {
        if (c.name !== 'BlockAttributes') continue
        const p = c.getChild('PositionalAttribute')
        const style = p?.getChild('ShorthandStyle')
        const w = style ?? (p && !p.firstChild ? p : null)
        if (w && ADMONITIONS.has(text.slice(w.from, w.to))) {
          from = w.from
          to = w.to
          break
        }
      }
    }
  }
  if (from < 0) return failure('invalid-target', 'There is no admonition here', at, at)
  if (text.slice(from, to) === variant) return unchanged(doc)
  const changes = [{ from, to, insert: variant }]
  const next = doc.update(changes)
  if (next.text.slice(from, from + variant.length) !== variant)
    return failure('collateral', 'The type does not read as it should', from, to)
  return { doc: next, changes }
}
