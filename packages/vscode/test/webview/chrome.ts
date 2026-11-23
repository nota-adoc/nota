import { execFile, execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { OWNER, PS, SLOTS, kill, parsePs, psAsync, removeDir, sweepRoot, tmpRoot, tree, alive, type Proc } from './sweep.js'

/**
 * The one way the tests start Chrome. What it guarantees:
 *  - every Chrome gets a profile `nota-<prefix>-*` in the temp dir and is tied to its parent by `--remote-debugging-pipe`
 *    (fd 3 and 4 are pipes of the parent): when the parent dies, even from `kill -9`, the pipe closes and Chrome exits itself;
 *  - Chrome and its profile are closed in `close()`, on a failure or a timeout of `withChrome`, in `afterAll` of the file,
 *    and on `SIGTERM`, `SIGINT` and `exit` of the process (the signal is sent again after that, the exit code stays);
 *  - the first launch of a process removes what the killed runs left: Chromes with a profile `<tmp>/nota-*` whose parent is
 *    PID 1 and that are older than `NOTA_CHROME_STALE_MIN` minutes (120), and the folders `<tmp>/nota-*` whose owner is dead
 *    or (without an owner) that are older than that and that no process uses;
 *  - at most `NOTA_CHROME_MAX` Chromes (2) run at once on the machine: the processes share the slots in `<tmp>/.nota-chrome-slots`.
 *    The slot of a dead process is free.
 * The temp dir is `NOTA_TMP_ROOT` if it is set (the global setup of vitest moves `TMPDIR` into a folder of the run and keeps the
 * real one there), else `os.tmpdir()`.
 */

/**
 * A line of the log of the phases of the Chrome tests, when `NOTA_CHROME_TRACE=<file>` is set (off otherwise, nothing is written):
 * `{ file, phase, ms, ... }`, where `phase` is `bundle` (the build of the bundle of the tab), `queue` (the wait for a slot of Chrome),
 * `chrome` (from the start of the process to the end of the work: the launch and the work of the page) or `close`. `since` is the
 * `Date.now()` of the start of the phase.
 */
let testPath: () => string | undefined = () => undefined
export function trace(phase: string, since: number, extra: Record<string, unknown> = {}): void {
  const out = process.env.NOTA_CHROME_TRACE
  if (!out) return
  try {
    appendFileSync(out, JSON.stringify({ file: testPath()?.split('/').pop(), phase, ms: Date.now() - since, ...extra }) + '\n')
  } catch {
    /* the log is a help, not a part of a test */
  }
}

// the sweep itself lives in `sweep.ts` (no side effects: the global setup of vitest uses it too)
export { tmpRoot }

/** How long a file waits for a slot of Chrome, ms: the default of `queueTimeout` and the timeout of the hook that takes a lease. */
export const CHROME_QUEUE_MS = 25 * 60_000

const maxChromes = (): number => Math.max(1, Number(process.env.NOTA_CHROME_MAX) || 2)

export interface ChromeOptions {
  /** The binary of Chrome. */
  chrome: string
  /** The profile is `<tmp>/nota-<prefix>-*`. */
  prefix: string
  /** Arguments of Chrome; `--user-data-dir` is added by the helper (and an own one is replaced). */
  args: string[]
  /**
   * Tie Chrome to the parent by the pipe (default). `false` for `--dump-dom`: with the pipe Chrome does not exit after the dump,
   * so a watchdog process (it ends when Chrome ends) kills Chrome and removes the profile if the parent dies.
   */
  pipe?: boolean
  /** Give `stdout` of Chrome (for `--dump-dom`); otherwise it is ignored. */
  stdout?: boolean
  /** Give `stderr` of Chrome (the address of DevTools); otherwise it is ignored. */
  stderr?: boolean
  /** How long to wait for a slot, ms (`CHROME_QUEUE_MS` by default). */
  queueTimeout?: number
}

export interface ChromeHandle {
  proc: ChildProcess
  profile: string
  /** `stdout` of Chrome if it was asked for. */
  out: string
  /** `stderr` of Chrome if it was asked for. */
  err: string
  /** Closes Chrome with its children, deletes the profile, frees the slot. Safe to call twice. */
  close(): Promise<void>
}

interface Entry {
  /** `Date.now()` of the start of the process (for the log of the phases). */
  spawned: number
  prefix: string
  proc: ChildProcess
  profile: string
  slot: string
  watchdog?: ChildProcess
  closing?: Promise<void>
}
const open = new Set<Entry>()

/**
 * A slot that a file took for itself (`holdChromeSlot`): its Chromes, one after another, run in it, and no test of the file waits
 * in the queue of the machine, where the time of a test is the time of the others. `busy`: a Chrome of this process is in it now.
 */
let lease: { slot: string; busy: boolean } | undefined

const psSync = (): Proc[] => {
  try {
    return parsePs(execFileSync('ps', PS, { encoding: 'utf8', maxBuffer: 1 << 26 }))
  } catch {
    return []
  }
}
/** Everything about one Chrome, synchronously: for `exit` and the signals. */
function dropLease(): void {
  if (!lease) return
  try {
    unlinkSync(lease.slot)
  } catch {
    /* not ours any more */
  }
  lease = undefined
}

function killNow(e: Entry): void {
  if (e.watchdog?.pid) kill(e.watchdog.pid)
  if (e.proc.pid) for (const pid of tree(psSync(), e.profile, [e.proc.pid])) kill(pid)
  removeDir(e.profile)
  if (lease?.slot === e.slot) lease.busy = false
  else
    try {
      unlinkSync(e.slot)
    } catch {
      /* not ours any more */
    }
  open.delete(e)
}

/** The watchdog: waits for the parent or Chrome to end; if the parent is first, kills Chrome (by the profile) and removes the profile. */
const WATCHDOG = `
const { execFileSync } = require('node:child_process')
const { rmSync } = require('node:fs')
const [parent, chrome, profile] = process.argv.slice(1)
const alive = (pid) => { try { process.kill(Number(pid), 0); return true } catch (e) { return e.code === 'EPERM' } }
const timer = setInterval(() => {
  if (alive(parent) && alive(chrome)) return
  clearInterval(timer)
  if (alive(parent)) process.exit(0) // Chrome ended first: the parent closes the profile
  // a Chrome that has just started still spawns helpers and writes into the profile: kill and remove again until the folder is gone
  for (let i = 0; i < 20; i++) {
    try {
      const list = execFileSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8', maxBuffer: 1 << 26 }).split('\\n')
      for (const line of list) {
        const m = /^\\s*(\\d+)\\s+(.*)$/.exec(line)
        if (m && (m[1] === chrome || m[2].includes('--user-data-dir=' + profile + ' ') || m[2].endsWith('--user-data-dir=' + profile))) { try { process.kill(Number(m[1]), 'SIGKILL') } catch {} }
      }
    } catch {}
    try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) } catch {}
    if (!require('node:fs').existsSync(profile)) break
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500)
  }
  process.exit(0)
}, 500)
`

let handlers = false
function onSignal(signal: NodeJS.Signals): void {
  for (const e of [...open]) killNow(e)
  dropLease()
  // the signal goes on: with no other listener the process ends with the same code as without us
  if (process.listenerCount(signal) <= 1) {
    process.removeListener(signal, signalHandlers[signal]!)
    process.kill(process.pid, signal)
  }
}
const signalHandlers: Partial<Record<NodeJS.Signals, () => void>> = {
  SIGTERM: () => onSignal('SIGTERM'),
  SIGINT: () => onSignal('SIGINT'),
}
const onExit = (): void => {
  for (const e of [...open]) killNow(e)
  dropLease()
}
function installHandlers(): void {
  if (handlers) return
  handlers = true
  process.on('exit', onExit)
  for (const [s, h] of Object.entries(signalHandlers)) process.on(s as NodeJS.Signals, h!)
}
function uninstallHandlers(): void {
  if (!handlers || open.size || lease) return
  handlers = false
  process.removeListener('exit', onExit)
  for (const [s, h] of Object.entries(signalHandlers)) process.removeListener(s as NodeJS.Signals, h!)
}

/** The file with the owner (pid and a nonce) of a slot or a folder. */
const ownerText = (): string => `${process.pid}`

let swept: Promise<void> | undefined
/** Removes what the killed runs left. Once per process. */
export function sweepStale(force = false): Promise<void> {
  return force ? sweepRoot(tmpRoot()) : (swept ??= sweepRoot(tmpRoot()))
}
/** A free slot; the file holds the pid of the owner. Waits (polling, the event loop stays free). */
async function takeSlot(timeout: number): Promise<string> {
  const dir = join(tmpRoot(), SLOTS)
  mkdirSync(dir, { recursive: true })
  const limit = maxChromes()
  const deadline = Date.now() + timeout
  for (;;) {
    for (let i = 0; i < limit; i++) {
      const file = join(dir, String(i))
      const mine = `${process.pid}:${Math.random().toString(36).slice(2)}`
      try {
        writeFileSync(file, mine, { flag: 'wx' })
        return file
      } catch {
        let text: string
        try {
          text = readFileSync(file, 'utf8')
        } catch {
          continue
        }
        const pid = Number(text.split(':')[0])
        // an empty file: its owner was killed between the creation and the write; after a few seconds it is free as well
        let orphan = false
        if (!text) {
          try {
            orphan = Date.now() - statSync(file).mtimeMs > 5000
          } catch {
            continue
          }
        }
        if ((pid && !alive(pid)) || orphan) {
          // the owner is dead: the slot is free (read again, so that a slot taken by someone else in the meantime stays)
          try {
            if (readFileSync(file, 'utf8') === text) unlinkSync(file)
          } catch {
            /* taken or removed */
          }
          i--
        }
      }
    }
    if (Date.now() > deadline) throw new Error(`Chrome of the tests: no free slot in ${Math.round(timeout / 1000)} s (NOTA_CHROME_MAX=${limit}, ${dir})`)
    await new Promise((r) => setTimeout(r, 150))
  }
}

/**
 * Takes a slot of Chrome for the whole file: the Chromes of the file start in it, one at a time, and the tests do not wait for the machine.
 * The wait is bounded here, by its own `queueTimeout`, and does not count in the time of a test: call it in `beforeAll(…, CHROME_QUEUE_MS + 10_000)`.
 * The slot is given back by `closeAllChromes` (`afterAll` of the file) or when the process ends. A second call changes nothing.
 */
export async function holdChromeSlot(queueTimeout: number = CHROME_QUEUE_MS): Promise<void> {
  if (lease) return
  await sweepStale()
  const queued = Date.now()
  const slot = await takeSlot(queueTimeout)
  trace('queue', queued, { prefix: 'lease' })
  lease = { slot, busy: false }
  installHandlers()
}

/** Starts Chrome (waits for its turn). */
export async function launchChrome(opts: ChromeOptions): Promise<ChromeHandle> {
  await sweepStale()
  const queued = Date.now()
  let slot: string
  if (lease && !lease.busy) {
    // a Chrome of the file runs in the slot it holds; another one at the same time waits for a slot of its own
    lease.busy = true
    slot = lease.slot
  } else slot = await takeSlot(opts.queueTimeout ?? CHROME_QUEUE_MS)
  trace('queue', queued, { prefix: opts.prefix })
  let profile: string | undefined
  try {
    profile = mkdtempSync(join(tmpdir(), `nota-${opts.prefix}-`))
    writeFileSync(join(profile, OWNER), ownerText())
    const args = opts.args.filter((a) => !a.startsWith('--user-data-dir='))
    // the pipe is what ties Chrome to the parent; a test that has no use for it leaves it unread
    const piped = opts.pipe !== false
    if (piped && !args.some((a) => a.startsWith('--remote-debugging-pipe'))) args.unshift('--remote-debugging-pipe')
    const proc = spawn(opts.chrome, [`--user-data-dir=${profile}`, ...args], { stdio: ['ignore', opts.stdout ? 'pipe' : 'ignore', opts.stderr ? 'pipe' : 'ignore', ...(piped ? ['pipe', 'pipe'] as const : [])] })
    const entry: Entry = { spawned: Date.now(), prefix: opts.prefix, proc, profile, slot }
    if (!piped && proc.pid) {
      entry.watchdog = spawn(process.execPath, ['-e', WATCHDOG, String(process.pid), String(proc.pid), profile], { detached: true, stdio: 'ignore' })
      entry.watchdog.on('error', () => {})
      entry.watchdog.unref()
    }
    open.add(entry)
    installHandlers()
    const handle: ChromeHandle = { proc, profile, out: '', err: '', close: () => (entry.closing ??= closeEntry(entry)) }
    if (opts.stdout) {
      proc.stdout!.setEncoding('utf8').on('data', (d: string) => (handle.out += d))
    }
    if (opts.stderr) {
      proc.stderr!.setEncoding('utf8').on('data', (d: string) => (handle.err += d))
    }
    // a pipe that nobody reads does not hold the loop of the worker, and an error of it (EPIPE at the close) is not a failure
    for (const s of [proc.stdio[3], proc.stdio[4]]) s?.on('error', () => {})
    proc.on('error', () => {})
    return handle
  } catch (e) {
    if (profile) removeDir(profile)
    freeSlot(slot)
    throw e
  }
}

/** Gives the slot back: a lease stays with the file, any other slot is freed. */
function freeSlot(slot: string): void {
  if (lease?.slot === slot) {
    lease.busy = false
    return
  }
  try {
    unlinkSync(slot)
  } catch {
    /* gone */
  }
}

async function closeEntry(e: Entry): Promise<void> {
  const { proc } = e
  trace('chrome', e.spawned, { prefix: e.prefix })
  const closing = Date.now()
  try {
    if (proc.exitCode === null && proc.signalCode === null) {
      const exited = new Promise<void>((r) => proc.once('exit', () => r()))
      proc.kill('SIGTERM')
      await Promise.race([exited, new Promise((r) => setTimeout(r, 3000))])
    }
    // what is left (children, a Chrome that did not hear SIGTERM) is killed by the profile
    if (proc.pid) for (const pid of tree(await psAsync(), e.profile, proc.exitCode === null && proc.signalCode === null ? [proc.pid] : [])) kill(pid)
    await new Promise((r) => setTimeout(r, 100))
    if (e.watchdog?.pid) kill(e.watchdog.pid)
    for (const s of [proc.stdio[3], proc.stdio[4]]) (s as { destroy?: () => void } | null)?.destroy?.()
    removeDir(e.profile)
  } finally {
    freeSlot(e.slot)
    open.delete(e)
    uninstallHandlers()
    trace('close', closing, { prefix: e.prefix })
  }
}

/** Closes every Chrome of this process (the `afterAll` of a file). */
export async function closeAllChromes(): Promise<void> {
  await Promise.all([...open].map((e) => (e.closing ??= closeEntry(e))))
  dropLease()
  uninstallHandlers()
}

export interface WithChromeOptions extends ChromeOptions {
  /** The time for `fn` (not for the wait for a slot), ms. */
  timeout?: number
  timeoutMessage?: string
}

/** Runs `fn` with a Chrome and closes the Chrome in every case: a result, an exception, a timeout. */
export async function withChrome<T>(opts: WithChromeOptions, fn: (chrome: ChromeHandle) => Promise<T> | T): Promise<T> {
  const handle = await launchChrome(opts)
  const timeout = opts.timeout ?? 300_000
  let timer: NodeJS.Timeout | undefined
  try {
    const work = Promise.resolve().then(() => fn(handle))
    work.catch(() => {}) // after a timeout its late failure is not an unhandled rejection
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(opts.timeoutMessage ?? `Chrome of the tests: timeout of ${timeout} ms`)), timeout)
      }),
    ])
  } finally {
    clearTimeout(timer)
    await handle.close()
  }
}

/** Runs Chrome with `--dump-dom` and gives the DOM. */
export function chromeDump(chrome: string, args: string[], timeout = 170_000, prefix = 'dump'): Promise<string> {
  return withChrome(
    // the own timer below ends first and still takes a page that Chrome wrote before it was killed (as);
    // the timeout of `withChrome` is only the backstop
    { chrome, prefix, args, stdout: true, pipe: false, timeout: timeout + 10_000, timeoutMessage: `Chrome failed: timeout of ${timeout} ms` },
    (h) =>
      new Promise<string>((resolve, reject) => {
        const done = (): void => {
          // a Chrome that wrote the page before it exited with a code is still taken
          if (h.out.includes('</html>') || h.proc.exitCode === 0) resolve(h.out)
          else reject(new Error(`Chrome failed: exit ${h.proc.exitCode ?? h.proc.signalCode}`))
        }
        if (h.proc.exitCode !== null || h.proc.signalCode !== null) done()
        else h.proc.once('close', done)
        h.proc.once('error', (e) => reject(new Error(`Chrome failed: ${e.message}`, { cause: e })))
        const timer = setTimeout(() => {
          if (h.out.includes('</html>')) resolve(h.out)
          else reject(new Error(`Chrome failed: timeout of ${timeout} ms`))
        }, timeout)
        timer.unref()
        h.proc.once('close', () => clearTimeout(timer))
      }),
  )
}

const versions = new Map<string, Promise<string>>()
/** The version of Chrome for the text of a red test (one per path of the binary). */
export function chromeVersion(chrome: string): Promise<string> {
  let version = versions.get(chrome)
  if (version) return version
  versions.set(chrome, (version = new Promise((resolve) => {
    execFile(chrome, ['--version'], { encoding: 'utf8', timeout: 30_000 }, (_e, stdout) => resolve(String(stdout).trim()))
  })))
  return version
}

// the file of a test closes what it left open (a test without its own `close()` that failed half-way)
if (process.env.VITEST) {
  const { afterAll, expect } = await import('vitest')
  testPath = () => expect.getState().testPath
  try {
    afterAll(closeAllChromes)
  } catch {
    /* not inside a file of tests */
  }
}

/** The binary of Chrome on this machine, if there is one. */
export function findChrome(): string | undefined {
  return [process.env.CHROME_BIN ?? '', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => p && existsSync(p))
}
