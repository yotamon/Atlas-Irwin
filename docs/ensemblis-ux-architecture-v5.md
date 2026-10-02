# Ensemblis UX Architecture V5

**Status:** Canonical target architecture — implemented in draft PR #280; authenticated browser acceptance pending
**Supersedes:** `docs/ensemblis-ux-architecture-v4.md` after the V5 PR merges
**Scope:** Ensemblis Studio artist-facing experience
**Date:** 2026-10-02

## 1. Why V5 exists

V4 corrected the broad information architecture: Today / Music / Grow became the stable primary workspaces, Create became a global action, objects became more important than feature routes, and specialist tooling moved behind progressive disclosure.

Dogfooding still exposes a deeper usability problem: **the visible shell is simpler, but the product still leaks too much of its internal capability map once the user enters a workspace or object.**

The remaining failure modes are:

1. **Intent still becomes navigation.** The user often knows the goal but must translate it into a route, subsystem or product term.
2. **Objects still become long pages.** Track, Music and Growth can expose many valid capabilities at once instead of ranking the next useful action.
3. **The Action Launcher over-promises.** It looks like a natural-language intent surface but is primarily command keyword matching plus object search.
4. **Internal vocabulary appears too early.** Terms such as Track Intelligence, Moments, Mission, evidence, lineage, provider and bounded experiment are useful internally but increase cognitive load when they lead the default experience.
5. **Progressive disclosure sometimes means â€œmore sections lower on the page.â€** Advanced controls are hidden, but the default page can still require too much reading and scrolling.
6. **A calm Today cannot compensate for complex downstream journeys.** The whole product must preserve orientation after the first click.

V5 therefore changes the interaction contract:

> **The artist states the goal. Ensemblis resolves the relevant object, explains the next useful action, and keeps complexity behind context.**

The product should feel knowledgeable, not merely organized.

## 2. North star

A user should be able to open Ensemblis and complete common work without knowing where a feature lives.

The canonical interaction loop becomes:

```text
intent
  â†“
relevant object
  â†“
current state
  â†“
one recommended action
  â†“
guided workflow when needed
  â†“
outcome
```

Navigation remains available, but it is a fallback and orientation system rather than the primary way users discover capabilities.
## 3. Product success criteria

V5 is successful when a normal artist can:

- say or search for a goal in plain language and reach the correct object/action;
- understand what matters on a Track or Release without reading an entire page;
- resume unfinished work from Today without reconstructing context;
- enter Music and find Tracks, Releases or Mixes without scanning an inventory-first dashboard;
- enter Grow and understand the recommended action before seeing supporting metrics;
- move through multi-stage work with one visible current stage and one dominant next action;
- reach specialist controls without those controls defining the default mental model;
- use the same conceptual model on desktop and mobile.

The default interface should answer, in order:

1. **What is this?**
2. **What state is it in?**
3. **What should I do next?**
4. **Why?**
5. **What else can I do?**
6. **Show me technical detail only if I ask.**

## 4. Canonical mental model

V5 keeps V4's object model but makes the hierarchy stricter.

### 4.1 Intent

Intent is what the artist wants to accomplish, expressed in human language.

Examples:

- â€œmaster Love Like Thisâ€
- â€œmake a reel from my latest trackâ€
- â€œprepare Funkable for releaseâ€
- â€œmake a DJ mix from these tracksâ€
- â€œwhat should I work on today?â€
- â€œis this release ready?â€
- â€œhow is Dancing In Color doing?â€

Intent may resolve to:
- a direct object action;
- an object plus a guided workflow;
- a small disambiguation choice;
- an explanatory answer plus action;
- a safe specialist destination only when the goal genuinely requires it.

### 4.2 Objects

Canonical artist-facing objects remain:
- Track
- Release
- Mix
- Creative Asset
- Growth Opportunity
- Campaign when deep campaign work is necessary
- Site / Smart Link

The user should recognize the object before they recognize the subsystem.

### 4.3 Actions

Actions are verbs applied to objects.

Preferred:
- Play
- Master
- Create
- Mix
- Prepare release
- Promote
- Publish
- Review
- Connect
- Retry

Avoid default action copy that exposes implementation:
- Run worker
- Open analyzer
- Recompute intelligence
- Sync provider
- Open engine
- Inspect lineage

### 4.4 Workflows

A workflow is used only when an action requires multiple meaningful decisions.

Every workflow must:
- show the current stage;
- show what is already complete;
- expose one primary next action;
- keep the source object visible;
- preserve safe exit and resume;
- move technical diagnostics behind â€œWhy?â€, â€œDetailsâ€ or â€œAdvancedâ€;
- allow background processing without requiring the user to watch it.

### 4.5 Evidence and explanation

Evidence supports a recommendation; it is not the primary navigation model.

The default sequence is:
```text
recommendation â†’ short reason â†’ optional evidence â†’ technical detail
```

not:
```text
metrics â†’ scores â†’ diagnostics â†’ user interprets â†’ action
```
## 5. Global shell

The stable primary shell remains intentionally small.

### Desktop
- Today
- Music
- Grow
- contextual Search / Action Launcher
- Create global action
- More: Library, Sites, Settings

### Mobile
Persistent bottom navigation:
- Today
- Music
- Grow
- Search / Action
- More

Create must remain one-tap reachable from relevant object/context surfaces even when it is not a permanent bottom-nav destination.

### Shell rule

The shell answers **where am I?** and **what can I do globally?**

It must not expose every subsystem.

## 6. Action Launcher V5

The Action Launcher becomes a real intent interface rather than a command directory with natural-language styling.

### 6.1 Input contract

The user can type:
- an action;
- an object;
- an action + object;
- a status question;
- a continuation request.

Examples:
- â€œmaster Night Signalâ€
- â€œmake a reel from Love Like Thisâ€
- â€œlatest releaseâ€
- â€œcontinue my mixâ€
- â€œwhat needs me?â€
- â€œis Funkable ready to release?â€
- â€œconnect Rekordboxâ€

### 6.2 Resolution pipeline

The launcher should resolve in layers:

1. deterministic high-confidence command aliases;
2. artist-scoped object search;
3. intent + object composition;
4. constrained semantic intent resolution when deterministic matching is insufficient;
5. disambiguation only when multiple valid targets remain.

The semantic resolver must return structured intent, object candidates and confidence. It must never directly execute consequential external actions.

### 6.3 Result types

Launcher results should render as actions, not search rows only:

- **Do this now** â€” direct valid action on a resolved object;
- **Continue** â€” resume an in-progress workflow/object;
- **Open** â€” object result;
- **Answer + action** â€” status/readiness query with a concrete next step;
- **Choose one** â€” bounded disambiguation.

### 6.4 Safety

Launcher intent can navigate, prepare or propose.

It cannot silently:
- publish;
- spend money;
- submit distribution;
- confirm rights;
- contact people;
- perform destructive actions.

Existing autonomy and approval contracts remain authoritative.
## 7. Today V5

Today is the operating surface, not a dashboard.

Canonical order:

1. Action Launcher
2. Continue
3. one Priority / Needs You card
4. everything else collapsed into â€œEnsemblis is handlingâ€ and â€œComing upâ€

### Rules

- one dominant action above the fold;
- maximum three Continue objects;
- do not duplicate the same decision in multiple sections;
- background work should summarize user-recognizable outcomes, not jobs;
- if nothing needs action, the calm state is a successful state;
- Today may answer â€œwhat should I do?â€ directly.

## 8. Music V5

Music becomes an object library first, not an inventory dashboard.

Canonical structure:

1. search / filter
2. Continue or Needs attention
3. segmented object switcher: Tracks / Releases / Mixes
4. object list/grid
5. contextual Add action

Remove default emphasis on summary counters unless they answer a decision.

### Tracks view
Each row/card should show:
- title;
- playable source when available;
- human-readable state;
- one primary action or â€œOpenâ€;
- compact secondary status only when meaningful.

### Releases view
Release cards show:
- artwork / title;
- release date / lifecycle;
- readiness summary;
- one next action.

### Mixes view
Mix cards show:
- name;
- source/track count;
- workflow stage;
- render state;
- Continue / Play / Download as appropriate.

### Music rule

The user should not need to scroll past every catalog track to reach the music they are actively working on.

## 9. Track V5

A Track page should feel like one object, not a vertical collection of audio subsystems.

Default visible hierarchy:

1. identity + player
2. readiness / current state
3. primary action bar: Create / Master / Mix + context-specific action
4. Best sections / useful moments
5. release relationship
6. compact analysis summary

### Secondary detail

Move these behind contextual inspectors/disclosures unless currently blocking:
- detailed Track Intelligence;
- full mastering engineering report;
- stems diagnostics;
- lyric provenance/permissions;
- confidence components;
- model/provider/version metadata.

### Track navigation

Do not present anchor links as if they are persistent workspace tabs.

If a control looks like a tab, it must switch a coherent view and reflect active state. Otherwise use section navigation/disclosure language.

## 10. Release V5

A Release is a guided object with a lifecycle, not a set of adjacent subsystems.

Canonical facets may remain:
- Overview
- Creative
- Promotion
- Distribution
- Results

But the Release header and lifecycle context remain persistent.

### Release Overview

Show:
1. readiness state;
2. one next Mission action;
3. blockers;
4. tracks and master readiness;
5. compact lifecycle progress.

Release-level mastering coherence, provenance details and provider controls appear only when relevant or explicitly opened.

### Facet rule

Each facet must answer one job:
- Creative â€” what should we make?
- Promotion â€” what should we do to create demand?
- Distribution â€” what blocks going live?
- Results â€” what did we learn and what changes next?

A facet must not become a dashboard of every capability in that domain.
## 11. Create V5

Create remains outcome-first and is the strongest current reference surface.

Preserve:
- â€œWhat do you want to make?â€
- automatic source selection;
- visible source Moment/section;
- small bounded recommendation set;
- specialist creation modes behind advanced paths.

Improve:
- allow launcher intent to pre-resolve object + desired outcome;
- allow direct Create from Track/Release/Moment without reselecting context;
- use artist-facing language for source evidence;
- provide immediate continuation after generation starts.

## 12. Grow V5

Grow must lead with interpretation and opportunity, not metrics.

Canonical order:

1. Recommended next action
2. current opportunities
3. what is already in motion
4. Audience summary
5. Performance interpretation
6. advanced tools

### Metrics rule

Metrics are visible when they:
- support a recommendation;
- reveal a bottleneck;
- show outcome progress;
- explain why Ensemblis changed its advice.

Raw metric inventory and detailed funnels are secondary.

### Growth language

Prefer:
- â€œWhat is holding growth backâ€
- â€œWhat to do nextâ€
- â€œOpportunityâ€
- â€œPaid testâ€
- â€œWhat we learnedâ€

over:
- â€œgrowth diagnosisâ€
- â€œevidence-backed opportunityâ€
- â€œbounded paid experimentâ€
- â€œlearning evidenceâ€

Internal domain terminology remains available in technical detail and code.

## 13. Mobile V5

Mobile is not a compressed desktop page.

Rules:
- one-thumb access to Today / Music / Grow / Search / More;
- primary object actions become sticky or easily reachable;
- long pages collapse into cards, sheets and staged workflows;
- inspectors become full-height sheets;
- no desktop-only hover dependency;
- Create remains reachable from object action bars without opening More;
- critical status and next action appear before supporting detail.

## 14. Progressive disclosure

V5 defines five visible levels:

### Level 0 â€” Outcome
What the artist is trying to achieve.

### Level 1 â€” Next action
What the artist should do now.

### Level 2 â€” Context
Enough state and explanation to trust the action.

### Level 3 â€” Evidence
Optional supporting data, comparisons and rationale.

### Level 4 â€” Technical
Providers, versions, hashes, confidence components, raw diagnostics and recovery mechanics.

Default artist-facing screens should spend most of their visual weight on Levels 0â€“2.

A generic `<details>` is not sufficient progressive disclosure when the default screen is still too long.
## 15. Artist-facing terminology

Use simpler language at the default layer.

| Internal / expert term | Default artist-facing language |
| --- | --- |
| Track Intelligence | Analysis / What Ensemblis hears |
| Moment | Best section / Clip moment where context requires |
| Release Mission | Release plan / Next release step |
| Artist Memory | What Ensemblis knows about your style |
| Growth diagnosis | What's holding growth back |
| Evidence-backed opportunity | Opportunity |
| Masterability diagnosis | Mastering check |
| Provider | Platform / service |
| Lineage | Source / history |
| Bounded paid experiment | Paid test |
| Reconciliation | Updated results / Sync status |
| Autonomy contract | What Ensemblis is allowed to do |

Domain terms may remain in documentation, diagnostics and APIs. Copy shown by default should optimize for comprehension.

## 16. Inspectors and drawers

Use a contextual inspector on desktop and full-height sheet on mobile for information that is important but secondary.

Canonical inspector candidates:
- detailed Track analysis;
- mastering engineering evidence;
- stems/lyrics technical detail;
- release metadata;
- distribution metadata;
- provider details;
- generation settings;
- campaign evidence;
- Artist Memory sources;
- AI/autonomy policy.

Opening an inspector must not destroy current object/workflow context.

## 17. Interaction patterns

### One dominant action
A normal surface should not show several equally weighted primary buttons.

### Explain state before controls
Show â€œReadyâ€, â€œNeeds reviewâ€, â€œWorkingâ€, â€œBlockedâ€ before exposing configuration.

### Resume beats restart
If work exists, offer Continue before New.

### Preserve source context
Create, Master, Mix and Promote launched from an object inherit that object automatically.

### Avoid route knowledge
A deep route can exist without being a concept the user must remember.

### Technical truth stays available
Simplification must never hide safety blockers, irreversible consequences, rights requirements or meaningful uncertainty.

## 18. Accessibility and usability contracts

V5 preserves or improves:
- keyboard reachability;
- visible focus;
- semantic headings;
- real tab semantics only for real tabs;
- dialog focus trap and focus return;
- minimum touch targets;
- reduced-motion support;
- meaningful loading/progress states;
- no color-only state communication;
- no fake completion or fake provider state;
- understandable error recovery with preserved user data.

## 19. Product instrumentation

Add UX telemetry that measures behavior without recording sensitive creative content.

Measure:
- launcher opened;
- launcher query category, using normalized intent category rather than raw private query when possible;
- intent resolved / disambiguated / failed;
- action started from launcher vs navigation vs object;
- Continue usage;
- workflow abandonment by stage;
- advanced disclosure opens;
- repeated backtracking between workspaces;
- time from entry to first meaningful action;
- error/retry surface frequency.

The goal is to detect cognitive friction, not to maximize clicks.
## 20. Canonical acceptance journeys

The V5 PR is not complete until these journeys work end-to-end at desktop and mobile widths.

1. **New music**
   Today â†’ â€œadd musicâ€ â†’ upload/import â†’ Track â†’ understandable state â†’ next action.

2. **Master a track**
   Launcher â€œmaster [track]â€ or Track â†’ Master â†’ readiness â†’ corrective choice only if useful â†’ A/B review â†’ approve.

3. **Create from music**
   Launcher â€œmake a reel from [track]â€ or Track/Release â†’ Create â†’ source already resolved â†’ generate â†’ Continue result.

4. **Prepare a release**
   Launcher â€œprepare [release]â€ â†’ Release â†’ current blocker / next step â†’ Creative / Promotion / Distribution without losing context.

5. **Make a mix**
   Today/Music/Launcher â†’ source â†’ intent â†’ build â†’ review â†’ render â†’ leave/resume â†’ play/download.

6. **Understand growth**
   Grow â†’ one recommendation â†’ why â†’ supporting evidence â†’ action.

7. **Check a release result**
   Launcher â€œhow is [release] doing?â€ â†’ Results â†’ interpreted outcome â†’ next recommendation.

8. **Handle a decision**
   Today / Needs You â†’ one decision â†’ explanation â†’ safe action â†’ return to exact context.

9. **Recover from failure**
   failed analysis/master/render/provider step â†’ artist-safe explanation â†’ retry/recovery without data loss.

10. **Use advanced controls**
    expert user can intentionally reach diagnostics/providers/settings without those surfaces appearing in the normal path.

## 21. Non-goals

V5 does not:
- remove specialist functionality;
- replace domain safety with AI interpretation;
- create a chat-first product;
- flatten every workflow into one screen;
- hide consequential legal, rights, money or publishing decisions;
- redesign the Atlas public website;
- rewrite backend domain architecture unless required to expose a correct UX contract;
- create a parallel state model for UI convenience.

## 22. Definition of done

V5 is complete only when:

- intent-to-object/action works for common goals;
- Today remains calm and action-ranked;
- Music is object-first;
- Track is action-first and no longer a subsystem index;
- Release is lifecycle-guided;
- Create preserves its outcome-first model;
- Grow is recommendation-first;
- mobile uses the same mental model with mobile-native interaction;
- specialist tools remain reachable but secondary;
- artist-facing copy removes unnecessary internal vocabulary;
- automated UX contracts protect the new hierarchy;
- canonical browser journeys pass on desktop and mobile;
- TypeScript, lint, Studio tests and production build pass;
- the V5 route inventory and product roadmap match the shipped implementation.

The single-PR execution plan is documented in:
`docs/superpowers/plans/2026-10-02-ensemblis-ux-v5.md`.
