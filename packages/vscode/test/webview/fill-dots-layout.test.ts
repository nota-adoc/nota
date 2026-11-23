// the circles of the rows «Заливка» (panel over a selection) and «Заливка ячейки» (capsule) are variant (а) «bright with a ring», in both
// themes. Measured in a real Chrome (jsdom has no layout and no cascade of custom properties) on the real bundle of the tab and its real style sheet, as
// `color-row-layout.test.ts` does: `getComputedStyle` of every circle and the contrast to the panel, counted as WCAG does (the `ratio` of the prototype
// in the design). The expected colours are the `--pv-*`/`--pr-*` of the prototype, written here as numbers.
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

if (!CHROME) console.warn('Chrome is not installed (set CHROME_BIN): the test of the circles of the fills in a real browser is skipped')

type Theme = 'dark' | 'light'
const NAMES = ['yellow', 'red', 'orange', 'green', 'teal', 'blue', 'pink', 'purple', 'gray'] as const
const CELL = ['yellow', 'green', 'blue', 'pink', 'purple', 'gray'] as const
/** `--pv-*` (the circle) of the prototype, in the order of NAMES. */
const PV: Record<Theme, string[]> = {
  dark: ['#ffd84a', '#ff7a72', '#ffa155', '#5ad98a', '#3fd6c8', '#6aa8ff', '#ff85c8', '#b79cff', '#a3aab6'],
  light: ['#ffd21f', '#f25a55', '#ff9a3c', '#3cc46a', '#2cc8b8', '#4f9cff', '#f472b6', '#a78bfa', '#b6bcc6'],
}
/** `--pr-*` (the ring) of the prototype: in the dark theme the ring is of the colour of the circle. */
const PR: Record<Theme, string[]> = {
  dark: PV.dark,
  light: ['#a07800', '#c42b2b', '#b45309', '#15803d', '#0f766e', '#1d4ed8', '#be1a80', '#7e22ce', '#6b7280'],
}
/** `--ap-hl-*` of `origin/main` for blue (the fill of the document), and the colours of the theme. */
const HL_BLUE: Record<Theme, string> = { dark: '#183d5c', light: '#d7eaff' }
const ACCENT: Record<Theme, string> = { dark: '#5eead4', light: '#4f46e5' }
const MUTED: Record<Theme, string> = { dark: '#9aa1ae', light: '#5b6270' }
const PANEL: Record<Theme, string> = { dark: '#353535', light: '#ffffff' }

const TEXT =
  '= Заголовок\n\nПростой абзац со словами для выделения и заливки.\n\n' +
  '[cols="1,1"]\n|===\n|Левая ячейка со словами\n|Правая ячейка со словами\n|===\n\n' +
  Array.from({ length: 4 }, (_, i) => `Хвостовой абзац ${i}.\n\n`).join('')

const runner = (theme: Theme): string => `
const THEME = ${JSON.stringify(theme)}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const mouse = (el, type) => el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }))
const cv = document.createElement('canvas'); cv.width = cv.height = 1
const cx = cv.getContext('2d', { willReadFrequently: true })
/** any CSS colour -> [r, g, b, a] */
const rgb = (c) => { cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillStyle = c; cx.fillRect(0, 0, 1, 1); const d = cx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], Math.round(d[3] / 2.55) / 100] }
const word = (sel, nth) => {
  const p = document.querySelectorAll(sel)[nth]
  if (!p) throw new Error('no ' + sel + ' #' + nth)
  const w = document.createTreeWalker(p, NodeFilter.SHOW_TEXT)
  const n = w.nextNode()
  const m = /\\S+/.exec(n.textContent)
  return { n, from: m.index, to: m.index + m[0].length }
}
const real = async (n) => { for (let i = 0; i < n; i++) await fetch('style.css?' + Math.random()).then((r) => r.text()) }
const settle = async () => { await sleep(100); await real(30); for (let i = 0; i < 50 && document.getAnimations().some((a) => a.playState === 'running'); i++) await sleep(100); await sleep(100) }
const selectWord = async (w) => {
  document.querySelector('.ProseMirror').focus()
  const r = document.createRange(); r.setStart(w.n, w.from); r.setEnd(w.n, w.to)
  const s = getSelection(); s.removeAllRanges(); s.addRange(r)
  await sleep(700); await settle()
}
const press = async (el) => { mouse(el, 'mousedown'); mouse(el, 'click'); await sleep(400); await settle() }
/** the first opaque background above the circle: the panel */
const panelOf = (el) => { for (let e = el.parentElement; e; e = e.parentElement) { const c = rgb(getComputedStyle(e).backgroundColor); if (c[3] > 0) return c } return null }
const dotsNow = () => [...document.querySelectorAll('.cr .sw-b')].map((d) => {
  const s = getComputedStyle(d)
  return { role: d.dataset.role, cls: d.className, pressed: d.getAttribute('aria-pressed'), bg: rgb(s.backgroundColor), bgImage: s.backgroundImage, shadow: s.boxShadow, border: s.borderTopColor, borderW: s.borderTopWidth, panel: panelOf(d) }
})
const out = { theme: THEME, fill: [], cell: [], text: [], fillPressed: [], cellPressed: [], doc: null, cellDoc: null, expectTx: {}, accent: null, muted: null, bad: [] }
const open = async (kind, sel, nth) => {
  await selectWord(word(sel, nth))
  const opener = kind === 'cell' ? document.querySelector('.isle-tools [data-cmd="cell-fill"]') : document.querySelector('.fl.bubble [data-cmd="' + kind + '"]')
  if (!opener) { out.bad.push('no opener ' + kind); return false }
  await press(opener)
  if (!document.querySelector('.cr')) { out.bad.push('the row ' + kind + ' did not open'); return false }
  return true
}
const choose = async (role) => { await press(document.querySelector('.cr .sw-b[data-role="' + role + '"]')); getSelection().removeAllRanges(); await sleep(300) }
const run = async () => {
  document.body.className = 'vscode-' + THEME
  document.body.setAttribute('data-nota-theme', THEME)
  window.postMessage({ type: 'init', text: ${JSON.stringify(TEXT)}, version: 1, fileName: 'a.adoc', locale: 'ru', fileDir: '/tmp', mode: 'visual' }, '*')
  for (let i = 0; i < 50 && !document.querySelector('.ProseMirror'); i++) await sleep(100)
  await sleep(400)
  const bs = getComputedStyle(document.body)
  out.accent = rgb(bs.getPropertyValue('--ap-accent').trim()); out.muted = rgb(bs.getPropertyValue('--ap-ink-muted').trim())
  for (const n of ['red', 'blue', 'green', 'gray']) { const p = document.createElement('i'); p.style.color = 'var(--ap-tx-' + n + ')'; document.body.append(p); out.expectTx['hl-' + n] = rgb(getComputedStyle(p).color); p.remove() }
  // the text colour: unchanged
  if (await open('color', '.ProseMirror > p', 0)) { out.text = dotsNow(); document.querySelector('.cr-back').dispatchEvent(new MouseEvent('click', { bubbles: true })); await sleep(300); getSelection().removeAllRanges(); await sleep(300) }
  // the fill of the panel, nothing chosen
  if (await open('fill', '.ProseMirror > p', 0)) {
    out.fill = dotsNow()
    await choose('hl-blue-bg')
    const el = document.querySelector('.ProseMirror .hl-blue-bg')
    out.doc = el ? rgb(getComputedStyle(el).backgroundColor) : null
    if (await open('fill', '.ProseMirror > p', 0)) { out.fillPressed = dotsNow(); document.querySelector('.cr-back').dispatchEvent(new MouseEvent('click', { bubbles: true })); await sleep(300); getSelection().removeAllRanges(); await sleep(300) }
  }
  // the fill of the cell
  if (await open('cell', 'td .cell-text', 0)) {
    out.cell = dotsNow()
    await choose('cell-blue')
    const td = document.querySelector('td.cell-blue')
    out.cellDoc = td ? rgb(getComputedStyle(td).backgroundColor) : null
    if (await open('cell', 'td .cell-text', 0)) { out.cellPressed = dotsNow(); document.querySelector('.cr-back').dispatchEvent(new MouseEvent('click', { bubbles: true })); await sleep(300) }
  }
  document.title = 'RES ' + JSON.stringify(out)
}
run().catch((e) => { document.title = 'RES ' + JSON.stringify({ error: String(e && e.stack || e) }) })
`

type Rgba = [number, number, number, number]
interface Dot {
  role: string
  cls: string
  pressed: string | null
  bg: Rgba
  bgImage: string
  shadow: string
  border: string
  borderW: string
  panel: Rgba | null
}
interface Result {
  error?: string
  bad: string[]
  fill: Dot[]
  cell: Dot[]
  text: Dot[]
  fillPressed: Dot[]
  cellPressed: Dot[]
  doc: Rgba | null
  cellDoc: Rgba | null
  expectTx: Record<string, Rgba>
  accent: Rgba
  muted: Rgba
}


async function measure(theme: Theme): Promise<Result> {
  const css = readFileSync(at('../../../react/src/style.css'), 'utf8') + '\n' + readFileSync(at('../../src/webview/style.css'), 'utf8')
  const dir = mkdtempSync(join(tmpdir(), 'nota-filldots-'))
  try {
    writeFileSync(join(dir, 'webview.js'), await tabBundle())
    writeFileSync(join(dir, 'style.css'), css)
    writeFileSync(
      join(dir, 'p.html'),
      `<!doctype html><html lang="ru"><head><meta charset="utf-8"><link rel="stylesheet" href="style.css"><style>html,body{margin:0}#app{width:900px;overflow:hidden}</style><style>*,*::before,*::after{animation:none!important;transition:none!important}</style></head><body class="vscode-${theme}" data-nota-theme="${theme}"><div id="app" class="nota" data-mermaid=""></div>
<script>window.acquireVsCodeApi=()=>({postMessage(){},getState:()=>null,setState(){}})</script>
<script src="webview.js"></script><script>${runner(theme)}</script></body></html>`,
    )
    const html = await chromeDump(
      CHROME!,
      ['--headless=new', '--disable-gpu', '--allow-file-access-from-files', '--window-size=900,700', '--virtual-time-budget=200000', '--dump-dom', `file://${join(dir, 'p.html')}`],
      230_000,
    )
    const m = /<title>RES ([^<]*)<\/title>/.exec(html)
    if (!m) throw new Error('the page did not report')
    return JSON.parse(m[1]!.replaceAll('&quot;', '"').replaceAll('&amp;', '&').replaceAll('&gt;', '>').replaceAll('&lt;', '<')) as Result
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const hex = (h: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number]
const lum = ([r, g, b]: number[]): number => {
  const f = (v: number): number => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
  return 0.2126 * f(r!) + 0.7152 * f(g!) + 0.0722 * f(b!)
}
/** WCAG contrast ratio, as `ratio` of the prototype. */
const ratio = (a: number[], b: number[]): number => {
  const [x, y] = [lum(a), lum(b)]
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}
const rgb3 = (c: number[]): number[] => c.slice(0, 3)
/** The shadows of `box-shadow` as computed: colour, blur, spread, inset. */
function shadows(s: string): { color: number[]; x: number; y: number; blur: number; spread: number; inset: boolean }[] {
  const out = []
  for (const m of s.matchAll(/rgba?\(([^)]*)\)\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s+(-?[\d.]+)px(\s+inset)?/g)) {
    out.push({ color: m[1]!.split(',').map(Number), x: +m[2]!, y: +m[3]!, blur: +m[4]!, spread: +m[5]!, inset: Boolean(m[6]) })
  }
  return out
}
const byRole = (dots: Dot[], role: string): Dot => {
  const d = dots.find((x) => x.role === role)
  if (!d) throw new Error(`no circle ${role}`)
  return d
}
const near = (a: number[], b: number[]): void => expect(rgb3(a)).toEqual(rgb3(b))

describe.skipIf(!CHROME)('the circles of the fills are bright with a ring (real Chrome)', () => {
  for (const theme of ['dark', 'light'] as const) {
    it(`the ${theme} theme`, { timeout: 240_000 }, async () => {
      const r = await measure(theme)
      expect(r.error).toBeUndefined()
      expect(r.bad).toEqual([])
      const panel = hex(PANEL[theme])

      // the nine circles of «Заливка»: the circle, the ring inset 1.5 px, the contrast to the panel
      expect(r.fill.map((d) => d.role)).toEqual(['', ...NAMES.map((n) => `hl-${n}-bg`)])
      NAMES.forEach((n, i) => {
        const d = byRole(r.fill, `hl-${n}-bg`)
        near(d.bg, hex(PV[theme][i]!))
        near(d.panel!, panel)
        const ring = shadows(d.shadow).filter((s) => s.inset)
        expect(ring, `${theme} ${n}: the inset ring`).toHaveLength(1)
        expect(ring[0]).toMatchObject({ x: 0, y: 0, blur: 0, spread: 1.5 })
        near(ring[0]!.color, hex(PR[theme][i]!))
        // the circle or its ring, whichever is stronger; in the dark theme they are one colour (4.1), in the light theme the yellow ring #a07800 on white is 4.05
        const c = Math.max(ratio(rgb3(d.bg), panel), ratio(rgb3(ring[0]!.color), panel))
        expect(c, `${theme} ${n}: contrast ${c.toFixed(2)}`).toBeGreaterThanOrEqual(theme === 'dark' ? 4.1 : 4.0)
        if (theme === 'dark') expect(ratio(rgb3(d.bg), panel), `${theme} ${n}`).toBeGreaterThanOrEqual(4.1)
      })

      // the six circles of «Заливка ячейки» are those of the same colours
      expect(r.cell.map((d) => d.role)).toEqual(['', ...CELL.map((n) => `cell-${n}`)])
      for (const n of CELL) {
        const d = byRole(r.cell, `cell-${n}`)
        const f = byRole(r.fill, `hl-${n}-bg`)
        near(d.bg, f.bg)
        expect(shadows(d.shadow).filter((s) => s.inset)).toEqual(shadows(f.shadow).filter((s) => s.inset))
        expect(d.cls).toContain('fill')
      }

      // the chosen circle has the outer ring of the accent (6.3:1 to the panel); «Без заливки» is empty, with a stroke and a ring of --ap-ink-muted (4.7:1)
      // #4f46e5 on white is 6.29, which the prototype writes as 6.3: the threshold is the rounded one
      expect(ratio(rgb3(r.accent), panel)).toBeGreaterThanOrEqual(6.25)
      near(r.accent, hex(ACCENT[theme]))
      for (const [label, dots, role] of [['fill', r.fillPressed, 'hl-blue-bg'], ['cell', r.cellPressed, 'cell-blue']] as const) {
        const pressed = dots.filter((d) => d.pressed === 'true')
        expect(pressed.map((d) => d.role), `${label}: one chosen circle`).toEqual([role])
        const outer = shadows(pressed[0]!.shadow).filter((s) => !s.inset)
        expect(outer.some((s) => s.spread === 3.5 && rgb3(s.color).join() === rgb3(r.accent).join()), `${label}: the ring of the accent: ${pressed[0]!.shadow}`).toBe(true)
        expect(shadows(pressed[0]!.shadow).some((s) => s.inset && s.spread === 1.5)).toBe(true)
      }
      near(r.muted, hex(MUTED[theme]))
      expect(ratio(rgb3(r.muted), panel)).toBeGreaterThanOrEqual(4.7)
      for (const [label, dots] of [['fill', r.fill], ['cell', r.cell]] as const) {
        const none = byRole(dots, '')
        near(none.panel!, panel)
        // not a bright fill: the colour of the panel (or nothing) and a stroke from corner to corner of --ap-ink-muted
        expect(none.cls, label).toContain('none')
        expect(none.cls, label).not.toContain('fill')
        expect(rgb3(none.bg).join() === panel.join() || none.bg[3] === 0, `${label}: «Без заливки» has no fill: ${none.bg}`).toBe(true)
        expect(none.bgImage, label).toContain('linear-gradient')
        expect(none.bgImage, label).toContain(`rgb(${rgb3(r.muted).join(', ')})`)
        near(rgb(none.border), rgb3(r.muted))
        expect(none.shadow === 'none' || shadows(none.shadow).every((s) => s.spread !== 1.5)).toBe(true)
      }

      // the fills of the document are those of main, not the bright colour of the circle; the circles of the text colour are --ap-tx-*
      expect(r.doc, 'the word has .hl-blue-bg').not.toBeNull()
      near(r.doc!, hex(HL_BLUE[theme]))
      expect(r.cellDoc, 'the cell has .cell-blue').not.toBeNull()
      near(r.cellDoc!, hex(HL_BLUE[theme]))
      for (const [role, c] of Object.entries(r.expectTx)) near(byRole(r.text, role).bg, c)
    })
  }
})

function rgb(c: string): number[] {
  const m = /rgba?\(([^)]*)\)/.exec(c)
  if (!m) throw new Error(`not an rgb colour: ${c}`)
  return m[1]!.split(',').map(Number)
}
