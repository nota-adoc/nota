import type { Diagnostic } from '../context.js'

/** A range of the source and what it is; the parts of a construct are reported after it. */
export interface Part {
  readonly t: number
  readonly f: number
  readonly e: number
}

/** A construct found by the substitutions (a range of the source) and its parts, nested by their ranges. */
export interface INode extends Part {
  readonly kids: readonly Part[]
}

/** Where the substitutions report what they find (the syntax tree of the text) and their diagnostics. */
export interface InlineSink {
  readonly nodes: INode[]
  readonly diags: Diagnostic[]
}

/** A footnote as the document keeps it. */
export interface Footnote {
  readonly index: number
  readonly id: string | null
  readonly text: string
}

/** What the substitutions need to know about the document and the block they work on. */
export interface InlineEnv {
  /** The value of a document attribute, `undefined` if it is not set. */
  get(name: string): string | undefined
  /** Sets (a string) or unsets (null) an attribute, as `{set:name:value}` does. */
  set?(name: string, value: string | null): void
  /** `{counter:name:seed}`: the next value. */
  counter?(name: string, seed: string | undefined): string
  /** An attribute of the block (`subs`, `hardbreaks-option`, `line-comment`, …). */
  block?(name: string): string | undefined
  /** Registers a footnote (the text is what the footnote says, already converted), returning its index. */
  addFootnote?(id: string | null, text: string): number
  /** The footnote a reference by id points at. */
  footnote?(id: string): Footnote | undefined
  /** Whether the document has a reference (an id) by this name; `resolveId` finds one by its title. */
  hasRef?(id: string): boolean
  resolveId?(title: string): string | null
  /** The text a cross reference to `id` shows when it has none of its own, `null` if there is none. */
  xrefText?(id: string, style: string | undefined): string | null
  /** Names of the document and the documents it includes, to tell a reference to itself from one to another. */
  docname?: string
  /** Whether the text belongs to a list item of a bibliography list. */
  bibliography?: boolean
  nextCalloutId?(): string
  imageUri?(target: string): string
  iconUri?(target: string): string
}
