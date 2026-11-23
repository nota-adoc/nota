// the anchors over blocks and the long unbreakable lines in the visual tab, measured in a real Chrome (jsdom has no layout) on the real bundle of
// the tab and its real style sheet: the document is never wider than the tab (`.scroll`: scrollWidth <= clientWidth), the anchor `[#id]` of 950 signs is not
// shown by default, a compact plate is shown with `nota.showAnchors` (one line, the message `showAnchors` of the host, the tab is not reopened). Skipped where
// Chrome is not installed.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { CHROME_QUEUE_MS, holdChromeSlot } from './chrome.js'
import { chromeDump } from './chrome-dump.js'
import { tabBundle } from './bundle.js'

const CHROME = [process.env.CHROME_BIN ?? '', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => p && existsSync(p))
const here = import.meta.dirname
const at = (path: string): string => join(here, path)
const HEIGHT = 700
if (CHROME) beforeAll(() => holdChromeSlot(), CHROME_QUEUE_MS + 10_000)

const ID = Array.from({ length: 95 }, (_, i) => `пример-модули${i}`).join('-').slice(0, 950)
const LONG = (n: number, s = 'слово'): string => s.repeat(Math.ceil(n / s.length)).slice(0, n)
const TEXT =
  `= Заголовок\n\n[#${ID}]\n=== 4. Заголовок\n\nАбзац под заголовком, <<${ID}>> и xref:#${ID}[раздел].\n\n` +
  `[[adm-${ID}]]\nNOTE: ${LONG(600)}\n\n` +
  `[[intro-id]]\n[role=${LONG(600, 'r')}]\nАбзац с якорем и служебной строкой.\n\n` +
  `https://example.com/${LONG(600, 'a')}\n\n` +
  `Текст \`${LONG(600, 'c')}\` конец.\n\n` +
  `== ${LONG(300)}\n\n` +
  `term:: ${LONG(600, 'i')}\n\n` +
  '|===\n|А |Б\n\n|1 |2\n|===\n'

const runner = (theme: string, mode: 'visual' | 'text' = 'visual', flag = false): string => `
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const out = { width: 0, height: 0, runs: [] }
const state = (name) => {
  const scroll = document.querySelector('.scroll')
  const h = [...document.querySelectorAll('h3')].find((e) => e.textContent === '4. Заголовок')
  const anchors = [...document.querySelectorAll('.nota-anchor')].filter((e) => getComputedStyle(e).display !== 'none')
  const boxes = anchors.map((e) => { const r = e.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom] })
  const metas = [...document.querySelectorAll('[data-meta]')].map((e) => e.getAttribute('data-meta'))
  const sr = scroll.getBoundingClientRect()
  out.runs.push({
    name, sw: scroll.scrollWidth, cw: scroll.clientWidth, shown: anchors.length, boxes, tab: [sr.left, sr.right],
    rawId: document.querySelector('.ProseMirror').innerText.includes('[#') || metas.some((m) => m.includes('[#' + ${JSON.stringify(ID)}.slice(0, 20))),
    metas: metas.length, h: h ? h.getBoundingClientRect().bottom : -1,
    tip: anchors[0] ? getComputedStyle(anchors[0].querySelector('.anchor-tip')).display : '',
    tipHead: anchors[0] ? getComputedStyle(anchors[0].querySelector('.anchor-tip'), '::before').content : '',
    tipId: anchors[0] ? getComputedStyle(anchors[0].querySelector('.anchor-tip'), '::after').content : '',
    tipHeadFont: anchors[0] ? getComputedStyle(anchors[0].querySelector('.anchor-tip'), '::before').fontFamily : '',
    tipMaxH: anchors[0] ? getComputedStyle(anchors[0].querySelector('.anchor-tip')).maxHeight : '',
    plateW: anchors[0] ? anchors[0].getBoundingClientRect().width : 0,
    found: ['.ProseMirror p', '.ProseMirror h3', '.ProseMirror h2', '.nota-island', '.adm-para'].map((s) => document.querySelectorAll(s).length),
    // where the plate stands against its block: over it (the block starts under the plate), and in the case of an admonition over the whole block
    order: anchors.map((e) => { const b = e.nextElementSibling; const a = e.getBoundingClientRect(); const r = b.getBoundingClientRect(); return [b.className || b.tagName, a.bottom <= r.top + 0.5, Math.abs(a.left - r.left) < 1] }),
    wide: ['.ProseMirror p', '.ProseMirror h3', '.ProseMirror h2', '.nota-island', '.adm-para'].map((s) => [s, Math.max(...[...document.querySelectorAll(s)].map((e) => e.getBoundingClientRect().right))]),
  })
}
const run = async () => {
  document.body.className = 'vscode-${theme}'
  window.postMessage({ type: 'init', text: ${JSON.stringify(TEXT)}, version: 1, fileName: 'a.adoc', locale: 'ru', outlineView: 'capsule', fileDir: '/tmp', mode: ${JSON.stringify(mode)}, showAnchors: ${JSON.stringify(flag)} }, '*')
  if (${JSON.stringify(mode)} === 'text') {
    for (let i = 0; i < 50 && !document.querySelector('.cm-content'); i++) await sleep(100)
    await sleep(400)
    const src = document.querySelector('.cm-content').textContent
    document.title = 'RES ' + JSON.stringify({ text: { has: src.includes('[#' + ${JSON.stringify(ID)} + ']'), flag: ${JSON.stringify(flag)}, show: document.body.dataset.showAnchors !== undefined }, runs: [] })
    return
  }
  for (let i = 0; i < 50 && !document.querySelector('.ProseMirror'); i++) await sleep(100)
  await sleep(400)
  Object.assign(out, { width: innerWidth, height: innerHeight })
  state('default')
  window.postMessage({ type: 'showAnchors', on: true }, '*')
  await sleep(400)
  state('shown')
  window.postMessage({ type: 'showAnchors', on: false }, '*')
  await sleep(400)
  state('hidden again')
  document.title = 'RES ' + JSON.stringify(out)
}
run().catch((e) => { document.title = 'RES ' + JSON.stringify({ error: String(e && e.stack || e) }) })
`

interface Run { order: [string, boolean, boolean][]; tipHead: string; tipId: string; tipHeadFont: string; tipMaxH: string; plateW: number; found: number[]; name: string; sw: number; cw: number; shown: number; boxes: number[][]; tab: number[]; rawId: boolean; metas: number; h: number; tip: string; wide: [string, number][] }
interface Result { text?: { has: boolean; flag: boolean; show: boolean }; width: number; height: number; runs: Run[]; error?: string }

/** `chrome --dump-dom`; on a loaded machine Chrome prints the page and then dies of its teardown watchdog, so a page that reported (its `<title>`) counts; a hung Chrome is killed. */
const dump = (args: string[]): Promise<string> => chromeDump(CHROME!, args, 100_000)

let frame: number | undefined
/**
 * How many px of `--window-size` Chrome keeps for itself: `--headless` makes the page `innerHeight` shorter than the window (87 px on Chrome 157, both
 * Google Chrome and Chrome for Testing, 39 and 51). The cases below are laid out for a page of `HEIGHT` px (the word at 470 px must have room under it),
 * so the window is made taller by what Chrome takes, learned from a page that reports its own size.
 */
async function frameHeight(): Promise<number> {
  if (frame !== undefined) return frame
  const dir = mkdtempSync(join(tmpdir(), 'nota-frame-'))
  try {
    writeFileSync(join(dir, 'p.html'), '<!doctype html><title></title><script>document.title = "H " + innerHeight</script>')
    const html = await chromeDump(CHROME!, ['--headless=new', '--disable-gpu', `--window-size=1280,${HEIGHT}`, '--dump-dom', `file://${join(dir, 'p.html')}`], 30_000).catch(() => '')
    const m = /<title>H (\d+)<\/title>/.exec(html)
    frame = m ? Math.max(0, HEIGHT - Number(m[1])) : 0
    return frame
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}


async function measureTab(width: number, theme: 'dark' | 'light', mode: 'visual' | 'text' = 'visual', flag = false, script?: string): Promise<Result> {
  const css = readFileSync(at('../../../react/src/style.css'), 'utf8') + '\n' + readFileSync(at('../../src/webview/style.css'), 'utf8')
  const dir = mkdtempSync(join(tmpdir(), 'nota-anchors-'))
  try {
    writeFileSync(join(dir, 'webview.js'), await tabBundle())
    writeFileSync(join(dir, 'style.css'), css)
    writeFileSync(
      join(dir, 'p.html'),
      `<!doctype html><html lang="ru"><head><meta charset="utf-8"><link rel="stylesheet" href="style.css"><style>*,*::before,*::after{animation:none!important;transition:none!important}</style></head><body class="vscode-${theme}" data-nota-theme="${theme}"><div id="app" class="nota" data-mermaid=""></div>
<script>window.acquireVsCodeApi=()=>({postMessage(){},getState:()=>null,setState(){}})</script>
<script src="webview.js"></script><script>${script ?? runner(theme, mode, flag)}</script></body></html>`,
    )
    const html = await dump(['--headless=new', '--disable-gpu', '--allow-file-access-from-files', `--window-size=${width},${HEIGHT + (await frameHeight())}`, '--virtual-time-budget=60000', '--dump-dom', `file://${join(dir, 'p.html')}`])
    const m = /<title>RES ([^<]*)<\/title>/.exec(html)
    if (!m) throw new Error('the page did not report')
    return JSON.parse(m[1]!.replaceAll('&quot;', '"').replaceAll('&amp;', '&').replaceAll('&gt;', '>').replaceAll('&lt;', '<')) as Result
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe.skipIf(!CHROME)('anchors and long lines in the visual tab (real Chrome)', () => {
  for (const width of [500, 900]) {
    it(`a tab of ${width} px: no raw anchor, no horizontal scroll, a compact plate with the setting`, { timeout: 280_000 }, async () => {
      const r = await measureTab(width, 'light')
      const where = `${CHROME && execFileSync(CHROME, ['--version'], { encoding: 'utf8' }).trim()}, page ${r.width}x${r.height}`
      expect(r.error, where).toBeUndefined()
      const [def, shown, again] = r.runs as [Run, Run, Run]
      // by default nothing of the anchors is seen, the document is not wider than the tab, the long lines wrap inside their blocks
      expect(def.rawId, where).toBe(false)
      expect(def.shown).toBe(0)
      expect(def.sw, `${where} ${JSON.stringify(def.wide)}`).toBeLessThanOrEqual(def.cw)
      for (const [, right] of def.wide) expect(right, where).toBeLessThanOrEqual(def.tab[1]!)
      for (const n of def.found) expect(n, `${where} a kind of block is missing: the width check would pass for nothing`).toBeGreaterThan(0)
      // the service line that is not an anchor is still there
      expect(def.metas).toBeGreaterThan(0)
      // the plate: three anchors, one line, inside the tab, no tip lying open, no horizontal scroll
      expect(shown.shown).toBe(3)
      for (const b of shown.boxes) {
        expect(b[3]! - b[1]!).toBeLessThanOrEqual(20)
        expect(b[2]!).toBeLessThanOrEqual(shown.tab[1]!)
      }
      expect(shown.tip).toBe('none')
      // the plate stands over its block (the service line and the whole admonition), at the left edge of it
      expect(shown.order.length).toBe(3)
      for (const [block, over, flush] of shown.order) {
        expect(over, `${where} the plate is not over ${block}`).toBe(true)
        expect(flush, `${where} the plate is not at the left of ${block}`).toBe(true)
      }
      expect(shown.order.some(([block]) => block.includes('adm-para'))).toBe(true)
      // the tip is the first line and the whole id (read from the style: no hover in a headless run)
      expect(shown.tipHead).toContain('Якорь · правится в режиме «Текст»')
      expect(shown.tipId).toBe(JSON.stringify(ID))
      expect(shown.tipMaxH, 'the tip must not cut the id').toBe('none')
      expect(shown.tipHeadFont, 'the caption is in the font of the interface').not.toMatch(/mono/i)
      expect(shown.sw, where).toBeLessThanOrEqual(shown.cw)
      expect(shown.h).toBeGreaterThan(def.h)
      // switched off again: the plates go and the heading is where it was
      expect(again.shown).toBe(0)
      expect(again.h).toBe(def.h)
      expect(again.sw).toBeLessThanOrEqual(again.cw)
    })
  }
})

describe.skipIf(!CHROME)('the mode «Текст» shows the anchor as in the file (real Chrome)', () => {
  for (const flag of [false, true]) {
    it(`nota.showAnchors = ${flag}`, { timeout: 280_000 }, async () => {
      const r = await measureTab(900, 'light', 'text', flag)
      expect(r.error).toBeUndefined()
      expect(r.text?.has).toBe(true)
    })
  }
})

// the anchor widget over the first block is the first child of `.doc`; the block under it must keep the rules of the first block (no margin on top)
const headRunner = (text: string, flag: boolean): string => `
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const run = async () => {
  document.body.className = 'vscode-light'
  window.postMessage({ type: 'init', text: ${JSON.stringify(text)}, version: 1, fileName: 'a.adoc', locale: 'ru', fileDir: '/tmp', mode: 'visual', showAnchors: ${JSON.stringify(flag)} }, '*')
  for (let i = 0; i < 50 && !document.querySelector('.ProseMirror h2, .ProseMirror h1, .ProseMirror .tbl'); i++) await sleep(100)
  await sleep(400)
  const h = document.querySelector('.ProseMirror h2, .ProseMirror h1, .ProseMirror .tbl')
  if (!h) throw new Error('the first block is not drawn')
  const doc = document.querySelector('.doc')
  const kids = [...doc.children]
  const under = kids[0] && kids[0].classList.contains('nota-anchor') ? kids[1] : kids[0]
  const a = [...document.querySelectorAll('.nota-anchor')].find((e) => getComputedStyle(e).display !== 'none')
  // the room above the heading: from the top of the page (shown: the plate stands where the heading stood, the heading is under it) (not of .doc: a margin of the first child collapses through it), or from the bottom of the shown plate and its 2 px margin
  const top = a ? a.getBoundingClientRect().bottom + parseFloat(getComputedStyle(a).marginBottom) : 0
  document.title = 'RES ' + JSON.stringify({ width: 0, height: 0, runs: [], gap: h.getBoundingClientRect().top - top, hTop: h.getBoundingClientRect().top, plateH: a ? a.getBoundingClientRect().height + parseFloat(getComputedStyle(a).marginBottom) : 0, under: under === h, firstBlock: document.querySelector('.doc > :first-child:not(.nota-anchor), .doc > .nota-anchor:first-child + *') === h, marginTop: parseFloat(getComputedStyle(h).marginTop), padRight: parseFloat(getComputedStyle(h).paddingRight), kids: kids.slice(0, 3).map((k) => k.tagName + '.' + k.className), anchorFirst: kids[0].classList.contains('nota-anchor'), plate: !!a, plateTop: a ? a.getBoundingClientRect().top : 0 })
}
run().catch((e) => { document.title = 'RES ' + JSON.stringify({ error: String(e && e.stack || e) }) })
`

type Head = Result & { hTop: number; plateH: number; firstBlock: boolean; gap: number; plate: boolean; plateTop: number; under: boolean; marginTop: number; padRight: number; kids?: string[]; anchorFirst: boolean }
const headPair = async (text: string, flag: boolean): Promise<{ bare: Head; anchored: Head }> => {
  // (one after the other: the file holds one slot of Chrome)
  const bare = (await measureTab(900, 'light', 'visual', flag, headRunner(text.replace('[[top]]\n', ''), flag))) as Head
  const anchored = (await measureTab(900, 'light', 'visual', flag, headRunner(text, flag))) as Head
  expect(bare.error).toBeUndefined()
  expect(anchored.error).toBeUndefined()
  return { bare, anchored }
}

describe.skipIf(!CHROME)('the heading under an anchor over the first block is not pushed down (real Chrome)', () => {
  for (const flag of [false, true]) {
    for (const [name, text] of [
      ['== Заголовок', '[[top]]\n== Заголовок\n\nАбзац.\n'],
      ['= Заголовок', '[[top]]\n= Заголовок\n\nАбзац.\n'],
    ] as const) {
      it(`${name}, nota.showAnchors = ${flag}`, { timeout: 280_000 }, async () => {
        const { bare, anchored } = await headPair(text, flag)
        expect(anchored.anchorFirst, JSON.stringify(anchored)).toBe(true)
        expect(anchored.plate).toBe(flag)
        expect(Math.abs(anchored.gap + anchored.plateTop - bare.gap), `anchored ${anchored.gap}, without anchor ${bare.gap}`).toBeLessThanOrEqual(1)
        expect(anchored.marginTop).toBe(bare.marginTop)
        // the selector of `firstGap` in main.ts (e2e-state) takes the block under the anchor
        expect(anchored.firstBlock).toBe(true)
        expect(bare.firstBlock).toBe(true)
      })
    }
  }

  // the header keeps a comment or an attribute entry before the anchor; they are drawn first (an island), the title is not the first block.
  // Its place is that of the title without the anchor, lower by the shown plate only.
  // the plate is hidden (false): one representative, the title does not move at all; shown (true): both, against the `==` title
  for (const flag of [false, true]) {
    for (const [name, text] of [
      ['entry before the anchor', ':toc:\n[[top]]\n= Заголовок\n\nАбзац.\n'],
      ...(flag ? [['comment before the anchor', '// c\n[[top]]\n= Заголовок\n\nАбзац.\n']] : []),
    ] as const) {
      it(`${name}, nota.showAnchors = ${flag}`, { timeout: 280_000 }, async () => {
        const { bare, anchored } = await headPair(text, flag)
        expect(anchored.plate, JSON.stringify(anchored)).toBe(flag)
        expect(anchored.kids?.some((k: string) => k.includes('nota-anchor'))).toBe(true)
        const shift = anchored.hTop - bare.hTop
        // the same lines over `== Заголовок` (a heading that was always an anchor's): the title moves as that one does
        if (flag) {
          const ref = await headPair(text.replace('= Заголовок', '== Заголовок'), flag)
          const refShift = ref.anchored.hTop - ref.bare.hTop
          expect(Math.abs(shift - refShift), `h1 ${shift} px, h2 ${refShift} px`).toBeLessThanOrEqual(1)
        } else expect(Math.abs(shift)).toBeLessThanOrEqual(1)
        expect(anchored.marginTop).toBe(bare.marginTop)
      })
    }
  }

  // the first table stands 44 px lower (the bar of its columns). A table takes no anchor widget (it is the first child itself), so its rule needs no
  // anchor selector: the test fixes that, and that the 44 px stay with `[[top]]` over it.
  it('the first table under `[[top]]` keeps its 44 px, no widget stands before it', { timeout: 280_000 }, async () => {
    const { bare, anchored } = await headPair('[[top]]\n|===\n|a |b\n\n|c |d\n|===\n', false)
    expect(anchored.anchorFirst, JSON.stringify((anchored as { kids?: string[] }).kids)).toBe(false)
    expect(bare.marginTop).toBe(44)
    expect(anchored.marginTop).toBe(44)
  })
})
