<div align="center">

# Ensemblis

**Music-aware artist growth, creation and management platform.**

> The platform that understands the song before it markets it.

[![Public reference artist](https://img.shields.io/badge/Reference%20artist-Atlas%20Irwin-0d9488?style=for-the-badge&logo=vercel&logoColor=white)](https://atlasirwin.com)
[![CI](https://img.shields.io/github/actions/workflow/status/yotamon/Atlas-Irwin/ci.yml?branch=main&style=for-the-badge&label=CI)](https://github.com/yotamon/Atlas-Irwin/actions)
[![Next.js](https://img.shields.io/badge/Next.js-16-black?style=for-the-badge&logo=nextdotjs&logoColor=white)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/License-MIT-yellow?style=for-the-badge)](LICENSE)

[Atlas Irwin public site](https://atlasirwin.com) · [Product roadmap](docs/ensemblis-product-roadmap.md) · [Multi-artist architecture](docs/ensemblis-multi-artist-architecture.md) · [Security](SECURITY.md)

</div>

---

## Product identity

This repository currently hosts two intentionally separate experiences:

| Surface | Identity | Purpose |
| --- | --- | --- |
| `/studio` | **Ensemblis** | Multi-artist management, music intelligence, creative production, growth, audience and operational tooling |
| `/` | **Atlas Irwin** | Public artist website for one artist managed inside Ensemblis |

**Atlas Irwin is not the product name.** It is the production reference artist and a normal artist record inside an Ensemblis workspace. Generic application surfaces must never assume that the active artist is Atlas Irwin.

The product hierarchy is:

```text
User / Profile
      ↓
Workspace
      ↓
Active Artist
      ↓
Music
      ↓
Track + Lyrics + Stem Intelligence
      ↓
Moments
      ↓
Creative + Campaign Actions
      ↓
Publishing / Growth / Audience
      ↓
Outcomes
      ↓
Artist Memory + Better Decisions
```

The core loop is **Music → Moments → Actions → Outcomes → Memory**.

## What Ensemblis does

Ensemblis starts from the artist's actual music rather than an empty AI prompt. It understands recordings, lyrics, stems, structure and artist identity, then turns that evidence into creative and growth actions.

Primary product surfaces:

| Surface | Job |
| --- | --- |
| **Today** | Next move, needs-you queue, active work and operational priorities |
| **Music** | Catalog, unreleased tracks, audio analysis, Lyrics Intelligence, Stem Intelligence and Moments |
| **Releases** | Lifecycle-aware release workspace from preparation through sustained growth |
| **Create** | Music-aware creative generation, production and Video Director workflows |
| **Growth** | Strategy, campaign planning, experiments and evidence-backed next actions |
| **Audience** | Social interactions, replies and audience workflows |
| **Library** | Reusable creative/media assets and lineage |
| **Connections** | Music data, social channels and distribution integrations |
| **Settings** | Artist brand memory, AI policy, autonomy, connections and advanced maintenance |

Specialist/internal tools remain available as advanced surfaces without defining the primary navigation.

## Multi-artist model

Ensemblis separates authentication from artist ownership:

```text
profile ≠ workspace ≠ artist
```

A user receives access through `workspace_memberships`. The active artist is resolved server-side and validated against that membership. The UI can switch artists and preserves the active artist through Ensemblis navigation and deep links.

Important invariants:

- client-provided artist IDs are never trusted without membership validation;
- artist-scoped data uses explicit `artist_id` where the domain has migrated;
- durable jobs carry artist lineage rather than inferring a current interactive user;
- Atlas legacy `owner_id` fields remain only as compatibility scope while domains migrate;
- a second artist must not inherit Atlas copy, brand rules, connections or creative assumptions.

Deep dive: [`docs/ensemblis-multi-artist-architecture.md`](docs/ensemblis-multi-artist-architecture.md).

## Music-aware intelligence

The product already contains production-grade foundations for:

- Track Intelligence and section/hook analysis;
- Lyrics Intelligence with timing and lyric moments;
- Stem Intelligence and Audio Scenes;
- cross-modal creative intelligence;
- durable Moments linking useful musical windows to downstream work;
- campaign planning and lifecycle automation;
- music-aware social creative generation and deterministic finishing;
- approval-gated publishing and platform integrations;
- Growth OS for released and unreleased music;
- analytics, learnings and audience interactions;
- spend envelopes and approval-gated external effects.

Artist identity remains artist data. Ensemblis supplies the operating frame and intelligence, not a visual style that overwrites the artist.

## Public Atlas Irwin site

The root page remains the public Atlas Irwin artist experience. It keeps its own metadata, structured data, visual identity, catalog player, platform links, contact and newsletter flows.

This separation is deliberate:

```text
Ensemblis product chrome          Atlas Irwin artist identity
/studio                           /
Ensemblis metadata                Atlas SEO + MusicGroup JSON-LD
Ensemblis design tokens           Atlas public visual language
Active-artist aware               Atlas-specific public catalog
```

Generated artist media should use the active artist's brand rules, not Ensemblis branding, unless the output is explicitly Ensemblis marketing material.

## Architecture

```text
Browser
├── /studio  → Ensemblis product shell
│              ├── ArtistContext / workspace membership validation
│              ├── Today / Music / Releases / Create / Growth
│              ├── Audience / Library / Connections / Settings
│              ├── AI Control Plane + specialist generation providers
│              └── Supabase Auth / Postgres / Storage
│
└── /        → Atlas Irwin public artist site
               ├── public catalog
               ├── player + listening platforms
               ├── contact / newsletter
               └── tagged catalog cache revalidation

Workers / cron / automation
└── explicit artist lineage → Supabase → Ensemblis workflows
```

| Layer | Stack |
| --- | --- |
| App | Next.js 16 App Router · React 19 · TypeScript · Tailwind CSS 4 · Framer Motion |
| Data | Supabase Auth · PostgreSQL + RLS · Storage · typed database contracts |
| AI | Vercel AI Gateway control plane + direct specialist image/video/music providers where appropriate |
| Ops | Vercel · GitHub Actions · deployment-native media worker/sandbox orchestration |
| Integrations | Spotify · SoundCloud · Instagram · TikTok · YouTube · distribution provider layer |

## Quick start

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open `http://localhost:3000/studio` for Ensemblis. Local Studio routes can use the documented development bypass when not running in production.

| Command | Purpose |
| --- | --- |
| `npm run dev` | Local development |
| `npm run build` | Production build |
| `npm run start` | Serve production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript check |
| `npm run test:studio` | Product, workflow, intelligence, artist-scope and distribution contracts |
| `npm run env:restore` | Restore permitted Vercel environment values locally |
| `npm run studio:import` | Import legacy release manifests |

## Project layout

```text
app/              Public Atlas page, APIs and Ensemblis /studio routes
components/       Public artist UI + Ensemblis product components
lib/              Artist context, AI, intelligence, marketing, integrations and data services
features/         Feature-oriented product modules
public/           Static assets, artist assets and Ensemblis product mark
supabase/         Database migrations, functions, policies and tests
scripts/          Import, seed and maintenance tooling
tests/            Product and behavior contracts
docs/             Ensemblis architecture/product docs plus specialist technical docs
```

## Environment and compatibility

Copy `.env.example` to `.env.local`. Secrets remain server-only.

Ensemblis is migrating old product-level `ATLAS_*` environment names to `ENSEMBLIS_*`. New code should prefer `ENSEMBLIS_*`. Where production still depends on a legacy variable, the code reads the Ensemblis name first and falls back to its documented legacy alias so deployment does not require a risky flag-day migration.

Core variables include:

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
STUDIO_ADMIN_EMAILS=artist@example.com
AI_GATEWAY_API_KEY=
ENSEMBLIS_AI_GATEWAY_PROVIDER_SORT=cost
ENSEMBLIS_AI_GATEWAY_TIMEOUT_MS=90000
ENSEMBLIS_MARKETING_MODEL=openai/gpt-5.6-sol
```

See [`.env.example`](.env.example) for provider-specific configuration.

## Security

Production Ensemblis routes remain authenticated, private and `noindex`. Supabase RLS and application authorization enforce account/workspace/artist boundaries. Service-role workflows must validate artist lineage explicitly because service-role access bypasses RLS.

The public Atlas site remains independently cacheable and indexable.

See [`SECURITY.md`](SECURITY.md) for vulnerability reporting.

## Product documentation

- [`docs/ensemblis-product-roadmap.md`](docs/ensemblis-product-roadmap.md) — product direction and execution order
- [`docs/ensemblis-multi-artist-architecture.md`](docs/ensemblis-multi-artist-architecture.md) — user/workspace/artist separation
- [`docs/ensemblis-ownership-migration-matrix.md`](docs/ensemblis-ownership-migration-matrix.md) — ownership migration plan
- [`docs/ai-control-plane.md`](docs/ai-control-plane.md) — AI routing, quality, budget and learning
- [`docs/music-intelligence.md`](docs/music-intelligence.md) — recording intelligence
- [`docs/lyrics-intelligence.md`](docs/lyrics-intelligence.md) — lyric context and timing
- [`docs/stem-intelligence.md`](docs/stem-intelligence.md) — stem analysis and Audio Scenes
- [`docs/video-director.md`](docs/video-director.md) — music-aware video workflow

## License

Application source is MIT — see [`LICENSE`](LICENSE). Fonts under `public/fonts/` retain their own licenses.
