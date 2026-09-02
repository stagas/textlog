import { db } from '../src/db'
import { flushPendingFollowActivityPushes, sendPushForFollow, sendPushForUserFollow,
  vapidPublicKey } from '../src/push'

const emit = Bun.argv.includes('--emit')

const jobs = db.query(`SELECT job.actor_id actorId,job.target_id targetId,job.kind,
  actor.handle actorHandle,target.handle targetHandle
  FROM people_picker_follow_push_jobs job
  JOIN users actor ON actor.id=job.actor_id
  JOIN users target ON target.id=job.target_id
  ORDER BY job.created_at,job.actor_id,job.target_id,job.kind`).all() as Array<{
    actorId: number
    targetId: number
    kind: 'direct' | 'activity'
    actorHandle: string
    targetHandle: string
  }>
const complete = db.query(
  'DELETE FROM people_picker_follow_push_jobs WHERE actor_id=? AND target_id=? AND kind=?',
)

console.log(`people-picker push backfill pending=${jobs.length} mode=${emit ? 'emit' : 'dry-run'}`)
for (const job of jobs) {
  console.log(`people-picker push backfill candidate kind=${job.kind} actor=@${job.actorHandle} target=@${job.targetHandle}`)
}
if (!emit) {
  console.log('dry run only; rerun with --emit after reviewing the candidates')
  process.exit(0)
}
if (!vapidPublicKey()) throw new Error('VAPID configuration is required to emit push notifications')

for (const job of jobs) {
  if (job.kind === 'direct') {
    await sendPushForFollow(job.actorId, job.actorHandle, job.targetId, db)
  }
  else {
    await sendPushForUserFollow(job.actorId, job.actorHandle, job.targetId, job.targetHandle, db)
    await flushPendingFollowActivityPushes()
  }
  complete.run(job.actorId, job.targetId, job.kind)
  console.log(`people-picker push backfill emitted kind=${job.kind} actor=@${job.actorHandle} target=@${job.targetHandle}`)
}

console.log(`people-picker push backfill complete (${jobs.length} notifications emitted)`)
