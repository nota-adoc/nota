/**
 * Everything the extension shows in words, in Russian and in English: the strip and the tree of a tab, the remarks of the panel
 * «Проблемы», the screen «не открылся». The strings of the panel and of the windows are in `@nota-adoc/react`. A language code
 * that starts with `ru` is Russian, any other is English (this is a copy of `pickLocale` of that package: the host must not
 * take React into its bundle).
 */
export type Locale = 'ru' | 'en'

export function pickLocale(language: string | undefined | null): Locale {
  return /^ru(?:$|[-_])/i.test((language ?? '').trim()) ? 'ru' : 'en'
}

/**
 * The language by the setting `nota.language`: `ru` and `en` as they are, `auto` (the language of VS Code, the
 * default) by `pickLocale`; anything else, an unset setting or a broken value of settings.json, works as `auto`.
 */
export function resolveLocale(setting: unknown, vscodeLanguage: string | undefined | null): Locale {
  if (setting === 'en') return 'en'
  if (setting === 'ru') return 'ru'
  return pickLocale(vscodeLanguage)
}

export interface Strings {
  loading: string
  documentLabel: string
  sourceLabel: string
  hide: string
  bigGo: string
  stale: string
  crash: string
  /** `1,4 МБ`, `1.4 MB`. */
  size(bytes: number): string
  big(bytes: number): string
  linkTip(mac: boolean): string
  fileNotFound: string
  linkRefused: string
  tree: {
    label: string
    head: string
    /** `1 замечание`, `2 замечания`. */
    remarks(n: number): string
    inSection(n: string): string
    inSectionGo(n: string): string
    none: string
    /** Alt+↑ at the first section of its level, Alt+↓ at the last, and a place a section or a block cannot be put in. */
    first: string
    last: string
    cannotMove: string
    /** The column «Разделы» beside the text: the arrow of a section with subsections, as the title and for a screen reader. */
    collapse: string
    expand: string
    collapseOf(name: string): string
    expandOf(name: string): string
  }
  /** The badge «i» of the header of the page, its card and the islands of the header that is open for editing. */
  pageMeta: {
    label: string
    version: string
    updated: string
    link: string
    empty: string
    edit: string
    note: string
    noteTail: string
    noteBody: string
    toc: string
    /** The caption over the attributes of the header in the card. */
    params: string
    collapse: string
  }
  /** The capsules over the document, their cards and hints. */
  isles: {
    sections: string
    remarks: string
    /** the hint and the `aria-label` of the round capsule with the gear. */
    settings: string
    insertBlock: string
    paragraphStyle: string
    /** The note of a item of «Текст ⌄» that skips a level. */
    skipsLevel: string
    allTools: string
    formatting: string
    insertFast: string
    text: string
    heading(level: number): string
    textMode: string
    /** `Предупреждение · 1 из 2`. */
    remarkTitle(severity: string, at: number, of: number): string
    next: string
    close: string
    remarkCard: string
  }
  remark: {
    unresolved(id: string): string
    skipped(expected: string, got: string): string
    /** The expected level is the first section level: nothing larger exists. */
    skippedFirst(expected: string, got: string): string
    severity: Record<'error' | 'warning' | 'info', string>
  }
  failed: {
    title: string
    timeout: string
    error: string
    body: string
    details: string
    open: string
    foot(file: string): string
  }
}

const mb = (bytes: number): string => (bytes / 1048576).toFixed(1)

const ru: Strings = {
  loading: 'Открываю визуальный редактор…',
  documentLabel: 'Документ',
  sourceLabel: 'Текст документа',
  hide: 'Скрыть',
  bigGo: 'Всё равно открыть визуально',
  stale:
    'Файл изменили в другом редакторе, пока вы набирали: показана его текущая версия, последние набранные символы не записаны.',
  crash: 'Во вкладке произошла ошибка: документ показан заново по файлу.',
  size: (bytes) => `${mb(bytes).replace('.', ',')} МБ`,
  big: (bytes) =>
    `Файл больше 1 МБ (${mb(bytes).replace('.', ',')} МБ), поэтому он открыт в режиме «Текст»: визуальный редактор на таком файле открывается долго и отвечает с задержкой.`,
  linkTip: (mac) => `${mac ? 'Cmd' : 'Ctrl'}+клик — открыть`,
  fileNotFound: 'Файл по ссылке не найден',
  linkRefused: 'Эту ссылку нельзя открыть из редактора',
  tree: {
    label: 'Разделы документа',
    head: 'Разделы',
    remarks: (n) => {
      const mod10 = n % 10
      const mod100 = n % 100
      const word =
        mod10 === 1 && mod100 !== 11 ? 'замечание' : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? 'замечания' : 'замечаний'
      return `${n} ${word}`
    },
    inSection: (n) => `${n} в разделе`,
    inSectionGo: (n) => `${n} в разделе: перейти к первому`,
    none: 'Замечаний нет',
    first: 'Раздел и так первый на своём уровне',
    last: 'Раздел и так последний на своём уровне',
    cannotMove: 'Сюда блок перенести нельзя',
    collapse: 'Свернуть',
    expand: 'Развернуть',
    collapseOf: (name) => `Свернуть раздел «${name}»`,
    expandOf: (name) => `Развернуть раздел «${name}»`,
  },
  pageMeta: {
    label: 'Сведения о странице',
    version: 'Версия',
    updated: 'Обновлено',
    link: 'Open in Confluence',
    empty: 'В шапке нет названия, версии и ссылки',
    edit: 'Править шапку',
    note: 'Шапка страницы — правится как текст',
    noteTail: 'Шапка страницы, после заголовка',
    noteBody: 'Шапка страницы, после ссылки',
    toc: 'Оглавление страницы',
    params: 'Параметры страницы',
    collapse: 'Свернуть',
  },
  isles: {
    sections: 'Разделы',
    remarks: 'Замечания',
    settings: 'Настройки Nota',
    insertBlock: 'Вставить блок',
    paragraphStyle: 'Стиль абзаца',
    skipsLevel: 'пропускает уровень',
    allTools: 'Все инструменты',
    formatting: 'Форматирование',
    insertFast: 'Быстрее — «/» в пустой строке',
    text: 'Текст',
    heading: (n) => `Заголовок ${n}`,
    textMode: 'Режим «Текст»',
    remarkTitle: (severity, at, of) => `${severity} · ${at} из ${of}`,
    next: 'Следующее',
    close: 'Закрыть',
    remarkCard: 'Замечание',
  },
  remark: {
    unresolved: (id) => `Ссылка ведёт на «${id}», а такого раздела или якоря в документе нет`,
    skipped: (expected, got) => `Заголовок пропускает уровень: ожидался Заголовок ${expected} или крупнее, а здесь Заголовок ${got}`,
    skippedFirst: (expected, got) => `Заголовок пропускает уровень: ожидался Заголовок ${expected}, а здесь Заголовок ${got}`,
    severity: { error: 'Ошибка', warning: 'Предупреждение', info: 'Сведения' },
  },
  failed: {
    title: 'Визуальный редактор не открылся',
    timeout: 'Вкладка не ответила за 10 секунд.',
    error: 'При запуске вкладки произошла ошибка.',
    body: 'Файл не изменён: его можно открыть и править в текстовом редакторе VS Code.',
    details: 'Подробности ошибки',
    open: 'Открыть в текстовом редакторе',
    foot: (file) => `Чтобы попробовать ещё раз, закройте вкладку и откройте ${file} снова.`,
  },
}

const en: Strings = {
  loading: 'Opening the visual editor…',
  documentLabel: 'Document',
  sourceLabel: 'Document text',
  hide: 'Hide',
  bigGo: 'Open visually anyway',
  stale:
    'The file was changed in another editor while you were typing: its current version is shown, the last characters you typed were not saved.',
  crash: 'The tab failed: the document is shown again from the file.',
  size: (bytes) => `${mb(bytes)} MB`,
  big: (bytes) =>
    `The file is larger than 1 MB (${mb(bytes)} MB), so it is open in Text mode: the visual editor is slow to open and to respond on a file this size.`,
  linkTip: (mac) => `${mac ? 'Cmd' : 'Ctrl'}+click to open`,
  fileNotFound: 'The linked file was not found',
  linkRefused: "This link can't be opened from the editor",
  tree: {
    label: 'Sections of the document',
    head: 'Sections',
    remarks: (n) => `${n} ${n === 1 ? 'remark' : 'remarks'}`,
    inSection: (n) => `${n} in the section`,
    inSectionGo: (n) => `${n} in the section: go to the first`,
    none: 'No remarks',
    first: 'The section is already the first at its level',
    last: 'The section is already the last at its level',
    cannotMove: "The block can't be moved here",
    collapse: 'Collapse',
    expand: 'Expand',
    collapseOf: (name) => `Collapse section "${name}"`,
    expandOf: (name) => `Expand section "${name}"`,
  },
  pageMeta: {
    label: 'Page info',
    version: 'Version',
    updated: 'Updated',
    link: 'Open in Confluence',
    empty: 'The header has no title, version or link',
    edit: 'Edit header',
    note: 'Page header — edited as text',
    noteTail: 'Page header, after the title',
    noteBody: 'Page header, after the link',
    toc: 'Table of contents',
    params: 'Page settings',
    collapse: 'Collapse',
  },
  isles: {
    sections: 'Sections',
    remarks: 'Remarks',
    settings: 'Nota settings',
    insertBlock: 'Insert block',
    paragraphStyle: 'Paragraph style',
    skipsLevel: 'skips a level',
    allTools: 'All tools',
    formatting: 'Formatting',
    insertFast: 'Faster: «/» in an empty line',
    text: 'Text',
    heading: (n) => `Heading ${n}`,
    textMode: 'Text mode',
    remarkTitle: (severity, at, of) => `${severity} · ${at} of ${of}`,
    next: 'Next',
    close: 'Close',
    remarkCard: 'Remark',
  },
  remark: {
    unresolved: (id) => `The link goes to "${id}", but there is no such section or anchor in the document`,
    skipped: (expected, got) => `The heading skips a level: Heading ${expected} or larger was expected, this is Heading ${got}`,
    skippedFirst: (expected, got) => `The heading skips a level: Heading ${expected} was expected, this is Heading ${got}`,
    severity: { error: 'Error', warning: 'Warning', info: 'Information' },
  },
  failed: {
    title: 'The visual editor did not open',
    timeout: 'The tab did not answer in 10 seconds.',
    error: 'The tab failed to start.',
    body: 'The file is not changed: you can open and edit it in the text editor of VS Code.',
    details: 'Details of the error',
    open: 'Open in the text editor',
    foot: (file) => `To try again, close the tab and open ${file} again.`,
  },
}

export const strings: Readonly<Record<Locale, Strings>> = { ru, en }

/** The phrases CodeMirror says itself (the panel of the remarks, folds, completion), by the English text; English needs none. */
export const phrases: Readonly<Record<Locale, Readonly<Record<string, string>>>> = {
  ru: {
    Diagnostics: 'Замечания',
    'No diagnostics': 'Замечаний нет',
    close: 'закрыть',
    Completions: 'Подсказки',
    'folded code': 'свёрнутый код',
    unfold: 'развернуть',
    'Control character': 'Управляющий символ',
    to: 'до',
  },
  en: {},
}
