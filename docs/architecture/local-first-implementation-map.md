# Local-First Implementation Map

This document maps the canonical local-first architecture to the repository. It exists to prevent duplicate subsystems and to make the local/cloud boundary independently testable.

| Concern | Canonical owner | Production implementation |
| --- | --- | --- |
| Recording content identity | Platform contract | `apps/library-bridge/src-tauri/src/identity.rs`, `contracts/recording.v1.json` |
| Media location | Adapter layer | local `file_bindings`; Supabase TUS transport; `MediaReference` |
| Portable project state | Project domain | `.ensemble/project.json`, `contracts/project-manifest.v1.json` |
| Device-local project bindings | Local Runtime | SQLite only; never portable/cloud state |
| Analysis identity/cache | Runtime evidence | versioned `analysis_artifacts` keyed by recording + processor + model + schema + parameters |
| Processor capability | Runtime domain | `contracts/processor-descriptor.v1.json`, `lib/platform/processors.ts` |
| Runtime task envelope | Runtime domain | `contracts/runtime-task.v1.json`, `lib/platform/tasks.ts`, native strict mirror |
| Execution choice | Runtime domain | one canonical router in `lib/platform/compute-router.ts`; bundled into desktop at build time |
| Local execution | Local Runtime | Tauri/Rust trust boundary + bundled Python sidecar; actual bytes reverified before DSP |
| Cloud execution | Cloud Runtime | `lib/media-worker` routed through `RuntimeTask`/`ComputeRouter`, then existing Vercel Sandbox adapter |
| Execution policy | Runtime domain | `execution-policy.v1`; device-local persistence, shared TypeScript routing semantics |
| Web cloud upload | Media adapter | `lib/supabase/resumable-upload.ts` wrapped by `supabaseTusMediaTransport` |
| DJ device sync | Device sync | `sync_state` + durable `outbox` + authenticated device API |
| Project sync | Semantic sync v2 | `project-mutation.v1` + `sync-envelope.v2`; media remains independently optional |
| Desktop licensing | Capability boundary | Ed25519 signed, device-bound Studio license document with pinned public key |
| Perpetual activation policy | Commercial adapter | Supabase activation RPC with row locking and a three-device major-version limit |
| Optional models | Runtime adapter | target-filtered catalog + capability gate + HTTPS + exact size/SHA-256 + atomic install |
| Cost measurement | Runtime telemetry | `cost-telemetry.v1`, `lib/platform/telemetry.ts`, durable cloud execution economics table |
| Native distribution | Packaging | Windows x64, Windows ARM64, macOS ARM64 release matrix with native sidecar/runtime verification |
| Desktop product surface | Local Runtime UI | pairing/license state, policy controls, routed analysis, projects, sync, models and runtime status |

## Rules for new code

1. Never add a filesystem path to a shared TypeScript domain type, cloud request, sync payload, project manifest, entitlement, model-catalog response, or telemetry event.
2. Never use a storage object key as recording identity.
3. Never cache expensive evidence by fingerprint alone when processor/model/schema/parameters affect correctness.
4. Never mark a processor as multi-target until output conformance is tested.
5. Never make domain code import a concrete cloud media transport when an adapter boundary can be used.
6. Never branch inside a processor on a commercial plan name. Gate capabilities at runtime boundaries.
7. Keep job-specific payload validation at the owning domain boundary; the RuntimeTask is an envelope, not a mega payload.
8. Keep local execution fail-closed: verify actual bytes still match the frozen recording identity before DSP begins.
9. Preserve old versioned contracts. Introduce a new version for incompatible semantics.
10. Media sync is a separate user policy from project-data sync.
11. A signing-key change is a trust event. Desktop clients must not silently replace a pinned entitlement key.
12. Model installation is complete only after target, capability, declared size and SHA-256 all verify and the final file is atomically committed.

## Completion status

The original ten-step local-first evolution is implemented as production boundaries:

1. contracts and identity ✅
2. versioned evidence cache ✅
3. processor registry and RuntimeTask envelope ✅
4. compute routing ✅
5. portable project state ✅
6. desktop workflows using local bindings ✅
7. hybrid execution boundary ✅
8. semantic sync transport ✅
9. signed entitlements and commercial policy ✅
10. packaging, optional model distribution and desktop runtime UI ✅

Processor parity remains deliberately capability-specific. "Hybrid execution complete" means the product has one routing/task architecture with proven local-only and cloud-only processor implementations; it does **not** claim that every processor can execute on every target.
