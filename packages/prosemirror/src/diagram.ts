/**
 * A diagram is an island whose first positional attribute is `mermaid`, over `....` or `----`. The core reads it as an island (a
 * block it does not know); here it is shown as a picture with its code, and the positions of its text are the characters of the
 * code between the delimiters. The editor writes the whole block back through `setIslandText`.
 */
import type { NotaDocument } from '@nota-adoc/core'
import type { Item } from '@nota-adoc/core/internal'

/** What the block of such an item is called (the `label` of it): the key of an item tells it from an island. */
export const DIAGRAM = 'Diagram'

const HEAD = /^\[mermaid(?:[,#.%][^\]]*)?\]$/
const DELIMITER = /^(?:\.{4,}|-{4,})$/

/** What a diagram is made of: the line of attributes, the delimiter, and where the code is in the source. */
export interface DiagramParts {
  /** The line `[mermaid,name,svg]` as written. */
  readonly head: string
  /** The name after `mermaid,` ('' when there is none). */
  readonly name: string
  /** The delimiter as written (`....`). */
  readonly delimiter: string
  /** The range of the code in the text of the document (the line breaks inside it included). */
  readonly from: number
  readonly to: number
}

/** The name of a diagram: the second positional attribute of `[mermaid,name,svg]`. */
export function diagramName(head: string): string {
  const inner = head.slice(1, -1)
  const parts = inner.split(',')
  const name = parts[1]?.trim() ?? ''
  return /^[\w.-]+=/.test(name) ? '' : name
}

/** The parts of a diagram whose source is `text[from, to)`, or null when the source is not one. */
export function diagramParts(text: string, from: number, to: number): DiagramParts | null {
  const src = text.slice(from, to)
  const lines: { start: number; end: number; eol: number }[] = []
  for (let i = 0; i <= src.length; ) {
    let end = i
    while (end < src.length && src[end] !== '\n' && src[end] !== '\r') end++
    const eol = src.startsWith('\r\n', end) ? 2 : end < src.length ? 1 : 0
    lines.push({ start: i, end, eol })
    if (end >= src.length) break
    i = end + eol
    // (a source that ends with its line break has no line after it)
    if (i >= src.length) break
  }
  if (lines.length < 3) return null
  const at = (k: number): string => src.slice(lines[k]!.start, lines[k]!.end)
  const head = at(0)
  const delimiter = at(1)
  if (!HEAD.test(head) || !DELIMITER.test(delimiter)) return null
  const last = lines.length - 1
  if (at(last) !== delimiter) return null
  const bodyFrom = lines[1]!.end + lines[1]!.eol
  // (with no line of code the closing delimiter follows the opening one)
  const bodyTo = last === 2 ? bodyFrom : lines[last - 1]!.end
  return { head, name: diagramName(head), delimiter, from: from + bodyFrom, to: from + bodyTo }
}

/** The items of a document with every island that is a diagram marked as one, and its range the code. */
export function diagramItems(doc: NotaDocument, items: Item[]): Item[] {
  return items.map((it) => {
    if (it.kind !== 'chip' || !it.block || it.block.label !== 'DelimitedBlock') return it
    const p = diagramParts(doc.text, it.from, it.to)
    if (!p) return it
    return { ...it, block: { ...it.block, label: DIAGRAM, content: { from: p.from, to: p.to } } }
  })
}

/** The whole source of the diagram `it` when its code is `code` (without the line break that ends it), in the line breaks of `text`. */
export function diagramSource(text: string, it: Item, code: string): { source: string; prefix: number } | null {
  const p = diagramParts(text, it.from, it.to)
  if (!p) return null
  const eol = text.slice(it.from, it.to).includes('\r\n') ? '\r\n' : '\n'
  const body = code.replace(/\r\n|\r/g, '\n')
  const lines = body.split('\n')
  const char = p.delimiter[0]!
  let n = p.delimiter.length
  while (lines.some((l) => l === char.repeat(n))) n++
  const delimiter = char.repeat(n)
  const head = p.head + eol + delimiter + eol
  return {
    source: head + (body === '' ? '' : body.split('\n').join(eol) + eol) + delimiter,
    prefix: head.length,
  }
}

/** The code of the sample in English: the default of `labels.diagramSample`. */
export const DIAGRAM_SAMPLE_CODE = 'flowchart LR\nA[Start] --> B[Step]\nB --> C(Done)'

/** The block a menu puts in: a small flowchart, the code ready to be changed (`code` is the text of the language of the page). */
export const diagramSample = (code: string = DIAGRAM_SAMPLE_CODE): string => `[mermaid]\n....\n${code}\n....`
