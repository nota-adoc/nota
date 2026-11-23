/** The Ruby Asciidoctor reference: a pinned gem in a Docker image built from quality/reference/ruby. */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { DumpFile } from './format.js'

const dir = fileURLToPath(new URL('./ruby/', import.meta.url))
const FILES = ['Dockerfile', 'Gemfile', 'Gemfile.lock', 'dump.rb']

export class RubyUnavailable extends Error {
  override name = 'RubyUnavailable'
}

export interface DockerOptions {
  /** Docker binary (for tests). */
  docker?: string
}

/** Image tag derived from the reference files, so a change to them builds a new image. */
export function imageTag(): string {
  const h = createHash('sha256')
  for (const f of FILES) h.update(f).update(readFileSync(resolve(dir, f)))
  return `nota-ref-ruby:${h.digest('hex').slice(0, 12)}`
}

function docker(args: string[], opts: DockerOptions & { input?: string; inherit?: boolean } = {}) {
  return spawnSync(opts.docker ?? 'docker', args, {
    encoding: 'utf8',
    input: opts.input,
    maxBuffer: 1 << 30,
    stdio: opts.inherit ? ['ignore', 'inherit', 'inherit'] : ['pipe', 'pipe', 'pipe'],
  })
}

/** Throws RubyUnavailable unless Docker is running. */
export function requireRuby(opts: DockerOptions = {}): void {
  const r = docker(['info', '--format', '{{.ServerVersion}}'], opts)
  if (r.error || r.status !== 0) {
    const why = r.error ? r.error.message : (r.stderr || r.stdout || '').trim().split('\n')[0]
    throw new RubyUnavailable(
      `Ruby reference is unavailable: Docker is not running or not installed (${why}). ` +
        'Start Docker, or compare with Asciidoctor.js only: --only js',
    )
  }
}

export function buildImage(opts: DockerOptions = {}): string {
  requireRuby(opts)
  const tag = imageTag()
  const r = docker(['build', '-t', tag, dir], { ...opts, inherit: true })
  if (r.status !== 0)
    throw new RubyUnavailable(`Ruby reference is unavailable: docker build of ${tag} failed`)
  return tag
}

/** Builds the image if it is missing. */
export function ensureImage(opts: DockerOptions = {}): string {
  requireRuby(opts)
  const tag = imageTag()
  if (docker(['image', 'inspect', tag], opts).status !== 0) buildImage(opts)
  return tag
}

export function rubyVersions(opts: DockerOptions = {}): { asciidoctor: string; ruby: string } {
  const tag = ensureImage(opts)
  const r = docker(['run', '--rm', tag, '--version'], opts)
  if (r.status !== 0) throw new RubyUnavailable(`Ruby reference is unavailable: ${r.stderr.trim()}`)
  return JSON.parse(r.stdout)
}

export interface DumpRubyOptions extends DockerOptions {
  /** Most source bytes per container run (default 8 MiB): the dump of a batch is read as one string. */
  batchBytes?: number
}

const BATCH_BYTES = 8 << 20

/** Splits `files` into runs of at most `limit` source bytes (a file larger than the limit runs alone). */
function batches(root: string, files: string[], limit: number): string[][] {
  const out: string[][] = []
  let cur: string[] = []
  let size = 0
  for (const f of files) {
    let n = 0
    try {
      n = statSync(resolve(root, f)).size
    } catch {
      // the container reports a missing file itself
    }
    if (cur.length > 0 && size + n > limit) {
      out.push(cur)
      cur = []
      size = 0
    }
    cur.push(f)
    size += n
  }
  if (cur.length > 0) out.push(cur)
  return out
}

function dumpBatch(tag: string, root: string, files: string[], opts: DockerOptions): DumpFile[] {
  const r = docker(
    ['run', '--rm', '-i', '--network', 'none', '-v', `${resolve(root)}:/in:ro`, tag, '/in', '-'],
    { ...opts, input: files.join('\n') },
  )
  // the output does not fit in one string or buffer: run the halves separately
  if (r.error && files.length > 1) {
    const mid = files.length >> 1
    return [
      ...dumpBatch(tag, root, files.slice(0, mid), opts),
      ...dumpBatch(tag, root, files.slice(mid), opts),
    ]
  }
  if (r.error) throw new RubyUnavailable(`Ruby reference failed: ${r.error.message}`)
  if (r.status !== 0)
    throw new RubyUnavailable(`Ruby reference failed: ${r.stderr.trim().split('\n').slice(-3).join(' ')}`)
  const out = r.stdout
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as DumpFile)
  if (out.length !== files.length)
    throw new RubyUnavailable(`Ruby reference returned ${out.length} results for ${files.length} files`)
  return out
}

/** Dumps all files, in container runs of bounded size. `files` are relative to `root`. */
export function dumpRuby(root: string, files: string[], opts: DumpRubyOptions = {}): DumpFile[] {
  if (files.length === 0) return []
  const tag = ensureImage(opts)
  const out: DumpFile[] = []
  for (const batch of batches(root, files, opts.batchBytes ?? BATCH_BYTES))
    for (const d of dumpBatch(tag, root, batch, opts)) out.push(d)
  return out
}
