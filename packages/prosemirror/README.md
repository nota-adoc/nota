# @nota-adoc/prosemirror

A visual AsciiDoc editor on [ProseMirror](https://prosemirror.net/) over the syntax tree of
[`@nota-adoc/core`](../core/README.md). The **text** of the document is the truth: the ProseMirror document is its
_projection_, rebuilt from the Nota tree, and every edit a person makes becomes an _operation on the text_
(`applyOperation` of core). Nothing is parsed or printed by the editor itself, no Tiptap, and no history of its own:
undo and redo are the ones of the session, shared with any number of source editors
(`@nota-adoc/codemirror`) on the same text.

Status: paragraphs, headings, bold, italic, monospace, strikethrough, highlight, text with roles, links, **lists** (bulleted,
numbered, checklists), **admonitions** (`NOTE:` and `[NOTE]` with `====`) and **collapsible blocks** (`[%collapsible]`) are edited
visually; everything else (code and other blocks with delimiters, tables, comments, attribute entries, block macros, inline
footnotes, images, `{name}`, passthroughs other than `pass:q[…]`…) is shown as a plate with its source and is edited in the source editor.
Code, tables and the rest get their visual form in later stages.

Runs in browsers (ESM only). Free software only: the package depends on `@nota-adoc/core`; the `prosemirror-*`
packages are peer dependencies, so the host has exactly one copy of them.

```sh
npm install @nota-adoc/prosemirror prosemirror-model prosemirror-state prosemirror-view prosemirror-transform prosemirror-keymap
```

## Use it

```ts
import { createSession } from '@nota-adoc/core'
import { createVisualEditor } from '@nota-adoc/prosemirror'

const session = createSession(text)
const editor = createVisualEditor(element, {
  session,
  onReject: (message, { code }) => showHint(message),
})

editor.commands.toggleMark('strong') // the same as Mod-B on the selection
editor.commands.setLink('https://example.org')
editor.getText() // session.text
editor.destroy()
```

`createVisualEditor(element, options)` returns a `VisualEditor`:

| Member                 | Meaning                                                                                                                                                                                                                                 |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `view`                 | The ProseMirror `EditorView`, for hosts that need more than this interface.                                                                                                                                                             |
| `session`              | The session the editor works on. Give the same one to a source editor (`createSourceEditor(host, { session })`) to have both windows on one text and one history.                                                                       |
| `getText()`            | The current text.                                                                                                                                                                                                                       |
| `focus()`, `destroy()` | `destroy` removes the editor from the page and from the session.                                                                                                                                                                        |
| `commands`             | `toggleMark(mark)`, `setLink(target)`, `removeLink()`, `setBlockType(type, level?)`, `splitBlock()`, `insertBreak()`, `deleteBackward()`, `deleteForward()`, `undo()`, `redo()`. Each returns false when it was refused or did nothing. |

| Option      | Meaning                                                                                                                                                                             |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `session`   | The session to show and edit (`NotaSession` of `@nota-adoc/core`).                                                                                                                  |
| `onReject`  | `(message, { code, message, operation })`: called when an edit is refused; the text and the screen stay as they were. The message is English or the one in `messages` for the code. |
| `onInexact` | Called with the operation when what was typed or deleted could not be written so that it reads exactly as asked and was written as it is (rare: a backslash typed in front of a mark, say). |
| `messages`  | Messages by code, replacing the English ones (a host in another language, say).                                                                                                     |
| `plugins`   | More ProseMirror plugins.                                                                                                                                                           |
| `timing`    | Called after a keystroke with the milliseconds Nota took (`npm run bench -- visual` uses it).                                                                                       |

## The projection

`projectDocument(doc)` builds the ProseMirror document of a Nota document (`view.state.doc` equals it after every
edit — the editors' invariant, fuzz-tested):

| In the text                                                                                                                     | On the screen (schema node or mark)                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `= Title`                                                                                                                       | `heading` level 1 (`h1`)                                                                                                                                                           |
| `==` … `======`, `##` … `######` sections, `[discrete]` headings                                                                | `heading` level 2–6 (`h2`–`h6`)                                                                                                                                                    |
| a paragraph                                                                                                                     | `paragraph`; its lines are joined with a space, ` +` at the end of a line is a `hard_break`                                                                                        |
| `*b*`, `**b**` / `_i_`, `__i__` / `` `c` `` / `[.line-through]#s#` / `#h#`                                                      | marks `strong` / `em` / `code` / `strike` / `highlight`                                                                                                                            |
| `https://…`, `URL[text]`, `<URL>`, `link:…[…]`, `mailto:…[…]`, `<<id>>`, `<<id,text>>`, `xref:…[…]`                             | mark `link` with the target in `href` (`#id` for `<<id>>`)                                                                                                                         |
| lines over a paragraph or heading: `[[id]]`, `.Title`, `[role]`                                                                 | the attribute `meta` of the node (all lines, as in the file); the lines that are not anchors are in `plain`, shown grey over it by the CSS `[data-meta]::before`; the ids of the anchors (`[[id]]`, `[#id]`, `[id=…]`) are in `anchor` and drawn by an empty widget `.nota-anchor[data-id]` that the CSS shows or hides                                                                                             |
| a blank line beyond the first between blocks, and blank lines at the end                                                        | an empty `paragraph` each                                                                                                                                                          |
| `* a`, `- a`, `. a`, `1. a`, `** a`, `* [x] a` (a list whose items are single paragraphs; one blank line between items, or in an item before a nested list, is allowed and stays in the text) | `list_item`, one flat node per item: `attrs.level` (the depth), `ordered`, `num` (the number as Asciidoctor shows it: `1.`, `a.`, `i.` by the dots of the marker), `checked` (`''`, `' '`, `x`) |
| `NOTE: a`, `TIP:`, `IMPORTANT:`, `WARNING:`, `CAUTION:`, and `[NOTE]` over `====` | `admonition_paragraph` (`attrs.variant`); the block form is `box_head` + the blocks inside + `box_end` |
| `[%collapsible]` over `====` (`.Title`, `%collapsible%open`) | `box_head` (`attrs.box`, `title`, `startsOpen`) + the blocks inside + `box_end`; the open state is the editor's, not the file's |
| `----` over `----` (also `[source,lang]` and `[listing]`) | `code_block` (`attrs.lang`): the text between the delimiters, one position per character; the colours come from the option `highlightCode` |
| `[mermaid]` (also `[mermaid,name,svg]`) over `....` or `----` | `diagram` (`attrs.name`): the code between the delimiters, one position per character; the picture comes from the option `renderDiagram`; `[source,mermaid]` stays `code_block` |
| `image::path[]` with an optional `.Title` line over it | `image` (`attrs.target`): the figure, the caption is the content of the node (the `.Title`); the picture comes from the option `images` |
| the header of a page, with the option `pageMeta`: a block comment `////` with lines `key: value` at the start of the file, and the attribute entries and blank lines up to the first block of content (before and after the title, and after one paragraph that is a single link) | `page_meta` (one per run of lines, no text, size 1, not selectable): nothing is drawn, no cursor goes in, Ctrl+A and Delete, typing over a selection and paste leave it; `editor.pageMeta()` and `onPageMeta` tell the fields, `editPageMeta()` shows the lines as islands (`PageMeta`, `PageMetaTail`) and `collapsePageMeta()` hides them again; a cursor in the text that comes to the header goes to the start of the title. The run may also follow one paragraph that is a single link, in as many runs (`PageMetaBody`) as that paragraph and the lines `toc::[]` between them make; `onPageMeta` also tells `attributes`; Enter at the end of the paragraph before a run writes the new paragraph after the last run |
| a line `toc::[]` with nothing else (no attributes in the brackets, no lines of metadata over it) | `toc` (atom, size 1, a narrow line «Table of contents», selected as a block and removed with its line); in the zone of the header of a page `toc_pinned` (not selectable: Ctrl+A and Delete leave it) |
| everything else: lists with blocks or a continuation `+` inside items (a blank line before a block in an item too), other blocks with delimiters, tables, comments, entries, other block macros, styled and literal paragraphs | `island`: the source of the block, edited as plain text (a dashed frame with a note); an edit that would change the blocks around it is not written (`attrs.unsaved`) |
| text with roles: `[.zz-a]#x#`, `[.zz-a]##x##`, `[zz-a]#x#`, `[.a.b]#x#`, `[.zz-a]*x*`, `[.zz-a]_x_`, `` [.zz-a]`x` ``           | mark `roles` (`attrs.attrs`: the `[…]` as written) shown as `<span class="zz-a">`, the names of the roles as classes; `*`, `_`, `` ` `` make the mark `strong` / `em` / `code` too |
| `pass:q[…]` and a visible `((…))` (the text of both is plain, with marks in `pass:q[…]`) | text with the marks it shows; no markers on the screen, the text is not edited (see below)                                                                                         |
| inline: footnotes, `{name}`, images, other passthroughs, other indexes, `^x^`, `~x~`, `[#id.r]#x#`, `[.r,k=v]#x#`, `[.r{a}]#x#`, …          | `inline_chip` with the source                                                                                                                                                      |

Roles are text with a name: the editor knows no names and no colours, and the package brings no styles, so the host
styles the classes (`.zz-a { … }`). Text with roles is edited as text: what is typed inside a piece stays in it and keeps
the roles; typed at its end it goes in (as at the end of bold), typed before it stays out; the `[…]` of a piece is never
rewritten, only its markers can change between `#` and `##` where a single one would not be read. Nothing makes a role
from typing, pasting or cutting. Roles are only for `[…]` that holds roles and nothing else; an id, an attribute
reference or a named attribute makes the construct a plate.

`pass:q[…]` (the substitutions are exactly `q`) and a visible `((term))` (plain text, no markup in it) are shown as their text:
`pass:q[*a* _b_]` is `a` in `strong` and `b` in `em`, with no `pass:q[` and `]` on the screen, and `((term))` is `term`. They lie
in coloured text like any text (`[.hl-red]#a pass:q[*b*] c#` is red as a whole), and colour in `pass:q[…]` is shown too
(written `pass:q[[.hl-red\]#x#]`: a plain `]` would end the passthrough). The text of such a construct is **not edited**:
typing, Backspace or Delete between its characters, a selection that starts outside and ends inside, Enter inside, and
Backspace right after it or Delete right before it are refused with `inside-construct`. A selection that holds it whole
deletes it, in one step; typing next to it, and anywhere else in the paragraph, leaves its source byte for byte. A mark or a
link over a part of it is refused with `inside-construct` too. `pass:[…]`, `pass:c[…]`, any set of substitutions but `q`,
`+…+`, `++…++`, `+++…+++`, `$$…$$`, hidden `(((…)))`, `indexterm:[…]`, `indexterm2:[…]` and `((…))` with markup in it
(`((*a*))`) stay plates, in coloured text too.

Markers are not shown; a paragraph or heading the editor cannot read as text (a first line that starts with blanks,
comment lines inside) is a plate. The schema is exported as `schema`.

## The map of positions

The map between the text and the ProseMirror document lives next to the document, not in its nodes: for every
top-level node the item of the Nota document it shows (with its range in the text) and the position the node starts
at. Inside a paragraph or a heading, one ProseMirror position is one _cell_ of the text — a visible character, a hard
break or a plate — and the map to the source is read from the Nota tree when it is needed (and kept for the next
keystroke). A change of the text rebuilds only the blocks whose reading changed; the nodes of the others stay the
same objects, so ProseMirror does not redraw them.

The text of a plain cell of a table (`psv`, no style or `header`, written in the source as it is) is the same: the
node `cell_text` holds inline content with the marks of a paragraph (links, bold, italic, code, roles, plates), one position
is one cell of the reading, and typing, deleting, marks, links, colours and Tab (to the next cell) work in it as in a
paragraph, while Enter does nothing there; the paragraphs of an `a` cell are read the same way, and a list of an `a` cell whose items hold nothing but text is shown as a list (`cell_text` with `item`, the marker and the level of the item; the code, a warning and an item with a continuation stay plates): Enter at the end of an item opens an empty item that is not in the file until something is typed in it (Backspace or Enter in it takes it away), Enter in the middle splits the item, Enter at its start is refused with `item-start`, Enter in a paragraph does nothing, and Tab goes to the next cell without changing the level of the item; the map of positions of the cell is read from the source of the cell. A cell that is not read (`csv`, `dsv`, styles
`l`, `m`, `e`, `s`, an escaped bar, a blank line) shows its source as text; marks and links on it are refused with
`cell-text`, and a bar typed in a cell with a link or marks with `cell-bar`; the file stays. A cell of several lines in a file with CRLF is written with CRLF (a file with both keeps the line ends of each cell).

## What a person does

| Action                                                                                           | What happens                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Typing**, deleting inside a block, an input method                                             | _The fast path._ A step that replaces plain text inside one block becomes `insertText` / `deleteRange` / `replaceText`; what is typed is written so that it reads as plain text (`*x*` typed is written `\*x*`; `+x+`, `{name}`, `<<id>>`, `xref:a[b]`, a URL, `(C)` likewise), and the block is checked against its projection. A step that comes from a plugin or the browser and is not this (a structural step, a mark, a replacement over several blocks, a drop) is not applied. |
| **Input methods** (`compositionstart` … `compositionend`)                                        | While composing, the text is not touched; after the composition it is one replacement with what was typed, one step of the history.                                                                                                                                                                                                                                                                                                                                                    |
| **Enter**                                                                                        | `splitBlock`: two paragraphs with a blank line between; at the end of a block an empty paragraph follows; in an empty paragraph, another one. Shift-Enter: `insertBreak` (` +` and a new line).                                                                                                                                                                                                                                                                                        |
| **Lists**: Tab, Shift-Tab, Enter, Backspace, `* ` `- ` `. ` `1. ` typed in an empty paragraph, the checkbox | Tab / Shift-Tab: `indentListItem` / `outdentListItem` (one level, refused with `unsupported` when Shift-Tab would not give the text back byte for byte; Tab outside a list does nothing and keeps the focus in the editor). Enter: a new item of the same level and kind (numbered items after it are renumbered); in an empty last item the list ends with a paragraph, in an empty item in the middle it is refused (`list-middle`). Backspace at the start of an item joins it to the one before. A marker and a space typed in an empty paragraph start an item (or a heading for `==`) that is written with its first character. A click on the box is `setChecked`. |
| **Admonitions and collapsible blocks** | `setAdmonitionType(variant)` changes only the word (`NOTE:` → `WARNING:`, `[NOTE]` → `[CAUTION]`; `[TIP#id.role]` keeps its id and role). `toggleCollapsible(offset?)` opens or closes a block on the screen and does not touch the file; a cursor put inside a closed block opens it. The text inside is edited as ordinary blocks. |
| **Backspace / Delete**                                                                           | A character, a selection (inside a block or over several, plates too), or `joinBlocks` at the edge of a block; at the start of the first block, or next to a plate, nothing.                                                                                                                                                                                                                                                                                                           |
| **Arrows and clicks** at an inline plate                                                         | An inline plate is never selected as a whole (`selectable: false`, like `hard_break`): a selected node has no caret. An arrow passes it in one press, a click on it puts the caret at its nearer edge; what is typed goes there. Shift-arrow takes it into a selection; Backspace after it or Delete before it takes it away. A block plate is unchanged: a click selects it with a frame.                                                                                             |
| **Clicks and drags** in the cells of a table | Pressing in a cell and dragging into another cell of the same table selects the block of cells (grown to whole merged cells) and draws it with one frame; the caret and the selected text are hidden while two cells or more are selected. Shift-click on a second cell does the same (after a drag, from the cell where the drag began). `mergeCells` and `setCellFill` work on the block. Esc, a click without Shift and a typed character let it go; the selection is not written to the text or to the history. A drag that stays in one cell selects its text; in a nested table only its cells are selected. The cells get the classes `sel` and `e-t`/`e-b`/`e-l`/`e-r` (the edges of the block) and, on the cells in the corners of the table, `c-tl`/`c-tr`/`c-bl`/`c-br` (part of the API for the styles of the host, to round the frame as its table is rounded), the editor `cells-on` and, while dragging, `cells-drag`. |
| **Grips and borders** of a table | A layer beside the editor (`.nota-grips`, `position: fixed`, clipped to the scroll of the document) is laid over the innermost table under the mouse: a grip of 3 px for each column in a band of 10 px over the frame (8 px for a table in a cell) and one for each row in a band at its left. A click on a grip selects the column or the row (grown to whole merged cells; the cursor goes to its first cell), Shift-click on another grip of the same kind selects all between; Esc, a click in a cell and a typed character let go; nothing is written. `deleteColumn` and `deleteRow` go to all the selected columns or rows in one step of the history (the old refusals stay: `last-column`, `last-row`, `column-merged`, `row-merged`); a click on a grip that would grow over a merged cell to the whole table is refused with `column-merged-all` or `row-merged-all` (the selection and the file stay; a Shift-click from the first to the last line still selects the whole table); `setCellFill` goes to all their cells. `tableAt()` tells how many (`selectedCols`, `selectedRows`). A border between two columns (over the whole height of the grid, also where a merged cell crosses it) is dragged with the mouse and goes where the mouse goes: to the right the left column takes its width from the table, the neighbour stays and the table grows (it may be wider than its frame, the frame scrolls); to the left the table narrows while it is wider than its frame, then the neighbour takes the width; the label shows `N%`, the number that will be written for the left column; the only stop is the least width (64 px) of the dragged column, the border never goes back, and the label says only `widthLimit` («Minimum width»). The last column has a border of its own at its right edge (the strips `.bd` have `data-border` = the number of the border, the last is the number of columns; it is drawn when the edge is in the frame, i.e. in a table wider than its frame after the frame is scrolled to the end): to the right the column and the table grow, to the left they narrow by as much as the table is wider than its frame, then the edge stops at the right edge of the frame with the label `widthFrame` («Frame width»), or earlier at 64 px of the column with `widthLimit`; a double click there does nothing (no pair). A table wider than its frame has its scroll bar in `.tbl-bar`, a copy of the bar of the frame (hidden then: `.has-bar`) linked to it, one per table, none in a table in a cell. While the bottom of the table is below the window the bar stands at the very bottom edge of the scrolling element (`.bar-stuck` on the table, set by `TableNodeView` on scroll and resize: 15 px, a line, a gap, the track of 10 px, a gap; the side lines of the frame reach it); when the bottom is in the window it stands right under the frame. The air after the document must not be the `padding-bottom` of the scrolling element (the bar sticks to the edge of its content box): use a block after the page (`.scroll::after` in the tab of VS Code). The name of the bar is `labels.tableScroll`. In a table with widths (`tbl-fixed`) and while a border is dragged (`tbl-drag`) the content of a cell breaks inside a word (`overflow-wrap: anywhere`, also code, list items and plates), so the least width of a column does not hold it wider than it was dragged to; a table without widths keeps the layout of its content until its first drag, and a picture or a nested table in a cell still holds its column at their width. The layout of the drag is fixed in pixels at the first move, then the head wraps; a table dragged wider than its frame keeps its width, bound to the widths written (Cmd+Z goes back to the old width, Cmd+Shift+Z to the width of the drag; the file has only the percents, so a file opened again lays the table out by them; a table whose columns cannot all be as wide as their percents say gets a `min-width` so that the narrowest percent is 64 px); on release `setColumnWidths` writes whole percents that add up to 100 (the form of `cols` is kept: a `%` that was there, alignment and style; a column of `~` gets a number; no `cols` — the attribute is added), one step of the history. A press without a move writes nothing, Esc takes the drag back, a double click shares the width of the two columns equally. A table with `%autowidth`, a `{attr}` in `cols`, or a number in `cols` that is not the number of columns gets the refusal `width-autowidth`, `width-attr` or `width-count` (`{attr}`, `{cols}`, `{table}` in the text are filled in by the editor), the widths go back. A table whose `cols` is a list (`1,3`, `20%,80%`; `explicitWidths()` tells it from the text of the attributes, the node has `fixed`) gets the class `tbl-fixed`, and a table whose border is being dragged `tbl-drag` (from the first real move, the layer reads the widths and places again; Esc and release take it off): a host lets the head wrap in both (else the columns sit at the least width of their content and a width in `<col>` does nothing). The hints are the labels `gripColumn` and `gripRow` (the accessible names, «Column {n}»), `gripBorder`, `widthLimit` and `widthFrame`; no strip has a `title`, the name is in `aria-label`. At a grip the bar of three buttons (add before, add after, delete: `tablelinebar.ts`, a child of the layer; the labels `bar*`) works on the line of the grip, or on the selected lines; the hint of a button is its own card (it does not lie on the cells of other lines, on the grips, on the capsules); the grips are keyboard-reachable (`role="button"`, Shift+Tab in the first cell, arrows, Enter opens the bar); `GripHost` has `insert`, `remove`, `refusal`, `focus` and `leave`; new refusals `row-above-head`, `row-below-foot`, `cols-attr`, `cols-count`. A block of the handle `BlockSpot` of a table has `frameTop`, the top of its frame (the handle «⋯» stands over the corner). |
| **Marks**: Mod-B, Mod-I, Mod-E (monospace), Mod-Shift-X (strikethrough), Mod-Shift-H (highlight) | `toggleMark` on the selection; without a selection, the mark is for what is typed next.                                                                                                                                                                                                                                                                                                                                                                                                |
| **Links**                                                                                        | `commands.setLink(target)` — `https://…[text]`, `link:…[text]`, `<<id,text>>`, `xref:…[text]`; on a link only the target changes; `removeLink()`. A link over two paragraphs is refused (`link-across-blocks`).                                                                                                                                                                                                                                                                        |
| **Styles**: Mod-Alt-0 (paragraph), Mod-Alt-2 … 6 (heading)                                       | `toggleBlockType`: the key again goes back to a paragraph (all paragraphs and headings of the selection together, in one step; list items, cells, admonitions and the title are skipped, and in them a heading is refused with `style-off`); an empty line takes a draft heading that is written with its first letter; with «/» open Mod-Alt-2 … 6 pick «Заголовок 2» … «Заголовок 6». `setBlockType` sets the style on every block of the selection and does not go back; the kind of markers (`=` or `#`) is kept. A paragraph of several lines becomes a heading of one line (Cmd+Z brings the lines back). Ctrl+Alt+digit that gives another sign (AltGr) is not taken.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Undo / redo**: Mod-Z, Mod-Shift-Z, Mod-Y, and the browser menu (`historyUndo`/`historyRedo`)   | `session.undo()` / `session.redo()`; the cursor goes where the undone edit was.                                                                                                                                                                                                                                                                                                                                                                                                        |
| **Paste**                                                                                        | Plain text only; a line break makes a new paragraph; all of it is one step. HTML → AsciiDoc is later.                                                                                                                                                                                                                                                                                                                                                                                  |
| **Drag and drop**                                                                                | Refused.                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

The package brings no styles. A host gives `.nota-inline-chip` the pointer `cursor: text`, so that over a plate it is the
text one, as over the text around it (the demo does).

An edit that cannot be written so that it reads as asked is refused with a code and a message (`onReject`) and
changes nothing: `link-across-blocks`, `link-overlap`, `bad-target`, `empty-selection`, `no-link`, `not-editable`,
`becomes-plate` (what is typed, or what is left after a deletion, would make a list or a code block), `break-in-heading`, `document-title`, `join-meta`,
`inside-construct`, `inside-plate`, `collateral`, `unstable`, `leading-blank` (taking off a mark or a link would leave a blank at the start of a paragraph, where it cannot be written), `invalid-range`, `unknown-mark`.

### Commands and state of lists and boxes

`editor.commands`: `toggleList(kind)` (`'unordered' | 'ordered' | 'check'`: the paragraph under the cursor, or all paragraphs of a selection, become items of one list; the same kind again gives paragraphs back), `indentListItem()`, `outdentListItem()`, `setChecked(checked?, offset?)`,
`setAdmonitionType(variant)`, `toggleCollapsible(offset?)`. State for a panel: `listAt()` (kind and level of the list under the cursor, or null), `admonitionAt()`
(its variant), `boxAt()` (`'admonition' | 'collapsible' | null`); `markerPending` is true for a moment after a marker is typed in an empty paragraph, so that a host
does not send to its document an edit that a space is about to take back. The option `labels` gives the strings of the editor (the name of a type, the title
of a box in a screen reader) in the language of the host; `editorLabels(locale)` of `@nota-adoc/react` makes it. The labels are set for the page: two editors in different languages
on one page share the last ones set.

### Code, images, islands and the menu of blocks

Options: `images(target) => { src } | { missing } | { remote }` (the host says where the picture of an image is; `remote` and `missing` show a plate and no request is made),
`highlightCode(language, text) => { from, to, class }[]` (the colours of a block of code; the language is one of `LANGUAGES`, synonyms such as `js` or `sh` are read by
`canonicalLanguage(word)`). Commands: `indentCode(±1)` (Tab / Shift-Tab in code: two blanks, or every selected line), `setCodeLanguage(id)`,
`insertBlock(kind, { path?, title? })` (`heading2` … `heading6`, `unordered`, `ordered`, `checklist`, `table`, `code`, `mermaid`, `admonition`, `collapsible`, `image`), `dismissSlash()`.
State: `codeAt()` (the language of the code under the cursor, or null), `slashAt()` (the query of the «/» menu, its offset and the rectangle of the cursor, or null).
Headings, lists, `NOTE: ` and the collapsible block are written to the file with the first typed letter, as a list is.
A table is a `|===` of 3×3 with a header and is an island.

### Diagrams and the clipboard

Options: `renderDiagram(code, theme) => Promise<string>` (the markup of an SVG, or a rejection with the error of the renderer; `RendererMissing` says the renderer did not load, and a plate says so) and `diagramTheme() => 'light' | 'dark'`.
The editor draws nothing itself: a picture is drawn at the first sight of the block and 300 ms after the last change of the code, and the last good one stays, greyed, under the message of the error.
`redrawDiagrams()` draws every diagram again (the theme changed). The code is written with the delimiters as long as it needs.

Paste (`text/html` in the clipboard, no `vscode-editor-data`): `paste.ts` reads bold, italic, monospace, strikethrough, links (http, https, mailto), lists with levels (also the lists of Word), headings, simple tables;
the text is escaped by the escaper of the core and read back, and a fragment that would read differently is refused (`onReject` with `paste-refused`). The first paragraph goes into the paragraph
that holds the cursor, the other blocks after it, in one step of the history. Code, a cell, a heading and a source editor get plain text. Pictures are not pasted (`paste-images`).
`commands.pastePlain(text)` is Cmd+Shift+V: every line a paragraph, no marks.

## Limits of the first stage

- **Keys through `handleKeyDown`.** The keys (Enter, Backspace, Delete, the marks, undo) are heard on the DOM `keydown`
  event. Where ProseMirror makes a key up itself from the input events (the virtual keyboards of iOS and Android), the
  key does not reach the editor's commands. The first stage is for a desktop keyboard; the mobile keyboards come with
  the next ones.
- **A composition that loses its end.** An input method holds the text of the session off the screen until
  `compositionend`; when the editor loses focus the composition ends by itself. What was composed is put in where its
  place is by then, also when the text changed meanwhile (an edit in the source).
- **The end of a composition reads an internal of prosemirror-view.** At `compositionend` the editor asks
  `view.domObserver` (`flush`, `forceFlush`) for the last change of the DOM: Chromium changes the DOM and sends the
  event in one run of the script, so without it the text would still be what the input method showed before its end
  («ni», not «你»). `domObserver` is not part of the public API of prosemirror-view; it is checked on 1.42.6, and
  `peerDependencies` starts there (`^1.42.6`). Where it is not there, the order of events of Chromium can leave the
  intermediate text, and the editor says so once with `console.warn` and ends the composition with what ProseMirror
  has read; the text is not lost.
- **Links.** An anchor gets no `href` for a target that runs code (`javascript:`, `data:`, `vbscript:`); the mark keeps
  the target as it is in the text.

## Checked by

The quality bench of the repository: `npm run fuzz -- --property editor/actions` (random chains of the actions above on
all fixtures: the screen equals the projection from nothing after each, nothing outside the target changes, every
command is applied or refused, undoing everything gives the first text byte for byte) and
`npm run bench -- visual` (a keystroke in a document of 200 KB: p95 under 16 ms, of which Nota's part under 3 ms).
The behaviour of input methods is checked in jsdom with composition events, in the order of Chromium (the last change
of the DOM and `compositionend` in one run of the script: the text gets what the input method ended with, not what it
showed before: «ni» → «你», «е» → «ё», a cancelled composition); Cyrillic and macOS auto-correction are
tried by hand in Safari and Chrome (`npm run demo`).

## What is not here yet

Tables, code and images; items with blocks inside (they stay plates); islands with the source of a construct inside the visual window.
