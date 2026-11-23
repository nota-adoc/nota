# @nota-adoc/codemirror

AsciiDoc for [CodeMirror 6](https://codemirror.net/), built directly on the syntax tree of
[`@nota-adoc/core`](../core/README.md). There is no second grammar: `syntaxTree(state)` *is* the Nota
tree, node for node, updated incrementally as the text changes. On top of it the package gives
highlighting, folding, Nota's diagnostics as lint, completion for `{attributes}` and cross references,
and a self-contained source editor (`createSourceEditor`) whose undo history is shared by any number of
editors on one document.

Status: block level and inline markup (bold, links, `{name}` inside text) are highlighted; a live preview and
the link with the visual editor come with later stages (see [What is not here yet](#what-is-not-here-yet)).

Runs in browsers (ESM only). Free software only: the package depends on `@nota-adoc/core` and
`@lezer/*`; the `@codemirror/*` packages are peer dependencies, so the host has exactly one copy of them.

```sh
npm install @nota-adoc/codemirror @codemirror/state @codemirror/view @codemirror/language \
  @codemirror/commands @codemirror/lint @codemirror/autocomplete
```

## Use it in your CodeMirror

```ts
import { EditorView, basicSetup } from 'codemirror'
import { oneDark } from '@codemirror/theme-one-dark'
import { asciidoc, notaDocument } from '@nota-adoc/codemirror'

const view = new EditorView({
  doc: text,
  extensions: [basicSetup, asciidoc(), oneDark], // the highlight style is the host's
  parent: document.body,
})

notaDocument(view.state).diagnostics // the same objects Nota gave: { from, to, severity, code, message }
```

`asciidoc(config?)` returns a `LanguageSupport`. Its options:

| Option | Meaning |
|---|---|
| `parse` | Options of the Nota parser (`ParseOptions`: document `attributes`, `blockMacros`). The attributes offered after `{` start from the same ones. |
| `lint` | `false` removes the wavy lines, the hover messages and the panel (Mod-Shift-M). Default `true`. |
| `message` | `(d) => string`: the text of a diagnostic in the hint and the panel (to translate it). Default `d.message`. |
| `xrefTargets` | `(query) => Promise<{ id, label? }[]>`: targets in other documents for the list after `xref:` and `<<`. Optional; the library loads nothing itself. |
| `autocomplete` | `false` does not install `autocompletion()`; the source stays available as language data (`state.languageDataAt('autocomplete', pos)`) for a host that installs its own. Default `true`. |

The state's line separator is fixed to `\n`: a CR stays a character of its line, so `state.doc.toString()`
is the text of the Nota document byte for byte (CRLF files, lone CR and a byte order mark survive
untouched).

### `notaDocument(state)`

The Nota `NotaDocument` of the current state: `text === state.doc.toString()`, `tree === syntaxTree(state)`,
`diagnostics` those of a full parse. Nothing is parsed again to get it. The bridge asks Nota for an
incremental update whenever CodeMirror keeps parts of the old tree (`TreeFragment`s) and parses in full
otherwise.

## Highlighting

The node types of the tree carry no CodeMirror properties, so a view plugin walks the visible part of the
tree, finds the group of every node in the table below and asks the state for the class of the group's tag
(`highlightingFor`). The colours therefore come from whatever `HighlightStyle` the host installs: add
`oneDark` and the colours change, the package is not touched. Each range also gets the classes `cm-ap` and
`cm-ap-<group>`, for CSS.

If the host installs no highlight style, a neutral one is used (a fallback that only counts when there is
no other). Its colours come from CSS variables `--ap-heading-0` … `--ap-heading-5`, `--ap-value`,
`--ap-delimiter`, `--ap-comment` and so on: set them on any ancestor of the editor to recolour it. When a
variable is not set, the default of the theme applies: the editor gets the light palette, or the dark one
when the host's theme is dark (`EditorView.theme(..., { dark: true })`, as `oneDark` is), through the
variables `--ap-<name>-default`.

Every group has its own tag in `asciidocTags`, a child of a standard tag of `@lezer/highlight` (headings of
level 0–5 are children of `heading1`–`heading6`, attribute values of `string`, delimiters of `keyword`, comments
of `comment`), so a style that knows only the standard tags still colours it sensibly. Text that is not listed
(paragraph text, blank lines) gets no class.

| Group | Nodes |
|---|---|
| `heading0` … `heading5` | `SectionMarker`, `TitleText`, `SetextUnderline` of the document title (0) and of sections and discrete headings by their level (1–5) |
| `blockTitle` | `TitleText` and the dot of a `BlockTitle` (`.Title`) |
| `author`, `revision` | `AuthorName`, `AuthorEmail`; `RevisionNumber`, `RevisionDate`, `RevisionRemark` |
| `attributeName`, `attributeUnset`, `attributeValue`, `lineContinuation` | `AttributeName`; `UnsetMarker` (the `!`); `AttributeValue` (a value on one line) and `ValueText`; `LineContinuation` |
| `punctuation` | The `Mark` leaves of attribute entries, attribute lists, anchors, block macros, directives, Markdown quotes and inline macros: colons, brackets, commas, `::`, `> `, `<<` |
| `attrStyle`, `attrId`, `attrRole`, `attrOption`, `attrPositional` | `ShorthandStyle`, `ShorthandId` (`#id`), `ShorthandRole` (`.role`), `ShorthandOption` (`%option`); the first attribute of a block attribute line when it is not in quotes and not split into these (`NOTE` in `[NOTE]`, `source` in `[source,java]`) is a style too; every other `PositionalAttribute` (`java`, `Автор`, the `Alt` of `image::a.png[Alt]`, `"NOTE"`) is a value |
| `anchorId`, `anchorText` | `AnchorId` and `AnchorRefText` of `[[id,text]]` |
| `blockDelimiter`, `commentDelimiter` | `BlockDelimiter` (`----`, `====`, `|===`, `` ``` `` …); `CellSeparator` (the `|` of a table cell) and `CellSpec` (`2+^.>s` before it); `CommentDelimiter` (`////`) |
| `listContinuation`, `listMarker`, `checkbox`, `descriptionTerm` | `ListContinuation` (`+`); `ListMarker`; `Checkbox` (`[x]`); `DescriptionTerm` |
| `admonition` | `AdmonitionMarker` (`NOTE: `) |
| `rawContent`, `codeLanguage` | `DelimitedContent` (listing, literal, pass) and `LiteralParagraph`; `CodeLanguage` of a fence |
| `macroName`, `macroTarget` | `MacroName`, `MacroTarget` of block macros and of inline macros (`image:`, `footnote:`, `xref:`, `link:`, `kbd:` …) and of links |
| `break` | `BreakMarker` (`'''`, `<<<` …) |
| `comment` | `LineComment`, `CommentContent` |
| `directiveName`, `directiveTarget`, `directiveText` | `DirectiveName` (`ifdef`, `include` …), `DirectiveTarget`, `DirectiveText` |
| `disabled` | `DisabledLines`: the lines a condition switches off, dimmed |
| `quoteAttribution` | `QuoteAttribution` of a Markdown quote |
| `strong`, `emphasis`, `monospace`, `highlightText`, `superscript`, `subscript`, `doubleQuoted`, `singleQuoted` | The whole construct: `Strong`, `Emphasis`, `Monospace`, `Highlight`, `Superscript`, `Subscript`, `DoubleQuoted`, `SingleQuoted`, markers included; nested quotes add up (bold and italic) |
| `quoteMarker`, `inlineAttributes`, `escape` | `QuoteMarker` (`*`, `__`, `` ` ``); `InlineAttributes` (`[.role]`); `Escape` (the backslash) |
| `passthrough`, `passMarker`, `passSubs`, `stem` | `Passthrough` (`+x+`, `++x++`, `+++x+++`, `$$x$$`, `pass:[x]`) and `Stem` (`stem:[x]`); `PassMarker` (the markers and brackets); `PassSubs` (the `q` of `pass:q[`) |
| `attributeReference`, `replacement`, `hardBreak`, `callout` | `AttributeReference` (`{name}`); `Replacement` (`(C)`, `--`, `->`, …); `HardBreak` (` +`); `Callout` (`<1>` in a listing) |
| `link`, `linkText`, `macroText` | `Link` (a URL or `link:`/`mailto:` macro); the `MacroText` of a link or a cross reference; the `MacroText` of the other inline macros (footnote, `kbd:`, `btn:`, `menu:`, index terms) |

`highlightTable` is the same table as data, `highlightRanges(state, from?, to?)` gives the ranges (each is
the range of one node of the tree), `highlightGroup(node, doc?)` the group of one node (the rule for the style of
a block needs `doc`, the text of the document, to see the bracket before the attribute and the quotes). The quality bench checks
that every highlighted range is the range of a node of a fresh parse (`npm run corpus -- editor`).
The text of a plain table cell has no colour; what a cell with the `a` style holds (paragraphs, lists, listings, tables)
is highlighted like the same blocks outside a table.
Highlighting of a language inside `[source,lang]` is not done: the content of a listing has one colour.

## Folding

A `foldService` on the tree and a fold gutter with markers:

- a **section**: everything after the title line up to the next title of the same or a higher level (the title
  line stays; for a two-line title the fold starts at the end of its first line);
- a **block with delimiters** (also `////`): the content between the two delimiter lines, which stay visible; an
  unclosed block folds to the end of its container; a **table** is a block with delimiters, and a table in a cell with
  the `a` style folds on its own opening line;
- a **list** of several lines (the marker is on the line of its first item; nested lists fold on their own).

Mod-Alt-[ folds the closest construct around the cursor that is not folded yet, Mod-Alt-] unfolds.
A one-line paragraph or a list of one line has no marker. `foldRange(state, lineStart, lineEnd)` gives the
range for a line.

## Diagnostics (lint)

`notaDocument(state).diagnostics` become CodeMirror lint diagnostics: same ranges, same severities
(`error`, `warning`, `info`), `source: 'nota'`, the message with its code (`unterminated-block`,
`unmatched-endif`, …) shown when you hover the wavy line. They are taken from the document that already exists,
nothing is parsed for linting. The linter runs 250 ms after the last edit; Mod-Shift-M opens the panel with the
list, which has exactly as many entries as `parse(text).diagnostics`.

## Completion

- **`{`** (or `{na`) outside a comment lists the names of the attributes known at that point: the defaults of
  Nota (`DEFAULT_ATTRIBUTES`), those of `ParseOptions.attributes` and those set by `:name: value` entries above
  the cursor. An attribute unset above the cursor (`:name!:`) is not listed; entries below the cursor do not count;
  an attribute the document may not change (locked by the options) keeps its value; what a cell with the `a` style
  sets counts in that cell only. The value is shown next to the name. Picking inserts `name}` (only `name` when a `}` already follows the cursor).
- **`xref:`** and **`<<`** list the targets of the document: ids from `[[id]]`, `[[id,reftext]]`, `[#id]`,
  `[id=x]` and the ids of sections; the label is the title of the section or the reftext. Picking after `xref:` inserts
  `id[]` with the cursor in the brackets; after `<<` it inserts `id>>`. Targets from the host's `xrefTargets`
  (`guide.adoc#install`) follow those of the document; if the function fails, only the document's targets are listed.
- The context is taken from the text before the cursor; only comments are recognised through the tree.

`asciidocCompletionSource(xrefTargets?)` is the source itself.

### Section ids

The id of a section is what Asciidoctor computes (`Section.generate_id`): `idprefix` (default `_`),
`idseparator` (default `_`), lowercase, characters that are not word characters, spaces, `-` or `.` dropped,
runs of separators squeezed, `_2`, `_3` … on repeats, `:sectids!:` switches generation off, an explicit id
(`[[id]]`, `[#id]`, `[id=x]`) wins. `documentTargets(doc, options?)` returns the targets and the sections with their ids.
The test suite compares them with the ids of Asciidoctor.js on all fixtures of stages 1 and 2 and on a file with
Cyrillic titles and repeats.

An id is generated from the title *after* the substitutions of a title. A title where one could apply (`*bold*`,
`` `code` ``, `{attribute}`, `&`, macros, `(C)`, `--`, an apostrophe …) has no computed id: it is left out of the list
and counted (`markup: true` in `sections`, `skipped` in the result). This goes away when the ids come from the
semantic graph of a later stage of the engine.

## Sessions and the source editor

A **session** is the text of one document, its `NotaDocument` and one undo history. Anything that edits or
shows the text works through it. The session itself lives in `@nota-adoc/core` (the visual editor,
`@nota-adoc/prosemirror`, needs it without CodeMirror); this package exports `createSession` and its types under
the same names, so `import { createSession } from '@nota-adoc/codemirror'` keeps working.

```ts
import { createSession, createSourceEditor } from '@nota-adoc/codemirror'

const session = createSession(text, { parse: { attributes: { flavor: 'x' } } })
const left = createSourceEditor(leftElement, { session, onChange: () => save(left.getText()) })
const right = createSourceEditor(rightElement, { session }) // the same document, live
```

`createSession(text, options?)` returns a `NotaSession`:

| Member | Meaning |
|---|---|
| `text`, `doc` | The current text and its `NotaDocument`. |
| `apply(changes, { origin?, time? })` | Replaces ranges (`TextChange[]`, coordinates of the current text; a `RangeError` on invalid ranges). |
| `undo({ origin? })`, `redo({ origin? })` | One step back or forward; false when there is none. |
| `canUndo`, `canRedo` | |
| `subscribe(listener)` | Called with `{ kind: 'apply' \| 'undo' \| 'redo', changes, origin, doc }` for every change; returns the function that stops listening. |
| `parseOptions` | The options the documents are parsed with. |

`NotaSession` is a structural interface: anything that keeps the text and a history behind these members can be
given to `createSourceEditor`; the visual editor (`@nota-adoc/prosemirror`) uses the same session, so a visual window
and a source window can sit next to each other on one text and one history.

The history is a stack of text replacements, not of CodeMirror transactions (`@codemirror/commands` history is not
used). Every step keeps the replacement that undoes it, so undoing every step gives the first text byte for byte, and
redoing gives the last, whichever editor made the edits. Steps of the same `origin` that come less than 500 ms
apart (`groupDelay`) and touch each other are one step: typing. After an undo the cursor of the editor where
Mod-Z was pressed stands at the place of the step.

`createSourceEditor(parent, options?)` returns a `SourceEditor`:

| Option | Meaning |
|---|---|
| `session` | The session to edit; without one the editor makes its own on `text`. |
| `text` | The text of that own session. |
| `onChange(change)` | Once for every transaction that changes the text — the user's, a replacement from the session, an undo or redo (`change.source`) — and never for the cursor, folds or scrolling. |
| `lineNumbers` | Default `true`. |
| `extensions` | More CodeMirror extensions: a theme, a highlight style. |
| `parse`, `lint`, `xrefTargets`, `autocomplete` | As for `asciidoc()`. |

| Member | Meaning |
|---|---|
| `getText()` | The current text. |
| `scrollToPos(pos)` | Makes the line with `pos` visible, at the top. |
| `topVisiblePos()` | The position of the start of the first visible line. |
| `view`, `session`, `focus()` | The CodeMirror view and the session. |
| `destroy()` | Removes the editor from the page and from the session; later changes of the session do nothing here and throw nothing. |

Mod-Z undoes, Mod-Shift-Z and Mod-Y redo, in whichever editor is focused, for the whole session.

## What is not here yet

- **Preview** of the source (through `@nota-adoc/html` and DOMPurify, scrolling matched by Nota positions) — with the
  HTML converter. The hooks are in place: `SourceEditor.topVisiblePos()`, `scrollToPos(pos)` and
  `NotaSession.subscribe()`.
- **The visual editor and the switch between the two modes** — the ProseMirror editor implements the same
  `NotaSession` or uses `createSession`; the shortcut Mod-Shift-S belongs to the React wrapper.
- **Languages inside `[source,lang]`.**

The demo page in `demo/` (`npm run demo` from the repository root, `http://localhost:5178`) shows all of this
on the fixtures of the quality bench.

License: MIT.
