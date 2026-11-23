// The global setup of vitest: one folder per run, the leftovers of the killed runs are swept at the start (no Chrome needed).
// Each test works in a temp root of its own (NOTA_TMP_ROOT is moved there) and puts the environment back.
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import setup from './tmp-global-setup.js'

const KEYS = ['TMPDIR', 'NOTA_TMP_ROOT', 'NOTA_VITEST_RUN', 'NOTA_CHROME_STALE_MIN'] as const
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]))
const restoreEnv = (): void => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
}

// what the main process of vitest made for this run (read before any test touches the environment)
const runRoot = process.env.NOTA_TMP_ROOT
const runTmp = process.env.TMPDIR

let base = ''
let root = ''
const spawned: number[] = []
beforeAll(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'nota-vitest-selftest-base-')))
})
afterEach(() => {
  restoreEnv()
  for (const pid of spawned.splice(0)) {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      /* gone */
    }
  }
  if (root) rmSync(root, { recursive: true, force: true })
})
afterAll(() => rmSync(base, { recursive: true, force: true }))

function freshRoot(): string {
  root = mkdtempSync(join(base, 'root-'))
  process.env.NOTA_TMP_ROOT = root
  delete process.env.NOTA_CHROME_STALE_MIN
  return root
}
const age = (path: string, ms: number): void => utimesSync(path, new Date(Date.now() - ms), new Date(Date.now() - ms))
const folders = (dir: string, prefix: string): string[] => readdirSync(dir).filter((n) => n.startsWith(prefix))
function deadPid(): number {
  const p = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' })
  const pid = p.pid!
  execFileSync(process.execPath, ['-e', 'setTimeout(()=>{},300)']) // it has ended by now
  return pid
}

describe('global setup of vitest', () => {
  it('the run has one folder nota-vitest-<pid>-* and TMPDIR of the worker points to it', () => {
    expect(runRoot).toBeTruthy()
    const mine = folders(runRoot!, `nota-vitest-${process.ppid}-`)
    expect(mine).toHaveLength(1)
    expect(runTmp).toBe(join(runRoot!, mine[0]!))
  })

  it('a second call in the same process takes the same folder; the last teardown removes it and puts the environment back', async () => {
    const r = freshRoot()
    process.env.TMPDIR = '/original-tmp'
    delete process.env.NOTA_VITEST_RUN
    const first = await setup()
    const dir = process.env.TMPDIR!
    const second = await setup()
    expect(process.env.TMPDIR).toBe(dir)
    expect(folders(r, `nota-vitest-${process.pid}-`)).toHaveLength(1)
    first()
    expect(existsSync(dir)).toBe(true)
    second()
    expect(existsSync(dir)).toBe(false)
    expect(folders(r, 'nota-')).toHaveLength(0)
    expect(process.env.TMPDIR).toBe('/original-tmp')
    expect(process.env.NOTA_VITEST_RUN).toBeUndefined()
  })

  it('the start sweeps the leftovers of killed runs and leaves the live and the foreign folders', async () => {
    const r = freshRoot()
    const dead = deadPid()
    const make = (name: string, owner?: number, aged = false): string => {
      const d = join(r, name)
      mkdirSync(d)
      if (owner !== undefined) writeFileSync(join(d, '.nota-owner'), String(owner))
      if (aged) age(d, 3 * 3600_000)
      return d
    }
    const killedRun = make(`nota-vitest-${dead}-x`, dead)
    const old = make('nota-old-x', undefined, true)
    const young = make('nota-young-x')
    const live = make('nota-live-x', process.pid)
    const plain = make('plain-old-x', undefined, true)
    const teardown = await setup()
    try {
      expect(existsSync(killedRun)).toBe(false)
      expect(existsSync(old)).toBe(false)
      expect(existsSync(young)).toBe(true)
      expect(existsSync(live)).toBe(true)
      expect(existsSync(plain)).toBe(true)
    } finally {
      teardown()
    }
  })

  it('the start kills an orphan (parent PID 1, profile nota-*) and removes its profile in the same pass', async () => {
    const r = freshRoot()
    process.env.NOTA_CHROME_STALE_MIN = '0.05' // 3 s
    const idle = ['-e', 'setTimeout(() => {}, 600000)', '--']
    const orphanProfile = join(r, 'nota-orphan-x')
    mkdirSync(orphanProfile)
    spawn('sh', ['-c', '"$@" >/dev/null 2>&1 &', 'sh', process.execPath, ...idle, `--user-data-dir=${orphanProfile}`], { stdio: 'ignore' }).unref()
    const foreignProfile = join(r, 'plain-orphan-x')
    spawn('sh', ['-c', '"$@" >/dev/null 2>&1 &', 'sh', process.execPath, ...idle, `--user-data-dir=${foreignProfile}`], { stdio: 'ignore' }).unref()
    const liveProfile = join(r, 'nota-live-parent-x')
    const live = spawn(process.execPath, [...idle, `--user-data-dir=${liveProfile}`], { stdio: 'ignore' })
    spawned.push(live.pid!)
    const pids = (text: string): number[] =>
      execFileSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' })
        .split('\n')
        .filter((l) => l.includes(text) && !l.includes(' ps '))
        .map((l) => Number(l.trim().split(/\s+/)[0]))
    const start = Date.now()
    while (!(pids(orphanProfile).length && pids(foreignProfile).length) && Date.now() - start < 10_000) await new Promise((x) => setTimeout(x, 100))
    spawned.push(...pids(foreignProfile))
    expect(pids(orphanProfile).length).toBeGreaterThan(0)
    await new Promise((x) => setTimeout(x, 5000))
    const teardown = await setup()
    try {
      expect(pids(orphanProfile)).toEqual([])
      expect(existsSync(orphanProfile)).toBe(false)
      expect(pids(foreignProfile).length).toBeGreaterThan(0)
      expect(pids(liveProfile).length).toBeGreaterThan(0)
    } finally {
      teardown()
    }
  })
})
