# Ensemblis AutoMix, Set Intelligence & DJ Library Development Plan

**Status:** Active canonical execution plan  
**Product:** Ensemblis  
**Canonical branch:** `main`  
**Last reconciled:** 2026-09-10

## 1. Product decision

Ensemblis has one DJ intelligence core and two source/execution boundaries. We do not create provider-specific planners or separate mixing engines.

```text
Music evidence
      ↓
Canonical Set Intelligence
      ↓
Frozen MixPlan v2
      ↓
Review / revise / approve
      ↓
Cloud renderer or paired-device renderer
      ↓
Verified outcome + bounded DJ learning
```

The planner remains source-neutral. External libraries change where evidence comes from. Device execution changes where audio bytes are resolved and rendered. Neither is allowed to weaken planner safety, MixPlan validation, lineage, or privacy.

## 2. Non-negotiable invariants

Every phase must preserve these contracts:

- one canonical Set Intelligence planner;
- one canonical `MixPlan v2` render instruction format;
- maximum beatmatch stretch of ±6%;
- no pitch shifting;
- phrase-aware transition planning;
- variable-tempo tracks are never forced onto an unsafe constant grid;
- vocal and low-end collision evidence influences transitions;
- hard constraints are never learned around;
- `Journey` preserves all supplied tracks and supplied order semantics, and fails when that story is physically incompatible with the hard safety contract;
- Personal DJ Intelligence only nudges otherwise-valid choices;
- local filesystem paths never cross the Library Bridge cloud boundary;
- local audio is never uploaded merely to plan a set;
- device render re-verifies recording content identity before DSP;
- provider-specific adapters normalize into the source contract before reaching the planner.

## 3. Canonical architecture

### Cloud catalog

```text
Artist catalog master
      ↓
Track / stem / mastering intelligence
      ↓
Set Intelligence
      ↓
Frozen MixPlan
      ↓
Media Worker
      ↓
Catalog mix asset
```

### Paired local library

```text
Local recording
      ↓
Native Library Bridge
      ├── local path stays in SQLite
      ├── content SHA-256 identity
      └── local musical analysis
             ↓
      Path-free planning evidence
             ↓
      Set Intelligence in Ensemblis
             ↓
      Frozen MixPlan
             ↓
      Paired computer
             ├── resolve private path
             ├── re-hash exact recording
             └── canonical DSP render
                    ↓
              Local WAV / MP3
```

The cloud stores only normalized source identity, compact musical evidence, fingerprints, revisions, job lineage and path-free render metadata.

## 4. Source strategy

Active source kinds are:

- `artist_catalog`
- `local_library`
- `rekordbox`
- `traktor`

`local_library` is the Phase 8 native folder source. Rekordbox is the first structured DJ-library adapter. Traktor remains a later adapter after the local execution boundary is proven.

Any additional provider requires an explicit future product and contract decision. It must not be silently accepted by enums, database constraints, capabilities or generic fallbacks.

## 5. Completed foundation

### Phase 0: executable DSP baseline

Completed.

- deterministic offline rendering;
- versioned transition automation;
- safe equal-power transition envelopes;
- controlled low-end handoff;
- limited transition FX;
- loudness normalization and true-peak guard;
- bounded high-quality time stretch;
- no pitch shifting.

### Phase 1: phrase-aware transitions

Completed.

- phrase and section boundaries influence source windows;
- transition planning uses local structural confidence;
- unsafe overlap and stretch fail closed;
- variable tempo remains a first-class signal.

### Phase 2: global Set Intelligence

Completed.

- candidate curation;
- global energy and tempo trajectory;
- transition compatibility considered across the entire route;
- quality/risk summaries;
- `Journey` preservation semantics.

### Phase 3: interactive Set Builder

Completed.

- plan-first workflow;
- durable revisions;
- hard position locks;
- preferred order;
- safe / recommended / adventurous variants;
- transition overrides;
- exact approved render;
- frozen plan hashes and lineage;
- transition preview workflow for catalog sources.

### Phase 4: Personal DJ Intelligence

Completed.

- explicit and learned harmonic adventure;
- transition aggressiveness;
- exploration;
- tempo movement;
- energy dynamics;
- verified edits and approvals become weighted evidence;
- learning confidence is bounded;
- learning never expands the safe execution envelope.

### Phase 5: production hardening

Completed.

- renderer contract versioning;
- historical MixPlan compatibility;
- exact failed-render retry without replanning;
- canonical-master revalidation;
- runtime metrics and QA diagnostics;
- immutable retry lineage;
- recovery UI.

### Phase 6: source adapter contract

Completed.

- provider-neutral track/source identity;
- source capabilities;
- execution targets;
- normalized metadata, cues, beat grid, playlists and history;
- source provenance and revisions;
- source-neutral execution adapter boundary.

### Phase 7: Rekordbox adapter

Completed as the first structured external-library adapter.

Rekordbox data is evidence, not authority over the planner. Imported BPM/grid/cue/history information carries provenance and confidence and is normalized before use.

## 6. Phase 8: Native Library Bridge

**Status:** implementation complete in PR #217; merge remains gated by the Phase 8 exit criteria below.

Phase 8 makes a local DJ/music library usable without creating a cloud music locker.

### 8.1 Native application

- Tauri 2 desktop shell for Windows and macOS;
- trusted Rust filesystem/network boundary;
- webview receives no filesystem, HTTP or shell permission;
- strict CSP;
- OS credential vault for the revocable device credential;
- device-local SQLite for roots, paths, bindings, analysis cache, outbox and local device-job state;
- filesystem watcher plus periodic reconciliation;
- content-SHA-256 recording identity that survives rename/move;
- exact file re-verification before execution.

### 8.2 Local intelligence

A bundled local sidecar performs the musical analysis required for Set Intelligence.

- analysis is cached by recording fingerprint;
- only cache misses are analyzed;
- results are compacted to a bounded planning-evidence contract;
- filesystem locations are scrubbed before sync;
- failed individual analyses do not corrupt the rest of the library revision.

### 8.3 Cloud synchronization

- one-time expiring pairing codes;
- high-entropy device credentials stored hash-only in Postgres;
- revocable paired devices;
- bounded chunked sync;
- atomic revision application;
- path-free source and track tables;
- stale device-job claim recovery;
- owner/artist scoping and RLS.

### 8.4 Local Set Builder

Local tracks enter the same Set Builder semantics as catalog tracks:

- choose 2–20 planning-ready local recordings;
- one paired computer per local set in Phase 8;
- plan from compact musical evidence without uploading audio;
- durable revisions;
- reorder and hard locks;
- replace/exclude;
- safe / recommended / adventurous alternatives;
- transition diagnostics;
- exact approved `MixPlan v2`.

Hybrid catalog + device source pools are intentionally deferred until the device-only execution path is fully proven. Phase 8 fails closed rather than inventing a partial hybrid renderer.

### 8.5 Local render

An approved local set creates a durable AutoMix approval job and a device execution job.

The paired device:

1. resolves each private path from local SQLite;
2. verifies the binding fingerprint;
3. hashes the actual bytes again;
4. builds the renderer request locally;
5. validates MixPlan version/hash/provenance again inside the sidecar;
6. executes the same canonical DSP renderer used by the Media Worker;
7. keeps the resulting WAV/MP3 local;
8. sends only path-free completion metadata to Ensemblis.

The desktop application exposes a local export action for the latest completed mix. Export only copies outputs that resolve inside the trusted render workspace.

### 8.6 Phase 8 exit gates

Phase 8 can merge only when all of the following are green:

- Studio product contracts;
- TypeScript typecheck;
- lint;
- browser smoke tests;
- deep Audio Intelligence regression;
- database migration replay / Postgres lint / pgTAP;
- `cargo fmt --check`;
- `cargo clippy -- -D warnings`;
- Rust tests;
- Library Bridge privacy/contract tests;
- sidecar contract build and version check;
- Windows/macOS packaging contract;
- no unresolved PR review threads;
- branch current with `main`;
- post-merge `main` production build.

## 7. Phase 9: hybrid execution and Traktor

Phase 9 starts only after Phase 8 is merged and production-verified.

Planned scope:

- hybrid candidate pools containing catalog + paired-device recordings;
- explicit execution routing for a frozen plan whose sources span boundaries;
- preview strategy for local and hybrid transitions;
- Traktor adapter using the same provider-neutral source contract;
- richer local playlist/history workflows;
- export workflows for DJ preparation where licensing and source semantics permit them.

Phase 9 must not introduce a second planner or silently upload local recordings to solve hybrid execution.

## 8. Product success criteria

The program is successful when an artist/DJ can:

1. connect music from the Ensemblis catalog, a local library or a supported normalized DJ-library adapter;
2. ask Set Intelligence for a coherent professional route;
3. understand why tracks and transitions were selected;
4. edit and lock artistic decisions without bypassing safety;
5. freeze one exact plan;
6. render it in the correct execution environment;
7. preserve local-media privacy;
8. let verified decisions improve future ranking in a bounded, explainable way.

The architectural rule remains simple: **source adapters provide evidence, Set Intelligence makes the plan, MixPlan freezes the decision, and an execution adapter performs only that frozen plan.**
