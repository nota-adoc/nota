/**
 * Structure dump for the Nota quality bench (second reference: Asciidoctor.js, pinned in
 * package-lock.json). Same format and the same instrumentation as ruby/dump.rb.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { FIXED_DATES } from '../dates.js'
import type { DumpCell, DumpEntry, DumpFile, DumpHeader, DumpNode, DumpTable, HtmlBlock } from '../format.js'

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyNode = any

let hooked = false
let entries: DumpEntry[] | null = null
let entryLine: number | null = null
let entryReader: unknown = null
let rawPassValue: string | null = null
let storeDepth = 0
let htmlOf: Map<unknown, string> | null = null
let asciidoctor: {
  load: (s: string, o: object) => Promise<AnyNode>
  NullLogger: new () => unknown
  version: string
} | null = null

async function setup() {
  if (asciidoctor) return asciidoctor
  // the ESM sources of the package (src/), so that the Parser we patch is the one load() uses
  const root = resolve(dirname(createRequire(import.meta.url).resolve('@asciidoctor/core')), '../..')
  const main = pathToFileURL(join(root, 'src/index.js')).href
  const mod: any = await import(main)
  const { Parser } = await import(new URL('./parser.js', main).href)
  if (!hooked) {
    hooked = true
    const processAttributeEntry = Parser.processAttributeEntry
    Parser.processAttributeEntry = async function (reader: any, ...rest: unknown[]) {
      const saved = [entryLine, entryReader] as const
      entryLine = reader.lineno
      entryReader = reader
      try {
        return await processAttributeEntry.call(this, reader, ...rest)
      } finally {
        ;[entryLine, entryReader] = saved
      }
    }
    const storeAttribute = Parser.storeAttribute
    // pass: macros in entry values are substituted before storeAttribute is called; log the raw value, as Ruby does
    const applyPass = mod.Document.prototype._applyAttributeEntryValueSubs
    mod.Document.prototype._applyAttributeEntryValueSubs = function (value: string, ...rest: unknown[]) {
      rawPassValue = value
      return applyPass.call(this, value, ...rest)
    }
    Parser.storeAttribute = function (
      name: string,
      value: string | null,
      doc: any = null,
      attrs: unknown = null,
      opts: any = {},
    ) {
      if (entries && storeDepth === 0 && doc && !doc.isNested() && entryLine !== null) {
        const raw = opts?.skipSubs && rawPassValue !== null ? rawPassValue : value
        entries.push({
          line: entryLine,
          name,
          value: raw,
          header: doc._headerAttributes == null,
          nested: entryReader !== doc.reader,
        })
      }
      rawPassValue = null
      storeDepth++
      try {
        return storeAttribute.call(this, name, value, doc, attrs, opts)
      } finally {
        storeDepth--
      }
    }
  }
  // the HTML of every block as the document converts it
  const convert = mod.AbstractBlock.prototype.convert
  mod.AbstractBlock.prototype.convert = async function (this: AnyNode, ...args: unknown[]) {
    const result = await convert.apply(this, args)
    htmlOf?.set(this, result)
    return result
  }
  const pkg = JSON.parse(readFileSync(new URL('../package.json', main), 'utf8'))
  asciidoctor = { load: mod.load, NullLogger: mod.NullLogger, version: pkg.version }
  return asciidoctor
}

export async function jsVersion(): Promise<string> {
  return (await setup()).version
}

function attributeListOf(block: AnyNode) {
  const attrs: Record<string | number, unknown> = block.getAttributes() ?? {}
  const roles =
    typeof attrs.role === 'string' && attrs.role ? (attrs.role as string).split(' ').filter(Boolean) : []
  const options = Object.keys(attrs)
    .filter((k) => k.endsWith('-option'))
    .map((k) => k.slice(0, -'-option'.length))
    .sort()
  const named: Record<string, string> = {}
  for (const [k, v] of Object.entries(attrs)) {
    if (/^\d+$/.test(k) || typeof v === 'object') continue
    named[k] = String(v)
  }
  return { roles, options, named }
}

const LIST_CONTEXTS = new Set(['ulist', 'olist', 'dlist', 'colist'])

function textLines(text: unknown): number {
  return typeof text === 'string' && text.length > 0 ? text.split('\n').length : 0
}

/** The layout of a table, as ruby/dump.rb writes it. */
function tableOf(table: AnyNode): DumpTable {
  const columns = table.columns.map((col: AnyNode) => ({
    width: col.getAttribute('colpcwidth') ?? null,
    halign: col.getAttribute('halign') ?? null,
    valign: col.getAttribute('valign') ?? null,
    style: col.style ? String(col.style) : null,
    autowidth: col.hasOption('autowidth'),
  }))
  const taken = new Set<string>()
  let rowNo = 0
  const rows: DumpTable['rows'] = { head: [], body: [], foot: [] }
  for (const section of ['head', 'body', 'foot'] as const) {
    rows[section] = table.rows[section].map((row: AnyNode[]) => {
      let colNo = 0
      const cells = row.map((cell: AnyNode) => {
        while (taken.has(`${rowNo},${colNo}`)) colNo++
        const colspan = cell.colspan ?? 1
        const rowspan = cell.rowspan ?? 1
        for (let dr = 0; dr < rowspan; dr++)
          for (let dc = 0; dc < colspan; dc++) taken.add(`${rowNo + dr},${colNo + dc}`)
        let blocks: DumpNode[] | undefined
        if (cell.innerDocument) {
          blocks = []
          walk(cell.innerDocument, blocks, 0)
        }
        const node: DumpCell = {
          row: rowNo,
          column: colNo,
          colspan,
          rowspan,
          halign: cell.getAttribute('halign') ?? null,
          valign: cell.getAttribute('valign') ?? null,
          style: cell.style ? String(cell.style) : null,
          line: cell.sourceLocation ? cell.sourceLocation.lineno : null,
          text: cell.source(),
        }
        if (blocks) node.blocks = blocks
        colNo += colspan
        return node
      })
      rowNo++
      return cells
    })
  }
  return { columns, rows }
}

function walk(parent: AnyNode, out: DumpNode[], parentLine: number, depth = 0, listLevel = 0) {
  for (const block of parent.getBlocks()) {
    const context = String(block.getContext())
    const loc = block.getSourceLocation()
    if (context === 'preamble' || (context === 'open' && block.getStyle() === 'partintro' && !loc)) {
      walk(block, out, parentLine, depth, listLevel)
      continue
    }
    const line = loc ? loc.lineno : null
    const node: DumpNode = { context, line, parent: parentLine, depth }
    if (context === 'section') {
      node.level = block.getLevel()
      node.title = block.rawTitle ?? null
      node.style = block.getAttributes().style ?? null
      node.id = block.getId() ?? null
      node.sectname = block.getSectionName()
    } else {
      node.style = block.getStyle() ?? null
      node.id = block.getId() ?? null
      if (context === 'floating_title') {
        node.level = block.getLevel()
        node.title = block.rawTitle ?? null
      }
      const cm = String(block.getContentModel())
      node.content_model = cm
      if ((cm === 'simple' || cm === 'verbatim' || cm === 'raw') && Array.isArray(block.lines))
        node.lines = block.lines.length
      if (LIST_CONTEXTS.has(context)) {
        node.list_level = listLevel
        node.items = block.getItems().length
      } else if (context === 'list_item') {
        node.marker = block.marker ?? null
        node.checkbox = 'checkbox' in block.getAttributes()
        node.checked = 'checked' in block.getAttributes()
        node.text_lines = textLines(block._text)
      }
      if (context === 'listing') node.language = block.getAttributes().language ?? null
      if (context === 'image' || context === 'video' || context === 'audio')
        node.target = block.getAttributes().target ?? null
    }
    Object.assign(node, attributeListOf(block))
    if (context === 'table') node.table = tableOf(block)
    out.push(node)
    if (context === 'dlist') {
      for (const [terms, desc] of block.getItems()) {
        const itemLoc = terms[0]?.getSourceLocation()
        out.push({
          context: 'list_item',
          line: itemLoc ? itemLoc.lineno : null,
          parent: parentLine,
          depth: depth + 1,
          style: null,
          id: null,
          content_model: 'compound',
          marker: null,
          checkbox: false,
          checked: false,
          text_lines: textLines(desc?._text),
          terms: terms.map((t: AnyNode) => t._text ?? null),
          roles: [],
          options: [],
          named: {},
        })
        if (desc && typeof desc.getBlocks === 'function')
          walk(desc, out, parentLine, depth + 2, listLevel + 1)
      }
    } else if (context === 'list_item') {
      walk(block, out, parentLine, depth + 1, listLevel + 1)
    } else if (context !== 'table' && typeof block.getBlocks === 'function') {
      walk(block, out, context === 'section' ? (line ?? parentLine) : parentLine, depth + 1, listLevel)
    }
  }
}

function htmlChildren(block: AnyNode, context: string): AnyNode[] {
  if (context === 'ulist' || context === 'olist' || context === 'colist')
    return block.getItems().flatMap((item: AnyNode) => item.getBlocks())
  if (context === 'dlist') return block.getItems().flatMap(([, dd]: AnyNode[]) => (dd ? dd.getBlocks() : []))
  if (context === 'table') return []
  return typeof block.getBlocks === 'function' ? block.getBlocks() : []
}

function htmlNode(block: AnyNode): HtmlBlock {
  const context = String(block.getContext())
  const loc = block.getSourceLocation()
  return {
    context,
    line: loc ? loc.lineno : null,
    html: htmlOf?.get(block) ?? '',
    blocks: htmlChildren(block, context).map(htmlNode),
  }
}

function headerOf(doc: AnyNode): DumpHeader {
  const attrs = doc.getAttributes()
  const header: DumpHeader = {
    title: doc.hasHeader() ? (doc.getHeader()?.rawTitle ?? null) : null,
    authors: [],
    revision: null,
  }
  const count = Number(attrs.authorcount ?? 0)
  if (count === 1) header.authors.push({ name: attrs.author ?? null, email: attrs.email ?? null })
  else
    for (let i = 1; i <= count; i++)
      header.authors.push({ name: attrs[`author_${i}`] ?? null, email: attrs[`email_${i}`] ?? null })
  if ('revnumber' in attrs || 'revdate' in attrs || 'revremark' in attrs)
    header.revision = {
      number: attrs.revnumber ?? null,
      date: attrs.revdate ?? null,
      remark: attrs.revremark ?? null,
    }
  return header
}

export async function dumpJs(
  dir: string,
  files: string[],
  read: (path: string) => string = (p) => readFileSync(p, 'utf8'),
): Promise<DumpFile[]> {
  const a = await setup()
  const out: DumpFile[] = []
  for (const rel of files) {
    entries = []
    try {
      const source = read(join(dir, rel))
      const doc = await a.load(source, {
        safe: 'secure',
        sourcemap: true,
        attributes: { sectids: null },
        logger: new a.NullLogger(),
      })
      const nodes: DumpNode[] = []
      walk(doc, nodes, 0)
      const structure = entries
      entries = null
      // the HTML of the document and of each block, from a document loaded with the default attributes
      htmlOf = new Map()
      const htmlDoc = await a.load(source, {
        safe: 'secure',
        sourcemap: true,
        attributes: FIXED_DATES,
        logger: new a.NullLogger(),
      })
      const html = { doc: await htmlDoc.convert(), blocks: htmlDoc.getBlocks().map(htmlNode) }
      out.push({ file: rel, header: headerOf(doc), entries: structure ?? [], nodes, html })
    } catch (e) {
      out.push({ file: rel, error: e instanceof Error ? `${e.name}: ${e.message}` : String(e) })
    } finally {
      entries = null
      htmlOf = null
    }
  }
  return out
}
