export function mutedThreadForViewer(viewer: string, postId: number) {
  return `EXISTS (WITH RECURSIVE ancestors(id,parent_id) AS (
    SELECT id,parent_id FROM posts WHERE id=${postId} UNION ALL
    SELECT parent.id,parent.parent_id FROM posts parent JOIN ancestors ON parent.id=ancestors.parent_id
  ) SELECT 1 FROM ancestors JOIN muted_posts muted ON muted.post_id=ancestors.id
    WHERE muted.user_id=${viewer})`
}
