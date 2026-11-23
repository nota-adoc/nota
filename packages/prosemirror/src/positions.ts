/**
 * The map between the text of the document and the ProseMirror document. It lives next to the document, not in
 * its nodes: for every top-level node the item of the Nota document it shows (with its range in the text) and the
 * position the node starts at. Inside a paragraph or a heading a position is a cell of the text: one position per
 * visible character, hard break or plate.
 */
import type { NotaDocument } from '@nota-adoc/core'
import {
  type BlockInfo,
  type Item,
  type Reading,
  type Span,
  type TableView,
  cellsBefore,
  impliedMark,
  isInsertionPoint,
  readInline,
  spansAt,
  tableViewAt,
} from '@nota-adoc/core/internal'
import type { Mark, Node as PMNode } from 'prosemirror-model'
import { itemNumbers } from './project.js'
import { type CellDraft, withCellDraft } from './tablepos.js'

/** An item whose text is shown as it is written: code, the caption of an image, an island. Its positions are characters of the source. */
export const isVerbatim = (it: Item): boolean => it.kind === 'chip' || it.kind === 'code' || it.kind === 'image'

/** Where a ProseMirror position is. */
export interface Located {
  /** The index of the top-level node. */
  readonly index: number
  /**
   * `in`: inside the content of a paragraph or heading, before its `cell`-th cell; `at`: before the node (`cell`
   * is 0) or after it (`cell` is 1), for a plate or a position between nodes.
   */
  readonly where: 'in' | 'at'
  readonly cell: number
}

const stateIds = new WeakMap<object, number>()
let nextStateId = 1

/**
 * The key that tells whether an item is the same after an edit: what it is and its source, and the attributes in
 * force after it (how a text is read depends on them, and a document keeps one object for a state while it lasts).
 */
export function itemKey(doc: NotaDocument, it: Item, extra = ''): string {
  if (it.kind === 'empty') return 'e'
  const state = doc.attributesAt(it.to)
  let id = stateIds.get(state)
  if (id === undefined) stateIds.set(state, (id = nextStateId++))
  // (a plate shows the label of the block it is: the same source can be another kind of block after an edit)
  return `${it.kind}:${it.block!.level}:${it.block!.label}:${id}:${extra}:${doc.text.slice(it.from, it.to)}`
}

/** The keys of the items of a document (the numbers of items of numbered lists belong to the key). */
export function keysOf(doc: NotaDocument, items: readonly Item[]): string[] {
  const nums = itemNumbers(items)
  return items.map((it, i) =>
    itemKey(doc, it, it.kind === 'item' ? nums[i]! + (it.block!.label === 'Draft' ? '~' + it.block!.marker : '') : it.block?.label === 'Draft' ? it.block.marker : ''),
  )
}

export class PosMap {
  /** Position before each top-level node. */
  starts: number[] = []
  readonly keys: string[]

  constructor(
    readonly doc: NotaDocument,
    readonly items: Item[],
    pm: PMNode,
    keys?: string[],
    /** An item of a list in a cell that is only started; it is in the table the map gives, and not in the text. */
    readonly cellDraft: CellDraft | null = null,
  ) {
    this.keys = keys ?? keysOf(doc, items)
    this.measure(pm)
  }

  /** The size of each top-level node, and the ProseMirror document the positions were read from. */
  sizes: number[] = []
  pm!: PMNode

  /** Reads the positions of the nodes of the ProseMirror document. */
  measure(pm: PMNode): void {
    this.starts = []
    this.sizes = []
    this.pm = pm
    pm.forEach((node, offset) => {
      this.starts.push(offset)
      this.sizes.push(node.nodeSize)
    })
  }

  private tables = new Map<number, TableView | null>()

  /** The table the item `index` is shown as (null for an item that is not a table). */
  tableView(index: number): TableView | null {
    const it = this.items[index]
    if (!it || it.kind !== 'table') return null
    let v = this.tables.get(index)
    if (v === undefined) {
      v = tableViewAt(this.doc, it.from)
      if (v && this.cellDraft && this.cellDraft.index === index) v = withCellDraft(v, this.cellDraft)
      this.tables.set(index, v)
    }
    return v
  }

  /** The index of the top-level node that holds `pos` (a position between two nodes belongs to the one after it). */
  indexAt(pos: number, pm: PMNode): number {
    let lo = 0
    let hi = this.starts.length - 1
    let i = 0
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (this.starts[mid]! <= pos) {
        i = mid
        lo = mid + 1
      } else hi = mid - 1
    }
    void pm
    return i
  }

  reading(index: number): Reading | null {
    const it = this.items[index]
    if (!it || isVerbatim(it) || it.kind === 'table') return null
    const b = it.block
    return b?.content ? readInline(this.doc, b.content.from, b.content.to) : null
  }

  /** The cached starts of the characters of the verbatim items that have a line break of two characters (`\r\n`). */
  private breaks = new Map<number, number[]>()

  /** The number of positions in the text of a verbatim item (code, a caption, an island): its characters, a line break is one. */
  verbLength(index: number): number {
    const c = this.items[index]!.block!.content!
    const starts = this.verbStarts(index)
    return starts ? starts.length : c.to - c.from
  }

  /** The offsets of the characters of a verbatim item, when a line break is two of them; null when each character is one. */
  private verbStarts(index: number): number[] | null {
    const c = this.items[index]!.block!.content!
    const text = this.doc.text
    const cr = text.indexOf('\r', c.from)
    if (cr < 0 || cr >= c.to) return null
    let out = this.breaks.get(index)
    if (!out) {
      out = []
      for (let i = c.from; i < c.to; ) {
        out.push(i)
        i += text[i] === '\r' && text[i + 1] === '\n' && i + 1 < c.to ? 2 : 1
      }
      this.breaks.set(index, out)
    }
    return out
  }

  /** The offset of the text before the `cell`-th character of a verbatim item (past the end: the end of its text). */
  verbOffset(index: number, cell: number): number {
    const c = this.items[index]!.block!.content!
    const starts = this.verbStarts(index)
    if (!starts) return c.from + Math.max(0, Math.min(cell, c.to - c.from))
    return cell <= 0 ? c.from : cell >= starts.length ? c.to : starts[cell]!
  }

  /** The number of characters of a verbatim item before `offset` of the text. */
  verbCell(index: number, offset: number): number {
    const c = this.items[index]!.block!.content!
    const starts = this.verbStarts(index)
    const o = Math.max(c.from, Math.min(offset, c.to))
    if (!starts) return o - c.from
    let lo = 0
    let hi = starts.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (starts[mid]! < o) lo = mid + 1
      else hi = mid
    }
    return lo
  }

  /** Where a ProseMirror position is, in terms of the items. */
  locate(pos: number, pm: PMNode): Located {
    const index = this.indexAt(pos, pm)
    const it = this.items[index]!
    const start = this.starts[index]!
    const size = pm.child(index).nodeSize
    if (it.kind === 'fence') return { index, where: 'at', cell: pos <= start ? 0 : 1 }
    if (pos <= start) return { index, where: 'at', cell: 0 }
    if (pos >= start + size) return { index, where: 'at', cell: 1 }
    return { index, where: 'in', cell: pos - start - 1 }
  }

  /** The position of a cell of an item. */
  posOf(index: number, cell: number): number {
    return this.starts[index]! + 1 + cell
  }

  /** The item that holds `offset` of the text and the cell there, or the plate / empty paragraph it is in. */
  itemAt(offset: number): { index: number; cell: number | null } {
    const items = this.items
    let lo = 0
    let hi = items.length - 1
    let i = 0
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (items[mid]!.from <= offset) {
        i = mid
        lo = mid + 1
      } else hi = mid - 1
    }
    const it = items[i]!
    if (it.kind === 'empty' || it.kind === 'fence' || it.kind === 'table') return { index: i, cell: it.kind === 'empty' ? 0 : null }
    if (isVerbatim(it)) return { index: i, cell: this.verbCell(i, offset) }
    const b = it.block!
    const c = b.content!
    if (offset <= c.from) return { index: i, cell: 0 }
    const r = this.reading(i)!
    if (offset >= c.to) return { index: i, cell: r.cells.length }
    return { index: i, cell: cellsBefore(r.cells, offset) }
  }
}

/** The name of a mark of a span as ProseMirror marks it. */
const ROLES = 'roles:'
function keysOfSpan(s: Span): string[] {
  if (s.type === 'lock') return []
  if (s.type === 'link') return [`link:${s.href}`]
  if (s.type !== 'roles') return [s.type]
  // roles are told apart by their `[…]`; `[.zz-a]*x*` is bold as well
  const implied = impliedMark(s)
  return implied ? [implied, ROLES + s.attrs] : [ROLES + s.attrs]
}
const keyOfMark = (m: Mark): string =>
  m.type.name === 'link'
    ? `link:${m.attrs.href as string}`
    : m.type.name === 'roles'
      ? ROLES + (m.attrs.attrs as string)
      : m.type.name

/**
 * Where among the offsets of the text that stand for one position between two cells a character with `marks` goes:
 * the one whose marks are those of the character; the marks it lacks are asked for.
 */
export function chooseOffset(
  block: BlockInfo,
  reading: Reading,
  cell: number,
  marks: readonly Mark[],
): { at: number; add: string[]; remove: string[] } {
  const cells = reading.cells
  const lo = cell > 0 ? cells[cell - 1]!.to : block.content!.from
  const hi = cell < cells.length ? cells[cell]!.from : block.content!.to
  const offsets = new Set<number>([lo, hi])
  for (const s of reading.spans)
    for (const o of [s.from, s.innerFrom, s.innerTo, s.to]) if (o >= lo && o <= hi) offsets.add(o)
  const want = new Set(marks.map(keyOfMark))
  let best: { at: number; score: number; active: Span[] } | null = null
  for (const at of [...offsets].sort((a, b) => a - b)) {
    if (!isInsertionPoint(reading, at)) continue
    const active = spansAt(reading, at)
    const have = new Set(active.flatMap(keysOfSpan))
    let score = 0
    for (const k of want) if (!have.has(k)) score += 1
    for (const k of have) if (!want.has(k)) score += 1
    if (!best || score < best.score) best = { at, score, active }
  }
  if (!best) return { at: lo, add: [], remove: [] }
  const have = new Set(best.active.flatMap(keysOfSpan))
  // (a link or roles are not asked for: they are in the text where they are, and typing never makes one)
  const own = (k: string): boolean => k.startsWith('link:') || k.startsWith(ROLES)
  const add = [...want].filter((k) => !have.has(k) && !own(k))
  const remove = [...have].filter((k) => !want.has(k) && !own(k))
  return { at: best.at, add, remove }
}
