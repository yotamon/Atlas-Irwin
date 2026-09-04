import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

const requiredRoutes = [
  "app/studio/(protected)/page.tsx",
  "app/studio/(protected)/music/page.tsx",
  "app/studio/(protected)/growth/page.tsx",
  "app/studio/(protected)/growth/import/page.tsx",
  "app/studio/(protected)/releases/page.tsx",
  "app/studio/(protected)/create/page.tsx",
  "app/studio/(protected)/audience/page.tsx",
  "app/studio/(protected)/library/page.tsx",
  "app/studio/(protected)/connections/page.tsx",
  "app/studio/(protected)/settings/page.tsx",
  "app/studio/(protected)/production/page.tsx",
  "app/studio/(protected)/learn/page.tsx",
  "app/studio/(protected)/inbox/page.tsx",
  "app/studio/(protected)/video/page.tsx",
  "app/studio/(protected)/video/[id]/page.tsx",
];

test("Studio V2 keeps every daily outcome route present", async () => {
  await Promise.all(requiredRoutes.map((path) => access(path)));
});

test("Ensemblis navigation matches the grouped product roadmap and keeps specialist tools contextual", async () => {
  const product = await readFile("lib/ensemblis-product.ts", "utf8");
  const sidebar = await readFile("components/studio/sidebar.tsx", "utf8");

  assert.ok(product.includes("ENSEMBLIS_WORK_NAV"));
  assert.ok(product.includes("ENSEMBLIS_MANAGE_NAV"));
  assert.ok(product.includes("ENSEMBLIS_SETTINGS_NAV"));
  assert.ok(product.includes("ENSEMBLIS_PRIMARY_NAV = ENSEMBLIS_WORK_NAV"));

  for (const route of [
    "/studio",
    "/studio/music",
    "/studio/releases",
    "/studio/create",
    "/studio/growth",
    "/studio/audience",
    "/studio/library",
  ]) {
    assert.match(product, new RegExp(route.replaceAll("/", "\\/")));
  }

  for (const route of [
    "/studio/sites",
    "/studio/distribution",
    "/studio/connections",
    "/studio/settings",
  ]) {
    assert.match(product, new RegExp(route.replaceAll("/", "\\/")));
  }

  for (const contextualRoute of [
    "/studio/campaigns",
    "/studio/content",
    "/studio/outreach",
    "/studio/analytics",
    "/studio/data-health",
  ]) {
    assert.equal(
      product.includes(`\"${contextualRoute}\"`),
      false,
      `${contextualRoute} leaked into durable Ensemblis navigation`,
    );
  }

  assert.ok(sidebar.includes("ENSEMBLIS_WORK_NAV"));
  assert.ok(sidebar.includes("ENSEMBLIS_MANAGE_NAV"));
  assert.ok(sidebar.includes("ENSEMBLIS_SETTINGS_NAV"));
  assert.ok(sidebar.includes("ArtistSwitcher"));
  assert.ok(sidebar.includes("ensemblisArtistHref"));
  assert.equal(sidebar.includes("ATLAS"), false, "Atlas product branding leaked back into the Ensemblis shell");
});

test("Ensemblis persists and validates active artist context across primary navigation and deep links", async () => {
  const product = await readFile("lib/ensemblis-product.ts", "utf8");
  const context = await readFile("lib/studio/artist-context.ts", "utf8");
  const switcher = await readFile("components/studio/artist-switcher.tsx", "utf8");
  const sidebar = await readFile("components/studio/sidebar.tsx", "utf8");
  const proxy = await readFile("proxy.ts", "utf8");
  const layout = await readFile("app/studio/(protected)/layout.tsx", "utf8");

  assert.ok(product.includes('ENSEMBLIS_ACTIVE_ARTIST_COOKIE = "ensemblis_active_artist"'));
  assert.ok(context.includes("listAccessibleArtists"));
  assert.ok(context.includes("resolveActiveArtistContext"));
  assert.ok(context.includes("resolveArtistContext(client, identity, preferredArtistId)"));
  assert.ok(context.includes("resolveLegacyFallbackArtistContext"));
  assert.ok(context.includes("return resolveActiveArtistContext(client, identity);"));
  assert.equal(context.includes("return resolveDefaultArtistContext(client, identity);"), false);
  assert.ok(switcher.includes('params.set("artist", artistId)'));
  assert.ok(sidebar.includes("ensemblisArtistHref(href, artistId)"));
  assert.ok(proxy.includes("selectedArtistFromRequest(request)"));
  assert.ok(proxy.includes("request.cookies.set(ENSEMBLIS_ACTIVE_ARTIST_COOKIE, requestedArtistId)"));
  assert.ok(layout.includes("resolveActiveArtistContext"));
  assert.ok(layout.includes("listAccessibleArtists"));
});

test("primary creation, music and library surfaces use active artist identity rather than Atlas defaults", async () => {
  const create = await readFile("app/studio/(protected)/create/page.tsx", "utf8");
  const music = await readFile("app/studio/(protected)/music/page.tsx", "utf8");
  const library = await readFile("app/studio/(protected)/library/page.tsx", "utf8");

  assert.ok(create.includes("requireArtistContext"));
  assert.ok(create.includes("artist.artistName"));
  assert.ok(create.includes("ensemblisArtistHref"));

  assert.ok(music.includes("resolveActiveArtistContext"));
  assert.ok(music.includes('from("brand_settings")'));
  assert.ok(music.includes('.eq("artist_id", artist.artistId)'));
  assert.ok(music.includes("artist.artistName"));

  assert.ok(library.includes("resolveActiveArtistContext"));
  assert.ok(library.includes('.eq("artist_id", artist.artistId)'));
  assert.ok(library.includes("artistTag"));
  assert.ok(library.includes("<MediaUploader artistId={artist.artistId}"));

  for (const [path, source] of [["Create", create], ["Music", music], ["Library", library]]) {
    assert.equal(/\bAtlas Irwin\b/.test(source), false, `${path} contains a hardcoded Atlas artist assumption`);
  }
});

test("Ensemblis auth and shell keep artist identity separate from product identity", async () => {
  const login = await readFile("app/studio/login/page.tsx", "utf8");
  const layout = await readFile("app/studio/(protected)/layout.tsx", "utf8");
  const product = await readFile("lib/ensemblis-product.ts", "utf8");
  const mark = await readFile("components/ensemblis-logo.tsx", "utf8");

  assert.ok(product.includes('name: "Ensemblis"'));
  assert.ok(login.includes("ENSEMBLIS_PRODUCT"));
  assert.ok(login.includes("EnsemblisMark"));
  assert.equal(login.includes("Atlas Irwin"), false);
  assert.ok(layout.includes("resolveActiveArtistContext"));
  assert.ok(mark.includes("ensemblis-mark-wave"));
});

test("Atlas public identity is page-scoped and cannot leak into Ensemblis metadata", async () => {
  const rootLayout = await readFile("app/layout.tsx", "utf8");
  const publicPage = await readFile("app/page.tsx", "utf8");
  const studioLayout = await readFile("app/studio/layout.tsx", "utf8");
  const studioManifest = await readFile("app/studio/manifest.ts", "utf8");

  assert.equal(rootLayout.includes("Atlas Irwin"), false);
  assert.ok(publicPage.includes("Atlas Irwin — Retro-Futuristic Electronic Music"));
  assert.ok(publicPage.includes('"@type": "MusicGroup"'));
  assert.ok(studioLayout.includes("ENSEMBLIS_PRODUCT"));
  assert.ok(studioLayout.includes("/ensemblis-mark.svg"));
  assert.ok(studioManifest.includes('start_url: "/studio"'));
  assert.ok(studioManifest.includes("ENSEMBLIS_PRODUCT"));
});

test("generic product surfaces contain no hardcoded Atlas user-facing language", async () => {
  const files = [
    "components/studio/sidebar.tsx",
    "app/studio/login/page.tsx",
    "app/studio/access-denied/page.tsx",
    "app/studio/error.tsx",
    "app/studio/layout.tsx",
    "app/studio/(protected)/create/page.tsx",
    "app/studio/(protected)/music/page.tsx",
    "app/studio/(protected)/library/page.tsx",
    "app/studio/(protected)/settings/page.tsx",
    "app/studio/(protected)/settings/ai/page.tsx",
    "app/studio/(protected)/connections/page.tsx",
    "proxy.ts",
  ];
  for (const path of files) {
    const source = await readFile(path, "utf8");
    assert.equal(/\bAtlas(?: Irwin)?\b/.test(source), false, `${path} contains hardcoded Atlas product language`);
  }
});

test("release workspace exposes lifecycle-aware growth stages and preserves an advanced escape hatch", async () => {
  const workspace = await readFile("components/studio/release-workspace-v2.tsx", "utf8");
  const mission = await readFile("lib/studio/release-mission.ts", "utf8");
  for (const upcomingStage of ["Select", "Prepare", "Build hype", "Release", "Sustain"]) assert.ok(workspace.includes(upcomingStage));
  for (const catalogStage of ["Orient", "Rediscover", "Produce", "Distribute", "Learn"]) assert.ok(workspace.includes(catalogStage));
  assert.ok(workspace.includes("Advanced view"));
  assert.ok(workspace.includes("/studio/production"));
  assert.ok(workspace.includes("/studio/video?release="));
  assert.ok(workspace.includes('label: "Release mission"'));
  assert.ok(workspace.includes("deriveReleaseMission"));
  assert.ok(mission.includes('label: "Blocked"'));
  assert.ok(mission.includes('label: "On track"'));
  assert.equal(workspace.includes("Workflow readiness"), false);
});

test("Growth OS keeps planning and diagnosis deterministic before paid creative", async () => {
  const growth = await readFile("lib/studio/growth.ts", "utf8");
  const actions = await readFile("app/studio/growth-actions.ts", "utf8");
  const migration = await readFile("supabase/migrations/20260819183700_growth_event_engine.sql", "utf8");
  assert.ok(growth.includes("scoreVaultTrack"));
  assert.ok(growth.includes("diagnoseGrowthFunnel"));
  assert.ok(actions.includes("plannerPlatformsFromConnections"));
  assert.equal(growth.includes("openai"), false);
  assert.equal(growth.includes("gemini"), false);
  assert.equal(growth.includes("higgsfield"), false);
  assert.ok(migration.includes("rebuild_growth_plan"));
  assert.ok(migration.includes("detect_growth_from_metric"));
});

test("unreleased masters are independent from releases and reuse the shared durable media worker", async () => {
  const migration = await readFile("supabase/migrations/20260819183500_artist_growth_os.sql", "utf8");
  const mediaAction = await readFile("app/studio/growth-media-actions.ts", "utf8");
  const workerReadiness = await readFile("lib/studio/vault-analysis.ts", "utf8");
  const workerQueue = await readFile("lib/media-worker/queue.ts", "utf8");
  assert.ok(migration.includes("create table public.track_vault"));
  assert.ok(migration.includes("linked_release_id uuid references public.releases"));
  assert.ok(mediaAction.includes("createVaultTrackFromMedia"));
  assert.ok(mediaAction.includes("kickMediaWorkerQueue"));
  assert.ok(workerReadiness.includes("mediaWorkerReadiness"));
  assert.equal(workerReadiness.includes("dispatchMediaWorkerJob"), false);
  assert.ok(workerQueue.includes('jobType: "analyze_audio"'));
  assert.ok(workerQueue.includes("dispatchMediaWorkerJob"));
  assert.ok(workerQueue.includes('status: "queued"'));
});

test("Create keeps specialist creation outcomes discoverable", async () => {
  const create = await readFile("app/studio/(protected)/create/page.tsx", "utf8");
  for (const route of ["/studio/music", "/studio/production", "/studio/video"]) {
    assert.ok(create.includes(route), `${route} is no longer discoverable from Create`);
  }
});

test("normal Studio V2 routes do not link daily work back to Content Lab", async () => {
  const files = [
    "app/studio/(protected)/page.tsx",
    "app/studio/(protected)/calendar/page.tsx",
    "components/studio/release-workspace-v2.tsx",
  ];
  for (const path of files) {
    const source = await readFile(path, "utf8");
    assert.equal(source.includes("/studio/content?edit="), false, `${path} still routes normal edits through Content Lab`);
  }
});
