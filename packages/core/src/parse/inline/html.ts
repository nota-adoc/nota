/** The HTML of the inline elements, as Asciidoctor's html5 converter writes them (convert_inline_*). */

export type LinkAttrs = Readonly<Record<string, string | undefined>>

/** `append_link_constraint_attrs`: the `target` and `rel` attributes of a link. */
function constraintAttrs(attrs: LinkAttrs, out: string[]): string {
  const nofollow = attrs['nofollow-option'] !== undefined
  const window = attrs.window
  if (window !== undefined) {
    out.push(` target="${window}"`)
    if (window === '_blank' || attrs['noopener-option'] !== undefined)
      out.push(nofollow ? ' rel="nofollow noopener"' : ' rel="noopener"')
  } else if (nofollow) out.push(' rel="nofollow"')
  return out.join('')
}

/** A link: `<a href="target">text</a>`. */
export function linkHtml(target: string, text: string, id: string | undefined, attrs: LinkAttrs): string {
  const parts: string[] = []
  if (id !== undefined) parts.push(` id="${id}"`)
  if (attrs.role !== undefined) parts.push(` class="${attrs.role}"`)
  if (attrs.title !== undefined) parts.push(` title="${attrs.title}"`)
  return `<a href="${target}"${constraintAttrs(attrs, parts)}>${text}</a>`
}

/** A cross reference to another document (it has a path): the text is the path if there is none. */
export function xrefPathHtml(target: string, text: string, attrs: LinkAttrs): string {
  const parts: string[] = attrs.role !== undefined ? [` class="${attrs.role}"`] : []
  return `<a href="${target}"${constraintAttrs(attrs, parts)}>${text}</a>`
}

/** A cross reference to an id of the document. */
export function xrefHtml(target: string, text: string, role: string | undefined): string {
  return `<a href="${target}"${role !== undefined ? ` class="${role}"` : ''}>${text}</a>`
}

export const anchorHtml = (id: string): string => `<a id="${id}"></a>`

export const bibrefHtml = (id: string, reftext: string | undefined): string =>
  `<a id="${id}"></a>[${reftext ?? id}]`

export const breakHtml = (text: string): string => `${text}<br>`

export const buttonHtml = (text: string): string => `<b class="button">${text}</b>`

export function calloutHtml(
  text: string,
  guard: string | readonly [string, string] | null,
  icons: string | undefined,
  iconUri: (name: string) => string,
): string {
  if (icons === 'font') return `<i class="conum" data-value="${text}"></i><b>(${text})</b>`
  if (icons !== undefined) return `<img src="${iconUri(`callouts/${text}`)}" alt="${text}">`
  if (Array.isArray(guard)) return `&lt;!--<b class="conum">(${text})</b>--&gt;`
  return `${(guard as string | null) ?? ''}<b class="conum">(${text})</b>`
}

export function footnoteHtml(
  index: number | null,
  type: 'ref' | 'xref' | null,
  id: string | null,
  text: string,
): string {
  if (index !== null) {
    if (type === 'xref')
      return `<sup class="footnoteref">[<a class="footnote" href="#_footnotedef_${index}" title="View footnote.">${index}</a>]</sup>`
    const idAttr = id !== null ? ` id="_footnote_${id}"` : ''
    return `<sup class="footnote"${idAttr}>[<a id="_footnoteref_${index}" class="footnote" href="#_footnotedef_${index}" title="View footnote.">${index}</a>]</sup>`
  }
  if (type === 'xref')
    return `<sup class="footnoteref red" title="Unresolved footnote reference.">[${text}]</sup>`
  return ''
}

export const encodeAttributeValue = (v: string): string => (v.includes('"') ? v.replaceAll('"', '&quot;') : v)

export function imageHtml(
  type: 'image' | 'icon',
  target: string,
  alt: string,
  attrs: LinkAttrs,
  icons: string | undefined,
  imageUri: (target: string) => string,
  iconUri: (target: string) => string,
): string {
  let img: string
  if (type === 'icon') {
    if (icons === 'font') {
      let cls = `fa fa-${target}`
      if (attrs.size !== undefined) cls += ` fa-${attrs.size}`
      if (attrs.flip !== undefined) cls += ` fa-flip-${attrs.flip}`
      else if (attrs.rotate !== undefined) cls += ` fa-rotate-${attrs.rotate}`
      img = `<i class="${cls}"${attrs.title !== undefined ? ` title="${attrs.title}"` : ''}></i>`
    } else if (icons !== undefined) {
      let a = attrs.width !== undefined ? ` width="${attrs.width}"` : ''
      if (attrs.height !== undefined) a += ` height="${attrs.height}"`
      if (attrs.title !== undefined) a += ` title="${attrs.title}"`
      img = `<img src="${iconUri(target)}" alt="${encodeAttributeValue(alt)}"${a}>`
    } else img = `[${alt}&#93;`
  } else {
    let a = attrs.width !== undefined ? ` width="${attrs.width}"` : ''
    if (attrs.height !== undefined) a += ` height="${attrs.height}"`
    if (attrs.title !== undefined) a += ` title="${attrs.title}"`
    // secure mode: svg is an ordinary image
    img = `<img src="${imageUri(target)}" alt="${encodeAttributeValue(alt)}"${a}>`
  }
  if (attrs.link !== undefined)
    img = `<a class="image" href="${attrs.link}"${constraintAttrs(attrs, [])}>${img}</a>`
  let cls: string = type
  if (attrs.role !== undefined)
    cls = attrs.float !== undefined ? `${cls} ${attrs.float} ${attrs.role}` : `${cls} ${attrs.role}`
  else if (attrs.float !== undefined) cls = `${cls} ${attrs.float}`
  return `<span class="${cls}">${img}</span>`
}

export function kbdHtml(keys: readonly string[]): string {
  if (keys.length === 1) return `<kbd>${keys[0]}</kbd>`
  return `<span class="keyseq"><kbd>${keys.join('</kbd>+<kbd>')}</kbd></span>`
}

export function menuHtml(
  menu: string,
  submenus: readonly string[],
  menuitem: string | null,
  icons: string | undefined,
): string {
  const caret =
    icons === 'font'
      ? '&#160;<i class="fa fa-angle-right caret"></i> '
      : '&#160;<b class="caret">&#8250;</b> '
  const joiner = `</b>${caret}<b class="submenu">`
  if (submenus.length === 0) {
    if (menuitem !== null)
      return `<span class="menuseq"><b class="menu">${menu}</b>${caret}<b class="menuitem">${menuitem}</b></span>`
    return `<b class="menuref">${menu}</b>`
  }
  return `<span class="menuseq"><b class="menu">${menu}</b>${caret}<b class="submenu">${submenus.join(joiner)}</b>${caret}<b class="menuitem">${menuitem ?? ''}</b></span>`
}
