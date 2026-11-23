import type { SyntaxNode } from '@lezer/common'
import { type ParseOptions, type NotaDocument, parse, parseStateAt } from '../document.js'
import { rubyToI } from '../parse/rx.js'

/**
 * What the host tells the document about files other than its own. Both functions are synchronous: the host loads what
 * it needs before it parses, and they are called again for every document that is built from the text, so they should be
 * cheap and give the same answer for the same arguments.
 */
export interface Resolver {
  /**
   * The target of a cross reference to another document: `path` is the file (`other.adoc`), `id` the anchor in it or `null`.
   * `null` for a target that is not there, else what the reference is shown with.
   */
  xref?(path: string, id: string | null): { title?: string } | null
  /**
   * The text of the file an `include::target[attrs]` line names (`attrs` are the attributes of the line); `null` when
   * there is no such file.
   */
  include?(target: string, attrs: Readonly<Record<string, string>>): string | null
}

/** The attributes of an `include::` line. */
export function includeAttributes(doc: NotaDocument, n: SyntaxNode): Record<string, string> {
  const out: Record<string, string> = {}
  const text = doc.text
  let pos = 0
  for (let k = n.firstChild; k; k = k.nextSibling) {
    if (k.name === 'PositionalAttribute') out[`$${++pos}`] = text.slice(k.from, k.to)
    else if (k.name === 'NamedAttribute') {
      const name = k.getChild('AttributeName')
      const v = k.getChild('AttributeValue')
      if (!name) continue
      const raw = v ? text.slice(v.from, v.to) : ''
      out[text.slice(name.from, name.to)] = raw.length >= 2 && /^(["']).*\1$/s.test(raw) ? raw.slice(1, -1) : raw
    }
  }
  return out
}

/**
 * The documents made of included text, by what they are made of (the text, the attributes of the place). A document
 * that changed in the editor still has the same included files: after `update` they are not parsed again, and a file
 * that includes itself is parsed once for each of its levels, not once for each path through them.
 */
const parts = new WeakMap<Resolver, Map<string, { doc: NotaDocument; blockMacros: unknown }>>()
const MAX_PARTS = 256

function parsedPart(
  resolver: Resolver,
  content: string,
  attributes: Record<string, string>,
  blockMacros: ParseOptions['blockMacros'],
): NotaDocument {
  let byKey = parts.get(resolver)
  if (!byKey) parts.set(resolver, (byKey = new Map()))
  // The key holds the text and the attributes, not the path: a cycle of includes ends by itself, since a level that
  // repeats an earlier one (same text, same attributes) is the same document, and the depth limit of the parser stops the rest.
  const key = `${JSON.stringify(Object.entries(attributes))}\0${content}`
  const hit = byKey.get(key)
  if (hit && hit.blockMacros === blockMacros) return hit.doc
  const doc = parse(content, { attributes, resolver, blockMacros })
  if (byKey.size >= MAX_PARTS) byKey.clear()
  byKey.set(key, { doc, blockMacros })
  return doc
}

const cache = new WeakMap<NotaDocument, Map<number, NotaDocument | null>>()

/**
 * The document of the text that the resolver gives for an `include::` line (an `IncludeDirective` node of `doc`), parsed
 * with the attributes in force at the line; `null` without a resolver, or when it has no such file.
 */
export function resolveInclude(doc: NotaDocument, n: SyntaxNode, target?: string): NotaDocument | null {
  const resolver = doc.options.resolver
  if (!resolver?.include) return null
  let byPos = cache.get(doc)
  if (!byPos) cache.set(doc, (byPos = new Map()))
  if (byPos.has(n.from)) return byPos.get(n.from)!
  let path = target
  if (path === undefined) {
    const t = n.getChild('DirectiveTarget')
    path = t ? doc.text.slice(t.from, t.to) : ''
  }
  const attrs = includeAttributes(doc, n)
  const content = resolver.include(path, attrs)
  let inner: NotaDocument | null = null
  if (typeof content === 'string') {
    const host = doc.attributesAt(n.from)
    const attributes: Record<string, string> = {}
    for (const [k, v] of host) attributes[k] = `${v}@`
    // the level of the parse at the line, not the attribute: `{set:leveloffset:…}` in text changes the attribute only,
    // and Ruby reads the include before it is converted
    const hostValue = host.get('leveloffset')
    const base = parseStateAt(doc, n.from)?.leveloffset ?? rubyToI(hostValue ?? '0')
    const rel = attrs['leveloffset']
    if (rel !== undefined && /^[+-]?\d+$/.test(rel)) {
      attributes['leveloffset'] = `${/^[+-]/.test(rel) ? base + Number.parseInt(rel, 10) : Number.parseInt(rel, 10)}@`
    } else if (rubyToI(hostValue ?? '0') !== base) {
      if (base === 0) delete attributes['leveloffset']
      else attributes['leveloffset'] = `${base}@`
    }
    inner = parsedPart(resolver, content, attributes, doc.options.blockMacros)
  }
  byPos.set(n.from, inner)
  return inner
}
