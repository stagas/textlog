import type { Database } from 'bun:sqlite'
import { appOrigin } from './brand'
import { discoverLinkPreviews, isDirectImageUrl, isYouTubeUrl, saveLinkPreviews,
  storeRemotePreviewImage, replaceBioLinkPreviews } from './link-preview'
import { deleteImagesAfterCommit, isImageKey } from './image-storage'
import { logError, logInfo } from './log'
import { postLinks } from './utils'

export const LINK_PREVIEW_BACKFILL_DELAY_MS = 2500
const R2_BACKFILL_STATUS_PREFIX = 'r2-backfill-'
const LEGACY_POST_OG_REFETCH_STATUS_PREFIXES = ['post-og-v3-refetch-', 'post-og-title-v2-refetch-']
const POST_OG_REFETCH_STATUS_PREFIX = 'post-og-title-v3-refetch-'

const wait = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds))

export async function runLinkPreviewBackfill(database: Database, options: {
  delayMs?: number
  log?: (message: string) => void
  directImagesOnly?: boolean
  youtubeOnly?: boolean
} = {}) {
  const delayMs = options.delayMs ?? LINK_PREVIEW_BACKFILL_DELAY_MS
  const log = options.log || console.log
  const rows = database.query('SELECT id,body FROM posts WHERE deleted_at IS NULL ORDER BY id')
    .all() as { id: number; body: string }[]
  const attempted = database.query(
    'SELECT status FROM post_link_preview_backfill_attempts WHERE post_id=? AND url=?',
  )
  const existing = database.query('SELECT image_url FROM post_link_previews WHERE post_id=? AND url=?')
  const record = database.query(`INSERT OR REPLACE INTO post_link_preview_backfill_attempts(post_id,url,status)
    VALUES(?,?,?)`)
  const pending = rows.flatMap(post => postLinks(post.body).map(url => ({ postId: post.id, url })))
    .filter(item => {
      if (options.youtubeOnly && !isYouTubeUrl(item.url)) return false
      const stored = existing.get(item.postId, item.url) as { image_url: string } | null
      if (stored && !isImageKey(stored.image_url)) {
        try {
          if (new URL(stored.image_url).origin !== appOrigin()) return true
        }
        catch {}
      }
      if (options.directImagesOnly && !isDirectImageUrl(item.url)) return false
      if (options.youtubeOnly) return true
      const previous = attempted.get(item.postId, item.url) as { status: string } | null
      if (previous) return isDirectImageUrl(item.url) && previous.status === 'no-preview'
      return !stored || !isImageKey(stored.image_url)
    })
  log(`link preview backfill start pending=${pending.length} delay=${delayMs}ms${
    options.directImagesOnly ? ' direct-images-only=true' : ''
  }${
    options.youtubeOnly ? ' youtube-only=true' : ''
  }`)
  let fetched = 0
  let saved = 0
  for (const item of pending) {
    const stored = existing.get(item.postId, item.url) as { image_url: string } | null
    if (stored && isImageKey(stored.image_url)) {
      record.run(item.postId, item.url, 'existing')
      log(`link preview backfill existing post=${item.postId} url=${item.url}`)
      continue
    }
    if (fetched) await wait(delayMs)
    log(`link preview backfill fetch post=${item.postId} url=${item.url}`)
    const previews = await discoverLinkPreviews(item.url, database)
    await saveLinkPreviews(database, item.postId, previews)
    const status = previews.length ? 'saved' : isDirectImageUrl(item.url) ? 'no-preview-direct' : 'no-preview'
    record.run(item.postId, item.url, status)
    fetched++
    if (previews.length) saved++
    log(`link preview backfill ${status} post=${item.postId} url=${item.url}`)
  }
  log(`link preview backfill complete fetched=${fetched} saved=${saved}`)
  return { pending: pending.length, fetched, saved }
}

export async function runBioLinkPreviewBackfill(database: Database, options: {
  delayMs?: number
  log?: (message: string) => void
} = {}) {
  const delayMs = options.delayMs ?? LINK_PREVIEW_BACKFILL_DELAY_MS
  const log = options.log || console.log
  const users = database.query(`SELECT id,bio FROM users
    WHERE deleted_at IS NULL AND trim(bio)!='' ORDER BY id`).all() as { id: number; bio: string }[]
  const attempted = database.query(
    'SELECT status FROM user_bio_link_preview_backfill_attempts WHERE user_id=? AND url=?',
  )
  const existing = database.query('SELECT image_url FROM user_bio_link_previews WHERE user_id=? AND url=?')
  const record = database.query(`INSERT OR REPLACE INTO user_bio_link_preview_backfill_attempts(user_id,url,status)
    VALUES(?,?,?)`)
  const pending = users.filter(user => postLinks(user.bio).some(url => {
    const previous = attempted.get(user.id, url) as { status: string } | null
    if (previous && !(isYouTubeUrl(url) && previous.status === 'no-preview')) return false
    return !existing.get(user.id, url)
  }))
  log(`bio link preview backfill start pending=${pending.length} delay=${delayMs}ms`)
  let fetched = 0
  let saved = 0
  for (const user of pending) {
    if (fetched) await wait(delayMs)
    const urls = postLinks(user.bio)
    log(`bio link preview backfill fetch user=${user.id}`)
    const previews = await discoverLinkPreviews(user.bio, database)
    await replaceBioLinkPreviews(database, user.id, previews)
    const savedUrls = new Set(previews.map(preview => preview.url))
    for (const url of urls) record.run(user.id, url, savedUrls.has(url)
      ? 'saved'
      : isYouTubeUrl(url) ? 'no-preview-youtube-v2' : 'no-preview')
    fetched++
    saved += previews.length
    log(`bio link preview backfill processed user=${user.id} saved=${previews.length}`)
  }
  log(`bio link preview backfill complete fetched=${fetched} saved=${saved}`)
  return { pending: pending.length, fetched, saved }
}

export async function runPostOgPreviewRefetch(database: Database, options: {
  log?: (message: string) => void
  discoverPreviews?: typeof discoverLinkPreviews
} = {}) {
  const origin = appOrigin()
  const log = options.log || logInfo
  const discoverPreviews = options.discoverPreviews || discoverLinkPreviews
  const attempted = database.query(
    'SELECT status FROM post_link_preview_backfill_attempts WHERE post_id=? AND url=?',
  )
  const record = database.query(`INSERT OR REPLACE INTO post_link_preview_backfill_attempts(post_id,url,status)
    VALUES(?,?,?)`)
  const rows = database.query(`SELECT lp.post_id,lp.url,lp.image_url FROM post_link_previews lp
    JOIN posts p ON p.id=lp.post_id WHERE p.deleted_at IS NULL ORDER BY lp.post_id,lp.url`).all() as {
      post_id: number
      url: string
      image_url: string
    }[]
  const normalizedUrl = (value: string) => new URL(
    /^https?:\/\//i.test(value) ? value : `https://${value.replace(/^\/+/, '')}`,
  )
  const ownPostOgImage = (value: string, previewUrl: string) => {
    try {
      const image = normalizedUrl(value)
      const imagePost = image.pathname.match(/^\/post\/([1-9]\d*)\/og\.png$/)?.[1]
      if (!imagePost) return false
      if (image.host === new URL(origin).host) return true
      const linked = normalizedUrl(previewUrl)
      return linked.origin === image.origin && linked.pathname === `/post/${imagePost}`
    }
    catch { return false }
  }
  const pending = origin ? rows.filter(row => {
    const previous = attempted.get(row.post_id, row.url) as { status: string } | null
    if (previous?.status.startsWith(POST_OG_REFETCH_STATUS_PREFIX)) return false
    return ownPostOgImage(row.image_url, row.url)
      || LEGACY_POST_OG_REFETCH_STATUS_PREFIXES.some(prefix => previous?.status.startsWith(prefix))
  }) : []
  log(`post OG preview refetch start pending=${pending.length}`)
  let saved = 0
  for (const row of pending) {
    record.run(row.post_id, row.url, `${POST_OG_REFETCH_STATUS_PREFIX}running`)
    const previewUrl = /^https?:\/\//i.test(row.url) ? row.url : `https://${row.url.replace(/^\/+/, '')}`
    const previews = await discoverPreviews(previewUrl, database)
    await saveLinkPreviews(database, row.post_id, previews)
    const status = previews.length ? 'saved' : 'no-preview'
    record.run(row.post_id, row.url, `${POST_OG_REFETCH_STATUS_PREFIX}${status}`)
    if (previews.length) saved++
    log(`post OG preview refetch ${status} post=${row.post_id} url=${row.url}`)
  }
  log(`post OG preview refetch complete fetched=${pending.length} saved=${saved}`)
  return { pending: pending.length, fetched: pending.length, saved }
}

export async function runR2LinkPreviewBackfill(database: Database, options: {
  log?: (message: string) => void
  logFailure?: (message: string, error: unknown) => void
  storeImage?: typeof storeRemotePreviewImage
} = {}) {
  const log = options.log || logInfo
  const logFailure = options.logFailure || logError
  const storeImage = options.storeImage || storeRemotePreviewImage
  const attempted = database.query(
    'SELECT status,attempted_at FROM post_link_preview_backfill_attempts WHERE post_id=? AND url=?',
  )
  const claim = database.query(`INSERT INTO post_link_preview_backfill_attempts(post_id,url,status)
    VALUES(?,?,'${R2_BACKFILL_STATUS_PREFIX}running')
    ON CONFLICT(post_id,url) DO UPDATE SET status=excluded.status,attempted_at=CURRENT_TIMESTAMP
    WHERE post_link_preview_backfill_attempts.status NOT LIKE '${R2_BACKFILL_STATUS_PREFIX}%'
      OR post_link_preview_backfill_attempts.status='${R2_BACKFILL_STATUS_PREFIX}failed'
      OR (post_link_preview_backfill_attempts.status='${R2_BACKFILL_STATUS_PREFIX}running'
        AND post_link_preview_backfill_attempts.attempted_at<=datetime('now','-15 minutes'))`)
  const finish = database.query(`UPDATE post_link_preview_backfill_attempts SET status=?,attempted_at=CURRENT_TIMESTAMP
    WHERE post_id=? AND url=?`)
  const rows = database.query(`SELECT lp.post_id,lp.url,lp.image_url FROM post_link_previews lp
    JOIN posts p ON p.id=lp.post_id WHERE p.deleted_at IS NULL ORDER BY lp.post_id,lp.url`).all() as {
      post_id: number
      url: string
      image_url: string
    }[]
  const staleClaimCutoff = (database.query("SELECT datetime('now','-15 minutes') AS value").get() as { value: string }).value
  const pending = rows.filter(row => {
    if (isImageKey(row.image_url)) return false
    try {
      if (new URL(row.image_url).origin === appOrigin()) return false
    }
    catch {
      return false
    }
    const previous = attempted.get(row.post_id, row.url) as { status: string; attempted_at: string } | null
    if (!previous?.status.startsWith(R2_BACKFILL_STATUS_PREFIX)) return true
    if (previous.status === `${R2_BACKFILL_STATUS_PREFIX}failed`) return true
    return previous.status === `${R2_BACKFILL_STATUS_PREFIX}running`
      && previous.attempted_at <= staleClaimCutoff
  })
  log(`R2 link preview backfill start scanned=${rows.length} pending=${pending.length} mode=serial delay=none`)
  let attemptedCount = 0
  let saved = 0
  let failed = 0
  for (const row of pending) {
    if (!claim.run(row.post_id, row.url).changes) {
      log(`R2 link preview backfill skipped post=${row.post_id} reason=already-claimed`)
      continue
    }
    attemptedCount++
    log(`R2 link preview backfill processing post=${row.post_id} item=${attemptedCount}/${pending.length}`)
    let uploadedKey: string | undefined
    try {
      const image = await storeImage(row.image_url)
      if (!image) throw new Error('Legacy preview image could not be fetched or validated')
      uploadedKey = image.key
      database.transaction(() => {
        if (!database.query(`UPDATE post_link_previews SET image_url=?,image_width=?,image_height=?
          WHERE post_id=? AND url=? AND image_url=?`)
          .run(image.key, image.width, image.height, row.post_id, row.url, row.image_url).changes) {
          throw new Error('Legacy preview changed while it was being backfilled')
        }
        finish.run(`${R2_BACKFILL_STATUS_PREFIX}saved`, row.post_id, row.url)
      })()
      saved++
      log(`R2 link preview backfill saved post=${row.post_id} key=${image.key}`)
    }
    catch (error) {
      if (uploadedKey) await deleteImagesAfterCommit([uploadedKey])
      finish.run(`${R2_BACKFILL_STATUS_PREFIX}failed`, row.post_id, row.url)
      failed++
      logFailure(`R2 link preview backfill failed post=${row.post_id}`, error)
    }
  }
  log(`R2 link preview backfill complete pending=${pending.length} attempted=${attemptedCount} saved=${saved} failed=${failed}`)
  return { pending: pending.length, attempted: attemptedCount, saved, failed }
}
