/**
 * A session: the text of one document, its Nota document and one undo history, shared by everything that edits
 * or shows the text (source editors, the visual editor, a preview).
 *
 * The history is a stack of text replacements, not of the transactions of an editor: each step keeps the
 * replacement that undoes it, so undoing every step gives the first text byte for byte, whoever made the edits.
 * Steps made by the same origin in quick succession next to each other are one step (typing).
 */
import { type Change, composeChanges, invertChanges, mapOffset, normalizeTextChanges } from './changes.js'
import type { TextChange } from './incremental.js'
import { type ParseOptions, type NotaDocument, parse } from './document.js'

/** What happened to the text of a session. */
export interface SessionEvent {
  readonly kind: 'apply' | 'undo' | 'redo'
  /** The replacements, in coordinates of the text before the event (non-overlapping, in order). */
  readonly changes: readonly Change[]
  /** Who asked: the `origin` given to `apply`, `undo` or `redo`. */
  readonly origin: unknown
  /** The document after the event. */
  readonly doc: NotaDocument
}

/** What `apply`, `undo` and `redo` of a session are given besides the changes. */
export interface SessionCallOptions {
  /** Who makes the change; it comes back in the event, so a listener can tell its own changes. */
  readonly origin?: unknown
  /** Milliseconds, for grouping; `Date.now()` by default. */
  readonly time?: number
  /** False: the change is a step of its own, and the one that follows it too (a block put in, not typing). */
  readonly group?: boolean
}

/**
 * The interface of a session. It is structural: anything that keeps a text, a Nota document and a history
 * behind these members can be given to an editor.
 */
export interface NotaSession {
  /** The current text. */
  readonly text: string
  /** The Nota document of the current text. */
  readonly doc: NotaDocument
  /** The options the documents are parsed with, when the session knows them. */
  readonly parseOptions?: ParseOptions
  /**
   * Replaces ranges of the text (coordinates of the current text, non-overlapping, in any order) as one step of the
   * history, and tells the listeners.
   *
   * @throws RangeError when a range is not `0 <= from <= to <= text.length` of the current text, or when two ranges
   * overlap; nothing changes. The message names the ranges and the length of the text.
   * @throws TypeError when `insert` of a change is not a string; the message names the field and the type it got.
   */
  apply(changes: readonly TextChange[], options?: SessionCallOptions): void
  /** Undoes the last step; false when there is none. */
  undo(options?: SessionCallOptions): boolean
  /** Redoes the last undone step; false when there is none. */
  redo(options?: SessionCallOptions): boolean
  readonly canUndo: boolean
  readonly canRedo: boolean
  /** Listens to every change of the text; returns the function that stops it. */
  subscribe(listener: (event: SessionEvent) => void): () => void
}

/** Options of {@link createSession}. */
export interface SessionOptions {
  /** Options of the Nota parser. */
  readonly parse?: ParseOptions
  /** Steps of one origin closer than this (ms) and next to each other are one step. Default 500. */
  readonly groupDelay?: number
  /** The most steps kept. Default 10 000. */
  readonly depth?: number
}

interface Step {
  /** Replaces the text after the step with the text before it. */
  undo: Change[]
  /** Replaces the text before the step with the text after it. */
  redo: Change[]
  origin: unknown
  time: number
  /** The range the step touched, in coordinates of the text after it; null for a step of several ranges. */
  range: { from: number; to: number } | null
}

class Session implements NotaSession {
  doc: NotaDocument
  private past: Step[] = []
  /** An undo or redo just happened: typing after it starts a new step, as in the history of CodeMirror. */
  private afterHistory = false
  private future: Step[] = []
  private listeners = new Set<(event: SessionEvent) => void>()

  constructor(
    text: string,
    readonly parseOptions: ParseOptions,
    private readonly groupDelay: number,
    private readonly depth: number,
  ) {
    this.doc = parse(text, parseOptions)
  }

  get text(): string {
    return this.doc.text
  }
  get canUndo(): boolean {
    return this.past.length > 0
  }
  get canRedo(): boolean {
    return this.future.length > 0
  }

  subscribe(listener: (event: SessionEvent) => void): () => void {
    this.listeners.add(listener)
    return () => void this.listeners.delete(listener)
  }

  private emit(event: SessionEvent): void {
    let failure: unknown
    let failed = false
    for (const l of [...this.listeners]) {
      try {
        l(event)
      } catch (e) {
        if (!failed) {
          failed = true
          failure = e
        }
      }
    }
    if (failed) throw failure
  }

  /**
   * Applies normalized replacements to the text, lets `record` update the history with the replacement that
   * undoes them, then tells the listeners (who see the history as it is after the event).
   */
  private replace(
    set: readonly Change[],
    kind: SessionEvent['kind'],
    origin: unknown,
    record: (undo: Change[]) => void,
  ): void {
    const before = this.doc.text
    const next = this.doc.update(set)
    const undo = invertChanges(set, before)
    this.doc = next
    record(undo)
    this.emit({ kind, changes: set, origin, doc: next })
  }

  apply(changes: readonly TextChange[], options: SessionCallOptions = {}): void {
    // throws on invalid or overlapping ranges, before anything changes
    const set = normalizeTextChanges(changes, this.doc.text.length)
    if (set.length === 0) return
    const time = options.time ?? Date.now()
    const origin = options.origin
    const last = this.past[this.past.length - 1]
    const touched = set.length === 1 ? set[0]! : null
    // typing: the same origin, soon after the last step and next to what it left
    const joins =
      options.group !== false &&
      !this.afterHistory &&
      !!last &&
      !!last.range &&
      !!touched &&
      last.origin === origin &&
      time - last.time < this.groupDelay &&
      time >= last.time &&
      touched.from <= last.range.to &&
      touched.to >= last.range.from
    this.afterHistory = false
    this.replace(set, 'apply', origin, (undo) => {
      let after = 0
      let range: { from: number; to: number } | null = null
      for (const c of set) {
        range = { from: c.from + after, to: c.from + after + c.insert.length }
        after += c.insert.length - (c.to - c.from)
      }
      if (set.length !== 1) range = null
      this.future = []
      if (joins && last && last.range && range) {
        last.redo = composeChanges(last.redo, set)
        last.undo = composeChanges(undo, last.undo)
        last.range = {
          from: Math.min(mapOffset(set, last.range.from, -1), range.from),
          to: Math.max(mapOffset(set, last.range.to, 1), range.to),
        }
        last.time = time
      } else {
        this.past.push({ undo, redo: [...set], origin, time, range })
        if (this.past.length > this.depth) this.past.shift()
      }
    })
    if (options.group === false) this.afterHistory = true
  }

  undo(options: SessionCallOptions = {}): boolean {
    const step = this.past.pop()
    if (!step) return false
    this.afterHistory = true
    this.replace(step.undo, 'undo', options.origin, (redo) => {
      this.future.push({ ...step, redo })
    })
    return true
  }

  redo(options: SessionCallOptions = {}): boolean {
    const step = this.future.pop()
    if (!step) return false
    this.afterHistory = true
    this.replace(step.redo, 'redo', options.origin, (undo) => {
      this.past.push({ ...step, undo })
    })
    return true
  }
}

/**
 * Creates a session on a text: the text, its document and one undo history, shared by everything that edits or shows it.
 *
 * @example
 * ```ts
 * const session = createSession('Hello\n')
 * session.subscribe((event) => console.log(event.kind, event.changes))
 * session.apply([{ from: 5, insert: ' world' }])
 * session.text // 'Hello world\n'
 * session.undo() // true; the text is 'Hello\n' again
 * ```
 */
export function createSession(text = '', options: SessionOptions = {}): NotaSession {
  return new Session(text, options.parse ?? {}, options.groupDelay ?? 500, options.depth ?? 10_000)
}
