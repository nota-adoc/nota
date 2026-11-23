import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionEvent } from '@nota-adoc/core'
import { Mirror, diffChange } from '../../src/webview/mirror.js'
import type { ToHost } from '../../src/protocol.js'

let sent: ToHost[]
let stale: number

function make(text = 'Первый абзац.\n\nВторой абзац.\n', extra: Partial<ConstructorParameters<typeof Mirror>[0]> = {}) {
  return new Mirror({ text, version: 1, send: (m) => sent.push(m), onStale: () => stale++, ...extra })
}
const edits = (): Extract<ToHost, { type: 'edit' }>[] => sent.filter((m): m is Extract<ToHost, { type: 'edit' }> => m.type === 'edit')

beforeEach(() => {
  vi.useFakeTimers()
  sent = []
  stale = 0
})
afterEach(() => vi.useRealTimers())

describe('typing', () => {
  it('shows the text at once and sends one edit after a pause', () => {
    const m = make('')
    let at = 0
    for (const ch of 'проверка') {
      m.apply([{ from: at, to: at, insert: ch }])
      at++
      vi.advanceTimersByTime(50)
    }
    expect(m.text).toBe('проверка')
    expect(sent).toEqual([])
    vi.advanceTimersByTime(300)
    expect(sent).toEqual([{ type: 'edit', id: 1, baseVersion: 1, changes: [{ from: 0, to: 0, insert: 'проверка' }] }])
  })

  it('does not send while the typing goes on, but not later than 800 ms', () => {
    const m = make('')
    let at = 0
    for (let i = 0; i < 30; i++) {
      m.apply([{ from: at, to: at + 0, insert: 'я' }])
      at++
      vi.advanceTimersByTime(100)
    }
    // typed for 3 s without a pause of 300 ms: still sent in pieces
    expect(edits().length).toBeGreaterThan(0)
    expect(edits()[0]!.changes[0]!.insert.length).toBeLessThanOrEqual(9)
  })

  it('sends a group when the cursor moves to another place', () => {
    const m = make('аб\n\nвг\n')
    m.apply([{ from: 1, to: 1, insert: 'X' }])
    m.apply([{ from: 6, to: 6, insert: 'Y' }])
    expect(edits()).toEqual([{ type: 'edit', id: 1, baseVersion: 1, changes: [{ from: 1, to: 1, insert: 'X' }] }])
    vi.advanceTimersByTime(300)
    // the second goes after the answer to the first
    expect(edits()).toHaveLength(1)
    m.ack(1, 2)
    expect(edits()[1]).toEqual({ type: 'edit', id: 2, baseVersion: 2, changes: [{ from: 6, to: 6, insert: 'Y' }] })
  })

  it('keeps a replacement of a stretch as one change', () => {
    const m = make('abcdef')
    m.apply([{ from: 2, to: 4, insert: 'XY' }])
    m.apply([{ from: 3, to: 4, insert: 'Z' }])
    m.flush()
    expect(edits()[0]!.changes).toEqual([{ from: 2, to: 4, insert: 'XZ' }])
  })

  it('tells the listeners with the origin of the one who typed', () => {
    const m = make('текст')
    const events: SessionEvent[] = []
    m.subscribe((e) => events.push(e))
    const who = {}
    m.apply([{ from: 5, to: 5, insert: '!' }], { origin: who })
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ kind: 'apply', origin: who, changes: [{ from: 5, to: 5, insert: '!' }] })
    expect(events[0]!.doc.text).toBe('текст!')
    expect(m.doc).toBe(events[0]!.doc)
  })

  it('refuses a range outside the text', () => {
    expect(() => make('аб').apply([{ from: 1, to: 9, insert: '' }])).toThrow(RangeError)
  })

  it('does not send while an input method composes', () => {
    let composing = true
    const m = make('', { composing: () => composing })
    m.apply([{ from: 0, to: 0, insert: 'а' }])
    vi.advanceTimersByTime(2_000)
    expect(sent).toEqual([])
    composing = false
    vi.advanceTimersByTime(400)
    expect(edits()).toHaveLength(1)
  })
})

describe('flush', () => {
  it('sends what is collected at once', () => {
    const m = make('')
    m.apply([{ from: 0, to: 0, insert: 'я' }])
    m.flush()
    expect(edits()).toHaveLength(1)
    vi.advanceTimersByTime(1000)
    expect(edits()).toHaveLength(1)
  })

  it('whenSent answers after the host took everything', () => {
    const m = make('')
    m.apply([{ from: 0, to: 0, insert: 'я' }])
    const done = vi.fn()
    m.whenSent(done)
    expect(done).not.toHaveBeenCalled()
    m.ack(1, 2)
    expect(done).toHaveBeenCalledTimes(1)
  })

  it('whenSent answers at once when there is nothing to send', () => {
    const done = vi.fn()
    make().whenSent(done)
    expect(done).toHaveBeenCalledTimes(1)
  })
})

describe('undo and redo', () => {
  it('send the typed text first, then ask the host', () => {
    const m = make('')
    m.apply([{ from: 0, to: 0, insert: 'слово' }])
    m.undo({ origin: 'editor' })
    expect(sent.map((s) => s.type)).toEqual(['edit'])
    m.ack(1, 2)
    expect(sent.map((s) => s.type)).toEqual(['edit', 'undo'])
  })

  it('ask the host at once when nothing waits', () => {
    const m = make()
    m.redo()
    expect(sent).toEqual([{ type: 'redo' }])
  })

  it('come back as undo and redo events of the origin that asked, so the cursor lands there', () => {
    const m = make('слово проверка')
    const editor = {}
    const events: SessionEvent[] = []
    m.subscribe((e) => events.push(e))
    m.undo({ origin: editor })
    m.update(2, [{ from: 5, to: 14, insert: '' }], 'undo')
    expect(m.text).toBe('слово')
    expect(events.map((e) => [e.kind, e.origin])).toEqual([['undo', editor]])
    m.redo({ origin: editor })
    m.update(3, [{ from: 5, to: 5, insert: ' проверка' }], 'redo')
    expect(m.text).toBe('слово проверка')
    expect(events.map((e) => [e.kind, e.origin])).toEqual([
      ['undo', editor],
      ['redo', editor],
    ])
  })
})

describe('the host speaks', () => {
  it('applies an edit of another source as an apply event of the host', () => {
    const m = make('аб вг')
    const events: SessionEvent[] = []
    m.subscribe((e) => events.push(e))
    m.update(2, [{ from: 0, to: 0, insert: 'X' }], undefined)
    expect(m.text).toBe('Xаб вг')
    expect(events[0]).toMatchObject({ kind: 'apply', origin: 'host', changes: [{ from: 0, to: 0, insert: 'X' }] })
    expect(stale).toBe(0)
  })

  it('takes the version of an answer for the next edit', () => {
    const m = make('')
    m.apply([{ from: 0, to: 0, insert: 'а' }])
    m.flush()
    m.ack(1, 2)
    m.update(3, [{ from: 0, to: 0, insert: 'Z' }], undefined)
    m.apply([{ from: 2, to: 2, insert: 'б' }])
    m.flush()
    expect(edits()[1]).toMatchObject({ baseVersion: 3 })
  })

  it('drops typed text that was not sent when the document changed, shows the document and tells the person', () => {
    const m = make('аб\n\nвг\n')
    const events: SessionEvent[] = []
    m.apply([{ from: 1, to: 1, insert: 'ТЕКСТ' }])
    m.subscribe((e) => events.push(e))
    m.update(2, [{ from: 5, to: 5, insert: '!' }], undefined)
    expect(m.text).toBe('аб\n\nв!г\n')
    expect(stale).toBe(1)
    expect(events).toHaveLength(1)
    // the timer of the dropped group sends nothing
    vi.advanceTimersByTime(1000)
    expect(edits()).toEqual([])
  })

  it('drops an edit the host refused and shows the text it sent', () => {
    const m = make('аб')
    m.apply([{ from: 2, to: 2, insert: '!!' }])
    m.flush()
    m.reset('вот так\n', 7, true)
    expect(m.text).toBe('вот так\n')
    expect(stale).toBe(1)
    m.apply([{ from: 0, to: 0, insert: 'x' }])
    m.flush()
    expect(edits()[1]).toMatchObject({ baseVersion: 7 })
  })

  it('does not tell the person of a reset that dropped nothing', () => {
    const m = make('аб')
    m.reset('аб, вг', 5, false)
    expect(m.text).toBe('аб, вг')
    expect(stale).toBe(0)
  })

  it('asks for the text anew when a version is missing', () => {
    const m = make()
    m.update(5, [{ from: 0, to: 0, insert: 'x' }], undefined)
    expect(sent).toEqual([{ type: 'resync' }])
    expect(m.text).toBe('Первый абзац.\n\nВторой абзац.\n')
  })
})

describe('diffChange', () => {
  it('keeps the common start and end', () => {
    expect(diffChange('abcdef', 'abXYef')).toEqual({ from: 2, to: 4, insert: 'XY' })
    expect(diffChange('abc', 'abc')).toBeNull()
    expect(diffChange('', 'abc')).toEqual({ from: 0, to: 0, insert: 'abc' })
  })
  it('does not cut a surrogate pair', () => {
    const c = diffChange('a😀b', 'a😁b')!
    expect(c).toEqual({ from: 1, to: 3, insert: '😁' })
  })
})
