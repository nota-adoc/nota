// the texts of the popups of the capsule of tools, ru and en.
import { describe, expect, it } from 'vitest'
import { messages } from '../src/messages.js'

const flat = (tips: (typeof messages)['ru']['tips']): Record<string, string> =>
  Object.fromEntries(Object.entries(tips).map(([k, v]) => [k, typeof v === 'function' ? v(2) : v]))

describe('messages.tips', () => {
  it('has the same keys in ru and en and no empty string', () => {
    const ru = flat(messages.ru.tips)
    const en = flat(messages.en.tips)
    expect(Object.keys(en).sort()).toEqual(Object.keys(ru).sort())
    for (const dict of [ru, en]) for (const [key, text] of Object.entries(dict)) expect(text.trim(), key).not.toBe('')
  })

  it('has no Latin letters in ru outside the names of things, and no Cyrillic in en', () => {
    for (const [key, text] of Object.entries(flat(messages.ru.tips))) {
      expect(text.replaceAll('Mermaid', '').replaceAll('AsciiDoc', ''), key).not.toMatch(/[A-Za-z]/)
    }
    for (const [key, text] of Object.entries(flat(messages.en.tips))) expect(text, key).not.toMatch(/[А-Яа-яЁё]/)
  })
})
