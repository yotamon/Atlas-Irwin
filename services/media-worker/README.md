# Atlas Media Worker

The Media Worker keeps CPU-heavy audio intelligence and deterministic FFmpeg assembly outside Vercel.

It provides:

- Music Intelligence v2 using `all-in-one-infer` for semantic structure, BPM, beats and real downbeats
- a clearly labelled librosa fallback when semantic inference is unavailable
- Atlas-specific hook ranking using recurrence, structural importance, energy lift, novelty, groove, melodic salience, edit-boundary fit and loopability
- ready-to-use 6s / 8s / 15s / 30s social audio windows
- energy curves, peaks and onset-informed edit points
- deterministic FFmpeg assembly using the original track audio
- subject-aware horizontal crop for vertical outputs using each storyboard shot's `focus_x`
- direct upload to a short-lived Supabase signed upload URL
- authenticated callbacks to Atlas for durable job state

The worker never receives the Supabase service-role key and never writes directly to the database.

## Music Intelligence behavior

`analyze_audio` returns a versioned `music_map`.

A v2 map includes:

```json
{
  "version": 2,
  "bpm": 122.0,
  "beats_ms": [],
  "downbeats_ms": [],
  "sections": [],
  "energy_curve": [],
  "edit_points": [],
  "hook_candidates": [],
  "social_cuts": {
    "6": null,
    "8": null,
    "15": null,
    "30": null
  },
  "analysis": {
    "engine": "all-in-one-infer",
    "model": "harmonix-all",
    "quality": "full",
    "semantic_structure": true,
    "real_downbeats": true,
    "warnings": []
  },
  "source": "worker"
}
```

`all-in-one-infer` performs source separation internally before structural inference. Its model checkpoints are downloaded on first use and cached by the package. A warm instance therefore avoids repeating the heaviest setup work.

If semantic inference cannot load or complete, Atlas still analyzes the waveform with librosa. That result is explicitly returned as `analysis.quality = "fallback"`; generic sections and inferred editing grids are never presented as verified semantic labels/downbeats.

The Studio never treats a duration-only fallback as a real audio analysis and never invents a hook for it.

## Required environment

```bash
MEDIA_WORKER_SECRET=<long-random-secret>
```

Atlas must use the exact same value as `MEDIA_WORKER_SECRET` and set `MEDIA_WORKER_URL` to the deployed service URL.

## Local run

```bash
docker build -t atlas-media-worker services/media-worker
docker run --rm -p 8080:8080 \
  -e MEDIA_WORKER_SECRET=local-secret \
  atlas-media-worker
```

Health check:

```bash
curl http://localhost:8080/health
```

The health response exposes whether the semantic analyzer imported successfully. It intentionally does not download/load model checkpoints merely to answer a health request.

## Cloud Run deployment

This service accepts a job quickly and performs the media operation after the request has returned. For that execution model, Cloud Run must use instance-based CPU allocation rather than request-only CPU throttling.

Music Intelligence v2 includes PyTorch and Demucs-style source separation. Start with more memory than the old librosa-only worker and tune downward only after observing real Atlas tracks.

Recommended baseline:

```bash
gcloud run deploy atlas-media-worker \
  --source services/media-worker \
  --region europe-west1 \
  --allow-unauthenticated \
  --set-env-vars MEDIA_WORKER_SECRET="$MEDIA_WORKER_SECRET" \
  --no-cpu-throttling \
  --min-instances 1 \
  --max-instances 2 \
  --cpu 4 \
  --memory 8Gi \
  --timeout 900
```

Why `min-instances=1`: model/checkpoint caches live with the instance. Keeping one warm worker substantially reduces repeated cold model setup. The canonical per-track analysis in Postgres also prevents Atlas from dispatching the same v2 analysis again when another Video Director project uses that track.

`--allow-unauthenticated` only makes the HTTP endpoint reachable. Atlas still requires the worker's Bearer secret for `/v1/jobs`. Use a long random value and rotate it if exposed.

For a busier multi-user product, move job dispatch to Cloud Tasks or another durable queue. Atlas already persists every worker job and uses idempotency keys, so that upgrade does not require changing the Video Director domain model.

## Failure behavior

Atlas persists a worker job before dispatch. A callback marks it `running`, `completed`, or `failed`.

- a semantic analyzer failure can degrade to the explicit librosa audio fallback without losing the whole analysis
- an unrecoverable audio-analysis failure moves the project to a recoverable blocked state
- render failure returns the project to `ready_to_render`
- no generation credits are affected by a Media Worker failure
- final assets are registered in the Media Library only after the signed upload succeeds

## Render contract

A render payload contains ordered source clips with target duration and source offset. Each clip may include:

```json
{
  "url": "https://...",
  "duration_ms": 6500,
  "source_offset_ms": 0,
  "focus_x": 0.25,
  "vertical_safe": true
}
```

`focus_x` is normalized from `0` (left) to `1` (right). The worker scales the source to fill the target frame and positions the crop around that focus point.

The final audio is always the Atlas track/master supplied by the render manifest. Generated video audio is not used.

For `hook_15` and `promo_30`, Atlas selects the scored Music Intelligence social window before building the manifest. Legacy strongest-energy selection exists only for old/fallback maps that do not contain v2 hook candidates.
