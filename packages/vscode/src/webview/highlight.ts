/**
 * The colours of the code in a block of code: the parsers of Lezer (MIT) for the languages that have one, and the rules of
 * `@codemirror/legacy-modes` (MIT) for Bash and SQL. The editor asks for the ranges of a block by the id of its language and
 * puts the classes `tok-…` on them; the colours are in `style.css`. A language that is not in the list, and `text`, have none.
 */
import { StreamLanguage } from '@codemirror/language'
import { shell } from '@codemirror/legacy-modes/mode/shell'
import { standardSQL } from '@codemirror/legacy-modes/mode/sql'
import { parser as cssParser } from '@lezer/css'
import { classHighlighter, highlightTree } from '@lezer/highlight'
import { parser as htmlParser } from '@lezer/html'
import { parser as javaParser } from '@lezer/java'
import { parser as jsParser } from '@lezer/javascript'
import { parser as jsonParser } from '@lezer/json'
import { parser as pythonParser } from '@lezer/python'
import { parser as xmlParser } from '@lezer/xml'
import { parser as yamlParser } from '@lezer/yaml'
import type { Parser } from '@lezer/common'

/** A stretch of the text of a block and the class it gets. */
export interface HighlightRange {
  readonly from: number
  readonly to: number
  readonly class: string
}

const PARSERS: Readonly<Record<string, () => Parser>> = {
  javascript: () => jsParser,
  typescript: () => jsParser.configure({ dialect: 'ts' }),
  css: () => cssParser,
  html: () => htmlParser,
  java: () => javaParser,
  json: () => jsonParser,
  python: () => pythonParser,
  xml: () => xmlParser,
  yaml: () => yamlParser,
  bash: () => StreamLanguage.define(shell as never).parser,
  sql: () => StreamLanguage.define(standardSQL as never).parser,
}

const made = new Map<string, Parser>()

function parserOf(language: string): Parser | null {
  const have = made.get(language)
  if (have) return have
  const make = PARSERS[language]
  if (!make) return null
  const parser = make()
  made.set(language, parser)
  return parser
}

/** The ranges of `text` to colour, for a language of the list (`javascript`, `bash`, …); none for `text` and for any other word. */
export function highlightCode(language: string, text: string): HighlightRange[] {
  const parser = parserOf(language)
  if (!parser || text === '') return []
  const out: HighlightRange[] = []
  try {
    highlightTree(parser.parse(text), classHighlighter, (from, to, cls) => {
      if (to > from) out.push({ from, to, class: cls })
    })
  } catch {
    return []
  }
  return out
}
