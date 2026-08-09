import type { Hono } from 'hono'
import { renderToStaticMarkup } from 'react-dom/server'
import { Embed } from '../components/embed'
import { db } from '../db'
import { resolveHandle } from '../handles'
import { getHotPosts } from '../hot'
import { enrichPosts } from '../posts'
import { ACCENT_CHOICES, THEME_CHOICES, type AccentChoice, type ThemeChoice } from '../theme'
import type { PostView } from '../types'

const LIMIT = 5

function choice<T extends readonly string[]>(value: string | undefined, choices: T, fallback: T[number]) {
  return choices.includes(value as T[number]) ? value as T[number] : fallback
}

function response(request: Request, posts: PostView[], title: string, href: string) {
  const url = new URL(request.url)
  const theme = choice(url.searchParams.get('theme') || undefined, THEME_CHOICES, 'system') as ThemeChoice
  const accent = choice(url.searchParams.get('accent') || undefined, ACCENT_CHOICES, 'theme') as AccentChoice
  return new Response('<!doctype html>' + renderToStaticMarkup(
    <Embed posts={posts} title={title} href={href} theme={theme} accent={accent} />,
  ), { headers: { 'content-type': 'text/html;charset=utf-8' } })
}

function latest(where = '', parameters: Array<string | number> = []) {
  return enrichPosts(db, db.query(`SELECT p.*,u.handle FROM posts p JOIN users u ON u.id=p.user_id
    ${where ? `WHERE ${where} AND` : 'WHERE'} p.deleted_at IS NULL AND u.deleted_at IS NULL
    ORDER BY p.id DESC LIMIT ?`).all(...parameters, LIMIT) as PostView[], -1)
}

export function registerEmbedRoutes(app: Hono) {
  app.get('/embed/latest', c => response(c.req.raw, latest(), 'latest', '/latest'))
  app.get('/embed/hot', c => response(c.req.raw,
    enrichPosts(db, getHotPosts(db, LIMIT, null, new Date(), -1, true), -1), 'hot', '/hot'))
  app.get('/embed/user/:handle', c => {
    const resolved = resolveHandle(db, c.req.param('handle'))
    if (!resolved) return c.text('Not found', 404)
    if (resolved.alias) return c.redirect(`/embed/user/${resolved.handle}${new URL(c.req.url).search}`, 301)
    return response(c.req.raw, latest('p.user_id=?', [resolved.id]), `@${resolved.handle}`, `/u/${resolved.handle}`)
  })
  app.get('/embed/tag/:tag', c => {
    const tag = c.req.param('tag').toLowerCase()
    const posts = latest('EXISTS(SELECT 1 FROM post_hashtags ph WHERE ph.post_id=p.id AND ph.tag=?)', [tag])
    return response(c.req.raw, posts, `#${tag}`, `/tag/${encodeURIComponent(tag)}`)
  })
  app.get('/embed/post/:id', c => {
    const id = Number(c.req.param('id'))
    const row = Number.isInteger(id) && id > 0
      ? db.query(`SELECT p.*,u.handle FROM posts p JOIN users u ON u.id=p.user_id
        WHERE p.id=? AND p.deleted_at IS NULL AND u.deleted_at IS NULL`).get(id) as PostView | null
      : null
    if (!row) return c.text('Not found', 404)
    return response(c.req.raw, enrichPosts(db, [row], -1), `post ${id}`, `/post/${id}`)
  })
}
