import { Type } from '../nodes.js'
import { parseAttributeList } from './attrlist.js'
import { type N, clean, leaf, rawNode } from './build.js'
import {
  type Cond,
  type DirectiveMatch,
  type IncludeMatch,
  evalComparison,
  matchConditional,
  matchEval,
  matchInclude,
  pushCond,
  resolveExprValue,
} from './preprocessor.js'
import { rstrip } from './rx.js'
import { subAttributes } from './attrs.js'

/**
 * A line as the block parser sees it: the text is what Asciidoctor matches (trailing white space
 * stripped), the offsets tell where the line lives in the source.
 */
export interface Ln {
  /** Start of the raw line in the source (where a unit that starts at this line starts). */
  readonly raw: number
  /** Start of the text: after a quote marker `> `, an escape `\`, or the `ifdef::a[` of a one-line condition. */
  readonly from: number
  /** End of the stripped text. */
  readonly end: number
  /** Start of the next raw line (after the LF), or the end of the source. */
  readonly next: number
  /** Start of the line terminator (CR LF or LF); `next` if there is none. */
  readonly nl: number
  readonly text: string
  /** 1: the placeholder of a list continuation `+` (reads as a blank line). */
  readonly kind: 0 | 1
}

export function mkLn(
  raw: number,
  from: number,
  text: string,
  nl: number,
  next: number,
  kind: 0 | 1 = 0,
  end = from + text.length,
): Ln {
  return { raw, from, end, next, nl, text, kind }
}

/** A read-only sequence of lines with random access. */
export abstract class LineReader {
  abstract has(k: number): boolean
  abstract ln(k: number): Ln
  /** The lines `[from, to)` (all read already) as a reader of their own. */
  abstract slice(from: number, to: number): ArrayReader

  get(k: number): string {
    return this.ln(k).text
  }

  /** Text of line `k`, or '' past the end. */
  peek(k: number): string {
    return this.has(k) ? this.ln(k).text : ''
  }

  blank(k: number): boolean {
    return this.ln(k).text.length === 0
  }

  start(k: number): number {
    return this.ln(k).from
  }

  contentEnd(k: number): number {
    return this.ln(k).end
  }

  next(k: number): number {
    return this.ln(k).next
  }

  newlineStart(k: number): number {
    return this.ln(k).nl
  }
}

/** Lines held in an array (a view of a range of it), for the contents of containers. */
export class ArrayReader extends LineReader {
  constructor(
    readonly arr: readonly Ln[],
    readonly lo: number,
    readonly hi: number,
  ) {
    super()
  }

  has(k: number): boolean {
    return k >= 0 && this.lo + k < this.hi
  }

  ln(k: number): Ln {
    if (!this.has(k)) throw new RangeError(`line ${k} out of range`)
    return this.arr[this.lo + k]!
  }

  /** The lines `[from, to)` of this reader as a reader of their own (no copy). */
  slice(from: number, to: number): ArrayReader {
    return new ArrayReader(this.arr, this.lo + from, this.lo + to)
  }
}

/** A position in a reader, with the stream operations Asciidoctor's Reader has. */
export class Cur {
  constructor(
    readonly L: LineReader,
    public i = 0,
  ) {}

  has(): boolean {
    return this.L.has(this.i)
  }

  /** The next line, without reading it. */
  peek(): Ln | undefined {
    return this.L.has(this.i) ? this.L.ln(this.i) : undefined
  }

  /** The text of the next line, without reading it. */
  peekText(): string | undefined {
    return this.L.has(this.i) ? this.L.get(this.i) : undefined
  }

  read(): Ln | undefined {
    if (!this.L.has(this.i)) return undefined
    return this.L.ln(this.i++)
  }

  shift(): void {
    this.i++
  }

  unshift(): void {
    this.i--
  }
}

export interface PreDiagnostic {
  readonly from: number
  readonly to: number
  readonly severity: 'error' | 'warning' | 'info'
  readonly code: string
  readonly message: string
}

/** A conditional opened or closed by a directive at a raw offset (used for the unterminated-conditional diagnostics). */
export interface CondEvent {
  readonly pos: number
  /** End of the directive text, for the diagnostic range. */
  readonly end: number
  readonly open: boolean
  readonly name: string
  readonly target: string
  readonly text: string | null
}

/** Something the preprocessor took out of the stream of lines. */
export interface Hidden {
  readonly from: number
  to: number
  readonly kind: 'disabled' | 'directive' | 'include'
  /** Directive: offset in the source of the first character of the directive text. */
  readonly base?: number
  readonly cond?: DirectiveMatch
  readonly inc?: IncludeMatch
  /** For a one-line condition that yields its text: the hidden part ends before the text. */
  readonly prefixOnly?: boolean
  readonly nl?: number
  readonly lineEnd?: number
}

/** What the preprocessor needs to know about the document while it reads. */
export interface PreEnv {
  has(name: string): boolean
  get(name: string): string | undefined
}

interface CondLogEntry {
  readonly pos: number
  readonly cond: Cond | null
}

/**
 * The lines of the document text from `base`, after the preprocessor: lines of conditionals that are off
 * and the directive lines are not part of the sequence; they are kept as {@link Hidden} ranges so that the
 * tree can hold them. Lines are produced lazily, in the order the parser asks for them; every access is
 * recorded so a parse can tell how far ahead it looked.
 */
export class SourceLines extends LineReader {
  readonly visible: Ln[] = []
  readonly hidden: Hidden[] = []
  readonly diagnostics: PreDiagnostic[] = []
  readonly events: CondEvent[] = []
  private readonly condLog: CondLogEntry[] = []
  private cond: Cond | null
  private scanPos: number
  private done = false
  private eofTouched = false
  private peeked = 0
  private lastNoTerminator = false
  /** Whether directives are processed for the lines read next (false while a comment block is read). */
  processing = true

  constructor(
    readonly text: string,
    readonly base: number,
    private readonly startCond: Cond | null,
    private readonly env: PreEnv,
  ) {
    super()
    this.cond = startCond
    this.scanPos = base
    if (base === 0 && text.charCodeAt(0) === 0xfeff) this.scanPos = 1
    if (this.scanPos >= text.length) this.done = true
  }

  has(k: number): boolean {
    while (this.visible.length <= k && !this.done) this.step()
    if (k < this.visible.length && k >= 0) return true
    this.eofTouched = true
    return false
  }

  ln(k: number): Ln {
    if (!this.has(k)) throw new RangeError(`line ${k} out of range`)
    return this.visible[k]!
  }

  /** The lines `[from, to)` (all read already) as a reader of their own. */
  slice(from: number, to: number): ArrayReader {
    return new ArrayReader(this.visible, from, to)
  }

  /** The conditionals that are open before the raw offset `pos` is read. */
  condBefore(pos: number): Cond | null {
    const log = this.condLog
    let lo = 0
    let hi = log.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (log[mid]!.pos < pos) lo = mid + 1
      else hi = mid
    }
    return lo === 0 ? this.startCond : log[lo - 1]!.cond
  }

  /** How many lines are read. */
  mark(): number {
    return this.visible.length
  }

  /**
   * Takes back the lines read since `mark`, which were read raw: Asciidoctor peeks lines that way and puts them
   * back, and they are read again, with the directives processed, when the parser gets to them.
   */
  rewind(mark: number): void {
    if (this.visible.length <= mark) return
    this.peeked = Math.max(this.peeked, this.scanPos)
    if (this.done && this.lastNoTerminator) this.eofTouched = true
    this.scanPos = this.visible[mark]!.raw
    this.visible.length = mark
    this.done = false
    this.lastNoTerminator = false
  }

  /** Offset up to which the text was examined (exclusive); past the end if the end was reached. */
  lookAhead(): number {
    if (this.eofTouched) return this.text.length + 1
    if (this.done && this.lastNoTerminator) return this.text.length + 1
    return Math.max(this.scanPos, this.peeked)
  }

  private step(): void {
    const text = this.text
    const start = this.scanPos
    const lf = text.indexOf('\n', start)
    const brk = lf < 0 ? text.length : lf
    const next = lf < 0 ? text.length : lf + 1
    this.scanPos = next
    if (next >= text.length) {
      this.done = true
      this.lastNoTerminator = lf < 0
    }
    const line = rstrip(text.slice(start, brk))
    const contentEnd = start + line.length
    const nl = brk > contentEnd && text.charCodeAt(brk - 1) === 13 ? brk - 1 : brk
    this.process(start, start, line, nl, next)
  }

  private get skipping(): boolean {
    return this.cond !== null && this.cond.skipping
  }

  private logCond(pos: number): void {
    this.condLog.push({ pos, cond: this.cond })
  }

  /** Port of PreprocessorReader#process_line for one line (a one-line condition feeds its text back in). */
  private process(raw: number, from: number, line: string, nl: number, next: number): void {
    for (;;) {
      if (!this.processing) return this.emit(raw, from, line, nl, next)
      if (line.length === 0) {
        if (this.skipping) return this.hide(raw, next, 'disabled')
        return this.emit(raw, from, line, nl, next)
      }
      if (
        line.charCodeAt(line.length - 1) === 93 /* ] */ &&
        line.charCodeAt(0) !== 91 &&
        line.includes('::')
      ) {
        if (line.includes('if')) {
          const m = matchConditional(line)
          if (m) {
            if (m.escaped) return this.emitEscaped(raw, from, line, nl, next)
            const text = this.conditional(from, line, m, nl, next)
            if (text === null) return
            // a one-line condition that holds: its text is read as a line in place of the directive
            from = from + m.textFrom
            line = rstrip(text)
            // the text is not read as a directive again, unless it looks like an include (`@look_ahead -= 1`)
            if (!text.startsWith('include::')) return this.emit(raw, from, line, nl, next)
            continue
          }
        }
        if (this.skipping) return this.hide(raw, next, 'disabled')
        if (line.startsWith('inc') || line.startsWith('\\inc')) {
          const m = matchInclude(line)
          if (m) {
            if (m.escaped) return this.emitEscaped(raw, from, line, nl, next)
            this.hidden.push({
              from,
              to: next,
              kind: 'include',
              base: from,
              inc: m,
              nl,
              lineEnd: from + line.length,
            })
            return
          }
        }
        return this.emit(raw, from, line, nl, next)
      }
      if (this.skipping) return this.hide(raw, next, 'disabled')
      return this.emit(raw, from, line, nl, next)
    }
  }

  private emit(raw: number, from: number, line: string, nl: number, next: number): void {
    this.visible.push(mkLn(raw, from, line, nl, next))
  }

  /** An escaped directive is a line of text without its backslash (a Mark in the tree). */
  private emitEscaped(raw: number, from: number, line: string, nl: number, next: number): void {
    this.visible.push(mkLn(raw, from + 1, line.slice(1), nl, next))
  }

  private hide(from: number, to: number, kind: 'disabled'): void {
    const last = this.hidden[this.hidden.length - 1]
    if (last && last.kind === kind && last.to === from) last.to = to
    else this.hidden.push({ from, to, kind })
  }

  private diag(
    from: number,
    to: number,
    severity: PreDiagnostic['severity'],
    code: string,
    message: string,
  ): void {
    this.diagnostics.push({ from, to, severity, code, message })
  }

  private sub(text: string): string {
    return subAttributes(text, (n) => this.env.get(n), 'drop')
  }

  /**
   * PreprocessorReader#preprocess_conditional_directive. Records the directive as hidden; returns the
   * text of a one-line condition that holds (to be read as a line), otherwise null.
   */
  private conditional(
    from: number,
    line: string,
    m: DirectiveMatch,
    nl: number,
    next: number,
  ): string | null {
    const name = m.name
    const noTarget = m.target.length === 0
    const target = noTarget ? '' : m.target.toLowerCase()
    const text = m.text
    const lineEnd = from + line.length
    const record = (prefixOnly = false) =>
      this.hidden.push({
        from,
        to: prefixOnly ? from + m.textFrom : next,
        kind: 'directive',
        base: from,
        cond: m,
        prefixOnly,
        nl,
        lineEnd,
      })
    const err = (msg: string) => this.diag(from, lineEnd, 'error', 'malformed-directive', msg)
    if (name === 'endif') {
      if (text !== null) {
        err(`Malformed preprocessor directive: text not permitted in endif::${target}[${text}]`)
      } else if (this.cond === null) {
        this.diag(
          from,
          lineEnd,
          'error',
          'unmatched-endif',
          `Unmatched preprocessor directive: endif::${target}[]`,
        )
      } else if (noTarget || target === this.cond.target) {
        this.events.push({ pos: from, end: lineEnd, open: false, name, target, text })
        this.cond = this.cond.parent
        this.logCond(from)
      } else {
        this.diag(
          from,
          lineEnd,
          'error',
          'unmatched-endif',
          `Mismatched preprocessor directive: endif::${target}[], expected endif::${this.cond.target}[]`,
        )
      }
      record()
      return null
    }
    let skip: boolean
    if (this.skipping) {
      if (name === 'ifeval') {
        if (!(noTarget && text !== null && matchEval(text.trim()))) {
          record()
          return null
        }
      } else if (noTarget) {
        record()
        return null
      }
      skip = false
    } else if (name === 'ifdef' || name === 'ifndef') {
      if (noTarget) {
        err(`Malformed preprocessor directive: missing target in ${name}::[${text ?? ''}]`)
        record()
        return null
      }
      const has = (n: string) => this.env.has(n)
      if (name === 'ifdef') {
        if (m.delimiter === ',') skip = !target.split(',').some(has)
        else if (m.delimiter === '+') skip = target.split('+').some((n) => !has(n))
        else skip = !has(target)
      } else if (m.delimiter === ',') skip = target.split(',').some(has)
      else if (m.delimiter === '+') skip = target.split('+').every(has)
      else skip = has(target)
    } else {
      // ifeval
      if (!noTarget) {
        err(`Malformed preprocessor directive: target not permitted in ifeval::${target}[${text ?? ''}]`)
        record()
        return null
      }
      const ev = text !== null ? matchEval(text.trim()) : null
      if (!ev) {
        err(
          text !== null
            ? `Malformed preprocessor directive: invalid expression in ifeval::[${text}]`
            : 'Malformed preprocessor directive: missing expression in ifeval::[]',
        )
        record()
        return null
      }
      const sub = (s: string) => this.sub(s)
      skip = !evalComparison(resolveExprValue(ev.lhs, sub), ev.op, resolveExprValue(ev.rhs, sub))
    }
    if (name === 'ifeval' || text === null) {
      // a conditional block
      const skipping = this.skipping || skip
      this.events.push({ pos: from, end: lineEnd, open: true, name, target, text })
      this.cond = pushCond(this.cond, name, target, skipping)
      this.logCond(from)
      record()
      return null
    }
    // a one-line condition: the text stands in for the directive when it holds
    if (this.skipping || skip) {
      record()
      return null
    }
    record(true)
    return text
  }
}

/** Nodes of the parts of the text the preprocessor took out of the stream of lines. */
export function hiddenNode(h: Hidden): N {
  if (h.kind === 'disabled') return leaf(Type.DisabledLines, h.from, h.to)
  const base = h.base!
  if (h.kind === 'include') {
    const m = h.inc!
    const t = base + m.targetFrom
    const children: (N | null)[] = [
      leaf(Type.DirectiveName, base + m.nameFrom, base + m.nameFrom + 7),
      leaf(Type.DirectiveTarget, t, t + m.target.length),
    ]
    if (m.attrs !== null) {
      const ab = base + m.attrsFrom
      for (const item of parseAttributeList(m.attrs)) {
        if (item.to <= item.from) continue
        if (item.name !== undefined) {
          children.push(
            rawNode(
              Type.NamedAttribute,
              ab + item.from,
              ab + item.to,
              clean([
                leaf(Type.AttributeName, ab + item.nameFrom!, ab + item.nameTo!),
                leaf(Type.AttributeValue, ab + item.valueFrom!, ab + item.valueTo!),
              ]),
            ),
          )
        } else children.push(leaf(Type.PositionalAttribute, ab + item.from, ab + item.to))
      }
    }
    children.push(h.nl! < h.to ? leaf(Type.Newline, h.nl!, h.to) : null)
    return rawNode(Type.IncludeDirective, h.from, h.to, clean(children))
  }
  const m = h.cond!
  const t = base + m.targetFrom
  const children: (N | null)[] = [
    leaf(Type.DirectiveName, base + m.nameFrom, base + m.nameFrom + m.name.length),
  ]
  if (m.target.length) children.push(leaf(Type.DirectiveTarget, t, t + m.target.length))
  if (m.text !== null && !h.prefixOnly)
    children.push(leaf(Type.DirectiveText, base + m.textFrom, base + m.textFrom + m.text.length))
  if (!h.prefixOnly && h.nl! < h.to) children.push(leaf(Type.Newline, h.nl!, h.to))
  return rawNode(Type.Directive, h.from, h.to, clean(children))
}
