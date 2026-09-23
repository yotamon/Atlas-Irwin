# DJ Set Intelligence — Phase 9: hybrid execution and Traktor

Status: in development (PR #260)

This phase lets one frozen MixPlan span cloud catalog masters and paired-device
recordings without introducing a second planner or moving local audio into the
cloud. It starts only after Phase 8 is merged and production-verified; the
Phase 8 code (device trust boundary, pairing, bridge) is on main, and
production verification of Phase 8 is the merge gate for this phase.

## Scope delivered

- Hybrid candidate pools: versioned catalog + paired-device snapshots
  (`ensemblis.automix-hybrid-candidates.v1`) that normalize fail closed and
  keep every device candidate bound to exactly one paired device.
- Explicit execution routing: `HybridDeviceExecutionAdapter` implements the
  canonical `ensemblis.automix-execution-adapter.v1` contract, requires both
  cloud and device sources, verifies device sources at the edge and fails
  closed otherwise.
- Hybrid Set Builder planning and render route: admin- and artist-scoped,
  frozen MixPlan v2 manifests are re-verified (fingerprints, canonical URLs,
  provenance, source availability) before every render; a changed catalog
  master forces a replan instead of rendering.
- Traktor adapter: `TraktorNmlSourceAdapter` on the Phase 6 provider-neutral
  source contract (`ensemblis.traktor-nml.v1`), including playlists, play
  history, revision tracking and M3U export for DJ preparation.
- Local hybrid render: the Library Bridge resolves device sources from local
  SQLite, verifies content identity, downloads catalog masters over checked
  HTTPS with fingerprint verification, and renders with the canonical DSP
  renderer inside the sidecar (`ensemblis.library-bridge.render-job.v2`).

## Safety invariants

- One planner: hybrid routing happens at the execution-adapter boundary;
  MixPlan semantics and planner code are unchanged.
- Path is never musical identity; local paths stay in device-local bindings
  and never enter cloud state or MixPlan.
- Local recordings never leave the paired device. Only catalog masters are
  fetched, over HTTPS with SSRF checks and SHA-256 fingerprint verification.
- Unknown contract versions and changed content identity fail closed.
- Vendor evidence enters only as source kinds; planner code never detects
  vendors or reads filesystem paths.

## Exit criteria

- Hybrid plans render end to end with mixed cloud + device sources on a
  production-verified Phase 8 device.
- Contract tests prove versioned fail-closed normalization, single-contract
  execution routing, frozen-plan re-verification and artist/admin scoping
  (`tests/dj-library-phase-9-contract.test.mjs`).
- `dj-set-intelligence-phase-9-status.md` updated to complete with evidence.
