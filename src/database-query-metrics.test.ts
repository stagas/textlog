import { Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'
import { formatQueryMetrics, measuredDatabase } from './database-query-metrics'

test('query metrics aggregate statement executions without logging bindings', () => {
  const primary = new Database(':memory:', { strict: true })
  primary.run('CREATE TABLE notes(id INTEGER PRIMARY KEY, body TEXT)')
  const measurement = measuredDatabase(primary)
  const insert = measurement.database.query('INSERT INTO notes(body) VALUES(?)')
  insert.run('private first value')
  insert.run('private second value')
  measurement.database.query('SELECT body FROM notes ORDER BY id').all()

  const lines = formatQueryMetrics('feeds.latestPage', measurement.metrics, 0, 10)
  expect(lines).toHaveLength(2)
  expect(lines.join('\n')).toContain('operation=feeds.latestPage')
  expect(lines.join('\n')).toContain('count=2')
  expect(lines.join('\n')).toContain('INSERT INTO notes(body) VALUES(?)')
  expect(lines.join('\n')).not.toContain('private first value')
  primary.close()
})

test('query metrics rank by total execution time and honor the result limit', () => {
  const metrics = new Map([
    ['fast', { count: 1, maxMs: 2, sql: 'fast', totalMs: 2 }],
    ['slow', { count: 2, maxMs: 4, sql: 'slow', totalMs: 7 }],
  ])
  expect(formatQueryMetrics('feeds.personalizedPage', metrics, 0, 1)[0]).toContain('sql="slow"')
  expect(formatQueryMetrics('feeds.personalizedPage', metrics, 8, 10)).toEqual([])
})
