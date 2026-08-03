# root.mx

Server-rendered, text-first social web app powered by Bun, SQLite, and TSX. There is no client-side JavaScript bundle: pages are composed on the backend and returned as static HTML.

## Run

```sh
bun install
bun run dev
```

Open http://localhost:3000. Data is stored in `storage/root.sqlite` using Bun's current `Database` API.

In development, the browser automatically reloads after Bun restarts the server.

Set `OPENAI_API_KEY` in the server environment to moderate posts and replies before insertion. root.mx uses OpenAI's free Moderation endpoint with `omni-moderation-latest` and rejects submissions when moderation is unavailable.

Password reset emails use Resend. Set `RESEND_API_KEY`, `EMAIL_FROM` (a verified sender such as `root.mx <hello@root.mx>`), and the public `APP_URL` (such as `https://root.mx`). Reset links are single-use and expire after one hour.

`APP_URL` is also used for absolute Open Graph URLs. Each post exposes a dynamically rendered 1200×630 PNG at `/post/:id/og.png`.

To temporarily disable moderation, set `MODERATION_DISABLED=true`. Remove the variable or set it to `false` to re-enable it.

## Included

- Accounts with secure random cookie sessions and hashed passwords
- 280-character posts with safe hashtag and mention links
- Following, global-hot, and global-latest feeds with first-run guidance
- Activity inbox for replies and @mentions
- Profiles, follow/unfollow, hashtag pages, tag follow/unfollow, and explore
- Responsive monospace interface with inline server-generated CSS
