/**
 * Turns the cells a block should have after an edit into a change of the source, and checks the change: the
 * changed text is read again and must give the same cells. When it does not (what was typed makes a construct,
 * or a deletion glues a mark to a word), the source is repaired — a backslash before the start of the construct,
 * a doubled marker — and checked again.
 */
import type { NotaDocument } from '../document.js'
import type { Change } from '../changes.js'
import { cellBlockAt, cellBlocksKept } from './cell.js'
import { type OperationFailure, failure, isFailure } from './common.js'
import { editableBlockAt } from './layout.js'
import { printCells } from './print.js'
import { impliedMark, readCell, readInline } from './read.js'
import { writeCellChanges } from './tables.js'
import type { BlockInfo, Cell, Reading, Span } from './types.js'

/** What tells one mark from another on a cell: the target of a link, the `[…]` of roles. */
export const spanKey = (s: Span): string =>
  s.type === 'link'
    ? 'l:' + s.href
    : s.type === 'roles'
      ? 'r:' + s.attrs + (impliedMark(s) ?? '')
      : s.type === 'lock'
        ? 'k:' + s.open + s.close
        : s.type

/** What the editor shows of a cell: its character or kind, its marks. */
export function cellKey(c: Cell): string {
  const marks = c.spans.length === 0 ? '' : c.spans.map(spanKey).sort().join(',')
  const body = c.kind === 'chip' ? 'C' + c.src : c.kind === 'break' ? 'B' : 'c' + c.ch
  return body + (c.flag ? '!' + c.flag.name : '') + '|' + marks
}

/** True when two cells show the same (the check of a keystroke runs over a whole paragraph: no strings are made). */
function sameCell(a: Cell, b: Cell): boolean {
  if (a.kind !== b.kind || a.ch !== b.ch || (a.flag?.name ?? '') !== (b.flag?.name ?? '')) return false
  if (a.kind === 'chip' && a.src !== b.src) return false
  if (a.spans === b.spans) return true
  if (a.spans.length !== b.spans.length) return false
  return a.spans.every((s) =>
    b.spans.some(
      (t) =>
        t.type === s.type &&
        t.href === s.href &&
        (s.type !== 'roles' || (t.attrs === s.attrs && impliedMark(t) === impliedMark(s))),
    ),
  )
}

/** The first index at which two runs of cells differ; -1 when they are the same. */
export function firstDivergence(a: readonly Cell[], b: readonly Cell[]): number {
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) if (!sameCell(a[i]!, b[i]!)) return i
  return a.length === b.length ? -1 : n
}

/**
 * The change from `oldText` (at `offset` of the document) to `newText` as one replacement inside it (none when they
 * are equal). `hint`, an offset of the document, keeps the replacement from starting after it: where text that
 * equals its neighbour was put in is not in doubt then.
 */
export function diffChange(offset: number, oldText: string, newText: string, hint?: number): Change[] {
  if (oldText === newText) return []
  let a = 0
  const max = Math.min(oldText.length, newText.length)
  const cap = hint === undefined ? max : Math.max(0, Math.min(max, hint - offset))
  while (a < cap && oldText.charCodeAt(a) === newText.charCodeAt(a)) a++
  let b = 0
  while (
    b < max - a &&
    oldText.charCodeAt(oldText.length - 1 - b) === newText.charCodeAt(newText.length - 1 - b)
  )
    b++
  return [{ from: offset + a, to: offset + oldText.length - b, insert: newText.slice(a, newText.length - b) }]
}

export interface Realized {
  readonly changes: readonly Change[]
  readonly doc: NotaDocument
  /** The cells the block has after the change; null when it is no longer a block of the same kind. */
  readonly reading: Reading | null
  /** The block reads exactly as the cells said. False: what was asked cannot be written without side effects. */
  readonly exact: boolean
  /** The change is refused (a cell that cannot take the text): nothing is written. */
  readonly fail?: OperationFailure
}

const escapable = (c: Cell): boolean => c.kind === 'char' && !c.newline && c.ch !== ' '

interface Attempt {
  doc: NotaDocument
  changes: Change[]
  reading: Reading | null
  same: boolean
  fail?: OperationFailure
}

/** The attempt for the text of a cell: the change goes through the checks of the table. */
function attemptCell(doc: NotaDocument, block: BlockInfo, cells: readonly Cell[], hint?: number): Attempt {
  const c = block.content!
  const printed = printCells(cells)
  const changes = diffChange(c.from, doc.text.slice(c.from, c.to), printed, hint)
  const res = writeCellChanges(doc, block.inCell!.at, c.from, changes, printed, c.to)
  if (isFailure(res)) return { doc, changes: [], reading: null, same: false, fail: res }
  const next = res.doc
  // (the other blocks of an `a` cell stay as they were: a paragraph made an item joins the list below it, say)
  if (!cellBlocksKept(doc, next, block.inCell!.at, c.from, c.to))
    return {
      doc,
      changes: [],
      reading: null,
      same: false,
      fail: failure('collateral', 'That would change how other blocks read', block.from, block.to),
    }
  const now = cellBlockAt(next, block.inCell!.at, c.from)
  if (!now || now.content!.from !== c.from) return { doc: next, changes: res.changes as Change[], reading: null, same: false }
  const reading = readCell(next, now.content!.from, now.content!.to)
  return { doc: next, changes: res.changes as Change[], reading, same: firstDivergence(reading.cells, cells) < 0 }
}

function attempt(doc: NotaDocument, block: BlockInfo, cells: readonly Cell[], hint?: number): Attempt {
  if (block.inCell) return attemptCell(doc, block, cells, hint)
  const c = block.content!
  const oldText = doc.text.slice(c.from, c.to)
  const printed = printCells(cells)
  const changes = diffChange(c.from, oldText, printed, hint)
  const next = changes.length ? doc.update(changes) : doc
  const delta = printed.length - oldText.length
  const info = editableBlockAt(next, block.from)
  const ok =
    !!info &&
    info.kind === block.kind &&
    info.level === block.level &&
    info.to === block.to + delta &&
    info.content!.from === c.from &&
    info.content!.to === c.to + delta &&
    (info.meta?.to ?? -1) === (block.meta?.to ?? -1)
  if (!ok) return { doc: next, changes, reading: null, same: false }
  const reading = readInline(next, c.from, c.to + delta)
  return { doc: next, changes, reading, same: firstDivergence(reading.cells, cells) < 0 }
}

const MARKER_CHARS = '*_`#+^~'

/** The backslashes in front of the character of a cell. */
const prefixLen = (c: Cell): number =>
  c.kind === 'char' && c.src.endsWith(c.ch) ? c.src.length - c.ch.length : 0

const withPrefix = (c: Cell, k: number): Cell => ({ ...c, src: '\\'.repeat(k) + c.ch })

/** Changes the cells so that the next attempt has a better chance; null when there is nothing left to try. */
function repair(actual: readonly Cell[], expected: Cell[], d: number, tried: Set<string>): Cell[] | null {
  const a = actual[d]
  const e = expected[d]
  if (!e) return null
  const once = (key: string): boolean => {
    if (tried.has(key)) return false
    tried.add(key)
    return true
  }
  /** Puts a backslash (two for a marker that is doubled: `\\**`) before cell `i`. */
  const escapeAt = (i: number): Cell[] | null => {
    const c = expected[i]!
    if (!escapable(c)) return null
    const doubled =
      MARKER_CHARS.includes(c.ch) && expected[i + 1]?.kind === 'char' && expected[i + 1]!.ch === c.ch
    const have = prefixLen(c)
    for (const k of doubled ? [2, 1] : [1, 2]) {
      if (k > have && once(`esc${i}:${k}`)) {
        const out = expected.slice()
        out[i] = withPrefix(c, k)
        return out
      }
    }
    return null
  }
  if (!a) return escapeAt(d)
  if (a.kind !== e.kind || a.ch !== e.ch) {
    // a backslash that shows: it protects nothing any more
    const have = prefixLen(e)
    if (a.kind === 'char' && a.ch === '\\' && have > 0 && once(`un${d}:${have}`)) {
      const out = expected.slice()
      out[d] = withPrefix(e, have - 1)
      return out
    }
    return escapeAt(d)
  }
  // the same character, read differently
  if (a.flag && !e.flag) {
    let m = d
    while (m > 0 && actual[m - 1]!.flag === a.flag) m--
    return escapeAt(m)
  }
  const eKeys = new Set(e.spans.map(spanKey))
  const extra = a.spans.find((s) => !eKeys.has(spanKey(s)))
  if (extra) {
    let m = d
    while (m > 0 && actual[m - 1]!.spans.includes(extra)) m--
    return escapeAt(m)
  }
  const aKeys = new Set(a.spans.map(spanKey))
  const lost = e.spans.find((s) => !aKeys.has(spanKey(s)))
  if (
    lost &&
    lost.type !== 'link' &&
    lost.type !== 'lock' &&
    lost.marker.length === 1 &&
    !lost.double &&
    once('dbl' + lost.from + ':' + lost.type + d)
  ) {
    // a marker that is no longer read (a word touches it now): write it doubled
    const copy: Span = { ...lost, double: true }
    return expected.map((c) =>
      c.spans.includes(lost) ? { ...c, spans: c.spans.map((s) => (s === lost ? copy : s)) } : c,
    )
  }
  return null
}

const MAX_ATTEMPTS = 12

/**
 * The change that gives `block` (a paragraph or a heading of `doc`) the text `expected`, with the check.
 * When no source gives exactly these cells, the first attempt is returned with `exact: false`.
 */
export function realizeContent(
  doc: NotaDocument,
  block: BlockInfo,
  expected: readonly Cell[],
  hint?: number,
): Realized {
  let cells = expected.slice()
  const tried = new Set<string>()
  let first: Realized | null = null
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const r = attempt(doc, block, cells, hint)
    if (r.fail) return { changes: [], doc, reading: null, exact: false, fail: r.fail }
    if (r.same && r.reading) return { changes: r.changes, doc: r.doc, reading: r.reading, exact: true }
    first ??= { changes: r.changes, doc: r.doc, reading: r.reading, exact: false }
    if (!r.reading) break
    const d = firstDivergence(r.reading.cells, cells)
    const next = repair(r.reading.cells, cells, d, tried)
    if (!next) break
    cells = next
  }
  return first!
}
