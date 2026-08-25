export function isWhisperThread(postId: 'p.id' | number = 'p.id') {
  return `EXISTS (WITH RECURSIVE whisper_ancestors(id,parent_id) AS (
    SELECT whisper_post.id,whisper_post.parent_id FROM posts whisper_post WHERE whisper_post.id=${postId}
    UNION ALL
    SELECT whisper_parent.id,whisper_parent.parent_id FROM posts whisper_parent
      JOIN whisper_ancestors whisper_child ON whisper_parent.id=whisper_child.parent_id
  ) SELECT 1 FROM whisper_ancestors
    JOIN post_hashtags whisper_tag ON whisper_tag.post_id=whisper_ancestors.id
    WHERE whisper_tag.tag='whisper')`
}

export function excludesWhisperPosts(postId: 'p.id' | number = 'p.id') {
  return `NOT ${isWhisperThread(postId)}`
}

export function whisperThreadRelevantToViewer(viewer = '$viewer', postId: 'p.id' | number = 'p.id') {
  return `(${isWhisperThread(postId)} AND EXISTS (
  WITH RECURSIVE whisper_relevant_ancestors(id,user_id,parent_id,whisper_root) AS (
    SELECT relevant_post.id,relevant_post.user_id,relevant_post.parent_id,
      EXISTS(SELECT 1 FROM post_hashtags root_tag
        WHERE root_tag.post_id=relevant_post.id AND root_tag.tag='whisper')
      FROM posts relevant_post WHERE relevant_post.id=${postId}
    UNION ALL
    SELECT relevant_parent.id,relevant_parent.user_id,relevant_parent.parent_id,
      EXISTS(SELECT 1 FROM post_hashtags root_tag
        WHERE root_tag.post_id=relevant_parent.id AND root_tag.tag='whisper')
      FROM posts relevant_parent
      JOIN whisper_relevant_ancestors relevant_child ON relevant_parent.id=relevant_child.parent_id
      WHERE relevant_child.whisper_root=0
  ) SELECT 1 FROM whisper_relevant_ancestors relevant
    LEFT JOIN posts whisper_parent ON whisper_parent.id=relevant.parent_id AND relevant.whisper_root=1
    LEFT JOIN post_mentions relevant_mention ON relevant_mention.post_id=relevant.id
      AND relevant_mention.user_id=${viewer}
    LEFT JOIN post_hashtags relevant_tag ON relevant_tag.post_id=relevant.id
    LEFT JOIN hashtag_follows relevant_follow ON relevant_follow.tag=relevant_tag.tag
      AND relevant_follow.user_id=${viewer}
    WHERE relevant.user_id=${viewer} OR whisper_parent.user_id=${viewer}
      OR relevant_mention.user_id IS NOT NULL
      OR relevant_follow.user_id IS NOT NULL
))`
}

export function whisperThreadTargetsViewer(viewer = '$viewer', postId: 'p.id' | number = 'p.id') {
  return `(${isWhisperThread(postId)} AND EXISTS (
  WITH RECURSIVE whisper_target_ancestors(id,user_id,parent_id,whisper_root) AS (
    SELECT target_post.id,target_post.user_id,target_post.parent_id,
      EXISTS(SELECT 1 FROM post_hashtags root_tag
        WHERE root_tag.post_id=target_post.id AND root_tag.tag='whisper')
      FROM posts target_post WHERE target_post.id=${postId}
    UNION ALL
    SELECT target_parent.id,target_parent.user_id,target_parent.parent_id,
      EXISTS(SELECT 1 FROM post_hashtags root_tag
        WHERE root_tag.post_id=target_parent.id AND root_tag.tag='whisper')
      FROM posts target_parent
      JOIN whisper_target_ancestors target_child ON target_parent.id=target_child.parent_id
      WHERE target_child.whisper_root=0
  ) SELECT 1 FROM whisper_target_ancestors target
    LEFT JOIN posts whisper_parent ON whisper_parent.id=target.parent_id AND target.whisper_root=1
    LEFT JOIN post_mentions target_mention ON target_mention.post_id=target.id
      AND target_mention.user_id=${viewer}
    WHERE target.user_id=${viewer} OR whisper_parent.user_id=${viewer}
      OR target_mention.user_id IS NOT NULL
))`
}
