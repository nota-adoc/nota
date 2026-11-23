// npm run bench -- incremental | large | editor | visual | targets
//   targets:     the engine speed targets: a 113 KB specification page parses to tree and diagnostics in a median
//                of 20 runs <= 20 ms; a 3.6 MB document <= 1000 ms; 3 series of 1000 insertText operations in 200 KB: median of p95 <= 3 ms.
//   incremental: ~1 MB generated document, one-character edit inside a paragraph in the middle;
//                median update of 20 runs must be at least 10x faster than the median full parse.
//   large:       big and degenerate inputs must parse and convert to HTML in under 5 s each without
//                exceptions, and the lossless invariants must hold.
//   editor:      1000 one-character insertions into a ~200 KB document, each a transaction of an editor state
//                with asciidoc() (tree and diagnostics ready): p95 (median of 3 series) under 8 ms; a ~1 MB document opened to a
//                complete tree in under 1 s.
//   visual:      1000 keystrokes in different paragraphs of a ~200 KB document in the visual editor (input event →
//                operation in the session → check and screen): p95 of a keystroke under 16 ms, of which
//                p95 of Nota under 3 ms.
import { parse } from '@nota-adoc/core'
import { renderHtml } from '@nota-adoc/html'
import { checkLossless } from '../lib/invariants.js'
import {
  editorBudget,
  editorFailures,
  largeCases,
  measureEditor,
  measureIncremental,
  measureTargets,
  targetsBudget,
  targetsFailures,
} from './bench.js'

const mode = process.argv[2]
let failed = false

if (mode === 'incremental') {
  const r = measureIncremental({ size: 1_000_000, samples: 20 })
  console.log(`document: ${(r.size / 1024).toFixed(0)} KB`)
  console.log(`full parse (median of 20): ${r.parseMs.toFixed(2)} ms`)
  console.log(`update after a one-character edit (median of 20): ${r.updateMs.toFixed(3)} ms`)
  console.log(`ratio: ${r.ratio.toFixed(1)}x (required: >= 10x)`)
  console.log(`updated tree equals full parse: ${r.identical}`)
  failed = r.ratio < 10 || !r.identical
} else if (mode === 'large') {
  for (const c of largeCases()) {
    const text = c.text()
    const t = performance.now()
    let problems: string[]
    try {
      const doc = parse(text)
      void doc.tree
      const ms = performance.now() - t
      problems = checkLossless(text, () => doc)
      const th = performance.now()
      void renderHtml(doc)
      const htmlMs = performance.now() - th
      const ok = ms < 5000 && htmlMs < 5000 && problems.length === 0
      console.log(
        `${ok ? 'ok  ' : 'FAIL'} ${c.name}: ${(text.length / 1024).toFixed(0)} KB, parse ${ms.toFixed(0)} ms, html ${htmlMs.toFixed(0)} ms, lossless: ${problems.length === 0}`,
      )
      for (const p of problems.slice(0, 5)) console.log(`     ${p}`)
      if (!ok) failed = true
    } catch (e) {
      console.log(`FAIL ${c.name}: ${e instanceof Error ? e.message : String(e)}`)
      failed = true
    }
  }
} else if (mode === 'editor') {
  const r = measureEditor()
  console.log(
    `insertions: ${r.edits} into a document of ${(r.size / 1024).toFixed(0)} KB (transaction, tree and diagnostics ready)`,
  )
  console.log(`median: ${r.medianMs.toFixed(3)} ms`)
  console.log(`p95 of the series: ${r.seriesP95Ms.map((x) => x.toFixed(3)).join(', ')} ms`)
  console.log(`p95, median of the series: ${r.p95Ms.toFixed(3)} ms (required: < ${editorBudget.p95Ms} ms)`)
  console.log(
    `opening a document of ${(r.openSize / 1024).toFixed(0)} KB up to the complete tree: ${r.openMs.toFixed(0)} ms (required: < ${editorBudget.openMs} ms)`,
  )
  const problems = editorFailures(r)
  for (const line of problems) console.log(line)
  failed = problems.length > 0
} else if (mode === 'targets') {
  const r = measureTargets()
  console.log(
    `page of ${(r.pageSize / 1024).toFixed(0)} KB, full parse to tree and diagnostics (median of 20): ${r.pageMedianMs.toFixed(2)} ms (required: <= ${targetsBudget.pageMs} ms)`,
  )
  console.log(
    `document of ${(r.bigSize / 1048576).toFixed(1)} MB, full parse: ${r.bigMs.toFixed(0)} ms (required: <= ${targetsBudget.bigMs} ms)`,
  )
  console.log(
    `${r.keystrokes} keystrokes (applyOperation insertText, tree and diagnostics) in ${(r.typeSize / 1024).toFixed(0)} KB, p95 of the series: ${r.typeSeriesP95Ms.map((x) => x.toFixed(3)).join(', ')} ms; median ${r.typeP95Ms.toFixed(3)} ms (required: <= ${targetsBudget.typeP95Ms} ms)`,
  )
  const problems = targetsFailures(r)
  for (const line of problems) console.log(line)
  failed = problems.length > 0
} else if (mode === 'visual') {
  const { measureVisual, tableDocument, visualBudget, visualFailures } = await import('./visual.js')
  const { readFileSync } = await import('node:fs')
  // paragraphs of a generated document; then the cells of the sample tables, and of a table of 200 rows x 10 columns
  const scenarios = [
    { name: 'paragraphs', opts: {} },
    {
      name: 'cells of tables.adoc',
      opts: { cells: true, text: readFileSync('quality/fixtures/editor/tables.adoc', 'utf8') },
    },
    { name: 'cells of a table 200x10', opts: { cells: true, text: tableDocument(200, 10) } },
  ]
  for (const s of scenarios) {
    const r = measureVisual(s.opts)
    console.log(`[${s.name}]`)
    console.log(
      `keystrokes: ${r.keystrokes} in a document of ${(r.size / 1024).toFixed(0)} KB (opened in ${r.openMs.toFixed(0)} ms)`,
    )
    console.log(
      `keystroke, whole (input event to screen): median ${r.medianMs.toFixed(3)} ms, p95 ${r.p95Ms.toFixed(3)} ms (required: p95 < ${visualBudget.p95Ms} ms)`,
    )
    console.log(
      `Nota's part (operation, reparse, check of the block): median ${r.notaMedianMs.toFixed(3)} ms, p95 ${r.notaP95Ms.toFixed(3)} ms (required: p95 < ${visualBudget.notaP95Ms} ms)`,
    )
    const problems = visualFailures(r)
    for (const line of problems) console.log(`${line} (${s.name})`)
    if (problems.length > 0) failed = true
  }
} else {
  console.error('usage: npm run bench -- incremental | large | editor | visual | targets')
  process.exit(2)
}
process.exit(failed ? 1 : 0)
