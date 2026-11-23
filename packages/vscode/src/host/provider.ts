/**
 * The custom editor `nota.visual`. The `TextDocument` of VS Code is the truth: the tab edits it through `WorkspaceEdit`
 * after a check of the version, and what any source writes into it (another tab, a text editor, a change on disk, an undo)
 * goes to every tab. The tab has no history of its own: undo and redo are the commands of VS Code.
 */
import { posix } from 'node:path'
import * as vscode from 'vscode'
import { type NotaDocument, parse } from '@nota-adoc/core'
import { editorHtml, failedHtml, makeNonce } from './html.js'
import type { FileKind, Mode, TextChange, ToHost, ToTab } from '../protocol.js'
import { type Locale, resolveLocale, strings } from '../strings.js'
import { type RemarkSeverity, remarkText } from '../webview/diagnostics.js'

export const VIEW_TYPE = 'nota.visual'
/** A file above this many bytes of UTF-8 opens in the mode «Текст», with the strip «Файл больше 1 МБ». */
export const SIZE_LIMIT = 1_000_000
/** A tab that has not answered by then did not open. */
export const OPEN_TIMEOUT_MS = 10_000
/** The longest a save waits for a tab to hand over what is typed. */
export const FLUSH_TIMEOUT_MS = 3_000
/** The pause before the remarks of a changed document are counted again, in ms. */
export const DIAGNOSTICS_DELAY_MS = 300

export interface ProviderOptions {
  readonly sizeLimit?: number
  readonly openTimeoutMs?: number
  readonly flushTimeoutMs?: number
  readonly diagnosticsDelayMs?: number
  /** The suite of `npm run test:vscode` is running: the page may be asked to type. */
  readonly e2e?: boolean
  /** The language of VS Code, for `nota.language` = `auto` (default: `vscode.env.language`). */
  readonly language?: string
  /** `<publisher>.<name>` of this extension, for the filter of the Settings (default: the one of the manifest). */
  readonly extensionId?: string
}

/** The longest list of the field «Другой файл». */
export const FILE_LIST_LIMIT = 50
/** The most `.adoc` files the host reads from the workspace. */
export const FILE_SCAN_LIMIT = 10_000

/** Addresses the tab may open outside VS Code. */
const EXTERNAL = /^(?:https?:\/\/|mailto:)/i
const SCHEME = /^[a-z][a-z0-9+.-]*:/i
const ADOC = /\.(?:adoc|asciidoc)$/i
const IMAGE = /\.(?:png|jpe?g|gif|svg|webp)$/i

type State = 'loading' | 'ready' | 'failed'

class Tab {
  state: State = 'loading'
  /** The mode the tab says it is in. */
  mode: Mode = 'visual'
  timeout: ReturnType<typeof setTimeout> | undefined
  /** Messages of the tab are handled one after another: an edit is written before the next message is read. */
  chain: Promise<void> = Promise.resolve()
  flushes = new Map<number, () => void>()
  /** The `.adoc` files of the folder as paths relative to the folder of the document; read on the first ask. */
  files: string[] | undefined
  /** The pictures (png, jpg, jpeg, gif, svg, webp) of the folder and the workspace, the same way. */
  images: string[] | undefined
  /** The language the page was drawn in: it stays so until the tab is drawn again, whatever the setting says now. */
  locale: Locale | undefined
  disposed = false
  listener: vscode.Disposable | undefined
  constructor(
    readonly document: vscode.TextDocument,
    readonly panel: vscode.WebviewPanel,
  ) {}
}

/** The remarks of one document, kept between changes. */
interface Remarks {
  doc: NotaDocument
  /** Changes of the document not applied to `doc` yet, oldest first. */
  pending: (readonly TextChange[])[]
  timer: ReturnType<typeof setTimeout> | undefined
}

const SEVERITY: Record<RemarkSeverity, vscode.DiagnosticSeverity> = {
  error: vscode.DiagnosticSeverity.Error,
  warning: vscode.DiagnosticSeverity.Warning,
  info: vscode.DiagnosticSeverity.Information,
}

const fileNameOf = (uri: vscode.Uri): string => uri.path.split('/').pop() || uri.path

export class NotaEditorProvider implements vscode.CustomTextEditorProvider, vscode.Disposable {
  private readonly tabs = new Set<Tab>()
  private readonly disposables: vscode.Disposable[] = []
  private nextFlush = 1
  /** The suite asked a tab for its mode and selection and waits for the answer. */
  private readonly stateWaiters = new Set<(state: { mode: Mode; anchor: number; head: number; diagrams: number; isles: number; remarks: number }) => void>()
  /** The tab whose edit is being written to a document now: it gets an answer, the others get the change. */
  private readonly authoring = new Map<vscode.TextDocument, Tab>()
  /** The writes to one document go one after another, whichever tab they come from. */
  private readonly queues = new Map<vscode.TextDocument, Promise<void>>()
  private readonly remarks = new Map<vscode.TextDocument, Remarks>()
  private readonly collection = vscode.languages.createDiagnosticCollection('nota')
  private readonly diagnosticsDelayMs: number
  private readonly sizeLimit: number
  private readonly openTimeoutMs: number
  private readonly flushTimeoutMs: number
  private readonly e2e: boolean
  private readonly extensionId: string
  /** The language of the strings: the setting `nota.language`. */
  locale: Locale

  constructor(
    private readonly extensionUri: vscode.Uri,
    options: ProviderOptions = {},
  ) {
    this.sizeLimit = options.sizeLimit ?? SIZE_LIMIT
    this.openTimeoutMs = options.openTimeoutMs ?? OPEN_TIMEOUT_MS
    this.flushTimeoutMs = options.flushTimeoutMs ?? FLUSH_TIMEOUT_MS
    this.diagnosticsDelayMs = options.diagnosticsDelayMs ?? DIAGNOSTICS_DELAY_MS
    this.e2e = options.e2e ?? false
    this.extensionId = options.extensionId ?? 'nota-adoc.nota-vscode'
    this.vscodeLanguage = options.language
    this.locale = this.readLocale()
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('nota.pageWidth')) {
          const percent = this.readPageWidth()
          for (const tab of this.tabs) if (tab.state === 'ready') this.post(tab, { type: 'pageWidth', percent })
        }
        if (e.affectsConfiguration('nota.outlineView')) {
          const view = this.readOutlineView()
          for (const tab of this.tabs) if (tab.state === 'ready') this.post(tab, { type: 'outlineView', view })
        }
        if (e.affectsConfiguration('nota.showAnchors')) {
          const on = this.readShowAnchors()
          for (const tab of this.tabs) if (tab.state === 'ready') this.post(tab, { type: 'showAnchors', on })
        }
        if (e.affectsConfiguration('nota.blocksInCapsule')) {
          const set = this.readBlocksInCapsule()
          for (const tab of this.tabs) if (tab.state === 'ready') this.post(tab, { type: 'blocksInCapsule', set })
        }
        if (!e.affectsConfiguration('nota.language')) return
        const locale = this.readLocale()
        if (locale === this.locale) return
        // the lines of «Проблемы» change at once, an open tab keeps its language until it is opened again
        this.locale = locale
        for (const document of this.remarks.keys()) this.publish(document)
      }),
      vscode.workspace.onDidChangeTextDocument((e) => this.onDocumentChange(e)),
      vscode.workspace.onWillSaveTextDocument((e) => this.onWillSave(e)),
    )
    // a file added or removed: the lists of the fields «Другой файл» are read again on the next ask
    const watcher = vscode.workspace.createFileSystemWatcher('**/*.{adoc,asciidoc}')
    const forget = (): void => {
      for (const tab of this.tabs) tab.files = undefined
    }
    const pictures = vscode.workspace.createFileSystemWatcher('**/*.{png,jpg,jpeg,gif,svg,webp}')
    const forgetImages = (): void => {
      for (const tab of this.tabs) tab.images = undefined
    }
    this.disposables.push(
      watcher,
      watcher.onDidCreate(forget),
      watcher.onDidDelete(forget),
      pictures,
      pictures.onDidCreate(forgetImages),
      pictures.onDidDelete(forgetImages),
    )
  }

  private readonly vscodeLanguage: string | undefined

  /** The setting `nota.pageWidth`: a percent of the tab, 50–100; below or above is pulled to the border, a non-number is 85. */
  private readPageWidth(): number {
    const value: unknown = vscode.workspace.getConfiguration('nota').get<unknown>('pageWidth', 85)
    if (typeof value !== 'number' || !Number.isFinite(value)) return 85
    return Math.min(100, Math.max(50, value))
  }

  /** The setting `nota.blocksInCapsule`: `frequent` only for that string, anything else is `all`. */
  private readBlocksInCapsule(): 'all' | 'frequent' {
    return vscode.workspace.getConfiguration('nota').get<unknown>('blocksInCapsule', 'all') === 'frequent' ? 'frequent' : 'all'
  }

  /** The setting `nota.outlineView`: `side` only when it is that string; unset or anything else is `capsule`. */
  private readOutlineView(): 'capsule' | 'side' {
    return vscode.workspace.getConfiguration('nota').get<unknown>('outlineView', 'capsule') === 'side' ? 'side' : 'capsule'
  }

  /** The command «Переключить вид оглавления»: writes the other view where the setting is set now (folder, workspace, else user). */
  async toggleOutlineView(): Promise<void> {
    const conf = vscode.workspace.getConfiguration('nota')
    const next = this.readOutlineView() === 'capsule' ? 'side' : 'capsule'
    const found = conf.inspect<unknown>('outlineView')
    const target =
      found?.workspaceFolderValue !== undefined
        ? vscode.ConfigurationTarget.WorkspaceFolder
        : found?.workspaceValue !== undefined
          ? vscode.ConfigurationTarget.Workspace
          : vscode.ConfigurationTarget.Global
    await conf.update('outlineView', next, target)
  }

  /** The setting `nota.showAnchors`: true only when it is the boolean true. */
  private readShowAnchors(): boolean {
    return vscode.workspace.getConfiguration('nota').get<unknown>('showAnchors', false) === true
  }

  private readLocale(): Locale {
    const setting = vscode.workspace.getConfiguration('nota').get<string>('language', 'auto')
    return resolveLocale(setting, this.vscodeLanguage ?? vscode.env.language)
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose()
    for (const tab of [...this.tabs]) this.forget(tab)
    for (const r of this.remarks.values()) clearTimeout(r.timer)
    this.remarks.clear()
    this.collection.dispose()
  }

  // ------------------------------------------------------------------ a tab opens

  resolveCustomTextEditor(document: vscode.TextDocument, panel: vscode.WebviewPanel): void {
    const tab = new Tab(document, panel)
    this.tabs.add(tab)
    const webview = panel.webview
    webview.options = { enableScripts: true, localResourceRoots: this.resourceRoots(document) }
    tab.listener = webview.onDidReceiveMessage((m: ToHost) => this.onMessage(tab, m))
    panel.onDidDispose(() => this.forget(tab))
    panel.onDidChangeViewState(() => this.syncContext())
    this.watch(document)
    this.show(tab)
  }

  /** The folders the tab may read: the extension's `dist`, the folder of the file (its pictures) and the folders of the workspace. */
  private resourceRoots(document: vscode.TextDocument): vscode.Uri[] {
    return [
      vscode.Uri.joinPath(this.extensionUri, 'dist'),
      document.uri.with({ path: posix.dirname(document.uri.path) }),
      ...(vscode.workspace.workspaceFolders ?? []).map((f) => f.uri),
    ]
  }

  /** The address of the folder of the file for the tab, with a slash at the end, and the `:imagesdir:` of the document. */
  private imageBase(tab: Tab): { imageBase: string; imagesdir: string } {
    const dir = tab.document.uri.with({ path: posix.dirname(tab.document.uri.path) })
    const base = tab.panel.webview.asWebviewUri(dir).toString()
    const text = tab.document.getText()
    const doc = parse(text)
    return { imageBase: base.endsWith('/') ? base : base + '/', imagesdir: doc.attributesAt(text.length).get('imagesdir') ?? '' }
  }

  private forget(tab: Tab): void {
    tab.disposed = true
    clearTimeout(tab.timeout)
    tab.listener?.dispose()
    for (const done of tab.flushes.values()) done()
    tab.flushes.clear()
    this.tabs.delete(tab)
    if (![...this.tabs].some((t) => t.document === tab.document)) this.unwatch(tab.document)
    this.syncContext()
  }

  private bytes(document: vscode.TextDocument): number {
    return Buffer.byteLength(document.getText(), 'utf8')
  }

  private pageOptions(tab: Tab) {
    const webview = tab.panel.webview
    const dist = vscode.Uri.joinPath(this.extensionUri, 'dist')
    return {
      cspSource: webview.cspSource,
      nonce: makeNonce(),
      script: webview.asWebviewUri(vscode.Uri.joinPath(dist, 'webview.js')).toString(),
      style: webview.asWebviewUri(vscode.Uri.joinPath(dist, 'style.css')).toString(),
      mermaid: webview.asWebviewUri(vscode.Uri.joinPath(dist, 'mermaid.js')).toString(),
      locale: tab.locale ?? this.locale,
    }
  }

  /** Draws the page of the editor and waits for it. */
  private show(tab: Tab): void {
    clearTimeout(tab.timeout)
    const name = fileNameOf(tab.document.uri)
    tab.state = 'loading'
    tab.locale = this.locale
    tab.panel.webview.html = editorHtml(this.pageOptions(tab), name)
    tab.timeout = setTimeout(() => this.fail(tab, 'timeout'), this.openTimeoutMs)
  }

  private fail(tab: Tab, kind: 'error' | 'timeout', details?: string): void {
    if (tab.disposed || tab.state === 'failed') return
    clearTimeout(tab.timeout)
    tab.state = 'failed'
    tab.panel.webview.html = failedHtml(this.pageOptions(tab), fileNameOf(tab.document.uri), kind, details)
  }

  // ------------------------------------------------------------------ messages of a tab

  private post(tab: Tab, message: ToTab): void {
    if (!tab.disposed) void tab.panel.webview.postMessage(message)
  }

  private onMessage(tab: Tab, message: ToHost): void {
    if (tab.disposed) return
    if (message.type === 'flush') {
      // the tab answers after every edit was written: no need to wait in the line
      tab.flushes.get(message.id)?.()
      return
    }
    tab.chain = tab.chain.then(() => this.handle(tab, message)).catch(() => undefined)
  }

  private async handle(tab: Tab, message: ToHost): Promise<void> {
    if (tab.disposed) return
    switch (message.type) {
      case 'ready':
        if (tab.state !== 'loading') return
        clearTimeout(tab.timeout)
        tab.state = 'ready'
        {
          const bytes = this.bytes(tab.document)
          const big = bytes > this.sizeLimit
          tab.mode = big ? 'text' : 'visual'
          this.syncContext()
          this.post(tab, {
            type: 'init',
            text: tab.document.getText(),
            version: tab.document.version,
            fileName: fileNameOf(tab.document.uri),
            locale: tab.locale ?? this.locale,
            pageWidth: this.readPageWidth(),
            showAnchors: this.readShowAnchors(),
            blocksInCapsule: this.readBlocksInCapsule(),
            outlineView: this.readOutlineView(),
            fileDir: posix.dirname(tab.document.uri.path),
            ...this.imageBase(tab),
            mode: tab.mode,
            ...(big ? { big: { bytes } } : {}),
            ...(this.e2e ? { e2e: true } : {}),
          })
        }
        return
      case 'error':
        // a tab that has shown its document handles its failures itself (it shows the document again, with a strip);
        // the screen is for a tab that never showed one, or one that gave up
        if (tab.state === 'ready' && !message.fatal) return
        this.fail(tab, 'error', [message.message, message.stack?.split('\n')[1]?.trim()].filter(Boolean).join('\n'))
        return
      case 'openText':
        await this.openText(tab)
        return
      case 'openSettings':
        await this.openSettings()
        return
      case 'mode':
        tab.mode = message.mode
        this.syncContext()
        return
      case 'e2e-state':
        for (const done of [...this.stateWaiters]) done(message)
        return
      case 'resync':
        if (tab.state === 'ready') this.reset(tab, false)
        return
      case 'edit':
        if (tab.state === 'ready') await this.edit(tab, message)
        return
      case 'openLink':
        if (tab.state === 'ready') await this.openLink(tab, message.href)
        return
      case 'listFiles':
        if (tab.state === 'ready') await this.listFiles(tab, message.id, message.query, message.kind ?? 'adoc')
        return
      case 'readClipboard':
        if (tab.state === 'ready') this.post(tab, { type: 'clipboard', text: await vscode.env.clipboard.readText() })
        return
      case 'undo':
      case 'redo':
        if (tab.state === 'ready') await vscode.commands.executeCommand(message.type)
        return
    }
  }

  private reset(tab: Tab, stale: boolean): void {
    this.post(tab, { type: 'reset', text: tab.document.getText(), version: tab.document.version, stale })
  }

  /** the Settings of VS Code with the settings of this extension only (`@ext:<id>`). */
  async openSettings(): Promise<void> {
    try {
      await vscode.commands.executeCommand('workbench.action.openSettings', `@ext:${this.extensionId}`)
    } catch {
      // the Settings did not open: nothing to do in the tab
    }
  }

  /** The tab becomes the built-in text editor of VS Code. */
  private async openText(tab: Tab): Promise<void> {
    try {
      await vscode.commands.executeCommand('workbench.action.reopenTextEditor')
    } catch {
      await vscode.commands.executeCommand('vscode.openWith', tab.document.uri, 'default', {
        viewColumn: tab.panel.viewColumn,
      })
      tab.panel.dispose()
    }
  }

  /** Runs `job` after the writes to `document` that came before it. */
  private exclusive(document: vscode.TextDocument, job: () => Promise<void>): Promise<void> {
    const run = (this.queues.get(document) ?? Promise.resolve()).then(job)
    const tail = run.catch(() => undefined)
    this.queues.set(document, tail)
    void tail.then(() => {
      if (this.queues.get(document) === tail) this.queues.delete(document)
    })
    return run
  }

  private edit(tab: Tab, message: Extract<ToHost, { type: 'edit' }>): Promise<void> {
    return this.exclusive(tab.document, () => this.write(tab, message))
  }

  private async write(tab: Tab, message: Extract<ToHost, { type: 'edit' }>): Promise<void> {
    const document = tab.document
    const length = document.getText().length
    const valid = message.changes.every((c) => c.from >= 0 && c.from <= c.to && c.to <= length)
    // an edit on a version the document has left is not merged: the tab shows the document again
    if (document.version !== message.baseVersion || !valid) return this.reset(tab, true)
    const edit = new vscode.WorkspaceEdit()
    for (const c of message.changes)
      edit.replace(document.uri, new vscode.Range(document.positionAt(c.from), document.positionAt(c.to)), c.insert)
    this.authoring.set(document, tab)
    let applied: boolean
    try {
      applied = await vscode.workspace.applyEdit(edit)
    } finally {
      this.authoring.delete(document)
    }
    if (tab.disposed) return
    // exactly one version is ours; anything else means another source wrote meanwhile
    if (applied && (document.version === message.baseVersion + 1 || document.version === message.baseVersion))
      this.post(tab, { type: 'ack', id: message.id, version: document.version })
    else this.reset(tab, true)
  }

  // ------------------------------------------------------------------ links and other files

  /** The `.adoc` files of the workspace (or, with no workspace, of the folder of the document and below), without the file itself. */
  private async scanFiles(tab: Tab, kind: FileKind): Promise<string[]> {
    const dir = posix.dirname(tab.document.uri.path)
    const self = tab.document.uri.path
    const found: string[] = []
    const wanted = kind === 'image' ? IMAGE : ADOC
    const add = (path: string): void => {
      if (path !== self && !path.split('/').includes('node_modules')) found.push(posix.relative(dir, path))
    }
    if ((vscode.workspace.workspaceFolders ?? []).length > 0) {
      const uris = await vscode.workspace.findFiles(
        kind === 'image' ? '**/*.{png,jpg,jpeg,gif,svg,webp}' : '**/*.{adoc,asciidoc}',
        '**/node_modules/**',
        FILE_SCAN_LIMIT,
      )
      for (const uri of uris) add(uri.path)
    } else {
      // no workspace: the folder of the document and its subfolders
      const walk = async (base: string, depth: number): Promise<void> => {
        if (depth > 8 || found.length >= FILE_SCAN_LIMIT) return
        let entries: [string, vscode.FileType][]
        try {
          entries = await vscode.workspace.fs.readDirectory(tab.document.uri.with({ path: base }))
        } catch {
          return
        }
        for (const [name, type] of entries.sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
          if (name === 'node_modules' || name.startsWith('.')) continue
          const path = posix.join(base, name)
          if (type === vscode.FileType.Directory) await walk(path, depth + 1)
          else if (wanted.test(name)) add(path)
        }
      }
      await walk(dir, 0)
    }
    return found.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  }

  private async listFiles(tab: Tab, id: number, query: string, kind: FileKind): Promise<void> {
    let all: string[]
    if (kind === 'image') all = tab.images ??= await this.scanFiles(tab, 'image').catch(() => [])
    else all = tab.files ??= await this.scanFiles(tab, 'adoc').catch(() => [])
    const words = query.toLowerCase().split(/\s+/).filter(Boolean)
    const hits = words.length === 0 ? all : all.filter((p) => words.every((w) => p.toLowerCase().includes(w)))
    this.post(tab, { type: 'files', id, items: hits.slice(0, FILE_LIST_LIMIT), more: Math.max(0, hits.length - FILE_LIST_LIMIT) })
  }

  /** Cmd+click on a link: an address opens in the browser, a file of the folder opens in a tab; anything else is refused in words. */
  private async openLink(tab: Tab, href: string): Promise<void> {
    const refuse = (text: string): void => this.post(tab, { type: 'notice', text })
    const target = href.trim().replace(/^(?:link|xref):/i, '')
    if (EXTERNAL.test(target)) {
      this.post(tab, { type: 'noticeHide' })
      await vscode.env.openExternal(vscode.Uri.parse(target))
      return
    }
    const locale = tab.locale ?? this.locale
    const refused = strings[locale].linkRefused
    const insideWorkspace = (p: string): boolean =>
      (vscode.workspace.workspaceFolders ?? []).some((f) => p === f.uri.path || p.startsWith(`${f.uri.path.replace(/\/$/, '')}/`))
    let path: string
    if (/^file:/i.test(target)) {
      // only inside the folders of the workspace
      const uri = vscode.Uri.parse(target)
      path = posix.normalize(uri.path)
      if (!insideWorkspace(path)) return refuse(refused)
    } else if (SCHEME.test(target)) return refuse(refused)
    else {
      const bare = target.split('#')[0]!
      if (!ADOC.test(bare)) return refuse(refused)
      let decoded = bare
      try {
        decoded = decodeURIComponent(bare)
      } catch {
        // (a path that is not escaped)
      }
      path = posix.resolve(posix.dirname(tab.document.uri.path), decoded)
      // a relative path may not leave the workspace either (when there is one)
      if ((vscode.workspace.workspaceFolders ?? []).length > 0 && !insideWorkspace(path)) return refuse(refused)
    }
    if (!ADOC.test(path)) return refuse(refused)
    const uri = tab.document.uri.with({ path })
    try {
      await vscode.workspace.fs.stat(uri)
    } catch {
      // (no path, name or code of the error in the words)
      return refuse(strings[locale].fileNotFound)
    }
    this.post(tab, { type: 'noticeHide' })
    await vscode.commands.executeCommand('vscode.open', uri)
  }

  // ------------------------------------------------------------------ the document changes

  private onDocumentChange(e: vscode.TextDocumentChangeEvent): void {
    if (e.contentChanges.length === 0) return
    const changes: TextChange[] = [...e.contentChanges]
      .sort((a, b) => a.rangeOffset - b.rangeOffset)
      .map((c) => ({ from: c.rangeOffset, to: c.rangeOffset + c.rangeLength, insert: c.text }))
    const reason =
      e.reason === vscode.TextDocumentChangeReason.Undo
        ? 'undo'
        : e.reason === vscode.TextDocumentChangeReason.Redo
          ? 'redo'
          : undefined
    for (const tab of this.tabs) {
      if (tab.document !== e.document || tab.state !== 'ready' || tab === this.authoring.get(e.document)) continue
      this.post(tab, { type: 'update', version: e.document.version, changes, reason })
    }
    this.remarksChanged(e.document, changes)
  }

  // ------------------------------------------------------------------ the mode of the tab the person is in

  /** `nota.textMode` says whether the active tab is in the mode «Текст»: the button of the title shows the other mode. */
  private syncContext(): void {
    const active = [...this.tabs].find((t) => t.state === 'ready' && t.panel.active)
    void vscode.commands.executeCommand('setContext', 'nota.textMode', active?.mode === 'text')
  }

  // ------------------------------------------------------------------ the panel «Проблемы»

  /** A document with a Nota tab has its remarks in the panel; the last tab closed takes them away. */
  private watch(document: vscode.TextDocument): void {
    if (this.remarks.has(document)) return
    this.remarks.set(document, { doc: parse(document.getText()), pending: [], timer: undefined })
    this.publish(document)
  }

  private unwatch(document: vscode.TextDocument): void {
    const r = this.remarks.get(document)
    if (r) clearTimeout(r.timer)
    this.remarks.delete(document)
    this.collection.delete(document.uri)
  }

  private remarksChanged(document: vscode.TextDocument, changes: readonly TextChange[]): void {
    const r = this.remarks.get(document)
    if (!r) return
    r.pending.push(changes)
    clearTimeout(r.timer)
    r.timer = setTimeout(() => {
      r.timer = undefined
      this.recount(document, r)
    }, this.diagnosticsDelayMs)
  }

  private recount(document: vscode.TextDocument, r: Remarks): void {
    const batches = r.pending
    r.pending = []
    try {
      for (const changes of batches) r.doc = r.doc.update(changes)
    } catch {
      // (changes that do not fit the text: the document is read again)
    }
    const text = document.getText()
    if (r.doc.text !== text) r.doc = parse(text)
    this.publish(document)
  }

  private publish(document: vscode.TextDocument): void {
    const r = this.remarks.get(document)
    if (!r) return
    const list = r.doc.diagnostics.map((d) => {
      const item = new vscode.Diagnostic(
        new vscode.Range(document.positionAt(d.from), document.positionAt(d.to)),
        remarkText(d, this.locale),
        SEVERITY[d.severity],
      )
      item.source = 'nota'
      // a click on the code of the line in «Проблемы» opens this link: the command puts the cursor on the remark
      const args = encodeURIComponent(JSON.stringify([document.uri.toString(), d.from]))
      item.code = { value: d.code, target: vscode.Uri.parse(`command:nota.revealProblem?${args}`) }
      return item
    })
    this.collection.set(document.uri, list)
  }

  /**
   * Puts the cursor of the tab of `uri` on the offset (a click on a remark). Returns false when no tab of that file is open.
   * VS Code opens the file at the remark for a text editor; for the tab of Nota it only brings the tab forward.
   */
  reveal(uri: vscode.Uri | string, offset: number): boolean {
    const key = uri.toString()
    const tabs = [...this.tabs].filter((t) => t.state === 'ready' && t.document.uri.toString() === key)
    const tab = tabs.find((t) => t.panel.active) ?? tabs[0]
    if (!tab) return false
    // a click on the code of a remark does not open the file by itself: bring the tab forward first
    tab.panel.reveal(tab.panel.viewColumn)
    this.post(tab, { type: 'command', name: 'reveal', offset })
    return true
  }

  private onWillSave(e: vscode.TextDocumentWillSaveEvent): void {
    const tabs = [...this.tabs].filter((t) => t.document === e.document && t.state === 'ready')
    if (tabs.length === 0) return
    e.waitUntil(Promise.all(tabs.map((t) => this.flush(t))).then(() => []))
  }

  /** Asks a tab to send what it has and waits until it says it is written (or gives up). */
  private flush(tab: Tab): Promise<void> {
    return new Promise<void>((resolve) => {
      const id = this.nextFlush++
      const done = (): void => {
        clearTimeout(timer)
        tab.flushes.delete(id)
        // the answers of the edits come through the same line: wait until it is empty
        void tab.chain.then(resolve)
      }
      const timer = setTimeout(done, this.flushTimeoutMs)
      tab.flushes.set(id, done)
      this.post(tab, { type: 'flush', id })
    })
  }

  // ------------------------------------------------------------------ commands of keys

  /** The mode and the selection of the tab the person is in, for the suite `npm run test:vscode`. */
  e2eState(): Promise<{ mode: Mode; anchor: number; head: number; diagrams: number; isles: number; remarks: number } | undefined> {
    return new Promise((resolve) => {
      const done = (state?: { mode: Mode; anchor: number; head: number; diagrams: number; isles: number; remarks: number }): void => {
        clearTimeout(timer)
        this.stateWaiters.delete(done)
        resolve(state)
      }
      const timer = setTimeout(() => done(), 5_000)
      this.stateWaiters.add(done)
      if (!this.command('e2e-state')) done()
    })
  }

  /** Sends a command of a key (a mark) to the tab the person is in. */
  command(name: string, text?: string): boolean {
    const tab = [...this.tabs].find((t) => t.state === 'ready' && t.panel.active)
    if (!tab) return false
    this.post(tab, { type: 'command', name, ...(text === undefined ? {} : { text }) })
    return true
  }
}
