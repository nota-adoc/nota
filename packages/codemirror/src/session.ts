/**
 * The session lives in `@nota-adoc/core` (the visual editor needs it without CodeMirror); this package
 * exports it under the same names.
 */
export { createSession } from '@nota-adoc/core'
export type { NotaSession, SessionCallOptions, SessionEvent, SessionOptions } from '@nota-adoc/core'
