/**
 * The source of a block that an operation writes new — a paragraph, a list, a table, a listing, a warning — in the
 * style of the document (its {@link StyleProfile}), with the text of it escaped where it stands.
 */
import { parse, type ParseOptions } from '../document.js'
import type { Diagnostic } from '../parse/blocks.js'
import { type OperationFailure, failure } from './common.js'
import { escapeInline } from './escape.js'
import type { DelimiterLengths, StyleProfile } from './profile.js'

/** The kind of a block as the operations name it (what `expect` of a fragment is compared with). */
export type BlockKindName =
  | 'section'
  | 'heading'
  | 'paragraph'
  | 'list'
  | 'dlist'
  | 'listing'
  | 'literal'
  | 'example'
  | 'sidebar'
  | 'quote'
  | 'open'
  | 'admonition'
  | 'table'
  | 'pass'
  | 'stem'
  | 'verse'
  | 'break'
  | 'image'
  | 'audio'
  | 'video'
  | 'toc'
  | 'macro'
  | 'include'
  | 'comment'

/** The kind of an admonition, as its label is written: `NOTE`, `TIP`, `IMPORTANT`, `WARNING` or `CAUTION`. */
export type AdmonitionVariant = 'NOTE' | 'TIP' | 'IMPORTANT' | 'WARNING' | 'CAUTION'

/** A block written new: what it is and the text of it; the operation writes it in the style of the document. */
export type BlockSpec =
  | { readonly kind: 'paragraph'; readonly text: string }
  /** A section title of `level` 2–6 (the number of `=`). */
  | { readonly kind: 'section'; readonly level: number; readonly title: string }
  | {
      readonly kind: 'list'
      readonly list: 'unordered' | 'ordered' | 'checklist'
      readonly items: readonly string[]
    }
  /** A table of text cells; `header`: the first row is the header. */
  | { readonly kind: 'table'; readonly rows: readonly (readonly string[])[]; readonly header?: boolean }
  | { readonly kind: 'listing'; readonly text: string; readonly language?: string }
  | { readonly kind: 'literal' | 'pass'; readonly text: string }
  | {
      readonly kind: 'admonition'
      readonly variant?: AdmonitionVariant
      readonly text: string
      /** The form: a paragraph `NOTE: text` or a block over `====`; the one the document uses when not given. */
      readonly form?: 'paragraph' | 'block'
    }
  | { readonly kind: 'example' | 'sidebar' | 'quote' | 'open'; readonly text: string }
  | { readonly kind: 'break'; readonly variant?: 'thematic' | 'page' }
  /** A block image: `image::target[]`, with the caption `.Caption` over it when given. */
  | { readonly kind: 'image'; readonly target: string; readonly caption?: string }
  /** A collapsible block: `.Title` and `[%collapsible%open]` over `====` with the text inside (`title` is 'Details' when not given). */
  | { readonly kind: 'collapsible'; readonly title?: string; readonly text: string }
  /** A block as the agent wrote it: AsciiDoc that is checked as a fragment (see `replaceBlock`). */
  | { readonly source: string; readonly expect?: BlockKindName }

const DELIM_CHAR: Record<string, string> = {
  listing: '-',
  literal: '.',
  example: '=',
  sidebar: '*',
  quote: '_',
  open: '-',
  pass: '+',
}

const isBlockSpec = (b: BlockSpec): b is Exclude<BlockSpec, { source: string }> => 'kind' in b

/** The length of a delimiter made of `ch` that no line of `lines` is: at least `min`. */
function delimiterFor(ch: string, min: number, lines: readonly string[]): string {
  const taken = new Set<number>()
  for (const l of lines) if (l.length > 0 && [...l].every((c) => c === ch)) taken.add(l.length)
  let n = min
  while (taken.has(n)) n++
  return ch.repeat(n)
}

const lineBreaks = (t: string): string[] => t.split(/\r\n|\n|\r/)

function bad(message: string): OperationFailure {
  return failure('invalid-block', message)
}

function unwritable(): OperationFailure {
  return failure('unwritable', 'The text cannot be written so that it reads as that text and nothing else')
}

/** Diagnostics of a fragment that make it unfit: its own problems, not those of what it refers to. */
export function fragmentProblems(diagnostics: readonly Diagnostic[]): Diagnostic[] {
  return diagnostics.filter(
    (d) =>
      (d.severity === 'error' || d.severity === 'warning') &&
      d.code !== 'unresolved-reference' &&
      d.code !== 'unresolved-include' &&
      d.code !== 'duplicate-id',
  )
}

/** The cell of a table as source: a bar inside the text is written `\|`. */
function cellSource(text: string): string | null {
  const one = text.replace(/\s*(?:\r\n|\n|\r)\s*/g, ' ').trim()
  if (one === '') return ''
  const esc = escapeInline(one.replace(/\|/g, '\uE000'))
  return esc === null ? null : esc.replace(/\uE000/g, '\\|')
}

/** The lines of a block written new (joined by `\n`, no line break at the end), or why it cannot be. */
export function blockSource(spec: BlockSpec, profile: StyleProfile): string | OperationFailure {
  if (!isBlockSpec(spec)) return bad('A block with a source is a fragment')
  const len = profile.delimiterLength
  switch (spec.kind) {
    case 'paragraph': {
      const src = escapeInline(spec.text)
      return src ?? (paragraphEmpty(spec.text) ? bad('A paragraph has text') : unwritable())
    }
    case 'section': {
      if (!Number.isInteger(spec.level) || spec.level < 2 || spec.level > 6)
        return failure('invalid-level', 'The level of a section is 2 to 6')
      const title = escapeInline(spec.title)
      if (title === null || title.includes('\n')) return paragraphEmpty(spec.title) ? bad('A section has a title') : unwritable()
      return `${profile.headingMarker.repeat(spec.level)} ${title}`
    }
    case 'list': {
      if (spec.items.length === 0) return bad('A list has items')
      const out: string[] = []
      for (let i = 0; i < spec.items.length; i++) {
        const text = escapeInline(spec.items[i]!)
        if (text === null) return paragraphEmpty(spec.items[i]!) ? bad('An item has text') : unwritable()
        const marker = spec.list === 'ordered' ? (profile.orderedMarker === '.' ? '.' : `${i + 1}.`) : profile.unorderedMarker
        out.push(`${marker} ${spec.list === 'checklist' ? '[ ] ' : ''}${text}`)
      }
      return out.join('\n')
    }
    case 'table': {
      const cols = spec.rows[0]?.length ?? 0
      if (cols === 0 || spec.rows.some((r) => r.length !== cols)) return bad('A table has rows of the same length')
      const rows: string[] = []
      for (const r of spec.rows) {
        const cells: string[] = []
        for (const c of r) {
          const s = cellSource(c)
          if (s === null) return unwritable()
          cells.push(s)
        }
        rows.push('|' + cells.join(' |'))
      }
      const attrs: string[] = []
      const header = spec.header === true
      if (header && profile.tableHeader === 'shorthand') attrs.push('%header')
      if (profile.cols === 'count') attrs.push(`cols="${cols}"`)
      else if (profile.cols === 'widths') attrs.push(`cols="${Array(cols).fill('1').join(',')}"`)
      if (header && profile.tableHeader === 'option') attrs.push('options="header"')
      const delim = '|' + '='.repeat(Math.max(3, len.table))
      const first = header && rows.length > 1 ? [rows[0]!, ''] : [rows[0]!]
      return [...(attrs.length ? [`[${attrs.join(',')}]`] : []), delim, ...first, ...rows.slice(1), delim].join('\n')
    }
    case 'listing':
    case 'literal':
    case 'pass': {
      const lines = spec.text === '' ? [] : lineBreaks(spec.text)
      const d = delimiterFor(DELIM_CHAR[spec.kind]!, Math.max(4, len[spec.kind as keyof DelimiterLengths]), lines)
      const head = spec.kind === 'listing' && spec.language ? [`[source,${spec.language}]`] : []
      if (spec.kind === 'listing' && spec.language !== undefined && !/^[\w+#.-]+$/.test(spec.language))
        return bad('The language of a listing is a word')
      return [...head, d, ...lines, d].join('\n')
    }
    case 'admonition': {
      const variant = spec.variant ?? 'NOTE'
      if (!['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION'].includes(variant)) return bad('Unknown kind of warning')
      const text = escapeInline(spec.text)
      if ((spec.form ?? profile.admonition) === 'paragraph') {
        if (text === null) return paragraphEmpty(spec.text) ? bad('A warning has text') : unwritable()
        return `${variant}: ${text}`
      }
      const d = delimiterFor('=', Math.max(4, len.example), [])
      if (spec.text.trim() === '') return [`[${variant}]`, d, d].join('\n')
      if (text === null) return unwritable()
      return [`[${variant}]`, d, text, d].join('\n')
    }
    case 'example':
    case 'sidebar':
    case 'quote':
    case 'open': {
      const d = spec.kind === 'open' ? '--' : delimiterFor(DELIM_CHAR[spec.kind]!, Math.max(4, len[spec.kind]), [])
      if (spec.text.trim() === '') return [d, d].join('\n')
      const text = escapeInline(spec.text)
      if (text === null) return unwritable()
      return [d, text, d].join('\n')
    }
    case 'break':
      return spec.variant === 'page' ? '<<<' : "'''"
    case 'image': {
      if (typeof spec.target !== 'string' || !/^[^[\]\r\n\s](?:[^[\]\r\n]*[^[\]\r\n\s])?$/.test(spec.target))
        return bad('The target of an image is a path')
      const title = spec.caption === undefined || spec.caption === '' ? null : captionLine(spec.caption)
      if (title === false) return bad('The caption of an image is one line of text')
      return [...(title ? [`.${title}`] : []), `image::${spec.target}[]`].join('\n')
    }
    case 'collapsible': {
      const title = captionLine(spec.title ?? 'Details')
      if (title === false || title === null) return bad('The title of a collapsible block is one line of text')
      const d = delimiterFor('=', Math.max(4, len.example), [])
      const head = [`.${title}`, '[%collapsible%open]', d]
      if (spec.text.trim() === '') return [...head, d].join('\n')
      const text = escapeInline(spec.text)
      if (text === null) return unwritable()
      return [...head, text, d].join('\n')
    }
  }
}

const paragraphEmpty = (t: string): boolean => t.trim() === ''

/** The text of a `.Title` line: one line that does not begin with a blank or a dot; null when it is empty, false when it cannot be one. */
function captionLine(text: string): string | null | false {
  const one = text.replace(/\s*(?:\r\n|\n|\r)\s*/g, ' ').trim()
  if (one === '') return null
  return /^[.\s]/.test(one) ? false : one
}

/** What a fragment is. */
export interface Fragment {
  /** The source, lines joined by `\n`, no blank lines around. */
  readonly source: string
  /** The kinds of its blocks, in order. */
  readonly kinds: readonly BlockKindName[]
}

/** Reads a fragment of AsciiDoc on its own and checks that it can be a block (or blocks) of a document. */
export function readFragment(
  source: string,
  expect: BlockKindName | undefined,
  options: ParseOptions,
  kindOf: (node: import('@lezer/common').SyntaxNode) => BlockKindName | null,
): Fragment | OperationFailure {
  const lines = source.split(/\r\n|\n|\r/)
  while (lines.length && lines[0]!.trim() === '') lines.shift()
  while (lines.length && lines[lines.length - 1]!.trim() === '') lines.pop()
  if (lines.length === 0) return failure('fragment-invalid', 'The fragment is empty')
  const src = lines.join('\n')
  const doc = parse(src + '\n', { attributes: options.attributes, blockMacros: options.blockMacros })
  const problems = fragmentProblems(doc.diagnostics)
  if (problems.length > 0)
    return {
      error: 'fragment-invalid',
      diagnostics: problems,
    }
  const top = doc.tree.topNode
  if (top.getChild('Header')?.getChild('DocumentTitle'))
    return failure('fragment-invalid', 'The title of a document is not a block')
  const kinds: BlockKindName[] = []
  let last: string | null = null
  for (let k = top.firstChild; k; k = k.nextSibling) {
    if (k.name === 'BlankLine' || k.name === 'Header') continue
    last = k.name
    const kind = kindOf(k)
    if (kind) kinds.push(kind)
    else if (k.name === 'AttributeEntry' || k.name === 'Directive' || k.name === 'DisabledLines')
      return failure('collateral', 'An attribute entry or a condition changes how the text after it reads')
  }
  if (last === 'BlockAttributes' || last === 'BlockAnchor' || last === 'BlockTitle' || last === 'ListContinuation')
    return failure('collateral', 'The fragment ends with a line that belongs to the block after it')
  if (lines[lines.length - 1]!.trim() === '+')
    return failure('collateral', 'The fragment ends with a continuation line')
  if (expect !== undefined && (kinds.length !== 1 || kinds[0] !== expect))
    return failure('unexpected-kind', `Expected ${expect}, the fragment is ${kinds.join(', ') || 'no block'}`)
  if (kinds.length === 0) return failure('fragment-invalid', 'The fragment holds no block')
  return { source: src, kinds }
}
