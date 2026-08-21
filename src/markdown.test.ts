import { describe, expect, test } from 'bun:test'
import { markdownPlainText, sanitizedMarkdownHtml } from './markdown'

describe('markdown', () => {
  test('renders GFM strikethrough and preserves its text in plain-text output', () => {
    expect(sanitizedMarkdownHtml('Keep ~~remove~~ revise')).toBe('<p>Keep <del>remove</del> revise</p>')
    expect(markdownPlainText('Keep ~~remove~~ revise')).toBe('Keep remove revise')
  })
})
