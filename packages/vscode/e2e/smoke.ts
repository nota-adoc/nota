/**
 * The suite of `npm run test:vsix`, run in a VS Code that has the extension installed from the .vsix and no plugin in
 * `extensionDevelopmentPath`: a `.adoc` opens in the tab `nota.visual`, the extension is active and lives inside the folder
 * of extensions of the run, and the test-only commands `nota.e2e.*` do not exist.
 */
import * as assert from 'node:assert/strict'
import { realpathSync } from 'node:fs'
import { join, relative, isAbsolute } from 'node:path'
import * as vscode from 'vscode'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function waitFor(what: string, check: () => boolean, ms = 30000): Promise<void> {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (check()) return
    await sleep(100)
  }
  assert.fail(`timeout: ${what}`)
}

export async function run(): Promise<void> {
  const work = process.env.NOTA_SMOKE_WORK!
  const extensionsDir = process.env.NOTA_SMOKE_EXTENSIONS!
  const id = process.env.NOTA_SMOKE_ID!
  const uri = vscode.Uri.file(join(work, 'visual.adoc'))

  // a plain open: the editor by default of the file is the one the extension declares
  await vscode.commands.executeCommand('vscode.open', uri)
  await waitFor('the active tab is a custom editor nota.visual of the file', () => {
    const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input
    return input instanceof vscode.TabInputCustom && input.viewType === 'nota.visual' && input.uri.fsPath === uri.fsPath
  })
  console.log('  tab: TabInputCustom nota.visual')

  const extension = vscode.extensions.getExtension(id)
  assert.ok(extension, `the extension ${id} is not installed`)
  await waitFor(`${id} is active`, () => extension.isActive)
  const inside = relative(extensionsDir, realpathSync(extension.extensionPath))
  assert.ok(inside !== '' && !inside.startsWith('..') && !isAbsolute(inside), `extensionPath ${extension.extensionPath} is not inside ${extensionsDir}`)
  console.log(`  extension active, extensionPath ${extension.extensionPath}`)

  const commands = await vscode.commands.getCommands(true)
  assert.deepEqual(
    commands.filter((c) => c.startsWith('nota.e2e.')),
    [],
    'the commands nota.e2e.* must not exist in the installed extension',
  )
  assert.ok(commands.includes('nota.toggleMode'), 'the command nota.toggleMode exists')
  console.log('  no nota.e2e.* commands')
}
