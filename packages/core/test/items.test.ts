import { describe, expect, it } from 'vitest'
import { type Operation, applyOperation, parse } from '@nota-adoc/core'
import { blockEnd, layoutItems, readLayout } from '@nota-adoc/core/internal'

/** The text after an operation, or `error:<code>`. */
function run(text: string, op: Operation): string {
  const r = applyOperation(parse(text), op)
  if ('error' in r) return `error:${r.error}`
  return r.doc.text
}

const kinds = (text: string): string =>
  layoutItems(readLayout(parse(text)))
    .map((it) => (it.kind === 'item' ? `i${it.block!.level}` : it.kind === 'fence' ? `f:${it.block!.fence}:${it.block!.box}` : it.kind))
    .join(' ')

const at = (text: string, needle: string, shift = 0): number => text.indexOf(needle) + shift

describe('layout of lists, admonitions and boxes', () => {
  it('shows the items of a list one by one, with their depth', () => {
    expect(kinds('* a\n** b\n* c\n')).toBe('i1 i2 i1')
    expect(kinds('. a\n. b\n')).toBe('i1 i1')
    const b = layoutItems(readLayout(parse('* [x] two\ncontinued\n')))[0]!.block!
    expect(b.checked).toBe('x')
    expect(b.marker).toBe('*')
  })

  it('leaves lists with blocks, titles and definitions as plates', () => {
    expect(kinds('* a\n+\nmore\n')).toBe('chip')
    expect(kinds('term:: def\n')).toBe('chip')
    expect(kinds('.Title\n* a\n')).toBe('chip')
  })

  it('reads NOTE: paragraphs as paragraphs with a type', () => {
    const b = layoutItems(readLayout(parse('WARNING: careful\n')))[0]!.block!
    expect(b.kind).toBe('paragraph')
    expect(b.variant).toBe('WARNING')
    expect(b.content!.from).toBe('WARNING: '.length)
  })

  it('reads boxes as fences around their blocks', () => {
    const text = '.More\n[%collapsible]\n====\nInner.\n\n* x\n====\n'
    expect(kinds(text)).toBe('f:open:collapsible paragraph i1 f:close:collapsible')
  })
})

describe('Enter, Backspace and Delete in items', () => {
  it('Enter in the middle splits an item, at the ends it does nothing', () => {
    const t = '* one two\n* three\n'
    expect(run(t, { kind: 'splitBlock', at: at(t, 'two', -1) })).toBe('* one\n* two\n* three\n')
    expect(run(t, { kind: 'splitBlock', at: at(t, '\n* three', 0) })).toBe(t)
    expect(run('* [x] ab\n', { kind: 'splitBlock', at: at('* [x] ab\n', 'b') })).toBe('* [x] a\n* [ ] b\n')
    expect(run('1. ab\n2. c\n3. d\n', { kind: 'splitBlock', at: 4 })).toBe('1. a\n2. b\n3. c\n4. d\n')
    expect(run('1. a\n2. c\n', { kind: 'insertItem', after: 3, level: 1, text: 'x' })).toBe('1. a\n2. x\n3. c\n')
    expect(run('** ab\n', { kind: 'splitBlock', at: at('** ab\n', 'b') })).toBe('** a\n** b\n')
    expect(run('1. ab\n', { kind: 'splitBlock', at: at('1. ab\n', 'b') })).toBe('1. a\n2. b\n')
  })

  it('Backspace at the start of an item joins it to the item before; the first item becomes a paragraph', () => {
    const t = '* a\n* b\n'
    expect(run(t, { kind: 'joinBlocks', at: at(t, 'b') })).toBe('* a\nb\n')
    const u = 'Intro\n\n* a\n* b\n'
    expect(run(u, { kind: 'joinBlocks', at: at(u, 'a') })).toBe('Intro\n\na\n\n* b\n')
    expect(run('* a\n** b\n* c\n', { kind: 'joinBlocks', at: at('* a\n** b\n* c\n', 'a') })).toBe('error:item-has-items')
    const f = '* a\n* b\n'
    expect(run(f, { kind: 'joinBlocks', at: at(f, 'a', 1), direction: 'forward' })).toBe('* a\nb\n')
    const g = '* a\n** b\n'
    expect(run(g, { kind: 'joinBlocks', at: at(g, 'b'), direction: 'backward' })).toBe('* a\nb\n')
  })

  it('an item is added after an item, on a level that fits', () => {
    const t = '* a\n* b\n'
    expect(run(t, { kind: 'insertItem', after: at(t, 'a'), level: 1, text: 'x' })).toBe('* a\n* x\n* b\n')
    expect(run(t, { kind: 'insertItem', after: at(t, 'a'), level: 2, text: 'x' })).toBe('* a\n** x\n* b\n')
    expect(run(t, { kind: 'insertItem', after: at(t, 'a'), level: 3, text: 'x' })).toMatch(/^error:/)
    const n = '* a\n** b\n'
    expect(run(n, { kind: 'insertItem', after: at(n, 'b'), level: 1, text: 'x' })).toBe('* a\n** b\n* x\n')
    expect(run('* [ ] a\n', { kind: 'insertItem', after: 6, level: 1, text: 'x' })).toBe('* [ ] a\n* [ ] x\n')
    expect(run('1. a\n', { kind: 'insertItem', after: 3, level: 1, text: 'x' })).toBe('1. a\n2. x\n')
    expect(run('* a', { kind: 'insertItem', after: 2, level: 1, text: 'x' })).toBe('* a\n* x\n')
  })

  it('Enter in an empty last item makes an empty paragraph after the list; in the middle it is refused', () => {
    const t = '* a\n* b\n'
    expect(run(t, { kind: 'endList', at: at(t, 'b') })).toBe('* a\n* b\n\n\n')
    expect(run(t, { kind: 'endList', at: at(t, 'a') })).toBe('error:list-middle')
  })

  it('an item is started in an empty paragraph', () => {
    const t = 'a\n\n\nb\n'
    expect(run(t, { kind: 'startBlock', at: 3, prefix: '* ', text: 'x' })).toBe('a\n\n* x\n\nb\n')
    expect(run(t, { kind: 'startBlock', at: 3, prefix: '1. ', text: 'x' })).toBe('a\n\n1. x\n\nb\n')
    expect(run(t, { kind: 'startBlock', at: 3, prefix: '=== ', text: 'x' })).toBe('a\n\n=== x\n\nb\n')
  })
})

describe('checkbox and admonition type', () => {
  it('changes one sign of the checkbox', () => {
    const t = '* [ ] a\n* [*] b\n'
    expect(run(t, { kind: 'setChecked', at: 3, checked: true })).toBe('* [x] a\n* [*] b\n')
    expect(run(t, { kind: 'setChecked', at: at(t, 'b'), checked: false })).toBe('* [ ] a\n* [ ] b\n')
    expect(run('* a\n', { kind: 'setChecked', at: 2, checked: true })).toBe('error:invalid-target')
  })

  it('changes only the word of the type', () => {
    expect(run('NOTE: x\n', { kind: 'setAdmonitionType', at: 8, variant: 'WARNING' })).toBe('WARNING: x\n')
    expect(run('[NOTE]\n====\nx\n====\n', { kind: 'setAdmonitionType', at: 12, variant: 'CAUTION' })).toBe(
      '[CAUTION]\n====\nx\n====\n',
    )
    expect(run('[TIP#id.role]\n====\nx\n====\n', { kind: 'setAdmonitionType', at: 16, variant: 'IMPORTANT' })).toBe(
      '[IMPORTANT#id.role]\n====\nx\n====\n',
    )
    expect(run('x\n', { kind: 'setAdmonitionType', at: 0, variant: 'TIP' })).toBe('error:invalid-target')
  })
})

describe('toggleList over several paragraphs', () => {
  it('makes one list of them', () => {
    const t = 'a\n\nb\n\nc\n'
    expect(run(t, { kind: 'toggleList', at: 0, to: at(t, 'c'), list: 'unordered' })).toBe('* a\n* b\n* c\n')
    expect(run(t, { kind: 'toggleList', at: 3, to: at(t, 'c'), list: 'ordered' })).toBe('a\n\n. b\n. c\n')
  })
})

describe('typing into items keeps them items', () => {
  it('writes the text of an item in place', () => {
    const t = '* abc\n* d\n'
    expect(run(t, { kind: 'insertText', at: 3, text: 'X' })).toBe('* aXbc\n* d\n')
    expect(run(t, { kind: 'deleteRange', from: 3, to: 5 })).toBe('* a\n* d\n')
  })
})

describe('Tab and Shift+Tab on items give the text back, byte for byte, or are refused', () => {
  const there = (text: string, needle: string): number => text.indexOf(needle)
  const roundTrip = (text: string, needle: string): string => {
    const moved = applyOperation(parse(text), { kind: 'indentListItem', at: there(text, needle) })
    if ('error' in moved) return `error:${moved.error}`
    const back = applyOperation(moved.doc, { kind: 'outdentListItem', at: there(moved.doc.text, needle) })
    return 'error' in back ? `error:${back.error}` : back.doc.text
  }

  it('moves one level in and out', () => {
    const t = '* a\n* b\n* c\n'
    expect(run(t, { kind: 'indentListItem', at: there(t, 'b') })).toBe('* a\n** b\n* c\n')
    expect(roundTrip(t, 'b')).toBe(t)
    expect(roundTrip('. a\n. b\n', 'b')).toBe('. a\n. b\n')
  })

  it('refuses the first item and an item of the first level, with the codes of the panel', () => {
    expect(run('* a\n* b\n', { kind: 'indentListItem', at: 2 })).toBe('error:first-item')
    expect(run('* a\n* b\n', { kind: 'outdentListItem', at: 2 })).toBe('error:top-level-item')
  })

  it('keeps a list of the other kind inside the item as it is written', () => {
    const t = '* a\n* b\n.. c\n.. d\n'
    expect(roundTrip(t, 'b')).toBe(t)
  })

  it('does not move an item when the markers of the others would not come back', () => {
    const t = '***** a\n****** b\n****** c\n**** d\n'
    for (const needle of ['b', 'c', 'd']) {
      const r = roundTrip(t, needle)
      expect(r === t || r.startsWith('error:')).toBe(true)
    }
  })
})

describe('blockEnd with toc::[] in a box', () => {
  it('ends the box at its closing fence, not at toc::[] inside it', () => {
    const items = layoutItems(readLayout(parse('[NOTE]\n====\ntoc::[]\n====\n\nafter\n')))
    const open = items.findIndex((it) => it.block?.fence === 'open')
    const close = items.findIndex((it) => it.block?.fence === 'close')
    expect(open).toBeGreaterThanOrEqual(0)
    expect(blockEnd(items, open)).toBe(close)
  })
})

describe('a blank line in a list does not make it a plate', () => {
  const K1 =
    '**Важно**\n\nРоли бывают двух видов:\n\n* Внешние - для систем снаружи\n* Внутренние - для систем внутри\n**Как заводить:**\n\n' +
    '* **внешнюю** : через заявку\n* **внутреннюю** : миграцией\n** **логин** с префиксом **app_**\n** **пароль** пустой\n\n' +
    '[%header,cols="2"]\n|===\n| Имя\n| Вид\n|===\n'
  const nums = (t: string): string[] =>
    layoutItems(readLayout(parse(t))).map((it) => (it.kind === 'item' ? it.block!.marker : it.kind))

  it('a blank line between items and a bold second line', () => {
    expect(kinds(K1)).toBe('paragraph paragraph i1 i1 i1 i1 i2 i2 table')
    const items = layoutItems(readLayout(parse(K1))).filter((i) => i.kind === 'item')
    const b = items[1]!.block!
    expect(K1.slice(b.content!.from, b.content!.to)).toBe('Внутренние - для систем внутри\n**Как заводить:**')
  })

  it('a numbered list goes on after a blank line', () => {
    expect(kinds('. a\n\n. b\n. c\n')).toBe('i1 i1 i1')
    expect(nums('. a\n\n. b\n. c\n')).toEqual(['.', '.', '.'])
  })

  it('a blank line in an item before a nested list', () => {
    expect(kinds('1. a\n\n* x\n* y\n2. b\n')).toBe('i1 i2 i2 i1')
  })

  it('typing next to the blank line', () => {
    expect(run('* a\n\n* b\n', { kind: 'insertText', at: 8, text: 'c' })).toBe('* a\n\n* bc\n')
    expect(run('* a\n\n* b\n', { kind: 'insertText', at: 3, text: 'c' })).toBe('* ac\n\n* b\n')
  })

  it('Enter next to the blank line', () => {
    const t = '* a\n\n* b\n'
    expect(run(t, { kind: 'insertItem', after: 3, level: 1, text: 'x' })).toBe('* a\n* x\n\n* b\n')
    expect(run(t, { kind: 'insertItem', after: 8, level: 1, text: 'x' })).toBe('* a\n\n* b\n* x\n')
    expect(run('* ab\n\n* c\n', { kind: 'splitBlock', at: 3 })).toBe('* a\n* b\n\n* c\n')
  })

  it('Backspace at the start of an item after the blank line', () => {
    expect(run('* a\n\n* b\n', { kind: 'joinBlocks', at: 7 })).toBe('* a\nb\n')
  })

  it('the rest stays a plate', () => {
    expect(kinds('* a\n+\nmore\n')).toBe('chip')
    expect(kinds('* a\n\n+\nmore\n')).toBe('chip')
    expect(kinds('.Title\n* a\n')).toBe('chip')
    expect(kinds('term:: def\n')).toBe('chip')
    expect(kinds('* a\n+\n----\nx\n----\n')).toBe('chip')
    expect(kinds('* a\n\n----\nx\n----\n')).not.toMatch(/i1.*i1/)
    expect(kinds('* a\n+\n\nmore\n')).toContain('chip')
  })

  it('two blank lines in a row make the list a plate', () => {
    for (const t of [
      '* alpha\n\n\n- alpha\n* alpha\n',
      '* a\n\n\n* b\n',
      '1. a\n\n\n* x\n2. b\n',
      '* a\n** b\n\n\n* c\n',
      '* a\r\n\r\n\r\n* b\r\n',
      '* a\n  \n\n* b\n',
    ])
      expect(kinds(t)).toBe('chip')
    expect(kinds('* a\n\n* b\n')).toBe('i1 i1')
    expect(kinds('1. a\n\n* x\n* y\n2. b\n')).toBe('i1 i2 i2 i1')
    expect(kinds(K1)).toBe('paragraph paragraph i1 i1 i1 i1 i2 i2 table')
    expect(kinds('* a\n* b\n\n\nnext\n')).toBe('i1 i1 empty paragraph')
  })

  it('a block put at an item of such a list goes after the list, the list is as it was', () => {
    const t = '* alpha\n\n\n- alpha\n* alpha\n'
    const r = applyOperation(parse(t), {
      kind: 'placeBlock',
      at: 0,
      block: { kind: 'listing', text: 'x', language: 'text' },
      replace: true,
    } as Operation)
    expect('error' in r).toBe(false)
    if ('error' in r) return
    expect(r.doc.text.slice(0, 25)).toBe(t.slice(0, 25))
    expect(r.doc.text.indexOf('----')).toBeGreaterThan(25)
    expect(kinds(r.doc.text.slice(0, 26))).toBe('chip')
  })

  it('a text of the file does not change when the items are read', () => {
    for (const t of ['* a\n\n* b\n', '1. a\n\n* x\n* y\n2. b\n', K1]) {
      const l = readLayout(parse(t))
      expect(l.length).toBe(t.length)
    }
  })
})
