# Ensemblis / Atlas Irwin Architecture Context

This file is the short map for humans and coding agents. It names the canonical boundaries and invariants; deeper product and domain detail stays in `docs/`.

## Core model

Ensemblis is an artist operating system built on Next.js, Supabase and a Python media worker. The central tenancy rule is:

```text
user identity != workspace != artist
```

- `profiles` identify people/accounts.
- `workspaces` are administrative/team boundaries.
- `artists` are the canonical creative/product scope.
- Releases, tracks, creative intelligence, campaigns and durable automation should resolve explicit artist context rather than infer tenancy from the current user alone.

Canonical resolver: `lib/studio/artist-context.ts`.

## Architectural direction

Prefer **deep modules with small interfaces** over route/action files that orchestrate many tables and domains directly.

```text
Route / Server Action
        |
        v
small application boundary
        |
        v
read model / command policy
        |
        v
domain + persistence + integrations
```

A route should mainly resolve request/auth context and render a prepared model. A server action should mainly validate input, acquire an authorized command session, invoke domain policy, persist and revalidate.

Do not introduce repository interfaces, factories or service abstractions merely to hide Supabase when there is only one real implementation. Add an abstraction when it owns meaningful policy or crosses a real runtime/provider seam.

## Canonical boundaries

### Artist context

`lib/studio/artist-context.ts`

Owns user -> workspace -> artist resolution, active membership validation and fail-closed ambiguity handling. Product code must not independently rediscover artist ownership.

### Release workspace read model

`lib/studio/release-workspace.ts`

Owns the cross-domain read model for `/studio/releases/[id]`.

Failure policy:

- canonical release data: required;
- downstream provider scheduling state: fail closed;
- campaign, Music Intelligence, Moments and lyrics enrichment: degrade when safe rather than making the release disappear.

The route in `app/studio/(protected)/releases/[id]/page.tsx` should stay thin.

### Video Director workspace read model

`lib/video-director/workspace.ts`

Owns the UI snapshot for `/studio/video/[id]`: editor entities, lyrics cues, stems/audio scenes, creative memory, media graph, production previews and provider readiness.

It builds on the canonical project context in `lib/video-director/context.ts`; do not recreate release/track/project ownership queries in the page.

### Video Editor command boundary

- `lib/video-director/editor-session.ts`: authorized command session and source-asset scope.
- `lib/video-director/editor-policy.ts`: editor mutation rules that should remain independent from Next.js request mechanics.
- `app/studio/video-editor-*.ts`: thin server-action adapters plus persistence/revalidation.

Generation invalidation, character continuity, lip-sync requirements, trim/source-offset behavior and human quality attestation belong in domain policy rather than React components.

### Media Worker runtime boundary

The media worker is a real cross-runtime seam:

```text
TypeScript producer -> durable job -> Python worker -> callback -> TypeScript reconciliation
```

Canonical protocol:

- `contracts/media-worker.v1.json`
- `lib/media-worker/contract.ts`
- `services/media-worker/app/runner.py`

Every dispatched payload carries `__ensemblis_media_worker_contract_version`. Unknown versions fail before worker execution. Job discriminator parity is regression-tested.

### Media lineage

`media_assets` is the stored asset. `media_links` is each explicit use of that asset. Generated outputs remain normal assets with provenance and must not silently replace approved public roles.

See `docs/catalog-architecture.md`.

### Design system

`app/studio/design-system/` is the canonical Ensemblis visual/interaction system. Base UI-backed controls in `components/studio/form-controls.tsx` own behavior-heavy select/switch/tooltip interaction. Do not recreate those primitives per feature.

## Where code belongs

| Concern | Home |
| --- | --- |
| Next.js routing/request parsing | `app/` |
| Reusable React UI | `components/` |
| Studio cross-domain read models | `lib/studio/` |
| Video Director domain/workflows | `lib/video-director/` |
| Auth / artist authorization | `lib/auth/`, `lib/studio/artist-context.ts` |
| Media worker dispatch/runtime contract | `lib/media-worker/`, `contracts/`, `services/media-worker/` |
| Durable DB schema/RLS | `supabase/migrations/` |
| DB domain types | `types/` |
| Behavioral and architecture contracts | `tests/` |

## Testing guidance

Prefer testing behavior or the owning module boundary. Source-contract tests are acceptable for architecture and cross-language parity, but avoid asserting that route files contain low-level query syntax. A refactor should be able to change implementation inside a deep module without forcing unrelated route tests to change.

PR verification is defined by `.github/workflows/ci.yml`: Studio contract tests, strict TypeScript checking, lint and browser smoke on pull requests, with deeper Python/database/build validation on main or manual/deep runs.

## Architecture decisions

See `docs/adr/README.md` for decisions that explain why the current boundaries exist.

## Deeper documentation

- Multi-artist tenancy: `docs/ensemblis-multi-artist-architecture.md`
- Catalog/media lineage: `docs/catalog-architecture.md`
- Product roadmap: `docs/ensemblis-product-roadmap.md`
- Design system: `docs/ensemblis-design-system.md`
- Audio intelligence: `docs/audio-intelligence-v4.md`
- AI control plane: `docs/ai-control-plane.md`
