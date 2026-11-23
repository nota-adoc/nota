import { execFile } from 'node:child_process'
import { readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * The sweep of what the killed runs of the tests left: Chromes with a profile `<root>/nota-*` whose parent is
 * PID 1 and that are older than `NOTA_CHROME_STALE_MIN` minutes (120), and the folders `<root>/nota-*` whose owner is dead or
 * (without an owner) that are older than that and that no process uses.
 * No side effects on import (no `afterAll`, no signal handlers): the global setup of vitest imports it in the main process.
 */

/** Root of the temp files that the sweep and the slots share between runs. */
export function tmpRoot(): string {
  return process.env.NOTA_TMP_ROOT || tmpdir()
}

export const staleMinutes = (): number => {
  const n = Number(process.env.NOTA_CHROME_STALE_MIN)
  return process.env.NOTA_CHROME_STALE_MIN !== undefined && process.env.NOTA_CHROME_STALE_MIN !== '' && Number.isFinite(n) ? n : 120
}
export const OWNER = '.nota-owner'
export const SLOTS = '.nota-chrome-slots'

export interface Proc {
  pid: number
  ppid: number
  etime: number // seconds
  command: string
}

function seconds(etime: string): number {
  // [[dd-]hh:]mm:ss
  const [days, rest] = etime.includes('-') ? etime.split('-') : ['0', etime]
  const parts = rest!.split(':').map(Number)
  while (parts.length < 3) parts.unshift(0)
  return Number(days) * 86400 + parts[0]! * 3600 + parts[1]! * 60 + parts[2]!
}
export function parsePs(text: string): Proc[] {
  const list: Proc[] = []
  for (const line of text.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line)
    if (m) list.push({ pid: Number(m[1]), ppid: Number(m[2]), etime: seconds(m[3]!), command: m[4]! })
  }
  return list
}
export const PS = ['-axo', 'pid=,ppid=,etime=,command=']
export const psAsync = (): Promise<Proc[]> =>
  new Promise((resolve) => execFile('ps', PS, { encoding: 'utf8', maxBuffer: 1 << 26 }, (_e, out) => resolve(parsePs(String(out ?? '')))))

export const userDataDir = (command: string): string | undefined => /--user-data-dir=(\S+)/.exec(command)?.[1]

export function kill(pid: number, signal: NodeJS.Signals = 'SIGKILL'): void {
  try {
    process.kill(pid, signal)
  } catch {
    /* gone already */
  }
}
export const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** The processes that belong to the Chrome with this profile or to the tree of `roots`. */
export function tree(list: Proc[], profile: string | undefined, roots: number[]): number[] {
  const found = new Set<number>(roots)
  for (const p of list) if (profile && userDataDir(p.command) === profile) found.add(p.pid)
  for (let grew = true; grew; ) {
    grew = false
    for (const p of list) {
      if (found.has(p.pid) || !found.has(p.ppid)) continue
      found.add(p.pid)
      grew = true
    }
  }
  return [...found]
}

export function removeDir(path: string): void {
  try {
    rmSync(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  } catch {
    /* a folder in the temp dir is not a failure of a test; the next start removes it */
  }
}

/** Waits until the killed processes are gone (a poll, not a fixed pause); after `limit` ms goes on. */
export async function waitGone(pids: number[], limit = 5000, step = 75): Promise<void> {
  const end = Date.now() + limit
  while (pids.some(alive) && Date.now() < end) await new Promise((r) => setTimeout(r, step))
}

/** Removes the orphans of Chrome and the folders of the killed runs in `root` (the temp dir of the machine). */
export async function sweepRoot(root: string): Promise<void> {
  const limit = staleMinutes() * 60
  const list = await psAsync()
  const killed = new Set<number>()
  const profiles = new Set<string>()
  // 1. orphans: a Chrome of the tests (profile in `<root>/nota-*`) whose parent is PID 1
  for (const p of list) {
    const profile = userDataDir(p.command)
    if (p.ppid !== 1 || p.pid === process.pid || !profile || !profile.startsWith(join(root, 'nota-')) || p.etime <= limit) continue
    for (const pid of tree(list, profile, [p.pid])) {
      kill(pid)
      killed.add(pid)
    }
    profiles.add(profile)
  }
  if (killed.size) await waitGone([...killed])
  // the profile of a killed orphan goes in the same pass, whatever its age or owner is (nothing writes into it any more)
  for (const profile of profiles) removeDir(profile)
  // 2. folders
  const now = Date.now()
  const used = (await psAsync()).map((p) => p.command)
  let names: string[] = []
  try {
    names = readdirSync(root)
  } catch {
    /* no temp dir */
  }
  for (const name of names) {
    if (!name.startsWith('nota-') || name === SLOTS) continue
    const dir = join(root, name)
    try {
      if (!statSync(dir).isDirectory()) continue
      let ownerPid: number | undefined
      try {
        ownerPid = Number(readFileSync(join(dir, OWNER), 'utf8').trim()) || undefined
      } catch {
        /* no owner */
      }
      if (ownerPid !== undefined) {
        if (alive(ownerPid)) continue
      } else if (now - statSync(dir).mtimeMs <= limit * 1000) continue
      if (used.some((c) => c.includes(dir))) continue
      removeDir(dir)
    } catch {
      /* it was removed by someone else */
    }
  }
}
