# Local-First Implementation Map

This document maps the canonical local-first architecture to the current repository. It exists to keep future refactors incremental and to prevent duplicate subsystems.

| Concern | Canonical owner | Current implementation |
| --- | --- | --- |
| Recording content identity | Platform contract | `apps/library-bridge/src-tauri/src/identity.rs`, `contracts/recording.v1.json` |
| Media location | Adapter layer | local `file_bindings`; Supabase TUS transport; `MediaReference` |
| Portable project state | Project domain | `.ensemble/project.json`, `contracts/project-manifest.v1.json` |
| Device-local project bindings | Local Runtime | SQLite only; never portable/cloud state |
| Analysis identity/cache | Runtime evidence | versioned `analysis_artifacts` keyed by processor/model/schema/params |
| Processor capability | Runtime domain | `contracts/processor-descriptor.v1.json`, `lib/platform/processors.ts` |
| Execution choice | Runtime domain | `lib/platform/compute-router.ts` |
| Local execution | Local Runtime | Tauri + bundled Python sidecar |
| Cloud execution | Cloud Runtime | `lib/media-worker`, Media Worker service |
| Web cloud upload | Media adapter | `lib/supabase/resumable-upload.ts` wrapped by `supabaseTusMediaTransport` |
| DJ device sync | Existing sync v1 | `sync_state` + `outbox` + device API |
| Project sync | Semantic sync v2 | `project-mutation.v1` + `sync-envelope.v2`; transport can evolve independently |
| Entitlements | Capability boundary | `entitlement-set.v1`; commercial provider intentionally outside processors |
| Cost measurement | Runtime telemetry | `cost-telemetry.v1`, `lib/platform/telemetry.ts` |

## Rules for new code

1. Never add a filesystem path to a shared TypeScript domain type, cloud request, sync payload, project manifest, or telemetry event.
2. Never use a storage object key as recording identity.
3. Never cache expensive evidence by fingerprint alone when processor/model/schema/parameters affect correctness.
4. Never mark a processor as multi-target until output conformance is tested.
5. Never make domain code import a concrete cloud media transport when an adapter boundary can be used.
6. Never branch inside a processor on a commercial plan name.
7. Keep job-specific payload validation at the owning domain boundary; the RuntimeTask is an envelope, not a mega payload.
8. Keep local execution fail-closed: verify actual bytes still match the frozen recording identity before DSP begins.
9. Preserve old versioned contracts. Introduce a new version for incompatible semantics.
10. Media sync is a separate user policy from project-data sync.

## Safe evolution order

1. contracts and identity
2. versioned evidence cache
3. processor registry and RuntimeTask envelope
4. compute routing
5. portable project state
6. desktop workflows using local bindings
7. hybrid execution
8. semantic sync transport
9. signed entitlements and commercial policy
10. packaging/model distribution/UI refinement

Steps may ship in one PR when needed to reduce CI/deployment churn, but each boundary must remain independently testable and documented.
