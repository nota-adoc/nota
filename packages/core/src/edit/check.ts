/**
 * The check that an operation changed only its target: the items of the document (blocks and empty paragraphs)
 * that lie clear of the changes are the same before and after (the same kind and level, the same source).
 */
import type { NotaDocument } from '../document.js'
import type { Change } from '../changes.js'
import { layoutItems, readLayout } from './layout.js'
import type { Item } from './types.js'

function itemKey(doc: NotaDocument, it: Item): string {
  return `${it.kind}:${it.block?.level ?? 0}:${doc.text.slice(it.from, it.to)}`
}

/**
 * Compares two documents around `changes` (given in coordinates of `before`). Returns the problems found; none means
 * that everything but the items the changes touch (and one item on each side of them) is as it was.
 */
export function checkNoCollateral(
  before: NotaDocument,
  after: NotaDocument,
  changes: readonly Change[],
): string[] {
  if (changes.length === 0)
    return before.text === after.text ? [] : ['no changes given, but the text differs']
  const oi = layoutItems(readLayout(before))
  const ni = layoutItems(readLayout(after))
  const lo = changes[0]!.from
  const hi = changes[changes.length - 1]!.to
  const delta = after.text.length - before.text.length
  const problems: string[] = []
  // items that end before the first change, and start after the last one, with one item of margin
  let p = 0
  while (p < oi.length && oi[p]!.to < lo) p++
  p = Math.max(0, p - 1)
  let s = 0
  while (s < oi.length && oi[oi.length - 1 - s]!.from > hi) s++
  s = Math.max(0, s - 1)
  for (let i = 0; i < p; i++) {
    const n = ni[i]
    if (!n || n.from !== oi[i]!.from || n.to !== oi[i]!.to || itemKey(before, oi[i]!) !== itemKey(after, n))
      problems.push(`the item before the change at ${oi[i]!.from} changed`)
  }
  for (let k = 0; k < s; k++) {
    const o = oi[oi.length - 1 - k]!
    const n = ni[ni.length - 1 - k]
    if (!n || n.from !== o.from + delta || n.to !== o.to + delta || itemKey(before, o) !== itemKey(after, n))
      problems.push(`the item after the change at ${o.from} changed`)
  }
  if (oi.length - p - s < 0 || ni.length - p - s < 0) problems.push('items overlap the margins')
  return problems
}
