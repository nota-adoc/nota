import { availableParallelism } from 'node:os'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// the longer name first: an alias also applies to the paths below its name
const alias = {
  '@nota-adoc/core/internal': fileURLToPath(new URL('./packages/core/src/internal.ts', import.meta.url)),
  '@nota-adoc/core': fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)),
  '@nota-adoc/html': fileURLToPath(new URL('./packages/html/src/index.ts', import.meta.url)),
  '@nota-adoc/codemirror': fileURLToPath(new URL('./packages/codemirror/src/index.ts', import.meta.url)),
  '@nota-adoc/prosemirror': fileURLToPath(new URL('./packages/prosemirror/src/index.ts', import.meta.url)),
  '@nota-adoc/react': fileURLToPath(new URL('./packages/react/src/index.ts', import.meta.url)),
}
const maxWorkers = Math.min(4, availableParallelism())
const exclude = ['**/node_modules/**', '**/dist/**', '.corpus-open/**', '.tck/**']

export default defineConfig({
  resolve: { alias },
  test: {
    testTimeout: 120_000,
    // pool=forks keeps process.cpuUsage() of the timing tests per test file; fewer workers than cores keep the main
    // process able to answer their RPC (`Timeout calling "onTaskUpdate"`) on a busy machine
    pool: 'forks',
    // the schema of the ASG is fetched here, asynchronously: a synchronous `git fetch` in a worker blocks its event
    // loop for minutes on a slow network
    // the temp files of the run live in one folder that is removed at the end
    globalSetup: ['quality/tmp-global-setup.ts', 'quality/asg/global-setup.ts'],
    // 4 as before, but never more than the machine has cores (a machine with 2 cores would starve the main process)
    maxWorkers,
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          include: ['packages/core/test/**/*.test.ts', 'packages/html/test/**/*.test.ts', 'quality/**/*.test.ts'],
          exclude,
        },
      },
      {
        // CodeMirror needs a DOM
        extends: true,
        test: {
          name: 'codemirror',
          environment: 'jsdom',
          setupFiles: ['packages/codemirror/test/setup.ts'],
          include: ['packages/codemirror/test/**/*.test.ts'],
          exclude,
        },
      },
      {
        // ProseMirror needs a DOM
        extends: true,
        test: {
          name: 'prosemirror',
          environment: 'jsdom',
          // a source editor of CodeMirror sits next to the visual one in some tests
          setupFiles: ['packages/codemirror/test/setup.ts'],
          include: ['packages/prosemirror/test/**/*.test.ts'],
          exclude,
        },
      },
      {
        // the page of the demo runs on a DOM as well
        extends: true,
        test: {
          name: 'demo',
          environment: 'jsdom',
          setupFiles: ['packages/codemirror/test/setup.ts'],
          include: ['demo/test/*.test.ts'],
          // the build runs in Node, below
          exclude: [...exclude, 'demo/test/build.test.ts'],
        },
      },
      {
        // the host of the extension runs in Node, on a stand-in for the module `vscode`
        extends: true,
        test: { name: 'vscode-host', include: ['packages/vscode/test/host/**/*.test.ts'], exclude },
        resolve: { alias: { vscode: fileURLToPath(new URL('./packages/vscode/test/host/fake-vscode.ts', import.meta.url)) } },
      },
      {
        // the components of React run on a DOM
        extends: true,
        test: {
          name: 'react',
          environment: 'jsdom',
          setupFiles: ['packages/codemirror/test/setup.ts'],
          include: ['packages/react/test/**/*.test.tsx'],
          exclude,
        },
        esbuild: { jsx: 'automatic' },
      },
      {
        // the page of a tab runs on a DOM
        extends: true,
        test: {
          name: 'vscode-webview',
          environment: 'jsdom',
          setupFiles: ['packages/codemirror/test/setup.ts'],
          include: ['packages/vscode/test/webview/**/*.test.{ts,tsx}'],
          exclude,
        },
        esbuild: { jsx: 'automatic' },
      },
      {
        // the build of the page runs in Node
        extends: true,
        test: { name: 'demo-build', include: ['demo/test/build.test.ts'], exclude },
      },
    ],
  },
})
