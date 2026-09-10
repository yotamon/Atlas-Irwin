# Ensemblis Marketing Website — Implementation Blueprint

## Purpose

This document translates the marketing concept into an implementation system.

It covers:

- motion vocabulary
- audio behavior
- responsive rules
- accessibility
- performance
- component architecture
- shared demo state
- analytics
- SEO
- route structure
- development phases
- definition of done

The implementation must remain consistent with the canonical Ensemblis design system in `docs/ensemblis-design-system.md` and should reuse existing product-domain models where possible rather than invent a parallel marketing-only representation of Ensemblis.

---

# 1. Motion system

Motion is not decoration.

Every animation should help answer:

> **What is Ensemblis doing with the music?**

## Motion vocabulary

| Motion | Meaning | Typical use |
|---|---|---|
| `Scan` | the system is listening / reading | analysis |
| `Resolve` | signal becomes meaningful data | metrics, structure |
| `Connect` | relationships between tracks | compatibility |
| `Flow` | energy / sequence movement | mix, set building |
| `Extract` | a meaningful moment is isolated | Promote |
| `Transform` | music insight becomes another artifact | Master / Promote |
| `Pulse` | musical feedback / state acknowledgment | microinteraction |
| `Return` | visual narrative reconnects | final CTA |

These should become reusable implementation primitives rather than one-off animation inventions.

## Hero choreography

### H0 — Neutral

- waveform enters with minimal movement
- avoid a constantly dancing waveform before playback
- headline and CTA are immediately readable

### H1 — Scan

- one directional scan moves through waveform
- short state label may appear: `Listening`
- no fake percentage unless backed by actual progress

### H2 — Resolve

Reveal in logical order:

1. BPM
2. key
3. structure
4. energy
5. strongest moment
6. character / mood

### H3 — Branch

The four product actions emerge from the same analyzed signal.

The user should visually understand:

```text
one analysis → several workflows
```

## Scroll behavior

Use scroll-driven motion only when it improves understanding.

Preferred:

- pinned visual with changing contextual copy
- subtle object continuity between sections
- progressive disclosure
- bounded parallax
- timeline scrubbing for product-story sequences

Avoid:

- long forced scroll-jacking
- slowing browser scroll physically
- hijacking browser navigation
- large movement for every small text element
- continuous unrelated decorative motion

## Waveform behavior

The waveform is the site's main visual language.

Semantic display modes may include:

```text
RAW
STRUCTURE
ENERGY
DYNAMICS
TRANSITION
STRONG MOMENT
MASTER DIFFERENCE
```

The visual identity remains consistent while the semantic layer changes.

Do not recreate a visually unrelated waveform per section. The user should feel that the same piece of music is traveling through the page.

## Mastering motion

Before / after should not use exaggerated fake visual differences.

Recommended:

- waveform remains structurally identical
- subtle dynamics / loudness visualization changes
- labels explain what changed
- audible proof carries the strongest evidence

## Mix motion

Two tracks should visually approach one another.

```text
Track A ─────────────╲
                     ╲
                      ╲ overlap
                       ╲
                        ───────────── Track B
```

During playback:

- outgoing energy fades
- incoming energy rises
- transition window is highlighted
- relevant compatibility labels remain visible

## Promote motion

The transformation should be explicit:

```text
Waveform
   ↓ Extract
Strong moment
   ↓ Transform
Vertical content frame
   ↓ Expand
Campaign system
```

The creative frame should feel derived from the track rather than appearing from nowhere.

## Microinteractions

Recommended:

- hover/focus structure region → highlight waveform segment
- hover/focus metric → illuminate relevant visualization
- scrub audio → immediate playhead response
- compatibility item → reveal relationship source
- promotion clip → extraction boundary responds
- CTA → subtle tactile compression

Avoid:

- bouncing cards
- random floating particles
- looping text distortions
- excessive cursor-following effects

## Reduced motion

Respect:

```css
@media (prefers-reduced-motion: reduce)
```

Reduced-motion behavior should:

- remove pinned scroll animation
- remove long translations
- use fades / instant state swaps
- preserve all information
- preserve interactive controls
- keep audio opt-in

The product story must remain fully understandable.

---

# 2. Audio system

## Rules

### Never autoplay audible audio

The user must explicitly initiate playback.

### Use short examples

Good uses:

- mastering A/B
- DJ transition
- promoted strongest moment

### Keep state synchronized

When audio plays:

- playhead movement must remain synchronized
- waveform active region reflects playback
- time labels remain accurate
- switching examples stops conflicting audio

### Single active source

Only one website audio example may play at a time.

## Shared audio coordinator

Create one shared coordinator responsible for:

- one active playback source
- lazy loading
- current time
- duration
- playhead sync
- route-change cleanup where relevant
- errors
- avoiding unnecessary multiple `AudioContext` instances

Do not allow every homepage section to own global audio behavior independently.

---

# 3. Loading and processing states

Avoid a generic centered spinner when meaningful pipeline stages exist.

Potential stages:

```text
Listening
Reading rhythm
Mapping structure
Finding strong moments
Analyzing dynamics
Building track profile
```

Rules:

- do not expose fake backend states
- do not show fake exact percentages
- stage labels should correspond as closely as possible to real processing
- provide explicit failure and retry states

---

# 4. Responsive system

Mobile is not a scaled-down desktop.

The story remains the same, but presentation becomes sequential and touch-friendly.

## Suggested content breakpoints

These are starting points, not immutable framework doctrine:

- compact: `< 640px`
- medium: `640–1023px`
- wide: `>= 1024px`
- large editorial: `>= 1440px`

## Hero on mobile

```text
YOUR MUSIC.
UNDERSTOOD.

[ Analyze a track ]

waveform

122 BPM
F minor
Warm / Hypnotic

Strong moment 01:14
```

Reveal information vertically instead of compressing simultaneous desktop metadata.

## Pillars on mobile

Use sequential sections:

1. Understand
2. Refine
3. Mix & Perform
4. Promote

Do not use tiny four-column cards.

## Mix on mobile

- tracks stack vertically
- transition window appears between them
- compatibility facts become a short list

## Promote on mobile

Vertical creative output should become a major visual moment rather than a desktop artifact scaled down.

## Touch

Minimum interactive target:

`44 × 44 CSS px`

All hover interactions require tap / focus equivalents.

Essential information must never be hover-only.

## Typography

Use fluid sizing with `clamp()` where appropriate.

Avoid oversized display type that forces one word per viewport on normal phones.

---

# 5. Accessibility

## Semantic structure

- one logical `h1`
- hierarchical headings
- semantic navigation
- buttons for actions
- links for navigation
- proper form labels

## Keyboard

All interactive elements must be keyboard reachable.

Required:

- visible focus
- logical tab order
- escape handling for dialogs
- no keyboard traps
- accessible audio controls

## Contrast

Meet WCAG AA for functional text and controls.

Decorative low-contrast labels may exist only when they do not carry essential meaning.

## Visualized audio data

Waveform / graph output cannot be the only representation of important information.

Example visual:

`01:14 → 01:27`

Accessible text:

`Strongest detected moment: 1 minute 14 seconds to 1 minute 27 seconds.`

## Audio accessibility

- no autoplay with sound
- accessible play / pause
- clearly labeled A/B states
- textual explanation for audio-only comparisons where practical

---

# 6. Performance

Art direction is not an excuse for a slow site.

## Suggested Core Web Vitals goals

Aim for:

- LCP ≤ 2.5 s at the 75th percentile
- INP ≤ 200 ms
- CLS ≤ 0.1

These are engineering goals, not marketing claims.

## Initial load priority

Prioritize:

1. navigation
2. hero typography
3. primary CTA
4. lightweight hero waveform shell

Defer:

- demo audio
- lower-page video
- rich Promote assets
- advanced canvas scenes

## Audio assets

- short web-optimized previews
- lazy load
- preload only the first meaningful interaction where justified
- do not preload every example

## Video assets

- poster first
- lazy load
- responsive source
- short loops
- no enormous background video by default

## Images

- responsive sizing
- modern formats
- explicit dimensions
- lazy loading below the fold

## Rendering strategy

Use DOM/SVG for:

- labels
- editorial typography
- basic structural diagrams
- accessible interactive controls

Use Canvas for:

- dense waveform animation
- high-frequency audio visualization
- large animated time-series data

Use WebGL / Three.js only if a defined experience genuinely requires it.

## Motion performance

Prefer:

- transforms
- opacity
- GPU-friendly Canvas rendering
- `requestAnimationFrame` for synchronized animation
- `IntersectionObserver` for section activation

Avoid:

- repeated layout reads/writes
- animating layout-heavy properties
- multiple full-screen blur filters
- dense always-on particle systems
- expensive always-on WebGL scenes

## Failure resilience

If Canvas fails:

- core copy remains
- CTA remains
- static waveform fallback can render

If audio cannot play:

- the demo remains understandable visually and textually

If JavaScript is delayed:

- hero, navigation, value proposition and CTA remain visible

---

# 7. Technical architecture

## Recommended stack

The future marketing site should align with the existing Ensemblis stack rather than introduce a parallel technology ecosystem.

Likely web layer:

```text
Next.js
React
TypeScript
Ensemblis design tokens / CSS architecture
Motion library selected during implementation
Web Audio API
Canvas + SVG
```

Three.js / WebGL is not a default dependency.

## Current and future hosting context

Current repository:

```text
yotamon/Atlas-Irwin
```

Current product/site coexistence remains defined elsewhere in the repository.

Future intended split:

```text
Atlas Irwin codebase / public artist website

Ensemblis codebase
├── ensemblis.com marketing
└── Ensemblis application on its own product domain/subdomain
```

Do not hard-code the future marketing implementation around `atlasirwin.com` as a permanent host assumption.

## Proposed route structure

Future public routes may include:

```text
/
├── /analysis
├── /mastering
├── /mix
│   ├── /automix
│   └── /dj
├── /promote
│   ├── /content
│   └── /release-campaigns
├── /artists
├── /pricing
├── /about
└── /resources
    ├── /guides
    ├── /music-analysis
    ├── /mastering
    ├── /dj
    └── /promotion
```

Not every route must launch on day one.

## Proposed component domains

```text
components/
├── marketing/
│   ├── nav/
│   ├── hero/
│   ├── sections/
│   ├── demo/
│   └── footer/
├── audio/
│   ├── audio-player/
│   ├── waveform/
│   ├── playhead/
│   ├── spectrum/
│   └── audio-context/
├── motion/
│   ├── scan/
│   ├── resolve/
│   ├── connect/
│   ├── extract/
│   └── transform/
└── ui/
```

The exact paths should be reconciled with existing Ensemblis code conventions during implementation.

## Homepage component map

```text
MarketingHomepage
│
├── MarketingNav
├── HeroMusicIntelligence
│   ├── HeroCopy
│   ├── TrackWaveform
│   ├── AnalysisScanner
│   ├── HeroMetrics
│   └── UploadCTA
│
├── IntelligenceLayerSection
│   ├── SemanticModeSelector
│   └── TrackVisualization
│
├── PillarsIntro
├── UnderstandSection
├── RefineSection
│   ├── MasterABControl
│   └── MasterVisualization
├── MixPerformSection
│   ├── TrackPair
│   ├── CompatibilityDetails
│   └── TransitionPreview
├── PromoteSection
│   ├── StrongMomentSelector
│   ├── ExtractedMoment
│   ├── PromoAssetPreview
│   └── CampaignContext
├── AuthorshipStatement
├── SharedIntelligenceSection
├── InteractiveDemo
├── CatalogIntelligencePreview
├── FinalCTA
└── MarketingFooter
```

---

# 8. Shared demo data

The homepage should not let every section invent unrelated demo data.

Define one canonical demo track.

Conceptual shape:

```ts
type DemoTrack = {
  id: string
  title: string
  artist: string
  durationMs: number
  bpm: number
  key: string
  mood: string[]
  structure: Section[]
  energyCurve: number[]
  strongMoments: Moment[]
  mastering?: MasteringExample
  mixExample?: MixExample
  promotionExample?: PromotionExample
}
```

This shape is illustrative only.

The final implementation should reuse existing product-domain types if available.

## Marketing truth rule for demo data

Do not create a second fake model of the product.

Prefer one of:

1. real API result from a stable demo track
2. serialized snapshot generated by the real analysis pipeline
3. curated deterministic fixture conforming to production domain types

For launch, a deterministic fixture generated from actual product output may be ideal because it provides:

- stable animation
- no demo API latency
- realistic data
- no schema divergence

---

# 9. Hero state model

Conceptual states:

```text
idle
  ↓
listening
  ↓
resolving_bpm
  ↓
resolving_key
  ↓
resolving_structure
  ↓
resolving_energy
  ↓
resolved
  ↓
pillars_visible
```

Reduced-motion path:

```text
idle → resolved
```

These state names are implementation guidance, not public copy.

---

# 10. Content architecture

Do not hardcode all marketing text independently across dozens of components.

Use structured content for:

- headline
- supporting copy
- CTA labels
- capability status
- demo captions
- FAQ
- SEO metadata

A typed local content layer is enough for v1.

A CMS is not required until editorial workflow proves a need.

## Capability status

Suggested model:

```ts
type CapabilityStatus =
  | "live"
  | "beta"
  | "coming-soon"
  | "vision"
```

`vision` must never be rendered as currently usable capability.

---

# 11. Conversion architecture

## Primary goal

> **Visitor → Track Upload**

Not:

> Visitor → Pricing Page

## Core funnel

```text
VISITOR
   ↓
UNDERSTANDS THE IDEA
   ↓
SEES / HEARS PRODUCT PROOF
   ↓
ANALYZE A TRACK
   ↓
UPLOAD
   ↓
USEFUL FREE INSIGHT
   ↓
ACCOUNT
   ↓
MASTER / MIX / PROMOTE
   ↓
PAID VALUE
```

## Upload CTA integration

Preferred experience:

```text
Analyze a track
      ↓
File picker / drop zone
      ↓
Validation
      ↓
Upload
      ↓
Analysis
      ↓
Result
```

Avoid forcing:

```text
CTA → generic signup screen → dashboard → hunt for upload
```

unless authentication architecture genuinely requires it.

---

# 12. Analytics

Create a typed marketing analytics layer rather than sprinkling provider-specific calls across components.

Concept:

```text
trackMarketingEvent(event, properties)
```

## Suggested events

```text
homepage_viewed
hero_analyze_clicked
hero_demo_clicked

pillar_analysis_viewed
pillar_mastering_viewed
pillar_mix_viewed
pillar_promote_viewed

demo_started
demo_tab_analysis_viewed
demo_master_original_played
demo_master_result_played
demo_mix_played
demo_promote_viewed

upload_started
upload_file_selected
upload_completed
analysis_completed
account_created

analysis_to_master_clicked
analysis_to_mix_clicked
analysis_to_promote_clicked

pricing_viewed
checkout_started
subscription_completed
```

## Shared event properties

Potential properties:

- `source_page`
- `source_section`
- `device_class`
- `referrer_type`
- `campaign`
- `demo_track_id`
- `auth_state`

Do not send raw user audio or sensitive derived content to generic analytics providers.

## KPI hierarchy

### Primary

- visitor → upload-start rate
- visitor → upload-complete rate

### Secondary

- upload → account
- analysis → mastering
- analysis → mix
- analysis → promote
- demo engagement
- organic visitor → upload
- returning visitor → upload
- paid conversion

### Diagnostic

- CTA visibility
- demo completion
- upload errors
- analysis failure rate
- mobile abandonment
- Core Web Vitals

---

# 13. SEO

Do not build the organic strategy only around `AI`.

## Music Analysis cluster

Potential topics:

- music analysis
- song structure analysis
- BPM detector
- key detector
- loudness analysis
- dynamic range analysis
- song energy analysis
- strong moment detection

## Mastering cluster

Potential topics:

- online mastering
- AI mastering
- mastering analysis
- album mastering
- streaming loudness
- mastering comparison
- tonal balance

## DJ / Mix cluster

Potential topics:

- automatic DJ mix
- DJ mix maker
- harmonic mixing
- DJ transition
- DJ set builder
- track compatibility
- Camelot mixing
- energy-aware DJ sets

## Promotion cluster

Potential topics:

- music promotion
- release campaign
- promote a song
- music marketing
- content ideas for musicians
- TikTok music promotion
- Instagram Reels for musicians
- Spotify Canvas ideas
- music teaser ideas
- release strategy

## Free-tool acquisition

Potential future public tools:

```text
/free/bpm-detector
/free/key-detector
/free/loudness-checker
/free/song-structure-analyzer
/free/dj-compatibility
/free/strongest-moment-finder
```

Each should:

1. solve a real problem
2. expose a useful part of Ensemblis intelligence
3. avoid bait-and-switch
4. naturally lead to deeper analysis
5. preserve product truth

## Editorial strategy

Resources should not become a generic AI-content blog.

Preferred themes:

- audio analysis
- mastering
- artist workflows
- DJ technique
- track compatibility
- promotion informed by music
- release strategy
- catalog intelligence

Bad:

`10 Amazing Ways AI Is Changing Music`

Better:

`How to choose the strongest 15 seconds of a track for a release teaser`

## Structured data

Consider appropriate schema by page type:

- Organization
- SoftwareApplication where appropriate
- Article
- BreadcrumbList
- FAQ only where genuine visible FAQ content exists

Do not add structured data solely to manipulate search appearance.

---

# 14. Trust and proof

Do not fabricate:

- user counts
- label logos
- artist endorsements
- success percentages
- "trusted worldwide" statements

Early-stage social proof should be product proof:

- actual analysis
- actual detected moments
- real mastering A/B
- real transition example
- real campaign output

Show intelligence instead of claiming intelligence.

---

# 15. Error states

Design and implement at minimum:

- demo audio unavailable
- waveform fixture unavailable
- upload interrupted
- unsupported audio file
- analysis unavailable
- processing timeout
- playback error
- network loss

A polished product must design more than the happy path.

---

# 16. Development phases

## Phase 0 — Foundation

- reuse / extend canonical Ensemblis tokens
- typography
- layout primitives
- marketing shell
- nav
- footer
- capability status model
- analytics wrapper

## Phase 1 — Narrative skeleton

- homepage sections
- final copy
- responsive layout
- static waveform fixture
- primary CTA flow

## Phase 2 — Motion

- Scan / Resolve
- section transitions
- waveform semantic modes
- Promote extraction sequence
- reduced-motion implementation

## Phase 3 — Audio proof

- mastering A/B
- mix transition
- promo moment playback
- shared audio coordinator

## Phase 4 — Demo

- real demo-track fixture
- four-tab demo
- actual product result mapping

## Phase 5 — Product pages

- analysis
- mastering
- mix
- promote
- pricing
- about

## Phase 6 — Acquisition

- resources
- free tools
- SEO expansion
- case studies

---

# 17. QA matrix

Test at minimum:

- small Android phone
- large Android phone
- modern iPhone-size viewport
- tablet portrait
- tablet landscape
- laptop
- 1440p desktop
- keyboard-only desktop
- reduced-motion desktop/mobile
- throttled mid-range mobile performance

At every width, ask:

> **Is the track still the protagonist?**

If the interface collapses into a stack of generic cards, the design has lost the Ensemblis narrative.

---

# 18. Definition of Done — Homepage v1

## Product

- four pillars represented correctly
- Promote has equal narrative importance
- product statuses are truthful
- upload CTA enters real flow

## UX

- story works without sound
- story works with reduced motion
- mobile is designed, not merely collapsed
- controls are keyboard accessible

## Visual

- no generic AI visual clichés
- same track persists visually
- typography has editorial hierarchy
- motion follows the defined vocabulary

## Engineering

- Core Web Vitals goals respected
- audio lazy-loaded
- animation does not monopolize the main thread
- failure states implemented
- analytics typed
- SEO metadata complete

## QA

- mobile / desktop matrix tested
- reduced motion tested
- keyboard tested
- slow-network behavior tested
- actual demo output validated against product behavior

## Final principle

The website should feel like a **digital musical instrument**, not a motion-design showreel and not a generic SaaS landing page.
