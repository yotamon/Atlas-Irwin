# ADR 008: Semantic project sync is separate from media sync

**Status:** Accepted  
**Date:** 2026-09-11

## Context

The Library Bridge already has revision/outbox semantics for device-library deltas. A future project sync must support offline edits without turning large media files into mandatory sync traffic.

## Decision

Project changes synchronize as versioned semantic mutations through a durable outbox. The initial model is revision-based and idempotent; a CRDT is not introduced without a demonstrated conflict model that requires one.

Media synchronization has an independent policy. Project data, analysis, artwork, masters, stems, and reference recordings can each be enabled or disabled separately.

## Consequences

- Offline project work can be durable without an always-online database.
- Cloud project sync does not imply cloud audio storage.
- The existing outbox/revision design can evolve rather than be discarded.
