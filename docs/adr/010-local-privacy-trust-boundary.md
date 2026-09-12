# ADR 010: Local paths and raw-media policy fail closed

**Status:** Accepted  
**Date:** 2026-09-11

## Context

The Local Runtime has privileged access to private filesystem paths and raw audio. Cloud services do not need those paths, and rendering against bytes that changed after planning can produce an incorrect result.

## Decision

Local paths may exist only in device-local binding/storage structures and sidecar requests. Public results, sync payloads, portable project state, RuntimeTask metadata, and telemetry must be path-free.

Before local DSP uses a frozen recording reference, the Local Runtime re-hashes the current bytes and fails if they no longer match the expected fingerprint. Raw-audio upload is additionally governed by a hard execution policy that the Compute Router cannot override.

## Consequences

- A private path cannot accidentally become normal cloud metadata.
- Local rendering remains reproducible against a frozen recording identity.
- Privacy rules are enforced below the UI layer and are testable invariants.
