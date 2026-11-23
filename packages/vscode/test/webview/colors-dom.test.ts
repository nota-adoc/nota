// the colour of the new roles in the rendered DOM of the tab (paragraph, heading, list item) in both themes;
// a table cell stays source text of the plain colour (its text has no marks until cell text is edited in place).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type Page, startPage } from '../../src/webview/main.js'
import type { ToHost, ToTab } from '../../src/protocol.js'

const CSS = readFileSync(join(import.meta.dirname, '../../src/webview/style.css'), 'utf8')
const VALUES = {
  light: { orange: '#b45309', purple: '#7e22ce', pink: '#be1a80', teal: '#0f766e' },
  dark: { orange: '#f5a35c', purple: '#c9a2ff', pink: '#f58ad6', teal: '#45d9d0' },
}
const ROLES = ['orange', 'purple', 'pink', 'teal'] as const

let root: HTMLElement
let page: Page | undefined
let style: HTMLStyleElement

const SRC = [
  '= Цвета',
  '',
  'Абзац [.hl-orange]#оранжевый# [.hl-purple]#фиолетовый# [.hl-pink]#розовый# [.hl-teal]#бирюзовый#',
  '',
  '== Заголовок [.hl-orange]#оранжевый# [.hl-purple]#фиолетовый# [.hl-pink]#розовый# [.hl-teal]#бирюзовый#',
  '',
  '* Пункт [.hl-orange]#оранжевый# [.hl-purple]#фиолетовый# [.hl-pink]#розовый# [.hl-teal]#бирюзовый#',
  '',
  '|===',
  '|Ячейка',
  '',
  '|[.hl-orange]#в работе#',
  '|===',
  '',
].join('\n')

beforeEach(() => {
  vi.useFakeTimers()
  document.body.className = ''
  document.elementFromPoint = () => null
  style = document.createElement('style')
  style.textContent = CSS
  document.head.append(style)
  root = document.createElement('div')
  root.id = 'app'
  document.body.append(root)
  const api = { postMessage: (_: ToHost) => undefined }
  page = startPage(api, root, { mac: false })
  const message: ToTab = { type: 'init', text: SRC, version: 1, fileName: 'a.adoc', locale: 'ru', outlineView: 'capsule', fileDir: '/work/docs', mode: 'visual' }
  window.dispatchEvent(new MessageEvent('message', { data: message }))
  page.flush()
})
afterEach(() => {
  page?.destroy()
  style.remove()
  document.body.textContent = ''
  delete document.body.dataset.notaTheme
  vi.useRealTimers()
})

/** the colour the element gets on the screen: the rule of the sheet gives var(--ap-tx-…), the token is read from the body of the theme */
function colorOf(el: Element): string {
  const raw = getComputedStyle(el).color
  const name = /^var\((--[\w-]+)\)$/.exec(raw)?.[1]
  return name ? getComputedStyle(document.body).getPropertyValue(name).trim() || raw : raw
}
const piece = (block: string, role: string): Element => {
  const el = [...root.querySelectorAll(`${block} .hl-${role}`)][0]
  if (!el) throw new Error(`no .hl-${role} in ${block}`)
  return el
}

describe('the new colours in the rendered tab', () => {
  for (const theme of ['light', 'dark'] as const) {
    for (const [name, block] of [['a paragraph', 'p'], ['a heading', 'h2'], ['a list item', '.li-text']] as const) {
      it(`${name}: each piece has the colour of its token in the ${theme} theme`, () => {
        if (theme === 'dark') document.body.dataset.notaTheme = 'dark'
        for (const role of ROLES) {
          const el = piece(block, role)
          expect(el.textContent, role).toBeTruthy()
          expect(colorOf(el), `${theme} ${name} ${role}`).toBe(VALUES[theme][role])
        }
      })
    }
  }

  it('a table cell shows the piece in its colour, as a paragraph does', () => {
    const cell = [...root.querySelectorAll('td')].find((c) => c.textContent?.includes('в работе'))!
    expect(cell.textContent).not.toContain('[.hl-orange]')
    expect(cell.querySelector('[class*="hl-orange"]')?.textContent).toBe('в работе')
  })
})
