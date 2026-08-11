# textlog

### A quieter place for your thoughts.

[textlog](https://textlog.cc) is a simple social text log for sharing short notes, following people and hashtags, and joining conversations—without turning every thought into a performance.

Notes are limited to 280 characters. The constraint keeps them quick to write and easy to read, making room for one thought at a time.

## Small by design

textlog is built around words: notes, people, hashtags, and conversations. It is intentionally small, straightforward, and easy to follow.

- Write short, focused notes
- Follow people and hashtags you care about
- Reply, mention others, and take part in conversations
- Discover what is new or gaining attention
- Download or delete your account data whenever you like

There are no engagement tricks and no pressure to build an audience. Profiles and notes are public, and joining is free.

## Be a good neighbour

Share what is yours to share and treat other people with respect. Harassment, abuse, spam, impersonation, and unlawful content are not welcome. Content that puts the community or service at risk may be moderated or removed.

## Join in

[Browse notes](https://textlog.cc) or [join the community](https://textlog.cc/enter).

If you enjoy textlog, you can also [support the service](https://buymeacoffee.com/stagas).

## Local development

textlog runs on [Bun](https://bun.sh) with SQLite. To start a local copy:

```sh
bun install
bun run dev
```

Set `APP_NAME` and `APP_URL` in `.env` to give a self-hosted instance its own identity and public origin. The name is
used throughout pages, feeds, emails, embeds, API documentation, and install metadata. See `.env.example` for all
available settings. Session cookies and the trusted internal client-IP header also use a lowercase, URL-safe form of
the name; for example, `Notebook Garden` uses the `notebook-garden` cookie and `x-notebook-garden-client-ip` header.

Transactional email supports Resend, SendGrid, and Google SMTP through `EMAIL_PROVIDER`. Configure the selected
provider's credentials and `EMAIL_FROM` as documented in `.env.example`. Resend remains the default for compatibility.

Public instance details—operator contact information, administrator emails, privacy authority, and optional IRC,
GitHub, mobile-app, and donation links—live in `instance.config.ts`. Set an optional entry to `null` to omit it from the
rendered pages or footer.

Open [localhost:3000](http://localhost:3000). Run `bun run check` to type-check and test the project.

## Public archive

In production, textlog creates `public/dump.zip` at startup, refreshes it once per UTC day, and streams it from
[`/dump.zip`](https://textlog.cc/dump.zip). The archive is a paginated
read-only snapshot of public handles, bios, posts, reply links, mentions, hashtags, and follow relationships. It
deliberately excludes emails, passwords, sessions, deleted or suspended accounts and posts, blocks, reports,
moderation records, record timestamps, network identifiers, and other private or authentication data.

Run `bun run archive:public` to refresh it manually. Set `PUBLIC_ARCHIVE_PATH` to write and serve it elsewhere.

## License

textlog is open-source software licensed under the [AGPLv3 License](LICENSE).
