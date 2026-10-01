# Active Mastering V2 Implementation Program

**Status:** Planned; implementation will remain in one draft PR until the complete vertical slice is validated  
**Execution PR:** [#279 — Active Mastering V2: adaptive mastering program](https://github.com/yotamon/Atlas-Irwin/pull/279)  
**Scope:** Master Readiness → mastering decision engine → deterministic DSP → candidate optimization → listening validation → promotion → release coherence  
**Canonical baseline:** [Active Mastering Studio](active-mastering.md) and [Master Readiness Experience](master-readiness-experience.md)  
**Product architecture:** Ensemblis UX V4  
**Primary principle:** smarter decisions, richer deterministic DSP, stronger perceptual verification; never an opaque waveform generator  
**Last reconciled:** 2026-10-01

## 1. Outcome

Active Mastering V2 turns the current safe corrective mastering loop into an adaptive mastering system that understands:

- the exact source waveform;
- musical structure and section context;
- trusted artist references;
- artist-specific mastering history;
- intended mastering direction;
- release/album context;
- technical delivery requirements;
- the measurable cost of every processing decision.

The system must answer two different questions separately:

1. **Is this master technically safe and ready?**
2. **Can Ensemblis make a version that is musically preferable without damaging the source?**

V2 must never conflate louder with better, closer-to-reference with correct, or technically valid with perceptually superior.

The product promise is:

> Ensemblis should find the strongest defensible master for this track, artist and release while proving exactly what changed and refusing changes that cost more than they add.

## 2. Non-negotiable invariants

These extend, rather than replace, the current Master Readiness contract.

1. The canonical source stays immutable while candidates are rendered.
2. Every candidate is a separate immutable media asset with complete source and processing lineage.
3. DSP remains deterministic and auditable. ML may choose parameters or rank candidates; it does not generate the mastered waveform.
4. A candidate can be promoted only after deterministic technical verification.
5. Creative improvement is never inferred from technical validity alone.
6. Loudness targets are ranges and preferences, not commandments.
7. Platform normalization guidance is delivery context, not a universal artistic target.
8. Trusted references are explicit artist choices. Unrelated catalog audio never silently becomes a target.
9. Reference similarity influences target selection, but reference deviation is not a defect.
10. Mastering never silently repairs mix problems that require stem/mix intervention.
11. Native source precision is preserved for canonical mastering assets unless the user explicitly exports a lower-resolution derivative.
12. Storage-tier limitations must not lower the quality of the canonical mastering asset.
13. Stereo widening is never applied blindly.
14. Every adaptive processor has bounded ranges and a bypass condition.
15. Every candidate is re-measured from the exact stored waveform.
16. The system must measure processing damage, not only target attainment.
17. A failed candidate remains reviewable but can never be labeled distribution-ready.
18. Human listening remains an explicit final creative approval boundary.

## 3. Current V1 baseline

The existing implementation is intentionally conservative and should be preserved as the safe baseline.

### Existing strengths

- canonical FFmpeg EBU R128 loudness / true-peak analysis;
- independent pyloudnorm cross-check;
- sample clipping, DC offset, silence and flat-top analysis;
- PLR, LRA, crest and local dynamics evidence;
- stereo correlation, mono fold-down and low-frequency side-energy evidence;
- codec stress renders;
- temporal/render stability analysis;
- beat stability evidence;
- trusted mastering references;
- source-preserving `streaming_safe` intent;
- bounded reference EQ;
- guarded broadband compression;
- two-pass render verification;
- safer retry;
- loudness-matched Listen Lab;
- immutable candidate lineage;
- explicit promotion;
- fresh Track Intelligence after promotion;
- Distribution readiness driven by the same exact waveform.

### V1 limitations to remove

1. Creative mastering uses a six-band static EQ model.
2. Compression uses mostly fixed broadband timing/threshold behavior.
3. Creative loudness finishing delegates too much policy to FFmpeg `loudnorm`.
4. `loudnorm linear=true` can fall back to dynamic normalization when its constraints cannot be met, which makes the final behavior less explicit than V2 requires.
5. The system uses point loudness targets instead of source-dependent target ranges.
6. The current reference model uses simple medians instead of reference similarity and section-aware comparison.
7. There is no explicit transient-preservation objective beyond coarse PLR/crest checks.
8. Resonance/harshness control is not adaptive.
9. Stereo processing is preservation-only; there is no bounded corrective M/S path.
10. The 20 Hz cleanup filter is fixed for creative presets instead of evidence-driven.
11. Candidate search is one render plus one safer retry rather than optimization across multiple bounded candidates.
12. Acceptance proves safety more strongly than perceptual improvement.
13. Canonical mastering delivery can be reduced to 16-bit because of object-size limits.
14. There is no release/album mastering coherence model.
15. Artist mastering preferences are not yet learned from approved/rejected candidate history.

## 4. Research decisions

The implementation is informed by current platform guidance and modern automatic-mastering practice, but Ensemblis should not copy a commercial plugin architecture.

### 4.1 Loudness normalization is playback context, not the mastering target

Spotify currently normalizes normal playback around -14 LUFS and recommends true-peak headroom, including additional headroom for masters louder than -14 LUFS.

Decision:

- keep platform previews in Mastering Inspector;
- do not make -14 LUFS the default creative target;
- optimize for artist intent and audible quality first;
- expose expected normalization impact;
- treat true-peak/codec risk as a technical constraint.

### 4.2 Preserve native resolution

Apple's current delivery guidance accepts multiple standard sample rates and explicitly recommends using the native project resolution for Apple Digital Masters rather than downsampling.

Decision:

- remove the unconditional 48 kHz mastering identity;
- preserve the source/native sample rate for canonical masters when supported;
- keep sample-rate conversion as an explicit delivery derivative;
- keep 24-bit canonical resolution when the input/source path supports it.

### 4.3 Explicit final limiting instead of hidden normalization behavior

FFmpeg documents that `loudnorm` linear normalization falls back to dynamic mode when target constraints cannot be satisfied.

Decision:

- retain EBU R128/`loudnorm` measurement where useful;
- stop treating `loudnorm` as the creative final loudness processor;
- move final peak/loudness control into an explicit mastering limiter/clipper stage with bounded parameters and post-render verification.

### 4.4 Reference matching must include tone, dynamics and width

Modern mastering assistants compare more than broad EQ curves and support custom references across tone, dynamics, width and loudness.

Decision:

- expand the trusted-reference signature;
- compare matched musical regions where possible;
- retrieve the most relevant references rather than median-blending every reference equally.

### 4.5 ML controls DSP; ML does not replace DSP

Research such as DeepAFx and ITO-Master supports a model where learned systems estimate/control effect parameters or reference style while recognizable processors still perform the signal transformation.

Decision:

- V2 is white-box DSP first;
- ML parameter prediction is a later phase behind the same bounded target/processor contracts;
- every ML proposal must be reproducible as explicit parameters;
- deterministic fallback must always exist.

## 5. Canonical V2 runtime

```text
Canonical source
      ↓
Mastering Inspector V2
      ↓
Masterability diagnosis
      ├─ source defect → repair/replace source
      ├─ mix problem → optional future Mix Rescue
      └─ masterable stereo source
      ↓
Intent + artist context + release context
      ↓
Reference Intelligence V2
      ├─ explicit trusted references only
      ├─ source/reference similarity
      └─ section-aware comparison
      ↓
Target Builder V2
      ├─ target ranges
      ├─ change budgets
      ├─ processor permissions
      └─ true-peak/delivery constraints
      ↓
Candidate Planner
      ↓
Bounded deterministic DSP
      ├─ evidence-driven cleanup
      ├─ adaptive tonal shaping / dynamic EQ
      ├─ resonance control
      ├─ program-dependent dynamics
      ├─ optional character / soft clipping
      ├─ bounded corrective M/S
      └─ oversampled true-peak limiter
      ↓
Candidate set
      ↓
Mastering Inspector V2 on every exact candidate
      ↓
Technical gate + perceptual-change gate
      ↓
Candidate optimizer / Pareto selection
      ↓
Best defensible candidates
      ↓
Codec stress + delivery derivatives
      ↓
Listen Lab V2
      ↓
Human approval
      ↓
Canonical promotion
      ↓
Fresh intelligence + release coherence analysis
```

## 6. Masterability diagnosis

Before creative mastering, Ensemblis must decide whether mastering is the correct intervention.

### Categories

`ready_as_is`
: No material technical or creative reason to master.

`streaming_safety_only`
: True-peak/codec headroom can be improved transparently.

`masterable`
: Stereo source is technically healthy and evidence supports bounded mastering work.

`mix_review_recommended`
: Issues such as vocal balance, kick/bass interaction, harsh isolated elements, severe stereo imbalance or transient damage are more appropriately solved in the mix.

`source_repair_required`
: Clipping, decode faults, severe phase cancellation or destructive artifacts make mastering unsafe.

### Contract

Masterability is deterministic and evidence-backed. An LLM may explain the result but cannot set the category.

## 7. Target Builder V2

V1 target points become target envelopes.

Example:

```ts
type MasteringTargetV2 = {
  intent: "streaming_safe" | "balanced" | "punchy" | "dynamic";
  loudness: {
    preferredLufs: number;
    minLufs: number;
    maxLufs: number;
    hardMaxGainDb: number;
  };
  truePeak: {
    ceilingDbtp: number;
    codecGuardDb: number;
  };
  dynamics: {
    minPlrLu: number | null;
    maxPlrLossLu: number;
    maxShortTermCompressionDeltaLu: number;
    maxTransientLossDb: number;
  };
  tone: {
    maxIntegratedCorrectionDb: number;
    maxBandCorrectionDb: number;
    maxDynamicCorrectionDb: number;
  };
  stereo: {
    maxSideDeltaDb: number;
    lowEndWidthPolicy: "preserve" | "correct_if_risky";
  };
  character: {
    enabled: boolean;
    maxDriveDb: number;
  };
  sourceResolution: {
    sampleRateHz: number;
    bitDepth: number | null;
  };
};
```

### Target selection rules

- derive from source dynamics first;
- blend toward similar trusted references only when evidence is strong;
- never demand loudness that violates the damage budget;
- `dynamic` prioritizes transient/dynamic preservation;
- `punchy` may accept more density but not arbitrary limiting;
- `balanced` prefers minimum intervention that improves reference/translation alignment;
- `streaming_safe` remains transparent level-only correction.

### Loudest-clean principle

The optimizer may stop below the preferred loudness target.

Example:

> Preferred target: -9.0 LUFS  
> Clean candidate boundary: -10.3 LUFS  
> Reason: reaching -9.0 exceeded transient-loss and limiter-gain-reduction budgets.

That is a successful V2 outcome, not a failure.

## 8. Reference Intelligence V2

The current reference median becomes a similarity-aware reference model.

### Expanded reference signature

Each trusted reference should expose:

- integrated LUFS;
- true peak;
- LRA / PLR / PSR summaries;
- crest and transient-density summaries;
- spectral envelope at materially finer resolution than six bands;
- spectral centroid/rolloff/flatness;
- low-end spectral distribution;
- stereo correlation and M/S distribution by frequency region;
- short-term loudness distribution;
- section-level signatures;
- semantic/music embedding when commercially safe;
- BPM / rhythmic density;
- vocal/instrument evidence when existing intelligence provides it;
- mastering-analysis version.

### Selection

Reference influence should use:

```text
explicit trust
× musical similarity
× section compatibility
× analysis confidence
× source quality
```

Do not use popularity or catalog recency as mastering-quality proxies.

### Minimum evidence

- one explicit external reference can be auditioned and described;
- automatic target shaping requires confidence thresholds;
- a small number of highly similar references may outweigh a larger dissimilar set;
- weak similarity falls back to source-first mastering.

### Section-aware matching

When Track Intelligence provides reliable sections:

- compare chorus ↔ chorus;
- verse ↔ verse;
- peak section ↔ peak section;
- breakdown ↔ breakdown where useful.

Whole-track average remains context, not the only target.

## 9. Tonal model V2

Replace the six-band correction model with a perceptually meaningful spectral representation.

### Analysis

Use a bounded ERB/Bark/log-frequency or approximately third-octave spectral envelope.

Requirements:

- loudness-normalized before comparison;
- robust median statistics rather than single FFT frames;
- section-aware profiles;
- smoothing to avoid overfitting narrow bins;
- separate persistent tonal tilt from isolated resonances.

### Processing

Two different tools:

1. **Broad tonal EQ**
   - low-order, smooth, minimum necessary correction;
   - bounded total gain;
   - no automatic curve copying.

2. **Dynamic/resonance EQ**
   - narrow or regional attenuation only when excess is persistent or level-dependent;
   - attack/release chosen from measured behavior;
   - bounded maximum gain reduction;
   - bypass when confidence is low.

### Guardrails

- never boost deep sub content to match a reference;
- never force air/presence into a dark intentional production without strong reference evidence;
- never apply more than the target change budget;
- tonal movement alone cannot make a candidate “better”.

## 10. Evidence-driven low-end processing

Remove the unconditional creative-preset 20 Hz high-pass rule.

Detect:

- DC/infrasonic energy;
- useful low fundamental content;
- sub-to-bass balance;
- low-frequency side content;
- low-frequency crest/transient behavior.

Possible actions:

- no filter;
- subsonic high-pass below useful musical content;
- gentle low shelf;
- bounded dynamic low-band control;
- bounded M/S low-end side reduction only when mono/translation evidence justifies it.

Dance/electronic masters must not lose intentional sub energy simply because a generic cleanup filter exists.

## 11. Program-dependent dynamics

Replace the mostly fixed broadband compressor with an adaptive dynamics stage.

### Analysis inputs

- source PLR;
- source crest factor;
- short-term loudness distribution;
- PSR/transient evidence;
- section energy;
- tempo;
- reference dynamics;
- existing saturation/flat-top evidence.

### Planner outputs

```ts
type DynamicsPlan = {
  enabled: boolean;
  mode: "broadband" | "multiband" | "transient_safe";
  thresholdDb: number;
  ratio: number;
  attackMs: number;
  releaseMs: number;
  kneeDb: number;
  maxGainReductionDb: number;
  makeupDb: number;
  reason: string;
};
```

### Rules

- already-squashed material receives no extra bus compression by default;
- attack must preserve measured transient identity;
- release should use tempo/program context where reliable;
- gain reduction gets a hard budget;
- multiband processing is permitted only where a regional problem is evidenced;
- V2 must report actual measured gain-reduction behavior, not only requested settings.

## 12. Transient preservation

PLR alone is too coarse.

Inspector V2 should add before/after transient evidence such as:

- crest distribution;
- high-frequency attack energy;
- onset-strength distribution;
- transient-to-sustain ratio;
- section-level transient density;
- limiter-induced peak-shape change.

A candidate fails creative QA when transient loss exceeds its intent-specific budget even if LUFS and true peak pass.

## 13. Resonance and harshness control

Add descriptive resonance evidence before adding processing.

Potential detector inputs:

- persistent narrow-band deviation from local spectral envelope;
- time-varying spectral peaks;
- section consistency;
- loudness dependence;
- reference comparison where relevant.

Processing remains attenuation-first and conservative.

Do not create a “harshness score” that pretends subjective brightness has one universal answer.

## 14. Corrective stereo / M/S

V2 remains anti-widening by default.

Allowed automatic actions:

- bounded low-frequency side attenuation when mono/translation evidence is strong;
- bounded regional side correction for an identified translation problem;
- no broad automatic widening;
- no stereo action when a phase-risk source should be repaired upstream.

Every stereo move must improve or preserve the post-render mono/phase metrics.

## 15. Character stage

Creative mastering may optionally include bounded harmonic character.

Possible deterministic processors:

- soft clipping;
- saturation;
- waveshaping with oversampling.

Rules:

- off by default for `streaming_safe` and `dynamic`;
- low maximum drive;
- no attempt to emulate named copyrighted/commercial mastering chains;
- harmonic change must be measured;
- candidate optimizer may prefer bypass if loudness/impact goals can be reached transparently.

## 16. Explicit limiter stage

Creative finalization should use an explicit true-peak-aware mastering limiter rather than relying on `loudnorm` as the final processor.

Required properties:

- oversampling;
- configurable lookahead;
- bounded release/adaptive release;
- ceiling in dBTP;
- measurable gain reduction;
- deterministic settings;
- no hidden mode fallback;
- exact post-render true-peak measurement.

If the available FFmpeg/native DSP cannot satisfy the quality contract, introduce a dedicated open-source DSP dependency only after:

- license review;
- deterministic CLI/runtime support;
- Windows/Linux worker compatibility where required;
- synthetic regression tests;
- real-track blind listening acceptance.

## 17. Candidate optimization

V1 produces one candidate and one safer retry. V2 should search a small bounded candidate space.

### Candidate family

For each request generate a small set, for example 3–5 candidates:

- minimal intervention;
- target-centered;
- slightly more dynamic;
- slightly less loud;
- reference-leaning when references are strong.

Do not brute-force large parameter grids.

### Objective vector

A candidate should be compared across independent objectives:

```text
technical validity
reference alignment
target-intent fit
loudness attainment
transient preservation
dynamics preservation
tonal-change cost
stereo-change cost
codec resilience
processing complexity
```

### Selection model

Prefer Pareto-style ranking over a fake universal quality score.

Expose:

- `recommended`;
- `more_dynamic`;
- `more_forward`;

only when candidates are materially different and all pass technical safety.

The UI does not need to expose every internal candidate.

## 18. Perceptual Change Budget

Every creative render gets a formal before/after budget.

Example contract:

```ts
type MasteringChangeBudget = {
  maxPlrLossLu: number;
  maxTransientLossDb: number;
  maxSpectralEnvelopeDistance: number;
  maxStereoCorrelationDelta: number;
  maxMonoFoldDownRegressionDb: number;
  maxLimiterGainReductionDb: number;
  maxEqMoveDb: number;
  maxTotalEqEnergy: number;
};
```

A candidate cannot pass simply because it hits LUFS.

### Candidate acceptance

Two independent results:

`technicalPass`
: safe delivery and no blocking defect.

`creativePass`
: processing remained inside the selected intent's change budget.

Promotion requires technical pass. Recommended labeling requires both.

Human approval remains required for promotion.

## 19. Mastering Inspector V2 additions

Add measurements only when they support a real decision.

### New evidence

- native source resolution identity;
- fine spectral envelope;
- section-level spectral/dynamics/stereo signatures;
- onset/transient statistics;
- short-term compression/density deltas;
- limiter gain-reduction summary;
- optional resonance evidence;
- before/after perceptual deltas;
- exact candidate target-range compliance;
- exact processing budget consumption.

### Keep existing evidence

- EBU R128 loudness;
- true peak;
- clipping;
- PLR/LRA/crest;
- codec stress;
- mono/phase;
- silence/DC;
- beat stability;
- temporal stability.

### Versioning

Introduce a new schema version rather than changing the semantics of V1 fields silently.

Compatibility projection should keep existing Master Readiness consumers working during rollout.

## 20. Canonical asset fidelity

Canonical mastering output must be independent of Supabase Free object limits.

### Required separation

```text
Canonical mastering asset
  = highest justified lossless quality
  = native sample rate where supported
  = 24-bit when source path supports it

Delivery derivative
  = distributor/platform/export-specific format
  = may resample/dither only intentionally
```

### Storage work

Evaluate and implement one of:

1. storage configuration/tier that supports the canonical artifact sizes;
2. an alternative object store behind the existing media-asset abstraction;
3. chunked/object strategy only if it preserves normal media access semantics.

Do **not** retain “reduce the canonical master to 16-bit because the object is too large” as normal V2 behavior.

The existing fallback remains operational until the replacement storage path is proven.

## 21. Dither and sample-rate conversion

Rules:

- do not dither while staying at 24-bit unless a DSP implementation specifically requires it;
- dither once at the final bit-depth reduction boundary;
- record dither type in derivative provenance;
- preserve native sample rate for canonical assets;
- use explicit high-quality SRC for required derivatives;
- re-run final delivery QA after SRC/dither.

## 22. Codec and platform preview V2

Keep codec stress descriptive.

Improve:

- store generated preview assets when useful for Listen Lab;
- label them by actual codec/settings, never by proprietary service name unless using an official service encoder;
- support high-quality AAC stress where runtime licensing/encoder availability permits;
- compare overs/reconstruction against the master;
- keep Spotify normalization prediction separate from codec simulation.

## 23. Listen Lab V2

Keep the current synchronized loudness-matched A/B as the foundation.

Add:

- instant source/candidate switching with reduced switching artifacts;
- curated representative loops:
  - loudest section;
  - strongest transient section;
  - bass-heavy section;
  - widest/phase-sensitive section;
  - any changed/resonance section;
- candidate delta explanations;
- optionally audition generated codec previews;
- reference section suggestions;
- three-way comparison when candidate optimizer exposes a meaningful alternative.

Default remains one recommended candidate to avoid decision overload.

## 24. Artist Mastering DNA

Do not create opaque personalization from every click.

Learn only from explicit, attributable decisions:

- approved candidate;
- rejected candidate;
- selected alternate candidate;
- explicit trusted reference;
- explicit mastering direction preference.

Store structured preference evidence such as:

- preferred loudness range;
- typical PLR preservation;
- tonal-change tolerance;
- low-end preference;
- brightness/presence preference;
- stereo intervention tolerance;
- character-stage preference.

### Safety

- artist-scoped;
- inspectable;
- source-backed;
- bounded influence;
- cannot override technical safety;
- rejection/approval evidence expires or is superseded when appropriate;
- no cross-artist transfer as artist truth.

## 25. ML parameter proposal phase

This phase ships only after deterministic V2 has a listening benchmark and accepted candidate history.

### Architecture

```text
source features + reference features + intent
             ↓
parameter proposal model
             ↓
bounded parameter validator
             ↓
same deterministic DSP engine
             ↓
same Inspector V2
             ↓
same candidate optimizer
```

### Possible model responsibilities

- reference weighting;
- EQ parameter initialization;
- compressor parameter initialization;
- candidate ordering;
- predicting likely bypass;
- artist-preference prior.

### Forbidden responsibilities

- direct final waveform generation;
- bypassing processor bounds;
- changing technical gates;
- declaring subjective quality without listening evidence;
- automatically promoting the output.

### Rollout

ML proposals run shadow-only first and must beat deterministic initialization on the private listening benchmark before affecting normal candidates.

## 26. Release / album mastering coherence

Add a release-level layer after single-track V2 is stable.

### Goal

Preserve intentional differences while avoiding accidental inconsistency across an EP/album.

### Release evidence

For ordered tracks compare:

- integrated and short-term perceived loudness;
- true peak/headroom;
- PLR/dynamics;
- tonal envelope;
- low-end level;
- stereo character;
- transition/tail/start silence;
- sequencing context.

### Behavior

- never independently normalize every album track to the same LUFS;
- preserve deliberate quiet/loud relationships;
- suggest or render release-context candidates only when requested;
- show sequence-level A/B;
- keep single-track canonical lineage exact.

### Release target model

Represent relative relationships:

```text
Track B should remain ~1.2 LU quieter than Track A
Track C can peak louder but should preserve higher PLR
Track D tonal shift is intentional based on reference/release context
```

not:

```text
Every track = -10 LUFS
```

## 27. Future Mix Rescue boundary

Mix Rescue remains separate.

Mastering V2 may identify:

- unstable vocal balance;
- kick/bass masking;
- isolated harsh stem behavior;
- flattened drum transients;
- severe low-end stereo problems.

It can recommend Mix Rescue, but mastering must not silently manipulate stems.

Future flow:

```text
source mix
  → Mix Rescue candidate
  → explicit audition/approval
  → Active Mastering V2
  → final master
```

## 28. Data model changes

Exact migrations are implementation-time decisions, but V2 will likely need durable structures for:

### Job/candidate lineage

Extend or version `track_mastering_jobs` result contracts with:

- target schema version;
- processor-chain version;
- candidate family;
- candidate rank/recommendation;
- change budget;
- before/after delta report;
- limiter/dynamics telemetry;
- native resolution;
- optimizer evidence.

### Artist preference evidence

Prefer a dedicated artist-scoped mastering-preference evidence table or existing Artist Memory source when it can preserve:

- exact source candidate/job;
- decision type;
- source/reference lineage;
- effect scope;
- confidence;
- supersession.

### Release coherence

A release-level mastering session may need:

- release id;
- exact ordered track IDs;
- source master hashes;
- relationship targets;
- candidate relationships;
- approval state.

All tables in exposed schemas require explicit RLS and Data API grants following current Supabase policy.

## 29. Cross-runtime contract changes

The media-worker contract must version any materially new mastering payload/result semantics.

Do not grow route/server-action orchestration around raw JSON.

Introduce deep mastering modules for:

- target building;
- reference selection;
- DSP planning;
- candidate optimization;
- acceptance evaluation.

The TypeScript → durable job → Python worker → callback boundary remains explicit and regression-tested.

## 30. Implementation module map

### Python worker

`services/media-worker/app/mastering_inspector.py`
: V2 measurements, deltas, versioned inspector output.

`services/media-worker/app/mastering_processor.py`
: retain V1 compatibility; orchestration should migrate toward smaller V2 modules.

Recommended new modules:

- `mastering_targets.py`
- `mastering_references.py`
- `mastering_tonal.py`
- `mastering_dynamics.py`
- `mastering_stereo.py`
- `mastering_limiter.py`
- `mastering_candidates.py`
- `mastering_evaluation.py`

Avoid a single 1,500-line V2 processor.

### TypeScript application

- `lib/mastering/readiness.ts`
- `lib/mastering/jobs.ts`
- new versioned result/parser helpers;
- release-coherence domain module when that phase begins;
- explicit media asset/derivative provenance handling.

### UI

- `components/studio/active-mastering-controls.tsx`
- `components/studio/mastering-listen-lab.tsx`
- Master Readiness details;
- optional candidate rationale;
- release mastering surface.

The normal UX remains diagnosis-first, not processor-first.

## 31. Phased implementation inside this single PR

This program deliberately stays in **one draft PR** so architecture, DSP, QA and product behavior cannot drift into independently merged half-states.

Commits may remain reviewable by phase.

### Phase A — Contracts and benchmark foundation [P0]

- [ ] Define Inspector V2 schema and compatibility projection.
- [ ] Define Target V2 schema.
- [ ] Define change-budget schema.
- [ ] Define candidate/result schema.
- [ ] Build deterministic fixture corpus for DSP unit tests.
- [ ] Add private real-track evaluation harness contract.
- [ ] Establish blind listening test procedure and scoring format.
- [ ] Record V1 baseline outputs for representative reference tracks.

**Gate A:** no DSP change lands without repeatable V1-vs-V2 evaluation.

### Phase B — Fidelity and loudness architecture [P0]

- [ ] Preserve native canonical sample rate.
- [ ] Preserve canonical 24-bit resolution where source supports it.
- [ ] Separate canonical master assets from delivery derivatives.
- [ ] Remove storage-size-driven quality downgrade from normal canonical path.
- [ ] Make `loudnorm` measurement/context rather than final creative processing.
- [ ] Implement explicit true-peak limiter stage.
- [ ] Add limiter telemetry and post-limiter true-peak verification.
- [ ] Keep `streaming_safe` static attenuation behavior unchanged.

**Gate B:** canonical master quality can no longer be reduced by object-size policy.

### Phase C — Inspector V2 / damage metrics [P0]

- [ ] Fine spectral envelope.
- [ ] transient/onset metrics.
- [ ] short-term dynamics delta.
- [ ] candidate spectral delta.
- [ ] stereo/mono regression delta.
- [ ] processing telemetry ingestion.
- [ ] target-range compliance.
- [ ] change-budget consumption.
- [ ] schema versioning + compatibility.

**Gate C:** the system can prove when a candidate reached a target by damaging the source.

### Phase D — Adaptive target + Reference Intelligence V2 [P1]

- [ ] similarity-aware trusted-reference selection;
- [ ] section-aware comparison;
- [ ] source-first fallback;
- [ ] target envelopes;
- [ ] loudest-clean behavior;
- [ ] change budgets per intent;
- [ ] reference influence confidence.

**Gate D:** references shape a candidate only when they are relevant enough to justify it.

### Phase E — DSP V2 [P1]

- [ ] evidence-driven sub cleanup;
- [ ] smooth broad tonal EQ;
- [ ] bounded dynamic/resonance EQ;
- [ ] program-dependent dynamics;
- [ ] transient-preservation controls;
- [ ] bounded corrective M/S;
- [ ] optional bounded character;
- [ ] explicit mastering limiter;
- [ ] exact telemetry from every active processor.

**Gate E:** every processor has a reason, a bound, a bypass and measurable before/after evidence.

### Phase F — Candidate optimizer [P1]

- [ ] small candidate family;
- [ ] multi-objective evaluation;
- [ ] Pareto-style ranking;
- [ ] recommendation reason;
- [ ] optional dynamic/forward alternate;
- [ ] reject candidates outside the technical or change budget.

**Gate F:** no candidate is recommended because of loudness alone.

### Phase G — Listen Lab and artist experience [P1]

- [ ] representative automatic loops;
- [ ] candidate rationale;
- [ ] changed-region audition;
- [ ] improved instant switching;
- [ ] optional real codec previews;
- [ ] alternate candidate only when useful;
- [ ] preserve keyboard/accessibility/mobile behavior;
- [ ] no additional mastering complexity in the default Ready state.

**Gate G:** a non-engineer can understand why the candidate exists and audition the exact consequences.

### Phase H — Artist Mastering DNA [P2]

- [ ] structured explicit preference evidence;
- [ ] approved/rejected candidate lineage;
- [ ] bounded target/reference influence;
- [ ] inspectable preference UI/details;
- [ ] no cross-artist leakage;
- [ ] no automatic technical-rule override.

**Gate H:** personalization is evidence-backed and reversible.

### Phase I — Release / album coherence [P2]

- [ ] release-level analysis;
- [ ] relative loudness/dynamics targets;
- [ ] ordered sequence context;
- [ ] release-level candidate recommendations;
- [ ] sequence audition;
- [ ] exact-track promotion and stale-lineage protection.

**Gate I:** Ensemblis can improve coherence without flattening intentional track-to-track contrast.

### Phase J — ML parameter proposals [P2, conditional]

- [ ] define training/evaluation dataset provenance;
- [ ] research commercially safe features/models;
- [ ] build shadow parameter proposer;
- [ ] parameter validator;
- [ ] benchmark against deterministic initializer;
- [ ] blind listening acceptance;
- [ ] only then allow bounded production influence.

**Gate J:** ML must outperform the deterministic baseline and remain explainable as processor parameters.

## 32. Private listening benchmark

Synthetic tests are necessary but insufficient for mastering.

Build a private benchmark containing representative categories:

- already excellent professional master;
- loud/squashed master;
- dynamic master;
- bass-heavy dance track;
- bright/harsh synthetic production;
- dark/soft production;
- AI-generated stereo source;
- live/human performance;
- vocal-forward track;
- instrumental track;
- phase-risk source;
- intentionally wide source;
- release/album sequence.

Include Atlas Irwin material and at least one traditional/non-AI reference artist where rights/access permit.

### Blind test

Compare, loudness matched:

- source;
- V1;
- V2 recommended;
- V2 alternate when relevant;
- optional trusted commercial/manual reference master where legally available.

### Evaluation questions

- tonal balance preference;
- punch/transient preservation;
- low-end clarity;
- harshness/fatigue;
- width/translation;
- loudness without apparent damage;
- overall preference;
- “would you release this version?”

Do not expose system identity during scoring.

## 33. Automated regression suite

### Unit/DSP

- impulse response sanity where applicable;
- silence;
- mono;
- stereo;
- polarity;
- full-scale peak;
- sub-heavy test;
- transient train;
- sine sweeps;
- pink/noise spectral fixtures;
- known resonances;
- sample-rate variants;
- bit-depth variants.

### Metamorphic

- source +3 dB → tonal/reference identity stable; level behavior predictable;
- sample-rate change → normalized mastering decisions materially stable;
- mono fold-down → stereo plan changes, tonal plan mostly stable;
- equivalent gain staging → final intent remains stable;
- repeated render with identical contract → bit-identical or explicitly deterministic-tolerance output.

### Processor guardrails

- dynamic EQ never exceeds bound;
- compressor never exceeds GR budget;
- limiter never exceeds requested ceiling tolerance;
- no blind widening;
- low-end correction bypasses healthy material;
- streaming-safe never enters creative chain;
- weak references cannot force tonal processing;
- failed V2 module degrades safely rather than producing an unverified master.

### Application

- exact source lineage;
- stale candidate rejection;
- promotion gate;
- Distribution exact-track gate;
- asset provenance;
- native-resolution preservation;
- release multi-track correctness.

## 34. Performance and worker budget

Mastering V2 is more expensive than V1, so resource limits are part of the product contract.

### Requirements

- reuse decoded audio/features between candidate renders;
- do expensive analysis once where possible;
- candidate count remains small;
- avoid heavyweight ML in default worker;
- keep optional experimental dependencies separate;
- bound temporary disk use;
- clean every intermediate;
- preserve single-concurrency worker safety until compute architecture changes intentionally.

Track:

- worker wall-clock duration;
- render duration per audio minute;
- temp disk peak;
- memory peak;
- candidate count;
- codec-preview cost;
- failure stage.

## 35. Observability

Each mastering job should emit structured stage telemetry without secrets or signed URLs.

Suggested stages:

```text
download
inspect_source
select_references
build_targets
plan_candidates
render_candidate
inspect_candidate
rank_candidates
encode_derivatives
upload
callback
```

Record:

- job/artist/track IDs;
- source fingerprint;
- processor/schema versions;
- candidate IDs;
- duration;
- safe failure class.

Do not log private audio URLs containing credentials.

## 36. Rollout strategy

V2 must not replace V1 in one flag day.

### Rollout sequence

1. Inspector V2 shadow measurements.
2. V2 target/reference planner shadow output.
3. DSP V2 candidate generation available to internal/admin only.
4. Blind benchmark acceptance.
5. V2 recommended candidate in Studio with V1 fallback.
6. Observe promotion/rejection evidence.
7. Release coherence.
8. ML shadow proposals only after deterministic V2 is stable.

### Fail-safe

If V2 cannot produce a verified candidate:

- current canonical source remains untouched;
- V1 `streaming_safe` remains available for streaming headroom;
- no automatic promotion;
- user receives a truthful failure/review state.

## 37. UX completion criteria

The default artist flow must still be simpler than the DSP architecture.

A normal user should see:

```text
Ready to release
or
Listen before approving
or
Ensemblis can improve this master
or
Fix the source/mix first
```

When mastering is useful:

```text
Why
→ Create candidate
→ Hear exact changes at matched loudness
→ See concise evidence
→ Approve or keep original
```

Advanced users can inspect:

- target ranges;
- reference contribution;
- chain;
- gain reduction;
- EQ/dynamic actions;
- change-budget consumption;
- exact measurements.

No default page should become a mastering-engineering dashboard.

## 38. Documentation work in this PR

During implementation keep these documents synchronized:

- this document — execution source of truth;
- `docs/active-mastering.md` — shipped behavior only;
- `docs/mastering-inspector.md` — shipped measurement contract only;
- `docs/master-readiness-experience.md` — artist-facing readiness contract;
- `docs/ensemblis-product-roadmap.md` — program state and exit criteria;
- ADR only when a durable architecture decision is actually implemented.

Do not document planned V2 behavior as already shipped.

## 39. Single-PR commit sequence

Recommended reviewable commit sequence:

1. `docs: define Active Mastering V2 program`
2. `test: establish mastering V2 benchmark contracts`
3. `refactor: version mastering analysis and result contracts`
4. `fix: preserve canonical mastering resolution`
5. `feat: add explicit mastering limiter and telemetry`
6. `feat: add Inspector V2 perceptual deltas`
7. `feat: add adaptive mastering targets`
8. `feat: add Reference Intelligence V2`
9. `feat: add adaptive tonal and dynamics DSP`
10. `feat: add corrective stereo and character stages`
11. `feat: add candidate optimizer`
12. `feat: upgrade mastering Listen Lab`
13. `feat: learn bounded artist mastering preferences`
14. `feat: add release mastering coherence`
15. `experiment: add shadow ML parameter proposals` only if Gate J is met
16. `test: complete mastering V2 listening and regression evidence`
17. `docs: reconcile shipped mastering V2 behavior`

The PR stays draft until all non-conditional gates required for the chosen production scope are complete.

## 40. Final validation matrix

| Area | Required evidence |
| --- | --- |
| Technical correctness | Python tests + exact post-render measurements |
| TypeScript/domain | Studio contracts + typecheck |
| UI | focused browser tests + accessibility |
| Database | clean migration replay + RLS/Data API checks |
| Worker | bootstrap/runtime contract + failure recovery |
| Fidelity | native rate/bit-depth assertions |
| Loudness | target-range + true-peak + limiter telemetry |
| Dynamics | PLR + transient + short-term delta |
| Tone | bounded spectral-change evidence |
| Stereo | no mono/phase regression |
| Codec | real generated stress renders |
| Reference | explicit trust + similarity/confidence evidence |
| Candidate selection | deterministic multi-objective ranking |
| Product | loudness-matched Listen Lab acceptance |
| Subjective quality | blind representative-catalog listening |
| Release coherence | ordered multi-track acceptance |
| Regression | V1 streaming-safe behavior preserved |

Before merge run the repository's relevant full gates:

- `npm run test:studio`
- `npm run typecheck`
- `npm run lint`
- mastering/media-worker Python tests
- relevant Audio Intelligence CI/deep validation
- database verification for new migrations
- production build
- authenticated browser journey where credentials are available
- private real-track listening benchmark

## 41. Definition of done

The implementation program is complete only when:

1. `streaming_safe` remains a transparent, dynamics-preserving safety path.
2. Creative mastering no longer relies on hidden `loudnorm` dynamic fallback as its final processing policy.
3. Canonical mastered assets preserve justified native sample rate and 24-bit precision independently of storage object limits.
4. Mastering targets are adaptive ranges with explicit change budgets.
5. Trusted references are selected and weighted by relevance, not simple catalog median alone.
6. Tonal processing uses a finer perceptual representation and remains bounded.
7. Dynamics processing is program-dependent and reports actual gain-reduction behavior.
8. Transient damage is directly measured.
9. Low-end processing is evidence-driven rather than a fixed high-pass.
10. Corrective M/S exists only for measured translation problems; blind widening remains absent.
11. An explicit true-peak mastering limiter owns final peak control.
12. Multiple bounded candidates can be evaluated without brute-force compute.
13. Recommendation uses independent objectives rather than a universal mastering quality score.
14. A candidate can hit loudness and still be rejected for excessive damage.
15. Listen Lab makes meaningful changes easy to hear at matched loudness.
16. Artist mastering preferences can influence future decisions only through structured explicit evidence.
17. Release/album mastering can preserve intentional inter-track relationships.
18. Any ML layer proposes bounded DSP parameters and cannot bypass deterministic policy.
19. Every promoted master retains exact source, processor, analysis and approval lineage.
20. The existing Master Readiness UX remains calm and diagnosis-first.
21. Blind listening on the representative corpus demonstrates that V2 is meaningfully preferable often enough to justify production rollout without creating regressions on already-good masters.

### Acceptance sentence

If Ensemblis changes a master, it must be able to answer:

> **Why did we change it, exactly what did we change, what did it cost, how did we verify it, and why is this candidate preferable to leaving the source alone?**

If the system cannot answer those questions with deterministic evidence plus human listening, it should preserve the source.

## 42. Research references

These references motivate architecture; they are not runtime dependencies.

- Spotify for Artists — Loudness normalization / mastering guidance: https://support.spotify.com/artists/article/loudness-normalization/
- Spotify for Artists — Track loudness behavior: https://support.spotify.com/artists/article/track-not-as-loud-as-others/
- Apple Video and Audio Asset Guide — Music Audio / Apple Digital Masters: https://help.apple.com/itc/videoaudioassetguide/en.lproj/static.html
- FFmpeg Filters — `loudnorm`: https://ffmpeg.org/ffmpeg-filters.html
- iZotope — Ozone 12 Master Assistant: https://www.izotope.com/community/blog/how-to-use-master-assistant-in-ozone
- Martínez Ramírez et al., DeepAFx / automatic mastering: https://arxiv.org/abs/2105.04752
- Koo et al., ITO-Master: https://arxiv.org/abs/2506.16889
