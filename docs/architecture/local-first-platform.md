# Ensemblis Local-First Platform Architecture

**Status:** Canonical architecture  
**Last updated:** 2026-09-11

## Purpose

Ensemblis is one product with multiple execution and storage runtimes. The web application, desktop application, local sidecar, Media Worker, and Supabase are adapters around shared product concepts rather than separate products.

The architecture deliberately separates three questions:

1. **What is the recording?** Content identity is a SHA-256 fingerprint.
2. **Where is the media?** A recording may have local, cloud, and browser references at the same time.
3. **Where does work execute?** A processor may be executed by a local sidecar, cloud runtime, or future browser runtime when that implementation has proven contract parity.

## Canonical boundaries

```text
                         Product / domain state
                 projects · recordings · analysis · plans
                                  |
                           RuntimeTask contract
                                  |
                           Compute Router
                        /         |          \
                local_sidecar    cloud      browser
                    |              |            |
            Tauri + Python     Media Worker   future
                    |              |
               local files      Supabase / cloud media
```

### Domain state

Portable product state never contains a device-local filesystem path. It refers to recordings by content fingerprint and to media through path-free `MediaReference` values.

### Local runtime

`apps/library-bridge` is the current Local Runtime implementation. Its Rust process owns OS integration, filesystem access, SQLite, device credentials, local execution verification, and the sync outbox. Python remains the bundled DSP/ML sidecar.

### Cloud runtime

`lib/media-worker` and the Media Worker service remain the cloud execution runtime. Supabase remains cloud infrastructure for identity, cloud replicas, service state, optional cloud media, and durable queues. Supabase is not the definition of product state.

## Stable identities

### Recording identity

A recording is identified by `sha256:<64 lowercase hex characters>` over the exact audio bytes. Moving or renaming a file does not change the recording. Changing the bytes does.

### Analysis identity

Analysis is immutable evidence keyed by:

- recording fingerprint
- processor id
- processor version
- model id
- model version
- result schema version
- canonical parameters hash

A processor/model/schema/parameter change therefore cannot silently reuse stale analysis.

## Media references

The shared model recognizes three reference kinds:

- `local_binding`: opaque binding id resolved only by the local runtime
- `cloud_object`: provider + object key
- `browser_handle`: opaque browser-local handle

A local path is an implementation detail of the Local Runtime and is never serialized into a project manifest, cloud job result, sync envelope, or telemetry record.

## Processor registry

Processors describe capability, not implementation language. A descriptor declares inputs, outputs, supported execution targets, network/entitlement/cost requirements, and whether raw audio is required.

A processor is only advertised on multiple targets after conformance is demonstrated. Existing Python, Rust, and TypeScript implementations do not have to share source code; they share contracts and test fixtures.

## Compute routing

The router distinguishes preferences from constraints.

Preferences:

- `automatic`
- `prefer_local`
- `prefer_cloud`

Hard constraints:

- `neverUploadAudio`
- `allowPaidCompute`
- `cloudFallback`

`neverUploadAudio` blocks an upload. It does not block cloud execution when the required media is already present in cloud storage. Automatic routing prefers execution colocated with required raw media to minimize transfer before considering remote compute.

## Portable `.ensemble` projects

The portable project format is a directory package ending in `.ensemble` with `project.json` as the semantic source of truth. Recommended layout:

```text
Project.ensemble/
  project.json
  analysis/
  assets/
  exports/
  cache/
  media/       # optional managed copies only
```

The manifest contains recording fingerprints and semantic references, never local paths. SQLite may index projects and keep device-specific bindings, but SQLite is not the portable project format.

## Synchronization

Project synchronization is semantic mutation synchronization, not filesystem synchronization and not a CRDT by default. Mutations are versioned, durable, idempotent, and sent through an outbox. Media synchronization is an independent policy and is optional.

Project data can therefore sync while masters, stems, or reference recordings remain local.

## Entitlements

Runtime code checks capabilities such as `cloud.compute`, not commercial plan names. Processor code must never branch on values such as `premium`, `pro`, or billing-provider product ids.

Local core behavior must not depend on an always-online licensing server. Future signed offline entitlement documents can authorize locally licensed capabilities while online account entitlements authorize cloud capabilities.

## Cost telemetry

Cloud pricing is downstream of measured runtime economics. Execution telemetry records processor/target/version, bytes, queue/runtime durations, CPU/GPU usage when available, provider, and estimated cost. Telemetry is path-free and must never include filenames or local filesystem locators.

## Migration strategy

Production web flows remain valid while abstractions are introduced around them. In particular, direct browser TUS upload to Supabase remains a supported cloud media transport. Desktop ingestion can bind the same recording locally without uploading it.

The migration rule is: **introduce a stable domain boundary before replacing an implementation behind it.**

## Non-goals

This architecture does not require:

- replacing Supabase
- rewriting DSP/ML from Python to Rust
- embedding the Next.js server inside Tauri
- mandatory cloud storage
- mandatory media synchronization
- a CRDT
- microservices for each processor
- a repository-wide monorepo move as a prerequisite

## Canonical contracts

The language-neutral contracts live in `contracts/`:

- `recording.v1.json`
- `media-reference.v1.json`
- `processor-descriptor.v1.json`
- `analysis-envelope.v1.json`
- `runtime-task.v1.json`
- `execution-policy.v1.json`
- `device-capabilities.v1.json`
- `project-manifest.v1.json`
- `project-mutation.v1.json`
- `sync-envelope.v2.json`
- `entitlement-set.v1.json`
- `cost-telemetry.v1.json`

TypeScript platform primitives live under `lib/platform/`. The Rust Local Runtime implements the same invariants at its trust boundary.
