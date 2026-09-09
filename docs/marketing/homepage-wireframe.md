# Ensemblis Marketing Homepage — Wireframe & Scroll Narrative

## Objective

The homepage must answer:

> **What becomes possible when Ensemblis understands my music?**

It should not feel like a feature catalog. The user should experience one continuous musical object moving through the entire page.

## Global page model

```text
TRACK ENTERS
    ↓
TRACK IS UNDERSTOOD
    ↓
SIGNAL BECOMES INFORMATION
    ↓
INFORMATION BECOMES DECISIONS
    ↓
TRACK IS REFINED
    ↓
TRACKS CONNECT
    ↓
MIX / PERFORMANCE EMERGES
    ↓
A MOMENT IS EXTRACTED
    ↓
THE MOMENT BECOMES PROMOTION
    ↓
TRACK LEAVES ENSEMBLIS
```

The waveform introduced in the hero is the recurring visual protagonist throughout the page.

---

# Section 00 — Navigation

## Desktop

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ ENSEMBLIS    Product ▾   For Artists   DJ & Mixes   Promote   Pricing       │
│                                                        Sign in [Analyze]     │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Product dropdown

```text
UNDERSTAND
Music Analysis

REFINE
Mastering

MIX & PERFORM
AutoMix
DJ Tools

PROMOTE
Release Intelligence
Content & Campaigns
```

## Behavior

- transparent / minimal over hero
- sticky
- gains a subtle background after scrolling
- primary CTA remains visible
- the navigation should not compete with the hero motion

---

# Section 01 — Hero

## Viewport

Target: roughly `90–100svh` on desktop.

## Layout

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│                                                                              │
│                        YOUR MUSIC. UNDERSTOOD.                               │
│                                                                              │
│       Deep music intelligence for artists, producers and DJs.               │
│                                                                              │
│                [ Analyze a track ]   See how it works                        │
│                                                                              │
│         00:00 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 03:42                 │
│                                                                              │
│                 waveform / live analysis canvas                              │
│                                                                              │
│      BPM 122       F minor      Warm / Hypnotic       Energy ↑               │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

## Hero animation sequence

### H0 — Arrival

- headline visible
- waveform visible but neutral
- minimal metadata
- CTA available immediately

### H1 — Listening

A scan line passes through the waveform.

Optional microcopy:

`Listening`

### H2 — Resolving

Reveal progressively:

1. BPM
2. key
3. structural markers
4. energy curve
5. strongest moment
6. mood / character

### H3 — Possibilities

Four labels emerge around the analyzed track:

```text
UNDERSTAND     REFINE     MIX & PERFORM     PROMOTE
```

They must visually feel like consequences of the analysis, not unrelated navigation cards.

## Hero copy

### H1

> **Your music. Understood.**

### Subcopy

> Deep music intelligence for artists, producers and DJs. Analyze your tracks, refine your sound, build mixes and create promotion around what makes your music yours.

### CTA

`Analyze a track`

### Secondary CTA

`See how it works`

---

# Section 02 — One Track Contains More Than Audio

## Purpose

Explain the central intelligence layer.

## Layout

Left: oversized editorial statement.  
Right / center: interactive track analysis.

```text
ONE TRACK CONTAINS
MORE THAN AUDIO.

                         TRACK
                           │
        ┌──────────────────┼──────────────────┐
        ▼                  ▼                  ▼
     MUSICAL             SONIC            STRUCTURAL
     Key                 Dynamics         Sections
     BPM                 Loudness         Hooks
     Mood                Spectrum         Drops
     Energy              Balance          Moments
```

## Interaction

Hover / focus on a dimension highlights the relevant portion of the waveform.

Examples:

- `Energy` shows curve
- `Structure` reveals regions
- `Dynamics` changes amplitude emphasis
- `Strongest moment` creates a focused marker

## Exit transition

The one central track visually splits into four pathways.

---

# Section 03 — Product Pillars Intro

## Copy

> **One understanding. Four ways forward.**

```text
01 UNDERSTAND
02 REFINE
03 MIX & PERFORM
04 PROMOTE
```

Desktop may use a large horizontal editorial grid.

Mobile becomes sequential.

---

# Section 04 — Understand

## Headline

> **Hear what your track is telling you.**

## Desktop composition

```text
┌──────────────────────┬───────────────────────────────────────────────────────┐
│                      │                                                       │
│  UNDERSTAND          │   waveform                                            │
│                      │   ├ structure                                         │
│  Hear what your      │   ├ energy                                            │
│  track is telling    │   ├ strongest moments                                 │
│  you.                │   └ dynamics                                          │
│                      │                                                       │
│  [Explore Analysis]  │   contextual metadata                                 │
└──────────────────────┴───────────────────────────────────────────────────────┘
```

## Motion

Scroll causes the raw waveform to resolve into richer semantic layers.

Do not place all metrics in cards. Prefer one musical visualization that can change modes.

---

# Section 05 — Refine

## Headline

> **Make it ready to leave the studio.**

The same waveform continues into mastering.

## Interaction

Before / after toggle:

```text
[ Original ]  [ Ensemblis Master ]
```

Audio plays only after explicit user action.

Visuals may show:

- tonal balance
- loudness relationship
- dynamics
- release-readiness state

## Narrative transition

Analysis data should visibly feed mastering.

```text
UNDERSTAND → REFINE
```

The section must not feel like opening an unrelated feature.

---

# Section 06 — Mix & Perform

## Headline

> **Turn tracks into journeys.**

The original track moves left. A second track enters from the opposite side.

```text
TRACK A
   ╲
    ╲
     ╲_______ TRANSITION WINDOW
                      ╲
                       ╲
                        TRACK B
```

## Intelligence overlay

```text
Harmonic match          ✓
Energy flow             ✓
Tempo compatibility     ✓
Suggested transition    02:41 → 00:32
```

## Interaction

On explicit play:

- hear a short transition example
- waveform crossfade aligns to audio
- playhead illustrates the transition
- contextual explanation appears

## CTA

`Explore Mix & Perform`

---

# Section 07 — Promote

## Headline

Primary recommendation:

> **Your track already contains the campaign.**

Supporting line:

> Promotion that starts with the music.

## Core transformation

This section visually converts the musical object into campaign material.

### Step 1 — Find the moment

Waveform marker:

```text
STRONG MOMENT
01:14 → 01:27
```

### Step 2 — Extract

The selected segment separates from the main waveform.

### Step 3 — Transform

The segment becomes a vertical creative frame.

```text
┌───────────────────────┐
│                       │
│      VISUAL LOOP      │
│                       │
│      ARTIST NAME      │
│       TRACK NAME      │
│                       │
│       OUT FRIDAY      │
└───────────────────────┘
```

### Step 4 — Contextual intelligence appears

```text
Hook        13 sec
Platform    Reels / TikTok
Mood        Euphoric tension
Use         First teaser
Timing      T-10
```

### Step 5 — Campaign expands

The single asset fans out into:

- teaser
- clip
- visual direction
- caption direction
- release timing

## Example explanation

> The strongest emotional shift begins at 01:12. Use the eight seconds before it to build tension, then reveal the drop.

This is a key differentiator and should be highly visible.

## CTA

`Explore Promote`

---

# Section 08 — Human / Authorship Statement

This is a deliberate quiet moment with large empty space.

## Copy

> **You made the music.**

Then:

> Ensemblis is built around it. Not instead of it.

Supporting statement:

> Its job is to listen, understand and help your work travel further.

No product UI overload in this section.

---

# Section 09 — One Understanding. Everywhere.

## Headline

> **One understanding. Everywhere.**

```text
                   YOUR TRACK
                       │
                       ▼
               MUSIC INTELLIGENCE
                       │
      ┌────────────────┼─────────────────┐
      │                │                 │
   ANALYSIS         MASTERING       MIX / PERFORM
      │                │                 │
      └────────────────┼─────────────────┘
                       │
                    PROMOTE
```

Copy:

> Ensemblis should not need to rediscover the same track every time you open another workflow. The understanding travels with the music.

This section explains architectural/product coherence without exposing implementation details.

---

# Section 10 — Interactive Demo

## Goal

Prove capability.

A real example track persists across four tabs:

```text
[ Understand ] [ Refine ] [ Mix ] [ Promote ]
```

### Understand

- waveform
- sections
- energy
- key
- BPM
- strongest moments

### Refine

- original/master switch
- concise change explanation

### Mix

- second track
- compatibility
- transition point
- short listenable preview

### Promote

- detected clip
- visual / campaign direction
- timeline idea

## Requirement

The demo should use actual product output wherever technically possible.

No fabricated fake-product results presented as real capability.

---

# Section 11 — Catalog Intelligence Preview

This is future-facing, not necessarily a launch feature.

## Headline

> **Your catalog becomes more useful as Ensemblis understands it.**

```text
Track 01 ─┐
Track 02 ─┼──► RELEASE IDENTITY
Track 03 ─┘          │
                     ▼
               CATALOG PATTERNS
                     │
                     ▼
                 YOUR SOUND
```

If not live, clearly mark as future / coming later or omit from the initial launch.

---

# Section 12 — Final CTA

The original hero waveform returns, now containing the information discovered throughout the page.

## Copy

> **Ready to hear what Ensemblis hears?**

Primary:

`Analyze a track`

Supporting note:

> Start with your music.

Optional supporting line:

> No music is generated. Start with yours.

---

# Section 13 — Footer

```text
PRODUCT
Analysis
Mastering
Mix & Perform
Promote

RESOURCES
Guides
Music Analysis
Mastering
DJ
Promotion

COMPANY
About
Contact

LEGAL
Privacy
Terms
Cookies
```

---

# Desktop scroll choreography

```text
Hero waveform
      │
      ▼
Waveform gains semantic layers
      │
      ▼
Layers become product possibilities
      │
      ▼
Analysis resolves
      │
      ▼
Mastering modifies the same object
      │
      ▼
Second track enters
      │
      ▼
Two tracks mix
      │
      ▼
Strong moment is isolated
      │
      ▼
Moment becomes promotional creative
      │
      ▼
All branches reconnect as one intelligence layer
      │
      ▼
Final upload CTA
```

# Mobile narrative

Mobile is not a compressed desktop.

The same story becomes sequential:

```text
YOUR MUSIC. UNDERSTOOD.
      ↓
waveform
      ↓
BPM / key / strongest moment
      ↓
Understand
      ↓
Refine
      ↓
Mix & Perform
      ↓
Promote
      ↓
One understanding
      ↓
Analyze a track
```

Rules:

- no tiny four-column cards
- essential information cannot be hover-only
- mix tracks stack vertically
- Promote's vertical creative output becomes a major mobile visual
- animations simplify rather than disappear conceptually

# Copy density rule

The homepage should use fewer words than a normal SaaS site.

Prefer one large thought, one useful product proof and one clear interaction per visual section.

Avoid multiple paragraphs beside complex motion.

# Homepage release criteria

- CTA works before animations finish.
- Page remains understandable if animations fail.
- No section requires sound to make sense.
- Each pillar visibly traces back to music understanding.
- Promote is visually equal in importance to the other pillars.
- The waveform / track remains a coherent visual object across the narrative.
- The mobile story preserves the same conceptual arc.
- No public section presents `VISION` as live functionality.
