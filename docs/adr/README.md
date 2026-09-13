# Architecture Decision Records

ADRs capture stable architectural decisions that future changes and coding agents should preserve unless a new ADR supersedes them.

| ADR | Decision | Status |
| --- | --- | --- |
| [001](001-workspace-read-models.md) | Deep workspace read models keep routes thin | Accepted |
| [002](002-video-editor-command-boundary.md) | Video Editor commands use one authorized session plus domain policies | Accepted |
| [003](003-media-worker-contract-v1.md) | TypeScript and Python communicate through a versioned Media Worker contract | Accepted |
| [004](004-local-first-platform-boundaries.md) | Ensemblis is one product with Local and Cloud runtime adapters | Accepted |
| [005](005-recording-media-analysis-identity.md) | Recording, media location, and versioned analysis have separate identities | Accepted |
| [006](006-runtime-tasks-processors-routing.md) | Processor descriptors and deterministic routing govern hybrid execution | Accepted |
| [007](007-portable-ensemble-projects.md) | `.ensemble` packages are portable project state; SQLite is device-local infrastructure | Accepted |
| [008](008-semantic-sync-and-media-policy.md) | Semantic project sync is independent from optional media sync | Accepted |
| [009](009-capability-entitlements-and-cost-telemetry.md) | Entitlements use stable capabilities and pricing follows measured runtime cost | Accepted |
| [010](010-local-privacy-trust-boundary.md) | Local paths/raw-media constraints fail closed below the UI boundary | Accepted |

See [the local-first architecture](../architecture/local-first-platform.md) and [implementation map](../architecture/local-first-implementation-map.md) for the current cross-runtime design.

When changing an accepted decision, add a new ADR that explains the replacement and links back to the superseded record. Do not silently rewrite historical rationale.
