/** The keys of the editor: marks, styles, Enter, Backspace and Delete, undo and redo. */
import { keydownHandler } from 'prosemirror-keymap'
import { Plugin } from 'prosemirror-state'
import type { EditorCommands } from './editor.js'

export function keymapPlugin(
  commands: () => EditorCommands,
  inList: () => boolean,
  inCode: () => boolean,
  inTable: () => boolean = () => false,
): Plugin {
  const c = (): EditorCommands => commands()
  const handle = keydownHandler({
    'Mod-b': () => (c().toggleMark('strong'), true),
    'Mod-i': () => (c().toggleMark('em'), true),
    'Mod-e': () => (c().toggleMark('code'), true),
    'Mod-Shift-x': () => (c().toggleMark('strike'), true),
    'Mod-Shift-X': () => (c().toggleMark('strike'), true),
    'Mod-Shift-h': () => (c().toggleMark('highlight'), true),
    'Mod-Shift-H': () => (c().toggleMark('highlight'), true),
    'Mod-Alt-0': () => (c().toggleBlockType('paragraph'), true),
    'Mod-Alt-2': () => (c().toggleBlockType('heading', 2), true),
    'Mod-Alt-3': () => (c().toggleBlockType('heading', 3), true),
    'Mod-Alt-4': () => (c().toggleBlockType('heading', 4), true),
    'Mod-Alt-5': () => (c().toggleBlockType('heading', 5), true),
    'Mod-Alt-6': () => (c().toggleBlockType('heading', 6), true),
    // Tab and Shift-Tab are the editor's in a list (the focus stays in the text); anywhere else they move the focus as before
    // (in code a Tab is two blanks, and the focus stays in the editor)
    // (in a table they go from cell to cell, and Tab in the last cell adds a row)
    Tab: () =>
      inTable()
        ? (c().nextCell(1), true)
        : inCode()
          ? (c().indentCode(1), true)
          : inList()
            ? (c().indentListItem(), true)
            : false,
    'Shift-Tab': () =>
      inTable()
        ? (c().nextCell(-1), true)
        : inCode()
          ? (c().indentCode(-1), true)
          : inList()
            ? (c().outdentListItem(), true)
            : false,
    Enter: () => (c().splitBlock(), true),
    'Shift-Enter': () => (c().insertBreak(), true),
    Backspace: () => (c().deleteBackward(), true),
    Delete: () => (c().deleteForward(), true),
    'Mod-z': () => (c().undo(), true),
    'Mod-Shift-z': () => (c().redo(), true),
    'Mod-Shift-Z': () => (c().redo(), true),
    'Mod-y': () => (c().redo(), true),
  })
  // as a handler of the DOM event, so that it is not lost to the checks ProseMirror makes near an input method
  return new Plugin({
    props: {
      handleDOMEvents: {
        keydown: (view, event) => {
          // the title of a collapsible block has its own keys
          if ((event.target as Element | null)?.closest?.('.coll-head')) return false
          // Ctrl+Alt is AltGr on Windows: a digit key that gives another sign (`}` on a German keyboard) types it
          if (event.ctrlKey && event.altKey && !event.metaKey && event.key.length === 1 && !/[0-9]/.test(event.key)) return false
          if (view.composing || !handle(view, event)) return false
          event.preventDefault()
          return true
        },
      },
    },
  })
}
