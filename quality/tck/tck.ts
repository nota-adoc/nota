// npm run tck: the Eclipse AsciiDoc TCK at the pinned commit, run with the adapter of nota.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { repoRoot } from '../corpus/corpus.js'
import registry from '../reference/known-differences.json' with { type: 'json' }

export const tckDir = join(repoRoot, '.tck')
export const pin = JSON.parse(readFileSync(join(repoRoot, 'quality/tck/pin.json'), 'utf8')) as {
  repo: string
  commit: string
  ref: string
  license: string
}

function git(cwd: string, args: string[]): void {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${(r.stderr || r.error?.message || '').trim()}`)
}

/** Fetches the TCK at the pinned commit into `.tck/` (once). Throws when there is no network and no earlier fetch. */
export function fetchTck(log: (s: string) => void = console.log): void {
  const marker = join(tckDir, '.nota-commit')
  if (existsSync(marker) && readFileSync(marker, 'utf8').trim() === pin.commit) return
  log(`tck: fetching ${pin.repo} @ ${pin.commit.slice(0, 12)} (${pin.license}) into .tck/`)
  rmSync(tckDir, { recursive: true, force: true })
  mkdirSync(tckDir, { recursive: true })
  git(tckDir, ['init', '-q'])
  git(tckDir, ['remote', 'add', 'origin', pin.repo])
  git(tckDir, ['fetch', '-q', '--depth', '1', 'origin', pin.commit])
  git(tckDir, ['checkout', '-q', 'FETCH_HEAD'])
  writeFileSync(marker, pin.commit + '\n')
}

/** An entry of quality/reference/known-differences.json with `kind: "tck"`. */
export interface TckKnown {
  id: string
  kind: 'tck'
  /** A regular expression tested against the path of the test, e.g. `tests/block/list/.*`. */
  test: string
  description: string
  link: string
}

export function knownFailures(): TckKnown[] {
  return (registry.differences as unknown as { kind?: string }[]).filter((d) => d.kind === 'tck') as TckKnown[]
}

export interface TckResult {
  passed: number
  /** The failures that no entry of the registry explains: the names of the tests (paths), or the message. */
  failed: string[]
  /** The failures the registry explains, with the id of the entry. */
  known: { test: string; id: string }[]
}

/** The path of the test a failure message names (`… for tests/block/x-input.adoc`). */
export function testOfMessage(message: string): string | null {
  const m = /for (\S+?)-input\.adoc/.exec(message)
  return m ? m[1]! : null
}

/** Sorts the failures into the ones the registry explains and the others. */
export function classify(errors: readonly string[], entries: readonly TckKnown[]): Pick<TckResult, 'failed' | 'known'> {
  const failed: string[] = []
  const known: { test: string; id: string }[] = []
  for (const message of errors) {
    const test = testOfMessage(message)
    const entry = test ? entries.find((e) => new RegExp(e.test).test(test)) : undefined
    if (test && entry) known.push({ test, id: entry.id })
    else failed.push(test ?? message.split('\n')[0]!)
  }
  return { failed, known }
}

/** Runs the TCK with the adapter of Nota (the harness of the TCK calls it once per test). */
export async function runTck(): Promise<TckResult> {
  // the harness runs the command through a shell: a path with a space needs its quotes
  const adapter = `${JSON.stringify(join(repoRoot, 'node_modules/.bin/tsx'))} ${JSON.stringify(join(repoRoot, 'quality/tck/adapter.ts'))}`
  const cwd = process.cwd()
  process.chdir(tckDir)
  try {
    const { default: run } = (await import(pathToFileURL(join(tckDir, 'harness/lib/runner.js')).href)) as {
      default: (config: object) => Promise<{ fail: number; pass: number; errors: string[] }>
    }
    const r = await run({
      adapter: { cli: { command: adapter } },
      testsDir: join(tckDir, 'tests'),
      reporter: false,
    })
    return { passed: r.pass, ...classify(r.errors, knownFailures()) }
  } finally {
    process.chdir(cwd)
  }
}
