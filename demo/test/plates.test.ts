// plates and service lines. In «Пример ТЗ» the list and the code block are plates in the style of the prototype (their source
// inside, monospace); a selected plate takes no typing; the line `[[acceptance]]` is shown grey over its heading.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { choose, closePage, fixture, openPage, outgoing, read, selectPlate, stubNetwork, typeChar } from './helpers.js'

beforeEach(() => {
  outgoing.length = 0
  stubNetwork()
})
afterEach(closePage)

const start = fixture('editor/visual.adoc')
const css = read('src/style.css')
/** The declarations of the first rule of the css whose selector is `selector`. */
const rule = (selector: string): string => {
  const at = css.indexOf(`\n${selector} {`)
  expect(at, selector).toBeGreaterThanOrEqual(0)
  return css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at))
}

describe('demo: the block under an anchor over the first block', () => {
  it('keeps the rule of the first block: no margin on top', () => {
    expect(rule('.doc > :first-child, .doc > .nota-anchor:first-child + *')).toMatch(/margin-top: 0/)
  })
})

describe('demo: plates and service lines', () => {
  it('shows the list as items and the code block as a plate with its source inside', async () => {
    const page = await openPage()
    // the code block of the sample is code: its text between the delimiters, in monospace, with the language over it
    const code = [...page.pm().dom.querySelectorAll<HTMLElement>('.nota-code')]
    expect(code).toHaveLength(1)
    const items = [...page.pm().dom.querySelectorAll<HTMLElement>('.li-text')]
    expect(items.map((c) => c.textContent)).toEqual(['Вход', 'Список заказов', 'Карточка заказа'])
    expect(code[0]!.querySelector('.code-src')!.textContent).toBe('{"order": 42, "status": "shipped"}')
    expect(code[0]!.querySelector('.code-lang')!.textContent).toBe('JSON')
    expect(rule('.nota-code .code-src')).toMatch(/font(?:-family)?:[^;]*var\(--ap-font-mono\)/)
  })

  it('draws what the editor does not draw as an island: a dashed frame, the note, the source in monospace', async () => {
    const page = await openPage()
    choose(page, 'all')
    const islands = [...page.pm().dom.querySelectorAll<HTMLElement>('.nota-island')]
    expect(islands.length).toBeGreaterThan(0)
    expect(islands[0]!.querySelector('.island-note')!.textContent).toBe('As in the file — edited as text')
    expect(rule('.nota-island')).toMatch(/border: 1px dashed/)
    expect(rule('.nota-island .island-src')).toMatch(/var\(--ap-font-mono\)/)
  })

  it('selects a plate: it looks selected, and the marks and the style of the toolbar are pale', async () => {
    const page = await openPage()
    const plate = selectPlate(page, 'DelimitedBlock')
    expect(plate.classList.contains('ProseMirror-selectednode')).toBe(true)
    expect(page.pm().dom.querySelectorAll('.ProseMirror-selectednode').length).toBe(1)
    expect(page.disabled('strong')).toBe(true)
    expect(page.style.disabled).toBe(true)
  })

  it('takes no typing with a plate selected: the message, and the text as it was', async () => {
    const page = await openPage()
    selectPlate(page, 'DelimitedBlock')
    typeChar(page, 'x')
    expect(page.notice()).toBe('Этот блок пока правится только в «Исходнике».')
    expect(page.text()).toBe(start)
    // in another sample too: a comment block
    choose(page, 'all')
    expect(page.pm().dom.querySelector('.nota-island[data-kind="BlockComment"]')).not.toBeNull()
    const text = page.text()
    selectPlate(page, 'BlockComment')
    typeChar(page, 'y')
    expect(page.notice()).toBe('Этот блок пока правится только в «Исходнике».')
    expect(page.text()).toBe(text)
  })

  it('the anchor [[acceptance]] over its heading is not shown, the other service lines are grey and wrap', async () => {
    const page = await openPage()
    const heading = [...page.pm().dom.querySelectorAll<HTMLElement>('h2')].find((h) => h.textContent === 'Приёмка')!
    expect(heading.dataset.meta).toBeUndefined()
    expect(heading.textContent).toBe('Приёмка')
    expect(page.pm().dom.querySelector('.nota-anchor')!.getAttribute('data-id')).toBe('acceptance')
    expect(rule('.doc .nota-anchor')).toMatch(/display: none/)
    expect(rule('.doc [data-meta]::before')).toMatch(/content: attr\(data-meta\)/)
    expect(rule('.doc [data-meta]::before')).toMatch(/white-space: pre-wrap/)
    expect(rule('.doc [data-meta]::before')).toMatch(/overflow-wrap: anywhere/)
    expect(rule('.doc [data-meta]::before')).toMatch(/color: var\(--ap-ink-faint\)/)
    expect(rule('.doc [data-meta]::before')).toMatch(/var\(--ap-font-mono\)/)
    // the text of the source has the line, the text of the window does not
    expect(page.text()).toContain('[[acceptance]]\n== Приёмка')
  })

  it('shows inline plates for what the editor does not edit inside a line', async () => {
    const page = await openPage()
    choose(page, 'inline')
    const inline = page.pm().dom.querySelectorAll('.nota-inline-chip')
    expect(inline.length).toBeGreaterThan(0)
    for (const chip of inline) expect(chip.getAttribute('contenteditable')).toBe('false')
    expect(rule('.nota-inline-chip')).toMatch(/font(?:-family)?:[^;]*var\(--ap-font-mono\)/)
  })

  it('gives an inline plate the text pointer: it is never selected as a whole, a click puts the caret beside it', () => {
    expect(rule('.nota-inline-chip')).toMatch(/cursor: text/)
    // the editor takes no selection of an inline plate, so no rule waits for one
    expect(css).not.toContain('.nota-inline-chip.ProseMirror-selectednode')
  })
})
