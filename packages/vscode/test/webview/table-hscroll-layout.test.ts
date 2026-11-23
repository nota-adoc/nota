// the scroll bar of a table wider than its frame. Measured in a real Chrome (jsdom has no layout) on the real bundle of the tab and its real
// style sheet, as `colresize-layout.test.ts` does: the document is opened, scrolled through `.scroll.scrollTop`, and the page reports the rectangles.
// The design (variant А): while the bottom of the table is below the window, the bar is at the very bottom edge of the tab (15 px: a line, a gap, the
// track, a gap; the side lines of the frame reach it); when the bottom is in the window, the bar is right under the table. One bar per table, none in
// a nested table. Tables are made up (the structure of a file with a table of 5 columns and tables in a cell, no real data). Windows of 1000 and
// 390 px in a light and in a dark theme. The numbers are printed with `NOTA_REPORT=1`. Skipped where Chrome is not installed.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { withChrome } from './chrome.js'
import { chromeFrameHeight } from './chrome-dump.js'
import { tabBundle } from './bundle.js'

const CHROME = [process.env.CHROME_BIN ?? '', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => p && existsSync(p))
const here = import.meta.dirname
const at = (path: string): string => join(here, path)

// ---------------------------------------------------------------- the files (made up)

const row = (cells: string[]): string => cells.join('\n') + '\n\n'
const WORDS = ['Заявление', 'Маршрут', 'Каталог', 'Склады', 'Остаток', 'Комплектность', 'Комментарий', 'Статус', 'Ответственный']
const intro = Array.from({ length: 16 }, (_, i) => `Вводный абзац ${i}: текст перед таблицей, чтобы до неё можно было доехать.\n\n`).join('')
const outro = Array.from({ length: 12 }, (_, i) => `Хвостовой абзац ${i} после таблицы.\n\n`).join('')

/** The tall table of 5 columns with tables in a cell: the structure of a real file (rowspans, a list of two levels, a nested table with a long name without spaces). */
/** An attribute name without spaces, as the tables of the interfaces have (it holds a column wide). */
const tok = (b: number, k: number): string => `demo.attr.${b}.${k}`
function nested(): string {
  const DN = 'CN=Console-Operators-Region-Alpha-Department-Of-Item-Handling,OU=Console,OU=Groups,DC=corp,DC=example'
  // (16 columns: 5 of the file and 11 more; a column is not narrower than 64 px, so 5 or 9 columns never make a table wider than a tab of 1000 px)
  const cells = (b: number, k: number): string[] => Array.from({ length: 15 }, (_, j) => (j < 4 ? `|${tok(b, k + j)}` : `|${b}.${k}.${j}`))
  let t = `= Тест\n\n${intro}[%header,cols="16"]\n|===\n` + row(['|Атрибут', '|Описание', '|Роль', '|Источник', '|Комментарий', ...Array.from({ length: 11 }, (_, i) => `|К${i + 6}`)])
  for (let b = 0; b < 12; b++) {
    // (a block of 5 rows: the first cell spans 5 rows in an even block; 2 rows and then 3 rows in an odd one)
    t += row([b % 2 === 0 ? `.5+|Группа ${b}` : `.2+|Подгруппа ${b}`, ...cells(b, 0)])
    for (let k = 1; k < 5; k++) {
      if (b % 2 === 1 && k === 2) t += row([`.3+|Подгруппа ${b}.2`, ...cells(b, k)])
      else if (b === 0 && k === 1) {
        t += row([
          `a|\n. Первый уровень\n.. Второй уровень А\n.. Второй уровень Б\n. Ещё пункт\n\n[cols="3"]\n!===\n3+!Параметры упаковки demo.pack по видам\n\n` +
            `a!* пункт 1\n* пункт 2\n!Роль А\n!${DN}\n\na!* пункт 3\n!Роль Б\na!* пункт 4\n* пункт 5\n\n!===\n\n[%header,cols="2"]\n!===\n!Поле !Значение\n` +
            Array.from({ length: 16 }, (_, i) => `!поле ${i}\n!значение ${i}\n`).join('\n') +
            '\n!===\n',
          ...cells(b, 5).slice(1),
        ])
      } else t += row(cells(b, k))
    }
  }
  return t + '|===\n\n' + outro
}
/** A tall table of 16 columns without percents, a long head (made up). */
function big(rows: number): string {
  const head = [...WORDS.map((w, k) => `|${w} складов по реестру ${k + 1}`), ...Array.from({ length: 7 }, (_, i) => `|Поле ${i + 10}`)]
  let t = `= Тест\n\n${intro}[%header,cols="16"]\n|===\n` + row(head)
  for (let r = 0; r < rows; r++) t += row(head.map((_, k) => `|${WORDS[k % 9]} ${r}-${k} значение`))
  return t + '|===\n\n' + outro
}
/** A low table of 16 columns with short cells: it is not as high as the window and is wider than its frame. */
function low(): string {
  const cols = Array.from({ length: 16 }, (_, k) => k)
  let t = `= Тест\n\n${intro}[%header,cols="16"]\n|===\n` + row(cols.map((k) => `|Поле ${k}`))
  for (let r = 0; r < 4; r++) t += row(cols.map((k) => `|${r}.${k}`))
  return t + '|===\n\n' + outro
}
/** A table of 9 columns with a short head: it fits a tab of 1000 px and does not fit 390 px. */
function small(): string {
  let t = `= Тест\n\n${intro}[%header,cols="9"]\n|===\n` + row(['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9'].map((c) => `|${c}`))
  for (let r = 0; r < 10; r++) t += row(['а', 'б', 'в', 'г', 'д', 'е', 'ж', 'з', 'и'].map((c) => `|${c}`))
  return t + '|===\n\n' + outro
}
function narrow(): string {
  let t = `= Тест\n\n${intro}[%header,cols="3"]\n|===\n` + row(['|A', '|B', '|C'])
  for (let r = 0; r < 6; r++) t += row([`|Ячейка ${r}-0`, `|Ячейка ${r}-1`, `|Ячейка ${r}-2`])
  return t + '|===\n\n' + outro
}

type Id = 't1' | 't2' | 't3' | 't4' | 't5'
const FILES: Record<Id, () => string> = { t1: nested, t2: () => big(70), t3: low, t4: narrow, t5: small }
const TALL: Id[] = ['t1', 't2']
type Theme = 'dark' | 'light'
interface Job { id: Id; width: number; theme: Theme }

// ---------------------------------------------------------------- the page

const runner = (job: Job, text: string): string => `
const JOB = ${JSON.stringify(job)}, TEXT = ${JSON.stringify(text)}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const rc = (e) => { const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, h: r.height, w: r.width } }
const open = async () => {
  window.postMessage({ type: 'init', text: TEXT, version: 1, fileName: 'a.adoc', locale: 'ru', outlineView: 'capsule', fileDir: '/tmp', mode: 'visual' }, '*')
  await sleep(300)
  for (let i = 0; i < 50 && !document.querySelector('.tbl td'); i++) await sleep(100)
  await sleep(600)
}
const frames = () => sleep(300)
const scroller = () => document.querySelector('.scroll')
const outer = () => [...document.querySelectorAll('.tbl')].filter((t) => !t.parentElement.closest('.tbl'))[0]
const parts = () => { const tbl = outer(); return { tbl, frame: tbl.querySelector(':scope > .tbl-scroll'), bar: tbl.querySelector(':scope > .tbl-bar'), table: tbl.querySelector(':scope > .tbl-scroll > table') } }
const shown = (e) => !!e && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().height > 0
/** px that the bottom of the table is above the bottom of the scroll (positive: the table ends in the window) */
const place = async (pos) => {
  const sc = scroller(), { tbl } = parts()
  const sr = rc(sc), tr = rc(tbl)
  let dy
  if (pos === 'top') dy = tr.top - (sr.top + sr.h / 3)
  else if (pos === 'middle') dy = tr.top + tr.h / 2 - (sr.top + sr.h / 2)
  else dy = tr.bottom - (sr.bottom - 150)
  sc.scrollTop += dy
  await frames()
}
const measure = (pos) => {
  const sc = scroller(), { tbl, frame, bar, table } = parts()
  const s = rc(sc), f = rc(frame), t = rc(tbl)
  const sBottom = sc.getBoundingClientRect().top + sc.clientTop + sc.clientHeight
  const rows = [...table.querySelectorAll(':scope > tbody > tr')]
  const lastRow = rows.length ? rc(rows[rows.length - 1]) : null
  const wide = frame.scrollWidth > frame.clientWidth + 1
  const hasBar = tbl.classList.contains('has-bar')
  const barShown = shown(bar)
  const b = bar && barShown ? rc(bar) : null
  const mid = b ? document.elementFromPoint((b.left + b.right) / 2, (b.top + b.bottom) / 2) : null
  const nestedFrames = [...tbl.querySelectorAll('td .tbl-scroll')].map((nf) => {
    const td = nf.closest('td'), r = rc(nf), c = rc(td), nt = nf.closest('.tbl')
    return { sw: nf.scrollWidth, cw: nf.clientWidth, inside: r.left >= c.left - 1 && r.right <= c.right + 1, hasBar: nt.classList.contains('has-bar'), barShown: shown(nt.querySelector(':scope > .tbl-bar')) }
  })
  const next = tbl.nextElementSibling ? rc(tbl.nextElementSibling) : null
  return {
    pos, sTop: s.top, sBottom, sw: frame.scrollWidth, cw: frame.clientWidth, wide, hasBar, stuck: tbl.classList.contains('bar-stuck'), barShown,
    // (the native bar of the frame: shown when the frame scrolls and \`has-bar\` is off)
    nativeShown: wide && !hasBar, count: (barShown ? 1 : 0) + (wide && !hasBar ? 1 : 0),
    bar: b, frame: f, tbl: t, tblTop: t.top, tblBottom: t.bottom, lastRowBottom: lastRow ? lastRow.bottom : null, hit: mid ? (mid === bar ? 'bar' : mid.tagName + '.' + mid.className) : null,
    barAria: bar ? bar.getAttribute('aria-label') : null, barBorder: bar ? getComputedStyle(bar).borderLeftWidth + '/' + getComputedStyle(bar).borderTopWidth + '/' + getComputedStyle(bar).borderBottomWidth : null,
    nested: nestedFrames, gapNext: next ? next.top - f.bottom : null, scrollLeft: frame.scrollLeft,
    barRange: bar ? bar.scrollWidth - bar.clientWidth : null, frameRange: frame.scrollWidth - frame.clientWidth, barLeft: bar ? bar.scrollLeft : null,
    vw: innerWidth, vh: innerHeight, scrollerH: sc.clientHeight,
  }
}
const drag = async (bar, to) => { bar.dispatchEvent(new Event('pointerdown')); bar.scrollLeft = to; bar.dispatchEvent(new Event('scroll')); await sleep(450) }
const run = async () => {
  const out = { job: JOB, pos: {} }
  await open()
  const { tbl, frame } = parts()
  out.nestedCount = tbl.querySelectorAll('.tbl').length
  { let e = tbl.parentElement; while (e && !['auto', 'scroll'].includes(getComputedStyle(e).overflowY)) e = e.parentElement; out.scrollerCls = e ? e.className : null }
  out.nestedInfo = [...tbl.querySelectorAll('td .tbl')].map((t) => t.querySelectorAll('tr').length + 'r/' + t.querySelectorAll('tr:first-child > *').length + 'c')
  out.rows = frame.querySelectorAll(':scope > table > tbody > tr').length
  out.initial = measure('initial')
  for (const pos of ['top', 'middle', 'bottom']) { await place(pos); out.pos[pos] = measure(pos) }
  const tall = ${JSON.stringify(TALL.includes(job.id))}
  if (tall) {
    // (a row ends under the bar; the document goes 20 px down: the row is over the bar, whole)
    await place('middle')
    const sc = scroller(), { table, bar } = parts()
    const rows = [...table.querySelectorAll(':scope > tbody > tr')]
    const sBottom = sc.getBoundingClientRect().top + sc.clientHeight
    const pick = rows.find((r) => rc(r).bottom > sBottom - 200 && rc(r).bottom < sBottom + 200 && rc(r).h < 400)
    if (pick) {
      sc.scrollTop += rc(pick).bottom - (sBottom - 7)
      await frames()
      const before = { row: rc(pick), bar: rc(bar) }
      sc.scrollTop += 20
      await frames()
      out.under = { before, row: rc(pick), bar: rc(bar), sTop: sc.getBoundingClientRect().top }
    }
    // (the bar is dragged to its end)
    await place('middle')
    const p2 = parts()
    const frame2 = p2.frame, bar2 = p2.bar
    await drag(bar2, bar2.scrollWidth)
    const head = [...p2.table.querySelectorAll(':scope > thead > tr:first-child > th, :scope > tbody > tr:first-child > th')]
    const last = head.length ? head[head.length - 1] : [...p2.table.querySelectorAll('tr:first-child > *')].pop()
    const fr = rc(frame2)
    out.end = { sl: frame2.scrollLeft, max: frame2.scrollWidth - frame2.clientWidth, lastRight: rc(last).right, frameRight: fr.right, innerRight: fr.right - 1, vw: innerWidth, barLeft: bar2.scrollLeft, nested: measure('end').nested }
    // (the frame goes 300 px, the bar follows; the bar is dragged, the frame follows; the document goes up and down, the frame stays)
    frame2.scrollLeft = 0
    await sleep(200)
    frame2.scrollLeft = 300
    await frames()
    const k5 = { frame: frame2.scrollLeft, bar: bar2.scrollLeft }
    await drag(bar2, 120)
    const k5b = { frame: frame2.scrollLeft, bar: bar2.scrollLeft }
    const sl = frame2.scrollLeft
    scroller().scrollTop += 300
    await frames()
    scroller().scrollTop -= 500
    await frames()
    out.k5 = { a: k5, b: k5b, sl, after: frame2.scrollLeft, barRange: bar2.scrollWidth - bar2.clientWidth, frameRange: frame2.scrollWidth - frame2.clientWidth }
  }
  if (JOB.id === 't5') {
    // (the width of the tab 1000 → 390 → 1000: the bar comes and goes with the scroll of the frame)
    out.steps = []
    const app = document.getElementById('app')
    for (const w of [JOB.width, 390, 1000, 390]) {
      app.style.width = w + 'px'
      await sleep(700)
      await place('middle')
      out.steps.push({ w, m: measure('middle') })
    }
  }
  document.title = 'RES ' + JSON.stringify(out)
}
run().catch((e) => { document.title = 'RES ' + JSON.stringify({ error: String(e && e.stack || e) }) })
`

interface Rect { top: number; bottom: number; left: number; right: number; h: number; w: number }
interface M {
  pos: string
  sTop: number
  sBottom: number
  sw: number
  cw: number
  wide: boolean
  hasBar: boolean
  stuck: boolean
  barShown: boolean
  nativeShown: boolean
  count: number
  bar: Rect | null
  frame: Rect
  tbl: Rect
  lastRowBottom: number | null
  hit: string | null
  barAria: string | null
  barBorder: string | null
  nested: { sw: number; cw: number; inside: boolean; hasBar: boolean; barShown: boolean }[]
  gapNext: number | null
  scrollLeft: number
  barRange: number | null
  frameRange: number
  barLeft: number | null
  vw: number
  vh: number
  scrollerH: number
}
interface Out {
  job: Job
  error?: string
  nestedCount: number
  scrollerCls?: string | null
  nestedInfo?: string[]
  rows: number
  initial: M
  pos: Record<'top' | 'middle' | 'bottom', M>
  under?: { before: { row: Rect; bar: Rect }; row: Rect; bar: Rect; sTop: number }
  end?: { sl: number; max: number; lastRight: number; frameRight: number; innerRight: number; vw: number; barLeft: number; nested: M['nested'] }
  k5?: { a: { frame: number; bar: number }; b: { frame: number; bar: number }; sl: number; after: number; barRange: number; frameRange: number }
  steps?: { w: number; m: M }[]
}


const HEIGHT = 800

/**
 * The page runs in a real Chrome in real time (DevTools protocol over a WebSocket): scroll events, layout and the sticky of the bar need frames, and a
 * headless Chrome in virtual time (`--virtual-time-budget`) does not draw them. The title of the page tells when the run is over.
 */
async function runInChrome(url: string, width: number, height: number): Promise<string> {
  const args = ['--headless=new', '--disable-gpu', '--allow-file-access-from-files', '--remote-debugging-port=0', '--remote-allow-origins=*', `--window-size=${width},${height}`, 'about:blank']
  return withChrome({ chrome: CHROME!, prefix: 'hscroll', args, stderr: true, timeout: 180_000, timeoutMessage: 'the page did not report' }, async (chrome) => {
    const port = await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => (clearInterval(poll), reject(new Error('Chrome did not start: ' + chrome.err))), 30_000)
      const poll = setInterval(() => {
        const m = /ws:\/\/127\.0\.0\.1:(\d+)\//.exec(chrome.err)
        if (m) {
          clearTimeout(timer)
          clearInterval(poll)
          resolve(Number(m[1]))
        }
      }, 50)
      chrome.proc.on('exit', () => reject(new Error('Chrome exited: ' + chrome.err)))
    })
    const target = (await (await fetch(`http://127.0.0.1:${port}/json/new?${url}`, { method: 'PUT' })).json()) as { webSocketDebuggerUrl: string }
    const ws = new WebSocket(target.webSocketDebuggerUrl)
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve()
      ws.onerror = () => reject(new Error('no DevTools socket'))
    })
    let id = 0
    const pending = new Map<number, (v: { result?: { result?: { value?: unknown } } }) => void>()
    ws.onmessage = (e) => {
      const msg = JSON.parse(String(e.data)) as { id?: number; result?: { result?: { value?: unknown } } }
      if (msg.id !== undefined) pending.get(msg.id)?.(msg)
    }
    const title = async (): Promise<string> =>
      new Promise((resolve) => {
        const n = ++id
        pending.set(n, (m) => resolve(String(m.result?.result?.value ?? '')))
        ws.send(JSON.stringify({ id: n, method: 'Runtime.evaluate', params: { expression: 'document.title', returnByValue: true } }))
      })
    const until = Date.now() + 150_000
    for (;;) {
      const t = await title()
      if (t.startsWith('RES ')) {
        ws.close()
        return t
      }
      if (Date.now() > until) throw new Error('the page did not report')
      await new Promise((r) => setTimeout(r, 400))
    }
  })
}

async function pageFor(job: Job): Promise<Out> {
  const css = readFileSync(at('../../../react/src/style.css'), 'utf8') + '\n' + readFileSync(at('../../src/webview/style.css'), 'utf8')
  const dir = mkdtempSync(join(tmpdir(), 'nota-hscroll-'))
  try {
    writeFileSync(join(dir, 'webview.js'), await tabBundle())
    writeFileSync(join(dir, 'style.css'), css)
    // (a headless Chrome is not narrower than 500 px: the tab is the #app of the width asked; the height is the one of the window, as in VS Code)
    writeFileSync(
      join(dir, 'p.html'),
      `<!doctype html><html lang="ru"><head><meta charset="utf-8"><link rel="stylesheet" href="style.css"><style>html,body{height:100%;margin:0}#app{width:${job.width}px;height:100%}*,*::before,*::after{animation:none!important;transition:none!important}</style></head><body class="vscode-${job.theme}" data-nota-theme="${job.theme}"><div id="app" class="nota" data-mermaid=""></div>
<script>window.__msgs=[];window.acquireVsCodeApi=()=>({postMessage(m){window.__msgs.push(m)},getState:()=>null,setState(){}})</script>
<script src="webview.js"></script><script>${runner(job, FILES[job.id]())}</script></body></html>`,
    )
    const title = await runInChrome(`file://${join(dir, 'p.html')}`, Math.max(job.width, 500), HEIGHT + (await chromeFrameHeight(CHROME!)))
    const m = /^RES (.*)$/s.exec(title)
    if (!m) throw new Error('the page did not report')
    const out = JSON.parse(m[1]!) as Out
    if (out.error) throw new Error(out.error)
    return out
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const measured = new Map<string, Out | Error>()
const key = (j: Job): string => `${j.id}/${j.width}/${j.theme}`
async function measureJob(job: Job): Promise<void> {
  let out: Out | Error
  try {
    out = await pageFor(job).catch(() => pageFor(job))
  } catch (e) {
    out = e as Error
  }
  measured.set(key(job), out)
  if (process.env.NOTA_REPORT && !(out instanceof Error)) report(out)
}
const get = (id: Id, width: number, theme: Theme): Out => {
  const o = measured.get(key({ id, width, theme }))
  if (!o) throw new Error(`${id}/${width}/${theme} was not measured`)
  if (o instanceof Error) throw o
  return o
}

const n1 = (n: number | null | undefined): string => (n === null || n === undefined ? '-' : n.toFixed(1))
function report(o: Out): void {
  const lines = [`== ${key(o.job)}: rows=${o.rows} nested=${o.nestedCount} ${JSON.stringify(o.nestedInfo)} scroller=${o.scrollerCls} sw/cw=${o.pos.top.sw}/${o.pos.top.cw}`]
  for (const p of ['top', 'middle', 'bottom'] as const) {
    const m = o.pos[p]
    lines.push(
      `  ${p}: count=${m.count} has-bar=${m.hasBar} stuck=${m.stuck} bar=${m.bar ? `${n1(m.bar.top)}..${n1(m.bar.bottom)} x ${n1(m.bar.left)}..${n1(m.bar.right)}` : '-'} frame=${n1(m.frame.top)}..${n1(m.frame.bottom)} x ${n1(m.frame.left)}..${n1(m.frame.right)} sBottom=${n1(m.sBottom)} hit=${m.hit} border=${m.barBorder}`,
    )
  }
  if (o.under) lines.push(`  row ${n1(o.under.before.row.top)}..${n1(o.under.before.row.bottom)} under bar ${n1(o.under.before.bar.top)}..${n1(o.under.before.bar.bottom)}; +20px: row ..${n1(o.under.row.bottom)} bar top ${n1(o.under.bar.top)}`)
  if (o.end) lines.push(`  sl=${n1(o.end.sl)} max=${n1(o.end.max)} lastRight=${n1(o.end.lastRight)} innerRight=${n1(o.end.innerRight)}`)
  if (o.k5) lines.push(`  frame ${n1(o.k5.a.frame)} bar ${n1(o.k5.a.bar)}; drag: frame ${n1(o.k5.b.frame)} bar ${n1(o.k5.b.bar)}; after vertical ${n1(o.k5.after)} (was ${n1(o.k5.sl)}); ranges ${n1(o.k5.barRange)}/${n1(o.k5.frameRange)}`)
  if (o.steps) lines.push('  steps: ' + o.steps.map((s) => `${s.w}px: wide=${s.m.wide} bar=${s.m.barShown} native=${s.m.nativeShown} gap=${n1(s.m.gapNext)}`).join(' | '))
  console.log(lines.join('\n'))
}

// ---------------------------------------------------------------- the checks

const JOBS: Job[] = []
for (const width of [1000, 390]) {
  for (const theme of ['dark', 'light'] as const) for (const id of TALL) JOBS.push({ id, width, theme })
  JOBS.push({ id: 't3', width, theme: 'dark' }, { id: 't4', width, theme: 'dark' })
}
JOBS.push({ id: 't5', width: 1000, theme: 'dark' })
const ONLY = process.env.NOTA_ONLY
const jobs = ONLY ? JOBS.filter((j) => key(j).startsWith(ONLY)) : JOBS

const tallJobs = jobs.filter((j) => TALL.includes(j.id))
const POS = ['top', 'middle', 'bottom'] as const
const near = (a: number, b: number, d: number): boolean => Math.abs(a - b) <= d

describe.skipIf(!CHROME)('the horizontal scroll bar of a big table (real Chrome)', () => {
  beforeAll(async () => {
    for (const j of jobs) await measureJob(j)
  }, 1_500_000)

  it('the files are as the task says: the frame scrolls by 20 % or more, the table is higher than two windows, there are nested tables in T1', { timeout: 60_000 }, () => {
    for (const j of tallJobs) {
      const o = get(j.id, j.width, j.theme)
      const m = o.pos.top
      expect(m.sw, `${key(j)}: scrollWidth ${m.sw} of clientWidth ${m.cw}`).toBeGreaterThanOrEqual(m.cw * 1.2)
      expect(m.tbl.h, `${key(j)}: table ${m.tbl.h} px high, tab ${m.scrollerH} px`).toBeGreaterThan(2 * m.scrollerH)
      if (j.id === 't1') {
        expect(o.nestedCount, 'tables in the cell').toBeGreaterThanOrEqual(2)
        expect(o.rows, 'rows').toBeGreaterThanOrEqual(60)
      }
    }
  })

  it('the low table T3 is lower than the tab and wider than its frame', { timeout: 60_000 }, () => {
    for (const w of [1000, 390]) {
      const m = get('t3', w, 'dark').pos.top
      expect(m.tbl.h, `t3/${w}: table ${m.tbl.h} px high, tab ${m.scrollerH} px`).toBeLessThan(m.scrollerH / 2)
      expect(m.sw, `t3/${w}: scrollWidth ${m.sw} of clientWidth ${m.cw}`).toBeGreaterThanOrEqual(m.cw * 1.2)
    }
  })

  it('one element of the horizontal scroll per table, whatever the place; a nested table has a bar only inside its cell or none', { timeout: 60_000 }, () => {
    for (const j of tallJobs) {
      const o = get(j.id, j.width, j.theme)
      for (const p of POS) {
        const m = o.pos[p]
        expect(m.count, `${key(j)} ${p}: bar of the table ${m.barShown}, bar of the frame ${m.nativeShown}`).toBe(1)
        for (const n of m.nested) {
          expect(n.barShown, `${key(j)} ${p}: a nested table has no bar of its own`).toBe(false)
          expect(n.sw <= n.cw + 1 || n.inside, `${key(j)} ${p}: nested frame ${n.sw}/${n.cw} inside the cell ${n.inside}`).toBe(true)
        }
      }
    }
  })

  it('the bottom of the table is in the window: the bar is right under the frame, as wide as it, off every row; none at the edge of the window', { timeout: 60_000 }, () => {
    for (const j of tallJobs) {
      const m = get(j.id, j.width, j.theme).pos.bottom
      const where = `${key(j)} bottom: ${JSON.stringify({ bar: m.bar, frame: m.frame, stuck: m.stuck })}`
      expect(m.bar, where).not.toBeNull()
      const b = m.bar!
      expect(m.stuck, where).toBe(false)
      expect(b.top - m.frame.bottom, `${where}: gap`).toBeGreaterThanOrEqual(-1)
      expect(b.top - m.frame.bottom, `${where}: gap`).toBeLessThanOrEqual(4)
      expect(near(b.left, m.frame.left, 2) && near(b.right, m.frame.right, 2), `${where}: sides`).toBe(true)
      expect(b.top, `${where}: off the rows`).toBeGreaterThanOrEqual(m.lastRowBottom! - 1)
      expect(b.bottom, `${where}: not at the edge`).toBeLessThan(m.sBottom - 100)
    }
    const m3 = get('t3', 1000, 'dark').pos
    for (const w of [1000, 390]) {
      for (const p of POS) {
        const m = get('t3', w, 'dark').pos[p]
        if (!m.wide) continue
        const where = `t3/${w} ${p}: ${JSON.stringify({ bar: m.bar, frame: m.frame })}`
        expect(m.count, where).toBe(1)
        expect(m.bar, where).not.toBeNull()
        expect(m.bar!.top - m.frame.bottom, `${where}: gap`).toBeGreaterThanOrEqual(-1)
        expect(m.bar!.top - m.frame.bottom, `${where}: gap`).toBeLessThanOrEqual(4)
        expect(m.bar!.top, where).toBeGreaterThanOrEqual(m.lastRowBottom! - 1)
      }
    }
    expect(m3.top.wide || get('t3', 390, 'dark').pos.top.wide, 'T3 is wider than its frame in one of the windows').toBe(true)
  })

  it('the bottom of the table is below the window: the bar is at the very bottom edge, over nothing, with the side lines; the row under it is over it after 20 px', { timeout: 60_000 }, () => {
    for (const j of tallJobs) {
      const o = get(j.id, j.width, j.theme)
      for (const p of ['top', 'middle'] as const) {
        const m = o.pos[p]
        const where = `${key(j)} ${p}: ${JSON.stringify({ bar: m.bar, frame: m.frame, sBottom: m.sBottom, stuck: m.stuck, hit: m.hit })}`
        expect(m.bar, where).not.toBeNull()
        const b = m.bar!
        expect(m.stuck, where).toBe(true)
        expect(b.bottom, `${where}: in the window`).toBeLessThanOrEqual(m.sBottom + 0.5)
        expect(b.bottom, `${where}: at the very bottom`).toBeGreaterThanOrEqual(m.sBottom - 1)
        expect(b.top, `${where}: 15 px`).toBeGreaterThanOrEqual(m.sBottom - 16)
        expect(near(b.left, m.frame.left, 2) && near(b.right, m.frame.right, 2), `${where}: sides`).toBe(true)
        expect(m.hit, `${where}: the bar is on top`).toBe('bar')
        expect(m.barBorder, `${where}: the side lines, the top line (3 with the gap), the bottom gap`).toBe('1px/3px/2px')
      }
      const u = o.under
      expect(u, `${key(j)}: a row that ends under the bar`).toBeDefined()
      expect(u!.before.row.bottom, `${key(j)}: the row was under the bar`).toBeGreaterThan(u!.before.bar.top)
      expect(u!.row.bottom, `${key(j)}: the row is over the bar after 20 px (${u!.row.bottom} vs ${u!.bar.top})`).toBeLessThanOrEqual(u!.bar.top + 1)
      expect(u!.row.top, `${key(j)}: the row is whole`).toBeGreaterThanOrEqual(u!.sTop - 1)
    }
  })

  it('the bar has the name «Прокрутка таблицы по горизонтали»', { timeout: 60_000 }, () => {
    for (const j of tallJobs) expect(get(j.id, j.width, j.theme).pos.middle.barAria, key(j)).toBe('Прокрутка таблицы по горизонтали')
  })

  it('the bar dragged to its end: the frame is at its end, the last column is whole, the right border is in the tab, a nested table has no bar', { timeout: 60_000 }, () => {
    for (const j of tallJobs) {
      const e = get(j.id, j.width, j.theme).end!
      const where = `${key(j)}: ${JSON.stringify({ sl: e.sl, max: e.max, lastRight: e.lastRight, innerRight: e.innerRight })}`
      expect(Math.abs(e.sl - e.max), where).toBeLessThanOrEqual(1)
      expect(e.lastRight, `${where}: last column`).toBeGreaterThanOrEqual(e.innerRight - 2)
      expect(e.lastRight, `${where}: last column`).toBeLessThanOrEqual(e.innerRight + 1)
      expect(e.frameRight, `${where}: the border of the frame is in the tab`).toBeLessThanOrEqual(e.vw)
      for (const n of e.nested) expect(n.barShown, `${where}: nested bar`).toBe(false)
    }
  })

  it('the frame moves the bar, the bar moves the frame, the ranges are equal, the vertical scroll keeps the frame', { timeout: 60_000 }, () => {
    for (const j of tallJobs) {
      const k = get(j.id, j.width, j.theme).k5!
      const where = `${key(j)}: ${JSON.stringify(k)}`
      expect(Math.abs(k.a.bar - k.a.frame), `${where}: the frame to 300`).toBeLessThanOrEqual(1)
      expect(k.a.frame, where).toBeGreaterThan(200)
      expect(Math.abs(k.b.frame - k.b.bar), `${where}: the bar dragged`).toBeLessThanOrEqual(1)
      expect(Math.abs(k.b.frame - 120), `${where}: the bar dragged to 120`).toBeLessThanOrEqual(2)
      expect(Math.abs(k.barRange - k.frameRange), `${where}: ranges`).toBeLessThanOrEqual(1)
      expect(Math.abs(k.after - k.sl), `${where}: the document scrolled`).toBeLessThanOrEqual(1)
    }
  })

  it('the tab 1000 → 390 → 1000 → 390: the bar comes and goes with the scroll of the frame; the gap under a table that fits is 12 px', { timeout: 60_000 }, () => {
    const o = get('t5', 1000, 'dark')
    expect(o.steps!.map((s) => s.w)).toEqual([1000, 390, 1000, 390])
    for (const s of o.steps!) {
      const where = `t5 at ${s.w}: ${JSON.stringify({ wide: s.m.wide, bar: s.m.barShown, native: s.m.nativeShown, sw: s.m.sw, cw: s.m.cw })}`
      expect(s.m.barShown || s.m.nativeShown, where).toBe(s.m.wide)
      expect(s.m.count, where).toBe(s.m.wide ? 1 : 0)
      if (s.m.wide) expect(Math.abs(s.m.barRange! - s.m.frameRange), `${where}: ranges`).toBeLessThanOrEqual(1)
      else expect(s.m.gapNext!, `${where}: the gap under the table`).toBeGreaterThanOrEqual(11)
    }
    expect(o.steps![0]!.m.wide, 'at 1000 the table fits').toBe(false)
    expect(o.steps![1]!.m.wide, 'at 390 the table scrolls').toBe(true)
  })

  it('a table that fits has no bar and no empty strip: 12 px to the next block, as on main', { timeout: 60_000 }, () => {
    for (const w of [1000, 390]) {
      const o = get('t4', w, 'dark')
      for (const p of POS) {
        const m = o.pos[p]
        const where = `t4/${w} ${p}: ${JSON.stringify({ wide: m.wide, count: m.count, gap: m.gapNext })}`
        expect(m.wide, where).toBe(false)
        expect(m.count, where).toBe(0)
        expect(m.hasBar, where).toBe(false)
        expect(m.gapNext!, where).toBeGreaterThanOrEqual(11)
        expect(m.gapNext!, where).toBeLessThanOrEqual(13)
      }
    }
    const o = get('t5', 1000, 'dark')
    expect(o.steps![0]!.m.gapNext! - 12, 'the gap of a table that fits is the same as with a bar when the table fits').toBeLessThanOrEqual(1)
  })
})
