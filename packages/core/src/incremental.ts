/**
 * Units → Lezer tree, and reparsing after edits.
 *
 * A full parse runs the unit parser from offset 0. An update keeps every old unit whose examined
 * text ends before the first change, reparses from there, and resynchronises as soon as a new unit
 * ends where an old unit (entirely after the changes) starts in the same parse state: from that
 * point on the old units are reused as they are (their contents are position-relative). Because a
 * unit depends only on the text from its start and on the state at its start, the result is
 * identical to a full parse of the new text.
 */
import { Tree } from '@lezer/common'
import { patchCell } from './parse/cellpatch.js'
import { Type, nodeTypes, sectionLevel } from './nodes.js'
import type { Piece } from './parse/build.js'
import {
  type Diagnostic,
  type ParseSetup,
  type ParseState,
  type Unit,
  initialStateOf,
  parseUnit,
  sameState,
} from './parse/blocks.js'

/** One replacement of a text, as `doc.update` and `session.apply` take it: `from`–`to` of the old text becomes `insert`. */
export interface TextChange {
  /** Start of the replaced range in the old text (UTF-16 offset). */
  readonly from: number
  /** End of the replaced range in the old text; defaults to `from` (pure insertion). */
  readonly to?: number
  /** Inserted text; defaults to ''. */
  readonly insert?: string
}

/** The units of a text and their absolute start offsets. */
export interface UnitList {
  readonly units: readonly Unit[]
  readonly froms: readonly number[]
}

function parseFrom(
  text: string,
  pos: number,
  st: ParseState,
  setup: ParseSetup,
  units: Unit[],
  froms: number[],
): void {
  while (pos < text.length) {
    const u = parseUnit(text, pos, st, setup)
    if (u.length <= 0) throw new Error(`@nota-adoc/core: the parser made no progress at ${pos}`)
    units.push(u)
    froms.push(pos)
    pos += u.length
    st = u.end
  }
}

export function parseUnits(text: string, setup: ParseSetup): UnitList {
  const units: Unit[] = []
  const froms: number[] = []
  parseFrom(text, 0, initialStateOf(setup.attrs), setup, units, froms)
  return { units, froms }
}

const typeOf = (v: unknown): string => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v)

/** Normalised, validated changes sorted by position. */
export function normalizeChanges(changes: readonly TextChange[], length: number): Required<TextChange>[] {
  const out = changes
    .map((c) => ({ from: c.from, to: c.to ?? c.from, insert: c.insert ?? '' }))
    .sort((a, b) => a.from - b.from || a.to - b.to)
  let prev: { from: number; to: number } | null = null
  for (const c of out) {
    if (!Number.isInteger(c.from) || !Number.isInteger(c.to) || c.from < 0 || c.to < c.from || c.to > length)
      throw new RangeError(
        `@nota-adoc/core: invalid change range ${c.from}-${c.to} for a text of length ${length}. ` +
          `Offsets are UTF-16 offsets in the text of the document the change is applied to: 0 <= from <= to <= ${length}. ` +
          'If the text changed since the offsets were taken, take them again from the current document.',
      )
    if (typeof c.insert !== 'string')
      throw new TypeError(`@nota-adoc/core: the field \`insert\` of a change must be a string, got ${typeOf(c.insert)}`)
    if (prev && c.from < prev.to)
      throw new RangeError(
        `@nota-adoc/core: changes ${prev.from}-${prev.to} and ${c.from}-${c.to} overlap. ` +
          'Give non-overlapping replacements, all in coordinates of the same text (or merge them into one).',
      )
    prev = c
  }
  return out
}

export function applyChanges(text: string, changes: readonly Required<TextChange>[]): string {
  let out = ''
  let pos = 0
  for (const c of changes) {
    out += text.slice(pos, c.from) + c.insert
    pos = c.to
  }
  return out + text.slice(pos)
}

/** Units of the new text, reusing old units before and after the changed region. */
export function reparseUnits(
  old: UnitList,
  newText: string,
  changes: readonly Required<TextChange>[],
  oldText: string,
  setup: ParseSetup,
): UnitList {
  const oldLength = oldText.length
  if (changes.length === 0) return old
  const { units: ou, froms: of } = old
  const a = changes[0]!.from
  const b = changes[changes.length - 1]!.to
  const delta = newText.length - oldLength
  // first unit that may have seen changed text
  let r = 0
  while (r < ou.length && of[r]! + ou[r]!.lookAhead <= a) r++
  const units = ou.slice(0, r)
  const froms = of.slice(0, r)
  let pos = r < ou.length ? of[r]! : r > 0 ? of[r - 1]! + ou[r - 1]!.length : 0
  let st = r < ou.length ? ou[r]!.start : r > 0 ? ou[r - 1]!.end : initialStateOf(setup.attrs)
  let j = r
  while (pos < newText.length) {
    // resynchronise with an old unit that starts here, after all changes, in the same state
    const oldPos = pos - delta
    if (oldPos >= b) {
      while (j < ou.length && of[j]! < oldPos) j++
      if (j < ou.length && of[j] === oldPos && sameState(ou[j]!.start, st)) {
        for (let k = j; k < ou.length; k++) {
          units.push(ou[k]!)
          froms.push(of[k]! + delta)
        }
        return { units, froms }
      }
    }
    // (a letter in a cell of a table: the unit of the table is made from the old one)
    const patched =
      j === r && r < ou.length && changes.length === 1 && of[r] === pos && changes[0]!.to <= of[r]! + ou[r]!.length
        ? patchCell(ou[r]!, pos, changes[0]!, oldText, newText)
        : null
    const u = patched ?? parseUnit(newText, pos, st, setup)
    if (u.length <= 0) throw new Error(`@nota-adoc/core: the parser made no progress at ${pos}`)
    units.push(u)
    froms.push(pos)
    pos += u.length
    st = u.end
  }
  return { units, froms }
}

interface Frame {
  from: number
  level: number
  children: Tree[]
  positions: number[]
}

/** Builds the document tree: sections nest by the `close` counts recorded in the units. */
export function buildTree({ units, froms }: UnitList, length: number): Tree {
  const doc: Frame = { from: 0, level: -1, children: [], positions: [] }
  const stack: Frame[] = [doc]
  let top = doc
  let end = 0
  const add = (tree: Tree, from: number) => {
    top.children.push(tree)
    top.positions.push(from - top.from)
    end = from + tree.length
  }
  const closeTop = () => {
    const f = stack.pop()!
    top = stack[stack.length - 1]!
    add(
      new Tree(nodeTypes[Type.Section]!, f.children, f.positions, end - f.from, [[sectionLevel, f.level]]),
      f.from,
    )
  }
  for (let i = 0; i < units.length; i++) {
    const u = units[i]!
    const base = froms[i]!
    for (const p of u.pre) add(p.tree, base + p.offset)
    if (u.block) add(u.block.tree, base + u.block.offset)
    const s = u.section
    if (s) {
      for (let k = 0; k < s.close && stack.length > 1; k++) closeTop()
      top = { from: base + s.parts[0]!.offset, level: s.level, children: [], positions: [] }
      stack.push(top)
      for (const p of s.parts as Piece[]) add(p.tree, base + p.offset)
    }
    for (const p of u.post) add(p.tree, base + p.offset)
  }
  while (stack.length > 1) closeTop()
  return new Tree(nodeTypes[Type.Document]!, doc.children, doc.positions, length)
}

export function collectDiagnostics({ units, froms }: UnitList): Diagnostic[] {
  const out: Diagnostic[] = []
  // conditionals still open at the end of the text are reported where they were opened
  const open: { from: number; to: number; name: string; target: string; text: string | null }[] = []
  for (let i = 0; i < units.length; i++) {
    const u = units[i]!
    const base = froms[i]!
    for (const d of u.diagnostics) out.push({ ...d, from: d.from + base, to: d.to + base })
    for (const e of u.events) {
      if (e.open)
        open.push({ from: e.pos + base, to: e.end + base, name: e.name, target: e.target, text: e.text })
      else open.pop()
    }
  }
  for (const c of open)
    out.push({
      from: c.from,
      to: c.to,
      severity: 'warning',
      code: 'unterminated-conditional',
      message: `Unterminated preprocessor conditional directive: no endif for ${c.name}::${c.target}[${c.text ?? ''}]`,
    })
  return out.sort((a, b) => a.from - b.from)
}
