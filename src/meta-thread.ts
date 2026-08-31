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
