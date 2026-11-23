import { execFile } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('..', import.meta.url))
const dir = `${root}examples`
const files = readdirSync(dir).filter((f) => f.endsWith('.ts')).sort()

/** The lines after `// Output:` at the end of an example: what the example prints. */
function recorded(source: string): string {
  const at = source.indexOf('\n// Output:\n')
  expect(at, 'the example records its output under `// Output:`').toBeGreaterThan(0)
  return source
    .slice(at + '\n// Output:\n'.length)
    .split('\n')
    .filter((l) => l.startsWith('//'))
    .map((l) => l.replace(/^\/\/ ?/, ''))
    .join('\n')
}

describe('examples/', () => {
  it('has the three examples', () => {
    expect(files).toEqual(['parse.ts', 'render.ts', 'walk.ts'])
  })

  for (const file of files) {
    it(`${file} prints what its comment says`, async () => {
      const source = readFileSync(`${dir}/${file}`, 'utf8')
      const imports = [...source.matchAll(/from '([^']+)'/g)].map((m) => m[1])
      expect(imports.length).toBeGreaterThan(0)
      for (const name of imports) expect(['@nota-adoc/core', '@nota-adoc/html']).toContain(name)
      const { stdout } = await promisify(execFile)('npx', ['tsx', `examples/${file}`], { cwd: root, encoding: 'utf8' })
      expect(stdout.trimEnd()).toBe(recorded(source).trimEnd())
    })
  }
})
