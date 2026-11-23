// the grips of a table (the strips over the columns and at the left of the rows) do not flicker under the mouse: the highlight comes once and stays while the
// pointer is on the strip, and goes to the next strip exactly at the border. Measured in a real Chrome (jsdom has no layout) on the real bundle of the tab and its real style
// sheet, in the light and the dark theme, with the real input of the browser (the DevTools protocol `Input.dispatchMouseEvent` moves `:hover`; `dispatchEvent(new MouseEvent())`
// does not). In every frame (`requestAnimationFrame`) the page writes the strip under `:hover` (which node it is: the same object, or another one), whether it is still in the
// page, the scale of its `::after` and the capsule of the buttons. A "change of the hover" is a frame where the node under `:hover` is not the one of the frame before
// (another node, the same number as a new node, or none). Skipped, with the reason, where Chrome is not installed. `NOTA139_TRACE=1` prints the numbers.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Readable, Writable } from 'node:stream'
import { beforeAll, describe, expect, it } from 'vitest'
import { type ChromeHandle, launchChrome } from './chrome.js'
import { tabBundle } from './bundle.js'

const CHROME = [process.env.CHROME_BIN ?? '', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => p && existsSync(p))
const here = import.meta.dirname
const at = (path: string): string => join(here, path)
const TRACE = Boolean(process.env.NOTA139_TRACE)

if (!CHROME) console.warn('Chrome is not installed (set CHROME_BIN): the test of the grips under the mouse in a real browser is skipped')

// ---------------------------------------------------------------- the tables (made up)

const row = (cells: string[]): string => cells.map((c) => `|${c}`).join(' ') + '\n'
function small(): string {
  let t = '= Тест\n\nАбзац вне таблицы.\n\n|===\n'
  for (let r = 0; r < 3; r++) t += row(Array.from({ length: 3 }, (_, k) => `Ячейка ${r}-${k}`)) + '\n'
  return t + '|===\n\nАбзац после таблицы.\n'
}
/** 8 columns of words that do not break (the table is wider than its frame), 160 rows. */
function big(): string {
  let t = '= Тест\n\nАбзац вне таблицы.\n\n[%header,cols="8"]\n|===\n'
  t += row(Array.from({ length: 8 }, (_, k) => `Заголовок_колонки_номер_${k + 1}_длинный`)) + '\n'
  for (let r = 0; r < 160; r++) t += row(Array.from({ length: 8 }, (_, k) => `Значение_ячейки_${r}_${k}_с_длинным_текстом`)) + '\n'
  return t + '|===\n\nАбзац после таблицы.\n'
}
// (rows of different height: every 7th is high, every 5th is low, 24 px)
const BIG_CSS = '.doc .tbl tr:nth-child(7n) td { padding-top: 24px !important } .doc .tbl tr:nth-child(5n) td { padding-top: 2px !important; padding-bottom: 2px !important }'

const WIDTH = 1280
const HEIGHT = 900

// ---------------------------------------------------------------- the page

const PAGE_SCRIPT = `
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const rc = (e) => { const r = e.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height } }
const grips = () => document.querySelector('.nota-grips')
const ids = new WeakMap()
let nid = 0
const idOf = (e) => { if (!ids.has(e)) ids.set(e, ++nid); return ids.get(e) }
const scaleOf = (e) => { const t = getComputedStyle(e, '::after').transform; if (!t || t === 'none') return 1; const m = t.match(/matrix\\(([^)]+)\\)/); if (!m) return 1; const v = m[1].split(',').map(parseFloat); return e.classList.contains('cg') ? v[3] : v[0] }
const capsule = () => { const b = grips() && grips().querySelector('.gb:not([hidden])'); return b ? rc(b) : null }
window.T = {
  frames: [], on: false, last: null,
  start() {
    this.frames = []; this.on = true; this.last = null
    const tick = () => {
      if (!this.on) return
      const e = document.querySelector('.nota-grips :is(.cg,.rg):hover')
      if (e) this.last = e
      this.frames.push({ id: e ? idOf(e) : 0, key: e ? e.dataset.kind + e.dataset.i : '', conn: this.last ? this.last.isConnected : true, scale: e ? scaleOf(e) : 0, cap: capsule(), t: performance.now() })
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  },
  stop() { this.on = false; return this.frames },
}
window.P = {
  async open(text, css, theme) {
    document.body.className = theme === 'dark' ? 'vscode-dark' : 'vscode-light'
    if (theme === 'dark') document.body.dataset.notaTheme = 'dark'
    if (css) { const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st) }
    window.postMessage({ type: 'init', text, version: 1, fileName: 'a.adoc', locale: 'ru', outlineView: 'capsule', fileDir: '/tmp', mode: 'visual' }, '*')
    for (let i = 0; i < 100 && !document.querySelector('.tbl td'); i++) await sleep(50)
    await sleep(800)
    return document.querySelectorAll('.tbl tr').length
  },
  frame() { return document.querySelector('.tbl > .tbl-scroll') },
  /** The table at the top of the window (the strips of the columns are over it), or its middle row in the middle of the window; the frame scrolled sideways. */
  place(mode) {
    const sc = document.querySelector('.scroll')
    const f = this.frame()
    if (mode === 'top') sc.scrollTop += f.getBoundingClientRect().top - 170
    else { const trs = f.querySelectorAll(':scope > table > tbody > tr'); const r = trs[Math.floor(trs.length / 2)].getBoundingClientRect(); sc.scrollTop += r.top + r.height / 2 - innerHeight / 2 }
    f.scrollLeft = f.scrollWidth > f.clientWidth ? 200 : 0
    return { overflow: f.scrollWidth - f.clientWidth, scroll: sc.scrollTop }
  },
  cell(r, k) { const tr = this.frame().querySelectorAll(':scope > table > tbody > tr')[r]; const q = tr.children[k].getBoundingClientRect(); const fr = this.frame().getBoundingClientRect(); const left = Math.max(q.left, fr.left + 1); const right = Math.min(q.right, fr.right - 1); return { x: (left + right) / 2, y: q.top + q.height / 2 } },
  strips(cls) { return [...grips().querySelectorAll('.' + cls)].map((e) => ({ i: +e.dataset.i, ...rc(e) })) },
  /** The strips that are in the window (under the toolbar nothing is measured: 130 px from the top, 40 px from the bottom). */
  seen(cls) { return this.strips(cls).filter((s) => s.bottom > 130 && s.top < innerHeight - 40 && s.right > 0 && s.left < innerWidth) },
  capsule: () => capsule(),
  frameRect() { return rc(this.frame()) },
  /** What a strip draws: rectangle, the used style of ::after (colour, scale, where the middle of the stroke is). */
  look(cls, i) {
    const e = grips().querySelector('.' + cls + '[data-i="' + i + '"]')
    if (!e) return null
    const cs = getComputedStyle(e, '::after')
    const r = rc(e)
    const px = (s) => parseFloat(s) || 0
    const col = cls === 'cg'
    // (where the column or the row is, in the frame: a strip goes from edge to edge of it)
    const trs = this.frame().querySelectorAll(':scope > table > tbody > tr')
    const fr = rc(this.frame())
    const q = col ? rc(trs[0].children[i]) : rc(trs[i])
    const span = col ? { from: Math.max(q.left, fr.left), to: Math.min(q.right, fr.right) } : { from: q.top, to: q.bottom }
    return { span, rect: r, bg: cs.backgroundColor, scale: scaleOf(e), len: col ? px(cs.width) : px(cs.height), thick: col ? px(cs.height) : px(cs.width), centre: col ? r.left + px(cs.marginLeft) + px(cs.width) / 2 : r.top + px(cs.marginTop) + px(cs.height) / 2 }
  },
  /** The elements at the points 1 px from the edges of a strip. */
  edges(cls, i) {
    const e = grips().querySelector('.' + cls + '[data-i="' + i + '"]')
    const r = rc(e)
    const mx = (r.left + r.right) / 2, my = (r.top + r.bottom) / 2
    const pts = [[r.left + 1, my], [r.right - 1, my], [mx, r.top + 1], [mx, r.bottom - 1]]
    return pts.map(([x, y]) => { const o = document.elementFromPoint(x, y); return o === e })
  },
  /** The text cursor goes to the paragraph before the table, as the keyboard does; the mouse is not touched. */
  cursorOutside() {
    const p = document.querySelector('.ProseMirror p')
    document.querySelector('.ProseMirror').focus()
    const t = p.lastChild
    getSelection().setBaseAndExtent(t, t.length, t, t.length)
    return p.textContent
  },
}
`


const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** A page of a real Chrome driven through the DevTools protocol (the same way as in `admonition-layout.test.ts`). */
class Tab {
  private out!: Writable
  private n = 0
  private waiting = new Map<number, (v: { result?: unknown; error?: { message: string } }) => void>()
  private session = ''
  private chrome!: ChromeHandle
  private dir = ''

  async open(): Promise<void> {
    this.dir = mkdtempSync(join(tmpdir(), 'nota-hover-'))
    const css = readFileSync(at('../../../react/src/style.css'), 'utf8') + '\n' + readFileSync(at('../../src/webview/style.css'), 'utf8')
    writeFileSync(join(this.dir, 'webview.js'), await tabBundle())
    writeFileSync(join(this.dir, 'style.css'), css)
    writeFileSync(
      join(this.dir, 'p.html'),
      `<!doctype html><html lang="ru"><head><meta charset="utf-8"><link rel="stylesheet" href="style.css"><style>html,body{margin:0;height:100%}#app{width:${WIDTH}px;height:100%}</style></head><body><div id="app" class="nota" data-mermaid=""></div>
<script>window.__msgs=[];window.acquireVsCodeApi=()=>({postMessage(m){window.__msgs.push(m)},getState:()=>null,setState(){}})</script>
<script src="webview.js"></script><script>${PAGE_SCRIPT}</script></body></html>`,
    )
    this.chrome = await launchChrome({ chrome: CHROME!, prefix: 'hover', args: ['--headless=new', '--disable-gpu', '--allow-file-access-from-files', '--no-first-run', '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--remote-debugging-pipe', `--window-size=${WIDTH},${HEIGHT}`, 'about:blank'] })
    this.out = this.chrome.proc.stdio[3] as Writable
    let buf = ''
    ;(this.chrome.proc.stdio[4] as Readable).setEncoding('utf8').on('data', (chunk: string) => {
      buf += chunk
      for (let k = buf.indexOf('\0'); k >= 0; k = buf.indexOf('\0')) {
        const d = JSON.parse(buf.slice(0, k)) as { id?: number; result?: unknown; error?: { message: string } }
        buf = buf.slice(k + 1)
        if (d.id !== undefined) this.waiting.get(d.id)?.(d)
      }
    })
    const { targetId } = (await this.send('Target.createTarget', { url: `file://${join(this.dir, 'p.html')}` })) as { targetId: string }
    this.session = ((await this.send('Target.attachToTarget', { targetId, flatten: true })) as { sessionId: string }).sessionId
    await this.send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false })
    for (let i = 0; i < 100; i++) {
      if ((await this.ev('typeof window.P')) === 'object') break
      await wait(100)
    }
  }

  send(method: string, params: object = {}): Promise<unknown> {
    const id = ++this.n
    return new Promise((res, rej) => {
      this.waiting.set(id, (d) => (d.error ? rej(new Error(`${method}: ${d.error.message}`)) : res(d.result)))
      this.out.write(JSON.stringify({ id, method, params, ...(this.session && method.indexOf('Target.') !== 0 ? { sessionId: this.session } : {}) }) + '\0')
    })
  }

  async ev<T = unknown>(expression: string): Promise<T> {
    const r = (await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })) as { result: { value: T }; exceptionDetails?: { exception?: { description?: string } } }
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'page error')
    return r.result.value
  }

  mouse(x: number, y: number): Promise<unknown> {
    return this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', clickCount: 0 })
  }

  /** One frame of the page. */
  frame(): Promise<unknown> {
    return this.ev('new Promise((r) => requestAnimationFrame(() => r(0)))')
  }

  /** The pointer goes from a point to a point by 1 px a frame (the longer of the two distances). */
  async walk(x0: number, y0: number, x1: number, y1: number): Promise<void> {
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))))
    for (let k = 1; k <= n; k++) {
      // (the move and the wait for the next frame go to the browser together: the browser handles them in this order)
      await Promise.all([this.mouse(x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n), this.frame()])
    }
  }

  async close(): Promise<void> {
    await this.chrome?.close()
    try {
      rmSync(this.dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
    } catch {
      /* the temporary folder stays */
    }
  }
}

interface Box {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}
interface Fr {
  id: number
  key: string
  conn: boolean
  scale: number
  cap: Box | null
  t: number
}
interface Strip extends Box {
  i: number
}
interface Look {
  span: { from: number; to: number }
  rect: Box
  bg: string
  scale: number
  len: number
  thick: number
  centre: number
}

/** The frames where the node under `:hover` is not the one of the frame before. */
const changes = (frames: Fr[]): { frame: number; from: string; to: string }[] => {
  const out: { frame: number; from: string; to: string }[] = []
  for (let i = 1; i < frames.length; i++) if (frames[i]!.id !== frames[i - 1]!.id) out.push({ frame: i, from: `${frames[i - 1]!.key || '-'}#${frames[i - 1]!.id}`, to: `${frames[i]!.key || '-'}#${frames[i]!.id}` })
  return out
}
const trace = (label: string, ch: { frame: number; from: string; to: string }[], frames: Fr[]): void => {
  if (TRACE) console.log(`${label}: ${frames.length} frames, ${ch.length} changes ${ch.slice(0, 12).map((c) => `${c.frame}:${c.from}>${c.to}`).join(' ')}`)
}

async function record(tab: Tab, act: () => Promise<void>): Promise<Fr[]> {
  await tab.ev('window.T.start()')
  await tab.frame()
  await tab.frame()
  await act()
  return tab.ev<Fr[]>('window.T.stop()')
}

// ---------------------------------------------------------------- the scenarios

interface Result {
  stand: Record<'col' | 'row', { frames: Fr[]; ch: ReturnType<typeof changes>; first: number }>
  walk: Record<'col' | 'row', { frames: Fr[]; ch: ReturnType<typeof changes>; expected: number; last: Strip; cap: Box | null; none: number }>
  cross: Record<'col' | 'row', { frames: Fr[]; ch: ReturnType<typeof changes>; edge: { frames: Fr[]; ch: ReturnType<typeof changes> }[] }>
  zone: Record<'col' | 'row', { rest: Look; hover: Look; edges: boolean[]; edgesRest: boolean[] }>
  keys: { frames: Fr[]; ch: ReturnType<typeof changes>; capBefore: Box | null; capAfter: Box | null; typed: string; text: string }
}

async function measure(text: string, css: string, theme: 'light' | 'dark', bigTable: boolean): Promise<Result> {
  const tab = new Tab()
  try {
    await tab.open()
    await tab.ev(`window.P.open(${JSON.stringify(text)}, ${JSON.stringify(css)}, ${JSON.stringify(theme)})`)
    const away = async (): Promise<void> => {
      await tab.mouse(3, 3)
      await wait(700)
    }
    const into = async (mode: 'top' | 'mid'): Promise<void> => {
      await away()
      await tab.ev(`window.P.place(${JSON.stringify(mode)})`)
      await wait(300)
      // (the pointer in a cell: the grips of the table are drawn)
      const r = Math.min(bigTable && mode === 'mid' ? 80 : 0, 80)
      const c = await tab.ev<{ x: number; y: number }>(`window.P.cell(${r}, 1)`)
      await tab.mouse(c.x, c.y)
      await wait(400)
    }
    const mid = (s: Box): { x: number; y: number } => ({ x: (s.left + s.right) / 2, y: (s.top + s.bottom) / 2 })
    const res = {} as Result
    res.stand = {} as Result['stand']
    res.walk = {} as Result['walk']
    res.cross = {} as Result['cross']
    res.zone = {} as Result['zone']

    for (const kind of ['col', 'row'] as const) {
      const cls = kind === 'col' ? 'cg' : 'rg'
      const where = kind === 'col' ? 'top' : 'mid'

      // the pointer comes to the middle of a strip and stands 2 s
      await into(where)
      let strips = await tab.ev<Strip[]>(`window.P.seen('${cls}')`)
      const target = strips[Math.min(1, strips.length - 1)]!
      const p = mid(target)
      const frames = await record(tab, async () => {
        await tab.mouse(p.x, p.y)
        await wait(2000)
      })
      const ch = changes(frames)
      trace(`stand ${kind}`, ch, frames)
      res.stand[kind] = { frames, ch, first: ch[0]?.frame ?? -1 }

      // the rectangle and the stroke with the pointer on the strip and without
      const hover = await tab.ev<Look>(`window.P.look('${cls}', ${target.i})`)
      const edgesHover = await tab.ev<boolean[]>(`window.P.edges('${cls}', ${target.i})`)
      await tab.mouse(3, 3)
      await wait(800)
      await tab.mouse(...(Object.values(await tab.ev<{ x: number; y: number }>(`window.P.cell(${bigTable && kind === 'row' ? 80 : 0}, 1)`)) as [number, number]))
      await wait(400)
      const rest = await tab.ev<Look>(`window.P.look('${cls}', ${target.i})`)
      const edgesRest = await tab.ev<boolean[]>(`window.P.edges('${cls}', ${target.i})`)
      res.zone[kind] = { rest, hover, edges: edgesHover, edgesRest }

      // along the strips by 1 px a frame
      await into(where)
      strips = await tab.ev<Strip[]>(`window.P.seen('${cls}')`)
      const first = strips[0]!
      const last = strips[strips.length - 1]!
      const m = mid(first)
      let from: number, to: number, fixed: number
      if (kind === 'col') {
        from = Math.max(first.left, 0) + 0.5
        to = Math.min(last.right, WIDTH) - 0.5
        fixed = m.y
        await tab.mouse(from, fixed)
      } else {
        from = Math.max(first.top, 140) + 0.5
        to = Math.min(last.bottom, HEIGHT - 50) - 0.5
        fixed = m.x
        await tab.mouse(fixed, from)
      }
      await wait(500)
      // (the strips that hold the path: those that are in the window, cut by the ends of the path)
      const onPath = strips.filter((s) => (kind === 'col' ? s.right > from && s.left < to : s.bottom > from && s.top < to))
      const walked = await record(tab, async () => {
        if (kind === 'col') await tab.walk(from, fixed, to, fixed)
        else await tab.walk(fixed, from, fixed, to)
      })
      await wait(0)
      const wch = changes(walked)
      trace(`walk ${kind}`, wch, walked)
      await wait(700)
      const cap = await tab.ev<Box | null>('window.P.capsule()')
      res.walk[kind] = { frames: walked, ch: wch, expected: onPath.length - 1, last: onPath[onPath.length - 1]!, cap, none: walked.filter((f) => f.id === 0).length }
    }

    // across the band and back, then standing at the edges
    for (const kind of ['col', 'row'] as const) {
      const cls = kind === 'col' ? 'cg' : 'rg'
      await into(kind === 'col' ? 'top' : 'mid')
      const strips = await tab.ev<Strip[]>(`window.P.seen('${cls}')`)
      const s = strips[Math.min(1, strips.length - 1)]!
      const c = mid(s)
      // (from the cell, through the strip, 5 px past it, and back)
      const inx = kind === 'col' ? c.x : s.right + 24
      const iny = kind === 'col' ? s.bottom + 24 : c.y
      const outx = kind === 'col' ? c.x : s.left - 6
      const outy = kind === 'col' ? s.top - 6 : c.y
      await tab.mouse(inx, iny)
      await wait(400)
      const frames = await record(tab, async () => {
        await tab.walk(inx, iny, outx, outy)
        await tab.walk(outx, outy, inx, iny)
      })
      const ch = changes(frames)
      trace(`cross ${kind}`, ch, frames)
      // edges: 1 px inside, from the side of the page and from the side of the frame
      const edge: { frames: Fr[]; ch: ReturnType<typeof changes> }[] = []
      for (const side of ['page', 'frame']) {
        await into(kind === 'col' ? 'top' : 'mid')
        const ex = kind === 'col' ? c.x : side === 'page' ? s.left + 1 : s.right - 1
        const ey = kind === 'col' ? (side === 'page' ? s.top + 1 : s.bottom - 1) : c.y
        const sx = kind === 'col' ? c.x : s.right + 24
        const sy = kind === 'col' ? s.bottom + 24 : c.y
        await tab.walk(sx, sy, ex, ey)
        // (the entry is settled: the first frames of the stand are not its own)
        await tab.frame()
        await tab.frame()
        await tab.frame()
        const fr = await record(tab, async () => {
          await wait(1000)
        })
        const sc = changes(fr)
        trace(`edge ${kind} ${side}`, sc, fr)
        edge.push({ frames: fr, ch: sc })
      }
      res.cross[kind] = { frames, ch, edge }
    }

    // the pointer stands on a strip; the text cursor goes to another paragraph and a word is typed
    await into('top')
    const strips = await tab.ev<Strip[]>("window.P.seen('cg')")
    const p = mid(strips[Math.min(1, strips.length - 1)]!)
    await tab.mouse(p.x, p.y)
    await wait(900)
    const capBefore = await tab.ev<Box | null>('window.P.capsule()')
    const frames = await record(tab, async () => {
      await wait(300)
      await tab.ev('window.P.cursorOutside()')
      await wait(300)
      await tab.send('Input.insertText', { text: ' слово' })
      await wait(1000)
    })
    const typed = await tab.ev<string>("document.querySelector('.ProseMirror p').textContent")
    const sent = await tab.ev<string>("JSON.stringify(window.__msgs.filter((m) => m.type === 'edit'))")
    const ch = changes(frames)
    trace('keys', ch, frames)
    res.keys = { frames, ch, capBefore, capAfter: await tab.ev<Box | null>('window.P.capsule()'), typed, text: sent }
    return res
  } finally {
    await tab.close()
  }
}

// ---------------------------------------------------------------- the checks

const T = 1.66
const done = (r: Result['stand']['col']): void => {
  expect(r.frames.length, 'frames were drawn').toBeGreaterThan(60)
}

describe.skipIf(!CHROME)('the grips of a table do not flicker under the mouse (real Chrome, real mouse)', () => {
  const tables: [string, string, string, boolean][] = [
    ['3×3', small(), '', false],
    ['big (8 columns, 160 rows, wider than the frame)', big(), BIG_CSS, true],
  ]
  for (const [name, text, css, isBig] of tables) {
    for (const theme of ['light', 'dark'] as const) {
      describe(`${name}, ${theme} theme`, () => {
        let r: Result
        beforeAll(async () => {
          r = await measure(text, css, theme, isBig)
        }, 900_000)

        it('the pointer on the middle of a strip for 2 s: one change of the hover (the entry), the same node, in the page, the stroke does not shrink', { timeout: 60_000 }, () => {
          for (const kind of ['col', 'row'] as const) {
            const s = r.stand[kind]
            done(s)
            expect(s.ch.length, `${kind}: changes of the hover ${JSON.stringify(s.ch)}`).toBe(1)
            expect(s.ch[0]!.from.startsWith('-'), `${kind}: the entry`).toBe(true)
            const after = s.frames.filter((f) => f.id !== 0)
            expect(new Set(after.map((f) => f.id)).size, `${kind}: one node`).toBe(1)
            expect(
              s.frames.every((f) => f.conn),
              `${kind}: the node is in the page`,
            ).toBe(true)
            let top = false
            let min = 9
            for (const f of after) {
              if (f.scale >= T) top = true
              if (top) min = Math.min(min, f.scale)
            }
            expect(top, `${kind}: the stroke got to scale 1.67`).toBe(true)
            expect(min, `${kind}: the stroke shrinks after that`).toBeGreaterThanOrEqual(T)
            // (the capsule is shown by the end, 160 ms after the entry)
            expect(s.frames.at(-1)!.cap, `${kind}: the capsule`).not.toBeNull()
          }
        })

        it('along the strips of the columns by 1 px a frame: a change per border, never none, no strip twice, the capsule over the last column', { timeout: 120_000 }, () => {
          const w = r.walk.col
          expect(w.expected).toBeGreaterThan(1)
          expect(w.ch.length, `changes ${JSON.stringify(w.ch)}`).toBe(w.expected)
          expect(w.none, 'frames without a strip').toBe(0)
          const seq = w.frames.filter((f, i) => i === 0 || f.id !== w.frames[i - 1]!.id).map((f) => f.key)
          expect(new Set(seq).size, `a strip twice: ${seq}`).toBe(seq.length)
          expect(w.cap, 'the capsule at the end').not.toBeNull()
          const c = (w.cap!.left + w.cap!.right) / 2
          expect(c >= w.last.left - 1 && c <= w.last.right + 1, `the capsule ${w.cap!.left}..${w.cap!.right} over the last column ${w.last.left}..${w.last.right}`).toBe(true)
        })

        it('along the strips of the rows by 1 px a frame (rows of different height, low ones): a change per border, never none', { timeout: 120_000 }, () => {
          const w = r.walk.row
          expect(w.expected).toBeGreaterThan(1)
          expect(w.ch.length, `changes ${JSON.stringify(w.ch)}`).toBe(w.expected)
          expect(w.none, 'frames without a strip').toBe(0)
          const seq = w.frames.filter((f, i) => i === 0 || f.id !== w.frames[i - 1]!.id).map((f) => f.key)
          expect(new Set(seq).size, `a strip twice: ${seq}`).toBe(seq.length)
        })

        it('across the band and back: a change for each entry and each exit; at the edge of a strip for 1 s: none', { timeout: 120_000 }, () => {
          for (const kind of ['col', 'row'] as const) {
            const c = r.cross[kind]
            expect(c.ch.length, `${kind}: ${JSON.stringify(c.ch)}`).toBe(4)
            for (const [k, e] of c.edge.entries()) {
              expect(e.frames.length).toBeGreaterThan(30)
              expect(e.ch.length, `${kind} edge ${k ? 'frame' : 'page'}: ${JSON.stringify(e.ch)}`).toBe(0)
            }
          }
        })

        it('the zone of the hover does not change: the same rectangle with and without the pointer (0.5 px), only the colour and the thickness change', { timeout: 60_000 }, () => {
          for (const kind of ['col', 'row'] as const) {
            const z = r.zone[kind]
            for (const k of ['left', 'top', 'right', 'bottom'] as const) expect(Math.abs(z.hover.rect[k] - z.rest.rect[k]), `${kind}: ${k}`).toBeLessThanOrEqual(0.5)
            if (kind === 'row') expect(z.rest.rect.height, 'a row strip is 8 px at the least').toBeGreaterThanOrEqual(8)
            expect(Math.abs(z.hover.centre - z.rest.centre), `${kind}: the middle of the stroke`).toBeLessThanOrEqual(0.5)
            expect(z.rest.scale, `${kind}: at rest`).toBe(1)
            expect(z.hover.scale, `${kind}: hovered (×1.67)`).toBeGreaterThanOrEqual(T)
            expect(z.hover.bg, `${kind}: the colour changes`).not.toBe(z.rest.bg)
            const alpha = (c: string): number => Number(/(?:\/\s*|,\s*)([\d.]+)\s*\)$/.exec(c)?.[1] ?? 1)
            expect(alpha(z.hover.bg), `${kind}: 60 % (${z.hover.bg})`).toBeCloseTo(0.6, 1)
            const [a, b] = kind === 'col' ? (['left', 'right'] as const) : (['top', 'bottom'] as const)
            expect(Math.abs(z.rest.rect[a] - z.rest.span.from), `${kind}: the strip starts at the edge of the ${kind === 'col' ? 'column' : 'row'}`).toBeLessThanOrEqual(1.5)
            expect(Math.abs(z.rest.rect[b] - z.rest.span.to), `${kind}: the strip ends at the other edge`).toBeLessThanOrEqual(1.5)
            expect(z.edges, `${kind}: the points 1 px from the edges, hovered`).toEqual([true, true, true, true])
            expect(z.edgesRest, `${kind}: the points 1 px from the edges, at rest`).toEqual([true, true, true, true])
          }
        })

        it('a change made not by the mouse (the cursor in another paragraph, a word typed) does not reset the highlight', { timeout: 60_000 }, () => {
          const k = r.keys
          expect(k.capBefore, 'the capsule before').not.toBeNull()
          expect(k.typed, 'the word is typed outside of the table').toContain('слово')
          expect(k.ch.length, `changes ${JSON.stringify(k.ch)}`).toBe(0)
          expect(
            k.frames.every((f) => f.conn && f.id !== 0),
            'the node is in the page and hovered all the time',
          ).toBe(true)
          expect(Math.min(...k.frames.map((f) => f.scale))).toBeGreaterThanOrEqual(T)
          expect(k.capAfter, 'the capsule stays').not.toBeNull()
        })
      })
    }
  }
})
