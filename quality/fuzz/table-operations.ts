import fc from 'fast-check'
import { type Operation, type TableModel, applyOperation, mapOffset, parse, tableModel } from '@nota-adoc/core'
import { deepAsg } from '@nota-adoc/core/internal'
import { treeSignature } from '../lib/invariants.js'
import { CODES, applyAll, nodesOf, strip } from './operations.js'
import { tablesText } from './tables.js'

const REFUSALS = new Set([...CODES, 'invalid-span', 'nesting-too-deep', 'cell-has-table', 'invalid-role'])

// ---------------------------------------------------------------- the documents

const texts = fc.constantFrom('a', 'b', 'text', 'x y', '', '', '', '1', 'p|q', 'p\\|q', 'e!f', 'g,h', 'i:j', '*b*', '"q"', 'long text here', '[.cell-yellow]##{empty}##x', '[.cell-mint]#{empty}# y')
const bangs = ['!', ',', ':'] as const

const emptyish = fc.constantFrom('', '', '', '', '', '', 'a', 'b', 'text', 'p|q', 'x')

/** A `|===` table whose cells span rows and columns, laid out so that every place is covered once. */
const spanned: fc.Arbitrary<string> = fc.array(fc.integer({ min: 0, max: 999 }), { minLength: 60, maxLength: 60 }).chain((e) =>
  fc.array(emptyish, { minLength: 30, maxLength: 30 }).map((texts) => {
    let k = 0
    const next = (n: number): number => e[k++ % e.length]! % n
    const ncols = 2 + next(3)
    const nrows = 2 + next(3)
    const taken = Array.from({ length: nrows }, () => Array<boolean>(ncols).fill(false))
    const lines: string[] = []
    let t = 0
    for (let r = 0; r < nrows; r++) {
      const row: string[] = []
      for (let c = 0; c < ncols; c++) {
        if (taken[r]![c]) continue
        let cs = 1
        while (next(3) === 0 && c + cs < ncols && !taken[r]![c + cs] && cs < 3) cs++
        let rs = 1
        while (next(3) === 0 && r + rs < nrows && rs < 3 && Array.from({ length: cs }, (_, d) => !taken[r + rs]![c + d]).every(Boolean)) rs++
        for (let y = 0; y < rs; y++) for (let x = 0; x < cs; x++) taken[r + y]![c + x] = true
        const spec = cs > 1 || rs > 1 ? `${cs > 1 ? cs : ''}${rs > 1 ? '.' + rs : ''}+` : ''
        row.push(`${spec}|${texts[t++ % texts.length]!.replace(/\|/g, '\\|')}`)
      }
      lines.push(row.join(' '))
    }
    // (a row that no cell starts in is not one Asciidoctor reads: the grid is laid out without spans then)
    if (lines.some((l) => l === ''))
      for (let r = 0; r < nrows; r++)
        lines[r] = Array.from({ length: ncols }, (_, c) => `|${texts[(r * ncols + c) % texts.length]!.replace(/\|/g, '\\|')}`).join(' ')
    return `[cols="${ncols}"]\n|===\n${lines.join('\n')}\n|===`
  }),
)

/** A table of well-formed rows in one of the formats, and (while there is depth) cells that hold a table of the next format. */
function table(depth: number): fc.Arbitrary<string> {
  const level = bangs[depth - 1]
  const format =
    depth === 0
      ? fc.constantFrom<'psv' | 'csv' | 'dsv'>('psv', 'psv', 'psv', 'csv', 'dsv')
      : fc.constant<'psv' | 'csv' | 'dsv'>(level === '!' ? 'psv' : level === ',' ? 'csv' : 'dsv')
  const inner: fc.Arbitrary<string> = depth < 3 ? fc.constantFrom(null).chain(() => table(depth + 1)) : fc.constant('')
  return fc
    .record({
      format,
      cols: fc.integer({ min: 1, max: 4 }),
      rows: fc.integer({ min: 1, max: 4 }),
      cells: fc.array(fc.record({ text: texts, spec: fc.constantFrom('', '', '', '', 'a', '^', '>', '.>', 's', '2+', '.2+'), nest: fc.boolean() }), {
        minLength: 16,
        maxLength: 16,
      }),
      attrs: fc.constantFrom('cols', 'cols', 'list', 'mult', 'percent', 'none', 'header', 'footer', 'both'),
      oneLine: fc.boolean(),
      blank: fc.boolean(),
      nested: inner,
    })
    .map(({ format, cols, rows, cells, attrs, oneLine, blank, nested }) => {
      const sep = format === 'psv' ? (depth === 0 ? '|' : '!') : format === 'csv' ? ',' : ':'
      const delim = sep + '==='
      const head: string[] = []
      const opts = attrs === 'header' ? '%header' : attrs === 'footer' ? '%footer' : attrs === 'both' ? '%header%footer' : ''
      const colsAttr =
        attrs === 'cols' || opts ? `cols="${cols}"` : attrs === 'list' ? `cols="${Array<string>(cols).fill('1').join(',')}"` : attrs === 'mult' ? `cols="${cols}*"` : attrs === 'percent' ? `cols="${Array<string>(cols).fill('10%').join(',')}"` : ''
      const line = [opts, colsAttr].filter(Boolean).join(',')
      if (line) head.push(`[${line}]`)
      const lines: string[] = []
      let k = 0
      for (let r = 0; r < rows; r++) {
        const row: string[] = []
        for (let c = 0; c < cols; c++) {
          const cell = cells[k++ % cells.length]!
          if (format === 'psv') {
            const asciidoc = cell.nest && nested !== '' && depth < 3
            const spec = asciidoc ? 'a' : cell.spec
            row.push(asciidoc ? `${spec}${sep}\n${nested}\n` : `${spec}${sep}${cell.text.split(sep).join('\\' + sep)}`)
          } else if (format === 'csv') row.push(cell.text.includes(',') || cell.text.includes('"') ? `"${cell.text.replace(/"/g, '""')}"` : cell.text)
          else row.push(cell.text.replace(/:/g, '\\:'))
        }
        lines.push(format === 'psv' ? row.join(oneLine ? ' ' : '\n') : row.join(sep))
        if (blank && r === 0 && rows > 1) lines.push('')
      }
      return [...head, delim, ...lines, delim].join('\n')
    })
}

const wellFormed: fc.Arbitrary<string> = fc
  .record({
    top: fc.oneof({ weight: 2, arbitrary: table(0) }, { weight: 2, arbitrary: spanned }),
    before: fc.constantFrom('', 'Intro.\n\n', '== S\n\n', '.Title\n'),
    after: fc.constantFrom('', '\nOutro.\n', '\n* item\n'),
    crlf: fc.boolean(),
  })
  .map(({ top, before, after, crlf }) => {
    const text = `${before}${top}\n${after}`
    return crlf ? text.replace(/\n/g, '\r\n') : text
  })

const documents = fc.oneof({ weight: 5, arbitrary: wellFormed }, { weight: 3, arbitrary: tablesText })

// ---------------------------------------------------------------- the operations

const kinds = [
  'setCellText',
  'setCellText',
  'insertRow',
  'deleteRow',
  'insertColumn',
  'deleteColumn',
  'mergeCells',
  'mergeCells',
  'splitCell',
  'setTableOptions',
  'setCellStyle',
  'setCellFill',
  'setCellFill',
  'setCellAlign',
  'setColumnWidths',
  'nestTable',
  'nestTable',
] as const

const place = fc.record({ r: fc.double({ min: 0, max: 1, noNaN: true }), mode: fc.integer({ min: 0, max: 4 }) })

export interface TableOperationInput {
  text: string
  kind: (typeof kinds)[number]
  at: { r: number; mode: number }
  to: { r: number; mode: number }
  where: 'before' | 'after' | undefined
  value: string
  header: boolean | undefined
  footer: boolean | undefined
  style: 'asciidoc' | null
  role: string | null
  halign: 'left' | 'center' | 'right' | undefined
  valign: 'top' | 'middle' | 'bottom' | undefined
  widths: number[]
  rows: number
  columns: number
}

export const tableOperationInput: fc.Arbitrary<TableOperationInput> = fc.record({
  text: documents,
  kind: fc.constantFrom(...kinds),
  at: place,
  to: place,
  where: fc.constantFrom('before' as const, 'after' as const, undefined),
  value: fc.constantFrom('a|b', 'a!b', 'a,"b"', 'a:b', 'plain', 'p\\|q', '', 'two\nlines', ' padded ', '* item', 'x | y ! z , w : v', '"quoted"', '[.cell-mint]##{empty}##x'),
  header: fc.constantFrom(true, false, undefined),
  footer: fc.constantFrom(true, false, undefined),
  style: fc.constantFrom('asciidoc' as const, null),
  role: fc.constantFrom('cell-yellow', 'cell-mint', 'cell-a_1', null, 'yellow'),
  halign: fc.constantFrom('left' as const, 'center' as const, 'right' as const, undefined),
  valign: fc.constantFrom('top' as const, 'middle' as const, 'bottom' as const, undefined),
  widths: fc.array(fc.integer({ min: 1, max: 9 }), { minLength: 1, maxLength: 5 }),
  rows: fc.integer({ min: 1, max: 3 }),
  columns: fc.integer({ min: 1, max: 3 }),
})

/** The positions of the cells of all the tables of a document, and of the tables themselves. */
function cellPlaces(text: string): { cells: [number, number][]; tables: number[] } {
  const doc = parse(text)
  const cells: [number, number][] = []
  const tables: number[] = []
  doc.tree.iterate({
    enter: (ref) => {
      if (ref.name === 'DelimitedBlock' && ref.node.tree?.prop(tableModel)) tables.push(ref.from)
      if (ref.name === 'TableCell') cells.push([ref.from, ref.to])
    },
  })
  return { cells, tables }
}

function pick(text: string, p: { r: number; mode: number }, places: { cells: [number, number][]; tables: number[] }): number {
  if (p.mode === 4 || places.cells.length === 0) return Math.min(text.length, Math.floor(p.r * (text.length + 1)))
  const [from, to] = places.cells[Math.min(places.cells.length - 1, Math.floor(p.r * places.cells.length))]!
  return Math.min(text.length, from + Math.min(p.mode, Math.max(0, to - from - 1)))
}

export function toTableOperation(text: string, i: TableOperationInput): Operation {
  const places = cellPlaces(text)
  const at = pick(text, i.at, places)
  switch (i.kind) {
    case 'setCellText':
      return { kind: i.kind, at, text: i.value }
    case 'insertRow':
    case 'insertColumn':
    case 'deleteRow':
    case 'deleteColumn':
      return { kind: i.kind, at, where: i.where }
    case 'mergeCells': {
      // (the cell next to it, or a few cells away, more often than any)
      const k = places.cells.findIndex(([from, to]) => from <= at && at < Math.max(to, from + 1))
      if (i.to.mode !== 4 && k >= 0) {
        const j = Math.max(0, Math.min(places.cells.length - 1, k + 1 + Math.floor(i.to.r * 5) - (i.to.mode % 2)))
        return { kind: i.kind, from: at, to: places.cells[j]![0] }
      }
      return { kind: i.kind, from: at, to: pick(text, i.to, places) }
    }
    case 'splitCell':
      return { kind: i.kind, at }
    case 'setTableOptions':
      return { kind: i.kind, at, header: i.header, footer: i.footer }
    case 'setCellStyle':
      return { kind: i.kind, at, style: i.style }
    case 'setCellFill':
      return { kind: i.kind, at, role: i.role }
    case 'setCellAlign':
      return { kind: i.kind, at, halign: i.halign, valign: i.valign }
    case 'setColumnWidths': {
      const m = parse(text).tableAt(at)
      const n = m ? m.columns.length : i.widths.length
      return { kind: i.kind, at, widths: Array.from({ length: n }, (_, k) => i.widths[k % i.widths.length]!) }
    }
    default:
      return { kind: 'nestTable', at, rows: i.rows, columns: i.columns }
  }
}

// ---------------------------------------------------------------- the checks

const rowsOf = (m: TableModel): number => m.rows.head.length + m.rows.body.length + m.rows.foot.length
const cellsOf = (m: TableModel) => [...m.rows.head, ...m.rows.body, ...m.rows.foot].flatMap((r) => r.cells)

function tableCodes(doc: ReturnType<typeof parse>): Map<string, number> {
  const out = new Map<string, number>()
  for (const d of doc.diagnostics) if (d.code?.startsWith('table-')) out.set(d.code, (out.get(d.code) ?? 0) + 1)
  return out
}

function tableCount(doc: ReturnType<typeof parse>): number {
  let n = 0
  doc.tree.iterate({
    enter: (ref) => {
      if (ref.name === 'DelimitedBlock' && ref.node.tree?.prop(tableModel)) n++
    },
  })
  return n
}

/** Whether every text of `small` is in `big` (as a bag). */
function bagOf(small: string[], big: string[]): boolean {
  const counts = new Map<string, number>()
  for (const t of big) counts.set(t, (counts.get(t) ?? 0) + 1)
  for (const t of small) {
    const n = counts.get(t) ?? 0
    if (n === 0) return false
    counts.set(t, n - 1)
  }
  return true
}

/** Runs one input of the operations on tables and checks what they promise. */
export function checkTableOperation(i: TableOperationInput): void {
  const text = i.text
  const doc = parse(text)
  const beforeSig = treeSignature(doc.tree)
  const op = toTableOperation(text, i)
  const r = applyOperation(doc, op)
  if (doc.text !== text || treeSignature(doc.tree) !== beforeSig) throw new Error('the operation changed the document it was given')
  if ('error' in r) {
    if (!REFUSALS.has(r.error)) throw new Error(`a refusal with an unknown code: ${r.error}`)
    if (r.diagnostics.length === 0) throw new Error('a refusal without diagnostics')
    return
  }
  const changes = r.changes
  const out = applyAll(text, changes)
  if (out !== r.doc.text) throw new Error('applying the changes does not give the text of the result')
  const full = parse(out)
  if (treeSignature(r.doc.tree) !== treeSignature(full.tree)) throw new Error('the result is not the parse of its text')
  if (JSON.stringify(r.doc.diagnostics) !== JSON.stringify(full.diagnostics)) throw new Error('the diagnostics of the result differ from a full parse')
  if (changes.length === 0) {
    if (out !== text) throw new Error('no changes, but the text is not the same')
    return
  }
  // no diagnostic of a table is new
  const was = tableCodes(doc)
  for (const [code, n] of tableCodes(full)) if (n > (was.get(code) ?? 0)) throw new Error(`a new diagnostic ${code}`)
  // the target: the table that holds the place (the innermost one)
  const place = op.kind === 'mergeCells' ? op.from : (op as { at: number }).at
  const model = doc.tableAt(place)
  if (!model) throw new Error('a change of a table where there is none')
  let node = doc.tree.resolveInner(place, 1)
  while (node.parent && !(node.name === 'DelimitedBlock' && node.tree?.prop(tableModel))) node = node.parent
  const delim = node.getChild('BlockDelimiter')
  const probe = mapOffset(changes, delim ? delim.from : model.from, 1)
  const now = full.tableAt(Math.min(probe, out.length - 1))
  if (!now) throw new Error('the table is gone')
  // the changes lie inside the table, and what is outside of it is as it was (shifted)
  const reach = [model.from, model.to] as const
  if (changes.some((c) => c.from < reach[0] || c.to > reach[1])) throw new Error('a change outside of the table')
  const shift = (pos: number): number => {
    let d = 0
    for (const c of changes) if (c.to <= pos) d += c.insert.length - (c.to - c.from)
    return pos + d
  }
  const afterIndex = new Map<string, string[]>()
  for (const n of nodesOf(deepAsg(full))) {
    const k = `${n.name}|${n.range[0]}|${n.range[1]}`
    afterIndex.set(k, [...(afterIndex.get(k) ?? []), JSON.stringify(strip(n))])
  }
  for (const n of nodesOf(deepAsg(doc))) {
    if (n.name === 'document' || n.location[0].file) continue
    if (n.range[1] > reach[0] && n.range[0] < reach[1]) continue
    const hits = afterIndex.get(`${n.name}|${shift(n.range[0])}|${shift(n.range[1])}`)
    if (!hits || !hits.includes(JSON.stringify(strip(n)))) throw new Error(`a ${n.name} at ${n.range[0]}-${n.range[1]} outside of the table is not as it was`)
  }
  const before = cellsOf(model)
  const after = cellsOf(now)
  const texts = (cs: readonly { text: string }[]): string[] => cs.map((c) => c.text)
  // the cell the place is in, before and after
  // (the same one the operations take: an empty cell that stands at the place, else the one the place is inside of, else one it touches)
  const cellWas =
    before.find((c) => c.from === c.to && c.from === place) ??
    before.find((c) => c.from <= place && place < c.to) ??
    before.find((c) => c.from <= place && place <= c.to)
  // (an empty cell and the one after it can start at one place: the one that is as empty as it was)
  const cellIs = cellWas
    ? (after.filter((c) => c.from === shift(cellWas.from)).find((c) => c.to > c.from === cellWas.to > cellWas.from) ?? after.find((c) => c.from === shift(cellWas.from)))
    : undefined
  // the header and the footer stay (a deleted row may take its own role away)
  if (op.kind !== 'setTableOptions') {
    const dh = model.rows.head.length - now.rows.head.length
    const df = model.rows.foot.length - now.rows.foot.length
    const room = op.kind === 'deleteRow' ? 1 : 0
    if (dh < 0 || dh > room || df < 0 || df > room) throw new Error(`the header or the footer changed with ${op.kind}`)
  }
  switch (op.kind) {
    case 'setCellText': {
      if (after.length !== before.length || rowsOf(now) !== rowsOf(model) || now.columns.length !== model.columns.length)
        throw new Error('the shape of the table changed with the text of a cell')
      if (cellWas && after[before.indexOf(cellWas)]!.text !== op.text) throw new Error('the cell does not have the text that was given')
      // (a place that is in no cell is the one next to it: one cell has the new text, and no other changed)
      const differ = after.filter((c, k) => c.text !== before[k]!.text).length
      if (differ > 1 || (differ === 0 && !after.some((c) => c.text === op.text))) throw new Error('more than one cell changed with the text of a cell')
      if (cellWas && before.some((c, k) => c !== cellWas && c.text !== after[k]!.text)) throw new Error('another cell changed with the text of a cell')
      break
    }
    case 'insertRow':
      if (rowsOf(now) !== rowsOf(model) + 1 || now.columns.length !== model.columns.length) throw new Error('a row is not one more')
      if (!bagOf(texts(after).filter((t) => t !== ''), texts(before))) throw new Error('a new row brings text')
      if (!bagOf(texts(before), texts(after))) throw new Error('a new row loses text')
      break
    case 'deleteRow':
      if (rowsOf(now) !== rowsOf(model) - 1 || now.columns.length !== model.columns.length) throw new Error('a row is not one less')
      if (!bagOf(texts(after), texts(before))) throw new Error('a deleted row brings text')
      break
    case 'insertColumn':
      if (now.columns.length !== model.columns.length + 1 || rowsOf(now) !== rowsOf(model)) throw new Error('a column is not one more')
      if (!bagOf(texts(before), texts(after))) throw new Error('a new column loses text')
      break
    case 'deleteColumn':
      if (now.columns.length !== model.columns.length - 1 || rowsOf(now) !== rowsOf(model)) throw new Error('a column is not one less')
      if (!bagOf(texts(after), texts(before))) throw new Error('a deleted column brings text')
      break
    case 'mergeCells':
      if (after.length >= before.length || !after.some((c) => c.colspan > 1 || c.rowspan > 1)) throw new Error('a merge that leaves the cells as they were')
      if (!bagOf(texts(after).filter((t) => t !== ''), texts(before))) throw new Error('a merge brings text')
      break
    case 'splitCell':
      if (after.length < before.length) throw new Error('a split that leaves fewer cells')
      if (cellIs && (cellIs.colspan !== 1 || cellIs.rowspan !== 1)) throw new Error('a split that leaves the cell merged')
      break
    case 'setTableOptions':
      if (op.header !== undefined && now.rows.head.length !== (op.header ? 1 : 0)) throw new Error('the header is not as asked')
      if (op.footer !== undefined && now.rows.foot.length !== (op.footer ? 1 : 0)) throw new Error('the footer is not as asked')
      break
    case 'setCellStyle':
      if (cellIs && (cellIs.style === 'asciidoc') !== (op.style === 'asciidoc')) throw new Error('the style is not as asked')
      break
    case 'setCellFill':
      if (after.length !== before.length || rowsOf(now) !== rowsOf(model)) throw new Error('the shape of the table changed with the fill of a cell')
      // (the cell by its number: the label may stand where the cell starts, and an empty cell is found by its start)
      if (cellWas && (after[before.indexOf(cellWas)]!.fill?.role ?? null) !== op.role) throw new Error('the fill is not as asked')
      break
    case 'setCellAlign':
      if (cellIs && ((op.halign && cellIs.halign !== op.halign) || (op.valign && cellIs.valign !== op.valign))) throw new Error('the alignment is not as asked')
      break
    case 'setColumnWidths': {
      const sum = op.widths.reduce((a, b) => a + b, 0)
      if (now.columns.some((c, k) => !c.autowidth && Math.abs(c.width - (op.widths[k]! / sum) * 100) > 0.01)) throw new Error('the widths are not as asked')
      break
    }
    case 'nestTable':
      // (a cell that now holds blocks may hold a table that was text before)
      if (tableCount(full) < tableCount(doc) + 1) throw new Error('a table is not one more')
      if (!after.some((c) => c.style === 'asciidoc')) throw new Error('no cell holds blocks after a table was put in one')
      break
    default:
      break
  }
}
