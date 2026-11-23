import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromeDump } from './chrome.js'

export { chromeDump, chromeVersion } from './chrome.js'

let frameHeight: Promise<number> | undefined
/** The difference between --window-size and the page height for a dump in virtual time. */
export function chromeFrameHeight(chrome: string): Promise<number> {
  return (frameHeight ??= measureFrameHeight(chrome))
}

async function measureFrameHeight(chrome: string): Promise<number> {
  const height = 800
  const dir = mkdtempSync(join(tmpdir(), 'nota-frame-'))
  try {
    const page = join(dir, 'height.html')
    writeFileSync(page, '<!doctype html><title></title><script>setTimeout(() => { document.title = "H " + innerHeight }, 20)</script>')
    const html = await chromeDump(chrome, ['--headless=new', '--disable-gpu', '--allow-file-access-from-files', `--window-size=1000,${height}`, '--virtual-time-budget=1000', '--dump-dom', `file://${page}`], 60_000)
    const match = /<title>H (\d+)<\/title>/.exec(html)
    if (!match) throw new Error('Chrome did not report the viewport height')
    return height - Number(match[1])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
