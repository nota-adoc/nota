// Parse AsciiDoc without losing a byte, and read the problems the parser found.
// Run from the root of the repository: npx tsx examples/parse.ts
import { parse } from '@nota-adoc/core'

const source = '= Release notes\n\nSome *bold* text.\n\nunknown::target[]\n'
const doc = parse(source)

// the text is the truth: the document spells the input exactly
console.log('lossless:', doc.text === source)

// problems are data, not exceptions; parse never throws
for (const d of doc.diagnostics) console.log(`${d.severity} ${d.code} at ${d.from}-${d.to}`)

// an edit is a list of replacements in coordinates of this document's text
const next = doc.update([{ from: 2, to: 9, insert: 'Changelog' }])
console.log(JSON.stringify(next.text.split('\n')[0]))

// Output:
// lossless: true
// info unknown-block-macro at 36-53
// "= Changelog notes"
