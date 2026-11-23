import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from '@nota-adoc/core'
import { type FileResult, type Registry, type Summary, compareFile, summarize } from './compare.js'
import { dumpJs, jsVersion } from './js/dump.js'
import { dumpRuby, rubyVersions } from './ruby.js'
import { notaDump } from './nota-dump.js'

/** The attributes the references are loaded with (dump.rb, js/dump.ts): Nota parses with the same. */
export const REFERENCE_ATTRIBUTES = { sectids: null }

/** Files dumped and compared at a time. */
const CHUNK_FILES = 500

export const registryPath = fileURLToPath(new URL('./known-differences.json', import.meta.url))

export function loadRegistry(path = registryPath): Registry {
  return JSON.parse(readFileSync(path, 'utf8')) as Registry
}

/** The input is not usable: no such directory, no .adoc files. The command reports it and exits with 2. */
export class InputError extends Error {}

/** All regular .adoc files under `dir`, relative to it, sorted; symlinks and dot-directories are skipped. */
export function listAdoc(dir: string): string[] {
  const out: string[] = []
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    )) {
      const p = join(d, e.name)
      if (e.isDirectory() && !e.name.startsWith('.')) walk(p)
      else if (e.isFile() && e.name.endsWith('.adoc')) out.push(relative(dir, p))
    }
  }
  let isDirectory = false
  try {
    isDirectory = statSync(dir).isDirectory()
  } catch {
    // reported below
  }
  if (!isDirectory) throw new InputError('the input directory does not exist or is not a directory')
  walk(dir)
  return out
}

export interface CompareRun {
  summary: Summary
  results: FileResult[]
  versions: { ruby?: string; js?: string }
}

export async function runCompare(opts: {
  dir: string
  files?: string[]
  only?: 'ruby' | 'js'
  registry?: Registry
  read?: (path: string) => string
}): Promise<CompareRun> {
  const read = opts.read ?? ((p: string) => readFileSync(p, 'utf8'))
  const files = opts.files ?? listAdoc(opts.dir)
  if (files.length === 0) throw new InputError('no .adoc files in the input directory')
  const registry = opts.registry ?? loadRegistry()
  const versions: CompareRun['versions'] = {}
  if (opts.only !== 'js') versions.ruby = rubyVersions().asciidoctor
  if (opts.only !== 'ruby') versions.js = await jsVersion()
  // the dumps of a large corpus do not fit in memory together: dump, compare and drop them chunk by chunk
  const results: FileResult[] = []
  for (let from = 0; from < files.length; from += CHUNK_FILES) {
    const chunk = files.slice(from, from + CHUNK_FILES)
    const ruby = opts.only !== 'js' ? dumpRuby(opts.dir, chunk) : undefined
    const js = opts.only !== 'ruby' ? await dumpJs(opts.dir, chunk, read) : undefined
    chunk.forEach((file, i) => {
      const text = read(join(opts.dir, file))
      const nota = notaDump(parse(text, { attributes: REFERENCE_ATTRIBUTES }), file)
      results.push(compareFile({ file, text, nota, refs: { ruby: ruby?.[i], js: js?.[i] } }, registry))
    })
  }
  return { summary: summarize(results), results, versions }
}
