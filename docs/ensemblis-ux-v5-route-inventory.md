# Ensemblis UX V5 Route Inventory

**Status:** Canonical V5 route ownership and discoverability contract — reconciled against PR #290 implementation
**Date:** 2026-10-06
**Architecture:** `docs/ensemblis-ux-architecture-v5.md`

## Contract

Route existence does not imply product prominence.

Every protected Studio route has:
- one V5 owner;
- one natural discovery path;
- one default visibility level;
- one intended role;
- an explicit Launcher policy.

Visibility levels:
- **Primary** â€” normal workspace/object journey.
- **Contextual** â€” normal only when the current object/action requires it.
- **Advanced** â€” intentionally opened expert/detail surface.
- **Compatibility** â€” retained for deep links/migration; must not define the product mental model.

Launcher policy:
- **Direct** â€” may appear as a normal intent result.
- **Context only** â€” reachable only when query/object context makes it appropriate.
- **Hidden** â€” never advertised as a normal destination.

## Primary and object routes

| Route | V5 owner | Role | Visibility | Natural discovery | Launcher |
| --- | --- | --- | --- | --- | --- |
| /studio | Today | Operating surface | Primary | Primary nav | Direct |
| /studio/needs-you | Today | Decision queue | Contextual | Today / intent | Direct |
| /studio/music | Music | Object library | Primary | Primary nav | Direct |
| /studio/music/[id] | Music | Track object | Primary | Music / search / intent | Direct |
| /studio/music/import | Music | Music intake workflow | Contextual | Add music | Context only |
| /studio/music/automix | Music | Mix workflow | Contextual | intent / Music / Track | Direct |
| /studio/releases | Music | Release collection projection | Primary-within-Music | Music â†’ Releases | Direct |
| /studio/releases/new | Music | Release creation workflow | Contextual | Prepare release | Direct |
| /studio/releases/[id] | Music | Release object | Primary object | Music / search / Continue | Direct |
| /studio/create | Global action | Outcome launcher | Contextual | global Create / object action | Direct |
| /studio/create/visual/[id] | Create | Release Visual staged workflow | Contextual | Create visual / Release / intent / Continue | Context only |
| /studio/create/loop/[id] | Create | Living Artwork motion continuation | Contextual | approved visual → Animate / explicit motion intent | Context only |
| /studio/video | Create | Video workflow | Contextual | Create / Release | Context only |
| /studio/video/[id] | Create | Creative asset object | Contextual | Continue / asset | Context only |
| /studio/growth | Grow | Growth workspace | Primary | Primary nav | Direct |
| /studio/library | More | Reusable media library | Contextual utility | More / search | Direct |
| /studio/sites | More | Owned destinations | Contextual utility | More / Release | Direct |
| /studio/settings | Settings | Configuration home | Contextual utility | More | Direct |
## Contextual and advanced routes

| Route | V5 owner | Role | Visibility | Natural discovery | Launcher |
| --- | --- | --- | --- | --- | --- |
| /studio/releases/[id]/distribution | Release | Deep delivery workflow | Contextual | Release â†’ Distribution | Context only |
| /studio/production | Create | Creative Assets compatibility workspace | Advanced | asset Continue / Create advanced | Context only |
| /studio/content | Create | Specialist content lab | Advanced | Create advanced | Hidden |
| /studio/growth/strategy | Grow | Strategy explanation | Advanced | Why this? | Context only |
| /studio/growth/paid | Grow | Paid test workflow | Contextual | Opportunity / approval | Context only |
| /studio/analytics | Grow | Deep analytics | Advanced | Performance â†’ detail | Hidden |
| /studio/audience | Grow | Audience lens | Contextual | Grow â†’ Audience | Context only |
| /studio/audience/fans/[id] | Grow | Fan detail | Advanced/contextual | Audience | Hidden |
| /studio/campaigns | Grow / Release | Campaign specialist collection | Advanced | Promotion / opportunity | Hidden |
| /studio/campaigns/[id] | Grow / Release | Campaign object | Advanced/contextual | Release / Grow | Context only |
| /studio/campaigns/[id]/intelligence | Campaign | Technical intelligence | Advanced | Campaign â†’ technical detail | Hidden |
| /studio/calendar | Grow | Planning detail | Advanced/contextual | In motion / Coming up | Context only |
| /studio/outreach | Grow | Outreach workflow | Contextual | Opportunity / Needs You | Context only |
| /studio/outreach/[id] | Grow | Outreach object | Contextual | Outreach / Needs You | Hidden |
| /studio/learn | Grow | Learning evidence | Advanced | Results / Why | Hidden |
| /studio/media | Library | Media maintenance | Advanced | Library advanced | Hidden |
| /studio/sites/smart-links | Sites / Release | Smart-link detail | Contextual | Sites / Release | Context only |
| /studio/settings/artist | Settings | Artist operating profile | Contextual | Settings / Why | Context only |
| /studio/settings/ai | Settings | AI policy | Advanced | Settings | Hidden |
| /studio/settings/autonomy | Settings | Autonomy policy | Advanced | Settings / decision explanation | Hidden |
| /studio/settings/brand | Settings | Brand profile | Contextual | Settings / Create | Context only |
| /studio/settings/brand/visual | Settings | Visual brand detail | Advanced | Brand profile | Hidden |
| /studio/settings/social/[platform] | Settings | Social platform configuration | Advanced | Connections | Hidden |
| /studio/connections | Settings | Connection hub | Contextual utility | intent / Settings | Direct |
| /studio/memory | Settings | Artist knowledge inspection | Advanced | Why this? / Settings | Hidden |
| /studio/data-health | Settings / Recovery | Technical recovery | Advanced | contextual blocker | Hidden |
| /studio/spotify | Settings | Provider specialist | Advanced | Connections | Hidden |
| /studio/soundcloud | Settings | Provider specialist | Advanced | Connections | Hidden |
## Compatibility routes

| Route | V5 owner | Intended final state |
| --- | --- | --- |
| /studio/inbox | Today | approvals/history only; never a second decision center |
| /studio/autopilot | Today / Settings | redirect or quiet status projection |
| /studio/tasks | Today | specialist operations only |
| /studio/distribution | Release | compatibility/specialist hub; normal work stays inside Release |
| /studio/distribution/operations | Release | provider operations only |
| /studio/growth/import | Grow | redirect/retire |
| /studio/brand | Settings | compatibility route; editing belongs to Brand profile |

## Acceptance rules

A route fails V5 if:
1. a normal user must know the route exists to complete a common goal;
2. it creates a second mental model for a capability already owned elsewhere;
3. it appears in primary navigation despite being contextual/advanced;
4. it exposes implementation terminology as a normal destination;
5. it loses artist/object context when entered from a canonical object;
6. a compatibility route becomes the only path to a user-facing capability.

This inventory must be reconciled again on the final PR head before merge.

PR #290 implements `/studio/create/visual/[id]` as the contextual Release Visual owner and keeps `/studio/create/loop/[id]` as its optional motion continuation.


## Human-factors containment reconciliation — 2026-10-04

The V5 route ownership remains valid after the human-factors recovery.

- Track technical analysis and mastering engineering evidence are intentionally opened from the Track object through contextual disclosure/inspectors rather than advertised as destinations.
- Grow strategy, paid tests, analytics and campaign machinery remain contextual or advanced; the default Grow surface owns the recommendation.
- Release engineering detail remains subordinate to the lifecycle Overview and the facet that owns the job.
- AutoMix DJ intelligence, library bridge and Rekordbox tooling remain advanced within the staged mix workflow.
- The Action Launcher remains intent/object oriented. Hidden specialist routes are not promoted into a tool directory.
- Human-factors telemetry records only normalized categories, surfaces, workflow stage IDs and timing. It does not accept raw launcher queries or creative text.
