// the capsule of selected cells shows for two empty cells of the last row of a table, however they were selected: by a drag with the button let go over
// the table, by a click and a Shift+click or by the grip of a row, by a drag with the button let go where no `mouseup` comes, as it is outside the tab.
// While the button is down there is no capsule, and Esc, a click and a change take it and the highlight away together. Real Chrome on the real bundle of the
// tab, as `cellmenu-layout.test.ts` does. Skipped where Chrome is not installed. `NOTA_REPORT=1` prints the record.
import { existsSync, readFileSync } from 'node:fs'
import { type Server, createServer } from 'node:http'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { CHROME_QUEUE_MS, holdChromeSlot } from './chrome.js'
import { withChrome } from './chrome.js'
import { tabBundle } from './bundle.js'

const CHROME = [process.env.CHROME_BIN ?? '', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => p && existsSync(p))
if (CHROME) beforeAll(() => holdChromeSlot(), CHROME_QUEUE_MS + 10_000)
const here = import.meta.dirname
const at = (path: string): string => join(here, path)

/** `L`: three rows of a table of two columns, the last row of two empty cells, and a paragraph after the table. */
const L = '= Тест\n\n[cols="1,2"]\n|===\n|a1 |b1\n\n|a2 |b2\n\n| |\n|===\n\nТекст после таблицы.\n'

const runner = (S: string): string => `
const S = ${JSON.stringify(S)}
const L = ${JSON.stringify(L)}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const rc = (e) => { const r = e.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height } }
const msgs = window.__msgs
let version = 0
const open = async () => {
  msgs.length = 0
  window.postMessage({ type: 'init', text: L, version: ++version, fileName: 'a.adoc', locale: 'ru', fileDir: '/tmp', mode: 'visual' }, '*')
  await sleep(400)
  for (let i = 0; i < 50 && cells().length !== 2; i++) await sleep(100)
  await sleep(600)
}
const cells = () => [...document.querySelectorAll('.ed-visual tr:last-child td')]
const cap = () => document.querySelector('[role="toolbar"][aria-label="Действия с ячейками"]')
const shown = () => { const c = cap(); if (!c) return false; const r = c.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(c).visibility === 'visible' }
const sel = () => document.querySelectorAll('td.sel, th.sel').length
const mouse = (type, el, extra) => { const p = rc(el); el.dispatchEvent(new MouseEvent(type, Object.assign({ bubbles: true, cancelable: true, clientX: p.left + p.width / 2, clientY: p.top + p.height / 2 }, extra || {}))) }
const place = (td) => { const ed = document.querySelector('.ed-visual [contenteditable="true"]'); ed.focus(); const r = document.createRange(); r.setStart(td.querySelector('p, div') || td, 0); r.collapse(true); const s = getSelection(); s.removeAllRanges(); s.addRange(r); document.dispatchEvent(new Event('selectionchange')) }
const key = (k, extra) => { const ed = document.querySelector('.ed-visual [contenteditable="true"]'); ed.dispatchEvent(new KeyboardEvent('keydown', Object.assign({ key: k, code: k === 'z' ? 'KeyZ' : k, bubbles: true, cancelable: true }, extra || {}))) }
const waitShown = async () => { const t = performance.now(); for (let i = 0; i < 60; i++) { if (shown()) return performance.now() - t; await sleep(10) } return null }
const state = () => ({ cap: shown(), sel: sel(), focus: document.querySelector('.ed-visual').contains(document.activeElement) })
const text = () => { let t = L; for (const m of msgs.filter((m) => m.type === 'edit')) for (const c of [...m.changes].sort((a, b) => b.from - a.from)) t = t.slice(0, c.from) + c.insert + t.slice(c.to); return t }
const gone = async () => { const t = performance.now(); for (let i = 0; i < 40; i++) { if (!shown() && sel() === 0) return performance.now() - t; await sleep(10) } return null }
const mergeBtn = () => { const c = cap(); return c && c.querySelector('[data-cmd="merge"]') }
const strip = async () => {
  const td = cells()[0]; const p = rc(td)
  document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: p.left + p.width / 2, clientY: p.top + p.height / 2, buttons: 0 }))
  await sleep(500)
  return document.querySelector('.nota-grips [data-t="0"][data-kind="row"][data-i="2"]')
}
// what the capsule and the highlight do after the selection is made, and how a click, Esc or a change take them away
const after = async (o) => {
  o.appearMs = await waitShown()
  await sleep(400)
  o.state = state()
  o.merge = !!mergeBtn()
  o.mergeOff = mergeBtn() ? mergeBtn().getAttribute('aria-disabled') : null
  o.names = cap() ? cap().getAttribute('aria-label') : null
}
const run = async () => {
  const out = {}
  // the drag, the button let go over the table
  if (S === "drag") { const o = (out.drag = {}); await open(); const [a, b] = cells(); place(a); await sleep(200)
    mouse('mousedown', a, { buttons: 1 }); mouse('mousemove', b, { buttons: 1 }); await sleep(400)
    o.downState = state()
    mouse('mouseup', b, { buttons: 0 })
    await after(o)
    if (o.merge) { mergeBtn().click(); await sleep(400); o.merged = text()
      // the history: the key of the tab takes the change back (the host answers every edit)
      for (const m of msgs.filter((m) => m.type === 'edit')) window.postMessage({ type: 'ack', id: m.id, version: ++version }, '*')
      await sleep(200); msgs.length = 0; document.querySelector('.ed-visual [contenteditable="true"]').focus(); key('z', { metaKey: true }); await sleep(500)
      o.undone = text() } }
  // a click and a Shift+click
  if (S === "shift") { const o = (out.shift = {}); await open(); const [a, b] = cells(); place(a); await sleep(300)
    mouse('mousedown', b, { shiftKey: true, buttons: 1 }); await sleep(300); o.downState = state(); mouse('mouseup', b, { shiftKey: true })
    await after(o)
    // Esc takes the cells away (the first Esc may hide only the capsule)
    key('Escape'); await sleep(200); key('Escape'); o.escMs = await gone(); o.escState = state() }
  // the grip of the last row
  if (S === "grip") { const o = (out.grip = {}); await open(); const [a] = cells(); place(a); await sleep(300)
    const g = await strip()
    if (!g) o.nostrip = true
    else { mouse('mousedown', g, { buttons: 1 }); mouse('mouseup', g); await after(o) } }
  // the drag and the button let go where no mouseup comes: the next mousemove has no button
  if (S === "nomouseup") { const o = (out.nomouseup = {}); await open(); const [a, b] = cells(); place(a); await sleep(200)
    mouse('mousedown', a, { buttons: 1 }); mouse('mousemove', b, { buttons: 1 }); await sleep(500)
    o.downState = state()
    mouse('mousemove', b, { buttons: 0 })
    await after(o)
    // a click without Shift takes both away
    mouse('mousedown', cells()[0], { buttons: 1 }); mouse('mouseup', cells()[0]); o.clickMs = await gone(); o.clickState = state() }
  // a change of the text takes both away
  if (S === "edit") { const o = (out.edit = {}); await open(); const [a, b] = cells(); place(a); await sleep(200)
    mouse('mousedown', a, { buttons: 1 }); mouse('mousemove', b, { buttons: 1 }); mouse('mouseup', b); await after(o)
    document.execCommand('insertText', false, 'x'); o.editMs = await gone(); o.editState = state() }
  return out
}
window.addEventListener('error', (e) => fetch('/res', { method: 'POST', body: JSON.stringify({ error: String(e.message) }) }))
run().then((o) => fetch('/res', { method: 'POST', body: JSON.stringify(o) }), (e) => fetch('/res', { method: 'POST', body: JSON.stringify({ error: String(e && e.stack || e) }) }))
`

interface St {
  cap: boolean
  sel: number
  focus: boolean
}
interface One {
  downState?: St
  appearMs?: number | null
  state?: St
  merge?: boolean
  mergeOff?: string | null
  nostrip?: boolean
  merged?: string
  undone?: string
  escMs?: number | null
  escState?: St
  clickMs?: number | null
  clickState?: St
  editMs?: number | null
  editState?: St
}
type Out = Record<'drag' | 'shift' | 'grip' | 'nomouseup' | 'edit', One> & { error?: string }


async function measure(S: string): Promise<Out> {
  const css = readFileSync(at('../../../react/src/style.css'), 'utf8') + '\n' + readFileSync(at('../../src/webview/style.css'), 'utf8')
  const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><link rel="stylesheet" href="/style.css"><style>html,body{margin:0;height:100%}#app{width:900px;height:100%}</style></head><body class="vscode-light"><div id="app" class="nota" data-mermaid=""></div>
<script>window.__msgs=[];window.acquireVsCodeApi=()=>({postMessage(m){window.__msgs.push(m)},getState:()=>null,setState(){}})</script>
<script src="/webview.js"></script><script src="/run.js"></script></body></html>`
  const files: Record<string, [string, string]> = {
    '/': [html, 'text/html'],
    '/style.css': [css, 'text/css'],
    '/webview.js': [await tabBundle(), 'text/javascript'],
    '/run.js': [runner(S), 'text/javascript'],
  }
  let server: Server | undefined
  try {
    let resolve!: (o: Out) => void
    let reject!: (e: Error) => void
    const result = new Promise<Out>((res, rej) => {
      resolve = res
      reject = rej
    })
    server = createServer((req, res) => {
      if (req.method === 'POST' && req.url === '/res') {
        const parts: Buffer[] = []
        req.on('data', (d: Buffer) => parts.push(d))
        req.on('end', () => {
          res.end('ok')
          const out = JSON.parse(Buffer.concat(parts).toString('utf8')) as Out
          if (out.error) reject(new Error(out.error))
          else resolve(out)
        })
        return
      }
      const f = files[req.url?.split('?')[0] ?? '']
      if (!f) {
        res.statusCode = 404
        res.end()
        return
      }
      res.setHeader('content-type', `${f[1]}; charset=utf-8`)
      res.end(f[0])
    })
    await new Promise<void>((ok) => server!.listen(0, '127.0.0.1', ok))
    const port = (server!.address() as { port: number }).port
    return await withChrome(
      {
        chrome: CHROME!,
        prefix: 'cellshow',
        timeout: 120_000,
        timeoutMessage: 'the page did not report',
        args: ['--headless=new', '--disable-gpu', '--no-first-run', '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--window-size=900,900', `http://127.0.0.1:${port}/`],
      },
      () => result,
    )
  } finally {
    server?.close()
  }
}

const SCENARIOS = ['drag', 'shift', 'grip', 'nomouseup', 'edit']

describe.skipIf(!CHROME)('the capsule of two empty cells of the last row (real Chrome)', () => {
  let o: Out
  beforeAll(async () => {
    o = {} as Out
    for (const s of SCENARIOS) Object.assign(o, await measure(s))
    if (process.env.NOTA_REPORT) console.log(JSON.stringify(o, null, 1))
  }, 300_000)

  const shownFor = (name: keyof Out, x: One): void => {
    expect(x.nostrip, `${name}: the grip of the row is there`).toBeUndefined()
    expect(x.state?.sel ?? 0, `${name}: the cells are selected`).toBeGreaterThanOrEqual(2)
    expect(x.state?.focus, `${name}: the focus is in the editor`).toBe(true)
    expect(x.state?.cap, `${name}: the capsule is there`).toBe(true)
    expect(x.appearMs ?? Infinity, `${name}: it shows within 300 ms`).toBeLessThanOrEqual(300)
    expect(x.merge, `${name}: «Объединить ячейки» is there`).toBe(true)
    expect(x.mergeOff, `${name}: and is not disabled`).toBeNull()
  }

  it('a drag, the button let go over the table: the capsule, the merge, and the history takes it back', { timeout: 100_000 }, () => {
    expect(o.drag.downState?.cap, 'no capsule while the button is down').toBe(false)
    shownFor('drag', o.drag)
    expect(o.drag.merged, 'the row has a merged cell').toContain('2+|')
    expect(o.drag.undone, 'Cmd+Z gives the file back').toBe(L)
  })

  it('a click and a Shift+click; the grip of the last row', { timeout: 100_000 }, () => {
    shownFor('shift', o.shift)
    shownFor('grip', o.grip)
  })

  it('the button let go where no mouseup comes: the cells are selected and the capsule is there; none while the button is down', { timeout: 100_000 }, () => {
    expect(o.nomouseup.downState?.cap, 'no capsule while the button is down').toBe(false)
    expect(o.nomouseup.downState?.sel ?? 0, 'the cells are selected while it is down').toBeGreaterThanOrEqual(2)
    shownFor('nomouseup', o.nomouseup)
  })

  it('Esc, a click without Shift and a change take the highlight and the capsule away together', { timeout: 100_000 }, () => {
    for (const [name, ms, st] of [
      ['Esc', o.shift.escMs, o.shift.escState],
      ['click', o.nomouseup.clickMs, o.nomouseup.clickState],
      ['edit', o.edit.editMs, o.edit.editState],
    ] as const) {
      expect(ms ?? Infinity, `${name}: within 200 ms`).toBeLessThanOrEqual(200)
      expect(st?.sel, `${name}: no highlight`).toBe(0)
      expect(st?.cap, `${name}: no capsule`).toBe(false)
    }
  })
})
