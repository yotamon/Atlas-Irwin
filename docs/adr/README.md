# Architecture Decision Records

ADRs capture stable architectural decisions that future changes and coding agents should preserve unless a new ADR supersedes them.

| ADR | Decision | Status |
| --- | --- | --- |
| [001](001-workspace-read-models.md) | Deep workspace read models keep routes thin | Accepted |
| [002](002-video-editor-command-boundary.md) | Video Editor commands use one authorized session plus domain policies | Accepted |
| [003](003-media-worker-contract-v1.md) | TypeScript and Python communicate through a versioned Media Worker contract | Accepted |

When changing an accepted decision, add a new ADR that explains the replacement and links back to the superseded record. Do not silently rewrite historical rationale.
