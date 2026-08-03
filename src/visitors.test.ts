import { describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
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
    recordVisit(database, '203.0.113.4', new Date('2026-08-04T01:00:00Z'))
    recordVisit(database, '203.0.113.4', new Date('2026-08-04T23:00:00Z'))

    expect(database.query('SELECT * FROM daily_visitors').all()).toEqual([{
      day: '2026-08-04',
      visitor_hash: visitorHash('203.0.113.4'),
    }])
    expect(visitorHash('203.0.113.4')).not.toContain('203.0.113.4')
  })

  test('records the same visitor again on a new day', () => {
    const database = testDatabase()
    recordVisit(database, '203.0.113.4', new Date('2026-08-03T23:59:59Z'))
    recordVisit(database, '203.0.113.4', new Date('2026-08-04T00:00:00Z'))

    expect(database.query('SELECT * FROM daily_visitors').all()).toHaveLength(2)
  })
})
