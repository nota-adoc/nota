import { describe, expect, it } from 'vitest'
import { NodeSet, NodeType, Tree } from '@lezer/common'
import { parse } from '@nota-adoc/core'
import { checkLossless, treeSignature } from './invariants.js'

const types = [
  NodeType.none,
  NodeType.define({ id: 1, name: 'Top', top: true }),
  NodeType.define({ id: 2, name: 'Leaf' }),
]
const set = new NodeSet(types)

describe('checkLossless', () => {
  it('accepts parser output', () => {
    const text = '= T\n\n== S\n\ntext\n// c\n'
    expect(checkLossless(text, () => parse(text))).toEqual([])
  })

  it('reports a gap between leaves', () => {
    const tree = Tree.build({ buffer: [2, 0, 1, 4, 2, 2, 3, 4], nodeSet: set, topID: 1, length: 3 })
    const problems = checkLossless('abc', () => ({ text: 'abc', tree }))
    expect(problems.join('\n')).toMatch(/gap/)
  })

  it('reports a wrong tree length', () => {
    const tree = Tree.build({ buffer: [2, 0, 2, 4], nodeSet: set, topID: 1, length: 2 })
    expect(checkLossless('abc', () => ({ text: 'abc', tree })).join('\n')).toMatch(/length/)
  })

  it('reports an exception thrown by the parser', () => {
    expect(
      checkLossless('x', () => {
        throw new Error('boom')
      }).join('\n'),
    ).toMatch(/boom/)
  })

  it('reports a changed text', () => {
    const tree = Tree.build({ buffer: [2, 0, 3, 4], nodeSet: set, topID: 1, length: 3 })
    expect(checkLossless('abc', () => ({ text: 'abd', tree })).join('\n')).toMatch(/text/)
  })
})

describe('treeSignature', () => {
  it('differs when a node boundary differs', () => {
    expect(treeSignature(parse('a\n\nb\n').tree)).not.toBe(treeSignature(parse('a\nb\n\n').tree))
  })

  it('includes section levels', () => {
    expect(treeSignature(parse(':leveloffset: 1\n\n== A\n').tree)).toContain('Section@2')
  })
})
