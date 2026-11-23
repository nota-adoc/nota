// the width of the page (`nota.pageWidth`) in a real Chrome (jsdom has no layout), on the real bundle of the tab, its real style sheet and the document
// `quality/fixtures/editor/sheet.adoc`: (the setting changes in an open tab: the text, the caret and the scroll stay), (the strips of rows, the capsule of a row,
// the handle of a block and the strokes of «Разделы» stand in the margin, left of the page), (the strip «Файл больше 1 МБ» is as wide as the page), (nothing
// lies on anything else in the «Лист», the light and the dark theme, 1600 and 500 px; the colours and the fonts do not depend on the width).
// Skipped where Chrome is not installed.
import { existsSync, readFileSync } from 'node:fs'
import { type Server, createServer } from 'node:http'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { CHROME_QUEUE_MS, holdChromeSlot } from './chrome.js'
import { withChrome } from './chrome.js'
import { tabBundle } from './bundle.js'

const CHROME = [process.env.CHROME_BIN ?? '', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => p && existsSync(p))
if (CHROME) beforeAll(() => holdChromeSlot(), CHROME_QUEUE_MS + 10_000)
const here = import.meta.dirname
const at = (path: string): string => join(here, path)
const SHEET = readFileSync(at('../../../../quality/fixtures/editor/sheet.adoc'), 'utf8')

interface Config { width: number; percent: number; theme: 'dark' | 'light'; change?: number; big?: boolean }

const runner = (cfg: Config): string => `
const CFG = ${JSON.stringify(cfg)}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const rc = (e) => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height } }
const q = (s) => document.querySelector(s)
const move = (x, y) => { const ev = new MouseEvent('mousemove', { bubbles: true, clientX: x, clientY: y, buttons: 0 }); const el = document.elementFromPoint(x, y); (el || document).dispatchEvent(ev) }
const centre = (r) => ({ x: r.l + r.w / 2, y: r.t + r.h / 2 })
const grips = () => q('.nota-grips')
const shown = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && !e.closest('[hidden]') }
const over = (a, b) => Math.min(a.r, b.r) - Math.max(a.l, b.l) > 0.5 && Math.min(a.b, b.b) - Math.max(a.t, b.t) > 0.5
const scroller = () => [...document.querySelectorAll('.ed-visual, .scroll')].find((e) => e.scrollHeight > e.clientHeight + 1) || q('.scroll')
const look = () => {
  const els = ['.ProseMirror h1', '.ProseMirror h2', '.ProseMirror p', '.ProseMirror li', '.ProseMirror td', '.ProseMirror code', '.ProseMirror .adm, .ProseMirror [class*=admon]']
  return els.map((s) => { const e = q(s); if (!e) return [s, null]; const c = getComputedStyle(e); return [s, [c.color, c.fontFamily, c.fontSize, c.fontWeight, c.backgroundColor].join('|')] })
}
const run = async () => {
  const out = { error: '' }
  window.postMessage({ type: 'init', text: ${JSON.stringify(SHEET)}, version: 1, fileName: 'a.adoc', locale: 'ru', outlineView: 'capsule', fileDir: '/tmp', mode: CFG.big ? 'text' : 'visual', pageWidth: CFG.percent, ...(CFG.big ? { big: { bytes: 1468006 } } : {}) }, '*')
  if (CFG.big) {
    await sleep(1200)
    const s = q('.big-strip')
    out.strip = s && shown(s) ? rc(s) : null; out.tab = rc(q('.nota'))
    await fetch('/res', { method: 'POST', body: JSON.stringify(out) }); return
  }
  for (let i = 0; i < 60 && !q('.tbl td'); i++) await sleep(100)
  await sleep(700)
  const page = () => rc(q('.page'))
  const tab = () => rc(q('.ed-main') || q('.nota'))
  const sc = scroller(); sc.style.scrollBehavior = 'auto'
  out.tab = tab(); out.page = page()
  out.hscroll = { sw: sc.scrollWidth, cw: sc.clientWidth, doc: document.documentElement.scrollWidth, docw: document.documentElement.clientWidth }
  out.look = look()
  // the layers do not lie on each other
  const parts = { sections: '.isle-left .isle', tools: '.isle-mid .isle-tools', remarks: '.isle-right .isle', strokes: '.isle-strokes', badge: '.pagemeta-badge' }
  const rects = {}
  for (const k of Object.keys(parts)) { const e = q(parts[k]); if (e && shown(e)) rects[k] = rc(e) }
  out.rects = rects
  out.overlaps = Object.keys(rects).flatMap((a) => Object.keys(rects).filter((b) => a < b && over(rects[a], rects[b])).map((b) => a + '×' + b))
  // the margin
  const pg = page()
  out.margin = {}
  const tbl = q('.tbl')
  const td = tbl.querySelector('td')
  td.scrollIntoView({ block: "center" }); scroller().dispatchEvent(new Event("scroll")); move(2, 2); await sleep(300)
  let p = centre(rc(td)); move(p.x, p.y); await sleep(500)
  const rg = grips() ? [...grips().querySelectorAll('.rg')].map(rc) : []
  out.margin.rows = rg.map((r) => r.r)
  const row1 = grips() && grips().querySelector('.rg[data-i="1"]')
  if (row1) { p = centre(rc(row1)); move(p.x, p.y); await sleep(700) }
  const gb = grips() && grips().querySelector('.gb:not([hidden])')
  out.margin.capsule = gb ? rc(gb) : null
  // the capsule over a row stands in the margin only in a wide tab: the others keep their place
  const para = [...document.querySelectorAll('.ProseMirror > p')].find((e) => e.textContent.startsWith('Короткое'))
  scroller().scrollTop = 0; scroller().dispatchEvent(new Event("scroll")); await sleep(300)
  p = centre(rc(para)); move(p.x, p.y); await sleep(500)
  const h = q('.blk-handle')
  out.margin.handle = h && shown(h) ? rc(h) : null
  const strokes = q('.isle-strokes')
  out.margin.strokes = strokes && shown(strokes) ? rc(strokes) : null
  out.margin.pageLeft = pg.l
  // the handle and the text of the paragraph
  out.margin.para = rc(para)
  move(2, 2); await sleep(200)
  if (CFG.change) {
    // the caret in a paragraph in the middle of the document, the scroll down, then the setting changes
    const target = [...document.querySelectorAll('.ProseMirror p')].find((e) => e.textContent.startsWith('Канал задаётся'))
    const ed = q('.ProseMirror'); ed.focus()
    const range = document.createRange(); range.setStart(target.firstChild, 5); range.collapse(true)
    const s = getSelection(); s.removeAllRanges(); s.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
    await sleep(400)
    sc.scrollTop = rc(target).t - 150 + sc.scrollTop
    sc.dispatchEvent(new Event('scroll'))
    await sleep(400)
    await sleep(400)
    const text0 = ed.textContent; const before = { top: sc.scrollTop, page: page().w, caretTop: rc(target).t, sel: getSelection().anchorNode === target.firstChild ? getSelection().anchorOffset : -1, edits: window.__msgs.filter((m) => m.type === 'edit').length }
    const t0 = performance.now()
    window.postMessage({ type: 'pageWidth', percent: CFG.change }, '*')
    let after = null
    while (performance.now() - t0 < 1000) { await sleep(50); if (Math.abs(page().w - before.page) > 1) { after = performance.now() - t0; break } }
    await sleep(300)
    const t2 = rc(target), view = rc(sc)
    out.change = { before, tookMs: after, page: page().w, text: ed.textContent === text0, top: sc.scrollTop, edits: window.__msgs.filter((m) => m.type === 'edit').length,
      sel: getSelection().anchorNode === target.firstChild ? getSelection().anchorOffset : -1, targetVisible: t2.t >= view.t && t2.b <= view.b, focus: document.activeElement === ed || ed.contains(document.activeElement) }
    // the layers placed by the page follow it: the strips of the table come out of the margin of the new page
    const td2 = q('.tbl td'); const c2 = centre(rc(td2)); sc.scrollTop = 0; sc.dispatchEvent(new Event('scroll')); await sleep(300)
    const c3 = centre(rc(td2)); move(c3.x, c3.y); await sleep(500)
    const rg2 = grips() ? [...grips().querySelectorAll('.rg')].map(rc) : []
    out.change.rowsRight = rg2.map((r) => r.r); out.change.pageLeft = page().l
  }
  await fetch('/res', { method: 'POST', body: JSON.stringify(out) })
}
run().catch((e) => { fetch('/res', { method: 'POST', body: JSON.stringify({ error: String((e && e.stack) || e) }) }) })
`

interface Box { l: number; t: number; r: number; b: number; w: number; h: number }
interface Out {
  error?: string
  tab: Box
  page: Box
  hscroll: { sw: number; cw: number; doc: number; docw: number }
  look: [string, string | null][]
  rects: Record<string, Box>
  overlaps: string[]
  strip?: Box | null
  margin: { rows: number[]; capsule: Box | null; handle: Box | null; strokes: Box | null; pageLeft: number; para: Box }
  change?: {
    before: { text: string; top: number; page: number; caretTop: number; sel: number; edits: number }
    tookMs: number | null
    page: number
    text: boolean
    top: number
    edits: number
    sel: number
    targetVisible: boolean
    focus: boolean
    rowsRight: number[]
    pageLeft: number
  }
}


async function pageFor(cfg: Config): Promise<Out> {
  const css = readFileSync(at('../../../react/src/style.css'), 'utf8') + '\n' + readFileSync(at('../../src/webview/style.css'), 'utf8')
  const body = cfg.theme === 'dark' ? 'class="vscode-dark" data-nota-theme="dark"' : 'class="vscode-light"'
  const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><link rel="stylesheet" href="/style.css"><style>html,body{margin:0;height:100%}#app{width:${cfg.width}px;height:${cfg.change ? 450 : 800}px}</style></head><body ${body}><div id="app" class="nota" data-mermaid=""></div>
<script>window.__msgs=[];window.acquireVsCodeApi=()=>({postMessage(m){window.__msgs.push(m)},getState:()=>null,setState(){}})</script>
<script src="/webview.js"></script><script src="/run.js"></script></body></html>`
  const files: Record<string, [string, string]> = {
    '/': [html, 'text/html'],
    '/style.css': [css, 'text/css'],
    '/webview.js': [await tabBundle(), 'text/javascript'],
    '/run.js': [runner(cfg), 'text/javascript'],
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
        prefix: 'pagewidth',
        timeout: 120_000,
        timeoutMessage: 'the page did not report',
        args: ['--headless=new', '--disable-gpu', '--no-first-run', '--disable-renderer-backgrounding', '--disable-background-timer-throttling', `--window-size=${Math.max(cfg.width, 600)},900`, `http://127.0.0.1:${port}/`],
      },
      () => result,
    )
  } finally {
    server?.close()
  }
}
// (a headless Chrome sometimes dies at the start: once more)
const measure = (cfg: Config): Promise<Out> => pageFor(cfg).catch(() => pageFor(cfg))
const where = (cfg: Config): string => JSON.stringify(cfg)

describe.skipIf(!CHROME)('the width of the page in a real Chrome', () => {
  describe('at 85 % and 100 % the strips, the capsule of a row and the handle of a block stand in the margin, left of the page', () => {
    for (const [width, percent] of [[1100, 85], [1100, 100], [1600, 85], [1600, 100]] as const) {
      it(`a tab of ${width} px, ${percent} %`, { timeout: 150_000 }, async () => {
        const cfg: Config = { width, percent, theme: 'light' }
        const o = await measure(cfg)
        const w = where(cfg) + ' ' + JSON.stringify(o.margin)
        // the page itself
        const wantW = Math.min(Math.max(width * (percent / 100), 608), width - 160)
        expect(Math.abs(o.page.w - wantW), w).toBeLessThanOrEqual(2)
        expect(Math.abs(o.page.l - (o.tab.w - o.page.r)), w).toBeLessThanOrEqual(2)
        expect(o.page.l, w).toBeGreaterThanOrEqual(78)
        // no scroll sideways
        expect(o.hscroll.sw, w).toBeLessThanOrEqual(o.hscroll.cw)
        expect(o.hscroll.doc, w).toBeLessThanOrEqual(o.hscroll.docw)
        // the strips of rows, the capsule of a row, the handle of the block: left of the page, not on its text
        expect(o.margin.rows.length, w).toBeGreaterThan(0)
        for (const r of o.margin.rows) expect(r, w).toBeLessThanOrEqual(o.margin.pageLeft + 0.5)
        expect(o.margin.capsule, w).not.toBeNull()
        // (at the height of the strokes the margin has no room for both, and the capsule stands right of the grip, over the first cell; it never lies on the strokes)
        const cap = o.margin.capsule!
        if (!(o.margin.strokes && cap.t < o.margin.strokes.b && cap.b > o.margin.strokes.t)) expect(cap.r, w).toBeLessThanOrEqual(o.margin.pageLeft + 0.5)
        else expect(cap.l >= o.margin.strokes.r || cap.t >= o.margin.strokes.b || cap.b <= o.margin.strokes.t, w).toBe(true)
        expect(o.margin.capsule!.l, w).toBeGreaterThanOrEqual(0)
        expect(o.margin.handle, w).not.toBeNull()
        expect(o.margin.handle!.r, w).toBeLessThanOrEqual(o.margin.pageLeft + 0.5)
        expect(o.margin.handle!.l, w).toBeGreaterThanOrEqual(0)
        // the closed strokes of «Разделы»: in the margin too (the open panel lies over the edge of the text as before, by design)
        expect(o.margin.strokes, w).not.toBeNull()
        expect(o.margin.strokes!.r, w).toBeLessThanOrEqual(o.margin.pageLeft + 0.5)
        expect(o.overlaps, w).toEqual([])
      })
    }
  })

  describe('the setting changes in an open tab', () => {
    for (const [width, from, to] of [[1600, 85, 60], [1600, 60, 100]] as const) {
      it(`${from} → ${to} % on ${width} px: the page follows in 1 s, the text, the caret and the scroll stay`, { timeout: 150_000 }, async () => {
        const cfg: Config = { width, percent: from, theme: 'light', change: to }
        const o = await measure(cfg)
        const c = o.change!
        const w = where(cfg) + ' ' + JSON.stringify(c)
        const wantW = Math.min(Math.max(width * (to / 100), 608), width - 160)
        expect(Math.abs(c.page - wantW), w).toBeLessThanOrEqual(2)
        expect(c.tookMs, w).not.toBeNull()
        expect(c.tookMs!, w).toBeLessThan(1000)
        expect(c.text, w).toBe(true)
        expect(c.edits, w).toBe(c.before.edits) // (the file is not marked changed: the tab sent no edit)
        expect(c.sel, w).toBe(c.before.sel) // (the caret is where it was)
        expect(c.focus, w).toBe(true)
        expect(c.targetVisible, w).toBe(true) // (the paragraph under the caret is in the visible part of the scroll)
        expect(c.top, w).toBeGreaterThan(0) // (the scroll did not jump to the top)
        // the layers placed by the page follow it: the strips of rows stand left of the new page
        expect(c.rowsRight.length, w).toBeGreaterThan(0)
        for (const r of c.rowsRight) expect(r, w).toBeLessThanOrEqual(c.pageLeft + 0.5)
      })
    }
  })

  describe('the strip «Файл больше 1 МБ» is as wide as the page', () => {
    for (const [width, percent] of [[1600, 85], [1600, 100], [900, 85], [761, 85], [1100, 50]] as const) {
      it(`a tab of ${width} px, ${percent} %`, { timeout: 150_000 }, async () => {
        const cfg: Config = { width, percent, theme: 'light', big: true }
        const o = await measure(cfg)
        const w = where(cfg) + ' ' + JSON.stringify(o.strip)
        expect(o.strip, w).not.toBeNull()
        const wantW = Math.min(Math.max(width * (percent / 100), 608), width - 160)
        expect(Math.abs(o.strip!.w - wantW), w).toBeLessThanOrEqual(2)
      })
    }
  })

  describe('the «Лист» at 1600 and 500 px, light and dark: nothing lies on anything, the colours and the fonts do not depend on the width of the page', () => {
    for (const width of [1600, 500] as const) {
      for (const theme of ['light', 'dark'] as const) {
        it(`${width} px, ${theme}`, { timeout: 200_000 }, async () => {
          const a = await measure({ width, percent: 85, theme })
          const b = await measure({ width, percent: 60, theme })
          const w = `${width} ${theme}`
          expect(a.overlaps, w).toEqual([])
          expect(b.overlaps, w).toEqual([])
          expect(a.look.filter(([, v]) => v !== null).length, w).toBeGreaterThan(4)
          expect(a.look, w).toEqual(b.look)
          expect(a.hscroll.sw, w).toBeLessThanOrEqual(a.hscroll.cw)
          if (width === 500) expect(Math.abs(a.page.w - (a.tab.w - 60)), w).toBeLessThanOrEqual(40) // (a narrow tab: the page is as wide as the content, as before)
        })
      }
    }
  })
})
