/** The languages of the strings: Russian for a language code that starts with `ru`, English for any other. */
export type Locale = 'ru' | 'en'

/** The language of the strings for a language code of the host (`vscode.env.language`: `ru`, `en`, `de`, `zh-cn`, …). */
export function pickLocale(language: string | undefined | null): Locale {
  return /^ru(?:$|[-_])/i.test((language ?? '').trim()) ? 'ru' : 'en'
}
