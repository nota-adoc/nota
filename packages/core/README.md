# @nota-adoc/core

Lossless AsciiDoc parser. The source text is the truth: the parser marks it up with a
[Lezer](https://lezer.codemirror.net/) syntax tree in which every character belongs to exactly one
leaf, so the leaves read in order spell the input exactly — including blank lines, comments,
trailing whitespace, line endings and a byte order mark. There is no printer: saving a document
means saving its text.

Block structure follows Asciidoctor 2.0 (the Ruby implementation is the reference) and is checked
against it by the quality bench in `quality/`.

Stage 1 covers the document header, sections, paragraphs, comments and attribute entries.
Stage 2 adds every block except tables: lists (bulleted, ordered, description and callout lists,
checklists, nesting, continuation and attached blocks), blocks with delimiters with their content
parsed (example, sidebar, quote, open, admonition blocks, and nested ones), blocks without parsing
(listing, literal, passthrough, stem, comment, verse, fenced code), block macros (`image::`,
`video::`, `audio::`, `toc::[]` and the names you register), thematic and page breaks, the
Markdown legacy Asciidoctor reads (` ``` ` fences, `>` quotes, `---` and `***` breaks), and the
preprocessor: conditional directives (`ifdef`, `ifndef`, `ifeval`, `endif`) are evaluated with the
document attributes, lines that are off and directive lines stay in the tree untouched, and
`include::` is a node with its target and attributes (nothing is included). Include resolvers are a
later stage.
Stage 3 adds tables: `|===`, `!===`, `,===` (CSV) and `:===` (DSV), `cols`, the specs of a cell (spans,
repeats, alignments, styles), the implicit header, and cells of style `a` that hold a document of their own,
nested to any depth (see «Tables» below).
Stage 4 adds inline markup: the whole chain of substitutions of Asciidoctor (passthroughs, special
characters, quotes, attribute references, replacements, macros, line breaks), read into the same tree as
nodes with ranges (see «Inline markup» below), with the sets of substitutions of each kind of block and of
`subs=`, and the attributes that change how text is read (`experimental`, `compat-mode`, `hardbreaks`).
The HTML of a document is `@nota-adoc/html`, which takes this tree.

Runs in browsers and Node.js 20+; ESM only; the one runtime dependency is `@lezer/common`.

Runnable examples (parse, walk the tree and the outline, render) are in [examples/](../../examples/); every export has a
description and, for the main ones, an example in its TSDoc comment, which your editor shows on hover. How the output
differs from Asciidoctor: [docs/asciidoctor-differences.md](../../docs/asciidoctor-differences.md).

## API

```ts
import { parse } from '@nota-adoc/core'

const doc = parse(text)
doc.text // the source, unchanged
doc.tree // Lezer Tree; doc.tree.length === text.length
doc.diagnostics // [{ from, to, severity, code, message }]

const next = doc.update([{ from: 10, to: 12, insert: 'new text' }])
// `next` equals parse(newText) node for node; `doc` is not modified
```

### `parse(text: string, options?: ParseOptions): NotaDocument`

Parses any string without throwing: malformed markup, control characters, lone surrogates and
very long lines are all kept. Deeply nested input (blocks, quotes, conditions) is parsed without
recursion on the call stack.

```ts
interface ParseOptions {
  attributes?: Record<string, string | number | boolean | null>
  blockMacros?: readonly string[]
  resolver?: Resolver
  colorRoles?: readonly string[]
}
```

| Option | Meaning |
|---|---|
| `attributes` | Document attributes, taken like `Asciidoctor.load(…, { attributes })`: a string sets the attribute **and locks it** (the document cannot change it); `null`, or a name with a leading or trailing `!`, unsets and locks; `false` unsets without locking; a value that ends in `@` (or a name that ends in `@`) sets without locking. They start conditions (`ifdef::name[]`) and `ifeval` expressions, and are the starting point of the attributes the document itself sets. |
| `blockMacros` | Names of block macros (`name::target[attributes]`) that are read as macros, like an extension registered in Asciidoctor. `image`, `video`, `audio` and `toc` are always macros. Any other `name::target[…]` line is a paragraph, with an `info` diagnostic. |
| `resolver` | What the host knows about other files: `xref(path, id)` for cross references to other documents and `include(target, attrs)` for `include::` lines. See «Meaning: ASG, outline, references». |
| `colorRoles` | The roles the host knows as colours, for `colors()`: a role in the list is a colour even without the prefix `hl-`. See «Colour». |

The options belong to the document: `doc.update(…)` uses the same ones.

### Default attributes

Before the first line of the document the attributes are those `Asciidoctor.load` sets in its default
`secure` mode (Asciidoctor 2.0.26), minus the ones that depend on the environment: the paths
(`docdir`, `user-home`, `stylesdir`, `iconsdir`) and the dates and times (`localdate`, `localyear`,
`localtime`, `localdatetime`, `docdate`, `docyear`, `doctime`, `docdatetime`) — set those through
`ParseOptions.attributes` if a condition tests them. `DEFAULT_ATTRIBUTES` exports the map.

| Attribute | Value | Attribute | Value |
|---|---|---|---|
| `attribute-undefined` | `drop-line` | `attribute-missing` | `skip` |
| `appendix-caption` | `Appendix` | `appendix-refsig` | `Appendix` |
| `caution-caption` | `Caution` | `chapter-refsig` | `Chapter` |
| `example-caption` | `Example` | `figure-caption` | `Figure` |
| `important-caption` | `Important` | `last-update-label` | `Last updated` |
| `note-caption` | `Note` | `part-refsig` | `Part` |
| `prewrap` | (empty) | `sectids` | (empty) |
| `section-refsig` | `Section` | `table-caption` | `Table` |
| `tip-caption` | `Tip` | `toc-placement` | `auto` |
| `toc-title` | `Table of Contents` | `untitled-label` | `Untitled` |
| `version-label` | `Version` | `warning-caption` | `Warning` |
| `notitle` | (empty) | `embedded` | (empty) |
| `asciidoctor` | (empty) | `asciidoctor-version` | `2.0.26` |
| `safe-mode-name` | `secure` | `safe-mode-secure` | (empty) |
| `safe-mode-level` | `20` | `max-include-depth` | `64` |
| `backend` | `html5` | `max-attribute-value-size` | `4096` |
| `linkcss` | (empty) | `doctype` | `article` |
| `htmlsyntax` | `html` | `backend-html5-doctype-article` | (empty) |
| `doctype-article` | (empty) | `backend-html5` | (empty) |
| `outfilesuffix` | `.html` | `filetype` | `html` |
| `filetype-html` | (empty) | `basebackend-html-doctype-article` | (empty) |
| `basebackend-html` | (empty) | `basebackend` | `html` |
| `authorcount` | `0` | | |

In `secure` mode the document cannot change `embedded`, `asciidoctor`, `asciidoctor-version`,
`safe-mode-*`, `max-include-depth`, `max-attribute-value-size`, `linkcss`, `backend`, `docdir`,
`user-home` and the ones that are unset (`icons`, `copycss`, `source-highlighter`, `allow-uri-read`).
Entries in the header and the body set and unset the others as the parser reads them; values get the
substitutions of `apply_attribute_value_subs` (special characters, `{name}` references, `pass:[…]`).
The header sets `doctitle`, `author`, `authors`, `authorcount`, `firstname`, `middlename`,
`lastname`, `authorinitials`, `email`, `revnumber`, `revdate` and `revremark` the way Asciidoctor does,
and a `:doctype:` entry in the header updates the `doctype-…` attributes. Conditions and `ifeval`
see what is set at the moment their line is read.

### `NotaDocument`

| Member                                                 | Description                                                           |
| ------------------------------------------------------ | --------------------------------------------------------------------- |
| `text: string`                                         | The source text.                                                      |
| `tree: Tree`                                           | The syntax tree (`@lezer/common`). Named node types are listed below. |
| `diagnostics: readonly Diagnostic[]`                   | Problems in document order.                                           |
| `update(changes: readonly TextChange[]): NotaDocument` | Applies changes and reparses incrementally.                           |
| `options: ParseOptions`                                | The options the document was parsed with (its updates use them too).  |
| `attributesAt(pos)`, `attributesAfterHeader()`         | The document attributes at the start of the unit that holds `pos`; the ones the body starts with. |
| `tableAt(pos): TableModel \| null`                     | The table that holds `pos` (the innermost one, for a table inside a cell); `null` outside a table. See «Tables». |
| `asg(): AsgDocument`, `nodeAt(pos): AsgNode \| null`   | The Abstract Semantic Graph of the document, and its deepest node that holds `pos`. See «Meaning: ASG, outline, references». |
| `outline()`, `footnotes()`, `references()`             | The sections with their ids and numbers, the footnotes, the cross references. Same section. |
| `colors()`, `colorAt(pos)`                             | The roles of colour on marked-up text with their exact ranges; the roles in force at `pos`. See «Colour». |
| `styleProfile(): StyleProfile`                         | How the document is written: its list markers, tables, delimiters, blank lines. See «Style profile». |

### `TextChange`

`{ from: number, to?: number, insert?: string }` — replace `from`–`to` of the current text with
`insert`, like a CodeMirror `ChangeSpec`. All changes of one call are in coordinates of the text
before the call; they may come in any order but must not overlap (a `RangeError` is thrown
otherwise).

Positions everywhere are UTF-16 code unit offsets, as in JavaScript strings, CodeMirror and
ProseMirror.

### Incremental reparsing

The parser works in units: blank lines, a run of metadata lines and one block or section title. A
list, a block with delimiters and everything inside it is one unit, so an edit inside reparses the
whole block.
Each unit depends only on the text from its start and on the parser state there (header or body,
`doctype`, `leveloffset`, the open sections, the document attributes and the open conditions). After an edit, units that ended before the edit
are kept; parsing restarts at the first unit that could have seen the edited text and stops as
soon as a new unit ends where an old unit after the edit starts in the same state. The rest is
reused. The result is always identical to a full parse (fuzz-tested in `quality/fuzz`).

### `Diagnostic`

`{ from, to, severity: 'error' | 'warning' | 'info', code, message }`

| Code | Severity | When |
|---|---|---|
| `unterminated-block` | warning | A `////` comment block or a block with delimiters has no closing line; it extends to the end of its container (the end of the document for an outer block). The range is the opening delimiter. |
| `section-level-skipped` | warning | A section title is more than one level deeper than its parent (`==` then `====`). |
| `level-0-section-in-article` | error | A level 0 section (`= Title`) in the body of a document whose doctype is not `book`. |
| `unterminated-conditional` | warning | An `ifdef`, `ifndef` or `ifeval` has no `endif` before the end of the document. The range is the directive line. |
| `unmatched-endif` | error | An `endif` without a conditional that is open, or with a target that is not the one of the conditional it closes. |
| `malformed-directive` | error | A conditional directive that cannot be evaluated: `ifdef::[]` and `ifndef::[]` without a target, `ifeval` without an expression or with one that is not `left operator right`, `ifeval` with a target, `endif` with text. The line is dropped, as Asciidoctor does. |
| `list-item-as-text` | info | A line inside a paragraph that looks like a list item (`text` then `* item`): Asciidoctor reads it as text, a list starts after a blank line. The range is that line. Not reported in a comment, a literal or another verbatim paragraph, where the line is dropped or shown as it is. |
| `list-item-index` | warning | The number of an ordered item is not the next one (`1.` then `3.`, `a.` then `c.`), or a callout is not numbered in order, as Asciidoctor warns. |
| `table-missing-separator` | warning | The first cell of a table in the `psv` format has no separator before it (the first line does not start with `\|`). Asciidoctor recovers by reading the text as a cell; so does the parser. The range is the line of that cell. |
| `table-incomplete-row` | warning | The cells at the end of the table do not fill a row: they are dropped, as Asciidoctor does. Not in the `TableModel` (their `TableCell` nodes stay in the tree). The range is the line where the first dropped cell starts. |
| `table-cell-dropped` | warning | A cell makes its row wider than the columns (`3+\|x` in the second column of two): Asciidoctor drops the row, the cells before it too. Their `TableCell` nodes stay in the tree, the model has no row for them. The range is the line where the cell that did not fit starts. |
| `unknown-block-macro` | info | A line `name::target[…]` whose name is not `image`, `video`, `audio`, `toc` or in `ParseOptions.blockMacros`: it is read as a paragraph. |
| `duplicate-id` | warning | A second `[[id]]`, `[#id]`, `[id=…]` or inline `[[id]]` with an id that is already declared. The range is the second declaration (the id for the `#id` form, the attribute for `id=`). |
| `line-read-as-attributes` | info | A line in square brackets with a space in it (`[see below]`) above a paragraph: Asciidoctor takes it for the attributes of the block (the style `see below`) and the line is not shown. Not given for `[source,ts]`, `[NOTE]`, `[#id.role]`, `[cols="2"]`, a quoted text or a line with `=`. |
| `header-attribute-in-body` | info | `:toc:`, `:toc-placement:`, `:source-highlighter:` or `:doctype:` below a blank line after the header: Asciidoctor reads these in the header only. |
| `unresolved-reference` | warning | `<<id>>` or `xref:id[]` with no anchor or section id `id` in the document (a reference with `{…}` in it is not checked); or a reference to another document (`xref:other.adoc#b[]`) that `resolver.xref` answers with `null`. Without `resolver.xref` a reference to another document is not judged. The range is the reference. |
| `unresolved-include` | warning | `include::target[]` for which `resolver.include` returns `null`. Without `resolver.include` an include line is not judged. The range is the line. |
| `undefined-attribute` | info | A reference `{name}` to an attribute that is not defined (and is not a built-in one) where the text is read. The range is the reference. Asciidoctor says nothing by default (`attribute-missing: skip`) and leaves the reference as it is. |
| `unknown-color-role` | info | Only with `colorRoles`: a role `hl-*` on marked-up text (`[.hl-mnit]#x#`) that is not in the registry, probably a typo. The range is the name of the role. Without `colorRoles` there is none. |

### Other exports

- `nodeSet`, `nodeTypes`, `NodeNames`, `Type` — node types of the tree (`Type.Paragraph` is the id).
- `blockKind` — a per-node `NodeProp<string>` on `DelimitedBlock`: what the block is once its style is
  applied (see below). Read it with `node.tree?.prop(blockKind)`.
- `tableModel` — a per-node `NodeProp` on the `DelimitedBlock` of a table: the layout of the table without positions
  (the model `NotaDocument.tableAt` builds its result from). Read it with `node.tree?.prop(tableModel)`; the types
  `TableModel`, `TableColumnModel`, `TableRowModel`, `TableCellModel`, `TableCellStyle` are exported too.
- `DEFAULT_ATTRIBUTES` — the attributes defined before the first line (see above).
- `createSession`, `applyOperation` — see «Sessions» and «Operations: `applyOperation(doc, op)`» below.
- `sectionLevel` — a per-node `NodeProp<number>` on `Section` and `DiscreteHeading`:
  the effective level as Asciidoctor computes it (marker level plus `leveloffset`, special section
  styles such as `[appendix]` on a level 0 title give level 1). Read it with
  `node.tree?.prop(sectionLevel)`.
- `parseAttributeList(text)` — the attribute list scanner (a port of Asciidoctor's AttributeList)
  with source offsets; `parseShorthand(value)` splits `style#id.role%option`;
  `BlockAttributes` merges metadata lines the way Asciidoctor does.
- `delimitedBlock(line)` — the delimited block context, tip and closing line of an opening line.
- `substitute(text, pieces, subs, env)` — the substitutions of Asciidoctor over `text` (or its `pieces`, ranges
  joined with line feeds), as HTML: `substitute('*a*', null, NORMAL_SUBS, { get: () => undefined })` is
  `<strong>a</strong>`. `env` (`InlineEnv`) gives the attributes (`get`, and `set`/`counter` for `{set:}` and
  `{counter:}`), the attributes of the block (`block`) and what cross references and footnotes need
  (`hasRef`, `resolveId`, `xrefText`, `addFootnote`, `footnote`, `imageUri`). `@nota-adoc/html` uses it.
- `NORMAL_SUBS`, `resolveSubs(value, type, defaults)` and `blockSubs(defaults, subs)` — the normal set of
  substitutions and the `subs=` values.
- `textPieces` — a per-node `NodeProp<readonly number[]>` on a `TextLine` that spans lines (see «Inline markup»).
- `DEFAULT_STYLE_PROFILE`, `StyleProfile`, `DelimiterLengths`, `ApplyOptions`, `BlockSpec`, `BlockKindName`, `ListKind`,
  `AdmonitionVariant` — the types of «Style profile» and «Operations on blocks, sections and lists».
- `Resolver`, `AsgDocument`, `AsgNode`, `AsgLocation`, `AsgPosition`, `AsgRange`, `AsgAuthor`, `OutlineEntry`,
  `FootnoteEntry`, `ReferenceEntry` — the types of «Meaning: ASG, outline, references».
- `NotaDocument.options` and `NotaDocument.attributesAfterHeader()` give a converter the starting point of the
  attributes of a document.

### Meaning: ASG, outline, references

The tree is the text; these give what the text means. All are computed on first use and kept with the document.

```ts
const doc = parse(text, { resolver })
doc.asg() // the Abstract Semantic Graph: JSON in the shape of the ASG schema of the Eclipse AsciiDoc project
doc.nodeAt(pos) // the deepest node of the ASG whose range holds pos
doc.outline() // [{ id, level, title, number, inToc, from, to }]
doc.footnotes() // [{ number, id, text, from, to }]
doc.references() // [{ target, resolved, from, to, path, id, title? }]
```

**`asg()`** — the document as the schema of `asciidoc-lang` (`asg/schema.json`, draft 01) has it: `name`, `type`, `blocks`,
`inlines`, `title`, `metadata`, `level`, `marker`, `items`, `principal`, `terms` and the rest, as the schema names them
(`header` has `title`, `authors` and the `attributes` the header sets are at the root). Every node also has
`location` (`[{ line, col }, { line, col }]`, line and column from 1, both ends inclusive, as the schema and the TCK
have it) and `range` (`[from, to]`, UTF-16 offsets in `text`, `to` exclusive): `text.slice(from, to)` is the source of
the node (a section: from its metadata lines to the end of its last block; white space at the end is left out).
`range` is not in the schema; leave it out (`JSON.stringify(asg, (k, v) => (k === 'range' ? undefined : v))`) to
validate the ASG or to hand it to a tool that checks the schema. The ASG is plain JSON (`JSON.stringify` does not throw).

What the draft has no place for is written in the nearest shape it has, and the way is part of the API:

- a **table** is a `literal` block with `form: 'delimited'`, the delimiter of the table and its source as one `text`;
- a **paragraph with a label** (`NOTE: text`) is a `paragraph` with `metadata.attributes.style` set to the label (the
  schema has admonitions with delimiters only); an `[NOTE]` block with delimiters is an `admonition`;
- a block with the style `[quote]`, `[example]` and the like that is a paragraph is a `paragraph` with its style in
  `metadata.attributes.$1`; styles `listing`, `source`, `literal`, `pass`, `stem`, `verse` give that kind of leaf block with `form: 'paragraph'`;
- the `value` of a `text` node is the text as it reads: a backslash that keeps a construct from being read (`\*a*`,
  `\{b}`, `\<<c>>`, `\https://z`, `\(C)`) is not in it, while `range` is still the whole source (`text.slice(from, to)`
  has the backslashes);
- text that Asciidoctor reads as inline markup other than strong, emphasis, monospace, highlight, links and
  cross references (superscript, replacements, attribute references, quotes) stays as it is written in a `text` node;
  a passthrough is a `raw` node; an anchor `[[id]]` inside a text is not a node;
- a comment block has no node; a discrete heading is `heading`;
- an `include::` line: see below.

**`nodeAt(pos)`** — the deepest node whose range holds `pos` (`from <= pos < to`; at the end of a node, `pos === to`,
when no node starts there); `null` outside the text. The parts from an `include::` are found as one node.

**`outline()`** — every section and discrete heading, in the order of the text: `id` (the one the author gave, else the
one Asciidoctor makes from the title: `:idprefix:` and `:idseparator:` apply, titles with markup included, repeats
get `_2`, `_3`; `null` when `:sectids:` is unset and none is given), `level`, `title` (as written, without an anchor at
its end), `number` (`'1'`, `'1.2'`, `'A'` with `:sectnums:`, else `null`), `inToc` (a section, not a heading, of
level at most `:toclevels:`, 2 by default) and `from`–`to` (from the first metadata line to the end of the section).
`@nota-adoc/html` and `documentTargets` of `@nota-adoc/codemirror` take ids from the same model: there is one set of ids.

**`footnotes()`** — the footnote macros in the order of the text. `number` counts from 1; `footnote:a[]` (and
`footnoteref:a`) after `footnote:a[text]` has the number and the `text` of that footnote.

**`references()`** — the cross references (`<<id>>`, `<<file.adoc#id,text>>`, `xref:target[]`): `target` as written,
`path` (the other document, `null` for this one) and `id`, and `resolved`: a target in this document is resolved when an
anchor or a section has the id; a target in another document is resolved unless the resolver says otherwise (`title`
is what it gave). Without `resolver.xref` a reference to another document is taken as resolved and gets no diagnostic.

**`resolver`** — both functions are synchronous (the host loads what it needs before it parses) and may be called again
for every document that is built from the text, so they should be cheap and answer the same way each time:

```ts
interface Resolver {
  xref?(path: string, id: string | null): { title?: string } | null
  include?(target: string, attrs: Readonly<Record<string, string>>): string | null
}
```

**`include::`** — the tree and `text` are the text of the document only: the tree has an `IncludeDirective` for the
line whether or not the resolver knows the file, and `doc.text === text` always. When `resolver.include` gives the
text of the file, it is read as a document of its own, with the attributes in force at the line (and `leveloffset`
of the line added; the `leveloffset` is the level of the parse at the line, and a `{set:leveloffset:…}` in text does not change it), and its blocks stand in `asg()` and in the HTML of `@nota-adoc/html` in the place of the line.
Their `location` has `file: [target]` in both points and their `range` is that of the line. The included part does not
change the attributes of the document below it, its sections are numbered on their own and a part that includes itself
is cut after 10 levels. A section that comes from an include stands in the block that holds the line: after `== A` and
`include::p.adoc[]` with `== P`, `P` is a subsection of `A` here, while Asciidoctor, which reads the files as if they were
one text, makes it a sibling of `A` (the tree has the text after the line inside `A`, and the included blocks stand where
the line is). The ids of the included parts are known targets of references, and the texts of their titles too; the
included documents are kept by their text and the attributes of the place, so an `update` does not read them again.
All this differs from Asciidoctor, and the
mirror of the open corpus has no includes to compare with. Without a resolver (or when it returns `null`) the line is a
node `{ name: 'pass', inlines: [{ name: 'raw', … }], metadata: { attributes: { include: target } } }`, with a
warning `unresolved-include` in the second case only. An include inside a block or a list item that brings in sections
gives headings there (the schema has sections in sections only).

### Colour

```ts
const doc = parse('Text with [.hl-mint]#colour# in it.', { colorRoles: ['hl-mint', 'marker-red'] })
doc.colors() // [{ role: 'hl-mint', known: true, from, to, pieces: [ColorPiece], container: { kind: 'paragraph', … } }]
doc.colorAt(pos) // ['hl-mint']: the roles in force at pos, from the outside in
```

Colour is a property of text: a role that is a colour on marked-up text `[.role]#…#`, `##…##`, `*…*`, `_…_`, `` `…` ``,
`^…^`, `~…~` and the quotes, wherever Asciidoctor shows it: paragraphs, titles of the document, sections and
discrete headings, block titles, list items, terms, admonitions, cells of tables of any depth (the `a` ones too) and the
text of links and cross references, and in `pass:q[…]` (the passthrough that runs the quotes; its brackets are `\]` for
the colour that closes `[…]` inside it: `pass:q[[.hl-mint\]#x#]`). A visible `((…))` is the text of its place. Not in
listings, literal blocks and paragraphs, literal cells, other passthroughs, comments, lines of a condition that is off, attribute values, escaped markup; and the role of a block (`[.hl-mint]`
above a paragraph) or of a link (`role=`) is not colour of text. A role that holds `{…}` is not read.

A role is a colour when it begins with `hl-` (and goes on) or is in `colorRoles`; the engine knows no names.
`known` says whether the role is in `colorRoles` (`false` without it, and then there are no hints); a role `hl-*`
that is not in a given `colorRoles` gets the diagnostic `unknown-color-role`.

- **`ColorRun`** (`colors()`) — one role on a continuous piece of text: `role`, `known`, `from`–`to` (the text coloured,
  from the start of the text of the first piece to the end of the last one), the `pieces` and the `container`.
  Pieces join into one run when only marks and attributes lie between them (`[.hl-mint]##a##[.hl-mint]##b##`, or
  colour that crosses the start of bold); a space, a line break, a hard break, an image or another place (cell,
  item) breaks the run. A piece with several colours is in a run of each.
- **`ColorPiece`** — one construct of the source: `kind` (`mark`, `strong`, `emphasis`, `code`, `superscript`, `subscript`,
  `double-quoted`, `single-quoted`), `form` (`constrained` or `unconstrained`), and the ranges `attrs`, `open`, `inner`,
  `close` that lie end to end from `from` to `to` (so the source is rebuilt byte for byte), `roles` (all of them, in the order
  written, each with its own range, `color` and `known`), `colors` (the colour ones) and `within`: the constructs around it
  (`strong`, `emphasis`, `link`, `xref`, …).
- **`ColorContainer`** — `kind` (`paragraph`, `heading`, `block-title`, `list-item`, `term`, `admonition`, `cell`, `block`),
  its range and `depth`: the number of tables around.
- **`colorAt(pos)`** — the colour roles of the pieces whose text holds `pos`, outside in, without repeats; `[]` elsewhere.

The text of plain cells (the tree holds it as a leaf) is read from the source of the cell, paragraph by paragraph.
`colors()` is worked out on the first call and kept with the document; `update` gives a document that works it out again.
In the visual editor (`readInline`) `pass:q[…]` and a visible `((…))` without markup are cells of text (they lie in a span of
the type `lock`: its `open` and `close` are `pass:q[` and `]`, or `((` and `))`), and their text is not edited: an edit that
cuts one is refused with `inside-construct`, one that holds it whole deletes it. The colour operations are not changed:
`colors()` sees colour inside `pass:q[…]`, but `setColor`, `replaceColor` and `removeColor` do not put it there or take it
off (`not-colorable` for a range inside it, `inside-construct` for an end inside it). Other passthroughs stay plates.

### Colour operations

`applyOperation` puts a colour on a range of text, changes it, or takes it off. The role is a parameter (the engine knows
no names): it has to be a colour by the rule above (`hl-…`, or in `colorRoles`), else the refusal is `invalid-role`.
`from`–`to` are offsets of the text; a character is a visible character (the attributes `[…]` and marks of coloured text
are not characters).

| `kind` | Fields | What it does |
|---|---|---|
| `setColor` | `from`, `to`, `role` | Adds `role` to the colours of every character of the range: `text` → `[.hl-mint]#text#`; the role goes on a strong, emphasis or code that is the whole range (`[.hl-mint]*b*`), or is appended to a piece (`[.hl-plum.hl-mint]#x#`); `##` is used inside a word or next to a blank; pieces of the same colour that touch are joined. |
| `replaceColor` | `from`, `to`, `role`, `replace?` | Every character of the range gets exactly `role` of the colours (the other roles and ids stay); with `replace` only the characters that have that role change it for `role`. |
| `removeColor` | `from`, `to`, `role?` | Takes `role` (all the colours without it) off the range; a piece that is left with no role loses its `[…]` and marks (a strong, only the `[…]`); a piece is cut where the range ends inside it. Where there is no colour the changes are `[]`. |

Only attributes, marks and the names of roles are written; the text, the other marks and the source outside of the places
touched stay as they are. Refusals (`{ error, diagnostics }`, the document is not changed): `invalid-role`, `empty-selection`
(no characters in the range), `invalid-range`, `not-colorable` (a listing, a comment, `pass:[…]`, a literal block, … — no
colour shows there), `inside-construct` (an end of the range is inside a target of a link, an image, `+…+`),
`collateral` or `unstable` (the colour cannot be written so that it reads as asked, or something else would read
differently: a two-line title, say). A blank next to a changed character may join a piece of the same colour or be left
out of one (`[.hl-mint]#one two three#` without `two` is `[.hl-mint]#one# two [.hl-mint]#three#`).

### Sessions

A **session** is the text of one document, its `NotaDocument` and one undo history; anything that edits or shows the
text (source editors, the visual editor, a preview) works through it.

```ts
import { createSession } from '@nota-adoc/core'

const session = createSession(text, { parse: { attributes: { flavor: 'x' } }, groupDelay: 500, depth: 10_000 })
const stop = session.subscribe((e) => console.log(e.kind, e.changes)) // 'apply' | 'undo' | 'redo'
session.apply([{ from: 0, insert: 'x' }], { origin: 'me' })
session.undo()
```

`NotaSession`: `text`, `doc`, `parseOptions`, `apply(changes, { origin?, time? })` (a `RangeError` on invalid ranges),
`undo({ origin? })`, `redo({ origin? })` (false when there is none), `canUndo`, `canRedo`, `subscribe(listener)`
(the events carry the replacements in coordinates of the text before, the `origin` and the document after). The
history is a stack of text replacements: every step keeps the replacement that undoes it, so undoing every step gives
the first text byte for byte, whoever made the edits. Steps of the same `origin` that come less than `groupDelay` ms
apart and touch each other are one step (typing). `@nota-adoc/codemirror` exports the same `createSession`.

### Operations: `applyOperation(doc, op)`

The edits of an editor, as replacements of the text: `applyOperation(doc, op, options?)` (`options.profile`: see «Style profile») gives `{ doc, changes }` (the document
after the changes, and the changes, in coordinates of `doc`) or `{ error, diagnostics }` and no change. It works in
Node without an editor. An operation does not change anything but its target: what it writes is read again and must
read exactly as asked (marks on the characters asked for, the other blocks the same), and text that would read as
markup is written with a backslash in front of it (`*x*` typed is `\*x*`; `**x**` after a word is `\\**x**`).

| `kind` | Fields | What it does |
|---|---|---|
| `insertText` | `at`, `text`, `marks?` | Text typed at `at` (inside the marks that hold the position; `marks.add` / `marks.remove` name marks the text gets or does not). Into an empty paragraph too. |
| `deleteRange` | `from`, `to` | Deletes the text `from`–`to`, inside a block or over several; a mark or a link that loses all its text loses its markers; what is left of the two ends is one block. |
| `replaceText` | `from`, `to`, `text`, `marks?` | A deletion and a typing, as one step. |
| `toggleMark` | `from`, `to`, `mark`, `on?` | `strong` (`*`), `em` (`_`), `code` (`` ` ``), `strike` (`[.line-through]#`), `highlight` (`#`) over the range, or off it; doubled markers (`**`, `__`, …) where single ones would not be read (inside a word); a range over part of a mark of the same kind makes the mark cover both. |
| `setLink`, `removeLink` | `from`, `to`, `target` / `at` | `https://…[text]`, `link:…[text]` (a target without a scheme), `<<id,text>>` (`#id`), `xref:doc.adoc#id[text]`, `mailto:…[text]`; on a link only the target changes; a link over two paragraphs is refused. |
| `setColor`, `replaceColor`, `removeColor` | `from`, `to`, `role` (`replace?` / `role?`) | A colour role over the range, in place of the colours of it, or off it. See «Colour operations». |
| `splitBlock` | `at` | Enter: a blank line at `at`; at the end of a block an empty paragraph follows, in an empty paragraph another one. |
| `insertBreak` | `at` | Shift-Enter: a hard break ` +` and a new line. |
| `joinBlocks` | `at`, `direction?` | Backspace at the start of the block at `at` (`backward`), or Delete at its end (`forward`): the separator goes out of the text. |
| `setBlockType` | `at`, `type`, `level?` | A paragraph, or a heading of level 2–6 (`==` … `======`; the kind of markers is kept). |

A plus that would be read as more than a plus is written as the built-in attribute `{plus}` (Asciidoctor shows it as
`+`, and the reading of Nota shows one character): a plus after a blank at the end of a line (` +` is a hard break), and
a plus alone on a line (an underline of a title, a list continuation). While more text follows on the line, it is a plain
`+` again: `1 + 1` types as typed, and `a {plus}` at the end of a paragraph becomes `a + b` when ` b` is typed.

Every result of `applyOperation` is checked by reading the changed text again: `literal: false` (on inserts and
deletes) says that what was typed could not be written so that it reads exactly as typed (a list marker at the start
of a line, say), and was written as it is, if that leaves the other blocks as they were.

### Style profile

`doc.styleProfile()` says how the people who wrote a document write it, so that what an operation writes new (a list, a
table, a listing, a warning) does not bring a second way into the text. It is read from the whole document, the most
common way for each field (the first seen wins a tie), and a field that the document does not show is taken from
`DEFAULT_STYLE_PROFILE`; an empty document has the default profile.

| Field | Values | Default | Read from |
|---|---|---|---|
| `unorderedMarker` | `'*'`, `'-'` | `'*'` | the marker of the first item of every bulleted list |
| `orderedMarker` | `'.'`, `'1.'` | `'.'` | the marker of the first item of every numbered list (`1.` writes `1.`, `2.`, … on the first level) |
| `tableHeader` | `'shorthand'` (`[%header]`), `'option'` (`options="header"`) | `'option'` | the attribute line of the tables |
| `cols` | `'count'` (`cols="2"`), `'widths'` (`cols="1,1"`), `'none'` | `'count'` | the attribute line of the tables |
| `delimiterLength` | `{ listing, literal, example, sidebar, quote, open, pass, comment, table }` | 4, 4, 4, 4, 4, 2, 4, 4, 3 | the delimiters of the blocks (a delimiter of less than four characters, a fence of backticks, or a character that is not the one of the kind does not count; `table` is the number of `=` after the bar; `[NOTE]` over `====` counts as `example`) |
| `admonition` | `'block'` (`[NOTE]` and `====`), `'paragraph'` (`NOTE: text`) | `'block'` | the warnings of the document |
| `blankLines` | a number (at least 1 is written) | `1` | the blank lines between two blocks |
| `headingMarker` | `'='`, `'#'` | `'='` | the markers of the titles of sections |

`applyOperation(doc, op, { profile })` writes by the profile it is given (a partial one is filled in from the document's)
instead of the document's own.

### Operations on blocks, sections and lists

The operations below work on the **blocks** of a document at any depth: in the document, in a section, in a block that
holds blocks (`====`, `****`, `--`, `____`, a warning), in a cell with the style `a`, in an item of a list. A block is
found by a position `at` in the text: the deepest block that holds it, with the metadata lines over it (`[[id]]`,
`.Title`, `[role]`); a position in the title of a section is the section (the whole of it, with its subsections). Where
`at` is in the text of a list item, the block is the list (`deleteBlock` and the list operations take the item). A
position in a blank line is a place between blocks (`insertBlock`, and `to` of `moveBlock`). Every operation gives the
smallest replacements: only the target, the blank lines it has and the place of a new block change; a new block has the
blank lines of the profile around it, and in a list item it is attached with `+`. The result is read again, and the
document outside the target must be the same (the ASG of the document with the target cut out of the one, and what was
written in its place out of the other, is equal; the tables are laid open for this). When it is not, there is no result.
The last blank line of a cell `a|` (the one before the next cell or the closing `|===`) and the place right after its last
character belong to the cell, so a block moved there stays in the cell. A block written into a cell has a bar that would
end the cell (`|`, or `!` in a nested table) escaped (`x \| y`), and one moved into a cell or out of one is written the way
the place it goes to needs.

**Ids of sections that are made from the title.** The check compares the ASG, which has no ids that Asciidoctor makes from
titles (`_intro`, `_intro_2`). An operation that adds or moves a section with a title that another section has (or removes
the first of two) shifts these ids, and `<<_intro>>` then leads to another section; the check does not see it. A host that
keeps such references compares `doc.outline()` ids outside the target before and after, or gives its sections an id of their own
(`[#intro]`).

| `kind` | Fields | What it does |
|---|---|---|
| `setSectionLevel` | `at`, `level` | The title of the section that holds `at` gets `level` (the number of `=` or `#`, 2–6); its subsections move with it by the same number (`== A` and `=== B`, A to 3: `=== A` and `==== B`). A section that would leave 2–6 is a refusal `invalid-level`. A discrete heading works the same; a title with an underline is `unsupported`. The level is written in the marker that is there. |
| `insertBlock` | `at`, `where: 'before' \| 'after'`, `block` | A new block next to the block that holds `at`, in its container. After a section a block that is not a section goes to the end of the section. `block` is a `BlockSpec` (below). Two lists that would touch are kept apart by a line `//`, as AsciiDoc has it. |
| `moveBlock` | `at`, `to` | The block (a section with its subsections whole, an attached block of an item with its `+`) goes to the place `to`: before the block that holds `to` when `to` is in its first line before the line break, after it otherwise (the line break that ends the first line already counts as after: that is how the end of a block of one line is told), or where the blank line is. `to` inside the block is `invalid-target`; a block that is put where it is leaves the text as it is. |
| `replaceBlock` | `at`, `source`, `expect?` | The block becomes the AsciiDoc `source` (a fragment, below). |
| `deleteBlock` | `at` | The block goes, with the blank lines on one side of it; an item of a list goes from its list, and the only item takes the list with it. |
| `toggleList` | `at`, `list: 'unordered' \| 'ordered' \| 'checklist' \| null` | A paragraph becomes a list of one item (its title and attributes stay over the list); a list becomes a list of another kind (the markers of its items and of the lists in it, and their checkboxes, by the profile and the depth); `null`: a list of items that hold only their text becomes paragraphs, one for each item. A list of the kind it is, or a paragraph with `null`, is no change. |
| `indentListItem`, `outdentListItem` | `at` | The item that holds `at` goes one level in (under the item before it, joining the list it has) or out (after the item it is in; the items that follow it in its list become its own). The markers of the item and what is in it are made as a list of that depth has them. |

**Operations on tables.** `at` is a position in the table (in a cell for the cell operations). They write the smallest
replacements, keep the spec and look of the other cells, and the result is read again and compared with the plan (when the
layout cannot be kept: `unsupported`). Text is escaped by the format of the table (`\|` in `psv`, `\:` in `dsv`, quotes in
`csv`) and, in a nested table, the bars of the tables around it are escaped once each.

| `kind` | Fields | What it does |
|---|---|---|
| `setCellText` | `at`, `text` | The text of the cell, escaped by the format and the depth. A text with a blank at its ends is `unsupported` (the file keeps no blank there). |
| `insertRow`, `deleteRow` | `at`, `where?: 'before' \| 'after'` (insert) | A row of empty cells next to the row of `at`, or the row without its cells (a cell that spans rows is shortened). A row before the header (`%header` or implicit) or after the footer is `unsupported`: it would take the role and push the old header or footer into the body. |
| `insertColumn`, `deleteColumn` | `at`, `where?` (insert) | A column next to the column of `at`, or without it; `cols` is edited in whatever form it has (count, list, multiplier). A deletion that leaves a row with no cells is `unsupported`. |
| `mergeCells` | `from`, `to` | The rectangle between the two cells becomes one cell with `colspan`/`rowspan`. A rectangle that crosses a merged cell is `invalid-span`; a swallowed cell with text is `invalid-span`. |
| `splitCell` | `at` | A merged cell becomes cells of one column and one row. |
| `setTableOptions` | `at`, `header?`, `footer?` | The options of the table (`%header` or `options="header"` by what is there). |
| `setCellFill` | `at`, `role: string \| null` | The fill of the cell: `[.<role>]##{empty}##` put at the start of its text, only the name of the role changed when there is a label already, the label taken out with `null`. The same role (or `null` without a fill) is `changes: []`. A `role` that is not `cell-` and a name is `invalid-role`; a cell with the `l` style, and a cell with the `a` style whose first block is not a paragraph (a list, a table, a block with delimiters, a line of attributes), is `unsupported`; a position outside the cells is `invalid-target`. The text outside the label is not changed. |
| `setCellStyle`, `setCellAlign` | `at`, `style` / `halign`, `valign` | The spec of the cell; in `csv` and `dsv`, which have no spec, the column's (`unsupported` when the column has other cells). |
| `setColumnWidths` | `at`, `widths` | The widths in `cols`. A width written as `20%` keeps its `%`; alignment and style stay. |
| `nestTable` | `at`, `rows`, `columns` | A table in the cell: `|===` gets `a|` with `!===`, `a!` gets `,===`, the next level `:===`; deeper is `nesting-too-deep`; in `dsv` it is `unwritable`; a table that would lose its implicit header (a table in a cell of the header row) is `unsupported`; a cell that holds a table already is `cell-has-table`. |
| `deleteTable` | `at` | The table that holds `at` (the innermost one). A table of the document goes as `deleteBlock` takes a block (with its attribute and title lines); a table in a cell goes from the text of the cell, the text around it stays. |

`at` of a cell operation may be the `contentFrom` of the cell as well as any place in it: that is how a cell with no text
is told from its neighbour (the empty first field of a row of `csv` or `dsv` stands where the next field starts). The
layout of the editor (`layout`) has the kind `table` for a table the operations can write back; a table with a repeat
(`2*|x`), or one whose cells overlap, is an island there.

**Text of a cell.** The text of a cell of a `psv` table with no style, or with `header` or `none`, is read like a
paragraph when it stands in the source as it is (no escaped bar, no blank line, no `\r` other than a CRLF line end) and holds more than letters, digits
and blanks: its `CellBlock` of the kind `text` has `readable: true` and `reading`, the cells of the text with their links,
marks and roles (`null` for a plain text, and `readable: false` for a cell that stays text: `csv`, `dsv`, styles `l`, `m`,
`e`, `s`, an escaped bar). `insertText`, `deleteRange`, `replaceText`, `toggleMark`, `setLink`, `removeLink` and the colour
operations take offsets in such a cell and write the same source as in a paragraph with the same line; a bar that would turn
the cell into plain text, or a cell that would read as the spec of the next one, is refused and the file stays.

The blocks of text of a cell with the `a` style are read and edited by the same operations: the plain paragraphs (no
attributes, no variant) and the items of a list whose items hold nothing but text (a bulleted, numbered or check list, nested
by level; a blank line, a continuation `+`, or a block in an item makes the list a plate). A paragraph or an item is a
`CellBlock` of the kind `text`; an item has `item: { marker, level, checked }`. `applyOperation` does not split an item or add
one: `splitBlock` in an item of an `a` cell and `insertItem` after it are refused (`inside-plate`); the file stays. Those edits
are made by `splitCellItem(doc, at)` (splits the item in two items of the same level and kind; at an end of the text nothing
is written: the editor shows an empty item that is not in the text yet) and `insertCellItem(doc, after, level, text)` (adds an
item after the item that holds `after`, and after the items under it, on the `level` asked), both from
`@nota-adoc/core/internal`; they renumber the written numbers `N.` of the items that follow. An edit of a paragraph or an item of an `a` cell is checked against the other blocks of the cell: if they would
read otherwise afterwards (`x* one` over a list loses its `x` and joins the list), the edit is refused with `collateral`.

**Fragments** are what an AI agent sends: `{ source, expect? }` as the `block` of `insertBlock`, or `source` (and
`expect`) of `replaceBlock`. The source is read on its own, as a document without a title, and must be one block, or
several when `expect` is not given; `expect` is the kind of the block (`section`, `paragraph`, `list`, `dlist`,
`listing`, `literal`, `example`, `sidebar`, `quote`, `open`, `admonition`, `table`, `pass`, `stem`, `verse`, `break`,
`image`, `audio`, `video`, `toc`, `macro`, `include`, `comment`, `heading`). Lines of white space around it are left
out, the line breaks are those of the document. A fragment is refused when its diagnostics hold a warning or an error
(other than a reference or an include that it cannot see, and a repeated id), and when it would change how its
neighbours read: it ends with a line that belongs to the block after it (`[source]`, `[[id]]`, `.Title`, `+`), has a
line of attributes or a condition (`:name: value`, `ifdef`), or, in its place, reads as something else than it does
alone (a section of a lower level that takes the blocks after it in, a block that ends up in another block). What was
read in the place of the target and what the fragment is alone are compared node by node.

`BlockSpec` is what an operation writes new, in the style of the document:

| `kind` | Fields | Written as |
|---|---|---|
| `paragraph` | `text` | the lines of the text (no blank line inside), escaped by place: a backslash before everything that would read as markup (`*a* {b} <<c>> x \| y https://z` is written `\*a* \{b} \<<c>> x \| y \https://z`, and reads as that text in one `text` node of `asg()`) |
| `section` | `level` (2–6), `title` | `== Title` |
| `list` | `list: 'unordered' \| 'ordered' \| 'checklist'`, `items` | `* a`, `. a` or `1. a`, `* [ ] a` |
| `table` | `rows`, `header?` | `[%header,cols="2"]` and the delimiter by the profile; a bar in a cell is escaped |
| `listing`, `literal`, `pass` | `text`, `language?` (listing) | the delimiter of the profile, as long as it needs to be to be no line of the text; `[source,ts]` over a listing with a language |
| `admonition` | `text`, `variant?` (`NOTE` …) | `[NOTE]` over `====`, or `NOTE: text`, by the profile |
| `example`, `sidebar`, `quote`, `open` | `text` | the delimiter around a paragraph of the text |
| `break` | `variant?: 'thematic' \| 'page'` | three quotes, or `<<<` |
| (none) | `source`, `expect?` | a fragment |

Refusals — `{ error, diagnostics }`, the document is not changed: `invalid-range` (a position that is not in the text),
`invalid-target` (no block there, a block that cannot be there, into itself, the first item indented, a block that would
end up in another block than the one it is put in), `invalid-level`, `invalid-block` (a description that is not one),
`invalid-span` (a merge that crosses a merged cell), `nesting-too-deep`, `unwritable` (the text cannot be written so that it reads as that text and nothing else: a line that starts like a
list or a heading, a hard break at the end of a line), `unsupported` (a list of terms, a title with an underline, an item
that holds more than text, where the operation has nothing to do), `fragment-invalid`, `unexpected-kind`, `collateral`
(the blocks around would read differently).

### `@nota-adoc/core/internal`

The second entry of the package is what `@nota-adoc/html` builds on and is **not** the API of the parser: it may
change with any release. It has the attribute state of a document (`AttributeTracker`, `Attrs`, `AttrsBuilder`,
`setupAttributes`, `applyValueSubs`), the sets of substitutions other than the normal one (`BASIC_SUBS`,
`VERBATIM_SUBS`, `NO_SUBS`, `HEADER_SUBS`, `REFTEXT_SUBS`), the substitutor with its working text and the scanners
of the pieces of markup (`Substitutor`, `Work`, `scanInline`, `nestNodes`, `spliceInline`, `parseAttrs`,
`leadingAnchor`, `scanAnchors`), `headerEntries` and the readers of author and revision lines. It also has the model of the document as Asciidoctor sees it (`buildModel`, `Blk`: contexts, styles, ids, numbers, the catalog of references) that the converter of `@nota-adoc/html` and `outline()` are built on. It also has the model the visual editor builds on: the
blocks of a document and the blank lines between them (`readLayout`, `layoutItems`, `editableBlockAt`), the text of a
paragraph or a title as cells with marks (`readInline`) and what prints them back (`printCells`).

A list whose items hold only text is shown item by item in `layoutItems`, also when it has one blank line between two items, or in an item right before a list nested in it: the blank line stays in the gap between the items, and the text of the file is not changed by reading. Two or more blank lines in a row in a list are one plate. A list with a blank line before a block or a paragraph of an item, with a continuation `+`, a title or attributes stays one plate. Lists in `a` cells keep the strict rule: a blank line makes them a plate.

## Tree

Composite nodes are tiled by their children; any text between meaningful children (brackets,
colons, spaces, quotes, the `> ` of a quote, the escape of a directive) is a `Mark` leaf. Line-level leaves include their line terminator;
composite lines end with a `Newline` leaf. "Metadata lines" are block attribute lines, anchors and
block titles; they are children of the block or section they belong to, together with any blank
lines, comments and attribute entries between them and the block.

### Structure

| Node                        | Description                                                                                                                                                                                                                                                                                                                  |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Document`                  | The whole text. Children: header, top-level blocks and sections, blank lines, comments, entries.                                                                                                                                                                                                                             |
| `Header`                    | Document header: metadata, attribute entries and comments above the title, the title, author and revision lines, entries and comments up to the first blank line. Without a title, a leading run of attribute entries forms the header. For `doctype: manpage` it also holds the NAME section (`SectionTitle`, `TextLine`s). |
| `DocumentTitle`             | `= Title` (or a two-line title with a `=` underline). Children as in `SectionTitle`.                                                                                                                                                                                                                                         |
| `AuthorLine`                | The line after the title: `Author`s separated by `;`.                                                                                                                                                                                                                                                                        |
| `Author`                    | One author: `AuthorName` and optionally `AuthorEmail` (inside `<…>`).                                                                                                                                                                                                                                                        |
| `AuthorName`, `AuthorEmail` | Leaves.                                                                                                                                                                                                                                                                                                                      |
| `RevisionLine`              | `v1.0, 2026-09-25: remark` → `RevisionNumber`, `RevisionDate`, `RevisionRemark` (leaves).                                                                                                                                                                                                                                    |
| `Section`                   | A section: its metadata lines, `SectionTitle`, then content and nested sections up to the next title of the same or a higher level. Carries `sectionLevel`.                                                                                                                                                                  |
| `SectionTitle`              | `== Title`, `## Title`, `== Title ==` or a two-line title. Children: `SectionMarker`, `TitleText`, closing `SectionMarker`, `Newline`; two-line: `TitleText`, `Newline`, `SetextUnderline`, `Newline`.                                                                                                                       |
| `SectionMarker`             | `=`…`======` or `#`…`######`.                                                                                                                                                                                                                                                                                                |
| `TitleText`                 | The title text of a section, document, discrete heading or block title.                                                                                                                                                                                                                                                      |
| `SetextUnderline`           | The underline of a two-line title (`=`, `-`, `~`, `^`, `+`).                                                                                                                                                                                                                                                                 |
| `DiscreteHeading`           | `[discrete]` or `[float]` heading: a block, not a section. Metadata children, then the title parts. Carries `sectionLevel`.                                                                                                                                                                                                  |

### Blocks

| Node | Description |
|---|---|
| `Paragraph` | Lines up to a blank line, a block attribute line, a delimiter line or `+`. Inside a list, also up to a list item. |
| `LiteralParagraph` | A paragraph whose first line is indented (and no known style). |
| `AdmonitionParagraph` | `NOTE:`, `TIP:`, `IMPORTANT:`, `WARNING:`, `CAUTION:` paragraph; starts with `AdmonitionMarker`. |
| `StyledParagraph` | A paragraph whose style comes from a block attribute line: `[NOTE]`, `[source]`, `[literal]`, `[verse]`, `[quote]`, `[sidebar]`, `[example]`, `[pass]`, `[open]`, `[comment]`… Verbatim styles (`literal`, `listing`, `source`, `verse`) keep `//` lines as text. |
| `AdmonitionMarker` | `NOTE: ` including the spaces. |
| `TextLine` | One line of paragraph text (or of the text of a list item), with its line terminator. A line that holds inline constructs has them as children; when a construct crosses line breaks, the lines it spans (and what lies between them: comment lines, quote markers) are one `TextLine`, whose pieces of text are in the property `textPieces` (see «Inline markup»). |
| `DelimitedBlock` | A block with delimiters: metadata children, the opening `BlockDelimiter`, the content, the closing `BlockDelimiter` (absent when the block is not closed). Its kind is the property `blockKind` (below). Blocks that hold blocks (example, sidebar, quote, open, admonition) have the blocks they hold as children, as `Document` has; a table has `TableCell`s and blank lines (see «Tables»); the others have one `DelimitedContent`. Closed by the first line equal to the opening one; a block inside a container is closed at the end of the container. |
| `BlockDelimiter` | A delimiter line (`----`, `....`, `====`, `****`, `____`, `--`, `++++`, `\|===`, `!===`, `,===`, `:===`, `` ``` ``), with its terminator. For a fence with a language (` ```ruby `) it is the three backticks only, followed by `CodeLanguage` and a `Newline`. |
| `DelimitedContent` | The lines between the delimiters of a block that is not parsed (not a table). In a listing or a literal block it has the callouts (`Callout`) as children, in a verse block the inline constructs, in a block with `subs=` whatever those substitutions find. |
| `CodeLanguage` | The language on the opening line of a fence: the text after the backticks up to a comma. |
| `BlockQuote` | A Markdown quote (`> text`): its lines without the `> ` markers, parsed as blocks; a nested quote is a `BlockQuote` inside. The markers are `Mark` leaves. |
| `QuoteAttribution` | The last line `-- Author, Source` of a Markdown quote. |
| `BlockMacro` | `image::target[attributes]`, `video::`, `audio::`, `toc::[]` and the names in `blockMacros`: metadata, `MacroName`, `MacroTarget` (absent for `toc`), the attributes as `PositionalAttribute` and `NamedAttribute` children like those of a block attribute line (without the shorthand of the first one), `Newline`. |
| `MacroName`, `MacroTarget` | Leaves. |
| `ThematicBreak`, `PageBreak` | `'''`, `---`, `- - -`, `***`, `* * *`, `___`, `_ _ _` / `<<<`: metadata and a `BreakMarker` (the line). |

`blockKind` of a `DelimitedBlock` is one of `listing` (also `[source]` and fenced code), `literal`,
`verse`, `pass`, `stem`, `comment` (`[comment]` over `--`), `table`, and the blocks that hold blocks:
`example`, `sidebar`, `quote`, `open` (also `[abstract]` and `[partintro]`), `admonition` (`[NOTE]` and the
like over `====` or `--`). A style over a block with delimiters changes its kind the way Asciidoctor
does (`[source]` over `--` is a listing, `[quote]` over `====` is an example: the block does not take
styles it does not know).

### Lists

A list is one node with the items as children. The kind of the list is the name of the node:
`UnorderedList`, `OrderedList`, `DescriptionList` or `CalloutList` (all four are in the group `List`).
The level of a list is how deep it lies among lists: a nested list is a child of the item it belongs to.
Which list a marker belongs to follows Asciidoctor: by the order the markers appear, not by their length.

| Node | Description |
|---|---|
| `ListItem` | An item: `ListMarker`, an optional `Checkbox`, the text (`ItemText`), then everything glued to it: nested lists, blocks attached with a continuation, literal paragraphs, blank lines, `ListContinuation` lines. In a description list an item is the terms (`DescriptionTerm` and `ListMarker` for each) and the description that follows them. |
| `ListMarker` | The marker: `*`…`*****`, `-`, `•`, `.`…`.....`, `1.`, `a.`, `A.`, `i)`, `I)`, `<1>`, `<.>`; in a description list the delimiter `::`, `:::`, `::::` or `;;`. |
| `Checkbox` | `[x]`, `[ ]` or `[*]` at the start of the text of an item. |
| `ItemText` | The text of an item: the rest of its first line and the lines that continue it (also the first block that follows directly, which Asciidoctor folds into the text). Children: `TextLine`s, and the comments and metadata among them. |
| `DescriptionTerm` | The term of a description list item, without the delimiter. |
| `ListContinuation` | A line `+` that glues the next block to the item. |

Rules that follow Asciidoctor and that the tree shows: a list continuation after a blank line belongs to
the outermost item; two `+` lines in a row glue nothing; a block with delimiters ends the list unless a
continuation comes before it; a comment line or an attribute line between two lists keeps them apart;
blank lines between items are children of the list, blank lines after the last item follow the list.

### Tables

A table is a `DelimitedBlock` with `blockKind` `table`, opened by `|===`, `!===`, `,===` or `:===` (any number of
`=` from three on, closed by the same line). Rows are not nodes: the cells stand in the text order, one after the
other, and where a cell ends is where the next one starts. What makes them rows, columns, a header and a footer is in the
model that `tableAt` gives (below).

| Node | Description |
|---|---|
| `TableCell` | One cell, from its spec (or its separator) to where the next cell starts: `CellSpec`, `CellSeparator`, `CellContent`. In a `psv` table the spec of a cell stands at the end of the text before the separator (`\|a 2+^.>s\|b`: the `2+^.>s` opens the cell `b`); the text of the cell before it ends where the spec starts. |
| `CellSpec` | `2+`, `.3+`, `2.3+`, `3*`, the alignments `<` `^` `>` `.<` `.^` `.>` and the style letter (`a d e h l m s v`), as written; absent if the cell has none. |
| `CellSeparator` | The separator of the cell (`\|`, `!`, `,`, `:`, a tab, or the `separator` of the table). A cell of a `psv` table without one is the first cell of a table that does not start with a separator (`table-missing-separator`). Cells of `csv`, `dsv` and `tsv` tables have the separator before them, except the first one of a line. |
| `CellContent` | The text of the cell as it is in the source: an escaped separator (a backslash in front of it) and the quotes of a CSV cell stay in it. For a cell of style `a` the blocks of the document it holds are its children, as `Document` has them (so a table inside is a `DelimitedBlock` inside a `CellContent`); for the others it is a leaf. Blank lines that follow the last line of text of a cell are `BlankLine`s of the table, not of the cell. |

The lines of a table that start with `//` (but not `///`) are comments that Asciidoctor takes out before it reads
the cells: they are `LineComment`s among the cells, and do not interrupt the text of a cell.

`tableAt(pos)` gives the layout of the table that holds `pos` (the innermost one), or `null`:

```ts
interface TableModel {
  from: number; to: number            // the block, delimiters included
  format: 'psv' | 'csv' | 'dsv'       // `tsv` is `csv` with a tab
  separator: string
  columns: TableColumnModel[]         // `width` in percent (33.3333, 66.6667), `autowidth`, `halign`, `valign`, `style`
  rows: { head: TableRowModel[]; body: TableRowModel[]; foot: TableRowModel[] }
  dropped: TableDroppedCellModel[]    // cells read and left out with their row (see below)
}
interface TableDroppedCellModel { from: number; to: number; style: TableCellStyle | null; text: string; after: number }
interface TableRowModel { cells: TableCellModel[] }
interface TableCellModel {
  from: number; to: number            // the `TableCell` node
  contentFrom: number; contentTo: number   // its `CellContent`
  row: number; column: number         // 0-based: the row (over `head`, `body` and `foot`) and the first column it covers
  colspan: number; rowspan: number    // 1 without a span
  halign: 'left' | 'center' | 'right'; valign: 'top' | 'middle' | 'bottom'
  style: TableCellStyle | null        // 'asciidoc' | 'none' | 'emphasis' | 'header' | 'literal' | 'monospaced' | 'strong' | 'verse'
  text: string                        // the text of the cell as Asciidoctor reads it (quotes and escapes taken out)
  fill: { role: string; from: number; to: number } | null   // the fill of the cell (below); `from`–`to` is the label
}
```

**The fill of a cell** is a property of the cell in the Nota format: the label `[.cell-yellow]##{empty}##` at the start of
its text (`cell-` and a name of letters, digits, `_` and `-`; the engine knows no names). `text` keeps the label, as
Asciidoctor reads it: it shows the cell with an empty `span` that has the role, and nothing else changes. Nota writes only
the unconstrained form `##…##`; it reads `#{empty}#` too, when a character that is not a letter or a digit follows it (the
constrained form with a letter right after it is shown by Asciidoctor as text, so it is no label). Not a fill (`fill: null`):
a label that is not at the start of the text, an escaped one (`\[.cell-…`), a role without `cell-`, several roles
(`[.cell-yellow.bold]`), a selection with text (`[.cell-yellow]##x##`), a cell with the `l` style (Asciidoctor shows the label
there as text) and, in a cell with the `a` style, a label that does not start the first paragraph. The recognition is
syntactic: a document that sets `:empty:` to something else is read as a fill all the same. A fill is not the colour of text: put no
`cell-*` role in `colorRoles`; `colors()` and `colorAt` do not report it, and `setColor`, `replaceColor` and `removeColor`
leave the label alone. `renderHtml` puts the role on the `td`/`th` (see `@nota-adoc/html`).

A row with more cells than the table has columns, and a last row that is not full, are left out with their cells
(`table-cell-dropped`, `table-incomplete-row`). The cells are in no row and have no node of their own, but Asciidoctor has
read them: the ids and anchors in their text are taken by the document, so the next section with the same title gets
a suffix. They are in `dropped`, in the order of the text; `after` is how many cells of the rows were read before
the cell. `@nota-adoc/html` reads the ones with the `a` style as documents of their own, as Asciidoctor does, and
drops the result.

How the layout is worked out follows Asciidoctor 2.0.26:

- **Columns.** `cols` gives them (`"1,2"`, `3*` for three equal ones, `"2,^.>3m"`, `~` for an automatic width);
  without `cols` there are as many columns as cells in the first line of text. Widths are percentages with four
  decimals, the last column takes what is left. A cell fills the next column of its row (after the ones taken
  by `rowspan`s of the rows above), and a row is complete when the columns are filled.
- **Header and footer.** With `%header` (or `options="header"`) the first row is the header; without it, if the first
  line of text is followed by a blank line the first row is the header too (the implicit header), unless `%noheader`
  says no. `%footer` makes the last row the footer. A cell in the header is read as a header cell and its style is not
  used.
- **Formats.** `|===` cells begin at `\|` (nested in a cell of style `a`: at `!`). The `format` attribute (`psv`, `csv`,
  `dsv`, `tsv`) and `separator` (any string, `\t` for a tab) change it; `,===` is `csv` and `:===` is `dsv` with
  `,` and `:`. A CSV cell may be in quotes (a separator and a line break inside it stay in the cell, `""` is a quote); a DSV
  cell has one line and `\:` is a colon; in a PSV cell `\|` is a bar. A blank line inside the text of a PSV cell
  is a paragraph break in it. `!===` at the top level of a document is a table that reads `|` (only in a nested
  document the separator is `!`), as in Asciidoctor.
- **Spans.** `2+\|` (colspan), `.3+\|` (rowspan), `2.3+\|` (both) and `3*\|x` (three cells `x`). A `rowspan` takes
  room in the rows below: they have fewer cells.
- **A row over several lines, several rows in a line.** The rows are cut by the number of columns, not by the lines.

**Cells of style `a`** hold a document. Its blocks are parsed from the text of the cell (with the indentation and the
escapes taken out the way Asciidoctor does, which is why the ranges of the nodes inside may skip characters: the
`\` of an escaped separator, the quotes of a CSV cell), and are children of the `CellContent`. The nested document has a
header and sections like the outer one. It sees the attributes of the outer document at the table but cannot change
them, and what it sets is not seen after the table (`doc.attributesAt(pos)` after the table has what the table
started with). The document is an article whatever the type of the outer one is (`:doctype: book` does not give the cell
a preamble or parts, and `{doctype}` in it is `article`), and its counters (`{counter:}`) are the outer ones. Its separator is `!` for `psv`. So four levels of nesting go like this: `|===` › a cell `a\|` with
`!===` › a cell `a!` with `,===` and `cols="a"` › a cell with `:===`. There is no limit in the parser, but a
separator cannot be used at two levels in a row, and a nested table cannot start with the `|` of the table around
it: a line `|====` inside a cell of style `a` of a `|===` table is a new cell of the outer table (the outer separator
cuts it), as it is in Asciidoctor. Deeper than four levels use a passthrough block: a `++++` block in a cell is an
ordinary `DelimitedBlock` (`pass`) and its text goes to the HTML as it is.

The diagnostics of a table are `unterminated-block` (no closing line), `table-missing-separator`,
`table-incomplete-row` and `table-cell-dropped` (see «Diagnostic»).

### Preprocessor

Conditional directives are read line by line, in the order the parser reads the lines, with the
attributes as they are at that moment (Asciidoctor's `PreprocessorReader`). The lines of a condition that
is off are not read as blocks, and neither are directive lines; they are nodes of the container they lie in
(a paragraph, a list item, a block, the document) and take no part in parsing.

| Node | Description |
|---|---|
| `Directive` | An `ifdef`, `ifndef`, `ifeval` or `endif` line: `DirectiveName`, `DirectiveTarget` (the attribute names), `DirectiveText` (the expression of an `ifeval` and the text of a one-line `ifdef::a[text]`), `Newline`. For a one-line condition that holds, the node is the part of the line before the text; the text is then read as a line (its closing `]` belongs to that line). |
| `IncludeDirective` | An `include::target[attributes]` line: `DirectiveName`, `DirectiveTarget`, the attributes as `PositionalAttribute` and `NamedAttribute` children, `Newline`. Standalone it is a node of its own; among the lines of a paragraph or a block it is a child of it and does not break it. |
| `DirectiveName`, `DirectiveTarget`, `DirectiveText` | Leaves. |
| `DisabledLines` | The lines that a condition that is off leaves out: kept as they are, nothing in them is parsed (blank lines included). |

An escaped directive (`\ifdef::a[]`) is a text line; its backslash is a `Mark`. Directives inside a listing
are evaluated; a `////` comment block and `[comment]` paragraphs read their lines without the preprocessor.
`endif` without a partner and the like are diagnostics, and the line is dropped, as in Asciidoctor.

### Comments

| Node                                 | Description                                                                       |
| ------------------------------------ | --------------------------------------------------------------------------------- |
| `LineComment`                        | `// comment` line (not `///`). Inside a paragraph it is a child of the paragraph. |
| `BlockComment`                       | `////` … `////`: `CommentDelimiter`, `CommentContent`, `CommentDelimiter`.        |
| `CommentDelimiter`, `CommentContent` | Leaves.                                                                           |

### Attributes

| Node                                                                | Description                                                                                                                  |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `AttributeEntry`                                                    | `:name: value`, `:name!:`, `:!name:`; a value continued with ` \` (or legacy ` +`) spans several lines.                      |
| `AttributeName`                                                     | The name as written.                                                                                                         |
| `UnsetMarker`                                                       | The `!` of an unset entry.                                                                                                   |
| `AttributeValue`                                                    | The value; for a continued value: `ValueText`, `LineContinuation`, `Newline` per line. Also the value of a `NamedAttribute`. |
| `ValueText`                                                         | Value text of one line.                                                                                                      |
| `LineContinuation`                                                  | ` \` or ` +` at the end of a value line.                                                                                     |
| `BlockAttributes`                                                   | `[style,positional,name=value]`: `PositionalAttribute`s and `NamedAttribute`s.                                               |
| `PositionalAttribute`                                               | A positional value (quotes included). The first one may split into shorthand parts.                                          |
| `NamedAttribute`                                                    | `name=value`: `AttributeName`, `AttributeValue`.                                                                             |
| `ShorthandStyle`, `ShorthandId`, `ShorthandRole`, `ShorthandOption` | Parts of `style#id.role%option` (sigil included).                                                                            |
| `BlockAnchor`                                                       | `[[id]]` or `[[id,reftext]]`: `AnchorId`, `AnchorRefText`.                                                                   |
| `AnchorId`, `AnchorRefText`                                         | Leaves.                                                                                                                      |
| `BlockTitle`                                                        | `.Title` line: `TitleText`.                                                                                                  |

### Inline markup

Text is read with the substitutions of Asciidoctor, in its order: passthroughs, special characters, quotes,
attributes, replacements, macros, post replacements (line breaks). What each pass finds is a node over the
source; the text between the nodes is `Mark` leaves. The text of a paragraph, a list item, a description
term, a title and a block title has the normal substitutions; the content of a listing, a literal block and
a listing-style paragraph only the special characters and the callouts; the content of a verse the normal
ones; `++++`, `[pass]` and comments none; `[subs=…]` changes them as it does in Asciidoctor (`+quotes`,
`-replacements`, `attributes,macros`, `none`, `verbatim`…). The attributes that change the reading are
`experimental` (`kbd:`, `btn:`, `menu:`), `compat-mode` (the old quote syntax) and `hardbreaks` (a line break
after each line, also `[%hardbreaks]`). Whatever the nodes look like, they are ranges of the source: read
from left to right, the leaves spell it.

| Kind of text | Substitutions |
|---|---|
| Paragraph, admonition paragraph, list item, description term, section title, discrete heading, block title, `[quote]`, `[example]`, `[sidebar]`, `[open]` paragraph, verse | normal: `specialcharacters`, `quotes`, `attributes`, `replacements`, `macros`, `post_replacements` |
| Listing `----`, ` ``` `, `[source]`, literal `....`, literal paragraph, `[listing]` and `[literal]` paragraph | verbatim: `specialcharacters`, `callouts` |
| Stem block | `specialcharacters` |
| `++++`, `[pass]`, comments | none |

`[subs=…]` on the block changes the set: `normal`, `none`, `verbatim`, `specialchars`, the single names and their
short forms (`q`, `a`, `m`, `r`, `p`, `c`, `v`), and the incremental forms `+name`, `-name` and `name+`.
The attributes that change how text is read are `experimental`, `compat-mode` and `hardbreaks` (also
`[%hardbreaks]`); an entry that sets or unsets one changes the tree below it, and `doc.update` gives what a full
parse gives.

`{set:}` and `{counter:}` change the attributes of the document from the place where the text is converted, and
the tree reads the texts in that order, as Asciidoctor converts them: the text of a list item (and a description
term) before the blocks in it, with the attributes as they are when the item starts, so what it sets is there for
the rest of that text and for the blocks in the item and after it, while what a block in the item sets comes after
the text; a block title after the attribute entries of its block, wherever they stand between the title and the
block, and only the last title of a block is read for what it sets (the others are overwritten). A `{set:}` in a
list of attributes (`[quote, Author {set:a:b}]`) does not reach the converted document, as in Asciidoctor.

A `{set:}` in the text of a block does not touch the state of the block parse: `{set:leveloffset:1}` in a paragraph,
in the text of a list item, in a block title, in a cell with the `a` style or in a file from `include::` leaves the levels of the sections below
as they are (Asciidoctor reads them when it converts the text, after the sections are read). Known difference: in
the title of a section (and in a discrete title) Asciidoctor and Asciidoctor.js convert the title while they read the
section (to make its id), so `== S {set:leveloffset:1}` moves the levels of the sections after it there; Nota does
not (the title is read like any other text, and the levels below stay). The same holds for a section with an id of
its own (`[[id]]` at the end of the title, `[#id]`). Following it needs the parse to know whether the title is
converted; this is not done yet. The difference is in `quality/reference/known-differences.json`
(`set-leveloffset-in-section-title`).

| Node | Description |
|---|---|
| `Strong`, `Emphasis`, `Monospace`, `Highlight`, `Superscript`, `Subscript`, `DoubleQuoted`, `SingleQuoted` | Quoted text: `*x*`, `**x**`, `_x_`, `__x__`, `` `x` ``, ``` ``x`` ```, `#x#`, `##x##`, `^x^`, `~x~`, ``"`x`"``, ``'`x`'``. Children: an optional `InlineAttributes` (`[.role]`, `[#id.role]`), two `QuoteMarker`s and the text between them, which holds the constructs inside. One-character markers work at the edge of a word only (`a*b*c` is plain text), two-character markers anywhere; a construct may cross line breaks. |
| `QuoteMarker`, `InlineAttributes` | Leaves: the marker as written; the `[…]` before the marker. |
| `Escape` | The backslash that escapes a construct (`\*x*`, `\{name}`, `\<<id>>`): it is not shown, the construct is text. |
| `Passthrough` | `+x+`, `++x++`, `+++x+++`, `$$x$$`, `pass:[x]`, `pass:q[x]`: `PassMarker`s (for `pass:` also `MacroName` and `PassSubs`) and the text, which is read as the substitutions of the passthrough say. `Stem` is the same for `stem:[x]`, `latexmath:[x]` and `asciimath:[x]`. |
| `PassMarker`, `PassSubs` | Leaves: `+`, `++`, `+++`, `$$`, `[` and `]` of a macro; the `q` of `pass:q[`. |
| `AttributeReference` | `{name}`, `{set:name:value}`, `{counter:name}`: the `AttributeName` inside. An undefined one gives an `info` diagnostic (`undefined-attribute`). |
| `Replacement` | `(C)`, `(R)`, `(TM)`, `--`, `...`, `->`, `=>`, `<-`, `<=` and the apostrophe of a word (`it's`). |
| `SpecialChar` | A `<`, `&` or `>` of the text, wherever the special characters substitution applies (listings and literal blocks too; not `++++`, `[pass]` or `subs=none`). Not one that a construct is written with: the brackets of a callout, of `<<id>>` and of `<https://…>`, the characters of `->`, `<=`. |
| `HardBreak` | ` +` at the end of a line. |
| `Callout` | `<1>` (with the comment marker before it) in the content of a listing or a literal block. |
| `Link` | `https://example.com`, `https://example.com[text]`, `<https://example.com>`, `link:target[text]`, `mailto:a@b.c[text]` and a bare e-mail address: `MacroName`, `MacroTarget`, `MacroText`. |
| `Xref` | `<<id>>`, `<<id,text>>`, `xref:target[text]`: `MacroTarget` and `MacroText`. |
| `InlineAnchor` | `[[id]]`, `[[id,text]]`, `anchor:id[text]`: `AnchorId` and `AnchorRefText`. |
| `InlineImage` | `image:target[alt,width,height]`, `icon:name[size]`: `MacroName`, `MacroTarget`, the attributes as `PositionalAttribute` and `NamedAttribute`. |
| `Footnote` | `footnote:[text]`, `footnote:id[text]`, `footnote:id[]`: `MacroName`, `MacroTarget`, `MacroText`. |
| `Kbd`, `Button`, `Menu` | `kbd:[Ctrl+S]`, `btn:[OK]`, `menu:File[Save]` and `"File > Save"`, with `experimental` on. |
| `IndexTerm` | `indexterm:[…]`, `indexterm2:[…]`, `((…))` and `(((…)))`. |
| `MacroText` | The text between the brackets of a macro; constructs that lie inside are its children. |

A name that is not one of these (`name:target[text]`) is text, as it is in Asciidoctor without an extension.
A construct that Asciidoctor makes only after a substitution (`{url}[text]`) covers the source it grew from;
the reference is inside it. Two constructs that cross each other cannot both be nodes: the one the earlier
pass found stays. The property `textPieces` (`NodeProp`, exported from the package) of a `TextLine` that
spans lines lists the ranges of the text of those lines, as `[from, to, from, to, …]`, offsets relative to the start of the
`TextLine` (add `node.from`): a unit that an edit only moves keeps its tree as it is.

### Lines and tokens

| Node            | Description                                                                        |
| --------------- | ---------------------------------------------------------------------------------- |
| `BlankLine`     | An empty or whitespace-only line, with its terminator.                             |
| `Newline`       | A line terminator: LF or CR LF. A lone CR is not a line break (as in Asciidoctor). |
| `ByteOrderMark` | U+FEFF at the start of the text.                                                   |
| `Mark`          | Punctuation and whitespace between meaningful children.                            |

Groups (`NodeProp.group`): `Block` for paragraphs, delimited blocks, lists, macros, breaks, quotes and
discrete headings, `Paragraph` for the four paragraph types, `List` for the four lists, `Break` for
the two breaks, `Directive` for the two kinds of directive, `Comment`, `Metadata`.
