import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import fc from 'fast-check'
import { type Operation, type ParseOptions, applyOperation, parse } from '@nota-adoc/core'
import { type InlineNode, colorLayoutOf } from '@nota-adoc/core/internal'
import { applyAll } from './operations.js'

/** The codes a colour operation may refuse with. */
const REFUSALS = new Set(['invalid-role', 'empty-selection', 'invalid-range', 'not-colorable', 'inside-construct', 'collateral', 'unstable'])

// ---------------------------------------------------------------- the documents

const plain = fc.constantFrom('alpha', 'beta', 'текст', 'слово', 'x', 'мир', '(C)', '{plus}', 'a\\|b', '1', 'долго')
const roles = ['hl-mint', 'hl-plum', 'hl-tall', 'marker-red'] as const

const piece: fc.Arbitrary<string> = fc.oneof(
  { weight: 8, arbitrary: plain },
  { weight: 2, arbitrary: plain.map((w) => `*${w}*`) },
  { weight: 2, arbitrary: plain.map((w) => `_${w}_`) },
  { weight: 1, arbitrary: plain.map((w) => `\`${w}\``) },
  { weight: 1, arbitrary: plain.map((w) => `**${w}**`) },
  { weight: 4, arbitrary: fc.tuple(fc.constantFrom(...roles), plain).map(([r, w]) => `[.${r}]#${w}#`) },
  { weight: 3, arbitrary: fc.tuple(fc.constantFrom(...roles), plain).map(([r, w]) => `[.${r}]##${w}##`) },
  { weight: 1, arbitrary: fc.tuple(fc.constantFrom(...roles), fc.constantFrom(...roles), plain).map(([r, s, w]) => `[.${r}.${s}]#${w}#`) },
  { weight: 1, arbitrary: plain.map((w) => `[#k1.hl-mint.note]#${w}#`) },
  { weight: 1, arbitrary: plain.map((w) => `[#k1.hl-mint]#${w}#`) },
  { weight: 1, arbitrary: plain.map((w) => `[#k1]#${w}#`) },
  { weight: 1, arbitrary: plain.map((w) => `[.hl-plum]*${w}*`) },
  { weight: 1, arbitrary: plain.map((w) => `*${w} [.hl-mint]#${w}# ${w}*`) },
  { weight: 1, arbitrary: plain.map((w) => `[.hl-mint]#${w} *${w}* ${w}#`) },
  { weight: 1, arbitrary: plain.map((w) => `https://example.org[${w}]`) },
  { weight: 1, arbitrary: plain.map((w) => `<<id,${w}>>`) },
  { weight: 1, arbitrary: plain.map((w) => `https://example.org[[.hl-mint]#${w}#]`) },
  { weight: 1, arbitrary: plain.map((w) => `+${w}+`) },
  { weight: 1, arbitrary: plain.map((w) => `pass:[${w}]`) },
  { weight: 1, arbitrary: plain.map((w) => `image:p.png[${w}]`) },
  { weight: 1, arbitrary: fc.constant('((term))') },
  // pass:q[…] and a visible ((…)) inside coloured pieces, and colour inside pass:q[…]
  { weight: 2, arbitrary: fc.tuple(fc.constantFrom(...roles), plain).map(([r, w]) => `[.${r}]#${w} pass:q[*${w}* _${w}_] ${w}#`) },
  { weight: 2, arbitrary: fc.tuple(fc.constantFrom(...roles), plain).map(([r, w]) => `[.${r}]#${w} ((term)) ${w}#`) },
  { weight: 2, arbitrary: fc.tuple(fc.constantFrom(...roles), plain).map(([r, w]) => `pass:q[[.${r}\\]#${w}#]`) },
  { weight: 1, arbitrary: fc.tuple(fc.constantFrom(...roles), plain).map(([r, w]) => `https://example.org[[.${r}]#pass:q[${w}]#]`) },
  { weight: 1, arbitrary: fc.constant('a + b') },
)

const line: fc.Arbitrary<string> = fc.array(piece, { minLength: 1, maxLength: 6 }).map((p) => p.join(' '))
const glued: fc.Arbitrary<string> = fc.array(piece, { minLength: 1, maxLength: 4 }).map((p) => p.join(''))
const text: fc.Arbitrary<string> = fc.oneof(line, line, glued)

function block(): fc.Arbitrary<string> {
  return fc.oneof(
    { weight: 6, arbitrary: text },
    { weight: 2, arbitrary: fc.tuple(text, text).map(([a, b]) => `${a}\n${b}`) },
    { weight: 2, arbitrary: text.map((t) => `== ${t}`) },
    { weight: 1, arbitrary: text.map((t) => `.${t}\n${t}`) },
    { weight: 2, arbitrary: fc.array(text, { minLength: 1, maxLength: 3 }).map((l) => l.map((t) => `* ${t}`).join('\n')) },
    { weight: 1, arbitrary: fc.array(text, { minLength: 1, maxLength: 3 }).map((l) => l.map((t) => `. ${t}`).join('\n')) },
    { weight: 1, arbitrary: fc.tuple(glued, text).map(([a, b]) => `${a}:: ${b}`) },
    { weight: 1, arbitrary: text.map((t) => `NOTE: ${t}`) },
    { weight: 1, arbitrary: text.map((t) => `[NOTE]\n====\n${t}\n====`) },
    { weight: 1, arbitrary: text.map((t) => `----\n${t}\n----`) },
    { weight: 1, arbitrary: text.map((t) => `// ${t}`) },
    { weight: 1, arbitrary: text.map((t) => ` ${t}`) },
    { weight: 1, arbitrary: text.map((t) => `:attr: ${t}`) },
    { weight: 2, arbitrary: fc.tuple(text, text, text).map(([a, b, c]) => `|===\n|${a} |${b}\n|${c} |x\n|===`) },
    { weight: 1, arbitrary: fc.tuple(text, text).map(([a, b]) => `[format="csv"]\n|===\n"${a.replace(/"/g, '""')}","${b.replace(/"/g, '""')}"\n|===`) },
    { weight: 1, arbitrary: fc.tuple(text, text).map(([a, b]) => `[format="dsv"]\n|===\n${a.replace(/:/g, '\\:')}:${b.replace(/:/g, '\\:')}\n|===`) },
    { weight: 1, arbitrary: fc.tuple(text, text).map(([a, b]) => `|===\na|\n!===\n!${a} !${b}\n!===\n|z\n|===`) },
    { weight: 1, arbitrary: fc.tuple(text, text).map(([a, b]) => `|===\na|${a}\n\n* ${b}\n|x\n|===`) },
    { weight: 1, arbitrary: text.map((t) => `|===\nl|${t}\n|===`) },
  )
}

const colorsFixture = readFileSync(fileURLToPath(new URL('../fixtures/stage4/colors.adoc', import.meta.url)), 'utf8')

const documents: fc.Arbitrary<string> = fc.oneof(
  { weight: 9, arbitrary: fc.array(block(), { minLength: 1, maxLength: 4 }).map((b) => b.join('\n\n') + '\n') },
  { weight: 1, arbitrary: fc.constant(colorsFixture) },
)

// ---------------------------------------------------------------- the operations

export interface ColorInput {
  text: string
  registry: boolean
  kind: 'setColor' | 'replaceColor' | 'removeColor'
  role: string
  replace: string | null
  from: { r: number; mode: number }
  to: { r: number; mode: number }
}

const point = fc.record({ r: fc.double({ min: 0, max: 1, noNaN: true }), mode: fc.integer({ min: 0, max: 3 }) })

export const colorInput: fc.Arbitrary<ColorInput> = fc.record({
  text: documents,
  registry: fc.constantFrom(true, true, false),
  kind: fc.constantFrom('setColor', 'replaceColor', 'removeColor', 'setColor') as fc.Arbitrary<ColorInput['kind']>,
  role: fc.oneof(
    { weight: 12, arbitrary: fc.constantFrom(...roles) },
    { weight: 1, arbitrary: fc.constantFrom('note', 'hl-', 'x y') },
  ),
  replace: fc.option(fc.constantFrom(...roles), { nil: null }),
  from: point,
  to: point,
})

/** A position: any offset, or the edge of a character of a place (so the ends of ranges meet the marks). */
function pos(doc: ReturnType<typeof parse>, p: { r: number; mode: number }): number {
  const len = doc.text.length
  if (p.mode === 0) return Math.min(len, Math.floor(p.r * (len + 1)))
  const edges: number[] = []
  for (const place of colorLayoutOf(doc).places) {
    const walk = (n: InlineNode): void => {
      for (const it of n.items) {
        if ('items' in it) walk(it)
        else edges.push(p.mode === 1 ? it.from : it.to)
      }
    }
    walk(place.root)
  }
  if (edges.length === 0) return Math.min(len, Math.floor(p.r * (len + 1)))
  return edges[Math.min(edges.length - 1, Math.floor(p.r * edges.length))]!
}

export function toColorOperation(doc: ReturnType<typeof parse>, i: ColorInput): Operation {
  const a = pos(doc, i.from)
  const b = pos(doc, i.to)
  const from = Math.min(a, b)
  const to = Math.max(a, b)
  if (i.kind === 'setColor') return { kind: 'setColor', from, to, role: i.role }
  if (i.kind === 'replaceColor') return { kind: 'replaceColor', from, to, role: i.role, ...(i.replace ? { replace: i.replace } : {}) }
  return { kind: 'removeColor', from, to, ...(i.replace ? { role: i.replace } : {}) }
}

const set = (a: readonly string[]): string => [...new Set(a)].sort().join(',')

/** The colours of the characters of every place of a document, by the colours the document itself reports at the characters. */
function charColors(doc: ReturnType<typeof parse>): { texts: string[]; colors: string[][]; offs: [number, number][] }[] {
  return colorLayoutOf(doc).places.map((place) => {
    const texts: string[] = []
    const colors: string[][] = []
    const offs: [number, number][] = []
    const walk = (n: InlineNode, path: string): void => {
      for (const it of n.items) {
        if ('items' in it) {
          const wrapper = it.kind === 'mark' && it.attrs !== null && it.roles.length === it.colors.length
          walk(it, wrapper ? path : `${path}/${it.kind}`)
        } else {
          texts.push(doc.text.slice(it.from, it.to) + path)
          colors.push([...doc.colorAt(it.to - 1)])
          offs.push([it.from, it.to])
        }
      }
    }
    walk(place.root, '')
    return { texts, colors, offs }
  })
}

export function checkColorOperation(i: ColorInput): void {
  const options: ParseOptions = i.registry ? { colorRoles: ['marker-red'] } : {}
  const doc = parse(i.text, options)
  const op = toColorOperation(doc, i)
  const r = applyOperation(doc, op)
  if (doc.text !== i.text) throw new Error('the document changed')
  if ('error' in r) {
    if (!REFUSALS.has(r.error)) throw new Error(`a refusal with an unknown code: ${r.error}`)
    if (r.diagnostics.length === 0) throw new Error('a refusal without a diagnostic')
    return
  }
  const next = applyAll(i.text, r.changes)
  if (next !== r.doc.text) throw new Error('the changes do not give the text of the result')
  const full = parse(r.doc.text, options)
  if (JSON.stringify(r.doc.colors()) !== JSON.stringify(full.colors())) throw new Error('the colours of the result are not those of its text')
  if (r.changes.length === 0) {
    if (r.doc.text !== i.text) throw new Error('no changes, but the text differs')
    return
  }
  // the characters and what they are in are the same; the colours are those asked for
  const before = charColors(doc)
  const after = charColors(r.doc)
  if (before.length !== after.length) throw new Error('the places of the text differ')
  const from = (op as { from: number }).from
  const to = (op as { to: number }).to
  const role = (op as { role?: string }).role
  const replace = (op as { replace?: string }).replace
  for (let p = 0; p < before.length; p++) {
    const b = before[p]!
    const a = after[p]!
    if (b.texts.join('\u0001') !== a.texts.join('\u0001')) throw new Error('the characters or what they are in differ')
    for (let c = 0; c < b.texts.length; c++) {
      const [f, t] = b.offs[c]!
      const was = b.colors[c]!
      const now = a.colors[c]!
      const selected = f >= from && t <= to
      if (!selected) {
        // (the blanks next to a changed character may join a piece or leave it)
        const ws = /^\s/.test(b.texts[c]!)
        if (!ws && set(was) !== set(now)) throw new Error(`the colour of a character out of the range changed at ${f}`)
        continue
      }
      let want: string[]
      if (op.kind === 'setColor') want = [...was, role!]
      else if (op.kind === 'replaceColor')
        want = replace === undefined ? [role!] : was.includes(replace) ? was.map((x) => (x === replace ? role! : x)) : was
      else want = role === undefined ? [] : was.filter((x) => x !== role)
      if (set(want) !== set(now)) throw new Error(`the colours at ${f} are ${set(now)}, not ${set(want)}`)
    }
  }
}
