# Ensemblis Sites — Product & Architecture Roadmap

**Status:** Proposed / implementation-ready plan  
**Parent tracking:** #90  
**Product:** Ensemblis  
**Reference production site:** Atlas Irwin (`atlasirwin.com`)  
**Current hosting decision:** Keep Ensemblis at `atlasirwin.com/studio` for now. Moving the Ensemblis product to its own domain is explicitly out of scope for this program.

## 1. Executive decision

Ensemblis Sites will become the owned-web layer of Ensemblis.

The product model is:

```text
Ensemblis
└─ Workspace
   └─ Artist
      ├─ Music / Releases / Moments / Brand / Campaigns / Audience
      └─ Sites
         ├─ Primary artist website
         ├─ Release / campaign landing pages
         ├─ Smart links / pre-save surfaces
         ├─ EPK / press pages
         └─ Custom domain(s)
```

Atlas Irwin is the first production implementation of this system. The current `atlasirwin.com` public site must remain live and visually stable throughout the migration, but the code should gradually stop treating Atlas as the permanent public-site architecture.

The end state is:

> **AtlasIrwin.com is an artist website built and operated by Ensemblis, using a reusable Ensemblis site template and Atlas-specific artist data.**

This is not a generic website builder. Ensemblis Sites should win by already understanding the artist, music, releases, brand, campaign state and audience context.

## 2. Strategic position

Do not build Wix, Squarespace or Webflow inside Ensemblis.

The core differentiation is:

```text
Artist + Music + Releases + Moments + Campaigns + Audience
                         ↓
                       Site
                         ↓
                Visits / conversions
                         ↓
                 Outcomes / learning
```

The system should reduce website maintenance instead of giving the artist another CMS to operate manually.

Examples:

- a new release already exists in Ensemblis, so the site can prepare the release page automatically;
- the artist's platform links are already connected, so listening buttons should not be re-entered manually;
- the campaign knows which Moment is currently strongest, so Ensemblis can propose a homepage creative update;
- the release lifecycle changes from pre-release to live, so the site can prepare a transition from `Pre-save` to `Listen now`;
- campaign attribution can continue through the artist's own web property instead of stopping at a social platform click.

## 3. Product principles

### 3.1 Artist identity is data, not template code

Templates define layout, motion, composition and supported sections. Artist name, imagery, sound, copy, links, releases, colors and creative rules belong to artist/site data.

Never solve a generic need with `if (artist === Atlas)`.

### 3.2 Canonical Ensemblis data remains canonical

Do not duplicate releases, tracks, platform links or artist identity into a disconnected website CMS.

Site content uses explicit bindings to canonical Ensemblis entities and stores overrides only where the website genuinely needs custom presentation.

### 3.3 Publish snapshots must be reversible

A website edit should create a draft version. Publishing atomically selects one validated version. Rollback should be a version pointer change, not an emergency code deployment.

### 3.4 Safe automation prepares before it publishes

Ensemblis may autonomously prepare drafts for reversible, zero-cost changes. Public publishing remains approval-gated by default and may only become automatic under an explicit Site autonomy contract.

### 3.5 Preserve Atlas production while extracting the platform

No big-bang rewrite. The current public Atlas site stays usable during every migration stage.

### 3.6 Owned web is one surface, not many disconnected mini-products

Artist website, release landing pages, smart links, pre-save pages, EPKs and campaign pages should share the same site runtime, domain model, templates, analytics and publishing infrastructure.

## 4. Current state

Today the repository has two experiences in one Next.js application:

```text
/         -> hardcoded Atlas Irwin public site
/studio   -> Ensemblis product
```

The public root currently contains Atlas-specific metadata, JSON-LD, page composition, social/profile links and visual components. This is valid production code, but it is not yet a reusable artist-site platform.

Important current constraint:

```text
atlasirwin.com/         must continue serving Atlas
atlasirwin.com/studio   must continue serving Ensemblis
```

The Sites architecture must support this coexistence cleanly.

## 5. Target public runtime

The target request flow is:

```text
Incoming request
      ↓
Trusted hostname resolver
      ↓
site_domain -> artist_site -> artist/workspace
      ↓
Published site version
      ↓
Template renderer
      ↓
Canonical artist/release data + explicit site overrides
      ↓
Public page
```

For the current shared Atlas domain:

```text
atlasirwin.com/studio/*
    -> Ensemblis product routes, never tenant-site rewritten

atlasirwin.com/*
    -> Atlas artist_site
    -> published site version
    -> reusable template runtime
```

Future artist domains use the same runtime:

```text
artist-a.com/* -> Artist A site
artist-b.com/* -> Artist B site
```

The future location of the Ensemblis app itself (`app.ensemblis.com`, for example) is independent from this data model and can change later without another Sites migration.

## 6. Runtime and hostname routing

Vercel's current multi-tenant guidance supports hostname-based tenant resolution in Next.js through `proxy.ts`, with custom domains assigned to the Vercel project and a fast hostname -> tenant mapping.

Ensemblis should follow that architecture without coupling the domain model permanently to one hosting provider.

### 6.1 Proposed request boundary

`proxy.ts` should eventually:

1. read and normalize the request hostname;
2. bypass Ensemblis product/system routes such as `/studio`, Next assets and explicitly global APIs;
3. remove any inbound internal tenant/site headers so clients cannot spoof them;
4. resolve the hostname through a trusted `SiteHostResolver`;
5. fail closed for unknown or inactive domains;
6. set server-owned internal site context;
7. rewrite public traffic to an internal Sites runtime route.

Conceptually:

```text
artist-domain.com/about
      ↓ proxy
/__sites/{siteId}/about
```

The browser keeps the artist's real domain in the address bar.

### 6.2 Host resolver

Define an abstraction such as:

```ts
interface SiteHostResolver {
  resolve(hostname: string): Promise<{
    siteId: string;
    artistId: string;
    workspaceId: string;
    domainId: string;
  } | null>;
}
```

Production should use a low-latency hostname map suitable for proxy execution. A Vercel-backed implementation may use the platform's multi-tenant/global configuration facilities, while server-side validation remains backed by canonical database records.

Do not make correctness depend solely on a cache. Cache/domain-map writes must follow successful canonical database changes, and server rendering must be able to reject stale or inconsistent mappings.

### 6.3 Domain provider abstraction

Define domain operations behind a provider contract rather than calling Vercel APIs throughout product code:

```ts
interface SiteDomainProvider {
  attachDomain(hostname: string): Promise<ProviderDomainState>;
  inspectDomain(hostname: string): Promise<ProviderDomainState>;
  detachDomain(hostname: string): Promise<void>;
}
```

The first adapter can be Vercel. The Ensemblis domain schema remains provider-neutral.

## 7. Proposed data model

Do not create a giant CMS schema before the runtime contract is proven.

The recommended first model is versioned and manifest-driven.

### 7.1 `artist_sites`

Represents an owned web property for an artist.

Suggested fields:

- `id uuid pk`
- `artist_id uuid not null -> artists.id`
- `kind text` (`primary` initially; reserve `microsite` for later)
- `name text`
- `slug text`
- `status text` (`draft`, `active`, `paused`, `archived`)
- `template_key text not null`
- `published_version_id uuid nullable`
- `created_at`, `updated_at`

Initial invariant: one active `primary` site per artist.

### 7.2 `site_versions`

Immutable or append-oriented versions of site presentation state.

Suggested fields:

- `id uuid pk`
- `site_id uuid not null -> artist_sites.id`
- `version integer`
- `template_key text not null`
- `template_version integer not null`
- `manifest jsonb not null`
- `created_by uuid -> profiles.id`
- `created_at`
- `published_at nullable`
- `change_reason text nullable`
- `source text` (`manual`, `migration`, `automation`, `ai_proposal`)

`artist_sites.published_version_id` selects the public version atomically.

### 7.3 `site_domains`

Suggested fields:

- `id uuid pk`
- `site_id uuid not null -> artist_sites.id`
- `hostname citext/text normalized not null unique`
- `kind text` (`custom`, future `managed`)
- `status text` (`pending`, `verifying`, `active`, `error`, `detached`)
- `is_primary boolean`
- `provider text nullable`
- `provider_binding_id text nullable`
- `verification_state jsonb` containing non-secret provider/DNS state only
- `verified_at nullable`
- `last_checked_at nullable`
- timestamps

Requirements:

- a hostname belongs to only one active site;
- exactly one primary active domain per site when public;
- hostname normalization handles case, trailing dot and `www` policy consistently;
- provider secrets never live in this table.

### 7.4 Analytics / events

Do not commit prematurely to storing high-volume raw traffic in the primary transactional database.

Define a stable event contract first:

```text
site_view
site_cta_click
platform_click
newsletter_submit
release_play_intent
campaign_conversion
```

Every event should be able to carry, where known:

- `site_id`
- `artist_id`
- `domain_id`
- `site_version_id`
- page/section identity
- release/track/content/campaign/Moment lineage
- referrer / campaign attribution
- consent-safe anonymous visitor/session identity

Storage/analytics provider can evolve behind this contract.

## 8. Site manifest model

A `site_version.manifest` describes site structure, presentation and bindings. It is not a duplicate artist database.

Conceptual example:

```json
{
  "theme": {
    "mode": "artist",
    "density": "editorial"
  },
  "pages": [
    {
      "path": "/",
      "sections": [
        {
          "type": "hero",
          "binding": { "mode": "pinned", "releaseId": "..." }
        },
        {
          "type": "discography",
          "binding": { "mode": "live_query", "source": "public_releases" }
        },
        {
          "type": "about",
          "binding": { "mode": "snapshot", "copy": "..." }
        }
      ]
    }
  ]
}
```

### 8.1 Binding modes

Use three explicit binding semantics:

#### `pinned`
References a specific canonical entity ID. Best for hero/featured-release decisions that should not silently change.

#### `live_query`
Reads safe public canonical data at render time. Best for discography, current platform links or other collections that should stay synchronized.

#### `snapshot`
Published copy/media/config deliberately stored with the site version. Best for website-specific editorial copy and manual overrides.

This distinction prevents accidental website drift while still eliminating unnecessary duplication.

## 9. Template architecture

Start with code-defined templates, not a database-driven template marketplace.

A template definition should expose something conceptually like:

```ts
type SiteTemplateDefinition = {
  key: string;
  version: number;
  displayName: string;
  supportedSections: SiteSectionType[];
  manifestSchema: unknown;
  render: SiteTemplateRenderer;
  migrateManifest?: (fromVersion: number, manifest: unknown) => unknown;
};
```

### 9.1 First template: Atlas-derived editorial template

The current Atlas public site becomes the first production template.

Use a product-neutral internal key, for example:

`editorial-retrofuture`

Do not name the reusable template `Atlas Irwin` in user-facing template selection.

The extraction goal is visual parity, not redesign.

The template may contain:

- layout rules;
- typography system;
- animation/motion patterns;
- component composition;
- supported hero/release/about/contact/newsletter sections.

It must not contain:

- `Atlas Irwin` strings;
- Atlas profile URLs;
- Atlas release IDs;
- Atlas-specific structured data;
- Atlas-specific SEO description;
- assumptions that there is only one artist.

### 9.2 Template versioning

Published site versions pin a template version.

A template code update that changes public output materially must not silently mutate every published artist site. Upgrades should generate a previewable draft/migration and then publish explicitly.

## 10. Initial section library

The first section set should cover real artist needs rather than generic layout primitives.

### Required for Atlas parity

- navigation;
- hero / artist identity;
- featured release;
- discography / releases;
- listening platforms;
- about / bio;
- contact;
- newsletter signup;
- footer / social links.

### Next owned-growth sections

- video / featured visual;
- campaign CTA/banner;
- pre-save / release countdown;
- smart-link destinations;
- press quotes;
- EPK facts/downloads;
- gallery;
- tour/event list when a canonical event source exists;
- custom editorial text.

Avoid low-level arbitrary grid/HTML blocks until real use cases prove they are necessary.

## 11. Studio product surface

Add **Sites** as a first-class Ensemblis surface only after the runtime and artist isolation are safe enough to expose it.

Target navigation eventually includes:

```text
Today
Music
Releases
Create
Growth
Audience
Sites
Library
Connections
Settings
```

### 11.1 Sites overview

For each artist:

- site status;
- primary domain;
- active template;
- published version;
- draft changes;
- latest site performance summary;
- primary actions: `Edit`, `Preview`, `Publish`, `Domains`, `Analytics`.

### 11.2 Editor v1

Do not begin with freeform canvas editing.

The first editor is structured:

- reorder supported sections;
- enable/disable sections;
- choose canonical bindings;
- edit site-specific copy overrides;
- choose supported visual options exposed by the template;
- preview desktop/mobile;
- create draft;
- publish/rollback.

### 11.3 Template selection

Artists can preview templates using their real artist data before applying one.

Changing templates creates a draft and never changes production immediately.

## 12. Release and lifecycle integration

Sites should become a downstream action surface of Release and Growth, not an isolated CMS.

Examples:

### Before release

Ensemblis can prepare:

- homepage announcement;
- release landing page;
- countdown;
- pre-save CTA;
- campaign-specific page.

### Release day

Ensemblis can prepare a draft transition:

- `Pre-save` -> `Listen now`;
- update hero binding;
- promote release in discography;
- change campaign CTA;
- update structured metadata.

### Sustained growth

Ensemblis can propose:

- a stronger homepage Moment/creative;
- campaign landing-page variants;
- resurfacing a catalog release;
- an EPK or press page when outreach begins.

Default behavior is **prepare**, not silently publish.

## 13. Relationship to Smart Links / Pre-save (#52)

Do not build a separate unrelated renderer for #52.

The Sites runtime should provide the public rendering, domain, page-version and analytics foundation for smart links, pre-save and campaign landing pages.

#52 remains responsible for conversion semantics and attribution, while #90 provides the owned-web runtime.

This prevents two competing public web stacks inside Ensemblis.

## 14. SEO and public metadata

Each published site/domain needs domain-aware metadata.

Requirements:

- canonical URL uses the site's primary public domain;
- per-site Open Graph/Twitter metadata;
- artist-specific favicon/app icons where supported;
- `WebSite` and `MusicGroup` structured data generated from canonical artist records;
- `MusicAlbum` / release structured data generated from canonical public catalog;
- sitemap generated for the site's published routes;
- robots behavior respects preview vs production;
- redirects survive page slug changes where feasible;
- alternate `www`/apex domains resolve to one canonical host.

Preview URLs must be `noindex` and must never advertise themselves as canonical.

## 15. Custom domain flow

The artist experience should be guided and self-diagnosing.

Target flow:

1. artist enters domain;
2. normalize and validate hostname;
3. create pending `site_domains` record;
4. attach through `SiteDomainProvider`;
5. display required DNS records from provider state;
6. verify ownership/configuration;
7. activate domain only after provider and canonical DB state agree;
8. update fast hostname map;
9. issue/confirm TLS through hosting provider;
10. optionally set as primary domain.

Domain removal must remove/disable the routing map before or atomically with provider detachment so a stale hostname cannot route to the wrong artist.

## 16. Security and multi-artist isolation

Sites inherits the Ensemblis ownership hierarchy:

```text
profile != workspace != artist != site
```

Required controls:

- all Studio site mutations validate artist/workspace membership;
- client-submitted `site_id`, `artist_id` and domain state are never trusted by themselves;
- host -> site resolution is server-owned;
- inbound internal tenant headers are stripped and recreated by trusted routing code;
- unpublished versions require authenticated preview authorization or a scoped expiring preview token;
- draft content is never returned from normal public site queries;
- domain ownership must be verified before activation;
- unknown hosts fail closed;
- a site may only reference canonical entities belonging to the same artist;
- cross-artist bindings are integrity errors, not fallback opportunities;
- arbitrary user JavaScript is not supported in the initial system;
- contact/newsletter endpoints retain spam/abuse protections and site/artist lineage.

## 17. Cache and revalidation model

Public artist sites should be fast and cache-friendly, but cache correctness must preserve artist isolation.

Use tags/keys that include at minimum:

- `site:{siteId}`
- `site-version:{siteVersionId}`
- `artist:{artistId}`
- relevant release/catalog identifiers

Publishing a site invalidates site/version caches. Publishing/updating canonical release data invalidates only pages with live bindings that depend on that data.

Never use one global public-catalog cache for all artists.

## 18. Atlas Irwin migration plan

Atlas is the migration proof, not a permanent special case.

### A. Capture production baseline

Before cutover record:

- visual screenshots at representative viewport sizes;
- current metadata/structured data;
- sitemap/robots behavior;
- public catalog/release behavior;
- navigation/hash behavior;
- platform/contact/newsletter flows;
- performance baseline where practical.

### B. Create Atlas site records

Map the existing Atlas `artist_id` to:

- one `artist_sites` primary record;
- one active `site_domains` record for `atlasirwin.com`;
- one migration-created `site_versions` manifest;
- the Atlas-derived `editorial-retrofuture` template.

### C. Extract hardcoded artist data

Move hardcoded public-site assumptions into canonical artist/site data or manifest bindings:

- site title/description;
- social/platform links;
- structured data identity;
- cover/hero assets;
- release bindings;
- bio/contact copy where appropriate.

### D. Extract reusable renderer

Current Atlas components become template/runtime components receiving structured props instead of importing Atlas identity directly.

### E. Cut root rendering to Sites runtime

`atlasirwin.com/` begins rendering the Atlas published site version through the generic Sites runtime.

`/studio` remains Ensemblis and must not be rewritten by site-domain routing.

### F. Prove parity

Required before deleting legacy root implementation:

- visual parity accepted;
- metadata/JSON-LD parity or intentional improvement;
- no broken release/player/platform/newsletter/contact behavior;
- no SEO canonical regressions;
- no Ensemblis product chrome on the public artist site;
- no Atlas identity in generic site runtime/template contracts.

### G. Second-artist proof

Create a non-Atlas test artist and render the same template with different identity/content in an authenticated preview route.

This is mandatory proof that extraction succeeded.

## 19. Automation and AI editing

AI is an assistant to the structured site system, not the site runtime itself.

Good future actions:

- draft a release landing page from release + Artist Memory;
- propose homepage copy based on a new campaign goal;
- recommend a stronger featured Moment based on measured performance;
- prepare SEO copy using actual artist/release context;
- propose section order changes based on lifecycle state;
- generate template-supported imagery or video through existing creative workflows.

Every AI mutation produces a normal site draft/version with provenance.

The publish boundary remains the same whether the draft was human-made or AI-assisted.

## 20. Autonomy contract for Sites

Recommended defaults:

| Action | Default |
| --- | --- |
| Read site performance | Run |
| Detect stale/broken bindings | Run |
| Prepare lifecycle update | Run |
| Prepare copy/layout proposal | Run |
| Generate zero-cost draft metadata | Run |
| Generate paid image/video asset | Ask unless budgeted |
| Publish site draft | Prepare / Ask |
| Change primary domain | Always ask |
| Remove domain | Always ask |
| Change DNS/provider configuration | Always ask |

A future artist may explicitly opt into automatic publishing for narrow reversible rules, but that is not an initial default.

## 21. Execution phases and gates

### Phase S0 — Documentation and contracts

**Goal:** Freeze product boundaries before code starts.

Deliverables:

- this roadmap;
- parent issue #90;
- roadmap integration;
- architecture invariants;
- explicit non-goals.

**Gate:** no implementation PR starts before S0 is merged.

### Phase S1 — Site foundation

Deliverables:

- `artist_sites`;
- `site_versions`;
- `site_domains`;
- RLS/authorization helpers;
- types and validation schemas;
- template registry contract;
- site manifest schema;
- domain/host provider interfaces;
- idempotent Atlas site backfill skeleton.

**Exit criteria:**

- Atlas maps to a normal site record without changing public behavior;
- second test artist cannot access Atlas site data;
- clean migration replay and DB tests pass;
- cross-artist bindings are rejected.

### Phase S2 — Generic site runtime + Atlas template extraction

Deliverables:

- internal Sites renderer route;
- `editorial-retrofuture` template;
- structured section renderers;
- Atlas manifest migration;
- generic domain-aware metadata helpers;
- preview rendering.

**Exit criteria:**

- Atlas can render through the generic runtime in preview with visual/functional parity;
- second artist renders the same template without Atlas leakage;
- public root has not changed yet unless parity is proven.

### Phase S3 — Atlas production cutover

Deliverables:

- trusted hostname routing/proxy;
- Atlas domain mapping;
- root cutover to generic Sites runtime;
- cache/revalidation integration;
- rollback path to previous published site version / legacy route during rollout.

**Exit criteria:**

- `atlasirwin.com` production is served by Ensemblis Sites;
- `atlasirwin.com/studio` remains Ensemblis;
- visual/SEO/functionality regression suite passes;
- no special-case Atlas logic is required by the generic runtime.

### Phase S4 — Studio Sites UX

Deliverables:

- Sites navigation entry;
- site overview;
- structured section editor;
- template preview/selection;
- draft/preview/publish/rollback;
- domain status surface.

**Exit criteria:**

- artist can make a website change without touching code;
- published site remains unchanged until explicit publish;
- all actions are artist-scoped and auditable.

### Phase S5 — Custom domains

Deliverables:

- first `SiteDomainProvider` adapter;
- add/inspect/remove domain flow;
- DNS guidance;
- verification state;
- primary-domain management;
- canonical redirects;
- fast hostname-map synchronization.

**Exit criteria:**

- second artist can attach a real test domain without deployment/code changes;
- TLS/host routing works;
- unknown/removed domains fail closed;
- no cross-site routing is possible.

### Phase S6 — Owned conversion surfaces

Deliverables shared with #52:

- release landing pages;
- smart links;
- pre-save pages;
- campaign pages;
- EPK/press pages;
- stable attribution contract.

**Exit criteria:**

- all surfaces use the same Sites runtime/domain/version architecture;
- campaign/link lineage reaches the owned-web event stream.

### Phase S7 — Closed-loop site intelligence

Deliverables:

- site performance in Growth/Release context;
- page/CTA/Moment attribution;
- evidence-backed site recommendations;
- lifecycle-generated drafts;
- AI-assisted structured editing;
- site-specific autonomy rules.

**Exit criteria:**

- Ensemblis can explain why it proposes a site change using artist-specific evidence;
- site outcomes influence future decisions without hidden prompt-only memory.

## 22. Dependencies and sequencing

Hard dependencies:

- multi-artist ownership and `ArtistContext` must remain canonical;
- public artist catalog queries must remain artist-scoped;
- rebrand separation must remain intact so Sites renders artist identity, not Ensemblis product chrome.

Strong integration points:

- #52 Smart links/pre-save/attribution;
- Artist Memory for copy/brand constraints;
- Moments for creative selection;
- Releases for lifecycle state;
- Growth for site recommendations;
- Audience/Fan Graph for first-party conversion later;
- autonomy contracts for publishing behavior.

Sites should not block all other roadmap work. S1–S3 establish the reusable public runtime; later phases can proceed incrementally as adjacent domains mature.

## 23. Explicit non-goals for the first production release

- generic freeform drag-and-drop canvas;
- arbitrary HTML/JS embedding;
- plugins/extensions marketplace;
- full generic CMS;
- ecommerce/storefront replacement;
- ticketing platform replacement;
- domain registrar/reseller business;
- email marketing platform replacement;
- moving Ensemblis itself to a new product domain;
- dozens of templates before one reusable template works perfectly;
- automatic public AI edits without an autonomy contract.

## 24. First implementation slice

The first implementation PR after this plan is approved should be deliberately boring and infrastructure-only:

1. additive `artist_sites`, `site_versions`, `site_domains` schema;
2. artist/workspace RLS and indexes;
3. typed site manifest v1 schema;
4. code-defined template registry interface;
5. `SiteHostResolver` and `SiteDomainProvider` interfaces only, without production host cutover;
6. idempotent Atlas site/domain/version backfill;
7. second-artist isolation tests;
8. no change to `atlasirwin.com` rendering yet.

Do not begin by redesigning Atlas or building the editor.

## 25. Success metrics

### Product usefulness

- time from artist setup to a publishable website;
- percentage of site content populated from existing Ensemblis data without re-entry;
- time to prepare a release-day website update;
- manual website interventions per release;
- draft acceptance/edit distance for automated proposals.

### Owned growth

- site visit -> listening-platform click;
- campaign -> site -> meaningful action conversion;
- pre-save/listen/signup conversion by page and campaign;
- performance differences between site variants/featured Moments when sample size is sufficient.

### Reliability

- zero cross-artist site/domain leaks;
- zero custom-domain misroutes;
- zero accidental draft indexing;
- zero unapproved public publishes under default autonomy;
- Atlas visual/SEO regression rate at cutover: zero unintentional regressions.

## 26. Definition of done

Ensemblis Sites is not complete when a template editor exists.

The first complete product milestone is reached when:

- AtlasIrwin.com is served through the generic Sites runtime;
- Atlas is a normal `artist_site`, not public root special-case architecture;
- the current Atlas visual experience is represented by a reusable template;
- another artist can render that template with isolated data;
- an artist can edit, preview, publish and rollback through Ensemblis;
- custom domains can be connected without a code deployment;
- SEO/metadata are generated correctly for each artist/domain;
- release and platform data synchronize through explicit bindings;
- owned-web events retain artist/site/campaign lineage;
- tests prove isolation, routing, publishing and Atlas parity.

## 27. Decision ledger

The following decisions are considered accepted unless this roadmap is amended:

1. Keep Ensemblis under `atlasirwin.com/studio` for now.
2. Treat AtlasIrwin.com as the first Ensemblis-managed artist site.
3. Build Sites as owned artist web infrastructure, not a generic website builder.
4. Extract the current Atlas design as the first reusable template without redesigning it during migration.
5. Use structured/versioned manifests and canonical Ensemblis bindings instead of a disconnected website CMS.
6. Use hostname-based multi-tenant routing with a provider-neutral domain abstraction.
7. Keep public publishing approval-gated by default.
8. Share the Sites runtime with smart links, pre-save, campaign pages and EPK surfaces.
9. Require second-artist proof before declaring the Atlas extraction generic.
10. Preserve production continuously; no big-bang public-site rewrite.

This document is the canonical execution plan for issue #90. Architecture or sequencing changes should be reflected here before implementation diverges.