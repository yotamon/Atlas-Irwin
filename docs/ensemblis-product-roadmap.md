# Ensemblis Product Roadmap

**Status:** Living execution document  
**Program:** GitHub issue #47  
**Working branch:** `ensemblis/product-roadmap`  
**Product:** Ensemblis  
**Reference artist:** Atlas Irwin

## 1. North star

Ensemblis turns an artist's actual music into the right creative and growth actions, executes those actions within the artist's rules, and learns from every result.

The core product loop is:

`Music → Moments → Actions → Outcomes → Memory`

Everything we build must strengthen at least one link in that loop. Features that do not clearly map to it are deferred unless they are required infrastructure.

## 2. Positioning

Ensemblis is not a generic AI content generator, social scheduler, artist chatbot, or "Artist OS" feature bundle.

The strategic position is **music-aware artist growth**:

- understand the recording, lyrics, stems, structure and identity;
- identify the moments that are actually useful for communication and growth;
- turn those moments into artist-specific creative and campaign decisions;
- execute within explicit autonomy and spend rules;
- connect results back to the musical and creative source;
- learn what works for this artist over time.

A useful external statement is:

> **The platform that understands the song before it markets it.**

The broader brand promise remains:

> **Everything behind your music, working together.**

## 3. Product principles

### Music is the source of truth
Release marketing should not begin from an empty prompt. When music exists, strategy and creative should start from Track Intelligence and approved Moments.

### The artist owns the room
Ensemblis is the operating frame. Artist identity, sound, visual world and voice drive the creative result.

### Intelligence should reduce work, not expose machinery
Primary UX is outcome-oriented: Next Move, Needs You, In Motion, Create from Moment. Specialist tools remain available as advanced surfaces.

### Evidence over generic advice
Recommendations distinguish measured artist evidence from working benchmarks and weak priors. Confidence and provenance are visible.

### Safe autonomy
Internal, reversible, zero-cost work can run freely. Money, ambiguity, sensitive communication and irreversible external effects require an explicit autonomy contract.

### Preserve production while transforming architecture
The current Atlas Irwin production system must remain usable throughout the Ensemblis migration. Prefer additive migrations, compatibility adapters, backfills, validation and reversible cutovers.

## 4. Current starting point

The codebase already contains meaningful production-grade foundations:

- Track Music Intelligence and hook/section analysis;
- Lyrics Intelligence with timing and lyric moments;
- Stem Intelligence and Audio Scenes;
- cross-modal creative intelligence feeding Marketing and Video;
- campaign planning and lifecycle automation;
- music-aware social creative generation and deterministic finishing;
- publishing approval and platform integrations;
- Today / Next Best Action / Needs You operational UX;
- Growth OS, unreleased track ranking and 90-day planning;
- analytics, learnings, audience interactions and catalog reconciliation;
- spend envelopes and approval-gated external effects.

The main architectural limitation is that the original data model treats `profile/user`, `owner`, and `artist` as effectively the same thing. The Ensemblis transformation must separate those concepts before the product can honestly support multiple artists, managers or labels.

## 5. Target product model

```text
User / Profile
    ↓
Workspace
    ↓
Artist
    ↓
Music
    ↓
Track Intelligence
    ↓
Moments
    ↓
Creative + Campaign Actions
    ↓
Publication / Paid Growth / Conversion
    ↓
Outcomes
    ↓
Artist Memory + Future Decisions
```

Atlas Irwin becomes a normal `Artist` record inside an Ensemblis workspace.

## 6. Execution order

### Phase 0 — Foundation and moat

These workstreams are mandatory before broadening the product.

#### P0.1 Multi-artist workspace architecture — #48
Separate user identity, workspace membership and artist ownership.

**Exit criteria**
- a workspace can contain multiple artists;
- a user may participate in one or more workspaces with roles;
- a second test artist is isolated correctly;
- Today, releases, intelligence, content, campaigns, audience, growth and connections can all be scoped to the active artist;
- Atlas production data is preserved exactly;
- RLS and background jobs carry explicit workspace/artist context.

#### P0.2 Moments — #49
Create a durable first-class bridge between music intelligence and downstream execution.

A Moment unifies the useful parts of hook candidates, lyric moments, section timing, vocal activity, stem evidence and Audio Scenes without duplicating their canonical source data.

**Exit criteria**
- Moments have timing, lineage, evidence, confidence and lifecycle;
- Track Intelligence can propose them;
- users can audition/approve/edit them;
- Creative and Campaign records can reference them;
- UI offers `Create from this moment`;
- performance can aggregate back to a Moment.

#### P0.3 Closed-loop learning — #50
Connect Moment → Creative → Publication/Ad → Outcome → Learning.

**Exit criteria**
- creative assets retain their musical and creative lineage;
- metrics can resolve back to artist, release, track, Moment, content and campaign;
- Ensemblis can generate artist-specific evidence-backed learnings;
- learning records include sample size/confidence/scope;
- approved learnings influence future rankings and creative decisions through structured data.

### Phase 1 — Productization and owned growth

#### P1.1 Structured Artist Memory — #51
Unify explicit rules, observed preferences and evidence-backed learnings into inspectable artist memory.

#### P1.2 Native smart links, pre-save and attribution — #52
Own the conversion layer between campaigns and listening. Attribute visits and clicks to campaign/content/Moment where possible.

#### P1.3 Paid Growth provider layer — #53
Keep Ensemblis decisioning in-house while ad delivery is handled by replaceable provider adapters.

#### P1.4 Autonomy contracts — #57
Define Assist / Prepare / Run per artist and domain, including spend ceilings and approval requirements.

#### P1.5 Product navigation and artist-context UX — #58
Primary navigation target:

- Today
- Music
- Releases
- Create
- Growth
- Audience
- Library
- Connections
- Settings

Analytics should increasingly appear as evidence inside workflows rather than forcing artists to "go do analytics".

#### P1.6 Rebrand implementation / Atlas decoupling — #59
Ensemblis becomes the product identity throughout generic surfaces. Atlas Irwin remains artist data and its public artist experience must keep working.

### Phase 2 — Platform expansion

#### P2.1 Provenance and Trust — #54
Support human, AI-assisted, hybrid and virtual artists with explicit creation provenance, rights evidence and platform/distributor disclosure readiness.

#### P2.2 Fan Graph / first-party CRM — #55
Move Audience beyond social replies into consented first-party fan identity and repeat-engagement intelligence.

#### P2.3 Distribution provider integration — #56
Integrate distribution through an adapter/provider rather than rebuilding distributor infrastructure.

### Later / conditional

- royalties and financial operations;
- touring and booking operations;
- merchandise;
- broad label ERP functionality;
- generic workflow builders;
- named AI-agent personas;
- a chat-first primary interface.

These are intentionally deferred until the core music-aware growth loop proves itself.

## 7. The Moment model

A Moment should minimally answer:

- **Where?** start/end in the canonical track;
- **What?** chorus lift, vocal cold open, lyric line, breakdown, instrumental hook, transition, etc.;
- **Why?** supporting audio/lyric/stem evidence;
- **How strong?** hook, energy, emotional, vocal and uniqueness signals plus confidence;
- **What can we do with it?** recommended formats/campaign purposes;
- **What happened when we used it?** linked creative and outcome evidence.

Moment data must reference canonical Track/Lyrics/Stem intelligence rather than creating another inconsistent copy of it.

## 8. Artist Memory model

Memory is structured and inspectable, not a hidden LLM transcript.

Classes:

1. **Identity** — sound, voice, visual world, audience, positioning.
2. **Creative rules** — explicit do/don't constraints.
3. **Preference evidence** — repeated approvals/rejections and manual edits.
4. **Performance learnings** — evidence-backed observations from real outcomes.
5. **Strategic constraints** — goals, cadence, budget and release priorities.
6. **Provenance/compliance** — project-specific disclosure and rights constraints.

Each memory item needs source, scope, confidence, timestamps, status and whether it may influence automation.

## 9. Autonomy model

Autonomy is configured per domain, not as one global "Autopilot" switch.

| Domain | Default posture |
| --- | --- |
| Analytics / reconciliation | Run |
| Track/Lyrics/Stem analysis | Run |
| Creative ideation | Run |
| Low-cost generation | Prepare |
| Expensive generation | Ask unless budgeted |
| Social scheduling | Prepare |
| Social publishing | Prepare |
| Audience replies | Prepare |
| Sensitive replies | Always ask |
| Paid growth | Ask or Run within an explicit spend contract |
| Outreach | Prepare |
| Distribution | Always ask by default |

Every external execution records the autonomy contract that authorized it.

## 10. Success metrics

We should judge Ensemblis by outcomes and user work removed, not feature count.

### Product usefulness
- time from uploading/connecting a track to a useful first recommendation;
- percentage of releases with usable approved Moments;
- percentage of campaign work prepared automatically;
- human interventions per active release;
- approval acceptance rate and edit distance.

### Intelligence quality
- Moment ranking vs observed creative performance;
- confidence calibration of learnings;
- percentage of recommendations supported by artist-specific evidence;
- false attribution / lineage error rate (target: zero).

### Growth
- qualified reach → profile/link conversion;
- link → listener conversion where observable;
- saves/follows/repeat engagement;
- cost per meaningful fan action for paid growth;
- repeat fan engagement over 30/90 days once Fan Graph exists.

### Reliability
- zero cross-artist data leaks;
- zero spend-envelope violations;
- zero unapproved sensitive external effects;
- migration replay, RLS tests and production reconciliation remain green.

## 11. Definition of done for every roadmap item

A roadmap item is not complete because the UI exists.

It is complete when:

- domain model and ownership are correct;
- migration/backfill is safe and replayable;
- RLS and authorization are covered;
- server and background paths share the same ownership/context rules;
- failure/retry/idempotency behavior is defined;
- observability exists for important state transitions;
- UX is understandable without internal implementation terminology;
- tests cover the important invariants;
- relevant docs are updated;
- the feature is demonstrated with Atlas Irwin and at least one non-Atlas test artist where multi-artist behavior is relevant.

## 12. Progress ledger

| Workstream | Priority | Status | Issue |
| --- | --- | --- | --- |
| Roadmap / documentation | P0 | In progress | #60 |
| Multi-artist architecture | P0 | Ready | #48 |
| Moments | P0 | Ready after architecture contract | #49 |
| Closed-loop learning | P0 | Planned | #50 |
| Artist Memory | P1 | Planned | #51 |
| Smart links / pre-save / attribution | P1 | Planned | #52 |
| Paid Growth provider layer | P1 | Planned | #53 |
| Autonomy contracts | P1 | Planned | #57 |
| Navigation / artist-context UX | P1 | Planned | #58 |
| Ensemblis rebrand implementation | P1 | Planned | #59 |
| Provenance & Trust | P2 | Planned | #54 |
| Fan Graph / CRM | P2 | Planned | #55 |
| Distribution provider layer | P2 | Planned | #56 |

## 13. Immediate next sequence

1. Finish and review the multi-artist architecture RFC.
2. Audit all `owner_id` and hardcoded Atlas assumptions by domain.
3. Implement additive workspace/artist foundations with compatibility behavior.
4. Backfill Atlas Irwin as the first real artist.
5. Prove isolation with a second test artist.
6. Introduce Moment storage/lineage on top of the new artist scope.
7. Route Create and campaign generation through Moments.
8. Close the outcome lineage and learning loop.
9. Only then broaden into smart links, memory, paid growth and CRM.

This document is the canonical product sequencing guide. Implementation details may evolve, but changes to the north star, core loop, safety rules or execution order should be reflected here and in #47.