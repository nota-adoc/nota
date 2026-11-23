/**
 * Operations on blocks and sections at any depth: the level of a section, a new block, a block moved, replaced or
 * removed. Each is written as the smallest replacements of the text (only the target, the blank lines it has and
 * the place of a new block), read again, and checked: the document outside the target is the same as it was.
 */
import type { SyntaxNode } from '@lezer/common'
import { deepAsg } from '../asg/asg.js'
import { cellBars } from '../nodes.js'
import { type ParseOptions, type NotaDocument, parse } from '../document.js'
import { type Change, normalizeTextChanges } from '../changes.js'
import { type OperationFailure, type OperationResult, failure, isFailure } from './common.js'
import {
  type BlockKindName,
  type BlockSpec,
  blockSource,
  readFragment,
} from './blockspec.js'
import {
  type Destination,
  type Insertion,
  type Located,
  destinationOf,
  elemOf,
  eolOf,
  containerStart,
  fullStart,
  gapDestination,
  insertion,
  LISTS,
  isContainer,
  kindOf,
  elementsOf,
  locate,
  removalRange,
} from './elements.js'
import type { StyleProfile } from './profile.js'
import { type Region, canonical, flat, foundIn, holderStart, leaks, nodesIn } from './verify.js'

export interface Env {
  readonly doc: NotaDocument
  readonly text: string
  readonly eol: string
  readonly profile: StyleProfile
}

export function envOf(doc: NotaDocument, profile: StyleProfile): Env {
  return { doc, text: doc.text, eol: eolOf(doc.text), profile }
}

/** An `Env` whose style profile is worked out when it is first asked for (a keystroke in a table never asks). */
export function lazyEnvOf(doc: NotaDocument, profile: () => StyleProfile): Env {
  let made: StyleProfile | null = null
  return {
    doc,
    text: doc.text,
    eol: eolOf(doc.text),
    get profile(): StyleProfile {
      return (made ??= profile())
    },
  }
}

export const noTarget = (at: number): OperationFailure =>
  failure('invalid-target', 'There is no block here to work on', at, at)

export const nl = (s: string, eol: string): string => (eol === '\n' ? s : s.replace(/\n/g, eol))

function parseOptions(doc: NotaDocument): ParseOptions {
  return { attributes: doc.options.attributes, blockMacros: doc.options.blockMacros }
}

/** The blocks of a source as they read on their own, in the form the checks compare. */
export function blocksOfSource(doc: NotaDocument, src: string): unknown {
  return canonical(deepAsg(parse(src + '\n', parseOptions(doc))).blocks ?? [], null)
}

export interface Plan {
  /** The replacements, in coordinates of the document (not yet sorted or joined). */
  readonly changes: readonly Change[]
  /** The region of the target in the document: what is cut out of it for the comparison. */
  readonly target: Region | null
  /** What was written new: the insertion and the length of the source of the block in it. */
  readonly written?: { readonly ins: Insertion; readonly length: number; readonly expected: unknown }
  /** The code of the failure when what was written does not read as it should. */
  readonly mismatch?: string
  /** What a moved block must be after the move: the nodes of the target. */
  readonly same?: boolean
  /** The container the written block goes in: what holds its nodes after. */
  readonly container?: SyntaxNode
}

/** The place a position of the text has after changes (for a position that is not inside one). */
export function mapPosition(changes: readonly Change[], pos: number): number {
  let d = 0
  for (const c of changes) if (c.to <= pos && c.from < pos) d += c.insert.length - (c.to - c.from)
  return pos + d
}

/** Whether the nodes in a region of the document after the changes are held by the container (mapped to the new text). */
export function heldBy(after: NotaDocument, region: Region, container: SyntaxNode, changes: readonly Change[]): boolean {
  const found = foundIn(after, region)
  // (a section has the holder its level gives it: the section it is put in, or one of those that hold that one)
  const ancestors = found.length > 0 && found.every((f) => f.node.name === 'section')
  const want = new Set<number>()
  for (let c: SyntaxNode | null = container; c; c = c.parent) {
    if (!isContainer(c)) continue
    const start = containerStart(c)
    want.add(start < 0 ? -1 : mapPosition(changes, start))
    if (!ancestors) break
  }
  return found.every((f) => want.has(holderStart(f)))
}

/** Applies a plan: the changes, the document after them, and the check. */
export function commit(doc: NotaDocument, plan: Plan): OperationResult {
  let norm: Change[]
  try {
    norm = normalizeTextChanges(plan.changes, doc.text.length)
  } catch {
    return failure('invalid-target', 'The changes overlap')
  }
  if (norm.length === 0) return { doc, changes: [] }
  const after = doc.update(norm)
  let region: Region | null = null
  if (plan.written) {
    const { ins, length } = plan.written
    let delta = 0
    for (const c of plan.changes) {
      if (c === ins.change) continue
      if (c.to <= ins.change.from && c.from < ins.change.from) delta += c.insert.length - (c.to - c.from)
    }
    const start = ins.change.from + delta + ins.offset
    region = [start, start + length]
  }
  const bad = leaks(doc, after, plan.target, region, plan.target?.[0] ?? norm[0]!.from, plan.target?.[1] ?? norm[0]!.to)
  if (bad) return bad
  if (region && plan.written) {
    if (plan.container && !heldBy(after, region, plan.container, norm))
      return failure(
        'invalid-target',
        'A block of that kind cannot stand there: it would end up in another block than the one it is put in',
        region[0],
        region[1],
      )
    const got = canonical(nodesIn(after, region), null)
    const want = plan.same && plan.target ? canonical(nodesIn(doc, plan.target), null) : plan.written.expected
    if (JSON.stringify(got) !== JSON.stringify(want))
      return failure(
        plan.mismatch ?? 'collateral',
        'The block does not read in its place as it is written',
        region[0],
        region[1],
      )
  }
  return { doc: after, changes: norm }
}

// ---------------------------------------------------------------- the level of a section

function titleMarkerOf(node: SyntaxNode): SyntaxNode | null {
  if (node.name === 'Section') {
    const t = node.getChild('SectionTitle')
    if (!t || t.getChild('SetextUnderline')) return null
    return t.getChild('SectionMarker')
  }
  return node.getChild('SetextUnderline') ? null : node.getChild('SectionMarker')
}

export function setSectionLevel(env: Env, at: number, level: number): OperationResult {
  const { doc, text } = env
  if (!Number.isInteger(level) || level < 2 || level > 6)
    return failure('invalid-level', 'The level of a section is 2 to 6', at, at)
  const loc = locate(doc, at)
  if (!loc || loc.at !== 'elem') return noTarget(at)
  let node: SyntaxNode | null = loc.elem.node
  while (node && node.name !== 'Section' && node.name !== 'DiscreteHeading') node = node.parent
  if (!node) return failure('invalid-target', 'That is not a section', at, at)
  const e = elemOf(text, node)
  if (!e) return noTarget(at)
  const own = titleMarkerOf(node)
  if (!own) return failure('unsupported', 'A title with an underline has no level to change here', node.from, node.to)
  const delta = level - (own.to - own.from)
  if (delta === 0) return { doc, changes: [] }
  const changes: Change[] = []
  let outOfRange = false
  doc.tree.iterate({
    from: node.from,
    to: node.to,
    enter: (ref) => {
      if (ref.from < node!.from || ref.to > node!.to) return undefined
      if (ref.name !== 'Section' && ref.name !== 'DiscreteHeading') return undefined
      const m = titleMarkerOf(ref.node)
      if (!m) {
        outOfRange = true
        return false
      }
      const n = m.to - m.from + delta
      if (n < 2 || n > 6) outOfRange = true
      else changes.push({ from: m.from, to: m.to, insert: text[m.from]!.repeat(n) })
      return undefined
    },
  })
  if (outOfRange) return failure('invalid-level', 'A section of the tree would get a level outside 2 to 6', e.from, e.to)
  const region: Region = [e.from, e.to]
  const next = doc.update(normalizeTextChanges(changes, text.length))
  if (JSON.stringify(flat(deepAsg(doc), region, delta)) !== JSON.stringify(flat(deepAsg(next), null, 0)))
    return failure('collateral', 'That would change how other blocks read', e.from, e.to)
  return { doc: next, changes: normalizeTextChanges(changes, text.length) }
}

// ---------------------------------------------------------------- insert, replace, delete, move

/** The source of a block spec, or the failure; `fragment`: what a source of the agent is checked as. */
export function specSource(
  env: Env,
  spec: BlockSpec,
): { src: string; mismatch: string; kinds: readonly BlockKindName[] } | OperationFailure {
  if ('source' in spec) {
    const f = readFragment(spec.source, spec.expect, env.doc.options, (n) => kindOf(env.text, n))
    if ('error' in f) return f
    return { src: f.source, mismatch: 'collateral', kinds: f.kinds }
  }
  const s = blockSource(spec, env.profile)
  if (typeof s !== 'string') return s
  const kind: BlockKindName = spec.kind === 'collapsible' ? 'example' : (spec.kind as BlockKindName)
  return { src: s, mismatch: 'unwritable', kinds: [kind] }
}

const isList = (k: BlockKindName | undefined): boolean => k === 'list' || k === 'dlist'

/**
 * Two lists of one kind with only blank lines between them are one list: a comment line, which is not a block, stands
 * between them (the way AsciiDoc has it) where a list is put next to a list.
 */
export function apart(env: Env, src: string, before: unknown, after: unknown): string {
  const blank = '\n'.repeat(Math.max(1, env.profile.blankLines) + 1)
  return (before ? `//${blank}` : '') + src + (after ? `${blank}//` : '')
}

function separated(env: Env, src: string, kinds: readonly BlockKindName[], dest: Destination): string {
  return apart(
    env,
    src,
    isList(kinds[0]) && dest.prev && LISTS.has(dest.prev.name),
    isList(kinds[kinds.length - 1]) && dest.next && LISTS.has(dest.next.name),
  )
}

export function insertBlock(env: Env, at: number, where: 'before' | 'after', block: BlockSpec): OperationResult {
  if (where !== 'before' && where !== 'after') return failure('invalid-block', 'Insert before or after')
  const s = specSource(env, block)
  if ('error' in s) return s
  const loc = locate(env.doc, at)
  if (!loc) return noTarget(at)
  let dest: Destination
  if (loc.at === 'gap') dest = gapDestination(env.text, loc.container, loc.pos)
  else {
    dest = destinationOf(loc.elem, where)
    // after a section, a block that is not a section goes to the end of it (the text after the section is in it)
    if (where === 'after' && loc.elem.node.name === 'Section' && !s.kinds.every((k) => k === 'section')) {
      const inner = elementsOf(loc.elem.node)
      dest = { container: loc.elem.node, prev: inner[inner.length - 1] ?? null, next: null }
    }
  }
  // (what is written new has its bars escaped for a cell; a fragment of the agent is its own)
  const written = 'source' in block ? s.src : fitToCell(s.src, [], barOf(dest.container))
  const text = nl(separated(env, written, s.kinds, dest), env.eol)
  const ins = insertion(env.text, dest, text, env.profile.blankLines)
  if (!ins) return failure('invalid-target', 'A block cannot go there', at, at)
  return commit(env.doc, {
    changes: [ins.change],
    target: null,
    written: { ins, length: text.length, expected: blocksOfSource(env.doc, s.src) },
    mismatch: s.mismatch,
    container: dest.container,
  })
}

export function deleteBlock(env: Env, at: number): OperationResult {
  const loc = locate(env.doc, at, true)
  if (!loc || loc.at !== 'elem') return noTarget(at)
  let e = loc.elem
  // the only item of a list: the list goes with it
  if (e.node.name === 'ListItem' && e.siblings.length === 1) {
    const list = e.node.parent && elemOf(env.text, e.node.parent)
    if (!list) return noTarget(at)
    e = list
  }
  const [from, to] = removalRange(env.text, e)
  return commit(env.doc, { changes: [{ from, to, insert: '' }], target: [e.from, e.to] })
}

export function replaceBlock(env: Env, at: number, source: string, expect?: BlockKindName): OperationResult {
  const loc = locate(env.doc, at)
  if (!loc || loc.at !== 'elem') return noTarget(at)
  const e = loc.elem
  const s = specSource(env, { source, expect })
  if ('error' in s) return s
  const ends = env.text[e.to - 1] === '\n'
  const src = nl(s.src, env.eol)
  const insert = src + (ends ? env.eol : '')
  if (env.text.slice(e.from, e.to) === insert) return { doc: env.doc, changes: [] }
  const change: Change = { from: e.from, to: e.to, insert }
  return commit(env.doc, {
    changes: [change],
    target: [e.from, e.to],
    written: { ins: { change, offset: 0 }, length: src.length, expected: blocksOfSource(env.doc, s.src) },
    mismatch: 'collateral',
    container: e.container,
  })
}

/** The characters that separate the cells of the tables whose cell holds a container (none for a container that is not in a cell). */
function barOf(container: SyntaxNode): readonly string[] {
  return cellBars(container)
}

/**
 * The source of a block written for another cell: the bars that would end the cell are written `\\|`, and the ones the
 * old place escaped and the new one does not need are written plain again.
 */
function fitToCell(src: string, from: readonly string[], to: readonly string[]): string {
  let out = src
  for (const b of from) if (!to.includes(b)) out = out.split('\\' + b).join(b)
  for (const b of to) if (!from.includes(b)) out = out.replace(new RegExp(`(?<!\\\\)${b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g'), '\\' + b)
  return out
}

const sameNode = (a: SyntaxNode | null, b: SyntaxNode): boolean => !!a && a.from === b.from && a.name === b.name

export function moveBlock(env: Env, at: number, to: number): OperationResult {
  const { doc, text } = env
  const loc = locate(doc, at)
  if (!loc || loc.at !== 'elem') return noTarget(at)
  const e = loc.elem
  const start = fullStart(e)
  if (to >= start && to <= e.to) return failure('invalid-target', 'A block cannot be moved into itself', to, to)
  const where: Located | null = locate(doc, to)
  if (!where) return noTarget(to)
  let dest: Destination
  if (where.at === 'gap') dest = gapDestination(text, where.container, where.pos)
  else {
    const d = where.elem
    const firstLineEnd = text.indexOf('\n', d.from)
    // (the line break that ends the first line is already "after": that is how the end of a block of one line is told)
    const before = to < (firstLineEnd < 0 ? text.length : firstLineEnd)
    dest = destinationOf(d, before ? 'before' : 'after')
  }
  if (sameNode(dest.prev, e.node) || sameNode(dest.next, e.node)) return { doc, changes: [] }
  const own = fitToCell(text.slice(e.from, e.to).replace(/\r?\n$/, ''), barOf(e.container), barOf(dest.container))
  const kind = kindOf(text, e.node)
  const src = separated(env, own, kind ? [kind] : [], dest)
  const ins = insertion(text, dest, src, env.profile.blankLines)
  if (!ins) return failure('invalid-target', 'A block cannot go there', to, to)
  const [from, end] = removalRange(text, e)
  // the place is among the blank lines right before the block (the end of the container that holds the block's
  // predecessor, say): the block is where it would go, nothing to move
  if (ins.change.from > from && ins.change.from <= e.from) return { doc, changes: [] }
  if (ins.change.from > from && ins.change.from < end) return failure('invalid-target', 'A block cannot be moved into itself', to, to)
  const del: Change = { from, to: end, insert: '' }
  return commit(doc, {
    changes: [del, ins.change],
    target: [e.from, e.to],
    written: { ins, length: src.length, expected: null },
    mismatch: 'collateral',
    same: true,
    container: dest.container,
  })
}

export { isFailure }
