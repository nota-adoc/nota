// A diagram: a Mermaid block shown as a picture. The picture is drawn by a function the host gives; here it is a stand-in.
import { createSession } from '@nota-adoc/core'
import { type DiagramRenderer, RendererMissing, createVisualEditor, projectDocument } from '@nota-adoc/prosemirror'
import { TextSelection } from 'prosemirror-state'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeAll, key, type } from './helpers.js'

const SRC = 'Before\n\n[mermaid]\n....\nflowchart LR\n  A --> B\n....\n\nAfter\n'

type Editor = ReturnType<typeof createVisualEditor>
interface Opened {
  editor: Editor
  session: ReturnType<typeof createSession>
  el: HTMLElement
  calls: { code: string; theme: string }[]
  rejects: string[]
}
const editors: Editor[] = []

/** The stand-in: draws a code as an svg with the number of its lines, and rejects a code with BROKEN in it. */
function show(text: string, options: { render?: DiagramRenderer | null; theme?: () => 'light' | 'dark' } = {}): Opened {
  const session = createSession(text)
  const el = document.createElement('div')
  document.body.append(el)
  const calls: Opened['calls'] = []
  const rejects: string[] = []
  const stub: DiagramRenderer = (code, theme) => {
    calls.push({ code, theme })
    return code.includes('BROKEN')
      ? Promise.reject(new Error('Parse error on line 2'))
      : Promise.resolve(`<svg data-theme="${theme}"><text>${code.split('\n').length}</text></svg>`)
  }
  const editor = createVisualEditor(el, {
    session,
    ...(options.render === null ? {} : { renderDiagram: options.render ?? stub }),
    diagramTheme: options.theme ?? (() => 'light'),
    onReject: (_m, info) => rejects.push(info.code),
  })
  editors.push(editor)
  return { editor, session, el, calls, rejects }
}

const settle = async (): Promise<void> => {
  await vi.advanceTimersByTimeAsync(0)
}
const pic = (o: Opened, i = 0): string | null => o.el.querySelectorAll('.nota-diagram')[i]!.querySelector('.diagram-pic svg text')?.textContent ?? null

/** The cursor at character `k` of the code of the first diagram. */
const cursorIn = (o: Opened, k: number): void => {
  const doc = o.editor.view.state.doc
  let pos = 0
  doc.forEach((n, off) => {
    if (pos === 0 && n.type.name === 'diagram') pos = off + 1 + k
  })
  o.editor.view.dispatch(o.editor.view.state.tr.setSelection(TextSelection.create(doc, pos)))
}
const endOfCode = (o: Opened): void => cursorIn(o, 'flowchart LR\n  A --> B'.length)

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  for (const e of editors.splice(0)) e.destroy()
  closeAll()
  vi.useRealTimers()
})

describe('a diagram', () => {
  it('is a picture of the code between the delimiters, for every form of the block', async () => {
    const o = show(
      '[mermaid]\n....\nflowchart LR\nA-->B\n....\n\n[mermaid]\n----\nflowchart LR\nC-->D\n----\n\n[mermaid,queue,svg]\n....\nflowchart TD\nE-->F\n....\n\n[source,mermaid]\n----\nx\n----\n',
    )
    expect(o.el.querySelectorAll('.diagram-wait')).toHaveLength(3)
    await settle()
    expect(o.el.querySelectorAll('.nota-diagram')).toHaveLength(3)
    expect(o.el.querySelectorAll('.nota-diagram .diagram-pic svg')).toHaveLength(3)
    expect(o.el.querySelectorAll('.nota-island')).toHaveLength(0)
    expect(o.el.querySelectorAll('.nota-code')).toHaveLength(1)
    expect([...o.el.querySelectorAll('.diagram-title')].map((e) => e.textContent)).toEqual(['Mermaid', 'Mermaid', 'Mermaid · queue'])
    expect(o.calls.map((c) => c.code)).toEqual(['flowchart LR\nA-->B', 'flowchart LR\nC-->D', 'flowchart TD\nE-->F'])
    expect(o.editor.view.state.doc.eq(projectDocument(o.session.doc))).toBe(true)
  })

  it('shows the code only while the cursor is in the block', async () => {
    const o = show(SRC)
    await settle()
    const dia = o.el.querySelector('.nota-diagram')!
    expect(dia.classList.contains('editing')).toBe(false)
    endOfCode(o)
    expect(dia.classList.contains('editing')).toBe(true)
    o.editor.setSelectionAtOffset(0)
    expect(dia.classList.contains('editing')).toBe(false)
  })

  it('a click on the picture puts the cursor in the code', async () => {
    const o = show(SRC)
    await settle()
    o.el.querySelector('.diagram-box')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    expect(o.el.querySelector('.nota-diagram')!.classList.contains('editing')).toBe(true)
    expect(o.editor.view.state.selection.$head.parent.type.name).toBe('diagram')
  })

  it('draws again only after a pause of 300 ms; the file gets the line between the delimiters; one undo gives the file back', async () => {
    const o = show(SRC)
    await settle()
    endOfCode(o)
    const before = o.session.text
    key(o.editor, 'Enter')
    type(o.editor, '  C --> D[Итог]')
    expect(o.session.text).toBe('Before\n\n[mermaid]\n....\nflowchart LR\n  A --> B\n  C --> D[Итог]\n....\n\nAfter\n')
    await vi.advanceTimersByTimeAsync(250)
    expect(pic(o)).toBe('2')
    expect(o.calls).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(100)
    expect(o.calls).toHaveLength(2)
    expect(o.calls[1]!.code).toBe('flowchart LR\n  A --> B\n  C --> D[Итог]')
    expect(pic(o)).toBe('3')
    o.session.undo()
    expect(o.session.text).toBe(before)
    expect(o.editor.view.state.doc.eq(projectDocument(o.session.doc))).toBe(true)
  })

  it('keeps the last good picture, greyed, with the error; the file has the text as typed; the error goes with the fix', async () => {
    const o = show(SRC)
    await settle()
    endOfCode(o)
    type(o.editor, ' BROKEN')
    await vi.advanceTimersByTimeAsync(400)
    const dia = o.el.querySelector('.nota-diagram')!
    expect(dia.classList.contains('stale')).toBe(true)
    expect(pic(o)).toBe('2')
    const bar = dia.querySelector<HTMLElement>('.diagram-bar')!
    expect(bar.hidden).toBe(false)
    expect(bar.textContent).toContain('The diagram could not be parsed. The last good picture is shown.')
    expect(bar.textContent).toContain('Parse error on line 2')
    expect(o.session.text).toContain('  A --> B BROKEN\n....')
    for (let i = 0; i < ' BROKEN'.length; i++) key(o.editor, 'Backspace')
    await vi.advanceTimersByTimeAsync(400)
    expect(dia.classList.contains('stale')).toBe(false)
    expect(bar.hidden).toBe(true)
  })

  it('a diagram that is broken from the start is a plate with the same message, and the code can be edited', async () => {
    const o = show('[mermaid]\n....\nflowchart BROKEN\n....\n')
    await settle()
    const dia = o.el.querySelector('.nota-diagram')!
    expect(dia.classList.contains('broken')).toBe(true)
    expect(dia.querySelector('.diagram-plate')!.textContent).toContain('The diagram could not be drawn')
    expect(dia.querySelector('.diagram-bar')!.textContent).toContain('Error in the diagram code')
    expect(dia.querySelector('.diagram-bar')!.textContent).toContain('Parse error on line 2')
    cursorIn(o, 'flowchart BROKEN'.length)
    for (let i = 0; i < 'BROKEN'.length; i++) key(o.editor, 'Backspace')
    type(o.editor, 'LR')
    await vi.advanceTimersByTimeAsync(400)
    expect(o.session.text).toBe('[mermaid]\n....\nflowchart LR\n....\n')
    expect(dia.classList.contains('broken')).toBe(false)
    expect(pic(o)).toBe('1')
  })

  it('says so, in every diagram, when the renderer did not load', async () => {
    const o = show(SRC, { render: () => Promise.reject(new RendererMissing()) })
    await settle()
    expect(o.el.querySelector('.nota-diagram .diagram-plate.nodrawer')!.textContent).toContain('Diagrams are not drawn')
    const none = show(SRC, { render: null })
    await settle()
    expect(none.el.querySelector('.diagram-plate.nodrawer')).not.toBeNull()
  })

  it('draws again in the colours of the theme when it changes', async () => {
    let theme: 'light' | 'dark' = 'light'
    const o = show(SRC, { theme: () => theme })
    await settle()
    expect(o.el.querySelector('svg')!.getAttribute('data-theme')).toBe('light')
    theme = 'dark'
    o.editor.redrawDiagrams()
    await settle()
    expect(o.el.querySelector('svg')!.getAttribute('data-theme')).toBe('dark')
    expect(o.session.text).toBe(SRC)
  })

  it('a line of delimiter characters typed in the code makes the delimiters longer, and the block stays a diagram', async () => {
    const o = show(SRC)
    await settle()
    endOfCode(o)
    key(o.editor, 'Enter')
    type(o.editor, '....')
    expect(o.session.text).toBe('Before\n\n[mermaid]\n.....\nflowchart LR\n  A --> B\n....\n.....\n\nAfter\n')
    expect(o.el.querySelectorAll('.nota-diagram')).toHaveLength(1)
    expect(o.editor.view.state.doc.eq(projectDocument(o.session.doc))).toBe(true)
    o.session.undo()
    expect(o.session.text).toBe(SRC)
  })

  it('takes the line breaks of the file', async () => {
    const o = show('[mermaid]\r\n....\r\nflowchart LR\r\n  A --> B\r\n....\r\n')
    await settle()
    cursorIn(o, 'flowchart LR\n  A --> B'.length)
    type(o.editor, 'X')
    expect(o.session.text).toBe('[mermaid]\r\n....\r\nflowchart LR\r\n  A --> BX\r\n....\r\n')
  })

  it('an empty code is a diagram too, and the first line typed in it is written', async () => {
    const o = show('[mermaid]\n....\n....\n')
    await settle()
    expect(o.el.querySelectorAll('.nota-diagram')).toHaveLength(1)
    cursorIn(o, 0)
    type(o.editor, 'flowchart LR')
    expect(o.session.text).toBe('[mermaid]\n....\nflowchart LR\n....\n')
  })

  it('Esc leaves the block', async () => {
    const o = show(SRC)
    await settle()
    endOfCode(o)
    expect(key(o.editor, 'Escape')).toBe(true)
    expect(o.el.querySelector('.nota-diagram')!.classList.contains('editing')).toBe(false)
    expect(o.editor.view.state.selection.$head.parent.textContent).toBe('After')
  })

  describe('an arrow at the edge of the text next to a diagram goes into its code', () => {
    const CODE = 'flowchart LR\n  A --> B'
    /** The cursor at the end (or the start) of the paragraph `text`. */
    const inParagraph = (o: Opened, text: string, at: 'start' | 'end'): void => {
      let pos = -1
      o.editor.view.state.doc.forEach((n, off) => {
        if (n.type.name === 'paragraph' && n.textContent === text) pos = off + 1 + (at === 'end' ? n.content.size : 0)
      })
      o.editor.view.dispatch(o.editor.view.state.tr.setSelection(TextSelection.create(o.editor.view.state.doc, pos)))
    }
    const where = (o: Opened): { parent: string; offset: number } => {
      const h = o.editor.view.state.selection.$head
      return { parent: h.parent.type.name, offset: h.parentOffset }
    }
    // jsdom has no layout: the end of the textblock is told by the stand-in
    const atEdge = (o: Opened): void => {
      vi.spyOn(o.editor.view, 'endOfTextblock').mockReturnValue(true)
    }

    it.each([['ArrowDown'], ['ArrowRight']])('%s from the paragraph above puts the cursor at the start of the code', async (name) => {
      const o = show(SRC)
      await settle()
      atEdge(o)
      inParagraph(o, 'Before', 'end')
      expect(key(o.editor, name)).toBe(true)
      expect(where(o)).toEqual({ parent: 'diagram', offset: 0 })
      expect(o.el.querySelector('.nota-diagram')!.classList.contains('editing')).toBe(true)
    })

    it.each([['ArrowUp'], ['ArrowLeft']])('%s from the paragraph below puts the cursor at the end of the code', async (name) => {
      const o = show(SRC)
      await settle()
      atEdge(o)
      inParagraph(o, 'After', 'start')
      expect(key(o.editor, name)).toBe(true)
      expect(where(o)).toEqual({ parent: 'diagram', offset: CODE.length })
      expect(o.el.querySelector('.nota-diagram')!.classList.contains('editing')).toBe(true)
    })

    it('does nothing while the caret is not at the edge of the text, and the file stays as it was', async () => {
      const o = show(SRC)
      await settle()
      vi.spyOn(o.editor.view, 'endOfTextblock').mockReturnValue(false)
      inParagraph(o, 'Before', 'start')
      expect(key(o.editor, 'ArrowDown')).toBe(false)
      expect(where(o).parent).toBe('paragraph')
      expect(o.session.text).toBe(SRC)
    })
  })

  it('is put in by the menu: a block with a sample, the cursor in its code, one undo takes it away', async () => {
    const o = show('Before\n\n\n\nAfter\n')
    o.editor.view.dispatch(o.editor.view.state.tr.setSelection(TextSelection.near(o.editor.view.state.doc.resolve(o.editor.view.state.doc.child(0).nodeSize + 1))))
    const before = o.session.text
    expect(o.editor.commands.insertBlock('mermaid')).toBe(true)
    expect(o.session.text).toBe('Before\n\n[mermaid]\n....\nflowchart LR\nA[Start] --> B[Step]\nB --> C(Done)\n....\n\n\nAfter\n')
    await settle()
    expect(o.el.querySelectorAll('.nota-diagram .diagram-pic')).toHaveLength(1)
    const head = o.editor.view.state.selection.$head
    expect(head.parent.type.name).toBe('diagram')
    expect(head.parentOffset).toBe(head.parent.content.size)
    o.session.undo()
    expect(o.session.text).toBe(before)
    expect(o.editor.view.state.doc.eq(projectDocument(o.session.doc))).toBe(true)
  })
})
