// the theme at the first open follows the system; the switch changes the whole page at once, the source included
// (in the colours of the series, not oneDark); a sample or a view does not reset it.
import { EditorView } from '@codemirror/view'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { choose, closePage, openPage, outgoing, read, stubNetwork, type Page } from './helpers.js'

beforeEach(() => {
  outgoing.length = 0
  stubNetwork()
})
afterEach(closePage)

const root = document.documentElement
const button = (): HTMLButtonElement => document.getElementById('theme') as HTMLButtonElement
const sourceIsDark = (page: Page): boolean => page.cm().state.facet(EditorView.darkTheme)
const click = (): void => void button().dispatchEvent(new MouseEvent('click', { bubbles: true }))

/** What the button shows: the state, the name and the tooltip, the moon or the sun. */
const shown = () => ({
  pressed: button().getAttribute('aria-pressed'),
  label: button().getAttribute('aria-label'),
  tip: button().dataset.tip,
  moon: button().querySelector('.moon')!.hasAttribute('hidden'),
  sun: button().querySelector('.sun')!.hasAttribute('hidden'),
})
const light = { pressed: 'false', label: 'Тёмная тема', tip: 'Тёмная тема', moon: false, sun: true }
const dark = { pressed: 'true', label: 'Светлая тема', tip: 'Светлая тема', moon: true, sun: false }

describe('demo: the theme', () => {
  it('follows a light system at the first open: nothing is chosen, the page is light', async () => {
    const page = await openPage({ dark: false })
    expect(root.hasAttribute('data-theme')).toBe(false)
    expect(shown()).toEqual(light)
    expect(sourceIsDark(page)).toBe(false)
  })

  it('follows a dark system at the first open: the button offers the light theme, and «Исходник» is dark', async () => {
    const page = await openPage({ dark: true })
    expect(root.hasAttribute('data-theme')).toBe(false)
    expect(shown()).toEqual(dark)
    expect(sourceIsDark(page)).toBe(true)
  })

  it('the switch changes the page and «Исходник» at once, and back', async () => {
    const page = await openPage({ dark: false })
    click()
    expect(root.dataset.theme).toBe('dark')
    expect(shown()).toEqual(dark)
    expect(sourceIsDark(page)).toBe(true)
    click()
    expect(root.dataset.theme).toBe('light')
    expect(shown()).toEqual(light)
    expect(sourceIsDark(page)).toBe(false)
  })

  it('from a dark system the first press gives the light theme', async () => {
    const page = await openPage({ dark: true })
    click()
    expect(root.dataset.theme).toBe('light')
    expect(shown()).toEqual(light)
    expect(sourceIsDark(page)).toBe(false)
  })

  it('a press is a click of a button, so the keyboard has it: a real button that says its state', async () => {
    await openPage()
    expect(button().tagName).toBe('BUTTON')
    expect(button().type).toBe('button')
    expect(button().hasAttribute('aria-pressed')).toBe(true)
    expect(button().getAttribute('aria-label')).toBeTruthy()
  })

  it('the system changing its theme is followed while the person has not chosen, and never over a choice', async () => {
    const page = await openPage({ dark: false })
    page.media.setDark(true)
    expect(shown()).toEqual(dark)
    expect(sourceIsDark(page)).toBe(true)
    page.media.setDark(false)
    expect(shown()).toEqual(light)
    expect(sourceIsDark(page)).toBe(false)
    // a choice: the system may change, the page stays
    click()
    expect(root.dataset.theme).toBe('dark')
    page.media.setDark(true)
    page.media.setDark(false)
    expect(root.dataset.theme).toBe('dark')
    expect(shown()).toEqual(dark)
    expect(sourceIsDark(page)).toBe(true)
  })

  it('a sample and a view do not reset it, in both windows', async () => {
    const page = await openPage({ dark: false })
    click()
    for (const id of ['all', 'diagnostics', 'inline']) {
      choose(page, id)
      expect(root.dataset.theme, id).toBe('dark')
      expect(shown(), id).toEqual(dark)
      expect(sourceIsDark(page), id).toBe(true)
    }
    for (const view of ['source', 'visual', 'split'] as const) {
      page.view(view)
      expect(root.dataset.theme, view).toBe('dark')
      expect(sourceIsDark(page), view).toBe(true)
    }
    // and a sample after a switch back to light
    click()
    choose(page, 'spec')
    expect(root.dataset.theme).toBe('light')
    expect(sourceIsDark(page)).toBe(false)
  })

  it('a dark system with no choice survives a sample too', async () => {
    const page = await openPage({ dark: true })
    choose(page, 'all')
    expect(root.hasAttribute('data-theme')).toBe(false)
    expect(sourceIsDark(page)).toBe(true)
    expect(shown()).toEqual(dark)
  })

  it('colours «Исходник» in the colours of the series: the tokens of the page, no oneDark', async () => {
    const page = await openPage()
    expect(read('src/main.ts')).not.toMatch(/one-?dark/i)
    expect(read('package.json')).not.toContain('theme-one-dark')
    // the ranges of the package are classes that read the tokens `--ap-*`; the page defines them in both themes
    expect(page.cm().dom.querySelectorAll('.cm-ap').length).toBeGreaterThan(5)
    const css = read('src/style.css')
    for (const token of ['--ap-heading-0', '--ap-delimiter', '--ap-list-marker', '--ap-source-bg', '--ap-active-line'])
      expect(css.match(new RegExp(`^\\s*${token}:`, 'gm'))!.length, token).toBeGreaterThanOrEqual(3)
    expect(css).toMatch(/\n#source\s*\{[^}]*background: var\(--ap-source-bg\)/)
  })
})
