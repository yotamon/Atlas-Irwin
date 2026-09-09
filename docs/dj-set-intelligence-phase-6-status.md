# DJ Set Intelligence Phase 6 Status

**Phase:** Source and execution adapter contracts  
**Status:** Implemented in PR for Phase 6  
**Baseline:** production-hardened MixPlan core from Phase 5

## Goal

Generalize only the input and execution edges around the existing planner. Vendor and device concerns must not create a second Set Intelligence implementation.

## Normalized source contract

`ensemblis.dj-library-source.v1` defines a stable, source-neutral library track with:

- source and recording identity;
- metadata and user-facing tags/rating/color;
- playlist relationships;
- cue points and beat-grid evidence when available;
- analysis provenance;
- availability and source revision;
- optional canonical Ensemblis Track Intelligence lineage.

The existing `ensemblis.automix-source.v1` reference remains backward compatible for current catalog jobs.

## Source adapter lifecycle

Every future library adapter implements the same lifecycle:

```text
detect
  ↓
describeSource
  ↓
scanTracks + scanPlaylists
  ↓
read metadata / cues / grid / history
  ↓
getRevision
  ↓
NormalizedDjLibraryTrack
```

The contract includes Rekordbox, Serato, Traktor, local-library and artist-catalog source kinds without assigning vendor-specific planning behavior.

## Execution adapter boundary

`ensemblis.automix-execution-adapter.v1` separates deterministic MixPlan instructions from media resolution.

The first concrete adapter is `CloudCatalogExecutionAdapter`, which only accepts available cloud `artist_catalog` sources. A registry selects execution adapters by capability and target. Future device execution plugs into the same contract.

## Safety invariants

- Path is never musical identity.
- Vendor metadata is evidence, not a competing Track Intelligence vocabulary.
- Missing/offline sources fail resolution instead of silently switching files.
- Explicit unknown contract versions fail closed.
- Planner code does not detect vendors, read filesystem paths or resolve source bytes.
- Device/local support can be added without changing MixPlan semantics.

## Exit condition

Phase 6 is complete when source adapters can normalize vendor/local evidence and execution adapters can resolve a versioned MixPlan at the edge while the planner remains unchanged.
