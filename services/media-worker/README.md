# Atlas Media Worker

The Atlas Media Worker runs CPU-heavy Music Intelligence and deterministic FFmpeg assembly in Vercel Sandbox. It is intentionally designed for the Vercel Hobby tier and has no Google Cloud or paid-infrastructure fallback.

It provides:

- Music Intelligence v2 using `all-in-one-infer` for semantic structure, BPM, beats and real downbeats
- an explicit librosa fallback when semantic inference is unavailable
- Atlas-specific hook ranking using recurrence, structural importance, energy lift, novelty, groove, melodic salience, edit-boundary fit and loopability
- ready-to-use 6s / 8s / 15s / 30s social audio windows
- deterministic FFmpeg assembly using the original track audio
- direct upload to short-lived Supabase signed upload URLs
- authenticated callbacks to Atlas for durable job state

The worker never receives the Supabase service-role key and never writes directly to the database.

## Why Vercel Sandbox

The normal Atlas web application stays on Vercel Functions. Heavy PyTorch/source-separation/FFmpeg work needs more CPU and RAM, so each real media job resumes a named Vercel Sandbox created from the custom `atlas-media-worker:latest` VCR image.

The production profile is deliberately conservative:

- Vercel Hobby only
- up to 4 vCPU / 8 GB RAM
- one active Atlas media job at a time
- 45-minute maximum Sandbox session
- no paid fallback
- canonical per-track Music Intelligence cache in Postgres
- one persistent Sandbox filesystem snapshot for downloaded ML checkpoints
- compute stopped immediately after terminal callback

If Vercel rejects a Sandbox because the free Hobby quota is unavailable, Atlas marks the job failed with a clear free-quota message. It does not dispatch to Google Cloud or another paid worker.

## Persistent model cache

`all-in-one-infer` downloads model checkpoints at runtime. Atlas uses one named persistent Sandbox:

```text
atlas-media-worker-cache
```

The VM is not left running. After each completed or failed job, the callback route calls `sandbox.stop()`. Vercel snapshots the filesystem and Atlas keeps only the latest snapshot.

The next job resumes that snapshot, so downloaded model checkpoints can be reused without paying the CPU/time cost of downloading and preparing them again. A new Media Worker deployment recreates this cache Sandbox so a new VCR image cannot accidentally resume an older application image.

## Music Intelligence behavior

`analyze_audio` returns a versioned `music_map`.

A v2 map contains semantic sections, musical timing, ranked hook candidates and social cuts:

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

If semantic inference cannot load or complete, Atlas still analyzes the waveform with librosa. That result is explicitly returned as `analysis.quality = "fallback"`; generic sections and inferred editing grids are never presented as verified semantic labels/downbeats. A duration-only estimate never invents a hook.

## Dispatch architecture

```text
Atlas Next.js
  -> create/reuse canonical worker job in Supabase
  -> resume atlas-media-worker-cache Sandbox
  -> run python -m app.runner <request.json>
  -> worker reports running/completed/failed to Atlas callback
  -> Atlas reconciles durable database state
  -> callback stops Sandbox compute
  -> Vercel keeps one filesystem snapshot for model cache
```

Every dispatched job receives a random one-time callback token. Atlas stores only its SHA-256 hash in the durable job payload. The plaintext token exists only in the request file inside the Sandbox. Legacy `MEDIA_WORKER_SECRET` callback authentication remains only for old jobs created before this migration.

Before dispatching CPU work, Atlas checks the canonical track-level Music Intelligence cache. A completed v2 analysis is reused across Video Director, Growth and Marketing instead of analyzing the same track again.

## Vercel Hobby budget policy

The code is intentionally fail-closed on cost:

- concurrency is capped at one active Atlas media job per owner
- existing completed analysis is reused
- active duplicate jobs are not dispatched again
- quota/billing/limit errors become an explicit Hobby-quota failure
- no Google Cloud credentials or worker URL exist
- no paid fallback is configured

Actual tracks-per-month depends on real Active CPU consumed by `all-in-one-infer`, not only wall-clock duration. Measure the first real production analysis before assuming a fixed monthly track count.

Video rendering can also consume Sandbox CPU and network egress, so large render workloads share the same free-tier allowance with Music Intelligence.

## Vercel Container Registry image

The Python worker remains containerized so FFmpeg, PyTorch and Python dependencies are reproducible.

```bash
docker build -t atlas-media-worker services/media-worker
```

Production uses the Vercel Container Registry image `atlas-media-worker:latest` by default. Override it only when intentionally testing another tag:

```bash
MEDIA_WORKER_IMAGE=atlas-media-worker:next
```

## One-command production deployment

The repository includes:

```bash
npm run media-worker:deploy
```

Prerequisites:

- Vercel CLI installed and authenticated with `vercel login`
- Docker available locally
- checkout linked or linkable to the `cart-shift/atlas-irwin` Vercel project

The script:

1. links the checkout to Atlas on Vercel
2. builds the Docker image and pushes it to Vercel Container Registry
3. obtains local project auth through `vercel env pull`
4. removes any old named cache Sandbox so the new image is authoritative
5. creates the persistent 4-vCPU cache Sandbox and verifies Python, FFmpeg and `all-in-one-infer`
6. stops the Sandbox, retaining one filesystem snapshot
7. deploys Atlas production
8. verifies `/api/health/media-worker`

There is no `gcloud`, Cloud Run, Cloud Tasks, Google Secret Manager, Google service account or GCP billing account in this deployment path.

## Health contract

The public Atlas health endpoint is:

```text
/api/health/media-worker
```

It reports the dispatch architecture without booting PyTorch just to perform a health check. A healthy configuration reports Vercel Sandbox mode, zero-cost mode and Music Intelligence v2 support. Runtime semantic-analyzer verification happens when the VCR image is smoke-tested and on real jobs.

## Local development

The worker logic can still be exercised directly with Docker:

```bash
docker build -t atlas-media-worker services/media-worker
docker run --rm atlas-media-worker \
  python -c "from app.main import allin1_infer; import shutil; assert allin1_infer is not None; assert shutil.which('ffmpeg')"
```

Production dispatch itself is Vercel-specific because Sandbox authentication is supplied automatically by Vercel deployments.

## Failure behavior

Atlas persists a worker job before dispatch. The callback marks it `running`, `completed`, or `failed`.

- semantic analyzer failure may degrade to the explicit librosa audio fallback
- unrecoverable audio-analysis failure moves the project to a recoverable blocked state
- render failure returns the project to a retryable state
- no generation credits are affected by a Media Worker failure
- final assets are registered only after signed upload succeeds
- callback transport is retried several times inside the worker
- duplicate terminal callbacks are safe because reconciliation is idempotent
- the Sandbox is stopped after terminal reconciliation so idle CPU/RAM is not consumed

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
