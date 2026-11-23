/**
 * The cheapest of `runs` timings of `f` in milliseconds, measured in CPU time of the process (user + system), not in
 * wall-clock time. The CPU time is an upper estimate of the cost of the code, not an exact one: the garbage collector and the
 * JIT compiler of the process count into it too. On a busy machine (load average 20-40) the scheduler stretches the wall-clock time of a run many
 * times, while the CPU time stays close to the cost of the code. The budget stays what it was: a regression to
 * quadratic time is seconds of CPU in EVERY run, so the cheapest of them shows it too.
 * The tests run in forked processes (not threads), so the CPU time of the process is the time of the test.
 */
export function bestMs(f: () => void, runs = 7): number {
  let best = Infinity
  for (let i = 0; i < runs; i++) {
    const t = process.cpuUsage()
    f()
    const d = process.cpuUsage(t)
    best = Math.min(best, (d.user + d.system) / 1000)
  }
  return best
}
