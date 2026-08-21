# Atlas Music Intelligence v2

Music Intelligence is the shared musical understanding layer for Atlas Studio. A track should be analyzed once, inspected by the artist, and then reused by Growth OS, Marketing, Video Director and derived renders.

## Goals

Atlas should answer these questions without asking the artist to manually type timestamps:

- What is the real musical structure of this track?
- Where are the beats and downbeats?
- Which moments are recurring / memorable rather than merely loud?
- Which windows work best for 6s, 8s, 15s and 30s short-form content?
- Where should visual edits land?
- Can the artist hear every detected section/candidate and verify the system's interpretation?

## Pipeline

```text
Master / Vault audio
  -> Media Worker
  -> standardized PCM WAV timeline
  -> all-in-one-infer semantic structure + beats + downbeats
  -> librosa energy / onset / chroma features
  -> Atlas hook-candidate scoring
  -> social-cut selection
  -> canonical track_music_intelligence cache
       |-> Growth OS / Track Vault inspector
       |-> Marketing audio_timestamp_start/end
       |-> Video Director music map + storyboard timing
       `-> hook_15 / promo_30 render windows
```

## Structural analyzer

The worker uses `all-in-one-infer` with its default `harmonix-all` ensemble when available. It returns semantic segments such as intro, verse, chorus, bridge, instrumental and solo along with BPM, beats and downbeats.

Atlas always normalizes source media to a PCM WAV before inference. This keeps timing stable across MP3/AAC decoder implementations and makes the semantic analyzer and Atlas feature extractor operate on the same sample timeline.

If semantic inference fails, the worker degrades to a librosa audio fallback. The fallback can still return energy, onset information, generic structural boundaries and an editing grid, but its metadata explicitly says:

```json
{
  "quality": "fallback",
  "semantic_structure": false,
  "real_downbeats": false
}
```

A duration-only estimate is even stricter: it does not invent a hook or claim audio-derived structure.

## Hook scoring

A `chorus` is evidence, not the answer. Atlas ranks multiple candidate windows using:

- recurrence / musical similarity
- semantic structural importance
- energy lift into the window
- absolute energy
- novelty versus the preceding material
- rhythmic onset density
- melodic/harmonic salience
- alignment to edit boundaries
- loopability of start/end

The current score is intentionally deterministic and explainable. Each candidate stores its component metrics and short human-readable reasons so the Inspector can explain why it was ranked.

Candidate kinds currently include:

- `instant_impact`
- `groove`
- `melodic`
- `climax`
- `build_and_drop`

## Social cuts

Music Intelligence stores preferred windows for:

- 6 seconds
- 8 seconds
- 15 seconds
- 30 seconds

The selected duration is musically aligned, so its exact length may differ slightly from the nominal target when a nearby downbeat produces a cleaner edit.

Marketing converts those millisecond windows to Content Lab's integer-second fields with `floor(start)` / `ceil(end)`. Existing manual timestamps are never overwritten.

Video Director derived renders use the millisecond window directly.

## Canonical track cache

`public.track_music_intelligence` stores one canonical analysis per released-catalog `tracks.id`.

A real v2 result can arrive through either path:

1. Video Director `analyze_audio`
2. Growth OS / Track Vault `analyze_audio` for a release-linked vault entry

Both paths converge into the same canonical row. New Video Director projects prefer that row immediately. Duplicate analysis jobs can become durable cache hits without dispatching the heavy worker again.

Legacy v1 completed jobs have their old idempotency keys moved aside by migration so the track can be upgraded once to v2.

A canonical v2 worker map always wins over a local duration estimate.

## Artist inspection

### Video Director

The Track Intelligence Inspector shows:

- BPM / duration / section / hook / downbeat summary
- energy timeline with playback playhead
- clickable semantic sections
- ranked hook candidates
- hook score and reasons
- detailed metric breakdown
- 6s / 8s / 15s / 30s ready windows
- analyzer engine / model / quality flags
- warnings / diagnostics

Clicking a section or hook seeks the original master to the exact start and automatically stops at the selected end.

### Growth OS

Every analyzed Vault track exposes a compact Music Intelligence preview inside its expanded editor. Sections and the top hook candidates can be auditioned even before a release or Video Director project exists.

## Storyboard timing

The Creative Director still owns the visual narrative. Atlas then applies a deterministic timing pass before persistence:

- if real downbeats are verified, nearby internal shot boundaries can snap to downbeats or structural transitions
- without verified downbeats, only structural edit points are trusted
- the snap is bounded by a tolerance
- a minimum shot length guard prevents broken micro-shots
- scene boundaries are recomputed from the aligned shots

Each persisted shot receives `music_context` including its section, energy, whether it starts on a downbeat, and overlapping hook-candidate information.

## Rendering

`hook_15` and `promo_30` no longer center themselves around the highest-energy section. Their render manifests prefer:

1. the matching Music Intelligence social cut
2. the closest ranked hook candidate
3. legacy highest-energy fallback only for old maps

The original Atlas master remains the final audio source.

## Operational notes

The semantic analyzer uses PyTorch plus source separation and is significantly heavier than the old librosa-only worker. Keep this workload in the Cloud Run Media Worker, not Vercel.

A recommended starting point is 4 vCPU / 8 GiB with one warm instance. Tune using real Atlas tracks rather than reducing resources pre-emptively.

See `services/media-worker/README.md` for deployment details.
