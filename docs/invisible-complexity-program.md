# Ensemblis Invisible Complexity Program

**Program issue:** #119  
**Foundation issues:** #120 Artist Memory, #121 Needs You / Manager v2  
**North star:** Give Ensemblis the music and the intended outcome; Ensemblis handles safe work and interrupts the artist only when judgment, permission, money, legal declarations, ambiguity or irreversible external effects genuinely require it.

## Product test

Every feature must answer one question:

> Does this give the artist another system to operate, or remove something they previously had to operate?

Normal product surfaces should remove work. Specialist machinery remains available through progressive disclosure and Advanced surfaces.

## Target experience

```text
Artist
  ↓
Today / Manager
  ├─ What matters now
  ├─ What Ensemblis already knows
  ├─ What Ensemblis is doing
  └─ What genuinely Needs You
        ↓
      Mission
        ↓
Music → Moments → Creative / Distribution / Growth / Owned Web
        ↓
     Outcomes
        ↓
Verified learning
        ↓
  Artist Memory
        ↓
Better future decisions
```

## Product invariants

1. **Mission before subsystem.** A release, growth goal or creative outcome is the artist-facing unit of work.
2. **Needs You is a projection, not a task database.** Resolving canonical source state resolves the queue item.
3. **Artist Memory is structured evidence, not chat history.** Every item exposes source, scope, confidence, freshness/lifecycle and allowed consumers.
4. **Explicit artist guidance wins.** Brand/identity rules outrank inferred creative preferences and weak performance evidence.
5. **Verified evidence before learning.** Only correctly attributed, approved and unexpired findings can influence future decisions.
6. **Autonomy is contractual.** Assist / Prepare / Run behavior is resolved per artist/domain with hard safety overrides.
7. **External effects remain gated.** Spend, publishing, distribution, sensitive communication and irreversible changes require explicit authority.
8. **One musical Moment travels end to end.** Moment lineage survives creative, publication, destination, outcome and learning.
9. **One obvious primary action per normal screen.** Provider/model/debug controls belong under Advanced unless the artist explicitly asks for them.
10. **No hidden work.** Ensemblis shows what is running, blocked, waiting, and why, without exposing worker plumbing.

## Implementation sequence

### Slice A — Foundation
Status: **in implementation**

- canonical `ArtistMemoryItem` / `ArtistMemorySnapshot` contract;
- aggregate explicit brand settings, reviewed Creative Memory and approved verified learnings;
- artist-facing Memory explanation surface;
- canonical `NeedsYouItem` projection contract;
- initial queue from release Mission blockers, approval gates, outreach drafts, manual publication handoffs, catalog ambiguity, missing creative, due tasks and learning proposals;
- dedicated Needs You surface and shell access;
- contract tests protecting artist-scope, source-backed memory and non-duplicated decision state.

Exit criteria:
- Artist Memory answers “why does Ensemblis believe this?”;
- explicit and learned evidence are visibly distinct;
- expired evidence is retained as history but does not appear active;
- Needs You is derived from canonical state and prioritizes hard Mission blockers;
- primary work navigation remains Today / Music / Releases / Create / Grow / Audience / Library.

### Slice B — Autonomy contracts
Issues: #122

- Assist / Prepare / Run per artist and domain;
- provider/platform allow-lists;
- spend ceilings and expiry;
- optional Mission/release overrides;
- sensitivity/legal/irreversibility overrides;
- governing contract snapshot recorded immediately before external execution;
- artist-facing explanation and audit trail.

### Slice C — Manager v2
Issues: #121, #131

- Today consumes the universal Needs You projection directly;
- all release, creative, distribution, Sites, publishing, audience and paid-growth blockers converge into the queue;
- Manager shows one active Mission outcome, what Ensemblis knows, autonomous work, exact next decision and next milestone;
- subsystem failures collapse into artist-actionable blockers;
- internal repair stays automatic when safe.

### Slice D — Automatic Music ingestion
Issue: #129

`Add music → Track Intelligence → structure → lyrics → stems when available → Best Moments → creative opportunities → Mission recommendation`

Normal path contains no Analyze / Recalculate / Find hooks / Scan buttons. Advanced repair controls remain available for failure recovery.

### Slice E — UX consolidation and outcome-first Create
Issues: #123, #130, #132, #134

- preserve the seven-item work navigation;
- progressively hide specialist tooling under Advanced;
- Create starts from an approved Moment or desired outcome;
- three strong artist-specific directions beat large provider/model choice grids;
- quieter loading, empty and error states;
- mobile, keyboard and accessibility polish;
- shared language for Blocked / Needs attention / On track, Required / Recommended / Optional, Working / Needs You and confidence/freshness.

### Slice F — Owned growth
Issue: #124

- Smart Links;
- pre-save and automatic pre-release → live transition;
- campaign landing pages;
- first-party conversion lineage;
- privacy-respecting analytics;
- verified conversions available to learning and Artist Memory.

### Slice G — Distribution, Audience and Paid Growth
Issues: #125, #126, #127

- canonical credits and artist-first distribution last mile;
- consent-aware Fan Graph and relationship history;
- evidence-backed paid experiments governed by autonomy contracts.

## Artist Memory authority order

```text
Explicit artist rule
      ↓
Artist-reviewed preference evidence
      ↓
Approved verified performance learning
      ↓
Weak/default prior
```

A lower layer never silently overrides a higher layer.

Memory classes:

- Identity
- Creative rules
- Preference evidence
- Performance learnings
- Strategic constraints
- Provenance / compliance

Every consumer declares which classes it may read. There is no global opaque “memory prompt”.

## Universal Needs You priority

```text
Required Mission blocker
      ↓
External-effect / approval decision
      ↓
Ambiguous reconciliation / handoff
      ↓
Creative or operational review
      ↓
Evidence-backed learning review
```

The queue has no independent completion checkbox. Items disappear only because their source state changed.

## Quality program

Issue: #128

Measure:

- time from adding music to first useful recommendation;
- human interventions per active Mission;
- percentage of Mission work prepared automatically;
- approval acceptance rate and edit distance;
- Moment top-1/top-3 human-preference recall;
- percentage of recommendations supported by artist-specific evidence;
- first-track onboarding completion;
- release-from-zero completion;
- false attribution / artist-isolation errors: target zero;
- mobile/accessibility regressions;
- recovery success after failed analysis/generation/provider jobs.

## What we intentionally do not do

- no chat-first primary interface;
- no generic workflow builder as the product model;
- no named AI-agent theater;
- no arbitrary readiness percentages;
- no automatic learning from manual/unreconciled metrics;
- no hidden fingerprinting;
- no cross-artist preference leakage;
- no provider/model plumbing on default artist paths;
- no duplicated Mission/task database.
