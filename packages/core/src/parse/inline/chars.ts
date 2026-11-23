/** Character classes of Ruby's regular expressions, as Asciidoctor uses them. */

const WORD_RE = /^[\p{Alphabetic}\p{M}\p{Nd}\p{Pc}]$/u
const ALPHA_RE = /^\p{Alphabetic}$/u
const ALNUM_RE = /^[\p{Alphabetic}\p{Nd}]$/u

/** The code point that starts at `i`. */
export function cpAt(s: string, i: number): number {
  return s.codePointAt(i) ?? -1
}

/** The length in UTF-16 units of the code point at `i` (1 past the end). */
export function cpLen(s: string, i: number): number {
  const c = s.charCodeAt(i)
  if (c >= 0xd800 && c <= 0xdbff) {
    const d = s.charCodeAt(i + 1)
    if (d >= 0xdc00 && d <= 0xdfff) return 2
  }
  return 1
}

/** The start of the code point that ends at `i` (exclusive). */
export function cpStartBefore(s: string, i: number): number {
  const d = s.charCodeAt(i - 1)
  if (d >= 0xdc00 && d <= 0xdfff && i >= 2) {
    const c = s.charCodeAt(i - 2)
    if (c >= 0xd800 && c <= 0xdbff) return i - 2
  }
  return i - 1
}

export function isWordCp(cp: number): boolean {
  if (cp < 0) return false
  if (cp < 128)
    return (cp >= 48 && cp <= 57) || (cp >= 65 && cp <= 90) || (cp >= 97 && cp <= 122) || cp === 95
  return WORD_RE.test(String.fromCodePoint(cp))
}

export function isAlphaCp(cp: number): boolean {
  if (cp < 0) return false
  if (cp < 128) return (cp >= 65 && cp <= 90) || (cp >= 97 && cp <= 122)
  return ALPHA_RE.test(String.fromCodePoint(cp))
}

export function isAlnumCp(cp: number): boolean {
  if (cp < 0) return false
  if (cp < 128) return (cp >= 48 && cp <= 57) || (cp >= 65 && cp <= 90) || (cp >= 97 && cp <= 122)
  return ALNUM_RE.test(String.fromCodePoint(cp))
}

/** Ruby's `\s`: space, tab, line feed, vertical tab, form feed, carriage return. */
export function isSpaceCode(c: number): boolean {
  return c === 32 || (c >= 9 && c <= 13)
}

/** Whether the code unit at `i` is a character `\S` matches (there is one; the end of the text is not). */
export function isNonSpaceAt(s: string, i: number): boolean {
  return i >= 0 && i < s.length && !isSpaceCode(s.charCodeAt(i))
}

export function isWordAt(s: string, i: number): boolean {
  return i >= 0 && i < s.length && isWordCp(cpAt(s, i))
}

/** Whether the character that ends at `i` (exclusive) is a word character. */
export function isWordBefore(s: string, i: number): boolean {
  return i > 0 && isWordCp(cpAt(s, cpStartBefore(s, i)))
}

/** `\p{Word}` inside character class source text. */
export const WORD = '\\p{Alphabetic}\\p{M}\\p{Nd}\\p{Pc}'
export const ALPHA = '\\p{Alphabetic}'
export const ALNUM = '\\p{Alphabetic}\\p{Nd}'
/** Ruby's `\S` and `\s` as classes. */
export const NS = '[^ \\t\\n\\v\\f\\r]'
export const SP = '[ \\t\\n\\v\\f\\r]'
/** `^` and `$` as they are in Ruby: at every line. */
export const BOL = '(?<![^\\n])'
export const EOL = '(?![^\\n])'
