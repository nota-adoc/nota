// A development aid: runs snippets of inline markup through Ruby Asciidoctor and through Nota's substitutions
// and prints the ones that differ. Usage: tsx quality/dev/inline-diff.ts [file.json | -] (JSON array of strings)
import '../lib/guard.js'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_ATTRIBUTES } from '../../packages/core/src/index.js'
import { NORMAL_SUBS, substitute } from '../../packages/core/src/parse/inline/index.js'
import { imageTag } from '../reference/ruby.js'

const SCRIPT = `
require 'json'; require 'asciidoctor'
inputs = JSON.parse(File.read('/in/in.json'))
out = inputs.map do |t|
  begin
    doc = Asciidoctor.load t, safe: :secure, attributes: { 'sectids' => nil, 'experimental' => '' }, logger: Logger.new(IO::NULL)
    doc.convert
  rescue => e
    "ERR #{e.class}: #{e.message}"
  end
end
puts JSON.generate(out)
`

export function rubyHtml(inputs: string[]): string[] {
  const dir = mkdtempSync(join(tmpdir(), 'inline-diff-'))
  writeFileSync(join(dir, 'in.json'), JSON.stringify(inputs))
  const r = spawnSync(
    'docker',
    [
      'run',
      '--rm',
      '--entrypoint',
      'bundle',
      '-v',
      `${dir}:/in:ro`,
      imageTag(),
      'exec',
      'ruby',
      '-e',
      SCRIPT,
    ],
    { encoding: 'utf8', maxBuffer: 1 << 30 },
  )
  if (r.status !== 0) throw new Error(r.stderr)
  return JSON.parse(r.stdout) as string[]
}

const attrs = new Map<string, string>(Object.entries(DEFAULT_ATTRIBUTES))
attrs.set('experimental', '')
attrs.delete('sectids')

export function notaHtml(text: string): string {
  const local = new Map(attrs)
  const counters = new Map<string, number>()
  const env = {
    get: (n: string) => local.get(n),
    set: (n: string, v: string | null) => {
      if (v === null) local.delete(n)
      else local.set(n, v)
    },
    counter: (n: string, seed: string | undefined) => {
      const cur = local.get(n)
      let next: string
      if (cur !== undefined && cur !== '') next = String(Number(cur) + 1)
      else next = seed ?? '1'
      local.set(n, next)
      counters.set(n, 1)
      return next
    },
    footnotes: [] as { index: number; id: string | null; text: string }[],
    addFootnote(id: string | null, t: string) {
      this.footnotes.push({ index: this.footnotes.length + 1, id, text: t })
      return this.footnotes.length
    },
    footnote(id: string) {
      return this.footnotes.find((f) => f.id === id)
    },
  }
  const inner = substitute(
    text
      .split('\n')
      .map((l) => l.trimEnd())
      .join('\n'),
    null,
    NORMAL_SUBS,
    env,
  )
  return `<div class="paragraph">\n<p>${inner}</p>\n</div>`
}

function main() {
  const arg = process.argv[2] ?? '-'
  const inputs = JSON.parse(readFileSync(arg === '-' ? 0 : arg, 'utf8')) as string[]
  const ruby = rubyHtml(inputs)
  let bad = 0
  inputs.forEach((t, i) => {
    const mine = notaHtml(t)
    if (mine !== ruby[i]) {
      bad++
      console.log(
        `--- ${JSON.stringify(t)}\n  ruby: ${JSON.stringify(ruby[i])}\n  nota: ${JSON.stringify(mine)}`,
      )
    }
  })
  console.log(`${inputs.length} snippets, ${bad} differ`)
}

if (process.argv[1]?.endsWith('inline-diff.ts')) main()
