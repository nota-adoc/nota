/**
 * Parser state at a unit boundary, the units themselves, and the small pieces of machinery the block
 * parser shares: the driver that runs recursive parsing on an explicit stack.
 */
import type { Piece } from './build.js'
import { type AttributeSetup, type Attrs, attrsEqual } from './attrs.js'
import type { CondEvent } from './lines.js'
import { type Cond, condEqual } from './preprocessor.js'
import { rubyToI } from './rx.js'

/** How serious a problem is: `error` (the text is wrong), `warning` (probably wrong), `info` (a hint about something the host can set up). */
export type Severity = 'error' | 'warning' | 'info'

/** A problem the parser found: where it is (offsets of the text), how serious it is, a stable `code` and a message for the author. */
export interface Diagnostic {
  readonly from: number
  readonly to: number
  readonly severity: Severity
  readonly code: string
  readonly message: string
}

/** Parser state at a unit boundary. Compared with {@link sameState}. */
export interface ParseState {
  readonly headerDone: boolean
  readonly hasHeader: boolean
  readonly invalidHeader: boolean
  /** 0: undecided, 1: blocks and sections under the document, 2: the document starts with a section. */
  readonly topMode: 0 | 1 | 2
  readonly doctype: string
  readonly leveloffset: number
  /** Open sections, outermost first, as pairs [level, expected next level or -1 for none]. */
  readonly stack: readonly number[]
  /** The document attributes. */
  readonly attrs: Attrs
  /** The conditionals (`ifdef` … `endif`) that are open. */
  readonly cond: Cond | null
}

export function initialStateOf(setup: AttributeSetup): ParseState {
  const a = setup.initial
  return {
    headerDone: false,
    hasHeader: false,
    invalidHeader: false,
    topMode: 0,
    doctype: a.get('doctype') ?? 'article',
    leveloffset: rubyToI(a.get('leveloffset') ?? '0'),
    stack: [],
    attrs: a,
    cond: null,
  }
}

export function sameState(a: ParseState, b: ParseState): boolean {
  if (a === b) return true
  if (
    a.headerDone !== b.headerDone ||
    a.hasHeader !== b.hasHeader ||
    a.invalidHeader !== b.invalidHeader ||
    a.topMode !== b.topMode ||
    a.doctype !== b.doctype ||
    a.leveloffset !== b.leveloffset ||
    a.stack.length !== b.stack.length
  )
    return false
  for (let i = 0; i < a.stack.length; i++) if (a.stack[i] !== b.stack[i]) return false
  return attrsEqual(a.attrs, b.attrs) && condEqual(a.cond, b.cond)
}

export interface SectionHead {
  /** Effective level of the new section. */
  readonly level: number
  /** Number of open sections closed before this one opens. */
  readonly close: number
  readonly parts: readonly Piece[]
}

/**
 * A parsed unit. All offsets inside are relative to the start of the unit, so a unit can be reused
 * at another position after an edit without copying.
 */
export interface Unit {
  readonly length: number
  /** Length of the text this unit looked at from its start; Infinity if it reached the end of the text. */
  readonly lookAhead: number
  readonly start: ParseState
  readonly end: ParseState
  /** Nodes that belong to the enclosing container (before any section opened by this unit). */
  readonly pre: readonly Piece[]
  readonly block: Piece | null
  readonly section: SectionHead | null
  /** Nodes that follow the block or the section title (blank lines a list took, hidden lines). */
  readonly post: readonly Piece[]
  readonly diagnostics: readonly Diagnostic[]
  /** Conditionals opened and closed in this unit, in order (offsets relative to the unit). */
  readonly events: readonly CondEvent[]
}

/**
 * A step of recursive parsing: generators yield the tasks they need done first (parsing the content of a
 * container) and get the results back, so nesting depth costs no stack (see {@link run}).
 */
export type Task<T = unknown> = Generator<Task, T, never>

/** Runs a task and every task it starts, on an explicit stack instead of the call stack. */
export function run<T>(root: Task<T>): T {
  const stack: Task[] = [root]
  let value: unknown
  for (;;) {
    const g = stack[stack.length - 1]!
    const r = (g as Generator<Task, unknown, unknown>).next(value)
    if (r.done) {
      stack.pop()
      if (stack.length === 0) return r.value as T
      value = r.value
    } else {
      stack.push(r.value)
      value = undefined
    }
  }
}
