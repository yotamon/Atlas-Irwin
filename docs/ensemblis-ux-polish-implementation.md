# Ensemblis UX Polish — Implementation Ledger

Updated: 2026-09-04

This document tracks implementation of `docs/ensemblis-ux-polish.md` and exists to keep UX work coherent while avoiding unnecessary CI and Vercel processing.

## Delivery policy

Until the complete UX-polish plan is ready for final verification:

- do not merge UX work to `main`;
- do not trigger a production Vercel deployment;
- keep PR #94 in draft while the final source hardening pass is active;
- run the PR hot-path CI once for the completed batch, not once per visual tweak;
- prefer existing platform/browser capabilities over new UI dependencies when they meet the production requirement cleanly;
- merge and deploy only after the final combined verification passes.

Observed repository behavior on 2026-09-04:

- GitHub Actions `CI` runs on `main`/`master`, pull-request events, manual dispatch, and schedule.
- Connector-originated branch updates and PR state transitions did not emit new Actions runs during the polish pass, so no extra CI minutes were consumed by iterative work.
- Recent Vercel deployments for the `atlas-irwin` project are `main` production deployments; the UX branch does not generate preview deployments.

## Milestone status

### 1. Foundation — complete

- documented UX north star and rules;
- grouped Work / Manage information architecture;
- `Growth` is presented as `Grow` without route churn;
- Ensemblis polish styles load as additive, reversible layers;
- existing route and artist-scope contracts remain intact.

### 2. Global shell — complete for this pass

- persistent active-artist context bar;
- global `Needs you` and `Create` actions;
- `⌘K` / `Ctrl+K` command palette;
- on-demand artist-scoped search across tracks, releases, campaigns and content;
- arrow-key, Home/End and focus-trapped keyboard interaction;
- race-safe object search with request cancellation and explicit search feedback;
- no always-on object-search query in the shell;
- compact navigation retains accessible names and coarse-pointer touch targets.

### 3. Today v3 — complete for this pass

Today is intentionally limited to:

1. Next best action
2. Needs you
3. Working
4. Coming up

Dashboard-only server queries were removed from Today and remain available in their owning workspaces.

### 4. Core workflow polish — complete for this pass

#### Music

- defaults to source material and track decisions instead of AI generation;
- AI music generation is an explicit `view=generate` mode;
- unreleased portfolio and release catalog are visible in one calm workspace;
- tracks open into a dedicated object workspace.

#### Releases

- catalog grouped by Upcoming / Live / Catalog / Archived;
- filters are progressively disclosed;
- visual and dense views remain available;
- release detail uses the shared object identity grammar.

#### Create

Outcome-first choices:

- create a track;
- start a release;
- make campaign content;
- direct a video.

Specialist/legacy tools remain behind disclosure.

#### Grow

- default overview is separated from Opportunities, Performance and Portfolio maintenance;
- the detailed Vault editor remains available without dominating the default surface.

#### Audience

- human-judgment queue instead of a generic inbox;
- Ensemblis drafts but never auto-sends replies;
- unsafe/ambiguous messages remain explicitly undrafted.

#### Library

- visual, reuse-first asset memory;
- in-use and reusable material are distinguished;
- upload controls are secondary to understanding existing media;
- files above 6 MB use resumable signed TUS chunks with progress and automatic network retry;
- the existing 100 MB public-media product ceiling remains unchanged.

### 5. Shared object UX — complete for this pass

Implemented:

- reusable `ObjectHeader` primitive;
- track object workspace at `/studio/music/[id]`;
- release workspace converted to shared object identity and tabs;
- Campaign chrome converged onto the Ensemblis visual hierarchy without rewriting its operational engine;
- Production now emphasizes the selected creative while keeping queue/provider/advanced controls secondary;
- Atlas-era user-facing copy removed from release and lyrics intelligence surfaces.

Campaign and Production deliberately remain incremental integrations rather than high-risk whole-feature rewrites.

### 6. Interaction polish — substantially complete

Implemented:

- route-transition loading skeleton;
- reduced-motion handling;
- keyboard command/search palette with focus restoration and modal focus containment;
- object search only when requested;
- preview-first `Needs you` approvals;
- exact publication asset/caption shown before external authorization;
- free internal workflow automation stays compact;
- unknown/high-impact automation remains individually protected;
- responsive compact navigation keeps explicit accessible labels;
- resumable upload state is visible through progress, retry and authorization-expiry language.

Existing error boundaries already follow Ensemblis language and explicit retry behavior, so they were retained.

### 7. Creative UX — complete for this pass

Track Intelligence now combines two complementary layers:

1. a real decoded-audio waveform sampled from the attached master;
2. Ensemblis semantic intelligence: energy, sections, edit points, hooks and playback position.

The waveform:

- is generated with native Web Audio and adds no runtime dependency;
- shares the same canonical `<audio>` playback element as section/hook previews;
- supports pointer drag-to-seek;
- supports keyboard seeking with Left/Right, Home and End;
- degrades to normal audio playback if waveform decoding is unavailable.

The semantic timeline continues to show:

- the real `energy_curve`;
- edit-point boundaries against duration;
- semantic sections;
- top hook windows;
- actual playback position;
- directly playable ranked moments.

### 8. Resilient media transport — complete for this pass

Large uploads use a focused native TUS transport rather than a general-purpose upload UI dependency.

Security and durability properties:

- the server still creates the authorized `userId/library/...` object target;
- the same server-issued signed upload token is sent as the TUS `x-signature`;
- chunks are 6 MB to match the Supabase resumable-upload requirement;
- the current server offset is recovered with `HEAD` before resuming;
- confirmed progress is stored only as the resumable upload URL in `sessionStorage`, scoped to the exact target and file identity;
- interrupted chunks retry with bounded backoff;
- expired partial upload URLs restart safely from byte zero on the same signed target;
- expired authorization discards the stale target and asks the next retry to create a fresh signed target;
- small uploads keep the existing `uploadToSignedUrl` path;
- the 100 MB storage/product ceiling is unchanged.

This keeps Ensemblis's custom uploader UX and security boundary without introducing Uppy or `tus-js-client`.

## Dependency policy

The completed UX pass adds **zero runtime or development dependencies**.

Waveform interaction is implemented with Web Audio and resilient upload transport with the TUS protocol over native `fetch`. This avoids a package-lock migration, reduces bundle surface, and keeps the feature set tailored to Ensemblis rather than adopting general-purpose UI/runtime libraries.

`dnd-kit` remains intentionally unadded. Direct manipulation should only be introduced later where it materially improves a real ordering workflow, such as storyboard/shot ordering, not ordinary lists.

## Verification strategy

Before PR #94 leaves draft:

1. source-level UX contracts cover every new architectural invariant;
2. review type-sensitive code paths statically;
3. verify the PR contains no temporary resolver workflows or dependency drift;
4. update this ledger and the PR description to the final implementation;
5. run the PR hot path once: Studio contracts, TypeScript, ESLint and lightweight validators;
6. fix any failures as one corrective batch;
7. only after the completed UX batch is green, merge to `main`;
8. allow the resulting production Vercel deployment once.

Because this environment does not receive an executable checkout and connector-originated GitHub events are Actions-suppressed, the final executable validation remains the one intentional PR CI event rather than being simulated by hand.

## Definition of done for the whole initiative

The UX-polish initiative is not complete merely because pages look better. It is complete when:

- the main workflows share one Ensemblis hierarchy and interaction language;
- Today is a decision surface, not a dashboard;
- advanced capability is available without being visually mandatory;
- track, release and downstream creative context stay connected;
- approvals show consequence before action;
- long-running work communicates state without blocking navigation;
- artist scope is preserved on every new search/object route;
- uploads are resilient for production-size music/media files within the current product ceiling;
- the final combined PR CI pass is green;
- only then is `main` merged and production deployed.
