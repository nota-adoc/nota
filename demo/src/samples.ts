// Samples. In Russian: fixtures of the quality bench (the same texts the tests use) and a generated large document. In English:
// the same documents written anew (`demo/samples`), synthetic, with invented names and the domains example.org and example.com.
import type { Lang } from './i18n.js'
import allConstructs from '../../quality/fixtures/stage2/all-constructs.adoc?raw'
import allConstructsStage1 from '../../quality/fixtures/stage1/all-constructs.adoc?raw'
import inlineMarkup from '../../quality/fixtures/stage4/all-constructs.adoc?raw'
import tables from '../../quality/fixtures/editor/tables.adoc?raw'
import diagnostics from '../../quality/fixtures/editor/diagnostics.adoc?raw'
import sectionIds from '../../quality/fixtures/editor/section-ids.adoc?raw'
import colors from '../../quality/fixtures/editor/colors.adoc?raw'
import visualSpec from '../../quality/fixtures/editor/visual.adoc?raw'

import enSpec from '../samples/spec.adoc?raw'
import enAll from '../samples/all-constructs.adoc?raw'
import enAllStage1 from '../samples/all-constructs-stage1.adoc?raw'
import enInline from '../samples/inline-markup.adoc?raw'
import enColors from '../samples/colors.adoc?raw'
import enTables from '../samples/tables.adoc?raw'
import enDiagnostics from '../samples/diagnostics.adoc?raw'
import enIds from '../samples/ids.adoc?raw'

export interface Sample {
  readonly id: string
  /** The name in the list, by language. */
  readonly label: Readonly<Record<Lang, string>>
  /** The text in the language of the page. */
  text(lang: Lang): string
}

/** About `size` characters: sections with paragraphs, lists, blocks, comments, entries and conditions. Always the same text. */
export function largeDocument(size = 1_000_000, lang: Lang = 'ru'): string {
  const w =
    lang === 'ru'
      ? {
          title: 'Большой документ',
          section: 'Раздел',
          para: (n: number) => `Абзац раздела ${n}: Nota разбирает текст по частям и пересчитывает только то, что изменилось.`,
          second: 'Вторая строка абзаца, чтобы у абзаца было больше одной строки.',
          list: 'Список',
          first: 'первый пункт',
          nested: 'вложенный пункт',
          secondItem: 'второй пункт с продолжением',
          attached: 'Присоединённый абзац.',
          comment: 'комментарий к разделу',
          attr: 'значение',
          note: 'NOTE: Замечание к разделу.',
          cond: 'Текст только для варианта plain.',
          example: 'Пример с абзацем.',
        }
      : {
          title: 'Large document',
          section: 'Section',
          para: (n: number) => `Paragraph of section ${n}: Nota parses the text in parts and recomputes only what has changed.`,
          second: 'The second line of the paragraph, so that it has more than one line.',
          list: 'List',
          first: 'first item',
          nested: 'nested item',
          secondItem: 'second item with a continuation',
          attached: 'An attached paragraph.',
          comment: 'comment on section',
          attr: 'value',
          note: 'NOTE: A remark on the section.',
          cond: 'Text for the plain flavor only.',
          example: 'An example with a paragraph.',
        }
  const out: string[] = [`= ${w.title}`, 'Jane Roe <jane@example.org>', 'v1.0, 2026-09-29', ':toc:', ':flavor: plain', '']
  let length = out.join('\n').length
  for (let n = 0; length < size; n++) {
    const chunk = [
      `== ${w.section} ${n}`,
      '',
      w.para(n),
      w.second,
      '',
      `[[section-${n}]]`,
      `.${w.list} ${n}`,
      `* ${w.first} ${n}`,
      `** ${w.nested}`,
      `* ${w.secondItem}`,
      '+',
      w.attached,
      '',
      '[source,json]',
      '----',
      `{"section": ${n}, "ok": true}`,
      '----',
      '',
      `// ${w.comment} ${n}`,
      `:attr-${n}: ${w.attr} ${n}`,
      '',
      ...(n % 3 === 0 ? [w.note, ''] : []),
      ...(n % 5 === 0 ? ['ifdef::flavor[]', w.cond, 'endif::[]', ''] : []),
      ...(n % 7 === 0 ? ['====', w.example, '====', ''] : []),
    ]
    out.push(...chunk)
    length += chunk.join('\n').length + 1
  }
  return out.join('\n')
}

const pair = (id: string, en: string, ru: string, enText: string, ruText: string): Sample => ({
  id,
  label: { en, ru },
  text: (lang) => (lang === 'ru' ? ruText : enText),
})

/** The samples of the demo: the sample technical specification first, then the fixtures of the bench and a large document. */
export const samples: readonly Sample[] = [
  pair('spec', 'Sample specification', 'Пример ТЗ', enSpec, visualSpec),
  pair('all', 'All constructs', 'Все конструкции', enAll, allConstructs),
  pair('all-1', 'All constructs, stage 1', 'Все конструкции, этап 1', enAllStage1, allConstructsStage1),
  pair('inline', 'Inline markup', 'Строчная разметка', enInline, inlineMarkup),
  pair('colors', 'Colors', 'Цвета', enColors, colors),
  pair('tables', 'Tables', 'Таблицы', enTables, tables),
  pair('diagnostics', 'Diagnostics', 'Диагностики', enDiagnostics, diagnostics),
  pair('ids', 'Section identifiers (xref:, <<)', 'Идентификаторы разделов (xref:, <<)', enIds, sectionIds),
  { id: 'large', label: { en: 'Large document ~1 MB', ru: 'Большой документ ~1 МБ' }, text: (lang) => largeDocument(1_000_000, lang) },
]
