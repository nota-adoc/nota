/**
 * The inline constructs of the text of a cell with no `a` style. The tree of a document has none of them (the text of such a
 * cell is a leaf), so the substitutions of a paragraph are run over the source of the cell, on request, and the result is put
 * into a tree of its own: the lines of the text with the constructs in them, as in a paragraph.
 */
import type { SyntaxNode } from '@lezer/common'
import type { NotaDocument } from '../document.js'
import { Type } from '../nodes.js'
import { leaf, rawNode, toPiece } from '../parse/build.js'
import { NORMAL_SUBS, nestNodes, scanInline, spliceInline } from '../parse/inline/index.js'
import type { TextLineRef } from '../parse/inline/index.js'

/** The lines of a text range as pieces (the line without its trailing blanks), and where the next line starts. */
function linesOf(text: string, from: number, to: number): { piece: [number, number]; next: number }[] {
  const out: { piece: [number, number]; next: number }[] = []
  let at = from
  for (;;) {
    let nl = text.indexOf('\n', at)
    if (nl < 0 || nl > to) nl = to
    let end = nl
    if (end > at && text.charCodeAt(end - 1) === 13) end--
    let e = end
    while (e > at && (text.charCodeAt(e - 1) === 32 || text.charCodeAt(e - 1) === 9)) e--
    out.push({ piece: [at, e], next: nl >= to ? to : nl + 1 })
    if (nl >= to) break
    at = nl + 1
  }
  return out
}

/** The top node of a tree that has the lines of `from`–`to` with their constructs; positions are offsets of the text. */
export function cellTree(doc: NotaDocument, from: number, to: number): SyntaxNode {
  const text = doc.text
  const lines = linesOf(text, from, to)
  const refs: TextLineRef[] = lines.map((l) => ({ n: leaf(Type.TextLine, l.piece[0], l.next), piece: l.piece }))
  const attrs = doc.attributesAt(from)
  const sink = scanInline(text, lines.map((l) => l.piece), NORMAL_SUBS, { get: (name: string) => attrs.get(name) })
  const kids = spliceInline(
    refs.map((r) => r.n),
    refs,
    nestNodes(sink.nodes),
  )
  return toPiece(rawNode(Type.Paragraph, 0, to, kids), 0).tree.topNode
}
