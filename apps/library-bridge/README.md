# Ensemblis Local Runtime

The Library Bridge is the first native execution surface of Ensemblis. It is intentionally a trusted local runtime, not a second product and not a second source of domain truth.

## What stays local

- filesystem paths and folder roots
- device-local media bindings
- portable `.ensemble` package locations
- raw audio when the selected execution policy does not permit upload
- verified snapshots used by local DSP
- the SQLite index, cache and sync outbox

Portable project state, sync payloads, telemetry and cloud APIs must remain path-free.

## Recording and analysis identity

A recording is identified by the SHA-256 hash of its exact bytes. A file path is only a local binding to that recording.

Local analysis is reusable only when the complete artifact identity matches:

`recording fingerprint + processor id/version + model id/version + schema version + parameters hash`

The legacy `analysis_cache` table remains available for migration and diagnostics, but current scans never reuse it automatically.

The current track-planning identity is:

- processor: `dj.track-planning-intelligence`
- processor version: `ensemblis.library-bridge.analyzer.v1`
- model: `atlas-ti`
- model version: `atlas-ti-v4.0.0`
- schema: `ensemblis.library-bridge.analysis-payload.v1`
- parameters: canonical empty parameter set, SHA-256 hashed

## Verified local DSP

A scan freezes a recording fingerprint. Before expensive local analysis, the Python sidecar copies the source into a private temporary snapshot while hashing the bytes. DSP begins only if that snapshot exactly matches the frozen recording fingerprint.

This closes the race where a source file could change after scanning but before or during analysis.

## Portable projects

A project is a directory package ending in `.ensemble`:

```text
My Project.ensemble/
├── project.json
├── media/
├── analysis/
├── assets/
├── exports/
└── cache/
```

`project.json` is the semantic source of truth. It contains recording fingerprints and semantic references, never absolute local paths. SQLite remembers where the package and referenced files live on this device.

Manifest writes are temp-file + fsync + atomic replacement. Saves use optimistic revisions so stale writers fail rather than silently overwriting newer state.

## Native command boundary

The webview can create, open, edit and save portable manifests, but it never receives the package path. Rust resolves `projectId` to the device-local package location.

The same rule applies to media: UI and cloud code work with recording identities; local paths are resolved only inside the native trust boundary.

## Validation

Pull requests touching the Library Bridge run:

- Node contract tests
- Python compilation checks
- `cargo fmt --check`
- `cargo clippy --all-targets --all-features -- -D warnings`
- `cargo test --all-targets`

When a pull request is marked ready for review, CI additionally builds the actual Tauri release bundle and bundled Python sidecar on Windows and macOS.
