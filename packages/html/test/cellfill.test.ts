import { describe, expect, it } from 'vitest'
import { parse } from '@nota-adoc/core'
import { renderHtml } from '@nota-adoc/html'

const html = (text: string) => renderHtml(parse(text))
const Y = '[.cell-yellow]##{empty}##'
const TD = '<td class="tableblock halign-left valign-top cell-yellow">'

describe('cell fill in HTML', () => {
  it('puts the role last on the cell and writes no span', () => {
    const out = html(`|===\n|${Y}текст\n|[.cell-yellow]#{empty}# два\n|${Y}\n|обычная\n|===\n`)
    expect(out).toContain(`${TD}<p class="tableblock">текст</p></td>`)
    expect(out).toContain(`${TD}<p class="tableblock"> два</p></td>`)
    expect(out).toContain(`${TD}</td>`)
    expect(out).toContain('<td class="tableblock halign-left valign-top"><p class="tableblock">обычная</p></td>')
    expect(out).not.toContain('<span')
  })

  it('keeps the rest of the cell as without the label', () => {
    const out = html(`|===\nm|${Y}m\nh|${Y}h\na|${Y}абзац\n\n* п\n|===\n`)
    expect(out).toContain(`${TD}<p class="tableblock"><code>m</code></p></td>`)
    expect(out).toContain('<th class="tableblock halign-left valign-top cell-yellow"><p class="tableblock">h</p></th>')
    expect(out).toContain(`${TD}<div class="content"><div class="paragraph">\n<p>абзац</p>\n</div>`)
    expect(out).not.toContain('<span')
  })

  it('writes an empty cell for an `a` cell with the label alone', () => {
    const out = html(`|===\na|${Y}\n|===\n`)
    expect(out).toContain(`${TD}</td>`)
    expect(out).not.toContain('<p>')
  })

  it('fills the cells of the head', () => {
    expect(html(`[%header]\n|===\n|${Y}a |b\n|===\n`)).toContain(
      '<th class="tableblock halign-left valign-top cell-yellow">a</th>\n<th class="tableblock halign-left valign-top">b</th>',
    )
  })

  it('does not change a table without labels', () => {
    expect(html('|===\n|a\n|===\n')).toContain('<td class="tableblock halign-left valign-top"><p class="tableblock">a</p></td>')
  })
})
