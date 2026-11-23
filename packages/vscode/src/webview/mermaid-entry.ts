// The bundle `dist/mermaid.js`: the library of diagrams, loaded by the tab only when the first diagram is shown. It gives itself to the
// tab through a name on the window and does nothing else.
import mermaid from 'mermaid'
;(globalThis as { __notaMermaid?: unknown }).__notaMermaid = mermaid
