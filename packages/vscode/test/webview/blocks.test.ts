// In the tab: pictures of the folder of the file, the colours of code, islands, the strip.
import { TextSelection } from 'prosemirror-state'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type Page, startPage } from '../../src/webview/main.js'
import { highlightCode } from '../../src/webview/highlight.js'
import { pathForDocument, resolveImage } from '../../src/webview/images.js'
import type { ToHost, ToTab } from '../../src/protocol.js'

let sent: ToHost[]
let root: HTMLElement
let page: Page | undefined
const api = { postMessage: (m: ToHost) => void sent.push(m) }
const host = (message: ToTab): void => void window.dispatchEvent(new MessageEvent('message', { data: message }))

function open(text: string, extra: Partial<Extract<ToTab, { type: 'init' }>> = {}): Page {
  root = document.createElement('div')
  document.body.append(root)
  page = startPage(api, root)
  host({ type: 'init', text, version: 1, fileName: 'a.adoc', locale: 'ru', outlineView: 'capsule', fileDir: '/work/docs', mode: 'visual', ...extra })
  return page
}

beforeEach(() => {
  vi.useFakeTimers()
  sent = []
  page = undefined
})
afterEach(() => {
  page?.destroy()
  document.body.textContent = ''
  vi.useRealTimers()
})

describe('the address of a picture', () => {
  const base = 'https://file+.vscode-resource.test/work/docs/'
  it('is from the folder of the file', () => {
    expect(resolveImage('img/a b.png', base, '')).toEqual({ url: `${base}img/a%20b.png` })
    expect(resolveImage('../up.png', base, '')).toEqual({ url: 'https://file+.vscode-resource.test/work/up.png' })
  })
  it('does not encode a written %XX a second time', () => {
    expect(resolveImage('assets/1700000000_%5BA%5D_Sample.png', base, '')).toEqual({
      url: `${base}assets/1700000000_%5BA%5D_Sample.png`,
    })
    expect(resolveImage('../assets/%5BA%5D_Sample.png', base, '')).toEqual({
      url: 'https://file+.vscode-resource.test/work/assets/%5BA%5D_Sample.png',
    })
    expect(resolveImage('a%5B1%5D.png', base, 'pic')).toEqual({ url: `${base}pic/a%5B1%5D.png` })
  })
  it('gives one address for a path written as is or already encoded', () => {
    const cyr = '%D1%81%D1%85%D0%B5%D0%BC%D0%B0'
    expect(resolveImage('img/a%20b.png', base, '')).toEqual({ url: `${base}img/a%20b.png` })
    expect(resolveImage('img/схема.png', base, '')).toEqual({ url: `${base}img/${cyr}.png` })
    expect(resolveImage(`img/${cyr}.png`, base, '')).toEqual({ url: `${base}img/${cyr}.png` })
    expect(resolveImage('img/[D] схема%5B1%5D.png', base, '')).toEqual({
      url: `${base}img/%5BD%5D%20${cyr}%5B1%5D.png`,
    })
  })
  it('takes a % without two hexadecimal digits as a letter of the name', () => {
    expect(resolveImage('img/100%.png', base, '')).toEqual({ url: `${base}img/100%25.png` })
    expect(resolveImage('img/a%zz.png', base, '')).toEqual({ url: `${base}img/a%25zz.png` })
    expect(resolveImage('img/%.png', base, '')).toEqual({ url: `${base}img/%25.png` })
    expect(resolveImage('img/%D0.png', base, '')).toHaveProperty('url')
  })
  it('is from :imagesdir: when the document sets one', () => {
    expect(resolveImage('a.png', base, 'pictures/')).toEqual({ url: `${base}pictures/a.png` })
    expect(resolveImage('a.png', base, 'pictures')).toEqual({ url: `${base}pictures/a.png` })
  })
  it('is a plate for the network, for data: and when the host gave no folder', () => {
    expect(resolveImage('https://x.test/a.png', base, '')).toEqual({ plate: 'remote' })
    expect(resolveImage('data:image/png;base64,AA', base, '')).toEqual({ plate: 'remote' })
    expect(resolveImage('//x.test/a.png', base, '')).toEqual({ plate: 'remote' })
    expect(resolveImage('a.png', base, 'https://cdn.test/')).toEqual({ plate: 'remote' })
    expect(resolveImage('a.png', '', '')).toEqual({ plate: 'missing' })
    expect(resolveImage('/etc/a.png', base, '')).toEqual({ plate: 'missing' })
  })
})

describe('the colours of code', () => {
  const cases: Record<string, string> = {
    javascript: 'const a = "x" // y',
    typescript: 'let a: number = 1',
    css: 'a { color: red; }',
    html: '<p class="a">x</p>',
    java: 'class A { int a = 1; }',
    json: '{"a": [1, true]}',
    python: 'def f(x):\n    return "a"',
    sql: "SELECT a FROM b WHERE c = 'x'",
    bash: 'echo "a" | grep b # c',
    xml: '<a b="c">d</a>',
    yaml: 'a:\n  - b: "c"',
  }
  for (const [language, text] of Object.entries(cases))
    it(`colours ${language}`, () => {
      const ranges = highlightCode(language, text)
      expect(ranges.length, language).toBeGreaterThan(0)
      for (const r of ranges) {
        expect(r.from).toBeGreaterThanOrEqual(0)
        expect(r.to).toBeLessThanOrEqual(text.length)
        expect(r.class).toMatch(/^tok-/)
      }
    })
  it('has none for text and for a language that is not in the list', () => {
    expect(highlightCode('text', 'a b')).toEqual([])
    expect(highlightCode('kotlin', 'val a = 1')).toEqual([])
  })
})

describe('in the tab', () => {
  it('draws a picture of the folder of the file with its caption, and the CSP address of the host', () => {
    open('.Схема\nimage::img/a.png[]\n', { imageBase: 'https://file+.vscode-resource.test/work/docs/', imagesdir: '' })
    const img = root.querySelector('img')!
    expect(img.getAttribute('src')).toBe('https://file+.vscode-resource.test/work/docs/img/a.png')
    expect(root.querySelector('figcaption')!.textContent).toBe('Схема')
  })

  it('takes :imagesdir: of the document', () => {
    open(':imagesdir: pic\n\nimage::a.png[]\n', { imageBase: 'https://file+.vscode-resource.test/work/docs/', imagesdir: 'pic' })
    expect(root.querySelector('img')!.getAttribute('src')).toBe('https://file+.vscode-resource.test/work/docs/pic/a.png')
  })

  it('shows plates for a picture from the network and for a file that is not there', () => {
    open('image::https://x.test/a.png[]\n\nimage::none.png[]\n', { imageBase: 'https://file+.vscode-resource.test/work/docs/', imagesdir: '' })
    const plates = [...root.querySelectorAll('.image-plate')].map((p) => p.textContent)
    expect(plates[0]).toBe('Картинка из сети не показываетсяhttps://x.test/a.png')
    expect(root.querySelectorAll('img')).toHaveLength(1)
    root.querySelector('img')!.dispatchEvent(new Event('error'))
    expect(root.querySelectorAll('.image-plate')[1]!.textContent).toBe('Нет файла none.png')
  })

  it('colours code', () => {
    open('[source,js]\n----\nconst a = 1\n----\n')
    expect(root.querySelector('.nota-code .tok-keyword')).not.toBeNull()
    expect(root.querySelector('.code-lang')!.textContent).toBe('JavaScript')
  })

  it('asks the host for pictures with kind image', async () => {
    open('текст\n')
    const view = page!.editor!.view
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)))
    const button = root.querySelector<HTMLButtonElement>('[data-cmd="insert"]')!
    expect(button.disabled).toBe(false)
    button.click()
    await vi.advanceTimersByTimeAsync(50)
    root.querySelector<HTMLElement>('[data-block="image"]')!.click()
    await vi.advanceTimersByTimeAsync(50)
    vi.advanceTimersByTime(10)
    expect(sent.some((m) => m.type === 'listFiles' && m.kind === 'image')).toBe(true)
  })

  it('says «Правка островка не записана» in the strip when the cursor leaves an island with a text that was not written', () => {
    const text = 'а\n\n|===\n2*|x\n|===\n\nб\n'
    open(text)
    const view = page!.editor!.view
    const island = (): number => {
      let at = -1
      view.state.doc.forEach((n, pos) => n.type.name === 'island' && (at = pos))
      return at
    }
    // delete the closing delimiter: the table would swallow the paragraph below
    const start = island()
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, start + 11, start + 15)))
    view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', keyCode: 8, bubbles: true, cancelable: true }))
    expect(page!.mirror!.text).toBe(text)
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)))
    const notice = root.querySelector<HTMLElement>('.notice')!
    expect(notice.hidden).toBe(false)
    expect(notice.querySelector('.notice-text')!.textContent).toBe('Правка островка не записана')
  })
})

describe('the path written for a picked picture', () => {
  it('is as it was listed when the document has no :imagesdir:', () => {
    expect(pathForDocument('img/x.png', '')).toBe('img/x.png')
    expect(pathForDocument('../img/x.png', '')).toBe('../img/x.png')
  })
  it('is from :imagesdir: when the document sets one, so that it reads back to the same file', () => {
    expect(pathForDocument('img/x.png', 'img')).toBe('x.png')
    expect(pathForDocument('img/sub/x.png', 'img/')).toBe('sub/x.png')
    expect(pathForDocument('pix/x.png', 'img')).toBe('../pix/x.png')
    expect(pathForDocument('../img/x.png', 'img')).toBe('../../img/x.png')
    expect(resolveImage(pathForDocument('img/x.png', 'img'), 'https://h.test/w/', 'img')).toEqual({ url: 'https://h.test/w/img/x.png' })
  })
  it('stays as it was for an :imagesdir: that is an address', () => {
    expect(pathForDocument('img/x.png', 'https://cdn.test/')).toBe('img/x.png')
  })
})
