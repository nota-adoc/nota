import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { InputError, listAdoc, runCompare } from './run.js'

const temp = () => mkdtempSync(join(tmpdir(), 'nota-run-'))

describe('input directory', () => {
  it('lists the .adoc files under a directory', () => {
    const dir = temp()
    mkdirSync(join(dir, 'sub'))
    writeFileSync(join(dir, 'b.adoc'), 'B\n')
    writeFileSync(join(dir, 'sub', 'a.adoc'), 'A\n')
    writeFileSync(join(dir, 'c.txt'), 'C\n')
    expect(listAdoc(dir)).toEqual(['b.adoc', join('sub', 'a.adoc')])
  })

  it('says so when the directory does not exist', () => {
    expect(() => listAdoc(join(temp(), 'missing'))).toThrow(InputError)
  })

  it('says so when the directory has no .adoc files, without a silent success', async () => {
    const dir = temp()
    writeFileSync(join(dir, 'note.txt'), 'x\n')
    await expect(runCompare({ dir, only: 'js' })).rejects.toThrow(InputError)
    await expect(runCompare({ dir, only: 'js' })).rejects.toThrow(/no \.adoc files/)
  })
})
