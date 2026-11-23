/**
 * The style profile of a document: how the people who wrote it write lists, tables, delimited blocks and blank
 * lines. What an operation writes new (a list, a table, a listing) is written in that style, so that an edit does
 * not bring a second way of writing into the text.
 */
import type { SyntaxNode } from '@lezer/common'
import type { NotaDocument } from '../document.js'
import { blockKind } from '../nodes.js'

/** The delimiter lengths by the kind of the block (the number of `=` of a table delimiter `|===` is `table`). */
export interface DelimiterLengths {
  listing: number
  literal: number
  example: number
  sidebar: number
  quote: number
  open: number
  pass: number
  comment: number
  table: number
}

/** How a document is written. Every field has a value: what a document does not show is taken from {@link DEFAULT_STYLE_PROFILE}. */
export interface StyleProfile {
  /** The marker of the items of an unordered list (and of a checklist): `*` or `-`. */
  unorderedMarker: '*' | '-'
  /** The marker of the items of an ordered list: `.` or numbered `1.`. */
  orderedMarker: '.' | '1.'
  /** A table with a header row: `[%header]` (`shorthand`) or `options="header"` (`option`). */
  tableHeader: 'shorthand' | 'option'
  /** The `cols` of a new table: the number of columns (`cols="2"`), the widths (`cols="1,1"`) or none. */
  cols: 'count' | 'widths' | 'none'
  delimiterLength: DelimiterLengths
  /** A warning is `[NOTE]` over a delimited block (`block`) or a paragraph that starts with `NOTE:` (`paragraph`). */
  admonition: 'block' | 'paragraph'
  /** The blank lines between two blocks. */
  blankLines: number
  /** The marker of the title of a section: `=` or `#`. */
  headingMarker: '=' | '#'
}

/** The style new blocks are written in when a document does not show one (and the value of each field a document leaves open). */
export const DEFAULT_STYLE_PROFILE: StyleProfile = Object.freeze({
  unorderedMarker: '*',
  orderedMarker: '.',
  tableHeader: 'option',
  cols: 'count',
  delimiterLength: Object.freeze({
    listing: 4,
    literal: 4,
    example: 4,
    sidebar: 4,
    quote: 4,
    open: 2,
    pass: 4,
    comment: 4,
    table: 3,
  }),
  admonition: 'block',
  blankLines: 1,
  headingMarker: '=',
})

/** Counts values and gives the one seen most often; the first seen wins a tie. */
class Mode<T extends string | number> {
  private readonly counts = new Map<T, number>()
  add(v: T): void {
    this.counts.set(v, (this.counts.get(v) ?? 0) + 1)
  }
  get(): T | null {
    let best: T | null = null
    let n = 0
    for (const [v, c] of this.counts)
      if (c > n) {
        best = v
        n = c
      }
    return best
  }
}

const FLOW = new Set(['Document', 'Section', 'CellContent', 'ListItem'])
const NOT_GAP = new Set(['BlankLine'])

const DELIM_CHAR: Partial<Record<keyof DelimiterLengths, string>> = {
  listing: '-',
  literal: '.',
  example: '=',
  sidebar: '*',
  quote: '_',
  pass: '+',
  comment: '/',
}

function delimiterKey(kind: string): keyof DelimiterLengths | null {
  switch (kind) {
    case 'listing':
    case 'literal':
    case 'example':
    case 'sidebar':
    case 'quote':
    case 'open':
    case 'pass':
    case 'comment':
      return kind
    case 'admonition':
      return 'example'
    default:
      return null
  }
}

/** The profile of the style a document is written in. */
export function styleProfileOf(doc: NotaDocument): StyleProfile {
  const text = doc.text
  const unordered = new Mode<'*' | '-'>()
  const ordered = new Mode<'.' | '1.'>()
  const header = new Mode<'shorthand' | 'option'>()
  const cols = new Mode<'count' | 'widths' | 'none'>()
  const admonition = new Mode<'block' | 'paragraph'>()
  const blank = new Mode<number>()
  const heading = new Mode<'=' | '#'>()
  const lengths: Partial<Record<keyof DelimiterLengths, Mode<number>>> = {}
  const length = (k: keyof DelimiterLengths, n: number): void => {
    ;(lengths[k] ??= new Mode<number>()).add(n)
  }

  const gaps = (node: SyntaxNode): void => {
    let run = 0
    let seen = false
    for (let k = node.firstChild; k; k = k.nextSibling) {
      if (NOT_GAP.has(k.name)) {
        if (seen) run++
        continue
      }
      if (run > 0 && seen && isBlockLike(k.name)) blank.add(run)
      run = 0
      if (isBlockLike(k.name)) seen = true
    }
  }

  doc.tree.iterate({
    enter: (ref) => {
      const name = ref.name
      if (FLOW.has(name) || name === 'DelimitedBlock') gaps(ref.node)
      switch (name) {
        case 'UnorderedList':
        case 'OrderedList': {
          const first = ref.node.getChild('ListItem')?.getChild('ListMarker')
          if (!first) break
          const m = text.slice(first.from, first.to)
          if (name === 'UnorderedList') unordered.add(m === '-' ? '-' : '*')
          else if (/^\d+\.$/.test(m)) ordered.add('1.')
          else if (/^\.+$/.test(m)) ordered.add('.')
          break
        }
        case 'SectionMarker': {
          const ch = text[ref.from]
          if (ch === '=' || ch === '#') heading.add(ch)
          break
        }
        case 'AdmonitionParagraph':
          admonition.add('paragraph')
          break
        case 'DelimitedBlock': {
          const kind = ref.node.tree?.prop(blockKind) ?? ''
          const delim = ref.node.getChild('BlockDelimiter')
          if (kind === 'admonition') admonition.add('block')
          if (kind === 'table') {
            if (delim) {
              const d = text.slice(delim.from, delim.to).trim()
              if (/^[|!,:]=+$/.test(d)) length('table', d.length - 1)
            }
            tableStyle(ref.node)
          } else {
            const key = delimiterKey(kind)
            if (key && delim) {
              const d = text.slice(delim.from, delim.to).trim()
              // (a fence of backticks, a block of one style with the delimiter of another: not a length of this kind)
              if (d.length >= 4 && key !== 'open' && d[0] === DELIM_CHAR[key] && /^(.)\1+$/.test(d)) length(key, d.length)
            }
          }
          break
        }
      }
    },
  })

  function tableStyle(node: SyntaxNode): void {
    const attrs = node.getChild('BlockAttributes')
    if (!attrs) {
      cols.add('none')
      return
    }
    const src = text.slice(attrs.from, attrs.to)
    if (/%header\b/.test(src)) header.add('shorthand')
    else if (/\b(?:options|opts)\s*=\s*"?[^\]"]*\bheader\b/.test(src)) header.add('option')
    const m = /\bcols\s*=\s*(?:"([^"]*)"|'([^']*)'|([^,\]]*))/.exec(src)
    if (!m) cols.add('none')
    else {
      const v = (m[1] ?? m[2] ?? m[3] ?? '').trim()
      cols.add(/^\d+$/.test(v) ? 'count' : 'widths')
    }
  }

  const d = DEFAULT_STYLE_PROFILE
  const delimiterLength = { ...d.delimiterLength }
  for (const k of Object.keys(delimiterLength) as (keyof DelimiterLengths)[])
    delimiterLength[k] = lengths[k]?.get() ?? d.delimiterLength[k]
  return {
    unorderedMarker: unordered.get() ?? d.unorderedMarker,
    orderedMarker: ordered.get() ?? d.orderedMarker,
    tableHeader: header.get() ?? d.tableHeader,
    cols: cols.get() ?? d.cols,
    delimiterLength,
    admonition: admonition.get() ?? d.admonition,
    blankLines: blank.get() ?? d.blankLines,
    headingMarker: heading.get() ?? d.headingMarker,
  }
}

const BLOCK_LIKE = new Set([
  'Section',
  'DiscreteHeading',
  'Paragraph',
  'LiteralParagraph',
  'AdmonitionParagraph',
  'StyledParagraph',
  'DelimitedBlock',
  'BlockQuote',
  'BlockMacro',
  'ThematicBreak',
  'PageBreak',
  'UnorderedList',
  'OrderedList',
  'DescriptionList',
  'CalloutList',
  'IncludeDirective',
  'LineComment',
  'BlockComment',
])

function isBlockLike(name: string): boolean {
  return BLOCK_LIKE.has(name)
}
