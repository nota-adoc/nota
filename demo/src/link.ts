// The field of the address of a link: «Ссылка» opens it under the toolbar, Enter or «Поставить» puts the link on the words that
// were selected, Esc or a click elsewhere closes it and changes nothing.
import { type VisualEditor, schema } from '@nota-adoc/prosemirror'
import { Selection } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'

export interface LinkFieldOptions {
  /** The field with its label, hint and button. */
  pop: HTMLElement
  input: HTMLInputElement
  apply: HTMLElement
  /** The button «Ссылка»: it tells whether the field is open, and a press on it is not «elsewhere». */
  button: HTMLElement
  /** The window of «Визуально»: the field is placed in it. */
  pane: HTMLElement
  editor(): VisualEditor | undefined
  /** Called before the link is put: the message of an earlier refusal goes away. */
  beforeCommand(): void
}

export interface LinkField {
  open(): void
  /** Closes the field; `restore` gives the cursor back to the text, as it was before the field opened. */
  close(restore: boolean): void
}

/** The address of the link when the selected words are one link, otherwise `https://`. */
function initialAddress(view: EditorView): string {
  const { from, to, empty, $from, $to } = view.state.selection
  if (empty || !$from.sameParent($to)) return 'https://'
  const hrefs = new Set<string | null>()
  view.state.doc.nodesBetween(from, to, (node) => {
    if (node.isText) hrefs.add(schema.marks.link!.isInSet(node.marks)?.attrs.href ?? null)
    return true
  })
  const [only] = hrefs
  return hrefs.size === 1 && only ? only : 'https://'
}

export function setupLinkField(options: LinkFieldOptions): LinkField {
  const { pop, input, apply, button, pane } = options
  let saved: unknown = null

  const isOpen = (): boolean => !pop.hidden

  function open(): void {
    const view = options.editor()?.view
    if (!view) return
    options.beforeCommand()
    saved = view.state.selection.toJSON()
    input.value = initialAddress(view)
    pop.hidden = false
    // under the button, inside the window
    const box = pane.getBoundingClientRect()
    const anchor = button.getBoundingClientRect()
    const left = Math.max(8, Math.min(anchor.left - box.left, box.width - pop.offsetWidth - 8))
    pop.style.left = `${left}px`
    pop.style.top = `${anchor.bottom - box.top + 6}px`
    button.setAttribute('aria-expanded', 'true')
    input.focus()
    // a new address goes after https://, an old one is selected to be replaced
    if (input.value === 'https://') input.setSelectionRange(input.value.length, input.value.length)
    else input.select()
  }

  /** The cursor goes back to the text, on the words that were selected when the field opened. */
  function giveBack(): void {
    const editor = options.editor()
    if (!editor) return
    editor.focus()
    const view = editor.view
    if (!saved) return
    try {
      const selection = Selection.fromJSON(view.state.doc, saved)
      if (!selection.eq(view.state.selection)) view.dispatch(view.state.tr.setSelection(selection))
    } catch {
      // the text changed under the field: the cursor stays where the editor has it
    }
  }

  function close(restore: boolean): void {
    if (!isOpen()) return
    pop.hidden = true
    button.setAttribute('aria-expanded', 'false')
    if (restore) giveBack()
  }

  function submit(): void {
    const address = input.value
    close(false)
    giveBack()
    options.editor()?.commands.setLink(address)
  }

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.isComposing) {
      event.preventDefault()
      submit()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      close(true)
    }
  })
  apply.addEventListener('click', submit)
  // a click elsewhere: the field closes, and the click does what it does
  document.addEventListener('mousedown', (event) => {
    const target = event.target as Element
    if (isOpen() && !pop.contains(target) && !button.contains(target)) close(false)
  })
  // and the keyboard leaving the field
  pop.addEventListener('focusout', (event) => {
    const next = event.relatedTarget as Node | null
    if (isOpen() && next && !pop.contains(next) && !button.contains(next)) close(false)
  })

  return { open, close }
}
