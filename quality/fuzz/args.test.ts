import { describe, expect, it } from 'vitest'
import { DEFAULT_RUNS, REPRODUCE_RUNS, resolveRuns } from './args.js'

describe('fuzz runs', () => {
  it('defaults to a short run', () => {
    expect(resolveRuns(undefined, undefined)).toBe(DEFAULT_RUNS)
  })

  it('takes the number given', () => {
    expect(resolveRuns('250', undefined)).toBe(250)
    expect(resolveRuns('250', '7')).toBe(250)
  })

  it('reproduces with a seed alone over as many runs as the spec asks for, so a late failure is found again', () => {
    expect(resolveRuns(undefined, '7')).toBe(REPRODUCE_RUNS)
    expect(REPRODUCE_RUNS).toBeGreaterThanOrEqual(100_000)
  })
})
