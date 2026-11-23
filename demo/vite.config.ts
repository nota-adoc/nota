import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const at = (path: string) => fileURLToPath(new URL(path, import.meta.url))

// The demo (one page, /index.html) runs on the sources of the packages, so it needs no build. `base: './'` makes the built page
// work from any folder of any static server.
// An error message of ProseMirror points to its guide with an address. That is a text nobody follows, but the built
// page names no address outside localhost, so the address is written without its scheme.
const noGuideLinks = {
  name: 'no-guide-links',
  transform(code: string, id: string) {
    if (!id.includes('/prosemirror-') || !code.includes('https://prosemirror.net')) return null
    return { code: code.replaceAll('https://prosemirror.net', 'prosemirror.net'), map: null }
  },
}

// the notices of the bundled packages are published next to the page
const thirdPartyNotices = {
  name: 'third-party-notices',
  generateBundle(this: { emitFile(file: { type: 'asset'; fileName: string; source: string }): void }) {
    this.emitFile({ type: 'asset', fileName: 'THIRD_PARTY_NOTICES.md', source: readFileSync(at('../THIRD_PARTY_NOTICES.md'), 'utf8') })
  },
}

export default defineConfig({
  root: at('.'),
  plugins: [noGuideLinks, thirdPartyNotices],
  base: './',
  resolve: {
    alias: {
      // the longer name first: an alias also applies to the paths below its name
      '@nota-adoc/core/internal': at('../packages/core/src/internal.ts'),
      '@nota-adoc/core': at('../packages/core/src/index.ts'),
      '@nota-adoc/codemirror': at('../packages/codemirror/src/index.ts'),
      '@nota-adoc/prosemirror': at('../packages/prosemirror/src/index.ts'),
    },
  },
  server: {
    port: 5178,
    strictPort: true,
    // the samples are the fixtures of the quality bench, outside this folder
    fs: { allow: [at('..')] },
  },
  // no modulepreload polyfill: it calls fetch(), and the page must not call anything itself
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    modulePreload: false,
    // one page
    rollupOptions: { input: { index: at('index.html') } },
  },
})
