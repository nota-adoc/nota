import { execFile } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  BLOCK_CONTEXTS,
  COMPARE_FIELDS,
  OTHER,
  foldKeys,
  isAggregateOnly,
  isShapeKey,
  underAggregateOnly,
} from '../lib/aggregate.js'
import { KINDS, type PairResult, type Summary, toJson } from '../reference/compare.js'
import { STATS_KEYS, countDocument, runStats } from './stats.js'
import { parse } from '@nota-adoc/core'

const root = fileURLToPath(new URL('../../', import.meta.url))
const tsx = join(root, 'node_modules/.bin/tsx')
const MARK = 'ZZMARK7f3c'

/** Constructs that carry the mark everywhere the spec lists it. */
const PAGE = `= ${MARK} title
${MARK} Author <${MARK}@example.com>; ${MARK} Second
v${MARK}, ${MARK}: ${MARK} remark
:${MARK}-attr: ${MARK} value
:${MARK}-other!:

[[${MARK}-anchor,${MARK} ref]]
== ${MARK} section

[${MARK}-style#${MARK}-id.${MARK}-role%${MARK}-option,${MARK}-name=${MARK}-value]
${MARK} paragraph with {${MARK}-attr}

${MARK}-macro::${MARK}-target[${MARK}-key=${MARK}-val]

https://${MARK}.example.com/${MARK}[${MARK} link] and xref:${MARK}.adoc[${MARK}] and image:${MARK}.png[]

[${MARK}-style]
****
${MARK} sidebar
****

.${MARK} table
[cols="${MARK},2*",format=${MARK},separator=${MARK}]
|===
|${MARK} |${MARK}
|===

[cols="1,${MARK}a",%header,frame=${MARK},grid=${MARK},stripes=${MARK},width=${MARK}]
|===
|${MARK}
a|
* ${MARK} item
+
!===
!${MARK}
!===

|${MARK}\\|${MARK}
|===

[format=csv,separator=${MARK}]
,===
"${MARK}",${MARK}
,===

[format=dsv,separator=;]
:===
${MARK}\\;${MARK};${MARK}
:===
`

function makeClosedFolder(): { dir: string; reports: string } {
  const dir = mkdtempSync(join(tmpdir(), `nota-${MARK}-`))
  const sub = join(dir, `${MARK}-folder`, `${MARK}-nested`)
  mkdirSync(sub, { recursive: true })
  writeFileSync(join(dir, '.aggregate-only'), '')
  writeFileSync(join(dir, `${MARK}-a.adoc`), PAGE)
  writeFileSync(join(sub, `${MARK}-b.adoc`), PAGE.replaceAll(MARK, MARK.toLowerCase()))
  writeFileSync(join(dir, `${MARK}-c.adoc`), `${MARK} only text\n`)
  return { dir, reports: mkdtempSync(join(tmpdir(), 'nota-reports-')) }
}

interface Run {
  code: number | null
  stdout: string
  stderr: string
}

const execFileAsync = promisify(execFile)

// asynchronous: a synchronous spawn blocks the event loop of the worker for the whole run of the tool (tens of
// seconds on a busy runner), and the call "onTaskUpdate" of vitest times out after 60 s
async function run(script: string, args: string[], env: NodeJS.ProcessEnv = process.env, cwd = root): Promise<Run> {
  try {
    const r = await execFileAsync(tsx, [script, ...args], { cwd, env, encoding: 'utf8', timeout: 110_000, maxBuffer: 64 << 20 })
    return { code: 0, stdout: r.stdout, stderr: r.stderr }
  } catch (e) {
    const x = e as { code?: number | string; stdout?: string; stderr?: string }
    return { code: typeof x.code === 'number' ? x.code : null, stdout: x.stdout ?? '', stderr: x.stderr ?? '' }
  }
}

const corpus = (args: string[], env?: NodeJS.ProcessEnv): Promise<Run> => run('quality/corpus/cli.ts', args, env)

/** A `docker` that fails the way a real one does: it writes the paths and the text of the pages into its errors. */
function fakeDocker(failAt: 'info' | 'run'): NodeJS.ProcessEnv {
  const bin = mkdtempSync(join(tmpdir(), 'nota-docker-'))
  const script = `#!/bin/sh
case "$1" in
  info) if [ ${failAt === 'info' ? 1 : 0} = 1 ]; then echo "cannot connect ${MARK} /in/${MARK}-a.adoc" >&2; exit 1; fi; echo 27 ;;
  image) exit 0 ;;
  run) echo "${MARK} failed at /in/${MARK}-a.adoc: ${MARK} text" >&2; echo "${MARK}"; exit 1 ;;
  *) exit 1 ;;
esac
`
  writeFileSync(join(bin, 'docker'), script)
  chmodSync(join(bin, 'docker'), 0o755)
  return { ...process.env, PATH: `${bin}:${process.env.PATH}` }
}

function reportsOf(dir: string): string[] {
  return readdirSync(dir).map((f) => readFileSync(join(dir, f), 'utf8'))
}

describe('a closed folder (.aggregate-only)', () => {
  let dir: string
  let reports: string
  beforeAll(() => {
    ;({ dir, reports } = makeClosedFolder())
  })

  it('is recognized by the file in its root', () => {
    expect(isAggregateOnly(dir)).toBe(true)
    expect(underAggregateOnly(join(dir, `${MARK}-folder`, `${MARK}-nested`))).toBe(true)
    expect(isAggregateOnly(join(dir, `${MARK}-folder`))).toBe(false)
    expect(isAggregateOnly(join(root, 'quality/fixtures'))).toBe(false)
  })

  it('does not let the mark out of identity, editor, compare, stats and visual: output, errors and reports', async () => {
    const common = ['--dir', dir, '--aggregate', '--report-dir', reports]
    const commands: [string, string[]][] = [
      ['identity', common],
      ['identity', [...common, '--json']],
      ['editor', [...common, '--seed', '5']],
      ['editor', [...common, '--seed', '5', '--json']],
      ['compare', [...common, '--only', 'js']],
      ['compare', [...common, '--only', 'js', '--json']],
      ['stats', common],
      ['stats', [...common, '--json']],
      ['visual', common],
      ['visual', [...common, '--json']],
    ]
    for (const [cmd, args] of commands) {
      const r = await corpus([cmd, ...args])
      const shown = `${cmd} ${args.filter((a) => a.startsWith('--') && a !== '--dir').join(' ')}`
      expect(r.code, `${shown}: ${r.stderr}`).toBe(cmd === 'compare' ? r.code : 0)
      expect(r.stderr, shown).not.toMatch(new RegExp(MARK, 'i'))
      expect(r.stdout, shown).not.toMatch(new RegExp(MARK, 'i'))
      expect(r.stdout.length, shown).toBeGreaterThan(0)
    }
    const saved = reportsOf(reports)
    expect(saved.length).toBe(commands.length)
    for (const s of saved) expect(s).not.toMatch(new RegExp(MARK, 'i'))
  })

  it('refuses identity, editor, compare and visual without --aggregate, with code 2 and no path or text in the message', async () => {
    for (const cmd of ['identity', 'editor', 'compare', 'visual']) {
      const r = await corpus([
        cmd,
        '--dir',
        dir,
        '--report-dir',
        reports,
        ...(cmd === 'compare' ? ['--only', 'js'] : []),
      ])
      expect(r.code, cmd).toBe(2)
      expect(r.stdout, cmd).toBe('')
      expect(r.stderr, cmd).toContain('.aggregate-only')
      expect(r.stderr, cmd).not.toContain(dir)
      expect(r.stderr, cmd).not.toMatch(new RegExp(MARK, 'i'))
    }
  })

  // root reads a folder with mode 000, so there is nothing to fail
  it.skipIf(process.getuid?.() === 0)('hides the details of a failure of stats without --aggregate on a closed folder (an unreadable folder with the mark)', async () => {
    const closed = mkdtempSync(join(tmpdir(), 'nota-closed-'))
    writeFileSync(join(closed, '.aggregate-only'), '')
    writeFileSync(join(closed, 'a.adoc'), 'text\n')
    const bad = join(closed, `${MARK}-locked`)
    mkdirSync(bad)
    writeFileSync(join(bad, 'b.adoc'), 'text\n')
    chmodSync(bad, 0o000)
    try {
      for (const args of [[], ['--json']]) {
        const r = await corpus(['stats', '--dir', closed, '--report-dir', reports, ...args])
        expect(r.stderr, args.join(' ')).not.toMatch(new RegExp(MARK, 'i'))
        expect(r.stderr, args.join(' ')).not.toContain(closed)
        expect(r.stdout, args.join(' ')).not.toMatch(new RegExp(MARK, 'i'))
      }
      const r = await corpus(['stats', '--dir', closed, '--report-dir', reports])
      expect(r.code).toBe(1)
      expect(r.stderr).toContain('failed (details hidden')
    } finally {
      chmodSync(bad, 0o755)
    }
  })

  it('refuses in a folder inside the closed one too', async () => {
    for (const cmd of ['identity', 'editor', 'compare', 'visual']) {
      const r = await corpus([
        cmd,
        '--dir',
        join(dir, `${MARK}-folder`, `${MARK}-nested`),
        '--report-dir',
        reports,
        ...(cmd === 'compare' ? ['--only', 'js'] : []),
      ])
      expect(r.code, cmd).toBe(2)
      expect(r.stdout, cmd).toBe('')
      expect(r.stderr, cmd).toContain('.aggregate-only')
      expect(r.stderr, cmd).not.toMatch(new RegExp(MARK, 'i'))
    }
  })

  it('does not let the mark out of the Ruby side of compare, whether Docker is down or fails on a page', async () => {
    for (const failAt of ['info', 'run'] as const) {
      const out = mkdtempSync(join(tmpdir(), 'nota-reports-'))
      for (const json of [false, true]) {
        const r = await corpus(
          [
            'compare',
            '--dir',
            dir,
            '--aggregate',
            '--only',
            'ruby',
            '--report-dir',
            out,
            ...(json ? ['--json'] : []),
          ],
          fakeDocker(failAt),
        )
        const shown = `${failAt}${json ? ' --json' : ''}`
        expect(r.code, `${shown}: ${r.stderr}`).toBe(3)
        expect(r.stdout, shown).not.toMatch(new RegExp(MARK, 'i'))
        expect(r.stderr, shown).not.toMatch(new RegExp(MARK, 'i'))
        expect(r.stdout, shown).not.toContain('/in/')
      }
      for (const s of reportsOf(out)) expect(s).not.toMatch(new RegExp(MARK, 'i'))
    }
  })

  it('makes npm run compare, npm run ref, npm run dump and the tools of quality/dev/ refuse, with code 2', async () => {
    const file = join(dir, `${MARK}-a.adoc`)
    const calls: [string, string[]][] = [
      ['quality/reference/compare-cli.ts', ['--dir', dir, '--only', 'js']],
      ['quality/reference/compare-cli.ts', [`--dir=${dir}`, '--only', 'js']],
      ['quality/reference/compare-cli.ts', ['--dir', join(dir, `${MARK}-folder`), '--only', 'js']],
      ['quality/reference/cli.ts', ['versions', dir]],
      ['quality/dump.ts', [file]],
      ['quality/dev/html-diff.ts', [file]],
      ['quality/dev/inline-diff.ts', [file]],
    ]
    for (const [script, args] of calls) {
      const r = await run(script, args)
      expect(r.code, `${script} ${args[0]}`).toBe(2)
      expect(r.stdout).toBe('')
      expect(r.stderr).toContain('.aggregate-only')
      expect(r.stderr).not.toContain(dir)
      expect(r.stderr).not.toMatch(new RegExp(MARK, 'i'))
    }
  })

  it('does not stop the tools on a folder without the file', async () => {
    const open = mkdtempSync(join(tmpdir(), 'nota-open-'))
    writeFileSync(join(open, 'a.adoc'), 'text\n')
    const r = await run('quality/reference/compare-cli.ts', ['--dir', open, '--only', 'js'])
    expect(r.code).toBe(0)
  })
})

describe('the fixed lists of keys', () => {
  it('folds the keys that are not in the list into <other>', () => {
    expect(foldKeys({ a: 1, b: 2, c: 3, d: 4 }, (k) => k === 'a' || k === 'b')).toEqual({
      a: 1,
      b: 2,
      [OTHER]: 7,
    })
  })

  it('gives the keys of the comparison from the lists only, whatever the text of a difference is', () => {
    const pair = (): PairResult => ({
      a: 'nota',
      b: 'ruby',
      compared: Object.fromEntries(KINDS.map((k) => [k, 1])) as PairResult['compared'],
      matched: Object.fromEntries(KINDS.map((k) => [k, 0])) as PairResult['matched'],
      htmlShapes: {
        'html-shape.table.text.text.in.td': 2,
        [`html-shape.table.text.${MARK}.in.td`]: 3,
        [MARK]: 4,
      },
      htmlBlocks: {
        paragraph: { compared: 1, matched: 0, differences: 1, outOfScope: 0 },
        [MARK]: { compared: 2, matched: 1, differences: 1, outOfScope: 0 },
        [`${MARK}2`]: { compared: 3, matched: 1, differences: 2, outOfScope: 0 },
      },
      differences: [
        { file: `${MARK}.adoc`, line: 1, kind: 'table', field: 'rowspan', a: MARK, b: 2 },
        { file: `${MARK}.adoc`, line: 1, kind: 'table', field: MARK, a: 1, b: 2 },
        { file: `${MARK}.adoc`, line: 1, kind: 'table', field: MARK, a: 1, b: 2 },
      ],
      known: [
        { file: `${MARK}.adoc`, line: 1, kind: 'entries', field: `${MARK}-name`, a: 1, b: 2, known: 'x' },
      ],
      outOfScope: { 'later-stage-blocks': 0, 'preprocessor-directives': 0, 'attribute-references': 0 },
      errors: [`${MARK} failed`],
    })
    const summary: Summary = { files: 1, pairs: { 'nota-ruby': pair() }, exitCode: 1 }
    const json = toJson(summary, { aggregate: true })
    expect(json).not.toContain(MARK)
    const p = (
      JSON.parse(json) as {
        pairs: Record<
          string,
          {
            differences: Record<string, number>
            known: Record<string, number>
            htmlBlocks: Record<string, unknown>
            htmlShapes: Record<string, number>
          }
        >
      }
    ).pairs['nota-ruby']!
    expect(p.differences).toEqual({ 'table.rowspan': 1, [OTHER]: 2 })
    expect(p.known).toEqual({ [OTHER]: 1 })
    expect(p.htmlShapes).toEqual({ 'html-shape.table.text.text.in.td': 2, [OTHER]: 7 })
    expect(isShapeKey('html-shape.table.class.halign-left.th.in.tr')).toBe(true)
    expect(isShapeKey('html-shape.table.section.tbody')).toBe(true)
    expect(isShapeKey('html-shape.table.col.col10+')).toBe(true)
    expect(isShapeKey(`html-shape.table.attr.${MARK.toLowerCase()}.td`)).toBe(false)
    for (const k of [
      'html-shape.table.idkind.suffix-number',
      'html-shape.table.iddelta.first-higher-1',
      'html-shape.table.idblock.paragraph.imageblock',
      'html-shape.table.pos.n10+',
      'html-shape.table.in-class.content',
      'html-shape.table.prev.none',
      'html-shape.table.cells.n2',
      'html-shape.table.block.paragraph.tableblock',
      'html-shape.table.role.has.no',
      'html-shape.table.child.div.paragraph.table.tableblock',
    ])
      expect(isShapeKey(k)).toBe(true)
    for (const k of [
      `html-shape.table.idkind.${MARK.toLowerCase()}`,
      `html-shape.table.in-class.${MARK.toLowerCase()}`,
      `html-shape.table.pos.${MARK.toLowerCase()}`,
    ])
      expect(isShapeKey(k)).toBe(false)
    expect(Object.keys(p.htmlBlocks).sort()).toEqual([OTHER, 'paragraph'])
    expect(p.htmlBlocks[OTHER]).toEqual({ compared: 5, matched: 2, differences: 3, outOfScope: 0 })
    for (const k of [...COMPARE_FIELDS]) expect(k).not.toMatch(/[A-Z]{3}/)
    expect([...BLOCK_CONTEXTS]).toContain('table')
  })

  it('has every key of stats in the list; the other keys are folded', () => {
    const r = runStats(join(root, 'quality/fixtures/stage3'))
    for (const k of Object.keys(r.counts)) expect([...STATS_KEYS, OTHER]).toContain(k)
    expect(countDocument(parse(`[frame=${MARK}]\n|===\n|x\n|===\n`))[`table.frame.${MARK}`]).toBe(1)
    const dir = mkdtempSync(join(tmpdir(), 'nota-odd-'))
    writeFileSync(join(dir, 'a.adoc'), `[frame=${MARK}]\n|===\n|x\n|===\n`)
    const odd = runStats(dir)
    expect(JSON.stringify(odd)).not.toContain(MARK)
    expect(odd.counts[OTHER]).toBe(1)
  })
})

describe('stats on the fixtures of stage 3', () => {
  it('finds every key of the tables at least once', () => {
    const r = runStats(join(root, 'quality/fixtures/stage3'))
    const missing = STATS_KEYS.filter(
      (k) => k.startsWith('table.') && k !== 'table.depth.deeper' && !r.counts[k],
    )
    expect(missing).toEqual([])
    expect(r.counts[OTHER] ?? 0).toBe(0)
  })
})
