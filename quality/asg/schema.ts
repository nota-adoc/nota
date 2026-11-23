// The ASG schema of the Eclipse AsciiDoc language project, at the commit pinned in quality/corpus/sources.json for
// asciidoc-lang, and the check of an ASG against it.
import { execFile, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { Ajv2020 } from 'ajv/dist/2020.js'
import { loadSources, openCorpusDir } from '../corpus/corpus.js'

function git(cwd: string, args: string[]): void {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${(r.stderr || r.error?.message || '').trim()}`)
}

/** The source of the schema in sources.json. */
export function schemaSource() {
  const s = loadSources().find((x) => x.name === 'asciidoc-lang')
  if (!s) throw new Error('quality/corpus/sources.json has no asciidoc-lang')
  return s
}

/**
 * The text of `asg/schema.json` at the pinned commit: fetched once into `.corpus-open/asciidoc-lang-asg` (only that
 * folder, shallow). Throws when there is no network and no earlier fetch.
 */
export function schemaText(): string {
  const s = schemaSource()
  const dir = join(openCorpusDir, 'asciidoc-lang-asg')
  const marker = join(dir, '.nota-commit')
  const file = join(dir, 'asg', 'schema.json')
  if (!schemaFetched()) {
    rmSync(dir, { recursive: true, force: true })
    mkdirSync(dir, { recursive: true })
    git(dir, ['init', '-q'])
    git(dir, ['remote', 'add', 'origin', s.repo])
    git(dir, ['sparse-checkout', 'set', '--no-cone', '/asg/schema.json'])
    git(dir, ['fetch', '-q', '--depth', '1', '--filter=blob:none', 'origin', s.commit])
    git(dir, ['checkout', '-q', 'FETCH_HEAD'])
    writeFileSync(marker, s.commit + '\n')
  }
  return readFileSync(file, 'utf8')
}

function schemaFetched(): boolean {
  const s = schemaSource()
  const dir = join(openCorpusDir, 'asciidoc-lang-asg')
  const marker = join(dir, '.nota-commit')
  return existsSync(marker) && readFileSync(marker, 'utf8').trim() === s.commit && existsSync(join(dir, 'asg', 'schema.json'))
}

const execFileAsync = promisify(execFile)

/**
 * `schemaText`'s fetch, but asynchronous and done once before the workers of vitest start (globalSetup). The
 * synchronous fetch in a worker blocks its event loop for the whole `git fetch` (150 s on a slow network), and the
 * call "onTaskUpdate" of vitest times out after 60 s. Never throws: without network the tests skip the check.
 */
export async function prefetchSchema(): Promise<void> {
  try {
    if (schemaFetched()) return
    const s = schemaSource()
    const dir = join(openCorpusDir, 'asciidoc-lang-asg')
    rmSync(dir, { recursive: true, force: true })
    mkdirSync(dir, { recursive: true })
    const git = (args: string[]) => execFileAsync('git', args, { cwd: dir })
    await git(['init', '-q'])
    await git(['remote', 'add', 'origin', s.repo])
    await git(['sparse-checkout', 'set', '--no-cone', '/asg/schema.json'])
    await git(['fetch', '-q', '--depth', '1', '--filter=blob:none', 'origin', s.commit])
    await git(['checkout', '-q', 'FETCH_HEAD'])
    writeFileSync(join(dir, '.nota-commit'), s.commit + '\n')
  } catch (e) {
    console.warn(`ASG schema not prefetched (no network?): ${(e as Error).message}`)
  }
}

/** The ASG without `range` (the schema knows nothing of it), as JSON data. */
export function withoutRange(asg: unknown): unknown {
  return JSON.parse(JSON.stringify(asg, (k, v) => (k === 'range' ? undefined : v)))
}

let validator: ((data: unknown) => { ok: boolean; errors: string[] }) | null = null

/** Checks an ASG against the schema: `errors` are empty when it is valid. */
export function validateAsg(asg: unknown): { ok: boolean; errors: string[] } {
  if (!validator) {
    // `defaults` is a keyword of the project's own validator (it fills in the defaults); the check needs none
    const ajv = new Ajv2020({ strict: false, allErrors: false, discriminator: true })
    const validate = ajv.compile(JSON.parse(schemaText()))
    validator = (data) => {
      const ok = validate(data) as boolean
      return { ok, errors: ok ? [] : (validate.errors ?? []).map((e) => `${e.instancePath || '/'} ${e.message}`) }
    }
  }
  return validator(withoutRange(asg))
}
