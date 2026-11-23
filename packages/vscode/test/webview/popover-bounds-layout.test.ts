// the windows at the edge of the tab (the menu of «/», the lists «Текст ⌄», «YAML ⌄», «Примечание ⌄», the window of a link, the window of
// a picture) never change the size of the area that scrolls and never make the page scroll. Measured in a real Chrome (jsdom has no layout) on the real
// bundle of the tab and its real style sheet, as `color-row-layout.test.ts` does, but with no `overflow: hidden` on `#app`: such a stand hides the bug.
// R is the root of the page, V the scroll of the document (`.ed-visual`), L the layer `.ed-main`. The invariant: (а) R does not scroll; (б) the window
// is not scrolled; (в) V keeps its sizes and does not grow; (г) the window is inside L and inside the window of the browser, 4 px from the edge.
// Tabs of 1280 and 390 px, heights of 600 and 360 px, both themes. Skipped, with the reason, where Chrome is not installed.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { CHROME_QUEUE_MS, holdChromeSlot } from './chrome.js'
import { chromeDump } from './chrome-dump.js'
import { tabBundle } from './bundle.js'

const CHROME = [process.env.CHROME_BIN ?? '', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => p && existsSync(p))
if (CHROME) beforeAll(() => holdChromeSlot(), CHROME_QUEUE_MS + 10_000)
const here = import.meta.dirname
const at = (path: string): string => join(here, path)

if (!CHROME) console.warn('Chrome is not installed (set CHROME_BIN): the test of the windows at the edge of the tab in a real browser is skipped')

const para = (n: number, from: number): string =>
  Array.from({ length: n }, (_, i) => `Абзац ${from + i}: слова одно за другим, чтобы строка была длинной и занимала место в документе вкладки.\n\n`).join('')
const TEXT =
  '= Заголовок\n\n== Первый раздел\n\n' +
  para(25, 0) +
  '[source,yaml]\n----\nkey: value\nother: 1\n----\n\n' +
  para(25, 25) +
  'NOTE: Примечание у края вкладки.\n\n' +
  para(25, 50) +
  'Последний абзац документа.\n'

const PARAS = (TEXT.match(/^Абзац|^Последний/gm) ?? []).length

const runner = (): string => `
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const $ = (s) => document.querySelector(s)
const R = document.documentElement
const real = async (n) => { for (let i = 0; i < n; i++) await fetch('style.css?' + Math.random()).then((r) => r.text()) }
const settle = async () => {
  await sleep(100)
  await real(30)
  for (let i = 0; i < 50 && document.getAnimations().some((a) => a.playState === 'running'); i++) await sleep(100)
  await sleep(100)
}
const TEXT = ${JSON.stringify(TEXT)}
let ver = 0
const init = () => window.postMessage({ type: 'init', text: TEXT, version: 1, fileName: 'a.adoc', locale: 'ru', outlineView: 'capsule', fileDir: '/tmp', mode: 'visual' }, '*')
const again = () => window.postMessage({ type: 'reset', text: TEXT, version: ++ver + 1, stale: false }, '*')
const V = () => $('.ed-visual')
const snap = () => ({ rh: R.scrollHeight, rch: R.clientHeight, rw: R.scrollWidth, rcw: R.clientWidth, sy: scrollY, sx: scrollX, vsw: V().scrollWidth, vcw: V().clientWidth, vch: V().clientHeight, vsh: V().scrollHeight, vst: V().scrollTop })
const out = { height: innerHeight, width: innerWidth, bad: [], log: [], ran: [], views: [] }
let tag = ''
const fail = (label, what) => out.bad.push(tag + ' ' + label + ': ' + what)
const inside = (el) => {
  const r = el.getBoundingClientRect(), l = $('.ed-main').getBoundingClientRect()
  const m = 4 - 0.51
  return r.left >= Math.max(l.left, 0) + m && r.top >= Math.max(l.top, 0) + m && r.right <= Math.min(l.right, innerWidth) - m && r.bottom <= Math.min(l.bottom, innerHeight) - m
}
const check = (label, base, el, step, grows) => {
  const c = snap()
  const bad = []
  if (c.rh !== c.rch || c.rw !== c.rcw) bad.push('R scrolls ' + c.rw + 'x' + c.rh + ' in ' + c.rcw + 'x' + c.rch)
  if (c.sy !== 0 || c.sx !== 0) bad.push('window scrolled ' + c.sx + ',' + c.sy)
  if (grows) { if (c.vsw !== c.vcw && base.vsw === base.vcw) bad.push('horizontal scroll of V') }
  else if (c.vsw !== base.vsw || c.vcw !== base.vcw || c.vch !== base.vch) bad.push('V sizes ' + [c.vsw, c.vcw, c.vch] + ' were ' + [base.vsw, base.vcw, base.vch] + ' L ' + $('.ed-main').getBoundingClientRect().height + ' kids ' + [...$('.ed-main').children].map((k) => k.className + ':' + Math.round(k.getBoundingClientRect().height)).join('|'))
  if (!grows && c.vsh > base.vsh) bad.push('V grew ' + base.vsh + ' -> ' + c.vsh)
  if (el) { const r = el.getBoundingClientRect(); if (!inside(el)) bad.push('window out of L: ' + [r.left, r.top, r.right, r.bottom].map(Math.round) + ' L ' + (() => { const l = $('.ed-main').getBoundingClientRect(); return [l.left, l.top, l.right, l.bottom].map(Math.round) })()) }
  out.log.push({ tag, label, step, R: [c.rcw, c.rch, c.rw, c.rh], V: [c.vcw, c.vch, c.vsw, c.vsh, c.vst], win: [c.sx, c.sy], bad: bad.length })
  for (const b of bad) fail(label + ' ' + step, b)
  return c
}
const key = (el, k, extra) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...extra }))
const mouse = (el, type) => el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }))
const press = async (el) => { mouse(el, 'mousedown'); mouse(el, 'mouseup'); mouse(el, 'click'); await sleep(300); await settle() }
const caretAt = (p, end) => {
  $('.ProseMirror').focus({ preventScroll: true })
  const r = document.createRange(); r.selectNodeContents(p); r.collapse(!end)
  const s = getSelection(); s.removeAllRanges(); s.addRange(r)
}
const paragraphs = () => [...document.querySelectorAll('.ProseMirror > p')]
const scrollTo = (el, y) => { V().scrollTop += el.getBoundingClientRect().top - y; }
// the page says «Файл изменили в другом редакторе» after the text is put back (the typed text was not written): the notice is not what is measured, it goes
const quiet = async () => { for (const n of document.querySelectorAll('.ed-main > .notice')) n.hidden = true; await sleep(200) }
const reset = async () => {
  // whatever an earlier case left open is closed: Esc where the focus is, and a press outside
  if (document.activeElement) key(document.activeElement, 'Escape')
  mouse(document.body, 'mousedown'); mouse(document.body, 'mouseup'); mouse(document.body, 'click')
  await sleep(200)
  getSelection().removeAllRanges()
  document.activeElement && document.activeElement.blur && document.activeElement.blur()
  window.scrollTo(0, 0); R.scrollTop = 0; document.body.scrollTop = 0
  // every case starts from the same document: the blocks and slashes of the earlier ones are gone
  again()
  await sleep(600)
  for (let i = 0; i < 50 && paragraphs().length !== ${PARAS}; i++) await sleep(100)
  V().style.scrollBehavior = 'auto'; V().scrollTop = 0
  await quiet()
  await sleep(200); await settle()
}
// a «/» on a new empty line after the paragraph p: where = 'last' (the end of the document, scrolled to its end) or the y of the paragraph p on the screen
const typeSlash = async (p, where) => {
  if (where === 'last') V().scrollTop = V().scrollHeight
  else scrollTo(p, where)
  await sleep(200)
  caretAt(p, true)
  await sleep(100)
  key($('.ProseMirror'), 'Enter', { keyCode: 13 })
  await sleep(150)
  document.execCommand('insertText', false, '/')
  await sleep(300); await settle()
}
const caretRect = () => { const r = getSelection().getRangeAt(0).getClientRects()[0] || getSelection().getRangeAt(0).startContainer.getBoundingClientRect(); return r }
const menu = () => $('.slashmenu')
const lastP = () => paragraphs()[paragraphs().length - 1]
const sel = (n) => paragraphs().find((p) => p.textContent.startsWith('Абзац ' + n + ':'))

const scenario = async (name, fn) => {
  await reset()
  const label = name
  try { out.ran.push(tag + ' ' + name); await fn(label) } catch (e) { fail(label, 'threw ' + (e && e.stack || e)) }
}
const run = async () => {
  init()
  for (let i = 0; i < 50 && !$('.ProseMirror'); i++) await sleep(100)
  await sleep(500)
  V().style.scrollBehavior = 'auto'
  for (const theme of ['dark', 'light']) {
    document.body.className = 'vscode-' + theme
    document.body.dataset.notaTheme = theme
    tag = theme + ' ' + innerWidth + 'x' + innerHeight
    await sleep(200)
    // (Esc): on the empty last line at the end of the document
    await scenario('last line', async (label) => {
      const p = lastP()
      V().scrollTop = V().scrollHeight
      const base = snap()
      await typeSlash(p, 'last')
      const b = { ...snap(), vsh: base.vsh + 0 }
      // the new line makes the document longer by a line: that is the document, not the window; the base is taken with the slash typed, the menu closed
      const m = menu(); if (!m) return fail(label, 'no menu')
      const typed = (() => { m.style.display = 'none'; const s = snap(); m.style.display = ''; return s })()
      const items = m.querySelectorAll('[role=option]').length
      if (items !== 14) fail(label, items + ' items')
      const c = caretRect(), r = m.getBoundingClientRect()
      const above = r.bottom <= c.top + 0.5, squeezed = m.scrollHeight > m.clientHeight
      if (!above && !squeezed) fail(label, 'the menu is under the line and not squeezed: menu ' + Math.round(r.top) + '-' + Math.round(r.bottom) + ' caret ' + Math.round(c.top))
      if (!above && r.top < c.bottom - 0.5 && r.bottom > c.top) fail(label, 'the menu covers the line')
      check(label, typed, m, 'open')
      key($('.ProseMirror'), 'Escape'); await sleep(200); await settle()
      if (menu()) fail(label, 'the menu is still open after Esc')
      if (!lastP().textContent.includes('/')) fail(label, 'the slash is gone')
      const after = check(label, typed, null, 'Esc')
      if (Math.abs(after.vst - typed.vst) > 1) fail(label, 'V.scrollTop ' + typed.vst + ' -> ' + after.vst)
    })
    await scenario('click outside', async (label) => {
      await typeSlash(lastP(), 'last')
      const typed = (() => { const m = menu(); m.style.display = 'none'; const s = snap(); m.style.display = ''; return s })()
      caretAt(paragraphs()[3], true)
      await sleep(300); await settle()
      if (menu()) fail(label, 'the menu is still open after the caret left')
      check(label, typed, null, 'outside')
    })
    // in the middle (the line under the capsules, there is room below), then Enter on «Код»
    await scenario('middle, Enter on Код', async (label) => {
      await typeSlash(sel(10), 80)
      const typed = (() => { const m = menu(); m.style.display = 'none'; const s = snap(); m.style.display = ''; return s })()
      const m = menu(); if (!m) return fail(label, 'no menu')
      const c = caretRect(), r = m.getBoundingClientRect()
      // the menu is about 690 px high (14 entries): it fits under a line near the top only in a tab of 700 px and more
      if (innerHeight >= 700) {
        if (r.top < c.bottom - 0.5) fail(label, 'the menu is not under the line: menu top ' + Math.round(r.top) + ' caret bottom ' + Math.round(c.bottom))
        // 14 entries are about 690 px: the menu may be squeezed here and scroll, but it stays under the line;
        // it is squeezed only when it does not fit: then its bottom reaches the bottom of the free place (of L), and the last entry can be reached
        if (m.scrollHeight > m.clientHeight + 1) {
          const l = $('.ed-main').getBoundingClientRect(), limit = Math.min(l.bottom, innerHeight) - 4
          if (r.bottom < limit - 12) fail(label, 'the menu is squeezed but its bottom ' + Math.round(r.bottom) + ' is short of the free place ' + Math.round(limit))
          const ed0 = $('.ProseMirror')
          for (let i = 0; i < 13; i++) { key(ed0, 'ArrowDown'); await sleep(30) }
          await sleep(100)
          const o = m.querySelector('[aria-selected=true]')
          if (!o || o.dataset.block !== 'image') fail(label, 'the arrows did not reach «Картинка»')
          else { const a = o.getBoundingClientRect(), b = m.getBoundingClientRect(); if (a.top < b.top - 1 || a.bottom > b.bottom + 1) fail(label, 'the chosen «Картинка» is out of sight') }
          for (let i = 0; i < 13; i++) { key(ed0, 'ArrowUp'); await sleep(30) }
          await sleep(100)
        }
      }
      check(label, typed, m, 'open')
      const ed = $('.ProseMirror')
      const ids = [...m.querySelectorAll('[role=option]')].map((o) => o.dataset.block)
      for (let i = 0; i < ids.indexOf('code'); i++) key(ed, 'ArrowDown')
      await sleep(100)
      key(ed, 'Enter'); await sleep(400); await settle()
      if (menu()) fail(label, 'the menu is open after Enter')
      if (!$('.ProseMirror pre, .ProseMirror .code')) fail(label, 'no code block')
      const after = check(label, typed, null, 'Enter', true)
    })
    await scenario('middle, click on Таблица', async (label) => {
      await typeSlash(sel(12), 80)
      const typed = (() => { const m = menu(); m.style.display = 'none'; const s = snap(); m.style.display = ''; return s })()
      const m = menu(); if (!m) return fail(label, 'no menu')
      check(label, typed, m, 'open')
      await press(m.querySelector('[data-block=table]'))
      if (menu()) fail(label, 'the menu is open after the click')
      const t = $('.ProseMirror table'); if (!t) return fail(label, 'no table')
      const tr = t.getBoundingClientRect(), vr = V().getBoundingClientRect()
      if (tr.bottom < vr.top || tr.top > vr.bottom) fail(label, 'the table is not in sight')
      check(label, typed, null, 'Таблица', true)
    })
    // the menu squeezed; the arrows keep the chosen entry in sight
    if (innerHeight <= 400) await scenario('low tab', async (label) => {
      await typeSlash(sel(10), 70)
      const typed = (() => { const m = menu(); m.style.display = 'none'; const s = snap(); m.style.display = ''; return s })()
      const m = menu(); if (!m) return fail(label, 'no menu')
      if (m.scrollHeight <= m.clientHeight) fail(label, 'the menu is not squeezed')
      check(label, typed, m, 'open')
      const ed = $('.ProseMirror')
      const seen = (tag2) => {
        const o = m.querySelector('[aria-selected=true]'); if (!o) return fail(label, tag2 + ': nothing chosen')
        const a = o.getBoundingClientRect(), b = m.getBoundingClientRect()
        if (a.top < b.top - 1 || a.bottom > b.bottom + 1) fail(label, tag2 + ': the chosen entry is out of sight')
        return o
      }
      for (let i = 0; i < 13; i++) { key(ed, 'ArrowDown'); await sleep(50) }
      await sleep(100)
      const o = seen('last'); if (o && o.dataset.block !== 'image') fail(label, 'the last is not «Картинка»: ' + o.dataset.block)
      key(ed, 'ArrowDown'); await sleep(50)
      key(ed, 'ArrowUp'); await sleep(100)
      const o2 = seen('wrap'); if (o2 && o2.dataset.block !== 'image') fail(label, '↑ from the first did not go to the last: ' + o2.dataset.block)
      check(label, typed, m, 'arrows')
    })
    // «Картинка» on the last line
    await scenario('picture', async (label) => {
      await typeSlash(lastP(), 'last')
      const m = menu(); if (!m) return fail(label, 'no menu')
      const typed = (() => { m.style.display = 'none'; const s = snap(); m.style.display = ''; return s })()
      await press(m.querySelector('[data-block=image]'))
      const w = $('.imagepop'); if (!w) return fail(label, 'no picture window')
      check(label, typed, w, 'open')
    })
    // the capsule on the last line. Wide: the blocks are icons in the capsule (one line, inside it, clear of the side capsules; «Картинка» opens its window inside the tab).
    // Narrow: «+» opens the list under the capsule. The scroll and the sizes are not touched.
    await scenario('«+»', async (label) => {
      V().scrollTop = V().scrollHeight
      await sleep(200)
      caretAt(lastP(), true)
      await sleep(300); await settle()
      const base = snap()
      const plus = $('.isle-tools [data-cmd="insert"]')
      const cap = $('.isle-tools').getBoundingClientRect()
      if (!plus) {
        out.views.push('wide')
        const icons = [...document.querySelectorAll('.isle-tools > .tl-main [data-block]')]
        if (icons.length !== 11) fail(label, icons.length + ' icons')
        if (cap.height > 40) fail(label, 'the capsule is not on one line: ' + Math.round(cap.height) + ' px')
        for (const b of icons) { const q = b.getBoundingClientRect(); if (q.left < cap.left - 0.5 || q.right > cap.right + 0.5) fail(label, 'an icon is out of the capsule: ' + b.dataset.block) }
        const left = $('.isle-left').getBoundingClientRect(), right = $('.isle-right').getBoundingClientRect()
        if (cap.left < left.right - 0.5 && left.width > 0 && cap.top < left.bottom) fail(label, 'the capsule goes over the left capsule: ' + Math.round(cap.left) + ' < ' + Math.round(left.right))
        if (cap.right > right.left + 0.5 && right.width > 0 && cap.top < right.bottom) fail(label, 'the capsule goes over the right capsule')
        check(label, base, null, 'wide')
        await press(document.querySelector('.isle-tools [data-block="image"]'))
        const w = $('.imagepop'); if (!w) return fail(label, 'no picture window')
        check(label, base, w, 'image')
        key(document.activeElement || $('.ProseMirror'), 'Escape'); await sleep(300); await settle()
        check(label, base, null, 'Esc')
        return
      }
      out.views.push('list')
      await press(plus)
      const list = $('.blocklist')
      if (!list) return fail(label, 'nothing opened')
      if (plus.getAttribute('aria-expanded') !== 'true') fail(label, '«+» is not expanded')
      {
        const r = list.getBoundingClientRect()
        if (r.top < cap.bottom - 0.5) fail(label, 'the list is not under the capsule: ' + Math.round(r.top) + ' < ' + Math.round(cap.bottom))
        if (list.querySelectorAll('[role=menuitem]').length !== 14) fail(label, 'not 14 items')
        const scroll = list.querySelector('.bm-scroll'), squeezed = scroll.scrollHeight > scroll.clientHeight
        check(label, base, list, 'open')
        if (squeezed) {
          for (let i = 0; i < 15; i++) { key(list, 'ArrowDown'); await sleep(40) }
          await sleep(100)
          const o = document.activeElement, a = o.getBoundingClientRect(), b = scroll.getBoundingClientRect()
          if (!list.contains(o)) fail(label, 'the focus left the list')
          else if (a.top < b.top - 1 || a.bottom > b.bottom + 1) fail(label, 'the chosen item is out of sight')
          check(label, base, list, 'arrows')
        }
      }
      key(document.activeElement || $('.ProseMirror'), 'Escape'); await sleep(300); await settle()
      if ($('.blocklist')) fail(label, 'still open after Esc')
      const after = check(label, base, null, 'Esc')
      if (Math.abs(after.vst - base.vst) > 1) fail(label, 'V.scrollTop ' + base.vst + ' -> ' + after.vst)
    })
    // the language of a code block, the type of a note, the frame at the lower edge of V
    for (const [name, selector, cmd, bar] of [['YAML', '.ProseMirror pre', 'language', '.codebar'], ['Примечание', '.ProseMirror .adm-para, .ProseMirror [data-variant]', 'admonition', '.admpick']]) {
      await scenario(name, async (label) => {
        const block = $(selector); if (!block) return fail(label, 'no block ' + selector)
        scrollTo(block, V().getBoundingClientRect().bottom - 30)
        await sleep(300)
        const inner = block.querySelector('code, .adm-text, p') || block
        caretAt(inner, false)
        await sleep(500); await settle(); await quiet()
        const base = snap()
        // (the language is a drop-down list in a floating panel; the type is a row of five on the label of the block)
        const open = $((cmd === 'admonition' ? '' : '.fl') + bar + ' [data-cmd="' + cmd + '"]')
        if (!open) return fail(label, 'no button ' + cmd)
        await press(open)
        const list = cmd === 'admonition' ? $('.admpick .adm-row') : $('.dd-list:not(.is-closed)'); if (!list) return fail(label, 'no list')
        check(label, base, list, 'open')
        key(list, 'Escape'); await sleep(300); await settle()
        check(label, base, null, 'Esc')
      })
    }
    // the window of a link over a word in the last visible line
    await scenario('link', async (label) => {
      const p = sel(30)
      scrollTo(p, V().getBoundingClientRect().bottom - 40)
      await sleep(300)
      const w = document.createTreeWalker(p, NodeFilter.SHOW_TEXT).nextNode()
      $('.ProseMirror').focus({ preventScroll: true })
      const r = document.createRange(); r.setStart(w, 0); r.setEnd(w, 5)
      getSelection().removeAllRanges(); getSelection().addRange(r)
      await sleep(700); await settle()
      const base = snap()
      const open = $('.fl.bubble [data-cmd="link"]'); if (!open) return fail(label, 'no link button')
      await press(open)
      for (const t of ['url', 'section', 'file']) {
        const pop = $('.linkpop'); if (!pop) return fail(label, 'no link window at ' + t)
        const tab = pop.querySelector('[data-tab=' + t + ']'); await press(tab)
        check(label, base, $('.linkpop'), t)
      }
      key($('.linkpop'), 'Escape'); await sleep(300); await settle()
      check(label, base, null, 'Esc')
    })
    // «Текст ⌄»
    await scenario('Текст', async (label) => {
      const p = sel(5); scrollTo(p, 200); await sleep(200)
      caretAt(p, false); await sleep(500); await settle()
      const base = snap()
      const open = $('.isle-tools [data-cmd="style"]'); if (!open) return fail(label, 'no button')
      await press(open)
      const list = $('.dd-list:not(.is-closed)'); if (!list) return fail(label, 'no list')
      if (list.scrollHeight > list.clientHeight) fail(label, 'the list is squeezed: ' + list.scrollHeight + ' > ' + list.clientHeight)
      check(label, base, list, 'open')
      await press(list.querySelector('[data-value=h2]'))
      check(label, base, null, 'Заголовок 2', true)
    })
  }
  document.title = 'RES ' + JSON.stringify(out)
}
run().catch((e) => { document.title = 'RES ' + JSON.stringify({ error: String(e && e.stack || e) }) })
`

interface Result {
  error?: string
  height: number
  width: number
  bad: string[]
  ran: string[]
  views: string[]
  log: { tag: string; label: string; step: string; R: number[]; V: number[]; win: number[]; bad: number }[]
}

/** The height of the frame of the headless window: the page gets `--window-size` less this. */
const CHROME_BAR = 87
/** The narrowest window headless Chrome opens: a tab of 390 px is `#app` of 390 px in a window of 500. */
const MIN_WIDTH = 500


async function measureTab(width: number, height: number): Promise<Result> {
  const css = readFileSync(at('../../../react/src/style.css'), 'utf8') + '\n' + readFileSync(at('../../src/webview/style.css'), 'utf8')
  const dir = mkdtempSync(join(tmpdir(), 'nota-popbounds-'))
  try {
    writeFileSync(join(dir, 'webview.js'), await tabBundle())
    writeFileSync(join(dir, 'style.css'), css)
    // no `overflow: hidden` on #app: the page is as high as the window and anything that sticks out of it scrolls the page
    writeFileSync(
      join(dir, 'p.html'),
      `<!doctype html><html lang="ru"><head><meta charset="utf-8"><link rel="stylesheet" href="style.css"><style>html,body{margin:0}#app{width:${width}px;height:100vh}</style><style>*,*::before,*::after{animation:none!important;transition:none!important}</style></head><body class="vscode-dark" data-nota-theme="dark"><div id="app" class="nota" data-mermaid=""></div>
<script>window.acquireVsCodeApi=()=>({postMessage(){},getState:()=>null,setState(){}})</script>
<script src="webview.js"></script><script>${runner()}</script></body></html>`,
    )
    // a busy machine: Chrome has dumped the page and then did not close in time (its watchdog ends it with status 2): the dump is good, `chromeDump` takes it
    const html = await chromeDump(
      CHROME!,
      ['--headless=new', '--disable-gpu', '--allow-file-access-from-files', `--window-size=${Math.max(width, MIN_WIDTH)},${height + CHROME_BAR}`, '--virtual-time-budget=600000', '--dump-dom', `file://${join(dir, 'p.html')}`],
      550_000,
    )
    const m = /<title>RES ([^<]*)<\/title>/.exec(html)
    if (!m) throw new Error('the page did not report')
    return JSON.parse(m[1]!.replaceAll('&quot;', '"').replaceAll('&amp;', '&').replaceAll('&gt;', '>').replaceAll('&lt;', '<')) as Result
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe.skipIf(!CHROME)('the windows at the edge of the tab do not change the scroll (real Chrome)', () => {
  for (const [width, height] of [
    [1280, 800],
    [390, 800],
    [1280, 600],
    [390, 600],
    [1280, 360],
    [390, 360],
    [600, 600],
    [640, 600],
    // the capsule is wide from a tab of about 966 px (Russian; 922 px before the gear), else the list of 14 under «+»
    [800, 800],
    [900, 800],
    [940, 800],
    [1000, 800],
    [1200, 800],
  ] as const) {
    it(`a tab of ${width} x ${height} px, both themes`, { timeout: 560_000 }, async () => {
      const r = await measureTab(width, height)
      expect(r.error).toBeUndefined()
      expect([r.width, r.height], 'the size of the page').toEqual([Math.max(width, MIN_WIDTH), height])
      expect(r.ran.length, r.ran.join('; ')).toBe((height <= 400 ? 11 : 10) * 2)
      // the capsule is wide (the blocks as icons, no «+») where it fits (a threshold of ≈ 966 px, `capsule-wide-layout.test.ts`), else «+» opens the list
      const view = width >= 966 ? 'wide' : 'list'
      expect(r.views, 'the view of «+»').toEqual([view, view])
      // the numbers of R and V before, during and after: in the message, if anything is wrong
      expect(r.bad, JSON.stringify(r.log.filter((l) => l.bad > 0))).toEqual([])
    })
  }
})
