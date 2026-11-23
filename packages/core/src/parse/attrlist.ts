import { AttrNameRx } from './rx.js'

/**
 * One attribute of a block attribute list, as Asciidoctor's AttributeList scanner reads it.
 * Offsets are relative to the start of the list text (the text between the brackets).
 */
export interface AttributeItem {
  /** Zero-based position in the list; positional attributes are keyed by `index + 1`. */
  readonly index: number
  /** Present for named attributes (`name=value`). */
  readonly name?: string
  /** The value: unquoted and unescaped; `null` for an empty trailing positional (`[a,]`). */
  readonly value: string | null
  readonly from: number
  readonly to: number
  readonly nameFrom?: number
  readonly nameTo?: number
  readonly valueFrom?: number
  readonly valueTo?: number
  readonly singleQuoted: boolean
}

const BLANK = /[ \t]+/y
const DELIM_SKIP = /[ \t]*(,|$)/y

const isBlank = (c: number) => c === 32 || c === 9

/**
 * The first index at or after a position where a predicate holds, remembered between calls: a
 * search that started at `start` and stopped at `res` answers every later query in `[start, res]`
 * without scanning again, so repeated failing searches (an unclosed quote per attribute) do not
 * rescan the tail of the line.
 */
class Next {
  private start = 0
  private res = -2 // -2: not searched yet, -1: nothing at or after `start`
  constructor(
    private readonly len: number,
    private readonly holds: (i: number) => boolean,
  ) {}
  at(from: number): number {
    if (this.res !== -2 && from >= this.start && (this.res === -1 || this.res >= from)) return this.res
    if (this.res !== -2 && from < this.start) {
      // Only the stretch before the earlier search is new.
      let i = from
      while (i < this.start && !this.holds(i)) i++
      if (i < this.start) this.res = i
      this.start = from
      return this.res
    }
    let i = from
    while (i < this.len && !this.holds(i)) i++
    this.start = from
    this.res = i < this.len ? i : -1
    return this.res
  }
}

class Scanner {
  pos = 0
  private readonly comma: Next
  private readonly newline: Next
  private readonly dquote: Next
  private readonly squote: Next
  constructor(readonly s: string) {
    const len = s.length
    this.comma = new Next(len, (i) => s.charCodeAt(i) === 44 /* , */)
    this.newline = new Next(len, (i) => s.charCodeAt(i) === 10 /* \n */)
    // A closing quote is a quote not preceded by a backslash, one or more characters in.
    this.dquote = new Next(len, (i) => s.charCodeAt(i) === 34 && s.charCodeAt(i - 1) !== 92)
    this.squote = new Next(len, (i) => s.charCodeAt(i) === 39 && s.charCodeAt(i - 1) !== 92)
  }
  eos(): boolean {
    return this.pos >= this.s.length
  }
  peek(): string {
    return this.s.charAt(this.pos)
  }
  getByte(): string | null {
    return this.pos < this.s.length ? this.s.charAt(this.pos++) : null
  }
  scan(rx: RegExp): string | null {
    rx.lastIndex = this.pos
    const m = rx.exec(this.s)
    if (!m || m.index !== this.pos) return null
    this.pos += m[0].length
    return m[0]
  }
  /**
   * Up to the next comma or the end of the line, without the blanks before it; null when a
   * line feed comes first. Same as the sticky `/[^\n]*?(?=[ \t]*(,|$))/`, which rescans the run
   * of blanks after every character.
   */
  toDelim(): string | null {
    const { s, pos } = this
    let end = this.comma.at(pos)
    if (end < 0) end = s.length
    const nl = this.newline.at(pos)
    if (nl >= 0 && nl < end) return null
    while (end > pos && isBlank(s.charCodeAt(end - 1))) end--
    this.pos = end
    return s.slice(pos, end)
  }
  /**
   * Up to the next quote not preceded by a backslash, at least one character in, without a line
   * feed before the last of those characters; null when there is none. Same as the sticky
   * `/[^\n]*?[^\\](?=")/` (or with `'`), which fails only after scanning the whole tail.
   */
  toQuote(quote: string): string | null {
    const { s, pos } = this
    const q = (quote === '"' ? this.dquote : this.squote).at(pos + 1)
    if (q < 0) return null
    const nl = this.newline.at(pos)
    if (nl >= 0 && nl < q - 1) return null
    this.pos = q
    return s.slice(pos, q)
  }
}

/** Port of Asciidoctor's AttributeList#parse with source spans. */
export function parseAttributeList(source: string): AttributeItem[] {
  const sc = new Scanner(source)
  const items: AttributeItem[] = []
  let index = 0
  for (;;) {
    const cont = parseAttribute(sc, index, items)
    if (cont === 'stop') break
    if (cont === 'last' || sc.eos()) break
    sc.scan(DELIM_SKIP)
    index++
  }
  return items
}

function parseQuoted(sc: Scanner, quote: string): string {
  if (sc.peek() === quote) {
    sc.getByte()
    return ''
  }
  const value = sc.toQuote(quote)
  if (value !== null) {
    sc.getByte()
    return value.includes('\\') ? value.split('\\' + quote).join(quote) : value
  }
  return quote + (sc.toDelim() ?? '')
}

function parseAttribute(sc: Scanner, index: number, items: AttributeItem[]): 'stop' | 'last' | 'more' {
  let cont: 'last' | 'more' = 'more'
  sc.scan(BLANK)
  const from = sc.pos
  let name: string | null
  let value: string | null = null
  let singleQuoted = false
  const nameFrom = from
  let nameTo = from
  let valueFrom = -1
  const c0 = sc.peek()
  if (c0 === '"') {
    sc.getByte()
    name = parseQuoted(sc, '"')
  } else if (c0 === "'") {
    sc.getByte()
    name = parseQuoted(sc, "'")
    if (!name.startsWith("'")) singleQuoted = true
  } else {
    name = sc.scan(AttrNameRx)
    nameTo = sc.pos
    let skipped = 0
    if (name !== null) skipped = (sc.scan(BLANK) ?? '').length
    if (sc.eos()) {
      if (name === null && !rstripEndsWithComma(sc.s)) return 'stop'
      cont = 'last'
    } else {
      const c = sc.getByte()!
      if (c === ',') {
        sc.pos--
      } else if (name !== null) {
        if (c === '=') {
          sc.scan(BLANK)
          valueFrom = sc.pos
          const q = sc.getByte()
          if (q === '"') {
            value = parseQuoted(sc, '"')
          } else if (q === "'") {
            value = parseQuoted(sc, "'")
            if (!value.startsWith("'")) singleQuoted = true
          } else if (q === ',') {
            value = ''
            sc.pos--
          } else if (q === null) {
            value = ''
          } else {
            value = q + (sc.toDelim() ?? '')
            if (value === 'None') return 'more'
          }
        } else {
          name = name + ' '.repeat(skipped) + c + (sc.toDelim() ?? '')
          nameTo = sc.pos
        }
      } else {
        name = c + (sc.toDelim() ?? '')
        nameTo = sc.pos
      }
    }
  }
  const to = sc.pos
  if (value !== null) {
    items.push({
      index,
      name: name!,
      value,
      from,
      to,
      nameFrom,
      nameTo,
      valueFrom: valueFrom < 0 ? to : valueFrom,
      valueTo: to,
      singleQuoted,
    })
  } else {
    items.push({ index, value: name, from, to, singleQuoted })
  }
  return cont
}

function rstripEndsWithComma(s: string): boolean {
  let end = s.length
  while (end > 0 && /[\s\0]/.test(s.charAt(end - 1))) end--
  return end > 0 && s.charAt(end - 1) === ','
}

/** A shorthand part of the first positional attribute: `style#id.role%option`. */
export interface ShorthandPart {
  readonly kind: 'style' | 'id' | 'role' | 'option'
  readonly value: string
  /** Offsets within the attribute value, including the sigil. */
  readonly from: number
  readonly to: number
}

/**
 * Splits the first positional attribute into shorthand parts, as Asciidoctor's
 * Parser.parse_style_attribute does. Returns null when the value is not shorthand.
 */
export function parseShorthand(raw: string): ShorthandPart[] | null {
  if (raw.includes(' ')) return null
  if (!/[.#%]/.test(raw)) return null
  const parts: ShorthandPart[] = []
  let kind: ShorthandPart['kind'] = 'style'
  let start = 0
  const flush = (end: number) => {
    const valueStart = kind === 'style' ? start : start + 1
    parts.push({ kind, value: raw.slice(valueStart, end), from: start, to: end })
  }
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i]
    if (c === '.' || c === '#' || c === '%') {
      flush(i)
      kind = c === '.' ? 'role' : c === '#' ? 'id' : 'option'
      start = i
    }
  }
  flush(raw.length)
  return parts
}

/**
 * Block attributes accumulated from the metadata lines above a block, merged the way
 * Asciidoctor merges them (later lines win; the style survives lines without a first positional).
 */
export class BlockAttributes {
  /** Positional attributes by 1-based index, plus named attributes and derived keys. */
  readonly attributes = new Map<string, string | null>()
  style: string | null = null
  /** The first positional of the last line was empty: there is no style, but the `style` attribute is still there. */
  wiped = false
  id: string | null = null
  title: string | null = null
  reftext: string | null = null

  /** The `style` the block reports as its own: the attribute, which outlives a wiped style (`[,ruby]` under `[quote]`). */
  get shownStyle(): string | null {
    return this.wiped ? (this.attributes.get('style') ?? null) : this.style
  }

  /** Applies one `[...]` line; `source` is the text between the brackets. */
  applyList(source: string): void {
    const attrs = this.attributes
    const items = parseAttributeList(source)
    for (const item of items) {
      if (item.name !== undefined) {
        const name = item.name
        const value = item.value ?? ''
        if (name === 'options' || name === 'opts') {
          const list = value.includes(',') ? value.replace(/ /g, '').split(',') : [value]
          for (const opt of list) if (opt) attrs.set(`${opt}-option`, '')
        } else {
          attrs.set(name, value)
          if (name === 'id') this.id = value
          if (name === 'reftext') this.reftext = value
          if (name === 'title') this.title = value
        }
      } else {
        attrs.set(String(item.index + 1), item.value)
      }
    }
    const current = this.style
    const raw = attrs.get('1')
    if (raw) {
      const style = this.applyStyle(raw)
      this.style = style ?? current
      this.wiped = false
      attrs.set('1', this.style)
    } else if (raw !== undefined && items.some((i) => i.name === undefined && i.index === 0)) {
      // the list has a first positional, and it is empty (`[,ruby]`, `[\"\"]`): it wipes the style of the lines
      // above (Parser.parse_block_metadata_line takes the first positional of the last line, whatever it is)
      // (the `style` attribute keeps what the lines above said, or is empty: the blocks that do not take the style for
      // their context still show it)
      this.style = null
      this.wiped = true
      if (raw === '') attrs.set('style', '')
    }
  }

  private applyStyle(raw: string): string | null {
    const parts = parseShorthand(raw)
    if (!parts) {
      this.attributes.set('style', raw)
      return raw
    }
    let style: string | null = null
    const roles: string[] = []
    for (const p of parts) {
      if (!p.value) continue
      if (p.kind === 'style') style = p.value
      else if (p.kind === 'id') this.id = p.value
      else if (p.kind === 'role') roles.push(p.value)
      else this.attributes.set(`${p.value}-option`, '')
    }
    if (style !== null) this.attributes.set('style', style)
    if (this.id !== null) this.attributes.set('id', this.id)
    if (roles.length) {
      const existing = this.attributes.get('role')
      this.attributes.set('role', existing ? `${existing} ${roles.join(' ')}` : roles.join(' '))
    }
    return style
  }

  applyAnchor(id: string | null, reftext: string | null): void {
    if (id !== null) {
      this.id = id
      this.attributes.set('id', id)
    }
    if (reftext !== null) {
      this.reftext = reftext
      this.attributes.set('reftext', reftext)
    }
  }

  applyTitle(title: string): void {
    this.title = title
  }
}
