import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(`${process.cwd()}/${path}`, "utf8");

test("Fan Graph keeps identity and permission channel-scoped", async () => {
  const [migration, actions, server, quality] = await Promise.all([
    read("supabase/migrations/20260905160000_fan_graph.sql"),
    read("app/studio/fan-actions.ts"),
    read("lib/audience/fan-graph-server.ts"),
    read("lib/audience/fan-quality.ts"),
  ]);
  assert.match(migration, /fan_identities/);
  assert.match(migration, /fan_permissions/);
  assert.match(migration, /channel/);
  assert.match(actions, /evidence/i);
  assert.match(actions, /verified/i);
  assert.match(actions, /DELETE/);
  assert.match(server, /permission/i);
  assert.match(quality, /permission/i);
  assert.doesNotMatch(`${server}\n${quality}`, /race|religion|sexual|political|health score|income score/i);
});

test("cross-channel merges require evidence and privacy deletion remains possible", async () => {
  const [migration, evidence] = await Promise.all([
    read("supabase/migrations/20260905160000_fan_graph.sql"),
    read("supabase/migrations/20260905160100_fan_permission_evidence.sql"),
  ]);
  const combined = `${migration}\n${evidence}`;
  assert.match(combined, /merge/i);
  assert.match(combined, /evidence/i);
  assert.match(combined, /delete/i);
  assert.match(combined, /revoke/i);
  assert.doesNotMatch(combined, /visitor_hash|fingerprint_hash|browser_fingerprint|device_fingerprint|fingerprint\s+(text|varchar|uuid|jsonb)/i);
});

test("Fan Quality Intelligence separates attention, qualified fandom and owned reach without pseudo-precision", async () => {
  const [quality, server, audience, owned, marketingBuild, nextBest] = await Promise.all([
    read("lib/audience/fan-quality.ts"),
    read("lib/audience/fan-graph-server.ts"),
    read("app/studio/(protected)/audience/page.tsx"),
    read("lib/audience/owned-audience-preparation.ts"),
    read("lib/marketing/marketing-intelligence-build.ts"),
    read("lib/marketing/next-best-action.ts"),
  ]);

  for (const band of ["new", "engaged", "qualified", "core", "inactive"]) {
    assert.ok(quality.includes(`\"${band}\"`), `missing fan quality band: ${band}`);
  }
  assert.match(quality, /verified_email/);
  assert.match(quality, /verified_phone/);
  assert.match(quality, /email_marketing/);
  assert.match(quality, /sms_marketing/);
  assert.match(quality, /permission\.evidence_at/);
  assert.match(quality, /identity\.verified_at/);
  assert.match(quality, /permission\.expires_at/);
  assert.match(quality, /repeatEngaged/);
  assert.match(quality, /ownedReachable/);
  assert.doesNotMatch(quality, /fanScore|qualityScore|\/100/);

  assert.match(server, /loadFanQualitySnapshot/);
  assert.match(server, /assessFanQuality/);
  assert.match(server, /summarizeFanQuality/);
  assert.match(owned, /permissionedOwnedFanIds/);
  assert.doesNotMatch(owned, /function validPermissionExpiry/);

  assert.match(audience, /qualified fans/i);
  assert.match(audience, /core fans/i);
  assert.match(audience, /directly reachable/i);
  assert.match(audience, /not a universal fan score/i);

  assert.match(marketingBuild, /loadFanQualitySnapshot/);
  assert.match(marketingBuild, /fanQualityPlanningContext/);
  assert.doesNotMatch(marketingBuild, /fanQuality\.profiles|fanQuality\.identities|fanQuality\.permissions/);

  assert.match(nextBest, /fanQualityGoal/);
  assert.match(nextBest, /qualifiedFanCount/);
  assert.match(nextBest, /ownedReachableCount/);
  assert.match(nextBest, /Build the first repeat-fan loop/);
  assert.match(nextBest, /Build the first permissioned fan relationship/);
});
