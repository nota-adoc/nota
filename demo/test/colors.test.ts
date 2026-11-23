// the sample «Цвета» and the colours of the roles `hl-*` in the page, in both themes.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { messagesOf } from '../src/messages.js'
import { choose, closePage, cursorIn, fixture, openPage, outgoing, read, stubNetwork } from './helpers.js'

const messages = messagesOf('ru')

beforeEach(() => {
  outgoing.length = 0
  stubNetwork()
})
afterEach(closePage)

const text = fixture('editor/colors.adoc')

describe('demo: the sample «Цвета»', () => {
  it('is in the list, opens in «Визуально» with the source as in the file, and switching shows it byte for byte', async () => {
    const page = await openPage()
    expect([...page.sample.options].map((o) => o.text)).toContain('Цвета')
    choose(page, 'colors')
    expect(page.text()).toBe(text)
    page.view('visual')
    page.view('source')
    expect(page.cm().state.doc.toString()).toBe(text)
    expect(page.count('error')).toBe('0')
  })

  it('shows pass:q[…] and ((…)) in colour as text, and the rest of the cases as plates', async () => {
    const page = await openPage()
    choose(page, 'colors')
    const dom = page.pm().dom
    const chips = [...dom.querySelectorAll('.nota-inline-chip')].map((c) => c.textContent)
    expect(chips).toEqual([
      'pass:[<b>раз</b>]',
      'pass:c[два]',
      'pass:q,c[три]',
      '+четыре+',
      '++пять++',
      '+++<i>шесть</i>+++',
      '$$семь$$',
      '(((скрытый)))',
      'indexterm:[второй]',
      'indexterm2:[третий]',
      '((*жирный*))',
    ])
    const red = [...dom.querySelectorAll('.hl-red')].map((e) => e.textContent)
    expect(red).toContain('красное')
    expect(red.join('')).toContain('до жир и кур после')
    expect(red.join('')).toContain('до термин после')
  })

  it('refuses a letter inside pass:q[…] with the message of the demo, and the text stays', async () => {
    const page = await openPage()
    choose(page, 'colors')
    cursorIn(page, 'жир', 1)
    const view = page.pm()
    const { from, to } = view.state.selection
    view.someProp('handleTextInput', (f) => f(view, from, to, 'я', () => view.state.tr.insertText('я', from, to)))
    expect(page.text()).toBe(text)
    expect(page.notice()).toBe(messages['inside-construct'])
    expect(messages['inside-construct']).toBe(
      'Это место внутри разметки, которую визуальный редактор не правит: правьте её в «Исходнике».',
    )
  })
})

describe('demo: the colours of the roles in the page', () => {
  const css = read('src/style.css')
  const FILL = ['yellow', 'red', 'orange', 'green', 'teal', 'blue', 'purple', 'pink', 'gray']
  const LETTERS = ['red', 'orange', 'green', 'teal', 'blue', 'purple', 'pink', 'gray']

  it('has a rule for each of the seventeen roles, with the tokens of the palette', () => {
    for (const c of FILL)
      expect(css).toMatch(new RegExp(`\\.doc \\.hl-${c}-bg \\{ background: var\\(--ap-hl-${c}\\); \\}`))
    for (const c of LETTERS)
      expect(css).toMatch(new RegExp(`\\.doc \\.hl-${c} \\{ color: var\\(--ap-tx-${c}\\); \\}`))
  })

  it('defines the tokens in the light theme and in both forms of the dark one, with the values of the prototype', () => {
    const proto = read('../design/editor/prototype.html')
    for (const c of [...FILL.map((x) => `hl-${x}`), ...LETTERS.map((x) => `tx-${x}`)]) {
      const defs = css.match(new RegExp(`--ap-${c}: #[0-9a-f]{6}`, 'g')) ?? []
      expect(defs.length, c).toBe(3)
      // the light and the dark values are those of the prototype
      const light = proto.match(new RegExp(`--ap-${c}:(#[0-9a-f]{6})`, 'g')) ?? []
      expect(light.length, c).toBeGreaterThanOrEqual(2)
      expect(defs.filter((d) => light.some((l) => l.replace(':', ': ') === d)).length, c).toBeGreaterThanOrEqual(3)
    }
  })
})
