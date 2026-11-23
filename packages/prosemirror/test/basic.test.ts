import { afterEach, describe, expect, it } from 'vitest'
import { closeAll, open, posIn, select, shape } from './helpers.js'

afterEach(closeAll)

describe('smoke', () => {
  it('shows a document', () => {
    const { editor } = open('= Title\n\nHello *bold* and _it_.\n\n== Sec\n\nterm:: item\n')
    expect(shape(editor)).toBe('h1:Title|Hello <strong>bold</> and <em>it</>.|h2:Sec|[chip]')
  })

  it('types', () => {
    const { editor, session } = open('hello world')
    select(editor, posIn(editor, 0, 5))
    editor.view.dispatch(editor.view.state.tr.insertText(' big'))
    expect(session.text).toBe('hello big world')
    expect(shape(editor)).toBe('hello big world')
  })
})
