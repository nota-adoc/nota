// «Ссылка» asks for the address in a field on the page (not in `prompt`), and puts the link where the words were selected.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { choose, closePage, cursorIn, fixture, key, openPage, outgoing, selectAcross, selectText, stubNetwork } from './helpers.js'

beforeEach(() => {
  outgoing.length = 0
  stubNetwork()
})
afterEach(closePage)

const start = fixture('editor/visual.adoc')
const LINK_ACROSS = 'Ссылку можно поставить только на текст одного абзаца: выделите слова внутри одного абзаца.'

async function withWord() {
  const page = await openPage()
  selectText(page, 'приоритет')
  page.press('link')
  const input = page.$<HTMLInputElement>('link-url')
  const pop = page.$('linkpop')
  return { page, input, pop }
}

describe('demo: the field of the address of a link', () => {
  it('opens a field on the page, not the prompt of the browser: «Адрес ссылки», https://, the hint, «Поставить»', async () => {
    const prompt = vi.spyOn(window, 'prompt').mockReturnValue('https://example.org/never')
    const page = await openPage()
    expect(page.$('linkpop').hidden).toBe(true)
    selectText(page, 'приоритет')
    page.press('link')
    const { input, pop } = { input: page.$<HTMLInputElement>('link-url'), pop: page.$('linkpop') }
    expect(pop.hidden).toBe(false)
    expect(pop.getAttribute('role')).toBe('dialog')
    expect(pop.querySelector('label')!.textContent).toBe('Адрес ссылки')
    expect(pop.querySelector('label')!.getAttribute('for')).toBe('link-url')
    expect(input.value).toBe('https://')
    expect(page.$('link-apply').textContent).toBe('Поставить')
    expect(pop.querySelector('.hint')!.textContent).toBe(
      'Подойдёт https://…, #раздел, документ.adoc#раздел или путь. Enter — поставить, Esc — закрыть.',
    )
    // the field has the focus, the cursor is after https://
    expect(document.activeElement).toBe(input)
    expect([input.selectionStart, input.selectionEnd]).toEqual([8, 8])
    expect(page.btn('link').getAttribute('aria-expanded')).toBe('true')
    // it sits in the window of «Визуально», under the toolbar
    expect(pop.closest('.pane-visual')).not.toBeNull()
    expect(pop.style.top).not.toBe('')
    expect(prompt).not.toHaveBeenCalled()
    expect(page.text()).toBe(start)
  })

  it('Enter puts the link: the source shows адрес[слово], the field closes, the cursor is back in the text', async () => {
    const { page, input, pop } = await withWord()
    input.value = 'https://example.org/x'
    const enter = key(input, 'Enter')
    expect(enter.defaultPrevented).toBe(true)
    expect(page.text()).toBe(start.replace('приоритет', 'https://example.org/x[приоритет]'))
    expect(page.cm().state.doc.toString()).toBe(page.text())
    expect(pop.hidden).toBe(true)
    expect(page.btn('link').getAttribute('aria-expanded')).toBe('false')
    expect(page.pm().hasFocus()).toBe(true)
    expect(page.pressed('link')).toBe('true')
    expect(page.notice()).toBeNull()
    // and «Убрать ссылку» takes it back
    page.press('unlink')
    expect(page.text()).toBe(start)
  })

  it('«Поставить» does what Enter does', async () => {
    const { page, input, pop } = await withWord()
    input.value = '#acceptance'
    page.$('link-apply').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(page.text()).toBe(start.replace('приоритет', '<<acceptance,приоритет>>'))
    expect(pop.hidden).toBe(true)
    expect(page.pm().hasFocus()).toBe(true)
  })

  it('a link is not made while a word of the address is being composed (IME): Enter that picks a candidate is not Enter', async () => {
    const { page, input, pop } = await withWord()
    input.value = 'https://example.org/x'
    const event = new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true })
    input.dispatchEvent(event)
    expect(page.text()).toBe(start)
    expect(pop.hidden).toBe(false)
  })

  it('Esc closes the field, the text is as it was, the selection is back in the editor', async () => {
    const { page, input, pop } = await withWord()
    input.value = 'https://example.org/x'
    key(input, 'Escape')
    expect(pop.hidden).toBe(true)
    expect(page.text()).toBe(start)
    expect(page.btn('link').getAttribute('aria-expanded')).toBe('false')
    expect(page.pm().hasFocus()).toBe(true)
    const { from, to } = page.pm().state.selection
    expect(page.pm().state.doc.textBetween(from, to)).toBe('приоритет')
    // the next time the field starts anew
    page.press('link')
    expect(page.$<HTMLInputElement>('link-url').value).toBe('https://')
  })

  it('a click elsewhere closes the field, the text is as it was', async () => {
    const { page, input, pop } = await withWord()
    input.value = 'https://example.org/x'
    page.$('len').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    expect(pop.hidden).toBe(true)
    expect(page.text()).toBe(start)
    expect(page.btn('link').getAttribute('aria-expanded')).toBe('false')
    // a click inside the field is not elsewhere
    page.press('link')
    input.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    expect(pop.hidden).toBe(false)
  })

  it('leaving the field with the keyboard closes it too, and a new sample does', async () => {
    const { page, pop } = await withWord()
    page.$('link-apply').focus()
    expect(pop.hidden).toBe(false)
    page.btn('em').focus()
    expect(pop.hidden).toBe(true)
    page.press('link')
    expect(pop.hidden).toBe(false)
    choose(page, 'inline')
    expect(pop.hidden).toBe(true)
    expect(page.btn('link').getAttribute('aria-expanded')).toBe('false')
  })

  it('shows the address of a link that is selected as it is, and changes it', async () => {
    const page = await openPage()
    selectText(page, 'политика данных')
    page.press('link')
    const input = page.$<HTMLInputElement>('link-url')
    expect(input.value).toBe('legal/policy.html')
    input.value = 'https://example.org/policy'
    key(input, 'Enter')
    expect(page.text()).toBe(start.replace('link:legal/policy.html[политика данных]', 'https://example.org/policy[политика данных]'))
    // a cursor in plain text or in a link only: plain text starts with https://
    cursorIn(page, 'Кабинет открывается', 3)
    page.press('link')
    expect(page.$<HTMLInputElement>('link-url').value).toBe('https://')
  })

  it('refuses a link over two paragraphs: the message says why, the text is as it was, the field is closed', async () => {
    const page = await openPage()
    selectAcross(page, 'открывается', 'Подробности')
    page.press('link')
    const input = page.$<HTMLInputElement>('link-url')
    input.value = 'https://example.org/x'
    key(input, 'Enter')
    expect(page.notice()).toBe(LINK_ACROSS)
    expect(page.text()).toBe(start)
    expect(page.$('linkpop').hidden).toBe(true)
    expect(page.pm().hasFocus()).toBe(true)
  })

  it('refuses an address that is no address, and the text is as it was', async () => {
    const { page, input } = await withWord()
    input.value = ''
    key(input, 'Enter')
    expect(page.notice()).toBe('Этот адрес для ссылки не подходит.')
    expect(page.text()).toBe(start)
  })

  it('does not touch the network', async () => {
    const { page, input } = await withWord()
    input.value = 'https://example.org/x'
    key(input, 'Enter')
    expect(page.text()).toContain('https://example.org/x[приоритет]')
    expect(outgoing).toEqual([])
  })
})
