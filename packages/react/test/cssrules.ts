// A small reader of a style sheet for the tests: rules as selectors and declarations, so that a test looks at the values, not at the text
// (a re-format of the CSS does not break it). Comments are dropped; the rules inside an at-rule are read as the rules of their own.
export interface Rule {
  selectors: string[]
  decl: Map<string, string>
}

const norm = (text: string): string => text.replace(/\s+/g, ' ').trim()

export function parseCss(source: string): Rule[] {
  const text = source.replace(/\/\*[\s\S]*?\*\//g, '')
  const rules: Rule[] = []
  let head = ''
  let body = ''
  let depth = 0
  for (const ch of text) {
    if (ch === '{') {
      depth++
      if (depth === 1) {
        body = ''
        continue
      }
    } else if (ch === '}') {
      depth--
      if (depth === 0) {
        if (!head.trim().startsWith('@')) rules.push(read(head, body))
        head = ''
        continue
      }
      if (depth === 1 && head.trim().startsWith('@')) {
        // the end of a rule inside an at-rule
        const inner = body.slice(body.lastIndexOf('{') + 1)
        const sel = body.slice(0, body.lastIndexOf('{')).split('}').pop() ?? ''
        rules.push(read(sel, inner))
        body = ''
        continue
      }
    }
    if (depth === 0) head += ch
    else body += ch
  }
  return rules
}

function read(head: string, body: string): Rule {
  const decl = new Map<string, string>()
  for (const part of body.split(';')) {
    const at = part.indexOf(':')
    if (at < 0) continue
    decl.set(norm(part.slice(0, at)).toLowerCase(), norm(part.slice(at + 1)))
  }
  return { selectors: head.split(',').map(norm).filter(Boolean), decl }
}

/** The declarations of all rules that have exactly this selector in their list, later rules over earlier ones. */
export function styleOf(rules: Rule[], selector: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const rule of rules) if (rule.selectors.includes(selector)) for (const [k, v] of rule.decl) out.set(k, v)
  return out
}
