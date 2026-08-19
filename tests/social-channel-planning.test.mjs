import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

const socialRoutes = [
  "app/studio/(protected)/settings/social/[platform]/page.tsx",
  "app/studio/(protected)/settings/social/[platform]/connect/route.ts",
  "app/studio/(protected)/settings/social/[platform]/callback/route.ts",
];

test("Studio exposes managed social connection routes", async () => {
  await Promise.all(socialRoutes.map((path) => access(path)));
  const settings = await readFile("app/studio/(protected)/settings/page.tsx", "utf8");
  assert.ok(settings.includes("social_channel_accounts"));
  assert.ok(settings.includes("Campaign Brain only plans for connected platforms"));
});

test("campaign planner treats connected channels as a hard boundary", async () => {
  const planner = await readFile("lib/marketing/planner.ts", "utf8");
  assert.ok(planner.includes("connectedSocialChannels"));
  assert.ok(planner.includes("enum: connectedPlatforms"));
  assert.ok(planner.includes("allowedPlatforms.has(moment.platform)"));
  assert.ok(planner.includes("connectedPlatforms: []"));
  assert.equal(planner.includes('enum: ["Instagram", "TikTok", "YouTube Shorts"'), false);
  assert.equal(planner.includes('platform: "Instagram"'), false);
  assert.equal(planner.includes('platform: "TikTok"'), false);
  assert.equal(planner.includes('platform: "YouTube Shorts"'), false);
});

test("social connection tokens stay outside the public schema", async () => {
  const migration = await readFile(
    "supabase/migrations/20260819180000_social_channel_connections.sql",
    "utf8",
  );
  assert.ok(migration.includes("create table public.social_channel_accounts"));
  assert.ok(migration.includes("create table private.social_channel_tokens"));
  assert.ok(migration.includes("revoke all on private.social_channel_tokens"));
  assert.ok(migration.includes("grant execute on function public.get_social_channel_token"));
});

test("all supported social platforms have one canonical planner label", async () => {
  const registry = await readFile("lib/marketing/social-platforms.ts", "utf8");
  for (const platform of ["instagram", "tiktok", "youtube"]) {
    assert.ok(registry.includes(`\"${platform}\"`));
  }
  for (const label of ["Instagram", "TikTok", "YouTube Shorts"]) {
    assert.ok(registry.includes(`\"${label}\"`));
  }
});
