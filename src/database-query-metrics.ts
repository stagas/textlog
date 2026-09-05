import type { Database } from 'bun:sqlite'
import { DATABASE_IDENTITY } from './database-identity'

type QueryMetric = {
  count: number
  maxMs: number
  sql: string
  totalMs: number
}

function normalizedSql(sql: string) {
  const normalized = sql.replace(/\s+/g, ' ').trim()
  return normalized.length > 240 ? `${normalized.slice(0, 237)}...` : normalized
}

/** Wrap a connection for one domain operation, timing statement execution without recording bindings. */
export function measuredDatabase(database: Database) {
  const metrics = new Map<string, QueryMetric>()

  const record = <T>(sql: string, execute: () => T) => {
    const started = performance.now()
    try {
      return execute()
    }
    finally {
      const durationMs = performance.now() - started
      const key = normalizedSql(sql)
      const metric = metrics.get(key) || { count: 0, maxMs: 0, sql: key, totalMs: 0 }
      metric.count++
      metric.totalMs += durationMs
      metric.maxMs = Math.max(metric.maxMs, durationMs)
      metrics.set(key, metric)
    }
  }

  const wrapStatement = (statement: object, sql: string) =>
    new Proxy(statement, {
      get(target, property) {
        const value = Reflect.get(target, property, target)
        if (typeof value !== 'function') return value
        if (property === 'all' || property === 'get' || property === 'run' || property === 'values') {
          return (...parameters: unknown[]) => record(sql, () => Reflect.apply(value, target, parameters))
        }
        return value.bind(target)
      },
    })

  const measured = new Proxy(database, {
    get(target, property) {
      if (property === DATABASE_IDENTITY) return target
      if (property === 'query' || property === 'prepare') {
        return (sql: string, ...parameters: unknown[]) => {
          const statement = Reflect.apply(Reflect.get(target, property, target), target, [sql, ...parameters])
          return wrapStatement(statement, sql)
        }
      }
      if (property === 'run' || property === 'exec') {
        const execute = Reflect.get(target, property, target)
        return (sql: string, ...parameters: unknown[]) =>
          record(sql, () => Reflect.apply(execute, target, [sql, ...parameters]))
      }
      const value = Reflect.get(target, property, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  }) as Database

  return { database: measured, metrics }
}

export function formatQueryMetrics(operation: string, metrics: Map<string, QueryMetric>, minimumMs = 1, limit = 10) {
  return [...metrics.values()]
    .filter(metric => metric.totalMs >= minimumMs)
    .sort((left, right) => right.totalMs - left.totalMs)
    .slice(0, limit)
    .map((metric, index) =>
      `feed_query operation=${operation} rank=${index + 1} count=${metric.count}`
      + ` total_ms=${metric.totalMs.toFixed(1)} max_ms=${metric.maxMs.toFixed(1)} sql=${JSON.stringify(metric.sql)}`
    )
}
