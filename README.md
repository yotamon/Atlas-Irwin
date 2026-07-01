## Release Management

## Atlas Release Engine

Atlas Release Engine is the private release-management and audience-growth studio at `/studio`. Supabase is the canonical catalog for homepage publishing, media, and platform links. Legacy `public/releases/` folders remain as import input only. See `docs/catalog-architecture.md` for the full model, storage rules, import flow, and rollback strategy.

### Environment

Copy `.env.example` to `.env.local` and set values, or pull what Vercel allows locally:

```bash
npm run env:restore
```

That merges all variable names from Vercel production + preview into `.env.local`. Vercel only exports non-sensitive values via CLI (Supabase URL/anon keys, Postgres host). **Sensitive secrets** (`STUDIO_PASSWORD`, `SUPABASE_SERVICE_ROLE_KEY`, SMTP, SoundCloud, Spotify, MailerLite, etc.) must be copied manually from [Vercel → atlas-irwin → Environment Variables](https://vercel.com/cart-shift/atlas-irwin/settings/environment-variables) (click the eye icon on each). You can also regenerate `SUPABASE_SERVICE_ROLE_KEY` from [Supabase → Project Settings → API](https://supabase.com/dashboard/project/zhyjnpajlvwwbvuryeyv/settings/api-keys).

Required variables:

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
STUDIO_ADMIN_EMAILS=artist@example.com
STUDIO_PASSWORD=your-studio-password
STUDIO_IMPORT_ADMIN_EMAIL=artist@example.com
PUBLIC_CATALOG_OWNER_ID=
SOUNDCLOUD_CLIENT_ID=
SOUNDCLOUD_CLIENT_SECRET=
SOUNDCLOUD_REDIRECT_URI=https://atlasirwin.com/studio/soundcloud/callback
SPOTIFY_CLIENT_ID=
SPOTIFY_CLIENT_SECRET=
SPOTIFY_REDIRECT_URI=https://atlasirwin.com/studio/spotify/callback
SPOTIFY_ARTIST_ID=
```

`NEXT_PUBLIC_SUPABASE_ANON_KEY` may contain Supabase's current publishable key or the legacy anon key. Only the URL and publishable/anon key are browser-visible. The service-role/secret key remains server-only and is used by local Studio bootstrap, catalog synchronization, token storage, and explicit import/seed scripts.

### Supabase setup

1. Create a Supabase project.
2. Apply all migrations in `supabase/migrations/`, including `20260701000000_catalog_publishing_system.sql`, or link the Supabase CLI and run `npx supabase db push`.
3. In Authentication → URL Configuration, set the production site URL and add `http://localhost:3000/studio/auth/callback` plus the production `/studio/auth/callback` URL as redirects.
4. Set `STUDIO_PASSWORD` in `.env.local`.
5. Sign in at `/studio/login` with that password. Email is optional when only one admin is allowlisted. The migration trigger creates a profile on first sign-in.
6. In the SQL Editor, explicitly approve that profile:

```sql
update public.profiles
set is_admin = true
where email = 'artist@example.com';
```

The email must also appear in `STUDIO_ADMIN_EMAILS`. Both checks are required. Tables and the private `studio-assets` bucket use RLS; anonymous access is revoked. If the Data API is configured as private, expose the `public` schema to `authenticated` only.

Local development bypasses login for requests served from `localhost`, `127.0.0.1`, or `::1`: run `npm run dev` and open `http://localhost:3000/studio` directly. With `SUPABASE_SERVICE_ROLE_KEY` set in `.env.local`, Studio creates/approves the local admin profile when needed, so reads and writes work without entering a password. Production still requires the Studio password and admin allowlist.

### SoundCloud Studio integration

Create a SoundCloud developer application and add `/studio/soundcloud/callback` as the redirect URL. Set `SOUNDCLOUD_CLIENT_ID`, `SOUNDCLOUD_CLIENT_SECRET`, and optionally `SOUNDCLOUD_REDIRECT_URI`. The Studio SoundCloud hub uses OAuth 2.1 with PKCE. Sync updates staging tables and metrics only; unmatched tracks appear in the reconciliation queue instead of silently creating releases.

### Spotify Studio integration

Create a Spotify developer app and register the exact production callback URL
`https://atlasirwin.com/studio/spotify/callback`. For local development, Spotify
does not allow `localhost`: register
`http://127.0.0.1:3000/studio/spotify/callback`, set that exact value in
`SPOTIFY_REDIRECT_URI`, and open Studio through `http://127.0.0.1:3000`.
Set `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, and optionally
`SPOTIFY_REDIRECT_URI` and `SPOTIFY_ARTIST_ID`. Run the Spotify migration, then
connect from Studio → Spotify.

The integration uses authorization code flow with PKCE and state validation,
stores tokens only in the private schema, syncs artist releases/tracks and the
connected account's playlists and top-item pulse, imports catalog releases into
Release Engine, and creates campaign playlists only on explicit submission.
Spotify Web API does not expose Spotify for Artists stream, listener, save, or
playlist-add analytics; those remain manual in Studio Analytics.

Spotify Development Mode currently requires the app owner to have Premium and
limits the app to five allowlisted users. This private Studio integration fits
that mode; wider public access requires Spotify's applicable quota approval.

### Studio workflow

The primary Studio navigation is organized around the artist workflow: Command Center,
Releases, Campaigns, Media Library, Data Health, Analytics, and Brand / Creative.
Each release opens as a complete workspace instead of a catalog row.

- Create a release under Studio → Releases, fill its story fields, then generate its deterministic release identity.
- Generate a content pack from the release. Drafts remain editable and nothing is posted automatically.
- Date content in Content Lab; it appears in Calendar.
- Add outreach contacts and log copy-ready messages and follow-ups. No email or DM is sent.
- Add manual metric snapshots and link them to content to rank performance using the documented weights in `lib/studio/performance.ts`.
- Update reusable creative direction in Brand.
- Resolve catalog, website, reconciliation, and metadata issues in Data Health.
- Use the release Website tab for the public catalog state; successful mutations
  invalidate the `public-catalog` cache tag and update the homepage without redeploying.

### Import existing public releases

Public manifests are synchronized automatically whenever Releases opens. The explicit importer remains available for maintenance or deployment workflows:

```bash
npm run studio:import
```

The importer reads `public/releases/*/release.json`, upserts draft Studio releases and tracks by slug/title, records the public path, and never writes, deletes, or mutates public files. It is safe to run repeatedly.

Optional local demo data is guarded and never runs automatically:

```bash
# Set ALLOW_STUDIO_DEMO_SEED=true in .env.local first
npm run studio:seed
```

### Security and deployment

- Deploy the environment variables to Vercel, keeping the service-role/secret value server-only.
- Studio responses are `private, no-store`, carry `X-Robots-Tag: noindex, nofollow, noarchive`, and are excluded by `robots.txt`.
- The proxy refreshes cookie-based Supabase sessions and rejects unauthenticated or non-allowlisted users before protected Studio routes render. Server layouts repeat authorization; RLS is the final data boundary.
- Private assets use signed/authenticated Storage access. Do not turn the `studio-assets` bucket public.
- The public-site sync status is informational in v1. Promotion from Studio to `public/releases` remains a reviewed, manual deployment step.

### Public homepage catalog

The homepage release player reads live catalog data from Supabase via `getPublicReleases()`.
Publish releases in Studio, enable homepage placement, and the site updates through cache
revalidation — no redeploy required. Legacy `public/releases/` folders are import input only;
see `docs/catalog-architecture.md` and `public/releases/README.md` for the full model.

### Local development

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Set `NEXT_PUBLIC_SITE_URL` to the production HTTPS origin, for example
`https://atlasirwin.com`. Production builds force non-local site URLs to HTTPS
for metadata, robots, and sitemap output.

### HTTPS and security headers

The app redirects production HTTP requests to HTTPS and sends HSTS, CSP,
clickjacking, content-sniffing, referrer, and browser permissions headers from
`next.config.ts`. Keep TLS certificate and HTTP-to-HTTPS support enabled on the
production host as the outer edge layer.

### Contact form email

The contact form sends messages to `atlas.irwin.music@gmail.com` through SMTP.
Create a local `.env.local` file using `.env.example` as the template, then add
the same variables to your production host.

For Gmail, use an app password for `CONTACT_SMTP_PASS`; the regular account
password will not work.

### Newsletter signup

The newsletter form adds subscribers through the current MailerLite API.
Set `MAILERLITE_API_KEY` in `.env.local` and in production. If subscribers
should be added to a specific MailerLite group, set `MAILERLITE_GROUP_IDS` to
one or more comma-separated group IDs.

### Windows ARM64 note

If `next build` fails with missing native CSS binaries such as
`lightningcss.win32-arm64-msvc.node` or `tailwindcss-oxide.win32-arm64-msvc.node`,
run `npm run postinstall`. The script downloads the correct native bindings when npm
and Node report different CPU targets.
