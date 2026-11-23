// Render a document to HTML, as Asciidoctor writes an embedded document.
// Run from the root of the repository: npx tsx examples/render.ts
import { parse } from '@nota-adoc/core'
import { renderHtml } from '@nota-adoc/html'

const doc = parse('= Hello\n\nSome *bold* text.\n')
console.log(renderHtml(doc))

// Output:
// <div class="paragraph">
// <p>Some <strong>bold</strong> text.</p>
// </div>
