import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

export const repoRoot = join(import.meta.dirname, '../../..')
export const fixturesDir = join(repoRoot, 'quality/fixtures')

/** Reads a fixture like the quality bench: UTF-16 (with a BOM) as such, anything else as UTF-8 with the BOM kept. */
export function readFixture(path: string): string {
  const buf = readFileSync(path)
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    let out = ''
    for (let i = 0; i + 1 < buf.length; i += 2) out += String.fromCharCode(buf[i]! | (buf[i + 1]! << 8))
    return out
  }
  return new TextDecoder('utf-8', { ignoreBOM: true }).decode(buf)
}

/** Every `.adoc` file of quality/fixtures, as [relative path, text]. */
export function fixtures(): [string, string][] {
  const out: [string, string][] = []
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const p = join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.name.endsWith('.adoc')) out.push([relative(fixturesDir, p), readFixture(p)])
    }
  }
  walk(fixturesDir)
  return out
}
