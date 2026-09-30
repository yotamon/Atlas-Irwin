# Master Readiness Experience

**Status:** Implementation plan for a single PR  
**Branch:** `feat/master-readiness-experience`  
**Scope:** Track → Master Readiness → optional mastering → verification → Distribution  
**Product architecture:** Ensemblis UX V4  
**Primary principle:** diagnosis before action, evidence before mastering, one canonical readiness state everywhere

## 1. Product outcome

An artist who uploads or replaces a master should not need to understand LUFS, PLR, codec reconstruction, phase correlation or Ensemblis internals to answer the real questions:

1. **Can I release this master as-is?**
2. **If I should listen to something, where exactly and why?**
3. **If Ensemblis can safely improve it, what will it change?**
4. **If mastering cannot fix the problem, what should I do instead?**
5. **When I approve a master, does Distribution use that exact verified audio?**

The finished experience should feel calm, obvious and trustworthy:

```text
Canonical master
      ↓
Automatic analysis
      ↓
Master Readiness
      ├─ Ready → Keep current master
      ├─ Review → Listen to exact moments
      ├─ Mastering can help → Create targeted candidate
      └─ Source problem → Replace / repair source
      ↓
Optional candidate
      ↓
Loudness-matched Listen Lab
      ↓
Deterministic verification
      ↓
Explicit approval
      ↓
Exact canonical track lineage
      ↓
Distribution readiness
```

The artist should never be encouraged to master audio merely because mastering tools exist.

---

## 2. UX rules

This work must follow Ensemblis UX Architecture V4.

### Default disclosure level

The normal experience lives at:

- **Level 0 — Action:** what should I do now?
- **Level 1 — Context:** enough evidence to trust the recommendation.

Existing engineering detail moves to:

- **Level 2 — Detail:** measurements, catalog comparison, codec results.
- **Level 3 — Advanced:** measurement engines, cross-check internals, raw diagnostics.

### Copy rules

Use artist language:

- Ready to release
- Listen before approving
- Fix streaming safety
- Replace the source
- Keep current master
- Compare versions
- Technical details

Do not lead with:

- EBU R128
- PLR
- `pyloudnorm`
- codec profile IDs
- worker/runtime names
- raw mastering issue codes

Those facts remain available when useful.

### Visual rules

- One dominant status card, not a dashboard of meters.
- One primary action at a time.
- Findings use small, scannable rows with timestamp audition.
- Success states remain visually calm; no celebratory clutter.
- Critical states use explicit language and one corrective path.
- Existing Ensemblis tokens and surfaces are reused.
- No new primary navigation item.
- Responsive behavior must be designed, not merely stacked.
- All states need keyboard, screen-reader and reduced-motion support.

---

## 3. Canonical domain model

Create one server-safe product projection in `lib/mastering/readiness.ts`.

The UI, Release workspace and Distribution must not independently reinterpret raw `mastering_inspector` JSON.

### Readiness state

```ts
type MasterReadinessStatus =
  | "pending"
  | "ready"
  | "review"
  | "fix_required"
  | "unavailable";

type MasterActionKind =
  | "keep"
  | "listen"
  | "mastering_fix"
  | "replace_source"
  | "repair_source"
  | "retry_analysis"
  | "continue_without_verification";

type MasterFinding = {
  code: string;
  severity: "critical" | "review" | "info";
  category:
    | "technical"
    | "streaming"
    | "render_stability"
    | "tempo"
    | "creative";
  title: string;
  detail: string;
  startMs: number | null;
  endMs: number | null;
  actionKind: MasterActionKind;
  masteringCanHelp: boolean;
};

type MasterReadiness = {
  status: MasterReadinessStatus;
  headline: string;
  summary: string;
  technicalReady: boolean | null;
  distributionGate:
    | "pass"
    | "review"
    | "block"
    | "waiting"
    | "unverified";
  primaryAction: MasterActionKind | null;
  findings: MasterFinding[];
  reviewCount: number;
  blockerCount: number;
  inspectorVersion: string | null;
  sourceFingerprint: string | null;
};
```

### Deterministic action mapping

Raw measurement remains in the worker. Product actionability is mapped by deterministic application logic.

Examples:

| Finding | Artist meaning | Default action |
| --- | --- | --- |
| `digital_clipping` | source contains full-scale clipping | Replace/repair source |
| decode / empty audio | invalid source | Replace source |
| `true_peak_hot` | low streaming headroom | Targeted streaming-safe master |
| `codec_headroom` | lossy reconstruction raises peak risk | Targeted streaming-safe master |
| `phase_risk` | mono translation risk | Listen / source or mix repair |
| `localized_mono_loss` | local mono cancellation | Listen / source or mix repair |
| `wide_low_end` | low-end side energy worth checking | Listen |
| unstable/drifting beat | timing/render concern | Listen / source repair |
| section-aligned tempo change | likely intentional | Informational |
| tonal deviation | difference from reference, not defect | Listen only |
| temporal render anomaly | localized stability change | Listen / source repair |

No creative/reference difference becomes a release blocker by itself.

---

## 4. New Master Readiness widget

Replace the current “meter-first” default with one first-class `MasterReadinessCard`.

### Ready

```text
MASTER READINESS

✓ Ready to release

No technical defects were found and streaming conversion
keeps safe peak headroom.

Technical integrity     ✓
Streaming safety        ✓
Render stability        ✓

[ Keep current master ]

Listen & inspect        Technical details
```

When there is no reason to remaster, Active Mastering is not visually promoted.

### Review

```text
MASTER READINESS

● Ready, but listen to 2 things

The master can be distributed. These moments are worth
checking by ear before approval.

2:41  Low end becomes unusually wide        [▶ Listen]
3:12  AAC reconstruction leaves low headroom [▶ Listen]

[ Keep current master ]  [ Make streaming-safe version ]

Technical details
```

### Fix required

```text
MASTER READINESS

! Fix this before release

Clipping is present in the source waveform. Mastering cannot
restore audio that has already clipped.

2:18  Digital clipping detected              [▶ Listen]

[ Replace source audio ]

Why mastering cannot fix this
```

### Pending

Show the existing calm processing language. Do not render empty meters.

### Unavailable

Do not silently call the master ready.

Show:

- what Ensemblis could not verify;
- retry when appropriate;
- an Advanced explicit continue-without-verification path only where Distribution policy permits it.

---

## 5. Reorder and unify Track / Release UX

Today Track and Release present the same capability in different orders.

Canonical order everywhere:

1. Readiness decision
2. Findings / listening
3. Optional mastering action
4. Candidate comparison
5. Advanced measurements

### Track

`app/studio/(protected)/music/[id]/page.tsx` becomes the canonical full experience.

The Track header status should derive from the shared readiness projection.

### Release

`ReleaseMasteringPanel` reuses the same readiness widget and action model.

No duplicate status logic such as local `statusLabel()` functions.

A Release with multiple tracks shows a compact per-track audio-readiness summary and routes to the exact Track object for detailed repair.

---

## 6. Active Mastering becomes contextual

The current three-card Balanced / Punchy / Dynamic chooser is useful expert functionality, but it should not be the first thing an artist sees.

### Default behavior

- If current master is Ready: show no mastering CTA by default.
- If only streaming/true-peak risk exists: recommend **Make streaming-safe version**.
- If a broader mastering candidate is reasonable: show **Improve this master** and explain why.
- If mastering cannot safely address the finding: do not offer it as the primary fix.
- Keep Balanced / Punchy / Dynamic behind **Choose mastering direction**.

### Add targeted `streaming_safe` intent

Do not map a true-peak-only problem to the current Balanced target, because that can needlessly change loudness and dynamics.

Extend the mastering request contract with an intent:

```ts
type MasteringIntent =
  | "streaming_safe"
  | "balanced"
  | "punchy"
  | "dynamic";
```

For `streaming_safe`:

- preserve source integrated loudness as closely as possible;
- preserve tonal balance;
- do not add compression unless strictly required by safety constraints;
- do not apply catalog EQ;
- create true-peak/codec headroom appropriate to measured source loudness;
- re-run full Mastering Inspector;
- reject candidate promotion if verification fails.

The preset names remain artist-facing mastering directions only when the user explicitly asks to explore them.

---

## 7. Listen Lab

Evolve `MasteringABPlayer` into one reusable listening surface.

### Required in this PR

- synchronized Original / Candidate switching;
- loudness matching ON by default;
- exact issue seek;
- “loop finding” around a finding window;
- clear source identity;
- keyboard-accessible A/B switching;
- no playback reset when changing A/B;
- mobile-friendly sticky transport within the widget.

### Modes

```text
Original | Candidate | Reference | Streaming | Mono
```

Only show modes that have data.

#### Original
Current canonical master.

#### Candidate
Selected Active Mastering result.

#### Reference
Selected trusted/user reference when present.

#### Mono
Browser-side mono fold-down for auditioning translation findings.

#### Streaming
Use a lazy generated codec preview rather than pretending the browser is reproducing a DSP platform exactly.

Codec preview must be clearly labeled as a stress/audition preview, not “Spotify audio”.

### Finding loop behavior

A finding with `startMs/endMs` can open Listen Lab and:

- seek to a small lead-in;
- loop the evidence window;
- preserve A/B synchronization;
- let the user exit the loop without losing track position.

---

## 8. Temporal Mix / Render Stability

Add a deterministic `temporal_stability` block to Mastering Inspector.

This is not an “AI detector”.

It finds unusual changes worth auditioning.

### Windowed evidence

Reuse one canonical timeline and add bounded time-series features:

- short-term loudness;
- local true peak;
- local crest/transient contrast;
- spectral centroid;
- spectral flatness;
- band-relative energy for the existing six bands;
- stereo correlation;
- mono fold-down delta;
- side share where useful.

Use section boundaries from Track Intelligence to avoid treating intentional arrangement changes as defects.

### Output

```json
{
  "classification": "stable | review",
  "confidence": 0.0,
  "timeline": [],
  "findings": [
    {
      "code": "high_frequency_detail_drop",
      "start_ms": 167000,
      "end_ms": 181000,
      "evidence": {
        "air_delta_db": -3.1,
        "crest_delta_db": -1.8,
        "nearest_section_boundary_ms": 9400
      }
    }
  ]
}
```

### Product language

Good:

> High-frequency detail falls unusually here while transient contrast also drops. This does not align with a section change.

Bad:

> AI artifact detected.

No temporal anomaly is automatically a technical defect unless deterministic delivery/signal evidence justifies that classification.

---

## 9. Trusted mastering references

The current catalog median can include masters the artist never approved. Replace that implicit pool with an explicit reference contract.

### Reference sources

1. **Approved catalog master**
2. **Uploaded reference track**

### New table

Add an artist-scoped table such as `mastering_references`:

- `id`
- `owner_id`
- `artist_id`
- `kind`: `approved_master | uploaded_reference`
- `track_vault_id` nullable
- `media_asset_id` nullable
- `label`
- `reference_signature`
- `source_fingerprint`
- `active`
- timestamps

RLS must use the same owner/artist invariants as existing music tables.

### Approved catalog masters

A verified promoted master may be explicitly added to **My mastering references**.

Do not automatically learn from every track in `track_vault`.

Default automatic inclusion is allowed only if product policy can prove:

- exact current master lineage;
- verified Mastering Inspector result;
- explicit artist approval/promotion;
- non-stale analysis.

### Uploaded references

Allow the artist to attach a WAV/AIFF/FLAC reference without turning it into an Ensemblis catalog Track.

Analyze only the mastering/reference signature needed for comparison.

The UI must explain:

> Reference tracks influence comparison and optional mastering targets. They never define a universal “correct” sound.

---

## 10. Exact master lineage

This is a correctness requirement, not optional cleanup.

### Promotion

`promoteActiveMaster()` must update the exact linked Release track through `track_vault.linked_track_id`.

Never resolve a promoted vault master to “primary track or first track” when exact lineage exists.

Legacy fallback is allowed only when the relationship is genuinely unambiguous.

### Intelligence bridge

Audit and update legacy vault → track intelligence synchronization so it prefers exact `linked_track_id`.

Title/release fallback remains compatibility-only and must never collapse multiple tracks onto the wrong canonical track.

### Stale evidence

Readiness must be tied to the exact canonical source fingerprint/media asset.

After master replacement or promotion:

- previous readiness becomes stale immediately;
- old findings never authorize Distribution;
- fresh analysis starts automatically;
- UI may display previous verified facts only as historical context, clearly marked.

---

## 11. Distribution integration

Distribution must consume the shared Master Readiness projection.

### Gate rules

| Readiness | Distribution behavior |
| --- | --- |
| `ready` | pass: Audio verified |
| `review` | allow submission, surface exact review items |
| `fix_required` | block submission |
| `pending` | wait for automatic verification; do not claim ready |
| `unavailable` | show verification unavailable; require explicit advanced override if policy permits |

A `track.audio_url` alone no longer means “master ready”.

### Artist-facing Distribution copy

Replace:

> Master attached

with one of:

- Audio verified
- Review suggested
- Fix master before delivery
- Audio verification in progress
- Verification unavailable

The “Needs you” list should deep-link to the exact track finding.

### Final submission

Submission-time server validation repeats the canonical gate. UI state alone is never trusted.

---

## 12. Candidate comparison and approval

Candidate cards should answer:

1. What changed?
2. Did it pass?
3. Can I hear the difference fairly?
4. What happens if I approve it?

Default candidate summary:

```text
Streaming-safe candidate
Verified

True peak     -0.2 → -1.8 dBTP
Loudness      -9.7 → -9.8 LUFS
Dynamics      Preserved

[ Compare ] [ Use this master ]

Technical changes
```

Do not foreground render-pass count or DSP implementation.

Keep detailed processing plan and verification evidence under Technical changes.

Promotion remains explicit and irreversible-state copy remains clear:

> This becomes the canonical master. The previous source remains in media history and Ensemblis will re-analyze the new waveform.

---

## 13. Responsive behavior

### Desktop

Recommended composition:

```text
┌──────────────────────────────────────────────────────┐
│ Master Readiness                                     │
│ status + summary                     primary action  │
├──────────────────────────────────────────────────────┤
│ Findings / listening                                 │
├──────────────────────────────────────────────────────┤
│ Listen Lab                                           │
├──────────────────────────────────────────────────────┤
│ Optional mastering / candidate                       │
├──────────────────────────────────────────────────────┤
│ Technical details                                    │
└──────────────────────────────────────────────────────┘
```

Technical detail can use the V4 inspector/disclosure pattern rather than a long permanent page.

### Mobile

- status and one primary action first;
- findings as full-width rows;
- timestamp button has a large tap target;
- Listen Lab transport remains usable with one hand;
- A/B controls never depend on hover;
- tables become labeled stacked rows, not horizontal overflow where avoidable;
- advanced technical content may use a full-height sheet/disclosure;
- no 6-column meter grid in the default path.

---

## 14. Accessibility

Required acceptance criteria:

- status is never communicated by color alone;
- every finding severity has text;
- play/loop/A/B controls have accessible names and pressed state;
- waveform/timeline visualizations have a textual summary;
- keyboard users can switch sources and seek;
- focus returns to the invoking finding when closing detailed listening;
- reduced-motion mode avoids decorative transitions;
- no auto-playing audio;
- live job status announcements are bounded and non-spammy;
- contrast matches existing Ensemblis token standards.

---

## 15. Implementation map

### Product/domain

- `lib/mastering/readiness.ts` — canonical projection and issue → action policy
- `lib/mastering/references.ts` — trusted reference selection
- `types/mastering-database.ts` — mastering intent/reference types
- new Supabase migration — trusted references + exact policies

### Audio worker

- `services/media-worker/app/mastering_inspector.py`
  - temporal stability
  - source fingerprint if not already available from canonical metadata
- `services/media-worker/app/mastering_processor.py`
  - `streaming_safe` intent
  - preserve-source targets
- worker callback contracts/tests
- lazy codec-preview support for Listen Lab

### UI

- new `components/studio/master-readiness-card.tsx`
- new/refactored `components/studio/master-finding-list.tsx`
- evolve `mastering-ab-player.tsx` into `mastering-listen-lab.tsx`
- refactor `mastering-inspector-panel.tsx` into detail/advanced role
- refactor `active-mastering-controls.tsx` to contextual actions
- update Track page
- update Release mastering panel
- update multi-track release summaries
- update Distribution artist view

### Distribution

- `lib/distribution/artist-facing.ts`
- final submit/preflight server gate
- exact deep links to Track Master Readiness

### Lineage

- `app/studio/mastering-actions.ts`
- vault → canonical track intelligence synchronization
- tests for multi-track releases

### Docs

- this document
- `docs/mastering-inspector.md`
- `docs/active-mastering.md`
- `docs/ensemblis-product-roadmap.md`

---

## 16. Test plan

This PR is not complete with screenshot polish alone.

### Domain contract tests

- each known issue maps to the intended action;
- creative observations never become hard technical blockers;
- `fix_before_release` always blocks Distribution;
- `ready_review_suggested` remains distributable;
- missing/stale analysis never reports verified-ready;
- source fingerprint mismatch invalidates readiness.

### Mastering processor tests

- streaming-safe intent preserves loudness within tolerance;
- streaming-safe intent adds required peak headroom;
- no catalog EQ in streaming-safe mode;
- no unnecessary compression;
- closed-loop verification still gates promotion.

### Temporal stability tests

Synthetic fixtures:

- stable master → no false finding;
- intentional section brightness change → informational/no anomaly;
- gradual high-frequency deterioration → localized review cue;
- low-mid buildup not aligned to section → localized review cue;
- abrupt phase/mono anomaly → localized evidence;
- natural dynamic breakdown → not misclassified as defect.

### Lineage tests

- promoting Track B in a three-track release updates only Track B;
- exact `linked_track_id` beats title/primary fallback;
- ambiguous legacy relation refuses to guess;
- promoted master invalidates old readiness;
- fresh analysis attaches to promoted media asset.

### Distribution tests

- ready master → pass;
- review master → visible review, submission allowed;
- fix-required master → submission blocked server-side;
- analysis pending → no false ready state;
- stale analysis → no false ready state;
- multi-track release requires each exact track to satisfy its gate.

### UI tests

- diagnosis appears before mastering actions;
- ready state does not push presets;
- fixable finding shows the correct CTA;
- non-mastering finding does not show misleading mastering CTA;
- timestamp launches exact audio position;
- loop finding behavior;
- loudness match defaults ON;
- candidate approval available only after verified pass;
- mobile structure does not depend on wide tables;
- axe checks for the canonical states.

### Regression

Run:

- `npm run lint`
- `npm run typecheck`
- `npm run test:studio`
- relevant worker Python tests
- Playwright Track → mastering → Distribution journey
- production build

---

## 17. Single-PR commit sequence

Everything lands in one PR, but commits remain reviewable and reversible.

1. **docs: define master readiness experience**
2. **fix: enforce exact master track lineage**
3. **feat: add canonical master readiness projection**
4. **feat: add temporal render stability**
5. **feat: add trusted mastering references**
6. **feat: add targeted streaming-safe mastering**
7. **feat: build Master Readiness card and finding actions**
8. **feat: evolve A/B player into Listen Lab**
9. **feat: unify Track and Release mastering UX**
10. **feat: enforce audio readiness in Distribution**
11. **test: cover readiness, lineage, mastering and distribution**
12. **docs: reconcile mastering and roadmap documentation**

No partial implementation should be merged before the entire vertical journey passes.

---

## 18. Definition of done

The PR is complete only when a user can:

1. upload or replace a master;
2. see one clear readiness state without understanding mastering terminology;
3. listen directly to every actionable localized finding;
4. understand whether mastering can help;
5. create a targeted safe candidate when appropriate;
6. compare source/candidate at matched loudness;
7. approve only a verified candidate;
8. preserve the previous master in history;
9. have fresh analysis automatically follow the approved waveform;
10. see the same exact readiness state in Track, Release and Distribution;
11. be blocked from Distribution only for deterministic technical blockers or explicit unverified-policy boundaries;
12. trust that a multi-track release never updates or verifies the wrong track;
13. open Advanced and still access the full measurements that exist today.

### Product acceptance sentence

If the artist asks, **“Is this master ready, and what should I do?”**, the first screen must answer that question without requiring them to interpret a meter, find another route, or know which Ensemblis subsystem produced the evidence.
