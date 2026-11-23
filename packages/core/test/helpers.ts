import type { Tree } from '@lezer/common'
import { IterMode } from '@lezer/common'

/** Texts of all leaves in document order. */
export function leafTexts(tree: Tree, text: string): string[] {
  const out: string[] = []
  const cursor = tree.cursor(IterMode.IncludeAnonymous)
  for (;;) {
    if (!cursor.firstChild()) {
      out.push(text.slice(cursor.from, cursor.to))
      for (;;) {
        if (cursor.nextSibling()) break
        if (!cursor.parent()) return out
      }
    }
  }
}

/** `name:from-to` for every named node, depth-first; identical signatures mean identical trees. */
export function signature(tree: Tree): string {
  const parts: string[] = []
  tree.iterate({
    enter(node) {
      parts.push(`${node.name}:${node.from}-${node.to}`)
    },
  })
  return parts.join(' ')
}

/** Tree shape without the Document wrapper and without positions. */
export function shape(tree: Tree): string {
  const s = tree.toString()
  return s.startsWith('Document(') ? s.slice('Document('.length, -1) : s === 'Document' ? '' : s
}

/** The text of the first node with the given name. */
export function textOf(tree: Tree, text: string, name: string): string | undefined {
  let found: string | undefined
  tree.iterate({
    enter(node) {
      if (found !== undefined) return false
      if (node.name === name) {
        found = text.slice(node.from, node.to)
        return false
      }
      return undefined
    },
  })
  return found
}

import { expect } from 'vitest'
import { type ParseOptions, parse } from '@nota-adoc/core'

/** Parses, checks that the leaves spell the text, and returns the document. */
export function lossless(text: string, options?: ParseOptions) {
  const doc = parse(text, options)
  expect(doc.text).toBe(text)
  expect(doc.tree.length).toBe(text.length)
  expect(leafTexts(doc.tree, text).join('')).toBe(text)
  return doc
}

/** The shape of the tree of `text` (see `shape`), after checking that it is lossless. */
export const shapeOf = (text: string, options?: ParseOptions) => shape(lossless(text, options).tree)

/** Codes of the diagnostics, in order. */
export const codesOf = (text: string, options?: ParseOptions) =>
  parse(text, options).diagnostics.map((d) => d.code)
