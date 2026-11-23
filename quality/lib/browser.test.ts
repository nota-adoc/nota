import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { bundleStats, checkBrowserBundle } from './browser.js'

const src = fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url))

describe('checkBrowserBundle', () => {
  it('bundles the engine for the browser without Node built-ins', async () => {
    const r = await checkBrowserBundle(src)
    expect(r.errors).toEqual([])
    expect(r.nodeBuiltins).toEqual([])
    expect(r.gzipKB).toBeGreaterThan(1)
    expect(r.gzipKB).toBeLessThan(150)
  })

  it('reports a Node built-in import', async () => {
    // this checker itself imports node:module and node:zlib
    const r = await checkBrowserBundle(fileURLToPath(new URL('./browser.ts', import.meta.url)))
    expect(r.nodeBuiltins).toEqual(expect.arrayContaining(['node:module', 'node:zlib']))
  })
})

describe('bundleStats', () => {
  it('measures the same bundle as checkBrowserBundle and splits it by input file', async () => {
    const check = await checkBrowserBundle(src)
    const s = await bundleStats(src)
    expect(s.bytes).toBeGreaterThan(0)
    expect(s.gzipBytes / 1024).toBeGreaterThan(check.gzipKB - 0.1)
    expect(s.gzipBytes / 1024).toBeLessThan(check.gzipKB + 0.1)
    expect(s.bytes / 1024).toBeCloseTo(check.bytes / 1024, 1)
    const sum = Object.values(s.inputs).reduce((a, b) => a + b, 0)
    expect(sum).toBeGreaterThan(0)
    expect(sum).toBeLessThanOrEqual(s.bytes)
  })

  it('a bundle through an entry module of its own is smaller when less is used', async () => {
    const full = await bundleStats(src)
    const only = await bundleStats({ contents: `export { parse } from ${JSON.stringify(src)}`, resolveDir: '.' })
    expect(only.gzipBytes).toBeGreaterThan(0)
    expect(only.gzipBytes).toBeLessThan(full.gzipBytes)
  })
})
