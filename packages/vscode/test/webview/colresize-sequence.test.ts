// a table of the shape of «Таблица полей (Пример)» (7 columns, one very wide, the table fits its frame): after the first
// drag (and after an edit of a cell) every other border still follows the mouse. Real Chrome, the real bundle of the tab and its style sheet, several
// drags one after another in the same page; the widths written by each drag are read from the `edit` messages. Skipped where Chrome is not installed.
// `NOTA_REPORT=1` prints the numbers; `NOTA_REAL_FILE=<path to .adoc>` adds the real file of the case (the made-up table is of the same shape).
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

// ---------------------------------------------------------------- the tables (made up)

const row = (cells: string[]): string => cells.map((c) => `|${c}`).join(' ') + '\n'
const HEAD = ['Код', 'Название', 'Тип', 'Позиция (item_ref /variant)', 'Ссылки', 'Значение по умолчанию', 'Комментарий']

/** The shape of the table of the case: 7 columns without percents, a short last column that holds the long text, ~40 rows (made up). */
function attributes(rows: number, cols = '7'): string {
  let t = `= Тест\n\n[%header,cols="${cols}"]\n|===\n` + row(HEAD) + '\n'
  // (like the real case: 114 links `xref:` in the column «Ссылки» (3 in each of 38 rows, the targets of 60–130 characters), and in «Комментарий»
  // a plate of a form that stays a plate (`<<foreach […]>>`; a link with `<>` in its target is read as a link now), shown as `.nota-inline-chip`: ≈ 107 characters)
  const dict = 'xref:../Набор%5Fобразцов/Набор%5F(Образец)%5Fпервый-второй/Набор%5F(Образец)%5Fпервый-второй.adoc'
  const links = (r: number): string =>
    [`${dict}[${700 + r}. Допустимые значения для примера]`, `xref:../Набор_образцов/Набор_(Образец)_третий/${100 + r}._Тип_сопроводительного_описания.adoc[${100 + r}. Тип сопроводительного описания]`, `xref:../Образцы/Образец.adoc[${r}. Образец]`].join(' ')
  const plate = '<<foreach [in Catalog.ItemSet.where(Item => Item.Kind == KindList && Item.Id != Local && Item.Count > 0)]>>'
  for (let r = 0; r < rows; r++) {
    const comment = `Этап ${r % 5}. Подробное описание поведения поля и порядка его заполнения оператором для случая ${r}.${r % 8 === 3 ? ` Используется в ${plate}` : ''}`
    t += row([`${5000 + r}`, `Дата расчёта номер ${r}`, 'Дата', 'Строка (19)', r < 38 ? links(r) : '', r % 4 === 0 ? 'Не задано' : '', comment]) + '\n'
  }
  return t + '|===\n'
}

/**
 * the shape of the first table of a user file (made up): `[%header,cols="8"]`, 8 columns, ~160 rows; in the first column `a|` with a list of
 * one item, in it code without spaces of 45 characters (the parts are 13 characters each, so it is always cut to 45); the plates `xref:` in the head of the columns 4–6.
 */
function jsonParams(rows = 160): string {
  const part = ['productRecord', 'categoryGroup', 'stockManifest', 'priceSchedule', 'warehouseUnit', 'supplierEntry', 'packagingSpec', 'attributeCard']
  const leaf = ['createdDate', 'series', 'number', 'weightKg', 'widthMm', 'heightMm', 'unitCount', 'barcodeValue']
  const code = (r: number): string => `${part[r % 8]}.${part[(r * 3 + 1) % 8]}.${part[(r * 5 + 2) % 8]}.${leaf[(r * 7) % 8]}`.slice(0, 45)
  const ref = (n: number): string => `xref:Каталог/Примеры/Метод_${n}_-_Список_позиций.adoc[GET /demo/v${n}/items - Список позиций каталога] + Признак`
  let t = '= Тест\n\n[%header,cols="8"]\n|===\n'
  t += ['Параметр', 'Тип', 'Описание', ref(1), ref(2), ref(3), 'Склад', 'Пример'].map((c) => `<| ${c}\n`).join('') + '\n'
  for (let r = 0; r < rows; r++) {
    const flag = (yes: boolean): string => `a|\n* ${yes ? 'Да' : 'Нет'}\n`
    t += `a|\n* \`${code(r)}\`\n<| String\n<| Описание поля номер ${r}: порядок заполнения и допустимые значения\n${flag(r % 2 === 0)}${flag(r % 3 === 0)}${flag(r % 5 === 0)}<| ${r % 4 === 0 ? 'Каталог.поле' : ''}\n<| \`значение${r}\`\n\n`
  }
  return t + '|===\n'
}

/** A table of 2 columns, `cols="5,95"` (made up). */
function plain2(): string {
  let t = '= Тест\n\n[%header,cols="5,95"]\n|===\n' + row(['№', 'Название']) + '\n'
  for (let r = 0; r < 6; r++) t += row([`${r}`, `Строка ${r}: подробное описание`]) + '\n'
  return t + '|===\n'
}

/** A table of 4 columns, `cols="20,30,30,20"`, a short head, 6 rows (made up). */
function plain4(): string {
  let t = '= Тест\n\n[%header,cols="20,30,30,20"]\n|===\n' + row(['Колонка 1', 'Колонка 2', 'Колонка 3', 'Колонка 4']) + '\n'
  for (let r = 0; r < 6; r++) t += row([0, 1, 2, 3].map((k) => `Ячейка ${r}-${k}`)) + '\n'
  return t + '|===\n'
}

interface Op {
  k: 'drag' | 'type' | 'reopen' | 'undo' | 'redo' | 'dbl' | 'scrollEnd' | 'probe' | 'barEnd' | 'wheel'
  /** The border (the index of the column at its right). */
  border?: number
  /** The shifts of the mouse from the press, one step each. */
  dxs?: number[]
  /** The row and the column of the cell to type in (row 0 is the head). */
  row?: number
  col?: number
}

interface Case {
  id: string
  text: string
  ops: Op[]
}

const to = (dx: number, by = 10): number[] => Array.from({ length: Math.abs(dx) / by }, (_, k) => Math.sign(dx) * by * (k + 1))
const drag = (border: number, dx: number): Op => ({ k: 'drag', border, dxs: to(dx) })

/** The tab of the wide case: a wide page (the frame of the table ≈ 1500 px), where the six first columns of 6% are ≈ 90 px and can still be moved. */
const WIDE = 1900
const WIDE_PAGE = 1800

/** the tab of 1000 px; the sources of the tables: made up of the shape of a real file, and the file itself (`NOTA_REAL_FILE`). */
const TAB = 1000

function realSource(): { text: string; ncols: number } | null {
  const real = process.env.NOTA_REAL_FILE
  if (!real || !existsSync(real)) return null
  const text = readFileSync(real, 'utf8').replace(/^\/\/\/\/[\s\S]*?\n\/\/\/\/\n/, '')
  // (the number of columns of the first table, from its `cols`)
  const ncols = Number(/\[%header,cols="(\d+)"\]/.exec(text)?.[1] ?? 0)
  return { text, ncols }
}

function sources(): { id: string; text: string; ncols: number }[] {
  const list = [{ id: 'json', text: jsonParams(), ncols: 8 }]
  const real = realSource()
  if (real) list.push({ id: 'real', ...real })
  return list
}

function cases117(): Case[] {
  const list: Case[] = []
  for (const s of sources()) {
    const n = s.ncols
    list.push({ id: `${s.id}-k1`, text: s.text, ops: [drag(1, -120)] })
    list.push({ id: `${s.id}-k2`, text: s.text, ops: [drag(1, -600), { k: 'type', row: 2, col: 2 }] })
    const both = Array.from({ length: 7 }, (_, k) => k + 1).flatMap((b) => [drag(b, 40), drag(b, -80)])
    list.push({ id: `${s.id}-k3`, text: s.text, ops: both })
    list.push({ id: `${s.id}-k4`, text: s.text, ops: [{ k: 'scrollEnd' }] })
    list.push({ id: `${s.id}-k5r`, text: s.text, ops: [{ k: 'scrollEnd' }, drag(n, 60), { k: 'undo' }, { k: 'redo' }] })
    // (to the left by 60 px: the last column is 81 px wide in the file, so it is first made wider; and a drag at once to the least width)
    list.push({ id: `${s.id}-k5l`, text: s.text, ops: [{ k: 'scrollEnd' }, drag(n, 60), { k: 'scrollEnd' }, drag(n, -60)] })
    list.push({ id: `${s.id}-k5m`, text: s.text, ops: [{ k: 'scrollEnd' }, drag(n, -400)] })
    list.push({ id: `${s.id}-k6`, text: s.text, ops: [{ k: 'probe' }, { k: 'barEnd' }, { k: 'wheel' }] })
  }
  // (the stop at the frame: a table that fits its frame is dragged wider by 100 px, then the right edge goes back by 300 px)
  list.push({ id: 'plain-k5f', text: plain4(), ops: [drag(4, 100), { k: 'scrollEnd' }, drag(4, -300)] })
  return list
}

function casesFor(width: number): Case[] {
  if (width === TAB) return process.env.NOTA_ONLY ? cases117().filter((c) => process.env.NOTA_ONLY!.split(',').includes(c.id)) : cases117()
  const open = attributes(40)
  // (the widths as the file has them after a drag at the last border: six narrow columns, one wide; in a narrow tab the narrow ones are not narrower than the cell can be)
  const cols = width >= WIDE ? '6,6,6,10,6,6,60' : '12,12,12,14,12,12,26'
  const list: Case[] = [
    // (the first drag at the border of the last column, then every other border, left and right, one after another)
    { id: 'seq', text: open, ops: [drag(6, -80), drag(5, 30), drag(3, 40), drag(2, -20), drag(4, 30), drag(6, 30), drag(1, 20)] },
    // (a small first drag; then the borders of the left columns)
    { id: 'small', text: open, ops: [drag(6, -20), drag(3, 40), drag(4, -20), drag(2, 30)] },
    // (an edit of the last column, then the drags: «поправил поле комментарий и все. не могу сдвинуть ничего»)
    { id: 'edit', text: open, ops: [{ k: 'type', row: 1, col: 6 }, drag(3, 40), drag(6, -40), { k: 'type', row: 2, col: 6 }, drag(2, 30), drag(4, -20)] },
    // (the written widths, the file opened again, the drags go on)
    { id: 'reopen', text: open, ops: [drag(6, -80), { k: 'reopen' }, drag(3, 40), drag(5, -20), drag(2, 20)] },
    // (the file as a user tab had it: the widths are already in the file)
    { id: 'file', text: attributes(40, cols), ops: [drag(3, 40), drag(2, 30), drag(4, -20), drag(5, 30), drag(6, -30), drag(1, 20)] },
  ]
  // the case of a user: 7 narrow columns in a tab of 700 px; every border to the right by 40 px and back (the file with widths, and wide.adoc)
  if (width === 700) {
    const both = [1, 2, 3, 4, 5, 6].flatMap((b) => [drag(b, 40), drag(b, -40)])
    list.push({ id: 'k3-file', text: attributes(40, '12,12,12,14,12,12,26'), ops: both })
    list.push({ id: 'k3-wide', text: readFileSync(at('../../../../quality/fixtures/editor/wide.adoc'), 'utf8'), ops: both })
    // a plain table of 4 columns: 80 px to the right, let go, then 200 px to the left at the same border
    list.push({ id: 'k6', text: plain4(), ops: [drag(2, 80), drag(2, -200)] })
    // an edit of a cell, a drag, an edit again (the table is drawn again), the same text opened again
    list.push({ id: 'k9', text: attributes(40, '12,12,12,14,12,12,26'), ops: [drag(1, 40), { k: 'type', row: 2, col: 6 }] })
    // Undo and Redo after a drag; two drags and one Undo
    list.push({ id: 'k10', text: attributes(40, '12,12,12,14,12,12,26'), ops: [drag(1, 40), { k: 'undo' }, { k: 'redo' }, drag(4, 40), { k: 'undo' }] })
    // (wide.adoc, `cols="9"`: no percents in the file before the drag; Undo, Redo)
    list.push({ id: 'k10-wide', text: readFileSync(at('../../../../quality/fixtures/editor/wide.adoc'), 'utf8'), ops: [drag(1, 40), { k: 'undo' }, { k: 'redo' }] })
    // a drag to the right, then a double click at the border: the table keeps its width
    list.push({ id: 'k8-dbl', text: attributes(40, '12,12,12,14,12,12,26'), ops: [drag(2, 40), { k: 'dbl', border: 2 }] })
  }
  // a table that fits its frame has the strip of the right edge too; tables without a drag do not scroll sideways, wide.adoc is as on main
  if (width === 1280) list.push({ id: 'k4-plain', text: plain4(), ops: [{ k: 'probe' }] })
  if (width === 700 || width === 1280) {
    list.push({ id: 'k7-plain4', text: plain4(), ops: [{ k: 'probe' }] })
    list.push({ id: 'k7-5-95', text: plain2(), ops: [{ k: 'probe' }] })
    list.push({ id: 'k7-wide', text: readFileSync(at('../../../../quality/fixtures/editor/wide.adoc'), 'utf8'), ops: [{ k: 'probe' }] })
  }
  const realFile = realSource()
  if (realFile) {
    // (the real file of the case, as the tab parses it; NOTA_REAL_FILE=<path>)
    const body = realFile.text
    const rest = [drag(3, 40), drag(4, -20), drag(2, 30), drag(5, -20), drag(1, 20)]
    list.push({ id: 'real', text: body, ops: [drag(6, -200), drag(5, 60), drag(3, 60), drag(2, -30), { k: 'type', row: 1, col: 6 }, drag(4, 50)] })
    list.push({ id: 'real-small', text: body, ops: [drag(6, -20), ...rest] })
    list.push({ id: 'real-right', text: body, ops: [drag(6, 50), ...rest] })
    // (the number of columns is that of the first table of the file: 8 in that file, 7 before)
    const written = Array.from({ length: realFile.ncols }, (_, k) => (k === realFile.ncols - 1 ? 100 - 6 * (realFile.ncols - 1) : 6)).join(',')
    list.push({ id: 'real-written', text: body.replace(/\[%header,cols="\d+"\]/, `[%header,cols="${written}"]`), ops: rest })
  }
  // (NOTA_ONLY=<id>[,<id>]: some cases, for a look at the numbers)
  return process.env.NOTA_ONLY ? list.filter((c) => process.env.NOTA_ONLY!.split(',').includes(c.id)) : list
}

// ---------------------------------------------------------------- the page

const runner = (c: Case): string => `
const CASE = ${JSON.stringify(c)}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const msgs = window.__msgs
let version = 0
// (the host takes every edit: without its answer the tab sends the next edit only after the first one, and the file stays as it was)
// (and it keeps the history of the document, as VS Code does: the tab sends «undo» and «redo» to it and gets the text of the step back)
let hostText = ${JSON.stringify(c.text)}
const undone = []
const redone = []
const swap = (to) => {
  const changes = [{ from: 0, to: hostText.length, insert: to }]
  hostText = to
  setTimeout(() => window.postMessage({ type: 'update', version: ++version, changes, reason: 'undo' }, '*'), 0)
}
msgs.push = function (m) {
  Array.prototype.push.call(this, m)
  if (m.type === 'edit') {
    undone.push(hostText)
    redone.length = 0
    let t = hostText
    for (const c of [...m.changes].sort((a, b) => b.from - a.from)) t = t.slice(0, c.from) + c.insert + t.slice(c.to)
    hostText = t
    setTimeout(() => window.postMessage({ type: 'ack', id: m.id, version: ++version }, '*'), 0)
  } else if (m.type === 'undo' && undone.length) {
    redone.push(hostText)
    swap(undone.pop())
  } else if (m.type === 'redo' && redone.length) {
    undone.push(hostText)
    swap(redone.pop())
  }
  return this.length
}
const open = async (text) => {
  window.postMessage({ type: 'init', text, version: ++version, fileName: 'a.adoc', locale: 'ru', outlineView: 'capsule', fileDir: '/tmp', mode: 'visual' }, '*')
  await sleep(300)
  for (let i = 0; i < 50 && !document.querySelector('.tbl td'); i++) await sleep(100)
  await sleep(500)
}
const rc = (e) => e.getBoundingClientRect()
const parts = () => {
  const tbl = document.querySelector('.tbl')
  const sc = tbl.querySelector(':scope > .tbl-scroll')
  const table = sc.querySelector(':scope > table')
  return { tbl, sc, table, cells: [...table.querySelector('tbody > tr').children] }
}
// (the left edge of the column i; the right edge of the table for i = the number of columns)
const edge = (cells, i) => (i >= cells.length ? rc(cells[cells.length - 1]).right : rc(cells[i]).left)
const snap = (i) => {
  const { tbl, sc, table, cells } = parts()
  const bd = document.querySelector('.nota-grips .bd.live')
  const tag = document.querySelector('.nota-grips .wtag')
  const ov = bd ? rc(bd) : null
  return {
    ov: ov ? ov.left + ov.width / 2 : null, real: edge(cells, i), widths: cells.map((c) => Math.round(rc(c).width)),
    tw: Math.round(rc(table).width), sw: sc.scrollWidth, cw: sc.clientWidth, sl: sc.scrollLeft,
    tag: tag && !tag.hidden ? tag.textContent : '', lim: tag ? tag.classList.contains('limit') : false,
    cls: tbl.className, style: table.getAttribute('style') || '', cols: [...table.querySelectorAll('colgroup > col')].map((c) => c.getAttribute('style') || ''),
    bds: document.querySelectorAll('.nota-grips .bd').length, live: !!bd,
    strips: [...document.querySelectorAll('.nota-grips .bd')].map((s) => ({ x: rc(s).left + rc(s).width / 2, n: s.getAttribute('data-border'), cursor: getComputedStyle(s).cursor, title: s.title, label: s.getAttribute('aria-label') })),
    lastRight: rc(cells[cells.length - 1]).right, frameRight: rc(sc).right, vh: innerHeight,
    // (the first row of data: how far a cell is wider than its <col>, how far its content is wider than it)
    fit: [...(table.querySelectorAll('tbody > tr')[1] || { children: [] }).children].map((c, k) => ({ over: rc(c).width - rc(table.querySelectorAll('colgroup > col')[k]).width, scroll: c.scrollWidth - c.clientWidth })),
    bar: (() => { const b = document.querySelector('.tbl > .tbl-bar'); if (!b) return null; const q = rc(b); return { top: q.top, bottom: q.bottom, h: q.height, shown: getComputedStyle(b).display !== 'none' && q.height > 0, sl: b.scrollLeft, sw: b.scrollWidth, cw: b.clientWidth } })(),
  }
}
let text = CASE.text
const apply = () => {
  for (const m of msgs.filter((m) => m.type === 'edit')) {
    for (const c of [...m.changes].sort((a, b) => b.from - a.from)) text = text.slice(0, c.from) + c.insert + text.slice(c.to)
  }
  msgs.length = 0
}
const colsOf = (t) => (/cols="([^"]*)"/.exec(t) || [])[1] || ''
const run = async () => {
  const out = { width: innerWidth, id: CASE.id, ops: [] }
  await open(text)
  { const chips = [...document.querySelectorAll('.tbl td .nota-inline-chip')]; out.chips = chips.length; out.links = document.querySelectorAll('.tbl td a').length; out.chipWrap = chips.length ? getComputedStyle(chips[0]).whiteSpace : '' }
  msgs.length = 0
  for (const op of CASE.ops) {
    const r = { op }
    out.ops.push(r)
    const { sc } = parts()
    if (op.k === 'reopen') { await open(text); r.before = snap(1); continue }
    if (op.k === 'scrollEnd' || op.k === 'probe' || op.k === 'barEnd' || op.k === 'wheel') {
      // (the frame is scrolled to its right end; the mouse comes over the table so that the layer draws the borders)
      if (op.k === 'scrollEnd') { sc.scrollLeft = sc.scrollWidth - sc.clientWidth; await sleep(300) }
      // (the bar that sticks to the window is dragged to its end, as a hand would drag its thumb: the frame must follow;
      // a headless page draws no frames and so sends no scroll events: the press and the event are sent here)
      if (op.k === 'barEnd') { const bar = document.querySelector('.tbl > .tbl-bar'); bar.dispatchEvent(new Event('pointerdown')); bar.scrollLeft = bar.scrollWidth - bar.clientWidth; bar.dispatchEvent(new Event('scroll')); await sleep(400) }
      if (op.k === 'wheel') {
        { const bar = document.querySelector('.tbl > .tbl-bar'); bar.dispatchEvent(new Event('pointerdown')); bar.scrollLeft = 0; bar.dispatchEvent(new Event('scroll')) }
        sc.scrollLeft = 0
        await sleep(300)
        const hy0 = rc(parts().cells[0]).top + 30
        document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: rc(sc).left + 30, clientY: hy0, buttons: 0 }))
        await sleep(300)
        const strip = document.querySelector('.nota-grips .bd')
        const wheel = (init) => strip.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init }))
        const a0 = sc.scrollLeft
        wheel({ deltaX: 120 })
        const a1 = sc.scrollLeft
        wheel({ deltaY: 100, shiftKey: true })
        r.wheel = [a0, a1, sc.scrollLeft]
      }
      const hy = rc(parts().cells[0]).top + 30
      document.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: null }))
      await sleep(100)
      document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: rc(sc).left + 30, clientY: hy, buttons: 0 }))
      await sleep(300)
      r.after = snap(parts().cells.length)
      r.sl = sc.scrollLeft
      r.max = sc.scrollWidth - sc.clientWidth
      continue
    }
    if (op.k === 'undo' || op.k === 'redo') {
      const pm = document.querySelector('.ProseMirror')
      const mac = /Mac|iP(hone|[oa]d)/.test(navigator.platform)
      const redo = op.k === 'redo'
      pm.focus()
      pm.dispatchEvent(new KeyboardEvent('keydown', {
        key: redo ? 'Z' : 'z', code: 'KeyZ', keyCode: 90,
        metaKey: mac, ctrlKey: !mac, shiftKey: redo, bubbles: true, cancelable: true,
      }))
      await sleep(800)
      msgs.length = 0
      text = hostText
      r.cols1 = colsOf(text)
      r.text = text
      r.after = snap(1)
      continue
    }
    if (op.k === 'type') {
      const el = parts().table.querySelectorAll('tbody > tr')[op.row].children[op.col]
      const pm = document.querySelector('.ProseMirror')
      pm.focus()
      const range = document.createRange()
      range.selectNodeContents(el)
      range.collapse(false)
      const s = getSelection(); s.removeAllRanges(); s.addRange(range)
      await sleep(100)
      r.typed = document.execCommand('insertText', false, ' правка')
      await sleep(600)
      apply()
      r.text = text
      r.cols1 = colsOf(text)
      r.after = snap(1)
      continue
    }
    const i = op.border
    // (a border that is out of the frame: the frame is scrolled so that it is in the middle, as a hand would)
    {
      const { cells } = parts()
      const l = edge(cells, i)
      if (!(l > rc(sc).left + 12 && l < rc(sc).right - 12)) { sc.scrollLeft += l - rc(sc).left - sc.clientWidth / 2; await sleep(300) }
    }
    const { cells } = parts()
    r.before = snap(i)
    const hy = rc(cells[0]).top + 30
    // (the mouse leaves and comes back: the layer is drawn again at the place of the borders now; a headless page draws no frames to do it after the scroll)
    document.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: null }))
    await sleep(100)
    document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: rc(sc).left + 30, clientY: hy, buttons: 0 }))
    await sleep(300)
    const strips = [...document.querySelectorAll('.nota-grips .bd')]
    const cur = parts().cells
    const strip = strips.map((s) => ({ s, d: Math.abs(rc(s).left + rc(s).width / 2 - edge(cur, i)) })).sort((a, b) => a.d - b.d)[0]
    if (!strip || strip.d > 3) { r.error = 'no strip at the border ' + i + ' (' + strips.length + ' strips)'; continue }
    const x0 = rc(strip.s).left + rc(strip.s).width / 2
    r.x0 = x0
    if (op.k === 'dbl') {
      // (a double click at the border: two presses, the second with detail 2)
      for (const detail of [1, 2]) {
        strip.s.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: x0, clientY: hy, button: 0, buttons: 1, detail }))
        document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: x0, clientY: hy }))
        await sleep(100)
      }
      await sleep(800)
      r.after = snap(i)
      r.edits = msgs.filter((m) => m.type === 'edit').length
      apply()
      r.cols1 = colsOf(text)
      r.text = text
      continue
    }
    strip.s.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: x0, clientY: hy, button: 0, buttons: 1, detail: 1 }))
    r.steps = []
    for (const dx of op.dxs) {
      document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: x0 + dx, clientY: hy, buttons: 1 }))
      await sleep(40)
      r.steps.push({ dx, ...snap(i) })
    }
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: x0 + op.dxs[op.dxs.length - 1], clientY: hy }))
    await sleep(800)
    r.after = snap(i)
    r.edits = msgs.filter((m) => m.type === 'edit').length
    apply()
    r.cols1 = colsOf(text)
    r.text = text
  }
  document.title = 'RES ' + JSON.stringify(out)
}
run().catch((e) => { document.title = 'RES ' + JSON.stringify({ error: String(e && e.stack || e) }) })
`

interface Snap {
  ov: number | null
  real: number
  widths: number[]
  tw: number
  sw: number
  cw: number
  sl: number
  tag: string
  lim: boolean
  cls: string
  style: string
  cols: string[]
  bds: number
  live: boolean
  strips: { x: number; n: string | null; cursor: string; title: string; label: string | null }[]
  lastRight: number
  frameRight: number
  vh: number
  fit: { over: number; scroll: number }[]
  bar: { top: number; bottom: number; h: number; shown: boolean; sl: number; sw: number; cw: number } | null
}
interface Step extends Snap {
  dx: number
}
interface OpOut {
  op: Op
  error?: string
  x0?: number
  before?: Snap
  steps?: Step[]
  after?: Snap
  edits?: number
  cols1?: string
  text?: string
  typed?: boolean
  sl?: number
  max?: number
  wheel?: number[]
}
interface Out {
  width: number
  id: string
  chips?: number
  links?: number
  chipWrap?: string
  ops: OpOut[]
  error?: string
}


async function pageFor(width: number, c: Case): Promise<Out> {
  const css = readFileSync(at('../../../react/src/style.css'), 'utf8') + '\n' + readFileSync(at('../../src/webview/style.css'), 'utf8')
  const dir = mkdtempSync(join(tmpdir(), 'nota-colseq-'))
  try {
    writeFileSync(join(dir, 'webview.js'), await tabBundle())
    writeFileSync(join(dir, 'style.css'), css)
    writeFileSync(
      join(dir, 'p.html'),
      `<!doctype html><html lang="ru"><head><meta charset="utf-8"><link rel="stylesheet" href="style.css"><style>#app{width:${width}px}${width >= WIDE ? `.nota{--nota-page-max:${WIDE_PAGE}px}` : ""}</style></head><body class="vscode-dark" data-nota-theme="dark"><div id="app" class="nota" data-mermaid=""></div>
<script>window.__msgs=[];window.acquireVsCodeApi=()=>({postMessage(m){window.__msgs.push(m)},getState:()=>null,setState(){}})</script>
<script src="webview.js"></script><script>${runner(c)}</script></body></html>`,
    )
    const args = ['--headless=new', '--disable-gpu', '--allow-file-access-from-files', `--window-size=${width},1400`, '--virtual-time-budget=120000', '--dump-dom', `file://${join(dir, 'p.html')}`]
    // (on a Mac under load Chrome may print the page and then be killed by its own teardown watchdog: the page it printed is the result)
    const html = await chromeDump(CHROME!, args, 100_000)
    const m = /<title>RES ([^<]*)<\/title>/.exec(html)
    if (!m) throw new Error('the page did not report')
    const result = JSON.parse(m[1]!.replaceAll('&quot;', '"').replaceAll('&amp;', '&').replaceAll('&gt;', '>').replaceAll('&lt;', '<')) as Out
    if (result.error) throw new Error(result.error)
    return result
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const measured = new Map<string, Out>()
async function measureAll(width: number): Promise<void> {
  for (const c of casesFor(width)) {
    let out: Out
    try {
      // (the machine may be busy with other work: a page that did not report in time is tried again, twice)
      out = await pageFor(width, c).catch(() => pageFor(width, c)).catch(() => pageFor(width, c))
    } catch (e) {
      out = { width, id: c.id, ops: [], error: String(e) }
    }
    measured.set(`${width}/${c.id}`, out)
    if (process.env.NOTA_REPORT) report(out)
    if (c.id === 'k9' && !out.error) {
      // (the file closed and opened again: the written text in a page of its own)
      const written = out.ops[out.ops.length - 1]!.text!
      const again = await pageFor(width, { id: 'k9-reopen', text: written, ops: [{ k: 'reopen' }] }).catch((e) => ({ width, id: 'k9-reopen', ops: [], error: String(e) }) as Out)
      measured.set(`${width}/k9-reopen`, again)
    }
  }
}

const f = (n: number | null | undefined): string => (n === null || n === undefined ? '-' : n.toFixed(0))
function report(o: Out): void {
  const lines = [`== tab ${o.width} · ${o.id} ${o.error ?? ''}`]
  for (const r of o.ops) {
    const b = r.before
    if (r.op.k !== 'drag') {
      lines.push(`  ${r.op.k}${r.op.row !== undefined ? ` r${r.op.row}c${r.op.col} typed=${r.typed}` : ''} cols→${r.cols1 ?? '-'} after widths=${(r.after ?? b)?.widths.join('/')} tw=${(r.after ?? b)?.tw}`)
      continue
    }
    if (r.error || !r.steps) {
      lines.push(`  drag b${r.op.border}: ${r.error}`)
      continue
    }
    const l = r.steps[r.steps.length - 1]!
    lines.push(
      `  drag b${r.op.border} ${r.op.dxs![r.op.dxs!.length - 1]}px: widths ${b!.widths.join('/')} tw=${b!.tw} sw/cw=${b!.sw}/${b!.cw}\n    ov: ${r.steps.map((s) => `${s.dx}:${f(s.ov === null ? null : s.ov - r.x0!)}${s.lim ? '!' : ''}`).join(' ')}\n    last tag="${l.tag}" cols→${r.cols1 || '-'} (edits ${r.edits}) after widths ${r.after!.widths.join('/')} tw=${r.after!.tw} sw/cw=${r.after!.sw}/${r.after!.cw} cls="${r.after!.cls}" style="${r.after!.style}" bds=${r.after!.bds}`,
    )
  }
  console.log(lines.join('\n'))
}

const ints = (cols: string | undefined): number[] => (cols ?? '').split(',').map((s) => Number(s))
const sum = (a: number[]): number => a.reduce((s, x) => s + x, 0)
const MIN = 64

describe.skipIf(!CHROME)('a table of 7 columns with a very wide last one: every border goes on following the mouse (real Chrome)', () => {
  if (CHROME) beforeAll(() => holdChromeSlot(), CHROME_QUEUE_MS + 10_000)
  for (const width of (process.env.NOTA_WIDTHS ?? `390,700,1280,${TAB},${WIDE}`).split(',').map(Number)) {
    describe(`a tab of ${width} px`, () => {
      beforeAll(() => measureAll(width), 1_200_000)
      const run = (id: string): Out => {
        const o = measured.get(`${width}/${id}`)
        if (!o) throw new Error(`case ${id} was not measured`)
        expect(o.error).toBeUndefined()
        return o
      }

      for (const id of width === TAB ? [] : ['seq', 'small', 'edit', 'reopen', 'file']) {
        it(`${id}: after each drag the next border is found, goes after the mouse up to the real least width, and the widths are written`, { timeout: 200_000 }, () => {
          const o = run(id)
          // (the table has the 114 links `xref:` and the plates of the real file, and a plate breaks in a narrow column: it does not hold the width of «Комментарий»)
          expect(o.links, `${id}: links xref in the cells`).toBe(114)
          expect(o.chips, `${id}: plates in the cells`).toBeGreaterThan(0)
          expect(o.chipWrap, `${id}: a plate in a cell wraps (white-space: normal)`).toBe('normal')
          const drags = o.ops.filter((r) => r.op.k === 'drag')
          expect(drags.length).toBeGreaterThan(0)
          for (const r of drags) {
            const name = `${id} b${r.op.border} ${r.op.dxs![r.op.dxs!.length - 1]}px`
            expect(r.error, `${name}: the border cannot be pressed`).toBeUndefined()
            const dir = Math.sign(r.op.dxs![0]!)
            const steps = r.steps!
            // (the border never goes against the mouse, and goes with it until the stop)
            let prev = r.x0!
            for (const s of steps) {
              expect(s.ov, `${name} dx=${s.dx}: no border on the screen`).not.toBeNull()
              expect((s.ov! - prev) * dir, `${name} dx=${s.dx}: against the mouse`).toBeGreaterThanOrEqual(-0.5)
              prev = s.ov!
              if (!s.lim) expect(Math.abs(s.ov! - (r.x0! + s.dx)), `${name} dx=${s.dx}: the border is far from the mouse`).toBeLessThanOrEqual(12)
              // (no technical words in the tag)
              expect(s.tag).not.toMatch(/меньше нельзя|no narrower|px|cols/)
            }
            // (a stop is only the least width of the dragged column, and only to the left; to the right there is none)
            const stop = steps.findIndex((s) => s.lim)
            if (dir > 0) expect(stop, `${name}: a stop to the right`).toBe(-1)
            if (stop >= 0) {
              const s = steps[stop]!
              const giving = s.widths[r.op.border! - 1]!
              expect(giving, `${name}: stopped at dx=${s.dx} while the dragged column is ${giving} px wide`).toBeLessThanOrEqual(MIN + 2)
              expect(s.tag, `${name}: the tag at the stop`).toBe('Минимальная ширина')
            }
            const moved = steps[steps.length - 1]!.ov! - r.x0!
            // (to the right the border goes with the mouse whatever the neighbour is; to the left until the dragged column is at 64 px)
            const nb = r.before!.widths
            if (dir > 0 || nb[r.op.border! - 1]! > MIN + 20) {
              expect(moved * dir, `${name}: the border stands, the neighbours are ${nb[r.op.border! - 1]} and ${nb[r.op.border!]} px`).toBeGreaterThanOrEqual(15)
            }
            // (written: whole percents that add up to 100; nothing of the drag is left in the page)
            const w = ints(r.cols1)
            expect(w, `${name}: cols`).toHaveLength(7)
            expect(w.every((n) => Number.isInteger(n) && n > 0), `${name}: whole percents`).toBe(true)
            expect(sum(w), `${name}: cols add up to 100`).toBe(100)
            // (a shift under one percent of the table can round to the same whole percents: nothing to write then)
            if (Math.abs(moved) >= Math.max(3, r.before!.tw / 100 + 1)) expect(r.edits, `${name}: the shift is written (moved ${moved}, before ${r.before!.widths.join('/')} tw=${r.before!.tw} cw=${r.before!.cw}, cols ${r.cols1})`).toBe(1)
            expect(r.after!.cls, `${name}: the table is still in the drag`).not.toMatch(/tbl-drag/)
            expect(r.after!.style, `${name}: the layout of the drag is left in the table`).not.toMatch(/table-layout/)
            expect(r.after!.live, `${name}: a border is still alive`).toBe(false)
            expect(r.after!.bds, `${name}: strips of borders`).toBeGreaterThan(0)
            // (in a table that fits its frame the left column is where the mouse left it, in the page, after the release: to whole percents, i.e. to 2% of the table)
            const b = r.before!
            const a = r.after!
            const i = r.op.border! - 1
            if (b.tw <= b.cw + 1.5 && a.tw <= a.cw + 1.5 && !steps.some((s) => s.lim) && Math.abs(moved) >= 20) {
              expect(Math.abs(a.widths[i]! - (b.widths[i]! + steps[steps.length - 1]!.dx)), `${name}: the left column after the release`).toBeLessThanOrEqual(20)
            }
          }
        })
      }

      if (width === 1280) {
        it('a table that fits its frame has the strip of the right edge too: n strips for n columns', { timeout: 200_000 }, () => {
          const a = run('k4-plain').ops[0]!.after!
          expect(a.strips, 'strips of borders').toHaveLength(4)
          const last = a.strips.find((s) => s.n === '4')
          expect(last, 'the strip of the border 4').toBeDefined()
          expect(Math.abs(last!.x - a.lastRight), 'the strip at the right edge of the last cell').toBeLessThanOrEqual(3)
          expect(Math.abs(last!.x - a.frameRight), 'the strip at the right edge of the frame').toBeLessThanOrEqual(3)
          expect(last!.cursor).toBe('col-resize')
        })
      }

      if (width === 700 || width === 1280) {
        it('plain tables fit and the wide document keeps its natural layout before a drag', { timeout: 200_000 }, () => {
          for (const id of ['k7-plain4', 'k7-5-95']) {
            const a = run(id).ops[0]!.after!
            expect(a.sw, `${id}: scrolls sideways`).toBeLessThanOrEqual(a.cw + 1)
          }
          const wa = run('k7-wide').ops[0]!.after!
          expect(wa.widths).toHaveLength(7)
          expect(wa.widths.every((w) => w >= MIN)).toBe(true)
          expect(Math.abs(sum(wa.widths) - wa.tw)).toBeLessThanOrEqual(wa.widths.length / 2 + 1)
          expect(wa.cls.split(' ')).not.toContain('tbl-fixed')
          expect(wa.style).toBe('')
          expect(wa.cols.every((col) => col === '')).toBe(true)
        })
      }

      if (width === TAB) {
        for (const s of sources()) {
          const n = s.ncols
          const follows = (name: string, r: OpOut, down = false): void => {
            const dir = Math.sign(r.op.dxs![0]!)
            let prev = r.x0!
            for (const st of r.steps!) {
              // As the right edge shrinks the scroll offset can fall with it. Measure the edge in table coordinates.
              const edge = st.ov! + (down ? st.sl - r.before!.sl : 0)
              expect((edge - prev) * dir, `${name} dx=${st.dx}: against the mouse`).toBeGreaterThanOrEqual(-1)
              prev = edge
              if (!st.lim && !(down && st.tag === 'Ширина рамки')) expect(Math.abs(edge - (r.x0! + st.dx)), `${name} dx=${st.dx}: far from the mouse`).toBeLessThanOrEqual(12)
            }
          }
          const written = (name: string, cols: string | undefined): number[] => {
            const w = ints(cols)
            expect(w, `${name}: cols`).toHaveLength(n)
            expect(w.every((x) => Number.isInteger(x) && x > 0), `${name}: whole percents`).toBe(true)
            expect(sum(w), `${name}: cols add up to 100`).toBe(100)
            return w
          }

          it(`${s.id}: the first column narrows by the mouse, stays narrow after the release, the code wraps in its cell`, { timeout: 200_000 }, () => {
            const r = run(`${s.id}-k1`).ops[0]!
            const name = `${s.id}`
            expect(r.error, name).toBeUndefined()
            follows(name, r)
            const b = r.before!
            const last = r.steps![r.steps!.length - 1]!
            expect(b.widths[0]! - last.widths[0]!, `${name}: the first column on the last step`).toBeGreaterThanOrEqual(108)
            expect(b.widths[0]! - last.widths[0]!, `${name}: the first column on the last step`).toBeLessThanOrEqual(132)
            const a = r.after!
            expect(Math.abs(a.widths[0]! - last.widths[0]!), `${name}: the first column after the release (${last.widths[0]} → ${a.widths[0]})`).toBeLessThanOrEqual(Math.max(8, last.tw / 100))
            // (the widths are written as whole percents: the tolerance is «8 px or 1 % of the table, whichever is more»)
            expect(Math.abs(a.real - (r.x0! + last.dx)), `${name}: the border after the release`).toBeLessThanOrEqual(12)
            const w = written(name, r.cols1)
            expect(w[0]!, `${name}: the share of the first column`).toBeLessThan((100 * b.widths[0]!) / b.tw)
            expect(r.edits, name).toBe(1)
            // the code wraps inside the cell
            for (const [label, snap] of [['last step', last], ['after', a]] as const) {
              snap.fit.forEach((f, k) => {
                expect(f.over, `${name} ${label}: cell ${k} is wider than its <col>`).toBeLessThanOrEqual(2)
                expect(f.scroll, `${name} ${label}: the content of cell ${k} is wider than the cell`).toBeLessThanOrEqual(1)
              })
            }
          })

          it(`${s.id}: to the very end: 64 px, the neighbour gives way when the table is as wide as its frame`, { timeout: 200_000 }, () => {
            const [d, t] = run(`${s.id}-k2`).ops
            const r = d!
            const name = `${s.id}`
            expect(r.error, name).toBeUndefined()
            follows(name, r)
            const w0 = r.before!.widths
            const tw0 = r.before!.tw
            let seenFrame = false
            for (const st of r.steps!) {
              if (st.tw > st.cw + 2) {
                if (!seenFrame && !st.lim) {
                  expect(Math.abs(st.widths[1]! - w0[1]!), `${name} dx=${st.dx}: neighbour`).toBeLessThanOrEqual(2)
                  expect(Math.abs(tw0 - st.tw + st.dx), `${name} dx=${st.dx}: the table narrows by the mouse`).toBeLessThanOrEqual(12)
                }
              } else {
                seenFrame = true
                expect(Math.abs(st.tw - st.cw), `${name} dx=${st.dx}: the table is the frame`).toBeLessThanOrEqual(2)
              }
            }
            const last = r.steps![r.steps!.length - 1]!
            expect(Math.abs(last.widths[0]! - MIN), `${name}: the first column at the stop`).toBeLessThanOrEqual(2)
            expect(last.lim, `${name}: class limit`).toBe(true)
            expect(last.tag).toBe('Минимальная ширина')
            if (seenFrame) expect(last.widths[1]!, `${name}: the neighbour took the rest`).toBeGreaterThan(w0[1]! + 10)
            expect(r.after!.widths[0]!, `${name}: after the release`).toBeGreaterThanOrEqual(MIN)
            expect(r.after!.widths[0]!, `${name}: after the release`).toBeLessThanOrEqual(72)
            expect(t!.after!.widths[0]!, `${name}: after an edit of another column`).toBeGreaterThanOrEqual(MIN)
            expect(t!.after!.widths[0]!, `${name}: after an edit of another column`).toBeLessThanOrEqual(72)
            written(name, r.cols1)
          })

          it(`${s.id}: every border, 40 px to the right and 80 to the left, also in a table wider than its frame`, { timeout: 200_000 }, () => {
            const drags = run(`${s.id}-k3`).ops
            expect(drags).toHaveLength(14)
            for (const r of drags) {
              const b = r.op.border!
              const name = `${s.id} b${b} ${r.op.dxs![r.op.dxs!.length - 1]}px`
              expect(r.error, name).toBeUndefined()
              follows(name, r)
              const steps = r.steps!
              const last = steps[steps.length - 1]!
              steps.forEach((st) => {
                if (st.lim) expect(st.widths[b - 1]!, `${name} dx=${st.dx}: a stop above 64 px`).toBeLessThanOrEqual(MIN + 2)
              })
              // (the widths are written as whole percents; the running sums are rounded, so each border is off by at most half a percent of the table,
              // each column by at most one percent: «8 px or 1 %» for the column, «8 px or 0.5 % plus a few px of layout» for every border)
              const colPx = Math.max(8, last.tw / 100)
              const edgePx = Math.max(8, last.tw / 200) + 3
              const edge = (s: { widths: number[] }, k: number) => s.widths.slice(0, k).reduce((x, y) => x + y, 0)
              for (let k = 1; k <= b; k++) {
                expect(Math.abs(edge(r.after!, k) - edge(last, k)), `${name}: the border ${k} after the release (table ${last.tw} → ${r.after!.tw}; cols ${r.cols1})`).toBeLessThanOrEqual(edgePx)
              }
              expect(Math.abs(r.after!.widths[b - 1]! - last.widths[b - 1]!), `${name}: the left column after the release (${last.widths[b - 1]} → ${r.after!.widths[b - 1]})`).toBeLessThanOrEqual(colPx)
              expect(r.edits, `${name}: edits`).toBe(1)
              written(name, r.cols1)
            }
          })

          it(`${s.id}: the last column has a border at its right edge when the frame is scrolled to the end`, { timeout: 200_000 }, () => {
            const o = run(`${s.id}-k4`).ops[0]!
            expect(o.sl!, 'the frame is scrolled to the end').toBeGreaterThan(0)
            const a = o.after!
            const strip = a.strips.find((x) => x.n === String(n))
            expect(strip, `the strip of the border ${n} (${a.strips.map((x) => x.n).join(',')})`).toBeDefined()
            expect(Math.abs(strip!.x - a.lastRight), 'the strip at the right edge of the last cell').toBeLessThanOrEqual(3)
            expect(strip!.cursor).toBe('col-resize')
            expect(strip!.title, 'no system title').toBe('')
            expect(strip!.label).toBe('Ширина колонок: тяните · двойной щелчок — поровну')
          })

          it(`${s.id}: the right edge: to the right the last column and the table grow, Undo gives the file back`, { timeout: 200_000 }, () => {
            const [, d, undo, redo] = run(`${s.id}-k5r`).ops
            const r = d!
            const name = `${s.id} right`
            expect(r.error, name).toBeUndefined()
            follows(name, r)
            const b = r.before!
            const last = r.steps![r.steps!.length - 1]!
            expect(last.widths[n - 1]! - b.widths[n - 1]!, `${name}: the last column`).toBeGreaterThanOrEqual(48)
            expect(last.widths[n - 1]! - b.widths[n - 1]!, `${name}: the last column`).toBeLessThanOrEqual(72)
            for (let k = 0; k < n - 1; k++) expect(Math.abs(last.widths[k]! - b.widths[k]!), `${name}: column ${k}`).toBeLessThanOrEqual(2)
            expect(last.tw - b.tw, `${name}: the table`).toBeGreaterThanOrEqual(48)
            expect(last.tw - b.tw, `${name}: the table`).toBeLessThanOrEqual(72)
            expect(r.steps!.some((st) => st.tag === 'Минимальная ширина'), `${name}: a stop`).toBe(false)
            expect(Math.abs(r.after!.widths[n - 1]! - last.widths[n - 1]!), `${name}: after the release`).toBeLessThanOrEqual(Math.max(8, last.tw / 100))
            written(name, r.cols1)
            expect(r.edits).toBe(1)
            expect(undo!.text, 'Undo gives the text of the file').toBe(s.text)
            expect(Math.abs(undo!.after!.tw - b.tw), 'the table after Undo').toBeLessThanOrEqual(2)
            expect(redo!.cols1, 'Redo gives the cols of the drag').toBe(r.cols1)
          })

          it(`${s.id}: the right edge to the left: the last column and the table narrow, then the edge stops at the least width`, { timeout: 200_000 }, () => {
            const r = run(`${s.id}-k5l`).ops[3]!
            const name = `${s.id} left`
            expect(r.error, name).toBeUndefined()
            const b = r.before!
            const last = r.steps![r.steps!.length - 1]!
            expect(b.widths[n - 1]! - last.widths[n - 1]!, `${name}: the last column`).toBeGreaterThanOrEqual(48)
            expect(b.widths[n - 1]! - last.widths[n - 1]!, `${name}: the last column`).toBeLessThanOrEqual(72)
            for (let k = 0; k < n - 1; k++) expect(Math.abs(last.widths[k]! - b.widths[k]!), `${name}: column ${k}`).toBeLessThanOrEqual(2)
            expect(b.tw - last.tw, `${name}: the table`).toBeGreaterThanOrEqual(48)
            expect(b.tw - last.tw, `${name}: the table`).toBeLessThanOrEqual(72)
            expect(Math.abs(r.after!.widths[n - 1]! - last.widths[n - 1]!), `${name}: after the release`).toBeLessThanOrEqual(Math.max(8, last.tw / 200))
            // (the other columns: half a percent of rounding each and what the columns at 64 px take back)
            for (let k = 0; k < n - 1; k++) expect(Math.abs(r.after!.widths[k]! - last.widths[k]!), `${name}: column ${k} after the release (last ${last.widths.join("/")} tw=${last.tw}, after ${r.after!.widths.join("/")} tw=${r.after!.tw}, cols ${r.cols1})`).toBeLessThanOrEqual(Math.max(8, last.tw / 100))
            expect(r.edits, `${name}: edits`).toBe(1)
            written(name, r.cols1)

            // (the last column of 81 px reaches 64 px long before the frame: the stop is «Minimum width»)
            const m = run(`${s.id}-k5m`).ops[1]!
            const mname = `${s.id} least`
            expect(m.error, mname).toBeUndefined()
            follows(mname, m, true)
            const mend = m.steps![m.steps!.length - 1]!
            expect(mend.tag, mname).toBe('Минимальная ширина')
            expect(mend.lim, `${mname}: class limit`).toBe(true)
            expect(Math.abs(mend.widths[n - 1]! - MIN), `${mname}: the last column at the stop`).toBeLessThanOrEqual(2)
            expect(m.steps!.some((st) => st.tag === 'Ширина рамки'), `${mname}: the stop at the frame`).toBe(false)
          })

          it(`${s.id}: the scroll bar of the frame is in the window, its end brings the frame to its end; the wheel works as before`, { timeout: 200_000 }, () => {
            const [probe, end, wheel] = run(`${s.id}-k6`).ops
            const bar = probe!.after!.bar
            expect(bar, 'the bar').not.toBeNull()
            expect(bar!.shown, 'the bar is shown').toBe(true)
            expect(bar!.top, 'the bar is in the window').toBeGreaterThanOrEqual(0)
            expect(bar!.bottom, `the bar is in the window (${bar!.bottom} of ${probe!.after!.vh})`).toBeLessThanOrEqual(probe!.after!.vh)
            expect(end!.sl! + 1, 'the frame is at its end').toBeGreaterThanOrEqual(end!.max!)
            const a = end!.after!
            expect(a.strips.some((x) => x.n === String(n)), 'the right border is in the window').toBe(true)
            expect(a.lastRight, 'the last column is in the window').toBeLessThanOrEqual(a.frameRight + 1)
            const [w0, w1, w2] = wheel!.wheel!
            expect(w1!, 'deltaX scrolls the frame').toBeGreaterThan(w0!)
            expect(w2!, 'Shift+wheel scrolls the frame').toBeGreaterThan(w1!)
          })
        }

        it('the right edge to the left stops at the right edge of the frame: «Frame width», limit, never against the mouse', { timeout: 200_000 }, () => {
          const [out, , back] = run('plain-k5f').ops
          expect(out!.error).toBeUndefined()
          expect(back!.error).toBeUndefined()
          // (the first drag made the table wider than its frame)
          expect(out!.after!.sw, 'wider than the frame after the first drag').toBeGreaterThan(out!.after!.cw + 50)
          let prev = back!.x0!
          for (const st of back!.steps!) {
            expect(prev - st.ov!, `dx=${st.dx}: against the mouse`).toBeGreaterThanOrEqual(-1)
            prev = st.ov!
          }
          const stop = back!.steps!.find((st) => st.tag === 'Ширина рамки')
          expect(stop, `the stop at the frame (${back!.steps!.map((st) => st.tag || '-').join('|')})`).toBeDefined()
          expect(stop!.lim, 'class limit').toBe(true)
          expect(Math.abs(stop!.tw - stop!.cw), 'the table is as wide as the frame').toBeLessThanOrEqual(2)
          expect(Math.abs(stop!.ov! - (back!.before!.frameRight - 1)), 'the edge is at the right edge of the frame').toBeLessThanOrEqual(3)
          const end = back!.steps![back!.steps!.length - 1]!
          expect(Math.abs(end.tw - end.cw), 'the table does not get narrower than the frame').toBeLessThanOrEqual(2)
          expect(end.tag).toBe('Ширина рамки')
          expect(back!.edits, 'edits').toBe(1)
          const tol = Math.max(8, end.tw / 100)
          end.widths.forEach((w, k) => expect(Math.abs(back!.after!.widths[k]! - w), `column ${k} after the release`).toBeLessThanOrEqual(tol))
          expect(Math.abs(back!.after!.tw - end.tw), 'the table after the release').toBeLessThanOrEqual(tol)
        })
      }

      if (width === 700) {
        it('every border, to the right by 40 px and back: it follows the mouse, no stop, the table grows and narrows', { timeout: 200_000 }, () => {
          for (const id of ['k3-file', 'k3-wide']) {
            const drags = run(id).ops.filter((r) => r.op.k === 'drag')
            expect(drags).toHaveLength(12)
            for (const r of drags) {
              const b = r.op.border!
              const dir = Math.sign(r.op.dxs![0]!)
              const name = `${id} b${b} ${dir > 0 ? '+' : '-'}40`
              expect(r.error, name).toBeUndefined()
              let prev = r.x0!
              for (const s of r.steps!) {
                expect((s.ov! - prev) * dir, `${name} dx=${s.dx}: against the mouse`).toBeGreaterThanOrEqual(-0.5)
                expect(Math.abs(s.ov! - (r.x0! + s.dx)), `${name} dx=${s.dx}: far from the mouse`).toBeLessThanOrEqual(12)
                expect(s.lim || s.tag === 'Минимальная ширина', `${name} dx=${s.dx}: a stop`).toBe(false)
                prev = s.ov!
              }
              const last = r.steps![r.steps!.length - 1]!
              const w0 = r.before!.widths
              if (dir > 0) {
                expect(last.widths[b - 1]! - w0[b - 1]!, `${name}: left`).toBeGreaterThanOrEqual(28)
                expect(last.widths[b - 1]! - w0[b - 1]!, `${name}: left`).toBeLessThanOrEqual(52)
                expect(Math.abs(last.widths[b]! - w0[b]!), `${name}: neighbour`).toBeLessThanOrEqual(2)
                expect(last.tw - r.before!.tw, `${name}: table`).toBeGreaterThanOrEqual(28)
                expect(last.tw - r.before!.tw, `${name}: table`).toBeLessThanOrEqual(52)
              } else {
                expect(Math.abs(last.widths[b]! - w0[b]!), `${name}: neighbour`).toBeLessThanOrEqual(2)
                expect(r.before!.tw - last.tw, `${name}: table`).toBeGreaterThanOrEqual(28)
              }
              expect(r.edits, `${name}: edits`).toBe(1)
              const cols = ints(r.cols1)
              expect(cols, name).toHaveLength(7)
              expect(cols.every((n) => Number.isInteger(n) && n > 0)).toBe(true)
              expect(sum(cols), name).toBe(100)
              expect(Math.abs(r.after!.real - last.real), `${name}: the border after the release`).toBeLessThanOrEqual(12)
              expect(Math.abs(r.after!.tw - last.tw), `${name}: the table after the release`).toBeLessThanOrEqual(8)
              if (dir > 0) expect(r.after!.sl, `${name}: scrollLeft`).toBeGreaterThanOrEqual(last.sl - 1)
            }
          }
        })

        it('back to the left: the table narrows to its frame, then the neighbour gives way, no stop above 64 px', { timeout: 200_000 }, () => {
          const [out, back] = run('k6').ops
          expect(out!.after!.sw, 'wider after the first drag').toBeGreaterThan(out!.after!.cw + 1)
          const w0 = out!.after!.widths
          const tw0 = out!.after!.tw
          let prev = back!.x0!
          for (const s of back!.steps!) {
            expect((prev - s.ov!), `dx=${s.dx}: against the mouse`).toBeGreaterThanOrEqual(-0.5)
            prev = s.ov!
            if (s.widths[1]! > MIN + 2) expect(s.lim, `dx=${s.dx}: a stop above 64 px`).toBe(false)
            if (s.tw > s.cw + 2) {
              expect(Math.abs(s.widths[2]! - w0[2]!), `dx=${s.dx}: neighbour`).toBeLessThanOrEqual(2)
              expect(Math.abs(tw0 - s.tw + s.dx), `dx=${s.dx}: the table narrows by the mouse`).toBeLessThanOrEqual(12)
            } else {
              expect(Math.abs(s.tw - s.cw), `dx=${s.dx}: the table is the frame`).toBeLessThanOrEqual(2)
            }
          }
          const l = back!.steps![back!.steps!.length - 1]!
          expect(l.sw, 'no scroll at the end').toBeLessThanOrEqual(l.cw + 1)
          expect(l.widths[2]!, 'the neighbour took the rest').toBeGreaterThan(w0[2]! + 10)
        })

        it('the table keeps its width after an edit and the file is opened again with the same cols and a wider left column', { timeout: 200_000 }, () => {
          const [d, t] = run('k9').ops
          const re = run('k9-reopen').ops[0]!
          const drag = d!
          expect(Math.abs(t!.after!.tw - drag.after!.tw), 'the table after an edit').toBeLessThanOrEqual(8)
          expect(ints(t!.cols1)).toEqual(ints(drag.cols1))
          expect(ints(/cols="([^"]*)"/.exec(t!.text!)?.[1]), 'cols after reopening').toEqual(ints(drag.cols1))
          expect(re.before!.widths.every((w) => w >= MIN - 1), 'no column under 64 px').toBe(true)
          expect(re.before!.widths[0]! - drag.before!.widths[0]!, 'the left column is wider than before the drag').toBeGreaterThanOrEqual(20)
        })

        it('Undo gives the text and the widths as they were, Redo the drag again', { timeout: 200_000 }, () => {
          const o = run('k10')
          const [d1, undo, redo, d2, undo2] = o.ops
          const text0 = attributes(40, '12,12,12,14,12,12,26')
          expect(undo!.text, 'the text after Undo is the text of the file').toBe(text0)
          const b = d1!.before!
          for (let k = 0; k < b.widths.length; k++) expect(Math.abs(undo!.after!.widths[k]! - b.widths[k]!), `column ${k} after Undo`).toBeLessThanOrEqual(2)
          expect(Math.abs(undo!.after!.tw - b.tw)).toBeLessThanOrEqual(2)
          if (b.sw <= b.cw + 1) expect(undo!.after!.sw, 'no scroll after Undo').toBeLessThanOrEqual(undo!.after!.cw + 1)
          expect(redo!.cols1, 'Redo gives the cols of the drag').toBe(d1!.cols1)
          expect(redo!.after!.tw - b.tw, 'the table is wider again').toBeGreaterThanOrEqual(28)
          expect(redo!.after!.tw - b.tw).toBeLessThanOrEqual(52)
          // (two drags and one Undo: the text and the table as after the first drag)
          expect(undo2!.text).toBe(redo!.text)
          expect(Math.abs(undo2!.after!.tw - redo!.after!.tw), 'the table after the second Undo').toBeLessThanOrEqual(8)
          void d2
        })

        it('wide.adoc (`cols="9"`): Undo gives the file back, Redo the width of the drag', { timeout: 200_000 }, () => {
          const [d1, undo, redo] = run('k10-wide').ops
          const text0 = readFileSync(at('../../../../quality/fixtures/editor/wide.adoc'), 'utf8')
          expect(undo!.text).toBe(text0)
          const b = d1!.before!
          expect(Math.abs(undo!.after!.tw - b.tw), 'the table after Undo').toBeLessThanOrEqual(2)
          expect(redo!.cols1).toBe(d1!.cols1)
          expect(redo!.after!.tw - b.tw, 'the table is wider again').toBeGreaterThanOrEqual(28)
          expect(redo!.after!.tw - b.tw).toBeLessThanOrEqual(52)
        })

        it('a double click at the border of a table that was dragged wider keeps its width', { timeout: 200_000 }, () => {
          const [d, dbl] = run('k8-dbl').ops
          expect(dbl!.edits, 'the double click writes the widths').toBeGreaterThan(0)
          expect(Math.abs(dbl!.after!.tw - d!.after!.tw), 'the table after the double click').toBeLessThanOrEqual(2)
          expect(dbl!.after!.tw - d!.before!.tw, 'still wider than before the drag').toBeGreaterThanOrEqual(28)
        })
      }
    })
  }
})
