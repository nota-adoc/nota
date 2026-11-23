// The refusals of the visual editor by their codes (what the page shows when a command or typing is refused) and the words the
// editor shows around the text, in the two languages of the page.
import type { Lang } from './i18n.js'

const en: Record<string, string> = {
  'link-across-blocks': 'A link can only be put on the text of one paragraph: select words inside one paragraph.',
  'link-overlap': 'The selection covers only a part of a link: select the whole link or the text next to it.',
  'bad-target': 'This address does not fit a link.',
  'empty-selection': 'Select some text first.',
  'no-link': 'There is no link here.',
  'not-editable': 'This block can only be edited in Source for now.',
  'becomes-plate': 'With these characters the paragraph would become a list or a code block: type them in Source.',
  'break-in-heading': 'A heading is one line: put the line break in a paragraph.',
  'document-title': 'The title of the document cannot be turned into a paragraph or a section.',
  'join-meta': 'There are service lines above the block (an anchor, a caption, attributes): join the blocks in Source.',
  'inside-plate': 'This place is inside a block that the editor shows as a plate: edit it in Source.',
  'inside-construct': 'This place is inside markup that the visual editor does not edit: edit it in Source.',
  collateral: 'Text typed this way would be read differently and would touch the neighbouring blocks: type it in Source.',
  'leading-blank': 'Without this mark the space would end up at the start of the paragraph, where it is not written: type a word before it.',
  unstable: 'The text cannot be written this way: the markup would be read differently. Edit it in Source.',
  'item-start': 'An item is split inside its text; a new item starts at the end of the text of an item.',
  'item-has-items': 'The item has nested items: move or remove them first.',
  'list-middle': 'An empty item in the middle of a list: write some text in it or delete it.',
  'first-item': 'The first item of a list has nowhere to move: there is no item above it.',
  'top-level-item': 'An item of the first level cannot be raised any higher.',
  'column-merged-all': 'The column cannot be selected on its own: the table has a cell merged across its whole width. Split it first.',
  'row-merged-all': 'The row cannot be selected on its own: the table has a cell merged across its whole height. Split it first.',
}

const ru: Record<string, string> = {
  'link-across-blocks':
    'Ссылку можно поставить только на текст одного абзаца: выделите слова внутри одного абзаца.',
  'link-overlap': 'Выделение задевает ссылку лишь частью: выделите её целиком или текст рядом с ней.',
  'bad-target': 'Этот адрес для ссылки не подходит.',
  'empty-selection': 'Сначала выделите текст.',
  'no-link': 'Здесь нет ссылки.',
  'not-editable': 'Этот блок пока правится только в «Исходнике».',
  'becomes-plate': 'С такими символами абзац стал бы списком или блоком кода: наберите их в «Исходнике».',
  'break-in-heading': 'Заголовок — одна строка: перенос строки ставится в абзаце.',
  'document-title': 'Заголовок документа нельзя превратить в абзац или раздел.',
  'join-meta':
    'Над блоком есть служебные строки (якорь, подпись, атрибуты): объединяйте блоки в «Исходнике».',
  'inside-plate': 'Это место внутри блока, который редактор показывает плашкой: правьте его в «Исходнике».',
  'inside-construct':
    'Это место внутри разметки, которую визуальный редактор не правит: правьте её в «Исходнике».',
  collateral:
    'Так набранный текст прочитался бы иначе и задел бы соседние блоки: наберите его в «Исходнике».',
  'leading-blank':
    'Без этой отметки пробел оказался бы в начале абзаца, а там он не пишется: наберите слово перед ним.',
  unstable: 'Так текст записать нельзя: разметка прочитается иначе. Правьте в «Исходнике».',
  'item-start': 'Пункт делят внутри текста; новый пункт начинается в конце текста пункта.',
  'item-has-items': 'У пункта есть вложенные пункты: сначала перенесите или уберите их.',
  'list-middle': 'Пустой пункт посреди списка: допишите в него текст или удалите его.',
  'first-item': 'Первому пункту списка некуда сдвигаться: у него нет пункта выше.',
  'top-level-item': 'Пункт первого уровня выше не поднимается.',
  'column-merged-all':
    'Колонку нельзя выделить отдельно: в таблице есть ячейка, объединённая на всю её ширину. Сначала разделите её.',
  'row-merged-all':
    'Ряд нельзя выделить отдельно: в таблице есть ячейка, объединённая на всю её высоту. Сначала разделите её.',
}

/** What a refusal says, by its code. */
export const messagesOf = (lang: Lang): Record<string, string> => (lang === 'ru' ? ru : en)

const labelsEn = {
  checkItem: 'Mark the item',
  details: 'Details',
  admonition: { NOTE: 'Note', TIP: 'Tip', IMPORTANT: 'Important', WARNING: 'Warning', CAUTION: 'Caution' },
  gripColumn: 'Select the column · Shift+click — several',
  gripRow: 'Select the row · Shift+click — several',
  gripBorder: 'Column width: drag · double-click — equal',
  widthLimit: 'Minimum width',
  tableScroll: 'Scroll the table sideways',
  widthFrame: 'Frame width',
  diagramSample: 'flowchart LR\nA[Start] --> B[Step]\nB --> C(Done)',
} as const

const labelsRu = {
  checkItem: 'Отметить пункт',
  details: 'Подробнее',
  admonition: { NOTE: 'Примечание', TIP: 'Совет', IMPORTANT: 'Важно', WARNING: 'Внимание', CAUTION: 'Осторожно' },
  gripColumn: 'Выделить колонку · Shift+щелчок — несколько',
  gripRow: 'Выделить ряд · Shift+щелчок — несколько',
  gripBorder: 'Ширина колонок: тяните · двойной щелчок — поровну',
  widthLimit: 'Минимальная ширина',
  tableScroll: 'Прокрутка таблицы по горизонтали',
  widthFrame: 'Ширина рамки',
  diagramSample: 'flowchart LR\nA[Начало] --> B[Шаг]\nB --> C(Готово)',
} as const

/** The words the editor shows around the text. */
export const labelsOf = (lang: Lang): typeof labelsEn | typeof labelsRu => (lang === 'ru' ? labelsRu : labelsEn)
