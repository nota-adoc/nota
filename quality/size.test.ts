import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { checkBrowserBundle } from './lib/browser.js'

const root = fileURLToPath(new URL('..', import.meta.url))
const core = fileURLToPath(new URL('../packages/core/src/index.ts', import.meta.url))

describe('npm run size', () => {
  it('prints the total as check:browser, layers that sum to 100%, 15+ modules and four host set-ups', async () => {
    // the exit code 0 is checked by execFile (it rejects otherwise); asynchronous, so as not to block the worker
    const { stdout: out } = await promisify(execFile)('npx', ['tsx', 'quality/size.ts'], { cwd: root, encoding: 'utf8' })
    const check = await checkBrowserBundle(core)
    const head = /: ([\d.]+) KB minified \((\d+) bytes\), ([\d.]+) KB gzip/.exec(out)
    expect(head).not.toBeNull()
    expect(Number(head![2])).toBe(check.bytes)
    expect(Number(head![3])).toBeCloseTo(check.gzipKB, 1)

    const total = /\n\s+(\d+) B\s+([\d.]+)%\s+total/.exec(out)
    expect(total).not.toBeNull()
    expect(Number(total![1])).toBe(check.bytes)
    expect(Math.abs(Number(total![2]) - 100)).toBeLessThanOrEqual(1)

    const modules = out.split('Largest modules:')[1]!.split('Set-ups')[0]!
    expect(modules.split('\n').filter((l) => /^\s+\d+ B\s+[\d.]+%\s+\S/.test(l)).length).toBeGreaterThanOrEqual(15)

    const setups = out.split('Set-ups')[1]!.split('\n').filter((l) => /KB gzip\s+\d+ B/.test(l))
    expect(setups).toHaveLength(4)
    const gz = setups.map((l) => Number(/(\d+) B\s/.exec(l)![1]))
    expect(gz[0]!).toBeLessThan(check.gzipKB * 1024)
    expect(gz[0]!).toBeLessThanOrEqual(gz[1]!)
    expect(gz[1]!).toBeLessThanOrEqual(gz[2]!)
  }, 120_000)
})
