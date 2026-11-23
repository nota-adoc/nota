// the texts that the style sheet writes (`content:`) follow the language of the tab: English by default, Russian under `:lang(ru)`;
// the page sets `lang` of `<html>` from the language of the init message.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { startPage } from '../../src/webview/main.js'

const css = readFileSync(join(import.meta.dirname, '../../src/webview/style.css'), 'utf8')

describe('the note over an island in a line', () => {
  it('says «Edited in Text mode» by default and «Правится в режиме «Текст»» under :lang(ru)', () => {
    expect(css).toMatch(/\.nota-inline-chip::after \{\s*content: "Edited in Text mode";/)
    expect(css).toMatch(/\.nota-inline-chip:lang\(ru\)::after \{ content: "Правится в режиме «Текст»"; \}/)
    // no other rule of the style sheet writes a Russian text without :lang(ru)
    for (const line of css.split('\n')) if (/content:\s*"[^"]*[А-Яа-я]/.test(line)) expect(line, line).toMatch(/:lang\(ru\)/)
  })
})

describe('the lang of the page', () => {
  afterEach(() => {
    document.body.textContent = ''
    document.documentElement.removeAttribute('lang')
  })

  it('is the language of init: the CSS texts follow it', () => {
    for (const locale of ['ru', 'en'] as const) {
      const root = document.createElement('div')
      document.body.append(root)
      const page = startPage({ postMessage: () => undefined }, root)
      window.dispatchEvent(
        new MessageEvent('message', { data: { type: 'init', text: 'a\n', version: 1, fileName: 'a.adoc', locale, outlineView: 'capsule', fileDir: '/w', mode: 'visual' } }),
      )
      expect(document.documentElement.lang).toBe(locale)
      page.destroy()
      root.remove()
    }
  })
})
