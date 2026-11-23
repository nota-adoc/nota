/** The messages between the host (the extension) and a tab (the webview). The text of the VS Code document is the truth. */

import type { Locale } from './strings.js'

export type { Locale }

/** One replacement: UTF-16 offsets of the text the message is about, as in the Nota sessions. */
export interface TextChange {
  readonly from: number
  readonly to: number
  readonly insert: string
}

/** The two modes of a tab. */
export type Mode = 'visual' | 'text'

/** What the window of files lists: `.adoc` files (a link) or pictures (png, jpg, jpeg, gif, svg, webp). */
export type FileKind = 'adoc' | 'image'

/** From a tab to the host. */
export type ToHost =
  /** The page loaded and listens. */
  | { type: 'ready' }
  /** The text changed in the tab; `baseVersion` is the version of the document the changes were made on. */
  | { type: 'edit'; id: number; baseVersion: number; changes: readonly TextChange[] }
  /** Ask VS Code to undo or redo the last step of the document. */
  | { type: 'undo' }
  | { type: 'redo' }
  /** Cmd+click on a link: its target as the document writes it (`https://…`, `mailto:…`, `../a.adoc`). */
  | { type: 'openLink'; href: string }
  /** The field «Другой файл» asks for the `.adoc` files of the folder; `query` is what is typed. The answer is `files` of the same `id`. */
  | { type: 'listFiles'; id: number; query: string; kind?: FileKind }
  /** The answer to the host's `flush`: everything the tab had has been sent and written. */
  | { type: 'flush'; id: number }
  /** The tab failed: `fatal` when it cannot go on (the host shows the screen «не открылся»); otherwise it has shown the document again. */
  | { type: 'error'; message: string; stack?: string; fatal?: boolean }
  /** The tab asks for the text anew (it lost track of the versions). */
  | { type: 'resync' }
  /** The button of the failure screen: «Открыть в текстовом редакторе». */
  | { type: 'openText' }
  /** The button «Настройки Nota»: the Settings of VS Code, filtered by this extension. */
  | { type: 'openSettings' }
  /** The tab is in this mode now (`text` is the source, `visual` the visual editor). */
  | { type: 'mode'; mode: Mode }
  /** The answer to the command `e2e-state` of the suite `npm run test:vscode`: the mode and the selection as offsets in the text. */
  | { type: 'e2e-state'; mode: Mode; anchor: number; head: number; diagrams: number; isles: number; row?: { background: string; compact: boolean; firstGap: number; gapOpen: boolean }; remarks: number; pagemeta?: { badge: boolean; islands: number; tocs?: number }; tbl?: { heads: number[]; widths: number[]; table: number; scrollWidth: number; clientWidth: number; tag: string; drag: boolean; classes: string; errors: number }; tableRow: boolean; floating: number; outline?: { view: string; column: boolean; strokes: boolean; capsule: boolean }; width?: { tab: number; page: number; paragraph: number; table: number; tableScrolls: boolean; codeRows: number; scrollClient: number; scrollOverflows: boolean; padLeft: number; padRight: number; marginLeft: number; marginRight: number; image: number; imageNatural: number; diagram: number; diagramNatural: number; heading: number; list: number; note: number; scrollTop: number } }
  /** Cmd+Shift+V: the tab cannot read the clipboard itself, the host reads it and answers with `clipboard`. */
  | { type: 'readClipboard' }

/** Why the document changed. */
export type ChangeReason = 'undo' | 'redo' | undefined

/** From the host to a tab. */
export type ToTab =
  /** The first message: the whole text. */
  | {
      type: 'init'
      text: string
      version: number
      fileName: string
      /** The language of everything the tab shows: `ru` for a VS Code language `ru…`, `en` for any other. */
      locale: Locale
      /** The width of the page in percent of the tab (`nota.pageWidth`, 50–100); the host always sends it, optional so that the many tests that open a tab by hand need not. */
      pageWidth?: number
      /** Whether the anchors over the blocks are shown (`nota.showAnchors`); the host always sends it, optional for the same reason. */
      showAnchors?: boolean
      /** Which blocks the open capsule shows (`nota.blocksInCapsule`); the host always sends it, optional for the same reason. */
      blocksInCapsule?: 'all' | 'frequent'
      /** The view of the outline «Разделы» (`nota.outlineView`); the host always sends it, a tab without it shows `capsule`. */
      outlineView?: 'capsule' | 'side'
      /** The folder of the file (a path), for the paths of links to other files. */
      fileDir: string
      /**
       * Where the pictures of the file are for the tab: the address of the folder of the file in the webview (`asWebviewUri`),
       * with a slash at the end, and the `:imagesdir:` the document sets ('' when it sets none).
       */
      imageBase?: string
      imagesdir?: string
      e2e?: boolean
      /** The mode to open in: `text` for a big file. */
      mode: Mode
      /** Set for a file above the size limit: its size in bytes of UTF-8; the tab shows the strip «Файл больше 1 МБ». */
      big?: { bytes: number }
    }
  /** The setting `nota.pageWidth` changed: the new percent for an open tab. */
  | { type: 'pageWidth'; percent: number }
  /** The setting `nota.outlineView` changed: the new view for an open tab. */
  | { type: 'outlineView'; view: 'capsule' | 'side' }
  /** The setting `nota.showAnchors` changed: the new value for an open tab. */
  | { type: 'showAnchors'; on: boolean }
  /** The setting `nota.blocksInCapsule` changed: the new set for an open tab. */
  | { type: 'blocksInCapsule'; set: 'all' | 'frequent' }
  /** The text again, whole: after a refused edit or a lost track. `stale` says that typed text was dropped. */
  | { type: 'reset'; text: string; version: number; stale: boolean }
  /** The answer to `listFiles`: paths relative to the folder of the file, at most 50, and how many more there are. */
  | { type: 'files'; id: number; items: readonly string[]; more: number }
  /** A message for the strip of the tab (a link to a file that is not there). */
  | { type: 'notice'; text: string }
  | { type: 'noticeHide' }
  /** The answer to `readClipboard`: the text of the clipboard. */
  | { type: 'clipboard'; text: string }
  /** The answer to an `edit`. */
  | { type: 'ack'; id: number; version: number }
  /** The document changed by another source; the changes are in coordinates of the previous version. */
  | { type: 'update'; version: number; changes: readonly TextChange[]; reason: ChangeReason }
  /** Send what is not sent yet and answer with `flush` of the same id. */
  | { type: 'flush'; id: number }
  /** A command of a key that VS Code gets first: a mark (`strong`, `em`, `code`, `strike`, `highlight`), `toggle-mode`, or `reveal`
   * (put the cursor at `offset`: a click on a problem). The suite `npm run test:vscode` types and undoes through `e2e-type` and
   * `e2e-undo`: a page answers them only when the host started with `NOTA_E2E=1`. */
  | { type: 'command'; name: string; text?: string; offset?: number }
