import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakePanel, env, fake, workspace } from './fake-vscode.js'
import { NotaEditorProvider } from '../../src/host/provider.js'
import { ConfigurationTarget, Uri } from 'vscode'

let provider: NotaEditorProvider

function openTab(doc: ReturnType<typeof fake.open>, panel = new FakePanel()) {
  provider.resolveCustomTextEditor(doc as never, panel as never)
  return panel
}

/** Opens a tab and lets it say `ready`: the host answers with `init`. */
async function readyTab(doc: ReturnType<typeof fake.open>) {
  const panel = openTab(doc)
  panel.webview.receive({ type: 'ready' })
  await flushPromises()
  return panel
}

const flushPromises = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

beforeEach(() => {
  vi.useFakeTimers()
  fake.reset()
  provider = new NotaEditorProvider(Uri.file('/ext'))
})
afterEach(() => {
  provider.dispose()
  vi.useRealTimers()
})

describe('opening', () => {
  it('draws a page with no network and answers ready with the text and the version', async () => {
    const doc = fake.open('= Заголовок\n\nТекст.\n')
    const panel = await readyTab(doc)
    const html = panel.webview.html
    expect(html).toContain("default-src 'none'")
    expect(html).toMatch(/img-src \S+;/)
    expect(html).not.toMatch(/img-src[^;]*(https:|data:)/)
    expect(html).not.toContain('connect-src')
    expect(html).toMatch(/script-src 'nonce-[A-Za-z0-9_-]{32}'/)
    // the styles of a page are not held to the nonce (mermaid puts a style and style attributes in its pictures), and still no address anywhere
    expect(html).toMatch(/style-src \S+ 'unsafe-inline';/)
    expect(html).not.toMatch(/(?:src|default)[^;]*(?:https?:|data:|blob:|\*)/)
    expect(html).toMatch(/data-mermaid="[^"]*\/ext\/dist\/mermaid.js"/)
    expect(html).toContain('/ext/dist/webview.js')
    expect((panel.webview.options as { localResourceRoots: Uri[] }).localResourceRoots.map((u) => u.path)).toEqual(['/ext/dist', '/work/docs'])
    expect(panel.webview.messagesOf('init')).toEqual([{ type: 'init', text: '= Заголовок\n\nТекст.\n', version: 1, fileName: 'обзор.adoc', locale: 'ru', pageWidth: 85, showAnchors: false, outlineView: 'capsule', blocksInCapsule: 'all', fileDir: '/work/docs', imageBase: 'vscode-resource:/work/docs/', imagesdir: '', mode: 'visual' }])
  })

  it('shows «не открылся» when the page does not answer in 10 s', async () => {
    const panel = openTab(fake.open('текст'))
    await vi.advanceTimersByTimeAsync(9_999)
    expect(panel.webview.html).not.toContain('не открылся')
    await vi.advanceTimersByTimeAsync(2)
    expect(panel.webview.html).toContain('Визуальный редактор не открылся')
    expect(panel.webview.html).toContain('Вкладка не ответила за 10')
    expect(panel.webview.html).toContain('Файл не изменён')
    expect(panel.webview.html).toContain('data-send="openText"')
    expect(panel.webview.html).not.toContain('Подробности ошибки')
    expect(panel.webview.html).toContain('закройте вкладку и откройте обзор.adoc снова')
  })

  it('shows «не открылся» with the details when the page fails to start', async () => {
    const doc = fake.open('текст')
    const panel = openTab(doc)
    panel.webview.receive({ type: 'error', message: 'Error: схема не собралась', stack: 'Error: схема\n    at createVisualEditor (webview.js:1:2)' })
    await flushPromises()
    expect(panel.webview.html).toContain('При запуске вкладки произошла ошибка.')
    expect(panel.webview.html).toContain('Подробности ошибки')
    expect(panel.webview.html).toContain('at createVisualEditor')
    // and nothing times out later
    await vi.advanceTimersByTimeAsync(20_000)
    expect(panel.webview.html).toContain('При запуске вкладки')
  })

  it('«Открыть в текстовом редакторе» reopens the tab as the built-in text editor', async () => {
    const panel = openTab(fake.open('текст'))
    panel.webview.receive({ type: 'error', message: 'x' })
    await flushPromises()
    panel.webview.receive({ type: 'openText' })
    await flushPromises()
    expect(fake.executed.map((e) => e.command)).toEqual(['workbench.action.reopenTextEditor'])
  })

  it('falls back to opening the file with the default editor', async () => {
    fake.failing.add('workbench.action.reopenTextEditor')
    const doc = fake.open('текст')
    const panel = openTab(doc)
    panel.webview.receive({ type: 'openText' })
    await flushPromises()
    expect(fake.executed.map((e) => e.command)).toEqual(['workbench.action.reopenTextEditor', 'vscode.openWith'])
    expect(fake.executed[1]!.args.slice(0, 2)).toEqual([doc.uri, 'default'])
    expect(panel.disposed).toBe(true)
  })
})

describe('the size limit', () => {
  const big = (bytes: number): string => 'a'.repeat(bytes)

  it('1 000 000 bytes open visually, one more byte opens in «Текст» with the size for the strip', async () => {
    const ok = await readyTab(fake.open(big(1_000_000)))
    expect(ok.webview.messagesOf('init')[0]).toMatchObject({ mode: 'visual' })
    expect(ok.webview.messagesOf('init')[0]).not.toHaveProperty('big')
    const over = await readyTab(fake.open(big(1_000_001), '/work/docs/журнал-изменений.adoc'))
    expect(over.webview.messagesOf('init')[0]).toMatchObject({ mode: 'text', big: { bytes: 1_000_001 }, text: big(1_000_001) })
    // the same page as always: no screen «слишком большой»
    expect(over.webview.html).toContain('webview.js')
    expect(over.webview.html).not.toContain('Файл слишком большой')
  })

  it('counts bytes of UTF-8, not characters', async () => {
    const panel = await readyTab(fake.open('ж'.repeat(600_000))) // 1 200 000 bytes
    expect(panel.webview.messagesOf('init')[0]).toMatchObject({ mode: 'text', big: { bytes: 1_200_000 } })
  })

  it('does not time out and does not change the file', async () => {
    const doc = fake.open(big(1_400_000))
    const panel = await readyTab(doc)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(panel.webview.html).toContain('webview.js')
    expect(doc.version).toBe(1)
    expect(doc.isDirty).toBe(false)
  })

  it('the context nota.textMode follows the mode of the active tab', async () => {
    const doc = fake.open(big(1_400_000))
    const a = await readyTab(doc)
    expect(fake.contexts['nota.textMode']).toBe(true)
    a.webview.receive({ type: 'mode', mode: 'visual' })
    await flushPromises()
    expect(fake.contexts['nota.textMode']).toBe(false)
    a.webview.receive({ type: 'mode', mode: 'text' })
    await flushPromises()
    expect(fake.contexts['nota.textMode']).toBe(true)
    const b = await readyTab(fake.open('мало'))
    a.setActive(false)
    expect(b.active).toBe(true)
    expect(fake.contexts['nota.textMode']).toBe(false)
    a.setActive(true)
    b.setActive(false)
    expect(fake.contexts['nota.textMode']).toBe(true)
  })

  it('toggle-mode goes to the tab the person is in', async () => {
    const a = await readyTab(fake.open('один'))
    const b = await readyTab(fake.open('два'))
    a.setActive(false)
    expect(provider.command('toggle-mode')).toBe(true)
    expect(b.webview.messagesOf('command')).toEqual([{ type: 'command', name: 'toggle-mode' }])
    expect(a.webview.messagesOf('command')).toEqual([])
  })
})

describe('edits of a tab', () => {
  it('writes the changes into the document and answers with the version', async () => {
    const doc = fake.open('Привет мир\n')
    const panel = await readyTab(doc)
    panel.webview.receive({ type: 'edit', id: 1, baseVersion: 1, changes: [{ from: 7, to: 7, insert: 'тёплый ' }] })
    await flushPromises()
    expect(doc.getText()).toBe('Привет тёплый мир\n')
    expect(doc.isDirty).toBe(true)
    expect(panel.webview.messagesOf('ack')).toEqual([{ type: 'ack', id: 1, version: 2 }])
    expect(panel.webview.messagesOf('update')).toEqual([])
  })

  it('writes several changes of one edit as one version', async () => {
    const doc = fake.open('а б в\n')
    const panel = await readyTab(doc)
    panel.webview.receive({ type: 'edit', id: 1, baseVersion: 1, changes: [{ from: 0, to: 1, insert: 'Я' }, { from: 4, to: 5, insert: 'Ю' }] })
    await flushPromises()
    expect(doc.getText()).toBe('Я б Ю\n')
    expect(doc.version).toBe(2)
  })

  it('refuses an edit on a version the document has left, and shows the document again', async () => {
    const doc = fake.open('один\n')
    const panel = await readyTab(doc)
    doc.write([{ from: 0, to: 0, insert: 'раз ' }])
    panel.webview.receive({ type: 'edit', id: 1, baseVersion: 1, changes: [{ from: 4, to: 4, insert: '!' }] })
    await flushPromises()
    expect(doc.getText()).toBe('раз один\n')
    expect(doc.version).toBe(2)
    expect(panel.webview.messagesOf('ack')).toEqual([])
    expect(panel.webview.messagesOf('reset')).toEqual([{ type: 'reset', text: 'раз один\n', version: 2, stale: true }])
  })

  it('refuses a change outside the text', async () => {
    const doc = fake.open('коротко')
    const panel = await readyTab(doc)
    panel.webview.receive({ type: 'edit', id: 1, baseVersion: 1, changes: [{ from: 50, to: 60, insert: 'x' }] })
    await flushPromises()
    expect(doc.getText()).toBe('коротко')
    expect(panel.webview.messagesOf('reset')).toHaveLength(1)
  })

  it('takes edits in the order they were sent', async () => {
    const doc = fake.open('')
    fake.applyEditDelay = 5
    const panel = await readyTab(doc)
    panel.webview.receive({ type: 'edit', id: 1, baseVersion: 1, changes: [{ from: 0, to: 0, insert: 'а' }] })
    panel.webview.receive({ type: 'edit', id: 2, baseVersion: 2, changes: [{ from: 1, to: 1, insert: 'б' }] })
    await vi.advanceTimersByTimeAsync(50)
    expect(doc.getText()).toBe('аб')
    expect(panel.webview.messagesOf('ack').map((m) => [m.id, m.version])).toEqual([[1, 2], [2, 3]])
  })

  it('ignores an edit of a tab that is not open yet', async () => {
    const doc = fake.open('текст')
    const panel = openTab(doc)
    panel.webview.receive({ type: 'edit', id: 1, baseVersion: 1, changes: [{ from: 0, to: 0, insert: 'x' }] })
    await flushPromises()
    expect(doc.getText()).toBe('текст')
  })
})

describe('what one source writes goes to the others', () => {
  it('tells the other tabs of the document, not the one that wrote', async () => {
    const doc = fake.open('Привет\n')
    const a = await readyTab(doc)
    const b = await readyTab(doc)
    a.webview.receive({ type: 'edit', id: 1, baseVersion: 1, changes: [{ from: 6, to: 6, insert: ', мир' }] })
    await flushPromises()
    expect(a.webview.messagesOf('update')).toEqual([])
    expect(b.webview.messagesOf('update')).toEqual([
      { type: 'update', version: 2, changes: [{ from: 6, to: 6, insert: ', мир' }], reason: undefined },
    ])
  })

  it('tells every tab of an edit in a text editor, changes in ascending order', async () => {
    const doc = fake.open('abc def\n')
    const a = await readyTab(doc)
    const b = await readyTab(doc)
    doc.write([{ from: 0, to: 1, insert: 'A' }, { from: 4, to: 5, insert: 'D' }])
    for (const p of [a, b])
      expect(p.webview.messagesOf('update')).toEqual([
        { type: 'update', version: 2, changes: [{ from: 0, to: 1, insert: 'A' }, { from: 4, to: 5, insert: 'D' }], reason: undefined },
      ])
  })

  it('does not tell a tab of another document', async () => {
    const doc = fake.open('один')
    const other = fake.open('два', '/work/docs/b.adoc')
    const panel = await readyTab(doc)
    other.write([{ from: 0, to: 0, insert: 'x' }])
    expect(panel.webview.messagesOf('update')).toEqual([])
  })

  it('does not tell a tab that is not open yet', () => {
    const doc = fake.open('один')
    const panel = openTab(doc)
    doc.write([{ from: 0, to: 0, insert: 'x' }])
    expect(panel.webview.posted).toEqual([])
  })

  it('does not tell a closed tab', async () => {
    const doc = fake.open('один')
    const panel = await readyTab(doc)
    panel.dispose()
    doc.write([{ from: 0, to: 0, insert: 'x' }])
    expect(panel.webview.messagesOf('update')).toEqual([])
  })
})

describe('undo and redo', () => {
  it('are the commands of VS Code, and the step comes back to the tabs with its reason', async () => {
    const doc = fake.open('слово\n')
    const a = await readyTab(doc)
    const b = await readyTab(doc)
    a.webview.receive({ type: 'edit', id: 1, baseVersion: 1, changes: [{ from: 5, to: 5, insert: ' проверка' }] })
    await flushPromises()
    a.webview.receive({ type: 'undo' })
    await flushPromises()
    expect(fake.executed.map((e) => e.command)).toEqual(['undo'])
    expect(doc.getText()).toBe('слово\n')
    expect(a.webview.messagesOf('update')).toEqual([
      { type: 'update', version: 3, changes: [{ from: 5, to: 14, insert: '' }], reason: 'undo' },
    ])
    a.webview.receive({ type: 'redo' })
    await flushPromises()
    expect(doc.getText()).toBe('слово проверка\n')
    expect(b.webview.messagesOf('update').map((m) => m.reason)).toEqual([undefined, 'undo', 'redo'])
  })

  it('share one history with a text editor', async () => {
    const doc = fake.open('слово\n')
    const a = await readyTab(doc)
    a.webview.receive({ type: 'edit', id: 1, baseVersion: 1, changes: [{ from: 5, to: 5, insert: '1' }] })
    await flushPromises()
    doc.write([{ from: 0, to: 0, insert: '2' }]) // typed in a text editor
    doc.undo() // Cmd+Z in the text editor
    doc.undo() // and once more: the edit of the tab goes too
    expect(doc.getText()).toBe('слово\n')
  })
})

describe('saving', () => {
  /** A page that holds an edit until the host asks for it. */
  function holdingPage(panel: FakePanel, doc: ReturnType<typeof fake.open>) {
    const original = panel.webview.postMessage.bind(panel.webview)
    panel.webview.postMessage = (message: { type: string; id: number }) => {
      if (message.type === 'flush')
        setTimeout(() => {
          panel.webview.receive({ type: 'edit', id: 9, baseVersion: doc.version, changes: [{ from: doc.getText().length, to: doc.getText().length, insert: 'я' }] })
          panel.webview.receive({ type: 'flush', id: message.id })
        }, 10)
      return original(message)
    }
  }

  it('waits for the letters the page has not sent yet', async () => {
    const doc = fake.open('Строка')
    const panel = await readyTab(doc)
    holdingPage(panel, doc)
    const saved = fake.save(doc)
    await vi.advanceTimersByTimeAsync(50)
    await saved
    expect(doc.getText()).toBe('Строкая')
    expect(doc.isDirty).toBe(false)
  })

  it('does not wait for a tab that does not answer', async () => {
    const doc = fake.open('Строка')
    await readyTab(doc)
    let done = false
    void fake.save(doc).then(() => (done = true))
    await vi.advanceTimersByTimeAsync(2_900)
    expect(done).toBe(false)
    await vi.advanceTimersByTimeAsync(200)
    expect(done).toBe(true)
  })

  it('does not wait for a tab that is not open', async () => {
    const doc = fake.open('Строка')
    openTab(doc)
    await fake.save(doc)
    expect(doc.isDirty).toBe(false)
  })
})

describe('commands of keys', () => {
  it('go to the tab the person is in', async () => {
    const doc = fake.open('текст')
    const a = await readyTab(doc)
    const b = await readyTab(doc)
    a.active = false
    expect(provider.command('strong')).toBe(true)
    expect(a.webview.messagesOf('command')).toEqual([])
    expect(b.webview.messagesOf('command')).toEqual([{ type: 'command', name: 'strong' }])
  })

  it('are not sent when there is no such tab', () => {
    expect(provider.command('em')).toBe(false)
  })
})

describe('Save All with several tabs', () => {
  /** A page that sends its typed letter when the host asks for it, as the page does before a save. */
  function typing(panel: FakePanel, doc: ReturnType<typeof fake.open>, letters: string) {
    const original = panel.webview.postMessage.bind(panel.webview)
    panel.webview.postMessage = (message: { type: string; id: number }) => {
      if (message.type === 'flush') {
        panel.webview.receive({ type: 'edit', id: 9, baseVersion: doc.version, changes: [{ from: doc.getText().length, to: doc.getText().length, insert: letters }] })
        panel.webview.receive({ type: 'flush', id: message.id })
      }
      return original(message)
    }
  }

  it('two tabs of two files: every letter is in its file, nobody is told of a change by another editor', async () => {
    fake.applyEditDelay = 5
    const a = fake.open('один', '/work/docs/a.adoc')
    const b = fake.open('два', '/work/docs/b.adoc')
    const pa = await readyTab(a)
    const pb = await readyTab(b)
    typing(pa, a, ' слово')
    typing(pb, b, ' слово')
    const saved = Promise.all([fake.save(a), fake.save(b)])
    await vi.advanceTimersByTimeAsync(100)
    await saved
    expect(a.getText()).toBe('один слово')
    expect(b.getText()).toBe('два слово')
    expect(a.isDirty || b.isDirty).toBe(false)
    for (const p of [pa, pb]) {
      expect(p.webview.messagesOf('update')).toEqual([])
      expect(p.webview.messagesOf('reset')).toEqual([])
      expect(p.webview.messagesOf('ack')).toHaveLength(1)
    }
  })

  it('two tabs of one file: the letters of the first are written, the second is told, nothing is lost without a word', async () => {
    fake.applyEditDelay = 5
    const doc = fake.open('текст', '/work/docs/a.adoc')
    const first = await readyTab(doc)
    const second = await readyTab(doc)
    typing(first, doc, ' раз')
    typing(second, doc, '')
    const saved = fake.save(doc)
    await vi.advanceTimersByTimeAsync(100)
    await saved
    expect(doc.getText()).toBe('текст раз')
    expect(first.webview.messagesOf('ack')).toHaveLength(1)
    expect(first.webview.messagesOf('update')).toEqual([])
    expect(second.webview.messagesOf('update')).toHaveLength(1)
  })

  it('the tab that wrote is not told of its own edit while another document is written meanwhile', async () => {
    fake.applyEditDelay = 20
    const a = fake.open('один', '/work/docs/a.adoc')
    const b = fake.open('два', '/work/docs/b.adoc')
    const pa = await readyTab(a)
    const pb = await readyTab(b)
    pa.webview.receive({ type: 'edit', id: 1, baseVersion: 1, changes: [{ from: 4, to: 4, insert: '!' }] })
    await vi.advanceTimersByTimeAsync(5)
    pb.webview.receive({ type: 'edit', id: 1, baseVersion: 1, changes: [{ from: 3, to: 3, insert: '?' }] })
    await vi.advanceTimersByTimeAsync(100)
    expect(pa.webview.messagesOf('update')).toEqual([])
    expect(pb.webview.messagesOf('update')).toEqual([])
    expect(pa.webview.messagesOf('reset')).toEqual([])
    expect(pb.webview.messagesOf('reset')).toEqual([])
  })
})

describe('a failure in a tab that shows its document', () => {
  it('does not draw «не открылся» over it', async () => {
    const doc = fake.open('текст')
    const panel = await readyTab(doc)
    const html = panel.webview.html
    panel.webview.receive({ type: 'error', message: 'Error: сбой', stack: 'Error\n    at x' })
    await flushPromises()
    expect(panel.webview.html).toBe(html)
    expect(panel.webview.html).not.toContain('не открылся')
  })

  it('draws it when the tab gives up (fatal)', async () => {
    const panel = await readyTab(fake.open('текст'))
    panel.webview.receive({ type: 'error', message: 'Error: сбой', fatal: true })
    await flushPromises()
    expect(panel.webview.html).toContain('Визуальный редактор не открылся')
  })

  it('a tab asks for the text anew after a failure and gets it', async () => {
    const doc = fake.open('текст')
    const panel = await readyTab(doc)
    panel.webview.receive({ type: 'resync' })
    await flushPromises()
    expect(panel.webview.messagesOf('reset')).toEqual([{ type: 'reset', text: 'текст', version: 1, stale: false }])
  })
})

describe('the panel «Проблемы»', () => {
  const SKIP = '= Док\n\n== Раздел\n\nСсылка <<нет-такого>>.\n'

  it('shows the remarks of the file in Russian, with source nota, while a tab is open', async () => {
    const doc = fake.open(SKIP)
    await readyTab(doc)
    const list = fake.problems!.get(doc.uri)
    expect(list).toHaveLength(1)
    expect(list[0]!.message).toBe('Ссылка ведёт на «нет-такого», а такого раздела или якоря в документе нет')
    expect(list[0]!.source).toBe('nota')
    expect(list[0]!.severity).toBe(1)
    // the place of the link
    const start = SKIP.indexOf('<<')
    expect(doc.offsetAt(list[0]!.range.start)).toBe(start)
    expect(doc.offsetAt(list[0]!.range.end)).toBe(start + '<<нет-такого>>'.length)
  })

  it('gives the code of the line a link to the command that puts the cursor on the remark', async () => {
    const doc = fake.open(SKIP)
    await readyTab(doc)
    const code = fake.problems!.get(doc.uri)[0]!.code as unknown as { value: string; target: { toString(): string } }
    expect(code.value).toBe('unresolved-reference')
    const target = code.target.toString()
    expect(target.startsWith('command:nota.revealProblem?')).toBe(true)
    const args = JSON.parse(decodeURIComponent(target.split('?')[1]!)) as [string, number]
    expect(args).toEqual([doc.uri.toString(), SKIP.indexOf('<<')])
  })

  it('counts the remarks again within 1 s after a fix, and leaves the others as the text of Nota', async () => {
    const doc = fake.open(SKIP)
    await readyTab(doc)
    doc.write([{ from: SKIP.indexOf('нет-такого'), to: SKIP.indexOf('нет-такого') + 10, insert: '_раздел' }])
    await vi.advanceTimersByTimeAsync(299)
    expect(fake.problems!.get(doc.uri)).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(2)
    expect(fake.problems!.get(doc.uri)).toHaveLength(0)
    doc.write([{ from: doc.getText().length, to: doc.getText().length, insert: '\n==== Глубоко\n' }])
    await vi.advanceTimersByTimeAsync(400)
    const [skipped] = fake.problems!.get(doc.uri)
    expect(skipped!.message).toBe('Заголовок пропускает уровень: ожидался Заголовок 3 или крупнее, а здесь Заголовок 4')
  })

  it('takes the remarks away when the last tab of the file is closed, and keeps them while one is open', async () => {
    const doc = fake.open(SKIP)
    const a = await readyTab(doc)
    const b = await readyTab(doc)
    a.dispose()
    expect(fake.problems!.get(doc.uri)).toHaveLength(1)
    b.dispose()
    expect(fake.problems!.get(doc.uri)).toHaveLength(0)
    // and a change afterwards brings none back
    doc.write([{ from: 0, to: 0, insert: 'x' }])
    await vi.advanceTimersByTimeAsync(1000)
    expect(fake.problems!.get(doc.uri)).toHaveLength(0)
  })

  it('names the levels Ошибка, Предупреждение, Сведения', async () => {
    const { severityName } = await import('../../src/webview/diagnostics.js')
    expect(['error', 'warning', 'info'].map((s) => severityName(s as never, 'ru'))).toEqual(['Ошибка', 'Предупреждение', 'Сведения'])
    expect(['error', 'warning', 'info'].map((s) => severityName(s as never))).toEqual(['Error', 'Warning', 'Information'])
  })

  it('reveal sends the place to the tab of the file', async () => {
    const doc = fake.open(SKIP)
    const panel = await readyTab(doc)
    panel.setActive(false)
    expect(provider.reveal(doc.uri as never, 21)).toBe(true)
    expect(panel.revealed).toEqual([1])
    expect(panel.active).toBe(true)
    expect(panel.webview.messagesOf('command')).toEqual([{ type: 'command', name: 'reveal', offset: 21 }])
    expect(provider.reveal(fake.open('x', '/other.adoc').uri as never, 1)).toBe(false)
  })
})

describe('the language', () => {
  const fresh = (): void => {
    provider.dispose()
    provider = new NotaEditorProvider(Uri.file('/ext'))
  }

  it('is auto by default: English for any language of VS Code but ru…, in init, in the page and in the screen «The visual editor did not open»', async () => {
    for (const [language, locale] of [['en', 'en'], ['de', 'en'], ['zh-cn', 'en'], ['ru', 'ru'], ['ru-RU', 'ru']] as const) {
      env.language = language
      fresh()
      const panel = await readyTab(fake.open('text'))
      expect(panel.webview.messagesOf('init')[0].locale).toBe(locale)
      expect(panel.webview.html).toContain(`<html lang="${locale}">`)
    }
    env.language = 'de'
    fresh()
    const english = openTab(fake.open('text', '/work/docs/a.adoc'))
    await vi.advanceTimersByTimeAsync(10_001)
    expect(english.webview.html).toContain('The visual editor did not open')
    expect(english.webview.html).not.toMatch(/[А-Яа-я]/)
    env.language = 'ru'
    fresh()
    const panel = openTab(fake.open('text', '/work/docs/a.adoc'))
    await vi.advanceTimersByTimeAsync(10_001)
    expect(panel.webview.html).toContain('Визуальный редактор не открылся')
  })

  it('a broken value of the setting works as auto, not as ru', async () => {
    for (const bad of ['klingon', 42, null, true]) {
      workspace.settings.language = bad as never
      for (const [language, locale] of [['en', 'en'], ['ru', 'ru']] as const) {
        env.language = language
        fresh()
        const panel = await readyTab(fake.open('text'))
        expect(panel.webview.messagesOf('init')[0].locale).toBe(locale)
      }
    }
  })

  it('nota.language = auto follows VS Code: ru… is Russian, any other is English', async () => {
    workspace.settings.language = 'auto'
    for (const [language, locale] of [['ru', 'ru'], ['ru-RU', 'ru'], ['en', 'en'], ['de', 'en'], ['zh-cn', 'en']] as const) {
      env.language = language
      fresh()
      const panel = await readyTab(fake.open('text'))
      expect(panel.webview.messagesOf('init')[0].locale).toBe(locale)
      expect(panel.webview.html).toContain(`<html lang="${locale}">`)
    }
  })

  it('nota.language = en is English, whatever the language of VS Code is', async () => {
    workspace.settings.language = 'en'
    env.language = 'ru'
    fresh()
    const panel = await readyTab(fake.open('text'))
    expect(panel.webview.messagesOf('init')[0].locale).toBe('en')
    const failed = openTab(fake.open('text', '/work/docs/a.adoc'))
    await vi.advanceTimersByTimeAsync(10_001)
    expect(failed.webview.html).toContain('The visual editor did not open')
    expect(failed.webview.html).not.toMatch(/[А-Яа-я]/)
  })

  it('tells the remarks of the panel «Проблемы» in English by default when VS Code is English', async () => {
    env.language = 'en'
    fresh()
    const doc = fake.open('See <<nowhere>>.\n\n== A\n\n==== B\n')
    await readyTab(doc)
    const messages = fake.problems!.get(doc.uri).map((d) => d.message)
    expect(messages.some((m) => m.startsWith('The link goes to "nowhere"'))).toBe(true)
    expect(messages.some((m) => m.startsWith('The heading skips a level'))).toBe(true)
  })

  it('tells all the remarks of the engine in Russian when VS Code is Russian', async () => {
    const doc = fake.open('text\n\n----\ncode\n')
    await readyTab(doc)
    const messages = fake.problems!.get(doc.uri).map((d) => d.message)
    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatch(/[А-Яа-я]/)
  })

  it('a change of the setting rewrites the lines of «Проблемы» at once; an open tab keeps its language', async () => {
    const doc = fake.open('See <<nowhere>>.\n')
    const panel = await readyTab(doc)
    expect(fake.problems!.get(doc.uri)[0]!.message).toMatch(/^Ссылка ведёт на «nowhere»/)
    workspace.setSetting('language', 'en')
    expect(fake.problems!.get(doc.uri)[0]!.message).toMatch(/^The link goes to "nowhere"/)
    expect(panel.webview.messagesOf('init')[0].locale).toBe('ru')
    workspace.setSetting('language', 'ru')
    expect(fake.problems!.get(doc.uri)[0]!.message).toMatch(/^Ссылка ведёт на «nowhere»/)
    const again = await readyTab(fake.open('x', '/work/docs/b.adoc'))
    expect(again.webview.messagesOf('init')[0].locale).toBe('ru')
  })
})

describe('the list of files', () => {
  const ask = async (panel: FakePanel, query: string, id = 1) => {
    panel.webview.receive({ type: 'listFiles', id, query })
    await flushPromises()
    return panel.webview.messagesOf('files').find((m) => m.id === id)
  }
  const files = ['/work/docs/обзор.adoc', '/work/docs/b.adoc', '/work/docs/sub/c.asciidoc', '/work/other/d.adoc', '/work/node_modules/x/e.adoc']

  it('lists the .adoc files of the workspace without node_modules and the file itself, relative to the folder of the document', async () => {
    workspace.workspaceFolders = [{ uri: Uri.file('/work') }]
    for (const f of files) workspace.files.add(f)
    const panel = await readyTab(fake.open('text'))
    const answer = await ask(panel, '')
    expect(answer).toEqual({ type: 'files', id: 1, items: ['../other/d.adoc', 'b.adoc', 'sub/c.asciidoc'], more: 0 })
    expect(workspace.findCalls[0]).toEqual({ include: '**/*.{adoc,asciidoc}', exclude: '**/node_modules/**', max: 10_000 })
  })

  it('keeps the paths that have the letters typed, at most 50, with how many more', async () => {
    workspace.workspaceFolders = [{ uri: Uri.file('/work') }]
    for (let i = 0; i < 70; i++) workspace.files.add(`/work/docs/file${String(i).padStart(2, '0')}.adoc`)
    workspace.files.add('/work/docs/sub/needle.adoc')
    const panel = await readyTab(fake.open('text'))
    const all = await ask(panel, '', 1)
    expect(all.items).toHaveLength(50)
    expect(all.more).toBe(21) // 71 files
    expect(await ask(panel, 'NEEDLE', 2)).toEqual({ type: 'files', id: 2, items: ['sub/needle.adoc'], more: 0 })
    expect((await ask(panel, 'file0', 3)).items).toHaveLength(10)
  })

  it('reads the list once for a tab and again after a file was added or removed', async () => {
    workspace.workspaceFolders = [{ uri: Uri.file('/work') }]
    workspace.files.add('/work/docs/b.adoc')
    const panel = await readyTab(fake.open('text'))
    await ask(panel, '', 1)
    await ask(panel, 'b', 2)
    expect(workspace.findCalls).toHaveLength(1)
    workspace.files.add('/work/docs/new.adoc')
    workspace.watchers[0]!.created.fire(Uri.file('/work/docs/new.adoc'))
    expect((await ask(panel, '', 3)).items).toEqual(['b.adoc', 'new.adoc'])
    expect(workspace.findCalls).toHaveLength(2)
  })

  it('with kind image lists the pictures (png, jpg, jpeg, gif, svg, webp) and not the documents', async () => {
    workspace.workspaceFolders = [{ uri: Uri.file('/work') }]
    for (const f of ['/work/docs/a.adoc', '/work/docs/img/one.png', '/work/docs/img/two.SVG', '/work/docs/three.webp', '/work/docs/notes.txt'])
      workspace.files.add(f)
    const panel = await readyTab(fake.open('text'))
    panel.webview.receive({ type: 'listFiles', id: 1, query: '', kind: 'image' })
    await flushPromises()
    const answer = panel.webview.messagesOf('files').find((m) => m.id === 1)
    expect(answer).toEqual({ type: 'files', id: 1, items: ['img/one.png', 'three.webp'], more: 0 })
    expect(workspace.findCalls[0]!.include).toBe('**/*.{png,jpg,jpeg,gif,svg,webp}')
  })

  it('the tab may read the folder of the file and the folders of the workspace', async () => {
    workspace.workspaceFolders = [{ uri: Uri.file('/work') }]
    const panel = await readyTab(fake.open('text'))
    expect((panel.webview.options as { localResourceRoots: Uri[] }).localResourceRoots.map((u) => u.path)).toEqual([
      '/ext/dist',
      '/work/docs',
      '/work',
    ])
  })

  it('with no workspace lists the files of the folder of the document and below', async () => {
    for (const f of files) workspace.files.add(f)
    const panel = await readyTab(fake.open('text'))
    expect((await ask(panel, '')).items).toEqual(['b.adoc', 'sub/c.asciidoc'])
    expect(workspace.findCalls).toHaveLength(0)
  })
})

describe('opening a link', () => {
  const open = async (panel: FakePanel, href: string) => {
    panel.webview.receive({ type: 'openLink', href })
    await flushPromises()
  }

  it('opens a file whose path has %5F, and says so as written when it is not there', async () => {
    const href = 'xref:a/Guide_2.0_-%5FProduct/Items%5FData%5F(X).adoc'
    workspace.files.add('/work/docs/a/Guide_2.0_-_Product/Items_Data_(X).adoc')
    const panel = await readyTab(fake.open('text'))
    await open(panel, href)
    expect(fake.executed.filter((e) => e.command === 'vscode.open').map((e) => (e.args[0] as Uri).path)).toEqual([
      '/work/docs/a/Guide_2.0_-_Product/Items_Data_(X).adoc',
    ])
    expect(panel.webview.messagesOf('notice')).toEqual([])
    workspace.files.delete('/work/docs/a/Guide_2.0_-_Product/Items_Data_(X).adoc')
    await open(panel, href)
    expect(panel.webview.messagesOf('notice')).toEqual([{ type: 'notice', text: 'Файл по ссылке не найден' }])
    await open(panel, 'a%E0%A4%A.adoc')
    expect(panel.webview.messagesOf('notice')).toHaveLength(2)
  })

  it('the notice of a missing file stays in the language the tab was drawn in, after the setting changes', async () => {
    const panel = await readyTab(fake.open('text'))
    workspace.setSetting('language', 'en')
    await open(panel, 'nowhere.adoc')
    expect(panel.webview.messagesOf('notice')).toEqual([{ type: 'notice', text: 'Файл по ссылке не найден' }])
  })

  it('init stays in the language the tab was drawn in, when the setting changes before `ready`', async () => {
    const panel = openTab(fake.open('text'))
    workspace.setSetting('language', 'en')
    panel.webview.receive({ type: 'ready' })
    await flushPromises()
    expect(panel.webview.messagesOf('init')[0].locale).toBe('ru')
  })

  it('the screen «не открылся» stays in the language the tab was drawn in, after the setting changes', async () => {
    const panel = openTab(fake.open('text', '/work/docs/a.adoc'))
    workspace.setSetting('language', 'en')
    await vi.advanceTimersByTimeAsync(10_001)
    expect(panel.webview.html).toContain('Визуальный редактор не открылся')
    expect(panel.webview.html).toContain('<html lang="ru">')
  })

  it('opens https, http and mailto in the browser through VS Code', async () => {
    const panel = await readyTab(fake.open('text'))
    for (const href of ['https://example.org/a', 'http://example.org', 'mailto:a@b.c']) await open(panel, href)
    expect(env.opened).toEqual(['https://example.org/a', 'http://example.org', 'mailto:a@b.c'])
    expect(fake.executed.filter((e) => e.command === 'vscode.open')).toEqual([])
  })

  it('opens a file in a tab of VS Code, with its anchor or without, and says when it is not there', async () => {
    workspace.files.add('/work/other/d.adoc')
    workspace.files.add('/work/docs/b.adoc')
    const panel = await readyTab(fake.open('text'))
    await open(panel, '../other/d.adoc')
    await open(panel, 'b.adoc#intro')
    await open(panel, 'xref:b.adoc[]'.replace('[]', ''))
    expect(fake.executed.filter((e) => e.command === 'vscode.open').map((e) => (e.args[0] as Uri).path)).toEqual([
      '/work/other/d.adoc',
      '/work/docs/b.adoc',
      '/work/docs/b.adoc',
    ])
    await open(panel, 'missing.adoc')
    expect(panel.webview.messagesOf('notice')).toEqual([{ type: 'notice', text: 'Файл по ссылке не найден' }])
    expect(fake.executed.filter((e) => e.command === 'vscode.open')).toHaveLength(3)
  })

  it('does not open a forbidden scheme, a file outside the workspace, or a file that is not .adoc: it says so', async () => {
    workspace.workspaceFolders = [{ uri: Uri.file('/work') }]
    workspace.files.add('/work/docs/b.adoc')
    workspace.files.add('/etc/passwd.adoc')
    workspace.files.add('/work/docs/page.html')
    const panel = await readyTab(fake.open('text'))
    const refused = ['javascript:alert(1)', 'data:text/html,x', 'file:///etc/passwd.adoc', 'ftp://x/y.adoc', 'page.html', 'a.pdf', 'vscode://x']
    const outside = ['file:///work/../etc/passwd.adoc', 'file:///work/docs/../../etc/passwd.adoc', '../../etc/passwd.adoc']
    for (const href of [...refused, ...outside]) await open(panel, href)
    expect(env.opened).toEqual([])
    expect(fake.executed.filter((e) => e.command === 'vscode.open')).toEqual([])
    const notices = panel.webview.messagesOf('notice')
    expect(notices).toHaveLength(refused.length + outside.length)
    expect(new Set(notices.map((n) => (n as { text: string }).text))).toEqual(new Set(['Эту ссылку нельзя открыть из редактора']))
    await open(panel, 'file:///work/docs/b.adoc')
    expect(fake.executed.filter((e) => e.command === 'vscode.open')).toHaveLength(1)
    expect(panel.webview.messagesOf('noticeHide')).toHaveLength(1)
  })

  it('opens a file in folders with spaces and Cyrillic, written with spaces or %20, with an anchor or not', async () => {
    workspace.files.add('/work/Мои документы/Раздел А/Папка с пробелом/Файл с пробелом.adoc')
    const panel = await readyTab(fake.open('text', '/work/Мои документы/Раздел А/x.adoc'))
    for (const href of [
      'Папка с пробелом/Файл с пробелом.adoc',
      'xref:Папка%20с%20пробелом/Файл%20с%20пробелом.adoc',
      'Папка%20с%20пробелом/Файл%20с%20пробелом.adoc#intro',
      'Папка с пробелом/Файл с пробелом.adoc#intro',
    ])
      await open(panel, href)
    expect(fake.executed.filter((e) => e.command === 'vscode.open').map((e) => (e.args[0] as Uri).path)).toEqual(
      Array(4).fill('/work/Мои документы/Раздел А/Папка с пробелом/Файл с пробелом.adoc'),
    )
    expect(panel.webview.messagesOf('notice')).toEqual([])
  })

  it('opens a file whose name holds an undefined attribute as written, and a path with a bare %', async () => {
    workspace.files.add('/work/docs/ZZ/GET_items_{itemCode}_state_-_Статус.adoc')
    workspace.files.add('/work/docs/50%.adoc')
    const panel = await readyTab(fake.open('text'))
    await open(panel, 'xref:ZZ/GET_items_{itemCode}_state_-_Статус.adoc')
    await open(panel, '50%.adoc')
    expect(fake.executed.filter((e) => e.command === 'vscode.open').map((e) => (e.args[0] as Uri).path)).toEqual([
      '/work/docs/ZZ/GET_items_{itemCode}_state_-_Статус.adoc',
      '/work/docs/50%.adoc',
    ])
    expect(panel.webview.messagesOf('notice')).toEqual([])
  })
})

describe('the clipboard for Cmd+Shift+V', () => {
  it('reads the text of the clipboard for the tab that cannot, and answers with it', async () => {
    const panel = await readyTab(fake.open('текст'))
    env.clipboard.text = 'первая\nвторая'
    panel.webview.receive({ type: 'readClipboard' })
    await flushPromises()
    expect(panel.webview.messagesOf('clipboard')).toEqual([{ type: 'clipboard', text: 'первая\nвторая' }])
  })

  it('ignores a tab that is not open yet', async () => {
    const panel = openTab(fake.open('текст'))
    panel.webview.receive({ type: 'readClipboard' })
    await flushPromises()
    expect(panel.webview.messagesOf('clipboard')).toEqual([])
  })
})

describe('the width of the page', () => {
  it('init carries the percent, hand-written values are pulled to 50–100, a non-number is 85', async () => {
    for (const [value, percent] of [[undefined, 85], [60, 60], [30, 50], [150, 100], ['abc', 85], [null, 85], [NaN, 85]] as const) {
      workspace.settings = value === undefined ? {} : { pageWidth: value }
      const p = new NotaEditorProvider(Uri.file('/ext'))
      const panel = await readyTab(fake.open('text'))
      expect(panel.webview.messagesOf('init').at(-1)!.pageWidth).toBe(percent)
      p.dispose()
    }
    workspace.settings = {}
  })

  it('a change of the setting tells every open tab, and only that setting', async () => {
    const a = await readyTab(fake.open('a', '/work/docs/a.adoc'))
    const b = await readyTab(fake.open('b', '/work/docs/b.adoc'))
    workspace.setSetting('pageWidth', 60)
    for (const panel of [a, b]) expect(panel.webview.messagesOf('pageWidth')).toEqual([{ type: 'pageWidth', percent: 60 }])
    workspace.setSetting('pageWidth', 150)
    expect(a.webview.messagesOf('pageWidth').at(-1)).toEqual({ type: 'pageWidth', percent: 100 })
    workspace.setSetting('language', 'en')
    expect(a.webview.messagesOf('pageWidth')).toHaveLength(2)
    workspace.settings = {}
  })
})

describe('the view of the outline', () => {
  it('init carries the view, unset and hand-written values are capsule', async () => {
    for (const [value, view] of [[undefined, 'capsule'], ['side', 'side'], ['capsule', 'capsule'], ['abc', 'capsule'], [null, 'capsule'], [5, 'capsule']] as const) {
      workspace.settings = value === undefined ? {} : { outlineView: value }
      const panel = await readyTab(fake.open('text'))
      expect(panel.webview.messagesOf('init').at(-1)!.outlineView).toBe(view)
    }
    workspace.settings = {}
  })

  it('a change of the setting tells every open tab, and only that setting', async () => {
    const a = await readyTab(fake.open('a', '/work/docs/a.adoc'))
    const b = await readyTab(fake.open('b', '/work/docs/b.adoc'))
    workspace.setSetting('outlineView', 'side')
    for (const panel of [a, b]) expect(panel.webview.messagesOf('outlineView')).toEqual([{ type: 'outlineView', view: 'side' }])
    workspace.setSetting('outlineView', 'abc')
    expect(a.webview.messagesOf('outlineView').at(-1)).toEqual({ type: 'outlineView', view: 'capsule' })
    workspace.setSetting('language', 'en')
    expect(a.webview.messagesOf('outlineView')).toHaveLength(2)
  })

  it('the command writes side when unset, capsule after side, where the value is set', async () => {
    const panel = await readyTab(fake.open('a', '/work/docs/a.adoc'))
    await provider.toggleOutlineView()
    expect(workspace.updates).toEqual([{ key: 'outlineView', value: 'side', target: ConfigurationTarget.Global }])
    expect(panel.webview.messagesOf('outlineView').at(-1)).toEqual({ type: 'outlineView', view: 'side' })
    await provider.toggleOutlineView()
    expect(workspace.updates.at(-1)).toEqual({ key: 'outlineView', value: 'capsule', target: ConfigurationTarget.Global })
    workspace.scopes.outlineView = 'folder'
    await provider.toggleOutlineView()
    expect(workspace.updates.at(-1)).toEqual({ key: 'outlineView', value: 'side', target: ConfigurationTarget.WorkspaceFolder })
    workspace.scopes.outlineView = 'workspace'
    await provider.toggleOutlineView()
    expect(workspace.updates.at(-1)).toEqual({ key: 'outlineView', value: 'capsule', target: ConfigurationTarget.Workspace })
  })
})

describe('the anchors over the blocks', () => {
  it('init carries the setting, only the boolean true turns it on', async () => {
    for (const [value, on] of [[undefined, false], [true, true], [false, false], ['true', false], [1, false]] as const) {
      workspace.settings = value === undefined ? {} : { showAnchors: value }
      const p = new NotaEditorProvider(Uri.file('/ext'))
      const panel = await readyTab(fake.open('text'))
      expect(panel.webview.messagesOf('init').at(-1)!.showAnchors).toBe(on)
      p.dispose()
    }
    workspace.settings = {}
  })

  it('a change of the setting tells every open tab, and only that setting', async () => {
    const a = await readyTab(fake.open('a', '/work/docs/a.adoc'))
    const b = await readyTab(fake.open('b', '/work/docs/b.adoc'))
    workspace.setSetting('showAnchors', true)
    for (const panel of [a, b]) expect(panel.webview.messagesOf('showAnchors')).toEqual([{ type: 'showAnchors', on: true }])
    workspace.setSetting('showAnchors', false)
    expect(a.webview.messagesOf('showAnchors').at(-1)).toEqual({ type: 'showAnchors', on: false })
    workspace.setSetting('language', 'en')
    expect(a.webview.messagesOf('showAnchors')).toHaveLength(2)
    workspace.settings = {}
  })
})

describe('the blocks in the capsule', () => {
  it('init carries the setting, only the string frequent turns it on', async () => {
    for (const [value, set] of [[undefined, 'all'], ['all', 'all'], ['frequent', 'frequent'], ['x', 'all'], [1, 'all'], [null, 'all']] as const) {
      workspace.settings = value === undefined ? {} : { blocksInCapsule: value }
      const p = new NotaEditorProvider(Uri.file('/ext'))
      const panel = await readyTab(fake.open('text'))
      expect(panel.webview.messagesOf('init').at(-1)!.blocksInCapsule).toBe(set)
      p.dispose()
    }
    workspace.settings = {}
  })

  it('a change of the setting tells every open tab, and only that setting', async () => {
    const a = await readyTab(fake.open('a', '/work/docs/a.adoc'))
    const b = await readyTab(fake.open('b', '/work/docs/b.adoc'))
    workspace.setSetting('blocksInCapsule', 'frequent')
    for (const panel of [a, b]) expect(panel.webview.messagesOf('blocksInCapsule')).toEqual([{ type: 'blocksInCapsule', set: 'frequent' }])
    workspace.setSetting('blocksInCapsule', 'x')
    expect(a.webview.messagesOf('blocksInCapsule').at(-1)).toEqual({ type: 'blocksInCapsule', set: 'all' })
    workspace.setSetting('language', 'en')
    expect(a.webview.messagesOf('blocksInCapsule')).toHaveLength(2)
    workspace.settings = {}
  })
})

describe('the settings of Nota', () => {
  it('the message openSettings opens the Settings of VS Code, filtered by the id of the extension', async () => {
    provider.dispose()
    provider = new NotaEditorProvider(Uri.file('/ext'), { extensionId: 'acme.nota-vscode' })
    const panel = await readyTab(fake.open('текст'))
    panel.webview.receive({ type: 'openSettings' })
    await flushPromises()
    expect(fake.executed).toEqual([{ command: 'workbench.action.openSettings', args: ['@ext:acme.nota-vscode'] }])
  })

  it('the command (the palette) opens the same, and the tab and its text stay', async () => {
    const doc = fake.open('текст')
    const panel = await readyTab(doc)
    await provider.openSettings()
    expect(fake.executed.map((e) => e.command)).toEqual(['workbench.action.openSettings'])
    expect(fake.executed[0]!.args).toEqual(['@ext:nota-adoc.nota-vscode'])
    expect(panel.disposed).toBe(false)
    expect(doc.getText()).toBe('текст')
  })

  it('a failure of the command does not break the tab', async () => {
    fake.failing.add('workbench.action.openSettings')
    const panel = await readyTab(fake.open('текст'))
    panel.webview.receive({ type: 'openSettings' })
    await flushPromises()
    expect(panel.disposed).toBe(false)
  })
})
