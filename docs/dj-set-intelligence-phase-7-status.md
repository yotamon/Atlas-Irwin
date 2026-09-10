# DJ Set Intelligence Phase 7 Status

**Phase:** Rekordbox read/import, history intelligence and safe export  
**Status:** Implemented in the Phase 7 PR  
**Baseline:** Phase 6 source/execution adapter contracts

## Integration boundary

Phase 7 uses the vendor-supported Rekordbox XML interchange format. It does not read or mutate Rekordbox's internal database.

The adapter implements the Phase 6 `DjLibrarySourceAdapter` contract and normalizes:

- collection track identity and metadata;
- playlists/folders and TrackID/Location playlist references;
- BPM/key/rating/color/grouping metadata;
- cue, hot-cue, memory-cue and loop markers;
- beat-grid evidence, including multiple tempo segments;
- History playlists when present.

Local file locations are used transiently while parsing playlist references and are deliberately omitted from normalized/cloud-safe track objects.

## Local-first Studio import

The DJ & Mixes workspace can open a Rekordbox XML file directly in the browser.

The importer:

1. validates the XML locally;
2. parses tracks/playlists/cues/grids/history on-device;
3. shows a local inspection summary;
4. never posts the XML or Rekordbox `Location` values;
5. can explicitly send only a versioned aggregate history observation to Personal DJ Intelligence.

DTD and custom entity declarations are rejected and input size is capped before parsing.

## History learning

Rekordbox History is observational evidence, not an instruction to the planner.

`ensemblis.dj-library-history-observation.v1` derives only bounded aggregate sequence evidence such as tempo movement and harmonic movement. Raw track IDs, paths and per-track histories are not persisted in the cloud evidence table.

Library-history evidence feeds the existing `dj_profiles` aggregation. It does not create a second profile system.

Safety bounds:

- maximum 0.4 weight per persisted library-history observation;
- maximum 1.5 aggregate library-history weight across revisions during profile recalculation;
- deliberate Set Builder feedback, edits and approvals retain their stronger weights;
- the existing learned-confidence ceiling and ±8-point planner nudge ceiling still apply;
- history sessions are evaluated independently, so separate sets never create synthetic cross-session transitions.

## Safe Rekordbox XML export

`exportRekordboxXml` produces a fresh XML interchange document rather than touching Rekordbox internals.

Export requires an explicit local `file://` resolver for every track at execution time. This keeps paths at the device edge and lets the future Library Bridge provide them without persisting them in cloud state.

The exporter preserves compatible normalized metadata, tempo/grid evidence and cue/loop markers and emits playlist references using fresh export TrackIDs.

## Validation

Phase 7 adds functional regression coverage for:

- XML entity decoding;
- rating conversion;
- playlist resolution;
- hot cues, memory cues and loops;
- variable-tempo grids;
- History ordering;
- DTD/entity rejection;
- privacy-safe normalized output;
- safe export and round-trip parse;
- bounded history observations and persistence limits.

## Exit condition

Phase 7 is complete when Ensemblis can read a useful Rekordbox XML library locally, normalize it through the shared source contract, learn conservatively from available play history, and produce a safe interchange export without vendor database mutation or cloud path persistence.
