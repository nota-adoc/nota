// the address of an anchor in the editor: only http, https, mailto, a relative path and `#anchor` reach `href`.
import { describe, expect, it } from 'vitest'
import { schema } from '@nota-adoc/prosemirror'

const attrsOf = (href: string): Record<string, string> => {
  const spec = schema.marks.link!.spec.toDOM!(schema.marks.link!.create({ href }), true) as [string, Record<string, string>, number]
  return spec[1]
}

describe('href of a link', () => {
  it.each([
    'https://example.com/a?b=1',
    'HTTP://example.com',
    'mailto:a@example.com',
    'page.adoc',
    '../dir/page.adoc#part',
    '#anchor',
    '//example.com/x',
    'a.adoc#x:y',
    '',
  ])('keeps %j', (href) => {
    expect(attrsOf(href)).toEqual({ href })
  })

  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    '  javascript:alert(1)',
    '\tjavascript:alert(1)',
    'java\tscript:alert(1)',
    'java\nscript:alert(1)',
    '\u0001javascript:alert(1)',
    'jav\u0000ascript:alert(1)',
    '​javascript:alert(1)',
    'data:text/html,<script>1</script>',
    'DATA:text/html;base64,AAAA',
    ' \r\n data:text/html,x',
    'vbscript:msgbox(1)',
    'VBScript:msgbox(1)',
    'vb\u0009script:x',
    'file:///etc/hosts',
    'blob:https://example.com/x',
    'custom-scheme:payload',
  ])('drops %j', (href) => {
    expect(attrsOf(href)).toEqual({})
  })
})

describe('href of a link plate (`nota-link-chip`)', () => {
  const chipAttrs = (text: string): Record<string, string> | null => {
    const node = schema.nodes.inline_chip!.create({ text })
    const out = schema.nodes.inline_chip!.spec.toDOM!(node) as [string, Record<string, string>, string]
    return out[0] === 'a' ? out[1] : null
  }

  it.each([
    'xref:https://example.com/{name}[x]',
    'link:mailto:a@example.com?subject={name}[x]',
    'xref:../dir/{name}.adoc[x]',
    'link:#{name}[x]',
  ])('shows %j as a link', (text) => {
    expect(chipAttrs(text)?.class).toBe('nota-link-chip')
  })

  it.each([
    'link:javascript:alert({name})[x]',
    'link:JaVaScRiPt:alert({name})[x]',
    'link:  javascript:alert({name})[x]',
    'link:java\tscript:alert({name})[x]',
    'link:\u0001javascript:{name}[x]',
    'link:data:text/html,{name}[x]',
    'link:DATA:text/html;base64,{name}[x]',
    'link: data:text/html,{name}[x]',
    'link:vbscript:msgbox({name})[x]',
    'link:VBScript:msgbox({name})[x]',
    'link:vb\tscript:{name}[x]',
    'xref:javascript:{name}[x]',
    'link:file:///etc/{name}[x]',
  ])('keeps %j a plate without href', (text) => {
    expect(chipAttrs(text)).toBeNull()
  })
})
