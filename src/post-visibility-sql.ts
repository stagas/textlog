export const descendsFromViewer = `EXISTS (WITH RECURSIVE ancestors(id,user_id,parent_id) AS (
  SELECT ancestor.id,ancestor.user_id,ancestor.parent_id FROM posts ancestor WHERE ancestor.id=p.parent_id
  UNION ALL
  SELECT ancestor.id,ancestor.user_id,ancestor.parent_id FROM posts ancestor
    JOIN ancestors child ON ancestor.id=child.parent_id
) SELECT 1 FROM ancestors WHERE user_id=$viewer)`

export const hasVisibleDescendantFromAnotherUser = `EXISTS (WITH RECURSIVE descendants(id,user_id,parent_id,deleted_at) AS (
  SELECT child.id,child.user_id,child.parent_id,child.deleted_at FROM posts child WHERE child.parent_id=p.id
  UNION ALL
  SELECT child.id,child.user_id,child.parent_id,child.deleted_at FROM posts child
    JOIN descendants parent ON child.parent_id=parent.id
) SELECT 1 FROM descendants d WHERE d.user_id!=$viewer AND d.deleted_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM blocks b WHERE
    (b.blocker_id=$viewer AND b.blocked_id=d.user_id) OR (b.blocker_id=d.user_id AND b.blocked_id=$viewer))
  AND NOT EXISTS (SELECT 1 FROM post_hashtags ph JOIN blocked_hashtags bh ON bh.tag=ph.tag
    WHERE ph.post_id=d.id AND bh.user_id=$viewer))`
