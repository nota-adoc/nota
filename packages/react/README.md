# @nota-adoc/react

The formatting panel of the visual AsciiDoc editor of [`@nota-adoc/prosemirror`](../prosemirror/README.md), in React:

- `Toolbar` — a style of the paragraph, bold, italic, monospace, strikethrough, highlight, link, text colour, fill, lists, undo, redo;
- the three buttons of lists in `Toolbar` (bulleted, numbered, checklist; pressed for the kind under the cursor);
- `BlockBar` — the panel over an admonition (the five types: Note, Tip, Important, Warning, Caution; Esc hides it); `ADMONITION_TYPES` lists them;
- the button «Insert» in `Toolbar` (`onInsert(anchor)`; off in the mode «Текст») and `InsertMenu` under it: table, code, admonition, collapsible block, image;
- `BlockMenu` — the entries of a menu of blocks (name, line, the chosen one in sight; `listbox` for «/», `menu` with its own focus for a list of «+»; `slashItems(t)` are the eleven blocks both share); `InsertMenu` takes its own `items` (the six of the demo when not given);
- `SlashMenu` — the menu of «/» in an empty line: eleven blocks, narrowed by what is typed after the slash; Esc keeps «/» as text; `onImage()` asks the host for a file; it opens under the line, above it or squeezed (with a scroll of its own) and never goes out of the container, so the page does not scroll (the same for `Dropdown` and the windows placed by `placeBelow`);
- `ImagePicker` — the window that picks the file of a picture from `listFiles(query)`;
- `BlockBar` also has the field «Language» over code (twelve languages; a word that is not in the list is shown as it is written);
- `editorLabels(locale)` — the `labels` option of `createVisualEditor` in the language of the host;
- `BubbleMenu` — the same marks, colour, fill and link over the selected text (under it where there is no room above); Esc hides it. With the property `row` (a `ColorPopover` in the row mode) the colours stand in place of its buttons, the panel stays one row high;
- `CellMenu`, `AlignRow` — the capsule of two or more selected cells, of the shape of `BubbleMenu` (the same classes, place and fold of its row): merge, split, alignment, fill of cells, the head, clear, delete rows and columns; under the selection (over it where there is no room), past the grips and the capsules; the buttons that do not fit go into «⋯». The property `row` takes `AlignRow` or a `ColorPopover` (`kind="cell"`) in the row mode; `hidden` puts it away while another row of the tab is open. The editor behind it: `splitCells`, `setCellAlign`, `clearCells`, `deleteSelectedRows`, `deleteSelectedColumns` and `tableAt().selection`;
- `LinkPopover` — the field of a link under a button, with three tabs: an address, a section of the document, another file;
- `ColorPopover` — the window of the colour of letters (`hl-red`, `hl-orange`, `hl-green`, `hl-teal`, `hl-blue`, `hl-purple`, `hl-pink`, `hl-gray`) and of the fill (`hl-yellow-bg`, then the same eight with `-bg`: `hl-red-bg`, … `hl-gray-bg`)
  with the line of how the piece is written in the text. With the property `row` it is no window but a row of circles («‹», the label, the circles, the name and the record) that a host puts in place of the row it was opened from; «‹» and Esc call `row.onBack`;
- `messages` — every string, in Russian (`ru`) and English (`en`), and the texts of the refusals of the editor by their codes;
  `pickLocale(code)` takes `ru` for a language code that starts with `ru` and `en` for any other.

The components only call `editor.commands` of the visual editor and read the state under the cursor (a plugin of ProseMirror); they write nothing
to the text themselves. The host gives them the `editor`, the `locale`, the lists (`listSections()`, `listFiles(query)`) and decides what
to do with the windows (`onLink`, `onColor`, `onApply`, `onClose`). `packages/vscode/src/webview/format.tsx` is a host.

```tsx
import '@nota-adoc/react/style.css'
import { Toolbar, pickLocale } from '@nota-adoc/react'

<Toolbar editor={editor} locale={pickLocale(navigator.language)} onLink={openLinkField} onColor={openColorWindow} />
```

The style sheet `style.css` has the classes `.ed-tb`, `.bubble`, `.linkpop`, `.fmtpop` after `design/editor/prototype.html`; the colours are the tokens `--ap-*`
of the theme of the host (`--ap-pop-*` for the panels, `--ap-tx-*` and `--ap-hl-*` for the swatches), with the light theme as the fallback. It sets
no fonts, loads nothing, and the components make no style tags: the panels work under a strict content security policy.

React and `react-dom` are peer dependencies (`^19`), as are `prosemirror-model`, `prosemirror-state` and `prosemirror-view`; the only dependencies are the packages of `@nota-adoc`.
