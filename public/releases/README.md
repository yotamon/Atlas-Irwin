Drop release folders here.

The site reads every subfolder in `public/releases` except folders that start with `_`.

Quick example:

```text
public/releases/night-drive-ep/
  cover.jpg
  canvas.mp4
  release.json
```

Use `public/releases/_template` as the starter folder for new releases. Add SoundCloud track URLs with `soundcloudUrl` in `release.json`; local audio files in an `audio/` folder still work as a fallback.

For Spotify Canvas-style mobile videos, add a 9:16 `canvas.mp4`, `canvas.webm`, or `canvas.mov` beside the cover art. You can also set `"canvasVideo": "your-file.mp4"` in `release.json` when the video uses a custom filename.
