import { describe, expect, it } from 'vitest'
import { parse } from '@nota-adoc/core'
import {
  AttributeEntryRx,
  SetextSectionTitleRx,
  isBlockAttributeLine,
  isManpageNameLine,
  matchAtxSectionTitle,
  matchRevisionInfoLine,
} from '../src/parse/rx.js'
import { bestMs } from './timing.js'

// The regular expressions the matchers replace. They are kept here only as the oracle: they are
// ported from Asciidoctor and are quadratic on long runs of spaces or colons.
const ANY = '[^\\n]'
const AtxOracle = new RegExp(`^(={1,6}|#{1,6})[ \\t]+(${ANY}+?)(?:[ \\t]+\\1)?$`, 'du')
const WORD = '\\p{Alphabetic}\\p{M}\\p{Nd}\\p{Pc}'
const ALPHA = '\\p{Alphabetic}'
const BlockAttributeLineOracle = new RegExp(
  `^\\[(?:|[${WORD}.#%{,"']${ANY}*|\\[(?:|[${ALPHA}_:][${WORD}\\-:.]*(?:, *${ANY}+)?)\\])\\]$`,
  'u',
)
const ManpageNameOracle = /^[^\n]+? +- +[^\n]+$/
const RevisionOracle = new RegExp(
  `^(?:[^\\d{]*(${ANY}*?),)? *(?!:)(${ANY}*?)(?: *(?!^),?: *(${ANY}*))?$`,
  'du',
)

const SetextOracle = new RegExp(`^(?!\\.)${ANY}*?[${ALPHA}\\p{Nd}]${ANY}*$`, 'u')
const AttributeEntryOracle = new RegExp(`^:(!?[${WORD}][^:]*):(?:[ \\t]+(${ANY}*))?$`, 'du')

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

function range(ind: readonly [number, number] | undefined): [number, number] | undefined {
  return ind ? [ind[0], ind[1]] : undefined
}

describe('matchAtxSectionTitle', () => {
  it('finds marker, title and closing marker', () => {
    expect(matchAtxSectionTitle('== Title')).toEqual({ markerEnd: 2, titleFrom: 3, titleTo: 8 })
    expect(matchAtxSectionTitle('== Title ==')).toEqual({ markerEnd: 2, titleFrom: 3, titleTo: 8 })
    expect(matchAtxSectionTitle('##\tA  ##')).toEqual({ markerEnd: 2, titleFrom: 3, titleTo: 4 })
    expect(matchAtxSectionTitle('==Title')).toBeNull()
    expect(matchAtxSectionTitle('======= Title')).toBeNull()
  })

  it('agrees with the regular expression on every short line', () => {
    let n = 0
    for (const line of strings(['=', '#', ' ', '\t', 'a'], 8)) {
      const m = AtxOracle.exec(line)
      const got = matchAtxSectionTitle(line)
      const want = m
        ? { markerEnd: m[1]!.length, titleFrom: m.indices![2]![0], titleTo: m.indices![2]![1] }
        : null
      if (JSON.stringify(got) !== JSON.stringify(want)) {
        expect({ line, got }).toEqual({ line, got: want })
      }
      n++
    }
    expect(n).toBeGreaterThan(400_000)
  })
})

describe('matchRevisionInfoLine', () => {
  it('splits number, date and remark', () => {
    expect(matchRevisionInfoLine('v1.0, 2026-09-25: note')).toEqual({
      number: [1, 4],
      date: [6, 16],
      remark: [18, 22],
    })
    expect(matchRevisionInfoLine(':x')).toBeNull()
  })

  it('agrees with the regular expression on every short line', () => {
    let n = 0
    for (const line of strings([' ', ',', ':', '1', 'v', '{', 'x'], 7)) {
      const m = RevisionOracle.exec(line)
      const got = matchRevisionInfoLine(line)
      const want = m
        ? { number: range(m.indices![1]), date: range(m.indices![2]), remark: range(m.indices![3]) }
        : null
      if (JSON.stringify(got) !== JSON.stringify(want)) {
        expect({ line, got }).toEqual({ line, got: want })
      }
      n++
    }
    expect(n).toBeGreaterThan(900_000)
  })
})

describe('isBlockAttributeLine', () => {
  it('recognises attribute lists and anchors', () => {
    for (const line of ['[]', '[a]', '[#id.role]', '[[a]]', '[[a,ref]]', '[[]]', '[,a]'])
      expect(isBlockAttributeLine(line), line).toBe(true)
    for (const line of ['', '[', 'a]', '[ a]', '[[a b]]', '[[1]]', '[[a,]]', '[a\nb]'])
      expect(isBlockAttributeLine(line), line).toBe(false)
  })

  it('agrees with the regular expression on every short line', () => {
    let n = 0
    const alphabets = [
      ['[', ']', 'a', '1', ',', ' ', ':', '-', '\n'],
      ['[', ']', 'a', '.', '-', ',', ' ', '_'],
      ['[', ']', 'a', ',', ' '],
    ]
    const lengths = [6, 7, 8]
    alphabets.forEach((alphabet, k) => {
      for (const line of strings(alphabet, lengths[k]!)) {
        const got = isBlockAttributeLine(line)
        const want = BlockAttributeLineOracle.test(line)
        if (got !== want) expect({ line, got }).toEqual({ line, got: want })
        n++
      }
    })
    expect(n).toBeGreaterThan(100_000)
  })

  it('takes letters and marks beyond ASCII', () => {
    for (const line of ['[é]', '[\u{1F600}]', '[[é,x]]', '[[\u{10400}]]', '[\u{1F600}a]'])
      expect(isBlockAttributeLine(line), line).toBe(BlockAttributeLineOracle.test(line))
  })
})

describe('isManpageNameLine', () => {
  it('needs a name, a spaced hyphen and a purpose', () => {
    expect(isManpageNameLine('cmd - does things')).toBe(true)
    expect(isManpageNameLine('cmd, other  -  does things')).toBe(true)
    expect(isManpageNameLine('cmd -does things')).toBe(false)
    expect(isManpageNameLine(' - x')).toBe(false)
    expect(isManpageNameLine('cmd - ')).toBe(false)
  })

  it('agrees with the regular expression on every short text', () => {
    let n = 0
    for (const text of strings([' ', '-', 'a', '\n'], 9)) {
      const got = isManpageNameLine(text)
      const want = ManpageNameOracle.test(text)
      if (got !== want) expect({ text, got }).toEqual({ text, got: want })
      n++
    }
    expect(n).toBeGreaterThan(100_000)
  })
})

describe('long lines parse in linear time', () => {
  const S = ' '
  const T = '\t'
  const cases: Record<string, string> = {
    'section title, spaces': '== a' + S.repeat(49_995) + 'b\n',
    'section title, tabs': '== a' + T.repeat(49_995) + 'b\n',
    'markdown title, spaces': '## a' + S.repeat(49_995) + 'b\n',
    'revision line, digit and spaces': '= T\nA B\n1' + S.repeat(49_990) + 'x\n',
    'revision line, colons': '= T\nA B\n' + ':'.repeat(50_000) + '\n',
    'revision line, commas and spaces': '= T\nA B\nv' + ', '.repeat(25_000) + 'x\n',
    'revision line, colons and spaces': '= T\nA B\n1' + ' :'.repeat(25_000) + '\n',
    'block anchor line, spaces after a comma': 'para\n[[a,' + S.repeat(50_000) + 'x\n',
    'block anchor line, repeated anchors': 'para\n[[a,' + ' [[a,x'.repeat(8_000) + '\n',
    'block anchor with reference text, spaces': '[[a,' + S.repeat(50_000) + 'x]]\npara\n',
    'manpage name, spaces': ':doctype: manpage\n= cmd(1)\n\n== NAME\n\na' + S.repeat(50_000) + 'b\n',
    'manpage name, hyphens and spaces':
      ':doctype: manpage\n= cmd(1)\n\n== NAME\n\na' + ' -'.repeat(25_000) + 'b\n',
  }
  for (const [name, text] of Object.entries(cases)) {
    it(`${name}: under 300 ms`, () => {
      const ms = bestMs(() => void parse(text).tree)
      expect(ms).toBeLessThan(300)
    })
  }
})

describe('regular expressions that take one line', () => {
  const elapsed = (f: () => void) => bestMs(f)

  // Without the check for a line feed at the start, both of these inputs take seconds: the regular
  // expression backtracks over every split of the line before it reaches the line feed.
  it('SetextSectionTitleRx answers at once when the input has a line feed', () => {
    let matched = true
    expect(elapsed(() => (matched = SetextSectionTitleRx.test('a'.repeat(80_000) + '\n')))).toBeLessThan(300)
    expect(matched).toBe(false)
  })

  it('AttributeEntryRx answers at once when the input has a line feed', () => {
    let entry: RegExpExecArray | null = null
    expect(elapsed(() => (entry = AttributeEntryRx.exec(':a:' + ' '.repeat(80_000) + '\n')))).toBeLessThan(
      300,
    )
    expect(entry).toBeNull()
  })

  it('SetextSectionTitleRx agrees with the earlier expression on every short line, and never matches a line feed', () => {
    let n = 0
    for (const line of strings(['.', 'a', '1', ' ', '-', '=', '\n'], 7)) {
      const want = line.includes('\n') ? false : SetextOracle.test(line)
      if (SetextSectionTitleRx.test(line) !== want) expect({ line, want }).toEqual({ line, want: !want })
      n++
    }
    expect(n).toBeGreaterThan(100_000)
  })

  it('AttributeEntryRx agrees with the earlier expression on every short line, and never matches a line feed', () => {
    let n = 0
    for (const line of strings([':', '!', 'a', ' ', '\t', '-', '\n'], 6)) {
      const m = line.includes('\n') ? null : AttributeEntryOracle.exec(line)
      const got = AttributeEntryRx.exec(line)
      const shape = (r: RegExpExecArray | null) =>
        r && { groups: [r[1], r[2]], indices: [range(r.indices![1]), range(r.indices![2])] }
      if (JSON.stringify(shape(got)) !== JSON.stringify(shape(m))) {
        expect({ line, got: shape(got) }).toEqual({ line, got: shape(m) })
      }
      n++
    }
    expect(n).toBeGreaterThan(100_000)
  })
})
