# Marketing Intelligence v2

Ensemblis treats campaign planning as an artist-specific decision system, not a post generator.

## Core flow

Artist Marketing DNA -> Creative Memory -> approved music Moments -> full fandom funnel -> dynamic content pillars -> platform directors -> candidate concepts -> publishability/duplication gates -> Production Cards -> artist approval -> publishing -> artist-normalized performance learning.

## Artist Marketing DNA

The product layer supports mixed artist identities rather than one universal posting template. It scores seven archetypes from explicit brand/release evidence and remembered creative decisions:

- Performer
- Storyteller
- Producer
- Selector / DJ
- World Builder
- Community Artist
- Faceless / Virtual

One archetype is primary and up to two evidence-backed secondary archetypes can influence the campaign.

## Full fandom funnel

Every campaign is planned across the complete relationship rather than stopping at clicks or conversion:

1. Discovery: earn native attention from strangers.
2. Interest: turn curiosity into artist/profile/catalogue exploration.
3. Resonance: create emotional or identity value worth saving or sharing.
4. Relationship: deepen recurring connection through personality, process and community.
5. Listening: convert social interest into intentional full-track listening.
6. Fandom: reward return behavior with catalogue, participation, UGC and scene belonging.
7. Superfan: support advocacy, attendance, collecting and participation without over-monetizing the relationship.

Content goals map to the appropriate funnel job instead of treating reach as the final objective. This seven-stage model is the canonical product vocabulary exposed by Campaign Intelligence and persisted in the v2 strategy output.

## Dynamic content pillars

Ensemblis chooses up to six relevant pillars from a canonical system rather than forcing every artist through the same mix:

`Music · Story · Process · World · Personality · Community · Proof · Conversion · Catalogue`

Pillars are priority-scored using the current campaign objective, artist archetypes, release evidence, existing catalogue history and Creative Memory. For example, a Streams campaign cannot accidentally lose Conversion because lower-priority personality content filled the quota first.

## Creative Memory integration

Marketing Intelligence consumes the existing artist-scoped Creative Memory rather than creating a parallel preference store. The campaign planner receives:

- reinforced and discouraged artist preferences;
- ranked reference assets and their reasons;
- semantic and visual descriptors;
- approval/rejection evidence;
- duplicate/canonical-asset evidence;
- attributable performance already used by Creative Memory ranking.

The repository does not currently have an embedding/vector similarity service, so Marketing Intelligence does not pretend that it does. Semantic descriptors from Creative Memory are folded into the existing previous-creative fingerprints, making duplicate detection descriptor-aware without adding a paid model, new database schema or fabricated vector search.

## Core invariants

- Surface at most five strong, non-overlapping, approved musical Moments. Preserve their canonical millisecond boundaries through `moment_id`.
- Never backfill generic content to satisfy a quota. Fewer strong ideas are preferable to more weak ones.
- A music-led video without an approved curated Moment fails closed.
- Instagram, TikTok and YouTube receive platform-native executions rather than identical cross-posts.
- Real artist/release media is preferred. Generative media is a production capability, not the default aesthetic.
- Paid creative generation is blocked until artist-specificity, visual lineage, platform geometry, anti-slop and deterministic-finishing gates pass.
- Artist approvals and structured rejections become artist-scoped marketing memory.
- Performance is interpreted relative to the artist's own baseline before it changes future decisions.
- Creative Memory remains artist-scoped and is reused rather than duplicated into a second preference system.
- Internal ranking scores may order candidates, but artist-facing UX uses qualitative decisions and evidence rather than presenting uncalibrated percentages as truth.

## Campaign workspace

The Execution surface keeps scheduling, experiments, metrics, publishing and automation. Campaign Intelligence is the planning/creative-decision surface and is the only campaign rebuild path exposed by the workspace.

The rebuild path uses staged replacement semantics. Existing replaceable campaign work stays intact while the new experiment/content/variant/attribution graph is written. If staging or the campaign switch fails, staged rows are cleaned and the previous campaign-Moment lineage is restored. Only after the new strategy is active does Ensemblis clean the previous replaceable plan.

Post-commit cleanup and telemetry are best-effort. A cleanup or audit-event failure after the new plan is already active must never be reported as if the campaign rebuild itself failed, because that could encourage a duplicate rebuild. Such failures are logged as operational warnings instead.

This is deliberately safer than delete-first replacement, but it is not described as a single database transaction. Concurrent rebuild serialization remains a separate infrastructure concern rather than something the product pretends is guaranteed.

## Music integrity

`content_items.audio_timestamp_start/end` remain legacy coarse-second fields. `content_items.moment_id` is the exact source of truth. Final social finishing resolves the approved Moment's `start_ms/end_ms`, and the final master follows the full musical window even when a raw generative video plate is shorter.

An Audio Scene may be used for finishing only when its own source window covers the complete approved Moment. When it covers the Moment, finishing offsets into the scene using the exact Moment start. When it does not, Ensemblis may fall back only to a distinct canonical master reference; otherwise finishing fails closed instead of silently using the wrong musical section.

## Evidence-first quality UX

Publishability, specificity and duplicate-risk calculations are internal ranking tools. They are useful for sorting, gating and diagnostics, but they are not calibrated probabilities and are not shown to the artist as pseudo-precise quality scores.

Campaign Intelligence instead exposes:

- whether a candidate is strong or still needs review;
- the evidence and rejection reasons behind that decision;
- the selected Artist Marketing DNA and secondary archetypes;
- the dynamic content pillars chosen for this campaign;
- the exact musical Moment and timing;
- the funnel job, platform role, audience, shot list, assets, CTA and KPI.

This keeps the system explainable without pretending that an internal heuristic such as `82/100` is an objective measure of creative quality.

## Quality philosophy

Ensemblis can generate many candidate ideas internally, but only publishability-qualified work reaches the artist. The quality system rejects generic promotional tropes, low artist specificity, duplicate concepts, invalid musical cuts and non-native platform treatments. A campaign with two excellent ideas should surface two, not invent three weak ones to reach five.
