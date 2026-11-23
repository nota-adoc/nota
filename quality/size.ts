// npm run size — what the browser bundle of @nota-adoc/core is made of, and what a host gets
// after tree-shaking in four typical set-ups. Prints only numbers and the names of Nota modules (no document text).
//  1. The bundle is the one `npm run check:browser` builds (same entry, esbuild, minified ESM): its total in KB minified
//     and gzip, then the share of every layer and of the largest modules in the minified bytes (esbuild's metafile).
//     The table part of asg/model.ts (`readTable`) is estimated by the share of its source in the file.
//     The gzip of a layer is the gzip of its modules minified one by one and put together (a bundle cannot be cut).
//  2. Four more bundles, each through an entry module of its own: `parse`; `parse` + `createSession` (as
//     @nota-adoc/codemirror); `parse` + `createSession` + `applyOperation` (as @nota-adoc/prosemirror); `renderHtml`
//     with core. The size is in KB gzip.
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, extname, relative, resolve } from 'node:path'
import { gzipSync } from 'node:zlib'
import { transform } from 'esbuild'
import { bundleStats } from './lib/browser.js'

const require = createRequire(import.meta.url)
const root = resolve(import.meta.dirname, '..')
const coreEntry = require.resolve('@nota-adoc/core')
const coreDir = dirname(coreEntry)
const core = JSON.stringify(coreEntry)
// html is built with core as a host would (one copy): the packages are bundled from the same sources
const alias = {
  '@nota-adoc/core': coreEntry,
  '@nota-adoc/core/internal': resolve(coreDir, `internal${extname(coreEntry)}`),
}
const html = JSON.stringify(require.resolve('@nota-adoc/html'))
const coreRel = relative(root, coreDir) // packages/core/src under tsx, or dist (or node_modules/... for an installed copy)

const LAYERS = [
  'parse/ (blocks, lists, attributes; without tables and inline)',
  'parse/inline/',
  'tables (parse/table + edit/tables + table part of the model)',
  'asg/ (model, ASG, semantics)',
  'edit/ (operations; without tables)',
  'session + changes + incremental',
  '@lezer/common',
  'other',
] as const
type Layer = (typeof LAYERS)[number]

/** The layer of an input file of the bundle (a path relative to the repository root). */
function layerOf(path: string): { layer: Layer; module: string } {
  const p = path.replace(/\\/g, '/')
  if (/node_modules\/@lezer\/common\//.test(p)) return { layer: '@lezer/common', module: '@lezer/common' }
  const i = p.indexOf(`${coreRel}/`)
  if (i < 0) return { layer: 'other', module: p }
  const m = p.slice(i + coreRel.length + 1).replace(/\.[jt]s$/, '')
  if (m === 'parse/table' || m === 'edit/tables') return { layer: LAYERS[2], module: m }
  if (m.startsWith('parse/inline/')) return { layer: LAYERS[1], module: m }
  if (m.startsWith('parse/')) return { layer: LAYERS[0], module: m }
  if (m.startsWith('asg/')) return { layer: LAYERS[3], module: m }
  if (m.startsWith('edit/')) return { layer: LAYERS[4], module: m }
  if (m === 'session' || m === 'changes' || m === 'incremental') return { layer: LAYERS[5], module: m }
  return { layer: 'other', module: m }
}

/** Where the method `readTable` of the model starts and ends in the built file: its share of the file. */
function tableShareOfModel(): number {
  const file = ['asg/model.ts', 'asg/model.js'].map((f) => resolve(coreDir, f)).find((f) => existsSync(f))
  if (!file) return 0
  const text = readFileSync(file, 'utf8')
  const start = text.search(/\n {2,4}(private )?readTable\(/)
  if (start < 0) return 0
  const rest = text.slice(start + 1)
  const next = rest.slice(1).search(/\n {2,4}(private |public )?[A-Za-z_#]\w*\(.*\)(: [^{]+)? \{\n/)
  return (next < 0 ? rest.length : next) / text.length
}

const kb = (n: number): string => (n / 1024).toFixed(1)
const pct = (n: number, total: number): string => ((n / total) * 100).toFixed(1).padStart(5)

// ---- 1. the bundle of check:browser
const main = await bundleStats(coreEntry)
const bytesByLayer = new Map<Layer, number>(LAYERS.map((l) => [l, 0]))
const modules = new Map<string, { layer: Layer; bytes: number }>()
const files: Record<Layer, string[]> = Object.fromEntries(LAYERS.map((l) => [l, [] as string[]])) as Record<
  Layer,
  string[]
>
let counted = 0
for (const [path, bytes] of Object.entries(main.inputs)) {
  const { layer, module } = layerOf(path)
  counted += bytes
  modules.set(module, { layer, bytes: (modules.get(module)?.bytes ?? 0) + bytes })
  bytesByLayer.set(layer, (bytesByLayer.get(layer) ?? 0) + bytes)
  if (layer !== 'other' && layer !== '@lezer/common' && /\.[jt]s$/.test(path))
    files[layer].push(resolve(process.cwd(), path))
  else if (layer === '@lezer/common') files[layer].push(resolve(process.cwd(), path))
}
// what is not in any input (the glue of the bundle) is "other"
const glue = main.bytes - counted
bytesByLayer.set('other', (bytesByLayer.get('other') ?? 0) + glue)

// the table part of the model is moved from asg/ to the tables
const model = modules.get('asg/model')
if (model) {
  const part = Math.round(model.bytes * tableShareOfModel())
  bytesByLayer.set(LAYERS[3], bytesByLayer.get(LAYERS[3])! - part)
  bytesByLayer.set(LAYERS[2], bytesByLayer.get(LAYERS[2])! + part)
  modules.set('asg/model (table part, estimated)', { layer: LAYERS[2], bytes: part })
  modules.set('asg/model', { layer: LAYERS[3], bytes: model.bytes - part })
}

console.log(
  `@nota-adoc/core browser bundle: ${kb(main.bytes)} KB minified (${main.bytes} bytes), ${(Math.round((main.gzipBytes / 1024) * 10) / 10).toFixed(1)} KB gzip (${main.gzipBytes} bytes)`,
)
console.log('\nBy layer (share of the minified bytes; gzip of the layer minified apart):')
for (const layer of LAYERS) {
  const bytes = bytesByLayer.get(layer)!
  let gz = 0
  if (files[layer].length) {
    const parts = await Promise.all(
      files[layer].map(
        async (f) =>
          (
            await transform(readFileSync(f, 'utf8'), {
              minify: true,
              format: 'esm',
              loader: f.endsWith('.ts') ? 'ts' : 'js',
            })
          ).code,
      ),
    )
    gz = gzipSync(parts.join('')).length
  }
  console.log(
    `  ${String(bytes).padStart(7)} B  ${pct(bytes, main.bytes)}%  ${gz ? `${String(gz).padStart(6)} B gzip` : '              '}  ${layer}`,
  )
}
const sum = [...bytesByLayer.values()].reduce((a, b) => a + b, 0)
console.log(`  ${String(sum).padStart(7)} B  ${pct(sum, main.bytes)}%  total`)

console.log('\nLargest modules:')
const top = [...modules.entries()].sort((a, b) => b[1].bytes - a[1].bytes).slice(0, 20)
for (const [name, { bytes }] of top)
  console.log(`  ${String(bytes).padStart(7)} B  ${pct(bytes, main.bytes)}%  ${name}`)

// ---- 2. host set-ups
const scenarios: [string, string, string[]][] = [
  ['parse only', `export { parse } from ${core}`, []],
  ['parse + createSession (as @nota-adoc/codemirror)', `export { parse, createSession } from ${core}`, []],
  [
    'parse + createSession + applyOperation (as @nota-adoc/prosemirror)',
    `export { parse, createSession, applyOperation } from ${core}`,
    [],
  ],
  [
    'parse + renderHtml (html with core)',
    `export { parse } from ${core}\nexport { renderHtml } from ${html}`,
    [],
  ],
]
console.log('\nSet-ups of a host (a bundle through an entry module of its own, KB gzip after tree-shaking):')
for (const [name, contents] of scenarios) {
  const s = await bundleStats({ contents, resolveDir: root }, { alias })
  console.log(
    `  ${(s.gzipBytes / 1024).toFixed(1).padStart(6)} KB gzip  ${String(s.gzipBytes).padStart(7)} B  ${name}`,
  )
}
