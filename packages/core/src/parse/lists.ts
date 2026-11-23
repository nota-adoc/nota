/**
 * Lists, a port of Asciidoctor 2.0's Parser.parse_list, parse_description_list, parse_callout_list,
 * parse_list_item and read_lines_for_list_item.
 *
 * As in Asciidoctor, the lines of a list item are collected first (up to the next sibling item, or where
 * the list ends), then parsed as a reader of their own: the first block that follows the item text
 * directly is folded into the text, continuation lines `+` glue blocks to the item, a nested list is a
 * list of the item's lines. The tree keeps every line: the `+` lines Asciidoctor replaces or drops are
 * `ListContinuation` nodes, blank lines it drops are blank lines of the list.
 */
import { Type } from '../nodes.js'
import { AttributeEntryRx, BlockTitleRx } from './rx.js'
import { type N, clean, leaf, mergeLeaves, node } from './build.js'
import type { Task } from './context.js'
import { ArrayReader, Cur, type Ln } from './lines.js'
import { NORMAL_SUBS } from './inline/index.js'
import { type BP, type BlockResult, type ListType, delimitedBlock } from './blocks.js'
import {
  type DlistMatch,
  isAnyList,
  isBlockAttributeLine,
  matchColist,
  matchDlist,
  matchOlist,
  matchUlist,
  resolveOrderedMarker,
  type ListMatch,
} from './rx.js'

/** What makes a line a sibling of the current item: a marker, or (description lists) a delimiter. */
type Sibling = { marker: string } | { delimiter: string }

/** An entry of the buffer of item lines; `marker` is set for `+` lines (and their placeholders). */
interface Ent {
  ln: Ln
  marker: boolean
}

function isSibling(line: string, type: ListType, sib: Sibling): boolean {
  switch (type) {
    case 'ulist': {
      const m = matchUlist(line)
      return m !== null && 'marker' in sib && m.marker === sib.marker
    }
    case 'olist': {
      const m = matchOlist(line)
      return m !== null && 'marker' in sib && resolveOrderedMarker(m.marker, 0).marker === sib.marker
    }
    case 'colist':
      return matchColist(line) !== null
    default:
      return 'delimiter' in sib && matchDlist(line, sib.delimiter) !== null
  }
}

const placeholder = (ln: Ln): Ln => ({ ...ln, text: '', end: ln.from, kind: 1 })

/** The kind of nested list the line starts (ListRxMap for the nestable types) and, for a description list, whether it has no text. */
function nestedList(line: string, onlyDlist: boolean): { type: ListType; noText: boolean } | null {
  if (!onlyDlist) {
    if (matchUlist(line)) return { type: 'ulist', noText: false }
    if (matchOlist(line)) return { type: 'olist', noText: false }
  }
  const d = matchDlist(line)
  return d ? { type: 'dlist', noText: d.textFrom < 0 } : null
}

const isIndented = (line: string) => line.charCodeAt(0) === 32 || line.charCodeAt(0) === 9

/** The lines of a list item, and what the collecting took out of them. */
interface ItemLines {
  buf: Ent[]
  /** Lines that were read but belong to no line of the item: repeated `+`, extra blank lines. */
  dropped: Ln[]
  /** The `+` that ends the item, and the blank lines after it. */
  trailingMarker: Ln | null
  trailingBlanks: Ln[]
}

/** Parser.read_lines_for_list_item. */
function readLinesForListItem(
  cur: Cur,
  type: ListType,
  sibling: Sibling,
  hasTextIn: boolean,
): ItemLines {
  const buffer: Ent[] = []
  const dropped: Ln[] = []
  // three states for continuation: inactive, active and frozen
  let continuation: 0 | 1 | 2 = 0
  let withinNested = false
  let detached: number | null = null
  let hasText = hasTextIn
  const dlist = type === 'dlist'
  let thisLn: Ln | null = null
  const sib = (line: string) => isSibling(line, type, sibling)
  /** read_lines_until(preserve_last_line, break_on_blank_lines, break_on_list_continuation). */
  const readLiteral = (): void => {
    let lineRead = false
    while (cur.has()) {
      const ln = cur.read()!
      const t = ln.text
      if (t === '' || (lineRead && t === '+') || (dlist && sib(t))) {
        cur.unshift()
        break
      }
      buffer.push({ ln, marker: false })
      lineRead = true
    }
  }
  const noteNested = (line: string): void => {
    const nl = nestedList(line, withinNested)
    if (nl) {
      withinNested = true
      // get greedy again
      if (nl.type === 'dlist' && nl.noText) hasText = false
    }
  }

  while (cur.has()) {
    thisLn = cur.read()!
    const line = thisLn.text
    // a sibling item completes this item
    if (sib(line)) break
    // a placeholder of an outer item's continuation is a marker for the lists nested in it
    const isMarker = line === '+' || thisLn.kind === 1
    const prev = buffer.length ? buffer[buffer.length - 1]! : null
    if (prev && prev.marker) {
      if (continuation === 0) {
        continuation = 1
        hasText = true
        if (!withinNested) buffer[buffer.length - 1] = { ln: placeholder(prev.ln), marker: true }
      }
      // adjacent list continuations (a syntax error)
      if (isMarker) {
        if (continuation !== 2) {
          continuation = 2
          buffer.push({ ln: thisLn, marker: true })
        } else dropped.push(thisLn)
        thisLn = null
        continue
      }
    }
    const dm = delimitedBlock(line)
    if (dm) {
      // a delimited block immediately breaks the list unless preceded by a list continuation
      if (continuation !== 1) break
      buffer.push({ ln: thisLn, marker: false })
      while (cur.has()) {
        const l = cur.read()!
        buffer.push({ ln: l, marker: false })
        if (l.text === dm.terminator) break
      }
      continuation = 0
    } else if (dlist && continuation !== 1 && line.startsWith('[') && isBlockAttributeLine(line)) {
      // a block attribute line only breaks a description list if the ensuing line is not a list item
      const attrLines: Ln[] = [thisLn]
      let interrupt = false
      while (cur.has()) {
        const next = cur.peekText()!
        if (delimitedBlock(next)) interrupt = true
        else if (next === '' || (next.startsWith('[') && isBlockAttributeLine(next))) {
          attrLines.push(cur.read()!)
          continue
        } else if (isAnyList(next) && !sib(next)) {
          for (const a of attrLines) buffer.push({ ln: a, marker: false })
        } else interrupt = true
        break
      }
      if (interrupt) {
        thisLn = null
        cur.i -= attrLines.length
        break
      }
      if (!cur.has()) for (const a of attrLines) dropped.push(a)
    } else if (continuation === 1 && line !== '') {
      if (isIndented(line)) {
        // literal paragraphs have special considerations
        cur.unshift()
        readLiteral()
        continuation = 0
      } else {
        const c0 = line.charAt(0)
        if (
          (c0 === '.' && BlockTitleRx.test(line)) ||
          (c0 === '[' && isBlockAttributeLine(line)) ||
          (c0 === ':' && AttributeEntryRx.test(line))
        ) {
          // let block metadata play out until we find the block
          buffer.push({ ln: thisLn, marker: false })
        } else {
          noteNested(line)
          buffer.push({ ln: thisLn, marker: isMarker })
          continuation = 0
        }
      }
    } else if (prev && prev.ln.text === '') {
      // advance to the next line of content
      let stop = false
      if (line === '') {
        dropped.push(thisLn)
        let next: Ln | null = null
        while (cur.has()) {
          const l = cur.read()!
          if (l.text === '') dropped.push(l)
          else {
            next = l
            break
          }
        }
        thisLn = next
        // stop reading if we reach eof, or hit a sibling list item
        if (thisLn === null || sib(thisLn.text)) stop = true
      }
      if (stop) break
      const t = thisLn!.text
      if (t === '+') {
        detached = buffer.length
        buffer.push({ ln: thisLn!, marker: true })
      } else if (hasText) {
        // in this block, we have to see whether we stay in the list
        if (sib(t)) break
        const nl = nestedList(t, false)
        if (nl) {
          buffer.push({ ln: thisLn!, marker: false })
          withinNested = true
          if (nl.type === 'dlist' && nl.noText) hasText = false
        } else if (isIndented(t)) {
          // slurp up any literal paragraph offset by blank lines
          cur.unshift()
          readLiteral()
        } else break
      } else {
        // only a description list in need of item text: slurp it up
        if (!withinNested) {
          const popped = buffer.pop()
          if (popped) dropped.push(popped.ln)
        }
        buffer.push({ ln: thisLn!, marker: false })
        hasText = true
      }
    } else if (isMarker) {
      hasText = true
      buffer.push({ ln: thisLn, marker: true })
    } else {
      if (line !== '') hasText = true
      noteNested(line)
      buffer.push({ ln: thisLn, marker: false })
    }
    thisLn = null
  }
  if (thisLn) cur.unshift()
  if (detached !== null) buffer[detached] = { ln: placeholder(buffer[detached]!.ln), marker: true }
  let trailingMarker: Ln | null = null
  const trailingBlanks: Ln[] = []
  while (buffer.length) {
    const last = buffer[buffer.length - 1]!
    if (last.marker) {
      // drop the optional trailing continuation
      buffer.pop()
      trailingMarker = last.ln
      break
    } else if (last.ln.text === '') {
      // strip trailing blank lines to prevent empty blocks
      buffer.pop()
      trailingBlanks.unshift(last.ln)
    } else break
  }
  // lines dropped after the last line of the item do not belong to it
  const end = Math.max(
    buffer.length ? buffer[buffer.length - 1]!.ln.next : -1,
    trailingMarker ? trailingMarker.next : -1,
  )
  const late = dropped.filter((d) => d.from >= end)
  const inside = dropped.filter((d) => d.from < end)
  if (late.length) trailingBlanks.push(...late)
  trailingBlanks.sort((a, b) => a.from - b.from)
  return { buf: buffer, dropped: inside, trailingMarker, trailingBlanks }
}

/** Text that may change attributes when it is read. */
const SETS = /\{(?:set|counter2?):/

/** The pieces of a parsed list item, before they are put into a node. */
interface ItemParts {
  children: N[]
  from: number
  to: number
  /** Description lists: the item has text or blocks (a term without them takes the next term's). */
  hasDesc: boolean
  /** Blank lines that came after the item. */
  trailing: N[]
}

const leafOfDropped = (ln: Ln): N =>
  ln.kind === 1 || ln.text === '+'
    ? leaf(Type.ListContinuation, ln.from, ln.next)
    : ln.text === ''
      ? leaf(Type.BlankLine, ln.from, ln.next)
      : leaf(Type.TextLine, ln.from, ln.next)

/**
 * Parser.parse_list_item for one item. `first` is what the line of the item holds before its text: the
 * nodes of the marker, the offset of the text (or -1 for none).
 */
function* parseListItem(
  bp: BP,
  cur: Cur,
  type: ListType,
  sibling: Sibling,
  first: { nodes: N[]; textFrom: number; from: number },
  hasInlineText: boolean,
): Task<ItemParts> {
  const L = bp.L
  const ln = L.ln(cur.i)
  const dlist = type === 'dlist'
  // first skip the line with the marker / term (it gets put back onto the reader by next_block)
  cur.shift()
  const lines = readLinesForListItem(cur, type, sibling, hasInlineText || !dlist)
  const rd = new ArrayReader(
    lines.buf.map((e) => e.ln),
    0,
    lines.buf.length,
  )
  const sub = bp.child(rd)
  const out: N[] = []
  let contentAdjacent = false
  let hasText = hasInlineText || !dlist
  const firstText = first.textFrom >= 0 ? bp.textLineFrom(ln, first.textFrom) : null
  const extra: N[] = []
  let folded = false
  let foldedBlock: N | null = null
  let blocks = 0
  // Asciidoctor converts the text of an item before the blocks in it, with the attributes as they are when the item
  // starts: what the blocks in it set comes after, and what the text sets (`{set:}`, `{counter:}`) reaches them. So
  // the text is read on a copy of those attributes, before the blocks that come after it are read, and what it
  // changed goes into the attributes of the document.
  const atStart = bp.c.ab.freeze()
  let trial: string[] = []
  const read = (parts: N[], raw: boolean, isolated = false): N[] => {
    if (!raw) return parts
    const tracker = bp.c.tracker.fork(atStart, isolated)
    const kids = bp.inlineLines(parts, NORMAL_SUBS, null, { get: (n) => tracker.get(n), ...tracker.hooks })
    if (isolated) trial = bp.c.tracker.adopt(tracker, atStart)
    else bp.c.tracker.adopt(tracker, atStart, trial)
    return kids
  }
  const itemText = (kids: N[]): N => node(Type.ItemText, kids[0]!.from, kids[kids.length - 1]!.to, kids)
  let textDone = false
  if (rd.has(0)) {
    // peek on the other side of any comment lines
    let k = 0
    while (rd.has(k) && rd.get(k) !== '' && rd.get(k).startsWith('//')) k++
    if (rd.has(k)) {
      if (rd.get(k) !== '') {
        contentAdjacent = true
        // treat lines as paragraph text if continuation does not connect first block
        if (!dlist) hasText = false
      }
      const c = new Cur(rd, 0)
      if (!contentAdjacent && firstText) {
        // nothing can be folded into the text: it is read before the blocks
        extra.push(itemText(read([firstText], true)))
        textDone = true
      }
      if (contentAdjacent && firstText && SETS.test(bp.c.text.slice(firstText.from, firstText.to))) {
        // The first block may be the rest of the text, which is read once it is known; what the line of the item sets
        // is there for the block all the same: a trial run of the line puts it in place, the reading of the text
        // makes it final.
        const nd = bp.c.diags.length
        read([firstText], true, true)
        bp.c.diags.length = nd
      }
      yield* sub.nextBlock(c, out, type, !hasText)
      if (contentAdjacent) {
        // the first block may be folded into the text of the item: the text waits for it
        while (c.has() && sub.blocksSeen.length === 0) yield* sub.nextBlock(c, out, type, false)
        const firstBlock = sub.blocksSeen[0]
        if (firstBlock && firstBlock.type === Type.Paragraph) {
          // fold the first block into the text of the item
          const at = out.indexOf(firstBlock)
          const textParts: N[] = []
          if (firstText) textParts.push(firstText)
          const raw = bp.c.rawText.get(firstBlock)
          for (let j = 0; j <= at; j++) {
            if (j === at) textParts.push(...(raw ? raw.children : firstBlock.children!))
            else textParts.push(out[j]!)
          }
          out.splice(0, at + 1)
          extra.push(itemText(read(textParts, !!raw)))
          folded = true
          foldedBlock = firstBlock
          textDone = true
        } else if (firstText) {
          extra.push(itemText(read([firstText], true)))
          textDone = true
        }
      }
      // text that was kept for the item and did not become part of its text is a paragraph of its own, in its place
      for (const b of sub.blocksSeen) if (b !== foldedBlock) bp.finishRaw(b)
      while (c.has()) yield* sub.nextBlock(c, out, type, false)
      blocks = sub.blocksSeen.length
    } else {
      // only comment lines: they are dropped from the item
      for (let j = 0; j < k; j++) extra.push(leaf(Type.LineComment, rd.start(j), rd.next(j)))
    }
  }
  if (!folded && firstText && !textDone) extra.push(itemText(read([firstText], true)))
  const own: N[] = [...first.nodes, ...extra, ...out]
  own.sort((a, b) => a.from - b.from)
  // lines the collecting dropped may lie between the lines of a block of the item
  const dropped = lines.dropped.map(leafOfDropped)
  if (lines.trailingMarker)
    dropped.push(leaf(Type.ListContinuation, lines.trailingMarker.from, lines.trailingMarker.next))
  dropped.sort((a, b) => a.from - b.from)
  const children = mergeLeaves(own, dropped)
  const to = children.length ? children[children.length - 1]!.to : ln.next
  const trailing = lines.trailingBlanks.map(leafOfDropped)
  return {
    children: clean(children),
    from: first.from,
    to,
    hasDesc: hasInlineText || folded || blocks > 0,
    trailing,
  }
}

function listType(type: ListType): number {
  switch (type) {
    case 'ulist':
      return Type.UnorderedList
    case 'olist':
      return Type.OrderedList
    case 'dlist':
      return Type.DescriptionList
    default:
      return Type.CalloutList
  }
}

/** Parser.parse_list, parse_description_list and parse_callout_list. */
export function* parseList(
  bp: BP,
  cur: Cur,
  type: ListType,
  _style: string | null,
  meta: N[],
  from: number,
): Task<BlockResult> {
  const L = bp.L
  const items: N[] = []
  let after: N[] = []
  let end = L.next(cur.i)
  if (type === 'dlist') {
    const firstMatch = matchDlist(L.get(cur.i))!
    const delimiter = firstMatch.delimiter
    const sibling: Sibling = { delimiter }
    interface Pair {
      children: N[]
      from: number
      to: number
      hasDesc: boolean
      trailing: N[]
    }
    let current: Pair | null = null
    /** Puts the current pair into the list, followed by the blank lines after it. */
    const finish = (last: boolean): void => {
      const c = current!
      const n = node(Type.ListItem, c.from, c.to, c.children)
      items.push(n)
      end = n.to
      if (last) after = c.trailing
      else items.push(...c.trailing)
      current = null
    }
    let m: DlistMatch | null = firstMatch
    while (m) {
      const ln = L.ln(cur.i)
      const s = ln.from
      const nodes: N[] = [
        bp.inlineText(Type.DescriptionTerm, s + m.termFrom, s + m.termTo, NORMAL_SUBS, null),
        leaf(Type.ListMarker, s + m.delimFrom, s + m.delimTo),
      ]
      if (m.textFrom < 0) {
        const nl = bp.newline(cur.i)
        if (nl) nodes.push(nl)
      }
      const parts: ItemParts = yield* parseListItem(
        bp,
        cur,
        type,
        sibling,
        { nodes, textFrom: m.textFrom < 0 ? -1 : s + m.textFrom, from: s },
        m.textFrom >= 0,
      )
      const c = current as Pair | null
      if (c && !c.hasDesc) {
        // several terms share the description that follows them
        c.children.push(...c.trailing, ...parts.children)
        c.to = parts.to
        c.hasDesc = parts.hasDesc
        c.trailing = parts.trailing
      } else {
        if (c) finish(false)
        current = {
          children: parts.children,
          from: parts.from,
          to: parts.to,
          hasDesc: parts.hasDesc,
          trailing: parts.trailing,
        }
      }
      m = cur.has() ? matchDlist(L.get(cur.i), delimiter) : null
    }
    finish(true)
  } else {
    let pending: N[] = []
    let ordinal = 0
    let nextIndex = 1
    let autonum = 0
    const rxFor = type === 'ulist' ? matchUlist : type === 'olist' ? matchOlist : matchColist
    while (cur.has()) {
      const ln = L.ln(cur.i)
      const m: ListMatch | null = rxFor(ln.text)
      if (!m) break
      const s = ln.from
      let sibling: Sibling
      const nodes: N[] = [leaf(Type.ListMarker, s + m.markerFrom, s + m.markerTo)]
      let textFrom = s + m.textFrom
      if (type === 'ulist') {
        sibling = { marker: m.marker }
        const t = ln.text.slice(m.textFrom)
        if (t.startsWith('[ ] ') || t.startsWith('[x] ') || t.startsWith('[*] ')) {
          nodes.push(leaf(Type.Checkbox, textFrom, textFrom + 3))
          textFrom += 4
        }
      } else if (type === 'olist') {
        const r = resolveOrderedMarker(m.marker, ordinal)
        sibling = { marker: r.marker }
        if (r.expected !== undefined)
          bp.diag(
            ln.from,
            ln.end,
            'warning',
            'list-item-index',
            `List item index: expected ${r.expected}, got ${r.actual}`,
          )
      } else {
        sibling = { marker: '<1>' }
        let num = m.marker.slice(1, -1)
        if (num === '.') num = String(++autonum)
        if (num !== String(nextIndex))
          bp.diag(
            ln.from,
            ln.end,
            'warning',
            'list-item-index',
            `Callout list item index: expected ${nextIndex}, got ${num}`,
          )
        nextIndex++
      }
      const parts: ItemParts = yield* parseListItem(
        bp,
        cur,
        type,
        sibling,
        { nodes, textFrom, from: s },
        true,
      )
      const n = node(Type.ListItem, parts.from, parts.to, parts.children)
      items.push(...pending, n)
      pending = [...parts.trailing]
      end = n.to
      ordinal++
      if (type === 'colist') continue
      // skip the blank lines between items; an empty reader ends the list
      while (cur.has() && L.blank(cur.i)) {
        pending.push(bp.blankNode(cur.i))
        cur.i++
      }
      if (!cur.has()) break
    }
    after = pending
  }
  const n = node(listType(type), from, end, [...meta, ...items])
  return { n, after }
}
