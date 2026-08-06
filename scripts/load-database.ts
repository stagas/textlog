import { Database } from 'bun:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

type WorkerResult = { reads: number; writes: number; busyErrors: number; p95Ms: number; maximumMs: number }

function percentile(values: number[], fraction: number) {
  if (!values.length) return 0
  return values[Math.min(values.length - 1, Math.floor(values.length * fraction))]
}

function runWorker(path: string, operations: number): WorkerResult {
  const database = new Database(path)
  database.run('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000')
  const latencies: number[] = []
  let reads = 0
  let writes = 0
  let busyErrors = 0
  for (let index = 0; index < operations; index++) {
    const started = performance.now()
    try {
      if (index % 4 === 0) {
        database.transaction(() => {
          database.query('UPDATE counters SET value=value+1 WHERE id=1').run()
          database.query('INSERT INTO events(worker) VALUES(?)').run(process.pid)
        })()
        writes++
      }
      else {
        database.query('SELECT value,(SELECT count(*) FROM events) events FROM counters WHERE id=1').get()
        reads++
      }
    }
    catch (error) {
      if (String(error).includes('database is locked')) busyErrors++
      else throw error
    }
    latencies.push(performance.now() - started)
  }
  database.close()
  latencies.sort((a, b) => a - b)
  return {
    reads,
    writes,
    busyErrors,
    p95Ms: Math.round(percentile(latencies, 0.95) * 100) / 100,
    maximumMs: Math.round((latencies.at(-1) || 0) * 100) / 100,
  }
}

const args = Bun.argv.slice(2)
if (args[0] === '--worker') {
  console.log(JSON.stringify(runWorker(args[1], Number(args[2]))))
}
else {
  const workers = Math.max(1, Math.min(16, Number(args.find(value => value.startsWith('--workers='))?.split('=')[1]
    || 4)))
  const operations = Math.max(10, Math.min(100_000, Number(args.find(value =>
    value.startsWith('--operations=')
  )?.split('=')[1] || 1000)))
  const directory = mkdtempSync(join(tmpdir(), 'textlog-load-'))
  const path = join(directory, 'load.sqlite')
  try {
    const database = new Database(path, { create: true })
    database.run(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE counters(id INTEGER PRIMARY KEY,value INTEGER NOT NULL);
      INSERT INTO counters VALUES(1,0);
      CREATE TABLE events(id INTEGER PRIMARY KEY AUTOINCREMENT,worker INTEGER NOT NULL);`)
    database.close()
    const processes = Array.from({ length: workers }, () =>
      Bun.spawn(
        [process.execPath, import.meta.path, '--worker', path, String(operations)],
        { stdout: 'pipe', stderr: 'pipe' },
      ))
    const results = await Promise.all(processes.map(async process => {
      const output = await new Response(process.stdout).text()
      const error = await new Response(process.stderr).text()
      const exitCode = await process.exited
      if (exitCode !== 0) throw new Error(error || `Load-test worker exited ${exitCode}`)
      return JSON.parse(output.trim()) as WorkerResult
    }))
    const verification = new Database(path, { readonly: true })
    const final = verification.query('SELECT value,(SELECT count(*) FROM events) events FROM counters WHERE id=1')
      .get() as { value: number; events: number }
    verification.close()
    const summary = {
      workers,
      operationsPerWorker: operations,
      reads: results.reduce((sum, result) => sum + result.reads, 0),
      writes: results.reduce((sum, result) => sum + result.writes, 0),
      busyErrors: results.reduce((sum, result) => sum + result.busyErrors, 0),
      slowestWorkerP95Ms: Math.max(...results.map(result => result.p95Ms)),
      maximumOperationMs: Math.max(...results.map(result => result.maximumMs)),
      committedWrites: final.value,
      eventRows: final.events,
    }
    console.log(JSON.stringify(summary, null, 2))
    if (summary.busyErrors || summary.committedWrites !== summary.writes || summary.eventRows !== summary.writes) {
      process.exitCode = 1
    }
  }
  finally {
    rmSync(directory, { recursive: true, force: true })
  }
}
