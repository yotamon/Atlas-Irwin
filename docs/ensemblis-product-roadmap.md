# Ensemblis Product Roadmap

**Status:** Living execution document  
**Program:** GitHub issue #47  
**Canonical branch:** `main`  
**Product:** Ensemblis  
**Reference artist:** Atlas Irwin  
**Last reconciled:** 2026-09-04

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
Atlas Irwin remains the production reference artist while Ensemblis becomes the reusable product. Prefer additive migrations, compatibility adapters, backfills, validation and reversible cutovers.

## 4. Current implementation state

The original Atlas-specific architecture has already been substantially transformed. The codebase now contains production-grade foundations for:

- explicit Workspace → Artist ownership and active-artist context;
- artist-scoped catalog, music intelligence, marketing, growth and automation paths;
- Track Music Intelligence and hook/section analysis;
- Lyrics Intelligence with timing and lyric moments;
- Stem Intelligence and Audio Scenes;
- first-class Moments with source lineage, review/audition UX and downstream references;
- cross-modal creative intelligence feeding Marketing and Video;
- campaign planning and lifecycle automation;
- music-aware social creative generation and deterministic finishing;
- publishing approval and platform integrations;
- Today / Next Best Action / Needs You operational UX;
- Growth OS, unreleased track ranking and 90-day planning;
- analytics, attribution foundations, learnings, audience interactions and catalog reconciliation;
- spend envelopes and approval-gated external effects;
- Ensemblis-native product navigation, visual identity and entry/auth surfaces;
- Ensemblis Sites multi-tenant persistence, versioned templates, preview/publish/rollback, custom-domain routing and domain-aware SEO;
- Atlas Irwin's production website running as a published Ensemblis Sites tenant on `atlasirwin.com`, while `/studio` remains the Ensemblis application surface.

The main remaining P0 gap is no longer artist ownership or Moment lineage. It is **closing the evidence loop** so correctly attributed outcomes become inspectable learnings that can safely influence future ranking and creative decisions.

## 5. Product model

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
Creative + Campaign + Owned-Web Actions
    ↓
Publication / Site / Paid Growth / Conversion
    ↓
Outcomes
    ↓
Evidence-backed Learnings
    ↓
Artist Memory + Future Decisions
```

Atlas Irwin is a normal `Artist` record inside an Ensemblis workspace and the first production reference tenant for Ensemblis Sites.

## 6. Execution order

### Phase 0 — Foundation and moat

#### P0.1 Multi-artist workspace architecture — #48 — **Complete**
User identity, workspace membership and artist ownership are separated. Canonical music, marketing/growth and operational workflows carry artist scope, and the parent issue has been reconciled after completion of the domain cutover slices.

#### P0.2 Moments — #49 — **Complete**
Moments are first-class entities with timing, source lineage, evidence/confidence, artist review, downstream creative/campaign references and performance rollups.

#### P0.3 Closed-loop learning — #50 — **In progress / next implementation slice**
Connect Moment → Creative → Publication/Ad/Site → Outcome → Learning → future ranking.

**Existing foundation**
- content can retain `moment_id`, release/track/campaign lineage;
- publications and metric snapshots retain content/campaign lineage;
- `moment_performance_rollups` aggregates attributed outcomes back to artist/Moment/track;
- `marketing_learnings` already stores structured scope, observation, recommendation, evidence, confidence and lifecycle status.

**Remaining exit criteria**
- only verified, correctly attributed evidence can create/update learning proposals;
- Ensemblis can compare Moment/creative treatments within one artist and compatible scope;
- findings expose evidence sample size, confidence, scope and freshness/expiry semantics;
- findings can be approved/rejected without free-form chat history;
- approved findings influence future ranking/creative decisions through a bounded structured interface;
- weak or cross-artist priors never silently become artist truth;
- tests prove attribution integrity, learning isolation, idempotency and stale-evidence handling.

### Phase 1 — Productization and owned growth

#### P1.1 Structured Artist Memory — #51 — **Planned after #50**
Unify explicit rules, observed preferences and approved evidence-backed learnings into inspectable artist memory.

#### P1.2 Native smart links, pre-save and attribution — #52 — **Planned**
Own the conversion layer between campaigns and listening. Use Ensemblis Sites (#90) as the public runtime rather than creating a second renderer. Attribute visits/clicks to campaign/content/Moment where known.

#### P1.3 Paid Growth provider layer — #53 — **Planned**
Keep Ensemblis decisioning in-house while ad delivery is handled by replaceable provider adapters. Depends on #50 and #52 for evidence and conversion lineage.

#### P1.4 Autonomy contracts — #57 — **Planned**
Define Assist / Prepare / Run per artist and domain, including spend ceilings, allowed providers and approval requirements. Existing approval/spend guardrails are inputs to this work, not a substitute for the explicit domain contract.

#### P1.5 Product navigation and artist-context UX — #58 — **Complete**
The product is organized around outcome-oriented Ensemblis surfaces with active artist context rather than the old Atlas-specific Studio hierarchy.

#### P1.6 Rebrand implementation / Atlas decoupling — #59 — **Complete**
Ensemblis is the product identity throughout generic product surfaces. Atlas Irwin remains artist data/reference production content.

#### P1.7 Ensemblis Sites / owned artist web — #90 — **Core runtime complete; growth surfaces in progress**
The multi-tenant runtime, artist-scoped persistence, immutable/versioned publishing, reusable Atlas-derived template, private preview, domain lifecycle, trusted hostname routing, SEO identity and Atlas production cutover are complete.

Remaining Sites work should be shared with #52/#50 rather than duplicated:
- landing pages, smart links, pre-save and campaign conversion surfaces;
- first-party site events/attribution;
- lifecycle-aware proposals and approval-gated updates;
- richer artist-specific site identity assets where useful.

### Phase 2 — Platform expansion

#### P2.1 Provenance and Trust — #54 — **Planned**
Support human, AI-assisted, hybrid and virtual artists with explicit creation provenance, rights evidence and platform/distributor disclosure readiness.

#### P2.2 Fan Graph / first-party CRM — #55 — **Planned after #52**
Move Audience beyond social replies into consented first-party fan identity and repeat-engagement intelligence.

#### P2.3 Distribution provider integration — #56 — **Planned after #54**
Integrate distribution through an adapter/provider rather than rebuilding distributor infrastructure.

### Later / conditional

- royalties and financial operations;
- touring and booking operations;
- merchandise;
- broad label ERP functionality;
- generic workflow builders;
- named AI-agent personas;
- a chat-first primary interface.

These remain intentionally deferred until the core music-aware growth loop proves itself.

## 7. The Moment model

A Moment should minimally answer:

- **Where?** start/end in the canonical track;
- **What?** chorus lift, vocal cold open, lyric line, breakdown, instrumental hook, transition, etc.;
- **Why?** supporting audio/lyric/stem evidence;
- **How strong?** hook, energy, emotional, vocal and uniqueness signals plus confidence;
- **What can we do with it?** recommended formats/campaign purposes;
- **What happened when we used it?** linked creative and outcome evidence.

Moment data references canonical Track/Lyrics/Stem intelligence rather than creating another inconsistent copy of it.

## 8. Learning model

Closed-loop learning is structured evidence, not generated advice text.

A learning must answer:

1. **What was compared or observed?** Moment/treatment/platform/format/audience/campaign decision.
2. **For whom?** artist first, optionally narrowed to release/track/platform/format.
3. **From what evidence?** correctly attributed publications/campaigns/metric snapshots.
4. **How much evidence?** sample counts and relevant outcome totals/rates.
5. **How reliable?** confidence/calibration and data-quality requirements.
6. **How fresh?** observation window, last evidence time and expiry/decay semantics.
7. **What should change?** a structured, bounded recommendation that a ranking/creative consumer explicitly understands.
8. **Who accepted it?** candidate → approved/rejected/superseded lifecycle with auditability.

No learning may influence future decisions merely because an LLM phrased it persuasively.

## 9. Artist Memory model

Memory is structured and inspectable, not a hidden LLM transcript.

Classes:

1. **Identity** — sound, voice, visual world, audience, positioning.
2. **Creative rules** — explicit do/don't constraints.
3. **Preference evidence** — repeated approvals/rejections and manual edits.
4. **Performance learnings** — approved evidence-backed observations from real outcomes.
5. **Strategic constraints** — goals, cadence, budget and release priorities.
6. **Provenance/compliance** — project-specific disclosure and rights constraints.

Each memory item needs source, scope, confidence, timestamps, status and whether it may influence automation.

## 10. Autonomy model

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
| Sites draft preparation | Prepare |
| Sites publishing/domain changes | Ask unless explicitly contracted |

Every external execution records the autonomy contract that authorized it once #57 is complete.

## 11. Success metrics

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
- zero tenant-domain/site leakage;
- migration replay, RLS tests and production reconciliation remain green.

## 12. Definition of done for every roadmap item

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

## 13. Progress ledger

| Workstream | Priority | Status | Issue |
| --- | --- | --- | --- |
| Roadmap / documentation | P0 | Living / reconciled | #60 |
| Multi-artist architecture | P0 | **Complete** | #48 |
| Moments | P0 | **Complete** | #49 |
| Closed-loop learning | P0 | **In progress / next** | #50 |
| Artist Memory | P1 | Planned after #50 | #51 |
| Smart links / pre-save / attribution | P1 | Planned | #52 |
| Paid Growth provider layer | P1 | Planned after #50/#52 | #53 |
| Autonomy contracts | P1 | Planned | #57 |
| Navigation / artist-context UX | P1 | **Complete** | #58 |
| Ensemblis rebrand implementation | P1 | **Complete** | #59 |
| Ensemblis Sites core runtime + Atlas cutover | P1 | **Complete core / program continues** | #90 |
| Sites conversion + attribution surfaces | P1 | Planned with #52/#50 | #90 / #52 |
| Provenance & Trust | P2 | Planned | #54 |
| Fan Graph / CRM | P2 | Planned after #52 | #55 |
| Distribution provider layer | P2 | Planned after #54 | #56 |

## 14. Immediate next sequence

1. Complete #50 closed-loop learning on the existing Moment/content/publication/metric lineage.
2. Require verified attribution and deterministic evidence aggregation before a learning can become a candidate.
3. Add candidate review/approve/reject and bounded structured influence on future creative/Moment ranking.
4. Build #51 Structured Artist Memory on top of approved learnings plus explicit artist rules/preferences.
5. Build #52 smart links/pre-save/first-party attribution using the Ensemblis Sites runtime rather than a separate public renderer.
6. Formalize #57 autonomy contracts across the existing approval/spend/external-effect boundaries.
7. Build #53 Paid Growth once #50/#52 can measure the downstream outcomes correctly.
8. Expand into #55 Fan Graph, #54 provenance/trust and #56 distribution according to their dependency gates.

## 15. Production reference state

As of the 2026-09-04 reconciliation:

- Atlas Irwin is artist data inside Ensemblis, not product identity;
- `atlasirwin.com` is served by the published Ensemblis Sites runtime;
- `www.atlasirwin.com` resolves to the same tenant while canonicalizing to the apex;
- `/studio` remains isolated as the Ensemblis product/auth surface;
- the production Site uses immutable published versioning with preview/publish/rollback support;
- domain-aware canonical metadata, robots, sitemap and manifest are active;
- the cutover was performed with rollback gates and completed only after routing, SEO, Studio isolation and runtime-error checks passed.

This document is the canonical product sequencing guide. Implementation details may evolve, but changes to the north star, core loop, safety rules or execution order must be reflected here and in #47.