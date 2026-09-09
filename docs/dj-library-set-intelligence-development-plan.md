# DJ Library Bridge & Set Intelligence Development Plan

**Status:** Proposed execution plan  
**Product:** Ensemblis  
**Scope:** Local DJ library connectivity, personal DJ intelligence, set planning, transition preview and local mix rendering  
**Canonical branch:** `main`  
**Last reconciled:** 2026-09-09

## 1. Executive decision

Ensemblis should **not** become a cloud music locker for a DJ's full local collection.

The product contract is:

> **Connect your library to Ensemblis. Keep the raw music on your computer. Sync the intelligence, not the collection.**

The existing web application remains the primary Ensemblis UI and control plane. A small native companion, **Ensemblis Library Bridge**, runs on the user's computer and owns access to local audio files, local DJ-library databases, filesystem changes, heavyweight local audio operations, transition previews and final mix rendering.

The cloud stores durable, portable intelligence about the library: recording identity, musical analysis, library relationships, DJ behavior/profile data, set plans and job state. Raw local audio is not uploaded by default.

This architecture gives Ensemblis the advantages of a web product while preserving the storage economics, privacy, reliability and native media access required by serious DJ libraries.

## 2. Why this belongs in Ensemblis

Ensemblis already treats music analysis as the source of downstream decisions. Set Intelligence extends that principle from an artist's release catalog to a DJ's working library.

The intended loop is:

```text
Local DJ library
      ↓
Library Intelligence
      ↓
Personal DJ Profile
      ↓
Set Intent
      ↓
Set Plan
      ↓
Transition Plan
      ↓
Preview / Local Render
      ↓
DJ edits, locks, substitutions and feedback
      ↓
Better Personal DJ Profile
```

The differentiator is not generic playlist recommendation. The system should learn **how this person DJs**: selection habits, sequencing, energy movement, harmonic tolerance, preferred transition patterns, cue behavior, set context and explicit corrections.

## 3. Goals

The program must make the following user experience possible:

1. A user connects a large local music library once without uploading the full collection.
2. Ensemblis incrementally notices new, changed, moved and unavailable files.
3. Ensemblis can reason about the library from any browser even when the source computer is offline, as long as the required derived intelligence was previously synced.
4. The user can ask for a set by duration, context, musical direction and constraints.
5. Ensemblis produces an editable, explainable Set Plan rather than a black-box playlist.
6. Transition previews are rendered from local source audio without uploading full source files.
7. A complete DJ mix can be rendered locally from the approved Set Plan.
8. Rekordbox is the first structured DJ-library source; Serato and Traktor follow behind adapters.
9. Library data, device access and raw audio remain private by default and scoped to the owning workspace/user.
10. Existing Ensemblis Track Intelligence and media-worker foundations are reused instead of duplicated.

## 4. Non-goals

The first program is **not** intended to:

- host an entire DJ library in Supabase Storage;
- replace Rekordbox, Serato or Traktor as the live performance application;
- require open inbound ports on the user's machine;
- give the desktop companion direct Redis/BullMQ credentials;
- synchronize arbitrary local filesystem paths to the cloud;
- upload complete audio files merely to calculate ordinary metadata or render local transitions;
- silently edit the user's source DJ library;
- promise real-time live-deck control in the first release;
- train shared models on a user's local music without explicit future consent and policy work.

## 5. Architectural invariants

These are hard design constraints, not implementation suggestions.

### 5.1 Raw audio is local by default

A local file path and the full audio payload remain on the device unless the user explicitly invokes an operation whose contract permits a temporary derived upload.

### 5.2 Cloud stores portable intelligence

The cloud may store stable recording IDs, metadata, hashes/fingerprints, analysis summaries, embeddings whose license permits commercial use, DJ-library metadata, playlist relationships, cues, history, set plans and anonymized execution metrics required to operate the feature.

### 5.3 Path is not identity

Moving a track from one folder or drive to another must not create a new logical recording or force unnecessary re-analysis.

### 5.4 Device connectivity is outbound only

Library Bridge initiates an authenticated outbound connection to Ensemblis. Ensemblis never requires users to expose a port, configure NAT or make the local machine directly reachable from the internet.

### 5.5 Cloud jobs and device jobs are different execution targets

The existing server/cloud worker remains appropriate for cloud-owned work. Local-media work must be explicitly routed to a paired device.

### 5.6 Derived audio uploads are purpose-bound and temporary

A short transition preview or an explicitly requested proxy may be uploaded using a short-lived signed URL and retention policy. Uploading a preview must never imply permission to retain or reuse the source recording.

### 5.7 DJ-source adapters are isolated

Rekordbox, Serato and Traktor parsing rules must live behind a common source-adapter contract. Product logic must not depend directly on one vendor's database/export format.

## 6. Target architecture

```text
                              ENSEMBLIS CLOUD
┌───────────────────────────────────────────────────────────────────────┐
│                                                                       │
│  Next.js /studio                                                      │
│      │                                                                │
│      ├── Library UI                                                   │
│      ├── Set Builder                                                  │
│      ├── Set Intelligence                                             │
│      └── Device / job status                                          │
│                                                                       │
│  Supabase / Postgres                                                  │
│      ├── devices                                                      │
│      ├── library_sources                                              │
│      ├── recordings / library_tracks / variants                       │
│      ├── track intelligence                                           │
│      ├── DJ profile / history                                         │
│      ├── set_plans / set_items / transition_plans                     │
│      └── device_jobs                                                   │
│                                                                       │
│  Job Router                                                           │
│      ├──────────────────────────► existing cloud media worker          │
│      │                                                                │
│      └──► Device Gateway                                              │
│               │                                                       │
└───────────────┼───────────────────────────────────────────────────────┘
                │ authenticated outbound WSS / HTTPS
                │
                ▼
                         USER COMPUTER
┌───────────────────────────────────────────────────────────────────────┐
│  Ensemblis Library Bridge                                             │
│                                                                       │
│  Pairing/auth       Local SQLite       Device job runner               │
│       │                  │                    │                        │
│       ├──────────────────┼────────────────────┤                        │
│       │                  │                    │                        │
│  Source adapters     File watcher       Audio runtime                  │
│   ├─ folders          + reconcile        ├─ FFmpeg                     │
│   ├─ Rekordbox                          ├─ fingerprinting               │
│   ├─ Serato                             ├─ local analysis               │
│   └─ Traktor                            ├─ preview renderer             │
│                                         └─ mix renderer                │
│                                                │                      │
│                                                ▼                      │
│                                      Local DJ audio library            │
└───────────────────────────────────────────────────────────────────────┘
```

The architectural split is:

```text
Control / Intelligence Plane  = Ensemblis Cloud
Media / Device Plane          = Ensemblis Library Bridge
```

## 7. Existing Ensemblis integration points

The implementation should extend the current architecture instead of establishing a second unrelated job system.

Relevant existing foundations on `main` include:

- `lib/media-worker/queue.ts` for durable media-job state, stale-job recovery and dispatch semantics;
- `app/api/cron/media-worker/route.ts` for current media-worker scheduling;
- `app/api/cron/track-intelligence/route.ts` for track-analysis orchestration;
- `docs/audio-intelligence-v4.md` for the canonical audio-analysis boundaries and provenance rules;
- Supabase/Postgres as the durable product state;
- signed upload URLs as the established pattern for large media results without proxying binary bodies through Next.js routes.

The target execution model becomes:

```text
Web/API
   ↓
Durable job state
   ↓
Job Router
   ├── execution_target = cloud
   │      ↓
   │   existing cloud media worker
   │
   └── execution_target = device:<device_id>
          ↓
       Device Gateway
          ↓
       Library Bridge
```

The current cloud worker's recovery/idempotency patterns should be reused conceptually, but local device jobs should have their own table and protocol rather than overloading video/stem job tables.

## 8. Domain model

Names below are proposed contracts. Exact SQL naming can be refined during migration design, but the boundaries should remain.

### 8.1 `devices`

Represents one paired Library Bridge installation.

Core fields:

```text
id
user_id
workspace_id
name
platform
app_version
protocol_version
public_key / credential metadata
status
last_seen_at
capabilities
created_at
revoked_at
```

`capabilities` should describe what the device can actually do, for example:

```json
{
  "ffmpeg": true,
  "local_analysis": ["metadata", "fingerprint", "waveform", "loudness"],
  "dj_sources": ["folders", "rekordbox"],
  "render": ["transition_preview", "full_set"]
}
```

### 8.2 `library_sources`

Represents a logical local source, not an exposed path.

Examples:

- local folder;
- external SSD library;
- Rekordbox collection;
- Serato library;
- Traktor collection.

Cloud fields should include a source ID, device ID, source kind, display name, sync state and timestamps. The exact local path remains in Bridge SQLite.

### 8.3 `recordings`

Represents the musical recording identity independent of a file path.

Candidate identity evidence:

```text
recording_fingerprint
content_hash when available
acoustic fingerprint provider/version
normalized duration
canonical metadata hints
```

A recording can have multiple local file variants and related edits.

### 8.4 `library_tracks`

Represents the user's DJ-library concept of a track and its personal metadata.

Possible fields:

```text
recording_id
workspace_id
artist scope when applicable
title
artist_name
album
mix_name
bpm
key
rating
color
tags
comment
play_count
last_played_at
added_at
source_metadata
```

This layer is where Rekordbox/Serato/Traktor-specific user data is normalized.

### 8.5 Local-only `file_bindings`

This table belongs in Bridge SQLite and must not require a cloud copy of the absolute path.

```text
library_track_id
local_source_id
absolute_path
file_size
mtime
content_hash
recording_fingerprint
availability
last_verified_at
```

A path move updates a binding. It does not create a new recording.

### 8.6 `track_analysis`

Do not create a competing definition of Ensemblis Track Intelligence. Store local-library analysis using the same provenance discipline as Audio Intelligence V4 and map reusable evidence into existing canonical forms where practical.

Each derived result must carry:

```text
analysis_version
analyzer
analyzer_version
source_fingerprint
created_at
quality/confidence
```

### 8.7 `dj_profiles`

A structured, inspectable Personal DJ Profile derived from evidence and explicit preferences.

Potential dimensions:

- preferred BPM ranges and movement;
- harmonic-transition tolerance;
- energy-curve tendencies;
- genre/scene relationships;
- vocal density preferences;
- preferred intro/outro lengths;
- transition technique frequency;
- artist/track repetition avoidance;
- set-context preferences;
- explicit likes/dislikes and locked rules.

This must not become opaque chat memory. Every durable preference should have source/evidence and confidence.

### 8.8 `set_plans`, `set_items`, `transition_plans`

`set_plans` stores intent, duration, constraints, target trajectory, model/planner version and lifecycle state.

`set_items` stores ordered selected tracks plus reasons, role in the set, expected start/end windows and user lock/substitution state.

`transition_plans` stores the deterministic media instructions between adjacent items:

```text
from_track_id
from_start_ms / from_end_ms
to_track_id
to_start_ms / to_end_ms
target_bpm
phrase_length_bars
transition_technique
EQ/filter/gain automation parameters when supported
planner confidence
user_override state
```

The plan is cloud data. Rendering the plan is a device operation.

### 8.9 `device_jobs`

Proposed types:

```text
ANALYZE_TRACK
CREATE_PROXY
RENDER_TRANSITION
RENDER_SET
REFRESH_LIBRARY_SOURCE
```

Proposed lifecycle:

```text
PLANNED
  ↓
WAITING_FOR_DEVICE
  ↓
DISPATCHED
  ↓
RUNNING
  ↓
UPLOADING_RESULT   (only when a cloud result is required)
  ↓
COMPLETED
```

Terminal alternatives:

```text
FAILED
CANCELLED
EXPIRED
```

Every job needs an idempotency key, retry policy, execution target and request/result provenance.

## 9. Track identity and reconciliation

Track identity is one of the highest-risk parts of the system and must be implemented before sophisticated Set Intelligence.

### 9.1 Identity hierarchy

Use multiple evidence layers:

1. exact content hash for byte-identical files;
2. acoustic fingerprint for the same recording across encodes;
3. duration + normalized metadata as supporting evidence only;
4. explicit DJ-library external IDs where available;
5. user-confirmed merge/split corrections for ambiguous cases.

### 9.2 Recording versus variant

The system must distinguish:

```text
Song / composition concept
        ↓
Recording / edit
        ├── Extended Mix
        ├── Radio Edit
        └── Remaster
              ↓
File variants
        ├── WAV
        ├── AIFF
        └── MP3
```

Two encodes of the same extended mix may share a `recording_id`. A radio edit and extended mix should normally remain different recordings because their mixability and structure differ.

### 9.3 Move/rename reconciliation

On filesystem change:

```text
old path disappears
new path appears
      ↓
exact hash / fingerprint match
      ↓
update local file binding
      ↓
no cloud track duplication
no re-analysis unless source bytes/analysis version require it
```

### 9.4 External drive behavior

A disconnected drive changes **availability**, not identity.

Cloud Set Intelligence may continue using previously synced metadata. Preview/render actions surface a clear `source offline` state and can enqueue work as `WAITING_FOR_DEVICE` until the relevant source returns.

## 10. Sync protocol

The Bridge should maintain a local SQLite manifest and synchronize deltas, not resubmit the whole library.

### Initial scan

```text
select source
   ↓
enumerate candidate files / DJ records
   ↓
read metadata
   ↓
compute cheap identity evidence
   ↓
reconcile local manifest
   ↓
send metadata batches
   ↓
run required local analysis
   ↓
send derived intelligence batches
```

### Incremental changes

Use native filesystem watching plus periodic reconciliation because filesystem event streams are not perfectly reliable.

Events should collapse into durable operations such as:

```text
TRACK_ADDED
TRACK_CONTENT_CHANGED
TRACK_METADATA_CHANGED
TRACK_MOVED
TRACK_REMOVED_FROM_SOURCE
SOURCE_OFFLINE
SOURCE_ONLINE
PLAYLIST_CHANGED
DJ_METADATA_CHANGED
```

The cloud API must be idempotent. A client restart or duplicate event must not create duplicate rows.

### Sync cursors

Each source should track:

```text
local_revision
last_cloud_ack_revision
last_full_reconcile_at
```

Batch payloads should have bounded sizes, retry with exponential backoff and resume from the last acknowledged revision.

## 11. Library Bridge implementation

### 11.1 Technology

Recommended baseline:

```text
Tauri 2
Rust
SQLite
FFmpeg
native filesystem watcher
OS credential/keychain storage
```

The Bridge should remain intentionally small. The complete product UI continues to live in `/studio`.

### 11.2 Bridge modules

```text
bridge/
  app shell / tray
  auth + pairing
  device presence
  local SQLite store
  source adapters
  filesystem reconcile
  fingerprinting
  local analysis providers
  device job runner
  FFmpeg/render engine
  upload client for signed temporary outputs
  auto-update
  structured logs / diagnostics export
```

### 11.3 Local database

SQLite stores information that is device-specific or sensitive to expose remotely:

- local paths;
- source mount information;
- filesystem timestamps;
- local file hashes;
- source parser cursors;
- pending sync outbox;
- device-job checkpoints;
- temporary render paths;
- local capability cache.

### 11.4 Background behavior

The application should support:

- system tray operation;
- launch at login as opt-in;
- paused sync;
- bandwidth-aware uploads;
- CPU-aware background analysis;
- laptop/battery safeguards;
- clear progress and error state;
- graceful restart/resume.

Do not make the desktop app a second full UI surface.

## 12. Pairing, authentication and Device Gateway

### 12.1 Pairing

Recommended flow:

```text
Web: Connect computer
   ↓
short-lived pairing code / deep link
   ↓
Bridge authenticates user in browser
   ↓
server issues device-scoped credential
   ↓
credential stored in OS keychain
   ↓
device appears in Ensemblis Settings / Connections
```

A user must be able to revoke a device from the web even if the device is offline.

### 12.2 Gateway

The Bridge establishes outbound WSS or a fallback long-poll/HTTPS channel to the Device Gateway.

The gateway is responsible for:

- authenticated presence;
- protocol-version negotiation;
- capability advertisement;
- device-job notification;
- progress events;
- cancellation;
- reconnect/resume.

The Bridge must **never** receive direct Supabase service-role, Redis or BullMQ credentials.

### 12.3 Protocol versioning

Every connection and job should carry a protocol version. The server should be able to reject unsupported Bridge versions with a human-readable upgrade requirement instead of failing media work unpredictably.

## 13. Device job contract

A device job should contain only stable IDs and execution instructions, never absolute local paths.

Example transition job:

```json
{
  "type": "RENDER_TRANSITION",
  "deviceId": "...",
  "fromLibraryTrackId": "...",
  "toLibraryTrackId": "...",
  "fromWindowMs": [222000, 255000],
  "toWindowMs": [31000, 64000],
  "targetBpm": 124.2,
  "bars": 16,
  "technique": "bass_swap",
  "output": {
    "kind": "temporary_preview",
    "codec": "aac"
  }
}
```

The Bridge resolves stable track IDs to local bindings at execution time.

### Reliability requirements

- claim jobs atomically;
- heartbeat long jobs;
- make retries idempotent;
- persist local checkpoints;
- recover after process restart;
- expire stale signed upload URLs and request fresh ones;
- distinguish device-offline from execution-failed;
- do not mark a render failed merely because a device temporarily disconnected;
- allow safe cancellation.

## 14. Audio-analysis strategy

Use a hybrid model rather than blindly moving all existing cloud analysis to desktop.

### Local first

Good candidates for the device:

- container/codec metadata;
- duration;
- exact hash;
- acoustic fingerprint;
- waveform summary;
- loudness / peak analysis;
- tempo/beat support analysis where dependencies are commercially safe;
- basic spectral features;
- preview extraction;
- deterministic render operations.

### Reuse canonical Ensemblis intelligence

Audio Intelligence V4 already defines provenance, musical units, rhythm confidence and analysis tiers. Local-library results should map into these concepts rather than creating a parallel incompatible vocabulary.

### Optional cloud-heavy analysis

When a future licensed model genuinely requires cloud GPU compute:

```text
raw local master
      ↓
local preprocessing
      ├── feature vectors / embeddings
      └── selected normalized excerpt when required
                 ↓
short-lived signed upload
                 ↓
cloud specialist model
                 ↓
derived result + provenance
                 ↓
proxy deleted by retention policy
```

Any such provider must declare commercial license compatibility, input-retention behavior and whether audio leaves the user's device.

## 15. DJ-source adapter architecture

Define one normalized interface before implementing vendor-specific support.

Conceptual adapter:

```text
DjLibrarySourceAdapter
  detect()
  describeSource()
  scanTracks()
  scanPlaylists()
  readTrackMetadata()
  readCuePoints()
  readBeatGrid()
  readPlayHistory()
  getRevision()
```

### Phase order

1. plain local folders;
2. Rekordbox;
3. Serato;
4. Traktor.

Rekordbox should be the first rich adapter because it gives the product an end-to-end reference for playlists, cues, grids and history. The exact supported import/export mechanism must be validated against current vendor formats and license/terms before implementation.

Writes back into third-party DJ libraries are a separate future capability and require explicit safety/backup rules. Initial integrations should be read-only plus exported playlist/set artifacts.

## 16. Personal DJ Intelligence

Set Intelligence should reason from both musical evidence and personal evidence.

### 16.1 Musical features

Candidate signals include:

- BPM and reliable tempo range;
- key / tonal compatibility;
- phrase and section boundaries;
- energy curve;
- groove/rhythmic character;
- vocal density and overlap risk;
- timbral similarity/difference;
- intro/outro suitability;
- breakdown/drop structure;
- loudness and headroom considerations;
- available cue/beat-grid evidence.

### 16.2 Personal evidence

Candidate evidence includes:

- prior playlist/set adjacency;
- play history;
- cue-point placement;
- ratings/tags/colors;
- recurring artist/label/genre clusters;
- preferred BPM movement;
- repeated transition patterns;
- explicit user substitutions and rejected suggestions;
- track locks;
- user feedback after preview/render.

### 16.3 Explainability

Every selected track should be able to answer **why it is here**.

Example reasons:

```text
- preserves the requested early-set restraint
- moves energy upward without a vocal clash
- harmonic relationship is compatible with the previous track
- you frequently sequence this track after sparse percussion-led material
- extended intro provides a clean 32-bar entry
```

Do not expose pseudo-scientific certainty. Reasons should distinguish measured musical evidence, inferred personal preference and planner heuristics.

## 17. Set planning

A Set Intent should capture enough context to constrain the planner without forcing users into a complex form.

Suggested fields:

```text
duration
context / venue / purpose
desired energy arc
starting and ending energy
BPM range or freedom
style / scene direction
must-play tracks
blocked tracks/artists
freshness preference
vocal density preference
transition aggressiveness
exploration vs familiarity
```

The planner should operate in stages:

```text
Intent
  ↓
Candidate retrieval
  ↓
Hard constraint filtering
  ↓
Global energy / tempo / narrative trajectory
  ↓
Sequence optimization
  ↓
Transition feasibility scoring
  ↓
Diversity / repetition checks
  ↓
Explainable Set Plan
```

Do not optimize only adjacent track compatibility. A technically smooth sequence can still be a bad set. The planner must score the **global arc** as well as each transition.

## 18. Transition planning

Transition planning is deterministic media instruction derived from musical analysis, not merely prose from an LLM.

Initial supported transition families can be deliberately constrained:

- phrase-aligned blend;
- bass swap;
- EQ blend;
- filter-assisted blend;
- short cut/drop transition where musically justified;
- outro-to-intro conservative blend.

Each transition plan should validate:

- phrase boundary alignment;
- beat-grid confidence;
- tempo stretch bounds;
- vocal overlap risk;
- bass overlap risk;
- gain/loudness safety;
- sufficient source audio before/after cue windows.

Low-confidence plans should degrade to safer transitions or explicitly require review.

## 19. Transition preview workflow

```text
User clicks Preview Transition
        ↓
cloud creates RENDER_TRANSITION device job
        ↓
Gateway dispatches to paired online device
        ↓
Bridge resolves local file bindings
        ↓
Bridge renders only the required windows
        ↓
Bridge uploads short preview through signed URL
        ↓
cloud marks job complete
        ↓
browser streams preview
        ↓
temporary object expires/deletes
```

The first version may use temporary object storage because it is operationally simple and keeps the browser experience normal. Direct device-to-browser streaming can be evaluated later but is not required for product validation.

## 20. Full mix rendering

A full mix render is explicitly user-triggered.

```text
SetPlan + TransitionPlan[]
          ↓
RENDER_SET
          ↓
Library Bridge
          ↓
resolve local sources
          ↓
render deterministic timeline
          ↓
write final WAV/AIFF locally
```

Default output should stay local. Optional cloud upload/export is a separate user action.

The render engine must emit a machine-readable manifest containing:

- source recording IDs;
- source file fingerprints;
- exact in/out windows;
- stretch ratios;
- transition parameters;
- render-engine version;
- output hash;
- warnings/fallbacks.

This makes renders reproducible and debuggable.

## 21. Product UX

### Connections / Library setup

The web experience should make the local/cloud boundary explicit:

```text
Connect your DJ library

Your audio stays on this computer by default.
Ensemblis syncs metadata and musical intelligence so you can plan sets anywhere.

[Download / Open Library Bridge]
```

After pairing:

```text
Yotam-PC                     Online
DJ SSD                       Connected
13,842 tracks                Synced
24 new tracks                Analyzing
Last sync                    2 min ago
```

### Library states

Every track should have understandable availability/analysis states such as:

```text
Available locally
Source offline
Analyzing
Intelligence ready
Needs re-analysis
Missing local source
```

### Set Builder

The first useful interface should support:

- natural-language Set Intent;
- duration/context controls;
- generated ordered plan;
- reason per track;
- energy/BPM trajectory;
- lock track;
- replace suggestion;
- reorder;
- preview adjacent transition;
- regenerate around locked items;
- save version;
- render/export.

## 22. Privacy and security

### Cloud must not store by default

- absolute local paths;
- arbitrary directory listings unrelated to connected sources;
- full source audio;
- OS usernames embedded in paths;
- raw third-party DJ database files unless explicitly needed for a support workflow.

### Device credential

- device-scoped, not service-role;
- stored in OS keychain/credential manager;
- revocable server-side;
- rotated safely;
- minimum API scope;
- never logged.

### Temporary audio

- signed purpose-specific upload URLs;
- random object keys;
- private bucket;
- short retention;
- deletion job plus lifecycle policy;
- no public stable URL;
- no model-training reuse.

### Multi-tenant boundary

All durable cloud objects must be scoped through the same Workspace/User/Artist authorization model used elsewhere in Ensemblis. Service-role workflows must validate lineage explicitly before dispatching jobs or issuing signed URLs.

## 23. Observability and supportability

A feature that interacts with local files needs excellent diagnostics.

Record cloud-side events for:

- device connected/disconnected;
- source sync started/completed/failed;
- batch acknowledgement;
- job planned/dispatched/started/completed/failed;
- preview upload completed/expired;
- protocol/version mismatch;
- capability mismatch.

The Bridge should keep rotating local structured logs and expose **Export diagnostics** with secrets and local paths redacted by default.

Useful metrics:

```text
pairing success rate
initial scan completion rate
tracks indexed / minute
incremental sync latency
identity dedupe rate
analysis success rate
preview time-to-first-audio
render realtime factor
job retry rate
source-offline recovery rate
Bridge crash-free sessions
```

## 24. Testing strategy

### Unit tests

- recording identity decisions;
- move/rename reconciliation;
- sync cursor/outbox behavior;
- Set Intent validation;
- transition feasibility rules;
- device-job state transitions;
- capability negotiation;
- adapter normalization.

### Contract tests

- cloud ↔ Bridge protocol versioning;
- idempotent batch sync;
- duplicate delivery;
- disconnect/reconnect while job runs;
- cancellation;
- expired upload URL refresh;
- revoked device credential;
- unsupported old client.

### Fixture libraries

Maintain synthetic/redistributable fixtures for:

- same recording in WAV/MP3;
- moved files;
- duplicate copies;
- radio versus extended edits;
- malformed tags;
- missing files;
- external drive disappearance;
- playlist changes;
- cue/beat-grid import.

Do not commit private artist/DJ collections to the public repository.

### Audio quality tests

For preview/render engine changes, add deterministic fixtures plus listening evaluation for:

- phrase alignment;
- tempo stretch artifacts;
- bass overlap;
- vocal clashes;
- gain jumps;
- render continuity;
- end-to-end set arc quality.

The Set Intelligence benchmark should include blind human preference, not only numeric compatibility scores.

## 25. Deployment and distribution

The web/cloud portion remains deployed with the existing Ensemblis stack.

Library Bridge needs its own release pipeline:

```text
GitHub Actions
   ↓
Tauri builds
   ├── Windows
   ├── macOS Intel/Apple Silicon
   └── Linux when support is ready
   ↓
code signing / notarization
   ↓
signed release metadata
   ↓
Bridge auto-update
```

Production distribution must not ship unsigned binaries as the normal path. Code-signing/notarization work should be planned before public beta, not after it.

The Bridge and web app must tolerate at least one supported protocol-version overlap so a web deployment does not instantly break users who have not auto-updated yet.

## 26. Implementation phases and PR sequence

The sequence below is intentionally incremental. Each PR should leave `main` deployable and avoid requiring the entire desktop program to ship at once.

### Phase A — Architecture contracts and web-only proof

#### PR A1 — Domain contracts + feature flag

Deliver:

- shared TypeScript contracts for devices, library sources, stable recording identity, Set Intent and DeviceJob payloads;
- feature flag for DJ Library / Set Intelligence;
- validation schemas;
- no production-visible behavior by default.

Exit criteria:

- contracts compile and are covered by tests;
- no local path is represented in cloud DTOs;
- execution target is explicit.

#### PR A2 — Browser local-library prototype

Use browser directory access only as a validation layer, not final architecture.

Deliver:

- opt-in prototype for choosing a local folder where supported;
- local manifest generation;
- metadata/fingerprint proof;
- no raw-audio persistence in cloud;
- simple local-library list in Studio.

Exit criteria:

- a representative large folder can be indexed without full-file uploads;
- refresh reuses existing identity instead of duplicating tracks;
- product assumptions are validated before native Bridge investment.

### Phase B — Cloud device foundation

#### PR B1 — Supabase device/library schema

Deliver additive migrations for:

- devices;
- library_sources;
- recordings/library_tracks;
- device_jobs;
- set plan foundations;
- RLS/policies;
- typed database contracts.

Exit criteria:

- tenant isolation tests pass;
- device revocation is modeled;
- schemas are additive/reversible.

#### PR B2 — Pairing + Connections UI

Deliver:

- device pairing flow;
- device list/state in Connections/Settings;
- revoke device;
- capability model;
- protocol-version contract.

Exit criteria:

- a simulated client can pair, authenticate, reconnect and be revoked.

#### PR B3 — Device Gateway + durable DeviceJobs

Deliver:

- authenticated outbound device channel;
- presence;
- job notification/claim;
- progress/heartbeat;
- cancellation/reconnect;
- stale/retry semantics aligned with existing media-worker reliability principles.

Exit criteria:

- simulated offline device moves jobs to a non-failure waiting state;
- duplicate dispatch cannot execute the same non-idempotent output twice;
- Redis/service-role credentials never reach the client.

### Phase C — Native Library Bridge

#### PR C1 — Tauri shell, auth and local store

Deliver:

- Tauri 2 app skeleton;
- pairing/deep-link handling;
- keychain credential storage;
- local SQLite migrations;
- tray/status UI;
- auto-start opt-in;
- diagnostics foundation.

Exit criteria:

- Windows and macOS development builds pair with Ensemblis;
- restart preserves safe device identity;
- revoke forces re-pair.

#### PR C2 — Folder source + delta sync

Deliver:

- folder selection;
- filesystem watcher;
- periodic reconciliation;
- local manifest/outbox;
- batch metadata sync;
- move/rename/offline-drive handling.

Exit criteria:

- adding one track syncs one delta;
- moving a track preserves identity;
- disconnecting a source does not delete cloud intelligence;
- reconnect resumes without full rebuild when possible.

#### PR C3 — Local fingerprint + analysis runtime

Deliver:

- exact hash and acoustic fingerprint provider;
- local metadata/waveform/loudness analysis;
- provenance/versioning;
- background CPU controls;
- re-analysis scheduling on version changes.

Exit criteria:

- same recording across supported encodes reconciles correctly within benchmark tolerance;
- unsupported/corrupt files fail individually, not the library scan;
- analyzer upgrade produces controlled re-analysis rather than duplicate tracks.

### Phase D — First real DJ library integration

#### PR D1 — Rekordbox read adapter

Deliver:

- validated Rekordbox import adapter;
- normalized playlists;
- cues/hot cues where legally/technically supported;
- beat-grid metadata where available;
- ratings/tags/colors/history where available;
- source revision/delta strategy.

Exit criteria:

- adapter fixtures cover common and malformed cases;
- product remains functional when fields are unavailable;
- adapter is read-only.

#### PR D2 — Personal DJ Profile v1

Deliver:

- structured evidence-backed DJ profile;
- derivation from playlists/history/cues/tags;
- explicit user preference controls;
- inspectable evidence and confidence.

Exit criteria:

- deleting/revoking source evidence does not leave unexplained durable preferences;
- profile computation is deterministic for the same evidence/version.

### Phase E — Set Intelligence

#### PR E1 — Set Intent + candidate retrieval

Deliver:

- Set Builder surface;
- natural-language intent mapped to structured constraints;
- candidate retrieval/filtering;
- must-play/block/lock semantics;
- explainable reasons.

Exit criteria:

- hard constraints are never violated silently;
- unavailable local source does not prevent planning from synced intelligence;
- user can regenerate around locked tracks.

#### PR E2 — Global sequence planner

Deliver:

- energy/BPM trajectory planning;
- global sequence optimization;
- harmonic/rhythm/vocal/structure transition scoring;
- diversity/repetition checks;
- versioned SetPlan output.

Exit criteria:

- representative human review beats simple BPM/key sorting;
- planner exposes weak-confidence transitions;
- same plan version/input is reproducible within declared stochastic rules.

#### PR E3 — Transition Plan v1

Deliver:

- phrase-aligned deterministic transition instructions;
- safe initial technique set;
- feasibility checks/fallbacks;
- render manifest schema.

Exit criteria:

- every transition either yields a renderable deterministic plan or a clear review/fallback state.

### Phase F — Local preview and AutoMixer output

#### PR F1 — Local transition preview

Deliver:

- `RENDER_TRANSITION` DeviceJob;
- FFmpeg/DSP local render path;
- signed temporary preview upload;
- browser playback;
- expiry/deletion lifecycle.

Exit criteria:

- no full source file upload;
- target preview latency is measurable;
- disconnected device gives actionable waiting state;
- temporary object is private and expires.

#### PR F2 — Full local set render

Deliver:

- `RENDER_SET` DeviceJob;
- deterministic set timeline renderer;
- progress/cancel/resume policy;
- local output selection;
- render manifest and output hash.

Exit criteria:

- complete benchmark set renders without cloud source upload;
- source missing mid-render gives recoverable actionable state;
- rerunning same plan is reproducible within codec tolerances.

### Phase G — Expansion

#### PR G1 — Set feedback loop

Use replacements, locks, rejected suggestions and preview feedback to improve Personal DJ Profile with bounded, inspectable evidence.

#### PR G2 — Serato adapter

Add behind the same source contract.

#### PR G3 — Traktor adapter

Add behind the same source contract.

#### PR G4 — Export workflows

Provide safe exports into formats supported by target DJ software. Writing directly into vendor libraries remains separate until backup/compatibility guarantees are proven.

#### PR G5 — Advanced local/cloud analysis providers

Add only when a measured Set Intelligence quality gap justifies the cost/licensing complexity.

## 27. Rollout strategy

### Internal development

- hidden feature flag;
- synthetic fixture libraries;
- Ensemblis development accounts only.

### Private alpha

- small number of DJs with diverse library sizes;
- Rekordbox first;
- explicit diagnostics consent;
- no automatic writes to DJ libraries;
- previews and renders clearly beta-labelled.

### Beta gates

Recommended gates before wider release:

```text
> 95% successful pairing
> 99% incremental sync operations without manual repair
> 99.5% device-job terminal-state correctness
< 1% duplicate-recording rate after reconciliation on benchmark libraries
zero known cross-tenant data exposure
zero raw-source uploads outside explicit contracts
transition-preview success > 95% when sources are online
crash-free Bridge sessions > 99%
```

Set quality must additionally pass human listening/usefulness evaluation. Infrastructure success alone is not product success.

## 28. Risk register

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Vendor library formats change | Import breaks | Adapter isolation, fixtures, version detection, read-only first |
| False recording dedupe | Wrong metadata/analysis association | Multi-signal identity, confidence, user correction, never metadata-only merge |
| Local paths leak to cloud/logs | Privacy failure | DTO prohibition, redaction tests, local-only binding table |
| Bridge offline during render | Confusing failure | `WAITING_FOR_DEVICE`, resumable state, clear UI |
| Large first scan consumes CPU | Poor UX | throttling, pause, battery policy, staged cheap→deep analysis |
| Web and Bridge version drift | Broken clients | protocol negotiation, compatibility window, forced-update only when required |
| Temporary previews retained | Rights/privacy issue | private storage, TTL/lifecycle deletion, audit metrics |
| Planner sounds technically smooth but musically bad | Product failure | global arc scoring, DJ-profile evidence, human benchmark, explicit feedback |
| Research model has incompatible license | Commercial risk | provider registry/license gate, no silent model download |
| Device credential compromise | Account/device access risk | narrow scope, keychain, rotation, revocation, no service credentials |

## 29. Decisions already made by this plan

These should not be reopened casually during implementation:

1. Ensemblis stays web-first.
2. A lightweight native Bridge is the long-term local-media solution.
3. Full local libraries are not uploaded by default.
4. Local paths remain local.
5. Cloud and device jobs have explicit execution targets.
6. The Bridge does not connect directly to Redis/BullMQ and never receives Supabase service-role credentials.
7. The device connection is outbound.
8. Preview upload is derived/temporary; full mix output is local by default.
9. Rekordbox is the first rich DJ-source adapter; adapter architecture must support Serato and Traktor.
10. Recording identity is independent of path and file encoding.
11. Set Intelligence is global-set planning plus transition feasibility, not only adjacent BPM/key matching.
12. Personal DJ preferences remain structured, evidence-backed and inspectable.

## 30. Questions intentionally deferred until implementation evidence exists

These do not block Phase A/B:

- Which commercially safe acoustic fingerprint implementation gives the best local performance/accuracy?
- Which local analysis modules should be native Rust versus packaged Python/sidecar workloads?
- Whether direct device-to-browser preview streaming is worth the complexity after temporary preview upload is measured.
- How much of existing Audio Intelligence V4 should execute locally versus the current cloud worker for connected libraries.
- Which exact Rekordbox access/export path is technically and contractually appropriate at implementation time.
- Whether Linux should be a supported public Bridge target at initial beta.
- Which advanced transition DSP techniques justify a dedicated native DSP layer beyond FFmpeg filters.

Every deferred decision should be resolved with a benchmark, compatibility finding or product requirement rather than preference alone.

## 31. Definition of done for the program

The first complete version is done when a user can:

1. install and pair Library Bridge;
2. connect a large folder/Rekordbox library without uploading the source collection;
3. see the library and sync status in Ensemblis;
4. add/move/remove tracks and receive incremental reconciliation;
5. disconnect/reconnect an external source without losing cloud intelligence;
6. ask Ensemblis for a structured set with duration/context/constraints;
7. inspect why each track was selected;
8. lock, replace and reorder tracks;
9. preview a transition using local source audio;
10. render the approved complete set locally;
11. return later from another browser and continue planning from synced intelligence;
12. revoke the device and immediately prevent future device-job dispatch;
13. verify through product messaging and behavior that the raw library was never silently uploaded.

## 32. Recommended first implementation slice

Start with **A1 → A2 → B1**, not with the desktop app.

That sequence proves three high-risk assumptions cheaply:

```text
Can Ensemblis represent a local-only library cleanly?
        ↓
Can identity/reconciliation work without cloud audio storage?
        ↓
Is the resulting intelligence sufficient to make Set Builder useful?
```

Once those contracts are stable, build the Device Gateway and Tauri Bridge around proven data shapes rather than allowing the desktop implementation to define the product architecture accidentally.

The first engineering milestone should therefore be named:

> **Local Library Intelligence Foundation**

Its success criterion is not "desktop app exists". It is:

> **Ensemblis understands a useful local DJ library without owning the audio files.**
