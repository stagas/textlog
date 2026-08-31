/**
 * Hashtags that opt a post and its descendants out of the public discovery feeds.
 *
 * Keep aliases here so adding or removing a spelling does not require changing feed SQL.
 * The first value is the canonical tag used for new metadata and follow relationships.
 */
export const META_HASHTAGS = ['meta', 'tlog', 'textlog'] as const

type MetaPostId = 'p.id' | 'descendants.id' | 'h.conversation_id' | number

export function isMetaThread(postId: MetaPostId = 'p.id') {
  return `EXISTS (WITH RECURSIVE meta_ancestors(id,parent_id) AS (
    SELECT meta_post.id,meta_post.parent_id FROM posts meta_post WHERE meta_post.id=${postId}
    UNION ALL
    SELECT meta_parent.id,meta_parent.parent_id FROM posts meta_parent
      JOIN meta_ancestors meta_child ON meta_parent.id=meta_child.parent_id
  ) SELECT 1 FROM meta_ancestors JOIN post_hashtags meta_tag ON meta_tag.post_id=meta_ancestors.id
    WHERE meta_tag.tag IN (${META_HASHTAGS.map(tag => `'${tag}'`).join(',')}))`
}

export function excludesMetaPosts(postId: MetaPostId = 'p.id') {
  return `NOT ${isMetaThread(postId)}`
}

/** Visibility for a protected branch outside personalized feeds. */
export function metaThreadVisibleToViewer(viewerId: number, postId: MetaPostId = 'p.id') {
  if (viewerId < 0) return excludesMetaPosts(postId)
  return `(${excludesMetaPosts(postId)} OR EXISTS (
    WITH RECURSIVE visible_meta_ancestors(id,user_id,parent_id) AS (
      SELECT visible_post.id,visible_post.user_id,visible_post.parent_id
        FROM posts visible_post WHERE visible_post.id=${postId}
      UNION ALL
      SELECT visible_parent.id,visible_parent.user_id,visible_parent.parent_id FROM posts visible_parent
        JOIN visible_meta_ancestors visible_child ON visible_parent.id=visible_child.parent_id
    ) SELECT 1 FROM visible_meta_ancestors visible
      LEFT JOIN follows visible_follow ON visible_follow.follower_id=${viewerId}
        AND visible_follow.following_id=visible.user_id
      LEFT JOIN post_hashtags visible_tag ON visible_tag.post_id=visible.id
      LEFT JOIN hashtag_follows visible_tag_follow ON visible_tag_follow.user_id=${viewerId}
        AND visible_tag_follow.tag=visible_tag.tag
      WHERE visible.user_id=${viewerId} OR visible_follow.follower_id IS NOT NULL
        OR visible_tag_follow.user_id IS NOT NULL
  ))`
}
