# Ensemblis Marketing — Signature Moments Prototype

**Status:** Internal visual prototype  
**Route:** `/ensemblis-preview`  
**Indexing:** `noindex, nofollow`  
**Branch at creation:** `prototype/ensemblis-marketing-signature-moments`

## Purpose

This prototype exists to validate the visual and interaction language of the future `ensemblis.com` marketing site before building the complete homepage.

It is intentionally isolated from the Atlas Irwin public homepage and does not change `/`.

The prototype focuses on a small number of signature moments that should define the final site's character. If these interactions feel coherent, musical and premium, the rest of the homepage can be built from the same system.

## Product-truth status

All track data shown in this prototype is a **concept fixture**.

It is labeled in the UI and must not be presented as a live Ensemblis analysis result.

The prototype currently demonstrates interaction and visual narrative, not production capability.

No audio is played. The transition example is explicitly marked as a visual prototype.

## Signature moment 01 — Hero scan

### Goal

Immediately communicate:

> Ensemblis listens to music and turns signal into understanding.

### Interaction

The hero contains a persistent waveform for a fictional demo track. A scanning line moves through the track and resolved metadata appears around the signal:

- BPM
- key
- energy
- musical character
- strongest moment

The four product pillars are shown as consequences of the same music understanding:

```text
UNDERSTAND
REFINE
MIX & PERFORM
PROMOTE
```

### Design intent

The hero should feel like a high-end musical instrument beginning to understand a signal, not like a SaaS dashboard loading metrics.

## Signature moment 02 — Semantic waveform

### Goal

Prove the principle:

> One musical object can reveal different kinds of truth.

### Interaction

The visitor switches between:

- `Structure`
- `Energy`
- `Moments`

The waveform remains the same object while its semantic overlay changes.

### Why this matters

This interaction is an antidote to a grid of disconnected analytics cards. It makes the music itself the UI protagonist.

## Signature moment 03 — DJ transition

### Goal

Show that Ensemblis understands relationships between tracks rather than only analyzing tracks individually.

### Visual model

```text
TRACK A
   \
    \  transition intelligence
     \________________
                      \
                       TRACK B
```

The prototype resolves:

- harmonic match
- energy flow
- tempo fit
- suggested transition window
- overall compatibility

### Color semantics

- Signal Lime = Track A / primary musical identity
- Violet = Track B / secondary musical identity
- Mint = resolved relationship / compatibility

These are semantic colors, not decorative gradients.

## Signature moment 04 — Promote extraction

### Goal

Make the differentiation of Ensemblis Promote visually self-evident:

> Promotion starts inside the music.

### Interaction

1. Ensemblis identifies a strongest moment.
2. A 13-second region is visibly selected inside the waveform.
3. The system explains why the moment matters.
4. That musical region becomes a vertical campaign creative.
5. Campaign context appears beside it:
   - use
   - platform
   - mood
   - timing

The asset must look like it was derived from the track, not generated independently beside it.

## Human center — Paper inversion

After the dense dark music-technology interactions, the page changes to a warm paper surface.

Primary statement:

> **You made the music.**

Supporting principle:

> Ensemblis is built around it. Not instead of it.

This interruption is intentional. It restores authorship and human purpose before returning to the final product CTA in the eventual homepage.

## Technical choices

The prototype uses only technologies already available in the repository:

- Next.js
- React
- TypeScript
- Framer Motion
- CSS Modules
- `next/font`

No new package was added.

No Three.js or WebGL is used.

Dense waveform rendering is currently DOM-based because this is a visual concept prototype. Production implementation should benchmark Canvas for dense/high-frequency waveform animation as documented in `implementation-blueprint.md`.

## Typography

The prototype pairs:

- existing Ensemblis / application body language: `Manrope`
- marketing editorial display: `Instrument Serif`

The serif is used selectively for emotional/editorial emphasis and must not replace the application's functional typography.

## Existing brand continuity

The prototype intentionally reuses the current Ensemblis visual DNA:

- `#080B09` Obsidian
- `#F6F8F4` Ink
- `#B7F36A` Signal Lime
- `#8A7CFF` Violet
- `#5CE1C6` Mint

This keeps the future marketing site and Studio recognizably related while allowing the public site to be more editorial and cinematic.

## Responsive behavior

Desktop uses large asymmetric compositions.

Below tablet widths, every signature moment becomes sequential and the track remains visually dominant.

The Promote creative naturally becomes a centered vertical object on mobile.

## Accessibility / reduced motion

The route:

- preserves text explanations for visualized insights
- uses native buttons and anchors
- exposes selected analysis tabs with `role=tab` / `aria-selected`
- respects `prefers-reduced-motion`
- removes nonessential scan/playhead movement when reduced motion is requested

The final implementation still requires full keyboard and screen-reader QA.

## Explicitly out of scope for this prototype

- real track upload
- production audio analysis
- real strongest-moment output
- mastering A/B audio
- audio playback
- real AutoMix rendering
- production campaign generation
- full navigation
- pricing
- complete homepage
- analytics instrumentation
- SEO content pages

These should not be inferred as implemented because the prototype visually references them.

## Prototype acceptance questions

Before promoting these interactions into the real marketing homepage, evaluate:

1. Does the hero communicate music intelligence within five seconds?
2. Does the waveform feel like one persistent musical object rather than a decorative equalizer?
3. Does switching semantic modes make the analysis concept easier to understand?
4. Does the DJ transition feel musical rather than analytical / spreadsheet-like?
5. Is it obvious that the Promote creative came from a moment inside the track?
6. Does the paper inversion feel human and intentional rather than disconnected?
7. Does the site feel like Ensemblis while being significantly more editorial than Studio?
8. Does the experience remain clear on mobile and with reduced motion?

## Next step after validation

Once the signature language is accepted:

```text
signature moments
      ↓
shared marketing primitives
      ↓
full homepage composition
      ↓
real demo-track fixture from production output
      ↓
audio proof
      ↓
product pages
```

The production homepage should reuse these primitives rather than rebuilding the effects independently section by section.
