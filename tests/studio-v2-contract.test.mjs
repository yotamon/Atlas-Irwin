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

test("Ensemblis primary navigation matches the product roadmap and keeps specialist tools advanced", async () => {
  const product = await readFile("lib/ensemblis-product.ts", "utf8");
  const sidebar = await readFile("components/studio/sidebar.tsx", "utf8");

  const primaryRoutes = [
    "/studio",
    "/studio/music",
    "/studio/releases",
    "/studio/create",
    "/studio/growth",
    "/studio/audience",
    "/studio/library",
    "/studio/connections",
    "/studio/settings",
  ];

  for (const route of primaryRoutes) {
    assert.match(product, new RegExp(route.replaceAll("/", "\\/")));
  }

  for (const advancedRoute of [
    "/studio/distribution",
    "/studio/campaigns",
    "/studio/content",
    "/studio/outreach",
    "/studio/analytics",
    "/studio/data-health",
  ]) {
    assert.equal(
      product.includes(`\"${advancedRoute}\"`),
      false,
      `${advancedRoute} leaked into Ensemblis primary navigation`,
    );
  }

  assert.ok(sidebar.includes("ENSEMBLIS_PRIMARY_NAV"));
  assert.ok(sidebar.includes("Active artist"));
  assert.equal(sidebar.includes("ATLAS"), false, "Atlas product branding leaked back into the Ensemblis shell");
});

test("Ensemblis auth and shell keep artist identity separate from product identity", async () => {
  const login = await readFile("app/studio/login/page.tsx", "utf8");
  const layout = await readFile("app/studio/(protected)/layout.tsx", "utf8");
  const product = await readFile("lib/ensemblis-product.ts", "utf8");

  assert.ok(product.includes('name: "Ensemblis"'));
  assert.ok(login.includes("ENSEMBLIS_PRODUCT"));
  assert.equal(login.includes("Atlas Irwin"), false);
  assert.ok(layout.includes("resolveDefaultArtistContext"));
  assert.ok(layout.includes("artistName={artist.artistName}"));
  assert.ok(layout.includes("workspaceName={artist.workspaceName}"));
});

test("release workspace exposes lifecycle-aware growth stages and preserves an advanced escape hatch", async () => {
  const workspace = await readFile("components/studio/release-workspace-v2.tsx", "utf8");
  for (const upcomingStage of ["Select", "Prepare", "Build hype", "Release", "Sustain"]) assert.ok(workspace.includes(upcomingStage));
  for (const catalogStage of ["Orient", "Rediscover", "Produce", "Distribute", "Learn"]) assert.ok(workspace.includes(catalogStage));
  assert.ok(workspace.includes("Advanced view"));
  assert.ok(workspace.includes("/studio/production"));
  assert.ok(workspace.includes("/studio/video?release="));
  assert.ok(workspace.includes("Workflow readiness"));
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
