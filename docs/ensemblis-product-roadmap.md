# Ensemblis Product Roadmap

**Status:** Living execution document  
**Program:** GitHub issue #47  
**Canonical branch:** `main`  
**Product:** Ensemblis  
**Reference artist:** Atlas Irwin  
**Last reconciled:** 2026-09-04

## 1. North star

Ensemblis turns an artist's actual music into the right creative and growth actions, orchestrates those actions around meaningful artist Missions, executes within the artist's rules, and learns from verified outcomes.

The core product loop is:

`Music → Moments → Actions → Outcomes → Memory`

Everything we build must strengthen at least one link in that loop or provide infrastructure required to keep that loop safe and reliable.

## 2. Positioning

Ensemblis is not a generic AI content generator, social scheduler, artist chatbot, analytics dashboard, or a bundle of disconnected "Artist OS" tools.

The strategic position is **music-aware artist growth and operations**:

- understand the recording, lyrics, stems, structure and identity;
- identify the Moments that are genuinely useful for communication and growth;
- turn those Moments into artist-specific creative and campaign decisions;
- orchestrate release work as Missions instead of making artists operate subsystems;
- execute within explicit autonomy and spend rules;
- own enough of the conversion layer to measure what happened;
- connect results back to the musical and creative source;
- learn what works for this artist over time.

A useful external statement is:

> **The platform that understands the song before it markets it.**

The broader brand promise remains:

> **Everything behind your music, working together.**

## 3. Product principles

### Music is the source of truth
Release marketing should not begin from an empty prompt. When music exists, strategy and creative start from Track Intelligence and approved Moments.

### Mission before subsystem
The artist should think in outcomes such as "release this track" or "grow this catalog release", not in Campaign Brain, Production, Analytics, provider operations or internal job types. Those remain engines and advanced inspectors.

### Intelligence should remove work
Primary UX answers:
1. What Mission matters now?
2. What does Ensemblis already know?
3. What is Ensemblis doing?
4. What decision actually needs the artist?

Safe, internal, reversible work should not require a manual refresh, recalculate or scan action when the relevant autonomy contract allows it.

### One musical Moment should travel end-to-end
A useful Moment keeps its identity through creative, campaign, publication, destination, performance and learning. This is the foundation of Ensemblis' differentiation.

### Evidence over generic advice
Recommendations distinguish measured artist evidence from benchmarks and weak priors. Confidence, sample size, freshness and provenance are visible where meaningful.

### Artist Memory is explicit
Memory is structured, inspectable, editable and source-backed. It is never an opaque chat transcript.

### Safe autonomy
Internal, reversible, zero-cost work can Run. Money, legal declarations, ambiguity, sensitive communication and irreversible external effects require explicit authorization unless covered by a valid domain autonomy contract.

### Preserve production while transforming architecture
Atlas Irwin remains the production reference artist while Ensemblis becomes the reusable product. Prefer additive migrations, compatibility adapters, backfills, validation and reversible cutovers.

## 4. Current implementation state

The original Atlas-specific architecture has already been substantially transformed. The codebase contains production-grade foundations for:

- explicit Workspace → Artist ownership and active-artist context;
- artist-scoped catalog, music intelligence, marketing, growth and automation;
- Track Music Intelligence and hook/section analysis;
- Lyrics Intelligence with timing and lyric moments;
- Stem Intelligence and Audio Scenes;
- first-class Moments with source lineage, review/audition UX and downstream references;
- cross-modal creative intelligence feeding Marketing and Video;
- campaign planning, experiments and lifecycle automation;
- music-aware social creative generation and deterministic finishing;
- publishing approval and platform integrations;
- Today / Next Best Action / Needs You operational UX;
- Growth OS, unreleased track ranking and planning;
- analytics, attribution foundations, learnings, audience interactions and catalog reconciliation;
- spend envelopes and approval-gated external effects;
- Ensemblis-native product navigation, visual identity and entry/auth surfaces;
- Ensemblis Sites multi-tenant persistence, versioned templates, preview/publish/rollback, custom-domain routing and domain-aware SEO;
- Atlas Irwin's production website running as an Ensemblis Sites tenant while `/studio` remains the Ensemblis application surface;
- provider-neutral Distribution foundations with Revelator as the first adapter, release readiness, declarations, submission snapshots and store-level delivery state.

PR #111 is the active product-orchestration slice. It makes Music `Add music`-first, makes Create begin from approved Moments, introduces a shared release Mission model across Today and Release, removes pseudo-precise additive readiness scoring, and moves Sites infrastructure detail behind an artist-first status/preview/publish surface.

The main remaining moat gap after #111 is the evidence loop: correctly attributed outcomes must become reliable learnings and then bounded Artist Memory that can improve future decisions.

## 5. Product model

```text
User / Profile
    ↓
Workspace
    ↓
Artist
    ↓
Mission
    ↓
Music
    ↓
Track + Lyrics + Stem Intelligence
    ↓
Moments
    ↓
Creative + Campaign + Distribution + Owned-Web Actions
    ↓
Publication / Site / Paid Growth / Conversion
    ↓
Outcomes
    ↓
Evidence-backed Learnings
    ↓
Artist Memory
    ↓
Better future Missions and decisions
```

Atlas Irwin is a normal `Artist` record inside an Ensemblis workspace and the first production reference tenant for Ensemblis Sites.

## 6. Execution order

### Phase 0 — Orchestration and moat

#### P0.1 Multi-artist workspace architecture — #48 — **Complete**
User identity, workspace membership and artist ownership are separated. Canonical music, marketing/growth and operational workflows carry explicit artist scope.

#### P0.2 Moments — #49 — **Complete**
Moments are first-class entities with timing, evidence/confidence, source lineage, artist review, creative/campaign references and performance rollups.

#### P0.3 Ensemblis Manager / release Missions — #108 — **In implementation: PR #111**
Today and Release share semantic Mission state derived from canonical data.

Exit criteria:
- release work is represented as an outcome with a critical path;
- readiness is `Blocked / Needs attention / On track`, never an arbitrary percentage;
- blockers distinguish required, recommended and optional work;
- Today surfaces the active Mission and exact next decision;
- specialist subsystem failures collapse into one artist-actionable Mission blocker;
- internal safe work does not create unnecessary navigation or button-click labor;
- Mission derivation is artist-safe, deterministic and tested.

#### P0.4 Moment-first creation + calibration — #109 — **In implementation: PR #111; calibration follows**
Make `Music → Moment → Create` the unmistakable default creative flow.

Exit criteria:
- approved Moments are playable and visible before generic generation controls;
- `Create from this Moment` preserves immutable lineage;
- outcome-level formats are recommended from music/lyric/stem evidence;
- model/provider/prompt/seed/exact timing remain Advanced;
- artist corrections/preferences are stored as structured calibration evidence;
- a representative real-track benchmark measures section, hook and short-form ranking quality;
- stale/master-mismatched calibration never affects a new canonical master.

#### P0.5 Closed-loop learning — #50 — **Next schema/intelligence slice**
Connect `Moment → Creative → Publication/Ad/Site → Outcome → Learning → future ranking`.

Existing foundation:
- content can retain Moment/release/track/campaign lineage;
- publications and metric snapshots retain content/campaign lineage;
- Moment performance rollups aggregate attributed outcomes;
- marketing learnings already provide an initial structured lifecycle.

Remaining exit criteria:
- only verified, correctly attributed evidence can create/update learning candidates;
- Ensemblis compares compatible Moment/creative treatments within one artist;
- findings expose sample size, confidence, scope, source and freshness/expiry;
- findings can be approved/rejected/superseded without free-form chat history;
- approved findings influence future ranking through bounded structured consumers;
- weak cross-artist priors never become artist truth;
- tests prove attribution integrity, idempotency, isolation and stale-evidence handling.

### Phase 1 — Personalization, owned growth and complete release operations

#### P1.1 Structured Artist Memory — #51 — **Planned after #50**
Create one artist-scoped memory layer that unifies:
- explicit brand/identity rules;
- approval/rejection preferences and edit behavior;
- Moment calibration;
- Video Director feedback;
- verified performance learnings;
- strategic/autonomy constraints.

Each memory item records class, structured value, source IDs, confidence, timestamps, lifecycle, allowed consumers and whether it may influence autonomous behavior. The UI must answer "Why does Ensemblis believe this?" and allow edit/disable/forget without deleting canonical evidence.

#### P1.2 Smart Links, pre-save and first-party attribution — #52 — **Planned on Sites runtime**
Use Ensemblis Sites as one public runtime for:
- artist/release Smart Links;
- pre-save;
- automatic pre-release → live-destination transition;
- campaign landing pages;
- EPK / press surfaces where appropriate.

Known first-party events retain lineage where available:
`artist → release → campaign → content/variant → Moment → destination`.

No hidden fingerprinting. Analytics-only anonymous events do not silently become named fan profiles.

#### P1.3 Evidence-backed Paid Growth — #53 — **Planned after #50/#52/#57**
Growth becomes an experiment engine rather than a manual dashboard.

A proposal contains:
- hypothesis;
- source evidence/confidence;
- audience/geo/platform;
- source Moment and creative;
- first-party destination;
- budget/hard ceiling;
- success metric + minimum sample;
- stop/pause conditions;
- learning scope.

Provider adapters own delivery plumbing. Ensemblis owns decisioning and normalized outcomes.

#### P1.4 Autonomy contracts — #57 — **Planned**
Define Assist / Prepare / Run per artist and domain with spend ceilings, allowed providers/platforms, approval rules, sensitivity overrides, expiry and optional Mission/release overrides.

Every external execution resolves and records the governing contract immediately before execution.

#### P1.5 Product navigation and artist-context UX — #58 — **Complete**
Outcome-oriented Ensemblis surfaces with active artist context replace the old Atlas-specific hierarchy.

#### P1.6 Rebrand implementation / Atlas decoupling — #59 — **Complete**
Ensemblis is the product identity. Atlas Irwin remains artist data/reference production content.

#### P1.7 Ensemblis Sites / owned artist web — #90 — **Core runtime complete; growth surfaces continue with #52**
The multi-tenant runtime, immutable/versioned publishing, reusable Atlas-derived template, private preview, domain lifecycle, trusted hostname routing, SEO identity and Atlas production cutover are complete.

PR #111 also changes the Studio Sites UX so the normal artist surface prioritizes live/private state, pending changes, domain health, preview and publish. Provider/DNS/TLS/deployment/recovery internals remain available under Advanced.

#### P1.8 Distribution last mile + canonical credits — #56 — **Planned / existing transport foundation preserved**
Distribution is already provider-neutral and artist-scoped. The remaining gap is canonical Ensemblis release metadata/credits and provider catalog/media ingestion without an artist-visible internal Operations bridge.

Canonical model includes:
- primary/featured artist roles;
- writers/composers/lyricists;
- producers/performers where required;
- ISRC and UPC/EAN lifecycle;
- master/composition copyright statements;
- recording owner / label imprint;
- publishing metadata where known;
- explicit flag, territories and release timing;
- canonical master/artwork requirements;
- lyrics language where relevant;
- provenance/AI declarations from #54;
- provider-specific contributor identifiers behind adapters only.

#### P1.9 Artist-first creative UX — #110 — **Planned after #51/#109**
Keep the production-grade engines while making the artist path preview-first.

Quick Video reduces the default Video Director journey to:
1. choose a music-aware concept;
2. review a representative sample + total bounded budget;
3. approve production and receive master + derived socials.

Director Pro retains the existing detailed bible/storyboard/test-shot/batch/shot workflow.

Creative Memory evolves Library from storage into explainable retrieval using visual semantics, artist/release/Moment relationships, use history, approval/rejection evidence, performance context, brand relevance and duplicate evidence.

### Phase 2 — Relationship and trust expansion

#### P2.1 Provenance and Trust — #54 — **Planned**
Support human, AI-assisted, hybrid and virtual artists with explicit creation provenance, rights evidence and platform/distributor disclosure readiness.

#### P2.2 Fan Graph / first-party CRM — #55 — **Planned after #52**
Move Audience from `message → reply` to `event/message → relationship → history → next useful action`.

Guardrails:
- consent-aware identities;
- evidence-backed reversible merges only;
- no hidden fingerprinting;
- no sensitive-trait inference;
- channel-specific communication permissions;
- GDPR delete/export/revocation paths.

### Later / conditional

- royalties and financial operations;
- touring and booking operations;
- merchandise;
- broad label ERP functionality;
- generic workflow builders;
- named AI-agent personas;
- a chat-first primary interface.

These remain intentionally deferred until the core music-aware growth loop proves itself.

## 7. Mission model

A Mission is not another manually maintained table of tasks. It is a semantic projection over canonical product state.

A release Mission must answer:
- **Outcome:** what are we trying to accomplish?
- **State:** blocked, needs attention, on track, or archived;
- **Required:** what truly blocks the outcome?
- **Recommended:** what materially improves the outcome but is not a hard blocker?
- **Optional:** what is worth reviewing without manufacturing work?
- **Working:** what Ensemblis is already doing;
- **Next decision:** the single best human action when one exists;
- **Next milestone:** what Ensemblis is moving toward.

Mission derivation must never replace canonical release/campaign/distribution/site data with a duplicated checklist.

## 8. Moment model

A Moment minimally answers:
- **Where?** start/end in the canonical track;
- **What?** chorus lift, vocal cold open, lyric line, breakdown, instrumental hook, transition, etc.;
- **Why?** supporting audio/lyric/stem evidence;
- **How strong?** hook, energy, emotional, vocal and uniqueness signals plus confidence;
- **What can we do with it?** recommended creative/campaign purposes;
- **What happened when we used it?** linked creative and outcome evidence.

Moment data references canonical Track/Lyrics/Stem intelligence rather than duplicating those sources.

## 9. Learning model

Closed-loop learning is structured evidence, not generated advice text.

A learning answers:
1. what was compared or observed;
2. artist/release/track/platform/format scope;
3. exact attributed evidence;
4. sample size and relevant outcome totals/rates;
5. confidence and data-quality state;
6. observation window and freshness/expiry;
7. a bounded recommendation understood by explicit consumers;
8. candidate → approved/rejected/superseded lifecycle.

No learning influences future decisions merely because an LLM phrased it persuasively.

## 10. Artist Memory model

Memory classes:
1. **Identity** — sound, voice, visual world, audience, positioning.
2. **Creative rules** — explicit do/don't constraints.
3. **Preference evidence** — approvals/rejections, edits and Moment calibration.
4. **Performance learnings** — approved evidence-backed observations.
5. **Strategic constraints** — goals, cadence, budget and priorities.
6. **Provenance/compliance** — project-specific disclosure and rights constraints.

Each memory item needs source, scope, confidence, timestamps, lifecycle and explicit consumer permissions.

## 11. Autonomy model

| Domain | Default posture |
| --- | --- |
| Analytics / reconciliation | Run |
| Track/Lyrics/Stem analysis | Run |
| Moment proposal/calibration processing | Run |
| Creative ideation | Run |
| Low-cost generation | Prepare |
| Expensive generation | Ask unless budgeted |
| Social scheduling | Prepare |
| Social publishing | Prepare |
| Audience replies | Prepare |
| Sensitive replies | Always ask |
| Paid growth | Ask or Run within explicit spend contract |
| Outreach | Prepare |
| Sites draft preparation | Prepare |
| Sites publishing/domain changes | Ask unless explicitly contracted |
| Distribution | Always ask by default |

## 12. Success metrics

### Product usefulness
- time from adding a track to first useful recommendation;
- percentage of releases with usable approved Moments;
- percentage of release Mission work prepared automatically;
- human interventions per active Mission;
- approval acceptance rate and edit distance.

### Intelligence quality
- Moment ranking vs human preference and observed creative performance;
- top-1/top-3 preferred-window recall on the calibration corpus;
- confidence calibration of learnings;
- percentage of recommendations supported by artist-specific evidence;
- false attribution / lineage error rate: target zero.

### Growth
- qualified reach → owned destination conversion;
- destination → listening intent / listener conversion where observable;
- saves/follows/repeat engagement;
- cost per meaningful fan action for paid growth;
- repeat fan engagement over 30/90 days once Fan Graph exists.

### Reliability
- zero cross-artist data leaks;
- zero spend-envelope violations;
- zero unapproved sensitive external effects;
- zero tenant-domain/site leakage;
- zero learning promoted from unverified attribution;
- clean migration replay, RLS tests and production reconciliation.

## 13. Definition of done

A roadmap item is complete only when:
- domain model and ownership are correct;
- migration/backfill is safe and replayable where schema changes exist;
- RLS/authorization are covered;
- server/background paths share ownership/context rules;
- failure/retry/idempotency behavior is defined;
- observability exists for important transitions;
- default UX is understandable without implementation terminology;
- Advanced preserves required expert/debug capability;
- tests cover important invariants;
- docs are updated;
- the feature is demonstrated with Atlas Irwin and at least one non-Atlas artist where multi-artist behavior matters.

## 14. Progress ledger

| Workstream | Priority | Status | Issue |
| --- | --- | --- | --- |
| Roadmap / documentation | P0 | Living / reconciled | #60 / #47 |
| Multi-artist architecture | P0 | **Complete** | #48 |
| Moments | P0 | **Complete** | #49 |
| Manager / release Missions | P0 | **In implementation — PR #111** | #108 |
| Moment-first Create | P0 | **In implementation — PR #111** | #109 |
| Moment calibration benchmark/evidence | P0 | Planned after PR #111 | #109 |
| Closed-loop learning | P0 | **Next schema/intelligence slice** | #50 |
| Structured Artist Memory | P1 | Planned after #50 | #51 |
| Smart links / pre-save / first-party attribution | P1 | Planned on Sites | #52 |
| Paid Growth experiment engine | P1 | Planned after #50/#52/#57 | #53 |
| Autonomy contracts | P1 | Planned | #57 |
| Navigation / artist-context UX | P1 | **Complete** | #58 |
| Ensemblis rebrand implementation | P1 | **Complete** | #59 |
| Ensemblis Sites core runtime + Atlas cutover | P1 | **Complete core** | #90 |
| Artist-first Sites operations UX | P1 | **In implementation — PR #111** | #90 |
| Distribution last mile / canonical credits | P1 | Planned | #56 |
| Quick Video + Creative Memory | P1 | Planned | #110 |
| Provenance & Trust | P2 | Planned | #54 |
| Fan Graph / CRM | P2 | Planned after #52 | #55 |

## 15. Immediate sequence

1. Land PR #111 with green production build and product contracts.
2. Finish #109 calibration storage/feedback and a real-track benchmark workflow.
3. Complete #50 verified closed-loop learning on existing Moment/content/publication/metric lineage.
4. Build #51 Structured Artist Memory from explicit rules + approved evidence.
5. Build #52 Smart Links/pre-save/first-party attribution on Ensemblis Sites.
6. Formalize #57 autonomy contracts across existing execution/spend boundaries.
7. Build #53 evidence-backed Paid Growth experiments once outcomes are measurable.
8. Complete #56 canonical credits/provider ingestion so Distribution no longer needs an artist-visible bridge.
9. Build #110 Quick Video + Creative Memory over the existing production engines.
10. Expand Audience into #55 Fan Graph and finish #54 provenance/trust according to dependency gates.

## 16. Production reference state

As of 2026-09-04:
- Atlas Irwin is artist data inside Ensemblis, not product identity;
- `atlasirwin.com` is served by the Ensemblis Sites runtime;
- `www.atlasirwin.com` resolves to the same tenant while canonicalizing to the apex;
- `/studio` remains isolated as the Ensemblis product/auth surface;
- public site publication uses immutable versions with preview/publish/rollback;
- domain-aware canonical metadata, robots, sitemap and manifest are active;
- future product work must preserve this production reference while removing artist-facing implementation complexity.

This document is the canonical product sequencing guide. Changes to the north star, Mission model, core loop, safety rules or dependency order must be reflected here and in #47.