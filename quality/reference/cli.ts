// npm run ref -- build     builds the Ruby Asciidoctor reference image (quality/reference/ruby)
// npm run ref -- versions  prints the exact versions of both references
import '../lib/guard.js'
import { RubyUnavailable, buildImage, rubyVersions } from './ruby.js'
import { jsVersion } from './js/dump.js'

const cmd = process.argv[2]
try {
  if (cmd === 'build') {
    console.log(`built ${buildImage()}`)
  } else if (cmd === 'versions') {
    const ruby = rubyVersions()
    console.log(
      `Ruby Asciidoctor ${ruby.asciidoctor} (Ruby ${ruby.ruby}, gem pinned in quality/reference/ruby/Gemfile.lock)`,
    )
    console.log(`Asciidoctor.js ${await jsVersion()} (@asciidoctor/core, pinned in package-lock.json)`)
  } else {
    console.error('usage: npm run ref -- build | versions')
    process.exit(2)
  }
} catch (e) {
  if (e instanceof RubyUnavailable) {
    console.error(e.message)
    process.exit(3)
  }
  throw e
}
