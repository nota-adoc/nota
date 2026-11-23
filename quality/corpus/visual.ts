/**
 * `npm run corpus -- visual`: what the visual editor makes of a folder of pages, as numbers under keys of a list fixed in the code.
 * Per file: the blocks the editor lays out by kind (paragraph, heading, item, the two forms of an admonition, a collapsible block,
 * a plate by the name of its node), what the lists, the admonitions and the collapsible blocks were as plates before the
 * editor refused them, by the codes of the refusals, and two round trips that must give the file back byte for byte or be refused: Tab then Shift+Tab on
 * every item, and a change of the type of every admonition there and back. Nothing else leaves: no names, no text.
 */
import { join } from 'node:path'
import { type Operation, applyOperation, parse } from '@nota-adoc/core'
import type { NotaDocument } from '@nota-adoc/core'
import { codeText, layoutItems, pageMetaItems, readLayout, readPageMeta } from '@nota-adoc/core/internal'
import type { Item } from '@nota-adoc/core/internal'
import { OTHER, foldKeys } from '../lib/aggregate.js'
import { readSource } from '../lib/read-source.js'
import { InputError, listAdoc } from '../reference/run.js'
import { NodeNames } from '@nota-adoc/core'

/** The codes a refusal of these operations may have. */
const REFUSAL_CODES = [
  'first-item',
  'top-level-item',
  'item-has-items',
  'list-middle',
  'bad-level',
  'invalid-target',
  'invalid-block',
  'invalid-range',
  'invalid-span',
  'not-editable',
  'unsupported',
  'collateral',
  'unstable',
  'unwritable',
  'becomes-plate',
  'fragment-invalid',
  'inside-plate',
  'inside-construct',
  'join-meta',
]

const PLATE_KEYS = NodeNames.filter((n) => n !== '').map((n) => `plate.${n}`)

/** All the keys of `visual` in the order of the output (`<other>` follows them when something was folded into it). */
export const VISUAL_KEYS: readonly string[] = [
  'files',
  'exceptions',
  'blocks.paragraph',
  'blocks.heading',
  'blocks.item',
  'blocks.admonition-paragraph',
  'blocks.admonition-box',
  'blocks.collapsible',
  'blocks.code',
  'blocks.image',
  'blocks.island',
  ...PLATE_KEYS,
  'before.list',
  'before.admonition-paragraph',
  'before.admonition-box',
  'before.collapsible',
  'before.plate',
  'missed.admonition-box',
  'missed.collapsible',
  'tab.items',
  'tab.mismatch',
  'type.admonitions',
  'type.mismatch',
  'code.blocks',
  'code.mismatch',
  'image.blocks',
  'image.mismatch',
  'island.blocks',
  'island.mismatch',
  'meta.hidden',
  'meta.kept',
  'meta.islands',
  'meta.mismatch',
  'meta.body',
  'meta.toc',
  ...REFUSAL_CODES.flatMap((c) => [`tab.refusal.${c}`, `type.refusal.${c}`]),
]

const ALLOWED: ReadonlySet<string> = new Set(VISUAL_KEYS)

const add = (counts: Record<string, number>, key: string, n = 1): void => void (counts[key] = (counts[key] ?? 0) + n)

/** A `.Title` + `[%collapsible]` + `====`, or `[NOTE]`…`[CAUTION]` + `====`, shown as a plate: the editor should not leave these. */
const BOX_SOURCE = /^(?:\.[^\n]*\n)?\[([^\]\n]*)\]\n={4,}\n/

function missedBox(source: string): 'collapsible' | 'admonition-box' | null {
  const m = BOX_SOURCE.exec(source)
  if (!m) return null
  const attrs = m[1]!
  if (/%collapsible/.test(attrs)) return 'collapsible'
  if (/^(NOTE|TIP|IMPORTANT|WARNING|CAUTION)(?:[#.%,\]]|$)/.test(attrs)) return 'admonition-box'
  return null
}

function apply(doc: NotaDocument, op: Operation): NotaDocument | string {
  const r = applyOperation(doc, op)
  return 'error' in r ? r.error : r.doc
}

function countDocument(text: string, counts: Record<string, number>): void {
  const doc = parse(text)
  const items = layoutItems(readLayout(doc))
  let inRun = false
  for (const it of items) {
    if (it.kind === 'empty') {
      inRun = false
      continue
    }
    if (it.kind !== 'item') inRun = false
    switch (it.kind) {
      case 'paragraph':
        if (it.block!.variant) {
          add(counts, 'blocks.admonition-paragraph')
          add(counts, 'before.admonition-paragraph')
          add(counts, 'before.plate')
        } else add(counts, 'blocks.paragraph')
        break
      case 'heading':
        add(counts, 'blocks.heading')
        break
      case 'item':
        add(counts, 'blocks.item')
        if (!inRun) {
          add(counts, 'before.list')
          add(counts, 'before.plate')
        }
        inRun = true
        break
      case 'fence':
        if (it.block!.fence === 'open') {
          const adm = it.block!.box === 'admonition'
          add(counts, adm ? 'blocks.admonition-box' : 'blocks.collapsible')
          add(counts, adm ? 'before.admonition-box' : 'before.collapsible')
          add(counts, 'before.plate')
        }
        break
      case 'code':
        add(counts, 'blocks.code')
        add(counts, 'before.plate')
        break
      case 'image':
        add(counts, 'blocks.image')
        add(counts, 'before.plate')
        break
      default: {
        // (what is left of the plates is shown as an island: its source, edited as text)
        add(counts, 'blocks.island')
        add(counts, 'before.plate')
        add(counts, `plate.${it.block!.label}`)
        const missed = missedBox(text.slice(it.block!.from, it.block!.to))
        if (missed) add(counts, `missed.${missed}`)
      }
    }
  }
  tabRoundTrip(doc, items, counts)
  pageMetaCheck(doc, items, counts)
  typeRoundTrip(doc, items, counts)
  verbatimRoundTrip(doc, items, counts)
}

/**
 * The header of the page: files whose header the editor keeps out of sight (`meta.hidden`), files that have a header
 * but the editor could not hide it (`meta.kept`), islands still drawn from the lines of a header (`meta.islands`, must be 0),
 * and files where deleting everything else gave the header back changed (`meta.mismatch`). The attributes after the
 * paragraph with a link are part of the header (`meta.islands` and `meta.mismatch` look at them and at the lines `toc::[]` of
 * the zone too); `meta.body` counts files where such attributes are kept out of sight, `meta.toc` files with a narrow line
 * `toc::[]` (with a header or without).
 */
function pageMetaCheck(doc: NotaDocument, items: readonly Item[], counts: Record<string, number>): void {
  if (items.some((it) => it.block?.fence === 'toc')) add(counts, 'meta.toc')
  const found = readPageMeta(doc)
  if (!found) return
  const { items: shown, meta } = pageMetaItems(doc, items, false)
  add(counts, meta ? 'meta.hidden' : 'meta.kept')
  if (meta && meta.kinds.includes('body')) add(counts, 'meta.body')
  const inside = (from: number, to: number): boolean => found.ranges.some((r) => from < r.to && to > r.from)
  const drawn = shown.filter(
    (it) => inside(it.from, it.to) && it.kind === 'chip',
  ).length
  if (drawn > 0) add(counts, 'meta.islands', drawn)
  if (!meta) return
  // everything outside the header and the lines `toc::[]` of its zone deleted, the last part first: every range of the header
  // is there as it was, in order
  const kept = [...meta.ranges, ...meta.tocs].sort((a, b) => a.from - b.from)
  let at = 0
  const parts: [number, number][] = []
  for (const r of kept) {
    if (r.from > at) parts.push([at, r.from])
    at = r.to
  }
  if (at < doc.text.length) parts.push([at, doc.text.length])
  let now = doc
  for (let i = parts.length - 1; i >= 0; i--) {
    const next = apply(now, { kind: 'deleteRange', from: parts[i]![0], to: parts[i]![1] })
    if (typeof next === 'string') continue
    now = next
  }
  let pos = 0
  for (const r of kept) {
    const piece = doc.text.slice(r.from, r.to)
    const hit = now.text.indexOf(piece, pos)
    if (hit < 0) return void add(counts, 'meta.mismatch')
    pos = hit + piece.length
  }
}

/** Tab then Shift+Tab on every item: the same file, or a refusal. */
function tabRoundTrip(doc: NotaDocument, items: readonly Item[], counts: Record<string, number>): void {
  items.forEach((it, i) => {
    if (it.kind !== 'item') return
    add(counts, 'tab.items')
    const at = it.block!.content!.from
    const moved = apply(doc, { kind: 'indentListItem', at })
    if (typeof moved === 'string') return void add(counts, `tab.refusal.${moved}`)
    const after = layoutItems(readLayout(moved))
    const again = after[i]
    if (!again || again.kind !== 'item') return void add(counts, 'tab.mismatch')
    const back = apply(moved, { kind: 'outdentListItem', at: again.block!.content!.from })
    if (typeof back === 'string') return void add(counts, `tab.refusal.${back}`)
    if (back.text !== doc.text) add(counts, 'tab.mismatch')
  })
}

/** A change of the type of every admonition and back: the same file, or a refusal. */
function typeRoundTrip(doc: NotaDocument, items: readonly Item[], counts: Record<string, number>): void {
  items.forEach((it, i) => {
    const b = it.block
    const para = it.kind === 'paragraph' && b?.variant
    const box = it.kind === 'fence' && b?.fence === 'open' && b.box === 'admonition'
    if (!b || (!para && !box)) return
    add(counts, 'type.admonitions')
    const from = b.variant
    const to = from === 'WARNING' ? 'TIP' : 'WARNING'
    // (the cursor of a paragraph is in its text; the one of a box, in its head)
    const at = para ? b.content!.from : it.from
    const changed = apply(doc, { kind: 'setAdmonitionType', at, variant: to })
    if (typeof changed === 'string') return void add(counts, `type.refusal.${changed}`)
    const again = layoutItems(readLayout(changed))[i]
    if (!again?.block) return void add(counts, 'type.mismatch')
    const back = apply(changed, {
      kind: 'setAdmonitionType',
      at: para ? again.block.content!.from : again.from,
      variant: from as 'NOTE',
    })
    if (typeof back === 'string') return void add(counts, `type.refusal.${back}`)
    if (back.text !== doc.text) add(counts, 'type.mismatch')
  })
}

/** The code, the caption and the source of an island written as they are: the same file, or a refusal. */
function verbatimRoundTrip(doc: NotaDocument, items: readonly Item[], counts: Record<string, number>): void {
  for (const it of items) {
    const b = it.block
    if (!b) continue
    let op: Operation
    let key: 'code' | 'image' | 'island'
    if (it.kind === 'code') {
      key = 'code'
      op = { kind: 'setCodeText', at: it.from, text: codeText(doc, b) }
    } else if (it.kind === 'image') {
      key = 'image'
      // (the caption is the content range when it is before the macro; none: the range is a point)
      op = { kind: 'setCaption', at: it.from, text: b.content!.from < b.markerFrom ? doc.text.slice(b.content!.from, b.content!.to) : '' }
    } else if (it.kind === 'chip') {
      key = 'island'
      op = { kind: 'setIslandText', at: it.from, text: doc.text.slice(it.from, it.to - b.eol.length).replace(/\r\n?/g, '\n') }
    } else continue
    add(counts, `${key}.blocks`)
    const r = apply(doc, op)
    if (typeof r !== 'string' && r.text !== doc.text) add(counts, `${key}.mismatch`)
  }
}

export interface VisualResult {
  files: number
  counts: Record<string, number>
}

export function runVisual(dir: string): VisualResult {
  const files = listAdoc(dir)
  if (files.length === 0) throw new InputError('no .adoc files in the input directory')
  const counts: Record<string, number> = {}
  for (const file of files) {
    try {
      countDocument(readSource(join(dir, file)), counts)
    } catch {
      add(counts, 'exceptions')
    }
  }
  return { files: files.length, counts: foldKeys({ ...counts, files: files.length }, (k) => ALLOWED.has(k)) }
}

/** The numbers under the keys of the list, in its order (zero for the key that did not occur), and `<other>` if used. */
export function visualRows(r: VisualResult): [string, number][] {
  const rows = VISUAL_KEYS.map((k): [string, number] => [k, r.counts[k] ?? 0])
  if (r.counts[OTHER]) rows.push([OTHER, r.counts[OTHER]])
  return rows
}

export function formatVisual(r: VisualResult): string {
  return (
    visualRows(r)
      .filter(([k, n]) => n !== 0 || !k.includes('.refusal.'))
      .map(([k, n]) => `${k}: ${n}`)
      .join('\n') + '\n'
  )
}

export function visualJson(r: VisualResult): string {
  return JSON.stringify(Object.fromEntries(visualRows(r)), null, 2)
}
