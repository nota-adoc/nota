import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { trace } from './chrome.js'

/**
 * The real bundle of the tab, as `build.mjs` makes it, for the tests that run it in a real Chrome. One build per run of vitest, not one
 * per file: the first file that needs it builds it into the folder of the run (`nota-vitest-<pid>-*`, which `quality/tmp-global-setup.ts`
 * makes and removes; the workers get it as their `tmpdir()`), the others wait for that file and read it. esbuild runs in a process of its
 * own and asynchronously: it does not start in the jsdom of the test, and the worker's event loop stays free while it works.
 * Outside a run of vitest (no such folder) every process builds its own copy, once.
 */
const here = import.meta.dirname
const at = (path: string): string => join(here, path)

let own: Promise<string> | undefined

/** esbuild with the parameters of `build.mjs` for the page of the tab: the text of the bundle goes to `outfile`. */
function build(outfile: string): Promise<void> {
  const alias = {
    '@nota-adoc/core/internal': at('../../../core/src/internal.ts'),
    '@nota-adoc/core': at('../../../core/src/index.ts'),
    '@nota-adoc/prosemirror': at('../../../prosemirror/src/index.ts'),
    '@nota-adoc/codemirror': at('../../../codemirror/src/index.ts'),
    '@nota-adoc/react': at('../../../react/src/index.ts'),
  }
  const script = `import { build } from 'esbuild'
await build({ entryPoints: [${JSON.stringify(at('../../src/webview/main.ts'))}], jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' },
  outfile: ${JSON.stringify(outfile)}, bundle: true, platform: 'browser', format: 'iife', target: 'es2022', alias: ${JSON.stringify(alias)}, logLevel: 'error' })`
  return new Promise((resolve, reject) => {
    execFile(process.execPath, ['--input-type=module', '-e', script], { cwd: at('../..'), maxBuffer: 1 << 24 }, (error, _stdout, stderr) => {
      if (error) reject(new Error(`esbuild of the bundle of the tab failed: ${stderr || error.message}`, { cause: error }))
      else resolve()
    })
  })
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function make(): Promise<string> {
  const started = Date.now()
  const inRun = Boolean(process.env.NOTA_VITEST_RUN)
  const dir = mkdtempSync(join(tmpdir(), 'nota-bundle-'))
  try {
    if (!inRun) {
      await build(join(dir, 'webview.js'))
      return readFileSync(join(dir, 'webview.js'), 'utf8')
    }
    const shared = join(tmpdir(), 'nota-tab-bundle')
    const done = join(shared, 'webview.js')
    const lock = join(shared, 'building')
    mkdirSync(shared, { recursive: true })
    for (let waited = 0; ; waited += 100) {
      if (existsSync(done)) {
        const text = readFileSync(done, 'utf8')
        trace('bundle', started, { shared: true })
        return text
      }
      let mine = false
      try {
        mkdirSync(lock) // atomic: the one that makes the folder builds
        mine = true
      } catch {
        // someone is building; a lock older than two minutes is of a worker that died: it is taken over
        try {
          if (Date.now() - statSync(lock).mtimeMs > 120_000) rmSync(lock, { recursive: true, force: true })
        } catch {
          /* gone */
        }
      }
      if (mine) {
        try {
          await build(join(dir, 'webview.js'))
          renameSync(join(dir, 'webview.js'), done) // the file appears whole
        } finally {
          rmSync(lock, { recursive: true, force: true })
        }
        const text = readFileSync(done, 'utf8')
        trace('bundle', started, { shared: false })
        return text
      }
      if (waited > 300_000) throw new Error('the bundle of the tab was not built in 5 minutes')
      await sleep(100)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** The text of the bundle of the tab (`webview.js`). */
export function tabBundle(): Promise<string> {
  return (own ??= make().catch((error) => {
    own = undefined
    throw error
  }))
}
