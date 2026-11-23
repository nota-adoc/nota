/**
 * Line-level regular expressions ported from Asciidoctor 2.0 (lib/asciidoctor/rx.rb).
 *
 * Ruby's `.` matches anything but LF, `\p{Word}` is letters, marks, decimal digits and connector
 * punctuation, `\p{Alpha}` is Alphabetic and `\p{Alnum}` is Alphabetic plus decimal digits.
 * Lines are matched after the trailing whitespace is stripped, as Asciidoctor does.
 */

const WORD = '\\p{Alphabetic}\\p{M}\\p{Nd}\\p{Pc}'
const ALPHA = '\\p{Alphabetic}'
const ANY = '[^\\n]'

/** Result of {@link matchAtxSectionTitle}: offsets in the line. */
export interface AtxTitleMatch {
  /** End of the opening marker, which is also its length; the level is one less. */
  markerEnd: number
  titleFrom: number
  titleTo: number
}

const isBlank = (c: number) => c === 32 || c === 9

/**
 * `== Title`, `## Title`, `== Title ==` (level = marker length - 1). Matches exactly what
 * `^(={1,6}|#{1,6})[ \t]+(.+?)(?:[ \t]+\1)?$` matches, in linear time: the regular expression
 * backtracks quadratically over a long run of blanks in the title.
 */
export function matchAtxSectionTitle(line: string): AtxTitleMatch | null {
  const marker = line.charCodeAt(0)
  if (marker !== 61 /* = */ && marker !== 35 /* # */) return null
  const len = line.length
  let markerEnd = 1
  while (markerEnd < len && line.charCodeAt(markerEnd) === marker) markerEnd++
  if (markerEnd > 6 || markerEnd >= len || !isBlank(line.charCodeAt(markerEnd))) return null
  let titleFrom = markerEnd + 1
  while (titleFrom < len && isBlank(line.charCodeAt(titleFrom))) titleFrom++
  // Only blanks after the marker: the title is the last of them (there must be two).
  if (titleFrom === len) return len - markerEnd >= 2 ? { markerEnd, titleFrom: len - 1, titleTo: len } : null
  // A closing marker preceded by blanks ends the title before those blanks.
  const closeFrom = len - markerEnd
  if (
    closeFrom > titleFrom &&
    isBlank(line.charCodeAt(closeFrom - 1)) &&
    line.startsWith(line.slice(0, markerEnd), closeFrom)
  ) {
    let titleTo = closeFrom
    while (titleTo > titleFrom + 1 && isBlank(line.charCodeAt(titleTo - 1))) titleTo--
    return { markerEnd, titleFrom, titleTo }
  }
  return { markerEnd, titleFrom, titleTo: len }
}

/**
 * A regular expression that takes one line starts with `(?![^\\n]*\\n)` and so never matches a text with
 * a line feed. The callers pass lines already cut at the line feed (`parse()` splits the text first), so
 * this changes nothing for them. Without the check a text with a line feed makes the expression
 * backtrack over every split of the line before it reaches the line feed, which is quadratic (80 000
 * characters take seconds). The check reads up to the first line feed once.
 */
const ONE_LINE = '(?![^\\n]*\\n)'

/** First line of a two-line (setext) title. One line only (see `ONE_LINE`). */
export const SetextSectionTitleRx = new RegExp(`^${ONE_LINE}(?!\\.)${ANY}*?[${ALPHA}\\p{Nd}]${ANY}*$`, 'u')

export const SetextLevels: Readonly<Record<string, number>> = { '=': 0, '-': 1, '~': 2, '^': 3, '+': 4 }

/** `:name: value`, `:name!:`, `:!name:`. One line only (see `ONE_LINE`). */
export const AttributeEntryRx = new RegExp(`^${ONE_LINE}:(!?[${WORD}][^:]*):(?:[ \\t]+(${ANY}*))?$`, 'du')

/**
 * `[[id]]`, `[[id,reftext]]`. Linear only on lines that end with `]]`, which the caller checks
 * first: on other lines the run of spaces after the comma is rescanned once per space.
 */
export const BlockAnchorRx = new RegExp(
  `^\\[\\[(?:|([${ALPHA}_:][${WORD}\\-:.]*)(?:, *(${ANY}+))?)\\]\\]$`,
  'du',
)

/** `[style,positional,name=value]` */
export const BlockAttributeListRx = new RegExp(`^\\[(|[${WORD}.#%{,"']${ANY}*)\\]$`, 'du')

/** First character of a block attribute list: `[${WORD}.#%{,"']`. */
const AttributeListStartRx = new RegExp(`[${WORD}.#%{,"']`, 'yu')

/** An anchor id, from the position it starts at. */
const AnchorIdRx = new RegExp(`[${ALPHA}_:][${WORD}\\-:.]*`, 'yu')

/**
 * A line that looks like block attributes or an anchor (`[]`, `[style,...]`, `[[id]]`,
 * `[[id,reftext]]`); it interrupts a paragraph. Matches exactly what
 * `^\[(?:|[WORD.#%{,"']ANY*|\[(?:|ID(?:, *ANY+)?)\])\]$` matches, in linear time: the regular
 * expression backtracks quadratically over a long run of spaces after the comma of an anchor.
 */
export function isBlockAttributeLine(line: string): boolean {
  const len = line.length
  if (len < 2 || line.charCodeAt(0) !== 91 /* [ */ || line.charCodeAt(len - 1) !== 93 /* ] */) return false
  if (len === 2) return true
  const inner = line.slice(1, len - 1)
  if (line.charCodeAt(1) === 91) {
    // `[[id]]` or `[[id,reftext]]`: line[len - 2] is the first closing bracket.
    if (len < 4 || line.charCodeAt(len - 2) !== 93) return false
    if (len === 4) return true
    AnchorIdRx.lastIndex = 2
    if (!AnchorIdRx.test(line)) return false
    const idEnd = AnchorIdRx.lastIndex
    if (idEnd === len - 2) return true
    // `, *ANY+`: a comma, then at least one character, none of them a line feed.
    return (
      line.charCodeAt(idEnd) === 44 && idEnd + 1 < len - 2 && !line.slice(idEnd + 1, len - 2).includes('\n')
    )
  }
  AttributeListStartRx.lastIndex = 0
  return AttributeListStartRx.test(inner) && !inner.includes('\n')
}

/**
 * `name - purpose`, the text of the NAME section of a manpage (its lines joined by spaces).
 * Matches exactly what `^[^\n]+? +- +[^\n]+$` matches, in linear time: the regular expression
 * backtracks quadratically over a long run of spaces.
 */
export function isManpageNameLine(text: string): boolean {
  if (text.includes('\n')) return false
  const len = text.length
  // A hyphen between two spaces, one character or more before them and after them.
  for (let h = text.indexOf('-', 2); h >= 0 && h + 2 < len; h = text.indexOf('-', h + 1)) {
    if (text.charCodeAt(h - 1) === 32 && text.charCodeAt(h + 1) === 32) return true
  }
  return false
}

/** `.Block title` */
export const BlockTitleRx = new RegExp(`^\\.(\\.?[^ \\t.]${ANY}*)$`, 'du')

export const AdmonitionParagraphRx = /^(NOTE|TIP|IMPORTANT|WARNING|CAUTION):[ \t]+/

/** One author entry: up to three names and an optional email. */
export const AuthorInfoLineRx = new RegExp(
  `^([${WORD}][${WORD}\\-'.]*)(?: +([${WORD}][${WORD}\\-'.]*))?(?: +([${WORD}][${WORD}\\-'.]*))?(?: +<([^>]+)>)?$`,
  'du',
)

export const AuthorDelimiterRx = /;(?: |$)/g

/** Result of {@link matchRevisionInfoLine}: `[from, to]` offsets in the line. */
export interface RevisionMatch {
  number?: [number, number]
  date: [number, number]
  remark?: [number, number]
}

/**
 * `v1.0, 2026-09-25: remark`. Matches exactly what
 * `^(?:[^\d{]*(.*?),)? *(?!:)(.*?)(?: *(?!^),?: *(.*))?$` matches (Asciidoctor's RevisionInfoLineRx),
 * in linear time: the regular expression backtracks quadratically over long runs of spaces or
 * colons. Cases, in the order the regular expression tries them: the number ends at a comma, first
 * the earliest comma from the end of the leading run of characters other than digits and `{`,
 * then, walking back, the commas inside that run; without a comma that lets the rest match,
 * there is no number.
 */
export function matchRevisionInfoLine(line: string): RevisionMatch | null {
  const len = line.length
  let runEnd = 0
  while (runEnd < len && line.charCodeAt(runEnd) !== 123 /* { */ && !isDigit(line.charCodeAt(runEnd)))
    runEnd++
  let from = 0
  let comma = line.indexOf(',', runEnd)
  while (comma >= 0 && line.charCodeAt(comma + 1) === 58 /* : */) comma = line.indexOf(',', comma + 1)
  if (comma >= 0) from = runEnd
  else {
    for (let c = runEnd - 1; c >= 0; c--) {
      if (line.charCodeAt(c) === 44 /* , */ && line.charCodeAt(c + 1) !== 58) {
        comma = c
        from = c
        break
      }
    }
  }
  if (comma >= 0) {
    const rest = revisionRest(line, comma + 1)
    if (rest) return { number: [from, comma], ...rest }
  }
  const rest = revisionRest(line, 0)
  return rest ?? null
}

const isDigit = (c: number) => c >= 48 && c <= 57

/** ` *(?!:)(.*?)(?: *(?!^),?: *(.*))?$` from position `s`. */
function revisionRest(line: string, s: number): Pick<RevisionMatch, 'date' | 'remark'> | null {
  const len = line.length
  let spaces = s
  while (spaces < len && line.charCodeAt(spaces) === 32) spaces++
  let from = spaces
  if (line.charCodeAt(spaces) === 58 /* : */) {
    if (spaces === s) return null
    from = spaces - 1 // give one space back to the date so that `(?!:)` holds
  }
  // The date ends at the first place where ` *,?:` follows, or at the end of the line.
  let to = from
  while (to < len) {
    let q = to
    while (q < len && line.charCodeAt(q) === 32) q++
    const c = line.charCodeAt(q)
    if (q > 0 && (c === 58 || (c === 44 && line.charCodeAt(q + 1) === 58))) {
      let r = q + (c === 44 ? 2 : 1)
      while (r < len && line.charCodeAt(r) === 32) r++
      return { date: [from, to], remark: [r, len] }
    }
    to = q + 1
  }
  return { date: [from, len] }
}

/** Name of an attribute in an attribute list. */
export const AttrNameRx = new RegExp(`[${WORD}][${WORD}\\-.]*`, 'uy')

/** Characters removed from attribute names by Asciidoctor. */
export const InvalidAttributeNameCharsRx = new RegExp(`[^${WORD}\\-]`, 'gu')

export const AdmonitionStyles: ReadonlySet<string> = new Set([
  'NOTE',
  'TIP',
  'IMPORTANT',
  'WARNING',
  'CAUTION',
])

export const ParagraphStyles: ReadonlySet<string> = new Set([
  'comment',
  'example',
  'literal',
  'listing',
  'normal',
  'open',
  'pass',
  'quote',
  'sidebar',
  'source',
  'verse',
  'abstract',
  'partintro',
])

export const VerbatimStyles: ReadonlySet<string> = new Set(['literal', 'listing', 'source', 'verse'])

/** Characters Ruby's String#strip treats as whitespace. */
export function isRubySpace(code: number): boolean {
  return code === 32 || (code >= 9 && code <= 13) || code === 0
}

export function rstrip(s: string): string {
  let end = s.length
  while (end > 0 && isRubySpace(s.charCodeAt(end - 1))) end--
  return end === s.length ? s : s.slice(0, end)
}

export function lstripLength(s: string): number {
  let i = 0
  while (i < s.length && isRubySpace(s.charCodeAt(i))) i++
  return i
}

/** Length in code points, as Ruby's String#length. */
export function charLength(s: string): number {
  let n = 0
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1)
      if (d >= 0xdc00 && d <= 0xdfff) i++
    }
    n++
  }
  return n
}

export function isUniform(s: string, ch: string): boolean {
  for (let i = 0; i < s.length; i++) if (s[i] !== ch) return false
  return s.length > 0
}

/** Ruby's String#to_i for the values Asciidoctor feeds it. */
export function rubyToI(s: string): number {
  const m = /^[ \t\n\v\f\r]*([+-]?\d+)/.exec(s)
  return m ? parseInt(m[1]!, 10) : 0
}

/** Asciidoctor's Parser.sanitize_attribute_name. */
export function sanitizeAttributeName(name: string): string {
  return name.replace(InvalidAttributeNameCharsRx, '').toLowerCase()
}

// ---------------------------------------------------------------- lists


/** Result of the list item matchers: offsets in the (stripped) line. */
export interface ListMatch {
  /** The marker as written (`*`, `**`, `-`, `.`, `1.`, `a.`, `i)`, `<1>`). */
  marker: string
  markerFrom: number
  markerTo: number
  /** Start of the item text (after the blanks that follow the marker). */
  textFrom: number
}

function afterMarker(line: string, end: number): number {
  if (end >= line.length || !isBlank(line.charCodeAt(end))) return -1
  let p = end
  while (p < line.length && isBlank(line.charCodeAt(p))) p++
  return p
}

/** UnorderedListRx `^[ \t]*(-|\*\**|•)[ \t]+(.*)$`. */
export function matchUlist(line: string): ListMatch | null {
  let p = 0
  while (p < line.length && isBlank(line.charCodeAt(p))) p++
  const c = line.charCodeAt(p)
  let end: number
  if (c === 45 /* - */ || c === 0x2022) end = p + 1
  else if (c === 42 /* * */) {
    end = p + 1
    while (line.charCodeAt(end) === 42) end++
  } else return null
  const text = afterMarker(line, end)
  return text < 0 ? null : { marker: line.slice(p, end), markerFrom: p, markerTo: end, textFrom: text }
}

/** OrderedListRx `^[ \t]*(\.\.*|\d+\.|[a-zA-Z]\.|[IVXivx]+\))[ \t]+(.*)$`. */
export function matchOlist(line: string): ListMatch | null {
  let p = 0
  while (p < line.length && isBlank(line.charCodeAt(p))) p++
  const c = line.charCodeAt(p)
  let end = -1
  if (c === 46 /* . */) {
    end = p + 1
    while (line.charCodeAt(end) === 46) end++
  } else if (c >= 48 && c <= 57) {
    end = p + 1
    while (line.charCodeAt(end) >= 48 && line.charCodeAt(end) <= 57) end++
    if (line.charCodeAt(end) === 46) end++
    else end = -1
  } else if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122)) {
    if (line.charCodeAt(p + 1) === 46) end = p + 2
    else if ('IVXivx'.includes(line[p]!)) {
      let q = p + 1
      while (q < line.length && 'IVXivx'.includes(line[q]!)) q++
      if (line.charCodeAt(q) === 41 /* ) */) end = q + 1
    }
  }
  if (end < 0) return null
  const text = afterMarker(line, end)
  return text < 0 ? null : { marker: line.slice(p, end), markerFrom: p, markerTo: end, textFrom: text }
}

/** CalloutListRx `^<(\d+|\.)>[ \t]+(.*)$`; `marker` is `<1>` or `<.>`. */
export function matchColist(line: string): ListMatch | null {
  if (line.charCodeAt(0) !== 60) return null
  let q = 1
  if (line.charCodeAt(1) === 46) q = 2
  else {
    while (line.charCodeAt(q) >= 48 && line.charCodeAt(q) <= 57) q++
    if (q === 1) return null
  }
  if (line.charCodeAt(q) !== 62) return null
  const text = afterMarker(line, q + 1)
  return text < 0 ? null : { marker: line.slice(0, q + 1), markerFrom: 0, markerTo: q + 1, textFrom: text }
}

/** Result of {@link matchDlist}. */
export interface DlistMatch {
  termFrom: number
  termTo: number
  /** `::`, `:::`, `::::` or `;;`. */
  delimiter: string
  delimFrom: number
  delimTo: number
  /** Start of the description text on the same line, or -1 if there is none. */
  textFrom: number
}

/**
 * DescriptionListRx `^(?!//[^/])[ \t]*([^ \t].*?)(:::{0,2}|;;)(?:$|[ \t]+(.*)$)`; with `only`, the sibling
 * regular expression for that delimiter (the term ends with a character other than `:` for the colon
 * delimiters). The term ends at the first place where a delimiter follows that ends the line or is
 * followed by a blank.
 */
export function matchDlist(line: string, only?: string): DlistMatch | null {
  const len = line.length
  if (line.charCodeAt(0) === 47 && line.charCodeAt(1) === 47 && len > 2 && line.charCodeAt(2) !== 47)
    return null
  let ts = 0
  while (ts < len && isBlank(line.charCodeAt(ts))) ts++
  if (ts >= len) return null
  for (let p = ts + 1; p < len; p++) {
    const c = line.charCodeAt(p)
    let delim: string
    if (c === 58 /* : */) {
      if (line.charCodeAt(p + 1) !== 58) continue
      let e = p + 2
      while (e < len && e < p + 4 && line.charCodeAt(e) === 58) e++
      delim = line.slice(p, e)
    } else if (c === 59 /* ; */) {
      if (line.charCodeAt(p + 1) !== 59) continue
      delim = ';;'
    } else continue
    const e = p + delim.length
    if (only !== undefined) {
      if (delim !== only) continue
      if (delim !== ';;') {
        // the term must end with a character that is not a colon (a single character term may not be a blank either)
        if (line.charCodeAt(p - 1) === 58) continue
      }
    }
    if (e < len && !isBlank(line.charCodeAt(e))) continue
    let textFrom = -1
    if (e < len) {
      let q = e
      while (q < len && isBlank(line.charCodeAt(q))) q++
      textFrom = q
    }
    // a run of colons that is longer than the delimiter cannot end here
    return { termFrom: ts, termTo: p, delimiter: delim, delimFrom: p, delimTo: e, textFrom }
  }
  return null
}

/** Whether a line starts a list item of any kind (AnyListRx). */
export function isAnyList(line: string): boolean {
  return (
    matchUlist(line) !== null ||
    matchOlist(line) !== null ||
    matchDlist(line) !== null ||
    matchColist(line) !== null
  )
}

export type OrderedStyle = 'arabic' | 'loweralpha' | 'lowerroman' | 'upperalpha' | 'upperroman'

const ROMAN: readonly [string, number][] = [
  ['M', 1000],
  ['CM', 900],
  ['D', 500],
  ['CD', 400],
  ['C', 100],
  ['XC', 90],
  ['L', 50],
  ['XL', 40],
  ['X', 10],
  ['IX', 9],
  ['V', 5],
  ['IV', 4],
  ['I', 1],
]

export function intToRoman(n: number): string {
  let out = ''
  for (const [l, v] of ROMAN) {
    const r = Math.floor(n / v)
    n -= r * v
    out += l.repeat(r)
  }
  return out
}

/** Parser.resolve_ordered_list_marker: the normalised marker, the implicit style, and a wrong number. */
export function resolveOrderedMarker(
  marker: string,
  ordinal: number,
): { marker: string; style: OrderedStyle | null; expected?: string; actual?: string } {
  if (marker.startsWith('.')) return { marker, style: null }
  const style: OrderedStyle | undefined = /\d+\./.test(marker)
    ? 'arabic'
    : /[a-z]\./.test(marker)
      ? 'loweralpha'
      : /[ivx]+\)/.test(marker)
        ? 'lowerroman'
        : /[A-Z]\./.test(marker)
          ? 'upperalpha'
          : /[IVX]+\)/.test(marker)
            ? 'upperroman'
            : undefined
  let expected: string | undefined
  let actual: string | undefined
  let norm = marker
  switch (style) {
    case 'arabic':
      expected = String(ordinal + 1)
      actual = String(rubyToI(marker))
      norm = '1.'
      break
    case 'loweralpha':
      expected = String.fromCharCode(97 + ordinal)
      actual = marker.slice(0, -1)
      norm = 'a.'
      break
    case 'upperalpha':
      expected = String.fromCharCode(65 + ordinal)
      actual = marker.slice(0, -1)
      norm = 'A.'
      break
    case 'lowerroman':
      expected = intToRoman(ordinal + 1).toLowerCase()
      actual = marker.slice(0, -1)
      norm = 'i)'
      break
    case 'upperroman':
      expected = intToRoman(ordinal + 1)
      actual = marker.slice(0, -1)
      norm = 'I)'
      break
  }
  return { marker: norm, style: style ?? null, ...(expected !== actual ? { expected, actual } : {}) }
}

// ---------------------------------------------------------------- breaks and macros

/** ExtLayoutBreakRx: `'''`, `<<<`, `---`, `- - -`, `***`, `* * *`, `___`, `_ _ _`. */
export function layoutBreak(line: string): 'thematic_break' | 'page_break' | null {
  const c = line.charCodeAt(0)
  if (c === 39 /* ' */) return line.length > 2 && isUniform(line, "'") ? 'thematic_break' : null
  if (c === 60 /* < */) return line.length > 2 && isUniform(line, '<') ? 'page_break' : null
  if (c === 45 || c === 42 || c === 95) return markdownBreak(line, 0) ? 'thematic_break' : null
  return null
}

/** `^ {0,3}([-*_])( *)\1\2\1$` from the first non-blank character (at most `indentMax` blanks). */
function markdownBreak(line: string, indentMax: number): boolean {
  let p = 0
  while (p < line.length && p < indentMax && line.charCodeAt(p) === 32) p++
  const c = line[p]
  if (c !== '-' && c !== '*' && c !== '_') return false
  let q = p + 1
  while (line.charCodeAt(q) === 32) q++
  const gap = q - (p + 1)
  if (line[q] !== c) return false
  let r = q + 1
  while (r < line.length && line.charCodeAt(r) === 32 && r - (q + 1) < gap) r++
  if (r - (q + 1) !== gap) return false
  return line[r] === c && r + 1 === line.length
}

export function isMarkdownThematicBreak(line: string): boolean {
  return markdownBreak(line, 3) && line.slice(0, 4).trimStart().length > 0
}

/** Result of the block macro matchers: offsets in the line. */
export interface MacroMatch {
  name: string
  targetFrom: number
  target: string
  /** Offset of the text between the brackets, and the text (null when empty). */
  attrsFrom: number
  attrs: string | null
}

/**
 * `name::target[attrs]` where the target is empty (if `allowEmpty`) or begins and ends with a character
 * other than a blank (`\S|\S.*?\S`); the target runs to the first `[` that fits.
 */
function macroAt(line: string, name: string, targetFrom: number, allowEmpty: boolean): MacroMatch | null {
  const len = line.length
  if (line.charCodeAt(len - 1) !== 93 /* ] */) return null
  for (let p = line.indexOf('[', targetFrom); p >= 0 && p < len - 1; p = line.indexOf('[', p + 1)) {
    if (p === targetFrom) {
      if (!allowEmpty) continue
    } else if (/\s/u.test(line[targetFrom]!) || /\s/u.test(line[p - 1]!)) continue
    const attrs = line.slice(p + 1, len - 1)
    return {
      name,
      targetFrom,
      target: line.slice(targetFrom, p),
      attrsFrom: p + 1,
      attrs: attrs.length ? attrs : null,
    }
  }
  return null
}

/** BlockMediaMacroRx `^(image|video|audio)::(\S|\S.*?\S)\[(.+)?\]$`. */
export function matchMediaMacro(line: string): MacroMatch | null {
  for (const name of ['image', 'video', 'audio']) {
    if (line.startsWith(name) && line.startsWith('::', name.length))
      return macroAt(line, name, name.length + 2, false)
  }
  return null
}

/** BlockTocMacroRx `^toc::\[(.+)?\]$`. */
export function matchTocMacro(line: string): MacroMatch | null {
  if (!line.startsWith('toc::[') || !line.endsWith(']')) return null
  const attrs = line.slice(6, line.length - 1)
  return { name: 'toc', targetFrom: 5, target: '', attrsFrom: 6, attrs: attrs.length ? attrs : null }
}

const CustomNameRx = new RegExp(`^[${ALPHA}][${WORD}\\-]*(?=::)`, 'u')

/** CustomBlockMacroRx `^(\p{Alpha}[\p{Word}-]*)::(|\S|\S.*?\S)\[(.+)?\]$`. */
export function matchCustomMacro(line: string): MacroMatch | null {
  const m = CustomNameRx.exec(line)
  return m ? macroAt(line, m[0], m[0].length + 2, true) : null
}
