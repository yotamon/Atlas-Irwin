# DJ Set Intelligence — Phase 8: Native Library Bridge

Status: in development

This phase introduces the native execution edge for DJ-library sources without changing MixPlan or planner semantics.

## Hard invariants

- Local filesystem paths never enter cloud library state or MixPlan.
- Stable recording identity is content-derived and survives file moves.
- The webview has no broad filesystem permission; Rust owns scanning, hashing, SQLite, and media resolution.
- Device authentication uses a revocable device credential. The desktop app never receives Supabase service-role credentials.
- Sync is outbound HTTPS only. No inbound listener is required.
- Device jobs are durable, idempotent, revision-bound, and fail closed on missing or changed media.
- Rekordbox/Serato/Traktor remain adapters around the source-neutral contracts from Phase 6.

## Exit criteria

- Native Tauri bridge builds on Windows and macOS targets.
- Local SQLite keeps raw paths only in device-local bindings.
- Exact SHA-256 recording identity remains stable across path moves.
- Delta sync transmits path-free normalized library evidence only.
- Pairing/heartbeat/revocation use a dedicated server-side device trust boundary.
- Local execution resolves a frozen source reference only when the expected recording identity is still present.
- Tests prove path privacy, identity stability, revocation, idempotency, and fail-closed execution.
