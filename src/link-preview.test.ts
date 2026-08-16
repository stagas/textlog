import { describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { isDirectImageUrl, openGraphImage, openGraphMetadata } from './link-preview'
import { discoverLinkPreviews } from './link-preview'

describe('link previews', () => {
  test('recognizes direct image links with queries case-insensitively', () => {
    expect(isDirectImageUrl('https://cdn.example.com/photo.JPG?size=large')).toBe(true)
    expect(isDirectImageUrl('https://cdn.example.com/animation.gif')).toBe(true)
    expect(isDirectImageUrl('https://example.com/image')).toBe(false)
  })

  test('reads an Open Graph image regardless of attribute order and resolves relative URLs', () => {
    expect(openGraphImage(
      '<html><head><meta content="/images/card.jpg?x=1&amp;y=2" property="og:image"></head></html>',
      'https://example.com/articles/one',
    )).toBe('https://example.com/images/card.jpg?x=1&y=2')
  })

  test('ignores unrelated metadata', () => {
    expect(openGraphImage('<meta name="twitter:image" content="https://example.com/card.jpg">',
      'https://example.com/')).toBeNull()
  })

  test('reads the title, description, and site name for a card', () => {
    expect(openGraphMetadata(`<meta property="og:title" content="A title">
      <meta property="og:description" content="A useful description">
      <meta property="og:site_name" content="Example">
      <meta property="og:image:width" content="1200">
      <meta property="og:image:height" content="630">
      <meta property="og:image" content="https://example.com/card.jpg">`, 'https://example.com/')).toEqual({
      imageUrl: 'https://example.com/card.jpg',
      title: 'A title',
      description: 'A useful description',
      siteName: 'Example',
      imageWidth: 1200,
      imageHeight: 630,
    })
  })

  test('builds local post previews without fetching localhost', async () => {
    const previous = Bun.env.APP_URL
    Bun.env.APP_URL = 'http://localhost:3000'
    const database = new Database(':memory:')
    database.run(`CREATE TABLE users(id INTEGER PRIMARY KEY,handle TEXT,deleted_at TEXT,suspended_at TEXT);
      CREATE TABLE posts(id INTEGER PRIMARY KEY,user_id INTEGER,body TEXT,deleted_at TEXT);
      INSERT INTO users(id,handle) VALUES(1,'writer');
      INSERT INTO posts(id,user_id,body) VALUES(12,1,'A local post worth sharing');`)
    try {
      expect(await discoverLinkPreviews('http://localhost:3000/post/12', database)).toEqual([{
        url: 'http://localhost:3000/post/12',
        imageUrl: 'http://localhost:3000/post/12/og.png?v=2',
        title: 'A local post worth sharing',
        description: 'A local post worth sharing',
        siteName: 'textlog',
        imageWidth: 1200,
        imageHeight: 630,
      }])
    }
    finally {
      database.close()
      Bun.env.APP_URL = previous
    }
  })
})
