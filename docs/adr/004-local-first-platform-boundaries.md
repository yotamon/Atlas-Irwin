# ADR 004: Local-first platform boundaries

**Status:** Accepted  
**Date:** 2026-09-11

## Context

Ensemblis already contains a production Next.js/Supabase application, a Media Worker cloud runtime, and a Tauri Library Bridge with local SQLite, scanning, analysis, rendering, and device jobs. Treating the bridge as a narrow companion would duplicate architecture when desktop capabilities grow.

## Decision

Ensemblis is one product with multiple adapters and runtimes. Product/domain state is independent of media location and execution location.

The existing Library Bridge evolves into the Local Runtime. The existing Media Worker remains the Cloud Runtime. Supabase remains cloud infrastructure rather than the definition of product state. Python remains the bundled DSP/ML sidecar; Rust owns the local trust/OS boundary; TypeScript owns web/domain orchestration and shared platform primitives.

## Consequences

- Desktop and web can share product concepts without sharing every implementation language.
- Existing production web flows can migrate incrementally.
- No wholesale Supabase replacement or Python-to-Rust rewrite is required.
- New features must choose an owning domain and adapter instead of bypassing these boundaries.
