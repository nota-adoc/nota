// the row of capsules in a narrow tab, measured in a real Chrome (jsdom has no layout). Skipped where Chrome is not installed.
// The markup is the one of `main.ts` (`.ed-isles` with three `.isle-wrap`) with the row of the cell colours, the CSS is the real one.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { CHROME_QUEUE_MS, holdChromeSlot } from './chrome.js'
import { chromeDump } from './chrome-dump.js'

const CHROME = [process.env.CHROME_BIN ?? '', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => p && existsSync(p))
if (CHROME) beforeAll(() => holdChromeSlot(), CHROME_QUEUE_MS + 10_000)
const CSS = readFileSync(join(import.meta.dirname, '../../../react/src/style.css'), 'utf8') + '\n' + readFileSync(join(import.meta.dirname, '../../src/webview/style.css'), 'utf8')

type Box = [number, number, number, number]
interface Measure { isles: Box; doc: Box; left: Box; right: Box; mid: Box; sw: Box | 0 }

async function measure(width: number, theme: 'dark' | 'light', colors: boolean): Promise<Measure> {
  const dots = Array.from({ length: 7 }, () => '<button class="sw-b dot" style="--c:#7aa"></button>').join('')
  const row = colors
    ? `<div class="tl-table"><div class="tl-row tl-colors"><div class="cr" data-kind="cell"><button class="cr-back">‹ <span class="cr-back-t">Таблица</span></button><span class="cr-title">Заливка ячеек: 2</span><div class="cr-sw">${dots}</div></div></div></div>`
    : '<div class="tl-table"><div class="tl-row"><button class="tb-b">a</button><button class="tb-b">b</button></div></div>'
  const html = `<!doctype html><meta charset="utf-8"><style>${CSS}</style><style>/* only the layout is measured: animations are off */ *,*::before,*::after{animation:none!important;transition:none!important}</style>
<body data-outline-view="capsule" data-nota-theme="${theme}" style="margin:0;width:${width}px;height:600px;font:13px sans-serif"><div class="ed-body" style="height:600px;display:flex"><div class="ed-main">
<div class="ed-isles"><div class="isle-wrap isle-left"><div class="isle isle-sections" style="width:36px;height:36px">S</div></div><div class="isle-wrap isle-mid"><div class="tools-root"><div class="isle isle-tools ed-format" style="width:100%"><div class="tl-main" style="height:36px"><button class="tb-b">+</button></div>${row}</div></div></div><div class="isle-wrap isle-right"><div class="isle" style="width:50px;height:36px">● 3</div></div></div>
<div class="scroll ed-visual"><article class="page"><p id="doc">Text</p></article></div></div></div>
<script>
const r = (e) => { const b = document.querySelector(e).getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.right), Math.round(b.bottom)] }
document.title = 'RES ' + JSON.stringify({ isles: r('.ed-isles'), doc: r('#doc'), left: r('.isle-left .isle'), right: r('.isle-right .isle'), mid: r('.isle-mid .isle-tools'), sw: ${colors ? "r('.cr-sw')" : 0} })
</script>`
  const dir = mkdtempSync(join(tmpdir(), 'nota-isles-'))
  try {
    writeFileSync(join(dir, 'p.html'), html)
    const out = await chromeDump(CHROME!, ['--headless=new', '--disable-gpu', `--window-size=${width},600`, '--virtual-time-budget=2000', '--dump-dom', `file://${join(dir, 'p.html')}`], 100_000)
    return JSON.parse(/<title>RES ([^<]*)<\/title>/.exec(out)![1]!) as Measure
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe.skipIf(!CHROME)('the row of cell colours in a narrow tab (real Chrome)', () => {
  for (const width of [390, 500]) {
    for (const theme of ['dark', 'light'] as const) {
      it(`${width} px, ${theme}: the row of seven circles lies whole inside the capsule, and the row of capsules and the text do not move`, { timeout: 240_000 }, async () => {
        const plain = await measure(width, theme, false)
        const colors = await measure(width, theme, true)
        // not cut: the row lies inside the capsule, the capsule is inside the tab
        const sw = colors.sw as Box
        expect(sw[0]).toBeGreaterThanOrEqual(colors.mid[0])
        expect(sw[2]).toBeLessThanOrEqual(colors.mid[2])
        expect(colors.mid[0]).toBeGreaterThanOrEqual(0)
        expect(colors.mid[2]).toBeLessThanOrEqual(width)
        // not moved: the two small capsules stay in the first row, the row of capsules is as high as before, the text is where it was
        expect(colors.left[1]).toBe(plain.left[1])
        expect(colors.right[1]).toBe(plain.right[1])
        expect(colors.isles).toEqual(plain.isles)
        expect(colors.doc).toEqual(plain.doc)
      })
    }
  }
  it('1100 px: the wide tab is not touched by the narrow rule', { timeout: 240_000 }, async () => {
    const plain = await measure(1100, 'dark', false)
    const colors = await measure(1100, 'dark', true)
    expect(colors.isles).toEqual(plain.isles)
    expect(colors.doc).toEqual(plain.doc)
    expect(colors.left).toEqual(plain.left)
    expect(colors.right).toEqual(plain.right)
  })
})
