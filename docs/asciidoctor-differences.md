# Nota and Asciidoctor

Nota reads AsciiDoc the way Asciidoctor does and writes the same HTML, with a few exceptions. This page lists what is
supported, what is not, and where the behaviour differs. Every example below is checked by a test
(`quality/differences-doc.test.ts`): the HTML under each source is what `renderHtml(parse(source))` writes, with the
white space between tags ignored.

Reference: Ruby Asciidoctor 2.0.26 and Asciidoctor.js 4.1, `html5` backend, `secure` safe mode, embedded document
(`Asciidoctor.convert(text, { safe: 'secure' })` without `standalone`).

## Supported

Blocks and inline markup follow Asciidoctor 2.0: paragraphs, sections with ids, lists, tables, admonitions, delimited
blocks, attributes, conditions, the table of contents, footnotes, cross references. The checks behind this are the
block-by-block comparison with both reference implementations (`npm run compare`), the TCK of the Eclipse AsciiDoc
project and fuzzing; see [CONTRIBUTING.md](../CONTRIBUTING.md#quality-tools).

Inline markup:

```asciidoc
= Title

A paragraph with *bold*, _emphasis_ and `code`.
```

```html
<div class="paragraph">
<p>A paragraph with <strong>bold</strong>, <em>emphasis</em> and <code>code</code>.</p>
</div>
```

Sections get ids, and their content is wrapped as in Asciidoctor:

```asciidoc
== First

* one
* two

== Second

text
```

```html
<div class="sect1">
<h2 id="_first">First</h2>
<div class="sectionbody">
<div class="ulist">
<ul>
<li>
<p>one</p>
</li>
<li>
<p>two</p>
</li>
</ul>
</div>
</div>
</div>
<div class="sect1">
<h2 id="_second">Second</h2>
<div class="sectionbody">
<div class="paragraph">
<p>text</p>
</div>
</div>
</div>
```

Tables, with the header row, the column widths and the alignment classes:

```asciidoc
[cols="1,1"]
|===
|A |B

|C |D
|===
```

```html
<table class="tableblock frame-all grid-all stretch">
<colgroup>
<col style="width: 50%;">
<col style="width: 50%;">
</colgroup>
<thead>
<tr>
<th class="tableblock halign-left valign-top">A</th>
<th class="tableblock halign-left valign-top">B</th>
</tr>
</thead>
<tbody>
<tr>
<td class="tableblock halign-left valign-top"><p class="tableblock">C</p></td>
<td class="tableblock halign-left valign-top"><p class="tableblock">D</p></td>
</tr>
</tbody>
</table>
```

The table of contents:

```asciidoc
:toc:

== One

text
```

```html
<div id="toc" class="toc">
<div id="toctitle">Table of Contents</div>
<ul class="sectlevel1">
<li><a href="#_one">One</a></li>
</ul>
</div>
<div class="sect1">
<h2 id="_one">One</h2>
<div class="sectionbody">
<div class="paragraph">
<p>text</p>
</div>
</div>
</div>
```

Conditions, attribute references and passthroughs. A passthrough is written as it is, as in `secure` mode of
Asciidoctor: the converter does not clean HTML, that is up to the host (see
[the safety note](../packages/html/README.md#safety)):

```asciidoc
Some +++<b>raw</b>+++ html.
```

```html
<div class="paragraph">
<p>Some <b>raw</b> html.</p>
</div>
```

Beyond what Asciidoctor does, Nota gives you the lossless tree (`parse(text).text === text` for every input), incremental
reparsing, and editing operations that change only the bytes they have to
([`@nota-adoc/core`](../packages/core/README.md)).

## Not supported

**A whole page** (`standalone`: `<head>`, themes, the title as `<h1>`). `renderHtml` writes an embedded document, so
the page around it is up to the host; the document title is not written unless `showtitle` is set.

```asciidoc
= Page title

Text.
```

```html
<div class="paragraph">
<p>Text.</p>
</div>
```

**Syntax highlighting and icons.** Asciidoctor locks `source-highlighter` and `icons` in the `secure` safe mode, and
so does Nota: a listing has no highlighting markup, and an admonition has a text label instead of an icon.

```asciidoc
[source,ruby]
----
puts "hi"
----
```

```html
<div class="listingblock">
<div class="content">
<pre class="highlight"><code class="language-ruby" data-lang="ruby">puts "hi"</code></pre>
</div>
</div>
```

```asciidoc
NOTE: Remember this.
```

```html
<div class="admonitionblock note">
<table>
<tr>
<td class="icon">
<div class="title">Note</div>
</td>
<td class="content">
Remember this.
</td>
</tr>
</table>
</div>
```

**Safe modes other than `secure`.** The mode is fixed (`safe-mode-level` is locked); see the default attributes in
[`@nota-adoc/core`](../packages/core/README.md#default-attributes) and «What it compares with» in
[`@nota-adoc/html`](../packages/html/README.md#renderhtmldoc-notadocument-options-renderoptions-string).
**Reading `include::` files from disk.** Nota never reads a file. The host gives the text of an included file through
a synchronous `resolver.include` in `ParseOptions`; without it the line writes nothing:

```asciidoc
Before.

include::part.adoc[]

After.
```

```html
<div class="paragraph">
<p>Before.</p>
</div>
<div class="paragraph">
<p>After.</p>
</div>
```

An asynchronous resolver is not supported: load what you need before you parse. See «Includes» in
[`@nota-adoc/html`](../packages/html/README.md#renderhtmldoc-notadocument-options-renderoptions-string) and «Meaning:
ASG, outline, references» in [`@nota-adoc/core`](../packages/core/README.md#meaning-asg-outline-references).
**Blocks nested deeper than 300 levels** are left out of the HTML (the document is still read, and nothing is
thrown). See «Deep nesting» in
[`@nota-adoc/html`](../packages/html/README.md#renderhtmldoc-notadocument-options-renderoptions-string).

## Behaves differently

**A section from `include::` is nested in the block that holds the line.** After `== A` and `include::p.adoc[]` with
`== P` in the file, `P` is a subsection of `A` in Nota, while Asciidoctor reads the files as one text and makes `P`
a sibling of `A`. The example needs a resolver, so it is described in «Meaning: ASG, outline, references» of
[`@nota-adoc/core`](../packages/core/README.md#meaning-asg-outline-references) rather than shown here.
**`{set:leveloffset:N}` in the title of a section** (`set-leveloffset-in-section-title`). Ruby Asciidoctor and
Asciidoctor.js convert a title while they read it, so the levels of the sections after it move. Nota converts the
text of a title later, like the text of any other block, so the levels below stay: `C` below is a sibling of `B`,
while Asciidoctor makes it a subsection of `B`.

```asciidoc
== A

== {set:leveloffset:1}B

== C
```

```html
<div class="sect1">
<h2 id="_a">A</h2>
<div class="sectionbody">

</div>
</div>
<div class="sect1">
<h2 id="_b">B</h2>
<div class="sectionbody">

</div>
</div>
<div class="sect1">
<h2 id="_c">C</h2>
<div class="sectionbody">

</div>
</div>
```

**A filled table cell** (`nota-cell-fill-role`). A label `[.cell-<name>]##{empty}##` at the start of a cell is
written as a class of the `td`, so the whole cell can be filled by the CSS of the host, and without the empty `span`
that Asciidoctor writes. This is a deliberate extension, and there is no option to turn it off.

```asciidoc
[cols="1,1"]
|===
|[.cell-yellow]##{empty}##Filled |plain
|===
```

```html
<table class="tableblock frame-all grid-all stretch">
<colgroup>
<col style="width: 50%;">
<col style="width: 50%;">
</colgroup>
<tbody>
<tr>
<td class="tableblock halign-left valign-top cell-yellow"><p class="tableblock">Filled</p></td>
<td class="tableblock halign-left valign-top"><p class="tableblock">plain</p></td>
</tr>
</tbody>
</table>
```

**Where Ruby Asciidoctor and Asciidoctor.js disagree, Nota follows Ruby.** The disagreements found so far (the
numbering of lists, the markup of page breaks, one-line conditions and so on) are recorded one by one, with a
description and a link to the source of each reference, in the register
[`quality/reference/known-differences.json`](../quality/reference/known-differences.json).
