# Ensemblis Artist Operating System

## Purpose

Ensemblis must work equally well for an AI-native/hybrid artist and for a human artist who already knows how to make excellent music but does not want to become a marketer.

AI is therefore a capability behind the product, not a required artist identity. The product starts from the real artist and real music, learns how the artist wants Ensemblis to operate, understands the surrounding scene from evidence, and turns that context into the next useful career action.

## Product loop

```text
Artist + Music
      ↓
Track / Lyrics / Stem Intelligence
      ↓
Artist Operating Profile
      ↓
Artist Operating Context
      ├── identity + provenance
      ├── goals + career stage
      ├── marketing involvement
      ├── visibility + content comfort
      ├── AI policy
      ├── budget + autonomy
      ├── Scene Intelligence
      ├── Artist Memory
      └── outcomes / learnings
      ↓
Structured Artist Strategy
      ↓
Mission / Growth Opportunity / Create / Outreach
      ↓
Outcomes → evidence-backed learning → Artist Memory
```

This extends, rather than replaces, the canonical `Music → Moments → Actions → Outcomes → Memory` loop.

## Artist Operating Profile

`artist_operating_profiles` stores only decisions Ensemblis should not infer casually:

- marketing involvement: `hands_on`, `guided`, `just_make_music`;
- career stage and current primary goal;
- artist visibility and comfortable source-media types;
- release cadence and strategic monthly budget context;
- AI policy for writing, visuals, music, voice and likeness;
- disclosure preference.

The absence of a row is meaningful: the artist has not explicitly configured these preferences. Runtime defaults are conservative and project-type aware. Existing artists are deliberately not backfilled with invented preferences.

### “I just want to make music”

This is an operating contract, not a cosmetic mode. Today should prepare safe internal work and surface only consequential judgment, spend, sensitive communication or external actions. Existing Autonomy Contracts remain the authority for whether external work may actually run.

## Adaptive onboarding

Onboarding order is intentionally:

1. Confirm artist identity only when bootstrap identity is not sufficient.
2. Add one real master.
3. Let Track Intelligence understand it.
4. Ask five operating questions the music cannot answer.
5. Choose the next Mission from the artist goal.

A release is no longer mandatory for activation. `release_music` can continue into Release Mission + Moment curation. A goal such as gigs, discovery, labels or owned audience can instead enter the appropriate strategic path.

## Scene Intelligence

Scene Intelligence has two layers:

- `artist_scene_profiles`: explicit/inferred scene context, sub-scenes, geographic affinities and confidence.
- `artist_scene_relationships`: evidence-backed relationships to similar artists, labels, playlists, channels, promoters, venues, festivals, markets and communities.

Named ecosystem targets are never invented merely because an LLM knows a genre. A usable relationship requires structured evidence, sufficient confidence and non-expired evidence. Verified relationships cannot exist with an empty evidence object.

Scene-derived actions reuse the existing `growth_opportunities` queue through the new kinds `scene_fit`, `outreach_target`, `gig_fit`, `label_fit`, `playlist_fit` and `channel_fit`. This avoids a competing opportunity system.

## Strategy

`buildArtistStrategy()` is deterministic over the current Artist Operating Context. It produces structured fields instead of an essay:

- positioning;
- current growth focus;
- channel priorities;
- source-first content strategy;
- release strategy;
- outreach strategy;
- explicit “do not” rules;
- human-intervention posture;
- one recommended semantic Mission.

Snapshots are versioned in `artist_strategy_snapshots`. Canonical evidence remains in its source domain and is referenced through source context.

## Source-first Create

Creative priority is:

```text
Real artist media
→ live/studio footage
→ photography
→ artwork
→ music visualisation
→ deterministic editing
→ AI-assisted enhancement
→ generative visuals only when explicitly allowed
```

For human artists, AI music, generative visuals, voice and likeness are conservative by default. Create loads the same Artist Operating Context and pushes the policy into production notes so downstream creative work receives the artist boundary alongside Moment and Artist Memory context.

## Acceptance archetypes

| Requirement | Human psytrance artist | AI/hybrid reference artist |
| --- | --- | --- |
| Music generation | Off unless explicitly enabled | May be enabled |
| Real masters / Track Intelligence | Primary source | Primary source |
| Moment intelligence | Yes | Yes |
| Generative visuals | Optional, off by default for human project | May be enabled |
| Synthetic voice / likeness | Off by default | Still explicit opt-in |
| Main growth path | Scene, discovery, gigs, labels, outreach | Release/content/audience as appropriate |
| Marketing involvement | Can be `just_make_music` | Any mode |
| Create behavior | Source-first | Source-first, then permitted generation |
| Scene targets | Evidence required | Evidence required |

A feature fails this architecture if it assumes AI-generated music, assumes a face-forward artist, fabricates a scene target, forces every goal into a release, or gives a `just_make_music` artist more marketing admin instead of less.

## Safety and ownership invariants

- Every new table is artist-scoped through workspace membership and the existing Studio admin gate.
- Client-provided artist IDs do not determine access.
- AI policy does not weaken Autonomy Contracts, spend ceilings, distribution confirmation or sensitive-communication gates.
- Scene evidence from one artist never becomes another artist's truth.
- Artist Memory remains the bounded learning layer; Operating Profile stores explicit preferences rather than learned behavior.
