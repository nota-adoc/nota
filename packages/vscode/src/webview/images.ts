/**
 * Where the picture of an image of the document is for the tab. The path in the file is from the folder of the file, or from
 * `:imagesdir:` when the document sets one. An address from the network is never loaded: the editor shows a plate for it, and the
 * content security policy of the tab (`img-src` of the webview only) would refuse it anyway.
 */
import type { ImageSource } from '@nota-adoc/prosemirror'

/** An address with a scheme (`https://…`, `data:…`, `file:…`) or one that starts with `//`. */
const REMOTE = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i

/** A `%` with two hexadecimal digits: already written percent-encoding, kept as it is. */
const ENCODED = /(%[0-9A-Fa-f]{2})/

/** A segment of the path as an address: the triples `%XX` stay, the rest (a lone `%` too) is encoded. */
function encodeSegment(segment: string): string {
  return segment
    .split(ENCODED)
    .map((part, i) => (i % 2 === 1 ? part : encodeURIComponent(part)))
    .join('')
}

/**
 * The path is read as an address already written (like Asciidoctor does): `%5BD%5D` is not encoded a second time, while a space,
 * Cyrillic or a `%` that is not followed by two hexadecimal digits is encoded.
 *
 * @param target the path as written in `image::path[]`
 * @param base the address of the folder of the file in the webview, with a slash at the end ('' when the host gave none)
 * @param imagesdir the `:imagesdir:` of the document ('' when it sets none)
 */
export function resolveImage(target: string, base: string, imagesdir: string): ImageSource {
  const path = target.trim()
  if (path === '' || REMOTE.test(path) || REMOTE.test(imagesdir.trim())) return { plate: 'remote' }
  if (base === '' || path.startsWith('/') || path.startsWith('\\')) return { plate: 'missing' }
  const dir = imagesdir.trim().replace(/\\/g, '/')
  const relative = dir === '' ? path : `${dir.replace(/\/+$/, '')}/${path}`
  if (relative.startsWith('/')) return { plate: 'missing' }
  const encoded = relative
    .split('/')
    .map((segment) => (segment === '.' || segment === '..' ? segment : encodeSegment(segment)))
    .join('/')
  try {
    return { url: new URL(encoded, base.endsWith('/') ? base : base + '/').toString() }
  } catch {
    return { plate: 'missing' }
  }
}

/** The segments of a path with `.` and `..` folded away (a `..` that goes above the start stays). */
function fold(path: string): string[] {
  const out: string[] = []
  for (const part of path.replace(/\\/g, '/').split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..' && out.length > 0 && out[out.length - 1] !== '..') out.pop()
    else out.push(part)
  }
  return out
}

/**
 * The path to write in `image::path[]` for a picture the user picked. The list gives it from the folder of the file; with
 * `:imagesdir:` the document reads it from that folder, so it is made relative to it (`img/x.png` with `:imagesdir: img` is `x.png`).
 */
export function pathForDocument(picked: string, imagesdir: string): string {
  const dir = imagesdir.trim()
  if (dir === '' || REMOTE.test(dir) || dir.startsWith('/') || dir.startsWith('\\')) return picked
  const from = fold(dir)
  const to = fold(picked)
  if (from.includes('..')) return picked
  let common = 0
  while (common < from.length && common < to.length - 1 && from[common] === to[common]) common++
  return [...from.slice(common).map(() => '..'), ...to.slice(common)].join('/')
}
