# Ensemblis Marketing Website — Homepage Visual Specification

**Status:** Design blueprint for implementation  
**Depends on:** `homepage-wireframe.md`, `visual-design-system.md`, `implementation-blueprint.md`

This document translates the homepage wireframe into a visual composition with concrete geometry, hierarchy, motion emphasis and responsive behavior.

---

# 1. Page-level composition

The homepage is one continuous music narrative.

Visual continuity matters more than isolated section beauty.

```text
NAV
 ↓
HERO / RAW TRACK
 ↓
TRACK UNDERSTANDING
 ↓
FOUR DIRECTIONS
 ↓
UNDERSTAND
 ↓
REFINE
 ↓
MIX & PERFORM
 ↓
PROMOTE
 ↓
AUTHORSHIP / PAPER INVERSION
 ↓
ONE UNDERSTANDING
 ↓
INTERACTIVE DEMO
 ↓
CATALOG INTELLIGENCE
 ↓
FINAL CTA / RETURNED TRACK
 ↓
FOOTER
```

The same canonical demo track is the visual protagonist from Hero through Promote and reappears at the final CTA.

---

# 2. Global canvas

## Desktop

```text
viewport background   Obsidian #080B09
max canvas             1680px
content max            1520px
gutter                 clamp(24px, 4vw, 64px)
grid                   12 columns
```

The page background is almost black, not pure black.

Large sections should feel embedded into the canvas rather than placed on cards.

## Mobile

```text
grid       4 columns
gutter     18–22px
section gap 88–120px
```

---

# 3. Navigation

## Desktop

Height:

`72px`

Initial hero state:

```text
transparent
no shadow
minimal lower border or none
```

Scrolled state:

```text
background   rgba-equivalent of Deep Moss at ~88–92%
backdrop      restrained blur if performance is safe
border-bottom 1px Line
```

Layout:

```text
ENSEMBLIS   Product   For Artists   DJ & Mixes   Promote   Pricing
                                                    Sign in   [Analyze a track]
```

The mark may appear left of wordmark, but the wordmark should remain clean and understated.

Primary CTA:

- Signal Lime
- dark text
- 10px radius
- approximately 44–46px nav height

## Mobile

Height:

`60px`

```text
[mark + ENSEMBLIS]                    [menu]
```

Primary CTA should appear prominently in the opened navigation and remain available in Hero.

---

# 4. Hero

## 4.1 Height

Desktop:

`min-height: 96svh`

Minimum useful content height must still work on short laptop screens.

Mobile:

`min-height: auto`, typically visually occupying roughly `85–95svh` without forcing empty space.

## 4.2 Desktop layout

Recommended 12-column composition:

```text
┌────────────────────────────────────────────────────────────────────────────┐
│                                                                            │
│   1 2 3 4 5             6 7 8 9 10 11 12                                 │
│                                                                            │
│   YOUR MUSIC.              ┌──────────────────────────────────────────┐     │
│   UNDERSTOOD.              │                                          │     │
│                            │             WAVEFORM                     │     │
│   Deep music intelligence │                                          │     │
│   for artists...           │   structure / energy / strong moment    │     │
│                            │                                          │     │
│   [Analyze a track]        └──────────────────────────────────────────┘     │
│   See how it works                    122 BPM     F minor                    │
│                                                                            │
└────────────────────────────────────────────────────────────────────────────┘
```

Copy span:

`4–5 columns`

Visualization span:

`7–8 columns`

The waveform should not be trapped inside a large obvious card. It can live directly on the canvas with only data surfaces where needed.

## 4.3 Hero headline

Recommended treatment:

```text
YOUR MUSIC.
Understood.
```

Possible type contrast:

- `YOUR MUSIC.` in Manrope / strong technical display
- `Understood.` in Instrument Serif

or the reverse if visual prototyping proves stronger.

The intent is to visually pair:

```text
MUSIC / HUMANITY     +     INTELLIGENCE / SYSTEM
```

Do not mix three type styles.

## 4.4 Headline scale

Large desktop:

`clamp(4.5rem, 7.8vw, 8.5rem)`

Laptop:

`clamp(3.8rem, 7vw, 6.5rem)`

Mobile:

`clamp(3.1rem, 14vw, 4.6rem)`

Line height should be very tight, roughly `0.92–1.0` depending on final font.

## 4.5 Hero waveform

Initial state:

- Paper waveform at low-medium opacity
- no fake dancing animation
- one small track title / duration label

Analysis sequence:

```text
0.0s   waveform visible
0.4s   scan begins
0.8s   BPM resolves
1.1s   key resolves
1.5s   structure brackets resolve
1.9s   energy curve resolves
2.3s   strongest moment resolves
2.7s   four product directions appear
```

Exact timing can adapt to load and reduced-motion preferences.

The CTA is interactive before this sequence finishes.

## 4.6 Hero metadata

Use sparse data clusters rather than pills.

Example:

```text
122            F minor          01:14
BPM            KEY              STRONGEST MOMENT
```

Labels in small uppercase Manrope.

Numbers / values larger.

## 4.7 Hero background detail

Allowed:

- faint technical grid aligned with layout
- subtle grain
- extremely low-opacity spectral traces

Avoid:

- glowing orb behind headline
- random animated particles
- fullscreen gradient mesh

---

# 5. Section transition: Hero → Intelligence Layer

The hero waveform should descend / expand into the next section rather than disappear.

Concept:

```text
Hero waveform
     ↓ scale / reframe
Full-width track intelligence canvas
```

The headline fades from dominance while the data becomes the new visual focus.

---

# 6. Intelligence Layer section

## 6.1 Visual goal

The user should see one raw signal become multiple kinds of usable understanding.

## 6.2 Composition

Desktop may use a pinned central waveform over approximately `160–220vh` of scroll narrative.

Left and right labels enter as the user scrolls.

```text
                    TRACK
                      │
       MUSICAL        │        STRUCTURAL
       BPM            │        Sections
       Key         WAVEFORM    Hooks
       Mood            │        Drops
                      │
                    SONIC
                    Dynamics
                    Loudness
```

The display should remain sparse.

Do not show 15 cards simultaneously.

## 6.3 Mode transitions

Scroll states:

```text
RAW
 → STRUCTURE
 → ENERGY
 → DYNAMICS
 → STRONG MOMENT
```

Each mode uses the same underlying waveform geometry.

## 6.4 Section title

Large editorial line:

> **One track contains more than audio.**

Place offset from the visualization rather than centered above it like a standard SaaS section.

---

# 7. Four-pillar transition

After analysis resolves, four thin paths / labels branch from the track.

```text
                 TRACK
                   │
      ┌────────────┼─────────────┐
      │            │             │
UNDERSTAND      REFINE        MIX & PERFORM
                   │
                PROMOTE
```

This is conceptual hierarchy, not necessarily a literal tree diagram.

The branch motion should make the product coherence visually obvious.

Section title:

> **One understanding. Four ways forward.**

Typography should be large and minimal.

---

# 8. Understand section

## 8.1 Mood

Precise, analytical, quiet.

## 8.2 Layout

```text
Copy: 4 columns
Visualization: 7 columns
1 column negative space
```

The visualization may occupy most of the right side and respond to selected analysis modes.

## 8.3 Visual content

Show only a few high-value dimensions at once:

```text
STRUCTURE
ENERGY
STRONG MOMENTS
DYNAMICS
```

The section should look like an intelligent instrument, not a dashboard screenshot.

## 8.4 Accent

Primary:

- Paper
- Mist
- Signal Lime

Mint may be used for the energy curve.

Do not introduce Violet yet unless necessary.

## 8.5 CTA

Text/button hybrid:

`Explore Music Analysis →`

The primary site CTA remains available through sticky nav rather than requiring another lime button here.

---

# 9. Refine section

## 9.1 Narrative transition

The same waveform enters mastering mode.

No visual reset.

## 9.2 Visual idea

Large A/B composition:

```text
ORIGINAL                               ENSEMBLIS MASTER
──────────── waveform ────────|──────── waveform ────────────
                              ↑
                           draggable / toggle boundary
```

If a draggable boundary harms usability, use a clear segmented A/B control.

## 9.3 Supporting data

Sparse:

```text
LOUDNESS
DYNAMICS
TONAL BALANCE
RELEASE READINESS
```

Show differences rather than generic scores whenever possible.

## 9.4 Audio control

One play control.

A/B selection changes the source while keeping playhead position when technically reliable.

## 9.5 Color

Original remains mostly neutral.

Mastered result may use controlled Signal Lime emphasis.

Avoid visually implying quality solely through brighter colors.

---

# 10. Mix & Perform section

## 10.1 Mood

The site becomes more kinetic here.

This is the first section where two tracks coexist.

## 10.2 Layout

Full-width composition is preferred.

```text
TRACK A  ───────────────────────────────╲
                                          ╲
                                           ╳  TRANSITION
                                          ╱
TRACK B  ──────────────────────────────╱
```

This can occupy `8–10 columns` with supporting copy positioned asymmetrically.

## 10.3 Channel colors

```text
Track A      Signal Lime
Track B      Violet
Compatible / overlap area    Mint
```

This is a meaningful use of the three Ensemblis mark colors.

## 10.4 Compatibility proof

Display as aligned data, not badges:

```text
91%          Fm → Ab        122 → 124
MATCH        HARMONIC       BPM
```

Then:

```text
Suggested transition
02:41 → 00:32
```

## 10.5 Motion

The tracks should move toward a shared transition region as the section enters.

When sound is triggered, the visual transition follows real playback.

No perpetual animation when paused.

---

# 11. Promote section

## 11.1 Visual importance

Promote must feel equal to the other pillars, not like a marketing footer after the music tools.

## 11.2 Opening composition

Large headline on one side:

> **Your track already contains the campaign.**

On the other side, the waveform remains visible with a strongest-moment marker.

## 11.3 Transformation sequence

### P0 — full track

```text
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### P1 — moment selected

```text
━━━━━━━━━━[ 01:14 ━━━━━ 01:27 ]━━━━━━━━━━━━━━
```

### P2 — extraction

The selected region detaches vertically.

### P3 — frame transform

The extracted segment becomes a `9:16` creative frame.

```text
┌─────────────────────────┐
│                         │
│     artwork / visual    │
│                         │
│      TRACK TITLE        │
│        OUT FRIDAY       │
│                         │
└─────────────────────────┘
```

### P4 — intelligence context

Beside it:

```text
STRONGEST SHIFT     01:12
HOOK LENGTH         13 sec
USE                 First teaser
PLATFORM            Reels / TikTok
TIMING              T-10
MOOD                 Euphoric tension
```

## 11.4 Art direction

The promotional asset can inherit track artwork and a track-derived accent.

The surrounding Ensemblis page stays neutral.

This visually communicates:

> the campaign belongs to the artist, while the intelligence belongs to Ensemblis.

## 11.5 Supporting copy

Use one concrete example:

> The strongest emotional shift begins at 01:12. Use the eight seconds before it to build tension, then reveal the drop.

Do not place long generic promotion descriptions around the visual.

---

# 12. Authorship section

## 12.1 Purpose

Emotional reset.

## 12.2 Visual inversion

This is the recommended main light section.

```text
Background   Paper #F6F8F4
Text         Obsidian #080B09
```

The change should feel like entering a printed page after a long digital instrument sequence.

## 12.3 Composition

Very large negative space.

Potential layout:

```text
You made
          the music.

                               Ensemblis is built around it.
                               Not instead of it.
```

Use editorial serif selectively.

No waveform animation is necessary here.

A very faint static waveform imprint may be used only if it supports the composition.

---

# 13. One Understanding. Everywhere.

Return to Obsidian.

## Visual transition

The four previous product directions reconnect into one central music-intelligence object.

```text
UNDERSTAND ─┐
REFINE ─────┼── MUSIC INTELLIGENCE
MIX ────────┤
PROMOTE ────┘
```

The goal is not to draw a software architecture diagram.

It should feel more like musical channels feeding a shared bus.

## Headline

> **One understanding. Everywhere.**

Supporting copy is concise.

---

# 14. Interactive Demo section

## 14.1 Visual shift toward product

This section should look more like real Ensemblis Studio than the editorial sections around it.

The visitor should feel they have arrived at the actual instrument.

## 14.2 Container

Large product surface:

```text
background   Graphite Moss
border       Line
radius       20px
```

Avoid floating it inside another rounded card.

## 14.3 Tabs

```text
Understand   Refine   Mix   Promote
```

Tabs should reuse Studio semantics where practical.

## 14.4 Demo track header

Include:

- artwork
- track title
- artist
- duration
- play control

Keep metadata compact.

## 14.5 Understand tab

Show:

- waveform
- section brackets
- energy
- strong moment
- BPM / key

## 14.6 Refine tab

Show:

- A/B
- mastering result
- a few relevant deltas

## 14.7 Mix tab

Show:

- paired second track
- transition
- compatibility

## 14.8 Promote tab

Show:

- extracted moment
- campaign frame
- concise recommendation

The same track data must persist between tabs.

---

# 15. Catalog Intelligence preview

## Status sensitivity

If catalog intelligence is not live, this section must be marked appropriately or deferred from launch.

## Visual direction

Avoid a node-cloud graph.

Preferred:

```text
RELEASE 01  ─┐
RELEASE 02  ─┼── shared patterns ── artist identity
RELEASE 03  ─┘
```

Use album/release artwork strips and shared audio traits.

Possible headline:

> **The more music you add, the more Ensemblis understands your sound.**

---

# 16. Final CTA

## Visual return

The hero waveform returns.

But now it carries all the semantic layers discovered through the page.

```text
Structure
Energy
Strong Moment
Master state
Mix relationship
Promo extraction
```

They should not all be displayed at once. Instead, subtle traces can indicate the full journey.

## Headline

> **Ready to hear what Ensemblis hears?**

## CTA

Large primary button:

`Analyze a track`

Supporting line:

> Start with your music.

The final scene should feel resolved rather than explosive.

---

# 17. Footer

Minimal and quiet.

No giant CTA duplicated in footer.

Use thin top divider.

Columns:

```text
Product
Resources
Company
Legal
```

Social links may sit separately.

---

# 18. Scroll pacing

Approximate visual pacing on desktop:

| Section | Scroll weight |
|---|---:|
| Hero | 1 viewport |
| Intelligence | 1.6–2.2 viewports |
| Pillar transition | 0.7 viewport |
| Understand | 1.1 viewport |
| Refine | 1.2 viewport |
| Mix & Perform | 1.3 viewport |
| Promote | 1.5 viewport |
| Authorship | 1 viewport |
| One Understanding | 1 viewport |
| Demo | 1.4 viewport |
| Catalog | 0.9 viewport |
| Final CTA | 1 viewport |

These are design targets, not mandatory fixed heights.

Do not create scroll-jacking.

---

# 19. Visual attention budget

Each viewport should have one dominant object.

Examples:

```text
Hero              headline + waveform
Intelligence      waveform transformation
Understand        analytical track
Refine            A/B
Mix               transition
Promote           extracted clip
Authorship        typography
Demo              real product UI
Final CTA          resolved waveform
```

If two major visuals fight for attention, simplify one.

---

# 20. Mobile translation

## Hero

```text
YOUR MUSIC.
UNDERSTOOD.

supporting copy

[Analyze a track]
See how it works

waveform
122 BPM     F minor
Strongest moment 01:14
```

## Intelligence

No long pinned horizontal composition.

Use sequential mode changes inside one fixed-width visualization.

## Understand

Copy first, visualization second.

## Refine

A/B toggle rather than split-screen drag.

## Mix

```text
Track A
  ↓
Transition
  ↓
Track B
```

## Promote

The 9:16 asset becomes a natural hero object and can occupy most of the viewport width.

## Authorship

Keep paper inversion.

## Demo

Tabs may become horizontally scrollable only if all labels remain visible / accessible; otherwise use a compact segmented control or select-like pattern.

---

# 21. Reduced-motion design

When reduced motion is active:

- Hero renders directly in resolved state.
- Intelligence modes crossfade instead of scrubbing through movement.
- Mix tracks do not travel across the screen; transition relationship appears statically.
- Promote uses discrete states: waveform → selected moment → campaign frame.
- No pinned long-scroll sequences.

The design must still feel premium.

---

# 22. Prototype priority

Before building the whole homepage, prototype these four moments first:

## Prototype A — Hero scan / resolve

Tests whether the core brand idea is immediately understandable.

## Prototype B — Persistent waveform mode transition

Tests whether one track can visually carry multiple semantic layers.

## Prototype C — Mix transition

Tests multi-track color language and audio synchronization.

## Prototype D — Promote extraction

Tests the most distinctive transformation from music understanding to campaign creative.

If these four work, the rest of the homepage can be composed confidently around them.

---

# 23. Visual acceptance criteria

The homepage visual design is approved only if:

1. It is obviously a music product without reading detailed copy.
2. It does not look like a generic AI startup landing page.
3. The same track visibly connects the product pillars.
4. Promote feels musically derived rather than tacked on.
5. The editorial marketing layer and Studio product layer feel related.
6. Mobile preserves the narrative rather than collapsing into feature cards.
7. Reduced motion preserves the concept.
8. The site still feels beautiful when all audio is muted.
9. The site feels credible next to real artist artwork.
10. `Analyze a track` remains the clearest action throughout the experience.
