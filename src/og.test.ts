import { describe, expect, test } from 'bun:test'
import { postOgText, renderDefaultOg, renderPostOg, renderProfileOg, renderTagOg } from './og'

describe('renderPostOg', () => {
  test('renders markdown links as their label without the URL', () => {
    expect(postOgText('Read [the docs](https://example.com/docs) today')).toEqual({
      text: 'Read the docs today',
      links: [{ start: 5, end: 13 }],
    })
    expect(renderPostOg('Read [the docs](https://example.com/docs) today', 'tester')).not.toHaveLength(0)
  })
})

describe('renderProfileOg', () => {
  const counts = { notes: 12, following: 34, followingTags: 5, followers: 56 }

  test('renders a 1200 by 630 PNG', () => {
    const image = renderProfileOg('tester', 'A short bio about the profile owner.', counts)
    expect(image.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    expect(image.readUInt32BE(16)).toBe(1200)
    expect(image.readUInt32BE(20)).toBe(630)
  })

  test('renders empty and multiline bios', () => {
    expect(renderProfileOg('tester', '', counts)).not.toHaveLength(0)
    expect(renderProfileOg('tester', 'first line\nsecond line', counts)).not.toHaveLength(0)
  })
})

describe('renderTagOg', () => {
  test('renders a 1200 by 630 PNG', () => {
    const image = renderTagOg('typescript', 42)
    expect(image.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    expect(image.readUInt32BE(16)).toBe(1200)
    expect(image.readUInt32BE(20)).toBe(630)
  })
})

describe('renderDefaultOg', () => {
  test('renders a 1200 by 630 PNG', () => {
    const image = renderDefaultOg()
    expect(image.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    expect(image.readUInt32BE(16)).toBe(1200)
    expect(image.readUInt32BE(20)).toBe(630)
  })
})
