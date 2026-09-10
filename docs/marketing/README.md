# Ensemblis Marketing Website — Source of Truth

**Status:** Pre-development specification  
**Target domain:** `ensemblis.com`  
**Current repository:** `yotamon/Atlas-Irwin`  
**Primary CTA:** `Analyze a track`  
**Primary conversion:** Visitor → Track Upload  
**Brand thesis:** `Your music. Understood.`

This folder is the canonical specification for the future Ensemblis marketing website.

## North Star

> **Ensemblis understands your music, then helps you take it further.**

Ensemblis is not positioned as a collection of AI tools. It is one music-intelligence system that understands a track and reuses that understanding across four connected product pillars:

1. **Understand**
2. **Refine**
3. **Mix & Perform**
4. **Promote**

```text
                         YOUR MUSIC
                              │
                              ▼
                    MUSIC INTELLIGENCE
                              │
       ┌──────────────────────┼──────────────────────┐
       │                      │                      │
       ▼                      ▼                      ▼
   UNDERSTAND               REFINE            MIX & PERFORM
       │                      │                      │
       └──────────────────────┼──────────────────────┘
                              │
                              ▼
                           PROMOTE
                              │
                              ▼
                    YOUR MUSIC, FURTHER.
```

## Core positioning

### Primary headline

> **Your music. Understood.**

### Supporting line

> **Understand it. Refine it. Mix it. Promote it.**

### Long-form positioning

> Ensemblis understands what is happening inside your music, then turns that understanding into better analysis, stronger masters, smarter mixes, more informed performance workflows and promotion built around the actual character of the track.

## What Ensemblis is

Ensemblis is the intelligence layer between **making music** and **everything the artist wants to do with it next**.

The system starts with the artist's own audio. It listens, analyzes and creates reusable musical context that can power multiple workflows.

## What Ensemblis is not

Ensemblis is not:

- a text-to-song generator
- a generic AI assistant
- a generic social-post generator
- only a mastering service
- only DJ software
- only an analytics dashboard
- only a distributor
- a random bundle of unrelated AI features

## Authorship principle

> **Built around your music. Not generated instead of it.**

Supporting statement:

> You made the music. Ensemblis helps you understand what you made, refine it, connect it, perform with it and take it further.

The website should never imply that an artist's authorship is a temporary input to be replaced by AI output.

## Primary audience

### Core persona: independent artist / producer

Typical characteristics:

- creates and releases original music
- may also DJ or perform
- works without a large label team
- cares about sonic quality and release strategy
- currently jumps between disconnected tools
- wants useful intelligence instead of vague AI output
- wants to understand decisions, not only receive black-box results

## Secondary audiences

| Audience | Priority | Strongest value |
|---|---:|---|
| Independent artist / producer | 1 | All four pillars |
| Artist + DJ | 1 | Analysis, mix, performance, promotion |
| Electronic producer | 1 | Analysis, mastering, DJ workflow |
| DJ with original catalog | 2 | Compatibility, set building, AutoMix |
| Producer | 2 | Analysis and mastering |
| Artist manager | 3 | Release and promotion workflows |
| Small label | 3 | Catalog intelligence |
| Pure DJ | 3 | Mix & Perform |

## Four product pillars

### Understand

**Hear what your track is telling you.**

Possible capabilities:

- BPM
- key
- structure
- sections
- energy
- dynamics
- loudness
- sonic profile
- strongest moments
- transition moments
- compatibility
- technical warnings

### Refine

**Make it ready to leave the studio.**

Possible capabilities:

- intelligent mastering
- loudness optimization
- tonal balance
- dynamics
- stereo image
- master comparison
- album consistency
- reference comparison
- release-readiness analysis

### Mix & Perform

**Turn tracks into journeys.**

Possible capabilities:

- automatic DJ mixes
- transition intelligence
- harmonic compatibility
- energy-aware sequencing
- cue / transition suggestions
- promo mixes
- catalog set building
- performance preparation

### Promote

**Your track already contains the campaign.**

Promotion starts from musical understanding.

Possible music-derived inputs:

- strongest hook
- emotional peaks
- drops
- structure
- energy arc
- genre context
- sonic identity
- visual character
- pacing
- vocal moments

Possible outputs:

- clip suggestions
- teaser moments
- Reel / TikTok concepts
- Spotify Canvas concepts
- caption direction
- campaign narrative
- visual direction
- release timeline
- platform-specific recommendations

The differentiation is not "AI writes captions."

It is:

> Ensemblis knows which part of the music deserves attention and uses the actual track to inform how it should be presented.

Example:

> The strongest emotional shift begins at 01:12. Use the eight seconds before it to build tension, then reveal the drop. The transition works well as a vertical teaser because the musical payoff is immediate.

## Future catalog intelligence

The long-term narrative can expand naturally:

```text
TRACK INTELLIGENCE
       ↓
RELEASE INTELLIGENCE
       ↓
CATALOG INTELLIGENCE
       ↓
ARTIST INTELLIGENCE
```

Possible future value:

- recurring sonic traits
- artist identity
- relationships between releases
- album consistency
- compatible catalog tracks
- recurring emotional themes
- promotion patterns
- signature sound

Future message:

> **The more music you add, the more Ensemblis understands your sound.**

## Brand voice

Ensemblis speaks:

- confidently
- briefly
- intelligently
- musically
- concretely
- without hype

Avoid:

- Revolutionary
- Game-changing
- Supercharge your creativity
- Unlock the power of AI
- Cutting-edge AI ecosystem
- World's most advanced

Prefer proof:

- `We found 6 high-energy moments.`
- `This transition keeps the tracks harmonically compatible.`
- `The chorus is 2.8 LU louder than the verse.`
- `This 11-second section contains the strongest energy change.`

## Primary CTA

Site-wide:

> **Analyze a track**

Avoid `Get Started` as the primary CTA.

Secondary contextual CTAs may include:

- See how it works
- Explore analysis
- Hear a master
- Hear the transition
- See promotion ideas

## Product truth rule

Every public capability must have one internal status:

- `LIVE`
- `BETA`
- `COMING_SOON`
- `VISION`

Only `LIVE` and `BETA` may be presented as immediately usable functionality. `COMING_SOON` must be labeled explicitly. `VISION` must not be marketed as a currently available feature.

## Visual direction

The direction is **Editorial Music Technology**: a blend of high-end music hardware, contemporary music publishing, club culture, record artwork and sophisticated software.

The detailed visual authority for the future marketing site is `visual-design-system.md`, with the homepage-specific composition in `homepage-visual-spec.md`.

Current design direction intentionally keeps the existing Ensemblis Studio DNA:

```text
Obsidian       #080B09
Paper          #F6F8F4
Signal Lime    #B7F36A
Violet         #8A7CFF
Mint           #5CE1C6
```

`Manrope` remains the product/UI typeface. The v1 marketing direction pairs it selectively with `Instrument Serif` for large editorial statements, subject to final implementation/prototype validation.

Avoid generic AI visual clichés:

- purple gradients
- glowing orbs
- neural networks
- robots
- generic glassmorphism
- cyberpunk wallpaper
- random floating cards

Prefer:

- almost-black / warm charcoal foundations
- deliberate off-white typography
- strong editorial scale
- waveforms and spectral forms
- asymmetric compositions
- negative space
- audio-derived accent moments
- premium, tactile, musical motion

## Repository and domain topology

**Current state (September 2026):** Ensemblis is implemented inside the `yotamon/Atlas-Irwin` repository. The repository currently contains both the public Atlas Irwin artist website and the internal Ensemblis product.

```text
Today
Atlas-Irwin repository
├── Atlas Irwin public site
└── Ensemblis internal product
```

The intended future architecture is to separate these concerns:

```text
Future
Atlas Irwin repository / site
└── atlasirwin.com

Ensemblis repository / product
├── ensemblis.com marketing site
└── Ensemblis app on its own product domain/subdomain
```

The exact future repository split and product-domain routing are not yet implementation commitments. Until the split happens, this marketing specification lives canonically in `Atlas-Irwin/docs/marketing/`.

This marketing-site specification is distinct from `docs/ensemblis-sites-roadmap.md`, which describes Ensemblis' **artist-owned Sites product**. The future `ensemblis.com` marketing site promotes Ensemblis itself; Ensemblis Sites is a product capability for artists' own websites, release pages, smart links and related owned-web surfaces.

## Documents in this folder

Read in this order:

1. `README.md` — positioning, audience, brand thesis and product pillars.
2. `homepage-wireframe.md` — exact homepage story, sections, copy and scroll narrative.
3. `visual-design-system.md` — canonical marketing visual language: typography, palette, grid, surfaces, waveform, data and motion aesthetics.
4. `homepage-visual-spec.md` — concrete homepage composition, dimensions, section geometry, visual transformations and responsive translation.
5. `implementation-blueprint.md` — motion/audio architecture, responsive behavior, accessibility, performance, analytics, SEO and technical implementation guidance.
6. `decision-log.md` — accepted decisions and intentionally open implementation questions.

## Non-negotiable design principles

- No generic "AI SaaS" visual language.
- Motion explains the product rather than decorating it.
- Audio is part of the website experience, but never autoplays with sound.
- The same music-understanding layer visually connects analysis, mastering, mixing and promotion.
- The marketing site and app must share brand/design primitives.
- `Promote` is a first-class product pillar, not a side feature.
- The website must remain usable with reduced motion and without audio.
- Product proof is preferred over hype.

## Quality gate

The homepage is not ready until it passes four tests:

1. **5-second test:** a visitor understands this is a music product.
2. **30-second scroll test:** a visitor understands why analysis connects to mastering, mixing and promotion.
3. **No-copy test:** motion and UI alone still communicate the central product story.
4. **AI-skeptic test:** a musician feels that Ensemblis respects their authorship and builds around their work rather than replacing it.
