/** Links: a target over a range of text, another target for a link, no link. */
import type { NotaDocument } from '../document.js'
import { MSG, type OperationResult, failure, spansAt } from './common.js'
import { inlineBlockAround } from './cell.js'
import { type BlockRange, blocksInRange, rewriteBlocks } from './marks.js'
import { readBlock, xrefHref } from './read.js'
import { rewriteBlock } from './text.js'
import type { LinkForm, Span } from './types.js'

export interface LinkSource {
  readonly form: LinkForm
  readonly open: string
  readonly close: string
  readonly href: string
}

const SCHEME = /^([a-z][a-z0-9+.-]*):/i
const ABSOLUTE = /^(?:https?|ftps?|ircs?|file):\/\//i

/**
 * A target the editor writes: no scheme (a relative path or `#anchor`), or `http`, `https`, `mailto`. Everything else
 * (`javascript:`, `data:`, `vbscript:`, `file:`, `ftp:`, an unknown scheme) is refused. Browsers skip spaces and control
 * characters in a scheme (`java\tscript:`), so they are removed before the check.
 */
function isAllowedTarget(target: string): boolean {
  // eslint-disable-next-line no-control-regex
  const bare = target.replace(/[\u0000-\u0020\u007f-\u009f\u200b-\u200d\u2028\u2029\ufeff]/g, '')
  const scheme = SCHEME.exec(bare)
  return !scheme || /^(?:https?|mailto)$/i.test(scheme[1]!)
}

/** How a link with this target is written; a message when it cannot be. */
export function linkSource(target: string): LinkSource | string {
  const t = target.trim()
  if (t === '') return 'Empty link target'
  if (!isAllowedTarget(t)) return 'This link target is not allowed'
  const enc = t.replace(/ /g, '%20')
  if (/[\s[\]<>"]/.test(enc)) return 'A link target has no brackets, quotes or line breaks'
  if (enc.startsWith('#')) {
    const id = enc.slice(1)
    if (id === '') return 'Empty link target'
    if (/[,>]/.test(id)) return 'An anchor id has no commas'
    // `<<id>>` reads as a local link only when the id looks like one
    if (xrefHref(id) === enc) return { form: 'anchor', open: `<<${id},`, close: '>>', href: enc }
    return { form: 'xref', open: `xref:${enc}[`, close: ']', href: enc }
  }
  if (ABSOLUTE.test(enc)) return { form: 'url', open: `${enc}[`, close: ']', href: enc }
  const m = SCHEME.exec(enc)
  if (m && m[1]!.toLowerCase() === 'mailto') return { form: 'mailto', open: `${enc}[`, close: ']', href: enc }
  if (!m && /\.(?:adoc|asciidoc)$/i.test(enc.split('#')[0]!))
    return { form: 'xref', open: `xref:${enc}[`, close: ']', href: enc }
  if (!m && enc.includes('#') && /[.#/]/.test(enc.split('#')[0]!))
    return { form: 'xref', open: `xref:${enc}[`, close: ']', href: enc }
  return { form: 'link', open: `link:${enc}[`, close: ']', href: enc }
}

const spanOf = (src: LinkSource): Span => ({
  type: 'link',
  href: src.href,
  form: src.form,
  attrs: '',
  marker: '',
  open: src.open,
  close: src.close,
  from: -1,
  to: -1,
  innerFrom: -1,
  innerTo: -1,
  double: false,
})

/** A link over `from`–`to`; on a link, the same text gets the new target. */
export function setLink(doc: NotaDocument, from: number, to: number, target: string): OperationResult {
  if (from > to) [from, to] = [to, from]
  const src = linkSource(target)
  if (typeof src === 'string') return failure('bad-target', src, from, to)
  // a caret or a range inside a link changes its target
  const block = inlineBlockAround(doc, from)
  if (from === to) {
    if (!block) return failure('empty-selection', MSG.select, from, to)
    const reading = readBlock(doc, block)
    const link = spansAt(reading, from).find((s) => s.type === 'link')
    if (!link) return failure('empty-selection', MSG.select, from, to)
    return retarget(doc, block, link, src)
  }
  const ranges = blocksInRange(doc, from, to)
  if ('error' in ranges) return failure(ranges.error, MSG.plate, from, to)
  if (ranges.length === 0) return failure('empty-selection', MSG.select, from, to)
  const links = new Set<Span>()
  for (const r of ranges)
    for (let i = r.i0; i < r.i1; i++) for (const s of r.cells[i]!.spans) if (s.type === 'link') links.add(s)
  if (ranges.length > 1)
    return failure('link-across-blocks', 'A link goes over the text of one paragraph', from, to)
  const r = ranges[0]!
  if (links.size > 1) return failure('link-overlap', 'The selection touches more than one link', from, to)
  if (links.size === 1) {
    const link = [...links][0]!
    // the whole selection must be in that link
    const inside = r.cells.slice(r.i0, r.i1).every((c) => c.spans.includes(link))
    if (!inside) return failure('link-overlap', 'The selection is partly in a link', from, to)
    return retarget(doc, r.block, link, src)
  }
  const span = spanOf(src)
  return rewriteBlocks(doc, [r], (x: BlockRange) =>
    x.cells.map((c, i) => (i >= x.i0 && i < x.i1 ? { ...c, spans: [...c.spans, span] } : c)),
  )
}

function retarget(
  doc: NotaDocument,
  block: NonNullable<ReturnType<typeof inlineBlockAround>>,
  link: Span,
  src: LinkSource,
): OperationResult {
  const reading = readBlock(doc, block)
  const span = spanOf(src)
  const cells = reading.cells.map((c) =>
    c.spans.includes(link) ? { ...c, spans: c.spans.map((s) => (s === link ? span : s)) } : c,
  )
  return rewriteBlock(doc, block, cells, true)
}

/** Takes the link at `at` away and leaves its text. */
export function removeLink(doc: NotaDocument, at: number): OperationResult {
  const block = inlineBlockAround(doc, at)
  if (!block) return failure('no-link', 'No link here', at, at)
  const reading = readBlock(doc, block)
  const link = reading.spans.find((s) => s.type === 'link' && s.from <= at && at <= s.to)
  if (!link) return failure('no-link', 'No link here', at, at)
  return rewriteBlock(
    doc,
    block,
    reading.cells.map((c) =>
      c.spans.includes(link) ? { ...c, spans: c.spans.filter((s) => s !== link) } : c,
    ),
    true,
  )
}
