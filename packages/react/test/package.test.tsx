// the strings, the choice of the language, the shape of the package.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as api from '@nota-adoc/react'

const pkg = JSON.parse(readFileSync(join(import.meta.dirname, '../package.json'), 'utf8')) as Record<string, Record<string, string>>

describe('the package', () => {
  it('has React as a peer and only packages of @nota-adoc in dependencies', () => {
    expect(Object.keys(pkg.dependencies!).every((name) => name.startsWith('@nota-adoc/'))).toBe(true)
    expect(Object.keys(pkg.peerDependencies!)).toEqual(expect.arrayContaining(['react', 'react-dom']))
  })

  it('exports the components, the strings and the choice of the language', () => {
    for (const name of ['Toolbar', 'BubbleMenu', 'LinkPopover', 'ColorPopover', 'messages', 'pickLocale'])
      expect(api, name).toHaveProperty(name)
  })
})

describe('the language', () => {
  it('is Russian for a code that starts with ru and English for any other', () => {
    for (const code of ['ru', 'ru-RU', 'RU', 'ru_RU']) expect(api.pickLocale(code)).toBe('ru')
    for (const code of ['en', 'en-US', 'de', 'zh-cn', 'fr', '', undefined, null, 'rus', 'run']) expect(api.pickLocale(code)).toBe('en')
  })

  it('has the same keys in both languages, and English without Cyrillic', () => {
    const { ru, en } = api.messages
    expect(Object.keys(en).sort()).toEqual(Object.keys(ru).sort())
    expect(Object.keys(en.reject).sort()).toEqual(Object.keys(ru.reject).sort())
    expect(Object.keys(en.colors)).toEqual(Object.keys(ru.colors))
    expect(Object.keys(en.fills)).toEqual(Object.keys(ru.fills))
    const text = (m: typeof en): string[] =>
      Object.values(m).flatMap((v): string[] =>
        typeof v === 'string' ? [v] : typeof v === 'function' ? [(v as (n: number) => string)(2)] : Object.values(v as Record<string, string>),
      )
    expect(text(en).filter((s) => /[А-Яа-яЁё]/.test(s))).toEqual([])
    expect(en.heading(3)).toBe('Heading 3')
    expect(ru.heading(3)).toBe('Заголовок 3')
  })

  it('tells every code of a refusal of the editor in both languages', () => {
    for (const code of ['link-across-blocks', 'link-overlap', 'bad-target', 'empty-selection', 'no-link', 'not-editable', 'inside-construct', 'not-colorable', 'unstable'])
      for (const locale of ['ru', 'en'] as const) expect(api.messages[locale].reject[code], `${locale} ${code}`).toBeTruthy()
    expect(api.messages.ru.reject['empty-selection']).toBe('Сначала выделите текст.')
  })
})
