import type { Database } from 'bun:sqlite'
import webpush from 'web-push'
import { ADMIN_EMAILS } from './admin'
import { db } from './db'
import { isDevelopment } from './environment'
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

async function sendToSubscriptions<T extends PushSubscriptionRow>(subscriptions: T[],
  messageFor: (subscription: T) => PushMessage, database: Database, vapid: VapidConfiguration)
{
  if (isDevelopment() || !subscriptions.length) return
  webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey)
  const devices = new Map<string, T>()
  for (const subscription of subscriptions) {
    if (!devices.has(subscription.endpoint)) devices.set(subscription.endpoint, subscription)
  }
  await Promise.all([...devices.values()].map(async subscription => {
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

export async function sendPushForPost(postId: number, actorId: number, actorHandle: string, database: Database = db,
  vapid: VapidConfiguration | null = vapidConfiguration())
{
  if (!vapid) return
  const post = database.query(`SELECT child.body,child.parent_id,parent_user.handle parent_handle
    FROM posts child LEFT JOIN posts parent ON parent.id=child.parent_id
    LEFT JOIN users parent_user ON parent_user.id=parent.user_id WHERE child.id=?`).get(postId) as {
    body: string
    parent_id: number | null
    parent_handle: string | null
  } | null
  if (!post) return
  const subscriptions = database.query(`SELECT ps.endpoint,ps.p256dh,ps.auth,ps.user_id,
      recipient.handle recipient_handle,
      (ps.user_id!=? AND EXISTS(SELECT 1 FROM posts child JOIN posts parent ON parent.id=child.parent_id
        WHERE child.id=? AND parent.user_id=ps.user_id)) is_reply,
      (ps.user_id!=? AND EXISTS(SELECT 1 FROM post_mentions pm
        WHERE pm.post_id=? AND pm.user_id=ps.user_id)) is_mention,
      ps.notify_replies,ps.notify_mentions
    FROM push_subscriptions ps JOIN users recipient ON recipient.id=ps.user_id
    WHERE NOT EXISTS (SELECT 1 FROM blocks b WHERE
      (b.blocker_id=? AND b.blocked_id=ps.user_id) OR (b.blocker_id=ps.user_id AND b.blocked_id=?))
    AND NOT EXISTS (SELECT 1 FROM post_hashtags ph JOIN blocked_hashtags bh ON bh.tag=ph.tag
      WHERE ph.post_id=? AND bh.user_id=ps.user_id)
    AND ((ps.notify_latest=1 AND (ps.user_id!=? OR ps.notify_own_posts=1))
      OR (ps.notify_following_notes=1 AND (ps.user_id!=? OR ps.notify_own_posts=1) AND (EXISTS
        (SELECT 1 FROM follows vf WHERE vf.follower_id=ps.user_id AND vf.following_id=?) OR EXISTS
        (SELECT 1 FROM post_hashtags ph JOIN hashtag_follows hf ON hf.tag=ph.tag
          WHERE ph.post_id=? AND hf.user_id=ps.user_id)))
      OR (ps.notify_replies=1 AND ps.user_id!=? AND EXISTS(
        SELECT 1 FROM posts child JOIN posts parent ON parent.id=child.parent_id
        WHERE child.id=? AND parent.user_id=ps.user_id))
      OR (ps.notify_mentions=1 AND ps.user_id!=? AND EXISTS(
        SELECT 1 FROM post_mentions pm WHERE pm.post_id=? AND pm.user_id=ps.user_id)))
    ORDER BY ps.endpoint,is_reply DESC,is_mention DESC,ps.user_id`)
    .all(actorId, postId, actorId, postId, actorId, actorId, postId, actorId, actorId, actorId, postId, actorId, postId,
      actorId, postId) as (PushSubscriptionRow & {
        user_id: number
        is_reply: number
        is_mention: number
        notify_replies: number
        notify_mentions: number
        recipient_handle: string
      })[]
  await sendToSubscriptions(subscriptions, subscription => {
    const kind = subscription.is_reply && subscription.notify_replies
      ? 'reply'
      : subscription.is_mention && subscription.notify_mentions
      ? 'mention'
      : 'latest'
    return {
      title: `@${actorHandle} ${
        kind === 'reply'
          ? `replied to @${subscription.recipient_handle}`
          : kind === 'mention'
          ? `mentioned @${subscription.recipient_handle}`
          : post.parent_handle
          ? `replied to @${post.parent_handle}`
          : 'wrote'
      }`,
      body: post.body.trimEnd(),
      url: `/post/${postId}`,
    }
  }, database, vapid)
}

export async function sendPushForFollow(followerId: number, followerHandle: string, followedId: number,
  database: Database = db, vapid: VapidConfiguration | null = vapidConfiguration())
{
  if (!vapid || followerId === followedId) return
  const subscriptions = database.query(`SELECT ps.endpoint,ps.p256dh,ps.auth,u.handle recipient_handle
    FROM push_subscriptions ps JOIN users u ON u.id=ps.user_id
    WHERE ps.user_id=? AND ps.notify_follows=1`).all(followedId) as (PushSubscriptionRow & {
    recipient_handle: string
  })[]
  await sendToSubscriptions(subscriptions, subscription => ({
    title: `@${followerHandle} followed @${subscription.recipient_handle}`,
    body: `@${followerHandle} is now following @${subscription.recipient_handle}.`,
    url: `/u/${encodeURIComponent(followerHandle)}`,
  }), database, vapid)
}

export async function sendPushForUserFollow(actorId: number, actorHandle: string, targetId: number,
  targetHandle: string, database: Database = db, vapid: VapidConfiguration | null = vapidConfiguration())
{
  if (!vapid || actorId === targetId) return
  const subscriptions = database.query(`SELECT ps.endpoint,ps.p256dh,ps.auth FROM push_subscriptions ps
    WHERE ps.notify_follow_activity=1 AND ps.user_id NOT IN (?,?)
      AND EXISTS (SELECT 1 FROM follows vf WHERE vf.follower_id=ps.user_id AND vf.following_id=?)
      AND NOT EXISTS (SELECT 1 FROM blocks b WHERE
        b.blocker_id=ps.user_id AND b.blocked_id IN (?,?) OR
        b.blocked_id=ps.user_id AND b.blocker_id IN (?,?))`)
    .all(actorId, targetId, actorId, actorId, targetId, actorId, targetId) as PushSubscriptionRow[]
  await sendToSubscriptions(subscriptions, () => ({
    title: `@${actorHandle} followed @${targetHandle}`,
    body: `@${actorHandle} followed @${targetHandle}`,
    url: `/u/${encodeURIComponent(targetHandle)}`,
  }), database, vapid)
}

export async function sendPushForTagFollow(actorId: number, actorHandle: string, tag: string, database: Database = db,
  vapid: VapidConfiguration | null = vapidConfiguration())
{
  if (!vapid) return
  const subscriptions = database.query(`SELECT ps.endpoint,ps.p256dh,ps.auth FROM push_subscriptions ps
    WHERE ps.notify_follow_activity=1 AND ps.user_id!=? AND (EXISTS
      (SELECT 1 FROM follows vf WHERE vf.follower_id=ps.user_id AND vf.following_id=?) OR EXISTS
      (SELECT 1 FROM hashtag_follows vhf WHERE vhf.user_id=ps.user_id AND vhf.tag=?))
      AND NOT EXISTS (SELECT 1 FROM blocks b WHERE
        (b.blocker_id=ps.user_id AND b.blocked_id=?) OR (b.blocked_id=ps.user_id AND b.blocker_id=?))
      AND NOT EXISTS (SELECT 1 FROM blocked_hashtags bh WHERE bh.user_id=ps.user_id AND bh.tag=?)`)
    .all(actorId, actorId, tag, actorId, actorId, tag) as PushSubscriptionRow[]
  await sendToSubscriptions(subscriptions, () => ({
    title: `@${actorHandle} followed #${tag}`,
    body: `@${actorHandle} followed #${tag}`,
    url: `/tag/${encodeURIComponent(tag)}`,
  }), database, vapid)
}

export async function sendPushForSignup(userId: number, handle: string, database: Database = db,
  vapid: VapidConfiguration | null = vapidConfiguration())
{
  if (!vapid || !ADMIN_EMAILS.size) return
  const administratorEmails = [...ADMIN_EMAILS]
  const placeholders = administratorEmails.map(() => '?').join(',')
  const subscriptions = database.query(`SELECT ps.endpoint,ps.p256dh,ps.auth
    FROM push_subscriptions ps JOIN users u ON u.id=ps.user_id
    WHERE lower(u.email) IN (${placeholders}) AND ps.notify_signups=1
      AND u.deleted_at IS NULL AND u.suspended_at IS NULL`).all(...administratorEmails) as PushSubscriptionRow[]
  await sendToSubscriptions(subscriptions, () => ({
    title: `@${handle} signed up`,
    body: `@${handle} signed up`,
    url: `/admin/users/${userId}`,
  }), database, vapid)
}
