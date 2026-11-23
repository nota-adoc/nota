// A development aid: random AsciiDoc-like documents, whole HTML of Ruby Asciidoctor against Nota's.
// Usage: tsx quality/dev/doc-fuzz.ts [count] [seed]
import '../lib/guard.js'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import fc from 'fast-check'
import { parse } from '../../packages/core/src/index.js'
import { renderHtml } from '../../packages/html/src/index.js'
import { asciidocText, lineTemplates } from '../fuzz/generators.js'
import { rubyFiles } from './html-diff.js'

const count = Number(process.argv[2] ?? 200)
const seed = Number(process.argv[3] ?? 1)
const extra = [
  ':sectnums:', ':sectnums!:', ':toc:', ':toc: macro', ':toc: preamble', ':sectanchors:', ':sectlinks:', ':idprefix: p-', ':idseparator: -',
  ':sectids!:', ':xrefstyle: full', ':xrefstyle: short', ':example-caption!:', ':listing-caption: Listing', ':figure-caption: Fig',
  ':table-caption!:', ':showtitle:', ':notitle:', ':leveloffset: +1', ':sectnumlevels: 2', ':toclevels: 1', ':icons: font',
  '[appendix]', '[glossary]', '[bibliography]', '[abstract]', '[preface]', '[partintro]', '[colophon]', '[index]', '[dedication]',
  '[#sec-a]', '[[sec-b]]', '[[sec-c,Third]]', '[reftext=Ref]', '.Title with *bold* and <<sec-a>>', '.Plain title',
  'See <<sec-a>>, <<sec-b>> and <<Third>> and xref:sec-c[] and <<nope>>.', 'A footnote:[note *x*] here and footnote:n[] again.',
  '* [[[ref1]]] Reference one', '* [[[ref2,R2]]] Reference two', 'See <<ref1>> and <<ref2>>.',
  'image::a.png[Alt,10]', '.Fig title', 'image::b.png[]', 'toc::[]', 'toc::[levels=1]', '[discrete]', '=== A *discrete* heading',
  '= Part', '== Chapter', '=== Section', '==== Sub', 'Term:: def', 'Term2::', '  more', '[horizontal]', '[qanda]', '[%reversed]',
  '[start=3]', '[loweralpha]', '[upperroman]', '[arabic]', '[source,ruby,linenums]', '[source%nowrap]', '[%collapsible]', '[%interactive]',
  '[.role]', '[#idx.role]', '[quote,A,B]', '[verse,A]', '[CAUTION]', '[caption="Cap: "]', '[caption=]', '[subs=+quotes]',
  'Text with {sectids} and {toc} and {doctype} and {sectnums} attr refs {counter:c} {counter:c}.', ':a: b', '{set:x:1}', '{set:leveloffset:1}', '{set:leveloffset:+1}', '{set:leveloffset!}',
  '<1> callout', 'code <1>', 'puts 1 # <2>', '--', '====', '****', '____', '....', '----', '++++', '//// ', '\\\\', '', '',
]
const all = [...lineTemplates, ...extra, ...extra]
const gen = fc
  .array(fc.constantFrom(...all), { minLength: 3, maxLength: 40 })
  .map((ls) => ls.join('\n') + '\n')
const texts = fc
  .sample(process.argv[4] === 'extra' ? gen : asciidocText, { numRuns: count * 12, seed })
  // eslint-disable-next-line no-control-regex
  .filter((t) => !/\|===|,===|:===|!===|include::|\r|\u0000|[\uD800-\uDFFF]/.test(t) && t.trim() !== '')
  .slice(0, count)
const dir = mkdtempSync(join(tmpdir(), 'doc-fuzz-'))
const names = texts.map((t, i) => {
  const n = `f${i}.adoc`
  writeFileSync(join(dir, n), t)
  return n
})
const ruby = rubyFiles(dir, names)
let bad = 0
texts.forEach((t, i) => {
  let mine: string
  try {
    mine = renderHtml(parse(t))
  } catch (e) {
    mine = `THROW ${e instanceof Error ? e.stack : e}`
  }
  const norm = (s: string) => s.replace(/\s+/g, ' ').replace(/> </g, '><').trim()
  if (norm(mine) !== norm(ruby[i]!)) {
    bad++
    if (bad <= 12) {
      const a = norm(ruby[i]!)
      const b = norm(mine)
      let k = 0
      while (k < a.length && a[k] === b[k]) k++
      console.log(`--- #${i} ${JSON.stringify(t.slice(0, 400))}\n  ruby: ${a.slice(Math.max(0, k - 60), k + 120)}\n  nota: ${b.slice(Math.max(0, k - 60), k + 120)}`)
    }
  }
})
console.log(`seed ${seed}: ${texts.length} documents, ${bad} differ`)
