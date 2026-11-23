/**
 * A stand-in for the module `vscode`, as much of it as the host of the extension uses: documents with a version and an undo
 * stack of their own (as in VS Code, one for all editors of a document), edits, events, webview panels that record what the
 * host puts on them. The tests drive it through `fake`.
 */

export class Uri {
  constructor(readonly path: string) {}
  static file(path: string): Uri {
    return new Uri(path)
  }
  static joinPath(base: Uri, ...parts: string[]): Uri {
    return new Uri([base.path, ...parts].join('/'))
  }
  static parse(value: string): Uri {
    const file = /^file:\/\/(\/.*)$/i.exec(value)
    return new Uri(file ? file[1]! : value)
  }
  with(change: { path?: string }): Uri {
    return new Uri(change.path ?? this.path)
  }
  get fsPath(): string {
    return this.path
  }
  toString(): string {
    return this.path.startsWith('command:') ? this.path : `vscode-resource:${this.path}`
  }
}

export class Position {
  constructor(
    readonly line: number,
    readonly character: number,
  ) {}
}

export class Range {
  constructor(
    readonly start: Position,
    readonly end: Position,
  ) {}
}

export enum DiagnosticSeverity {
  Error = 0,
  Warning = 1,
  Information = 2,
  Hint = 3,
}

export class Diagnostic {
  source?: string
  code?: string | number
  constructor(
    readonly range: Range,
    readonly message: string,
    readonly severity: DiagnosticSeverity = DiagnosticSeverity.Error,
  ) {}
}

/** The collection of problems, by the address of the file. */
export class FakeDiagnosticCollection {
  readonly entries = new Map<string, Diagnostic[]>()
  disposed = false
  set(uri: Uri, list: Diagnostic[]): void {
    this.entries.set(uri.toString(), list)
  }
  delete(uri: Uri): void {
    this.entries.delete(uri.toString())
  }
  get(uri: Uri): Diagnostic[] {
    return this.entries.get(uri.toString()) ?? []
  }
  dispose(): void {
    this.disposed = true
    this.entries.clear()
  }
}

export enum TextDocumentChangeReason {
  Undo = 1,
  Redo = 2,
}

export class WorkspaceEdit {
  readonly replacements: { uri: Uri; range: Range; text: string }[] = []
  replace(uri: Uri, range: Range, text: string): void {
    this.replacements.push({ uri, range, text })
  }
}

class Emitter<T> {
  private listeners = new Set<(value: T) => void>()
  readonly event = (listener: (value: T) => void): { dispose(): void } => {
    this.listeners.add(listener)
    return { dispose: () => void this.listeners.delete(listener) }
  }
  fire(value: T): void {
    for (const l of [...this.listeners]) l(value)
  }
}

interface Step {
  /** Replacements that undo the step, in coordinates of the text after it. */
  inverse: { from: number; to: number; insert: string }[]
  forward: { from: number; to: number; insert: string }[]
}

/* eslint-disable @typescript-eslint/no-explicit-any -- messages of the stand-in are whatever the test sends */
export class FakeDocument {
  version = 1
  isDirty = false
  readonly uri: Uri
  private past: Step[] = []
  private future: Step[] = []
  private saved: string
  constructor(
    path: string,
    public text: string,
  ) {
    this.uri = Uri.file(path)
    this.saved = text
  }
  getText(): string {
    return this.text
  }
  positionAt(offset: number): Position {
    const before = this.text.slice(0, offset)
    const lines = before.split('\n')
    return new Position(lines.length - 1, lines[lines.length - 1]!.length)
  }
  offsetAt(position: Position): number {
    const lines = this.text.split('\n')
    let offset = 0
    for (let i = 0; i < position.line; i++) offset += lines[i]!.length + 1
    return offset + position.character
  }

  /** Writes replacements (ascending, in coordinates of the current text) as one change of the document. */
  write(changes: { from: number; to: number; insert: string }[], reason?: TextDocumentChangeReason, record = true): void {
    const before = this.text
    let out = ''
    let at = 0
    let delta = 0
    const inverse: Step['inverse'] = []
    for (const c of changes) {
      out += before.slice(at, c.from) + c.insert
      at = c.to
      inverse.push({ from: c.from + delta, to: c.from + delta + c.insert.length, insert: before.slice(c.from, c.to) })
      delta += c.insert.length - (c.to - c.from)
    }
    out += before.slice(at)
    if (out === before) return
    this.text = out
    this.version++
    if (record) {
      this.past.push({ inverse, forward: changes })
      this.future = []
    }
    this.isDirty = this.text !== this.saved
    // like VS Code: the changes come in descending order, with ranges of the previous text
    const contentChanges = [...changes]
      .sort((a, b) => b.from - a.from)
      .map((c) => ({ rangeOffset: c.from, rangeLength: c.to - c.from, text: c.insert }))
    fake.changed.fire({ document: this, contentChanges, reason })
  }

  undo(): void {
    const step = this.past.pop()
    if (!step) return
    this.future.push(step)
    this.write(step.inverse, TextDocumentChangeReason.Undo, false)
  }
  redo(): void {
    const step = this.future.pop()
    if (!step) return
    this.past.push(step)
    this.write(step.forward, TextDocumentChangeReason.Redo, false)
  }
  markSaved(): void {
    this.saved = this.text
    this.isDirty = false
  }
}

export class FakeWebview {
  html = ''
  options: unknown
  cspSource = 'vscode-resource:'
  readonly posted: any[] = []
  private listeners = new Set<(message: any) => void>()
  asWebviewUri(uri: Uri): Uri {
    return uri
  }
  postMessage(message: unknown): Promise<boolean> {
    this.posted.push(message)
    return Promise.resolve(true)
  }
  onDidReceiveMessage(listener: (message: any) => void): { dispose(): void } {
    this.listeners.add(listener)
    return { dispose: () => void this.listeners.delete(listener) }
  }
  /** The page says something to the host. */
  receive(message: unknown): void {
    for (const l of [...this.listeners]) l(message)
  }
  messagesOf(type: string): any[] {
    return this.posted.filter((m) => m.type === type)
  }
}

export class FakePanel {
  readonly webview = new FakeWebview()
  active = true
  viewColumn = 1
  disposed = false
  private disposeListeners: (() => void)[] = []
  private viewListeners: (() => void)[] = []
  onDidChangeViewState(listener: () => void): { dispose(): void } {
    this.viewListeners.push(listener)
    return { dispose() {} }
  }
  /** The columns `reveal` was called with. */
  revealed: (number | undefined)[] = []
  reveal(column?: number): void {
    this.revealed.push(column)
    this.setActive(true)
  }
  /** The person went to another tab (or came back). */
  setActive(active: boolean): void {
    this.active = active
    for (const l of this.viewListeners) l()
  }
  onDidDispose(listener: () => void): { dispose(): void } {
    this.disposeListeners.push(listener)
    return { dispose() {} }
  }
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const l of this.disposeListeners) l()
  }
}

export const fake = {
  changed: new Emitter<any>(),
  willSave: new Emitter<any>(),
  /** The keys set by `setContext`. */
  contexts: {} as Record<string, unknown>,
  executed: [] as { command: string; args: unknown[] }[],
  /** Commands that fail, by name. */
  failing: new Set<string>(),
  documents: new Set<FakeDocument>(),
  /** The collection `nota` of the panel «Проблемы». */
  problems: undefined as FakeDiagnosticCollection | undefined,
  applyEditDelay: 0,
  reset(): void {
    fake.problems = undefined
    fake.executed.length = 0
    fake.contexts = {}
    fake.failing.clear()
    fake.documents.clear()
    fake.applyEditDelay = 0
    env.language = 'ru'
    workspace.settings = {}
    workspace.scopes = {}
    workspace.updates.length = 0
    env.opened.length = 0
    workspace.workspaceFolders = undefined
    workspace.files.clear()
    workspace.findCalls.length = 0
    workspace.watchers.length = 0
  },
  open(text: string, path = '/work/docs/обзор.adoc'): FakeDocument {
    const doc = new FakeDocument(path, text)
    fake.documents.add(doc)
    return doc
  },
  /** Like Cmd+S: the save participants run (and are waited for), then the document is clean. */
  async save(doc: FakeDocument): Promise<void> {
    const waits: Promise<unknown>[] = []
    fake.willSave.fire({ document: doc, waitUntil: (p: Promise<unknown>) => waits.push(p) })
    await Promise.all(waits)
    doc.markSaved()
  },
}

export enum FileType {
  File = 1,
  Directory = 2,
}

export const env = {
  /** The language of VS Code; tests set it. */
  language: 'ru',
  /** The clipboard of the stand-in. */
  clipboard: { text: '', readText: (): Promise<string> => Promise.resolve(env.clipboard.text) },
  /** The addresses `openExternal` was called with. */
  opened: [] as string[],
  openExternal(uri: Uri): Promise<boolean> {
    env.opened.push(uri.path)
    return Promise.resolve(true)
  },
}

export const workspace = {
  /** The folders of the workspace; none by default. */
  workspaceFolders: undefined as { uri: Uri }[] | undefined,
  /** The `.adoc` files of the stand-in: absolute paths. `findFiles` and `fs` answer from here. */
  files: new Set<string>(),
  fs: {
    stat(uri: Uri): Promise<{ type: FileType }> {
      return workspace.files.has(uri.path) ? Promise.resolve({ type: FileType.File }) : Promise.reject(new Error('not found'))
    },
    readDirectory(uri: Uri): Promise<[string, FileType][]> {
      const base = uri.path.replace(/\/$/, '')
      const seen = new Map<string, FileType>()
      for (const f of workspace.files)
        if (f.startsWith(`${base}/`)) {
          const rest = f.slice(base.length + 1)
          const i = rest.indexOf('/')
          seen.set(i < 0 ? rest : rest.slice(0, i), i < 0 ? FileType.File : FileType.Directory)
        }
      return Promise.resolve([...seen])
    },
  },
  findCalls: [] as { include: string; exclude: string | undefined; max: number | undefined }[],
  findFiles(include: string, exclude?: string, max?: number): Promise<Uri[]> {
    workspace.findCalls.push({ include, exclude, max })
    // (the extensions of a pattern like `**/*.{adoc,asciidoc}`)
    const exts = (/\{([^}]*)\}/.exec(include)?.[1] ?? '').split(',').filter(Boolean)
    return Promise.resolve(
      [...workspace.files]
        .filter((f) => !f.includes('/node_modules/') && (exts.length === 0 || exts.some((e) => f.endsWith(`.${e}`))))
        .map((f) => Uri.file(f)),
    )
  },
  /** Watchers made, so that a test can fire them. */
  watchers: [] as { created: Emitter<Uri>; deleted: Emitter<Uri> }[],
  createFileSystemWatcher() {
    const created = new Emitter<Uri>()
    const deleted = new Emitter<Uri>()
    workspace.watchers.push({ created, deleted })
    return { onDidCreate: created.event, onDidDelete: deleted.event, dispose() {} }
  },
  /** The settings of the section `nota`, by name; none = the default of the manifest. */
  settings: {} as Record<string, unknown>,
  configChanged: new Emitter<{ affectsConfiguration(section: string): boolean }>(),
  /** Where a setting is set (`inspect`): none = the user settings. */
  scopes: {} as Record<string, 'folder' | 'workspace'>,
  /** The calls of `update`: the name, the value, the target. */
  updates: [] as { key: string; value: unknown; target: number }[],
  getConfiguration(_section?: string) {
    return {
      get<T>(key: string, fallback?: T): T | undefined {
        return key in workspace.settings ? (workspace.settings[key] as T) : fallback
      },
      inspect<T>(key: string): { workspaceFolderValue?: T; workspaceValue?: T; globalValue?: T } | undefined {
        if (!(key in workspace.settings)) return {}
        const value = workspace.settings[key] as T
        const scope = workspace.scopes[key]
        return scope === 'folder' ? { workspaceFolderValue: value } : scope === 'workspace' ? { workspaceValue: value } : { globalValue: value }
      },
      async update(key: string, value: unknown, target: number): Promise<void> {
        workspace.updates.push({ key, value, target })
        workspace.setSetting(key, value)
      },
    }
  },
  /** Like a change of the setting in the UI. */
  setSetting(key: string, value: unknown): void {
    workspace.settings[key] = value
    workspace.configChanged.fire({ affectsConfiguration: (section: string) => section === `nota.${key}` || section === 'nota' })
  },
  get onDidChangeConfiguration() {
    return workspace.configChanged.event
  },
  onDidChangeTextDocument: fake.changed.event,
  onWillSaveTextDocument: fake.willSave.event,
  async applyEdit(edit: WorkspaceEdit): Promise<boolean> {
    if (fake.applyEditDelay) await new Promise((r) => setTimeout(r, fake.applyEditDelay))
    const doc = [...fake.documents].find((d) => d.uri === edit.replacements[0]?.uri)
    if (!doc) return false
    const changes = edit.replacements
      .map((r) => ({ from: doc.offsetAt(r.range.start), to: doc.offsetAt(r.range.end), insert: r.text }))
      .sort((a, b) => a.from - b.from)
    doc.write(changes)
    return true
  },
}

export const commands = {
  async executeCommand(command: string, ...args: unknown[]): Promise<unknown> {
    if (command === 'setContext') {
      fake.contexts[args[0] as string] = args[1]
      return undefined
    }
    fake.executed.push({ command, args })
    if (fake.failing.has(command)) throw new Error(`command ${command} failed`)
    // undo and redo act on the document the person is in: the tests have one at a time
    const doc = [...fake.documents][0]
    if (command === 'undo') doc?.undo()
    if (command === 'redo') doc?.redo()
    return undefined
  },
  registerCommand(): { dispose(): void } {
    return { dispose() {} }
  },
}

export const languages = {
  createDiagnosticCollection(): FakeDiagnosticCollection {
    fake.problems = new FakeDiagnosticCollection()
    return fake.problems
  },
}

export const window = {
  registerCustomEditorProvider(): { dispose(): void } {
    return { dispose() {} }
  },
}

export const ConfigurationTarget = { Global: 1, Workspace: 2, WorkspaceFolder: 3 } as const
