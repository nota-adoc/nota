import { syntaxTree } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import { asciidoc, notaDocument } from '@nota-adoc/codemirror'
import { applyOperation, parse } from '@nota-adoc/core'
import { treeSignature } from '../lib/invariants.js'

/** Small deterministic PRNG (mulberry32). */
export function prng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const words =
  'lorem ipsum dolor sit amet engine parser section block attribute value table list tree text edit node'.split(
    ' ',
  )

/**
 * A synthetic document of roughly `size` characters: sections, paragraphs, blocks, comments, entries,
 * lists, blocks that hold blocks and conditions.
 */
export function generateDocument(size: number, seed = 7): string {
  const rnd = prng(seed)
  const pick = <T>(a: readonly T[]) => a[Math.floor(rnd() * a.length)]!
  // words, some with inline markup: quotes, links, attribute references, macros, replacements
  const markup: readonly ((w: string) => string)[] = [
    (w) => `*${w}*`,
    (w) => `_${w}_`,
    (w) => `\`${w}\``,
    (w) => `#${w}#`,
    (w) => `https://example.com/${w}[${w}]`,
    (w) => `{flavor}${w}`,
    (w) => `xref:${w}[]`,
    (w) => `footnote:[${w}]`,
    (w) => `${w} -- (C)`,
    (w) => `+${w}+`,
    (w) => `[.${w}]**${w}**`,
    (w) => `<<${w},${w}>>`,
    // a reference by the title of a section that is there (what people write: `<<Some Title>>`, resolved by the model)
    () => `<<Section ${Math.floor(rnd() * Math.max(1, n))}>>`,
    () => `<<Section ${Math.floor(rnd() * Math.max(1, n))},see here>>`,
  ]
  const sentence = () => {
    const n = 6 + Math.floor(rnd() * 10)
    const w: string[] = []
    for (let i = 0; i < n; i++) w.push(rnd() < 0.15 ? pick(markup)(pick(words)) : pick(words))
    return w.join(' ') + '.'
  }
  const out: string[] = [
    '= Generated Document',
    'Jane Doe <jane@example.com>',
    'v1.0, 2026-09-25',
    ':toc:',
    ':flavor: plain',
    '',
  ]
  let len = out.join('\n').length
  let n = 0
  while (len < size) {
    const level = 1 + Math.floor(rnd() * 3)
    const chunk: string[] = [`${'='.repeat(level + 1)} Section ${n++}`, '']
    const blocks = 2 + Math.floor(rnd() * 5)
    for (let b = 0; b < blocks; b++) {
      const kind = rnd()
      if (kind < 0.4) {
        const lines = 1 + Math.floor(rnd() * 5)
        for (let l = 0; l < lines; l++) chunk.push(sentence())
      } else if (kind < 0.47) {
        chunk.push('[source,json]', '----', '{"a": 1}', '{"b": 2}', '----')
      } else if (kind < 0.53) {
        chunk.push('NOTE: ' + sentence())
      } else if (kind < 0.58) {
        chunk.push('// ' + sentence())
        chunk.push(`:attr-${n}: ${pick(words)}`)
      } else if (kind < 0.63) {
        chunk.push('.Title', '[#id-' + n + '.role]', sentence())
      } else if (kind < 0.75) {
        // a list with nested items, a continuation and an attached block
        const items = 2 + Math.floor(rnd() * 4)
        for (let i = 0; i < items; i++) {
          chunk.push(`* ${sentence()}`)
          if (rnd() < 0.4) chunk.push(`** ${sentence()}`)
          if (rnd() < 0.2) chunk.push('+', sentence())
        }
      } else if (kind < 0.85) {
        // a block that holds a paragraph and a list
        chunk.push('====', sentence(), '', `. ${sentence()}`, `. ${sentence()}`, '====')
      } else if (kind < 0.93) {
        // conditions around blocks and lines
        chunk.push('ifdef::flavor[]', sentence(), 'endif::[]', 'ifndef::flavor[]', sentence(), 'endif::[]')
      } else {
        chunk.push(`term ${n}:: ${sentence()}`, `other ${n}:: ${sentence()}`)
      }
      chunk.push('')
    }
    const s = chunk.join('\n') + '\n'
    out.push(s)
    len += s.length + 1
  }
  return out.join('\n')
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2
}

export interface IncrementalResult {
  size: number
  parseMs: number
  updateMs: number
  ratio: number
  identical: boolean
}

/** Median full parse vs median update after a one-character edit inside a paragraph in the middle. */
export function measureIncremental(opts: { size?: number; samples?: number } = {}): IncrementalResult {
  const size = opts.size ?? 1_000_000
  const samples = opts.samples ?? 20
  const text = generateDocument(size)
  // a paragraph line near the middle
  let at = text.indexOf('\nlorem', Math.floor(text.length / 2))
  if (at < 0) at = text.indexOf('.\n', Math.floor(text.length / 2))
  at += 3
  const change = [{ from: at, insert: 'x' }]
  const base = parse(text)
  void base.tree
  // warm up
  for (let i = 0; i < 3; i++) {
    void parse(text).tree
    void base.update(change).tree
  }
  const parseTimes: number[] = []
  const updateTimes: number[] = []
  for (let i = 0; i < samples; i++) {
    let t = performance.now()
    const full = parse(text)
    void full.tree
    void full.diagnostics
    parseTimes.push(performance.now() - t)
    t = performance.now()
    const updated = base.update(change)
    void updated.tree
    void updated.diagnostics
    updateTimes.push(performance.now() - t)
  }
  const updated = base.update(change)
  const expected = parse(text.slice(0, at) + 'x' + text.slice(at))
  const identical = treeSignature(updated.tree) === treeSignature(expected.tree)
  const parseMs = median(parseTimes)
  const updateMs = median(updateTimes)
  return { size: text.length, parseMs, updateMs, ratio: parseMs / updateMs, identical }
}

export interface LargeCase {
  name: string
  text: () => string
}

/** Inputs that must parse without exceptions or stack overflow; `scale` shrinks them for tests. */
export function largeCases(scale = 1): LargeCase[] {
  const n = (x: number) => Math.max(1, Math.round(x * scale))
  return [
    { name: '4 MB, thousands of sections', text: () => generateDocument(n(4_000_000), 11) },
    { name: 'one 50 000 character line', text: () => 'x'.repeat(n(50_000)) + '\n' },
    {
      name: '10 000 nested blocks with delimiters of growing length',
      text: () => {
        const count = n(10_000)
        const open = Array.from({ length: count }, (_, i) => '='.repeat(4 + i))
        return [...open, 'text', ...open.reverse()].join('\n') + '\n'
      },
    },
    {
      // a line of markers that follows a text line is text of the paragraph, so the levels come from one line
      name: '10 000 levels of > quotes',
      text: () => '> '.repeat(n(10_000)) + 'text\n',
    },
    {
      name: '1 000 levels of > quotes separated by > lines',
      text: () => {
        const levels = n(1000)
        const lines: string[] = []
        for (let i = 0; i < levels; i++) lines.push('> '.repeat(i) + '> a', '> '.repeat(i) + '>')
        lines.push('> '.repeat(levels) + 'text')
        return lines.join('\n') + '\n'
      },
    },
    {
      name: 'a list of 100 000 items',
      text: () => Array.from({ length: n(100_000) }, (_, i) => `* item ${i}`).join('\n') + '\n',
    },
    {
      name: '100 000 lines in one example block',
      text: () => '====\n' + 'line\n'.repeat(n(100_000)) + '====\n',
    },
    {
      name: '10 000 nested unclosed ifdef',
      text: () => 'ifdef::never[]\n'.repeat(n(10_000)) + 'text\n',
    },
    { name: '100 000 ifeval lines', text: () => 'ifeval::[1 == 1]\n'.repeat(n(100_000)) + 'text\n' },
    { name: 'a list item of 50 000 characters', text: () => '* ' + 'x'.repeat(n(50_000)) + '\n' },
    { name: '50 000 lines of + in a row', text: () => '* item\n' + '+\n'.repeat(n(50_000)) + 'text\n' },
    { name: '100 000 lines [x]', text: () => '[x]\n'.repeat(n(100_000)) },
    { name: '200 000 blank lines', text: () => '\n'.repeat(n(200_000)) },
    {
      name: 'section title with a 50 000 character run of spaces',
      text: () => '== a' + ' '.repeat(n(49_995)) + 'b\n',
    },
    {
      name: 'revision line with a 50 000 character run of spaces',
      text: () => '= T\nA B\n1' + ' '.repeat(n(49_990)) + 'x\n',
    },
    { name: 'revision line of 50 000 colons', text: () => '= T\nA B\n' + ':'.repeat(n(50_000)) + '\n' },
    {
      name: 'attribute list with a 50 000 character run of tabs after a quote',
      text: () => '[a="' + '\t'.repeat(n(49_994)) + 'x]]\npara\n',
    },
    {
      name: 'attribute list with a 50 000 character run of spaces after a shorthand sigil',
      text: () => '[#a' + ' '.repeat(n(50_000)) + 'x]\npara\n',
    },
    {
      name: 'attribute list of 10 000 attributes with unclosed double quotes',
      text: () => '[a' + ',b="x'.repeat(n(10_000)) + ']\npara\n',
    },
    {
      name: 'attribute list of 10 000 attributes with unclosed single quotes',
      text: () => '[a' + ",c='x".repeat(n(10_000)) + ']\npara\n',
    },
    {
      name: 'anchor line with a 50 000 character run of spaces after the comma',
      text: () => 'para\n[[a,' + ' '.repeat(n(50_000)) + 'x\n',
    },
    {
      name: 'manpage NAME line with a 50 000 character run of spaces',
      text: () => ':doctype: manpage\n= cmd(1)\n\n== NAME\n\na' + ' '.repeat(n(50_000)) + 'b\n',
    },
    // inline markup: a line of 50 000 characters of each marker, and of markers that alternate with other text
    ...['*', '_', '`', '#', '^', '~', '+'].map((m) => ({
      name: `inline: a line of 50 000 ${m}`,
      text: () => 'w ' + m.repeat(n(50_000)) + '\n',
    })),
    ...(
      [
        ['*a', 25_000],
        ['[.r]#', 10_000],
        ['{', 50_000],
        ['[', 50_000],
        ['<<', 25_000],
        ['\\', 50_000],
      ] as const
    ).map(([unit, count]) => ({
      name: `inline: a line of ${count.toLocaleString('en-US').replace(',', ' ')} × ${unit}`,
      text: () => 'w ' + unit.repeat(n(count)) + '\n',
    })),
    {
      name: 'inline: unclosed pass:[ before 50 000 characters',
      text: () => 'w pass:[' + 'x'.repeat(n(50_000)) + '\n',
    },
    {
      name: 'inline: unclosed +++ before 50 000 characters',
      text: () => 'w +++' + 'x'.repeat(n(50_000)) + '\n',
    },
    {
      name: 'inline: 10 000 nested *_',
      text: () => 'w ' + '*_'.repeat(n(10_000)) + 'x' + '_*'.repeat(n(10_000)) + '\n',
    },
    {
      name: 'inline: a paragraph of 100 000 lines with bold across all of them',
      text: () => 'w *start\n' + 'word\n'.repeat(n(100_000)) + 'end*\n',
    },
    {
      name: 'inline: 10 000 links in one line',
      text: () =>
        'w ' +
        Array.from({ length: n(10_000) }, (_, i) => `https://example.com/${i}[t${i}]`).join(' ') +
        '\n',
    },
    // tables
    {
      name: 'table: 100 000 cells',
      text: () => '[cols="10*"]\n|===\n' + '|x '.repeat(n(100_000)) + '\n|===\n',
    },
    {
      name: 'table: a cell of 50 000 characters',
      text: () => '|===\n|' + 'x'.repeat(n(50_000)) + '\n|===\n',
    },
    { name: 'table: a line of 50 000 |', text: () => '|===\n' + '|'.repeat(n(50_000)) + '\n|===\n' },
    { name: 'table: cols="1000*"', text: () => '[cols="1000*"]\n|===\n|a |b\n|===\n' },
    { name: 'table: 100000*|x', text: () => '|===\n' + n(100_000) + '*|x\n|===\n' },
    {
      name: 'table: an unclosed CSV quote before 100 000 lines',
      text: () => '[format=csv]\n,===\n"a,b\n' + 'c,d\n'.repeat(n(100_000)) + ',===\n',
    },
  ]
}

function percentile(xs: number[], p: number): number {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)]!
}

export interface EditorBench {
  /** Size of the document the insertions are made in. */
  size: number
  edits: number
  /** Per insertion: a transaction of an `EditorState` with the AsciiDoc language, tree and diagnostics ready. */
  medianMs: number
  /** The median of the p95 of the series: one slow series on a busy machine does not decide. */
  p95Ms: number
  /** The p95 of each series of `edits` insertions. */
  seriesP95Ms: number[]
  /** Size of the document that is opened, and the time to a complete tree and diagnostics. */
  openSize: number
  openMs: number
}

/** Budgets of `npm run bench -- editor`. */
export const editorBudget = { p95Ms: 8, openMs: 1000 }

/**
 * `edits` insertions of one character at random places of a document of `size` characters, each a transaction
 * of an editor state with `asciidoc()` (the tree and the diagnostics are read after each), and the time
 * to open a document of `openSize` characters up to a complete tree.
 */
export function measureEditor(
  opts: { size?: number; edits?: number; openSize?: number; seed?: number; series?: number } = {},
): EditorBench {
  const size = opts.size ?? 200_000
  const edits = opts.edits ?? 1000
  const openSize = opts.openSize ?? 1_000_000
  const rnd = prng(opts.seed ?? 20260929)
  const ready = (state: EditorState) => {
    void syntaxTree(state).length
    void notaDocument(state).diagnostics.length
  }
  let state = EditorState.create({ doc: generateDocument(size, 7), extensions: [asciidoc()] })
  ready(state)
  const insert = (at: number) => {
    state = state.update({ changes: { from: at, insert: 'x' } }).state
    ready(state)
  }
  for (let i = 0; i < 50; i++) insert(Math.floor(rnd() * (state.doc.length + 1))) // warm up
  const times: number[] = []
  const seriesP95Ms: number[] = []
  for (let k = 0; k < (opts.series ?? 3); k++) {
    const own: number[] = []
    for (let i = 0; i < edits; i++) {
      const at = Math.floor(rnd() * (state.doc.length + 1))
      const t = performance.now()
      insert(at)
      own.push(performance.now() - t)
    }
    seriesP95Ms.push(percentile(own, 0.95))
    times.push(...own)
  }
  const big = generateDocument(openSize, 9)
  const t = performance.now()
  const opened = EditorState.create({ doc: big, extensions: [asciidoc()] })
  ready(opened)
  const openMs = performance.now() - t
  return {
    size: state.doc.length,
    edits,
    medianMs: median(times),
    p95Ms: median(seriesP95Ms),
    seriesP95Ms,
    openSize: big.length,
    openMs,
  }
}

/** The lines that report a budget that was exceeded; empty when both are met. */
export function editorFailures(r: EditorBench, budget = editorBudget): string[] {
  const out: string[] = []
  if (!(r.p95Ms < budget.p95Ms))
    out.push(`FAIL: p95 ${r.p95Ms.toFixed(3)} ms is not under ${budget.p95Ms} ms`)
  if (!(r.openMs < budget.openMs))
    out.push(`FAIL: opening took ${r.openMs.toFixed(0)} ms, not under ${budget.openMs} ms`)
  return out
}

/**
 * A synthetic page of the shape of a technical-specification page: sections with paragraphs (bold, `xref:`,
 * `+++<span>+++`), tables with `a|` cells and nested `!===` tables, lists and notes.
 */
export function generateSpecPage(size: number, seed = 5): string {
  const rnd = prng(seed)
  const pick = <T>(a: readonly T[]) => a[Math.floor(rnd() * a.length)]!
  const sentence = () => {
    const n = 6 + Math.floor(rnd() * 8)
    const w: string[] = []
    for (let i = 0; i < n; i++) {
      const x = pick(words)
      const r = rnd()
      w.push(
        r < 0.1
          ? `**${x}**`
          : r < 0.16
            ? `+++<span class="s">+++${x}+++</span>+++`
            : r < 0.22
              ? `xref:page-${Math.floor(rnd() * 40)}.adoc[${x}]`
              : r < 0.27
                ? `_${x}_`
                : x,
      )
    }
    return w.join(' ') + '.'
  }
  const out: string[] = ['= Spec Page', ':toc:', '']
  let len = 20
  let n = 0
  while (len < size) {
    const chunk: string[] = [
      `== Requirement ${n++}`,
      '',
      sentence(),
      sentence() + ` See <<Requirement ${Math.floor(rnd() * n)}>>, <<req-${n}>>.`,
      '',
      `[[req-${n}]]`,
      `NOTE: ${sentence()}`,
      '',
    ]
    chunk.push('[cols="1,2,3a",options="header"]', '|===', '|Name |Kind |Details')
    const rows = 3 + Math.floor(rnd() * 4)
    for (let r = 0; r < rows; r++) {
      chunk.push('', `|${pick(words)} ${r}`, `|${sentence()}`)
      if (rnd() < 0.5) {
        chunk.push('a|' + sentence(), '', '* ' + sentence(), '* ' + sentence())
      } else {
        chunk.push(
          'a|' + sentence(),
          '',
          '[cols="1,1"]',
          '!===',
          '!x !' + sentence(),
          '!y !**' + pick(words) + '**',
          '!===',
        )
      }
    }
    chunk.push('|===', '', `NOTE: ${sentence()}`, '')
    const s = chunk.join('\n') + '\n'
    out.push(s)
    len += s.length + 1
  }
  return out.join('\n')
}

export interface TargetsBench {
  pageSize: number
  pageMedianMs: number
  bigSize: number
  bigMs: number
  typeSize: number
  keystrokes: number
  /** The median of the p95 of the series. */
  typeP95Ms: number
  /** The p95 of each series of `keystrokes`. */
  typeSeriesP95Ms: number[]
}

/** Budgets of `npm run bench -- targets` (the engine spec). */
export const targetsBudget = { pageMs: 20, bigMs: 1000, typeP95Ms: 3 }

/** Parse of a 113 KB page, of a 3.6 MB document, and 1000 `insertText` operations in a 200 KB document. */
export function measureTargets(
  opts: {
    pageSize?: number
    bigSize?: number
    typeSize?: number
    keystrokes?: number
    samples?: number
    series?: number
  } = {},
): TargetsBench {
  const pageText = generateSpecPage(opts.pageSize ?? 113_000)
  const full = (text: string) => {
    const d = parse(text)
    void d.tree
    void d.diagnostics
    return d
  }
  for (let i = 0; i < 5; i++) full(pageText)
  const pageTimes: number[] = []
  for (let i = 0; i < (opts.samples ?? 20); i++) {
    const t = performance.now()
    full(pageText)
    pageTimes.push(performance.now() - t)
  }
  const bigText = generateDocument(opts.bigSize ?? 3_800_000, 13)
  const tb = performance.now()
  full(bigText)
  const bigMs = performance.now() - tb

  const rnd = prng(20261030)
  // a document with a reference by title that leads nowhere: each keystroke has to look for its target
  let doc = full(generateDocument(opts.typeSize ?? 200_000, 7) + '\n\nSee <<A Section Not Written Yet>>.\n')
  const type = (): number => {
    // (a place where the operation applies: a refusal in a place that is not editable is tried again elsewhere)
    for (;;) {
      // (anywhere in the text: titles and references too, so a reference by title may lose its target)
      const at = Math.floor(rnd() * (doc.text.length + 1))
      const t = performance.now()
      const r = applyOperation(doc, { kind: 'insertText', at, text: 'x' })
      if ('error' in r) continue
      void r.doc.tree
      void r.doc.diagnostics
      const ms = performance.now() - t
      doc = r.doc
      return ms
    }
  }
  // (a warm-up: the first hundreds of keystrokes run code the engine has not optimised yet, and are slower by half)
  for (let i = 0; i < 500; i++) type()
  const keystrokes = opts.keystrokes ?? 1000
  const typeSeriesP95Ms: number[] = []
  for (let k = 0; k < (opts.series ?? 3); k++) {
    const own: number[] = []
    for (let i = 0; i < keystrokes; i++) own.push(type())
    typeSeriesP95Ms.push(percentile(own, 0.95))
  }
  return {
    pageSize: pageText.length,
    pageMedianMs: median(pageTimes),
    bigSize: bigText.length,
    bigMs,
    typeSize: doc.text.length,
    keystrokes,
    typeP95Ms: median(typeSeriesP95Ms),
    typeSeriesP95Ms,
  }
}

/** The lines that report a budget that was exceeded; empty when all are met. */
export function targetsFailures(r: TargetsBench, b = targetsBudget): string[] {
  const out: string[] = []
  if (!(r.pageMedianMs <= b.pageMs))
    out.push(`FAIL: parse of the page, median ${r.pageMedianMs.toFixed(2)} ms is over ${b.pageMs} ms`)
  if (!(r.bigMs <= b.bigMs))
    out.push(`FAIL: parse of the large document ${r.bigMs.toFixed(0)} ms is over ${b.bigMs} ms`)
  if (!(r.typeP95Ms <= b.typeP95Ms))
    out.push(`FAIL: p95 of a keystroke ${r.typeP95Ms.toFixed(3)} ms is over ${b.typeP95Ms} ms`)
  return out
}
