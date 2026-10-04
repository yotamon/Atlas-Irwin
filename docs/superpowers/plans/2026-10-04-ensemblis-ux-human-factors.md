# Ensemblis UX Human-Factors Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing Ensemblis UX V5 architecture perceptually simple in real use by reducing visible choice, staging multi-step work, and enforcing one obvious next action across the core artist journeys.

**Architecture:** Preserve the V5 Today / Music / Grow shell, intent launcher, object model, safety boundaries, and specialist routes. Reuse and tighten the existing `PriorityHero`, `ObjectActionBar`, `ObjectStateSummary`, `NextActionWidget`, `CompactEvidence`, `WorkflowStepper`, and `ContextInspector` primitives; add only the minimum shared contracts needed to make action hierarchy and staged workflows consistent. Migrate journey-by-journey, with semantic source tests plus authenticated browser acceptance rather than a second design system.

**Tech Stack:** Next.js 16, React 19, TypeScript, Base UI, existing Studio CSS design system, Node test runner, Playwright, axe-core.

**Spec:** `docs/superpowers/specs/2026-10-04-ensemblis-ux-human-factors-design.md`

## Global Constraints

- Preserve the UX V5 intent → object → state → recommended action → outcome mental model.
- Preserve Today / Music / Grow as the only primary workspaces; Create remains a global/contextual action.
- Normal task surfaces expose 1 dominant primary action, at most 2 visible secondary actions, and one intentional route to advanced/specialist actions.
- Normal task surfaces should normally contain no more than 4 major visible sections.
- Object identity, state, recommended next action, and short rationale must be available before the user needs to scroll at common laptop width.
- Default artist-facing status vocabulary remains small: Ready, Working, Needs review, Blocked, Complete.
- Technical evidence remains available but cannot define the default path.
- Do not remove expert capabilities or weaken mastering, distribution, rights, autonomy, spend, publishing, or destructive-action gates.
- Do not add a second navigation model, chat-first shell, or backend shadow state.
- Do not add an authentication bypass for visual or browser testing.
- UX telemetry must not persist raw private creative text when normalized categories suffice.
- Mobile must preserve the same mental model and keep the primary action reachable without hover or desktop-only affordances.

## Review Focus

- **Ambiguous state:** a Track/Release with multiple valid next moves must still expose exactly one ranked recommendation; test in Task 2/4.
- **Blocking source defects:** mastering must stop at a clear repair decision and must never imply mastering can repair clipping/source corruption; test in Task 3.
- **In-progress/resumable work:** Continue must win over New/Start where a real workflow exists; test in Tasks 5 and 7.
- **No recommendation available:** Today/Grow/Track must render a calm state rather than a fake primary action; test in Tasks 2, 6, and 7.
- **Narrow mobile:** primary action, stage progress, and advanced disclosure must remain reachable and keyboard/touch accessible; test in Task 8.

---

### Task 1: Establish the human-factors acceptance contract and authenticated baseline audit

**Files:**
- Create: `tests/ensemblis-ux-human-factors.test.mjs`
- Create: `docs/ensemblis-ux-human-factors-audit.md`
- Modify: `e2e/ensemblis-ux-v5.spec.mjs`
- Modify: `docs/superpowers/specs/2026-10-04-ensemblis-ux-human-factors-design.md` only if the live audit exposes a contradiction that must be resolved before implementation

**Interfaces:**
- Consumes: existing V5 canonical journeys and authenticated Studio E2E login contract.
- Produces: semantic UX assertions and a screenshot-backed baseline audit for the ten canonical journeys.

- [ ] **Step 1: Write failing semantic contract tests**

Add tests that assert the implementation has a single shared action-hierarchy primitive, core default surfaces expose an explicit ranked recommendation/state contract, advanced detail is routed through `ContextInspector` / `CompactEvidence`, and specialist routes remain outside primary navigation.

Do not assert raw counts of arbitrary DOM elements. Assert named component contracts and default/advanced ownership.

- [ ] **Step 2: Run the focused contract and verify it fails**

Run:

```bash
node --test tests/ensemblis-ux-human-factors.test.mjs
```

Expected: FAIL because the new shared human-factors contracts do not exist yet.

- [ ] **Step 3: Extend authenticated Playwright acceptance with audit checkpoints**

In `e2e/ensemblis-ux-v5.spec.mjs`, add named checkpoints for:

- visible state;
- visible primary next action;
- no specialist controls in the default viewport;
- mobile primary action reachability;
- screenshot capture for Track, Mastering, Grow, Release, AutoMix, Music, Today and Create.

Use the existing legitimate `STUDIO_E2E_EMAIL` / `STUDIO_E2E_PASSWORD` flow. Fail closed if credentials are unavailable.

- [ ] **Step 4: Run the authenticated baseline audit**

Run:

```bash
npm run test:e2e:studio
```

Expected: either PASS with real authenticated screenshots or an explicit credential/environment failure. Never convert missing auth into a skip or bypass.

- [ ] **Step 5: Record evidence in the audit document**

For each canonical journey record:

- visible primary action;
- competing choices;
- scroll required before next action is understood;
- terminology friction;
- backtracking/context loss;
- default vs advanced detail;
- desktop/mobile differences;
- screenshot reference.

Rank findings P0/P1/P2 and use them to confirm the implementation order below.

- [ ] **Step 6: Commit**

```bash
git add tests/ensemblis-ux-human-factors.test.mjs e2e/ensemblis-ux-v5.spec.mjs docs/ensemblis-ux-human-factors-audit.md
git commit -m "test: establish Ensemblis human-factors baseline"
```

---

### Task 2: Tighten shared action hierarchy and simplify the Track default surface

**Files:**
- Modify: `components/studio/ux-v4-widgets.tsx`
- Modify: `components/studio/patterns.tsx`
- Modify: `app/studio/(protected)/music/[id]/page.tsx`
- Modify: `components/studio/object-header.tsx`
- Modify: `app/studio/design-system/patterns.css`
- Modify: `app/studio/design-system/workflows.css`
- Modify: `app/studio/design-system/ux-hardening.css`
- Test: `tests/ensemblis-ux-human-factors.test.mjs`
- Test: `tests/ensemblis-ux-v5-contract.test.mjs`
- Test: `tests/track-analysis-design-contract.test.mjs`
- Test: `tests/ensemblis-ux-polish-contract.test.mjs`

**Interfaces:**
- Consumes: `ObjectActionBar`, `ObjectStateSummary`, `NextActionWidget`, `ContextInspector`.
- Produces: `ObjectActionBar` contract that accepts one explicit primary action and at most two visible secondary actions, with remaining actions supplied through `more`.

- [ ] **Step 1: Add failing Track/action hierarchy assertions**

Assert that the Track default composition is ordered as:

`ObjectHeader → current state → ranked next action → compact object actions → concise music summary → contextual release relationship`.

Assert detailed mastering/stems/lyrics/engineering content is owned by explicit inspectors/disclosures and is not a peer default section.

Assert the action bar fails its own development contract when callers attempt multiple primary actions.

- [ ] **Step 2: Run focused tests and verify failure**

```bash
node --test tests/ensemblis-ux-human-factors.test.mjs tests/ensemblis-ux-v5-contract.test.mjs tests/track-analysis-design-contract.test.mjs
```

Expected: FAIL on the new hierarchy assertions.

- [ ] **Step 3: Harden `ObjectActionBar`**

Keep the public type small:

```ts
export type ObjectAction = {
  label: string;
  href: string;
  primary?: boolean;
};
```

Normalize rendering so exactly one item may be visually primary. Keep at most two non-primary actions in the visible group; caller-owned specialist actions move to `more`.

Do not silently hide safety-critical choices.

- [ ] **Step 4: Recompose the Track page**

Make the default Track path operational:

1. identity/player;
2. one current state;
3. one ranked recommendation;
4. compact Create / Master / Mix row only when relevant;
5. concise “What Ensemblis hears” summary;
6. active release relationship only when relevant;
7. one Technical details entry point.

Move deep analysis, stems, lyrics, mastering engineering evidence, provenance/provider/model data and historical diagnostics out of the normal scroll.

Keep analysis recovery visible only when recovery is actually needed.

- [ ] **Step 5: Tighten Track visual hierarchy**

Use existing design-system tokens. Reduce competing borders/status pills and give the ranked next action more weight than evidence or secondary capability.

Do not create a new standalone stylesheet unless the existing design-system files cannot express the contract cleanly.

- [ ] **Step 6: Run focused tests**

```bash
node --test tests/ensemblis-ux-human-factors.test.mjs tests/ensemblis-ux-v5-contract.test.mjs tests/track-analysis-design-contract.test.mjs tests/ensemblis-ux-polish-contract.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add components/studio/ux-v4-widgets.tsx components/studio/patterns.tsx components/studio/object-header.tsx app/studio/'(protected)'/music/'[id]'/page.tsx app/studio/design-system/patterns.css app/studio/design-system/workflows.css app/studio/design-system/ux-hardening.css tests
git commit -m "feat: simplify Track decision surface"
```

---

### Task 3: Turn Mastering into a staged artist workflow

**Files:**
- Modify: `components/studio/active-mastering-panel.tsx`
- Modify: `components/studio/active-mastering-controls.tsx`
- Modify: `components/studio/master-readiness-card.tsx`
- Modify: `components/studio/mastering-listen-lab.tsx`
- Modify: `components/studio/mastering-inspector-panel.tsx`
- Modify: `components/studio/mastering-technical-report.tsx`
- Modify: `app/studio/design-system/workflows.css`
- Test: `tests/master-readiness-experience.test.mjs`
- Test: `tests/mastering-v2.test.mjs`
- Test: `tests/ensemblis-ux-human-factors.test.mjs`

**Interfaces:**
- Consumes: existing readiness derivation, Active Mastering state, `WorkflowStepper`, `ContextInspector`.
- Produces: one visible mastering stage at a time: source check → recommendation → processing → A/B review → decision → result.

- [ ] **Step 1: Write failing workflow-state tests**

Assert that:

- blocking source defects stop at source repair;
- ready source enters recommendation;
- running jobs render a focused processing state;
- completed candidates enter A/B review before approval;
- engineering criteria remain behind explicit technical detail;
- Keep original / Approve / Revise are shown only in the review decision stage.

- [ ] **Step 2: Run focused tests and verify failure**

```bash
node --test tests/master-readiness-experience.test.mjs tests/mastering-v2.test.mjs tests/ensemblis-ux-human-factors.test.mjs
```

- [ ] **Step 3: Introduce one canonical mastering stage resolver**

Keep it UI-local and derived from canonical mastering/readiness state; do not persist a new workflow state.

Signature:

```ts
type MasteringStage = "source" | "recommendation" | "processing" | "review" | "result";
```

The resolver must not override domain safety results.

- [ ] **Step 4: Recompose the mastering panel around the current stage**

Show one primary task per stage. Keep source identity visible. Keep background processing resumable. Put references, engineering evidence, processor telemetry and detailed QA inside explicit inspectors.

- [ ] **Step 5: Preserve source-defect truthfulness**

Keep the existing rule that digital clipping/source repair blockers cannot be presented as fixable by mastering. Preserve streaming-safe source-preserving behavior.

- [ ] **Step 6: Run focused tests**

Same command as Step 2. Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add components/studio/active-mastering-* components/studio/master-readiness-card.tsx components/studio/mastering-* app/studio/design-system/workflows.css tests
git commit -m "feat: stage the mastering experience"
```

---

### Task 4: Collapse Grow into recommendation → reason → action

**Files:**
- Modify: `app/studio/(protected)/growth/page.tsx`
- Modify: `app/studio/(protected)/growth/strategy/page.tsx`
- Modify: `app/studio/(protected)/growth/paid/page.tsx`
- Modify: `components/studio/patterns.tsx`
- Modify: `app/studio/design-system/patterns.css`
- Modify: `app/studio/design-system/ux-hardening.css`
- Test: `tests/ensemblis-ux-v5-contract.test.mjs`
- Test: `tests/paid-growth-contract.test.mjs`
- Test: `tests/ensemblis-ux-human-factors.test.mjs`

**Interfaces:**
- Consumes: existing strategy recommendation, opportunities, active work, audience/performance data.
- Produces: one default Grow recommendation surface with supporting evidence and specialist views secondary.

- [ ] **Step 1: Add failing Grow contract assertions**

Assert default Grow has:

1. one recommendation;
2. short “why”;
3. one primary action;
4. current work already moving;
5. compact outcome context.

Assert strategy settings, release ordering, raw audience/performance inventory, and paid-test machinery are not peer sections on the default screen.

- [ ] **Step 2: Run focused tests and verify failure**

```bash
node --test tests/ensemblis-ux-v5-contract.test.mjs tests/paid-growth-contract.test.mjs tests/ensemblis-ux-human-factors.test.mjs
```

- [ ] **Step 3: Recompose `growth/page.tsx`**

Keep the top recommendation authoritative. Move detailed audience/performance evidence behind contextual detail or focused secondary routes. Keep “work already moving” visible only when it helps the user understand progress.

When no recommendation is available, render a calm state instead of a generic CTA.

- [ ] **Step 4: Make secondary Growth routes intentional**

`/growth/strategy` and `/growth/paid` remain reachable from relevant context but must not read as required navigation for understanding the default recommendation.

- [ ] **Step 5: Run focused tests**

Same command as Step 2. Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/studio/'(protected)'/growth components/studio/patterns.tsx app/studio/design-system tests
git commit -m "feat: make Grow recommendation-first"
```

---

### Task 5: Make Release a lifecycle-guided object instead of a capability workspace

**Files:**
- Modify: `components/studio/release-workspace-v2.tsx`
- Modify: `components/studio/release-tracklist.tsx`
- Modify: `components/studio/release-mastering-panel.tsx`
- Modify: `components/studio/release-mastering-coherence.tsx`
- Modify: `app/studio/(protected)/releases/[id]/page.tsx`
- Modify: `app/studio/design-system/release-workspace-hardening.css`
- Modify: `app/studio/design-system/workflows.css`
- Test: `tests/ensemblis-ux-v5-contract.test.mjs`
- Test: `tests/release-detail-resilience.test.mjs`
- Test: `tests/ensemblis-ux-human-factors.test.mjs`

**Interfaces:**
- Consumes: canonical release snapshot, mission, tracks, content, campaign, distribution and result data.
- Produces: persistent release identity/state/next action plus single-job facets.

- [ ] **Step 1: Write failing release composition tests**

Assert Overview exposes:

1. lifecycle state;
2. one next release step;
3. blockers;
4. compact track/master readiness;
5. compact lifecycle progress.

Assert Creative, Promotion, Distribution and Results each render one coherent job and do not duplicate Overview machinery.

- [ ] **Step 2: Run focused tests and verify failure**

```bash
node --test tests/ensemblis-ux-v5-contract.test.mjs tests/release-detail-resilience.test.mjs tests/ensemblis-ux-human-factors.test.mjs
```

- [ ] **Step 3: Recompose `ReleaseWorkspaceV2`**

Keep the release header/lifecycle context persistent. Replace the current multi-module default composition with the Overview contract. Move mastering coherence, creative inventories, provider metadata and historical/result detail into the facet that owns the job or an advanced inspector.

- [ ] **Step 4: Preserve resilience boundaries**

Do not make optional enrichment failures block canonical release access. Keep the current safe behavior in `lib/studio/release-workspace.ts` unchanged unless tests prove a UI contract requires a loader adjustment.

- [ ] **Step 5: Run focused tests**

Same command as Step 2. Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add components/studio/release-* app/studio/'(protected)'/releases/'[id]' app/studio/design-system tests
git commit -m "feat: simplify release lifecycle UX"
```

---

### Task 6: Make AutoMix a single staged creation flow

**Files:**
- Modify: `components/studio/automix-workflow.tsx`
- Modify: `components/studio/set-builder-workspace.tsx`
- Modify: `components/studio/local-set-builder-workspace.tsx`
- Modify: `components/studio/automix-render-recovery.tsx`
- Modify: `app/studio/design-system/workflows.css`
- Test: `tests/automix-design-contract.test.mjs`
- Test: `tests/automix-durable-recovery.test.mjs`
- Test: `tests/ensemblis-ux-human-factors.test.mjs`

**Interfaces:**
- Consumes: existing Music → Intent → Build → Review → Render state and `WorkflowStepper`.
- Produces: exactly one active stage body plus one advanced DJ tools disclosure.

- [ ] **Step 1: Add failing AutoMix visibility assertions**

Assert only the active stage is presented as the task body; completed/future stages are represented by the stepper, not simultaneous full panels.

Assert resume state routes to the saved stage and failed render routes to recovery without losing mix context.

- [ ] **Step 2: Run focused tests and verify failure**

```bash
node --test tests/automix-design-contract.test.mjs tests/automix-durable-recovery.test.mjs tests/ensemblis-ux-human-factors.test.mjs
```

- [ ] **Step 3: Recompose local and catalog builders**

Keep the shared stage IDs `music | intent | build | review | render`. Render one stage body. Keep source/mix identity visible. Preserve existing job state and callbacks; do not create a new persisted stage model.

- [ ] **Step 4: Consolidate advanced DJ tools**

Keep DJ intelligence, Rekordbox/library bridge and specialist controls inside one intentional advanced disclosure; do not duplicate them inside normal stages.

- [ ] **Step 5: Run focused tests**

Same command as Step 2. Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add components/studio/automix-* components/studio/set-builder-workspace.tsx components/studio/local-set-builder-workspace.tsx app/studio/design-system/workflows.css tests
git commit -m "feat: focus AutoMix stage by stage"
```

---

### Task 7: Compress Music, Today and Create around continuation and the next useful action

**Files:**
- Modify: `app/studio/(protected)/music/page.tsx`
- Modify: `components/studio/music-workspace-overview.tsx`
- Modify: `app/studio/(protected)/page.tsx`
- Modify: `app/studio/(protected)/create/page.tsx`
- Modify: `app/studio/design-system/today-focus.css`
- Modify: `app/studio/design-system/patterns.css`
- Modify: `app/studio/design-system/ux-hardening.css`
- Test: `tests/ensemblis-ux-v5-contract.test.mjs`
- Test: `tests/outcome-first-create.test.mjs`
- Test: `tests/ensemblis-ux-human-factors.test.mjs`

**Interfaces:**
- Consumes: operating snapshot, Music object collections, Create directions.
- Produces: calmer default entry surfaces that prefer continuation over capability discovery.

- [ ] **Step 1: Add failing entry-surface tests**

Assert:

- Today ranks Continue vs Priority rather than presenting them as equal when both exist;
- Music Add is a focused choice surface without repeated product-philosophy copy;
- Create visually identifies one best recommendation while keeping alternatives secondary;
- all three render calm completion states when no action is needed.

- [ ] **Step 2: Run focused tests and verify failure**

```bash
node --test tests/ensemblis-ux-v5-contract.test.mjs tests/outcome-first-create.test.mjs tests/ensemblis-ux-human-factors.test.mjs
```

- [ ] **Step 3: Rank Today**

Derive one top-of-page task from existing `topDecision`, resumable work and mission state. Keep the other category secondary/collapsed rather than two equal hero blocks.

Do not alter underlying operating-snapshot prioritization unless a real ranking conflict is proven.

- [ ] **Step 4: Tighten Music Add**

Keep Existing music / Release / optional AI generation choices, but reduce explanatory prose to the consequence of each choice. Move policy explanation behind a concise contextual note/details entry.

- [ ] **Step 5: Tighten Create**

Keep the outcome-first model and three bounded directions, but make rank 1 the obvious default. Alternative cards should read as alternatives, not equal recommendations.

- [ ] **Step 6: Run focused tests**

Same command as Step 2. Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add app/studio/'(protected)'/page.tsx app/studio/'(protected)'/music app/studio/'(protected)'/create components/studio/music-workspace-overview.tsx app/studio/design-system tests
git commit -m "feat: compress Studio entry surfaces"
```

---

### Task 8: Mobile, accessibility and visual-hierarchy consolidation

**Files:**
- Modify: `components/studio/mobile-navigation.tsx`
- Modify: `components/studio/context-inspector.tsx`
- Modify: `components/studio/dialog.tsx` only if the existing dialog contract cannot satisfy full-height mobile inspectors
- Modify: `app/studio/design-system/accessibility.css`
- Modify: `app/studio/design-system/overlays.css`
- Modify: `app/studio/design-system/workflows.css`
- Modify: `app/studio/design-system/ux-hardening.css`
- Test: `tests/ensemblis-ux-polish-contract.test.mjs`
- Test: `tests/studio-ui-system.test.mjs`
- Test: `tests/ensemblis-ux-human-factors.test.mjs`
- Test: `e2e/ensemblis-ux-v5.spec.mjs`

**Interfaces:**
- Consumes: all migrated journey components.
- Produces: same mental model at narrow viewport, accessible advanced sheets, reachable primary actions.

- [ ] **Step 1: Add failing mobile/accessibility assertions**

Cover:

- coarse-pointer target size;
- primary action reachability;
- inspector full-height mobile treatment;
- focus trap/return;
- reduced motion;
- no color-only state;
- real tabs vs disclosure semantics.

- [ ] **Step 2: Run focused tests and verify failure**

```bash
node --test tests/ensemblis-ux-polish-contract.test.mjs tests/studio-ui-system.test.mjs tests/ensemblis-ux-human-factors.test.mjs
```

- [ ] **Step 3: Consolidate responsive hierarchy**

Avoid simply stacking every desktop block. On mobile:

- keep state + recommendation first;
- make primary actions sticky/easily reachable where the workflow benefits;
- use full-height sheets for contextual inspectors;
- collapse secondary evidence;
- keep stage progress compact and operable.

- [ ] **Step 4: Run focused tests and authenticated mobile E2E**

```bash
node --test tests/ensemblis-ux-polish-contract.test.mjs tests/studio-ui-system.test.mjs tests/ensemblis-ux-human-factors.test.mjs
npm run test:e2e:studio
```

Expected: PASS with legitimate auth.

- [ ] **Step 5: Commit**

```bash
git add components/studio/mobile-navigation.tsx components/studio/context-inspector.tsx components/studio/dialog.tsx app/studio/design-system tests e2e/ensemblis-ux-v5.spec.mjs
git commit -m "feat: consolidate mobile human-factors UX"
```

---

### Task 9: Add friction telemetry and reconcile specialist containment

**Files:**
- Modify: `components/studio/ux-telemetry.tsx`
- Modify: `components/studio/ux-telemetry.tsx` consumers as needed in migrated journey components
- Modify: `app/api/studio/ux-event/route.ts`
- Modify: `lib/studio/ux-telemetry-client.ts`
- Modify: `docs/ensemblis-ux-v5-route-inventory.md`
- Test: `tests/ensemblis-ux-v5-contract.test.mjs`
- Test: `tests/ensemblis-ux-human-factors.test.mjs`

**Interfaces:**
- Consumes: existing normalized UX events.
- Produces: normalized friction signals for recommendation bypass, navigation recovery, stage abandonment and advanced-detail dependence.

- [ ] **Step 1: Add failing telemetry privacy/shape tests**

Add normalized event categories for:

- recommendation bypass / alternate action;
- navigation recovery;
- workflow stage abandonment/continuation;
- advanced-detail dependency.

Assert no raw creative text or raw launcher query is accepted.

- [ ] **Step 2: Run focused tests and verify failure**

```bash
node --test tests/ensemblis-ux-v5-contract.test.mjs tests/ensemblis-ux-human-factors.test.mjs
```

- [ ] **Step 3: Add the minimal normalized events**

Keep payloads categorical and object IDs only where existing privacy rules permit. Do not introduce full-session replay or raw content capture.

- [ ] **Step 4: Reconcile the route inventory**

Update natural discovery and default visibility for any specialist page moved behind an inspector or focused child route. Do not add specialist destinations to primary navigation or Launcher tool-directory results.

- [ ] **Step 5: Run focused tests**

Same command as Step 2. Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add components/studio app/api/studio/ux-event/route.ts lib/studio/ux-telemetry-client.ts docs/ensemblis-ux-v5-route-inventory.md tests
git commit -m "feat: measure UX friction without creative-content capture"
```

---

### Task 10: Full validation, visual re-audit and PR completion

**Files:**
- Modify: `docs/ensemblis-ux-human-factors-audit.md`
- Modify: `docs/superpowers/plans/2026-10-04-ensemblis-ux-human-factors.md` to check completed tasks
- Modify: `docs/superpowers/specs/2026-10-04-ensemblis-ux-human-factors-design.md` only for implementation-result reconciliation

**Interfaces:**
- Consumes: all prior tasks.
- Produces: final evidence that the redesign is coherent, safe, buildable, and materially simpler.

- [ ] **Step 1: Run the complete automated gate**

```bash
npm run test:studio
npm run typecheck
npm run lint
npm run build
git diff --check
```

Expected:

- Studio suite: 0 failures;
- TypeScript: PASS;
- lint: 0 errors;
- production build: PASS;
- diff check: PASS.

- [ ] **Step 2: Run authenticated desktop/mobile acceptance**

```bash
npm run test:e2e:studio
```

Expected: all canonical journeys PASS with legitimate authentication. Missing credentials are a release blocker for visual acceptance, not a reason to skip.

- [ ] **Step 3: Re-run the screenshot-backed audit**

For each canonical journey, compare the final experience against the Task 1 baseline and score the 12-point UX scorecard from the spec.

Hard gates 2, 3, 4, 7 and 12 must pass for every journey.

- [ ] **Step 4: Inspect regressions manually**

Verify especially:

- no safety blocker was hidden;
- no expert capability became unreachable;
- no page gained a competing top-level navigation concept;
- no default screen regressed into a grid of equally important modules;
- no mobile-only context loss;
- no raw creative-content telemetry.

- [ ] **Step 5: Update audit and plan completion ledger**

Record:

- before/after findings;
- remaining non-blocking opportunities;
- any acceptance item blocked by external credentials/environment;
- exact final validation commands/results.

- [ ] **Step 6: Final commit**

```bash
git add docs tests e2e app components lib
git commit -m "docs: complete Ensemblis UX human-factors recovery"
```

- [ ] **Step 7: Final PR review**

Before marking ready, inspect the full branch diff for accidental scope creep and verify the PR description matches the shipped result.
