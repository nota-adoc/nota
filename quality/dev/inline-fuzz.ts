// A development aid: random inline markup, Ruby Asciidoctor against Nota's substitutions.
// Usage: tsx quality/dev/inline-fuzz.ts [count] [seed]
import '../lib/guard.js'
import { rubyHtml, notaHtml } from './inline-diff.js'

const TOKENS = [
  '*',
  '**',
  '_',
  '__',
  '`',
  '``',
  '#',
  '##',
  '^',
  '~',
  '+',
  '++',
  '+++',
  '$$',
  '\\',
  '[',
  ']',
  '[.r]',
  '[#i]',
  '[x-]',
  '{',
  '}',
  '{nbsp}',
  '{a}',
  '{counter:n}',
  '{set:s:1}',
  '<',
  '>',
  '<<',
  '>>',
  '&',
  '&amp;',
  '&copy;',
  '(C)',
  '(TM)',
  '--',
  '...',
  '->',
  '=>',
  "'",
  '"',
  '"`',
  '`"',
  "'`",
  "`'",
  ' ',
  ' ',
  ' ',
  ' +',
  '\n',
  'a',
  'b',
  'foo',
  'x',
  'é',
  '1',
  ':',
  ';',
  ',',
  '.',
  '/',
  '@',
  'pass:[',
  'pass:q[',
  'stem:[',
  'image:a.png[',
  'link:',
  'https://e.com',
  'https://e.com[',
  'mailto:',
  'xref:',
  'footnote:[',
  'footnote:',
  'kbd:[',
  'btn:[',
  'menu:',
  'indexterm:[',
  '((',
  '))',
  '(((',
  ')))',
  '[[',
  ']]',
  'anchor:',
  'icon:',
  'a@b.co',
  '<1>',
  '// ',
  '"File > Save"',
]

function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const count = Number(process.argv[2] ?? 500)
const seed = Number(process.argv[3] ?? 1)
const rand = rng(seed)
const inputs: string[] = []
for (let i = 0; i < count; i++) {
  const n = 2 + Math.floor(rand() * 14)
  let s = 'w '
  for (let k = 0; k < n; k++) s += TOKENS[Math.floor(rand() * TOKENS.length)]
  // no blank lines, no block starts: every line begins with `w `
  s = s.replace(/\n+/g, '\nw ')
  if (/::|;;/.test(s)) continue
  inputs.push(s)
}
const ruby = rubyHtml(inputs)
let bad = 0
inputs.forEach((t, i) => {
  const mine = notaHtml(t)
  const r = ruby[i]!
  // footnotes and the like are outside the paragraph in Ruby's output
  const cut = r.indexOf('\n</div>\n<div id="footnotes">')
  const rr = cut >= 0 ? r.slice(0, cut) + '\n</div>' : r
  if (mine !== rr) {
    bad++
    if (bad <= 30)
      console.log(`--- ${JSON.stringify(t)}\n  ruby: ${JSON.stringify(rr)}\n  nota: ${JSON.stringify(mine)}`)
  }
})
console.log(`seed ${seed}: ${count} snippets, ${bad} differ`)
