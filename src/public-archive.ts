import type { Database } from 'bun:sqlite'
import JSZip from 'jszip'
import { createWriteStream, mkdirSync, renameSync, statSync } from 'node:fs'
import { dirname } from 'node:path'
import { Readable } from 'node:stream'
import { finished } from 'node:stream/promises'

export const PUBLIC_ARCHIVE_CHECK_INTERVAL_MS = 60 * 60 * 1000

type ArchiveConfiguration = { path: string; pageSize?: number }

function json(value: unknown) {
  return `${JSON.stringify(value, null, 2)}\n`
}

export async function createPublicArchive(database: Database, path: string, now = new Date(), pageSize = 1000) {
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 10_000) {
    throw new Error('public archive page size must be an integer from 1 to 10000')
  }
  // This is intentionally an allowlist. Never export whole rows: the source tables also contain
  // email addresses, password hashes, moderation state, blocks, tokens, and other private data.
  const generatedAt = now.toISOString()
  const zip = new JSZip()
  const datasets: { name: string; count: number; pages: number }[] = []
  const addPages = (name: string, countSql: string, pageSql: string) => {
    const count = Number((database.query(countSql).get() as { count: number }).count)
    const pages = Math.ceil(count / pageSize)
    datasets.push({ name, count, pages })
    const query = database.query(pageSql)
    for (let page = 0; page < pages; page++) {
      const stream = Readable.from((async function* () {
        // The query is deferred until JSZip requests this file, keeping only one page resident.
        // Yield bytes explicitly: JSZip's Node stream adapter treats string chunks as binary and
        // otherwise writes code points U+0080–U+00FF as invalid single-byte UTF-8.
        yield Buffer.from(json(query.all(pageSize, page * pageSize)), 'utf8')
      })())
      zip.file(`${name}/${String(page + 1).padStart(6, '0')}.json`, stream)
    }
  }

  const activeUsers = 'deleted_at IS NULL AND suspended_at IS NULL'
  addPages('users', `SELECT count(*) AS count FROM users WHERE ${activeUsers}`,
    `SELECT handle,bio FROM users WHERE ${activeUsers}
      ORDER BY handle COLLATE NOCASE LIMIT ? OFFSET ?`)
  addPages('posts', `SELECT count(*) AS count FROM posts p JOIN users u ON u.id=p.user_id
      WHERE p.deleted_at IS NULL AND u.deleted_at IS NULL AND u.suspended_at IS NULL`,
    `SELECT 'post-' || p.id AS id,u.handle AS author,
      CASE WHEN parent.deleted_at IS NULL AND parent_user.deleted_at IS NULL
        AND parent_user.suspended_at IS NULL THEN 'post-' || p.parent_id ELSE NULL END AS reply_to,
      p.body FROM posts p JOIN users u ON u.id=p.user_id
      LEFT JOIN posts parent ON parent.id=p.parent_id LEFT JOIN users parent_user ON parent_user.id=parent.user_id
      WHERE p.deleted_at IS NULL AND u.deleted_at IS NULL AND u.suspended_at IS NULL
      ORDER BY p.created_at,p.id LIMIT ? OFFSET ?`)
  addPages('hashtags', `SELECT count(*) AS count FROM post_hashtags ph JOIN posts p ON p.id=ph.post_id
      JOIN users u ON u.id=p.user_id WHERE p.deleted_at IS NULL AND u.deleted_at IS NULL AND u.suspended_at IS NULL`,
    `SELECT 'post-' || ph.post_id AS post,ph.tag FROM post_hashtags ph JOIN posts p ON p.id=ph.post_id
      JOIN users u ON u.id=p.user_id WHERE p.deleted_at IS NULL AND u.deleted_at IS NULL AND u.suspended_at IS NULL
      ORDER BY ph.post_id,ph.tag LIMIT ? OFFSET ?`)
  addPages('mentions', `SELECT count(*) AS count FROM post_mentions pm JOIN posts p ON p.id=pm.post_id
      JOIN users author ON author.id=p.user_id JOIN users mentioned ON mentioned.id=pm.user_id
      WHERE p.deleted_at IS NULL AND author.deleted_at IS NULL AND author.suspended_at IS NULL
        AND mentioned.deleted_at IS NULL AND mentioned.suspended_at IS NULL`,
    `SELECT 'post-' || pm.post_id AS post,mentioned.handle FROM post_mentions pm JOIN posts p ON p.id=pm.post_id
      JOIN users author ON author.id=p.user_id JOIN users mentioned ON mentioned.id=pm.user_id
      WHERE p.deleted_at IS NULL AND author.deleted_at IS NULL AND author.suspended_at IS NULL
        AND mentioned.deleted_at IS NULL AND mentioned.suspended_at IS NULL
      ORDER BY pm.post_id,mentioned.handle COLLATE NOCASE LIMIT ? OFFSET ?`)
  addPages('follows', `SELECT count(*) AS count FROM follows f JOIN users follower ON follower.id=f.follower_id
      JOIN users following ON following.id=f.following_id WHERE follower.deleted_at IS NULL
        AND follower.suspended_at IS NULL AND following.deleted_at IS NULL AND following.suspended_at IS NULL`,
    `SELECT follower.handle AS follower,following.handle AS following FROM follows f
      JOIN users follower ON follower.id=f.follower_id JOIN users following ON following.id=f.following_id
      WHERE follower.deleted_at IS NULL AND follower.suspended_at IS NULL
        AND following.deleted_at IS NULL AND following.suspended_at IS NULL
      ORDER BY follower.handle COLLATE NOCASE,following.handle COLLATE NOCASE LIMIT ? OFFSET ?`)
  addPages('followed-hashtags', `SELECT count(*) AS count FROM hashtag_follows h JOIN users u ON u.id=h.user_id
      WHERE u.deleted_at IS NULL AND u.suspended_at IS NULL`,
    `SELECT u.handle AS user,h.tag FROM hashtag_follows h JOIN users u ON u.id=h.user_id
      WHERE u.deleted_at IS NULL AND u.suspended_at IS NULL
      ORDER BY u.handle COLLATE NOCASE,h.tag LIMIT ? OFFSET ?`)
  zip.file('manifest.json', json({ format: 'textlog-public-archive', version: 1, generated_at: generatedAt,
    page_size: pageSize, datasets,
    privacy: 'Public handles and public content only. Accounts are frozen and contain no authentication data.' }))

  mkdirSync(dirname(path), { recursive: true, mode: 0o755 })
  const temporaryPath = `${path}.${process.pid}.tmp`
  const output = createWriteStream(temporaryPath, { mode: 0o644 })
  zip.generateNodeStream({ streamFiles: true, compression: 'DEFLATE', compressionOptions: { level: 9 } })
    .pipe(output)
  await finished(output)
  renameSync(temporaryPath, path)
  const counts = Object.fromEntries(datasets.map(dataset => [dataset.name, dataset.count]))
  return { path, generatedAt, users: counts.users, posts: counts.posts, bytes: statSync(path).size }
}

export function startPublicArchive(database: Database, configuration: ArchiveConfiguration) {
  let running = false
  let archivedDay: string | null = null
  const run = async () => {
    const now = new Date()
    const day = now.toISOString().slice(0, 10)
    if (running || archivedDay === day) return
    running = true
    try {
      const result = await createPublicArchive(database, configuration.path, now, configuration.pageSize)
      archivedDay = day
      console.log(`public archive    ${result.path}`)
    }
    catch (error) {
      console.error('public archive generation failed', error)
    }
    finally {
      running = false
    }
  }
  void run()
  const timer = setInterval(run, PUBLIC_ARCHIVE_CHECK_INTERVAL_MS)
  timer.unref()
  return () => clearInterval(timer)
}
