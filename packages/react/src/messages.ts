import type { Locale } from './locale.js'

/** Every string the components of the package show, and the texts of the refusals of the editor by their codes. */
export interface Messages {
  toolbar: string
  bubble: string
  paragraphStyle: string
  text: string
  /** `Heading 2`, `Заголовок 2`. */
  heading(level: number): string
  bold: string
  italic: string
  monospace: string
  strikethrough: string
  highlight: string
  link: string
  textColor: string
  fill: string
  undo: string
  redo: string
  bulletedList: string
  numberedList: string
  checklist: string
  /** The label of the checkbox of an item. */
  checkItem: string
  /** The panel over an admonition. */
  admonitionType: string
  /** The five types of admonition, by the word in the file. */
  admonitions: Readonly<Record<'NOTE' | 'TIP' | 'IMPORTANT' | 'WARNING' | 'CAUTION', string>>
  /** The title of a collapsible block that has none. */
  details: string
  /** The button «Вставить» of the toolbar, and its hint. */
  insert: string
  insertHint: string
  /** The header of the menu of «/», and what it says when nothing matches. */
  slashTitle: string
  slashEmpty: string
  /** The blocks the menus put in (the headings and lists are named as in the toolbar). */
  blocks: Readonly<Record<'table' | 'code' | 'mermaid' | 'admonition' | 'collapsible' | 'image', string>>
  /** The one-line explanations of the entries of the menus, by the id of the block. */
  blockHints: Readonly<
    Record<'heading2' | 'heading3' | 'heading4' | 'heading5' | 'heading6' | 'unordered' | 'ordered' | 'checklist' | 'table' | 'code' | 'mermaid' | 'admonition' | 'collapsible' | 'image', string>
  >
  /** The field «Язык» of the panel over code, and the names of the languages by id. */
  language: string
  languages: Readonly<Record<string, string>>
  /** The words of the editor around images and islands. */
  captionPlaceholder: string
  imageMissing(path: string): string
  imageRemote: string
  islandNote: string
  anchorTip: string
  islandUnsaved: string
  diagramTitle: string
  diagramHint: string
  diagramEditHint: string
  diagramDrawing: string
  diagramKept: string
  diagramFailed: string
  diagramFailedHint: string
  diagramFailedBar: string
  diagramNoRenderer: string
  diagramNoRendererHint: string
  /** The code of the flowchart that the block «Mermaid» puts in. */
  diagramSample: string
  /** The layer over a table: hints of the grips and of the border between columns, the mark at the least width. */
  gripColumn: string
  gripRow: string
  gripBorder: string
  widthLimit: string
  tableScroll: string
  gripColumns: string
  gripRows: string
  /** The bar of three buttons at a grip. */
  barColBefore: string
  barColAfter: string
  barColDelete: string
  barColsDelete: string
  barRowBefore: string
  barRowAfter: string
  barRowDelete: string
  barRowsDelete: string
  widthFrame: string
  /** The window that picks the file of an image. */
  imagePick: string
  imageSearch: string
  imageList: string
  noImages: string
  /** The note in the mode of the source, where the buttons are off. */
  textModeNote: string
  noColor: string
  colors: Readonly<Record<string, string>>
  noFill: string
  fills: Readonly<Record<string, string>>
  /** The window of the fill of cells: its title (`n`: how many cells), the swatches, the hint of the button and the footers. */
  cellFill: string
  cellFillMany(n: number): string
  noCellFill: string
  cellFills: Readonly<Record<string, string>>
  /** `Заливка ячейки: Голубая`. */
  cellFillTip(color: string): string
  /** The name of the fill when the selected cells differ (`Разная`). */
  cellFillMixed: string
  /** The label of the row of colours (the colour of the text; the fill is `fill`). */
  rowColor: string
  /** The row of colours that stands in place of a row: the label of its button «‹». */
  backToTable: string
  backToBar: string
  linkTitle: string
  linkKind: string
  url: string
  section: string
  otherFile: string
  urlLabel: string
  urlPlaceholder: string
  sectionList: string
  noSections: string
  fileSearch: string
  fileList: string
  noFiles: string
  /** `Ещё 12 — уточните поиск`. */
  moreFiles(n: number): string
  linkHint: string
  apply: string
  removeLink: string
  emptyTarget: string
  forbiddenTarget: string
  noTarget: string
  /** the capsule of selected cells: its names, the lines of its popups, the row of the alignment. */
  cellBar: {
    label: string
    moreLabel: string
    more: string
    moreText(names: string): string
    merge: string
    mergeText: string
    split: string
    splitText: string
    align: string
    alignText: string
    fillName: string
    fillText: string
    head: string
    headText: string
    clear: string
    clearText: string
    rowDel(n: number): string
    rowDelText(from: number, to: number, n: number): string
    colDel(n: number): string
    colDelText(from: number, to: number, n: number): string
    horizontal: string
    vertical: string
    left: string
    center: string
    right: string
    top: string
    middle: string
    bottom: string
    mixed: string
    /** `По центру · снизу`. */
    both(h: string, v: string): string
  }
  /** The panel over a table: its name, the mark of a table in a cell, and the hints of its nine buttons. */
  tableBar: {
    label: string
    level(n: number): string
    levelHint(n: number): string
    rowAdd: string
    colAdd: string
    rowDel: string
    colDel: string
    rowDelMany(n: number): string
    colDelMany(n: number): string
    merge: string
    split: string
    head: string
    nest: string
    cellFill: string
    remove: string
    removeNested: string
  }
  /** The popups of the buttons of the capsule of tools: a line of what the button does (the name is the label of the button), the notes by the keys. */
  tips: {
    plus: string
    /** What stands by the key «/». */
    plusNote: string
    style: string
    styleNote: string
    bold: string
    italic: string
    mono: string
    strike: string
    hl: string
    color: string
    fill: string
    link: string
    ul: string
    ulNote: string
    ol: string
    olNote: string
    check: string
    more: string
    moreOpen: string
    rowAdd: string
    colAdd: string
    rowDel: string
    colDel: string
    mergeName: string
    merge: string
    mergeNote: string
    splitName: string
    split: string
    cellFill: string
    head: string
    removeName: string
    remove: string
    removeNestedName: string
    removeNested: string
    nest: string
    levelName: string
    level(n: number): string
    /** Why a button is dimmed: the cursor is on a plate; the block cannot be a list. */
    offPlate: string
    /** Why a button is dimmed: the cursor is in the text of a cell that is shown as text. */
    offCell: string
    offList: string
    offStyle: string
    /** why a heading, a list or the paragraph style is dimmed in a table cell. */
    offCellHeading: string
    offCellList: string
    offCellStyle: string
  }
  /** The handle of a block: its hint, its menu, the fields of the caption and of the anchor. */
  blockHandle: {
    tip: string
    menu: string
    caption: string
    title: string
    anchor: string
    deleteBlock: string
    deleteSection: string
    captionLabel: string
    titleLabel: string
    anchorLabel: string
    save: string
    anchorBad: string
    anchorDup: string
  }
  /** The texts of the refusals by their codes. */
  reject: Readonly<Record<string, string>>
}

const ru: Messages = {
  toolbar: 'Форматирование',
  bubble: 'Отметки выделенного текста',
  paragraphStyle: 'Стиль абзаца',
  text: 'Текст',
  heading: (n) => `Заголовок ${n}`,
  bold: 'Жирный',
  italic: 'Курсив',
  monospace: 'Моноширинный',
  strikethrough: 'Зачёркнутый',
  highlight: 'Выделение',
  link: 'Ссылка',
  textColor: 'Цвет текста',
  fill: 'Заливка',
  undo: 'Отменить',
  redo: 'Повторить',
  bulletedList: 'Маркированный список',
  numberedList: 'Нумерованный список',
  checklist: 'Чек-лист',
  checkItem: 'Отметить пункт',
  admonitionType: 'Тип примечания',
  admonitions: { NOTE: 'Примечание', TIP: 'Совет', IMPORTANT: 'Важно', WARNING: 'Внимание', CAUTION: 'Осторожно' },
  details: 'Подробнее',
  insert: 'Вставить',
  insertHint: 'Вставить таблицу, код, картинку… Быстрее — «/» в пустой строке',
  slashTitle: 'Вставить блок',
  slashEmpty: 'Ничего не найдено. Esc — оставить «/» обычным текстом',
  blocks: { table: 'Таблица', code: 'Код', mermaid: 'Mermaid', admonition: 'Предупреждение', collapsible: 'Раскрывающийся блок', image: 'Картинка' },
  blockHints: {
    heading2: 'Раздел документа',
    heading3: 'Подраздел',
    heading4: 'Уровень 4',
    heading5: 'Уровень 5',
    heading6: 'Уровень 6',
    unordered: 'Пункты с точками',
    ordered: 'Пункты по порядку',
    checklist: 'Пункты с флажками',
    table: 'Ряды и колонки',
    code: 'С подсветкой',
    mermaid: 'Схема из текста',
    admonition: 'Примечание, совет, внимание…',
    collapsible: 'Скрытые подробности',
    image: 'С подписью',
  },
  language: 'Язык',
  languages: {
    text: 'Текст',
    bash: 'Bash',
    css: 'CSS',
    html: 'HTML',
    java: 'Java',
    javascript: 'JavaScript',
    json: 'JSON',
    python: 'Python',
    sql: 'SQL',
    typescript: 'TypeScript',
    xml: 'XML',
    yaml: 'YAML',
  },
  captionPlaceholder: 'Подпись картинки',
  imageMissing: (path) => `Нет файла ${path}`,
  imageRemote: 'Картинка из сети не показывается',
  islandNote: 'Как в файле — правится как текст',
  anchorTip: 'Якорь · правится в режиме «Текст»',
  islandUnsaved: 'Не записано: такой текст меняет блоки вокруг',
  diagramTitle: 'Mermaid',
  diagramHint: 'Щёлкните, чтобы править код',
  diagramEditHint: 'Картинка обновится после паузы · Esc — только картинка',
  diagramDrawing: 'Рисую схему…',
  diagramKept: 'Схема не разобрана. Показана последняя удачная картинка.',
  diagramFailed: 'Схему не удалось нарисовать',
  diagramFailedHint: 'Щёлкните, чтобы править код',
  diagramFailedBar: 'Ошибка в коде схемы',
  diagramNoRenderer: 'Схемы не рисуются: рисовальщик не загрузился',
  diagramNoRendererHint: 'Код схемы можно править. Чтобы попробовать ещё раз, закройте вкладку и откройте файл снова.',
  diagramSample: 'flowchart LR\nA[Начало] --> B[Шаг]\nB --> C(Готово)',
  gripColumn: 'Колонка {n}',
  gripRow: 'Ряд {n}',
  gripColumns: 'Колонки {a}–{b}',
  gripRows: 'Ряды {a}–{b}',
  barColBefore: 'Добавить колонку слева',
  barColAfter: 'Добавить колонку справа',
  barColDelete: 'Удалить колонку',
  barColsDelete: 'Удалить колонки: {n}',
  barRowBefore: 'Добавить ряд выше',
  barRowAfter: 'Добавить ряд ниже',
  barRowDelete: 'Удалить ряд',
  barRowsDelete: 'Удалить ряды: {n}',
  gripBorder: 'Ширина колонок: тяните · двойной щелчок — поровну',
  widthLimit: 'Минимальная ширина',
  tableScroll: 'Прокрутка таблицы по горизонтали',
  widthFrame: 'Ширина рамки',
  imagePick: 'Выберите картинку',
  imageSearch: 'Поиск картинки',
  imageList: 'Картинки',
  noImages: 'В рабочей папке нет картинок',
  textModeNote: 'Режим «Текст»: правьте разметку AsciiDoc, «Визуально» покажет результат',
  noColor: 'Без цвета',
  colors: {
    'hl-red': 'Красный',
    'hl-orange': 'Оранжевый',
    'hl-green': 'Зелёный',
    'hl-teal': 'Бирюзовый',
    'hl-blue': 'Синий',
    'hl-purple': 'Фиолетовый',
    'hl-pink': 'Розовый',
    'hl-gray': 'Серый',
  },
  noFill: 'Без заливки',
  fills: {
    'hl-yellow-bg': 'Жёлтая',
    'hl-red-bg': 'Красная',
    'hl-orange-bg': 'Оранжевая',
    'hl-green-bg': 'Зелёная',
    'hl-teal-bg': 'Бирюзовая',
    'hl-blue-bg': 'Голубая',
    'hl-pink-bg': 'Розовая',
    'hl-purple-bg': 'Фиолетовая',
    'hl-gray-bg': 'Серая',
  },
  cellFill: 'Заливка ячейки',
  cellFillMany: (n) => `Заливка ячеек: ${n}`,
  noCellFill: 'Без заливки ячейки',
  cellFills: {
    'cell-yellow': 'Жёлтая',
    'cell-green': 'Зелёная',
    'cell-blue': 'Голубая',
    'cell-pink': 'Розовая',
    'cell-purple': 'Фиолетовая',
    'cell-gray': 'Серая',
  },
  cellFillTip: (color) => `Заливка ячейки: ${color}`,
  cellFillMixed: 'Разная',
  rowColor: 'Цвет',
  backToTable: 'Вернуть ряд «Таблица»',
  backToBar: 'Вернуть кнопки панели',
  linkTitle: 'Ссылка',
  linkKind: 'Куда ведёт ссылка',
  url: 'Адрес',
  section: 'Раздел документа',
  otherFile: 'Другой файл',
  urlLabel: 'Адрес ссылки',
  urlPlaceholder: 'https://example.org/страница',
  sectionList: 'Разделы документа',
  noSections: 'В документе нет разделов с id.',
  fileSearch: 'Поиск файла',
  fileList: 'Файлы .adoc',
  noFiles: 'Файлов нет.',
  moreFiles: (n) => `Ещё ${n} — уточните поиск`,
  linkHint: 'Enter — применить · Esc — закрыть',
  apply: 'Применить',
  removeLink: 'Убрать ссылку',
  emptyTarget: 'Введите адрес ссылки.',
  forbiddenTarget: 'Этот адрес для ссылки не подходит.',
  noTarget: 'Выберите, куда ведёт ссылка.',
  cellBar: {
    label: 'Действия с ячейками',
    moreLabel: 'Ещё действия с ячейками',
    more: 'Ещё',
    moreText: (names) => `Остальные действия с ячейками: ${names}.`,
    merge: 'Объединить ячейки',
    mergeText: 'Сливает выделенные ячейки в одну. Текст остаётся из левой верхней ячейки.',
    split: 'Разделить ячейки',
    splitText: 'Делит объединённые ячейки выделения на отдельные. Заливка переходит на все части.',
    align: 'Выравнивание',
    alignText: 'Ставит текст выделенных ячеек слева, по центру или справа и сверху, посередине или снизу.',
    fillName: 'Заливка ячеек',
    fillText: 'Открывает образцы фона для всех выделенных ячеек.',
    head: 'Первый ряд — шапка',
    headText: 'Делает первый ряд таблицы шапкой. Второе нажатие вернёт его в обычный ряд.',
    clear: 'Очистить ячейки',
    clearText: 'Стирает текст в выделенных ячейках. Заливка, выравнивание и объединение остаются.',
    rowDel: (n) => (n > 1 ? `Удалить ряды: ${n}` : 'Удалить ряд'),
    rowDelText: (a, b, n) => (n > 1 ? `Удаляет ряды ${a}–${b} вместе с текстом в их ячейках.` : `Удаляет ряд ${a} вместе с текстом в его ячейках.`),
    colDel: (n) => (n > 1 ? `Удалить колонки: ${n}` : 'Удалить колонку'),
    colDelText: (a, b, n) => (n > 1 ? `Удаляет колонки ${a}–${b} вместе с текстом в их ячейках.` : `Удаляет колонку ${a} вместе с текстом в её ячейках.`),
    horizontal: 'По горизонтали',
    vertical: 'По вертикали',
    left: 'Слева',
    center: 'По центру',
    right: 'Справа',
    top: 'Сверху',
    middle: 'Посередине',
    bottom: 'Снизу',
    mixed: 'Разное',
    both: (h, v) => `${h} · ${v.toLowerCase()}`,
  },
  tableBar: {
    label: 'Таблица',
    level: (n) => `уровень ${n}`,
    levelHint: (n) => `Курсор во вложенной таблице уровня ${n}`,
    rowAdd: 'Добавить ряд ниже',
    colAdd: 'Добавить колонку справа',
    rowDel: 'Удалить ряд',
    colDel: 'Удалить колонку',
    rowDelMany: (n) => `Удалить ряды: ${n}`,
    colDelMany: (n) => `Удалить колонки: ${n}`,
    merge: 'Объединить ячейки · Shift+щелчок по второй ячейке',
    split: 'Разделить объединённую ячейку',
    head: 'Первый ряд — шапка',
    nest: 'Вложить таблицу в эту ячейку',
    cellFill: 'Заливка ячейки',
    remove: 'Удалить таблицу',
    removeNested: 'Удалить вложенную таблицу',
  },
  tips: {
    plus: 'Заголовки, списки, таблица, код, Mermaid, предупреждение, раскрывающийся блок, картинка. Блок встанет на место пустой строки с курсором или после блока с курсором.',
    plusNote: 'в пустой строке — то же самое',
    style: 'Делает абзац с курсором обычным текстом или заголовком от 2 до 6. Выделять текст не нужно.',
    styleNote: 'текст · заг. 2–6',
    bold: 'Делает выделенный текст жирным, второе нажатие снимает. Без выделения жирным пойдёт то, что наберёте дальше.',
    italic: 'Делает выделенный текст курсивом, второе нажатие снимает. Без выделения курсивом пойдёт то, что наберёте дальше.',
    mono: 'Показывает выделенный текст как код, второе нажатие снимает. Без выделения так пойдёт то, что наберёте дальше.',
    strike: 'Зачёркивает выделенный текст, второе нажатие снимает. Без выделения зачёркнутым пойдёт то, что наберёте дальше.',
    hl: 'Подсвечивает выделенный текст маркером, второе нажатие снимает. Без выделения подсветка пойдёт на то, что наберёте дальше.',
    color: 'Открывает образцы цвета букв для выделенного текста. Без выделения окно не откроется: сначала выделите текст.',
    fill: 'Открывает образцы фона под выделенным текстом. Без выделения окно не откроется: сначала выделите текст.',
    link: 'Делает выделенный текст ссылкой на адрес, раздел документа или другой документ AsciiDoc. Курсор внутри ссылки — меняет, куда она ведёт. Без выделения сначала выделите текст.',
    ul: 'Делает абзацы с курсором или в выделении пунктами с точками. Второе нажатие вернёт их в абзацы.',
    ulNote: 'и пробел в пустом абзаце — то же самое',
    ol: 'Делает абзацы с курсором или в выделении пунктами по порядку. Второе нажатие вернёт их в абзацы.',
    olNote: 'и пробел в пустом абзаце — то же самое',
    check: 'Делает абзацы с курсором или в выделении пунктами с флажками. Второе нажатие вернёт их в абзацы.',
    more: 'Показывает остальные кнопки вторым рядом.',
    moreOpen: 'Прячет второй ряд кнопок.',
    rowAdd: 'Добавляет пустой ряд под рядом с курсором.',
    colAdd: 'Добавляет пустую колонку справа от колонки с курсором.',
    rowDel: 'Удаляет ряд с курсором вместе с текстом в его ячейках.',
    colDel: 'Удаляет колонку с курсором вместе с текстом в её ячейках.',
    mergeName: 'Объединить ячейки',
    merge: 'Сливает выделенные ячейки в одну.',
    mergeNote: 'и щелчок по второй ячейке — выделить ячейки',
    splitName: 'Разделить объединённую ячейку',
    split: 'Делит объединённую ячейку с курсором обратно на отдельные ячейки.',
    cellFill: 'Открывает образцы фона для ячейки с курсором или для всех выделенных ячеек.',
    head: 'Делает первый ряд таблицы шапкой. Второе нажатие вернёт его в обычный ряд.',
    removeName: 'Удалить таблицу',
    remove: 'Удаляет всю таблицу с курсором вместе с её текстом.',
    removeNestedName: 'Удалить вложенную таблицу',
    removeNested: 'Удаляет вложенную таблицу с курсором. Внешняя таблица остаётся.',
    nest: 'Вставляет новую таблицу внутрь ячейки с курсором.',
    levelName: 'Вложенная таблица',
    level: (n) => `Курсор во вложенной таблице уровня ${n}.`,
    offPlate: 'Сейчас недоступно: курсор в плашке. Её правят в режиме «Текст».',
    offCell: 'Сейчас недоступно: ячейка показана как текст. Её разметку правят в режиме «Текст».',
    offList: 'Сейчас недоступно: в этом блоке список не поставить.',
    offStyle: 'Сейчас недоступно: стиль абзаца в этом блоке не меняется.',
    offCellHeading: 'Сейчас недоступно: в ячейке таблицы заголовок не поставить.',
    offCellList: 'Сейчас недоступно: в ячейке таблицы список не поставить.',
    offCellStyle: 'Сейчас недоступно: в ячейке таблицы стиль абзаца не меняется.',
  },
  blockHandle: {
    tip: 'Подпись, якорь, удаление блока',
    menu: 'Действия с блоком',
    caption: 'Подпись…',
    title: 'Заголовок блока…',
    anchor: 'Якорь…',
    deleteBlock: 'Удалить блок',
    deleteSection: 'Удалить раздел',
    captionLabel: 'Подпись блока',
    titleLabel: 'Заголовок блока',
    anchorLabel: 'Якорь блока — на него можно сослаться',
    save: 'Сохранить',
    anchorBad: 'Якорь — одно слово: буквы, цифры, «-» и «_», без пробелов',
    anchorDup: 'Такой якорь уже есть у другого блока',
  },
  reject: {
    'byte-order-mark': 'Правка сделала бы символ текста меткой порядка байтов файла (BOM): так нельзя',
    'bad-anchor': 'Якорь — одно слово: буквы, цифры, «-» и «_», без пробелов',
    'duplicate-anchor': 'Такой якорь уже есть у другого блока',
    'bad-caption': 'Такую подпись нельзя записать над блоком.',
    'last-row': 'Последний ряд таблицы остаётся. Чтобы убрать таблицу, нажмите «Удалить таблицу».',
    'last-column': 'Последняя колонка таблицы остаётся. Чтобы убрать таблицу, нажмите «Удалить таблицу».',
    'row-merged': 'Ячейка, объединённая по рядам, ушла бы вместе с рядом. Сначала разделите её.',
    'width-autowidth':
      'Ширину колонок этой таблицы не записать: у неё ширина по содержимому (%autowidth). Уберите %autowidth в режиме «Текст». Файл не изменён.',
    'width-attr':
      'Ширину колонок этой таблицы не записать: cols задан атрибутом {attr}. Правьте его в режиме «Текст». Файл не изменён.',
    'width-count':
      'Ширину колонок этой таблицы не записать: в cols указано колонок — {cols}, а в таблице их {table}. Поправьте cols в режиме «Текст». Файл не изменён.',
    'row-above-head': 'Выше шапки ряд не добавить: он стал бы шапкой. Добавьте ряд ниже.',
    'row-below-foot': 'Ниже итоговой строки ряд не добавить: он стал бы итоговой строкой. Добавьте ряд выше.',
    'cols-attr': 'Колонку не добавить и не удалить: число колонок задано атрибутом {attr}. Правьте таблицу в режиме «Текст». Файл не изменён.',
    'cols-count':
      'Колонку не добавить и не удалить: в cols указано колонок — {cols}, а в таблице их {table}. Поправьте cols в режиме «Текст». Файл не изменён.',
    'column-merged': 'Ячейка, объединённая по колонкам, ушла бы вместе с колонкой. Сначала разделите её.',
    'column-merged-all': 'Колонку нельзя выделить отдельно: в таблице есть ячейка, объединённая на всю её ширину. Сначала разделите её.',
    'row-merged-all': 'Ряд нельзя выделить отдельно: в таблице есть ячейка, объединённая на всю её высоту. Сначала разделите её.',
    'merge-select': 'Выделите две или больше соседних ячеек: щёлкните первую и Shift+щёлкните последнюю.',
    'merge-text': 'В объединяемых ячейках есть текст. Оставьте текст только в левой верхней ячейке.',
    'merge-head': 'Ячейки шапки не объединяются.',
    'merge-deep': 'Ячейки таблиц третьего и четвёртого уровня не объединяются: в AsciiDoc эти уровни записываются как CSV и DSV.',
    'split-single': 'Разделить можно только объединённую ячейку.',
    'cells-empty': 'Ячейки уже пусты.',
    'head-rowspan': 'В первом ряду есть ячейка, объединённая по рядам: шапка из него не получится.',
    'cell-has-table': 'В этой ячейке уже есть таблица.',
    'link-across-blocks': 'Ссылку можно поставить только на текст одного абзаца: выделите слова внутри одного абзаца.',
    'link-overlap': 'Выделение задевает ссылку лишь частью: выделите её целиком или текст рядом с ней.',
    'bad-target': 'Этот адрес для ссылки не подходит.',
    'empty-selection': 'Сначала выделите текст.',
    'no-link': 'Здесь нет ссылки.',
    'not-editable': 'Этот блок пока правится только в режиме «Текст».',
    'becomes-plate': 'С такими символами абзац стал бы списком или блоком кода: наберите их в режиме «Текст».',
    'break-in-heading': 'Заголовок — одна строка: перенос строки ставится в абзаце.',
    'document-title': 'Заголовок документа нельзя превратить в абзац или раздел.',
    'join-meta': 'Над блоком есть служебные строки (якорь, подпись, атрибуты): объединяйте блоки в режиме «Текст».',
    'inside-plate': 'Это место внутри блока, который редактор показывает плашкой: правьте его в режиме «Текст».',
    'inside-construct': 'Это место внутри разметки, которую визуальный редактор не правит: правьте её в режиме «Текст».',
    'island-unsaved': 'Правка островка не записана',
    'paste-images': 'Картинки из буфера не вставляются: их файлов нет рядом с документом. Остальной текст вставлен.',
    'paste-refused': 'Фрагмент не вставлен: в AsciiDoc он прочёлся бы иначе и задел бы соседние блоки. Файл не изменён. Cmd+Shift+V вставит его простым текстом.',
    'caption-one-line': 'Подпись — одна строка: перенос строки не нужен.',
    'bad-image': 'Этот путь для картинки не подходит.',
    'not-colorable': 'Цвет здесь не показывается: правьте разметку в режиме «Текст».',
    'invalid-role': 'Такого цвета нет.',
    collateral: 'Так набранный текст прочитался бы иначе и задел бы соседние блоки: наберите его в режиме «Текст».',
    'leading-blank': 'Без этой отметки пробел оказался бы в начале абзаца, а там он не пишется: наберите слово перед ним.',
    unstable: 'Так текст записать нельзя: разметка прочитается иначе. Правьте в режиме «Текст».',
    unwritable: 'Так текст записать нельзя: разметка прочитается иначе. Правьте в режиме «Текст».',
    'unknown-mark': 'Такой отметки нет.',
    'invalid-target': 'Это место для правки не подходит.',
    'invalid-range': 'Это место для правки не подходит.',
    'style-off': 'Заголовок здесь не ставится: в пункте списка, ячейке таблицы и предупреждении стиль абзаца не меняется.',
    'cell-text': 'В этой ячейке разметка показана как текст: отметки и ссылки ставятся в режиме «Текст». Файл не изменён.',
    'cell-bar': 'Знак «|» в ячейке со ссылкой или отметками ставится в режиме «Текст»: иначе ячейка покажется простым текстом. Файл не изменён.',
    'invalid-block': 'Этот блок для правки не подходит.',
    'invalid-span': 'Это место для правки не подходит.',
    'invalid-level': 'Такого уровня заголовка нет.',
    'bad-level': 'Такого уровня нет.',
    'item-start': 'Пункт делят внутри текста; новый пункт начинается в конце текста пункта.',
    'item-has-items': 'У пункта есть вложенные пункты: сначала перенесите или уберите их.',
    'list-middle': 'Пустой пункт посередине списка не становится абзацем.',
    'first-item': 'Первому пункту списка некуда сдвигаться: у него нет пункта выше.',
    'top-level-item': 'Пункт первого уровня выше не поднимается.',
    unsupported: 'Это пока правится только в режиме «Текст».',
    'fragment-invalid': 'Так текст записать нельзя: разметка прочитается иначе. Правьте в режиме «Текст».',
    'unexpected-kind': 'Эта правка не подходит.',
    'newline-in-text': 'Здесь нельзя ставить перенос строки.',
    'nesting-too-deep': 'Таблицы вкладываются не глубже четырёх уровней.',
    'cell-fill-refused': 'Эту ячейку не залить: метка заливки была бы видна в тексте ячейки.',
  },
}

const en: Messages = {
  toolbar: 'Formatting',
  bubble: 'Marks of the selected text',
  paragraphStyle: 'Paragraph style',
  text: 'Text',
  heading: (n) => `Heading ${n}`,
  bold: 'Bold',
  italic: 'Italic',
  monospace: 'Monospace',
  strikethrough: 'Strikethrough',
  highlight: 'Highlight',
  link: 'Link',
  textColor: 'Text color',
  fill: 'Fill',
  undo: 'Undo',
  redo: 'Redo',
  bulletedList: 'Bulleted list',
  numberedList: 'Numbered list',
  checklist: 'Checklist',
  checkItem: 'Check item',
  admonitionType: 'Callout type',
  admonitions: { NOTE: 'Note', TIP: 'Tip', IMPORTANT: 'Important', WARNING: 'Warning', CAUTION: 'Caution' },
  details: 'Details',
  insert: 'Insert',
  insertHint: 'Insert a table, code, an image… Faster: «/» in an empty line',
  slashTitle: 'Insert a block',
  slashEmpty: 'Nothing found. Esc — keep «/» as plain text',
  blocks: { table: 'Table', code: 'Code', mermaid: 'Mermaid', admonition: 'Admonition', collapsible: 'Collapsible block', image: 'Image' },
  blockHints: {
    heading2: 'A section of the document',
    heading3: 'A subsection',
    heading4: 'Level 4',
    heading5: 'Level 5',
    heading6: 'Level 6',
    unordered: 'Items with bullets',
    ordered: 'Items in order',
    checklist: 'Items with checkboxes',
    table: 'Rows and columns',
    code: 'With highlighting',
    mermaid: 'Diagram from text',
    admonition: 'A note, a tip, a warning…',
    collapsible: 'Hidden details',
    image: 'With a caption',
  },
  language: 'Language',
  languages: {
    text: 'Text',
    bash: 'Bash',
    css: 'CSS',
    html: 'HTML',
    java: 'Java',
    javascript: 'JavaScript',
    json: 'JSON',
    python: 'Python',
    sql: 'SQL',
    typescript: 'TypeScript',
    xml: 'XML',
    yaml: 'YAML',
  },
  captionPlaceholder: 'Image caption',
  imageMissing: (path) => `No file ${path}`,
  imageRemote: 'An image from the network is not shown',
  islandNote: 'As in the file — edited as text',
  anchorTip: 'Anchor · edited in the Text mode',
  islandUnsaved: 'Not saved: this text changes the blocks around it',
  diagramTitle: 'Mermaid',
  diagramHint: 'Click to edit the code',
  diagramEditHint: 'The picture updates after a pause · Esc — picture only',
  diagramDrawing: 'Drawing the diagram…',
  diagramKept: 'The diagram could not be parsed. The last good picture is shown.',
  diagramFailed: 'The diagram could not be drawn',
  diagramFailedHint: 'Click to edit the code',
  diagramFailedBar: 'Error in the diagram code',
  diagramNoRenderer: 'Diagrams are not drawn: the renderer did not load',
  diagramNoRendererHint: 'The code can be edited. To try again, close the tab and open the file again.',
  diagramSample: 'flowchart LR\nA[Start] --> B[Step]\nB --> C(Done)',
  gripColumn: 'Column {n}',
  gripRow: 'Row {n}',
  gripColumns: 'Columns {a}–{b}',
  gripRows: 'Rows {a}–{b}',
  barColBefore: 'Add a column to the left',
  barColAfter: 'Add a column to the right',
  barColDelete: 'Delete the column',
  barColsDelete: 'Delete columns: {n}',
  barRowBefore: 'Add a row above',
  barRowAfter: 'Add a row below',
  barRowDelete: 'Delete the row',
  barRowsDelete: 'Delete rows: {n}',
  gripBorder: 'Column width: drag · double-click — equal',
  widthLimit: 'Minimum width',
  tableScroll: 'Scroll the table sideways',
  widthFrame: 'Frame width',
  imagePick: 'Choose an image',
  imageSearch: 'Search for an image',
  imageList: 'Images',
  noImages: 'No images in the workspace',
  textModeNote: 'Text mode: edit the AsciiDoc markup, Visual will show the result',
  noColor: 'No color',
  colors: {
    'hl-red': 'Red',
    'hl-orange': 'Orange',
    'hl-green': 'Green',
    'hl-teal': 'Teal',
    'hl-blue': 'Blue',
    'hl-purple': 'Purple',
    'hl-pink': 'Pink',
    'hl-gray': 'Gray',
  },
  noFill: 'No fill',
  fills: {
    'hl-yellow-bg': 'Yellow',
    'hl-red-bg': 'Red',
    'hl-orange-bg': 'Orange',
    'hl-green-bg': 'Green',
    'hl-teal-bg': 'Teal',
    'hl-blue-bg': 'Blue',
    'hl-pink-bg': 'Pink',
    'hl-purple-bg': 'Purple',
    'hl-gray-bg': 'Gray',
  },
  cellFill: 'Cell fill',
  cellFillMany: (n) => `Cell fill: ${n} cells`,
  noCellFill: 'No cell fill',
  cellFills: {
    'cell-yellow': 'Yellow',
    'cell-green': 'Green',
    'cell-blue': 'Blue',
    'cell-pink': 'Pink',
    'cell-purple': 'Purple',
    'cell-gray': 'Gray',
  },
  cellFillTip: (color) => `Cell fill: ${color}`,
  cellFillMixed: 'Mixed',
  rowColor: 'Color',
  backToTable: 'Bring back the row «Table»',
  backToBar: 'Bring back the buttons of the panel',
  linkTitle: 'Link',
  linkKind: 'Where the link goes',
  url: 'URL',
  section: 'Section',
  otherFile: 'Other file',
  urlLabel: 'Link URL',
  urlPlaceholder: 'https://example.org/page',
  sectionList: 'Sections of the document',
  noSections: 'The document has no sections with an id.',
  fileSearch: 'Search for a file',
  fileList: '.adoc files',
  noFiles: 'No files.',
  moreFiles: (n) => `${n} more — narrow the search`,
  linkHint: 'Enter — apply · Esc — close',
  apply: 'Apply',
  removeLink: 'Remove link',
  emptyTarget: 'Enter the address of the link.',
  forbiddenTarget: 'This address cannot be used for a link.',
  noTarget: 'Choose where the link goes.',
  cellBar: {
    label: 'Cell actions',
    moreLabel: 'More cell actions',
    more: 'More',
    moreText: (names) => `The other cell actions: ${names}.`,
    merge: 'Merge cells',
    mergeText: 'Joins the selected cells into one. The text of the top left cell stays.',
    split: 'Split cells',
    splitText: 'Splits the merged cells of the selection into single cells. The fill goes to all the parts.',
    align: 'Alignment',
    alignText: 'Puts the text of the selected cells left, center or right, and top, middle or bottom.',
    fillName: 'Cell fill',
    fillText: 'Opens the background colors for all the selected cells.',
    head: 'First row is the head',
    headText: 'Makes the first row of the table the head. A second press turns it back into a plain row.',
    clear: 'Clear cells',
    clearText: 'Erases the text of the selected cells. The fill, the alignment and the merging stay.',
    rowDel: (n) => (n > 1 ? `Delete rows: ${n}` : 'Delete row'),
    rowDelText: (a, b, n) => (n > 1 ? `Deletes rows ${a}–${b} with the text of their cells.` : `Deletes row ${a} with the text of its cells.`),
    colDel: (n) => (n > 1 ? `Delete columns: ${n}` : 'Delete column'),
    colDelText: (a, b, n) => (n > 1 ? `Deletes columns ${a}–${b} with the text of their cells.` : `Deletes column ${a} with the text of its cells.`),
    horizontal: 'Horizontal',
    vertical: 'Vertical',
    left: 'Left',
    center: 'Center',
    right: 'Right',
    top: 'Top',
    middle: 'Middle',
    bottom: 'Bottom',
    mixed: 'Mixed',
    both: (h, v) => `${h} · ${v.toLowerCase()}`,
  },
  tableBar: {
    label: 'Table',
    level: (n) => `level ${n}`,
    levelHint: (n) => `The cursor is in a table of level ${n}`,
    rowAdd: 'Add a row below',
    colAdd: 'Add a column on the right',
    rowDel: 'Delete the row',
    colDel: 'Delete the column',
    rowDelMany: (n) => `Delete rows: ${n}`,
    colDelMany: (n) => `Delete columns: ${n}`,
    merge: 'Merge cells · Shift-click the second cell',
    split: 'Split the merged cell',
    head: 'First row is the head',
    nest: 'Put a table in this cell',
    cellFill: 'Cell fill',
    remove: 'Delete the table',
    removeNested: 'Delete the nested table',
  },
  tips: {
    plus: 'Headings, lists, a table, code, Mermaid, an admonition, a collapsible block, an image. The block takes the place of the empty line with the cursor or goes after the block with the cursor.',
    plusNote: 'in an empty line does the same',
    style: 'Makes the paragraph with the cursor plain text or a heading from 2 to 6. No need to select text.',
    styleNote: 'text · h2–h6',
    bold: 'Makes the selected text bold, press again to remove. With nothing selected, what you type next is bold.',
    italic: 'Makes the selected text italic, press again to remove. With nothing selected, what you type next is italic.',
    mono: 'Shows the selected text as code, press again to remove. With nothing selected, what you type next is monospace.',
    strike: 'Strikes the selected text through, press again to remove. With nothing selected, what you type next is struck through.',
    hl: 'Marks the selected text with a highlighter, press again to remove. With nothing selected, what you type next is highlighted.',
    color: 'Opens the colors for the letters of the selected text. With nothing selected the window does not open: select text first.',
    fill: 'Opens the background colors for the selected text. With nothing selected the window does not open: select text first.',
    link: 'Links the selected text to an address, a section of the document or another AsciiDoc document. With the cursor in a link, changes where it goes. With nothing selected, select text first.',
    ul: 'Turns the paragraphs with the cursor or in the selection into bulleted items. Press again to turn them back into paragraphs.',
    ulNote: 'and a space in an empty paragraph does the same',
    ol: 'Turns the paragraphs with the cursor or in the selection into numbered items. Press again to turn them back into paragraphs.',
    olNote: 'and a space in an empty paragraph does the same',
    check: 'Turns the paragraphs with the cursor or in the selection into items with checkboxes. Press again to turn them back into paragraphs.',
    more: 'Shows the other buttons in a second row.',
    moreOpen: 'Hides the second row of buttons.',
    rowAdd: 'Adds an empty row under the row with the cursor.',
    colAdd: 'Adds an empty column to the right of the column with the cursor.',
    rowDel: 'Deletes the row with the cursor and the text in its cells.',
    colDel: 'Deletes the column with the cursor and the text in its cells.',
    mergeName: 'Merge cells',
    merge: 'Merges the selected cells into one.',
    mergeNote: 'and a click on the second cell selects cells',
    splitName: 'Split the merged cell',
    split: 'Splits the merged cell with the cursor back into separate cells.',
    cellFill: 'Opens the background colors for the cell with the cursor or for all the selected cells.',
    head: 'Makes the first row of the table its head. Press again to make it a plain row.',
    removeName: 'Delete the table',
    remove: 'Deletes the whole table with the cursor and its text.',
    removeNestedName: 'Delete the nested table',
    removeNested: 'Deletes the nested table with the cursor. The outer table stays.',
    nest: 'Puts a new table inside the cell with the cursor.',
    levelName: 'Nested table',
    level: (n) => `The cursor is in a table of level ${n}.`,
    offPlate: 'Not available now: the cursor is on a plate. Plates are edited in Text mode.',
    offCell: 'Not available now: the cell is shown as text. Its markup is edited in Text mode.',
    offList: 'Not available now: this block cannot become a list.',
    offStyle: 'Not available now: the paragraph style cannot be changed in this block.',
    offCellHeading: 'Not available now: a heading cannot be set in a table cell.',
    offCellList: 'Not available now: a list cannot be set in a table cell.',
    offCellStyle: 'Not available now: the paragraph style cannot be changed in a table cell.',
  },
  blockHandle: {
    tip: 'Caption, anchor, delete block',
    menu: 'Block actions',
    caption: 'Caption…',
    title: 'Block title…',
    anchor: 'Anchor…',
    deleteBlock: 'Delete block',
    deleteSection: 'Delete section',
    captionLabel: 'Block caption',
    titleLabel: 'Block title',
    anchorLabel: 'Block anchor — links can point to it',
    save: 'Save',
    anchorBad: 'An anchor is one word: letters, digits, “-” and “_”, no spaces',
    anchorDup: 'Another block already has this anchor',
  },
  reject: {
    'byte-order-mark': 'The edit would make a character of the text the byte order mark of the file',
    'bad-anchor': 'An anchor is one word: letters, digits, “-” and “_”, no spaces',
    'duplicate-anchor': 'Another block already has this anchor',
    'bad-caption': 'That caption cannot be written over the block.',
    'last-row': 'The last row of the table stays. To remove the table, press “Delete the table”.',
    'last-column': 'The last column of the table stays. To remove the table, press “Delete the table”.',
    'row-merged': 'A cell merged over rows would go with the row. Split it first.',
    'width-autowidth':
      'The column widths of this table cannot be written: its width follows the content (%autowidth). Remove %autowidth in the “Text” mode. The file is unchanged.',
    'width-attr':
      'The column widths of this table cannot be written: cols is set by the attribute {attr}. Edit it in the “Text” mode. The file is unchanged.',
    'width-count':
      'The column widths of this table cannot be written: cols lists {cols} columns, the table has {table}. Fix cols in the “Text” mode. The file is unchanged.',
    'row-above-head': 'A row cannot be added above the head: it would become the head. Add the row below.',
    'row-below-foot': 'A row cannot be added below the footer: it would become the footer. Add the row above.',
    'cols-attr': 'A column cannot be added or deleted: the number of columns is set by the attribute {attr}. Edit the table in Text mode. The file is not changed.',
    'cols-count':
      'A column cannot be added or deleted: cols says {cols} columns, the table has {table}. Fix cols in Text mode. The file is not changed.',
    'column-merged': 'A cell merged over columns would go with the column. Split it first.',
    'column-merged-all': 'The column cannot be selected alone: a cell of the table is merged over its whole width. Split it first.',
    'row-merged-all': 'The row cannot be selected alone: a cell of the table is merged over its whole height. Split it first.',
    'merge-select': 'Select two or more cells next to each other: click the first and Shift-click the last.',
    'merge-text': 'The cells to merge have text. Leave the text in the top left cell only.',
    'merge-head': 'Cells of the head are not merged.',
    'merge-deep': 'Cells of tables of the third and fourth level are not merged: in AsciiDoc these levels are written as CSV and DSV.',
    'split-single': 'Only a merged cell can be split.',
    'cells-empty': 'The cells are empty already.',
    'head-rowspan': 'The first row has a cell merged over rows: it cannot be the head.',
    'cell-has-table': 'There is a table in this cell already.',
    'link-across-blocks': 'A link can only go on the text of one paragraph: select words inside one paragraph.',
    'link-overlap': 'The selection touches a link only in part: select the whole link or the text next to it.',
    'bad-target': 'This address cannot be used for a link.',
    'empty-selection': 'Select some text first.',
    'no-link': 'There is no link here.',
    'not-editable': 'This block can only be edited in Text mode for now.',
    'becomes-plate': 'With these characters the paragraph would become a list or a code block: type them in Text mode.',
    'break-in-heading': 'A heading is one line: put the line break in a paragraph.',
    'document-title': 'The title of the document cannot become a paragraph or a section.',
    'join-meta': 'There are service lines above the block (anchor, title, attributes): join the blocks in Text mode.',
    'inside-plate': 'This place is inside a block that the editor shows as a plate: edit it in Text mode.',
    'inside-construct': 'This place is inside markup that the visual editor does not edit: edit it in Text mode.',
    'island-unsaved': 'The edit of the island was not saved',
    'paste-images': 'Images from the clipboard are not pasted: their files are not next to the document. The rest of the text was pasted.',
    'paste-refused': 'The fragment was not pasted: in AsciiDoc it would read differently and touch the blocks next to it. The file is unchanged. Cmd+Shift+V pastes it as plain text.',
    'caption-one-line': 'A caption is one line: a line break is not needed.',
    'bad-image': 'This path cannot be used for an image.',
    'not-colorable': 'Color is not shown here: edit the markup in Text mode.',
    'invalid-role': 'There is no such color.',
    collateral: 'The text typed this way would read differently and touch the blocks next to it: type it in Text mode.',
    'leading-blank': 'Without this mark the space would start the paragraph, where it is not written: type a word before it.',
    unstable: 'The text cannot be written this way: the markup would read differently. Edit it in Text mode.',
    unwritable: 'The text cannot be written this way: the markup would read differently. Edit it in Text mode.',
    'unknown-mark': 'There is no such mark.',
    'invalid-target': 'This place cannot be edited this way.',
    'invalid-range': 'This place cannot be edited this way.',
    'style-off': 'A heading cannot be set here: the style does not change in a list item, a table cell or an admonition.',
    'cell-text': 'In this cell the markup is shown as text: marks and links are set in Text mode. The file is unchanged.',
    'cell-bar': 'A bar in a cell with a link or marks is typed in Text mode: otherwise the cell would be shown as plain text. The file is unchanged.',
    'invalid-block': 'This block cannot be edited this way.',
    'invalid-span': 'This place cannot be edited this way.',
    'invalid-level': 'There is no such heading level.',
    'bad-level': 'There is no such level.',
    'item-start': 'An item is split inside its text; a new item starts at the end of the text of an item.',
    'item-has-items': 'The item has items inside it: move or remove them first.',
    'list-middle': 'An empty item in the middle of a list does not become a paragraph.',
    'first-item': 'The first item of a list has nowhere to go: there is no item above it.',
    'top-level-item': 'An item of the first level cannot move out.',
    unsupported: 'This can only be edited in Text mode for now.',
    'fragment-invalid': 'The text cannot be written this way: the markup would read differently. Edit it in Text mode.',
    'unexpected-kind': 'This edit does not fit.',
    'newline-in-text': 'A line break cannot go here.',
    'nesting-too-deep': 'Tables are nested four levels deep at most.',
    'cell-fill-refused': 'This cell cannot be filled: the label of the fill would show in the text of the cell.',
  },
}

/** The strings of the package in Russian and English. */
export const messages: Readonly<Record<Locale, Messages>> = { ru, en }
