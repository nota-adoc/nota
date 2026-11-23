// npm run bench -- visual: typing in the visual editor. A document of about 200 KB, 1000 keystrokes in different
// paragraphs, each the whole way: the event of input → the operation on the text in the session → the check of the
// block and the screen. Reports the median and the 95th percentile of a keystroke and of the part that is Nota's.
import { createSession } from '@nota-adoc/core'
import { installDom } from '../fuzz/dom.js'
import { generateDocument, prng } from './bench.js'

installDom()
const { createVisualEditor } = await import('@nota-adoc/prosemirror')
const { TextSelection } = await import('prosemirror-state')

export interface VisualBench {
  size: number
  keystrokes: number
  medianMs: number
  p95Ms: number
  notaMedianMs: number
  notaP95Ms: number
  openMs: number
  /** On every keystroke Nota's part was not longer than the keystroke (paired, so a busy machine does not break it). */
  notaWithinKeystroke: boolean
}

/** Budgets of `npm run bench -- visual` (the engine spec: 16 ms a keystroke at the 95th percentile, 3 ms of it Nota's). */
export const visualBudget = { p95Ms: 16, notaP95Ms: 3 }

const percentile = (xs: number[], p: number): number => {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)]!
}
const median = (xs: number[]): number => percentile(xs, 0.5)

/** A table of `rows` x `cols` cells of a short text, in the `|===` form with a head (the cells of one row on a line). */
export function tableDocument(rows: number, cols: number): string {
  const line = (r: number): string => Array.from({ length: cols }, (_, c) => `|r${r}c${c} text`).join(' ')
  const body = Array.from({ length: rows - 1 }, (_, r) => line(r + 1))
  return `= Table\n\n[%header]\n|===\n${line(0)}\n\n${body.join('\n')}\n|===\n`
}

export function measureVisual(
  opts: { size?: number; keystrokes?: number; seed?: number; text?: string; cells?: boolean } = {},
): VisualBench {
  const size = opts.size ?? 200_000
  const keystrokes = opts.keystrokes ?? 1000
  const rnd = prng(opts.seed ?? 20260929)
  const session = createSession(opts.text ?? generateDocument(size, 7))
  const host = document.createElement('div')
  document.body.append(host)
  const nota: number[] = []
  const opened = performance.now()
  const editor = createVisualEditor(host, { session, timing: (ms) => nota.push(ms) })
  const openMs = performance.now() - opened
  const { view } = editor
  // the paragraphs and headings of the screen (their number does not change while typing)
  const blocks: number[] = []
  view.state.doc.forEach((node, _offset, index) => {
    if (node.isTextblock && node.content.size > 3) blocks.push(index)
  })
  // the text of the cells that have one
  const cellStarts = (): number[] => {
    const out: number[] = []
    view.state.doc.descendants((node, pos) => {
      if (node.type.name === 'cell_text' && node.content.size > 0) out.push(pos)
      return node.type.name !== 'cell_text'
    })
    return out
  }
  // (found once, then moved by each letter typed: the bench does not walk the document, which would be garbage in the
  // time that is measured)
  const cells = opts.cells ? cellStarts() : []
  const type = (): void => {
    let pos: number
    if (opts.cells) {
      const start = cells[Math.floor(rnd() * cells.length)]!
      pos = start + 1 + Math.floor(rnd() * (view.state.doc.nodeAt(start)!.content.size + 1))
    } else {
      const index = blocks[Math.floor(rnd() * blocks.length)]!
      let start = 0
      view.state.doc.forEach((_n, offset, i) => {
        if (i === index) start = offset
      })
      const node = view.state.doc.child(index)
      pos = start + 1 + Math.floor(rnd() * (node.content.size + 1))
    }
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)))
    const notaBefore = nota.length
    const t0 = performance.now()
    if (
      !view.someProp('handleTextInput', (h) =>
        h(view, pos, pos, 'x', () => view.state.tr.insertText('x', pos, pos)),
      )
    )
      view.dispatch(view.state.tr.insertText('x', pos, pos))
    const elapsed = performance.now() - t0
    total.push(elapsed)
    // (Nota's part is measured inside the keystroke, so on the same keystroke it cannot be longer than it)
    let part = 0
    for (let i = notaBefore; i < nota.length; i++) part += nota[i]!
    notaOver = Math.max(notaOver, part - elapsed)
    for (let i = 0; i < cells.length; i++) if (cells[i]! >= pos) cells[i]!++
  }
  const total: number[] = []
  let notaOver = -Infinity
  for (let i = 0; i < 50; i++) type() // warm up
  total.length = 0
  nota.length = 0
  notaOver = -Infinity
  for (let i = 0; i < keystrokes; i++) type()
  const r = {
    size: session.text.length,
    keystrokes,
    medianMs: median(total),
    p95Ms: percentile(total, 0.95),
    notaMedianMs: median(nota),
    notaP95Ms: percentile(nota, 0.95),
    openMs,
    notaWithinKeystroke: notaOver <= 0.05,
  }
  editor.destroy()
  host.remove()
  return r
}

/** The lines that report a budget that was exceeded; empty when both are met. */
export function visualFailures(r: VisualBench, budget = visualBudget): string[] {
  const out: string[] = []
  if (!(r.p95Ms < budget.p95Ms))
    out.push(`FAIL: p95 of a keystroke ${r.p95Ms.toFixed(3)} ms is not under ${budget.p95Ms} ms`)
  if (!(r.notaP95Ms < budget.notaP95Ms))
    out.push(`FAIL: p95 of Nota ${r.notaP95Ms.toFixed(3)} ms is not under ${budget.notaP95Ms} ms`)
  return out
}
