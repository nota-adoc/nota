// the texts of the refusals exist in both languages, and the refusal about the byte order mark is told.
import { describe, expect, it } from 'vitest'
import { messages } from '@nota-adoc/react'

describe('the refusals of the editor', () => {
  it('have the same keys in Russian and in English', () => {
    expect(Object.keys(messages.ru.reject).sort()).toEqual(Object.keys(messages.en.reject).sort())
  })

  it('tell byte-order-mark in Russian', () => {
    expect(messages.ru.reject['byte-order-mark']).toMatch(/[А-Яа-яЁё]/)
    expect(messages.en.reject['byte-order-mark']).toMatch(/byte order mark/)
  })
})
