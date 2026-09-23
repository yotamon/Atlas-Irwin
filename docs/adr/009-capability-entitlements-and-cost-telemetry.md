# ADR 009: Capability entitlements and measured compute economics

**Status:** Accepted  
**Date:** 2026-09-11

## Context

Commercial plans will change more often than processing code. Credit pricing is unsafe to invent before actual CPU/GPU/transfer/storage economics are measurable.

## Decision

Runtime authorization uses stable capability strings such as `cloud.compute`, never commercial plan names. Future billing systems translate products/plans into an entitlement set outside processor implementations.

Execution telemetry is collected before credit pricing is encoded. Telemetry is path-free and contains only processor/target/version, bytes, runtime/queue durations, hardware/provider class, and cost estimates where known.

## Consequences

- Pricing changes do not require audio/DSP code edits.
- Offline local licenses can eventually use signed cached entitlements.
- Credit values can be based on measured economics instead of guesses.
- Telemetry remains safe to synchronize because local filesystem information is forbidden.
