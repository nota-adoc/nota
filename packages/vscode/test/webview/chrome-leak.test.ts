// The helper that starts Chrome for the tests leaves nothing behind: no Chrome after a kill, a signal or an exit of its
// process, no profile, orphans of the old runs are swept, and no more than NOTA_CHROME_MAX Chromes run at once.
// At most two Chromes live here at a time (about:blank); each test works in a temp root of its own.
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closeAllChromes, findChrome, launchChrome, sweepStale, tmpRoot, withChrome } from './chrome.js'

const CHROME = findChrome()
const here = (p: string): string => fileURLToPath(new URL(p, import.meta.url))
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** The command lines of all processes. */
const commands = (): Promise<string[]> =>
  new Promise((resolve) => execFile('ps', ['-axo', 'command='], { encoding: 'utf8', maxBuffer: 1 << 26 }, (_e, out) => resolve(String(out).split('\n'))))
/** Processes (roots and children) that have this text in the command line. */
const count = async (text: string, rootsOnly = false): Promise<number> =>
  (await commands()).filter((c) => c.includes(text) && !c.startsWith('ps ') && !(rootsOnly && c.includes(' --type='))).length
async function eventually(check: () => Promise<boolean> | boolean, ms = 10_000, what = 'the condition'): Promise<void> {
  const end = Date.now() + ms
  while (!(await check())) {
    if (Date.now() > end) throw new Error(`${what} did not come in ${ms} ms`)
    await wait(150)
  }
}

let root = ''
const children: ChildProcess[] = []
const saved = { tmp: process.env.TMPDIR, root: process.env.NOTA_TMP_ROOT, max: process.env.NOTA_CHROME_MAX, stale: process.env.NOTA_CHROME_STALE_MIN }
function restore(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key]
  else process.env[key] = value
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'nota-leaktest-'))
  process.env.TMPDIR = root
  process.env.NOTA_TMP_ROOT = root
})
afterAll(async () => {
  await closeAllChromes()
  for (const c of children) if (c.pid) try { process.kill(c.pid, 'SIGKILL') } catch { /* gone */ }
  // whatever of this test is still alive (it must not be) is killed by the profile
  await new Promise<void>((resolve) => execFile('pkill', ['-9', '-f', `user-data-dir=${root}/`], () => resolve()))
  rmSync(root, { recursive: true, force: true })
  restore('TMPDIR', saved.tmp)
  restore('NOTA_TMP_ROOT', saved.root)
  restore('NOTA_CHROME_MAX', saved.max)
  restore('NOTA_CHROME_STALE_MIN', saved.stale)
})

interface Child {
  proc: ChildProcess
  lines: string[]
  /** `READY <profile> <pid>` of the first Chrome. */
  ready: Promise<{ profile: string; pid: number }>
  done: Promise<void>
}
/** A Node process that starts Chrome through the helper (the fixture `chrome-leak-child.ts`). */
function child(mode: string, env: Record<string, string> = {}): Child {
  const full: NodeJS.ProcessEnv = { ...process.env, TMPDIR: root, NOTA_TMP_ROOT: root, ...env }
  delete full.VITEST // the helper registers its `afterAll` only inside vitest
  const proc = spawn(process.execPath, ['--import', 'tsx', here('./chrome-leak-child.ts'), mode], { env: full, cwd: here('../../../..'), stdio: ['ignore', 'pipe', 'inherit'] })
  children.push(proc)
  const lines: string[] = []
  let buf = ''
  let onReady: (v: { profile: string; pid: number }) => void = () => {}
  let onDone: () => void = () => {}
  const ready = new Promise<{ profile: string; pid: number }>((r) => (onReady = r))
  const done = new Promise<void>((r) => (onDone = r))
  proc.stdout!.setEncoding('utf8').on('data', (d: string) => {
    buf += d
    for (let k = buf.indexOf('\n'); k >= 0; k = buf.indexOf('\n')) {
      const line = buf.slice(0, k)
      buf = buf.slice(k + 1)
      lines.push(line)
      const m = /^READY (\S+) (\d+)$/.exec(line)
      if (m) onReady({ profile: m[1]!, pid: Number(m[2]) })
      if (line === 'DONE') onDone()
    }
  })
  proc.once('exit', () => onDone())
  return { proc, lines, ready, done }
}
const exited = (c: ChildProcess): Promise<void> => (c.exitCode !== null || c.signalCode !== null ? Promise.resolve() : new Promise((r) => c.once('exit', () => r())))
const gone = (profile: string): Promise<void> => eventually(async () => (await count(`user-data-dir=${profile}`)) === 0, 10_000, `Chrome with ${profile} to end`)

const run = CHROME ? describe : describe.skip
const ARGS = ['--headless=new', '--disable-gpu', '--no-first-run', 'about:blank']

run('Chrome of the tests leaves nothing behind', { timeout: 90_000 }, () => {
  it('the process gets kill -9: Chrome with all its children ends itself', async () => {
    const c = child('wait')
    const { profile, pid } = await c.ready
    await eventually(async () => (await count(`user-data-dir=${profile}`)) > 1, 10_000, 'the children of Chrome')
    process.kill(c.proc.pid!, 'SIGKILL')
    await exited(c.proc)
    await gone(profile)
    expect(pid).toBeGreaterThan(0)
  })

  it('chromeDump mode (--dump-dom, watchdog): the process gets kill -9: Chrome and its profile are gone', async () => {
    const c = child('dump')
    const { profile } = await c.ready
    await eventually(async () => (await count(`user-data-dir=${profile}`)) > 0, 10_000, 'Chrome of the dump')
    process.kill(c.proc.pid!, 'SIGKILL')
    await exited(c.proc)
    await gone(profile)
    await eventually(() => !existsSync(profile), 10_000, `the profile ${profile} to be removed`)
  })

  it('the profile that the killed process left is removed at the next start', async () => {
    const c = child('wait')
    const { profile } = await c.ready
    process.kill(c.proc.pid!, 'SIGKILL')
    await exited(c.proc)
    await gone(profile)
    expect(existsSync(profile)).toBe(true)
    const next = child('hold:100')
    await next.ready
    expect(existsSync(profile)).toBe(false)
    await next.done
  })

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    it(`the process gets ${signal}: no Chrome and no profile`, async () => {
      const c = child('wait')
      const { profile } = await c.ready
      process.kill(c.proc.pid!, signal)
      await exited(c.proc)
      expect(c.proc.signalCode).toBe(signal) // the signal went on: the code of the exit is the same as without the helper
      await gone(profile)
      expect(existsSync(profile)).toBe(false)
    })
  }

  it('the process exits without closing: no Chrome and no profile', async () => {
    const c = child('exit')
    const { profile } = await c.ready
    await exited(c.proc)
    await gone(profile)
    expect(existsSync(profile)).toBe(false)
  })

  it('an exception in the code rejects with it, Chrome is closed, the profile is gone', async () => {
    let profile = ''
    await expect(
      withChrome({ chrome: CHROME!, prefix: 'leak', args: ARGS }, (h) => {
        profile = h.profile
        throw new Error('the test failed')
      }),
    ).rejects.toThrow('the test failed')
    await gone(profile)
    expect(existsSync(profile)).toBe(false)
  })

  it('a timeout of the helper rejects with a clear error, Chrome is closed, the profile is gone', async () => {
    let profile = ''
    await expect(
      withChrome({ chrome: CHROME!, prefix: 'leak', args: ARGS, timeout: 1500, timeoutMessage: 'the page did not answer' }, (h) => {
        profile = h.profile
        return new Promise<never>(() => {})
      }),
    ).rejects.toThrow('the page did not answer')
    await gone(profile)
    expect(existsSync(profile)).toBe(false)
  })

  it('what is open at the end of the file is closed by closeAllChromes (the afterAll of the helper)', async () => {
    const h = await launchChrome({ chrome: CHROME!, prefix: 'leak', args: ARGS })
    await eventually(async () => (await count(`user-data-dir=${h.profile}`)) > 0)
    await closeAllChromes()
    await gone(h.profile)
    expect(existsSync(h.profile)).toBe(false)
  })

  it('the start removes orphans and old folders and leaves the live and the foreign ones', async () => {
    process.env.NOTA_CHROME_STALE_MIN = '0.05' // 3 s
    // a Chrome of an old run: its parent is gone (PID 1)
    const orphanProfile = join(root, 'nota-orphan-1')
    mkdirSync(orphanProfile)
    spawn('sh', ['-c', '"$@" >/dev/null 2>&1 &', 'sh', CHROME!, `--user-data-dir=${orphanProfile}`, ...ARGS], { stdio: 'ignore' }).unref()
    // a Chrome with a parent that lives (a run of another session) and a process without the prefix `nota-` (the usual Chrome)
    const idle = ['-e', 'setTimeout(() => {}, 600000)', '--']
    const live = spawn(process.execPath, [...idle, `--user-data-dir=${join(root, 'nota-live-1')}`], { stdio: 'ignore' })
    const foreignProfile = join(root, 'plain-1')
    spawn('sh', ['-c', '"$@" >/dev/null 2>&1 &', 'sh', process.execPath, ...idle, `--user-data-dir=${foreignProfile}`], { stdio: 'ignore' }).unref()
    children.push(live)
    await eventually(async () => (await count(`user-data-dir=${orphanProfile}`)) > 1 && (await count(foreignProfile)) > 0, 15_000, 'the orphans')
    await wait(4500)
    const old = (name: string, aged: boolean): string => {
      const d = join(root, name)
      mkdirSync(d, { recursive: true })
      if (aged) utimesSync(d, new Date(Date.now() - 3600_000), new Date(Date.now() - 3600_000))
      return d
    }
    const oldDir = old('nota-old-1', true)
    const youngDir = old('nota-young-1', false)
    const plainDir = old('plain-dir-1', true)

    await sweepStale(true)

    // the sweep waits for the orphans to disappear: no `eventually` here, the count is 0 at once and the folder is gone
    expect(await count(`user-data-dir=${orphanProfile}`)).toBe(0)
    expect(existsSync(orphanProfile)).toBe(false)
    expect(existsSync(oldDir)).toBe(false)
    expect(existsSync(youngDir)).toBe(true)
    expect(existsSync(plainDir)).toBe(true)
    expect(await count(foreignProfile)).toBeGreaterThan(0)
    expect(await count('nota-live-1')).toBeGreaterThan(0)
    expect(live.exitCode).toBeNull()
    // (the default N is 120 minutes: the same folders are not touched by a start without the variable)
    delete process.env.NOTA_CHROME_STALE_MIN
    const old2 = old('nota-old-2', true)
    await sweepStale(true)
    expect(existsSync(old2)).toBe(true)
    live.kill('SIGKILL')
    await new Promise<void>((resolve) => execFile('pkill', ['-9', '-f', foreignProfile], () => resolve()))
  })

  it('four launches from two processes: no more than two Chromes at once, all of them get through', async () => {
    const env = { NOTA_CHROME_MAX: '2' }
    const a = child('many:2:1500', env)
    const b = child('many:2:1500', env)
    let most = 0
    let stop = false
    const watch = (async () => {
      while (!stop) {
        most = Math.max(most, await count(`user-data-dir=${root}/nota-leak-`, true))
        await wait(80)
      }
    })()
    await Promise.all([a.done, b.done])
    stop = true
    await watch
    expect(most).toBeGreaterThan(0)
    expect(most).toBeLessThanOrEqual(2)
    expect(a.lines.filter((l) => l.startsWith('READY'))).toHaveLength(2)
    expect(b.lines.filter((l) => l.startsWith('READY'))).toHaveLength(2)
    expect(a.lines).toContain('DONE')
    expect(b.lines).toContain('DONE')
  })

  it('the slot of a process killed with kill -9 is free: the next one does not wait for ever', async () => {
    const env = { NOTA_CHROME_MAX: '1' }
    const first = child('wait', env)
    const one = await first.ready
    const second = child('hold:100', env)
    await wait(2500)
    expect(second.lines.some((l) => l.startsWith('READY'))).toBe(false) // it waits for the only slot
    process.kill(first.proc.pid!, 'SIGKILL')
    await exited(first.proc)
    await Promise.race([second.ready, wait(20_000).then(() => Promise.reject(new Error('the second start still waits')))])
    await second.done
    await gone(one.profile)
  })

  it('an empty slot file (the owner was killed before the write) older than a few seconds is free', async () => {
    const slots = join(root, '.nota-chrome-slots')
    mkdirSync(slots, { recursive: true })
    const file = join(slots, '0')
    writeFileSync(file, '')
    const old = new Date(Date.now() - 60_000)
    utimesSync(file, old, old)
    const next = child('hold:100', { NOTA_CHROME_MAX: '1' })
    await Promise.race([next.ready, wait(20_000).then(() => Promise.reject(new Error('an empty slot file holds the start')))])
    await next.done
  })

  it('the root of the temp files is the one of this test', () => {
    expect(tmpRoot()).toBe(root)
  })
})
