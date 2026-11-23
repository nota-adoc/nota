// A development aid: the whole HTML of files, Ruby Asciidoctor against nota. Usage: tsx quality/dev/html-diff.ts <files…>
import '../lib/guard.js'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse } from '../../packages/core/src/index.js'
import { renderHtml } from '../../packages/html/src/index.js'
import { imageTag } from '../reference/ruby.js'

const SCRIPT = `
require 'json'; require 'asciidoctor'
files = JSON.parse(File.read('/in/files.json'))
out = files.map do |f|
  begin
    Asciidoctor.convert File.binread("/in/#{f}").force_encoding('UTF-8'), safe: :secure, logger: Logger.new(IO::NULL)
  rescue => e
    "ERR #{e.class}: #{e.message}"
  end
end
puts JSON.generate(out)
`

export function rubyFiles(dir: string, names: string[]): string[] {
  writeFileSync(join(dir, 'files.json'), JSON.stringify(names))
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

function firstDiff(a: string, b: string): string {
  const al = a.split('\n')
  const bl = b.split('\n')
  for (let i = 0; i < Math.max(al.length, bl.length); i++)
    if (al[i] !== bl[i])
      return `line ${i + 1}\n  ruby: ${al[i]}\n  nota: ${bl[i]}\n  ctx: ${JSON.stringify(al.slice(Math.max(0, i - 2), i + 3))}`
  return ''
}

if (process.argv[1]?.endsWith('html-diff.ts')) {
  const files = process.argv.slice(2)
  const dir = mkdtempSync(join(tmpdir(), 'html-diff-'))
  const names = files.map((f, i) => {
    const n = `f${i}.adoc`
    writeFileSync(join(dir, n), readFileSync(f))
    return n
  })
  const ruby = rubyFiles(dir, names)
  let bad = 0
  files.forEach((f, i) => {
    let mine: string
    try {
      mine = renderHtml(parse(readFileSync(f, 'utf8')))
    } catch (e) {
      mine = `THROW ${e instanceof Error ? e.stack : e}`
    }
    if (mine !== ruby[i]) {
      bad++
      console.log(`--- ${f}: ${firstDiff(ruby[i]!, mine)}`)
    }
  })
  console.log(`${files.length} files, ${bad} differ`)
}
