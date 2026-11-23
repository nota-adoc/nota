// npm run tck — fetches the Eclipse AsciiDoc TCK (pinned commit) into .tck/, runs it with the adapter of Nota and
// prints `tck: passed N, failed M, known K`. Exit code 0 when every failure is in quality/reference/known-differences.json
// (kind "tck"), 1 with the names of the tests that fail otherwise, 3 without network (and no earlier fetch).
import '../lib/guard.js'
import { fetchTck, runTck } from './tck.js'

try {
  fetchTck()
} catch (e) {
  console.error(`tck: the TCK cannot be fetched (no network?): ${(e as Error).message}`)
  process.exit(3)
}
const r = await runTck()
console.log(`tck: passed ${r.passed}, failed ${r.failed.length}, known ${r.known.length}`)
for (const k of r.known) console.log(`  known: ${k.test} (${k.id})`)
for (const f of r.failed) console.error(`  FAILED: ${f}`)
process.exit(r.failed.length > 0 ? 1 : 0)
