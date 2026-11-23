/**
 * Document attributes as they are at a position of the text: the defaults of Nota, the attributes given in
 * `ParseOptions` and the entries (`:name: value`, `:name!:`) above the position. The tree tells which entries
 * count: entries in blocks that are not parsed (a listing, a comment) and lines that a condition switched off are no nodes.
 */
import type { SyntaxNode, SyntaxNodeRef, Tree } from '@lezer/common'
import { DEFAULT_ATTRIBUTES, type ParseOptions } from '@nota-adoc/core'

/** The attributes of the document at some point and the names the document cannot change. */
export class AttributeState {
  constructor(
    readonly attrs: Map<string, string>,
    readonly locked: ReadonlySet<string>,
  ) {}

  /** Sets (a string) or unsets (`null`) an attribute the way an entry does: locked names do not change. */
  apply(name: string, value: string | null): void {
    if (this.locked.has(name)) return
    if (value === null) this.attrs.delete(name)
    else this.attrs.set(name, value)
  }
}

// what the document cannot change in secure mode, as Nota sets it up
const SECURE_LOCKED = [
  'embedded',
  'asciidoctor',
  'asciidoctor-version',
  'safe-mode-name',
  'safe-mode-secure',
  'safe-mode-level',
  'max-include-depth',
  'allow-uri-read',
  'docdir',
  'user-home',
  'max-attribute-value-size',
  'linkcss',
  'icons',
  'copycss',
  'source-highlighter',
  'backend',
]
const SECURE_UNSET = ['allow-uri-read', 'icons', 'copycss', 'source-highlighter']

/** The attributes before the first line of the document: defaults and the options of the caller. */
export function initialAttributes(options: ParseOptions): AttributeState {
  const attrs = new Map<string, string>(Object.entries(DEFAULT_ATTRIBUTES))
  const locked = new Set<string>(SECURE_LOCKED)
  for (const name of SECURE_UNSET) attrs.delete(name)
  for (const [rawKey, rawVal] of Object.entries(options.attributes ?? {})) {
    let key = rawKey
    let value: string | null | false
    const text = (v: unknown) => (v === true ? '' : String(v))
    if (key.endsWith('@')) {
      if (key.startsWith('!') || key.endsWith('!@')) {
        key = key.startsWith('!') ? key.slice(1, -1) : key.slice(0, -2)
        value = false
      } else {
        key = key.slice(0, -1)
        value = `${rawVal === null || rawVal === false ? '' : text(rawVal)}@`
      }
    } else if (key.startsWith('!') || key.endsWith('!')) {
      key = key.startsWith('!') ? key.slice(1) : key.slice(0, -1)
      value = rawVal === '@' ? false : null
    } else {
      value = rawVal === null ? null : rawVal === false ? false : text(rawVal)
    }
    const name = key.toLowerCase()
    if (name === 'numbered') continue
    if (value === false) {
      attrs.delete(name)
      locked.delete(name)
    } else if (value === null) {
      attrs.delete(name)
      locked.add(name)
    } else if (value.endsWith('@')) {
      attrs.set(name, value.slice(0, -1))
      locked.delete(name)
    } else {
      attrs.set(name, value)
      locked.add(name)
    }
  }
  return new AttributeState(attrs, locked)
}

/** Applies an `AttributeEntry` node to the state. */
export function applyEntry(state: AttributeState, entry: SyntaxNodeRef | SyntaxNode, text: string): void {
  const node = 'node' in entry ? entry.node : entry
  const nameNode = node.getChild('AttributeName')
  if (!nameNode) return
  const name = text.slice(nameNode.from, nameNode.to).trim().toLowerCase()
  if (!name) return
  if (node.getChild('UnsetMarker')) {
    state.apply(name, null)
    return
  }
  const valueNode = node.getChild('AttributeValue')
  let value = ''
  if (valueNode) {
    const parts: string[] = []
    const first = valueNode.firstChild
    if (first) {
      // a value continued over lines: ValueText, LineContinuation, Newline per line
      for (let c: SyntaxNode | null = first; c; c = c.nextSibling)
        if (c.name === 'ValueText') parts.push(text.slice(c.from, c.to).trim())
    } else parts.push(text.slice(valueNode.from, valueNode.to).trim())
    value = parts.join(' ')
  }
  state.apply(name, value)
}

/**
 * The attributes at `pos`: entries that end at or before `pos` count. A cell with the `a` style is a document of its
 * own: what it sets counts in that cell only, so the cells that do not hold `pos` are left out.
 */
export function attributesAt(tree: Tree, text: string, options: ParseOptions, pos: number): Map<string, string> {
  const state = initialAttributes(options)
  tree.iterate({
    from: 0,
    to: pos,
    enter(ref) {
      if (ref.name === 'CellContent') return ref.to >= pos
      if (ref.name !== 'AttributeEntry') return
      if (ref.to <= pos) applyEntry(state, ref, text)
      return false
    },
  })
  return state.attrs
}
