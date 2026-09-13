import type { Database } from 'bun:sqlite'

export function isPrivateThread(postId: string | number = 'p.id') {
  return `EXISTS (SELECT 1 FROM post_hashtags private_tag WHERE private_tag.tag='private'
    AND private_tag.post_id IN (WITH RECURSIVE private_ancestors(id,parent_id) AS (
      SELECT id,parent_id FROM posts WHERE id=${postId}
      UNION ALL SELECT parent.id,parent.parent_id FROM posts parent
        JOIN private_ancestors child ON parent.id=child.parent_id
    ) SELECT id FROM private_ancestors))`
}

// Each private ancestor is a gate for its author, the parent author, and mentions in its branch.
export function privatePostVisible(viewerId: number | string, postId: string | number = 'p.id') {
  if (typeof viewerId === 'number' && viewerId < 0) return `NOT ${isPrivateThread(postId)}`
  return `(NOT EXISTS (SELECT 1 FROM post_hashtags WHERE tag='private') OR NOT EXISTS (WITH RECURSIVE ancestors(id,user_id,parent_id) AS (
    SELECT id,user_id,parent_id FROM posts WHERE id=${postId}
    UNION ALL SELECT parent.id,parent.user_id,parent.parent_id FROM posts parent
      JOIN ancestors child ON parent.id=child.parent_id
  ) SELECT 1 FROM ancestors root JOIN post_hashtags tag ON tag.post_id=root.id
    WHERE tag.tag='private' AND NOT (${viewerId}>=0 AND (root.user_id=${viewerId} OR EXISTS (
      SELECT 1 FROM posts private_parent WHERE private_parent.id=root.parent_id
        AND private_parent.user_id=${viewerId}
    ) OR EXISTS (
      WITH RECURSIVE branch(id) AS (
        SELECT root.id UNION ALL SELECT child.id FROM posts child JOIN branch ON child.parent_id=branch.id
      ) SELECT 1 FROM branch JOIN post_mentions mention ON mention.post_id=branch.id
        WHERE mention.user_id=${viewerId}
    )))))`
}

export function canReadPrivatePost(database: Database, id: number, viewerId = -1) {
  if (!database.query("SELECT 1 FROM post_hashtags WHERE tag='private' LIMIT 1").get()) {
    return !!database.query('SELECT 1 FROM posts WHERE id=?').get(id)
  }
  return !!database.query(`SELECT 1 FROM posts p WHERE p.id=? AND ${privatePostVisible(viewerId)}`).get(id)
}
