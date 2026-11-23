/**
 * The aggregate mode of the quality tools: what may leave a folder of closed pages is a number under a key
 * from a list fixed in the code. A key that is not in the list is folded into `<other>`.
 */
import { existsSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

export const OTHER = '<other>'

/** The file that turns a folder into a closed corpus: only the aggregates may be taken out of it. */
export const AGGREGATE_ONLY_FILE = '.aggregate-only'

/** Adds up the counts under the keys the list allows; the counts of the other keys go to `<other>`. */
export function foldKeys(
  counts: Readonly<Record<string, number>>,
  allowed: (key: string) => boolean,
): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [k, n] of Object.entries(counts)) {
    const key = allowed(k) ? k : OTHER
    out[key] = (out[key] ?? 0) + n
  }
  return out
}

/** The fields the comparison of the structure reports a difference in (see quality/reference/compare.ts). */
export const COMPARE_FIELDS: ReadonlySet<string> = new Set([
  'presence',
  'context',
  'parent',
  'order',
  'level',
  'title',
  'list level',
  'items',
  'marker',
  'checkbox',
  'checked',
  'text lines',
  'terms',
  'target',
  'macro attributes',
  'lines',
  'language',
  'layout',
  'style',
  'id',
  'roles',
  'options',
  'named',
  'authors',
  'revision',
  'name',
  'set',
  'header',
  'value',
  'end',
  'columns',
  'cells',
  'asciidoc',
  'row',
  'column',
  'colspan',
  'rowspan',
  'halign',
  'valign',
  'line',
  'text',
  'column width',
  'column halign',
  'column valign',
  'column style',
  'column autowidth',
  'head rows',
  'body rows',
  'foot rows',
])

/** The contexts of the blocks of Asciidoctor, which the HTML of blocks is counted by. */
export const BLOCK_CONTEXTS: ReadonlySet<string> = new Set([
  'admonition',
  'audio',
  'colist',
  'dlist',
  'document',
  'embedded',
  'example',
  'floating_title',
  'image',
  'list_item',
  'listing',
  'literal',
  'olist',
  'open',
  'page_break',
  'paragraph',
  'pass',
  'preamble',
  'quote',
  'section',
  'sidebar',
  'stem',
  'table',
  'table_cell',
  'thematic_break',
  'toc',
  'ulist',
  'verse',
  'video',
])

/**
 * Whether the folder holds closed pages: the marker file lies in its root. A folder that is not there
 * (or is not a folder) does not.
 */
export function isAggregateOnly(dir: string): boolean {
  try {
    return statSync(dir).isDirectory() && existsSync(resolve(dir, AGGREGATE_ONLY_FILE))
  } catch {
    return false
  }
}

/** Whether the path is a folder with the marker file, or lies inside one. */
export function underAggregateOnly(path: string): boolean {
  let p = resolve(path)
  for (;;) {
    if (isAggregateOnly(p)) return true
    const up = dirname(p)
    if (up === p) return false
    p = up
  }
}

/** The message of a refusal: it does not name the path and does not quote the text. */
export const REFUSAL = `this folder holds closed pages (it has a ${AGGREGATE_ONLY_FILE} file): this command does not work on it`

/**
 * For the tools that show what is in the files (`npm run compare`, `npm run ref`, `quality/dev/`): exit code 2
 * when any of the paths is or lies in a closed folder.
 */
export function refuseAggregateOnly(paths: readonly (string | undefined)[]): void {
  if (paths.some((p) => p !== undefined && p !== '' && underAggregateOnly(p))) {
    console.error(REFUSAL)
    process.exit(2)
  }
}

// ---------------------------------------------------------------- the shape of a difference of HTML

/** The elements the shape of an HTML difference may name. */
export const SHAPE_TAGS: ReadonlySet<string> = new Set(
  (
    'a abbr b blockquote br caption cite code col colgroup dd del details div dl dt em figcaption figure h1 h2 h3 h4 h5 h6 ' +
    'hr i img ins kbd li mark ol p pre q s samp section small span strong sub summary sup table tbody td tfoot th thead ' +
    'tr u ul var !--'
  ).split(' '),
)

/** The attributes the shape may name. */
export const SHAPE_ATTRS: ReadonlySet<string> = new Set([
  'class',
  'style',
  'colspan',
  'rowspan',
  'id',
  'href',
  'src',
  'alt',
  'title',
  'width',
  'height',
  'start',
  'type',
  'reversed',
  'data-lang',
  'data-style',
  'role',
  'target',
  'rel',
])

/** The class names of Asciidoctor that the shape may name (the ones of tables and of their cells). */
export const SHAPE_CLASSES: ReadonlySet<string> = new Set([
  'tableblock',
  'frame-all',
  'frame-ends',
  'frame-sides',
  'frame-none',
  'grid-all',
  'grid-cols',
  'grid-rows',
  'grid-none',
  'stripes-all',
  'stripes-even',
  'stripes-odd',
  'stripes-hover',
  'stretch',
  'fit-content',
  'autowidth',
  'halign-left',
  'halign-center',
  'halign-right',
  'valign-top',
  'valign-middle',
  'valign-bottom',
  'title',
  'content',
  'listingblock',
  'literalblock',
  'paragraph',
  'ulist',
  'olist',
  'dlist',
  'exampleblock',
  'sidebarblock',
  'quoteblock',
  'openblock',
  'admonitionblock',
  'imageblock',
  'verseblock',
  'hdlist',
  'colist',
  'checklist',
  'sect1',
  'sect2',
  'sect3',
  'sect4',
  'sectionbody',
  'discrete',
  'float',
  'audioblock',
  'videoblock',
  'stemblock',
  'note',
  'tip',
  'important',
  'warning',
  'caution',
  'arabic',
  'loweralpha',
  'lowerroman',
  'upperalpha',
  'upperroman',
  'decimal',
  'square',
  'circle',
  'disc',
  'horizontal',
  'qanda',
  'bibliography',
  'unstyled',
])

export const SHAPE_TEXT_HINTS: ReadonlySet<string> = new Set(['spaces', 'prefix', 'entity', 'text'])

/** `value` when it is in the list, `x` otherwise: what goes into a key never comes from the text. */
export function inList(list: ReadonlySet<string>, value: string): string {
  return list.has(value) ? value : 'x'
}

const SHAPE_PART = '[a-z0-9!\\-/+]+'
const SHAPE_KEY_RX = new RegExp(`^html-shape\\.[a-z_<>]+(\\.${SHAPE_PART})+$`)

/**
 * Whether a key is one of the shapes of an HTML difference: `html-shape.` and dotted parts, each made by
 * `inList` from a list of this file, a number of a column, or a word of the code.
 */
export function isShapeKey(key: string): boolean {
  if (!SHAPE_KEY_RX.test(key)) return false
  const parts = key.split('.').slice(1)
  return parts.every(
    (p) =>
      p === 'x' ||
      /^(col|n)(\d|10\+)$/.test(p) ||
      SHAPE_TAGS.has(p.replace(/^\//, '')) ||
      SHAPE_ATTRS.has(p) ||
      SHAPE_CLASSES.has(p) ||
      SHAPE_TEXT_HINTS.has(p) ||
      BLOCK_CONTEXTS.has(p) ||
      SHAPE_WORDS.has(p),
  )
}

/** The words of the code a shape is made of. */
export const SHAPE_WORDS: ReadonlySet<string> = new Set([
  'text',
  'tag',
  'attr',
  'class',
  'style',
  'first-only',
  'second-only',
  'tag-vs-text',
  'in',
  'none',
  'section',
  'col',
  'open',
  'close',
  'tokens',
  'same',
  'other',
  // the details of an HTML difference (see `htmlDetailShapes` in quality/reference/compare.ts)
  'pos',
  'in-class',
  'prev',
  'cells',
  'tables',
  'idkind',
  'iddelta',
  'idblock',
  'block',
  'role',
  'child',
  'has',
  'no',
  'none-first',
  'none-second',
  'empty-first',
  'empty-second',
  'suffix-number',
  'case',
  'first-higher-1',
  'first-higher-2',
  'first-higher-many',
  'first-lower-1',
  'first-lower-2',
  'first-lower-many',
])
