/**
 * `npm run test:vscode`: starts a real VS Code with the extension and runs `suite.ts` in it. The first run downloads VS Code
 * (it needs the network); `NOTA_VSCODE_PATH` names an installed VS Code (its executable) to use instead.
 */
import { runTests } from '@vscode/test-electron'
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

async function main(): Promise<void> {
  const here = resolve(__dirname, '..')
  const fixtures = resolve(here, '../../quality/fixtures')
  // the fixtures are copied: the suite types into them and saves
  const work = mkdtempSync(join(tmpdir(), 'nota-e2e-'))
  for (const f of ['editor/visual.adoc', 'editor/colors.adoc', 'editor/lists.adoc', 'editor/blocks.adoc', 'editor/diagnostics.adoc', 'editor/code.adoc', 'editor/images.adoc', 'editor/imagesdir.adoc', 'editor/islands.adoc', 'editor/tables.adoc', 'editor/structure.adoc', 'editor/mermaid.adoc', 'editor/sheet.adoc', 'editor/wide.adoc', 'editor/page-meta.adoc', 'editor/page-meta-body.adoc', 'edge/crlf.adoc', 'edge/bom.adoc'])
    copyFileSync(join(fixtures, f), join(work, f.split('/')[1]!))
  // (the pictures of images.adoc lie in img/ next to it)
  mkdirSync(join(work, 'img'))
  for (const f of ['pixel.png', 'square.png', 'square.svg', 'wide.svg']) copyFileSync(join(fixtures, 'editor/img', f), join(work, 'img', f))
  const profile = mkdtempSync(join(tmpdir(), 'nota-e2e-profile-'))
  // the checks of the suite read Russian captions: the language of the tab is set by hand (the default `auto` follows VS Code, English in the test run)
  mkdirSync(join(profile, 'User'), { recursive: true })
  writeFileSync(join(profile, 'User', 'settings.json'), JSON.stringify({ 'nota.language': 'ru' }, null, 2))
  await runTests({
    vscodeExecutablePath: process.env.NOTA_VSCODE_PATH || undefined,
    extensionDevelopmentPath: here,
    extensionTestsPath: join(here, 'dist-e2e/suite.cjs'),
    extensionTestsEnv: { NOTA_E2E: '1', NOTA_E2E_WORK: work, NOTA_E2E_ONLY: process.env.NOTA_E2E_ONLY ?? '' },
    launchArgs: [work, '--disable-workspace-trust', '--disable-updates', '--user-data-dir', profile, '--skip-welcome', '--skip-release-notes'],
  })
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
