// the built page (`npm run demo:build`) is static and makes no requests. Node, not jsdom: the esbuild of Vite
// does not run in the jsdom environment.
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from 'vite'
import { describe, expect, it } from 'vitest'

const demoDir = join(import.meta.dirname, '..')
const external = /(?:https?:)?\/\/(?!localhost\b|127\.0\.0\.1\b)[\w-]+(?:\.[\w-]+)+/i

describe('demo page: the built page (demo:build)', () => {
  it('is one static page: relative scripts only, and no code in it makes a request or names an address outside localhost', async () => {
    const out = mkdtempSync(join(tmpdir(), 'nota-demo-'))
    try {
      await build({ configFile: join(demoDir, 'vite.config.ts'), logLevel: 'silent', build: { outDir: out, emptyOutDir: true } })
      // one page, and no other: the demo has no second page to link to
      expect(readdirSync(out).filter((f) => f.endsWith('.html'))).toEqual(['index.html'])
      expect(existsSync(join(out, 'visual.html'))).toBe(false)
      // the notices of the bundled third-party packages ship with the page, as the root file has them
      expect(readFileSync(join(out, 'THIRD_PARTY_NOTICES.md'), 'utf8')).toBe(readFileSync(join(demoDir, '..', 'THIRD_PARTY_NOTICES.md'), 'utf8'))
      const html = readFileSync(join(out, 'index.html'), 'utf8')
      const refs = [...html.matchAll(/<(?:script|link|img|iframe|a)\b[^>]*\b(?:src|href)="([^"]*)"/g)].map((m) => m[1]!)
      // the script and the styles of the page are bundled, and they are relative
      expect(refs.some((r) => r.endsWith('.js'))).toBe(true)
      expect(refs.some((r) => r.endsWith('.css'))).toBe(true)
      for (const ref of refs) expect(ref, ref).toMatch(/^(?:\.\/|data:)/)
      expect(html.match(new RegExp(external, 'gi')) ?? []).toEqual([])
      const assets = readdirSync(join(out, 'assets'))
      expect(assets.some((f) => f.endsWith('.js'))).toBe(true)
      expect(assets.some((f) => f.endsWith('.css'))).toBe(true)
      for (const file of assets) {
        const code = readFileSync(join(out, 'assets', file), 'utf8')
        for (const call of ['fetch(', 'XMLHttpRequest', 'WebSocket', 'sendBeacon', 'EventSource'])
          expect(code, `${file}: ${call}`).not.toContain(call)
        // namespaces of XML and the reserved example.org of the samples are not requests
        const addresses = (code.match(new RegExp(external, 'gi')) ?? []).filter((a) => !/w3\.org|example\.(?:org|com)/.test(a))
        expect(addresses, file).toEqual([])
      }
    } finally {
      rmSync(out, { recursive: true, force: true })
    }
  }, 60_000)
})
