# DJ & Mixes release validation

This checklist is the merge gate for Set Intelligence, Personal DJ Intelligence and verified transition previews.

## Product invariants

- Ensemblis remains an intelligence/preparation layer, not live deck software.
- Set Intelligence curates candidates before the canonical AutoMix planner; there is no second sequencing or transition engine.
- `journey` preserves every selected track and the supplied order at UI, API, queue and worker boundaries.
- Personal DJ learning can only provide bounded nudges and cannot override direct preferences or audio-safety constraints.
- Transition previews execute the verified parent MixPlan transition through the canonical renderer/DSP and never replan it.

## Data and security invariants

- All DJ profile, evidence, AutoMix and transition-preview rows are artist scoped and protected by RLS.
- Worker callback tokens and signed upload credentials are never returned by artist-facing APIs.
- Completed preview audio lives in the private `automix-previews` bucket and is exposed only through short-lived signed playback URLs.
- Canonical master lineage is checked before full-mix catalog registration and before accepting transition preview completion.
- Stale or poisoned durable queue rows become terminal instead of blocking later work.
- Only the callback that wins a terminal state transition owns shared Sandbox cleanup.

## Automated merge gate

A release is ready to merge only when the pull request is green for:

- Studio contract tests;
- TypeScript typecheck;
- ESLint;
- browser smoke tests;
- deep Audio Intelligence / AutoMix regression;
- clean Supabase migration replay, database lint and pgTAP behavior tests.

The main-branch CI then repeats the deeper build, Python validation and database suite after merge.
