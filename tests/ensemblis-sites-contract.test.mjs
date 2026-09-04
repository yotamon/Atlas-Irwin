import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

async function requireSnippets(path, snippets) {
  const text = await source(path);
  for (const snippet of snippets) {
    assert.ok(text.includes(snippet), `${path} must retain Ensemblis Sites contract: ${snippet}`);
  }
  return text;
}

test("Sites persistence is artist-scoped, versioned and domain-unique", async () => {
  const migration = await requireSnippets("supabase/migrations/20260904154500_ensemblis_sites_foundation.sql", [
    "create table public.artist_sites",
    "artist_id uuid not null references public.artists(id) on delete restrict",
    "create table public.artist_site_versions",
    "create table public.artist_site_domains",
    "unique (hostname)",
    "create unique index artist_site_one_primary_domain_idx",
    "private.can_access_artist(site.artist_id)",
    "validate_artist_site_version_pointers",
  ]);
  assert.doesNotMatch(migration, /owner_id uuid/, "Sites must not reintroduce owner-as-artist ownership");
});

test("published snapshots pin template identity/version and remain immutable", async () => {
  await requireSnippets("supabase/migrations/20260904160000_ensemblis_sites_template_pinning.sql", [
    "add column template_key text",
    "add column template_version integer",
    "new.template_key is distinct from old.template_key",
    "new.template_version is distinct from old.template_version",
    "published artist site snapshots cannot be mutated",
    "source_row.template_version",
  ]);
  await requireSnippets("supabase/migrations/20260904160500_ensemblis_sites_template_key_normalization.sql", [
    "template_key = version_row.template_key",
    "published_version_id = version_row.id",
  ]);
});

test("Atlas is backfilled only as an inactive shadow Sites tenant", async () => {
  const migration = await requireSnippets("supabase/migrations/20260904161000_ensemblis_sites_atlas_backfill.sql", [
    "lower(trim(artist.name)) = 'atlas irwin'",
    "'atlas-irwin'",
    "'artist-editorial'",
    "'draft'",
    "'atlasirwin.com'",
    "'custom'",
    "'pending'",
    "is_primary",
    "false",
  ]);
  assert.doesNotMatch(
    migration,
    /verification_status[\s\S]{0,200}'verified'|ssl_status[\s\S]{0,200}'active'/,
    "Atlas backfill must never activate routing or TLS before explicit cutover",
  );
});

test("Atlas parity upgrade mutates only the unpublished shadow draft", async () => {
  const migration = await requireSnippets("supabase/migrations/20260904170000_ensemblis_sites_atlas_retrofuture_parity.sql", [
    "atlas_site.published_version_id is not null",
    "and status = 'draft'",
    "template_key = 'editorial-retrofuture'",
    "template_version = 1",
    "'sectionOrder'",
    "jsonb_build_array('hero','releases','platforms','about','contact','newsletter')",
    "'contactFormEnabled', true",
    "'newsletterEnabled', true",
    "update public.artist_sites",
  ]);
  assert.doesNotMatch(
    migration,
    /verification_status\s*=\s*'verified'|ssl_status\s*=\s*'active'|is_primary\s*=\s*true/i,
    "Atlas parity migration must not perform domain cutover",
  );
});

test("public runtime resolves only published versions and isolates cache keys", async () => {
  await requireSnippets("lib/sites/runtime.ts", [
    '.eq("state", "published")',
    "site.published_version_id",
    '.eq("status", "published")',
    "parseSiteViewModel(versionResult.data.content_snapshot)",
    '`site:${siteId}`',
    '`site-slug:${slug}`',
    '`site-host:${normalized}`',
  ]);
  await requireSnippets("app/sites/[slug]/page.tsx", [
    "loadPublishedSiteBySlug",
    "buildArtistSiteMetadata(runtime)",
    "buildArtistSiteJsonLd(runtime)",
    "getSiteTemplate(runtime.version.template_key, runtime.version.template_version)",
  ]);
});

test("metadata canonicalizes to the verified primary hostname", async () => {
  await requireSnippets("lib/sites/seo.ts", [
    "runtime.primaryHostname",
    "alternates: { canonical }",
    '"@type": "WebSite"',
    '"@type": "MusicGroup"',
    '"@type": "MusicAlbum"',
  ]);
});

test("private preview is authenticated, artist-scoped, noindex and outside Studio chrome", async () => {
  await requireSnippets("app/site-preview/[siteId]/page.tsx", [
    "requireStudioAdmin",
    "resolveActiveArtistContext",
    '.eq("artist_id", artist.artistId)',
    "site.draft_version_id || site.published_version_id",
    "getSiteTemplate(version.template_key, version.template_version)",
    "preview",
  ]);
  await requireSnippets("app/site-preview/[siteId]/layout.tsx", [
    'import "../../sites/sites.css"',
    "robots: { index: false, follow: false, nocache: true }",
  ]);
  await requireSnippets("app/studio/(protected)/sites/page.tsx", [
    'href={`/site-preview/${site.id}`}',
  ]);
});

test("site snapshots read rich playable data from the active artist only", async () => {
  const snapshot = await requireSnippets("lib/sites/snapshot.ts", [
    "context.artistId",
    '.eq("artist_id", context.artistId)',
    '.eq("is_public", true)',
    '.eq("publish_state", "live")',
    '.from("tracks")',
    "durationSeconds",
    "soundcloudUrl",
    "spotifyUrl",
    "schemaVersion: 1",
  ]);
  assert.doesNotMatch(
    snapshot,
    /\.eq\(["']owner_id["']/,
    "Site snapshot queries must never scope public artist content through owner_id",
  );
});

test("artist-facing template implementations never leak product or Atlas identity", async () => {
  for (const path of [
    "components/sites/templates/artist-editorial-v1.tsx",
    "components/sites/templates/editorial-retrofuture-v1.tsx",
  ]) {
    const template = await source(path);
    assert.doesNotMatch(template, /Atlas Irwin/i, `${path} must derive artist identity from the snapshot/config`);
    assert.doesNotMatch(template, /EnsemblisMark|ENSEMBLIS_PRODUCT|Music-aware artist growth/);
    assert.match(template, /viewModel\.artist\.name/);
  }
});

test("editorial-retrofuture reuses the production Atlas sections instead of forking the design", async () => {
  await requireSnippets("components/sites/templates/editorial-retrofuture-v1.tsx", [
    'from "@/components/hero"',
    'from "@/components/navbar"',
    'from "@/components/release-widget-client"',
    'from "@/components/listen-platforms-section"',
    'from "@/components/about-section"',
    'from "@/components/contact-section"',
    'from "@/components/newsletter-signup"',
    'from "@/components/footer"',
    "ReleaseWidgetClient",
    "viewModel.releases",
  ]);
  await requireSnippets("lib/sites/templates/registry.tsx", [
    'key: "editorial-retrofuture"',
    "version: 1",
    "render: EditorialRetrofutureTemplate",
    '"audio-player"',
  ]);
});

test("legacy Atlas root still composes the same shared production sections", async () => {
  await requireSnippets("app/page.tsx", [
    "<Navbar />",
    "<Hero />",
    "<ReleaseWidget />",
    "<ListenPlatformsSection />",
    "<AboutSection />",
    "<ContactSection />",
    "<NewsletterSignup />",
    "<Footer />",
  ]);
});

test("host resolution fails closed to verified, TLS-active, published sites", async () => {
  await requireSnippets("lib/sites/host-resolver.ts", [
    "normalizeSiteHostname",
    '.eq("verification_status", "verified")',
    '.eq("ssl_status", "active")',
    '.eq("state", "published")',
    "if (!site?.published_version_id) return null",
  ]);
});

test("custom-domain provider has explicit attach inspect verify and detach boundaries", async () => {
  await requireSnippets("lib/sites/domain-provider.ts", [
    "interface SiteDomainProvider",
    "attach(hostname: string)",
    "inspect(hostname: string)",
    "verify(hostname: string)",
    "detach(hostname: string)",
    "Wildcard custom domains are not supported",
  ]);
  await requireSnippets("lib/sites/providers/vercel-domain-provider.ts", [
    "/v9/projects/",
    "/domains/${encodeURIComponent(hostname)}/verify",
    "/v6/domains/${encodeURIComponent(hostname)}/config",
    "cache: \"no-store\"",
  ]);
});

test("Studio creates retrofuture sites and resets the pinned template defaults", async () => {
  await requireSnippets("app/studio/(protected)/sites/page.tsx", [
    "Create private site draft",
    "Preview private draft",
    "Refresh draft from Ensemblis",
    "Publish v",
    "Restore v",
    "Version history",
  ]);
  await requireSnippets("app/studio/sites-actions.ts", [
    "resolveActiveArtistContext",
    '.eq("artist_id", artist.artistId)',
    'getLatestSiteTemplate("editorial-retrofuture")',
    "getSiteTemplate(",
    'updateTag(`site:${siteId}`)',
    'sites.rpc("publish_artist_site"',
    'sites.rpc("rollback_artist_site"',
    "template_version: template.version",
  ]);
  await requireSnippets("lib/ensemblis-product.ts", [
    '{ href: "/studio/sites", label: "Sites", icon: "sites" }',
  ]);
});
