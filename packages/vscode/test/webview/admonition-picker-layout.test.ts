// the choice of the type of an admonition (the label of the block is the button, a row of five types grows from it). Measured in a real
// Chrome (jsdom has no layout) on the real bundle of the tab and its real style sheet, as `overlap-layout.test.ts` does, on
// `quality/fixtures/editor/admonition-type.adoc`, in tabs of 390, 700 and 1280 px, in the dark and in the light theme:
//  the cursor is in every admonition of the file, the choice opens and closes; in every frame the rectangle of the button and of the row does not cross
//      the heading above, the blocks around, the strokes of the sections, the handle of the block, the badge «i»; the blocks of the document, the scroll of
//      the page and the place of the cursor are the same before, during and after (±0.5 px);
//  the contrast of the word of the type (4.5:1) and of its icon (3:1) in both themes;
//  the row opens in 160–260 ms through at least three sizes, monotone; it closes in ≤ 200 ms, monotone, and the part that goes is not hit by the mouse;
//      five quick «open → close» leave no row in the document; with `prefers-reduced-motion: reduce` the final look is in the first frame;
//  in a tab of 390 px all of it is inside the tab;
//  (frames) the layer stands on its label in every frame while the page is scrolled by the wheel and while blocks above move with no edit of the text; it
//      hides when the label has gone under the row of capsules or out of the window.
// Skipped, with the reason, where Chrome is not installed.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Readable, Writable } from 'node:stream'
import { beforeAll, describe, expect, it } from 'vitest'
import { CHROME_QUEUE_MS, holdChromeSlot } from './chrome.js'
import { type ChromeHandle, launchChrome } from './chrome.js'
import { tabBundle } from './bundle.js'

const CHROME = [process.env.CHROME_BIN ?? '', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => p && existsSync(p))
if (CHROME) beforeAll(() => holdChromeSlot(), CHROME_QUEUE_MS + 10_000)
const here = import.meta.dirname
const at = (path: string): string => join(here, path)

if (!CHROME) console.warn('Chrome is not installed (set CHROME_BIN): the test of the choice of the type of an admonition in a real browser is skipped')

const TEXT = readFileSync(at('../../../../quality/fixtures/editor/admonition-type.adoc'), 'utf8')
const HEIGHT = 640
const COUNT = 4
const FILLER = Array.from({ length: 14 }, (_, i) => `Абзац-заполнитель номер ${i + 1}, чтобы у страницы была прокрутка.`).join('\n\n')
/** The same file with a long text above and under it: the page scrolls. */
const LONG = TEXT.replace('== Порядок подключения', `== Раньше\n\n${FILLER}\n\n== Порядок подключения`).replace('== Дальше', `== Дальше\n\n${FILLER}`)

/** The page that runs the cases inside Chrome and writes what it measured into the title. */
const PAGE_SCRIPT = `
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const vis = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' }
const arr = (r) => [r.left, r.top, r.width, r.height]
const lum = (rgb) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }; return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]) }
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) }
const rgbOf = (s) => (s.match(/[\\d.]+/g) || []).slice(0, 3).map(Number)
const pm = () => document.querySelector('.ProseMirror')
const scroller = () => document.querySelector('.ed-visual')
const caret = () => { const s = getSelection(); if (!s.rangeCount) return null; const r = s.getRangeAt(0); const q = r.getClientRects()[0] || r.getBoundingClientRect(); return [q.left, q.top] }
const snap = () => ({ blocks: [...pm().children].map((e) => arr(e.getBoundingClientRect())), scroll: scroller().scrollTop, caret: caret() })
const delta = (a, b) => {
  let d = Math.abs(a.scroll - b.scroll)
  if (a.blocks.length !== b.blocks.length) return 9999
  a.blocks.forEach((r, i) => r.forEach((v, j) => { d = Math.max(d, Math.abs(v - b.blocks[i][j])) }))
  if (a.caret && b.caret) d = Math.max(d, Math.abs(a.caret[0] - b.caret[0]), Math.abs(a.caret[1] - b.caret[1]))
  return d
}
const OTHER = { strokes: '.isle-strokes', handle: '.blk-handle', sections: '.isle-left .isle', tools: '.isle-mid .isle-tools', remarks: '.isle-right .isle', badge: '.pagemeta-badge' }
const cross = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5
/** The blocks of the admonition the cursor is in: the paragraph, or the head of the box up to its end. */
const ownBlocks = () => {
  const kids = [...pm().children]
  const n = getSelection().anchorNode
  let i = kids.findIndex((k) => k.contains(n))
  if (i < 0) return []
  if (kids[i].classList.contains('adm-para')) return [kids[i]]
  let a = i, b = i
  while (a > 0 && !kids[a].classList.contains('adm-head')) a--
  while (b < kids.length - 1 && !kids[b].classList.contains('box-end')) b++
  return kids.slice(a, b + 1)
}
const hitsOf = (rect) => {
  const own = ownBlocks()
  const hits = []
  for (const k of pm().children) if (!own.includes(k) && cross(rect, k.getBoundingClientRect())) hits.push('block:' + (k.className || k.tagName).slice(0, 24))
  for (const [name, sel] of Object.entries(OTHER)) for (const e of document.querySelectorAll(sel)) if (vis(e) && cross(rect, e.getBoundingClientRect())) hits.push(name)
  // (the label of the block it stands on is the only own thing it may lie on: its first line)
  return hits
}
const frames = (ms, each) => new Promise((resolve) => {
  const t0 = performance.now(); const out = []
  const tick = () => { const t = performance.now() - t0; const v = each(t); if (v) out.push(v); if (t < ms) requestAnimationFrame(tick); else resolve(out) }
  requestAnimationFrame(tick)
})
const monotone = (xs, dir) => xs.every((x, i) => i === 0 || (dir > 0 ? x >= xs[i - 1] - 0.01 : x <= xs[i - 1] + 0.01))
const select = (el) => {
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  const n = w.nextNode(); const r = document.createRange(); r.setStart(n, Math.min(3, n.length)); r.collapse(true)
  pm().focus(); const s = getSelection(); s.removeAllRanges(); s.addRange(r)
}
const textOfBox = (i) => {
  // the first text block after the n-th head
  const heads = [...pm().querySelectorAll('.adm-head')]
  let e = heads[i].nextElementSibling
  while (e && !(e.querySelector && (e.matches('p') || e.querySelector('p')))) e = e.nextElementSibling
  return e.matches('p') ? e : e.querySelector('p')
}
const cases = () => {
  // the order of the file: box, paragraph, box, paragraph
  const list = []
  let box = 0
  for (const k of pm().children) {
    if (k.classList.contains('adm-para')) list.push({ name: 'para-' + list.length, el: () => k.querySelector('.adm-text'), k })
    else if (k.classList.contains('adm-head')) { const n = box++; list.push({ name: 'box-' + list.length, el: () => textOfBox(n), k }) }
  }
  return list
}
const caseRun = async (c) => {

  const sc = scroller()
  sc.scrollTop += c.k.getBoundingClientRect().top - 260
  await sleep(200)
  select(c.el())
  await sleep(500)
  const out = { name: c.name, hits: [], inside: true, ok: true }
  const trig = document.querySelector('.admpick [data-cmd="admonition"]')
  if (!trig) return { ...out, ok: false, why: 'no button' }
  const base = snap()
  out.baseHits = hitsOf(document.querySelector('.admpick').getBoundingClientRect())
  out.titles = document.querySelectorAll('.admpick [title]').length
  let worst = 0
  const watch = (t) => {
    const p = document.querySelector('.admpick')
    if (!p) return null
    const r = p.getBoundingClientRect()
    if (r.left < 0 || r.right > innerWidth) out.inside = false
    out.hits.push(...hitsOf(r))
    worst = Math.max(worst, delta(base, snap()))
    return { t, w: r.width, h: r.height, row: Boolean(p.querySelector('.adm-row')) }
  }

  const t0 = performance.now()
  trig.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  const open = await frames(700, watch)
  const final = open[open.length - 1].w
  const settled = open.find((f) => Math.abs(f.w - final) < 0.5)
  out.openMs = settled.t
  out.openSizes = new Set(open.filter((f) => f.w > open[0].w + 0.5 && f.w < final - 0.5).map((f) => Math.round(f.w))).size
  out.openMonotone = monotone(open.map((f) => f.w), 1)
  out.openFirst = open[0].w; out.openFinal = final
  out.radios = document.querySelectorAll('.admpick [role=radio]').length
  out.focusOk = document.activeElement && document.activeElement.getAttribute('aria-checked') === 'true'
  out.names = [...document.querySelectorAll('.admpick [role=radio]')].map((r) => r.getAttribute('aria-label')).join()
  out.right = document.querySelector('.admpick').getBoundingClientRect().right
  out.fits = [...document.querySelectorAll('.admpick [role=radio], .admpick .adm-opt-name')].every((e) => { const r = e.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth })
  out.rowW = document.querySelector('.adm-row').scrollWidth - document.querySelector('.adm-row').clientWidth

  const radio = document.querySelector('.admpick [role=radio][data-type="NOTE"]')
  const rr = radio.getBoundingClientRect()
  document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
  await new Promise((r) => requestAnimationFrame(r))
  const hitOnce = document.elementFromPoint(rr.left + rr.width / 2, rr.top + rr.height / 2)
  out.inert = !(hitOnce && hitOnce.closest('.adm-row'))
  const closing = await frames(500, watch)
  const first = closing[0].w
  const gone = closing.find((f) => !f.row)
  out.closeMs = gone ? gone.t : 9999
  out.closeMonotone = monotone(closing.filter((f) => f.row).map((f) => f.w), -1)
  out.closeSizes = new Set(closing.filter((f) => f.w < first - 0.5 && f.row).map((f) => Math.round(f.w))).size
  await sleep(100)
  out.delta = Math.max(worst, delta(base, snap()))
  out.textFocus = pm().contains(document.activeElement) || document.activeElement === pm()
  out.caretSame = JSON.stringify(base.caret) === JSON.stringify(snap().caret)
  // five quick «open → close»
  for (let i = 0; i < 5; i++) {
    trig.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    await sleep(60)
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    await sleep(60)
  }
  await sleep(400)
  out.rows = document.querySelectorAll('.adm-row').length
  out.pickers = document.querySelectorAll('.admpick').length
  out.afterQuick = delta(base, snap())
  return out
}
const colours = async () => {
  // the contrast of the word of every type and of its icon, in the theme of the page
  const trig = document.querySelector('.admpick')
  const out = []
  const bg = rgbOf(getComputedStyle(document.body).getPropertyValue('--ap-canvas') ? (() => { const d = document.createElement('div'); d.style.background = getComputedStyle(document.body).getPropertyValue('--ap-canvas'); document.body.append(d); const c = getComputedStyle(d).backgroundColor; d.remove(); return c })() : 'rgb(255,255,255)')
  for (const v of ['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION']) {
    const d = document.createElement('div'); d.setAttribute('data-variant', v); d.className = 'admpick'; d.style.cssText = 'position:static;color:var(--kw);border-color:var(--ke);background:var(--kb)'
    const i = document.createElement('i'); i.style.color = 'var(--ki)'; d.append(i); document.body.append(d)
    const cs = getComputedStyle(d)
    out.push({ v, word: ratio(rgbOf(cs.color), bg), icon: ratio(rgbOf(getComputedStyle(i).color), bg), chosen: ratio(rgbOf(getComputedStyle(d).getPropertyValue('--kt') ? (() => { const e = document.createElement('i'); e.style.color = 'var(--kt)'; d.append(e); return getComputedStyle(e).color })() : cs.color), rgbOf(cs.backgroundColor)) })
    d.remove()
  }
  return out
}
const reduced = async () => {
  const trig = document.querySelector('.admpick [data-cmd="admonition"]')
  const p = document.querySelector('.admpick')
  const w0 = p.getBoundingClientRect().width
  trig.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  const w1 = p.getBoundingClientRect().width
  const opt = document.querySelector('.admpick .adm-opt')
  const dur = [p, opt, document.querySelector('.adm-row')].map((e) => { const c = getComputedStyle(e); return [c.transitionDuration, c.animationDuration, c.animationName] })
  await sleep(100)
  const w2 = p.getBoundingClientRect().width
  return { w0, w1, w2, dur, media: matchMedia('(prefers-reduced-motion: reduce)').matches }
}
window.openPage = async (theme, long) => {
  document.body.className = 'vscode-' + theme
  document.body.setAttribute('data-nota-theme', theme)
  window.postMessage({ type: 'init', text: long ? ${JSON.stringify(LONG)} : ${JSON.stringify(TEXT)}, version: 1, fileName: 'a.adoc', locale: 'ru', outlineView: 'capsule', fileDir: '/tmp', mode: 'visual' }, '*')
  for (let i = 0; i < 100 && !pm(); i++) await sleep(50)
  await sleep(500)
  return cases().length
}
window.runAll = async () => {
  const out = { width: innerWidth, runs: [], colours: [] }
  for (const c of cases().slice(0, ${COUNT})) out.runs.push(await caseRun(c))
  const c0 = cases()[0]; scroller().scrollTop += c0.k.getBoundingClientRect().top - 260; await sleep(200); select(c0.el()); await sleep(500)
  out.colours = await colours()
  return out
}
/** What the layer and its label are in every frame (the layer is outside what scrolls, so a late layer shows as a changing offset). */
const offsetNow = (lbl) => {
  const p = document.querySelector('.admpick')
  const r = lbl.getBoundingClientRect()
  const sc = scroller().getBoundingClientRect()
  const isles = document.querySelector('.ed-isles')
  const low = isles ? isles.getBoundingClientRect().top + parseFloat(isles.style.getPropertyValue('--tools-bottom') || '0') : 0
  const inView = r.top >= Math.max(sc.top, low) + 2 && r.bottom <= sc.bottom - 2
  const gone = r.bottom < Math.max(sc.top, low) || r.top > sc.bottom
  const q = p && p.getBoundingClientRect()
  return { has: Boolean(p), inView, gone, dy: q ? (q.top + q.bottom) / 2 - (r.top + r.bottom) / 2 : 0, dx: q ? q.left - r.left : 0, scroll: scroller().scrollTop, hidden: p ? getComputedStyle(p).visibility === 'hidden' : true }
}
window.prepareFrames = async () => {
  const c = cases()[1]
  // (the focus of the editor may move the page: the cursor first, the scroll after it)
  select(c.el()); await sleep(300)
  scroller().scrollTop += c.k.getBoundingClientRect().top - 300
  await sleep(500)
  window.__lbl = c.k.querySelector('.adm-lbl')
  return { max: scroller().scrollHeight - scroller().clientHeight, has: Boolean(document.querySelector('.admpick')), top: scroller().scrollTop, n: 0, lbl: Boolean(window.__lbl), r: window.__lbl && arr(window.__lbl.getBoundingClientRect()), sel: getSelection().anchorNode && getSelection().anchorNode.parentElement.className }
}
window.recordFrames = (ms) => frames(ms, () => offsetNow(window.__lbl))
window.shiftAbove = async (ms) => {
  // the blocks above the label move with no transaction: the padding of the page grows and shrinks, an element above changes its height
  const sc = scroller(); const inner = pm().parentElement
  const run = frames(ms, () => offsetNow(window.__lbl))
  await sleep(120); inner.style.paddingTop = '70px'
  await sleep(150); pm().firstElementChild.style.marginBottom = '45px'
  await sleep(150); inner.style.paddingTop = '10px'
  await sleep(150); pm().firstElementChild.style.marginBottom = ''
  const out = await run
  inner.style.paddingTop = ''
  return out
}
window.hideAbove = async () => {
  const sc = scroller()
  sc.scrollTop = 0
  await sleep(300)
  return offsetNow(window.__lbl)
}
window.runReduced = async () => {
  const c = cases()[0]
  scroller().scrollTop += c.k.getBoundingClientRect().top - 260
  await sleep(200); select(c.el()); await sleep(500)
  return reduced()
}
`

interface Run {
  name: string
  ok: boolean
  why?: string
  hits: string[]
  baseHits: string[]
  inside: boolean
  titles: number
  openMs: number
  openSizes: number
  openMonotone: boolean
  radios: number
  focusOk: boolean
  names: string
  fits: boolean
  inert: boolean
  closeMs: number
  closeMonotone: boolean
  delta: number
  textFocus: boolean
  caretSame: boolean
  rows: number
  pickers: number
  afterQuick: number
}
interface Colour { v: string; word: number; icon: number; chosen: number }
interface Result {
  width: number
  runs: Run[]
  colours: Colour[]
}
interface Frame { has: boolean; inView: boolean; gone: boolean; dy: number; dx: number; scroll: number; hidden: boolean }
interface Reduced { w0: number; w1: number; w2: number; dur: string[][]; media: boolean }


const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** A page of a real Chrome driven through the DevTools protocol (a pipe: fd 3 to Chrome, fd 4 from it, messages end with NUL). Real time: the transitions run as they do for a user. */
class Tab {
  private out!: Writable
  private n = 0
  private waiting = new Map<number, (v: { result?: unknown; error?: { message: string } }) => void>()
  private session = ''
  private chrome!: ChromeHandle
  private dir = ''

  async open(width: number, theme: string, reduce: boolean, long = false): Promise<void> {
    this.dir = mkdtempSync(join(tmpdir(), 'nota-admpick-'))
    const css = readFileSync(at('../../../react/src/style.css'), 'utf8') + '\n' + readFileSync(at('../../src/webview/style.css'), 'utf8')
    writeFileSync(join(this.dir, 'webview.js'), await tabBundle())
    writeFileSync(join(this.dir, 'style.css'), css)
    writeFileSync(
      join(this.dir, 'p.html'),
      `<!doctype html><html lang="ru"><head><meta charset="utf-8"><link rel="stylesheet" href="style.css"></head><body class="vscode-${theme}" data-nota-theme="${theme}"><div id="app" class="nota" data-mermaid=""></div>
<script>window.acquireVsCodeApi=()=>({postMessage(){},getState:()=>null,setState(){}})</script>
<script src="webview.js"></script><script>${PAGE_SCRIPT}</script></body></html>`,
    )
    this.chrome = await launchChrome({ chrome: CHROME!, prefix: 'admpick', args: ['--headless=new', '--disable-gpu', '--allow-file-access-from-files', '--no-first-run', '--remote-debugging-pipe', `--window-size=${width},${HEIGHT}`, 'about:blank'] })
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
    const { targetId } = (await this.send('Target.createTarget', { url: 'about:blank' })) as { targetId: string }
    this.session = ((await this.send('Target.attachToTarget', { targetId, flatten: true })) as { sessionId: string }).sessionId
    await this.send('Emulation.setDeviceMetricsOverride', { width, height: HEIGHT, deviceScaleFactor: 1, mobile: false })
    if (reduce) await this.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
    await this.send('Page.navigate', { url: `file://${join(this.dir, 'p.html')}` })
    for (let i = 0; i < 100; i++) {
      if ((await this.ev('typeof window.openPage').catch(() => 'undefined')) === 'function') break
      await wait(100)
    }
    await this.ev(`window.openPage(${JSON.stringify(theme)}, ${long})`)
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

  async close(): Promise<void> {
    await this.chrome?.close()
    rmSync(this.dir, { recursive: true, force: true })
  }
}

describe.skipIf(!CHROME)('the choice of the type of an admonition (real Chrome)', () => {
  const TABS: [number, 'dark' | 'light'][] = [[390, 'dark'], [390, 'light'], [700, 'dark'], [700, 'light'], [1280, 'dark'], [1280, 'light']]
  for (const [width, theme] of TABS) {
    it(`a tab of ${width} px, ${theme} theme: nothing is crossed, nothing moves, the motion is as before, all inside`, { timeout: 280_000, retry: 2 }, async () => {
      const tab = new Tab()
      let r: Result
      try {
        await tab.open(width, theme, false)
        r = await tab.ev<Result>('window.runAll()')
      } finally {
        await tab.close()
      }
      expect(r.runs).toHaveLength(COUNT)
      for (const run of r.runs) {
        const at = `${run.name}`
        expect([at, run.ok, run.why]).toEqual([at, true, undefined])
        // nothing is crossed (the button, the row), the document stands
        expect([at, run.baseHits]).toEqual([at, []])
        expect([at, run.hits]).toEqual([at, []])
        expect([at, run.delta <= 0.5, run.caretSame]).toEqual([at, true, true])
        expect([at, run.afterQuick <= 0.5]).toEqual([at, true])
        // no hint of the browser
        expect([at, run.titles]).toEqual([at, 0])
        // five types, the focus on the current one, the motion
        expect([at, run.radios]).toEqual([at, 5])
        expect([at, run.focusOk]).toEqual([at, true])
        expect([at, run.openMs >= 160 && run.openMs <= 260, run.openMs]).toEqual([at, true, run.openMs])
        expect([at, run.openSizes >= 3, run.openMonotone]).toEqual([at, true, true])
        expect([at, run.closeMs <= 200, run.closeMs]).toEqual([at, true, run.closeMs])
        expect([at, run.closeMonotone, run.inert]).toEqual([at, true, true])
        expect([at, run.textFocus]).toEqual([at, true])
        expect([at, run.rows, run.pickers]).toEqual([at, 0, 1])
        // all inside the tab
        expect([at, run.inside, run.fits]).toEqual([at, true, true])
      }
      // the word of the type 4.5:1, the icon 3:1, the chosen one on its colour 4.5:1
      expect(r.colours).toHaveLength(5)
      for (const c of r.colours) expect([c.v, c.word >= 4.5, c.icon >= 3, c.chosen >= 4.5, c]).toEqual([c.v, true, true, true, c])
    })
  }

  it('the layer stands on its label in every frame: wheel scroll, and shifts above with no edit of the text', { timeout: 280_000, retry: 2 }, async () => {
    const tab = new Tab()
    let wheel: Frame[]
    let shifts: Frame[]
    let top: Frame
    let ready: { max: number; has: boolean; top: number; n?: number }
    try {
      await tab.open(700, 'light', false, true)
      ready = await tab.ev<typeof ready>('window.prepareFrames()')
      // a real wheel: Chrome scrolls on its compositor, a frame ahead of what the page script sees
      const rec = tab.ev<Frame[]>('window.recordFrames(1500)')
      for (let i = 0; i < 12; i++) {
        await tab.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 300, y: 300, deltaX: 0, deltaY: i < 6 ? 40 : -40 })
        await wait(60)
      }
      wheel = await rec
      shifts = await tab.ev<Frame[]>('window.shiftAbove(1000)')
      top = await tab.ev<Frame>('window.hideAbove()')
    } finally {
      await tab.close()
    }
    expect(JSON.stringify(ready)).toContain('"has":true')
    expect(ready.max).toBeGreaterThan(100)
    for (const [name, list] of [['wheel', wheel], ['shifts', shifts]] as const) {
      const on = list.filter((f) => f.has && !f.hidden)
      expect([name, on.length > 20]).toEqual([name, true])
      const dys = on.map((f) => f.dy)
      const dxs = on.map((f) => f.dx)
      expect([name, Math.max(...dys) - Math.min(...dys) <= 0.5, dys]).toEqual([name, true, dys])
      expect([name, Math.max(...dxs) - Math.min(...dxs) <= 0.5, dxs]).toEqual([name, true, dxs])
      // while the label is plainly in view the layer is there
      expect([name, list.filter((f) => f.inView && !f.has)]).toEqual([name, []])
      // and not where the label is out of sight
      expect([name, list.filter((f) => f.gone && f.has && !f.hidden)]).toEqual([name, []])
    }
    expect(new Set(wheel.map((f) => f.scroll)).size).toBeGreaterThan(3)
    // the label is far above: the layer is gone
    expect([top.gone, top.has && !top.hidden]).toEqual([true, false])
  })

  it('prefers-reduced-motion: the final look is in the first frame, no duration', { timeout: 60_000 }, async () => {
    const tab = new Tab()
    let r: Reduced
    try {
      await tab.open(1280, 'dark', true)
      r = await tab.ev<Reduced>('window.runReduced()')
    } finally {
      await tab.close()
    }
    expect(r.media).toBe(true)
    expect(r.w1).toBeGreaterThan(r.w0 + 50)
    expect(r.w2).toBeCloseTo(r.w1, 0)
    for (const [transition, animation, name] of r.dur) expect([transition, animation === '0s' || name === 'none']).toEqual(['0s', true])
  })
})
