# Contributing

## Requirements

- Node.js 20.19+, 22.13+ or 24, and npm (CI runs the full set on Node 22 only; on 20 and 24 it builds and runs the tests, on `main` only).
- Google Chrome (or the binary named in `CHROME_BIN`) for the tests of the VS Code webview (the whole `vscode-webview` group, `packages/vscode/test/webview/`).
  Without Chrome these tests are skipped with a reason.
- Docker, only for the Ruby Asciidoctor reference (`npm run ref`, `npm run compare` without `--only js`,
  `npm run corpus -- compare` without `--only js`). Without Docker, `npm run compare -- --only js` compares with
  Asciidoctor.js only.
- A network connection for `npm ci`, `npm run tck`, the first build of the reference image, the downloaded VS Code of the
  e2e run and the ASG schema check (skipped with a message when offline).

All commands run from the root of a clean clone.

## Build, types, lint

```sh
npm ci
npm run build        # core, html, codemirror, prosemirror, react, in this order
npm run typecheck
npm run lint
npm run check:browser  # size limits of the browser builds, no Node modules
```

## Tests

Run the tests by group (`--project`), one group at a time, on a laptop-friendly budget:

```sh
nice -n 19 npx vitest run --project node --maxWorkers 2
```

The groups, which together cover every test file:

| Project | What it covers |
| --- | --- |
| `node` | core, html and `quality/` tests (engine, fuzz, reference tooling) |
| `codemirror`, `prosemirror`, `react` | the editor packages, in jsdom |
| `demo`, `demo-build` | the demo page (jsdom) and its static build |
| `vscode-host` | the extension host, on a stand-in for the `vscode` module |
| `vscode-webview` | the editor tab; **needs Chrome** |

`vscode-webview` starts real Chrome processes through one helper (`packages/vscode/test/webview/chrome.ts`). At most
`NOTA_CHROME_MAX` of them run at the same time (default 2; set it explicitly, for example `NOTA_CHROME_MAX=2`).
A test file that runs many short Chromes takes its slot first, in `beforeAll(() => holdChromeSlot(), CHROME_QUEUE_MS + 10_000)`:
the wait for a slot is bounded there (25 minutes) and does not count in the timeout of a test, and the work of a Chrome has its own limit
(`timeout` of `withChrome` and `chromeDump`). The bundle of the tab is built once per run (`test/webview/bundle.ts`, `await tabBundle()`).
`NOTA_CHROME_TRACE=<file>` writes the phases of every Chrome test (bundle, wait for a slot, Chrome, close) as JSON lines.
Leftovers of killed runs are removed when the next `vitest` run starts. After a run you can check for strays:

```sh
pgrep -f 'user-data-dir=.*/nota-'   # should print nothing
ls -d "$TMPDIR"/nota-*              # no new folders
```

`npm test` runs every group in one go; on a small machine prefer the groups above. A short fuzz run is part of the `node`
group; a longer one: `npm run fuzz -- --runs 100000` (a failure prints a minimal counterexample and the `--seed` to repeat it).

## Demo

```sh
npm run demo         # dev server
npm run demo:build   # static page in demo/dist
npx vite preview --config demo/vite.config.ts --port 5178
```

The built page is static and makes no requests outside its own origin.

## VS Code extension

```sh
npm run vsix           # builds the bundles and packages packages/vscode/*.vsix
npm run test:vscode    # e2e in a real VS Code (@vscode/test-electron)
npm run test:vsix      # checks the .vsix contents and installs it in a clean VS Code
```

The e2e run downloads VS Code into `packages/vscode/.vscode-test/` on the first start. `NOTA_VSCODE_PATH=<path to a VS Code
executable>` uses an installed one instead, and `NOTA_VSIX=<path>` checks another `.vsix`. It needs a screen (on Linux,
`xvfb-run -a`); on a locked macOS screen the cases with undo fail. `NOTA_E2E_ONLY=<part of a case name>` runs one case.

## GitHub release

For the first deployment, set **Settings → Pages → Source** to **GitHub Actions** in `nota-adoc/nota`. Run
the **Pages** workflow on `main` and open the demo from the deployment URL to check it.

From the successful CI run for the release commit on `main`, download and extract the `nota-vscode-<commit SHA>` artifact.
Use its `.vsix` as a binary asset on a draft GitHub release. From a checkout of that commit, for example:

```sh
version=$(node -p 'require("./packages/vscode/package.json").version')
gh release create "v$version" "nota-vscode-$version.vsix" --repo nota-adoc/nota \
  --draft --target "$(git rev-parse HEAD)" --title "Nota $version" --notes-file release-notes.md
```

Run this with the extracted VSIX and your release notes in the current directory. Check the tag, commit and asset in the draft before publishing.

## Localization

Nota speaks English and Russian; English is the default. The words live in four places, each a pair of languages:

- `packages/vscode/src/strings.ts`: the tab, the remarks of the Problems panel and the screen "The visual editor did not open" (`strings.ru`, `strings.en`; `phrases.en` is empty on purpose: it holds the phrases of CodeMirror, which are English already);
- `packages/react/src/messages.ts`: the panel, the menus and the refusals of the editor (`messages.ru`, `messages.en`);
- `packages/vscode/package.nls.json` (English) and `package.nls.ru.json` (Russian): the names of the commands and the descriptions of the settings in the manifest;
- `demo/src/i18n.ts` (the page of the demo), `demo/src/messages.ts` (refusals and labels of the editor) and `demo/src/samples.ts` (the samples; the English ones are `demo/samples/*.adoc`, the Russian ones are the fixtures of `quality/`).

How the language is chosen:

- the manifest follows the display language of VS Code (`vscode.env.language`): with the Russian language pack it reads `package.nls.ru.json`, otherwise `package.nls.json`; the setting `nota.language` does not touch it;
- the tab and the Problems panel follow `nota.language`: `ru` or `en` as set, `auto` (the default) takes the language of VS Code, Russian for `ru…` and English for any other; an unknown value works as `auto`;
- the demo takes the language saved in `localStorage` (`nota-demo-lang`), else `navigator.language`; the EN | RU switch in the header changes it in place.

To add a string, write it in both languages, in the same place, with the same key. A test (`quality/localization.test.ts`) compares the keys of the pairs, nested ones too, and checks that the English values have no Cyrillic letters; a string forgotten in one language turns it red. A change of the README of the extension goes into both `packages/vscode/README.md` and `packages/vscode/README.ru.md` (a test compares their headings and the names `nota.*`).

Why not `vscode.l10n`: the tab is a webview, which does not see `bundle.l10n.json`, and several strings are functions (plurals, names), which a bundle of plain strings cannot hold. The typed dictionaries (`Strings`, `Messages`) check at compile time that both languages are complete, and one mechanism serves the host, the tab and the demo.

## Quality tools

The `quality/` folder holds the checks that keep the engine honest. The ones you are likely to use:

```sh
npm run compare -- --dir quality/fixtures/stage4   # structure and HTML against Ruby Asciidoctor (Docker) and Asciidoctor.js
npm run corpus -- identity --dir quality/fixtures  # the text round-trips byte for byte
npm run corpus -- editor --dir quality/fixtures    # the editor's tree equals the engine's tree after edits
npm run tck                                        # the TCK of the Eclipse AsciiDoc project (pinned commit)
npm run size                                       # what the core browser build consists of
npm run bench -- visual                            # speed of a keystroke in the visual editor
```

`npm run ref -- build` builds the Docker image with Ruby Asciidoctor; without a running Docker `npm run compare` exits
with code 3 and says so.

## Rules

- Every change comes with tests: a bug fix with a test that fails without it, a feature with tests of its behaviour.
- The engine is lossless: `parse(text).text === text` for any input, and an edit changes only the bytes it must.
  Anything that breaks this is a bug, whatever else it fixes.
- Test data is invented: do not put real documents or personal data into fixtures, tests or comments.
- Keep commits small and run the checks above before you open a pull request.
