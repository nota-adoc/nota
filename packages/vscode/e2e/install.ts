/**
 * `npm run test:vsix`: checks the file `nota-vscode-<version>.vsix` (that `npm run vsix` made) and its installation.
 *  1. the contents: the list of files is read from the .vsix itself (`unzip -Z1`), not from `vsce ls`; exactly what must be
 *     there, nothing of what must not, at most 6 MB;
 *  2. the installation in a clean VS Code (new `--user-data-dir` and `--extensions-dir`): install, list, install again with
 *     `--force`, a start without the plugin in `extensionDevelopmentPath` (suite `smoke.ts`), uninstall.
 * Every step prints a line; the first failure prints the name of the step and ends with code 1.
 * `NOTA_VSCODE_PATH` names an installed VS Code (its executable) to use instead of the download into `.vscode-test/`;
 * `NOTA_VSIX` names another .vsix to check (to try the check on a damaged file).
 */
import { downloadAndUnzipVSCode, resolveCliArgsFromVSCodeExecutablePath, runTests } from '@vscode/test-electron'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const here = resolve(__dirname, '..')
const pkg = JSON.parse(readFileSync(join(here, 'package.json'), 'utf8')) as { name: string; version: string; publisher: string }
const id = `${pkg.publisher}.${pkg.name}`
const vsix = process.env.NOTA_VSIX ? resolve(process.env.NOTA_VSIX) : join(here, `${pkg.name}-${pkg.version}.vsix`)

const REQUIRED = [
  'extension/package.json',
  'extension/LICENSE.txt',
  'extension/THIRD_PARTY_NOTICES.md',
  'extension/media/icon.png',
  'extension/package.nls.json',
  'extension/package.nls.ru.json',
  'extension/dist/extension.js',
  'extension/dist/webview.js',
  'extension/dist/mermaid.js',
  'extension/dist/style.css',
  'extension/dist/package.json',
  '[Content_Types].xml',
  'extension.vsixmanifest',
]
const README = /^extension\/readme\.md$/i
const FORBIDDEN = /(\.map$|\.ts$|\.tsx$|(^|\/)(src|test|e2e|dist-e2e|docs|node_modules|quality)\/)/
const MAX_BYTES = 6 * 1024 * 1024

class StepError extends Error {}

async function step(name: string, run: () => void | Promise<void>): Promise<void> {
  try {
    await run()
    console.log(`ok: ${name}`)
  } catch (error) {
    console.error(`FAIL: ${name}: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}

function check(ok: boolean, message: string): void {
  if (!ok) throw new StepError(message)
}

/** The names of the files inside the .vsix, as `unzip -Z1` lists them. */
function listVsix(): string[] {
  const r = spawnSync('unzip', ['-Z1', vsix], { encoding: 'utf8' })
  check(r.status === 0, `unzip -Z1 ${vsix} ended with ${r.status}: ${r.stderr || r.error?.message}`)
  return r.stdout.split('\n').filter((l) => l !== '')
}

function contents(): void {
  check(statSync(vsix, { throwIfNoEntry: false })?.isFile() === true, `no file ${vsix} (npm run vsix makes it)`)
  const files = listVsix()
  const missing = REQUIRED.filter((f) => !files.includes(f))
  check(missing.length === 0, `missing in the .vsix: ${missing.join(', ')}`)
  check(files.some((f) => README.test(f)), 'missing in the .vsix: extension/readme.md')
  const extra = files.filter((f) => FORBIDDEN.test(f))
  check(extra.length === 0, `must not be in the .vsix: ${extra.join(', ')}`)
  const other = files.filter((f) => !REQUIRED.includes(f) && !README.test(f))
  check(other.length === 0, `unexpected in the .vsix: ${other.join(', ')}`)
  const size = statSync(vsix).size
  check(size <= MAX_BYTES, `the .vsix is ${size} bytes, more than ${MAX_BYTES}`)
  console.log(`  ${files.length} files, ${size} bytes`)
}

async function main(): Promise<void> {
  await step('contents of the .vsix', contents)

  let executable = ''
  await step('VS Code is at hand', async () => {
    executable = process.env.NOTA_VSCODE_PATH || (await downloadAndUnzipVSCode({ version: 'stable', cachePath: join(here, '.vscode-test') }))
    console.log(`  ${executable}`)
  })

  const base = mkdtempSync(join(tmpdir(), 'nota-vsix-'))
  const userData = join(base, 'user-data')
  const extensions = join(base, 'extensions')
  const [cli, ...cliArgs] = resolveCliArgsFromVSCodeExecutablePath(executable, { reuseMachineInstall: true })
  const code = (...args: string[]): { status: number | null; out: string } => {
    const r = spawnSync(cli!, [...cliArgs, '--user-data-dir', userData, '--extensions-dir', extensions, ...args], {
      encoding: 'utf8',
      shell: process.platform === 'win32',
    })
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`
    return { status: r.status, out: out + (r.error ? String(r.error) : '') }
  }
  const listed = (): string[] =>
    code('--list-extensions', '--show-versions')
      .out.split('\n')
      .map((l) => l.trim())
      .filter((l) => /^[\w.-]+@\d/.test(l))
  const expected = `${id}@${pkg.version}`

  try {
    await step('install-extension', () => {
      const r = code('--install-extension', vsix)
      check(r.status === 0, `code --install-extension ended with ${r.status}: ${r.out}`)
    })
    await step('list-extensions --show-versions: exactly one line', () => {
      const l = listed()
      check(l.length === 1 && l[0] === expected, `expected only ${expected}, got: ${JSON.stringify(l)}`)
    })
    await step('install-extension --force (again)', () => {
      const r = code('--install-extension', vsix, '--force')
      check(r.status === 0, `code --install-extension --force ended with ${r.status}: ${r.out}`)
    })
    await step('list-extensions after the second install: still one line', () => {
      const l = listed()
      check(l.length === 1 && l[0] === expected, `expected only ${expected}, got: ${JSON.stringify(l)}`)
    })
    await step('start of VS Code without the plugin in extensionDevelopmentPath: visual.adoc, nota.visual, extensionPath, no nota.e2e.*', async () => {
      const work = mkdtempSync(join(base, 'work-'))
      copyFileSync(join(here, '../../quality/fixtures/editor/visual.adoc'), join(work, 'visual.adoc'))
      // VS Code runs a suite only in the mode of development of an extension; the path names an empty folder (a stub with no
      // code and no commands), so the only Nota plugin the window can load is the installed one
      const stub = mkdtempSync(join(base, 'stub-'))
      writeFileSync(join(stub, 'package.json'), JSON.stringify({ name: 'nota-vsix-stub', publisher: 'nota-local-test', version: '0.0.0', engines: { vscode: '^1.90.0' } }))
      await runTests({
        vscodeExecutablePath: executable,
        extensionDevelopmentPath: stub,
        extensionTestsPath: join(here, 'dist-e2e/smoke.cjs'),
        extensionTestsEnv: { NOTA_SMOKE_WORK: work, NOTA_SMOKE_EXTENSIONS: realpathSync(extensions), NOTA_SMOKE_ID: id },
        launchArgs: [work, '--user-data-dir', userData, '--extensions-dir', extensions],
        reuseMachineInstall: true,
      })
    })
    await step('uninstall-extension', () => {
      const r = code('--uninstall-extension', id)
      check(r.status === 0, `code --uninstall-extension ended with ${r.status}: ${r.out}`)
      const l = listed()
      check(l.length === 0, `the list must be empty, got: ${JSON.stringify(l)}`)
    })
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
  console.log('test:vsix: all steps passed')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
