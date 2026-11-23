/**
 * The check "no collateral damage" for the operations on blocks, at any depth: the ASG of the document before and
 * after, with the target cut out of the one and what was written in its place cut out of the other, must be the same.
 */
import type { NotaDocument } from '../document.js'
import { type AsgNode, deepAsg } from '../asg/asg.js'
import { type OperationFailure, failure } from './common.js'

export type Region = readonly [number, number]

export const inside = (v: unknown, r: Region | null): boolean => {
  if (!r || !v || typeof v !== 'object') return false
  const range = (v as AsgNode).range
  return Array.isArray(range) && range[0] >= r[0] && range[1] <= r[1]
}

/** A node that lies inside a region, and the node that holds it (the nearest one that has a place). */
export interface Found {
  readonly node: AsgNode
  readonly parent: AsgNode | null
}

/** The ASG without the places of the nodes, and without the nodes (in lists of nodes) that lie inside the region. */
export function canonical(v: unknown, region: Region | null, found?: Found[], owner: AsgNode | null = null): unknown {
  if (Array.isArray(v)) {
    const out: unknown[] = []
    for (const x of v) {
      if (inside(x, region)) found?.push({ node: x as AsgNode, parent: owner })
      else out.push(canonical(x, region, found, owner))
    }
    return out
  }
  if (v && typeof v === 'object') {
    const here = Array.isArray((v as AsgNode).range) ? (v as AsgNode) : owner
    const o: Record<string, unknown> = {}
    for (const [k, x] of Object.entries(v)) {
      if (k === 'location' || k === 'range') continue
      const c = canonical(x, region, found, here)
      // (a list that has lost all its nodes is as if it had none)
      if (Array.isArray(c) && c.length === 0) continue
      o[k] = c
    }
    return o
  }
  return v
}

/** The nodes of the ASG (in lists of nodes) that lie inside the region, at the top of it, with what holds them. */
export function foundIn(doc: NotaDocument, region: Region): Found[] {
  const found: Found[] = []
  canonical(deepAsg(doc), region, found)
  return found
}

/** The nodes of the ASG (in lists of nodes) that lie inside the region, at the top of it. */
export function nodesIn(doc: NotaDocument, region: Region): AsgNode[] {
  return foundIn(doc, region).map((f) => f.node)
}

/** Where the node that holds a node starts: -1 for the document. */
export const holderStart = (f: Found): number => (f.parent && f.parent.name !== 'document' ? f.parent.range[0] : -1)

/** Whether the documents are the same outside the regions (the target before, what took its place after). */
export function sameOutside(before: NotaDocument, after: NotaDocument, from: Region | null, to: Region | null): boolean {
  return JSON.stringify(canonical(deepAsg(before), from)) === JSON.stringify(canonical(deepAsg(after), to))
}

/**
 * The ASG with the sections laid flat (a section is its heading and then its blocks, next to it), places left out, and the
 * levels of the headings inside the region moved by `delta`: what a change of level leaves as it is.
 */
export function flat(v: unknown, region: Region | null, delta: number): unknown {
  if (Array.isArray(v)) {
    const out: unknown[] = []
    for (const x of v) {
      const n = x as (AsgNode & { blocks?: unknown[] }) | null
      if (n && typeof n === 'object' && n.name === 'section') {
        const { blocks, ...rest } = n
        out.push(flat(head(rest as AsgNode, region, delta), null, 0))
        out.push(...(flat(blocks ?? [], region, delta) as unknown[]))
      } else out.push(n && typeof n === 'object' && n.name === 'heading' ? flat(head(n, region, delta), null, 0) : flat(x, region, delta))
    }
    return out
  }
  if (v && typeof v === 'object') {
    const o: Record<string, unknown> = {}
    for (const [k, x] of Object.entries(v)) if (k !== 'location' && k !== 'range') o[k] = flat(x, region, delta)
    return o
  }
  return v
}

function head(n: AsgNode, region: Region | null, delta: number): AsgNode {
  return inside(n, region) ? ({ ...n, level: ((n as { level?: number }).level ?? 0) + delta } as AsgNode) : n
}

/** The failure `collateral` when the documents differ outside the regions (see {@link sameOutside}), else null. */
export function leaks(
  before: NotaDocument,
  after: NotaDocument,
  from: Region | null,
  to: Region | null,
  at: number,
  end: number,
): OperationFailure | null {
  return sameOutside(before, after, from, to)
    ? null
    : failure('collateral', 'That would change how other blocks read', at, end)
}
