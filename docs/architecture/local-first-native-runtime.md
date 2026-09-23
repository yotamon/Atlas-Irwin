# Local-First Native Runtime

This document is the implementation companion to ADRs 004-010. It describes the concrete native boundary now used by Ensemblis.

## Runtime topology

```text
Semantic UI / product workflow
            |
            v
       RuntimeTask
            |
       Compute Router
       /     |      \
  Local    Cloud   Browser
    |
 Tauri / Rust trust boundary
    |
 verified local binding
    |
 bundled sidecar
    |
 immutable verified snapshot
    |
 DSP / ML
```

The runtime target is an execution decision. It does not change the recording identity, project model or product semantics.

## Trust boundary

Rust owns filesystem authority. Paths may exist in local SQLite tables and native-only request files, but they are forbidden from:

- portable project manifests
- cloud DTOs
- semantic sync mutations
- shared runtime contracts
- telemetry
- analysis payloads returned across the native boundary

The Rust `privacy` module is the final path firewall for portable/native-returned values.

## Versioned analysis artifacts

`analysis_artifacts` replaces fingerprint-only lookup for automatic reuse. Its composite primary key contains every correctness dimension defined by ADR 005.

The old `analysis_cache` table is deliberately retained. Existing installations therefore do not require a destructive migration, while the new scanner fails closed and recomputes evidence instead of trusting stale fingerprint-only rows.

The bundled analyzer returns `ensemblis.library-bridge.analysis-payload.v1`. Rust validates its processor version, recording identity, planning-evidence identity, required payload shape and path-free invariant before storage.

## Source mutation safety

A file can change after a scan. The runtime therefore does not let the analyzer operate directly on the mutable source path.

The sidecar copies the source to a temporary snapshot and hashes it during the copy. Only a snapshot whose hash equals the frozen recording fingerprint is passed to FFmpeg and Music Intelligence. If the bytes changed, the task fails closed.

## `.ensemble` packages

A portable project is a directory package. `project.json` is strict, versioned and rejects unknown fields. Local paths are held in SQLite `projects` and `project_recording_bindings` tables only.

Writes follow:

1. validate semantic manifest
2. create a unique temp file in the same package directory
3. write complete JSON
4. flush and `fsync` the temp file
5. atomically replace `project.json`
6. sync the containing directory on Unix

Windows uses `MoveFileExW` with replace + write-through semantics so replacement does not degrade into delete-then-rename.

## UI contract

The native webview receives a `ProjectManifest`, never a package path. The currently exposed workflow is intentionally small:

- create project
- open project
- save semantic changes
- add a local recording reference

A save carries the current revision. Rust compares that revision with the registered package and rejects stale writes.

## Cross-runtime consistency

`tests/local-first-native-contract.test.mjs` pins the identity shared by TypeScript, Rust and Python. A processor/schema version change must update all participating runtimes together or CI fails.

The Library Bridge workflow first validates contracts and Linux Rust code. Once the PR is ready for review, it also builds the actual Windows and macOS release bundles, covering platform-specific packaging and atomic file replacement code.
