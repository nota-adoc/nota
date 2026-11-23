// «Открыть файл» puts the chosen .adoc into both windows, «Скачать» saves the text of the document; neither touches the network.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { choose, closePage, fixture, load, openPage, outgoing, selectText, stubNetwork, type Page } from './helpers.js'

beforeEach(() => {
  outgoing.length = 0
  stubNetwork()
})
afterEach(closePage)

const start = fixture('editor/visual.adoc')

interface Saved {
  name: string
  url: string
  blob: Blob
  /** Was the link in the document when it was clicked: Firefox does not save from a link that is not. */
  connected: boolean
}

/** The page's «Скачать», caught: what would go to the disk, without a browser to take it. */
function catchDownloads(): { saved: Saved[]; revoked: string[] } {
  const saved: Saved[] = []
  const revoked: string[] = []
  const blobs = new Map<string, Blob>()
  let n = 0
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: (blob: Blob) => {
      const url = `blob:demo/${++n}`
      blobs.set(url, blob)
      return url
    },
  })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: (url: string) => void revoked.push(url) })
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    saved.push({ name: this.download, url: this.href, blob: blobs.get(this.href)!, connected: this.isConnected })
  })
  return { saved, revoked }
}

const clickDownload = (page: Page): void => {
  page.$('download').dispatchEvent(new MouseEvent('click', { bubbles: true }))
}
const bytesOf = async (blob: Blob): Promise<Uint8Array> => new Uint8Array(await blob.arrayBuffer())
const download = async (page: Page, saved: Saved[]): Promise<{ name: string; type: string; bytes: Uint8Array }> => {
  const before = saved.length
  clickDownload(page)
  expect(saved.length).toBe(before + 1)
  const file = saved.at(-1)!
  return { name: file.name, type: file.blob.type, bytes: await bytesOf(file.blob) }
}
const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text)

describe('demo: «Открыть файл» and «Скачать»', () => {
  it('«Открыть файл» opens the dialog of files, and shows what the tooltip says', async () => {
    const page = await openPage()
    const click = vi.spyOn(page.file, 'click')
    page.$('open').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(click).toHaveBeenCalledOnce()
    expect(page.$('open').dataset.tip).toBe('Открыть файл .adoc с компьютера')
    expect(page.file.accept).toContain('.adoc')
  })

  it('puts the chosen file into both windows, and offers it in the list of samples as «Файл: имя»', async () => {
    const page = await openPage()
    const text = '= Файл\n\nАбзац *файла*.\n'
    await load(page, text, 'notes.adoc')
    expect(page.cm().state.doc.toString()).toBe(text)
    expect(page.pm().dom.querySelector('strong')!.textContent).toBe('файла')
    expect(page.pm().dom.querySelector('h1')!.textContent).toBe('Файл')
    expect([...page.sample.options].map((o) => o.text)[0]).toBe('Файл: notes.adoc')
    expect(page.sample.value).toBe('file')
    expect(page.sample.options.length).toBe(10)
    // one history for the file: it starts anew
    expect(page.session().canUndo).toBe(false)
    expect(page.length()).toBe(`${new Intl.NumberFormat('ru-RU').format(text.length)} симв.`)
    // a sample takes its place, and the file leaves the list
    choose(page, 'inline')
    expect(page.sample.options.length).toBe(9)
    expect([...page.sample.options].map((o) => o.text)).not.toContain('Файл: notes.adoc')
    expect(page.text()).toBe(fixture('stage4/all-constructs.adoc'))
    // a second file replaces the first one in the list
    await load(page, 'Один\n', 'a.adoc')
    await load(page, 'Два\n', 'b.adoc')
    expect([...page.sample.options].filter((o) => o.text.startsWith('Файл:')).map((o) => o.text)).toEqual(['Файл: b.adoc'])
  })

  it('keeps the byte order mark of the file in the text, byte for byte', async () => {
    const page = await openPage()
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8('= С меткой\n\nТекст.\n')])
    await load(page, bytes, 'bom.adoc')
    expect(page.text().charCodeAt(0)).toBe(0xfeff)
    expect(page.cm().state.doc.toString()).toBe(page.text())
  })

  it('«Скачать» saves the text of the document: the file is named after the sample, and the tooltip says the name', async () => {
    const { saved } = catchDownloads()
    const page = await openPage()
    expect(page.$('download').dataset.tip).toBe('Скачать spec.adoc')
    const file = await download(page, saved)
    expect(file.name).toBe('spec.adoc')
    expect(file.type).toBe('text/plain;charset=utf-8')
    expect(new TextDecoder().decode(file.bytes)).toBe(start)
    choose(page, 'diagnostics')
    expect(page.$('download').dataset.tip).toBe('Скачать diagnostics.adoc')
    const other = await download(page, saved)
    expect(other.name).toBe('diagnostics.adoc')
    expect(new TextDecoder().decode(other.bytes)).toBe(fixture('editor/diagnostics.adoc'))
  })

  it('clicks a link that is in the document, removes it, and gives the address of the file back after a second', async () => {
    const { saved, revoked } = catchDownloads()
    const page = await openPage()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    // (the second of an earlier test's download can come while the page opens, on a busy machine: it is not this click's)
    revoked.length = 0
    clickDownload(page)
    expect(saved).toHaveLength(1)
    expect(saved[0]!.connected).toBe(true)
    expect(document.querySelector('a[download]')).toBeNull()
    expect(saved[0]!.url).toMatch(/^blob:/)
    expect(revoked).toEqual([])
    vi.advanceTimersByTime(1000)
    expect(revoked).toEqual([saved[0]!.url])
  })

  it('names the file as it was opened, and the tooltip says so', async () => {
    const { saved } = catchDownloads()
    const page = await openPage()
    await load(page, '= Файл\n', 'тз клиента.txt')
    expect(page.$('download').dataset.tip).toBe('Скачать тз клиента.txt')
    expect((await download(page, saved)).name).toBe('тз клиента.txt')
    choose(page, 'ids')
    expect(page.$('download').dataset.tip).toBe('Скачать ids.adoc')
  })

  it('open, then download: the same bytes in UTF-8, the byte order mark kept', async () => {
    const { saved } = catchDownloads()
    const page = await openPage()
    for (const bytes of [
      new Uint8Array([0xef, 0xbb, 0xbf, ...utf8('= С меткой\n\nТекст «в кавычках».\n')]),
      utf8('= Без метки\r\n\r\nСтрока с CRLF и эмодзи 🙂.\r\n'),
      utf8(fixture('stage4/all-constructs.adoc')),
    ]) {
      await load(page, bytes, 'a.adoc')
      const file = await download(page, saved)
      expect([...file.bytes]).toEqual([...bytes])
    }
  })

  it('after an edit the file has the edit, whichever window it was made in', async () => {
    const { saved } = catchDownloads()
    const page = await openPage()
    page.cm().dispatch({ changes: { from: 0, insert: 'абв ' }, userEvent: 'input.type' })
    expect(new TextDecoder().decode((await download(page, saved)).bytes)).toBe(`абв ${start}`)
    selectText(page, 'приоритет')
    page.visual().commands.toggleMark('em')
    const text = page.text()
    expect(text).toContain('_приоритет_')
    expect(new TextDecoder().decode((await download(page, saved)).bytes)).toBe(text)
  })

  it('touches no network: nothing is sent, the file goes through a local address of the page', async () => {
    const { saved } = catchDownloads()
    const page = await openPage()
    await load(page, '= Файл\n', 'notes.adoc')
    await download(page, saved)
    expect(outgoing).toEqual([])
  })
})
