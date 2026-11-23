import { NodeProp, NodeSet, NodeType, type SyntaxNode } from '@lezer/common'

/**
 * Node types of the Nota syntax tree. Every character of the source belongs to exactly one leaf;
 * composite nodes are tiled by their children without gaps. See packages/core/README.md.
 */
export const NodeNames = [
  // index 0 is the anonymous node type (NodeType.none)
  '',
  // structure
  'Document',
  'Header',
  'DocumentTitle',
  'AuthorLine',
  'Author',
  'AuthorName',
  'AuthorEmail',
  'RevisionLine',
  'RevisionNumber',
  'RevisionDate',
  'RevisionRemark',
  'Section',
  'SectionTitle',
  'SectionMarker',
  'TitleText',
  'SetextUnderline',
  'DiscreteHeading',
  // blocks
  'Paragraph',
  'LiteralParagraph',
  'AdmonitionParagraph',
  'StyledParagraph',
  'AdmonitionMarker',
  'TextLine',
  'DelimitedBlock',
  'BlockDelimiter',
  'DelimitedContent',
  'CodeLanguage',
  'TableCell',
  'CellSpec',
  'CellSeparator',
  'CellContent',
  'BlockQuote',
  'QuoteAttribution',
  'BlockMacro',
  'MacroName',
  'MacroTarget',
  'ThematicBreak',
  'PageBreak',
  'BreakMarker',
  // lists
  'UnorderedList',
  'OrderedList',
  'DescriptionList',
  'CalloutList',
  'ListItem',
  'ListMarker',
  'ItemText',
  'DescriptionTerm',
  'Checkbox',
  'ListContinuation',
  // preprocessor
  'Directive',
  'IncludeDirective',
  'DirectiveName',
  'DirectiveTarget',
  'DirectiveText',
  'DisabledLines',
  // comments
  'LineComment',
  'BlockComment',
  'CommentDelimiter',
  'CommentContent',
  // attributes
  'AttributeEntry',
  'AttributeName',
  'UnsetMarker',
  'AttributeValue',
  'ValueText',
  'LineContinuation',
  // block metadata
  'BlockAttributes',
  'PositionalAttribute',
  'NamedAttribute',
  'ShorthandStyle',
  'ShorthandId',
  'ShorthandRole',
  'ShorthandOption',
  'BlockAnchor',
  'AnchorId',
  'AnchorRefText',
  'BlockTitle',
  // lines and tokens
  'BlankLine',
  'Newline',
  'ByteOrderMark',
  'Mark',
  // inline markup
  'Strong',
  'Emphasis',
  'Monospace',
  'Highlight',
  'Superscript',
  'Subscript',
  'DoubleQuoted',
  'SingleQuoted',
  'QuoteMarker',
  'InlineAttributes',
  'Escape',
  'Passthrough',
  'PassMarker',
  'PassSubs',
  'Stem',
  'AttributeReference',
  'Replacement',
  'SpecialChar',
  'HardBreak',
  'Callout',
  'Link',
  'Xref',
  'InlineAnchor',
  'InlineImage',
  'Footnote',
  'Kbd',
  'Button',
  'Menu',
  'IndexTerm',
  'MacroText',
] as const

/** The name of a node type of the syntax tree. */
export type NodeName = (typeof NodeNames)[number]

/** Node type ids by name. */
export const Type = Object.fromEntries(NodeNames.map((name, id) => [name, id])) as Record<NodeName, number>

/**
 * Per-node property: the effective level of a `Section` or `DiscreteHeading` node
 * (marker level plus the `leveloffset` in effect, never below 0), as Asciidoctor computes it.
 */
export const sectionLevel = new NodeProp<number>({ perNode: true })

/**
 * Per-node property of a `DelimitedBlock`: what kind of block it is once its style is applied, as
 * Asciidoctor names the context: `listing`, `literal`, `example`, `sidebar`, `quote`, `verse`, `open`,
 * `pass`, `stem`, `admonition`, `comment` or `table`. Read it with `node.tree?.prop(blockKind)`.
 */
export const blockKind = new NodeProp<string>({ perNode: true })

/** The style of a table cell or column as Asciidoctor names it: `d` is `none`, `s` `strong`, and so on. */
export type TableCellStyle = 'asciidoc' | 'emphasis' | 'header' | 'literal' | 'monospaced' | 'none' | 'strong'

/** A column of a table: its width in percent (four decimals, the last column takes what is left) and its defaults. */
export interface TableColumnModel {
  width: number
  /** The column has an automatic width (`~` in `cols`, or a table with `%autowidth`). */
  autowidth: boolean
  halign: 'left' | 'center' | 'right'
  valign: 'top' | 'middle' | 'bottom'
  style: TableCellStyle | null
}

/** The fill of a cell: the label `[.cell-<name>]##{empty}##` at the start of its text (`from`, `to` are the label). */
export interface TableCellFill {
  role: string
  from: number
  to: number
}

/** A cell of a table with the layout applied. */
export interface TableCellModel {
  /** The `TableCell` node, and its `CellContent`. */
  from: number
  to: number
  contentFrom: number
  contentTo: number
  /** 0-based: the row (counted over the head, the body and the foot) and the first column the cell covers. */
  row: number
  column: number
  colspan: number
  rowspan: number
  halign: 'left' | 'center' | 'right'
  valign: 'top' | 'middle' | 'bottom'
  style: TableCellStyle | null
  /** The text of the cell as Asciidoctor reads it: escapes and CSV quotes are taken out, the style is not applied. */
  text: string
  /** The fill of the cell, or null (offsets like `contentFrom`). */
  fill: TableCellFill | null
}

/**
 * A cell that Asciidoctor read and then left out with its row (the row has more cells than the table has columns, or
 * the last row is not full). It is in no row and has no node of its own, but what it holds still counts: the anchors
 * and ids in its text are taken by the document.
 */
export interface TableDroppedCellModel {
  from: number
  to: number
  style: TableCellStyle | null
  /** The text of the cell as Asciidoctor reads it (see `TableCellModel.text`). */
  text: string
  /** How many cells of the rows (head, body, foot) were read before it: where it is among them in the order of reading. */
  after: number
}

/** A row of a table: its cells, in the order of the text. */
export interface TableRowModel {
  cells: TableCellModel[]
}

/** The layout of a table, as Asciidoctor works it out. */
export interface TableModel {
  /** The `DelimitedBlock` of the table. */
  from: number
  to: number
  format: 'psv' | 'csv' | 'dsv'
  separator: string
  /** The width of the table in percent (the `width` attribute, 100 without it). */
  width: number
  columns: TableColumnModel[]
  rows: { head: TableRowModel[]; body: TableRowModel[]; foot: TableRowModel[] }
  /** The cells left out, in the order of the text. */
  dropped: TableDroppedCellModel[]
}

/**
 * Per-node property of the `DelimitedBlock` of a table: the layout. The offsets in it are relative to the
 * start of the block (a unit that is reused after an edit is only shifted); `NotaDocument.tableAt` gives them
 * in the text.
 */
export const tableModel = new NodeProp<TableModel>({ perNode: true })

/**
 * Per-node property of a `TextLine` that spans several lines (a construct crosses the line breaks): the pieces
 * of text of its lines, as pairs of offsets `[from, to, from, to, …]` — the text of the lines without their
 * trailing white space, without the comment lines, quote markers and the like between them. The offsets in the
 * tree are relative to the start of the node (a unit that is reused after an edit is only shifted); the parser
 * works with absolute ones until the tree is built.
 */
export const textPieces = new NodeProp<readonly number[]>({ perNode: true })

/** Node groups, available through `NodeType.prop(NodeProp.group)`. */
const groups: Partial<Record<NodeName, string[]>> = {
  Paragraph: ['Block', 'Paragraph'],
  LiteralParagraph: ['Block', 'Paragraph'],
  AdmonitionParagraph: ['Block', 'Paragraph'],
  StyledParagraph: ['Block', 'Paragraph'],
  DelimitedBlock: ['Block'],
  BlockQuote: ['Block'],
  BlockMacro: ['Block'],
  ThematicBreak: ['Block', 'Break'],
  PageBreak: ['Block', 'Break'],
  UnorderedList: ['Block', 'List'],
  OrderedList: ['Block', 'List'],
  DescriptionList: ['Block', 'List'],
  CalloutList: ['Block', 'List'],
  Directive: ['Directive'],
  IncludeDirective: ['Directive'],
  DiscreteHeading: ['Block'],
  BlockComment: ['Comment'],
  LineComment: ['Comment'],
  BlockAttributes: ['Metadata'],
  BlockAnchor: ['Metadata'],
  BlockTitle: ['Metadata'],
  Strong: ['Inline', 'Quote'],
  Emphasis: ['Inline', 'Quote'],
  Monospace: ['Inline', 'Quote'],
  Highlight: ['Inline', 'Quote'],
  Superscript: ['Inline', 'Quote'],
  Subscript: ['Inline', 'Quote'],
  DoubleQuoted: ['Inline', 'Quote'],
  SingleQuoted: ['Inline', 'Quote'],
  Escape: ['Inline'],
  Passthrough: ['Inline', 'Pass'],
  Stem: ['Inline', 'Pass'],
  AttributeReference: ['Inline'],
  Replacement: ['Inline'],
  SpecialChar: ['Inline'],
  HardBreak: ['Inline'],
  Callout: ['Inline'],
  Link: ['Inline', 'Macro'],
  Xref: ['Inline', 'Macro'],
  InlineAnchor: ['Inline', 'Macro'],
  InlineImage: ['Inline', 'Macro'],
  Footnote: ['Inline', 'Macro'],
  Kbd: ['Inline', 'Macro'],
  Button: ['Inline', 'Macro'],
  Menu: ['Inline', 'Macro'],
  IndexTerm: ['Inline', 'Macro'],
}

/** The node types of the syntax tree, indexed by the ids in {@link Type}; id 0 is the type for no node. */
export const nodeTypes: readonly NodeType[] = NodeNames.map((name, id) =>
  id === 0
    ? NodeType.none
    : NodeType.define({
        id,
        name,
        top: name === 'Document',
        props: groups[name] ? [[NodeProp.group, groups[name]!]] : [],
      }),
)

/** The Lezer `NodeSet` of {@link nodeTypes}: what a tree of a document is built with. */
export const nodeSet = new NodeSet(nodeTypes)

/**
 * The separators that a backslash protects in the text of a node that lies in cells of tables, the innermost table
 * first: a `|` of the text of a cell `a!` that is in a cell `a|` is written `\\|` for the table around, and a `!` is
 * written `\\!` for its own. Empty outside the cells.
 */
export function cellBars(node: SyntaxNode): string[] {
  const out: string[] = []
  for (let n: SyntaxNode | null = node; n; n = n.parent) {
    if (n.name !== 'CellContent') continue
    let t: SyntaxNode | null = n.parent
    while (t && !(t.name === 'DelimitedBlock' && t.tree?.prop(tableModel))) t = t.parent
    if (!t) break
    const m = t.tree!.prop(tableModel)!
    if (m.format === 'psv' && m.separator.length === 1 && !out.includes(m.separator)) out.push(m.separator)
    n = t
  }
  return out
}
