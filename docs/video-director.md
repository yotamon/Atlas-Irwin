# Atlas Video Director

Atlas Video Director is the private music-video production system inside Atlas Release Engine.

It is intentionally not a generic Higgsfield front end. Atlas owns the production logic; Higgsfield is a generation provider.

## End-to-end flow

```text
Track + release context
  -> music analysis
  -> 3 creative concepts
  -> concept approval
  -> visual bible + timed storyboard
  -> production cost plan
  -> plan approval (0 generation credits)
  -> look-development generation envelope
  -> visual-reference approval
  -> representative test-shot envelope
  -> test review
  -> bounded production batches
  -> per-shot lock/reject/revise
  -> timeline validation
  -> FFmpeg master render with original audio
  -> 9:16 / 30s / 15s derived outputs
```

Every stage is persisted. Browser refresh, Vercel deploys, provider latency and worker callbacks do not own the state machine.

## Money safety

No paid provider request can be submitted merely because the UI button was clicked.

The database atomically checks the generation immediately before provider submit:

1. the generation has a persisted approval
2. the approval is active and not expired
3. the exact generation ID is inside the approval scope
4. shot, operation and model satisfy that scope
5. approval consumed + reserved + new reserve stays under approval max
6. project spent + reserved + new reserve stays under the project hard cap
7. the generation has not already moved past the reservable state

The reserve is written before the provider request is sent. Reserve and settlement RPCs are idempotent, so duplicate server calls or repeated callbacks cannot reserve or charge the same generation twice.

Creative failures never retry automatically. A provider rejection/failure releases or refunds the reservation only when Atlas knows the provider did not charge it. If the provider acknowledges a request but Atlas cannot persist the provider request ID, the reserve intentionally remains locked for reconciliation rather than pretending the credits are available. A new creative alternative always creates a new request that needs an approval envelope.

## Production efficiency

The Creative Director is prompted to design roughly 12-18 unique generated source sequences for a typical full track, rather than buying a new source clip for every edit.

Storyboard shots support:

- unique source
- continuation
- reuse previous source
- reframe
- hold
- loop

Only unique/continuation source generation is counted as paid video generation in the production plan. Atlas can create more perceived edit variety with cuts, holds, source offsets, timing and reframing.

## Creative Director

The OpenAI Responses API is used server-side with strict Structured Outputs and `store=false`.

Configuration:

```bash
OPENAI_API_KEY=...
VIDEO_DIRECTOR_LLM_MODEL=<Responses API model available to this account>
```

Both variables are required for Creative Director readiness. Atlas deliberately does not guess a paid API model ID because availability can vary by account and over time.

The output is validated structured data, not prose that the UI later tries to parse.

The Director receives:

- project brief
- track title/duration
- music map
- release story, emotion, hook, audience and visual direction
- release identity/story answers
- brand settings
- available Media Library context
- accumulated Director preferences from accepted/rejected generations

## Higgsfield

Atlas uses a provider adapter and capability router rather than placing model names in the domain layer.

Runtime configuration:

```bash
HF_CREDENTIALS=KEY_ID:KEY_SECRET
HIGGSFIELD_WEBHOOK_SECRET=<random-secret>
HIGGSFIELD_ENDPOINT_MAP_JSON={...}
HIGGSFIELD_CREDIT_RATES_JSON={...}
```

The canonical short-model-ID to public endpoint mapping is not treated as a stable public contract by Atlas. The app therefore requires a verified endpoint map and refuses to guess a paid endpoint by default.

`HIGGSFIELD_ALLOW_INFERRED_ENDPOINTS=true` exists only as an explicit escape hatch and should stay false in production.

The current curated router can choose among:

- Nano Banana 2 for look/reference frames
- Cinema Studio 3.0 for premium cinematic hero shots
- Seedance 2.0 / 2.5 for reference-heavy continuity and multimodal needs
- Seedance 2.0 Mini for economical 720p tests/simple movement
- Kling 3.0 for movement/physics-oriented alternatives

Atlas validates the requested output resolution and reference capabilities before a paid submission instead of relying on provider-side coercion. Model-specific request fields are also isolated in the provider adapter, for example Kling 3.0 uses `mode` and `sound`, while Seedance uses explicit resolution/audio fields.

The catalog is deliberately isolated in `lib/video-providers/higgsfield/catalog.ts` so replacing a model does not change project/shot schemas.

## Music Intelligence

If the Media Worker is connected, Atlas analyzes the real audio with librosa:

- BPM estimate
- beat and downbeat timeline
- RMS energy curve
- structural sections
- peaks
- onset-informed edit points

If the worker is not configured, Atlas may create a clearly labeled estimated map from the known track duration so creative planning can continue. It never labels fallback structure as real audio analysis.

## Media Worker and rendering

See `services/media-worker/README.md`.

The worker provides real audio analysis and FFmpeg assembly. It receives only signed media URLs and a short-lived Supabase signed upload URL. It does not hold Supabase database credentials.

For every render, Atlas builds a manifest from locked timeline sources. Generated audio is discarded; the original Atlas track/master is the final audio source.

Vertical outputs are not silently center-cropped. The storyboard stores:

- `vertical_safe`
- `vertical_focus`

The worker uses normalized `focus_x` to position the crop. If any shot is not marked vertical-safe, Atlas stops the vertical render until the user explicitly approves crop risk or creates a better source/reframe.

## Durable output lineage

Provider output is imported into Atlas Media Library and tagged with:

- project ID
- shot ID when applicable
- generation ID
- provider
- model
- source URL metadata

Final worker renders are also registered in Media Library with render ID and output type. Unique lineage indexes plus race-aware inserts make repeated or concurrent callbacks resolve to one Media Library asset per generation/render.

Rejected source generations are retained. They may be useful for alternate social edits later and preserve an audit trail of what was paid for.

## Director Memory

Accept/reject review can record a concise signal such as:

- strong visual world
- camera feels intentional
- too generic
- too AI-looking
- continuity broke
- feels like AI fashion

Signals are stored in `music_video_director_preferences` and sent back into later creative-direction context. This lets Atlas become an Atlas Irwin-specific Director over time instead of starting from zero on every track.

## Database stage guards

The UI guides the workflow, but PostgreSQL enforces the important gates too:

- all representative test shots from `test_shot_indexes` must have a locked result before the project can enter production
- all paid unique/continuation source shots must be locked before the project can become ready to render
- shot references, generation approvals/results, render jobs and assets must belong to the same owner/project

This keeps the workflow valid even if a server action is called directly.

## Operational principle

Project status guides workflow; it does not grant spend permission.

A project may be in a generation stage and still be unable to spend a single credit until an active approval envelope passes the database reservation function.
