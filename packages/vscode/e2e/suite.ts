/**
 * The suite of `npm run test:vscode`, run inside a real VS Code with the extension: open a fixture in the visual editor, type,
 * save, undo, an edit in a text editor beside it, a change on disk. The page types and undoes through commands that exist
 * only when the host started with `NOTA_E2E=1`; everything after that (the mirror, the host, the document, the history,
 * the files) is the real thing.
 */
import * as assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import * as vscode from 'vscode'

const work = process.env.NOTA_E2E_WORK!
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function waitFor(what: string, check: () => boolean | Promise<boolean>, ms = 5000): Promise<void> {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (await check()) return
    await sleep(50)
  }
  assert.fail(`timeout: ${what}`)
}

const lines = (text: string): string[] => text.split(/\r?\n/)

/** How many lines differ (same count of lines assumed). */
function changedLines(before: string, after: string): number {
  const a = lines(before)
  const b = lines(after)
  assert.equal(a.length, b.length, 'the number of lines is the same')
  return a.filter((l, i) => l !== b[i]).length
}

async function openVisual(name: string): Promise<vscode.TextDocument> {
  const uri = vscode.Uri.file(join(work, name))
  await vscode.commands.executeCommand('vscode.openWith', uri, 'nota.visual')
  await waitFor('a custom editor tab of the file is open', () => {
    const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input
    return input instanceof vscode.TabInputCustom && input.viewType === 'nota.visual' && input.uri.fsPath === uri.fsPath
  })
  const doc = await vscode.workspace.openTextDocument(uri)
  // the page is ready when it answers a command
  await waitFor('the page of the tab answers', async () => (await vscode.commands.executeCommand('nota.e2e.type', '')) === true, 20000)
  return doc
}

async function type(text: string): Promise<void> {
  assert.equal(await vscode.commands.executeCommand('nota.e2e.type', text), true)
}

interface TabState {
  mode: 'visual' | 'text'
  anchor: number
  head: number
}

/** The mode and the selection of the tab the person is in. */
async function state(): Promise<TabState | undefined> {
  return (await vscode.commands.executeCommand('nota.e2e.state')) as TabState | undefined
}

async function waitMode(mode: 'visual' | 'text'): Promise<TabState> {
  let last: TabState | undefined
  try {
    await waitFor(`the mode is ${mode}`, async () => ((last = await state())?.mode === mode), 40000)
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)} (the last state: ${JSON.stringify(last)})`, { cause: error })
  }
  return last!
}

/** Like a click on a remark in «Проблемы» or on a counter of the tree: the cursor goes to the offset. */
async function place(doc: vscode.TextDocument, offset: number): Promise<void> {
  await vscode.commands.executeCommand('nota.revealProblem', doc.uri, offset)
  await waitFor('the cursor is there', async () => (await state())?.anchor === offset)
}

/**
 * A click on the code of a line in «Проблемы». The panel draws the code as a link and opens it with `allowCommands: true`
 * (checked in VS Code 1.144); the opener of commands reads the arguments from the query (a JSON array) and runs the command.
 * The extension API cannot press the link (`openExternal` and `vscode.open` refuse the scheme `command:`), so this does the
 * same two steps with the link that came back from VS Code in `getDiagnostics`.
 */
async function click(target: vscode.Uri): Promise<void> {
  assert.equal(target.scheme, 'command')
  const args = JSON.parse(decodeURIComponent(target.query)) as unknown[]
  await vscode.commands.executeCommand(target.path, ...args)
}

const problemsOf = (doc: vscode.TextDocument): vscode.Diagnostic[] =>
  vscode.languages.getDiagnostics(doc.uri).filter((d) => d.source === 'nota')

/**
 * A command of a table, then one Cmd+Z: the text of the document is the same to the byte. `setup` puts the cursor
 * where the command works and returns what to wait for after the command.
 */
function tableCase(
  title: string,
  file: string,
  text: string | null,
  command: [string, ...string[]] | [string, ...string[]][] | ((original: string) => [string, ...string[]] | [string, ...string[]][]),
  cursor: (original: string) => number,
): [string, () => Promise<void>] {
  return [
    `table: ${title}, one Cmd+Z takes it back byte for byte`,
    async () => {
      if (text !== null) writeFileSync(join(work, file), text)
      const doc = await openVisual(file)
      const original = doc.getText()
      const at = cursor(original)
      await vscode.commands.executeCommand('nota.e2e.select', at, at)
      await waitFor('the cursor is in the cell', async () => (await state())?.anchor === at)
      const given = typeof command === 'function' ? command(original) : command
      const list = (Array.isArray(given[0]) ? given : [given]) as [string, ...string[]][]
      for (const c of list) await vscode.commands.executeCommand('nota.e2e.table', ...c)
      await waitFor('the command changed the text', () => doc.getText() !== original, 20000)
      await sleep(500)
      await vscode.commands.executeCommand('nota.e2e.undo')
      await waitFor('one Cmd+Z takes it back', () => doc.getText() === original)
      await vscode.commands.executeCommand('workbench.action.files.revert')
    },
  ]
}

function tableCases(): [string, () => Promise<void>][] {
  const end = (mark: string) => (text: string) => text.indexOf(mark) + mark.length
  return [
    tableCase('a row is added', 'tables.adoc', null, ['insertRow'], end('Личный кабинет клиента')),
    tableCase('a column is added', 'tables.adoc', null, ['insertColumn'], end('Приложение для курьеров')),
    tableCase('a row is deleted', 'tables.adoc', null, ['deleteRow'], end('Приложение для курьеров')),
    tableCase('cells are merged', 'table-merge.adoc', '= Т\n\n|===\n|a |b\n\n|c |d\n|\n|e\n|===\n', (t) => ['merge', `${t.indexOf('|c') + 2},${t.indexOf('|d\n|') + 4}`], (t) => t.indexOf('|c') + 2),
    tableCase(
      'cells are merged by dragging',
      'table-merge-drag.adoc',
      '= Т\n\n|===\n|a |b\n\n|c |d\n|\n|e\n|===\n',
      (t) => [['select', `${t.indexOf('|c') + 2},${t.indexOf('|d\n|') + 4}`], ['mergeCells']],
      (t) => t.indexOf('|c') + 2,
    ),
    tableCase(
      'cells are filled by dragging',
      'table-fill-drag.adoc',
      '= Т\n\n|===\n|a |b\n\n|c |d\n|===\n',
      (t) => [['select', `${t.indexOf('|c') + 2},${t.indexOf('|d') + 2}`], ['cellFill', 'cell-blue']],
      (t) => t.indexOf('|c') + 2,
    ),
    tableCase('a table is put in a cell', 'table-nest.adoc', '= Т\n\n|===\n|a |b\n|c |d\n|===\n', ['nestTable'], end('|c')),
    tableCase('the table is deleted', 'tables.adoc', null, ['deleteTable'], end('Личный кабинет клиента')),
    tableCase('a cell is filled', 'table-fill.adoc', '= Т\n\n|===\n|a |b\n\n|c |d\n|===\n', ['cellFill', 'cell-blue'], end('|c')),
    tableCase('Tab in the last cell adds a row', 'table-tab.adoc', '= Т\n\n|===\n|a |b\n|c |d\n|===\n', ['tab'], end('|d')),
    // the commands of the capsule of selected cells (each on a selection made by dragging, one Cmd+Z takes it back)
    tableCase(
      'cells are aligned by dragging',
      'table-cells-align.adoc',
      '= Т\n\n|===\n|a |b\n|c |d\n|===\n',
      (t) => [['select', `${t.indexOf('|a') + 2},${t.indexOf('|d') + 2}`], ['align', 'center,bottom']],
      (t) => t.indexOf('|a') + 2,
    ),
    tableCase(
      'cells are cleared by dragging',
      'table-cells-clear.adoc',
      '= Т\n\n|===\n|a |b\n|c |d\n|===\n',
      (t) => [['select', `${t.indexOf('|a') + 2},${t.indexOf('|d') + 2}`], ['clearCells']],
      (t) => t.indexOf('|a') + 2,
    ),
    tableCase(
      'rows are deleted by dragging',
      'table-cells-rows.adoc',
      '= Т\n\n|===\n|a |b\n|c |d\n|e |f\n|===\n',
      (t) => [['select', `${t.indexOf('|a') + 2},${t.indexOf('|d') + 2}`], ['deleteSelectedRows']],
      (t) => t.indexOf('|a') + 2,
    ),
    tableCase(
      'columns are deleted by dragging',
      'table-cells-cols.adoc',
      '= Т\n\n|===\n|a |b |c\n|d |e |f\n|===\n',
      (t) => [['select', `${t.indexOf('|a') + 2},${t.indexOf('|e') + 2}`], ['deleteSelectedColumns']],
      (t) => t.indexOf('|a') + 2,
    ),
    // the grips and the borders of a table
    tableCase('two columns are deleted by the grips', 'table-grips-col.adoc', '= Т\n\n|===\n|a |b |c\n|d |e |f\n|===\n', ['grips', 'col:0-1', 'deleteColumn'], end('|a')),
    tableCase('two rows are deleted by the grips', 'table-grips-row.adoc', '= Т\n\n|===\n|a |b\n|c |d\n|e |f\n|===\n', ['grips', 'row:0-1', 'deleteRow'], end('|a')),
    tableCase('a row is filled by the grips', 'table-grips-fill.adoc', '= Т\n\n|===\n|a |b\n|c |d\n|===\n', ['grips', 'row:1', 'cellFill:cell-blue'], end('|a')),
    // the three buttons at a grip
    tableCase('a column is added left of a grip', 'table-gripbar-left.adoc', '= Т\n\n|===\n|a |b |c\n|d |e |f\n|===\n', ['gripbar', 'col:1', 'left'], end('|a')),
    tableCase('a column is added right of a grip', 'table-gripbar-right.adoc', '= Т\n\n|===\n|a |b |c\n|d |e |f\n|===\n', ['gripbar', 'col:1', 'right'], end('|a')),
    tableCase('a column is deleted by its grip', 'table-gripbar-coldel.adoc', '= Т\n\n|===\n|a |b |c\n|d |e |f\n|===\n', ['gripbar', 'col:1', 'delete'], end('|a')),
    tableCase('a row is added above a grip', 'table-gripbar-above.adoc', '= Т\n\n|===\n|a |b\n|c |d\n|e |f\n|===\n', ['gripbar', 'row:1', 'above'], end('|a')),
    tableCase('a row is added below a grip', 'table-gripbar-below.adoc', '= Т\n\n|===\n|a |b\n|c |d\n|e |f\n|===\n', ['gripbar', 'row:1', 'below'], end('|a')),
    tableCase('a row is deleted by its grip', 'table-gripbar-rowdel.adoc', '= Т\n\n|===\n|a |b\n|c |d\n|e |f\n|===\n', ['gripbar', 'row:1', 'delete'], end('|a')),
    tableCase('a border is dragged and cols is written', 'table-border.adoc', '= Т\n\n[cols="3"]\n|===\n|a |b |c\n|d |e |f\n|===\n', ['border', '1,60'], end('|a')),
    tableCase('a double click on a border shares the width', 'table-border-even.adoc', '= Т\n\n[cols="3"]\n|===\n|a |b |c\n|d |e |f\n|===\n', ['border', '1,double'], end('|a')),
  ]
}

/**
 * A move, a caption, an anchor or a delete on `structure.adoc`: `command` runs in the page, the file changes in the
 * way `check` says, one Cmd+Z gives it back byte for byte, and (for a move) Cmd+Shift+Z does it again.
 */
function blockCase(
  title: string,
  run: (original: string) => [string, ...(string | number)[]] | [string, ...(string | number)[]][],
  check: (after: string, original: string) => void,
  redo = false,
): [string, () => Promise<void>] {
  return [
    `block: ${title}, one Cmd+Z takes it back byte for byte`,
    async () => {
      const doc = await openVisual('structure.adoc')
      const original = doc.getText()
      const commands = run(original)
      const list = (Array.isArray(commands[0]) ? commands : [commands]) as [string, ...(string | number)[]][]
      for (const [name, ...args] of list) await vscode.commands.executeCommand(name, ...args)
      await waitFor('the command changed the text', () => doc.getText() !== original)
      await sleep(500)
      const after = doc.getText()
      check(after, original)
      await vscode.commands.executeCommand('nota.e2e.undo')
      await waitFor('one Cmd+Z takes it back', () => doc.getText() === original)
      if (redo) {
        await vscode.commands.executeCommand('nota.e2e.redo')
        await waitFor('Cmd+Shift+Z does it again', () => doc.getText() === after)
      }
      await vscode.commands.executeCommand('workbench.action.files.revert')
    },
  ]
}

function structureCases(): [string, () => Promise<void>][] {
  const at = (text: string, mark: string): number => text.indexOf(mark)
  const titles = (text: string): string[] => lines(text).filter((l) => /^={2,} /.test(l))
  return [
    blockCase(
      'move: a section is dropped above another one in the tree, with its subsections',
      () => ['nota.e2e.move', 'tree', 3, 0, 'before'],
      (after, original) => {
        assert.deepEqual(titles(after).slice(0, 2), ['== Б. Таблицы и рамки', '=== Б1. Подраздел'])
        assert.equal(after.length, original.length)
        assert.deepEqual(lines(after).sort(), lines(original).sort())
      },
      true,
    ),
    blockCase(
      'move: Alt+Down swaps a section with the next one of its level',
      () => ['nota.e2e.move', 'swap', 0, 'down'],
      (after) => assert.deepEqual(titles(after).slice(0, 2), ['== Б. Таблицы и рамки', '=== Б1. Подраздел']),
      true,
    ),
    blockCase(
      'move: a block of code goes to another section by its handle',
      (t) => ['nota.e2e.move', 'block', at(t, '----\necho'), at(t, 'Абзац подраздела А2.')],
      (after) => assert.ok(after.indexOf('echo "код А1"') > after.indexOf('=== А2.')),
      true,
    ),
    blockCase(
      'block: a caption is one new line over the paragraph',
      (t) => ['nota.e2e.block', 'caption', at(t, 'Первый абзац раздела'), 'Итоги'],
      (after, original) => {
        assert.ok(after.includes('.Итоги\nПервый абзац раздела'))
        assert.equal(lines(after).length, lines(original).length + 1)
      },
    ),
    blockCase(
      'block: an anchor is one new line, and the reference is whole',
      (t) => ['nota.e2e.block', 'anchor', at(t, 'Первый абзац раздела'), 'limity'],
      (after) => assert.ok(after.includes('[[limity]]\nПервый абзац раздела')),
    ),
    blockCase(
      'block: the table goes with its caption',
      (t) => ['nota.e2e.block', 'delete', at(t, '.Размеры')],
      (after) => assert.ok(!after.includes('Размеры') && !after.includes('|===')),
    ),
    blockCase(
      'block: a section goes with its subsections',
      (t) => ['nota.e2e.block', 'delete', at(t, '[[a]]')],
      (after) => assert.deepEqual(titles(after), ['== Б. Таблицы и рамки', '=== Б1. Подраздел', '== В. Остальное', '== Г. Сразу подраздел', '=== Г1. Единственный подраздел']),
    ),
  ]
}

const only = process.env.NOTA_E2E_ONLY

const cases: [string, () => Promise<void>][] = [
  [
    'opens .adoc in the visual editor and types, saves, one line changes',
    async () => {
      const doc = await openVisual('visual.adoc')
      const before = readFileSync(doc.uri.fsPath, 'utf8')
      await type('проверка ёж')
      await waitFor('the dot «не сохранено» within 1 s', () => doc.isDirty, 1500)
      assert.ok(doc.getText().includes('проверка ёж'))
      await vscode.commands.executeCommand('workbench.action.files.save')
      await waitFor('saved', () => !doc.isDirty)
      const after = readFileSync(doc.uri.fsPath, 'utf8')
      assert.ok(after.includes('проверка ёж'))
      assert.equal(changedLines(before, after), 1)
    },
  ],
  [
    'saves the last letters typed just before Cmd+S',
    async () => {
      const doc = await openVisual('visual.adoc')
      await type('Конец')
      await vscode.commands.executeCommand('workbench.action.files.save')
      assert.ok(readFileSync(doc.uri.fsPath, 'utf8').includes('Конец'), 'the file has all the letters')
      assert.equal(doc.isDirty, false)
    },
  ],
  [
    'undo and redo are the undo of the document; undoing everything gives the file back',
    async () => {
      const doc = await openVisual('colors.adoc')
      const original = readFileSync(doc.uri.fsPath, 'utf8')
      await type('проверка')
      await waitFor('typed', () => doc.getText().includes('проверка'))
      await sleep(500)
      await vscode.commands.executeCommand('nota.e2e.undo')
      await waitFor('the word is gone at once', () => !doc.getText().includes('проверка'))
      assert.equal(doc.getText(), original, 'no letter is left')
      await waitFor('clean again', () => !doc.isDirty)
      await vscode.commands.executeCommand('nota.e2e.redo')
      await waitFor('the word is back', () => doc.getText().includes('проверка'))
      await vscode.commands.executeCommand('nota.e2e.undo')
      await waitFor('undone', () => doc.getText() === original)
      assert.equal(doc.isDirty, false)
    },
  ],
  [
    'sees an edit of a text editor beside it, and they keep one history',
    async () => {
      const doc = await openVisual('visual.adoc')
      const text = await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside, preview: false })
      await text.edit((e) => e.insert(new vscode.Position(0, 0), 'ТЕКСТ '))
      // back to the visual editor (first group): its page works on the new text, its edit is not refused as stale
      await vscode.commands.executeCommand('workbench.action.focusFirstEditorGroup')
      await waitFor('the visual editor is the active one', () => vscode.window.tabGroups.activeTabGroup.activeTab?.input instanceof vscode.TabInputCustom)
      await sleep(300)
      await type('ВИЗУАЛЬНО ')
      await waitFor('both edits in the document', () => doc.getText().includes('ВИЗУАЛЬНО') && doc.getText().includes('ТЕКСТ '))
      // Cmd+Z in the text editor undoes the edit made in the visual one: one history
      await vscode.commands.executeCommand('workbench.action.focusLastEditorGroup')
      await sleep(300)
      await vscode.commands.executeCommand('undo')
      await waitFor('the visual edit is undone from the text editor', () => !doc.getText().includes('ВИЗУАЛЬНО') && doc.getText().includes('ТЕКСТ '))
      await vscode.commands.executeCommand('workbench.action.files.revert')
      await waitFor('reverted', () => !doc.isDirty)
    },
  ],
  [
    'shows a change on disk (a file without unsaved edits)',
    async () => {
      const doc = await openVisual('crlf.adoc')
      const original = readFileSync(doc.uri.fsPath, 'utf8')
      const changed = original.replace(/^(.*?)(\r?\n)/, 'ИЗМЕНЕНО НА ДИСКЕ$2')
      writeFileSync(doc.uri.fsPath, changed)
      await waitFor('VS Code reloads the file', () => doc.getText().startsWith('ИЗМЕНЕНО НА ДИСКЕ'), 15000)
      await type('после ')
      await waitFor('the edit goes to the new text', () => doc.getText().includes('после '))
      assert.ok(doc.getText().includes('ИЗМЕНЕНО НА ДИСКЕ') || doc.getText().includes('после '))
      await vscode.commands.executeCommand('workbench.action.files.save')
      const after = readFileSync(doc.uri.fsPath, 'utf8')
      // the line endings are the ones of the file
      assert.ok(!/(^|[^\r])\n/.test(after), 'CRLF stays CRLF')
    },
  ],
  [
    'keeps the BOM and the line endings of the other lines',
    async () => {
      const doc = await openVisual('bom.adoc')
      const before = readFileSync(doc.uri.fsPath)
      assert.deepEqual([...before.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'the fixture has a BOM')
      await type('x')
      await vscode.commands.executeCommand('workbench.action.files.save')
      await waitFor('saved', () => !doc.isDirty)
      const after = readFileSync(doc.uri.fsPath)
      assert.deepEqual([...after.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'the BOM stays')
      assert.equal(changedLines(before.toString('utf8'), after.toString('utf8')), 1)
    },
  ],
  [
    'switches to «Текст» and back without a dot «не сохранено»; the file is not changed',
    async () => {
      const doc = await openVisual('visual.adoc')
      const original = doc.getText()
      await vscode.commands.executeCommand('nota.toggleMode')
      await waitMode('text')
      await sleep(300)
      assert.equal(doc.isDirty, false)
      await vscode.commands.executeCommand('nota.toggleMode')
      await waitMode('visual')
      await sleep(300)
      assert.equal(doc.isDirty, false)
      assert.equal(doc.getText(), original)
    },
  ],
  [
    '«Nota: Настройки» opens the Settings of VS Code; the tab of Nota stays alive, with its dot «не сохранено»',
    async () => {
      const doc = await openVisual('visual.adoc')
      await type('!')
      await waitFor('the dot «не сохранено»', () => doc.isDirty, 1500)
      const notaTabs = (): vscode.Tab[] =>
        vscode.window.tabGroups.all.flatMap((g) => g.tabs).filter((t) => t.input instanceof vscode.TabInputCustom && t.input.viewType === 'nota.visual')
      assert.equal(notaTabs().length, 1)
      // (the button of the tab sends the same message and the host runs the same command: `provider.test.ts`)
      await vscode.commands.executeCommand('nota.openSettings')
      await waitFor('the Settings are the active tab', () => {
        const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input
        return !(input instanceof vscode.TabInputCustom && input.viewType === 'nota.visual')
      })
      assert.equal(notaTabs().length, 1, 'the tab of Nota is not closed or opened again')
      assert.equal(doc.isDirty, true)
      assert.ok(doc.getText().includes('!'))
    },
  ],
  [
    'the cursor stays in the same word through the switch, both ways',
    async () => {
      const doc = await openVisual('visual.adoc')
      const text = doc.getText()
      const word = text.indexOf('видит') + 2
      await place(doc, word)
      await vscode.commands.executeCommand('nota.toggleMode')
      const inText = await waitMode('text')
      assert.equal(inText.anchor, word)
      await type('Ы')
      await waitFor('the letter is inside the word', () => doc.getText().slice(word, word + 1) === 'Ы')
      await vscode.commands.executeCommand('nota.toggleMode')
      const back = await waitMode('visual')
      assert.equal(back.anchor, word + 1)
    },
  ],
  [
    'undo goes through the modes in one history: typed in «Текст», seen in «Визуально», Cmd+Z, Cmd+Shift+Z',
    async () => {
      const doc = await openVisual('visual.adoc')
      const original = doc.getText()
      await vscode.commands.executeCommand('nota.toggleMode')
      await waitMode('text')
      await type('проверка')
      await vscode.commands.executeCommand('nota.toggleMode')
      await waitMode('visual')
      assert.ok(doc.getText().includes('проверка'))
      await sleep(500)
      await vscode.commands.executeCommand('nota.e2e.undo')
      await waitFor('the word is gone at once', () => doc.getText() === original)
      await vscode.commands.executeCommand('nota.e2e.redo')
      await waitFor('the word is back', () => doc.getText().includes('проверка'))
      // and the other way: typed in «Визуально», undone in «Текст»
      await vscode.commands.executeCommand('nota.e2e.undo')
      await waitFor('undone', () => doc.getText() === original)
      await type('второе')
      await sleep(500)
      await vscode.commands.executeCommand('nota.toggleMode')
      await waitMode('text')
      await vscode.commands.executeCommand('nota.e2e.undo')
      await waitFor('undone from «Текст»', () => doc.getText() === original)
      assert.equal(doc.isDirty, false)
    },
  ],
  [
    'Save All with two tabs of two files saves every letter and says nothing of another editor',
    async () => {
      const a = await openVisual('visual.adoc')
      await type('первый')
      const b = await openVisual('colors.adoc')
      await type('второй')
      // the dot «не сохранено» comes after the pause of typing (Save All saves the documents that are dirty); then more letters, with no pause
      await waitFor('both are dirty', () => a.isDirty && b.isDirty, 2000)
      await type(' ещё')
      await vscode.commands.executeCommand('workbench.action.files.saveAll')
      await waitFor('both saved', () => !a.isDirty && !b.isDirty)
      assert.ok(readFileSync(b.uri.fsPath, 'utf8').includes('второй ещё'), 'the letters typed just before Save All are in the file')
      assert.ok(readFileSync(a.uri.fsPath, 'utf8').includes('первый'), 'the first file has its letters')
      assert.ok(readFileSync(b.uri.fsPath, 'utf8').includes('второй'), 'the second file has its letters')
      // the letters are in the documents too: nothing was shown again from the file
      assert.ok(a.getText().includes('первый') && b.getText().includes('второй'))
    },
  ],
  [
    'the panel «Проблемы»: a line in the language of VS Code, a click puts the cursor on the link, a fix and a close take it away',
    async () => {
      const doc = await openVisual('diagnostics.adoc')
      // the strings follow the setting nota.language; the profile of the run sets it to `ru` (run.ts), the older checks read Russian
      const setting = vscode.workspace.getConfiguration('nota').get<string>('language', 'auto')
      const ru = setting === 'ru' || (setting !== 'en' && vscode.env.language.toLowerCase().startsWith('ru'))
      const start = ru ? 'Ссылка ведёт на «нет-такого»' : 'The link goes to "нет-такого"'
      await waitFor('the remarks of Nota', () => problemsOf(doc).length > 0, 5000)
      // a link to nowhere: add one
      const at = doc.getText().indexOf('Каждый раздел')
      const edit = new vscode.WorkspaceEdit()
      edit.insert(doc.uri, doc.positionAt(at), 'Ссылка <<нет-такого>>. ')
      await vscode.workspace.applyEdit(edit)
      await waitFor('the line for the link within 1 s', () => problemsOf(doc).some((d) => d.message.startsWith(start)), 1500)
      const problem = problemsOf(doc).find((d) => d.message.startsWith(start))!
      assert.equal(
        problem.message,
        ru
          ? 'Ссылка ведёт на «нет-такого», а такого раздела или якоря в документе нет'
          : 'The link goes to "нет-такого", but there is no such section or anchor in the document',
      )
      assert.equal(problem.severity, vscode.DiagnosticSeverity.Warning)
      assert.equal(doc.offsetAt(problem.range.start), doc.getText().indexOf('<<нет-такого>>'))
      // move the cursor away from the link, then click on the code of the line
      await vscode.commands.executeCommand('workbench.action.closeAllEditors')
      await openVisual('diagnostics.adoc')
      await place(doc, doc.getText().indexOf('Каждый раздел') + 3)
      assert.notEqual((await state())?.anchor, doc.offsetAt(problem.range.start))
      // another editor is active: the tab of Nota is open, but hidden
      const otherPath = join(work, 'other-editor.txt')
      writeFileSync(otherPath, 'another editor\n')
      await vscode.window.showTextDocument(vscode.Uri.file(otherPath), { preview: false })
      await waitFor('the other editor is active', () => {
        const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input
        return input instanceof vscode.TabInputText && input.uri.fsPath === otherPath
      })
      const target = (problem.code as { value: string; target: vscode.Uri }).target
      await click(target)
      await waitFor('the tab of Nota of the file is active after the click', () => {
        const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input
        return input instanceof vscode.TabInputCustom && input.viewType === 'nota.visual' && input.uri.fsPath === doc.uri.fsPath
      }, 3000)
      await waitFor('the cursor is on the link after the click', async () => (await state())?.anchor === doc.offsetAt(problem.range.start), 3000)
      // the fix
      const fix = new vscode.WorkspaceEdit()
      fix.delete(doc.uri, new vscode.Range(doc.positionAt(at), doc.positionAt(at + 'Ссылка <<нет-такого>>. '.length)))
      await vscode.workspace.applyEdit(fix)
      await waitFor('the line goes within 1 s', () => !problemsOf(doc).some((d) => d.message.startsWith(start)), 1500)
      await vscode.commands.executeCommand('workbench.action.closeAllEditors')
      await waitFor('the lines go with the last tab', () => problemsOf(doc).length === 0, 3000)
      await vscode.commands.executeCommand('workbench.action.files.revert')
    },
  ],
  [
    'nota.language is auto by default: the remarks of «Problems» are English when VS Code is English',
    async () => {
      const config = vscode.workspace.getConfiguration('nota')
      assert.equal(config.inspect<string>('language')?.defaultValue, 'auto')
      // the setting of the profile (`ru`) is taken away: what is left is the default
      await config.update('language', undefined, vscode.ConfigurationTarget.Global)
      try {
        const doc = await openVisual('diagnostics.adoc')
        const ru = vscode.env.language.toLowerCase().startsWith('ru')
        const at = doc.getText().indexOf('Каждый раздел')
        const edit = new vscode.WorkspaceEdit()
        edit.insert(doc.uri, doc.positionAt(at), 'Ссылка <<нет-такого>>. ')
        await vscode.workspace.applyEdit(edit)
        const start = ru ? 'Ссылка ведёт на «нет-такого»' : 'The link goes to "нет-такого"'
        await waitFor('the line for the link in the language of VS Code', () => problemsOf(doc).some((d) => d.message.startsWith(start)), 3000)
        await vscode.commands.executeCommand('workbench.action.closeAllEditors')
        await vscode.commands.executeCommand('workbench.action.files.revert')
      } finally {
        await config.update('language', 'ru', vscode.ConfigurationTarget.Global)
      }
    },
  ],
  [
    'a colour by a command is written in the file, one Cmd+Z takes it back, the file is as it was',
    async () => {
      const doc = await openVisual('visual.adoc')
      const original = doc.getText()
      const at = original.indexOf('высокий')
      await vscode.commands.executeCommand('nota.e2e.select', at, at + 'высокий'.length)
      await waitFor('the selection is there', async () => (await state())?.anchor === at && (await state())?.head === at + 'высокий'.length)
      await vscode.commands.executeCommand('nota.e2e.textcolor', 'hl-red')
      await waitFor('the role is in the file text', () => doc.getText().includes('hl-red'))
      assert.ok(doc.getText().includes('[.hl-red]#высокий#'), 'the word has the role')
      await vscode.commands.executeCommand('workbench.action.files.save')
      await waitFor('saved', () => !doc.isDirty)
      assert.ok(readFileSync(doc.uri.fsPath, 'utf8').includes('hl-red'))
      await vscode.commands.executeCommand('nota.e2e.fill', 'hl-yellow-bg')
      await waitFor('the fill is in the text', () => doc.getText().includes('hl-yellow-bg'))
      await sleep(500)
      await vscode.commands.executeCommand('nota.e2e.undo')
      await waitFor('one Cmd+Z takes the fill back', () => !doc.getText().includes('hl-yellow-bg') && doc.getText().includes('hl-red'))
      await vscode.commands.executeCommand('nota.e2e.undo')
      await waitFor('one more takes the colour back', () => doc.getText() === original)
      await vscode.commands.executeCommand('workbench.action.files.revert')
    },
  ],
  [
    'the command nota.style.heading2 makes the heading once (no second step), again takes it back, one Cmd+Z takes each step back byte for byte',
    async () => {
      // a file of its own: visual.adoc is changed on the disk by the tests before
      writeFileSync(join(work, 'heading-keys.adoc'), '= Т\r\n\r\nПервый.\r\n\r\n[[срок]]\r\n.Подпись\r\nСрок действия\r\n\r\nКонец.\r\n')
      const doc = await openVisual('heading-keys.adoc')
      const original = doc.getText()
      const line = 'Срок действия'
      const at = original.indexOf(line)
      const end = at + 'Срок'.length
      await vscode.commands.executeCommand('nota.e2e.select', at, end)
      await waitFor('the selection is there', async () => (await state())?.anchor === at && (await state())?.head === end)
      await vscode.commands.executeCommand('nota.style.heading2')
      await waitFor('the heading is in the file', () => doc.getText().includes(`\r\n== ${line}\r\n`))
      // a second step would come late (the key in the page and the command of VS Code): the heading must stay
      await sleep(800)
      assert.ok(doc.getText().includes(`\r\n== ${line}\r\n`), 'still a heading')
      await vscode.commands.executeCommand('nota.e2e.undo')
      await waitFor('one Cmd+Z takes it back', () => doc.getText() === original)
      await vscode.commands.executeCommand('nota.e2e.redo')
      await waitFor('and Cmd+Shift+Z puts it again', () => doc.getText().includes(`\r\n== ${line}\r\n`))
      await sleep(500)
      await vscode.commands.executeCommand('nota.style.heading2')
      await waitFor('the same command again: a paragraph', () => doc.getText() === original)
      await vscode.commands.executeCommand('workbench.action.files.revert')
    },
  ],
  [
    'lists: «Маркированный список», Tab, Shift+Tab and the checkbox are written in the file by a command',
    async () => {
      const doc = await openVisual('lists.adoc')
      const original = doc.getText()
      const intro = original.indexOf('Короткое вступление')
      await vscode.commands.executeCommand('nota.e2e.select', intro + 3, intro + 3)
      await waitFor('the cursor is in the paragraph', async () => (await state())?.anchor === intro + 3)
      await vscode.commands.executeCommand('nota.e2e.list', 'unordered')
      await waitFor('the paragraph is an item', () => doc.getText().includes('\n* Короткое вступление'))
      assert.equal(doc.getText().length, original.length + 2, 'only the marker is added')
      await vscode.commands.executeCommand('workbench.action.files.revert')
      await waitFor('the file is as it was', () => doc.getText() === original)
      // Tab and Shift+Tab on the second item of the first list
      const milk = original.indexOf('Молоко')
      await vscode.commands.executeCommand('nota.e2e.select', milk + 2, milk + 2)
      await waitFor('the cursor is in the item', async () => (await state())?.anchor === milk + 2)
      await vscode.commands.executeCommand('nota.e2e.indent', false)
      await waitFor('the item is one level in', () => doc.getText().includes('\n** Молоко'))
      await sleep(500)
      await vscode.commands.executeCommand('nota.e2e.indent', true)
      await waitFor('and back out', () => doc.getText() === original)
      // the checkbox: one character
      const passport = original.indexOf('Паспорт')
      await vscode.commands.executeCommand('nota.e2e.select', passport + 1, passport + 1)
      await waitFor('the cursor is in the checklist', async () => (await state())?.anchor === passport + 1)
      await vscode.commands.executeCommand('nota.e2e.check')
      await waitFor('the box is checked', () => doc.getText().includes('* [x] Паспорт'))
      assert.equal(doc.getText().length, original.length, 'one character changed')
      await vscode.commands.executeCommand('workbench.action.files.revert')
    },
  ],
  [
    'lists: one Cmd+Z takes back the list, each step of Tab and Shift+Tab, and the checkbox',
    async () => {
      const doc = await openVisual('lists.adoc')
      const original = doc.getText()
      const intro = original.indexOf('Короткое вступление')
      await vscode.commands.executeCommand('nota.e2e.select', intro + 3, intro + 3)
      await waitFor('the cursor is in the paragraph', async () => (await state())?.anchor === intro + 3)
      await vscode.commands.executeCommand('nota.e2e.list', 'unordered')
      await waitFor('the paragraph is an item', () => doc.getText().includes('\n* Короткое вступление'))
      await sleep(500)
      await vscode.commands.executeCommand('nota.e2e.undo')
      await waitFor('one Cmd+Z takes the list back', () => doc.getText() === original)
      const milk = original.indexOf('Молоко')
      await vscode.commands.executeCommand('nota.e2e.select', milk + 2, milk + 2)
      await waitFor('the cursor is in the item', async () => (await state())?.anchor === milk + 2)
      await vscode.commands.executeCommand('nota.e2e.indent', false)
      await waitFor('the item is one level in', () => doc.getText().includes('\n** Молоко'))
      await sleep(500)
      await vscode.commands.executeCommand('nota.e2e.indent', true)
      await waitFor('and back out', () => doc.getText() === original)
      await sleep(500)
      await vscode.commands.executeCommand('nota.e2e.undo')
      await waitFor('one Cmd+Z undoes the step out', () => doc.getText().includes('\n** Молоко'))
      await vscode.commands.executeCommand('nota.e2e.undo')
      await waitFor('one more undoes the step in', () => doc.getText() === original)
      const passport = original.indexOf('Паспорт')
      await vscode.commands.executeCommand('nota.e2e.select', passport + 1, passport + 1)
      await waitFor('the cursor is in the checklist', async () => (await state())?.anchor === passport + 1)
      await vscode.commands.executeCommand('nota.e2e.check')
      await waitFor('the box is checked', () => doc.getText().includes('* [x] Паспорт'))
      await sleep(500)
      await vscode.commands.executeCommand('nota.e2e.undo')
      await waitFor('one Cmd+Z unchecks it', () => doc.getText() === original)
      await vscode.commands.executeCommand('workbench.action.files.revert')
    },
  ],
  [
    'an admonition: the type is changed by a command in both forms, only the word changes',
    async () => {
      const doc = await openVisual('blocks.adoc')
      const original = doc.getText()
      const note = original.indexOf('Простое примечание')
      await vscode.commands.executeCommand('nota.e2e.select', note + 3, note + 3)
      await waitFor('the cursor is in the note', async () => (await state())?.anchor === note + 3)
      await vscode.commands.executeCommand('nota.e2e.admonition', 'WARNING')
      await waitFor('NOTE: is WARNING:', () => doc.getText().startsWith('= Предупреждения и раскрывающиеся блоки\n\nWARNING: Простое'))
      assert.equal(doc.getText().length, original.length + 'WARNING'.length - 'NOTE'.length)
      await vscode.commands.executeCommand('workbench.action.files.revert')
      await waitFor('the file is as it was', () => doc.getText() === original)
      // the block form
      const inBlock = original.indexOf('Блок-примечание')
      await vscode.commands.executeCommand('nota.e2e.select', inBlock + 2, inBlock + 2)
      await waitFor('the cursor is in the block', async () => (await state())?.anchor === inBlock + 2)
      await vscode.commands.executeCommand('nota.e2e.admonition', 'CAUTION')
      await waitFor('[NOTE] is [CAUTION]', () => doc.getText().includes('[CAUTION]\n====\nБлок-примечание'))
      await vscode.commands.executeCommand('workbench.action.files.revert')
    },
  ],
  [
    'an admonition: one Cmd+Z takes the type back, in both forms',
    async () => {
      const doc = await openVisual('blocks.adoc')
      const original = doc.getText()
      const note = original.indexOf('Простое примечание')
      await vscode.commands.executeCommand('nota.e2e.select', note + 3, note + 3)
      await waitFor('the cursor is in the note', async () => (await state())?.anchor === note + 3)
      await vscode.commands.executeCommand('nota.e2e.admonition', 'WARNING')
      await waitFor('NOTE: is WARNING:', () => doc.getText().includes('WARNING: Простое'))
      await sleep(500)
      await vscode.commands.executeCommand('nota.e2e.undo')
      await waitFor('one Cmd+Z takes the type back', () => doc.getText() === original)
      const inBlock = original.indexOf('Блок-примечание')
      await vscode.commands.executeCommand('nota.e2e.select', inBlock + 2, inBlock + 2)
      await waitFor('the cursor is in the block', async () => (await state())?.anchor === inBlock + 2)
      await vscode.commands.executeCommand('nota.e2e.admonition', 'CAUTION')
      await waitFor('[NOTE] is [CAUTION]', () => doc.getText().includes('[CAUTION]\n====\nБлок-примечание'))
      await sleep(500)
      await vscode.commands.executeCommand('nota.e2e.undo')
      await waitFor('one Cmd+Z takes it back', () => doc.getText() === original)
    },
  ],
  [
    'a closed collapsible block opens by a command, and the file and the mark «не сохранено» do not change',
    async () => {
      const doc = await openVisual('blocks.adoc')
      const original = doc.getText()
      const closed = original.indexOf('[%collapsible]\n====\nАбзац внутри закрытого')
      await vscode.commands.executeCommand('nota.e2e.collapse', closed)
      const inside = original.indexOf('Абзац внутри закрытого')
      await waitFor('the cursor went into the block', async () => {
        const s = await state()
        return s !== undefined && s.anchor >= inside && s.anchor <= inside + 'Абзац внутри закрытого блока.'.length
      })
      await sleep(400)
      assert.equal(doc.getText(), original)
      assert.equal(doc.isDirty, false)
    },
  ],
  [
    'code: typing, Tab and Shift+Tab are written in the block as typed',
    async () => {
      const doc = await openVisual('code.adoc')
      const original = doc.getText()
      const at = original.indexOf('let x = 1') + 'let x'.length
      await vscode.commands.executeCommand('nota.e2e.select', at, at)
      await waitFor('the cursor is in the code', async () => (await state())?.anchor === at)
      await type(' =')
      await waitFor('the text is in the code as typed', () => doc.getText().includes('let x = = 1'))
      await vscode.commands.executeCommand('workbench.action.files.revert')
      await waitFor('the file is as it was', () => doc.getText() === original)
      const line = original.indexOf('let x = 1')
      await vscode.commands.executeCommand('nota.e2e.select', line, line)
      await waitFor('the cursor is at the start of the line', async () => (await state())?.anchor === line)
      await vscode.commands.executeCommand('nota.e2e.codetab', false)
      await waitFor('Tab puts two blanks', () => doc.getText().includes('\n  let x = 1'))
      await sleep(500)
      await vscode.commands.executeCommand('nota.e2e.codetab', true)
      await waitFor('Shift+Tab takes them away', () => doc.getText() === original)
    },
  ],
  [
    'code: one Cmd+Z takes back the typing and each step of Tab and Shift+Tab',
    async () => {
      const doc = await openVisual('code.adoc')
      const original = doc.getText()
      const at = original.indexOf('let x = 1') + 'let x'.length
      await vscode.commands.executeCommand('nota.e2e.select', at, at)
      await waitFor('the cursor is in the code', async () => (await state())?.anchor === at)
      await type(' =')
      await waitFor('the text is in the code as typed', () => doc.getText().includes('let x = = 1'))
      await sleep(500)
      await vscode.commands.executeCommand('nota.e2e.undo')
      await waitFor('one Cmd+Z takes the typing back', () => doc.getText() === original)
      const line = original.indexOf('let x = 1')
      await vscode.commands.executeCommand('nota.e2e.select', line, line)
      await waitFor('the cursor is at the start of the line', async () => (await state())?.anchor === line)
      await vscode.commands.executeCommand('nota.e2e.codetab', false)
      await waitFor('Tab puts two blanks', () => doc.getText().includes('\n  let x = 1'))
      await sleep(500)
      await vscode.commands.executeCommand('nota.e2e.codetab', true)
      await waitFor('Shift+Tab takes them away', () => doc.getText() === original)
      await sleep(500)
      await vscode.commands.executeCommand('nota.e2e.undo')
      await waitFor('one Cmd+Z undoes the step out', () => doc.getText().includes('\n  let x = 1'))
      await vscode.commands.executeCommand('nota.e2e.undo')
      await waitFor('one more undoes the step in', () => doc.getText() === original)
    },
  ],
  [
    'code: the language is written as [source,lang] by a command',
    async () => {
      const doc = await openVisual('code.adoc')
      const original = doc.getText()
      const at = original.indexOf('let x = 1') + 2
      await vscode.commands.executeCommand('nota.e2e.select', at, at)
      await waitFor('the cursor is in the code', async () => (await state())?.anchor === at)
      await vscode.commands.executeCommand('nota.e2e.codelang', 'python')
      await waitFor('the language is in the file', () => doc.getText().includes('[source,python]\n----\nlet x = 1'))
      assert.equal(doc.getText().length, original.length - 'js'.length + 'python'.length)
      await vscode.commands.executeCommand('workbench.action.files.revert')
    },
  ],
  [
    'code: one Cmd+Z takes the language back',
    async () => {
      const doc = await openVisual('code.adoc')
      const original = doc.getText()
      const at = original.indexOf('let x = 1') + 2
      await vscode.commands.executeCommand('nota.e2e.select', at, at)
      await waitFor('the cursor is in the code', async () => (await state())?.anchor === at)
      await vscode.commands.executeCommand('nota.e2e.codelang', 'python')
      await waitFor('the language is in the file', () => doc.getText().includes('[source,python]'))
      await sleep(500)
      await vscode.commands.executeCommand('nota.e2e.undo')
      await waitFor('one Cmd+Z takes the language back', () => doc.getText() === original)
    },
  ],
  [
    'image: the caption is edited as text, and a picture is put in by its path',
    async () => {
      const doc = await openVisual('images.adoc')
      const original = doc.getText()
      const at = original.indexOf('.Пиксель') + '.Пиксель'.length
      await vscode.commands.executeCommand('nota.e2e.select', at, at)
      await waitFor('the cursor is in the caption', async () => (await state())?.anchor === at)
      await type('ы')
      await waitFor('the caption has the letter', () => doc.getText().includes('.Пиксельы\nimage::img/pixel.png[]'))
      assert.equal(doc.getText().length, original.length + 1)
      await vscode.commands.executeCommand('workbench.action.files.revert')
      await waitFor('the file is as it was', () => doc.getText() === original)
      const para = original.indexOf('Картинка без подписи') + 3
      await vscode.commands.executeCommand('nota.e2e.select', para, para)
      await waitFor('the cursor is in the paragraph', async () => (await state())?.anchor === para)
      await vscode.commands.executeCommand('nota.e2e.insert', 'image', 'img/pixel.png')
      await waitFor('the picture is after the paragraph', () => doc.getText().includes('Картинка без подписи стоит выше этого абзаца.\n\nimage::img/pixel.png[]\n'))
      await vscode.commands.executeCommand('workbench.action.files.revert')
    },
  ],
  [
    'image: one Cmd+Z takes the picture that was put in back',
    async () => {
      const doc = await openVisual('images.adoc')
      const original = doc.getText()
      const para = original.indexOf('Картинка без подписи') + 3
      await vscode.commands.executeCommand('nota.e2e.select', para, para)
      await waitFor('the cursor is in the paragraph', async () => (await state())?.anchor === para)
      await vscode.commands.executeCommand('nota.e2e.insert', 'image', 'img/pixel.png')
      await waitFor('the picture is after the paragraph', () => doc.getText().includes('image::img/pixel.png[]\n\nКартинка') || doc.getText().includes('абзаца.\n\nimage::img/pixel.png[]'))
      await sleep(500)
      await vscode.commands.executeCommand('nota.e2e.undo')
      await waitFor('one Cmd+Z takes the picture back', () => doc.getText() === original)
    },
  ],
  [
    'table: the text of a cell is edited in place and is written in the file',
    async () => {
      const doc = await openVisual('islands.adoc')
      const original = doc.getText()
      const at = original.indexOf('|Первая строка') + '|Первая строка'.length
      await vscode.commands.executeCommand('nota.e2e.select', at, at)
      await waitFor('the cursor is in the cell', async () => (await state())?.anchor === at)
      await type('!')
      await waitFor('the text is in the table', () => doc.getText().includes('|Первая строка!\n'))
      assert.equal(doc.getText().length, original.length + 1)
      await vscode.commands.executeCommand('workbench.action.files.revert')
    },
  ],
  [
    'table: one Cmd+Z takes the edit of a cell back',
    async () => {
      const doc = await openVisual('islands.adoc')
      const original = doc.getText()
      const at = original.indexOf('|Первая строка') + '|Первая строка'.length
      await vscode.commands.executeCommand('nota.e2e.select', at, at)
      await waitFor('the cursor is in the cell', async () => (await state())?.anchor === at)
      await type('!')
      await waitFor('the text is in the table', () => doc.getText().includes('|Первая строка!\n'))
      await sleep(500)
      await vscode.commands.executeCommand('nota.e2e.undo')
      await waitFor('one Cmd+Z takes it back', () => doc.getText() === original)
    },
  ],
  ...tableCases(),
  ...structureCases(),
  [
    '«/» in an empty paragraph: the block of code takes its place, and Esc leaves «/» as text',
    async () => {
      writeFileSync(join(work, 'slash.adoc'), '= Вставка\n\nПервый.\n\n\n\nПоследний.\n')
      const doc = await openVisual('slash.adoc')
      const original = doc.getText()
      const empty = original.indexOf('\n\n\n\n') + 2
      await vscode.commands.executeCommand('nota.e2e.select', empty, empty)
      await waitFor('the cursor is in the empty paragraph', async () => (await state())?.anchor === empty)
      await type('/')
      await waitFor('«/» is in the file', () => doc.getText().includes('Первый.\n\n/\n'))
      await vscode.commands.executeCommand('nota.e2e.dismissslash')
      await type('x')
      await waitFor('after Esc «/» is text', () => doc.getText().includes('Первый.\n\n/x\n'))
      await vscode.commands.executeCommand('workbench.action.files.revert')
      await waitFor('the file is as it was', () => doc.getText() === original)
      // (another file: the paragraph that «/» was dismissed in is not the one for this)
      await vscode.commands.executeCommand('workbench.action.closeAllEditors')
      writeFileSync(join(work, 'slash2.adoc'), original)
      const second = await openVisual('slash2.adoc')
      await vscode.commands.executeCommand('nota.e2e.select', empty, empty)
      await waitFor('the cursor is in the empty paragraph', async () => (await state())?.anchor === empty)
      await type('/')
      await waitFor('«/» is in the file', () => second.getText().includes('Первый.\n\n/\n'))
      await vscode.commands.executeCommand('nota.e2e.insert', 'code')
      await waitFor('the code block replaced «/»', () => second.getText().includes('[source,text]\n----\n----') && !second.getText().includes('/'))
      await vscode.commands.executeCommand('workbench.action.files.revert')
    },
  ],
  [
    'a link to another file is written as xref: and Cmd+click opens that file in a tab',
    async () => {
      const doc = await openVisual('visual.adoc')
      const original = doc.getText()
      const at = original.indexOf('клиенты пишут')
      await vscode.commands.executeCommand('nota.e2e.select', at, at + 'клиенты'.length)
      await waitFor('the selection is there', async () => (await state())?.anchor === at)
      await vscode.commands.executeCommand('nota.e2e.link', 'colors.adoc')
      await waitFor('the link is in the text', () => doc.getText().includes('xref:colors.adoc[клиенты]'))
      await vscode.commands.executeCommand('nota.e2e.openlink', 'colors.adoc')
      await waitFor('the other file is open in the visual editor', () => {
        const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input
        return input instanceof vscode.TabInputCustom && input.viewType === 'nota.visual' && input.uri.fsPath.endsWith('colors.adoc')
      }, 10000)
      await vscode.commands.executeCommand('workbench.action.closeAllEditors')
      const again = await openVisual('visual.adoc')
      await vscode.commands.executeCommand('workbench.action.files.revert')
      assert.equal(again.getText().includes('xref:colors.adoc'), false)
    },
  ],
  [
    'the host opens the target of a link, as the page sends it, in a folder with spaces, and the file stays as it was (the click in a cell is in the page tests)',
    async () => {
      const dir = join(work, 'Мои документы', 'Раздел А')
      mkdirSync(join(dir, 'Папка с пробелом'), { recursive: true })
      writeFileSync(join(dir, 'Папка с пробелом', 'Файл с пробелом.adoc'), '= Цель\n\nТекст.\n')
      const source = '= Из\n\n|===\n|Ссылка\n\n|xref:Папка%20с%20пробелом/Файл%20с%20пробелом.adoc[Б]\n|===\n'
      writeFileSync(join(dir, 'x.adoc'), source)
      const doc = await openVisual('Мои документы/Раздел А/x.adoc')
      await vscode.commands.executeCommand('nota.e2e.openlink', 'Папка%20с%20пробелом/Файл%20с%20пробелом.adoc')
      await waitFor('the file of the link is open', () => {
        const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input
        return input instanceof vscode.TabInputCustom && input.uri.fsPath.endsWith('Файл с пробелом.adoc')
      }, 10000)
      assert.equal(doc.getText(), source)
      await vscode.commands.executeCommand('workbench.action.closeAllEditors')
    },
  ],
  [
    'a file above 1 000 000 bytes opens in «Текст»',
    async () => {
      const path = join(work, 'big.adoc')
      writeFileSync(path, '= Большой\n\n' + '== Раздел\n\nСтрока текста для большого файла.\n\n'.repeat(15_000))
      const doc = await openVisual('big.adoc')
      assert.ok(Buffer.byteLength(doc.getText(), 'utf8') > 1_000_000)
      await waitMode('text')
      assert.equal(doc.isDirty, false)
      await vscode.commands.executeCommand('nota.toggleMode')
      await waitMode('visual')
      assert.equal(doc.isDirty, false)
    },
  ],
  [
    'diagram: [mermaid] blocks are drawn by the real renderer and the file stays as it was',
    async () => {
      const doc = await openVisual('mermaid.adoc')
      const original = doc.getText()
      await waitFor('three pictures are drawn', async () => ((await state()) as { diagrams?: number } | undefined)?.diagrams === 3, 40000)
      assert.equal(doc.getText(), original)
      assert.equal(doc.isDirty, false)
    },
  ],
  [
    'sheet: the tab shows three capsules and two remarks, and the file stays as it was',
    async () => {
      const doc = await openVisual('sheet.adoc')
      const original = doc.getText()
      await waitFor(
        'three capsules and two remarks',
        async () => {
          const now = (await state()) as { isles?: number; remarks?: number } | undefined
          return now?.isles === 3 && now?.remarks === 2
        },
        20000,
      )
      // no band behind the capsules, the first line stands below them
      const now = (await state()) as { row?: { background: string; firstGap: number; gapOpen: boolean } } | undefined
      assert.equal(now?.row?.background, 'rgba(0, 0, 0, 0)')
      // the same gap as before (30 px under the row), give or take 2
      assert.ok(Math.abs((now?.row?.firstGap ?? -99) - 30) <= 2, `the first line is 30 px under the capsules: ${now?.row?.firstGap}`)
      assert.equal(now?.row?.gapOpen, true, 'a click in the gap between the capsules reaches the document')
      assert.equal(doc.getText(), original)
      assert.equal(doc.isDirty, false)
    },
  ],
  [
    'page-meta: the header of a page is a badge «i», not islands, and the file stays as it was',
    async () => {
      const doc = await openVisual('page-meta.adoc')
      const original = doc.getText()
      await waitFor(
        'the badge and no islands',
        async () => {
          const now = (await state()) as { pagemeta?: { badge: boolean; islands: number } } | undefined
          return now?.pagemeta?.badge === true && now.pagemeta.islands === 0
        },
        20000,
      )
      await vscode.commands.executeCommand('nota.toggleMode')
      await waitMode('text')
      await vscode.commands.executeCommand('nota.toggleMode')
      await waitMode('visual')
      assert.equal(doc.getText(), original)
      assert.equal(doc.isDirty, false)
    },
  ],
  [
    'page-meta: body: the attributes after the link are in the badge, toc::[] is a narrow line, and the file stays as it was',
    async () => {
      const doc = await openVisual('page-meta-body.adoc')
      const original = doc.getText()
      await waitFor(
        'the badge, no islands, one narrow line',
        async () => {
          const now = (await state()) as { pagemeta?: { badge: boolean; islands: number; tocs?: number } } | undefined
          return now?.pagemeta?.badge === true && now.pagemeta.islands === 0 && now.pagemeta.tocs === 1
        },
        20000,
      )
      await vscode.commands.executeCommand('nota.toggleMode')
      await waitMode('text')
      await vscode.commands.executeCommand('nota.toggleMode')
      await waitMode('visual')
      assert.equal(doc.getText(), original)
      assert.equal(doc.isDirty, false)
    },
  ],
  [
    'wide: the page follows the width of the tab by clamp(38rem, 85cqw, 100cqw), blocks share its width',
    async () => {
      const wideDoc = await openVisual('wide.adoc')
      type Width = {
        tab: number; page: number; paragraph: number; table: number; tableScrolls: boolean; codeRows: number
        scrollClient: number; scrollOverflows: boolean; padLeft: number; padRight: number; marginLeft: number; marginRight: number
        image: number; imageNatural: number; diagram: number; diagramNatural: number
        heading: number; list: number; note: number; scrollTop: number
      }
      // (the tab is made wider or narrower by the zoom of the window: the sidebar is closed, the zoom changes the pixels of the tab)
      const measure = async (): Promise<Width> => {
        let last = -1
        let got: Width | undefined
        await waitFor('the page is measured and the width has settled', async () => {
          got = ((await vscode.commands.executeCommand('nota.e2e.state')) as { width?: Width } | undefined)?.width
          const settled = !!got && got.page > 0 && got.table > 0 && got.image > 0 && got.diagram > 0 && got.heading > 0 && got.list > 0 && got.note > 0 && got.tab === last
          last = got?.tab ?? -1
          return settled
        }, 20000)
        return got!
      }
      // (the width of the tab is changed by several ways, one after the other: the zoom does not work on every machine, the side bar
      // and the panel at the right do; what the tab got is read from the page, never assumed)
      const ways: Array<[string, () => PromiseLike<unknown>]> = [
        ['the side bar is closed', () => vscode.commands.executeCommand('workbench.action.closeSidebar')],
        ['the auxiliary bar is closed', () => vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar')],
        ['the side bar is open', () => vscode.commands.executeCommand('workbench.view.explorer')],
        ['the panel stands at the right', async () => {
          await vscode.commands.executeCommand('workbench.action.positionPanelRight')
          await vscode.commands.executeCommand('workbench.action.focusPanel')
        }],
        ['the zoom is changed', async () => {
          const conf = vscode.workspace.getConfiguration('window')
          await conf.update('zoomLevel', (conf.get<number>('zoomLevel') ?? 0) + 1, vscode.ConfigurationTarget.Global)
        }],
        ['the zoom is changed back', async () => {
          const conf = vscode.workspace.getConfiguration('window')
          await conf.update('zoomLevel', (conf.get<number>('zoomLevel') ?? 0) - 2, vscode.ConfigurationTarget.Global)
        }],
      ]
      const seen: Width[] = []
      const measureNow = async (): Promise<Width> => {
        await sleep(800)
        const m = await measure()
        seen.push(m)
        return m
      }
      // tries the ways until the tab differs from `from` by 120 px at least in the needed direction; undefined if none helped
      const change = async (from: Width, wider: boolean): Promise<Width | undefined> => {
        for (const [what, way] of ways) {
          await way()
          const m = await measureNow()
          console.log(`wide: ${what}: the tab is ${m.tab} px`)
          if (wider ? m.tab >= from.tab + 120 : m.tab <= from.tab - 120) return m
        }
        return undefined
      }
      const check = (m: Width): void => {
        const content = m.scrollClient - m.padLeft - m.padRight
        const base = Math.min(Math.max(m.tab * 0.85, 608), m.tab)
        const expected = m.tab <= 650 ? content : m.tab >= 761 ? Math.min(base, m.tab - 160, content) : Math.min(base, content)
        assert.ok(Math.abs(m.page - expected) <= 2, `page ${m.page} px, expected ${expected} px on a tab of ${m.tab} px`)
        assert.ok(Math.abs(m.paragraph - m.page) <= 2, `paragraph ${m.paragraph} px, page ${m.page} px`)
        assert.ok(Math.abs(m.table - m.page) <= 2, `table ${m.table} px, page ${m.page} px`)
        assert.equal(m.scrollOverflows, false, `the scroll area scrolls sideways on a tab of ${m.tab} px`)
        assert.ok(m.image <= m.page + 1 && m.image <= m.imageNatural + 1, `image ${m.image} px, page ${m.page} px, natural ${m.imageNatural} px`)
        assert.ok(Math.abs(m.image - Math.min(m.page, m.imageNatural)) <= 2, `image ${m.image} px should grow to the page ${m.page} px`)
        assert.ok(m.diagram <= m.page + 1, `diagram ${m.diagram} px, page ${m.page} px`)
        assert.ok(m.diagramNatural > 0 && m.diagram <= m.diagramNatural + 1, `diagram ${m.diagram} px is wider than its natural ${m.diagramNatural} px`)
        for (const [name, w] of [['heading', m.heading], ['list', m.list], ['note', m.note]] as const) {
          assert.ok(Math.abs(w - m.page) <= 2, `${name} ${w} px, page ${m.page} px`)
        }
        if (m.tab >= 761) {
          assert.ok(Math.abs(m.marginLeft - m.marginRight) <= 2, `the page is not in the middle: ${m.marginLeft} px and ${m.marginRight} px on a tab of ${m.tab} px`)
          // (strokes end at 46 px, the handle of a block stands 32 px from it)
          assert.ok(m.marginLeft >= 78, `the margin ${m.marginLeft} px leaves no room for the strokes and the handle`)
        }
      }
      try {
        // (every measure is checked against the width the tab really has; a width that did not change is a warning, not a pass)
        await vscode.commands.executeCommand('workbench.action.closeSidebar')
        const first = await measureNow()
        console.log(`wide: first tab ${first.tab} px, page ${first.page} px, table ${first.table} px, code rows ${first.codeRows}`)
        check(first)
        // the cursor goes to the end of the document: the tab scrolls there and keeps the place while the width changes
        const end = wideDoc.getText().length
        await vscode.commands.executeCommand('nota.e2e.select', end, end)
        await sleep(700)
        const scrolled = (await measure()).scrollTop
        assert.ok(scrolled > 0, 'the tab did not scroll to the end of the document')
        const other = (await change(first, first.tab < 1200)) ?? (await change(first, first.tab >= 1200))
        const checkBlocks = (m: Width): void => {
          // what depends on the real width of the page: the table of 7 columns needs ~844 px, a line of 113 signs ~ 940 px
          if (m.page >= 960 - 2) {
            assert.equal(m.tableScrolls, false, `the table scrolls on a page of ${m.page} px`)
            assert.equal(m.codeRows, 2, `the two lines of code take ${m.codeRows} rows on a page of ${m.page} px`)
          }
          if (m.page <= 800 + 2 && m.tab > 650) {
            assert.equal(m.tableScrolls, true, `the table of 7 columns does not scroll in its frame on a page of ${m.page} px`)
            assert.ok(m.codeRows > 2, `the lines of code did not wrap on a page of ${m.page} px`)
          }
          assert.ok(m.diagram > 0 && m.image > 0)
        }
        checkBlocks(first)
        if (!other) {
          const warning = `WARNING: no way changed the width of the tab (${seen.map((m) => m.tab).join(', ')} px): the follow-the-width check was not done, the formula was checked at the one width of ${first.tab} px`
          console.log(`wide: ${warning}`)
        } else {
          const bySize = [first, other].sort((x, y) => x.tab - y.tab)
          console.log(`wide: tabs ${bySize[0]!.tab} px and ${bySize[1]!.tab} px, pages ${bySize[0]!.page} px and ${bySize[1]!.page} px`)
          check(other)
          checkBlocks(other)
          assert.ok(other.scrollTop > 0, `the scroll jumped to the start after the width changed (was ${scrolled} px)`)
        }
        // every width the tab got on the way is checked once more by the formula
        for (const m of seen) check(m)
      } finally {
        await vscode.commands.executeCommand('workbench.action.zoomReset')
        await vscode.workspace.getConfiguration('window').update('zoomLevel', undefined, vscode.ConfigurationTarget.Global)
        await vscode.commands.executeCommand('workbench.action.positionPanelBottom')
        await vscode.commands.executeCommand('workbench.action.closePanel')
        await vscode.commands.executeCommand('workbench.view.explorer')
      }
    },
  ],
  [
    // the same CSS (dist/style.css) in a page of its own where the width of the tab is set by the test: the answer does not depend on
    // the screen, the zoom or the side bar of the machine (and the widths of the formula)
    'wide: the CSS of the page at tab widths set by the test (formula, scroll, pictures, strokes and handle)',
    async () => {
      const ext = resolve(__dirname, '..')
      const css = readFileSync(join(ext, 'dist/style.css'), 'utf8')
      let panel: vscode.WebviewPanel | undefined
      try {
        const image = `data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="60"><rect width="1400" height="60" fill="#888"/></svg>')}`
        const rows = (cells: string): string => `<tr>${cells}</tr>`
        const seven = (tag: string, text: string): string => rows(Array.from({ length: 7 }, () => `<${tag}>${text}</${tag}>`).join(''))
        const long = 'Длинный абзац выдуманного текста о приходе товара на складе. '.repeat(12)
        const code = 'накладная=A-2041; поставщик=Северный двор; коробок=120; принято=120; расхождение=0; смена=вторая; приёмщик=Иванов'
        const html = `<!doctype html><html><head><meta charset="utf-8"><style>${css}
html, body { margin: 0; padding: 0; background: #fff; } .ed-main { height: 420px; }</style></head>
<body><div class="ed-main" id="main"><button class="isle isle-strokes" id="strokes"></button>
<div class="scroll ed-visual" id="scroll"><article class="page" id="page"><div class="doc">
<h2>Заголовок</h2><p>${long}</p><p>${long}</p>
<div class="adm adm-NOTE">Заметка</div><div class="li"><span class="mk">•</span><span class="li-text">Пункт</span></div>
<div class="tbl"><div class="tbl-scroll"><table>${seven('th', 'Показатель 1')}${seven('td', 'Ячейка')}</table></div></div>
<figure class="nota-code"><pre class="code-src" id="code">${code}\n${code}</pre></figure>
<figure class="nota-image"><img id="image" src="${image}"></figure>
<div class="nota-diagram drawn"><div class="diagram-main"><div class="diagram-box"><svg id="diagram" viewBox="0 0 900 100" style="max-width:900px;width:100%"><rect width="900" height="100" fill="#888"/></svg></div></div></div>
<p>${long}</p><p>${long}</p><p>${long}</p>
</div></article></div>
<button class="blk-handle" id="handle" style="left:0;top:80px"></button></div>
<script>
const vs = acquireVsCodeApi()
const $ = (id) => document.getElementById(id)
// (no requestAnimationFrame and no waiting on timers: a window out of focus or covered draws no frames, and its timers run once a second;
// a read of a size forces the layout at once, so a microtask is all that is needed between the reads)
const frame = () => Promise.resolve()
const imageLoaded = () => new Promise((r) => {
  const img = $('image')
  if (img.complete) return r()
  img.addEventListener('load', r); img.addEventListener('error', r); setTimeout(r, 3000)
})
const w = (el) => el.getBoundingClientRect().width
async function at(width) {
  $('main').style.width = width + 'px'
  await frame()
  const main = $('main').getBoundingClientRect()
  const page = $('page').getBoundingClientRect()
  const p = document.querySelector('.doc > p')
  const tbl = document.querySelector('.tbl-scroll')
  const code = $('code')
  const cs = getComputedStyle(code)
  const strokes = $('strokes').getBoundingClientRect()
  // (the handle of a block stands 24 px wide and 8 px left of the block, as BlockHandle does)
  const handle = $('handle')
  handle.style.left = Math.max(2, page.left - main.left - 32) + 'px'
  await frame()
  const hr = handle.getBoundingClientRect()
  const sc = $('scroll')
  return {
    tab: main.width, page: page.width, left: page.left - main.left, right: main.right - page.right,
    paragraph: w(p), table: w(tbl), tableScrolls: tbl.scrollWidth > tbl.clientWidth, tableNeeds: tbl.scrollWidth,
    codeRows: Math.round((code.scrollHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)) / parseFloat(cs.lineHeight)),
    scrollOverflows: sc.scrollWidth > sc.clientWidth,
    image: w($('image')), imageNatural: $('image').naturalWidth, diagram: w($('diagram')),
    strokesShown: getComputedStyle($('strokes')).display !== 'none', strokesRight: strokes.right - main.left,
    handleLeft: hr.left - main.left, handleRight: hr.right - main.left, handleVisible: hr.left >= main.left,
    scrollTop: sc.scrollTop,
    fieldLeft: parseFloat(getComputedStyle(sc).paddingLeft), fieldRight: parseFloat(getComputedStyle(sc).paddingRight),
    bar: sc.offsetWidth - sc.clientWidth,
  }
}
async function run() {
  vs.postMessage({ step: 'go' })
  await imageLoaded()
  vs.postMessage({ step: 'image' })
  const out = []
  for (const width of [500, 650, 651, 761, 900, 1000, 1600, 2400]) { out.push(await at(width)); vs.postMessage({ step: width }) }
  // the page scrolled down keeps the place while the tab changes 1600 -> 1000 -> 1600
  await at(1600)
  const sc = $('scroll')
  sc.scrollTop = 300
  const before = sc.scrollTop
  const mid = await at(1000)
  const back = await at(1600)
  vs.postMessage({ out, before, mid, back })
}
let started = false
const fail = (e) => vs.postMessage({ error: String(e && e.stack || e) })
window.addEventListener('error', (e) => fail(e.message))
window.addEventListener('message', (e) => { if (e.data === 'go' && !started) { started = true; run().catch(fail) } })
// (a «ready» lost on the way is said again until «go» comes)
vs.postMessage('ready')
const again = setInterval(() => { if (started) clearInterval(again); else vs.postMessage('ready') }, 500)
</script></body></html>`
        type R = {
          tab: number; page: number; left: number; right: number; paragraph: number; table: number; tableScrolls: boolean; tableNeeds: number; codeRows: number
          scrollOverflows: boolean; image: number; imageNatural: number; diagram: number; strokesShown: boolean; strokesRight: number
          handleLeft: number; handleRight: number; handleVisible: boolean; scrollTop: number; fieldLeft: number; fieldRight: number; bar: number
        }
        // (the listener stands before the page exists; the page says «ready», the test says «go», then the page measures and answers;
        // a page of a busy machine may load late, so a silent one is opened again, three times)
        const load = (): Promise<{ out: R[]; before: number; mid: R; back: R }> => {
          panel?.dispose()
          const own = vscode.window.createWebviewPanel('nota.layout', 'layout', vscode.ViewColumn.One, { enableScripts: true })
          panel = own
          return new Promise((ok, fail) => {
            let heard = 'nothing'
            const timer = setTimeout(() => fail(new Error(`the layout page did not answer (heard: ${heard}; visible: ${own.visible})`)), 15000)
            own.webview.onDidReceiveMessage((m) => {
              if (m && m.step) { heard += ` ${m.step}`; return }
              if (m === 'ready') { heard = '«ready»'; return void own.webview.postMessage('go') }
              clearTimeout(timer)
              if (m && m.error) return fail(new Error(`the layout page failed: ${m.error}`))
              ok(m)
            })
            own.webview.html = html
          })
        }
        let got: { out: R[]; before: number; mid: R; back: R } | undefined
        for (let attempt = 1; !got; attempt++) {
          try {
            got = await load()
          } catch (error) {
            if (attempt >= 3) throw new Error(`${(error as Error).message} (3 tries of 15 s; the page uses no frames and no timers to measure)`, { cause: error })
          }
        }
        const near = (a: number, b: number, what: string): void => assert.ok(Math.abs(a - b) <= 2, `${what}: ${a} px, expected ${b} px`)
        for (const r of got.out) {
          // (the fields of .scroll are read from its computed style; up to 650 px the page takes all the rest)
          // (a classic scrollbar, 15 px, takes room too: one side up to 760 px, both sides from 761 px with `scrollbar-gutter: stable both-edges`)
          const room = r.tab - r.fieldLeft - r.fieldRight - r.bar * (r.tab >= 761 ? 2 : 1)
          const expected = r.tab <= 650 ? room : Math.min(Math.max(r.tab * 0.85, 608), r.tab, r.tab >= 761 ? r.tab - 160 : room)
          near(r.page, expected, `page on a tab of ${r.tab} px`)
          near(r.paragraph, r.page, `paragraph on a tab of ${r.tab} px`)
          near(r.table, r.page, `table on a tab of ${r.tab} px`)
          assert.equal(r.scrollOverflows, false, `the scroll area scrolls sideways on a tab of ${r.tab} px`)
          assert.ok(r.image <= r.page + 1 && r.image <= r.imageNatural + 1, `image ${r.image} px, page ${r.page} px`)
          near(r.image, Math.min(r.page, r.imageNatural), `image on a tab of ${r.tab} px`)
          assert.ok(r.diagram <= r.page + 1 && r.diagram <= 901, `diagram ${r.diagram} px, page ${r.page} px`)
          // (the box of a diagram has 16 px of padding at each side and a 1 px border)
          near(r.diagram, Math.min(r.page - 34, 900), `diagram on a tab of ${r.tab} px`)
          // the strokes are shown from 761 px; the text and the handle stand to the right of them, the handle is whole
          assert.equal(r.strokesShown, r.tab >= 761, `strokes on a tab of ${r.tab} px`)
          if (r.tab >= 761) {
            assert.ok(r.left >= r.strokesRight + 32 - 2, `the text starts at ${r.left} px, the strokes end at ${r.strokesRight} px`)
            assert.ok(r.handleLeft >= r.strokesRight, `the handle starts at ${r.handleLeft} px, the strokes end at ${r.strokesRight} px`)
            near(r.left, r.right, `the margins of the page on a tab of ${r.tab} px`)
          }
          assert.ok(r.handleVisible, `the handle is out of the tab ${r.tab} px`)
        }
        const by = (tab: number): R => got.out.find((r) => r.tab === tab)!
        near(by(1000).page, 840, 'page at 1000')
        near(by(1600).page, 1360, 'page at 1600')
        near(by(2400).page, 2040, 'page at 2400')
        assert.equal(by(1600).tableScrolls, false, `the table needs ${by(1600).tableNeeds} px, the page is ${by(1600).page} px`)
        assert.equal(by(1600).codeRows, 2, 'two lines of code in one row each at 1600')
        assert.equal(by(1000).tableScrolls, by(1000).tableNeeds > by(1000).page, `the table needs ${by(1000).tableNeeds} px, the page is ${by(1000).page} px`)
        // (a page up to 800 px: the table scrolls in its frame, the code wraps; 900 px tab, page 740)
        near(by(900).page, 740, 'page at 900')
        assert.equal(by(900).tableScrolls, true, `the table needs ${by(900).tableNeeds} px, the page is ${by(900).page} px`)
        assert.ok(by(900).codeRows > 2, 'the code wraps at 900')
        assert.ok(by(1600).image > 608 && by(1600).diagram > 608, 'a picture grows over 608 px')
        near(by(1600).image, Math.min(by(1600).page, by(1600).imageNatural), 'image at 1600 grows to the page')
        // no jump of the scroll while the width changes there and back
        assert.ok(got.before > 0, 'the page did not scroll')
        near(got.mid.page, 840, 'page at 1000 after 1600')
        near(got.back.page, 1360, 'page at 1600 after 1000')
        assert.ok(got.mid.scrollTop > 0 && got.back.scrollTop > 0, `the scroll jumped to the start (${got.mid.scrollTop}, ${got.back.scrollTop})`)
      } finally {
        panel?.dispose()
      }
    },
  ],
  [
    'wide: the page opens and the file stays as it was',
    async () => {
      const doc = await openVisual('wide.adoc')
      const original = doc.getText()
      await sleep(500)
      assert.equal(doc.getText(), original)
      assert.equal(doc.isDirty, false)
    },
  ],
  [
    'wide: a change of nota.pageWidth reaches the open tab at once, the text and the file stay',
    async () => {
      const doc = await openVisual('wide.adoc')
      const original = doc.getText()
      const conf = vscode.workspace.getConfiguration('nota')
      // (the width of the page: percent of the tab, not under 608 px, in a tab from 761 px with a margin of 80 px at each side; in a narrower tab the fields of the scroll are 36 + 24 px)
      const wanted = (tab: number, percent: number): number => (tab <= 650 ? tab - 60 : Math.min(Math.max(tab * (percent / 100), 608), tab >= 761 ? tab - 160 : tab - 60))
      const pageOf = async (): Promise<{ tab: number; page: number } | undefined> =>
        ((await vscode.commands.executeCommand('nota.e2e.state')) as { width?: { tab: number; page: number } } | undefined)?.width
      try {
        // (the geometry of the column «Сбоку» is its own test: here the page stands as in the view «Капсула»)
        await conf.update('outlineView', 'capsule', vscode.ConfigurationTarget.Global)
        await conf.update('pageWidth', 60, vscode.ConfigurationTarget.Global)
        await waitFor('the page is 60 % of the tab', async () => {
          const w = await pageOf()
          return !!w && w.tab > 0 && Math.abs(w.page - wanted(w.tab, 60)) <= 2
        }, 3000)
        await conf.update('pageWidth', 150, vscode.ConfigurationTarget.Global)
        await waitFor('150 acts as 100', async () => {
          const w = await pageOf()
          return !!w && w.tab > 0 && Math.abs(w.page - wanted(w.tab, 100)) <= 2
        }, 3000)
      } finally {
        await conf.update('pageWidth', undefined, vscode.ConfigurationTarget.Global)
        await conf.update('outlineView', undefined, vscode.ConfigurationTarget.Global)
      }
      await sleep(500)
      assert.equal(doc.getText(), original)
      assert.equal(doc.isDirty, false)
    },
  ],
  [
    'outline: a fresh tab is «Капсула», the command of the palette switches to «Сбоку» and back, a change of the setting reaches the open tab, the file stays',
    async () => {
      const doc = await openVisual('structure.adoc')
      const original = doc.getText()
      const conf = vscode.workspace.getConfiguration('nota')
      const viewOf = async (): Promise<{ view: string; column: boolean; strokes: boolean } | undefined> =>
        ((await vscode.commands.executeCommand('nota.e2e.state')) as { outline?: { view: string; column: boolean; strokes: boolean } } | undefined)?.outline
      try {
        await waitFor('a fresh tab is «Капсула»', async () => {
          const o = await viewOf()
          return o?.view === 'capsule' && !o.column
        }, 1000)
        await vscode.commands.executeCommand('nota.toggleOutlineView')
        await waitFor('the command made it «Сбоку»', async () => (await viewOf())?.view === 'side', 1000)
        assert.equal(conf.inspect<string>('outlineView')?.globalValue, 'side')
        await vscode.commands.executeCommand('nota.toggleOutlineView')
        await waitFor('and back to «Капсула»', async () => {
          const o = await viewOf()
          return o?.view === 'capsule' && !o.column
        }, 1000)
        assert.equal(conf.inspect<string>('outlineView')?.globalValue, 'capsule')
        await conf.update('outlineView', 'side', vscode.ConfigurationTarget.Global)
        await waitFor('a change in the settings reaches the tab', async () => (await viewOf())?.view === 'side', 1000)
        assert.equal(doc.isDirty, false)
      } finally {
        await conf.update('outlineView', undefined, vscode.ConfigurationTarget.Global)
      }
      await sleep(500)
      assert.equal(doc.getText(), original)
      assert.equal(doc.isDirty, false)
    },
  ],
  [
    'sheet: a selected word has no panel over it, a cell of a table has the row «Таблица» in the capsule, and Esc takes the row away',
    async () => {
      const doc = await openVisual('tables.adoc')
      const original = doc.getText()
      const word = original.indexOf('Абзац')
      await vscode.commands.executeCommand('nota.e2e.select', word, word + 5)
      await waitFor('the word is selected', async () => (await state())?.head === word + 5)
      await sleep(500)
      const plain = (await state()) as { floating?: number; tableRow?: boolean } | undefined
      assert.equal(plain?.floating, 0)
      assert.equal(plain?.tableRow, false)
      const at = original.indexOf('Личный кабинет клиента') + 5
      await vscode.commands.executeCommand('nota.e2e.select', at, at)
      await waitFor('the row is in the capsule', async () => ((await state()) as { tableRow?: boolean } | undefined)?.tableRow === true)
      assert.equal(((await state()) as { floating?: number } | undefined)?.floating, 0)
      assert.equal(doc.getText(), original)
      assert.equal(doc.isDirty, false)
    },
  ],
  ...wideBorderCases(),
  [
    'paste: HTML from a page becomes AsciiDoc in one step, and one Cmd+Z takes it back',
    async () => {
      const doc = await openVisual('visual.adoc')
      const original = doc.getText()
      const at = original.indexOf('клиенты пишут')
      await vscode.commands.executeCommand('nota.e2e.select', at, at)
      await waitFor('the cursor is there', async () => (await state())?.anchor === at)
      await vscode.commands.executeCommand('nota.e2e.pastehtml', '<meta charset="utf-8"><p>Вставка <strong>жирная</strong></p>', 'Вставка жирная')
      await waitFor('the pasted text is in the file', () => /Вставка \*{1,2}жирная\*{1,2}/.test(doc.getText()))
      await sleep(500)
      await vscode.commands.executeCommand('nota.e2e.undo')
      await waitFor('one Cmd+Z takes it back', () => doc.getText() === original)
      await vscode.commands.executeCommand('workbench.action.files.revert')
    },
  ],
]

/** the bars are closed, so that the tab is as wide as the window lets it be (the widths are read from the page, never assumed). */
async function widen(): Promise<void> {
  for (const c of ['workbench.action.closeSidebar', 'workbench.action.closeAuxiliaryBar', 'workbench.action.closePanel']) await vscode.commands.executeCommand(c)
  await sleep(500)
}

/** the first table of the page, as the page measures it. */
interface TblState {
  heads: number[]
  widths: number[]
  table: number
  scrollWidth: number
  clientWidth: number
  tag: string
  border1: number
  held: number
  limit: boolean
  drag: boolean
  classes: string
  errors: number
}

const tblState = async (): Promise<TblState> => {
  const t = ((await state()) as (TabState & { tbl?: TblState }) | undefined)?.tbl
  assert.ok(t, 'the page has a table')
  return t
}

/** The table T9, built by code: nine long headings, 800 rows of nine short cells, a cell `a|`, a last row over all columns. */
function t9(attrs: string, short = false): { text: string } {
  const heads = Array.from({ length: 9 }, (_, i) =>
    short
      ? `Г${i + 1}`
      : i === 3
      ? `r_items_kind_id/items_variant_code ${i + 1}`
      : i < 2
        ? `Заголовок колонки номер ${i + 1} с длинным названием`
        : `Название колонки ${i + 1} подлиннее`,
  )
  const lines = ['= Т9', '', attrs, '|===', ...heads.map((h) => `|${h}`), '']
  for (let r = 0; r < 800; r++) {
    for (let c = 0; c < 9; c++) lines.push(r === 400 && c === 4 ? 'a|' : `|в${r}.${c}`)
    lines.push('')
  }
  lines.push('9+| [.hl-red]##**текст**##', '|===', '')
  return { text: lines.join('\n') }
}

const colsOf = (text: string): number[] | null => {
  const m = /^\[%header,cols="([\d,]+)"\]$/m.exec(text)
  return m ? m[1]!.split(',').map(Number) : null
}

function wideBorderCases(): [string, () => Promise<void>][] {
  const mouseCase = async (file: string, text: string | null, at: (t: string) => number): Promise<{ doc: vscode.TextDocument; original: string }> => {
    await widen()
    if (text !== null) writeFileSync(join(work, file), text)
    const doc = await openVisual(file)
    const original = doc.getText()
    const cursor = at(original)
    await vscode.commands.executeCommand('nota.e2e.select', cursor, cursor)
    await waitFor('the cursor is in the cell', async () => (await state())?.anchor === cursor)
    return { doc, original }
  }
  /** The border goes on by the moves of the mouse from where the table put it (the table shrank under the mouse when the head wrapped); a limit of 64 px may hold it back, never push it further. */
  const follows = (from: TblState, to: TblState, when: string): void => {
    const want = from.border1 + (to.held - from.held)
    assert.ok(to.border1 <= want + 6 && to.border1 >= from.border1 - 6, `the border ${when}: ${from.border1} to ${to.border1}, the mouse wants ${want}: ${JSON.stringify(from)} ${JSON.stringify(to)}`)
    if (!to.limit) assert.ok(Math.abs(to.border1 - want) <= 6, `the border moves with the mouse ${when}: ${to.border1} against ${want}: ${JSON.stringify(from)} ${JSON.stringify(to)}`)
  }
  /** After the release the border stands on the right edge of column 1. */
  const onEdge = async (): Promise<void> => {
    await waitFor('the border stands at the new place of column 1', async () => { const t = await tblState(); return !t.drag && Math.abs(t.border1 - t.heads[0]!) <= 6 }, 20000)
  }
  /** The table is laid out: the same numbers in two reads 400 ms apart (a table of 800 rows wraps its head late under load, and a read in the middle of it is not a state). */
  const settle = async (): Promise<void> => {
    const key = (t: TblState): string => JSON.stringify([t.heads, t.table, t.border1, t.held])
    let prev = key(await tblState())
    for (let k = 0; k < 50; k++) {
      await sleep(400)
      const now = key(await tblState())
      if (now === prev) return
      prev = now
    }
  }
  /** Presses the border 1, moves 4 px (the table wraps its head), measures, goes on by 56 px: returns both. */
  const hold = async (): Promise<{ pre: TblState; base: TblState; mid: TblState }> => {
    const pre = await tblState()
    await vscode.commands.executeCommand('nota.e2e.table', 'border', '1,4', 'hold')
    // (the command returns when the page has dispatched the steps; `held` stays put only when the first move is over: base is read after that, else it is a state in the middle of a move)
    await waitFor('the head wraps while the border is dragged', async () => {
      const t = await tblState()
      if (!t.drag || t.held === 0) return false
      await sleep(150)
      return (await tblState()).held === t.held
    }, 20000)
    await settle()
    const base = await tblState()
    // (right after the table has wrapped its head the border has not run away from where it is: the mouse moved 4 px)
    assert.ok(Math.abs(base.border1 - base.heads[0]!) <= 6, `the border stands on the edge of column 1 after the first move: ${base.border1} against ${base.heads[0]}`)
    await vscode.commands.executeCommand('nota.e2e.table', 'border', 'move,56')
    await waitFor('the page has made the move of 56 px', async () => Math.abs((await tblState()).held - (base.held + 56)) <= 1, 20000)
    await settle()
    const mid = await tblState()
    follows(base, mid, 'after 60 px')
    assert.ok(mid.held > pre.border1 + 40, `the mouse went right: ${pre.border1} to ${mid.held}`)
    return { pre, base, mid }
  }
  // (column 1 grows by 60 px less what column 2 cannot give: it stops at 64 px; 9 columns in a page of 800 px leave it 25 px, so no fixed 40 px)
  // (to the right the left column grows, the neighbour stands, the table grows, there is no stop)
  const grew = (base: TblState, mid: TblState): void => {
    assert.ok(mid.heads[0]! >= base.heads[0]! + 20, `column 1 grew: ${base.heads[0]} to ${mid.heads[0]}: base ${JSON.stringify(base)}, mid ${JSON.stringify(mid)}`)
    assert.ok(Math.abs(mid.widths[1]! - base.widths[1]!) <= 3, `column 2 stands: ${base.widths[1]} to ${mid.widths[1]}: base ${JSON.stringify(base)}, mid ${JSON.stringify(mid)}`)
    assert.ok(mid.table >= base.table + 20, `the table grew: ${base.table} to ${mid.table}`)
    assert.ok(!mid.limit, 'no stop to the right')
  }
  const near = (a: number, b: number, d: number, what: string): void => assert.ok(Math.abs(a - b) <= d, `${what}: ${a} against ${b}`)
  return [
    [
      'table: T9 (cols="9", 800 rows): a border is dragged by 60 px, the widths move at once, cols is written within 2 s, the page shows them, one Cmd+Z takes it back',
      async () => {
        const t = t9('[%header,cols="9"]')
        const { doc, original } = await mouseCase('table-t9.adoc', t.text, (x) => x.indexOf('|Заголовок') + 3)
        const errors = (await tblState()).errors
        const { pre, base, mid } = await hold()
        grew(base, mid)
        assert.ok(/^\d+%$/.test(mid.tag), mid.tag)
        const t0 = Date.now()
        await vscode.commands.executeCommand('nota.e2e.table', 'border', 'release')
        await waitFor('cols is written', () => doc.getText() !== original, 10000)
        const took = Date.now() - t0
        assert.ok(took <= 2000, `the document changed ${took} ms after the button was let go`)
        const now = doc.getText()
        const nums = colsOf(now)!
        assert.ok(nums && nums.length === 9 && nums.every(Number.isInteger) && nums.reduce((a, b) => a + b, 0) === 100, `cols: ${nums}`)
        assert.equal(changedLines(original, now), 1)
        // (only the columns 1 and 2 changed: the others stand as they were in the drag)
        for (let k = 2; k < 9; k++) near(nums[k]!, (100 * base.widths[k]!) / base.table, 2, `column ${k + 1} unchanged`)
        await onEdge()
        assert.ok(now.includes('[%header,cols="'))
        // the columns stand by their percents, no scroll sideways; also after the file is closed and opened again
        const check = async (): Promise<void> => {
          await waitFor('the widths are on the screen', async () => { const t = await tblState(); return !t.drag && /tbl-fixed/.test(t.classes) }, 20000)
          await sleep(500)
          const s = await tblState()
          assert.match(s.classes, /tbl-fixed/)
          s.widths.forEach((w, i) => near((100 * w) / s.table, nums[i]!, 2, `column ${i + 1} in percent`))
          assert.equal(s.errors, errors, 'no errors in the page')
        }
        await check()
        // (one Cmd+Z takes it back, byte for byte; Cmd+Shift+Z writes it again)
        await vscode.commands.executeCommand('nota.e2e.undo')
        await waitFor('one Cmd+Z takes it back', () => doc.getText() === original, 10000)
        // (the table is as wide as before the drag, not as wide as the drag left it)
        await sleep(500)
        near((await tblState()).table, pre.table, 3, 'table after Cmd+Z')
        await vscode.commands.executeCommand('nota.e2e.redo')
        await waitFor('the widths are written again', () => doc.getText() === now, 10000)
        // (Cmd+Shift+Z brings the width of the drag back, also in a table without percents before it)
        await sleep(500)
        const redone = (await tblState()).table
        assert.ok(redone >= pre.table + 20, `the table is wider again after Cmd+Shift+Z: ${pre.table} to ${redone}`)
        // (saved, closed, opened again)
        assert.equal(await doc.save(), true)
        await vscode.commands.executeCommand('workbench.action.closeAllEditors')
        await openVisual('table-t9.adoc')
        await check()
      },
    ],
    [
      'table: wide.adoc: a border is dragged, the widths move, cols of 7 numbers is written; Esc takes the drag back, a press without a move writes nothing',
      async () => {
        const { doc, original } = await mouseCase('wide.adoc', null, (x) => x.indexOf('|Номер') + 3)
        await sleep(500)
        const before = await tblState()
        // a press without a move
        await vscode.commands.executeCommand('nota.e2e.table', 'border', '1,0', 'click')
        await sleep(500)
        assert.equal(doc.getText(), original)
        const afterClick = await tblState()
        near(afterClick.table, before.table, 1, 'table after a press')
        assert.equal(afterClick.drag, false)
        // Esc
        const { base, mid } = await hold()
        grew(base, mid)
        await vscode.commands.executeCommand('nota.e2e.table', 'border', 'esc')
        await sleep(500)
        const esc = await tblState()
        assert.equal(esc.drag, false)
        assert.equal(doc.getText(), original)
        near(esc.table, before.table, 1, 'table after Esc')
        near(esc.scrollWidth, before.scrollWidth, 1, 'scroll width after Esc')
        near(esc.heads[0]!, before.heads[0]!, 1, 'column 1 after Esc')
        // the release
        await hold()
        await vscode.commands.executeCommand('nota.e2e.table', 'border', 'release')
        await waitFor('cols is written', () => doc.getText() !== original, 10000)
        await onEdge()
        const m = /^\[cols="([\d,]+)"\]$|^\[%header,cols="([\d,]+)"\]$|cols="([\d,]+)"/m.exec(doc.getText())
        const nums = (m?.[1] ?? m?.[2] ?? m?.[3] ?? '').split(',').map(Number)
        assert.ok(nums.length === 7 && nums.every(Number.isInteger) && nums.reduce((a, b) => a + b, 0) === 100, `cols: ${nums}`)
        await vscode.commands.executeCommand('nota.e2e.undo')
        await waitFor('one Cmd+Z takes it back', () => doc.getText() === original, 10000)
        await vscode.commands.executeCommand('workbench.action.files.revert')
      },
    ],
    [
      // the right edge of the last column of a table wider than the window
      'table: the last column is dragged: the frame is scrolled to the end, the right edge goes to the right, cols is written, one Cmd+Z gives the file back',
      async () => {
        // (the shape of the first table of a user file: 8 columns without percents, long headings, code without spaces in the first column)
        const lines = ['= Т', '', '[%header,cols="8"]', '|===']
        const heads = ['Параметр', 'Тип', 'Описание', 'GET /demo/v1/items - Список позиций каталога + Признак', 'GET /items/stock - Остаток на складе по позиции + Признак', 'POST /demo/v1/items/search - Поиск позиций по параметрам + Признак', 'Склад XY', 'Пример']
        lines.push(...heads.map((h) => `|${h}`), '')
        for (let r = 0; r < 40; r++) {
          lines.push(`a|\n* \`productRecord.categoryGroup.stockManifest.series${r}\``, '|String', `|Описание поля ${r}`, '|Да', '|Нет', '|--', '|', `|\`значение${r}\``, '')
        }
        lines.push('|===', '')
        const { doc, original } = await mouseCase('table-edge.adoc', lines.join('\n'), (x) => x.indexOf('|Параметр') + 3)
        await sleep(500)
        const before = await tblState()
        assert.ok(before.scrollWidth > before.clientWidth + 50, `the table is wider than its frame: ${before.scrollWidth} against ${before.clientWidth}`)
        await vscode.commands.executeCommand('nota.e2e.table', 'border', 'scrollEnd')
        await sleep(500)
        await vscode.commands.executeCommand('nota.e2e.table', 'border', '8,60')
        await waitFor('cols is written', () => doc.getText() !== original, 20000)
        const nums = colsOf(doc.getText())
        assert.ok(nums && nums.length === 8 && nums.every(Number.isInteger) && nums.reduce((a, b) => a + b, 0) === 100, `cols: ${nums}`)
        await vscode.commands.executeCommand('nota.e2e.undo')
        await waitFor('one Cmd+Z takes it back', () => doc.getText() === original, 10000)
        await vscode.commands.executeCommand('workbench.action.files.revert')
      },
    ],
  ]
}

export async function run(): Promise<void> {
  let failed = 0
  let ran = 0
  const nota = vscode.workspace.getConfiguration('nota')
  for (const [name, fn] of cases) {
    if (only && !name.includes(only)) continue
    ran++
    try {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors')
      // before every case nota.outlineView goes back to unset, that is the default «Капсула», so no case inherits the view of the previous one.
      await nota.update('outlineView', undefined, vscode.ConfigurationTarget.Global)
      await fn()
      console.log(`  ok   ${name}`)
    } catch (error) {
      failed++
      console.log(`  FAIL ${name}\n       ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`)
    }
  }
  console.log(`${ran - failed} passed, ${failed} failed`)
  if (failed) throw new Error(`${failed} of ${ran} cases failed`)
}
