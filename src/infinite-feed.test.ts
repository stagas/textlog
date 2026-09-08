import { describe, expect, test } from 'bun:test'
import { feedChunk, feedChunkReturnPath, restoredFeedChunks } from './components/infinite-feed'

describe('progressive feed chunks', () => {
  test('validates internal fragment indexes', () => {
    expect(feedChunk()).toBe(0)
    expect(feedChunk('1')).toBe(1)
    expect(feedChunk('4')).toBe(4)
    expect(feedChunk('5')).toBeNull()
    expect(restoredFeedChunks('3')).toBe(3)
    expect(restoredFeedChunks('6')).toBeNull()
  })

  test('carries the visible one-based chunk in return paths', () => {
    expect(feedChunkReturnPath('/all?page=2#post-3', 2)).toBe('/all?page=2&chunk=3#post-3')
    expect(feedChunkReturnPath('/any?seed=abc', 4)).toBe('/any?seed=abc&chunk=5')
    expect(feedChunkReturnPath('/all', 0)).toBe('/all')
  })
})
