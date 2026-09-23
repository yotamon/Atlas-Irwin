# ADR 006: Processor descriptors and deterministic compute routing

**Status:** Accepted  
**Date:** 2026-09-11

## Context

Cloud Media Worker jobs and device jobs currently use separate envelopes. We need hybrid execution without building a second orchestration system or falsely assuming local/cloud implementations are identical.

## Decision

A language-neutral `RuntimeTask` identifies the logical processor and carries job-specific payload/context. `ProcessorDescriptor` declares actual supported targets and requirements. Job-specific payload validation remains at domain boundaries.

A deterministic Compute Router evaluates runtime availability, media colocation, network, entitlements, paid-compute policy, and raw-audio privacy constraints. Preferences may influence order; hard constraints may not be overridden.

A processor is not declared multi-target until conformance has been proven for those implementations.

## Consequences

- Current DeviceJob and Media Worker envelopes can become adapters incrementally.
- `neverUploadAudio` is enforceable as a system rule rather than a UI hint.
- Automatic routing can minimize media transfer.
- We avoid a giant union payload and preserve existing domain validators.
