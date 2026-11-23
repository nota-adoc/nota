/**
 * Structural comparison of Nota with the references (and of the references with each other).
 *
 * The dumps are trees of blocks (a pre-order list with the nesting depth). Blocks under the document and
 * its sections have reliable start lines and are paired by line; blocks inside other blocks (the content
 * of a delimited block or a list item) are paired by position in their parent, because the line numbers
 * Asciidoctor gives inside nested readers drift (lines the preprocessor drops, lines a list item drops,
 * quotes that restart at line 1). Every pair is compared with its context, its place in the parent and the
 * fields of its kind (lists, items, blocks with delimiters, macros, breaks, Markdown blocks, paragraphs,
 * sections), and its block attributes.
 *
 * A table is one item: its columns, and its rows with the cells (the row and the column a cell starts in,
 * the spans, the alignments, the style, the line and the text of each), and the blocks of the cells with
 * the asciidoc style, which are paired by their position like the blocks of any nested reader.
 *
 * Items are counted, not compared, for exactly two reasons: blocks that hold an `include::` line (the
 * references run in the `secure` mode and read that line as text, Nota keeps it as a directive node);
 * attribute values with references `{…}`. (`later-stage-blocks` is the reason blocks of a stage Nota had
 * not reached yet were left out; every block is read now and it stays at 0.)
 *
 * What is out of scope is decided by the references and by the lines of the text alone. Nota's own view
 * never puts a block out of scope: a block that only one side sees is a difference. The end of a block with
 * delimiters is checked against the text: it closes on the first later line equal to its opening line, or
 * at the end of its container.
 */
import type { DumpCell, DumpEntry, DumpFile, DumpNode, DumpTable, HtmlBlock } from './format.js'
import { explicitNamed, normalizeName } from './nota-dump.js'
import {
  BLOCK_CONTEXTS,
  COMPARE_FIELDS,
  OTHER,
  SHAPE_ATTRS,
  SHAPE_CLASSES,
  SHAPE_TAGS,
  SHAPE_TEXT_HINTS,
  foldKeys,
  inList,
  isShapeKey,
} from '../lib/aggregate.js'

export type Side = 'nota' | 'ruby' | 'js'
export type Kind =
  | 'header'
  | 'section'
  | 'paragraph'
  | 'list'
  | 'item'
  | 'delimited'
  | 'table'
  | 'macro'
  | 'break'
  | 'markdown'
  | 'attributes'
  | 'entries'
  | 'html'
export type OutReason = 'later-stage-blocks' | 'preprocessor-directives' | 'attribute-references'

export const KINDS: readonly Kind[] = [
  'header',
  'section',
  'paragraph',
  'list',
  'item',
  'delimited',
  'table',
  'macro',
  'break',
  'markdown',
  'attributes',
  'entries',
  'html',
]
export const OUT_REASONS: readonly OutReason[] = [
  'later-stage-blocks',
  'preprocessor-directives',
  'attribute-references',
]

export interface Difference {
  file: string
  line: number | null
  kind: Kind
  field: string
  /** Value on the first side (Nota, or Ruby for reference-vs-reference). */
  a: unknown
  /** Value on the second side. */
  b: unknown
  /** Id of the known-differences registry entry that explains it. */
  known?: string
}

/** The HTML of blocks, by the context of the block (see `compareHtml`). */
export type HtmlCounters = Record<
  string,
  { compared: number; matched: number; differences: number; outOfScope: number }
>

export interface PairResult {
  a: Side
  b: Side
  compared: Record<Kind, number>
  matched: Record<Kind, number>
  /** The blocks whose HTML was compared, by context. */
  htmlBlocks: HtmlCounters
  /** How many HTML differences there are of each shape (see `htmlShapes`): only words of fixed lists. */
  htmlShapes?: Record<string, number>
  differences: Difference[]
  known: Difference[]
  outOfScope: Record<OutReason, number>
  errors: string[]
}

export interface FileResult {
  file: string
  pairs: PairResult[]
}

export type HtmlFold = 'table-width' | 'olist-start' | 'olist-type' | 'cell-fill'

export interface RegistryEntry {
  id: string
  /** Pairs of sides the difference is between, e.g. [["ruby", "js"], ["nota", "js"]]; `a` is the first side (none in the entries of the TCK). */
  between?: [Side, Side][]
  /** Entries of `kind: "tck"`: a regular expression tested against the path of the TCK test (`tests/block/list/.*`). */
  test?: string
  /** Regular expression tested against the file the difference was found in. */
  file?: string
  /** Whether the difference is in a block inside a cell with the asciidoc style (any depth). */
  inCell?: boolean
  kind?: Kind | 'tck'
  field?: string
  /** Regular expression tested against JSON.stringify of the block's style (sections and paragraphs). */
  style?: string
  /** Regular expressions tested against JSON.stringify of the values on the two sides. */
  a?: string
  b?: string
  /** `"b<a"`: only when both values are numbers and the one of the entry's second side is less than the first side's. */
  order?: 'b<a'
  /**
   * `kind: "html"` entries: the form of the second side that is taken out of the HTML before the block is
   * compared (see `foldKnown`), so that what differs further in the block is still compared. Such an entry has no
   * `a`/`b` and does not match a difference by itself.
   */
  fold?: HtmlFold
  /**
   * Entries on an object value (the named attributes): the value of the second side is the first side's value
   * plus this key, whose value matches `extraValue`; any other difference is not the entry's.
   */
  extraKey?: string
  extraValue?: string
  description: string
  link: string
}

export interface Registry {
  differences: RegistryEntry[]
}

export const emptyRegistry: Registry = { differences: [] }

const zero = <K extends string>(keys: readonly K[]) =>
  Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>

// ------------------------------------------------------------------ text helpers

/** The lines of a file as Asciidoctor reads them: a leading byte order mark is dropped. */
function sourceLines(text: string): string[] {
  return (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).split('\n')
}

function stripRuby(s: string): string {
  return s.replace(/[\0\t\n\v\f\r ]+$/, '')
}

/** An opening delimiter line of a delimited block, written down independently of Nota's parser. */
const DelimiterLineRx = /^(?:-{4,}|\.{4,}|={4,}|\*{4,}|_{4,}|\+{4,}|\/{4,}|--|`{3}.*|[|!,:]={3,})$/

const DirectiveRx = /^\\?(ifdef|ifndef|ifeval|endif|include)::(\S*?)\[(.*)\]$/

/** The line that closes a delimited block opened by `opening` (a stripped delimiter line). */
const closingLine = (opening: string) => (opening.startsWith('```') ? '```' : opening)

/** A region of the text, in 1-based lines. */
interface Region {
  from: number
  to: number
  /** A conditional area (`ifdef`/`ifndef`/`ifeval` up to its `endif`), as against a one-line directive. */
  conditional?: true
}

/**
 * Areas of conditional directives, up to their endif. A conditional block with a delimiter line that
 * nothing in it closes reaches to the end of the file.
 */
export function preprocessorRegions(text: string): Region[] {
  const lines = sourceLines(text).map(stripRuby)
  const regions: Region[] = []
  const open: number[] = []
  const leavesOpen = (from: number, to: number) => {
    let opening: string | null = null
    for (let n = from; n <= to; n++) {
      const line = lines[n - 1]!
      if (opening === null) {
        if (DelimiterLineRx.test(line)) opening = closingLine(line)
      } else if (line === opening) opening = null
    }
    return opening !== null
  }
  lines.forEach((line, i) => {
    const m = DirectiveRx.exec(line)
    if (!m) return
    const n = i + 1
    const name = m[1]!
    if (name === 'endif') {
      const start = open.pop()
      if (start !== undefined)
        regions.push({ from: start, to: leavesOpen(start + 1, n - 1) ? lines.length : n, conditional: true })
    } else if (name === 'ifeval' || ((name === 'ifdef' || name === 'ifndef') && !m[3])) {
      open.push(n)
    }
  })
  for (const start of open) regions.push({ from: start, to: lines.length, conditional: true })
  return regions
}

/**
 * Where the text closes a delimited block opened on line `from` (1-based): the first later line equal to
 * the opening line (```` ``` ```` for a fence); otherwise the end of the container (`limit`).
 */
function expectedEnd(lines: string[], from: number, limit: number): number {
  const closing = closingLine(stripRuby(lines[from - 1] ?? ''))
  for (let j = from + 1; j <= limit; j++) if (stripRuby(lines[j - 1]!) === closing) return j
  return limit
}

/**
 * Whether the text alone tells where the block opened on line `from` ends, whichever conditions hold: it
 * is not in a conditional area, and no one-line condition between it and the line where it ends has the
 * closing line as its text (the condition decides whether that line is there).
 */
function endIsClear(lines: string[], regions: Region[], from: number, to: number): boolean {
  const inCondition = (n: number) => regions.some((r) => r.conditional && r.from <= n && n <= r.to)
  if (inCondition(from) || inCondition(to)) return false
  const closing = closingLine(stripRuby(lines[from - 1] ?? ''))
  for (let n = from + 1; n <= to; n++) {
    const m = DirectiveRx.exec(stripRuby(lines[n - 1]!))
    if (m && (m[1] === 'ifdef' || m[1] === 'ifndef') && m[3] && stripRuby(m[3]) === closing) return false
  }
  // a condition between the two lines that holds a line equal to the closing line decides where the block ends
  for (const r of regions) {
    if (!r.conditional || r.to < from || r.from > to) continue
    for (let n = Math.max(r.from, from + 1); n <= Math.min(r.to, to); n++)
      if (stripRuby(lines[n - 1] ?? '') === closing) return false
  }
  return true
}

// ------------------------------------------------------------------ trees

/** A block of a dump with its place in the tree. */
interface TNode {
  n: DumpNode
  up: TNode | null
  kids: TNode[]
  /** Index among the children of the parent. */
  idx: number
  /** The last line the block can span (the references give only the first line). */
  extent: number
  /** Whether the line of the block is reliable: everything above it is a section. */
  reliable: boolean
}

function buildTree(d: { nodes?: DumpNode[] }, lastLine: number): { roots: TNode[]; all: TNode[] } {
  const roots: TNode[] = []
  const all: TNode[] = []
  const stack: TNode[] = []
  for (const n of d.nodes ?? []) {
    const depth = n.depth ?? 0
    stack.length = Math.min(stack.length, depth)
    const up = stack[stack.length - 1] ?? null
    const t: TNode = {
      n,
      up,
      kids: [],
      idx: up ? up.kids.length : roots.length,
      extent: n.end ?? lastLine,
      reliable: !up || (up.reliable && up.n.context === 'section'),
    }
    if (up) up.kids.push(t)
    else roots.push(t)
    all.push(t)
    stack.push(t)
  }
  // the extent of a block from a reference: up to the line before the next block that is not inside it
  for (let i = 0; i < all.length; i++) {
    const t = all[i]!
    if (t.n.end !== undefined || t.n.line === null) continue
    if (t.n.context === 'section') {
      t.extent = t.n.line
      continue
    }
    let end = lastLine
    const depth = t.n.depth ?? 0
    for (let j = i + 1; j < all.length; j++) {
      const u = all[j]!
      if ((u.n.depth ?? 0) <= depth && u.n.line !== null) {
        end = Math.max(t.n.line, u.n.line - 1)
        break
      }
    }
    t.extent = end
  }
  return { roots, all }
}

const TABLE = 'table'
const KNOWN_CONTEXTS = new Set([
  'section',
  'floating_title',
  'paragraph',
  'literal',
  'admonition',
  'quote',
  'verse',
  'example',
  'sidebar',
  'open',
  'listing',
  'pass',
  'stem',
  'table',
  'ulist',
  'olist',
  'dlist',
  'colist',
  'list_item',
  'thematic_break',
  'page_break',
])
const LISTS = new Set(['ulist', 'olist', 'dlist', 'colist'])

/** Which counter a block belongs to. */
function kindOf(n: DumpNode, lines: string[]): Kind {
  const c = n.context
  if (c === 'section' || c === 'floating_title') return 'section'
  if (c === TABLE) return 'table'
  if (LISTS.has(c)) return 'list'
  if (c === 'list_item') return 'item'
  if (c === 'thematic_break' || c === 'page_break') return 'break'
  if (!KNOWN_CONTEXTS.has(c)) return 'macro'
  if (n.markdown) return 'markdown'
  if (n.delimited) return 'delimited'
  if (n.line !== null && n.delimited === undefined) {
    const text = stripRuby(lines[n.line - 1] ?? '')
    if (text.startsWith('```') || (c === 'quote' && text.startsWith('> '))) return 'markdown'
    if (DelimiterLineRx.test(text) && c !== 'paragraph') return 'delimited'
  }
  return 'paragraph'
}

// ------------------------------------------------------------------ comparison

/** JSON with the keys of every object in order, so that maps are equal whatever order they were built in. */
function canonical(v: unknown): string {
  return JSON.stringify(v, (_, x) =>
    x && typeof x === 'object' && !Array.isArray(x)
      ? Object.fromEntries(
          Object.entries(x as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
        )
      : x,
  )
}

function eq(x: unknown, y: unknown): boolean {
  return canonical(x) === canonical(y)
}

class Pair {
  readonly r: PairResult
  /** How many cells with the asciidoc style the block being compared is inside. */
  inCell = 0
  constructor(
    readonly file: string,
    a: Side,
    b: Side,
    private readonly registry: Registry,
  ) {
    this.r = {
      a,
      b,
      compared: zero(KINDS),
      matched: zero(KINDS),
      htmlBlocks: {},
      htmlShapes: {},
      differences: [],
      known: [],
      outOfScope: zero(OUT_REASONS),
      errors: [],
    }
  }

  /** Records a difference, or a known one if the registry explains it. */
  private record(
    kind: Kind,
    line: number | null,
    field: string,
    a: unknown,
    b: unknown,
    style?: unknown,
  ): void {
    const d: Difference = { file: this.file, line, kind, field, a, b }
    const known = this.registry.differences.find(
      (e) =>
        e.fold === undefined &&
        e.between?.some(([first, second]) => {
          const forward = first === this.r.a && second === this.r.b
          if (!forward && !(first === this.r.b && second === this.r.a)) return false
          const [va, vb] = forward ? [a, b] : [b, a]
          return (
            (e.extraKey === undefined || extraKeyOnly(va, vb, e.extraKey, e.extraValue)) &&
            (e.file === undefined || new RegExp(e.file, 'u').test(this.file)) &&
            (e.inCell === undefined || e.inCell === this.inCell > 0) &&
            (e.kind === undefined || e.kind === kind) &&
            (e.field === undefined || e.field === field) &&
            (e.style === undefined || new RegExp(e.style, 'u').test(JSON.stringify(style ?? null))) &&
            (e.a === undefined || new RegExp(e.a, 'u').test(JSON.stringify(va))) &&
            (e.b === undefined || new RegExp(e.b, 'u').test(JSON.stringify(vb))) &&
            (e.order === undefined || (typeof va === 'number' && typeof vb === 'number' && vb < va))
          )
        }),
    )
    if (known) this.r.known.push({ ...d, known: known.id })
    else this.r.differences.push(d)
  }

  /** The registry entries with a fold that apply to this pair and the kind of block, with the side whose HTML they fold. */
  folds(context: string): { id: string; fold: HtmlFold; side: 'a' | 'b' }[] {
    const out: { id: string; fold: HtmlFold; side: 'a' | 'b' }[] = []
    for (const e of this.registry.differences) {
      if (e.fold === undefined || (e.field !== undefined && e.field !== context)) continue
      for (const [first, second] of e.between ?? []) {
        if (first === this.r.a && second === this.r.b) out.push({ id: e.id, fold: e.fold, side: 'b' })
        else if (first === this.r.b && second === this.r.a) out.push({ id: e.id, fold: e.fold, side: 'a' })
      }
    }
    return out
  }

  /** A difference of HTML that is nothing but a form of the registry (`fold`): counted as known. */
  knownHtml(line: number | null, field: string, a: unknown, b: unknown, id: string): void {
    this.r.known.push({ file: this.file, line, kind: 'html', field, a, b, known: id })
  }

  item(kind: Kind, line: number | null, fields: [string, unknown, unknown][], style?: unknown): void {
    this.r.compared[kind]++
    let ok = true
    for (const [field, a, b] of fields) {
      if (eq(a, b)) continue
      this.record(kind, line, field, a, b, style)
      ok = false
    }
    if (ok) this.r.matched[kind]++
  }

  /** A difference that is not an item of its own (the counters stay as they are). */
  difference(kind: Kind, line: number | null, field: string, a: unknown, b: unknown): void {
    this.record(kind, line, field, a, b)
  }

  out(reason: OutReason): void {
    this.r.outOfScope[reason]++
  }
}

function compareHeader(p: Pair, a: DumpFile, b: DumpFile, nota: DumpFile | null, lines: string[]): void {
  const ha = a.header!
  const hb = b.header!
  const end = nota?.header?.endLine
  // an `include::` line in the header, or right under it, is read as an author or revision line by the references
  const inHeader = (l: number) => {
    if (end === undefined) return false
    if (l <= end) return true
    for (let n = end + 1; n < l; n++) if (stripRuby(lines[n - 1] ?? '') === '') return false
    return true
  }
  if (end !== undefined && (nota?.includeLines ?? []).some(inHeader)) {
    p.out('preprocessor-directives')
    return
  }
  p.item('header', null, [['title', ha.title, hb.title]])
  if (nota?.header?.attrRefs) {
    p.out('attribute-references')
    return
  }
  p.item('header', null, [
    ['authors', ha.authors, hb.authors],
    ['revision', ha.revision, hb.revision],
  ])
}

/** `:name!:` and `:!name:` unset the attribute whatever value the hook saw. */
function entryKey(e: DumpEntry) {
  const set = e.value !== null && !e.name.startsWith('!') && !e.name.endsWith('!')
  return { name: normalizeName(e.name), set, value: set ? e.value : null, header: e.header }
}

function compareEntry(p: Pair, line: number, x: DumpEntry | undefined, y: DumpEntry | undefined): void {
  if (!x || !y) {
    p.item('entries', line, [
      ['presence', x ? normalizeName(x.name) : null, y ? normalizeName(y.name) : null],
    ])
    return
  }
  const kx = entryKey(x)
  const ky = entryKey(y)
  const fields: [string, unknown, unknown][] = [
    ['name', kx.name, ky.name],
    ['set', kx.set, ky.set],
    ['header', kx.header, ky.header],
  ]
  if ((kx.value ?? '').includes('{') || (ky.value ?? '').includes('{')) p.out('attribute-references')
  else fields.push(['value', kx.value, ky.value])
  p.item('entries', line, fields)
}

/**
 * Entries of the document (paired by line) and of nested readers (paired by order: the lines nested
 * readers report drift). Entries come in document order on every side.
 */
function compareEntries(p: Pair, a: DumpFile, b: DumpFile, slack: (line: number) => number): void {
  const split = (es: DumpEntry[]) => ({
    top: es.filter((e) => !e.nested),
    nested: es.filter((e) => e.nested),
  })
  const sa = split(a.entries ?? [])
  const sb = split(b.entries ?? [])
  const byLine = (es: DumpEntry[]) => {
    const m = new Map<number, DumpEntry>()
    for (const e of es) if (!m.has(e.line)) m.set(e.line, e)
    return m
  }
  for (const { line, x, y } of pairByLine(byLine(sa.top), byLine(sb.top), slack))
    compareEntry(p, line, x ?? undefined, y ?? undefined)
  for (const [x, y] of alignBy(
    sa.nested,
    sb.nested,
    (e) => normalizeName(e.name),
    () => null,
  ))
    compareEntry(p, x?.line ?? y!.line, x ?? undefined, y ?? undefined)
}

/**
 * Pairs two sequences by their labels (a longest common subsequence; among equal ones, pairs whose lines
 * are equal are preferred). The lines of blocks in nested readers are not reliable, so they only break ties.
 */
function alignBy<T>(
  xs: T[],
  ys: T[],
  label: (t: T) => string,
  lineOf: (t: T) => number | null,
): [T | null, T | null][] {
  const out: [T | null, T | null][] = []
  // long sequences that begin and end alike are paired from both ends first
  const big = xs.length * ys.length > 250_000
  let lo = 0
  while (big && lo < xs.length && lo < ys.length && label(xs[lo]!) === label(ys[lo]!)) lo++
  let hx = xs.length
  let hy = ys.length
  while (big && hx > lo && hy > lo && label(xs[hx - 1]!) === label(ys[hy - 1]!)) {
    hx--
    hy--
  }
  for (let k = 0; k < lo; k++) out.push([xs[k]!, ys[k]!])
  const mx = hx - lo
  const my = hy - lo
  if (mx > 0 && my > 0 && mx * my <= 250_000) {
    const w = (i: number, j: number) => {
      const x = xs[lo + i]!
      const y = ys[lo + j]!
      if (label(x) !== label(y)) return -1
      const lx = lineOf(x)
      return lx !== null && lx === lineOf(y) ? 1.01 : 1
    }
    const dp: Float64Array[] = []
    for (let i = 0; i <= mx; i++) dp.push(new Float64Array(my + 1))
    for (let i = mx - 1; i >= 0; i--)
      for (let j = my - 1; j >= 0; j--) {
        const m = w(i, j)
        dp[i]![j] = Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!, m > 0 ? dp[i + 1]![j + 1]! + m : 0)
      }
    let i = 0
    let j = 0
    while (i < mx || j < my) {
      const m = i < mx && j < my ? w(i, j) : -1
      if (m > 0 && Math.abs(dp[i]![j]! - (dp[i + 1]![j + 1]! + m)) < 1e-9) {
        out.push([xs[lo + i]!, ys[lo + j]!])
        i++
        j++
      } else if (j >= my || (i < mx && dp[i + 1]![j]! >= dp[i]![j + 1]!)) {
        out.push([xs[lo + i]!, null])
        i++
      } else {
        out.push([null, ys[lo + j]!])
        j++
      }
    }
  } else {
    for (let k = 0; k < Math.max(mx, my); k++)
      out.push([k < mx ? xs[lo + k]! : null, k < my ? ys[lo + k]! : null])
  }
  for (let k = hx; k < xs.length; k++) out.push([xs[k]!, ys[k - hx + hy]!])
  return out
}

/**
 * Pairs items by their line. Asciidoctor may report a line up to `slack(line)` too large when the
 * preprocessor dropped lines right after it (see DumpFile.hiddenAfter): a reference item without a partner
 * on its own line is taken for the partner of the item on the lines just before it.
 */
function pairByLine<T>(
  a: Map<number, T>,
  b: Map<number, T>,
  slack: (line: number) => number,
): { line: number; x: T | null; y: T | null; refLine: number }[] {
  const out: { line: number; x: T | null; y: T | null; refLine: number }[] = []
  const claimed = new Set<number>()
  for (const line of [...a.keys()].sort((p, q) => p - q)) {
    let refLine = line
    let y = b.get(line) ?? null
    if (!y) {
      for (let k = 1; k <= slack(line); k++) {
        const cand = b.get(line + k)
        if (cand && !a.has(line + k) && !claimed.has(line + k)) {
          y = cand
          refLine = line + k
          break
        }
      }
    }
    if (y) claimed.add(refLine)
    out.push({ line, x: a.get(line)!, y, refLine })
  }
  for (const [line, y] of b)
    if (!claimed.has(line) && !a.has(line)) out.push({ line, x: null, y, refLine: line })
  return out.sort((p, q) => p.line - q.line)
}

function lowerBound(sorted: number[], v: number): number {
  let lo = 0
  let hi = sorted.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (sorted[mid]! < v) lo = mid + 1
    else hi = mid
  }
  return lo
}

interface Scope {
  lines: string[]
  includeLines: number[]
  /** The runs of lines the preprocessor dropped, by their last line: [the line before the run, its length]. */
  runByEnd: Map<number, [number, number]>
  /** Whether the pair is between Nota and a reference (only then the lines of `include::` are known). */
  withNota: boolean
}

/** Whether a block spans an `include::` line. */
function holdsInclude(scope: Scope, t: TNode): boolean {
  if (!scope.withNota || t.n.line === null) return false
  // the lines of nested blocks that a reference reports drift
  if (!t.reliable && t.n.end === undefined) return false
  const from = t.n.start ?? t.n.line
  const k = lowerBound(scope.includeLines, from)
  if (k < scope.includeLines.length && scope.includeLines[k]! <= t.extent) return true
  // Nota drops an include line above a block, the references read it as the first line of the block
  if (t.n.start === undefined) return false
  const run = scope.runByEnd.get(from - 1)
  if (!run) return false
  const j = lowerBound(scope.includeLines, run[0] + 1)
  return j < scope.includeLines.length && scope.includeLines[j]! <= run[0] + run[1]
}

function macroFields(x: DumpNode, y: DumpNode): [string, unknown, unknown][] {
  return [
    ['target', x.target ?? null, y.target ?? null],
    ['macro attributes', explicitNamed(x.named), explicitNamed(y.named)],
  ]
}

const CELL_FIELDS = ['row', 'column', 'colspan', 'rowspan', 'halign', 'valign', 'style', 'line', 'text'] as const
const COLUMN_FIELDS = ['width', 'halign', 'valign', 'style', 'autowidth'] as const

/** The rows of a table with their cells, section by section: [section, row, cells]. */
function rowsOf(t: DumpTable): [string, number, DumpCell[]][] {
  const out: [string, number, DumpCell[]][] = []
  for (const section of ['head', 'body', 'foot'] as const)
    t.rows[section].forEach((cells, i) => out.push([section, i, cells]))
  return out
}

/** The fields in which the layouts of two tables differ (the equal ones are not listed). */
function tableFields(x: DumpTable, y: DumpTable): [string, unknown, unknown][] {
  const f: [string, unknown, unknown][] = []
  if (x.columns.length !== y.columns.length) f.push(['columns', x.columns.length, y.columns.length])
  for (let i = 0; i < Math.min(x.columns.length, y.columns.length); i++)
    for (const k of COLUMN_FIELDS)
      if (!eq(x.columns[i]![k], y.columns[i]![k])) f.push([`column ${k}`, x.columns[i]![k], y.columns[i]![k]])
  for (const section of ['head', 'body', 'foot'] as const)
    if (x.rows[section].length !== y.rows[section].length)
      f.push([`${section} rows`, x.rows[section].length, y.rows[section].length])
  const rx = rowsOf(x)
  const ry = rowsOf(y)
  for (let i = 0; i < Math.min(rx.length, ry.length); i++) {
    const [sx, , cx] = rx[i]!
    const [sy, , cy] = ry[i]!
    if (sx !== sy) continue
    if (cx.length !== cy.length) f.push(['cells', cx.length, cy.length])
    for (let j = 0; j < Math.min(cx.length, cy.length); j++) {
      for (const k of CELL_FIELDS) if (!eq(cx[j]![k], cy[j]![k])) f.push([k, cx[j]![k], cy[j]![k]])
      if ((cx[j]!.blocks === undefined) !== (cy[j]!.blocks === undefined))
        f.push(['asciidoc', cx[j]!.blocks !== undefined, cy[j]!.blocks !== undefined])
    }
  }
  return f
}

/** The blocks of the cells with the asciidoc style, cell by cell, paired by position. */
function compareCellBlocks(
  p: Pair,
  scope: Scope,
  x: DumpTable,
  y: DumpTable,
  parentLine: Map<number, number>,
): void {
  const rx = rowsOf(x)
  const ry = rowsOf(y)
  for (let i = 0; i < Math.min(rx.length, ry.length); i++) {
    if (rx[i]![0] !== ry[i]![0]) continue
    const [cx, cy] = [rx[i]![2], ry[i]![2]]
    for (let j = 0; j < Math.min(cx.length, cy.length); j++) {
      const [bx, by] = [cx[j]!.blocks, cy[j]!.blocks]
      if (!bx || !by) continue
      const [tx, ty] = [buildTree({ nodes: bx }, 0), buildTree({ nodes: by }, 0)]
      p.inCell++
      for (const [a, b] of alignBy(
        tx.roots,
        ty.roots,
        (t) => t.n.context,
        (t) => t.n.line,
      ))
        comparePairOfBlocks(p, scope, a, b, true, parentLine)
      p.inCell--
    }
  }
}

/** Compares one pair of blocks (and, through their children, the blocks in them). */
function comparePairOfBlocks(
  p: Pair,
  scope: Scope,
  x: TNode | null,
  y: TNode | null,
  nested: boolean,
  parentLine: Map<number, number> = new Map(),
): void {
  const nx = x?.n
  const ny = y?.n
  const line = nx?.line ?? ny?.line ?? null
  // what is out of scope: a block that holds an include line, values with references
  if ((x && holdsInclude(scope, x)) || (y && holdsInclude(scope, y))) {
    p.out('preprocessor-directives')
    return
  }
  const kind = kindOf((nx ?? ny)!, scope.lines)
  if (!x || !y) {
    p.item(kind, line, [['presence', nx?.context ?? null, ny?.context ?? null]])
    return
  }
  // an attribute list with a reference (`[{style}]`) may become any style, and the style decides the
  // context and the attributes; the rest of the block is compared as usual
  const refs = nx!.attrRefs === true || ny!.attrRefs === true
  const macroRefs = kind === 'macro' && (nx!.target?.includes('{') || ny!.target?.includes('{'))
  const fields: [string, unknown, unknown][] = []
  if (!refs) fields.push(['context', nx!.context, ny!.context])
  if (!nested) fields.push(['parent', nx!.parent, parentLine.get(ny!.parent) ?? ny!.parent])
  else fields.push(['order', x.idx, y.idx])
  switch (kind) {
    case 'section':
      fields.push(['level', nx!.level, ny!.level], ['title', nx!.title, ny!.title])
      break
    case 'list':
      fields.push(['list level', nx!.list_level, ny!.list_level], ['items', nx!.items, ny!.items])
      break
    case 'item':
      fields.push(
        ['marker', nx!.marker ?? null, ny!.marker ?? null],
        ['checkbox', nx!.checkbox ?? false, ny!.checkbox ?? false],
        ['checked', nx!.checked ?? false, ny!.checked ?? false],
        ['text lines', nx!.text_lines ?? 0, ny!.text_lines ?? 0],
      )
      if (nx!.terms || ny!.terms)
        fields.push([
          'terms',
          (nx!.terms ?? []).map((t) => t?.trim()),
          (ny!.terms ?? []).map((t) => t?.trim()),
        ])
      break
    case 'macro':
      if (!macroRefs) fields.push(...macroFields(nx!, ny!))
      break
    case 'break':
      break
    case 'table':
      if (nx!.table && ny!.table) fields.push(...tableFields(nx!.table, ny!.table))
      else if (nx!.table || ny!.table)
        fields.push(['layout', nx!.table !== undefined, ny!.table !== undefined])
      break
    default:
      if (nx!.lines !== undefined || ny!.lines !== undefined) fields.push(['lines', nx!.lines, ny!.lines])
      if (nx!.context === 'listing' || ny!.context === 'listing')
        fields.push(['language', nx!.language ?? null, ny!.language ?? null])
  }
  p.item(kind, line, fields, nx!.style ?? ny!.style)
  if (refs || macroRefs) {
    p.out('attribute-references')
  }
  if (!refs) {
    p.item('attributes', line, [
      ['style', nx!.style ?? null, ny!.style ?? null],
      ['id', nx!.id ?? null, ny!.id ?? null],
      ['roles', nx!.roles ?? [], ny!.roles ?? []],
      ['options', nx!.options ?? [], ny!.options ?? []],
      ['named', explicitNamed(nx!.named), explicitNamed(ny!.named)],
    ])
  }
  // the blocks in the cells of a table with the asciidoc style, paired by their position
  if (kind === 'table' && nx!.table && ny!.table)
    compareCellBlocks(p, scope, nx!.table, ny!.table, parentLine)
  // the blocks inside, paired by their position
  if (x.kids.length || y.kids.length) {
    for (const [cx, cy] of alignBy(
      x.kids,
      y.kids,
      (t) => t.n.context,
      (t) => t.n.line,
    ))
      comparePairOfBlocks(p, scope, cx, cy, true, parentLine)
  }
}

/** Blocks under the document and its sections, paired by line. */
function compareTop(p: Pair, scope: Scope, a: TNode[], b: TNode[], slack: (line: number) => number): void {
  // sections nest; the blocks in them are compared as if they were all under the document
  const flat = (roots: TNode[]) => {
    const m = new Map<number, TNode>()
    const walk = (list: TNode[]) => {
      for (const t of list) {
        if (t.n.line !== null && !m.has(t.n.line)) m.set(t.n.line, t)
        if (t.n.context === 'section') walk(t.kids)
      }
    }
    walk(roots)
    return m
  }
  // the line of a section title on the second side, as it is on the first (for the parent of its blocks)
  const parentLine = new Map<number, number>()
  for (const { line, x, y, refLine } of pairByLine(flat(a), flat(b), slack)) {
    if (x && y && x.n.context === 'section') parentLine.set(refLine, line)
    comparePairOfBlocks(p, scope, detach(x), detach(y), false, parentLine)
  }
}

/** A section without the blocks under it (they are paired by line as well). */
function detach(t: TNode | null): TNode | null {
  if (!t || t.n.context !== 'section') return t
  return { ...t, kids: [] }
}

/**
 * Where a Nota block with delimiters ends, against where the text closes it: on the first later line
 * equal to its opening line, or at the end of its container. Blocks whose end depends on a condition
 * are not checked.
 */
function compareDelimitedEnds(p: Pair, text: string, all: TNode[]): void {
  const lines = sourceLines(text)
  const regions = preprocessorRegions(text)
  for (const t of all) {
    const n = t.n
    if (!n.delimited || n.line === null || n.end === undefined) continue
    const opening = stripRuby(lines[n.line - 1] ?? '')
    if (!DelimiterLineRx.test(opening)) continue
    // the end of the container: the line before its closing delimiter, or its last line
    let limit = lines.length
    if (lines[limit - 1] === '') limit--
    const up = t.up
    if (up && up.n.end !== undefined && up.n.context !== 'section') {
      // a container that is closed ends one line before its closing delimiter
      const upOpening = stripRuby(lines[(up.n.line ?? 1) - 1] ?? '')
      const upClosed =
        up.n.delimited === true &&
        up.n.end > (up.n.line ?? 1) &&
        stripRuby(lines[up.n.end - 1] ?? '') === closingLine(upOpening)
      limit = Math.min(limit, upClosed ? up.n.end - 1 : up.n.end)
    }
    const expected = expectedEnd(lines, n.line, limit)
    if (!endIsClear(lines, regions, n.line, Math.max(expected, n.end))) continue
    // directives and blank lines after the last line of a block that is not closed are not part of it
    if (
      n.end < expected &&
      lines.slice(n.end, expected).every((l) => stripRuby(l) === '' || DirectiveRx.test(stripRuby(l)))
    )
      continue
    if (n.end !== expected) p.difference(kindOf(n, lines), n.line, 'end', n.end, expected)
  }
}

// ------------------------------------------------------------------ HTML

/** Elements that make a block of the page: white space next to their tags is not shown. */
const BLOCK_TAGS = new Set(
  (
    'address article aside blockquote body caption col colgroup dd details div dl dt figcaption figure footer ' +
    'h1 h2 h3 h4 h5 h6 head header hr html li main nav ol p pre section summary table tbody td tfoot th thead ' +
    'title tr ul !--'
  ).split(' '),
)
const PRE_RX = /<pre\b[^>]*>[\s\S]*?<\/pre>/gi
const TAG_GAP_RX = /<(\/?)(!--|[a-z][a-z0-9]*)\b[^>]*> (?=<(\/?)(!--|[a-z][a-z0-9]*))/gi

/**
 * The HTML with white space folded, so that only differences that show are differences: a run of white space
 * is one space, and it goes away where it lies between two tags of which one is a block element (between two
 * inline elements a space is a space on the page, `</strong> <em>` is not `</strong><em>`); what is inside
 * `<pre>` is left as it is.
 */
export function normalizeHtml(html: string): string {
  const pres: string[] = []
  const folded = html
    .replace(PRE_RX, (m) => {
      pres.push(m)
      return `<!--pre${pres.length - 1}-->`
    })
    .replace(/\s+/g, ' ')
    .replace(TAG_GAP_RX, (m, _c1, n1: string, _c2, n2: string) =>
      BLOCK_TAGS.has(n1.toLowerCase()) || BLOCK_TAGS.has(n2.toLowerCase()) ? m.slice(0, -1) : m,
    )
    .trim()
  return folded.replace(/<!--pre(\d+)-->/g, (_m, i: string) => pres[Number(i)]!)
}

/** The first place two normalized HTML texts differ, as a piece of each. */
export function firstDifference(a: string, b: string): [string, string] {
  let i = 0
  while (i < a.length && i < b.length && a.charCodeAt(i) === b.charCodeAt(i)) i++
  const from = Math.max(0, i - 30)
  return [a.slice(from, i + 50), b.slice(from, i + 50)]
}

/** Whether `b` is `a` and one more key `key` (the value of which matches `valueRx`), and nothing else differs. */
function extraKeyOnly(a: unknown, b: unknown, key: string, valueRx: string | undefined): boolean {
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) || Array.isArray(b))
    return false
  const { [key]: extra, ...rest } = b as Record<string, unknown>
  if (extra === undefined || key in a) return false
  if (valueRx !== undefined && !new RegExp(valueRx, 'u').test(JSON.stringify(extra))) return false
  return eq(a, rest)
}

const OL_TAG_RX = /<ol\b[^>]*>/g

/**
 * One form of the registry taken out of `s` (normalized HTML of the side the registry entry is about), written the
 * way `ref` (the other side) writes it. Only that form changes: everything else in the block stays to be compared.
 */
function foldHtml(fold: HtmlFold, ref: string, s: string): string {
  if (fold === 'cell-fill') return foldCellFill(ref, s)
  if (fold === 'table-width')
    return s
      .replace(/<(table|col)\b[^>]*>/g, (tag) => tag.replace(/ width="([0-9.]+%)"/, ' style="width: $1;"'))
      .replace(/<\/col>/g, '')
  // olist-start, olist-type: an attribute of an `ol` the other side does not write at the same `ol`
  const attr = fold === 'olist-start' ? /( start="[0-9]+")/ : /( type="[aAiI]")/
  const own = fold === 'olist-start' ? ' start="' : ' type="'
  const refTags = ref.match(OL_TAG_RX) ?? []
  if (refTags.length !== (s.match(OL_TAG_RX) ?? []).length) return s
  let i = 0
  return s.replace(OL_TAG_RX, (tag) => (refTags[i++]!.includes(own) ? tag : tag.replace(attr, '')))
}

const CELL_TAG_RX = /<t[dh]\b[^>]*>/g
const CELL_FILL_RX = / (cell-[\w-]+)"/

/**
 * `cell-fill`: the role of a filled cell is on its `td`/`th` in Nota; the cells of `s` (Nota) take it off and get the empty
 * `span` that `ref` writes at the start of the same cell, where `ref` writes it (what `ref` has in front of the span
 * must be what the cell starts with in `s`, or the cell stays as it is and the block differs).
 */
function foldCellFill(ref: string, s: string): string {
  const refTags = [...ref.matchAll(CELL_TAG_RX)]
  const tags = [...s.matchAll(CELL_TAG_RX)]
  if (refTags.length !== tags.length) return s
  let out = ''
  let at = 0
  tags.forEach((m, i) => {
    const role = CELL_FILL_RX.exec(m[0])?.[1]
    if (!role) return
    const span = `<span class="${role}"></span>`
    const refFrom = refTags[i]!.index + refTags[i]![0].length
    const refRest = ref.slice(refFrom)
    const k = refRest.indexOf(span)
    const prefix = k < 0 ? '' : refRest.slice(0, k)
    if (k < 0 || /<\/?t[dh]\b/.test(prefix)) return
    const from = m.index + m[0].length
    const rest = s.slice(from)
    let content: string | null = null
    let used = prefix.length
    // (a cell with only the label: `td` closes right after it in `s`, in `ref` after the paragraph it is in)
    const only = /^<\/p>(?:<\/div><\/div>)?(?=<\/t[dh]>)/.exec(refRest.slice(prefix.length + span.length))
    if (only && /^<(?:p class="tableblock"|div class="content"><div class="paragraph"><p)>$/.test(prefix) && /^<\/t[dh]>/.test(rest)) {
      content = `${prefix}${span}${only[0]}`
      used = 0
    } else if (rest.startsWith(prefix)) content = `${prefix}${span}`
    if (content === null) return
    out += s.slice(at, m.index) + m[0].replace(CELL_FILL_RX, '"') + content
    at = from + used
  })
  return out + s.slice(at)
}

/** The two normalized HTML texts with the forms of the registry taken out, and the ids of the entries that took one. */
function foldKnown(
  folds: { id: string; fold: HtmlFold; side: 'a' | 'b' }[],
  x: string,
  y: string,
): { x: string; y: string; ids: string[] } {
  const ids: string[] = []
  for (const f of folds) {
    const before = f.side === 'a' ? x : y
    const after = foldHtml(f.fold, f.side === 'a' ? y : x, before)
    if (after === before) continue
    if (f.side === 'a') x = after
    else y = after
    ids.push(f.id)
  }
  return { x, y, ids }
}

const TOKEN_RX = /<[^>]*>|[^<]+/g

interface Tag {
  name: string
  close: boolean
  attrs: Map<string, string>
}

function parseTag(token: string): Tag | null {
  const m = /^<(\/?)(!--|[a-zA-Z][a-zA-Z0-9]*)([^>]*)>$/.exec(token)
  if (!m) return null
  const attrs = new Map<string, string>()
  for (const a of m[3]!.matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g))
    attrs.set(a[1]!.toLowerCase(), a[2] ?? a[3] ?? a[4] ?? '')
  return { name: m[2]!.toLowerCase(), close: m[1] === '/', attrs }
}

const TABLE_PARTS = new Set(['thead', 'tbody', 'tfoot'])

/**
 * The shapes of the first difference of two normalized HTML texts, as keys made of words of fixed lists only
 * (`html-shape.<context>.<...>`): what kind of token differs (text, tag, attribute, class), the element it is in,
 * the part of the table and the number of the cell in the row. No text, no value of an attribute: the keys can
 * be shown for pages that are closed.
 */
export function htmlShapes(context: string, a: string, b: string): string[] {
  const ta = a.match(TOKEN_RX) ?? []
  const tb = b.match(TOKEN_RX) ?? []
  let i = 0
  while (i < ta.length && i < tb.length && ta[i] === tb[i]) i++
  const ctx = BLOCK_CONTEXTS.has(context) ? context : 'other'
  // where the difference is: the open elements before it, the part of the table and the cell in the row
  const open: string[] = []
  let section = 'none'
  let col = 0
  for (let k = 0; k < i; k++) {
    const t = parseTag(ta[k]!)
    if (!t || t.name === '!--') continue
    if (t.close) {
      const at = open.lastIndexOf(t.name)
      if (at >= 0) open.length = at
      if (TABLE_PARTS.has(t.name)) section = 'none'
    } else if (!['col', 'br', 'hr', 'img'].includes(t.name)) {
      open.push(t.name)
      if (TABLE_PARTS.has(t.name)) section = t.name
      if (t.name === 'tr') col = 0
      if (t.name === 'td' || t.name === 'th') col++
    }
  }
  const inside = inList(SHAPE_TAGS, open[open.length - 1] ?? 'none')
  const key = (...parts: string[]) => ['html-shape', ctx, ...parts].join('.')
  const x = ta[i]
  const y = tb[i]
  let what: string
  if (x === undefined || y === undefined) {
    const t = parseTag((x ?? y)!)
    what = `${x === undefined ? 'second-only' : 'first-only'}.${t ? (t.close ? '/' : '') + inList(SHAPE_TAGS, t.name) : 'text'}`
  } else {
    const tx = parseTag(x)
    const ty = parseTag(y)
    if (!tx && !ty) {
      const hint = x.replace(/\s+/g, '') === y.replace(/\s+/g, '')
        ? 'spaces'
        : x.startsWith(y) || y.startsWith(x)
          ? 'prefix'
          : /&/.test(x + y)
            ? 'entity'
            : 'text'
      what = `text.${inList(SHAPE_TEXT_HINTS, hint)}`
    } else if (!tx || !ty) what = 'tag-vs-text'
    else if (tx.name !== ty.name || tx.close !== ty.close)
      what = `tag.${tx.close ? '/' : ''}${inList(SHAPE_TAGS, tx.name)}.${ty.close ? '/' : ''}${inList(SHAPE_TAGS, ty.name)}`
    else {
      // the same element: the first attribute that differs
      const names = [...new Set([...tx.attrs.keys(), ...ty.attrs.keys()])]
      const diff = names.find((n) => tx.attrs.get(n) !== ty.attrs.get(n)) ?? 'x'
      if (diff === 'class') {
        const cx = (tx.attrs.get('class') ?? '').split(/\s+/).filter(Boolean)
        const cy = (ty.attrs.get('class') ?? '').split(/\s+/).filter(Boolean)
        const c = [...cx.filter((n) => !cy.includes(n)), ...cy.filter((n) => !cx.includes(n))][0] ?? 'x'
        what = `class.${inList(SHAPE_CLASSES, c)}.${inList(SHAPE_TAGS, tx.name)}`
      } else what = `attr.${inList(SHAPE_ATTRS, diff)}.${inList(SHAPE_TAGS, tx.name)}`
    }
  }
  // (the element that differs is the cell itself)
  const at = x === undefined ? null : parseTag(x)
  if (at && !at.close && (at.name === 'td' || at.name === 'th')) col++
  const cell = col > 9 ? 'col10+' : `col${col}`
  return [key(what, 'in', inside), key('section', section), key('col', cell)]
}

/** The first class of the element that the list of classes knows (`none` when it has none, `x` for other). */
function knownClass(t: Tag): string {
  const names = (t.attrs.get('class') ?? '').split(/\s+/).filter(Boolean)
  return names.length === 0 ? 'none' : inList(SHAPE_CLASSES, names.find((n) => SHAPE_CLASSES.has(n)) ?? 'x')
}

/** Whether the element has a class that is none of the list (a role of the block). */
function hasRole(t: Tag): string {
  const names = (t.attrs.get('class') ?? '').split(/\s+/).filter(Boolean)
  return names.some((n) => !SHAPE_CLASSES.has(n)) ? 'has' : 'no'
}

const numberKey = (n: number) => (n > 9 ? 'n10+' : `n${n}`)

/** How two ids differ, as a word of a fixed list, and when they differ by the number at the end, by how much. */
export function idKinds(a: string | undefined, b: string | undefined): string[] {
  if (a === b) return []
  if (a === undefined) return ['none-first']
  if (b === undefined) return ['none-second']
  if (a === '') return ['empty-first']
  if (b === '') return ['empty-second']
  const tail = /^(.*?)[_-]?(\d+)$/
  const ma = tail.exec(a)
  const mb = tail.exec(b)
  const ba = ma ? ma[1]! : a
  const bb = mb ? mb[1]! : b
  if ((ma || mb) && ba === bb) {
    const d = Number(ma ? ma[2] : 1) - Number(mb ? mb[2] : 1)
    const size = Math.abs(d) > 2 ? 'many' : String(Math.abs(d))
    return ['suffix-number', `${d > 0 ? 'first-higher' : 'first-lower'}-${size}`]
  }
  if (a.toLowerCase() === b.toLowerCase()) return ['case']
  if (a.endsWith(b) || b.endsWith(a)) return ['prefix']
  return ['other']
}

/**
 * More on the shape of the first difference of two normalized HTML texts, to tell what kind of difference it is:
 * how the ids differ (only the number at the end, the start, one side has none, empty), the class of the block
 * and whether it has a role, the class of the first block inside it, and where the difference is: the number
 * of the block in its container, the class of the container and of the block before it, how deep the cells and
 * the tables lie. Only words of fixed lists and numbers: no text and no value (`html-shape.<context>.<...>`).
 */
export function htmlDetailShapes(context: string, a: string, b: string): string[] {
  const ta = a.match(TOKEN_RX) ?? []
  const tb = b.match(TOKEN_RX) ?? []
  let i = 0
  while (i < ta.length && i < tb.length && ta[i] === tb[i]) i++
  const ctx = BLOCK_CONTEXTS.has(context) ? context : 'other'
  interface Open {
    name: string
    cls: string
    kids: number
    prev: string
  }
  const open: Open[] = []
  let cells = 0
  let tables = 0
  for (let k = 0; k < i; k++) {
    const t = parseTag(ta[k]!)
    if (!t || t.name === '!--') continue
    const top = open[open.length - 1]
    if (t.close) {
      const at = open.map((o) => o.name).lastIndexOf(t.name)
      if (at >= 0) {
        const closed = open[at]!
        for (let m = open.length - 1; m >= at; m--) {
          if (open[m]!.name === 'td' || open[m]!.name === 'th') cells--
          if (open[m]!.name === 'table') tables--
        }
        open.length = at
        const parent = open[open.length - 1]
        if (parent) parent.prev = closed.cls === 'none' ? inList(SHAPE_TAGS, closed.name) : closed.cls
      }
    } else {
      if (top) top.kids++
      if (['col', 'br', 'hr', 'img'].includes(t.name)) {
        if (top) top.prev = inList(SHAPE_TAGS, t.name)
        continue
      }
      open.push({ name: t.name, cls: knownClass(t), kids: 0, prev: 'none' })
      if (t.name === 'td' || t.name === 'th') cells++
      if (t.name === 'table') tables++
    }
  }
  const key = (...parts: string[]) => ['html-shape', ctx, ...parts].join('.')
  const out: string[] = []
  const here = open[open.length - 1]
  out.push(key('pos', numberKey(here?.kids ?? 0)))
  out.push(key('in-class', here ? here.cls : 'none'))
  out.push(key('prev', here ? here.prev : 'none'))
  out.push(key('cells', numberKey(Math.min(cells, 10))))
  out.push(key('tables', numberKey(Math.min(tables, 10))))
  const tx = ta[i] === undefined ? null : parseTag(ta[i]!)
  const ty = tb[i] === undefined ? null : parseTag(tb[i]!)
  if (tx && ty && !tx.close && !ty.close) {
    if (tx.name === ty.name) {
      if (tx.attrs.has('id') || ty.attrs.has('id'))
        for (const kind of idKinds(tx.attrs.get('id'), ty.attrs.get('id'))) out.push(key('idkind', kind))
      if (tx.attrs.get('id') !== ty.attrs.get('id')) out.push(key('idblock', knownClass(tx), knownClass(ty)))
    } else {
      out.push(key('block', knownClass(tx), knownClass(ty)))
      out.push(key('role', hasRole(tx), hasRole(ty)))
      // the first element inside each: what kind of block lies in it
      const firstChild = (tokens: string[]) => {
        for (let k = i + 1; k < Math.min(tokens.length, i + 4); k++) {
          const t = parseTag(tokens[k]!)
          if (t && !t.close && t.name !== '!--') return `${inList(SHAPE_TAGS, t.name)}.${knownClass(t)}`
        }
        return 'none'
      }
      out.push(key('child', firstChild(ta), firstChild(tb)))
    }
  }
  return out
}

/** The counts of the shapes of HTML differences; the keys that are not shapes of the list go to `<other>`. */
function foldShapes(h: Record<string, number> | undefined): Record<string, number> {
  return foldKeys(h ?? {}, isShapeKey)
}

interface HtmlScope {
  /** The lines of the `include::` directives of the document (Nota's own view). */
  includes: number[]
  /** The first side is Nota, whose blocks know where they end. */
  withNota: boolean
}

/** Whether a pair of blocks is left out, and why. */
function htmlOut(x: HtmlBlock, y: HtmlBlock, scope: HtmlScope): OutReason | null {
  if (scope.includes.length === 0) return null
  const lo = Math.min(x.line ?? Infinity, y.line ?? Infinity)
  const hi = Math.max(x.end ?? x.line ?? 0, y.end ?? y.line ?? 0)
  // an include line is inside a block (not inside one of its blocks), or right before it
  for (const n of scope.includes) {
    // (a line right after the block, without a blank line, is part of it for the references)
    if (n < lo - 1 || n > hi + 1) continue
    const inKid = x.blocks.some((k) => k.line !== null && k.line <= n && n <= (k.end ?? k.line))
    if (!inKid) return 'preprocessor-directives'
  }
  return null
}

/** The HTML of a block with the HTML of the blocks in it replaced by what `inner` says. */
function withInner(x: HtmlBlock, inner: (k: HtmlBlock) => string): string {
  const html = x.html ?? ''
  let out = ''
  let pos = 0
  for (const k of x.blocks) {
    const kh = k.html ?? ''
    const at = html.indexOf(kh, pos)
    if (at < 0 || kh === '') continue
    out += html.slice(pos, at) + inner(k)
    pos = at + kh.length
  }
  return out + html.slice(pos)
}

const HOLE = '<!--out-of-scope-->'

/**
 * The HTML of every block of the two dumps, compared block by block: the blocks are paired in the order of
 * the tree (the structure comparison tells when the trees differ), and a block is a difference when its HTML
 * (with the HTML of the blocks in it left out) differs while everything in it is equal. Blocks with an
 * `include::` line are counted as out of scope; their HTML is a hole in the HTML around them.
 */
function compareHtml(p: Pair, a: DumpFile, b: DumpFile, nota: DumpFile): void {
  if (!a.html || !b.html) return
  const scope: HtmlScope = { includes: nota.includeLines ?? [], withNota: p.r.a === 'nota' }
  // a block of the reference on the line of an include directive is the line read as text
  const isInclude = (y: HtmlBlock) => scope.withNota && y.line !== null && scope.includes.includes(y.line)
  const counter = (ctx: string) =>
    (p.r.htmlBlocks[ctx] ??= { compared: 0, matched: 0, differences: 0, outOfScope: 0 })
  const same = (x: string, y: string) => normalizeHtml(x) === normalizeHtml(y)

  /** Compares a pair; returns whether the blocks are equal, and the HTML of the pair for the block around. */
  /** Whether an include line is inside a block or next to it (a directive line joins the lines around it). */
  const includeNear = (b: HtmlBlock) =>
    scope.includes.some((n) => b.line !== null && n >= b.line - 1 && n <= (b.end ?? b.line) + 1)

  const pair = (x: HtmlBlock, y: HtmlBlock): { ok: boolean; scoped: [string, string] } => {
    const out = htmlOut(x, y, scope)
    if (out) {
      p.out(out)
      counter(x.context).outOfScope++
      return { ok: true, scoped: [HOLE, HOLE] }
    }
    // the blocks in it are paired in order; a block of the reference that is an include line is no block of Nota's
    const xs = x.blocks
    const ys = y.blocks
    const inner = new Map<HtmlBlock, string>()
    const innerY = new Map<HtmlBlock, string>()
    const dropped = new Set<HtmlBlock>()
    let kidsOk = true
    let aligned = true
    let i = 0
    let j = 0
    while (i < xs.length || j < ys.length) {
      const a = xs[i]
      const b = ys[j]
      if (b && isInclude(b)) {
        p.out('preprocessor-directives')
        counter(b.context).outOfScope++
        dropped.add(b)
        j++
      } else if (a && b && a.context === b.context) {
        const r = pair(a, b)
        kidsOk &&= r.ok
        inner.set(a, r.scoped[0])
        innerY.set(b, r.scoped[1])
        i++
        j++
      } else if (a && b && scope.withNota && (includeNear(a) || includeNear(b))) {
        // a block with an include line in it or next to it reads differently on the two sides
        p.out('preprocessor-directives')
        counter(a.context).outOfScope++
        inner.set(a, HOLE)
        innerY.set(b, HOLE)
        i++
        j++
      } else {
        aligned = false
        break
      }
    }
    if (!aligned) {
      p.difference(
        'html',
        x.line,
        x.context,
        `blocks: ${xs.map((k) => k.context).join(' ')}`,
        `blocks: ${ys.map((k) => k.context).join(' ')}`,
      )
      counter(x.context).differences++
      kidsOk = false
    }
    const sx = aligned ? withInner(x, (k) => inner.get(k) ?? k.html ?? '') : (x.html ?? '')
    const sy = aligned
      ? withInner(y, (k) => (dropped.has(k) ? '' : (innerY.get(k) ?? k.html ?? '')))
      : (y.html ?? '')
    const c = counter(x.context)
    c.compared++
    p.r.compared.html++
    const ok = aligned && same(sx, sy)
    if (ok) {
      c.matched++
      p.r.matched.html++
    } else if (aligned && kidsOk) {
      // nothing inside differs: this block does
      const nx = normalizeHtml(sx)
      const ny = normalizeHtml(sy)
      // a form of the registry is taken out first, so that it does not hide what differs further in the block
      // (a list with a `start` or a style written in the source is not folded: if Nota lost it, that is a difference)
      const folds = p.folds(x.context).filter((f) => f.fold === 'table-width' || f.fold === 'cell-fill' || !(x.explicit || y.explicit))
      const folded = foldKnown(folds, nx, ny)
      if (folded.ids.length > 0 && folded.x === folded.y) {
        const [ka, kb] = firstDifference(nx, ny)
        for (const id of folded.ids) p.knownHtml(x.line, x.context, ka, kb, id)
        c.differences++
        return { ok: kidsOk, scoped: [folded.x, folded.y] }
      }
      const [fa, fb] = firstDifference(folded.x, folded.y)
      p.difference('html', x.line, x.context, fa, fb)
      for (const k of [
        ...htmlShapes(x.context, folded.x, folded.y),
        ...htmlDetailShapes(x.context, folded.x, folded.y),
      ])
        p.r.htmlShapes![k] = (p.r.htmlShapes![k] ?? 0) + 1
      c.differences++
      kidsOk = false
    }
    return { ok: ok && kidsOk, scoped: [sx, sy] }
  }

  // the document: its HTML around the blocks
  const root = (d: DumpFile): HtmlBlock => ({
    context: 'document',
    line: 1,
    html: d.html!.doc,
    blocks: d.html!.blocks,
  })
  pair(root(a), root(b))
}

function comparePair(
  file: string,
  text: string,
  sides: [Side, DumpFile],
  other: [Side, DumpFile],
  nota: DumpFile,
  registry: Registry,
): PairResult {
  const p = new Pair(file, sides[0], other[0], registry)
  const [a, b] = [sides[1], other[1]]
  for (const [side, d] of [sides, other] as const) if (d.error) p.r.errors.push(`${side}: ${d.error}`)
  if (a.error || b.error) return p.r
  const lines = sourceLines(text)
  const scope: Scope = {
    lines,
    includeLines: [...(nota.includeLines ?? [])].sort((x, y) => x - y),
    runByEnd: new Map(
      Object.entries(nota.hiddenAfter ?? {}).map(([k, n]) => [
        Number(k) + n,
        [Number(k), n] as [number, number],
      ]),
    ),
    withNota: sides[0] === 'nota' || other[0] === 'nota',
  }
  const ta = buildTree(a, lines.length)
  const tb = buildTree(b, lines.length)
  // with Nota as the first side, the second side may report lines that are a little too large
  const hidden = nota.hiddenAfter ?? {}
  const slack = (line: number) => (sides[0] === 'nota' ? (hidden[String(line)] ?? 0) : 0)
  compareHeader(p, a, b, nota, lines)
  compareEntries(p, a, b, slack)
  compareTop(p, scope, ta.roots, tb.roots, slack)
  compareHtml(p, a, b, nota)
  if (sides[0] === 'nota') compareDelimitedEnds(p, text, ta.all)
  return p.r
}

export interface CompareInput {
  file: string
  text: string
  nota: DumpFile
  refs: Partial<Record<'ruby' | 'js', DumpFile>>
}

/** Compares Nota with each reference, and the references with each other. */
export function compareFile(input: CompareInput, registry: Registry): FileResult {
  const { file, text, nota, refs } = input
  const pairs: PairResult[] = []
  if (refs.ruby) pairs.push(comparePair(file, text, ['nota', nota], ['ruby', refs.ruby], nota, registry))
  if (refs.js) pairs.push(comparePair(file, text, ['nota', nota], ['js', refs.js], nota, registry))
  if (refs.ruby && refs.js)
    pairs.push(comparePair(file, text, ['ruby', refs.ruby], ['js', refs.js], nota, registry))
  return { file, pairs }
}

// ------------------------------------------------------------------ summary and reports

export interface Summary {
  files: number
  pairs: Record<string, PairResult>
  exitCode: number
}

export function summarize(results: FileResult[]): Summary {
  const pairs: Record<string, PairResult> = {}
  for (const f of results) {
    for (const p of f.pairs) {
      const key = `${p.a}-${p.b}`
      const acc = (pairs[key] ??= {
        a: p.a,
        b: p.b,
        compared: zero(KINDS),
        matched: zero(KINDS),
        htmlBlocks: {},
        htmlShapes: {},
        differences: [],
        known: [],
        outOfScope: zero(OUT_REASONS),
        errors: [],
      })
      for (const k of KINDS) {
        acc.compared[k] += p.compared[k]
        acc.matched[k] += p.matched[k]
      }
      for (const r of OUT_REASONS) acc.outOfScope[r] += p.outOfScope[r]
      for (const [ctx, c] of Object.entries(p.htmlBlocks)) {
        const t = (acc.htmlBlocks[ctx] ??= { compared: 0, matched: 0, differences: 0, outOfScope: 0 })
        t.compared += c.compared
        t.matched += c.matched
        t.differences += c.differences
        t.outOfScope += c.outOfScope
      }
      for (const [k, n] of Object.entries(p.htmlShapes ?? {}))
        acc.htmlShapes![k] = (acc.htmlShapes![k] ?? 0) + n
      acc.differences.push(...p.differences)
      acc.known.push(...p.known)
      acc.errors.push(...p.errors.map((e) => `${f.file}: ${e}`))
    }
  }
  const failed = Object.values(pairs).some((p) => p.differences.length > 0 || p.errors.length > 0)
  return { files: results.length, pairs, exitCode: failed ? 1 : 0 }
}

const SIDE_NAMES: Record<Side, string> = { nota: 'nota', ruby: 'Ruby Asciidoctor', js: 'Asciidoctor.js' }

/** Counts of the differences by `kind.field`; the keys outside the fixed lists are folded into `<other>`. */
function countBy(ds: Difference[]): Record<string, number> {
  const out: Record<string, number> = {}
  const kinds: ReadonlySet<string> = new Set(KINDS)
  for (const d of ds) {
    const key = kinds.has(d.kind) && COMPARE_FIELDS.has(d.field) ? `${d.kind}.${d.field}` : OTHER
    out[key] = (out[key] ?? 0) + 1
  }
  return out
}

/** The counters of the HTML of blocks under the contexts of Asciidoctor; the others are added up under `<other>`. */
function foldHtmlBlocks(h: HtmlCounters): HtmlCounters {
  const out: HtmlCounters = {}
  for (const [ctx, c] of Object.entries(h)) {
    const key = BLOCK_CONTEXTS.has(ctx) ? ctx : OTHER
    const t = (out[key] ??= { compared: 0, matched: 0, differences: 0, outOfScope: 0 })
    t.compared += c.compared
    t.matched += c.matched
    t.differences += c.differences
    t.outOfScope += c.outOfScope
  }
  return out
}

function show(v: unknown): string {
  const s = JSON.stringify(v)
  return s === undefined ? 'undefined' : s.length > 120 ? s.slice(0, 117) + '...' : s
}

export function formatReport(s: Summary, opts: { aggregate: boolean }): string {
  const out: string[] = [`files: ${s.files}`]
  for (const p of Object.values(s.pairs)) {
    const refPair = p.a !== 'nota'
    out.push('')
    out.push(`${SIDE_NAMES[p.a]} vs ${SIDE_NAMES[p.b]}${refPair ? ' (references between themselves)' : ''}`)
    for (const k of KINDS) out.push(`  ${k}: compared ${p.compared[k]}, matched ${p.matched[k]}`)
    out.push(
      `  differences: ${p.differences.length}${refPair ? ' not in the registry' : ''}, known (registry): ${p.known.length}`,
    )
    out.push(`  out of scope: ${OUT_REASONS.map((r) => `${r} ${p.outOfScope[r]}`).join(', ')}`)
    for (const [ctx, c] of Object.entries(opts.aggregate ? foldHtmlBlocks(p.htmlBlocks) : p.htmlBlocks).sort(
      ([x], [y]) => (x < y ? -1 : x > y ? 1 : 0),
    ))
      out.push(
        `    html ${ctx}: compared ${c.compared}, matched ${c.matched}, differences ${c.differences}, out of scope ${c.outOfScope}`,
      )
    if (p.errors.length) out.push(`  errors: ${p.errors.length}`)
    if (opts.aggregate) {
      for (const [k, n] of Object.entries(countBy(p.differences))) out.push(`    ${k}: ${n}`)
      for (const [k, n] of Object.entries(foldShapes(p.htmlShapes)).sort(([x], [y]) => (x < y ? -1 : 1)))
        out.push(`    ${k}: ${n}`)
      for (const [k, n] of Object.entries(countBy(p.known))) out.push(`    known ${k}: ${n}`)
    } else {
      for (const e of p.errors) out.push(`    error ${e}`)
      for (const d of p.differences)
        out.push(
          `    ${d.file}:${d.line ?? '-'} ${d.kind} ${d.field}: ${p.a}=${show(d.a)} ${p.b}=${show(d.b)}`,
        )
      for (const d of p.known)
        out.push(
          `    ${d.file}:${d.line ?? '-'} ${d.kind} ${d.field}: ${p.a}=${show(d.a)} ${p.b}=${show(d.b)} [known: ${d.known}]`,
        )
    }
  }
  out.push('')
  out.push(s.exitCode === 0 ? 'result: no unexplained differences' : 'result: DIFFERENCES FOUND')
  return out.join('\n') + '\n'
}

export function toJson(s: Summary, opts: { aggregate: boolean }): string {
  if (!opts.aggregate) return JSON.stringify(s, null, 2)
  const pairs: Record<string, unknown> = {}
  for (const [key, p] of Object.entries(s.pairs)) {
    pairs[key] = {
      compared: p.compared,
      matched: p.matched,
      htmlBlocks: foldHtmlBlocks(p.htmlBlocks),
      htmlShapes: foldShapes(p.htmlShapes),
      outOfScope: p.outOfScope,
      differences: countBy(p.differences),
      known: countBy(p.known),
      errors: p.errors.length,
    }
  }
  return JSON.stringify({ files: s.files, pairs, exitCode: s.exitCode }, null, 2)
}
