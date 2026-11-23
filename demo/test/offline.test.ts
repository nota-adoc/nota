// nothing leaves the page. After the load and after every action there is no call to the network, the page and its code
// name no address outside localhost.
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { choose, closePage, demoDir, external, load, openPage, outgoing, read, selectAcross, selectPlate, selectText, stubNetwork, typeChar } from './helpers.js'

beforeEach(() => {
  outgoing.length = 0
  stubNetwork()
})
afterEach(closePage)

const sources = readdirSync(join(demoDir, 'src')).filter((f) => f.endsWith('.ts'))

describe('demo: nothing leaves the page', () => {
  it('makes no call to the network after the load and after every action of the page', async () => {
    const page = await openPage()
    expect(outgoing).toEqual([])
    // the samples, the views, the theme
    for (const id of [...page.sample.options].map((o) => o.value).filter((v) => v !== 'large')) choose(page, id)
    for (const view of ['source', 'visual', 'split'] as const) page.view(view)
    document.getElementById('theme')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    page.media.setDark(true)
    // «Визуально»: the toolbar, the link field, the refusals, the history
    choose(page, 'spec')
    selectText(page, 'приоритет')
    for (const cmd of ['strong', 'em', 'code', 's', 'mark', 'undo', 'redo']) page.press(cmd)
    selectText(page, 'приоритет')
    page.press('link')
    ;(document.getElementById('link-url') as HTMLInputElement).value = 'https://example.org/x'
    document.getElementById('link-apply')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    page.press('unlink')
    selectAcross(page, 'открывается', 'Подробности')
    page.visual().commands.setLink('https://example.org/x')
    selectPlate(page, 'DelimitedBlock')
    typeChar(page, 'x')
    // «Исходник»: typing, the cursor, the lint
    const view = page.cm()
    view.focus()
    view.dispatch({ changes: { from: 0, insert: '{' }, userEvent: 'input.type' })
    view.dispatch({ selection: { anchor: 3 } })
    // the file: opened and saved, the address of the saved one is the page's own
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: () => 'blob:demo/1' })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: () => {} })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    await load(page, '= Файл\n', 'notes.adoc')
    document.getElementById('download')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await new Promise((resolve) => setTimeout(resolve, 300)) // the lint of the editor waits 250 ms
    expect(outgoing).toEqual([])
  })

  it('has no resource of the page that points outside: scripts, styles and images are relative or inline', async () => {
    await openPage()
    // a link in the text of the sample is content, and a click on it is the person's: it is not a resource the page loads
    for (const el of document.querySelectorAll('link[href], script[src], img[src], iframe[src], form[action], [src]'))
      for (const attr of ['src', 'href', 'action'])
        expect(el.getAttribute(attr) ?? '', `${el.tagName} ${attr}`).not.toMatch(/^(?:[a-z][a-z0-9+.-]*:)?\/\//i)
    const html = read('index.html')
    expect(html).not.toMatch(/<(?:script|link|img|iframe)\b[^>]*\b(?:src|href)=["'](?!\.\/|data:|#)/i)
  })

  it('names no address outside localhost in index.html and in the code of the page', () => {
    const html = read('index.html')
    // the namespace of an SVG or an example in a comment is not a request; the page has neither
    expect(html.match(new RegExp(external, 'gi')) ?? []).toEqual([])
    expect(sources).toEqual(expect.arrayContaining(['main.ts', 'samples.ts', 'toolbar.ts', 'link.ts', 'notice.ts', 'theme.ts', 'status.ts', 'xref.ts']))
    for (const file of sources) {
      // the examples of the samples and of the link field are the reserved example.org
      const addresses = (read(`src/${file}`).match(new RegExp(external, 'gi')) ?? []).filter((a) => !/example\.(?:org|com)/.test(a))
      expect(addresses, file).toEqual([])
    }
  })

  it('has no call in its code that could reach the network: no fetch, no request, no socket, no beacon, no import of a page', () => {
    for (const file of sources)
      for (const call of ['fetch(', 'XMLHttpRequest', 'WebSocket', 'sendBeacon', 'EventSource', '@import', 'import('])
        expect(read(`src/${file}`), `${file}: ${call}`).not.toContain(call)
  })
})
