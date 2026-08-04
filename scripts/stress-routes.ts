import { Database } from 'bun:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runMigrations } from '../src/migrations'

type Result = { route: string; concurrency: number; durationSeconds: number; requests: number;
  successfulRequests: number; errors: number; requestsPerSecond: number; successfulRequestsPerSecond: number;
  mebibytesPerSecond: number; latencyMs: { mean: number; p50: number; p95: number; p99: number; maximum: number };
  statusCodes: Record<string, number> }

const numberArgument = (name: string, fallback: number, minimum: number, maximum: number) => {
  const raw = Bun.argv.slice(2).find(value => value.startsWith(`--${name}=`))?.split('=')[1]
  const value = raw === undefined ? fallback : Number(raw)
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`--${name} must be between ${minimum} and ${maximum}`)
  }
  return Math.round(value)
}
const listArgument = (name: string, fallback: string) =>
  Bun.argv.slice(2).find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3) || fallback
const rounded = (value: number) => Math.round(value * 100) / 100
function percentile(sorted: number[], fraction: number) {
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)] : 0
}

function reservePort() {
  const reservation = Bun.serve({ port: 0, fetch: () => new Response('reserved') })
  const port = reservation.port
  reservation.stop(true)
  return port
}

function seedDatabase(path: string, users: number, posts: number) {
  const database = new Database(path, { create: true, strict: true })
  database.run('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA synchronous=NORMAL')
  runMigrations(database)
  const insertUser = database.query('INSERT INTO users(handle,email,bio,password) VALUES(?,?,?,?) RETURNING id')
  const insertPost = database.query('INSERT INTO posts(user_id,parent_id,body,created_at) VALUES(?,?,?,?) RETURNING id')
  const userIds: number[] = []
  const postIds: number[] = []
  database.transaction(() => {
    for (let index = 0; index < users; index++) {
      userIds.push((insertUser.get(`stress_${String(index + 1).padStart(5, '0')}`,
        `stress_${index + 1}@example.test`, 'Disposable route benchmark account', 'not-a-login-password') as { id: number }).id)
    }
    for (let index = 0; index < posts; index++) {
      const parentId = index > 20 && index % 11 === 0 ? postIds[index - 11] : null
      const createdAt = new Date(Date.now() - (posts - index) * 15_000).toISOString().slice(0, 19).replace('T', ' ')
      postIds.push((insertPost.get(userIds[index % userIds.length], parentId,
        `Offline benchmark post ${index + 1}: representative text for server-side feed rendering. #stress`,
        createdAt) as { id: number }).id)
    }
  })()
  database.run('ANALYZE')
  database.query('PRAGMA wal_checkpoint(TRUNCATE)').get()
  database.close()
}

async function waitForServer(origin: string, process: Bun.Subprocess) {
  const deadline = performance.now() + 15_000
  while (performance.now() < deadline) {
    if (process.exitCode !== null) throw new Error(`benchmark server exited with code ${process.exitCode}`)
    try { if ((await fetch(`${origin}/health`)).ok) return }
    catch {}
    await Bun.sleep(50)
  }
  throw new Error('benchmark server did not become ready within 15 seconds')
}

async function benchmark(origin: string, route: string, concurrency: number, durationMs: number): Promise<Result> {
  for (let index = 0; index < Math.min(concurrency, 10); index++) {
    const response = await fetch(origin + route)
    await response.arrayBuffer()
    if (!response.ok) throw new Error(`warm-up ${route} returned HTTP ${response.status}`)
  }
  const latencies: number[] = []
  const statuses: Record<string, number> = {}
  let bytes = 0, errors = 0, successful = 0
  const startsAt = performance.now() + 100
  const endsAt = startsAt + durationMs
  const worker = async () => {
    while (performance.now() < startsAt) await Bun.sleep(1)
    while (performance.now() < endsAt) {
      const started = performance.now()
      try {
        const response = await fetch(origin + route)
        bytes += (await response.arrayBuffer()).byteLength
        latencies.push(performance.now() - started)
        statuses[response.status] = (statuses[response.status] || 0) + 1
        if (response.ok) successful++; else errors++
      }
      catch { latencies.push(performance.now() - started); errors++ }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker))
  const elapsedSeconds = (performance.now() - startsAt) / 1000
  latencies.sort((a, b) => a - b)
  const requests = latencies.length
  return { route, concurrency, durationSeconds: rounded(elapsedSeconds), requests, successfulRequests: successful, errors,
    requestsPerSecond: rounded(requests / elapsedSeconds), successfulRequestsPerSecond: rounded(successful / elapsedSeconds),
    mebibytesPerSecond: rounded(bytes / elapsedSeconds / 1024 / 1024), latencyMs: {
      mean: rounded(latencies.reduce((sum, value) => sum + value, 0) / Math.max(1, requests)),
      p50: rounded(percentile(latencies, .5)), p95: rounded(percentile(latencies, .95)),
      p99: rounded(percentile(latencies, .99)), maximum: rounded(latencies.at(-1) || 0),
    }, statusCodes: statuses }
}

if (Bun.argv.includes('--help')) {
  console.log(`Usage: bun run stress:routes -- [options]\n\nOptions:\n  --users=N          Seed users (default 200, max 10000)\n  --posts=N          Seed posts (default 10000, max 1000000)\n  --duration=N       Seconds per route/concurrency run (default 5, max 300)\n  --concurrency=LIST Concurrent clients, e.g. 1,10,25,50 (default 1,10,25)\n  --routes=LIST      Routes to test (default /hot,/latest)\n  --p95-target=N     Sustainable-capacity p95 threshold in ms (default 250)\n  --json             Emit machine-readable JSON only`)
  process.exit(0)
}

const users = numberArgument('users', 200, 1, 10_000)
const posts = numberArgument('posts', 10_000, 1, 1_000_000)
const durationSeconds = numberArgument('duration', 5, 1, 300)
const p95TargetMs = numberArgument('p95-target', 250, 1, 60_000)
const concurrencies = [...new Set(listArgument('concurrency', '1,10,25').split(',').map(Number))]
if (concurrencies.some(value => !Number.isInteger(value) || value < 1 || value > 1000)) throw new Error('--concurrency values must be integers from 1 to 1000')
const routes = [...new Set(listArgument('routes', '/hot,/latest').split(',').map(value => value.trim()))]
if (routes.some(route => !route.startsWith('/') || route.startsWith('//'))) throw new Error('--routes values must begin with one /')

const directory = mkdtempSync(join(tmpdir(), 'root-mx-routes-'))
const databasePath = join(directory, 'stress.sqlite')
const port = reservePort()
const origin = `http://127.0.0.1:${port}`
let server: Bun.Subprocess | undefined
try {
  if (!Bun.argv.includes('--json')) console.log(`Seeding disposable database with ${users} users and ${posts} posts...`)
  seedDatabase(databasePath, users, posts)
  server = Bun.spawn([process.execPath, 'src/server.tsx'], { cwd: join(import.meta.dir, '..'), env: { ...process.env,
    NODE_ENV: 'test', DEV_RELOAD: 'false', HOST: '127.0.0.1', PORT: String(port), DATABASE_PATH: databasePath,
    DATABASE_BACKUP_DIR: join(directory, 'backups'), MODERATION_DISABLED: 'true', LOG_COLOR: 'false',
    IP_PSEUDONYM_SECRET: 'offline-stress-test-secret-not-for-production' }, stdout: 'ignore', stderr: 'inherit' })
  await waitForServer(origin, server)
  const results: Result[] = []
  for (const route of routes) for (const concurrency of concurrencies) {
    if (!Bun.argv.includes('--json')) process.stdout.write(`Testing ${route} with ${concurrency} clients... `)
    const result = await benchmark(origin, route, concurrency, durationSeconds * 1000)
    results.push(result)
    if (!Bun.argv.includes('--json')) console.log(`${result.requestsPerSecond} req/s, p95 ${result.latencyMs.p95} ms`)
  }
  const sustainable = Object.fromEntries(routes.map(route => {
    const best = results.filter(result => result.route === route && !result.errors && result.latencyMs.p95 <= p95TargetMs)
      .sort((a, b) => b.concurrency - a.concurrency)[0]
    return [route, best ? { testedConcurrentClients: best.concurrency, requestsPerSecond: best.successfulRequestsPerSecond,
      p95Ms: best.latencyMs.p95 } : null]
  }))
  const report = { generatedAt: new Date().toISOString(), dataset: { users, posts },
    target: { p95Ms: p95TargetMs, zeroErrors: true },
    note: 'Concurrent clients are active request loops, not clients per second. Sustainable values are bounded by the tested concurrency levels.',
    sustainable, results }
  if (!Bun.argv.includes('--json')) {
    console.log('\nSustainable capacity observed (zero errors and p95 within target):')
    for (const [route, value] of Object.entries(sustainable)) console.log(`  ${route}: ${value ? `${value.testedConcurrentClients} concurrent clients, ${value.requestsPerSecond} req/s at p95 ${value.p95Ms} ms` : 'not reached in tested levels'}`)
    console.log('\nFull report:')
  }
  console.log(JSON.stringify(report, null, 2))
}
finally {
  if (server && server.exitCode === null) server.kill()
  if (server) await server.exited
  rmSync(directory, { recursive: true, force: true })
}
