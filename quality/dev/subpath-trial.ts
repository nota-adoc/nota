// A development aid (the proposal of subpaths): what a host would save if a part of core were not in its bundle.
// The parts are cut out of a trial bundle by replacing their modules with stubs (the exports become empty functions);
// nothing in packages/ changes. Prints KB gzip. Usage: tsx quality/dev/subpath-trial.ts
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { gzipSync } from 'node:zlib'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
const entry = require.resolve('@nota-adoc/core')
const src = dirname(entry)
const root = resolve(import.meta.dirname, '../..')

/** Bundles `contents` with the modules `stubbed` (paths relative to core/src) replaced by stubs; gzip bytes. */
async function size(contents: string, stubbed: readonly string[]): Promise<number> {
  const files = new Set(stubbed.map((f) => resolve(src, f)))
  const r = await build({
    stdin: { contents, resolveDir: root, loader: 'js' },
    bundle: true,
    platform: 'browser',
    format: 'esm',
    minify: true,
    write: false,
    logLevel: 'silent',
    plugins: [
      {
        name: 'stub',
        setup(b) {
          b.onLoad({ filter: /\.ts$/ }, (args) => {
            if (!files.has(args.path)) return undefined
            const names = [
              ...readFileSync(args.path, 'utf8').matchAll(
                /^export (?:async )?(?:function|const|class) (\w+)/gm,
              ),
            ]
            return { contents: names.map((m) => `export const ${m[1]} = () => []`).join('\n'), loader: 'js' }
          })
        },
      },
    ],
  })
  return gzipSync(r.outputFiles[0]!.contents).length
}

const core = JSON.stringify(entry)
const SCENARIOS: [string, string][] = [
  ['parse', `export { parse } from ${core}`],
  ['parse + createSession', `export { parse, createSession } from ${core}`],
  ['parse + createSession + applyOperation', `export { parse, createSession, applyOperation } from ${core}`],
]
// the parts that a subpath could leave out
const CUTS: [string, string[]][] = [
  ['nothing cut (as it is)', []],
  [
    'without asg/semantics (outline, footnotes, references, semantic diagnostics) and the model that only it pulls in',
    ['asg/semantics.ts'],
  ],
  [
    'without the whole ASG (asg/semantics, asg/asg, asg/model; operations check themselves by the ASG, so not for them)',
    ['asg/semantics.ts', 'asg/asg.ts', 'asg/model.ts'],
  ],
]
for (const [name, contents] of SCENARIOS) {
  console.log(name)
  const base = await size(contents, [])
  for (const [cut, files] of CUTS) {
    if (name.includes('applyOperation') && files.includes('asg/asg.ts')) continue
    let gz: number
    try {
      gz = await size(contents, files)
    } catch {
      console.log(`  n/a  ${cut} (the host needs it)`)
      continue
    }
    console.log(
      `  ${(gz / 1024).toFixed(1).padStart(6)} KB gzip  (${gz - base >= 0 ? '+' : ''}${gz - base} B)  ${cut}`,
    )
  }
}
