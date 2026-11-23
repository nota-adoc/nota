import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', '.corpus-open/**', '.tck/**', '.quality-reports/**', 'coverage/**', '**/dist-e2e/**', '**/.vscode-test/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        console: 'readonly',
        process: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-constant-condition': ['error', { checkLoops: false }],
    },
  },
  {
    // the engine and the editor packages must stay platform-neutral: no Node built-ins
    files: ['packages/core/src/**/*.ts', 'packages/codemirror/src/**/*.ts', 'packages/prosemirror/src/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: ['node:*', 'fs', 'path', 'os', 'url', 'crypto'] }],
    },
  },
  {
    // the page of a tab runs in a browser, and nothing in the extension but the page may talk to the network
    files: ['packages/vscode/src/webview/**/*.{ts,tsx}', 'packages/react/src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', { patterns: ['node:*', 'fs', 'path', 'os', 'url', 'crypto', 'vscode'] }],
      'no-restricted-globals': ['error', 'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource'],
    },
  },
  {
    // the extension host has no business with the network either
    files: ['packages/vscode/src/host/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: ['node:http', 'node:https', 'node:net', 'http', 'https', 'net'] }],
      'no-restricted-globals': ['error', 'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource'],
    },
  },
)
