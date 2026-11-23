/// <reference types="vite/client" />

import type { NotaSession, SourceEditor } from '@nota-adoc/codemirror'
import type { VisualEditor } from '@nota-adoc/prosemirror'

declare global {
  interface Window {
    /** The editors of the visual page, for the console and for its tests. */
    notaDemo?: { session: NotaSession; visual: VisualEditor; source: SourceEditor }
  }
}
