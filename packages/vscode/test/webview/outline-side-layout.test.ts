// the outline «Разделы» as a column left of the text (the view `side`, set in the settings; the default is `capsule`), measured in a real Chrome (jsdom has no layout) on the real bundle of the tab,
// its real style sheet and the documents `many-sections.adoc`, `structure.adoc` and `sheet.adoc`: (the default, the view `capsule` by the message), (the place of the column and
// of the page), (the page is not narrowed without need), (the threshold of 1022 px, back after the tab grows), (the column stands, the current section is lit),
// (a click on a row), (folding), (the handles stand between the column and the text), (the colours of the interface, both themes).
// Each case is one run of Chrome: the page runs the steps and writes what it measured into the title. Skipped where Chrome is not installed.
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
const DOCS = {
  many: readFileSync(join(FIXTURES, 'many-sections.adoc'), 'utf8'),
  structure: readFileSync(join(FIXTURES, 'structure.adoc'), 'utf8'),
  sheet: readFileSync(join(FIXTURES, 'sheet.adoc'), 'utf8'),
  // made up here: a document without sections, and one with a single section
  plain: '= Заметки о походе\n\nПервый абзац про сборы и снаряжение.\n\nВторой абзац про погоду на маршруте.\n',
  single: '= Заметки о походе\n\n== Сборы\n\nПервый абзац про сборы и снаряжение.\n\nВторой абзац про погоду на маршруте.\n',
}

type Scenario = 'layout' | 'scroll' | 'fold' | 'switch' | 'grips' | 'table' | 'cards' | 'pinned' | 'plain'
interface Config {
  scenario: Scenario
  doc: keyof typeof DOCS
  width: number
  height: number
  theme: 'dark' | 'light'
  /** What `init` says: absent = the setting is not set. */
  view?: 'side' | 'capsule'
  percent?: number
}

const runner = (cfg: Config, text: string): string => `
const CFG = ${JSON.stringify(cfg)}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const out = { step: '' }
const rc = (e) => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height } }
const q = (s) => document.querySelector(s)
const shown = (e) => !!e && (() => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && !e.closest('[hidden]') })()
const over = (a, b) => Math.min(a.r, b.r) - Math.max(a.l, b.l) > 0.5 && Math.min(a.b, b.b) - Math.max(a.t, b.t) > 0.5
const scroller = () => q('.ed-visual')
const app = () => q('#app')
const send = (m) => window.postMessage(m, '*')
const column = () => q('.sections-side')
const lit = () => [...document.querySelectorAll('.sections-side .tree-item.on .tree-name')].map((e) => e.textContent)
const state = () => {
  const col = column()
  const sc = scroller()
  return {
    column: shown(col) ? rc(col) : null,
    page: rc(q('.page')),
    tab: rc(q('.ed-main')),
    strokes: shown(q('.isle-strokes')),
    capsule: shown(q('.isle-sections')),
    rowRows: col ? col.querySelectorAll('.tree-row').length : 0,
    head: shown(col) ? rc(col.querySelector('.side-head')) : null,
    tools: shown(q('.isle-mid .isle-tools')) ? rc(q('.isle-mid .isle-tools')) : null,
    hscroll: { sw: sc.scrollWidth, cw: sc.clientWidth, doc: document.documentElement.scrollWidth, docw: document.documentElement.clientWidth },
    view: document.body.dataset.outlineView,
    lit: lit(),
  }
}
const scrollBy = async (y) => { scroller().scrollTop += y; scroller().dispatchEvent(new Event('scroll')); await sleep(300) }
const run = async () => {
  out.step = 'init'
  window.__tab = true
  app().style.width = CFG.width + 'px'
  send({ type: 'init', text: ${JSON.stringify(text)}, version: 1, fileName: 'a.adoc', locale: 'ru', fileDir: '/tmp', mode: 'visual', ...(CFG.percent ? { pageWidth: CFG.percent } : { pageWidth: 85 }), ...(CFG.view ? { outlineView: CFG.view } : {}) })
  for (let i = 0; i < 60 && !q(CFG.scenario === 'plain' ? '.ProseMirror p' : '.ProseMirror h2'); i++) await sleep(100)
  await sleep(600)
  scroller().style.scrollBehavior = 'auto'
  out.first = state()
  // a lit row is needed for the colour: at the very top of the document there may be none yet
  if (column() && shown(column()) && !q('.sections-side .tree-item.on')) await scrollBy(300)
  out.theme = (() => {
    const col = column()
    if (!col || !shown(col)) return null
    const cs = getComputedStyle(col)
    const probe = document.createElement('div'); probe.style.background = 'var(--ap-accent-soft)'; document.body.append(probe)
    const soft = getComputedStyle(probe).backgroundColor; probe.remove()
    const on = col.querySelector('.tree-item.on')
    const ui = getComputedStyle(q('.isle-tools'))
    return { font: cs.fontFamily, uiFont: ui.fontFamily, bg: cs.backgroundColor, border: cs.borderTopWidth, shadow: cs.boxShadow, on: on ? getComputedStyle(on).backgroundColor : null, soft, ink: cs.color }
  })()
  if (CFG.scenario === 'plain') {
    out.step = 'plain'
    const snap = () => {
      const cap = q('.isle-sections')
      const c = rc(cap)
      const hit = document.elementFromPoint(c.l + c.w / 2, c.t + c.h / 2)
      return { ...state(), paragraph: rc(q('.ProseMirror p')), capsuleBox: c, hitCapsule: !!hit && cap.contains(hit), card: !!q('.sections-card:not([hidden])'), items: [...document.querySelectorAll('.sections-side .tree-item')].map((e) => e.textContent.trim()) }
    }
    const base = ${JSON.stringify(text)}
    out.start = snap()
    const cap = q('.isle-sections')
    cap.click(); await sleep(300)
    out.afterClick = snap().card
    cap.focus()
    out.focusable = document.activeElement === cap
    out.tabIndex = cap.tabIndex
    out.ariaHidden = cap.getAttribute('aria-hidden')
    send({ type: 'reset', text: base + '\\n== Маршрут\\n\\nТекст маршрута.\\n', version: 2, stale: false }); await sleep(700)
    out.added = snap()
    const toggle = shown(q('.isle-sections')) ? q('.isle-sections') : shown(q('.isle-strokes')) ? q('.isle-strokes') : null
    if (toggle) { toggle.click(); await sleep(400) }
    out.opened = snap().card
    send({ type: 'reset', text: base, version: 3, stale: false }); await sleep(700)
    out.removed = snap()
    out.step = 'done'; return
  }
  if (CFG.scenario === 'layout') { out.step = 'done'; return }
  if (CFG.scenario === 'scroll') {
    out.step = 'scroll'
    const sc = scroller()
    out.scrolls = []
    const stops = [0.25, 0.5, 0.75, 1]
    for (const f of stops) {
      sc.scrollTop = (sc.scrollHeight - sc.clientHeight) * f; sc.dispatchEvent(new Event('scroll')); await sleep(400)
      const s = state()
      const line = sc.getBoundingClientRect().top + sc.clientHeight / 3
      const heads = [...document.querySelectorAll('.ProseMirror h2')]
      const above = heads.filter((h) => h.getBoundingClientRect().top <= line + 60)
      const litRow = document.querySelector('.sections-side .tree-item.on')
      const lr = litRow ? rc(litRow) : null, cr = rc(column())
      out.scrolls.push({ f, column: s.column, lit: s.lit, nearest: above.length ? above[above.length - 1].textContent : null, litInView: !!lr && lr.t >= cr.t - 1 && lr.b <= cr.b + 1, list: (() => { const l = column().querySelector('.tree-list'); return { sh: l.scrollHeight, ch: l.clientHeight } })() })
    }
    // a click on a row
    out.step = 'click'
    sc.scrollTop = 0; sc.dispatchEvent(new Event('scroll')); await sleep(300)
    const items = [...document.querySelectorAll('.sections-side .tree-item')]
    const row = items[40]
    row.scrollIntoView({ block: 'center' }); await sleep(100)
    const before = rc(column())
    row.click(); await sleep(900)
    const target = [...document.querySelectorAll('.ProseMirror h2')].find((h) => h.textContent === row.textContent.trim())
    const sel = getSelection()
    out.click = { column: rc(column()), before, headTop: target ? target.getBoundingClientRect().top - sc.getBoundingClientRect().top : null, caretIn: !!target && !!sel.anchorNode && target.contains(sel.anchorNode), shown: shown(column()), open: !!q('.sections-card:not([hidden])') }
    out.step = 'done'; return
  }
  if (CFG.scenario === 'fold') {
    out.step = 'fold'
    const rows = () => [...document.querySelectorAll('.sections-side li')].filter((li) => !li.hidden).map((li) => li.querySelector('.tree-name').textContent)
    const arrowOf = (t) => [...document.querySelectorAll('.sections-side .tree-row')].find((r) => r.querySelector('.tree-name').textContent === t).querySelector('.tree-fold')
    const sc = scroller(); const top0 = sc.scrollTop
    out.before = rows()
    out.arrowRect = rc(arrowOf('А. Лимиты'))
    arrowOf('А. Лимиты').click(); await sleep(300)
    out.folded = rows(); out.turned = arrowOf('А. Лимиты').classList.contains('closed'); out.scrollMoved = sc.scrollTop !== top0
    // the current section inside the folded one lights the parent
    const h = [...document.querySelectorAll('.ProseMirror h3')].find((e) => e.textContent.startsWith('А2'))
    sc.scrollTop += h.getBoundingClientRect().top - sc.getBoundingClientRect().top - 330; sc.dispatchEvent(new Event('scroll')); await sleep(400)
    out.litInFolded = lit()
    out.dbg = { st: sc.scrollTop, max: sc.scrollHeight - sc.clientHeight, heads: [...document.querySelectorAll('.ProseMirror h2, .ProseMirror h3')].map((e) => e.textContent + '@' + Math.round(e.getBoundingClientRect().top)) }
    // type: the folded stays
    send({ type: 'update', version: 2, changes: [{ from: 0, to: 0, insert: ' ' }], reason: 'external' }); await sleep(500)
    out.afterEdit = rows()
    sc.scrollTop = 0; sc.dispatchEvent(new Event('scroll')); await sleep(300)
    out.afterScroll = rows()
    // the tab gets narrow and wide again: the folded stays folded
    app().style.width = '900px'; window.dispatchEvent(new Event('resize')); await sleep(500)
    out.narrow = state()
    app().style.width = CFG.width + 'px'; window.dispatchEvent(new Event('resize')); await sleep(500)
    out.wide = state(); out.wideRows = rows()
    arrowOf('А. Лимиты').click(); await sleep(300)
    out.unfolded = rows()
    out.step = 'done'; return
  }
  if (CFG.scenario === 'switch') {
    out.step = 'switch'
    const sc = scroller()
    const para = [...document.querySelectorAll('.ProseMirror p')][8]
    para.scrollIntoView({ block: 'center' }); sc.dispatchEvent(new Event('scroll')); await sleep(300)
    const pTop = () => para.getBoundingClientRect().top
    const sTop = sc.getBoundingClientRect()
    out.sizes = {}
    send({ type: 'outlineView', view: 'capsule' }); await sleep(700)
    out.capsule = state(); out.capsuleParaInView = pTop() >= sTop.top && pTop() <= sTop.bottom
    send({ type: 'outlineView', view: 'side' }); await sleep(700)
    out.side = state(); out.sideParaInView = pTop() >= sTop.top && pTop() <= sTop.bottom
    send({ type: 'outlineView', view: 'abc' }); await sleep(500)
    out.abc = state()
    out.step = 'done'; return
  }
  if (CFG.scenario === 'table') {
    // the cursor in a cell, the capsule of tools open with its row «Таблица»; at each width the capsules are measured against the column
    out.step = 'table'
    out.rows = []
    const cell = [...document.querySelectorAll('.ProseMirror td, .ProseMirror th')][0]
    // (headless Chrome with a virtual clock runs the observers of size only when real time passes: a fetch lets it pass)
    const real = async (n) => { for (let i = 0; i < n; i++) await fetch('style.css?' + Math.random()).then((r) => r.text()) }
    for (const w of [1022, 1040, 1060, 1080, 1100, 1110, 1140, 1200, 1280, 1600, 1100]) {
      app().style.width = w + 'px'; window.dispatchEvent(new Event('resize')); await sleep(500)
      q('.ProseMirror').focus()
      const sel = getSelection(), rng = document.createRange()
      rng.selectNodeContents(cell.querySelector('p, div') || cell); rng.collapse(false)
      sel.removeAllRanges(); sel.addRange(rng)
      document.dispatchEvent(new Event('selectionchange'))
      for (let i = 0; i < 40 && !q('.isle-tools .tl-row'); i++) await sleep(50)
      await sleep(500); await real(3); await sleep(100); await real(3); await sleep(100)
      const col = column()
      const head = col ? rc(col.querySelector('.side-head')) : null
      const first = col ? rc(col.querySelector('.tree-row')) : null
      const caps = [...document.querySelectorAll('.ed-isles .isle')].filter(shown).map((e) => ({ cls: e.className, r: rc(e) }))
      const hit = (r) => !!r && caps.some((c) => over(c.r, r))
      out.rows.push({ w, column: col && shown(col) ? rc(col) : null, head, first, caps, sideTop: q('.ed-main').style.getPropertyValue('--side-top'), hasRow: !!q('.isle-tools .tl-row'), overHead: hit(head), overFirst: hit(first) })
    }
    // the view switched (the command of the palette sends the same message) with the row open: --side-top is counted again, not left from the other view
    const top = () => q('.ed-main').style.getPropertyValue('--side-top')
    out.topBefore = top()
    send({ type: 'outlineView', view: 'capsule' }); await sleep(700); await real(3)
    out.topCapsule = top()
    send({ type: 'outlineView', view: 'side' }); await sleep(700); await real(3)
    out.topBack = top()
    out.step = 'done'; return
  }
  if (CFG.scenario === 'cards') {
    // the card of the remarks (opened by the capsule «замечания», and by a click on a counter in the column) and the cards of the tools do not lie on the column
    out.step = 'cards'
    const col = rc(column())
    const cards = () => [...document.querySelectorAll('.card')].filter(shown).map((e) => ({ cls: e.className, r: rc(e) }))
    const sc = scroller(); sc.scrollTop = 0; sc.dispatchEvent(new Event('scroll')); await sleep(300)
    out.badges = document.querySelectorAll('.sections-side .tree-badge').length
    q('.isle-remarks').click(); await sleep(700)
    out.capsuleCard = cards()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await sleep(300)
    const badge = document.querySelector('.sections-side .tree-badge')
    if (badge) { badge.click(); await sleep(700) }
    out.badgeCard = cards()
    out.shown = shown(column())
    out.col = col; out.colAfter = rc(column())
    out.over = [...out.capsuleCard, ...out.badgeCard].some((c) => over(c.r, col))
    out.step = 'done'; return
  }
  if (CFG.scenario === 'pinned') {
    // a card pinned by a click on the strokes (900 px) does not stay over the column that comes when the tab grows
    out.step = 'pinned'
    const real = async (n) => { for (let i = 0; i < n; i++) await fetch('style.css?' + Math.random()).then((r) => r.text()) }
    q('.isle-strokes').click(); await sleep(500)
    out.openNarrow = !!q('.sections-card:not([hidden])')
    app().style.width = '1600px'; window.dispatchEvent(new Event('resize')); await sleep(300); await sleep(300)
    // the card is closed by the window's «resize» (in a frame of the virtual time), not by the observer of the column: no real time is waited for it
    out.openWide = !!q('.sections-card:not([hidden])')
    // only the column needs real time: the observers of the sizes run when the headless Chrome draws a frame, and with --virtual-time-budget that takes real requests
    await real(3); await sleep(100); await real(3); await sleep(300)
    out.column = shown(column())
    out.step = 'done'; return
  }
  if (CFG.scenario === 'grips') {
    out.step = 'grips'
    const move = (x, y) => { const ev = new MouseEvent('mousemove', { bubbles: true, clientX: x, clientY: y, buttons: 0 }); (document.elementFromPoint(x, y) || document).dispatchEvent(ev) }
    const centre = (r) => ({ x: r.l + r.w / 2, y: r.t + r.h / 2 })
    const sc = scroller(); sc.style.scrollBehavior = 'auto'
    const col = rc(column())
    const tbl = q('.tbl'); const td = tbl.querySelector('td')
    td.scrollIntoView({ block: 'center' }); sc.dispatchEvent(new Event('scroll')); move(2, 2); await sleep(300)
    let p = centre(rc(td)); move(p.x, p.y); await sleep(500)
    const grips = q('.nota-grips')
    const rows = grips ? [...grips.querySelectorAll('.rg')].map(rc) : []
    out.rows = rows.map((r) => r.l)
    const row1 = grips && grips.querySelector('.rg[data-i="1"]')
    if (row1) { p = centre(rc(row1)); move(p.x, p.y); await sleep(700) }
    const gb = grips && grips.querySelector('.gb:not([hidden])')
    out.capsuleRow = gb && shown(gb) ? rc(gb) : null
    // the real «scroll» of «scrollTop = 0» comes in a frame, and a frame needs real time (--virtual-time-budget): under load it came after
    // the mouse had moved over the paragraph and put the hover of the handle out. So wait for the trusted «scroll» first, with the real time, a bounded number of times.
    const real = async (n) => { for (let i = 0; i < n; i++) await fetch('style.css?' + Math.random()).then((r) => r.text()) }
    let trusted = false
    const onTrusted = (e) => { if (e.isTrusted) trusted = true }
    sc.addEventListener('scroll', onTrusted)
    const mustScroll = sc.scrollTop !== 0
    sc.scrollTop = 0; sc.dispatchEvent(new Event('scroll')); await sleep(300)
    for (let i = 0; mustScroll && i < 40 && !trusted; i++) { await real(2); await sleep(50) }
    sc.removeEventListener('scroll', onTrusted)
    out.trustedScroll = mustScroll ? trusted : null
    const para = [...document.querySelectorAll('.ProseMirror > p')].find((e) => e.textContent.startsWith('Короткое'))
    let scrollsAfter = 0
    const onAfter = () => { scrollsAfter++ }
    sc.addEventListener('scroll', onAfter)
    p = centre(rc(para)); move(p.x, p.y); await sleep(500)
    // the handle is waited for by the condition (no second «mousemove»: it would hide a handle that is really gone)
    for (let i = 0; i < 40 && !shown(q('.blk-handle')); i++) { await real(2); await sleep(50) }
    sc.removeEventListener('scroll', onAfter)
    const h = q('.blk-handle')
    out.handle = h && shown(h) ? rc(h) : null
    if (!out.handle) {
      const cs = h && getComputedStyle(h)
      out.handleWhy = {
        element: !!h, visibility: cs ? cs.visibility : null, display: cs ? cs.display : null, dataUnder: h ? h.getAttribute('data-under') : null,
        rect: h ? rc(h) : null, gbarRow: document.body.classList.contains('nota-gbar-row'),
        scrollsAfterMove: scrollsAfter, trustedScroll: out.trustedScroll, toolsBottom: q('.ed-main') ? getComputedStyle(q('.ed-main')).getPropertyValue('--tools-bottom') : null, paraTop: rc(para).t,
      }
    }
    out.column = col; out.page = rc(q('.page')); out.para = rc(para)
    out.overlap = { handle: !!out.handle && over(out.handle, col), capsuleRow: !!out.capsuleRow && over(out.capsuleRow, col), rows: rows.some((r) => over(r, col)) }
    move(2, 2); await sleep(200)
    out.step = 'done'; return
  }
}
run().catch((e) => { out.error = String((e && e.stack) || e) + ' (at ' + out.step + ')' }).finally(() => { document.title = 'RES ' + JSON.stringify(out) })
`

const chromeOut = (args: string[]): Promise<string> => chromeDump(CHROME!, args)
let version: string | undefined
const chromeVersion = (): string => (version ??= execFileSync(CHROME!, ['--version'], { encoding: 'utf8' }).trim())
/** One Chrome at a time: the one the file's slot holds (a second one would wait for the machine inside a test). */
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


// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Result = any

const cache = new Map<string, Promise<Result>>()
function measure(cfg: Config): Promise<Result> {
  const key = JSON.stringify(cfg)
  let found = cache.get(key)
  if (!found) {
    found = limited(() => measureNow(cfg))
    cache.set(key, found)
  }
  return found
}
async function measureNow(cfg: Config): Promise<Result> {
  const css = readFileSync(at('../../../react/src/style.css'), 'utf8') + '\n' + readFileSync(at('../../src/webview/style.css'), 'utf8')
  const dir = mkdtempSync(join(tmpdir(), 'nota-side-'))
  try {
    writeFileSync(join(dir, 'webview.js'), await tabBundle())
    writeFileSync(join(dir, 'style.css'), css)
    writeFileSync(
      join(dir, 'p.html'),
      `<!doctype html><html lang="ru"><head><meta charset="utf-8"><link rel="stylesheet" href="style.css"></head><body class="vscode-${cfg.theme}" data-nota-theme="${cfg.theme}"><div id="app" class="nota" data-mermaid="" style="width:${cfg.width}px"></div>
<script>window.acquireVsCodeApi=()=>({postMessage(){},getState:()=>null,setState(){}})
// headless Chrome in virtual time draws no frames, so «requestAnimationFrame» never calls back: a timer of one frame stands in for it
window.requestAnimationFrame = (f) => setTimeout(() => f(performance.now()), 16); window.cancelAnimationFrame = (id) => clearTimeout(id)</script>
<script src="webview.js"></script><script>${runner(cfg, DOCS[cfg.doc])}</script></body></html>`,
    )
    const html = await chromeOut(['--headless=new', '--disable-gpu', '--allow-file-access-from-files', `--window-size=${Math.max(cfg.width, 500)},${cfg.height + 120}`, '--virtual-time-budget=120000', '--dump-dom', `file://${join(dir, 'p.html')}`])
    const m = /<title>RES ([^<]*)<\/title>/.exec(html)
    if (!m) throw new Error(`the page did not report (${/<title>([^<]*)<\/title>/.exec(html)?.[1]})`)
    return JSON.parse(m[1]!.replaceAll('&quot;', '"').replaceAll('&amp;', '&').replaceAll('&gt;', '>').replaceAll('&lt;', '<'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const base = (over: Partial<Config> = {}): Config => ({
  scenario: 'layout',
  doc: 'many',
  width: 1600,
  height: 800,
  theme: 'light',
  view: 'side',
  ...over,
})
const where = (r: Result, cfg: Config): string => `${chromeVersion()}, ${JSON.stringify(cfg)}, ${JSON.stringify(r.first ?? r)}`
const ok = (r: Result, cfg: Config): void => {
  expect(r.error, where(r, cfg)).toBeUndefined()
  expect(r.step, where(r, cfg)).toBe('done')
}
const near = (a: number, b: number, d = 2): boolean => Math.abs(a - b) <= d

describe.skipIf(!CHROME)('the column «Разделы» in a real Chrome', () => {
  describe('the setting is `side`, 1600 px', () => {
    for (const view of ['side'] as const) {
      it(`init with ${view}: the column is left of the text, no strokes, no capsule`, { timeout: 180_000 }, async () => {
        const cfg = base({ view })
        const r = await measure(cfg)
        ok(r, cfg)
        const s = r.first
        const w = where(r, cfg)
        expect(s.view, w).toBe('side')
        expect(s.column, w).not.toBeNull()
        expect(near(s.column.w, 240), w).toBe(true)
        expect(near(s.column.l - s.tab.l, 14), w).toBe(true)
        // level with the row of capsules, left of the capsule of tools
        expect(s.column.t, w).toBe(10)
        expect(s.column.r + 8, w).toBeLessThanOrEqual(s.tools.l + 0.5)
        expect(s.rowRows, w).toBeGreaterThan(100)
        expect(s.strokes, w).toBe(false)
        expect(s.capsule, w).toBe(false)
        expect(near(s.page.w, 1186), w).toBe(true)
        expect(near(s.page.l - s.tab.l, 334), w).toBe(true)
        expect(near(s.tab.r - s.page.r, 80), w).toBe(true)
        expect(s.page.l, w).toBeGreaterThanOrEqual(s.column.r)
        expect(s.hscroll.sw, w).toBeLessThanOrEqual(s.hscroll.cw)
        expect(s.hscroll.doc, w).toBeLessThanOrEqual(s.hscroll.docw)
      })
    }
  })

  describe('the page is not narrowed without need', () => {
    it('nota.pageWidth 60 at 1600 px: 960 px, the left edge at 334 px', { timeout: 180_000 }, async () => {
      const cfg = base({ percent: 60 })
      const r = await measure(cfg)
      ok(r, cfg)
      expect(near(r.first.page.w, 960), where(r, cfg)).toBe(true)
      expect(near(r.first.page.l - r.first.tab.l, 334), where(r, cfg)).toBe(true)
    })
    for (const [width, page] of [
      [1280, 866],
      [1100, 686],
      [1022, 608],
    ] as const) {
      it(`${width} px: the page is ${page} px, the column stays`, { timeout: 180_000 }, async () => {
        const cfg = base({ width })
        const r = await measure(cfg)
        ok(r, cfg)
        expect(r.first.column, where(r, cfg)).not.toBeNull()
        expect(near(r.first.page.w, page), where(r, cfg)).toBe(true)
        expect(near(r.first.page.l - r.first.tab.l, 334), where(r, cfg)).toBe(true)
        expect(r.first.hscroll.sw, where(r, cfg)).toBeLessThanOrEqual(r.first.hscroll.cw)
      })
    }
  })

  describe('under the threshold of 1022 px the outline is as in the view capsule', () => {
    for (const [width, strokes] of [
      [1021, true],
      [900, true],
      [650, false],
      [360, false],
    ] as const) {
      it(`${width} px: no column, ${strokes ? 'the strokes' : 'the capsule «Разделы»'}`, { timeout: 180_000 }, async () => {
        const cfg = base({ width })
        const r = await measure(cfg)
        ok(r, cfg)
        const s = r.first
        expect(s.column, where(r, cfg)).toBeNull()
        expect(s.strokes, where(r, cfg)).toBe(strokes)
        expect(s.capsule, where(r, cfg)).toBe(!strokes)
        expect(s.hscroll.sw, where(r, cfg)).toBeLessThanOrEqual(s.hscroll.cw)
        // the page as in the view capsule
        const same = await measure(base({ width, view: 'capsule' }))
        expect(near(s.page.w, same.first.page.w, 0.5), where(r, cfg)).toBe(true)
        expect(near(s.page.l, same.first.page.l, 0.5), where(r, cfg)).toBe(true)
      })
    }
  })

  describe('the view capsule is what it was, and it is the default', () => {
    for (const [width, strokes] of [[1600, true], [900, true], [360, false]] as const) {
      it(`init without outlineView, ${width} px: ${strokes ? 'the strokes' : 'the capsule «Разделы»'}, no column`, { timeout: 180_000 }, async () => {
        const cfg = base({ view: undefined, width })
        const r = await measure(cfg)
        ok(r, cfg)
        expect(r.first.view, where(r, cfg)).toBe('capsule')
        expect(r.first.column, where(r, cfg)).toBeNull()
        expect(r.first.strokes, where(r, cfg)).toBe(strokes)
        expect(r.first.capsule, where(r, cfg)).toBe(!strokes)
      })
    }

    it('1600 px with capsule: the strokes and no column, the page of 85 % (1360 px)', { timeout: 180_000 }, async () => {
      const cfg = base({ view: 'capsule' })
      const r = await measure(cfg)
      ok(r, cfg)
      expect(r.first.view).toBe('capsule')
      expect(r.first.column, where(r, cfg)).toBeNull()
      expect(r.first.strokes, where(r, cfg)).toBe(true)
      expect(near(r.first.page.w, 1360), where(r, cfg)).toBe(true)
      expect(near(r.first.page.l - r.first.tab.l, 120), where(r, cfg)).toBe(true)
    })
  })

  describe('the column stands, the current section is lit, a click goes to the heading', () => {
    it('many-sections.adoc at 1600 px', { timeout: 180_000 }, async () => {
      const cfg = base({ scenario: 'scroll' })
      const r = await measure(cfg)
      ok(r, cfg)
      const w = where(r, cfg)
      for (const s of r.scrolls) {
        expect(s.column.t, w).toBe(r.first.column.t)
        expect(s.column.l, w).toBe(r.first.column.l)
        expect(s.column.b, w).toBe(r.first.column.b)
        expect(s.lit, w).toHaveLength(1)
        expect(s.lit[0], `${w} ${JSON.stringify(s)}`).toBe(s.nearest)
        expect(s.litInView, w).toBe(true)
        // more rows than fit: the list scrolls by itself
        expect(s.list.sh, w).toBeGreaterThan(s.list.ch)
      }
      expect(r.scrolls.at(-1).lit[0], w).toMatch(/^code = 153\./)
      expect(r.click.column, w).toEqual(r.click.before)
      expect(r.click.shown, w).toBe(true)
      expect(r.click.open, w).toBe(false)
      expect(r.click.caretIn, w).toBe(true)
      expect(r.click.headTop, w).toBeLessThan(200)
    })
  })

  describe('folding', () => {
    it('structure.adoc at 1600 px', { timeout: 180_000 }, async () => {
      const cfg = base({ scenario: 'fold', doc: 'structure' })
      const r = await measure(cfg)
      ok(r, cfg)
      const w = where(r, cfg)
      expect(r.before, w).toContain('А1. Подраздел')
      expect(r.folded, w).not.toContain('А1. Подраздел')
      expect(r.folded, w).not.toContain('А2. Второй подраздел')
      expect(r.folded, w).toContain('Б1. Подраздел')
      expect(r.turned, w).toBe(true)
      expect(r.scrollMoved, w).toBe(false)
      expect(r.litInFolded, w + JSON.stringify(r.dbg)).toEqual(['А. Лимиты'])
      expect(r.afterEdit, w).toEqual(r.folded)
      expect(r.afterScroll, w).toEqual(r.folded)
      expect(r.narrow.column, w).toBeNull()
      expect(r.wide.column, w).not.toBeNull()
      expect(r.wideRows, w).toEqual(r.folded)
      expect(r.unfolded, w).toEqual(r.before)
    })
  })

  describe('the view changes by the message, and the tab keeps its place', () => {
    it('side → capsule → side → a value off the list is capsule', { timeout: 180_000 }, async () => {
      const cfg = base({ scenario: 'switch', doc: 'structure' })
      const r = await measure(cfg)
      ok(r, cfg)
      const w = where(r, cfg)
      expect(r.capsule.view, w).toBe('capsule')
      expect(r.capsule.column, w).toBeNull()
      expect(r.capsule.strokes, w).toBe(true)
      expect(r.capsuleParaInView, w).toBe(true)
      expect(r.side.column, w).not.toBeNull()
      expect(r.side.strokes, w).toBe(false)
      expect(r.sideParaInView, w).toBe(true)
      expect(r.abc.view, w).toBe('capsule')
      expect(r.abc.column, w).toBeNull()
    })
  })

  describe('the handles and the strips stand between the column and the text', () => {
    for (const width of [1600, 1100]) {
      it(`sheet.adoc at ${width} px`, { timeout: 180_000 }, async () => {
        const cfg = base({ scenario: 'grips', doc: 'sheet', width })
        const r = await measure(cfg)
        ok(r, cfg)
        const w = where(r, cfg)
        expect(r.overlap, w).toEqual({ handle: false, capsuleRow: false, rows: false })
        expect(r.handle, w).not.toBeNull()
        expect(r.handle.l, w).toBeGreaterThanOrEqual(r.column.r - 0.5)
        expect(r.handle.r, w).toBeLessThanOrEqual(r.page.l + 0.5)
        for (const x of r.rows) expect(x, w).toBeGreaterThanOrEqual(r.column.r - 0.5)
      })
    }
  })

  describe('the wide capsule with the row «Таблица» does not lie on the column', () => {
    it('sheet.adoc, the cursor in a cell, 1022–1600 px', { timeout: 180_000 }, async () => {
      const cfg = base({ scenario: 'table', doc: 'sheet', width: 1600 })
      const r = await measure(cfg)
      ok(r, cfg)
      for (const s of r.rows) {
        const w = `${chromeVersion()} ${s.w}: ${JSON.stringify(s)}`
        expect(s.column, w).not.toBeNull()
        expect(s.hasRow, w).toBe(true)
        expect(s.overHead, w).toBe(false)
        expect(s.overFirst, w).toBe(false)
        // where the capsule does not reach the column, the column stays where it was (also when the tab narrows again)
        if (s.w >= 1200) expect(s.column.t, w).toBe(10)
      }
      // the view switched at 1100 px with the row open: no `--side-top` left in «Капсула», the same one back in «Сбоку»
      const sw = JSON.stringify({ before: r.topBefore, capsule: r.topCapsule, back: r.topBack })
      expect(r.topBefore, sw).not.toBe('')
      expect(r.topCapsule, sw).toBe('')
      expect(r.topBack, sw).toBe(r.topBefore)
    })
  })

  describe('the card of the remarks does not lie on the column', () => {
    for (const width of [1600, 1100, 1022]) {
      it(`sheet.adoc at ${width} px: the capsule «Замечания» and the counter in the column`, { timeout: 180_000 }, async () => {
        const cfg = base({ scenario: 'cards', doc: 'sheet', width })
        const r = await measure(cfg)
        ok(r, cfg)
        const w =
          where(r, cfg) +
          JSON.stringify({
            badges: r.badges,
            capsuleCard: r.capsuleCard,
            badgeCard: r.badgeCard,
            col: r.col,
          })
        expect(r.badges, w).toBeGreaterThan(0)
        expect(r.shown, w).toBe(true)
        expect(r.capsuleCard.length, w).toBeGreaterThan(0)
        // a card that is not empty: it has a size (a card of 0 × 0 px does not lie on anything)
        for (const c of [...r.capsuleCard, ...r.badgeCard]) expect(c.r.w > 20 && c.r.h > 20, w).toBe(true)
        expect(r.badgeCard.length, w).toBeGreaterThan(0)
        expect(r.over, w).toBe(false)
        expect(r.colAfter, w).toEqual(r.col)
      })
    }
  })

  describe('a card pinned in a narrow tab closes when the column comes', () => {
    it('900 px → 1600 px', { timeout: 180_000 }, async () => {
      const cfg = base({ scenario: 'pinned', width: 900 })
      const r = await measure(cfg)
      ok(r, cfg)
      const w = where(r, cfg)
      expect(r.openNarrow, w).toBe(true)
      expect(r.column, w).toBe(true)
      expect(r.openWide, w).toBe(false)
    })
  })

  describe('the colours and the fonts of the interface, both themes, the three widths', () => {
    for (const theme of ['light', 'dark'] as const) {
      for (const doc of ['many', 'sheet'] as const) {
        for (const width of [1600, 1100, 360]) {
          it(`${doc}.adoc, ${theme}, ${width} px`, { timeout: 180_000 }, async () => {
            const cfg = base({ doc, theme, width })
            const r = await measure(cfg)
            ok(r, cfg)
            const w = where(r, cfg)
            const s = r.first
            if (width === 360) {
              expect(s.column, w).toBeNull()
              expect(s.capsule, w).toBe(true)
              return
            }
            expect(s.column, w).not.toBeNull()
            // no frame, no background, no shadow; the font is the one of the interface; the current row is the accent
            expect(r.theme.bg, w).toBe('rgba(0, 0, 0, 0)')
            expect(r.theme.border, w).toBe('0px')
            expect(r.theme.shadow, w).toBe('none')
            expect(r.theme.font, w).toBe(r.theme.uiFont)
            expect(r.theme.on, `${w}: a row is lit`).not.toBeNull()
            expect(r.theme.on, w).toBe(r.theme.soft)
            // nothing lies on anything: the column is under the row of capsules and left of the page
            expect(s.column.r, w).toBeLessThanOrEqual(s.page.l + 0.5)
            // the column starts level with the row of capsules (10 px from the top) where the capsule is not over it, else under it
            expect(s.column.t === 10 ? s.column.r + 8 <= s.tools.l + 0.5 : s.column.t >= s.tools.b - 1, w).toBe(true)
          })
        }
      }
    }
  })
})

describe.skipIf(!CHROME)('a document without sections in a real Chrome', () => {
  const pos = (s: Result): number[] => [s.page.l - s.tab.l, s.paragraph.t, s.tools.l, s.tools.t]
  const same = (a: number[], b: number[], w: string): void => a.forEach((v, i) => expect(near(v, b[i]!, 1), `${w}: ${i}: ${v} vs ${b[i]}`).toBe(true))

  it('the view side, 1600 px: no column, no strokes, no capsule, the page where it stands with the column', { timeout: 180_000 }, async () => {
    const cfg = base({ scenario: 'plain', doc: 'plain' })
    const ref = base({ scenario: 'plain', doc: 'single' })
    const r = await measure(cfg)
    const one = await measure(ref)
    ok(r, cfg)
    ok(one, ref)
    const w = where(r, cfg)
    const s = r.start
    expect(s.view, w).toBe('side')
    expect(s.column, w).toBeNull()
    expect(s.strokes, w).toBe(false)
    expect(s.capsule, w).toBe(false)
    expect(near(s.page.l - s.tab.l, 334, 2), w).toBe(true)
    expect(one.start.column, w).not.toBeNull()
    // the paragraph is lower in the reference (it has a heading above it): the page and the tools are compared
    same([pos(s)[0]!, ...pos(s).slice(2)], [pos(one.start)[0]!, ...pos(one.start).slice(2)], w)
    expect(r.afterClick, w).toBe(false)
    expect(r.focusable, w).toBe(false)
    expect(r.tabIndex, w).toBe(-1)
    expect(r.ariaHidden, w).toBe('true')
  })

  describe('the view capsule keeps no capsule and no strokes, and the tools stand where they stand with a section', () => {
    for (const width of [1600, 900, 700, 600]) {
      it(`${width} px`, { timeout: 180_000 }, async () => {
        const cfg = base({ scenario: 'plain', doc: 'plain', view: 'capsule', width })
        const ref = base({ scenario: 'plain', doc: 'single', view: 'capsule', width })
        const r = await measure(cfg)
        const one = await measure(ref)
        ok(r, cfg)
        ok(one, ref)
        const w = where(r, cfg)
        expect(r.start.capsule, w).toBe(false)
        expect(r.start.strokes, w).toBe(false)
        expect(r.start.hitCapsule, w).toBe(false)
        expect(r.afterClick, w).toBe(false)
        expect(r.focusable, w).toBe(false)
        expect(r.tabIndex, w).toBe(-1)
        expect(near(r.start.tools.l, one.start.tools.l, 1) && near(r.start.tools.t, one.start.tools.t, 1), w).toBe(true)
      })
    }
  })

  describe('the first heading brings the outline, the last one takes it away, and nothing else moves', () => {
    for (const [view, width] of [['side', 1600], ['capsule', 1600], ['capsule', 700]] as const) {
      it(`${view}, ${width} px`, { timeout: 180_000 }, async () => {
        const cfg = base({ scenario: 'plain', doc: 'plain', view, width })
        const r = await measure(cfg)
        ok(r, cfg)
        const w = where(r, cfg)
        expect(r.start.column, w).toBeNull()
        if (view === 'side') {
          expect(r.added.items, w).toEqual(['Маршрут'])
          expect(r.added.column, w).not.toBeNull()
        } else expect(r.added.capsule || r.added.strokes, w).toBe(true)
        same(pos(r.added), pos(r.start), w)
        if (view !== 'side') expect(r.opened, w).toBe(true)
        expect(r.removed.column, w).toBeNull()
        expect(r.removed.capsule, w).toBe(false)
        expect(r.removed.strokes, w).toBe(false)
        expect(r.removed.card, w).toBe(false)
        same(pos(r.removed), pos(r.start), w)
      })
    }
  })
})
