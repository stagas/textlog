import { extractHashtags, extractMentions } from './content'
import { db } from './db'
import { hashPassword } from './utils'

const userCount = 20
const postCount = 500
const handles = Array.from({ length: userCount }, (_, index) => `demo_${String(index + 1).padStart(2, '0')}`)
const topics = [
  ['building small tools that do one thing well', 'build'],
  ['reading outside while the coffee cools', 'books'],
  ['a quiet walk through the city', 'city'],
  ['learning something new in public', 'learning'],
  ['shipping the tiny improvement today', 'indieweb'],
  ['writing down the idea before it disappears', 'notes'],
  ['making time for a slower morning', 'life'],
  ['finding a better name for the hard problem', 'work'],
] as const
const passwordHashes = await Promise.all(handles.map(() => hashPassword('demo-password')))

db.transaction(() => {
  const existing = db.query(
    `SELECT id FROM users WHERE handle IN (${handles.map(() => '?').join(',')})`,
  ).all(...handles) as { id: number }[]
  const ids = existing.map(user => user.id)
  if (ids.length) {
    const placeholders = ids.map(() => '?').join(',')
    db.query(`DELETE FROM post_hashtags WHERE post_id IN (SELECT id FROM posts WHERE user_id IN (${placeholders}))`)
      .run(...ids)
    db.query(`DELETE FROM sessions WHERE user_id IN (${placeholders})`).run(...ids)
    db.query(`DELETE FROM password_resets WHERE user_id IN (${placeholders})`).run(...ids)
    db.query(`DELETE FROM hashtag_follows WHERE user_id IN (${placeholders})`).run(...ids)
    db.query(`DELETE FROM follows WHERE follower_id IN (${placeholders}) OR following_id IN (${placeholders})`)
      .run(...ids, ...ids)
    db.query(`DELETE FROM posts WHERE user_id IN (${placeholders})`).run(...ids)
    db.query(`DELETE FROM account_groups WHERE primary_user_id IN (${placeholders})`).run(...ids)
    db.query(`DELETE FROM users WHERE id IN (${placeholders})`).run(...ids)
  }

  const users = handles.map((handle, index) => {
    const user = db.query(
      'INSERT INTO users(handle,email,bio,password) VALUES(?,?,?,?) RETURNING id,handle',
    ).get(
      handle,
      `${handle}@example.com`,
      `Demo account ${index + 1}. Posting small observations from around the web.`,
      passwordHashes[index],
    ) as { id: number; handle: string }
    const group = db.query(`INSERT INTO account_groups(email,primary_user_id,selected_user_id)
      VALUES(?,?,?) RETURNING id`).get(`${handle}@example.com`, user.id, user.id) as { id: number }
    db.query('UPDATE users SET account_group_id=? WHERE id=?').run(group.id, user.id)
    return user
  })

  const postIds: number[] = []
  for (let index = 0; index < postCount; index++) {
    const author = users[index % users.length]
    const [thought, tag] = topics[index % topics.length]
    const mentioned = users[(index + 7) % users.length].handle
    const variation = index % 5
    const body = variation === 0
      ? `${thought}. #${tag}`
      : variation === 1
      ? `${thought} — what do you think @${mentioned}? #${tag}`
      : variation === 2
      ? `${thought}. More at https://example.com/notes/${index + 1} #${tag}`
      : variation === 3
      ? `Today: ${thought}. #${tag} #textlog`
      : `${thought}. Keeping this one here for later. #${tag}`
    const parentId = index >= 12 && index % 9 === 0 ? postIds[index - 7] : null
    const createdAt = new Date(Date.now() - (postCount - index) * 37 * 60 * 1000)
      .toISOString().slice(0, 19).replace('T', ' ')
    const post = db.query(
      'INSERT INTO posts(user_id,parent_id,body,created_at) VALUES(?,?,?,?) RETURNING id',
    ).get(author.id, parentId, body, createdAt) as { id: number }
    postIds.push(post.id)
    for (const tag of extractHashtags(body)) {
      db.query('INSERT OR IGNORE INTO post_hashtags VALUES(?,?)').run(post.id, tag)
    }
    for (const handle of extractMentions(body)) {
      const mentioned = users.find(user => user.handle === handle)
      if (mentioned) db.query('INSERT OR IGNORE INTO post_mentions VALUES(?,?)').run(post.id, mentioned.id)
    }
  }

  for (let index = 0; index < users.length; index++) {
    for (let offset = 1; offset <= 3; offset++) {
      db.query('INSERT OR IGNORE INTO follows(follower_id,following_id) VALUES(?,?)')
        .run(users[index].id, users[(index + offset) % users.length].id)
    }
    db.query(`INSERT OR IGNORE INTO hashtag_follows(user_id,tag,created_at)
      VALUES(?,?,CURRENT_TIMESTAMP)`)
      .run(users[index].id, topics[index % topics.length][1])
  }
})()

const seededPosts = (db.query(
  `SELECT count(*) AS count FROM posts WHERE user_id IN (SELECT id FROM users WHERE handle IN (${
    handles.map(() => '?').join(',')
  }))`,
).get(...handles) as { count: number }).count

console.log(`Seeded ${userCount} demo users and ${seededPosts} demo posts.`)
console.log('Demo login: demo_01 / demo-password')
