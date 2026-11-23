// the capsule of tools is wide (open: «Текст ⌄», the headings, the lists, the blocks as icons) when it fits on one line between the side capsules,
// else narrow («+», «Текст ⌄», the lists). Measured in a real Chrome (jsdom has no layout) on the real bundle of the tab and its real style sheet:
// the view in a table of widths, the threshold, a drag through the threshold both ways,
// both themes, the height of the row of capsules, the place against «Разделы» and «Замечания». Skipped, with the reason, where Chrome is not installed.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { CHROME_QUEUE_MS, holdChromeSlot } from './chrome.js'
import { chromeDump } from './chrome-dump.js'
import { tabBundle } from './bundle.js'

const CHROME = [process.env.CHROME_BIN ?? '', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => p && existsSync(p))
if (CHROME) beforeAll(() => holdChromeSlot(), CHROME_QUEUE_MS + 10_000)
const at = (path: string): string => join(import.meta.dirname, path)

if (!CHROME) console.warn('Chrome is not installed (set CHROME_BIN): the test of the wide capsule in a real browser is skipped')

const TEXT = '= Заголовок\n\n== Первый раздел\n\nАбзац один.\n\n== Второй раздел\n\nАбзац два.\n\nTIP: Совет без заголовка.\n\n|===\n|Ячейка\n|===\n'
const WIDTHS = [390, 600, 640, 650, 651, 700, 800, 900, 1000, 1200, 1280] as const

const runner = (set: 'all' | 'frequent'): string => `
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const $ = (s) => document.querySelector(s)
// (a frame is a timer: in the virtual time of headless Chrome a chain of requestAnimationFrame alone does not move the clock)
const frames = (n) => sleep(17 * n)
const app = $('#app')
const view = () => $('.isle-tools').dataset.view
const box = (e) => { const b = e.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, width: b.width, height: b.height } }
// (real time passes in fetches: headless Chrome with a virtual clock draws a frame, and runs the observers, only then)
const real = async (n) => { for (let i = 0; i < n; i++) await fetch('style.css?' + Math.random()).then((r) => r.text()) }
// what the capsule has to be at the width of now, by its own measure: the copy of the wide capsule against the room between the side capsules (a tab of 650 px and less is narrow)
const fits = () => {
  const cap = $('.isle-tools'), ghost = $('.tl-measure .tl-main'), isles = $('.ed-isles'), main = isles.parentElement
  if (main.clientWidth <= 650) return false
  const st = getComputedStyle(cap), ci = getComputedStyle(isles)
  const frame = ['paddingLeft', 'paddingRight', 'borderLeftWidth', 'borderRightWidth'].reduce((n, k) => n + (parseFloat(st[k]) || 0), 0)
  const gear = $('.isle-right .isle-settings'), gearSpace = gear ? gear.offsetWidth + (parseFloat(getComputedStyle($('.isle-right')).columnGap) || 0) : 0
  const need = Math.ceil(ghost.getBoundingClientRect().width + frame)
  const room = isles.clientWidth - (parseFloat(ci.paddingLeft) || 0) - (parseFloat(ci.paddingRight) || 0) - 2 * (parseFloat(ci.columnGap) || 0) - 2 * $('.isle-right').offsetWidth + gearSpace
  return need <= Math.floor(room)
}
const want = () => (fits() ? 'wide' : 'narrow')
// a width comes, and the capsule is given the time to show the view of it; a view that does not come is a failure of the test
const at = async (width) => {
  app.style.width = width + 'px'
  await frames(3)
  for (let i = 0; i < 60 && view() !== want(); i++) { await real(2); await frames(1) }
  if (view() !== want()) out.late.push(width + ': ' + view() + ', wants ' + want())
  await frames(2)
}
const shape = (width) => {
  const cap = box($('.isle-tools'))
  const icons = [...document.querySelectorAll('.isle-tools > .tl-main button[data-block]')]
  const row = [...document.querySelectorAll('.isle-tools > .tl-main button')].filter((b) => b.getClientRects().length > 0) // (a button the style sheet hides in a tab of 450 px and less, has no box)
  const left = $('.isle-left').getBoundingClientRect(), right = $('.isle-right').getBoundingClientRect()
  const main = box($('.isle-tools > .tl-main'))
  return {
    width, view: view(), cap, icons: icons.map((b) => b.dataset.block), plus: Boolean($('.isle-tools [data-cmd="insert"]')),
    oneLine: row.every((b) => Math.abs(b.getBoundingClientRect().top - row[0].getBoundingClientRect().top) < 2),
    inside: row.every((b) => b.getBoundingClientRect().left >= cap.left - 0.5 && b.getBoundingClientRect().right <= cap.right + 0.5),
    overLeft: left.width > 0 && cap.left < left.right - 0.5, overRight: right.width > 0 && cap.right > right.left + 0.5,
    mainHeight: main.height, isles: box($('.ed-isles')).height, mainH: $('.ed-isles').style.getPropertyValue('--tools-main-h'),
    scrollsX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  }
}
const out = { themes: {}, error: null, late: [] }
const run = async () => {
  window.postMessage({ type: 'init', text: ${JSON.stringify(TEXT)}, version: 1, fileName: 'a.adoc', locale: 'ru', fileDir: '/tmp', mode: 'visual', blocksInCapsule: ${JSON.stringify(set)} }, '*')
  for (let i = 0; i < 50 && !$('.ProseMirror'); i++) await sleep(100)
  await sleep(500)
  for (const theme of ['dark', 'light']) {
    document.body.className = 'vscode-' + theme
    document.body.dataset.notaTheme = theme
    await sleep(200)
    await at(1000); await at(1400)
    const r = { table: [], threshold: 0, drag: { up: [], down: [] }, hold: [] }
    for (const w of ${JSON.stringify(WIDTHS)}) { await at(w); r.table.push(shape(w)) }
    // the threshold: by 20 px over the whole range, then by 1 px under the first wide width; every width up to it is narrow and every width above it wide
    const seen = []
    for (let w = 640; w <= 1400; w += 20) { await at(w); seen.push([w, view()]) }
    const coarse = seen.find(([, v]) => v === 'wide')
    r.threshold = 0
    if (coarse) for (let w = coarse[0] - 20; w <= coarse[0]; w += 1) { await at(w); if (view() === 'wide') { r.threshold = w; break } }
    r.monotonic = seen.every(([w, v]) => (w < r.threshold ? v === 'narrow' : v === 'wide'))
    // a smooth drag through the threshold changes the view once each way
    let changes = 0, was = null
    for (let w = 1400; w >= 640; w -= 20) { await at(w); if (was !== null && view() !== was) changes++; was = view() }
    r.drag.down = changes
    changes = 0; was = null
    for (let w = 640; w <= 1400; w += 20) { await at(w); if (was !== null && view() !== was) changes++; was = view() }
    r.drag.up = changes
    // ±2 px around the threshold, 30 frames without a change of the width: the view does not move; the height of the row of capsules is the same on both sides
    for (const w of [r.threshold - 2, r.threshold - 1, r.threshold, r.threshold + 1, r.threshold + 2]) {
      await at(w)
      const v = view(), h = box($('.ed-isles')).height
      const kinds = new Set([v])
      for (let i = 0; i < 30; i++) { await frames(1); await real(1); kinds.add(view()) }
      r.hold.push({ width: w, view: v, stable: kinds.size === 1, height: h })
    }
    // the drag by 1 px through the threshold: once each way
    r.fine = { up: 0, down: 0 }
    was = null
    for (let w = r.threshold - 12; w <= r.threshold + 12; w++) { await at(w); if (was !== null && view() !== was) r.fine.up++; was = view() }
    was = null
    for (let w = r.threshold + 12; w >= r.threshold - 12; w--) { await at(w); if (was !== null && view() !== was) r.fine.down++; was = view() }
    // the cursor in a table cell at 1280 px: the row «Таблица» stands whole inside the capsule, under the icons, and does not overlap them
    await at(1280)
    const cell = [...document.querySelectorAll('.ProseMirror td, .ProseMirror th')].find((c) => c.textContent.includes('Ячейка'))
    $('.ProseMirror').focus()
    const sel = getSelection(), rng = document.createRange()
    rng.selectNodeContents(cell.querySelector('p, div') || cell); rng.collapse(false)
    sel.removeAllRanges(); sel.addRange(rng)
    document.dispatchEvent(new Event('selectionchange'))
    for (let i = 0; i < 40 && !$('.isle-tools .tl-row'); i++) { await real(1); await frames(2) }
    await frames(10)
    const rowEl = $('.isle-tools .tl-row'), capB = box($('.isle-tools')), mainB = box($('.isle-tools > .tl-main'))
    r.cell = rowEl ? { row: box(rowEl), cap: capB, main: mainB, view: view(), icons: document.querySelectorAll('.isle-tools > .tl-main button[data-block]').length } : null
    // the cursor leaves the table: the next theme is measured as before
    const first = $('.ProseMirror p, .ProseMirror h1')
    const back = document.createRange()
    back.selectNodeContents(first); back.collapse(false)
    sel.removeAllRanges(); sel.addRange(back)
    document.dispatchEvent(new Event('selectionchange'))
    await frames(10)
    out.themes[theme] = r
  }
  document.title = 'RES ' + JSON.stringify(out)
}
run().catch((e) => { out.error = String(e && e.stack || e); document.title = 'RES ' + JSON.stringify(out) })
`

type Shape = {
  width: number
  view: string
  cap: { left: number; right: number; width: number; height: number }
  icons: string[]
  plus: boolean
  oneLine: boolean
  inside: boolean
  overLeft: boolean
  overRight: boolean
  mainHeight: number
  isles: number
  mainH: string
  scrollsX: boolean
}
interface Result {
  error: string | null
  late: string[]
  themes: Record<string, { cell: { row: { left: number; right: number; top: number; bottom: number }; cap: { left: number; right: number; top: number; bottom: number }; main: { bottom: number }; view: string; icons: number } | null; table: Shape[]; threshold: number; monotonic: boolean; drag: { up: number; down: number }; fine: { up: number; down: number }; hold: { width: number; view: string; stable: boolean; height: number }[] }>
}


async function page(script: string): Promise<unknown> {
  const css = readFileSync(at('../../../react/src/style.css'), 'utf8') + '\n' + readFileSync(at('../../src/webview/style.css'), 'utf8')
  const dir = mkdtempSync(join(tmpdir(), 'nota-capwide-'))
  try {
    writeFileSync(join(dir, 'webview.js'), await tabBundle())
    writeFileSync(join(dir, 'style.css'), css)
    writeFileSync(
      join(dir, 'p.html'),
      `<!doctype html><html lang="ru"><head><meta charset="utf-8"><link rel="stylesheet" href="style.css"><style>html,body{margin:0}#app{width:1400px;height:100vh}</style><style>*,*::before,*::after{animation:none!important;transition:none!important}</style></head><body><div id="app"></div>
<script>window.acquireVsCodeApi=()=>({postMessage(){},getState:()=>null,setState(){}})</script>
<script src="webview.js"></script><script>${script}</script></body></html>`,
    )
    const html = await chromeDump(CHROME!, ['--headless=new', '--disable-gpu', '--allow-file-access-from-files', `--user-data-dir=${join(dir, 'profile')}`, '--window-size=1400,800', '--virtual-time-budget=600000', '--dump-dom', `file://${join(dir, 'p.html')}`], 580_000)
    const m = /<title>RES ([^<]*)<\/title>/.exec(html)
    if (!m) throw new Error('the page did not report: ' + (/<title>[^<]*<\/title>/.exec(html)?.[0] ?? html.slice(0, 200)))
    return JSON.parse(m[1]!.replaceAll('&quot;', '"').replaceAll('&amp;', '&').replaceAll('&gt;', '>').replaceAll('&lt;', '<')) 
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

async function measure(set: 'all' | 'frequent'): Promise<Result> {
  return (await page(runner(set))) as Result
}

// the mode «Текст»: the note «Режим «Текст»» makes the capsule longer; a drag of 1 px through 640…1000 px must change the view once each way
const textRunner = (set: 'all' | 'frequent'): string => `
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const $ = (s) => document.querySelector(s)
const real = async (n) => { for (let i = 0; i < n; i++) await fetch('style.css?' + Math.random()).then((r) => r.text()) }
const out = { themes: {}, error: null }
const snap = () => {
  const t = $('.isle-tools'), l = $('.isle-left').getBoundingClientRect(), r = $('.isle-right').getBoundingClientRect(), c = t.getBoundingClientRect()
  const btns = [...document.querySelectorAll('.isle-tools > .tl-main button')].filter((b) => b.getClientRects().length)
  return { view: t.dataset.view, note: Boolean($('.isle-tools .tb-note')), bad: (l.width > 0 && c.left < l.right - 0.5) || (r.width > 0 && c.right > r.left + 0.5) || !btns.every((b) => Math.abs(b.getBoundingClientRect().top - btns[0].getBoundingClientRect().top) < 2) || c.height > 40 }
}
const settle = async (w) => {
  $('#app').style.width = w + 'px'; await sleep(60)
  let last = null, n = 0
  for (let i = 0; i < 80 && n < 6; i++) { await real(2); await sleep(30); const k = JSON.stringify(snap()); if (k === last) n++; else { n = 0; last = k } }
  return snap()
}
const run = async () => {
  window.postMessage({ type: 'init', text: ${JSON.stringify(TEXT)}, version: 1, fileName: 'a.adoc', locale: 'ru', fileDir: '/tmp', mode: 'text', blocksInCapsule: ${JSON.stringify(set)} }, '*')
  for (let i = 0; i < 50 && !$('.ProseMirror, .cm-editor'); i++) await sleep(100)
  await sleep(500)
  for (const theme of ['dark', 'light']) {
    document.body.className = 'vscode-' + theme; document.body.dataset.notaTheme = theme; await sleep(200)
    $('#app').style.width = '1400px'; await sleep(300); await real(3)
    const up = [], down = []
    for (let i = 0; i < 40 && (await settle(640)).view !== 'narrow'; i++) await sleep(100) // (the jump from 1400 px is no part of the drag: the view follows it a little later)
    for (let w = 640; w <= 1000; w++) up.push([w, await settle(w)])
    for (let w = 1000; w >= 640; w--) down.push([w, await settle(w)])
    out.themes[theme] = { up, down }
  }
  document.title = 'RES ' + JSON.stringify(out)
}
run().catch((e) => { out.error = String(e && e.stack || e); document.title = 'RES ' + JSON.stringify(out) })
`

describe.skipIf(!CHROME)('the mode «Текст» (real Chrome)', () => {
  it.each(['all', 'frequent'] as const)('a drag of 1 px through 640…1000 px changes the view once each way, both themes, nota.blocksInCapsule = %s', { timeout: 900_000 }, async (set) => {
    const r = (await page(textRunner(set))) as { error: string | null; themes: Record<string, { up: [number, { view: string; note: boolean; bad: boolean }][]; down: [number, { view: string; note: boolean; bad: boolean }][] }> }
    expect(r.error).toBeNull()
    const changes = (log: [number, { view: string }][]): number[] => log.filter(([, s], i) => i > 0 && s.view !== log[i - 1]![1].view).map(([w]) => w)
    for (const [theme, t] of Object.entries(r.themes)) {
      expect(t.up.every(([, s]) => s.note), `${theme}: the note of the mode`).toBe(true)
      expect(t.up.filter(([, s]) => s.bad).map(([w]) => w), `${theme}: overlap, two lines or taller than 40 px (up)`).toEqual([])
      expect(t.down.filter(([, s]) => s.bad).map(([w]) => w), `${theme}: overlap, two lines or taller than 40 px (down)`).toEqual([])
      // «all»: the note keeps the capsule narrow over the whole range (no change), `frequent`: one change each way
      const want = set === 'all' ? 0 : 1
      expect(changes(t.up), `${theme}: changes up`).toHaveLength(want)
      expect(changes(t.down), `${theme}: changes down`).toHaveLength(want)
      if (set === 'frequent') {
        expect(t.up[0]![1].view).toBe('narrow')
        expect(t.up.at(-1)![1].view).toBe('wide')
      }
    }
  })
})

describe.skipIf(!CHROME)('the capsule is open where it fits and «+» where it does not (real Chrome)', () => {
  it.each(['all', 'frequent'] as const)('the table of widths, the threshold and the drag through it, both themes, nota.blocksInCapsule = %s', { timeout: 590_000 }, async (set) => {
    const r = await measure(set)
    const ICONS = set === 'all' ? ['heading2', 'heading3', 'heading4', 'heading5', 'heading6', 'table', 'code', 'mermaid', 'admonition', 'collapsible', 'image'] : ['table', 'code', 'admonition', 'image']
    if (process.env.NOTA_DEBUG) console.warn(JSON.stringify(r.themes.dark, (k, v) => (k === 'cap' ? undefined : v)))
    expect(r.error).toBeNull()
    expect(r.late, 'a view that did not follow the measure').toEqual([])
    const thresholds = new Set<number>()
    for (const [theme, t] of Object.entries(r.themes)) {
      thresholds.add(t.threshold)
      // the threshold exists, is above 650 px, and everything below it is «+», everything above is open
      expect(t.threshold, `${theme}: threshold`).toBeGreaterThan(650)
      expect(t.monotonic, `${theme}: one threshold`).toBe(true)
      for (const s of t.table) {
        const label = `${theme} ${s.width}px`
        expect(s.view, label).toBe(s.width >= t.threshold ? 'wide' : 'narrow')
        expect(s.oneLine, `${label}: one line`).toBe(true)
        expect(s.inside, `${label}: buttons inside the capsule`).toBe(true)
        expect(s.overLeft, `${label}: over the left capsule`).toBe(false)
        expect(s.overRight, `${label}: over the right capsule`).toBe(false)
        expect(s.scrollsX, `${label}: the page scrolls`).toBe(false)
        expect(s.cap.height, `${label}: height`).toBeLessThanOrEqual(40)
        expect(s.mainHeight, `${label}: the main row`).toBeLessThanOrEqual(40)
        if (s.view === 'wide') {
          // 11 icons in the order of «/», without «+» (the lists are the three buttons of the capsule); with `frequent` four icons and «+»
          expect(s.icons, label).toEqual(ICONS)
          expect(s.plus, label).toBe(set === 'frequent')
        } else {
          // «+», «Текст ⌄» and the lists, no icons
          expect(s.icons, label).toEqual([])
          expect(s.plus, label).toBe(true)
        }
      }
      // a tab of 650 px and less is always narrow
      for (const s of t.table.filter((x) => x.width <= 650)) expect(s.view, `${theme} ${s.width}px`).toBe('narrow')
      // the row of capsules is as high in both views and the text does not move
      expect(new Set(t.table.map((s) => s.isles)).size, `${theme}: the height of the row of capsules`).toBe(1)
      // the drag changes the view once at each crossing
      expect(t.drag, `${theme}: drag`).toEqual({ up: 1, down: 1 })
      expect(t.fine, `${theme}: drag by 1 px`).toEqual({ up: 1, down: 1 })
      for (const h of t.hold) {
        expect(h.stable, `${theme}: ${h.width}px held 30 frames`).toBe(true)
        expect(h.view, `${theme}: ${h.width}px`).toBe(h.width >= t.threshold ? 'wide' : 'narrow')
      }
      expect(new Set(t.hold.map((h) => h.height)).size).toBe(1)
      // with the cursor in a cell the row «Таблица» is whole inside the capsule, below the icons
      expect(t.cell, `${theme}: the row of the table`).not.toBeNull()
      expect(t.cell!.view, `${theme}: view in a cell`).toBe('wide')
      expect(t.cell!.icons, `${theme}: icons in a cell`).toBe(ICONS.length)
      expect(t.cell!.row.top, `${theme}: row below icons`).toBeGreaterThanOrEqual(t.cell!.main.bottom - 0.5)
      expect(t.cell!.row.left, `${theme}`).toBeGreaterThanOrEqual(t.cell!.cap.left - 0.5)
      expect(t.cell!.row.right, `${theme}`).toBeLessThanOrEqual(t.cell!.cap.right + 0.5)
      expect(t.cell!.row.bottom, `${theme}`).toBeLessThanOrEqual(t.cell!.cap.bottom + 0.5)
    }
    // the same threshold in both themes (it is a width, not a colour)
    expect(thresholds.size).toBe(1)
    if (set === 'all') {
      // The full row is visible at 1000px. Its exact switch point depends on the system font.
      expect([...thresholds][0]!, 'the full row fits at 1000 px').toBeLessThanOrEqual(1000)
    } else {
      // (the short word of the remarks is kept while the set is `frequent`, so the room is one at every width: ≈ 651 px)
      expect([...thresholds][0]!, 'threshold of the frequent set').toBeGreaterThan(650)
      expect([...thresholds][0]!, 'threshold of the frequent set').toBeLessThan(700)
    }
    console.warn(`the threshold of the wide capsule (${set}): ${[...thresholds][0]} px (Russian, no remarks: the capsule of remarks is hidden)`)
  })
})
