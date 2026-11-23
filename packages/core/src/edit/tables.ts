/**
 * Operations on tables, in all four formats and at any depth: the text of a cell, rows, columns, merged cells, the
 * options of the table, the style and the alignment of a cell, the widths of the columns, and a table in a cell.
 *
 * An operation works on the layout of the table (`NotaDocument.tableAt`): it says what the cells will be (a plan: the
 * cells that stay, with what changes in them, and the new ones), and the text is written from that — the cells that
 * go are cut out with the white space after them, a new cell is put among its neighbours with the white space they
 * keep between them, the spec of a cell and the `cols` of the table are changed where they stand. Then the table is read
 * again: it has to be the plan, with no new diagnostics of a table, and the document outside of the table has to be the
 * same. A table that is written in a way the operation cannot keep (a cell that repeats with `3*`, a cell dropped
 * for a row that is too long) is refused with `unsupported`.
 */
import type { SyntaxNode } from '@lezer/common'
import { type Change, normalizeTextChanges } from '../changes.js'
import type { NotaDocument } from '../document.js'
import { type TableCellModel, type TableCellStyle, type TableModel, cellBars, tableModel } from '../nodes.js'
import { type OperationFailure, type OperationResult, failure } from './common.js'
import { FILL_ROLE } from '../parse/table.js'
import { cellMap } from './cell.js'
import { escapeCell } from './escape.js'
import { irregular, isTableNode } from './tablecheck.js'
import { type Env, deleteBlock, lazyEnvOf, mapPosition, noTarget } from './structure.js'
import { leaks } from './verify.js'

// ---------------------------------------------------------------- the table

type Format = 'psv' | 'csv' | 'dsv'

interface Cell extends TableCellModel {
  /** Its place among the cells in the order of the text. */
  readonly idx: number
}

interface Tbl {
  readonly env: Env
  readonly node: SyntaxNode
  readonly model: TableModel
  readonly cells: readonly Cell[]
  readonly nrows: number
  readonly ncols: number
  readonly format: Format
  readonly sep: string
  /** The separators of the tables around, innermost first. */
  readonly outer: readonly string[]
  /** How many tables hold this one, itself counted. */
  readonly depth: number
}

/** A cell as the plan has it: the values the table must show once it is written. */
interface Ex {
  row: number
  column: number
  colspan: number
  rowspan: number
  halign: TableCellModel['halign']
  valign: TableCellModel['valign']
  style: TableCellStyle | null
  text: string
}

/** A cell of the table after the operation: an old one, or (`old` null) a new one. */
interface Entry {
  readonly old: Cell | null
  ex: Ex
}

const exOf = (c: TableCellModel): Ex => ({
  row: c.row,
  column: c.column,
  colspan: c.colspan,
  rowspan: c.rowspan,
  halign: c.halign,
  valign: c.valign,
  style: c.style,
  text: c.text,
})

const unsupported = (why: string, t?: Tbl): OperationFailure =>
  failure('unsupported', why, t?.model.from ?? 0, t?.model.to ?? 0)

function flatten(model: TableModel): Cell[] {
  const out: Cell[] = []
  for (const part of [model.rows.head, model.rows.body, model.rows.foot])
    for (const r of part) for (const c of r.cells) out.push({ ...c, idx: out.length })
  return out
}

/** Whether the cells of the table, in the order of the rows, are the plan (cell by cell, without building a copy of the table). */
function readsAs(model: TableModel, plan: readonly (Ex & { idx?: number })[], idx = -1, text = ""): boolean {
  let i = 0
  for (const part of [model.rows.head, model.rows.body, model.rows.foot])
    for (const r of part)
      for (const c of r.cells) {
        const p = plan[i++]
        if (
          !p ||
          p.row !== c.row ||
          p.column !== c.column ||
          p.colspan !== c.colspan ||
          p.rowspan !== c.rowspan ||
          p.halign !== c.halign ||
          p.valign !== c.valign ||
          p.style !== c.style ||
          (p.idx === idx ? text : p.text) !== c.text
        )
          return false
      }
  return i === plan.length
}

/** The table that holds a position (the innermost one), or null. */
function tableAround(env: Env, at: number): Tbl | null {
  const { doc } = env
  if (at < 0 || at >= doc.text.length) return null
  const model = doc.tableAt(at)
  if (!model) return null
  let node: SyntaxNode | null = null
  for (let n: SyntaxNode | null = doc.tree.resolveInner(at, 1); n; n = n.parent)
    if (n.name === 'DelimitedBlock' && n.tree?.prop(tableModel)) {
      node = n
      break
    }
  if (!node) return null
  const cells = flatten(model)
  let depth = 0
  for (let n: SyntaxNode | null = node; n; n = n.parent) if (n.name === 'DelimitedBlock' && n.tree?.prop(tableModel)) depth++
  return {
    env,
    node,
    model,
    cells,
    nrows: model.rows.head.length + model.rows.body.length + model.rows.foot.length,
    ncols: model.columns.length,
    format: model.format,
    sep: model.separator,
    outer: cellBars(node),
    depth,
  }
}

/** The cell of a table at a position (or the one after it, or the last). */
function cellAt(t: Tbl, at: number): Cell | null {
  // (an empty first field of a row of csv or dsv has no extent and stands where the next field starts: the place is its own)
  const empty = t.cells.find((c) => c.from === c.to && c.from === at)
  if (empty) return empty
  // (the cell the place is inside of, else one the place touches, else the next one)
  const inside = t.cells.find((c) => c.from <= at && at < c.to)
  if (inside) return inside
  const touching = t.cells.find((c) => c.from <= at && at <= c.to)
  if (touching) return touching
  let after: Cell | null = null
  for (const c of t.cells) if (c.from > at && (!after || c.from < after.from)) after = c
  return after ?? t.cells[t.cells.length - 1] ?? null
}

/** Whether the cells tile the grid, each once, and the table has nothing that this module could not write back. */
function regular(t: Tbl): OperationFailure | null {
  const why = irregular(t.model)
  return why ? unsupported(why, t) : null
}

const entriesOf = (t: Tbl): Entry[] => t.cells.map((c) => ({ old: c, ex: exOf(c) }))

const byPlace = (a: Entry, b: Entry): number => a.ex.row - b.ex.row || a.ex.column - b.ex.column

const ROLE = 'That would change the header or the footer of the table'

// ---------------------------------------------------------------- checking the result

const tableCodes = (doc: NotaDocument): Map<string, number> => {
  const m = new Map<string, number>()
  for (const d of doc.diagnostics) if (d.code?.startsWith('table-')) m.set(d.code, (m.get(d.code) ?? 0) + 1)
  return m
}

/** The failure `collateral` for a code of a diagnostic of a table that the document has more of after than before. */
function newCode(t: Tbl, after: NotaDocument): OperationFailure | null {
  const was = tableCodes(t.env.doc)
  for (const [code, n] of tableCodes(after))
    if (n > (was.get(code) ?? 0)) return failure('collateral', `That would make a new ${code}`, t.model.from, t.model.to)
  return null
}

/**
 * Applies the changes, reads the table again and checks it: the cells are the plan, the table has `ncols` columns, no
 * diagnostic of a table is new, and the document outside of the table is as it was.
 */
function commitTable(
  t: Tbl,
  changes: readonly Change[],
  plan: readonly Ex[] | null,
  ncols: number,
  check?: (model: TableModel) => boolean,
  nrows: number = t.nrows,
  shape: { head: readonly number[]; foot: readonly number[] } | 'free' = { head: [t.model.rows.head.length], foot: [t.model.rows.foot.length] },
  local = false,
): OperationResult {
  const { doc, text } = t.env
  let norm: Change[]
  try {
    norm = normalizeTextChanges(changes, text.length)
  } catch {
    return failure('invalid-target', 'The changes overlap', t.model.from, t.model.to)
  }
  if (norm.length === 0) return { doc, changes: [] }
  const after = doc.update(norm)
  const delim = t.node.getChild('BlockDelimiter')
  const probe = mapPosition(norm, delim ? delim.from : t.model.from)
  const model = after.tableAt(Math.min(probe, after.text.length - 1))
  if (!model || model.format !== t.format) return unsupported('The table cannot be written back that way', t)
  const region: [number, number] = [model.from, model.to]
  // (a change inside of one cell that leaves the table where it was, and all of it reading as planned, cannot touch the
  // rest of the document: the text outside the table is the same, so the ASG of the whole document is not compared; it
  // costs most of the time of a keystroke in a big table)
  const shifted = after.text.length - text.length
  const stays = local && model.from === t.model.from && model.to === t.model.to + shifted
  if (!stays) {
    const bad = leaks(doc, after, [t.model.from, t.model.to], region, t.model.from, t.model.to)
    if (bad) return bad
  }
  const rowsNow = model.rows.head.length + model.rows.body.length + model.rows.foot.length
  if (model.columns.length !== ncols || rowsNow !== nrows || (plan && !readsAs(model, plan)) || (check && !check(model)))
    return unsupported('The table does not read as the operation made it', t)
  // (the header and the footer stay: an implicit header that a change would turn into a body row is a loss)
  if (shape !== 'free' && (!shape.head.includes(model.rows.head.length) || !shape.foot.includes(model.rows.foot.length)))
    return unsupported(ROLE, t)
  // (nor are the diagnostics of the document worked out for a change like that: the cells are as before, but for a text)
  return (stays ? null : newCode(t, after)) ?? { doc: after, changes: norm }
}

// ---------------------------------------------------------------- the spec of a cell

interface Spec {
  cs: number
  rs: number
  h: string
  v: string
  style: string
}

const SPEC = /^(?:(\d+)?(?:\.(\d+))?\+)?([<^>])?(?:\.([<^>]))?([a-z])?$/
const H = { left: '<', center: '^', right: '>' } as const
const V = { top: '<', middle: '^', bottom: '>' } as const
const LETTER: Record<TableCellStyle, string> = {
  asciidoc: 'a',
  emphasis: 'e',
  header: 'h',
  literal: 'l',
  monospaced: 'm',
  none: 'd',
  strong: 's',
}

function parseSpec(s: string): Spec | null {
  const m = SPEC.exec(s)
  if (!m) return null
  return { cs: m[1] ? Number(m[1]) : 1, rs: m[2] ? Number(m[2]) : 1, h: m[3] ?? '', v: m[4] ?? '', style: m[5] ?? '' }
}

function printSpec(s: Spec): string {
  const span = s.cs > 1 || s.rs > 1 ? `${s.cs > 1 ? s.cs : ''}${s.rs > 1 ? '.' + s.rs : ''}+` : ''
  return span + s.h + (s.v ? '.' + s.v : '') + s.style
}

/** Where the separator of a cell of a table of the format `psv` is. */
function sepOf(t: Tbl, c: Cell): number {
  const i = t.env.text.indexOf(t.sep, c.from)
  return i < 0 || i > c.contentFrom ? -1 : i
}

/** The change of the spec of a cell so that it reads as `ex`, or null when it does already, or why it cannot be done. */
function specChange(t: Tbl, c: Cell, ex: Ex): Change | null | OperationFailure {
  if (ex.colspan === c.colspan && ex.rowspan === c.rowspan && ex.halign === c.halign && ex.valign === c.valign && ex.style === c.style)
    return null
  const i = sepOf(t, c)
  if (i < 0) return unsupported('The separator of a cell is not found', t)
  const old = t.env.text.slice(c.from, i)
  const spec = parseSpec(old)
  if (!spec) return unsupported(`The spec of a cell (${old}) is not one this edit can change`, t)
  spec.cs = ex.colspan
  spec.rs = ex.rowspan
  if (ex.halign !== c.halign) spec.h = H[ex.halign]
  if (ex.valign !== c.valign) spec.v = V[ex.valign]
  if (ex.style !== c.style) {
    const column = t.model.columns[c.column]
    spec.style = ex.style === null ? (column?.style ? 'd' : '') : LETTER[ex.style]
  }
  const insert = printSpec(spec)
  return insert === old ? null : { from: c.from, to: i, insert }
}

// ---------------------------------------------------------------- the attributes of the table

interface Cols {
  /** One entry for each column: `<.^3a`. */
  readonly entries: string[]
  readonly form: 'none' | 'count' | 'list'
  /** The list was one item with a multiplier (`3*`), and `bare`: with nothing after it. */
  readonly single: boolean
  readonly bare: boolean
  readonly value: SyntaxNode | null
}

const ENTRY = /^([<^>])?(?:\.([<^>]))?(\d+%?|~)?([a-z])?$/

function attributeLines(t: Tbl): SyntaxNode[] {
  return t.node.getChildren('BlockAttributes')
}

function namedAttribute(t: Tbl, names: readonly string[]): { attr: SyntaxNode; value: SyntaxNode }[] {
  const out: { attr: SyntaxNode; value: SyntaxNode }[] = []
  for (const line of attributeLines(t))
    for (let a = line.firstChild; a; a = a.nextSibling) {
      if (a.name !== 'NamedAttribute') continue
      const name = a.getChild('AttributeName')
      const value = a.getChild('AttributeValue')
      if (name && value && names.includes(t.env.text.slice(name.from, name.to).toLowerCase())) out.push({ attr: a, value })
    }
  return out
}

function readCols(t: Tbl): Cols | OperationFailure {
  const found = namedAttribute(t, ['cols']).pop()
  if (!found) return { entries: Array<string>(t.ncols).fill('1'), form: 'none', single: false, bare: false, value: null }
  let raw = t.env.text.slice(found.value.from, found.value.to)
  if (raw.length >= 2 && (raw[0] === '"' || raw[0] === "'") && raw[raw.length - 1] === raw[0]) raw = raw.slice(1, -1)
  if (raw.includes('{')) return unsupported('The `cols` has an attribute reference', t)
  if (/^\d+$/.test(raw)) {
    if (Number(raw) !== t.ncols) return unsupported('The `cols` is not what the table reads as', t)
    return { entries: Array<string>(t.ncols).fill('1'), form: 'count', single: false, bare: false, value: found.value }
  }
  const entries: string[] = []
  const items = raw.split(',').map((s) => s.trim())
  for (const item of items) {
    const m = /^(?:(\d+)\*)?(.*)$/.exec(item)!
    if (!ENTRY.test(m[2]!) || (m[2] === '' && !m[1])) return unsupported('The `cols` cannot be changed', t)
    const n = m[1] ? Number(m[1]) : 1
    if (n < 1 || n > 1000) return unsupported('The `cols` cannot be changed', t)
    for (let i = 0; i < n; i++) entries.push(m[2] === '' ? '1' : m[2]!)
  }
  if (entries.length !== t.ncols) return unsupported('The `cols` is not what the table reads as', t)
  const single = items.length === 1 && entries.length > 1
  return { entries, form: 'list', single, bare: single && /^\d+\*$/.test(items[0]!), value: found.value }
}

function printCols(cols: Cols, entries: readonly string[]): string {
  // (one number alone is the number of columns: a table of one column needs no width)
  if (entries.length === 1 && /^\d+$/.test(entries[0]!)) return '1'
  if (cols.form !== 'list' && entries.every((e) => e === '1')) return String(entries.length)
  if (cols.single && entries.length > 1 && entries.every((e) => e === entries[0])) return `${entries.length}*${cols.bare && entries[0] === '1' ? '' : entries[0]}`
  return entries.join(',')
}

/** The line of attributes and the place in it where one more attribute goes. */
function addAttribute(t: Tbl, src: string): Change {
  const { text, eol } = t.env
  const lines = attributeLines(t)
  const line = lines[lines.length - 1]
  if (line) {
    const close = line.getChildren('Mark').filter((m) => text[m.from] === ']').pop()
    if (close) {
      const open = line.firstChild
      const empty = !!open && open.nextSibling === close
      return { from: close.from, to: close.from, insert: (empty ? '' : ',') + src }
    }
  }
  const delim = t.node.getChild('BlockDelimiter')
  const at = delim ? delim.from : t.node.from
  return { from: at, to: at, insert: `[${src}]${eol}` }
}

/** The change that gives the table these `cols` (none when it has them already). */
function setCols(t: Tbl, cols: Cols, entries: readonly string[]): Change | null {
  const value = printCols(cols, entries)
  if (cols.value) {
    const raw = t.env.text.slice(cols.value.from, cols.value.to)
    const q = raw[0] === '"' || raw[0] === "'" ? raw[0] : /^[\w.~-]+$/.test(value) ? '' : '"'
    const insert = q + value + q
    return insert === raw ? null : { from: cols.value.from, to: cols.value.to, insert }
  }
  if (entries.every((e) => e === '1')) return null
  return addAttribute(t, `cols="${value}"`)
}

/** `cols` entries of a column changed: alignment, width, style (null keeps). */
function withEntry(e: string, to: { h?: string; v?: string; w?: string; s?: string }): string {
  const m = ENTRY.exec(e)!
  const h = to.h ?? m[1] ?? ''
  const v = to.v ?? m[2] ?? ''
  const w = to.w === undefined ? (m[3] ?? '') : to.w + (m[3]?.endsWith('%') ? '%' : '')
  const s = to.s ?? m[4] ?? ''
  return h + (v ? '.' + v : '') + w + s
}

// ---------------------------------------------------------------- writing the cells

const EMPTY_GAP = /^[ \t\r\n]*$/

/** What stands between two cells, as the white space that is kept when a cell is put there. */
function normGap(t: Tbl, s: string): string {
  const { eol } = t.env
  if (EMPTY_GAP.test(s)) {
    const n = (s.match(/\n/g) ?? []).length
    return n > 0 ? eol.repeat(n) : s
  }
  return s.includes('\n') ? eol : ' '
}

/** The white space the table has most often between the cells of a row (`cell`) and between its rows (`row`). */
function gapsOf(t: Tbl): { cell: string; row: string } {
  const cell = new Map<string, number>()
  const row = new Map<string, number>()
  for (let i = 0; i + 1 < t.cells.length; i++) {
    const a = t.cells[i]!
    const b = t.cells[i + 1]!
    const g = normGap(t, t.env.text.slice(a.to, b.from))
    const m = a.row === b.row ? cell : row
    m.set(g, (m.get(g) ?? 0) + 1)
  }
  const top = (m: Map<string, number>, d: string): string => {
    let best = d
    let n = 0
    for (const [k, v] of m)
      if (v > n) {
        best = k
        n = v
      }
    return best
  }
  return { cell: top(cell, ' '), row: top(row, t.env.eol) }
}

/**
 * The cells cut out of the text: each run of them with the white space after it, or (the cells at the end of a row, whose
 * row stays) with the white space before it, so that the line break that ends the row stays.
 */
function removals(t: Tbl, gone: ReadonlySet<number>): Change[] | OperationFailure {
  const out: Change[] = []
  const cells = t.cells
  for (let i = 0; i < cells.length; i++) {
    if (!gone.has(i)) continue
    let j = i
    while (j + 1 < cells.length && gone.has(j + 1)) j++
    const prev = i > 0 ? cells[i - 1]! : null
    const next = j + 1 < cells.length ? cells[j + 1]! : null
    const prevSame = !!prev && prev.row === cells[i]!.row
    const nextSame = !!next && next.row === cells[j]!.row
    if (next && (nextSame || !prevSame)) out.push({ from: cells[i]!.from, to: next.from, insert: '' })
    else if (prev) out.push({ from: prev.to, to: cells[j]!.to, insert: '' })
    else return unsupported('Every cell of the table would go', t)
    i = j
  }
  return out
}

/** The changes that write a plan of a table of the format `psv`. */
function psvChanges(t: Tbl, plan: readonly Entry[], headRows: number): Change[] | OperationFailure {
  const out: Change[] = []
  const kept = new Set<number>()
  for (const e of plan) {
    if (!e.old) continue
    kept.add(e.old.idx)
    const c = specChange(t, e.old, e.ex)
    if (c && 'error' in c) return c
    if (c) out.push(c)
  }
  const gone = new Set<number>()
  for (const c of t.cells) if (!kept.has(c.idx)) gone.add(c.idx)
  const cut = removals(t, gone)
  if ('error' in cut) return cut
  out.push(...cut)
  const gaps = gapsOf(t)
  for (let i = 0; i < plan.length; i++) {
    if (plan[i]!.old) continue
    let j = i
    while (j + 1 < plan.length && !plan[j + 1]!.old) j++
    const run = plan.slice(i, j + 1)
    let prev: Entry | null = null
    for (let k = i - 1; k >= 0; k--)
      if (plan[k]!.old) {
        prev = plan[k]!
        break
      }
    const next = plan.slice(j + 1).find((e) => e.old) ?? null
    const between = (a: Ex, b: Ex): string => (a.row === b.row ? gaps.cell : gaps.row)
    const cellsSrc = (): string => {
      let s = ''
      run.forEach((e, k) => {
        if (k > 0) s += between(run[k - 1]!.ex, e.ex)
        s += t.sep
      })
      return s
    }
    const first = run[0]!.ex
    const last = run[run.length - 1]!.ex
    const afterHead = headRows > 0 && first.row === headRows && first.column === 0 && last.row !== next?.ex.row
    if (next && (!prev || last.row === next.ex.row || afterHead)) {
      const tail = last.row === next.ex.row ? gaps.cell : gaps.row
      out.push({ from: next.old!.from, to: next.old!.from, insert: cellsSrc() + tail })
    } else if (prev) {
      out.push({ from: prev.old!.to, to: prev.old!.to, insert: between(prev.ex, first) + cellsSrc() })
    } else return unsupported('Every cell of the table would go', t)
    i = j
  }
  return out
}

/** The changes that write a plan of a table of the format `csv` or `dsv` (a row is a line of fields). */
function lineChanges(t: Tbl, plan: readonly Entry[]): Change[] | OperationFailure {
  const { text, eol } = t.env
  const oldRows: Cell[][] = []
  for (const c of t.cells) (oldRows[c.row] ??= []).push(c)
  const newRows: Entry[][] = []
  for (const e of plan) (newRows[e.ex.row] ??= []).push(e)
  const empty = t.format === 'csv' && t.ncols === 1 ? '""' : ''
  const out: Change[] = []
  const origin: (number | null)[] = newRows.map((row) => {
    const o = row?.find((e) => e.old)
    return o ? o.old!.row : null
  })
  const used = new Set<number>()
  for (let r = 0; r < newRows.length; r++) {
    const row = newRows[r]
    if (!row) return unsupported('The table would have a row with no cells', t)
    const o = origin[r]
    if (o === null || o === undefined) continue
    if (used.has(o) || row.some((e) => e.old && e.old.row !== o)) return unsupported('A row of the table would be made of two', t)
    used.add(o)
    const was = oldRows[o]!
    if (row.length === was.length && row.every((e, k) => e.old === was[k])) continue
    const fields = row.map((e) => (e.old ? text.slice(e.old.contentFrom, e.old.contentTo) : empty))
    out.push({ from: was[0]!.from, to: was[was.length - 1]!.to, insert: fields.join(t.sep) })
  }
  // rows that go
  for (let r = 0; r < oldRows.length; r++) {
    if (used.has(r)) continue
    let q = r
    while (q + 1 < oldRows.length && !used.has(q + 1)) q++
    if (q + 1 < oldRows.length) out.push({ from: oldRows[r]![0]!.from, to: oldRows[q + 1]![0]!.from, insert: '' })
    else if (r > 0) out.push({ from: oldRows[r - 1]![oldRows[r - 1]!.length - 1]!.to, to: oldRows[q]![oldRows[q]!.length - 1]!.to, insert: '' })
    else return unsupported('Every row of the table would go', t)
    r = q
  }
  // rows that come
  for (let r = 0; r < newRows.length; r++) {
    if (origin[r] !== null) continue
    let q = r
    while (q + 1 < newRows.length && origin[q + 1] === null) q++
    const lines: string[] = []
    for (let k = r; k <= q; k++) lines.push(Array<string>(t.ncols).fill(empty).join(t.sep))
    let prev: number | null = null
    for (let k = r - 1; k >= 0; k--)
      if (origin[k] !== null) {
        prev = origin[k]!
        break
      }
    let next: number | null = null
    for (let k = q + 1; k < newRows.length; k++)
      if (origin[k] !== null) {
        next = origin[k]!
        break
      }
    if (prev !== null) {
      const at = oldRows[prev]![oldRows[prev]!.length - 1]!.to
      out.push({ from: at, to: at, insert: lines.map((l) => eol + l).join('') })
    } else if (next !== null) {
      const at = oldRows[next]![0]!.from
      out.push({ from: at, to: at, insert: lines.map((l) => l + eol).join('') })
    } else return unsupported('Every row of the table would go', t)
    r = q
  }
  return out
}

function planChanges(t: Tbl, plan: readonly Entry[]): Change[] | OperationFailure {
  return t.format === 'psv' ? psvChanges(t, plan, t.model.rows.head.length) : lineChanges(t, plan)
}

/** Writes a plan: the cells, the attributes of the table, and the check. */
function writePlan(
  t: Tbl,
  plan: Entry[],
  attrs: readonly Change[],
  ncols: number,
  nrows: number = t.nrows,
  shape?: { head: readonly number[]; foot: readonly number[] },
): OperationResult {
  plan.sort(byPlace)
  const changes = planChanges(t, plan)
  if ('error' in changes) return changes
  return commitTable(t, [...changes, ...attrs], plan.map((e) => e.ex), ncols, undefined, nrows, shape)
}

// ---------------------------------------------------------------- where

function located(env: Env, at: number): { t: Tbl; cell: Cell } | OperationFailure {
  const t = tableAround(env, at)
  if (!t) return noTarget(at)
  const cell = cellAt(t, at)
  if (!cell) return noTarget(at)
  return { t, cell }
}

function structural(env: Env, at: number): { t: Tbl; cell: Cell } | OperationFailure {
  const r = located(env, at)
  if ('error' in r) return r
  const bad = regular(r.t)
  return bad ?? r
}

// ---------------------------------------------------------------- the text of a cell

export function setCellText(env: Env, at: number, text: string): OperationResult {
  if (typeof text !== 'string') return failure('invalid-block', 'The text of a cell is a string', at, at)
  const r = located(env, at)
  if ('error' in r) return r
  const { t, cell } = r
  const src = escapeCell(text, t.format, t.sep, t.outer)
  if (src === null) return failure('unwritable', 'That text cannot be written in the cell', cell.from, cell.to)
  const empty = text === '' && t.format !== 'psv' && t.ncols === 1 ? '""' : src
  const raw = env.text.slice(cell.contentFrom, cell.contentTo)
  if (raw === empty && cell.text === text) return { doc: env.doc, changes: [] }
  // (the plan: every cell as it was, the text of this one as given; compared cell by cell, without a copy of the table)
  const same = (model: TableModel): boolean => readsAs(model, t.cells, cell.idx, text)
  return commitTable(t, [{ from: cell.contentFrom, to: cell.contentTo, insert: empty }], null, t.ncols, same, undefined, undefined, true)
}

// ---------------------------------------------------------------- rows

const freshEx = (t: Tbl, row: number, column: number): Ex => {
  const col = t.model.columns[Math.min(column, t.ncols - 1)]
  return {
    row,
    column,
    colspan: 1,
    rowspan: 1,
    halign: col?.halign ?? 'left',
    valign: col?.valign ?? 'top',
    style: col?.style ?? null,
    text: '',
  }
}

export function insertRow(env: Env, at: number, where: 'before' | 'after' = 'after'): OperationResult {
  if (where !== 'before' && where !== 'after') return failure('invalid-target', 'Insert before or after', at, at)
  const r = structural(env, at)
  if ('error' in r) return r
  const { t, cell } = r
  const b = where === 'before' ? cell.row : cell.row + cell.rowspan
  // (a new row there takes the role)
  if ((b === 0 && t.model.rows.head.length > 0) || (b >= t.nrows && t.model.rows.foot.length > 0))
    return unsupported(ROLE, t)
  const covered = new Set<number>()
  const plan = entriesOf(t)
  for (const e of plan) {
    if (e.ex.row >= b) e.ex = { ...e.ex, row: e.ex.row + 1 }
    else if (e.ex.row + e.ex.rowspan > b) {
      e.ex = { ...e.ex, rowspan: e.ex.rowspan + 1 }
      for (let k = e.ex.column; k < e.ex.column + e.ex.colspan; k++) covered.add(k)
    }
  }
  for (let k = 0; k < t.ncols; k++) if (!covered.has(k)) plan.push({ old: null, ex: freshEx(t, b, k) })
  return writePlan(t, plan, [], t.ncols, t.nrows + 1)
}

export function deleteRow(env: Env, at: number, where?: 'before' | 'after'): OperationResult {
  const r = structural(env, at)
  if ('error' in r) return r
  const { t, cell } = r
  const row = where === 'before' ? cell.row - 1 : where === 'after' ? cell.row + cell.rowspan : cell.row
  if (row < 0 || row >= t.nrows) return failure('invalid-target', 'There is no row there', at, at)
  if (t.nrows === 1) return failure('invalid-target', 'The last row of a table stays', at, at)
  const plan: Entry[] = []
  for (const e of entriesOf(t)) {
    const { row: r0, rowspan } = e.ex
    if (r0 === row) {
      if (rowspan > 1) return failure('invalid-span', 'A cell that spans rows would go with its row', e.old!.from, e.old!.to)
      continue
    }
    if (r0 < row && r0 + rowspan > row) e.ex = { ...e.ex, rowspan: rowspan - 1 }
    else if (r0 > row) e.ex = { ...e.ex, row: r0 - 1 }
    plan.push(e)
  }
  // (a deleted row of the header or the footer may leave the role to the next one, or not)
  const h = t.model.rows.head.length
  const f = t.model.rows.foot.length
  const inHead = row < h
  const inFoot = row >= t.nrows - f
  return writePlan(t, plan, [], t.ncols, t.nrows - 1, {
    head: inHead ? [h, h - 1] : [h],
    foot: inFoot ? [f, f - 1] : [f],
  })
}

// ---------------------------------------------------------------- columns

export function insertColumn(env: Env, at: number, where: 'before' | 'after' = 'after'): OperationResult {
  if (where !== 'before' && where !== 'after') return failure('invalid-target', 'Insert before or after', at, at)
  const r = structural(env, at)
  if ('error' in r) return r
  const { t, cell } = r
  const b = where === 'before' ? cell.column : cell.column + cell.colspan
  const cols = readCols(t)
  if ('error' in cols) return cols
  const plan = entriesOf(t)
  const crossed = new Set<number>()
  for (const e of plan) {
    if (e.ex.column >= b) e.ex = { ...e.ex, column: e.ex.column + 1 }
    else if (e.ex.column + e.ex.colspan > b) {
      e.ex = { ...e.ex, colspan: e.ex.colspan + 1 }
      for (let k = e.ex.row; k < e.ex.row + e.ex.rowspan; k++) crossed.add(k)
    }
  }
  for (let k = 0; k < t.nrows; k++)
    if (!crossed.has(k)) plan.push({ old: null, ex: { ...freshEx(t, k, b), halign: 'left', valign: 'top', style: null } })
  const entries = [...cols.entries]
  entries.splice(b, 0, '1')
  const attr = setCols(t, cols, entries)
  return writePlan(t, plan, attr ? [attr] : [], t.ncols + 1)
}

export function deleteColumn(env: Env, at: number, where?: 'before' | 'after'): OperationResult {
  const r = structural(env, at)
  if ('error' in r) return r
  const { t, cell } = r
  const col = where === 'before' ? cell.column - 1 : where === 'after' ? cell.column + cell.colspan : cell.column
  if (col < 0 || col >= t.ncols) return failure('invalid-target', 'There is no column there', at, at)
  if (t.ncols === 1) return failure('invalid-target', 'The last column of a table stays', at, at)
  const cols = readCols(t)
  if ('error' in cols) return cols
  const plan: Entry[] = []
  for (const e of entriesOf(t)) {
    const { column, colspan } = e.ex
    if (column <= col && col < column + colspan) {
      if (colspan === 1) continue
      e.ex = { ...e.ex, colspan: colspan - 1 }
    } else if (column > col) e.ex = { ...e.ex, column: column - 1 }
    plan.push(e)
  }
  const entries = [...cols.entries]
  entries.splice(col, 1)
  const attr = setCols(t, cols, entries)
  return writePlan(t, plan, attr ? [attr] : [], t.ncols - 1)
}

// ---------------------------------------------------------------- merged cells

export function mergeCells(env: Env, from: number, to: number): OperationResult {
  const a = structural(env, from)
  if ('error' in a) return a
  const b = located(env, to)
  if ('error' in b) return b
  if (a.t.node.from !== b.t.node.from) return failure('invalid-target', 'The two cells are in different tables', from, to)
  const { t } = a
  if (t.format !== 'psv') return unsupported('Cells of this format have no spans', t)
  const r0 = Math.min(a.cell.row, b.cell.row)
  const c0 = Math.min(a.cell.column, b.cell.column)
  const r1 = Math.max(a.cell.row + a.cell.rowspan, b.cell.row + b.cell.rowspan)
  const c1 = Math.max(a.cell.column + a.cell.colspan, b.cell.column + b.cell.colspan)
  const head = t.model.rows.head.length
  const foot = t.model.rows.foot.length
  if ((r0 < head && r1 > head) || (foot > 0 && r0 < t.nrows - foot && r1 > t.nrows - foot))
    return failure('invalid-span', 'Cells of the head or the foot are not merged', from, to)
  const plan: Entry[] = []
  let top: Entry | null = null
  for (const e of entriesOf(t)) {
    const { row, column, rowspan, colspan } = e.ex
    const inside = row >= r0 && row + rowspan <= r1 && column >= c0 && column + colspan <= c1
    const apart = row >= r1 || row + rowspan <= r0 || column >= c1 || column + colspan <= c0
    if (!inside && !apart) return failure('invalid-span', 'The cells would cut into another merged cell', e.old!.from, e.old!.to)
    if (apart) {
      plan.push(e)
      continue
    }
    if (row === r0 && column === c0) {
      top = e
      plan.push(e)
    } else if (e.ex.text.trim() !== '')
      return failure('invalid-span', 'A cell with text would be merged away', e.old!.from, e.old!.to)
  }
  if (!top) return failure('invalid-span', 'The cells have no cell at their corner', from, to)
  if (r1 - r0 === 1 && c1 - c0 === 1) return { doc: env.doc, changes: [] }
  top.ex = { ...top.ex, colspan: c1 - c0, rowspan: r1 - r0 }
  return writePlan(t, plan, [], t.ncols)
}

export function splitCell(env: Env, at: number): OperationResult {
  const r = structural(env, at)
  if ('error' in r) return r
  const { t, cell } = r
  if (cell.colspan === 1 && cell.rowspan === 1) return { doc: env.doc, changes: [] }
  if (t.format !== 'psv') return unsupported('Cells of this format have no spans', t)
  const plan = entriesOf(t)
  const own = plan.find((e) => e.old === cell)!
  own.ex = { ...own.ex, colspan: 1, rowspan: 1 }
  for (let k = cell.row; k < cell.row + cell.rowspan; k++)
    for (let c = cell.column; c < cell.column + cell.colspan; c++)
      if (k !== cell.row || c !== cell.column) plan.push({ old: null, ex: freshEx(t, k, c) })
  return writePlan(t, plan, [], t.ncols)
}

// ---------------------------------------------------------------- style and alignment

type Halign = TableCellModel['halign']
type Valign = TableCellModel['valign']

/** Changes the look of a cell: of the cell in a table of the format `psv`, of its column in the others. */
function look(
  env: Env,
  at: number,
  change: (ex: Ex) => Ex,
  entry: (e: string) => string,
): OperationResult {
  const r = structural(env, at)
  if ('error' in r) return r
  const { t, cell } = r
  const plan = entriesOf(t)
  if (t.format === 'psv') {
    const own = plan.find((e) => e.old === cell)!
    own.ex = change(own.ex)
    return writePlan(t, plan, [], t.ncols)
  }
  // (the column is all there is to change: other cells in it would change too, and that is refused)
  if (plan.some((e) => e.ex.column === cell.column && e.old !== cell))
    return unsupported('This format has no spec: other cells of the column would change', t)
  const cols = readCols(t)
  if ('error' in cols) return cols
  const entries = cols.entries.map((e, k) => (k === cell.column ? entry(e) : e))
  for (const e of plan) if (e.ex.column === cell.column) e.ex = change(e.ex)
  const attr = setCols(t, cols, entries)
  return writePlan(t, plan, attr ? [attr] : [], t.ncols)
}

export function setCellStyle(env: Env, at: number, style: 'asciidoc' | null): OperationResult {
  if (style !== 'asciidoc' && style !== null) return failure('invalid-block', 'The style of a cell is `asciidoc` or null', at, at)
  const r = located(env, at)
  if ('error' in r) return r
  // (a cell that is to have no style in a column that gives one has the style `d`, which is "none")
  const own = r.t.format === 'psv' && style === null && !!r.t.model.columns[r.cell.column]?.style
  return look(
    env,
    at,
    (ex) => ({ ...ex, style: own ? 'none' : style }),
    (e) => withEntry(e, { s: style === 'asciidoc' ? 'a' : '' }),
  )
}

/** The offset in the source of a cell where its text starts (after the white space, and the quote of a CSV field). */
function textStart(t: Tbl, cell: Cell): number {
  const raw = env_slice(t, cell)
  const lead = (from: number) => (cell.style === 'asciidoc' && raw.charCodeAt(from) === 10 ? /^\n*/ : /^\s*/).exec(raw.slice(from))![0].length + from
  let a = lead(0)
  if (t.format !== 'psv' && raw.length - a >= 2 && raw[a] === '"' && raw.trimEnd().endsWith('"')) a = lead(a + 1)
  return cell.contentFrom + a
}

const env_slice = (t: Tbl, cell: Cell): string => t.env.text.slice(cell.contentFrom, cell.contentTo)

export function setCellFill(env: Env, at: number, role: string | null): OperationResult {
  if (role !== null && !(typeof role === 'string' && FILL_ROLE.test(role)))
    return failure('invalid-role', 'A fill role is `cell-` and a name of letters, digits, _ and -', at, at)
  const r = located(env, at)
  if ('error' in r) return r
  const { t, cell } = r
  const fill = cell.fill
  if (cell.style === 'literal') return unsupported('A cell with the literal style has no fill', t)
  if (fill ? fill.role === role : role === null) return { doc: env.doc, changes: [] }
  let change: Change
  let text = cell.text
  if (fill && role !== null) {
    change = { from: fill.from + 2, to: fill.from + 2 + fill.role.length, insert: role }
    text = text.replace(fill.role, role)
  } else if (fill) {
    // (the white space after the label goes with it: the cell is read without it)
    const gap = /^\s*/.exec(text.slice(fill.to - fill.from))![0].length
    change = { from: fill.from, to: fill.to + gap, insert: '' }
    text = text.slice(fill.to - fill.from + gap)
    if (text === '' && t.format !== 'psv' && t.ncols === 1) change = { from: cell.contentFrom, to: cell.contentTo, insert: '""' }
  } else {
    if (cell.style === 'asciidoc') {
      const first = cellContentNode(env.doc, cell.from)?.firstChild
      if ((first && (first.name !== 'Paragraph' || first.firstChild?.name === 'BlockAttributes')) || /^\.[^\s.]/.test(cell.text))
        return unsupported('The first block of the cell is not a paragraph', t)
    }
    const label = `[.${role}]##{empty}##`
    text = label + text
    const raw = env_slice(t, cell)
    change =
      cell.text === '' && raw.trim() !== ''
        ? { from: cell.contentFrom, to: cell.contentTo, insert: label }
        : { from: textStart(t, cell), to: textStart(t, cell), insert: label }
  }
  return commitTable(t, [change], null, t.ncols, (m) => {
    const now = flatten(m)
    return (
      now.length === t.cells.length &&
      now.every((c, i) => (i === cell.idx ? c.text === text && (c.fill?.role ?? null) === role : c.text === t.cells[i]!.text))
    )
  }, undefined, undefined, true)
}

export function setCellAlign(env: Env, at: number, halign?: Halign, valign?: Valign): OperationResult {
  if ((halign !== undefined && !(halign in H)) || (valign !== undefined && !(valign in V)))
    return failure('invalid-block', 'Alignment is left, center, right; top, middle, bottom', at, at)
  return look(
    env,
    at,
    (ex) => ({ ...ex, halign: halign ?? ex.halign, valign: valign ?? ex.valign }),
    (e) => withEntry(e, { h: halign ? H[halign] : undefined, v: valign ? V[valign] : undefined }),
  )
}

export function setColumnWidths(env: Env, at: number, widths: readonly number[]): OperationResult {
  const r = structural(env, at)
  if ('error' in r) return r
  const { t } = r
  if (!Array.isArray(widths) || widths.length !== t.ncols || widths.some((w) => !Number.isInteger(w) || w < 1 || w > 1_000_000))
    return failure('invalid-block', `The widths are ${t.ncols} whole numbers, 1 or more`, at, at)
  const cols = readCols(t)
  if ('error' in cols) return cols
  const entries = cols.entries.map((e, k) => withEntry(e, { w: String(widths[k]) }))
  const attr = setCols(t, cols, entries)
  if (!attr) return { doc: env.doc, changes: [] }
  const sum = widths.reduce((x, y) => x + y, 0)
  // (the widths are what is asked: the table reads with them)
  return commitTable(t, [attr], t.cells.map(exOf), t.ncols, (m) =>
    m.columns.every((c, k) => c.autowidth || Math.abs(c.width - (widths[k]! / sum) * 100) <= 0.01),
  )
}

// ---------------------------------------------------------------- the options of the table

const OPTION_STYLE = (name: string) => new RegExp(`^%${name}$`)

/** The places in the attributes where an option of the table stands: a shorthand `%name`, or a word in `options="…"`. */
function optionPlaces(t: Tbl, name: string): { node: SyntaxNode; kind: 'short' | 'named'; parent: SyntaxNode }[] {
  const out: { node: SyntaxNode; kind: 'short' | 'named'; parent: SyntaxNode }[] = []
  const { text } = t.env
  for (const line of attributeLines(t))
    for (let a = line.firstChild; a; a = a.nextSibling) {
      if (a.name === 'PositionalAttribute') {
        for (let s = a.firstChild; s; s = s.nextSibling)
          if (s.name === 'ShorthandOption' && OPTION_STYLE(name).test(text.slice(s.from, s.to).toLowerCase())) out.push({ node: s, kind: 'short', parent: a })
      } else if (a.name === 'NamedAttribute') {
        const n = a.getChild('AttributeName')
        const v = a.getChild('AttributeValue')
        if (!n || !v || !['options', 'opts'].includes(text.slice(n.from, n.to).toLowerCase())) continue
        const words = text.slice(v.from, v.to).replace(/^["']|["']$/g, '').split(',').map((w) => w.trim().toLowerCase())
        if (words.includes(name)) out.push({ node: a, kind: 'named', parent: line })
      }
    }
  return out
}

/** The change that takes one option out of the attributes. */
function removeOption(t: Tbl, place: { node: SyntaxNode; kind: 'short' | 'named'; parent: SyntaxNode }, name: string): Change[] {
  const { text } = t.env
  const line = place.kind === 'short' ? place.parent.parent! : place.parent
  let target = place.node
  if (place.kind === 'short') {
    // the shorthand is all that the positional attribute holds: the attribute goes
    if (place.parent.from === place.node.from && place.parent.to === place.node.to) target = place.parent
    else return [{ from: place.node.from, to: place.node.to, insert: '' }]
  } else {
    const v = place.node.getChild('AttributeValue')!
    const raw = text.slice(v.from, v.to)
    const q = raw[0] === '"' || raw[0] === "'" ? raw[0] : ''
    const words = raw.replace(/^["']|["']$/g, '').split(',').map((w) => w.trim()).filter((w) => w.toLowerCase() !== name)
    if (words.length > 0) {
      return [{ from: v.from, to: v.to, insert: q + words.join(',') + q }]
    }
  }
  // the whole attribute goes, with a comma next to it; the line goes when it holds nothing else
  const attrs: SyntaxNode[] = []
  for (let a = line.firstChild; a; a = a.nextSibling) if (a.name === 'PositionalAttribute' || a.name === 'NamedAttribute') attrs.push(a)
  if (attrs.length === 1) return [{ from: line.from, to: line.to, insert: '' }]
  const i = attrs.findIndex((a) => a.from === target.from)
  if (i < attrs.length - 1) return [{ from: target.from, to: attrs[i + 1]!.from, insert: '' }]
  return [{ from: attrs[i - 1]!.to, to: target.to, insert: '' }]
}

/** The change that makes one option another (`%noheader` to `%header`). */
function renameOption(
  t: Tbl,
  place: { node: SyntaxNode; kind: 'short' | 'named'; parent: SyntaxNode },
  from: string,
  to: string,
): Change {
  const { text } = t.env
  if (place.kind === 'short') return { from: place.node.from, to: place.node.to, insert: '%' + to }
  const v = place.node.getChild('AttributeValue')!
  const raw = text.slice(v.from, v.to)
  const q = raw[0] === '"' || raw[0] === "'" ? raw[0] : ''
  const words = raw.replace(/^["']|["']$/g, '').split(',').map((w) => (w.trim().toLowerCase() === from ? to : w.trim()))
  return { from: v.from, to: v.to, insert: q + words.join(',') + q }
}

function addOption(t: Tbl, name: string): Change {
  const { text } = t.env
  const shorthand = t.env.profile.tableHeader === 'shorthand'
  const named = namedAttribute(t, ['options', 'opts']).pop()
  if (!shorthand && named) {
    const raw = text.slice(named.value.from, named.value.to)
    const q = raw[0] === '"' || raw[0] === "'" ? raw[0] : '"'
    return { from: named.value.from, to: named.value.to, insert: q + raw.replace(/^["']|["']$/g, '') + ',' + name + q }
  }
  if (shorthand) {
    for (const line of attributeLines(t).reverse()) {
      const pos = line.getChild('PositionalAttribute')
      if (pos) return { from: pos.to, to: pos.to, insert: '%' + name }
    }
    const lines = attributeLines(t)
    const line = lines[lines.length - 1]
    const open = line?.firstChild
    if (line && open && open.name === 'Mark') {
      const hasOther = open.nextSibling && text[open.nextSibling.from] !== ']'
      return { from: open.to, to: open.to, insert: '%' + name + (hasOther ? ',' : '') }
    }
    return addAttribute(t, '%' + name)
  }
  return addAttribute(t, `options="${name}"`)
}

export function setTableOptions(env: Env, at: number, header?: boolean, footer?: boolean): OperationResult {
  if ((header !== undefined && typeof header !== 'boolean') || (footer !== undefined && typeof footer !== 'boolean'))
    return failure('invalid-block', 'An option of a table is on or off', at, at)
  const t = tableAround(env, at)
  if (!t) return noTarget(at)
  const changes: Change[] = []
  const has = (name: string): boolean => optionPlaces(t, name).length > 0
  const drop = (name: string): void => {
    for (const p of optionPlaces(t, name)) changes.push(...removeOption(t, p, name))
  }
  const rows = t.model.rows
  if (header === true) {
    const off = optionPlaces(t, 'noheader')
    if (off.length > 0 && !has('header')) {
      // (the option that keeps the header off becomes the one that asks for it)
      changes.push(renameOption(t, off[0]!, 'noheader', 'header'))
      for (const p of off.slice(1)) changes.push(...removeOption(t, p, 'noheader'))
    } else {
      drop('noheader')
      if (!has('header') && rows.head.length === 0) changes.push(addOption(t, 'header'))
    }
  } else if (header === false) {
    const explicit = has('header')
    const second = t.cells.find((c) => c.row === 1)
    const first = t.cells.filter((c) => c.row === 0)
    const blank = !!second && first.length > 0 && /\n[ \t\r]*\n/.test(env.text.slice(first[first.length - 1]!.to, second.from))
    const on = optionPlaces(t, 'header')
    if (explicit && blank && !has('noheader') && rows.head.length > 0) {
      // (the blank line would give the head anyway: the option that asks for it becomes the one that forbids it, in one change)
      changes.push(renameOption(t, on[0]!, 'header', 'noheader'))
      for (const p of on.slice(1)) changes.push(...removeOption(t, p, 'header'))
    } else {
      drop('header')
      if (rows.head.length > 0 && !has('noheader') && (!explicit || blank)) changes.push(addOption(t, 'noheader'))
    }
  }
  if (footer === true) {
    if (!has('footer') && rows.foot.length === 0) changes.push(addOption(t, 'footer'))
  } else if (footer === false) drop('footer')
  // (two changes in one attribute line are made as one by the line that holds them)
  if (changes.length === 0) return { doc: env.doc, changes: [] }
  const geometry = (cs: readonly Cell[]): string =>
    JSON.stringify(cs.map((c) => [c.row, c.column, c.colspan, c.rowspan, c.text]))
  return commitTable(
    t,
    changes,
    null,
    t.ncols,
    (m) => {
      if (geometry(flatten(m)) !== geometry(t.cells)) return false
      const wantHead = header === undefined ? t.model.rows.head.length : header ? 1 : 0
      const wantFoot = footer === undefined ? t.model.rows.foot.length : footer ? 1 : 0
      return m.rows.head.length === wantHead && m.rows.foot.length === wantFoot
    },
    t.nrows,
    'free',
  )
}

// ---------------------------------------------------------------- a table in a cell

/** The `CellContent` node of the cell that starts at `from`, or null. */
function cellContentNode(doc: NotaDocument, from: number): SyntaxNode | null {
  for (let n: SyntaxNode | null = doc.tree.resolveInner(from, 1); n; n = n.parent) {
    if (n.name === 'TableCell' && n.from === from) return n.getChild('CellContent')
    if (n.name === 'DelimitedBlock' && n.tree?.prop(tableModel)) break
  }
  return null
}

/** A table stands in the cell as one of the blocks it holds. */
function cellHoldsTable(doc: NotaDocument, cell: Cell): boolean {
  const content = cellContentNode(doc, cell.from)
  if (!content) return false
  for (let c = content.firstChild; c; c = c.nextSibling) if (isTableNode(c)) return true
  return false
}

/**
 * The table that holds `at` goes. A table of the first level goes as a block does, with its attributes and the title above it
 * and one of the blank lines next to it; a table in a cell goes out of the text of the cell, which keeps the `a` style.
 */
export function deleteTable(env: Env, at: number): OperationResult {
  const t = tableAround(env, at)
  if (!t) return noTarget(at)
  if (t.depth === 1) return deleteBlock(env, t.node.from)
  let outer: SyntaxNode | null = t.node.parent
  while (outer && !isTableNode(outer)) outer = outer.parent
  if (!outer) return noTarget(at)
  const host = tableAround(env, outer.from)
  if (!host) return noTarget(at)
  const cell = host.cells.find((c) => c.contentFrom <= t.node.from && t.node.to <= c.contentTo)
  if (!cell) return unsupported('The table is not in a cell this edit can change', host)
  // (the text of the cell stands in its source as it is, but for the quotes of a field of a table `,===`: the places of the table in it follow)
  const shift = env.text.slice(cell.contentFrom, cell.contentTo).indexOf(cell.text)
  if (shift < 0) return unsupported('The text of the cell is not in its source as it is', host)
  const a = t.node.from - cell.contentFrom - shift
  const b = t.node.to - cell.contentFrom - shift
  if (a < 0 || b > cell.text.length) return unsupported('The text of the cell is not in its source as it is', host)
  const before = cell.text.slice(0, a).replace(/\s+$/, '')
  const after = cell.text.slice(b).replace(/^\s+/, '')
  const next = before !== '' && after !== '' ? before + env.eol + env.eol + after : before + after
  if (next === '' && host.format === 'psv') {
    // (what is left of the cell is its separator: the line break after it stays, a blank line there would make the row a header)
    const i = sepOf(host, cell)
    if (i < 0) return unsupported('The separator of a cell is not found', host)
    const plan = host.cells.map((c) => ({ ...exOf(c), text: c.idx === cell.idx ? '' : c.text }))
    return commitTable(host, [{ from: i + host.sep.length, to: cell.contentTo, insert: '' }], plan, host.ncols)
  }
  return setCellText(env, cell.from, next)
}

const INNER = [
  { delimiter: '!', name: 'psv' },
  { delimiter: ',', name: 'csv' },
  { delimiter: ':', name: 'dsv' },
] as const

export function nestTable(env: Env, at: number, rows: number, columns: number): OperationResult {
  if (!Number.isInteger(rows) || !Number.isInteger(columns) || rows < 1 || columns < 1 || rows > 1000 || columns > 250)
    return failure('invalid-block', 'A table has rows and columns, 1 or more', at, at)
  const r = located(env, at)
  if ('error' in r) return r
  const { t, cell } = r
  if (t.depth > INNER.length) return failure('nesting-too-deep', 'Tables are nested four levels deep at most', cell.from, cell.to)
  if (cellHoldsTable(env.doc, cell)) return failure('cell-has-table', 'The cell has a table already', cell.from, cell.to)
  const kind = INNER[t.depth - 1]!
  const { eol, text, profile } = env
  const delim = kind.delimiter + '='.repeat(Math.max(3, profile.delimiterLength.table))
  const field = kind.name === 'psv' ? '!' : ''
  const line =
    kind.name === 'psv'
      ? Array<string>(columns).fill(field).join(' ')
      : columns === 1
        ? kind.name === 'csv'
          ? '""'
          : ' '
        : kind.delimiter.repeat(columns - 1)
  const attrs = profile.cols === 'count' ? `[cols="${columns}"]` : profile.cols === 'widths' ? `[cols="${Array<string>(columns).fill('1').join(',')}"]` : ''
  const inner = [...(attrs ? [attrs] : []), delim, ...Array<string>(rows).fill(line), delim].join(eol)
  const changes: Change[] = []
  let source: string
  let from = cell.contentFrom
  if (t.format === 'psv') {
    const old = text.slice(cell.contentFrom, cell.contentTo).replace(/^\s+/, '')
    const escaped = escapeCell(inner, 'psv', t.sep, t.outer)!
    source = eol + (old === '' ? '' : old + eol + eol) + escaped
    const i = sepOf(t, cell)
    if (i < 0) return unsupported('The separator of a cell is not found', t)
    from = i + t.sep.length
    if (cell.style !== 'asciidoc') {
      const c = specChange(t, cell, { ...exOf(cell), style: 'asciidoc' })
      if (c && 'error' in c) return c
      if (c) changes.push(c)
    }
  } else {
    if (t.format === 'dsv') return failure('unwritable', 'A cell of this table cannot hold a table', cell.from, cell.to)
    const body = cell.text === '' ? inner : cell.text + eol + eol + inner
    source = escapeCell(body, t.format, t.sep, t.outer)!
    if (cell.style !== 'asciidoc') {
      const cols = readCols(t)
      if ('error' in cols) return cols
      const c = setCols(
        t,
        cols,
        cols.entries.map((e, k) => (k === cell.column ? withEntry(e, { s: 'a' }) : e)),
      )
      if (c) changes.push(c)
    }
  }
  // (what follows on the line of the cell goes to a line of its own: the delimiter of the table ends its line)
  let to = cell.contentTo
  const rest = /^[ \t]*(?=\S)(?![\r\n])/.exec(text.slice(to, to + 1000))
  if (rest && t.format === 'psv') {
    to += rest[0].length
    source += eol
  }
  // (a table whose number of columns is the cells of its first line keeps it when the first line grows)
  if (t.format === 'psv' && cell.row === 0 && t.ncols > 1 && namedAttribute(t, ['cols']).length === 0) changes.push(addAttribute(t, `cols="${t.ncols}"`))
  const content: Change = { from, to, insert: source }
  changes.push(content)
  return commitNested(t, cell, changes, content, delim, kind.delimiter, rows, columns)
}

function commitNested(
  t: Tbl,
  cell: Cell,
  changes: Change[],
  content: Change,
  delim: string,
  sep: string,
  rows: number,
  columns: number,
): OperationResult {
  const { doc } = t.env
  let norm: Change[]
  try {
    norm = normalizeTextChanges(changes, t.env.text.length)
  } catch {
    return failure('invalid-target', 'The changes overlap', t.model.from, t.model.to)
  }
  const after = doc.update(norm)
  const start = mapPosition(norm, content.from)
  const p = after.text.indexOf(delim, start)
  const inner = p < 0 ? null : after.tableAt(p)
  if (!inner || p > start + content.insert.length) return unsupported('The table does not read in the cell', t)
  const probe = mapPosition(norm, (t.node.getChild('BlockDelimiter') ?? t.node).from)
  const model = after.tableAt(Math.min(probe, after.text.length - 1))
  if (!model) return unsupported('The table cannot be written back that way', t)
  const bad = leaks(doc, after, [t.model.from, t.model.to], [model.from, model.to], t.model.from, t.model.to)
  if (bad) return bad
  // (an implicit header goes when its row gets more lines)
  if (model.rows.head.length !== t.model.rows.head.length || model.rows.foot.length !== t.model.rows.foot.length)
    return unsupported(ROLE, t)
  const cells = flatten(model)
  const host = cells.find((c) => c.row === cell.row && c.column === cell.column)
  const rowsOf = inner.rows.head.length + inner.rows.body.length + inner.rows.foot.length
  const first = inner.separator === sep
  if (
    !host ||
    host.style !== 'asciidoc' ||
    cells.length !== t.cells.length ||
    model.columns.length !== t.ncols ||
    !first ||
    rowsOf !== rows ||
    inner.columns.length !== columns
  )
    return unsupported('The table does not read in the cell', t)
  return newCode(t, after) ?? { doc: after, changes: norm }
}

// ---------------------------------------------------------------- the inline text of a cell

/**
 * The text of a cell that is read as a paragraph (see `cell.ts`) rewritten: `changes` are inside the text of the cell, which
 * starts at `from` and ends at `to`, and `printed` is what stands there after them. The cell may take nothing that makes
 * another cell or ends the table, and the table has to read as it did, but for the text of the cell. The check is local: the
 * rest of the document is not compared, as a change inside one cell cannot touch it.
 */
export function writeCellChanges(
  doc: NotaDocument,
  at: number,
  from: number,
  changes: readonly Change[],
  printed: string,
  to: number = Infinity,
): OperationResult {
  const env = lazyEnvOf(doc, () => doc.styleProfile())
  const r = located(env, at)
  if ('error' in r) return r
  const { t, cell } = r
  const bad = regular(t)
  if (bad) return bad
  if (t.format !== 'psv') return unsupported('The text of this table is written as a whole', t)
  for (const s of [t.sep, ...t.outer])
    if (printed.includes(s)) return failure('unwritable', 'That text cannot be written in the cell', cell.from, cell.to)
  const map = cellMap(env.doc, cell)
  if (!map) return unsupported('The text of the cell is not in the source as it is', t)
  // (`to`: where the block ends: in an `a` cell other blocks may stand after it; the blanks at the ends of the lines are not in the text)
  const tail = to === Infinity ? '' : cell.text.slice(map.toText(to))
  const expected = (cell.text.slice(0, map.toText(from)) + printed.replace(/[ \t\r]+(?=\n)/g, '') + tail).replace(/\s+$/, '')
  const same = (model: TableModel): boolean => readsAs(model, t.cells, cell.idx, expected)
  return commitTable(t, changes, null, t.ncols, same, undefined, undefined, true)
}
