// npm run check:browser — bundles each built package (@nota-adoc/core, @nota-adoc/html, @nota-adoc/codemirror,
// @nota-adoc/prosemirror)
// for the browser (esbuild, --platform=browser) and fails on build errors or Node built-in modules or a package
// over its budget; prints the bundle size of each in KB gzip. The size of @nota-adoc/html is without
// @nota-adoc/core; the CodeMirror packages are part of the @nota-adoc/codemirror bundle and the ProseMirror ones of
// the @nota-adoc/prosemirror bundle, as they would be in an application.
import { createRequire } from 'node:module'
import { checkBrowserBundle } from './lib/browser.js'

const require = createRequire(import.meta.url)
let failed = false
/** Budgets in KB gzip (the engine spec). */
const budgets: Record<string, number> = { '@nota-adoc/core': 150, '@nota-adoc/html': 25 }
for (const name of ['@nota-adoc/core', '@nota-adoc/html', '@nota-adoc/codemirror', '@nota-adoc/prosemirror']) {
  const r = await checkBrowserBundle(require.resolve(name), {
    external: name === '@nota-adoc/html' ? ['@nota-adoc/core'] : [],
  })
  for (const e of r.errors) console.error(`error: ${name}: ${e}`)
  for (const m of r.nodeBuiltins) console.error(`error: ${name}: Node built-in module imported: ${m}`)
  if (r.errors.length || r.nodeBuiltins.length) {
    failed = true
    continue
  }
  const budget = budgets[name]
  console.log(
    `${name} browser bundle${name === '@nota-adoc/html' ? ' (without core)' : ''}: ${(r.bytes / 1024).toFixed(1)} KB minified, ${r.gzipKB} KB gzip, no Node built-ins${budget ? ` (at most ${budget} KB)` : ''}`,
  )
  if (budget && r.gzipKB > budget) {
    console.error(`error: ${name}: ${r.gzipKB} KB gzip is over the budget of ${budget} KB`)
    failed = true
  }
}
process.exit(failed ? 1 : 0)
