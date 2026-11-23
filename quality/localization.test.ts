// The words of Nota are in two languages in several places (CONTRIBUTING.md, «Localization»): a key that one language has and the
// other lacks, a Cyrillic letter in an English text, a README of the extension that has fallen behind its twin: each turns this red.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { messages } from '../packages/react/src/messages.js'
import { phrases, pickLocale, resolveLocale, strings } from '../packages/vscode/src/strings.js'
import { dictionary, languageOf } from '../demo/src/i18n.js'
import { labelsOf, messagesOf } from '../demo/src/messages.js'

const root = join(import.meta.dirname, '..')
const read = (path: string): string => readFileSync(join(root, path), 'utf8')
const json = (path: string): Record<string, string> => JSON.parse(read(path)) as Record<string, string>
const CYRILLIC = /[Ѐ-ӿ]/

/** The paths of everything a dictionary holds: a function (a word with a hole) is a leaf, as a string is. */
function keysOf(value: unknown, prefix = ''): string[] {
  if (value === null || typeof value !== 'object') return [prefix]
  return Object.entries(value).flatMap(([key, inner]) => keysOf(inner, prefix ? `${prefix}.${key}` : key))
}

/** The texts of a dictionary: strings as they are, functions as they answer for a few arguments. */
function textsOf(value: unknown, path = ''): Array<[string, string]> {
  if (typeof value === 'string') return [[path, value]]
  if (typeof value === 'function') {
    const out: Array<[string, string]> = []
    for (const args of [[1, 2, 3], ['a', 'b', 'c'], [true], [1_500_000]]) {
      try {
        const text = (value as (...a: unknown[]) => unknown)(...args)
        if (typeof text === 'string') out.push([path, text])
      } catch {
        // this call does not fit the function
      }
    }
    return out
  }
  if (value === null || typeof value !== 'object') return []
  return Object.entries(value).flatMap(([key, inner]) => textsOf(inner, path ? `${path}.${key}` : key))
}

const sorted = (keys: string[]): string[] => [...keys].sort()

describe('localization: the two languages have the same keys', () => {
  const pairs: Array<[string, unknown, unknown]> = [
    ['strings of the extension (packages/vscode/src/strings.ts)', strings.ru, strings.en],
    ['messages of the panel (packages/react/src/messages.ts)', messages.ru, messages.en],
    ['dictionary of the demo (demo/src/i18n.ts)', dictionary.ru, dictionary.en],
    ['refusals of the demo (demo/src/messages.ts)', messagesOf('ru'), messagesOf('en')],
    ['labels of the demo (demo/src/messages.ts)', labelsOf('ru'), labelsOf('en')],
    ['manifest (package.nls.json, package.nls.ru.json)', json('packages/vscode/package.nls.ru.json'), json('packages/vscode/package.nls.json')],
  ]
  for (const [name, ru, en] of pairs) {
    it(name, () => {
      const inRu = sorted(keysOf(ru))
      const inEn = sorted(keysOf(en))
      expect(inRu.length).toBeGreaterThan(5)
      expect(inEn.filter((k) => !inRu.includes(k)), 'only in English').toEqual([])
      expect(inRu.filter((k) => !inEn.includes(k)), 'only in Russian').toEqual([])
    })
  }

  it('a key missing in one language is seen by the comparison', () => {
    const ru = { a: 'а', b: { c: 'б', d: () => 'в' } }
    const en = { a: 'a', b: { c: 'b' } }
    expect(sorted(keysOf(ru))).not.toEqual(sorted(keysOf(en)))
  })

  it('every %key% of the manifest is in both files of the manifest', () => {
    const manifest = read('packages/vscode/package.json')
    const used = [...new Set([...manifest.matchAll(/"%([\w.]+)%"/g)].map((m) => m[1]!))]
    expect(used.length).toBeGreaterThan(10)
    for (const file of ['package.nls.json', 'package.nls.ru.json']) {
      const nls = json(`packages/vscode/${file}`)
      for (const key of used) expect(nls, `${file}: ${key}`).toHaveProperty(key)
    }
  })

  it('phrases.en is empty on purpose: the phrases of CodeMirror are English', () => {
    expect(phrases.en).toEqual({})
    expect(Object.keys(phrases.ru).length).toBeGreaterThan(0)
  })
})

describe('localization: the English values have no Cyrillic', () => {
  const dictionaries: Array<[string, unknown]> = [
    ['strings.en', strings.en],
    ['messages.en', messages.en],
    ['demo dictionary', dictionary.en],
    ['demo refusals', messagesOf('en')],
    ['demo labels', labelsOf('en')],
    ['package.nls.json', json('packages/vscode/package.nls.json')],
  ]
  for (const [name, value] of dictionaries) {
    it(name, () => {
      const texts = textsOf(value)
      expect(texts.length).toBeGreaterThan(5)
      for (const [path, text] of texts) expect(CYRILLIC.test(text), `${name}: ${path}: ${text}`).toBe(false)
    })
  }

  it('and the Russian ones do have it, so that the check can fail', () => {
    expect(textsOf(strings.ru).some(([, text]) => CYRILLIC.test(text))).toBe(true)
    expect(textsOf(dictionary.ru).some(([, text]) => CYRILLIC.test(text))).toBe(true)
  })
})

describe('localization: the defaults', () => {
  it('English unless the language is Russian', () => {
    expect(resolveLocale(undefined, 'en')).toBe('en')
    expect(resolveLocale('xx', 'de')).toBe('en')
    expect(resolveLocale(undefined, 'ru-RU')).toBe('ru')
    expect(resolveLocale(undefined, 'ru')).toBe('ru')
    expect(resolveLocale(undefined, 'zh-cn')).toBe('en')
    expect(resolveLocale('auto', 'de')).toBe('en')
    expect(resolveLocale('garbage', 'ru')).toBe('ru')
    expect(resolveLocale('ru', 'en')).toBe('ru')
    expect(resolveLocale('en', 'ru-RU')).toBe('en')
    expect(resolveLocale(42, undefined)).toBe('en')
    expect(pickLocale('ru_RU')).toBe('ru')
  })

  it('the setting nota.language is auto by default', () => {
    const prop = JSON.parse(read('packages/vscode/package.json')).contributes.configuration.properties['nota.language']
    expect(prop.default).toBe('auto')
    expect(prop.enum).toEqual(['ru', 'en', 'auto'])
  })

  it('the demo reads the language of the browser the same way', () => {
    expect(languageOf('en-US')).toBe('en')
    expect(languageOf('de')).toBe('en')
    expect(languageOf('ru-RU')).toBe('ru')
    expect(languageOf(undefined)).toBe('en')
  })
})

describe('localization: the README of the extension in two languages', () => {
  const en = read('packages/vscode/README.md')
  const ru = read('packages/vscode/README.ru.md')
  /** The headings outside the fenced blocks: their levels. */
  const headings = (text: string): string[] => {
    let fenced = false
    const out: string[] = []
    for (const line of text.split('\n')) {
      if (line.startsWith('```')) fenced = !fenced
      else if (!fenced && /^#{1,6} /.test(line)) out.push(/^#+/.exec(line)![0])
    }
    return out
  }
  const names = (text: string): string[] => [...new Set([...text.matchAll(/nota\.\w+/g)].map((m) => m[0]))].sort()

  it('have the same number and levels of headings, and the same nota.* names', () => {
    expect(headings(en).length).toBeGreaterThan(2)
    expect(headings(ru)).toEqual(headings(en))
    expect(names(en)).toEqual(expect.arrayContaining(['nota.language', 'nota.pageWidth', 'nota.outlineView', 'nota.showAnchors', 'nota.blocksInCapsule']))
    expect(names(ru)).toEqual(names(en))
  })

  it('the English one has no Cyrillic besides the link to the Russian one', () => {
    const rest = en.replace('[Русская версия](README.ru.md)', '')
    expect(CYRILLIC.test(rest), (/.*[Ѐ-ӿ].*/.exec(rest) ?? [''])[0]).toBe(false)
    expect(en).toContain('](README.ru.md)')
    expect(ru).toContain('](README.md)')
    expect(CYRILLIC.test(ru)).toBe(true)
  })

  it('the setting nota.language is described as auto by default in both', () => {
    expect(en).toMatch(/`nota\.language`: `auto` \(the default/)
    expect(ru).toMatch(/`nota\.language`: `auto` \(по умолчанию/)
  })

  it('the root README links to the Russian one in the section «VS Code extension»', () => {
    const readme = read('README.md')
    const section = readme.slice(readme.indexOf('## VS Code extension'), readme.indexOf('## Development'))
    expect(section).toContain('](packages/vscode/README.ru.md)')
  })
})

describe('localization: CONTRIBUTING.md', () => {
  it('has the section «Localization» with the places, the choice of the language, the rule and the reason', () => {
    const text = read('CONTRIBUTING.md')
    const section = text.slice(text.indexOf('## Localization'), text.indexOf('## Quality tools'))
    expect(section.length).toBeGreaterThan(500)
    for (const part of ['packages/vscode/src/strings.ts', 'packages/react/src/messages.ts', 'package.nls.json', 'package.nls.ru.json', 'demo/src/i18n.ts', 'nota.language', 'auto', 'navigator.language', 'localStorage', 'vscode.l10n'])
      expect(section, part).toContain(part)
  })
})
