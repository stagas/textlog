import { appHost, appName, appOrigin } from '../brand'
import { pwaInstallBannerDismissed, pwaStandalone } from '../http'
import {
  activeAppearance,
  activeRequest,
  activeThemeBackgrounds,
  activeThemeLogoSvg,
  activeThemeStyles,
  cornerChoice,
} from '../theme'

import React from 'react'
import { instance } from '../../instance.config'
import { isAdmin } from '../admin'
import { resolvedDensity } from '../request-preferences'
import type { User } from '../types'
import { isMobileRequest } from '../user-agent'
import { enterHref } from './auth-links'
import { LogoutForm } from './logout-form'

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
  mobileWriteAction = false,
  fullScreen = false,
  children,
}: {
  title?: string
  user?: User | null
  logoutNavigation?: boolean
  social?: { title?: string; description: string; image: string; url: string; type?: 'article' | 'profile' | 'website';
    imageAlt?: string }
  pageUrl?: string
  feeds?: { title: string; rss: string; atom: string }
  notificationBanner?: false | 'notifications' | 'appearance' | 'invite' | 'bio' | 'notification-update' | 'donate'
  mobileWriteAction?: boolean
  fullScreen?: boolean
  children: React.ReactNode
}) {
  const selectedAppearance = activeAppearance()
  const request = activeRequest()
  const density = resolvedDensity(request)
  const mobile = isMobileRequest(request)
  const standalone = pwaStandalone(request)
  const showPwaInstallBanner = mobile && !standalone && !pwaInstallBannerDismissed(request)
  const corners = cornerChoice(request)
  const appearanceVersion = `${selectedAppearance.theme}.${selectedAppearance.accent}`
  const themeCss = activeThemeStyles()
  const themeBackgrounds = activeThemeBackgrounds()
  const logoSvg = activeThemeLogoSvg()
  const name = appName()
  const origin = appOrigin()
  const requestUrl = new URL(request.url)
  const anonymousEnterHref = ['/hot', '/any', '/all'].includes(requestUrl.pathname) ? '/enter' : enterHref()
  const instantScroll = /(?:^|;\s*)textlog_scroll=instant(?:;|$)/.test(request.headers.get('cookie') || '')
  const showGuestJoin = !user && ['/hot', '/all'].includes(requestUrl.pathname)
  const onWritePage = requestUrl.pathname === '/write'
  const onFeedPage = ['/@', '/my-feed', '/hot', '/any', '/all'].includes(requestUrl.pathname)
  const currentPath = requestUrl.pathname + requestUrl.search
  const writeShortcutHref = onWritePage
    ? '/write'
    : '/write?from=' + encodeURIComponent(currentPath)
  const profileHref = user ? `/u/${user.handle}?from=${encodeURIComponent(currentPath)}` : ''
  const accountFrom = requestUrl.pathname.startsWith('/account')
    ? requestUrl.searchParams.get('from') || `/u/${user?.handle || ''}`
    : currentPath
  const accountHref = '/account/edit?from=' + encodeURIComponent(accountFrom)
  const share = social || {
    description: 'The quieter social microblogging platform.',
    image: `${origin}/og.png?v=2`,
    url: pageUrl || (origin ? `${origin}/` : ''),
    type: 'website' as const,
    imageAlt: name,
  }
  // Older callers that predate the marker already represent established accounts.
  const ready = user?.handle_chosen_at !== null
  const accountMenuPopover = user && (
    <div className="account-menu-popover">
      {isAdmin(user) && <a href="/admin">admin</a>}
      <a href={profileHref}>profile</a>
      <a href={accountHref}>account</a>
      <a href="/bookmarks">bookmarks</a>
      <LogoutForm>
        <button type="submit">logout</button>
      </LogoutForm>
    </div>
  )
  const navigation = user && ready
    ? (
      <>
        <span className="account-nav-row account-nav-secondary">
          <a href="/explore">explore</a>
          {!!user.draft_count && <a href="/drafts">drafts</a>}
        </span>
        <span className="account-nav-row account-nav-primary">
          {mobile
            ? (
              <details className="account-menu">
                <summary className="account-menu-handle">
                  @{user.handle}
                  {user.mood
                    && <span className="nav-mood">{user.mood}</span>}
                </summary>
                {accountMenuPopover}
              </details>
            )
            : (
              <div className="account-menu">
                <a className="account-menu-handle" href={profileHref}>
                  @{user.handle}
                  {user.mood
                    && <span className="nav-mood">{user.mood}</span>}
                </a>
                {accountMenuPopover}
              </div>
            )}
          {!onWritePage && !onFeedPage && <a className="button nav-write-action" href="/write">write</a>}
        </span>
      </>
    )
    : user
    ? <a className="button" href="/choose-handle">choose handle</a>
    : (
      <>
        <a href="/explore">explore</a>
        <a className="button" href={anonymousEnterHref} rel="nofollow">enter</a>
      </>
    )
  return (
    <html lang="en" className={instantScroll ? 'scroll-instant' : undefined}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <meta name="color-scheme" content="light dark" />
        {'default' in themeBackgrounds
          ? <meta name="theme-color" content={themeBackgrounds.default} />
          : (
            <>
              <meta name="theme-color" content={themeBackgrounds.light} media="(prefers-color-scheme: light)" />
              <meta name="theme-color" content={themeBackgrounds.dark} media="(prefers-color-scheme: dark)" />
            </>
          )}
        <title>{`${title ? `${title} · ` : ''}${name}`}</title>
        <>
          <meta name="description" content={share.description} />
          <meta property="og:type" content={share.type || 'article'} />
          <meta property="og:site_name" content={name} />
          <meta property="og:title" content={share.title || title || name} />
          <meta property="og:description" content={share.description} />
          {share.url && <meta property="og:url" content={share.url} />}
          <meta property="og:image" content={share.image} />
          <meta property="og:image:secure_url" content={share.image} />
          <meta property="og:image:type" content="image/png" />
          <meta property="og:image:width" content="1200" />
          <meta property="og:image:height" content="630" />
          <meta property="og:image:alt" content={share.imageAlt || `Post by ${title || `a ${name} user`}`} />
          <meta name="twitter:card" content="summary_large_image" />
          <meta name="twitter:title" content={share.title || title || name} />
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
        {mobile && <link href="https://fonts.cdnfonts.com/css/dejavu-sans-mono" rel="stylesheet" />}
        <link rel="stylesheet" href="/styles.css?v=1308" />
        <style>{themeCss}</style>
      </head>
      <body
        className={`density-${density}${corners === 'round' ? ' corners-round' : ''}${mobile ? ' mobile-agent' : ''}${
          user?.show_link_previews === 0 ? ' link-previews-disabled' : ''
        }${mobileWriteAction ? ' has-mobile-write-action' : ''}${fullScreen ? ' full-screen-page' : ''}`}
      >
        {!fullScreen && user && ready && <a className="skip-link" href={writeShortcutHref} accessKey="w">write</a>}
        {!fullScreen && <a className="skip-link" href="#main-content">skip to content</a>}
        {!fullScreen && (
          <header className={user ? 'authenticated-header' : undefined}>
            <a className="brand" href="/" aria-label={`${name} home`}>
              <span className="brand-logo" aria-hidden="true" dangerouslySetInnerHTML={{ __html: logoSvg }} />
              <span>{name}</span>
            </a>
            {logoutNavigation
              ? (
                <nav aria-label="Account">
                  <LogoutForm>
                    <button className="quiet">logout</button>
                  </LogoutForm>
                </nav>
              )
              : (
                <nav className={user ? 'account-nav' : 'guest-nav'}>
                  {navigation}
                </nav>
              )}
          </header>
        )}
        {!fullScreen && showPwaInstallBanner && !notificationBanner && requestUrl.pathname !== '/install' && (
          <aside className="notification-banner install-banner" aria-label="Install app">
            <a href="/install">install to home screen</a>
            <form method="post" action="/install/banner/dismiss">
              <button className="quiet">dismiss</button>
            </form>
          </aside>
        )}
        {!fullScreen && notificationBanner && (
          <aside className="notification-banner" aria-label={notificationBanner === 'notification-update'
            ? 'Notification update'
            : notificationBanner === 'donate'
            ? 'Support us on Open Collective'
            : 'Account setup reminder'}
          >
            <a href={notificationBanner === 'donate' ? '/donation/banner/accept' : notificationBanner === 'appearance'
              ? '/account/edit/appearance'
              : notificationBanner === 'invite'
              ? '/account/edit/invite'
              : notificationBanner === 'bio'
              ? '/bio/banner/accept'
              : '/account/edit/notifications'}
              className={notificationBanner === 'donate' ? 'notification-banner-donate-link' : undefined}
              {...notificationBanner === 'donate' ? { target: '_blank', rel: 'noopener noreferrer' } : {}}
            >
              {notificationBanner === 'donate'
                ? '❤️ support us on open collective'
                : notificationBanner === 'appearance'
                ? 'customize appearance'
                : notificationBanner === 'invite'
                ? 'invite friends'
                : notificationBanner === 'bio'
                ? 'edit your bio'
                : notificationBanner === 'notification-update'
                ? 'check the improved notifications'
                : 'enable notifications'}
            </a>
            <form method="post" action={notificationBanner === 'donate'
              ? '/donation/banner/dismiss'
              : notificationBanner === 'appearance'
              ? '/appearance/banner/dismiss'
              : notificationBanner === 'invite'
              ? '/invite/banner/dismiss'
              : notificationBanner === 'bio'
              ? '/bio/banner/dismiss'
              : notificationBanner === 'notification-update'
              ? '/notifications/improvements/dismiss'
              : '/notifications/banner/dismiss'}
            >
              <button className="quiet">{notificationBanner === 'donate' ? 'will donate later' : 'dismiss'}</button>
            </form>
          </aside>
        )}
        {!fullScreen && user && ready && mobileWriteAction && <MobileWriteAction />}
        <main id="main-content">{children}</main>
        {!fullScreen && showGuestJoin && (
          <div className="guest-join-row">
            <a className="button" href="/enter" rel="nofollow">join the community</a>
          </div>
        )}
        {!fullScreen && (
          <footer className="site-footer">
            <span>
              <a className="footer-host-link" href="/">{appHost()}</a> <span aria-hidden="true">/</span>{' '}
              <a className="footer-host-link" href="/stats">stats</a>
            </span>
            {((instance.links.getMobileApp && !standalone) || (user && ready)) && (
              <div className="footer-mobile-actions">
                {instance.links.getMobileApp && !standalone && (
                  <a
                    className="button mobile-app-footer"
                    href={instance.links.getMobileApp}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    get mobile app
                  </a>
                )}
                {user && ready && (
                  <a className="button footer-write-action" href="#main-content">write a note</a>
                )}
              </div>
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
        )}
        {devReloadBootId && <DevReload bootId={devReloadBootId} />}
      </body>
    </html>
  )
}

export function MobileWriteAction() {
  return (
    <div className="mobile-write-action">
      <a className="button" href="#">write</a>
    </div>
  )
}

function DevReload({ bootId }: { bootId: string }) {
  return (
    <script dangerouslySetInnerHTML={{ __html: `
    (() => {
      const bootId = ${JSON.stringify(bootId)};
      const check = async () => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 750);
        try {
          const response = await fetch('/__dev/restart?t=' + Date.now(), {
            cache: 'no-store',
            signal: controller.signal,
          });
          const current = response.ok ? (await response.json()).bootId : null;
          if (current && current !== bootId) {
            window.location.reload();
            return;
          }
        } catch {
          // A busy server can miss a poll without having restarted.
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
