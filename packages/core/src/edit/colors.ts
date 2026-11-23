/**
 * Colour operations: a role (`hl-mint`, or one the host names) on a range of text, changed to another, or taken off.
 * The text is read as characters (see `colorLayoutOf`); each character gets the set of colour roles it must have,
 * and the source is changed only in its attributes `[…]`, its marks `#`/`##` and the names of roles. What is written is
 * read again and checked: the characters and what they are in (strong, emphasis, links) are the same, and the colour of
 * each character is the one asked for.
 */
import type { NotaDocument } from '../document.js'
import { type Change, applyTextChanges, normalizeTextChanges } from '../changes.js'
import {
  type InlineNode,
  type Place,
  type TextEl,
  colorLayoutOf,
  isColorRole,
  isNode,
} from '../colors.js'
import { tableModel } from '../nodes.js'
import { MSG, type OperationResult, failure } from './common.js'

export type ColorOperation =
  | { readonly kind: 'setColor'; readonly from: number; readonly to: number; readonly role: string }
  | {
      readonly kind: 'replaceColor'
      readonly from: number
      readonly to: number
      readonly role: string
      readonly replace?: string
    }
  | { readonly kind: 'removeColor'; readonly from: number; readonly to: number; readonly role?: string }

const ROLE_RE = /^[\p{L}\p{N}_-]+$/u
const WORD_RE = /^[\p{Alphabetic}\p{M}\p{Nd}\p{Pc}]$/u

/** The marks of the kinds that have a constrained and an unconstrained form. */
const MARKS: Readonly<Record<string, readonly [string, string]>> = {
  strong: ['*', '**'],
  emphasis: ['_', '__'],
  code: ['`', '``'],
  mark: ['#', '##'],
}
const FORBID_BEFORE: Readonly<Record<string, string>> = { mark: '&;:}', strong: ';:}', emphasis: ';:}', code: ';:"\'`}' }
const FORBID_AFTER: Readonly<Record<string, string>> = { code: '"\'`' }

interface Ch {
  readonly el: TextEl
  readonly idx: number
  readonly chain: readonly InlineNode[]
  readonly ws: boolean
  sel: boolean
  cur: string[]
  want: string[]
  have: Set<string>
  need: string[]
}

interface PlaceState {
  readonly place: Place
  readonly chars: Ch[]
  readonly a: Map<InlineNode, number>
  readonly b: Map<InlineNode, number>
  readonly nodes: InlineNode[]
  readonly chOf: Map<TextEl, Ch>
}

interface Seg {
  a: number
  b: number
  sig: string[]
}

interface Wrap {
  readonly parent: InlineNode
  readonly roles: string[]
  readonly first: Ch
  readonly last: Ch
  readonly start: number
  readonly end: number
  readonly depth: number
  left: InlineNode | null
  right: InlineNode | null
  /** The indexes in the items of `parent` of its first and last item. */
  readonly i0: number
  readonly i1: number
}

interface Plan {
  readonly state: PlaceState
  readonly absorb: Map<InlineNode, string[]>
  readonly wraps: Wrap[]
  readonly segs: Map<InlineNode, Seg[]>
  /** The offsets where the segments of a mark close and open again, from the boundary between two characters. */
  readonly cutAt: Map<number, number>
}

class Unstable extends Error {}

const sameSet = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((x) => b.includes(x))

const isWs = (t: string): boolean => /^\s$/.test(t)

function buildState(place: Place, text: string): PlaceState {
  const chars: Ch[] = []
  const a = new Map<InlineNode, number>()
  const b = new Map<InlineNode, number>()
  const nodes: InlineNode[] = []
  const chOf = new Map<TextEl, Ch>()
  const stack: InlineNode[] = []
  const walk = (n: InlineNode): void => {
    a.set(n, chars.length)
    if (n.kind !== 'root') {
      stack.push(n)
      nodes.push(n)
    }
    for (const it of n.items) {
      if (isNode(it)) walk(it)
      else {
        const cur: string[] = []
        for (const q of stack) for (const r of q.colors) if (!cur.includes(r.name)) cur.push(r.name)
        const ch: Ch = {
          el: it,
          idx: chars.length,
          chain: stack.slice(),
          ws: it.to - it.from === 1 && isWs(text[it.from]!),
          sel: false,
          cur,
          want: cur,
          have: new Set(),
          need: [],
        }
        chars.push(ch)
        chOf.set(it, ch)
      }
    }
    if (n.kind !== 'root') stack.pop()
    b.set(n, chars.length)
  }
  walk(place.root)
  return { place, chars, a, b, nodes, chOf }
}

const depthOf = (n: InlineNode): number => {
  let d = 0
  for (let p = n.parent; p; p = p.parent) d++
  return d
}

const containsMark = (n: InlineNode): boolean => n.kind === 'mark' || n.items.some((i) => isNode(i) && containsMark(i))

/** The offset where the quotes that end between two characters have all closed. */
function gapEnd(chars: readonly Ch[], k: number): number {
  const left = chars[k - 1]!
  const right = chars[k]!
  let x = left.el.to
  for (const n of left.chain) {
    if (right.chain.includes(n)) continue
    x = Math.max(x, n.kind === 'link' ? n.to : n.close!.to)
  }
  return x
}

export function colorOperation(doc: NotaDocument, op: ColorOperation): OperationResult {
  let { from, to } = op
  if (from > to) [from, to] = [to, from]
  const registry = doc.options.colorRoles
  const okRole = (name: unknown): name is string =>
    typeof name === 'string' && ROLE_RE.test(name) && isColorRole(name, registry)
  const bad = (name: unknown): boolean => !okRole(name)
  if (op.kind !== 'removeColor' || op.role !== undefined) if (bad(op.role)) return failure('invalid-role', 'That is not a colour role', from, to)
  if (op.kind === 'replaceColor' && op.replace !== undefined && bad(op.replace))
    return failure('invalid-role', 'That is not a colour role', from, to)
  if (from === to) return failure('empty-selection', MSG.select, from, to)

  const layout = colorLayoutOf(doc)
  const text = doc.text

  // the ends of the range must not lie inside a construct that is not text
  const hit = (pos: number): object | null => {
    for (const p of layout.plates) {
      if (p.from < pos && pos < p.to && !(p.hole && pos >= p.hole.from && pos <= p.hole.to)) return p
    }
    return null
  }
  const h0 = hit(from)
  const h1 = hit(to)
  if (h0 || h1) {
    return h0 === h1
      ? failure('not-colorable', 'Colour is not shown there', from, to)
      : failure('inside-construct', MSG.plate, from, to)
  }

  const states: PlaceState[] = []
  let any = false
  for (const place of layout.places) {
    const c = place.container
    if (c.to < from || c.from > to) continue
    const st = buildState(place, text)
    states.push(st)
  }
  for (const st of states) {
    for (const ch of st.chars) {
      const t = ch.el
      if (t.to <= from || t.from >= to) continue
      if (t.from < from || t.to > to) return failure('inside-construct', MSG.plate, from, to)
    }
  }
  // (the label of the fill of a cell is not text: it is not coloured)
  const labels: [number, number][] = []
  doc.tree.iterate({
    from,
    to,
    enter: (n) => {
      if (n.name !== 'DelimitedBlock' || !n.node.tree?.prop(tableModel)) return
      const m = doc.tableAt(n.from)
      if (m) for (const part of [m.rows.head, m.rows.body, m.rows.foot]) for (const r of part) for (const c of r.cells) if (c.fill) labels.push([c.fill.from, c.fill.to])
    },
  })
  for (const st of states) {
    for (const ch of st.chars) {
      ch.sel = ch.el.from >= from && ch.el.to <= to && !labels.some(([a, b]) => a <= ch.el.from && ch.el.to <= b)
      if (ch.sel) any = true
    }
  }
  if (!any) {
    const body = text.slice(from, to)
    if (!body.trim()) return failure('empty-selection', MSG.select, from, to)
    const markup: [number, number][] = []
    for (const place of layout.places) {
      const walk = (n: InlineNode): void => {
        if (n.attrs) markup.push([n.attrs.from, n.attrs.to])
        if (n.open) markup.push([n.open.from, n.open.to])
        if (n.close) markup.push([n.close.from, n.close.to])
        for (const i of n.items) if (isNode(i)) walk(i)
      }
      if (place.container.to >= from && place.container.from <= to) walk(place.root)
    }
    let only = true
    for (let i = from; i < to && only; i++)
      if (!isWs(text[i]!) && !markup.some(([a, b]) => a <= i && i < b)) only = false
    if (only) return failure('empty-selection', MSG.select, from, to)
    if (op.kind === 'removeColor') return { doc, changes: [] }
    return failure('not-colorable', 'Colour is not shown there', from, to)
  }

  // what each character must have
  for (const st of states) {
    for (const ch of st.chars) {
      if (!ch.sel) continue
      if (op.kind === 'setColor') ch.want = ch.cur.includes(op.role) ? ch.cur : [...ch.cur, op.role]
      else if (op.kind === 'replaceColor') {
        if (op.replace === undefined) ch.want = [op.role]
        else if (ch.cur.includes(op.replace)) {
          const w = ch.cur.map((r) => (r === op.replace ? op.role : r))
          ch.want = w.filter((r, i) => w.indexOf(r) === i)
        }
      } else ch.want = op.role === undefined ? [] : ch.cur.filter((r) => r !== op.role)
    }
    // a blank next to a character that changes follows its neighbours (it joins two pieces, or is left out of one)
    const chars = st.chars
    const changed = chars.map((c) => !c.ws && !sameSet(c.want, c.cur))
    for (let i = 0; i < chars.length; i++) {
      const c = chars[i]!
      if (!c.ws || c.sel) continue
      let l = i - 1
      while (l >= 0 && chars[l]!.ws) l--
      let r = i + 1
      while (r < chars.length && chars[r]!.ws) r++
      const L = chars[l]
      const R = chars[r]
      if (!((L && changed[l]) || (R && changed[r]))) continue
      const lw = L ? L.want : []
      const rw = R ? R.want : []
      c.want = lw.filter((x) => rw.includes(x))
    }
  }

  const plans: Plan[] = []
  try {
    for (const st of states) plans.push(planPlace(st, doc))
  } catch (e) {
    if (e instanceof Unstable) return failure('unstable', e.message, from, to)
    throw e
  }
  const wantsChange = states.some((st) => st.chars.some((c) => !sameSet(c.want, c.cur)))
  if (!wantsChange) return { doc, changes: [] }

  const before = signatureOf(doc)
  let last: OperationResult | null = null
  for (const force of [false, true]) {
    let changes: Change[]
    try {
      changes = emit(doc, plans, force)
    } catch (e) {
      if (e instanceof Unstable || e instanceof RangeError) {
        last = failure('unstable', 'The colour cannot be written so that it reads as asked', from, to)
        continue
      }
      throw e
    }
    if (changes.length === 0) {
      last = failure('unstable', 'The colour asked for is not written by any change', from, to)
      continue
    }
    const next = doc.update(changes)
    if (next.text !== applyTextChanges(text, changes)) {
      last = failure('unstable', 'The result differs from the changes', from, to)
      continue
    }
    const bad = verify(doc, next, changes, states, before)
    if (bad) {
      last = failure(bad, 'That would change something besides the colour', from, to)
      continue
    }
    return { doc: next, changes }
  }
  return last!
}

// ---------------------------------------------------------------------------------------------------------------------
// the plan: what each construct of a place must hold, and where new marks go

function planPlace(st: PlaceState, doc: NotaDocument): Plan {
  const { chars, a, b } = st
  // what the existing constructs keep, and what is still needed
  for (const c of chars) c.have = new Set()
  for (const q of st.nodes) {
    if (q.kind === 'link') continue
    for (let i = a.get(q)!; i < b.get(q)!; i++) {
      const c = chars[i]!
      for (const r of q.colors) if (c.want.includes(r.name)) c.have.add(r.name)
    }
  }
  for (const c of chars) c.need = c.want.filter((r) => !c.have.has(r))
  const keyOf = (c: Ch): string => c.need.join('\0')
  const memo = new Map<InlineNode, string | null | undefined>()
  const nodeKey = (n: InlineNode): string | null | undefined => {
    if (memo.has(n)) return memo.get(n)
    const i0 = a.get(n)!
    const i1 = b.get(n)!
    let k: string | null | undefined
    if (i0 < i1) {
      k = keyOf(chars[i0]!)
      for (let i = i0 + 1; i < i1; i++)
        if (keyOf(chars[i]!) !== k) {
          k = null
          break
        }
    }
    memo.set(n, k)
    return k
  }
  const absorb = new Map<InlineNode, string[]>()
  const wraps: Wrap[] = []

  const process = (P: InlineNode): void => {
    let run: { key: string; idx: number[] } | null = null
    const close = (): void => {
      if (!run) return
      const items = run.idx.map((i) => P.items[i]!)
      const at = (x: TextEl | InlineNode): Ch => (isNode(x) ? chars[a.get(x)!]! : st.chOf.get(x)!)
      const roles = at(items[0]!).need
      if (items.length === 1 && isNode(items[0]!)) absorb.set(items[0]!, roles)
      else {
        const first = items[0]!
        const lastI = items[items.length - 1]!
        const firstCh = at(first)
        const lastCh = isNode(lastI) ? chars[b.get(lastI)! - 1]! : st.chOf.get(lastI)!
        wraps.push({
          parent: P,
          roles,
          first: firstCh,
          last: lastCh,
          start: first.from,
          end: lastI.to,
          depth: depthOf(P) + 1,
          left: null,
          right: null,
          i0: run.idx[0]!,
          i1: run.idx[run.idx.length - 1]!,
        })
      }
      run = null
    }
    P.items.forEach((it, i) => {
      if (!isNode(it)) {
        const k = keyOf(st.chOf.get(it)!)
        if (k === '') return close()
        if (run && run.key === k) run.idx.push(i)
        else {
          close()
          run = { key: k, idx: [i] }
        }
        return
      }
      const k = nodeKey(it)
      if (k === undefined) return
      if (it.kind === 'link') {
        close()
        if (k !== '') process(it)
        return
      }
      if (k === '') return close()
      if (k === null) {
        close()
        return process(it)
      }
      if (it.kind === 'mark' || containsMark(it)) {
        close()
        absorb.set(it, chars[a.get(it)!]!.need)
        return
      }
      if (run && run.key === k) run.idx.push(i)
      else {
        close()
        run = { key: k, idx: [i] }
      }
    })
    close()
  }

  process(st.place.root)

  // the constructs that change their colours are cut where the colours of their characters differ
  const sigOf = (q: InlineNode, c: Ch): string[] => {
    const s = q.colors.map((r) => r.name).filter((n) => c.want.includes(n))
    for (const n of absorb.get(q) ?? []) if (!s.includes(n)) s.push(n)
    return s
  }
  const cutAt = new Map<number, number>()
  const total = new Map<InlineNode, Set<number>>()
  const segs = new Map<InlineNode, Seg[]>()
  const visit = (n: InlineNode, inherited: Set<number>): void => {
    const i0 = a.get(n)!
    const i1 = b.get(n)!
    const mine = new Set<number>()
    for (const k of inherited) if (k > i0 && k < i1) mine.add(k)
    if (n.kind === 'link') {
      if (mine.size > 0) throw new Unstable('A link cannot be cut')
    } else if (n.kind !== 'root') {
      for (let k = i0 + 1; k < i1; k++) {
        const x = sigOf(n, chars[k - 1]!)
        const y = sigOf(n, chars[k]!)
        if (x.join('\0') !== y.join('\0')) mine.add(k)
      }
    }
    total.set(n, mine)
    if (n.kind !== 'root' && n.kind !== 'link' && i0 < i1) {
      const cuts = [...mine].sort((x, y) => x - y)
      const list: Seg[] = []
      let s = i0
      for (const k of [...cuts, i1]) {
        list.push({ a: s, b: k, sig: sigOf(n, chars[s]!) })
        s = k
      }
      segs.set(n, list)
      for (const k of cuts) if (!cutAt.has(k)) cutAt.set(k, gapEnd(chars, k))
    }
    for (const it of n.items) if (isNode(it)) visit(it, mine)
  }
  visit(st.place.root, new Set())
  // a mark that is not changed and has the colours of a new one next to it takes the new one in
  const mergeable = (n: InlineNode | undefined, roles: readonly string[]): n is InlineNode => {
    if (!n || !isNode(n) || n.kind !== 'mark' || !n.attrs || n.roles.length !== n.colors.length) return false
    const names = n.colors.map((r) => r.name)
    if (!sameSet(names, roles) || absorb.has(n)) return false
    const list = segs.get(n)
    return !!list && list.length === 1 && list[0]!.sig.join('\0') === names.join('\0')
  }
  for (const w of wraps) {
    const l = w.parent.items[w.i0 - 1] as InlineNode | undefined
    const r = w.parent.items[w.i1 + 1] as InlineNode | undefined
    if (mergeable(l, w.roles) && /^\s*$/.test(doc.text.slice(l.to, w.start))) w.left = l
    if (mergeable(r, w.roles) && /^\s*$/.test(doc.text.slice(w.end, r.from))) w.right = r
  }
  return { state: st, absorb, wraps, segs, cutAt }
}

// ---------------------------------------------------------------------------------------------------------------------
// the edits

interface Tok {
  readonly at: number
  readonly text: string
  readonly close: boolean
  readonly depth: number
}

function emit(doc: NotaDocument, plans: readonly Plan[], force: boolean): Change[] {
  const text = doc.text
  const reps: Change[] = []
  const toks: Tok[] = []
  const del = (from: number, to: number): void => void reps.push({ from, to, insert: '' })
  const rep = (from: number, to: number, insert: string): void => void reps.push({ from, to, insert })
  const tok = (at: number, t: string, close: boolean, depth: number): void => void toks.push({ at, text: t, close, depth })

  const closeAt = new Set<number>()
  const openAt = new Set<number>()
  for (const p of plans)
    for (const list of p.segs.values()) {
      for (let i = 0; i + 1 < list.length; i++) {
        const x = p.cutAt.get(list[i + 1]!.a)!
        closeAt.add(x)
        openAt.add(x)
      }
    }

  const isWord = (ch: string | undefined): boolean => {
    if (!ch) return false
    const cp = ch.codePointAt(0)!
    return WORD_RE.test(String.fromCodePoint(cp))
  }
  const prevCh = (pos: number): string | undefined => {
    if (pos <= 0) return undefined
    const c = text.charCodeAt(pos - 1)
    if (c >= 0xdc00 && c <= 0xdfff && pos >= 2) return text.slice(pos - 2, pos)
    return text[pos - 1]
  }
  const nextCh = (pos: number): string | undefined => (pos < text.length ? String.fromCodePoint(text.codePointAt(pos)!) : undefined)
  const constrainedOk = (kind: string, first: TextEl, lastEl: TextEl, before: string | undefined, after: string | undefined): boolean => {
    if (isWs(text[first.from]!) || isWs(text[lastEl.to - 1]!)) return false
    if (before !== undefined && (isWord(before) || (FORBID_BEFORE[kind] ?? '').includes(before))) return false
    if (after !== undefined && (isWord(after) || (FORBID_AFTER[kind] ?? '').includes(after))) return false
    return true
  }
  const markerOf = (kind: string, un: boolean, orig: string): string => {
    const m = MARKS[kind]
    return m ? m[un ? 1 : 0] : orig
  }

  for (const p of plans) {
    const { state: st, wraps, segs } = p
    const chars = st.chars

    const nonColor = (q: InlineNode): string[] => q.roles.filter((r) => !r.color).map((r) => r.name)
    const hasOther = (q: InlineNode): boolean => {
      if (!q.attrs) return false
      let body = text.slice(q.attrs.from + 1, q.attrs.to - 1)
      const cut = q.colors.map((r) => [r.from - q.attrs!.from - 1, r.to - q.attrs!.from - 1] as const).sort((x, y) => y[0] - x[0])
      for (const [x, y] of cut) body = body.slice(0, x) + body.slice(y)
      return body.replace(/[.\s]/g, '') !== ''
    }
    const attrsText = (names: readonly string[]): string => (names.length ? '[.' + names.join('.') + ']' : '')

    // the existing constructs
    for (const q of st.nodes) {
      const list = segs.get(q)
      if (!list || list.length === 0 || q.kind === 'link') continue
      if (list.length === 1 && list[0]!.sig.join('\0') === q.colors.map((r) => r.name).join('\0')) continue
      const depth = depthOf(q)
      const others = nonColor(q)
      const liveOf = (s: Seg, first: boolean): boolean => {
        if (q.kind !== 'mark' || q.colors.length === 0) return true
        if (s.sig.length > 0) return true
        return first ? hasOther(q) : others.length > 0
      }
      const forms = MARKS[q.kind]
      const unOf = (i: number): boolean => {
        const s = list[i]!
        if (!forms) return q.form === 'unconstrained'
        if (force || q.form === 'unconstrained') return true
        if (list.length === 1) return false
        const before = i === 0 ? prevCh(q.from) : undefined
        const after = i === list.length - 1 ? nextCh(q.to) : undefined
        return !constrainedOk(q.kind, chars[s.a]!.el, chars[s.b - 1]!.el, before, after)
      }
      const openText = text.slice(q.open!.from, q.open!.to)
      const closeText = text.slice(q.close!.from, q.close!.to)
      const first = list[0]!
      const lastS = list[list.length - 1]!
      const live0 = liveOf(first, true)
      const liveN = liveOf(lastS, list.length === 1)
      if (!live0) del(q.attrs ? q.attrs.from : q.open!.from, q.open!.to)
      else {
        attrsEdit(q, first.sig)
        const m = markerOf(q.kind, unOf(0), openText)
        if (m !== openText) rep(q.open!.from, q.open!.to, m)
      }
      if (!liveN) del(q.close!.from, q.close!.to)
      else {
        const m = markerOf(q.kind, unOf(list.length - 1), closeText)
        if (m !== closeText) rep(q.close!.from, q.close!.to, m)
      }
      for (let i = 0; i + 1 < list.length; i++) {
        const x = p.cutAt.get(list[i + 1]!.a)!
        if (liveOf(list[i]!, i === 0)) tok(x, markerOf(q.kind, unOf(i), closeText), true, depth)
        if (liveOf(list[i + 1]!, false))
          tok(x, attrsText([...list[i + 1]!.sig, ...others]) + markerOf(q.kind, unOf(i + 1), openText), false, depth)
      }
    }

    function attrsEdit(q: InlineNode, sig: readonly string[]): void {
      const old = q.colors.map((r) => r.name)
      if (old.length === sig.length && old.every((n, i) => n === sig[i])) return
      if (!q.attrs) {
        if (sig.length) tok(q.from, attrsText(sig), false, depthOf(q))
        return
      }
      if (sig.length === 0 && !hasOther(q)) return del(q.attrs.from, q.attrs.to)
      const removed = q.colors.filter((r) => !sig.includes(r.name))
      const added = sig.filter((n) => !old.includes(n))
      const word = !/^\s*[.#]/.test(text.slice(q.attrs.from + 1, q.attrs.to - 1)) && q.roles.length > 0
      removed.forEach((r, i) => {
        if (i < added.length) return rep(r.from, r.to, added[i]!)
        if (word) {
          if (text[r.to] === ' ') return del(r.from, r.to + 1)
          return del(text[r.from - 1] === ' ' ? r.from - 1 : r.from, r.to)
        }
        del(text[r.from - 1] === '.' ? r.from - 1 : r.from, r.to)
      })
      const extra = added.slice(removed.length)
      if (extra.length) {
        let at: number
        if (q.roles.length) at = Math.max(...q.roles.map((r) => r.to))
        else {
          const body = text.slice(q.attrs.from + 1, q.attrs.to - 1)
          const comma = body.indexOf(',')
          at = q.attrs.from + 1 + (comma < 0 ? body.length : comma)
        }
        rep(at, at, extra.map((n) => (word ? ' ' : '.') + n).join(''))
      }
    }

    // the new marks
    for (const w of wraps) {
      const L = w.left
      const R = w.right
      const firstEl = L ? chars[st.a.get(L)!]!.el : w.first.el
      const lastEl = R ? chars[st.b.get(R)! - 1]!.el : w.last.el
      const lStart = L ? L.from : w.start
      const rEnd = R ? R.to : w.end
      const before = L ? prevCh(lStart) : closeAt.has(w.start) ? undefined : prevCh(w.start)
      const after = R ? nextCh(rEnd) : openAt.has(w.end) ? undefined : nextCh(w.end)
      const un = force || !constrainedOk('mark', firstEl, lastEl, before, after)
      const mk = MARKS.mark![un ? 1 : 0]!
      if (L) {
        const o = text.slice(L.open!.from, L.open!.to)
        if (o !== mk) rep(L.open!.from, L.open!.to, mk)
        del(L.close!.from, L.close!.to)
      } else tok(w.start, attrsText(w.roles) + mk, false, w.depth)
      if (R) {
        const c = text.slice(R.close!.from, R.close!.to)
        del(R.attrs!.from, R.open!.to)
        if (c !== mk) rep(R.close!.from, R.close!.to, mk)
      } else tok(w.end, mk, true, w.depth)
    }
  }

  // marks at the same place: those that close first (the innermost first), then those that open (the outermost first)
  const byAt = new Map<number, Tok[]>()
  for (const t of toks) {
    const l = byAt.get(t.at)
    if (l) l.push(t)
    else byAt.set(t.at, [t])
  }
  const all: Change[] = [...reps]
  for (const [at, list] of byAt) {
    const closes = list.filter((t) => t.close).sort((x, y) => y.depth - x.depth)
    const opens = list.filter((t) => !t.close).sort((x, y) => x.depth - y.depth)
    all.push({ from: at, to: at, insert: [...closes, ...opens].map((t) => t.text).join('') })
  }
  return normalizeTextChanges(all, text.length)
}

// ---------------------------------------------------------------------------------------------------------------------
// the check

/** The text of the characters of every place and what each character is in, without the colours. */
function signatureOf(doc: NotaDocument): string[] {
  const out: string[] = []
  const text = doc.text
  for (const place of colorLayoutOf(doc).places) {
    const parts: string[] = [`${place.container.kind}:${place.container.depth}`]
    const walk = (n: InlineNode, path: string): void => {
      for (const it of n.items) {
        if (isNode(it)) {
          const wrapper = it.kind === 'mark' && it.attrs !== null && it.roles.length === it.colors.length
          walk(it, wrapper ? path : path + '/' + it.kind)
        } else parts.push(`${text.slice(it.from, it.to)}${path}`)
      }
    }
    walk(place.root, '')
    out.push(parts.join('\u0001'))
  }
  return out
}

function colorsOf(doc: NotaDocument): string[][][] {
  return colorLayoutOf(doc).places.map((place) => {
    const out: string[][] = []
    const walk = (n: InlineNode, stack: readonly InlineNode[]): void => {
      for (const it of n.items) {
        if (isNode(it)) walk(it, [...stack, it])
        else {
          const cur: string[] = []
          for (const q of stack) for (const r of q.colors) if (!cur.includes(r.name)) cur.push(r.name)
          out.push(cur)
        }
      }
    }
    walk(place.root, [])
    return out
  })
}

function verify(
  doc: NotaDocument,
  next: NotaDocument,
  changes: readonly Change[],
  states: readonly PlaceState[],
  before: readonly string[],
): string | null {
  const places = colorLayoutOf(doc).places
  for (const c of changes) {
    if (!places.some((p) => p.container.from <= c.from && c.to <= p.container.to)) return 'collateral'
  }
  const after = signatureOf(next)
  if (after.length !== before.length) return 'collateral'
  for (let i = 0; i < before.length; i++) if (before[i] !== after[i]) return 'collateral'
  const colors = colorsOf(next)
  const oldColors = colorsOf(doc)
  const want = new Map<number, PlaceState>()
  states.forEach((st) => want.set(places.indexOf(st.place), st))
  for (let pi = 0; pi < colors.length; pi++) {
    const st = want.get(pi)
    const now = colors[pi]!
    for (let ci = 0; ci < now.length; ci++) {
      const ch = st?.chars[ci]
      if (!ch) {
        if (!sameSet(now[ci]!, oldColors[pi]![ci]!)) return 'unstable'
      } else if (ch.sel) {
        if (!sameSet(now[ci]!, ch.want)) return 'unstable'
      } else if (!ch.ws && !sameSet(now[ci]!, ch.cur)) return 'unstable'
    }
  }
  return null
}
