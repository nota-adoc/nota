// npm run compare -- [--dir DIR] [--only ruby|js] [--json] [--aggregate] [--report FILE]
// Compares Nota's structure with Ruby Asciidoctor and Asciidoctor.js on every .adoc file under DIR
// (default: quality/fixtures/stage1), and the references with each other.
import '../lib/guard.js'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { parseArgs } from 'node:util'
import { formatReport, toJson } from './compare.js'
import { RubyUnavailable } from './ruby.js'
import { InputError, runCompare } from './run.js'

const { values } = parseArgs({
  options: {
    dir: { type: 'string', default: 'quality/fixtures/stage1' },
    only: { type: 'string' },
    json: { type: 'boolean', default: false },
    aggregate: { type: 'boolean', default: false },
    report: { type: 'string' },
  },
})

if (values.only !== undefined && values.only !== 'ruby' && values.only !== 'js') {
  console.error('--only takes ruby or js')
  process.exit(2)
}

try {
  const run = await runCompare({ dir: values.dir!, only: values.only as 'ruby' | 'js' | undefined })
  const opts = { aggregate: values.aggregate! }
  const versions = Object.entries(run.versions)
    .map(([k, v]) => `${k === 'ruby' ? 'Ruby Asciidoctor' : 'Asciidoctor.js'} ${v}`)
    .join(', ')
  const out = values.json
    ? toJson(run.summary, opts) + '\n'
    : `references: ${versions}\n` + formatReport(run.summary, opts)
  process.stdout.write(out)
  if (values.report) {
    mkdirSync(dirname(values.report), { recursive: true })
    writeFileSync(values.report, toJson(run.summary, opts))
  }
  process.exit(run.summary.exitCode)
} catch (e) {
  if (e instanceof RubyUnavailable) {
    console.error(e.message)
    process.exit(3)
  }
  if (e instanceof InputError) {
    console.error(e.message)
    process.exit(2)
  }
  throw e
}
