import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

const requiredRoutes = [
  "app/studio/(protected)/page.tsx",
  "app/studio/(protected)/growth/page.tsx",
  "app/studio/(protected)/growth/import/page.tsx",
  "app/studio/(protected)/releases/page.tsx",
  "app/studio/(protected)/create/page.tsx",
  "app/studio/(protected)/library/page.tsx",
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

test("primary navigation stays intentionally small and growth-led", async () => {
  const sidebar = await readFile("components/studio/sidebar.tsx", "utf8");
  for (const route of ["/studio", "/studio/growth", "/studio/releases", "/studio/create", "/studio/library", "/studio/settings"]) {
    assert.match(sidebar, new RegExp(route.replaceAll("/", "\\/")));
  }
  for (const advancedRoute of ["/studio/campaigns", "/studio/content", "/studio/outreach", "/studio/analytics", "/studio/data-health"]) {
    assert.equal(sidebar.includes(`\"${advancedRoute}\"`), false, `${advancedRoute} leaked back into the primary navigation`);
  }
});

test("release workspace exposes the artist growth lifecycle and preserves an advanced escape hatch", async () => {
  const workspace = await readFile("components/studio/release-workspace-v2.tsx", "utf8");
  for (const stage of ["Select", "Prepare", "Build hype", "Release", "Sustain"]) assert.ok(workspace.includes(stage));
  assert.ok(workspace.includes("Advanced view"));
  assert.ok(workspace.includes("/studio/production"));
  assert.ok(workspace.includes("/studio/video?release="));
  assert.ok(workspace.includes("Release health"));
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

test("unreleased masters are independent from releases and reuse the media worker", async () => {
  const migration = await readFile("supabase/migrations/20260819183500_artist_growth_os.sql", "utf8");
  const mediaAction = await readFile("app/studio/growth-media-actions.ts", "utf8");
  const workerBridge = await readFile("lib/studio/vault-analysis.ts", "utf8");
  assert.ok(migration.includes("create table public.track_vault"));
  assert.ok(migration.includes("linked_release_id uuid references public.releases"));
  assert.ok(mediaAction.includes("createVaultTrackFromMedia"));
  assert.ok(workerBridge.includes('jobType: "analyze_audio"'));
  assert.ok(workerBridge.includes("dispatchMediaWorkerJob"));
});

test("Create keeps specialist creation outcomes discoverable", async () => {
  const create = await readFile("app/studio/(protected)/create/page.tsx", "utf8");
  assert.ok(create.includes('href: "/studio/music"'));
  assert.ok(create.includes('href: "/studio/production"'));
  assert.ok(create.includes('href: "/studio/video"'));
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
