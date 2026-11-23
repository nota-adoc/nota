/**
 * Highlighting of the block level of AsciiDoc, straight from the Nota tree.
 *
 * The node types of `@nota-adoc/core` carry no CodeMirror properties, so instead of `styleTags` a view
 * plugin walks the visible part of the tree, finds the group of every node in the table below and asks
 * the highlighters of the state (`highlightingFor`) for the class of the group's tags. Whatever
 * `HighlightStyle` the host installs (a theme like `oneDark` included) decides the colours;
 * the neutral style of this package is only a fallback for hosts that install none.
 */
import { HighlightStyle, type TagStyle, highlightingFor, syntaxTree, syntaxHighlighting } from '@codemirror/language'
import { type EditorState, type Extension, RangeSetBuilder } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view'
import type { SyntaxNode } from '@lezer/common'
import { type Tag, Tag as TagClass, tags as t } from '@lezer/highlight'
import { type NodeName, sectionLevel } from '@nota-adoc/core'

const define = (parent: Tag) => TagClass.define(parent)

/** Groups of highlighted constructs, and the tags they are styled with. Each has its own tag, a child of a standard tag. */
export const asciidocTags = {
  heading0: define(t.heading1),
  heading1: define(t.heading2),
  heading2: define(t.heading3),
  heading3: define(t.heading4),
  heading4: define(t.heading5),
  heading5: define(t.heading6),
  blockTitle: define(t.heading),
  author: define(t.name),
  revision: define(t.documentMeta),
  attributeName: define(t.propertyName),
  attributeUnset: define(t.operator),
  attributeValue: define(t.string),
  lineContinuation: define(t.operator),
  punctuation: define(t.separator),
  attrStyle: define(t.typeName),
  attrId: define(t.labelName),
  attrRole: define(t.className),
  attrOption: define(t.modifier),
  attrPositional: define(t.string),
  anchorId: define(t.labelName),
  anchorText: define(t.string),
  blockDelimiter: define(t.keyword),
  listContinuation: define(t.operator),
  listMarker: define(t.keyword),
  checkbox: define(t.atom),
  descriptionTerm: define(t.strong),
  admonition: define(t.annotation),
  rawContent: define(t.string),
  codeLanguage: define(t.typeName),
  macroName: define(t.macroName),
  macroTarget: define(t.url),
  break: define(t.operator),
  comment: define(t.comment),
  commentDelimiter: define(t.comment),
  directiveName: define(t.controlKeyword),
  directiveTarget: define(t.variableName),
  directiveText: define(t.string),
  disabled: define(t.comment),
  quoteAttribution: define(t.emphasis),
  // inline markup: the whole construct gets the style of its kind, its markers and parts their own
  strong: define(t.strong),
  emphasis: define(t.emphasis),
  monospace: define(t.monospace),
  highlightText: define(t.content),
  superscript: define(t.content),
  subscript: define(t.content),
  doubleQuoted: define(t.quote),
  singleQuoted: define(t.quote),
  quoteMarker: define(t.processingInstruction),
  inlineAttributes: define(t.className),
  escape: define(t.escape),
  passthrough: define(t.literal),
  passMarker: define(t.processingInstruction),
  passSubs: define(t.modifier),
  stem: define(t.literal),
  attributeReference: define(t.variableName),
  replacement: define(t.character),
  hardBreak: define(t.operator),
  callout: define(t.annotation),
  link: define(t.link),
  linkText: define(t.link),
  macroText: define(t.string),
} as const satisfies Record<string, Tag>

export type HighlightGroup = keyof typeof asciidocTags

/** One row of the highlighting table: the nodes of this type (under one of these parents) belong to the group. */
export interface HighlightRule {
  readonly node: NodeName
  /** Only nodes whose parent has one of these types; any parent when absent. */
  readonly parents?: readonly NodeName[]
  /** Only nodes without children (a value that is continued over lines is a composite of `ValueText` leaves). */
  readonly leaf?: boolean
  /** Only the first attribute of a list (right after the `[`) that is not in quotes: the style of a block. */
  readonly style?: boolean
  /** A group, or `heading`: one of `heading0`…`heading5` by the level of the section. */
  readonly group: HighlightGroup | 'heading'
}

const titles = ['DocumentTitle', 'SectionTitle', 'DiscreteHeading'] as const
const punctuationParents = [
  'AttributeEntry',
  'BlockAttributes',
  'NamedAttribute',
  'BlockAnchor',
  'BlockMacro',
  'Directive',
  'IncludeDirective',
  'BlockQuote',
  'Link',
  'Xref',
  'InlineAnchor',
  'InlineImage',
  'Footnote',
  'Kbd',
  'Button',
  'Menu',
  'IndexTerm',
  'Passthrough',
  'Stem',
  'AttributeReference',
] as const

const linkParents = ['Link', 'Xref'] as const

/** The highlighting table. Nodes that are not listed (paragraph text, blank lines, newlines) get no class. */
export const highlightTable: readonly HighlightRule[] = [
  { node: 'SectionMarker', parents: titles, group: 'heading' },
  { node: 'TitleText', parents: titles, group: 'heading' },
  { node: 'SetextUnderline', parents: titles, group: 'heading' },
  { node: 'TitleText', parents: ['BlockTitle'], group: 'blockTitle' },
  { node: 'Mark', parents: ['BlockTitle'], group: 'blockTitle' },
  { node: 'AuthorName', group: 'author' },
  { node: 'AuthorEmail', group: 'author' },
  { node: 'RevisionNumber', group: 'revision' },
  { node: 'RevisionDate', group: 'revision' },
  { node: 'RevisionRemark', group: 'revision' },
  { node: 'AttributeName', group: 'attributeName' },
  { node: 'UnsetMarker', group: 'attributeUnset' },
  { node: 'AttributeValue', leaf: true, group: 'attributeValue' },
  { node: 'ValueText', group: 'attributeValue' },
  { node: 'LineContinuation', group: 'lineContinuation' },
  { node: 'Mark', parents: punctuationParents, group: 'punctuation' },
  { node: 'ShorthandStyle', group: 'attrStyle' },
  { node: 'ShorthandId', group: 'attrId' },
  { node: 'ShorthandRole', group: 'attrRole' },
  { node: 'ShorthandOption', group: 'attrOption' },
  { node: 'PositionalAttribute', parents: ['BlockAttributes'], leaf: true, style: true, group: 'attrStyle' },
  { node: 'PositionalAttribute', leaf: true, group: 'attrPositional' },
  { node: 'AnchorId', group: 'anchorId' },
  { node: 'AnchorRefText', group: 'anchorText' },
  { node: 'BlockDelimiter', group: 'blockDelimiter' },
  // the cells of a table: the separator and the spec of a cell are delimiters; the text of a cell is not marked
  { node: 'CellSeparator', group: 'blockDelimiter' },
  { node: 'CellSpec', group: 'blockDelimiter' },
  { node: 'ListContinuation', group: 'listContinuation' },
  { node: 'ListMarker', group: 'listMarker' },
  { node: 'Checkbox', group: 'checkbox' },
  { node: 'DescriptionTerm', group: 'descriptionTerm' },
  { node: 'AdmonitionMarker', group: 'admonition' },
  { node: 'DelimitedContent', group: 'rawContent' },
  { node: 'LiteralParagraph', group: 'rawContent' },
  { node: 'CodeLanguage', group: 'codeLanguage' },
  { node: 'MacroName', group: 'macroName' },
  { node: 'MacroTarget', group: 'macroTarget' },
  { node: 'BreakMarker', group: 'break' },
  { node: 'LineComment', group: 'comment' },
  { node: 'CommentContent', group: 'comment' },
  { node: 'CommentDelimiter', group: 'commentDelimiter' },
  { node: 'DirectiveName', group: 'directiveName' },
  { node: 'DirectiveTarget', group: 'directiveTarget' },
  { node: 'DirectiveText', group: 'directiveText' },
  { node: 'DisabledLines', group: 'disabled' },
  { node: 'QuoteAttribution', group: 'quoteAttribution' },
  // inline markup
  { node: 'Strong', group: 'strong' },
  { node: 'Emphasis', group: 'emphasis' },
  { node: 'Monospace', group: 'monospace' },
  { node: 'Highlight', group: 'highlightText' },
  { node: 'Superscript', group: 'superscript' },
  { node: 'Subscript', group: 'subscript' },
  { node: 'DoubleQuoted', group: 'doubleQuoted' },
  { node: 'SingleQuoted', group: 'singleQuoted' },
  { node: 'QuoteMarker', group: 'quoteMarker' },
  { node: 'InlineAttributes', group: 'inlineAttributes' },
  { node: 'Escape', group: 'escape' },
  { node: 'Passthrough', group: 'passthrough' },
  { node: 'PassMarker', group: 'passMarker' },
  { node: 'PassSubs', group: 'passSubs' },
  { node: 'Stem', group: 'stem' },
  { node: 'AttributeReference', group: 'attributeReference' },
  { node: 'Replacement', group: 'replacement' },
  { node: 'HardBreak', group: 'hardBreak' },
  { node: 'Callout', group: 'callout' },
  { node: 'Link', group: 'link' },
  { node: 'MacroText', parents: linkParents, group: 'linkText' },
  { node: 'MacroText', group: 'macroText' },
]

const rulesByNode = new Map<string, HighlightRule[]>()
for (const r of highlightTable) {
  const list = rulesByNode.get(r.node) ?? []
  list.push(r)
  rulesByNode.set(r.node, list)
}

/** Names of the node types that the table lists. */
export const highlightedNodes: ReadonlySet<string> = new Set(rulesByNode.keys())

/** A highlighted range: exactly the range of a node of the tree. */
export interface HighlightRange {
  readonly from: number
  readonly to: number
  readonly node: NodeName
  readonly group: HighlightGroup
}

const headingGroups = ['heading0', 'heading1', 'heading2', 'heading3', 'heading4', 'heading5'] as const

function headingGroup(node: SyntaxNode): HighlightGroup {
  const parent = node.parent
  if (!parent || parent.name === 'DocumentTitle') return 'heading0'
  // a section title: the level is a property of the `Section` around it; a discrete heading carries its own
  const holder = parent.name === 'SectionTitle' ? parent.parent : parent
  const level = holder?.tree?.prop(sectionLevel) ?? 0
  return headingGroups[Math.max(0, Math.min(5, level))]!
}

/** Something the text of the document can be read from (an `EditorState.doc`, a `Text`). */
export interface TextSource {
  sliceString(from: number, to?: number): string
}

/**
 * The group of a tree node, or null when the table does not list it. Rules that look at the text (the style of a
 * block is the first attribute that is not in quotes) need `doc`; without it they do not apply.
 */
export function highlightGroup(node: SyntaxNode, doc?: TextSource): HighlightGroup | null {
  const rules = rulesByNode.get(node.name)
  if (!rules) return null
  const parentName = node.parent?.name
  for (const r of rules) {
    if (r.parents && (parentName === undefined || !r.parents.includes(parentName as NodeName))) continue
    if (r.leaf && node.firstChild) continue
    if (r.style) {
      if (!doc || node.from === 0) continue
      if (doc.sliceString(node.from - 1, node.from) !== '[') continue
      const c = doc.sliceString(node.from, node.from + 1)
      if (c === '"' || c === "'") continue
    }
    return r.group === 'heading' ? headingGroup(node) : r.group
  }
  return null
}

/** The highlighted ranges in `from`–`to`, in document order. */
export function highlightRanges(state: EditorState, from = 0, to = state.doc.length): HighlightRange[] {
  const out: HighlightRange[] = []
  syntaxTree(state).iterate({
    from,
    to,
    enter(ref) {
      if (!rulesByNode.has(ref.name)) return
      const group = highlightGroup(ref.node, state.doc)
      if (group) out.push({ from: ref.from, to: ref.to, node: ref.name as NodeName, group })
    },
  })
  return out
}

function buildDecorations(view: EditorView): DecorationSet {
  const { state } = view
  const seen = new Set<string>()
  const ranges: HighlightRange[] = []
  for (const { from, to } of view.visibleRanges)
    for (const r of highlightRanges(state, from, to)) {
      const key = `${r.from}:${r.to}:${r.group}`
      if (seen.has(key)) continue
      seen.add(key)
      ranges.push(r)
    }
  ranges.sort((a, b) => a.from - b.from || b.to - a.to)
  const marks = new Map<HighlightGroup, Decoration>()
  const builder = new RangeSetBuilder<Decoration>()
  for (const r of ranges) {
    if (r.to <= r.from) continue
    let mark = marks.get(r.group)
    if (!mark) {
      const cls = highlightingFor(state, [asciidocTags[r.group]])
      mark = Decoration.mark({ class: `cm-ap cm-ap-${r.group}${cls ? ' ' + cls : ''}` })
      marks.set(r.group, mark)
    }
    builder.add(r.from, r.to, mark)
  }
  return builder.finish()
}

const highlightPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = buildDecorations(view)
    }
    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.viewportChanged ||
        syntaxTree(update.startState) !== syntaxTree(update.state) ||
        update.transactions.some((tr) => tr.reconfigured)
      )
        this.decorations = buildDecorations(update.view)
    }
  },
  { decorations: (v) => v.decorations },
)

const palette = {
  light: {
    heading: ['#0b3d91', '#0b5fad', '#1a6fa8', '#2a7d9a', '#3a8a8a', '#4a9070'],
    name: '#7a3e9d',
    value: '#0a6b3d',
    punctuation: '#8a8f98',
    keyword: '#a626a4',
    id: '#986801',
    role: '#4078f2',
    option: '#c18401',
    comment: '#7d8590',
    raw: '#0a6b3d',
    macro: '#0184bc',
    directive: '#ca1243',
    markBackground: '#fff3b0',
  },
  dark: {
    heading: ['#e5c07b', '#e06c75', '#d19a66', '#c8ae9d', '#abb2bf', '#98a1ae'],
    name: '#c678dd',
    value: '#98c379',
    punctuation: '#7f848e',
    keyword: '#c678dd',
    id: '#d19a66',
    role: '#61afef',
    option: '#e5c07b',
    comment: '#7f848e',
    raw: '#98c379',
    macro: '#56b6c2',
    directive: '#e06c75',
    markBackground: '#5c4a00',
  },
}

/** The rules of the neutral style; `v` gives the colour of a named slot, `p` is the palette that fills the slots. */
function neutralRules(p: typeof palette.light, v: (name: string, fallback: string) => string): TagStyle[] {
  const a = asciidocTags
  return [
      ...(['heading0', 'heading1', 'heading2', 'heading3', 'heading4', 'heading5'] as const).map((g, i) => ({
        tag: a[g],
        color: v(`heading-${i}`, p.heading[i]!),
        fontWeight: i < 3 ? 'bold' : '600',
      })),
      { tag: a.blockTitle, color: v('block-title', p.heading[3]!), fontStyle: 'italic' },
      { tag: a.author, color: v('author', p.name) },
      { tag: a.revision, color: v('revision', p.comment) },
      { tag: a.attributeName, color: v('attribute-name', p.name) },
      { tag: a.attributeUnset, color: v('operator', p.directive) },
      { tag: a.attributeValue, color: v('value', p.value) },
      { tag: a.lineContinuation, color: v('operator', p.directive) },
      { tag: a.punctuation, color: v('punctuation', p.punctuation) },
      { tag: a.attrStyle, color: v('attr-style', p.keyword), fontWeight: '600' },
      { tag: a.attrId, color: v('attr-id', p.id) },
      { tag: a.attrRole, color: v('attr-role', p.role) },
      { tag: a.attrOption, color: v('attr-option', p.option) },
      { tag: a.attrPositional, color: v('value', p.value) },
      { tag: a.anchorId, color: v('attr-id', p.id), fontWeight: '600' },
      { tag: a.anchorText, color: v('value', p.value), fontStyle: 'italic' },
      { tag: a.blockDelimiter, color: v('delimiter', p.keyword), fontWeight: '600' },
      { tag: a.listContinuation, color: v('operator', p.directive), fontWeight: '600' },
      { tag: a.listMarker, color: v('list-marker', p.role), fontWeight: '600' },
      { tag: a.checkbox, color: v('checkbox', p.option) },
      { tag: a.descriptionTerm, color: v('term', p.name), fontWeight: 'bold' },
      { tag: a.admonition, color: v('admonition', p.directive), fontWeight: 'bold' },
      { tag: a.rawContent, color: v('raw', p.raw) },
      { tag: a.codeLanguage, color: v('attr-style', p.keyword), fontStyle: 'italic' },
      { tag: a.macroName, color: v('macro', p.macro), fontWeight: '600' },
      { tag: a.macroTarget, color: v('macro-target', p.role), textDecoration: 'underline' },
      { tag: a.break, color: v('break', p.punctuation), fontWeight: 'bold' },
      { tag: a.comment, color: v('comment', p.comment), fontStyle: 'italic' },
      { tag: a.commentDelimiter, color: v('comment', p.comment), fontWeight: 'bold' },
      { tag: a.directiveName, color: v('directive', p.directive), fontWeight: '600' },
      { tag: a.directiveTarget, color: v('directive-target', p.id) },
      { tag: a.directiveText, color: v('value', p.value) },
      { tag: a.disabled, color: v('disabled', p.comment), opacity: '0.6' },
      { tag: a.quoteAttribution, color: v('quote', p.comment), fontStyle: 'italic' },
      { tag: a.strong, fontWeight: 'bold' },
      { tag: a.emphasis, fontStyle: 'italic' },
      { tag: a.monospace, fontFamily: 'monospace', color: v('raw', p.raw) },
      { tag: a.highlightText, backgroundColor: v('mark-background', p.markBackground) },
      { tag: a.superscript, verticalAlign: 'super', fontSize: '0.8em' },
      { tag: a.subscript, verticalAlign: 'sub', fontSize: '0.8em' },
      { tag: a.doubleQuoted, color: v('value', p.value) },
      { tag: a.singleQuoted, color: v('value', p.value) },
      { tag: a.quoteMarker, color: v('punctuation', p.punctuation) },
      { tag: a.inlineAttributes, color: v('attr-role', p.role) },
      { tag: a.escape, color: v('operator', p.directive), fontWeight: '600' },
      { tag: a.passthrough, color: v('raw', p.raw) },
      { tag: a.passMarker, color: v('punctuation', p.punctuation) },
      { tag: a.passSubs, color: v('attr-option', p.option) },
      { tag: a.stem, color: v('raw', p.raw), fontStyle: 'italic' },
      { tag: a.attributeReference, color: v('attribute-name', p.name) },
      { tag: a.replacement, color: v('operator', p.directive) },
      { tag: a.hardBreak, color: v('operator', p.directive), fontWeight: 'bold' },
      { tag: a.callout, color: v('admonition', p.directive), fontWeight: 'bold' },
      { tag: a.link, textDecoration: 'underline' },
      { tag: a.linkText, color: v('macro-target', p.role), textDecoration: 'underline' },
      { tag: a.macroText, color: v('value', p.value) },
  ]
}

/** The colour slots of a palette, name → value, as the rules ask for them. */
function slots(p: typeof palette.light): Record<string, string> {
  const out: Record<string, string> = {}
  neutralRules(p, (name, value) => (out[`--ap-${name}-default`] = value))
  return out
}

/**
 * The highlighting extension: the view plugin and, as a fallback that only counts when the host installs
 * no highlight style of its own, a neutral style for light and dark themes (colours through CSS variables `--ap-*`).
 */
export function asciidocHighlighting(): Extension {
  return [
    highlightPlugin,
    // one fallback style: `@codemirror/language` keeps only the first fallback and ignores `themeType` for it,
    // so light and dark are told apart by CSS variables, which the theme of the host switches (`&light`, `&dark`)
    syntaxHighlighting(
      HighlightStyle.define(neutralRules(palette.light, (name) => `var(--ap-${name}, var(--ap-${name}-default))`)),
      { fallback: true },
    ),
    EditorView.baseTheme({
      '&light': slots(palette.light),
      '&dark': slots(palette.dark),
      '.cm-ap-disabled': { opacity: '0.6' },
    }),
  ]
}
