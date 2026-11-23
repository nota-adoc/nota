// A development aid: "before/after" check that the behaviour of the engine did not change byte for byte.
// For every .adoc file in quality/fixtures and .corpus-open it takes parse(text) and hashes the JSON of the
// diagnostics, doc.asg(), outline(), footnotes(), references(), styleProfile() and renderHtml(doc).
//   tsx quality/dev/snapshot.ts save <out.json>     writes the hashes (outside the repository)
//   tsx quality/dev/snapshot.ts check <out.json>    compares with a saved snapshot
// Prints only the number of files and the number of differences (names of files of the open corpus and fixtures).
import '../lib/guard.js'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { parse } from '../../packages/core/src/index.js'
import { renderHtml } from '../../packages/html/src/index.js'

const root = resolve(import.meta.dirname, '../..')
const KEYS = ['diagnostics', 'asg', 'outline', 'footnotes', 'references', 'styleProfile', 'html'] as const

function walk(dir: string, out: string[]): void {
  if (!existsSync(dir)) return
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name)
    let st
    try {
      st = statSync(p)
    } catch {
      continue // a broken symlink
    }
    if (st.isDirectory()) walk(p, out)
    else if (/\.(adoc|asciidoc|asc|ad)$/.test(name)) out.push(p)
  }
}

const h = (s: string): string => createHash('sha256').update(s).digest('hex').slice(0, 16)

function snapshot(): Record<string, Record<string, string>> {
  const files: string[] = []
  walk(join(root, 'quality/fixtures'), files)
  walk(join(root, '.corpus-open'), files)
  const result: Record<string, Record<string, string>> = {}
  for (const f of files) {
    const text = readFileSync(f, 'utf8')
    const entry: Record<string, string> = {}
    try {
      const doc = parse(text)
      entry.diagnostics = h(JSON.stringify(doc.diagnostics))
      entry.asg = h(JSON.stringify(doc.asg()))
      entry.outline = h(JSON.stringify(doc.outline()))
      entry.footnotes = h(JSON.stringify(doc.footnotes()))
      entry.references = h(JSON.stringify(doc.references()))
      entry.styleProfile = h(JSON.stringify(doc.styleProfile()))
      entry.html = h(renderHtml(doc))
    } catch (e) {
      entry.error = h(String(e))
    }
    result[relative(root, f)] = entry
  }
  return result
}

const [mode, out] = process.argv.slice(2)
if ((mode !== 'save' && mode !== 'check') || !out) {
  console.error('usage: tsx quality/dev/snapshot.ts save|check <snapshot.json>')
  process.exit(2)
}
const now = snapshot()
const n = Object.keys(now).length
if (mode === 'save') {
  writeFileSync(out, JSON.stringify(now))
  console.log(`files: ${n}, saved`)
} else {
  const before = JSON.parse(readFileSync(out, 'utf8')) as typeof now
  let diffs = 0
  for (const f of new Set([...Object.keys(before), ...Object.keys(now)])) {
    for (const k of [...KEYS, 'error']) {
      if (before[f]?.[k] !== now[f]?.[k]) {
        diffs++
        console.log(`differs: ${f} ${k}`)
      }
    }
  }
  console.log(`files: ${n}, differences: ${diffs}`)
  process.exit(diffs ? 1 : 0)
}
