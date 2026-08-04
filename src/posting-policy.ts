export function canPublishPosts(user: { email_verified_at?: string | null }, environment = Bun.env.NODE_ENV) {
  const effectiveEnvironment = environment || (Bun.env.DEV_RELOAD === 'true' ? 'development' : 'production')
  return effectiveEnvironment === 'development' || Boolean(user.email_verified_at)
}
