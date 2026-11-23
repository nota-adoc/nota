/**
 * The html5 converter of Asciidoctor (Converter::Html5Converter), for the embedded document, over the model
 * of model.ts. Every function follows the method of the same name in the Ruby source.
 */
import { type InlineEnv, NORMAL_SUBS, substitute } from '@nota-adoc/core'
import { AttributeTracker, AttrsBuilder, BASIC_SUBS, REFTEXT_SUBS, rubyToI } from '@nota-adoc/core/internal'
import type { TableCellModel } from '@nota-adoc/core'
import { Blk, type Effect, type ModelFootnote as Footnote, type Model, type Src } from '@nota-adoc/core/internal'

const URI_SNIFF = /^[\p{Alphabetic}][\p{Alphabetic}\p{Nd}.+-]+:\/{0,2}/u

/** PathResolver#web_path. */
function webPathOf(target0: string, start0: string | undefined): string {
  let target = target0.replaceAll('\\', '/')
  const start = start0 === undefined ? '' : start0.replaceAll('\\', '/')
  let uriPrefix: string | undefined
  if (start !== '' && !target.startsWith('/')) {
    const combined = `${start}${start.endsWith('/') ? '' : '/'}${target}`
    const m = combined.includes(':') ? URI_SNIFF.exec(combined) : null
    if (m) {
      uriPrefix = m[0]
      target = combined.slice(m[0].length)
    } else target = combined
  }
  const root = target.startsWith('/') ? '/' : target.startsWith('./') ? './' : undefined
  const rest = root ? target.slice(root.length) : target
  const segments = rest.split('/').filter((x) => x !== '.')
  // String#split drops the empty strings at the end
  while (segments.length && segments[segments.length - 1] === '') segments.pop()
  const resolved: string[] = []
  for (const seg of segments) {
    if (seg === '..') {
      if (resolved.length === 0) {
        if (!(root && root !== './')) resolved.push(seg)
      } else if (resolved[resolved.length - 1] === '..') resolved.push(seg)
      else resolved.pop()
    } else resolved.push(seg)
  }
  let path = `${root ?? ''}${resolved.join('/')}`
  if (path.includes(' ')) path = path.replaceAll(' ', '%20')
  return uriPrefix !== undefined ? `${uriPrefix}${path}` : path
}

const DropAnchorRx = /<(?:a\b[^>]*|\/a)>/g
const LeadingAnchorsRx = /^(?:<a id="[^"]+"><\/a>)+/
const StemBreakRx = / *\\\n(?:\\?\n)*|\n\n+/g

const BLOCK_MATH: Readonly<Record<string, readonly [string, string]>> = {
  asciimath: ['\\$', '\\$'],
  latexmath: ['\\[', '\\]'],
}

/** The tags of the styles of a table cell (`Html5Converter::QUOTE_TAGS`); the other styles write the text as it is. */
const QUOTE_TAGS: Readonly<Record<string, readonly [string, string]>> = {
  monospaced: ['<code>', '</code>'],
  emphasis: ['<em>', '</em>'],
  strong: ['<strong>', '</strong>'],
}

const ORDERED_LIST_KEYWORDS: Readonly<Record<string, string>> = {
  loweralpha: 'a',
  lowerroman: 'i',
  upperalpha: 'A',
  upperroman: 'I',
}

/** Helpers.nextval. */
function nextval(cur: string | number): string | number {
  if (typeof cur === 'number') return cur + 1
  const n = rubyToI(cur)
  if (String(n) !== cur) return String.fromCodePoint(cur.codePointAt(0)! + 1)
  return n + 1
}

export class Converter {
  readonly live: AttrsBuilder
  readonly tracker: AttributeTracker
  readonly footnotes: Footnote[]
  private readonly counters = new Map<string, string | number>()
  private reftexts: Map<string, string> | null = null
  private resolving = false
  private depth = 0

  /** `parent`: the converter of the document that holds the table this is the document of a cell of. */
  constructor(
    readonly model: Model,
    private readonly parent: Converter | null = null,
  ) {
    this.footnotes = [...model.footnotes]
    this.live = new AttrsBuilder(model.bodyAttrs)
    const st = { doctype: model.doctype, leveloffset: 0 }
    this.tracker = new AttributeTracker(this.live, model.locked, st)
  }

  // ---------------------------------------------------------------- environment

  attr(name: string): string | undefined {
    return this.live.get(name)
  }

  /** Document#counter. */
  counter(name: string, seed?: string): string {
    // a document in a table cell counts with the document that holds the table
    if (this.parent) return this.parent.counter(name, seed)
    const locked = this.model.locked.has(name)
    let next: string | number
    const known = this.counters.get(name)
    const cur = this.live.get(name)
    if ((locked && known !== undefined) || (cur !== undefined && cur !== '')) {
      next = nextval(locked && known !== undefined ? known : cur!)
    } else if (seed !== undefined) next = String(rubyToI(seed)) === seed ? rubyToI(seed) : seed
    else next = 1
    this.counters.set(name, next)
    if (!locked) this.live.set(name, String(next))
    return String(next)
  }

  env(b: Blk | null): InlineEnv {
    return {
      get: (n) => this.live.get(n),
      set: (name, value) => this.tracker.entry(value === null ? `${name}!` : name, value ?? '', false),
      counter: (name, seed) => this.counter(name, seed),
      block: b ? (n) => b.attrs.get(n) ?? undefined : undefined,
      addFootnote: (id, text) => {
        const index = Number(this.counter('footnote-number'))
        this.footnotes.push({ index, id, text })
        return index
      },
      footnote: (id) => this.footnotes.find((f) => f.id === id),
      hasRef: (id) => this.model.refs.has(id),
      resolveId: (text) => this.resolveId(text),
      xrefText: (id, style) => this.xrefTextOf(id, style),
      docname: this.live.get('docname'),
      bibliography: b !== null && b.ctx === 'list_item' && b.parent?.style === 'bibliography',
      imageUri: (t) => this.webPath(t, this.live.get('imagesdir')),
      iconUri: (t) => this.iconUri(t),
    }
  }

  /** AbstractNode#normalize_web_path for the targets of images (secure mode: nothing is read). */
  webPath(target: string, start: string | undefined): string {
    // a target that looks like a URI (`https://…`, `data:…`) is used as it is (spaces encoded)
    if (URI_SNIFF.test(target)) return target.includes(' ') ? target.replaceAll(' ', '%20') : target
    return webPathOf(target, start)
  }

  iconUri(name: string): string {
    const icon = this.live.get('icontype') ?? 'png'
    const dir = this.live.get('iconsdir') ?? `${this.live.get('imagesdir') ?? './images'}/icons`
    const file = /\.[a-z]+$/i.test(name) ? name : `${name}.${icon}`
    return this.webPath(file, dir)
  }

  /** Converts a text: the lines with the substitutions of a block. */
  sub(src: Src | null, b: Blk | null, subs = NORMAL_SUBS): string {
    if (src === null) return ''
    const text = 'str' in src ? src.str : src.lines.join('\n')
    return substitute(text, null, subs, this.env(b))
  }

  // ---------------------------------------------------------------- titles and references

  /** AbstractBlock#title: the title with the substitutions of a title, converted once. */
  title(b: Blk): string | null {
    if (b.title === null) return null
    if (b.convertedTitle === null) b.convertedTitle = this.sub(b.title, b)
    return b.convertedTitle
  }

  hasTitle(b: Blk): boolean {
    return b.title !== null
  }

  captionedTitle(b: Blk): string {
    return `${b.caption ?? ''}${this.title(b) ?? ''}`
  }

  reftextOf(b: Blk): string | null {
    const v = b.attrs.get('reftext')
    if (v === undefined || v === null) return null
    return substitute(v, null, REFTEXT_SUBS, this.env(null))
  }

  /** AbstractBlock#xreftext and Section#xreftext. */
  xreftext(b: Blk, style: string | undefined): string | null {
    const val = this.reftextOf(b)
    if (val !== null && val !== '') return val
    if (b.ctx === 'section') return this.sectionXreftext(b, style)
    if (style && b.title !== null && b.caption !== null && b.caption !== '') {
      const compat = this.live.get('compat-mode') !== undefined
      switch (style) {
        case 'full': {
          const q = compat ? `\`\`${this.title(b)}''` : `"\`${this.title(b)}\`"`
          const text = substitute(q, null, ['quotes'], this.env(null))
          const ctx = b.ctx === 'image' ? 'figure' : b.ctx
          const attrName =
            ctx === 'example'
              ? 'example-caption'
              : ctx === 'figure'
                ? 'figure-caption'
                : ctx === 'listing'
                  ? 'listing-caption'
                  : ctx === 'table'
                    ? 'table-caption'
                    : null
          const prefix = attrName ? this.live.get(attrName) : undefined
          if (b.numeral !== null && prefix !== undefined) return `${prefix} ${b.numeral}, ${text}`
          return `${b.caption.replace(/\. $/, '')}, ${text}`
        }
        case 'short': {
          const ctx = b.ctx === 'image' ? 'figure' : b.ctx
          const attrName =
            ctx === 'example'
              ? 'example-caption'
              : ctx === 'figure'
                ? 'figure-caption'
                : ctx === 'listing'
                  ? 'listing-caption'
                  : ctx === 'table'
                    ? 'table-caption'
                    : null
          const prefix = attrName ? this.live.get(attrName) : undefined
          if (b.numeral !== null && prefix !== undefined) return `${prefix} ${b.numeral}`
          return b.caption.replace(/\. $/, '')
        }
        default:
          return this.title(b)
      }
    }
    return this.title(b)
  }

  private sectionXreftext(s: Blk, style: string | undefined): string | null {
    const title = this.title(s) ?? ''
    if (style) {
      const type = s.sectname
      const italic = (t: string) => substitute(`_${t}_`, null, ['quotes'], this.env(null))
      if (s.numbered) {
        const compat = this.live.get('compat-mode') !== undefined
        switch (style) {
          case 'full': {
            let quoted: string
            if (type === 'chapter' || type === 'appendix') quoted = italic(title)
            else
              quoted = substitute(
                compat ? `\`\`${title}''` : `"\`${title}\`"`,
                null,
                ['quotes'],
                this.env(null),
              )
            const signifier = this.live.get(`${type}-refsig`)
            const num = this.sectnum(s, '.', ',')
            return signifier !== undefined ? `${signifier} ${num} ${quoted}` : `${num} ${quoted}`
          }
          case 'short': {
            const signifier = this.live.get(`${type}-refsig`)
            return signifier !== undefined
              ? `${signifier} ${this.sectnum(s, '.', '')}`
              : this.sectnum(s, '.', '')
          }
          default:
            return type === 'chapter' || type === 'appendix' ? italic(title) : title
        }
      }
      return type === 'chapter' || type === 'appendix' ? italic(title) : title
    }
    return title
  }

  /** Section#sectnum. */
  sectnum(s: Blk, delimiter = '.', append?: string | false): string {
    const app = append === undefined ? delimiter : append === false ? '' : append
    const p = s.parent
    return s.level > 1 && p && p.ctx === 'section'
      ? `${this.sectnum(p, delimiter, delimiter)}${s.numeral ?? ''}${app}`
      : `${s.numeral ?? ''}${app}`
  }

  /** True while the text of a cross reference is worked out: a reference inside it says `[id]` (`@resolving_xref`). */
  private resolvingXref = false

  /** The text of a cross reference to `id`; null when the id is unknown or has no text. */
  xrefTextOf(id: string, style: string | undefined): string | null {
    if (this.resolvingXref) return null
    this.resolvingXref = true
    try {
      const text = this.xrefTextInner(id, style)
      return text !== null && text.includes('<a') ? text.replace(DropAnchorRx, '') : text
    } finally {
      this.resolvingXref = false
    }
  }

  private xrefTextInner(id: string, style: string | undefined): string | null {
    if (id === '') {
      const h = this.model.header
      if (!h) return null
      const rt = this.live.get('reftext')
      if (rt) return rt
      return this.docTitle()
    }
    const ref = this.model.refs.get(id)
    if (!ref) return null
    switch (ref.kind) {
      case 'section':
      case 'block':
        return ref.blk ? this.xreftext(ref.blk, style) : null
      case 'document':
        return this.docTitle()
      case 'anchor':
        return ref.reftext === null ? null : substitute(ref.reftext, null, REFTEXT_SUBS, this.env(null))
    }
  }

  private resolveId(text: string): string | null {
    if (this.resolving) return null
    if (!this.reftexts) {
      this.resolving = true
      const map = new Map<string, string>()
      for (const [id, ref] of this.model.refs) {
        let t: string | null
        switch (ref.kind) {
          case 'section':
          case 'block':
            t = ref.blk ? this.xreftext(ref.blk, undefined) : null
            break
          case 'document':
            t = this.docTitle()
            break
          default:
            t = ref.reftext === null ? null : substitute(ref.reftext, null, REFTEXT_SUBS, this.env(null))
        }
        if (t !== null && !map.has(t)) map.set(t, id)
      }
      this.resolving = false
      this.reftexts = map
    }
    return this.reftexts.get(text) ?? null
  }

  docTitle(): string | null {
    const h = this.model.header
    if (!h || h.title === null) return null
    if (h.convertedTitle === null) h.convertedTitle = this.sub(h.title, null)
    return h.convertedTitle
  }

  // ---------------------------------------------------------------- conversion

  private replay(effects: readonly Effect[]): void {
    for (const e of effects) this.live.set(e.name, e.value)
  }

  /** AbstractBlock#convert: the attribute entries of the block take effect, then the block is converted. */
  convert(b: Blk): string {
    this.replay(b.effects)
    if (this.depth > 300) return ''
    this.depth++
    try {
      const html = this.convertBlock(b)
      if (this.recorded) this.recorded.set(b, html)
      return html
    } finally {
      this.depth--
    }
  }

  /** When set, the HTML of every block is kept (for the tools that compare blocks). */
  recorded: Map<Blk, string> | null = null

  content(b: Blk): string {
    return b.blocks.map((c) => this.convert(c)).join('\n')
  }

  /** Block#content of a block whose content is text. */
  text(b: Blk): string {
    const lines = b.lines
    if (
      b.ctx === 'listing' ||
      b.ctx === 'literal' ||
      b.ctx === 'pass' ||
      b.ctx === 'stem' ||
      b.ctx === 'verse'
    ) {
      const result = substitute(lines.join('\n'), null, b.subs, this.env(b)).split('\n')
      if (result.length < 2) return result[0] ?? ''
      let a = 0
      let z = result.length
      while (a < z && /^[\0\t\n\v\f\r ]*$/.test(result[a]!)) a++
      while (z > a && /^[\0\t\n\v\f\r ]*$/.test(result[z - 1]!)) z--
      return result.slice(a, z).join('\n')
    }
    return substitute(lines.join('\n'), null, b.subs, this.env(b))
  }

  private idAttr(b: Blk): string {
    return b.id !== null ? ` id="${b.id}"` : ''
  }

  private convertBlock(b: Blk): string {
    switch (b.ctx) {
      case 'section':
        return this.section(b)
      case 'paragraph':
        return this.paragraph(b)
      case 'preamble':
        return this.preamble(b)
      case 'admonition':
        return this.admonition(b)
      case 'listing':
        return this.listing(b)
      case 'literal':
        return this.literal(b)
      case 'example':
        return this.example(b)
      case 'sidebar':
        return this.sidebar(b)
      case 'quote':
        return this.quote(b)
      case 'verse':
        return this.verse(b)
      case 'open':
        return this.open(b)
      case 'pass':
        return this.text(b)
      case 'stem':
        return this.stem(b)
      case 'image':
        return this.image(b)
      case 'video':
        return this.video(b)
      case 'audio':
        return this.audio(b)
      case 'toc':
        return this.toc(b)
      case 'thematic_break':
        return '<hr>'
      case 'page_break':
        return '<div style="page-break-after: always;"></div>'
      case 'floating_title':
        return this.floatingTitle(b)
      case 'ulist':
        return this.ulist(b)
      case 'olist':
        return this.olist(b)
      case 'dlist':
        return this.dlist(b)
      case 'colist':
        return this.colist(b)
      case 'table':
        return this.table(b)
      default:
        return ''
    }
  }

  // ---------------------------------------------------------------- the document

  /** Converter#convert_embedded. */
  document(): string {
    const m = this.model
    const root = m.root
    const result: string[] = []
    const h = m.header
    if (m.doctype === 'manpage') {
      // QUESTION should notitle control the manual page title?
      if (this.live.get('notitle') === undefined && h) {
        const idAttr = h.id !== null ? ` id="${h.id}"` : ''
        result.push(`<h1${idAttr}>${this.docTitle()} Manual Page</h1>`)
      }
      if (this.live.get('manpurpose') !== undefined) result.push(this.mannameSection())
    } else if (h && this.live.get('notitle') === undefined) {
      const idAttr = h.id !== null ? ` id="${h.id}"` : ''
      result.push(`<h1${idAttr}>${this.docTitle()}</h1>`)
    }
    const tocPlacement = this.live.get('toc-placement')
    if (
      this.hasSections(root) &&
      this.live.get('toc') !== undefined &&
      tocPlacement !== 'macro' &&
      tocPlacement !== 'preamble'
    ) {
      result.push(`<div id="toc" class="toc">
<div id="toctitle">${this.live.get('toc-title') ?? ''}</div>
${this.outline(root)}
</div>`)
    }
    result.push(this.content(root))
    if (this.footnotes.length > 0 && this.live.get('nofootnotes') === undefined) {
      result.push(`<div id="footnotes">
<hr>`)
      for (const f of this.footnotes)
        result.push(`<div class="footnote" id="_footnotedef_${f.index}">
<a href="#_footnoteref_${f.index}">${f.index}</a>. ${f.text}
</div>`)
      result.push('</div>')
    }
    return result.join('\n')
  }

  /** Html5Converter#generate_manname_section. */
  private mannameSection(): string {
    let title = this.live.get('manname-title') ?? 'Name'
    const first = this.model.root.sections[0]
    if (first) {
      const t = this.title(first) ?? ''
      if (t === t.toUpperCase()) title = title.toUpperCase()
    }
    const id = this.live.get('manname-id')
    return `<h2${id !== undefined ? ` id="${id}"` : ''}>${title}</h2>
<div class="sectionbody">
<p>${this.model.mannames.join(', ')} - ${this.live.get('manpurpose')}</p>
</div>`
  }

  hasSections(b: Blk): boolean {
    return b.nextSectionIndex > 0
  }

  private outline(node: Blk, opts: { toclevels?: number; sectnumlevels?: number } = {}): string {
    if (!this.hasSections(node)) return ''
    const sectnumlevels = opts.sectnumlevels ?? (rubyToI(this.live.get('sectnumlevels') ?? '3') || 0)
    const toclevels = opts.toclevels ?? (rubyToI(this.live.get('toclevels') ?? '2') || 0)
    const sections = node.sections
    const out = [`<ul class="sectlevel${sections[0]!.level}">`]
    for (const section of sections) {
      const slevel = section.level
      let stitle: string
      if (section.caption !== null) stitle = `${section.caption}${this.title(section) ?? ''}`
      else if (section.numbered && slevel <= sectnumlevels) {
        if (slevel < 2 && this.model.doctype === 'book') {
          switch (section.sectname) {
            case 'chapter': {
              const sig = this.live.get('chapter-signifier')
              stitle = `${sig !== undefined ? `${sig} ` : ''}${this.sectnum(section)} ${this.title(section)}`
              break
            }
            case 'part': {
              const sig = this.live.get('part-signifier')
              stitle = `${sig !== undefined ? `${sig} ` : ''}${this.sectnum(section, undefined, ':')} ${this.title(section)}`
              break
            }
            default:
              stitle = `${this.sectnum(section)} ${this.title(section)}`
          }
        } else stitle = `${this.sectnum(section)} ${this.title(section)}`
      } else stitle = this.title(section) ?? ''
      if (stitle.includes('<a')) stitle = stitle.replace(DropAnchorRx, '')
      const child = slevel < toclevels ? this.outline(section, { toclevels, sectnumlevels }) : ''
      if (child !== '') {
        out.push(`<li><a href="#${section.id ?? ''}">${stitle}</a>`, child, '</li>')
      } else out.push(`<li><a href="#${section.id ?? ''}">${stitle}</a></li>`)
    }
    out.push('</ul>')
    return out.join('\n')
  }

  // ---------------------------------------------------------------- sections

  private section(node: Blk): string {
    const level = node.level
    let title: string
    const numlevels = rubyToI(this.live.get('sectnumlevels') ?? '3') || 0
    if (node.caption !== null) title = this.captionedTitle(node)
    else if (node.numbered && level <= numlevels) {
      if (level < 2 && this.model.doctype === 'book') {
        switch (node.sectname) {
          case 'chapter': {
            const sig = this.live.get('chapter-signifier')
            title = `${sig !== undefined ? `${sig} ` : ''}${this.sectnum(node)} ${this.title(node)}`
            break
          }
          case 'part': {
            const sig = this.live.get('part-signifier')
            title = `${sig !== undefined ? `${sig} ` : ''}${this.sectnum(node, undefined, ':')} ${this.title(node)}`
            break
          }
          default:
            title = `${this.sectnum(node)} ${this.title(node)}`
        }
      } else title = `${this.sectnum(node)} ${this.title(node)}`
    } else title = this.title(node) ?? ''
    let idAttr = ''
    if (node.id !== null) {
      const id = node.id
      idAttr = ` id="${id}"`
      if (this.live.get('sectlinks') !== undefined) {
        const m = title.startsWith('<a ') ? LeadingAnchorsRx.exec(title) : null
        if (m) title = `${m[0]}<a class="link" href="#${id}">${title.slice(m[0].length)}</a>`
        else title = `<a class="link" href="#${id}">${title}</a>`
      }
      const anchors = this.live.get('sectanchors')
      if (anchors !== undefined) {
        if (anchors === 'after') title = `${title}<a class="anchor" href="#${id}"></a>`
        else title = `<a class="anchor" href="#${id}"></a>${title}`
      }
    }
    const role = node.role
    if (level === 0)
      return `<h1${idAttr} class="sect0${role ? ` ${role}` : ''}">${title}</h1>\n${this.content(node)}`
    return `<div class="sect${level}${role ? ` ${role}` : ''}">
<h${level + 1}${idAttr}>${title}</h${level + 1}>
${level === 1 ? `<div class="sectionbody">\n${this.content(node)}\n</div>` : this.content(node)}
</div>`
  }

  private preamble(node: Blk): string {
    let toc = ''
    if (
      this.live.get('toc-placement') === 'preamble' &&
      this.hasSections(this.model.root) &&
      this.live.get('toc') !== undefined
    )
      toc = `
<div id="toc" class="${this.live.get('toc-class') ?? 'toc'}">
<div id="toctitle">${this.live.get('toc-title') ?? ''}</div>
${this.outline(this.model.root)}
</div>`
    return `<div id="preamble">
<div class="sectionbody">
${this.content(node)}
</div>${toc}
</div>`
  }

  // ---------------------------------------------------------------- blocks

  private paragraph(node: Blk): string {
    const id = node.id
    const role = node.role
    let attributes: string
    if (role) attributes = `${id !== null ? ` id="${id}"` : ''} class="paragraph ${role}"`
    else if (id !== null) attributes = ` id="${id}" class="paragraph"`
    else attributes = ' class="paragraph"'
    if (node.title !== null)
      return `<div${attributes}>
<div class="title">${this.title(node)}</div>
<p>${this.text(node)}</p>
</div>`
    return `<div${attributes}>
<p>${this.text(node)}</p>
</div>`
  }

  private admonition(node: Blk): string {
    const name = node.attrs.get('name') ?? ''
    const titleEl = node.title !== null ? `<div class="title">${this.title(node)}</div>\n` : ''
    const icons = this.live.get('icons')
    const textlabel = node.attrs.get('textlabel') ?? ''
    let label: string
    if (icons !== undefined) {
      if (icons === 'font' && !node.attrs.has('icon'))
        label = `<i class="fa icon-${name}" title="${textlabel}"></i>`
      else label = `<img src="${this.iconUri(name)}" alt="${textlabel}">`
    } else label = `<div class="title">${textlabel}</div>`
    const role = node.role
    const content = node.blocks.length > 0 || node.lines.length === 0 ? this.content(node) : this.text(node)
    return `<div${this.idAttr(node)} class="admonitionblock ${name}${role ? ` ${role}` : ''}">
<table>
<tr>
<td class="icon">
${label}
</td>
<td class="content">
${titleEl}${content}
</td>
</tr>
</table>
</div>`
  }

  private compoundOrText(node: Blk): string {
    return node.blocks.length > 0 || node.lines.length === 0 ? this.content(node) : this.text(node)
  }

  private example(node: Blk): string {
    const idAttribute = this.idAttr(node)
    const role = node.role
    if (node.option('collapsible')) {
      const classAttribute = role ? ` class="${role}"` : ''
      const summary =
        node.title !== null
          ? `<summary class="title">${this.title(node)}</summary>`
          : '<summary class="title">Details</summary>'
      return `<details${idAttribute}${classAttribute}${node.option('open') ? ' open' : ''}>
${summary}
<div class="content">
${this.compoundOrText(node)}
</div>
</details>`
    }
    const titleEl = node.title !== null ? `<div class="title">${this.captionedTitle(node)}</div>\n` : ''
    return `<div${idAttribute} class="exampleblock${role ? ` ${role}` : ''}">
${titleEl}<div class="content">
${this.compoundOrText(node)}
</div>
</div>`
  }

  private floatingTitle(node: Blk): string {
    const tag = `h${node.level + 1}`
    const classes = [node.style, node.role].filter((c): c is string => !!c)
    return `<${tag}${this.idAttr(node)} class="${classes.join(' ')}">${this.title(node)}</${tag}>`
  }

  private image(node: Blk): string {
    const target = node.attrs.get('target') ?? ''
    const a = (k: string) => node.attrs.get(k)
    const widthAttr = node.hasAttr('width') ? ` width="${a('width')}"` : ''
    const heightAttr = node.hasAttr('height') ? ` height="${a('height')}"` : ''
    const alt = a('alt') ?? ''
    let img = `<img src="${this.webPath(target, node.attrs.get('imagesdir') ?? undefined)}" alt="${alt.includes('"') ? alt.replaceAll('"', '&quot;') : alt}"${widthAttr}${heightAttr}>`
    if (node.hasAttr('link'))
      img = `<a class="image" href="${a('link')}"${this.linkConstraints(node)}>${img}</a>`
    const classes = ['imageblock']
    if (node.hasAttr('float')) classes.push(a('float')!)
    if (node.hasAttr('align')) classes.push(`text-${a('align')}`)
    if (node.role) classes.push(node.role)
    const titleEl = node.title !== null ? `\n<div class="title">${this.captionedTitle(node)}</div>` : ''
    return `<div${this.idAttr(node)} class="${classes.join(' ')}">
<div class="content">
${img}
</div>${titleEl}
</div>`
  }

  private linkConstraints(node: Blk): string {
    const out: string[] = []
    const nofollow = node.option('nofollow')
    const window = node.attrs.get('window')
    if (window !== undefined && window !== null) {
      out.push(` target="${window}"`)
      if (window === '_blank' || node.option('noopener'))
        out.push(nofollow ? ' rel="nofollow noopener"' : ' rel="noopener"')
    } else if (nofollow) out.push(' rel="nofollow"')
    return out.join('')
  }

  private listing(node: Blk): string {
    const nowrap = node.option('nowrap') || this.live.get('prewrap') === undefined
    let open: string
    let close: string
    if (node.style === 'source') {
      const lang = node.attrs.get('language') ?? null
      open = `<pre class="highlight${nowrap ? ' nowrap' : ''}"><code${lang !== null ? ` class="language-${lang}" data-lang="${lang}"` : ''}>`
      close = '</code></pre>'
    } else {
      open = `<pre${nowrap ? ' class="nowrap"' : ''}>`
      close = '</pre>'
    }
    const titleEl = node.title !== null ? `<div class="title">${this.captionedTitle(node)}</div>\n` : ''
    const role = node.role
    return `<div${this.idAttr(node)} class="listingblock${role ? ` ${role}` : ''}">
${titleEl}<div class="content">
${open}${this.text(node)}${close}
</div>
</div>`
  }

  private literal(node: Blk): string {
    const titleEl = node.title !== null ? `<div class="title">${this.title(node)}</div>\n` : ''
    const nowrap = this.live.get('prewrap') === undefined || node.option('nowrap')
    const role = node.role
    return `<div${this.idAttr(node)} class="literalblock${role ? ` ${role}` : ''}">
${titleEl}<div class="content">
<pre${nowrap ? ' class="nowrap"' : ''}>${this.text(node)}</pre>
</div>
</div>`
  }

  private stem(node: Blk): string {
    const titleEl = node.title !== null ? `<div class="title">${this.title(node)}</div>\n` : ''
    const style = node.style ?? 'asciimath'
    const [open, close] = BLOCK_MATH[style] ?? BLOCK_MATH.asciimath!
    let equation = this.text(node)
    if (style === 'asciimath' && equation.includes('\n')) {
      const br = '\n<br>'
      equation = equation.replace(
        StemBreakRx,
        (m) => `${close}${br.repeat(m.split('\n').length - 2)}\n${open}`,
      )
    }
    if (!(equation.startsWith(open) && equation.endsWith(close))) equation = `${open}${equation}${close}`
    const role = node.role
    return `<div${this.idAttr(node)} class="stemblock${role ? ` ${role}` : ''}">
${titleEl}<div class="content">
${equation}
</div>
</div>`
  }

  private open(node: Blk): string {
    const style = node.style
    const role = node.role
    if (style === 'abstract') {
      if (node.parent === this.model.root && this.model.doctype === 'book') return ''
      const titleEl = node.title !== null ? `<div class="title">${this.title(node)}</div>\n` : ''
      return `<div${this.idAttr(node)} class="quoteblock abstract${role ? ` ${role}` : ''}">
${titleEl}<blockquote>
${this.compoundOrText(node)}
</blockquote>
</div>`
    }
    if (
      style === 'partintro' &&
      (node.level > 0 || node.parent?.ctx !== 'section' || this.model.doctype !== 'book')
    )
      return ''
    const titleEl = node.title !== null ? `<div class="title">${this.title(node)}</div>\n` : ''
    return `<div${this.idAttr(node)} class="openblock${style && style !== 'open' ? ` ${style}` : ''}${role ? ` ${role}` : ''}">
${titleEl}<div class="content">
${this.compoundOrText(node)}
</div>
</div>`
  }

  private attribution(node: Blk): string {
    const attribution = node.hasAttr('attribution') ? node.attrs.get('attribution')! : null
    const citetitle = node.hasAttr('citetitle') ? node.attrs.get('citetitle')! : null
    if (attribution === null && citetitle === null) return ''
    const cite = citetitle !== null ? `<cite>${citetitle}</cite>` : ''
    const text = attribution !== null ? `&#8212; ${attribution}${citetitle !== null ? '<br>\n' : ''}` : ''
    return `\n<div class="attribution">\n${text}${cite}\n</div>`
  }

  private quote(node: Blk): string {
    const role = node.role
    const titleEl = node.title !== null ? `\n<div class="title">${this.title(node)}</div>` : ''
    return `<div${this.idAttr(node)} class="quoteblock${role ? ` ${role}` : ''}">${titleEl}
<blockquote>
${this.compoundOrText(node)}
</blockquote>${this.attribution(node)}
</div>`
  }

  private verse(node: Blk): string {
    const role = node.role
    const titleEl = node.title !== null ? `\n<div class="title">${this.title(node)}</div>` : ''
    return `<div${this.idAttr(node)} class="verseblock${role ? ` ${role}` : ''}">${titleEl}
<pre class="content">${this.text(node)}</pre>${this.attribution(node)}
</div>`
  }

  private sidebar(node: Blk): string {
    const titleEl = node.title !== null ? `<div class="title">${this.title(node)}</div>\n` : ''
    const role = node.role
    return `<div${this.idAttr(node)} class="sidebarblock${role ? ` ${role}` : ''}">
<div class="content">
${titleEl}${this.compoundOrText(node)}
</div>
</div>`
  }

  /** `Node#attr(name, default, fallback)`: the attribute of the block, else the document attribute `fallback`, else the default. */
  private attrOr(node: Blk, name: string, fallback: string | null, dflt: string | null): string | null {
    const own = node.attrs.get(name)
    if (own !== undefined && own !== null) return own
    const doc = fallback === null ? undefined : this.live.get(fallback)
    return doc ?? dflt
  }

  /** Html5Converter#convert_table. */
  private table(node: Blk): string {
    const t = node.table
    if (!t) return ''
    const m = t.model
    const idAttribute = node.id !== null ? ` id="${node.id}"` : ''
    let frame = this.attrOr(node, 'frame', 'table-frame', 'all')
    if (frame === 'topbot') frame = 'ends'
    const classes = ['tableblock', `frame-${frame}`, `grid-${this.attrOr(node, 'grid', 'table-grid', 'all')}`]
    const stripes = this.attrOr(node, 'stripes', 'table-stripes', null)
    if (stripes !== null) classes.push(`stripes-${stripes}`)
    let styleAttribute = ''
    const autowidth = node.attrs.has('autowidth-option')
    if (autowidth && !node.attrs.has('width')) classes.push('fit-content')
    else if (m.width === 100) classes.push('stretch')
    else styleAttribute = ` style="width: ${m.width}%;"`
    const float = node.attrs.get('float')
    if (float !== undefined && float !== null) classes.push(float)
    if (node.role) classes.push(node.role)
    const result = [`<table${idAttribute} class="${classes.join(' ')}"${styleAttribute}>`]
    if (node.title !== null) result.push(`<caption class="title">${this.captionedTitle(node)}</caption>`)
    const sections = [
      ['head', m.rows.head],
      ['body', m.rows.body],
      ['foot', m.rows.foot],
    ] as const
    if (sections.some(([, rows]) => rows.length > 0)) {
      result.push('<colgroup>')
      if (autowidth) for (let i = 0; i < m.columns.length; i++) result.push('<col>')
      else
        for (const col of m.columns)
          result.push(col.autowidth ? '<col>' : `<col style="width: ${col.width}%;">`)
      result.push('</colgroup>')
      const bg = this.live.get('cellbgcolor')
      const cellStyle = bg !== undefined ? ` style="background-color: ${bg};"` : ''
      for (const [tsec, rows] of sections) {
        if (rows.length === 0) continue
        result.push(`<t${tsec}>`)
        for (const row of rows) {
          result.push('<tr>')
          for (const whole of row.cells) {
            // the fill label is the fill of the cell: its role goes on the cell, not on an empty span
            const fill = whole.fill
            const cell = fill ? { ...whole, text: whole.text.slice(fill.to - fill.from) } : whole
            let content: string
            if (tsec === 'head') content = this.cellText(cell)
            else if (cell.style === 'asciidoc') {
              content = this.cellDocument(node, whole)
              if (fill) content = content.replace(`<span class="${fill.role}"></span>`, '')
              // (a cell with the label alone is an empty cell)
              content = fill && content === '<div class="paragraph">\n<p></p>\n</div>' ? '' : `<div class="content">${content}</div>`
            } else if (cell.style === 'literal')
              content = `<div class="literal"><pre>${this.cellText(cell)}</pre></div>`
            else {
              const paragraphs = this.cellParagraphs(cell)
              content =
                paragraphs.length === 0
                  ? ''
                  : `<p class="tableblock">${paragraphs.join('</p>\n<p class="tableblock">')}</p>`
            }
            const tag = tsec === 'head' || cell.style === 'header' ? 'th' : 'td'
            const colspan = cell.colspan !== 1 ? ` colspan="${cell.colspan}"` : ''
            const rowspan = cell.rowspan !== 1 ? ` rowspan="${cell.rowspan}"` : ''
            result.push(
              `<${tag} class="tableblock halign-${cell.halign} valign-${cell.valign}${fill ? ` ${fill.role}` : ''}"${colspan}${rowspan}${cellStyle}>${content}</${tag}>`,
            )
          }
          result.push('</tr>')
        }
        result.push(`</t${tsec}>`)
      }
    }
    result.push('</table>')
    return result.join('\n')
  }

  /** `Table::Cell#text`: the text of the cell with the substitutions of its style. */
  private cellText(cell: TableCellModel): string {
    return substitute(cell.text, null, cell.style === 'literal' ? BASIC_SUBS : NORMAL_SUBS, this.env(null))
  }

  /** `Table::Cell#content` of a cell that has no document: the paragraphs of the text, with the style of the cell. */
  private cellParagraphs(cell: TableCellModel): string[] {
    const style = cell.style
    const quoted = (text: string): string => {
      if (style === null || style === 'header') return text
      const tags = QUOTE_TAGS[style]
      return tags ? `${tags[0]}${text}${tags[1]}` : text
    }
    const text = this.cellText(cell)
    if (cell.text.includes('\n\n')) return text.split(/\n{2,}/).map(quoted)
    return text === '' ? [] : [quoted(text)]
  }

  /** `Table::Cell#content` of a cell with the `a` style: its document, converted where the table is. */
  private cellDocument(node: Blk, cell: TableCellModel): string {
    const inner = node.table?.inner.get(cell)
    return inner ? new Converter(inner, this).document() : ''
  }

  private toc(node: Blk): string {
    const root = this.model.root
    if (!(
      this.live.get('toc-placement') === 'macro' &&
      this.hasSections(root) &&
      this.live.get('toc') !== undefined
    ))
      return '<!-- toc disabled -->'
    let idAttr: string
    let titleIdAttr: string
    if (node.id !== null) {
      idAttr = ` id="${node.id}"`
      titleIdAttr = ` id="${node.id}title"`
    } else {
      idAttr = ' id="toc"'
      titleIdAttr = ' id="toctitle"'
    }
    const title = node.title !== null ? this.title(node) : (this.live.get('toc-title') ?? '')
    const levelsAttr = node.attrs.get('levels')
    const levels = levelsAttr !== undefined && levelsAttr !== null ? rubyToI(levelsAttr) : undefined
    const role = node.role !== null ? node.role : (this.live.get('toc-class') ?? 'toc')
    return `<div${idAttr} class="${role}">
<div${titleIdAttr} class="title">${title}</div>
${this.outline(root, { toclevels: levels })}
</div>`
  }

  // ---------------------------------------------------------------- lists

  private itemText(item: Blk): string {
    return item.text === null ? '' : this.sub(item.text, item)
  }

  private itemHasText(item: Blk): boolean {
    if (item.text === null) return false
    return 'str' in item.text ? item.text.str !== '' : item.text.lines.join('\n') !== ''
  }

  private itemContent(item: Blk): string {
    return item.blocks.map((c) => this.convert(c)).join('\n')
  }

  private listItemOpen(item: Blk): string {
    if (item.id !== null) return `<li id="${item.id}"${item.role ? ` class="${item.role}"` : ''}>`
    if (item.role) return `<li class="${item.role}">`
    return '<li>'
  }

  private ulist(node: Blk): string {
    const result: string[] = []
    const classes = ['ulist', node.style, node.role].filter((c): c is string => !!c)
    let markerChecked = ''
    let markerUnchecked = ''
    const checklist = node.option('checklist')
    let ulClass: string
    if (checklist) {
      classes.splice(1, 0, 'checklist')
      // div_classes.unshift div_classes.shift, 'checklist': the first class stays first, `checklist` follows it
      ulClass = ' class="checklist"'
      if (node.option('interactive')) {
        markerChecked = '<input type="checkbox" data-item-complete="1" checked> '
        markerUnchecked = '<input type="checkbox" data-item-complete="0"> '
      } else if (this.live.get('icons') === 'font') {
        markerChecked = '<i class="fa fa-check-square-o"></i> '
        markerUnchecked = '<i class="fa fa-square-o"></i> '
      } else {
        markerChecked = '&#10003; '
        markerUnchecked = '&#10063; '
      }
    } else ulClass = node.style ? ` class="${node.style}"` : ''
    result.push(`<div${this.idAttr(node)} class="${classes.join(' ')}">`)
    if (node.title !== null) result.push(`<div class="title">${this.title(node)}</div>`)
    result.push(`<ul${ulClass}>`)
    for (const item of node.items) {
      this.replay(item.effects)
      result.push(this.listItemOpen(item))
      if (checklist && item.hasAttr('checkbox'))
        result.push(
          `<p>${item.hasAttr('checked') ? markerChecked : markerUnchecked}${this.itemText(item)}</p>`,
        )
      else result.push(`<p>${this.itemText(item)}</p>`)
      if (item.blocks.length) result.push(this.itemContent(item))
      result.push('</li>')
    }
    result.push('</ul>', '</div>')
    return result.join('\n')
  }

  private olist(node: Blk): string {
    const result: string[] = []
    const style = node.style
    const classes = ['olist', style, node.role].filter((c): c is string => !!c)
    result.push(`<div${this.idAttr(node)} class="${classes.join(' ')}">`)
    if (node.title !== null) result.push(`<div class="title">${this.title(node)}</div>`)
    const keyword = style && !node.hasAttr('__implicit') ? ORDERED_LIST_KEYWORDS[style] : undefined
    const typeAttribute = keyword ? ` type="${keyword}"` : ''
    const startAttribute = node.hasAttr('start') ? ` start="${node.attrs.get('start')}"` : ''
    const reversed = node.option('reversed') ? ' reversed' : ''
    result.push(`<ol class="${style}"${typeAttribute}${startAttribute}${reversed}>`)
    for (const item of node.items) {
      this.replay(item.effects)
      result.push(this.listItemOpen(item))
      result.push(`<p>${this.itemText(item)}</p>`)
      if (item.blocks.length) result.push(this.itemContent(item))
      result.push('</li>')
    }
    result.push('</ol>', '</div>')
    return result.join('\n')
  }

  private dlist(node: Blk): string {
    const result: string[] = []
    const style = node.style
    let classes: (string | null)[]
    if (style === 'qanda') classes = ['qlist', 'qanda', node.role]
    else if (style === 'horizontal') classes = ['hdlist', node.role]
    else classes = ['dlist', style, node.role]
    result.push(`<div${this.idAttr(node)} class="${classes.filter(Boolean).join(' ')}">`)
    if (node.title !== null) result.push(`<div class="title">${this.title(node)}</div>`)
    const pair = (item: Blk) => ({ terms: item.terms, dd: item.desc ? item : null })
    if (style === 'qanda') {
      result.push('<ol>')
      for (const item of node.items) {
        const { terms, dd } = pair(item)
        this.replay(item.effects)
        result.push('<li>')
        for (const dt of terms) result.push(`<p><em>${this.itemText(dt)}</em></p>`)
        if (dd) {
          if (this.itemHasText(dd)) result.push(`<p>${this.itemText(dd)}</p>`)
          if (dd.blocks.length) result.push(this.itemContent(dd))
        }
        result.push('</li>')
      }
      result.push('</ol>')
    } else if (style === 'horizontal') {
      result.push('<table>')
      if (node.hasAttr('labelwidth') || node.hasAttr('itemwidth')) {
        result.push('<colgroup>')
        const lw = node.attrs.get('labelwidth')
        result.push(`<col${lw ? ` style="width: ${lw.replace(/%$/, '')}%;"` : ''}>`)
        const iw = node.attrs.get('itemwidth')
        result.push(`<col${iw ? ` style="width: ${iw.replace(/%$/, '')}%;"` : ''}>`)
        result.push('</colgroup>')
      }
      for (const item of node.items) {
        const { terms, dd } = pair(item)
        this.replay(item.effects)
        result.push('<tr>')
        result.push(`<td class="hdlist1${node.option('strong') ? ' strong' : ''}">`)
        let firstTerm = true
        for (const dt of terms) {
          if (!firstTerm) result.push('<br>')
          result.push(this.itemText(dt))
          firstTerm = false
        }
        result.push('</td>')
        result.push('<td class="hdlist2">')
        if (dd) {
          if (this.itemHasText(dd)) result.push(`<p>${this.itemText(dd)}</p>`)
          if (dd.blocks.length) result.push(this.itemContent(dd))
        }
        result.push('</td>')
        result.push('</tr>')
      }
      result.push('</table>')
    } else {
      result.push('<dl>')
      const dtStyle = style ? '' : ' class="hdlist1"'
      for (const item of node.items) {
        const { terms, dd } = pair(item)
        this.replay(item.effects)
        for (const dt of terms) result.push(`<dt${dtStyle}>${this.itemText(dt)}</dt>`)
        if (!dd) continue
        result.push('<dd>')
        if (this.itemHasText(dd)) result.push(`<p>${this.itemText(dd)}</p>`)
        if (dd.blocks.length) result.push(this.itemContent(dd))
        result.push('</dd>')
      }
      result.push('</dl>')
    }
    result.push('</div>')
    return result.join('\n')
  }

  private colist(node: Blk): string {
    const result: string[] = []
    const classes = ['colist', node.style, node.role].filter((c): c is string => !!c)
    result.push(`<div${this.idAttr(node)} class="${classes.join(' ')}">`)
    if (node.title !== null) result.push(`<div class="title">${this.title(node)}</div>`)
    const icons = this.live.get('icons')
    if (icons !== undefined) {
      result.push('<table>')
      let num = 0
      for (const item of node.items) {
        num++
        const label =
          icons === 'font'
            ? `<i class="conum" data-value="${num}"></i><b>${num}</b>`
            : `<img src="${this.iconUri(`callouts/${num}`)}" alt="${num}">`
        this.replay(item.effects)
        result.push(`<tr>
<td>${label}</td>
<td>${this.itemText(item)}${item.blocks.length ? `\n${this.itemContent(item)}` : ''}</td>
</tr>`)
      }
      result.push('</table>')
    } else {
      result.push('<ol>')
      for (const item of node.items) {
        this.replay(item.effects)
        result.push(`<li>
<p>${this.itemText(item)}</p>${item.blocks.length ? `\n${this.itemContent(item)}` : ''}
</li>`)
      }
      result.push('</ol>')
    }
    result.push('</div>')
    return result.join('\n')
  }

  // ---------------------------------------------------------------- media

  private video(node: Blk): string {
    const a = (k: string) => node.attrs.get(k) ?? undefined
    const classes = ['videoblock']
    if (node.hasAttr('float')) classes.push(a('float')!)
    if (node.hasAttr('align')) classes.push(`text-${a('align')}`)
    if (node.role) classes.push(node.role)
    const titleEl = node.title !== null ? `\n<div class="title">${this.title(node)}</div>` : ''
    const width = node.hasAttr('width') ? ` width="${a('width')}"` : ''
    const height = node.hasAttr('height') ? ` height="${a('height')}"` : ''
    const scheme = this.live.get('asset-uri-scheme') ?? 'https'
    const prefix = scheme === '' ? '' : `${scheme}:`
    const target = a('target') ?? ''
    const poster = a('poster')
    if (poster === 'vimeo') {
      const delimiter = ['?']
      const slash = target.indexOf('/')
      const t = slash >= 0 ? target.slice(0, slash) : target
      const hash = slash >= 0 ? target.slice(slash + 1) : a('hash')
      const hashParam = hash ? `${delimiter.pop() ?? '&amp;'}h=${hash}` : ''
      const autoplay = node.option('autoplay') ? `${delimiter.pop() ?? '&amp;'}autoplay=1` : ''
      const loop = node.option('loop') ? `${delimiter.pop() ?? '&amp;'}loop=1` : ''
      const muted = node.option('muted') ? `${delimiter.pop() ?? '&amp;'}muted=1` : ''
      const start = node.hasAttr('start') ? `#at=${a('start')}` : ''
      return `<div${this.idAttr(node)} class="${classes.join(' ')}">${titleEl}
<div class="content">
<iframe${width}${height} src="${prefix}//player.vimeo.com/video/${t}${hashParam}${autoplay}${loop}${muted}${start}" frameborder="0"${node.option('nofullscreen') ? '' : ' allowfullscreen'}></iframe>
</div>
</div>`
    }
    if (poster === 'youtube') {
      const rel = node.option('related') ? 1 : 0
      const start = node.hasAttr('start') ? `&amp;start=${a('start')}` : ''
      const end = node.hasAttr('end') ? `&amp;end=${a('end')}` : ''
      const autoplay = node.option('autoplay') ? '&amp;autoplay=1' : ''
      const hasLoop = node.option('loop')
      const loop = hasLoop ? '&amp;loop=1' : ''
      const mute = node.option('muted') ? '&amp;mute=1' : ''
      const controls = node.option('nocontrols') ? '&amp;controls=0' : ''
      let fsParam = ''
      let fsAttr = ''
      if (node.option('nofullscreen')) fsParam = '&amp;fs=0'
      else fsAttr = ' allowfullscreen'
      const modest = node.option('modest') ? '&amp;modestbranding=1' : ''
      const theme = node.hasAttr('theme') ? `&amp;theme=${a('theme')}` : ''
      const hl = node.hasAttr('lang') ? `&amp;hl=${a('lang')}` : ''
      const slash = target.indexOf('/')
      let t = slash >= 0 ? target.slice(0, slash) : target
      let list: string | undefined = slash >= 0 ? target.slice(slash + 1) : undefined
      let listParam: string
      list ??= a('list')
      if (list) listParam = `&amp;list=${list}`
      else {
        const comma = t.indexOf(',')
        let playlist: string | undefined
        if (comma >= 0) {
          playlist = t.slice(comma + 1)
          t = t.slice(0, comma)
        }
        playlist ??= a('playlist')
        if (playlist) listParam = `&amp;playlist=${t},${playlist}`
        else listParam = hasLoop ? `&amp;playlist=${t}` : ''
      }
      return `<div${this.idAttr(node)} class="${classes.join(' ')}">${titleEl}
<div class="content">
<iframe${width}${height} src="${prefix}//www.youtube.com/embed/${t}?rel=${rel}${start}${end}${autoplay}${loop}${mute}${controls}${listParam}${fsParam}${modest}${theme}${hl}" frameborder="0"${fsAttr}></iframe>
</div>
</div>`
    }
    const posterAttr = poster ? ` poster="${this.webPath(poster, this.live.get('imagesdir'))}"` : ''
    const preload = a('preload') ? ` preload="${a('preload')}"` : ''
    const startT = a('start')
    const endT = a('end')
    const timeAnchor = startT || endT ? `#t=${startT ?? ''}${endT ? `,${endT}` : ''}` : ''
    return `<div${this.idAttr(node)} class="${classes.join(' ')}">${titleEl}
<div class="content">
<video src="${this.webPath(target, this.live.get('imagesdir'))}${timeAnchor}"${width}${height}${posterAttr}${node.option('autoplay') ? ' autoplay' : ''}${node.option('muted') ? ' muted' : ''}${node.option('nocontrols') ? '' : ' controls'}${node.option('loop') ? ' loop' : ''}${preload}>
Your browser does not support the video tag.
</video>
</div>
</div>`
  }

  private audio(node: Blk): string {
    const classes = ['audioblock', node.role].filter((c): c is string => !!c)
    const titleEl = node.title !== null ? `<div class="title">${this.title(node)}</div>\n` : ''
    const startT = node.attrs.get('start') ?? undefined
    const endT = node.attrs.get('end') ?? undefined
    const timeAnchor = startT || endT ? `#t=${startT ?? ''}${endT ? `,${endT}` : ''}` : ''
    const target = node.attrs.get('target') ?? ''
    return `<div${this.idAttr(node)} class="${classes.join(' ')}">
${titleEl}<div class="content">
<audio src="${this.webPath(target, this.live.get('imagesdir'))}${timeAnchor}"${node.option('autoplay') ? ' autoplay' : ''}${node.option('nocontrols') ? '' : ' controls'}${node.option('loop') ? ' loop' : ''}>
Your browser does not support the audio tag.
</audio>
</div>
</div>`
  }
}

