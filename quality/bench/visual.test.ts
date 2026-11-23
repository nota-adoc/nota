import { describe, expect, it } from 'vitest'
import { measureVisual, visualBudget, visualFailures } from './visual.js'

describe('bench visual', () => {
  it('measures keystrokes in the visual editor, and reports a budget that is missed', () => {
    const r = measureVisual({ size: 30_000, keystrokes: 80 })
    expect(r.keystrokes).toBe(80)
    expect(r.size).toBeGreaterThan(30_000)
    expect(r.p95Ms).toBeGreaterThanOrEqual(r.medianMs)
    expect(r.notaMedianMs).toBeGreaterThan(0)
    // (the two percentiles are of different samples: Nota is not timed on every keystroke, so they are not compared
    // with each other, which a busy machine breaks; the same keystroke is compared with its own part)
    expect(r.notaWithinKeystroke).toBe(true)
    expect(visualFailures({ ...r, p95Ms: 20, notaP95Ms: 1 })[0]).toMatch(/^FAIL: p95 of a keystroke/)
    expect(visualFailures({ ...r, p95Ms: 1, notaP95Ms: 4 })[0]).toMatch(/^FAIL: p95 of Nota/)
    expect(
      visualFailures({ ...r, p95Ms: visualBudget.p95Ms - 1, notaP95Ms: visualBudget.notaP95Ms - 1 }),
    ).toEqual([])
  })
})
