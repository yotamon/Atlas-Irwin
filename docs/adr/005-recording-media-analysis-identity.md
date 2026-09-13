# ADR 005: Recording, media, and analysis identities are separate

**Status:** Accepted  
**Date:** 2026-09-11

## Context

A storage path is mutable and provider-specific. A recording can exist simultaneously on a desktop, in cloud storage, and through a browser handle. Expensive analysis also depends on the processor/model/schema/parameters, not only on audio bytes.

## Decision

Exact recording bytes are identified by `sha256:<hex>`. Media locations are separate path-free references. Local filesystem paths remain private bindings inside the Local Runtime.

Analysis artifacts use the compound identity:

`recording fingerprint + processor id/version + model id/version + result schema version + parameters hash`.

Legacy fingerprint-only local analysis is not trusted for automatic reuse after the versioned cache is introduced; recomputation is preferred to silently serving stale evidence.

## Consequences

- File rename/move preserves recording identity and reusable compatible analysis.
- Changed bytes naturally invalidate identity.
- Processor/model/schema upgrades cannot overwrite or masquerade as older evidence.
- The same recording may resolve through multiple media transports without becoming multiple recordings.
