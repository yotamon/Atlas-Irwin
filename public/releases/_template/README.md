# Release import template

Copy this folder, rename it to your release slug, then fill in assets and `release.json`.

1. Add `cover.jpg` or `cover.png`
2. Set track metadata and platform URLs in `release.json` (keep tracks in playback order)
3. Optional: local files in `audio/`, or a 9:16 `canvas.mp4` / `canvas.webm` beside the cover

Import into Supabase (does not mutate these files):

```bash
npm run studio:import:dry-run
npm run studio:import
```

After import, publish and place the release from Studio → Releases → Website tab. The public site reads Supabase, not this folder.
