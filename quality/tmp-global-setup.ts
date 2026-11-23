// vitest globalSetup: the temp files of a run go into one folder `nota-vitest-<pid>-*` that is removed at the end, so the
// tests that forget to clean up after themselves (`mkdtempSync(tmpdir(), 'nota-…')`) leave nothing in the temp dir. The workers inherit TMPDIR,
// so every `tmpdir()` of theirs lands here. The real temp dir stays in NOTA_TMP_ROOT: the helper of Chrome keeps its queue and sweeps old
// folders there (`packages/vscode/test/webview/chrome.ts`). The folder has an owner (this pid): when the run is killed, the next run
// removes it at once — the start of every run sweeps the leftovers of the killed ones, with or without Chrome.
// vitest runs this file once for the root and once more for the projects that extend it, in one process and maybe in different instances of
// the module: the state of the run is therefore in `process.env`, a second call takes the same folder and the last teardown removes it.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sweepRoot } from '../packages/vscode/test/webview/sweep.js'

const STATE = 'NOTA_VITEST_RUN'
interface State {
  pid: number
  run: string
  users: number
  tmp?: string
  root?: string
}
const read = (): State | undefined => {
  try {
    const s = JSON.parse(process.env[STATE] ?? '') as State
    return s.pid === process.pid ? s : undefined
  } catch {
    return undefined
  }
}
const write = (s: State): void => {
  process.env[STATE] = JSON.stringify(s)
}
const put = (key: string, value: string | undefined): void => {
  if (value === undefined) delete process.env[key]
  else process.env[key] = value
}

export default async function setup(): Promise<() => void> {
  let state = read()
  if (state) {
    state.users++
    write(state)
  } else {
    const real = process.env.NOTA_TMP_ROOT || tmpdir()
    // the state is written before the first `await`, so that a second call that starts meanwhile takes this folder;
    // the sweep does not touch it: its owner is alive
    const run = mkdtempSync(join(real, `nota-vitest-${process.pid}-`))
    writeFileSync(join(run, '.nota-owner'), String(process.pid))
    state = { pid: process.pid, run, users: 1, tmp: process.env.TMPDIR, root: process.env.NOTA_TMP_ROOT }
    process.env.NOTA_TMP_ROOT = real
    process.env.TMPDIR = run
    write(state)
    try {
      await sweepRoot(real)
    } catch {
      /* a sweep that fails (no `ps`, no rights) is not a failure of the start */
    }
  }
  return () => {
    const s = read()
    if (!s) return
    if (--s.users > 0) return write(s)
    delete process.env[STATE]
    put('TMPDIR', s.tmp)
    put('NOTA_TMP_ROOT', s.root)
    rmSync(s.run, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
}
