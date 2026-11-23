import type { NotaDocument } from '@nota-adoc/core'
import { Converter } from './convert.js'
import { type Blk, buildModel } from '@nota-adoc/core/internal'

/** Options of {@link renderHtml}. */
export interface RenderOptions {
  // reserved: the attributes come from the options the document was parsed with
  readonly _?: never
}

/**
 * The HTML of a document, as `Asciidoctor.convert(text, { safe: 'secure' })` writes it for an embedded document
 * (no `<html>`, `<head>` or `<body>`): sections with ids, blocks, inline markup, footnotes at the end.
 * The raw HTML that passthroughs let through is written as it is; cleaning it is up to the caller.
 *
 * @example
 * ```ts
 * renderHtml(parse('Some *bold* text.\n'))
 * // '<div class="paragraph">\n<p>Some <strong>bold</strong> text.</p>\n</div>'
 * ```
 *
 * @throws TypeError when `doc` was not made by `parse()` or `doc.update()` of this copy of `@nota-adoc/core`
 * (for example a plain object, or a document of another copy of the package in `node_modules`).
 */
export function renderHtml(doc: NotaDocument, _options: RenderOptions = {}): string {
  return new Converter(buildModel(doc)).document()
}

/** The HTML of a block of a document and of the blocks in it, for tools that compare documents block by block. */
export interface BlockHtml {
  /** The context of the block, as Asciidoctor names it: `paragraph`, `section`, `listing`, `ulist`, … */
  readonly context: string
  /** Offsets of the source the block covers. */
  readonly from: number
  readonly to: number
  readonly html: string
  /** The blocks in it: the blocks of a section, the blocks of a compound block, the blocks of the items of a list. */
  readonly blocks: readonly BlockHtml[]
}

/**
 * The HTML of the whole document, and of each of its blocks.
 *
 * @throws TypeError when `doc` was not made by `parse()` or `doc.update()` of this copy of `@nota-adoc/core`
 * (for example a plain object, or a document of another copy of the package in `node_modules`).
 */
export function renderHtmlBlocks(doc: NotaDocument): { html: string; blocks: BlockHtml[] } {
  const model = buildModel(doc)
  const conv = new Converter(model)
  conv.recorded = new Map()
  const html = conv.document()
  const rec = conv.recorded
  const childrenOf = (b: Blk): Blk[] =>
    b.ctx === 'ulist' || b.ctx === 'olist' || b.ctx === 'colist' || b.ctx === 'dlist'
      ? b.items.flatMap((i) => i.blocks)
      : b.blocks
  const build = (b: Blk): BlockHtml => ({
    context: b.ctx,
    from: b.pin?.[0] ?? b.node?.from ?? b.from,
    to: b.pin?.[1] ?? b.node?.to ?? b.from,
    html: rec.get(b) ?? '',
    blocks: childrenOf(b).map(build),
  })
  return { html, blocks: model.root.blocks.map(build) }
}
