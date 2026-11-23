// the bar of three buttons at a grip of a table, and the hint of its button. Measured in a real Chrome (jsdom has no layout) on the real bundle of the
// tab and its real style sheet: the mouse goes to a grip of a column or of a row, then to each of the three buttons. For each stop the page tells where the bar and the hint
// stand, and what they lie on, whether the size of the page and of the table changed, the rectangles of the bar and of its buttons, the opacity along the
// coming and the going and the colours. Skipped where Chrome is not installed. `NOTA_REPORT=1` prints the numbers, `NOTA_ONLY=<id>` runs one case.
// The reading that the design settled: a hint of a row lies on its own row (a hint of a column on its own column, when it has no room over the bar), so only the
// cells of OTHER rows and columns are forbidden to it.
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
/** A table of `cols` columns and `rows` rows, a head when asked. `title` puts a heading before the table (without it the table is the first block). */
function grid(cols: number, rows: number, o: { head?: boolean; title?: boolean; attrs?: string } = {}): string {
  const attrs = o.attrs ?? (o.head ? '[%header]' : '')
  let t = (o.title === false ? '' : '= Тест\n\n') + (attrs ? attrs + '\n' : '') + '|===\n'
  for (let r = 0; r < rows; r++) t += row(Array.from({ length: cols }, (_, k) => (r === 0 && o.head ? `Колонка ${k + 1}` : `Ячейка ${r}-${k}`))) + '\n'
  return t + '|===\n'
}
/** A wide table: 9 columns with long texts, wider than the frame of a tab. */
function wide(): string {
  let t = '= Тест\n\n[%header,cols="9"]\n|===\n'
  t += row(Array.from({ length: 9 }, (_, k) => `Заголовок колонки номер ${k + 1}`)) + '\n'
  for (let r = 0; r < 12; r++) t += row(Array.from({ length: 9 }, (_, k) => `Значение ячейки ${r}-${k} с длинным текстом`)) + '\n'
  return t + '|===\n'
}
const NESTED = '= Тест\n\n|===\n|Внешняя 1 |Внешняя 2\na|\n!===\n!x1 !y1\n!x2 !y2\n!x3 !y3\n!===\n|b2\n|===\n'

interface Visit {
  kind: 'col' | 'row'
  i: number
}
interface Case {
  id: string
  text: string
  /** The table (its number among the tables of the page) whose grips are visited. */
  table: number
  visits: Visit[]
  /** The frame of the table is scrolled sideways by this many px before the visit. */
  scrollFrame?: number
  /** The page is scrolled to the bottom (the grips of the last rows are at the lower edge of the tab). */
  bottom?: boolean
  /** The caret is put into the last paragraph after the table (a caret in the table opens the second row of the capsule of the tab: 71 px, not 36). */
  caretOut?: boolean
  /** The caret is put into the first cell of the table (the capsule of the tab has its second row, «Таблица»: 71 px; the keyboard grips are reached from here). */
  caretIn?: boolean
  /** The visits are made too (the mouse goes to a neighbour grip and back). */
  neighbours?: boolean
}

function casesFor(): Case[] {
  const cols = (n: number): Visit[] => Array.from({ length: n }, (_, i) => ({ kind: 'col', i }))
  const rows = (...i: number[]): Visit[] => i.map((k) => ({ kind: 'row', i: k }))
  const list: Case[] = [
    { id: 'T', text: grid(6, 20, { head: true }), table: 0, visits: [...cols(6), ...rows(0, 1, 9, 19)], neighbours: true },
    { id: 'first-block', text: grid(4, 6, { title: false }) + '\nТекст после таблицы.\n', caretOut: true, table: 0, visits: [...cols(4), ...rows(0, 5)] },
    { id: 'first-block-in', text: grid(4, 6, { title: false }) + '\nТекст после таблицы.\n', caretIn: true, table: 0, visits: [...cols(4), ...rows(0, 5)] },
    { id: 'bottom', text: grid(4, 40), table: 0, visits: rows(39, 38), bottom: true },
    { id: 'wide', text: wide(), table: 0, visits: [{ kind: 'col', i: 0 }, { kind: 'col', i: 4 }, { kind: 'col', i: 8 }, ...rows(0, 5)] },
    { id: 'wide-scrolled', text: wide(), table: 0, scrollFrame: 150, visits: [{ kind: 'col', i: 0 }, { kind: 'col', i: 1 }, { kind: 'col', i: 4 }, { kind: 'col', i: 8 }, ...rows(0, 5)] },
    { id: 'nested', text: NESTED, table: 1, visits: [{ kind: 'col', i: 0 }, { kind: 'col', i: 1 }, ...rows(0, 2)] },
    { id: 'outer-of-nested', text: NESTED, table: 0, visits: [{ kind: 'col', i: 1 }, ...rows(0, 1)] },
  ]
  return process.env.NOTA_ONLY ? list.filter((c) => c.id === process.env.NOTA_ONLY) : list
}

// ---------------------------------------------------------------- the page

const runner = (c: Case): string => `
const C = ${JSON.stringify(c)}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const msgs = window.__msgs
const rc = (e) => { const r = e.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height } }
const eq = (a, b) => a && b && ['left', 'top', 'width', 'height'].every((k) => Math.abs(a[k] - b[k]) <= 0.5)
const hit = (a, b) => a.left < b.right - 0.01 && b.left < a.right - 0.01 && a.top < b.bottom - 0.01 && b.top < a.bottom - 0.01
const inside = (a, b) => a.left >= b.left - 0.5 && a.right <= b.right + 0.5 && a.top >= b.top - 0.5 && a.bottom <= b.bottom + 0.5
const move = (x, y) => document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: x, clientY: y, buttons: 0 }))
const centre = (r) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 })
const grips = () => document.querySelector('.nota-grips')
const bounds = () => { const r = rc(document.querySelector('.ed-visual')); return { left: Math.max(r.left, 0), top: Math.max(r.top, 0), right: Math.min(r.right, innerWidth), bottom: Math.min(r.bottom, innerHeight) } }
const visibleBar = () => grips().querySelector('.gb:not([hidden])')
const sizes = () => {
  const v = document.querySelector('.ed-visual')
  const tbl = document.querySelectorAll('.tbl')[C.table]
  const sc = tbl.querySelector(':scope > .tbl-scroll')
  const t = rc(sc.querySelector(':scope > table'))
  return { dh: document.documentElement.scrollHeight - document.documentElement.clientHeight, dw: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    vh: v.scrollHeight, vw: v.scrollWidth, vcw: v.clientWidth, vt: v.scrollTop, fw: sc.scrollWidth, fl: sc.scrollLeft, table: t }
}
const cellsOf = (tbl) => {
  const sc = tbl.querySelector(':scope > .tbl-scroll')
  const f = rc(sc)
  const out = []
  ;[...sc.querySelectorAll(':scope > table > tbody > tr')].forEach((tr, r) => [...tr.children].forEach((td, k) => {
    const q = rc(td)
    const clipped = { left: Math.max(q.left, f.left), top: Math.max(q.top, f.top), right: Math.min(q.right, f.right), bottom: Math.min(q.bottom, f.bottom) }
    if (clipped.right > clipped.left && clipped.bottom > clipped.top) out.push({ r, k, ...clipped })
  }))
  return out
}
const stripBoxes = (skip) => [...grips().querySelectorAll('.cg, .rg, .bd')].filter((s) => s !== skip).map((s) => ({ el: s, ...rc(s) })).filter((s) => s.width > 0 && s.height > 0 && getComputedStyle(s.el).display !== 'none')
const isles = () => [...document.querySelectorAll('.isle')].map(rc).filter((r) => r.width > 0 && r.height > 0)

const open = async () => {
  window.postMessage({ type: 'init', text: C.text, version: 1, fileName: 'a.adoc', locale: 'ru', outlineView: 'capsule', fileDir: '/tmp', mode: 'visual' }, '*')
  await sleep(300)
  for (let i = 0; i < 50 && !document.querySelector('.tbl td'); i++) await sleep(100)
  await sleep(600)
}

const colorOf = (s) => { const m = /rgba?\\(([^)]*)\\)/.exec(s); return m ? m[1].split(',').slice(0, 4).map(Number) : [0, 0, 0, 1] }
const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]) }
const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) }

window.__errs = []
window.addEventListener('error', (e) => window.__errs.push(String(e.message)))
const run = async () => {
  const out = { width: innerWidth, theme: document.body.dataset.notaTheme || 'light', reduced: matchMedia('(prefers-reduced-motion: reduce)').matches, id: C.id, visits: [], errors: [] }
  await open()
  if (C.caretOut) {
    const ps = [...document.querySelectorAll('.ed-visual [contenteditable="true"] > p')]
    const last = ps[ps.length - 1]
    if (last) {
      document.querySelector('.ed-visual [contenteditable="true"]').focus()
      const t = last.firstChild
      const r = document.createRange()
      r.setStart(t, t.textContent.length); r.collapse(true)
      const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r)
      document.dispatchEvent(new Event('selectionchange'))
      await sleep(400)
    }
  }
  if (C.caretIn) {
    document.querySelector('.ed-visual [contenteditable="true"]').focus()
    const td = document.querySelector('.ed-visual td, .ed-visual th')
    const r = document.createRange()
    const tn = document.createTreeWalker(td, NodeFilter.SHOW_TEXT).nextNode()
    r.setStart(tn || td, 0); r.collapse(true)
    const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r)
    document.dispatchEvent(new Event('selectionchange'))
    await sleep(600)
  }
  out.capsules = [...document.querySelectorAll('.isle')].map((e) => Math.round(rc(e).height))
  const tbl = () => document.querySelectorAll('.tbl')[C.table]
  const sc = () => tbl().querySelector(':scope > .tbl-scroll')
  if (C.bottom) { const v = document.querySelector('.ed-visual'); v.scrollTop = v.scrollHeight; await sleep(300) }
  if (C.scrollFrame) { sc().scrollLeft = C.scrollFrame; await sleep(200) }
  out.before = sizes()
  out.titles = 0
  const over = async (cell) => { const p = centre(rc(cell)); move(p.x, p.y); await sleep(150) }
  for (const v of C.visits) {
    const rec = { kind: v.kind, i: v.i, problems: [] }
    out.visits.push(rec)
    // (the row of the table that is visible: a row that is out of the tab is brought in)
    const tr = [...sc().querySelectorAll(':scope > table > tbody > tr')]
    if (v.kind === 'row' && !C.bottom) tr[v.i].scrollIntoView({ block: 'center', behavior: 'instant' })
    if (v.kind === 'col' && (C.caretIn || C.caretOut)) {
      // Bring each column of the first table into view before looking for its grip.
      const frame = rc(sc()), column = rc(tr[0].children[v.i])
      if (column.left < frame.left || column.right > frame.right) sc().scrollLeft += centre(column).x - centre(frame).x
    }
    await sleep(300)
    const cell = [...sc().querySelectorAll(':scope > table > tbody > tr > :is(td, th)')].find((c) => { const q = rc(c); const f = rc(sc()); return q.left >= f.left && q.right <= f.right + 1 && q.top >= bounds().top + 60 && q.bottom <= bounds().bottom - 10 }) || sc().querySelector('td')
    await over(cell)
    const n = String([...document.querySelectorAll('.tbl')].indexOf(tbl()))
    const strip = grips().querySelector('[data-t="' + n + '"][data-kind="' + v.kind + '"][data-i="' + v.i + '"]')
    if (!strip) { rec.nogrip = true; continue }
    out.titles += grips().querySelectorAll('.cg[title], .rg[title], .bd[title], .gbtn[title]').length
    out.margin = getComputedStyle(tbl()).marginTop
    const sr = rc(strip)
    rec.st = [document.querySelector('.ed-visual').scrollTop]
    const sp = centre(sr)
    const t0 = performance.now()
    // (the opacity along the coming of the bar, every frame)
    const samples = []
    let sampling = true
    const sample = () => { const b = grips().querySelector('.gb'); if (b && !b.hidden) samples.push([performance.now() - t0, +getComputedStyle(b).opacity]); if (sampling) requestAnimationFrame(sample) }
    requestAnimationFrame(sample)
    move(sp.x, sp.y)
    await sleep(700)
    rec.samples = samples.slice()
    const bar = visibleBar()
    if (!bar) { sampling = false; rec.nobar = true; rec.strip = sr; const gb = grips().querySelector('.gb'); const ev = document.querySelector('.ed-visual'); rec.dbg = { st: ev.scrollTop, sh: ev.scrollHeight, ch: ev.clientHeight, samples: samples.slice(-3), errs: window.__errs, gb: !!gb, hidden: gb && gb.hidden, cls: gb && gb.className, style: gb && gb.getAttribute('style'), strips: grips().querySelectorAll('.cg').length, sp, sr, isles: isles(), vis: bounds(), scr: rc(document.querySelector('.ed-visual')) }; continue }
    rec.samplesTail = samples.slice(-3)
    rec.st.push(document.querySelector('.ed-visual').scrollTop)
    rec.opacity = samples.length ? samples[samples.length - 1][1] : +getComputedStyle(bar).opacity
    const b0 = rc(bar)
    rec.bar = b0
    rec.barLabel = bar.getAttribute('aria-label')
    rec.role = bar.getAttribute('role')
    const bounds0 = bounds()
    const cells = cellsOf(tbl())
    const range = [v.i, v.i]
    // for the bar
    if (!inside(b0, bounds0)) rec.problems.push('bar outside the tab ' + JSON.stringify(b0) + ' ' + JSON.stringify(bounds0))
    for (const s of isles()) if (hit(b0, s)) rec.problems.push('bar on a capsule')
    for (const s of stripBoxes(null)) if (hit(b0, s)) rec.problems.push('bar on a grip ' + s.el.className + s.el.dataset.i)
    for (const c of cells) if (hit(b0, c)) rec.problems.push('bar on a cell ' + c.r + ',' + c.k)
    const btns = [...bar.querySelectorAll('.gbtn')]
    rec.buttons = btns.map((b) => ({ label: b.getAttribute('aria-label'), off: b.getAttribute('aria-disabled') === 'true', rect: rc(b), icon: getComputedStyle(b).color }))
    // the mouse goes from the grip to a button along a straight line, in small steps: in no frame is the bar gone or faint
    rec.bridge = { frames: 0, bad: [] }
    for (const target of [btns[0], btns[btns.length - 1]]) {
      const tp = centre(rc(target))
      for (let k = 1; k <= 12; k++) {
        move(sp.x + ((tp.x - sp.x) * k) / 12, sp.y + ((tp.y - sp.y) * k) / 12)
        await new Promise((r) => requestAnimationFrame(r))
        const g = grips().querySelector('.gb')
        const op = g && !g.hidden ? +getComputedStyle(g).opacity : 0
        rec.bridge.frames++
        if (op < 0.99 || !eq(rc(g), b0)) rec.bridge.bad.push([k, op])
      }
      move(sp.x, sp.y)
      await sleep(150)
    }
    rec.tips = []
    for (const [k, b] of btns.entries()) {
      if (btns[k - 1]) btns[k - 1].dispatchEvent(new MouseEvent('mouseleave'))
      const p = centre(rc(b))
      move(p.x, p.y)
      b.dispatchEvent(new MouseEvent('mouseenter'))
      await sleep(500)
      const barNow = visibleBar()
      const tipEl = grips().querySelector('.gtip:not([hidden])')
      const t = { label: b.getAttribute('aria-label'), reason: b.dataset.reason || null, shown: !!tipEl, bar: barNow ? rc(barNow) : null, rects: btns.map((x) => rc(x)), problems: [] }
      rec.tips.push(t)
      if (!tipEl) continue
      const r = rc(tipEl)
      t.box = r
      t.text = tipEl.textContent
      t.own = grips().classList.contains('gtip-own')
      if (!inside(r, bounds0)) t.problems.push('hint outside the tab ' + JSON.stringify(r))
      for (const s of isles()) if (hit(r, s)) t.problems.push('hint on a capsule')
      for (const s of stripBoxes(null)) if (hit(r, s)) t.problems.push('hint on a grip ' + s.el.className + s.el.dataset.i)
      if (hit(r, rc(barNow))) t.problems.push('hint on its bar')
      const outer = tbl().parentElement.closest('td, th')
      for (const c of cells) {
        if (!hit(r, c)) continue
        const own = v.kind === 'col' ? c.k >= range[0] && c.k <= range[1] : c.r >= range[0] && c.r <= range[1]
        if (!own) t.problems.push('hint on a cell of another line ' + JSON.stringify(c) + ' hint ' + JSON.stringify(r))
      }
      if (outer && !inside(r, rc(outer))) { const tb = rc(sc()); if (!inside(r, tb)) t.problems.push('hint outside the cell of the outer table') }
      t.reasonOnly = tipEl.classList.contains('reason')
    }
    btns[btns.length - 1].dispatchEvent(new MouseEvent('mouseleave'))
    // the size of the page and of the table, with the hints shown
    rec.after = sizes()
    rec.st.push(document.querySelector('.ed-visual').scrollTop)
    sampling = false
    // (the first visit only): the mouse goes over the buttons again, to the neighbour grip and back: the same rectangles
    if (C.neighbours && !out.k8) {
      const frames = []
      for (const [k, b] of btns.entries()) { const p = centre(rc(b)); move(p.x, p.y); await sleep(120); frames.push({ bar: rc(visibleBar()), buttons: btns.map((x) => rc(x)) }) }
      const other = grips().querySelector('[data-t="' + n + '"][data-kind="' + v.kind + '"][data-i="' + (v.i + 1) + '"]')
      const first = { bar: b0, buttons: rec.buttons.map((x) => x.rect) }
      out.k8 = { same: frames.every((f) => eq(f.bar, first.bar) && f.buttons.every((q, k) => eq(q, first.buttons[k]))), neighbour: null }
      if (other) {
        const op = centre(rc(other))
        move(op.x, op.y)
        await sleep(40)
        const bars = [...grips().querySelectorAll('.gb:not([hidden])')]
        // (the strip is lit by the hover, which a synthetic move does not set: the bar of the strip that is lit carries its name, and stands nearer to it)
        const hotNow = !!bars[0] && bars[0].getAttribute('aria-label') === other.getAttribute('aria-label')
        const bc = bars[0] ? centre(rc(bars[0])) : null
        const oc = centre(rc(other)), fc = centre(sr)
        const d = (a, b) => (v.kind === 'col' ? Math.abs(a.x - b.x) : Math.abs(a.y - b.y))
        out.k8.neighbour = { bars: bars.length, rect: bars[0] ? rc(bars[0]) : null, hot: hotNow, nearer: !!bc && d(bc, oc) < d(bc, fc), moved: !!bars[0] && !eq(rc(bars[0]), b0), strip: rc(other) }
        await sleep(300)
        const sp0 = centre(rc(grips().querySelector('[data-t="' + n + '"][data-kind="' + v.kind + '"][data-i="' + v.i + '"]')))
        move(sp0.x, sp0.y)
        await sleep(300)
        out.k8.back = rc(visibleBar())
        out.k8.backSame = eq(out.k8.back, b0)
      }
    }
    // the bar goes when the mouse leaves: the opacity falls in at most 150 ms, then it is hidden
    if (out.leave === undefined) {
      move(2, 2)
      const t1 = performance.now()
      const fall = []
      for (let k = 0; k < 40; k++) { await sleep(16); const b = grips().querySelector('.gb'); fall.push([performance.now() - t1, b && !b.hidden ? +getComputedStyle(b).opacity : 0]) }
      out.leave = { fall, gone: !visibleBar() }
      await sleep(500)
    }
  }
  // the keyboard: Enter on a grip of a column and of a row opens the bar and puts the focus on its first button; the bar is whole in the tab and on no capsule
  if (C.caretIn) {
    out.enter = []
    for (const [kind, i] of [['col', 1], ['row', 0]]) {
      move(2, 2)
      await sleep(500)
      await over(sc().querySelector('td'))
      const strip = grips().querySelector('[data-t="0"][data-kind="' + kind + '"][data-i="' + i + '"]')
      if (!strip) { out.enter.push({ kind, i, nogrip: true }); continue }
      const other = grips().querySelector('[data-t="0"][data-kind="row"][data-i="1"]')
      if (other) {
        const p = centre(rc(other))
        move(p.x, p.y)
        await sleep(200)
      }
      strip.focus({ preventScroll: true })
      strip.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
      await sleep(500)
      const bar = visibleBar()
      const b = bar && rc(bar)
      out.enter.push({ kind, i, open: !!bar, focused: !!bar && bar.contains(document.activeElement) && document.activeElement.classList.contains('gbtn'), whole: !!b && inside(b, bounds()), onCapsule: !!b && isles().some((s) => hit(b, s)) })
      document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
      await sleep(300)
    }
  }
  // the colours, once, with the bar of the first column open
  const first = C.visits[0]
  if (first) {
    const n = String([...document.querySelectorAll('.tbl')].indexOf(tbl()))
    document.querySelector('.ed-visual').scrollTop = 0
    await sleep(300)
    await over(sc().querySelector('td'))
    const strip = grips().querySelector('[data-t="' + n + '"][data-kind="' + first.kind + '"][data-i="' + first.i + '"]')
    if (strip) { const p = centre(rc(strip)); move(p.x, p.y); await sleep(600) }
    const b = visibleBar()
    if (b) {
      const bg = colorOf(getComputedStyle(b).backgroundColor)
      out.colors = [...b.querySelectorAll('.gbtn')].map((x) => ({ off: x.getAttribute('aria-disabled') === 'true', ratio: contrast(colorOf(getComputedStyle(x).color), bg), durations: getComputedStyle(x).transitionDuration + '/' + getComputedStyle(x).animationDuration }))
      out.barDur = getComputedStyle(b).transitionDuration + '/' + getComputedStyle(b).animationDuration
      out.barOpacity = +getComputedStyle(b).opacity
      out.docBg = getComputedStyle(document.querySelector('.ed-visual')).backgroundColor
      out.barBg = getComputedStyle(b).backgroundColor
    }
  }
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
interface Tip {
  label: string
  reason: string | null
  shown: boolean
  bar: Box | null
  rects: Box[]
  problems: string[]
  box?: Box
  text?: string
  own?: boolean
  reasonOnly?: boolean
}
interface VisitOut {
  kind: 'col' | 'row'
  i: number
  problems: string[]
  nobar?: boolean
  nogrip?: boolean
  dbg?: unknown
  strip?: Box
  bar?: Box
  barLabel?: string
  role?: string
  opacity?: number
  samplesTail?: unknown
  st?: number[]
  samples?: [number, number][]
  buttons?: { label: string; off: boolean; rect: Box; icon: string }[]
  tips?: Tip[]
  bridge?: { frames: number; bad: [number, number][] }
  after?: Sizes
}
interface Sizes {
  dh: number
  dw: number
  vh: number
  vw: number
  vcw: number
  vt: number
  fw: number
  fl: number
  table: Box
}
interface Out {
  id: string
  width: number
  theme: string
  reduced: boolean
  before: Sizes
  titles: number
  margin?: string
  capsules?: number[]
  enter?: { kind: string; i: number; nogrip?: boolean; open?: boolean; focused?: boolean; whole?: boolean; onCapsule?: boolean }[]
  visits: VisitOut[]
  k8?: { same: boolean; neighbour: { bars: number; rect: Box | null; hot: boolean; nearer: boolean; moved: boolean; strip: Box } | null; back?: Box; backSame?: boolean }
  leave?: { fall: [number, number][]; gone: boolean }
  colors?: { off: boolean; ratio: number; durations: string }[]
  barDur?: string
  barOpacity?: number
  docBg?: string
  barBg?: string
  error?: string
}


/** The page runs in real time in a Chrome of its own (the transitions and the frames are real); it posts its record to a server of the test, which ends the Chrome. */
async function pageFor(width: number, theme: 'dark' | 'light', reduced: boolean, c: Case): Promise<Out> {
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
        prefix: 'gripbar',
        timeout: 280_000,
        timeoutMessage: 'the page did not report',
        args: [
          '--headless=new',
          '--disable-gpu',
          '--no-first-run',
          '--disable-renderer-backgrounding',
          '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows',
          `--window-size=${Math.max(width, 600)},900`,
          ...(reduced ? ['--force-prefers-reduced-motion'] : []),
          `http://127.0.0.1:${port}/`,
        ],
      },
      () => result,
    )
  } finally {
    server?.close()
  }
}

const measured = new Map<string, Out>()
async function measureAll(width: number, theme: 'dark' | 'light', reduced = false): Promise<void> {
  for (const c of casesFor()) {
    if (reduced && c.id !== 'T') continue
    // (a headless Chrome sometimes dies at the start: once more)
    const out = await pageFor(width, theme, reduced, c).catch(() => pageFor(width, theme, reduced, c))
    measured.set(`${width}/${theme}/${reduced}/${c.id}`, out)
    if (process.env.NOTA_REPORT) report(out)
  }
}
const got = (width: number, theme: string, id: string, reduced = false): Out => {
  const o = measured.get(`${width}/${theme}/${reduced}/${id}`)
  if (!o) throw new Error(`case ${id} was not measured`)
  return o
}

const f = (n: number | undefined): string => (n === undefined ? '-' : n.toFixed(1))
function report(o: Out): void {
  const lines = [`== ${o.id} tab ${o.width} ${o.theme}${o.reduced ? ' reduced' : ''} ==`]
  for (const v of o.visits) {
    lines.push(`${v.kind}${v.i}: st=${v.st} op=${v.opacity} ${JSON.stringify(v.samplesTail)} ${v.nobar ? 'NO BAR ' + JSON.stringify(v.dbg) : `bar ${f(v.bar?.left)},${f(v.bar?.top)} ${f(v.bar?.width)}x${f(v.bar?.height)}`} ${v.problems.join('; ')}`)
    for (const t of v.tips ?? []) lines.push(`   ${t.label}: ${t.shown ? `${f(t.box?.left)},${f(t.box?.top)} ${f(t.box?.width)}x${f(t.box?.height)} own=${t.own} reasonOnly=${t.reasonOnly}` : 'no hint'} ${t.problems.join('; ')}`)
  }
  console.log(lines.join('\n'))
}

const problems = (o: Out): string[] => o.visits.flatMap((v) => [...v.problems.map((p) => `${o.id} ${v.kind}${v.i}: ${p}`), ...(v.tips ?? []).flatMap((t) => t.problems.map((p) => `${o.id} ${v.kind}${v.i} «${t.label}»: ${p}`))])

const near = (a: number, b: number, d = 0.5): boolean => Math.abs(a - b) <= d

describe.skipIf(!CHROME)('the bar at a grip and the hints of its buttons (real Chrome)', () => {
  const runs: [number, 'dark' | 'light'][] = [
    [1280, 'light'],
    [1280, 'dark'],
    [390, 'light'],
    [390, 'dark'],
  ]
  for (const [width, theme] of runs) {
    describe(`a tab of ${width} px, ${theme} theme`, () => {
      beforeAll(() => measureAll(width, theme), 1_800_000)
      const all = (): Out[] => casesFor().map((c) => got(width, theme, c.id))

      it('every grip of a table shows its bar (three buttons, a toolbar) where the table is in view', { timeout: 100_000 }, () => {
        for (const o of all()) {
          for (const v of o.visits) {
            // (the grip of a column that the frame has scrolled out is not drawn: the grips of hidden columns are not shown)
            if (v.nogrip) continue
            // (a column that the capsule of the tab or the edge of the tab hides has none: the table that is the first block stands lower for it)
            // (only the cases whose grip can be out of the tab by the design: the frame that is scrolled, the last rows at the lower edge; a table that is the first
            // block or is in a cell has the bar at every grip that is drawn)
            if (v.nobar) {
              expect(o.id === 'wide-scrolled' || o.id === 'bottom', `${o.id} ${v.kind}${v.i}: no bar`).toBe(true)
              continue
            }
            expect(v.bridge?.frames, `${o.id} ${v.kind}${v.i}: bridge frames`).toBe(24)
            expect(v.bridge?.bad, `${o.id} ${v.kind}${v.i}: the bar is faint or gone on the way to a button`).toEqual([])
            expect(v.role, `${o.id} ${v.kind}${v.i}`).toBe('toolbar')
            expect(v.buttons, `${o.id} ${v.kind}${v.i}`).toHaveLength(3)
            expect(v.opacity, `${o.id} ${v.kind}${v.i}: opacity`).toBeGreaterThan(0.99)
          }
        }
        expect(got(width, theme, 'T').visits.every((v) => v.nogrip || !v.nobar), 'table T: every grip that is drawn has a bar').toBe(true)
        // (the table that is the first block has a bar at every column and row, under the capsule of the tab, the caret in the table or out of it; the margin of 44 px
        // (the bar of 26 px and 18 px more) is what makes room, and it is the same for both)
        const fb = got(width, theme, 'first-block')
        expect(fb.margin, 'first-block: the margin above the table').toBe('44px')
        expect(Math.max(...fb.capsules!), 'first-block: the capsule of the tab is the one of one row (the caret is out of the table)').toBeLessThan(60)
        expect(fb.visits.filter((v) => !v.nogrip && !v.nobar).length, 'first-block: bars').toBe(fb.visits.length)
        const fi = got(width, theme, 'first-block-in')
        expect(fi.margin, 'first-block-in: the margin does not depend on the caret').toBe('44px')
        expect(Math.max(...fi.capsules!), 'first-block-in: the capsule of the tab has its second row (the caret is in the table)').toBeGreaterThan(60)
        expect(fi.visits.filter((v) => !v.nogrip && !v.nobar).length, 'first-block-in: bars at every grip (the caret in the table)').toBe(fi.visits.length)
        expect(fi.visits.length).toBe(6)
        expect(fi.enter, 'first-block-in: Enter on a grip of a column and of a row').toEqual([
          { kind: 'col', i: 1, open: true, focused: true, whole: true, onCapsule: false },
          { kind: 'row', i: 0, open: true, focused: true, whole: true, onCapsule: false },
        ])
        const nest = got(width, theme, 'nested')
        expect(nest.visits.filter((v) => !v.nogrip && !v.nobar).length, 'nested: bars').toBe(nest.visits.length)
        expect(nest.visits.length, 'nested: grips drawn').toBeGreaterThan(0)
        for (const v of [...fb.visits, ...nest.visits]) expect(v.nogrip, `${v.kind}${v.i}: a grip is drawn`).toBeUndefined()
        expect(got(width, theme, 'T').visits.filter((v) => !v.nogrip).length, 'table T: grips drawn').toBeGreaterThan(5)
      })

      it('the size of the document, of the scroller and of the table does not change with the bar and the hints', { timeout: 100_000 }, () => {
        for (const o of all()) {
          expect(o.before.dh, `${o.id}: the document scrolls in height`).toBeLessThanOrEqual(0)
          expect(o.before.dw, `${o.id}: the document scrolls in width`).toBeLessThanOrEqual(0)
          for (const v of o.visits) {
            const a = v.after
            if (!a) continue
            expect(a.dh, `${o.id} ${v.kind}${v.i}`).toBeLessThanOrEqual(0)
            expect(a.dw, `${o.id} ${v.kind}${v.i}`).toBeLessThanOrEqual(0)
            expect(a.vh, `${o.id} ${v.kind}${v.i}: ed-visual scrollHeight`).toBe(o.before.vh)
            expect(a.vw, `${o.id} ${v.kind}${v.i}: ed-visual scrollWidth`).toBe(o.before.vw)
            expect(a.vcw, `${o.id} ${v.kind}${v.i}: ed-visual clientWidth`).toBe(o.before.vcw)
            expect(a.fw, `${o.id} ${v.kind}${v.i}: frame scrollWidth`).toBe(o.before.fw)
            if (o.id !== 'wide-scrolled' && o.id !== 'wide') expect(a.fl, `${o.id} ${v.kind}${v.i}: frame scrollLeft`).toBe(o.before.fl)
            expect(near(a.table.width, o.before.table.width), `${o.id} ${v.kind}${v.i}: table width`).toBe(true)
            expect(near(a.table.height, o.before.table.height), `${o.id} ${v.kind}${v.i}: table height`).toBe(true)
          }
        }
      })

      it('the bar and its buttons stand still while the mouse goes over them; on the next grip the bar moves at once, one bar at a time', { timeout: 100_000 }, () => {
        const o = got(width, theme, 'T')
        expect(o.k8?.same, 'the rectangles of the bar and of the buttons').toBe(true)
        expect(o.k8?.neighbour?.bars, 'bars in the frame after the move').toBe(1)
        expect(o.k8?.neighbour?.hot, 'the bar of the neighbour grip carries its name: the lit grip and the bar are the same grip').toBe(true)
        expect(o.k8?.neighbour?.moved, 'the bar is at the neighbour, not where it was').toBe(true)
        expect(o.k8?.neighbour?.nearer, 'the bar is nearer to the neighbour grip than to the first').toBe(true)
        expect(o.k8?.backSame, 'back to the first grip: the same place').toBe(true)
        for (const v of o.visits) for (const t of v.tips ?? []) for (const [k, r] of t.rects.entries()) expect(near(r.left, v.buttons![k]!.rect.left) && near(r.top, v.buttons![k]!.rect.top), `${v.kind}${v.i}: button ${k}`).toBe(true)
      })

      it('the bar and its hint lie inside the tab, not on a capsule, not on a grip, not on a cell of another line', { timeout: 100_000 }, () => {
        const bad = all().flatMap(problems)
        expect(bad).toEqual([])
      })

      it('every button has a hint with its name (the reason for a dimmed one); no grip and no button has a title', { timeout: 100_000 }, () => {
        for (const o of all()) {
          expect(o.titles, `${o.id}: title attributes`).toBe(0)
          for (const v of o.visits)
            for (const t of v.tips ?? []) {
              if (!t.shown) continue
              if (t.reasonOnly) expect(t.text, `${o.id} ${v.kind}${v.i}`).toBe(t.reason)
              else expect(t.text?.startsWith(t.label), `${o.id} ${v.kind}${v.i}: «${t.text}» for «${t.label}»`).toBe(true)
            }
        }
        // (the hint of the table that stands in a row of the page is there at all where there is room: T has hints for every button)
        for (const v of got(width, theme, 'T').visits) if (!v.nogrip) expect(v.tips!.every((t) => t.shown), `T ${v.kind}${v.i}: a hint for every button`).toBe(true)
      })

      it('the icons are 3:1 against the bar; the bar differs from the page', { timeout: 100_000 }, () => {
        const o = got(width, theme, 'T')
        for (const c of o.colors ?? []) if (!c.off) expect(c.ratio, 'icon contrast').toBeGreaterThanOrEqual(3)
        expect(o.colors?.length).toBe(3)
        expect(o.barBg).not.toBe(o.docBg)
      })
    })
  }

  describe('a tab of 1280 px: the motion', () => {
    beforeAll(async () => {
      await measureAll(1280, 'light', false)
      await measureAll(1280, 'light', true)
    }, 1_800_000)
    it('the bar comes up by opacity alone in 120–200 ms and goes in at most 150 ms', () => {
      const o = got(1280, 'light', 'T')
      const s = o.visits[0]!.samples!
      expect(s.length).toBeGreaterThan(3)
      for (let k = 1; k < s.length; k++) expect(s[k]![1], 'monotonic').toBeGreaterThanOrEqual(s[k - 1]![1] - 0.001)
      expect(s[0]![1]).toBeLessThan(0.5)
      const first = s[0]![0]
      const done = s.find((x) => x[1] >= 0.99)
      expect(done, 'reaches 1').toBeDefined()
      expect(done![0] - first, 'the length of the coming').toBeGreaterThanOrEqual(120)
      expect(done![0] - first, 'the length of the coming').toBeLessThanOrEqual(200)
      const fall = o.leave!.fall
      const start = fall.find((x) => x[1] < 0.99)
      const zero = fall.find((x) => x[1] <= 0.01)
      expect(o.leave!.gone || zero !== undefined, 'the bar goes').toBe(true)
      expect(start, 'the fall starts').toBeDefined()
      expect(zero, 'the fall ends').toBeDefined()
      expect(zero![0] - start![0], 'the length of the going').toBeLessThanOrEqual(150)
      // (the bar was gone within 400 ms of the mouse leaving: 250 ms wait and 120 ms fade)
      const gone = fall.find((x) => x[1] <= 0.01)
      expect(gone && gone[0], 'gone by 400 ms').toBeLessThanOrEqual(400)
    })

    it('with reduced motion the bar is final in the first frame, and every duration is 0s', () => {
      const o = got(1280, 'light', 'T', true)
      expect(o.reduced).toBe(true)
      const s = o.visits[0]!.samples!
      expect(s[0]![1], 'the first frame').toBeGreaterThan(0.99)
      expect(o.barDur).toBe('0s/0s')
      for (const c of o.colors ?? []) expect(c.durations).toBe('0s/0s')
    })
  })
})
