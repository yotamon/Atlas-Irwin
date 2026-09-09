# Ensemblis AutoMix, Set Intelligence & DJ Library Development Plan

**Status:** Active execution plan  
**Product:** Ensemblis  
**Scope:** AutoMix quality, mix/set planning, DJ intelligence, external DJ libraries and eventual local-device execution  
**Canonical branch:** `main`  
**Last reconciled:** 2026-09-09

## 1. Executive decision

The program starts from **what Ensemblis already has**: a working, rendered AutoMix engine, Track Intelligence V4, mastering/tempo evidence, stem activity intelligence, durable mix jobs and the existing web-based catalog workflow.

We will make AutoMix substantially better **before** building Rekordbox integration, a Windows/macOS companion or local-library synchronization.

The execution principle is:

> **First make Ensemblis excellent at planning and rendering mixes from music it already understands. Then widen where the music can come from and where the mix can execute.**

The long-term architecture still supports Rekordbox, Serato, Traktor and a native Library Bridge, but those are expansion layers. They must plug into a mature, source-agnostic AutoMix/Set Intelligence core instead of defining that core.

This deliberately reverses the earlier roadmap. Native library/device work is now late-stage infrastructure, not the starting milestone.

## 2. Product direction

Ensemblis should serve three overlapping users without becoming three separate products:

- an artist who wants a coherent album/catalog mix from their own music;
- a producer/artist/DJ who wants to combine their own catalog with a broader DJ library;
- a DJ who wants intelligent set preparation based on their library, history and style.

The common core is the same:

```text
Music Ensemblis understands
        ↓
Musical + Mix Intelligence
        ↓
Set Intent
        ↓
Global Set Plan
        ↓
Transition Plans
        ↓
Preview / Edit / Lock / Replace
        ↓
AutoMix Render / DJ Export
        ↓
Feedback + Outcomes
        ↓
Better Personal DJ Intelligence
```

External libraries only change the **input boundary**. Local rendering only changes the **execution boundary**. Neither should require rewriting set planning or transition intelligence.

## 3. Existing AutoMix baseline

The current implementation is the foundation, not a prototype to discard.

On `main`, AutoMix already includes:

- canonical `ensemblis.automix.v1` planning contracts;
- music-aware showcase-window selection;
- BPM normalization and local tempo/beat-stability reasoning;
- Camelot/harmonic compatibility;
- energy-curve ordering;
- mastering-quality awareness;
- vocal and bass collision evidence from stem/activity intelligence;
- variable-tempo safeguards;
- deterministic transition strategies including quick mix, bass swap, harmonic blend, breakdown swap, echo out and drop cut;
- Signalsmith-based time stretching with a hard stretch cap and no pitch shift;
- adaptive channel loudness and final mix normalization/true-peak safety;
- durable artist-scoped AutoMix jobs and callback/output lineage;
- an existing Studio mix workflow and rendered output asset.

The roadmap must therefore evolve this engine rather than introduce a parallel `Set Intelligence` implementation.

## 4. North star

The target product should be able to answer:

> **Given this music, this DJ/artist, this context and this desired journey, what is the best set we can build, why is each track here, how should every handoff work, and can Ensemblis render or export it safely?**

A successful AutoMix is not simply technically seamless. It must feel intentionally programmed by a musically competent DJ.

The quality hierarchy is:

```text
1. Track selection
2. Global set arc
3. Transition feasibility
4. Transition musicality
5. DSP/render quality
6. Output mastering
```

Perfect crossfades cannot rescue a weak set order.

## 5. Architectural invariants from day one

### 5.1 Planner is source-agnostic

The planner consumes normalized musical evidence and stable track identities. It must not care whether the source eventually came from an Ensemblis artist catalog, Rekordbox, Serato, Traktor or a local folder.

### 5.2 Renderer is execution-target agnostic

A versioned render manifest should be executable by the current cloud media worker today and by a future local Library Bridge later.

### 5.3 Track Intelligence remains canonical musical evidence

AutoMix must deepen its use of Track Intelligence V4, Lyrics/Stem Intelligence and mastering evidence rather than create competing analysis vocabulary.

### 5.4 LLMs do not perform DSP or replace deterministic planning

An LLM may interpret natural-language Set Intent and explain decisions. Ordering, constraints, musical compatibility, transition feasibility and render instructions remain structured and testable.

### 5.5 Every transition is explainable

A transition should expose measured evidence, planner reasoning, confidence, risk flags and fallback behavior.

### 5.6 Global quality beats greedy adjacency

The engine must optimize a complete set arc, not only the next most compatible track.

### 5.7 User control is first-class

Locks, substitutions, reorder operations, transition overrides and regeneration around fixed choices must be durable plan operations rather than UI-only hacks.

### 5.8 Future local audio stays local by default

When native library support eventually arrives, local paths and full source audio remain on the device unless an explicit operation requires a temporary derived upload.

## 6. Target core architecture

```text
                     ENSEMBLIS MIX INTELLIGENCE CORE

Current catalog / future external source adapters
                    ↓
          Normalized Track Evidence
                    ↓
        ┌──────────────────────────┐
        │  Candidate Intelligence  │
        │  sections / phrases      │
        │  tempo / key / energy    │
        │  vocals / bass / stems   │
        │  mastering / confidence  │
        └────────────┬─────────────┘
                     ↓
               Set Intent
                     ↓
        ┌──────────────────────────┐
        │ Global Sequence Planner  │
        │ constraints + arc        │
        │ diversity + narrative    │
        │ personal preference      │
        └────────────┬─────────────┘
                     ↓
        ┌──────────────────────────┐
        │ Transition Planner       │
        │ boundary + phrase        │
        │ vocal/bass safety        │
        │ tempo/harmonic fit       │
        │ technique + confidence   │
        └────────────┬─────────────┘
                     ↓
             Versioned MixPlan
            /                 \
           ↓                   ↓
 Current cloud renderer     Future device renderer
           ↓                   ↓
      Mix asset            Local mix / preview
```

The most important design rule is that `MixPlan` becomes the durable seam between intelligence and execution.

## 7. Canonical plan model

The existing plan should evolve compatibly toward a versioned contract with four layers.

### 7.1 Set intent

```text
purpose
duration
energy profile / custom energy arc
transition style
start/end energy
BPM freedom/range
must-play tracks
blocked tracks
locked positions
freshness/exploration preference
vocal-density preference
transition aggressiveness
ordering policy
```

### 7.2 Track placement

Each planned track should eventually carry:

```text
track_id
source analysis fingerprint
role in set
selection reasons
source start/end window
playback BPM/time factor
key/energy/tempo evidence
window confidence
user lock state
```

### 7.3 Transition plan

Each adjacent handoff should carry:

```text
from_track_id
to_track_id
technique
bars / overlap
source boundary evidence
phrase/downbeat confidence
tempo compatibility + reliability
harmonic compatibility
vocal collision risk
bass collision risk
mastering considerations
transition confidence
risk flags
planner reasons
fallback technique
render parameters
```

### 7.4 Render manifest

Render instructions must be deterministic and portable:

```text
planner_version
render_engine_contract_version
source fingerprints
ordered source windows
stretch ratios
transition automation
loudness strategy
output target
warnings/fallbacks
```

This is what allows the same future plan to render in the cloud or on a user's computer.

## 8. Phase 0 — Existing AutoMix audit and contract hardening

**Priority: immediate.**

The first development work is on the current AutoMix engine.

### P0.1 Transition Evidence V2

Improve each transition decision with explicit evidence and confidence:

- boundary confidence at outgoing/incoming mix points;
- section/phrase suitability;
- downbeat provenance;
- tempo reliability;
- vocal/bass collision evidence quality;
- risk flags;
- safe fallback technique;
- human-readable reasons that distinguish evidence from heuristic assumptions.

Long blends should be vetoed or shortened when musical-boundary confidence is weak, even if BPM/key compatibility is high.

### P0.2 MixPlan contract vNext

Evolve the current plan without breaking existing renders:

- explicit planner version/capabilities;
- source-analysis fingerprints;
- transition confidence;
- plan-level warnings and quality summary;
- deterministic render-manifest boundary;
- backward compatibility for existing `automix.v1` jobs/assets.

### P0.3 AutoMix regression benchmark

Build a representative private benchmark that covers:

- electronic grid-stable tracks;
- variable-tempo/live-feel tracks;
- vocal-heavy material;
- sparse instrumental intros/outros;
- difficult key jumps;
- large BPM gaps;
- clipped/poor masters;
- tracks with/without stems;
- radio edits versus extended arrangements.

Numeric tests remain necessary but listening evaluation becomes a release gate for planner/DSP changes.

**Exit condition for Phase 0:** AutoMix decisions are versioned, explainable, confidence-aware and safe enough to evolve aggressively without losing reproducibility.

## 9. Phase 1 — AutoMix musical intelligence expansion

### P1.1 Phrase- and section-aware transition points

Today AutoMix already uses structure when choosing showcase windows. The next step is to optimize transition entry/exit points themselves.

For each adjacent pair, evaluate several legal musical handoff candidates:

- phrase boundaries;
- section boundaries;
- reliable downbeats;
- intro/outro windows;
- breakdown/drop boundaries;
- stem entry/exit/lift/release events.

Choose a handoff based on the complete transition, not merely the selected track-window edge.

### P1.2 Energy curves inside tracks

Move from one scalar energy value per track toward local energy around candidate transition points.

This lets the planner understand cases such as:

- high-energy track with a calm outro;
- low-average-energy track with a powerful late peak;
- deliberate breakdown into a stronger next track;
- ending a track before an unwanted energy reset.

### P1.3 Better vocal intelligence

Use available vocal stem and lyric timing evidence to distinguish:

- vocal-on-vocal collision;
- spoken/sparse vocal tolerance;
- instrumental phrase into vocal entry;
- chorus/hook collision;
- intentional vocal handoff.

No vocal stem should degrade gracefully to conservative structural evidence.

### P1.4 Better low-end/percussive intelligence

Use stem activity and arrangement events to improve bass swaps, percussion-led blends and breakdown transitions.

### P1.5 Key intelligence confidence

Do not over-weight uncertain key estimates. Prefer canonical/known key metadata when reliable and preserve analyzer provenance.

### P1.6 Transition technique expansion

Add techniques only when they have deterministic DSP definitions and benchmark evidence. Candidate future families include:

- phrase-aligned EQ blend;
- percussion-led blend;
- breakdown handoff;
- filtered transition;
- loop-assisted extension;
- controlled double-drop preparation;
- tempo-bridge transition where musically safe.

**Exit condition for Phase 1:** AutoMix is meaningfully better at choosing *where* and *how* to mix, not just which tracks sit next to each other.

## 10. Phase 2 — Global Set Intelligence

This phase turns AutoMix from a renderer with ordering intelligence into a full set-programming engine.

### P2.1 Structured Set Intent

Add a structured intent model that can be filled by controls or parsed from natural language.

Example:

> 55-minute warm-up, restrained first 15 minutes, mostly my nu-disco catalog, avoid two vocal-heavy songs in a row, peak in the final third and finish warm rather than explosive.

The LLM translates this into constraints. The planner owns execution.

### P2.2 Global arc optimization

Optimize the whole sequence for:

- target energy trajectory;
- BPM movement;
- harmonic flow without monotonous key locking;
- vocal density;
- stylistic narrative;
- artist/track repetition;
- diversity versus familiarity;
- opening/closing suitability;
- transition feasibility across the entire route.

### P2.3 Duration-aware selection

AutoMix should decide how much of each track to use rather than dividing target duration approximately across all selected tracks.

The planner can omit weak candidates, extend strong passages and shorten material while preserving complete musical units.

### P2.4 Plan alternatives

Generate useful alternatives such as:

```text
Safer / smoother
More adventurous
Higher energy
More of my own music
More instrumental
Different peak track
```

Alternatives should branch from the same stable Set Intent and preserve user locks.

### P2.5 Explainability

Every placement should answer why it is there, for example:

```text
- establishes the requested restrained opening
- creates the first meaningful energy lift
- provides an instrumental bridge between two vocal-heavy tracks
- harmonic relationship is safe but not repetitive
- this arrangement offers a clean 32-bar outgoing phrase
```

**Exit condition for Phase 2:** a human can use Ensemblis to program a convincing set even before pressing Render.

## 11. Phase 3 — AutoMix Studio UX and editing

The web app remains the primary UI.

### P3.1 Set Builder workspace

Evolve the current mix workspace into an interactive set plan with:

- energy/BPM trajectory;
- ordered tracks;
- selected source windows;
- transition confidence/risk;
- selection reasons;
- timeline duration;
- warnings.

### P3.2 Editing operations

Support durable operations:

- lock track/position;
- replace one suggestion;
- reorder;
- block track;
- regenerate around locks;
- change one transition technique;
- regenerate one transition;
- save versions;
- compare variants.

### P3.3 Transition previews

Before rendering a full set, let users preview only an adjacent handoff using current cloud sources.

This is deliberately implemented **before** local-device work so the transition product experience can be validated on infrastructure that already exists.

### P3.4 Plan-first rendering

Full render becomes an explicit execution of an approved/versioned plan, making planning and rendering separable product concepts.

**Exit condition for Phase 3:** users can iteratively shape a mix instead of submitting one opaque AutoMix job and waiting for a finished file.

## 12. Phase 4 — Personal DJ Intelligence

Personalization begins using evidence already available inside Ensemblis before external DJ history exists.

### P4.1 Explicit preferences

Learn only from inspectable evidence such as:

- accepted/rejected track suggestions;
- locks;
- substitutions;
- reordering;
- selected transition alternatives;
- explicit user settings;
- saved set variants.

### P4.2 DJ Profile

Maintain a structured profile with confidence/source for dimensions such as:

- preferred BPM movement;
- harmonic tolerance;
- energy-shape tendencies;
- vocal density;
- transition aggressiveness;
- preferred opening/closing behavior;
- technique preference;
- exploration versus familiarity.

### P4.3 Feedback loop

```text
Set Plan
   ↓
User edits / preview choices
   ↓
Structured evidence
   ↓
Bounded DJ Profile update
   ↓
Future planner scoring
```

Personalization may re-rank or adjust bounded planner weights. It must not override hard safety/quality constraints.

**Exit condition for Phase 4:** Ensemblis starts to feel like *my* DJ assistant using only interactions the product already owns.

## 13. Phase 5 — Production hardening and scale

Before broadening inputs, make the core operationally mature.

Deliver:

- plan/job idempotency;
- resumable/retry-safe rendering;
- deterministic source lineage;
- exact master fingerprint checks;
- transition-preview caching where valid;
- cost/runtime metrics;
- planner and renderer version compatibility;
- mix-level QA diagnostics;
- benchmark regression in CI/private evaluation;
- output manifest persisted with asset lineage;
- graceful behavior when optional intelligence is missing.

A mix should remain reproducible from its plan and source fingerprints even after the planner evolves.

## 14. Phase 6 — Source and execution adapter contracts

Only after the core is mature do we generalize the edges required by DJ software/local libraries.

### P6.1 Normalized external track contract

Define a source-neutral input carrying stable identity plus available evidence:

```text
track identity
source identity
metadata
analysis provenance
user tags/rating
playlist relationships
cue/grid data when available
availability
```

### P6.2 Source adapter interface

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

### P6.3 Execution adapter

The renderer receives a versioned MixPlan/manifest and resolves source media through an execution adapter.

Initial adapter:

```text
CloudCatalogExecutionAdapter
```

Later:

```text
LocalLibraryExecutionAdapter
```

This prevents local-device concerns from leaking into planner logic.

## 15. Phase 7 — Rekordbox integration

Rekordbox becomes the first rich external DJ source **after** AutoMix/Set Intelligence is already valuable.

### P7.1 Read/import support

Validate current vendor-supported mechanisms and terms at implementation time, then import what can be supported safely:

- tracks;
- playlists/crates;
- BPM/key metadata;
- ratings/tags/colors;
- cues/hot cues;
- beat grid;
- play history where available.

The adapter is read-only first.

### P7.2 DJ-history personalization

Feed normalized historical evidence into the same Personal DJ Profile rather than creating Rekordbox-specific recommendation logic.

### P7.3 Export

Support safe playlist/set export formats where possible. Direct mutation of a user's Rekordbox database is a separate future capability and requires backup/compatibility guarantees.

**Exit condition for Phase 7:** a Rekordbox DJ can get a better Ensemblis Set Plan using their existing library/history without changing the AutoMix core.

## 16. Phase 8 — Native Library Bridge for Windows and macOS

The native companion is now an execution/storage expansion, not the product foundation.

### 16.1 Product contract

> **Keep the raw library on your computer. Sync the intelligence, not the collection.**

The existing Ensemblis web app remains the primary UI. A small **Ensemblis Library Bridge** handles local file access, filesystem changes, local DJ databases, local analysis and local rendering.

### 16.2 Recommended baseline

```text
Tauri 2
Rust
SQLite
FFmpeg / deterministic DSP dependencies
native filesystem watcher
OS keychain / credential manager
```

### 16.3 Security invariants

- outbound authenticated connection only;
- no open inbound port;
- no Supabase service-role credential on device;
- no direct Redis/BullMQ credentials;
- local paths remain in Bridge SQLite;
- device-scoped revocable credential;
- temporary derived uploads only when explicitly required.

### 16.4 Device model

Cloud stores device identity/capabilities/presence and durable device jobs. The Bridge stores local path bindings and resolves stable track IDs locally.

```text
Cloud MixPlan
     ↓
execution_target = device:<id>
     ↓
Device Gateway
     ↓  outbound authenticated WSS/HTTPS
Library Bridge
     ↓
local source resolution
     ↓
preview or full render
```

### 16.5 Local library identity

Path must never become identity. Use exact hashes, acoustic fingerprints and source metadata so renames/moves do not duplicate recordings.

A disconnected external drive changes **availability**, not musical identity or cloud intelligence.

### 16.6 Delta sync

The Bridge maintains a local manifest/outbox and sends incremental metadata/intelligence changes. Native filesystem events are backed by periodic reconciliation.

**Exit condition for Phase 8:** the same Set Plan engine can work with a very large local library without Ensemblis becoming a cloud music locker.

## 17. Phase 9 — Serato, Traktor and broader DJ workflows

Add Serato and Traktor behind the same source contract, then evaluate:

- richer history ingestion;
- cross-library deduplication;
- DJ-software cue/grid export;
- local transition previews;
- local full-set rendering;
- hybrid sets mixing artist catalog + local library;
- live-preparation integrations where vendor APIs permit them.

No vendor-specific feature should bypass normalized track evidence or Personal DJ Profile.

## 18. Data model direction

Do not build all future tables now. Introduce them only when their phase begins, but preserve these conceptual boundaries:

```text
Current
  automix_jobs
  artist/catalog tracks
  Track Intelligence
  media assets / lineage

AutoMix evolution
  versioned MixPlan
  Set Intent
  plan versions / edits
  transition previews
  structured DJ preferences

External-library evolution
  recordings
  library_tracks
  library_sources
  source relationships

Native-device evolution
  devices
  device_jobs
  local-only file_bindings (SQLite)
```

`recordings` represent musical recording identity. `file_bindings` represent where one device can currently find bytes. These concepts must remain separate.

## 19. Quality metrics

Infrastructure health matters, but product quality is primarily musical.

Track metrics over time:

```text
transition preview acceptance
track replacement rate
manual reorder rate
transition override rate
set-plan save/render rate
first-plan acceptance
human preference versus baseline planner
vocal-collision regression
unsafe-stretch regression
boundary-confidence distribution
render failure rate
render realtime factor
final loudness / true-peak conformance
```

For major planner changes, blind A/B listening is mandatory alongside numeric regression.

## 20. Testing strategy

### Deterministic unit/contract tests

Cover:

- BPM/key compatibility;
- tempo-drift classification;
- boundary confidence;
- transition risk/fallbacks;
- vocal/bass collision vetoes;
- Set Intent hard constraints;
- global sequence invariants;
- plan versioning;
- render-manifest reproducibility;
- DSP transition length/finite samples;
- true-peak/loudness safety.

### Representative catalog evaluation

Use private/redistributable material representing different arrangements and production conditions. Do not commit private unreleased music to the public repository.

### Human listening

Evaluate both transitions and the complete set journey. A technically correct transition can still be musically wrong.

## 21. PR execution order

The intended implementation sequence is now:

```text
A1  Transition Evidence V2 + confidence/risk/fallbacks
A2  MixPlan vNext + render-manifest compatibility
A3  AutoMix benchmark/evaluation expansion

B1  Transition-point optimization
B2  local energy + stem/lyric transition evidence
B3  transition-technique/DSP expansion

C1  Set Intent
C2  global set optimizer
C3  duration-aware track/window selection
C4  alternatives + explainability

D1  interactive Set Builder
D2  lock/replace/reorder/version plan operations
D3  transition preview
D4  plan-first full render

E1  Personal DJ Profile
E2  feedback learning loop
E3  personalized planner scoring

F1  production/reliability hardening
F2  source/execution adapter contracts

G1  Rekordbox read adapter
G2  Rekordbox history → DJ Profile
G3  safe export workflows

H1  Windows/macOS Library Bridge
H2  local folder sync + identity/reconciliation
H3  local execution adapter
H4  local preview/full render

I1  Serato
I2  Traktor
I3  advanced hybrid/live workflows
```

Every PR must keep `main` deployable and preserve existing AutoMix outputs unless a versioned migration intentionally changes behavior.

## 22. Immediate implementation slice

Development begins with **A1 — Transition Evidence V2**.

The first code change should improve the existing planner, not add desktop infrastructure.

Deliver:

- outgoing/incoming musical-boundary evidence around current transition points;
- confidence derived from boundary, tempo and activity evidence;
- structured risk flags;
- safe fallback technique in every transition plan;
- long-blend veto/shortening when boundary evidence is weak;
- plan-level transition quality summary;
- regression tests proving high BPM/key compatibility cannot override weak structural evidence.

This gives immediate value to every AutoMix generated from the current Ensemblis catalog and creates fields that the future interactive Set Builder can expose.

## 23. Definition of done for the broader program

The broad program is complete when a user can:

1. create a musically convincing set from existing Ensemblis music;
2. understand the global set arc and why every track was selected;
3. inspect and preview every transition;
4. lock, replace, reorder and regenerate around their choices;
5. render a deterministic, high-quality mix;
6. have Ensemblis learn bounded DJ preferences from their edits;
7. later connect Rekordbox and benefit from the exact same planner;
8. later connect a Windows/macOS local library without uploading the complete collection;
9. mix artist-owned catalog tracks and external DJ-library tracks in one coherent plan;
10. render/export through the appropriate cloud, local or DJ-software execution adapter without changing the core planning model.

The immediate success criterion is intentionally narrower:

> **Make AutoMix better now, using the intelligence Ensemblis already has, while making every new contract reusable by the future DJ-library architecture.**
