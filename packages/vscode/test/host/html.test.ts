import { describe, expect, it } from 'vitest'
import { makeNonce } from '../../src/host/html.js'

describe('makeNonce', () => {
  it('is a long random string safe for a CSP nonce and for an attribute', () => {
    const seen = new Set(Array.from({ length: 200 }, makeNonce))
    expect(seen.size).toBe(200)
    for (const n of seen) expect(n).toMatch(/^[A-Za-z0-9_-]{32,}$/)
  })
})
