import { describe, expect, it } from 'vitest'
import { type Operation, applyOperation, parse } from '@nota-adoc/core'
import { printCells, readInline, readLayout } from '@nota-adoc/core/internal'

/** The cells of the first paragraph or heading of a text. */
function cellsOf(text: string) {
  const doc = parse(text)
  const b = readLayout(doc).blocks.find((x) => x.kind !== 'chip')!
  return readInline(doc, b.content!.from, b.content!.to).cells
}

/** The roles of every character of the first block, `-` for none: `Раз [.zz-a]#два#` gives `---zz-a|zz-a|zz-a`. */
function rolesOf(text: string): string[] {
  return cellsOf(text).map(
    (c) =>
      c.spans
        .filter((s) => s.type === 'roles')
        .map((s) => s.attrs)
        .join('') || '-',
  )
}

function run(text: string, op: Operation): string {
  const r = applyOperation(parse(text), op)
  if ('error' in r) return `error:${r.error}`
  return r.doc.text
}

describe('reading: text with roles', () => {
  const ok = [
    'Раз [.zz-a]#два# [.hl-qq.q1]##три## [zz-a]#четыре# [.zz-a]*пять*',
    '== Раз [.zz-a]#два#',
    'https://e.example[раз [.zz-a]#два#]',
    '*жир [.zz-a]#два# жир*',
    '_кур [.zz-a]#два# кур_',
    '[.zz-a]##x [.b]#y# z##',
  ]
  for (const text of ok) {
    it(`${text} reads as marks and prints as it was`, () => {
      const cells = cellsOf(text)
      expect(cells.some((c) => c.kind === 'chip')).toBe(false)
      expect(cells.some((c) => c.spans.some((s) => s.type === 'roles'))).toBe(true)
      expect(printCells(cells)).toBe(text.replace(/^== /, ''))
    })
  }

  it('names the roles of the characters', () => {
    expect(rolesOf('Раз [.zz-a]#два# [.hl-qq.q1]##три##')).toEqual([
      '-',
      '-',
      '-',
      '-',
      '[.zz-a]',
      '[.zz-a]',
      '[.zz-a]',
      '-',
      '[.hl-qq.q1]',
      '[.hl-qq.q1]',
      '[.hl-qq.q1]',
    ])
  })

  for (const text of ['[#i1.zz-a]#x#', '[.zz-{a}]#x#', '[.zz-a,k=v]#x#', '[.zz-a%opt]#x#']) {
    it(`${text} stays a plate`, () => {
      expect(cellsOf(text).map((c) => c.kind)).toEqual(['chip'])
    })
  }

  it('keeps [.line-through] as strike', () => {
    expect(cellsOf('[.line-through]#x#')[0]!.spans[0]!.type).toBe('strike')
  })
})

describe('editing text with roles', () => {
  const at = (text: string, needle: string, shift = 0): number => text.indexOf(needle) + shift
  const T = 'Раз [.zz-a]#два# три'

  it('types inside', () => {
    expect(run(T, { kind: 'insertText', at: at(T, 'в'), text: 'ж', marks: {} })).toBe('Раз [.zz-a]#джва# три')
  })

  it('types at the inner edges', () => {
    expect(run(T, { kind: 'insertText', at: at(T, '# три'), text: 'х' })).toBe('Раз [.zz-a]#двах# три')
    expect(run(T, { kind: 'insertText', at: at(T, 'д'), text: 'х' })).toBe('Раз [.zz-a]#хдва# три')
  })

  it('deletes and drops the span when nothing is left', () => {
    expect(run(T, { kind: 'deleteRange', from: at(T, 'в'), to: at(T, 'в', 1) })).toBe('Раз [.zz-a]#да# три')
    expect(run(T, { kind: 'deleteRange', from: at(T, '['), to: at(T, '# три', 0) })).toBe('Раз  три')
  })

  it('keeps the role on a blank at the edge', () => {
    const r = run('[.zz-a]#раз д#', { kind: 'deleteRange', from: 12, to: 13 })
    expect(r).toBe('[.zz-a]##раз ##')
    expect(rolesOf(r)).toEqual(['[.zz-a]', '[.zz-a]', '[.zz-a]', '[.zz-a]'])
  })

  it('splits and joins', () => {
    const r = run(T, { kind: 'splitBlock', at: at(T, 'в') })
    expect(r).toBe('Раз [.zz-a]#д#\n\n[.zz-a]#ва# три')
  })

  it('breaks a line inside', () => {
    expect(rolesOf(run(T, { kind: 'insertBreak', at: at(T, 'в') }))).toContain('[.zz-a]')
  })

  it('toggles bold on a part and off', () => {
    const b = run(T, { kind: 'toggleMark', from: at(T, 'в'), to: at(T, 'в', 1), mark: 'strong' })
    expect(b).toBe('Раз [.zz-a]#д**в**а# три')
    const off = run('Раз [.zz-a]*пять*', { kind: 'toggleMark', from: 12, to: 16, mark: 'strong' })
    expect(off).toBe('Раз [.zz-a]#пять#')
  })

  it('does not spread the role to a neighbour', () => {
    const r = run('Раз [.zz-a]#два#', { kind: 'toggleMark', from: 0, to: 3, mark: 'highlight' })
    expect(rolesOf(r).filter((x) => x !== '-')).toHaveLength(3)
  })
})
