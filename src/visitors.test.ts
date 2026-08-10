import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import { VisitorBuffer, visitorHash, visitorStats } from './visitors'

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
    const buffer = new VisitorBuffer(database)
    buffer.record('203.0.113.4', visitedAt)
    buffer.record('203.0.113.4', new Date('2026-08-04T23:00:00Z'))
    expect(database.query('SELECT count(*) count FROM daily_visitors').get()).toEqual({ count: 0 })
    buffer.flush()

    expect(database.query('SELECT * FROM daily_visitors').all()).toEqual([{
      day: '2026-08-04',
      visitor_hash: visitorHash('203.0.113.4', visitedAt),
    }])
    expect(visitorHash('203.0.113.4', visitedAt)).not.toContain('203.0.113.4')
  })

  test('records the same visitor again on a new day', () => {
    const database = testDatabase()
    const buffer = new VisitorBuffer(database)
    buffer.record('203.0.113.4', new Date('2026-08-03T23:59:59Z'))
    buffer.record('203.0.113.4', new Date('2026-08-04T00:00:00Z'))
    buffer.flush()

    expect(database.query('SELECT * FROM daily_visitors').all()).toHaveLength(2)
    const rows = database.query('SELECT visitor_hash FROM daily_visitors ORDER BY day').all() as {
      visitor_hash: string
    }[]
    expect(rows[0].visitor_hash).not.toBe(rows[1].visitor_hash)
  })

  test('reports yesterday as a separate UTC calendar day', () => {
    const database = testDatabase()
    database.run(`INSERT INTO daily_visitors(day,visitor_hash) VALUES
      (date('now'),'today'),
      (date('now','-1 day'),'yesterday-1'),
      (date('now','-1 day'),'yesterday-2')`)

    expect(visitorStats(database)).toEqual({ visitorsToday: 1, visitorsYesterday: 2, visitors7d: 3 })
  })

  test('flushes in bounded batches', () => {
    const database = testDatabase()
    const buffer = new VisitorBuffer(database, 2)
    buffer.record('203.0.113.4', new Date('2026-08-08T12:00:00Z'))
    expect(buffer.size).toBe(1)
    buffer.record('203.0.113.5', new Date('2026-08-08T12:00:00Z'))
    expect(buffer.size).toBe(0)
    expect(database.query('SELECT day FROM daily_visitors').all()).toHaveLength(2)
  })
})
