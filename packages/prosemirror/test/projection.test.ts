// the projection.
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createSession, parse } from '@nota-adoc/core'
import { createVisualEditor, projectDocument } from '@nota-adoc/prosemirror'
import { readSource } from '../../../quality/lib/read-source.js'
import { closeAll, open, shape } from './helpers.js'

afterEach(closeAll)

const fixtures = join(import.meta.dirname, '../../../quality/fixtures')

function* files(dir: string): Generator<string> {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) yield* files(p)
    else if (p.endsWith('.adoc')) yield p
  }
}

const dom = (html: string): Element => {
  const d = document.createElement('div')
  d.innerHTML = html
  return d
}

describe('projection', () => {
  it('does not give a link a target that runs code: no href on the anchor, the mark keeps the target', () => {
    const { editor, el } = open(
      'a link:javascript:alert(1)[x] b link:page.html[y] c link:DATA:text/html,x[z]\n',
    )
    const anchors = [...el.querySelectorAll('a')]
    expect(anchors.map((a) => a.textContent)).toEqual(['x', 'y', 'z'])
    expect(anchors.map((a) => a.getAttribute('href'))).toEqual([null, 'page.html', null])
    expect(editor.view.state.doc.eq(projectDocument(editor.session.doc))).toBe(true)
  })

  it('shows headings, paragraphs and marks as h1…h6, p, strong, em, code, s, mark and a', () => {
    const text = [
      '= Title',
      '',
      'A *b* **B** _i_ __I__ `c` [.line-through]#s# #h# https://x.y and https://x.y[text] <https://x.y> link:page.html[l] mailto:a@b.c[m] <<id>> <<id,r>> xref:d.adoc#i[x]',
      '',
      '== Two',
      '',
      '=== Three',
      '',
      '==== Four',
      '',
      '===== Five',
      '',
      '====== Six',
      '',
      '## Md',
      '',
    ].join('\n')
    const { editor } = open(text)
    const html = editor.view.dom as HTMLElement
    const tags = (sel: string): string[] => [...html.querySelectorAll(sel)].map((e) => e.textContent ?? '')
    expect(tags('h1')).toEqual(['Title'])
    expect(tags('h2')).toEqual(['Two', 'Md'])
    expect(tags('h3')).toEqual(['Three'])
    expect(tags('h4')).toEqual(['Four'])
    expect(tags('h5')).toEqual(['Five'])
    expect(tags('h6')).toEqual(['Six'])
    expect(tags('p').length).toBe(1)
    expect(tags('strong')).toEqual(['b', 'B'])
    expect(tags('em')).toEqual(['i', 'I'])
    expect(tags('code')).toEqual(['c'])
    expect(tags('s')).toEqual(['s'])
    expect(tags('mark')).toEqual(['h'])
    expect([...html.querySelectorAll('a')].map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
      ['https://x.y', 'https://x.y'],
      ['text', 'https://x.y'],
      ['https://x.y', 'https://x.y'],
      ['l', 'page.html'],
      ['m', 'mailto:a@b.c'],
      ['id', '#id'],
      ['r', '#id'],
      ['x', 'd.adoc#i'],
    ])
    // no markers on the screen
    expect(html.textContent).not.toContain('*')
    expect(html.textContent).not.toContain('<<')
  })

  it('shows lines of a paragraph with a space and a hard break as a line break', () => {
    const { editor } = open('one\ntwo +\nthree')
    expect(shape(editor)).toBe('one two↵three')
    expect((editor.view.dom as HTMLElement).querySelectorAll('br').length).toBeGreaterThanOrEqual(1)
  })

  it('shows everything else as plates with the source', () => {
    const text =
      'term:: one\n\n----\ncode\n----\n\n|===\n|a|b\n|===\n\n:name: value\n\n// comment\n\n[NOTE]\ncareful\n\n image:a.png[]\n\nimage::b.png[]\n\nSome {name} footnote:[x] and image:c.png[] here.\n'
    const { editor } = open(text)
    const chips = [...(editor.view.dom as HTMLElement).querySelectorAll('.nota-island .island-src')].map(
      (e) => e.textContent,
    )
    expect(chips[0]).toBe('term:: one')
    expect(chips[1]).toBe(':name: value')
    // (a table is a grid, not a plate)
    expect((editor.view.dom as HTMLElement).querySelectorAll('table td').length).toBe(2)
    expect((editor.view.dom as HTMLElement).querySelector('.nota-code .code-src')!.textContent).toBe('code')
    expect((editor.view.dom as HTMLElement).querySelector('.nota-image')!.getAttribute('data-target')).toBe('b.png')
    expect(chips.join('')).toContain('[NOTE]\ncareful')
    const inline = [...(editor.view.dom as HTMLElement).querySelectorAll('.nota-inline-chip')].map(
      (e) => e.textContent,
    )
    expect(inline).toEqual(['{name}', 'footnote:[x]', 'image:c.png[]'])
  })

  it('shows the lines above a paragraph as grey service text over it, and the paragraph stays editable', () => {
    const { editor } = open('[[intro]]\n.Title\n[role]\nText here\n')
    const p = (editor.view.dom as HTMLElement).querySelector('p')!
    // the anchor is not shown as text, the other lines are
    expect(p.getAttribute('data-meta')).toBe('.Title\n[role]\n')
    expect(p.textContent).toBe('Text here')
    expect(editor.view.state.doc.child(0).attrs.meta).toBe('[[intro]]\n.Title\n[role]\n')
    expect((editor.view.dom as HTMLElement).querySelector('.nota-anchor')!.getAttribute('data-id')).toBe('intro')
  })

  it('the anchor over the document title (`= Title`) is the anchor of the heading, not an island', () => {
    const src = '[[top]]\n= Заголовок\n\nАбзац.\n'
    const { editor } = open(src)
    const doc = editor.view.state.doc
    expect(doc.childCount).toBe(2)
    expect(doc.child(0).type.name).toBe('heading')
    expect(doc.child(0).attrs.level).toBe(1)
    expect(doc.child(0).attrs.anchor).toBe('top')
    expect((editor.view.dom as HTMLElement).querySelectorAll('.nota-island').length).toBe(0)
    expect((editor.view.dom as HTMLElement).querySelector('.nota-anchor')!.getAttribute('data-id')).toBe('top')
  })

  it('only the lines with nothing but an id are anchors', () => {
    const src = '[[a]]\n[[b, Подпись]]\n[#c]\n[id=d]\nText\n\n[#e.role]\nT2\n\n[[f]]\n.Cap\nNOTE: x\n\n[[g]]\n=== H\n\n[%hardbreaks]\nT3\n'
    const { editor } = open(src)
    const dom = editor.view.dom as HTMLElement
    const metas = [...dom.querySelectorAll('[data-meta]')].map((e) => e.getAttribute('data-meta'))
    expect(metas).toEqual(['[#e.role]\n', '.Cap\n', '[%hardbreaks]\n'])
    expect([...dom.querySelectorAll('.nota-anchor')].map((e) => e.getAttribute('data-id'))).toEqual(['a b c d', 'f', 'g'])
    expect(dom.querySelector('.nota-anchor')!.textContent).toBe('')
    expect(editor.view.state.doc.child(0).attrs.meta).toBe('[[a]]\n[[b, Подпись]]\n[#c]\n[id=d]\n')
  })

  it('shows blank lines beyond the first between blocks, and at the end, as empty paragraphs', () => {
    expect(shape(open('a\n\n\nb\n').editor)).toBe('a||b')
    closeAll()
    expect(shape(open('a\n\n\n\nb').editor)).toBe('a|||b')
    closeAll()
    expect(shape(open('a\n\n\n').editor)).toBe('a|')
    closeAll()
    expect(shape(open('').editor)).toBe('')
    closeAll()
    expect(shape(open('\n\na').editor)).toBe('||a')
  })

  const all = [...files(fixtures)]
  it('has fixtures', () => expect(all.length).toBeGreaterThan(90))
  for (const file of all) {
    it(`opens ${file.slice(fixtures.length + 1)} and shows exactly the projection from nothing`, () => {
      const text = readSource(file)
      const session = createSession(text)
      const el = document.createElement('div')
      document.body.append(el)
      const editor = createVisualEditor(el, { session })
      expect(editor.view.state.doc.eq(projectDocument(session.doc))).toBe(true)
      expect(session.text).toBe(text)
      // the plates hold the source, byte for byte
      editor.view.state.doc.forEach((n) => {
        if (['island', 'code_block', 'image'].includes(n.type.name)) expect(text).toContain(n.textContent.split('\n')[0]!)
      })
      editor.destroy()
      expect(parse(text).text).toBe(text)
    })
  }
})
void dom

describe('blanks after ` +`', () => {
  // Asciidoctor strips the blanks at the end of a line: ` + ` reads as ` +`, a break with nothing after it
  const same = (blank: string, plain: string, shown: string): void => {
    const withBlank = createSession(blank)
    const bare = createSession(plain)
    expect(projectDocument(withBlank.doc).eq(projectDocument(bare.doc))).toBe(true)
    const { editor } = open(blank)
    expect(shape(editor)).toBe(shown)
  }

  it('a paragraph reads as it does without the blank: a hard break and no blank after it', () => {
    same('aa + \n\nnext\n', 'aa +\n\nnext\n', 'aa↵|next')
    same('aa +\t\n\nnext\n', 'aa +\n\nnext\n', 'aa↵|next')
    same('aa +  \t \nbb\n', 'aa +\nbb\n', 'aa↵bb')
  })

  it('a heading reads as it does without the blank', () => {
    same('== Le + \n\nnext\n', '== Le +\n\nnext\n', 'h2:Le↵|next')
    same('== Le +\t\n\nnext\n', '== Le +\n\nnext\n', 'h2:Le↵|next')
  })
})
