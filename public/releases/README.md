Drop release folders here.

The site reads every subfolder in `public/releases` except folders that start with `_`.

Quick example:

```text
public/releases/night-drive-ep/
  cover.jpg
  release.json
```

Use `public/releases/_template` as the starter folder for new releases. Add SoundCloud track URLs with `soundcloudUrl` in `release.json`; local audio files in an `audio/` folder still work as a fallback.
