import type { Database } from 'bun:sqlite'
import webpush from 'web-push'
import { ADMIN_EMAILS } from './admin'
import { splitSpoilerBody } from './content'
import { type DatabaseService, databaseService } from './database-service'
import { isDevelopment } from './environment'
import { logError } from './log'
import { markdownPlainText } from './markdown'
import { excludesWhisperPosts, isWhisperThread, whisperThreadRelevantToViewer,
  whisperThreadTargetsViewer } from './whisper'

export type PushMessage = { title: string; body: string; url: string }
type PushSubscriptionRow = { endpoint: string; p256dh: string; auth: string }
type VapidConfiguration = { subject: string; publicKey: string; privateKey: string }

const followActivityBatchDelay = 2 * 60 * 1_000
type FollowActivityBatch = {
  actorHandle: string
  database?: Database
  service?: DatabaseService
  items: Map<string, string>
  subscription: PushSubscriptionRow
  timer: ReturnType<typeof setTimeout>
  vapid: VapidConfiguration
}
const followActivityBatches = new Map<string, FollowActivityBatch>()

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
  messageFor: (subscription: T) => PushMessage, database: Database | undefined, vapid: VapidConfiguration,
  service?: DatabaseService)
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
        if (database) database.query('DELETE FROM push_subscriptions WHERE endpoint=?').run(subscription.endpoint)
        else await (service || databaseService()).call('push.removeEndpoint', { endpoint: subscription.endpoint })
      }
      else logError('push delivery failed', error)
    }
  }))
}

async function flushFollowActivityBatch(key: string) {
  const batch = followActivityBatches.get(key)
  if (!batch) return
  followActivityBatches.delete(key)
  clearTimeout(batch.timer)
  const labels = [...batch.items.keys()]
  const message = `@${batch.actorHandle} followed ${labels.join(', ')}`
  await sendToSubscriptions([batch.subscription], () => ({
    title: message,
    body: message,
    url: labels.length === 1 ? [...batch.items.values()][0] : '/for-you',
  }), batch.database, batch.vapid, batch.service)
}

function queueFollowActivity(actorId: number, actorHandle: string, label: string, url: string,
  subscriptions: PushSubscriptionRow[], database: Database | undefined, vapid: VapidConfiguration,
  service?: DatabaseService)
{
  for (const subscription of subscriptions) {
    const key = `${actorId}:${subscription.endpoint}`
    const existing = followActivityBatches.get(key)
    if (existing) {
      existing.items.set(label, url)
      continue
    }
    const timer = setTimeout(() => {
      void flushFollowActivityBatch(key).catch(error => logError('batched follow activity push failed', error))
    }, followActivityBatchDelay)
    const batch: FollowActivityBatch = {
      actorHandle,
      database,
      service,
      items: new Map([[label, url]]),
      subscription,
      timer,
      vapid,
    }
    followActivityBatches.set(key, batch)
  }
}

export async function flushPendingFollowActivityPushes() {
  await Promise.all([...followActivityBatches.keys()].map(flushFollowActivityBatch))
}

export async function sendPushToUser(userId: number, message: PushMessage, database?: Database,
  vapid: VapidConfiguration | null = vapidConfiguration())
{
  if (!vapid) return
  const subscriptions = database
    ? database.query(
      'SELECT endpoint,p256dh,auth FROM push_subscriptions WHERE user_id=?',
    ).all(userId) as PushSubscriptionRow[]
    : await databaseService().call('push.userDelivery', { userId })
  await sendToSubscriptions(subscriptions, () => message, database, vapid)
}

export async function sendPushForPost(postId: number, actorId: number, actorHandle: string, database?: Database,
  vapid: VapidConfiguration | null = vapidConfiguration(), service?: DatabaseService)
{
  if (!vapid) return
  const directPost = database
    ? database.query(`SELECT child.body,child.parent_id,parent_user.handle parent_handle
    FROM posts child LEFT JOIN posts parent ON parent.id=child.parent_id
    LEFT JOIN users parent_user ON parent_user.id=parent.user_id WHERE child.id=?`).get(postId) as {
      body: string
      parent_id: number | null
      parent_handle: string | null
    } | null
    : null
  const loaded = database ? null : await (service || databaseService()).call('push.postDelivery', { postId, actorId })
  const post = directPost
    ? { body: directPost.body, parentId: directPost.parent_id, parentHandle: directPost.parent_handle }
    : loaded?.post
  if (!post) return
  const directSubscriptions = database
    ? database.query(`SELECT ps.endpoint,ps.p256dh,ps.auth,ps.user_id,
      recipient.handle recipient_handle,
      (ps.user_id!=? AND (EXISTS(SELECT 1 FROM posts child JOIN posts parent ON parent.id=child.parent_id
        WHERE child.id=? AND parent.user_id=ps.user_id)
        OR ${whisperThreadTargetsViewer('ps.user_id', postId)})) is_reply,
      (ps.user_id!=? AND EXISTS(SELECT 1 FROM post_mentions pm
        WHERE pm.post_id=? AND pm.user_id=ps.user_id)) is_mention,
      ps.notify_replies,ps.notify_mentions
    FROM push_subscriptions ps JOIN users recipient ON recipient.id=ps.user_id
    WHERE NOT EXISTS (SELECT 1 FROM blocks b WHERE
      (b.blocker_id=? AND b.blocked_id=ps.user_id) OR (b.blocker_id=ps.user_id AND b.blocked_id=?))
    AND NOT EXISTS (SELECT 1 FROM post_hashtags ph JOIN blocked_hashtags bh ON bh.tag=ph.tag
      WHERE ph.post_id=? AND bh.user_id=ps.user_id)
    AND ((ps.notify_latest=1 AND ps.user_id!=? AND ${excludesWhisperPosts(postId)})
      OR (ps.notify_following_notes=1 AND ps.user_id!=? AND ((NOT ${isWhisperThread(postId)} AND (EXISTS
        (SELECT 1 FROM follows vf WHERE vf.follower_id=ps.user_id AND vf.following_id=?) OR EXISTS
        (SELECT 1 FROM post_hashtags ph JOIN hashtag_follows hf ON hf.tag=ph.tag
          WHERE ph.post_id=? AND hf.user_id=ps.user_id)))
        OR ${whisperThreadRelevantToViewer('ps.user_id', postId)})
        AND (ps.notify_following_only_to_me=0 OR EXISTS(
          SELECT 1 FROM posts direct_child JOIN posts direct_parent ON direct_parent.id=direct_child.parent_id
          WHERE direct_child.id=? AND direct_parent.user_id=ps.user_id) OR EXISTS(
          SELECT 1 FROM post_mentions direct_mention
          WHERE direct_mention.post_id=? AND direct_mention.user_id=ps.user_id)
        OR ${whisperThreadTargetsViewer('ps.user_id', postId)}))
      OR (ps.notify_replies=1 AND ps.user_id!=? AND (EXISTS(
        SELECT 1 FROM posts child JOIN posts parent ON parent.id=child.parent_id
        WHERE child.id=? AND parent.user_id=ps.user_id) OR ${whisperThreadTargetsViewer('ps.user_id', postId)}))
      OR (ps.notify_mentions=1 AND ps.user_id!=? AND EXISTS(
        SELECT 1 FROM post_mentions pm WHERE pm.post_id=? AND pm.user_id=ps.user_id)))
    ORDER BY ps.endpoint,is_reply DESC,is_mention DESC,ps.user_id`)
      .all(actorId, postId, actorId, postId, actorId, actorId, postId, actorId, actorId, actorId, postId, postId,
        postId, actorId, postId, actorId, postId) as (PushSubscriptionRow & {
          user_id: number
          is_reply: number
          is_mention: number
          notify_replies: number
          notify_mentions: number
          recipient_handle: string
        })[]
    : []
  const subscriptions = database
    ? directSubscriptions.map(subscription => ({ ...subscription, userId: subscription.user_id,
      recipientHandle: subscription.recipient_handle, isReply: subscription.is_reply,
      isMention: subscription.is_mention, notifyReplies: subscription.notify_replies,
      notifyMentions: subscription.notify_mentions })
    )
    : loaded!.subscriptions
  await sendToSubscriptions(subscriptions, subscription => {
    const kind = subscription.isReply && subscription.notifyReplies
      ? 'reply'
      : subscription.isMention && subscription.notifyMentions
      ? 'mention'
      : 'latest'
    return {
      title: `@${actorHandle} ${
        kind === 'reply'
          ? `replied to @${subscription.recipientHandle}`
          : kind === 'mention'
          ? `mentioned @${subscription.recipientHandle}`
          : post.parentHandle
          ? `replied to @${post.parentHandle}`
          : 'wrote'
      }`,
      body: markdownPlainText(splitSpoilerBody(post.body).visible),
      url: `/post/${postId}`,
    }
  }, database, vapid, service)
}

export async function sendPushForFollow(followerId: number, followerHandle: string, followedId: number,
  database?: Database, vapid: VapidConfiguration | null = vapidConfiguration(), service?: DatabaseService)
{
  if (!vapid || followerId === followedId) return
  const direct = database
    ? database.query(`SELECT ps.endpoint,ps.p256dh,ps.auth,u.handle recipient_handle
    FROM push_subscriptions ps JOIN users u ON u.id=ps.user_id
    WHERE ps.user_id=? AND ps.notify_follows=1`).all(followedId) as (PushSubscriptionRow & {
      recipient_handle: string
    })[]
    : []
  const subscriptions = database
    ? direct.map(subscription => ({ ...subscription, recipientHandle: subscription.recipient_handle }))
    : await (service || databaseService()).call('push.followDelivery', { followedId })
  await sendToSubscriptions(subscriptions, subscription => ({
    title: `@${followerHandle} followed @${subscription.recipientHandle}`,
    body: `@${followerHandle} is now following @${subscription.recipientHandle}.`,
    url: `/u/${encodeURIComponent(followerHandle)}`,
  }), database, vapid, service)
}

export async function sendPushForUserFollow(actorId: number, actorHandle: string, targetId: number,
  targetHandle: string, database?: Database, vapid: VapidConfiguration | null = vapidConfiguration(),
  service?: DatabaseService)
{
  if (!vapid || actorId === targetId) return
  const subscriptions = database
    ? database.query(`SELECT ps.endpoint,ps.p256dh,ps.auth FROM push_subscriptions ps
    WHERE ps.notify_people_follow_activity=1 AND ps.user_id NOT IN (?,?)
      AND EXISTS (SELECT 1 FROM follows vf WHERE vf.follower_id=ps.user_id AND vf.following_id=?)
      AND NOT EXISTS (SELECT 1 FROM blocks b WHERE
        b.blocker_id=ps.user_id AND b.blocked_id IN (?,?) OR
        b.blocked_id=ps.user_id AND b.blocker_id IN (?,?))`)
      .all(actorId, targetId, actorId, actorId, targetId, actorId, targetId) as PushSubscriptionRow[]
    : await (service || databaseService()).call('push.userFollowDelivery', { actorId, targetId })
  queueFollowActivity(actorId, actorHandle, `@${targetHandle}`, `/u/${encodeURIComponent(targetHandle)}`, subscriptions,
    database, vapid, service)
}

export async function sendPushForTagFollow(actorId: number, actorHandle: string, tag: string, database?: Database,
  vapid: VapidConfiguration | null = vapidConfiguration(), service?: DatabaseService)
{
  if (!vapid) return
  const subscriptions = database
    ? database.query(`SELECT ps.endpoint,ps.p256dh,ps.auth FROM push_subscriptions ps
    WHERE ps.notify_hashtag_follow_activity=1 AND ps.user_id!=? AND (EXISTS
      (SELECT 1 FROM follows vf WHERE vf.follower_id=ps.user_id AND vf.following_id=?) OR EXISTS
      (SELECT 1 FROM hashtag_follows vhf WHERE vhf.user_id=ps.user_id AND vhf.tag=?))
      AND NOT EXISTS (SELECT 1 FROM blocks b WHERE
        (b.blocker_id=ps.user_id AND b.blocked_id=?) OR (b.blocked_id=ps.user_id AND b.blocker_id=?))
      AND NOT EXISTS (SELECT 1 FROM blocked_hashtags bh WHERE bh.user_id=ps.user_id AND bh.tag=?)`)
      .all(actorId, actorId, tag, actorId, actorId, tag) as PushSubscriptionRow[]
    : await (service || databaseService()).call('push.tagFollowDelivery', { actorId, tag })
  queueFollowActivity(actorId, actorHandle, `#${tag}`, `/tag/${encodeURIComponent(tag)}`, subscriptions, database,
    vapid, service)
}

export async function sendPushForSignup(userId: number, handle: string, database?: Database,
  vapid: VapidConfiguration | null = vapidConfiguration())
{
  if (!vapid || !ADMIN_EMAILS.size) return
  const administratorEmails = [...ADMIN_EMAILS]
  const placeholders = administratorEmails.map(() => '?').join(',')
  const subscriptions = database
    ? database.query(`SELECT ps.endpoint,ps.p256dh,ps.auth
    FROM push_subscriptions ps JOIN users u ON u.id=ps.user_id
    WHERE lower(u.email) IN (${placeholders}) AND ps.notify_signups=1
      AND u.deleted_at IS NULL AND u.suspended_at IS NULL`).all(...administratorEmails) as PushSubscriptionRow[]
    : await databaseService().call('push.signupDelivery', { administratorEmails })
  await sendToSubscriptions(subscriptions, () => ({
    title: `@${handle} signed up`,
    body: `@${handle} signed up`,
    url: `/admin/users/${userId}`,
  }), database, vapid)
}
