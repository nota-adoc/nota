// the panel over a selection never lies on the other things of a tab. Measured in a real Chrome (jsdom has no layout) on the
// real bundle of the tab and its real style sheet: the word is at the left and at the right edge of its line, in a paragraph, in an item of a list and in
// a table, at several heights (one of them at the strokes of the sections), in tabs of 390, 520, 700 and 1280 px (and 800: the strokes show from
// 761 px). The rectangles of the panel, of the strokes of the sections, of the handle «⋯» of a block, of the block bar, of the capsules at the top and of the badge
// of the sheet «i» must not cross. Skipped where Chrome is not installed.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { CHROME_QUEUE_MS, holdChromeSlot } from './chrome.js'
import { chromeDump, chromeFrameHeight, chromeVersion } from './chrome-dump.js'
import { tabBundle } from './bundle.js'

const CHROME = [process.env.CHROME_BIN ?? '', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => p && existsSync(p))
if (CHROME) beforeAll(() => holdChromeSlot(), CHROME_QUEUE_MS + 10_000)
const here = import.meta.dirname
const at = (path: string): string => join(here, path)

const TEXT =
  '= Заголовок\n\n' +
  Array.from({ length: 14 }, (_, i) => `Вводный абзац ${i} с текстом на одну-две строки для прокрутки страницы.\n\n`).join('') +
  '== Первый раздел\n\nПривязаны к проекту: файл прикреплён по образцу из каталога и ещё несколько слов подряд для длинной строки.\n\n' +
  '* привязаны к проекту: widget_flag по образцу из каталога\n* второй пункт списка с достаточно длинным текстом для переноса строки\n\n' +
  '== Второй раздел\n\n|===\n|Яч1 слово |Яч2 слово\n\n|Яч3 слово |Яч4 слово\n|===\n\n' +
  Array.from({ length: 14 }, (_, i) => `Хвостовой абзац ${i} для прокрутки.\n\n`).join('')

const HEIGHT = 560
/** Which block, which end of its first line, which one of them. */
const CASES: [string, string, 'left' | 'right', number][] = [
  ['paragraph-left', '.ProseMirror > p', 'left', 0],
  ['paragraph-right', '.ProseMirror > p', 'right', 0],
  ['list-left', '.li-text', 'left', 0],
  ['list-right', '.li-text', 'right', 0],
  ['table-left', 'td .cell-text', 'left', 0],
  ['table-right', 'td .cell-text', 'right', 1],
]
/** The height (px from the top of the window) the word is scrolled to: under the capsule, higher, at the strokes of the sections (they stand in the middle of the 560 px tab, about 280, so 290 is the one that meets them), lower. */
const HEIGHTS = [110, 200, 290, 380, 470]

/** The page that runs the cases inside Chrome and writes what it measured into the title. */
const runner = (theme: string): string => `
const CASES = ${JSON.stringify(CASES)}, YS = ${JSON.stringify(HEIGHTS)}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const vis = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && !e.closest('[hidden]') }
const PARTS = { panel: '.fl.bubble', strokes: '.isle-strokes', handle: '.blk-handle', blockbar: '.blockbar', sections: '.isle-left .isle', tools: '.isle-mid .isle-tools', remarks: '.isle-right .isle', badge: '.pagemeta-badge', rowcaps: '.nota-grips .gb' }
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
const measure = () => {
  const rects = {}
  for (const [name, sel] of Object.entries(PARTS)) {
    const e = [...document.querySelectorAll(sel)].find(vis)
    if (e) { const r = e.getBoundingClientRect(); rects[name] = [r.left, r.top, r.right, r.bottom] }
  }
  const hits = []
  const names = Object.keys(rects)
  for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
    const a = rects[names[i]], b = rects[names[j]]
    if (Math.min(a[2], b[2]) - Math.max(a[0], b[0]) > 0.5 && Math.min(a[3], b[3]) - Math.max(a[1], b[1]) > 0.5) hits.push(names[i] + '×' + names[j])
  }
  const p = rects.panel
  return { panel: Boolean(p), inside: p ? p[0] >= 0 && p[2] <= innerWidth : false, hits, at: p ? p.join() : '' }
}
const out = { width: 0, height: 0, strokes: false, runs: [], at: '' }
const run = async () => {
  document.body.className = 'vscode-${theme}'
  window.postMessage({ type: 'init', text: ${JSON.stringify(TEXT)}, version: 1, fileName: 'a.adoc', locale: 'ru', outlineView: 'capsule', fileDir: '/tmp', mode: 'visual' }, '*')
  for (let i = 0; i < 50 && !document.querySelector('.ProseMirror'); i++) await sleep(100)
  await sleep(300)
  const ed = document.querySelector('.ProseMirror'), scroller = document.querySelector('.ed-visual')
  Object.assign(out, { width: innerWidth, height: innerHeight })
  for (const [name, sel, which, nth] of CASES) {
    for (const y of YS) {
      out.at = name + '@' + y
      let w = word(sel, which, nth)
      scroller.scrollTop += w.b.y - y
      await sleep(150)
      w = word(sel, which, nth)
      // the mouse is on the word (the handle of its block shows), the word is selected
      scroller.dispatchEvent(new MouseEvent('mousemove', { clientX: w.b.x + w.b.width / 2, clientY: w.b.y + w.b.height / 2, bubbles: true }))
      ed.focus()
      const r = document.createRange(); r.setStart(w.n, w.from); r.setEnd(w.n, w.to)
      const s = getSelection(); s.removeAllRanges(); s.addRange(r)
      await sleep(700)
      out.strokes = out.strokes || [...document.querySelectorAll('.isle-strokes')].some(vis)
      const base = measure()
      const sr = scroller.getBoundingClientRect()
      out.runs.push({ name: name + '@' + y, ...base, word: Math.round(w.b.y) + '..' + Math.round(w.b.bottom), area: Math.round(sr.top) + '..' + Math.round(sr.bottom) })
      // the mouse goes up to the panel over another block (its handle shows there) and onto the panel: the panel stays where it was
      // no panel is a failure of the case (panel: false in the measure), not an exception of the whole page
      const pe = document.querySelector('.fl.bubble')
      const pr = pe ? pe.getBoundingClientRect() : w.b
      scroller.dispatchEvent(new MouseEvent('mousemove', { clientX: w.b.x + w.b.width / 2, clientY: pr.top + pr.height / 2, bubbles: true }))
      await sleep(250)
      const passed = measure()
      scroller.dispatchEvent(new MouseEvent('mouseleave', { bubbles: false }))
      await sleep(250)
      const onto = measure()
      out.runs.push({ name: name + '@' + y + ' mouse', ...onto, hits: [...passed.hits, ...onto.hits], moved: passed.at !== base.at || onto.at !== base.at })
      // the row of colours open from «A ⌄»: wider than the panel, it must not lie on anything either
      const open = document.querySelector('.fl.bubble [data-cmd="color"]')
      if (open) {
        open.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        await sleep(400)
        out.runs.push({ name: name + '@' + y + ' colours', ...measure(), colours: Boolean(document.querySelector('.fl.bubble .cr-back')) })
        document.querySelector('.cr-back')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        await sleep(200)
      }
    }
  }
  document.title = 'RES ' + JSON.stringify(out)
}
run().catch((e) => { document.title = 'RES ' + JSON.stringify({ error: String(e && e.stack || e) + ' (at the case ' + out.at + ')' }) })
`

interface Run { name: string; word?: string; area?: string; panel: boolean; inside: boolean; hits: string[]; moved?: boolean; colours?: boolean }
interface Result { width: number; height: number; strokes: boolean; runs: Run[]; error?: string }

/** What a red run says first: which Chrome, how big the page really is (`--window-size` is not `innerWidth × innerHeight`), and what the case lacks. */
function why(r: Run): string {
  const bits = [!r.panel && 'panel', r.panel && !r.inside && 'inside', r.hits.length > 0 && `hits ${r.hits.join(',')}`, r.moved && 'moved'].filter(Boolean)
  return `${r.name}: ${bits.join(' ')}${r.word ? ` (word ${r.word}, area ${r.area})` : ''}`
}

async function measureTab(width: number, theme: 'dark' | 'light'): Promise<Result> {
  const css = readFileSync(at('../../../react/src/style.css'), 'utf8') + '\n' + readFileSync(at('../../src/webview/style.css'), 'utf8')
  const dir = mkdtempSync(join(tmpdir(), 'nota-overlap-'))
  try {
    writeFileSync(join(dir, 'webview.js'), await tabBundle())
    writeFileSync(join(dir, 'style.css'), css)
    writeFileSync(
      join(dir, 'p.html'),
      `<!doctype html><html lang="ru"><head><meta charset="utf-8"><link rel="stylesheet" href="style.css"><style>/* only the layout is measured: a headless Chrome in virtual time runs animations by its own clock, they are off */ *,*::before,*::after{animation:none!important;transition:none!important}</style></head><body class="vscode-${theme}" data-nota-theme="${theme}"><div id="app" class="nota" data-mermaid=""></div>
<script>window.acquireVsCodeApi=()=>({postMessage(){},getState:()=>null,setState(){}})</script>
<script src="webview.js"></script><script>${runner(theme)}</script></body></html>`,
    )
    const html = await chromeDump(
      CHROME!,
      ['--headless=new', '--disable-gpu', '--allow-file-access-from-files', `--window-size=${width},${HEIGHT + (await chromeFrameHeight(CHROME!))}`, '--virtual-time-budget=180000', '--dump-dom', `file://${join(dir, 'p.html')}`],
      110_000,
    )
    const m = /<title>RES ([^<]*)<\/title>/.exec(html)
    if (!m) throw new Error('the page did not report')
    return JSON.parse(m[1]!.replaceAll('&quot;', '"').replaceAll('&amp;', '&').replaceAll('&gt;', '>').replaceAll('&lt;', '<')) as Result
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe.skipIf(!CHROME)('the panel over a selection and the other things of the tab do not cross (real Chrome)', () => {
  // (the dark theme at every width, the light one at the narrowest and at the width where the strokes show)
  const TABS: [number, 'dark' | 'light'][] = [[390, 'dark'], [520, 'dark'], [700, 'dark'], [800, 'dark'], [1280, 'dark'], [390, 'light'], [800, 'light']]
  for (const [width, theme] of TABS) {
    it(`a tab of ${width} px, ${theme} theme`, { timeout: 200_000 }, async () => {
      const result = await measureTab(width, theme)
      const where = `${await chromeVersion(CHROME!)}, window ${width}x${HEIGHT + (await chromeFrameHeight(CHROME!))}, page ${result.width}x${result.height}`
      expect(result.error, where).toBeUndefined()
      expect(result.runs.filter((r) => !r.name.includes(' '))).toHaveLength(CASES.length * HEIGHTS.length)
      // the row of colours was really open in the cases that are measured with it
      expect(result.runs.filter((r) => r.name.endsWith(' colours')).every((r) => r.colours)).toBe(true)
      expect(result.runs.filter((r) => r.name.endsWith(' colours')).length).toBeGreaterThan(0)
      // the strokes of the sections are a part of what is measured where the tab is wide enough for them
      // the page is as tall as the cases are laid out for (a shorter one puts the word at 470 px under the bottom of the area: no panel)
      expect(result.height, where).toBe(HEIGHT)
      expect(result.strokes).toBe(width > 760)
      const bad = result.runs.filter((r) => !r.panel || !r.inside || r.hits.length > 0 || r.moved)
      expect(bad.map(why), where).toEqual([])
    })
  }
})
