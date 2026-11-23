import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { RubyUnavailable, dumpRuby, imageTag, requireRuby } from './ruby.js'

describe('Ruby reference', () => {
  it('names the image after the content of the reference files', () => {
    expect(imageTag()).toMatch(/^nota-ref-ruby:[0-9a-f]{12}$/)
    expect(imageTag()).toBe(imageTag())
  })

  it('fails loudly when Docker is not available', () => {
    expect(() => requireRuby({ docker: 'nota-no-such-docker-binary' })).toThrow(RubyUnavailable)
    expect(() => requireRuby({ docker: 'nota-no-such-docker-binary' })).toThrow(
      /Ruby reference is unavailable/,
    )
  })

  describe('dumpRuby', () => {
    /** A stand-in for docker: `info` and `image inspect` succeed; `run` logs its batch and answers a JSONL line per name. */
    function fakeDocker(log: string): string {
      const path = join(mkdtempSync(join(tmpdir(), 'nota-fake-docker-')), 'docker')
      writeFileSync(
        path,
        `#!/usr/bin/env node
const fs = require('fs')
if (process.argv[2] !== 'run') process.exit(0)
const names = fs.readFileSync(0, 'utf8').split('\\n')
fs.appendFileSync(${JSON.stringify(log)}, names.join(',') + '\\n')
for (const n of names) process.stdout.write(JSON.stringify({ file: n, entries: [], nodes: [] }) + '\\n')
`,
      )
      chmodSync(path, 0o755)
      return path
    }

    it('runs a large set in batches of bounded size and keeps the order', () => {
      const root = mkdtempSync(join(tmpdir(), 'nota-ruby-root-'))
      const names = Array.from({ length: 10 }, (_, i) => `f${i}.adoc`)
      for (const n of names) writeFileSync(join(root, n), 'x'.repeat(100))
      const log = join(root, 'batches.log')
      const out = dumpRuby(root, names, { docker: fakeDocker(log), batchBytes: 250 })
      expect(out.map((d) => d.file)).toEqual(names)
      const batches = readFileSync(log, 'utf8').trim().split('\n')
      expect(batches.length).toBe(5)
      for (const b of batches) expect(b.split(',').length).toBeLessThanOrEqual(2)
    })

    it('puts a file larger than the limit in a batch of its own', () => {
      const root = mkdtempSync(join(tmpdir(), 'nota-ruby-root-'))
      writeFileSync(join(root, 'big.adoc'), 'x'.repeat(1000))
      writeFileSync(join(root, 'a.adoc'), 'x')
      const log = join(root, 'batches.log')
      const out = dumpRuby(root, ['a.adoc', 'big.adoc'], { docker: fakeDocker(log), batchBytes: 100 })
      expect(out.map((d) => d.file)).toEqual(['a.adoc', 'big.adoc'])
      expect(readFileSync(log, 'utf8').trim().split('\n')).toEqual(['a.adoc', 'big.adoc'])
    })
  })
})
