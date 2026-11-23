// the adapter of the TCK, the sorting of its failures by the registry.
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import registry from '../reference/known-differences.json' with { type: 'json' }
import { adapt } from './adapter.js'
import { classify, knownFailures, pin, testOfMessage } from './tck.js'

describe('the TCK adapter', () => {
  it('gives the ASG of a document without `range`, and the inlines of an inline test', () => {
    const asg = adapt({ contents: '== Section Title\n\nparagraph', type: 'block' }) as {
      blocks: { name: string; level: number; location: unknown; blocks: { inlines: { value: string }[] }[] }[]
    }
    expect(JSON.stringify(asg)).not.toContain('"range"')
    expect(asg.blocks[0]).toMatchObject({ name: 'section', level: 1 })
    expect(asg.blocks[0]!.blocks[0]!.inlines[0]!.value).toBe('paragraph')
    expect(adapt({ contents: '*s*', type: 'inline' })).toEqual([
      {
        name: 'span',
        type: 'inline',
        variant: 'strong',
        form: 'constrained',
        inlines: [{ name: 'text', type: 'string', value: 's', location: [{ line: 1, col: 2 }, { line: 1, col: 2 }] }],
        location: [{ line: 1, col: 1 }, { line: 1, col: 3 }],
      },
    ])
  })

  it('works as a command: JSON on stdin, JSON on stdout', async () => {
    // asynchronous: a synchronous spawn blocks the event loop of the worker
    const child = spawn(join(import.meta.dirname, '../../node_modules/.bin/tsx'), [join(import.meta.dirname, 'adapter.ts')])
    let stdout = ''
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d))
    const status = new Promise<number | null>((resolve) => child.on('close', resolve))
    child.stdin.end(JSON.stringify({ contents: 'hello', type: 'inline', path: 'x' }))
    expect(await status).toBe(0)
    expect(JSON.parse(stdout)[0]).toMatchObject({ name: 'text', value: 'hello' })
  })
})

describe('the TCK run', () => {
  it('is pinned to a commit', () => {
    expect(pin.commit).toMatch(/^[0-9a-f]{40}$/)
  })

  it('names the test of a failure', () => {
    expect(testOfMessage('actual output does not match expected output for tests/block/a/b-input.adoc\n+ x')).toBe('tests/block/a/b')
    expect(testOfMessage('something else')).toBeNull()
  })

  it('counts a failure as known only when an entry of the registry explains it', () => {
    const entries = [{ id: 'x', kind: 'tck' as const, test: '^tests/block/list/', description: 'd', link: 'l' }]
    const r = classify(
      ['actual output does not match expected output for tests/block/list/a-input.adoc', 'actual output does not match expected output for tests/block/other-input.adoc', 'boom'],
      entries,
    )
    expect(r.known).toEqual([{ test: 'tests/block/list/a', id: 'x' }])
    expect(r.failed).toEqual(['tests/block/other', 'boom'])
  })

  it('has every entry of kind "tck" in the registry with a test, a description and a link', () => {
    for (const e of knownFailures()) {
      expect(e.id).toBeTruthy()
      expect(() => new RegExp(e.test)).not.toThrow()
      expect(e.description.length).toBeGreaterThan(20)
      expect(e.link).toMatch(/^https:\/\//)
    }
    const ids = (registry.differences as { id: string }[]).map((d) => d.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
