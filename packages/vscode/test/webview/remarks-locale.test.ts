// every code of the engine is told in Russian by the pattern of its message; what does not fit stays as Nota says.
import { parse, type Diagnostic } from '@nota-adoc/core'
import { describe, expect, it } from 'vitest'
import { remarkText } from '../../src/webview/diagnostics.js'

interface Case {
  readonly code: string
  readonly text: string
  /** The Russian text must carry these values. */
  readonly keeps: readonly string[]
  readonly options?: Parameters<typeof parse>[1]
  /** Which of the messages of the code: the position among the diagnostics of the code. */
  readonly at?: number
}

const CASES: readonly Case[] = [
  { code: 'unterminated-block', text: 'text\n\n----\ncode\n', keeps: ['----'] },
  { code: 'unknown-block-macro', text: 'nomacro::target[]\n', keeps: ['nomacro'] },
  { code: 'list-item-as-text', text: 'a line\n* item\n', keeps: [] },
  { code: 'level-0-section-in-article', text: '= Title\n\ntext\n\n= Second\n', keeps: [] },
  { code: 'undefined-attribute', text: ':attribute-missing: warn\n\nSee {nothere}.\n', keeps: ['nothere'] },
  { code: 'malformed-directive', text: 'endif::x[tail]\n', keeps: ['endif::x[tail]'], at: 0 },
  { code: 'malformed-directive', text: 'ifdef::[]\n', keeps: ['ifdef::[]'], at: 0 },
  { code: 'malformed-directive', text: 'ifeval::x[1 == 1]\n', keeps: ['ifeval::x[1 == 1]'], at: 0 },
  { code: 'malformed-directive', text: 'ifeval::[nonsense]\n', keeps: ['ifeval::[nonsense]'], at: 0 },
  { code: 'malformed-directive', text: 'ifeval::[]\n', keeps: ['ifeval::[]'], at: 0 },
  { code: 'unmatched-endif', text: 'endif::x[]\n', keeps: ['endif::x[]'] },
  { code: 'unmatched-endif', text: 'ifdef::a[]\n\ntext\n\nendif::b[]\n', keeps: ['endif::b[]', 'endif::a[]'] },
  { code: 'unterminated-conditional', text: 'ifdef::flag[]\n\ntext\n', keeps: ['ifdef::flag[]'] },
  { code: 'list-item-index', text: '1. a\n3. b\n', keeps: ['3'] },
  { code: 'list-item-index', text: '----\ncode <1>\n----\n<2> note\n', keeps: ['1', '2'] },
  { code: 'table-incomplete-row', text: '[cols="2*"]\n|===\n|a |b\n|c\n|===\n', keeps: [] },
  { code: 'table-cell-dropped', text: '[cols="2*"]\n|===\n|a 3+|b\n|c |d\n|===\n', keeps: [] },
  { code: 'table-missing-separator', text: '|===\ntext\n|a\n|===\n', keeps: [] },
  { code: 'duplicate-id', text: '[#same]\npara\n\n[#same]\nother\n', keeps: ['same'] },
  { code: 'line-read-as-attributes', text: '[just some words]\n', keeps: ['just some words'] },
  { code: 'header-attribute-in-body', text: '= T\n:toc:\n\npara\n\n:toc:\n', keeps: ['toc'] },
  { code: 'unresolved-include', text: 'include::missing.adoc[]\n', keeps: ['missing.adoc'], options: { resolver: { include: () => null } } },
  { code: 'unresolved-reference', text: 'See xref:other.adoc#top[x].\n', keeps: ['other.adoc#top'], options: { resolver: { xref: () => null } } },
  { code: 'unknown-color-role', text: '[.hl-nope]#x#\n', keeps: ['hl-nope'], options: { colorRoles: ['hl-red'] } as never },
]

function find(c: Case): Diagnostic {
  const list = parse(c.text, c.options).diagnostics.filter((d) => d.code === c.code)
  const d = list[c.at ?? 0] ?? list[0]
  if (!d) throw new Error(`no diagnostic ${c.code} in ${JSON.stringify(c.text)}`)
  return d
}

describe('the remarks of the engine by language', () => {
  for (const c of CASES) {
    it(`${c.code}: ${JSON.stringify(c.text.slice(0, 24))}`, () => {
      const d = find(c)
      const ru = remarkText(d, 'ru')
      expect(ru).not.toBe(d.message)
      expect(ru).toMatch(/[А-Яа-яЁё]/)
      for (const v of c.keeps) expect(ru).toContain(v)
      // English: the engine's own text (the two codes the plugin tells itself are English phrases of strings.ts)
      expect(remarkText(d, 'en')).toMatch(/^[^А-Яа-яЁё]+$/)
    })
  }

  it('the table covers every code the spec names', () => {
    const codes = new Set(CASES.map((c) => c.code))
    for (const code of [
      'unterminated-block', 'unknown-block-macro', 'list-item-as-text', 'level-0-section-in-article', 'undefined-attribute',
      'malformed-directive', 'unmatched-endif', 'unterminated-conditional', 'list-item-index', 'table-incomplete-row',
      'table-cell-dropped', 'table-missing-separator', 'duplicate-id', 'line-read-as-attributes', 'header-attribute-in-body',
      'unresolved-include', 'unresolved-reference', 'unknown-color-role',
    ])
      expect(codes.has(code), code).toBe(true)
  })

  it('the skipped level is told by the names of the menu, in both languages', () => {
    const first = parse('= Док\n\n== A\n\n==== B\n').diagnostics.find((d) => d.code === 'section-level-skipped')!
    expect(first.message).toBe('Section title out of sequence: expected level 2, got level 3')
    const title = parse('= Док\n\n==== B\n').diagnostics.find((d) => d.code === 'section-level-skipped')!
    expect(remarkText(first, 'ru')).toBe('Заголовок пропускает уровень: ожидался Заголовок 3 или крупнее, а здесь Заголовок 4')
    expect(remarkText(title, 'ru')).toBe('Заголовок пропускает уровень: ожидался Заголовок 2, а здесь Заголовок 4')
    expect(remarkText(first, 'en')).toBe('The heading skips a level: Heading 3 or larger was expected, this is Heading 4')
    expect(remarkText(title, 'en')).toBe('The heading skips a level: Heading 2 was expected, this is Heading 4')
  })

  it('an unknown code or a message that does not fit the pattern is shown as the engine says it', () => {
    expect(remarkText({ code: 'brand-new-code', message: 'Something new' }, 'ru')).toBe('Something new')
    expect(remarkText({ code: 'duplicate-id', message: 'The wording changed' }, 'ru')).toBe('The wording changed')
    expect(remarkText({ code: 'unresolved-reference', message: 'Odd' }, 'ru')).toBe('Odd')
    expect(remarkText({ code: 'section-level-skipped', message: 'Odd' }, 'ru')).toBe('Odd')
    expect(remarkText({ code: 'brand-new-code', message: 'Something new' }, 'en')).toBe('Something new')
  })
})
