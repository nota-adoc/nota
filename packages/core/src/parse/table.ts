/**
 * Tables: the cells of a `|===`, `!===`, `,===` or `:===` block and the layout Asciidoctor 2.0.26 gives them.
 *
 * `scanTable` is a port of `Parser.parse_table` and `Table::ParserContext` (the state machine that cuts the lines of a
 * table into cells and the cells into rows), of `Table::Cell#initialize` (what a style does to the text) and of
 * `Table#partition_header_footer` and `assign_column_widths`. Where Asciidoctor is quadratic (a quote check that reads
 * the whole buffer at every separator, the rowspan bookkeeping that walks the rows below), this port keeps the same
 * results with a running summary or a difference array. It also records where each cell stands in the source: the
 * lexical cells (`Lex`) the tree is made of, and for the cells with the `a` style the text of the nested document with
 * a map back to the source.
 */
import {
  type TableCellFill,
  type TableCellModel,
  type TableCellStyle,
  type TableColumnModel,
  type TableModel,
  Type,
} from '../nodes.js'
import { type N, clean, leaf, node, rawNode } from './build.js'
import { isRubySpace, rubyToI } from './rx.js'

/** No table is allowed more columns or cells than this; the rest is left out of the layout (see «Limits»). */
export const MAX_COLUMNS = 250_000
export const MAX_CELLS = 1_000_000
/** How many documents in cells may hold one another; a cell deeper than that is text. */
export const MAX_NESTING = 32

/** A line of the table as the reader hands it over: the text is stripped at the end, the offsets are the source's. */
export interface TableLine {
  readonly text: string
  readonly from: number
  /** Start of the line terminator; `next` if there is none. */
  readonly nl: number
  readonly next: number
}

/** What the scan needs from the block: its lines and the attributes that shape the table. */
export interface TableSource {
  readonly lines: readonly TableLine[]
  /** The values of `cols`, `format`, `separator` and `width` (with the attribute references replaced), or null. */
  readonly cols: string | null
  readonly format: string | null
  readonly separator: string | null
  readonly width: string | null
  readonly header: boolean
  readonly noheader: boolean
  readonly footer: boolean
  /** The table is in a cell of a table (a nested document): `|` becomes `!`. */
  readonly nested: boolean
}

/** A piece of a table cell as the tree has it (absolute offsets; -1 for what the cell does not have). */
export interface Lex {
  specFrom: number
  specTo: number
  sepFrom: number
  sepTo: number
  /** The text of the cell as written, spaces and quotes around it out. */
  cFrom: number
  cTo: number
  /** Where an empty cell without a separator stands. */
  pos: number
  /** The `TableCell` node, worked out when the scan is done. */
  from: number
  to: number
}

export interface TableDiag {
  readonly from: number
  readonly to: number
  readonly code: 'table-missing-separator' | 'table-incomplete-row' | 'table-cell-dropped'
  readonly message: string
}

/** A cell with the `a` style: the text of its document and where each character of it came from. */
export interface AsciiCell {
  readonly lex: Lex
  readonly cell: TableCellModel
  /** The characters of the text and, for each, where it starts and ends in the source. */
  map(): { text: string; starts: number[]; ends: number[] }
}

export interface TableScan {
  /** Offsets in the model are relative to `base`. */
  readonly model: TableModel
  readonly lex: readonly Lex[]
  readonly diags: readonly TableDiag[]
  readonly ascii: readonly AsciiCell[]
}

// ------------------------------------------------------------------------------------------------ small helpers

const isWs = (c: number) => isRubySpace(c)

const HALIGN: Record<string, 'left' | 'center' | 'right'> = { '<': 'left', '^': 'center', '>': 'right' }
const VALIGN: Record<string, 'top' | 'middle' | 'bottom'> = { '<': 'top', '^': 'middle', '>': 'bottom' }
const STYLES: Record<string, TableCellStyle> = {
  d: 'none',
  s: 'strong',
  e: 'emphasis',
  m: 'monospaced',
  h: 'header',
  l: 'literal',
  a: 'asciidoc',
}
const DELIMITERS: Record<string, string> = { psv: '|', csv: ',', dsv: ':', tsv: '\t', '!sv': '!' }

/** The length in UTF-16 units of the character at `i` (Ruby slices a character, not a unit). */
function charLen(s: string, i: number): number {
  const c = s.charCodeAt(i)
  return c >= 0xd800 && c < 0xdc00 && i + 1 < s.length ? 2 : 1
}

/** Float#truncate(4) as Ruby does it (it corrects the floor of the scaled number). */
function truncate4(x: number): number {
  const f = 10000
  const mul = Math.floor(x * f)
  const res = (mul + 1) / f
  return res > x ? mul / f : res
}

/** Float#round(4): half up, corrected the way Ruby's `round_half_up` does. */
function round4(x: number): number {
  const s = 10000
  let f = Math.round(x * s)
  if ((f + 0.5) / s <= x) f += 1
  return f / s
}

/** The width of the table, in percent (`Table#initialize`). */
function tableWidth(w: string | null): number {
  if (w === null) return 100
  let n = rubyToI(w)
  if ((n > 100 || n < 1) && !(n === 0 && (w === '0' || w === '0%'))) n = 100
  return n
}

// ------------------------------------------------------------------------------------------------ quotes in CSV data

/**
 * A summary of a string that is enough to tell whether the record it makes with what follows has unclosed quotes:
 * the string without the white space at its ends (`core`), the runs of quotes at both ends of the core, and whether
 * the core is nothing but quotes. Summaries of two strings join in constant time, so a record that grows by a piece at
 * a time (a quoted cell over 100 000 lines) is checked in linear time overall.
 */
export interface QuoteSummary {
  readonly core: boolean
  readonly lws: boolean
  readonly rws: boolean
  readonly lead: number
  readonly trail: number
  readonly all: boolean
}

const NO_QUOTES: QuoteSummary = { core: false, lws: false, rws: false, lead: 0, trail: 0, all: false }
const BLANK_QUOTES: QuoteSummary = { core: false, lws: true, rws: true, lead: 0, trail: 0, all: false }

export function summarizeQuotes(s: string): QuoteSummary {
  let a = 0
  let b = s.length
  while (a < b && isWs(s.charCodeAt(a))) a++
  if (a === b) return b === 0 ? NO_QUOTES : BLANK_QUOTES
  while (isWs(s.charCodeAt(b - 1))) b--
  let lead = 0
  while (a + lead < b && s.charCodeAt(a + lead) === 34) lead++
  const all = a + lead === b
  let trail = lead
  if (!all) {
    trail = 0
    while (s.charCodeAt(b - 1 - trail) === 34) trail++
  }
  return { core: true, lws: a > 0, rws: b < s.length, lead, trail, all }
}

export function joinQuotes(x: QuoteSummary, y: QuoteSummary): QuoteSummary {
  if (!y.core) {
    if (!y.lws) return x
    if (x.core) return x.rws ? x : { ...x, rws: true }
    return x.lws ? x : y
  }
  if (!x.core) return x.lws ? { ...y, lws: true } : y
  const joins = !x.rws && !y.lws
  return {
    core: true,
    lws: x.lws,
    rws: y.rws,
    lead: x.lead + (x.all && joins ? y.lead : 0),
    trail: y.trail + (y.all && joins ? x.trail : 0),
    all: x.all && y.all && joins,
  }
}

/** `ParserContext#buffer_has_unclosed_quotes?` for the record the summary is of. */
export function hasUnclosedQuotes(q: QuoteSummary): boolean {
  if (!q.core) return false
  if (q.all && q.lead === 1) return true
  if (q.lead === 0) return false
  if (q.trail >= 2 || q.lead >= 2) return (q.lead & 1) === 1 && (q.trail & 1) === 0
  return q.trail === 0
}

// ------------------------------------------------------------------------------------------------ the buffer of a cell

/**
 * The buffer of the cell being read, as Asciidoctor keeps it (the pieces of the lines with a line feed after each line),
 * and where each piece came from in the source: runs of `[start in the buffer, length, start in the source, length]`.
 * A line feed stands for the whole line terminator.
 */
class Buf {
  text = ''
  readonly runs: number[] = []
  quotes: QuoteSummary = NO_QUOTES

  constructor(private readonly track: boolean) {}

  add(s: string, src: number): void {
    const len = s.length
    if (len === 0) return
    const r = this.runs
    const n = r.length
    if (n > 0 && r[n - 3] === r[n - 1] && r[n - 2]! + r[n - 1]! === src) {
      r[n - 3]! += len
      r[n - 1]! += len
    } else r.push(this.text.length, len, src, len)
    this.text += s
    if (this.track) this.quotes = joinQuotes(this.quotes, summarizeQuotes(s))
  }

  addLine(nl: number, terminator: number): void {
    this.runs.push(this.text.length, 1, nl, terminator)
    this.text += '\n'
    if (this.track) this.quotes = joinQuotes(this.quotes, BLANK_QUOTES)
  }

  /** The run that holds the character `v`. */
  private runOf(v: number): number {
    const r = this.runs
    let lo = 0
    let hi = r.length / 4 - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (r[4 * mid]! <= v) lo = mid
      else hi = mid - 1
    }
    return 4 * lo
  }

  startOf(v: number): number {
    const r = this.runs
    const i = this.runOf(v)
    return r[i + 1] === r[i + 3] ? r[i + 2]! + (v - r[i]!) : r[i + 2]!
  }

  endOf(v: number): number {
    const r = this.runs
    const i = this.runOf(v)
    return r[i + 1] === r[i + 3] ? r[i + 2]! + (v - r[i]!) + 1 : r[i + 2]! + r[i + 3]!
  }

  /** The source range of the characters `[a, b)`, or null if there are none. */
  range(a: number, b: number): [number, number] | null {
    return a < b ? [this.startOf(a), this.endOf(b - 1)] : null
  }
}

/** The part of a buffer a cell keeps: `[a, b)`, and whether the quotes in it are squeezed to one. */
interface Kept {
  readonly buf: Buf
  readonly a: number
  readonly b: number
  readonly squeeze: boolean
}

function textOf(k: Kept): string {
  const s = k.buf.text.slice(k.a, k.b)
  return k.squeeze ? s.replace(/"{2,}/g, '"') : s
}

function lstripAt(s: string, a: number, b: number): number {
  while (a < b && isWs(s.charCodeAt(a))) a++
  return a
}

function rstripAt(s: string, a: number, b: number): number {
  while (b > a && isWs(s.charCodeAt(b - 1))) b--
  return b
}

// ------------------------------------------------------------------------------------------------ specs

/** The attributes of a cell spec (`2+^.>s`) or of a column spec. */
interface Spec {
  colspan?: number
  rowspan?: number
  repeat?: number
  halign?: 'left' | 'center' | 'right'
  valign?: 'top' | 'middle' | 'bottom'
  style?: TableCellStyle
}

const NO_SPEC: Spec = {}
const ALIGN = '([<^>](?:\\.[<^>]?)?|(?:[<^>]?\\.)?[<^>])?'
const COUNT = '(?:(\\d+(?:\\.\\d*)?|(?:\\d*\\.)?\\d+)([*+]))?'
/** CellSpecStartRx */
const SPEC_START = new RegExp(`^[ \\t]*${COUNT}${ALIGN}([a-z])?$`)
/** CellSpecEndRx, matched against what follows the last white space of the text before a separator. */
const SPEC_TAIL = new RegExp(`^${COUNT}${ALIGN}([a-z])?$`)
const COLUMN_SPEC = /^(?:(\d+)\*)?([<^>](?:\.[<^>]?)?|(?:[<^>]?\.)?[<^>])?(\d+%?|~)?([a-z])?$/

function alignments(spec: Spec, a: string | undefined): void {
  if (a === undefined) return
  const dot = a.indexOf('.')
  const h = dot < 0 ? a : a.slice(0, dot)
  const v = dot < 0 ? '' : a.slice(dot + 1)
  if (h && HALIGN[h]) spec.halign = HALIGN[h]
  if (v && VALIGN[v]) spec.valign = VALIGN[v]
}

/** The spec a match of `COUNT ALIGN STYLE` stands for (`Parser.parse_cellspec`). */
function specOf(
  count: string | undefined,
  op: string | undefined,
  align: string | undefined,
  style: string | undefined,
) {
  const spec: Spec = {}
  if (count !== undefined) {
    const dot = count.indexOf('.')
    const c = dot < 0 ? count : count.slice(0, dot)
    const r = dot < 0 ? '' : count.slice(dot + 1)
    const colspec = c === '' ? 1 : rubyToI(c)
    const rowspec = r === '' ? 1 : rubyToI(r)
    if (op === '+') {
      if (colspec !== 1) spec.colspan = Math.min(colspec, MAX_COLUMNS)
      if (rowspec !== 1) spec.rowspan = rowspec
    } else if (colspec !== 1) spec.repeat = Math.min(colspec, MAX_COLUMNS)
  }
  alignments(spec, align)
  if (style !== undefined && Object.hasOwn(STYLES, style)) spec.style = STYLES[style]
  return spec
}

interface Column {
  style: TableCellStyle | null
  halign: 'left' | 'center' | 'right'
  valign: 'top' | 'middle' | 'bottom'
  weight: number
  autowidth: boolean
  pc: number
}

const newColumn = (): Column => ({
  style: null,
  halign: 'left',
  valign: 'top',
  weight: 1,
  autowidth: false,
  pc: 0,
})

/** `Parser.parse_colspecs`: the columns `cols` describes. */
function parseColspecs(records: string): Column[] {
  if (records.includes(' ')) records = records.replace(/ /g, '')
  const cols: Column[] = []
  // the deprecated form: a single number, that many equal columns
  if (records === String(rubyToI(records))) {
    const n = Math.min(rubyToI(records), MAX_COLUMNS)
    for (let i = 0; i < n; i++) cols.push(newColumn())
    return cols
  }
  if (records === '') return cols
  for (const record of records.includes(',') ? records.split(',') : records.split(';')) {
    if (cols.length >= MAX_COLUMNS) break
    if (record === '') {
      cols.push(newColumn())
      continue
    }
    const m = COLUMN_SPEC.exec(record)
    if (!m) continue
    const spec: Spec = {}
    alignments(spec, m[2])
    const col = newColumn()
    if (spec.halign) col.halign = spec.halign
    if (spec.valign) col.valign = spec.valign
    if (m[3] !== undefined) {
      if (m[3] === '~') {
        col.weight = -1
        col.autowidth = true
      } else col.weight = rubyToI(m[3])
    }
    if (m[4] !== undefined && Object.hasOwn(STYLES, m[4])) col.style = STYLES[m[4]]!
    const times = m[1] === undefined ? 1 : Math.min(rubyToI(m[1]), MAX_COLUMNS - cols.length)
    for (let i = 0; i < times; i++) cols.push({ ...col })
  }
  return cols
}

/** `Table#assign_column_widths`, `create_columns` included (`explicit`: the columns come from `cols`). */
function assignWidths(cols: Column[], explicit: boolean): void {
  if (cols.length === 0) return
  let base: number | null = null
  let auto: Column[] | null = null
  if (explicit) {
    base = 0
    for (const c of cols) {
      if (c.weight < 0) (auto ??= []).push(c)
      else base += c.weight
    }
    if (!(base > 0 || auto)) base = null
  }
  let total = 0
  let pc = 0
  if (base !== null) {
    if (auto) {
      let w = 0
      if (base <= 100) {
        w = truncate4((100 - base) / auto.length)
        base = 100
      }
      for (const c of auto) {
        c.weight = w
        c.autowidth = true
      }
    }
    for (const c of cols) {
      pc = truncate4((c.weight * 100) / base)
      c.pc = pc
      total += pc
    }
  } else {
    pc = truncate4(100 / cols.length)
    for (const c of cols) {
      c.pc = pc
      total += pc
    }
  }
  if (total !== 100) cols[cols.length - 1]!.pc = round4(100 - total + pc)
}

// ------------------------------------------------------------------------------------------------ the scan

/** A cell of the table while it is read (`Table::Cell`). */
interface Cell {
  lex: Lex
  col: Column
  spec: Spec | null
  colspan: number | null
  rowspan: number | null
  halign: 'left' | 'center' | 'right'
  valign: 'top' | 'middle' | 'bottom'
  style: TableCellStyle | null
  text: string
  cFrom: number
  cTo: number
  first: boolean
  /** A cell of an implicit header that is read again if the header turns out not to be one. */
  again: Buf | null
  /** The part of the buffer of a cell with the `a` style. */
  doc: Kept | null
  // set by the numbering
  row: number
  column: number
}

type Header = true | 'implicit' | false | null

class Scan {
  readonly lines: readonly TableLine[]
  readonly format: 'psv' | 'csv' | 'dsv'
  readonly delim: string
  readonly lexes: Lex[] = []
  /** Problems, with the first and the last cell they are about (their ranges are worked out later). */
  readonly diags: { first: Lex; last: Lex; code: TableDiag['code']; message: string }[] = []
  cols: Column[] = []
  explicit = false
  hdr: Header = false
  body: Cell[][] = []
  /** The cells of the rows that were left out. */
  dropped: { cell: Cell; after: number }[] = []
  /** The cells of the rows that were kept. */
  private kept = 0
  private pos = 0
  private buf: Buf
  private readonly queue: Spec[] = []
  private qh = 0
  private cellOpen = false
  private linenum = -1
  private colcount = -1
  private columnVisits = 0
  private row: Cell[] = []
  private rowIdx = 0
  private active0 = 0
  private readonly diff = new Map<number, number>()
  private cur: Lex | null = null
  private here = 0
  private cells = 0
  private missing = false

  constructor(private readonly src: TableSource) {
    this.lines = src.lines
    const nested = src.nested
    let format: 'psv' | 'csv' | 'dsv' = 'psv'
    let xsv = nested ? '!sv' : 'psv'
    const f = src.format
    if (f !== null) {
      if (f === 'tsv') {
        format = 'csv'
        xsv = 'tsv'
      } else if (f === 'psv' || f === 'csv' || f === 'dsv') {
        format = f
        xsv = f === 'psv' && nested ? '!sv' : f
      }
    }
    this.format = format
    const sep = src.separator
    this.delim = sep === null || sep === '' ? DELIMITERS[xsv]! : sep === '\\t' ? '\t' : sep
    this.buf = new Buf(format === 'csv')
  }

  // -------------------------------------------------------------------------------------------- reading lines

  /** Reader#skip_blank_lines: the number of lines skipped, or null if no line is left. */
  private skipBlank(): number | null {
    const lines = this.lines
    let k = 0
    while (this.pos < lines.length) {
      if (lines[this.pos]!.text === '') {
        this.pos++
        k++
      } else return k
    }
    return null
  }

  run(): void {
    const src = this.src
    const lines = this.lines
    const n = lines.length
    const psv = this.format === 'psv'
    const delim = this.delim
    const dl = delim.length
    const specCols = src.cols !== null ? parseColspecs(src.cols) : []
    if (specCols.length > 0) {
      this.cols = specCols
      this.explicit = true
      this.colcount = specCols.length
      assignWidths(specCols, true)
    }
    const skipped = this.skipBlank() ?? 0
    let implicit = false
    if (src.header) this.hdr = true
    else if (skipped === 0 && !src.noheader) {
      this.hdr = 'implicit'
      implicit = true
    }
    let loopIdx = -1
    let boundary: number | null = null
    while (this.pos < n) {
      const ln = lines[this.pos++]!
      const T = ln.text
      let o = 0
      let nil = false
      const beyond = ++loopIdx > 0
      if (beyond && T === '') {
        nil = true
        if (boundary !== null) boundary++
      } else if (psv) {
        if (T.startsWith(delim)) {
          // the separator at the start of a line (a longer separator is cut after its first character, as Asciidoctor does)
          const w = charLen(T, 0)
          this.closeOpenCell(NO_SPEC, -1, -1, ln.from, ln.from + w)
          o = w
          boundary = null
        } else {
          const at = T.indexOf(delim)
          const m = at >= 0 ? SPEC_START.exec(T.slice(0, at)) : null
          if (m) {
            let lead = 0
            while (T.charCodeAt(lead) === 32 || T.charCodeAt(lead) === 9) lead++
            const has = lead < at
            this.closeOpenCell(
              specOf(m[1], m[2], m[3], m[4]),
              has ? ln.from + lead : -1,
              has ? ln.from + at : -1,
              ln.from + at,
              ln.from + at + dl,
            )
            o = at + dl
            boundary = null
          } else if (boundary !== null && boundary === loopIdx) {
            this.hdr = null
            implicit = false
            boundary = null
          }
        }
      }
      if (!beyond) {
        if (implicit) {
          if (this.pos < n && lines[this.pos]!.text === '') boundary = 1
          else {
            this.hdr = null
            implicit = false
          }
        }
      }
      for (;;) {
        const m = nil ? -1 : T.indexOf(delim, o)
        if (m >= 0) {
          const escaped = m > o && T.charCodeAt(m - 1) === 92
          let spec: Spec | null = null
          let specFrom = -1
          let specTo = -1
          if (this.format === 'csv') {
            const pre = T.slice(o, m)
            if (hasUnclosedQuotes(joinQuotes(this.buf.quotes, summarizeQuotes(pre)))) {
              // inside quotes: the separator belongs to the text
              this.buf.add(T.slice(o, m + dl), ln.from + o)
              o = m + dl
              if (o >= T.length) break
              continue
            }
            this.buf.add(pre, ln.from + o)
          } else if (escaped) {
            this.buf.add(T.slice(o, m - 1), ln.from + o)
            this.buf.add(delim, ln.from + m)
            o = m + dl
            if (o >= T.length) {
              this.buf.addLine(ln.nl, ln.next - ln.nl)
              this.cellOpen = true
              break
            }
            continue
          } else if (psv) {
            // the spec of the next cell stands at the end of the text before the separator
            let end = m
            let s = m
            while (s > o && T.charCodeAt(s - 1) !== 32 && T.charCodeAt(s - 1) !== 9) s--
            if (s > o) {
              // there is white space in front of the last word
              const tail = SPEC_TAIL.exec(T.slice(s, m))
              let w = s
              while (w > o && (T.charCodeAt(w - 1) === 32 || T.charCodeAt(w - 1) === 9)) w--
              if (tail) {
                spec = specOf(tail[1], tail[2], tail[3], tail[4])
                if (s < m) {
                  specFrom = ln.from + s
                  specTo = ln.from + m
                }
                end = w
              } else end = m
            } else if (m > o) end = m
            if (spec === null) {
              spec = NO_SPEC
              // a run of white space and nothing after it: the text is cut before it
              if (end === m && m > o && (T.charCodeAt(m - 1) === 32 || T.charCodeAt(m - 1) === 9)) {
                end = m
                while (end > o && isWs(T.charCodeAt(end - 1))) end--
              }
            }
            this.queue.push(spec)
            this.buf.add(T.slice(o, end), ln.from + o)
          } else this.buf.add(T.slice(o, m), ln.from + o)
          o = m + dl
          this.here = ln.from + m
          this.closeCell(false)
          this.startLex(specFrom, specTo, ln.from + m, ln.from + m + dl)
          if (o >= T.length) nil = true
          continue
        }
        // no separator left: the rest of the line goes into the buffer
        if (!nil) this.buf.add(T.slice(o), ln.from + o)
        this.buf.addLine(ln.nl, ln.next - ln.nl)
        this.here = ln.from + T.length
        if (this.format === 'csv') {
          if (hasUnclosedQuotes(this.buf.quotes)) {
            if (boundary !== null && loopIdx === 0) {
              this.hdr = null
              implicit = false
              boundary = null
            }
            this.cellOpen = true
          } else this.closeCell(true)
        } else if (this.format === 'dsv') this.closeCell(true)
        else this.cellOpen = true
        break
      }
      if (this.cellOpen) {
        if (this.pos >= n) this.closeCell(true)
      } else if (this.skipBlank() === null) break
    }
    // close_table
    if (this.columnVisits !== 0 && this.row.length > 0) {
      for (const cell of this.row) this.dropped.push({ cell, after: this.kept })
      this.diags.push({
        first: this.row[0]!.lex,
        last: this.row[this.row.length - 1]!.lex,
        code: 'table-incomplete-row',
        message: 'The cells of the last row do not fill it; they are left out of the table',
      })
    }
    if (!this.explicit) assignWidths(this.cols, false)
    if (implicit) this.hdr = true
  }

  // -------------------------------------------------------------------------------------------- cells

  private startLex(specFrom: number, specTo: number, sepFrom: number, sepTo: number): void {
    const lex: Lex = {
      specFrom,
      specTo,
      sepFrom,
      sepTo,
      cFrom: -1,
      cTo: -1,
      pos: sepTo,
      from: -1,
      to: -1,
    }
    this.lexes.push(lex)
    this.cur = lex
  }

  /** `ParserContext#close_open_cell`: a cell starts at the start of a line. */
  private closeOpenCell(spec: Spec, specFrom: number, specTo: number, sepFrom: number, sepTo: number): void {
    this.queue.push(spec)
    if (this.cellOpen) {
      this.here = sepFrom
      this.closeCell(true)
    }
    this.linenum++
    this.startLex(specFrom, specTo, sepFrom, sepTo)
  }

  /** `ParserContext#close_cell`. */
  private closeCell(eol: boolean): void {
    const buf = this.buf
    this.buf = new Buf(this.format === 'csv')
    let lex = this.cur
    this.cur = null
    if (!lex) {
      // text with no separator before it: the first cell of a table that does not start with one, or of a line of CSV
      lex = {
        specFrom: -1,
        specTo: -1,
        sepFrom: -1,
        sepTo: -1,
        cFrom: -1,
        cTo: -1,
        pos: this.here,
        from: -1,
        to: -1,
      }
      this.lexes.push(lex)
    }
    const text = buf.text
    let a = 0
    let b = text.length
    let squeeze = false
    let spec: Spec | null = null
    let full: [number, number] | null = null
    let repeat = 1
    if (this.format === 'psv') {
      const s = this.queue[this.qh]
      if (s !== undefined) {
        this.qh++
        if (this.qh > 4096 && this.qh * 2 > this.queue.length) {
          this.queue.splice(0, this.qh)
          this.qh = 0
        }
        spec = s
        repeat = s.repeat ?? 1
      } else {
        this.missing = true
        spec = NO_SPEC
      }
    } else {
      a = lstripAt(text, 0, b)
      b = rstripAt(text, a, b)
      full = buf.range(a, b)
      if (a < b && text.indexOf('"', a) >= 0 && text.indexOf('"', a) < b) {
        if (text.charCodeAt(a) === 34 && text.charCodeAt(b - 1) === 34) {
          if (b - a >= 2) {
            a = lstripAt(text, a + 1, b - 1)
            b = rstripAt(text, a, b - 1)
            squeeze = true
          } else a = b // a lone quote: "unclosed quote in CSV data", the cell is empty
        } else squeeze = true
      }
    }
    for (let i = 1; i <= repeat; i++) {
      if (this.cells >= MAX_CELLS) break
      let col: Column
      if (this.colcount === -1) {
        if (this.cols.length >= MAX_COLUMNS) break
        col = newColumn()
        this.cols.push(col)
        const cs = spec?.colspan
        if (cs !== undefined && cs - 1 > 0) {
          const extra = Math.min(cs - 1, MAX_COLUMNS - this.cols.length)
          for (let j = 0; j < extra; j++) this.cols.push(newColumn())
        }
      } else col = this.cols[this.row.length] ?? newColumn()
      const cell = this.newCell(
        col,
        { buf, a, b, squeeze },
        spec,
        lex,
        i === 1,
        this.hdr && this.body.length === 0 ? this.hdr : null,
      )
      this.cells++
      if (i === 1) {
        // the text of the cell as written: for CSV with the quotes around it
        const at = full ?? (cell.cFrom >= 0 ? ([cell.cFrom, cell.cTo] as [number, number]) : null)
        if (at) {
          lex.cFrom = at[0]
          lex.cTo = at[1]
        }
      }
      if (cell.rowspan !== null && cell.rowspan > 1) {
        const cs = cell.colspan ?? 1
        this.diff.set(this.rowIdx + 1, (this.diff.get(this.rowIdx + 1) ?? 0) + cs)
        this.diff.set(this.rowIdx + cell.rowspan, (this.diff.get(this.rowIdx + cell.rowspan) ?? 0) - cs)
      }
      this.columnVisits += cell.colspan ?? 1
      this.row.push(cell)
      const status = this.colcount === -1 ? 0 : Math.sign(this.columnVisits + this.active0 - this.colcount)
      if (status > -1 && (this.colcount !== -1 || this.linenum > 0 || (eol && i === repeat))) {
        if (status > 0) {
          this.diags.push({
            first: lex,
            last: lex,
            code: 'table-cell-dropped',
            message: 'The cell is left out with its row: the row has more cells than the table has columns',
          })
          this.closeRow(true)
        } else this.closeRow(false)
      }
    }
    this.cellOpen = false
  }

  private closeRow(drop: boolean): void {
    if (drop) for (const cell of this.row) this.dropped.push({ cell, after: this.kept })
    else {
      this.body.push(this.row)
      this.kept += this.row.length
    }
    if (this.colcount === -1) this.colcount = this.columnVisits
    this.columnVisits = 0
    this.row = []
    this.rowIdx++
    this.active0 += this.diff.get(this.rowIdx) ?? 0
  }

  /**
   * `Table::Cell#initialize`: the style, the alignments and the spans of a cell, and its text with the style applied.
   * `header`: the cell is in the header row (`true`) or in what may become one (`'implicit'`).
   */
  newCell(col: Column, kept: Kept, spec: Spec | null, lex: Lex, first: boolean, header: Header): Cell {
    let style: TableCellStyle | null = null
    let again: Buf | null = null
    if (header) {
      if (header === 'implicit') {
        const s = col.style ?? spec?.style ?? null
        if ((s === 'asciidoc' || s === 'literal') && spec !== null) again = kept.buf
      }
    } else style = col.style
    let { a, b } = kept
    let colspan: number | null = null
    let rowspan: number | null = null
    let halign = col.halign
    let valign = col.valign
    if (spec !== null) {
      colspan = spec.colspan ?? null
      rowspan = spec.rowspan ?? null
      if (!header && spec.style) style = spec.style
      if (spec.halign) halign = spec.halign
      if (spec.valign) valign = spec.valign
      const s = kept.buf.text
      a = 0
      b = s.length
      if (style === 'asciidoc') {
        b = rstripAt(s, 0, b)
        if (s.charCodeAt(0) === 10) while (a < b && s.charCodeAt(a) === 10) a++
        else a = lstripAt(s, 0, b)
      } else if (style === 'literal') {
        b = rstripAt(s, 0, b)
        while (a < b && s.charCodeAt(a) === 10) a++
      } else {
        a = lstripAt(s, 0, b)
        b = rstripAt(s, a, b)
      }
    }
    const k: Kept = { buf: kept.buf, a, b, squeeze: kept.squeeze }
    const r = k.buf.range(a, b)
    const cell: Cell = {
      lex,
      col,
      spec,
      colspan,
      rowspan,
      halign,
      valign,
      style,
      text: textOf(k),
      cFrom: r ? r[0] : -1,
      cTo: r ? r[1] : -1,
      first,
      again,
      doc: style === 'asciidoc' ? k : null,
      row: 0,
      column: 0,
    }
    return cell
  }

  get missingSeparator(): boolean {
    return this.missing
  }
}

/** The role of a fill: `cell-` and a name. */
export const FILL_ROLE = /^cell-[\w-]+$/

const FILL = /^\[\.(cell-[\w-]+)\](?:##\{empty\}##|#\{empty\}#(?![\p{L}\p{M}\p{N}\p{Pc}]))/u

/** The fill label at the start of the text of a cell that starts in the source at `at`, or null. */
export function cellFill(text: string, style: TableCellStyle | null, at: number): TableCellFill | null {
  const m = style === 'literal' ? null : FILL.exec(text)
  // (in a cell of documents the label must start a paragraph, not a description list item)
  return m && !(style === 'asciidoc' && /(?:::|;;)(?:\s|$)/.test(text.split('\n', 1)[0]!))
    ? { role: m[1]!, from: at, to: at + m[0].length }
    : null
}

/** The lexical cells with their ranges worked out. */
function finishLexes(lexes: Lex[]): void {
  for (const lex of lexes) {
    if (lex.cFrom < 0 || lex.cTo <= lex.cFrom) {
      lex.cFrom = lex.cTo = lex.sepTo >= 0 ? lex.sepTo : lex.pos
    }
    lex.from = lex.specFrom >= 0 ? lex.specFrom : lex.sepFrom >= 0 ? lex.sepFrom : lex.cFrom
    lex.to =
      lex.cTo > lex.cFrom ? lex.cTo : lex.sepTo >= 0 ? lex.sepTo : lex.specTo >= 0 ? lex.specTo : lex.from
    if (lex.to < lex.from) lex.to = lex.from
  }
}

/** Scans a table: the layout, the cells as the tree has them, the problems, the cells that hold documents. */
export function scanTable(src: TableSource, base: number): TableScan {
  const scan = new Scan(src)
  scan.run()
  const lexes = scan.lexes
  // the cells of an implicit header that is none: read again as the cells of a body row
  let body = scan.body
  let head: Cell[][] = []
  let foot: Cell[][] = []
  const headerOption = scan.hdr
  let left = body.length
  if (left > 0) {
    if (headerOption) {
      head = [body[0]!]
      body = body.slice(1)
      left--
    } else if (headerOption === null) {
      const first = body[0]!.map((c) =>
        c.again !== null
          ? scan.newCell(
              c.col,
              { buf: c.again, a: 0, b: c.again.text.length, squeeze: false },
              c.spec,
              c.lex,
              c.first,
              null,
            )
          : { ...c, style: c.spec?.style ?? c.col.style },
      )
      body = [first, ...body.slice(1)]
    }
  }
  if (left > 0 && src.footer) {
    foot = [body[body.length - 1]!]
    body = body.slice(0, -1)
  }
  finishLexes(lexes)
  // rows and columns as a document has them: a cell takes the first column that the rows above do not hold
  const busy: number[] = []
  let rowNo = 0
  const out = (rows: Cell[][]) =>
    rows.map((cells) => {
      let col = 0
      for (const c of cells) {
        while ((busy[col] ?? -1) >= rowNo) col++
        const cs = c.colspan ?? 1
        const rs = c.rowspan ?? 1
        if (rs > 0) for (let d = 0; d < cs; d++) busy[col + d] = Math.max(busy[col + d] ?? -1, rowNo + rs - 1)
        c.row = rowNo
        c.column = col
        col += cs
      }
      rowNo++
      return cells
    })
  const rows = { head: out(head), body: out(body), foot: out(foot) }
  const ascii: AsciiCell[] = []
  const modelOf = (c: Cell): TableCellModel => {
    const lex = c.lex
    const m: TableCellModel = {
      from: lex.from - base,
      to: lex.to - base,
      contentFrom: lex.cFrom - base,
      contentTo: lex.cTo - base,
      row: c.row,
      column: c.column,
      colspan: c.colspan ?? 1,
      rowspan: c.rowspan ?? 1,
      halign: c.halign,
      valign: c.valign,
      style: c.style,
      text: c.text,
      fill: cellFill(c.text, c.style, c.cFrom - base),
    }
    if (c.doc) {
      const k = c.doc
      ascii.push({
        lex,
        cell: m,
        map: () => {
          const s = k.buf.text
          const starts: number[] = []
          const ends: number[] = []
          let text = ''
          for (let v = k.a; v < k.b; v++) {
            if (k.squeeze && v > k.a && s.charCodeAt(v) === 34 && s.charCodeAt(v - 1) === 34) continue
            text += s[v]
            starts.push(k.buf.startOf(v))
            ends.push(k.buf.endOf(v))
          }
          return { text, starts, ends }
        },
      })
    }
    return m
  }
  const model: TableModel = {
    from: 0,
    to: 0,
    format: scan.format,
    separator: scan.delim,
    width: tableWidth(src.width),
    columns: scan.cols.map((c): TableColumnModel => ({
      width: c.pc,
      autowidth: c.autowidth,
      halign: c.halign,
      valign: c.valign,
      style: c.style,
    })),
    rows: {
      head: rows.head.map((r) => ({ cells: r.map(modelOf) })),
      body: rows.body.map((r) => ({ cells: r.map(modelOf) })),
      foot: rows.foot.map((r) => ({ cells: r.map(modelOf) })),
    },
    dropped: scan.dropped.map(({ cell: c, after }) => ({
      from: c.lex.from - base,
      to: c.lex.to - base,
      style: c.style,
      text: c.text,
      after,
    })),
  }
  // a diagnostic stays on the line where it starts
  const lineEnd = (pos: number): number => {
    let lo = 0
    let hi = src.lines.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (src.lines[mid]!.from <= pos) lo = mid
      else hi = mid - 1
    }
    const l = src.lines[lo]
    return l && l.from <= pos ? l.from + l.text.length : pos
  }
  const diags = scan.diags.map((d): TableDiag => {
    const from = d.first.from
    const e = lineEnd(from)
    const to = d.last.to
    return { from, to: to > e && e > from ? e : to, code: d.code, message: d.message }
  })
  if (scan.missingSeparator) {
    const first = src.lines.find((l) => l.text !== '')
    if (first)
      diags.push({
        from: first.from,
        to: first.from + first.text.length,
        code: 'table-missing-separator',
        message:
          'The first cell of the table has no separator before it; the text before the first separator is a cell',
      })
  }
  return { model, lex: lexes, diags, ascii }
}

/** The cells of a scanned table as tree nodes, and a leaf for each blank line that is in no cell. */
export function tableNodes(scan: TableScan, lines: readonly TableLine[], docs: ReadonlyMap<Lex, N[]>): N[] {
  const out: N[] = []
  let li = 0
  const blanksBefore = (limit: number): void => {
    for (; li < lines.length && lines[li]!.from < limit; li++) {
      const l = lines[li]!
      if (l.text === '') out.push(leaf(Type.BlankLine, l.from, l.next))
    }
  }
  for (const lex of scan.lex) {
    if (lex.to <= lex.from) continue
    blanksBefore(lex.from)
    const kids: (N | null)[] = []
    if (lex.specFrom >= 0 && lex.specTo > lex.specFrom)
      kids.push(leaf(Type.CellSpec, lex.specFrom, lex.specTo))
    if (lex.sepFrom >= 0 && lex.sepTo > lex.sepFrom)
      kids.push(leaf(Type.CellSeparator, lex.sepFrom, lex.sepTo))
    if (lex.cTo > lex.cFrom) {
      const blocks = docs.get(lex)
      kids.push(
        blocks && blocks.length
          ? rawNode(Type.CellContent, lex.cFrom, lex.cTo, blocks)
          : leaf(Type.CellContent, lex.cFrom, lex.cTo),
      )
    }
    out.push(node(Type.TableCell, lex.from, lex.to, clean(kids)))
    // the lines the cell holds are not blank lines of the table
    while (li < lines.length && lines[li]!.from < lex.to) li++
  }
  blanksBefore(Infinity)
  return out
}
