/**
 * What is pasted from the browser or Word: the HTML of the clipboard read into blocks of AsciiDoc. It has no dependencies but the
 * `DOMParser` of the page and the reader of Nota (text is escaped by `escapeInline` of the core, and the result is read back to
 * see that it reads as the text it came from). What is carried over: paragraphs and line breaks, bold, italic, monospace,
 * strikethrough, links (http, https, mailto), lists with their levels (also the lists of Word), headings, simple tables. Colour,
 * fonts, sizes, alignment and pictures are not.
 */
import { parse } from '@nota-adoc/core'
import { escapeInline, layoutItems, readInline, readLayout } from '@nota-adoc/core/internal'

/** A stretch of text of one look. `br`: a hard line break. */
export interface Run {
  text: string
  bold: boolean
  italic: boolean
  mono: boolean
  strike: boolean
  href: string | null
  br?: boolean
}

/** A block of what is pasted. */
export interface PasteBlock {
  readonly kind: 'paragraph' | 'section' | 'list' | 'table' | 'code'
  /** The source of the block. */
  readonly source: string
  /** The text of the block, as plain text (lines joined by `\n`). */
  readonly text: string
  /** Paragraphs: the runs the source is made of, to be written again in the place where they go (`renderRuns`). */
  readonly runs?: readonly Run[]
  /** Paragraphs: the blank the text began or ended with (it is kept where the paragraph goes into a line). */
  readonly edge?: { readonly lead: boolean; readonly trail: boolean }
  /** What the reader of Nota must find in the source: the kinds of the items and their texts, in order. */
  readonly expect: readonly { readonly kind: string; readonly text: string | null }[]
}

/** The result of reading the clipboard. */
export interface Pasted {
  readonly blocks: readonly PasteBlock[]
  /** There were pictures in the clipboard: they are not pasted. */
  readonly images: boolean
  /** The blocks read back as the text they came from; false when the reader of Nota takes them for something else. */
  readonly verified: boolean
}

type Look = Pick<Run, 'bold' | 'italic' | 'mono' | 'strike' | 'href'>
const PLAIN: Look = { bold: false, italic: false, mono: false, strike: false, href: null }

const SKIP = new Set(['SCRIPT', 'STYLE', 'HEAD', 'TITLE', 'META', 'LINK', 'NOSCRIPT', 'TEMPLATE', 'XML', 'O:P', 'SVG', 'CANVAS', 'IFRAME'])
const BLOCKS = new Set([
  'P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'TABLE', 'PRE', 'BLOCKQUOTE', 'SECTION', 'ARTICLE', 'HEADER',
  'FOOTER', 'ASIDE', 'MAIN', 'NAV', 'FIGURE', 'FIGCAPTION', 'HR', 'DL', 'DT', 'DD', 'ADDRESS', 'CENTER', 'BODY', 'HTML',
])
const SAFE_LINK = /^(?:https?:|mailto:)/i

const isWord = (c: string | undefined): boolean => c !== undefined && c !== '' && /[\p{L}\p{N}_]/u.test(c)

/** The value of a property in the `style` attribute as written (the CSS of Word has properties the page does not know). */
function styleValue(el: Element, property: string): string | null {
  const style = el.getAttribute('style')
  if (!style) return null
  const m = new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`, 'i').exec(style)
  return m ? m[1]!.trim().toLowerCase() : null
}

function lookOf(el: Element, parent: Look): Look {
  const look = { ...parent }
  const tag = el.tagName
  if (tag === 'B' || tag === 'STRONG') look.bold = true
  else if (tag === 'I' || tag === 'EM' || tag === 'CITE' || tag === 'DFN' || tag === 'VAR') look.italic = true
  else if (tag === 'CODE' || tag === 'KBD' || tag === 'SAMP' || tag === 'TT') look.mono = true
  else if (tag === 'S' || tag === 'DEL' || tag === 'STRIKE') look.strike = true
  else if (tag === 'A') {
    const href = el.getAttribute('href')
    if (href && SAFE_LINK.test(href.trim())) look.href = href.trim()
  }
  const weight = styleValue(el, 'font-weight')
  if (weight !== null) look.bold = /^(?:bold|bolder|[6-9]00)$/.test(weight)
  const slant = styleValue(el, 'font-style')
  if (slant !== null) look.italic = /^(?:italic|oblique)/.test(slant)
  const line = styleValue(el, 'text-decoration-line') ?? styleValue(el, 'text-decoration')
  if (line !== null && /line-through/.test(line)) look.strike = true
  return look
}

const hasBlock = (el: Element): boolean => {
  for (const child of Array.from(el.children)) {
    if (SKIP.has(child.tagName)) continue
    if (BLOCKS.has(child.tagName) || hasBlock(child)) return true
  }
  return false
}

/** The text of a node of the page as HTML shows it: blanks run together, a non-breaking space is a blank. */
const collapse = (s: string): string => s.replace(/[\u00a0\s]+/g, ' ')

// ---------------------------------------------------------------------------------------------------- runs

/** The runs of the content of `node` (blocks inside are cut with a blank). */
function collect(node: Node, look: Look, out: Run[], seen: { images: boolean }): void {
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === 3) {
      const text = collapse(child.textContent ?? '')
      if (text !== '') out.push({ ...look, text })
    } else if (child.nodeType === 1) {
      const el = child as Element
      if (SKIP.has(el.tagName)) continue
      if (el.tagName === 'BR') out.push({ ...look, text: '', br: true })
      else if (el.tagName === 'IMG') seen.images = true
      else if (el.tagName === 'INPUT') continue
      else if (BLOCKS.has(el.tagName)) {
        out.push({ ...look, text: ' ' })
        collect(el, lookOf(el, look), out, seen)
        out.push({ ...look, text: ' ' })
      } else collect(el, lookOf(el, look), out, seen)
    }
  }
}

const sameLook = (a: Look, b: Look): boolean =>
  a.bold === b.bold && a.italic === b.italic && a.mono === b.mono && a.strike === b.strike && a.href === b.href

/** Runs with the blanks of HTML put right: none at the ends of a line, one between words, neighbours of one look made one. */
export function tidy(runs: readonly Run[], oneLine = false): Run[] {
  const out: Run[] = []
  let space = true // (the start of a line: a blank there is dropped)
  for (const r of runs) {
    if (r.br) {
      if (oneLine) {
        if (!space) {
          out.push({ ...PLAIN, text: ' ' })
          space = true
        }
        continue
      }
      // (a break at the start of a line, or two in a row, are not kept)
      const last = out[out.length - 1]
      if (!last || last.br) continue
      if (last.text.endsWith(' ')) last.text = last.text.replace(/ +$/, '')
      if (last.text === '') out.pop()
      out.push({ ...r })
      space = true
      continue
    }
    let text = r.text
    if (space && text.startsWith(' ')) text = text.replace(/^ +/, '')
    if (text === '') continue
    out.push({ ...r, text })
    space = text.endsWith(' ')
  }
  // (nothing but blanks and breaks at the end)
  while (out.length) {
    const last = out[out.length - 1]!
    if (last.br) out.pop()
    else if (last.text.replace(/ +$/, '') === '') out.pop()
    else {
      last.text = last.text.replace(/ +$/, '')
      break
    }
  }
  const merged: Run[] = []
  for (const r of out) {
    const prev = merged[merged.length - 1]
    if (prev && !prev.br && !r.br && sameLook(prev, r)) prev.text += r.text
    else merged.push({ ...r })
  }
  return merged
}

const plainText = (runs: readonly Run[]): string => runs.map((r) => (r.br ? '\n' : r.text)).join('')

// ---------------------------------------------------------------------------------------------------- source

/** The source of plain text in the middle of a line (`start`: at the start of one), or the text as it is where no source reads as it. */
function escapeText(text: string, start: boolean): string {
  if (text === '') return ''
  const probe = start ? text : `a ${text}`
  const r = escapeInline(probe)
  if (r === null) return text
  return start ? r : r.startsWith('a ') ? r.slice(2) : text
}

function linkTarget(href: string): string {
  return href.replace(/ /g, '%20').replace(/\[/g, '%5B').replace(/\]/g, '%5D')
}

/**
 * The source of runs. `before` and `after` are the characters of the line where they are put: a mark next to a letter is written
 * with a double sign, which works inside a word.
 */
export function renderRuns(runs: readonly Run[], before = '', after = ''): string {
  let out = ''
  let start = before === '' || before === '\n'
  const lastOf = (): string => (out === '' ? before.slice(-1) : out.slice(-1))
  for (let i = 0; i < runs.length; i++) {
    const r = runs[i]!
    if (r.br) {
      out += ' +\n'
      start = true
      continue
    }
    const lead = /^ */.exec(r.text)![0]
    const core = r.text.slice(lead.length).replace(/ +$/, '')
    const trail = r.text.slice(lead.length + core.length)
    out += lead
    if (core !== '') {
      const next = runs[i + 1]
      const nextChar = trail !== '' ? ' ' : next ? (next.br ? '\n' : next.text[0] ?? '') : after.slice(0, 1)
      const marked = r.bold || r.italic || r.mono || r.strike
      const atStart = start && lead === ''
      if (!marked && r.href === null) out += escapeText(core, atStart)
      else {
        const wide = r.href === null && (isWord(lastOf()) || isWord(nextChar))
        let body = r.href !== null ? escapeLinkText(escapeText(core, false)) : escapeText(core, atStart)
        const wrap = (mark: string): void => {
          body = wide ? `${mark}${mark}${body}${mark}${mark}` : `${mark}${body}${mark}`
        }
        if (r.mono) wrap('`')
        if (r.italic) wrap('_')
        if (r.bold) wrap('*')
        if (r.strike) body = `[.line-through]${wide ? '##' : '#'}${body}${wide ? '##' : '#'}`
        if (r.href !== null) {
          const target = linkTarget(r.href)
          out += !marked && core === r.href ? target : `${target}[${body}]`
        } else out += body
      }
      start = false
    }
    out += trail
    if (trail !== '') start = false
  }
  return out
}

const escapeLinkText = (t: string): string => t.replace(/\]/g, '\\]')

// ---------------------------------------------------------------------------------------------------- blocks

interface Item {
  level: number
  ordered: boolean
  runs: Run[]
}

class Reader {
  readonly blocks: PasteBlock[] = []
  readonly seen = { images: false }
  private items: Item[] = []

  // ---- lists

  /** The marker of each item: as many signs as the lists above it of its kind, and one more (so no list takes the marker of another). */
  private markers(items: readonly Item[]): string[] {
    const out: string[] = []
    const stack: { level: number; ordered: boolean; marker: string }[] = []
    for (const it of items) {
      while (stack.length && stack[stack.length - 1]!.level > it.level) stack.pop()
      const top = stack[stack.length - 1]
      if (top && top.level === it.level && top.ordered !== it.ordered) stack.pop()
      const now = stack[stack.length - 1]
      if (!now || now.level !== it.level) {
        const n = stack.reduce((m, s) => (s.ordered === it.ordered ? Math.max(m, s.marker.length) : m), 0) + 1
        stack.push({ level: it.level, ordered: it.ordered, marker: (it.ordered ? '.' : '*').repeat(Math.min(n, 5)) })
      }
      out.push(stack[stack.length - 1]!.marker)
    }
    return out
  }

  /** The list that was being read is a block. */
  flushList(): void {
    if (this.items.length === 0) return
    const items = this.items
    this.items = []
    const markers = this.markers(items)
    const lines: string[] = []
    const texts: string[] = []
    const expect: { kind: string; text: string | null }[] = []
    items.forEach((it, k) => {
      const runs = tidy(it.runs, true)
      const line = renderRuns(runs, '', '')
      if (line === '') return
      lines.push(`${markers[k]!} ${line}`)
      texts.push(plainText(runs))
      expect.push({ kind: 'item', text: plainText(runs) })
    })
    if (lines.length === 0) return
    this.blocks.push({ kind: 'list', source: lines.join('\n'), text: texts.join('\n'), expect })
  }

  addItem(level: number, ordered: boolean, runs: Run[]): void {
    this.items.push({ level: Math.max(1, Math.min(level, 5)), ordered, runs })
  }

  private list(el: Element, level: number): void {
    const ordered = el.tagName === 'OL'
    for (const li of Array.from(el.children)) {
      if (li.tagName === 'UL' || li.tagName === 'OL') {
        this.list(li, level + 1)
        continue
      }
      if (li.tagName !== 'LI') continue
      const runs: Run[] = []
      const nested: Element[] = []
      const gather = (node: Node, look: Look): void => {
        for (const child of Array.from(node.childNodes)) {
          if (child.nodeType === 3) {
            const text = collapse(child.textContent ?? '')
            if (text !== '') runs.push({ ...look, text })
          } else if (child.nodeType === 1) {
            const e = child as Element
            if (SKIP.has(e.tagName) || e.tagName === 'INPUT') continue
            if (e.tagName === 'UL' || e.tagName === 'OL') nested.push(e)
            else if (e.tagName === 'BR') runs.push({ ...look, text: '', br: true })
            else if (e.tagName === 'IMG') this.seen.images = true
            else {
              const block = BLOCKS.has(e.tagName)
              if (block) runs.push({ ...look, text: ' ' })
              gather(e, lookOf(e, look))
              if (block) runs.push({ ...look, text: ' ' })
            }
          }
        }
      }
      gather(li, lookOf(li, PLAIN))
      this.addItem(level, ordered, runs)
      for (const n of nested) this.list(n, level + 1)
    }
  }

  // ---- blocks

  private paragraph(runsIn: Run[]): void {
    const edge = {
      lead: runsIn.find((r) => r.text !== '' || r.br)?.text.startsWith(' ') ?? false,
      trail: [...runsIn].reverse().find((r) => r.text !== '' || r.br)?.text.endsWith(' ') ?? false,
    }
    const runs = tidy(runsIn)
    if (runs.length === 0) return
    this.flushList()
    const source = renderRuns(runs)
    const text = plainText(runs)
    this.blocks.push({ kind: 'paragraph', source, text, runs, edge, expect: [{ kind: 'paragraph', text }] })
  }

  private section(level: number, runsIn: Run[]): void {
    const runs = tidy(runsIn, true)
    if (runs.length === 0) return
    this.flushList()
    const title = renderRuns(runs)
    this.blocks.push({
      kind: 'section',
      source: `${'='.repeat(level)} ${title}`,
      text: plainText(runs),
      expect: [{ kind: 'heading', text: plainText(runs) }],
    })
  }

  private code(text: string): void {
    this.flushList()
    const lines = text.replace(/\r\n|\r/g, '\n').replace(/^\n+|\n+$/g, '').split('\n')
    if (lines.every((l) => l.trim() === '')) return
    let n = 4
    while (lines.some((l) => l === '-'.repeat(n))) n++
    const d = '-'.repeat(n)
    this.blocks.push({ kind: 'code', source: [d, ...lines, d].join('\n'), text: lines.join('\n'), expect: [{ kind: 'code', text: null }] })
  }

  private table(el: Element): void {
    this.flushList()
    const rows: { cells: { runs: Run[]; head: boolean }[] }[] = []
    const trs = Array.from(el.querySelectorAll('tr')).filter((tr) => tr.closest('table') === el)
    const carried: number[] = [] // (the rest of the rows a cell of an earlier row spans, by column)
    for (const tr of trs) {
      const cells: { runs: Run[]; head: boolean }[] = []
      let col = 0
      const fill = (): void => {
        while ((carried[col] ?? 0) > 0) {
          carried[col]!--
          cells.push({ runs: [], head: false })
          col++
        }
      }
      for (const c of Array.from(tr.children)) {
        if (c.tagName !== 'TD' && c.tagName !== 'TH') continue
        fill()
        const runs: Run[] = []
        collect(c, lookOf(c, PLAIN), runs, this.seen)
        const span = Math.max(1, Math.min(parseInt(c.getAttribute('colspan') ?? '1', 10) || 1, 20))
        const down = Math.max(1, Math.min(parseInt(c.getAttribute('rowspan') ?? '1', 10) || 1, 20))
        const head = c.tagName === 'TH'
        cells.push({ runs, head })
        for (let k = 1; k < span; k++) cells.push({ runs: [], head })
        for (let k = 0; k < span; k++) carried[col + k] = down - 1
        col += span
      }
      fill()
      if (cells.length) rows.push({ cells })
    }
    if (rows.length === 0) return
    const width = Math.max(...rows.map((r) => r.cells.length))
    if (width === 0) return
    const head = rows[0]!.cells.every((c) => c.head)
    const lines: string[] = []
    const texts: string[] = []
    rows.forEach((r, k) => {
      const cells = r.cells.map((c) => {
        const runs = tidy(c.runs, true)
        texts.push(plainText(runs))
        return renderRuns(runs).replace(/\|/g, '\\|')
      })
      while (cells.length < width) cells.push('')
      lines.push('|' + cells.join(' |'))
      if (head && k === 0 && rows.length > 1) lines.push('')
    })
    const attrs = [...(head ? ['%header'] : []), `cols="${width}"`]
    this.blocks.push({
      kind: 'table',
      source: [`[${attrs.join(',')}]`, '|===', ...lines, '|==='].join('\n'),
      text: texts.filter((t) => t !== '').join('\n'),
      expect: [{ kind: 'table', text: null }],
    })
  }

  /** An item of a list of Word: a paragraph with `mso-list:l0 level2 lfo1` and the sign of the item in a span that Word marks with `mso-list:Ignore`. */
  private wordItem(el: Element, level: number): void {
    const runs: Run[] = []
    let sign = ''
    let signFont = ''
    const walk = (node: Node, look: Look): void => {
      for (const child of Array.from(node.childNodes)) {
        if (child.nodeType === 3) {
          const text = collapse(child.textContent ?? '')
          if (text !== '') runs.push({ ...look, text })
        } else if (child.nodeType === 1) {
          const e = child as Element
          if (SKIP.has(e.tagName)) continue
          const ignore = styleValue(e, 'mso-list')
          if (ignore === 'ignore') {
            sign = (e.textContent ?? '').replace(/[\u00a0\s]+/g, '')
            signFont = (e.getAttribute('style') ?? '') + (e.querySelector('[style*="Symbol"],[style*="Wingdings"]') ? 'symbol' : '')
            continue
          }
          if (e.tagName === 'BR') runs.push({ ...look, text: '', br: true })
          else if (e.tagName === 'IMG') this.seen.images = true
          else walk(e, lookOf(e, look))
        }
      }
    }
    walk(el, lookOf(el, PLAIN))
    const symbol = /symbol|wingdings/i.test(signFont)
    const ordered = !symbol && (/^\(?\d+[.)]?$/.test(sign) || /^\(?[a-z]+[.)]$/i.test(sign))
    this.addItem(level, ordered, runs)
  }

  /** The inline content between blocks is one paragraph, up to the next block. */
  private pending: Run[] = []

  finish(): void {
    this.flushPending()
    this.flushList()
  }

  private flushPending(): void {
    const runs = this.pending
    this.pending = []
    this.paragraph(runs)
  }

  walk(node: Node, look: Look): void {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 3) {
        const text = collapse(child.textContent ?? '')
        if (text !== '') this.pending.push({ ...look, text })
        continue
      }
      if (child.nodeType !== 1) continue
      const el = child as Element
      const tag = el.tagName
      if (SKIP.has(tag)) continue
      if (tag === 'IMG') {
        this.seen.images = true
        continue
      }
      if (tag === 'BR') {
        this.pending.push({ ...look, text: '', br: true })
        continue
      }
      const next = lookOf(el, look)
      const block = BLOCKS.has(tag) || hasBlock(el)
      if (!block) {
        collect(el, next, this.pending, this.seen)
        continue
      }
      this.flushPending()
      if (tag === 'UL' || tag === 'OL') {
        this.flushList()
        this.list(el, 1)
        this.flushList()
        continue
      }
      const word = /(?:^|;)\s*mso-list\s*:\s*l\d+\s+level(\d+)/i.exec(el.getAttribute('style') ?? '')
      if (word && (tag === 'P' || tag === 'DIV')) {
        this.wordItem(el, parseInt(word[1]!, 10))
        continue
      }
      this.flushList()
      if (/^H[1-6]$/.test(tag)) {
        const runs: Run[] = []
        collect(el, next, runs, this.seen)
        this.section(Math.max(2, Number(tag[1])), runs)
      } else if (tag === 'TABLE') this.table(el)
      else if (tag === 'PRE') this.code(el.textContent ?? '')
      else if (tag === 'HR') continue
      else if (hasBlock(el) || tag === 'BODY' || tag === 'HTML') {
        this.walk(el, next)
        this.flushPending()
        this.flushList()
      } else {
        const runs: Run[] = []
        collect(el, next, runs, this.seen)
        this.paragraph(runs)
      }
    }
  }
}

/** The blocks as the text of a fragment: blank lines between them (a comment between two lists, which would be one list otherwise). */
export function fragmentSource(blocks: readonly PasteBlock[]): string {
  let out = ''
  blocks.forEach((b, k) => {
    if (k > 0) out += blocks[k - 1]!.kind === 'list' && b.kind === 'list' ? '\n\n//\n\n' : '\n\n'
    out += b.source
  })
  return out
}

/** The text of the blocks as plain text, a line for each. */
export const plainOfBlocks = (blocks: readonly PasteBlock[]): string => blocks.map((b) => b.text).join('\n')

const squash = (s: string): string => s.replace(/\s+/g, '')

/** The source read by nota: the items it has are the ones the blocks mean, with the text they came from. */
export function readsAsMeant(blocks: readonly PasteBlock[]): boolean {
  if (blocks.length === 0) return true
  const doc = parse(fragmentSource(blocks) + '\n')
  if (doc.diagnostics.some((d) => d.severity === 'error')) return false
  const items = layoutItems(readLayout(doc)).filter((i) => i.kind !== 'empty')
  const meant = blocks.flatMap((b, k) => [...(k > 0 && blocks[k - 1]!.kind === 'list' && b.kind === 'list' ? [{ kind: 'comment', text: null }] : []), ...b.expect])
  const real = items.filter((i) => i.block!.label !== 'LineComment' && !(i.kind === 'chip' && /^\/\//.test(doc.text.slice(i.from, i.to))))
  const wanted = meant.filter((m) => m.kind !== 'comment')
  if (real.length !== wanted.length) return false
  for (let k = 0; k < real.length; k++) {
    const it = real[k]!
    const m = wanted[k]!
    if (it.kind !== m.kind) return false
    if (m.text !== null) {
      const c = it.block!.content!
      const cells = readInline(doc, c.from, c.to).cells
      if (squash(cells.map((x) => x.ch).join('')) !== squash(m.text)) return false
    }
  }
  return true
}

/** Reads the HTML of the clipboard. */
export function convertHtml(html: string): Pasted {
  const dom = new DOMParser().parseFromString(html, 'text/html')
  const reader = new Reader()
  reader.walk(dom.body, PLAIN)
  reader.finish()
  return { blocks: reader.blocks, images: reader.seen.images, verified: readsAsMeant(reader.blocks) }
}
