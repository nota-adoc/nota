# Reference: Ruby Asciidoctor, pinned by Gemfile.lock. Used only by the quality bench, never shipped.
FROM ruby:3.3.12-slim

WORKDIR /ref
COPY Gemfile Gemfile.lock ./
RUN bundle config set --local frozen true && bundle install --quiet
COPY dump.rb ./

# Usage: docker run --rm -v <dir>:/in:ro <image> [file ...]   (paths relative to /in; no args = versions)
ENTRYPOINT ["bundle", "exec", "ruby", "/ref/dump.rb"]
