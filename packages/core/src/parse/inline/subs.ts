/** Substitution groups and the resolution of `subs=` values, ported from Asciidoctor's Substitutors. */

export type Sub =
  'specialcharacters' | 'quotes' | 'attributes' | 'replacements' | 'macros' | 'post_replacements' | 'callouts'

/** The substitutions of a paragraph (`normal`): special characters, quotes, attributes, replacements, macros, post-replacements. */
export const NORMAL_SUBS: readonly Sub[] = [
  'specialcharacters',
  'quotes',
  'attributes',
  'replacements',
  'macros',
  'post_replacements',
]
export const BASIC_SUBS: readonly Sub[] = ['specialcharacters']
export const HEADER_SUBS: readonly Sub[] = ['specialcharacters', 'attributes']
export const NO_SUBS: readonly Sub[] = []
export const REFTEXT_SUBS: readonly Sub[] = ['specialcharacters', 'quotes', 'replacements']
export const VERBATIM_SUBS: readonly Sub[] = ['specialcharacters', 'callouts']

const GROUPS: Readonly<Record<string, readonly Sub[]>> = {
  none: NO_SUBS,
  normal: NORMAL_SUBS,
  verbatim: VERBATIM_SUBS,
  specialchars: BASIC_SUBS,
}

const HINTS: Readonly<Record<string, string>> = {
  a: 'attributes',
  m: 'macros',
  n: 'normal',
  p: 'post_replacements',
  q: 'quotes',
  r: 'replacements',
  c: 'specialcharacters',
  v: 'verbatim',
}

const OPTIONS: Readonly<Record<'block' | 'inline', ReadonlySet<string>>> = {
  block: new Set([...Object.keys(GROUPS), ...NORMAL_SUBS, 'callouts']),
  inline: new Set([...Object.keys(GROUPS), ...NORMAL_SUBS]),
}

/**
 * Substitutors#resolve_subs: the substitutions a comma-separated `subs` value names, starting from `defaults`
 * for the incremental forms (`+quotes`, `-replacements`, `quotes+`). Names it does not know are dropped.
 * Returns null when the value names nothing.
 */
export function resolveSubs(
  value: string,
  type: 'block' | 'inline',
  defaults: readonly Sub[] | null,
): Sub[] | null {
  if (value === '') return null
  let candidates: string[] | null = null
  const subs = value.includes(' ') ? value.replace(/ /g, '') : value
  const modifiersPresent = /[+-]/.test(subs)
  for (let key of subs.split(',')) {
    let op: 'append' | 'remove' | 'prepend' | null = null
    if (modifiersPresent) {
      const first = key.charAt(0)
      if (first === '+') {
        op = 'append'
        key = key.slice(1)
      } else if (first === '-') {
        op = 'remove'
        key = key.slice(1)
      } else if (key.endsWith('+')) {
        op = 'prepend'
        key = key.slice(0, -1)
      }
    }
    let keys: readonly string[]
    if (type === 'inline' && (key === 'verbatim' || key === 'v')) keys = BASIC_SUBS
    else if (Object.hasOwn(GROUPS, key)) keys = GROUPS[key]!
    else if (type === 'inline' && key.length === 1 && Object.hasOwn(HINTS, key)) {
      const resolved = HINTS[key]!
      keys = Object.hasOwn(GROUPS, resolved) ? GROUPS[resolved]! : [resolved]
    } else keys = [key]
    if (op) {
      candidates ??= defaults ? [...defaults] : []
      if (op === 'append') candidates = [...candidates, ...keys]
      else if (op === 'prepend') candidates = [...keys, ...candidates]
      else candidates = candidates.filter((c) => !keys.includes(c))
    } else {
      candidates ??= []
      candidates = [...candidates, ...keys]
    }
  }
  if (!candidates) return null
  const seen = new Set<string>()
  const allowed = OPTIONS[type]
  const out: Sub[] = []
  for (const c of candidates) {
    if (!allowed.has(c) || seen.has(c)) continue
    seen.add(c)
    out.push(c as Sub)
  }
  return out
}

/** The substitutions of a block: `subs=` on top of the defaults of its content model. */
export function blockSubs(defaults: readonly Sub[], custom: string | null | undefined): readonly Sub[] {
  if (custom === null || custom === undefined) return defaults
  return resolveSubs(custom, 'block', defaults) ?? []
}
