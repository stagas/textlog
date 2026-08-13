import { appHost, appName, appOrigin } from '../brand'
import { activeAppearance, activeRequest, activeThemeLogoSvg, activeThemeStyles } from '../theme'

import React from 'react'
import { instance } from '../../instance.config'
import { isAdmin } from '../admin'
import type { User } from '../db'

let devReloadBootId: string | undefined

export function configureDevReload(bootId?: string) {
  devReloadBootId = bootId
}

export function Layout({
  title,
  user,
  social,
  pageUrl,
  feeds,
  notificationBanner = false,
  logoutNavigation = false,
  children,
}: {
  title?: string
  user?: User | null
  logoutNavigation?: boolean
  social?: { description: string; image: string; url: string; type?: 'article' | 'profile' | 'website';
    imageAlt?: string }
  pageUrl?: string
  feeds?: { title: string; rss: string; atom: string }
  notificationBanner?: boolean
  children: React.ReactNode
}) {
  const selectedAppearance = activeAppearance()
  const appearanceVersion = `${selectedAppearance.theme}.${selectedAppearance.accent}`
  const themeCss = activeThemeStyles()
  const logoSvg = activeThemeLogoSvg()
  const name = appName()
  const origin = appOrigin()
  const requestUrl = new URL(activeRequest().url)
  const currentPath = requestUrl.pathname + requestUrl.search
  const profileHref = user ? `/u/${user.handle}?from=${encodeURIComponent(currentPath)}` : ''
  const accountFrom = requestUrl.pathname.startsWith('/account')
    ? requestUrl.searchParams.get('from') || `/u/${user?.handle || ''}`
    : currentPath
  const accountHref = '/account/edit?from=' + encodeURIComponent(accountFrom)
  const share = social || {
    description: 'A quieter place for your thoughts.',
    image: `${origin}/og.png?v=2`,
    url: pageUrl || (origin ? `${origin}/` : ''),
    type: 'website' as const,
    imageAlt: name,
  }
  // Older callers that predate the marker already represent established accounts.
  const ready = user?.handle_chosen_at !== null
  const navigation = user && ready
    ? (
      <>
        <span className="account-nav-row account-nav-secondary">
          <a href="/explore">explore</a>
        </span>
        <span className="account-nav-row account-nav-primary">
          <a href="/write">write</a>
          {isAdmin(user) && <a href="/admin">admin</a>}
          <div className="account-menu">
            <a className="account-menu-handle" href={profileHref}>@{user.handle}</a>
            <div className="account-menu-popover">
              <a href={profileHref}>profile</a>
              <a href={accountHref}>account</a>
              <form method="post" action="/logout">
                <button type="submit">logout</button>
              </form>
            </div>
          </div>
        </span>
      </>
    )
    : user
    ? <a className="button" href="/choose-handle">choose handle</a>
    : (
      <>
        <a href="/explore">explore</a>
        <a className="button" href="/enter" rel="nofollow">enter</a>
      </>
    )
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <meta name="color-scheme" content="light dark" />
        <title>{`${title ? `${title} · ` : ''}${name}`}</title>
        <>
          <meta name="description" content={share.description} />
          <meta property="og:type" content={share.type || 'article'} />
          <meta property="og:site_name" content={name} />
          <meta property="og:title" content={title || name} />
          <meta property="og:description" content={share.description} />
          {share.url && <meta property="og:url" content={share.url} />}
          <meta property="og:image" content={share.image} />
          <meta property="og:image:secure_url" content={share.image} />
          <meta property="og:image:type" content="image/png" />
          <meta property="og:image:width" content="1200" />
          <meta property="og:image:height" content="630" />
          <meta property="og:image:alt" content={share.imageAlt || `Post by ${title || `a ${name} user`}`} />
          <meta name="twitter:card" content="summary_large_image" />
          <meta name="twitter:title" content={title || name} />
          <meta name="twitter:description" content={share.description} />
          <meta name="twitter:image" content={share.image} />
          <meta name="twitter:image:width" content="1200" />
          <meta name="twitter:image:height" content="630" />
          <meta name="twitter:image:alt" content={share.imageAlt || `Post by ${title || `a ${name} user`}`} />
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
        <link rel="stylesheet" href="/styles.css?v=228" />
        <style>{themeCss}</style>
      </head>
      <body>
        {user && ready && <a className="skip-link" href="/write">write</a>}
        <a className="skip-link" href="#main-content">skip to content</a>
        <header className={user ? 'authenticated-header' : undefined}>
          <a className="brand" href="/" aria-label={`${name} home`}>
            <span className="brand-logo" aria-hidden="true" dangerouslySetInnerHTML={{ __html: logoSvg }} />
            <span>{name}</span>
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
        {notificationBanner && (
          <aside className="notification-banner" aria-label="Notification reminder">
            <a href="/account/edit/notifications">enable notifications</a>
            <span aria-hidden="true">·</span>
            <form method="post" action="/notifications/banner/dismiss">
              <button className="quiet">dismiss</button>
            </form>
          </aside>
        )}
        <main id="main-content">{children}</main>
        <footer className="site-footer">
          <span>{appHost()}</span>
          {instance.links.getMobileApp && (
            <a
              className="button mobile-app-footer"
              href={instance.links.getMobileApp}
              target="_blank"
              rel="noopener noreferrer"
            >
              get mobile app
            </a>
          )}
          <nav aria-label="Footer">
            <a href="/about">about</a>
            <a href="/api">api</a>
            {instance.links.irc && <a href={instance.links.irc} target="_blank" rel="noopener noreferrer">irc</a>}
            {instance.links.github && (
              <a href={instance.links.github} target="_blank" rel="noopener noreferrer">github</a>
            )}
            {instance.links.donate && (
              <a href={instance.links.donate} target="_blank" rel="noopener noreferrer">donate</a>
            )}
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
