// Pasting HTML: the converter on the fixtures, and the editor that writes what it makes.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { projectDocument } from '@nota-adoc/prosemirror'
import { convertHtml, fragmentSource } from '../src/paste.js'
import { type Setup, closeAll, inCell, open, posIn, select, shape } from './helpers.js'

afterEach(closeAll)

const clip = (name: string): string => readFileSync(resolve(process.cwd(), 'quality/fixtures/editor/clipboard', name), 'utf8')
const source = (html: string): string => fragmentSource(convertHtml(html).blocks)

const synced = ({ editor, session }: Setup): void => {
  expect(editor.view.state.doc.eq(projectDocument(session.doc))).toBe(true)
}

interface Clip {
  html?: string
  text?: string
  types?: string[]
  files?: number
}

/** A paste event with what the clipboard holds. */
function paste(s: Setup, c: Clip): void {
  const event = new Event('paste', { bubbles: true, cancelable: true })
  const types = c.types ?? [...(c.html !== undefined ? ['text/html'] : []), ...(c.text !== undefined ? ['text/plain'] : [])]
  Object.defineProperty(event, 'clipboardData', {
    value: {
      getData: (type: string) => (type === 'text/html' ? (c.html ?? '') : type === 'text/plain' ? (c.text ?? '') : ''),
      types,
      files: { length: c.files ?? 0 },
    },
  })
  s.editor.view.dom.dispatchEvent(event)
}

describe('the converter of HTML to AsciiDoc', () => {
  it('reads a page of a browser: marks, a link, lists with levels', () => {
    const r = convertHtml(clip('page.html'))
    expect(r.verified).toBe(true)
    expect(fragmentSource(r.blocks)).toBe(
      'Первый абзац с *жирным* словом, _курсивом_ и https://example.com/docs[ссылкой на документ].\n\n* Первый пункт\n** Вложенный пункт\n* Второй пункт\n\n//\n\n. Шаг один\n. Шаг два',
    )
  })

  it('reads a page of Word: no fonts, styles, conditional comments, empty paragraphs or bullet signs', () => {
    const r = convertHtml(clip('word-mac.html'))
    const out = fragmentSource(r.blocks)
    expect(r.verified).toBe(true)
    expect(out).toBe(
      '*Отчёт за неделю* подготовлен по https://example.com/report[ссылке на отчёт].\n\n* Первый пункт\n** Вложенный пункт\n* Второй пункт\n\n//\n\n. Шаг один\n. Шаг два',
    )
    expect(out).not.toMatch(/mso-|\[if|Calibri|·|font/)
  })

  it('takes bold and italic from the style when there is no tag', () => {
    expect(source('<p>a <span style="font-weight:700">bold</span> and <span style="font-style: italic">slanted</span> <b style="font-weight:normal">plain</b></p>')).toBe(
      'a *bold* and _slanted_ plain',
    )
  })

  it('writes a mark inside a word with the double sign, and keeps blanks out of the marks', () => {
    expect(source('<p>un<b>believ</b>able and <i>em </i>done</p>')).toBe('un**believ**able and _em_ done')
  })

  it('carries over monospace, strikethrough, line breaks and the links that are safe', () => {
    expect(
      source('<p><code>x = 1</code> <s>old</s> <a href="javascript:alert(1)">bad</a> <a href="mailto:a@example.com">mail</a><br>next line</p>'),
    ).toBe('`x = 1` [.line-through]#old# bad mailto:a@example.com[mail] +\nnext line')
  })

  it('escapes only where the text would be markup', () => {
    const r = convertHtml('<p>2 * 3 * 4, a_b_c and #тег, but *this* and _that_</p>')
    const out = fragmentSource(r.blocks)
    expect(out).toContain('2 * 3 * 4, a_b_c and #тег')
    expect(out).toContain('\\*this*')
    expect(r.verified).toBe(true)
  })

  it('makes a section of a heading, a table of a table with its header, and drops pictures', () => {
    const r = convertHtml(
      '<h1>One</h1><h2>Two</h2><h3>Three</h3><table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td colspan="2">x|y</td></tr></table><p><img src="a.png"></p>',
    )
    expect(r.images).toBe(true)
    expect(r.verified).toBe(true)
    expect(fragmentSource(r.blocks)).toBe(
      '== One\n\n== Two\n\n=== Three\n\n[%header,cols="3"]\n|===\n|A |B |\n\n|1 |x\\|y |\n|===',
    )
  })

  it('reads the lines of a code editor as paragraphs', () => {
    expect(source(clip('vscode.html'))).toBe('const total = 42;\n\nprint(total);')
  })
})

describe('Cmd+V of HTML in the editor', () => {
  it('pastes into an empty paragraph the marks, the link and the lists, in one step of the history', () => {
    const s = open('Before\n\n\n\nAfter\n')
    const before = s.session.text
    select(s.editor, posIn(s.editor, 2, 0))
    paste(s, { html: clip('page.html'), text: 'plain' })
    expect(s.session.text).toContain('Первый абзац с *жирным* словом, _курсивом_ и https://example.com/docs[ссылкой на документ].')
    expect(s.session.text).toContain('* Первый пункт\n** Вложенный пункт\n* Второй пункт')
    expect(s.session.text).toContain('. Шаг один\n. Шаг два')
    expect(s.session.text.startsWith('Before\n\n')).toBe(true)
    expect(s.session.text.endsWith('After\n')).toBe(true)
    expect(s.el.querySelectorAll('strong')).toHaveLength(1)
    expect(s.el.querySelectorAll('a[href="https://example.com/docs"]')).toHaveLength(1)
    synced(s)
    s.session.undo()
    expect(s.session.text).toBe(before)
    expect(s.session.canUndo).toBe(false)
    synced(s)
  })

  it('continues the paragraph with the first paragraph and puts the other blocks after it', () => {
    const s = open('hello world\n\nnext\n')
    select(s.editor, posIn(s.editor, 0, 5))
    paste(s, { html: '<p> big <b>bold</b></p><p>second</p><ul><li>x</li></ul>', text: 'x' })
    expect(s.session.text).toBe('hello big *bold* world\n\nsecond\n\n* x\n\nnext\n')
    synced(s)
  })

  it('writes a mark in the middle of a word with the double sign', () => {
    const s = open('abcdef\n')
    select(s.editor, posIn(s.editor, 0, 3))
    paste(s, { html: '<p><b>XY</b></p>', text: 'XY' })
    expect(s.session.text).toBe('abc**XY**def\n')
    synced(s)
  })

  it('pastes the symbols of the text as they are', () => {
    const s = open('\n')
    select(s.editor, posIn(s.editor, 0, 0))
    paste(s, { html: '<p>2 * 3 * 4, a_b_c and #тег</p>', text: '' })
    expect(shape(s.editor)).toBe('2 * 3 * 4, a_b_c and #тег')
    expect(s.session.text).toContain('2 * 3 * 4, a_b_c and #тег')
    synced(s)
  })

  it('pastes a heading as a section and a table as a table', () => {
    const s = open('\n')
    select(s.editor, posIn(s.editor, 0, 0))
    paste(s, { html: '<h2>Title</h2><table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>', text: '' })
    expect(s.session.text).toContain('== Title')
    expect(s.session.text).toContain('|===')
    expect(s.session.text).toContain('|1 |2')
    synced(s)
  })

  it('pastes plain text, on one line, into a heading', () => {
    const s = open('== Head\n\n[cols="2"]\n|===\n|a |b\n|===\n')
    select(s.editor, posIn(s.editor, 0, 4))
    paste(s, { html: '<p>one</p><p>two</p>', text: 'one\ntwo' })
    expect(s.session.text.startsWith('== Headone two\n')).toBe(true)
    synced(s)
  })

  it('pastes plain text, on one line and with no marks, into a cell', () => {
    const s = open('[cols="2"]\n|===\n|a |b\n|===\n')
    inCell(s.editor, 'a')
    paste(s, { html: '<p><b>one</b></p><p>two</p>', text: 'one\ntwo' })
    expect(s.session.text).toBe('[cols="2"]\n|===\n|aone two |b\n|===\n')
    synced(s)
  })

  it('pastes plain text into an island, with no marks', () => {
    const s = open('// note\n\nafter\n')
    select(s.editor, posIn(s.editor, 0, 7))
    paste(s, { html: '<p><b>bold</b></p>', text: 'bold' })
    expect(s.session.text).toBe('// notebold\n\nafter\n')
    synced(s)
  })

  it('pastes plain text into the code of a diagram, with no marks', () => {
    const s = open('[mermaid]\n....\nflowchart LR\n....\n')
    select(s.editor, posIn(s.editor, 0, 'flowchart LR'.length))
    paste(s, { html: '<p><b>X</b></p>', text: '\n  A --> B' })
    expect(s.session.text).toBe('[mermaid]\n....\nflowchart LR\n  A --> B\n....\n')
    synced(s)
  })

  it('pastes plain text into code, with no marks', () => {
    const s = open('----\ncode\n----\n')
    select(s.editor, posIn(s.editor, 0, 4))
    paste(s, { html: '<p><b>bold</b></p>', text: 'bold' })
    expect(s.session.text).toBe('----\ncodebold\n----\n')
    synced(s)
  })

  it('pastes the copy of a code editor, and a clipboard with HTML that has no text, as plain text', () => {
    const s = open('\n')
    select(s.editor, posIn(s.editor, 0, 0))
    paste(s, { html: clip('vscode.html'), text: 'const total = 42;\n  print(total);', types: ['text/plain', 'text/html', 'vscode-editor-data'] })
    expect(shape(s.editor)).toBe('const total = 42;|print(total);')
    synced(s)
  })

  it('says that pictures are not pasted, and pastes the text', () => {
    const s = open('\n')
    select(s.editor, posIn(s.editor, 0, 0))
    paste(s, { html: '<p>text <img src="a.png"></p>', text: 'text' })
    expect(s.rejects.map((r) => r.code)).toEqual(['paste-images'])
    expect(s.session.text).toBe('text\n\n')
    s.rejects.length = 0
    paste(s, { html: '', text: '', files: 1, types: ['Files'] })
    expect(s.rejects.map((r) => r.code)).toEqual(['paste-images'])
  })

  it('Cmd+Shift+V pastes plain text: every line a paragraph', () => {
    const s = open('\n')
    select(s.editor, posIn(s.editor, 0, 0))
    expect(s.editor.commands.pastePlain('one two\n  three')).toBe(true)
    expect(s.session.text).toBe('one two\n\nthree\n')
    synced(s)
  })

  it('keeps bold and the link from a copy in the editor', () => {
    const s = open('a *b* https://example.com[site] c\n\n\n')
    const html = '<p data-pm-slice="1 1 []"><strong>b</strong> <a href="https://example.com">site</a></p>'
    select(s.editor, posIn(s.editor, 2, 0))
    paste(s, { html, text: 'b site' })
    expect(s.session.text).toContain('*b* https://example.com[site]')
    synced(s)
  })
})

describe('a paste does not make a character of the text the byte order mark of the file', () => {
  it('plain text that starts with the mark, pasted at the start of the file', () => {
    const s = open('abc\n')
    select(s.editor, posIn(s.editor, 0, 0))
    paste(s, { text: '\ufeffz' })
    expect(s.session.text).toBe('abc\n')
    expect(s.rejects.at(-1)?.code).toBe('byte-order-mark')
    synced(s)
  })

  it('HTML that takes away the character before a mark, pasted over it', () => {
    const s = open('x\ufeffy\n')
    select(s.editor, posIn(s.editor, 0, 0), posIn(s.editor, 0, 1))
    paste(s, { html: '<p>\ufeff</p>', text: '\ufeff' })
    expect(s.session.text).toBe('x\ufeffy\n')
    expect(s.rejects.at(-1)?.code).toBe('byte-order-mark')
    synced(s)
  })

  it('a refused paste leaves the cursor inside the selection it had', () => {
    const s = open('x\ufeffy\n')
    select(s.editor, posIn(s.editor, 0, 0), posIn(s.editor, 0, 1))
    const { from, to } = s.editor.view.state.selection
    paste(s, { html: '<p>\ufeff</p>', text: '\ufeff' })
    expect(s.session.text).toBe('x\ufeffy\n')
    const sel = s.editor.view.state.selection
    // a refusal changes neither the selection nor the state
    expect(sel.from).toBe(from)
    expect(sel.to).toBe(to)
    synced(s)
  })

  it('a refused paste that also held pictures reports only the refusal', () => {
    const s = open('x﻿y\n')
    select(s.editor, posIn(s.editor, 0, 0), posIn(s.editor, 0, 1))
    paste(s, { html: '<p>﻿<img src="a.png"></p>', text: '﻿' })
    expect(s.session.text).toBe('x﻿y\n')
    // the refusal is the only report, paste-images does not follow it
    expect(s.rejects.map((r) => r.code)).toEqual(['byte-order-mark'])
  })
  it('the path HTML -> write: a list and a picture over "x" before a mark', () => {
    const s = open('x﻿y\n')
    select(s.editor, posIn(s.editor, 0, 0), posIn(s.editor, 0, 1))
    paste(s, { html: '<ul><li>z</li></ul><img src="a.png">', text: 'z' })
    expect(s.session.text).toBe('x﻿y\n')
    // (a refusal of either kind, and nothing after it)
    expect(s.rejects).toHaveLength(1)
    expect(s.rejects[0]!.code).not.toBe('paste-images')
    synced(s)
  })

  it('plain text with files that the write refuses reports only the refusal', () => {
    const s = open('x﻿y\n')
    select(s.editor, posIn(s.editor, 0, 0), posIn(s.editor, 0, 1))
    paste(s, { text: '﻿', files: 1, types: ['text/plain', 'Files'] })
    expect(s.session.text).toBe('x﻿y\n')
    expect(s.rejects.map((r) => r.code)).toEqual(['byte-order-mark'])
  })

  it('the early path (a heading) that is refused does not add paste-images', () => {
    // (the mark can start only the first block, which is no heading: the write is made to refuse by a stand-in)
    const s = open('= xy\n')
    const e = s.editor as unknown as { write: (...a: unknown[]) => boolean; failByteOrderMark: (op: null) => false }
    e.write = () => e.failByteOrderMark(null)
    select(s.editor, posIn(s.editor, 0, 0), posIn(s.editor, 0, 1))
    paste(s, { html: '<p>q<img src="a.png"></p>', text: 'q' })
    expect(s.session.text).toBe('= xy\n')
    expect(s.rejects.map((r) => r.code)).toEqual(['byte-order-mark'])
  })

  it('a paste that is not refused still reports the pictures', () => {
    const s = open('x﻿y\n')
    select(s.editor, posIn(s.editor, 0, 1))
    paste(s, { text: 'q', files: 1, types: ['text/plain', 'Files'] })
    expect(s.rejects.map((r) => r.code)).toEqual(['paste-images'])
  })
})
