/**
 * Edits that change which blocks there are (typing into an empty paragraph, Enter, Backspace at the start of a
 * block, a deletion over several blocks, a change of style) work on a window: the blocks they touch with the blank
 * lines around them. The window is written again from a list of specs and the result is read again and checked.
 */
import type { NotaDocument } from '../document.js'
import type { Change } from '../changes.js'
import { diffChange, firstDivergence } from './realize.js'
import { isRawKind, layoutItems, readLayout } from './layout.js'
import { normalizeCells, printCells } from './print.js'
import { readInline } from './read.js'
import type { Cell, Item, Layout } from './types.js'

export interface Ctx {
  readonly doc: NotaDocument
  readonly layout: Layout
  readonly items: readonly Item[]
  /** The line break the document uses. */
  readonly eol: string
}

export const docEol = (text: string): string => (text.includes('\r\n') ? '\r\n' : '\n')

export function makeCtx(doc: NotaDocument): Ctx {
  const layout = readLayout(doc)
  return { doc, layout, items: layoutItems(layout), eol: docEol(doc.text) }
}

export type Spec =
  | { readonly t: 'keep'; readonly item: Item }
  | {
      readonly t: 'text'
      readonly kind: 'paragraph' | 'heading' | 'item'
      readonly meta: string
      readonly prefix: string
      readonly suffix: string
      readonly level: number
      readonly cells: readonly Cell[]
      readonly eol: string
    }
  | { readonly t: 'empty' }
  /** A block written as it is (with its line break): it has to read as the items `kinds`, in this order. */
  | { readonly t: 'raw'; readonly text: string; readonly kinds: readonly Item['kind'][] }

/** The gaps a–b (and the blocks a … b-1 between them) that hold the items `p`–`q`, and the item range they span. */
export function windowOf(
  ctx: Ctx,
  p: number,
  q: number,
): { a: number; b: number; first: number; last: number } {
  let a = Infinity
  let b = -Infinity
  for (let i = p; i <= q; i++) {
    const it = ctx.items[i]!
    if (it.kind === 'empty') {
      a = Math.min(a, it.gap)
      b = Math.max(b, it.gap)
    } else {
      a = Math.min(a, it.blockIndex)
      b = Math.max(b, it.blockIndex + 1)
    }
  }
  let first = -1
  let last = -1
  ctx.items.forEach((it, i) => {
    const inside =
      it.kind === 'empty' ? it.gap >= a && it.gap <= b : it.blockIndex >= a && it.blockIndex <= b - 1
    if (inside) {
      if (first < 0) first = i
      last = i
    }
  })
  return { a, b, first, last }
}

type Atom = { r: false; text: string } | { r: true; text: string; keep: number; item: boolean }

export interface Window {
  readonly from: number
  readonly to: number
  readonly text: string
}

/** Writes the window over the gaps a–b again from the specs. */
export function renderWindow(ctx: Ctx, a: number, b: number, specs: readonly Spec[]): Window {
  const { layout, doc } = ctx
  const text = doc.text
  const n = layout.blocks.length
  const gA = layout.gaps[a]!
  const gB = layout.gaps[b]!
  const hasPrev = a > 0
  const hasNext = b < n
  const atoms: Atom[] = specs.map((s) => {
    if (s.t === 'empty') return { r: false, text: ctx.eol }
    if (s.t === 'raw') return { r: true, text: s.text, keep: -1, item: false }
    if (s.t === 'keep') {
      // the empty paragraph of an empty document has no line yet
      if (s.item.kind === 'empty')
        return { r: false, text: s.item.line < 0 ? ctx.eol : text.slice(s.item.from, s.item.to) }
      return { r: true, text: text.slice(s.item.from, s.item.to), keep: s.item.blockIndex, item: s.item.kind === 'item' }
    }
    const src =
      s.meta +
      s.prefix +
      printCells(normalizeCells(s.cells, s.kind === 'item' ? 'paragraph' : s.kind, ctx.eol)) +
      s.suffix +
      s.eol
    return { r: true, text: src, keep: -1, item: s.kind === 'item' }
  })
  // a document that is one empty paragraph is an empty text
  if (!hasPrev && !hasNext && specs.length === 1 && specs[0]!.t === 'empty')
    return { from: gA.from, to: gB.to, text: '' }
  const lineCount = (gap: number): number => layout.gaps[gap]!.lines.length
  const firstLine = (gap: number): string => {
    const l = layout.gaps[gap]!.lines[0]
    return l ? text.slice(l.from, l.to) : ctx.eol
  }
  let out = ''
  const endsLine = (s: string): boolean => s.endsWith('\n')
  const put = (s: string): void => {
    out += s
  }
  // slots: the empties before the first block, between blocks, after the last one
  const slots: { es: Atom[]; left: boolean; right: boolean; orig: number; sep: string }[] = []
  const blocks: Atom[] = []
  let cur: Atom[] = []
  for (const at of atoms) {
    if (at.r) {
      slots.push({ es: cur, left: true, right: true, orig: 1, sep: ctx.eol })
      blocks.push(at)
      cur = []
    } else cur.push(at)
  }
  slots.push({ es: cur, left: true, right: true, orig: 1, sep: ctx.eol })
  // fill in what is known about each slot
  slots[0]!.left = hasPrev
  slots[0]!.orig = Math.min(lineCount(a), 1)
  slots[0]!.sep = firstLine(a)
  slots[slots.length - 1]!.right = hasNext
  if (blocks.length > 0) {
    const tail = slots[slots.length - 1]!
    tail.orig = Math.min(lineCount(b), 1)
    tail.sep = firstLine(b)
    if (!hasNext) {
      // at the end of the document a blank line after the last block stays only while its empty paragraphs do
      const had = Math.max(0, lineCount(b) - 1)
      const kept = specs.filter((s) => s.t === 'keep' && s.item.kind === 'empty' && s.item.gap === b).length
      if (kept < had) tail.orig = 0
    }
  } else if (b > a) {
    // blocks were taken out: what is left of the gaps around them is one gap
    slots[0]!.orig = Math.min(1, Math.max(lineCount(a), lineCount(b)))
  }
  for (let k = 1; k < blocks.length; k++) {
    const l = blocks[k - 1]!
    const r = blocks[k]!
    if (l.r && r.r && l.keep >= 0 && r.keep === l.keep + 1) {
      const gi = r.keep
      slots[k]!.orig = Math.min(lineCount(gi), 1)
      slots[k]!.sep = firstLine(gi)
    } else if (l.r && r.r && l.item && r.item) slots[k]!.orig = 0
    else if (l.r && r.r && l.item !== r.item) slots[k]!.orig = Math.max(slots[k]!.orig, 1)
  }
  // an item next to a block that is not one (outside the window) is parted from it by a blank line
  if (blocks.length > 0) {
    const first = blocks[0] as Extract<Atom, { r: true }>
    const last = blocks[blocks.length - 1] as Extract<Atom, { r: true }>
    if (hasPrev && (layout.blocks[a - 1]!.kind === 'item') !== first.item && layout.blocks[a - 1]!.kind !== 'fence')
      slots[0]!.orig = Math.max(slots[0]!.orig, 1)
    if (hasNext && (layout.blocks[b]!.kind === 'item') !== last.item && layout.blocks[b]!.kind !== 'fence')
      slots[slots.length - 1]!.orig = Math.max(slots[slots.length - 1]!.orig, 1)
  }
  const emitSlot = (s: (typeof slots)[number]): void => {
    let sep = 0
    if (s.left && s.right) sep = s.es.length > 0 ? 1 : s.orig
    else if (s.left && !s.right) sep = s.es.length > 0 ? 1 : s.orig
    if (sep) {
      if (out !== '' && !endsLine(out)) put(ctx.eol)
      put(s.sep)
    }
    for (const e of s.es) {
      if (out !== '' && !endsLine(out)) put(ctx.eol)
      put(e.text)
    }
  }
  emitSlot(slots[0]!)
  blocks.forEach((bl, k) => {
    if (out !== '' && !endsLine(out)) put(ctx.eol)
    put(bl.text)
    emitSlot(slots[k + 1]!)
  })
  // a line that is followed by something ends with a line break; the last line of the document may not
  return { from: gA.from, to: gB.to, text: out }
}

export interface Committed {
  readonly doc: NotaDocument
  readonly changes: Change[]
}

/** What a reason ends with when the text would be read as a plate (a list, a code block …). */
export const PLATE = 'it is a chip'

/** Why a window could not be written: what the new text reads as is not what the specs say. */
export function verifyWindow(
  ctx: Ctx,
  next: NotaDocument,
  first: number,
  last: number,
  specs: readonly Spec[],
): string | null {
  const nl = readLayout(next)
  const ni = layoutItems(nl)
  const oi = ctx.items
  const tail = oi.length - 1 - last
  const count = specs.reduce((n, s) => n + (s.t === 'raw' ? s.kinds.length : 1), 0)
  if (ni.length !== first + count + tail) return `expected ${first + count + tail} items, the text has ${ni.length}`
  const delta = next.text.length - ctx.doc.text.length
  const same = (o: Item, n: Item, shift: number): boolean =>
    o.kind === n.kind &&
    o.from + shift === n.from &&
    o.to + shift === n.to &&
    ctx.doc.text.slice(o.from, o.to) === next.text.slice(n.from, n.to)
  for (let i = 0; i < first; i++) if (!same(oi[i]!, ni[i]!, 0)) return `the item ${i} changed`
  for (let k = 0; k < tail; k++)
    if (!same(oi[last + 1 + k]!, ni[first + count + k]!, delta))
      return `an item after the change changed`
  let at = first
  for (let i = 0; i < specs.length; i++) {
    const s = specs[i]!
    if (s.t === 'raw') {
      for (const kind of s.kinds) {
        if (ni[at]!.kind !== kind) return `item ${at} should be a ${kind}, it is a ${ni[at]!.kind}`
        at++
      }
      continue
    }
    const n = ni[at]!
    at++
    if (s.t === 'empty') {
      if (n.kind !== 'empty') return `item ${at - 1} should be an empty paragraph`
    } else if (s.t === 'keep') {
      if (n.kind !== s.item.kind) return `item ${at - 1} changed its kind`
      if (isRawKind(n.kind)) {
        if (ctx.doc.text.slice(s.item.from, s.item.to) !== next.text.slice(n.from, n.to))
          return `a plate changed`
      } else if (n.kind !== 'empty') {
        const o = s.item.block!
        const nb = n.block!
        if (nb.level !== o.level) return 'a level changed'
        const a = readInline(ctx.doc, o.content!.from, o.content!.to).cells
        const b = readInline(next, nb.content!.from, nb.content!.to).cells
        if (firstDivergence(a, b) >= 0) return 'a block changed its text'
      }
    } else {
      const x = at - 1
      if (n.kind !== s.kind)
        return `item ${x} should be a ${s.kind}, ${n.kind === 'item' || isRawKind(n.kind) ? PLATE : `it is a ${n.kind}`}`
      const nb = n.block!
      if (nb.level !== s.level) return `item ${x} has level ${nb.level}, not ${s.level}`
      const meta = nb.meta ? next.text.slice(nb.meta.from, nb.meta.to) : ''
      if (meta !== s.meta) return 'the lines above a block changed'
      if (next.text.slice(nb.meta?.to ?? nb.from, nb.content!.from) !== s.prefix)
        return `item ${x} does not start as it should, ${PLATE}`
      const cells = readInline(next, nb.content!.from, nb.content!.to).cells
      if (firstDivergence(cells, normalizeCells(s.cells, s.kind === 'item' ? 'paragraph' : s.kind, ctx.eol)) >= 0)
        return `item ${x} does not read as it should`
    }
  }
  return null
}

/** Writes the window and checks it. */
export function commitWindow(
  ctx: Ctx,
  p: number,
  q: number,
  build: (kept: readonly Spec[], first: number) => Spec[],
):
  | { ok: true; doc: NotaDocument; changes: Change[]; specs: Spec[]; first: number }
  | { ok: false; reason: string } {
  const { a, b, first, last } = windowOf(ctx, p, q)
  const kept: Spec[] = []
  for (let i = first; i <= last; i++) kept.push({ t: 'keep', item: ctx.items[i]! })
  const specs = build(kept, first)
  const w = renderWindow(ctx, a, b, specs)
  const old = ctx.doc.text.slice(w.from, w.to)
  const changes = diffChange(w.from, old, w.text)
  const next = changes.length ? ctx.doc.update(changes) : ctx.doc
  const problem = verifyWindow(ctx, next, first, last, specs)
  if (problem) return { ok: false, reason: problem }
  return { ok: true, doc: next, changes, specs, first }
}
