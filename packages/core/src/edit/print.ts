/**
 * Prints cells back to source. Cells that came from the source print what they came from, so the text of a block
 * that nobody touched prints as it was; marks that are new or that no longer fit their surroundings get markers
 * that work (doubled where a single one would not be read).
 */
import type { Cell, MarkType, Span } from './types.js'
import { PLUS_ESCAPE, STRIKE_ATTRS, impliedMark } from './read.js'

const RANK: Record<MarkType, number> = {
  link: 0,
  strong: 1,
  em: 2,
  code: 3,
  strike: 4,
  highlight: 5,
  roles: 6,
  lock: 7,
}

/** The marker of a mark type when it is written new. */
export const DEFAULT_MARKER: Record<Exclude<MarkType, 'link' | 'lock'>, string> = {
  strong: '*',
  em: '_',
  code: '`',
  strike: '#',
  highlight: '#',
  roles: '#',
}

/** An inline mark that `toggleMark` puts on or takes off: `strong`, `em`, `code`, `strike` or `highlight`. */
export type MarkName = Exclude<MarkType, 'link' | 'roles' | 'lock'>

/** The cell has the mark: a span of that kind, or a span of roles written with its marker (`[.zz-a]*x*` is bold). */
export const hasMark = (c: Cell, mark: MarkName): boolean =>
  c.spans.some((s) => s.type === mark || impliedMark(s) === mark)

/**
 * The spans without the mark: a span of the kind goes, and `[.zz-a]*x*` without bold is `[.zz-a]#x#` (the roles
 * stay). `made` keeps one object for every span of roles, so that its cells share it.
 */
export function withoutMark(spans: readonly Span[], mark: MarkName, made: Map<Span, Span>): Span[] {
  const out: Span[] = []
  for (const s of spans) {
    if (s.type === mark) continue
    if (impliedMark(s) !== mark) {
      out.push(s)
      continue
    }
    let g = made.get(s)
    if (!g) made.set(s, (g = { ...s, marker: '#'.repeat(s.marker.length) }))
    out.push(g)
  }
  return out
}

/** A mark that is not in the source yet, written with the default markers. */
export function newSpan(type: Exclude<MarkType, 'link' | 'roles' | 'lock'>): Span {
  return {
    type,
    href: null,
    form: null,
    attrs: type === 'strike' ? STRIKE_ATTRS : '',
    marker: DEFAULT_MARKER[type],
    open: '',
    close: '',
    from: -1,
    to: -1,
    innerFrom: -1,
    innerTo: -1,
    double: false,
  }
}

export const plainCell = (ch: string, spans: readonly Span[] = [], src: string = ch): Cell => ({
  kind: 'char',
  ch,
  src,
  from: -1,
  to: -1,
  spans,
  flag: null,
  newline: false,
  linkEscape: false,
})

const isSpace = (c: Cell): boolean => c.kind === 'char' && (c.ch === ' ' || c.ch === '\t')

/**
 * Brings cells to what a block of `kind` can hold: no leading blanks, no line break where a line break would
 * end the block or a title, and the marks in one nesting order.
 */
export function normalizeCells(cells: readonly Cell[], kind: 'paragraph' | 'heading', eol = '\n'): Cell[] {
  const out: Cell[] = []
  cells.forEach((cell, i) => {
    const prev = out[out.length - 1]
    if (kind === 'heading' && cell.kind === 'char' && cell.newline) out.push(plainCell(' ', cell.spans))
    // a title is one line: a break that ends it stays, one with text after it is only the characters ` +`
    else if (kind === 'heading' && cell.kind === 'break') {
      if (i === cells.length - 1) out.push(cell)
      else out.push(plainCell(' ', cell.spans), plainCell('+', cell.spans))
    } else if (cell.newline && prev && (prev.newline || prev.kind === 'break'))
      out.push(plainCell(' ', cell.spans))
    else out.push(cell)
  })
  // a plus that would be read as more than a plus (a hard break, an underline, a continuation) is the attribute
  // `{plus}`: one that is alone at the end of its line, after a blank or at the start of the line, outside any mark
  for (let i = 1; i <= out.length; i++) {
    const c = out[i - 1]!
    if (c.kind !== 'char' || c.ch !== '+' || (c.src !== '+' && c.src !== PLUS_ESCAPE)) continue
    const prev = out[i - 2]
    let j = i
    while (j < out.length && isSpace(out[j]!) && !out[j]!.newline && out[j]!.spans.length === 0) j++
    const alone = c.spans.length === 0 && (j === out.length || out[j]!.newline)
    const src = alone && prev && (isSpace(prev) || prev.newline || prev.kind === 'break') ? PLUS_ESCAPE : '+'
    if (src !== c.src) out[i - 1] = { ...c, src }
  }
  let start = 0
  // (a blank that a mark holds in the source is not a leading one: the marker starts the line; one that is typed is)
  while (
    start < out.length &&
    (isSpace(out[start]!) || out[start]!.newline) &&
    (out[start]!.spans.length === 0 || out[start]!.from < 0)
  )
    start++
  const res = start ? out.slice(start) : out
  const last = res[res.length - 1]
  if (last && last.newline) res[res.length - 1] = plainCell(' ', last.spans)
  // a hard break takes the line break after it, unless it ends the block
  for (let i = 0; i < res.length; i++) {
    const c = res[i]!
    if (c.kind !== 'break') continue
    const ends = /\n$/.test(c.src)
    if (i === res.length - 1) {
      if (ends) res[i] = { ...c, src: c.src.replace(/\r?\n$/, '') }
    } else if (!ends) res[i] = { ...c, src: c.src + eol }
  }
  return sortStacks(res)
}

/** Puts the spans of every cell in one global order: what covers more is outside, an old span outside a new one. */
export function sortStacks(cells: Cell[]): Cell[] {
  if (!cells.some((c) => c.spans.length > 1)) return cells
  const info = new Map<Span, { first: number; last: number }>()
  cells.forEach((c, i) => {
    for (const s of c.spans) {
      const e = info.get(s)
      if (e) e.last = i
      else info.set(s, { first: i, last: i })
    }
  })
  if (info.size < 2) return cells
  const order = new Map<Span, number>()
  const list = [...info.entries()].sort(([a, x], [b, y]) => {
    const ex = x.last - x.first
    const ey = y.last - y.first
    if (ex !== ey) return ey - ex
    if (x.first !== y.first) return x.first - y.first
    // a mark that is put over just the text of a construct goes outside it: the construct keeps its text as it is
    if ((a.type === 'lock') !== (b.type === 'lock')) {
      const other = a.type === 'lock' ? b : a
      if (other.from < 0) return a.type === 'lock' ? 1 : -1
    }
    const fa = a.from < 0 ? Infinity : a.from
    const fb = b.from < 0 ? Infinity : b.from
    if (fa !== fb) return fa < fb ? -1 : 1
    return RANK[a.type] - RANK[b.type]
  })
  list.forEach(([s], i) => order.set(s, i))
  return cells.map((c) => {
    if (c.spans.length < 2) return c
    const sorted = [...c.spans].sort((a, b) => order.get(a)! - order.get(b)!)
    return sorted.every((s, i) => s === c.spans[i]) ? c : { ...c, spans: sorted }
  })
}

const WORD = /[\p{L}\p{N}\p{M}_]/u
const isWord = (c: string): boolean => c !== '' && WORD.test(c)

interface PNode {
  cell?: Cell
  span?: Span
  kids?: PNode[]
}

function group(cells: readonly Cell[], lo: number, hi: number, depth: number): PNode[] {
  const out: PNode[] = []
  for (let i = lo; i < hi;) {
    const sp = cells[i]!.spans[depth]
    if (!sp) {
      out.push({ cell: cells[i]! })
      i++
      continue
    }
    let j = i + 1
    while (j < hi && cells[j]!.spans[depth] === sp) j++
    out.push({ span: sp, kids: group(cells, i, j, depth + 1) })
    i = j
  }
  return out
}

/** The opening and closing source of a span, given the characters around it and its first and last inner ones. */
function markers(
  sp: Span,
  prev: string,
  next: string,
  first: string,
  last: string,
): { open: string; close: string } {
  if (sp.type === 'link' || sp.type === 'lock') return { open: sp.open, close: sp.close }
  const base = sp.marker || DEFAULT_MARKER[sp.type]
  const ch = base[0]!
  let double = sp.double || base.length === 2
  if (!double) {
    const prevOk = prev === '' || !(isWord(prev) || ';:}'.includes(prev))
    const nextOk = next === '' || !isWord(next)
    const innerOk = first !== '' && last !== '' && !/\s/.test(first) && !/\s/.test(last)
    if (!(prevOk && nextOk && innerOk)) double = true
  }
  const m = double ? ch + ch : ch
  const attrs = sp.type === 'strike' ? sp.attrs || STRIKE_ATTRS : sp.attrs
  return { open: attrs + m, close: m }
}

const lastCh = (s: string): string => (s === '' ? '' : s[s.length - 1]!)

function firstChar(n: PNode): string {
  if (n.cell) return n.cell.src[0] ?? ''
  const sp = n.span!
  if (sp.type === 'link' || sp.type === 'lock') return sp.open ? sp.open[0]! : firstChar(n.kids![0]!)
  return (
    sp.type === 'strike' ? sp.attrs || STRIKE_ATTRS : sp.attrs || sp.marker || DEFAULT_MARKER[sp.type]
  )[0]!
}

function lastChar(n: PNode): string {
  if (n.cell) return lastCh(n.cell.src)
  const sp = n.span!
  if (sp.type === 'link' || sp.type === 'lock')
    return sp.close ? lastCh(sp.close) : lastChar(n.kids![n.kids!.length - 1]!)
  return (sp.marker || DEFAULT_MARKER[sp.type])[0]!
}

function render(nodes: PNode[], prev: string, next: string, bracket: boolean): string {
  let out = ''
  for (let k = 0; k < nodes.length; k++) {
    const n = nodes[k]!
    const p = k === 0 ? prev : lastChar(nodes[k - 1]!)
    const q = k === nodes.length - 1 ? next : firstChar(nodes[k + 1]!)
    if (n.cell) {
      const c = n.cell
      let src = c.src
      if (c.ch === ']' && c.kind === 'char') {
        // a `]` inside the text of a link is written `\]`; outside it is only a `]`
        if (bracket && (src === ']' || c.linkEscape)) src = '\\]'
        else if (!bracket && c.linkEscape) src = ']'
      }
      out += src
      continue
    }
    const sp = n.span!
    const kids = n.kids!
    const bracketText =
      sp.type === 'link' &&
      (sp.form === 'url' || sp.form === 'link' || sp.form === 'mailto' || sp.form === 'xref') &&
      sp.close === ']'
    const { open, close } = markers(sp, p, q, firstChar(kids[0]!), lastChar(kids[kids.length - 1]!))
    const inner = render(kids, lastCh(open), close[0] ?? '', bracketText)
    out += open + inner + close
  }
  return out
}

/** The source of cells; `prev` and `next` are the characters right before and after them (for markers). */
export function printCells(cells: readonly Cell[], prev = '', next = ''): string {
  return render(group(cells, 0, cells.length, 0), prev, next, false)
}
