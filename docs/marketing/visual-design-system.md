# Ensemblis Marketing Website — Visual Design System

**Status:** Accepted visual direction for the future `ensemblis.com` marketing site  
**Relationship to product:** Must remain recognizably part of the same Ensemblis brand as Studio, while allowing a more editorial and cinematic marketing expression.

---

# 1. Visual thesis

> **Editorial Music Technology**

The marketing site should feel like a synthesis of:

- contemporary music publishing
- premium studio hardware
- club culture
- record artwork
- sophisticated creative software
- audio analysis and musical notation translated into a digital visual language

The site should feel artistic because it is about music, but disciplined because it is also a serious product.

The visual system must avoid drifting into either extreme:

```text
TOO CORPORATE                         TOO DECORATIVE
────────────────────────────────────────────────────
generic SaaS                         motion-design demo
feature cards                        illegible art direction
stock illustrations                  constant visual noise
AI gradients                         arbitrary effects
```

The target sits in the middle:

```text
              EDITORIAL MUSIC TECHNOLOGY
```

---

# 2. Relationship to the existing Ensemblis Studio design system

The current Studio already establishes useful brand anchors:

```text
Background      #080B09
Elevated BG     #0C110E
Surface         #101713
Raised          #151E19
Ink             #F6F8F4
Muted           #AAB6AF
Subtle          #7F8D84
Line            #25302A
Signal Lime     #B7F36A
Signal Bright   #D3FF99
Violet          #8A7CFF
Mint            #5CE1C6
Danger          #FF786C
```

The current Ensemblis mark also combines:

- signal lime
- violet
- mint
- three waveform-like paths

These anchors should remain recognizable on the marketing site.

The marketing site is allowed to expand the system with:

- editorial typography
- oversized spacing
- cinematic composition
- inverted paper-like sections
- richer audio-derived visualizations
- larger narrative motion

It must not casually invent a second unrelated brand.

---

# 3. Brand color architecture

## 3.1 Foundation palette

| Role | Name | Value | Purpose |
|---|---|---:|---|
| Primary background | Obsidian | `#080B09` | Main site canvas |
| Elevated background | Deep Moss | `#0C110E` | Sticky nav / elevated areas |
| Surface | Graphite Moss | `#101713` | Product/demo surfaces |
| Raised surface | Studio Green | `#151E19` | Interactive panels |
| Primary text | Paper | `#F6F8F4` | Primary type on dark |
| Secondary text | Mist | `#AAB6AF` | Supporting copy |
| Tertiary text | Ash | `#7F8D84` | Metadata |
| Fine line | Line | `#25302A` | Dividers / grids |
| Strong line | Line Strong | `#35443B` | Active separators |

## 3.2 Signal colors

| Role | Name | Value | Usage |
|---|---|---:|---|
| Primary brand signal | Signal Lime | `#B7F36A` | CTA, primary active state, strongest musical insight |
| Highlight | Signal Bright | `#D3FF99` | Small highlight / peak emphasis |
| Spectral channel A | Violet | `#8A7CFF` | Secondary analytical / track-B data |
| Spectral channel B | Mint | `#5CE1C6` | Energy / compatible / resolved states |
| Warning / heat | Coral | `#FF786C` | Warnings, clipping, negative states |

## 3.3 Color rule

The site is **not a four-accent rainbow UI**.

Default behavior:

- `Signal Lime` owns primary interaction and the core Ensemblis signal.
- `Violet` and `Mint` are mostly data channels.
- `Coral` is semantic rather than decorative.
- neutral surfaces dominate the page.

### Anti-pattern

Do not create decorative lime-violet-mint gradients merely because those colors exist in the logo.

### Correct use

Use different signal colors when the data genuinely contains different roles, such as:

```text
Track A      Signal Lime
Track B      Violet
Energy       Mint
Problem      Coral
```

---

# 4. Track-derived accent color

A track may temporarily introduce a contextual accent derived from:

- release artwork
- artist imagery
- a stable product-generated track identity

This accent belongs to the **track world**, not the global brand.

Rules:

1. It must never replace the global CTA signal color.
2. It may tint a waveform region, artwork halo, promo frame or section background detail.
3. It must pass contrast checks where used with text.
4. It should be deterministic for a given demo track.
5. It should not cause every section to change theme unpredictably.

The user should feel:

> Ensemblis has a stable identity, and the artist's music can enter that system without being visually flattened.

---

# 5. Light / paper inversion

The site is primarily dark-first.

A single strong editorial inversion is encouraged for the authorship section:

```text
Background    #F6F8F4
Text          #080B09
Muted         approximately #586059
Signal        #6C941F or an accessible darkened Signal Lime derivative
```

Purpose:

- create emotional pacing
- break long dark-page monotony
- make the human/authorship statement feel intentionally different
- evoke printed music/editorial culture

This is not a full light theme.

---

# 6. Typography system

## 6.1 UI / body authority

Use **Manrope** for:

- body copy
- navigation
- buttons
- product data
- metadata
- labels
- technical information

Reason:

- it already belongs to Ensemblis Studio
- it is highly readable
- it keeps product and marketing connected

## 6.2 Editorial display

Recommended v1 display typeface:

> **Instrument Serif**

Use it selectively for:

- hero display line
- major emotional statements
- occasional large editorial pull phrases

Do **not** use serif typography for:

- metric data
- buttons
- navigation
- forms
- dense feature descriptions

### Typography contrast

```text
EDITORIAL / EMOTIONAL              PRODUCT / INTELLIGENCE
Instrument Serif                  Manrope
large                             precise
human                             systematic
expressive                        readable
```

This contrast is central to the brand expression.

## 6.3 Type scale

Suggested desktop scale:

```text
Hero XL          clamp(4.25rem, 8vw, 8.75rem)
Display          clamp(3.4rem, 6vw, 6.6rem)
Section title    clamp(2.6rem, 4.4vw, 5rem)
H2 UI            clamp(1.9rem, 3vw, 3rem)
Lead             clamp(1.15rem, 1.6vw, 1.5rem)
Body             clamp(1rem, 1vw, 1.125rem)
Small            0.875rem
Meta             0.75rem
```

Mobile should clamp aggressively rather than preserve oversized desktop proportions.

## 6.4 Line length

Body copy:

`52–70ch`

Hero supporting copy:

`36–50ch`

Large editorial statements may use much shorter measures.

## 6.5 Letter spacing

- Large serif: neutral to slightly negative
- Large Manrope display: slight negative tracking
- Navigation / controls: normal
- Tiny uppercase metadata: moderate positive tracking

Avoid excessive all-caps copy.

---

# 7. Layout grid

## 7.1 Desktop grid

Primary:

```text
12 columns
max canvas: 1680px
content max: 1520px
outer gutter: clamp(24px, 4vw, 64px)
column gap: 20–28px
```

Use asymmetric spans frequently.

Examples:

```text
Copy     4 columns
Visual   7 columns
Gap      1 column
```

or:

```text
Visual   8 columns
Copy     3 columns
Air      1 column
```

The page should not feel centered by default.

## 7.2 Editorial alignment

Not every headline must align to the same x-coordinate.

Allowed:

- left-aligned large statements
- offset pull quotes
- centered hero moment
- asymmetric product visualizations

But alignment shifts must follow the grid.

## 7.3 Mobile

Mobile becomes a 4-column grid.

Typical gutters:

`18–22px`

Most major content spans all 4 columns.

Avoid horizontal carousels for essential product explanation.

---

# 8. Spacing rhythm

Base spacing vocabulary:

```text
4
8
12
16
24
32
48
64
96
128
160
```

Marketing sections intentionally use much more vertical air than the Studio app.

Suggested section block spacing:

```text
small transition      64–80px
standard section      112–160px
major narrative beat  160–240px
```

The page should never feel like stacked feature cards separated by 40px.

---

# 9. Section geometry

Not every section should be a rounded rectangle.

The primary website canvas is the section itself.

Use panels only when they represent:

- actual product UI
- a contained demo
- a meaningful analytical surface
- interactive audio controls

Avoid placing every paragraph and metric inside a card.

---

# 10. Surfaces

## 10.1 Editorial surface

Usually no border, no radius.

Just content on the page canvas.

## 10.2 Product surface

```text
Background     #101713
Border         #25302A
Radius         14–18px
Shadow         subtle / low-opacity
```

## 10.3 Raised demo surface

```text
Background     #151E19
Border         #35443B
Radius         18–22px
```

Use sparingly.

## 10.4 Glass

Glass effects are not a core brand motif.

A restrained translucent navigation surface is acceptable.

Do not create floating glass-card grids.

---

# 11. Border and line language

The brand should use thin, precise technical lines.

```text
standard line       1px
strong active line  1px / increased contrast
waveform main       1.5–2px equivalent
playhead             1px
section brackets     1px
```

Rounded thick borders should be rare.

---

# 12. Radius language

Marketing should feel slightly more architectural than generic consumer SaaS.

Recommended:

```text
small control        8px
button               10px
input                 10px
product panel        16px
large demo surface   20px
artwork               artwork-dependent / usually 8–12px
pill                  only for true chip/status semantics
```

Avoid universal `999px` pill controls.

---

# 13. Buttons

## Primary CTA

`Analyze a track`

Visual direction:

```text
height       48–52px desktop
background   Signal Lime
text         Obsidian
radius       10px
weight       650–700
```

Interaction:

- subtle `translateY` / scale response
- no neon glow
- no huge shadow

Hover:

- Signal Bright or controlled brightness increase

Focus:

- visible high-contrast focus ring

## Secondary button

- transparent / dark surface
- fine border
- Paper text

## Text link

Editorial underlined or arrow affordance.

Do not use a third button style unless necessary.

---

# 14. Navigation

Desktop height target:

`68–76px`

Hero state:

- transparent
- clean typography
- minimal logo treatment

Scrolled state:

- Deep Moss with restrained translucency
- 1px lower border
- no oversized blur

Primary CTA remains visible.

Logo / mark should not be given excessive visual weight relative to the hero.

---

# 15. Iconography

Direction:

- thin / medium stroke
- geometric but not sterile
- minimal corner rounding
- avoid filled colorful icons in cards

Use icons only when they speed recognition.

Do not add an icon to every feature bullet.

Musical concepts should often use signal/data visuals instead of metaphorical icons.

---

# 16. Album artwork and artist media

Artist media is allowed to be visually rich.

Rules:

- preserve original artwork proportions
- do not apply a global AI-style filter
- do not cover artwork with excessive glass overlays
- allow artwork color to influence nearby track-context visuals
- use real releases wherever possible

The marketing site should feel comfortable beside actual record artwork.

---

# 17. Waveform as primary visual language

The waveform is not decoration.

It is the recurring object that carries the product story.

Canonical modes:

```text
RAW
STRUCTURE
ENERGY
DYNAMICS
STRONG MOMENT
MASTER DIFFERENCE
MIX TRANSITION
PROMO EXTRACTION
```

## 17.1 Raw waveform

- neutral Paper / Mist tone
- moderate opacity
- no constant animation when audio is not playing

## 17.2 Active playback

- completed region may use Signal Lime
- future region remains neutral
- playhead is crisp and precise

## 17.3 Structure

Sections appear as subtle bands / brackets rather than brightly colored blocks.

Labels:

```text
INTRO
VERSE
BUILD
DROP
OUTRO
```

## 17.4 Energy

Use Mint as a secondary curve / field where appropriate.

## 17.5 Strong moment

Use Signal Lime as the dominant marker.

The strongest moment should feel selected, not glowing magically.

## 17.6 Mix

Recommended channels:

```text
Track A       Signal Lime
Track B       Violet
Shared / compatible region    Mint
```

## 17.7 Promote extraction

Use a bracket / crop gesture:

```text
─────────[ STRONG MOMENT ]─────────
           01:14 → 01:27
```

Then physically separate that region into the promotion composition.

---

# 18. Spectral / analytical graphics

Use spectral visualizations only when they communicate real information.

Allowed:

- frequency balance
- loudness
- energy
- dynamics
- stereo relationships
- compatibility

Avoid fake spectrum animations that are unrelated to the currently playing audio.

---

# 19. Data presentation

Data should feel like part of a musical instrument.

Example:

```text
122 BPM
F minor
91% compatibility
01:14 strongest moment
-9.4 LUFS
```

Use Manrope.

Numbers may be larger than labels.

Avoid putting every metric into its own rounded badge.

Preferred pattern:

```text
122
BPM
```

with space and alignment rather than a card.

---

# 20. Motion tokens

Marketing motion expands beyond Studio microinteraction durations but keeps interaction responsive.

```text
instant       80–120ms
micro         120ms
control       180ms
small reveal  320ms
editorial     520ms
narrative     700ms
cinematic     900–1100ms
```

Interactive controls should stay in the first three bands.

Narrative page transformations may use longer durations.

## Easing

```text
standard      cubic-bezier(0.2, 0, 0, 1)
emphasized    cubic-bezier(0.22, 1, 0.36, 1)
linear        playback / timeline only
```

Avoid elastic or playful bounce as a core brand behavior.

---

# 21. Motion hierarchy

Only one major motion event should dominate a viewport at a time.

Priority:

1. musical transformation
2. product interaction
3. text reveal
4. decorative movement

If 1 and 2 are active, 3 and 4 should be restrained.

---

# 22. Grain and texture

A very subtle film/print grain may be used on large static editorial surfaces.

Rules:

- extremely low opacity
- no animated noisy grain by default
- never over product UI or small text
- must not increase GPU cost meaningfully

Texture should make the page tactile, not dirty.

---

# 23. Gradient policy

Gradients are allowed only when they have a reason.

Good:

- audio-derived interpolation
- subtle depth in large backgrounds
- controlled transition between Track A and Track B

Bad:

- generic lime-to-purple CTA gradient
- random mesh-gradient backgrounds
- bright AI aura behind every section

---

# 24. Imagery policy

Preferred order:

1. real product visualization
2. real track / release artwork
3. data-derived generative graphics
4. bespoke editorial illustration

Avoid stock imagery.

Avoid anonymous headphones/laptop/music-studio stock photography.

---

# 25. Promotion visual language

Promotion output should feel like a transformation of the track rather than an unrelated social-media mockup.

The visual flow is:

```text
WAVEFORM
   ↓
MOMENT BRACKET
   ↓
EXTRACTED SEGMENT
   ↓
9:16 FRAME
   ↓
CAMPAIGN CONTEXT
```

The vertical asset may inherit artwork / track accent color.

The global Ensemblis shell remains neutral.

---

# 26. Demo product UI

The interactive demo should deliberately move closer to the existing Studio language.

This creates a useful transition:

```text
EDITORIAL MARKETING
        ↓
PRODUCT PROOF
        ↓
ENSEMBLIS STUDIO
```

The demo should therefore reuse:

- Studio surface colors
- familiar controls
- existing `--en-*` visual semantics when implemented
- product waveform language

Marketing typography may remain around the demo, but the demo itself should look like real software.

---

# 27. Responsive visual behavior

Desktop can use:

- pinned visuals
- large negative space
- asymmetric layouts
- layered data

Mobile should use:

- sequential reveal
- single dominant visualization
- fewer simultaneous metrics
- native vertical promotion frame
- 44px minimum touch targets

Do not shrink desktop data-density to phone size.

---

# 28. Accessibility visual rules

- Signal colors cannot be the only carrier of meaning.
- All graphs need text equivalents for essential information.
- Focus must remain visible over dark surfaces.
- Paper inversion must maintain AA contrast.
- Reduced-motion mode removes long translations / pinned narrative movement.
- Typography must remain readable at browser zoom.

---

# 29. Visual anti-pattern checklist

Reject a design if it contains several of these:

- six rounded cards in every section
- purple glow as default visual atmosphere
- multiple gradient orbs
- random particles
- generic AI sparkles
- glassmorphism as primary surface treatment
- a robot / brain / neural-network metaphor
- overuse of pills
- giant dashboard screenshots with no narrative focus
- text that only appears after long animation
- tiny data labels used for visual sophistication
- autoplay audio
- constantly moving waveform while paused
- artwork artificially recolored to match the brand

---

# 30. Recommended v1 visual tokens

These are specification tokens, not yet implementation code.

```css
--brand-bg: #080b09;
--brand-bg-elevated: #0c110e;
--brand-surface: #101713;
--brand-surface-raised: #151e19;
--brand-paper: #f6f8f4;
--brand-muted: #aab6af;
--brand-subtle: #7f8d84;
--brand-line: #25302a;
--brand-line-strong: #35443b;
--brand-signal: #b7f36a;
--brand-signal-bright: #d3ff99;
--brand-violet: #8a7cff;
--brand-mint: #5ce1c6;
--brand-coral: #ff786c;

--marketing-radius-control: 10px;
--marketing-radius-panel: 16px;
--marketing-radius-demo: 20px;

--marketing-grid-max: 1520px;
--marketing-canvas-max: 1680px;
--marketing-gutter: clamp(24px, 4vw, 64px);

--marketing-motion-micro: 120ms;
--marketing-motion-control: 180ms;
--marketing-motion-reveal: 320ms;
--marketing-motion-editorial: 520ms;
--marketing-motion-narrative: 700ms;
--marketing-motion-cinematic: 1000ms;
```

Implementation note:

The existing Studio currently owns `--en-*` product tokens inside `app/studio/design-system/tokens.css`. Do not create a competing second `--en-*` authority in marketing code. When marketing implementation begins, introduce a shared brand-token layer deliberately or map marketing-specific tokens to the same canonical values without violating the Studio contract.

---

# 31. Visual quality question

For every major design decision ask:

> **Would this still look like Ensemblis if the word “AI” disappeared from the page?**

If not, the visual identity is probably relying on generic AI conventions instead of music, intelligence and the Ensemblis brand.
