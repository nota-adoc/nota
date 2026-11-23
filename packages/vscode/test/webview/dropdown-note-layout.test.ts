// the note «пропускает уровень» of an item of the list «Текст ⌄» stands after the label in one line, and only on a tab of 330 px and narrower goes under the label
// (the keys and the tick stay on the line of the label). Measured in a real Chrome (jsdom has no layout) on the real style sheets and the markup of `Dropdown.tsx`,
// the list opened under a button 111 px wide (the button «Текст»). Skipped where Chrome is not installed.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromeDump } from './chrome.js'
import { beforeAll, describe, expect, it } from 'vitest'
import { CHROME_QUEUE_MS, holdChromeSlot } from './chrome.js'

const CHROME = [process.env.CHROME_BIN ?? '', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => p && existsSync(p))
if (CHROME) beforeAll(() => holdChromeSlot(), CHROME_QUEUE_MS + 10_000)
const CSS = readFileSync(join(import.meta.dirname, '../../../react/src/style.css'), 'utf8') + '\n' + readFileSync(join(import.meta.dirname, '../../src/webview/style.css'), 'utf8')

interface Row { h: number; labelTop: number; noteTop: number; noteLeft: number; labelRight: number; keysTop: number; tickTop: number; top: number; listW: number }
interface Measure { noted: Row; plain: Row }

const opt = (label: string, note: string, selected = false): string =>
  `<div class="dd-opt${note ? ' has-note' : ''}" role="option" aria-selected="${selected}">${note ? `<span class="dd-main"><span class="dd-label">${label}</span><span class="dd-note">${note}</span></span>` : `<span class="dd-label">${label}</span>`}<span class="dd-keys">⌥⌘4</span>${selected ? '<span class="dd-tick">✓</span>' : ''}</div>`

async function measure(width: number): Promise<Measure> {
  // the page is an iframe of the width of the tab: headless Chrome does not make its window narrower than ~500 px, and the media query reads the width of the frame
  const inner = `<!doctype html><meta charset="utf-8"><style>${CSS}</style><style>*,*::before,*::after{animation:none!important;transition:none!important}</style>
<body data-nota-theme="dark" style="margin:0;width:${width}px;height:300px;font:13px sans-serif"><div style="padding:40px 8px"><span class="dd"><button class="dd-btn tb-b" style="width:111px">Текст ⌄</button><div class="dd-list pop" role="listbox">${opt('Заголовок 3', '')}${opt('Заголовок 4', 'пропускает уровень', true)}</div></span></div>
<script>
const r = (e) => e.getBoundingClientRect()
const row = (o) => { const l = o.querySelector('.dd-label'), n = o.querySelector('.dd-note'), k = o.querySelector('.dd-keys'), t = o.querySelector('.dd-tick'); return { h: r(o).height, top: r(o).top, labelTop: r(l).top, labelRight: r(l).right, noteTop: n ? r(n).top : 0, noteLeft: n ? r(n).left : 0, keysTop: r(k).top, tickTop: t ? r(t).top : 0, listW: r(document.querySelector('.dd-list')).width } }
const o = document.querySelectorAll('.dd-opt')
document.title = 'RES ' + JSON.stringify({ plain: row(o[0]), noted: row(o[1]) })
</script>`
  const html = `<!doctype html><meta charset="utf-8"><body style="margin:0"><iframe id="f" style="border:0;width:${width}px;height:300px" srcdoc="${inner.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"></iframe>
<script>document.getElementById('f').onload = () => { document.title = document.getElementById('f').contentDocument.title }</script>`
  const dir = mkdtempSync(join(tmpdir(), 'nota-ddnote-'))
  try {
    writeFileSync(join(dir, 'p.html'), html)
    let out = ''
    try {
      out = await chromeDump(CHROME!, ['--headless=new', '--disable-gpu', `--window-size=${width},300`, '--virtual-time-budget=2000', '--dump-dom', `file://${join(dir, 'p.html')}`], 60_000)
    } catch (e) {
      out = String((e as { stdout?: string }).stdout ?? '')
    }
    return JSON.parse(/<title>RES ([^<]*)<\/title>/.exec(out)![1]!) as Measure
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe.skipIf(!CHROME)('the note of an item of the list stands in one line, on a narrow tab under the label (real Chrome)', { timeout: 240000 }, () => {
  for (const width of [390, 700, 1280]) {
    it(`${width} px: one line, the note after the label, the item is as high as the plain one`, async () => {
      const { noted, plain } = await measure(width)
      expect(Math.abs(noted.noteTop - noted.labelTop)).toBeLessThanOrEqual(2)
      expect(noted.noteLeft).toBeGreaterThanOrEqual(noted.labelRight)
      expect(noted.h).toBe(plain.h)
      expect(noted.listW).toBeGreaterThan(111)
    })
  }
  for (const width of [330]) {
    it(`${width} px: the note under the label, the keys and the tick on the line of the label (перенос)`, async () => {
      const { noted } = await measure(width)
      expect(noted.noteTop).toBeGreaterThan(noted.labelTop + 8)
      expect(noted.keysTop).toBeLessThan(noted.noteTop)
      expect(noted.tickTop).toBeLessThan(noted.noteTop)
      expect(Math.abs(noted.keysTop - noted.labelTop)).toBeLessThanOrEqual(5)
    })
  }
})
