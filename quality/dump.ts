// npm run dump -- <file.adoc> — prints the Nota syntax tree of a file (debug view, not AsciiDoc output)
import './lib/guard.js'
import { readFileSync } from 'node:fs'
import { parse } from '@nota-adoc/core'
import { formatTree } from './lib/dump.js'

const file = process.argv[2]
if (!file) {
  console.error('usage: npm run dump -- <file.adoc>')
  process.exit(2)
}
process.stdout.write(formatTree(parse(readFileSync(file, 'utf8'))))
