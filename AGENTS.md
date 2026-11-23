# AGENTS.md

Guide for AI assistants (and people) who open this repository for the first time. Human contributors: see
[CONTRIBUTING.md](CONTRIBUTING.md). A short index of the files is in [llms.txt](llms.txt).

## What this is

Nota is lossless AsciiDoc for TypeScript, an npm workspace of packages (`@nota-adoc/*`):

- a parser that keeps every byte of the source: `parse(text).text === text` for any input, the tree is a
  [Lezer](https://lezer.codemirror.net/) tree;
- an HTML converter that writes what the `html5` backend of Asciidoctor 2.0 writes for an embedded document;
- editing operations that change only the bytes they have to, and a session with one undo history;
- a visual editor (ProseMirror), a source editor (CodeMirror), React controls, and a VS Code extension on top of them.

How it differs from Asciidoctor (what is supported, what is not): [docs/asciidoctor-differences.md](docs/asciidoctor-differences.md).
Status: alpha (0.x), not published to npm yet.

## Install, build, check

Node.js 20.19+, 22.13+ or 24. Run everything from the root of the clone.

```sh
npm ci
npm run build          # core, html, codemirror, prosemirror, react
npm run typecheck
npm run lint
npm run demo           # dev server of the demo page
npx tsx examples/parse.ts   # runnable examples: parse.ts, walk.ts, render.ts
```

Tests run by group, one group at a time (project names are in `vitest.config.ts`):

```sh
nice -n 19 npx vitest run --project node --maxWorkers 2
```

| Group | Covers |
| --- | --- |
| `node` | core, html, `quality/` (fuzz, reference tooling, docs checks) |
| `codemirror`, `prosemirror`, `react` | the editor packages, in jsdom |
| `demo`, `demo-build` | the demo page and its static build |
| `vscode-host` | the extension host, on a stand-in for `vscode` |
| `vscode-webview` | the editor tab; needs Chrome |

One test file: add its path after the options, for example
`npx vitest run --project node --maxWorkers 2 packages/core/test/session.test.ts`.

## Layout

| Path | What is there |
| --- | --- |
| `packages/core` | the engine: parser, tree, diagnostics, ASG, session, `applyOperation` ([README](packages/core/README.md)) |
| `packages/html` | the HTML converter ([README](packages/html/README.md)) |
| `packages/codemirror`, `packages/prosemirror`, `packages/react` | the editor |
| `packages/vscode` | the VS Code extension |
| `quality/` | checks of the engine: fuzzing, comparison with Asciidoctor, reference tooling, docs tests |
| `demo/` | the demo page (static, no server) |
| `examples/` | runnable examples of the API, checked by `quality/examples.test.ts` |
| `docs/` | documentation that is not in a README |

`packages/core` and `packages/html` are the engine; the other packages need a DOM.

## Rules and pitfalls

- **The text is the truth.** `parse(text).text === text` for any input, and an edit changes only the bytes it must.
  Anything that breaks this is a bug, whatever else it fixes. `parse` never throws.
- **Every change comes with tests**: a bug fix with a test that fails without it, a feature with tests of its behaviour.
- **Do not run the full `npm test` on a weak machine.** Run the groups above, one at a time, with
  `nice -n 19` and `--maxWorkers 2`. A `node` run includes a short fuzz run.
- **Chrome tests** (`vscode-webview`) start Chrome only through one helper,
  `packages/vscode/test/webview/chrome.ts`: at most `NOTA_CHROME_MAX` processes (default 2; keep it at 2 or less). Do
  not start Chrome in a test any other way. After a run, check for strays and remove your own:
  `pgrep -f 'user-data-dir=.*/nota-'` should print nothing, and `ls -d "$TMPDIR"/nota-*` should show no new folders.
- **Test data is invented.** No real documents, names or personal data in fixtures, tests, examples or comments.
- **`@nota-adoc/core/internal` is not an API for applications.** It is what `@nota-adoc/html` and the editors build on and
  may change in any release. Applications use `@nota-adoc/core` and `@nota-adoc/html`.
- **The HTML is not cleaned.** A passthrough (`+++<script>…+++`) is written as it is, as Asciidoctor does in `secure`
  mode. Cleaning the HTML before it is shown is up to the host.
- **Documents come from `parse()`.** `renderHtml` and `applyOperation` refuse a plain object that looks like a document;
  two copies of `@nota-adoc/core` in `node_modules` make documents of one copy useless to the other.
- **Offsets are UTF-16 offsets** in the text of the document the change is applied to. `doc.update` and `session.apply`
  throw `RangeError` for a range outside the text or for ranges that overlap, and `TypeError` for an `insert` that
  is not a string. `applyOperation` does not throw on a bad position: it returns `{ error: 'invalid-range', … }`.
- **Messages of diagnostics are read by the VS Code plugin.** It translates them by their English text
  (`packages/vscode/src/webview/diagnostics.ts`): change a message of the parser together with its translation.
- **The reference is Ruby Asciidoctor 2.0.26.** Where Asciidoctor.js 4.1 differs, Nota follows Ruby and the difference is
  recorded in `quality/reference/known-differences.json`. Docker is needed only to compare with Ruby.
- **No secrets, tokens or real people's data** in files that are committed.

## Where to look

- The API of the engine: [packages/core/README.md](packages/core/README.md), the descriptions of the exports in the
  editor (TSDoc), and [examples/parse.ts](examples/parse.ts).
- Why the HTML looks as it does: [packages/html/README.md](packages/html/README.md).
- Commands for the quality tools, the VS Code extension and the demo: [CONTRIBUTING.md](CONTRIBUTING.md).
