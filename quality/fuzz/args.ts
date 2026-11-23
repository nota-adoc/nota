/** Runs per property when neither --runs nor --seed is given. */
export const DEFAULT_RUNS = 10_000

/**
 * Runs per property with --seed alone. A failure found late in a long run is only found again if the
 * reproduction runs as far, so a bare `--seed S` runs as many cases as `--runs 100000`.
 */
export const REPRODUCE_RUNS = 100_000

export function resolveRuns(runs: string | undefined, seed: string | undefined): number {
  if (runs !== undefined) return Number(runs)
  return seed !== undefined ? REPRODUCE_RUNS : DEFAULT_RUNS
}
