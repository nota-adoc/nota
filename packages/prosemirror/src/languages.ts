/**
 * The languages of code the editor offers. A listing is written `[source,js]`; the same language has more than one
 * word (`js`, `javascript`), and a word that is not in the list is shown as it is, without colours.
 */

/** The languages of the list, in the order the panel shows them; `text` is code with no colours. */
export const LANGUAGES = [
  'text',
  'bash',
  'css',
  'html',
  'java',
  'javascript',
  'json',
  'python',
  'sql',
  'typescript',
  'xml',
  'yaml',
] as const

export type LanguageId = (typeof LANGUAGES)[number]

const WORDS: Readonly<Record<string, LanguageId>> = {
  '': 'text',
  text: 'text',
  txt: 'text',
  plain: 'text',
  plaintext: 'text',
  bash: 'bash',
  sh: 'bash',
  shell: 'bash',
  console: 'bash',
  css: 'css',
  html: 'html',
  java: 'java',
  javascript: 'javascript',
  js: 'javascript',
  json: 'json',
  python: 'python',
  py: 'python',
  sql: 'sql',
  typescript: 'typescript',
  ts: 'typescript',
  xml: 'xml',
  yaml: 'yaml',
  yml: 'yaml',
}

/** The language of a word as written after `source,` (`js`, `Python`); '' (no word) is `text`; null for a word that is not in the list. */
export function canonicalLanguage(word: string): LanguageId | null {
  return WORDS[word.trim().toLowerCase()] ?? null
}

/** The word a language is written with in the file (`javascript`, `python`). */
export const languageWord = (id: LanguageId): string => id
