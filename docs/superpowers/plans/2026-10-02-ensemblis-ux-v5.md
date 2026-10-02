# Ensemblis UX V5 â€” Single PR Execution Plan

**Status:** Implemented in draft PR #280 — automated gates green; authenticated browser acceptance pending
**Architecture:** `docs/ensemblis-ux-architecture-v5.md`
**Execution model:** one draft PR from planning through final validation
**Branch:** `feat/ensemblis-ux-v5`
**Date:** 2026-10-02

## 1. Goal

Complete the interaction reset started by UX V4 without deleting product capability.

The PR must make Ensemblis feel easier because the product understands:
- what the artist wants;
- which object the artist means;
- what state that object is in;
- what action is useful now;
- what complexity can remain hidden.

The PR is not a visual refresh. It is an interaction-architecture completion pass.

## 2. Single-PR rules

All V5 implementation stays in this PR so the product can be validated as one coherent experience.

Rules:
1. Keep the PR in Draft until all mandatory gates pass.
2. Use checkpoint commits by workstream; do not merge partial UX semantics to `main`.
3. Do not create new top-level Studio destinations.
4. Do not remove specialist capability without a replacement discovery path.
5. Do not duplicate domain state for UI convenience.
6. Preserve exact artist/object lineage in every contextual action.
7. Preserve approval, rights, spend and external-effect safety.
8. Update canonical docs in the same commit that changes the corresponding durable UX contract.
9. Add automated regression contracts before retiring legacy/default paths.
10. Final browser validation must use production-like artist data and both desktop/mobile viewports.

## 3. Baseline findings this PR must close

### A. Action Launcher
Current gap: natural-language presentation over keyword commands + object search.

Required outcome:
- intent + object composition;
- status questions;
- continuation;
- bounded disambiguation;
- safe structured resolution.

### B. Music
Current gap: large inventory page with summary counters, catalog list, unreleased focus, release list and creation callout competing vertically.

Required outcome:
- search/filter;
- Continue / Needs attention;
- Tracks / Releases / Mixes object switcher;
- contextual Add;
- inventory density only when requested.

### C. Track
Current gap: object surface still exposes multiple audio subsystems and anchor-based â€œtabsâ€.

Required outcome:
- player + state + actions first;
- Best sections and release context next;
- analysis/mastering/stems/lyrics detail secondary;
- honest navigation semantics.

### D. Release
Current gap: better than V3, but lifecycle, mastering, content, growth and distribution can still compete for attention.

Required outcome:
- persistent lifecycle context;
- one next release action;
- blockers before subsystem detail;
- facet-specific jobs;
- advanced provider/engineering detail secondary.

### E. Grow
Current gap: recommendation, diagnosis, metrics, plan, opportunities and tools all compete.

Required outcome:
- recommendation first;
- opportunities second;
- in-motion work next;
- metrics only as explanation;
- advanced tooling clearly secondary.

### F. Mobile
Current gap: correct primary nav, but deep pages remain desktop-shaped and important actions may be buried.

Required outcome:
- mobile-native object actions;
- sheets instead of side inspectors;
- reduced long-scroll burden;
- Create available contextually;
- parity of mental model, not parity of layout.
## 4. Workstream 0 â€” Contracts before visual change

### Deliverables

- make V5 architecture canonical on this branch;
- add V5 route/discoverability inventory;
- add contract tests for:
  - primary workspace ownership;
  - specialist-route parent ownership;
  - no new top-level navigation;
  - object actions preserving artist scope;
  - launcher action registry;
  - real tab semantics;
  - advanced-only specialist controls.

### Likely files

- `lib/ensemblis-product.ts`
- `tests/studio-product-lifecycle.test.mjs`
- `tests/invisible-complexity-foundation.test.mjs`
- new V5 UX contract tests where clearer
- `docs/ensemblis-ux-v5-route-inventory.md`

### Exit criteria

- every protected Studio route has one V5 owner;
- every normal user goal has at least one discoverable non-route-knowledge entry;
- tests fail if a specialist route becomes a new primary concept.

## 5. Workstream 1 â€” Intent Engine / Action Launcher V5

### Product behavior

Create a typed intent resolution layer with inputs:
- raw query;
- active artist;
- current route/context;
- artist-scoped searchable objects.

Return a structured result such as:
- intent kind;
- matched object type/id;
- action;
- confidence;
- disambiguation candidates;
- explanation;
- safe href or preparation target.

### Resolution order

1. deterministic aliases and known commands;
2. exact / fuzzy artist object resolution;
3. action + object composition;
4. constrained semantic resolver;
5. bounded disambiguation.

### Required intents

At minimum:
- add_music
- open_object
- continue_work
- create_from_object
- master_track
- mix_music
- prepare_release
- promote_release
- release_readiness
- release_results
- needs_you
- connect_library

### UI behavior

Default launcher state:
- 4â€“6 contextual suggestions maximum;
- recent/continue objects if useful;
- no giant directory of Tools.

Typed query state:
- direct action result first;
- object results second;
- alternatives only when confidence is insufficient.

Status-query result:
- answer in one or two lines;
- one recommended action;
- supporting detail optional.

### Safety

No launcher path directly executes:
- publish;
- send;
- spend;
- submit;
- rights confirmation;
- destructive mutation.

It may route to the correct confirmation/review workflow.

### Likely files

- `components/studio/command-palette.tsx`
- new `lib/studio/intent/*`
- `app/api/studio/search/route.ts` or a dedicated intent endpoint
- existing AI control-plane boundary if semantic resolution uses an LLM
- launcher and search tests

### Exit criteria

Canonical phrases resolve:
- â€œmake a DJ mixâ€
- â€œmaster <track>â€
- â€œmake a reel from <track>â€
- â€œprepare <release>â€
- â€œis <release> ready?â€
- â€œhow is <release> doing?â€
- â€œcontinue my mixâ€
- â€œwhat needs me?â€
## 6. Workstream 2 â€” Shared V5 object patterns

Before rewriting individual screens, build/recompose shared product widgets.

### Required shared patterns

- ObjectHeader V5
- ObjectStateSummary
- ObjectActionBar
- Continue card
- NextAction card
- CompactEvidence / WhyThis
- WorkflowStepper
- ContextInspector
- MobileSheet
- Search/filter field for object collections
- Calm empty state
- Blocker state with one recovery action

### Rules

- one primary button per bounded decision surface;
- buttons use verbs;
- state label precedes configuration;
- technical detail never becomes the largest visual area by default;
- widgets accept canonical domain state rather than deriving parallel UI state.

### Likely files

- `components/studio/object-header.tsx`
- `components/studio/ux-v4-widgets.tsx` â†’ either evolve or rename only if migration is clean
- `components/studio/patterns.tsx`
- `components/studio/ui.tsx`
- `app/studio/studio-v2.css`
- focused module CSS where appropriate

### Exit criteria

Track, Release, Mix and Growth surfaces can all use the same action/state/disclosure grammar.

## 7. Workstream 3 â€” Today V5

### Keep

- Action Launcher prominence;
- Continue;
- PriorityHero / Needs You priority;
- background handling;
- Coming up.

### Change

- make launcher suggestions contextual;
- ensure Continue ordering reflects meaningful active work;
- reduce secondary links competing with hero;
- answer status-style user intent from Today when possible;
- audit copy for internal vocabulary;
- ensure â€œEverything else todayâ€ remains genuinely secondary.

### Exit criteria

Above the fold:
- launcher;
- at most three Continue objects;
- one dominant next move.

No duplicate action appears twice in the first viewport.

## 8. Workstream 4 â€” Music V5

### New structure

```text
Music
[ Search musicâ€¦ ]      [ Add ]

Continue / Needs attention (only when non-empty)

[ Tracks | Releases | Mixes ]

object collection
```

### Tracks
- default sort: meaningful recency/state, not arbitrary database order;
- play/open;
- state;
- one contextual action;
- search/filter.

### Releases
- reuse Release collection data in Music;
- do not require route knowledge of `/studio/releases`.

### Mixes
- explicit object presentation;
- in-progress first;
- render/output states clear.

### Retire from default Music page
- summary counters unless decision-relevant;
- full catalog + unreleased + release + creation sections stacked on one page;
- duplicated â€œuse catalogâ€ action block.

### Exit criteria

A user can find:
- a specific track;
- active release;
- unfinished mix;
- Add music

without scrolling through unrelated collections.
## 9. Workstream 5 â€” Track V5

### Default composition

```text
Back to Music / Release

Track identity
Player
State / readiness

[ Create ] [ Master ] [ Mix ] [ More ]

Best sections
Release context
Compact analysis summary

Advanced / inspector
```

### Mastering integration

Master Readiness remains authoritative, but the default Track screen should show:
- Ready / Review suggested / Fix before release;
- concise reason;
- Master action.

Only after opening Master:
- mastering direction;
- references;
- Listen Lab;
- engineering evidence;
- previous runs.

### Analysis

Replace default â€œTrack Intelligenceâ€ emphasis with artist-facing summary:
- tempo/key if useful;
- structure;
- strongest sections;
- voice/energy observations where trustworthy.

Detailed model/version/confidence belongs to inspector.

### Stems and lyrics

Show an actionable state when they block or unlock a user goal.
Otherwise keep them in secondary detail.

### Navigation semantics

Remove anchor links styled as always-active tabs.
Either:
- use true in-page section navigation without tab semantics; or
- make each selected view a real coherent state.

### Exit criteria

Within one viewport, user understands:
- what track this is;
- whether it is ready;
- what can be done;
- which action is recommended.

## 10. Workstream 6 â€” Release V5

### Persistent header

Always retain:
- artwork/title;
- lifecycle/release date;
- current readiness;
- next action;
- facet navigation.

### Overview

Order:
1. next release step;
2. blockers;
3. tracks/master state;
4. lifecycle progress;
5. release details collapsed;
6. advanced tools collapsed.

### Creative

- recommended creative direction;
- existing assets / Continue;
- Create from release;
- Moment/section detail only as supporting evidence.

### Promotion

- recommended promotion action;
- current plan / in-motion work;
- audience/creative rationale;
- campaign internals one level deeper.

### Distribution

- release readiness;
- blockers;
- destination status;
- explicit rights/AI provenance confirmations only when required;
- provider operations secondary.

### Results

- interpreted outcome;
- what changed;
- recommendation;
- supporting metrics;
- deep analytics optional.

### Mastering coherence

Release-level mastering coherence is important but cannot outrank the release's actual next action.
Show it:
- when it finds a review/blocker; or
- in a mastering/readiness disclosure.

### Exit criteria

Normal release work never requires leaving the Release object to discover the next step.
## 11. Workstream 7 â€” Grow V5

### Default view

```text
Grow

Recommended next action
why this matters

Opportunities
In motion
Audience
Performance

Advanced
```

### Recommendation card

Must contain:
- action;
- target object;
- short rationale;
- confidence/evidence wording only if useful;
- one primary CTA.

### Opportunities

Keep accepted/new distinction, but simplify language.
Do not lead with synthetic priority score.

### Performance

Default to interpretation:
- what changed;
- bottleneck;
- likely action.

Detailed funnel and raw metrics are supporting evidence.

### Advanced

Move:
- portfolio diagnostics;
- planning posture;
- manual refresh;
- paid experiment machinery;
- campaign internals;
- detailed learnings

behind explicit Advanced/secondary routes.

### Exit criteria

A first-time user can open Grow and answer â€œwhat should I do?â€ before reading any chart or metric table.

## 12. Workstream 8 â€” Language and cognitive-load pass

Run a deliberate artist-facing terminology pass over default surfaces.

Replace or soften:
- Track Intelligence
- Moment
- Mission
- evidence-backed
- bounded
- lineage
- provider
- reconciliation
- provenance where not legally relevant
- technical confidence labels

Do not globally rename domain types in code if that creates architecture churn.
This work is primarily presentation-language separation.

### Copy rules

- headings: short and actionable;
- body copy: one idea per paragraph;
- avoid explaining product philosophy in routine screens;
- use â€œWhy this?â€ for deeper rationale;
- show detail only when it changes trust or action.

### Exit criteria

Primary surfaces can be understood without prior Ensemblis vocabulary.
## 13. Workstream 9 â€” Mobile-native pass

Validate every canonical journey at narrow widths.

### Required changes

- sticky/contextual object action bar where useful;
- inspectors become sheets;
- dense desktop grids become bounded cards/lists;
- no horizontal overflow except intentional tab strips;
- long technical blocks collapsed by default;
- bottom navigation never covers primary action;
- keyboard-visible input states on mobile;
- touch targets remain >= 44px;
- player controls remain usable one-handed.

### Mandatory mobile journeys

- Today â†’ Continue;
- Search â†’ Track;
- Track â†’ Master;
- Track â†’ Create;
- Music â†’ Mixes â†’ Continue;
- Release â†’ Distribution blocker;
- Grow â†’ recommendation;
- More â†’ Settings / Library.

## 14. Workstream 10 â€” Legacy/specialist containment

Audit all compatibility routes.

Each route must be one of:
- contextual specialist;
- advanced inspector/page;
- redirect/compatibility;
- retirement candidate.

No compatibility page may:
- add primary navigation;
- introduce a competing product name;
- duplicate a normal workflow;
- become the only discoverability path for a normal action.

Target routes include:
- /studio/content
- /studio/production
- /studio/inbox
- /studio/tasks
- /studio/media
- /studio/distribution
- /studio/distribution/operations
- /studio/analytics
- /studio/campaigns
- /studio/learn
- /studio/brand
- provider-specific pages

Retire only when tests prove the replacement path.
## 15. Route ownership deliverable

Create `docs/ensemblis-ux-v5-route-inventory.md` during Workstream 0.

For every route record:
- V5 owner;
- role;
- natural discovery path;
- default visibility level;
- intended final state;
- whether it is allowed in Launcher results.

This inventory is part of the acceptance gate, not documentation cleanup.

## 16. Testing strategy

### Contract tests

Must cover:
- Today / Music / Grow primary nav only;
- Create as action, not competing workspace;
- route ownership;
- launcher intents;
- artist-scoped deep links;
- contextual action availability;
- no specialist controls on default surfaces;
- true tabs vs section navigation;
- mobile primary reachability;
- safety confirmation boundaries.

### Component tests

Focus on behavior:
- intent disambiguation;
- inspector open/close/focus;
- workflow continuation;
- search/filter;
- error/retry states;
- mobile sheets.

### Browser tests

Extend Playwright/e2e for the ten canonical journeys in the architecture doc.

Use:
- desktop ~1440px;
- narrow mobile viewport;
- realistic Atlas data;
- traditional/non-AI acceptance where policy affects UI.

### Accessibility

At minimum:
- keyboard-only canonical journeys;
- focus order;
- dialog/sheet focus trap;
- aria-current correctness;
- headings;
- reduced motion;
- touch target checks where automated coverage exists.

### Build gates

Before PR is marked ready:
- `npm run typecheck`
- `npm run lint`
- `npm run test:studio`
- relevant focused tests
- `npm run build`
- relevant database validation only if data schema changes
- browser smoke on final head

## 17. UX validation scorecard

For each canonical journey answer yes/no:

1. Can the user start from a goal rather than a feature name?
2. Is the relevant object obvious?
3. Is the current state obvious?
4. Is there exactly one dominant next action?
5. Can the user understand why without reading technical detail?
6. Can advanced users inspect the underlying detail?
7. Can the user safely leave and resume?
8. Does mobile preserve the same mental model?
9. Are consequential actions still explicitly gated?
10. Does failure recovery preserve user data and context?

A journey is not complete if any of 1â€“4 or 9 fails.
## 18. Implementation sequence inside the single PR

Use this order to minimize churn:

1. V5 contracts + route inventory
2. shared object/action/disclosure patterns
3. Action Launcher intent engine
4. Today integration
5. Music collections
6. Track object
7. Release object
8. Create contextual pre-resolution
9. Grow
10. mobile-native pass
11. specialist-route containment/retirement
12. terminology pass
13. instrumentation
14. full regression/browser validation
15. docs reconciliation

Checkpoint commits are encouraged. Separate PRs are not.

## 19. Risk controls

### Risk: PR becomes too large to reason about
Mitigation:
- strict workstream commits;
- tests at each contract boundary;
- keep architecture doc authoritative;
- avoid unrelated refactors.

### Risk: simplification hides important capability
Mitigation:
- route inventory;
- Launcher/search discovery;
- Advanced inspectors;
- explicit migration acceptance for every retired default surface.

### Risk: semantic launcher makes unsafe assumptions
Mitigation:
- structured intents;
- confidence thresholds;
- deterministic object scope;
- disambiguation;
- navigation/preparation only for consequential actions.

### Risk: data/state divergence
Mitigation:
- UI reads canonical existing state;
- no V5-specific shadow state;
- domain transitions remain in existing server/domain boundaries.

### Risk: visual cleanup without usability improvement
Mitigation:
- canonical journey scorecard;
- action-to-first-success metrics;
- browser testing from user goals.

## 20. Final PR review checklist

Before switching Draft â†’ Ready:

- [ ] V5 architecture matches implementation
- [ ] route inventory matches implementation
- [ ] Action Launcher is truly intent-aware
- [ ] Today has one dominant next move
- [ ] Music is object-first
- [ ] Track is action-first
- [ ] Release is lifecycle-guided
- [ ] Create remains outcome-first
- [ ] Grow is recommendation-first
- [ ] mobile canonical journeys pass
- [ ] specialist routes are secondary/contained
- [ ] default copy is artist-facing
- [ ] safety gates are unchanged or stronger
- [ ] no object/artist lineage regression
- [ ] no new top-level navigation
- [ ] TypeScript passes
- [ ] lint passes
- [ ] Studio tests pass
- [ ] build passes
- [ ] browser smoke passes
- [ ] final diff reviewed for accidental scope creep

## 21. Merge rule

Do not merge because individual workstreams look good.

Merge only when the product can be dogfooded as one coherent V5 experience and the ten canonical journeys pass from the user's goal to a safe, understandable outcome.


## 22. Implementation validation — 2026-10-02

PR #280 now contains the V5 implementation across the planned product surfaces.

Implemented:
- typed intent classification plus artist-scoped object resolution;
- bounded semantic fallback through the existing Ensemblis AI control plane;
- answer/action results for release readiness and results;
- contextual Today launcher suggestions;
- object-first Music with Tracks / Releases / Mixes;
- action-first Track with truthful source-context handoff and secondary technical inspection;
- lifecycle-guided Release with the release plan before track/engineering detail;
- outcome-first Create with requested deliverable preselection;
- recommendation-first Grow using the active artist context;
- mobile-native action/disclosure styling;
- simplified default artist-facing terminology;
- UX telemetry that stores normalized intent/result categories rather than raw creative queries;
- V5 route/discoverability contracts;
- authenticated Playwright V5 journey coverage gated behind `PLAYWRIGHT_STUDIO_E2E=1`.

Validated on this branch:
- `node --test tests/ensemblis-intent-resolution.test.mjs tests/ensemblis-ux-v5-contract.test.mjs` → 13/13 passing;
- `npm run test:studio` → 561/561 passing on the final V5 code head;
- `npm run typecheck` → passing;
- `npm run lint` → 0 errors (pre-existing warnings remain outside V5);
- `git diff --check` → passing;
- `npm run build` → passing on Next.js 16.3.4.

Authenticated browser acceptance:
- the Playwright suite is implemented and can run against a real authenticated Studio environment;
- local execution was attempted without weakening auth;
- Vercel CLI materializes the protected Supabase server credentials as empty values, so the existing safe localhost admin path cannot authenticate to production data from this machine;
- no test-only production bypass was added;
- PR #280 remains Draft until the authenticated desktop/mobile browser suite runs in an environment where the protected credential or authenticated browser state is legitimately available.

This is an environment acceptance gate, not an unimplemented V5 product workstream.
