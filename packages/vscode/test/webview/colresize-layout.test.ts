// a border between two columns goes where the mouse pulls it. Measured in a real Chrome (jsdom has no layout) on the real bundle of the tab and its
// real style sheet: the mouse goes over a table, is pressed on the strip of the middle border (`.nota-grips .bd`), moves to the right by steps of 5 px up to +40 px
// (and far to either side at the stop), is let go. For each case the page tells where the border was before the press, after every step and after the release, the
// widths of the columns, the width of the table and of its frame, and what was written in `cols`. Skipped where Chrome is not installed. The numbers are
// printed (`NOTA_REPORT=1`) for a report.
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

// ---------------------------------------------------------------- the tables (made up)

const row = (cells: string[]): string => cells.map((c) => `|${c}`).join(' ') + '\n'
const WORDS = ['Заявление', 'Маршрут', 'Каталог', 'Склады', 'Остаток', 'Комплектность', 'Комментарий', 'Статус', 'Ответственный']

/** A big table of 9 columns without percents, a long head (made up). */
function big(rows: number): string {
  const head = WORDS.map((w, k) => `${w} складов по реестру ${k + 1}`)
  let t = '= Тест\n\n[%header,cols="9"]\n|===\n' + row(head) + '\n'
  for (let r = 0; r < rows; r++) t += row(WORDS.map((w, k) => `${w} ${r}-${k} значение`)) + '\n'
  return t + '|===\n'
}
/** A small table of 9 columns without percents, a short head: it fits in a tab of 700 px. */
function small(): string {
  let t = '= Тест\n\n[%header,cols="9"]\n|===\n' + row(['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9']) + '\n'
  for (let r = 0; r < 10; r++) t += row(['а', 'б', 'в', 'г', 'д', 'е', 'ж', 'з', 'и']) + '\n'
  return t + '|===\n'
}
function plain(cols: string | null, n: number): string {
  const attrs = cols ? `[%header,cols="${cols}"]` : '[%header]'
  let t = `= Тест\n\n${attrs}\n|===\n` + row(Array.from({ length: n }, (_, k) => `Колонка ${k + 1}`)) + '\n'
  for (let r = 0; r < 6; r++) t += row(Array.from({ length: n }, (_, k) => `Ячейка ${r}-${k}`)) + '\n'
  return t + '|===\n'
}

interface Case {
  id: string
  text: string
  /** The border (the index of the column at its right). */
  border: number
  /** The frame of the table is scrolled sideways so that the border is in the middle of it (only where the table is wider than the frame). */
  scroll: boolean
  /** The shifts of the mouse from the press, one step each. Empty: no drag, the table is only measured. */
  dxs: number[]
}

const RIGHT40 = [5, 10, 15, 20, 25, 30, 35, 40]
const steps = (to: number, by: number): number[] => Array.from({ length: Math.abs(to) / by }, (_, k) => Math.sign(to) * by * (k + 1))

function casesFor(width: number): Case[] {
  const list: Case[] = [
    { id: 'a', text: big(150), border: 4, scroll: false, dxs: RIGHT40 },
    { id: 'a+scroll', text: big(150), border: 4, scroll: true, dxs: RIGHT40 },
    { id: 'b3', text: plain(null, 3), border: 1, scroll: false, dxs: RIGHT40 },
    { id: 'b4', text: plain('20,30,30,20', 4), border: 2, scroll: false, dxs: RIGHT40 },
  ]
  if (width >= 700) list.push({ id: 'c', text: small(), border: 4, scroll: false, dxs: RIGHT40 })
  if (width === 1280) {
    list.push({ id: 'b4-stop-right', text: plain('20,30,30,20', 4), border: 2, scroll: false, dxs: steps(600, 20) })
    list.push({ id: 'b4-stop-left', text: plain('20,30,30,20', 4), border: 2, scroll: false, dxs: steps(-600, 20) })
  }
  if (width === 390) {
    // (every column at its least width: 9 × 64 px = 576 px in a frame of 340)
    list.push({ id: 'm', text: small(), border: 4, scroll: false, dxs: RIGHT40 })
    list.push({ id: 'm-stop-right', text: small(), border: 4, scroll: false, dxs: steps(600, 20) })
    list.push({ id: 'a-stop-right', text: big(150), border: 4, scroll: false, dxs: steps(600, 20) })
    // (a column of 1%: the table does not grow to 6400 px; a refused write leaves the table as it was)
    list.push({ id: 'cap', text: plain('1,13,13,13,15,15,15,15', 8), border: 4, scroll: false, dxs: [] })
    list.push({ id: 'refused', text: big(150).replace('cols="9"', 'cols="{cw}"'), border: 4, scroll: false, dxs: RIGHT40 })
  }
  if (width >= 700) {
    list.push({ id: 'k8-5-95', text: plain('5,95', 2), border: 1, scroll: false, dxs: [] })
    list.push({ id: 'k8-b4', text: plain('20,30,30,20', 4), border: 2, scroll: false, dxs: [] })
  }
  // (NOTA_ONLY=<id>: one case, for a look at the numbers)
  return process.env.NOTA_ONLY ? list.filter((c) => c.id === process.env.NOTA_ONLY) : list
}

// ---------------------------------------------------------------- the page

const runner = (cases: Case[]): string => `
const CASES = ${JSON.stringify(cases)}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const msgs = window.__msgs
let version = 0
const open = async (text) => {
  window.postMessage({ type: 'init', text, version: ++version, fileName: 'a.adoc', locale: 'ru', outlineView: 'capsule', fileDir: '/tmp', mode: 'visual' }, '*')
  await sleep(300)
  for (let i = 0; i < 50 && !document.querySelector('.tbl td'); i++) await sleep(100)
  await sleep(500)
}
const rc = (e) => e.getBoundingClientRect()
const parts = (i) => {
  const tbl = document.querySelector('.tbl')
  const sc = tbl.querySelector(':scope > .tbl-scroll')
  const table = sc.querySelector(':scope > table')
  return { tbl, sc, table, cells: [...table.querySelector('tbody > tr').children] }
}
const snap = (i) => {
  const { sc, table, cells } = parts(i)
  const bd = document.querySelector('.nota-grips .bd.live')
  const tag = document.querySelector('.nota-grips .wtag')
  const ov = bd ? rc(bd) : null
  return {
    ov: ov ? ov.left + ov.width / 2 : null, real: rc(cells[i]).left, left: rc(cells[i - 1]).width, right: rc(cells[i]).width,
    tw: rc(table).width, tl: rc(table).left, sw: sc.scrollWidth, cw: sc.clientWidth, sl: sc.scrollLeft,
    tag: tag && !tag.hidden ? tag.textContent : '', lim: tag ? tag.classList.contains('limit') : false, blim: bd ? bd.classList.contains('limit') : false,
  }
}
const applied = (text) => {
  for (const m of msgs.filter((m) => m.type === 'edit')) {
    for (const c of [...m.changes].sort((a, b) => b.from - a.from)) text = text.slice(0, c.from) + c.insert + text.slice(c.to)
  }
  return text
}
const run = async () => {
  const out = { width: innerWidth, cases: {} }
  for (const c of CASES) {
    const r = { id: c.id }
    out.cases[c.id] = r
    await open(c.text)
    msgs.length = 0
    let i = c.border
    const { sc, cells } = parts(i)
    r.cols0 = (/cols="([^"]*)"/.exec(c.text) || [])[1] || ''
    r.wider = sc.scrollWidth > sc.clientWidth + 1
    if (c.scroll && !r.wider) { r.skipped = true; continue }
    // (not scrolled: the border in the middle of the table may be out of the frame; then the last one that is in it)
    if (!c.scroll) while (i > 1 && !(rc(cells[i]).left > rc(sc).left + 8 && rc(cells[i]).left < rc(sc).right - 8)) i--
    r.border = i
    if (c.scroll) {
      sc.scrollLeft = Math.max(0, rc(cells[i]).left - rc(sc).left + sc.scrollLeft - sc.clientWidth / 2)
      await sleep(200)
    }
    const hy = rc(parts(i).cells[0]).top + 30
    document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: rc(sc).left + 30, clientY: hy, buttons: 0 }))
    await sleep(300)
    r.before = snap(i)
    if (c.dxs.length === 0) continue
    const strips = [...document.querySelectorAll('.nota-grips .bd')]
    const strip = strips.map((s) => ({ s, d: Math.abs(rc(s).left + rc(s).width / 2 - r.before.real) })).sort((a, b) => a.d - b.d)[0]
    if (!strip || strip.d > 3) { r.error = 'no strip at the border (' + strips.length + ' strips)'; continue }
    const x0 = rc(strip.s).left + rc(strip.s).width / 2
    r.x0 = x0
    strip.s.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: x0, clientY: hy, button: 0, buttons: 1, detail: 1 }))
    r.pressed = snap(i)
    r.steps = []
    for (const dx of c.dxs) {
      document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: x0 + dx, clientY: hy, buttons: 1 }))
      await sleep(40)
      r.steps.push({ dx, ...snap(i) })
    }
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: x0 + c.dxs[c.dxs.length - 1], clientY: hy }))
    await sleep(800)
    r.after = snap(i)
    const text = applied(c.text)
    r.cols1 = (/cols="([^"]*)"/.exec(text) || [])[1] || ''
    r.edits = msgs.filter((m) => m.type === 'edit').length
    r.text1 = text
  }
  document.title = 'RES ' + JSON.stringify(out)
}
run().catch((e) => { document.title = 'RES ' + JSON.stringify({ error: String(e && e.stack || e) }) })
`

interface Snap { ov: number | null; real: number; left: number; right: number; tw: number; tl: number; sw: number; cw: number; sl: number; tag: string; lim: boolean; blim: boolean }
interface Step extends Snap { dx: number }
interface Out {
  id: string
  cols0: string
  cols1?: string
  wider: boolean
  skipped?: boolean
  error?: string
  border?: number
  x0?: number
  before?: Snap
  pressed?: Snap
  steps?: Step[]
  after?: Snap
  reopened?: Snap
  edits?: number
  text1?: string
}
interface Result { width: number; cases: Record<string, Out>; error?: string }


/** One page of Chrome for one case (the document of a page cannot be replaced, so every case has a page of its own). */
async function pageFor(width: number, c: Case): Promise<Out> {
  const css = readFileSync(at('../../../react/src/style.css'), 'utf8') + '\n' + readFileSync(at('../../src/webview/style.css'), 'utf8')
  const dir = mkdtempSync(join(tmpdir(), 'nota-colresize-'))
  try {
    writeFileSync(join(dir, 'webview.js'), await tabBundle())
    writeFileSync(join(dir, 'style.css'), css)
    writeFileSync(
      join(dir, 'p.html'),
      `<!doctype html><html lang="ru"><head><meta charset="utf-8"><link rel="stylesheet" href="style.css"><style>#app{width:${width}px}</style></head><body class="vscode-dark" data-nota-theme="dark"><div id="app" class="nota" data-mermaid=""></div>
<script>window.__msgs=[];window.acquireVsCodeApi=()=>({postMessage(m){window.__msgs.push(m)},getState:()=>null,setState(){}})</script>
<script src="webview.js"></script><script>${runner([c])}</script></body></html>`,
    )
    const args = ['--headless=new', '--disable-gpu', '--allow-file-access-from-files', `--window-size=${width},1400`, '--virtual-time-budget=120000', '--dump-dom', `file://${join(dir, 'p.html')}`]
    // (on a Mac under load Chrome may print the page and then be killed by its own teardown watchdog: the page it printed is the result)
    const html = await chromeDump(CHROME!, args, 100_000)
    const m = /<title>RES ([^<]*)<\/title>/.exec(html)
    if (!m) throw new Error('the page did not report')
    const result = JSON.parse(m[1]!.replaceAll('&quot;', '"').replaceAll('&amp;', '&').replaceAll('&gt;', '>').replaceAll('&lt;', '<')) as Result
    if (result.error) throw new Error(result.error)
    return result.cases[c.id]!
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const measured = new Map<string, Out>()
/** The case measured (once); after a drag the written text is opened again in a page of its own: «the file closed and opened». */
async function measureCase(width: number, c: Case): Promise<void> {
  let out: Out
  try {
    // (a headless Chrome sometimes dies at the start: once more)
    out = await pageFor(width, c).catch(() => pageFor(width, c))
    if (out.text1 !== undefined && out.steps) out.reopened = (await pageFor(width, { id: c.id, text: out.text1, border: out.border ?? c.border, scroll: false, dxs: [] })).before
  } catch (e) {
    out = { id: c.id, cols0: '', wider: false, error: String(e) }
  }
  measured.set(`${width}/${c.id}`, out)
  if (process.env.NOTA_REPORT) report(width, out)
}

/** Every case of the tab, one after another (a Chrome at a time). */
async function measureAll(width: number): Promise<void> {
  for (const c of casesFor(width)) await measureCase(width, c)
}

function measureTab(width: number): Result {
  const cases = new Proxy({} as Record<string, Out>, {
    get: (_t, id) => {
      const out = typeof id === 'string' ? measured.get(`${width}/${id}`) : undefined
      if (!out) throw new Error(`case ${String(id)} was not measured`)
      return out
    },
  })
  return { width, cases }
}

const f = (n: number | null | undefined): string => (n === null || n === undefined ? '-' : n.toFixed(1))
function report(width: number, c: Out): void {
  const lines: string[] = [`== tab ${width} ==`]
  {
    if (c.skipped || c.error || !c.steps) {
      lines.push(`${c.id}: ${c.skipped ? 'skipped (table fits)' : (c.error ?? 'measured only')} wider=${c.wider} ${c.before ? `sw/cw=${c.before.sw}/${c.before.cw}` : ''}`)
      console.log(lines.join('\n'))
      return
    }
    const b = c.before!
    lines.push(`${c.id}: wider=${c.wider} press x0=${f(c.x0)} left=${f(b.left)} right=${f(b.right)} tw=${f(b.tw)} sw/cw=${b.sw}/${b.cw} sl=${f(b.sl)} cols ${c.cols0 || '-'} -> ${c.cols1 || '-'}`)
    lines.push('  ov: ' + c.steps.map((s) => `${s.dx}:${f(s.ov === null ? null : s.ov - c.x0!)}${s.lim ? '!' : ''}`).join(' '))
    const l = c.steps[c.steps.length - 1]!
    lines.push(`  last step: left=${f(l.left)} right=${f(l.right)} tw=${f(l.tw)} tag="${l.tag}" | after: left=${f(c.after!.left)} right=${f(c.after!.right)} tw=${f(c.after!.tw)} real=${f(c.after!.real - b.real)} (last step ${f(l.real - b.real)}) | reopened: left=${f(c.reopened?.left)} tw=${f(c.reopened?.tw)}`)
  }
  console.log(lines.join('\n'))
}

const ok = (c: Out): Required<Pick<Out, 'before' | 'steps' | 'after' | 'x0' | 'reopened'>> & Out => {
  expect(c.error).toBeUndefined()
  return c as never
}
const ints = (cols: string | undefined): number[] => (cols ?? '').split(',').map((s) => Number(s))
const sum = (a: number[]): number => a.reduce((s, x) => s + x, 0)

/** Along the drag: the overlay never goes against the mouse, stays within 12 px of the mouse. */
function follows(c: ReturnType<typeof ok>, dir: 1 | -1 = 1): void {
  let prev = c.x0
  for (const s of c.steps) {
    expect(s.ov, `${c.id} dx=${s.dx}: the border has no overlay`).not.toBeNull()
    expect((s.ov! - prev) * dir, `${c.id} dx=${s.dx}: the border went against the mouse (${prev} → ${s.ov})`).toBeGreaterThanOrEqual(-0.5)
    expect(Math.abs(s.ov! - (c.x0 + s.dx)), `${c.id} dx=${s.dx}: the border is ${s.ov! - c.x0 - s.dx} px from the mouse`).toBeLessThanOrEqual(12)
    prev = s.ov!
  }
}

/** to the right by 40 px: the left column is 28–52 px wider, the neighbour stands, the table is 28–52 px wider, no stop; whole percents are written. */
function grows(c: ReturnType<typeof ok>, n: number, tol = 8): void {
  follows(c)
  const last = c.steps[c.steps.length - 1]!
  expect(last.left - c.before.left, `${c.id}: left column`).toBeGreaterThanOrEqual(28)
  expect(last.left - c.before.left, `${c.id}: left column`).toBeLessThanOrEqual(52)
  expect(Math.abs(last.right - c.before.right), `${c.id}: the neighbour`).toBeLessThanOrEqual(2)
  expect(last.tw - c.before.tw, `${c.id}: table`).toBeGreaterThanOrEqual(28)
  expect(last.tw - c.before.tw, `${c.id}: table`).toBeLessThanOrEqual(52)
  if (last.tw > last.cw + 1) expect(last.sw, `${c.id}: the frame scrolls`).toBeGreaterThan(last.cw + 1)
  expect(c.steps.some((s) => s.lim || s.tag === 'Минимальная ширина'), `${c.id}: no stop`).toBe(false)
  const w = ints(c.cols1)
  expect(w, `${c.id}: cols`).toHaveLength(n)
  expect(w.every((x) => Number.isInteger(x) && x > 0), `${c.id}: whole percents`).toBe(true)
  expect(sum(w)).toBe(100)
  // (the release: the table stays as wide as the drag left it, the border is where the mouse let go, the frame is not scrolled back)
  // After release the document stores whole percentages, so a wider table can shift the border by more than 12 pixels.
  expect(Math.abs(c.after.real - last.real), `${c.id}: the border jumped at the release`).toBeLessThanOrEqual(Math.max(12, last.tw / 100))
  expect(Math.abs(c.after.tw - last.tw), `${c.id}: the table after the release`).toBeLessThanOrEqual(tol)
  expect(c.after.sl, `${c.id}: scrollLeft`).toBeGreaterThanOrEqual(last.sl - 1)
}

describe.skipIf(!CHROME)('the border of a column goes where the mouse pulls it (real Chrome)', () => {
  for (const width of (process.env.NOTA_WIDTHS ?? '390,700,1280').split(',').map(Number)) {
    describe(`a tab of ${width} px`, () => {
      beforeAll(() => measureAll(width), 1_200_000)
      const res = (): Result => {
        const r = measureTab(width)
        expect(r.error).toBeUndefined()
        return r
      }

      it('a big table of 9 columns: the border follows the mouse, the left column and the table grow, nine whole percents are written', { timeout: 200_000 }, () => {
        for (const id of ['a', 'a+scroll', ...(width === 390 ? ['m'] : [])]) {
          const raw = res().cases[id]!
          if (raw.skipped) continue
          const c = ok(raw)
          grows(c, 9, width === 390 ? 30 : 8)
          // (the wrap of the head does not move the table under the mouse)
          expect(Math.abs(c.steps[0]!.ov! - c.x0), `${id}: the border jumped at the first step`).toBeLessThanOrEqual(12)
        }
      })

      it('a plain table: the border is under the mouse, the left column and the table grow, the neighbour stands', { timeout: 200_000 }, () => {
        for (const id of ['b3', 'b4', ...(width >= 700 ? ['c'] : [])]) {
          const c = ok(res().cases[id]!)
          grows(c, id === 'b3' ? 3 : id === 'b4' ? 4 : 9)
          if (id === 'c') expect(Math.abs(c.steps[0]!.ov! - c.x0)).toBeLessThanOrEqual(12)
        }
      })

      if (width >= 700) {
        it('other tables do not scroll sideways without a drag', { timeout: 200_000 }, () => {
          for (const id of ['k8-5-95', 'k8-b4']) {
            const b = res().cases[id]!.before!
            expect(b.sw, id).toBeLessThanOrEqual(b.cw + 1)
          }
        })
      }

      if (width === 1280) {
        it('only the least width of the dragged column is a stop; to the right there is none', { timeout: 200_000 }, () => {
          const right = ok(res().cases['b4-stop-right']!)
          follows(right)
          expect(right.steps.some((s) => s.lim || s.blim), 'no stop to the right').toBe(false)
          const rl = right.steps[right.steps.length - 1]!
          expect(Math.abs(rl.right - right.before.right), 'the neighbour').toBeLessThanOrEqual(2)
          expect(Math.abs(rl.tw - right.before.tw - 600), 'the table').toBeLessThanOrEqual(12)
          const left = ok(res().cases['b4-stop-left']!)
          let prev = left.x0
          for (const s of left.steps) {
            expect(prev - s.ov!, `left dx=${s.dx}`).toBeGreaterThanOrEqual(-0.5)
            prev = s.ov!
          }
          const ll = left.steps[left.steps.length - 1]!
          expect(Math.abs(ll.left - 64), 'the left column stops at 64 px').toBeLessThanOrEqual(2)
          expect(ll.lim && ll.blim).toBe(true)
          expect(ll.tag).toBe('Минимальная ширина')
          // (the widths written are those of the stop)
          const lw = ints(left.cols1)
          expect(sum(lw)).toBe(100)
          expect(Math.abs((lw[left.border! - 1]! * left.after.tw) / 100 - 64), `written ${lw}`).toBeLessThanOrEqual(left.after.tw / 100 + 2)
        })
      }

      if (width === 390) {
        it('a column of 1% does not make the table 6400 px wide', { timeout: 200_000 }, () => {
          const c = ok(res().cases['cap']!)
          expect(c.before.tw, 'table').toBeLessThanOrEqual(3 * c.before.cw + 1)
          expect(c.before.tw, 'table').toBeGreaterThanOrEqual(8 * 64 - 1)
        })

        it('a refused write leaves the table as it was', { timeout: 200_000 }, () => {
          const c = ok(res().cases['refused']!)
          expect(c.edits, 'nothing is written').toBe(0)
          expect(Math.abs(c.after.tw - c.before.tw), `table ${c.before.tw} → ${c.after.tw}`).toBeLessThanOrEqual(2)
        })

        it('far to the right: no stop, the border is with the mouse to the end', { timeout: 200_000 }, () => {
          for (const id of ['m-stop-right', 'a-stop-right']) {
            const far = ok(res().cases[id]!)
            follows(far)
            expect(far.steps.some((s) => s.lim), `${id}: no stop`).toBe(false)
          }
        })
      }

      it('the label is «N%», the number written for the left column, or the stop alone', { timeout: 200_000 }, () => {
        for (const id of ['a', 'b3', 'b4', ...(width === 390 ? ['m'] : []), ...(width >= 700 ? ['c'] : [])]) {
          const c = ok(res().cases[id]!)
          const last = c.steps[c.steps.length - 1]!
          const m = /^(\d+)%$/.exec(last.tag)
          expect(m, `${id}: label "${last.tag}"`).not.toBeNull()
          expect(Number(m![1]), id).toEqual(ints(c.cols1)[c.border! - 1])
        }
      })
    })
  }

  it('no «меньше нельзя» and «no narrower» in the strings of the interface', () => {
    for (const file of ['../../../react/src/messages.ts', '../../../../demo/src/messages.ts', '../../../prosemirror/src/schema.ts']) {
      const text = readFileSync(at(file), 'utf8')
      expect(text, file).not.toMatch(/меньше нельзя|no narrower/)
    }
  })
})
