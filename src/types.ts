export type PostRow = {
  id: number
  user_id: number
  parent_id: number | null
  body: string
  created_at: string
  deleted_at: string | null
}

export type ParentPost = Pick<PostRow, 'id' | 'body' | 'created_at' | 'deleted_at'> & {
  handle: string
  reply_count: number
}

export type PostView = PostRow & {
  handle: string
  reply_count?: number
  parent?: ParentPost | null
}

export type ProfileRow = {
  id: number
  handle: string
  email: string
  bio: string
  deleted_at?: string | null
}

export type PersonView = ProfileRow & {
  posts: number
  following?: boolean
  viewerFollowing?: boolean
}
