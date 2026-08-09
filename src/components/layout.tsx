import React from 'react'
import { hasUnreadActivity } from '../activity-state'
import { isAdmin } from '../admin'
import type { User } from '../db'
import { activeAppearance } from '../theme'

let devReloadBootId: string | undefined

function ActivityLink({ unread, className }: { unread: boolean; className?: string }) {
  return (
    <a className={`activity-link${className ? ` ${className}` : ''}`} href="/activity">
      {unread && (
        <>
          <span className="activity-unread-dot" aria-hidden="true" />
          <span className="sr-only">unread</span>
        </>
      )}
      activity
    </a>
  )
}

export function configureDevReload(bootId?: string) {
  devReloadBootId = bootId
}

export function Layout({
  title,
  user,
  social,
  feeds,
  logoutNavigation = false,
  children,
}: {
  title?: string
  user?: User | null
  logoutNavigation?: boolean
  social?: { description: string; image: string; url: string; type?: 'article' | 'profile' | 'website';
    imageAlt?: string }
  feeds?: { title: string; rss: string; atom: string }
  children: React.ReactNode
}) {
  const selectedAppearance = activeAppearance()
  const appearanceVersion = `${selectedAppearance.theme}.${selectedAppearance.accent}`
  const appOrigin = Bun.env.APP_URL?.replace(/\/$/, '') || ''
  const share = social || {
    description: 'A quieter place for your thoughts.',
    image: `${appOrigin}/og.png?v=2`,
    type: 'website' as const,
    imageAlt: 'textlog',
  }
  // Older callers that predate the marker already represent established accounts.
  const ready = user?.handle_chosen_at !== null
  const activityUnread = user && ready ? hasUnreadActivity(user.id) : false
  const navigation = user
    ? (
      <>
        <a className="mobile-footer-link" href="/explore">explore</a>
        {ready && <ActivityLink unread={activityUnread} className="mobile-footer-link" />}
        {ready && <a href="/write">write</a>}
        {ready && isAdmin(user) && <a href="/admin">admin</a>}
        {ready
          ? <a href={`/u/${user.handle}`}>@{user.handle}</a>
          : <a className="button" href="/choose-handle">choose handle</a>}
      </>
    )
    : (
      <>
        <a href="/explore">explore</a>
        <a className="button" href="/enter">enter</a>
      </>
    )
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <meta name="color-scheme" content="light dark" />
        <title>{`${title ? `${title} · ` : ''}textlog`}</title>
        <>
          <meta name="description" content={share.description} />
          <meta property="og:type" content={share.type || 'article'} />
          <meta property="og:site_name" content="textlog" />
          <meta property="og:title" content={title || 'textlog'} />
          <meta property="og:description" content={share.description} />
          {social && <meta property="og:url" content={social.url} />}
          <meta property="og:image" content={share.image} />
          <meta property="og:image:width" content="1200" />
          <meta property="og:image:height" content="630" />
          <meta property="og:image:alt" content={share.imageAlt || `Post by ${title || 'a textlog user'}`} />
          <meta name="twitter:card" content="summary_large_image" />
          <meta name="twitter:title" content={title || 'textlog'} />
          <meta name="twitter:description" content={share.description} />
          <meta name="twitter:image" content={share.image} />
          <meta name="twitter:image:alt" content={share.imageAlt || `Post by ${title || 'a textlog user'}`} />
        </>
        <link rel="icon" href={`/favicon-theme.svg?v=${appearanceVersion}`} type="image/svg+xml" sizes="any" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <link rel="manifest" href="/site.webmanifest" />
        <link rel="sitemap" href="/sitemap.xml" type="application/xml" />
        {feeds && (
          <>
            <link rel="alternate" type="application/rss+xml" title={`${feeds.title} (RSS)`} href={feeds.rss} />
            <link rel="alternate" type="application/atom+xml" title={`${feeds.title} (Atom)`} href={feeds.atom} />
          </>
        )}
        <link rel="stylesheet" href="/styles.css?v=61" />
        <link rel="stylesheet" href="/theme.css" />
      </head>
      <body>
        {user && ready && <a className="skip-link" href="/write">write</a>}
        <a className="skip-link" href="#main-content">skip to content</a>
        <header className={user ? 'authenticated-header' : undefined}>
          <a className="brand" href="/" aria-label="textlog home">
            <img className="brand-logo" src="/textlog.svg?v=2" alt="" />
            <span>textlog</span>
          </a>
          {logoutNavigation
            ? (
              <nav aria-label="Account">
                <form method="post" action="/logout">
                  <button className="quiet">logout</button>
                </form>
              </nav>
            )
            : (
              <nav className={user ? 'account-nav' : 'guest-nav'}>
                {navigation}
              </nav>
            )}
        </header>
        <main id="main-content">{children}</main>
        <footer className="site-footer">
          <span>textlog.cc</span>
          <a
            className="button mobile-app-footer"
            href="https://github.com/Faultless/textlog_flutter"
            target="_blank"
            rel="noopener noreferrer"
          >
            get mobile app
          </a>
          {user && ready && (
            <nav className="mobile-account-footer" aria-label="Account shortcuts">
              <a href="/explore">explore</a>
              <ActivityLink unread={activityUnread} />
            </nav>
          )}
          <nav aria-label="Footer">
            <a href="/about">about</a>
            <a href="/api">api</a>
            <a href="ircs://irc.libera.chat/#textlog" target="_blank" rel="noopener noreferrer">irc</a>
            <a href="https://github.com/stagas/textlog" target="_blank" rel="noopener noreferrer">github</a>
            <a href="https://buymeacoffee.com/stagas" target="_blank" rel="noopener noreferrer">donate</a>
            <a href="/contact">contact</a>
            <a href="/legal">legal</a>
          </nav>
        </footer>
        {devReloadBootId && <DevReload bootId={devReloadBootId} />}
      </body>
    </html>
  )
}

function DevReload({ bootId }: { bootId: string }) {
  return (
    <script dangerouslySetInnerHTML={{ __html: `
    (() => {
      const bootId = ${JSON.stringify(bootId)};
      let disconnected = false;
      const check = async () => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 750);
        try {
          const response = await fetch('/__dev/restart?t=' + Date.now(), {
            cache: 'no-store',
            signal: controller.signal,
          });
          const current = response.ok ? (await response.json()).bootId : null;
          if (current && (disconnected || current !== bootId)) {
            window.location.reload();
            return;
          }
          disconnected = !current;
        } catch {
          disconnected = true;
        } finally {
          clearTimeout(timeout);
        }
        setTimeout(check, 1000);
      };
      check();
    })();
  ` }} />
  )
}
