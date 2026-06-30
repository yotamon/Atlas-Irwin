## Release Management

## Atlas Release Engine

Atlas Release Engine is the private release-management and audience-growth studio at `/studio`. It adds release CRUD and readiness, deterministic release-story and content-pack generation, Content Lab kanban/list views, a publishing calendar, outreach CRM, manual analytics, and reusable brand direction. The public filesystem release loader remains separate and unchanged.

### Environment

Copy `.env.example` to `.env.local` and set:

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
STUDIO_ADMIN_EMAILS=artist@example.com
STUDIO_PASSWORD=your-studio-password
STUDIO_IMPORT_ADMIN_EMAIL=artist@example.com
SOUNDCLOUD_CLIENT_ID=
SOUNDCLOUD_CLIENT_SECRET=
SOUNDCLOUD_REDIRECT_URI=https://atlasirwin.com/studio/soundcloud/callback
```

`NEXT_PUBLIC_SUPABASE_ANON_KEY` may contain Supabase's current publishable key or the legacy anon key. Only the URL and publishable/anon key are browser-visible. The service-role/secret key is server-only and is used exclusively by explicit local import/seed scripts.

### Supabase setup

1. Create a Supabase project.
2. In the SQL Editor, run `supabase/migrations/20260630012751_atlas_release_engine.sql`, or link the Supabase CLI and run `npx supabase db push`.
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

Local development bypasses login for requests served from `localhost`, `127.0.0.1`, or `::1`: open `http://localhost:3000/studio` directly. With `SUPABASE_SERVICE_ROLE_KEY` set in `.env.local`, local Studio writes use the first `STUDIO_ADMIN_EMAILS` profile, so saves work without an auth session. In production, Studio requires the studio password and the admin allowlist.

### SoundCloud Studio integration

Create a SoundCloud developer application and add `/studio/soundcloud/callback` as the redirect URL. Set `SOUNDCLOUD_CLIENT_ID`, `SOUNDCLOUD_CLIENT_SECRET`, and optionally `SOUNDCLOUD_REDIRECT_URI`. The Studio SoundCloud hub uses OAuth 2.1 with PKCE, stores access/refresh tokens only in the private database schema, and lets approved Studio admins sync SoundCloud tracks/playlists, import synced tracks as Studio releases, upload audio to SoundCloud, and create SoundCloud metric snapshots from track counts.

### Studio workflow

- Create a release under Studio → Releases, fill its story fields, then generate its deterministic release identity.
- Generate a content pack from the release. Drafts remain editable and nothing is posted automatically.
- Date content in Content Lab; it appears in Calendar.
- Add outreach contacts and log copy-ready messages and follow-ups. No email or DM is sent.
- Add manual metric snapshots and link them to content to rank performance using the documented weights in `lib/studio/performance.ts`.
- Update reusable creative direction in Brand.

### Import existing public releases

After the approved admin profile exists:

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

This site now auto-imports music releases from the filesystem. To add a new release, create a folder inside `public/releases` and follow the same shape as `public/releases/_template`.

### Folder structure

```text
public/releases/
  my-release/
    cover.jpg
    release.json
```

### Minimal workflow

1. Duplicate `public/releases/_template`.
2. Rename the folder to your release slug, for example `late-night-systems`.
3. Replace `cover.jpg` or `cover.png` with your own artwork.
4. Add each SoundCloud track URL to `release.json` with `soundcloudUrl`.
5. Update `release.json` with the title, date, and optional custom track titles/durations.

If you prefer local files, you can still add an `audio/` folder and use `file` in each track. If you skip the `tracks` array in `release.json`, the site will build the tracklist from local filenames automatically.

### SoundCloud tracks

Use public SoundCloud track URLs in `release.json`:

```json
{
  "tracks": [
    {
      "soundcloudUrl": "https://soundcloud.com/artist/track-name",
      "title": "Track Name",
      "duration": "03:42",
      "active": true
    }
  ]
}
```

The site keeps its custom player UI and controls playback through SoundCloud's embedded widget API, so no SoundCloud client secret is exposed in the browser.

### Supported conventions

- The loader reads every folder in `public/releases` except folders that start with `_`.
- Supported local audio formats: `.mp3`, `.wav`, `.m4a`, `.aac`, `.ogg`, `.flac`
- Supported cover formats: `.jpg`, `.jpeg`, `.png`, `.webp`, `.avif`
- The first SoundCloud track or local audio file becomes the default "Listen Now" action unless `ctaHref` is set in `release.json`
- Files are sorted naturally, so `01-track.mp3`, `02-track.mp3`, `10-track.mp3` stay in order

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

### Deployment note

If you deploy to Vercel or another immutable host, newly added release files will appear after the next deploy because the files ship with the deployment.
