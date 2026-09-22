# Ensemblis UX Architecture V4

**Status:** Canonical artist-facing interaction architecture  
**Supersedes:** `docs/ensemblis-ux-architecture-v3.md`  
**Scope:** Ensemblis Studio  
**Date:** 2026-09-23

## 1. Why V4 exists

Ensemblis has reached a point where capability is no longer the main product problem. The system can understand music, manage releases, create media, plan growth, connect local DJ libraries, build mixes, distribute, analyze outcomes and automate work.

The user experience has not compressed that capability enough.

The current product often exposes one of two failure modes:

1. **Capability as destination:** a feature gets its own route, page or panel and the user must know where it lives.
2. **Capability hidden by navigation cleanup:** the feature remains operational but becomes difficult to discover because it is buried in a deep route, disclosure, footer action, More menu or specialist page.

The result is a product that is technically powerful but cognitively expensive. A user can know exactly what they want to accomplish and still not know where to start.

V4 changes the interaction model, not merely the navigation labels or visual polish.

The canonical principle is:

> **A user should never need to know how Ensemblis is organized in order to use Ensemblis.**

Ensemblis should become more capable while the visible interface becomes smaller, more contextual and more obvious.

## 2. North star

The user should be able to open Ensemblis and immediately answer:

1. What can I do right now?
2. What was I already working on?
3. What needs my judgment?
4. What is Ensemblis handling for me?
5. Where is the music, release, mix or asset I care about?

The product should feel like a calm creative operating system, not a collection of feature pages.

The target compression is:

```text
many internal capabilities
        ↓
context + object + state
        ↓
a few useful actions right now
```

The interface should surface the right action from the current context rather than force the user to remember a product map.

## 3. Canonical mental model

V4 is built around four layers:

1. **Workspaces** — stable places for broad intent.
2. **Objects** — the things the artist actually works on.
3. **Actions** — what the artist wants to do to those objects.
4. **Workflows** — guided sequences when an action has multiple meaningful stages.

Internal engines, providers, data models and background jobs support these layers but do not define the default UX.

### 3.1 Workspaces

The durable primary workspaces are:

- **Today** — current intent, continuation, decisions and autonomous work.
- **Music** — tracks, releases, mixes and the artist's source material.
- **Grow** — opportunities, audience, performance and growth actions.

**Create is a global action, not a primary workspace.**

Cross-cutting utilities such as Library, Sites and Settings remain reachable through More, search and contextual links, but they do not compete with the three primary workspaces.

This resolves the previous documentation split between a five-destination model and the current three-workspace implementation.

### 3.2 Objects

Objects are the center of interaction.

Canonical artist-facing object types include:

| Object | What it represents | Typical actions |
| --- | --- | --- |
| Track | A specific recording/master | Play, analyze, master, create, mix, add to release |
| Release | A release Mission and its connected work | Continue, review, distribute, promote, inspect results |
| Mix | A DJ/AutoMix project and its render lineage | Continue, preview, revise, render, download |
| Creative Asset | A finished or in-progress media deliverable | Preview, revise, publish, reuse |
| Growth Opportunity | An actionable artist-growth opportunity | Review, prepare, approve, dismiss |
| Campaign | A bounded execution object when campaign detail is genuinely needed | Review, approve, inspect performance |
| Site / Smart Link | An owned destination | Preview, edit, publish, inspect traffic |

A route may exist for implementation reasons without becoming a first-class object in the user's mental model.

### 3.3 Actions

Actions use human intent language.

Prefer:

- Add music
- Analyze this track
- Master this
- Create from this moment
- Make a DJ mix
- Prepare this release
- Promote this release
- Publish this
- Connect my library

Avoid making the default action language describe implementation:

- Open analyzer
- Run campaign engine
- Open distribution subsystem
- Configure provider
- Open Track Intelligence V4
- Start render worker

### 3.4 Workflows

A workflow is used when an action requires multiple meaningful decisions or stages.

A workflow should:

- have a clear start and finish;
- show the current stage;
- keep the relevant object visible;
- ask only for information needed at the current stage;
- hide specialist controls until they become relevant;
- preserve user choices exactly;
- allow safe exit and continuation;
- expose autonomous processing without forcing the user to watch it.

Examples:

- AutoMix
- Release preparation and distribution
- Video Director
- Paid growth launch
- First-use music intake

A workflow is not a long page containing every possible panel.

## 4. Global interaction architecture

### 4.1 Shell

The stable shell is:

```text
Desktop
┌──────────────┬─────────────────────────────────────┐
│ Today        │ context / search / create           │
│ Music        ├─────────────────────────────────────┤
│ Grow         │ current object or workflow          │
│              │                                     │
│ More         │                                     │
└──────────────┴─────────────────────────────────────┘

Mobile
┌────────────────────────────────────────────────────┐
│ context / object                                   │
│                                                    │
│ workspace                                          │
│                                                    │
├────────────────────────────────────────────────────┤
│ Today        Music        Grow        More         │
└────────────────────────────────────────────────────┘
```

The shell provides location, global discovery and global actions. It does not become another feature directory.

### 4.2 Action Launcher

The Action Launcher is a first-class interaction, not merely a keyboard command palette.

It answers:

> **What do you want to do?**

It accepts both search and action intent.

Examples:

- "make a DJ mix"
- "upload a track"
- "promote Dancing In Color"
- "continue Night Signal"
- "connect Rekordbox"
- "show my latest release"

The launcher resolves intent into:

1. a direct action when context is sufficient;
2. a small choice when multiple objects match;
3. the correct workflow entry point;
4. a relevant object result;
5. a specialist destination only when the user explicitly asks for it.

The existing command palette is the implementation seed, but V4 expands its product role from navigation shortcut to universal discovery and action entry.

### 4.3 Contextual action bar

Every object workspace exposes a bounded set of relevant actions.

Example Track header:

```text
Night Signal
03:42 · 122 BPM · F minor · Ready

[ Play ]  [ Create ]  [ Master ]  [ Mix ]  [ ••• ]
```

The user should not have to navigate away from a Track merely to discover what can be done with it.

### 4.4 Continue / Recents

The shell and Today should surface recent meaningful work:

- mix in progress;
- release being prepared;
- track analysis completed;
- video project awaiting review;
- unfinished connection setup.

This reduces reliance on navigation memory.

## 5. Today V4

Today remains the operating surface, but its first job becomes **orientation and action discovery**.

Default composition:

### 5.1 Action Launcher

Prominent but compact:

```text
What do you want to do?
[ Search or tell Ensemblis what you need… ]
```

Optional quick actions should be contextual, not static feature shortcuts.

Examples:

- Add music
- Make a mix
- Prepare next release

Only show quick actions that are currently valid and useful.

### 5.2 Continue

Show up to a small bounded set of recent or active objects.

Example:

```text
Continue

AutoMix: Berlin Late Night
Planning complete · ready to review
[ Continue ]

Night Signal
Analysis complete
[ Open track ]
```

### 5.3 Needs You

Only decisions that require human judgment, approval, cost, rights confirmation, destructive ambiguity or sensitive external action.

### 5.4 Ensemblis is handling

Compact background status. Do not expose internal job inventories.

### 5.5 Coming up

Only artist-relevant near-term events.

### Today rule

Today must not become a comprehensive dashboard. It should help the user start, continue or decide.

## 6. Music V4

Music is the home of music objects, not a page that tries to show every music capability.

Default hierarchy:

1. Search / filter music
2. Continue relevant music work
3. Tracks
4. Releases
5. Mixes
6. contextual Add action

Tracks, Releases and Mixes may use segmented views or tabs when density requires it. They should not require separate conceptual navigation models.

### 6.1 Track object

A Track page is the canonical surface for a recording.

Default visible content:

- identity and playback;
- readiness/status;
- a compact Music Intelligence summary;
- Best Moments;
- release relationship;
- current production/master state;
- relevant next actions.

Example widget composition:

```text
Night Signal                                  •••
━━━━━━━━━━━━━━━━●━━━━━━━━━━━━━━━━━━━━━━
1:34 / 3:42

122 BPM      F minor      Energy: rising

[ Create ] [ Master ] [ Mix ]

Best Moments
• Best Hook       01:14–01:27    [▶]
• Energy Moment   02:41–02:55    [▶]

Release
Dancing In Color · May 18
```

Detailed analysis, confidence, stems diagnostics, calibration and model provenance belong in an inspector or Advanced disclosure.

### 6.2 Release object

A Release remains a hero object / Mission.

Default facets:

- Overview
- Music
- Creative
- Promotion
- Distribution
- Results

The release header remains visible while moving between facets.

The user should never need to leave the Release object to understand normal release work.

### 6.3 Mix object

Mixes become explicit objects rather than only AutoMix jobs.

A Mix stores the user-facing identity of:

- selected source/library;
- purpose and intent;
- selected tracks;
- verified order;
- transitions;
- render state;
- output;
- revision lineage.

The underlying AutoMix job model may remain unchanged initially. The UI projects it as one coherent Mix.

## 7. Create V4

Create is an action invoked from context.

Default questions are:

1. **What do you want to make?**
2. **What should it use?**

When launched from an object, the source is already known whenever possible.

Examples:

- Track → Create
- Best Moment → Create
- Release → Create
- Asset → Create variation

The default result is a bounded set of useful outcomes, not a directory of engines.

Specialist creation tools remain available through:

- More actions;
- Advanced;
- explicit launcher queries;
- object-specific inspectors.

The compatibility route `/studio/create` may remain as a generalized Create launcher, but the product should not depend on the user knowing that destination.

## 8. Grow V4

Grow answers:

- What is working?
- What opportunity matters?
- What should I do next?
- What is Ensemblis already preparing?

Default sections:

- Recommended action
- Opportunities
- Audience
- Performance

Campaign internals, paid media configuration, outreach sequence machinery and learning diagnostics are contextual tools, not the default hierarchy.

Metrics without a decision or interpretation should not dominate the page.

## 9. Product widgets

V4 introduces a product-widget layer above generic design-system primitives.

Primitives such as Button, Panel, Status, Tabs and Disclosure remain canonical. Widgets compose them around recognizable artist objects and actions.

### 9.1 Widget families

#### Object Summary

Used for Track, Release, Mix, Asset and Opportunity summaries.

Properties:

- identity;
- meaningful state;
- one primary action;
- optional compact secondary actions;
- no long explanatory copy.

#### Player Widget

A consistent compact audio/video playback surface with source identity and relevant markers.

#### Insight Widget

Turns analysis into a small human-readable result.

Examples:

- 122 BPM · F minor · rising energy
- strongest moment 01:14–01:27
- vocals enter after 00:42

Raw analysis belongs behind Advanced.

#### Progress Widget

Represents a user-recognizable process.

Examples:

- release readiness;
- mix workflow;
- video production;
- upload and analysis.

Do not map every backend job to a visible progress item.

#### Connection Widget

Represents external/local readiness in one compact surface.

Example:

```text
Yotam's PC
● Connected
1,842 tracks · Rekordbox synced 2m ago
[ Open library ]
```

Pairing IDs, credentials, source revisions and recovery mechanics remain Advanced unless required.

#### Decision Widget

One decision, why it matters and the action required.

#### Continue Widget

A resumable object/workflow with current state.

#### Empty-State Widget

Explains the missing prerequisite and provides the correct first action.

### 9.2 Widget rules

A widget should:

- be understandable without reading documentation;
- communicate state visually and textually;
- provide a clear action when one exists;
- avoid duplicating nearby page headings;
- avoid embedding technical implementation terminology;
- remain useful at narrow widths;
- use canonical domain state rather than introducing parallel state.

## 10. Progressive disclosure model

V4 defines four disclosure levels.

### Level 0 — Action

What the user can do now.

Examples:

- Continue mix
- Add music
- Approve master

### Level 1 — Context

Enough information to make the action understandable.

Examples:

- which track;
- current release;
- render state;
- why approval is needed.

### Level 2 — Detail

Optional product detail.

Examples:

- transition choices;
- Moment evidence;
- distribution destinations;
- campaign rationale.

### Level 3 — Technical / Advanced

Implementation and diagnostic detail.

Examples:

- provider/model;
- analysis versions;
- confidence components;
- source revisions;
- plan hashes;
- worker state;
- raw diagnostics.

The default interface should primarily live at Levels 0 and 1.

### Progressive disclosure rule

Do not merely hide complexity under a generic `<details>` block.

The hidden information must have a clear reason to be opened:

- Why this?
- Advanced settings
- Technical details
- Connection details
- Edit metadata

## 11. Inspector model

Desktop uses a contextual right-side inspector for secondary settings that should not replace the current object.

Mobile uses a full-height sheet.

Good inspector candidates:

- Track technical analysis
- DJ preference tuning
- Release metadata
- Generation/provider controls
- Distribution metadata
- Asset metadata
- Connection diagnostics
- Advanced AI policy

An inspector should preserve the user's visual context and close back to the exact object/workflow state.

## 12. AutoMix V4 — canonical reference workflow

AutoMix is the first reference implementation for the V4 interaction architecture because the existing page exposes multiple distinct capabilities as one long vertical surface.

### 12.1 Entry points

AutoMix must be discoverable from:

- Action Launcher → "Make a DJ mix"
- Music → Mixes → New mix
- multi-select Tracks → Mix
- Track → Mix
- eligible Release → Mix
- Continue card for an existing Mix

The user should not need to know that AutoMix lives under `/studio/music/automix`.

### 12.2 Workflow

Canonical stages:

```text
1. Music → 2. Intent → 3. Build → 4. Review → 5. Render
```

#### Stage 1 — Music

Choose or confirm source.

Examples:

```text
Where should the music come from?

● This computer
  Yotam's PC · Connected · 1,842 tracks

○ Ensemblis catalog
  14 mastered tracks

[ Continue ]
```

If the local computer is not connected, show one recovery widget:

```text
Connect your music library
Use Ensemblis Desktop to analyze and render with this computer.
[ Connect computer ]
```

Do not show Library Bridge internals by default.

#### Stage 2 — Intent

Ask user-facing musical questions.

Examples:

- Purpose: Club set / SoundCloud / Warm-up / Peak time / Discovery
- Length
- Energy direction
- optional starting/ending track
- optional "surprise me"

DJ preference learning influences defaults quietly.

#### Stage 3 — Build

Ensemblis proposes the set.

Show:

- selected tracks;
- estimated duration;
- order;
- obvious locks;
- high-level compatibility warnings.

Allow:

- reorder;
- remove;
- lock;
- regenerate around locked choices.

Do not lead with transition-engine terminology.

#### Stage 4 — Review

Show the actual verified musical plan.

This is where transition detail becomes useful:

- waveforms;
- transition windows;
- transition preview;
- technique;
- confidence/risk when meaningful;
- user override.

Technical planning metrics remain Advanced.

#### Stage 5 — Render

Show a compact final summary and one primary action.

```text
Ready to render

42:18 · 8 tracks · 7 transitions
This computer: Yotam's PC

[ Render mix ]
```

Rendering becomes a resumable state. The user can leave.

When complete:

- play;
- download;
- create revision;
- use/share where relevant.

### 12.3 What happens to current AutoMix panels

| Current panel/capability | V4 destination |
| --- | --- |
| Personal DJ Intelligence | Advanced DJ Preferences inspector / Settings |
| Library Bridge | Connection Widget + connection inspector |
| Rekordbox XML | Desktop/library setup advanced import path |
| Local Set Builder | canonical Mix workflow source/build implementation |
| Cloud Set Builder | same canonical Mix workflow with different source/runtime |
| Render Recovery | contextual error/recovery state inside Render stage |

No capability must be removed merely because it is removed from the default page.

## 13. Copy architecture

Text should support the UI, not substitute for it.

### Rules

- Prefer labels, state and action over explanatory paragraphs.
- Default explanatory copy should usually fit in one sentence.
- A second sentence is acceptable when it materially changes the user's decision.
- Product philosophy does not belong in routine task flows.
- Provider, policy and implementation explanations belong behind Why / Info / Advanced unless needed for consent or safety.
- Buttons use verbs and outcomes.
- Empty states explain the next step, not the architecture.
- Technical guarantees may remain visible when they protect trust, money, rights or irreversible actions.

Bad:

> Bring in the artist's existing master. AI music creation is disabled for this artist. Ensemblis will work from the artist's real source material.

Better:

```text
Add mastered track
AI music is off for this artist.  [Why?]
```

## 14. Page composition rules

Canonical pages should feel like workspaces, not documents.

### Required hierarchy

1. Object/workspace identity
2. primary action or current state
3. core interactive content
4. contextual detail
5. advanced detail

### Heuristics

- One visually dominant action at a time.
- Do not stack unrelated specialist tools vertically.
- Do not require scrolling through explanatory content to discover the primary action.
- Prefer tabs/segments when sections represent alternate views of the same object.
- Prefer workflow steps when sections represent sequential decisions.
- Prefer inspector/sheet when controls modify the current object.
- Prefer dialog for short bounded confirmation or creation.
- Prefer a separate specialist page only when the task is genuinely a sustained specialist workspace.
- Avoid card soup. Use cards/widgets for meaningful objects, not every grouping.
- Long histories should paginate, virtualize or summarize.
- If a primary task routinely requires more than a few screenfuls, redesign the composition rather than relying on collapse controls.

## 15. Discoverability contract

A capability is considered discoverable when at least one natural intent path reaches it without product-map knowledge.

Every meaningful capability must have at least one of:

- Action Launcher intent;
- contextual object action;
- workflow step;
- obvious workspace action;
- More/Settings destination when it is truly configuration.

Specialist deep links do not count as discoverability by themselves.

### Discoverability test

Give a user a goal rather than a route:

- "Make a mix from these tracks."
- "Master this song."
- "Connect my Rekordbox library."
- "Promote this release."
- "Find the strongest part of this track."

If the user must know an Ensemblis feature name or route to succeed, the capability fails the V4 discoverability contract.

## 16. Navigation contract

Primary navigation is intentionally small:

- Today
- Music
- Grow

Global:

- Search / Action Launcher
- Create
- Needs You when relevant
- active artist context

More:

- Library
- Sites
- Settings

Routes such as Releases, Video, Distribution, Campaigns, Audience, Connections, Memory and Data Health may continue to exist, but route existence does not imply primary navigation ownership.

### Route ownership

Every specialist route declares a visible parent and object context.

Examples:

- Release → Music
- AutoMix → Music / Mix object
- Video Director → Create action / Creative Asset
- Campaign → Grow or Release Promotion
- Distribution → Release
- Connections → Settings
- Data Health → contextual recovery / Settings

## 17. Mobile contract

Mobile is not a compressed desktop page.

Rules:

- Bottom navigation remains Today / Music / Grow / More.
- Object actions remain reachable without scrolling to page end.
- Inspectors become sheets.
- Workflow steps use horizontally compact progress or a step title with Previous/Next.
- Dense tables become object rows/cards.
- Hover-only affordances are prohibited.
- Touch targets meet the canonical design-system accessibility contract.
- Action Launcher is directly reachable.
- Audio preview remains usable while navigating within an object/workflow when technically feasible.

## 18. Trust and state

V4 does not weaken Ensemblis safety boundaries.

### Trust rules

- Visible user choices are durable.
- External effects remain approval/autonomy-contract governed.
- Spending remains explicit.
- Rights/legal declarations remain explicit.
- Unknown state is shown as unknown rather than inferred.
- Measured evidence and recommendation are visually distinguishable.
- Background work remains visible but quiet.
- Failures appear where they block the current object or workflow.
- Recovery actions explain what will and will not change.

### State rule

Widgets and workflows project canonical domain state.

Do not create parallel UI-only task/readiness databases merely to support the new interaction layer.

## 19. Design-system additions

The existing primitive layer remains canonical.

V4 adds a small composition vocabulary above it.

Proposed reusable components:

- `ActionLauncher`
- `ContinueWidget`
- `ObjectSummaryWidget`
- `ObjectActionBar`
- `WorkflowShell`
- `WorkflowStepper`
- `ContextInspector`
- `ConnectionWidget`
- `InsightWidget`
- `DecisionWidget`
- `ProgressWidget`
- `PlayerWidget`
- `ObjectPicker`
- `RecentObjects`

These are composition patterns, not permission to create another visual system.

They must use:

- `components/studio/ui.tsx`;
- canonical form controls;
- Design System tokens;
- canonical accessibility behavior.

Feature-specific CSS Modules remain appropriate for unique geometry such as waveforms and transition visualizations.

## 20. Implementation architecture

The interaction reset should not require rewriting the backend.

### Keep

- canonical artist context;
- existing domain tables;
- existing provider/runtime boundaries;
- AutoMix jobs and worker contract;
- Track Intelligence;
- Moments;
- Missions;
- Needs You;
- autonomy contracts;
- release workspace read models;
- existing deep routes where operationally useful.

### Add

A thin interaction/read-model layer that answers:

- what objects should the user see?
- what actions are valid for this object/state?
- what should be continued?
- what workflow stage is current?
- what contextual recovery is required?

Prefer deep modules with small interfaces, consistent with repository architecture.

Example direction:

```text
Route
  ↓
Object / Workflow read model
  ↓
canonical domain state
  ↓
widget/workflow composition
```

Do not move cross-domain orchestration into React components.

## 21. Migration plan

This migration is intentionally incremental and compatibility-safe.

### Phase 0 — UX contracts and inventory

Goal: stop adding new complexity while migration begins.

Deliver:

- make V4 canonical;
- add regression tests for navigation ownership;
- document widget/workflow/inspector rules;
- inventory specialist routes and assign each:
  - workspace parent;
  - object owner;
  - default discoverability path;
  - V4 destination;
- add a rule that new capabilities need an intent/discoverability path before shipping.

Exit criteria:

- every current Studio route has an explicit V4 ownership classification;
- no new top-level feature destination is introduced.

### Phase 1 — Global discovery and continuation

Goal: users can start or resume work without knowing navigation.

Deliver:

- Action Launcher V1;
- unified object/action search;
- Continue widgets on Today;
- recent meaningful objects;
- contextual quick actions;
- preserve keyboard command palette behavior.

Exit criteria:

- common actions Add music, Create, Make a mix, New release and Connect library are reachable from plain-language launcher queries;
- recent active work can be resumed from Today.

### Phase 2 — Music object model

Goal: Track, Release and Mix become visible first-class objects.

Deliver:

- Music segmented object view;
- Track Object Header + Action Bar;
- compact Intelligence/Best Moments widgets;
- Mix object projection;
- contextual Create/Master/Mix actions;
- advanced Track details move to inspector/disclosure.

Exit criteria:

- a Track user can discover its major valid actions without leaving the Track;
- Releases and Mixes are discoverable from Music without route knowledge.

### Phase 3 — AutoMix reference workflow

Goal: replace the long DJ & Mixes page with the canonical V4 workflow.

Deliver:

- Mix object;
- Source → Intent → Build → Review → Render workflow;
- Connection Widget;
- local/cloud runtime abstracted behind source/runtime state;
- DJ Intelligence moved to advanced preferences;
- Rekordbox setup moved to connection/import setup;
- render recovery moved into Render stage;
- existing deep route redirects or renders the new workflow.

Exit criteria:

- a first-time user can start a mix from Today or Music;
- no default AutoMix screen stacks the six legacy panels;
- current functionality remains reachable;
- local processing state is explicit and understandable.

### Phase 4 — Release + Create convergence

Goal: keep work attached to Release/Track context.

Deliver:

- Release Object Header;
- consistent release facets;
- Create action sheet/launcher from Track, Moment and Release;
- production items represented as Creative Assets;
- specialist provider settings moved to inspectors;
- distribution stays inside Release context.

Exit criteria:

- normal release preparation does not require jumping between disconnected product areas;
- Create never requires the user to select an engine before selecting an outcome.

### Phase 5 — Grow convergence

Goal: replace toolbox/dashboard behavior with decisions and opportunities.

Deliver:

- opportunity widgets;
- performance interpretation;
- audience summary;
- contextual campaign/paid/outreach actions;
- specialist controls move one level deeper.

Exit criteria:

- Grow leads with recommended action/opportunity rather than metrics inventory;
- campaign internals are accessible without defining the default mental model.

### Phase 6 — Specialist-page retirement and cleanup

Goal: reduce duplicate interaction systems.

Deliver:

- remove obsolete duplicate navigation;
- retire compatibility pages that no longer serve a specialist need;
- collapse duplicated settings;
- reduce legacy CSS ownership route by route;
- consolidate repeated widgets/components;
- update docs and tests.

Exit criteria:

- no user-facing capability depends on remembering a legacy route;
- specialist routes that remain have a documented reason.

## 22. Validation strategy

V4 needs behavioral UX contracts, not only visual review.

### Automated contracts

Add tests for:

- canonical primary navigation;
- route ownership;
- Action Launcher command registry;
- object action availability;
- exact object/artist lineage;
- workflow stage persistence;
- specialist controls absent from default surfaces;
- mobile reachability;
- accessibility behavior;
- safety/approval boundaries.

### Browser smoke scenarios

Minimum canonical scenarios:

1. New user → add mastered track → understand track → create from Moment.
2. Existing user → open Today → continue recent Release.
3. Existing user → launcher "make a DJ mix" → choose music → build → review → render.
4. Track → Master.
5. Track → Mix.
6. Release → Distribution.
7. Release → Create.
8. Grow → opportunity → prepare action.
9. Disconnected local library → AutoMix → connect computer recovery.
10. Failed render → Mix → safe retry.

### Qualitative dogfood questions

For every migrated workflow:

- Can a user start from their goal instead of the feature name?
- Is the next action visually obvious?
- Is there only one dominant action?
- Can the user understand state without reading a paragraph?
- Are advanced controls absent until requested?
- Can the user safely leave and resume?
- Does the object remain the center of context?

## 23. Success metrics

Product analytics should measure whether V4 actually reduces confusion.

Useful signals:

- launcher action success rate;
- time from landing to first meaningful action;
- percentage of sessions using Continue;
- backtracking between workspaces before action;
- abandonment before workflow Stage 2;
- repeated visits to navigation/search without action;
- successful AutoMix completion;
- specialist Advanced opens;
- error/recovery completion;
- mobile workflow completion.

Do not optimize for raw feature-page visits. Fewer specialist-page visits can be a success if users complete the same goals through contextual workflows.

## 24. Documentation governance

This file is the canonical artist-facing interaction architecture.

Related documents:

- `docs/ensemblis-design-system.md` remains the visual-system authority.
- `docs/ensemblis-product-roadmap.md` remains the product execution roadmap.
- `docs/ensemblis-ux-architecture-v3.md` is historical/superseded.
- `docs/ux-audit-remediation.md` records completed remediation and remains historical evidence.

When implementation changes durable interaction architecture, update this document in the same PR.

## 25. Rejection rules

A future change should be redesigned unless there is a strong documented reason if it:

- adds a new primary workspace;
- requires users to know an internal feature name to find a common action;
- adds a long specialist panel to a default object page;
- exposes provider/model controls before user intent;
- creates a new full page where an inspector, workflow stage or contextual widget would preserve context better;
- hides a capability without adding an alternative discovery path;
- stacks unrelated tools vertically and calls that a workspace;
- adds explanatory paragraphs where state/action UI can communicate the same thing;
- creates a new UI-only readiness/task state parallel to canonical domain state;
- makes the user leave a Track, Release, Mix or Asset for normal work on that object;
- promotes an engine, integration or database domain into the artist's primary mental model;
- introduces a feature-specific visual language instead of using the canonical Design System;
- adds an action without specifying how a user discovers it from intent or context.

## 26. Definition of done for V4

V4 is not complete when every legacy route has been deleted.

It is complete when:

- users can start common work from intent;
- Tracks, Releases, Mixes and Creative Assets feel like coherent objects;
- normal actions are available contextually;
- multi-step work is guided by workflows rather than long pages;
- widgets communicate state without long copy;
- advanced capability remains available without dominating the default experience;
- local/cloud implementation differences do not force different mental models;
- Today helps users start, continue and decide;
- Music feels like a working catalog rather than a feature hub;
- Grow feels like guidance rather than an analytics toolbox;
- the app can gain new internal capability without automatically gaining new navigation or visible complexity.

The durable direction is:

> **Ensemblis gets smarter. The interface gets smaller. The user's intent stays in the center.**
