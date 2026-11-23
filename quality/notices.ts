// Writes THIRD_PARTY_NOTICES.md: every third-party package that ends up in a bundle of the VS Code extension (the host,
// the tab, the library of diagrams) or in the demo page, with its license and the notice from its own license file.
// The set is read from the module graph of esbuild (the same entry points and aliases as packages/vscode/build.mjs
// and demo/vite.config.ts), so a new dependency shows up here by itself.
// Run: `npm run notices` (rewrites the file); `npm run notices -- --check` exits 1 when the file is out of date.
import { build, type BuildOptions } from 'esbuild'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const at = (path: string) => join(root, path)
const out = at('THIRD_PARTY_NOTICES.md')

const alias = {
  '@nota-adoc/core/internal': at('packages/core/src/internal.ts'),
  '@nota-adoc/core': at('packages/core/src/index.ts'),
  '@nota-adoc/prosemirror': at('packages/prosemirror/src/index.ts'),
  '@nota-adoc/codemirror': at('packages/codemirror/src/index.ts'),
  '@nota-adoc/react': at('packages/react/src/index.ts'),
}
const common: BuildOptions = {
  bundle: true,
  write: false,
  metafile: true,
  logLevel: 'silent',
  outdir: '/nowhere',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  loader: { '.css': 'empty' },
  alias,
}
const entries: BuildOptions[] = [
  { ...common, entryPoints: [at('packages/vscode/src/host/extension.ts')], platform: 'node', format: 'cjs', external: ['vscode'] },
  { ...common, entryPoints: [at('packages/vscode/src/webview/main.ts')], platform: 'browser', format: 'iife' },
  { ...common, entryPoints: [at('packages/vscode/src/webview/mermaid-entry.ts')], platform: 'browser', format: 'iife' },
  { ...common, entryPoints: [at('demo/src/main.ts')], platform: 'browser', format: 'esm', external: ['*?raw'] },
]

type Pkg = { name: string; version: string; license: string; dir: string; text?: string }

function packageOf(file: string): Pkg | null {
  const parts = file.split('/')
  const i = parts.lastIndexOf('node_modules')
  if (i < 0) return null
  const len = parts[i + 1]!.startsWith('@') ? 2 : 1
  const dir = join(root, ...parts.slice(0, i + 1 + len))
  const json = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
    name: string
    version: string
    license?: string
    licenses?: { type: string }[]
  }
  const license = json.license ?? json.licenses?.map((l) => l.type).join(' OR ') ?? (/^\W*The MIT License/i.test(licenseText(dir)) ? 'MIT' : 'UNKNOWN')
  return { name: json.name, version: json.version, license, dir }
}

function licenseText(dir: string): string {
  const names = readdirSync(dir)
  const file = names.find((f) => /^(licen[sc]e|copying|notice)(\.(md|txt))?$/i.test(f))
  if (file) return readFileSync(join(dir, file), 'utf8').replace(/\r\n/g, '\n').trim()
  // no license file: the License section of the readme
  const readme = names.find((f) => /^readme(\.md)?$/i.test(f))
  if (!readme) return ''
  const text = readFileSync(join(dir, readme), 'utf8').replace(/\r\n/g, '\n')
  return /^#+\s*licen[sc]e\s*$([\s\S]*?)(?=^#+\s|(?![\s\S]))/im.exec(text)?.[1]?.trim() ?? ''
}

const packages = new Map<string, Pkg>()
// What the prebuilt files of the packages carry inside themselves, found by reading those files: the `// …/node_modules/.pnpm/<name>@<version>/…`
// headers of esbuild bundles and the `webpack://…/node_modules/<name>/…` sources of their source maps (no version there).
const carried = new Map<string, string>()
const PNPM = /^\/\/ [^\n]*?node_modules\/\.pnpm\/((?:@[^+/]+\+)?[^@/]+)@([^/_]+)[^\n]*$/gm
const WEBPACK = /webpack:\/\/[^"]*?node_modules\/((?:@[^/"]+\/)?[^/"]+)\//g
function scanCarried(file: string, owner: string): void {
  const note = (name: string, version: string): void => {
    if (name !== owner) carried.set(`${name}@${version}`, file)
  }
  const code = readFileSync(file, 'utf8')
  for (const m of code.matchAll(PNPM)) note(m[1]!.replace('+', '/'), m[2]!)
  if (!existsSync(`${file}.map`)) return
  for (const m of readFileSync(`${file}.map`, 'utf8').matchAll(WEBPACK)) note(m[1]!, '*')
}
for (const options of entries) {
  const result = await build(options)
  for (const input of Object.keys(result.metafile!.inputs)) {
    const p = packageOf(input)
    if (!p) continue
    packages.set(`${p.name}@${p.version}`, p)
    if (/\.m?js$/.test(input) && existsSync(at(input))) scanCarried(at(input), p.name)
  }
}

// Packages that the prebuilt chunks of `@mermaid-js/parser` carry inside themselves (langium, chevrotain and the language-server
// protocol packages): esbuild sees them as one file of the parser, so the module graph does not list them. Their licenses are taken
// from the published packages and kept in quality/inlined-licenses.json.
for (const p of JSON.parse(readFileSync(at('quality/inlined-licenses.json'), 'utf8')) as Omit<Pkg, 'dir'>[]) packages.set(`${p.name}@${p.version}`, { ...p, dir: '' })

// A package found inside a prebuilt file must be listed (the module graph cannot see it); a version-less find (`*`) needs any version.
const missing = [...carried].filter(([key]) => {
  const [name, version] = [key.slice(0, key.lastIndexOf('@')), key.slice(key.lastIndexOf('@') + 1)]
  return ![...packages.values()].some((p) => p.name === name && (version === '*' || p.version === version))
})
if (missing.length) {
  console.error('Packages inside the bundles are not in the notices (add them to quality/inlined-licenses.json):')
  for (const [key, file] of missing) console.error(`  ${key}  (in ${file.slice(root.length)})`)
  process.exit(1)
}

const sorted = [...packages.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version))
const lines: string[] = [
  '# Third-party notices',
  '',
  'The VS Code extension and the demo page bundle the third-party packages listed below. Each is distributed under',
  'its own license; the license text is reproduced as the package ships it. This file is generated by `npm run notices`.',
  '',
  ...sorted.map((p) => `- ${p.name} ${p.version} — ${p.license}`),
  '',
]
for (const p of sorted) {
  const text = p.text ?? licenseText(p.dir)
  lines.push('---', '', `## ${p.name} ${p.version}`, '', `License: ${p.license}`, '')
  lines.push(text ? ['```text', text, '```'].join('\n') : `The package ships no license file; it is released under ${p.license}.`, '')
}
const content = lines.join('\n')

if (process.argv.includes('--check')) {
  const current = existsSync(out) ? readFileSync(out, 'utf8') : ''
  if (current !== content) {
    console.error('THIRD_PARTY_NOTICES.md is out of date: run `npm run notices`')
    process.exit(1)
  }
  console.log(`THIRD_PARTY_NOTICES.md is up to date (${sorted.length} packages)`)
} else {
  writeFileSync(out, content)
  console.log(`THIRD_PARTY_NOTICES.md: ${sorted.length} packages`)
}
