/**
 * The session of a tab: a mirror of the VS Code document. It is a `NotaSession` without a history of its own.
 *
 * `apply` changes the text of the tab at once and collects what is typed in one place; the host gets it as one edit after
 * a pause (about 300 ms), when the cursor leaves the place, and before a command, an undo, a save or a lost focus.
 * `undo` and `redo` ask the host: the undo stack is the one of the VS Code document, shared with the text editors.
 * What the host says (`update`) comes in as events: `apply` for an edit of another source, `undo` and `redo` (with the
 * origin of the editor that asked) for the steps of the history, so the cursor lands where the step was.
 */
import {
  type Change,
  type NotaDocument,
  type NotaSession,
  type SessionCallOptions,
  type SessionEvent,
  type TextChange,
  composeChanges,
  parse,
} from '@nota-adoc/core'
import type { ChangeReason, ToHost } from '../protocol.js'

export interface MirrorOptions {
  readonly text: string
  readonly version: number
  /** Sends a message to the host. */
  readonly send: (message: ToHost) => void
  /** The pause that closes a group of typing, in ms. Default 300. */
  readonly groupDelay?: number
  /** The longest an edit is held while a person types without a pause, in ms. Default 800. */
  readonly maxHold?: number
  /** True while an input method composes: nothing is sent then. */
  readonly composing?: () => boolean
  /** Typed text was dropped because the document changed under it. */
  readonly onStale?: () => void
  readonly now?: () => number
}

/** Sorted, valid, non-overlapping, empty ones dropped, the ones that touch joined. */
function normalize(changes: readonly TextChange[], length: number): Change[] {
  const list = changes.map((c) => ({ from: c.from, to: c.to ?? c.from, insert: c.insert ?? '' }))
  for (const c of list)
    if (!(c.from >= 0 && c.from <= c.to && c.to <= length)) throw new RangeError(`Invalid change range ${c.from}-${c.to}`)
  list.sort((a, b) => a.from - b.from || a.to - b.to)
  const out: Change[] = []
  for (const c of list) {
    if (c.from === c.to && c.insert === '') continue
    const last = out[out.length - 1]
    if (last && c.from < last.to) throw new RangeError('Overlapping changes')
    if (last && last.to === c.from) out[out.length - 1] = { from: last.from, to: c.to, insert: last.insert + c.insert }
    else out.push(c)
  }
  return out
}

function applyAll(text: string, changes: readonly Change[]): string {
  let out = ''
  let at = 0
  for (const c of changes) {
    out += text.slice(at, c.from) + c.insert
    at = c.to
  }
  return out + text.slice(at)
}

/** The one replacement that turns `a` into `b` (common start and end kept). */
export function diffChange(a: string, b: string): Change | null {
  if (a === b) return null
  let start = 0
  const max = Math.min(a.length, b.length)
  while (start < max && a.charCodeAt(start) === b.charCodeAt(start)) start++
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a.charCodeAt(endA - 1) === b.charCodeAt(endB - 1)) {
    endA--
    endB--
  }
  // do not cut a surrogate pair in two
  if (start > 0 && /[\ud800-\udbff]/.test(a[start - 1]!)) start--
  if (endA < a.length && /[\udc00-\udfff]/.test(a[endA]!)) {
    endA++
    endB++
  }
  return { from: start, to: endA, insert: b.slice(start, endB) }
}

export class Mirror implements NotaSession {
  private current: NotaDocument
  private readonly listeners = new Set<(event: SessionEvent) => void>()
  /** The text the host has (as far as the tab knows) and its version. */
  private confirmed: string
  private version: number
  /** Sent, not answered yet. */
  private inflight: { id: number; changes: Change[] } | null = null
  /** Closed groups not sent yet, each in coordinates of the text after the one before it. */
  private queue: Change[][] = []
  /** The open group, in coordinates of the text after the queue. */
  private open: Change[] = []
  private openSince = 0
  private nextId = 1
  private timer: ReturnType<typeof setTimeout> | null = null
  private idle: (() => void)[] = []
  private undoOrigin: unknown
  private readonly groupDelay: number
  private readonly maxHold: number

  constructor(private readonly options: MirrorOptions) {
    this.current = parse(options.text)
    this.confirmed = options.text
    this.version = options.version
    this.groupDelay = options.groupDelay ?? 300
    this.maxHold = options.maxHold ?? 800
  }

  get text(): string {
    return this.current.text
  }
  get doc(): NotaDocument {
    return this.current
  }
  // the history is the document's, in the host: the tab cannot know whether there is a step
  readonly canUndo = true
  readonly canRedo = true

  subscribe(listener: (event: SessionEvent) => void): () => void {
    this.listeners.add(listener)
    return () => void this.listeners.delete(listener)
  }

  private emit(event: SessionEvent): void {
    let failed = false
    let failure: unknown
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

  private now(): number {
    return (this.options.now ?? Date.now)()
  }

  // ------------------------------------------------------------------ the editor edits

  apply(changes: readonly TextChange[], options: SessionCallOptions = {}): void {
    const set = normalize(changes, this.current.text.length)
    if (set.length === 0) return
    const next = this.current.update(set)
    // typing in one place goes in one group; an edit somewhere else closes the group
    if (this.open.length > 0 && !this.touches(set)) {
      this.closeOpen()
      this.pump()
    }
    if (this.open.length === 0) this.openSince = this.now()
    this.open = composeChanges(this.open, set)
    this.current = next
    this.arm()
    this.emit({ kind: 'apply', changes: set, origin: options.origin, doc: next })
  }

  /** Whether the changes touch the place of the open group (typing continues there). */
  private touches(set: readonly Change[]): boolean {
    if (this.open.length !== 1 || set.length !== 1) return false
    const o = this.open[0]!
    const c = set[0]!
    return c.from <= o.from + o.insert.length && c.to >= o.from
  }

  undo(options: SessionCallOptions = {}): boolean {
    this.history('undo', options)
    return true
  }

  redo(options: SessionCallOptions = {}): boolean {
    this.history('redo', options)
    return true
  }

  private history(type: 'undo' | 'redo', options: SessionCallOptions): void {
    this.undoOrigin = options.origin
    this.whenSent(() => this.options.send({ type }))
  }

  // ------------------------------------------------------------------ sending

  private arm(): void {
    if (this.timer) clearTimeout(this.timer)
    const wait = Math.max(0, Math.min(this.groupDelay, this.openSince + this.maxHold - this.now()))
    this.timer = setTimeout(() => {
      this.timer = null
      if (this.options.composing?.()) {
        // (asked again in a moment: a long hold must not spin the timer)
        this.timer = setTimeout(() => {
          this.timer = null
          this.arm()
        }, 50)
        return
      }
      this.flush()
    }, wait)
  }

  private closeOpen(): void {
    if (this.open.length > 0) this.queue.push(this.open)
    this.open = []
  }

  /** Sends everything collected so far (one edit at a time: the next goes after the answer). */
  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    this.closeOpen()
    this.pump()
  }

  private pump(): void {
    if (this.inflight) return
    const changes = this.queue.shift()
    if (!changes) {
      const waiting = this.idle
      this.idle = []
      for (const f of waiting) f()
      return
    }
    const id = this.nextId++
    this.inflight = { id, changes }
    this.options.send({ type: 'edit', id, baseVersion: this.version, changes })
  }

  /** Runs `then` when the host has everything the tab typed (after the open group is closed and sent). */
  whenSent(then: () => void): void {
    this.flush()
    if (!this.inflight && this.queue.length === 0) then()
    else this.idle.push(then)
  }

  get hasUnsent(): boolean {
    return this.inflight !== null || this.queue.length > 0 || this.open.length > 0
  }

  // ------------------------------------------------------------------ the host speaks

  /** The host took the edit. */
  ack(id: number, version: number): void {
    const sent = this.inflight
    if (!sent || sent.id !== id) return
    this.inflight = null
    this.confirmed = applyAll(this.confirmed, sent.changes)
    this.version = version
    this.pump()
  }

  /** The document changed by another source (or by an undo): the changes are in coordinates of the previous version. */
  update(version: number, changes: readonly Change[], reason: ChangeReason): void {
    if (version !== this.version + 1) {
      this.options.send({ type: 'resync' })
      return
    }
    if (this.hasUnsent) {
      // typed text on a version the document has left: shown again from the document
      const text = applyAll(this.confirmed, changes)
      this.reset(text, version, true)
      return
    }
    this.confirmed = applyAll(this.confirmed, changes)
    this.version = version
    const next = this.current.update(changes)
    const kind = reason ?? 'apply'
    this.current = next
    this.emit({ kind, changes, origin: reason ? this.undoOrigin : 'host', doc: next })
  }

  /** The whole text again; typed text that was not written is dropped (`stale`) and the person is told. */
  reset(text: string, version: number, stale: boolean): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    const dropped = this.hasUnsent
    this.inflight = null
    this.queue = []
    this.open = []
    this.confirmed = text
    this.version = version
    const change = diffChange(this.current.text, text)
    if (change) {
      const next = this.current.update([change])
      this.current = next
      this.emit({ kind: 'apply', changes: [change], origin: 'host', doc: next })
    }
    const waiting = this.idle
    this.idle = []
    for (const f of waiting) f()
    if (stale || dropped) this.options.onStale?.()
  }

  destroy(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.listeners.clear()
  }
}
