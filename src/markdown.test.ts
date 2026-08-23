import { describe, expect, test } from 'bun:test'
import { markdownPlainText, sanitizedMarkdownHtml } from './markdown'

describe('markdown', () => {
  test('renders GFM strikethrough and preserves its text in plain-text output', () => {
    expect(sanitizedMarkdownHtml('Keep ~~remove~~ revise')).toBe('<p>Keep <del>remove</del> revise</p>')
    expect(markdownPlainText('Keep ~~remove~~ revise')).toBe('Keep remove revise')
  })

  test('preserves Markdown image links as safe links', () => {
    const imageLink = '![https://ibb.co/WpfV1DbH](https://ibb.co/WpfV1DbH)'
    expect(sanitizedMarkdownHtml(imageLink))
      .toBe('<p><a href="https://ibb.co/WpfV1DbH">https://ibb.co/WpfV1DbH</a></p>')
    expect(markdownPlainText(imageLink)).toBe('https://ibb.co/WpfV1DbH')
  })
})
