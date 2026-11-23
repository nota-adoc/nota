// the round capsule with the gear («Настройки Nota») right of «Замечания», in a real Chrome (jsdom has no layout), on the real bundle of the tab and its
// real style sheet. It is there in «Визуально», a button with a hint and an `aria-label` in both languages, a click sends `openSettings`, the keyboard reaches it;
// in «Текст» and in the strip of a big file it is there and active, as the tools and «Разделы» are not; in the tab of 1600, 1100, 900, 650 and 360 px, both themes,
// `sheet.adoc` and `many-sections.adoc` it lies on no capsule and no capsule on it, nothing covers it, the tab does not scroll sideways.
// Skipped, with the reason, where Chrome is not installed.
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
const at = (path: string): string => join(import.meta.dirname, path)
const fixture = (name: string): string => readFileSync(at(`../../../../quality/fixtures/editor/${name}`), 'utf8')

if (!CHROME) console.warn('Chrome is not installed (set CHROME_BIN): the test of the settings button in a real browser is skipped')

const WIDTHS = [1600, 1100, 900, 650, 360] as const

interface Config {
  name: string
  text: string
  mode: 'visual' | 'text'
  big: boolean
  locale: 'ru' | 'en'
}

const runner = (cfg: Config): string => `
const CFG = ${JSON.stringify(cfg)}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const $ = (s) => document.querySelector(s)
const frames = (n) => sleep(17 * n)
const real = async (n) => { for (let i = 0; i < n; i++) await fetch('style.css?' + Math.random()).then((r) => r.text()) }
const app = $('#app')
const rc = (e) => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height } }
const shown = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' }
const over = (a, b) => Math.min(a.r, b.r) - Math.max(a.l, b.l) > 0.5 && Math.min(a.b, b.b) - Math.max(a.t, b.t) > 0.5
const out = { error: null, rows: [], click: [] }
const run = async () => {
  window.postMessage({ type: 'init', text: ${JSON.stringify('')} + CFG.text, version: 1, fileName: 'a.adoc', locale: CFG.locale, fileDir: '/tmp', mode: CFG.mode, ...(CFG.big ? { big: { bytes: 1468006 } } : {}) }, '*')
  for (let i = 0; i < 60 && !$('.ed-isles'); i++) await sleep(100)
  await sleep(600)
  for (const theme of ['dark', 'light']) {
    document.body.className = 'vscode-' + theme
    document.body.dataset.notaTheme = theme
    await sleep(200)
    for (const width of ${JSON.stringify(WIDTHS)}) {
      app.style.width = width + 'px'
      // (the capsule of tools takes its view a few frames after the width: narrow up to the threshold of ≈ 966 px, open over it)
      const want = width <= 900 ? 'narrow' : 'wide'
      for (let i = 0; i < 60 && $('.isle-tools')?.dataset.view !== want; i++) { await real(2); await frames(2) }
      await frames(5)
      const gear = $('.isle-right .isle-settings')
      const row = { theme, width, found: Boolean(gear) }
      if (gear) {
        const g = rc(gear), cx = g.l + g.w / 2, cy = g.t + g.h / 2
        const top = document.elementFromPoint(cx, cy)
        const parts = { remarks: '.isle-right .isle-remarks', tools: '.isle-mid .isle-tools', sections: '.isle-left .isle', strokes: '.isle-strokes', badge: '.pagemeta-badge' }
        // («Замечаний нет»: the capsule of remarks is invisible and holds its place)
        const others = {}
        for (const k of Object.keys(parts)) { const e = $(parts[k]); if (e && (k === 'remarks' ? e.getBoundingClientRect().width > 0 : shown(e))) others[k] = rc(e) }
        row.overlaps = Object.keys(others).filter((k) => over(g, others[k]))
        row.covered = !(top === gear || gear.contains(top)); row.top = top ? top.tagName + '.' + top.className : ''
        row.inside = g.l >= 0 && g.r <= app.clientWidth + 0.5 && g.t >= 0
        row.size = [Math.round(g.w), Math.round(g.h)]
        row.afterRemarks = Boolean($('.isle-right .isle-remarks')) && $('.isle-right .isle-remarks').nextElementSibling === gear && others.remarks.r <= g.l + 0.5
        row.scrollsX = document.documentElement.scrollWidth > document.documentElement.clientWidth
        row.state = { tag: gear.tagName, type: gear.type, disabled: gear.disabled, ariaDisabled: gear.getAttribute('aria-disabled'), tabIndex: gear.tabIndex, opacity: getComputedStyle(gear).opacity, events: getComputedStyle(gear).pointerEvents, label: gear.getAttribute('aria-label'), title: gear.title }
        const tools = $('.isle-tools')
        row.toolsDisabled = tools ? (tools.querySelector('button')?.disabled ?? null) : null
        const cap = $('.isle-tools') ? rc($('.isle-tools')) : null
        row.toolsInside = cap ? [...document.querySelectorAll('.isle-tools > .tl-main button')].filter((b) => b.getClientRects().length > 0).every((b) => { const x = rc(b); return x.l >= cap.l - 0.5 && x.r <= cap.r + 0.5 }) : true
        gear.focus()
        row.focusable = document.activeElement === gear
        gear.blur()
      }
      out.rows.push(row)
    }
  }
  // a click sends the message; the host opens the Settings (a test of the host)
  app.style.width = '1100px'
  await frames(3)
  const gear = $('.isle-right .isle-settings')
  window.__sent.length = 0
  gear.click()
  out.click = window.__sent.slice()
  document.title = 'RES ' + JSON.stringify(out)
}
run().catch((e) => { out.error = String(e && e.stack || e); document.title = 'RES ' + JSON.stringify(out) })
`

interface Row {
  theme: string
  width: number
  found: boolean
  overlaps?: string[]
  covered?: boolean
  top?: string
  inside?: boolean
  size?: [number, number]
  afterRemarks?: boolean
  scrollsX?: boolean
  focusable?: boolean
  toolsInside?: boolean
  toolsDisabled: boolean | null
  state?: { tag: string; type: string; disabled: boolean; ariaDisabled: string | null; tabIndex: number; opacity: string; events: string; label: string | null; title: string }
}
interface Result {
  error: string | null
  rows: Row[]
  click: { type: string }[]
}


async function measure(cfg: Config): Promise<Result> {
  const css = readFileSync(at('../../../react/src/style.css'), 'utf8') + '\n' + readFileSync(at('../../src/webview/style.css'), 'utf8')
  const dir = mkdtempSync(join(tmpdir(), 'nota-settings-'))
  try {
    writeFileSync(join(dir, 'webview.js'), await tabBundle())
    writeFileSync(join(dir, 'style.css'), css)
    writeFileSync(
      join(dir, 'p.html'),
      `<!doctype html><html lang="${cfg.locale}"><head><meta charset="utf-8"><link rel="stylesheet" href="style.css"><style>html,body{margin:0}#app{width:1600px;height:100vh}</style><style>*,*::before,*::after{animation:none!important;transition:none!important}</style></head><body class="vscode-dark" data-nota-theme="dark"><div id="app"></div>
<script>window.__sent=[];window.acquireVsCodeApi=()=>({postMessage(m){window.__sent.push(m)},getState:()=>null,setState(){}})</script>
<script src="webview.js"></script><script>${runner(cfg)}</script></body></html>`,
    )
    const html = await chromeDump(CHROME!, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--allow-file-access-from-files', `--user-data-dir=${join(dir, 'profile')}`, '--window-size=1600,800', '--virtual-time-budget=240000', '--dump-dom', `file://${join(dir, 'p.html')}`], 270_000)
    const m = /<title>RES ([^<]*)<\/title>/.exec(html)
    if (!m) throw new Error('the page did not report: ' + (/<title>[^<]*<\/title>/.exec(html)?.[0] ?? html.slice(0, 200)))
    return JSON.parse(m[1]!.replaceAll('&quot;', '"').replaceAll('&amp;', '&').replaceAll('&gt;', '>').replaceAll('&lt;', '<')) as Result
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const CASES: { title: string; cfg: Config }[] = [
  { title: '«Визуально», sheet.adoc', cfg: { name: 'visual-sheet', text: fixture('sheet.adoc'), mode: 'visual', big: false, locale: 'ru' } },
  { title: '«Визуально», many-sections.adoc', cfg: { name: 'visual-many', text: fixture('many-sections.adoc'), mode: 'visual', big: false, locale: 'ru' } },
  { title: '«Текст»', cfg: { name: 'text', text: fixture('sheet.adoc'), mode: 'text', big: false, locale: 'ru' } },
  { title: 'a big file («Файл больше 1 МБ…»)', cfg: { name: 'big', text: fixture('sheet.adoc'), mode: 'text', big: true, locale: 'ru' } },
  { title: 'English', cfg: { name: 'en', text: fixture('sheet.adoc'), mode: 'visual', big: false, locale: 'en' } },
]

describe.skipIf(!CHROME)('the button «Настройки Nota» (real Chrome)', () => {
  for (const { title, cfg } of CASES) {
    it(`${title}: it stands right of «Замечания», works, and lies on nothing at 1600, 1100, 900, 650 and 360 px in both themes`, { timeout: 280_000 }, async () => {
      const r = await measure(cfg)
      expect(r.error).toBeNull()
      expect(r.rows).toHaveLength(WIDTHS.length * 2)
      const label = cfg.locale === 'en' ? 'Nota settings' : 'Настройки Nota'
      for (const row of r.rows) {
        const where = `${row.theme} ${row.width}px`
        expect(row.found, `${where}: the button`).toBe(true)
        // a round capsule of 36 px, right of «Замечания», a button that is not disabled and that the keyboard reaches
        expect(row.size, `${where}: size`).toEqual([36, 36])
        expect(row.afterRemarks, `${where}: right of «Замечания»`).toBe(true)
        expect(row.state, where).toMatchObject({ tag: 'BUTTON', type: 'button', disabled: false, ariaDisabled: null, opacity: '1', label, title: label })
        expect(row.state!.events, `${where}: the mouse`).not.toBe('none')
        expect(row.state!.tabIndex, `${where}: Tab`).toBeGreaterThanOrEqual(0)
        expect(row.focusable, `${where}: focus`).toBe(true)
        // nothing lies on it, nothing covers it, the tab does not scroll sideways
        expect(row.overlaps, `${where}: overlaps`).toEqual([])
        expect(row.covered ? row.top : false, `${where}: covered`).toBe(false)
        expect(row.inside, `${where}: inside the tab`).toBe(true)
        // (the capsule of tools gives up the lists in a narrow tab, so that its buttons stay inside it)
        expect(row.toolsInside, `${where}: the buttons of the tools stay inside their capsule`).toBe(true)
        expect(row.scrollsX, `${where}: scrolls sideways`).toBe(false)
        // «Текст» and the big file: the tools are disabled, the button is not
        if (cfg.mode === 'text') expect(row.toolsDisabled === true || row.toolsDisabled === null, `${where}: tools`).toBe(true)
      }
      // a click is one message to the host (it opens the Settings)
      expect(r.click).toEqual([{ type: 'openSettings' }])
    })
  }
})
