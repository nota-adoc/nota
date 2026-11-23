// the strokes and the panel «Разделы» of a wide tab and the card of a narrow one, measured in a real Chrome (jsdom has no layout), on the real
// bundle of the tab, its real style sheet and the file `quality/fixtures/editor/many-sections.adoc` (153 sections). The page runs the cases and writes
// what it measured into the title; this file says what is right. Skipped where Chrome is not installed.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { CHROME_QUEUE_MS, holdChromeSlot } from './chrome.js'
import { chromeDump } from './chrome-dump.js'
import { tabBundle } from './bundle.js'

const CHROME = [process.env.CHROME_BIN ?? '', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => p && existsSync(p))

// the wait for a slot of Chrome is not part of a test: the file takes its slot first, and a test holds only its own work
// (the limit of the work is `chromeDump(…, timeout)`, the limit of the wait is `CHROME_QUEUE_MS`)
if (CHROME) beforeAll(() => holdChromeSlot(), CHROME_QUEUE_MS + 10_000)
const here = import.meta.dirname
const at = (path: string): string => join(here, path)
const FIXTURES = at('../../../../quality/fixtures/editor')
const MANY = readFileSync(join(FIXTURES, 'many-sections.adoc'), 'utf8')
const SHORT = readFileSync(join(FIXTURES, 'structure.adoc'), 'utf8')
/** What is left of the long document after the author deleted the sections: five of them. */
const SHORT_OF_MANY = MANY.split(/\n(?=={2} )/).slice(0, 6).join('\n')

type Suite = 'wide' | 'geometry' | 'narrow' | 'short' | 'shrink' | 'dynamic'
interface Config { suite: Suite; width: number; height: number; theme: 'dark' | 'light'; reduced?: boolean }

/** The page that runs the cases inside Chrome and writes what it measured into the title. */
const runner = (cfg: Config, text: string, next = ''): string => `
const CFG = ${JSON.stringify(cfg)}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const out = { width: 0, height: 0, step: '' }
const box = (e) => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height } }
const q = (s) => document.querySelector(s)
const shown = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && !e.closest('[hidden]') }
const rgb = (c) => {
  const m = /color\\(srgb ([\\d.]+) ([\\d.]+) ([\\d.]+)(?: \\/ ([\\d.]+))?\\)/.exec(c)
  if (m) return [m[1] * 255, m[2] * 255, m[3] * 255, m[4] === undefined ? 1 : Number(m[4])]
  const n = c.match(/[\\d.]+/g).map(Number)
  return [n[0], n[1], n[2], n[3] === undefined ? 1 : n[3]]
}
const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]) }
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) }
const over = (a, b) => Math.min(a.r, b.r) - Math.max(a.l, b.l) > 0.5 && Math.min(a.b, b.b) - Math.max(a.t, b.t) > 0.5
const card = () => q('.sections-card')
const strokes = () => q('.isle-strokes')
const scroller = () => q('.ed-visual')
const heading = (n) => [...document.querySelectorAll('.ProseMirror h2')].find((h) => h.textContent.startsWith('code = ' + n + '.'))
// (headless Chrome in virtual time draws no frames, so the scroll event does not come by itself)
const scrollHeadingTo = async (n, y) => { const h = heading(n); scroller().scrollTop += h.getBoundingClientRect().top - y; scroller().dispatchEvent(new Event('scroll')); await sleep(250) }
const current = () => card().querySelector('.tree-item.on')
const mouse = (el, type) => el.dispatchEvent(new MouseEvent(type))
/** The visible part of the panel: the box and the clip (inset(t r b l round …)). */
const snap = (t) => {
  const c = card(), cs = getComputedStyle(c), r = c.getBoundingClientRect()
  const cp = cs.clipPath && cs.clipPath !== 'none' ? cs.clipPath.split('round')[0] : ''
  const v = (cp.match(/-?[\\d.]+/g) || ['0']).map(Number)
  const [ct, cr, cb, cl] = v.length === 1 ? [v[0], v[0], v[0], v[0]] : v.length === 2 ? [v[0], v[1], v[0], v[1]] : v.length === 3 ? [v[0], v[1], v[2], v[1]] : v
  const nm = c.querySelector('.tree-name').getBoundingClientRect()
  return { t, x: r.left + cl, y: r.top + ct, w: r.width - cl - cr, h: r.height - ct - cb, nx: nm.left, nw: nm.width, vis: cs.visibility !== 'hidden', hidden: c.hidden }
}
/** Headless Chrome in virtual time draws no frames, so no transition advances by itself: the transition of the clip is paused and set to 0, 16, 32 … ms by hand. */
const clipTransition = () => card().getAnimations().filter((a) => a.transitionProperty === 'clip-path')[0]
const play = () => {
  const a = clipTransition()
  if (!a) return { dur: 0, fr: [snap(0)] }
  const dur = a.effect.getComputedTiming().duration
  a.pause()
  const fr = []
  for (let t = 0; t <= dur + 16; t += 16) { a.currentTime = Math.min(t, dur); fr.push(snap(t)) }
  return { dur, fr }
}
const settle = () => card().getAnimations().forEach((a) => a.finish())
const stats = (fr) => ({ n: fr.length, x: same(fr.map((f) => f.x), 1), y: same(fr.map((f) => f.y), 1), h: same(fr.map((f) => f.h), 1), nx: same(fr.map((f) => f.nx), 0.5), nw: same(fr.map((f) => f.nw), 0.5), widths: fr.map((f) => Math.round(f.w)), first: fr.length ? fr[0].w : -1, last: fr.length ? fr[fr.length - 1].w : -1 })
const same = (a, tol) => Math.max(...a) - Math.min(...a) <= tol
const nonDecreasing = (a) => a.every((v, i) => i === 0 || v >= a[i - 1] - 0.5)
const nonIncreasing = (a) => a.every((v, i) => i === 0 || v <= a[i - 1] + 0.5)

const geometry = (o) => {
  const s = strokes(), sb = box(s), tools = box(q('.isle-mid .isle-tools')), remarks = q('.isle-right .isle') ? box(q('.isle-right .isle')) : null
  const tab = box(q('.ed-main')), row = box(q('.isle-mid'))
  o.dbg = { tab, sb, ow: document.documentElement.clientWidth, app: box(q('#app')) }
  o.strokes = { l: sb.l - tab.l, t: sb.t - tab.t, b: tab.b - sb.b, h: sb.h, toolsTop: tools.t - tab.t, toolsLeft: tools.l - tab.l, rowBottom: row.b - tab.t }
  const marks = [...s.querySelectorAll('.stroke')].map(box)
  o.marks = { n: marks.length, inside: marks.every((m) => m.t >= sb.t + 1 - 0.01 && m.b <= sb.b - 1 + 0.01 && m.l >= sb.l && m.r <= sb.r), gaps: marks.slice(1).map((m, i) => +(m.t - marks[i].b).toFixed(2)), first: marks[0] ? marks[0].t - sb.t : -1, last: marks.length ? sb.b - marks[marks.length - 1].b : -1, step: marks.length > 1 ? +(marks[1].t - marks[0].t).toFixed(2) : 0 }
  const c = card(), cb = box(c)
  o.panel = { l: cb.l - tab.l, t: cb.t - tab.t, h: cb.h, w: cb.w, hidden: c.hidden, tab: tab.h, overTools: over(cb, tools), overRemarks: remarks ? over(cb, remarks) : false, over: over(cb, tools) }
  const list = c.querySelector('.tree-list')
  o.list = { scroll: list.scrollHeight, client: list.clientHeight, head: c.querySelector('.card-head').getBoundingClientRect().height }
}

setInterval(() => { if (!document.title.startsWith('RES')) document.title = 'PROG ' + out.step }, 100)
const run = async () => {
  document.body.className = 'vscode-' + CFG.theme
  window.postMessage({ type: 'init', text: ${JSON.stringify(text)}, version: 1, fileName: 'a.adoc', locale: 'ru', outlineView: 'capsule', fileDir: '/tmp', mode: 'visual' }, '*')
  for (let i = 0; i < 50 && !q('.ProseMirror'); i++) await sleep(100)
  await sleep(600)
  Object.assign(out, { width: innerWidth, height: innerHeight, reduced: matchMedia('(prefers-reduced-motion: reduce)').matches })
  out.step = 'closed'
  if (CFG.suite === 'narrow') {
    out.strokes = { shown: shown(strokes()) }
    await scrollHeadingTo(77, 150)
    const isle = q('.isle-sections'); isle.click(); await sleep(400)
    card().getAnimations().forEach((a) => a.finish())
    const cb = box(card()), tab = box(q('.ed-main')), list = card().querySelector('.tree-list'), lb = box(list)
    out.dbg = { cb: box(card()), tab: box(q('.ed-main')) }
    out.narrow = { l: cb.l - tab.l, r: tab.r - cb.r, bottom: tab.b - cb.b, overTools: over(cb, box(q('.isle-mid .isle-tools'))), name: current() ? current().textContent : '', rowInside: current() ? (() => { const r = box(current()); return r.t >= lb.t - 0.5 && r.b <= lb.b + 0.5 })() : false, bg: current() ? getComputedStyle(current()).backgroundColor : '', weight: current() ? getComputedStyle(current()).fontWeight : '' }
    const names = [...card().querySelectorAll('.tree-name')].map((n) => ({ h: n.clientHeight, sh: n.scrollHeight, lh: parseFloat(getComputedStyle(n).lineHeight), title: n.parentElement.title === n.textContent }))
    out.names = { max: Math.max(...names.map((n) => n.h / n.lh)), clamped: names.filter((n) => n.sh > n.h + 1).length, two: names.filter((n) => n.h > n.lh * 1.5).length, titles: names.every((n) => n.title) }
    out.step = 'done'
    document.title = 'RES ' + JSON.stringify(out)
    return
  }
  geometry(out)
  if (CFG.suite === 'shrink') {
    // 153 sections, the panel pinned and as high as it can be; then the author deletes sections: 5 are left, the panel must shrink with them
    strokes().click(); await sleep(500)
    geometry(out)
    out.before = { panelH: box(card()).h, railH: box(strokes()).h, marks: document.querySelectorAll('.isle-strokes .stroke').length }
    window.postMessage({ type: 'reset', text: ${JSON.stringify(next)}, version: 2, stale: false }, '*')
    await sleep(800)
    if (card().hidden) strokes().click()
    await sleep(500)
    geometry(out)
    out.after = { panelH: box(card()).h, railH: box(strokes()).h, marks: document.querySelectorAll('.isle-strokes .stroke').length, rows: card().querySelectorAll('.tree-item').length }
    out.step = 'done'
    document.title = 'RES ' + JSON.stringify(out)
    return
  }
  if (CFG.suite === 'dynamic') {
    // the document is scrolled from the start to the end (the strokes stand still), then the tab is made lower and higher again (they follow within a frame)
    const s = scroller(), tops = []
    for (const f of [0, 0.25, 0.5, 0.75, 1]) {
      s.scrollTop = f * (s.scrollHeight - s.clientHeight); s.dispatchEvent(new Event('scroll')); await sleep(250)
      tops.push({ t: box(strokes()).t, h: box(strokes()).h })
    }
    out.scroll = tops
    const app = q('#app'), steps = []
    for (const h of [CFG.height, CFG.height - 200, CFG.height]) {
      app.style.height = h + 'px'; window.dispatchEvent(new Event('resize')); await sleep(40)
      const g = {}; geometry(g); steps.push({ h, tab: g.panel.tab, t: g.strokes.t, sh: g.strokes.h, rowBottom: g.strokes.rowBottom })
    }
    out.resize = steps
    out.step = 'done'
    document.title = 'RES ' + JSON.stringify(out)
    return
  }
  if (CFG.suite === 'geometry' || CFG.suite === 'short') {
    // pinned and open: the open panel and the strokes are one height
    strokes().click(); await sleep(500)
    geometry(out)
    out.open = { railH: box(strokes()).h, panelH: box(card()).h, panelT: box(card()).t, railT: box(strokes()).t }
    out.step = 'done'
    document.title = 'RES ' + JSON.stringify(out)
    return
  }
  out.step = 's1'; // ---- the colours, closed
  const st = getComputedStyle(strokes())
  const bg = rgb(st.backgroundColor)
  const on = q('.isle-strokes .stroke.on')
  out.marksOn = { count: document.querySelectorAll('.isle-strokes .stroke.on').length }
  out.step = 's2'; // ---- heading 77 in the top third
  await scrollHeadingTo(77, 150)
  const on77 = q('.isle-strokes .stroke.on')
  const sb = box(strokes())
  const idx = Number(on77 ? on77.dataset.index : -1)
  out.k5 = { stroke: Boolean(on77), strokeInside: on77 ? box(on77).t >= sb.t && box(on77).b <= sb.b : false, covers77: idx <= 76 && 76 < idx + (document.querySelectorAll('.isle-strokes .stroke').length < 153 ? Math.ceil(153 / document.querySelectorAll('.isle-strokes .stroke').length) : 1), idx, count: document.querySelectorAll('.isle-strokes .stroke').length, name: current() ? current().textContent.slice(0, 12) : '' }
  const onColor = on77 ? rgb(getComputedStyle(on77).backgroundColor) : [0, 0, 0, 1]
  const plain = rgb(getComputedStyle(document.querySelectorAll('.isle-strokes .stroke')[0]).backgroundColor)
  out.k9 = { strokeContrast: ratio(onColor, bg), differs: onColor.join() !== plain.join(), bgAlpha: bg[3] }
  // open by hovering: the row 77 is whole in the list, painted, not like a hover
  mouse(strokes(), 'mouseenter'); await sleep(600)
  const list = card().querySelector('.tree-list'), lb = box(list), row = current(), rb = box(row)
  const hoverBg = (() => { const d = document.createElement('div'); d.style.background = 'var(--ap-chrome-hover)'; document.body.append(d); const c = getComputedStyle(d).backgroundColor; d.remove(); return rgb(c) })()
  const rowBg = rgb(getComputedStyle(row).backgroundColor), cardBg = rgb(getComputedStyle(card()).backgroundColor)
  const other = [...list.querySelectorAll('.tree-item:not(.on)')][0]
  out.k5.row = { name: row.textContent.slice(0, 12), whole: rb.t >= lb.t - 0.5 && rb.b <= lb.b + 0.5, rb: [rb.t, rb.b], lb: [lb.t, lb.b], st: list.scrollTop, sh: list.scrollHeight, bg: rowBg.join(), notHover: rowBg.join() !== hoverBg.join() && rowBg[3] > 0.5, weight: getComputedStyle(row).fontWeight, middle: Math.abs((rb.t + rb.h / 2) - (lb.t + lb.h / 2)) }
  out.k9.text = { on: ratio(rgb(getComputedStyle(row).color), rowBg), plain: ratio(rgb(getComputedStyle(other).color), cardBg), onBgDiffersFromPlain: rowBg.join() !== cardBg.join() }
  out.step = 's3'; // ---- the names
  const names = [...card().querySelectorAll('.tree-name')].map((n) => ({ h: n.clientHeight, sh: n.scrollHeight, lh: parseFloat(getComputedStyle(n).lineHeight), title: n.parentElement.title === n.textContent, x: n.getBoundingClientRect().left }))
  out.names = { max: Math.max(...names.map((n) => n.h / n.lh)), clamped: names.filter((n) => n.sh > n.h + 1).length, two: names.filter((n) => n.h > n.lh * 1.5 && n.sh <= n.h + 1).length, one: names.filter((n) => n.h <= n.lh * 1.5).length, titles: names.every((n) => n.title) }
  // the scrollbar: round, thin, no arrows
  const sbw = list.offsetWidth - list.clientWidth
  out.bar = { width: sbw, css: getComputedStyle(list, '::-webkit-scrollbar').width, button: getComputedStyle(list, '::-webkit-scrollbar-button').display, radius: getComputedStyle(list, '::-webkit-scrollbar-thumb').borderRadius }
  mouse(strokes(), 'mouseleave'); await sleep(800)
  out.k5.closedAfter = card().hidden
  out.step = 's4'; // ---- the beginning of the document
  await scrollHeadingTo(1, 150)
  out.k5.first = current() ? current().textContent.slice(0, 11) : ''
  out.step = 's5'; // ---- a pinned panel follows the document, the list that was scrolled by hand stays
  strokes().click(); await sleep(500)
  out.follow = []
  for (const n of [10, 30, 60, 90, 120]) {
    await scrollHeadingTo(n, 150)
    const l = card().querySelector('.tree-list'), lbx = box(l), r = box(current())
    out.follow.push({ n, name: current().textContent.slice(0, 14), whole: r.t >= lbx.t - 0.5 && r.b <= lbx.b + 0.5 })
  }
  const l2 = card().querySelector('.tree-list')
  l2.scrollTop = 0; l2.dispatchEvent(new Event('scroll')); await sleep(300)
  out.k5.handScroll = l2.scrollTop
  strokes().click(); await sleep(500)
  out.k5.closedByClick = card().hidden
  out.step = 's6'; // ---- the reveal to the right, in frames played by hand
  settle()
  out.idle = { hidden: card().hidden, vis: snap(0).vis }
  mouse(strokes(), 'mouseenter'); await sleep(200)
  const po = play()
  const so = stats(po.fr.filter((f) => f.vis))
  out.open = { ...so, dur: po.dur, grows: nonDecreasing(so.widths) }
  settle()
  out.step = 's7'; // ---- the fold
  mouse(strokes(), 'mouseleave'); await sleep(400)
  const pc = play()
  const sc = stats(pc.fr.filter((f) => f.vis))
  out.close = { ...sc, dur: pc.dur, shrinks: nonIncreasing(sc.widths) }
  settle()
  out.close.hiddenAfter = { hidden: card().hidden, vis: snap(0).vis }
  // fold, and the mouse comes back in the middle of it
  strokes().click(); await sleep(100); settle()
  strokes().click()
  const folding = clipTransition()
  if (folding) { folding.pause(); folding.currentTime = 85 }
  const before = snap(0).w
  strokes().click()
  const pa = play()
  const wd = pa.fr.map((f) => f.w)
  out.again = { before, grows: nonDecreasing(wd), minAfter: Math.min(...wd), first: wd[0], widths: wd.map((w) => Math.round(w)) }
  settle()
  strokes().click(); await sleep(100); settle()
  out.step = 's8'; // ---- ten quick passes in two seconds
  for (let i = 0; i < 10; i++) { mouse(strokes(), 'mouseenter'); await sleep(i % 2 ? 160 : 90); mouse(strokes(), 'mouseleave'); await sleep(i % 2 ? 40 : 110) }
  await sleep(1200)
  settle()
  const rest = snap(0)
  out.stress = { hidden: card().hidden, vis: rest.vis, w: rest.w, closing: card().classList.contains('closing') }
  out.step = 'done'
  document.title = 'RES ' + JSON.stringify(out)
}
run().catch((e) => { document.title = 'RES ' + JSON.stringify({ error: String(e && e.stack || e) + ' (at ' + out.step + ')' }) })
`

// asynchronous: a synchronous spawn blocks the event loop of the worker for the whole run of Chrome, and the call "onTaskUpdate" of vitest times out after 60 s
const chromeOut = (args: string[]): Promise<string> => chromeDump(CHROME!, args)
let version: string | undefined
const chromeVersion = (): string => (version ??= execFileSync(CHROME!, ['--version'], { encoding: 'utf8' }).trim())
/** One Chrome at a time, the one the slot of the file holds (a second one would wait for the machine inside a test); each Chrome needs a core for its virtual time. */
let running = 0
const waiting: (() => void)[] = []
async function limited<T>(job: () => Promise<T>): Promise<T> {
  while (running >= 1) await new Promise<void>((r) => waiting.push(r))
  running++
  try {
    return await job()
  } finally {
    running--
    waiting.shift()?.()
  }
}
const frames = new Map<number, number>()
/** How many px of `--window-size` Chrome keeps for itself (see `overlap-layout.test.ts`). */
async function frameHeight(height: number): Promise<number> {
  const known = frames.get(height)
  if (known !== undefined) return known
  const dir = mkdtempSync(join(tmpdir(), 'nota-frame-'))
  try {
    writeFileSync(join(dir, 'p.html'), '<!doctype html><title></title><script>document.title = "H " + innerHeight</script>')
    const html = await chromeDump(CHROME!, ['--headless=new', '--disable-gpu', `--window-size=1280,${height}`, '--dump-dom', `file://${join(dir, 'p.html')}`], 30_000).catch(() => '')
    const m = /<title>H (\d+)<\/title>/.exec(html)
    const v = m ? Math.max(0, height - Number(m[1])) : 0
    frames.set(height, v)
    return v
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}


// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Result = any

async function measureTab(cfg: Config): Promise<Result> {
  return limited(() => measureTabNow(cfg))
}
async function measureTabNow(cfg: Config): Promise<Result> {
  const css = readFileSync(at('../../../react/src/style.css'), 'utf8') + '\n' + readFileSync(at('../../src/webview/style.css'), 'utf8')
  const dir = mkdtempSync(join(tmpdir(), 'nota-sections-'))
  try {
    writeFileSync(join(dir, 'webview.js'), await tabBundle())
    writeFileSync(join(dir, 'style.css'), css)
    writeFileSync(
      join(dir, 'p.html'),
      `<!doctype html><html lang="ru"><head><meta charset="utf-8"><link rel="stylesheet" href="style.css"></head><body class="vscode-${cfg.theme}" data-nota-theme="${cfg.theme}"><div id="app" class="nota" data-mermaid="" style="width:${cfg.width}px"></div>
<script>window.acquireVsCodeApi=()=>({postMessage(){},getState:()=>null,setState(){}})
// headless Chrome in virtual time draws no frames, so «requestAnimationFrame» never calls back: a timer of one frame stands in for it
window.requestAnimationFrame = (f) => setTimeout(() => f(performance.now()), 16); window.cancelAnimationFrame = (id) => clearTimeout(id)</script>
<script src="webview.js"></script><script>${runner(cfg, cfg.suite === 'short' ? SHORT : MANY, SHORT_OF_MANY)}</script></body></html>`,
    )
    const args = ['--headless=new', '--disable-gpu', '--allow-file-access-from-files', `--window-size=${cfg.width},${cfg.height + (await frameHeight(cfg.height))}`, '--virtual-time-budget=120000', '--dump-dom']
    if (cfg.reduced) args.splice(2, 0, '--force-prefers-reduced-motion')
    const html = await chromeOut([...args, `file://${join(dir, 'p.html')}`])
    const m = /<title>RES ([^<]*)<\/title>/.exec(html)
    if (!m) throw new Error(`the page did not report (${/<title>([^<]*)<\/title>/.exec(html)?.[1]})`)
    return JSON.parse(m[1]!.replaceAll('&quot;', '"').replaceAll('&amp;', '&').replaceAll('&gt;', '>').replaceAll('&lt;', '<'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const where = (r: Result, cfg: Config): string => `${chromeVersion()}, ${JSON.stringify(cfg)}, page ${r.width}x${r.height} ${JSON.stringify(r.dbg)}`
const ok = (r: Result, cfg: Config): void => {
  expect(r.error, where(r, cfg)).toBeUndefined()
  expect(r.step, where(r, cfg)).toBe('done')
  expect(r.height, where(r, cfg)).toBe(cfg.height)
}

/** the strokes stand in the middle of the tab's height, held between «row of capsules + 8 px» and «bottom − 16 px». */
const placed = (s: { t: number; h: number }, tab: number, rowBottom: number, w: string): void => {
  const minTop = rowBottom + 8
  const want = Math.max(minTop, Math.min((tab - s.h) / 2, tab - 16 - s.h))
  expect(s.t, `${w} want top ${want}`).toBeGreaterThanOrEqual(minTop - 1)
  expect(tab - (s.t + s.h), w).toBeGreaterThanOrEqual(16 - 1)
  expect(Math.abs(s.t - want), `${w} top ${s.t}, want ${want}`).toBeLessThanOrEqual(1)
}
/** The strokes lie inside the open panel, in its left column. */
const inside = (r: Result, w: string): void => {
  expect(r.open.railT, w).toBeGreaterThanOrEqual(r.open.panelT - 1)
  expect(r.open.railT + r.open.railH, w).toBeLessThanOrEqual(r.open.panelT + r.open.panelH + 1)
}

describe.skipIf(!CHROME)('the strokes and the panel «Разделы» in a real Chrome', () => {
  describe('a wide tab (1280×800), both themes', () => {
    for (const theme of ['dark', 'light'] as const) {
      it(`${theme} theme`, { timeout: 180_000 }, async () => {
        const cfg: Config = { suite: 'wide', width: 1280, height: 800, theme }
        const r = await measureTab(cfg)
        const w = where(r, cfg)
        ok(r, cfg)
        // the strokes end 16 px above the bottom, the marks are whole inside, do not touch (gap ≥ 2 px), the first and the last are there
        expect(r.strokes.b, w).toBeGreaterThanOrEqual(16)
        expect(r.marks.inside, w).toBe(true)
        expect(Math.min(...r.marks.gaps), w).toBeGreaterThanOrEqual(2)
        expect(r.marks.n, w).toBeGreaterThan(40)
        expect(r.marks.n, w).toBeLessThan(153)
        expect(r.marks.first, w).toBeGreaterThanOrEqual(1)
        expect(r.marks.last, w).toBeGreaterThanOrEqual(1)
        // in the middle of the tab, or at a limit; the left edge is 14 px
        placed(r.strokes, r.panel.tab, r.strokes.rowBottom, w)
        expect(r.strokes.l, w).toBeCloseTo(14, 0)
        expect(r.panel.l, w).toBeCloseTo(14, 0)
        expect(Math.abs(r.panel.t - r.strokes.t), w).toBeLessThanOrEqual(1)
        // the panel is not higher than 560 px and than «tab − row − 24 px»; it is as high as the strokes (one frame)
        expect(r.panel.h, w).toBeLessThanOrEqual(560.5)
        expect(r.panel.h, w).toBeLessThanOrEqual(r.panel.tab - r.strokes.rowBottom - 24 + 0.5)
        expect(Math.abs(r.panel.h - r.strokes.h), w).toBeLessThanOrEqual(1)
        expect(r.list.scroll, w).toBeGreaterThan(r.list.client)
        expect(r.k5.stroke, w).toBe(true)
        expect(r.k5.strokeInside, w).toBe(true)
        expect(r.k5.covers77, `${w} ${JSON.stringify(r.k5)}`).toBe(true)
        expect(r.k5.row.name, w).toMatch(/^code = 77\./)
        expect(r.k5.row.whole, `${w} ${JSON.stringify(r.k5.row)}`).toBe(true)
        expect(r.k5.row.notHover, w).toBe(true)
        expect(r.k5.row.middle, w).toBeLessThan(40)
        expect(Number(r.k5.row.weight), w).toBeGreaterThanOrEqual(600)
        expect(r.k5.first, w).toMatch(/^code = 1\./)
        expect(r.k5.handScroll, w).toBe(0)
        expect(r.k5.closedAfter, w).toBe(true)
        expect(r.k5.closedByClick, w).toBe(true)
        for (const f of r.follow) {
          expect(f.name, w).toMatch(new RegExp(`^code = ${f.n}\\.`))
          expect(f.whole, `${w} follow ${f.n}`).toBe(true)
        }
        // at most two lines, the long ones cut (a title carries the whole name), the others whole
        expect(r.names.max, w).toBeLessThanOrEqual(2.05)
        expect(r.names.clamped, w).toBeGreaterThan(0)
        expect(r.names.two, w).toBeGreaterThan(0)
        expect(r.names.one, w).toBeGreaterThan(0)
        expect(r.names.titles, w).toBe(true)
        // the scrollbar: thin, no arrows (the look of it is checked by hand)
        expect(r.bar.width, w).toBe(10)
        expect(r.bar.button, w).toBe('none')
        expect(parseFloat(r.bar.radius), w).toBeGreaterThan(0)
        expect(r.k9.strokeContrast, w).toBeGreaterThanOrEqual(3)
        expect(r.k9.differs, w).toBe(true)
        expect(r.k9.text.on, w).toBeGreaterThanOrEqual(4.5)
        expect(r.k9.text.plain, w).toBeGreaterThanOrEqual(4.5)
        expect(r.k9.text.onBgDiffersFromPlain, w).toBe(true)
        // left edge, top and height of the visible panel stand, the names do not move, the width only grows, 220 ms
        expect(r.idle.hidden, w).toBe(true)
        expect(r.idle.vis, w).toBe(false)
        expect(r.open.n, w).toBeGreaterThan(10)
        expect(r.open.x && r.open.y && r.open.h, `${w} ${r.open.widths}`).toBe(true)
        expect(r.open.nx && r.open.nw, w).toBe(true)
        expect(r.open.grows, `${w} ${r.open.widths}`).toBe(true)
        expect(r.open.first, w).toBeLessThan(40)
        expect(r.open.first, w).toBeGreaterThan(30)
        expect(r.open.last, w).toBeGreaterThan(334)
        expect(Math.abs(r.open.dur - 220), w).toBeLessThanOrEqual(20)
        // the fold, 170 ms, the same left edge, top and height; the mouse back in the middle of it: the width goes on from where it was
        expect(Math.abs(r.close.dur - 170), w).toBeLessThanOrEqual(20)
        expect(r.close.x && r.close.y && r.close.h, `${w} ${r.close.widths}`).toBe(true)
        expect(r.close.shrinks, `${w} ${r.close.widths}`).toBe(true)
        expect(r.close.last, w).toBeLessThan(40)
        expect(r.close.hiddenAfter.vis, w).toBe(false)
        expect(r.again.grows, `${w} ${r.again.widths}`).toBe(true)
        expect(r.again.minAfter, `${w} ${r.again.widths}`).toBeGreaterThan(r.again.before - 1)
        expect(r.again.before, w).toBeGreaterThan(40)
        expect(r.again.before, w).toBeLessThan(335)
        expect(r.stress.hidden, w).toBe(true)
        expect(r.stress.vis, w).toBe(false)
        expect(r.stress.closing, w).toBe(false)
      })
    }
  })

  describe('the panel and the capsules do not cross at 761, 900, 1280 and 1920 px', () => {
    for (const [width, height] of [[761, 600], [900, 600], [900, 800], [1280, 800], [1920, 800], [1280, 360]] as const) {
      it(`a tab of ${width}×${height}`, { timeout: 120_000 }, async () => {
        const cfg: Config = { suite: 'geometry', width, height, theme: 'dark' }
        const r = await measureTab(cfg)
        const w = where(r, cfg)
        ok(r, cfg)
        expect(r.panel.overTools, w).toBe(false)
        expect(r.panel.overRemarks, w).toBe(false)
        expect(r.strokes.l, w).toBeCloseTo(14, 0)
        expect(r.panel.l, w).toBeCloseTo(14, 0)
        // in the middle of the tab, or at a limit; the panel as high and as low as the strokes
        placed(r.strokes, r.panel.tab, r.strokes.rowBottom, w)
        expect(Math.abs(r.open.panelT - r.open.railT), w).toBeLessThanOrEqual(1)
        expect(Math.abs(r.open.panelH - r.open.railH), w).toBeLessThanOrEqual(1)
        expect(r.panel.h, w).toBeLessThanOrEqual(560.5)
        expect(r.panel.t, w).toBeGreaterThanOrEqual(r.strokes.rowBottom + 8 - 1)
        expect(r.panel.tab - (r.panel.t + r.panel.h), w).toBeGreaterThanOrEqual(16 - 1)
        expect(r.strokes.b, w).toBeGreaterThanOrEqual(16 - 1)
        expect(r.marks.inside, w).toBe(true)
        expect(Math.min(...r.marks.gaps), w).toBeGreaterThanOrEqual(2)
        expect(r.marks.first, w).toBeGreaterThanOrEqual(1)
        expect(r.marks.last, w).toBeGreaterThanOrEqual(1)
      })
    }
  })

  describe('a short document on 761, 900, 1280 and 1920 px: the strokes in the middle, inside the open panel', () => {
    for (const width of [761, 900, 1280, 1920]) {
      it(`a tab of ${width}×800`, { timeout: 120_000 }, async () => {
        const cfg: Config = { suite: 'short', width, height: 800, theme: 'dark' }
        const r = await measureTab(cfg)
        const w = where(r, cfg)
        ok(r, cfg)
        expect(r.marks.step, w).toBe(12)
        expect(r.strokes.l, w).toBeCloseTo(14, 0)
        expect(r.panel.l, w).toBeCloseTo(14, 0)
        expect(Math.abs(r.strokes.t + r.strokes.h / 2 - r.panel.tab / 2), w).toBeLessThanOrEqual(1)
        inside(r, w)
        expect(r.panel.overTools, w).toBe(false)
        expect(r.panel.overRemarks, w).toBe(false)
        expect(r.panel.t, w).toBeGreaterThanOrEqual(r.strokes.rowBottom + 8 - 1)
        expect(r.panel.tab - (r.panel.t + r.panel.h), w).toBeGreaterThanOrEqual(16 - 1)
      })
    }
  })

  describe('scrolling does not move the strokes, the height of the tab does', () => {
    it('1280×800 → 600 → 800', { timeout: 120_000 }, async () => {
      const cfg: Config = { suite: 'dynamic', width: 1280, height: 800, theme: 'dark' }
      const r = await measureTab(cfg)
      const w = where(r, cfg)
      ok(r, cfg)
      for (const s of r.scroll) {
        expect(Math.abs(s.t - r.scroll[0].t), w).toBeLessThanOrEqual(0.5)
        expect(Math.abs(s.h - r.scroll[0].h), w).toBeLessThanOrEqual(0.5)
      }
      expect(r.resize[1].tab, w).toBeLessThan(r.resize[0].tab - 100)
      for (const s of r.resize) placed({ t: s.t, h: s.sh }, s.tab, s.rowBottom, `${w} ${JSON.stringify(s)}`)
      expect(Math.abs(r.resize[2].t - r.resize[0].t), w).toBeLessThanOrEqual(1)
    })
  })

  it('the panel shrinks when sections are deleted (153 → 5): height by content, strokes redrawn, no empty room', { timeout: 120_000 }, async () => {
    const cfg: Config = { suite: 'shrink', width: 1280, height: 800, theme: 'dark' }
    const r = await measureTab(cfg)
    const w = `${where(r, cfg)} ${JSON.stringify([r.before, r.after])}`
    ok(r, cfg)
    expect(r.before.panelH, w).toBeGreaterThan(400)
    expect(r.after.marks, w).toBeLessThanOrEqual(6)
    expect(r.after.rows, w).toBeGreaterThan(0)
    expect(r.after.panelH, w).toBeLessThan(r.before.panelH - 100)
    expect(r.after.panelH - (r.list.head + r.list.scroll), w).toBeLessThanOrEqual(30 + 14)
    expect(r.marks.step, w).toBe(12)
  })

  it('a document with few sections keeps the step of 12 px and a panel that is as high as its content', { timeout: 120_000 }, async () => {
    const cfg: Config = { suite: 'short', width: 1280, height: 800, theme: 'dark' }
    const r = await measureTab(cfg)
    const w = where(r, cfg)
    ok(r, cfg)
    expect(r.marks.step, w).toBe(12)
    expect(r.panel.h, w).toBeLessThan(400)
    // under the last row not more than one row of free room (a row is 30 px, the padding 6 + 2 px)
    expect(r.panel.h - (r.list.head + r.list.scroll), w).toBeLessThanOrEqual(30 + 14)
  })

  describe('reduced motion has no frames between', () => {
    it('the panel opens and closes in one step', { timeout: 180_000 }, async () => {
      const cfg: Config = { suite: 'wide', width: 1280, height: 800, theme: 'dark', reduced: true }
      const r = await measureTab(cfg)
      const w = where(r, cfg)
      ok(r, cfg)
      expect(r.reduced, w).toBe(true)
      // no transition: one frame, the panel is whole at once, and gone at once
      expect(r.open.dur, w).toBe(0)
      expect(r.open.widths, w).toEqual([336])
      expect(r.close.dur, w).toBe(0)
      expect(r.close.hiddenAfter.vis, w).toBe(false)
      expect(r.stress.hidden, w).toBe(true)
    })
  })

  describe('a narrow tab (390×700), both themes', () => {
    for (const theme of ['dark', 'light'] as const) {
      it(`${theme} theme`, { timeout: 120_000 }, async () => {
        const cfg: Config = { suite: 'narrow', width: 390, height: 700, theme }
        const r = await measureTab(cfg)
        const w = where(r, cfg)
        ok(r, cfg)
        expect(r.strokes.shown, w).toBe(false)
        expect(r.narrow.l, w).toBeCloseTo(10, 0)
        expect(r.narrow.r, w).toBeCloseTo(10, 0)
        expect(r.narrow.bottom, w).toBeGreaterThanOrEqual(0)
        expect(r.narrow.overTools, w).toBe(false)
        expect(r.narrow.name, w).toMatch(/^code = 77\./)
        expect(r.narrow.rowInside, w).toBe(true)
        expect(r.narrow.bg, w).not.toBe('rgba(0, 0, 0, 0)')
        expect(Number(r.narrow.weight), w).toBeGreaterThanOrEqual(600)
        expect(r.names.max, w).toBeLessThanOrEqual(2.05)
        expect(r.names.clamped, w).toBeGreaterThan(0)
        expect(r.names.two, w).toBeGreaterThan(0)
        expect(r.names.titles, w).toBe(true)
      })
    }
  })
})
