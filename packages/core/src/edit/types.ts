/**
 * The model of the visual editor over a Nota document: the blocks it shows, the gaps of blank lines between them,
 * and the reading of the text of a block as a run of visible characters (cells) with marks.
 */

/**
 * A mark the visual editor knows. `lock` is not a mark of the text: it is a construct whose text is shown but not edited
 * (`pass:q[…]`, a visible `((…))`); its `open` and `close` are printed around the cells that lie in it, as for a link.
 */
export type MarkType = 'strong' | 'em' | 'code' | 'strike' | 'highlight' | 'link' | 'roles' | 'lock'

/** How a link is written in the text. */
export type LinkForm = 'bare' | 'angle' | 'url' | 'link' | 'mailto' | 'xref' | 'anchor'

/** One instance of a mark in the source of a block: `*bold*`, `https://x[text]`, `<<id,text>>`. */
export interface Span {
  readonly type: MarkType
  /** The target of a link as the host sees it (`#id` for `<<id>>`); null for the other marks. */
  readonly href: string | null
  readonly form: LinkForm | null
  /**
   * Quote marks: the `[.line-through]` in front of the marker, or ''. A `roles` span: the `[…]` as written (`[.zz-a]`,
   * `[zz-a]`), which holds roles and nothing else; its marker says what it is besides (`#`: nothing, `*`: bold …).
   */
  readonly attrs: string
  /** Quote marks: the marker as written (`*`, `**`, `__`, `` ` ``, `##`); '' for links. */
  readonly marker: string
  /** Links: the source before the text (`https://x[`, `link:x[`, `<<id,`, `<`, ''); locks: `pass:q[`, `((`. */
  readonly open: string
  /** Links: the source after the text (`]`, `>>`, `>`, `[]`, ''); locks: `]`, `))`. */
  readonly close: string
  /** Source range of the whole construct, and of what it holds; -1 for a span that is not in the source. */
  readonly from: number
  readonly to: number
  readonly innerFrom: number
  readonly innerTo: number
  /** The marker must be doubled (set while an edit repairs the source). */
  double: boolean
}

/** A construct that reads as text but that Asciidoctor would change (a replacement such as `(C)`). */
export interface Flag {
  readonly name: string
  readonly from: number
  readonly to: number
}

/** One visible unit of the text of a block. */
export interface Cell {
  /** `char`: one UTF-16 unit of text; `break`: a hard line break; `chip`: a construct the editor shows as a plate. */
  readonly kind: 'char' | 'break' | 'chip'
  /** The visible character of a `char` cell (a space for a line break in the source), '' for the others. */
  readonly ch: string
  /** What prints the cell: the character with its escape, the ` +` of a break (with its line break), the chip's source. */
  src: string
  /** The range of the source the cell came from; -1 when it is new. */
  readonly from: number
  readonly to: number
  /** The marks over the cell, outermost first. */
  spans: readonly Span[]
  readonly flag: Flag | null
  /** A `char` cell that stands for a line break of the source. */
  readonly newline: boolean
  /** A `]` that was written `\]` inside the text of a link (the backslash comes and goes with the link). */
  readonly linkEscape: boolean
}

/** The text of a block as a run of cells. */
export interface Reading {
  readonly cells: readonly Cell[]
  /** The range of the source the block's text occupies. */
  readonly from: number
  readonly to: number
  /** All the marks of the block, in the order of their start. */
  readonly spans: readonly Span[]
}

/**
 * `item`: an item of a list (its text is edited, the marker and the checkbox are the prefix); `fence`: the line of
 * a box that holds blocks, the one that opens it (with the lines above) or the one that closes it; `code`: a listing `----`
 * (the `content` is its body, which is shown as written); `image`: a block `image::…[]` (the `content` is its caption, the
 * text of the `.Title` line); `table`: a table the operations can write back (the cells are edited by the operations on tables,
 * `content` is the whole block). A `chip` at the level of blocks is an island: source that is edited as text.
 */
export type BlockKind = 'paragraph' | 'heading' | 'chip' | 'item' | 'fence' | 'code' | 'image' | 'table'

/** A block of the document as the visual editor shows it (blank lines are not blocks). */
export interface BlockInfo {
  readonly kind: BlockKind
  /** The source of the block: its lines, with the line break that ends the last one. */
  readonly from: number
  readonly to: number
  /** The lines of metadata over a paragraph or a heading (`[[id]]`, `.Title`, `[role]`), or null. */
  readonly meta: { readonly from: number; readonly to: number } | null
  /** The range of the text (cells) of a paragraph or a heading, without its line break. */
  readonly content: { readonly from: number; readonly to: number } | null
  /** Headings: 1 for the title of the document, 2–6 for the sections of level 1–5; 0 for the rest. */
  readonly level: number
  /** Headings: the marker (`==`, `###`) and the range of the source from the start of it to the text. */
  readonly marker: string
  readonly markerFrom: number
  /** What a chip is: the name of its first node. */
  readonly label: string
  /** The line break that ends the block: '', `\n` or `\r\n`. */
  readonly eol: string
  /**
   * Admonitions: the type (`NOTE` … `CAUTION`) of a paragraph `NOTE: …` or of the opening fence of a box `[NOTE]`; '' for the rest.
   */
  readonly variant: string
  /** Items of a checklist: the sign in the checkbox (' ', `x`, `*`); '' for an item with no checkbox and for the rest. */
  readonly checked: string
  /** Fences: `open` or `close`, and what the box is; `meta`: the header of a page kept out of sight; `toc`: a line `toc::[]` and nothing else (no content); '' for the rest. */
  readonly fence: '' | 'open' | 'close' | 'meta' | 'toc'
  readonly box: '' | 'admonition' | 'collapsible'
  /** Collapsible boxes (opening fence): the title as written, or '' when the box has none; and whether `%open` is set. */
  readonly title: string
  readonly startsOpen: boolean
  /** Code: the language as written in `[source,…]` (`js`), or ''. */
  readonly lang: string
  /** Images: the target as written (`img/a.png`); code: the delimiter (`----`); '' for the rest. */
  readonly target: string
  /**
   * The text of a cell of a table (a cell with no `a` style, read as the text of a paragraph): `at` is the place the operations
   * on tables know the cell by (the start of its content). Such a block has no marker, no metadata and no line break.
   */
  readonly inCell?: { readonly at: number }
}

/** A run of blank lines. */
export interface Gap {
  readonly from: number
  readonly to: number
  /** The lines, each with its line break. */
  readonly lines: readonly { readonly from: number; readonly to: number }[]
}

/** The blocks of a document with the gaps between them: `gaps[i]` lies before `blocks[i]`, the last one after all. */
export interface Layout {
  /** The end of what comes before the first block or gap and is not shown (a byte order mark). */
  readonly leading: number
  readonly blocks: readonly BlockInfo[]
  readonly gaps: readonly Gap[]
  readonly length: number
}

/** What the visual editor shows, top to bottom: blocks and the empty paragraphs the blank lines make. */
export interface Item {
  readonly kind: 'paragraph' | 'heading' | 'chip' | 'empty' | 'item' | 'fence' | 'code' | 'image' | 'table'
  readonly from: number
  readonly to: number
  /** The block; null for an empty paragraph. */
  readonly block: BlockInfo | null
  /** Blocks: its index among the blocks; -1 for an empty paragraph. */
  readonly blockIndex: number
  /** Empty paragraphs: the gap it is in and which of its lines it is (-1 for the one of an empty document). */
  readonly gap: number
  readonly line: number
}
