/**
 * Operations on blocks whose text is shown as it is written: the code of a listing, the caption of an image, an island
 * (source that the editor does not read, edited as text), and the placing of a block new next to a block or in the place of
 * an empty paragraph. Each is written as the smallest replacement of the text, read again, and checked: the blocks
 * around the target are the same as they were.
 */
import type { SyntaxNode } from '@lezer/common'
import { type ParseOptions, type NotaDocument, parse } from '../document.js'
import type { Change } from '../changes.js'
import { type OperationResult, failure } from './common.js'
import { type BlockSpec } from './blockspec.js'
import { finish } from './blocks.js'
import { layoutItems, listingStyle, readLayout } from './layout.js'
import { diffChange } from './realize.js'
import { type Env, apart, nl, noTarget, specSource } from './structure.js'
import type { BlockInfo, Item } from './types.js'
import { type Ctx, type Spec, commitWindow, makeCtx } from './window.js'

const unchanged = (doc: NotaDocument): OperationResult => ({ doc, changes: [] })

/** The item that holds `at`: the one that starts at or before it and ends after it, else the one that ends at it. */
function itemHolding(ctx: Ctx, at: number): number {
  const items = ctx.items
  let found = -1
  for (let i = 0; i < items.length; i++) {
    const it = items[i]!
    if (it.from <= at && at < it.to) return i
    if (it.from <= at && at <= it.to) found = i
    if (it.from > at) break
  }
  return found
}

const same = (before: string, o: Item, after: string, n: Item, shift: number): boolean =>
  o.kind === n.kind &&
  o.from + shift === n.from &&
  o.to + shift === n.to &&
  before.slice(o.from, o.to) === after.slice(n.from, n.to)

/**
 * The items of the document after an edit of the range `from`–`to` (of the items overlapping it) that are not the ones
 * the edit made: those before and after must be as they were. Returns the items the edit made, or null when the items around
 * changed (the text makes blocks around it read in another way).
 */
export function itemsAround(ctx: Ctx, next: NotaDocument, from: number, to: number): Item[] | null {
  const oi = ctx.items
  let k1 = 0
  while (k1 < oi.length && oi[k1]!.to <= from) k1++
  let k2 = 0
  while (k2 < oi.length - k1 && oi[oi.length - 1 - k2]!.from >= to) k2++
  const ni = layoutItems(readLayout(next))
  if (k1 + k2 > ni.length) return null
  const shift = next.text.length - ctx.doc.text.length
  for (let i = 0; i < k1; i++) if (!same(ctx.doc.text, oi[i]!, next.text, ni[i]!, 0)) return null
  for (let k = 0; k < k2; k++)
    if (!same(ctx.doc.text, oi[oi.length - 1 - k]!, next.text, ni[ni.length - 1 - k]!, shift)) return null
  return ni.slice(k1, ni.length - k2)
}

function climb(doc: NotaDocument, from: number, name: string): SyntaxNode | null {
  for (let n: SyntaxNode | null = doc.tree.resolveInner(from, 1); n; n = n.parent)
    if (n.name === name && n.from === from) return n
  return null
}

const lf = (s: string): string => s.replace(/\r\n|\r/g, '\n')

function blockAt(ctx: Ctx, at: number, kind: string, what: string): { it: Item; b: BlockInfo } | OperationResultFailure {
  const i = itemHolding(ctx, at)
  const it = i < 0 ? null : ctx.items[i]!
  if (!it || it.kind !== kind) return failure('not-editable', `There is no ${what} here`, at, at)
  return { it, b: it.block! }
}
type OperationResultFailure = Extract<OperationResult, { error: string }>

/** The text of the body of a block of code, with `\n` for every line break. */
export const codeText = (doc: NotaDocument, b: BlockInfo): string => lf(doc.text.slice(b.content!.from, b.content!.to))

/** The text of the code of the block that holds `at` becomes `text`; the delimiter grows when a line of the text is as long as it. */
export function setCodeText(doc: NotaDocument, at: number, text: string): OperationResult {
  const ctx = makeCtx(doc)
  const r = blockAt(ctx, at, 'code', 'code')
  if ('error' in r) return r
  const { it, b } = r
  const t = doc.text
  const body = lf(text)
  const eol = b.eol || ctx.eol
  const n = b.marker.length
  const lines = body.split('\n')
  let m = n
  while (lines.some((l) => l.trimEnd() === '-'.repeat(m))) m++
  const cur = codeText(doc, b)
  if (cur === body && m === n) return unchanged(doc)
  const closeFrom = t.lastIndexOf('\n', it.to - b.eol.length - 1) + 1
  const start = b.markerFrom
  const end = closeFrom + n
  const rest = t.slice(start + n, b.content!.from)
  const bodyNow = t.slice(b.content!.from, closeFrom)
  const bodyNew = cur === body ? bodyNow : body === '' ? '' : nl(body, eol) + eol
  const oldStr = t.slice(start, end)
  const newStr = '-'.repeat(m) + rest + bodyNew + '-'.repeat(m)
  const changes = diffChange(start, oldStr, newStr)
  const next = doc.update(changes)
  const made = itemsAround(ctx, next, it.from, it.to)
  if (!made || made.length !== 1 || made[0]!.kind !== 'code')
    return failure('collateral', 'That text does not stay code', it.from, it.to)
  const nb = made[0]!.block!
  if (codeText(next, nb) !== body || nb.lang !== b.lang)
    return failure('collateral', 'That text does not read as written', it.from, it.to)
  return { doc: next, changes }
}

/** The language of the code that holds `at` (`[source,language]`); the rest of the attribute line stays. */
export function setCodeLanguage(doc: NotaDocument, at: number, language: string): OperationResult {
  if (typeof language !== 'string' || !/^[\w+#.-]+$/.test(language))
    return failure('invalid-block', 'The language of a listing is a word', at, at)
  const ctx = makeCtx(doc)
  const r = blockAt(ctx, at, 'code', 'code')
  if ('error' in r) return r
  const { it, b } = r
  if (b.lang === language) return unchanged(doc)
  const t = doc.text
  const eol = b.eol || ctx.eol
  const node = climb(doc, b.from, 'DelimitedBlock')
  if (!node) return failure('invalid-target', 'There is no code here', at, at)
  const open = node.getChildren('BlockDelimiter')[0]!
  const style = listingStyle(node, t, open.from)
  let change: Change | null = null
  if (style && style.style === 'source') {
    if (style.lang) change = { from: style.lang.from, to: style.lang.to, insert: language }
    else {
      const close = style.line!.getChildren('Mark').filter((x) => t.slice(x.from, x.to) === ']').pop()
      if (close) change = { from: close.from, to: close.from, insert: `,${language}` }
    }
  } else if (style && style.styleNode && !style.lang && !style.styleNode.firstChild) {
    change = { from: style.styleNode.from, to: style.styleNode.to, insert: `source,${language}` }
  }
  change ??= { from: b.markerFrom, to: b.markerFrom, insert: `[source,${language}]${eol}` }
  const next = doc.update([change])
  const made = itemsAround(ctx, next, it.from, it.to)
  if (!made || made.length !== 1 || made[0]!.kind !== 'code')
    return failure('collateral', 'The language does not read as written', it.from, it.to)
  const nb = made[0]!.block!
  if (nb.lang !== language || codeText(next, nb) !== codeText(doc, b))
    return failure('collateral', 'The language does not read as written', it.from, it.to)
  return { doc: next, changes: [change] }
}

/** The caption of the image that holds `at` (the `.Title` line over it): set, changed, or (empty) taken away. */
export function setCaption(doc: NotaDocument, at: number, text: string): OperationResult {
  const ctx = makeCtx(doc)
  const r = blockAt(ctx, at, 'image', 'image')
  if ('error' in r) return r
  const { it, b } = r
  const t = doc.text
  const eol = b.eol || ctx.eol
  const caption = lf(text).replace(/\n+/g, ' ')
  const c = b.content!
  const has = c.from < b.markerFrom
  const current = has ? t.slice(c.from, c.to) : ''
  if (caption === current) return unchanged(doc)
  let change: Change
  if (!has) change = { from: b.markerFrom, to: b.markerFrom, insert: `.${caption}${eol}` }
  else if (caption === '') {
    const lineEnd = c.to + (t.startsWith('\r\n', c.to) ? 2 : t[c.to] === '\n' ? 1 : 0)
    change = { from: c.from - 1, to: lineEnd, insert: '' }
  } else change = diffChange(c.from, current, caption)[0]!
  const next = doc.update([change])
  const made = itemsAround(ctx, next, it.from, it.to)
  if (!made || made.length !== 1 || made[0]!.kind !== 'image')
    return failure('collateral', 'The caption does not read as written', it.from, it.to)
  const nb = made[0]!.block!
  const now = nb.content!.from < nb.markerFrom ? next.text.slice(nb.content!.from, nb.content!.to) : ''
  if (now !== caption || nb.target !== b.target)
    return failure('collateral', 'The caption does not read as written', it.from, it.to)
  return { doc: next, changes: [change] }
}

/** The source of the island that holds `at` becomes `text` (its line break at the end stays); the blocks around must read as they did. */
export function setIslandText(doc: NotaDocument, at: number, text: string, regionEnd?: number): OperationResult {
  const ctx = makeCtx(doc)
  const t = doc.text
  let from: number
  let to: number
  let end: number
  if (regionEnd === undefined) {
    const r = blockAt(ctx, at, 'chip', 'island')
    if ('error' in r) return r
    from = r.it.from
    to = r.it.to
    end = to - r.b.eol.length
  } else {
    // the lines of an island that is being edited: they may read as another block now, but they are still its lines
    if (at < 0 || regionEnd < at || regionEnd > t.length) return failure('invalid-range', 'The island is outside the text', at, at)
    from = at
    to = regionEnd
    end = t.slice(from, to).endsWith('\r\n') ? to - 2 : t.slice(from, to).endsWith('\n') ? to - 1 : to
  }
  const old = t.slice(from, end)
  const wanted = nl(lf(text), ctx.eol)
  if (old === wanted) return unchanged(doc)
  const changes = diffChange(from, old, wanted)
  const next = doc.update(changes)
  if (!itemsAround(ctx, next, from, to)) return failure('collateral', 'That text changes the blocks around it', from, to)
  return { doc: next, changes }
}

// ---------------------------------------------------------------- a block placed

/** The kinds of the items a source reads as on its own (the blank lines left out). */
function kindsOf(src: string, options: ParseOptions): Item['kind'][] {
  const doc = parse(src + '\n', { attributes: options.attributes, blockMacros: options.blockMacros })
  return layoutItems(readLayout(doc))
    .map((i) => i.kind)
    .filter((k) => k !== 'empty')
}

const TEXTUAL = new Set<Item['kind']>(['paragraph', 'empty', 'heading', 'item'])

/** The index of the last item of the block that holds the item `i`: the whole list of an item, the whole box of a fence. */
export function blockEnd(items: readonly Item[], i: number): number {
  const it = items[i]!
  if (it.kind === 'item') {
    // (blank lines do not end a list: the items that follow them are of it)
    let j = i
    for (let n = i + 1, k; (k = items[n]?.kind) === 'item' || k === 'empty'; n++) if (k === 'item') j = n
    return j
  }
  if (it.kind === 'fence' && it.block!.fence === 'open') {
    let depth = 0
    for (let j = i; j < items.length; j++) {
      const f = items[j]!
      if (f.kind !== 'fence' || (f.block!.fence !== 'open' && f.block!.fence !== 'close')) continue
      depth += f.block!.fence === 'open' ? 1 : -1
      if (depth === 0) return j
    }
  }
  return i
}

/**
 * A block written new goes in the place of the empty paragraph or the paragraph that holds `at` (`replace`), or after the block
 * that holds `at`. When it is not text and no paragraph follows, an empty one does.
 */
export function placeBlock(env: Env, at: number, block: BlockSpec, replace: boolean): OperationResult {
  const s = specSource(env, block)
  if ('error' in s) return s
  const ctx = makeCtx(env.doc)
  const i = itemHolding(ctx, at)
  if (i < 0) return noTarget(at)
  const it = ctx.items[i]!
  const eol = ctx.eol
  const bare = kindsOf(s.src, env.doc.options)
  if (bare.length === 0) return failure('invalid-block', 'The block is empty', at, at)
  const swap = it.kind === 'empty' || (replace && it.kind === 'paragraph')
  const q = swap ? i : blockEnd(ctx.items, i)
  // a list written next to a list outside the window would be read as one list with it: a comment line keeps them apart
  const near = (n: number, d: number): boolean => {
    while (ctx.items[n]?.kind === 'empty') n += d
    return ctx.items[n]?.kind === 'item'
  }
  const src = nl(
    apart(
      env,
      s.src,
      bare[0] === 'item' && near(swap ? i - 1 : q, -1),
      bare[bare.length - 1] === 'item' && near(q + 1, 1),
    ),
    eol,
  )
  const raw: Spec = { t: 'raw', text: src + eol, kinds: kindsOf(src, env.doc.options) }
  // a block does not go between the lines of the header (the author, the revision, the entries): they would be read as text
  const header = env.doc.tree.topNode.getChild('Header')
  const stop = ctx.items[q]!.to
  if (!swap && header && header.from < stop && stop < header.to)
    return failure('unstable', 'A block cannot be placed inside the header of the document', it.from, it.to)
  const next = ctx.items[q + 1]
  const last = raw.kinds[raw.kinds.length - 1]!
  const tail = !TEXTUAL.has(last) && !(next && TEXTUAL.has(next.kind))
  const r = commitWindow(ctx, i, q, (kept, first) => {
    const out = kept.flatMap((k, j): Spec[] => j + first === q ? (swap ? [raw] : [k, raw]) : [k])
    if (tail) out.push({ t: 'empty' })
    return out
  })
  return finish(r, 'the block is placed', it.from, stop)
}

/** An empty paragraph follows the block that holds `at`, unless there is one already. */
export function appendEmpty(doc: NotaDocument, at: number): OperationResult {
  const ctx = makeCtx(doc)
  const i = itemHolding(ctx, at)
  if (i < 0) return noTarget(at)
  const q = blockEnd(ctx.items, i)
  const it = ctx.items[q]!
  if (it.kind === 'empty' || ctx.items[q + 1]?.kind === 'empty') return unchanged(doc)
  const r = commitWindow(ctx, i, q, (kept) => [...kept, { t: 'empty' } as Spec])
  return finish(r, 'an empty paragraph follows', it.from, it.to)
}
