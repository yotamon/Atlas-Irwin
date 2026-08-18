# Atlas Media Worker

The Media Worker keeps CPU-heavy audio analysis and FFmpeg assembly outside Vercel.

It provides:

- real audio analysis with librosa: BPM, beats, downbeats, energy curve, sections, peaks and edit points
- deterministic FFmpeg assembly using the original track audio
- subject-aware horizontal crop for vertical outputs using each storyboard shot's `focus_x`
- direct upload to a short-lived Supabase signed upload URL
- authenticated callbacks to Atlas for durable job state

The worker never receives the Supabase service-role key and never writes directly to the database.

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

## Cloud Run deployment

This service accepts a job quickly and performs the media operation after the request has returned. For that execution model, Cloud Run must use instance-based CPU allocation rather than request-only CPU throttling.

Example:

```bash
gcloud run deploy atlas-media-worker \
  --source services/media-worker \
  --region europe-west1 \
  --allow-unauthenticated \
  --set-env-vars MEDIA_WORKER_SECRET="$MEDIA_WORKER_SECRET" \
  --no-cpu-throttling \
  --min-instances 1 \
  --max-instances 2 \
  --cpu 2 \
  --memory 4Gi \
  --timeout 900
```

`--allow-unauthenticated` only makes the HTTP endpoint reachable. Atlas still requires the worker's Bearer secret for `/v1/jobs`. Use a long random value and rotate it if exposed.

For a busier multi-user product, move job dispatch to Cloud Tasks or another durable queue. Atlas already persists every worker job and uses idempotency keys, so that upgrade does not require changing the Video Director domain model.

## Failure behavior

Atlas persists a worker job before dispatch. A callback marks it `running`, `completed`, or `failed`.

- audio-analysis failure moves the project to a recoverable blocked state
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
