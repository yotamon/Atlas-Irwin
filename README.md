## Release Management

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
