import React from 'react'
import type { User } from '../db'

let devReloadBootId: string | undefined

export function configureDevReload(bootId?: string) {
  devReloadBootId = bootId
}

export function Layout({
  title,
  user,
  social,
  children,
}: {
  title?: string
  user?: User | null
  social?: { description: string; image: string; url: string; type?: 'article' | 'profile' | 'website'; imageAlt?: string }
  children: React.ReactNode
}) {
  const appOrigin = Bun.env.APP_URL?.replace(/\/$/, '') || ''
  const share = social || {
    description: 'A quieter place for your thoughts.',
    image: `${appOrigin}/og.png`,
    type: 'website' as const,
    imageAlt: 'root.mx logo',
  }
  return (
    <html>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <meta name="color-scheme" content="light dark" />
        <title>{`${title ? `${title} · ` : ''}root.mx`}</title>
        <>
            <meta name="description" content={share.description} />
            <meta property="og:type" content={share.type || 'article'} />
            <meta property="og:site_name" content="root.mx" />
            <meta property="og:title" content={title || 'root.mx'} />
            <meta property="og:description" content={share.description} />
            {social && <meta property="og:url" content={social.url} />}
            <meta property="og:image" content={share.image} />
            <meta property="og:image:width" content="1200" />
            <meta property="og:image:height" content="630" />
            <meta property="og:image:alt" content={share.imageAlt || `Post by ${title || 'a root.mx user'}`} />
            <meta name="twitter:card" content="summary_large_image" />
            <meta name="twitter:title" content={title || 'root.mx'} />
            <meta name="twitter:description" content={share.description} />
            <meta name="twitter:image" content={share.image} />
            <meta name="twitter:image:alt" content={share.imageAlt || `Post by ${title || 'a root.mx user'}`} />
          </>
        <link rel="icon" href="/root.svg" type="image/svg+xml" />
        <link rel="stylesheet" href="/styles.css?v=29" />
      </head>
      <body>
        <header>
          <a className="brand" href="/" aria-label="root.mx home">
            <img className="brand-logo" src="/root.svg" alt="" />
            <span>
              root<span className="brand-dot">.</span>mx
            </span>
          </a>
          {user
            ? (
              <nav className="account-nav">
                <a href={`/u/${user.handle}`}>@{user.handle}</a>
                <a href="/explore">explore</a>
                <a href="/activity">activity</a>
                <a href="/compose">write</a>
                <form method="post" action="/logout">
                  <button className="nav-action">logout</button>
                </form>
              </nav>
            )
            : (
              <nav className="guest-nav">
                <a href="/login">login</a>
                <a className="button" href="/signup">join</a>
              </nav>
            )}
        </header>
        <main>{children}</main>
        <footer className="site-footer">
          <span>root.mx</span>
          <nav aria-label="Footer">
            <a href="/about">about</a>
            <a href="https://github.com/stagas/root-mx">github</a>
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
