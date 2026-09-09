# Ensemblis Marketing Website — Decision Log

This file records accepted product and marketing decisions so future design / implementation work does not accidentally reopen settled questions.

---

## D001 — Homepage purpose

**Decision:** The homepage is not primarily a feature catalog.

It tells the story:

> **What becomes possible when Ensemblis understands my music?**

**Status:** Accepted

---

## D002 — Brand positioning

**Decision:** Primary concept:

> **Your music. Understood.**

Ensemblis is positioned as a reusable music-intelligence layer between creating music and what the artist wants to do with it next.

**Status:** Accepted

---

## D003 — Supporting product model

**Decision:** The four public product pillars are:

1. Understand
2. Refine
3. Mix & Perform
4. Promote

**Status:** Accepted

---

## D004 — Promote importance

**Decision:** `Promote` is a first-class product pillar and must have equal strategic importance in the homepage narrative and navigation.

Promotion is derived from understanding the actual music.

It is not treated as a generic social-copy generator.

**Status:** Accepted

---

## D005 — Promote positioning

**Decision:** Preferred promotion message:

> **Your track already contains the campaign.**

Supporting concept:

> Promotion that starts with the music.

The product should demonstrate that strongest moments, hooks, energy, structure and sonic identity can inform campaign creative and timing.

**Status:** Accepted

---

## D006 — Artist authorship

**Decision:** Ensemblis must communicate that it builds around the artist's own music rather than replacing it.

Key language:

> **Built around your music. Not generated instead of it.**

**Status:** Accepted

---

## D007 — Primary CTA

**Decision:** Primary site-wide CTA:

> **Analyze a track**

`Get Started` is not the primary CTA.

**Status:** Accepted

---

## D008 — Primary marketing conversion

**Decision:** Main marketing KPI:

> **Visitor → Track Upload**

The core funnel should not require pricing-page visitation before product value.

**Status:** Accepted

---

## D009 — Hero experience

**Decision:** The hero uses a live-feeling waveform / music-intelligence visualization rather than a static product screenshot.

The CTA must remain usable immediately, before animation completes.

**Status:** Accepted

---

## D010 — Persistent track narrative

**Decision:** The same musical object / waveform should visually persist across the homepage.

The visitor should feel that one track is being understood, refined, mixed and promoted rather than seeing four disconnected demos.

**Status:** Accepted

---

## D011 — Motion purpose

**Decision:** Motion is explanatory rather than decorative.

Canonical motion vocabulary:

- Scan
- Resolve
- Connect
- Flow
- Extract
- Transform
- Pulse
- Return

**Status:** Accepted

---

## D012 — Visual direction

**Decision:** Direction:

> **Editorial Music Technology**

The brand should feel like a synthesis of contemporary music publishing, premium music hardware, club culture, record artwork and sophisticated creative software.

**Status:** Accepted

---

## D013 — Generic AI visual language

**Decision:** Avoid default AI/SaaS clichés:

- purple-gradient identity
- glowing orbs
- neural-network imagery
- robot imagery
- generic glass-card grids
- crypto/cyberpunk wallpaper
- random particles with no product meaning

**Status:** Accepted

---

## D014 — Audio

**Decision:** Audio is an important part of the marketing experience, but audible autoplay is prohibited.

Examples should be short and purposeful, such as mastering A/B, a DJ transition or a strongest-moment preview.

**Status:** Accepted

---

## D015 — Single active playback

**Decision:** Only one website audio example may be active at a time.

A shared audio coordinator should own playback state.

**Status:** Accepted

---

## D016 — Demo model

**Decision:** The same canonical demo track should persist across:

- Understand
- Refine
- Mix
- Promote

This demonstrates that the same music understanding powers multiple workflows.

**Status:** Accepted

---

## D017 — Demo truth

**Decision:** Marketing demo output should be derived from real Ensemblis product output wherever technically possible.

Preferred sources:

1. stable real API result
2. serialized production-pipeline snapshot
3. deterministic fixture conforming to production domain types

No fabricated product result should be presented as real capability.

**Status:** Accepted

---

## D018 — Product proof

**Decision:** Early-stage credibility should use product proof rather than fabricated social proof.

Prefer:

- real analysis
- actual detected moments
- mastering A/B
- real transition example
- real campaign output

Avoid invented user counts, logos and endorsements.

**Status:** Accepted

---

## D019 — Product truth status

**Decision:** Public capability planning uses:

- `LIVE`
- `BETA`
- `COMING_SOON`
- `VISION`

Only `LIVE` and `BETA` may be presented as immediately usable.

`COMING_SOON` must be explicitly labeled.

`VISION` is not a current feature.

**Status:** Accepted

---

## D020 — Marketing/app visual relationship

**Decision:** The future marketing site and Ensemblis application must feel like related surfaces of one product.

They should share brand primitives such as:

- typography
- colors / semantic tokens
- button language
- icon style
- waveform language
- audio interaction language
- motion vocabulary

Avoid:

```text
beautiful marketing site
        ↓
generic SaaS dashboard
```

**Status:** Accepted

---

## D021 — Existing design-system authority

**Decision:** New marketing implementation should be reconciled with the canonical Ensemblis design system documented in `docs/ensemblis-design-system.md`.

The marketing layer may require additional editorial tokens / compositions, but it should not casually create a conflicting second brand authority.

**Status:** Accepted

---

## D022 — Three.js / WebGL

**Decision:** Do not introduce Three.js / WebGL by default.

Use DOM/SVG/Canvas unless a specific defined experience genuinely justifies additional rendering complexity and bundle/performance cost.

**Status:** Accepted

---

## D023 — Mobile

**Decision:** Mobile receives its own sequential composition.

It is not treated as a miniature desktop layout.

The product pillars remain:

```text
Understand
↓
Refine
↓
Mix & Perform
↓
Promote
```

**Status:** Accepted

---

## D024 — Reduced motion

**Decision:** The full product story must remain understandable with `prefers-reduced-motion`.

Motion can simplify to fades / direct state changes without losing information.

**Status:** Accepted

---

## D025 — Accessibility

**Decision:** Waveforms and other audio visualizations cannot be the only source of important information.

All essential interactions must have keyboard, touch and accessible-text equivalents.

**Status:** Accepted

---

## D026 — Performance

**Decision:** Artistic ambition cannot excuse a slow site.

Initial engineering goals:

- LCP ≤ 2.5s p75
- INP ≤ 200ms
- CLS ≤ 0.1

Heavy audio/video/canvas experiences should progressively load.

**Status:** Accepted

---

## D027 — SEO direction

**Decision:** SEO should build topical authority across:

- music analysis
- mastering
- DJ / mixing
- promotion

Do not compete only for broad `AI music` terms.

**Status:** Accepted

---

## D028 — Free tools

**Decision:** Focused public utilities may become an acquisition engine later.

Examples:

- BPM detector
- key detector
- loudness checker
- song-structure analyzer
- DJ compatibility checker
- strongest-moment finder

Each tool must provide genuine standalone value.

**Status:** Accepted

---

## D029 — Catalog intelligence

**Decision:** Long-term brand architecture can evolve naturally from:

```text
TRACK INTELLIGENCE
       ↓
RELEASE INTELLIGENCE
       ↓
CATALOG INTELLIGENCE
       ↓
ARTIST INTELLIGENCE
```

This is a future-facing product narrative and must not be presented as currently live unless implemented.

**Status:** Accepted

---

## D030 — Current repository ownership

**Decision:** Ensemblis currently lives inside:

```text
yotamon/Atlas-Irwin
```

The future Ensemblis marketing specification therefore belongs in this repository now.

**Status:** Accepted

---

## D031 — Future repository split

**Decision:** Long term, Atlas Irwin's public artist website and Ensemblis are expected to become separate repository/deployment concerns.

Conceptually:

```text
Atlas Irwin repository
└── Atlas artist website

Ensemblis repository
├── Ensemblis marketing website
└── Ensemblis product
```

The exact migration is not part of the current documentation task.

**Status:** Direction accepted; implementation not scheduled

---

## D032 — Future Ensemblis domain

**Decision:** The intended future public product brand will use its own Ensemblis domain.

Expected conceptual model:

```text
ensemblis.com
└── public marketing website

Ensemblis application
└── own product domain/subdomain
```

The exact application URL is not yet locked.

**Status:** Direction accepted; exact routing open

---

## D033 — Marketing site vs Ensemblis Sites

**Decision:** `ensemblis.com` marketing and the `Ensemblis Sites` artist-site product documented in `docs/ensemblis-sites-roadmap.md` are distinct concepts.

- Ensemblis marketing site markets Ensemblis itself.
- Ensemblis Sites powers artists' own websites, release pages, smart links, EPKs and campaign-owned web surfaces.

**Status:** Accepted

---

## D034 — Current implementation rule

**Decision:** Until the future repository split is explicitly planned:

> **Build and document Ensemblis inside `yotamon/Atlas-Irwin`; do not create parallel unsynchronized specifications elsewhere.**

**Status:** Accepted

---

# Open implementation decisions

These are intentionally not locked yet.

## O001 — Exact Ensemblis app URL

Possible future options include:

- `app.ensemblis.com`
- `ensemblis.com/app`
- another explicitly chosen product hostname

The marketing architecture must not prematurely depend on one option.

## O002 — Exact motion library

Select during implementation based on compatibility with the existing application, maintainability, bundle size and performance.

## O003 — Exact waveform renderer

Likely split:

- Canvas for dense animated waveform work
- DOM/SVG for accessible overlays and editorial diagrams

Benchmark before locking.

## O004 — CMS

No CMS is required for v1 unless editorial workflow proves a need.

## O005 — Pricing model

Pricing names, tiers and packaging are not locked by this specification.

## O006 — Exact font family

Typography direction is settled; final font selection is not.

## O007 — Exact accent palette

Base visual direction is settled. Final accent/color tokens should be defined during visual design and reconciled with the existing Ensemblis design system.

## O008 — Exact repository split timing

The split is an accepted future direction but must be treated as its own migration program with deployment, auth, cookies, analytics, redirects and rollback explicitly planned.
