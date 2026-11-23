/**
 * The document in a table cell with the `a` style. Asciidoctor reads the text of such a cell as a document of its own
 * (`Document.new … parent:`): it sees the attributes of the document that holds the table, and what it sets is not
 * seen by the document. Here the cell is read as a document too, and its blocks are moved to where their text is in
 * the source: the text of the cell is made of pieces of lines (a line feed stands for a whole line terminator; quotes
 * of a CSV cell are squeezed), and the nodes that the parse of that text made are mapped back by the source range of
 * the first and the last character of each.
 */
import { type NodeProp, type Tree, type TreeCursor } from '@lezer/common'
import { buildTree, collectDiagnostics, parseUnits } from '../incremental.js'
import { Type, blockKind, sectionLevel, tableModel, type TableModel } from '../nodes.js'
import { AttrsBuilder, type Attrs } from './attrs.js'
import { rubyToI } from './rx.js'
import type { N } from './build.js'
import type { CellDocument, CellReaders, CellText, ParseSetup } from './blocks.js'
import { textPieces } from './inline/index.js'

/** What a document in a cell does not take from the document that holds the table (`Document#initialize`). */
const NOT_INHERITED = [
  'compat-mode',
  'doctype',
  'notitle',
  'showtitle',
  'toc',
  'toc-placement',
  'toc-position',
]

/**
 * The setup of the documents in the cells of a table found where the attributes are `attrs` and the document type is
 * `doctype`: every attribute the document has is fixed for the documents of the cells (they may set new ones), except
 * the few that are made again.
 */
export function cellSetup(parent: ParseSetup, attrs: Attrs, doctype: string, leveloffset?: number): ParseSetup {
  const b = new AttrsBuilder(attrs)
  // `{set:leveloffset:…}` in text changes the attribute, not the level that the blocks read so far had: the document
  // of a cell is made when the blocks are read, so it takes the level of the parse
  // (level 0 with a different attribute: only `{set:}` wrote it, so for the document of the cell it is not set at all)
  let unset = false
  if (leveloffset !== undefined && rubyToI(attrs.get('leveloffset') ?? '0') !== leveloffset) {
    if (leveloffset === 0) {
      b.set('leveloffset', null)
      unset = true
    } else b.set('leveloffset', String(leveloffset))
  }
  for (const name of ['compat-mode', 'toc', 'toc-position', 'showtitle']) b.set(name, null)
  b.set('toc-placement', attrs.get('toc-placement') ?? 'auto')
  b.set('notitle', '')
  // a document in a cell is an article, whatever the document that holds the table is: `Document#initialize` takes the
  // document type from the options, not from the attributes (no preamble of a book, no parts, `{doctype}` is article)
  if (doctype !== 'article') {
    const backend = attrs.get('backend')
    const base = attrs.get('basebackend')
    b.set(`doctype-${doctype}`, null)
    if (backend !== undefined) {
      b.set(`backend-${backend}-doctype-${doctype}`, null)
      b.set(`backend-${backend}-doctype-article`, '')
    }
    if (base !== undefined) {
      b.set(`basebackend-${base}-doctype-${doctype}`, null)
      b.set(`basebackend-${base}-doctype-article`, '')
    }
    b.set('doctype-article', '')
  }
  b.set('doctype', 'article')
  if (attrs.has('compat-mode')) b.set('compat-mode', '')
  const locked = new Set<string>(parent.attrs.locked)
  for (const name of attrs.map.keys()) locked.add(name)
  for (const name of NOT_INHERITED) locked.delete(name)
  if (unset && !parent.attrs.locked.has('leveloffset')) locked.delete('leveloffset')
  return {
    attrs: { initial: b.freeze(), locked },
    blockMacros: parent.blockMacros,
    depth: (parent.depth ?? 0) + 1,
    cells: parent.cells,
  }
}

/** Reads the text of a cell as a document, with the nodes and the problems of it in the source. */
export function readCell(setup: ParseSetup, cell: CellText, from: number, to: number): CellDocument {
  const units = parseUnits(cell.text, setup)
  const tree = buildTree(units, cell.text.length)
  const map = new Mapping(cell, from, to)
  const diagnostics = collectDiagnostics(units).map((d) => {
    const f = map.from(d.from)
    return { ...d, from: f, to: Math.max(f, map.to(d.to, d.from)) }
  })
  return { nodes: convert(tree, map), diagnostics }
}

/** Positions in the text of the cell to positions in the source, inside `[lo, hi]`. */
class Mapping {
  private readonly n: number
  constructor(
    readonly cell: CellText,
    private readonly lo: number,
    private readonly hi: number,
  ) {
    this.n = cell.starts.length
  }

  private clamp(p: number): number {
    return p < this.lo ? this.lo : p > this.hi ? this.hi : p
  }

  /** Where the character `v` starts (the end of the last one for the end of the text). */
  from(v: number): number {
    const { starts, ends } = this.cell
    return this.clamp(v < this.n ? starts[v]! : this.n > 0 ? ends[this.n - 1]! : this.lo)
  }

  /** Where a range that ends before the character `v` and starts at `from` ends. */
  to(v: number, from: number): number {
    if (v <= from || this.n === 0) return this.from(from)
    return this.clamp(this.cell.ends[Math.min(v, this.n) - 1]!)
  }

  /** Where the text is cut by lines the parse of the document did not see (comments, lines of directives). */
  gaps(f: number, t: number): number[] {
    const { text, starts, ends } = this.cell
    const out: number[] = []
    for (let v = f; v < t - 1; v++)
      if (text.charCodeAt(v) === 10 && starts[v + 1]! > ends[v]!) out.push(v + 1)
    return out
  }
}

const PROPS: NodeProp<never>[] = [
  blockKind,
  sectionLevel,
  textPieces,
  tableModel,
] as unknown as NodeProp<never>[]

/** A property of a node, moved to the source. */
function moved(
  prop: unknown,
  value: unknown,
  at: TreeCursor,
  from: number,
  to: number,
  map: Mapping,
): unknown {
  if (prop === textPieces) {
    const src = value as readonly number[]
    const out: number[] = []
    // the offsets in the tree are relative to the node
    for (let i = 0; i + 1 < src.length; i += 2) {
      const a = at.from + src[i]!
      out.push(map.from(a), map.to(at.from + src[i + 1]!, a))
    }
    return out
  }
  if (prop === tableModel) return movedModel(value as TableModel, at.from, from, to, map)
  return value
}

/** The layout of a table with its offsets (relative to the block) moved to the source. */
function movedModel(m: TableModel, blockAt: number, from: number, to: number, map: Mapping): TableModel {
  const range = (a: number, b: number): [number, number] => {
    const f = map.from(blockAt + a)
    return [f - from, map.to(blockAt + b, blockAt + a) - from]
  }
  const rows = (list: TableModel['rows']['body']) =>
    list.map((r) => ({
      cells: r.cells.map((c) => {
        const [f, t] = range(c.from, c.to)
        const [cf, ct] = range(c.contentFrom, c.contentTo)
        const fill = c.fill && range(c.fill.from, c.fill.to)
        return { ...c, from: f, to: t, contentFrom: cf, contentTo: ct, fill: fill && { role: c.fill!.role, from: fill[0], to: fill[1] } }
      }),
    }))
  return {
    ...m,
    from: 0,
    to: to - from,
    rows: { head: rows(m.rows.head), body: rows(m.rows.body), foot: rows(m.rows.foot) },
    dropped: m.dropped.map((c) => {
      const [f, t] = range(c.from, c.to)
      return { ...c, from: f, to: t }
    }),
  }
}

/** The nodes of the tree of a document (without the document itself) as nodes over the source. */
function convert(tree: Tree, map: Mapping): N[] {
  const roots: N[] = []
  const frames: N[][] = [roots]
  const cur = tree.cursor()
  if (!cur.firstChild()) return roots
  let depth = 0
  for (;;) {
    const frame = frames[frames.length - 1]!
    let entered = false
    if (cur.type.id !== Type.Mark && cur.to > cur.from) {
      const from = map.from(cur.from)
      const to = map.to(cur.to, cur.from)
      if (to > from) {
        const props: [NodeProp<never>, unknown][] = []
        const own = cur.tree
        if (own) {
          for (const p of PROPS) {
            const v = own.prop(p as NodeProp<unknown>)
            if (v !== undefined) props.push([p, moved(p, v, cur, from, to, map)])
          }
        }
        const n: N = { type: cur.type.id, from, to }
        if (props.length) n.props = props
        if (cur.firstChild()) {
          n.children = []
          frame.push(n)
          frames.push(n.children)
          depth++
          entered = true
        } else if (props.length === 0) {
          // a run of lines is cut where the source has lines the document did not see
          const gaps = map.gaps(cur.from, cur.to)
          if (gaps.length === 0) frame.push(n)
          else {
            let at = cur.from
            for (const g of [...gaps, cur.to]) {
              const f = map.from(at)
              const t = map.to(g, at)
              if (t > f) frame.push({ type: n.type, from: f, to: t })
              at = g
            }
          }
        } else frame.push(n)
      }
    }
    if (entered) continue
    for (;;) {
      if (cur.nextSibling()) break
      if (depth === 0) return roots
      cur.parent()
      depth--
      frames.pop()
    }
  }
}

/** What the parser is given to read the documents in cells. */
export const cellReaders: CellReaders = { setup: cellSetup, read: readCell }
