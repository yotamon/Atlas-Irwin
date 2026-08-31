# Atlas Media Worker

Atlas Media Worker runs CPU-heavy audio intelligence and deterministic media assembly **only inside Vercel Sandbox**. It is not a separately deployed service and has no Cloud Run, Cloud Tasks, container registry, external worker URL, or Google Cloud dependency.

## Runtime

Atlas dispatches jobs from the Next.js application through `lib/media-worker/sandbox.ts`.

- one named persistent Sandbox exists per Vercel environment
- compute starts only when a job is requested
- concurrency is intentionally capped at one heavy media job per environment
- the first job bootstraps the Python virtual environment in a detached Sandbox process
- later jobs reuse the persistent Sandbox snapshot and installed ML dependencies
- source files are refreshed from the exact Vercel Git commit before each job
- terminal callbacks stop the Sandbox, so there is no idle CPU/memory runtime
- Atlas never falls back to a paid external worker automatically

The Studio request returns after dispatch. A first-time dependency install therefore does not hold the release upload request open.

## Music Intelligence

`analyze_audio` returns a versioned `music_map` with:

- semantic structure from `all-in-one-infer` when available
- explicit librosa fallback when semantic inference cannot complete
- BPM, beats and downbeats
- ranked hook candidates
- 6s / 8s / 15s / 30s social cuts
- energy curves, peaks and edit points

The worker standardizes audio to 44.1 kHz PCM WAV before analysis. FFmpeg is supplied by the pinned `imageio-ffmpeg` Python package, so Sandbox bootstrap does not require `apt-get`, root access or a custom container image.

## Security

The worker never receives the Supabase service-role key and never writes directly to the database.

Each job gets a random one-time callback token. Atlas stores only its SHA-256 hash in durable state. The raw token exists only in the temporary Sandbox request file and is deleted before a persistent snapshot can be created.

Remote media URLs are validated and private/local network destinations are rejected. Redirects are revalidated before downloads continue.

## Lifecycle

1. Atlas creates or reuses the named Vercel Sandbox.
2. A lightweight lock prevents concurrent heavy jobs.
3. Atlas writes a temporary request manifest and starts a detached bootstrap/runner command.
4. The runner refreshes worker source from the current Vercel Git commit.
5. If Python dependencies changed, the persistent virtual environment is rebuilt once.
6. The worker sends `running`, then `completed` or `failed` back to Atlas.
7. Atlas reconciles durable state and stops the Sandbox.
8. The next job restores the cached filesystem snapshot instead of reinstalling everything.

If bootstrap itself fails, the detached process sends a `failed` callback using only Python's standard library, deletes the temporary credential file and releases the worker lock.

## Health

Atlas exposes its deployment-native readiness at:

`/api/health/media-worker`

A healthy response reports `dispatch_mode: "vercel_sandbox"` and `zero_idle_compute: true`.

For a production check:

```bash
npm run media-worker:check
```

There is intentionally **no media-worker deployment command**. Deploying Atlas to Vercel deploys the orchestration code; the Python runtime initializes lazily inside Sandbox when needed.

## Local development

The real heavy worker requires Vercel Sandbox. Local development can still exercise Studio UI, durable job creation and fallback behavior, but does not silently start another cloud provider.

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

The final audio always comes from the Atlas master supplied by the render manifest. Generated video audio is not used.
