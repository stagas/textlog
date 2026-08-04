import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import { recordVisit, visitorHash } from './visitors'

function testDatabase() {
  const database = new Database(':memory:')
  database.run(`CREATE TABLE daily_visitors (
    day TEXT NOT NULL,
    visitor_hash TEXT NOT NULL,
    PRIMARY KEY(day,visitor_hash)
  )`)
  return database
}

describe('visitor analytics', () => {
  test('stores only a hash and deduplicates a visitor within a day', () => {
    const database = testDatabase()
    const visitedAt = new Date('2026-08-04T01:00:00Z')
    recordVisit(database, '203.0.113.4', visitedAt)
    recordVisit(database, '203.0.113.4', new Date('2026-08-04T23:00:00Z'))

    expect(database.query('SELECT * FROM daily_visitors').all()).toEqual([{
      day: '2026-08-04',
      visitor_hash: visitorHash('203.0.113.4', visitedAt),
    }])
    expect(visitorHash('203.0.113.4', visitedAt)).not.toContain('203.0.113.4')
  })

  test('records the same visitor again on a new day', () => {
    const database = testDatabase()
    recordVisit(database, '203.0.113.4', new Date('2026-08-03T23:59:59Z'))
    recordVisit(database, '203.0.113.4', new Date('2026-08-04T00:00:00Z'))

    expect(database.query('SELECT * FROM daily_visitors').all()).toHaveLength(2)
    const rows = database.query('SELECT visitor_hash FROM daily_visitors ORDER BY day').all() as {
      visitor_hash: string
    }[]
    expect(rows[0].visitor_hash).not.toBe(rows[1].visitor_hash)
  })

  test('removes visitor pseudonyms after seven days', () => {
    const database = testDatabase()
    recordVisit(database, '203.0.113.4', new Date('2026-08-01T12:00:00Z'))
    recordVisit(database, '203.0.113.5', new Date('2026-08-08T12:00:00Z'))
    expect(database.query('SELECT day FROM daily_visitors').all()).toEqual([{ day: '2026-08-08' }])
  })
})
