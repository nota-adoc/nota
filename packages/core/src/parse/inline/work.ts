/**
 * The working text of the substitutions. Asciidoctor rewrites a string pass by pass; so does Nota, and it
 * keeps for every character of the working text the range of the source it stands for, so that what a pass
 * finds can be reported as a range of the source. A character of the source stands for itself; text a pass
 * generates (a tag, an entity, the value of an attribute) stands for the source it replaced.
 */

/** Ranges of the source, one entry per character of the working text; null when the ranges are not kept. */
export class Work {
  constructor(
    readonly s: string,
    readonly a: Int32Array | null,
    readonly b: Int32Array | null,
  ) {}

  get length(): number {
    return this.s.length
  }

  /** The source range `[from, to)` of the working range `[i, j)`; only when ranges are kept. */
  from(i: number): number {
    return this.a![i]!
  }

  to(j: number): number {
    return this.b![j - 1]!
  }

  slice(i: number, j: number): Work {
    return new Work(this.s.slice(i, j), this.a && this.a.slice(i, j), this.b && this.b.slice(i, j))
  }

  /** The text of the pieces, joined with line feeds, each character standing for itself. */
  static of(text: string, pieces: readonly (readonly [number, number])[] | null, track: boolean): Work {
    if (pieces === null) {
      if (!track) return new Work(text, null, null)
      const a = new Int32Array(text.length)
      const b = new Int32Array(text.length)
      for (let i = 0; i < text.length; i++) {
        a[i] = i
        b[i] = i + 1
      }
      return new Work(text, a, b)
    }
    const parts: string[] = []
    let n = 0
    for (let k = 0; k < pieces.length; k++) {
      const [f, t] = pieces[k]!
      parts.push(text.slice(f, t))
      n += t - f + (k > 0 ? 1 : 0)
    }
    const s = parts.join('\n')
    if (!track) return new Work(s, null, null)
    const a = new Int32Array(n)
    const b = new Int32Array(n)
    let p = 0
    for (let k = 0; k < pieces.length; k++) {
      const [f, t] = pieces[k]!
      if (k > 0) {
        // the line feed between two pieces has no place of its own in the source
        a[p] = b[p] = pieces[k - 1]![1]
        p++
      }
      for (let i = f; i < t; i++) {
        a[p] = i
        b[p] = i + 1
        p++
      }
    }
    return new Work(s, a, b)
  }
}

/** Builds a new working text out of parts of the old one and generated text. */
export class Out {
  private readonly parts: string[] = []
  private readonly a: number[] | null
  private readonly b: number[] | null
  n = 0

  constructor(readonly track: boolean) {
    this.a = track ? [] : null
    this.b = track ? [] : null
  }

  /** The working range `[i, j)` of `w` as it is. */
  copy(w: Work, i: number, j: number): void {
    if (j <= i) return
    this.parts.push(w.s.slice(i, j))
    this.n += j - i
    if (this.a) {
      const wa = w.a!
      const wb = w.b!
      for (let k = i; k < j; k++) {
        this.a.push(wa[k]!)
        this.b!.push(wb[k]!)
      }
    }
  }

  /** Generated text that stands for the source range `[from, to)`. */
  gen(text: string, from: number, to: number): void {
    if (text.length === 0) return
    this.parts.push(text)
    this.n += text.length
    if (this.a) {
      for (let k = 0; k < text.length; k++) {
        this.a.push(from)
        this.b!.push(to)
      }
    }
  }

  /** Appends a whole working text. */
  add(w: Work): void {
    this.copy(w, 0, w.s.length)
  }

  finish(): Work {
    return new Work(
      this.parts.length === 1 ? this.parts[0]! : this.parts.join(''),
      this.a && Int32Array.from(this.a),
      this.b && Int32Array.from(this.b),
    )
  }
}

/** Replaces the matches of a global regular expression; `fn` writes what a match becomes. */
export function gsub(
  w: Work,
  re: RegExp,
  fn: (m: RegExpExecArray, out: Out, w: Work) => void,
  scan: string = w.s,
): Work {
  re.lastIndex = 0
  let m = re.exec(scan)
  if (!m) return w
  const out = new Out(w.a !== null)
  let last = 0
  while (m) {
    out.copy(w, last, m.index)
    // the callback may run the same regular expression again (a passthrough inside a passthrough)
    const resume = re.lastIndex
    fn(m, out, w)
    re.lastIndex = resume
    last = m.index + m[0].length
    if (m[0].length === 0) {
      // an empty match: step over one character
      out.copy(w, last, last + 1)
      last++
      re.lastIndex = last
    }
    m = re.exec(scan)
  }
  out.copy(w, last, w.s.length)
  return out.finish()
}

/** Where the character after `i` is: the first index at or after a position where a test holds, remembered. */
export class Next {
  private from = 0
  private res = -2 // -2: not searched yet, -1: none at or after `from`

  constructor(private readonly find: (from: number) => number) {}

  /** The first index >= `k` found by the search; repeated queries in increasing order cost one scan in all. */
  at(k: number): number {
    if (this.res !== -2 && k >= this.from && (this.res === -1 || this.res >= k)) return this.res
    this.from = k
    this.res = this.find(k)
    return this.res
  }
}

/** The first index >= k of `ch` in `s` for which `ok(index)` holds, or -1. */
export function nextWhere(s: string, ch: string, k: number, ok: (i: number) => boolean): number {
  for (let i = s.indexOf(ch, k); i >= 0; i = s.indexOf(ch, i + 1)) if (ok(i)) return i
  return -1
}

/**
 * The text with the `[` that no `]` follows made into another character: a pattern for `[…]` cannot
 * match at such a `[`, but would scan to the end of the text from each of them to find that out.
 */
export function maskBrackets(s: string): string {
  const lastRB = s.lastIndexOf(']')
  const from = lastRB + 1
  let i = s.indexOf('[', from)
  if (i < 0) return s
  const parts: string[] = [s.slice(0, i)]
  while (i >= 0) {
    parts.push('\uE000')
    const last = i + 1
    i = s.indexOf('[', last)
    if (i >= 0) parts.push(s.slice(last, i))
    else parts.push(s.slice(last))
  }
  return parts.join('')
}

/** A match found by a scanner instead of a regular expression: the same shape as `RegExpExecArray` with indices. */
export type Found = RegExpExecArray

export function found(
  index: number,
  length: number,
  groups: (readonly [number, number] | null)[],
  text: string,
): Found {
  const m = [
    text.slice(index, index + length),
    ...groups.map((g) => (g ? text.slice(g[0], g[1]) : undefined)),
  ] as unknown as Found
  const indices = [
    [index, index + length],
    ...groups.map((g) => g ?? undefined),
  ] as unknown as RegExpIndicesArray
  m.index = index
  m.indices = indices
  return m
}

/** Like `gsub` for the matches a scanner found. */
export function gsubFound(
  w: Work,
  matches: readonly Found[],
  fn: (m: Found, out: Out, w: Work) => void,
): Work {
  if (matches.length === 0) return w
  const out = new Out(w.a !== null)
  let last = 0
  for (const m of matches) {
    out.copy(w, last, m.index)
    fn(m, out, w)
    last = m.index + m[0].length
  }
  out.copy(w, last, w.s.length)
  return out.finish()
}
