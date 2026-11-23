// in a stretched capsule of tools (a tab ≤ 650 px) the buttons stand at the left edge, not in the middle. Measured in a real Chrome (jsdom has no
// layout) on the real style sheet and the markup of `tools.tsx` / `block-insert.tsx`. Skipped where Chrome is not installed.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromeDump } from './chrome.js'
import { beforeAll, describe, expect, it } from 'vitest'
import { CHROME_QUEUE_MS, holdChromeSlot } from './chrome.js'

const CHROME = [process.env.CHROME_BIN ?? '', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => p && existsSync(p))
if (CHROME) beforeAll(() => holdChromeSlot(), CHROME_QUEUE_MS + 10_000)
const CSS = readFileSync(join(import.meta.dirname, '../../../react/src/style.css'), 'utf8') + '\n' + readFileSync(join(import.meta.dirname, '../../src/webview/style.css'), 'utf8')

interface Measure { rowFirst: number; crLeft: number; crOutLeft: number; capsule: [number, number]; plus: number; mainLast: number; height: number }

const btn = (c = ''): string => `<button class="tb-b ${c}" style="width:30px">x</button>`

type RowKind = 'none' | 'table' | 'colors' | 'out'

const dots = '<span class="sw-b dot" style="display:block"></span>'.repeat(5)
const cr = `<div class="cr" data-kind="fill"><span class="cr-sw">${dots}</span></div>`

function rowHtml(kind: RowKind): string {
  if (kind === 'none') return ''
  const tools = Array.from({ length: 8 }, () => btn('t')).join('')
  // as tools.tsx: the colors replace the buttons in `.tl-row.tl-colors`; the leaving ones lie in `.tl-colors-out` over the buttons of the row
  const inner = kind === 'colors' ? cr : kind === 'out' ? `${tools}<div class="tl-colors-out">${cr}</div>` : tools
  return `<div class="tl-table"><div class="tl-row${kind === 'colors' ? ' tl-colors' : ''}">${inner}</div></div>`
}

async function measure(width: number, kind: RowKind = 'none'): Promise<Measure> {
  const main = `<div class="tl-main">${btn('tl-plus')}<button class="tb-b tl-style">Текст ⌄</button><span class="tl-sep" style="width:1px;height:16px;background:#999"></span>${btn()}${btn()}${btn()}</div>`
  const html = `<!doctype html><meta charset="utf-8"><style>${CSS}</style><style>*,*::before,*::after{animation:none!important;transition:none!important}</style>
<body data-nota-theme="dark" style="margin:0;width:${width}px;height:300px;font:13px sans-serif"><div class="ed-body" style="height:300px;display:flex"><div class="ed-main"><div class="ed-isles"><div class="isle-wrap isle-left"><div class="isle isle-sections" style="width:36px;height:36px">S</div></div><div class="isle-wrap isle-mid"><div class="tools-root"><div class="isle isle-tools ed-format">${main}${rowHtml(kind)}</div></div></div><div class="isle-wrap isle-right"><div class="isle" style="width:50px;height:36px">3</div></div></div></div></div>
<script>
const q = (s) => document.querySelector(s).getBoundingClientRect()
const opt = (s) => { const e = document.querySelector(s); return e ? e.getBoundingClientRect().left : 0 }
const cap = q('.isle-tools')
document.title = 'RES ' + JSON.stringify({ rowFirst: opt('.tl-row > .tb-b'), crLeft: opt('.tl-colors .cr'), crOutLeft: opt('.tl-colors-out .cr'), capsule: [cap.left, cap.right], plus: q('.tl-plus').left, mainLast: q('.tl-main > .tb-b:last-child').right,  height: cap.height })
</script>`
  const dir = mkdtempSync(join(tmpdir(), 'nota-align-'))
  try {
    writeFileSync(join(dir, 'p.html'), html)
    let out = ''
    try {
      out = await chromeDump(CHROME!, ['--headless=new', '--disable-gpu', `--window-size=${width},300`, '--virtual-time-budget=2000', '--dump-dom', `file://${join(dir, 'p.html')}`], 60_000)
    } catch (e) {
      // on a loaded Mac Chrome may end by its teardown watchdog with a non-zero code after it has dumped the DOM
      out = String((e as { stdout?: string }).stdout ?? '')
    }
    return JSON.parse(/<title>RES ([^<]*)<\/title>/.exec(out)![1]!) as Measure
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe.skipIf(!CHROME)('the buttons of a stretched capsule stand at its left edge (real Chrome)', { timeout: 240000 }, () => {
  for (const width of [390, 520]) {
    it(`${width} px: closed — «+» is 5 px from the frame, the room is left at the right`, async () => {
      const m = await measure(width)
      expect(m.plus - m.capsule[0]).toBeLessThanOrEqual(7)
      expect(m.capsule[1] - m.mainLast).toBeGreaterThan(40)
    })
  }
  for (const width of [390, 520]) {
    it(`${width} px: the row «Таблица» and the circles stand at the left, «+» does not move, the leaving circles are where the live ones were`, async () => {
      const closed = await measure(width)
      const table = await measure(width, 'table')
      const colors = await measure(width, 'colors')
      const out = await measure(width, 'out')
      expect(table.rowFirst - table.capsule[0]).toBeLessThanOrEqual(7)
      expect(colors.crLeft - colors.capsule[0]).toBeLessThanOrEqual(7)
      for (const m of [table, colors, out]) expect(m.plus - m.capsule[0]).toBe(closed.plus - closed.capsule[0])
      expect(out.crOutLeft - out.capsule[0]).toBe(colors.crLeft - colors.capsule[0])
    })
  }
  // a capsule by its content. The leaving circles used to be centered in the row (a row wider than the circles), so on closing they moved left by half the difference;
  // now they lie where the live ones were — a change of the wide tab too (it fixes a jump).
  for (const width of [700, 1280]) {
    it(`${width} px: a capsule by its content, the buttons are at the left, the leaving circles do not jump`, async () => {
      const closed = await measure(width)
      const colors = await measure(width, 'colors')
      const out = await measure(width, 'out')
      expect(closed.plus - closed.capsule[0]).toBeLessThanOrEqual(7)
      expect((await measure(width, 'table')).rowFirst - closed.capsule[0]).toBeLessThanOrEqual(7)
      expect(out.plus - out.capsule[0]).toBe(closed.plus - closed.capsule[0])
      expect(out.crOutLeft - out.capsule[0]).toBe(colors.crLeft - colors.capsule[0])
    })
  }
})
