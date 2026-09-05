import { Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'
import { accountChoices, accountForEmail, createAccountGroup, detachAccountFromGroup, isPrimaryAccount,
  selectAccount } from './account-groups'
import { executeDatabaseDomain, hydrateMaterializedFeed, materializedFeedTemplate } from './database-domain'
import { hasUnreadForYou, hasUnreadToMe, markAllForYouRead } from './for-you-state'
import { markLatestPostsRead } from './latest-state'
import { runMigrations } from './migrations'
import { insertSession, sessionHash } from './sessions'

function fixture() {
  const database = new Database(':memory:', { strict: true })
  database.run('PRAGMA foreign_keys=ON')
  runMigrations(database)
  const primary = database.query(`INSERT INTO users(handle,email,password,handle_chosen_at)
    VALUES('primary','shared@example.com','!',CURRENT_TIMESTAMP) RETURNING id`).get() as { id: number }
  const group = createAccountGroup(database, primary.id, 'shared@example.com')
  const persona = database.query(`INSERT INTO users(handle,email,password,handle_chosen_at,account_group_id)
    VALUES('persona','shared@example.com','!',CURRENT_TIMESTAMP,?) RETURNING id`).get(group.id) as { id: number }
  return { database, primary, persona, group }
}

test('email login resolves the selected full account while preserving the primary', () => {
  const { database, primary, persona } = fixture()

  expect(accountForEmail(database, 'shared@example.com')?.id).toBe(primary.id)
  expect(selectAccount(database, persona.id)).toBe(true)
  expect(isPrimaryAccount(database, primary.id)).toBe(true)
  expect(isPrimaryAccount(database, persona.id)).toBe(false)
  expect(accountForEmail(database, 'shared@example.com')?.id).toBe(persona.id)
  expect(accountChoices(database, persona.id)).toEqual([
    expect.objectContaining({ id: primary.id, primary: true, selected: false }),
    expect.objectContaining({ id: persona.id, primary: false, selected: true }),
  ])
})

test('removing the selected primary promotes a remaining account', () => {
  const { database, primary, persona, group } = fixture()
  detachAccountFromGroup(database, primary.id)

  expect(database.query('SELECT primary_user_id,selected_user_id FROM account_groups WHERE id=?').get(group.id))
    .toEqual({ primary_user_id: persona.id, selected_user_id: persona.id })
  expect(accountForEmail(database, 'shared@example.com')?.id).toBe(persona.id)
})

test('linked-account unread activity reflects only My Feed and @', async () => {
  const { database, primary, persona } = fixture()
  const actor = database.query(`INSERT INTO users(handle,email,password,handle_chosen_at)
    VALUES('actor','actor@example.com','!',CURRENT_TIMESTAMP) RETURNING id`).get() as { id: number }
  database.query(`INSERT INTO follows(follower_id,following_id,created_at)
    VALUES(?,?,datetime('now','-1 second'))`).run(persona.id, actor.id)
  const feedPost = database.query(`INSERT INTO posts(user_id,body,created_at)
    VALUES(?,'new followed post',CURRENT_TIMESTAMP) RETURNING id`).get(actor.id) as { id: number }
  const token = 'linked-account-unread-session'
  const now = Date.now()
  insertSession(database, token, primary.id, now + 60_000, now, 'test')

  const before = await executeDatabaseDomain(database, 'auth.resolve', {
    sessionToken: token,
    bearerToken: null,
    deviceId: null,
    now,
  })
  expect(before.sessionUser?.linked_accounts).toEqual([
    expect.objectContaining({ id: persona.id, has_unread: true }),
  ])
  const cachedMenu = materializedFeedTemplate(`<a class="account-menu-handle" href="/u/primary">
    <span class="unread-dot" aria-label="unread account activity"></span>@primary</a>
    <form method="post" action="/account/accounts/select"><input type="hidden" name="accountId"
    value="${persona.id}"/><button class="account-menu-account" type="submit"><span class="unread-dot"
    aria-label="unread activity"></span><span>@persona</span></button></form>`)
  expect(hydrateMaterializedFeed(cachedMenu, database, primary.id))
    .toContain('aria-label="unread account activity"')

  await executeDatabaseDomain(database, 'account.select', {
    userId: primary.id,
    targetId: persona.id,
    sessionHash: sessionHash(token),
  })
  markLatestPostsRead(persona.id, [feedPost.id], database)
  expect(hasUnreadForYou(persona.id, database)).toBe(true)
  await executeDatabaseDomain(database, 'account.select', {
    userId: persona.id,
    targetId: primary.id,
    sessionHash: sessionHash(token),
  })

  const afterSwitching = await executeDatabaseDomain(database, 'auth.resolve', {
    sessionToken: token,
    bearerToken: null,
    deviceId: null,
    now,
  })
  expect(afterSwitching.sessionUser?.linked_accounts).toEqual([
    expect.objectContaining({ id: persona.id, has_unread: true }),
  ])

  markAllForYouRead(persona.id, false, database)
  const afterReading = await executeDatabaseDomain(database, 'auth.resolve', {
    sessionToken: token,
    bearerToken: null,
    deviceId: null,
    now,
  })
  expect(afterReading.sessionUser?.linked_accounts).toEqual([
    expect.objectContaining({ id: persona.id, has_unread: false }),
  ])
  expect(hydrateMaterializedFeed(cachedMenu, database, primary.id)).not.toContain('aria-label="unread activity"')
  expect(hydrateMaterializedFeed(cachedMenu, database, primary.id))
    .not.toContain('aria-label="unread account activity"')

  database.query(`INSERT INTO follows(follower_id,following_id,created_at)
    VALUES(?,?,datetime('now','+1 second'))`).run(actor.id, persona.id)
  expect(hasUnreadForYou(persona.id, database)).toBe(false)
  expect(hasUnreadToMe(persona.id, database)).toBe(true)
  const afterToMeOnlyActivity = await executeDatabaseDomain(database, 'auth.resolve', {
    sessionToken: token,
    bearerToken: null,
    deviceId: null,
    now,
  })
  expect(afterToMeOnlyActivity.sessionUser?.linked_accounts).toEqual([
    expect.objectContaining({ id: persona.id, has_unread: true }),
  ])
  markAllForYouRead(persona.id, true, database)

  const outsider = database.query(`INSERT INTO users(handle,email,password,handle_chosen_at)
    VALUES('outsider','outsider@example.com','!',CURRENT_TIMESTAMP) RETURNING id`).get() as { id: number }
  const unrelated = database.query(`INSERT INTO posts(user_id,body,created_at)
    VALUES(?,'unrelated all activity',datetime('now','+2 seconds')) RETURNING id`).get(outsider.id) as { id: number }
  expect(hasUnreadForYou(persona.id, database)).toBe(false)
  const afterAllOnlyActivity = await executeDatabaseDomain(database, 'auth.resolve', {
    sessionToken: token,
    bearerToken: null,
    deviceId: null,
    now,
  })
  expect(afterAllOnlyActivity.sessionUser?.linked_accounts).toEqual([
    expect.objectContaining({ id: persona.id, has_unread: false }),
  ])
  markLatestPostsRead(persona.id, [unrelated.id], database)
  const afterReadingAllOnlyActivity = await executeDatabaseDomain(database, 'auth.resolve', {
    sessionToken: token,
    bearerToken: null,
    deviceId: null,
    now,
  })
  expect(afterReadingAllOnlyActivity.sessionUser?.linked_accounts).toEqual([
    expect.objectContaining({ id: persona.id, has_unread: false }),
  ])

  database.query(`INSERT INTO posts(user_id,body,created_at)
    VALUES(?,'newer followed post',datetime('now','+3 seconds'))`).run(actor.id)
  const afterNewActivity = await executeDatabaseDomain(database, 'auth.resolve', {
    sessionToken: token,
    bearerToken: null,
    deviceId: null,
    now,
  })
  expect(afterNewActivity.sessionUser?.linked_accounts).toEqual([
    expect.objectContaining({ id: persona.id, has_unread: true }),
  ])
})
