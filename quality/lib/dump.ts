import { IterMode } from '@lezer/common'
import { type NotaDocument, blockKind, sectionLevel } from '@nota-adoc/core'

/**
 * Debug view of the syntax tree: one node per line — name, from–to and, for leaves, the text.
 * This is a structure dump for people, not a way to print AsciiDoc (the text itself is the source).
 */
export function formatTree(doc: NotaDocument): string {
  const lines: string[] = []
  let depth = 0
  const cursor = doc.tree.cursor(IterMode.IncludeAnonymous)
  for (;;) {
    const isLeaf = !cursor.node.firstChild
    const level =
      cursor.name === 'Section' || cursor.name === 'DiscreteHeading'
        ? `[level=${cursor.node.tree?.prop(sectionLevel)}]`
        : cursor.name === 'DelimitedBlock'
          ? `[kind=${cursor.node.tree?.prop(blockKind)}]`
          : ''
    const name = cursor.name || '(anonymous)'
    const leafText =
      isLeaf && cursor.type.id !== doc.tree.type.id
        ? ' ' + JSON.stringify(doc.text.slice(cursor.from, cursor.to))
        : ''
    lines.push(`${'  '.repeat(depth)}${name}${level} ${cursor.from}-${cursor.to}${leafText}`)
    if (cursor.firstChild()) {
      depth++
      continue
    }
    let done = false
    for (;;) {
      if (cursor.nextSibling()) break
      if (!cursor.parent()) {
        done = true
        break
      }
      depth--
    }
    if (done) break
  }
  if (doc.diagnostics.length) {
    lines.push('diagnostics:')
    for (const d of doc.diagnostics) lines.push(`  ${d.severity} ${d.code} ${d.from}-${d.to} ${d.message}`)
  }
  return lines.join('\n') + '\n'
}
