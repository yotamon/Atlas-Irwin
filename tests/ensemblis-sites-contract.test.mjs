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

test("published snapshots are immutable and publication is atomic", async () => {
  await requireSnippets("supabase/migrations/20260904154500_ensemblis_sites_foundation.sql", [
    "protect_published_artist_site_version",
    "published artist site snapshots cannot be mutated",
    "create or replace function public.publish_artist_site",
    "for update;",
    "set status = 'published', published_at = now()",
    "published_version_id = version_row.id",
    "create or replace function public.rollback_artist_site",
    "rollback_version_id",
  ]);
});

test("public runtime resolves only the published site pointer", async () => {
  await requireSnippets("lib/sites/runtime.ts", [
    '.eq("state", "published")',
    "site.published_version_id",
    '.eq("status", "published")',
    "parseSiteViewModel(version.content_snapshot)",
    "ensemblis-sites",
  ]);
  await requireSnippets("app/sites/[slug]/page.tsx", [
    "loadPublishedSiteBySlug",
    "robots: { index: true, follow: true }",
    '"@type": "MusicGroup"',
    "getSiteTemplate(runtime.site.template_key)",
  ]);
});

test("private preview is authenticated, artist-scoped and noindex", async () => {
  await requireSnippets("app/studio/site-preview/[siteId]/page.tsx", [
    "requireStudioAdmin",
    "resolveActiveArtistContext",
    '.eq("artist_id", artist.artistId)',
    "site.draft_version_id || site.published_version_id",
    "preview",
  ]);
  await requireSnippets("app/studio/site-preview/[siteId]/layout.tsx", [
    "robots: { index: false, follow: false }",
  ]);
});

test("site snapshots read the active artist instead of the legacy owner", async () => {
  const snapshot = await requireSnippets("lib/sites/snapshot.ts", [
    "context.artistId",
    '.eq("artist_id", context.artistId)',
    '.eq("is_public", true)',
    '.eq("publish_state", "live")',
    "schemaVersion: 1",
  ]);
  assert.doesNotMatch(snapshot, /owner_id/, "Site snapshot building must stay artist-scoped");
});

test("artist-facing templates never leak Atlas or Ensemblis product identity", async () => {
  const template = await source("components/sites/templates/artist-editorial-v1.tsx");
  assert.doesNotMatch(template, /Atlas Irwin/i);
  assert.doesNotMatch(template, /EnsemblisMark|ENSEMBLIS_PRODUCT|Music-aware artist growth/);
  assert.match(template, /viewModel\.artist\.name/);
  assert.match(template, /viewModel\.releases/);
});

test("Studio exposes an explicit reversible Sites workflow", async () => {
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
    'updateTag("ensemblis-sites")',
    'sites.rpc("publish_artist_site"',
    'sites.rpc("rollback_artist_site"',
  ]);
  await requireSnippets("lib/ensemblis-product.ts", [
    '{ href: "/studio/sites", label: "Sites", icon: "sites" }',
  ]);
});
