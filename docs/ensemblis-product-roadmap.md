# Ensemblis Product Roadmap

**Status:** Living execution document  
**Program:** GitHub issue #47  
**Canonical branch:** `main`  
**Product:** Ensemblis  
**Production reference artist:** Atlas Irwin  
**Traditional/non-AI acceptance reference:** Cerebero Spinal  
**Last reconciled:** 2026-09-06

## 1. North star

Ensemblis turns an artist's actual music, identity, goals and evidence into the right creative and growth actions, executes safe work within the artist's rules, asks only for decisions that genuinely need the artist, and learns from verified outcomes.

The core product loop is:

`Music → Moments → Actions → Outcomes → Memory → Better decisions`

The operating promise is:

> **You make the music. Ensemblis understands what your career needs next.**

Everything we build must strengthen this loop or provide infrastructure required to keep it safe, explainable and reliable.

## 2. Positioning

Ensemblis is not a generic AI content generator, social scheduler, artist chatbot, analytics dashboard, or a bundle of disconnected Artist OS tools.

The strategic position is **music-aware artist growth and operations**:

- understand the recording, lyrics, stems, structure and identity;
- identify the musical Moments that are genuinely useful for communication and growth;
- understand the artist's scene, working style, goals and creative boundaries;
- turn evidence into artist-specific creative, release and growth decisions;
- orchestrate work as Missions and Manager actions instead of making artists operate subsystems;
- execute safe internal work automatically when allowed;
- preserve explicit approval for money, rights, sensitive communication and consequential external effects;
- own enough of the conversion layer to measure what happened;
- connect results back to their musical, creative and audience source;
- learn what works for this artist over time.

A useful external statement remains:

> **The platform that understands the song before it markets it.**

The broader brand promise remains:

> **Everything behind your music, working together.**

## 3. Product principles

### Music is the source of truth
Marketing should not begin from an empty prompt. When music exists, strategy and creative start from Track Intelligence and approved Moments.

### AI is a capability, not an artist identity
Ensemblis must work naturally for human-created, AI-assisted, hybrid and virtual projects. Traditional artists are never pushed into synthetic media or described as AI artists. Real artist media, artwork, performance material and deterministic editing come before generative assets unless the artist explicitly allows otherwise.

### Adapt to the artist instead of adding modes
The product is configured by an Artist Operating Profile, not hard-coded personas. Goals, involvement, career stage, visibility, creative comfort, AI policy, budget and autonomy change what Ensemblis prepares and what the artist sees.

### Mission before subsystem
The artist should think in outcomes such as release this track, grow this catalog release, get gigs, enter a scene, build an owned audience or fix a distribution blocker. Campaign Brain, Production, Analytics and provider operations remain engines and advanced inspectors.

### Intelligence should remove work
Primary UX answers:
1. What matters now?
2. What does Ensemblis already know?
3. What is Ensemblis doing?
4. What decision actually needs the artist?

Safe, internal, reversible work should not require a manual refresh, recalculate or scan action when product rules allow Ensemblis to prepare it.

### One musical Moment should travel end-to-end
A useful Moment keeps its identity through creative, campaign, publication, destination, performance and learning.

### Evidence over generic advice
Recommendations distinguish measured artist evidence from benchmarks and weak priors. Named scene targets require stored evidence. Weak cross-artist priors never become artist truth.

### Artist Memory is explicit
Memory is structured, inspectable, source-backed and bounded by consumer allowlists. It is never an opaque chat transcript.

### Consent is never inferred
Anonymous analytics do not silently become named fans. Communication permission is channel- and purpose-specific. Owned-audience automation may identify a consent gap, but cannot invent identity or permission.

### Safe autonomy
Internal, reversible, zero-cost work can Run. Money, legal declarations, ambiguity, sensitive communication and irreversible external effects require explicit authorization unless a valid domain contract explicitly permits the effect and all hard safety gates still pass.

### Preserve production while transforming architecture
Atlas Irwin remains the production reference artist while Ensemblis becomes reusable for very different artists. Prefer additive migrations, compatibility adapters, validation and reversible cutovers.

## 4. Current implementation state

The original Atlas-specific architecture has been substantially transformed. `main` now contains production-grade foundations for:

- explicit Workspace → Artist ownership and active-artist context;
- artist-scoped music, marketing, growth, automation and audience data;
- Track Intelligence V4, musical timeline, section/hook analysis, mastering inspection and beat stability;
- Lyrics Intelligence, Stem Intelligence and Audio Scenes;
- artist-facing Best Moments capped to a small curated set with complete musical boundaries and source lineage;
- Moment-first and outcome-first Create with exact lineage;
- Marketing Intelligence v2 with artist-specific DNA, anti-slop gates, production cards and safe campaign rebuilds;
- verified `Moment → creative → publication → metric → learning` closed-loop learning;
- Structured Artist Memory foundations and bounded consumers;
- Quick Video, automatic social delivery and artist-scoped Creative Memory;
- canonical Needs You orchestration and an artist-facing Manager read model;
- persistent artist/domain autonomy contracts v1 with audit events and conservative hard boundaries;
- native Smart Links, first-party attribution foundations, Fan Graph and explicit permission evidence;
- bounded Paid Growth experiment foundations and spend ceilings;
- provider-neutral Distribution foundations plus canonical last-mile state and explicit rights approval boundaries;
- Ensemblis Sites multi-tenant publishing, Atlas production cutover and domain-aware SEO;
- Ensemblis-native navigation, design system, mobile hierarchy and artist-first core workflows;
- Adaptive Artist Operating Profile, AI capability policy, unified Artist Operating Context, strategy snapshots and evidence-backed Scene Intelligence;
- goal-aware Manager planning for discovery, releases, gigs, fan growth, labels and owned audience;
- safe Manager execution that prepares deterministic internal Growth work for all six primary goals without silently publishing, contacting people or spending money.

The primary architectural transition delivered in PRs #153-#157 is that `I just want to make music` is now a real working relationship rather than a label. Ensemblis plans and prepares routine growth work, while consequential external effects remain governed by approval and autonomy contracts.

The main remaining gaps are no longer broad missing product foundations. They are **last-mile completeness**: broader Mission coverage beyond releases, calibration closure, one fully unified Artist Memory lifecycle, complete first-party capture/CRM flows, complete autonomy resolution at every external boundary, provider-complete Paid Growth and Distribution, and full provenance/rights manifests.

## 5. Product model

```text
User / Profile
    ↓
Workspace
    ↓
Artist
    ↓
Artist Operating Profile + Identity + Scene + Goals
    ↓
Mission / Manager Plan
    ↓
Music
    ↓
Track + Lyrics + Stem Intelligence
    ↓
Moments
    ↓
Creative + Campaign + Distribution + Owned-Web + Growth Actions
    ↓
Publication / Site / Paid Growth / Conversion / Audience Relationship
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

Cerebero Spinal is the contrasting acceptance reference for a traditional, non-AI psytrance artist who should be able to add music, let Ensemblis understand the scene and growth opportunities, and receive prepared marketing work without being required to become a marketer or adopt an AI identity.

## 6. Execution order

### Phase 0 - Orchestration and moat

#### P0.1 Multi-artist workspace architecture - #48 - **Complete**
User identity, workspace membership and artist ownership are separated. Canonical workflows carry explicit artist scope.

#### P0.2 Moments - #49 - **Complete**
Moments are first-class entities with timing, evidence, source lineage, artist review, creative/campaign references and performance rollups. Artist-facing curation now favors a few complete, useful musical moments over candidate volume.

#### P0.3 Ensemblis Manager / Missions - #108 - **Core shipped; broader Mission coverage remains open**
PRs #111, #137, #145 and #153-#157 established:
- release Mission semantics derived from canonical state;
- blocker-aware `Blocked / Needs attention / On track` readiness;
- canonical Needs You prioritization;
- a Manager read model on Today;
- goal-aware Manager planning for quiet/new artists;
- safe internal execution for all six Artist Operating Profile goals.

Remaining exit work:
- generalize Mission semantics beyond release-centric state so catalog growth, scene entry, gigs, owned audience and distribution objectives can become first-class Mission projections rather than only Manager actions;
- make every specialist failure collapse into one artist-actionable Mission blocker where a Mission exists;
- complete deterministic deep links for all Manager/Mission result types.

#### P0.4 Moment-first creation + calibration - #109 - **Core creation shipped; calibration closure remains**
Shipped:
- approved Best Moments are the normal creative source;
- Create is outcome-first and evidence-first;
- exact Moment lineage survives into production and finishing;
- weak candidates are not padded into artist-facing output;
- Track Intelligence V4 improves complete phrase/section boundaries and short-form derivation.

Remaining exit work:
- complete the durable artist calibration loop for corrected timing, semantic purpose and preferred windows;
- prove stale/master-mismatched calibration cannot influence a replacement master;
- maintain the representative private real-track benchmark with top-1/top-3 preferred-window recall and boundary regression metrics.

#### P0.5 Closed-loop learning - #50 - **Complete**
PR #113 closed the verified causal loop:
`Moment → Creative recipe → Publication → Verified provider outcome → Learning → approved bounded ranking effect`.

Only reconciled provider evidence can train the loop. Proposed learnings remain inert until approved, carry evidence/sample/confidence/expiry, and preserve artist and creative-variant isolation.

#### P0.6 Adaptive Artist Operating System / Manager - PRs #153-#157 - **Core complete**
Ensemblis now adapts to the artist rather than assuming an AI-native release marketer.

Shipped:
- Artist Operating Profile for involvement, career stage, primary goal, visibility, content comfort, cadence and budget;
- separate AI writing/visual/music/voice/likeness permissions;
- adaptive onboarding that understands music before asking working-style questions;
- unified Artist Operating Context and versioned strategy snapshots;
- evidence-backed Scene Profiles and scene relationships;
- source-first Create behavior for traditional artists;
- `I just want to make music` Manager behavior;
- proactive planning for discovery, release music, gigs, fan growth, labels and owned audience;
- safe deterministic internal preparation for all six goals;
- consent-first owned-audience gap detection using Fan Graph + Smart Link evidence;
- no new authority to publish, send outreach, spend, synthesize likeness/voice or infer consent.

### Phase 1 - Personalization, owned growth and complete release operations

#### P1.1 Structured Artist Memory - #51 - **Core foundation shipped; unified lifecycle still open**
PRs #136 and #143 provide one inspectable Artist Memory projection over explicit identity, creative rules, Creative Memory and approved verified learnings, with source lineage and bounded consumers.

Remaining exit work:
- finish edit/disable/forget lifecycle without deleting canonical evidence;
- make all strategic/autonomy/calibration sources converge on the same explicit memory contract;
- make major strategy/creative consumers explain exactly which memory items affected the result;
- close remaining source/supersession/consumer allowlist acceptance criteria in #51.

#### P1.2 Smart Links, pre-save and first-party attribution - #52 - **Core shipped; capture/lifecycle completeness open**
PR #143 shipped native artist-scoped Smart Link runtime/readback, first-party lineage and privacy boundaries.

Remaining exit work:
- finish consented contact-capture surfaces and release/campaign destination lifecycle where not already automatic;
- complete pre-release → live transitions and recovery semantics across supported release states;
- ensure every Growth/Learn consumer distinguishes known first-party lineage from unknown traffic.

#### P1.3 Evidence-backed Paid Growth - #53 - **Experiment/safety foundation shipped; provider completeness open**
PR #143 shipped bounded experiment state, hard spend ceilings, approval gates, stop conditions and evidence-backed proposal surfaces.

Remaining exit work:
- finish replaceable real-provider delivery adapters and normalized outcome reconciliation;
- ensure changed evidence recomputes useful opportunities automatically;
- close the full provider-agnostic launch/pause/stop and minimum-sample learning contract.

#### P1.4 Autonomy contracts - #57 - **v1 shipped; execution-boundary coverage open**
PR #138 shipped artist/domain Assist / Prepare / Run contracts, expiry, provider/platform restrictions, spend ceilings, deterministic resolution and append-only decision audit.

Remaining exit work:
- make every consequential external effect resolve and record the governing contract immediately before execution;
- complete Mission/Needs You explanations of the exact contract boundary;
- preserve hard overrides for sensitive communication, rights/legal declarations and Distribution.

#### P1.5 Product navigation and artist-context UX - #58 - **Complete**
Outcome-oriented Ensemblis surfaces with active artist context replace the old Atlas-specific hierarchy. Subsequent UX convergence and Component System V2 made the core flow materially quieter on desktop and mobile.

#### P1.6 Rebrand implementation / Atlas decoupling - #59 - **Complete**
Ensemblis is the product identity. Atlas Irwin remains artist data/reference production content.

#### P1.7 Ensemblis Sites / owned artist web - #90 - **Core runtime complete; conversion surfaces continue with #52**
Multi-tenant runtime, immutable/versioned publishing, private preview, domain lifecycle, trusted hostname routing, SEO identity and Atlas production cutover are complete.

#### P1.8 Distribution last mile + canonical credits - #56 - **Last-mile foundation shipped; issue remains open**
PR #143 added canonical release identity, territories, immutable submission snapshots and explicit rights approval boundaries over the provider-neutral Distribution OS.

Remaining exit work:
- finish the complete canonical credits/contributor model;
- finish provider catalog/media ingestion directly from canonical Ensemblis release data;
- remove remaining normal-path dependence on internal Operations bridges;
- reconcile required provenance data from #54 without auto-confirming legal rights.

#### P1.9 Artist-first creative UX - #110 - **Complete**
PRs #115-#118 shipped Quick Video, shared durable Director state, representative-preview/budget flow, automatic master + socials delivery, exact approved-Moment lineage and artist-scoped Creative Memory retrieval. Director Pro preserves expert controls and existing spend safety.

### Phase 2 - Relationship and trust expansion

#### P2.1 Provenance and Trust - #54 - **Operating-policy foundation shipped; full provenance manifest open**
PR #153 added project creation mode and explicit per-artist AI capability policy so human/non-AI artists remain conservative by default.

Remaining issue scope:
- per-track provenance for composition, lyrics, vocals, artwork and video;
- rights/consent evidence references;
- versioned platform/distributor disclosure requirements;
- distribution/publishing compatibility checks;
- exportable provenance manifest;
- no inference of legal ownership from generation metadata.

#### P2.2 Fan Graph / first-party CRM - #55 - **Core Fan Graph shipped; CRM completeness open**
PR #143 shipped artist-scoped fan profiles, identities, engagement, consent permissions, evidence-backed merge rules, export/delete paths and Audience integration. PR #157 made Manager owned-audience preparation consume only verified identities with current purpose-specific permission.

Remaining exit work:
- complete consented acquisition/capture workflows from #52;
- complete reusable audience segments without duplicating identity logic;
- broaden relationship-history/next-action UX while preserving safe-reply review;
- prove end-to-end acquisition → repeat engagement → revocation/delete behavior across supported sources.

### Later / conditional

- royalties and financial operations;
- touring and booking operations beyond opportunity/strategy support;
- merchandise;
- broad label ERP functionality;
- generic workflow builders;
- named AI-agent personas;
- a chat-first primary interface.

These remain intentionally deferred until the core music-aware growth loop proves sustained value.

## 7. Artist Operating Profile and Manager model

The Artist Operating Profile is configuration, not a persona label. It defines how Ensemblis should work for an artist through bounded dimensions such as:
- project provenance mode;
- marketing involvement;
- career stage;
- primary goal;
- visibility and content comfort;
- release cadence;
- budget;
- AI capability policy;
- autonomy contracts.

`I just want to make music` changes behavior, not only copy. Routine internal growth preparation belongs to Ensemblis. The artist should be interrupted only when judgment, permission, money, rights or a consequential external effect actually needs them.

The Manager may currently prepare deterministic internal Growth work for:
1. discovery;
2. release strategy;
3. gigs/live strategy;
4. fan growth;
5. labels/partners;
6. owned audience.

Manager execution is not a blanket autopilot. The safe executor is allowlisted and does not silently publish, send outreach, contact fans, spend money or run paid/generative providers.

## 8. Mission model

A Mission is not another manually maintained task table. It is a semantic projection over canonical product state.

A Mission answers:
- **Outcome:** what are we trying to accomplish?
- **State:** blocked, needs attention, on track, or archived;
- **Required:** what truly blocks the outcome?
- **Recommended:** what materially improves the outcome but is not a hard blocker?
- **Optional:** what is worth reviewing without manufacturing work?
- **Working:** what Ensemblis is already doing;
- **Next decision:** the single best human action when one exists;
- **Next milestone:** what Ensemblis is moving toward.

Release Mission semantics are production-ready. The next Mission expansion should reuse canonical Growth/Scene/Audience/Distribution state rather than create a second checklist database.

## 9. Moment model

A Moment minimally answers:
- **Where?** start/end in the canonical track;
- **What?** chorus lift, vocal cold open, lyric line, breakdown, instrumental hook, transition, etc.;
- **Why?** supporting audio/lyric/stem evidence;
- **How strong?** internal ranking signals plus artist-facing evidence language;
- **What can we do with it?** recommended creative/campaign purposes;
- **What happened when we used it?** linked creative and verified outcome evidence.

Artist-facing Moment curation prioritizes complete useful musical units and caps output rather than exposing raw candidate volume.

## 10. Learning model

Closed-loop learning is structured evidence, not generated advice text.

A learning answers:
1. what was compared or observed;
2. artist/release/track/platform/format scope;
3. exact verified attributed evidence;
4. sample size and relevant outcome totals/rates;
5. confidence and data-quality state;
6. observation window and freshness/expiry;
7. a bounded recommendation understood by explicit consumers;
8. candidate → approved/rejected/superseded lifecycle.

No learning influences future decisions merely because an LLM phrased it persuasively.

## 11. Artist Memory model

Memory classes:
1. **Identity** - sound, voice, visual world, audience, positioning.
2. **Creative rules** - explicit do/don't constraints.
3. **Preference evidence** - approvals/rejections, edits and Moment calibration.
4. **Performance learnings** - approved evidence-backed observations.
5. **Strategic constraints** - goals, cadence, budget and priorities.
6. **Provenance/compliance** - project-specific disclosure and rights constraints.

Each memory item needs source, scope, confidence, timestamps, lifecycle and explicit consumer permissions.

## 12. Scene Intelligence model

Scene Intelligence answers where the artist's music plausibly belongs in the real world without inventing credibility or targets.

Relationships may include:
- artists and micro-scenes;
- labels;
- playlists and channels;
- DJs;
- promoters;
- venues and festivals;
- geographic markets.

Every named relationship needs stored evidence, confidence, freshness and source. Candidate relationships remain weak context until verified enough for a relevant consumer. Scene Intelligence feeds Strategy and Growth Opportunities rather than becoming another artist-visible database to maintain.

## 13. Autonomy model

| Domain | Default posture |
| --- | --- |
| Analytics / reconciliation | Run |
| Track/Lyrics/Stem analysis | Run |
| Moment proposal/calibration processing | Run |
| Creative ideation | Run |
| Low-cost generation | Prepare |
| Expensive generation | Ask unless explicitly budgeted |
| Social scheduling | Prepare |
| Social publishing | Prepare |
| Audience replies | Prepare |
| Sensitive replies | Always ask |
| Paid growth | Ask or Run only inside an explicit valid spend contract |
| Outreach | Prepare |
| Sites draft preparation | Prepare |
| Sites publishing/domain changes | Ask unless explicitly contracted |
| Distribution | Always ask by default |

Domain autonomy never overrides hard provider, spend, consent, legal, rights or irreversible-effect safeguards.

## 14. Cross-artist acceptance contract

Every product-critical feature must be reviewed against at least two substantially different artist references.

### Atlas Irwin
- AI-assisted/hybrid creation can be allowed;
- stylized/no-face visual identity;
- content and audience growth are central;
- generative visuals may be useful when artist policy permits;
- music-aware social creative and catalog/release growth are important.

### Cerebero Spinal
- traditional/non-AI psytrance creation;
- AI music identity must stay absent;
- source media and real artist assets come first;
- scene discovery, labels, promoters, festivals, playlists/channels and outreach preparation are especially important;
- `I just want to make music` should reduce marketing work, not create another workflow to manage.

A feature fails this acceptance contract if it assumes AI-generated music, assumes the artist wants to be on camera, invents scene facts, or increases routine marketing labor for the hands-off artist.

## 15. Success metrics

### Product usefulness
- time from adding a track to first useful recommendation;
- percentage of releases/tracks with usable approved Moments;
- percentage of Manager/Mission work prepared automatically;
- human interventions per active Mission;
- approval acceptance rate and edit distance;
- percentage of hands-off Manager actions that become truthful Prepared work vs no-op/retry.

### Intelligence quality
- Moment ranking vs human preference and observed creative performance;
- top-1/top-3 preferred-window recall on the calibration corpus;
- confidence calibration of learnings;
- percentage of recommendations supported by artist-specific evidence;
- named scene-target evidence coverage;
- false attribution / lineage error rate: target zero.

### Growth
- qualified reach → owned destination conversion;
- destination → listening intent / listener conversion where observable;
- saves/follows/repeat engagement;
- permissioned relationship growth without inferred consent;
- cost per meaningful fan action for paid growth;
- repeat fan engagement over 30/90 days.

### Reliability
- zero cross-artist data leaks;
- zero spend-envelope violations;
- zero inferred communication permissions;
- zero unapproved sensitive external effects;
- zero tenant-domain/site leakage;
- zero learning promoted from unverified attribution;
- clean migration replay, RLS tests and production reconciliation.

## 16. Definition of done

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
- Atlas Irwin and at least one materially different non-Atlas artist pass the relevant acceptance contract where multi-artist behavior matters.

A roadmap issue may remain open after its core foundation ships when the issue's broader last-mile acceptance criteria are not yet satisfied. The roadmap must say `Core shipped; remaining...` instead of mislabeling that work as either fully Planned or fully Complete.

## 17. Progress ledger

| Workstream | Priority | Status | Issue / PR |
| --- | --- | --- | --- |
| Roadmap / documentation | P0 | Living / reconciled 2026-09-06 | #60 / #47 |
| Multi-artist architecture | P0 | **Complete** | #48 |
| Moments / Best Moments | P0 | **Complete core** | #49 / #114 / #142 |
| Manager / release Missions | P0 | **Core shipped; broader Mission coverage open** | #108 / #111 / #137 / #145 / #153-#157 |
| Moment-first Create | P0 | **Core shipped** | #109 / #111 / #141 / #145 |
| Moment calibration benchmark/evidence | P0 | **Remaining** | #109 |
| Closed-loop learning | P0 | **Complete** | #50 / #113 |
| Adaptive Artist Operating System | P0 | **Core complete** | #153-#157 |
| Structured Artist Memory | P1 | **Core foundation shipped; lifecycle open** | #51 / #136 / #143 |
| Smart links / pre-save / first-party attribution | P1 | **Core shipped; lifecycle/capture open** | #52 / #143 |
| Paid Growth experiment engine | P1 | **Core shipped; provider completeness open** | #53 / #143 |
| Autonomy contracts | P1 | **v1 shipped; boundary coverage open** | #57 / #138 |
| Navigation / artist-context UX | P1 | **Complete** | #58 / #145 / #148 / #152 |
| Ensemblis rebrand implementation | P1 | **Complete** | #59 |
| Ensemblis Sites core runtime + Atlas cutover | P1 | **Complete core** | #90 |
| Distribution last mile / canonical credits | P1 | **Foundation shipped; last mile open** | #56 / #143 |
| Quick Video + Creative Memory | P1 | **Complete** | #110 / #115-#118 |
| Provenance & Trust | P2 | **Artist-policy foundation shipped; full manifest open** | #54 / #153 |
| Fan Graph / CRM | P2 | **Core shipped; CRM completeness open** | #55 / #143 / #157 |

## 18. Immediate sequence

The next work should close real last-mile gaps instead of opening another breadth program.

1. **Broaden #108 Mission coverage** so non-release artist goals can become first-class semantic Mission projections over existing Growth, Scene, Audience and Distribution state.
2. **Finish #109 calibration** with durable correction/preferences, master provenance safety and the private real-track ranking benchmark.
3. **Finish #51 Structured Artist Memory** lifecycle and consumer traceability so strategy/creative can explain exactly which bounded memories influenced a result.
4. **Finish #52 owned conversion/capture lifecycle** on top of existing Smart Links and Fan Graph without inferred identity or consent.
5. **Finish #57 execution-boundary coverage** so every consequential external effect resolves/audits its active contract immediately before execution.
6. **Finish #53 provider-complete Paid Growth** once #52/#57 last-mile contracts are closed.
7. **Finish #56 canonical credits/provider ingestion** so Distribution can operate entirely from the normal Release workspace.
8. **Finish #55 CRM completeness** for consented acquisition, reusable segments and repeat-engagement journeys.
9. **Finish #54 full provenance/trust** with track/media provenance, evidence references, disclosure compatibility and exportable manifests.

Do not add a new primary navigation area for these. Extend the existing Manager, Mission, Music, Create, Grow, Audience, Release, Library and Settings surfaces.

## 19. Production reference state

As of 2026-09-06:
- Atlas Irwin is artist data inside Ensemblis, not product identity;
- `atlasirwin.com` is served by the Ensemblis Sites runtime;
- `www.atlasirwin.com` resolves to the same tenant while canonicalizing to the apex;
- `/studio` remains isolated as the Ensemblis product/auth surface;
- public site publication uses immutable versions with preview/publish/rollback;
- domain-aware canonical metadata, robots, sitemap and manifest are active;
- Track Intelligence V4 and Mastering Inspector are production foundations;
- the verified Moment-to-learning loop is implemented;
- native Smart Links, Fan Graph, Paid Growth foundations, autonomy contracts v1 and Distribution last-mile foundations exist;
- Adaptive Artist Operating Profile and safe goal-aware Manager preparation are implemented;
- future work must preserve these production references while continuing to remove artist-facing implementation complexity.

This document is the canonical product sequencing guide. Changes to the north star, Artist Operating Profile, Mission model, core loop, safety rules or dependency order must be reflected here and in #47.
