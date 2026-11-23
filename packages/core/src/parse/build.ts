import { type NodeProp, Tree } from '@lezer/common'
import { Type, nodeSet, sectionLevel, textPieces } from '../nodes.js'

/** Intermediate node with absolute offsets; converted to a Lezer tree per piece. */
export interface N {
  type: number
  from: number
  to: number
  children?: N[]
  /** Per-node properties (`sectionLevel`, `blockKind`); such a node becomes a tree of its own. */
  props?: [NodeProp<never>, unknown][]
}

export function leaf(type: number, from: number, to: number): N {
  return { type, from, to }
}

/** A composite node; hidden ranges (directives, disabled lines) inside its gaps are taken in. */
export function node(type: number, from: number, to: number, children: N[]): N {
  if (claimer) children = claimer.take(from, to, children)
  return { type, from, to, children }
}

/** A composite node that takes nothing in. */
export function rawNode(type: number, from: number, to: number, children: N[]): N {
  return { type, from, to, children }
}

/** Sets a per-node property (the node becomes a tree of its own). */
export function withProp<T>(n: N, prop: NodeProp<T>, value: T): N {
  ;(n.props ??= []).push([prop as NodeProp<never>, value])
  return n
}

/** Children without zero-length nodes; gaps are filled with Mark leaves when converted. */
export function clean(children: (N | null | undefined)[]): N[] {
  const out: N[] = []
  for (const c of children) if (c && c.to > c.from) out.push(c)
  return out
}

/** Leaves that may be cut into two around a hidden range that lies inside them. */
const SPLITTABLE = new Set<number>([Type.DelimitedContent, Type.CommentContent, Type.CellContent])

/**
 * Hands out the hidden ranges (directive lines, lines of conditionals that are off) of a unit to the
 * composite nodes that hold them: each is taken by the innermost node whose range covers it, so nodes
 * are built inside out. Ranges nobody takes belong to the unit itself.
 */
export class Claimer {
  private readonly nodes: (N | undefined)[] = []
  /** Union-find over indices: the next range that has not been taken yet. */
  private readonly nxt: number[] = []

  constructor(
    private readonly hidden: readonly { from: number; to: number }[],
    private readonly toNode: (i: number) => N,
  ) {}

  private find(i: number): number {
    const nxt = this.nxt
    let root = i
    while (nxt[root] !== undefined) root = nxt[root]!
    while (i !== root) {
      const n = nxt[i]!
      nxt[i] = root
      i = n
    }
    return root
  }

  private firstFrom(pos: number): number {
    const h = this.hidden
    let lo = 0
    let hi = h.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (h[mid]!.from < pos) lo = mid + 1
      else hi = mid
    }
    return lo
  }

  /** Takes the ranges inside `[from, to)` that nobody has taken yet, as nodes in document order. */
  claim(from: number, to: number): N[] {
    const out: N[] = []
    const h = this.hidden
    for (let i = this.find(this.firstFrom(from)); i < h.length && h[i]!.from < to; i = this.find(i + 1)) {
      if (h[i]!.to > to) break
      this.nxt[i] = i + 1
      out.push((this.nodes[i] ??= this.toNode(i)))
    }
    return out
  }

  /** Merges the ranges inside `[from, to)` into the (sorted) children of a node. */
  take(from: number, to: number, children: N[]): N[] {
    const mine = this.claim(from, to)
    if (mine.length === 0) return children
    return mergeHidden(children, mine)
  }
}

let claimer: Claimer | null = null

/** Runs `fn` with `c` handing out hidden ranges to the nodes built meanwhile. */
export function withClaimer<T>(c: Claimer | null, fn: () => T): T {
  const saved = claimer
  claimer = c
  try {
    return fn()
  } finally {
    claimer = saved
  }
}

function mergeHidden(children: N[], hidden: N[]): N[] {
  const out: N[] = []
  let ci = 0
  let cur: N | undefined = children[0]
  const advance = () => {
    ci++
    cur = children[ci]
  }
  for (const h of hidden) {
    while (cur && cur.to <= h.from) {
      out.push(cur)
      advance()
    }
    if (cur && cur.from <= h.from && h.from < cur.to) {
      if (!cur.children && SPLITTABLE.has(cur.type)) {
        // a hidden range inside a run of lines: the run is cut in two
        if (cur.from < h.from) out.push(leaf(cur.type, cur.from, h.from))
        out.push(h)
        if (h.to < cur.to) cur = leaf(cur.type, h.to, cur.to)
        else advance()
        continue
      }
      if (cur.children && cur.from < h.from) {
        // a composite that did not take it (built without the claimer): put it inside
        insertInside(cur, h)
        continue
      }
    }
    out.push(h)
  }
  while (cur) {
    out.push(cur)
    advance()
  }
  return out
}

/**
 * Puts leaves (sorted, not overlapping the leaves of the nodes) into a list of sorted nodes: a leaf that
 * lies inside a node goes into its children, without recursion.
 */
export function mergeLeaves(kids: N[], leaves: N[]): N[] {
  if (leaves.length === 0) return kids
  const result: { out: N[] } = { out: [] }
  const pendingChildren = new Map<N, { out: N[] }>()
  const tasks: { kids: N[]; leaves: N[]; into: { out: N[] } }[] = [{ kids, leaves, into: result }]
  while (tasks.length) {
    const t = tasks.pop()!
    const out: N[] = []
    let li = 0
    for (const kid of t.kids) {
      while (li < t.leaves.length && t.leaves[li]!.to <= kid.from) out.push(t.leaves[li++]!)
      const inside: N[] = []
      while (li < t.leaves.length && t.leaves[li]!.from < kid.to) inside.push(t.leaves[li++]!)
      if (inside.length && kid.children) {
        const sub = { out: [] as N[] }
        tasks.push({ kids: kid.children, leaves: inside, into: sub })
        out.push(kid)
        // the children of the node are replaced when the tasks are done (below)
        pendingChildren.set(kid, sub)
      } else if (inside.length && SPLITTABLE.has(kid.type)) {
        // lines inside a run of lines cut it in pieces
        let pos = kid.from
        for (const l of inside) {
          if (l.from > pos) out.push(leaf(kid.type, pos, l.from))
          out.push(l)
          pos = Math.max(pos, l.to)
        }
        if (pos < kid.to) out.push(leaf(kid.type, pos, kid.to))
      } else out.push(kid)
    }
    while (li < t.leaves.length) out.push(t.leaves[li++]!)
    t.into.out = out
  }
  for (const [kid, sub] of pendingChildren) kid.children = sub.out
  return result.out
}

/** Puts a hidden node into the deepest node that covers it, in the right place among its children. */
function insertInside(root: N, h: N): void {
  let n = root
  for (;;) {
    const kids = n.children
    if (!kids) return
    let k = 0
    while (k < kids.length && kids[k]!.to <= h.from) k++
    const c = kids[k]
    if (c && c.from < h.from) {
      if (c.children) {
        n = c
        continue
      }
      if (SPLITTABLE.has(c.type)) {
        const tail = h.to < c.to ? leaf(c.type, h.to, c.to) : null
        kids.splice(k, 1, leaf(c.type, c.from, h.from), h, ...(tail ? [tail] : []))
        return
      }
    }
    kids.splice(k, 0, h)
    return
  }
}

function emit(n: N, base: number, buf: number[], reused: Tree[], built: Map<N, Tree>): void {
  const t = built.get(n)
  if (t) {
    buf.push(reused.length, n.from - base, n.to - base, -1)
    reused.push(t)
    return
  }
  const startLen = buf.length
  if (n.children && n.children.length) emitChildren(n, base, buf, reused, built)
  buf.push(n.type, n.from - base, n.to - base, buf.length + 4 - startLen)
}

function emitChildren(n: N, base: number, buf: number[], reused: Tree[], built: Map<N, Tree>): void {
  let pos = n.from
  for (const c of n.children!) {
    if (c.from > pos) buf.push(Type.Mark, pos - base, c.from - base, 4)
    emit(c, base, buf, reused, built)
    pos = c.to
  }
  if (n.to > pos) buf.push(Type.Mark, pos - base, n.to - base, 4)
}

/** A piece of a unit: a Lezer tree plus its start relative to the start of the unit. */
export interface Piece {
  readonly tree: Tree
  readonly offset: number
}

/** How many levels of nesting one buffer holds; deeper nodes are built as trees of their own. */
const CUT = 200

function makeTree(n: N, built: Map<N, Tree>): Tree {
  const buf: number[] = []
  const reused: Tree[] = []
  if (n.children && n.children.length) emitChildren(n, n.from, buf, reused, built)
  const tree = Tree.build({ buffer: buf, nodeSet, topID: n.type, length: n.to - n.from, reused })
  if (n.props && n.props.length)
    return new Tree(
      tree.type,
      tree.children,
      tree.positions,
      tree.length,
      (n.props as [NodeProp<unknown>, unknown][]).map(([p, v]) =>
        (p as unknown) === textPieces ? [p, (v as readonly number[]).map((x) => x - n.from)] : [p, v],
      ) as [NodeProp<unknown>, unknown][],
    )
  return tree
}

export function toPiece(n: N, unitFrom: number): Piece {
  // Nodes that need a tree of their own (with properties, or too deep to build in one buffer) are found
  // without recursion and built from the inside out.
  const cuts: N[] = []
  const stack: [N, number][] = [[n, 0]]
  while (stack.length) {
    const [cur, since] = stack.pop()!
    const kids = cur.children
    if (!kids) continue
    for (let i = kids.length - 1; i >= 0; i--) {
      const c = kids[i]!
      if (!c.children || c.children.length === 0) {
        // a leaf that carries a property is a tree of its own
        if (c.props) cuts.push(c)
        continue
      }
      if (c.props || since + 1 >= CUT) {
        cuts.push(c)
        stack.push([c, 0])
      } else stack.push([c, since + 1])
    }
  }
  const built = new Map<N, Tree>()
  // `cuts` lists every node before its descendants: build them the other way round
  for (let i = cuts.length - 1; i >= 0; i--) built.set(cuts[i]!, makeTree(cuts[i]!, built))
  return { tree: makeTree(n, built), offset: n.from - unitFrom }
}

export function withLevel(tree: Tree, level: number): Tree {
  return new Tree(tree.type, tree.children, tree.positions, tree.length, [[sectionLevel, level]])
}
