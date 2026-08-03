type PostListener = (postId: number) => void

const listeners = new Set<PostListener>()

export function publishPost(postId: number) {
  // A disconnected or faulty consumer must never turn a committed post into an HTTP failure.
  for (const listener of listeners) {
    try { listener(postId) }
    catch { listeners.delete(listener) }
  }
}

export function subscribeToPosts(listener: PostListener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
