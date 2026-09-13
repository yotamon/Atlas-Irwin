# Ensemblis / Atlas Irwin agent guidance

This file is a compact router for coding agents. The architecture map and canonical invariants live in [`CONTEXT.md`](CONTEXT.md); deeper product/domain detail lives under `docs/`.

Do **not** preload the whole documentation tree before every change. Inspect the affected code, preserve the invariants below, and read only the context relevant to the task.

## Core invariants

- Tenancy is explicit: `user identity != workspace != artist`. Product data and durable automation resolve artist context through the canonical boundary rather than inferring ownership from the current user alone.
- Prefer deep modules with small interfaces. Routes and server actions should stay thin and should not become cross-domain orchestration layers.
- Do not add repository interfaces, factories, or provider wrappers merely to hide a single implementation. Add a seam when it owns real policy or crosses a meaningful runtime/provider/failure boundary.
- The TypeScript producer -> durable job -> Python media worker -> callback -> TypeScript reconciliation path is a real cross-runtime contract. Preserve versioning and discriminator parity.
- `media_assets` represent stored assets; `media_links` represent explicit uses. Generated outputs retain provenance and must not silently replace approved public roles.
- Reuse the canonical Ensemblis design-system controls instead of recreating behavior-heavy primitives per feature.
- Atlas Irwin public-site concerns and Ensemblis product concerns currently share this repository, but do not blur their product/domain boundaries in anticipation of a future split.

## Context router

Start with `CONTEXT.md` when a task touches architecture, tenancy, domain ownership, or an unfamiliar subsystem. Then use only the relevant deeper docs it links to.

Common routes:

- Multi-artist tenancy -> `docs/ensemblis-multi-artist-architecture.md`
- Catalog / media lineage -> `docs/catalog-architecture.md`
- Product roadmap -> `docs/ensemblis-product-roadmap.md`
- Design system -> `docs/ensemblis-design-system.md`
- Audio intelligence -> `docs/audio-intelligence-v4.md`
- AI control plane -> `docs/ai-control-plane.md`
- Marketing site -> `docs/marketing/README.md` and the specific marketing artifact needed
- Durable architecture decisions -> `docs/adr/README.md` and the relevant ADR

Do not read unrelated documents merely because they exist.

## Working style

Understand the affected flow before editing, follow nearby references, and reuse established patterns. Proceed autonomously with normal local development work: inspect/edit files, run relevant tests, lint, type checks, builds, and safe local tooling.

Stop only when the next step requires a destructive or irreversible action, production data/infrastructure changes, credentials/billing, an unintended external side effect, or a genuine product decision with materially different outcomes.

## Validation and completion

For implementation tasks, continue through implementation, relevant validation, inspection of failures, fixing regressions caused by the change, and rerunning affected checks. Do not stop after the first plausible implementation merely to request review.

Use the smallest relevant validation set that gives confidence. CI truth is defined by `.github/workflows/ci.yml`; deeper validation is warranted when the affected boundary requires it, not for every trivial edit.

A task is complete when the requested behavior is implemented, the affected flow is validated, regressions introduced by the change are fixed, and canonical docs are updated when behavior, architecture, terminology, or durable decisions changed.
