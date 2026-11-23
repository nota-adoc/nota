// the blocks of the admonitions (`NOTE:` and `[NOTE]` over `====`), their label and the button of the type do not tremble. Measured in a real Chrome
// (jsdom has no layout) on the real bundle of the tab and its real style sheet, as `color-row-layout.test.ts` does, but in real time and through the
// DevTools protocol: the mouse, the keys and the wheel are the real input of the browser (`:hover` works, the wheel is scrolled by the compositor).
// In every frame (`requestAnimationFrame`) the page writes `getBoundingClientRect` of every row of a box (`.box-adm`), `.adm-head`, `.adm-lbl`, `.adm-para`
// and of the button `.admpick`; the test compares the frames. Set NOTA121_TRACE=1 to print what moved (the table for the comment of the task).
// Skipped, with the reason, where Chrome is not installed.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Readable, Writable } from 'node:stream'
import { beforeAll, describe, expect, it } from 'vitest'
import { CHROME_QUEUE_MS, type ChromeHandle, holdChromeSlot, launchChrome } from './chrome.js'
import { tabBundle } from './bundle.js'

const CHROME = [process.env.CHROME_BIN ?? '', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => p && existsSync(p))

// the wait for a slot of Chrome is not part of a test: the file takes its slot first, and a test holds only its own work
// (the limit of the work is `chromeDump(…, timeout)`, the limit of the wait is `CHROME_QUEUE_MS`)
if (CHROME) beforeAll(() => holdChromeSlot(), CHROME_QUEUE_MS + 10_000)
const here = import.meta.dirname
const at = (path: string): string => join(here, path)
const TRACE = Boolean(process.env.NOTA121_TRACE)

if (!CHROME) console.warn('Chrome is not installed (set CHROME_BIN): the test of the admonitions in a real browser is skipped')

const BEFORE =
  '= Заголовок\n\nАбзац выше первый, с несколькими словами для строки.\n\nАбзац выше второй.\n\n[NOTE]\n====\n' +
  'Абзац примечания со ссылкой https://example.com[на страницу] и ещё словами.\n\n' +
  '. первый пункт нумерованного списка\n. второй пункт нумерованного списка\n\n' +
  '[cols="1,1"]\n|===\n2*|Яч1 |Яч2\n|===\n====\n\n' +
  'WARNING: Внимание, абзац с типом в начале строки.\n\n' +
  '|===\n|Ячейка под блоком |Вторая ячейка\n|===\n\n'
const TAIL = Array.from({ length: 30 }, (_, i) => `Абзац ниже ${i} для прокрутки страницы.\n\n`).join('')
const PLAIN = BEFORE + '== Раздел\n\nТекст раздела.\n\n' + TAIL
/** The same text with a remark of the engine (a section level is skipped) in a block next to the admonition. */
const REMARKED = BEFORE + '==== Заголовок через уровень\n\nТекст раздела.\n\n' + TAIL

const HEIGHT = 600

/** The page: the recorder of frames and the helpers the test calls through the protocol. */
const PAGE_SCRIPT = `
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const SELS = ['.box-adm', '.adm-head', '.adm-lbl', '.adm-para', '.admpick']
const rect = (e) => { const r = e.getBoundingClientRect(); return [r.left, r.top, r.width, r.height] }
window.T = {
  frames: [], on: false,
  snap() {
    const f = {}
    for (const s of SELS) f[s] = [...document.querySelectorAll(s)].map((e) => {
      const c = getComputedStyle(e)
      return { r: rect(e), v: c.visibility === 'visible' && Number(c.opacity) > 0 }
    })
    f['.scroll'] = [{ r: [0, document.querySelector('.scroll').scrollTop, 0, 0], v: true }]
    return f
  },
  // a frame is read as it is drawn: in the callback of a ResizeObserver, which runs after all the callbacks of requestAnimationFrame and the layout of
  // the same frame (an element is resized in every frame to make it run), and before the next frame: a panel that a render of React brings a task later
  // is not in it yet
  start() {
    this.frames = []; this.on = true
    const probe = document.createElement('div')
    probe.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;visibility:hidden;pointer-events:none'
    document.body.append(probe)
    let wide = false
    const tick = () => { if (!this.on) { ro.disconnect(); probe.remove(); return } wide = !wide; probe.style.width = wide ? '2px' : '1px'; requestAnimationFrame(tick) }
    const ro = new ResizeObserver(() => { if (this.on) this.frames.push(this.snap()) })
    ro.observe(probe)
    requestAnimationFrame(tick)
  },
  stop() { this.on = false; return this.frames },
}
window.P = {
  /** The middle of the text of the n-th element of a selector, for a click. */
  at(sel, nth, dx) {
    const e = document.querySelectorAll(sel)[nth]
    if (!e) return null
    let r = e.getBoundingClientRect()
    // (out of the window or under the capsules: the page is scrolled to put it in the middle first)
    if (r.top < 130 || r.bottom > innerHeight - 20) { document.querySelector('.scroll').scrollTop += r.top + r.height / 2 - innerHeight / 2; r = e.getBoundingClientRect() }
    return { x: r.left + (dx ?? Math.min(40, r.width / 2)), y: r.top + r.height / 2 }
  },
  boxes() { return [...document.querySelectorAll('.box-adm')].map((e) => e.className + ' | ' + e.tagName + ' | ' + (e.textContent || '').slice(0, 30)) },
  cursor() { const n = getSelection().anchorNode; const e = n && (n.nodeType === 1 ? n : n.parentElement); return e ? e.closest('.in-box, .adm-para, .nota-island, p, td') ?.className.slice(0, 40) + ' bar=' + Boolean(document.querySelector('.admpick')) : null },
  tag() { const b = document.querySelector('.admpick'); return b ? b.className + ' ' + b.textContent : null },
  scrollTop() { return document.querySelector('.scroll').scrollTop },
  capsules() { const e = document.querySelector('.isle-mid') ; return e ? e.getBoundingClientRect().bottom : 0 },
}
window.open_ = async (text) => {
  document.body.className = 'vscode-dark'
  window.postMessage({ type: 'init', text, version: 1, fileName: 'a.adoc', locale: 'ru', outlineView: 'capsule', fileDir: '/tmp', mode: 'visual' }, '*')
  for (let i = 0; i < 100 && !document.querySelector('.ProseMirror'); i++) await sleep(50)
  await sleep(600)
  return document.querySelectorAll('.box-adm').length
}
`


const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** A page of a real Chrome driven through the DevTools protocol. */
class Tab {
  private out!: Writable
  private n = 0
  private waiting = new Map<number, (v: { result?: unknown; error?: { message: string } }) => void>()
  private session = ''
  private chrome!: ChromeHandle
  private dir = ''

  async open(width: number, text: string): Promise<void> {
    this.dir = mkdtempSync(join(tmpdir(), 'nota-adm-'))
    const css = readFileSync(at('../../../react/src/style.css'), 'utf8') + '\n' + readFileSync(at('../../src/webview/style.css'), 'utf8')
    writeFileSync(join(this.dir, 'webview.js'), await tabBundle())
    writeFileSync(join(this.dir, 'style.css'), css)
    writeFileSync(
      join(this.dir, 'p.html'),
      `<!doctype html><html lang="ru"><head><meta charset="utf-8"><link rel="stylesheet" href="style.css"><style>html,body{margin:0}#app{width:${width}px;overflow:hidden}</style></head><body class="vscode-dark" data-nota-theme="dark"><div id="app" class="nota" data-mermaid=""></div>
<script>window.acquireVsCodeApi=()=>({postMessage(){},getState:()=>null,setState(){}})</script>
<script src="webview.js"></script><script>${PAGE_SCRIPT}</script></body></html>`,
    )
    // the DevTools protocol over a pipe (fd 3 to Chrome, fd 4 from it, messages end with NUL): no socket and no library
    this.chrome = await launchChrome({ chrome: CHROME!, prefix: 'adm', args: ['--headless=new', '--disable-gpu', '--allow-file-access-from-files', '--no-first-run', '--remote-debugging-pipe', `--window-size=${Math.max(Math.ceil(width), 600)},${HEIGHT}`, 'about:blank'] })
    this.out = this.chrome.proc.stdio[3] as Writable
    let buf = ''
    ;(this.chrome.proc.stdio[4] as Readable).setEncoding('utf8').on('data', (chunk: string) => {
      buf += chunk
      for (let k = buf.indexOf('\0'); k >= 0; k = buf.indexOf('\0')) {
        const d = JSON.parse(buf.slice(0, k)) as { id?: number; result?: unknown; error?: { message: string } }
        buf = buf.slice(k + 1)
        if (d.id !== undefined) this.waiting.get(d.id)?.(d)
      }
    })
    const { targetId } = (await this.send('Target.createTarget', { url: `file://${join(this.dir, 'p.html')}` })) as { targetId: string }
    this.session = ((await this.send('Target.attachToTarget', { targetId, flatten: true })) as { sessionId: string }).sessionId
    await this.send('Emulation.setDeviceMetricsOverride', { width: Math.max(Math.ceil(width), 600), height: HEIGHT, deviceScaleFactor: 1, mobile: false })
    for (let i = 0; i < 100; i++) {
      if ((await this.ev('typeof window.open_')) === 'function') break
      await wait(100)
    }
    await this.ev(`window.open_(${JSON.stringify(text)})`)
  }

  send(method: string, params: object = {}): Promise<unknown> {
    const id = ++this.n
    return new Promise((res, rej) => {
      this.waiting.set(id, (d) => (d.error ? rej(new Error(`${method}: ${d.error.message}`)) : res(d.result)))
      this.out.write(JSON.stringify({ id, method, params, ...(this.session && method.indexOf('Target.') !== 0 ? { sessionId: this.session } : {}) }) + '\0')
    })
  }

  async ev<T = unknown>(expression: string): Promise<T> {
    const r = (await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })) as { result: { value: T }; exceptionDetails?: { exception?: { description?: string } } }
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'page error')
    return r.result.value
  }

  mouse(x: number, y: number, type = 'mouseMoved', extra: object = {}): Promise<unknown> {
    return this.send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', clickCount: type === 'mouseMoved' ? 0 : 1, ...extra })
  }

  async click(x: number, y: number): Promise<void> {
    await this.mouse(x, y)
    await this.mouse(x, y, 'mousePressed')
    await this.mouse(x, y, 'mouseReleased')
  }

  async key(key: string, code: number, text?: string): Promise<void> {
    await this.send('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', key, windowsVirtualKeyCode: code, code: key, ...(text ? { text } : {}) })
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key, windowsVirtualKeyCode: code, code: key })
  }

  async close(): Promise<void> {
    await this.chrome?.close()
    // (a loaded Mac: Chrome is still writing its profile; the files are removed again, and a folder that stays in /tmp is not a failure of the test)
    try {
      rmSync(this.dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
    } catch {
      /* the temporary folder stays */
    }
  }
}

type Rect = [number, number, number, number]
interface Item {
  r: Rect
  v: boolean
}
type Frame = Record<string, Item[]>

/** Frames of one action: the page records them while `act` runs and a little after. */
async function trace(tab: Tab, act: () => Promise<void>, after = 250): Promise<Frame[]> {
  await tab.ev('window.T.start()')
  await wait(60)
  await act()
  await wait(after)
  return tab.ev<Frame[]>('window.T.stop()')
}

interface Move {
  what: string
  frame: number
  d: string
  n?: number[]
}
/** What moved from a frame to the next one, row by row (all four numbers of the rectangle; `moved` only for the visible ones). */
function moves(frames: Frame[], sels: string[]): Move[] {
  const out: Move[] = []
  for (let i = 1; i < frames.length; i++) {
    for (const s of sels) {
      const a = frames[i - 1]![s] ?? []
      const b = frames[i]![s] ?? []
      if (a.length !== b.length) {
        // (the button goes with the cursor out of the block and comes back: that is not a move; where it stands is checked by the caller)
        if (s === '.admpick') continue
        out.push({ what: s, frame: i, d: `count ${a.length} -> ${b.length}` })
        continue
      }
      // (the rows of the document move with the scroll of the page: they are compared in the coordinates of the page, the button is not)
      const sa = s === '.admpick' ? 0 : frames[i - 1]!['.scroll']![0]!.r[1]
      const sb = s === '.admpick' ? 0 : frames[i]!['.scroll']![0]!.r[1]
      b.forEach((x, k) => {
        const y = a[k]!
        if (!x.v || !y.v) return
        const d = x.r.map((v, j) => v - y.r[j]! + (j === 1 ? sb - sa : 0))
        if (d.some((v) => v !== 0)) out.push({ what: `${s}#${k}`, frame: i, d: `left ${d[0]!.toFixed(2)} top ${d[1]!.toFixed(2)} width ${d[2]!.toFixed(2)} height ${d[3]!.toFixed(2)}`, n: d })
      })
    }
  }
  return out
}

/** The moves of one element in a row of frames, as one line: how many frames, the sum of each number, the first frame. */
function sum(list: Move[], label: string): string[] {
  const by = new Map<string, Move[]>()
  for (const m of list) by.set(m.what, [...(by.get(m.what) ?? []), m])
  return [...by].map(([what, ms]) => {
    const t = [0, 0, 0, 0]
    for (const m of ms) m.n?.forEach((v, j) => (t[j]! += v))
    return ms.length === 1 && !ms[0]!.n ? `${label}: ${what} @${ms[0]!.frame} ${ms[0]!.d}` : `${label}: ${what} ${ms.length} кадров с @${ms[0]!.frame}, сумма left ${t[0]!.toFixed(1)} top ${t[1]!.toFixed(1)} width ${t[2]!.toFixed(1)} height ${t[3]!.toFixed(1)}`
  })
}

/** The button against the head of the block, in every frame where both are visible: [left, top] differences. */
function barToHead(frames: Frame[]): [number, number][] {
  const out: [number, number][] = []
  for (const f of frames) {
    const bar = f['.admpick']?.[0]
    const head = f['.adm-head']?.[0] ?? f['.adm-lbl']?.[0]
    if (bar?.v && head) out.push([bar.r[0] - head.r[0], bar.r[1] - head.r[1]])
  }
  return out
}

const BLOCK = ['.box-adm', '.adm-head', '.adm-lbl', '.adm-para']
const report: string[] = []
const note = (width: number, scenario: string, found: string[]): void => {
  report.push(`${width}px | ${scenario} | ${found.length ? found.slice(0, 6).join('; ') + (found.length > 6 ? `; … (${found.length})` : '') : 'не дрожит'}`)
}

describe.skipIf(!CHROME)('the admonitions and the button of the type do not tremble (real Chrome)', () => {
  for (const width of [700, 1000.5, 1280]) {
    it(`a tab of ${width} px`, { timeout: 300_000 }, async () => {
      const tab = new Tab()
      try {
        await tab.open(width, PLAIN)
        const boxes = await tab.ev<string[]>('window.P.boxes()')
        expect(boxes.length, boxes.join('\n')).toBeGreaterThan(3)
        if (TRACE) console.log(boxes.join('\n'))
        const point = async (sel: string, nth: number, dx?: number): Promise<{ x: number; y: number }> => {
          const p = await tab.ev<{ x: number; y: number } | null>(`window.P.at(${JSON.stringify(sel)}, ${nth}, ${dx ?? 'undefined'})`)
          if (!p) throw new Error(`no ${sel} #${nth}`)
          return p
        }
        // the cursor is in the first line of the block (a click): the button shows
        await tab.ev(`document.querySelector('.scroll').scrollTop = 0`)
        const first = await point('.box-adm', 1, 90)
        await tab.click(first.x, first.y)
        await wait(400)
        expect(await tab.ev('window.P.tag()'), 'the button of the type shows with the cursor in the block').toBeTruthy()

        // the mouse over every row of the block, the button and the islands
        {
          const found: string[] = []
          const n = await tab.ev<number>(`document.querySelectorAll('.box-adm').length`)
          const targets = [...Array.from({ length: n }, (_, i) => ['.box-adm', i] as const), ['.admpick', 0] as const, ['.nota-island', 0] as const, ['.adm-para', 0] as const]
          for (const [sel, nth] of targets) {
            const p = await tab.ev<{ x: number; y: number } | null>(`window.P.at(${JSON.stringify(sel)}, ${nth}, 6)`)
            if (!p) continue
            const fr = await trace(tab, async () => {
              await tab.mouse(p.x, p.y)
              await wait(150)
              await tab.mouse(2, HEIGHT - 2)
            })
            found.push(...sum(moves(fr, [...BLOCK, '.admpick']), `hover ${sel}#${nth}`))
          }
          note(width, 'наведение (строки, кнопка, островок)', found)
          expect.soft(found, 'hover').toEqual([])
        }

        // the arrows over every row of the block there and back (through the islands), the click into WARNING:
        {
          const found: string[] = []
          const rel: Set<string> = new Set()
          const fr = await trace(
            tab,
            async () => {
              for (let i = 0; i < 3; i++) {
                await tab.key('ArrowDown', 40)
                await wait(120)
                if (TRACE) console.log('down', i, await tab.ev('window.P.cursor()'))
              }
              // from the island back into the list by the mouse, up to the paragraph by the arrows, and down and up again once more
              const li = await point('.li-text', 1, 60)
              await tab.click(li.x, li.y)
              await wait(150)
              for (const [k, code] of [['ArrowUp', 38], ['ArrowUp', 38], ['ArrowDown', 40], ['ArrowDown', 40], ['ArrowDown', 40], ['ArrowUp', 38]] as const) {
                await tab.key(k, code)
                await wait(120)
                if (TRACE) console.log(k, await tab.ev('window.P.cursor()'))
              }
            },
            400,
          )
          found.push(...sum(moves(fr, [...BLOCK, '.admpick']), 'arrows'))
          for (const [l, t] of barToHead(fr)) rel.add(`${l.toFixed(2)},${t.toFixed(2)}`)
          // in every frame where the button is seen it is of one size and at one place against the head of the block
          const sizes = new Set(fr.filter((f) => f['.admpick']?.[0]?.v).map((f) => f['.admpick']![0]!.r.slice(2).join('x')))
          if (rel.size > 1) found.push(`the button against the head: ${[...rel].join(' | ')}`)
          if (sizes.size > 1) found.push(`the button of different sizes: ${[...sizes].join(' | ')}`)
          note(width, 'стрелки по строкам, островок, возврат щелчком', found)
          expect.soft(found, 'arrows').toEqual([])
        }

        // the click into WARNING: (another block: the button goes there)
        {
          const found: string[] = []
          const fr = await trace(tab, async () => {
            const w = await point('.adm-para', 0, 90)
            await tab.click(w.x, w.y)
          })
          found.push(...sum(moves(fr, BLOCK), 'click WARNING:'))
          note(width, 'щелчок в WARNING: (строки, не кнопка)', found)
          expect.soft(found, 'click').toEqual([])
          const p = await point('.box-adm', 1, 90)
          await tab.click(p.x, p.y)
          await wait(300)
        }

        // the place of the button against the head does not depend on the row of the cursor
        {
          const places = new Set<string>()
          for (const [sel, nth] of [['.box-adm', 0], ['.li-text', 0], ['.li-text', 1], ['.box-adm', 1]] as const) {
            const p = await point(sel, nth, 60)
            await tab.click(p.x, p.y)
            await wait(400)
            const fr = await trace(tab, async () => {}, 120)
            for (const [l, t] of barToHead(fr.slice(-3))) places.add(`${l.toFixed(2)},${t.toFixed(2)}`)
            if (TRACE) console.log('picker', sel, nth, JSON.stringify(fr[fr.length - 1]!['.admpick']), JSON.stringify(fr[fr.length - 1]!['.adm-head']), await tab.ev('window.P.cursor()'))
          }
          note(width, 'кнопка против .adm-head из трёх строк', places.size > 1 ? [`разные места: ${[...places].join(' | ')}`] : [])
          expect.soft([...places].length, `${[...places].join(' | ')}`).toBeLessThanOrEqual(1)
        }

        // typing and Enter/Backspace above the block and in the cell under it; the block moves once, by the height added, and does not change inside
        for (const [label, sel, nth] of [['над блоком', '.ProseMirror > p', 1], ['в ячейке под блоком', 'td .cell-text', 0]] as const) {
          const found: string[] = []
          const p = await point(sel, nth, 20)
          await tab.click(p.x, p.y)
          await wait(300)
          await tab.key('End', 35)
          const fr = await trace(
            tab,
            async () => {
              for (const ch of 'аб') {
                await tab.key(ch, ch.charCodeAt(0), ch)
                await wait(60)
              }
              if (sel !== 'td .cell-text') {
                await tab.key('Enter', 13, '\r')
                await wait(150)
                await tab.key('Backspace', 8)
              }
              await wait(60)
              await tab.key('Backspace', 8)
              await tab.key('Backspace', 8)
            },
            300,
          )
          // inside the block nothing moves against its first row; the whole block moves only by whole steps of the height above
          const rowsOf = (f: Frame): Rect[] => (f['.box-adm'] ?? []).map((x) => x.r)
          for (let i = 1; i < fr.length; i++) {
            const a = rowsOf(fr[i - 1]!)
            const b = rowsOf(fr[i]!)
            if (a.length !== b.length) {
              found.push(`@${i}: rows of the block ${a.length} -> ${b.length}`)
              continue
            }
            const rel = (rows: Rect[]): string => rows.map((r) => `${(r[0] - rows[0]![0]).toFixed(2)},${(r[1] - rows[0]![1]).toFixed(2)},${r[2].toFixed(2)},${r[3].toFixed(2)}`).join(' ')
            if (rel(a) !== rel(b)) found.push(`@${i}: inside of the block ${rel(a)} -> ${rel(b)}`)
          }
          const moved = new Set<number>()
          fr.forEach((f, i) => {
            if (i && f['.box-adm']?.[0] && fr[i - 1]!['.box-adm']?.[0] && f['.box-adm'][0]!.r[1] !== fr[i - 1]!['.box-adm']![0]!.r[1]) moved.add(i)
          })
          // the block moves once by the whole change of the height above it (Enter), and once back (Backspace): the steps are of one size, there is no half step
          // between, and what it went up comes back down (the height of a table below changes nothing in the block)
          const steps = [...moved].map((i) => fr[i]!['.box-adm']![0]!.r[1] - fr[i - 1]!['.box-adm']![0]!.r[1])
          const sizes = new Set(steps.map((d) => Math.abs(d).toFixed(1)))
          if (sizes.size > 1) found.push(`the block moved by steps of different sizes: ${steps.map((d) => d.toFixed(2)).join(' ')}`)
          if (Math.abs(steps.reduce((a, d) => a + d, 0)) > 0.5) found.push(`the block did not come back: ${steps.map((d) => d.toFixed(2)).join(' ')}`)
          if (label.includes('над') && moved.size === 0) found.push('the block did not move when the line above it was added: the check proves nothing')
          if (TRACE) console.log(label, 'steps', steps.join(' '))
          const bars = barToHead(fr)
          const tops = new Set(fr.map((f) => f['.box-adm']?.[0]?.r[1]))
          const text = await tab.ev<string>(`[...document.querySelectorAll('.ProseMirror > p, td .cell-text')].map((e) => e.textContent).slice(0, 4).join(' / ')`)
          if (TRACE) console.log(label, 'tops', [...tops].join(','), 'bars', bars.length, text)
          const set = new Set(bars.map(([l, t]) => `${l.toFixed(2)},${t.toFixed(2)}`))
          if (set.size > 1) found.push(`the button against the head: ${[...set].join(' | ')}`)
          note(width, `набор, Enter, Backspace ${label} (блок сдвинулся в ${moved.size} кадрах)`, found)
          expect.soft(found, label).toEqual([])
        }

        // a remark of the engine appears and goes in the block next to the admonition
        {
          const found: string[] = []
          const fr = await trace(
            tab,
            async () => {
              await tab.ev(`window.postMessage({ type: 'reset', text: ${JSON.stringify(REMARKED)}, version: 2, stale: false }, '*')`)
              await wait(500)
              await tab.ev(`window.postMessage({ type: 'reset', text: ${JSON.stringify(PLAIN)}, version: 3, stale: false }, '*')`)
            },
            500,
          )
          found.push(...sum(moves(fr, BLOCK), 'remark'))
          note(width, 'замечание движка появилось и ушло (текст от хозяина)', found)
          expect.soft(found, 'remark').toEqual([])
        }

        // the wheel by 3 and by 40 px, the cursor in the block: the button keeps its place against the head, and hides with the block under the capsules
        for (const dy of [3, 40]) {
          const found: string[] = []
          // (3 px steps are many: the block must go under the capsules by its head, and then wholly)
          const steps = dy === 3 ? 160 : 20
          const p = await point('.box-adm', 1, 90)
          await tab.click(p.x, p.y)
          await wait(400)
          // (a point that stays in the page while it goes up: over the first paragraph the wheel would hit the row of capsules, which does not scroll)
          const wheel = { x: (await point('.ProseMirror > p', 0, 100)).x, y: HEIGHT - 100 }
          await tab.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: wheel.x, y: wheel.y })
          const fr = await trace(
            tab,
            async () => {
              for (let i = 0; i < steps; i++) {
                await tab.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: wheel.x, y: wheel.y, deltaX: 0, deltaY: dy })
                await wait(32)
              }
            },
            300,
          )
          // the head of the block the button belongs to: the nearest one. While the block is under the capsules by its head only, the button stays under them
          // (as the handle does); the difference is constant in the frames where it stands free
          const heads = (f: Frame) => f['.adm-head'] ?? []
          const own = (f: Frame) => { const b = f['.admpick']?.[0]; return b ? heads(f).reduce<(typeof b) | undefined>((m, h) => (!m || Math.abs(h.r[1] - b.r[1]) < Math.abs(m.r[1] - b.r[1]) ? h : m), undefined) : undefined }
          const cap = await tab.ev<number>('window.P.capsules()')
          const free = fr.filter((f) => f['.admpick']?.[0]?.v && own(f) && own(f)!.r[1] > cap + 8)
          const diffs = free.map((f) => (f['.admpick']![0]!.r[1] - own(f)!.r[1]).toFixed(2))
          if (new Set(diffs).size > 1) found.push(`button vs head top: ${[...new Set(diffs)].slice(0, 6).join(' ')} (${free.length} frames)`)
          // the box the button stands in: the last that begins over it. Visible while that box is under the capsules entirely: the button goes by the text
          const lost = fr.filter((f) => {
            const b = f['.admpick']?.[0]
            if (!b?.v) return false
            const own = (f['.box-adm'] ?? []).filter((x) => x.r[1] <= b.r[1] + 6).pop()
            return !own || own.r[1] + own.r[3] < cap - 1
          })
          const reached = fr.filter((f) => (f['.box-adm'] ?? []).some((x) => x.r[1] + x.r[3] < cap - 1)).length
          const hidden = fr.filter((f) => !f['.admpick']?.[0]?.v).length
          if (TRACE) console.log('scroll', dy, 'cap', cap, 'frames', fr.length, 'free', free.length, 'blocks under the capsules in', reached, 'button hidden in', hidden)
          // (the scroll must have taken the block of the cursor under the capsules, or the check proves nothing)
          // (the button is visible only while its own top is below the capsules: it stands 2 px over the word, or 4 px under the box when there is no word, so
          // the head may be up to 4 px over the line; the rest is a button pressed to the capsules; the head under them with the bottom still in sight must hide it)
          // the word of its own block: the one whose middle is the nearest to the middle of the button (the layer is centred on its label)
          const word = (f: Frame) => {
            const b = f['.admpick']![0]!
            const mid = b.r[1] + b.r[3] / 2
            return (f['.adm-lbl'] ?? []).reduce<((typeof b) | undefined)>((m, h) => (!m || Math.abs(h.r[1] + h.r[3] / 2 - mid) < Math.abs(m.r[1] + m.r[3] / 2 - mid) ? h : m), undefined)
          }
          const pressed = fr.filter((f) => f['.admpick']?.[0]?.v && word(f) && word(f)!.r[1] < cap - 3)
          if (TRACE && pressed.length) console.log('pressed', pressed.slice(0, 4).map((f) => `bar ${f['.admpick']![0]!.r[1]} word ${word(f)!.r[1]} heads ${heads(f).map((h) => h.r[1]).join(',')} boxes ${(f['.box-adm'] ?? []).map((h) => `${h.r[1]}+${h.r[3]}`).join(',')}`).join(' | '))
          if (pressed.length) found.push(`button visible while the head of its block is under the capsules in ${pressed.length} frames`)
          const headUnder = fr.filter((f) => !f['.admpick']?.[0]?.v && heads(f).some((h) => h.r[1] < cap - 1) && (f['.box-adm'] ?? []).some((x) => x.r[1] < cap - 1 && x.r[1] + x.r[3] > cap + 1)).length
          if (TRACE) console.log('head under the capsules, bottom in sight, hidden in', headUnder)
          if (hidden === 0 || free.length === 0 || headUnder === 0) found.push(`the scroll did not go through all states (${dy} px): free ${free.length}, hidden ${hidden}, head under ${headUnder}`)
          if (lost.length) found.push(`button visible while its block is under the capsules in ${lost.length} frames`)
          note(width, `прокрутка колесом по ${dy} px × ${steps}`, found)
          expect.soft(found, `wheel ${dy}`).toEqual([])
          await tab.ev(`document.querySelector('.scroll').scrollTop = 0`)
          await wait(200)
        }

        // the layout above the block shifts with no transaction: the button stands against the head in the next frame
        {
          const found: string[] = []
          const p = await point('.box-adm', 1, 90)
          await tab.click(p.x, p.y)
          await wait(400)
          const fr = await trace(
            tab,
            async () => {
              await tab.ev(`(() => { const e = document.querySelector('.ProseMirror'); e.style.paddingTop = '37px' })()`)
              await wait(300)
              await tab.ev(`(() => { const e = document.querySelector('.ProseMirror'); e.style.paddingTop = '' })()`)
            },
            300,
          )
          const rows = fr.map((f) => {
            const bar = f['.admpick']?.[0]
            const head = f['.adm-head']?.[0] ?? f['.adm-lbl']?.[0]
            return bar?.v && head ? bar.r[1] - head.r[1] : null
          })
          if (TRACE) console.log('layout rows', rows.filter((v) => v !== null).length, 'of', fr.length, 'heads', [...new Set(fr.map((f) => f['.adm-head']?.[0]?.r[1]))].join(','), 'bars', [...new Set(fr.map((f) => f['.admpick']?.[0]?.r[1]))].join(','))
          const off = rows.filter((v) => v !== null && Math.abs(v - (rows.find((x) => x !== null) ?? 0)) > 0.5)
          if (off.length) found.push(`the button off the head in ${off.length} frames: ${off.slice(0, 4).join(' ')}`)
          note(width, 'раскладка выше сдвинулась без транзакции', found)
          expect.soft(found, 'layout').toEqual([])
        }
      } finally {
        await tab.close()
        if (TRACE) console.log(report.join('\n'))
      }
    })
  }
})

// a real document (NOTA121_FILE=path to an .adoc, it does not go into the repository): the cursor in the first admonition, 30 s of arrows, hovers, wheel and
// typing above the block; the frames of the block and of the button are traced, the sum of the moves is printed. The moves of the block by the typing above
// (whole steps of the height) are not the tremble: they are told apart by the size of the step.
const FILE = process.env.NOTA121_FILE
describe.skipIf(!CHROME || !FILE)('the document of the owner', () => {
  it('30 s of the cursor in the admonition', { timeout: 600_000 }, async () => {
    const tab = new Tab()
    try {
      await tab.open(1000, readFileSync(FILE!, 'utf8'))
      const boxes = await tab.ev<string[]>('window.P.boxes()')
      console.log('boxes', boxes.length, boxes.join(' || '))
      const p = await tab.ev<{ x: number; y: number }>(`window.P.at('.box-adm', 0, 90)`)
      await tab.click(p.x, p.y)
      await wait(500)
      const bar = await tab.ev('window.P.tag()')
      console.log('bar', bar, 'cursor', await tab.ev('window.P.cursor()'))
      const start = Date.now()
      const fr = await trace(
        tab,
        async () => {
          for (let round = 0; Date.now() - start < 30_000; round++) {
            for (const [k, code] of [['ArrowDown', 40], ['ArrowDown', 40], ['ArrowDown', 40], ['ArrowUp', 38], ['ArrowUp', 38], ['ArrowUp', 38]] as const) {
              await tab.key(k, code)
              await wait(150)
            }
            const h = await tab.ev<{ x: number; y: number } | null>(`window.P.at('.box-adm', 0, 6)`)
            if (h) {
              await tab.mouse(h.x, h.y)
              await wait(150)
              await tab.mouse(2, HEIGHT - 2)
            }
            for (let i = 0; i < 4; i++) {
              await tab.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 500, y: HEIGHT - 100, deltaX: 0, deltaY: round % 2 ? -40 : 40 })
              await wait(32)
            }
          }
        },
        400,
      )
      // (the button is in the coordinates of the window and goes with the wheel: against the head of the block it is compared below)
      const sel = BLOCK
      const list = moves(fr, sel)
      console.log('frames', fr.length, 'moves', list.length)
      console.log(sum(list, 'shake').join('\n') || 'не дрожит')
      const rel = new Set(barToHead(fr).map(([l, t]) => `${l.toFixed(2)},${t.toFixed(2)}`))
      console.log('button vs head', [...rel].slice(0, 8).join(' | '))
      const free = fr.filter((f) => f['.admpick']?.[0]?.v).length
      console.log('frames with the button', free, 'hidden', fr.length - free)
      expect.soft(list.map((m) => `${m.what} ${m.d}`)).toEqual([])
      // typing above the block (with the cursor in it before): the block goes down by whole steps, the button with it
      await tab.click(p.x, p.y)
      await wait(300)
      // (the last paragraph over the block: over the first one stands the header of the page, which opens in the source with the cursor)
      const above = await tab.ev<{ x: number; y: number } | null>(`(() => { const b = document.querySelector('.box-adm').getBoundingClientRect().top; const ps = [...document.querySelectorAll('.ProseMirror > p')].filter((e) => e.getBoundingClientRect().bottom < b); const e = ps[ps.length - 1]; if (!e) return null; document.querySelector('.scroll').scrollTop += e.getBoundingClientRect().top - 300; const r = e.getBoundingClientRect(); return { x: r.left + 20, y: r.top + r.height / 2 } })()`)
      if (above) {
        await tab.click(above.x, above.y)
        const ft = await trace(
          tab,
          async () => {
            await tab.key('End', 35)
            await tab.key('Enter', 13, '\r')
            await wait(150)
            await tab.key('Backspace', 8)
            await wait(150)
          },
          300,
        )
        const sm = moves(ft, BLOCK)
        console.log('steps of the first box:', sm.filter((m) => m.what === '.box-adm#0').map((m) => `@${m.frame} ${m.d}`).join(' | '), 'scroll', [...new Set(ft.map((f) => f['.scroll']![0]!.r[1]))].join(','), 'boxes tops', ft.map((f) => Math.round(f['.box-adm']![0]!.r[1])).filter((v, i, a) => a.indexOf(v) === i).join(','))
        console.log('typing above:', sum(sm, 'набор').join('\n') || 'блок не сдвинулся', '| button vs head', [...new Set(barToHead(ft).map(([l, t]) => `${l.toFixed(2)},${t.toFixed(2)}`))].join(' | '))
      }
    } finally {
      await tab.close()
    }
  })
})
