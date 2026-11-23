// the caret beside a grey inline plate. A plate is never selected as a whole (a selected node has no caret);
// an arrow passes it in one press with a plain text selection on the other side, a click on it puts the caret at its
// nearer edge, and a typed letter goes where the caret is.
import { NodeSelection, TextSelection } from 'prosemirror-state'
import { afterEach, describe, expect, it } from 'vitest'
import { projectDocument } from '@nota-adoc/prosemirror'
import { type Setup, closeAll, key, open, posIn, select, shape, type } from './helpers.js'

afterEach(closeAll)

/** `:experimental:` is set by the plate in the first paragraph, so `kbd:[Ctrl]` in the second one is a plate too. */
const TEXT = 'a {set:experimental:}\n\nkbd:[Ctrl] b\n\nx {a}{b} y\n'

const synced = ({ editor, session }: Setup): void => {
  expect(editor.view.state.doc.eq(projectDocument(session.doc))).toBe(true)
}

/** What is selected, and what stands on each side of it. */
function where(s: Setup): { plain: boolean; pos: number; before: string; after: string } {
  const { selection } = s.editor.view.state
  const $from = selection.$from
  const name = (n: { type: { name: string } } | null | undefined): string =>
    !n ? '' : n.type.name === 'inline_chip' ? 'chip' : n.type.name === 'text' ? 'text' : n.type.name
  return {
    plain: selection instanceof TextSelection && selection.empty,
    pos: selection.from,
    before: name($from.nodeBefore),
    after: name($from.nodeAfter),
  }
}

// paragraph 0: `a ` then a plate at its end; 1: a plate then ` b`; 2: `x `, plate `{a}`, plate `{b}`, ` y`
const P0_BEFORE = (s: Setup): number => posIn(s.editor, 0, 2)
const P0_AFTER = (s: Setup): number => posIn(s.editor, 0, 3)
const P1_BEFORE = (s: Setup): number => posIn(s.editor, 1, 0)
const P1_AFTER = (s: Setup): number => posIn(s.editor, 1, 1)
const P2_BEFORE_A = (s: Setup): number => posIn(s.editor, 2, 2)
const P2_BETWEEN = (s: Setup): number => posIn(s.editor, 2, 3)
const P2_AFTER_B = (s: Setup): number => posIn(s.editor, 2, 4)

describe('inline plates: the text', () => {
  it('reads `{set:…}`, `kbd:[…]` and `{a}{b}` as plates, two in a row for the last one', () => {
    const s = open(TEXT)
    expect(shape(s.editor)).toBe('a ⟦chip⟧|⟦chip⟧ b|x ⟦chip⟧⟦chip⟧ y')
  })

  it('a plate cannot be selected as a whole: a selected node has no caret', () => {
    const s = open(TEXT)
    const { doc } = s.editor.view.state
    expect(NodeSelection.isSelectable(doc.nodeAt(P0_BEFORE(s))!)).toBe(false)
    expect(NodeSelection.isSelectable(doc.nodeAt(P1_BEFORE(s))!)).toBe(false)
    expect(NodeSelection.isSelectable(doc.nodeAt(P2_BETWEEN(s))!)).toBe(false)
  })
})

describe('inline plates: an arrow passes a plate in one press', () => {
  it('→ before the plate at the end of a paragraph, ← after it', () => {
    const s = open(TEXT)
    select(s.editor, P0_BEFORE(s))
    key(s.editor, 'ArrowRight')
    expect(where(s)).toEqual({ plain: true, pos: P0_AFTER(s), before: 'chip', after: '' })
    key(s.editor, 'ArrowLeft')
    expect(where(s)).toEqual({ plain: true, pos: P0_BEFORE(s), before: 'text', after: 'chip' })
    synced(s)
  })

  it('a plate at the start of a paragraph: → from before it and ← from after it', () => {
    const s = open(TEXT)
    select(s.editor, P1_BEFORE(s))
    key(s.editor, 'ArrowRight')
    expect(where(s)).toEqual({ plain: true, pos: P1_AFTER(s), before: 'chip', after: 'text' })
    key(s.editor, 'ArrowLeft')
    expect(where(s)).toEqual({ plain: true, pos: P1_BEFORE(s), before: '', after: 'chip' })
    synced(s)
  })

  it('two plates in a row: one press for each, the caret stops between them', () => {
    const s = open(TEXT)
    select(s.editor, P2_AFTER_B(s))
    key(s.editor, 'ArrowLeft')
    expect(where(s)).toEqual({ plain: true, pos: P2_BETWEEN(s), before: 'chip', after: 'chip' })
    key(s.editor, 'ArrowLeft')
    expect(where(s)).toEqual({ plain: true, pos: P2_BEFORE_A(s), before: 'text', after: 'chip' })
    key(s.editor, 'ArrowRight')
    expect(where(s)).toEqual({ plain: true, pos: P2_BETWEEN(s), before: 'chip', after: 'chip' })
    key(s.editor, 'ArrowRight')
    expect(where(s)).toEqual({ plain: true, pos: P2_AFTER_B(s), before: 'chip', after: 'text' })
    synced(s)
  })

  it('Shift+arrow still takes the plate into the selection, with the text around it', () => {
    const s = open(TEXT)
    select(s.editor, P0_BEFORE(s))
    key(s.editor, 'ArrowRight', { shift: true })
    const { selection } = s.editor.view.state
    expect(selection instanceof TextSelection).toBe(true)
    expect([selection.from, selection.to]).toEqual([P0_BEFORE(s), P0_AFTER(s)])
  })
})

describe('inline plates: a typed letter goes where the caret is', () => {
  it('after `{set:experimental:}` at the end of the paragraph', () => {
    const s = open(TEXT)
    select(s.editor, P0_BEFORE(s))
    key(s.editor, 'ArrowRight')
    type(s.editor, 'Z')
    expect(s.session.text).toBe('a {set:experimental:}Z\n\nkbd:[Ctrl] b\n\nx {a}{b} y\n')
    synced(s)
    s.session.undo()
    expect(s.session.text).toBe(TEXT)
    synced(s)
  })

  it('between `{a}` and `{b}`', () => {
    const s = open(TEXT)
    select(s.editor, P2_BEFORE_A(s))
    key(s.editor, 'ArrowRight')
    type(s.editor, 'Z')
    expect(s.session.text).toBe('a {set:experimental:}\n\nkbd:[Ctrl] b\n\nx {a}Z{b} y\n')
    synced(s)
  })

  it('before the plate at the start of a paragraph', () => {
    const s = open(TEXT)
    select(s.editor, P1_AFTER(s))
    key(s.editor, 'ArrowLeft')
    type(s.editor, 'Z')
    expect(s.session.text).toBe('a {set:experimental:}\n\nZkbd:[Ctrl] b\n\nx {a}{b} y\n')
    synced(s)
  })
})

/** A click on the plate as the plugin gets it from prosemirror-view: at `clientX` on a plate 100 px wide (from 100 to 200). */
function clickOnPlate(s: Setup, pos: number, clientX: number): boolean {
  const { view } = s.editor
  const node = view.state.doc.nodeAt(pos)!
  const dom = view.nodeDOM(pos) as HTMLElement
  dom.getBoundingClientRect = () => ({
    left: 100,
    right: 200,
    top: 0,
    bottom: 20,
    width: 100,
    height: 20,
    x: 100,
    y: 0,
    toJSON: () => ({}),
  })
  const event = new MouseEvent('mouseup', { clientX, clientY: 10, bubbles: true, cancelable: true })
  Object.defineProperty(event, 'target', { value: dom })
  return !!view.someProp('handleClickOn', (f) => f(view, pos, node, pos, event, true))
}

describe('inline plates: a click on the plate', () => {
  it('near its right edge puts the caret to the right of it; near its left edge, to the left', () => {
    const s = open(TEXT)
    expect(clickOnPlate(s, P1_BEFORE(s), 190)).toBe(true)
    expect(where(s)).toEqual({ plain: true, pos: P1_AFTER(s), before: 'chip', after: 'text' })
    expect(clickOnPlate(s, P1_BEFORE(s), 110)).toBe(true)
    expect(where(s)).toEqual({ plain: true, pos: P1_BEFORE(s), before: '', after: 'chip' })
    synced(s)
  })

  it('on the second of two plates: the edges are its own', () => {
    const s = open(TEXT)
    expect(clickOnPlate(s, P2_BETWEEN(s), 110)).toBe(true)
    expect(where(s)).toEqual({ plain: true, pos: P2_BETWEEN(s), before: 'chip', after: 'chip' })
    expect(clickOnPlate(s, P2_BETWEEN(s), 190)).toBe(true)
    expect(where(s)).toEqual({ plain: true, pos: P2_AFTER_B(s), before: 'chip', after: 'text' })
    type(s.editor, 'Z')
    expect(s.session.text).toBe('a {set:experimental:}\n\nkbd:[Ctrl] b\n\nx {a}{b}Z y\n')
    synced(s)
  })
})

describe('block plates do not change', () => {
  it('a click selects the plate with a frame and Backspace takes it away', () => {
    const s = open('a\n\n----\ncode\n----\n\nb\n')
    const { view } = s.editor
    const pos = view.state.doc.child(0).nodeSize
    expect(NodeSelection.isSelectable(view.state.doc.nodeAt(pos)!)).toBe(true)
    const node = view.state.doc.nodeAt(pos)!
    const event = new MouseEvent('mouseup', { bubbles: true, cancelable: true })
    // the plugin leaves a click on a block plate to prosemirror-view, which selects it
    expect(view.someProp('handleClickOn', (f) => f(view, pos, node, pos, event, true))).toBeFalsy()
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)))
    key(s.editor, 'Backspace')
    expect(s.session.text).toBe('a\n\nb\n')
    synced(s)
  })
})
