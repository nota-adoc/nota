/**
 * `npm run corpus -- stats`: the forms of the constructs of a folder of pages, as numbers under keys of a list fixed
 * in the code (the tables of stage 3 and the counters of the nodes of the tree). Nothing else leaves: no names,
 * no text. It shows which constructs a corpus has, so that a difference found by the closed run can be
 * repeated on the synthetic pages.
 */
import { join } from 'node:path'
import { BlockAttributes, NodeNames, blockKind, parse } from '@nota-adoc/core'
import type { NotaDocument } from '@nota-adoc/core'
import { OTHER, foldKeys } from '../lib/aggregate.js'
import { readSource } from '../lib/read-source.js'
import { InputError, listAdoc } from '../reference/run.js'

const CELL_STYLES = ['a', 'd', 'e', 'h', 'l', 'm', 's', 'v']

/** The keys of the tables, in the order of the output. */
export const TABLE_KEYS: readonly string[] = [
  'table.sep.pipe',
  'table.sep.bang',
  'table.sep.comma',
  'table.sep.colon',
  'table.sep.tab',
  'table.sep.custom',
  'table.depth.1',
  'table.depth.2',
  'table.depth.3',
  'table.depth.4',
  'table.depth.deeper',
  'table.option.header',
  'table.option.noheader',
  'table.option.footer',
  'table.option.autowidth',
  'table.frame.all',
  'table.frame.ends',
  'table.frame.topbot',
  'table.frame.sides',
  'table.frame.none',
  'table.grid.all',
  'table.grid.cols',
  'table.grid.rows',
  'table.grid.none',
  'table.stripes.even',
  'table.stripes.odd',
  'table.stripes.hover',
  'table.stripes.all',
  'table.stripes.none',
  'table.width',
  'table.cols',
  'table.cols.repeat',
  'table.implicit-header',
  'table.cell.span.col',
  'table.cell.span.row',
  'table.cell.span.both',
  'table.cell.repeat',
  'table.cell.halign.left',
  'table.cell.halign.center',
  'table.cell.halign.right',
  'table.cell.valign.top',
  'table.cell.valign.middle',
  'table.cell.valign.bottom',
  ...CELL_STYLES.map((s) => `table.cell.style.${s}`),
  'table.cell.multiline',
  'table.cell.pass-block',
  'table.escaped-separator',
  'table.csv.quotes',
  'table.dsv.escape',
]

const NODE_KEYS: readonly string[] = NodeNames.filter((n) => n !== '')

/** All the keys of `stats` in the order of the output (`<other>` follows them when something was folded into it). */
export const STATS_KEYS: readonly string[] = ['files', 'tables', ...TABLE_KEYS, ...NODE_KEYS]

const ALLOWED: ReadonlySet<string> = new Set(STATS_KEYS)

const HALIGN: Record<string, string> = { '<': 'left', '^': 'center', '>': 'right' }
const VALIGN: Record<string, string> = { '<': 'top', '^': 'middle', '>': 'bottom' }
const SEPARATORS: Record<string, string> = {
  '|': 'pipe',
  '!': 'bang',
  ',': 'comma',
  ':': 'colon',
  '\t': 'tab',
}

/** A cell spec: [span or repeat, column part, row part, sign], the alignments and the style. */
const SPEC = /^(?:(\d*)(?:\.(\d*))?([*+]))?([<^>])?(?:\.([<^>]))?([a-z])?$/

function add(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1
}

/** The counts of one document, under any keys (the ones outside the list are folded later). */
export function countDocument(
  doc: NotaDocument,
  counts: Record<string, number> = {},
): Record<string, number> {
  const text = doc.text
  /** The tables around the current node, the innermost last: the separator and the format of each. */
  const stack: { sep: string; format: string }[] = []
  let cellDepth = 0
  doc.tree.iterate({
    enter(n) {
      if (n.name) add(counts, n.name)
      if (n.name === 'DelimitedBlock') {
        const kind = n.node.tree?.prop(blockKind)
        if (
          kind === 'pass' &&
          cellDepth > 0 &&
          text.startsWith('++++', n.node.getChild('BlockDelimiter')?.from ?? -1)
        ) {
          add(counts, 'table.cell.pass-block')
        }
        if (kind !== 'table') return
        const model = doc.tableAt(n.from)
        const attrs = new BlockAttributes()
        for (let c = n.node.firstChild; c; c = c.nextSibling) {
          if (c.name !== 'BlockAttributes') continue
          attrs.applyList(text.slice(c.from + 1, c.to).replace(/\]\s*$/, ''))
        }
        add(counts, 'tables')
        const sep = model?.separator ?? '|'
        add(counts, `table.sep.${SEPARATORS[sep] ?? 'custom'}`)
        add(counts, `table.depth.${stack.length + 1 > 4 ? 'deeper' : stack.length + 1}`)
        const a = attrs.attributes
        for (const o of ['header', 'noheader', 'footer', 'autowidth'])
          if (a.has(`${o}-option`)) add(counts, `table.option.${o}`)
        for (const k of ['frame', 'grid', 'stripes'])
          if (a.has(k)) add(counts, `table.${k}.${(a.get(k) ?? '').trim()}`)
        if (a.has('width')) add(counts, 'table.width')
        const cols = a.get('cols')
        if (cols !== undefined && cols !== null) {
          add(counts, 'table.cols')
          if (/\d+\*/.test(cols)) add(counts, 'table.cols.repeat')
        }
        if (model && model.rows.head.length > 0 && !a.has('header-option'))
          add(counts, 'table.implicit-header')
        stack.push({ sep, format: model?.format ?? 'psv' })
      } else if (n.name === 'CellContent') {
        cellDepth++
        const table = stack[stack.length - 1]
        if (!table) return
        const content = text.slice(n.from, n.to)
        if (content.trim().includes('\n')) add(counts, 'table.cell.multiline')
        if (table.format === 'psv' && content.includes('\\' + table.sep))
          add(counts, 'table.escaped-separator')
        if (table.format === 'csv' && content.trimStart().startsWith('"')) add(counts, 'table.csv.quotes')
        if (table.format === 'dsv' && content.includes('\\' + table.sep)) add(counts, 'table.dsv.escape')
      } else if (n.name === 'CellSpec') {
        const m = SPEC.exec(text.slice(n.from, n.to))
        if (!m) return
        const [, first, second, sign, h, v, style] = m
        if (sign === '*') add(counts, 'table.cell.repeat')
        else if (sign === '+') {
          if (first && !second) add(counts, 'table.cell.span.col')
          else if (!first && second) add(counts, 'table.cell.span.row')
          else if (first && second) add(counts, 'table.cell.span.both')
        }
        if (h) add(counts, `table.cell.halign.${HALIGN[h]}`)
        if (v) add(counts, `table.cell.valign.${VALIGN[v]}`)
        if (style && CELL_STYLES.includes(style)) add(counts, `table.cell.style.${style}`)
      }
    },
    leave(n) {
      if (n.name === 'DelimitedBlock' && n.node.tree?.prop(blockKind) === 'table') stack.pop()
      else if (n.name === 'CellContent') cellDepth--
    },
  })
  return counts
}

export interface StatsResult {
  files: number
  counts: Record<string, number>
}

export function runStats(dir: string): StatsResult {
  const files = listAdoc(dir)
  if (files.length === 0) throw new InputError('no .adoc files in the input directory')
  const counts: Record<string, number> = {}
  for (const file of files) {
    try {
      countDocument(parse(readSource(join(dir, file))), counts)
    } catch {
      add(counts, 'unreadable')
    }
  }
  return { files: files.length, counts: foldKeys({ ...counts, files: files.length }, (k) => ALLOWED.has(k)) }
}

/** The numbers under the keys of the list, in its order (zero for the key that did not occur), and `<other>` if used. */
export function statsRows(r: StatsResult): [string, number][] {
  const rows = STATS_KEYS.map((k): [string, number] => [k, r.counts[k] ?? 0])
  if (r.counts[OTHER]) rows.push([OTHER, r.counts[OTHER]])
  return rows
}

export function formatStats(r: StatsResult): string {
  return (
    statsRows(r)
      .map(([k, n]) => `${k}: ${n}`)
      .join('\n') + '\n'
  )
}

export function statsJson(r: StatsResult): string {
  return JSON.stringify(Object.fromEntries(statsRows(r)), null, 2)
}
