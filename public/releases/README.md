# Legacy release manifests (import only)

Folders here are **import input** for Atlas Release Engine. The live homepage catalog is read from Supabase — these files are not loaded at runtime by the public player.

```text
public/releases/<slug>/
  release.json
  cover.jpg          # optional; uploaded to public-media on import
  canvas.mp4         # optional
  audio/             # optional local masters
```

Use `_template/` as a starter, then import:

```bash
npm run studio:import:dry-run
npm run studio:import
```

See [`docs/catalog-architecture.md`](../../docs/catalog-architecture.md) for the canonical model and publishing flow.
