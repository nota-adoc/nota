/**
 * The checks of the editor bridge on one text (npm run corpus -- editor): the syntax tree of an editor state
 * equals the tree of Nota, right after opening and after random edits, and every highlighted range is the
 * range of a node of that tree whose type the highlighting table lists.
 */
import { syntaxTree } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import type { Tree } from '@lezer/common'
import { asciidoc, highlightGroup, highlightRanges, highlightedNodes, notaDocument } from '@nota-adoc/codemirror'
import { parse, sectionLevel } from '@nota-adoc/core'
import { prng } from '../bench/bench.js'

interface Entry {
  key: string
  from: number
  to: number
}

/** Every named node with its boundaries (and section level), depth-first. */
function signature(tree: Tree): Entry[] {
  const out: Entry[] = []
  tree.iterate({
    enter(n) {
      const level =
        n.name === 'Section' || n.name === 'DiscreteHeading' ? `@${n.node.tree?.prop(sectionLevel)}` : ''
      out.push({ key: `${n.name}${level}:${n.from}-${n.to}`, from: n.from, to: n.to })
    },
  })
  return out
}

/** The first difference between two trees, with its position in the text; null when they are equal. */
export function firstTreeDifference(a: Tree, b: Tree): { from: number; message: string } | null {
  const x = signature(a)
  const y = signature(b)
  const n = Math.min(x.length, y.length)
  for (let i = 0; i < n; i++)
    if (x[i]!.key !== y[i]!.key) {
      // where the two nodes stop agreeing: the start if the starts differ, else the nearer end
      const from = x[i]!.from !== y[i]!.from ? Math.min(x[i]!.from, y[i]!.from) : Math.min(x[i]!.to, y[i]!.to)
      return { from, message: `editor tree has ${x[i]!.key}, nota has ${y[i]!.key}` }
    }
  if (x.length !== y.length) {
    const extra = x.length > y.length ? x[n]! : y[n]!
    return {
      from: extra.from,
      message: `${x.length > y.length ? 'editor tree' : 'nota tree'} has more nodes: ${extra.key}`,
    }
  }
  return null
}

const snippets = [
  '\n',
  '\r\n',
  'x',
  ' ',
  '* ',
  '. ',
  '== ',
  '= ',
  '----\n',
  '====\n',
  '////\n',
  '// ',
  ':a: b\n',
  '[[id]]\n',
  '.Title\n',
  '[source,ruby]\n',
  'ifdef::a[]\n',
  'endif::[]\n',
  'include::x.adoc[]\n',
  '+\n',
  'NOTE: ',
  'йц',
]

/** Compares the state of the editor with a full parse of its text: tree, text, diagnostics, highlighting. Problems with positions. */
export function compareState(state: EditorState, label: string): string[] {
  const problems: string[] = []
  const text = state.doc.toString()
  const full = parse(text)
  const tree = syntaxTree(state)
  const diff = firstTreeDifference(tree, full.tree)
  if (diff) problems.push(`${label}: at ${diff.from}: ${diff.message}`)
  const doc = notaDocument(state)
  if (doc.text !== text) problems.push(`${label}: notaDocument(state).text differs from the text of the editor`)
  if (JSON.stringify(doc.diagnostics) !== JSON.stringify(full.diagnostics))
    problems.push(`${label}: diagnostics differ from those of a full parse`)
  // highlighting: each range is a node of the tree of Nota with a type of the table, with the group the table gives it
  const nodes = new Map<string, string | null>()
  let expected = 0
  full.tree.iterate({
    enter(n) {
      if (!highlightedNodes.has(n.name)) return
      const group = highlightGroup(n.node, state.doc)
      nodes.set(`${n.name}:${n.from}-${n.to}`, group)
      if (group) expected++
    },
  })
  const ranges = highlightRanges(state)
  for (const r of ranges) {
    const group = nodes.get(`${r.node}:${r.from}-${r.to}`)
    if (group === undefined) {
      problems.push(`${label}: at ${r.from}: highlighted ${r.from}-${r.to} is no ${r.node} of the tree`)
      break
    }
    if (group !== r.group) {
      problems.push(`${label}: at ${r.from}: ${r.node} highlighted as ${r.group}, the table says ${group}`)
      break
    }
  }
  if (ranges.length !== expected)
    problems.push(`${label}: ${ranges.length} highlighted ranges, ${expected} nodes of the table in the tree`)
  return problems
}

export interface EditorCheck {
  edits: number
  problems: string[]
}

/** Opens `text` in an editor state and checks it, then applies `edits` random edits and checks after each. */
export function checkEditorText(text: string, seed: number, edits = 20): EditorCheck {
  const rnd = prng(seed)
  let state = EditorState.create({ doc: text, extensions: [asciidoc()] })
  const problems = compareState(state, 'open')
  let done = 0
  for (let i = 0; i < edits && problems.length === 0; i++) {
    const len = state.doc.length
    const changes: { from: number; to: number; insert: string }[] = []
    const count = 1 + (rnd() < 0.2 ? Math.floor(rnd() * 3) : 0)
    for (let k = 0; k < count; k++) {
      const from = Math.floor(rnd() * (len + 1))
      const to = Math.min(len, from + (rnd() < 0.5 ? 0 : Math.floor(rnd() * 12)))
      if (changes.some((c) => from < c.to + 1 && to > c.from - 1)) continue
      changes.push({ from, to, insert: snippets[Math.floor(rnd() * snippets.length)]! })
    }
    state = state.update({ changes }).state
    done++
    problems.push(...compareState(state, `edit ${i + 1}`))
  }
  return { edits: done, problems }
}
