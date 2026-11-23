import type { SyntaxNode } from '@lezer/common'

/** The nodes that can come before the content of a block, or before the block itself. */
const BEFORE_BLOCK = new Set([
  'Directive',
  'IncludeDirective',
  'DisabledLines',
  'BlockAttributes',
  'BlockAnchor',
  'BlockTitle',
  'BlankLine',
  'LineComment',
  'BlockComment',
  'ByteOrderMark',
  'Mark',
  'Newline',
])

/**
 * The attribute entries of the header of a document without a title: those before its first block, the ones
 * among the lines that come before the content of that block too (they count for the header, as Asciidoctor
 * reads them along with the header).
 */
export function headerEntries(top: SyntaxNode): SyntaxNode[] {
  const out: SyntaxNode[] = []
  if (top.getChild('Header')?.getChild('DocumentTitle')) return out
  const leading = (n: SyntaxNode): void => {
    for (let c = n.firstChild; c; c = c.nextSibling) {
      if (c.name === 'AttributeEntry') out.push(c)
      else if (!BEFORE_BLOCK.has(c.name)) return
    }
  }
  for (let c = top.firstChild; c; c = c.nextSibling) {
    if (c.name === 'AttributeEntry') out.push(c)
    else if (c.name === 'Header') leading(c)
    else if (!BEFORE_BLOCK.has(c.name)) {
      leading(c)
      break
    }
  }
  return out
}
