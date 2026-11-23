/** The HTML of a tab: the editor, and the screen the host draws itself («не открылся»). */
import { randomBytes } from 'node:crypto'
import { type Locale, strings } from '../strings.js'

export interface PageOptions {
  /** `webview.cspSource`. */
  readonly cspSource: string
  readonly nonce: string
  /** The addresses of the files of the extension in the webview (`webview.asWebviewUri`). */
  readonly script: string
  readonly style: string
  /** The address of the library of diagrams, loaded by the page when it shows its first diagram. */
  readonly mermaid: string
  /** The language of the page (`lang`) and of the screen «не открылся». */
  readonly locale: Locale
}

export const escapeHtml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** A nonce for the script of a page. */
export function makeNonce(): string {
  return randomBytes(24).toString('base64url')
}

/**
 * No network and nothing from outside: only the script with the nonce and the style sheet of the extension. The styles of a page are not
 * held to the nonce (`'unsafe-inline'`; with a nonce next to it the keyword would be ignored): mermaid puts a `<style>` and `style`
 * attributes in its pictures, and without them its nodes are drawn bare. No directive gets an address, and scripts stay on the nonce.
 */
function csp({ cspSource, nonce }: PageOptions): string {
  // (pictures only from the folders the host lets the tab read: no https, no data)
  return `default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${cspSource};`
}

/** The theme of the tab follows the class of `body` that VS Code keeps up to date. */
const THEME = `
const body = document.body
const apply = () => {
  const c = body.classList
  const dark = c.contains('vscode-dark') || (c.contains('vscode-high-contrast') && !c.contains('vscode-high-contrast-light'))
  body.dataset.notaTheme = dark ? 'dark' : 'light'
}
apply()
new MutationObserver(apply).observe(body, { attributes: true, attributeFilter: ['class'] })
`

function page(options: PageOptions, title: string, body: string, script: string): string {
  return `<!DOCTYPE html>
<html lang="${options.locale}">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp(options)}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="${escapeHtml(options.style)}">
</head>
<body>
${body}
<script nonce="${options.nonce}">${script}</script>
</body>
</html>`
}

/** The tab with the editor: the bundle draws everything. */
export function editorHtml(options: PageOptions, fileName: string): string {
  return `<!DOCTYPE html>
<html lang="${options.locale}">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp(options)}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(fileName)}</title>
<link rel="stylesheet" href="${escapeHtml(options.style)}">
</head>
<body>
<div id="app" class="nota" data-mermaid="${escapeHtml(options.mermaid)}"></div>
<script nonce="${options.nonce}" src="${escapeHtml(options.script)}"></script>
</body>
</html>`
}

const ICON_ERR =
  '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.2v.1"/></svg>'

const BUTTONS = `
const api = acquireVsCodeApi()
for (const el of document.querySelectorAll('[data-send]')) el.addEventListener('click', () => api.postMessage({ type: el.dataset.send }))
document.querySelector('[data-focus]')?.focus({ preventScroll: true })
`

export type FailureKind = 'error' | 'timeout'

/** «Визуальный редактор не открылся». `details` is the message and the first line of the stack of an error. */
export function failedHtml(options: PageOptions, fileName: string, kind: FailureKind, details?: string): string {
  const t = strings[options.locale].failed
  const reason = kind === 'timeout' ? t.timeout : t.error
  const more =
    kind === 'error' && details
      ? `<details class="more"><summary>${escapeHtml(t.details)}</summary><pre>${escapeHtml(details)}</pre></details>`
      : ''
  const body = `<div class="nota"><div class="state"><div class="card" role="alert" aria-labelledby="fail-h">
<div class="badge err">${ICON_ERR}</div>
<h2 id="fail-h">${escapeHtml(t.title)}</h2>
<p><strong>${escapeHtml(reason)}</strong> ${escapeHtml(t.body)}</p>
${more}
<div class="acts"><button type="button" class="btn primary" data-send="openText" data-focus>${escapeHtml(t.open)}</button></div>
<p class="foot">${escapeHtml(t.foot(fileName))}</p>
</div></div></div>`
  return page(options, fileName, body, THEME + BUTTONS)
}
