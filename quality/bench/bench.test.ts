import { describe, expect, it } from 'vitest'
import { parse } from '@nota-adoc/core'
import { renderHtml } from '@nota-adoc/html'
import {
  editorFailures,
  generateDocument,
  generateSpecPage,
  largeCases,
  measureEditor,
  measureIncremental,
  measureTargets,
  targetsFailures,
} from './bench.js'

describe('bench', () => {
  it('generates a document of about the requested size with many sections', () => {
    const text = generateDocument(200_000, 1)
    expect(text.length).toBeGreaterThan(190_000)
    expect(text.length).toBeLessThan(230_000)
    expect(text.match(/^== /gm)!.length).toBeGreaterThan(50)
    // lists, blocks that hold blocks and conditions
    expect(text).toMatch(/^\* /m)
    expect(text).toMatch(/^====$/m)
    expect(text).toMatch(/^ifdef::flavor\[\]$/m)
    expect(generateDocument(200_000, 1)).toBe(text)
  })

  it('measures update against full parse and verifies the updated tree', () => {
    const r = measureIncremental({ size: 100_000, samples: 3 })
    expect(r.parseMs).toBeGreaterThan(0)
    expect(r.updateMs).toBeGreaterThan(0)
    expect(r.ratio).toBeCloseTo(r.parseMs / r.updateMs)
    expect(r.identical).toBe(true)
  })

  it('defines the large inputs of the spec', () => {
    const names = largeCases().map((c) => c.name)
    expect(names).toEqual([
      '4 MB, thousands of sections',
      'one 50 000 character line',
      '10 000 nested blocks with delimiters of growing length',
      '10 000 levels of > quotes',
      '1 000 levels of > quotes separated by > lines',
      'a list of 100 000 items',
      '100 000 lines in one example block',
      '10 000 nested unclosed ifdef',
      '100 000 ifeval lines',
      'a list item of 50 000 characters',
      '50 000 lines of + in a row',
      '100 000 lines [x]',
      '200 000 blank lines',
      'section title with a 50 000 character run of spaces',
      'revision line with a 50 000 character run of spaces',
      'revision line of 50 000 colons',
      'attribute list with a 50 000 character run of tabs after a quote',
      'attribute list with a 50 000 character run of spaces after a shorthand sigil',
      'attribute list of 10 000 attributes with unclosed double quotes',
      'attribute list of 10 000 attributes with unclosed single quotes',
      'anchor line with a 50 000 character run of spaces after the comma',
      'manpage NAME line with a 50 000 character run of spaces',
      'inline: a line of 50 000 *',
      'inline: a line of 50 000 _',
      'inline: a line of 50 000 `',
      'inline: a line of 50 000 #',
      'inline: a line of 50 000 ^',
      'inline: a line of 50 000 ~',
      'inline: a line of 50 000 +',
      'inline: a line of 25 000 × *a',
      'inline: a line of 10 000 × [.r]#',
      'inline: a line of 50 000 × {',
      'inline: a line of 50 000 × [',
      'inline: a line of 25 000 × <<',
      'inline: a line of 50 000 × \\',
      'inline: unclosed pass:[ before 50 000 characters',
      'inline: unclosed +++ before 50 000 characters',
      'inline: 10 000 nested *_',
      'inline: a paragraph of 100 000 lines with bold across all of them',
      'inline: 10 000 links in one line',
      'table: 100 000 cells',
      'table: a cell of 50 000 characters',
      'table: a line of 50 000 |',
      'table: cols="1000*"',
      'table: 100000*|x',
      'table: an unclosed CSV quote before 100 000 lines',
    ])
    const small = largeCases(0.01)
    for (const c of small) expect(() => renderHtml(parse(c.text()))).not.toThrow()
  })

  it('builds the nested inputs so that they nest', () => {
    const nesting = (text: string, name: string) => {
      let depth = 0
      let max = 0
      parse(text).tree.iterate({
        enter(n) {
          if (n.name === name && ++depth > max) max = depth
        },
        leave(n) {
          if (n.name === name) depth--
        },
      })
      return max
    }
    const small = new Map(largeCases(0.01).map((c) => [c.name, c.text()]))
    expect(nesting(small.get('10 000 levels of > quotes')!, 'BlockQuote')).toBe(100)
    expect(nesting(small.get('1 000 levels of > quotes separated by > lines')!, 'BlockQuote')).toBe(10)
    expect(
      nesting(small.get('10 000 nested blocks with delimiters of growing length')!, 'DelimitedBlock'),
    ).toBe(100)
  })

  it('measures insertions into an editor state and the opening of a large document', () => {
    const r = measureEditor({ size: 30_000, edits: 40, openSize: 100_000, seed: 3 })
    expect(r.edits).toBe(40)
    expect(r.medianMs).toBeGreaterThan(0)
    expect(r.seriesP95Ms).toHaveLength(3)
    expect([...r.seriesP95Ms].sort((a, b) => a - b)[1]).toBe(r.p95Ms)
    expect(r.openSize).toBeGreaterThan(90_000)
    expect(r.openMs).toBeGreaterThan(0)
  })

  it('reports the budgets of the editor that are exceeded, and only those', () => {
    const ok = { size: 1, edits: 1, medianMs: 1, p95Ms: 7.9, seriesP95Ms: [7.9], openSize: 1, openMs: 999 }
    expect(editorFailures(ok)).toEqual([])
    expect(editorFailures({ ...ok, p95Ms: 8 })).toEqual(['FAIL: p95 8.000 ms is not under 8 ms'])
    expect(editorFailures({ ...ok, openMs: 1000 })).toEqual(['FAIL: opening took 1000 ms, not under 1000 ms'])
    expect(editorFailures({ ...ok, p95Ms: 20, openMs: 5000 })).toHaveLength(2)
  })

  it('generates a specification page with the constructs of the targets', () => {
    const text = generateSpecPage(30_000)
    expect(text.length).toBeGreaterThan(30_000)
    for (const rx of [/^a\|/m, /^!===$/m, /\*\*\w+\*\*/, /\+\+\+<span/, /xref:/]) expect(text).toMatch(rx)
    expect(parse(text).diagnostics.filter((d) => d.severity === 'error')).toEqual([])
  })

  it('measures the speed targets and reports the ones that are exceeded, and only those', () => {
    const r = measureTargets({
      pageSize: 20_000,
      bigSize: 100_000,
      typeSize: 30_000,
      keystrokes: 30,
      samples: 3,
    })
    expect(r.keystrokes).toBe(30)
    expect(r.pageMedianMs).toBeGreaterThan(0)
    expect(r.typeP95Ms).toBeGreaterThan(0)
    expect(r.typeSeriesP95Ms).toHaveLength(3)
    expect([...r.typeSeriesP95Ms].sort((a, b) => a - b)[1]).toBe(r.typeP95Ms)
    const ok = {
      pageSize: 1,
      pageMedianMs: 20,
      bigSize: 1,
      bigMs: 1000,
      typeSize: 1,
      keystrokes: 1,
      typeP95Ms: 3,
      typeSeriesP95Ms: [3],
    }
    expect(targetsFailures(ok)).toEqual([])
    expect(targetsFailures({ ...ok, bigMs: 1001 })).toHaveLength(1)
    expect(targetsFailures({ ...ok, pageMedianMs: 21, typeP95Ms: 4 })).toHaveLength(2)
  })
})
