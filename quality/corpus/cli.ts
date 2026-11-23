// npm run corpus -- fetch
// npm run corpus -- identity [--dir DIR] [--aggregate] [--json]
// npm run corpus -- compare  [--dir DIR] [--only ruby|js] [--aggregate] [--json]
// npm run corpus -- editor [--dir DIR] [--seed N] [--aggregate] [--json]   (the editor's tree equals Nota's)
// npm run corpus -- visual [--dir DIR] [--report-dir DIR] [--aggregate] [--json]   (what the visual editor makes of the pages: blocks, plates, round trips)
// npm run corpus -- stats [--dir DIR] [--report-dir DIR] [--json]   (numbers of the forms of the constructs)
// DIR defaults to .corpus-open (the open corpus pinned in quality/corpus/sources.json).
// Reports are saved to .quality-reports/, or to --report-dir. With --aggregate, output and reports contain only
// numbers, under keys of a fixed list. A folder with a .aggregate-only file in its root works only with --aggregate
// (and with `stats`, which always prints numbers only).
import { parseArgs } from 'node:util'
import {
  corpusCompare,
  editorJson,
  fetchCorpus,
  formatEditor,
  formatIdentity,
  identityJson,
  openCorpusDir,
  reportsDir,
  runEditor,
  runIdentity,
  saveReport,
} from './corpus.js'
import { REFUSAL, underAggregateOnly } from '../lib/aggregate.js'
import { InputError } from '../reference/run.js'
import { formatStats, runStats, statsJson } from './stats.js'
import { formatVisual, runVisual, visualJson } from './visual.js'

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    dir: { type: 'string' },
    only: { type: 'string' },
    seed: { type: 'string' },
    aggregate: { type: 'boolean', default: false },
    'report-dir': { type: 'string' },
    json: { type: 'boolean', default: false },
  },
})

const cmd = positionals[0]
const dir = values.dir ?? openCorpusDir
const aggregate = values.aggregate!
const reports = values['report-dir'] ?? reportsDir
// closed pages: by the flag, or by the folder (`stats` and a failure in it work without the flag)
const closed = aggregate || underAggregateOnly(dir)

// what a run on closed pages may print: numbers; even a failure does not show where it happened
// (the trace is kept only outside of closed folders: it names the paths and quotes the text)
const failed = (e: unknown): never => {
  console.error(
    closed ? 'failed (details hidden: closed pages)' : e instanceof Error ? (e.stack ?? e.message) : e,
  )
  process.exit(1)
}
process.on('uncaughtException', failed)
process.on('unhandledRejection', failed)

if (cmd !== 'fetch' && cmd !== 'stats' && !aggregate && underAggregateOnly(dir)) {
  console.error(REFUSAL + '; run it with --aggregate')
  process.exit(2)
}

if (cmd === 'fetch') {
  fetchCorpus()
} else if (cmd === 'identity') {
  let r
  try {
    r = runIdentity(dir)
  } catch (e) {
    if (!(e instanceof InputError)) throw e
    console.error(e.message)
    process.exit(2)
  }
  const json = identityJson(r, { aggregate: closed })
  const path = saveReport(reports, 'corpus-identity', json)
  process.stdout.write(
    values.json ? json + '\n' : formatIdentity(r, { aggregate: closed }) + `report: ${path}\n`,
  )
  process.exit(r.failures.length || r.total === 0 ? 1 : 0)
} else if (cmd === 'editor') {
  const seed = values.seed === undefined ? undefined : Number(values.seed)
  if (seed !== undefined && !Number.isInteger(seed)) {
    console.error('--seed takes an integer')
    process.exit(2)
  }
  let r
  try {
    r = runEditor(dir, { seed })
  } catch (e) {
    if (!(e instanceof InputError)) throw e
    console.error(e.message)
    process.exit(2)
  }
  const json = editorJson(r, { aggregate: closed })
  const path = saveReport(reports, 'corpus-editor', json)
  process.stdout.write(
    values.json ? json + '\n' : formatEditor(r, { aggregate: closed }) + `report: ${path}\n`,
  )
  process.exit(r.failures.length ? 1 : 0)
} else if (cmd === 'visual') {
  let r
  try {
    r = runVisual(dir)
  } catch (e) {
    if (!(e instanceof InputError)) throw e
    console.error(e.message)
    process.exit(2)
  }
  const json = visualJson(r)
  const path = saveReport(reports, 'corpus-visual', json)
  process.stdout.write(values.json ? json + '\n' : formatVisual(r) + `report: ${path}\n`)
  process.exit(r.counts.exceptions || r.counts['tab.mismatch'] || r.counts['type.mismatch'] ? 1 : 0)
} else if (cmd === 'stats') {
  let r
  try {
    r = runStats(dir)
  } catch (e) {
    if (!(e instanceof InputError)) throw e
    console.error(e.message)
    process.exit(2)
  }
  const json = statsJson(r)
  const path = saveReport(reports, 'corpus-stats', json)
  process.stdout.write(values.json ? json + '\n' : formatStats(r) + `report: ${path}\n`)
  process.exit(0)
} else if (cmd === 'compare') {
  if (values.only !== undefined && values.only !== 'ruby' && values.only !== 'js') {
    console.error('--only takes ruby or js')
    process.exit(2)
  }
  const r = await corpusCompare({
    dir,
    only: values.only as 'ruby' | 'js' | undefined,
    aggregate: closed,
    json: values.json!,
    reportDir: reports,
  })
  process.stdout.write(r.output)
  process.exit(r.exitCode)
} else {
  console.error(
    'usage: npm run corpus -- fetch | stats [--dir DIR] [--report-dir DIR] [--json] | visual [--dir DIR] [--report-dir DIR] [--aggregate] [--json] | identity [--dir DIR] [--aggregate] [--json] | editor [--dir DIR] [--seed N] [--aggregate] [--json] | compare [--dir DIR] [--only ruby|js] [--aggregate] [--json]',
  )
  process.exit(2)
}
