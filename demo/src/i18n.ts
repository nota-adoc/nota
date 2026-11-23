// The language of the page: English or Russian. The words of the page are in the two dictionaries below, the markup names them
// with `data-i18n*` attributes, and a change of the language rewrites them in place (the document stays).
//   data-i18n="key"             the text of the element
//   data-i18n-html="key"        the text with `<code>` in it (the dictionary is ours, not the person's)
//   data-i18n-aria-label="key"  an attribute; the same for `-title`, `-placeholder` and `-tip` (that is `data-tip`)
//   data-i18n-keys="key"        the notes of the keys of a tooltip (`data-keys`)
// A word with a hole is written `{name}`.

export type Lang = 'en' | 'ru'

/** The key of `localStorage` that keeps the language of the person. */
export const STORAGE_KEY = 'nota-demo-lang'

const en = {
  title: 'Nota — AsciiDoc playground',
  'brand.sub': 'AsciiDoc playground',
  'sample.label': 'Sample',
  'open.label': 'Open file',
  'open.tip': 'Open an .adoc file from your computer',
  'download.label': 'Download',
  'download.tip': 'Download {name}',
  'lang.label': 'Language',
  'view.label': 'View',
  'view.visual': 'Visual',
  'view.split': 'Split',
  'view.source': 'Source',
  'theme.dark': 'Dark theme',
  'theme.light': 'Light theme',
  'toolbar.label': 'Text formatting',
  undo: 'Undo',
  redo: 'Redo',
  'style.label': 'Paragraph style',
  'style.keys': 'mod+alt+0:text|mod+alt+2…6:headings',
  'style.h1': 'Document title',
  'style.p': 'Text',
  'style.h2': 'Heading 2',
  'style.h3': 'Heading 3',
  'style.h4': 'Heading 4',
  'style.h5': 'Heading 5',
  'style.h6': 'Heading 6',
  strong: 'Bold',
  em: 'Italic',
  code: 'Monospace',
  s: 'Strikethrough',
  mark: 'Highlight',
  link: 'Link',
  unlink: 'Remove link',
  'link.address': 'Link address',
  'link.apply': 'Apply',
  'link.hint': 'Use <code>https://…</code>, <code>#section</code>, <code>document.adoc#section</code> or a path. Enter — apply, Esc — close.',
  'notice.hide': 'Hide',
  'pane.source': 'Source',
  'doc.label': 'Document, visual',
  'file.label': 'File: {name}',
  'count.error': 'Errors',
  'count.warning': 'Warnings',
  'count.info': 'Messages',
  'count.errors': 'errors',
  'count.warnings': 'warnings',
  'count.infos': 'messages',
  'len.tip': 'Length of the text in characters',
  'len.text': '{n} chars',
  'xref.install': 'Installation',
  'xref.usage': 'Usage',
  'xref.options': 'Options',
  'xref.exit-codes': 'Exit codes',
} as const

export type Key = keyof typeof en

const ru: Record<Key, string> = {
  title: 'Nota — песочница AsciiDoc',
  'brand.sub': 'песочница AsciiDoc',
  'sample.label': 'Образец',
  'open.label': 'Открыть файл',
  'open.tip': 'Открыть файл .adoc с компьютера',
  'download.label': 'Скачать',
  'download.tip': 'Скачать {name}',
  'lang.label': 'Язык',
  'view.label': 'Вид',
  'view.visual': 'Визуально',
  'view.split': 'Рядом',
  'view.source': 'Исходник',
  'theme.dark': 'Тёмная тема',
  'theme.light': 'Светлая тема',
  'toolbar.label': 'Оформление текста',
  undo: 'Отменить',
  redo: 'Повторить',
  'style.label': 'Стиль абзаца',
  'style.keys': 'mod+alt+0:текст|mod+alt+2…6:заголовки',
  'style.h1': 'Заголовок документа',
  'style.p': 'Текст',
  'style.h2': 'Заголовок 2',
  'style.h3': 'Заголовок 3',
  'style.h4': 'Заголовок 4',
  'style.h5': 'Заголовок 5',
  'style.h6': 'Заголовок 6',
  strong: 'Жирный',
  em: 'Курсив',
  code: 'Моноширинный',
  s: 'Зачёркнутый',
  mark: 'Выделение цветом',
  link: 'Ссылка',
  unlink: 'Убрать ссылку',
  'link.address': 'Адрес ссылки',
  'link.apply': 'Поставить',
  'link.hint': 'Подойдёт <code>https://…</code>, <code>#раздел</code>, <code>документ.adoc#раздел</code> или путь. Enter — поставить, Esc — закрыть.',
  'notice.hide': 'Скрыть',
  'pane.source': 'Исходник',
  'doc.label': 'Документ, визуально',
  'file.label': 'Файл: {name}',
  'count.error': 'Ошибки',
  'count.warning': 'Предупреждения',
  'count.info': 'Сообщения',
  'count.errors': 'ошибок',
  'count.warnings': 'предупреждений',
  'count.infos': 'сообщений',
  'len.tip': 'Длина текста в символах',
  'len.text': '{n} симв.',
  'xref.install': 'Установка',
  'xref.usage': 'Использование',
  'xref.options': 'Параметры',
  'xref.exit-codes': 'Коды возврата',
}

/** The two dictionaries, by language (the test of completeness walks them). */
export const dictionary: Readonly<Record<Lang, Readonly<Record<Key, string>>>> = { en, ru }

/** The language the browser says: Russian for `ru`, `ru-RU`…, English for anything else. */
export const languageOf = (code: string | undefined | null): Lang => (/^ru(?:$|[-_])/i.test((code ?? '').trim()) ? 'ru' : 'en')

/** The saved choice of the person, or `null`: there is none, or `localStorage` is not there (a sandbox, a blocked site). */
function saved(): Lang | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    return value === 'ru' || value === 'en' ? value : null
  } catch {
    return null
  }
}

/** The language of the first open: the saved choice, else the language of the browser. */
export const initialLang = (): Lang => saved() ?? languageOf(typeof navigator === 'undefined' ? '' : navigator.language)

let current: Lang = 'en'
const listeners = new Set<(lang: Lang) => void>()

export const lang = (): Lang => current

/** The word `key` in the current language, `{name}` holes filled from `values`. */
export function t(key: Key, values: Record<string, string | number> = {}): string {
  return dictionary[current][key].replace(/\{(\w+)\}/g, (hole, name: string) => (name in values ? String(values[name]) : hole))
}

/** The format of numbers of the current language. */
export const numberFormat = (): Intl.NumberFormat => new Intl.NumberFormat(current === 'ru' ? 'ru-RU' : 'en-US')

const ATTRIBUTES = { 'aria-label': 'aria-label', title: 'title', placeholder: 'placeholder', tip: 'data-tip', keys: 'data-keys' } as const
const ATTRIBUTE_SELECTOR = Object.keys(ATTRIBUTES).map((name) => `[data-i18n-${name}]`).join(',')

/** Writes the words of the current language into everything of `root` that names a key. */
export function applyDom(root: ParentNode = document): void {
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n]')) el.textContent = t(el.dataset.i18n as Key)
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n-html]')) el.innerHTML = t(el.dataset.i18nHtml as Key)
  for (const el of root.querySelectorAll<HTMLElement>(ATTRIBUTE_SELECTOR))
    for (const [name, target] of Object.entries(ATTRIBUTES)) {
      const key = el.getAttribute(`data-i18n-${name}`)
      if (key) el.setAttribute(target, t(key as Key))
    }
  document.title = t('title')
}

/** Switches the language: the page says it in `lang`, the words are rewritten, the listeners redraw what is made in code. */
export function setLang(next: Lang, { remember = true }: { remember?: boolean } = {}): void {
  current = next
  document.documentElement.lang = next
  if (remember) {
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // storage is not available: the choice lasts until the page is closed
    }
  }
  applyDom()
  for (const fn of listeners) fn(next)
}

/** Calls `fn` after every switch of the language (not for the first one: the page draws itself in its language at once). */
export function onLang(fn: (lang: Lang) => void): void {
  listeners.add(fn)
}
