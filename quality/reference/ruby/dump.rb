# frozen_string_literal: true
#
# Structure dump for the Nota quality bench (reference: Ruby Asciidoctor).
#
#   ruby dump.rb --version          -> {"asciidoctor": "...", "ruby": "..."}
#   ruby dump.rb <dir> <file> ...   -> one JSON document per line (JSONL), one line per file
#
# The output format is shared with the Asciidoctor.js dump (quality/reference/js/dump.ts) and the Nota
# extractor (quality/reference/nota-dump.ts); see quality/reference/format.ts.
require 'json'
require 'asciidoctor'

module NotaDump
  @entries = nil
  @entry_line = nil
  @entry_reader = nil
  @depth = 0
  @html = nil
  class << self
    attr_accessor :entries, :entry_line, :entry_reader, :depth, :html
  end
end

# Record the HTML of every block as the document converts it (the block is converted in its place in the document,
# with the attributes, footnote numbers and counters of the moment).
Asciidoctor::AbstractBlock.prepend(Module.new do
  def convert
    result = super
    NotaDump.html[object_id] = result if NotaDump.html
    result
  end
end)

# Record every attribute entry Asciidoctor stores, with its source line and whether it is still in the header.
Asciidoctor::Parser.singleton_class.prepend(Module.new do
  def process_attribute_entry reader, document, attributes = nil, match = nil
    saved = [NotaDump.entry_line, NotaDump.entry_reader]
    NotaDump.entry_line = reader.lineno
    NotaDump.entry_reader = reader
    super
  ensure
    NotaDump.entry_line, NotaDump.entry_reader = saved
  end

  def store_attribute name, value, doc = nil, attrs = nil
    # entries of a nested document (a table cell with the asciidoc style) are not entries of the document
    if NotaDump.entries && NotaDump.depth == 0 && doc && !doc.nested? && NotaDump.entry_line
      NotaDump.entries << {
        'line' => NotaDump.entry_line,
        'name' => name,
        'value' => value,
        'header' => doc.instance_variable_get(:@header_attributes).nil?,
        'nested' => !NotaDump.entry_reader.equal?(doc.reader),
      }
    end
    NotaDump.depth += 1
    begin
      super
    ensure
      NotaDump.depth -= 1
    end
  end
end)

def raw_title node
  node.instance_variable_get :@title
end

def attribute_list_of block
  attrs = block.attributes
  roles = (attrs['role'] || '').split(' ')
  options = attrs.keys.select {|k| String === k && k.end_with?('-option') }.map {|k| k.chomp '-option' }.sort
  named = {}
  attrs.each do |k, v|
    next unless String === k
    named[k] = v.to_s
  end
  { 'roles' => roles, 'options' => options, 'named' => named }
end

LIST_CONTEXTS = %i[ulist olist dlist colist].freeze

def text_lines text
  text.nil? || text.empty? ? 0 : text.split("\n", -1).size
end

# The layout of a table: the columns, and the rows of the head, the body and the foot with their cells (the
# number of the row and of the column the cell starts in, taking the spans of the rows above into account,
# the spans, the alignments, the style, the line, the text and, for a cell with the asciidoc style, the blocks
# of the document it holds).
def table_of table
  columns = table.columns.map do |col|
    { 'width' => col.attr('colpcwidth'), 'halign' => col.attr('halign'), 'valign' => col.attr('valign'),
      'style' => col.style ? col.style.to_s : nil, 'autowidth' => col.option?('autowidth') }
  end
  taken = Hash.new {|h, r| h[r] = {} }
  row_no = 0
  rows = {}
  %i[head body foot].each do |section|
    rows[section.to_s] = table.rows[section].map do |row|
      col_no = 0
      cells = row.map do |cell|
        col_no += 1 while taken[row_no][col_no]
        colspan = cell.colspan || 1
        rowspan = cell.rowspan || 1
        rowspan.times {|dr| colspan.times {|dc| taken[row_no + dr][col_no + dc] = true } }
        blocks = nil
        if cell.inner_document
          blocks = []
          walk cell.inner_document, blocks, 0
        end
        node = { 'row' => row_no, 'column' => col_no, 'colspan' => colspan, 'rowspan' => rowspan,
                 'halign' => cell.attr('halign'), 'valign' => cell.attr('valign'),
                 'style' => cell.style ? cell.style.to_s : nil,
                 'line' => cell.source_location ? cell.source_location.lineno : nil, 'text' => cell.source }
        node['blocks'] = blocks if blocks
        col_no += colspan
        node
      end
      row_no += 1
      cells
    end
  end
  { 'columns' => columns, 'rows' => rows }
end

# lists: the number of lists the block is nested in (list_level); items: marker, checkbox, lines of text
def walk parent, out, parent_line, depth = 0, list_level = 0
  parent.blocks.each do |block|
    # the preamble and part intros are wrappers Asciidoctor adds; they have no syntax of their own
    if block.context == :preamble || (block.context == :open && block.style == 'partintro' && !block.source_location)
      walk block, out, parent_line, depth, list_level
      next
    end
    line = block.source_location ? block.source_location.lineno : nil
    node = { 'context' => block.context.to_s, 'line' => line, 'parent' => parent_line, 'depth' => depth }
    if block.context == :section
      node['level'] = block.level
      node['title'] = raw_title block
      node['style'] = block.attributes['style']
      node['id'] = block.id
      node['sectname'] = block.sectname
    else
      node['style'] = block.style
      node['id'] = block.id
      if block.context == :floating_title
        node['level'] = block.level
        node['title'] = raw_title block
      end
      node['content_model'] = block.content_model.to_s
      node['lines'] = block.lines.size if block.respond_to?(:lines) && (block.content_model == :simple || block.content_model == :verbatim || block.content_model == :raw)
      if LIST_CONTEXTS.include? block.context
        node['list_level'] = list_level
        node['items'] = block.items.size
      elsif block.context == :list_item
        node['marker'] = block.marker
        node['checkbox'] = block.attributes.key?('checkbox')
        node['checked'] = block.attributes.key?('checked')
        node['text_lines'] = text_lines block.instance_variable_get(:@text)
      end
      node['language'] = block.attributes['language'] if block.context == :listing
      node['target'] = block.attributes['target'] if %i[image video audio].include? block.context
    end
    node.update attribute_list_of block
    node['table'] = table_of block if block.context == :table
    out << node
    if block.context == :dlist
      block.items.each do |terms, desc|
        item_line = terms[0].source_location ? terms[0].source_location.lineno : nil
        item = { 'context' => 'list_item', 'line' => item_line, 'parent' => parent_line, 'depth' => depth + 1,
                 'style' => nil, 'id' => nil, 'content_model' => 'compound', 'marker' => nil, 'checkbox' => false,
                 'checked' => false, 'text_lines' => text_lines(desc && desc.instance_variable_get(:@text)),
                 'terms' => terms.map {|t| t.instance_variable_get(:@text) },
                 'roles' => [], 'options' => [], 'named' => {} }
        out << item
        walk desc, out, parent_line, depth + 2, list_level + 1 if desc && desc.respond_to?(:blocks)
      end
    elsif block.context == :list_item
      walk block, out, parent_line, depth + 1, list_level + 1
    elsif block.respond_to?(:blocks) && !(block.context == :table)
      walk block, out, (block.context == :section ? line : parent_line), depth + 1, list_level
    end
  end
end

# the blocks that are children of a block for the HTML comparison: the blocks of a section, of a compound block,
# of the items of a list (the tables have cells, not blocks)
def html_children block
  case block.context
  when :ulist, :olist, :colist
    block.items.flat_map {|item| item.blocks }
  when :dlist
    block.items.flat_map {|_terms, dd| dd ? dd.blocks : [] }
  when :table
    []
  else
    block.respond_to?(:blocks) ? block.blocks : []
  end
end

def html_node block
  line = block.source_location ? block.source_location.lineno : nil
  { 'context' => block.context.to_s, 'line' => line, 'html' => NotaDump.html[block.object_id],
    'blocks' => html_children(block).map {|b| html_node b } }
end

def header_of doc
  attrs = doc.attributes
  header = { 'title' => (doc.header? ? raw_title(doc.header) : nil) }
  count = (attrs['authorcount'] || 0).to_i
  authors = []
  if count == 1
    authors << { 'name' => attrs['author'], 'email' => attrs['email'] }
  elsif count > 1
    (1..count).each {|i| authors << { 'name' => attrs["author_#{i}"], 'email' => attrs["email_#{i}"] } }
  end
  header['authors'] = authors
  if attrs.key?('revnumber') || attrs.key?('revdate') || attrs.key?('revremark')
    header['revision'] = { 'number' => attrs['revnumber'], 'date' => attrs['revdate'], 'remark' => attrs['revremark'] }
  else
    header['revision'] = nil
  end
  header
end

# the dates and times the HTML is written with: the same on all sides (the clock differs from run to run)
FIXED_DATES = {
  'localdate' => '2000-01-02', 'localyear' => '2000', 'localtime' => '03:04:05 +0000',
  'localdatetime' => '2000-01-02 03:04:05 +0000', 'docdate' => '2000-01-02', 'docyear' => '2000',
  'doctime' => '03:04:05 +0000', 'docdatetime' => '2000-01-02 03:04:05 +0000'
}.freeze

def dump_file dir, rel
  NotaDump.entries = []
  source = File.binread(File.join(dir, rel)).force_encoding(Encoding::UTF_8)
  doc = Asciidoctor.load source, safe: :secure, sourcemap: true, attributes: { 'sectids' => nil },
    logger: Logger.new(IO::NULL)
  out = []
  walk doc, out, 0
  entries = NotaDump.entries
  NotaDump.entries = nil
  # the HTML of the document and of each block, from a document loaded with the default attributes
  NotaDump.html = {}
  html_doc = Asciidoctor.load source, safe: :secure, sourcemap: true, attributes: FIXED_DATES,
    logger: Logger.new(IO::NULL)
  html = { 'doc' => html_doc.convert, 'blocks' => html_doc.blocks.map {|b| html_node b } }
  { 'file' => rel, 'header' => header_of(doc), 'entries' => entries, 'nodes' => out, 'html' => html }
rescue StandardError => e
  { 'file' => rel, 'error' => "#{e.class}: #{e.message}" }
ensure
  NotaDump.entries = nil
  NotaDump.html = nil
end

if ARGV.empty? || ARGV[0] == '--version'
  puts JSON.generate({ 'asciidoctor' => Asciidoctor::VERSION, 'ruby' => RUBY_VERSION })
else
  dir = ARGV[0]
  files = ARGV.drop 1
  files = $stdin.read.split("\n") if files == ['-']
  files.each {|rel| $stdout.puts JSON.generate(dump_file(dir, rel)) }
end
