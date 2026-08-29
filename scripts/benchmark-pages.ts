import { Database } from 'bun:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sessionCookieName } from '../src/brand'
import { runMigrations } from '../src/migrations'
import { insertSession } from '../src/sessions'

type Sample = { cache: string; bytes: number; milliseconds: number; status: number }
type Scenario = { identity: 'anonymous' | 'signed-in'; name: string; path: string }

const argument = (name: string, fallback: number) => {
  const raw = Bun.argv.slice(2).find(value => value.startsWith(`--${name}=`))?.split('=')[1]
  const value = raw == null ? fallback : Number(raw)
  if (!Number.isInteger(value) || value < 1) throw new Error(`--${name} must be a positive integer`)
  return value
}
const listArgument = (name: string) => Bun.argv.slice(2)
  .find(value => value.startsWith(`--${name}=`))?.split('=')[1]?.split(',').filter(Boolean)
const percentile = (values: number[], fraction: number) =>
  values[Math.min(values.length - 1, Math.ceil(values.length * fraction) - 1)] || 0
const round = (value: number) => Math.round(value * 100) / 100

function reservePort() {
  const reservation = Bun.serve({ port: 0, fetch: () => new Response('reserved') })
  const port = reservation.port
  reservation.stop(true)
  return port
}

function seed(path: string, userCount: number, postCount: number, token: string) {
  const db = new Database(path, { create: true, strict: true })
  db.run('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA synchronous=NORMAL')
  runMigrations(db)
  const addUser = db.query(`INSERT INTO users(handle,email,bio,password,handle_chosen_at,email_verified_at)
    VALUES(?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) RETURNING id`)
  const addPost = db.query(`INSERT INTO posts(user_id,parent_id,body,created_at,has_latex,has_links,has_code)
    VALUES(?,?,?,?,0,0,0) RETURNING id`)
  const users: number[] = []
  const posts: number[] = []
  db.transaction(() => {
    for (let index = 0; index < userCount; index++) {
      users.push((addUser.get(`bench_${String(index + 1).padStart(4, '0')}`, `bench-${index + 1}@example.test`,
        `Benchmark profile ${index + 1} with representative biography text.`, 'disabled') as { id: number }).id)
    }
    for (const followed of users.slice(1, Math.min(users.length, 31))) {
      db.query(`INSERT OR IGNORE INTO follows(follower_id,following_id,created_at)
        VALUES(?,?,datetime('now','-1 day'))`).run(users[0], followed)
    }
    for (let index = 0; index < postCount; index++) {
      const author = users[index % users.length]
      const parent = index > 10 && index % 7 === 0 ? posts[Math.max(0, index - 7)] : null
      const created = new Date(Date.now() - (postCount - index) * 10_000).toISOString().slice(0, 19).replace('T', ' ')
      posts.push((addPost.get(author, parent,
        `Benchmark note ${index + 1} with **formatted text**, #performance, and https://example.test/${index + 1}.`,
        created) as { id: number }).id)
    }
    const readThrough = posts[Math.max(0, posts.length - 21)] || 0
    db.query(`INSERT INTO latest_read_state(user_id,through_post_id) VALUES(?,?)
      ON CONFLICT(user_id) DO UPDATE SET through_post_id=excluded.through_post_id`).run(users[0], readThrough)
    db.query(`INSERT OR IGNORE INTO for_you_reads(user_id,event_key)
      SELECT ?,'post:' || printf('%020d',post_id) FROM personalized_post_candidates
      WHERE viewer_id=? AND post_id<=?`).run(users[0], users[0], readThrough)
    db.query(`INSERT INTO notification_user_agents(user_id,user_agent,status) VALUES(?,?,'dismissed')`)
      .run(users[0], 'Page benchmark')
    db.query(`INSERT INTO appearance_user_agents(user_id,user_agent,status) VALUES(?,?,'seen')`)
      .run(users[0], 'Page benchmark')
    db.query('INSERT INTO invite_banner_dismissals(user_id) VALUES(?)').run(users[0])
    db.query('INSERT INTO donation_banner_dismissals(user_id) VALUES(?)').run(users[0])
  })()
  db.run('UPDATE post_hot SET score=1,score_updated_at=latest_activity_at')
  insertSession(db, token, users[0], Date.now() + 86_400_000, Date.now(), 'Page benchmark')
  db.run('ANALYZE')
  db.query('PRAGMA wal_checkpoint(TRUNCATE)').get()
  db.close()
  return { handle: 'bench_0001', postId: posts.at(-1)! }
}

async function waitForServer(origin: string, server: Bun.Subprocess) {
  for (let attempt = 0; attempt < 300; attempt++) {
    if (server.exitCode !== null) throw new Error(`benchmark server exited with ${server.exitCode}`)
    try { if ((await fetch(origin + '/health')).ok) return }
    catch {}
    await Bun.sleep(50)
  }
  throw new Error('benchmark server did not become ready')
}

async function request(origin: string, scenario: Scenario, token: string, variant: string): Promise<Sample> {
  const cookie = `${scenario.identity === 'signed-in'
    ? `${sessionCookieName()}=${token}; notification_banner_dismissed=1; donation_banner_dismissed=1; `
    : ''}font=${variant}`
  const started = performance.now()
  const url = new URL(scenario.path, origin)
  url.searchParams.set('benchmark_variant', variant)
  const response = await fetch(url, {
    headers: { cookie, accept: 'text/html', 'user-agent': 'Page benchmark' }, redirect: 'manual',
  })
  const bytes = (await response.arrayBuffer()).byteLength
  return { cache: response.headers.get('x-feed-cache') || response.headers.get('x-page-cache') || '-', bytes,
    milliseconds: performance.now() - started, status: response.status }
}

function summarize(samples: Sample[]) {
  const timings = samples.map(sample => sample.milliseconds).sort((a, b) => a - b)
  return {
    requests: samples.length,
    latencyMs: { min: round(timings[0]), mean: round(timings.reduce((a, b) => a + b, 0) / timings.length),
      p50: round(percentile(timings, .5)), p95: round(percentile(timings, .95)),
      p99: round(percentile(timings, .99)), max: round(timings.at(-1)!) },
    meanBytes: Math.round(samples.reduce((sum, sample) => sum + sample.bytes, 0) / samples.length),
    statuses: Object.fromEntries([...new Set(samples.map(sample => sample.status))]
      .map(status => [status, samples.filter(sample => sample.status === status).length])),
    cacheOutcomes: Object.fromEntries([...new Set(samples.map(sample => sample.cache))]
      .map(cache => [cache, samples.filter(sample => sample.cache === cache).length])),
  }
}

if (Bun.argv.includes('--help')) {
  console.log(`Usage: bun run benchmark:pages -- [options]\n\n` +
    `  --users=N   Fixture users (default 100)\n  --posts=N   Fixture posts (default 2000)\n` +
    `  --miss=N    Unique-variant samples per page (default 10)\n` +
    `  --warm=N    Warm samples per page (default 50)\n` +
    `  --pages=LIST  Restrict pages, e.g. all,my-feed,post\n  --json      Print JSON only`)
  process.exit(0)
}

const users = argument('users', 100), posts = argument('posts', 2_000)
const missSamples = argument('miss', 10), warmSamples = argument('warm', 50)
const jsonOnly = Bun.argv.includes('--json')
const selectedPages = listArgument('pages')
const directory = mkdtempSync(join(tmpdir(), 'textlog-page-benchmark-'))
const databasePath = join(directory, 'benchmark.sqlite')
const cachePath = join(directory, 'benchmark.cache.sqlite')
const token = 'benchmark-session-token'
const fixture = seed(databasePath, users, posts, token)
const pages = [
  ['all', '/all'], ['my-feed', '/my-feed'], ['@', '/@'], ['hot', '/hot'],
  ['profile', `/u/${fixture.handle}`], ['post', `/post/${fixture.postId}`], ['explore', '/explore'],
] as const
const scenarios: Scenario[] = (['anonymous', 'signed-in'] as const).flatMap(identity => pages
  .filter(([name]) => !selectedPages || selectedPages.includes(name))
  .filter(([name]) => identity === 'signed-in' || !['my-feed', '@'].includes(name))
  .map(([name, path]) => ({ identity, name, path })))
const port = reservePort(), origin = `http://127.0.0.1:${port}`
let server: Bun.Subprocess | undefined
try {
  if (!jsonOnly) console.log(`Seeding ${users} users and ${posts} posts; benchmarking ${scenarios.length} pages...`)
  server = Bun.spawn([process.execPath, '--no-env-file', 'src/server.tsx'], { cwd: join(import.meta.dir, '..'),
    env: { ...process.env, NODE_ENV: 'test', DEV_RELOAD: 'false', ENABLE_MATERIALIZED_MEMORY_CACHE: 'true',
      HOST: '127.0.0.1', PORT: String(port), DATABASE_PATH: databasePath, CACHE_DATABASE_PATH: cachePath,
      DATABASE_BACKUP_DIR: join(directory, 'backups'), MODERATION_DISABLED: 'true', LOG_COLOR: 'false',
      LOG_ANONYMOUS: 'false', DISABLE_FEED_WARMING: 'true',
      IP_PSEUDONYM_SECRET: 'offline-page-benchmark-secret' }, stdout: 'ignore', stderr: 'inherit' })
  await waitForServer(origin, server)
  const results = []
  for (const scenario of scenarios) {
    const misses: Sample[] = []
    for (let index = 0; index < missSamples; index++) {
      misses.push(await request(origin, scenario, token, `benchmark-miss-${scenario.identity}-${scenario.name}-${index}`))
    }
    await request(origin, scenario, token, `benchmark-warm-${scenario.identity}-${scenario.name}`)
    // Personalized feeds perform their read-state action on the first cache hit, which intentionally invalidates
    // hydrated counters. Prime once more so the warm distribution measures the stable post-read state.
    await request(origin, scenario, token, `benchmark-warm-${scenario.identity}-${scenario.name}`)
    const warm: Sample[] = []
    for (let index = 0; index < warmSamples; index++) {
      warm.push(await request(origin, scenario, token, `benchmark-warm-${scenario.identity}-${scenario.name}`))
    }
    const result = { identity: scenario.identity, page: scenario.name, path: scenario.path,
      pageCacheMiss: summarize(misses), warm: summarize(warm) }
    results.push(result)
    if (!jsonOnly) console.log(`${scenario.identity.padEnd(9)} ${scenario.name.padEnd(8)} miss p50 ${
      result.pageCacheMiss.latencyMs.p50}ms p95 ${result.pageCacheMiss.latencyMs.p95}ms | warm p50 ${
      result.warm.latencyMs.p50}ms p95 ${result.warm.latencyMs.p95}ms`)
  }
  const report = { generatedAt: new Date().toISOString(), dataset: { users, posts }, samples: {
    pageCacheMiss: missSamples, warm: warmSamples },
    note: 'Page-cache misses use unique harmless query and rendering variants within one process; they retain reusable post fragments and therefore model steady production invalidation, not first-boot cold start.',
    results }
  console.log(JSON.stringify(report, null, 2))
}
finally {
  if (server && server.exitCode === null) server.kill()
  if (server) await server.exited
  rmSync(directory, { recursive: true, force: true })
}
