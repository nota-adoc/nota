/**
 * Document metadata derived from the header lines: the author line (Parser.process_authors) and the
 * revision line. Used to set the attributes `author`, `authors`, `firstname`, `email`, `revnumber`… the
 * way Asciidoctor does, because conditionals may test them.
 */
import { AuthorInfoLineRx, matchRevisionInfoLine, rstrip } from './rx.js'

export type Meta = Map<string, string | number>

const AUTHOR_KEYS = ['author', 'authorinitials', 'firstname', 'middlename', 'lastname', 'email']

function stripRuby(s: string): string {
  return rstrip(s).replace(/^[\0\t\n\v\f\r ]+/, '')
}

const firstChar = (s: string) => [...s][0] ?? ''

/** Port of Parser.process_authors. */
export function processAuthors(line: string, namesOnly: boolean, multiple: boolean): Meta {
  const meta: Meta = new Map()
  let idx = 0
  let entries = multiple && line.includes(';') ? line.split(/;(?: |$)/) : [line]
  while (entries.length && entries[entries.length - 1] === '') entries = entries.slice(0, -1)
  for (let entry of entries) {
    if (!entry) continue
    idx++
    const key = (k: string) => (idx === 1 ? k : `${k}_${idx}`)
    let segments: (string | undefined)[] | null = null
    if (namesOnly) {
      if (entry.includes('<')) {
        meta.set(key('author'), entry.replace(/_/g, ' '))
        entry = entry.replace(/<[^>]+>/g, '')
      }
      const words = entry.replace(/^[\0\t\n\v\f\r ]+/, '').split(/[\0\t\n\v\f\r ]+/)
      segments = words.length > 3 ? [words[0], words[1], words.slice(2).join(' ')] : words
      if (segments.length === 3) segments[2] = segments[2]!.replace(/ {2,}/g, ' ')
    } else {
      const m = AuthorInfoLineRx.exec(entry)
      if (m) segments = [m[1], m[2], m[3], m[4]]
    }
    if (segments && segments[0] !== undefined) {
      const fname = segments[0].replace(/_/g, ' ')
      meta.set(key('firstname'), fname)
      let author = fname
      meta.set(key('authorinitials'), firstChar(fname))
      if (segments[1] !== undefined && segments[1] !== '') {
        if (segments[2] !== undefined && segments[2] !== '') {
          const mname = segments[1].replace(/_/g, ' ')
          const lname = segments[2].replace(/_/g, ' ')
          meta.set(key('middlename'), mname)
          meta.set(key('lastname'), lname)
          author = `${fname} ${mname} ${lname}`
          meta.set(key('authorinitials'), `${firstChar(fname)}${firstChar(mname)}${firstChar(lname)}`)
        } else {
          const lname = segments[1].replace(/_/g, ' ')
          meta.set(key('lastname'), lname)
          author = `${fname} ${lname}`
          meta.set(key('authorinitials'), `${firstChar(fname)}${firstChar(lname)}`)
        }
      }
      if (!meta.has(key('author'))) meta.set(key('author'), author)
      if (!namesOnly && segments[3] !== undefined) meta.set(key('email'), segments[3])
    } else {
      const name = stripRuby(entry.replace(/ {2,}/g, ' '))
      meta.set(key('author'), name)
      meta.set(key('firstname'), name)
      meta.set(key('authorinitials'), firstChar(name))
    }
    if (idx === 1) {
      meta.set('authors', meta.get(key('author'))!)
    } else {
      if (idx === 2) for (const k of AUTHOR_KEYS) if (meta.has(k)) meta.set(`${k}_1`, meta.get(k)!)
      meta.set('authors', `${meta.get('authors')}, ${meta.get(key('author'))}`)
    }
  }
  meta.set('authorcount', idx)
  return meta
}

/** The revision attributes of a revision line (`v1.0, 2026-09-25: remark`), or null if it is not one. */
export function processRevision(line: string): Map<string, string> | null {
  const m = matchRevisionInfoLine(line)
  if (!m) return null
  const rev = new Map<string, string>()
  if (m.number) rev.set('revnumber', rstrip(line.slice(...m.number)))
  const comp = stripRuby(line.slice(...m.date))
  if (comp) {
    if (!m.number && comp.startsWith('v')) rev.set('revnumber', comp.slice(1))
    else rev.set('revdate', comp)
  }
  if (m.remark) rev.set('revremark', rstrip(line.slice(...m.remark)))
  return rev
}
