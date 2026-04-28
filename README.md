## Release Management

This site now auto-imports music releases from the filesystem. To add a new release, create a folder inside `public/releases` and follow the same shape as `public/releases/_template`.

### Folder structure

```text
public/releases/
  my-release/
    cover.jpg
    release.json
    audio/
      01-track-name.mp3
      02-another-track.wav
```

### Minimal workflow

1. Duplicate `public/releases/_template`.
2. Rename the folder to your release slug, for example `late-night-systems`.
3. Replace `cover.jpg` or `cover.png` with your own artwork.
4. Drop your masters into the `audio/` folder.
5. Update `release.json` with the title, date, and optional custom track titles/durations.

If you skip the `tracks` array in `release.json`, the site will build the tracklist from the filenames automatically.

### Supported conventions

- The loader reads every folder in `public/releases` except folders that start with `_`.
- Supported audio formats: `.mp3`, `.wav`, `.m4a`, `.aac`, `.ogg`, `.flac`
- Supported cover formats: `.jpg`, `.jpeg`, `.png`, `.webp`, `.avif`
- The first audio file becomes the default "Listen Now" action unless `ctaHref` is set in `release.json`
- Files are sorted naturally, so `01-track.mp3`, `02-track.mp3`, `10-track.mp3` stay in order

### Local development

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

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
