/**
 * The line-level preprocessor of Asciidoctor's PreprocessorReader: conditional directives (`ifdef`,
 * `ifndef`, `ifeval`, `endif`) decide which lines exist; `include::` lines are recognised and dropped from
 * the stream of lines (the resolver of includes is a later stage). Lines and directives are read lazily,
 * in the order the block parser asks for them, with the attributes of that moment.
 */
import { rstrip } from './rx.js'

/** One open conditional (`ifdef::a[]` … `endif::[]`); a persistent stack, compared by content. */
export interface Cond {
  readonly parent: Cond | null
  readonly name: string
  /** Lower-cased target (empty for `ifeval`). */
  readonly target: string
  /** Whether the reader skips lines after this directive (also true while an outer one skips). */
  readonly skipping: boolean
  readonly depth: number
  readonly hash: number
}

function hashCond(parent: Cond | null, name: string, target: string, skipping: boolean): number {
  let h = ((parent?.hash ?? 5381) * 33) >>> 0
  const s = `${name}\u0000${target}\u0000${skipping ? 1 : 0}`
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) >>> 0
  return h
}

export function pushCond(parent: Cond | null, name: string, target: string, skipping: boolean): Cond {
  return {
    parent,
    name,
    target,
    skipping,
    depth: (parent?.depth ?? 0) + 1,
    hash: hashCond(parent, name, target, skipping),
  }
}

export function condEqual(a: Cond | null, b: Cond | null): boolean {
  while (a !== b) {
    if (a === null || b === null) return false
    if (a.hash !== b.hash || a.name !== b.name || a.target !== b.target || a.skipping !== b.skipping)
      return false
    a = a.parent
    b = b.parent
  }
  return true
}

/** The parts of a conditional directive line, as offsets in the (stripped) line. */
export interface DirectiveMatch {
  escaped: boolean
  name: string
  /** Offset of the name and of the target in the line, and the target itself. */
  nameFrom: number
  targetFrom: number
  target: string
  /** The first of `,` and `+` in the target, if any. */
  delimiter: string | null
  /** Offset of the text between the brackets, and the text (null when empty). */
  textFrom: number
  text: string | null
}

/**
 * ConditionalDirectiveRx `^(\\)?(ifdef|ifndef|ifeval|endif)::(\S*?(?:([,+])\S*?)?)\[(.+)?\]$`, in linear
 * time: the target runs to the first `[`, must not contain white space, and the line must end with `]`.
 */
export function matchConditional(line: string): DirectiveMatch | null {
  const escaped = line.charCodeAt(0) === 92
  const at = escaped ? 1 : 0
  let name: string | null = null
  for (const n of ['ifdef', 'ifndef', 'ifeval', 'endif']) {
    if (line.startsWith(n, at) && line.startsWith('::', at + n.length)) {
      name = n
      break
    }
  }
  if (name === null || !line.endsWith(']')) return null
  const targetFrom = at + name.length + 2
  const open = line.indexOf('[', targetFrom)
  if (open < 0 || open >= line.length - 1) return null
  const target = line.slice(targetFrom, open)
  for (let i = 0; i < target.length; i++) if (/\s/u.test(target[i]!)) return null
  const dm = /[,+]/.exec(target)
  const text = line.slice(open + 1, line.length - 1)
  return {
    escaped,
    name,
    nameFrom: at,
    targetFrom,
    target,
    delimiter: dm ? dm[0] : null,
    textFrom: open + 1,
    text: text.length ? text : null,
  }
}

export interface IncludeMatch {
  escaped: boolean
  nameFrom: number
  targetFrom: number
  target: string
  attrsFrom: number
  attrs: string | null
}

/** IncludeDirectiveRx `^(\\)?include::([^\s\[](?:[^\[]*[^\s\[])?)\[(.+)?\]$`, in linear time. */
export function matchInclude(line: string): IncludeMatch | null {
  const escaped = line.charCodeAt(0) === 92
  const at = escaped ? 1 : 0
  if (!line.startsWith('include::', at) || !line.endsWith(']')) return null
  const targetFrom = at + 9
  const open = line.indexOf('[', targetFrom)
  if (open < 0 || open >= line.length - 1 || open === targetFrom) return null
  const target = line.slice(targetFrom, open)
  if (/\s/u.test(target[0]!) || /\s/u.test(target[target.length - 1]!)) return null
  const attrs = line.slice(open + 1, line.length - 1)
  return {
    escaped,
    nameFrom: at,
    targetFrom,
    target,
    attrsFrom: open + 1,
    attrs: attrs.length ? attrs : null,
  }
}

/** EvalExpressionRx `^(.+?) *([=!><]=|[><]) *(.+)$`, in linear time (the first operator that fits). */
export function matchEval(expr: string): { lhs: string; op: string; rhs: string } | null {
  for (let i = 1; i < expr.length; i++) {
    const c = expr.charCodeAt(i)
    const ops: string[] = []
    if ((c === 61 || c === 33 || c === 62 || c === 60) && expr.charCodeAt(i + 1) === 61)
      ops.push(expr.slice(i, i + 2))
    if (c === 62 || c === 60) ops.push(expr[i]!)
    for (const op of ops) {
      // the left side is `.+?` followed by spaces: skip back over the spaces
      let lend = i
      while (lend > 0 && expr.charCodeAt(lend - 1) === 32) lend--
      if (lend === 0) continue
      let rstart = i + op.length
      while (rstart < expr.length && expr.charCodeAt(rstart) === 32) rstart++
      if (rstart >= expr.length) continue
      return { lhs: expr.slice(0, lend), op, rhs: expr.slice(rstart) }
    }
  }
  return null
}

/** Reader#resolve_expr_val: the value of one side of an `ifeval` expression. */
export function resolveExprValue(val: string, sub: (s: string) => string): string | number | boolean | null {
  let quoted = false
  if (
    val.length >= 1 &&
    ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
  ) {
    quoted = true
    val = val.slice(1, val.length - 1 < 0 ? 0 : val.length - 1)
  }
  if (val.includes('{')) val = sub(val)
  if (quoted) return val
  if (val === '') return null
  if (val === 'true') return true
  if (val === 'false') return false
  if (rstrip(val) === '') return ' '
  if (val.includes('.')) return rubyToF(val)
  return rubyToI(val)
}

function rubyToI(s: string): number {
  const m = /^[ \t\n\v\f\r]*([+-]?\d[\d_]*)/.exec(s)
  return m ? parseInt(m[1]!.replace(/_/g, ''), 10) : 0
}

function rubyToF(s: string): number {
  const m = /^[ \t\n\v\f\r]*([+-]?\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?)/.exec(s)
  return m ? parseFloat(m[1]!.replace(/_/g, '')) : 0
}

/**
 * Evaluates `lhs op rhs` with Ruby's semantics for the operands `resolveExprValue` yields. Comparing
 * values of different types raises in Ruby (which makes the condition false); `==` and `!=` never raise.
 */
export function evalComparison(
  l: string | number | boolean | null,
  op: string,
  r: string | number | boolean | null,
): boolean {
  if (op === '==') return rubyEquals(l, r)
  if (op === '!=') return !rubyEquals(l, r)
  const bothNum = typeof l === 'number' && typeof r === 'number'
  const bothStr = typeof l === 'string' && typeof r === 'string'
  if (!bothNum && !bothStr) return false
  const c = bothNum ? (l as number) - (r as number) : rubyCompareStrings(l as string, r as string)
  if (Number.isNaN(c)) return false
  switch (op) {
    case '<':
      return c < 0
    case '>':
      return c > 0
    case '<=':
      return c <= 0
    case '>=':
      return c >= 0
  }
  return false
}

function rubyEquals(l: unknown, r: unknown): boolean {
  return l === r
}

/** Byte-wise comparison of UTF-8 strings, which is code point order. */
function rubyCompareStrings(a: string, b: string): number {
  const ia = a[Symbol.iterator]()
  const ib = b[Symbol.iterator]()
  for (;;) {
    const x = ia.next()
    const y = ib.next()
    if (x.done && y.done) return 0
    if (x.done) return -1
    if (y.done) return 1
    const cx = x.value.codePointAt(0)!
    const cy = y.value.codePointAt(0)!
    if (cx !== cy) return cx < cy ? -1 : 1
  }
}
