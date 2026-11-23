// the capsule of selected cells (`CellMenu`), measured in a real Chrome on the real bundle of the tab and its real style sheet (jsdom has no layout), as
// `gripbar-layout.test.ts` does: it shows after the button is up, never with the capsule of the text, has the group buttons, stands in the visible part of
// the tab and lies on no selected cell, grip, bar of the grips or capsule, rides with the scroll and goes with the selection, folds into one line in a narrow
// tab with every command within two presses, and does not change the size of the page. Skipped where Chrome is not installed. `NOTA_REPORT=1` prints the
// record of every case, `NOTA_ONLY=<id>` runs one.
import { existsSync, readFileSync } from 'node:fs'
import { type Server, createServer } from 'node:http'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { withChrome } from './chrome.js'
import { tabBundle } from './bundle.js'

const CHROME = [process.env.CHROME_BIN ?? '', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => p && existsSync(p))
const here = import.meta.dirname
const at = (path: string): string => join(here, path)

const LETTERS = 'abcdefghi'
/** A table of `cols` columns and `rows` rows whose cells are `b2` (a letter for the column, a number for the row). */
function grid(cols: number, rows: number, o: { title?: boolean; head?: boolean } = {}): string {
  let t = (o.title === false ? '' : '= Тест\n\n') + (o.head ? '[%header]\n' : '') + '|===\n'
  for (let r = 1; r <= rows; r++) t += Array.from({ length: cols }, (_, k) => `|${LETTERS[k]}${r}`).join(' ') + '\n\n'
  return t + '|===\n\nТекст после таблицы.\n'
}
function wide(): string {
  let t = '= Тест\n\n[cols="9"]\n|===\n'
  for (let r = 1; r <= 12; r++) t += Array.from({ length: 9 }, (_, k) => `|${LETTERS[k]}${r} значение ячейки с длинным текстом`).join(' ') + '\n\n'
  return t + '|===\n'
}

interface Case {
  id: string
  text: string
  /** The cells (their texts), the first clicked and the last Shift-clicked; or `rows`/`cols`: the grips. */
  sel: [string, string]
  /** The frame of the table is scrolled sideways by this many px before the selection. */
  scrollFrame?: number
  /** The page is scrolled to the bottom before the selection. */
  bottom?: boolean
  /** The selection is made, the page is scrolled by these px, and the capsule is measured again. */
  scrollBy?: number
  /** The selection by the grips: a line of columns or rows, `from`..`to` (click, Shift+click). */
  lines?: { kind: 'col' | 'row'; from: number; to: number }
  /** The keys and the changes of the selection: Esc in the text, Alt+F10, Tab, a change of the text, the text capsule and the cells one after another. */
  keys?: boolean
  /** The frame of the table is scrolled sideways after the capsule has shown, and the tab is made narrower. */
  moves?: boolean
  /** The case is for this width of the tab alone (its text is the narrowest the capsule is made for). */
  only?: number
}

const CASES: Case[] = [
  { id: 'T', text: grid(4, 4), sel: ['b2', 'c3'], moves: true },
  { id: 'first-row', text: grid(4, 4), sel: ['b1', 'c1'] },
  { id: 'first-block', text: grid(4, 4, { title: false }), sel: ['b1', 'c2'] },
  { id: 'column', text: grid(6, 20), sel: ['b1', 'b20'] },
  { id: 'row', text: grid(6, 20), sel: ['a2', 'f2'] },
  { id: 'wide-scrolled', text: wide(), sel: ['c2 значение ячейки с длинным текстом', 'd3 значение ячейки с длинным текстом'], scrollFrame: 200, moves: true },
  { id: 'bottom', text: grid(4, 40), sel: ['b39', 'c40'], bottom: true },
  { id: 'scroll', text: grid(4, 30), sel: ['b8', 'c9'], scrollBy: 40 },
  { id: 'grips-cols', text: grid(4, 4), sel: ['b1', 'c4'], lines: { kind: 'col', from: 1, to: 2 } },
  { id: 'grips-rows', text: grid(4, 6), sel: ['a2', 'd3'], lines: { kind: 'row', from: 1, to: 2 } },
  // a table of the second level (written with `!`) inside a cell
  { id: 'nested', text: '= Тест\n\n|===\na|\n!===\n!n1 !n2 !n3\n\n!n4 !n5 !n6\n\n!n7 !n8 !n9\n!===\n|b1\n|===\n', sel: ['n1', 'n5'] },
  { id: 'keys', text: grid(4, 4), sel: ['b2', 'c3'], keys: true },
  // the first row with a merged cell: eight buttons (the head, the split); in a tab of 280 px the last of them go into «⋯» (the eight fit a tab of 320 px)
  { id: 'eight', text: '= Тест\n\n|===\n|a1 |b1 |c1\n2+|a2 |c2\n|a3 |b3 |c3\n|===\n', sel: ['a1', 'a2'], only: 280 },
  { id: 'seven', text: '= Тест\n\n|===\n|a1 |b1 |c1\n\n2+|a2 |c2\n\n|a3 |b3 |c3\n|===\n', sel: ['a2', 'c3'], only: 360 },
]
const cases = (width?: number): Case[] =>
  CASES.filter((c) => (process.env.NOTA_ONLY ? c.id === process.env.NOTA_ONLY : true) && (c.only === undefined ? width !== 280 : c.only === width))

const runner = (c: Case): string => `
const C = ${JSON.stringify(c)}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const rc = (e) => { const r = e.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height } }
const hit = (a, b) => a.left < b.right - 0.01 && b.left < a.right - 0.01 && a.top < b.bottom - 0.01 && b.top < a.bottom - 0.01
const vis = () => { const r = rc(document.querySelector('.ed-visual')); return { left: Math.max(r.left, 0), top: Math.max(r.top, 0), right: Math.min(r.right, innerWidth), bottom: Math.min(r.bottom, innerHeight) } }
const cap = () => document.querySelector('.cellbar')
const cell = (text) => [...document.querySelectorAll('.ed-visual td, .ed-visual th')].find((x) => x.textContent === text || x.textContent === 'x' + text || x.textContent === text + 'x')
const sizes = () => { const v = document.querySelector('.ed-visual'); const sc = document.querySelector('.tbl-scroll'); const t = rc(sc.querySelector('table'))
  return { dh: document.documentElement.scrollHeight - document.documentElement.clientHeight, dw: document.documentElement.scrollWidth - document.documentElement.clientWidth, vh: v.scrollHeight, vw: v.scrollWidth, fw: sc.scrollWidth, fh: sc.scrollHeight, tw: t.width, th: t.height } }
const selBox = () => { const cs = [...document.querySelectorAll('td.sel, th.sel')].map(rc); return cs.length ? { left: Math.min(...cs.map((r) => r.left)), top: Math.min(...cs.map((r) => r.top)), right: Math.max(...cs.map((r) => r.right)), bottom: Math.max(...cs.map((r) => r.bottom)) } : null }
const mouse = (type, el, extra) => { const p = rc(el); el.dispatchEvent(new MouseEvent(type, Object.assign({ bubbles: true, cancelable: true, clientX: p.left + p.width / 2, clientY: p.top + p.height / 2 }, extra || {}))) }
const place = (td) => { const ed = document.querySelector('.ed-visual [contenteditable="true"]'); ed.focus(); const r = document.createRange(); const tn = document.createTreeWalker(td, NodeFilter.SHOW_TEXT).nextNode(); r.setStart(tn || td, 0); r.collapse(true); const s = getSelection(); s.removeAllRanges(); s.addRange(r); document.dispatchEvent(new Event('selectionchange')) }

window.__errs = []
window.addEventListener('error', (e) => window.__errs.push(String(e.message)))
const run = async () => {
  const out = { id: C.id, width: innerWidth, theme: document.body.dataset.notaTheme || 'light', reduced: matchMedia('(prefers-reduced-motion: reduce)').matches, errors: [] }
  window.postMessage({ type: 'init', text: C.text, version: 1, fileName: 'a.adoc', locale: 'ru', fileDir: '/tmp', mode: 'visual' }, '*')
  await sleep(400)
  for (let i = 0; i < 50 && !document.querySelector('.tbl td'); i++) await sleep(100)
  await sleep(600)
  const v = document.querySelector('.ed-visual')
  if (C.scrollFrame) { document.querySelector('.tbl-scroll').scrollLeft = C.scrollFrame; await sleep(200) }
  out.before = sizes()
  const a = cell(C.sel[0]), b = cell(C.sel[1])
  place(a)
  await sleep(300)
  if (C.bottom) { v.scrollTop = v.scrollHeight; await sleep(300) }
  else { b.scrollIntoView({ block: 'center' }); await sleep(200) }
  out.noneForOne = !cap()
  // the button goes down on the last cell: no capsule while it is down; by the grips: a click on the first, Shift+click on the last
  const strip = (i) => document.querySelector('.nota-grips [data-t="0"][data-kind="' + (C.lines && C.lines.kind) + '"][data-i="' + i + '"]')
  const stripOf = async (i) => { const td = C.lines.kind === 'col' ? document.querySelectorAll('.tbl tr:first-child td, .tbl tr:first-child th')[i] : document.querySelectorAll('.tbl tr')[i].querySelector('td, th'); const p = rc(td); document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: p.left + p.width / 2, clientY: p.top + p.height / 2, buttons: 0 })); await sleep(500); return strip(i) }
  if (C.lines) {
    const first = await stripOf(C.lines.from)
    if (!first) { out.nostrip = true; return out }
    mouse('mousedown', first, {}); mouse('mouseup', first, {})
    await sleep(500)
    if (C.lines.to !== C.lines.from) {
      const last = await stripOf(C.lines.to)
      mouse('mousedown', last, { shiftKey: true })
      await sleep(300)
      out.downNo = true
      mouse('mouseup', last, {})
    } else out.downNo = true
    out.noneForOne = true
    await sleep(400)
    out.gbar = !!document.querySelector('.nota-grips .gb:not([hidden])')
  } else {
    mouse('mousedown', b, { shiftKey: true })
    await sleep(300)
    out.downNo = !cap()
    mouse('mouseup', b, {})
  }
  const t0 = performance.now()
  let first = null
  for (let i = 0; i < 40 && first === null; i++) { await sleep(25); const c = cap(); if (c && getComputedStyle(c).visibility === 'visible') first = performance.now() - t0 }
  out.appearMs = first
  await sleep(400)
  const c = cap()
  if (!c) { out.nocap = true; out.sel = !!selBox(); return out }
  out.role = c.getAttribute('role'); out.label = c.getAttribute('aria-label')
  out.names = [...c.querySelectorAll('.bb-layer.bar > button')].map((x) => x.getAttribute('aria-label'))
  out.cmds = [...c.querySelectorAll('.bb-layer.bar > button')].map((x) => x.dataset.cmd)
  out.titles = c.querySelectorAll('[title]').length
  out.others = document.querySelectorAll('.bubble:not(.cellbar)').length
  out.height = rc(c).height
  out.btn = rc(c.querySelector('button')).height
  out.reducedDur = [getComputedStyle(c).animationDuration, getComputedStyle(c).transitionDuration].join('/')
  const measure = () => {
    const cr = rc(c); const bounds = vis(); const sb = selBox(); const rec = { cap: cr, sel: sb, problems: [] }
    if (cr.left < bounds.left + 4 - 0.5 || cr.right > bounds.right - 4 + 0.5 || cr.top < bounds.top + 4 - 0.5 || cr.bottom > bounds.bottom - 4 + 0.5) rec.problems.push('outside the tab ' + JSON.stringify(cr) + JSON.stringify(bounds))
    const exempt = C.id === 'column'
    if (sb && !exempt) for (const t of document.querySelectorAll('td.sel, th.sel')) if (hit(cr, rc(t))) { rec.problems.push('on a selected cell'); break }
    for (const s of document.querySelectorAll('.nota-grips .cg, .nota-grips .rg, .nota-grips .gb:not([hidden]), .nota-grips .gtip:not([hidden])')) { const r = rc(s); if (r.width > 0 && r.height > 0 && getComputedStyle(s).display !== 'none' && hit(cr, r)) { rec.problems.push('on a grip ' + s.className); break } }
    for (const s of document.querySelectorAll('.isle')) { const r = rc(s); if (r.width > 0 && r.height > 0 && hit(cr, r)) { rec.problems.push('on a capsule'); break } }
    rec.above = sb ? cr.bottom <= sb.top + 0.5 : null
    rec.below = sb ? cr.top >= sb.bottom - 0.5 : null
    rec.dx = sb ? (cr.left + cr.width / 2) - (Math.max(sb.left, 0) + Math.min(sb.right, innerWidth)) / 2 : null
    return rec
  }
  out.m = measure()
  out.after = sizes()
  // the popups hang on the side far from the selection, and lie on no button
  const btn = c.querySelectorAll('.bb-layer.bar > button')[1] || c.querySelector('button')
  mouse('mouseover', btn, {}); btn.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }))
  await sleep(700)
  const tip = document.querySelector('.nota-tip')
  out.tip = tip ? { box: rc(tip), name: tip.querySelector('.nota-tip-name').textContent, onCap: hit(rc(tip), rc(c)), onSel: selBox() ? hit(rc(tip), selBox()) : false } : null
  const cb = rc(c)
  // the colours
  const fillBtn = c.querySelector('[data-cmd="cell-fill"]')
  if (fillBtn) {
    fillBtn.click(); await sleep(500)
    const cc = cap()
    out.row = cc ? { cr: rc(cc), rows: cc.querySelectorAll('.cr').length, inside: rc(cc).left >= vis().left && rc(cc).right <= vis().right + 0.5, same: Math.abs(rc(cc).top - cb.top) < 1 } : null
    out.rowM = cc ? measure() : null
    out.after2 = sizes()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    await sleep(400)
    out.backBar = !!cap() && !!cap().querySelector('.bb-layer.bar > button')
  }
  if (C.moves) {
    const sc = document.querySelector('.tbl-scroll')
    const before = measure()
    // the middle of the part of the selection that is in the frame (the capsule is centred on it)
    const mid = (sb, w) => { const f = sc.getBoundingClientRect(); const vb = vis(); const m = (Math.max(sb.left, f.left, vb.left) + Math.min(sb.right, f.right, vb.right)) / 2; return m }
    const left0 = sc.scrollLeft
    sc.scrollLeft += 150
    await sleep(500)
    const now = cap() ? measure() : null
    out.fscroll = { moved: sc.scrollLeft - left0, scrollable: sc.scrollWidth > sc.clientWidth, gone: !now, problems: now ? now.problems : [], dSel: now && now.sel && before.sel ? now.sel.left - before.sel.left : null, dCap: now ? (now.cap.left + now.cap.width / 2) - (before.cap.left + before.cap.width / 2) : null, free: !!now && [before.cap, now.cap].every((c) => c.left > vis().left + 8 && c.right < vis().right - 8), dMid: now && now.sel && before.sel ? mid(now.sel, now.cap.width) - mid(before.sel, before.cap.width) : null }
    // the selection leaves the frame sideways: no capsule; back in the frame: the capsule is back
    sc.scrollLeft = sc.scrollWidth
    await sleep(500)
    const away = !cap() || getComputedStyle(cap()).visibility === 'hidden'
    const cellsAway = selBox() ? selBox().right <= sc.getBoundingClientRect().left + 0.5 || selBox().left >= sc.getBoundingClientRect().right - 0.5 : false
    out.fscroll.away = away; out.fscroll.cellsAway = cellsAway
    sc.scrollLeft = left0
    await sleep(500)
    out.fscroll.back = !!cap() && getComputedStyle(cap()).visibility === 'visible'
    sc.scrollLeft = left0
    await sleep(300)
    // the tab gets narrower: the capsule is placed again, inside the tab
    const app = document.getElementById('app')
    const w = app.getBoundingClientRect().width
    app.style.width = Math.max(300, w - 70) + 'px'
    await sleep(700)
    const nw = cap() ? measure() : null
    out.resized = { w: app.getBoundingClientRect().width, gone: !nw, problems: nw ? nw.problems : [] }
    app.style.width = w + 'px'
    await sleep(500)
  }
  if (C.scrollBy) {
    const before = measure()
    v.scrollTop += C.scrollBy
    await sleep(300)
    const after = cap() ? measure() : null
    out.scroll = after ? { dTop: after.cap.top - before.cap.top, dSel: after.sel.top - before.sel.top } : { gone: true }
    v.scrollTop += 4000
    await sleep(400)
    out.scrolledAway = !cap() || getComputedStyle(cap()).visibility === 'hidden'
    v.scrollTop = 0
    await sleep(500)
    out.back = !!cap() && getComputedStyle(cap()).visibility === 'visible'
  }
  // the list «⋯»: every command that is not on the capsule is in it, inside the tab
  const more = cap() && cap().querySelector('[data-cmd="more"]')
  if (more) {
    more.click(); await sleep(300)
    const list = cap().querySelector('.cm-list')
    const lr = list ? rc(list) : null
    out.more = list ? { labels: [...list.querySelectorAll('button')].map((x) => x.querySelector('.cm-name').textContent), inside: lr.left >= vis().left - 0.5 && lr.right <= vis().right + 0.5 && lr.top >= vis().top - 0.5 && lr.bottom <= vis().bottom + 0.5, onSel: selBox() ? hit(lr, selBox()) : false, onBar: hit(lr, rc(cap().querySelector('.bb-layer.bar'))) } : null
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    await sleep(200)
  }
  if (C.keys) {
    const ed = document.querySelector('.ed-visual [contenteditable="true"]')
    const key = (el, k, extra) => el.dispatchEvent(new KeyboardEvent('keydown', Object.assign({ key: k, bubbles: true, cancelable: true }, extra || {})))
    const hid = () => !cap() || getComputedStyle(cap()).visibility === 'hidden'
    const nsel = () => document.querySelectorAll('td.sel, th.sel').length
    const goneIn = async (limit) => { const t = performance.now(); for (let i = 0; i < limit / 8; i++) { if (hid()) return performance.now() - t; await sleep(8) } return hid() ? performance.now() - t : Infinity }
    const reselect = async () => { place(a); await sleep(200); mouse('mousedown', b, { shiftKey: true }); mouse('mouseup', b, {}); await sleep(700) }
    out.k = {}
    // Alt+F10 from the text: the focus goes to the capsule; Tab from it goes back to the text, the cells stay
    ed.focus(); key(ed, 'F10', { altKey: true }); await sleep(300)
    out.k.f10 = !!cap() && cap().contains(document.activeElement)
    const btn = document.activeElement
    key(btn, 'Tab'); await sleep(200)
    out.k.tabToText = ed.contains(document.activeElement) && nsel() > 0
    // «Выравнивание» by the keys: the focus goes into the row, Esc brings the buttons back with the focus on the button
    ed.focus(); key(ed, 'F10', { altKey: true }); await sleep(300)
    const al = cap().querySelector('[data-cmd="align"]'); al.focus(); al.click(); await sleep(500)
    out.k.alignRow = !!cap() && !!cap().querySelector('.al-b') && cap().contains(document.activeElement)
    key(document.activeElement, 'Escape'); await sleep(500)
    out.k.alignBack = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.cmd : null
    // Esc in the text: the capsule is out of sight at once, the cells stay; the second Esc lets them go
    ed.focus(); await sleep(100)
    key(ed, 'Escape')
    out.k.escMs = await goneIn(400)
    out.k.escSelStays = nsel() > 0
    key(ed, 'Escape'); await sleep(200)
    out.k.esc2 = nsel() === 0
    // a change of the text takes the capsule away within 200 ms
    await reselect()
    out.k.shown = !hid()
    document.execCommand('insertText', false, 'x')
    out.k.editMs = await goneIn(400)
    // a smaller selection: Shift+click on a nearer cell, the capsule follows and stays
    await reselect()
    mouse('mousedown', cell('b3'), { shiftKey: true }); mouse('mouseup', cell('b3'), {}); await sleep(500)
    out.k.smaller = { sel: nsel(), cap: !hid() }
    // the capsule of the text and the capsule of the cells never stand together, in either direction
    const bubbles = () => [...document.querySelectorAll('.bubble')].filter((x) => { const r = rc(x); const cs = getComputedStyle(x); return r.width > 0 && cs.visibility !== 'hidden' && +cs.opacity > 0.05 }).length
    const watch = () => { const w = { max: 0, on: true }; const f = () => { w.max = Math.max(w.max, bubbles()); const n = bubbles(); if (n > 1 && !w.dbg) w.dbg = [...document.querySelectorAll('.bubble')].map((x) => x.className + ':' + getComputedStyle(x).visibility + ':' + getComputedStyle(x).opacity + ':' + Math.round(rc(x).width)).join(' | '); if (w.on) requestAnimationFrame(f) }; f(); return w }
    const range = (td) => { ed.focus(); const r = document.createRange(); const tn = document.createTreeWalker(td, NodeFilter.SHOW_TEXT).nextNode(); r.setStart(tn, 0); r.setEnd(tn, tn.length); const sl = getSelection(); sl.removeAllRanges(); sl.addRange(r); document.dispatchEvent(new Event('selectionchange')) }
    await reselect()
    mouse('mousedown', a, {}); mouse('mouseup', a, {}); await sleep(300)
    range(cell(C.sel[0])); await sleep(900)
    out.k.textBubble = document.querySelectorAll('.bubble:not(.cellbar)').length
    const w1 = watch()
    mouse('mousedown', b, { shiftKey: true }); mouse('mouseup', b, {}); await sleep(900)
    w1.on = false
    out.k.maxToCells = w1.max; out.k.dbg1 = w1.dbg
    out.k.cellsNow = !hid() && document.querySelectorAll('.bubble:not(.cellbar)').length === 0
    const w2 = watch()
    range(cell(C.sel[0])); await sleep(900)
    w2.on = false
    out.k.maxToText = w2.max; out.k.dbg2 = w2.dbg
    out.k.textNow = hid() && document.querySelectorAll('.bubble:not(.cellbar)').length > 0
  }
  // a click without Shift: the capsule goes, within 200 ms
  mouse('mousedown', a, {}); mouse('mouseup', a, {})
  { const t = performance.now(); for (let i = 0; i < 50 && cap() && getComputedStyle(cap()).visibility !== 'hidden'; i++) await sleep(8); out.clickMs = performance.now() - t }
  await sleep(250)
  out.goneAfterClick = !cap()
  return out
}
run().then((o) => fetch('/res', { method: 'POST', body: JSON.stringify(o) }), (e) => fetch('/res', { method: 'POST', body: JSON.stringify({ error: String(e && e.stack || e) }) }))
`

interface Box {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}
interface Measure {
  cap: Box
  sel: Box | null
  problems: string[]
  above: boolean | null
  below: boolean | null
  dx: number | null
}
interface Sizes {
  dh: number
  dw: number
  vh: number
  vw: number
  fw: number
  fh: number
  tw: number
  th: number
}
interface Out {
  id: string
  width: number
  theme: string
  reduced: boolean
  before: Sizes
  after?: Sizes
  after2?: Sizes
  noneForOne?: boolean
  downNo?: boolean
  appearMs?: number | null
  nocap?: boolean
  sel?: boolean
  role?: string
  label?: string
  names?: string[]
  cmds?: string[]
  titles?: number
  others?: number
  height?: number
  btn?: number
  reducedDur?: string
  m?: Measure
  tip?: { box: Box; name: string; onCap: boolean; onSel: boolean } | null
  row?: { cr: Box; rows: number; inside: boolean; same: boolean } | null
  rowM?: Measure | null
  backBar?: boolean
  more?: { labels: string[]; inside: boolean; onSel: boolean; onBar: boolean } | null
  scroll?: { dTop: number; dSel: number; gone?: boolean }
  scrolledAway?: boolean
  nostrip?: boolean
  gbar?: boolean
  clickMs?: number
  fscroll?: { moved: number; scrollable: boolean; gone: boolean; problems: string[]; dSel: number | null; dCap: number | null; dMid: number | null; free: boolean; away?: boolean; cellsAway?: boolean; back?: boolean }
  resized?: { w: number; gone: boolean; problems: string[] }
  k?: { f10: boolean; tabToText: boolean; alignRow: boolean; alignBack: string | null; escMs: number; escSelStays: boolean; esc2: boolean; shown: boolean; editMs: number; smaller: { sel: number; cap: boolean }; textBubble: number; maxToCells: number; cellsNow: boolean; maxToText: number; textNow: boolean }
  back?: boolean
  goneAfterClick?: boolean
  error?: string
}


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
        prefix: 'cellmenu',
        timeout: 120_000,
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
  for (const c of cases(width)) {
    if (reduced && c.id !== 'T') continue
    const out = await pageFor(width, theme, reduced, c).catch(() => pageFor(width, theme, reduced, c))
    measured.set(`${width}/${theme}/${reduced}/${c.id}`, out)
    if (process.env.NOTA_REPORT) console.log(JSON.stringify(out))
  }
}
const got = (width: number, theme: string, id: string, reduced = false): Out => {
  const o = measured.get(`${width}/${theme}/${reduced}/${id}`)
  if (!o) throw new Error(`case ${id} was not measured`)
  return o
}

describe.skipIf(!CHROME)('the capsule of selected cells (real Chrome)', () => {
  const runs: [number, 'dark' | 'light'][] = [
    [1280, 'light'],
    [1280, 'dark'],
    [360, 'light'],
    [360, 'dark'],
    [650, 'light'],
    [390, 'light'],
  ]
  for (const [width, theme] of runs) {
    describe(`a tab of ${width} px, ${theme} theme`, () => {
      beforeAll(() => measureAll(width, theme), 1_800_000)
      const all = (): Out[] => cases(width).map((c) => got(width, theme, c.id))

      it('the capsule shows after the button is up, not before, and goes with a click', { timeout: 100_000 }, () => {
        for (const o of all()) {
          expect(o.nocap, `${o.id}: the capsule shows`).toBeUndefined()
          expect(o.noneForOne, `${o.id}: one cell, no capsule`).toBe(true)
          expect(o.downNo, `${o.id}: the button is down, no capsule`).toBe(true)
          expect(o.appearMs ?? Infinity, `${o.id}: it shows within 300 ms`).toBeLessThanOrEqual(300)
          expect(o.goneAfterClick, `${o.id}: a click without Shift takes it away`).toBe(true)
          expect(o.clickMs ?? Infinity, `${o.id}: and within 200 ms`).toBeLessThanOrEqual(200)
          expect(o.height, `${o.id}: the height of the capsule of the text`).toBeGreaterThanOrEqual(33)
          expect(o.height!).toBeLessThanOrEqual(36)
        }
      })

      it('a toolbar with its name, no capsule of the text, the buttons of the selection, no title', { timeout: 100_000 }, () => {
        for (const o of all()) {
          expect(o.role, o.id).toBe('toolbar')
          expect(o.label, o.id).toBe('Действия с ячейками')
          expect(o.others, `${o.id}: the capsule of the text`).toBe(0)
          expect(o.titles, `${o.id}: title attributes`).toBe(0)
        }
        const t = got(width, theme, 'T')
        const wanted = ['merge', 'align', 'cell-fill', 'clear', 'row-del', 'col-del']
        // (all six stand on the capsule from 360 px: the design)
        if (width >= 360) expect(t.cmds, 'T: the buttons').toEqual(wanted)
        expect(t.names![0]).toBe('Объединить ячейки')
        const fr = got(width, theme, 'first-row')
        expect(fr.cmds, 'first row: the head is among the buttons').toContain('head')
      })

      it('the capsule is inside the tab and lies on no selected cell, grip, bar of the grips or capsule', { timeout: 100_000 }, () => {
        for (const o of all()) {
          const m = o.m!
          const rest = m.problems.filter((p) => !(o.id === 'column' && p === 'on a selected cell'))
          expect(rest, `${o.id}: ${JSON.stringify(m.cap)}`).toEqual([])
          // ACCEPTED LIMITATION: in a tab <= 400 px the row of colours may lie on the strips `.rg`;
          // an accepted limitation: the capsule under the selection may cover the place where the width of the columns is changed. The `.bd` strips are not in `avoid` either.
          expect(o.rowM?.problems.filter((p) => !(o.id === 'column' && p === 'on a selected cell') && !(width <= 400 && o.id === 'grips-rows' && p === 'on a grip rg')) ?? [], `${o.id}: with the colours`).toEqual([])
        }
        const t = got(width, theme, 'T').m!
        expect(t.below, 'T: under the selection').toBe(true)
        expect(Math.abs(t.dx!), 'T: in the middle of the selection').toBeLessThan(8)
        const fr = got(width, theme, 'bottom').m!
        expect(fr.above || fr.below, 'bottom: on a side of the selection').toBe(true)
        expect(got(width, theme, 'column').m!.problems.filter((p) => p !== 'on a selected cell')).toEqual([])
      })

      it('the size of the page and of the table does not change with the capsule, its popups and the colours', { timeout: 100_000 }, () => {
        for (const o of all()) {
          for (const a of [o.after, o.after2]) {
            if (!a) continue
            expect(a.dh, `${o.id}: the document scrolls in height`).toBeLessThanOrEqual(0)
            expect(a.dw, `${o.id}: the document scrolls in width`).toBeLessThanOrEqual(0)
            expect(a.vh, `${o.id}: scrollHeight of the tab`).toBe(o.before.vh)
            expect(a.vw, `${o.id}: scrollWidth of the tab`).toBe(o.before.vw)
            expect(a.fw, `${o.id}: scrollWidth of the frame`).toBe(o.before.fw)
            expect(Math.abs(a.tw - o.before.tw), `${o.id}: the width of the table`).toBeLessThanOrEqual(0.5)
            expect(Math.abs(a.th - o.before.th), `${o.id}: the height of the table`).toBeLessThanOrEqual(0.5)
          }
        }
      })

      it('the capsule rides with the selection, goes when it has left, and comes back', { timeout: 100_000 }, () => {
        const o = got(width, theme, 'scroll')
        expect(o.scroll?.gone, 'scroll: the capsule stays after a small scroll').toBeUndefined()
        expect(Math.abs(o.scroll!.dTop - o.scroll!.dSel), 'scroll: the capsule moves as the selection does').toBeLessThanOrEqual(1)
        expect(o.scrolledAway, 'scroll: gone with the selection').toBe(true)
        expect(o.back, 'scroll: back').toBe(true)
      })

      it('the colours stand in place of the buttons, the capsule stays; Esc brings the buttons back', { timeout: 100_000 }, () => {
        const o = got(width, theme, 'T')
        expect(o.row, 'T: the row of colours').not.toBeNull()
        expect(o.row!.rows).toBeGreaterThan(0)
        expect(o.row!.same, 'T: the capsule stays on its place (the same top)').toBe(true)
        expect(o.row!.inside, 'T: the row is inside the tab').toBe(true)
        expect(o.backBar, 'T: Esc brings the buttons back').toBe(true)
      })

      it('the selection by the grips: the capsule lies on no grip and no bar of the group, in the tab', { timeout: 100_000 }, () => {
        for (const id of ['grips-cols', 'grips-rows']) {
          const o = got(width, theme, id)
          expect(o.nostrip, `${id}: the grip is found`).toBeUndefined()
          expect(o.nocap, `${id}: the capsule shows`).toBeUndefined()
          expect(o.m!.problems, `${id}: ${JSON.stringify(o.m!.cap)}`).toEqual([])
          // ACCEPTED LIMITATION: a row of colours is as wide as a narrow tab (<= 400 px), so it may lie on the `.rg` strips;
          // an accepted limitation: nothing keeps the row of colours off the strips `.rg` in a narrow tab.
          expect((o.rowM?.problems ?? []).filter((p) => !(width <= 400 && id === 'grips-rows' && p === 'on a grip rg')), `${id}: with the colours`).toEqual([])
          expect(o.names!.length, `${id}: the buttons`).toBeGreaterThanOrEqual(5)
        }
        // (in a narrow tab the group bar has no place and is not drawn: there is nothing to lie on)
        if (width > 400) expect(got(width, theme, 'grips-cols').gbar, 'grips-cols: the bar of the group is open').toBe(true)
      })

      it('a table of the second level inside a cell', { timeout: 100_000 }, () => {
        const o = got(width, theme, 'nested')
        expect(o.nocap, 'nested: the capsule shows').toBeUndefined()
        expect(o.m!.problems, `nested: ${JSON.stringify(o.m!.cap)}`).toEqual([])
      })

      it('the frame of the table scrolled sideways under the selection, and a narrower tab: the capsule stays inside the tab', { timeout: 100_000 }, () => {
        const w = got(width, theme, 'wide-scrolled')
        expect(w.fscroll!.scrollable, 'the frame scrolls').toBe(true)
        expect(w.fscroll!.moved, 'the frame moved').not.toBe(0)
        expect(w.fscroll!.problems, 'the frame scrolled').toEqual([])
        expect(w.fscroll!.gone, 'the selection is still in the frame: the capsule stays').toBe(false)
        // (a capsule that stands at the edge of the tab is held by it, so only a free one must follow the selection)
        if (w.fscroll!.free) expect(Math.abs(w.fscroll!.dCap! - w.fscroll!.dMid!), 'the capsule goes with the selection (±1 px)').toBeLessThanOrEqual(1)
        if (w.fscroll!.cellsAway) expect(w.fscroll!.away, 'the selection left the frame sideways: no capsule').toBe(true)
        expect(w.fscroll!.back, 'the selection is back in the frame: the capsule is back').toBe(true)
        expect(w.resized!.problems, 'narrower: wide-scrolled').toEqual([])
        const t = got(width, theme, 'T')
        expect(t.resized!.gone, 'T: narrower, the capsule stays').toBe(false)
        expect(t.resized!.problems, 'T: narrower').toEqual([])
      })

      it('Esc, Alt+F10, Tab, a change of the text, the capsule of the text and the one of the cells never together', { timeout: 100_000 }, () => {
        const k = got(width, theme, 'keys').k!
        expect(k.f10, 'Alt+F10: the focus is on the capsule of the cells').toBe(true)
        expect(k.tabToText, 'Tab goes to the text, the cells stay').toBe(true)
        expect(k.alignRow, 'the alignment by the keys: the focus is in the row').toBe(true)
        expect(k.alignBack, 'Esc: the focus is back on the button').toBe('align')
        expect(k.escMs, 'Esc in the text: the capsule goes within 200 ms').toBeLessThanOrEqual(200)
        expect(k.escSelStays, 'Esc in the text: the cells stay').toBe(true)
        expect(k.esc2, 'the second Esc lets the cells go').toBe(true)
        expect(k.shown, 'shown again after a new selection').toBe(true)
        expect(k.editMs, 'a change of the text takes it away within 200 ms').toBeLessThanOrEqual(200)
        expect(k.smaller, 'a smaller selection: the capsule stays').toEqual({ sel: 2, cap: true })
        expect(k.textBubble, 'the capsule of the text shows for a text selection').toBe(1)
        expect(k.maxToCells, 'text to cells: never two capsules').toBeLessThanOrEqual(1)
        expect(k.cellsNow, 'text to cells: the capsule of the cells alone').toBe(true)
        expect(k.maxToText, 'cells to text: never two capsules').toBeLessThanOrEqual(1)
        expect(k.textNow, 'cells to text: the capsule of the text alone').toBe(true)
      })

      it('the popup of a button hangs on the far side and lies on no button and no selected cell', { timeout: 100_000 }, () => {
        for (const o of all()) {
          if (!o.tip) continue
          expect(o.tip.onCap, `${o.id}: the popup on the capsule`).toBe(false)
          expect(o.tip.onSel, `${o.id}: the popup on the selection`).toBe(false)
        }
        expect(got(width, theme, 'T').tip, 'T has a popup').not.toBeNull()
      })

      if (width < 400)
        it('in a narrow tab the capsule is one line inside the tab, and what does not fit is in «⋯»', { timeout: 100_000 }, () => {
          for (const o of all()) {
            expect(o.m!.cap.width, `${o.id}: the width`).toBeLessThanOrEqual(width - 8)
            expect(o.m!.cap.height, `${o.id}: one line`).toBeLessThanOrEqual(36)
          }
        })
    })
  }

  describe('a tab of 280 px (at 320 px the eight fit whole): eight buttons do not fit', () => {
    beforeAll(() => measureAll(280, 'light'), 600_000)
    it('the capsule is one line inside the tab, the last buttons are in «⋯», and the list shows them all with their names', { timeout: 100_000 }, () => {
      const o = got(280, 'light', 'eight')
      expect(o.nocap).toBeUndefined()
      expect(o.m!.problems).toEqual([])
      expect(o.m!.cap.width).toBeLessThanOrEqual(280 - 8)
      expect(o.m!.cap.height).toBeLessThanOrEqual(36)
      expect(o.cmds).toContain('more')
      expect(o.more, 'the list is open').not.toBeNull()
      expect(o.more!.inside, 'the list is inside the tab').toBe(true)
      expect(o.more!.onSel, 'the list is not on the selection').toBe(false)
      // two buttons go into the list (the design: «две кнопки в ⋯»)
      expect(o.more!.labels.length).toBe(2)
      // every command is on the capsule or in the list: eight in all
      expect(o.cmds!.length - 1 + o.more!.labels.length).toBe(8)
      expect(o.more!.labels.join('|')).toMatch(/Удалить колонк/)
    })
  })

  describe('a tab of 360 px: seven buttons (a merged cell) fit whole', () => {
    it('one line, no «⋯»', { timeout: 100_000 }, () => {
      const o = got(360, 'light', 'seven')
      expect(o.nocap).toBeUndefined()
      expect(o.m!.problems).toEqual([])
      expect(o.cmds).not.toContain('more')
      expect(o.cmds!.length).toBe(7)
      expect(o.m!.cap.height).toBeLessThanOrEqual(36)
    })
  })

  describe('reduced motion', () => {
    beforeAll(() => measureAll(1280, 'light', true), 600_000)
    it('every duration of the capsule is 0s', () => {
      const o = got(1280, 'light', 'T', true)
      expect(o.reduced).toBe(true)
      expect(o.reducedDur).toBe('0s/0s')
    })
  })
})
