// the visible stroke of a grip of a table is 70 % of its column or row (not shorter than 24 px), in the middle; the whole column or row is still the place to
// hover and to click. Measured in a real Chrome (jsdom has no layout) on the real bundle of the tab and its real style sheet, in the light and the dark theme.
// Skipped where Chrome is not installed. `NOTA_REPORT=1` prints the numbers of the capsule (to take them on another branch), `NOTA_ONLY=<id>` runs one case.
import { existsSync, readFileSync } from 'node:fs'
import { type Server, createServer } from 'node:http'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { withChrome } from './chrome.js'
import { tabBundle } from './bundle.js'

const CHROME = [process.env.CHROME_BIN ?? '', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => p && existsSync(p))
const here = import.meta.dirname
const at = (path: string): string => join(here, path)

// ---------------------------------------------------------------- the tables (made up)

const row = (cells: string[]): string => cells.map((c) => `|${c}`).join(' ') + '\n'
function grid(cols: number, rows: number): string {
  let t = '= Тест\n\n|===\n'
  for (let r = 0; r < rows; r++) t += row(Array.from({ length: cols }, (_, k) => `Ячейка ${r}-${k}`)) + '\n'
  return t + '|===\n'
}
function wide(): string {
  let t = '= Тест\n\n[%header,cols="9"]\n|===\n'
  t += row(Array.from({ length: 9 }, (_, k) => `Заголовок колонки номер ${k + 1}`)) + '\n'
  for (let r = 0; r < 12; r++) t += row(Array.from({ length: 9 }, (_, k) => `Значение ячейки ${r}-${k} с длинным текстом`)) + '\n'
  return t + '|===\n'
}
const NESTED = '= Тест\n\n|===\n|Внешняя 1 |Внешняя 2\na|\n!===\n!x1 !y1\n!x2 !y2\n!x3 !y3\n!===\n|b2\n|===\n'

interface Case {
  id: string
  text: string
  /** The table (its number among the tables of the page) that is measured. */
  table: number
  /** The frame is scrolled sideways by this many px. */
  scrollFrame?: number
  /** The border `i` of the table is dragged this far left (the column before it goes to its least width). */
  narrow?: number
  /** A style sheet put on the page (the rows get low). */
  css?: string
  /** The capsules of these grips are measured: [kind, index]. */
  capsules?: [string, number][]
  /** The capsule over the selected columns 1–2. */
  selection?: boolean
}

const CASES: Case[] = [
  { id: 'T', text: grid(3, 3), table: 0, capsules: [['col', 1], ['row', 1]], selection: true },
  { id: 'wide', text: wide(), table: 0, scrollFrame: 200, capsules: [['col', 4]] },
  { id: 'nested', text: NESTED, table: 1 },
  { id: 'low', text: grid(3, 3), table: 0, css: '.doc .tbl td, .doc .tbl th { padding-top: 2px !important; padding-bottom: 2px !important }' },
  { id: 'low-nested', text: NESTED, table: 1, css: '.doc .tbl td, .doc .tbl th { padding-top: 2px !important; padding-bottom: 2px !important }' },
  { id: 'narrow', text: grid(3, 3), table: 0, narrow: 1 },
]
const casesFor = (): Case[] => (process.env.NOTA_ONLY ? CASES.filter((c) => c.id === process.env.NOTA_ONLY) : CASES)

// ---------------------------------------------------------------- the page

const runner = (c: Case): string => `
const C = ${JSON.stringify(c)}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const rc = (e) => { const r = e.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height } }
const move = (x, y) => document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: x, clientY: y, buttons: 0 }))
const centre = (r) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 })
const grips = () => document.querySelector('.nota-grips')
const tbl = () => document.querySelectorAll('.tbl')[C.table]
const sc = () => tbl().querySelector(':scope > .tbl-scroll')
const trs = () => [...sc().querySelectorAll(':scope > table > tbody > tr')]
const strips = (cls) => [...grips().querySelectorAll('.' + cls + '[data-t="' + [...document.querySelectorAll('.tbl')].indexOf(tbl()) + '"]')]
const hover = async () => { const f = rc(sc()); const td = [...trs()[0].children].find((c) => { const q = rc(c); return q.left >= f.left && q.right <= f.right }) || trs()[0].children[0]; const p = centre(rc(td)); move(p.x, p.y); await sleep(300) }
const px = (s) => parseFloat(s) || 0
/** The stroke of a strip: its length and where it stands (from the used style of ::after, as the page draws it). */
const stroke = (el, kind) => {
  const cs = getComputedStyle(el, '::after')
  const r = rc(el)
  if (kind === 'col') return { len: px(cs.width), thick: px(cs.height), centre: r.left + px(cs.marginLeft) + px(cs.width) / 2, offset: px(cs.bottom), bg: cs.backgroundColor, transform: cs.transform }
  return { len: px(cs.height), thick: px(cs.width), centre: r.top + px(cs.marginTop) + px(cs.height) / 2, offset: px(cs.right), bg: cs.backgroundColor, transform: cs.transform }
}
const colorOf = (v) => { const e = document.createElement('div'); e.style.background = v; grips().appendChild(e); const o = getComputedStyle(e).backgroundColor; e.remove(); return o }

const run = async () => {
  const out = { width: innerWidth, id: C.id, cols: [], rows: [], capsules: {} }
  window.postMessage({ type: 'init', text: C.text, version: 1, fileName: 'a.adoc', locale: 'ru', outlineView: 'capsule', fileDir: '/tmp', mode: 'visual' }, '*')
  if (C.css) { const st = document.createElement('style'); st.textContent = C.css; document.head.appendChild(st) }
  await sleep(300)
  for (let i = 0; i < 50 && !document.querySelector('.tbl td'); i++) await sleep(100)
  await sleep(600)
  if (C.scrollFrame) { sc().scrollLeft = C.scrollFrame; await sleep(200) }
  await hover()
  if (C.narrow) {
    const bd = grips().querySelector('.bd[data-border="' + C.narrow + '"]')
    const r = rc(bd), x0 = r.left + r.width / 2, y = r.top + 20
    bd.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: x0, clientY: y, button: 0, buttons: 1, detail: 1 }))
    for (const dx of [-100, -300, -800]) { document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: x0 + dx, clientY: y, buttons: 1 })); await sleep(40) }
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: x0 - 800, clientY: y }))
    await sleep(800)
    // (the host applies the edit and sends the text back: the page is opened again on the text that the drag made)
    let text = C.text
    for (const m of window.__msgs.filter((m) => m.type === 'edit')) for (const c of [...m.changes].sort((a, b) => b.from - a.from)) text = text.slice(0, c.from) + c.insert + text.slice(c.to)
    out.text1 = text
    window.postMessage({ type: 'init', text, version: 2, fileName: 'a.adoc', locale: 'ru', outlineView: 'capsule', fileDir: '/tmp', mode: 'visual' }, '*')
    await sleep(1000)
    await hover()
  }
  const frame = rc(sc())
  const inner = { left: frame.left + 1, right: frame.right - 1 }
  out.frame = frame
  const cells = [...trs()[0].children].map(rc)
  const rowsR = trs().map(rc)
  const band = rc(strips('cg')[0]).height
  out.band = band
  for (const s of strips('cg')) {
    const i = +s.dataset.i
    const cell = cells[i]
    const vis = { left: Math.max(cell.left, inner.left), right: Math.min(cell.right, inner.right) }
    out.cols.push({ i, cell: { left: cell.left, width: cell.width }, vis, strip: rc(s), stroke: stroke(s, 'col'), classes: s.className })
  }
  for (const s of strips('rg')) {
    const i = +s.dataset.i
    out.rows.push({ i, row: rowsR[i], strip: rc(s), stroke: stroke(s, 'row'), classes: s.className })
  }
  // the element at every pixel along the middle of the band over the columns, and left of the rows
  const mid = rc(strips('cg')[0]).top + band / 2
  const wrongCols = []
  let count = 0
  for (let x = Math.ceil(inner.left); x < Math.floor(inner.right); x++) {
    const el = document.elementFromPoint(x + 0.5, mid)
    count++
    const owners = cells.map((q, k) => [k, q]).filter(([, q]) => x + 0.5 >= q.left - 1 && x + 0.5 < q.right + 1).map(([k]) => String(k))
    if (!el || !el.classList.contains('cg') || !owners.includes(el.dataset.i)) wrongCols.push([x, el && el.className, el && el.dataset.i, owners])
  }
  out.colScan = { count, wrong: wrongCols.slice(0, 10), wrongN: wrongCols.length }
  const midX = rc(strips('rg')[0]).left + rc(strips('rg')[0]).width / 2
  const wrongRows = []
  out.rowH = rowsR.map((q) => q.height)
  let rcount = 0
  for (let y = Math.ceil(rowsR[0].top); y < Math.min(Math.floor(rowsR[rowsR.length - 1].bottom), innerHeight - 2); y++) {
    const el = document.elementFromPoint(midX, y + 0.5)
    rcount++
    const owners = rowsR.map((q, k) => [k, q]).filter(([, q]) => y + 0.5 >= q.top - 1 && y + 0.5 < q.bottom + 1).map(([k]) => String(k))
    if (!el || !el.classList.contains('rg') || !owners.includes(el.dataset.i)) wrongRows.push([y, el && el.className, el && el.dataset.i, owners])
  }
  out.rowScan = { count: rcount, wrong: wrongRows.slice(0, 10), wrongN: wrongRows.length }
  // the colours, the thickness and the offset at rest; the ones of a selected strip
  out.rest = { rule: colorOf('var(--ap-rule-strong)'), on: colorOf('var(--g-on)') }
  // the rules of the hovered stroke, as the page's style sheets have them
  out.hover = []
  for (const sh of document.styleSheets) for (const r of sh.cssRules) {
    if (r.selectorText && /\\.(cg|rg):hover::after/.test(r.selectorText) && /nota-grips/.test(r.selectorText)) {
      out.hover.push({ sel: r.selectorText, bg: r.style.getPropertyValue('background'), transform: r.style.getPropertyValue('transform'), origin: r.style.getPropertyValue('transform-origin') })
    }
  }
  const bd = grips().querySelector('.bd')
  if (bd) { const r = rc(bd); out.bd = { width: r.width, height: r.height, cursor: getComputedStyle(bd).cursor, inner: rc(sc()).height } }
  const bar = tbl().querySelector(':scope > .tbl-bar')
  out.tblBar = bar ? rc(bar).height : null
  // the capsule at the grips
  const gb = () => grips().querySelector('.gb:not([hidden])')
  for (const [kind, i] of C.capsules || []) {
    move(2, 2)
    await sleep(300)
    await hover()
    const s = grips().querySelector('[data-kind="' + kind + '"][data-i="' + i + '"]')
    if (!s) { out.capsules[kind + i] = null; continue }
    const p = centre(rc(s))
    move(p.x, p.y)
    await sleep(700)
    const b = gb()
    // (the strips are drawn again at the move: the one that is there now)
    const s2 = grips().querySelector('[data-kind="' + kind + '"][data-i="' + i + '"]') || s
    out.capsules[kind + i] = b ? { rect: rc(b), stroke: stroke(s2, kind), line: centre(rc(s2)) } : { none: true }
  }
  if (C.selection) {
    move(2, 2)
    await sleep(300)
    await hover()
    const a = grips().querySelector('.cg[data-i="0"]'), z = grips().querySelector('.cg[data-i="1"]')
    a.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: rc(a).left + 5, clientY: rc(a).top + 5, button: 0, buttons: 1 }))
    await sleep(200)
    const z2 = grips().querySelector('.cg[data-i="1"]')
    z2.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, shiftKey: true, clientX: rc(z2).left + 5, clientY: rc(z2).top + 5, button: 0, buttons: 1 }))
    await sleep(300)
    move(2, 2)
    await sleep(700)
    const bs = [...grips().querySelectorAll('.gb:not([hidden])')]
    out.selection = { bars: bs.length, rect: bs[0] ? rc(bs[0]) : null, on: [...grips().querySelectorAll('.cg.on')].map((e) => ({ i: e.dataset.i, centre: stroke(e, 'col').centre, len: stroke(e, 'col').len, bg: stroke(e, 'col').bg })) }
  }
  // a click over the outer tenth of a column selects that column
  move(2, 2)
  await sleep(300)
  await hover()
  const cell0 = cells[1] || cells[0]
  const k0 = cells.indexOf(cell0)
  const edge = Math.max(cell0.left, inner.left) + 0.03 * cell0.width + 1
  const target = document.elementFromPoint(edge, mid)
  out.edge = { cls: target && target.className, i: target && target.dataset.i, want: String(k0) }
  if (target && target.classList.contains('cg')) {
    target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: edge, clientY: mid, button: 0, buttons: 1 }))
    await sleep(300)
    out.edge.on = [...grips().querySelectorAll('.cg.on')].map((e) => e.dataset.i)
    move(2, 2)
    await sleep(300)
    await hover()
  }
  out.dbg = { text1: out.text1, msgs: window.__msgs.map((m) => m.type) }
  document.title = 'done'
  await fetch('/res', { method: 'POST', body: JSON.stringify(out) })
}
run().catch((e) => { fetch('/res', { method: 'POST', body: JSON.stringify({ error: String((e && e.stack) || e) }) }) })
`

interface Box {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}
interface Stroke {
  len: number
  thick: number
  centre: number
  offset: number
  bg: string
  transform: string
}
interface Scan {
  count: number
  wrong: unknown[]
  wrongN: number
}
interface Out {
  id: string
  width: number
  error?: string
  frame: Box
  band: number
  cols: { i: number; cell: { left: number; width: number }; vis: { left: number; right: number }; strip: Box; stroke: Stroke; classes: string }[]
  rows: { i: number; row: Box; strip: Box; stroke: Stroke; classes: string }[]
  colScan: Scan
  rowScan: Scan
  edge: { cls: string; i: string; want: string; on?: string[] }
  rest: { rule: string; on: string }
  hover: { sel: string; bg: string; transform: string; origin: string }[]
  bd?: { width: number; height: number; cursor: string; inner: number }
  tblBar: number | null
  capsules: Record<string, { rect: Box; stroke: Stroke; line: { x: number; y: number } } | { none: true } | null>
  selection?: { bars: number; rect: Box | null; on: { i: string; centre: number; len: number; bg: string }[] }
}


async function pageFor(width: number, theme: 'dark' | 'light', c: Case): Promise<Out> {
  const css = readFileSync(at('../../../react/src/style.css'), 'utf8') + '\n' + readFileSync(at('../../src/webview/style.css'), 'utf8')
  const body = theme === 'dark' ? 'class="vscode-dark" data-nota-theme="dark"' : 'class="vscode-light"'
  const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><link rel="stylesheet" href="/style.css"><style>html,body{margin:0;height:100%}#app{width:${width}px;height:100%}</style></head><body ${body}><div id="app" class="nota" data-mermaid=""></div>
<script>window.__msgs=[];window.acquireVsCodeApi=()=>({postMessage(m){window.__msgs.push(m)},getState:()=>null,setState(){}})</script>
<script src="/webview.js"></script><script src="/run.js"></script></body></html>`
  const files: Record<string, [string, string]> = {
    '/': [html, 'text/html'],
    '/style.css': [css, 'text/css'],
    '/webview.js': [await tabBundle(), 'text/javascript'],
    '/run.js': [runner(c), 'text/javascript'],
  }
  let server: Server | undefined
  try {
    let resolve!: (o: Out) => void
    let reject!: (e: Error) => void
    const result = new Promise<Out>((res, rej) => {
      resolve = res
      reject = rej
    })
    server = createServer((req, res) => {
      if (req.method === 'POST' && req.url === '/res') {
        const parts: Buffer[] = []
        req.on('data', (d: Buffer) => parts.push(d))
        req.on('end', () => {
          res.end('ok')
          const out = JSON.parse(Buffer.concat(parts).toString('utf8')) as Out
          if (out.error) reject(new Error(out.error))
          else resolve(out)
        })
        return
      }
      const f = files[req.url?.split('?')[0] ?? '']
      if (!f) {
        res.statusCode = 404
        res.end()
        return
      }
      res.setHeader('content-type', `${f[1]}; charset=utf-8`)
      res.end(f[0])
    })
    await new Promise<void>((ok) => server!.listen(0, '127.0.0.1', ok))
    const port = (server!.address() as { port: number }).port
    return await withChrome(
      {
        chrome: CHROME!,
        prefix: 'griplen',
        timeout: 120_000,
        timeoutMessage: 'the page did not report',
        args: ['--headless=new', '--disable-gpu', '--no-first-run', '--disable-renderer-backgrounding', '--disable-background-timer-throttling', `--window-size=${Math.max(width, 600)},900`, `http://127.0.0.1:${port}/`],
      },
      () => result,
    )
  } finally {
    server?.close()
  }
}

const measured = new Map<string, Out>()
async function measureAll(width: number, theme: 'dark' | 'light'): Promise<void> {
  for (const c of casesFor()) {
    // (a headless Chrome sometimes dies at the start: once more)
    const out = await pageFor(width, theme, c).catch(() => pageFor(width, theme, c))
    measured.set(`${width}/${theme}/${c.id}`, out)
    if (process.env.NOTA_REPORT) console.log(`== ${c.id} ${width} ${theme}\n` + JSON.stringify({ capsules: out.capsules, selection: out.selection }))
  }
}
const got = (width: number, theme: string, id: string): Out => {
  const o = measured.get(`${width}/${theme}/${id}`)
  if (!o) throw new Error(`case ${id} was not measured`)
  return o
}

const T = 1 // (px: the tolerance)
const near = (a: number, b: number, d = T): boolean => Math.abs(a - b) <= d
const want = (line: number, strip: number): number => Math.min(strip, Math.max(24, Math.round(0.7 * line)))

describe.skipIf(!CHROME)('the stroke of a grip is 70 % of its column or row (real Chrome)', () => {
  const runs: [number, 'dark' | 'light'][] = [
    [1280, 'light'],
    [1280, 'dark'],
    [390, 'light'],
  ]
  for (const [width, theme] of runs) {
    describe(`a tab of ${width} px, ${theme} theme`, () => {
      beforeAll(() => measureAll(width, theme), 600_000)

      it('the stroke of a column is 70 % of it, of a row 70 % (not under 24 px), in the middle; 3 px thick, 3 px from the frame', { timeout: 60_000 }, () => {
        for (const id of ['T', 'wide']) {
          const o = got(width, theme, id)
          expect(o.cols.length, `${id}: columns`).toBeGreaterThan(2)
          for (const c of o.cols) {
            const full = c.cell.left >= o.frame.left && c.cell.left + c.cell.width <= o.frame.right
            if (!full) continue
            expect(near(c.stroke.len, Math.round(0.7 * c.cell.width)), `${id} col ${c.i}: ${c.stroke.len} of ${c.cell.width}`).toBe(true)
            expect(near(c.stroke.centre, c.cell.left + c.cell.width / 2), `${id} col ${c.i}: the centre`).toBe(true)
            expect(c.stroke.thick, `${id} col ${c.i}: thickness`).toBe(3)
            expect(c.stroke.offset, `${id} col ${c.i}: offset`).toBe(3)
            expect(c.stroke.bg, `${id} col ${c.i}: colour at rest`).toBe(o.rest.rule)
          }
          for (const r of o.rows) {
            const h = r.row.height
            expect(near(r.stroke.len, Math.max(24, Math.round(0.7 * h))), `${id} row ${r.i}: ${r.stroke.len} of ${h}`).toBe(true)
            expect(near(r.stroke.centre, (r.row.top + r.row.bottom) / 2), `${id} row ${r.i}: the centre`).toBe(true)
            expect(r.stroke.thick, `${id} row ${r.i}: thickness`).toBe(3)
            expect(r.stroke.offset, `${id} row ${r.i}: offset`).toBe(3)
            expect(r.stroke.bg, `${id} row ${r.i}: colour at rest`).toBe(o.rest.rule)
          }
        }
        const t = got(width, theme, 'T')
        for (const c of t.cols) expect(c.cell.width, 'the columns of T are wider than 100 px or the tab is narrow').toBeGreaterThan(width < 500 ? 90 : 100)
      })

      it('a column narrowed to the least width has a stroke of 70 % (45–47 px); low rows (under 34 px), also in a nested table, 24 px; a column cut by the frame is cut with it, in the middle of the visible part', { timeout: 60_000 }, () => {
        const n = got(width, theme, 'narrow')
        // (the column before the dragged border goes to the least width, 64 px, which whole percents of the table make 67)
        const first = n.cols.find((c) => c.i === 0)!
        expect(first.cell.width, `the column was narrowed to ${first.cell.width}`).toBeLessThan(70)
        expect(first.cell.width).toBeGreaterThanOrEqual(63)
        expect(near(first.stroke.len, Math.round(0.7 * first.cell.width)), `a column of ${first.cell.width} px: ${first.stroke.len}`).toBe(true)
        expect(first.stroke.len, 'longer than the least stroke').toBeGreaterThan(24)
        for (const id of ['low', 'low-nested']) {
          const o = got(width, theme, id)
          const lows = o.rows.filter((r) => r.row.height < 34)
          expect(lows.length, `${id}: rows lower than 34 px (${o.rows.map((r) => r.row.height)})`).toBeGreaterThan(0)
          for (const r of lows) {
            expect(r.stroke.len, `${id} row ${r.i} (${r.row.height} px)`).toBe(24)
            expect(near(r.stroke.centre, (r.row.top + r.row.bottom) / 2), `${id} row ${r.i}: centre`).toBe(true)
          }
        }
        const nested = got(width, theme, 'nested')
        for (const r of nested.rows) {
          expect(r.stroke.len, `nested row ${r.i} (${r.row.height} px high)`).toBe(Math.max(24, Math.round(0.7 * r.row.height)))
          expect(near(r.stroke.centre, (r.row.top + r.row.bottom) / 2), `nested row ${r.i}: centre`).toBe(true)
        }
        const w = got(width, theme, 'wide')
        let cut = 0
        for (const c of w.cols) {
          const visW = c.vis.right - c.vis.left
          if (visW <= 0) continue
          if (visW < c.cell.width - 1) cut++
          expect(c.stroke.len, `wide col ${c.i}: not longer than the visible part`).toBeLessThanOrEqual(visW + T)
          expect(near(c.stroke.len, want(c.cell.width, visW)), `wide col ${c.i}: ${c.stroke.len}`).toBe(true)
          expect(near(c.stroke.centre, (c.vis.left + c.vis.right) / 2), `wide col ${c.i}: the centre of the visible part`).toBe(true)
        }
        expect(cut, 'the frame cuts a column').toBeGreaterThan(0)
      })

      it('every pixel along the strip of columns and of rows belongs to the strip of its own column and row; a click near the edge of a column selects it', { timeout: 60_000 }, () => {
        for (const id of ['T', 'wide', 'nested']) {
          const o = got(width, theme, id)
          expect(o.colScan.wrongN, `${id}: columns ${JSON.stringify(o.colScan.wrong)}`).toBe(0)
          expect(o.rowScan.wrongN, `${id}: rows ${JSON.stringify(o.rowScan.wrong)}`).toBe(0)
          expect(o.colScan.count).toBeGreaterThan(100)
        }
        const t = got(width, theme, 'T')
        expect(t.edge.cls).toContain('cg')
        expect(t.edge.i).toBe(t.edge.want)
        expect(t.edge.on).toEqual([t.edge.want])
      })

      it('the selected stroke is of the colour of a selection, and it is as short as the others; the borders and the bar of scrolling are as they were', { timeout: 60_000 }, () => {
        const o = got(width, theme, 'T')
        if (o.selection) {
          for (const s of o.selection.on) {
            expect(s.bg, 'the selected stroke').toBe(o.rest.on)
            const cell = o.cols.find((c) => String(c.i) === s.i)!
            expect(near(s.len, Math.round(0.7 * cell.cell.width))).toBe(true)
          }
        }
        // the hovered stroke: the colour of a selection at 60 %, 1.67 times thicker, growing from the frame
        const colHover = o.hover.find((h) => /\.cg:hover::after/.test(h.sel) && h.transform)
        const rowHover = o.hover.find((h) => /\.rg:hover::after/.test(h.sel) && h.transform)
        expect(o.hover.some((h) => /\.cg:hover::after/.test(h.sel) && /color-mix\(in srgb, var\(--g-on\) 60%, transparent\)/.test(h.bg)), 'cg hover colour').toBe(true)
        expect(o.hover.some((h) => /\.rg:hover::after/.test(h.sel) && /color-mix\(in srgb, var\(--g-on\) 60%, transparent\)/.test(h.bg)), 'rg hover colour').toBe(true)
        expect(colHover?.transform).toBe('scaleY(1.67)')
        expect(colHover?.origin).toMatch(/^(center )?bottom$/)
        expect(rowHover?.transform).toBe('scaleX(1.67)')
        expect(rowHover?.origin).toMatch(/^right( center)?$/)
        expect(o.bd?.width).toBe(10)
        expect(o.bd?.cursor).toBe('col-resize')
        expect(near(o.bd!.height, o.rows.at(-1)!.row.bottom - o.rows[0]!.row.top, 3)).toBe(true)
        const w = got(width, theme, 'wide')
        // (the bar is 10 px under the table and 15 px at the bottom edge of the window: a line, a gap, the track, a gap)
        expect([10, 15], 'the bar of scrolling of a wide table').toContain(w.tblBar)
      })

      if (width === 1280 && theme === 'light') {
        it('each capsule is centered on its stroke or selected group', { timeout: 60_000 }, () => {
          const cap = (o: Out, key: string): Box => {
            const c = o.capsules[key]
            expect(c && !('none' in c), `${o.id} ${key}: a capsule`).toBe(true)
            return (c as { rect: Box }).rect
          }
          const t = got(width, theme, 'T')
          const w = got(width, theme, 'wide')
          const col = t.capsules.col1 as { rect: Box; stroke: Stroke }
          const rowCap = t.capsules.row1 as { rect: Box; stroke: Stroke }
          const wideCap = w.capsules.col4 as { rect: Box; stroke: Stroke }
          expect(near((cap(t, 'col1').left + cap(t, 'col1').right) / 2, col.stroke.centre), 'col 2: the centre of the capsule and of the stroke').toBe(true)
          expect(near((cap(t, 'row1').top + cap(t, 'row1').bottom) / 2, rowCap.stroke.centre), 'row 2: the centre').toBe(true)
          expect(near((cap(w, 'col4').left + cap(w, 'col4').right) / 2, wideCap.stroke.centre), 'wide col 5: the centre').toBe(true)
          expect(col.rect.width, 'horizontal column capsule').toBeGreaterThan(col.rect.height)
          expect(near(wideCap.rect.width, col.rect.width) && near(wideCap.rect.height, col.rect.height), 'same column capsule size in both tables').toBe(true)
          expect(near(rowCap.rect.width, col.rect.height) && near(rowCap.rect.height, col.rect.width), 'row capsule uses the same dimensions vertically').toBe(true)
          const selection = t.selection
          expect(selection?.bars, 'one capsule over the selected columns').toBe(1)
          expect(selection?.on.map((c) => c.i)).toEqual(['0', '1'])
          const rect = selection!.rect!
          const centre = (selection!.on[0]!.centre + selection!.on[1]!.centre) / 2
          expect(near((rect.left + rect.right) / 2, centre), 'selected columns: the centre of the capsule').toBe(true)
          expect(near(rect.width, col.rect.width) && near(rect.height, col.rect.height), 'same column capsule size for a group').toBe(true)
        })
      }
    })
  }
})
