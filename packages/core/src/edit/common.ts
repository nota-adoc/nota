import type { NotaDocument } from '../document.js'
import type { Change } from '../changes.js'
import type { Diagnostic } from '../parse/blocks.js'
import type { Cell, Reading, Span } from './types.js'

/** What an operation gives when it works. */
export interface OperationOk {
  readonly doc: NotaDocument
  /** The replacements, in coordinates of the document the operation was given (sorted, non-overlapping). */
  readonly changes: readonly Change[]
  /**
   * False when the text could not be written so that it reads exactly as asked (what was typed made a block of
   * another kind, say): it is written as it is.
   */
  readonly literal?: boolean
}

/** What an operation gives when it refuses: the document stays as it is. */
export interface OperationFailure {
  /** A short code: `not-editable`, `link-across-blocks`, … */
  readonly error: string
  readonly diagnostics: readonly Diagnostic[]
}

export type OperationResult = OperationOk | OperationFailure

/** Messages that come up in more than one place. */
export const MSG = {
  select: 'Select some text first',
  plate: 'The range cuts a plate (a block edited in the source)',
  marker: 'Inside a marker',
  construct: 'The range cuts a construct the visual editor shows but does not edit (`pass:q[…]`, `((…))`)',
} as const

/** The refusal of a position that is not an offset of the text: names it and the bounds, and says what to do. */
export function outsideText(pos: number, length: number): OperationFailure {
  const what = Number.isInteger(pos) ? `Position ${pos} is outside the text` : `Position ${pos} is not a whole number`
  return failure(
    'invalid-range',
    `${what}: an operation takes offsets of the text of the document it is applied to, from 0 to ${length}. ` +
      'Take the position again from the current document.',
  )
}

export function failure(code: string, message: string, from = 0, to = 0): OperationFailure {
  return { error: code, diagnostics: [{ from, to, severity: 'error', code, message }] }
}

export const isFailure = (r: OperationResult): r is OperationFailure => 'error' in r

/** Number of cells that end at or before `offset`. */
export function cellsBefore(cells: readonly Cell[], offset: number): number {
  let lo = 0
  let hi = cells.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (cells[mid]!.to <= offset) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** Number of cells that start before `offset`. */
export function cellsStartingBefore(cells: readonly Cell[], offset: number): number {
  let lo = 0
  let hi = cells.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (cells[mid]!.from < offset) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** The marks that a character typed at `offset` gets: those whose text holds the offset. */
export function spansAt(reading: Reading, offset: number): Span[] {
  return reading.spans.filter((s) => s.type !== 'lock' && s.innerFrom <= offset && offset <= s.innerTo)
}

/** The construct (`pass:q[…]`, `((…))`) whose text the cell is in, or null. */
export const lockOf = (c: Cell): Span | null => c.spans.find((s) => s.type === 'lock') ?? null

/** True when the point between cell `k - 1` and cell `k` is inside the text of a construct that is not edited. */
export function splitsLock(cells: readonly Cell[], k: number): boolean {
  if (k <= 0 || k >= cells.length) return false
  const a = lockOf(cells[k - 1]!)
  return a !== null && cells[k]!.spans.includes(a)
}

/** True when `offset` is between two cells and not in the middle of a marker. */
export function isInsertionPoint(reading: Reading, offset: number): boolean {
  if (offset < reading.from || offset > reading.to) return false
  const k = cellsBefore(reading.cells, offset)
  const next = reading.cells[k]
  if (next && next.from < offset) return false
  for (const s of reading.spans) {
    if (s.type === 'lock' && s.from < offset && offset < s.to) return false
    if (s.from < offset && offset < s.innerFrom) return false
    if (s.innerTo < offset && offset < s.to) return false
  }
  return true
}
