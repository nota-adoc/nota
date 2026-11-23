// The property `editor/actions`: random chains of what a person does in the visual editor — typing (markup
// characters too), deleting, Enter, Shift-Enter, Backspace and Delete at the edges, input methods, marks, links,
// styles, edits in the source, undo and redo — on the fixtures. After every action the screen equals the projection
// from nothing, nothing outside the target of the action changed, and each command either did something or told
// the host why not. Undoing everything gives the first text byte for byte.
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import fc from 'fast-check'
import { type Change, type NotaSession, composeChanges, createSession, parse } from '@nota-adoc/core'
import { layoutItems, readLayout } from '@nota-adoc/core/internal'
import { readSource } from '../lib/read-source.js'
import { installDom } from './dom.js'
import { asciidocText } from './generators.js'

installDom()
const pm = await import('@nota-adoc/prosemirror')
const { TextSelection } = await import('prosemirror-state')
type VisualEditor = import('@nota-adoc/prosemirror').VisualEditor
type PMNode = import('prosemirror-model').Node

const root = new URL('../fixtures', import.meta.url).pathname

function* walk(dir: string): Generator<string> {
  for (const f of readdirSync(dir).sort()) {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) yield* walk(p)
    else if (p.endsWith('.adoc')) yield p
  }
}

/** The texts of the fixtures that are small enough for a run of many actions. */
export const fixtureTexts: { name: string; text: string }[] = [...walk(root)]
  .map((p) => ({ name: p.slice(root.length + 1), text: readSource(p) }))
  .filter((f) => f.text.length <= 12_000 && !f.name.includes('large'))

const typed = [
  'x',
  'привет',
  ' ',
  '*',
  '_',
  '`',
  '#',
  '[.r]#',
  '[.zz-a]#',
  '[.zz-a]*',
  '+',
  '{a}',
  '<<i>>',
  'https://e.com',
  '\\',
  '(C)',
  '--',
  ']',
  '[',
  'xref:a[b]',
  '*b*',
  '**b**',
  '= ',
  '* ',
  '----',
  '.',
  '::',
  'NOTE: ',
  '//',
  ' +',
  ' + b',
  '{plus}',
  '(',
  '😀',
]
/** Typed strings that are a plus, with a blank before it or a letter after: they never go through `onInexact`. */
const plusOnly = /^ ?\+( b)?$/
const sourceText = [
  'x',
  '\n',
  '\n\n',
  '----\n',
  '* ',
  '== ',
  ':a: b\n',
  '// c\n',
  '[[i]]\n',
  '.T\n',
  'ifdef::a[]\n',
  'endif::[]\n',
  'привет ',
  ' +\n',
  ' + \n',
  '{set:experimental:}',
  '*b*',
  '____\n',
]
const targets = [
  'https://a.b/c',
  '#id',
  'x.adoc#y',
  'page.html',
  'mailto:a@b.c',
  'javascript:alert(1)',
  'a b',
  '',
]
const marks = ['strong', 'em', 'code', 'strike', 'highlight'] as const

// a fraction of the way through the document (an integer scaled, so that the positions spread evenly)
const f = fc.integer({ min: 0, max: 10_000 }).map((x) => x / 10_000)

export type Action =
  | { k: 'type'; a: number; s: number }
  | { k: 'typeOver'; a: number; b: number; s: number }
  | { k: 'backspace'; a: number }
  | { k: 'delete'; a: number }
  | { k: 'cut'; a: number; b: number }
  | { k: 'enter'; a: number }
  | { k: 'shiftEnter'; a: number }
  | { k: 'ime'; a: number; s: number; e: number; pa: number; pb: number; ps: number }
  | { k: 'mark'; a: number; b: number; m: number }
  | { k: 'markCaret'; a: number; m: number; s: number }
  | { k: 'link'; a: number; b: number; t: number }
  | { k: 'unlink'; a: number }
  | { k: 'style'; a: number; t: number }
  | { k: 'source'; a: number; b: number; s: number }
  | { k: 'list'; a: number; b: number; t: number }
  | { k: 'tab'; a: number; shift: boolean }
  | { k: 'check'; a: number }
  | { k: 'admonition'; a: number; t: number }
  | { k: 'box'; a: number }
  | { k: 'lang'; a: number; t: number }
  | { k: 'cellFill'; a: number; t: number }
  | { k: 'insert'; a: number; t: number }
  | { k: 'undo' }
  | { k: 'redo' }

const LIST_KINDS = ['unordered', 'ordered', 'checklist'] as const
const ADMONITION_TYPES = ['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION'] as const
/** The languages of a block of code, a word that is not in the list, and none. */
const CODE_LANGUAGES = ['text', 'javascript', 'python', 'bash', 'kotlin', 'yaml', ''] as const
/** The fills of a cell (and none). */
const CELL_FILLS = [...pm.CELL_FILL_ROLES, null] as const
/** The blocks the menus put in. */
const INSERT_KINDS = ['heading2', 'heading3', 'unordered', 'ordered', 'checklist', 'table', 'code', 'admonition', 'collapsible', 'image'] as const

const action: fc.Arbitrary<Action> = fc.oneof(
  { weight: 6, arbitrary: fc.record({ k: fc.constant('type' as const), a: f, s: fc.nat(typed.length - 1) }) },
  {
    weight: 2,
    arbitrary: fc.record({ k: fc.constant('typeOver' as const), a: f, b: f, s: fc.nat(typed.length - 1) }),
  },
  { weight: 3, arbitrary: fc.record({ k: fc.constant('backspace' as const), a: f }) },
  { weight: 3, arbitrary: fc.record({ k: fc.constant('delete' as const), a: f }) },
  { weight: 1, arbitrary: fc.record({ k: fc.constant('cut' as const), a: f, b: f }) },
  { weight: 3, arbitrary: fc.record({ k: fc.constant('enter' as const), a: f }) },
  { weight: 2, arbitrary: fc.record({ k: fc.constant('shiftEnter' as const), a: f }) },
  {
    weight: 3,
    // `e`: 0 the composition alone; 1 the text is edited in the source while it is on; 2 the same, and nothing was
    // composed (it is cancelled)
    arbitrary: fc.record({
      k: fc.constant('ime' as const),
      a: f,
      s: fc.nat(typed.length - 1),
      e: fc.nat(2),
      pa: f,
      pb: f,
      ps: fc.nat(sourceText.length - 1),
    }),
  },
  {
    weight: 3,
    arbitrary: fc.record({ k: fc.constant('mark' as const), a: f, b: f, m: fc.nat(marks.length - 1) }),
  },
  {
    weight: 1,
    arbitrary: fc.record({
      k: fc.constant('markCaret' as const),
      a: f,
      m: fc.nat(marks.length - 1),
      s: fc.nat(typed.length - 1),
    }),
  },
  {
    weight: 2,
    arbitrary: fc.record({ k: fc.constant('link' as const), a: f, b: f, t: fc.nat(targets.length - 1) }),
  },
  { weight: 1, arbitrary: fc.record({ k: fc.constant('unlink' as const), a: f }) },
  { weight: 2, arbitrary: fc.record({ k: fc.constant('style' as const), a: f, t: fc.nat(6) }) },
  {
    weight: 2,
    arbitrary: fc.record({ k: fc.constant('source' as const), a: f, b: f, s: fc.nat(sourceText.length - 1) }),
  },
  { weight: 2, arbitrary: fc.record({ k: fc.constant('list' as const), a: f, b: f, t: fc.nat(2) }) },
  { weight: 2, arbitrary: fc.record({ k: fc.constant('tab' as const), a: f, shift: fc.boolean() }) },
  { weight: 1, arbitrary: fc.record({ k: fc.constant('check' as const), a: f }) },
  { weight: 1, arbitrary: fc.record({ k: fc.constant('admonition' as const), a: f, t: fc.nat(4) }) },
  { weight: 1, arbitrary: fc.record({ k: fc.constant('box' as const), a: f }) },
  { weight: 1, arbitrary: fc.record({ k: fc.constant('lang' as const), a: f, t: fc.nat(CODE_LANGUAGES.length - 1) }) },
  { weight: 1, arbitrary: fc.record({ k: fc.constant('cellFill' as const), a: f, t: fc.nat(CELL_FILLS.length - 1) }) },
  { weight: 2, arbitrary: fc.record({ k: fc.constant('insert' as const), a: f, t: fc.nat(INSERT_KINDS.length - 1) }) },
  { weight: 2, arbitrary: fc.constant({ k: 'undo' as const }) },
  { weight: 1, arbitrary: fc.constant({ k: 'redo' as const }) },
)

/** What a run starts from: a fixture, or (a third of the runs) a text made of lines of AsciiDoc. */
export type Start = { fixture: number } | { text: string }

export const editorInput: fc.Arbitrary<{ start: Start; actions: Action[] }> = fc.record({
  start: fc.oneof(
    { weight: 2, arbitrary: fc.record({ fixture: fc.nat(fixtureTexts.length - 1) }) },
    { weight: 1, arbitrary: asciidocText.map((text) => ({ text: text.slice(0, 3000) })) },
  ),
  actions: fc.array(action, { minLength: 1, maxLength: 24, size: 'max' }),
})

/** Every position of the document where a cursor can stand: inside paragraphs and headings. */
function textPositions(doc: PMNode): number[] {
  const out: number[] = []
  doc.forEach((node, offset) => {
    if (node.isTextblock) for (let p = offset + 1; p <= offset + node.nodeSize - 1; p++) out.push(p)
  })
  return out
}

const pick = (positions: number[], x: number): number =>
  positions[Math.min(positions.length - 1, Math.floor(x * positions.length))]!

function unnumber(n: PMNode): PMNode {
  return n.type.name === 'list_item' && n.attrs.num !== '' ? n.type.create({ ...n.attrs, num: '' }, n.content, n.marks) : n
}

/** The index of the first item of the first list after the block `at` (-1: none). */
function firstListAfter(doc: PMNode, at: number): number {
  for (let i = at + 1; i < doc.childCount; i++) if (doc.child(i).type.name === 'list_item') return i
  return -1
}

/** Whether the block `k` is in the run of items that starts at `first`. */
function isFirstRun(doc: PMNode, first: number, k: number): boolean {
  for (let i = first; i <= k; i++) if (doc.child(i).type.name !== 'list_item') return false
  return true
}

function sameDoc(editor: VisualEditor, session: NotaSession): string | null {
  const expected = pm.projectDocument(session.doc)
  let screen = editor.view.state.doc
  if (screen.eq(expected)) return null
  // an island that holds the cursor stays one, whatever its text reads as now (or holds text that was not written): the blocks
  // before it and after it are the text's
  const sel = editor.view.state.selection.$head
  if (sel.depth >= 1 && sel.node(1).type.name === 'island') {
    const at = sel.index(0)
    const after = screen.childCount - at - 1
    let same = at <= expected.childCount && after <= expected.childCount - at
    for (let i = 0; same && i < at; i++) same = screen.child(i).eq(expected.child(i))
    // (the numbers of the first list after it are the screen's own, and only when the island has lines that the text reads as items:
    // such lines are not counted by the screen; every other block after it is the text's as it is)
    const items = /^\s*(\.+|\*+|-|\d+\.)\s/m.test(sel.parent.textContent)
    const firstList = items ? firstListAfter(screen, at) : -1
    for (let i = 1; same && i <= after; i++) {
      const k = screen.childCount - i
      const [a, b] = [screen.child(k), expected.child(expected.childCount - i)]
      same = (firstList >= 0 && k >= firstList && isFirstRun(screen, firstList, k) ? unnumber(a).eq(unnumber(b)) : a.eq(b))
    }
    if (same && sel.parent.attrs.unsaved !== true) {
      // (an island that is written holds whole lines of the text, as they are)
      const lines = session.text.replace(/^\ufeff/, '').replace(/\r/g, '').split('\n')
      const mine = sel.parent.textContent.replace(/^\ufeff/, '').split('\n')
      // (the last line may end short: an escaped directive is read as the backslash and the line after it)
      same = lines.some((_, j) => mine.every((l, k) => lines[j + k] === l || (k === mine.length - 1 && (lines[j + k] ?? "").startsWith(l))))
    }
    if (same) return null
  }
  // a NOTE: or a collapsible block that is only started (after a block that has text) is one more empty block on the screen
  // (a box is its head, an empty paragraph and its end)
  // (it stands after the block that has the cursor, or in the place of the empty paragraph that has it)
  for (let len = 1; len <= 3; len++) {
    for (let i = 0; i + len <= screen.childCount; i++) {
      const first = screen.child(i)
      if (first.type.name !== 'admonition_paragraph' && first.type.name !== 'box_head') continue
      for (const instead of [false, true]) {
        if (screen.childCount !== expected.childCount + len - (instead ? 1 : 0)) continue
        const kids: PMNode[] = []
        screen.forEach((m, _o, j) => {
          if (j === i && instead) kids.push(expected.maybeChild(i) ?? m)
          if (j < i || j >= i + len) kids.push(m)
        })
        if (pm.schema.nodes.doc!.create(null, kids).eq(expected)) return null
      }
    }
  }
  // (or it stands in the place of an empty paragraph)
  if (screen.childCount === expected.childCount) {
    for (let i = 0; i < screen.childCount; i++) {
      const n = screen.child(i)
      if (n.textContent !== '' || !/admonition|collaps/.test(n.type.name) || expected.child(i).type.name !== 'paragraph') continue
      const kids: PMNode[] = []
      screen.forEach((m, _o, j) => kids.push(j === i ? expected.child(i) : m))
      if (pm.schema.nodes.doc!.create(null, kids).eq(expected)) return null
    }
  }
  // an item or a heading that is only started is on the screen and not in the text: at most one
  const drafts: number[] = []
  screen.forEach((n, _o, i) => {
    if (n.attrs.draft === true) drafts.push(i)
  })
  if (drafts.length > 1) return `${drafts.length} items are only started, there may be one`
  if (drafts.length === 1) {
    const at = drafts[0]!
    const kids: PMNode[] = []
    screen.forEach((n, _o, i) => {
      if (i !== at) kids.push(n)
      else if (screen.childCount !== expected.childCount + 1) kids.push(pm.schema.nodes.paragraph!.create())
    })
    // (a draft in a numbered list shifts the numbers after it, as it should)
    const flat = (nodes: PMNode[]): PMNode => pm.schema.nodes.doc!.create(null, nodes.map(unnumber))
    screen = flat(kids)
    if (screen.eq(flat(Array.from({ length: expected.childCount }, (_, i) => expected.child(i))))) return null
  }
  let i = 0
  while (i < screen.childCount && i < expected.childCount && screen.child(i).eq(expected.child(i))) i++
  const shown = (n: PMNode | null | undefined): string => (n ? n.toString().slice(0, 300) : '(none)')
  return `the screen differs from the projection of the text at block ${i} of ${screen.childCount}/${expected.childCount}:\n  screen ${shown(screen.maybeChild(i))}\n  text   ${shown(expected.maybeChild(i))}`
}

/** The screen has an item or a heading that is only started, or an island with text that was not written (it shows its note). */
function screenDraft(doc: PMNode): boolean {
  let found = false
  doc.forEach((n) => {
    if (n.attrs.draft === true || n.attrs.unsaved === true) found = true
    // (a NOTE: or a box that is only started is an empty block of its kind)
    if (n.type.name === 'admonition_paragraph' && n.textContent === '') found = true
    if (n.type.name === 'box_head') found = true
  })
  return found
}

function setSelection(editor: VisualEditor, from: number, to: number): void {
  const { state } = editor.view
  editor.view.dispatch(
    state.tr.setSelection(TextSelection.between(state.doc.resolve(from), state.doc.resolve(to))),
  )
}

/** How the actions ended, by kind (for a look at what the fuzzing reaches). */
export const outcomes: Record<string, number> = {}

const nonBlankLines = (s: string): string[] =>
  s
    .split('\n')
    .map((l) => l.trimEnd())
    .filter((l) => l !== '')

/**
 * Whether the text that an island was to show is shown by the island and what follows it. An edit can make a blank line, or a
 * line that reads as a block, the end of the island: the rest is read as islands or blocks of its own. So the
 * lines of the island (islands) are whole lines of the text, from its start, at least one; and every line that is left is in
 * the text of the blocks after them (without the characters that make it a list item, a title, a quote). A letter lost at the
 * end of the island, a tail cut off, an island that is empty are not this.
 */
export function islandReadsAs(islandText: string, restText: string, expected: string): boolean {
  const have = nonBlankLines(islandText)
  const want = nonBlankLines(expected)
  if (have.length === 0 || have.length > want.length) return false
  if (!have.every((l, k) => l === want[k])) return false
  return want.slice(have.length).every((l) => {
    const bare = l.replace(/^[\s#=>*+\-.\d]+/, '').trim()
    // (a line of markers only has nothing left once they are taken off: it must be in the blocks as it is written)
    return restText.includes(bare === '' ? l.trim() : bare)
  })
}

/**
 * The text of the island at `index` and of the islands that follow it at once, and the text of the blocks that came off it
 * with the edit: the blocks after them, except the last `keep` (the blocks that followed the island before).
 */
function islandsAndRest(doc: PMNode, index: number, keep: number): { island: string; rest: string } {
  let island = ''
  let i = index
  for (; i < doc.childCount && doc.child(i).type.name === 'island'; i++) island += '\n' + flatText(doc.child(i))
  let rest = ''
  for (; i < doc.childCount - keep; i++) {
    const n = doc.child(i)
    rest += '\n' + (n.isTextblock ? flatText(n) : typeof n.attrs.text === 'string' ? n.attrs.text : n.textContent)
  }
  return { island, rest }
}

/** The text of a block, with a mark for every break and plate, so that an offset in it is a position in the block. */
const flatText = (node: PMNode): string => node.textBetween(0, node.content.size, undefined, '\ufffc')

/**
 * The block ends with a blank or a hard break: a `+` typed after it is written as `{plus}` and shows as typed.
 * After a plate (`{a}`, a passthrough) it is a plain `+`, which can close a `+` that the plate holds in its source:
 * nothing can be written then that reads as typed, and the editor says so (`onInexact`; seed 28).
 */
function endsInBlankOrBreak(node: PMNode): boolean {
  const last = node.lastChild
  if (!last) return false
  if (last.isText) return /[ \t]$/.test(last.text!)
  return last.type.name === 'hard_break'
}

/** A character of the screen with its roles: the `[…]` of the pieces around it, sorted and joined. */
interface RoleChar {
  readonly ch: string
  readonly roles: string
}

/** Every character of the document with its roles; blocks are told apart by `\n`, breaks and plates by a mark. */
function roleChars(doc: PMNode, skip: ReadonlySet<number> = new Set()): RoleChar[] {
  const out: RoleChar[] = []
  doc.forEach((node, _offset, index) => {
    if (skip.has(index)) return
    // (an item or heading that is only started is not in the text)
    if (node.attrs.draft === true) return
    if (index > 0) out.push({ ch: '\n', roles: '' })
    if (!node.isTextblock) {
      out.push({ ch: '•', roles: '' })
      return
    }
    node.forEach((c) => {
      const roles = c.marks
        .filter((m) => m.type.name === 'roles')
        .map((m) => m.attrs.attrs as string)
        .sort()
        .join('')
      if (!c.isText) return void out.push({ ch: c.type.name === 'hard_break' ? '￼' : '�', roles })
      for (let k = 0; k < c.text!.length; k++) out.push({ ch: c.text![k]!, roles })
    })
  })
  return out
}

/** Characters an action makes new without typing: line breaks, blanks, a plus, a break, a plate (a blank keeps its roles). */
const STRUCTURAL = '\n \ufffc+\u2022\ufffd'

const tokensOf = (roles: string): string[] => roles.match(/\[[^\]]*\]/g) ?? []

/** What a text with roles must do under an action: what stays has its roles, what is typed has only the roles around it. */
function checkRoles(
  before: readonly RoleChar[],
  after: readonly RoleChar[],
  how: 'same' | 'delete' | 'insert' | 'replace',
): string | null {
  const eq = (a: RoleChar, b: RoleChar): boolean => a.ch === b.ch && a.roles === b.roles
  let p = 0
  const max = Math.min(before.length, after.length)
  while (p < max && eq(before[p]!, after[p]!)) p++
  let s = 0
  while (s < max - p && eq(before[before.length - 1 - s]!, after[after.length - 1 - s]!)) s++
  const b = before.slice(p, before.length - s)
  const a = after.slice(p, after.length - s)
  // (a plate shows its source as it is: text that goes into one or comes out of one has the roles it reads with there)
  const plate = (x: RoleChar): boolean => x.ch === '\u2022' || x.ch === '\ufffd'
  if (b.some(plate) || a.some(plate)) return null
  const shown = (xs: readonly RoleChar[]): string =>
    xs.map((x) => `${x.ch}${x.roles ? `{${x.roles}}` : ''}`).join('')
  const fail = (what: string): string =>
    `${what}: before ${JSON.stringify(shown(b))} after ${JSON.stringify(shown(a))} (around: ${JSON.stringify(shown(before.slice(Math.max(0, p - 6), p)))})`
  if (how === 'same' && (a.length > 0 || b.length > 0)) return fail('the roles of the characters changed')
  if (how === 'insert') {
    // what was there stays, with its roles (a plain character may be read in another way: a break next to a typed
    // ` +` is the characters; that is not about roles)
    let at = 0
    for (const x of b) {
      if (!x.roles) continue
      while (at < a.length && !eq(a[at]!, x)) at++
      if (at === a.length) return fail('a character lost its roles or its place')
      at++
    }
  }
  // what is new may be only what the action makes (a line break, a blank, a plus); it carries the roles around it only
  const allowed = new Set<string>(tokensOf(b.map((x) => x.roles).join('')))
  for (const x of [before[p - 1], before[before.length - s]])
    if (x) for (const t of tokensOf(x.roles)) allowed.add(t)
  for (const x of a)
    for (const t of tokensOf(x.roles))
      if (!allowed.has(t)) return fail(`the character ${JSON.stringify(x.ch)} got a role it was not given`)
  if (how === 'delete') {
    // what is left of the characters that were there is the same characters in the same order, with the roles they had
    // (a character that is only in the text after is the work of the reading: a deletion can make the text read in
    // another way, and a line break, a blank or a plus is new; neither has roles that were not around it, checked above)
    // So: the characters with roles that are left are some of the ones there were, with the same roles, and no more of
    // them are gone than the text lost (the deleted range, less the line breaks and blanks the action put in).
    const withRoles = (xs: readonly RoleChar[]): RoleChar[] =>
      xs.filter((x) => x.roles !== '' && !STRUCTURAL.includes(x.ch))
    const had = withRoles(b)
    const left = withRoles(a)
    let k = 0
    for (const x of left) {
      while (k < had.length && !eq(had[k]!, x)) k++
      if (k === had.length) return fail(`the character ${JSON.stringify(x.ch)} got roles it did not have`)
      k++
    }
    const made = (xs: readonly RoleChar[]): number => xs.filter((x) => STRUCTURAL.includes(x.ch)).length
    const removed = b.length - a.length + Math.max(0, made(a) - made(b))
    if (had.length - left.length > Math.max(0, removed)) return fail('a character lost its roles')
  }
  return null
}

/** The indices of the top-level nodes of `doc` that hold the ends of the range. */
function selectionBlocks(doc: PMNode, [from, to]: [number, number]): [number, number] {
  const at = (p: number): number =>
    Math.min(doc.childCount - 1, doc.resolve(Math.min(p, doc.content.size)).index(0))
  return [at(from), at(to)]
}

interface Run {
  problems: string[]
}

/** Runs the actions on a fixture; the first problem is thrown. */
export function runActions(
  start: Start,
  actions: readonly Action[],
  /** Called once after the last action, before the undo checks, with the screen's document and the text's projection. */
  inspect?: (screen: PMNode, projection: PMNode) => void,
): void {
  const { name, text } =
    'fixture' in start ? fixtureTexts[start.fixture]! : { name: 'generated', text: start.text }
  const session = createSession(text)
  const host = document.createElement('div')
  document.body.append(host)
  const rejects: string[] = []
  // what was typed could not be written as typed (a backslash before a mark, say): the screen shows what the text reads as
  const flags = { inexact: false }
  const editor = pm.createVisualEditor(host, {
    session,
    onReject: (_message, info) => rejects.push(info.code),
    onInexact: () => (flags.inexact = true),
  })
  const problems: string[] = []
  let step = 0
  try {
    const first = sameDoc(editor, session)
    if (first) throw new Error(`${name}: at open: ${first}`)
    const changesOf: Change[][] = []
    session.subscribe((e) => changesOf.push([...e.changes]))
    for (const a of actions) {
      step++
      const before = session.doc
      const rejectsBefore = rejects.length
      flags.inexact = false
      changesOf.length = 0
      const { view } = editor
      const pos = textPositions(view.state.doc)
      let beforeDoc = view.state.doc
      let must = false // the action is a command that has to do something or be refused
      let editorAction = true
      let aim: [number, number] = [0, 0]
      let literalCheck: { index: number; expected: string; kind: string; atEnd: boolean } | null = null
      let deleting = false
      const sel = (from: number, to: number): void => {
        setSelection(editor, from, to)
        aim = [view.state.selection.from, view.state.selection.to]
        // (leaving an island that was kept as it was typed rebuilds the screen: the edit starts from that screen)
        beforeDoc = view.state.doc
      }
      if (process.env.FUZZ_TRACE)
        console.log(
          `-- ${step} ${JSON.stringify(a)} on ${JSON.stringify(session.text.slice(0, Number(process.env.TRACE_LEN ?? 200)))}`,
        )
      const describe = (): string => `${name}, action ${step} ${JSON.stringify(a)}`
      try {
        switch (a.k) {
          case 'type':
          case 'typeOver': {
            if (pos.length === 0) break
            const p = pick(pos, a.a)
            const q = a.k === 'typeOver' ? pick(pos, a.b) : p
            sel(Math.min(p, q), Math.max(p, q))
            if (a.k === 'type') {
              // what the block should read after it: its text with the typed characters in it
              const $p = view.state.doc.resolve(view.state.selection.from)
              if ($p.parent.isTextblock) {
                const flat = flatText($p.parent)
                literalCheck = {
                  index: $p.index(0),
                  expected: flat.slice(0, $p.parentOffset) + typed[a.s]! + flat.slice($p.parentOffset),
                  kind: $p.parent.type.name,
                  atEnd:
                    $p.parentOffset === flat.length &&
                    flat.length > 0 &&
                    (typed[a.s]!.startsWith(' ') || endsInBlankOrBreak($p.parent)),
                }
              }
            }
            const { from, to } = view.state.selection
            for (const ch of typed[a.s]!) {
              const { from: f0, to: t0 } = view.state.selection
              void from
              void to
              if (
                !view.someProp('handleTextInput', (h) =>
                  h(view, f0, t0, ch, () => view.state.tr.insertText(ch, f0, t0)),
                )
              )
                view.dispatch(view.state.tr.insertText(ch, f0, t0))
              if (process.env.FUZZ_TRACE)
                console.log(
                  `   typed ${JSON.stringify(ch)} -> ${JSON.stringify(session.text.slice(0, Number(process.env.TRACE_LEN ?? 200)))}`,
                )
            }
            break
          }
          case 'backspace':
          case 'delete':
            if (pos.length === 0) break
            sel(pick(pos, a.a), pick(pos, a.a))
            {
              // inside a block one character goes (a pair of surrogates goes whole): what is left is the text without it
              const $c = view.state.doc.resolve(view.state.selection.from)
              const flat = flatText($c.parent)
              const o = $c.parentOffset
              const inside = a.k === 'backspace' ? o > 0 : o < flat.length
              if (
                $c.parent.isTextblock &&
                inside &&
                flat.length === $c.parent.content.size &&
                !/[\ud800-\udfff]/.test(flat)
              ) {
                const at = a.k === 'backspace' ? o - 1 : o
                const pair =
                  /[\ud800-\udbff]/.test(flat[at] ?? '') && /[\udc00-\udfff]/.test(flat[at + 1] ?? '')
                const pair2 =
                  /[\udc00-\udfff]/.test(flat[at] ?? '') && /[\ud800-\udbff]/.test(flat[at - 1] ?? '')
                const from = pair2 ? at - 1 : at
                const to = pair || pair2 ? from + 2 : from + 1
                literalCheck = {
                  index: $c.index(0),
                  expected: flat.slice(0, from) + flat.slice(to),
                  kind: $c.parent.type.name,
                  atEnd: false,
                }
                deleting = true
              }
            }
            if (a.k === 'backspace') editor.commands.deleteBackward()
            else editor.commands.deleteForward()
            break
          case 'cut': {
            if (pos.length === 0) break
            const p = pick(pos, a.a)
            const q = pick(pos, a.b)
            sel(Math.min(p, q), Math.max(p, q))
            editor.commands.deleteBackward()
            break
          }
          case 'enter':
            if (pos.length === 0) break
            sel(pick(pos, a.a), pick(pos, a.a))
            must = true
            editor.commands.splitBlock()
            break
          case 'shiftEnter':
            if (pos.length === 0) break
            sel(pick(pos, a.a), pick(pos, a.a))
            must = true
            editor.commands.insertBreak()
            break
          case 'ime': {
            if (pos.length === 0) break
            sel(pick(pos, a.a), pick(pos, a.a))
            const chars = [...typed[a.s]!]
            view.dom.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
            const during = session.text
            if (a.e !== 2) for (const ch of chars) view.dispatch(view.state.tr.insertText(ch))
            if (session.text !== during) throw new Error('the text changed during a composition')
            if (a.e > 0) {
              // the person goes to the source and edits there before the composition ends
              editorAction = false
              const len = session.text.length
              const from = Math.min(len, Math.floor(a.pa * (len + 1)))
              const to = Math.min(len, from + Math.floor(a.pb * 8))
              session.apply([{ from, to, insert: sourceText[a.ps]! }], { origin: 'source' })
            }
            const rejectedBefore = rejects.length
            view.dom.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
            if (a.e === 1 && /^[\p{L}\p{N}]+$/u.test(typed[a.s]!) && rejects.length === rejectedBefore) {
              // what was composed went into the text, and the cursor is right after it
              const d1 = view.state.doc
              const { from: f1, to: t1 } = view.state.selection
              // (only words are checked: typed markup or a blank can be read in a way that hides it from the screen)
              const before = d1.textBetween(0, f1, '\n', '\ufffc')
              const composed = chars.join('')
              // (nor when the text went into a plate: the cursor cannot be after it)
              let inPlate = false
              d1.descendants((n) => {
                if (n.type.name.endsWith('_chip') && String(n.attrs.text).includes(composed)) inPlate = true
                return !n.isAtom
              })
              if (!inPlate && f1 === t1 && d1.resolve(f1).parent.isTextblock && !before.endsWith(composed))
                throw new Error(
                  `${describe()}: after the composition the cursor is not after what was composed: ${JSON.stringify(before.slice(-40))} does not end with ${JSON.stringify(composed)}`,
                )
            }
            if (a.e > 0) {
              // the screen is the text, and the next key goes to its place: one letter more, nowhere else
              const p2 = sameDoc(editor, session)
              if (p2) throw new Error(`${describe()}: after the composition: ${p2}`)
              const { from: f0, to: t0 } = view.state.selection
              const shown = (d: PMNode, x: number, y: number): string => d.textBetween(x, y, '\n', '\ufffc')
              const d0 = view.state.doc
              const expected = shown(d0, 0, f0) + 'z' + shown(d0, t0, d0.content.size)
              const rejected = rejects.length
              flags.inexact = false
              // (a title is one line: text typed after its hard break makes the break the characters ` +`)
              const plain =
                f0 === t0 &&
                d0.resolve(f0).parent.isTextblock &&
                d0.resolve(f0).parent.type.name !== 'heading' &&
                // (the words of an island can change how the blocks after it read: an attribute that is set or unset, say)
                d0.resolve(f0).parent.type.name !== 'island' &&
                // (the text of a cell has no blank or blank line at its start in the file: a key typed into a cell that shows them
                // writes the text without)
                // (at any place in the cell, not only in that blank: the text of the whole cell is written again without it)
                !(d0.resolve(f0).parent.type.name === 'cell_text' && /^\s/.test(d0.resolve(f0).parent.textContent))
              if (
                !view.someProp('handleTextInput', (h) =>
                  h(view, f0, t0, 'z', () => view.state.tr.insertText('z', f0, t0)),
                )
              )
                view.dispatch(view.state.tr.insertText('z', f0, t0))
              const got = shown(view.state.doc, 0, view.state.doc.content.size)
              let plain2 = true
              // (a key that makes the source of a cell read as a block the screen shows as a plate: the cell is a plate now)
              // (only in the block of the cursor: a key in a cell is not a reason for a plate in another block)
              const plates = (d: PMNode, at: number): number => {
                let n = 0
                d.maybeChild(at)?.descendants((c) => {
                  if (c.type.name === 'cell_plate') n++
                  return true
                })
                return n
              }
              const at0 = d0.resolve(f0).index(0)
              if (plates(view.state.doc, at0) > plates(d0, at0)) plain2 = false
              if (plain && plain2 && !expected.includes('\r') && rejects.length === rejected && !flags.inexact && got !== expected)
                throw new Error(
                  `${describe()}: the key after the composition went to a wrong place: ${JSON.stringify(got.slice(0, 160))} instead of ${JSON.stringify(expected.slice(0, 160))}`,
                )
            }
            break
          }
          case 'mark': {
            if (pos.length === 0) break
            const p = pick(pos, a.a)
            const q = pick(pos, a.b)
            if (p === q) break
            sel(Math.min(p, q), Math.max(p, q))
            must = aim[0] !== aim[1] // (a draft that goes when the selection moves can leave a point)
            editor.commands.toggleMark(marks[a.m]!)
            break
          }
          case 'markCaret': {
            if (pos.length === 0) break
            sel(pick(pos, a.a), pick(pos, a.a))
            editor.commands.toggleMark(marks[a.m]!)
            for (const ch of typed[a.s]!) view.dispatch(view.state.tr.insertText(ch))
            break
          }
          case 'link': {
            if (pos.length === 0) break
            const p = pick(pos, a.a)
            const q = pick(pos, a.b)
            sel(Math.min(p, q), Math.max(p, q))
            must = aim[0] !== aim[1]
            editor.commands.setLink(targets[a.t]!)
            break
          }
          case 'unlink':
            if (pos.length === 0) break
            sel(pick(pos, a.a), pick(pos, a.a))
            must = true
            editor.commands.removeLink()
            break
          case 'style': {
            if (pos.length === 0) break
            sel(pick(pos, a.a), pick(pos, a.a))
            const level = a.t + 1 // 1 is the title of the document, which cannot be made
            must = true
            if (level >= 2 && level <= 6) editor.commands.setBlockType('heading', level)
            else editor.commands.setBlockType('paragraph')
            break
          }
          case 'list': {
            if (pos.length === 0) break
            const p = pick(pos, a.a)
            const q = pick(pos, a.b)
            sel(Math.min(p, q), Math.max(p, q))
            editor.commands.toggleList(LIST_KINDS[a.t]!)
            break
          }
          case 'tab': {
            if (pos.length === 0) break
            sel(pick(pos, a.a), pick(pos, a.a))
            // (the key is the editor's in a list, and left to the browser elsewhere)
            const ev = new KeyboardEvent('keydown', {
              key: 'Tab',
              shiftKey: a.shift,
              bubbles: true,
              cancelable: true,
            })
            editor.view.dom.dispatchEvent(ev)
            if (editor.listAt() && !ev.defaultPrevented) throw new Error(`${describe()}: Tab in a list moved the focus`)
            break
          }
          case 'check': {
            if (pos.length === 0) break
            sel(pick(pos, a.a), pick(pos, a.a))
            editor.commands.setChecked()
            break
          }
          case 'admonition': {
            if (pos.length === 0) break
            sel(pick(pos, a.a), pick(pos, a.a))
            // (nothing happens outside an admonition: the cursor is not in one)
            if (editor.admonitionAt()) {
              // the first line of a box is not the block the cursor is in: only the word of the type may change
              editorAction = false
              const changed = editor.commands.setAdmonitionType(ADMONITION_TYPES[a.t]!)
              for (const c of changesOf.flat())
                if (!ADMONITION_TYPES.includes(c.insert as never) || !ADMONITION_TYPES.includes(before.text.slice(c.from, c.to) as never))
                  throw new Error(`${describe()}: more than the word of the type changed (${changed})`)
            }
            break
          }
          case 'lang': {
            if (pos.length === 0) break
            sel(pick(pos, a.a), pick(pos, a.a))
            editorAction = false
            // (only code has a language; elsewhere nothing happens)
            if (editor.codeAt()) editor.commands.setCodeLanguage(CODE_LANGUAGES[a.t]!)
            break
          }
          case 'cellFill': {
            if (pos.length === 0) break
            sel(pick(pos, a.a), pick(pos, a.a))
            editorAction = false
            // (outside a table nothing happens)
            if (editor.tableAt()) editor.commands.setCellFill(CELL_FILLS[a.t]!)
            break
          }
          case 'insert': {
            if (pos.length === 0) break
            sel(pick(pos, a.a), pick(pos, a.a))
            editorAction = false
            editor.commands.insertBlock(INSERT_KINDS[a.t]!, { path: 'img/a.png', title: 'Подробнее' })
            break
          }
          case 'box': {
            if (pos.length === 0) break
            sel(pick(pos, a.a), pick(pos, a.a))
            editorAction = false
            editor.commands.toggleCollapsible()
            if (session.text !== before.text) throw new Error(`${describe()}: opening or closing a block changed the text`)
            break
          }
          case 'source': {
            editorAction = false
            const len = session.text.length
            const from = Math.min(len, Math.floor(a.a * (len + 1)))
            const to = Math.min(len, from + Math.floor(a.b * 8))
            session.apply([{ from, to, insert: sourceText[a.s]! }], { origin: 'source' })
            break
          }
          case 'undo':
            editorAction = false
            editor.commands.undo()
            break
          case 'redo':
            editorAction = false
            editor.commands.redo()
            break
        }
      } catch (e) {
        throw new Error(`${describe()}: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`, {
          cause: e,
        })
      }
      const after = session.doc
      // the blocks the action was aimed at: the ones its selection was in before it
      let picked: [number, number] | null = selectionBlocks(beforeDoc, aim)
      {
        const how =
          before.text !== after.text ? 'changed' : rejects.length > rejectsBefore ? 'rejected' : 'nothing'
        outcomes[`${a.k}:${how}`] = (outcomes[`${a.k}:${how}`] ?? 0) + 1
      }
      // 1. the screen is the projection of the text
      const p1 = sameDoc(editor, session)
      if (p1) throw new Error(`${describe()}: ${p1}`)
      // 2. nothing but the target changed
      // (changes that took each other back are no change)
      let all: Change[] = []
      for (const c of changesOf) all = composeChanges(all, c)
      if (editorAction && all.length > 0 && picked) {
        const items = layoutItems(readLayout(before))
        // (an island that holds the cursor may be several items of the text: its lines are kept as they were typed. The blocks
        // before it are the items in the same places, the blocks after it are the items that many places later)
        const delta = items.length - beforeDoc.childCount
        let aligned = delta === 0
        // (a block that is only started is on the screen and not in the text: the places do not match)
        let started = false
        beforeDoc.forEach((n) => {
          if (n.attrs.draft === true) started = true
        })
        if (started) aligned = false
        if (delta > 0 && !started) {
          let k = -1
          for (let i = 0; k < 0 && i < beforeDoc.childCount; i++) {
            const n = beforeDoc.child(i)
            const it = items[i]
            if (n.type.name !== 'island' || !it || !before.text.startsWith(n.textContent, it.from)) continue
            const end = items[i + delta]
            if (end && Math.abs(end.to - (it.from + n.textContent.length)) <= 2) k = i
          }
          const at = (i: number, last: boolean): number => (k < 0 || i < k ? i : i === k ? (last ? i + delta : i) : i + delta)
          if (k >= 0) {
            picked = [at(picked[0], false), at(picked[1], true)]
            aligned = true
          }
        }
        if (picked[0] >= items.length || picked[1] >= items.length) {
          aligned = false
          picked = [Math.min(picked[0], items.length - 1), Math.min(picked[1], items.length - 1)]
        }
        const lo = all[0]!.from
        const hi = all[all.length - 1]!.to
        // the items the changes reach (a change at the edge of two items reaches both)
        const inserting = lo === hi
        let m0 = items.findIndex((it) => it.to > lo || (inserting && it.to === lo))
        let m1 = items.length - 1
        while (m1 >= 0 && !(items[m1]!.from < hi || (inserting && items[m1]!.from === hi))) m1--
        if (m0 < 0) m0 = items.length - 1
        // allowed: the target, the blank lines around it and the block next to them
        let allowedLo = picked[0]
        while (allowedLo > 0 && items[allowedLo - 1]!.kind === 'empty') allowedLo--
        allowedLo = Math.max(0, allowedLo - 1)
        let allowedHi = picked[1]
        while (allowedHi < items.length - 1 && items[allowedHi + 1]!.kind === 'empty') allowedHi++
        allowedHi = Math.min(items.length - 1, allowedHi + 1)
        // a list is one thing: its marker changes with the type, and its numbers and levels with a move
        if (items.slice(picked[0], picked[1] + 1).some((it) => it.kind === 'item')) {
          while (allowedLo > 0 && items[allowedLo]!.kind === 'item') allowedLo--
          while (allowedHi < items.length - 1 && items[allowedHi]!.kind === 'item') allowedHi++
        }
        if (aligned && (m0 < allowedLo || m1 > allowedHi))
          throw new Error(
            `${describe()}: changed items ${m0}–${m1}, the target was ${picked[0]}–${picked[1]}\n  changes ${JSON.stringify(all).slice(0, 300)}`,
          )
      }
      // 2b. what was typed is text on the screen: markup characters are not read as markup
      if (
        literalCheck &&
        // an inexact write (a backslash before a mark, a mark typed against another) shows what the text reads as; a
        // plus after a blank or a break at the end of the block is not one of them: it is written as `{plus}` and shows as typed
        (!flags.inexact ||
          (!deleting && plusOnly.test(typed[(a as { s: number }).s]!) && literalCheck.atEnd)) &&
        rejects.length === rejectsBefore &&
        (deleting || !typed[(a as { s: number }).s]!.includes('\\'))
      ) {
        const node = view.state.doc.maybeChild(literalCheck.index)
        const leading =
          (!deleting && typed[(a as { s: number }).s]!.startsWith(' ')) ||
          /^[ \t]/.test(literalCheck.expected)
        // (a title is one line: text typed after its hard break makes the break the characters ` +`)
        const titleWithBreak = literalCheck.kind === 'heading' && literalCheck.expected.includes('\ufffc')
        if (
          node &&
          node.type.name === literalCheck.kind &&
          !leading &&
          !titleWithBreak &&
          // (a verbatim block of a CRLF text holds the line ends as the file has them)
          !literalCheck.expected.includes('\r') &&
          // (an island that is read again after the edit can take the blank lines after it: a block that is not closed goes on)
          (literalCheck.kind === 'island'
            ? flatText(node).trimEnd() !== literalCheck.expected.trimEnd() &&
              // (an edit can make a blank line, or a line that reads as a block, the end of the island: what follows it is read
              // as islands or blocks of its own, see islandReadsAs)
              !((r) => islandReadsAs(r.island, r.rest, literalCheck.expected))(islandsAndRest(view.state.doc, literalCheck.index, Math.max(0, beforeDoc.childCount - literalCheck.index - 1)))
            : flatText(node) !== literalCheck.expected)
        )
          throw new Error(
            `${describe()}: typed text is not shown as typed: ${JSON.stringify(flatText(node))} instead of ${JSON.stringify(literalCheck.expected)}`,
          )
      }
      // 2c. marks and links change how text looks, not what it says
      if (a.k === 'mark' || a.k === 'link' || a.k === 'unlink') {
        // (an item that is only started has no text, and goes with the cursor)
        const flat = (d: PMNode): string[] =>
          Array.from({ length: d.childCount }, (_, i) => d.child(i))
            .filter((n) => n.attrs.draft !== true && n.attrs.unsaved !== true)
            .map((n) => (n.isTextblock ? flatText(n) : n.attrs.text))
            // (the empty line that a started block stood on shows again when it goes: an empty block has no text to change)
            .filter((t) => t !== '')
            // (and the boxes of a block that is only on the screen — a collapsible one started — have no text, and go with it)
            .filter((t) => t !== undefined)
        const x = flat(beforeDoc)
        let y = flat(view.state.doc)
        // (an island that held the cursor is read again when the cursor leaves it)
        const aimInIsland = (p: number): boolean => beforeDoc.resolve(Math.min(p, beforeDoc.content.size)).parent.type.name === 'island'
        let hadIsland = false
        let hadUnsaved = false
        beforeDoc.forEach((n) => {
          if (n.type.name === 'island' && (aimInIsland(aim[0]) || aimInIsland(aim[1]))) hadIsland = true
          if (n.attrs.unsaved === true) hadUnsaved = true
        })
        // (and the text of an island is read again when the cursor leaves it: what the file says shows then, markup and all)
        if (hadUnsaved || hadIsland) y = x
        if (JSON.stringify(x) !== JSON.stringify(y))
          throw new Error(
            `${describe()}: the text changed under a mark or a link:\n  before ${JSON.stringify(x).slice(0, 400)}\n  after  ${JSON.stringify(y).slice(0, 400)}`,
          )
      }
      // 2d. roles stay on their characters: what stays has the roles it had, what is typed has only the roles of the
      // piece it is typed in
      if (editorAction && before.text !== after.text && rejects.length === rejectsBefore && !flags.inexact) {
        let how: Parameters<typeof checkRoles>[2] | null = null
        const collapsed = aim[0] === aim[1]
        if (a.k === 'type' || a.k === 'markCaret') how = collapsed ? 'insert' : 'replace'
        else if (a.k === 'typeOver') how = 'replace'
        else if (a.k === 'ime') how = a.e === 0 && collapsed ? 'insert' : null
        else if (a.k === 'mark' || a.k === 'link' || a.k === 'unlink') how = 'same'
        else how = 'delete' // Backspace, Delete, cut, Enter, Shift-Enter, style: nothing new but line breaks and blanks
        // (an island that held the cursor is read again when the cursor leaves it: a style or a mark moves it away, and its words show with their roles)
        const bp = (p: number): string => beforeDoc.resolve(Math.min(p, beforeDoc.content.size)).parent.type.name
        const islandBefore = bp(aim[0]) === 'island' || bp(aim[1]) === 'island'
        const typing = a.k === 'type' || a.k === 'typeOver' || a.k === 'ime' || a.k === 'markCaret'
        // (a block that reads as one the editor shows as source now, a list with a line of attributes over it, is an island: no roles in it)
        // (an island is new when its text was not among the islands before, with the count: a new one that touches an island
        // is read as one plate with it, and the number of islands does not grow)
        const islandTexts = (d: PMNode): Map<string, number> => {
          const m = new Map<string, number>()
          d.forEach((c) => {
            if (c.type.name === 'island') m.set(c.textContent, (m.get(c.textContent) ?? 0) + 1)
          })
          return m
        }
        const islandsBefore = islandTexts(beforeDoc)
        const becameIsland = [...islandTexts(view.state.doc)].some(([t, n]) => n > (islandsBefore.get(t) ?? 0))
        // (an island that is no longer one after the edit, its text no longer reads as source, is shown with the roles its words have:
        // the source had none to keep, so that block is left out on both sides, and the other blocks are checked as ever)
        const dissolved = new Set<number>()
        if (beforeDoc.childCount === view.state.doc.childCount)
          beforeDoc.forEach((n, _o, i) => {
            if (n.type.name === 'island' && view.state.doc.child(i).type.name !== 'island') dissolved.add(i)
          })
        // (an edit that starts in an island and changes the number of blocks: the source of the island is read as the text it is
        // now, split into blocks or merged with its neighbours, so what looked like source shows with its roles. The blocks that
        // the island was and is are left out on both sides; the other blocks are checked as ever)
        const touched = aim.map((p) => beforeDoc.resolve(Math.min(p, beforeDoc.content.size)).index(0))
        const lo = Math.min(...touched)
        const hi = Math.max(...touched)
        const diff = view.state.doc.childCount - beforeDoc.childCount
        const skipBefore = new Set(dissolved)
        const skipAfter = new Set(dissolved)
        if (islandBefore && diff !== 0) {
          for (let k = lo; k <= hi + Math.max(0, -diff); k++) skipBefore.add(k)
          for (let k = lo; k <= Math.max(lo, hi + diff); k++) skipAfter.add(k)
        }
        const problem = how && !(!typing && (islandBefore || becameIsland || screenDraft(beforeDoc))) ? checkRoles(roleChars(beforeDoc, skipBefore), roleChars(view.state.doc, skipAfter), how) : null
        if (problem) throw new Error(`${describe()}: roles: ${problem}`)
      }
      // an edit on the screen does not make a character the byte order mark of the file (nor the mark a character): the mark is
      // not shown
      if (editorAction && before.text.startsWith('﻿') !== after.text.startsWith('﻿'))
        throw new Error(`${describe()}: the byte order mark of the file was made or lost`)
      // 3. a command did something or told why it did not
      if (
        must &&
        before.text === after.text &&
        rejects.length === rejectsBefore &&
        // (an item that is only started shows on the screen: that is something done)
        !screenDraft(view.state.doc) &&
        // (a draft that is dropped from the screen: that is something done too)
        !(screenDraft(beforeDoc) && !beforeDoc.eq(view.state.doc)) &&
        !isKnownNoop(a, before.text, after.text)
      )
        throw new Error(`${describe()}: the command changed nothing and did not say why`)
      void parse
    }
    inspect?.(editor.view.state.doc, pm.projectDocument(session.doc))
    // 4. undoing everything gives the first text
    const last = session.text
    const nothingToRedo = !session.canRedo
    let undone = 0
    while (session.canUndo) {
      session.undo()
      undone++
      const p = sameDoc(editor, session)
      if (p) throw new Error(`${name}: after undo ${undone}: ${p}`)
    }
    if (session.text !== text) throw new Error(`${name}: undoing every step did not give the first text`)
    while (session.canRedo) session.redo()
    // (with steps that were undone during the run waiting, redo goes past the last text)
    if (nothingToRedo && session.text !== last)
      throw new Error(`${name}: redoing every step did not give the last text`)
    const p = sameDoc(editor, session)
    if (p) throw new Error(`${name}: after redo: ${p}`)
  } finally {
    editor.destroy()
    host.remove()
  }
  void problems
}

/** Commands that leave the text as it is without a fault: a style the block has already, a mark taken off what has none. */
function isKnownNoop(a: Action, before: string, _after: string): boolean {
  // a link with the target it has, a style the block has
  if (a.k === 'link') return before.includes(linkOpen(targets[a.t]!))
  // (a style the block has already is not a change)
  return a.k === 'style'
}

/** What a link to `target` starts with in the source (to tell that a command met the link it would make). */
function linkOpen(raw: string): string {
  const target = raw.replace(/ /g, '%20')
  if (target.startsWith('#')) return `<<${target.slice(1)},`
  if (/^https?:/.test(target)) return `${target}[`
  if (target.startsWith('mailto:')) return `${target}[`
  if (target.includes('#')) return `xref:${target}[`
  return `link:${target}[`
}

export type { Run }
