Copy this folder, rename it to your release slug, and replace the sample files.

Checklist:

1. Add a `cover.jpg` or `cover.png`
2. Add SoundCloud track URLs to `release.json`
3. Update `release.json`
4. Keep the tracks array in playback order

If you want to use local audio instead, put files inside `audio/` and use `file` in each track. If you remove the `tracks` array from `release.json`, the site will generate titles from local filenames automatically.
