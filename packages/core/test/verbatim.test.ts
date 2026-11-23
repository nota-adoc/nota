import { describe, expect, it } from 'vitest'
import { type Operation, applyOperation, parse } from '@nota-adoc/core'
import { codeText, layoutItems, readLayout } from '@nota-adoc/core/internal'
import { CODES } from '../../../quality/fuzz/operations.js'

/** The text after an operation, or `error:<code>`. */
function run(text: string, op: Operation): string {
  const r = applyOperation(parse(text), op)
  if ('error' in r) return `error:${r.error}`
  return r.doc.text
}

const kinds = (text: string): string =>
  layoutItems(readLayout(parse(text)))
    .map((it) => it.kind)
    .join(' ')

const at = (text: string, needle: string, shift = 0): number => text.indexOf(needle) + shift

describe('layout of code, images and islands', () => {
  it('reads a listing as code, with its language and body', () => {
    const t = '.Title\n[[id]]\n[source,js,linenums]\n----\nconst a = 1\n----\n'
    const it = layoutItems(readLayout(parse(t)))[0]!
    expect(it.kind).toBe('code')
    expect(it.block!.lang).toBe('js')
    expect(codeText(parse(t), it.block!)).toBe('const a = 1')
    expect(kinds('----\nx\n----\n')).toBe('code')
    expect(layoutItems(readLayout(parse('----\nx\n----\n')))[0]!.block!.lang).toBe('')
    expect(kinds('[source]\n----\nx\n----\n')).toBe('code')
    expect(kinds('----\n----\n')).toBe('code')
  })

  it('leaves other listings, and a listing that does not end, as islands', () => {
    expect(kinds('....\nx\n....\n')).toBe('chip')
    expect(kinds('[source]\n....\nx\n....\n')).toBe('chip')
    expect(kinds('[plantuml]\n----\nx\n----\n')).toBe('chip')
    expect(kinds('----\nx\n')).toBe('chip')
    expect(kinds('----\ninclude::x.adoc[]\n----\n')).toBe('chip')
  })

  it('reads a block image with its caption, and shows code and images inside boxes', () => {
    const t = '.Схема\nimage::img/a.png[Alt]\n'
    const it = layoutItems(readLayout(parse(t)))[0]!
    expect(it.kind).toBe('image')
    expect(it.block!.target).toBe('img/a.png')
    expect(t.slice(it.block!.content!.from, it.block!.content!.to)).toBe('Схема')
    expect(kinds('image::a.png[]\n')).toBe('image')
    expect(kinds('[NOTE]\n====\n----\nx\n----\n\nimage::a.png[]\n====\n')).toBe('fence code image fence')
  })

  it('shows every block that the editor does not read as one island', () => {
    expect(kinds('include::part.adoc[]\n\nterm:: def\n')).toBe('chip chip')
    expect(kinds('= T\n:a: b\n\ntext\n')).toBe('heading chip paragraph')
  })
})

describe('setCodeText', () => {
  const doc = '[source,js]\n----\nconst a = 1\n----\n\ntext\n'
  it('changes only the lines of the code', () => {
    expect(run(doc, { kind: 'setCodeText', at: at(doc, 'const'), text: 'const a = 1\nconst b' })).toBe(
      '[source,js]\n----\nconst a = 1\nconst b\n----\n\ntext\n',
    )
    expect(run('----\n----\n', { kind: 'setCodeText', at: 0, text: 'x' })).toBe('----\nx\n----\n')
    expect(run(doc, { kind: 'setCodeText', at: at(doc, 'const'), text: '' })).toBe('[source,js]\n----\n----\n\ntext\n')
  })

  it('makes the delimiters longer when a line of the text is as long as they are', () => {
    expect(run(doc, { kind: 'setCodeText', at: at(doc, 'const'), text: 'a\n----' })).toBe(
      '[source,js]\n-----\na\n----\n-----\n\ntext\n',
    )
    expect(run('-----\n----\n-----\n', { kind: 'setCodeText', at: 0, text: '----\n-----' })).toBe(
      '------\n----\n-----\n------\n',
    )
  })

  it('does not change a file when the text is the same', () => {
    expect(run(doc, { kind: 'setCodeText', at: at(doc, 'const'), text: 'const a = 1' })).toBe(doc)
  })

  it('keeps the line breaks of the file', () => {
    const crlf = '----\r\nx\r\n----\r\n'
    expect(run(crlf, { kind: 'setCodeText', at: 0, text: 'x\ny' })).toBe('----\r\nx\r\ny\r\n----\r\n')
  })

  it('refuses a text that is not code any more', () => {
    expect(run(doc, { kind: 'setCodeText', at: at(doc, 'const'), text: 'include::a.adoc[]' })).toMatch(/^error:/)
  })
})

describe('setCodeLanguage', () => {
  it('changes the word and keeps the rest of the line', () => {
    expect(run('[source,js,linenums]\n----\nx\n----\n', { kind: 'setCodeLanguage', at: 0, language: 'python' })).toBe(
      '[source,python,linenums]\n----\nx\n----\n',
    )
    expect(run('[source]\n----\nx\n----\n', { kind: 'setCodeLanguage', at: 0, language: 'python' })).toBe(
      '[source,python]\n----\nx\n----\n',
    )
  })

  it('adds the line right over the delimiter, under the title and the anchor', () => {
    expect(run('.T\n[[a]]\n----\nx\n----\n', { kind: 'setCodeLanguage', at: 0, language: 'python' })).toBe(
      '.T\n[[a]]\n[source,python]\n----\nx\n----\n',
    )
  })

  it('refuses what is not a word', () => {
    expect(run('----\nx\n----\n', { kind: 'setCodeLanguage', at: 0, language: 'a b' })).toMatch(/^error:/)
  })
})

describe('setCaption', () => {
  it('sets, changes and takes away the title line', () => {
    expect(run('image::a.png[]\n', { kind: 'setCaption', at: 0, text: 'Схема потоков' })).toBe(
      '.Схема потоков\nimage::a.png[]\n',
    )
    expect(run('[#x]\nimage::a.png[]\n', { kind: 'setCaption', at: 0, text: 'T' })).toBe('[#x]\n.T\nimage::a.png[]\n')
    expect(run('.Old\nimage::a.png[]\n', { kind: 'setCaption', at: 0, text: 'Older' })).toBe('.Older\nimage::a.png[]\n')
    expect(run('.Old\nimage::a.png[]\n', { kind: 'setCaption', at: 0, text: '' })).toBe('image::a.png[]\n')
  })

  it('keeps a blank at the end of what is typed', () => {
    expect(run('.Схема\nimage::a.png[]\n', { kind: 'setCaption', at: 0, text: 'Схема ' })).toBe('.Схема \nimage::a.png[]\n')
  })

  it('makes one line of the text', () => {
    expect(run('image::a.png[]\n', { kind: 'setCaption', at: 0, text: 'a\nb' })).toBe('.a b\nimage::a.png[]\n')
  })
})

describe('setIslandText', () => {
  const doc = 'text\n\ninclude::part.adoc[]\n\nmore\n'
  it('changes the lines of the island', () => {
    expect(run(doc, { kind: 'setIslandText', at: at(doc, 'include'), text: 'include::part.adocx[]' })).toBe(
      'text\n\ninclude::part.adocx[]\n\nmore\n',
    )
    expect(run(doc, { kind: 'setIslandText', at: at(doc, 'include'), text: 'include::part.adoc[]\nterm:: x' })).toBe(
      'text\n\ninclude::part.adoc[]\nterm:: x\n\nmore\n',
    )
  })

  it('may read as a paragraph after the edit', () => {
    expect(run(doc, { kind: 'setIslandText', at: at(doc, 'include'), text: 'nclude::part.adoc[]' })).toBe(
      'text\n\nnclude::part.adoc[]\n\nmore\n',
    )
  })

  it('refuses a text that changes the blocks around', () => {
    expect(run(doc, { kind: 'setIslandText', at: at(doc, 'include'), text: 'include::part.adoc[]\n----' })).toBe(
      'error:collateral',
    )
  })

  it('says why it refuses: the messages of the two refusals', () => {
    const message = (op: Operation): string | undefined => {
      const r = applyOperation(parse(doc), op)
      return 'error' in r ? r.diagnostics[0]?.message : undefined
    }
    expect(message({ kind: 'setIslandText', at: at(doc, 'include'), text: 'include::part.adoc[]\n----' })).toBe(
      'That text changes the blocks around it',
    )
    expect(message({ kind: 'setIslandText', at: 0, to: doc.length + 5, text: 'x' })).toBe(
      'The island is outside the text',
    )
  })

  it('edits two touching islands as one', () => {
    const two = 'include::a.adoc[]\ninclude::b.adoc[]\n'
    expect(kinds(two)).toBe('chip')
    expect(run(two, { kind: 'setIslandText', at: 0, text: 'include::a.adoc[]\ninclude::c.adoc[]' })).toBe(
      'include::a.adoc[]\ninclude::c.adoc[]\n',
    )
  })

  it('edits the entries of the header', () => {
    const t = '= T\n:imagesdir: img\n\ntext\n'
    expect(run(t, { kind: 'setIslandText', at: at(t, ':images'), text: ':imagesdir: pics' })).toBe(
      '= T\n:imagesdir: pics\n\ntext\n',
    )
  })
})

describe('placeBlock', () => {
  it('puts a block after the block that holds the position, through blank lines', () => {
    expect(run('text\n', { kind: 'placeBlock', at: 1, block: { kind: 'image', target: 'img/a.png' } })).toBe(
      'text\n\nimage::img/a.png[]\n\n\n',
    )
    expect(run('a\n\nb\n', { kind: 'placeBlock', at: 0, block: { kind: 'image', target: 'x.png' } })).toBe(
      'a\n\nimage::x.png[]\n\nb\n',
    )
  })

  it('writes an empty code block with the language text', () => {
    expect(
      run('a\n\nb\n', { kind: 'placeBlock', at: 0, block: { kind: 'listing', text: '', language: 'text' } }),
    ).toBe('a\n\n[source,text]\n----\n----\n\nb\n')
  })

  it('puts the block in the place of a paragraph, and an empty paragraph follows a block that is not text', () => {
    expect(
      run('a\n\n/код\n', {
        kind: 'placeBlock',
        at: at('a\n\n/код\n', '/код'),
        replace: true,
        block: { kind: 'listing', text: '', language: 'text' },
      }),
    ).toBe('a\n\n[source,text]\n----\n----\n\n\n')
  })

  it('replaces an empty paragraph', () => {
    const t = 'a\n\n\nb\n'
    const r = run(t, { kind: 'placeBlock', at: 3, block: { kind: 'image', target: 'x.png' } })
    expect(r).toBe('a\n\nimage::x.png[]\n\nb\n')
  })

  it('writes a collapsible block', () => {
    expect(
      run('a\n', { kind: 'placeBlock', at: 0, block: { kind: 'collapsible', title: 'Подробнее', text: 'x' } }),
    ).toBe('a\n\n.Подробнее\n[%collapsible%open]\n====\nx\n====\n\n\n')
  })
})

describe('appendEmpty', () => {
  it('adds an empty paragraph after a block that has none', () => {
    const t = '----\nx\n----\n'
    const r = applyOperation(parse(t), { kind: 'appendEmpty', at: 0 })
    expect('error' in r).toBe(false)
    if (!('error' in r)) expect(kinds(r.doc.text)).toBe('code empty')
  })

  it('after a list: an empty paragraph goes after the whole list, past the blank lines inside it', () => {
    expect(run('* a\n\n* b\n\nc\n', { kind: 'appendEmpty', at: 0 })).toBe('* a\n\n* b\n\n\nc\n')
  })

  it('after a box: an empty paragraph goes after the closing line, not inside', () => {
    const t = '====\ntext\n====\n\nc\n'
    const r = run(t, { kind: 'appendEmpty', at: 0 })
    expect(r).toBe('====\ntext\n====\n\n\nc\n')
  })

  it('does nothing when an empty paragraph follows the block already', () => {
    const t = '* a\n\n* b\n\n\nc\n'
    const r = applyOperation(parse(t), { kind: 'appendEmpty', at: 0 })
    if ('error' in r) throw new Error(r.error)
    expect(r.doc.text).toBe(t)
    expect(r.changes).toEqual([])
  })
})

describe('startBlock with a warning', () => {
  it('writes NOTE: with the first letter', () => {
    expect(run('a\n\n\n', { kind: 'startBlock', at: 3, prefix: 'NOTE: ', text: 'x' })).toBe('a\n\nNOTE: x\n')
  })
})

describe('placeBlock: a list next to a list', () => {
  const lists = (t: string) => (parse(t).asg().blocks ?? []).filter((b) => b.name === 'list')
  const bare = (l: unknown) => JSON.parse(JSON.stringify(l, (k, x) => (k === 'location' || k === 'range' ? undefined : x)))
  const itemsOf = (l: unknown) => ((l as { items?: unknown[] }).items ?? [])

  it('over the empty line above a list: two lists, the old one as it was', () => {
    const r = applyOperation(parse('\n* alpha\nalpha\n'), {
      kind: 'placeBlock',
      at: 0,
      block: { kind: 'list', list: 'unordered', items: ['x'] },
    })
    if ('error' in r) throw new Error(r.error)
    const ls = lists(r.doc.text)
    expect(ls.length).toBe(2)
    expect(itemsOf(ls[0]!).length).toBe(1)
    expect(itemsOf(ls[1]!).length).toBe(1)
    expect(JSON.stringify(ls[0])).toContain('x')
    // the old list is as it was, the lazy line included
    expect(bare(ls[1])).toEqual(bare(lists('\n* alpha\nalpha\n')[0]))
    expect(r.doc.text).toContain('\n//\n')
  })

  it('after a list (replace: false): two lists with a comment line between', () => {
    const r = applyOperation(parse('* a\n'), {
      kind: 'placeBlock',
      at: 0,
      replace: false,
      block: { kind: 'list', list: 'unordered', items: ['x'] },
    })
    if ('error' in r) throw new Error(r.error)
    const ls = lists(r.doc.text)
    expect(ls.length).toBe(2)
    expect(JSON.stringify(ls[0])).toContain('"a"')
    expect(JSON.stringify(ls[1])).toContain('"x"')
    expect(r.doc.text).toContain('\n//\n')
  })

  it('a CRLF document keeps CRLF around the comment line', () => {
    const r = applyOperation(parse('\r\n* a\r\n'), {
      kind: 'placeBlock',
      at: 0,
      block: { kind: 'list', list: 'unordered', items: ['x'] },
    })
    if ('error' in r) return
    expect(r.doc.text).not.toContain('\r\r')
    expect(r.doc.text.replace(/\r\n/g, '')).not.toContain('\r')
    expect(r.doc.text).toContain('//\r\n')
  })
})

describe('placeBlock: the blocks around it', () => {
  it('a block that ends with a line of the next block (a title, an anchor, a role) is refused or leaves the paragraph after it as it was', () => {
    const t = 'alpha\n\nbeta\n'
    for (const source of ['.Title', '[#id.role]', '[[anchor-id]]', '[discrete]', '----\nx\n----\n.Title', '----\nx\n----\n[#id.role]', '* a\n.Title', '* a\n[#id.role]'])
      for (const replace of [true, false])
        for (const pos of [0, 7]) {
          const r = applyOperation(parse(t), { kind: 'placeBlock', at: pos, block: { source }, replace })
          if ('error' in r) {
            expect(CODES.has(r.error), `${JSON.stringify(source)}: ${r.error}`).toBe(true)
            continue
          }
          if (pos === 7 && replace) continue // (beta is the paragraph that is replaced)
          // beta reads as it did: the same text, no title or metadata of the lines that were written
          const beta = (r.doc.asg().blocks ?? []).find((b) => JSON.stringify(b.inlines ?? []).includes('beta'))
          const was = (parse(t).asg().blocks ?? []).find((b) => JSON.stringify(b.inlines ?? []).includes('beta'))
          expect(beta, JSON.stringify(source)).toBeDefined()
          expect(JSON.stringify({ m: beta!.metadata, t: beta!.title })).toBe(JSON.stringify({ m: was!.metadata, t: was!.title }))
        }
  })

  it('an entry that does not change the reading is written, and the paragraphs after it read as they did', () => {
    const t = 'alpha\n\nbeta\n'
    const r = applyOperation(parse(t), { kind: 'placeBlock', at: 0, block: { source: ':toc:\n\nalpha2' }, replace: true })
    expect('error' in r).toBe(false)
    if (!('error' in r)) {
      expect(r.doc.text).toBe(':toc:\n\nalpha2\n\nbeta\n')
      const beta = (r.doc.asg().blocks ?? []).find((b) => JSON.stringify(b).includes('beta'))
      expect(beta?.name).toBe('paragraph')
    }
  })

  it('a block does not go between the lines of the header, which are the author and the revision', () => {
    const t = '= T\nJohn Doe\nv1.0\n:toc:\n\nbody\n'
    const r = applyOperation(parse(t), { kind: 'placeBlock', at: 0, block: { kind: 'paragraph', text: 'x' }, replace: false })
    expect('error' in r && CODES.has(r.error)).toBe(true)
  })

  it('the refusal inside the header says so in its message', () => {
    const t = '= T\nJohn Doe\nv1.0\n:toc:\n\nbody\n'
    const r = applyOperation(parse(t), { kind: 'placeBlock', at: 0, block: { kind: 'paragraph', text: 'x' }, replace: false })
    expect('error' in r && r.diagnostics[0]!.message).toBe('A block cannot be placed inside the header of the document')
  })

  it('a block that becomes a plate is refused with becomes-plate', () => {
    const r = applyOperation(parse(':leveloffset: +1\n'), { kind: 'placeBlock', at: 0, block: { kind: 'section', level: 6, title: 'x' }, replace: true })
    expect('error' in r && r.error).toBe('becomes-plate')
  })
})
