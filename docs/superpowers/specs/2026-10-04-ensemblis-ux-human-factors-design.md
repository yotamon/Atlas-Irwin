# Ensemblis UX Human-Factors Recovery Design

**Status:** Proposed canonical design for the next UX correction
**Date:** 2026-10-04
**Scope:** Ensemblis Studio artist-facing product experience
**Parent program:** #119 Invisible Complexity
**Preserves:** Ensemblis UX Architecture V5 intent/object/action model

## 1. Problem

Ensemblis UX V5 fixed the product model in the right direction:

- intent before route knowledge;
- artist objects before subsystems;
- one recommended action before technical evidence;
- Today / Music / Grow as the primary shell;
- specialist controls behind progressive disclosure.

The remaining problem is not primarily information architecture. It is **human-factors load inside otherwise-correct destinations**.

The repository already shows several warning signs:

- the Track page is still a large orchestration surface;
- Growth still renders many simultaneous sections, links and actions;
- Release remains a multi-section workspace with many competing destinations;
- advanced disclosure frequently hides detail without reducing the amount of choice visible before the user acts;
- automated acceptance proves routes and behavior, but not whether a musician can understand the interface quickly and confidently.

The product can therefore satisfy V5 contracts while still feeling exhausting, verbose, feature-heavy and difficult to operate.

The correction is not to introduce another navigation architecture. It is to make the existing V5 architecture **perceptually simple in actual use**.

## 2. Product outcome

A musician should be able to enter Ensemblis with a goal and make the next meaningful decision without scanning the product's capability map.

For every common journey, the interface must answer in this order:

1. What am I trying to accomplish?
2. What object am I working on?
3. What is its current state?
4. What is the single best next action?
5. What happens if I take it?
6. What else can I do, only if I intentionally ask?

Success means the product feels smaller than its implementation.

## 3. Primary users

### 3.1 Default artist

A musician or producer who understands music but does not know Ensemblis' internal product architecture.

They should not need to know:

- which subsystem owns a capability;
- which specialist route exists;
- implementation vocabulary;
- worker/provider/model concepts;
- which page contains a particular technical control.

### 3.2 Expert artist

A technically curious user who may want diagnostics, advanced mastering controls, source provenance, detailed growth evidence or provider state.

The expert path must remain available without defining the default interface.

## 4. Design strategy

### 4.1 Preserve V5's mental model

Do not replace Today / Music / Grow, object-centered navigation, Action Launcher, contextual actions or progressive disclosure.

This program is a compression pass over V5, not a competing architecture.

### 4.2 Design around user jobs, not product domains

The canonical product journeys are:

1. Understand a track
2. Improve or master a track
3. Create from a track or release
4. Build and finish an AutoMix
5. Prepare a release
6. Promote a release or track
7. Understand what is working
8. Resolve something that needs the artist
9. Recover from failure
10. Inspect technical detail intentionally

A surface is good when it moves one of these jobs forward clearly.

### 4.3 Default screen = decision surface

A normal screen should not be a dashboard of everything that is true.

A default screen should contain:

- object identity;
- one current state;
- one recommended next action;
- a short reason;
- the minimum supporting context needed to trust the action.

Everything else is secondary.

### 4.4 Progressive disclosure must reduce decisions, not only text

Putting content in a `<details>` element is insufficient if the user still sees many competing cards, tabs, links and actions.

Disclosure should remove whole decision branches from the default path.

### 4.5 Use staged interaction when multiple decisions are genuinely required

If a task has multiple meaningful choices, present one stage at a time.

Do not render the complete workflow as one long page merely because all data is available.

## 5. Human-factors complexity budgets

These are product contracts, not visual preferences.

### 5.1 Default actionable choices

A normal task surface should expose:

- 1 dominant primary action;
- at most 2 secondary actions;
- advanced/specialist actions behind one intentional disclosure entry point.

Exceptions require an explicit product reason such as legally consequential alternatives.

### 5.2 Above-the-fold hierarchy

At common laptop width, the user should see without scrolling:

- page/object identity;
- state;
- one recommended next action;
- short rationale or blocker.

A user must not need to scroll to discover what Ensemblis wants them to do.

### 5.3 Section budget

Default task surfaces should normally contain no more than 4 major visible sections.

If a page needs more, it should become:

- staged workflow;
- tabs with real view switching;
- contextual inspector;
- child object page;
- collapsed history/reference area.

### 5.4 Copy budget

Default explanatory copy should be brief and operational.

Long educational/product-philosophy copy belongs in:

- onboarding;
- help;
- explanation drawer;
- empty states where education is necessary.

It should not repeatedly compete with the user's task.

### 5.5 Status vocabulary

A user-facing object should normally have one dominant state label from a small shared vocabulary:

- Ready
- Working
- Needs review
- Blocked
- Complete

Domain-specific nuance belongs in the explanation layer.

## 6. Canonical interaction model

Each core journey should use this sequence:

```text
goal
  ↓
object
  ↓
state
  ↓
recommended action
  ↓
one focused decision/stage
  ↓
result
  ↓
next useful action or calm completion
```

The user should never need to reconstruct this sequence from multiple unrelated cards.

## 7. Surface redesign contracts

## 7.1 Today

Today remains the operating surface.

It must contain:

1. Action Launcher
2. Continue, only when there is meaningful resumable work
3. one Priority / Needs You decision
4. collapsed secondary context

Do not add summary dashboards back to Today.

The main review question is whether Continue and Priority currently compete for attention. If they do, rank them instead of rendering both as equally important blocks.

## 7.2 Music

Music is a library and continuation surface, not a product menu.

Default view:

1. search/filter
2. active/needs-attention objects
3. Tracks / Releases / Mixes switcher
4. object list
5. contextual Add

"Add music" must be a focused choice flow. Product philosophy and internal policy explanations should be secondary unless they materially change the user's choice.

## 7.3 Track

Track is the highest-priority simplification target.

Default track screen:

1. identity + player
2. current readiness state
3. one recommended action
4. compact action row for Create / Master / Mix when relevant
5. one concise "what Ensemblis hears" summary
6. relationship to active release, only when relevant

Move the following out of the default scroll:

- detailed mastering evidence;
- stems detail;
- lyric provenance;
- deep Track Intelligence;
- provider/model metadata;
- engineering reports;
- historical diagnostics;
- secondary generation controls.

When mastering is the user's current goal, transition into a focused mastering workflow instead of expanding the Track page.

## 7.4 Mastering

Mastering must feel like a guided review process, not a mastering subsystem dashboard.

Canonical stages:

1. Source check
2. Recommendation
3. Processing / wait state
4. Loudness-matched A/B review
5. Approve / keep original / revise
6. completed result

Engineering evidence lives behind "Why?" / "Technical details".

If source repair is required, the workflow stops and presents the repair decision clearly.

## 7.5 AutoMix

AutoMix should read as one continuous creation flow.

Canonical stages:

1. choose source tracks
2. confirm intent / target
3. build
4. review transitions/order
5. render
6. listen/download

Advanced DJ analysis and library-integration details should not compete with the stage currently being completed.

## 7.6 Release

Release should behave as a guided lifecycle object.

Persistent header:

- release identity;
- lifecycle state;
- next action.

Default Overview:

1. next release step
2. blockers
3. track/master readiness
4. compact lifecycle progress

Creative / Promotion / Distribution / Results remain coherent views, but each view must answer a single job.

A facet that contains many unrelated cards must be decomposed.

## 7.7 Create

Create is already closest to the target model.

Preserve:

- outcome-first language;
- source context;
- small recommendation set;
- strongest musical section;
- direct continuation.

Reduce repeated explanatory copy and make the first recommendation visually dominant enough that a user can act without reading every card.

## 7.8 Grow

Grow is the second-highest-priority simplification target.

The default surface should contain:

1. one recommendation
2. why it matters
3. one action
4. current experiments/work already moving
5. compact outcome context

Audience, performance, strategy settings, release ordering and specialist growth tools must not all appear as peers on the same default screen.

Detailed metrics move behind the recommendation or into focused secondary views.

## 8. Shared product primitives

The implementation should converge core UX around a small set of primitives rather than page-specific layout inventions.

### 8.1 `TaskHero`

Shows:

- object/goal context;
- state;
- recommended action;
- short reason;
- optional secondary action.

### 8.2 `WorkflowStage`

Shows:

- current stage;
- completed stages;
- one primary continuation;
- safe exit/resume.

### 8.3 `ActionGroup`

Enforces:

- one primary;
- bounded secondary actions;
- overflow/specialist actions behind disclosure.

### 8.4 `ContextSummary`

Compact explanation/evidence block that can open a detailed inspector.

### 8.5 `SecondaryWorkspace`

A consistent pattern for advanced/detail surfaces so each domain does not invent a new dashboard.

These are conceptual interfaces. Exact component names may change during implementation planning if existing primitives can be extended cleanly.

## 9. Visual hierarchy requirements

Visual polish serves comprehension.

Required properties:

- stronger size/spacing contrast between primary and secondary content;
- fewer simultaneous bordered cards;
- fewer repeated badges/status pills;
- reduced chrome around informational content;
- consistent full-width task surfaces where the decision is primary;
- secondary evidence visually quieter than the recommended action;
- whitespace used to separate stages, not to make every card appear equally important.

A page should not look like a grid of independently important modules unless the user's task is genuinely comparative.

## 10. Copy strategy

Default copy should be:

- short;
- direct;
- artist-facing;
- action-oriented;
- specific to the current object.

Avoid repeating product principles inside routine workflows.

Prefer:

- "This track is ready to master."
- "The source clips on the loudest chorus. Fix the mix before mastering."
- "Your strongest next move is a short Reel from 1:04–1:19."

Over:

- descriptions of Ensemblis architecture;
- multi-sentence explanations of why the system is music-aware;
- internal policy language;
- implementation vocabulary.

## 11. UX audit methodology

Before product implementation, perform an authenticated visual audit of the real Studio using realistic artist data.

For each canonical journey:

1. start from the user's goal;
2. capture each meaningful screen/state;
3. record the visible primary action;
4. count competing actionable choices;
5. note required scrolling before the next action is understood;
6. note terminology that requires product knowledge;
7. record dead ends, backtracking and context loss;
8. test failure/loading/empty states;
9. repeat at desktop and narrow mobile width.

The audit should produce screenshot-backed findings, but screenshots are evidence, not the deliverable. The deliverable is the ranked set of product changes.

## 12. UX scorecard

Every canonical journey receives a 0/1 score for:

1. Goal can be expressed without feature vocabulary
2. Relevant object is obvious
3. Current state is obvious
4. Exactly one dominant next action is obvious
5. Action consequence is understandable
6. No unnecessary route knowledge is required
7. Default screen stays within complexity budget
8. Technical evidence is intentionally accessible
9. User can safely leave and resume
10. Failure recovery preserves context/data
11. Mobile preserves the same mental model
12. Consequential actions remain explicitly gated

Items 2, 3, 4, 7 and 12 are hard gates.

## 13. Automated regression contracts

Automation cannot prove usability, but it can prevent known complexity from returning.

Add tests for:

- primary/secondary action count on canonical components;
- canonical page ownership of advanced controls;
- specialist routes excluded from primary navigation;
- one dominant task hero on Track / Release / Grow / Mastering;
- technical vocabulary absent from default artist-facing surfaces;
- advanced detail reachable through explicit disclosure;
- mobile primary action reachable without desktop-only affordances;
- core journey E2E expectations using user-goal language.

Do not create brittle DOM-count tests for every element. Test semantic contracts.

## 14. Instrumentation

Use existing UX telemetry to measure:

- time to first meaningful action;
- primary action usage;
- advanced disclosure opens;
- repeated backtracking;
- abandonment by workflow stage;
- launcher vs navigation entry;
- retry/failure frequency.

Add a small set of derived product signals:

- "action ambiguity": secondary action used immediately after visiting a page without using the recommendation;
- "navigation recovery": user leaves a task and opens Search/Launcher within a short window;
- "deep-detail dependency": advanced detail must be opened before common tasks can be completed.

Telemetry must not record private creative text or raw launcher queries when normalized categories are sufficient.

## 15. Accessibility

The simplification must improve accessibility rather than only aesthetics.

Required:

- semantic heading order;
- keyboard-complete flows;
- visible focus;
- correct dialog/sheet focus return;
- real tabs only where content views switch;
- minimum touch targets;
- no color-only state;
- reduced-motion support;
- primary action remains reachable at mobile width;
- concise error copy with recovery action.

## 16. Implementation boundaries

This program may:

- restructure core Studio page composition;
- introduce shared UX primitives;
- split oversized UI components when necessary;
- move secondary capabilities into focused child surfaces/inspectors;
- tighten copy;
- extend semantic UX tests and telemetry.

This program should not:

- redesign backend domain architecture unless a UI contract cannot be expressed safely otherwise;
- remove expert capabilities;
- weaken mastering/distribution/rights/autonomy safety gates;
- create a chat-first product;
- rebuild the Atlas public website;
- introduce a second competing navigation model;
- create new product features unrelated to comprehension and task completion.

## 17. Migration strategy

Implement by journey, not by page family.

Recommended order:

1. Track + Mastering
2. Grow
3. Release
4. AutoMix
5. Music / Add music
6. Today
7. Create
8. mobile consolidation
9. specialist route containment
10. telemetry and final acceptance

Each journey must be usable at the end of its slice.

Do not wait for a final global polish pass to make individual journeys coherent.

## 18. Definition of done

The recovery program is done when:

- the ten canonical journeys have screenshot-backed audits;
- Track, Grow and Release no longer present capability dashboards by default;
- core task surfaces meet the action and section complexity budgets;
- common workflows are staged when they require multiple decisions;
- advanced capabilities remain reachable but do not dominate normal use;
- default copy is concise and artist-facing;
- desktop and mobile preserve the same mental model;
- semantic regression tests protect the new interaction contracts;
- existing safety and domain behavior remain green;
- dogfooding no longer requires remembering where features live.

## 19. Current evidence and limitations

Repository inspection on 2026-10-04 shows that V5 has strong architectural intent and extensive behavior tests, but several core surfaces remain structurally dense. This design intentionally treats those code-level signals as a reason to audit, not as a substitute for a visual usability audit.

The screenshot-backed audit must use a legitimate authenticated Studio session. No auth bypass should be added for UX testing.

## 20. Decision

Proceed with a **V5 human-factors recovery**, not a new product architecture.

The core principle is:

> Ensemblis may be powerful internally, but each moment of use should feel like one understandable decision.
