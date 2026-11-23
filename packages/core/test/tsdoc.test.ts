import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const entries = ['packages/core/src/index.ts', 'packages/html/src/index.ts'].map((f) => root + f)

const config = ts.readConfigFile(root + 'tsconfig.json', ts.sys.readFile)
const options = ts.parseJsonConfigFileContent(config.config, ts.sys, root).options
const program = ts.createProgram(entries, { ...options, noEmit: true })
const checker = program.getTypeChecker()

/** The symbol the export stands for (a re-export is followed to the declaration that holds the comment). */
const target = (s: ts.Symbol): ts.Symbol => (s.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(s) : s)

const exportsOf = (entry: string): ts.Symbol[] => {
  const file = program.getSourceFile(entry)!
  return checker.getExportsOfModule(checker.getSymbolAtLocation(file)!)
}

const text = (parts: ts.SymbolDisplayPart[]): string => ts.displayPartsToString(parts).trim()
const tagsOf = (s: ts.Symbol): readonly ts.JSDocTagInfo[] => s.getJsDocTags(checker)
const member = (s: ts.Symbol, name: string): ts.Symbol => {
  const m = checker.getDeclaredTypeOfSymbol(s).getProperty(name)
  if (!m) throw new Error(`${s.name} has no member ${name}`)
  return m
}
const exported = (name: string): ts.Symbol => {
  for (const entry of entries) {
    const s = exportsOf(entry).find((e) => e.name === name)
    if (s) return target(s)
  }
  throw new Error(`${name} is not exported`)
}

describe('TSDoc of the public API', () => {
  it('gives every export of @nota-adoc/core and @nota-adoc/html a description', () => {
    const missing: string[] = []
    for (const entry of entries) {
      for (const e of exportsOf(entry)) {
        const s = target(e)
        // a comment may sit on any declaration of the symbol (an interface merged with a value, overloads)
        if (text(s.getDocumentationComment(checker)) === '') missing.push(`${e.name} (${entry.replace(root, '')})`)
      }
    }
    expect(missing, `exports without a TSDoc comment:\n${missing.join('\n')}`).toEqual([])
  })

  it('shows an example on the main entries', () => {
    const noExample = [
      ['parse', exported('parse')],
      ['createSession', exported('createSession')],
      ['applyOperation', exported('applyOperation')],
      ['renderHtml', exported('renderHtml')],
      ['NotaDocument.update', member(exported('NotaDocument'), 'update')],
    ].filter(([, s]) => !tagsOf(s as ts.Symbol).some((t) => t.name === 'example'))
    expect(noExample.map(([n]) => n)).toEqual([])
  })

  it('says in @throws what is thrown and when', () => {
    const entries: [string, ts.Symbol][] = [
      ['NotaDocument.update', member(exported('NotaDocument'), 'update')],
      ['NotaSession.apply', member(exported('NotaSession'), 'apply')],
      ['renderHtml', exported('renderHtml')],
      ['renderHtmlBlocks', exported('renderHtmlBlocks')],
      ['applyOperation', exported('applyOperation')],
    ]
    const bad = entries.filter(([, s]) => {
      const throws = tagsOf(s)
        .filter((t) => t.name === 'throws')
        .map((t) => text(t.text ?? []))
      // the type of the error and, after it, when it is thrown
      return !throws.some((t) => /^(RangeError|TypeError) \S+/.test(t) && t.length > 30)
    })
    expect(bad.map(([n]) => n)).toEqual([])
  })
})
