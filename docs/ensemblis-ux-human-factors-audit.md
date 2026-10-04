# Ensemblis UX Human-Factors Audit

**Status:** Implementation complete; automated code/build gates pass. Authenticated screenshot acceptance remains explicitly unverified.
**Date:** 2026-10-04
**Branch:** `design/ensemblis-ux-human-factors`
**PR:** #283

## Why this recovery existed

UX V5 fixed the product model, but several core Studio destinations still behaved like capability dashboards. The recovery preserved Today / Music / Grow, the object model, the Action Launcher, safety boundaries and expert capabilities while reducing the amount of product structure a musician has to understand at once.

The governing rule is:

> Ensemblis may be powerful internally, but each moment of use should feel like one understandable decision.

## Baseline

| Journey | Baseline problem | Priority |
| --- | --- | --- |
| Track | State, actions, analysis, mastering, stems, lyrics and technical evidence competed on one long surface. | P0 |
| Mastering | Strong safety/fidelity logic, but too many mastering concepts appeared at once. | P0 |
| Grow | Recommendation was followed by a dense set of peer dashboards and actions. | P0 |
| Release | Correct lifecycle model, but too many modules competed inside one workspace. | P0 |
| AutoMix | Canonical stages existed, while recovery/specialist machinery could still compete with the active stage. | P1 |
| Music / Add music | Intake explained product philosophy more than the immediate consequence of each choice. | P1 |
| Today | Continue and Priority could appear as two equally important large blocks. | P1 |
| Create | Three useful directions could still look equally recommended. | P1 |
| Mobile / advanced detail | Correct primitives existed, but hierarchy and inspector treatment needed stronger guarantees. | P1 |

## Implemented recovery

### Track

The default Track composition is now intentionally ordered:

1. identity and source;
2. one current state;
3. one ranked next action;
4. bounded secondary actions;
5. concise “What Ensemblis hears” summary;
6. mastering only when relevant;
7. release/stems/lyrics context only when relevant.

Technical analysis is opened intentionally through `ContextInspector`. `ObjectActionBar` enforces one primary action and at most two visible secondary actions before overflow.

### Mastering

Mastering is derived into one UI stage at a time:

`source → recommendation → processing → review → result`

Source-repair blockers stop the workflow before mastering. A/B listening and the final artist decision live in Review. Mastering never presents itself as a cure for source clipping, timing, phase or render defects it cannot safely restore.

### Grow

The default Grow surface is now recommendation-first:

`recommendation → reason/action → in-motion work → compact context`

Opportunity inventories, performance detail, strategy explanation and paid machinery remain secondary/contextual rather than peer modules.

### Release

Release Overview now leads with lifecycle state and one ranked next step, followed by blockers and compact readiness. Creative, Promotion, Distribution and Results remain coherent facets rather than competing dashboard modules. Optional enrichment failures remain non-blocking to canonical release access.

### AutoMix

The canonical flow remains:

`Music → Intent → Build → Review → Render`

Render recovery now belongs to Render rather than a global competing surface. Specialist DJ/library/Rekordbox tooling remains advanced.

### Today, Music and Create

Today ranks one primary task. A real resumable workflow can win the page; the other recommendation is collapsed rather than rendered as an equal hero.

Add Music is consequence-first. Product explanation moved behind “How Ensemblis uses your source”.

Create keeps three bounded directions but gives one direction primary visual/action weight; alternatives are explicitly secondary.

### Mobile and accessibility

The recovery keeps the same mental model at narrow widths:

- primary task action remains reachable;
- workflow steppers horizontally scroll/snap instead of wrapping into noise;
- contextual inspectors become mobile-height sheets;
- focus returns to the inspector trigger;
- coarse-pointer target sizing is enforced;
- reduced-motion behavior is preserved.

### Friction telemetry

The implementation records normalized categories only:

- `recommendation_bypass`
- `navigation_recovery`
- `workflow_stage`
- `advanced_detail_dependency`

It does not accept raw launcher queries, track titles, prompt text or creative text. The final self-review found that `ContextInspector` opens were not initially contributing to advanced-detail dependency measurement; a regression test was added, watched RED, then fixed and returned GREEN.

## Human-factors contract evidence

| Contract | Result |
| --- | --- |
| One dominant action / bounded secondaries | Enforced by shared `ObjectActionBar` contract and tests |
| Track state before recommendation before secondary detail | Enforced by semantic source tests |
| Staged Mastering | Enforced by stage resolver and mastering tests |
| Grow recommendation-first | Enforced by semantic source tests |
| Release lifecycle-first | Enforced by semantic source tests |
| AutoMix recovery contained in Render | Enforced by AutoMix contracts |
| Today continuation vs priority ranking | Enforced by human-factors contract |
| Create recommendation vs alternatives | Enforced by Create contract and styling |
| Mobile inspector/focus/target/reduced-motion contracts | Enforced by source tests |
| Specialist-route containment | Reconciled in the V5 route inventory |
| No raw creative-content telemetry | Enforced by schema/source tests |

## Verification evidence

### RED → GREEN evidence

The recovery used branch CI as the executable TDD environment when the local Desktop Commander became unavailable.

- Baseline human-factors contract commit `9a0e38b`: Studio product contracts failed before implementation.
- Telemetry contract commit `2798f28`: Studio product contracts failed before normalized friction events existed.
- Telemetry implementation `8aa8a60`: Studio contracts, TypeScript, lint and browser smoke passed.
- Final-review regression `8afe2b1`: Studio product contracts failed because `ContextInspector` was missing from dependency telemetry.
- Fix `f31d29e`: Studio contracts, TypeScript, lint and browser smoke passed.

### Full automated gate

Verified on the recovery branch:

- `npm run test:studio`: PASS via GitHub CI
- `npm run typecheck`: PASS via GitHub CI
- `npm run lint`: PASS via GitHub CI
- public/unauthenticated Playwright smoke: PASS via GitHub CI
- `npm run build`: PASS in one-off branch build verification run `37173678929`
- `git diff --check`: PASS in the same build verification run

The one-off build workflow was removed immediately after it supplied the missing production-build evidence.

## Authenticated visual acceptance boundary

The authenticated Playwright suite is instrumented with full-page audit checkpoints for:

- `ux-01-add-music`
- `ux-02-track`
- `ux-02-mastering`
- `ux-03-create`
- `ux-04-release`
- `ux-05-automix`
- `ux-06-grow`
- `ux-08-needs-you`
- `ux-mobile-music`

Those screenshots have **not** been executed against this branch.

Why:

1. the Vercel project has no deployment for `design/ensemblis-ux-human-factors`;
2. the dedicated `Studio UX V5 acceptance` workflow is `workflow_dispatch` only;
3. the available GitHub connector can read/rerun workflow runs but cannot dispatch a new one;
4. no authenticated acceptance run exists for this branch.

No auth bypass, fake login state, mocked screenshot or production-target substitution was introduced.

Therefore this audit can state that the structural, semantic, accessibility, safety and build contracts are verified. It **cannot** honestly state that the final UI has passed screenshot-backed visual acceptance until the dedicated authenticated suite is run against a deployment containing this branch.

## Final code-review result

A whole-branch self-review was performed because no independent reviewer/subagent execution tool is available in this environment. It reviewed the recovery against the spec with focus on:

- source-repair/mastering safety;
- expert capability reachability;
- specialist-route containment;
- mobile hierarchy/focus;
- telemetry privacy;
- accidental competing navigation models.

One Important issue was found and fixed: `ContextInspector` advanced-detail opens were not included in dependency telemetry. The fix was verified RED → GREEN.

No remaining Critical or Important code findings were identified in that pass.

## Remaining acceptance gate

Before merge/release, run the existing authenticated `Studio UX V5 acceptance` workflow against a deployment containing PR #283. That run should produce the screenshot evidence needed to complete the visual scorecard. Until then, authenticated visual acceptance is intentionally marked **BLOCKED / NOT RUN**, not passed.
