// the selection as offsets, scrolling by offset, the marks of remarks.
import { afterEach, describe, expect, it } from 'vitest'
import { NodeSelection } from 'prosemirror-state'
import { closeAll, open } from './helpers.js'

afterEach(closeAll)

const TEXT = '= Doc\n\nHello *bold* world.\n\n== Sec\n\n----\ncode\n----\n\nAfter.\n'

describe('selection offsets', () => {
  it('puts the cursor inside a word and reads it back', () => {
    const { editor } = open(TEXT)
    const at = TEXT.indexOf('world') + 2
    editor.setSelectionAtOffset(at)
    expect(editor.selectionOffsets()).toEqual({ anchor: at, head: at })
    editor.view.dispatch(editor.view.state.tr.insertText('X'))
    expect(editor.getText()).toContain('woXrld')
  })

  it('reads a range', () => {
    const { editor } = open(TEXT)
    const a = TEXT.indexOf('Hello')
    const b = TEXT.indexOf('world')
    editor.setSelectionAtOffset(a, b)
    expect(editor.selectionOffsets()).toEqual({ anchor: a, head: b })
  })

  it('an offset in markup that is not shown goes to the nearest visible place of the block', () => {
    const { editor } = open(TEXT)
    // between the two `*` of the bold: the mark itself is not shown
    const star = TEXT.indexOf('*bold*')
    editor.setSelectionAtOffset(star)
    const got = editor.selectionOffsets()!
    expect(got.anchor).toBeGreaterThanOrEqual(TEXT.indexOf('Hello'))
    expect(got.anchor).toBeLessThanOrEqual(TEXT.indexOf('world'))
  })

  it('an offset inside code puts the cursor in its text', () => {
    const { editor } = open(TEXT)
    editor.setSelectionAtOffset(TEXT.indexOf('code') + 1)
    expect(editor.view.state.selection).not.toBeInstanceOf(NodeSelection)
    expect(editor.selectionOffsets()).toEqual({ anchor: TEXT.indexOf('code') + 1, head: TEXT.indexOf('code') + 1 })
  })

  it('an offset in a title goes into the title', () => {
    const { editor } = open(TEXT)
    editor.setSelectionAtOffset(TEXT.indexOf('Sec') + 1)
    expect(editor.selectionOffsets()!.anchor).toBe(TEXT.indexOf('Sec') + 1)
  })
})

describe('scrolling by offset', () => {
  it('scrolls the block of the offset to the top of the scroller', () => {
    const { editor, el } = open(TEXT)
    const scroller = document.createElement('div')
    scroller.style.overflowY = 'auto'
    el.parentElement!.append(scroller)
    scroller.append(el)
    scroller.getBoundingClientRect = () => ({ top: 100, bottom: 500, left: 0, right: 300, width: 300, height: 400, x: 0, y: 100, toJSON() {} })
    const blocks = [...editor.view.dom.children] as HTMLElement[]
    blocks.forEach((b, i) => (b.getBoundingClientRect = () => ({ top: 100 + i * 50 - scroller.scrollTop, bottom: 140 + i * 50 - scroller.scrollTop, left: 0, right: 300, width: 300, height: 40, x: 0, y: 0, toJSON() {} })))
    // jsdom has no layout: a caret is where its block is
    editor.view.coordsAtPos = (pos) => blocks[editor.view.state.doc.resolve(pos).index(0)]!.getBoundingClientRect() as never
    const heading = TEXT.indexOf('== Sec')
    editor.scrollToOffset(heading, 'start')
    // the heading is the third block: 100 + 2 * 50 - 100 = 100 pixels down
    expect(scroller.scrollTop).toBe(100)
    // and the top visible block is then the heading
    expect(editor.topVisibleOffset()).toBe(heading)
  })

  it('with the top margin the block goes below the capsules and the top visible block is the one not covered', () => {
    const { editor, el } = open(TEXT)
    editor.setScrollMarginTop(60)
    const scroller = document.createElement('div')
    scroller.style.overflowY = 'auto'
    el.parentElement!.append(scroller)
    scroller.append(el)
    scroller.getBoundingClientRect = () => ({ top: 100, bottom: 500, left: 0, right: 300, width: 300, height: 400, x: 0, y: 100, toJSON() {} })
    const blocks = [...editor.view.dom.children] as HTMLElement[]
    blocks.forEach((b, i) => (b.getBoundingClientRect = () => ({ top: 100 + i * 50 - scroller.scrollTop, bottom: 140 + i * 50 - scroller.scrollTop, left: 0, right: 300, width: 300, height: 40, x: 0, y: 0, toJSON() {} })))
    editor.view.coordsAtPos = (pos) => blocks[editor.view.state.doc.resolve(pos).index(0)]!.getBoundingClientRect() as never
    const heading = TEXT.indexOf('== Sec')
    editor.scrollToOffset(heading, 'start')
    // 100 down to the top edge, 60 less: the heading stands under the capsules, not behind them
    expect(scroller.scrollTop).toBe(40)
    expect(editor.topVisibleOffset()).toBe(heading)
  })

  it('a jump to the nearest place does not leave the target under the capsules', () => {
    const { editor, el } = open(TEXT)
    editor.setScrollMarginTop(60)
    const scroller = document.createElement('div')
    scroller.style.overflowY = 'auto'
    el.parentElement!.append(scroller)
    scroller.append(el)
    scroller.getBoundingClientRect = () => ({ top: 100, bottom: 500, left: 0, right: 300, width: 300, height: 400, x: 0, y: 100, toJSON() {} })
    const blocks = [...editor.view.dom.children] as HTMLElement[]
    blocks.forEach((b, i) => (b.getBoundingClientRect = () => ({ top: 100 + i * 50 - scroller.scrollTop, bottom: 140 + i * 50 - scroller.scrollTop, left: 0, right: 300, width: 300, height: 40, x: 0, y: 0, toJSON() {} })))
    editor.view.coordsAtPos = (pos) => blocks[editor.view.state.doc.resolve(pos).index(0)]!.getBoundingClientRect() as never
    // the heading stands at 140..180: inside the scroller, but in the 60 px the capsules cover
    const heading = TEXT.indexOf('== Sec')
    scroller.scrollTop = 60
    editor.scrollToOffset(heading, 'nearest')
    expect(scroller.scrollTop).toBeLessThan(60)
    // a block already below the cover stays: no scrolling
    scroller.scrollTop = 0
    editor.scrollToOffset(heading, 'nearest')
    expect(scroller.scrollTop).toBe(0)
  })

  it('the top block of a long document is found by measuring a few blocks, not all', () => {
    const text = Array.from({ length: 300 }, (_, i) => `== S${i}\n\nText ${i}.\n`).join('\n')
    const { editor, el } = open(text)
    const scroller = document.createElement('div')
    scroller.style.overflowY = 'auto'
    el.parentElement!.append(scroller)
    scroller.append(el)
    scroller.getBoundingClientRect = () => ({ top: 100, bottom: 500, left: 0, right: 300, width: 300, height: 400, x: 0, y: 100, toJSON() {} })
    let measured = 0
    const blocks = [...editor.view.dom.children] as HTMLElement[]
    blocks.forEach(
      (b, i) =>
        (b.getBoundingClientRect = () => {
          measured++
          return { top: 100 + i * 50 - scroller.scrollTop, bottom: 140 + i * 50 - scroller.scrollTop, left: 0, right: 300, width: 300, height: 40, x: 0, y: 0, toJSON() {} }
        }),
    )
    for (const k of [0, 1, 7, 250, blocks.length - 1]) {
      scroller.scrollTop = k * 50
      measured = 0
      const got = editor.topVisibleOffset()
      expect(measured).toBeLessThanOrEqual(12)
      // the same as the plain scan: the first block that ends below the top edge
      const first = blocks.findIndex((_, i) => 140 + i * 50 - k * 50 > 101)
      expect(blocks[first]).toBe(blocks[k])
      expect(text.slice(got, got + 2)).toBe(k % 2 === 0 ? '==' : 'Te')
    }
  })

  it('does nothing without a layout', () => {
    const { editor } = open(TEXT)
    expect(() => editor.scrollToOffset(10, 'start')).not.toThrow()
    expect(editor.topVisibleOffset()).toBe(0)
  })
})

describe('marks of remarks', () => {
  it('marks a stretch of a paragraph with the class diag and the message as title', () => {
    const { editor } = open(TEXT)
    const from = TEXT.indexOf('world')
    editor.setRanges([{ from, to: from + 5, message: 'Нет такого', severity: 'warning' }])
    const mark = editor.view.dom.querySelector('.diag') as HTMLElement
    expect(mark.textContent).toBe('world')
    expect(mark.title).toBe('Нет такого')
    expect(mark.dataset.severity).toBe('warning')
  })

  it('marks a plate as a whole', () => {
    const { editor } = open(TEXT)
    const from = TEXT.indexOf('----')
    editor.setRanges([{ from, to: from + 4, message: 'Плашка' }])
    expect(editor.view.dom.querySelector('.nota-code.diag')).not.toBeNull()
  })

  it('follows the text and goes away when the ranges are cleared', () => {
    const { editor, session } = open(TEXT)
    const from = TEXT.indexOf('world')
    editor.setRanges([{ from, to: from + 5, message: 'm' }])
    session.apply([{ from: 0, to: 0, insert: 'Intro.\n\n' }])
    // the ranges are the caller's to move: the marks stay at their offsets, nothing throws
    expect(() => editor.setRanges([])).not.toThrow()
    expect(editor.view.dom.querySelector('.diag')).toBeNull()
  })
})
