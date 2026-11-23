import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { oneDark } from '@codemirror/theme-one-dark'
import { afterEach, describe, expect, it } from 'vitest'
import { asciidoc, asciidocTags, highlightRanges, highlightTable, type HighlightGroup } from '@nota-adoc/codemirror'
import { fixtures } from './helpers.js'

const views: EditorView[] = []
afterEach(() => {
  for (const v of views.splice(0)) v.destroy()
})

function mount(doc: string, extensions: import('@codemirror/state').Extension[] = []): EditorView {
  const view = new EditorView({ doc, extensions: [asciidoc(), ...extensions], parent: document.body })
  views.push(view)
  ;(view as unknown as { measure(): void }).measure()
  return view
}

const allConstructs = fixtures().filter(([n]) => n.endsWith('all-constructs.adoc'))

/** The text under each group class in the rendered editor. */
function rendered(view: EditorView): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const el of view.dom.querySelectorAll('.cm-ap')) {
    const group = [...el.classList].find((c) => c.startsWith('cm-ap-'))!.slice('cm-ap-'.length)
    const list = out.get(group) ?? []
    list.push(el.textContent!)
    out.set(group, list)
  }
  return out
}

describe('highlighting', () => {
  it('has a tag and a rule for every group of the table', () => {
    const groups = new Set(highlightTable.map((r) => r.group))
    groups.delete('heading')
    for (const g of groups) expect(asciidocTags).toHaveProperty(g as string)
  })

  it('finds the all-constructs samples of every stage', () => {
    expect(allConstructs.map(([n]) => n)).toEqual([
      'stage1/all-constructs.adoc',
      'stage2/all-constructs.adoc',
      'stage3/all-constructs.adoc',
      'stage4/all-constructs.adoc',
    ])
  })

  it('gives every group its own class, and paragraph text none', () => {
    const views = allConstructs.map(([, text]) => mount(text))
    // the two samples together cover every group
    const by = new Map<string, string[]>()
    for (const v of views) for (const [g, l] of rendered(v)) by.set(g, [...(by.get(g) ?? []), ...l])
    const expected: [HighlightGroup, string][] = [
      ['heading0', 'All constructs of stage 2'],
      ['heading1', 'Lists'],
      ['author', 'Jane Roe'],
      ['revision', '2026-09-29'],
      ['attributeName', 'flavor'],
      ['attributeValue', 'plain'],
      ['punctuation', ':'],
      ['blockDelimiter', '----'],
      ['listMarker', '*'],
      ['checkbox', '[x]'],
      ['descriptionTerm', 'term'],
      ['listContinuation', '+'],
      ['admonition', 'NOTE: '],
      ['attrStyle', 'NOTE'],
      ['rawContent', 'A listing.'],
      ['codeLanguage', 'ruby'],
      ['macroName', 'image'],
      ['macroTarget', 'picture.png'],
      ['break', "'''"],
      ['commentDelimiter', '////'],
      ['comment', 'A block comment.'],
      ['directiveName', 'ifdef'],
      ['directiveTarget', 'flavor'],
      ['directiveText', '"{flavor}" == "plain"'],
      ['disabled', 'Text without the flavor.'],
      ['quoteAttribution', '-- Somebody'],
      // inline markup (stage 4)
      ['strong', '*strong*'],
      ['emphasis', '_emphasis_'],
      ['monospace', '`mono`'],
      ['highlightText', '#highlight#'],
      ['superscript', '^2^'],
      ['subscript', '~2~'],
      ['doubleQuoted', '"`double quoted`"'],
      ['singleQuoted', "'`single quoted`'"],
      ['quoteMarker', '*'],
      ['inlineAttributes', '[.line-through]'],
      ['escape', '\\'],
      ['passthrough', '+literal *not bold* text+'],
      ['passMarker', '+++'],
      ['passSubs', 'q'],
      ['stem', 'stem:[sqrt(4) = 2]'],
      ['attributeReference', '{product}'],
      ['replacement', '(C)'],
      ['hardBreak', ' +'],
      ['callout', '// <1>'],
      ['link', 'https://example.com[site]'],
      ['linkText', 'site'],
      ['macroText', 'The first note.'],
    ]
    for (const [group, text] of expected) expect(by.get(group), group).toContain(text)
    // paragraph text is not marked
    const marked = [...by.values()].flat().join('')
    expect(marked).not.toContain('Introductory paragraph')
    expect(marked).not.toContain('An example with a paragraph')
    // every group that appears has its own class from the neutral style, none equals another's
    const classes = new Map<string, string>()
    for (const el of views.flatMap((v) => [...v.dom.querySelectorAll('.cm-ap')])) {
      const group = [...el.classList].find((c) => c.startsWith('cm-ap-'))!.slice(6)
      const styled = [...el.classList].filter((c) => !c.startsWith('cm-ap')).join(' ')
      expect(styled, group).not.toBe('')
      classes.set(group, styled)
    }
    expect(new Set(classes.values()).size).toBe(classes.size)
  })

  it('marks the separators and the specs of the cells like block delimiters, and the blocks of an a cell like blocks', () => {
    const text = [
      '[cols="2,1"]',
      '|===',
      '|plain 2+^.>s|spec',
      'a|Text with *bold*',
      '',
      '----',
      'listing in a cell',
      '----',
      '|last',
      '|===',
      '',
    ].join('\n')
    const by = rendered(mount(text))
    // the opening and the closing line, every `|`, the spec of a cell; nothing of the text of a plain cell
    expect(by.get('blockDelimiter')).toEqual(['|===', '|', '2+^.>s', '|', 'a', '|', '----', '----', '|', '|==='])
    const marked = [...by.values()].flat().join('\n')
    expect(marked).not.toContain('plain')
    expect(marked).not.toContain('spec')
    // what an `a` cell holds is highlighted as it is outside a table
    expect(by.get('strong')).toEqual(['*bold*'])
    expect(by.get('rawContent')).toEqual(['listing in a cell'])
  })

  it('tells the heading levels 0-5 apart, the style parts of an attribute list, id and unset marks', () => {
    const text = [
      '= Zero', '', '== One', '', '=== Two', '', '==== Three', '', '===== Four', '', '====== Five', '',
      '[[a,ref]]', '[quote#id.role%opt,key=v]', '.Title', 'Text', '', ':x!:', ':!y:', '',
    ].join('\n')
    const by = rendered(mount(text))
    expect(by.get('heading0')).toContain('Zero')
    for (const [g, w] of [['heading1', 'One'], ['heading2', 'Two'], ['heading3', 'Three'], ['heading4', 'Four'], ['heading5', 'Five']])
      expect(by.get(g!), g).toContain(w)
    expect(by.get('attrStyle')).toContain('quote')
    expect(by.get('attrId')).toContain('#id')
    expect(by.get('attrRole')).toContain('.role')
    expect(by.get('attrOption')).toContain('%opt')
    expect(by.get('anchorId')).toContain('a')
    expect(by.get('anchorText')).toContain('ref')
    expect(by.get('blockTitle')).toContain('Title')
    expect(by.get('attributeUnset')).toEqual(['!', '!'])
    expect(by.get('attributeName')).toContain('key')
  })

  it('gives the style of a block the group of a style, the rest of the attributes that of a value', () => {
    const by = rendered(mount('[NOTE]\n====\nx\n====\n\n[source,java]\n----\nx\n----\n\n[quote,Автор]\n____\nx\n____\n\n[verse]\n____\nx\n____\n\nimage::a.png[Alt]\n\n["NOTE"]\ntext\n\n[,python]\n----\nx\n----\n\n[NOTE#id.role]\ntext\n'))
    expect(by.get('attrStyle')).toEqual(['NOTE', 'source', 'quote', 'verse', 'NOTE'])
    expect(by.get('attrPositional')).toEqual(['java', 'Автор', 'Alt', '"NOTE"', 'python'])
  })

  it('takes colours from the highlight style of the host: oneDark changes them without touching the package', () => {
    const plain = mount('== Title\n\n----\ncode\n----\n')
    const dark = mount('== Title\n\n----\ncode\n----\n', [oneDark])
    const styled = (v: EditorView) => [...v.dom.querySelectorAll('.cm-ap')].map((el) => [...el.classList].filter((c) => !c.startsWith('cm-ap')).join(' '))
    expect(styled(plain).length).toBe(styled(dark).length)
    expect(styled(dark).every((c) => c !== '')).toBe(true)
    styled(plain).forEach((c, i) => expect(styled(dark)[i]).not.toBe(c))
  })

  describe('neutral fallback style follows the theme of the host', () => {
    /** The value of a CSS variable that the style rules of the page give to the editor element. */
    function declared(view: EditorView, name: string): string | undefined {
      let found: string | undefined
      for (const sheet of Array.from(document.styleSheets))
        for (const rule of Array.from(sheet.cssRules)) {
          const r = rule as CSSStyleRule
          if (!r.selectorText || !r.style) continue
          const value = r.style.getPropertyValue(name)
          if (value && view.dom.matches(r.selectorText)) found = value.trim()
        }
      return found
    }
    const darkHost = EditorView.theme({}, { dark: true })

    it('gives a host with a dark theme and no highlight style of its own the dark palette, a light one the light palette', () => {
      const light = mount('= Title\n')
      const dark = mount('= Title\n', [darkHost])
      expect(declared(light, '--ap-heading-0-default')).toBe('#0b3d91')
      expect(declared(dark, '--ap-heading-0-default')).toBe('#e5c07b')
      expect(declared(dark, '--ap-value-default')).not.toBe(declared(light, '--ap-value-default'))
    })

    it('still lets the host set the colour through --ap-heading-0 on any ancestor', () => {
      const view = mount('= Title\n')
      const cls = [...view.dom.querySelector('.cm-ap-heading0')!.classList].find((c) => !c.startsWith('cm-ap'))!
      const rules = Array.from(document.styleSheets).flatMap((s) => Array.from(s.cssRules) as CSSStyleRule[])
      const rule = rules.find((r) => r.selectorText?.includes(cls))
      expect(rule?.style.color).toContain('var(--ap-heading-0')
    })
  })

  it('every highlighted range is the range of a node whose type is in the table', () => {
    for (const [, text] of fixtures()) {
      const state = EditorState.create({ doc: text, extensions: [asciidoc()] })
      const listed = new Set(highlightTable.map((r) => r.node))
      const nodes = new Set<string>()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(state as any).tree.iterate({ enter: (n: { name: string; from: number; to: number }) => nodes.add(`${n.name}:${n.from}-${n.to}`) })
      for (const r of highlightRanges(state)) {
        expect(listed.has(r.node)).toBe(true)
        expect(nodes.has(`${r.node}:${r.from}-${r.to}`)).toBe(true)
      }
    }
  })
})
