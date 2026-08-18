import type { Hono } from 'hono'
import { renderToStaticMarkup } from 'react-dom/server'
import { Embed } from '../components/embed'
import { databaseService } from '../database-service'
import { ACCENT_CHOICES, type AccentChoice, EMBED_FONT_CHOICES, type EmbedFontChoice, THEME_CHOICES,
  type ThemeChoice } from '../theme'
import type { PostView } from '../types'

function choice<T extends readonly string[]>(value: string | undefined, choices: T, fallback: T[number]) {
  return choices.includes(value as T[number]) ? value as T[number] : fallback
}

function response(request: Request, posts: PostView[], title: string, href: string) {
  const url = new URL(request.url)
  const themeValue = url.searchParams.get('theme') || ''
  const theme = THEME_CHOICES.includes(themeValue as ThemeChoice) ? themeValue as ThemeChoice : undefined
  const accent = choice(url.searchParams.get('accent') || undefined, ACCENT_CHOICES, 'theme') as AccentChoice
  const fontValue = url.searchParams.get('font') || ''
  const font = Object.hasOwn(EMBED_FONT_CHOICES, fontValue) ? fontValue as EmbedFontChoice : undefined
  return new Response('<!doctype html>' + renderToStaticMarkup(
    <Embed posts={posts} title={title} href={href} theme={theme} accent={accent} font={font} />,
  ), { headers: { 'content-type': 'text/html;charset=utf-8' } })
}

export function registerEmbedRoutes(app: Hono) {
  app.get('/embed/latest', async c => {
    const data = await databaseService().call('embeds.load', { kind: 'latest' })
    return response(c.req.raw, data!.posts, data!.title, data!.href)
  })
  app.get('/embed/hot', async c => {
    const data = await databaseService().call('embeds.load', { kind: 'hot' })
    return response(c.req.raw, data!.posts, data!.title, data!.href)
  })
  app.get('/embed/user/:handle', async c => {
    const data = await databaseService().call('embeds.load', { kind: 'user', handle: c.req.param('handle') })
    if (!data) return c.text('Not found', 404)
    if (data.canonicalHandle) return c.redirect(`/embed/user/${data.canonicalHandle}${new URL(c.req.url).search}`, 301)
    return response(c.req.raw, data.posts, data.title, data.href)
  })
  app.get('/embed/tag/:tag', async c => {
    const tag = c.req.param('tag').toLowerCase()
    const data = await databaseService().call('embeds.load', { kind: 'tag', tag })
    return response(c.req.raw, data!.posts, data!.title, data!.href)
  })
  app.get('/embed/post/:id', async c => {
    const id = Number(c.req.param('id'))
    const data = await databaseService().call('embeds.load', { kind: 'post', id })
    if (!data) return c.text('Not found', 404)
    return response(c.req.raw, data.posts, data.title, data.href)
  })
}
