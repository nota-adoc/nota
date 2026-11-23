// Walk the syntax tree and list the sections of a document.
// Run from the root of the repository: npx tsx examples/walk.ts
import { parse } from '@nota-adoc/core'

const doc = parse('= Guide\n\n== Install\n\nRun it.\n\n== Use\n\n=== Options\n\nSee below.\n')

// every node of the tree, with the text it covers (the leaves spell the whole input)
const cursor = doc.tree.cursor()
do {
  if (cursor.name === 'SectionTitle' || cursor.name === 'DocumentTitle') {
    console.log(cursor.name, JSON.stringify(doc.text.slice(cursor.from, cursor.to).trimEnd()))
  }
} while (cursor.next())

// the outline: sections with their ids, levels and numbers
for (const e of doc.outline()) console.log(`${'  '.repeat(e.level - 1)}${e.title} (#${e.id})`)

// Output:
// DocumentTitle "= Guide"
// SectionTitle "== Install"
// SectionTitle "== Use"
// SectionTitle "=== Options"
// Install (#_install)
// Use (#_use)
//   Options (#_options)
