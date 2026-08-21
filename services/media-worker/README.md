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
- Cloud Tasks backed production dispatch so expensive workers can safely scale to zero

The worker never receives the Supabase service-role key and never writes directly to the database.

## Music Intelligence behavior

`analyze_audio` returns a versioned `music_map`.

A v2 map includes semantic sections, musical timing, ranked hook candidates and social cuts:

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

Atlas converts every source to 44.1 kHz PCM WAV before structural inference so beat and edit timing share one decoder/sample timeline.

`all-in-one-infer` performs source separation internally before structural inference. Model checkpoints are downloaded on first use and cached inside the instance filesystem. Canonical per-track caching in Postgres prevents the same completed v2 analysis from being dispatched again for another Video Director project.

If semantic inference cannot load or complete, Atlas still analyzes the waveform with librosa. That result is explicitly returned as `analysis.quality = "fallback"`; generic sections and inferred editing grids are never presented as verified semantic labels/downbeats. A duration-only estimate never invents a hook.

## Production dispatch architecture

Production uses two Cloud Run routes:

1. `POST /v1/jobs` authenticates the Atlas request, creates a deterministic Cloud Task and returns quickly.
2. Cloud Tasks calls `POST /v1/execute`. That request stays open for the entire analysis/render operation and receives automatic retry behavior from Cloud Tasks.

Because the expensive operation is attached to a live HTTP request, Cloud Run no longer needs an always-on instance or background CPU allocation. It can scale to zero between jobs.

Explicit Cloud Task IDs are derived from Atlas worker job IDs. Repeated Vercel dispatch attempts therefore resolve to the same Cloud Task rather than creating duplicate paid/CPU-heavy work.

The production health response should include:

```json
{
  "ok": true,
  "version": 2.1,
  "dispatch_mode": "cloud_tasks",
  "music_intelligence": {
    "semantic_analyzer_available": true
  }
}
```

## Required environment

The deployed worker receives:

```bash
MEDIA_WORKER_SECRET=<shared-secret-from-Secret-Manager>
GCP_PROJECT_ID=<project-id>
CLOUD_TASKS_LOCATION=europe-west3
CLOUD_TASKS_QUEUE=atlas-media-worker
```

Vercel receives the matching:

```bash
MEDIA_WORKER_URL=https://<cloud-run-service>.run.app
MEDIA_WORKER_SECRET=<same-shared-secret>
```

The public Atlas health proxy at `/api/health/media-worker` never exposes the service URL or secret.

## One-command production deployment

The repository includes a deployment script that provisions/updates the complete worker path:

```bash
npm run media-worker:deploy
```

Prerequisites:

- Google Cloud CLI installed and authenticated with `gcloud auth login`
- a billing-enabled GCP project selected with `gcloud config set project <PROJECT_ID>` (or `GCP_PROJECT_ID` set)
- Vercel CLI installed and authenticated with `vercel login`

The script:

- enables Cloud Run, Cloud Build, Artifact Registry, Cloud Tasks, Secret Manager and IAM APIs
- creates/reuses a dedicated `atlas-media-worker` service account
- creates/reuses the shared secret in Secret Manager
- grants only Secret Accessor and Cloud Tasks Enqueuer permissions required by the worker
- creates/updates a Cloud Tasks queue
- deploys Cloud Run in `europe-west3` by default
- configures 4 CPU / 8 GiB, request concurrency 1 and scale-to-zero
- verifies worker version, Cloud Tasks mode and `all-in-one-infer` availability before connecting Atlas
- writes `MEDIA_WORKER_URL` and `MEDIA_WORKER_SECRET` into Vercel Production and Preview through Vercel CLI
- redeploys Atlas
- polls `https://atlasirwin.com/api/health/media-worker` until the whole path is healthy

Optional overrides:

```bash
GCP_PROJECT_ID=... \
GCP_REGION=europe-west3 \
MEDIA_WORKER_MAX_CONCURRENT=1 \
VERCEL_SCOPE=cart-shift \
VERCEL_PROJECT=atlas-irwin \
npm run media-worker:deploy
```

`MEDIA_WORKER_MAX_CONCURRENT=1` is deliberately conservative for Atlas: only one PyTorch/source-separation job runs at once, preventing an accidental burst of large Cloud Run instances. Increase it only after observing real workload and cost.

## Local run

Cloud Tasks variables are optional locally. Without them, `/v1/jobs` uses an in-process background task for development only.

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

Local health will show `dispatch_mode: "local_background"` unless Cloud Tasks variables are supplied.

## Failure behavior

Atlas persists a worker job before dispatch. A callback marks it `running`, `completed`, or `failed`.

- a semantic analyzer failure can degrade to the explicit librosa audio fallback without losing the whole analysis
- an unrecoverable audio-analysis failure moves the project to a recoverable blocked state
- render failure returns the project to `ready_to_render`
- no generation credits are affected by a Media Worker failure
- final assets are registered in the Media Library only after the signed upload succeeds
- if the terminal callback cannot reach Atlas, Cloud Tasks retries the execution delivery
- duplicate terminal callbacks are safe because Atlas reconciliation is idempotent

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
