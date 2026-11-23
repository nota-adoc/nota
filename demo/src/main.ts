// The demo of nota: one page, «Visual» and «Source» side by side on one session, in the style of the series. The page speaks
// English or Russian (`i18n.ts`): the language of the browser at the first visit, the person's choice after that.
import { lintGutter } from '@codemirror/lint'
import { Compartment, Prec } from '@codemirror/state'
import { EditorView, highlightActiveLineGutter } from '@codemirror/view'
import { type NotaSession, type SourceEditor, createSession, createSourceEditor } from '@nota-adoc/codemirror'
import { type VisualEditor, createVisualEditor } from '@nota-adoc/prosemirror'
import { Plugin, Selection } from 'prosemirror-state'
import { isMacPlatform } from './keys.js'
import { setupLinkField } from './link.js'
import { initialLang, lang, numberFormat, onLang, setLang, t, type Lang } from './i18n.js'
import { labelsOf, messagesOf } from './messages.js'
import { setupNotice } from './notice.js'
import { samples } from './samples.js'
import { setupStatus } from './status.js'
import { setupTheme } from './theme.js'
import { xrefTargets } from './xref.js'
import { installTips } from './tips.js'
import { setupToolbar } from './toolbar.js'

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

// the page says its language before anything is drawn
setLang(initialLang(), { remember: false })

const app = {
  work: $('work'),
  sample: $<HTMLSelectElement>('sample'),
  style: $<HTMLSelectElement>('style'),
  visualHost: $('visual'),
  sourceHost: $('source'),
  len: $('len'),
}

for (const s of samples) app.sample.append(new Option(s.label[lang()], s.id))

let session: NotaSession = createSession(samples[0]!.text(lang()))
let visual: VisualEditor | undefined
let source: SourceEditor | undefined
let unsubscribe: (() => void) | null = null

installTips($('tip'), isMacPlatform())

const notice = setupNotice({
  box: $('notice'),
  text: $('notice-text'),
  close: $('notice-x'),
  host: app.visualHost,
  editor: () => visual,
})

const link = setupLinkField({
  pop: $('linkpop'),
  input: $<HTMLInputElement>('link-url'),
  apply: $('link-apply'),
  button: $('link-btn'),
  pane: document.querySelector<HTMLElement>('.pane-visual')!,
  editor: () => visual,
  beforeCommand: notice.hide,
})

const toolbar = setupToolbar({
  toolbar: $('toolbar'),
  style: app.style,
  editor: () => visual,
  session: () => session,
  beforeCommand: notice.hide,
  openLink: link.open,
})

// ---------------------------------------------------------------- the theme
/** The base theme of «Исходник», light or dark: the colours themselves are the tokens of the page. */
const sourceTheme = new Compartment()
const theme = setupTheme({
  button: $('theme'),
  onChange: (dark) => source?.view.dispatch({ effects: sourceTheme.reconfigure(EditorView.darkTheme.of(dark)) }),
})

// ---------------------------------------------------------------- the status line
const status = setupStatus({ status: $('status'), path: $('path') })
/** The cursor is in «Исходник»: the path of the nodes shows only then. */
let sourceFocused = false
app.sourceHost.addEventListener('focusin', () => {
  sourceFocused = true
  if (source) status.path(source.view)
})
app.sourceHost.addEventListener('focusout', () => {
  sourceFocused = false
  status.path(null)
})

function showLength(): void {
  app.len.textContent = t('len.text', { n: numberFormat().format(session.text.length) })
}

/** The editable text is the document of the styles: its class, its name for a screen reader, and no spelling marks. */
const documentLook = (): Plugin =>
  new Plugin({ props: { attributes: { class: 'doc', 'aria-label': t('doc.label'), spellcheck: 'false' } } })

/** Both windows on the current session: a new session (a sample, a file) builds them anew, a view change only hides one. */
function mount(): void {
  unsubscribe?.()
  notice.hide()
  link.close(false)
  visual?.destroy()
  source?.destroy()
  app.visualHost.textContent = ''
  app.sourceHost.textContent = ''
  visual = createVisualEditor(app.visualHost, { session, messages: messagesOf(lang()), labels: labelsOf(lang()), onReject: notice.show, plugins: [toolbar.plugin(), documentLook()] })
  sourceFocused = false
  status.path(null)
  source = createSourceEditor(app.sourceHost, {
    session,
    xrefTargets,
    extensions: [
      sourceTheme.of(EditorView.darkTheme.of(theme.isDark())),
      // the icon of a diagnostic on the gutter, left of the numbers; the number of the line of the cursor is lit
      Prec.high(lintGutter()),
      highlightActiveLineGutter(),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) status.count(update.view)
        if (sourceFocused && (update.docChanged || update.selectionSet)) status.path(update.view)
      }),
    ],
  })
  status.count(source.view)
  unsubscribe = session.subscribe(() => {
    showLength()
    toolbar.refresh()
  })
  showLength()
  toolbar.refresh()
  // for the console and for the tests of the page
  window.notaDemo = { session, visual, source }
}

function load(text: string): void {
  session = createSession(text)
  mount()
}

// ---------------------------------------------------------------- the view: «Визуально», «Рядом», «Исходник»
type View = 'visual' | 'split' | 'source'
const views = [...document.querySelectorAll<HTMLButtonElement>('.seg [data-view]')]
let chosenView: View = 'split'
const narrow = typeof matchMedia === 'function' ? matchMedia('(max-width: 719px)') : null

/** A narrow window shows one window at a time: «Рядом» is what the person chose, and it comes back when the window grows. */
function showView(): void {
  const view: View = narrow?.matches && chosenView === 'split' ? 'visual' : chosenView
  app.work.dataset.view = view
  for (const button of views) button.setAttribute('aria-checked', String(button.dataset.view === view))
  source?.view.requestMeasure()
}
for (const button of views)
  button.addEventListener('click', () => {
    chosenView = button.dataset.view as View
    showView()
  })
narrow?.addEventListener('change', showView)

// ---------------------------------------------------------------- the file: «Открыть файл», «Скачать»
/** The name of the opened file: the document is saved under it. Without a file, the name is the id of the sample. */
let fileName: string | null = null
/** The name shown in the line of the list for an opened file (it is written again when the language changes). */
let openedFile: string | null = null
const downloadName = (): string => fileName ?? `${app.sample.value}.adoc`

function showDownloadName(): void {
  $('download').dataset.tip = t('download.tip', { name: downloadName() })
}

app.sample.addEventListener('change', () => {
  const id = app.sample.value
  // the file is already open in the windows: choosing its line again changes nothing
  if (id === 'file') return
  fileName = null
  openedFile = null
  app.sample.querySelector('option[value="file"]')?.remove()
  load(samples.find((s) => s.id === id)!.text(lang()))
  showDownloadName()
})

$('open').addEventListener('click', () => $('file').click())
$<HTMLInputElement>('file').addEventListener('change', async (event) => {
  const input = event.currentTarget as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  // the byte order mark stays in the text: the same bytes come back from «Скачать»
  const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(await file.arrayBuffer())
  input.value = ''
  fileName = file.name
  openedFile = file.name
  let option = app.sample.querySelector<HTMLOptionElement>('option[value="file"]')
  if (!option) {
    option = new Option('', 'file')
    app.sample.insertBefore(option, app.sample.firstChild)
  }
  option.textContent = t('file.label', { name: file.name })
  app.sample.value = 'file'
  load(text)
  showDownloadName()
})

$('download').addEventListener('click', () => {
  try {
    const url = URL.createObjectURL(new Blob([session.text], { type: 'text/plain;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = downloadName()
    document.body.append(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  } catch {
    // a page in a sandbox may not save files: nothing to show, the text stays in the windows
  }
})

// ---------------------------------------------------------------- the language: EN | RU
const langs = [...document.querySelectorAll<HTMLButtonElement>('#lang [data-lang]')]

function showLang(): void {
  for (const button of langs) {
    const on = button.dataset.lang === lang()
    button.setAttribute('aria-checked', String(on))
    button.tabIndex = on ? 0 : -1
  }
  for (const [i, s] of samples.entries()) app.sample.options[app.sample.options.length - samples.length + i]!.textContent = s.label[lang()]
  const file = app.sample.querySelector('option[value="file"]')
  if (file && openedFile) file.textContent = t('file.label', { name: openedFile })
  showDownloadName()
  showLength()
}

/** The words of the page are in the new language: the editors are drawn again on the same session (the text, the history and the cursor stay). */
function relanguage(): void {
  const focused = app.visualHost.contains(document.activeElement) ? 'visual' : app.sourceHost.contains(document.activeElement) ? 'source' : null
  const visualSelection = visual?.view.state.selection.toJSON()
  const sourceSelection = source?.view.state.selection.main
  const visualScroll = $('vis-scroll').scrollTop
  const sourceScroll = source?.view.scrollDOM.scrollTop ?? 0
  showLang()
  mount()
  if (visualSelection && visual) {
    try {
      visual.view.dispatch(visual.view.state.tr.setSelection(Selection.fromJSON(visual.view.state.doc, visualSelection)))
    } catch {
      // the cursor stays where the editor has put it
    }
  }
  if (sourceSelection && source) source.view.dispatch({ selection: { anchor: sourceSelection.anchor, head: sourceSelection.head } })
  $('vis-scroll').scrollTop = visualScroll
  if (source) source.view.scrollDOM.scrollTop = sourceScroll
  status.path(sourceFocused && source ? source.view : null)
  if (focused === 'visual') visual?.focus()
  else if (focused === 'source') source?.view.focus()
}

function chooseLang(next: Lang): void {
  if (next !== lang()) setLang(next)
}
onLang(relanguage)
for (const button of langs) button.addEventListener('click', () => chooseLang(button.dataset.lang as Lang))
// the arrows move between the two buttons, as in any group of radio buttons
$('lang').addEventListener('keydown', (event) => {
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
  event.preventDefault()
  const other = langs.find((button) => button.dataset.lang !== lang())!
  chooseLang(other.dataset.lang as Lang)
  other.focus()
})

mount()
showView()
showLang()
