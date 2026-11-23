// the rows of colour circles do not tremble. Measured in a real Chrome (jsdom has no layout) on the real bundle of the tab and its real
// style sheet, as `overlap-layout.test.ts` does: the rows «Цвет текста» and «Заливка» of the panel over a selection and «Заливка ячейки» of the capsule,
// tabs of 390, 520, 700 and 1280 px, the word at the left and at the right edge of its line. The row is open with nothing under the mouse, then the mouse goes
// over every circle in turn, then the arrows go from the first circle to the last and back: the centre of every circle and the rectangle of the panel (or of the
// capsule: `left`, `top`, `width`) must be where they were, to the pixel. The same run hovers every button of the panel and of the row «Таблица» (the popup of
// a button) and the badge «i» (its card after 0.4 s) and reports whether they move. The mouse is made of `mouseover`/`mouseout` events: they move the
// names and the popups, as the real mouse does, but not the CSS `:hover` (the grow of the circle under the mouse is `transform`, which does not move a centre).
// Skipped, with the reason, where Chrome is not installed.
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

if (!CHROME) console.warn('Chrome is not installed (set CHROME_BIN): the test of the rows of colours in a real browser is skipped')

const META = readFileSync(at('../../../../quality/fixtures/editor/page-meta.adoc'), 'utf8')
/** The comment block with the fields of the page (it makes the badge «i»), up to its closing `////`. */
const HEAD = META.slice(0, META.indexOf('\n////', 4) + 5)
const TEXT =
  `${HEAD}\n\n= Заголовок\n\n` +
  'Привязаны к проекту: файл прикреплён по образцу из каталога и ещё несколько слов подряд для длинной строки, чтобы слово встало у края.\n\n' +
  '[cols="1,1"]\n|===\n|[.cell-blue]##{empty}##Левая ячейка со словами\n|[.cell-green]##{empty}##Правая ячейка со словами\n\n' +
  '2+|[.cell-yellow]##{empty}##Объединённая ячейка с несколькими словами\n|===\n\n' +
  Array.from({ length: 6 }, (_, i) => `Хвостовой абзац ${i}.\n\n`).join('')

const HEIGHT = 600
/** Which row, which block, which end of its first line, which one of them. */
const CASES: [string, string, string, 'left' | 'right', number][] = [
  ['color', 'paragraph-left', '.ProseMirror > p', 'left', 0],
  ['color', 'paragraph-right', '.ProseMirror > p', 'right', 0],
  ['fill', 'paragraph-left', '.ProseMirror > p', 'left', 0],
  ['fill', 'paragraph-right', '.ProseMirror > p', 'right', 0],
  ['cell', 'cell-left', 'td .cell-text', 'left', 0],
  ['cell', 'cell-right', 'td .cell-text', 'right', 1],
  ['cell', 'merged-left', 'td .cell-text', 'left', 2],
  ['cell', 'merged-right', 'td .cell-text', 'right', 2],
]

const runner = (): string => `
const CASES = ${JSON.stringify(CASES)}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const vis = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && !e.closest('[hidden]') }
const word = (sel, which, nth) => {
  const p = document.querySelectorAll(sel)[nth]
  if (!p) throw new Error('no ' + sel + ' #' + nth + ' of ' + document.querySelectorAll(sel).length + '; cells: ' + [...document.querySelectorAll('td')].map((c) => c.className).join('|'))
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
const mouse = (el, type) => el.dispatchEvent(new MouseEvent(type, { bubbles: type !== 'mouseenter' && type !== 'mouseleave', cancelable: true, view: window }))
const keydown = (k) => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }))
const box = (kind) => document.querySelector(kind === 'cell' ? '.isle-mid .isle-tools' : '.fl.bubble')
const snap = (kind) => {
  const b = box(kind).getBoundingClientRect()
  const dots = [...document.querySelectorAll('.cr .sw-b')].map((d) => { const r = d.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2] })
  const name = document.querySelector('.cr-name')
  const nr = name && vis(name) ? name.getBoundingClientRect().width : -1
  return { box: [b.left, b.top, b.width], dots, name: nr, text: name ? name.textContent : '', row: document.querySelector('.cr').textContent }
}
const diff = (a, b) => {
  const out = []
  if (a.box.some((v, i) => v !== b.box[i])) out.push('box ' + a.box.join() + ' -> ' + b.box.join())
  if (a.dots.length !== b.dots.length) out.push('dots ' + a.dots.length + ' -> ' + b.dots.length)
  else a.dots.forEach((d, i) => { if (d[0] !== b.dots[i][0] || d[1] !== b.dots[i][1]) out.push('dot ' + i + ' ' + d.join() + ' -> ' + b.dots[i].join()) })
  return out
}
const selectWord = async (w) => {
  const ed = document.querySelector('.ProseMirror')
  ed.focus()
  const r = document.createRange(); r.setStart(w.n, w.from); r.setEnd(w.n, w.to)
  const s = getSelection(); s.removeAllRanges(); s.addRange(r)
  await sleep(700)
  await settle()
}
// everything that moves by itself (the entry of the row, the fade of a popup) is over: no animation or transition is running
// (the clock of the page is virtual and a frame is drawn in real time: a request to a file makes some real time pass, so the observers of size get their frame)
const real = async (n) => { for (let i = 0; i < n; i++) await fetch('style.css?' + Math.random()).then((r) => r.text()) }
const settle = async () => {
  await sleep(100)
  await real(40)
  for (let i = 0; i < 100 && document.getAnimations().some((a) => a.playState === 'running'); i++) await sleep(100)
  await sleep(100)
}
const press = async (el) => { mouse(el, 'mousedown'); mouse(el, 'click'); await sleep(400); await settle() }
const out = { width: innerWidth, rows: [], widths: {}, bad: [], k8: [], mixed: null, fit: [] }
const run = async () => {
  document.body.className = 'vscode-dark'
  window.postMessage({ type: 'init', text: ${JSON.stringify(TEXT)}, version: 1, fileName: 'a.adoc', locale: 'ru', outlineView: 'capsule', fileDir: '/tmp', mode: 'visual' }, '*')
  for (let i = 0; i < 50 && !document.querySelector('.ProseMirror'); i++) await sleep(100)
  await sleep(400)
  // the popup of every button of the panel and of the row «Таблица», and the card «i»
  const shift = async (place, buttons, extra) => {
    const rect = () => buttons().map((b) => { const r = b.getBoundingClientRect(); return [r.left, r.top, r.width, r.height].join() }).concat(extra ? [extra()] : [])
    const base = rect()
    let moved = 0, tips = 0
    for (const b of buttons()) {
      mouse(b, 'mouseover'); await sleep(450)
      if (document.querySelector('.nota-tip')) tips++
      const now = rect()
      moved += now.filter((v, i) => v !== base[i]).length
      mouse(b, 'mouseout'); await sleep(120)
    }
    out.k8.push({ place, buttons: buttons().length, tips, moved })
  }
  {
    const w = word('.ProseMirror > p', 'left', 0)
    await selectWord(w)
    await shift('panel', () => [...document.querySelectorAll('.fl.bubble button')].filter(vis), () => { const e = box('color'); if (!e) return 'no panel'; const r = e.getBoundingClientRect(); return [r.left, r.top, r.width, r.height].join() })
    getSelection().removeAllRanges()
    await sleep(300)
  }
  for (const [kind, name, sel, which, nth] of CASES) {
    const w = word(sel, which, nth)
    await selectWord(w)
    const opener = kind === 'cell' ? document.querySelector('.isle-tools [data-cmd="cell-fill"]') : document.querySelector('.fl.bubble [data-cmd="' + kind + '"]')
    await press(opener)
    const row = document.querySelector('.cr')
    if (!row) { out.bad.push(kind + '/' + name + ': the row did not open'); continue }
    const label = kind + '/' + name
    const widths = out.widths[kind] || (out.widths[kind] = [])
    // the row has come in (the panel is placed again by its new width) before it is measured: nothing has changed for a second
    let base = snap(kind)
    for (let i = 0, still = 0; i < 80 && still < 10; i++) {
      await sleep(100)
      await real(5)
      const now = snap(kind)
      still = diff(base, now).length === 0 ? still + 1 : 0
      base = now
    }
    out.rows.push({ label, dots: base.dots.length, box: base.box })
    const bb = box(kind).getBoundingClientRect()
    out.fit.push({ label, left: bb.left, right: bb.right })
    if (base.name >= 0) widths.push(base.name)
    const check = (step) => {
      const s = snap(kind)
      if (s.name >= 0) widths.push(s.name)
      for (const d of diff(base, s)) out.bad.push(label + ' ' + step + ': ' + d)
      if (/\\[\\.|#|hl-|В тексте|разная заливка/.test(s.row) || document.querySelector('.cr-src, .fp-code')) out.bad.push(label + ' ' + step + ': a record in the row: ' + s.row)
    }
    const dots = [...document.querySelectorAll('.cr .sw-b')]
    for (let i = 0; i < dots.length; i++) {
      mouse(dots[i], 'mouseover'); await sleep(60); check('hover ' + i)
      mouse(dots[i], 'mouseout'); await sleep(60); check('leave ' + i)
    }
    keydown('Home'); await sleep(60); check('Home')
    for (let i = 1; i < dots.length; i++) { keydown('ArrowRight'); await sleep(40); check('→ ' + i) }
    keydown('End'); await sleep(60); check('End')
    for (let i = 1; i < dots.length; i++) { keydown('ArrowLeft'); await sleep(40); check('← ' + i) }
    document.querySelector('.cr-back').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await sleep(300)
    getSelection().removeAllRanges()
    await sleep(300)
  }
  // «Разная»: the cells of different fills; the width of the block of the name is the same
  {
    const w = word('td .cell-text', 'left', 0)
    await selectWord(w)
    const other = document.querySelectorAll('td')[1]
    other.dispatchEvent(new MouseEvent('mousedown', { shiftKey: true, bubbles: true, cancelable: true }))
    await sleep(300)
    await press(document.querySelector('.isle-tools [data-cmd="cell-fill"]'))
    const row = document.querySelector('.cr')
    if (!row) out.bad.push('mixed: the row did not open')
    else {
      const s = snap('cell')
      const dots = [...document.querySelectorAll('.cr .sw-b')]
      mouse(dots[3], 'mouseover'); await sleep(60); const over = snap('cell'); const hoverLabel = row.querySelector('.cr-t-hov').textContent
      mouse(dots[3], 'mouseout'); await sleep(60); const left = snap('cell')
      out.mixed = { text: s.text, ringed: document.querySelectorAll('.cr .sw-b[aria-pressed="true"]').length, over: over.text, left: left.text, width: s.name, label: row.querySelector('.cr-t-def').textContent, narrowLabel: hoverLabel }
      ;(out.widths.cell || (out.widths.cell = [])).push(...[s.name, over.name, left.name].filter((v) => v >= 0))
      document.querySelector('.cr-back').dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await sleep(300)
    }
    getSelection().removeAllRanges()
    await sleep(300)
  }
  // the width of the longest name in this font
  const probe = document.createElement('span')
  probe.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;font:12.5px/1.2 var(--nota-font-ui);font-weight:600'
  probe.textContent = 'Без заливки ячейки'
  document.querySelector('.isle-tools').append(probe)
  out.longest = probe.getBoundingClientRect().width
  probe.remove()
  {
    await selectWord(word('td .cell-text', 'left', 0))
    await shift('row «Таблица»', () => [...document.querySelectorAll('.isle-tools .tl-row button')].filter(vis), () => { const e = box('cell'); if (!e) return 'no capsule'; const r = e.getBoundingClientRect(); return [r.left, r.top, r.width, r.height].join() })
    getSelection().removeAllRanges()
    await sleep(300)
  }
  {
    const badge = document.querySelector('.pagemeta-badge')
    if (!badge || !vis(badge)) out.k8.push({ place: 'badge «i»', missing: true })
    else {
      const rect = () => { const r = badge.getBoundingClientRect(); return [r.left, r.top, r.width, r.height].join() }
      const base = rect()
      mouse(badge, 'mouseenter'); await sleep(450)
      const card = document.querySelector('.pagemeta-card')
      out.k8.push({ place: 'badge «i»', card: Boolean(card && vis(card)), moved: rect() === base ? 0 : 1 })
      mouse(badge, 'mouseleave'); await sleep(300)
    }
  }
  document.title = 'RES ' + JSON.stringify(out)
}
run().catch((e) => { document.title = 'RES ' + JSON.stringify({ error: String(e && e.stack || e) }) })
`

interface Result {
  width: number
  error?: string
  rows: { label: string; dots: number; box: number[] }[]
  widths: Record<string, number[]>
  bad: string[]
  fit: { label: string; left: number; right: number }[]
  k8: { place: string; buttons?: number; tips?: number; moved?: number; missing?: boolean; card?: boolean }[]
  mixed: { text: string; ringed: number; over: string; left: string; width: number; label: string; narrowLabel: string } | null
  longest: number
}


async function measureTab(width: number): Promise<Result> {
  const css = readFileSync(at('../../../react/src/style.css'), 'utf8') + '\n' + readFileSync(at('../../src/webview/style.css'), 'utf8')
  const dir = mkdtempSync(join(tmpdir(), 'nota-colorrow-'))
  try {
    writeFileSync(join(dir, 'webview.js'), await tabBundle())
    writeFileSync(join(dir, 'style.css'), css)
    writeFileSync(
      join(dir, 'p.html'),
      `<!doctype html><html lang="ru"><head><meta charset="utf-8"><link rel="stylesheet" href="style.css"><style>html,body{margin:0}#app{width:${width}px;overflow:hidden}</style><style>/* a headless Chrome in virtual time runs animations by its own clock: they are off, so that only the layout is measured */ *,*::before,*::after{animation:none!important;transition:none!important}</style></head><body class="vscode-dark" data-nota-theme="dark"><div id="app" class="nota" data-mermaid=""></div>
<script>window.acquireVsCodeApi=()=>({postMessage(){},getState:()=>null,setState(){}})</script>
<script src="webview.js"></script><script>${runner()}</script></body></html>`,
    )
    const html = await chromeDump(
      CHROME!,
      ['--headless=new', '--disable-gpu', '--allow-file-access-from-files', `--window-size=${Math.max(width, 600)},${HEIGHT}`, '--virtual-time-budget=400000', '--dump-dom', `file://${join(dir, 'p.html')}`],
      230_000,
    )
    const m = /<title>RES ([^<]*)<\/title>/.exec(html)
    if (!m) throw new Error('the page did not report')
    return JSON.parse(m[1]!.replaceAll('&quot;', '"').replaceAll('&amp;', '&').replaceAll('&gt;', '>').replaceAll('&lt;', '<')) as Result
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe.skipIf(!CHROME)('the rows of colour circles do not tremble (real Chrome)', () => {
  for (const width of [390, 520, 700, 1280]) {
    it(`a tab of ${width} px`, { timeout: 240_000 }, async () => {
      const r = await measureTab(width)
      expect(r.error).toBeUndefined()
      // every row, both edges, was opened and measured; nothing moved: not a circle, not the panel or the capsule (0 px)
      expect(r.rows.map((x) => x.label)).toEqual(CASES.map(([kind, name]) => `${kind}/${name}`))
      expect(r.bad).toEqual([])
      // the panel and the capsule stay inside the tab with the row open (the block of the name is wider at 700 px)
      expect(r.fit.filter((f) => f.left < 0 || f.right > width)).toEqual([])
      // nothing else trembles either: the popups of the buttons and the card «i»
      for (const k of r.k8) expect(k, `moved ${k.place}`).toMatchObject({ moved: 0 })
      expect(r.k8.map((k) => k.place)).toEqual(['panel', 'row «Таблица»', 'badge «i»'])
      expect(r.k8[2]!.card).toBe(true)
      if (width > 650) {
        // the block of the name is of one width in every state and in the three rows, and holds the longest name
        const all = Object.values(r.widths).flat()
        expect(Object.keys(r.widths).sort()).toEqual(['cell', 'color', 'fill'])
        expect(new Set(all).size).toBe(1)
        expect(all[0]!).toBeGreaterThanOrEqual(r.longest - 0.01)
        // «Разная», no circle ringed; the name of the circle under the mouse; away from the circles «Разная» again
        expect(r.mixed).toMatchObject({ text: 'Разная', ringed: 0, over: 'Голубая', left: 'Разная' })
      } else {
        // a narrow tab: no block of the name; «Разная» is not written, the label stays the label
        expect(r.widths).toEqual({ color: [], fill: [], cell: [] })
        expect(r.mixed).toMatchObject({ ringed: 0, label: 'Заливка ячеек: 2' })
        expect(r.mixed!.narrowLabel).toBe('Голубая')
      }
    })
  }
})
