// the DOM of a cell whose text is shown as it is (with line breaks) is read again without a change of the file.
import { afterEach, describe, expect, it } from 'vitest'
import { closeAll, open } from './helpers.js'

afterEach(closeAll)

const A = '[%header,cols="2"]\n|===\n|Шапка\na|Способ:\n* один\n* два\n\n+номер\n|===\n'
const B = '|===\n|x\n\ny\n|===\n'
const TEXTS: [string, string][] = [
  ['а: a| в шапке', A],
  ['б: пустая строка внутри', B],
  ['в: стиль l', '|===\nl|x\ny\n|===\n'],
  ['г: \\|', '|===\n|x \\| q\ny\n|===\n'],
  ['д: CRLF', '|===\r\n|x\r\ny\r\n|===\r\n'],
  ['е: csv', ',===\nx,"a\nb"\n,===\n'],
]

/** Writes the text nodes of the cells again, as the DOM of the editor is changed by the browser, and lets ProseMirror read it. */
function reread(root: HTMLElement, edit?: (t: Text) => void): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  for (let n = walker.nextNode(); n; n = walker.nextNode())
    if ((n.parentElement as HTMLElement).closest('.cell-text')) nodes.push(n as Text)
  for (const t of nodes) {
    if (edit) edit(t)
    else t.data = String(t.data)
  }
}

describe('the DOM of a cell is read again', () => {
  for (const [name, text] of TEXTS)
    it(`${name}: the file stays as it was`, () => {
      const { editor, session } = open(text)
      const events: unknown[] = []
      session.subscribe((e: unknown) => events.push(e))
      expect(session.text).toBe(text)
      reread(editor.view.dom as HTMLElement)
      ;(editor.view as unknown as { domObserver: { flush(): void } }).domObserver.flush()
      expect(session.text).toBe(text)
      expect(events).toEqual([])
    })
})

describe('typing in the DOM of a cell with line breaks', () => {
  for (const [text, want] of [
    [A, A.replace('Способ:', 'Способ:Z')],
    [B, B.replace('|x', '|xZ')],
  ] as const)
    it(`changes only the typed character: ${JSON.stringify(want.slice(-30))}`, () => {
      const { editor, session } = open(text)
      let done = false
      reread(editor.view.dom as HTMLElement, (t) => {
        if (done || !t.data.includes('\n')) return
        const i = t.data.indexOf('\n')
        t.data = t.data.slice(0, i) + 'Z' + t.data.slice(i)
        done = true
      })
      expect(done).toBe(true)
      ;(editor.view as unknown as { domObserver: { flush(): void } }).domObserver.flush()
      expect(session.text).toBe(want)
    })
})
