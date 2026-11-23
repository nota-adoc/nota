# @nota-adoc/html

HTML for [Nota](../core/README.md) documents: the output of the html5 backend of Asciidoctor 2.0 for an
embedded document, written from the syntax tree of `@nota-adoc/core`. It runs in browsers and in Node.js 20+
(ESM only), needs no DOM, and its one dependency is `@nota-adoc/core` (the public entry and `@nota-adoc/core/internal`, which is
not an API for applications). The build for the browser is about 16 KB
gzip without the core.

```ts
import { parse } from '@nota-adoc/core'
import { renderHtml } from '@nota-adoc/html'

renderHtml(parse('Привет, *мир*!'))
// <div class="paragraph">
// <p>Привет, <strong>мир</strong>!</p>
// </div>
```

## API

### `renderHtml(doc: NotaDocument, options?: RenderOptions): string`

The HTML of a document: sections with their ids and numbers, every block of stages 1 and 2, inline markup, the
table of contents (`:toc:`, `toc::[]`), and the footnotes at the end. It never throws: any text that `parse`
takes gives a string.

- **Attributes** come from the document: the header, the entries in the body (each takes effect at its place)
  and the `attributes` of `ParseOptions`, which Nota reads like `Asciidoctor.load(…, { attributes })` (a value
  locks the attribute). `RenderOptions` has no members yet.
- **What it compares with.** The output is the `convert` of Ruby Asciidoctor 2.0.26 in the `secure` safe mode,
  without `standalone` (no `<html>`, `<head>`, `<body>`, no title unless `showtitle` is set). In that mode
  `source-highlighter` and `icons` are locked, so a listing has no highlighting and admonitions no icons, as
  in the reference. Whitespace between elements is written as Asciidoctor writes it.
- **Cross references to other documents**: `xref:path.adoc#id[]` becomes an `href` by the rules of Asciidoctor
  (`.adoc` becomes `.html`); a resolver for a set of documents and reports of broken references are stage 5.
- **Includes**: an `include::` line is a node of the tree. Without `ParseOptions.resolver.include` (or when it gives `null` for the
  file) it writes nothing (the reference reads it as the text `link:target[role=include]` in `secure` mode). When the
  resolver gives the text of the file, its HTML stands in the place of the line: the text is read as a document of its own with the attributes
  in force at the line, and its sections get their ids and numbers on their own (see `@nota-adoc/core`, «Meaning: ASG,
  outline, references»). Asciidoctor reads the files as one text with the document; the mirror of the corpus has no includes to compare with.
- **Tables** are written as Html5Converter 2.0.26 writes them: the `<table>` with the classes of `frame`, `grid`,
  `stripes` and `width` (or `%autowidth`), the caption (`Table 1. Title`), the `<colgroup>` with the widths of the
  columns, the `<thead>`, `<tbody>` and `<tfoot>` sections, `colspan`, `rowspan`, the alignment classes
  (`halign-left`, `valign-top`, …) and the styles of the cells (`a d e h l m s v`). A cell with the `a` style holds
  the HTML of its own document (blocks, lists, nested tables), and a `++++` block deeper than four levels is written as
  it is. A cell with a fill (the label `[.cell-yellow]##{empty}##` at the start of its text, see the section on tables in
  `@nota-adoc/core`) is written with the role as the last class of the `td`/`th` (`class="tableblock halign-left valign-top
  cell-yellow"`) and without the empty `span` that Asciidoctor writes for the label, so that the whole cell can be filled by the
  CSS of the host; a cell that holds nothing else is an empty `<td>` without a `<p>`. This is a deliberate difference from
  Asciidoctor, and there is no option to turn it off. A table is read by `@nota-adoc/core` (see the section on tables there); this package only writes its layout.
- **Deep nesting**: blocks nested more than 300 levels deep are left out of the HTML (the converter, like the
  parser of Asciidoctor, works on the stack); such a document is still read and never throws.

### `renderHtmlBlocks(doc): { html: string; blocks: BlockHtml[] }`

For tools that compare documents block by block (the quality bench of Nota does): the HTML of the document and,
for each block, its context (`paragraph`, `section`, `listing`, `ulist`, …), the range of the source it covers, its
HTML and the blocks in it — the blocks of a section, of a compound block and of the items of a list.

## Safety

The output is HTML that can contain what the author wrote in a passthrough: `+++<script>…</script>+++` and
`pass:[…]` are written as they are, as Asciidoctor does in `secure` mode (it is the mode of the _reader_; the
converter does not sanitize). **Cleaning the HTML (for example with DOMPurify) before it is shown is up to the
host.** Text between markup is escaped (`&`, `<`, `>`), and attribute values that the author gives (a `role`, an
`id`, a link target) are written between double quotes without further escaping, as Asciidoctor does.

## What is not here yet

- `standalone` documents (the page with a `<head>`), themes and syntax highlighting.
- Asynchronous resolvers: the resolver of the host is synchronous, the host loads what it needs before it parses.

License: MIT.
