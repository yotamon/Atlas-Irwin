# Active Mastering Studio

Active Mastering extends Mastering Inspector from deterministic diagnosis into an auditable render-and-verify loop. It intentionally does not use generative audio or opaque quality scores.

## Product contract

1. The canonical source master is immutable while a candidate is rendering.
2. A mastering candidate is a separate media asset with source, DSP plan, targets, iterations and final QA stored in `track_mastering_jobs`.
3. Only a candidate that passes the final closed-loop checks can be promoted to the canonical master.
4. Promotion invalidates stale Track Intelligence and automatically re-runs analysis against the promoted waveform.
5. Artist-catalog tonal matching is descriptive and conservative. It is enabled only when at least three analyzed catalog masters exist.
6. No generic tonal curve is treated as “correct”. Without enough artist references, Active Mastering focuses on dynamics, loudness, true-peak safety and delivery integrity.

## Runtime flow

```text
Canonical master
  -> Mastering Inspector evidence
  -> preset + artist-catalog target builder
  -> constrained DSP plan
     - 20 Hz cleanup
     - bounded reference EQ (max +/-1.5 dB)
     - gentle compression only when dynamic headroom exists
     - no blind stereo widening
  -> 48 kHz / 24-bit premaster
  -> FFmpeg loudnorm two-pass render
  -> Mastering Inspector re-analysis
  -> acceptance checks
  -> optional safer second render
  -> immutable candidate WAV
  -> A/B + download
  -> explicit promotion
  -> Track Intelligence re-analysis
```

## Presets

- **Balanced**: clean, controlled and release-ready. Default target around -10 LUFS with conservative true-peak headroom.
- **Punchy**: slightly more forward target around -9 LUFS, but compression is skipped when the source is already dynamically constrained.
- **Dynamic**: target around -11.5 LUFS and never adds master-bus compression.

These are starting targets, not platform normalization targets. If at least three artist-catalog references exist, the target loudness is blended toward the artist's own median and clamped to a safe range. Codec-stress evidence can automatically increase true-peak headroom.

## Closed-loop acceptance

A candidate must satisfy all of the following before it can be promoted:

- no critical Mastering Inspector issue;
- no sample clipping;
- true peak within the computed target tolerance;
- integrated loudness within the computed target range;
- dynamics not materially degraded versus the source.

If the first render does not pass, the processor performs one safer iteration with more peak headroom and, when needed, a slightly lower loudness target. A non-passing result is still available for review/download, but cannot replace the canonical master.

## Durable execution

Active Mastering uses the existing single-concurrency Vercel Sandbox Media Worker. Jobs are durable in Supabase, callbacks use one-time SHA-256-hashed credentials, and late results are rejected when the source master changed during rendering.

The worker bootstrap explicitly downloads every V4 audio runtime dependency, including Mastering Inspector and Active Mastering, so a fresh Sandbox does not depend on files left by an older persistent snapshot.

## Stem-aware mix rescue

Stem Intelligence is deliberately not allowed to alter stems automatically in this first production contract. The architecture keeps that as a separate future stage because correcting the mix (kick/bass balance, vocal harshness, transient restoration, etc.) has materially different creative risk from mastering a stereo mix.

When added, Mix Rescue should produce a new immutable mix candidate first, then feed that candidate through this same Active Mastering + QA pipeline. It should never silently rewrite stems or bypass the canonical-master promotion gate.
