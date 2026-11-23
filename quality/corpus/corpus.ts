import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from '@nota-adoc/core'
import { checkEditorText } from '../lib/editor-check.js'
import { checkLossless } from '../lib/invariants.js'
import { type Registry, formatReport, toJson } from '../reference/compare.js'
import { RubyUnavailable } from '../reference/ruby.js'
import { InputError, listAdoc, runCompare } from '../reference/run.js'

export const repoRoot = fileURLToPath(new URL('../../', import.meta.url))
export const openCorpusDir = join(repoRoot, '.corpus-open')
export const reportsDir = join(repoRoot, '.quality-reports')

import { readSource } from '../lib/read-source.js'

export { readSource }

// ------------------------------------------------------------------ fetch

export interface Source {
  name: string
  repo: string
  commit: string
  ref?: string
  paths: string[]
  license: string
}

export function loadSources(): Source[] {
  return (
    JSON.parse(readFileSync(join(repoRoot, 'quality/corpus/sources.json'), 'utf8')) as { sources: Source[] }
  ).sources
}

function git(cwd: string, args: string[]): void {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  if (r.status !== 0)
    throw new Error(`git ${args.join(' ')} failed: ${(r.stderr || r.error?.message || '').trim()}`)
}

/** Sparse, shallow checkout of each source at its pinned commit into .corpus-open/<name>. */
export function fetchCorpus(log: (s: string) => void = console.log): void {
  mkdirSync(openCorpusDir, { recursive: true })
  for (const s of loadSources()) {
    const dir = join(openCorpusDir, s.name)
    const marker = join(dir, '.nota-commit')
    if (existsSync(marker) && readFileSync(marker, 'utf8').trim() === s.commit) {
      log(`${s.name}: ${s.commit.slice(0, 12)} already fetched`)
      continue
    }
    rmSync(dir, { recursive: true, force: true })
    mkdirSync(dir, { recursive: true })
    git(dir, ['init', '-q'])
    git(dir, ['remote', 'add', 'origin', s.repo])
    git(dir, ['sparse-checkout', 'set', '--no-cone', ...s.paths.map((p) => `/${p}/`)])
    git(dir, ['fetch', '-q', '--depth', '1', '--filter=blob:none', 'origin', s.commit])
    git(dir, ['checkout', '-q', 'FETCH_HEAD'])
    writeFileSync(marker, s.commit + '\n')
    log(
      `${s.name}: ${s.repo} @ ${s.commit.slice(0, 12)} (${s.ref ?? ''}, ${s.license}) — ${listAdoc(dir).length} .adoc files`,
    )
  }
}

// ------------------------------------------------------------------ identity

export interface IdentityResult {
  total: number
  lossless: number
  failures: { file: string; problems: string[] }[]
}

export function runIdentity(dir: string): IdentityResult {
  const files = listAdoc(dir)
  if (files.length === 0) throw new InputError('no .adoc files in the input directory')
  const failures: IdentityResult['failures'] = []
  for (const file of files) {
    let problems: string[]
    try {
      const text = readSource(join(dir, file))
      problems = checkLossless(text, parse)
    } catch (e) {
      problems = [`cannot read: ${e instanceof Error ? e.message : String(e)}`]
    }
    if (problems.length) failures.push({ file, problems })
  }
  return { total: files.length, lossless: files.length - failures.length, failures }
}

export function formatIdentity(r: IdentityResult, opts: { aggregate: boolean }): string {
  const lines = [`identity: ${r.lossless} of ${r.total} files lossless, ${r.failures.length} errors`]
  if (!opts.aggregate) for (const f of r.failures) lines.push(`  ${f.file}: ${f.problems.join('; ')}`)
  return lines.join('\n') + '\n'
}

export function identityJson(r: IdentityResult, opts: { aggregate: boolean }): string {
  return JSON.stringify(
    opts.aggregate ? { total: r.total, lossless: r.lossless, errors: r.failures.length } : r,
    null,
    2,
  )
}

// ------------------------------------------------------------------ editor

export interface EditorResult {
  seed: number
  total: number
  edits: number
  failures: { file: string; problems: string[] }[]
}

/** A number from a name, so that every file gets its own random edits from one seed. */
function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0
  return h
}

/**
 * The tree of the editor state equals the tree of Nota after opening each file and after `edits` random edits,
 * and the highlighted ranges are ranges of nodes of the table (see quality/lib/editor-check.ts).
 */
export function runEditor(dir: string, opts: { seed?: number; edits?: number } = {}): EditorResult {
  const files = listAdoc(dir)
  if (files.length === 0) throw new InputError('no .adoc files in the input directory')
  const seed = opts.seed ?? Math.floor(Math.random() * 2 ** 31)
  const failures: EditorResult['failures'] = []
  let edits = 0
  for (const file of files) {
    let problems: string[]
    try {
      const r = checkEditorText(readSource(join(dir, file)), (seed ^ hash(file)) >>> 0, opts.edits ?? 20)
      edits += r.edits
      problems = r.problems
    } catch (e) {
      problems = [`cannot check: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`]
    }
    if (problems.length) failures.push({ file, problems })
  }
  return { seed, total: files.length, edits, failures }
}

export function formatEditor(r: EditorResult, opts: { aggregate: boolean }): string {
  const lines = [
    `seed: ${r.seed}`,
    `editor: файлов: ${r.total}, правок: ${r.edits}, расхождений: ${r.failures.length}`,
  ]
  if (!opts.aggregate) for (const f of r.failures) lines.push(`  ${f.file}: ${f.problems.join('; ')}`)
  return lines.join('\n') + '\n'
}

export function editorJson(r: EditorResult, opts: { aggregate: boolean }): string {
  return JSON.stringify(
    opts.aggregate
      ? { seed: r.seed, total: r.total, edits: r.edits, discrepancies: r.failures.length }
      : r,
    null,
    2,
  )
}

// ------------------------------------------------------------------ compare

export interface CorpusCompareOptions {
  dir: string
  only?: 'ruby' | 'js'
  aggregate: boolean
  json: boolean
  reportDir?: string
  registry?: Registry
}

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

export function saveReport(dir: string, name: string, content: string): string {
  mkdirSync(dir, { recursive: true })
  const path = join(dir, `${name}-${stamp()}.json`)
  writeFileSync(path, content)
  return path
}

export async function corpusCompare(
  opts: CorpusCompareOptions,
): Promise<{ output: string; exitCode: number }> {
  try {
    const run = await runCompare({
      dir: resolve(opts.dir),
      only: opts.only,
      registry: opts.registry,
      read: readSource,
    })
    const o = { aggregate: opts.aggregate }
    const json = toJson(run.summary, o)
    const path = saveReport(opts.reportDir ?? reportsDir, 'corpus-compare', json)
    const versions = Object.entries(run.versions)
      .map(([k, v]) => `${k === 'ruby' ? 'Ruby Asciidoctor' : 'Asciidoctor.js'} ${v}`)
      .join(', ')
    const output = opts.json
      ? json + '\n'
      : `references: ${versions}\n${formatReport(run.summary, o)}report: ${path}\n`
    return { output, exitCode: run.summary.exitCode }
  } catch (e) {
    if (e instanceof RubyUnavailable) {
      return {
        output: opts.aggregate ? 'Ruby reference is unavailable (use --only js)\n' : e.message + '\n',
        exitCode: 3,
      }
    }
    if (e instanceof InputError) return { output: e.message + '\n', exitCode: 2 }
    if (opts.aggregate) return { output: 'compare failed (details hidden in aggregate mode)\n', exitCode: 1 }
    throw e
  }
}
