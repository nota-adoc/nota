/**
 * The texts of the remarks of Nota as the person reads them: every code of the engine is told in Russian by the pattern of
 * its message, in English two codes are told by the plugin and the others keep the text of Nota, as in the source. The host (the panel «Проблемы»)
 * and the tab (the hint under a wavy line) use the same function.
 */
import { type Locale, strings } from '../strings.js'

export type RemarkSeverity = 'error' | 'warning' | 'info'

export interface RemarkLike {
  readonly code: string
  readonly message: string
}

/**
 * The Russian text of the remarks of Nota by code: the pattern of the message of the engine and the text with the values
 * taken from it. A message that does not fit its pattern (the engine changed the wording) stays as the engine says it.
 */
const BLOCKS: Record<string, string> = {
  comment: 'комментарий',
  example: 'пример',
  listing: 'листинг',
  literal: 'буквальный текст',
  sidebar: 'врезка',
  quote: 'цитата',
  open: 'открытый блок',
  pass: 'сквозной текст',
  'fenced code': 'код в ```',
  table: 'таблица',
}

const russian: Record<string, readonly (readonly [RegExp, (m: RegExpExecArray) => string])[]> = {
  'unterminated-block': [
    [/^Unterminated ([^]*?) block: no closing "([^]*)" line$/, (m) => `Блок «${BLOCKS[m[1]!] ?? m[1]}» не закрыт: нет закрывающей строки «${m[2]}»`],
  ],
  'unknown-block-macro': [
    [/^Unknown block macro "([^]*)": the line is read as a paragraph$/, (m) => `Неизвестный блочный макрос «${m[1]}»: строка читается как абзац`],
  ],
  'list-item-as-text': [
    [/^A line that looks like a list item is text here: a list starts after a blank line$/, () => 'Строка, похожая на пункт списка, здесь обычный текст: список начинается после пустой строки'],
  ],
  'level-0-section-in-article': [
    [/^Level 0 sections can only be used when doctype is book$/, () => 'Разделы нулевого уровня допустимы только в документе типа book'],
  ],
  'undefined-attribute': [[/^Undefined attribute "([^]*)"$/, (m) => `Атрибут «${m[1]}» не задан`]],
  'malformed-directive': [
    [/^Malformed preprocessor directive: text not permitted in (endif::[^]*)$/, (m) => `Неверная директива препроцессора: у ${m[1]} не должно быть текста`],
    [/^Malformed preprocessor directive: missing target in ([^]*)$/, (m) => `Неверная директива препроцессора: в ${m[1]} не указана цель`],
    [/^Malformed preprocessor directive: target not permitted in (ifeval::[^]*)$/, (m) => `Неверная директива препроцессора: у ${m[1]} не должно быть цели`],
    [/^Malformed preprocessor directive: invalid expression in (ifeval::[^]*)$/, (m) => `Неверная директива препроцессора: неверное выражение в ${m[1]}`],
    [/^Malformed preprocessor directive: missing expression in (ifeval::\[\])$/, (m) => `Неверная директива препроцессора: в ${m[1]} нет выражения`],
  ],
  'unmatched-endif': [
    [/^Unmatched preprocessor directive: ([^]*)$/, (m) => `Директива препроцессора без пары: ${m[1]}`],
    [/^Mismatched preprocessor directive: (endif::[^]*?\[\]), expected (endif::[^]*)$/, (m) => `Директива препроцессора не совпадает с открывающей: ${m[1]}, ожидалась ${m[2]}`],
  ],
  'unterminated-conditional': [
    [/^Unterminated preprocessor conditional directive: no endif for ([^]*)$/, (m) => `Условная директива препроцессора не закрыта: нет endif для ${m[1]}`],
  ],
  'list-item-index': [
    [/^List item index: expected ([^]*), got ([^]*)$/, (m) => `Номер пункта списка: ожидался ${m[1]}, а здесь ${m[2]}`],
    [/^Callout list item index: expected ([^]*), got ([^]*)$/, (m) => `Номер пункта списка выносок: ожидался ${m[1]}, а здесь ${m[2]}`],
  ],
  'table-incomplete-row': [
    [/^The cells of the last row do not fill it; they are left out of the table$/, () => 'Ячейки последнего ряда не заполняют его целиком; они не попадут в таблицу'],
  ],
  'table-cell-dropped': [
    [/^The cell is left out with its row: the row has more cells than the table has columns$/, () => 'Ячейка не попадёт в таблицу вместе со своим рядом: в ряду больше ячеек, чем столбцов в таблице'],
  ],
  'table-missing-separator': [
    [/^The first cell of the table has no separator before it; the text before the first separator is a cell$/, () => 'Перед первой ячейкой таблицы нет разделителя; текст до первого разделителя считается ячейкой'],
  ],
  'duplicate-id': [[/^Id "([^]*)" is already in use: a second declaration of it$/, (m) => `Идентификатор «${m[1]}» уже занят: это второе объявление`]],
  'line-read-as-attributes': [
    [/^Asciidoctor reads the line \[([^]*)\] as block attributes \(the style "([^]*)"\), not as text$/, (m) => `Asciidoctor прочтёт строку [${m[1]}] как атрибуты блока (стиль «${m[2]}»), а не как текст`],
  ],
  'header-attribute-in-body': [
    [/^The attribute :([^]*): is read only in the header; here, below a blank line, it has no effect$/, (m) => `Атрибут :${m[1]}: читается только в шапке; здесь, после пустой строки, он ни на что не влияет`],
  ],
  'unresolved-include': [[/^The include "([^]*)" is not found by the resolver$/, (m) => `Включаемый файл «${m[1]}» не найден`]],
  'unknown-color-role': [
    [/^The role "([^]*)" looks like a colour \(it begins with "hl-"\) but the host does not know it$/, (m) => `Роль «${m[1]}» похожа на цвет (начинается с «hl-»), но такого цвета нет`],
  ],
}

/** The text of a remark. */
export function remarkText(d: RemarkLike, locale: Locale = 'en'): string {
  const t = strings[locale].remark
  if (d.code === 'unresolved-reference') {
    const m = /^The reference to "([^]*)" has no target in the document$/.exec(d.message)
    if (m) return t.unresolved(m[1]!)
    if (locale === 'ru') {
      const r = /^The reference to "([^]*)" is not found by the resolver$/.exec(d.message)
      if (r) return `Ссылка на «${r[1]}» не найдена`
    }
  }
  if (d.code === 'section-level-skipped') {
    const m = /expected level (\d+), got level (\d+)/.exec(d.message)
    if (m) {
      // the engine counts levels from 0 (`==`), the menu names headings from 2: level + 1
      const expected = String(Number(m[1]) + 1)
      const got = String(Number(m[2]) + 1)
      return expected === '2' ? t.skippedFirst(expected, got) : t.skipped(expected, got)
    }
  }
  if (locale === 'ru') {
    for (const [re, text] of russian[d.code] ?? []) {
      const m = re.exec(d.message)
      if (m) return text(m)
    }
  }
  return d.message
}

/** «Ошибка», «Предупреждение», «Сведения». */
export function severityName(severity: RemarkSeverity, locale: Locale = 'en'): string {
  return strings[locale].remark.severity[severity]
}

/** Remarks that count in the tree and show under the text: errors and warnings. */
export const counts = (severity: RemarkSeverity): boolean => severity !== 'info'

/** `1 замечание`, `2 замечания`, `5 замечаний`. */
export const remarkCount = (n: number, locale: Locale = 'en'): string => strings[locale].tree.remarks(n)
