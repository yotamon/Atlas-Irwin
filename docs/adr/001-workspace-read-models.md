# ADR 001: Deep workspace read models

**Status:** Accepted  
**Date:** 2026-09-09

## Context

Release Detail and Video Director pages had accumulated authentication, tenancy resolution, many database clients, cross-domain query orchestration, resilience policy, asset graph construction and UI data shaping in route components. This made request entry points broad, difficult to reason about and difficult to test without asserting implementation details.

## Decision

Cross-domain Studio workspaces use dedicated server-only read-model modules:

- `lib/studio/release-workspace.ts`
- `lib/video-director/workspace.ts`

Routes resolve request parameters and authorized artist context, call one workspace loader and render the returned snapshot.

Read models may coordinate multiple domain clients because composing the UI snapshot is their explicit responsibility. Lower-level domain logic should continue to live in its existing domain module rather than being copied into the read model.

The release read model also owns explicit failure classification: canonical data is required, safety-sensitive downstream scheduling fails closed, and optional enrichment degrades when safe.

## Consequences

- Route files expose a much smaller conceptual interface.
- Query changes and resilience rules have one home.
- Tests protect the read-model boundary instead of requiring SQL/Supabase syntax to remain in pages.
- Large read models are acceptable when their public interface stays small and their responsibility is coherent.
- We do not introduce generic repository interfaces solely to make these loaders look layered.
