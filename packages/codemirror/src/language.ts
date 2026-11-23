/**
 * The bridge between the Nota syntax tree and CodeMirror's `Language`: a `Parser` that does not parse
 * by itself but asks nota. `syntaxTree(state)` is then the tree of Nota, node for node.
 */
import { Language, defineLanguageFacet, syntaxTree } from '@codemirror/language'
import { EditorState, Facet } from '@codemirror/state'
import type { Input, PartialParse, Tree, TreeFragment } from '@lezer/common'
import { Parser } from '@lezer/common'
import { type ParseOptions, type NotaDocument, type TextChange, parse } from '@nota-adoc/core'

/** Documents by the tree they built: how `notaDocument(state)` finds the document of `syntaxTree(state)`. */
const documents = new WeakMap<Tree, NotaDocument>()

function register(doc: NotaDocument): Tree {
  const tree = doc.tree
  documents.set(tree, doc)
  return tree
}

/**
 * Changes that turn the text of `old` into the new text, recovered from the fragments CodeMirror kept:
 * a fragment is a range that did not change, so the gaps between fragments are the changed ranges.
 * Returns null when the fragments do not describe `old`.
 */
function changesFromFragments(
  old: NotaDocument,
  fragments: readonly TreeFragment[],
  input: Input,
): TextChange[] | null {
  const oldLength = old.text.length
  const out: TextChange[] = []
  let newPos = 0
  let oldPos = 0
  for (const f of fragments) {
    const oldFrom = f.from + f.offset
    const oldTo = f.to + f.offset
    if (f.from < newPos || oldFrom < oldPos || oldTo > oldLength || f.to > input.length) return null
    if (f.from > newPos || oldFrom > oldPos)
      out.push({ from: oldPos, to: oldFrom, insert: input.read(newPos, f.from) })
    newPos = f.to
    oldPos = oldTo
  }
  if (input.length > newPos || oldLength > oldPos)
    out.push({ from: oldPos, to: oldLength, insert: input.read(newPos, input.length) })
  return out
}

class NotaParse implements PartialParse {
  parsedPos = 0
  // Nota always finishes in one step, so a request to stop early is ignored and the tree is complete
  readonly stoppedAt = null

  constructor(
    private readonly options: ParseOptions,
    private readonly input: Input,
    private readonly fragments: readonly TreeFragment[],
  ) {}

  advance(): Tree {
    const { input } = this
    const text = input.read(0, input.length)
    const doc = this.incremental(text) ?? parse(text, this.options)
    this.parsedPos = input.length
    return register(doc)
  }

  stopAt(_pos: number): void {}

  private incremental(text: string): NotaDocument | null {
    const { fragments } = this
    if (fragments.length === 0) return null
    const tree = fragments[0]!.tree
    const old = documents.get(tree)
    if (!old || fragments.some((f) => f.tree !== tree)) return null
    const changes = changesFromFragments(old, fragments, this.input)
    if (!changes) return null
    let next: NotaDocument
    try {
      next = old.update(changes)
    } catch {
      return null
    }
    // the fragments must describe the text they were cut from; anything else means a full parse
    return next.text === text ? next : null
  }
}

class NotaParser extends Parser {
  constructor(readonly options: ParseOptions) {
    super()
  }

  createParse(input: Input, fragments: readonly TreeFragment[], _ranges: readonly { from: number; to: number }[]) {
    return new NotaParse(this.options, input, fragments)
  }
}

/** The parse options of the AsciiDoc language of a state (a facet, so `notaDocument` can parse without the language). */
export const parseOptionsFacet = Facet.define<ParseOptions, ParseOptions>({
  combine: (values) => values[0] ?? {},
})

/** A CodeMirror `Language` whose syntax tree is the Nota tree. */
export function asciidocLanguage(options: ParseOptions = {}): Language {
  return new Language(
    defineLanguageFacet(),
    new NotaParser(options),
    [
      parseOptionsFacet.of(options),
      // every character of the text is kept as it is: CR stays a character of its line, so `doc.toString()`
      // is the source byte for byte, like the text of the Nota document
      EditorState.lineSeparator.of('\n'),
      EditorState.languageData.of(() => [{ commentTokens: { line: '//' } }]),
    ],
    'asciidoc',
  )
}

/**
 * The Nota document of the current state: `text` is `state.doc.toString()`, `tree` is `syntaxTree(state)`,
 * `diagnostics` are those of a full parse. Without the AsciiDoc language in the state the text is parsed.
 */
export function notaDocument(state: EditorState): NotaDocument {
  const known = documents.get(syntaxTree(state))
  if (known) return known
  // a tree that does not come from the bridge (no language): parse and remember by state document
  return parseOnce(state)
}

const fallback = new WeakMap<object, NotaDocument>()

function parseOnce(state: EditorState): NotaDocument {
  const key = state.doc
  let doc = fallback.get(key)
  if (!doc) {
    doc = parse(state.doc.toString(), state.facet(parseOptionsFacet))
    fallback.set(key, doc)
  }
  return doc
}
