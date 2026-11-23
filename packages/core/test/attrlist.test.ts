import { describe, expect, it } from 'vitest'
import { BlockAttributes, parse, parseAttributeList, type AttributeItem } from '@nota-adoc/core'
import { AttrNameRx } from '../src/parse/rx.js'
import { bestMs } from './timing.js'

// ---------------------------------------------------------------------------------------------
// The oracle: `parseAttributeList` as first released, with the regular expressions
// TO_DELIM, TO_DQUOTE and TO_SQUOTE. They are quadratic on long lines (a lazy run followed by a
// look-ahead that rescans the tail), which is why the scanner was rewritten; the results must not
// change, so the old code is kept here, unchanged, to compare against.
// ---------------------------------------------------------------------------------------------

const BLANK = /[ \t]+/y
const DELIM_SKIP = /[ \t]*(,|$)/y
const TO_DELIM = /[^\n]*?(?=[ \t]*(,|$))/y
const TO_DQUOTE = /[^\n]*?[^\\](?=")/y
const TO_SQUOTE = /[^\n]*?[^\\](?=')/y

class Scanner {
  pos = 0
  constructor(readonly s: string) {}
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
}

/** Port of Asciidoctor's AttributeList#parse with source spans. */
function oracleParseAttributeList(source: string): AttributeItem[] {
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
  const value = sc.scan(quote === '"' ? TO_DQUOTE : TO_SQUOTE)
  if (value !== null) {
    sc.getByte()
    return value.includes('\\') ? value.split('\\' + quote).join(quote) : value
  }
  return quote + (sc.scan(TO_DELIM) ?? '')
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
            value = q + (sc.scan(TO_DELIM) ?? '')
            if (value === 'None') return 'more'
          }
        } else {
          name = name + ' '.repeat(skipped) + c + (sc.scan(TO_DELIM) ?? '')
          nameTo = sc.pos
        }
      } else {
        name = c + (sc.scan(TO_DELIM) ?? '')
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

function* strings(alphabet: readonly string[], maxLength: number): Generator<string> {
  let level: string[] = ['']
  yield ''
  for (let n = 1; n <= maxLength; n++) {
    const next: string[] = []
    for (const s of level) for (const c of alphabet) next.push(s + c)
    for (const s of next) yield s
    level = next
  }
}

describe('parseAttributeList', () => {
  it('reads positional, named and quoted attributes with their spans', () => {
    const items = parseAttributeList('source, ruby,linenums="a,b" , x=\'y\'')
    expect(items.map((i) => [i.index, i.name, i.value])).toEqual([
      [0, undefined, 'source'],
      [1, undefined, 'ruby'],
      [2, 'linenums', 'a,b'],
      [3, 'x', 'y'],
    ])
  })

  it('agrees with the first version on every short list', () => {
    let n = 0
    for (const s of strings(['a', '=', '"', "'", ',', ' ', '\t', '\\', '#'], 6)) {
      const got = parseAttributeList(s)
      const want = oracleParseAttributeList(s)
      if (JSON.stringify(got) !== JSON.stringify(want)) {
        expect({ s, got }).toEqual({ s, got: want })
      }
      n++
    }
    expect(n).toBeGreaterThanOrEqual(500_000)
  })

  it('agrees with the first version on longer generated lists', () => {
    // Deterministic pseudo-random strings over the same alphabet, longer than the exhaustive run.
    const alphabet = ['a', 'b', '=', '"', "'", ',', ' ', '\t', '\\', '#', 'None', '\n']
    let seed = 12345
    const rnd = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296
    for (let i = 0; i < 100_000; i++) {
      let s = ''
      const len = 7 + Math.floor(rnd() * 24)
      for (let k = 0; k < len; k++) s += alphabet[Math.floor(rnd() * alphabet.length)]
      const got: AttributeItem[] = parseAttributeList(s)
      const want = oracleParseAttributeList(s)
      if (JSON.stringify(got) !== JSON.stringify(want)) {
        expect({ s, got }).toEqual({ s, got: want })
      }
    }
  })
})

describe('attribute lists parse in linear time', () => {
  const cases: Record<string, string> = {
    'tabs after an opening quote': '[a="' + '\t'.repeat(49_994) + 'x]]\npara\n',
    'spaces after a shorthand sigil': '[#a' + ' '.repeat(50_000) + 'x]\npara\n',
    'many unclosed double quotes': '[a' + ',b="x'.repeat(10_000) + ']\npara\n',
    'many unclosed single quotes': '[a' + ",c='x".repeat(10_000) + ']\npara\n',
  }
  for (const [name, text] of Object.entries(cases)) {
    it(`${name}: under 300 ms`, () => {
      const ms = bestMs(() => void parse(text).tree)
      expect(ms).toBeLessThan(300)
    })
  }
})

describe('BlockAttributes: an empty first positional in a later line', () => {
  const lines = (...ls: string[]) => {
    const a = new BlockAttributes()
    for (const l of ls) a.applyList(l)
    return a
  }

  it('wipes the style of the lines above, and the style attribute stays for the blocks that show it', () => {
    const a = lines('quote', ',ruby')
    expect(a.style).toBeNull()
    expect(a.wiped).toBe(true)
    expect(a.shownStyle).toBe('quote')
    expect(a.attributes.get('2')).toBe('ruby')
  })

  it('does not wipe it without a first positional, or with a shorthand that has no style', () => {
    expect(lines('quote', 'role=x').style).toBe('quote')
    expect(lines('quote', '.role').style).toBe('quote')
    expect(lines('quote', '.role').wiped).toBe(false)
  })

  it('takes a style that comes after the wiping line', () => {
    const a = lines('quote', ',ruby', 'verse')
    expect(a.style).toBe('verse')
    expect(a.shownStyle).toBe('verse')
  })
})
