import fc from 'fast-check'
import { type NotaDocument, type TextChange, parse } from '@nota-adoc/core'
import { headerEntries, knownIdsOf, scanOf, swapTargetsMemory } from '@nota-adoc/core/internal'
import { renderHtml } from '@nota-adoc/html'
import { type Parsed, checkLossless, treeSignature } from '../lib/invariants.js'
import { editorInput, runActions } from './editor.js'
import { asciidocText, editSpec, junkText, resolveEdit } from './generators.js'
import { tablesText } from './tables.js'
import { checkOperation, operationInput } from './operations.js'
import { checkTableOperation, tableOperationInput } from './table-operations.js'
import { checkColorOperation, colorInput } from './color-operations.js'
import { schemaText, validateAsg } from '../asg/schema.js'

let schemaChecked: boolean | null = null
/** The schema can be had (fetched once); without network the fuzz checks everything but the schema. */
function schemaAvailable(): boolean {
  if (schemaChecked === null) {
    try {
      schemaText()
      schemaChecked = true
    } catch {
      schemaChecked = false
    }
  }
  return schemaChecked
}

export interface RunOptions {
  runs: number
  seed: number
  /** Replaces the parser under test (used to test the fuzzer itself). */
  parseFn?: (text: string) => Parsed
}

export interface RunResult {
  name: string
  runs: number
  failure: string | null
  report: string
}

function applyChanges(text: string, changes: readonly TextChange[]): string {
  const sorted = [...changes].sort((a, b) => a.from - b.from)
  let out = ''
  let pos = 0
  for (const c of sorted) {
    out += text.slice(pos, c.from) + (c.insert ?? '')
    pos = c.to ?? c.from
  }
  return out + text.slice(pos)
}

/** Differences between an incrementally updated document and a full parse of the same text. */
function compareWithFull(updated: NotaDocument, expectedText: string): string | null {
  // the answer of the update is read first; the full parse then goes without the memory of the targets
  void updated.diagnostics
  void updated.references()
  const kept = swapTargetsMemory()
  try {
    return compareWithFullFresh(updated, expectedText)
  } finally {
    swapTargetsMemory(kept)
  }
}

function compareWithFullFresh(updated: NotaDocument, expectedText: string): string | null {
  if (updated.text !== expectedText) return 'updated text differs from the text with the changes applied'
  const full = parse(expectedText)
  const a = treeSignature(updated.tree)
  const b = treeSignature(full.tree)
  if (a !== b) {
    const as = a.split(' ')
    const bs = b.split(' ')
    let i = 0
    while (i < as.length && as[i] === bs[i]) i++
    return `tree differs from a full parse at node ${i}: update gives ${as.slice(i, i + 3).join(' ')}, full parse ${bs.slice(i, i + 3).join(' ')}`
  }
  if (JSON.stringify(updated.diagnostics) !== JSON.stringify(full.diagnostics))
    return `diagnostics differ: ${JSON.stringify(updated.diagnostics)} vs ${JSON.stringify(full.diagnostics)}`
  // what the meaning of the text gives: the outline, and the HTML that is built on the same model
  if (JSON.stringify(updated.outline()) !== JSON.stringify(full.outline())) return 'outline differs from a full parse'
  if (JSON.stringify(updated.references()) !== JSON.stringify(full.references()))
    return 'references differ from a full parse'
  if (JSON.stringify(updated.colors()) !== JSON.stringify(full.colors())) return 'colors differ from a full parse'
  if (renderHtml(updated) !== renderHtml(full)) return 'html differs from a full parse'
  return null
}

function identity(parseFn: (text: string) => Parsed) {
  return (text: string) => {
    const problems = checkLossless(text, parseFn)
    if (problems.length) throw new Error(problems.join('\n'))
  }
}

function incremental(input: { text: string; edits: import('./generators.js').EditSpec[] }) {
  const { text, edits } = input
  // one by one
  let doc = parse(text)
  for (const e of edits) {
    const change = resolveEdit(doc.text, e)
    const beforeText = doc.text
    const beforeSig = treeSignature(doc.tree)
    const beforeDiags = JSON.stringify(doc.diagnostics)
    const next = doc.update([change])
    const problem = compareWithFull(next, applyChanges(beforeText, [change]))
    if (problem) throw new Error(`after ${JSON.stringify(change)}: ${problem}`)
    if (
      doc.text !== beforeText ||
      treeSignature(doc.tree) !== beforeSig ||
      JSON.stringify(doc.diagnostics) !== beforeDiags
    )
      throw new Error('update modified the previous document')
    doc = next
  }
  // as one batch of non-overlapping changes against the original text
  const batch: TextChange[] = []
  let floor = 0
  for (const e of [...edits].sort((x, y) => x.at - y.at)) {
    const c = resolveEdit(text, { ...e, spot: null })
    const from = Math.max(c.from, floor)
    const to = Math.max(from, Math.min(c.to, text.length))
    if (from > text.length) break
    batch.push({ from, to, insert: c.insert })
    floor = to === from ? to + 1 : to
  }
  const original = parse(text)
  const problem = compareWithFull(original.update([...batch].reverse()), applyChanges(text, batch))
  if (problem) throw new Error(`after batch ${JSON.stringify(batch)}: ${problem}`)
}

/** The ASG, outline, footnotes and references of any text: they do not throw, the ranges hold the text, the ASG fits the schema. */
function semantics(withSchema: boolean) {
  const resolver = {
    xref: (path: string) => (path.length % 2 === 0 ? { title: path } : null),
    include: (target: string) => (target === 'part.adoc' ? '== Part\n\ninclude::part.adoc[]\n\nx <<anchor-id>>' : null),
  }
  return (text: string) => {
    for (const doc of [parse(text), parse(text, { resolver })]) {
      const asg = doc.asg()
      JSON.stringify(asg)
      const walk = (value: unknown): void => {
        if (Array.isArray(value)) value.forEach(walk)
        else if (value && typeof value === 'object') {
          const o = value as { range?: [number, number]; location?: unknown }
          if (Array.isArray(o.range)) {
            const [from, to] = o.range
            if (!(from >= 0 && from <= to && to <= text.length)) throw new Error(`range ${from}..${to} is outside the text`)
            if (!Array.isArray(o.location)) throw new Error('a node without a location')
          }
          for (const [k, v] of Object.entries(o)) if (k !== 'location') walk(v)
        }
      }
      walk(asg)
      for (const e of doc.outline()) if (!(e.from >= 0 && e.from <= e.to && e.to <= text.length)) throw new Error('outline range')
      doc.footnotes()
      doc.references()
      doc.nodeAt(text.length >> 1)
      for (const c of parse(text, { colorRoles: ['hl-mint', 'marker-red'] }).colors())
        if (!(c.from >= 0 && c.from <= c.to && c.to <= text.length && text.slice(c.pieces[0]!.attrs.from, c.pieces[0]!.attrs.to).startsWith('[')))
          throw new Error('color range')
      doc.colorAt(text.length >> 1)
      if (withSchema) {
        const r = validateAsg(asg)
        if (!r.ok) throw new Error(`the ASG does not fit the schema: ${r.errors.slice(0, 3).join('; ')}`)
      }
    }
  }
}

/**
 * What `references()` and the diagnostics of the meaning are made of, found unit by unit (and kept with the unit), equals what a walk of
 * the whole tree finds; every id of a section that the model gives is a target the references know.
 */
function scanAgainstTree(text: string): void {
  const doc = parse(text)
  const scan = scanOf(doc)
  const anchors: string[] = []
  const xrefs: string[] = []
  const entries: string[] = []
  const includes: string[] = []
  const lines: string[] = []
  const header = new Set(headerEntries(doc.tree.topNode).map((e) => e.from))
  const span = (from: number, to: number) => `${from}-${to}`
  const trim = (from: number, to: number) => {
    let e = to
    while (e > from && text.charCodeAt(e - 1) <= 32) e--
    return e
  }
  doc.tree.iterate({
    enter(ref) {
      const n = ref.node
      switch (ref.name) {
        case 'BlockAnchor':
        case 'InlineAnchor': {
          const id = n.getChild('AnchorId')
          if (id) anchors.push(`${text.slice(id.from, id.to)}@${span(ref.from, trim(ref.from, ref.to))}`)
          return false
        }
        case 'BlockAttributes': {
          let positional = 0
          let named = 0
          let plain: typeof n | null = null
          for (let a = n.firstChild; a; a = a.nextSibling) {
            if (a.name === 'PositionalAttribute') {
              positional++
              const sid = a.getChild('ShorthandId')
              if (sid) anchors.push(`${text.slice(sid.from + 1, sid.to)}@${span(sid.from, sid.to)}`)
              else if (!a.firstChild) plain = a
            } else if (a.name === 'NamedAttribute') {
              named++
              const nm = a.getChild('AttributeName')
              const v = a.getChild('AttributeValue')
              if (nm && v && text.slice(nm.from, nm.to) === 'id') {
                const raw = text.slice(v.from, v.to)
                anchors.push(`${raw.length >= 2 && /^(["']).*\1$/s.test(raw) ? raw.slice(1, -1) : raw}@${span(a.from, a.to)}`)
              }
            }
          }
          if (positional === 1 && named === 0 && plain) {
            const raw = text.slice(plain.from, plain.to).trim()
            if (/\S\s+\S/.test(raw) && !/^["']/.test(raw) && !/[=]/.test(raw)) lines.push(`${raw}@${span(n.from, trim(n.from, n.to))}`)
          }
          return false
        }
        case 'Xref': {
          const t = n.getChild('MacroTarget')
          if (t) xrefs.push(`${text.slice(t.from, t.to)}@${span(ref.from, ref.to)}`)
          return false
        }
        case 'IncludeDirective': {
          const t = n.getChild('DirectiveTarget')
          includes.push(`${t ? text.slice(t.from, t.to) : ''}@${span(ref.from, trim(ref.from, ref.to))}`)
          return false
        }
        case 'AttributeEntry': {
          const parent = n.parent
          // (an entry in a cell with its own document is the business of that document)
          let inCell = false
          for (let up = parent; up; up = up.parent) if (up.name === 'CellContent') inCell = true
          if (!inCell && parent && (parent.name === 'Document' || parent.name === 'Section') && !header.has(ref.from)) {
            const name = n.getChild('AttributeName')
            const raw = name ? text.slice(name.from, name.to) : ''
            if (['toc', 'toc-placement', 'source-highlighter', 'doctype'].includes(raw)) entries.push(`${raw}@${span(ref.from, trim(ref.from, ref.to))}`)
          }
          // a value that runs over lines can hold a directive
          return
        }
        default:
          return
      }
    },
  })
  const same = (what: string, a: string[], b: string[]) => {
    const x = [...a].sort().join('|')
    const y = [...b].sort().join('|')
    if (x !== y) throw new Error(`${what}: the scan of the units finds ${x} but a walk of the tree finds ${y}`)
  }
  same('anchors', scan.anchors.map((a) => `${a.id}@${span(a.from, a.to)}`), anchors)
  same('xrefs', scan.xrefs.map((a) => `${a.target}@${span(a.from, a.to)}`), xrefs)
  same('includes', scan.includes.map((a) => `${a.target}@${span(a.from, a.to)}`), includes)
  same('entries', scan.bodyEntries.map((a) => `${a.name}@${span(a.from, a.to)}`), entries)
  same('lines', scan.attributeLines.map((a) => `${a.raw}@${span(a.from, a.to)}`), lines)
  // the ids of the sections: what the model gives are all targets
  // (an `:idseparator:` line inside the text of a list item is read as an entry by the parser's state but not by the model of the
  // document, which reads attributes the way Asciidoctor does: the ids are compared where no such line can be)
  if (/^:!?(?:idprefix|idseparator|sectids)!?:/m.test(text)) return
  const known = knownIdsOf(doc)
  for (const s of doc.outline()) if (s.id !== null && !known.has(s.id)) throw new Error(`the section id ${JSON.stringify(s.id)} is not a target of the references`)
}

type Prop = (opts: RunOptions) => fc.IProperty<[never]> | fc.IProperty<[unknown]>

const props: Record<string, Prop> = {
  'identity/random': (o) => fc.property(junkText, identity(o.parseFn ?? parse)) as fc.IProperty<[unknown]>,
  'identity/asciidoc': (o) =>
    fc.property(asciidocText, identity(o.parseFn ?? parse)) as fc.IProperty<[unknown]>,
  // renderHtml gives a string for any text
  'html/random': () =>
    fc.property(junkText, (text: string) => {
      if (typeof renderHtml(parse(text)) !== 'string') throw new Error('renderHtml did not give a string')
    }) as fc.IProperty<[unknown]>,
  'html/asciidoc': () =>
    fc.property(asciidocText, (text: string) => {
      if (typeof renderHtml(parse(text)) !== 'string') throw new Error('renderHtml did not give a string')
    }) as fc.IProperty<[unknown]>,
  // what a person does in the visual editor (needs a DOM: jsdom)
  'editor/actions': () =>
    fc.property(editorInput, (i) => {
      runActions(i.start, i.actions)
    }) as fc.IProperty<[unknown]>,
  'identity/tables': (o) => fc.property(tablesText, identity(o.parseFn ?? parse)) as fc.IProperty<[unknown]>,
  'html/tables': () =>
    fc.property(tablesText, (text: string) => {
      const html = renderHtml(parse(text))
      if (typeof html !== 'string') throw new Error('renderHtml did not give a string')
      if (html.includes('nota-unparsed')) throw new Error('a table was not parsed')
    }) as fc.IProperty<[unknown]>,
  'incremental/tables': () =>
    fc.property(
      fc.record({
        text: tablesText,
        edits: fc.array(editSpec, { minLength: 1, maxLength: 20, size: 'max' }),
      }),
      incremental,
    ) as fc.IProperty<[unknown]>,
  // the layout after an update is the layout of a full parse
  'tables/model': () =>
    fc.property(fc.record({ text: tablesText, e: editSpec }), ({ text, e }) => {
      const change = resolveEdit(text, e)
      const next = parse(text).update([change])
      const full = parse(applyChanges(text, [change]))
      for (let pos = 0; pos < full.text.length; pos += 11)
        if (JSON.stringify(next.tableAt(pos)) !== JSON.stringify(full.tableAt(pos)))
          throw new Error(`tableAt(${pos}) differs from a full parse`)
    }) as fc.IProperty<[unknown]>,
  // the meaning of a text: ASG (with the schema), outline, footnotes, references; with and without a resolver
  'asg/scan': () => fc.property(asciidocText, scanAgainstTree) as fc.IProperty<[unknown]>,
  'asg/random': () => fc.property(junkText, semantics(false)) as fc.IProperty<[unknown]>,
  'asg/asciidoc': () => fc.property(asciidocText, semantics(schemaAvailable())) as fc.IProperty<[unknown]>,
  'asg/tables': () => fc.property(tablesText, semantics(schemaAvailable())) as fc.IProperty<[unknown]>,
  // the operations on blocks, sections and lists: a refusal with a code, or changes that touch only the target
  'operations/structure': () => fc.property(operationInput, checkOperation) as fc.IProperty<[unknown]>,
  // the operations on tables: a refusal with a code, or changes that touch only the table and read as asked
  'operations/tables': () => fc.property(tableOperationInput, checkTableOperation) as fc.IProperty<[unknown]>,
  // the colour operations: a refusal with a code, or changes in attributes and marks only that give each character the asked colours
  'operations/colors': () => fc.property(colorInput, checkColorOperation) as fc.IProperty<[unknown]>,
  'incremental/asciidoc': () =>
    fc.property(
      fc.record({
        text: asciidocText,
        edits: fc.array(editSpec, { minLength: 1, maxLength: 20, size: 'max' }),
      }),
      incremental,
    ) as fc.IProperty<[unknown]>,
}

export const propertyNames = Object.keys(props)

export function runProperty(name: string, opts: RunOptions): RunResult {
  const prop = props[name]
  if (!prop) throw new Error(`unknown property ${name}; known: ${propertyNames.join(', ')}`)
  const details = fc.check(prop(opts) as fc.IProperty<[unknown]>, { numRuns: opts.runs, seed: opts.seed })
  return summarize(name, opts, details)
}

function summarize(name: string, opts: RunOptions, details: fc.RunDetails<[unknown]>): RunResult {
  if (!details.failed) {
    return {
      name,
      runs: details.numRuns,
      failure: null,
      report: `${name}: ${details.numRuns} runs, 0 failures (seed ${opts.seed})`,
    }
  }
  const counterexample = JSON.stringify(details.counterexample?.[0])
  const error =
    details.errorInstance instanceof Error ? details.errorInstance.message : String(details.errorInstance)
  const report = [
    `${name}: FAILED after ${details.numRuns} runs (seed ${opts.seed}, path ${details.counterexamplePath})`,
    `minimal counterexample: ${counterexample}`,
    `error: ${error}`,
    `reproduce: npm run fuzz -- --property ${name} --seed ${opts.seed} --runs ${opts.runs}`,
  ].join('\n')
  return { name, runs: details.numRuns, failure: error, report }
}

/**
 * `runProperty` in ONE `fc.check` (same seed, same cases, same bias, same report and reproduce line), but
 * asynchronous: the property gives the event loop a turn whenever `sliceMs` has passed since the last turn.
 * One synchronous run of 10-30 s (more on a loaded CI runner) keeps a vitest worker from answering its pool:
 * the call "onTaskUpdate" times out after 60 s. Now a synchronous piece is about `sliceMs` plus one case,
 * whatever the speed of the machine.
 */
export async function runPropertyYielding(name: string, opts: RunOptions, sliceMs = 500): Promise<RunResult> {
  const prop = props[name]
  if (!prop) throw new Error(`unknown property ${name}; known: ${propertyNames.join(', ')}`)
  const sync = prop(opts) as fc.IProperty<[unknown]>
  let last = Date.now()
  const asyncProp: fc.IAsyncProperty<[unknown]> = {
    isAsync: () => true,
    generate: (mrng, runId) => sync.generate(mrng, runId),
    shrink: (v) => sync.shrink(v),
    run: async (v) => {
      if (Date.now() - last >= sliceMs) {
        await new Promise<void>((resolve) => setImmediate(resolve))
        last = Date.now()
      }
      return sync.run(v)
    },
    runBeforeEach: () => Promise.resolve(sync.runBeforeEach()),
    runAfterEach: () => Promise.resolve(sync.runAfterEach()),
  }
  const details = await fc.check(asyncProp, { numRuns: opts.runs, seed: opts.seed })
  return summarize(name, opts, details)
}
