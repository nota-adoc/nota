import type { InsertKind } from '@nota-adoc/prosemirror'
import type { Messages } from './messages.js'
import { isMac, keyLabel } from './Tooltip.js'

/** An entry of a menu of blocks: what it puts in, its name, a one-line explanation, and the words the search of the menu of «/» also takes. */
export interface BlockItem {
  readonly id: InsertKind
  readonly label: string
  readonly hint: string
  readonly words: string
  /** The keys that put it in, as a label (`⌘⌥2`). */
  readonly keys?: string
}

/** The entries of the menu of «/», in the order it shows them. */
export function slashItems(t: Messages, mac: boolean = isMac()): readonly BlockItem[] {
  return [
    ...([2, 3, 4, 5, 6] as const).map((n) => ({
      id: `heading${n}` as const,
      label: t.heading(n),
      hint: t.blockHints[`heading${n}` as const],
      words: `h${n} heading заголовок`,
      keys: keyLabel(String(n), mac, { alt: true }),
    })),
    { id: 'unordered', label: t.bulletedList, hint: t.blockHints.unordered, words: 'ul list bullet список' },
    { id: 'ordered', label: t.numberedList, hint: t.blockHints.ordered, words: 'ol list number список' },
    { id: 'checklist', label: t.checklist, hint: t.blockHints.checklist, words: 'todo check список' },
    ...insertItems(t),
  ]
}

/** The entries of the button «Вставить». */
export function insertItems(t: Messages): readonly BlockItem[] {
  return [
    { id: 'table', label: t.blocks.table, hint: t.blockHints.table, words: 'table таблица' },
    { id: 'code', label: t.blocks.code, hint: t.blockHints.code, words: 'code код source' },
    {
      id: 'mermaid',
      label: t.blocks.mermaid,
      hint: t.blockHints.mermaid,
      words: 'mermaid схема диаграмма flowchart diagram',
    },
    {
      id: 'admonition',
      label: t.blocks.admonition,
      hint: t.blockHints.admonition,
      words: 'note admonition warning предупреждение примечание',
    },
    {
      id: 'collapsible',
      label: t.blocks.collapsible,
      hint: t.blockHints.collapsible,
      words: 'collapsible details spoiler раскрывающийся подробнее',
    },
    { id: 'image', label: t.blocks.image, hint: t.blockHints.image, words: 'image picture img картинка изображение' },
  ]
}

/** The entries the text after «/» leaves (any part of the name or of the words, in any case). */
export function matching(items: readonly BlockItem[], query: string): readonly BlockItem[] {
  const q = query.trim().toLowerCase()
  if (q === '') return items
  return items.filter((i) => i.label.toLowerCase().includes(q) || i.words.toLowerCase().split(' ').some((w) => w.startsWith(q)))
}
