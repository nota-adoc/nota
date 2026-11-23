// Builds the extension into dist/: the host (CJS, `vscode` stays outside), the page of a tab (IIFE) and its style sheet.
// The packages of Nota come from their sources by the same aliases as in vitest.config.ts, so no `npm run build` has to come first.
// `--e2e` builds the suites of `npm run test:vscode` and `npm run test:vsix` into dist-e2e/ as well.
import { build } from 'esbuild'
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { URL, fileURLToPath } from 'node:url'

const at = (path) => fileURLToPath(new URL(path, import.meta.url))
const e2e = process.argv.includes('--e2e')

const alias = {
  '@nota-adoc/core/internal': at('../core/src/internal.ts'),
  '@nota-adoc/core': at('../core/src/index.ts'),
  '@nota-adoc/prosemirror': at('../prosemirror/src/index.ts'),
  '@nota-adoc/codemirror': at('../codemirror/src/index.ts'),
  '@nota-adoc/react': at('../react/src/index.ts'),
}

await rm(at('dist'), { recursive: true, force: true })
await mkdir(at('dist'), { recursive: true })

await build({
  entryPoints: [at('src/host/extension.ts')],
  outfile: at('dist/extension.js'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['vscode'],
  // the remarks of the panel «Проблемы» come from the parser of Nota, from its sources
  alias: { '@nota-adoc/core': at('../core/src/index.ts') },
  sourcemap: true,
  logLevel: 'warning',
})
await build({
  entryPoints: [at('src/webview/main.ts')],
  // React draws the toolbar and the windows; the tab is a production build of it
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  outfile: at('dist/webview.js'),
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: 'es2022',
  alias,
  sourcemap: true,
  minify: true,
  logLevel: 'warning',
  // the text of an error of ProseMirror names its guide with an address; the tab names no address
  plugins: [
    {
      name: 'no-guide-links',
      setup(b) {
        b.onLoad({ filter: /prosemirror-[^/]+\/dist\/.*\.js$/ }, async (args) => {
          const { readFile } = await import('node:fs/promises')
          const code = await readFile(args.path, 'utf8')
          return { contents: code.replaceAll('https://prosemirror.net', 'prosemirror.net'), loader: 'js' }
        })
      },
    },
  ],
})
// the library of diagrams: its own file, which the tab loads when it shows its first diagram (a file with no diagrams never pays for it)
await build({
  entryPoints: [at('src/webview/mermaid-entry.ts')],
  define: { 'process.env.NODE_ENV': '"production"' },
  outfile: at('dist/mermaid.js'),
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: 'es2022',
  sourcemap: false,
  minify: true,
  legalComments: 'none',
  logLevel: 'warning',
})
// the style of the tab: the components of @nota-adoc/react first, the layout of the tab after them
await writeFile(at('dist/style.css'), `${await readFile(at('../react/src/style.css'), 'utf8')}\n${await readFile(at('src/webview/style.css'), 'utf8')}`)
// the license and the notices of the bundled packages go into the .vsix from the root of the repository
await copyFile(at('../../LICENSE'), at('LICENSE'))
await copyFile(at('../../THIRD_PARTY_NOTICES.md'), at('THIRD_PARTY_NOTICES.md'))
// the files of dist/ are CommonJS, whatever the package says
await writeFile(at('dist/package.json'), '{ "type": "commonjs" }\n')

if (e2e) {
  await rm(at('dist-e2e'), { recursive: true, force: true })
  await build({
    entryPoints: { run: at('e2e/run.ts'), suite: at('e2e/suite.ts'), install: at('e2e/install.ts'), smoke: at('e2e/smoke.ts') },
    outdir: at('dist-e2e'),
    outExtension: { '.js': '.cjs' },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    external: ['vscode'],
    logLevel: 'warning',
  })
}
