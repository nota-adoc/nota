import * as vscode from 'vscode'
import { NotaEditorProvider, VIEW_TYPE } from './provider.js'

const MARKS = ['strong', 'em', 'code', 'strike', 'highlight'] as const

export function activate(context: vscode.ExtensionContext): void {
  const e2e = process.env.NOTA_E2E === '1'
  const provider = new NotaEditorProvider(context.extensionUri, { e2e, extensionId: context.extension.id })
  context.subscriptions.push(
    provider,
    vscode.window.registerCustomEditorProvider(VIEW_TYPE, provider, {
      // a hidden tab keeps what is typed in it
      webviewOptions: { retainContextWhenHidden: true },
      supportsMultipleEditorsPerDocument: true,
    }),
    // one command, and two names for the button of the title («Текст» / «Визуально»): a command has one title
    ...['nota.toggleMode', 'nota.toggleMode.toText', 'nota.toggleMode.toVisual'].map((id) =>
      vscode.commands.registerCommand(id, () => provider.command('toggle-mode')),
    ),
    vscode.commands.registerCommand('nota.toggleOutlineView', () => provider.toggleOutlineView()),
    vscode.commands.registerCommand('nota.openSettings', () => provider.openSettings()),
    vscode.commands.registerCommand('nota.revealProblem', (uri: vscode.Uri | string, offset: number) => provider.reveal(uri, offset)),
    ...(['paragraph', 'heading2', 'heading3'] as const).map((name) =>
      vscode.commands.registerCommand(`nota.style.${name}`, () => provider.command(`style-${name}`)),
    ),
    ...MARKS.map((name) => vscode.commands.registerCommand(`nota.mark.${name}`, () => provider.command(name))),
  )
  if (e2e)
    context.subscriptions.push(
      vscode.commands.registerCommand('nota.e2e.type', (text: string) => provider.command('e2e-type', text)),
      vscode.commands.registerCommand('nota.e2e.pastehtml', (html: string, plain: string) => provider.command('e2e-pastehtml', JSON.stringify([html, plain]))),
      vscode.commands.registerCommand('nota.e2e.undo', () => provider.command('e2e-undo')),
      vscode.commands.registerCommand('nota.e2e.table', (name: string, arg?: string, then?: string) =>
          provider.command('e2e-table', [name, arg, then].filter((x) => x !== undefined).join('|')),
      ),
      vscode.commands.registerCommand('nota.e2e.state', () => provider.e2eState()),
      vscode.commands.registerCommand('nota.e2e.redo', () => provider.command('e2e-redo')),
      vscode.commands.registerCommand('nota.e2e.select', (anchor: number, head: number) => provider.command('e2e-select', `${anchor},${head}`)),
      vscode.commands.registerCommand('nota.e2e.textcolor', (role: string) => provider.command('e2e-textcolor', role)),
      vscode.commands.registerCommand('nota.e2e.fill', (role: string) => provider.command('e2e-fill', role)),
      vscode.commands.registerCommand('nota.e2e.link', (target: string) => provider.command('e2e-link', target)),
      vscode.commands.registerCommand('nota.e2e.list', (kind: string) => provider.command('e2e-list', kind)),
      vscode.commands.registerCommand('nota.e2e.indent', (shift: boolean) => provider.command('e2e-tab', shift ? 'shift' : '')),
      vscode.commands.registerCommand('nota.e2e.check', () => provider.command('e2e-check')),
      vscode.commands.registerCommand('nota.e2e.codetab', (shift: boolean) => provider.command('e2e-codetab', shift ? 'shift' : '')),
      vscode.commands.registerCommand('nota.e2e.codelang', (language: string) => provider.command('e2e-codelang', language)),
      vscode.commands.registerCommand('nota.e2e.insert', (kind: string, path?: string) => provider.command('e2e-insert', path ? `${kind}|${path}` : kind)),
      vscode.commands.registerCommand('nota.e2e.dismissslash', () => provider.command('e2e-dismissslash')),
      vscode.commands.registerCommand('nota.e2e.admonition', (variant: string) => provider.command('e2e-admonition', variant)),
      vscode.commands.registerCommand('nota.e2e.collapse', (offset: number) => provider.command('e2e-collapsible', String(offset))),
      vscode.commands.registerCommand('nota.e2e.move', (kind: string, a: number, b: number | string, c?: string) =>
        provider.command('e2e-move', [kind, a, b, c].filter((x) => x !== undefined).join('|')),
      ),
      vscode.commands.registerCommand('nota.e2e.block', (kind: string, at: number, value?: string) =>
        provider.command('e2e-block', value === undefined ? `${kind}|${at}` : `${kind}|${at}|${value}`),
      ),
      vscode.commands.registerCommand('nota.e2e.openlink', (target: string) => provider.command('e2e-openlink', target)),
    )
}

export function deactivate(): void {}
