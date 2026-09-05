import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function source(path) { return readFile(new URL(`../${path}`, import.meta.url), "utf8"); }

const migration = "supabase/migrations/20260905133000_smart_links_first_party_attribution.sql";
const contentSources = "supabase/migrations/20260905134500_smart_link_content_sources.sql";

test("Smart Links persist artist-scoped release, destination, source and event lineage", async () => {
  const sql = await source(migration);
  for (const snippet of [
    "create table public.smart_links",
    "create table public.smart_link_destinations",
    "create table public.smart_link_sources",
    "create table public.smart_link_events",
    "site_id uuid not null references public.artist_sites",
    "release_id uuid not null references public.releases",
    "content_item_id uuid references public.content_items",
    "moment_id uuid references public.moments",
    "private.can_access_artist(artist_id)",
    "private.ensure_release_smart_link",
    "sync_release_smart_link",
    "sync_artist_site_smart_links",
  ]) assert.ok(sql.includes(snippet), `Smart Link migration missing ${snippet}`);
});

test("public Smart Link measurement is sessionless and verified pre-save completion is trusted only", async () => {
  const sql = await source(migration);
  const legacy = await source("app/go/[code]/route.ts");
  const tracker = await source("components/sites/smart-link-tracker.tsx");
  assert.ok(sql.includes("record_smart_link_event"));
  assert.ok(sql.includes("record_verified_pre_save_completion"));
  assert.ok(sql.includes("coalesce(auth.role(), '') <> 'service_role'"));
  assert.ok(sql.includes("pre_save_completion") && sql.includes("verification_reference"));
  assert.ok(sql.includes("'privacy_mode','sessionless'"));
  assert.equal(legacy.includes("createHash"), false);
  assert.equal(legacy.includes("x-forwarded-for"), false);
  assert.equal(legacy.includes("user-agent"), false);
  assert.ok(legacy.includes('p_visitor_hash: ""'));
  assert.ok(legacy.includes("privacy-safe replacement intentionally ignores legacy visitor identity"));
  assert.ok(legacy.includes("p_user_agent: null"));
  assert.ok(tracker.includes('credentials: "omit"'));
});

test("release Smart Links stay stable and switch pre-save to streaming dynamically", async () => {
  const runtime = await source("lib/smart-links/runtime.ts");
  const managed = await source("app/sites/[slug]/release/[releaseSlug]/page.tsx");
  const custom = await source("app/__sites/[siteId]/[[...path]]/page.tsx");
  for (const snippet of ["pre_release", "streaming", "pre_save", "Europe/Berlin"]) assert.ok(runtime.includes(snippet));
  assert.ok(managed.includes("loadSmartLinkRuntime"));
  assert.ok(custom.includes('path[0] === "release"'));
  assert.ok(custom.includes("ReleaseSmartLink"));
});

test("content items automatically receive stable campaign and Moment source codes", async () => {
  const sql = await source(contentSources);
  for (const snippet of [
    "smart_link_sources_content_unique",
    "private.ensure_content_smart_link_source",
    "campaign_id",
    "moment_id",
    "sync_content_smart_link_source",
    "on conflict (content_item_id)",
  ]) assert.ok(sql.includes(snippet));
});

test("publication prefers the artist-owned release URL and keeps legacy attribution only as fallback", async () => {
  const publications = await source("lib/marketing/publications.ts");
  const resolver = await source("lib/smart-links/source-url.ts");
  assert.ok(publications.includes("publicationSmartLinkUrl"));
  assert.ok(publications.includes("if (!attributionUrl && job.content_variant_id)"));
  assert.ok(publications.includes("ownedDestination"));
  assert.ok(resolver.includes("artist_site_domains"));
  assert.ok(resolver.includes('url.searchParams.set("src", source.code)'));
  assert.ok(resolver.includes("verification_status === \"verified\""));
});

test("Sites owns Smart Link management and Release Mission routes destination work there", async () => {
  const page = await source("app/studio/(protected)/sites/smart-links/page.tsx");
  const panel = await source("components/studio/smart-links-panel.tsx");
  const mission = await source("lib/studio/release-mission.ts");
  assert.ok(page.includes("Release links"));
  assert.ok(page.includes("part of Ensemblis Sites") || page.includes("not a separate tracker"));
  assert.ok(panel.includes("launch_actions_day_7"));
  assert.ok(panel.includes("launch_actions_day_30"));
  assert.ok(panel.includes("first-party and sessionless"));
  assert.ok(mission.includes('/studio/sites/smart-links'));
});
