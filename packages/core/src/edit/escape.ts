/**
 * Escaping by place: the source that reads, in a paragraph, as exactly the text that was given — one text and nothing
 * Asciidoctor would turn into markup. A backslash goes before what would be read as a construct, and the result is
 * read again to see that it works; where no source does, there is none.
 */
import { parse } from '../document.js'
import type { AsgNode } from '../asg/asg.js'

/** Inline constructs: what a backslash in front of them keeps from being read. */
const CONSTRUCTS = new Set([
  'Strong',
  'Emphasis',
  'Monospace',
  'Highlight',
  'Superscript',
  'Subscript',
  'DoubleQuoted',
  'SingleQuoted',
  'Passthrough',
  'Stem',
  'AttributeReference',
  'Replacement',
  'HardBreak',
  'Callout',
  'Link',
  'Xref',
  'InlineAnchor',
  'InlineImage',
  'Footnote',
  'Kbd',
  'Button',
  'Menu',
  'IndexTerm',
  'InlineAttributes',
])

/** The lines of a text as a paragraph has them: no blank around, no empty line inside. Null where that is not so. */
export function paragraphLines(text: string): string[] | null {
  const lines = text.split(/\r\n|\n|\r/).map((l) => l.trim())
  if (lines.length === 0 || lines.some((l) => l === '')) return null
  return lines
}

/**
 * The source of `text` as the lines of a paragraph (joined by `\n`), or null when it cannot be written so that it
 * reads as that text and nothing else (a line that starts like a list or a heading, a hard break at a line's end).
 */
export function escapeInline(text: string): string | null {
  const lines = paragraphLines(text)
  if (!lines) return null
  const expected = lines.join('\n')
  let src = expected
  for (let attempt = 0; attempt < 64; attempt++) {
    const doc = parse(src + '\n')
    const asg = doc.asg()
    const blocks = asg.blocks ?? []
    const only = blocks.length === 1 ? blocks[0]! : null
    if (!only || only.name !== 'paragraph' || asg.header) return null
    // every construct is found, whether the ASG shows it or not (a replacement and an attribute are text there)
    const at: number[] = []
    const escapes: number[] = []
    doc.tree.iterate({
      enter: (ref) => {
        if (CONSTRUCTS.has(ref.name)) {
          at.push(ref.from)
          return false
        }
        if (ref.name === 'Escape') escapes.push(ref.from)
        return undefined
      },
    })
    const inlines = (only['inlines'] ?? []) as AsgNode[]
    if (at.length === 0) {
      if (inlines.length === 1 && inlines[0]!.name === 'text' && inlines[0]!['value'] === expected) return src
      // a backslash of the text that is read as an escape: the text means the backslash, so it is written twice
      const e = escapes.find((p) => src[p - 1] !== '\\')
      if (e === undefined) return null
      src = src.slice(0, e) + '\\' + src.slice(e)
      continue
    }
    let next = src
    for (const p of at.reverse()) {
      let slashes = 0
      while (slashes < p && src[p - 1 - slashes] === '\\') slashes++
      if (slashes >= 2) return null
      next = next.slice(0, p) + '\\' + next.slice(p)
    }
    src = next
  }
  return null
}

/**
 * The source of the text of a table cell: what the cell reads as that text and nothing else. In a table of the format
 * `psv` (`|===`, `!===`) or `dsv` (`:===`) a separator in the text is written with a backslash in front of it; in `csv`
 * (`,===`) the text is quoted when it holds the separator, a quote, a line break or white space at its ends, and a quote
 * in it is doubled. `outer` are the separators of the tables around, whose cells hold this one: a bar of the text would
 * end a cell of those too, and is written with a backslash for them (once, however deep). Null where the text cannot be
 * written (a line break in a cell of a `dsv` table).
 */
export function escapeCell(
  text: string,
  format: 'psv' | 'csv' | 'dsv',
  separator: string,
  outer: readonly string[],
): string | null {
  let out = text
  if (format === 'csv') {
    if (out === '' || /["\r\n]/.test(out) || out.includes(separator) || /^\s|\s$/.test(out))
      out = out === '' ? '' : '"' + out.replace(/"/g, '""') + '"'
  } else {
    if (format === 'dsv' && /[\r\n]/.test(out)) return null
    out = out.split(separator).join('\\' + separator)
  }
  for (const o of outer) if (o !== separator || format === 'csv') out = out.split(o).join('\\' + o)
  return out
}
