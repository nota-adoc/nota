/**
 * Structure dump shared by the three sides of the comparison: Ruby Asciidoctor (ruby/dump.rb),
 * Asciidoctor.js (js/dump.ts) and Nota (nota-dump.ts). Lines are 1-based.
 */

export interface DumpAuthor {
  name: string | null
  email: string | null
}

export interface DumpRevision {
  number: string | null
  date: string | null
  remark: string | null
}

export interface DumpHeader {
  title: string | null
  authors: DumpAuthor[]
  revision: DumpRevision | null
  /** nota: header values contain attribute references `{…}`. */
  attrRefs?: boolean
  /** nota: last line of the header. */
  endLine?: number
}

/** An attribute entry as Asciidoctor stored it: raw name (may carry `!`), raw value (null = unset). */
export interface DumpEntry {
  line: number
  name: string
  value: string | null
  header: boolean
  /** References: the entry was read by a nested reader (a list item, a delimited block), not the document. */
  nested?: boolean
}

export interface DumpNode {
  context: string
  line: number | null
  /** Line of the enclosing section title, 0 for the document. */
  parent: number
  style?: string | null
  id?: string | null
  level?: number
  title?: string | null
  sectname?: string
  content_model?: string
  lines?: number
  roles?: string[]
  options?: string[]
  named?: Record<string, string>
  /** Nota, an ordered list: its `start` or its style is written in the source, not taken from the marker. */
  explicit?: boolean
  /** References: nesting depth of the block in the document tree (pre-order walk). */
  depth?: number
  /** Lists: the number of lists the list is nested in; the number of items. */
  list_level?: number
  items?: number
  /** List items: the marker, the checkbox and its state, the number of lines of the text; description lists: the terms. */
  marker?: string | null
  checkbox?: boolean
  checked?: boolean
  text_lines?: number
  terms?: (string | null)[]
  /** Listings: the language. Macros: the target. */
  language?: string | null
  target?: string | null
  /** nota: first line of the node, its metadata lines included. */
  start?: number
  /** nota: last line of the node. */
  end?: number
  /** nota: the block was written with delimiters; the block is Markdown (` ``` ` fence, `>` quote). */
  delimited?: boolean
  markdown?: boolean
  /** nota: the block attribute lines contain an attribute reference `{…}`. */
  attrRefs?: boolean
  /** Tables: the layout. */
  table?: DumpTable
}

/** A column of a table: the width in percent (as the converter writes it), the alignments, the style. */
export interface DumpColumn {
  width: number | null
  halign: string | null
  valign: string | null
  style: string | null
  autowidth: boolean
}

/** A cell of a table with the layout applied. Rows and columns count from 0; the column takes the spans above into account. */
export interface DumpCell {
  row: number
  column: number
  colspan: number
  rowspan: number
  halign: string | null
  valign: string | null
  style: string | null
  /** The line of the source the cell starts at (1-based). */
  line: number | null
  /** The text of the cell as the table read it, before the style is applied. */
  text: string
  /** A cell with the asciidoc style: the blocks of the document it holds (lines are those of the file). */
  blocks?: DumpNode[]
}

/** The layout of a table: its columns and the rows of the head, the body and the foot. */
export interface DumpTable {
  columns: DumpColumn[]
  rows: { head: DumpCell[][]; body: DumpCell[][]; foot: DumpCell[][] }
}

/** The HTML of a block and of the blocks in it (a section: its blocks; a list: the blocks of its items). */
export interface HtmlBlock {
  context: string
  /** The first line of the block (1-based) as the side reports it; null when it has no position. */
  line: number | null
  html: string
  blocks: HtmlBlock[]
  /** nota: the last line of the block. */
  end?: number
  /** Nota, an `olist`: a list in it (it included) has a `start` or a style written in the source. */
  explicit?: boolean
}

/** The HTML of the whole document (embedded, as `convert` writes it) and of its blocks. */
export interface DumpHtml {
  doc: string
  blocks: HtmlBlock[]
}

export interface DumpFile {
  file: string
  /** nota: lines of `include::` directives; the references read them as text lines. */
  includeLines?: number[]
  /**
   * nota: for a line, the number of lines the preprocessor dropped right after it. Asciidoctor counts
   * lines of a block it has looked past a dropped line for one too many (`Reader#peek_lines` restores the
   * lines it read but not the dropped ones), so the line of a block may be up to this much larger.
   */
  hiddenAfter?: Record<string, number>
  error?: string
  header?: DumpHeader
  entries?: DumpEntry[]
  nodes?: DumpNode[]
  html?: DumpHtml
}
