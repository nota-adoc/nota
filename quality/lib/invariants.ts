import { IterMode, type Tree } from '@lezer/common'
import { sectionLevel } from '@nota-adoc/core'

export interface Parsed {
  readonly text: string
  readonly tree: Tree
}

const show = (s: string) => JSON.stringify(s.length > 60 ? s.slice(0, 60) + '…' : s)

/**
 * The lossless invariants of Nota on one input. Returns a list of problems (empty when all hold):
 * parse does not throw; the text is kept; tree.length equals text.length; leaves cover the text in
 * order without gaps or overlaps; the leaf texts concatenated equal the input, UTF-16 unit by unit.
 */
export function checkLossless(text: string, parseFn: (text: string) => Parsed): string[] {
  let doc: Parsed
  try {
    doc = parseFn(text)
  } catch (e) {
    return [`parse threw: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`]
  }
  const problems: string[] = []
  if (doc.text !== text) problems.push('document text differs from the input')
  if (doc.tree.length !== text.length)
    problems.push(`tree length ${doc.tree.length} != text length ${text.length}`)
  let pos = 0
  let joined = ''
  const cursor = doc.tree.cursor(IterMode.IncludeAnonymous)
  const visitLeaf = () => {
    if (cursor.from !== pos && problems.length < 20)
      problems.push(
        `${cursor.from > pos ? 'gap' : 'overlap'} before ${cursor.name} at ${cursor.from} (expected ${pos})`,
      )
    if (cursor.to < cursor.from) problems.push(`negative leaf ${cursor.name} ${cursor.from}-${cursor.to}`)
    joined += text.slice(cursor.from, cursor.to)
    pos = cursor.to
  }
  if (text.length > 0 || doc.tree.length > 0) {
    outer: for (;;) {
      if (!cursor.firstChild()) {
        visitLeaf()
        for (;;) {
          if (cursor.nextSibling()) break
          if (!cursor.parent()) break outer
        }
      }
    }
  }
  if (text.length > 0 && pos !== text.length)
    problems.push(`leaves end at ${pos}, text length ${text.length}`)
  if (joined !== text) {
    let i = 0
    while (i < joined.length && joined[i] === text[i]) i++
    problems.push(
      `leaf text differs from the input at ${i}: ${show(joined.slice(i))} vs ${show(text.slice(i))}`,
    )
  }
  return problems
}

/** Every named node with its boundaries (and section level), depth-first. */
export function treeSignature(tree: Tree): string {
  const parts: string[] = []
  tree.iterate({
    enter(n) {
      const level =
        n.name === 'Section' || n.name === 'DiscreteHeading' ? `@${n.node.tree?.prop(sectionLevel)}` : ''
      parts.push(`${n.name}${level}:${n.from}-${n.to}`)
    },
  })
  return parts.join(' ')
}
