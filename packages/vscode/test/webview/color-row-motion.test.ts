/* eslint-disable @typescript-eslint/no-explicit-any -- the record of the page is a loose JSON, read by the checks below */
// the row of colour circles opens and folds up smoothly. Measured in a real Chrome in real time (jsdom has no layout and no frames), on the
// real bundle of the tab and its real style sheet, as `color-row-layout.test.ts` does, but with the animations ON: from the moment of the click the rectangle of the
// panel (or of the capsule) and the `opacity` of the circles are written in every `requestAnimationFrame`. Tabs of 390, 520, 700 and 1280 px, the dark and the
// light theme; the same run once more with `--force-prefers-reduced-motion`, whose settled rectangles are those the animated run must come to.
// Skipped, with the reason, where Chrome is not installed.
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

if (!CHROME) console.warn('Chrome is not installed (set CHROME_BIN): the test of the motion of the rows of colours in a real browser is skipped')

const META = readFileSync(at('../../../../quality/fixtures/editor/page-meta.adoc'), 'utf8')
const HEAD = META.slice(0, META.indexOf('\n////', 4) + 5)
const TEXT =
  `${HEAD}\n\n= Заголовок\n\n` +
  'Привязаны к проекту: файл прикреплён по образцу из каталога и ещё несколько слов подряд для длинной строки, чтобы слово встало у края.\n\n' +
  '[cols="1,1"]\n|===\n|[.cell-blue]##{empty}##Левая ячейка со словами\n|[.cell-green]##{empty}##Правая ячейка со словами\n\n' +
  '2+|[.cell-yellow]##{empty}##Объединённая ячейка с несколькими словами\n|===\n\n' +
  Array.from({ length: 6 }, (_, i) => `Хвостовой абзац ${i}.\n\n`).join('')

const HEIGHT = 600

const runner = (theme: 'dark' | 'light'): string => `
const THEME = ${JSON.stringify(theme)}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const frame = () => new Promise((r) => requestAnimationFrame(() => r()))
const vis = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' }
const word = (sel, which, nth) => {
  const p = document.querySelectorAll(sel)[nth]
  const w = document.createTreeWalker(p, NodeFilter.SHOW_TEXT)
  const words = []
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    const re = /\\S+/g
    for (let m = re.exec(n.textContent); m; m = re.exec(n.textContent)) {
      const r = document.createRange(); r.setStart(n, m.index); r.setEnd(n, m.index + m[0].length)
      const b = r.getBoundingClientRect()
      if (b.width > 0) words.push({ n, from: m.index, to: m.index + m[0].length, b })
    }
  }
  const top = Math.min(...words.map((x) => x.b.y))
  const line = words.filter((x) => Math.abs(x.b.y - top) < 4)
  return which === 'left' ? line[0] : line[line.length - 1]
}
const mouse = (el, type, extra) => el.dispatchEvent(new MouseEvent(type, { bubbles: type !== 'mouseenter' && type !== 'mouseleave', cancelable: true, view: window, ...(extra || {}) }))
const key = (k, target, extra) => (target || document).dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...(extra || {}) }))
const click = (el, detail) => { mouse(el, 'mousedown'); mouse(el, 'click', { detail: detail === undefined ? 1 : detail }) }
const select = (w) => {
  const ed = document.querySelector('.ProseMirror')
  ed.focus()
  const r = document.createRange(); r.setStart(w.n, w.from); r.setEnd(w.n, w.to)
  const s = getSelection(); s.removeAllRanges(); s.addRange(r)
}
const caret = (w) => {
  const ed = document.querySelector('.ProseMirror')
  ed.focus()
  const r = document.createRange(); r.setStart(w.n, w.from); r.collapse(true)
  const s = getSelection(); s.removeAllRanges(); s.addRange(r)
}
const box = (kind) => document.querySelector(kind === 'cell' ? '.isle-mid .isle-tools' : '.fl.bubble:not(.bb-ghost)')
const rectOf = (e) => { if (!e) return null; const r = e.getBoundingClientRect(); return [r.left, r.top, r.width, r.height] }
const T = { t0: 0 }
const snap = (kind) => {
  const b = box(kind)
  const row = document.querySelector('.cr')
  return {
    t: performance.now() - T.t0,
    box: rectOf(b),
    st: b ? (b.getAttribute("style") || "") + "|" + (b.getAttribute("data-morph") || "") : "",
    dots: [...document.querySelectorAll('.cr .sw-b')].map((d) => +getComputedStyle(d).opacity),
    name: (() => { const n = document.querySelector('.cr-name'); return n && vis(n) ? +getComputedStyle(n).opacity : null })(),
    row: Boolean(row) && !row.classList.contains('is-leaving'),
    bar: Boolean(document.querySelector('.fl.bubble:not(.bb-ghost) .bb-layer.bar:not(.is-out) [data-cmd]')),
    ghost: (() => { const g = document.querySelector('.fl.bb-ghost'); return g ? { r: rectOf(g), o: +getComputedStyle(g).opacity, inert: g.hasAttribute('inert') } : null })(),
    cghost: (() => { const g = document.querySelector('.tl-colors-out'); return g ? { o: +getComputedStyle(g).opacity, inert: g.hasAttribute('inert') } : null })(),
  }
}
// the action runs, and every frame from that moment is written for \`ms\`
const record = async (kind, act, ms) => {
  const out = []
  let on = true
  T.t0 = performance.now()
  act()
  out.push(snap(kind))
  const loop = () => { out.push(snap(kind)); if (on) requestAnimationFrame(loop) }
  requestAnimationFrame(loop)
  await sleep(ms)
  on = false
  await frame()
  return out
}
const settled = async (kind) => { await sleep(500); return rectOf(box(kind)) }
const docHtml = () => document.querySelector('.ProseMirror').innerHTML
const rgb = (s) => { const m = /rgba?\\(([^)]+)\\)/.exec(s); if (!m) return null; const p = m[1].split(/[ ,\\/]+/).map(Number); return p.slice(0, 3) }
const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]) }
const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) }
const hex = (s) => { s = s.trim(); if (s[0] === '#') { const h = s.length === 4 ? s.slice(1).replace(/./g, '$&$&') : s.slice(1); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) } return rgb(s) }
const panelBg = (kind) => { const b = box(kind); let e = b; while (e) { const c = rgb(getComputedStyle(e).backgroundColor); const a = /rgba\\([^)]*,\\s*([\\d.]+)\\)/.exec(getComputedStyle(e).backgroundColor); if (c && !(a && +a[1] === 0)) return c; e = e.parentElement } return [255, 255, 255] }
const out = { width: innerWidth, theme: THEME, reduced: matchMedia('(prefers-reduced-motion: reduce)').matches, cases: [], k4: [], k8: [], k9: [], k10: [], errors: [] }
const press = async (el) => { click(el); await frame() }
const run = async () => {
  document.body.className = THEME === 'dark' ? 'vscode-dark' : 'vscode-light'
  window.postMessage({ type: 'init', text: ${JSON.stringify(TEXT)}, version: 1, fileName: 'a.adoc', locale: 'ru', outlineView: 'capsule', fileDir: '/tmp', mode: 'visual' }, '*')
  for (let i = 0; i < 50 && !document.querySelector('.ProseMirror'); i++) await sleep(100)
  await sleep(600)
  const opener = (kind) => kind === 'cell' ? document.querySelector('.isle-tools [data-cmd="cell-fill"]') : document.querySelector('.fl.bubble:not(.bb-ghost) [data-cmd="' + kind + '"]')
  const unselect = async () => { getSelection().removeAllRanges(); await sleep(350) }
  const choose = async (kind, sel, which, nth) => { select(word(sel, which, nth)); await sleep(700) }
  const durations = (b) => { const cs = getComputedStyle(b); return { transition: cs.transitionDuration, animation: cs.animationDuration } }

  // the panel over the word, the rows «Цвет» and «Заливка», both ends of the line; the capsule, the row «Заливка ячейки»
  const CASES = [
    ['color', 'paragraph-left', '.ProseMirror > p', 'left', 0, ['back', 'outside']],
    ['color', 'paragraph-right', '.ProseMirror > p', 'right', 0, ['back', 'esc']],
    ['fill', 'paragraph-left', '.ProseMirror > p', 'left', 0, ['back', 'esc', 'pick', 'enter']],
    ['fill', 'paragraph-right', '.ProseMirror > p', 'right', 0, ['back', 'outside']],
    ['cell', 'cell-left', 'td .cell-text', 'left', 0, ['back', 'esc', 'outside']],
    ['cell', 'cell-right', 'td .cell-text', 'right', 1, ['back']],
  ]
  for (const [kind, name, sel, which, nth, closers] of CASES) {
    const label = THEME + '/' + kind + '/' + name
    await choose(kind, sel, which, nth)
    const c = { label, kind, closers: {}, bad: [] }
    const before = rectOf(box(kind))
    const scroller = document.querySelector('.ed-visual')
    const scroll0 = scroller.scrollTop
    const html0 = docHtml()
    c.before = before
    c.open = await record(kind, () => click(opener(kind)), 600)
    c.final = await settled(kind)
    c.kind9 = null
    // the circles of the fills against the panel
    if (kind !== 'color') {
      const bg = panelBg(kind)
      const dots = [...document.querySelectorAll('.cr .sw-b.dot')]
      c.kind9 = { bg, dots: dots.map((d) => {
        const cs = getComputedStyle(d)
        const fill = rgb(cs.backgroundColor)
        const ring = d.classList.contains('none') ? hex(cs.borderTopColor) : hex(cs.getPropertyValue('--swr'))
        return { role: d.getAttribute('data-role') || '', none: d.classList.contains('none'), fill, ring, cf: fill ? contrast(fill, bg) : 0, cr: ring ? contrast(ring, bg) : 0 }
      }) }
      const pressed = document.querySelector('.cr .sw-b[aria-pressed="true"]')
      c.kind9.accent = contrast(hex(getComputedStyle(document.body).getPropertyValue('--ap-accent')), bg)
      c.kind9.pressed = Boolean(pressed)
    }
    c.durations = [box(kind), document.querySelector('.cr'), document.querySelector('.cr .sw-b')].filter(Boolean).map((e) => durations(e))
    for (const closer of closers) {
      if (closer !== 'back') {
        await press(opener(kind))
        await sleep(550)
      }
      const dots = () => [...document.querySelectorAll('.cr .sw-b')]
      const act = {
        back: () => document.querySelector('.cr-back').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 })),
        esc: () => key('Escape'),
        pick: () => click(dots()[0]),
        enter: () => key('Enter'),
        // a click outside the text and the panel (on the page around the editor)
        outside: () => { const t = document.getElementById('app'); mouse(t, 'mousedown'); mouse(t, 'mouseup'); mouse(t, 'click', { detail: 1 }) },
      }[closer]
      const frames = await record(kind, act, 500)
      // during the fold a click on a circle and a key apply nothing
      c.closers[closer] = { frames, gone: !box(kind) || kind === 'cell', focus: document.activeElement && document.activeElement.getAttribute ? document.activeElement.getAttribute('data-cmd') : null, htmlSame: docHtml() === html0 }
      await sleep(300)
      // (a click outside takes the panel away: the word is selected again for what follows)
      if (closer === 'outside') await choose(kind, sel, which, nth)
    }
    // the fold gives a click on a circle no effect
    await press(opener(kind)); await sleep(550)
    const hb = docHtml()
    document.querySelector('.cr-back').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }))
    await sleep(40)
    const leaving = [...document.querySelectorAll('.cr.is-leaving .sw-b')]
    if (leaving[3]) { click(leaving[3]); key('Enter'); key('ArrowRight') }
    await sleep(500)
    c.foldInert = { leaving: leaving.length, htmlSame: docHtml() === hb, htmlBack: docHtml() === html0 }
    c.rowGone = document.querySelectorAll('.cr').length
    c.layers = document.querySelectorAll('.fl.bubble .bb-layer').length
    c.styleLeft = box(kind) ? [box(kind).style.width, box(kind).style.height, box(kind).getAttribute('data-morph')] : null
    c.scrollSame = scroller.scrollTop === scroll0
    out.cases.push(c)
    await unselect()
  }

  // «Таблица»: the cursor goes into a cell and back to a paragraph
  {
    const c = { label: THEME + '/table-row', kind: 'cell', closers: {}, bad: [] }
    await choose('cell', '.ProseMirror > p', 'left', 0)
    const scroller = document.querySelector('.ed-visual')
    const p = word('td .cell-text', 'left', 0)
    c.before = rectOf(box('cell'))
    c.scroll0 = scroller.scrollTop
    c.open = await record('cell', () => caret(p), 700)
    c.final = await settled('cell')
    const q = word('.ProseMirror > p', 'left', 0)
    c.closers.out = { frames: await record('cell', () => caret(q), 600) }
    c.scroll = scroller.scrollTop
    out.cases.push(c)
    await unselect()
  }

  // five quick clicks «paragraph ↔ table» in a second: from the frame the capsule is in, no jerks, and the capsule ends in its right form
  {
    const scroller = document.querySelector('.ed-visual')
    const inCell = word('td .cell-text', 'left', 0)
    const inPara = word('.ProseMirror > p', 'left', 0)
    const end = () => { const b = box('cell'); return { box: rectOf(b), style: b ? [b.style.width, b.style.height, b.getAttribute('data-morph')] : null, rows: document.querySelectorAll('.isle-tools .tl-table').length, going: document.querySelectorAll('.isle-tools .tl-table.is-leaving').length, cr: document.querySelectorAll('.cr').length, scroll: scroller.scrollTop } }
    for (const [what, start] of [['five-to-table', inPara], ['five-to-paragraph', inCell]]) {
      await choose('cell', '.ProseMirror > p', 'left', 0)
      if (start === inCell) { caret(inCell); await sleep(700) }
      const scroll0 = scroller.scrollTop
      const out0 = []
      let on = true
      T.t0 = performance.now()
      const loop = () => { out0.push(snap('cell')); if (on) requestAnimationFrame(loop) }
      requestAnimationFrame(loop)
      let to = start === inCell ? inPara : inCell
      for (let i = 0; i < 5; i++) { caret(to); to = to === inCell ? inPara : inCell; await sleep(180) }
      await sleep(700)
      on = false
      await frame()
      out.k4.push({ what, frames: out0, end: end(), scroll0 })
      await unselect()
    }
    out.k4.push({ what: 'paragraph-base', box: out.cases.find((x) => x.label.endsWith('table-row')).before })
    out.k4.push({ what: 'table-base', box: out.cases.find((x) => x.label.endsWith('table-row')).final })
  }

  // five times in a second «open → ‹», and «open → the selection moves»
  {
    const html0 = (await choose('fill', '.ProseMirror > p', 'left', 0), docHtml())
    for (let i = 0; i < 5; i++) {
      click(opener('fill')); await sleep(70)
      document.querySelector('.cr-back').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }))
      await sleep(70)
    }
    await sleep(700)
    const b = box('fill')
    out.k4.push({ what: 'five-times', panel: Boolean(b), rows: document.querySelectorAll('.cr').length, layers: document.querySelectorAll('.fl.bubble .bb-layer').length, style: b ? [b.style.width, b.getAttribute('data-morph')] : null, bar: Boolean(document.querySelector('.fl.bubble .bb-layer.bar [data-cmd="strong"]')), same: docHtml() === html0 })
    await press(opener('fill')); await sleep(550)
    const second = word('.ProseMirror > p', 'left', 0)
    // the second word of the line
    const w = document.createTreeWalker(document.querySelector('.ProseMirror > p'), NodeFilter.SHOW_TEXT)
    const n = w.nextNode()
    const re = /\\S+/g
    re.exec(n.textContent)
    const m2 = re.exec(n.textContent)
    const other = { n, from: m2.index, to: m2.index + m2[0].length }
    const frames = await record('fill', () => select(other), 700)
    const orect = (() => { const r = document.createRange(); r.setStart(other.n, other.from); r.setEnd(other.n, other.to); return r.getBoundingClientRect() })()
    const orect0 = second.b
    const b2 = box('fill')
    out.k4.push({
      what: 'selection-moves',
      frames: frames.map((f) => ({ t: f.t, row: f.row, bar: f.bar, box: f.box, ghost: f.ghost })),
      newCentre: (orect.left + orect.right) / 2,
      oldCentre: (orect0.left + orect0.right) / 2,
      final: b2 ? { box: rectOf(b2), bar: Boolean(document.querySelector('.fl.bubble .bb-layer.bar [data-cmd="strong"]')), rows: document.querySelectorAll('.cr').length } : null,
    })
    await unselect()
  }

  // five times «open → the selection moves» in about a second, and «Esc → the selection moves» after 0, 30, 60 and 100 ms: the new panel with the buttons
  // stands at the new word within 250 ms, there is no frame with the row (or the buttons) of the old panel at the new word or the old one with the buttons, no ghost piles up
  {
    const p0 = document.querySelector('.ProseMirror > p')
    const wn = (i) => {
      const w = document.createTreeWalker(p0, NodeFilter.SHOW_TEXT)
      const n = w.nextNode()
      const re = /\\S+/g
      let m
      for (let k = 0; k <= i; k++) m = re.exec(n.textContent)
      return { n, from: m.index, to: m.index + m[0].length }
    }
    const centreOf = (w) => { const r = document.createRange(); r.setStart(w.n, w.from); r.setEnd(w.n, w.to); const b = r.getBoundingClientRect(); return (b.left + b.right) / 2 }
    const A = wn(0)
    const B = wn(6)
    const ghosts = () => document.querySelectorAll('.bb-ghost').length
    const cycle = async (cur, prep, gap, wait) => {
      const o = opener('fill')
      click(o)
      await sleep(prep)
      if (gap !== null) { key('Escape'); await sleep(gap) }
      const to = cur === A ? B : A
      const fromC = centreOf(cur)
      const toC = centreOf(to)
      const oldEl = box('fill')
      const t0 = performance.now()
      // (\`select()\` changes only the selection of the DOM; the editor learns of it from the \`selectionchange\` event, a task of its own, and a frame can come
      // between the two: the old panel is still there, as it is for any change of the selection. The frames are judged from the task after \`selectionchange\`, in which the
      // editor has taken the selection and the panel is already drawn from it; a frame before that is none of the plugin's)
      let taken = false
      const onChange = () => setTimeout(() => { taken = true }, 0)
      document.addEventListener('selectionchange', onChange, { once: true })
      select(to)
      const r = { ready: null, rowAtNew: false, barAtOld: false, overflow: false, maxGhosts: 0 }
      while (performance.now() - t0 < wait) {
        await frame()
        const b = box('fill')
        // (the old panel goes out of the page with the old selection, so a panel that is not the old element is the new one)
        const near = Boolean(b) && b !== oldEl
        const bar = Boolean(document.querySelector('.fl.bubble:not(.bb-ghost) .bb-layer.bar:not(.is-out) [data-cmd="strong"]'))
        if (taken && near && document.querySelector('.fl.bubble:not(.bb-ghost) .bb-layer.row')) r.rowAtNew = true
        if (taken && bar && !near && b) r.barAtOld = true
        if (near && bar && r.ready === null) { r.ready = performance.now() - t0; if (wait < 700) break }
        r.maxGhosts = Math.max(r.maxGhosts, ghosts())
      }
      r.at = { sel: getSelection().toString(), box: rectOf(box('fill')), fromC, toC, rows: document.querySelectorAll('.cr').length }
      return { r, to }
    }
    const done = () => ({ ghosts: ghosts(), rows: document.querySelectorAll('.cr').length, layers: document.querySelectorAll('.fl.bubble .bb-layer').length, style: box('fill') ? [box('fill').style.width, box('fill').getAttribute('data-morph')] : null, bar: Boolean(document.querySelector('.fl.bubble:not(.bb-ghost) .bb-layer.bar [data-cmd="strong"]')) })
    await unselect(); select(A); await sleep(700)
    {
      let cur = A
      const cycles = []
      const t0 = performance.now()
      for (let i = 0; i < 5; i++) { const { r, to } = await cycle(cur, 60, null, 650); cycles.push(r); cur = to }
      const took = performance.now() - t0
      await sleep(700)
      out.k4.push({ what: 'moves-five', cycles, took, ...done() })
    }
    for (const gap of [0, 30, 60, 100]) {
      await unselect(); select(A); await sleep(700)
      await sleep(300)
      const { r } = await cycle(A, 550, gap, 700)
      await sleep(500)
      out.k4.push({ what: 'esc-move', gap, cycles: [r], ...done() })
    }
    await unselect()
  }

  // the keyboard: Alt+F10, the arrows to «A ⌄», Enter: the focus is on a circle by the next frame, while it moves; the arrows move it, Esc brings it back to «A ⌄»
  {
    await choose('color', '.ProseMirror > p', 'left', 0)
    key('F10', document.querySelector('.ProseMirror'), { altKey: true })
    await sleep(500)
    const k = { focusPanel: document.activeElement && document.activeElement.getAttribute('data-cmd') }
    key('Home', document.activeElement); await sleep(40)
    for (let i = 0; i < 8 && document.activeElement.getAttribute('data-cmd') !== 'color'; i++) { key('ArrowRight', document.activeElement); await sleep(40) }
    k.onColor = document.activeElement.getAttribute('data-cmd')
    click(document.activeElement, 0)
    await frame()
    k.inRow = Boolean(document.activeElement.closest && document.activeElement.closest('.cr .sw-b'))
    k.duringMotion = Boolean(document.querySelector('.fl.bubble[data-morph]'))
    const at0 = document.activeElement.getAttribute('aria-label')
    await sleep(80)
    key('ArrowRight', document.activeElement); await sleep(60)
    k.moved = document.activeElement.getAttribute('aria-label') !== at0
    k.name = document.querySelector('.cr-name-t') && document.querySelector('.cr-name-t').textContent
    key('Escape'); await sleep(400)
    k.back = document.activeElement.getAttribute('data-cmd')
    out.k8.push(k)
    await unselect()
    // the cell
    await choose('cell', 'td .cell-text', 'left', 0)
    const cb = document.querySelector('.isle-tools [data-cmd="cell-fill"]')
    cb.focus()
    click(cb, 0)
    await frame()
    const kc = { inRow: Boolean(document.activeElement.closest && document.activeElement.closest('.cr .sw-b')) }
    await sleep(300)
    key('ArrowRight', document.activeElement); await sleep(60)
    kc.name = document.querySelector('.cr-name-t') && document.querySelector('.cr-name-t').textContent
    key('Escape'); await sleep(400)
    kc.back = document.activeElement.getAttribute('data-cmd')
    out.k8.push(kc)
    await unselect()
  }

  // the fills of the document do not change
  {
    const ed = document.querySelector('.ProseMirror')
    const probe = (cls) => { const s = document.createElement('span'); s.className = cls; ed.appendChild(s); const v = getComputedStyle(s).backgroundColor; s.remove(); return v }
    const cellOf = (cls) => { const t = document.querySelector('td.' + cls); return t ? getComputedStyle(t).backgroundColor : null }
    out.k10 = { hl: ['yellow', 'red', 'orange', 'green', 'teal', 'blue', 'pink', 'purple', 'gray'].map((c) => [c, probe('hl-' + c + '-bg')]), cells: ['cell-blue', 'cell-green', 'cell-yellow'].map((c) => [c, cellOf(c)]) }
  }
  await fetch('/res', { method: 'POST', body: JSON.stringify(out) })
}
run().catch((e) => { out.errors.push(String(e && e.stack || e)); fetch('/res', { method: 'POST', body: JSON.stringify(out) }) })
`

type Frame = {
  t: number
  box: number[] | null
  dots: number[]
  name: number | null
  row: boolean
  bar: boolean
  ghost: { r: number[]; o: number; inert: boolean } | null
  cghost: { o: number; inert: boolean } | null
}
interface Closer {
  frames: Frame[]
  gone?: boolean
  focus?: string | null
  htmlSame?: boolean
}
interface Case {
  label: string
  kind: string
  closers: Record<string, Closer>
  before?: number[] | null
  open: Frame[]
  final?: number[] | null
  kind9?: { bg: number[]; accent: number; pressed: boolean; dots: { role: string; none: boolean; fill: number[] | null; ring: number[] | null; cf: number; cr: number }[] } | null
  durations?: { transition: string; animation: string }[]
  foldInert?: { leaving: number; htmlSame: boolean; htmlBack: boolean }
  rowGone?: number
  layers?: number
  styleLeft?: (string | null)[] | null
  scrollSame?: boolean
  scroll?: number
  scroll0?: number
}
interface Result {
  width: number
  theme: string
  reduced: boolean
  cases: Case[]
  k4: Record<string, any>[]
  k8: Record<string, any>[]
  k10: { hl: [string, string][]; cells: [string, string | null][] }
  errors: string[]
}


/** The page runs in real time in a Chrome of its own; it posts its record to a server of the test, which ends the Chrome. */
async function measure(width: number, theme: 'dark' | 'light', reduced: boolean): Promise<Result> {
  const css = readFileSync(at('../../../react/src/style.css'), 'utf8') + '\n' + readFileSync(at('../../src/webview/style.css'), 'utf8')
  const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><link rel="stylesheet" href="/style.css"><style>html,body{margin:0}#app{width:${width}px;overflow:hidden}</style></head><body class="vscode-dark" data-nota-theme="dark"><div id="app" class="nota" data-mermaid=""></div>
<script>window.acquireVsCodeApi=()=>({postMessage(){},getState:()=>null,setState(){}})</script>
<script src="/webview.js"></script><script src="/run.js"></script></body></html>`
  const files: Record<string, [string, string]> = {
    '/': [html, 'text/html'],
    '/style.css': [css, 'text/css'],
    '/webview.js': [await tabBundle(), 'text/javascript'],
    '/run.js': [runner(theme), 'text/javascript'],
  }
  let server: Server | undefined
  try {
    let resolve!: (o: Result) => void
    const result = new Promise<Result>((res) => {
      resolve = res
    })
    server = createServer((req, res) => {
      if (req.method === 'POST' && req.url === '/res') {
        const parts: Buffer[] = []
        req.on('data', (d: Buffer) => parts.push(d))
        req.on('end', () => {
          res.end('ok')
          resolve(JSON.parse(Buffer.concat(parts).toString('utf8')) as Result)
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
        prefix: 'motion',
        timeout: 200_000,
        timeoutMessage: 'the page did not report',
        args: [
          '--headless=new',
          '--disable-gpu',
          '--no-first-run',
          '--disable-renderer-backgrounding',
          '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows',
          `--window-size=${Math.max(width, 600)},${HEIGHT}`,
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

/** The widths (or heights) of the frames of a move: monotone, how many values between its ends, when it started and ended (ms). */
function motion(frames: Frame[], metric: (f: Frame) => number | undefined, dir: 1 | -1) {
  const v = frames.map((f) => ({ t: f.t, v: metric(f) })).filter((x): x is { t: number; v: number } => x.v !== undefined && Number.isFinite(x.v))
  const first = v[0]!.v
  const last = v[v.length - 1]!.v
  const reversed = v.some((x, i) => i > 0 && (x.v - v[i - 1]!.v) * dir < -0.01)
  const between = new Set(v.filter((x) => Math.abs(x.v - first) > 0.01 && Math.abs(x.v - last) > 0.01).map((x) => x.v.toFixed(1))).size
  const began = v.find((x) => Math.abs(x.v - first) > 0.01)?.t ?? 0
  const ended = [...v].reverse().find((x) => Math.abs(x.v - last) > 0.01)?.t ?? 0
  return { reversed, between, first, last, began, ended, took: ended - began }
}

const sameRect = (a: number[] | null | undefined, b: number[] | null | undefined, eps: number): boolean =>
  Boolean(a && b) && a!.every((v, i) => Math.abs(v - b![i]!) <= eps)

describe.skipIf(!CHROME)('the row of colours opens and folds up smoothly (real Chrome, real time)', () => {
  for (const width of [390, 520, 700, 1280]) {
    const narrow = width <= 650
    // the settled rectangles without motion: the animated run must come to the same
    let calm: Result | undefined
    for (const theme of ['dark', 'light'] as const) {
      it(`a tab of ${width} px, ${theme} theme, with motion on`, { timeout: 590_000 }, async () => {
        const r = await measure(width, theme, false)
        calm ??= await measure(width, theme, true)
        expect(r.errors).toEqual([])
        expect(r.reduced).toBe(false)
        const labels = r.cases.map((c) => c.label)
        expect(labels).toEqual([
          ...['color/paragraph-left', 'color/paragraph-right', 'fill/paragraph-left', 'fill/paragraph-right', 'cell/cell-left', 'cell/cell-right'].map((l) => `${theme}/${l}`),
          `${theme}/table-row`,
        ])
        for (const c of r.cases.filter((x) => x.label !== `${theme}/table-row`)) {
          const kind = c.kind
          const m = motion(c.open, (f) => f.box?.[2], 1)
          const mh = motion(c.open, (f) => f.box?.[3], 1)
          // the width (the capsule: and the height) goes one way, in 160–260 ms, by steps of frames; the top does not move
          if (kind !== 'cell' || !narrow || m.last - m.first > 1) {
            expect(m.reversed, `${c.label}: the width grows ${JSON.stringify(c.open.map((f) => [Math.round(f.t), f.box?.[2]]))}`).toBe(false)
            if (m.last - m.first > 2) {
              expect(m.between, `${c.label}: frames between ${JSON.stringify(m)} ${JSON.stringify(c.open.map((f) => [Math.round(f.t), f.box?.[2], f.box?.[3], (f as any).st]).slice(0, 8))}`).toBeGreaterThanOrEqual(3)
              expect(m.took, `${c.label}: opening time`).toBeGreaterThanOrEqual(160)
              expect(m.took, `${c.label}: opening time`).toBeLessThanOrEqual(260)
            }
          }
          if (kind === 'cell') expect(mh.reversed, `${c.label}: the height grows`).toBe(false)
          else {
            // the top is the same in every frame of the motion: it is not animated and it does not change with the width. Where the settled panel stands on
            // the other side of the word (the wide row does not fit beside it), it goes there once, when the motion has ended
            const moving = c.open.filter((f) => /\|open$/.test((f as any).st))
            expect(moving.length, `${c.label}: frames of the motion`).toBeGreaterThan(2)
            expect(new Set(moving.map((f) => f.box![1]!.toFixed(2))).size, `${c.label}: the top ${JSON.stringify(moving.map((f) => f.box![1]))}`).toBe(1)
            const all = c.open.map((f) => f.box![1]!.toFixed(2))
            const changes = all.flatMap((v, k) => (k > 0 && v !== all[k - 1] ? [k] : []))
            expect(changes.length, `${c.label}: the top changes at most once ${JSON.stringify(c.open.map((f) => [Math.round(f.t), f.box![1]!.toFixed(1), (f as any).st.split('|')[1]]))}`).toBeLessThanOrEqual(1)
            if (changes.length) expect(changes[0]!, `${c.label}: the top changes after the motion`).toBeGreaterThan(c.open.indexOf(moving[moving.length - 1]!))
          }
          // the left edge goes one way
          const left = motion(c.open, (f) => f.box?.[0], c.open[c.open.length - 1]!.box![0]! >= c.open[0]!.box![0]! ? 1 : -1)
          expect(left.reversed, `${c.label}: the left edge`).toBe(false)
          // it comes where it comes without motion
          const twin = calm.cases.find((x) => x.label.split('/').slice(1).join('/') === c.label.split('/').slice(1).join('/'))
          expect(sameRect(c.final, twin?.final, 0.5), `${c.label}: the settled rectangle ${c.final} / ${twin?.final}`).toBe(true)
          // the circles in turn, left to right, all of them and the name by 350 ms
          if (c.open.some((f) => f.dots.length > 0)) {
            const full = (i: number): number => c.open.find((f) => f.dots[i] !== undefined && f.dots[i]! >= 0.99)?.t ?? Infinity
            const n = Math.max(...c.open.map((f) => f.dots.length))
            const times = Array.from({ length: n }, (_, i) => full(i))
            for (let i = 1; i < n; i++) expect(times[i]!, `${c.label}: circle ${i} not before ${i - 1}`).toBeGreaterThanOrEqual(times[i - 1]!)
            expect(times[n - 1]! - times[0]!, `${c.label}: the span of the circles`).toBeGreaterThanOrEqual(60)
            expect(times[n - 1]!, `${c.label}: all circles by 350 ms`).toBeLessThanOrEqual(350)
            const name = c.open.find((f) => f.name !== null && f.name >= 0.99)
            if (!narrow) expect(name?.t ?? Infinity, `${c.label}: the name`).toBeLessThanOrEqual(350 + 17)
          }
          // the ways to close it: the width goes down and is gone in 200 ms; the buttons are back; nothing is applied
          for (const [how, cl] of Object.entries(c.closers)) {
            const k = motion(cl.frames, (f) => f.box?.[2], -1)
            expect(k.reversed, `${c.label} ${how}: the width goes down`).toBe(false)
            if (k.first - k.last > 2) {
              expect(k.between, `${c.label} ${how}: frames between`).toBeGreaterThanOrEqual(2)
              // (200 ms and a frame: the time is counted from frame to frame)
              expect(k.took, `${c.label} ${how}: folding time`).toBeLessThanOrEqual(200 + 17)
            }
            if (kind === 'cell') expect(motion(cl.frames, (f) => f.box?.[3], -1).reversed, `${c.label} ${how}: the height goes down`).toBe(false)
            expect(cl.htmlSame ?? true, `${c.label} ${how}`).toBe(true)
            if (kind !== 'cell' && how !== 'pick' && how !== 'enter' && how !== 'outside') expect(cl.focus, `${c.label} ${how}: focus`).toBe(kind)
            if (kind !== 'cell' && how !== 'outside') expect(cl.frames[cl.frames.length - 1]!.bar, `${c.label} ${how}: the buttons`).toBe(true)
            // a click outside the text and the panel: the panel is gone (as it was), within 250 ms, and nothing is applied
            if (kind !== 'cell' && how === 'outside') {
              expect(cl.frames[cl.frames.length - 1]!.box, `${c.label} ${how}: no panel`).toBeNull()
              const gone = cl.frames.find((f) => f.box === null)
              expect(gone?.t ?? Infinity, `${c.label} ${how}: the panel went`).toBeLessThanOrEqual(250)
              expect(cl.frames.some((f) => f.ghost), `${c.label} ${how}: no ghost of the panel`).toBe(false)
            }
            // «Заливка ячейки»: on «‹ Таблица» and Esc the circles stay over the row, inert, and fade out in 90 ms (a hold of the folding row, as on the panel)
            if (kind === 'cell' && (how === 'back' || how === 'esc')) {
              const held = cl.frames.filter((f) => f.cghost)
              expect(held.length, `${c.label} ${how}: the circles are held`).toBeGreaterThanOrEqual(2)
              expect(held.every((f) => f.cghost!.inert), `${c.label} ${how}: the held circles are inert`).toBe(true)
              expect(held[0]!.cghost!.o, `${c.label} ${how}: the held circles fade`).toBeGreaterThan(held[held.length - 1]!.cghost!.o)
              expect(held[held.length - 1]!.t - held[0]!.t, `${c.label} ${how}: the circles fade in 90 ms`).toBeLessThanOrEqual(90 + 40)
              expect(cl.frames[cl.frames.length - 1]!.cghost, `${c.label} ${how}: nothing is left`).toBeNull()
            }
          }
          expect(c.foldInert, `${c.label}`).toMatchObject({ htmlBack: true })
          // nothing is left of the row
          expect(c.rowGone, `${c.label}: rows left`).toBe(0)
          if (kind !== 'cell') expect(c.layers, `${c.label}: layers left`).toBe(1)
          expect(c.styleLeft?.[0] ?? '', `${c.label}: stuck width`).toBe('')
          expect(c.styleLeft?.[2] ?? null, `${c.label}: still moving`).toBeNull()
          if (kind === 'cell') expect(c.scrollSame, `${c.label}: the text did not move`).toBe(true)
          // the circle or its ring, 3:1 to the panel
          if (c.kind9) {
            const k9 = c.kind9
            expect(k9.dots.length, `${c.label}: circles`).toBe(kind === 'fill' ? 10 : 7)
            expect(k9.accent).toBeGreaterThanOrEqual(3)
            for (const d of k9.dots) {
              if (d.none) expect(d.cr, `${c.label}: «Без заливки»`).toBeGreaterThanOrEqual(3)
              else expect(Math.max(d.cf, d.cr), `${c.label}: ${d.role}`).toBeGreaterThanOrEqual(3)
            }
            // the circles differ by colour
            const fills = k9.dots.filter((d) => !d.none).map((d) => d.fill!)
            for (let i = 0; i < fills.length; i++)
              for (let j = i + 1; j < fills.length; j++) {
                const dist = Math.hypot(fills[i]![0]! - fills[j]![0]!, fills[i]![1]! - fills[j]![1]!, fills[i]![2]! - fills[j]![2]!)
                expect(dist, `${c.label}: ${i} and ${j} differ`).toBeGreaterThan(25)
              }
          }
        }
        // «Таблица»: the capsule grows by width and height at once and folds back
        const t = r.cases.find((x) => x.label === `${theme}/table-row`)!
        const tw = motion(t.open, (f) => f.box?.[2], 1)
        const th = motion(t.open, (f) => f.box?.[3], 1)
        expect(tw.reversed).toBe(false)
        expect(th.reversed).toBe(false)
        expect(th.last - th.first).toBeGreaterThan(5)
        expect(th.between).toBeGreaterThanOrEqual(3)
        expect(th.took, JSON.stringify(th)).toBeGreaterThanOrEqual(160)
        expect(th.took, JSON.stringify(th)).toBeLessThanOrEqual(260)
        expect(tw.took, JSON.stringify(tw)).toBeLessThanOrEqual(260)
        const to = t.closers.out!.frames
        const ow = motion(to, (f) => f.box?.[2], -1)
        const oh = motion(to, (f) => f.box?.[3], -1)
        expect(ow.reversed).toBe(false)
        expect(oh.reversed).toBe(false)
        expect(oh.took, JSON.stringify(oh)).toBeLessThanOrEqual(200 + 17)
        expect(t.scroll, 'the text did not move').toBe(t.scroll0)
        const five = r.k4.find((k) => k.what === 'five-times')!
        expect(five).toMatchObject({ panel: true, rows: 0, layers: 1, bar: true, same: true })
        expect(five.style).toEqual(['', null])
        const sel = r.k4.find((k) => k.what === 'selection-moves')!
        // a frame with the row is the old panel at the old word, before the new selection is seen; never the row at the new word
        for (const f of sel.frames as { row: boolean; box: number[] }[]) if (f.row) expect(Math.abs(f.box[0]! - sel.frames[0].box[0]), 'the old row at the new selection').toBeLessThan(1)
        // the old panel with its row fades out in its place in 120 ms (a copy, inert); the new one is at the new word at once
        const ghosts = (sel.frames as Frame[]).filter((f) => f.ghost)
        expect(ghosts.length, 'the old panel fades out in place').toBeGreaterThanOrEqual(2)
        expect(ghosts.every((f) => f.ghost!.inert)).toBe(true)
        for (const f of ghosts) expect(sameRect(f.ghost!.r, sel.frames[0].box, 0.5), 'the old panel stays where it was').toBe(true)
        expect(ghosts[0]!.ghost!.o).toBeGreaterThan(ghosts[ghosts.length - 1]!.ghost!.o)
        expect(ghosts[ghosts.length - 1]!.t - ghosts[0]!.t, 'the old panel fades in 120 ms').toBeLessThanOrEqual(120 + 40)
        expect((sel.frames as Frame[])[(sel.frames as Frame[]).length - 1]!.ghost, 'no ghost is left').toBeNull()
        expect(sel.final.rows).toBe(0)
        expect(sel.final.bar).toBe(true)
        const [pl, , pw] = sel.final.box as number[]
        expect(Math.abs(pl! + pw! / 2 - sel.newCentre)).toBeLessThan(Math.abs(pl! + pw! / 2 - sel.oldCentre) + 1)
        // five times «open → the selection moves», and «Esc → the selection moves» at once
        for (const k of r.k4.filter((x) => x.what === 'moves-five' || x.what === 'esc-move')) {
          const tag = `${k.what}${k.gap !== undefined ? ` after ${k.gap} ms` : ''}`
          for (const c of k.cycles as { ready: number | null; rowAtNew: boolean; barAtOld: boolean; maxGhosts: number }[]) {
            expect(c.ready, `${tag}: the panel with the buttons is at the new selection ${JSON.stringify(k.cycles)}`).not.toBeNull()
            expect(c.ready!, `${tag}: in 250 ms`).toBeLessThanOrEqual(250)
            expect(c.rowAtNew, `${tag}: a frame with the row at the new selection`).toBe(false)
            expect(c.barAtOld, `${tag}: a frame with the buttons at the old selection`).toBe(false)
            expect(c.maxGhosts, `${tag}: copies of the old panel pile up`).toBeLessThanOrEqual(2)
          }
          expect({ ghosts: k.ghosts, rows: k.rows, layers: k.layers, style: k.style, bar: k.bar }, `${tag}: what is left`).toEqual({ ghosts: 0, rows: 0, layers: 1, style: ['', null], bar: true })
        }
        expect(r.k4.filter((x) => x.what === 'esc-move').length).toBe(4)
        expect(r.k4.find((x) => x.what === 'moves-five')!.cycles.length).toBe(5)
        // five quick clicks «paragraph ↔ table»
        const paragraphBase = r.k4.find((k) => k.what === 'paragraph-base')!.box as number[]
        const tableBase = r.k4.find((k) => k.what === 'table-base')!.box as number[]
        for (const what of ['five-to-table', 'five-to-paragraph']) {
          const q = r.k4.find((k) => k.what === what)!
          const toTable = what === 'five-to-table'
          // the end: no `data-morph`, no sizes in `style`, one row «Таблица» or none, no leftovers, the capsule is as it is at rest
          expect(q.end.style, `${what}: stuck size`).toEqual(['', '', null])
          expect(q.end.rows, `${what}: rows`).toBe(toTable ? 1 : 0)
          expect(q.end.going, `${what}: leaving rows`).toBe(0)
          expect(q.end.cr, `${what}: colour rows`).toBe(0)
          expect(sameRect(q.end.box, toTable ? tableBase : paragraphBase, 0.5), `${what}: the capsule ${q.end.box} / ${toTable ? tableBase : paragraphBase}`).toBe(true)
          expect(q.end.scroll, `${what}: the text did not move`).toBe(q.scroll0)
          // no jerks: from the frame the capsule is in, no frame changes the width or the height by more than 60 % of what they range over (a jump is the whole of it)
          const fr = (q.frames as Frame[]).filter((f) => f.box)
          for (const dim of [2, 3]) {
            const v = fr.map((f) => f.box![dim]!)
            const range = Math.max(...v) - Math.min(...v)
            for (let i = 1; i < fr.length; i++) {
              if (fr[i]!.t - fr[i - 1]!.t > 50) continue
              expect(Math.abs(v[i]! - v[i - 1]!), `${what}: a jerk of ${dim === 2 ? 'width' : 'height'} at ${Math.round(fr[i]!.t)} ms`).toBeLessThanOrEqual(range * 0.6 + 0.5)
            }
          }
        }
        const [kb, kc] = r.k8 as [Record<string, any>, Record<string, any>]
        expect(kb).toMatchObject({ onColor: 'color', inRow: true, moved: true, back: 'color' })
        expect(typeof kb.focusPanel).toBe('string')
        expect(kc).toMatchObject({ inRow: true, back: 'cell-fill' })
        expect(kc.name).toBeTruthy()
        // the fills of the document are those of main
        const LIGHT = ['rgb(255, 240, 163)', 'rgb(251, 220, 220)', 'rgb(253, 229, 204)', 'rgb(212, 243, 220)', 'rgb(205, 241, 236)', 'rgb(215, 234, 255)', 'rgb(253, 224, 238)', 'rgb(233, 226, 255)', 'rgb(232, 234, 238)']
        const DARK = ['rgb(92, 75, 16)', 'rgb(92, 34, 34)', 'rgb(92, 58, 20)', 'rgb(29, 70, 48)', 'rgb(20, 80, 75)', 'rgb(24, 61, 92)', 'rgb(85, 32, 63)', 'rgb(59, 43, 102)', 'rgb(53, 58, 69)']
        expect(r.k10.hl.map((x) => x[1])).toEqual(theme === 'dark' ? DARK : LIGHT)
      })
    }

    it(`a tab of ${width} px, reduced motion: the row is final in the first frame`, { timeout: 280_000 }, async () => {
      const r = (calm ??= await measure(width, 'dark', true))
      expect(r.errors).toEqual([])
      expect(r.reduced).toBe(true)
      for (const c of r.cases.filter((x) => x.label !== 'dark/table-row')) {
        // (the first frame after the click: the click itself is handled in a microtask, the frame 0 is the page as it was)
        const first = c.open[1]!
        const last = c.open[c.open.length - 1]!
        // the first frame has the final width and all the circles at opacity 1; nothing moves afterwards
        expect(Math.abs(first.box![2]! - last.box![2]!), `${c.label}: the first frame ${first.box} / ${last.box}`).toBeLessThan(0.01)
        expect(first.dots.length).toBeGreaterThan(0)
        expect(first.dots.every((d) => d === 1), `${c.label}: the circles`).toBe(true)
        for (const d of c.durations ?? []) {
          expect(d.transition.split(',').every((x) => x.trim() === '0s'), `${c.label}: transition ${d.transition}`).toBe(true)
          expect(d.animation.split(',').every((x) => x.trim() === '0s'), `${c.label}: animation ${d.animation}`).toBe(true)
        }
        for (const [how, cl] of Object.entries(c.closers)) {
          const w = cl.frames.map((f) => f.box?.[2])
          expect(new Set(w.slice(1)).size, `${c.label} ${how}: the width after the first frame`).toBeLessThanOrEqual(1)
        }
      }
      const t = r.cases.find((x) => x.label === 'dark/table-row')!
      expect(sameRect(t.open[0]!.box, t.open[t.open.length - 1]!.box, 0.5) || t.open.slice(0, 4).some((f) => sameRect(f.box, t.final, 0.5))).toBe(true)
    })
  }
})

describe('the fills of the document and the circles of the row', () => {
  const css = readFileSync(at('../../src/webview/style.css'), 'utf8')
  it('the tokens of the fills of the document are those of main, the circles have tokens of their own', () => {
    const block = (head: string): string => {
      const i = css.indexOf(head)
      return css.slice(i, css.indexOf('\n}', i))
    }
    const hl = (s: string): string => /--ap-hl-yellow:[^\n]*/.exec(s)![0]!
    expect(hl(block('body {'))).toBe('--ap-hl-yellow: #fff0a3; --ap-hl-red: #fbdcdc; --ap-hl-orange: #fde5cc; --ap-hl-green: #d4f3dc; --ap-hl-teal: #cdf1ec; --ap-hl-blue: #d7eaff; --ap-hl-pink: #fde0ee; --ap-hl-purple: #e9e2ff; --ap-hl-gray: #e8eaee;')
    expect(hl(block('body[data-nota-theme="dark"] {'))).toMatch(/^--ap-hl-yellow: #5c4b10; --ap-hl-red: #5c2222;/)
    expect(css).toMatch(/--ap-sw-yellow: #ffd21f; --ap-swr-yellow: #a07800;/)
    expect(css).toMatch(/\.cr \.sw-b\.dot\.fill \{[^}]*var\(--swr\)/)
  })
})
