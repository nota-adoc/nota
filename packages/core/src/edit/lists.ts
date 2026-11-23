/**
 * Operations on lists: a paragraph into a list and back, one kind of list into another, an item one level in or out.
 * Only the markers (and the checkboxes) of the items change, or the paragraph is written over as the items, and the
 * result is read again and compared with what it should be.
 */
import type { SyntaxNode } from '@lezer/common'
import type { AsgNode } from '../asg/asg.js'
import { type Change, mapOffset, normalizeTextChanges } from '../changes.js'
import { type OperationResult, failure } from './common.js'
import { type Elem, LISTS, elemOf, locate, trimEnd } from './elements.js'
import { type Env, envOf, heldBy, noTarget } from './structure.js'
import { type Region, canonical, inside, leaks, nodesIn } from './verify.js'

/** A kind of list: bullets, numbers, or a checklist (items with `[ ]` and `[x]`). */
export type ListKind = 'unordered' | 'ordered' | 'checklist'

/** The marker of a list inside an item with marker `parent`. */
export function childMarker(parent: string, child: 'UnorderedList' | 'OrderedList'): string {
  if (child === 'UnorderedList') return /^\*+$/.test(parent) ? parent + '*' : '*'
  return /^\.+$/.test(parent) ? parent + '.' : /^\d+\.$/.test(parent) ? '..' : '.'
}

const markerText = (env: Env, item: SyntaxNode): string => {
  const m = item.getChild('ListMarker')
  return m ? env.text.slice(m.from, m.to) : ''
}

/** The item of a list that holds the position, at any depth. */
function itemAt(env: Env, at: number): Elem | null {
  const loc = locate(env.doc, at, true)
  if (!loc || loc.at !== 'elem') return null
  for (let n: SyntaxNode | null = loc.elem.node; n; n = n.parent)
    if (n.name === 'ListItem') {
      const e = elemOf(env.text, n)
      if (e) return e
    }
  return null
}

/** The outermost list that holds a node. */
function outermostList(env: Env, node: SyntaxNode): Elem | null {
  let top: SyntaxNode | null = null
  for (let n: SyntaxNode | null = node; n; n = n.parent) if (n.name === 'UnorderedList' || n.name === 'OrderedList') top = n
  return top ? elemOf(env.text, top) : null
}

/** The items of a list with what they hold, in the order of the text: what a change of depth leaves as it is. */
function shape(list: AsgNode, region: Region | null, delta: number, depth = 0): unknown[] {
  const out: unknown[] = []
  for (const item of (list['items'] as AsgNode[] | undefined) ?? []) {
    out.push({ d: depth + (inside(item, region) ? delta : 0), p: canonical(item['principal'], null) })
    for (const b of (item['blocks'] as AsgNode[] | undefined) ?? []) {
      if (b.name === 'list') out.push(...shape(b, region, delta, depth + 1))
      else out.push({ b: canonical(b, null) })
    }
  }
  return out
}

/** Sets the marker of an item and of the items of the lists in it, one level deeper for each level down. */
function retag(env: Env, item: SyntaxNode, marker: string, out: Change[]): void {
  const m = item.getChild('ListMarker')
  if (m && env.text.slice(m.from, m.to) !== marker) out.push({ from: m.from, to: m.to, insert: marker })
  for (let k = item.firstChild; k; k = k.nextSibling) {
    if (k.name !== 'UnorderedList' && k.name !== 'OrderedList') continue
    // (a list of the other kind inside the item is told from the lists above by its marker alone: it keeps the one it has, so
    // that a step in and a step out give the text back)
    if (k.name !== item.parent?.name) continue
    const next = childMarker(marker, k.name)
    for (const c of k.getChildren('ListItem')) retag(env, c, next, out)
  }
}

function listOf(item: SyntaxNode): SyntaxNode | null {
  return item.parent && LISTS.has(item.parent.name) ? item.parent : null
}

function regionOf(e: Elem): Region {
  return [e.from, e.to]
}

function shifted(region: Region, changes: readonly Change[]): Region {
  let d = 0
  for (const c of changes) d += c.insert.length - (c.to - c.from)
  return [region[0], region[1] + d]
}

/**
 * Applies the changes of an operation on a list and checks them: nothing outside `from` changed in meaning, the nodes in
 * their new place are held by the container, and `ok` (given the nodes before and after) accepts them, else `mismatch`.
 */
function checked(
  env: Env,
  norm: readonly Change[],
  at: Elem,
  from: Region,
  to: Region,
  container: SyntaxNode,
  mismatch: string,
  ok: (was: AsgNode[], now: AsgNode[]) => boolean,
): OperationResult {
  const after = env.doc.update(norm)
  const bad = leaks(env.doc, after, from, to, at.from, at.to)
  if (bad) return bad
  if (!heldBy(after, to, container, norm) || !ok(nodesIn(env.doc, from), nodesIn(after, to)))
    return failure('collateral', mismatch, at.from, at.to)
  return { doc: after, changes: norm }
}

/** A list (or an item) whose items changed in depth: the outermost list, before and after. */
function depthChange(env: Env, top: Elem, target: Elem, changes: Change[], delta: number): OperationResult {
  const norm = normalizeTextChanges(changes, env.text.length)
  if (norm.length === 0) return { doc: env.doc, changes: [] }
  const from = regionOf(top)
  return checked(
    env,
    norm,
    top,
    from,
    shifted(from, norm),
    top.container,
    'The items do not read as they should in their new place',
    (was, now) =>
      was.length === 1 &&
      now.length === 1 &&
      was[0]!.name === 'list' &&
      now[0]!.name === 'list' &&
      JSON.stringify(shape(was[0]!, regionOf(target), delta)) === JSON.stringify(shape(now[0]!, null, 0)),
  )
}

function indentStep(env: Env, at: number): OperationResult {
  const item = itemAt(env, at)
  if (!item) return noTarget(at)
  const list = listOf(item.node)!
  if (list.name !== 'UnorderedList' && list.name !== 'OrderedList')
    return failure('unsupported', 'Only the items of bulleted and numbered lists move', item.from, item.to)
  const prev = item.siblings[item.index - 1]
  if (!prev) return failure('first-item', 'The first item of a list has no item to go under', item.from, item.to)
  const top = outermostList(env, item.node)
  if (!top) return noTarget(at)
  // joins the list that is already in the item before, or starts one
  let root: string | null = null
  let lastList: SyntaxNode | null = null
  for (let k = prev.firstChild; k; k = k.nextSibling) if (k.name === 'UnorderedList' || k.name === 'OrderedList') lastList = k
  if (lastList && lastList.name === list.name && lastList.to <= item.from) {
    const first = lastList.getChild('ListItem')
    if (first) root = markerText(env, first)
  }
  root ??= childMarker(markerText(env, prev), list.name)
  const changes: Change[] = []
  retag(env, item.node, root, changes)
  return depthChange(env, top, item, changes, 1)
}

function outdentStep(env: Env, at: number): OperationResult {
  const item = itemAt(env, at)
  if (!item) return noTarget(at)
  const list = listOf(item.node)!
  if (list.name !== 'UnorderedList' && list.name !== 'OrderedList')
    return failure('unsupported', 'Only the items of bulleted and numbered lists move', item.from, item.to)
  const parent = list.parent
  if (!parent || parent.name !== 'ListItem')
    return failure('top-level-item', 'An item of the first level cannot move out', item.from, item.to)
  const outer = listOf(parent)
  // (a list of another kind, or one with attributes or a title of its own, which would stay behind with nothing to hold them)
  if (!outer || outer.name !== list.name || list.firstChild?.name !== 'ListItem')
    return failure('unsupported', 'That would change how other blocks read', item.from, item.to)
  const top = outermostList(env, item.node)
  if (!top) return noTarget(at)
  const root = markerText(env, parent)
  const changes: Change[] = []
  // the item and what it holds
  retag(env, item.node, root, changes)
  // the items after it, which are its own now: they join its list, if it has one, else keep their marker
  const later = item.siblings.slice(item.index + 1)
  if (later.length > 0) {
    let own: SyntaxNode | null = null
    for (let k = item.node.firstChild; k; k = k.nextSibling)
      if (k.name === list.name) own = k
    const first = own?.getChild('ListItem')
    if (first) {
      // where the item's list will stand once the item is out
      const marker = childMarker(root, list.name as 'UnorderedList' | 'OrderedList')
      for (const s of later) retag(env, s, marker, changes)
    }
  }
  return depthChange(env, top, item, dedupe(changes), -1)
}

/**
 * A step in is taken only when the step out gives the text as it was, byte for byte: a list whose markers skip levels or
 * repeat in a way the step does not keep is not moved (the markers of the items after it would change, too).
 */
function reversible(
  env: Env,
  r: OperationResult,
  at: number,
  back: (env: Env, at: number) => OperationResult,
): OperationResult {
  if ('error' in r || r.changes.length === 0) return r
  const undone = back(envOf(r.doc, env.profile), mapOffset(r.changes, at, 1))
  if ('error' in undone || undone.doc.text !== env.text)
    return failure('unsupported', 'This item cannot be moved without changing the markers of the others', at, at)
  return r
}

export function indentListItem(env: Env, at: number): OperationResult {
  return reversible(env, indentStep(env, at), at, outdentStep)
}

/** (A step out takes the items after it with it, which a step in does not give back: it is not checked this way.) */
export function outdentListItem(env: Env, at: number): OperationResult {
  return outdentStep(env, at)
}

function dedupe(changes: Change[]): Change[] {
  const seen = new Set<number>()
  return changes.filter((c) => (seen.has(c.from) ? false : (seen.add(c.from), true)))
}

// ---------------------------------------------------------------- lists and paragraphs

function kindOfList(list: SyntaxNode): ListKind | null {
  if (list.name === 'OrderedList') return 'ordered'
  if (list.name !== 'UnorderedList') return null
  return list.getChild('ListItem')?.getChild('Checkbox') ? 'checklist' : 'unordered'
}

/** The marker of an item of the list at `depth` (1 for a list that is not in another). */
function markerFor(env: Env, kind: ListKind, depth: number, n: number): string {
  if (kind === 'ordered') {
    if (depth === 1 && env.profile.orderedMarker === '1.') return `${n}.`
    return '.'.repeat(depth)
  }
  const m = env.profile.unorderedMarker
  return m === '-' ? (depth === 1 ? '-' : '*'.repeat(depth - 1)) : '*'.repeat(depth)
}

/** Changes that make the list and the lists in it `kind`; `depth` counts the lists the list is in. */
function convert(env: Env, list: SyntaxNode, kind: ListKind, depth: number, out: Change[]): boolean {
  let n = 0
  for (const item of list.getChildren('ListItem')) {
    n++
    const m = item.getChild('ListMarker')
    const text = item.getChild('ItemText')
    if (!m) return false
    const marker = markerFor(env, kind, depth, n)
    if (env.text.slice(m.from, m.to) !== marker) out.push({ from: m.from, to: m.to, insert: marker })
    const box = item.getChild('Checkbox')
    if (kind === 'checklist' && !box && text) out.push({ from: text.from, to: text.from, insert: '[ ] ' })
    if (kind !== 'checklist' && box && text) out.push({ from: box.from, to: text.from, insert: '' })
    for (let k = item.firstChild; k; k = k.nextSibling) {
      if (k.name === 'UnorderedList' || k.name === 'OrderedList') {
        if (!convert(env, k, kind, depth + 1, out)) return false
      } else if (k.name === 'DescriptionList' || k.name === 'CalloutList') return false
    }
  }
  return true
}

/** Paragraphs from `at` to `to` become the items of one list (no blank lines between them). */
function paragraphsToList(env: Env, at: number, to: number, list: ListKind): OperationResult {
  const { doc, text, eol } = env
  const a = locate(doc, at)
  const b = locate(doc, to)
  if (!a || !b || a.at !== 'elem' || b.at !== 'elem') return noTarget(at)
  const x = a.elem
  const y = b.elem
  if (x.container.from !== y.container.from || x.container.name !== y.container.name || y.index < x.index)
    return failure('invalid-target', 'The paragraphs are not in one place', x.from, y.to)
  if (x.container.name === 'ListItem')
    return failure('invalid-target', 'A paragraph held by an item cannot become a list', x.from, x.to)
  const els = x.siblings.slice(x.index, y.index + 1)
  const bodies: string[] = []
  for (const n of els) {
    if (n.name !== 'Paragraph')
      return failure('invalid-target', 'Only paragraphs become the items of a list', x.from, y.to)
    for (let k = n.firstChild; k; k = k.nextSibling)
      if (k.name !== 'TextLine') return failure('unsupported', 'A paragraph with lines above it does not become an item', n.from, n.to)
    const first = n.getChild('TextLine')!
    bodies.push(text.slice(first.from, trimEnd(text, n.from, n.to)).replace(/\r?\n$/, ''))
  }
  const depth = listDepth(x.node)
  const src = bodies
    .map((body) => `${markerFor(env, list, depth + 1, 1)} ${list === 'checklist' ? '[ ] ' : ''}${body}`)
    .join(eol)
  const end = y.to
  const ends = text[end - 1] === '\n'
  const firstLine = x.node.getChild('TextLine')!
  const change: Change = { from: firstLine.from, to: end, insert: src + (ends ? eol : '') }
  const norm = normalizeTextChanges([change], text.length)
  const from: Region = [x.from, end]
  return checked(env, norm, x, from, shifted(from, norm), x.container, 'The paragraphs do not read as items', (was, now) => {
    const items = now[0]?.['items'] as AsgNode[] | undefined
    return (
      was.length === els.length &&
      now.length === 1 &&
      now[0]!.name === 'list' &&
      items?.length === els.length &&
      items.every(
        (it, i) =>
          JSON.stringify(canonical(it['principal'], null)) === JSON.stringify(canonical(was[i]!['inlines'], null)),
      )
    )
  })
}

export function toggleList(env: Env, at: number, list: ListKind | null, to?: number): OperationResult {
  const { doc, text, eol } = env
  if (to !== undefined && to !== at && list !== null) {
    const second = locate(doc, to)
    const first = locate(doc, at)
    if (first && second && first.at === 'elem' && second.at === 'elem' && first.elem.from !== second.elem.from)
      return paragraphsToList(env, at, to, list)
  }
  if (list !== null && list !== 'unordered' && list !== 'ordered' && list !== 'checklist')
    return failure('invalid-block', 'A list is unordered, ordered or a checklist', at, at)
  const loc = locate(doc, at)
  if (!loc || loc.at !== 'elem') return noTarget(at)
  const e = loc.elem
  if (e.node.name === 'Paragraph') {
    if (list === null) return { doc, changes: [] }
    const first = e.node.getChild('TextLine')
    if (!first) return noTarget(at)
    const body = text.slice(first.from, e.to).replace(/\r?\n$/, '')
    const depth = listDepth(e.node)
    if (e.container.name === 'ListItem')
      return failure('invalid-target', 'A paragraph held by an item cannot become a list', e.from, e.to)
    const src = `${markerFor(env, list, depth + 1, 1)} ${list === 'checklist' ? '[ ] ' : ''}${body}`
    const ends = text[e.to - 1] === '\n'
    const change: Change = { from: first.from, to: e.to, insert: src + (ends ? eol : '') }
    const norm = normalizeTextChanges([change], text.length)
    const from = regionOf(e)
    return checked(
      env,
      norm,
      e,
      from,
      shifted(from, norm),
      e.container,
      'The paragraph does not read as an item',
      (was, now) => {
        const items = now[0]?.['items'] as AsgNode[] | undefined
        return (
          was.length === 1 &&
          now.length === 1 &&
          now[0]!.name === 'list' &&
          items?.length === 1 &&
          JSON.stringify(canonical(items[0]!['principal'], null)) ===
            JSON.stringify(canonical(was[0]!['inlines'], null))
        )
      },
    )
  }
  if (e.node.name !== 'UnorderedList' && e.node.name !== 'OrderedList')
    return failure('invalid-target', 'That is neither a paragraph nor a list', e.from, e.to)
  const current = kindOfList(e.node)!
  if (list === current) return { doc, changes: [] }
  if (list === null) return listToParagraphs(env, e)
  const changes: Change[] = []
  if (!convert(env, e.node, list, listDepth(e.node) + 1, changes))
    return failure('unsupported', 'The list holds what cannot be converted', e.from, e.to)
  const top = e
  const norm = normalizeTextChanges(changes, text.length)
  if (norm.length === 0) return { doc, changes: [] }
  const from = regionOf(top)
  return checked(
    env,
    norm,
    e,
    from,
    shifted(from, norm),
    e.container,
    'The list does not read as it should',
    (was, now) =>
      was.length === 1 &&
      now.length === 1 &&
      JSON.stringify(skeleton(was[0]!)) === JSON.stringify(skeleton(now[0]!)),
  )
}

/** The ASG of a list without its markers and kinds: what a change of kind leaves as it is. */
function skeleton(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(skeleton)
  if (v && typeof v === 'object') {
    const o: Record<string, unknown> = {}
    for (const [k, x] of Object.entries(v)) if (k !== 'location' && k !== 'range' && k !== 'marker' && k !== 'variant') o[k] = skeleton(x)
    return o
  }
  return v
}

function listDepth(node: SyntaxNode): number {
  let d = 0
  for (let n = node.parent; n; n = n.parent) if (n.name === 'UnorderedList' || n.name === 'OrderedList') d++
  return d
}

function listToParagraphs(env: Env, e: Elem): OperationResult {
  const { text, eol } = env
  if (e.container.name === 'ListItem')
    return failure('invalid-target', 'A list inside an item cannot become paragraphs', e.from, e.to)
  const items = e.node.getChildren('ListItem')
  const parts: string[] = []
  for (const item of items) {
    for (let k = item.firstChild; k; k = k.nextSibling)
      if (k.name !== 'ListMarker' && k.name !== 'Mark' && k.name !== 'Checkbox' && k.name !== 'ItemText')
        return failure('unsupported', 'An item that holds more than its text cannot become a paragraph', e.from, e.to)
    const t = item.getChild('ItemText')
    if (!t) return failure('unsupported', 'An empty item cannot become a paragraph', e.from, e.to)
    parts.push(text.slice(t.from, trimEnd(text, t.from, t.to)).replace(/\r?\n$/, ''))
  }
  const first = items[0]
  if (!first) return noTarget(e.from)
  const blank = eol.repeat(Math.max(1, env.profile.blankLines))
  const ends = text[e.to - 1] === '\n'
  const insert = parts.join(eol + blank) + (ends ? eol : '')
  const change: Change = { from: first.from, to: e.to, insert }
  const norm = normalizeTextChanges([change], text.length)
  const to: Region = [e.from, e.from + (first.from - e.from) + insert.length - (ends ? eol.length : 0)]
  return checked(
    env,
    norm,
    e,
    regionOf(e),
    to,
    e.container,
    'The items do not read as paragraphs',
    (was, now) => {
      const principal = (was[0]?.['items'] as AsgNode[] | undefined)?.map((i) =>
        canonical(i['principal'], null),
      )
      const got = now.map((p) => canonical(p['inlines'], null))
      return (
        was.length === 1 &&
        now.every((p) => p.name === 'paragraph') &&
        JSON.stringify(principal) === JSON.stringify(got)
      )
    },
  )
}
