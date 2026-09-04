# Ensemblis UX Polish — Implementation Ledger

Updated: 2026-09-04

This document tracks implementation of `docs/ensemblis-ux-polish.md` and exists to keep UX work coherent while avoiding unnecessary CI and Vercel processing.

## Delivery policy

Until the complete UX-polish plan is ready for final verification:

- do not merge UX work to `main`;
- do not trigger a production Vercel deployment;
- keep iterative work on `ux/music-workbench-polish`, which is not attached to a pull request;
- batch Git ref updates instead of pushing every file mutation;
- run the PR hot-path CI once per meaningful completed batch, not once per tweak;
- add third-party UI dependencies in one lockfile batch near the end;
- merge and deploy only after the final combined verification passes.

Observed repository behavior on 2026-09-04:

- GitHub Actions `CI` runs on `main`/`master`, pull-request events, manual dispatch, and schedule; pushes to the isolated work branch do not run CI.
- The isolated UX branch has generated zero GitHub Actions runs.
- Recent Vercel deployments for the `atlas-irwin` project were `main` production deployments; the isolated UX branch did not generate a preview deployment.

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
- no always-on object-search query in the shell.

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
- upload controls are secondary to understanding existing media.

### 5. Shared object UX — foundation complete

Implemented:

- reusable `ObjectHeader` primitive;
- track object workspace at `/studio/music/[id]`;
- release workspace converted to shared object identity and tabs;
- Atlas-era user-facing copy removed from release and lyrics intelligence surfaces.

Incremental follow-up:

- Campaign detail is already a deep operational workspace and should converge onto the shared object grammar without a risky whole-file rewrite.
- Production already behaves like a contextual content inspector/editor; improve it incrementally rather than replacing it for visual consistency alone.

### 6. Interaction polish — substantially complete

Implemented:

- route-transition loading skeleton;
- reduced-motion handling;
- keyboard command/search palette with focus restoration;
- object search only when requested;
- preview-first `Needs you` approvals;
- exact publication asset/caption shown before external authorization;
- free internal workflow automation stays compact;
- unknown/high-impact automation remains individually protected.

Existing error boundary already follows Ensemblis language and explicit retry behavior, so it was retained.

### 7. Creative UX — semantic timeline implemented, dependency batch pending

Implemented without adding a dependency:

- Track Intelligence now visualizes the real `energy_curve`;
- edit-point boundaries are shown against duration;
- semantic sections are aligned on the same timeline;
- top hook windows are overlaid;
- the audio playhead follows actual playback;
- ranked moments remain directly playable.

This is intentionally not a fake waveform. It uses analysis Ensemblis already computes.

## Remaining dependency-gated work

These should be handled together in one package/lockfile batch so package installation and CI are not repeated unnecessarily.

### WaveSurfer.js

Purpose: add sample-level waveform interaction beneath the semantic Track Intelligence timeline. It should complement, not replace, the existing energy/section/hook layer.

### Uppy + TUS

Purpose: replace the current signed single-shot media upload path for large masters/stems/video with resumable uploads, progress, pause/resume and network recovery.

The current uploader has a 100 MB product limit and uses `uploadToSignedUrl`. Do not implement a custom TUS client merely to avoid a dependency; use the mature client in the final dependency batch.

### dnd-kit

Purpose: only where direct manipulation materially improves a real workflow, primarily storyboard/shot ordering and future timeline ordering. Do not add drag-and-drop to ordinary lists for decoration.

## Verification strategy

Before syncing the finished work back to PR #94:

1. source-level UX contracts must cover every new architectural invariant;
2. review type-sensitive code paths statically;
3. move the isolated branch in one batched ref update;
4. sync the completed batch to the PR once;
5. run the PR hot path once: Studio contracts, TypeScript, ESLint and lightweight validators;
6. fix any failures as one corrective batch;
7. only after all UX work and dependency integrations are complete, merge to `main`;
8. allow the final production Vercel deployment once.

## Definition of done for the whole initiative

The UX-polish initiative is not complete merely because pages look better. It is complete when:

- the main workflows share one Ensemblis hierarchy and interaction language;
- Today is a decision surface, not a dashboard;
- advanced capability is available without being visually mandatory;
- track, release and downstream creative context stay connected;
- approvals show consequence before action;
- long-running work communicates state without blocking navigation;
- artist scope is preserved on every new search/object route;
- uploads are resilient for production-size music/media files;
- the final dependency batch and combined CI pass are green;
- only then is `main` merged and production deployed.
