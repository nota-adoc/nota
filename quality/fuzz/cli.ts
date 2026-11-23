// npm run fuzz -- [--runs N] [--seed S] [--property NAME]   (properties: see quality/fuzz/properties.ts; `editor/actions`
// is the visual editor under random actions: npm run fuzz -- --property editor/actions --runs 2000)
// Default 10 000 runs per property; with --seed alone 100 000, so that a failure found late is reproduced.
// Identity of text -> tree -> text on random junk and AsciiDoc-like text, and incremental reparsing
// equal to a full parse. Prints the seed; on failure a shrunk counterexample and how to reproduce it.
import { parseArgs } from 'node:util'
import { resolveRuns } from './args.js'
import { propertyNames, runProperty } from './properties.js'

/** Runs of `editor/actions` when all the properties run together. */
const EDITOR_RUNS_IN_BULK = 2000

const { values } = parseArgs({
  options: {
    runs: { type: 'string' },
    seed: { type: 'string' },
    property: { type: 'string', multiple: true },
  },
})

const runs = resolveRuns(values.runs, values.seed)
const seed = values.seed !== undefined ? Number(values.seed) : Math.floor(Math.random() * 2_147_483_647)
if (!Number.isInteger(runs) || runs <= 0 || !Number.isInteger(seed)) {
  console.error('usage: npm run fuzz -- [--runs N] [--seed S] [--property NAME]')
  process.exit(2)
}
const names = values.property?.length ? values.property : propertyNames

console.log(`fuzz: ${runs} runs per property, seed ${seed}`)
let failures = 0
for (const name of names) {
  const started = performance.now()
  // a run of the visual editor is a whole session of a person: in the bulk run, at most this many (a run of that
  // property alone, with --property editor/actions, is as long as it is asked to be)
  const cap = name === 'editor/actions' && !values.property?.length ? EDITOR_RUNS_IN_BULK : Infinity
  const r = runProperty(name, { runs: Math.min(runs, cap), seed })
  const secs = ((performance.now() - started) / 1000).toFixed(1)
  console.log(`${r.report} [${secs}s]`)
  if (r.failure) failures++
}
console.log(failures ? `fuzz: ${failures} propert${failures === 1 ? 'y' : 'ies'} failed` : 'fuzz: 0 failures')
process.exit(failures ? 1 : 0)
