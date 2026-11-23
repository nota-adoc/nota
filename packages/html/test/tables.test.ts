import { describe, expect, it } from 'vitest'
import { type ParseOptions, parse } from '@nota-adoc/core'
import { renderHtml } from '@nota-adoc/html'

const html = (text: string, options?: ParseOptions) => renderHtml(parse(text, options))

/** The expected output is what Ruby Asciidoctor 2.0.26 writes for the text (`asciidoctor -s -S secure`). */
describe('tables in HTML', () => {
  it('writes the table of the task as Asciidoctor does: caption, colgroup, head, body', () => {
    expect(html('.Итоги\n[cols="1,1",options="header"]\n|===\n|A |B\n\n|1 |2\n|===\n')).toBe(
      [
        '<table class="tableblock frame-all grid-all stretch">',
        '<caption class="title">Table 1. Итоги</caption>',
        '<colgroup>',
        '<col style="width: 50%;">',
        '<col style="width: 50%;">',
        '</colgroup>',
        '<thead>',
        '<tr>',
        '<th class="tableblock halign-left valign-top">A</th>',
        '<th class="tableblock halign-left valign-top">B</th>',
        '</tr>',
        '</thead>',
        '<tbody>',
        '<tr>',
        '<td class="tableblock halign-left valign-top"><p class="tableblock">1</p></td>',
        '<td class="tableblock halign-left valign-top"><p class="tableblock">2</p></td>',
        '</tr>',
        '</tbody>',
        '</table>',
      ].join('\n'),
    )
  })

  it('writes frame, grid, stripes and width', () => {
    expect(
      html('[frame=topbot,grid=rows,stripes=even,width=50%,%footer]\n|===\n|a |b\n|c |d\n|e |f\n|===\n'),
    ).toBe(
      [
        '<table class="tableblock frame-ends grid-rows stripes-even" style="width: 50%;">',
        '<colgroup>',
        '<col style="width: 50%;">',
        '<col style="width: 50%;">',
        '</colgroup>',
        '<tbody>',
        '<tr>',
        '<td class="tableblock halign-left valign-top"><p class="tableblock">a</p></td>',
        '<td class="tableblock halign-left valign-top"><p class="tableblock">b</p></td>',
        '</tr>',
        '<tr>',
        '<td class="tableblock halign-left valign-top"><p class="tableblock">c</p></td>',
        '<td class="tableblock halign-left valign-top"><p class="tableblock">d</p></td>',
        '</tr>',
        '<tr>',
        '<td class="tableblock halign-left valign-top"><p class="tableblock">e</p></td>',
        '<td class="tableblock halign-left valign-top"><p class="tableblock">f</p></td>',
        '</tr>',
        '</tbody>',
        '</table>',
      ].join('\n'),
    )
  })

  it('writes a table with `%autowidth`, with and without a width', () => {
    expect(html('[%autowidth]\n|===\n|a |b\n|===\n\n[%autowidth,width=50%]\n|===\n|a |b\n|===\n')).toBe(
      [
        '<table class="tableblock frame-all grid-all fit-content">',
        '<colgroup>',
        '<col>',
        '<col>',
        '</colgroup>',
        '<tbody>',
        '<tr>',
        '<td class="tableblock halign-left valign-top"><p class="tableblock">a</p></td>',
        '<td class="tableblock halign-left valign-top"><p class="tableblock">b</p></td>',
        '</tr>',
        '</tbody>',
        '</table>',
        '<table class="tableblock frame-all grid-all" style="width: 50%;">',
        '<colgroup>',
        '<col>',
        '<col>',
        '</colgroup>',
        '<tbody>',
        '<tr>',
        '<td class="tableblock halign-left valign-top"><p class="tableblock">a</p></td>',
        '<td class="tableblock halign-left valign-top"><p class="tableblock">b</p></td>',
        '</tr>',
        '</tbody>',
        '</table>',
      ].join('\n'),
    )
  })

  it('writes alignments, spans and the styles of cells (a row of a rowspan, literal, header, emphasis, asciidoc)', () => {
    expect(
      html(
        '[cols="<,^.>,>.^e"]\n|===\n|left |center |right\n2+|span 3+.>m|x\n.2+^.^s|tall |l1 |l2\n|l3 l4\n\nl|literal\n  text\nd|plain *b* text\nh|head cell\na|* list\n+\npara\n|===\n',
      ),
    ).toBe(
      [
        '<table class="tableblock frame-all grid-all stretch">',
        '<colgroup>',
        '<col style="width: 33.3333%;">',
        '<col style="width: 33.3333%;">',
        '<col style="width: 33.3334%;">',
        '</colgroup>',
        '<tbody>',
        '<tr>',
        '<td class="tableblock halign-left valign-top"><p class="tableblock">left</p></td>',
        '<td class="tableblock halign-center valign-bottom"><p class="tableblock">center</p></td>',
        '<td class="tableblock halign-right valign-middle"><p class="tableblock"><em>right</em></p></td>',
        '</tr>',
        '<tr>',
        '<td class="tableblock halign-center valign-middle" rowspan="2"><p class="tableblock"><strong>tall</strong></p></td>',
        '<td class="tableblock halign-center valign-bottom"><p class="tableblock">l1</p></td>',
        '<td class="tableblock halign-right valign-middle"><p class="tableblock"><em>l2</em></p></td>',
        '</tr>',
        '<tr>',
        '<td class="tableblock halign-left valign-top"><p class="tableblock">l3 l4</p></td>',
        '<td class="tableblock halign-center valign-bottom"><div class="literal"><pre>literal',
        '  text</pre></div></td>',
        '</tr>',
        '<tr>',
        '<td class="tableblock halign-left valign-top"><p class="tableblock">plain <strong>b</strong> text</p></td>',
        '<th class="tableblock halign-center valign-bottom"><p class="tableblock">head cell</p></th>',
        '<td class="tableblock halign-right valign-middle"><div class="content"><div class="ulist">',
        '<ul>',
        '<li>',
        '<p>list</p>',
        '<div class="paragraph">',
        '<p>para</p>',
        '</div>',
        '</li>',
        '</ul>',
        '</div></div></td>',
        '</tr>',
        '</tbody>',
        '</table>',
      ].join('\n'),
    )
  })

  it('writes the id, the roles, the float, the footer and the background of the cells', () => {
    expect(
      html(
        ':cellbgcolor: #eee\n\n[#tid.wide%header%footer,float=right,cols="2*"]\n|===\n|H1 |H2\n|x |\n|F1 |F2\n|===\n',
      ),
    ).toBe(
      [
        '<table id="tid" class="tableblock frame-all grid-all stretch right wide">',
        '<colgroup>',
        '<col style="width: 50%;">',
        '<col style="width: 50%;">',
        '</colgroup>',
        '<thead>',
        '<tr>',
        '<th class="tableblock halign-left valign-top" style="background-color: #eee;">H1</th>',
        '<th class="tableblock halign-left valign-top" style="background-color: #eee;">H2</th>',
        '</tr>',
        '</thead>',
        '<tbody>',
        '<tr>',
        '<td class="tableblock halign-left valign-top" style="background-color: #eee;"><p class="tableblock">x</p></td>',
        '<td class="tableblock halign-left valign-top" style="background-color: #eee;"></td>',
        '</tr>',
        '</tbody>',
        '<tfoot>',
        '<tr>',
        '<td class="tableblock halign-left valign-top" style="background-color: #eee;"><p class="tableblock">F1</p></td>',
        '<td class="tableblock halign-left valign-top" style="background-color: #eee;"><p class="tableblock">F2</p></td>',
        '</tr>',
        '</tfoot>',
        '</table>',
      ].join('\n'),
    )
  })

  it('writes a table without a number (`:table-caption!:`), CSV data and quotes', () => {
    expect(html(':table-caption!:\n\n.No number\n,===\na,"b, ""q"""\nc,d\n,===\n')).toBe(
      [
        '<table class="tableblock frame-all grid-all stretch">',
        '<caption class="title">No number</caption>',
        '<colgroup>',
        '<col style="width: 50%;">',
        '<col style="width: 50%;">',
        '</colgroup>',
        '<tbody>',
        '<tr>',
        '<td class="tableblock halign-left valign-top"><p class="tableblock">a</p></td>',
        '<td class="tableblock halign-left valign-top"><p class="tableblock">b, "q"</p></td>',
        '</tr>',
        '<tr>',
        '<td class="tableblock halign-left valign-top"><p class="tableblock">c</p></td>',
        '<td class="tableblock halign-left valign-top"><p class="tableblock">d</p></td>',
        '</tr>',
        '</tbody>',
        '</table>',
      ].join('\n'),
    )
  })

  it('writes a table with the `a` style in a cell: blocks, and a table in it', () => {
    expect(
      html(
        '[cols="1,2a"]\n|===\n|one |Cell with:\n\n* item\n\n[cols=2]\n!===\n!in !nested\n\n!more !cells\n!===\n|===\n',
      ),
    ).toBe(
      [
        '<table class="tableblock frame-all grid-all stretch">',
        '<colgroup>',
        '<col style="width: 33.3333%;">',
        '<col style="width: 66.6667%;">',
        '</colgroup>',
        '<tbody>',
        '<tr>',
        '<td class="tableblock halign-left valign-top"><p class="tableblock">one</p></td>',
        '<td class="tableblock halign-left valign-top"><div class="content"><div class="paragraph">',
        '<p>Cell with:</p>',
        '</div>',
        '<div class="ulist">',
        '<ul>',
        '<li>',
        '<p>item</p>',
        '</li>',
        '</ul>',
        '</div>',
        '<table class="tableblock frame-all grid-all stretch">',
        '<colgroup>',
        '<col style="width: 50%;">',
        '<col style="width: 50%;">',
        '</colgroup>',
        '<thead>',
        '<tr>',
        '<th class="tableblock halign-left valign-top">in</th>',
        '<th class="tableblock halign-left valign-top">nested</th>',
        '</tr>',
        '</thead>',
        '<tbody>',
        '<tr>',
        '<td class="tableblock halign-left valign-top"><p class="tableblock">more</p></td>',
        '<td class="tableblock halign-left valign-top"><p class="tableblock">cells</p></td>',
        '</tr>',
        '</tbody>',
        '</table></div></td>',
        '</tr>',
        '</tbody>',
        '</table>',
      ].join('\n'),
    )
  })
})

describe('values of attribute entries with the substitutions of the pass macro', () => {
  const doc = ':box: pass:normal[{startsb}&#10004;{endsb}]\n\n{box} done\n'

  it('applies a group of substitutions to the value, as Asciidoctor does', () => {
    expect(renderHtml(parse(doc))).toContain('<p>[&#10004;] done</p>')
  })

  it('does the same in the document of a cell with the asciidoc style', () => {
    expect(renderHtml(parse(`|===\na|\n${doc}|===\n`))).toContain('<p>[&#10004;] done</p>')
  })

  it('keeps the single substitutions, and the value as it is without them', () => {
    expect(renderHtml(parse(':a: pass:c,a[<b> {startsb}]\n\n{a}\n'))).toContain('&lt;b&gt; [')
    expect(renderHtml(parse(':a: pass:[<b> {startsb}]\n\n{a}\n'))).toContain('<b> {startsb}')
  })
})
