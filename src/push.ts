import type { Database } from 'bun:sqlite'
import webpush from 'web-push'
import { db } from './db'
import { logError } from './log'

export type PushMessage = { title: string; body: string; url: string }
type PushSubscriptionRow = { endpoint: string; p256dh: string; auth: string }
type VapidConfiguration = { subject: string; publicKey: string; privateKey: string }

function vapidConfiguration() {
  const subject = Bun.env.VAPID_SUBJECT?.trim()
  const publicKey = Bun.env.VAPID_PUBLIC_KEY?.trim()
  const privateKey = Bun.env.VAPID_PRIVATE_KEY?.trim()
  return subject && publicKey && privateKey ? { subject, publicKey, privateKey } : null
}

export function vapidPublicKey() {
  return vapidConfiguration()?.publicKey || null
}

async function sendToSubscriptions(subscriptions: PushSubscriptionRow[], messageFor: (subscription: PushSubscriptionRow) => PushMessage,
  database: Database, vapid: VapidConfiguration)
{
  if (!subscriptions.length) return
  webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey)
  await Promise.all(subscriptions.map(async subscription => {
    try {
      await webpush.sendNotification({
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      }, JSON.stringify(messageFor(subscription)))
    }
    catch (error) {
      const statusCode = typeof error === 'object' && error && 'statusCode' in error
        ? Number(error.statusCode)
        : 0
      if (statusCode === 404 || statusCode === 410) {
        database.query('DELETE FROM push_subscriptions WHERE endpoint=?').run(subscription.endpoint)
      }
      else logError('push delivery failed', error)
    }
  }))
}

export async function sendPushToUser(userId: number, message: PushMessage, database: Database = db,
  vapid: VapidConfiguration | null = vapidConfiguration())
{
  if (!vapid) return
  const subscriptions = database.query(
    'SELECT endpoint,p256dh,auth FROM push_subscriptions WHERE user_id=?',
  ).all(userId) as PushSubscriptionRow[]
  await sendToSubscriptions(subscriptions, () => message, database, vapid)
}

export async function sendPushForPost(postId: number, actorId: number, actorHandle: string,
  database: Database = db, vapid: VapidConfiguration | null = vapidConfiguration())
{
  if (!vapid) return
  const post = database.query(`SELECT child.body,child.parent_id,parent_user.handle parent_handle
    FROM posts child LEFT JOIN posts parent ON parent.id=child.parent_id
    LEFT JOIN users parent_user ON parent_user.id=parent.user_id WHERE child.id=?`).get(postId) as {
    body: string; parent_id: number | null; parent_handle: string | null
  } | null
  if (!post) return
  const subscriptions = database.query(`SELECT ps.endpoint,ps.p256dh,ps.auth,
      (ps.user_id!=? AND EXISTS(SELECT 1 FROM posts child JOIN posts parent ON parent.id=child.parent_id
        WHERE child.id=? AND parent.user_id=ps.user_id)) is_reply,
      (ps.user_id!=? AND EXISTS(SELECT 1 FROM post_mentions pm
        WHERE pm.post_id=? AND pm.user_id=ps.user_id)) is_mention,
      ps.notify_replies,ps.notify_mentions
    FROM push_subscriptions ps WHERE NOT EXISTS (SELECT 1 FROM blocks b WHERE
      (b.blocker_id=? AND b.blocked_id=ps.user_id) OR (b.blocker_id=ps.user_id AND b.blocked_id=?))
    AND NOT EXISTS (SELECT 1 FROM post_hashtags ph JOIN blocked_hashtags bh ON bh.tag=ph.tag
      WHERE ph.post_id=? AND bh.user_id=ps.user_id)
    AND (ps.notify_latest=1
      OR (ps.notify_replies=1 AND ps.user_id!=? AND EXISTS(
        SELECT 1 FROM posts child JOIN posts parent ON parent.id=child.parent_id
        WHERE child.id=? AND parent.user_id=ps.user_id))
      OR (ps.notify_mentions=1 AND ps.user_id!=? AND EXISTS(
        SELECT 1 FROM post_mentions pm WHERE pm.post_id=? AND pm.user_id=ps.user_id)))`)
    .all(actorId, postId, actorId, postId, actorId, actorId, postId, actorId, postId, actorId, postId) as (PushSubscriptionRow & {
      is_reply: number; is_mention: number; notify_replies: number; notify_mentions: number
    })[]
  await sendToSubscriptions(subscriptions, subscription => {
    const item = subscription as typeof subscriptions[number]
    const kind = item.is_reply && item.notify_replies ? 'reply'
      : item.is_mention && item.notify_mentions ? 'mention' : 'latest'
    return {
      title: `@${actorHandle} ${kind === 'reply' ? 'replied to you'
        : kind === 'mention' ? 'mentioned you'
        : post.parent_handle ? `replied to @${post.parent_handle}` : 'wrote'}`,
      body: post.body,
      url: `/post/${postId}`,
    }
  }, database, vapid)
}

export async function sendPushForFollow(followerId: number, followerHandle: string, followedId: number,
  database: Database = db, vapid: VapidConfiguration | null = vapidConfiguration())
{
  if (!vapid || followerId === followedId) return
  const subscriptions = database.query(
    'SELECT endpoint,p256dh,auth FROM push_subscriptions WHERE user_id=? AND notify_follows=1',
  ).all(followedId) as PushSubscriptionRow[]
  await sendToSubscriptions(subscriptions, () => ({
    title: `@${followerHandle} followed you`,
    body: `@${followerHandle} is now following you.`,
    url: `/u/${encodeURIComponent(followerHandle)}`,
  }), database, vapid)
}
