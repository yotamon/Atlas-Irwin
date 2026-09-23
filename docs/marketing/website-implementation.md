# Ensemblis marketing website v1

The marketing experience is available at **`/website`**. The Atlas Irwin homepage remains at `/`.

## Routes

- `/website`: the complete homepage narrative, four pillars, shared listening example, FAQ and final conversion.
- `/website/analysis`, `/website/mastering`, `/website/mix`, `/website/promote`: product detail pages.
- `/website/about`: authorship and product principles.
- `/website/pricing`: truthful private-beta access information; no invented plans.
- `/website/opengraph-image`: generated social preview.
- `/website/manifest.webmanifest`: Ensemblis identity, separate from the artist-site manifest.

The temporary routes are `noindex, nofollow` and intentionally absent from the public artist sitemap. Unsupported product slugs return 404. There are no placeholder resources or legal links.

## Design and motion

The implementation follows `homepage-visual-spec.md`: Manrope with Instrument Serif, canonical Ensemblis colors, architectural surfaces, waveform-led compositions, and a single paper inversion for authorship. The marketing root consumes `app/studio/design-system/tokens.css`; it does not define another set of product tokens.

The hero performs one bounded scan, resolves musical annotations, then branches into the four workflows. The CTA and heading never wait for the animation. Replay is explicit. Lower sections use one-time intersection-driven reveals, selectable semantic layers, a connected two-track visualization, and a moment-to-teaser transformation. No scroll hijacking, perpetual background motion, WebGL, or additional runtime animation dependency is used.

Reduced motion resolves the hero immediately, removes translations and preserves the entire story. Mobile has sequential compositions, a disclosure menu with Escape/outside-click handling, and a full-size vertical creative example.

## Demo provenance and capability truth

The example audio is **Baby Don't Stop — Atlas Irwin**, from the publicly published *Dancing In Color* release. Its public URL was verified with the public Supabase catalog, without privileged access. Playback was verified in a browser.

`lib/marketing-site/audio-snapshot.json` contains a measured, deterministic waveform and duration from that audio. The snapshot records the source SHA-256 and sampling method: 176 evenly spaced 40 ms RMS windows from the first channel, normalized by the maximum, decoded at 44.1 kHz. Audio is not downloaded during page load and is not processed in visitors' browsers. The same geometry appears throughout the page.

**BPM, key, structure, energy, strongest-moment selection, mastering direction, track pairing and campaign annotations are editorial examples, not verified pipeline output for this release.** This distinction is visible in the hero, relevant examples, demo footer and FAQ. Section fixtures conform to the production `MusicMapSection` type. No fake analysis is sent to the backend.

The repository has no approved original/master audio pair or rendered transition example for this public demo. Those sections are interactive visual explanations, with explicit disclosures; they do not play counterfeit A/B or mix audio. Replace the complete fixture with an approved pipeline snapshot and verified audio assets before presenting it as measured product proof. This is the remaining production-proof work from blueprint phases 3–4.

The four existing workflows are labeled Beta. Catalog/artist intelligence is explicitly future-facing. Public signup, free analysis entitlements, paid plans, usage counts and endorsements are not claimed.

## Upload conversion

`Analyze a track` enters `/studio/login?next=%2Fstudio%2Fmusic%2Fimport`. Existing authorization stays intact. The login form, failed-login retry, successful sign-in, already-authenticated redirect and local development bypass preserve that destination.

`lib/auth/studio-return-path.ts` only accepts `/studio/music/import`; every other input falls back to `/studio`. External URLs, protocol-relative URLs, encoded destinations, traversal and appended query strings cannot become redirects. An existing authorized Ensemblis account is required. This change does not introduce anonymous uploads or expand workspace access.

## Audio, accessibility and resilience

One provider owns one native audio element. Audio loads only on explicit playback, pauses on page visibility loss and unmount, and synchronizes the seek control and demo waveform with actual playback time. Changing demo tabs does not create or restart another source. Loading can be canceled; errors and a 15-second timeout expose retry without disabling the visual story.

Semantic headings, native links/buttons, keyboard-operated tabs, visible focus, touch controls, textual graph explanations, no audible autoplay and reduced-motion behavior are included. An automated Axe WCAG A/AA test covers desktop and mobile.

The application-wide `app/loading.tsx` wraps this nested static route in a streamed Suspense container. A narrowly scoped `noscript` style exposes only a hidden ancestor containing `.marketing-root`, and hides only the inherited top-level loading fallback. Its rule is in Tailwind's base layer to override Preflight's important hidden rule. This preserves the full static page with JavaScript disabled without changing other routes' loading behavior. The test covers this integration explicitly.

## Analytics and SEO

`trackMarketingEvent` emits typed `ensemblis:marketing` browser events. No analytics vendor, tracking cookies or external collection is enabled. Events exclude audio, derived user data and identifiers; Do Not Track is respected. A future consent-aware collector can subscribe without changing components. The layer only emits events that actually happen here; it does not claim upload completion from an outbound click.

Page-specific titles/descriptions, Ensemblis icons, theme color, social image, manifest and temporary indexing policy are included. Canonicals and sitemap changes belong to the final domain/root migration.

## Validation

Verified on the production build: all nine marketing browser tests, desktop/mobile Axe WCAG AA, and the existing 372 Studio contract tests (using normalized LF checkout content). Full lint completes with no errors; its 12 warnings are pre-existing outside this change. The production build includes static HTML for all marketing pages.

A synthetic cold mobile run at 390 × 844, 4× CPU slowdown, 150 ms network latency and 1.6 Mbps download measured **LCP 1.24 s, CLS 0**, with no audio requested. This is a local lab observation, not field p75 data.

Review captures: [desktop](./screenshots/website-desktop.png), [mobile](./screenshots/website-mobile.png), [promotion transformation](./screenshots/website-promote.png).

Run the production build and start it, then run the focused browser suite against that URL:

```sh
npm ci
npm run build
npm run start
# in another terminal, set PLAYWRIGHT_BASE_URL to the server URL
npx playwright install chromium
npx playwright test e2e/marketing-website.spec.mjs
npm run typecheck
npm run lint
npm run test:studio
```

The browser suite covers hero completion, mobile widths from 320 to 1920 px, menu/focus behavior, all demo perspectives, actual media-element playback with a deterministic test asset, audio failure, reduced motion, no JavaScript, product routes, share image, upload return paths and automated accessibility. External artist audio playback is separately smoke-tested; CI does not depend on third-party storage uptime.

On Windows, three existing Studio source-contract tests assume LF line endings. They pass with Git's normalized LF content; CRLF checkout conversion alone can fail those assertions. No changes to their source logic are required.

## Moving to `/`

1. Change `MARKETING_BASE` in `lib/marketing-site/content.ts` from `/website` to an empty string; `marketingPath()` already returns `/` for an empty homepage path.
2. Mount `MarketingHomepage` and the marketing layout at the new public root, moving the Atlas artist site through its separately planned migration.
3. Move the product, social-image and manifest routes; update the manifest scope and temporary URLs/redirects.
4. Confirm the final marketing/application hosts, authentication cookies, canonical URLs, public sitemap, legal pages and real product-proof assets.
5. Remove the temporary noindex policy only when the public launch content and routing are ready.

The marketing components do not assume `atlasirwin.com` or a future application subdomain. Product import is the current same-origin integration point.
