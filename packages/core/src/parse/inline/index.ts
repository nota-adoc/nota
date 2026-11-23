/** Inline markup: the substitutions of Asciidoctor over a text, as a syntax tree and as HTML. */
import { Type, textPieces } from '../../nodes.js'
import { type N, mergeLeaves, node, withProp } from '../build.js'
import type { INode, InlineEnv, InlineSink } from './ctx.js'
import { Substitutor } from './engine.js'
import type { Sub } from './subs.js'
import { Work } from './work.js'

export type { Footnote, InlineEnv, InlineSink, INode, Part } from './ctx.js'
export { Substitutor } from './engine.js'
export { parseAttrs } from './macros.js'
export { leadingAnchor, scanAnchors } from './anchors.js'
export type { Attrs as AttributeMap } from './macros.js'
export {
  BASIC_SUBS,
  HEADER_SUBS,
  NORMAL_SUBS,
  NO_SUBS,
  REFTEXT_SUBS,
  VERBATIM_SUBS,
  blockSubs,
  resolveSubs,
} from './subs.js'
export type { Sub } from './subs.js'
export { Work } from './work.js'

/** A line of text as a range of the source (without the trailing white space and the line terminator). */
export type Piece = readonly [number, number]

/** Runs the substitutions on the pieces of the source and returns the HTML. */
export function substitute(
  text: string,
  pieces: readonly Piece[] | null,
  subs: readonly Sub[],
  env: InlineEnv,
): string {
  const w = Work.of(text, pieces, false)
  if (subs.length === 0) return w.s
  return new Substitutor(env, null).apply(w, subs).s
}

/** The constructs the substitutions find in the pieces of the source, and the diagnostics they give. */
export function scanInline(
  text: string,
  pieces: readonly Piece[],
  subs: readonly Sub[],
  env: InlineEnv,
): InlineSink {
  const sink: InlineSink = { nodes: [], diags: [] }
  if (subs.length === 0 || pieces.length === 0) return sink
  const w = Work.of(text, pieces, true)
  new Substitutor(env, sink).apply(w, subs)
  return sink
}

interface Item {
  t: number
  f: number
  e: number
  group: number
  root: boolean
  ord: number
}

/**
 * The nodes the substitutions found as a forest, parents before children. A node that crosses another one
 * (the passes work on the text one after the other, so two of them can overlap) is dropped, with its parts.
 */
export function nestNodes(all: readonly INode[]): N[] {
  if (all.length === 0) return []
  const nodes = dropConsumedSpecialChars(all)
  const items: Item[] = []
  let ord = 0
  nodes.forEach((n, g) => {
    items.push({ t: n.t, f: n.f, e: n.e, group: g, root: true, ord: ord++ })
    for (const k of n.kids) items.push({ t: k.t, f: k.f, e: k.e, group: g, root: false, ord: ord++ })
  })
  // equal ranges: what a later pass made wraps what an earlier one made
  const byPos = (a: Item, b: Item) => a.f - b.f || b.e - a.e || b.group - a.group || a.ord - b.ord
  // first the constructs themselves: the ones that cross an earlier one are dropped
  const dropped = new Set<number>()
  const roots = items.filter((i) => i.root).sort(byPos)
  const stack: Item[] = []
  for (const r of roots) {
    while (stack.length && stack[stack.length - 1]!.e <= r.f) stack.pop()
    const top = stack[stack.length - 1]
    if (top && r.e > top.e) dropped.add(r.group)
    else stack.push(r)
  }
  const keep = items.filter((i) => !dropped.has(i.group)).sort(byPos)
  interface Frame {
    item: Item
    kids: N[]
  }
  const out: N[] = []
  const frames: Frame[] = []
  const close = () => {
    const fr = frames.pop()!
    const n = node(fr.item.t, fr.item.f, fr.item.e, fr.kids)
    ;(frames.length ? frames[frames.length - 1]!.kids : out).push(n)
  }
  for (const it of keep) {
    while (frames.length && frames[frames.length - 1]!.item.e <= it.f) close()
    const top = frames[frames.length - 1]
    if (top && it.e > top.item.e) continue // a part that crosses something (only after a strange overlap)
    frames.push({ item: it, kids: [] })
  }
  while (frames.length) close()
  return out
}

/**
 * A special character is a node of its own, except where a construct is written with it: the `<` and `>` of
 * a callout, of a replacement (`->`, `<=`), of a `<<xref>>` and of a `<link>` are parts of that construct.
 */
function dropConsumedSpecialChars(nodes: readonly INode[]): readonly INode[] {
  const dead: [number, number][] = []
  let specials = 0
  for (const n of nodes) {
    if (n.t === Type.SpecialChar) specials++
    else if (n.t === Type.Callout || n.t === Type.Replacement) dead.push([n.f, n.e])
    else if (n.t === Type.Xref || n.t === Type.Link) {
      // what lies between the parts of a cross reference or a link is its punctuation (`<<`, `>>`, `<url>`)
      let at = n.f
      for (const k of [...n.kids].sort((x, y) => x.f - y.f)) {
        if (k.f > at) dead.push([at, k.f])
        at = Math.max(at, k.e)
      }
      if (n.e > at) dead.push([at, n.e])
    }
  }
  if (specials === 0 || dead.length === 0) return nodes
  dead.sort((x, y) => x[0] - y[0])
  // the furthest end among the ranges that start at or before a place tells whether a range covers it
  const reach: number[] = []
  let far = 0
  for (const d of dead) reach.push((far = Math.max(far, d[1])))
  const inDead = (f: number): boolean => {
    let lo = 0
    let hi = dead.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (dead[mid]![0] <= f) lo = mid + 1
      else hi = mid
    }
    return lo > 0 && reach[lo - 1]! > f
  }
  return nodes.filter((n) => n.t !== Type.SpecialChar || !inDead(n.f))
}

/** A line of a container's text: the node that covers it and where its text is. */
export interface TextLineRef {
  /** The `TextLine` leaf. */
  readonly n: N
  readonly piece: Piece
}

/**
 * Puts the nodes of the inline constructs into the `TextLine`s of a container. A line that holds constructs
 * becomes a node over them; lines that a construct spans (with what lies between them: comments, quote
 * markers) become one `TextLine` that has the pieces of its lines in the `textPieces` property.
 */
export function spliceInline(children: N[], lines: readonly TextLineRef[], forest: N[]): N[] {
  if (forest.length === 0) return children
  const groups: { first: number; last: number; roots: N[] }[] = []
  let li = 0
  for (const root of forest) {
    while (li < lines.length && lines[li]!.n.to <= root.from) li++
    if (li >= lines.length) break
    let last = li
    while (last + 1 < lines.length && lines[last + 1]!.n.from < root.to) last++
    const g = groups[groups.length - 1]
    if (g && g.last >= li) {
      g.last = Math.max(g.last, last)
      g.roots.push(root)
    } else groups.push({ first: li, last, roots: [root] })
  }
  const replace = new Map<N, N>()
  const absorbed = new Set<N>()
  for (const g of groups) {
    const a = lines[g.first]!.n
    const b = lines[g.last]!.n
    let kids = [...g.roots]
    const between: N[] = []
    if (g.last > g.first) {
      // what lies between the first and the last line belongs to the merged line
      for (const c of children) {
        if (c.from < a.to || c.to > b.from) continue
        absorbed.add(c)
        // the lines themselves are the text; comments and the like between them stay in the line
        if (c.type !== Type.TextLine) between.push(c)
      }
      for (let k = g.first + 1; k <= g.last; k++) absorbed.add(lines[k]!.n)
    }
    // a comment inside a construct belongs to it
    kids = mergeLeaves(
      kids.sort((x, y) => x.from - y.from),
      between,
    )
    const t = node(Type.TextLine, a.from, b.to, kids)
    if (g.last > g.first) {
      const flat: number[] = []
      for (let k = g.first; k <= g.last; k++) flat.push(lines[k]!.piece[0], lines[k]!.piece[1])
      withProp(t, textPieces, flat)
    }
    replace.set(a, t)
  }
  const out: N[] = []
  for (const c of children) {
    if (absorbed.has(c)) continue
    out.push(replace.get(c) ?? c)
  }
  return out
}

export { textPieces }
