import type { SyntaxNode, Tree } from '@lezer/common'
import { type ColorModel, type ColorRun, colorAtOf, colorModelOf } from './colors.js'
import { type TableModel, tableModel } from './nodes.js'
import { type AttributeValue, AttributeTracker, AttrsBuilder, setupAttributes } from './parse/attrs.js'
import type { ParseSetup } from './parse/blocks.js'
import { cellReaders } from './parse/nested.js'
import { headerEntries } from './parse/header-entries.js'
import {
  type TextChange,
  type UnitList,
  applyChanges,
  buildTree,
  collectDiagnostics,
  normalizeChanges,
  parseUnits,
  reparseUnits,
} from './incremental.js'

import type { Diagnostic } from './parse/blocks.js'
import type { ParseState } from './parse/context.js'
import { type AsgDocument, type AsgNode, buildAsg, findNode } from './asg/asg.js'
import type { Resolver } from './asg/resolver.js'
import { type StyleProfile, styleProfileOf } from './edit/profile.js'
import {
  type FootnoteEntry,
  type OutlineEntry,
  type ReferenceEntry,
  footnotesOf,
  outlineOf,
  referencesOf,
  semanticDiagnostics,
} from './asg/semantics.js'

/** Options of {@link parse}. */
export interface ParseOptions {
  /**
   * Document attributes, as `Asciidoctor.load(…, { attributes })` takes them: a string sets the attribute
   * and locks it (the document cannot change it), `null` (or a name with a leading or trailing `!`) unsets
   * and locks it, `false` unsets it without locking, a value ending in `@` sets it without locking.
   */
  attributes?: Readonly<Record<string, AttributeValue>>
  /** Names of block macros (`name::target[attributes]`) to read as macros, besides `image`, `video`, `audio` and `toc`. */
  blockMacros?: readonly string[]
  /** What the host knows about other files: the targets of cross references and the texts of `include::` lines (see {@link Resolver}). */
  resolver?: Resolver
  /**
   * The roles the host knows as colours (`hl-mint`, `marker-red`). A role in the list is a colour even without the prefix
   * `hl-`; a role `hl-*` that is not in it is a colour with `known: false` and gets the hint `unknown-color-role`.
   */
  colorRoles?: readonly string[]
}

/** An immutable parsed AsciiDoc document. */
export interface NotaDocument {
  /** The source text, unchanged. */
  readonly text: string
  /** Lossless syntax tree: the leaves, in order, spell `text` exactly. */
  readonly tree: Tree
  /** Problems found while parsing, in document order. */
  readonly diagnostics: readonly Diagnostic[]
  /** The options the document was parsed with (its updates use them too). */
  readonly options: ParseOptions
  /**
   * The document attributes at a position: the ones in force where the unit (a block, a section title, the
   * header) that holds the position starts. Attribute entries inside that unit are not in it.
   */
  attributesAt(pos: number): ReadonlyMap<string, string>
  /** The document attributes the body starts with: those after the header (all of them, without a header). */
  attributesAfterHeader(): ReadonlyMap<string, string>
  /**
   * The layout of the innermost table that holds the position (the block of the table, its delimiters included), with
   * offsets in the text of the document; `null` outside a table. A table in the cell of a table is found first.
   */
  tableAt(pos: number): TableModel | null
  /**
   * The Abstract Semantic Graph of the document: JSON in the shape of the ASG schema of the Eclipse AsciiDoc project, with
   * `location` (line and column from 1, both ends inclusive) and `range` (`[from, to]`, offsets in the text) in every node.
   * The text of an `include::` line that the resolver of the host gives stands in the place of the line.
   */
  asg(): AsgDocument
  /** The deepest node of {@link asg} whose range holds the position; `null` outside the text. */
  nodeAt(pos: number): AsgNode | null
  /** The sections and discrete headings in the order of the text, with their ids, numbers and places. */
  outline(): readonly OutlineEntry[]
  /** The footnotes in the text, numbered from 1 (a repeat of a footnote by its id has its number). */
  footnotes(): readonly FootnoteEntry[]
  /** The cross references in the text, each with whether its target is in the document (or known to the resolver). */
  references(): readonly ReferenceEntry[]
  /** How the document is written: the markers of its lists, its tables, delimiters and blank lines (see {@link StyleProfile}). */
  styleProfile(): StyleProfile
  /**
   * The colour in the text: one run for each role on a continuous piece of marked-up text (`[.hl-mint]#…#`), with the
   * constructs of the source that make it and the place it is in. Roles inside code blocks, comments and the like are not colour.
   */
  colors(): readonly ColorRun[]
  /** The colour roles in force at a position, from the outside in; empty where there is none. */
  colorAt(pos: number): readonly string[]
  /**
   * Applies changes given in coordinates of this document's text (non-overlapping, in any order)
   * and reparses incrementally. Returns a new document; this one is not modified.
   *
   * @example
   * ```ts
   * const doc = parse('Hello world\n')
   * const next = doc.update([{ from: 6, to: 11, insert: 'there' }])
   * next.text // 'Hello there\n'
   * doc.text // 'Hello world\n' (unchanged)
   * ```
   *
   * @throws RangeError when a range is not `0 <= from <= to <= text.length` of this document, or when two ranges
   * overlap; the message names the ranges and the length of the text.
   * @throws TypeError when `insert` of a change is not a string; the message names the field and the type it got.
   */
  update(changes: readonly TextChange[]): NotaDocument
}

/** The units a document is made of: what scans of the text that are kept with the unit read. */
const unitLists = new WeakMap<NotaDocument, UnitList>()

export function unitsOf(doc: NotaDocument): UnitList {
  assertDocument(doc)
  return unitLists.get(doc)!
}

/**
 * Throws a TypeError unless `doc` was made by `parse()` or `doc.update()` of this copy of the package: a plain object
 * with the right fields is not enough, the engine keeps what it needs beside the document.
 */
export function assertDocument(doc: unknown): asserts doc is NotaDocument {
  if (typeof doc === 'object' && doc !== null && unitLists.has(doc as NotaDocument)) return
  const got = typeof doc === 'object' && doc !== null ? 'an object that is not one' : `${doc === null ? 'null' : typeof doc}`
  throw new TypeError(
    `@nota-adoc/core: expected a document made by parse() or doc.update() of this copy of @nota-adoc/core, got ${got}. ` +
      'A likely cause: two copies of @nota-adoc/core in node_modules (see `npm ls @nota-adoc/core`); ' +
      'a document made by one copy cannot be used with another.',
  )
}

/** The parse state at `pos`, of the unit that holds it (as for `attributesAt`); `null` for a document without units. */
export function parseStateAt(doc: NotaDocument, pos: number): ParseState | null {
  const { units, froms } = unitsOf(doc)
  if (units.length === 0) return null
  let lo = 0
  let hi = units.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (froms[mid]! <= pos) lo = mid
    else hi = mid - 1
  }
  const u = units[lo]!
  return pos >= froms[lo]! + u.length && lo === units.length - 1 ? u.end : u.start
}

class Doc implements NotaDocument {
  private _tree: Tree | null = null
  private _diagnostics: readonly Diagnostic[] | null = null
  private _asg: AsgDocument | null = null
  private _outline: readonly OutlineEntry[] | null = null
  private _footnotes: readonly FootnoteEntry[] | null = null
  private _references: readonly ReferenceEntry[] | null = null
  private _style: StyleProfile | null = null
  private _colors: ColorModel | null = null

  constructor(
    readonly text: string,
    private readonly units: UnitList,
    private readonly setup: ParseSetup,
    readonly options: ParseOptions,
  ) {
    unitLists.set(this, units)
  }

  attributesAfterHeader(): ReadonlyMap<string, string> {
    const first = this.units.units[0]
    if (!first) return this.setup.attrs.initial.map
    const top = this.tree.topNode
    const header = top.getChild('Header')
    // with a title the header is a unit of its own
    if (header?.getChild('DocumentTitle')) return first.end.attrs.map
    // without one the header is the entries before the first block, and it shares its unit with that block: the
    // state at the end of the unit has what the block set, so replay those entries alone
    const ab = new AttrsBuilder(first.start.attrs)
    const st = { doctype: first.start.attrs.get('doctype') ?? 'article', leveloffset: 0 }
    const tracker = new AttributeTracker(ab, this.setup.attrs.locked, st)
    const text = this.text
    const entry = (c: SyntaxNode): void => {
      const name = c.getChild('AttributeName')
      if (!name) return
      let raw = text.slice(name.from, name.to)
      const marker = c.getChild('UnsetMarker')
      if (marker) raw = marker.from < name.from ? `!${raw}` : `${raw}!`
      let value = ''
      const v = c.getChild('AttributeValue')
      if (v) {
        const parts: string[] = []
        for (let k = v.firstChild; k; k = k.nextSibling)
          if (k.name === 'ValueText') parts.push(text.slice(k.from, k.to))
        if (!v.firstChild) parts.push(text.slice(v.from, v.to))
        value = parts.reduce(
          (acc, part, i) => (i === 0 ? part : `${acc}${acc.endsWith(' +') ? '\n' : ' '}${part}`),
          '',
        )
      }
      tracker.entry(raw, value, true)
    }
    for (const c of headerEntries(top)) entry(c)
    return ab.freeze().map
  }

  attributesAt(pos: number): ReadonlyMap<string, string> {
    return parseStateAt(this, pos)?.attrs.map ?? this.setup.attrs.initial.map
  }

  tableAt(pos: number): TableModel | null {
    if (pos < 0 || pos >= this.text.length) return null
    for (let n: SyntaxNode | null = this.tree.resolveInner(pos, 1); n; n = n.parent) {
      if (n.type.name !== 'DelimitedBlock') continue
      const rel = n.tree?.prop(tableModel)
      if (!rel) continue
      // (a big table is asked for again and again by the one that edits it: the model is made once for a place)
      const known = this._tables.get(rel)
      if (known) return known
      const model = absolute(rel, n.from)
      this._tables.set(rel, model)
      return model
    }
    return null
  }

  private readonly _tables = new WeakMap<object, TableModel>()

  get tree(): Tree {
    return (this._tree ??= buildTree(this.units, this.text.length))
  }

  get diagnostics(): readonly Diagnostic[] {
    return (this._diagnostics ??= Object.freeze(
      [...collectDiagnostics(this.units), ...semanticDiagnostics(this)]
        .map((d, i) => ({ d, i }))
        .sort((a, b) => a.d.from - b.d.from || a.i - b.i)
        .map((x) => x.d),
    ))
  }

  asg(): AsgDocument {
    return (this._asg ??= buildAsg(this))
  }

  nodeAt(pos: number): AsgNode | null {
    return findNode(this.asg(), pos)
  }

  outline(): readonly OutlineEntry[] {
    return (this._outline ??= Object.freeze(outlineOf(this)))
  }

  footnotes(): readonly FootnoteEntry[] {
    return (this._footnotes ??= Object.freeze(footnotesOf(this)))
  }

  references(): readonly ReferenceEntry[] {
    return (this._references ??= Object.freeze(referencesOf(this)))
  }

  styleProfile(): StyleProfile {
    return (this._style ??= styleProfileOf(this))
  }

  private colorModel(): ColorModel {
    return (this._colors ??= colorModelOf(this))
  }

  colors(): readonly ColorRun[] {
    return this.colorModel().runs
  }

  colorAt(pos: number): readonly string[] {
    return colorAtOf(this.colorModel(), pos)
  }

  update(changes: readonly TextChange[]): NotaDocument {
    const norm = normalizeChanges(changes, this.text.length)
    const small = norm.length <= 4 && norm.every((c) => c.insert.length < 1000)
    const known = lastUpdate
    if (small && known && known.from === this && sameChanges(known.changes, norm)) return known.to
    const text = applyChanges(this.text, norm)
    const next = new Doc(
      text,
      reparseUnits(this.units, text, norm, this.text, this.setup),
      this.setup,
      this.options,
    )
    if (small) lastUpdate = { from: this, changes: norm, to: next }
    return next
  }
}

/**
 * The last small update, from the document and the changes to the result: an editor that has checked an edit and the
 * session that applies it get one document. It is one record for the whole process, held by nothing that a document
 * holds, so a version that the host keeps does not keep the ones that came after it.
 */
let lastUpdate: { from: Doc; changes: readonly Required<TextChange>[]; to: Doc } | null = null

function sameChanges(a: readonly Required<TextChange>[], b: readonly Required<TextChange>[]): boolean {
  return (
    a.length === b.length &&
    a.every((c, i) => c.from === b[i]!.from && c.to === b[i]!.to && c.insert === b[i]!.insert)
  )
}

/**
 * Parses AsciiDoc source into a lossless tree. Never throws on any input string: what the parser does not
 * understand is kept as it is and reported in `diagnostics`. `parse(text).text === text` for every `text`.
 *
 * @example
 * ```ts
 * const doc = parse('= Title\n\nSome *bold* text.\n')
 * doc.text // '= Title\n\nSome *bold* text.\n'
 * doc.outline() // the sections
 * doc.diagnostics // problems found, in document order
 * ```
 */
export function parse(text: string, options: ParseOptions = {}): NotaDocument {
  const setup = setupOf(options)
  return new Doc(text, parseUnits(text, setup), setup, options)
}

/** What the parse of a document with these options is set up with. */
export function setupOf(options: ParseOptions): ParseSetup {
  return {
    attrs: setupAttributes(options.attributes),
    blockMacros: new Set(options.blockMacros ?? []),
    cells: cellReaders,
  }
}

/**
 * Parses the text of a table cell with the `a` style as the document Asciidoctor reads in it: `setup` is what
 * `cellSetup` made from the setup of the document that holds the table. The tree is over the text of the cell.
 */
export function parseNested(text: string, setup: ParseSetup): NotaDocument {
  return new Doc(text, parseUnits(text, setup), setup, {})
}

/** The models handed out for a table, by the model in the tree: the offsets of the tree's models are relative to the block. */
const absolutes = new WeakMap<TableModel, { base: number; model: TableModel }>()

function absolute(rel: TableModel, base: number): TableModel {
  const known = absolutes.get(rel)
  if (known && known.base === base) return known.model
  const cell = (c: TableModel['rows']['body'][number]['cells'][number]) => ({
    ...c,
    from: c.from + base,
    to: c.to + base,
    contentFrom: c.contentFrom + base,
    contentTo: c.contentTo + base,
    fill: c.fill && { ...c.fill, from: c.fill.from + base, to: c.fill.to + base },
  })
  const rows = (list: TableModel['rows']['body']) => list.map((r) => ({ cells: r.cells.map(cell) }))
  const model: TableModel = {
    ...rel,
    from: rel.from + base,
    to: rel.to + base,
    rows: { head: rows(rel.rows.head), body: rows(rel.rows.body), foot: rows(rel.rows.foot) },
    dropped: rel.dropped.map((c) => ({ ...c, from: c.from + base, to: c.to + base })),
  }
  absolutes.set(rel, { base, model })
  return model
}
