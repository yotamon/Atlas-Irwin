# Active Mastering Studio

Active Mastering extends Mastering Inspector from deterministic diagnosis into an auditable render-and-verify loop. It intentionally does not use generative audio or opaque quality scores.

## Product contract

1. The canonical source master is immutable while a candidate is rendering.
2. A mastering candidate is a separate media asset with source, DSP plan, targets, iterations and final QA stored in `track_mastering_jobs`.
3. Only a candidate that passes the final closed-loop checks can be promoted to the canonical master.
4. Promotion invalidates stale Track Intelligence and automatically re-runs analysis against the promoted waveform.
5. Artist-specific tonal matching is descriptive and conservative and uses only explicit trusted mastering references.
6. No generic tonal curve is treated as “correct”. Without enough trusted references, Active Mastering focuses on dynamics, loudness, true-peak safety and delivery integrity.
7. A `streaming_safe` intent preserves source loudness, tone and dynamics as closely as possible and changes only the headroom needed by measured streaming/codec risk.

## Runtime flow

```text
Canonical master
  -> Master Readiness decision
  -> Mastering Inspector evidence
  -> contextual intent + trusted-reference target builder
  -> constrained DSP plan
     - streaming_safe: no cleanup EQ, catalog EQ or compression
     - creative directions: 20 Hz cleanup + bounded trusted-reference EQ when enough references exist
     - gentle compression only when dynamic headroom exists
     - no blind stereo widening
  -> 48 kHz / 24-bit premaster
  -> FFmpeg loudnorm two-pass render
  -> Mastering Inspector re-analysis
  -> acceptance checks
  -> optional safer second render
  -> storage-safe lossless candidate (normally 24-bit / 48 kHz FLAC)
  -> A/B + download
  -> explicit promotion
  -> Track Intelligence re-analysis
```

## Mastering intents

- **Streaming-safe**: source-preserving corrective path for measured true-peak/codec headroom risk. It keeps source integrated loudness, disables catalog EQ and compression, and chooses true-peak headroom from measured loudness/risk.
- **Balanced**: clean, controlled and release-ready. Default target around -10 LUFS with conservative true-peak headroom.
- **Punchy**: slightly more forward target around -9 LUFS, but compression is skipped when the source is already dynamically constrained.
- **Dynamic**: target around -11.5 LUFS and never adds master-bus compression.

Balanced, Punchy and Dynamic are creative starting targets, not platform normalization targets. If at least three trusted references exist, their target loudness can blend toward the trusted median and stays clamped to a safe range. `streaming_safe` never uses that catalog blend. Codec-stress evidence can automatically increase true-peak headroom.

## Closed-loop acceptance

A candidate must satisfy all of the following before it can be promoted:

- no critical Mastering Inspector issue;
- no sample clipping;
- true peak within the computed target tolerance;
- integrated loudness within the computed target range;
- dynamics not materially degraded versus the source.

If the first render does not pass, the processor performs one safer iteration with more peak headroom and, when needed, a slightly lower loudness target. A non-passing result is still available for review/download, but cannot replace the canonical master.

The verified delivery file uses the lossless FLAC codec. Ensemblis normally keeps 24-bit / 48 kHz precision; on bounded object-storage tiers it deterministically falls back to dithered 16-bit PCM encoded in FLAC (48 kHz first, then 44.1 kHz only if required). The fallback does reduce bit depth, so result metadata records that source precision was not fully preserved. Any fallback is re-analyzed from the exact stored waveform before promotion is allowed. This avoids perceptual/lossy codec compression, and Distribution already accepts both WAV and FLAC masters.

## Listen Lab

Verified candidates use the shared Listen Lab before promotion:

- sample-position-synchronized Original / Candidate A/B;
- loudness matching on by default;
- 12-second repeatable loops;
- browser-side Candidate mono fold-down for translation checks;
- explicit trusted-reference audition with a selectable reference;
- keyboard A/B/Mono/Reference switching;
- no automatic playback.

Reference playback is intentionally independent because the reference may be a different song. A streaming/codec listening mode is shown only when Ensemblis has a real generated preview asset; codec-stress measurements are never presented as fake “Spotify audio”.

## Durable execution

Active Mastering uses the existing single-concurrency Vercel Sandbox Media Worker. Jobs are durable in Supabase, callbacks use one-time SHA-256-hashed credentials, and late results are rejected when the source master changed during rendering. Signed upload credentials are transport-only and are never persisted in worker error messages. Uploaded mastering references reuse the same durable worker and source-lineage validation without creating catalog Tracks.

The worker bootstrap explicitly downloads every V4 audio runtime dependency, including Mastering Inspector and Active Mastering, so a fresh Sandbox does not depend on files left by an older persistent snapshot.

## Stem-aware mix rescue

Stem Intelligence is deliberately not allowed to alter stems automatically in this first production contract. The architecture keeps that as a separate future stage because correcting the mix (kick/bass balance, vocal harshness, transient restoration, etc.) has materially different creative risk from mastering a stereo mix.

When added, Mix Rescue should produce a new immutable mix candidate first, then feed that candidate through this same Active Mastering + QA pipeline. It should never silently rewrite stems or bypass the canonical-master promotion gate.
