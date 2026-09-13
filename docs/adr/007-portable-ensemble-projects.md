# ADR 007: Portable `.ensemble` project packages

**Status:** Accepted  
**Date:** 2026-09-11

## Context

SQLite is excellent device-local infrastructure but is a poor portable project contract. Conversely, embedding absolute filesystem paths in a project makes it non-portable and leaks private machine state.

## Decision

A portable Ensemblis project is a directory package ending in `.ensemble` with `project.json` as its semantic source of truth. It references recordings by fingerprint. Media may remain externally referenced or be copied into a managed `media/` directory according to policy.

Device-local paths and bindings remain in Local Runtime state. SQLite may index project packages and keep caches/outboxes but is not itself the portable project.

## Consequences

- Projects can be copied, backed up, inspected, and migrated independently of one local SQLite database.
- Local paths can change without mutating semantic project identity.
- Cloud replicas can synchronize semantic state without requiring media upload.
