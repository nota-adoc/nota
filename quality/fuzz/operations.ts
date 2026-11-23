import fc from 'fast-check'
import { type AsgNode, type BlockSpec, type Operation, applyOperation, parse } from '@nota-adoc/core'
import { deepAsg, layoutItems, readLayout } from '@nota-adoc/core/internal'
import { treeSignature } from '../lib/invariants.js'
import { fixtureTexts } from './editor.js'
import { asciidocText, lineTemplates } from './generators.js'

/** Codes an operation may refuse with. */
/** The message of the refusal for a block that is not at `at` (the diagnostics are never empty here: checked above). */
const NO_BLOCK = 'There is no block here to work on'

export const CODES = new Set([
  'invalid-range',
  'invalid-target',
  'invalid-level',
  'invalid-block',
  'unwritable',
  'unsupported',
  'fragment-invalid',
  'unexpected-kind',
  'collateral',
  'first-item',
  'top-level-item',
  'item-has-items',
  'list-middle',
  'bad-level',
  'not-editable',
  'unstable',
  'becomes-plate',
])

/** How many blocks after a written attribute entry or conditional were checked (they are not skipped). */
export const stats = { afterEntry: 0 }

/** A line that changes how the text after it reads: an attribute entry, a conditional, an include, a block title. */
export const GLOBAL_LINE = /^(:[^\n:]+!?:|ifn?def::|ifeval::|include::|\.[^\s.])/m

// ---------------------------------------------------------------- the documents

/** Documents of sections, paragraphs, lists, blocks that hold blocks and tables, well formed, with random damage. */
const word = fc.constantFrom('alpha', 'beta', '*bold*', '_em_', '`code`', '<<x>>', 'https://e.com', '{attr}', 'text', 'x|y', 'Привет')
const sentence = fc.array(word, { minLength: 1, maxLength: 6 }).map((w) => w.join(' '))

function blockLines(depth: number): fc.Arbitrary<string[]> {
  const leaf: fc.Arbitrary<string[]>[] = [
    sentence.map((s) => [s]),
    fc.array(sentence, { minLength: 2, maxLength: 3 }),
    sentence.map((s) => ['.Title', s]),
    sentence.map((s) => ['[#id' + s.length + '.role]', s]),
    fc.constant(['----', 'code', '----']),
    fc.constant(['[source,ts]', '----', 'let a = 1', '----']),
    fc.constant(["'''"]),
    fc.constant(['// comment']),
    sentence.map((s) => ['NOTE: ' + s]),
    fc.array(sentence, { minLength: 1, maxLength: 4 }).map((a) => a.map((s) => '* ' + s)),
    fc.array(sentence, { minLength: 1, maxLength: 4 }).map((a) => a.map((s) => '. ' + s)),
    fc.array(sentence, { minLength: 2, maxLength: 4 }).map((a) => a.map((s, i) => (i % 2 ? '** ' : '* ') + s)),
    fc.array(sentence, { minLength: 2, maxLength: 3 }).map((a) => [`* ${a[0]}`, '+', a[1]!, ...(a[2] ? ['+', a[2]] : [])]),
    fc.array(sentence, { minLength: 1, maxLength: 3 }).map((a) => a.map((s, i) => `term${i}:: ${s}`)),
    fc.array(sentence, { minLength: 1, maxLength: 3 }).map((a) => ['|===', ...a.map((s) => `|${s} |b`), '|===']),
    sentence.map((s) => ['|===', `a|${s}`, '', '* x', '', '|b', '|===']),
    // cells of the `a` style: blocks on the line of the `a|`, on lines of their own, with blank lines last, in several cells
    sentence.map((s) => ['[cols="1"]', '|===', 'a|', s, '', 'p2', '', '|===']),
    sentence.map((s) => ['[cols="1"]', '|===', `a|${s}`, '', 'p2', '|===']),
    sentence.map((s) => ['[cols="1,1"]', '|===', `a|${s}`, '', 'p2', 'a|q', '', '* x', '|===']),
    sentence.map((s) => ['[cols="1"]', '|===', 'a|', s, '', '|===']),
  ]
  const choices = depth > 0 ? [...leaf, container(depth - 1)] : leaf
  return fc.oneof(...choices)
}

function container(depth: number): fc.Arbitrary<string[]> {
  return fc
    .record({
      delim: fc.constantFrom('====', '****', '--', '____'),
      style: fc.constantFrom('', '[NOTE]', '[sidebar]'),
      inner: fc.array(blockLines(depth), { minLength: 1, maxLength: 3 }),
    })
    .map(({ delim, style, inner }) => [...(style ? [style] : []), delim, ...inner.flatMap((b, i) => (i ? ['', ...b] : b)), delim])
}

export const structuredText: fc.Arbitrary<string> = fc
  .record({
    title: fc.boolean(),
    parts: fc.array(
      fc.record({
        level: fc.integer({ min: 0, max: 3 }),
        blocks: fc.array(blockLines(1), { minLength: 0, maxLength: 4 }),
        gap: fc.integer({ min: 1, max: 2 }),
      }),
      { minLength: 1, maxLength: 5 },
    ),
    crlf: fc.boolean(),
    eof: fc.boolean(),
  })
  .map(({ title, parts, crlf, eof }) => {
    const out: string[] = title ? ['= Title', ''] : []
    for (const p of parts) {
      if (p.level > 0) out.push(`${'='.repeat(p.level + 1)} Section ${out.length}`, '')
      p.blocks.forEach((b, i) => {
        out.push(...b)
        if (i < p.blocks.length - 1 || p.level >= 0) out.push(...Array(p.gap).fill(''))
      })
    }
    let text = out.join('\n')
    if (!eof) text = text.replace(/\n+$/, '')
    return crlf ? text.replace(/\n/g, '\r\n') : text
  })

/** Lists of several levels and kinds, with blocks attached, among paragraphs. */
export const listText: fc.Arbitrary<string> = fc
  .array(
    fc.oneof(
      { weight: 6, arbitrary: fc.record({ m: fc.constantFrom('*', '**', '***', '-', '.', '..', '1.', '[ ]'), s: sentence }).map(({ m, s }) => (m === '[ ]' ? `* [ ] ${s}` : `${m} ${s}`)) },
      { weight: 1, arbitrary: sentence.map((s) => `+\n${s}`) },
      { weight: 1, arbitrary: fc.constant('') },
      { weight: 1, arbitrary: sentence },
    ),
    { minLength: 2, maxLength: 14 },
  )
  .map((lines) => lines.join('\n') + '\n')

/** Tables of cells of the `a` style with several blocks, in a section or a container, and text around them. */
const cellText: fc.Arbitrary<string> = fc
  .record({
    cells: fc.array(
      fc.record({
        inline: fc.boolean(),
        blocks: fc.array(fc.oneof(sentence, fc.constant('* x\n* y'), fc.constant('----\ncode\n----')), { minLength: 1, maxLength: 3 }),
        tail: fc.integer({ min: 0, max: 2 }),
      }),
      { minLength: 1, maxLength: 3 },
    ),
    after: fc.boolean(),
  })
  .map(({ cells, after }) => {
    const out = [`[cols="${cells.length}"]`, '|===']
    for (const c of cells) {
      out.push(c.inline ? `a|${c.blocks[0]}` : 'a|', ...(c.inline ? [] : [c.blocks[0]!]))
      for (const b of c.blocks.slice(1)) out.push('', b)
      out.push(...Array(c.tail).fill(''))
    }
    out.push('|===')
    return out.join('\n') + '\n' + (after ? '\nout\n' : '')
  })

const fixtures = fixtureTexts.filter((f) => f.text.length <= 6000).map((f) => f.text)
const documents = fc.oneof(
  { weight: 8, arbitrary: structuredText },
  { weight: 4, arbitrary: listText },
  { weight: 2, arbitrary: asciidocText },
  { weight: 1, arbitrary: fc.constantFrom(...fixtures) },
  { weight: 4, arbitrary: cellText },
)

// ---------------------------------------------------------------- the operations

const nasty = fc.constantFrom(
  '*a* {b} <<c>> x | y https://z',
  'plain',
  'with `code` and _em_',
  '\\*a*',
  'a +',
  '= not a title',
  '* not an item',
  'two\nlines',
  '  indented',
  '[x]',
  'x // y',
  'NOTE: y',
  '{plus}',
  '(C) -- ...',
  'Привет мир',
  '',
  'a\n\nb',
)

const blockSpec: fc.Arbitrary<BlockSpec> = fc.oneof(
  nasty.map((text): BlockSpec => ({ kind: 'paragraph', text })),
  fc.record({ level: fc.integer({ min: 1, max: 7 }), title: nasty }).map((r): BlockSpec => ({ kind: 'section', ...r })),
  fc
    .record({ list: fc.constantFrom('unordered', 'ordered', 'checklist') as fc.Arbitrary<'unordered'>, items: fc.array(nasty, { minLength: 0, maxLength: 3 }) })
    .map((r): BlockSpec => ({ kind: 'list', ...r })),
  fc
    .record({ header: fc.boolean(), rows: fc.array(fc.array(nasty, { minLength: 2, maxLength: 2 }), { minLength: 1, maxLength: 3 }) })
    .map((r): BlockSpec => ({ kind: 'table', ...r })),
  nasty.map((text): BlockSpec => ({ kind: 'listing', text })),
  nasty.map((text): BlockSpec => ({ kind: 'admonition', text })),
  fc
    .record({ kind: fc.constantFrom('example', 'sidebar', 'quote', 'open') as fc.Arbitrary<'example'>, text: nasty })
    .map((r): BlockSpec => r),
  fc.constantFrom<BlockSpec>({ kind: 'break' }, { kind: 'break', variant: 'page' }, { kind: 'literal', text: 'lit' }),
  fc
    .record({ target: fc.constantFrom('img/a.png', 'a b.png', '../x.svg', 'a[b].png', ''), caption: fc.option(nasty, { nil: undefined }) })
    .map((r): BlockSpec => ({ kind: 'image', ...r })),
  fc.record({ title: fc.option(nasty, { nil: undefined }), text: nasty }).map((r): BlockSpec => ({ kind: 'collapsible', ...r })),
  fc
    .record({ text: nasty, language: fc.constantFrom('text', 'js', 'python', 'a b', '') })
    .map((r): BlockSpec => ({ kind: 'listing', ...r })),
  fc
    .record({ text: nasty, form: fc.constantFrom('paragraph' as const, 'block' as const) })
    .map((r): BlockSpec => ({ kind: 'admonition', variant: 'NOTE', ...r })),
  fc
    .record({
      lines: fc.array(fc.constantFrom(...lineTemplates), { minLength: 1, maxLength: 4 }),
      expect: fc.option(fc.constantFrom('section', 'paragraph', 'list', 'listing') as fc.Arbitrary<'section'>, { nil: undefined }),
    })
    .map((r): BlockSpec => ({ source: r.lines.join('\n'), expect: r.expect })),
)

/** A place in the text: a start, the middle or the end of a block, or any offset. */
const place = fc.record({ r: fc.double({ min: 0, max: 1, noNaN: true }), mode: fc.integer({ min: 0, max: 5 }) })

export interface OperationInput {
  text: string
  kind: Operation['kind']
  at: { r: number; mode: number }
  to: { r: number; mode: number }
  where: 'before' | 'after'
  level: number
  block: BlockSpec
  list: 'unordered' | 'ordered' | 'checklist' | null
  /** The text for the code, the caption or the island. */
  text2: string
  /** The language for the code. */
  language: string
  /** Is the end of an island given (the way an island that is being edited is written)? */
  wide: boolean
}

const kinds: Operation['kind'][] = [
  'setCodeText',
  'setCodeLanguage',
  'setCaption',
  'setIslandText',
  'placeBlock',
  'placeBlock',
  'setSectionLevel',
  'insertBlock',
  'insertBlock',
  'moveBlock',
  'replaceBlock',
  'deleteBlock',
  'toggleList',
  'indentListItem',
  'outdentListItem',
]

export const operationInput: fc.Arbitrary<OperationInput> = fc.record({
  text: documents,
  kind: fc.constantFrom(...kinds),
  at: place,
  to: place,
  where: fc.constantFrom('before' as const, 'after' as const),
  level: fc.integer({ min: 1, max: 7 }),
  block: blockSpec,
  list: fc.constantFrom('unordered' as const, 'ordered' as const, 'checklist' as const, null),
  text2: fc.constantFrom('', 'x', 'a\nb', 'a\n\nb', '----', '....', '|===', '* item', '== Title', '// c', ':a: b', 'include::x.adoc[]', 'line\r\nline', '  indented', '.Title', '[source]', 'image::a.png[]'),
  language: fc.constantFrom('', 'js', 'python', 'a b', 'x,y', '-'),
  wide: fc.boolean(),
})

const STARTS = new Set([
  'Section',
  'DiscreteHeading',
  'Paragraph',
  'DelimitedBlock',
  'UnorderedList',
  'OrderedList',
  'DescriptionList',
  'ListItem',
  'BlankLine',
  'BlockMacro',
  'ThematicBreak',
  'LineComment',
  'IncludeDirective',
])

const BLOCKS = new Set([...STARTS].filter((n) => n !== 'BlankLine' && n !== 'ListItem'))

const FOR_KIND: Partial<Record<Operation['kind'], ReadonlySet<string>>> = {
  setSectionLevel: new Set(['Section', 'DiscreteHeading']),
  deleteBlock: BLOCKS,
  replaceBlock: BLOCKS,
  moveBlock: BLOCKS,
  toggleList: new Set(['Paragraph', 'UnorderedList', 'OrderedList', 'ListItem']),
  indentListItem: new Set(['ListItem']),
  outdentListItem: new Set(['ListItem']),
  setCodeText: new Set(['DelimitedBlock']),
  setCodeLanguage: new Set(['DelimitedBlock']),
  setCaption: new Set(['BlockMacro']),
  setIslandText: BLOCKS,
}

function resolvePlace(
  text: string,
  tree: import('@lezer/common').Tree,
  p: { r: number; mode: number },
  kind?: Operation['kind'],
): number {
  // (a fifth of the time, and always where the kind has no such node, any place)
  const names = (kind && FOR_KIND[kind]) || STARTS
  if (p.mode === 5) {
    // a place in a cell of the `a` style: a block of it, a blank line in it, the blank lines after its last block
    const inCells: number[] = []
    tree.iterate({
      enter: (ref) => {
        const parent = ref.node.parent?.name
        if ((parent === 'CellContent' && ref.name !== 'BlankLine' && names.has(ref.name)) || ref.name === 'BlankLine')
          if (parent === 'CellContent' || parent === 'DelimitedBlock') inCells.push(ref.from)
      },
    })
    if (inCells.length > 0) return inCells[Math.min(inCells.length - 1, Math.floor(p.r * inCells.length))]!
  }
  if (p.mode === 4 || p.mode === 5) return Math.min(text.length, Math.floor(p.r * (text.length + 1)))
  const nodes: [number, number][] = []
  tree.iterate({
    enter: (ref) => {
      if (names.has(ref.name)) nodes.push([ref.from, ref.to])
    },
  })
  if (nodes.length === 0) return Math.min(text.length, Math.floor(p.r * (text.length + 1)))
  const [from, to] = nodes[Math.min(nodes.length - 1, Math.floor(p.r * nodes.length))]!
  return p.mode === 0 ? from : p.mode === 1 ? (from + to) >> 1 : Math.max(from, to - 1)
}

export function toOperation(text: string, i: OperationInput): Operation {
  const doc = parse(text)
  const at = resolvePlace(text, doc.tree, i.at, i.kind)
  switch (i.kind) {
    case 'setSectionLevel':
      return { kind: i.kind, at, level: i.level }
    case 'insertBlock':
      return { kind: i.kind, at, where: i.where, block: i.block }
    case 'moveBlock':
      return { kind: i.kind, at, to: resolvePlace(text, doc.tree, i.to, 'insertBlock') }
    case 'replaceBlock': {
      const b = i.block
      return 'source' in b
        ? { kind: i.kind, at, source: b.source, expect: b.expect }
        : { kind: i.kind, at, source: sourceOfSpec(b) }
    }
    case 'toggleList':
      return { kind: i.kind, at, list: i.list }
    case 'setCodeText':
    case 'setCaption':
      return { kind: i.kind, at, text: i.text2 }
    case 'setCodeLanguage':
      return { kind: i.kind, at, language: i.language }
    case 'setIslandText': {
      // (an island that is being edited is written with the end of its lines: the island, as it is now)
      const island = layoutItems(readLayout(doc)).find((x) => x.kind === 'chip' && x.from <= at && at < x.to)
      return island && i.wide
        ? { kind: i.kind, at: island.from, text: i.text2, to: island.to }
        : { kind: i.kind, at, text: i.text2 }
    }
    case 'placeBlock':
      return { kind: i.kind, at, block: i.block, replace: i.where === 'before' }
    default:
      return { kind: i.kind as 'deleteBlock', at }
  }
}

/** Some AsciiDoc for a spec (a fragment for `replaceBlock`). */
function sourceOfSpec(b: Exclude<BlockSpec, { source: string }>): string {
  switch (b.kind) {
    case 'paragraph':
    case 'listing':
    case 'literal':
    case 'admonition':
      return b.text
    case 'section':
      return `${'='.repeat(Math.max(2, Math.min(6, b.level)))} ${b.title}`
    case 'list':
      return b.items.map((x) => `* ${x}`).join('\n')
    case 'table':
      return b.rows.map((r) => r.map((c) => `|${c}`).join(' ')).join('\n')
    default:
      return 'x'
  }
}

// ---------------------------------------------------------------- the checks

export function applyAll(text: string, changes: readonly { from: number; to: number; insert: string }[]): string {
  let out = ''
  let pos = 0
  for (const c of changes) {
    if (c.from < pos || c.to < c.from) throw new Error('changes are not sorted and apart')
    out += text.slice(pos, c.from) + c.insert
    pos = c.to
  }
  return out + text.slice(pos)
}

/** Every node of an ASG that has a range (blocks and inlines), with its parent chain names. */
export function nodesOf(root: AsgNode): AsgNode[] {
  const out: AsgNode[] = []
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) v.forEach(walk)
    else if (v && typeof v === 'object') {
      const n = v as AsgNode
      if (Array.isArray(n.range)) out.push(n)
      for (const [k, x] of Object.entries(n)) if (k !== 'location' && k !== 'range' && k !== 'metadata') walk(x)
    }
  }
  walk(root)
  return out
}

export const strip = (v: unknown): unknown => {
  if (Array.isArray(v)) return v.map(strip)
  if (v && typeof v === 'object') {
    const o: Record<string, unknown> = {}
    for (const [k, x] of Object.entries(v)) if (k !== 'location' && k !== 'range') o[k] = strip(x)
    return o
  }
  return v
}

function subBag(small: string[], big: string[]): boolean {
  const counts = new Map<string, number>()
  for (const l of big) counts.set(l, (counts.get(l) ?? 0) + 1)
  for (const l of small) {
    const n = counts.get(l) ?? 0
    if (n === 0) return false
    counts.set(l, n - 1)
  }
  return true
}

function asciiCell(doc: ReturnType<typeof parse>, from: number): boolean {
  const m = doc.tableAt(from)
  if (!m) return false
  for (const list of [m.rows.head, m.rows.body, m.rows.foot])
    for (const r of list) for (const c of r.cells) if (c.from === from) return c.style === 'asciidoc'
  return false
}

/** Is the place in a blank line of a table whose cell before it holds no blocks (not the `a` style)? */
function inPlainTableBlank(doc: ReturnType<typeof parse>, pos: number): boolean {
  const n = doc.tree.resolveInner(Math.min(pos, doc.text.length), 1)
  if (n.name !== 'BlankLine' || n.parent?.name !== 'DelimitedBlock') return false
  for (let p = n.prevSibling; p; p = p.prevSibling) {
    if (p.name === 'TableCell') return !asciiCell(doc, p.from)
    if (p.name !== 'BlankLine' && p.name !== 'Mark') return false
  }
  return false
}

/** Runs one operation input and checks what the operations promise. */
export function checkOperation(i: OperationInput): void {
  const text = i.text
  const doc = parse(text)
  const beforeSig = treeSignature(doc.tree)
  const op = toOperation(text, i)
  const r = applyOperation(doc, op)
  if (doc.text !== text || treeSignature(doc.tree) !== beforeSig) throw new Error('the operation changed the document it was given')
  if ('error' in r) {
    if (!CODES.has(r.error)) throw new Error(`a refusal with an unknown code: ${r.error}`)
    if (r.diagnostics.length === 0) throw new Error('a refusal without diagnostics')
    // a blank line between the rows of a plain table is a place like any other: a refusal there is a fault
    if (r.error === 'invalid-target' && (op.kind === 'insertBlock' || op.kind === 'moveBlock')) {
      const place = op.kind === 'insertBlock' ? op.at : op.to
      // (a move that is refused for the block to move, which is not there: a blank line of a table, say, is the
      // refusal of `at`, not of the place)
      if (op.kind === 'moveBlock' && op.at !== place && r.diagnostics.every((d) => d.from === op.at && d.message === NO_BLOCK)) return
      // (a block moved into the table it is, or is in, is a refusal that is right)
      const table = doc.tableAt(Math.min(place, doc.text.length - 1))
      let inside = op.kind === 'moveBlock' && !!table && op.at >= table.from && op.at < table.to
      if (!inside && op.kind === 'moveBlock') {
        // (or into a table that the moved block holds: a section, a list item with a table in it)
        let moved: [number, number] | null = null
        for (const n of nodesOf(deepAsg(doc))) {
          if (n.type !== 'block' || n.name === 'document' || n.range[0] > op.at || n.range[1] <= op.at) continue
          if (!moved || n.range[1] - n.range[0] < moved[1] - moved[0]) moved = [n.range[0], n.range[1]]
        }
        // (no block at `at`: the refusal is about that)
        inside = !moved || (place >= moved[0] && place <= moved[1])
      }
      if (!inside && inPlainTableBlank(doc, place)) throw new Error(`a refusal of a place in a blank line of a plain table (${place})`)
    }
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
  // what is away from the changes is as it was (shifted)
  // (the tables are open: the blocks of the cells of the `a` style are nodes too)
  const beforeDeep = deepAsg(doc)
  const afterDeep = deepAsg(full)
  const before = nodesOf(beforeDeep)
  const after = nodesOf(afterDeep)
  const index = new Map<string, AsgNode[]>()
  for (const n of after) {
    const k = `${n.name}|${n.range[0]}|${n.range[1]}`
    const list = index.get(k)
    if (list) list.push(n)
    else index.set(k, [n])
  }
  const shift = (pos: number): number => {
    let d = 0
    for (const c of changes) if (c.to <= pos) d += c.insert.length - (c.to - c.from)
    return pos + d
  }
  // (a block that holds others takes the blank lines after its last one: a block written there belongs to it)
  const reach = (n: AsgNode): number => {
    let e = n.range[1]
    while (e < text.length && /\s/.test(text[e]!)) e++
    return e
  }
  const away = (n: AsgNode): boolean =>
    changes.every((c) => reach(n) < c.from || n.range[0] > c.to) && !n.location[0].file
  const lineAround = (c: { from: number; to: number }): string => {
    const s = text.lastIndexOf('\n', c.from - 1) + 1
    const e = text.indexOf('\n', c.to)
    return text.slice(s, e < 0 ? text.length : e)
  }
  // (an island of attribute entries, conditionals or includes changes how the text after it reads: the levels, the values;
  // a `.Title` line left with no block after it is read by the tree of the ASG as the title of the section)
  // (the same for a block that is written by an operation: `:compat-mode:` placed at the top turns the backticks of the paragraphs after it
  // into passthroughs; the line `.Title` is not counted here, a block written before a paragraph takes it as its own title, which is a fault)
  // (the lines are read as they are in the result too: the marker of a list item that is kept in front of `Title` makes `.Title` of it)
  const lineIn = (c: { from: number; to: number; insert: string }): string => {
    let from = c.from
    for (const o of changes) if (o !== c && o.to <= c.from) from += o.insert.length - (o.to - o.from)
    const s = out.lastIndexOf('\n', from - 1) + 1
    const e = out.indexOf('\n', from + c.insert.length)
    return out.slice(s, e < 0 ? out.length : e)
  }
  // (such a line acts on what comes after it: the blocks that stand before the first change are checked as ever)
  let globalFrom = Infinity
  if (op.kind === 'setIslandText')
    for (const c of changes) if (GLOBAL_LINE.test(lineAround(c) + '\n' + c.insert + '\n' + lineIn(c))) globalFrom = Math.min(globalFrom, c.from)
  // (an entry or a conditional that the parser reads in the written part acts on the text after it only: what comes before it is checked as ever)
  // (and only so far as the entry is the cause: a block after the edit is checked as ever, and one that reads otherwise is let
  // go only when it reads as it did with the entries left out of the written text)
  let entryFrom = Infinity
  const entries: [number, number][] = []
  if (op.kind === 'placeBlock' || op.kind === 'insertBlock' || op.kind === 'replaceBlock')
    for (const c of changes) {
      if (c.insert === '') continue
      let from = c.from
      for (const o of changes) if (o !== c && o.to <= c.from) from += o.insert.length - (o.to - o.from)
      const to = from + c.insert.length
      full.tree.iterate({
        enter: (nd) => {
          if ((nd.name === 'AttributeEntry' || nd.name === 'Directive') && nd.from >= from && nd.from < to) {
            entryFrom = Math.min(entryFrom, c.from)
            entries.push([nd.from, out.startsWith('\r\n', nd.to) ? nd.to + 2 : out[nd.to] === '\n' ? nd.to + 1 : nd.to])
          }
        },
      })
    }
  // (an item that takes the one after it in, or one that is taken out of, changes with it: the items are checked as lists by the operation)
  // (and a section whose level changes is taken in by the section before it, or takes the ones after it in: the sections are checked as headings by the operation)
  const listMove = op.kind === 'indentListItem' || op.kind === 'outdentListItem'
  // (the text inside a paragraph that is changed is changed with it: a paragraph read by the tree to take a line like `* x` in, as
  // the layout reads it as a list item, is written over by the diff of the text only as far as the layout sees it)
  // (and a list whose last line is followed with no blank line by an island that `setIslandText` writes as an item takes that item in:
  // the written text is read as a nested or a next item of the list, the diff of the text keeps the marker characters that the
  // island and the item have in common, so the change itself looks away from the list)
  const ITEM_LINE = /^\s*(?:\*+|-+|\.+|\d+\.|[a-zA-Z]\.|[ivxlcdmIVXLCDM]+\))\s/
  const takesItemIn = (n: AsgNode): boolean => {
    if (op.kind !== 'setIslandText' || n.name !== 'list') return false
    // (the same for a list that follows the island, with blank lines or none between: the written item is the first item of that list)
    return changes.some((c) => {
      const gap = text.slice(n.range[1], c.from)
      if (c.from >= n.range[1] && !/\n[ \t]*\n/.test(gap) && gap.split('\n').length <= 2 && ITEM_LINE.test(lineIn(c))) return true
      return c.to <= n.range[0] && /^\s*$/.test(text.slice(c.to, n.range[0])) && ITEM_LINE.test(lineIn(c))
    })
  }
  const touched = before.filter((p) => (p.name === 'paragraph' && !away(p)) || takesItemIn(p))
  const inTouched = (n: AsgNode): boolean => touched.some((p) => p !== n && p.range[0] <= n.range[0] && n.range[1] <= p.range[1])
  let plain: Map<string, AsgNode[]> | null = null
  const without = (pos: number): number => {
    let d = 0
    for (const [a, b] of entries) if (b <= pos) d += b - a
    return pos - d
  }
  const readsWithout = (n: AsgNode, want: string): boolean => {
    if (!plain) {
      let t = ''
      let at = 0
      for (const [a, b] of [...entries].sort((x, y) => x[0] - y[0])) {
        t += out.slice(at, a)
        at = Math.max(at, b)
      }
      t += out.slice(at)
      plain = new Map()
      for (const m of nodesOf(deepAsg(parse(t)))) {
        const k = `${m.name}|${m.range[0]}|${m.range[1]}`
        plain.set(k, [...(plain.get(k) ?? []), m])
      }
    }
    const hits = plain.get(`${n.name}|${without(shift(n.range[0]))}|${without(shift(n.range[1]))}`)
    return !!hits && hits.some((h) => JSON.stringify(strip(h)) === want)
  }
  // (a `.Title` line left with no block after it is the title of the section that holds it: the title of that section, which is
  // its first line, is let go of as well; the other blocks before the line are checked)
  const sectionTitle = (n: AsgNode): boolean =>
    before.some((s) => {
      if (s.name !== 'section' || s.range[0] > n.range[0] || s.range[1] <= globalFrom || s.range[0] >= globalFrom) return false
      // (the first line of the section, or the line of its title when attribute lines such as `[pass]` stand before it)
      const title = Array.isArray(s.title) ? (s.title as AsgNode[]) : []
      const titleEnd = title.reduce((m, t) => Math.max(m, t.range[1]), s.range[0])
      const e = text.indexOf('\n', titleEnd)
      return n.range[1] <= (e < 0 ? text.length : e)
    })
  for (const n of before) {
    if (n.range[0] >= globalFrom || (globalFrom < Infinity && sectionTitle(n)) || !away(n) || takesItemIn(n) || inTouched(n) || n.name === 'document' || (listMove && (n.name === 'listItem' || n.name === 'list')) || (op.kind === 'setSectionLevel' && n.name === 'section')) continue
    const hits = index.get(`${n.name}|${shift(n.range[0])}|${shift(n.range[1])}`)
    const want = JSON.stringify(strip(n))
    if (n.range[0] >= entryFrom) stats.afterEntry++
    if (!hits || !hits.some((h) => JSON.stringify(strip(h)) === want)) {
      if (n.range[0] >= entryFrom && readsWithout(n, want)) continue
      throw new Error(`a ${n.name} at ${n.range[0]}-${n.range[1]} away from the changes is not as it was`)
    }
  }
  // the target has the form that was asked for
  switch (op.kind) {
    case 'deleteBlock':
      if (changes.some((c) => c.insert !== '')) throw new Error('a deletion that writes text')
      if (!subBag([...out.replace(/\s/g, '')].sort(), [...text.replace(/\s/g, '')].sort())) throw new Error('a deletion that adds text')
      break
    case 'moveBlock': {
      // (what is moved is kept: the same characters, but for the blanks, the `+` of a continuation and the `//` that keeps two lists apart)
      const chars = (t: string): string => [...t.replace(/[\s+/\\]/g, '')].sort().join('')
      if (chars(text) !== chars(out)) throw new Error('a move that does not keep the text')
      checkMove(text, op.to, shift, changes, beforeDeep, afterDeep)
      break
    }
    case 'replaceBlock':
      checkReplace(op, changes, beforeDeep, afterDeep)
      break
    case 'toggleList':
      checkToggle(op, text, out, changes, beforeDeep, afterDeep)
      break
    case 'setSectionLevel':
      if (!changes.some((c) => c.insert.length === op.level)) throw new Error('no title has the level that was asked for')
      for (const c of changes) {
        const old = text.slice(c.from, c.to)
        if (!/^(=+|#+)$/.test(old) || !/^(=+|#+)$/.test(c.insert) || old[0] !== c.insert[0]) throw new Error('a change of level that changes more than a marker')
      }
      break
    case 'indentListItem':
    case 'outdentListItem':
      for (const c of changes) if (!/^[\w.)*-]+$/.test(text.slice(c.from, c.to)) || !/^[\w.)*-]+$/.test(c.insert)) throw new Error('a change of depth that changes more than a marker')
      break
    case 'insertBlock': {
      if (changes.length !== 1 || changes[0]!.from !== changes[0]!.to) throw new Error('an insertion that is not one insertion')
      const c = changes[0]!
      const region = [c.from, c.from + c.insert.length] as const
      const inRegion = after.filter((n) => n.range[0] >= region[0] && n.range[1] <= region[1])
      const b = op.block
      const top = inRegion.filter((n) => !inRegion.some((m) => m !== n && m.range[0] <= n.range[0] && m.range[1] >= n.range[1] && (m.range[0] < n.range[0] || m.range[1] > n.range[1])))
      const blocks = top.filter((n) => n.type === 'block' && n.name !== 'listItem' && n.name !== 'dlistItem')
      const names = blocks.map((n) => n.name)
      const want = expectedNames(b)
      if (want && JSON.stringify(names) !== JSON.stringify(want)) throw new Error(`the new block reads as ${names.join(',')}, not ${want.join(',')}`)
      if ('kind' in b && b.kind === 'paragraph') {
        const inl = (blocks[0]?.['inlines'] ?? []) as { name: string; value: string }[]
        const expected = b.text.split(/\r?\n/).map((l) => l.trim()).join('\n')
        if (inl.length !== 1 || inl[0]!.name !== 'text' || inl[0]!.value !== expected) throw new Error('the text of the new paragraph is not what was given')
      }
      break
    }
    default:
      break
  }
}

function expectedNames(b: BlockSpec): string[] | null {
  if ('source' in b) {
    const names = (parse(b.source.replace(/^(?:[ \t]*\r?\n)+/, '').replace(/\s+$/, '') + '\n').asg().blocks ?? []).map((n) => n.name)
    return names
  }
  switch (b.kind) {
    case 'paragraph':
      return ['paragraph']
    case 'section':
      return ['section']
    case 'list':
      return ['list']
    case 'table':
      return ['literal']
    case 'collapsible':
      return ['example']
    case 'admonition':
      return null
    case 'break':
      return ['break']
    default:
      return [b.kind]
  }
}

// ---------------------------------------------------------------- the form of the target

interface Top {
  readonly node: AsgNode
  /** The name of the node that holds it. */
  readonly holderName: string
  /** Where the node that holds it starts (-1: the document). */
  readonly holder: number
}

/** The blocks of the ASG that lie inside a region, at the top of it, with the place of what holds them. */
function topIn(root: AsgNode, region: readonly [number, number]): Top[] {
  const out: Top[] = []
  const walk = (v: unknown, holder: number, holderName: string): void => {
    if (Array.isArray(v)) {
      for (const x of v) walk(x, holder, holderName)
      return
    }
    if (!v || typeof v !== 'object') return
    const n = v as AsgNode
    const ranged = Array.isArray(n.range)
    if (ranged && n.name !== 'document' && n.type === 'block' && n.range[0] >= region[0] && n.range[1] <= region[1]) {
      out.push({ node: n, holder, holderName })
      return
    }
    const h = ranged && n.name !== 'document' ? n.range[0] : holder
    const hn = ranged && n.name !== 'document' ? n.name : holderName
    for (const [k, x] of Object.entries(n)) if (k !== 'location' && k !== 'range' && k !== 'metadata') walk(x, h, hn)
  }
  walk(root, -1, 'document')
  return out
}

const signature = (n: AsgNode): string => JSON.stringify(strip(n))

/** The places of the changes in the text before and after them: [from, to] before, and [from, to] after. */
function spanOf(changes: readonly { from: number; to: number; insert: string }[]): { before: [number, number]; after: [number, number] } {
  const first = changes[0]!
  const last = changes[changes.length - 1]!
  let d = 0
  for (const c of changes) d += c.insert.length - (c.to - c.from)
  return { before: [first.from, last.to], after: [first.from, last.to + d] }
}

function checkReplace(
  op: Extract<Operation, { kind: 'replaceBlock' }>,
  changes: readonly { from: number; to: number; insert: string }[],
  beforeDeep: AsgNode,
  afterDeep: AsgNode,
): void {
  if (changes.length !== 1) throw new Error('a replacement that is not one replacement')
  const c = changes[0]!
  const now = topIn(afterDeep, [c.from, c.from + c.insert.length])
  const want = expectedNames({ source: op.source })
  const names = now.map((t) => t.node.name)
  if (want && JSON.stringify(names) !== JSON.stringify(want)) throw new Error(`the replacement reads as ${names.join(',')}, not ${want.join(',')}`)
  if (op.expect !== undefined && names.length !== 1) throw new Error('a replacement with an expected kind that is not one block')
  // (it stands in the place of the target: what holds it is what held the target)
  const was = topIn(beforeDeep, [c.from, c.to])
  if (was.length > 0 && ![...was, ...now].some((t) => t.node.name === 'section' || t.node.name === 'heading') && now.some((t) => t.holder !== was[0]!.holder))
    throw new Error('the replacement is held by another block than the one the target was in')
}

function checkMove(
  text: string,
  to: number,
  shift: (pos: number) => number,
  changes: readonly { from: number; to: number; insert: string }[],
  beforeDeep: AsgNode,
  afterDeep: AsgNode,
): void {
  const del = changes.find((c) => c.insert === '' && c.to > c.from)
  const ins = changes.find((c) => c.insert !== '' && c.from === c.to)
  if (!del || !ins || changes.length !== 2) return
  let d = 0
  for (const c of changes) if (c.to <= ins.from && c !== ins) d += c.insert.length - (c.to - c.from)
  const at = ins.from + d
  const moved = topIn(beforeDeep, [del.from, del.to]).map((t) => t.node).filter((n) => n.name !== 'comment')
  const got = topIn(afterDeep, [at, at + ins.insert.length]).map((t) => t.node).filter((n) => n.name !== 'comment')
  if (moved.length === 0) return
  if (moved.length !== got.length || moved.some((n, i) => signature(n) !== signature(got[i]!)))
    throw new Error(`the block that was moved does not read in its new place as it did (${moved.map((n) => n.name).join(',')} -> ${got.map((n) => n.name).join(',')})`)
  // where it is put: in the cell that holds the place, among the blocks there (in the one that holds the block at the place, or
  // the last one before a blank line)
  const target = topIn(beforeDeep, [del.from, del.to])
  const tops = topIn(afterDeep, [at, at + ins.insert.length])
  if (target.length === 0 || tops.length === 0) return
  const span = [target[0]!.node.range[0], target[target.length - 1]!.node.range[1]] as const
  let here: AsgNode | null = null
  for (const n of nodesOf(beforeDeep)) {
    if (n.type !== 'block' || n.name === 'document' || n.name === 'listItem' || n.name === 'dlistItem') continue
    if (n.range[0] > to || reachOf(text, n) < to || (to > n.range[1] && !blankAt(text, to)) || (n.range[0] <= span[0] && reachOf(text, n) >= span[1])) continue
    if (!here || reachOf(text, n) - n.range[0] < reachOf(text, here) - here.range[0]) here = n
  }
  if (!here) return
  const same = topIn(beforeDeep, [here.range[0], here.range[1]])[0]
  if (!same || same.node !== here || same.holderName !== 'literal') return
  const holder = shift(same.holder)
  if (tops.some((t) => t.holder !== holder)) throw new Error('the block was moved to a place in a cell and is not in that cell')
}

/** Whether the line that holds a position is blank (the position is on it). */
function blankAt(t: string, pos: number): boolean {
  const from = t.lastIndexOf('\n', Math.max(0, pos - 1)) + 1
  const nl = t.indexOf('\n', pos)
  return /^[ \t\r]*$/.test(t.slice(from, nl < 0 ? t.length : nl))
}

function reachOf(t: string, n: AsgNode): number {
  let e = n.range[1]
  while (e < t.length && /[ \t\r\n]/.test(t[e]!)) e++
  return e
}

function checkToggle(
  op: Extract<Operation, { kind: 'toggleList' }>,
  textBefore: string,
  textAfter: string,
  changes: readonly { from: number; to: number; insert: string }[],
  beforeDeep: AsgNode,
  afterDeep: AsgNode,
): void {
  const span = spanOf(changes)
  // the smallest paragraph or list that holds the changes, before
  const covering = (root: AsgNode, s: [number, number], names: ReadonlySet<string>, t: string): AsgNode | null => {
    let best: AsgNode | null = null
    for (const n of nodesOf(root))
      // (a block with the blank space after it: the changes take the line break of its last line)
      if (names.has(n.name) && n.range[0] <= s[0] && reachOf(t, n) >= s[1] && (!best || n.range[1] - n.range[0] < best.range[1] - best.range[0])) best = n
    return best
  }
  const target = covering(beforeDeep, span.before, new Set(['paragraph', 'list']), textBefore)
  if (!target) throw new Error('a change of a list that is in no paragraph or list')
  const variant = op.list === 'ordered' ? 'ordered' : 'unordered'
  const items = (target['items'] ?? []) as AsgNode[]
  if (target.name === 'paragraph') {
    const list = covering(afterDeep, span.after, new Set(['list']), textAfter)
    const now = (list?.['items'] ?? []) as AsgNode[]
    if (!list || now.length !== 1 || list['variant'] !== variant) throw new Error('a paragraph that does not read as a list of one item of the kind asked for')
    if (JSON.stringify(strip(now[0]!['principal'])) !== JSON.stringify(strip(target['inlines']))) throw new Error('the item does not have the text of the paragraph')
  } else if (op.list === null) {
    const now = topIn(afterDeep, [Math.min(span.after[0], target.range[0]), span.after[1]]).map((t) => t.node)
    if (now.length !== items.length || now.some((n, i) => n.name !== 'paragraph' || JSON.stringify(strip(n['inlines'])) !== JSON.stringify(strip(items[i]!['principal']))))
      throw new Error('a list that does not read as a paragraph for each item')
  } else {
    const list = covering(afterDeep, span.after, new Set(['list']), textAfter)
    if (!list || list['variant'] !== variant) throw new Error('a list that is not of the kind asked for')
  }
}
